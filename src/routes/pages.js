'use strict';
const express = require('express');
const QRCode = require('qrcode');
const db = require('../db');
const recipes = require('../recipes');
const settings = require('../settings');
const config = require('../config');
const u = require('../util');
const pages = require('../views/pages');
const { recipePage } = require('../views/recipe');
const { outboundUrl } = require('../monetization');
const auth = require('../auth');
const cache = require('../cache');
const sec = require('../security');

const router = express.Router();
const base = (req) => config.baseUrl || `${req.protocol}://${req.get('host')}`;
const perPage = () => settings.all().recipesPerPage || 12;

router.get('/', (req, res) => cache.page(req, res, () => {
  const latest = recipes.search({ sort: 'recent', perPage: perPage() }).items;
  return pages.home({
    featured: recipes.search({ featured: true, sort: 'recent', perPage: 8 }).items,
    latest,
    popular: recipes.search({ sort: 'popular', perPage: 8 }).items,
    quick: recipes.search({ maxTime: 30, sort: 'quick', perPage: 8 }).items,
    categories: recipes.categories(),
    tags: recipes.allTags(24),
    user: req.user,
  });
}));

function searchPage(req, res, { title, basePath, extra = {}, intro = '', nav = 'search', indexable = false, description = '', crumbs = null }) {
  const q = { ...pickQuery(req.query), ...extra };
  // Código exato digitado na busca → vai direto para a receita
  if (q.q && /^#/.test(q.q.trim())) {
    const r = recipes.getByCode(q.q);
    if (r && r.status === 'published') return res.redirect(302, `/receita/${r.slug}`);
  }
  const hit = !req.user && cache.get(req.originalUrl);
  if (hit) return res.status(hit.status).set('X-Cache', 'HIT').send(hit.body);
  const result = recipes.search({ ...q, perPage: perPage() });
  if (result.page > result.pages) return res.status(404).send(pages.notFound(req.user));
  const canonical = `${base(req)}${basePath}${result.page > 1 ? `?page=${result.page}` : ''}`;
  cache.page(req, res, () => pages.listing({ title, intro, result, q, categories: recipes.categories(), basePath, user: req.user, nav, canonical, indexable, description, crumbs }));
}

function pickQuery(q) {
  const out = {};
  for (const k of ['q', 'category', 'tag', 'diet', 'maxTime', 'difficulty', 'sort', 'page', 'ingredients']) if (q[k]) out[k] = String(Array.isArray(q[k]) ? q[k][0] : q[k]).slice(0, 200);
  return out;
}

router.get('/receitas', (req, res) => searchPage(req, res, { title: 'Todas as receitas', basePath: '/receitas', nav: 'recipes', indexable: true, crumbs: [['Início', '/'], ['Receitas', '/receitas']] }));
router.get('/busca', (req, res) => searchPage(req, res, { title: req.query.q ? `Busca: ${req.query.q}` : 'Buscar receitas', basePath: '/busca' }));

router.get('/categorias', (req, res) => res.send(pages.categoriesPage({ categories: recipes.categories(), user: req.user })));
router.get('/categoria/:slug', (req, res) => {
  const cat = db.get().prepare('SELECT * FROM categories WHERE slug = ?').get(req.params.slug);
  if (!cat) return res.status(404).send(pages.notFound(req.user, 'Categoria não encontrada'));
  searchPage(req, res, {
    title: `Receitas de ${cat.name.toLowerCase()}`,
    intro: cat.description ? `<p>${u.esc(cat.description)}</p>` : '',
    description: cat.description || `As melhores receitas de ${cat.name.toLowerCase()}: fáceis, testadas e com passo a passo.`,
    basePath: `/categoria/${cat.slug}`, extra: { category: cat.slug }, nav: 'recipes', indexable: true,
    crumbs: [['Início', '/'], ['Categorias', '/categorias'], [cat.name, `/categoria/${cat.slug}`]],
  });
});
router.get('/tag/:tag', (req, res) => {
  const tag = String(req.params.tag).slice(0, 40);
  searchPage(req, res, { title: `Receitas: ${tag}`, description: `Receitas com o tema ${tag}, com passo a passo e modo cozinha.`, basePath: `/tag/${encodeURIComponent(tag)}`, extra: { tag }, nav: 'recipes', indexable: true, crumbs: [['Início', '/'], [`#${tag}`, `/tag/${encodeURIComponent(tag)}`]] });
});

