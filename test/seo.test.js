'use strict';
/** Boas práticas de SEO e compartilhamento verificadas automaticamente. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chef-seo-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.UPLOADS_DIR = path.join(tmp, 'uploads');
process.env.BASE_URL = 'https://receitas.exemplo.com.br';
process.env.RATE_LIMIT = 'off';

const db = require('../src/db');
const auth = require('../src/auth');
const { createApp } = require('../src/app');
const settings = require('../src/settings');

let server;
let base;
let key;
let recipe;

async function get(url, headers = {}) {
  const res = await fetch(base + url, { redirect: 'manual', headers });
  return { status: res.status, headers: res.headers, text: await res.text() };
}
const meta = (html, attr, name) => (html.match(new RegExp(`<meta ${attr}="${name.replace(/[.:]/g, '\\$&')}" content="([^"]*)"`)) || [])[1];
const link = (html, rel) => (html.match(new RegExp(`<link rel="${rel}" href="([^"]*)"`)) || [])[1];
const lds = (html) => [...html.matchAll(/<script nonce="[^"]+" type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => JSON.parse(m[1]));

test.before(async () => {
  db.open(':memory:');
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const uid = auth.createUser({ email: 'chef@exemplo.com', password: 'Senha-forte-123', name: 'Ana Chef', role: 'admin' });
  key = auth.createApiKey(uid, 'seo').key;
  settings.update({ siteName: 'Receitas da Ana', social: { instagram: 'https://instagram.com/ana' }, googleSiteVerification: 'abc123verif', twitterHandle: '@anachef' });
  const post = (body) => fetch(`${base}/api/v1/recipes`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  await fetch(`${base}/api/v1/categories`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Bolos', icon: '🍰' }) });
  recipe = await post({ title: 'Bolo de fubá', category: 'Bolos', cover: '/uploads/bolo.jpg', ingredients: '2 xícaras de fubá\n3 ovos', steps: 'Misture.\nAsse por 40 minutos.', prep_minutes: 10, cook_minutes: 40, difficulty: 1, tags: 'bolo, café', diets: 'vegetariana, sem glúten', status: 'published' });
  await post({ title: 'Bolo de laranja', category: 'Bolos', ingredients: '1 laranja', steps: 'x', tags: 'bolo', status: 'published' });
});
test.after(() => {
  server.close();
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('página da receita: título, descrição, canonical absoluto, robots e Open Graph', async () => {
  const r = await get('/receita/bolo-de-fuba');
  const title = r.text.match(/<title>([^<]*)<\/title>/)[1];
  assert.match(title, /^Bolo de fubá: receita fácil e passo a passo · Receitas da Ana$/);
  const desc = meta(r.text, 'name', 'description');
  assert.ok(desc.length >= 70 && desc.length <= 160, `descrição com ${desc.length} caracteres`);
  assert.equal(link(r.text, 'canonical'), 'https://receitas.exemplo.com.br/receita/bolo-de-fuba');
  assert.match(meta(r.text, 'name', 'robots'), /max-image-preview:large/);
  assert.equal(meta(r.text, 'property', 'og:type'), 'article');
  assert.equal(meta(r.text, 'property', 'og:image'), 'https://receitas.exemplo.com.br/img/1280/bolo.jpg?f=jpg', 'og:image absoluta, em JPEG 1280 px (compatível com WhatsApp/Facebook)');
  assert.equal(meta(r.text, 'property', 'og:locale'), 'pt_BR');
  assert.equal(meta(r.text, 'name', 'twitter:card'), 'summary_large_image');
  assert.equal(meta(r.text, 'name', 'twitter:site'), '@anachef');
  assert.equal(meta(r.text, 'name', 'google-site-verification'), 'abc123verif');
  assert.ok(meta(r.text, 'property', 'article:published_time'));
  assert.equal((r.text.match(/<h1[\s>]/g) || []).length, 1, 'exatamente um H1');
  assert.match(r.text, /<html lang="pt-BR">/);
  assert.match(r.text, /hreflang="pt-BR"/);
});

test('dados estruturados: Recipe completo + BreadcrumbList', async () => {
  const r = await get('/receita/bolo-de-fuba');
  const [rec, crumbs] = lds(r.text);
  assert.equal(rec['@type'], 'Recipe');
  for (const k of ['name', 'image', 'author', 'datePublished', 'description', 'prepTime', 'cookTime', 'totalTime', 'recipeYield', 'recipeCategory', 'recipeIngredient', 'recipeInstructions', 'keywords']) assert.ok(rec[k], `Recipe sem ${k}`);
  assert.ok(rec.image.every((i) => i.startsWith('https://')), 'imagens absolutas');
  assert.deepEqual(rec.suitableForDiet, ['https://schema.org/VegetarianDiet', 'https://schema.org/GlutenFreeDiet']);
  assert.equal(rec.recipeInstructions[1]['@type'], 'HowToStep');
  assert.equal(rec.totalTime, 'PT50M');
  assert.equal(crumbs['@type'], 'BreadcrumbList');
  assert.deepEqual(crumbs.itemListElement.map((i) => i.name), ['Início', 'Bolos', 'Bolo de fubá']);
});

test('home: Organization, WebSite com busca (sitelinks searchbox) e ItemList', async () => {
  const r = await get('/');
  const types = lds(r.text).map((j) => j['@type']);
  assert.deepEqual(types, ['Organization', 'WebSite', 'ItemList']);
  const site = lds(r.text)[1];
  assert.equal(site.potentialAction.target.urlTemplate, 'https://receitas.exemplo.com.br/busca?q={search_term_string}');
  assert.deepEqual(lds(r.text)[0].sameAs, ['https://instagram.com/ana']);
  assert.equal(link(r.text, 'canonical'), 'https://receitas.exemplo.com.br/');
});

test('busca e filtros não são indexados; categorias são (tags curtas não)', async () => {
  assert.match(meta((await get('/busca?q=bolo')).text, 'name', 'robots'), /^noindex/);
  assert.match(meta((await get('/receitas?sort=popular')).text, 'name', 'robots'), /^noindex/);
  for (const u of ['/categoria/bolos', '/receitas']) assert.match(meta((await get(u)).text, 'name', 'robots'), /^index/, u);
  assert.match(meta((await get('/tag/bolo')).text, 'name', 'robots'), /^noindex/, 'tag com poucas receitas');
  const cat = await get('/categoria/bolos');
  assert.match(cat.text, /<title>Receitas de bolos · /);
  assert.equal(link(cat.text, 'canonical'), 'https://receitas.exemplo.com.br/categoria/bolos');
  assert.ok(lds(cat.text).some((j) => j['@type'] === 'BreadcrumbList'));
  assert.equal((await get('/categoria/bolos?page=99')).status, 404, 'página inexistente responde 404');
});

test('trocar o título mantém o endereço antigo com redirecionamento 301', async () => {
  await fetch(`${base}/api/v1/recipes/${recipe.id}`, { method: 'PATCH', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Bolo de fubá cremoso' }) });
  const r = await get('/receita/bolo-de-fuba');
  assert.equal(r.status, 301);
  assert.equal(r.headers.get('location'), '/receita/bolo-de-fuba-cremoso');
  const again = await fetch(`${base}/api/v1/recipes`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Bolo de fubá', status: 'published' }) }).then((x) => x.json());
  assert.notEqual(again.slug, 'bolo-de-fuba', 'slug antigo não é reaproveitado por outra receita');
});

test('URLs canônicas: barra no final redireciona com 301', async () => {
  const r = await get('/receitas/?page=1');
  assert.equal(r.status, 301);
  assert.equal(r.headers.get('location'), '/receitas?page=1');
});

test('sitemap, robots e RSS', async () => {
  const sm = await get('/sitemap.xml');
  assert.match(sm.text, /<loc>https:\/\/receitas\.exemplo\.com\.br\/receita\/bolo-de-fuba-cremoso<\/loc><lastmod>\d{4}-\d\d-\d\d<\/lastmod><image:image>/);
  assert.match(sm.text, /\/categoria\/bolos<\/loc><lastmod>/);
  assert.doesNotMatch(sm.text, /\/tag\/bolo<\/loc>/, 'tag com poucas receitas fica fora do sitemap');
  const robots = await get('/robots.txt');
  assert.match(robots.text, /Sitemap: https:\/\/receitas\.exemplo\.com\.br\/sitemap\.xml/);
  assert.match(robots.text, /Disallow: \/admin/);
  const rss = await get('/feed.xml');
  assert.match(rss.text, /<atom:link href="https:\/\/receitas\.exemplo\.com\.br\/feed\.xml" rel="self"/);
});

test('compartilhamento: botões, link curto, QR, embed e imagem padrão', async () => {
  const r = await get('/receita/bolo-de-fuba-cremoso');
  for (const host of ['wa.me', 'pinterest.com/pin/create', 'facebook.com/sharer', 't.me/share', 'x.com/intent', 'mailto:']) assert.ok(r.text.includes(host), host);
  assert.match(r.text, /utm_source(=|%3D)whatsapp/);
  assert.match(r.text, /data-embed="/);
  const code = recipe.code;
  assert.equal((await get(`/c/${code}`)).status, 301);
  assert.equal((await get(`/embed/${code}`)).status, 200);
  const other = await get('/conversor');
  assert.equal(meta(other.text, 'property', 'og:image'), 'https://receitas.exemplo.com.br/icons/icon-512.png');
});

test('páginas obrigatórias para AdSense: privacidade e termos', async () => {
  const p = await get('/privacidade');
  assert.equal(p.status, 200);
  assert.match(p.text, /LGPD/);
  assert.equal((await get('/termos')).status, 200);
  assert.match((await get('/')).text, /href="\/privacidade"/);
});

test('documentação da API é uma página normal (CSS carregado, não bloqueado pela política da API)', async () => {
  const r = await get('/api/docs');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy'), /style-src 'self'/);
  assert.doesNotMatch(r.headers.get('content-security-policy'), /^default-src 'none'/);
});

test('desempenho: HTML comprimido (gzip/brotli) e estáticos com ETag', async () => {
  const r = await fetch(`${base}/receitas`, { headers: { 'accept-encoding': 'gzip, br' } });
  assert.match(r.headers.get('content-encoding') || '', /gzip|br/);
  const css = await fetch(`${base}/css/app.css`);
  assert.ok(css.headers.get('etag'));
});

test('destaque do topo é sorteado entre as 20 mais vistas (com foto têm preferência)', async () => {
  const d = db.get();
  const recipes = require('../src/recipes');
  const mk = (title, views, cover = '') => recipes.create({ title, cover, ingredients: 'a\nb\nc', steps: 'x\ny\nz', status: 'published' }, null);
  const tops = [];
  for (let i = 0; i < 4; i++) tops.push(mk(`Destaque popular ${i}`, 0, `/uploads/foto-destaque-${i}.jpg`));
  tops.forEach((r, i) => d.prepare('UPDATE recipes SET views = ? WHERE id = ?').run(100000 + i, r.id));
  const sem = mk('Muito vista sem foto', 0);
  d.prepare('UPDATE recipes SET views = 999999 WHERE id = ?').run(sem.id);
  require('../src/cache').bump();
  const seen = new Set();
  for (let i = 0; i < 25; i++) {
    require('../src/cache').bump();
    const html = await (await fetch(`${base}/`)).text();
    const m = html.match(/class="hero-feature" href="\/receita\/([^"]+)"/);
    seen.add(m && m[1]);
  }
  assert.ok(seen.size > 1, `o destaque varia (${[...seen].join(', ')})`);
  assert.ok(![...seen].includes(sem.slug), 'com receitas com foto no top 20, a sem foto não é sorteada');
  const top20 = d.prepare("SELECT slug FROM recipes WHERE status = 'published' ORDER BY views DESC LIMIT 20").all().map((r) => r.slug);
  for (const slug of seen) {
    assert.ok(top20.includes(slug), `${slug} está entre as 20 mais vistas`);
    assert.ok(d.prepare('SELECT cover FROM recipes WHERE slug = ?').get(slug).cover, `${slug} tem foto`);
  }
});

test('capas JPEG para o Google (1:1, 4:3, 16:9): sem foto vira cartão; JSON-LD, og:image e sitemap usam JPEG (nunca SVG)', async () => {
  const sharp = require('sharp');
  const recipes = require('../src/recipes');
  const r = recipes.create({ title: 'Pão de queijo mineiro sem foto', ingredients: 'polvilho\nqueijo\novos', steps: 'Misture.\nAsse.', status: 'published' }, null);
  const html = await (await fetch(`${base}/receita/${r.slug}`)).text();
  const ld = JSON.parse(html.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g).map((x) => x.replace(/^<script[^>]*>|<\/script>$/g, '')).find((x) => /"Recipe"/.test(x)));
  assert.equal(ld.image.length, 3);
  for (const [i, ratio] of ['1x1', '4x3', '16x9'].entries()) {
    assert.match(ld.image[i], new RegExp(`/capa/${r.code}-${ratio}\\.jpg`));
    const res = await fetch(ld.image[i].replace(/^https?:\/\/[^/]+/, base));
    assert.equal(res.headers.get('content-type'), 'image/jpeg');
    const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
    assert.equal(meta.format, 'jpeg');
    assert.ok(meta.width * meta.height >= 50000);
    assert.equal(Math.round((meta.width / meta.height) * 100), { '1x1': 100, '4x3': 133, '16x9': 178 }[ratio]);
  }
  assert.doesNotMatch(JSON.stringify(ld.image), /\.svg/);
  assert.match(html, new RegExp(`<meta property="og:image" content="[^"]*/capa/${r.code}-16x9\\.jpg`));
  const sm = await (await fetch(`${base}/sitemap.xml`)).text();
  assert.match(sm, new RegExp(`/capa/${r.code}-1x1\\.jpg</image:loc>`));
  assert.equal((await fetch(`${base}/capa/${r.code}-3x2.jpg`)).status, 404);
  const short = await fetch(`${base}/c/${r.code}`, { redirect: 'manual' });
  assert.equal(short.status, 301, 'link curto passa relevância (301)');
});

test('tags: só listas com 8+ receitas vão para o Google e para o sitemap (as curtas ficam noindex)', async () => {
  const recipes = require('../src/recipes');
  for (let i = 0; i < 8; i++) recipes.create({ title: `Doce de festa ${i}`, ingredients: 'a\nb', steps: 'x\ny', tags: ['festa-junina', ...(i < 2 ? ['raridade'] : [])], status: 'published' }, null);
  const big = await (await fetch(`${base}/tag/festa-junina`)).text();
  assert.match(big, /<meta name="robots" content="index/);
  const small = await (await fetch(`${base}/tag/raridade`)).text();
  assert.match(small, /<meta name="robots" content="noindex, follow"/);
  const sm = await (await fetch(`${base}/sitemap.xml`)).text();
  assert.match(sm, /\/tag\/festa-junina</);
  assert.doesNotMatch(sm, /\/tag\/raridade</);
});
