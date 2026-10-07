'use strict';
const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const multer = require('multer');
const db = require('../db');
const auth = require('../auth');
const recipes = require('../recipes');
const settings = require('../settings');
const importer = require('../importer');
const u = require('../util');
const config = require('../config');
const { AD_SLOTS } = require('../monetization');
const openapi = require('../openapi');

const router = express.Router();

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const baseUrl = (req) => config.baseUrl || `${req.protocol}://${req.get('host')}`;

// CORS: leitura pública liberada para qualquer origem; escrita exige API key (Bearer).
router.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
router.use(auth.sameOrigin);

// Limite simples de requisições por IP para rotas públicas de escrita
const hits = new Map();
function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const key = `${req.ip}:${req.baseUrl}${req.route?.path || req.path}`;
    const now = Date.now();
    const e = hits.get(key) || { n: 0, t: now };
    if (now - e.t > windowMs) { e.n = 0; e.t = now; }
    e.n++;
    hits.set(key, e);
    if (e.n > max) return res.status(429).json({ error: 'Muitas requisições, tente novamente em instantes' });
    next();
  };
}

// ---------------- Documentação ----------------
router.get('/', (req, res) => res.json({ name: 'Chef API', version: 1, docs: `${baseUrl(req)}/api/docs`, openapi: `${baseUrl(req)}/api/v1/openapi.json` }));
router.get('/openapi.json', (req, res) => res.json(openapi(baseUrl(req))));

// ---------------- Autenticação ----------------
router.post('/auth/setup', rateLimit(10, 60e3), (req, res) => {
  if (auth.userCount() > 0) return res.status(409).json({ error: 'O sistema já foi configurado' });
  const id = auth.createUser({ ...req.body, role: 'admin' });
  if (req.body.siteName) settings.update({ siteName: req.body.siteName, authorName: req.body.name || '' });
  auth.setSessionCookie(res, id);
  res.status(201).json({ user: auth.publicUser(db.get().prepare('SELECT * FROM users WHERE id = ?').get(id)) });
});

router.post('/auth/login', rateLimit(10, 60e3), (req, res) => {
  const { email, password } = req.body || {};
  const user = db.get().prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').trim());
  if (!user || !auth.verifyPassword(password, user.password_hash)) return res.status(401).json({ error: 'E-mail ou senha incorretos' });
  auth.setSessionCookie(res, user.id);
  res.json({ user: auth.publicUser(user) });
});