router.get('/receita/:slug', (req, res) => {
  let r = recipes.getBySlug(req.params.slug);
  if (!r) {
    // Endereço antigo (título mudou) ou código → redireciona permanentemente para o endereço atual
    r = recipes.getByOldSlug(req.params.slug) || recipes.getByCode(req.params.slug);
    if (r && (r.status === 'published' || auth.canEditRecipe(req.user, r))) return res.redirect(301, `/receita/${r.slug}`);
    r = null;
  }
  // Rascunho: só o autor ou um administrador enxerga (não basta estar logado)
  if (!r || (r.status !== 'published' && !auth.canEditRecipe(req.user, r))) return res.status(404).send(pages.notFound(req.user, 'Receita não encontrada'));
  if (!auth.canEditRecipe(req.user, r) && !/bot|crawl|spider|preview/i.test(req.get('user-agent') || '')) recipes.incrementViews(r.id);
  cache.page(req, res, () => {
    const author = r.author_id ? db.get().prepare('SELECT name FROM users WHERE id = ?').get(r.author_id) : null;
    r.author_name = author?.name;
    const comments = db.get().prepare("SELECT name, body, rating, created_at FROM comments WHERE recipe_id = ? AND status = 'approved' ORDER BY id DESC LIMIT 100").all(r.id);
    return recipePage({ r, base: base(req), related: recipes.related(r, 4), products: recipes.products(r.id), adjacent: recipes.adjacent(r), comments, user: req.user });
  });
});

// Link curto por código: /c/K7M2QX
router.get(['/c/:code', '/r/:code'], (req, res) => {
  const r = recipes.getByCode(req.params.code);
  if (!r || (r.status !== 'published' && !auth.canEditRecipe(req.user, r))) return res.status(404).send(pages.notFound(req.user, `Nenhuma receita com o código #${u.normalizeCode(req.params.code)}`));
  res.redirect(302, `/receita/${r.slug}`);
});

router.get('/qr/:code.svg', async (req, res) => {
  const r = recipes.getByCode(req.params.code);
  if (!r || r.status !== 'published') return res.sendStatus(404);
  const svg = await QRCode.toString(`${base(req)}/c/${r.code}`, { type: 'svg', margin: 1, color: { dark: '#1d1a17', light: '#ffffff' } });
  res.type('image/svg+xml').set('Cache-Control', 'public, max-age=86400').send(svg);
});

router.get('/surpresa', (req, res) => {
  const r = db.get().prepare("SELECT slug FROM recipes WHERE status='published' ORDER BY RANDOM() LIMIT 1").get();
  res.redirect(302, r ? `/receita/${r.slug}` : '/');
});

// Link de afiliado com contagem de cliques
router.get('/go/:id', (req, res) => {
  const p = db.get().prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(Number(req.params.id) || 0);
  const url = p && outboundUrl(p);
  if (!url) return res.status(404).send(pages.notFound(req.user, 'Produto não encontrado'));
  // Conta no máximo 1 clique por IP/produto a cada 10 min (evita inflar estatísticas)
  if (!sec.hit(`go:${req.ip}:${p.id}`, 1, 600e3).over) db.get().prepare('UPDATE products SET clicks = clicks + 1 WHERE id = ?').run(p.id);
  res.set('X-Robots-Tag', 'noindex, nofollow').redirect(302, url);
});

router.get('/favoritos', (req, res) => res.send(pages.favorites(req.user)));
router.get('/lista', (req, res) => res.send(pages.shoppingList(req.user)));
router.get('/planejador', (req, res) => res.send(pages.planner(req.user)));
router.get('/geladeira', (req, res) => res.send(pages.fridge({ user: req.user, q: req.query.q })));
router.get('/conversor', (req, res) => res.send(pages.converter(req.user)));
router.get('/sobre', (req, res) => res.send(pages.about({ user: req.user, author: db.get().prepare("SELECT * FROM users WHERE role='admin' ORDER BY id LIMIT 1").get() })));
router.get('/privacidade', (req, res) => res.send(pages.legalPage({ user: req.user, kind: 'privacy' })));
router.get('/termos', (req, res) => res.send(pages.legalPage({ user: req.user, kind: 'terms' })));

// Cartão para incorporar em outros sites: <iframe src="/embed/CODIGO">
router.get('/embed/:code', (req, res) => {
  const r = recipes.getByCode(req.params.code);
  if (!r || r.status !== 'published') return res.status(404).send('Receita não encontrada');
  res.send(pages.embed({ r, base: base(req) }));
});

router.get('/offline', (req, res) => res.send(pages.offline()));
router.get('/api/docs', (req, res) => res.send(pages.apiDocs(base(req))));