router.post('/auth/logout', (req, res) => {
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/auth/me', (req, res) => res.json({ user: auth.publicUser(req.user), needsSetup: auth.userCount() === 0 }));

router.put('/auth/me', auth.requireUser, (req, res) => {
  const { name, bio, avatar, password, currentPassword } = req.body || {};
  const d = db.get();
  if (password) {
    if (!auth.verifyPassword(currentPassword, req.user.password_hash)) return res.status(400).json({ error: 'Senha atual incorreta' });
    if (String(password).length < 8) return res.status(400).json({ error: 'A nova senha deve ter ao menos 8 caracteres' });
    d.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(auth.hashPassword(password), req.user.id);
  }
  d.prepare('UPDATE users SET name = COALESCE(?, name), bio = COALESCE(?, bio), avatar = COALESCE(?, avatar) WHERE id = ?').run(name ?? null, bio ?? null, avatar ?? null, req.user.id);
  res.json({ user: auth.publicUser(d.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
});

// ---------------- Usuários (admin) ----------------
router.get('/users', auth.requireAdmin, (req, res) => res.json({ items: db.get().prepare('SELECT * FROM users ORDER BY id').all().map(auth.publicUser) }));
router.post('/users', auth.requireAdmin, (req, res) => {
  const id = auth.createUser({ ...req.body, role: req.body.role === 'admin' ? 'admin' : 'author' });
  res.status(201).json({ user: auth.publicUser(db.get().prepare('SELECT * FROM users WHERE id = ?').get(id)) });
});
router.delete('/users/:id', auth.requireAdmin, (req, res) => {
  if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: 'Você não pode remover a si mesmo' });
  db.get().prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------------- Chaves de API ----------------
router.get('/keys', auth.requireUser, (req, res) => {
  res.json({ items: db.get().prepare('SELECT id, name, prefix, last_used_at, created_at FROM api_keys WHERE user_id = ? ORDER BY id DESC').all(req.user.id) });
});
router.post('/keys', auth.requireUser, (req, res) => {
  if (req.viaApiKey) return res.status(403).json({ error: 'Crie chaves pelo painel' });
  res.status(201).json(auth.createApiKey(req.user.id, req.body?.name));
});
router.delete('/keys/:id', auth.requireUser, (req, res) => {
  db.get().prepare('DELETE FROM api_keys WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

// ---------------- Receitas ----------------
function canSeeDrafts(req) {
  return !!req.user;
}

router.get('/recipes', (req, res) => {
  const q = req.query;
  const result = recipes.search({
    q: q.q, code: q.code, category: q.category, tag: q.tag, diet: q.diet, maxTime: q.maxTime, difficulty: q.difficulty,
    ingredients: q.ingredients, sort: q.sort, page: q.page, perPage: q.perPage || q.limit, featured: q.featured === '1' || q.featured === 'true',
    status: canSeeDrafts(req) ? (q.status || 'any') : 'published',
  });
  res.json({ ...result, items: result.items.map((r) => recipes.toPublic(r, baseUrl(req))), exactCode: result.exactCode ? recipes.toPublic(result.exactCode, baseUrl(req)) : null });
});

router.get('/search/suggest', (req, res) => res.json({ items: recipes.suggest(String(req.query.q || ''), 8) }));

router.get('/recipes/code/:code', (req, res) => {
  const r = recipes.getByCode(req.params.code);
  if (!r || (r.status !== 'published' && !canSeeDrafts(req))) return res.status(404).json({ error: 'Nenhuma receita com este código' });
  res.json(recipes.toPublic(r, baseUrl(req)));
});

router.get('/recipes/:ref', (req, res) => {
  const r = recipes.find(req.params.ref);
  if (!r || (r.status !== 'published' && !canSeeDrafts(req))) return res.status(404).json({ error: 'Receita não encontrada' });
  const out = recipes.toPublic(r, baseUrl(req));
  out.products = recipes.products(r.id).map((p) => ({ id: p.id, title: p.title, image: p.image, price: p.price, url: `${baseUrl(req)}/go/${p.id}` }));
  res.json(out);
});

function mapCategory(data) {
  if (data.category && !data.category_id) {
    const name = String(data.category).trim();
    const d = db.get();
    let c = d.prepare('SELECT id FROM categories WHERE name = ? COLLATE NOCASE OR slug = ?').get(name, u.slugify(name));
    if (!c && data.createCategory !== false && name) {
      const info = d.prepare('INSERT OR IGNORE INTO categories (name, slug) VALUES (?, ?)').run(name, u.slugify(name));
      c = { id: Number(info.lastInsertRowid) || d.prepare('SELECT id FROM categories WHERE slug = ?').get(u.slugify(name)).id };
    }
    if (c) data.category_id = c.id;
  }
  return data;
}

router.post('/recipes', auth.requireUser, (req, res) => {
  const r = recipes.create(mapCategory({ ...req.body }), req.user.id);
  res.status(201).json(recipes.toPublic(r, baseUrl(req)));
});

const updateRecipe = (req, res) => {
  const current = recipes.find(req.params.ref);
  if (!current) return res.status(404).json({ error: 'Receita não encontrada' });
  const r = recipes.update(current.id, mapCategory({ ...req.body }));
  res.json(recipes.toPublic(r, baseUrl(req)));
};
router.put('/recipes/:ref', auth.requireUser, updateRecipe);
router.patch('/recipes/:ref', auth.requireUser, updateRecipe);

router.delete('/recipes/:ref', auth.requireUser, (req, res) => {
  const r = recipes.find(req.params.ref);
  if (!r) return res.status(404).json({ error: 'Receita não encontrada' });
  recipes.remove(r.id);
  res.json({ ok: true });
});

router.post('/recipes/:ref/duplicate', auth.requireUser, (req, res) => {
  const r = recipes.find(req.params.ref);
  if (!r) return res.status(404).json({ error: 'Receita não encontrada' });
  const copy = recipes.create({ ...recipes.toPublic(r), title: `${r.title} (cópia)`, status: 'draft', code: undefined, category_id: r.category_id, products: recipes.products(r.id).map((p) => p.id) }, req.user.id);
  res.status(201).json(recipes.toPublic(copy, baseUrl(req)));
});

router.post('/recipes/:ref/cooked', rateLimit(20, 60e3), (req, res) => {
  const r = recipes.find(req.params.ref);
  if (!r) return res.status(404).json({ error: 'Receita não encontrada' });
  recipes.incrementCooked(r.id);
  res.json({ cooked: r.cooked + 1 });
});

// ---------------- Comentários e avaliações ----------------
router.get('/recipes/:ref/comments', (req, res) => {
  const r = recipes.find(req.params.ref);
  if (!r) return res.status(404).json({ error: 'Receita não encontrada' });
  res.json({ items: db.get().prepare("SELECT id, name, body, rating, created_at FROM comments WHERE recipe_id = ? AND status = 'approved' ORDER BY id DESC").all(r.id) });
});

router.post('/recipes/:ref/comments', rateLimit(5, 60e3), (req, res) => {
  const r = recipes.find(req.params.ref);
  if (!r || r.status !== 'published') return res.status(404).json({ error: 'Receita não encontrada' });
  const { name, body, rating, website } = req.body || {};
  if (website) return res.status(201).json({ ok: true, pending: true }); // honeypot anti-spam
  const n = String(name || '').trim().slice(0, 60);
  const b = String(body || '').trim().slice(0, 3000);
  const rt = rating ? Math.min(5, Math.max(1, Math.round(Number(rating)))) : null;
  if (!n || (!b && !rt)) return res.status(400).json({ error: 'Informe seu nome e um comentário ou nota' });
  const status = req.user || !settings.all().commentsModeration ? 'approved' : 'pending';
  const ipHash = crypto.createHash('sha256').update(`${req.ip}${config.secret}`).digest('hex').slice(0, 16);
  const info = db.get().prepare('INSERT INTO comments (recipe_id, name, body, rating, status, ip_hash) VALUES (?, ?, ?, ?, ?, ?)').run(r.id, n, b, rt, status, ipHash);
  res.status(201).json({ id: Number(info.lastInsertRowid), pending: status === 'pending' });
});

router.get('/comments', auth.requireUser, (req, res) => {
  const status = req.query.status || 'pending';
  res.json({
    items: db.get().prepare(`SELECT c.*, r.title AS recipe_title, r.slug AS recipe_slug FROM comments c JOIN recipes r ON r.id = c.recipe_id ${status === 'all' ? '' : 'WHERE c.status = ?'} ORDER BY c.id DESC LIMIT 200`).all(...(status === 'all' ? [] : [status])),
  });
});
router.patch('/comments/:id', auth.requireUser, (req, res) => {
  const status = ['approved', 'pending', 'spam'].includes(req.body?.status) ? req.body.status : 'approved';
  db.get().prepare('UPDATE comments SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json({ ok: true });
});
router.delete('/comments/:id', auth.requireUser, (req, res) => {
  db.get().prepare('DELETE FROM comments WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------------- Importação / Exportação ----------------
router.post('/import', auth.requireUser, wrap(async (req, res) => {
  const { url, save = false, status = 'draft', downloadImages = true } = req.body || {};
  if (!url) return res.status(400).json({ error: 'Informe a URL' });
  const data = await importer.importFromUrl(String(url), { downloadImages: downloadImages !== false && downloadImages !== 'false' });
  if (!save) return res.json({ preview: data });
  const r = recipes.create(mapCategory({ ...data, status }), req.user.id);
  res.status(201).json(recipes.toPublic(r, baseUrl(req)));
}));

/** Importação em lote de JSON (formato desta API ou schema.org Recipe). */
router.post('/import/json', auth.requireUser, (req, res) => {
  const body = req.body;
  const list = Array.isArray(body) ? body : Array.isArray(body?.items) ? body.items : [body];
  const created = [];
  const errors = [];
  list.slice(0, 500).forEach((item, i) => {
    try {
      const data = item && /Recipe/.test(String(item['@type'])) ? importer.parseHtml(`<script type="application/ld+json">${JSON.stringify(item)}</script>`, item.url || 'https://localhost/') : item;
      const { id, slug, url, rating, views, cooked, created_at, updated_at, published_at, category, ...rest } = data;
      const payload = { ...rest, category: typeof category === 'object' && category ? category.name : category };
      if (rest.code && recipes.getByCode(rest.code)) delete payload.code;
      created.push(recipes.toPublic(recipes.create(mapCategory(payload), req.user.id), baseUrl(req)));
    } catch (e) {
      errors.push({ index: i, error: e.message });
    }
  });
  res.status(created.length ? 201 : 400).json({ created: created.length, items: created, errors });
});

router.get('/export', auth.requireUser, (req, res) => {
  const items = recipes.search({ status: 'any', perPage: 100000 }).items.map((r) => ({ ...recipes.toPublic(r, baseUrl(req)), products: recipes.products(r.id).map((p) => p.id) }));
  res.setHeader('Content-Disposition', `attachment; filename="receitas-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json({ exported_at: new Date().toISOString(), count: items.length, items, categories: recipes.categories(), products: db.get().prepare('SELECT * FROM products').all() });
});

// ---------------- Upload de fotos e vídeos ----------------
const upload = multer({
  storage: multer.diskStorage({
    destination: config.uploadsDir,
    filename: (_req, file, cb) => {
      const ext = (path.extname(file.originalname || '').toLowerCase().match(/^\.[a-z0-9]{1,5}$/) || [''])[0];
      cb(null, `${Date.now().toString(36)}-${crypto.randomBytes(5).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 20 },
  fileFilter: (_req, file, cb) => {
    const ok = /^(image\/(jpeg|png|webp|gif|avif)|video\/(mp4|webm|ogg|quicktime|x-m4v))$/.test(file.mimetype);
    cb(ok ? null : Object.assign(new Error('Formato não suportado (use JPG, PNG, WebP, GIF, AVIF, MP4, WebM ou MOV)'), { status: 415 }), ok);
  },
});

router.post('/uploads', auth.requireUser, upload.array('files', 20), (req, res) => {
  const files = (req.files || []).map((f) => ({ url: `/uploads/${f.filename}`, type: f.mimetype.startsWith('video/') ? 'video' : 'image', size: f.size, name: f.originalname }));
  if (!files.length) return res.status(400).json({ error: 'Nenhum arquivo enviado (campo "files")' });
  res.status(201).json({ files });
});

router.post('/uploads/from-url', auth.requireUser, wrap(async (req, res) => {
  const url = await importer.downloadImage(String(req.body?.url || ''));
  if (!url || !url.startsWith('/uploads/')) return res.status(422).json({ error: 'Não foi possível baixar a imagem' });
  res.status(201).json({ url });
}));

router.get('/uploads', auth.requireUser, (req, res) => {
  const items = fs.readdirSync(config.uploadsDir)
    .filter((f) => !f.startsWith('.'))
    .map((f) => {
      const st = fs.statSync(path.join(config.uploadsDir, f));
      return { url: `/uploads/${f}`, size: st.size, mtime: st.mtime, type: /\.(mp4|webm|ogg|mov|m4v)$/i.test(f) ? 'video' : 'image' };
    })
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 300);
  res.json({ items });
});

// ---------------- Categorias e tags ----------------
router.get('/categories', (req, res) => res.json({ items: recipes.categories() }));
router.post('/categories', auth.requireUser, (req, res) => {
  const { name, icon = '', description = '', position = 0 } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Nome é obrigatório' });
  const info = db.get().prepare('INSERT INTO categories (name, slug, icon, description, position) VALUES (?, ?, ?, ?, ?)').run(String(name), u.slugify(req.body.slug || name), String(icon), String(description), Number(position) || 0);
  res.status(201).json(db.get().prepare('SELECT * FROM categories WHERE id = ?').get(info.lastInsertRowid));
});
router.put('/categories/:id', auth.requireUser, (req, res) => {
  const c = db.get().prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Categoria não encontrada' });
  const b = { ...c, ...req.body };
  db.get().prepare('UPDATE categories SET name = ?, slug = ?, icon = ?, description = ?, position = ? WHERE id = ?').run(String(b.name), u.slugify(b.slug || b.name), String(b.icon || ''), String(b.description || ''), Number(b.position) || 0, c.id);
  recipes.reindexAll();
  res.json(db.get().prepare('SELECT * FROM categories WHERE id = ?').get(c.id));
});
router.delete('/categories/:id', auth.requireUser, (req, res) => {
  db.get().prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});
router.get('/tags', (req, res) => res.json({ items: recipes.allTags(200) }));

// ---------------- Produtos de afiliado (Amazon) ----------------
router.get('/products', auth.requireUser, (req, res) => res.json({ items: db.get().prepare('SELECT * FROM products ORDER BY id DESC').all() }));
function productPayload(b, current = {}) {
  const p = { ...current, ...b };
  const asin = String(p.asin || u.extractAsin(p.url) || '').toUpperCase().slice(0, 10);
  if (!p.title) throw Object.assign(new Error('Título do produto é obrigatório'), { status: 400 });
  if (!asin && !p.url) throw Object.assign(new Error('Informe o ASIN ou o link do produto'), { status: 400 });
  if (p.url && !/^https?:\/\//.test(p.url)) throw Object.assign(new Error('Link inválido'), { status: 400 });
  return [String(p.title), asin, String(p.url || ''), u.isSafeUrl(p.image) ? String(p.image || '') : '', String(p.price || ''), String(p.description || ''), String(p.badge || ''), String(p.keywords || ''), p.active === false || p.active === 0 || p.active === '0' ? 0 : 1];
}
router.post('/products', auth.requireUser, (req, res) => {
  const info = db.get().prepare('INSERT INTO products (title, asin, url, image, price, description, badge, keywords, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(...productPayload(req.body || {}));
  res.status(201).json(db.get().prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid));
});
router.put('/products/:id', auth.requireUser, (req, res) => {
  const p = db.get().prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Produto não encontrado' });
  db.get().prepare('UPDATE products SET title = ?, asin = ?, url = ?, image = ?, price = ?, description = ?, badge = ?, keywords = ?, active = ? WHERE id = ?').run(...productPayload(req.body || {}, p), p.id);
  res.json(db.get().prepare('SELECT * FROM products WHERE id = ?').get(p.id));
});
router.delete('/products/:id', auth.requireUser, (req, res) => {
  db.get().prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------------- Anúncios ----------------
router.get('/ads', auth.requireAdmin, (req, res) => res.json({ slots: AD_SLOTS, items: db.get().prepare('SELECT * FROM ads ORDER BY slot, id').all() }));
function adPayload(b, cur = {}) {
  const a = { ...cur, ...b };
  if (!a.name || !AD_SLOTS[a.slot]) throw Object.assign(new Error('Nome e posição válidos são obrigatórios'), { status: 400 });
  return [String(a.name), a.slot, String(a.html || ''), ['all', 'mobile', 'desktop'].includes(a.device) ? a.device : 'all', a.active === false || a.active === 0 || a.active === '0' ? 0 : 1, Math.max(1, Number(a.weight) || 1)];
}
router.post('/ads', auth.requireAdmin, (req, res) => {
  const info = db.get().prepare('INSERT INTO ads (name, slot, html, device, active, weight) VALUES (?, ?, ?, ?, ?, ?)').run(...adPayload(req.body || {}));
  res.status(201).json(db.get().prepare('SELECT * FROM ads WHERE id = ?').get(info.lastInsertRowid));
});
router.put('/ads/:id', auth.requireAdmin, (req, res) => {
  const a = db.get().prepare('SELECT * FROM ads WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Anúncio não encontrado' });
  db.get().prepare('UPDATE ads SET name = ?, slot = ?, html = ?, device = ?, active = ?, weight = ? WHERE id = ?').run(...adPayload(req.body || {}, a), a.id);
  res.json(db.get().prepare('SELECT * FROM ads WHERE id = ?').get(a.id));
});
router.delete('/ads/:id', auth.requireAdmin, (req, res) => {
  db.get().prepare('DELETE FROM ads WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------------- Configurações ----------------
router.get('/settings', auth.requireAdmin, (req, res) => res.json(settings.all()));
router.put('/settings', auth.requireAdmin, (req, res) => res.json(settings.update(req.body || {})));

// ---------------- Newsletter ----------------
router.post('/subscribe', rateLimit(5, 60e3), (req, res) => {
  const email = String(req.body?.email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'E-mail inválido' });
  db.get().prepare('INSERT OR IGNORE INTO subscribers (email) VALUES (?)').run(email);
  res.status(201).json({ ok: true });
});
router.get('/subscribers', auth.requireAdmin, (req, res) => {
  const items = db.get().prepare('SELECT email, created_at FROM subscribers ORDER BY id DESC').all();
  if (req.query.format === 'csv') {
    res.type('text/csv').setHeader('Content-Disposition', 'attachment; filename="inscritos.csv"');
    return res.send(['email,created_at', ...items.map((i) => `${i.email},${i.created_at}`)].join('\n'));
  }
  res.json({ items });
});

// ---------------- Estatísticas ----------------
router.get('/stats', auth.requireUser, (req, res) => {
  const d = db.get();
  const one = (sql) => Object.values(d.prepare(sql).get())[0];
  res.json({
    recipes: one('SELECT COUNT(*) FROM recipes'),
    published: one("SELECT COUNT(*) FROM recipes WHERE status='published'"),
    drafts: one("SELECT COUNT(*) FROM recipes WHERE status='draft'"),
    views: one('SELECT COALESCE(SUM(views),0) FROM recipes'),
    cooked: one('SELECT COALESCE(SUM(cooked),0) FROM recipes'),
    pendingComments: one("SELECT COUNT(*) FROM comments WHERE status='pending'"),
    subscribers: one('SELECT COUNT(*) FROM subscribers'),
    productClicks: one('SELECT COALESCE(SUM(clicks),0) FROM products'),
    adImpressions: one('SELECT COALESCE(SUM(impressions),0) FROM ads'),
    top: d.prepare('SELECT id, code, slug, title, views, cooked FROM recipes ORDER BY views DESC LIMIT 5').all(),
    topProducts: d.prepare('SELECT id, title, clicks FROM products ORDER BY clicks DESC LIMIT 5').all(),
  });
});

router.use((req, res) => res.status(404).json({ error: 'Rota não encontrada' }));

// eslint-disable-next-line no-unused-vars
router.use((err, req, res, _next) => {
  const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 413 : err.type === 'entity.parse.failed' ? 400 : /UNIQUE constraint/.test(err.message) ? 409 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Erro interno' : err.message });
});

module.exports = router;