// ---------------- SEO, feeds e PWA ----------------
router.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(`User-agent: *\nAllow: /\nAllow: /api/docs\nDisallow: /admin\nDisallow: /go/\nDisallow: /api/\nDisallow: /embed/\nDisallow: /lista\nDisallow: /favoritos\nDisallow: /planejador\nDisallow: /surpresa\n\nSitemap: ${base(req)}/sitemap.xml\n`);
});

router.get('/ads.txt', (req, res) => {
  const s = settings.all();
  const lines = s.adsTxt || (s.adsenseClient ? `google.com, ${s.adsenseClient.replace(/^ca-/, '')}, DIRECT, f08c47fec0942fa0` : '');
  if (!lines) return res.sendStatus(404);
  res.type('text/plain').send(lines);
});

router.get('/sitemap.xml', (req, res) => {
  const b = base(req);
  const d = db.get();
  const rows = d.prepare("SELECT slug, title, updated_at, cover FROM recipes WHERE status='published' ORDER BY id DESC LIMIT 45000").all();
  const cats = d.prepare("SELECT c.slug, MAX(r.updated_at) AS lastmod FROM categories c JOIN recipes r ON r.category_id = c.id AND r.status = 'published' GROUP BY c.id").all();
  const tags = d.prepare("SELECT t.tag FROM recipe_tags t JOIN recipes r ON r.id = t.recipe_id AND r.status='published' GROUP BY t.tag HAVING COUNT(*) >= 2 LIMIT 2000").all();
  const urls = [
    `<url><loc>${b}/</loc><changefreq>daily</changefreq></url>`,
    `<url><loc>${b}/receitas</loc></url>`,
    `<url><loc>${b}/categorias</loc></url>`,
    `<url><loc>${b}/conversor</loc></url>`,
    `<url><loc>${b}/sobre</loc></url>`,
    ...cats.map((c) => `<url><loc>${b}/categoria/${u.esc(c.slug)}</loc>${c.lastmod ? `<lastmod>${c.lastmod.slice(0, 10)}</lastmod>` : ''}</url>`),
    ...tags.map((t) => `<url><loc>${b}/tag/${u.esc(encodeURIComponent(t.tag))}</loc></url>`),
    ...rows.map((r) => `<url><loc>${b}/receita/${u.esc(r.slug)}</loc><lastmod>${r.updated_at.slice(0, 10)}</lastmod>${r.cover ? `<image:image><image:loc>${u.esc(r.cover.startsWith('/') ? b + r.cover : r.cover)}</image:loc><image:title>${u.esc(r.title)}</image:title></image:image>` : ''}</url>`),
  ];
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">${urls.join('')}</urlset>`);
});

router.get('/feed.xml', (req, res) => {
  const b = base(req);
  const s = settings.all();
  const items = recipes.search({ sort: 'recent', perPage: 30 }).items;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:atom="http://www.w3.org/2005/Atom"><channel>
<title>${u.esc(s.siteName)}</title><link>${b}/</link><description>${u.esc(s.description)}</description><language>pt-BR</language><atom:link href="${b}/feed.xml" rel="self" type="application/rss+xml"/>
${items.map((r) => `<item><title>${u.esc(r.title)}</title><link>${b}/receita/${u.esc(r.slug)}</link><guid isPermaLink="false">${u.esc(r.code)}</guid><pubDate>${new Date(r.published_at || r.created_at).toUTCString()}</pubDate><description>${u.esc(r.description)}</description>${r.cover ? `<media:content url="${u.esc(r.cover.startsWith('/') ? b + r.cover : r.cover)}" medium="image"/>` : ''}</item>`).join('\n')}
</channel></rss>`;
  res.type('application/rss+xml').send(xml);
});

router.get('/manifest.webmanifest', (req, res) => {
  const s = settings.all();
  res.type('application/manifest+json').send(JSON.stringify({
    name: s.siteName,
    short_name: s.siteName.slice(0, 12),
    description: s.description,
    lang: 'pt-BR',
    start_url: '/?source=pwa',
    scope: '/',
    display: 'standalone',
    display_override: ['window-controls-overlay', 'standalone'],
    orientation: 'any',
    background_color: '#fffaf5',
    theme_color: s.themeColor,
    categories: ['food', 'lifestyle'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml' },
    ],
    shortcuts: [
      { name: 'Buscar receitas', url: '/busca', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'Lista de compras', url: '/lista', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'Favoritos', url: '/favoritos', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'Cardápio da semana', url: '/planejador', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
    ],
    share_target: { action: '/admin/importar', method: 'GET', params: { title: 'title', text: 'text', url: 'url' } },
  }));
});

module.exports = router;
