'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chef-test-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.UPLOADS_DIR = path.join(tmp, 'uploads');
process.env.IMPORT_ALLOW_PRIVATE = '1';

const db = require('../src/db');
const { createApp } = require('../src/app');
const settings = require('../src/settings');

let server;
let base;
let cookie = '';
let apiKey = '';

async function req(method, url, { body, headers = {}, auth = 'cookie', raw = false } = {}) {
  const h = { ...headers };
  if (auth === 'cookie' && cookie) h.cookie = cookie;
  if (auth === 'key' && apiKey) h.authorization = `Bearer ${apiKey}`;
  let payload = body;
  if (body && !(body instanceof FormData) && typeof body !== 'string') {
    payload = JSON.stringify(body);
    h['content-type'] = 'application/json';
  }
  const res = await fetch(base + url, { method, headers: h, body: payload, redirect: 'manual' });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie && setCookie.startsWith('chef_session=')) cookie = setCookie.split(';')[0];
  if (raw) return res;
  const type = res.headers.get('content-type') || '';
  return { status: res.status, headers: res.headers, data: type.includes('json') ? await res.json() : await res.text() };
}

test.before(async () => {
  db.open(':memory:');
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.close();
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('configuração inicial cria o administrador e bloqueia uma segunda vez', async () => {
  const r = await req('POST', '/api/v1/auth/setup', { body: { email: 'eu@exemplo.com', name: 'Jorge', password: 'segredo123', siteName: 'Cozinha Teste' } });
  assert.equal(r.status, 201);
  assert.equal(r.data.user.role, 'admin');
  assert.equal(settings.all().siteName, 'Cozinha Teste');
  const again = await req('POST', '/api/v1/auth/setup', { body: { email: 'x@y.com', password: '12345678' }, auth: 'none' });
  assert.equal(again.status, 409);
});

test('login com senha errada falha e com a certa funciona', async () => {
  const bad = await req('POST', '/api/v1/auth/login', { body: { email: 'eu@exemplo.com', password: 'errada000' }, auth: 'none' });
  assert.equal(bad.status, 401);
  const ok = await req('POST', '/api/v1/auth/login', { body: { email: 'eu@exemplo.com', password: 'segredo123' } });
  assert.equal(ok.status, 200);
});

test('escrita sem autenticação é negada', async () => {
  const r = await req('POST', '/api/v1/recipes', { body: { title: 'X' }, auth: 'none' });
  assert.equal(r.status, 401);
});

test('chave de API permite criar receitas', async () => {
  const k = await req('POST', '/api/v1/keys', { body: { name: 'testes' } });
  assert.equal(k.status, 201);
  apiKey = k.data.key;
  const r = await req('POST', '/api/v1/recipes', {
    auth: 'key',
    body: {
      title: 'Bolo de Cenoura',
      code: 'bolo-01',
      category: 'Bolos',
      ingredients: '## Massa\n3 cenouras\n2 ½ xícaras (chá) de farinha de trigo\n1 colher (sopa) de fermento\n## Cobertura\n1 lata de leite condensado',
      steps: '1. Bata tudo no liquidificador por 3 minutos.\n2. Asse por 40 minutos.',
      tags: 'bolo, café da tarde',
      prep_minutes: 20, cook_minutes: 40, servings: 12, status: 'published',
      video: 'https://youtu.be/abcdefghijk',
    },
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.code, 'BOLO01');
  assert.equal(r.data.category.name, 'Bolos');
  assert.equal(r.data.ingredients.length, 4);
  assert.deepEqual(r.data.ingredients[1], { raw: '2 ½ xícaras (chá) de farinha de trigo', quantity: 2.5, quantityMax: null, unit: 'xícara', name: 'farinha de trigo', note: '', group: 'Massa' });
  assert.equal(r.data.steps[0].text, 'Bata tudo no liquidificador por 3 minutos.');
  assert.equal(r.data.steps[0].timer, 180);
  assert.equal(r.data.steps[1].timer, 2400);
  assert.equal(r.data.video.type, 'youtube');
  assert.equal(r.data.total_minutes, 60);
});

test('código duplicado é recusado', async () => {
  const r = await req('POST', '/api/v1/recipes', { auth: 'key', body: { title: 'Outro', code: 'BOLO01' } });
  assert.equal(r.status, 409);
});

test('busca por palavra-chave ignora acentos e acha por ingrediente', async () => {
  await req('POST', '/api/v1/recipes', { auth: 'key', body: { title: 'Pão de açúcar caseiro', ingredients: '500 g de farinha\n2 colheres de açúcar', steps: 'Misture.', status: 'published' } });
  await req('POST', '/api/v1/recipes', { auth: 'key', body: { title: 'Rascunho secreto', ingredients: 'cenoura', steps: 'x', status: 'draft' } });
  let r = await req('GET', '/api/v1/recipes?q=acucar', { auth: 'none' });
  assert.deepEqual(r.data.items.map((i) => i.title), ['Pão de açúcar caseiro']);
  r = await req('GET', '/api/v1/recipes?q=cenoura', { auth: 'none' });
  assert.deepEqual(r.data.items.map((i) => i.title), ['Bolo de Cenoura'], 'rascunhos não aparecem para visitantes');
  r = await req('GET', '/api/v1/recipes?ingredients=cenoura,farinha', { auth: 'none' });
  assert.deepEqual(r.data.items.map((i) => i.code), ['BOLO01']);
});

test('busca por código: exata, com # e com hífen', async () => {
  let r = await req('GET', '/api/v1/recipes?q=%23bolo01', { auth: 'none' });
  assert.equal(r.data.exactCode.code, 'BOLO01');
  assert.equal(r.data.items[0].code, 'BOLO01');
  r = await req('GET', '/api/v1/recipes/code/bolo-01', { auth: 'none' });
  assert.equal(r.status, 200);
  r = await req('GET', '/api/v1/recipes/BOLO01', { auth: 'none' });
  assert.equal(r.data.title, 'Bolo de Cenoura');
  r = await req('GET', '/c/BOLO01', { auth: 'none' });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/receita/bolo-de-cenoura');
  r = await req('GET', '/busca?q=%23BOLO01', { auth: 'none' });
  assert.equal(r.status, 302);
  r = await req('GET', '/api/v1/search/suggest?q=BOL', { auth: 'none' });
  assert.ok(r.data.items.some((i) => i.code === 'BOLO01'));
});

test('página da receita tem JSON-LD, código e modo cozinha', async () => {
  const r = await req('GET', '/receita/bolo-de-cenoura', { auth: 'none' });
  assert.equal(r.status, 200);
  assert.match(r.data, /"@type":"Recipe"/);
  assert.match(r.data, /#BOLO01/);
  assert.match(r.data, /data-cook-start/);
  assert.match(r.data, /data-timer="2400"/);
  assert.match(r.data, /2 ½ xícaras de/);
  const ld = JSON.parse(r.data.match(/<script nonce="[^"]+" type="application\/ld\+json">(.*?)<\/script>/s)[1]);
  assert.equal(ld.totalTime, 'PT1H');
  assert.equal(ld.recipeInstructions.length, 2);
  const qr = await req('GET', '/qr/BOLO01.svg', { auth: 'none' });
  assert.match(qr.data, /<svg/);
});

test('atualização parcial, duplicação e exclusão', async () => {
  let r = await req('PATCH', '/api/v1/recipes/BOLO01', { auth: 'key', body: { description: 'Fofinho', featured: true } });
  assert.equal(r.data.description, 'Fofinho');
  assert.equal(r.data.featured, true);
  assert.equal(r.data.ingredients.length, 4, 'campos não enviados permanecem');
  r = await req('POST', '/api/v1/recipes/BOLO01/duplicate', { auth: 'key' });
  assert.equal(r.status, 201);
  assert.equal(r.data.status, 'draft');
  assert.notEqual(r.data.code, 'BOLO01');
  r = await req('DELETE', `/api/v1/recipes/${r.data.id}`, { auth: 'key' });
  assert.equal(r.data.ok, true);
});

test('comentários: moderação, honeypot e nota média', async () => {
  let r = await req('POST', '/api/v1/recipes/BOLO01/comments', { auth: 'none', body: { name: 'Ana', body: 'Ficou ótimo!', rating: 5 } });
  assert.equal(r.status, 201);
  assert.equal(r.data.pending, true);
  const spam = await req('POST', '/api/v1/recipes/BOLO01/comments', { auth: 'none', body: { name: 'Bot', body: 'spam', website: 'http://spam' } });
  assert.equal(spam.status, 201);
  const pending = await req('GET', '/api/v1/comments?status=pending');
  assert.equal(pending.data.items.length, 1);
  await req('PATCH', `/api/v1/comments/${pending.data.items[0].id}`, { body: { status: 'approved' } });
  r = await req('GET', '/api/v1/recipes/BOLO01', { auth: 'none' });
  assert.deepEqual(r.data.rating, { average: 5, count: 1 });
});

test('upload de imagem e bloqueio de tipos inválidos', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  let fd = new FormData();
  fd.append('files', new Blob([png], { type: 'image/png' }), 'foto.png');
  let r = await req('POST', '/api/v1/uploads', { auth: 'key', body: fd });
  assert.equal(r.status, 201);
  assert.match(r.data.files[0].url, /^\/uploads\/.+\.png$/);
  const file = await req('GET', r.data.files[0].url, { auth: 'none', raw: true });
  assert.equal(file.status, 200);
  fd = new FormData();
  fd.append('files', new Blob(['<script>'], { type: 'text/html' }), 'x.html');
  r = await req('POST', '/api/v1/uploads', { auth: 'key', body: fd });
  assert.equal(r.status, 415);
});

test('afiliados Amazon: tag automática, contagem de cliques e botão no ingrediente', async () => {
  await req('PUT', '/api/v1/settings', { body: { amazonTag: 'meusite-20' } });
  const p = await req('POST', '/api/v1/products', { body: { title: 'Leite condensado 395g', url: 'https://www.amazon.com.br/dp/B012345678?ref=x', keywords: 'leite condensado' } });
  assert.equal(p.status, 201);
  assert.equal(p.data.asin, 'B012345678');
  const go = await req('GET', `/go/${p.data.id}`, { auth: 'none' });
  assert.equal(go.status, 302);
  assert.equal(new URL(go.headers.get('location')).searchParams.get('tag'), 'meusite-20');
  const page = await req('GET', '/receita/bolo-de-cenoura', { auth: 'none' });
  assert.match(page.data, new RegExp(`class="ing-buy" href="/go/${p.data.id}"`));
  await req('PATCH', '/api/v1/recipes/BOLO01', { auth: 'key', body: { products: [p.data.id] } });
  const page2 = await req('GET', '/receita/bolo-de-cenoura', { auth: 'none' });
  assert.match(page2.data, /class="product-card"/);
  assert.match(page2.data, /rel="sponsored noopener nofollow"/);
});

test('anúncios aparecem na posição configurada', async () => {
  const a = await req('POST', '/api/v1/ads', { body: { name: 'Topo', slot: 'recipe_top', html: '<div id="meu-banner">Anúncio</div>' } });
  assert.equal(a.status, 201);
  const page = await req('GET', '/receita/bolo-de-cenoura', { auth: 'none' });
  assert.match(page.data, /<div id="meu-banner">/);
  await req('PUT', '/api/v1/settings', { body: { adsEnabled: false } });
  const page2 = await req('GET', '/receita/bolo-de-cenoura', { auth: 'none' });
  assert.doesNotMatch(page2.data, /meu-banner/);
  await req('PUT', '/api/v1/settings', { body: { adsEnabled: true, adsenseClient: 'ca-pub-1234567890123456' } });
  const adsTxt = await req('GET', '/ads.txt', { auth: 'none' });
  assert.match(adsTxt.data, /pub-1234567890123456/);
});

test('importação por URL a partir de JSON-LD', async () => {
  const html = `<html><head><meta property="og:site_name" content="Site Exemplo"><script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [{ '@type': 'WebPage' }, {
      '@type': 'Recipe', name: 'Torta de Limão', description: 'Azedinha', image: ['/img/torta.jpg'],
      recipeIngredient: ['1 pacote de biscoito', '100 g de manteiga', '1 lata de leite condensado'],
      recipeInstructions: [{ '@type': 'HowToSection', name: 'Base', itemListElement: [{ '@type': 'HowToStep', text: 'Triture o biscoito.' }] }, { '@type': 'HowToStep', text: 'Leve à geladeira por 2 horas.' }],
      prepTime: 'PT20M', totalTime: 'PT2H20M', recipeYield: '8 fatias', recipeCategory: 'Sobremesas', keywords: 'torta, limão',
    }],
  })}</script></head><body></body></html>`;
  const site = http.createServer((q, s) => { s.setHeader('content-type', 'text/html'); s.end(html); }).listen(0);
  await new Promise((r) => site.once('listening', r));
  try {
    const url = `http://127.0.0.1:${site.address().port}/receita`;
    const prev = await req('POST', '/api/v1/import', { auth: 'key', body: { url, downloadImages: false } });
    assert.equal(prev.status, 200, JSON.stringify(prev.data));
    const d = prev.data.preview;
    assert.equal(d.title, 'Torta de Limão');
    assert.equal(d._method, 'json-ld');
    assert.equal(d.cover, `http://127.0.0.1:${site.address().port}/img/torta.jpg`);
    assert.equal(d.steps[0].group, 'Base');
    assert.equal(d.prep_minutes, 20);
    assert.equal(d.cook_minutes, 120);
    assert.equal(d.servings, 8);
    assert.equal(d.servings_unit, 'fatias');
    const saved = await req('POST', '/api/v1/import', { auth: 'key', body: { url, save: true, status: 'published', downloadImages: false } });
    assert.equal(saved.status, 201);
    assert.equal(saved.data.category.name, 'Sobremesas');
    assert.equal(saved.data.steps[1].timer, 7200);
    assert.equal(saved.data.source_name, 'Site Exemplo');
  } finally {
    site.close();
  }
});

test('importador: heurística para páginas sem dados estruturados', () => {
  const { parseHtml } = require('../src/importer');
  const d = parseHtml('<html><head><title>Arroz</title></head><body><h1>Arroz soltinho</h1><h2>Ingredientes</h2><ul><li>2 xícaras de arroz</li><li>4 xícaras de água</li></ul><h2>Modo de preparo</h2><ol><li>Refogue o arroz.</li><li>Cozinhe por 15 minutos.</li></ol></body></html>', 'https://x.com/a');
  assert.equal(d._method, 'heuristic');
  assert.equal(d.title, 'Arroz soltinho');
  assert.deepEqual(d.ingredients, ['2 xícaras de arroz', '4 xícaras de água']);
  assert.equal(d.steps.length, 2);
});

test('importador bloqueia endereços internos (SSRF)', async () => {
  const { assertPublicUrl, isPrivateIp } = require('../src/importer');
  assert.ok(isPrivateIp('127.0.0.1') && isPrivateIp('10.1.2.3') && isPrivateIp('192.168.0.1') && isPrivateIp('::1') && isPrivateIp('169.254.169.254'));
  assert.ok(!isPrivateIp('8.8.8.8'));
  delete process.env.IMPORT_ALLOW_PRIVATE;
  await assert.rejects(assertPublicUrl('http://127.0.0.1/'), /não permitido/);
  await assert.rejects(assertPublicUrl('file:///etc/passwd'), /http/);
  process.env.IMPORT_ALLOW_PRIVATE = '1';
});

test('exportação e importação em lote (backup)', async () => {
  const exp = await req('GET', '/api/v1/export', { auth: 'key' });
  assert.ok(exp.data.count >= 3);
  const imp = await req('POST', '/api/v1/import/json', { auth: 'key', body: { items: exp.data.items.slice(0, 2) } });
  assert.equal(imp.status, 201);
  assert.equal(imp.data.created, 2);
  assert.notEqual(imp.data.items[0].code, exp.data.items[0].code, 'códigos repetidos são regenerados');
});

test('SEO e PWA: sitemap, feed, robots, manifest e service worker', async () => {
  const sm = await req('GET', '/sitemap.xml', { auth: 'none' });
  assert.match(sm.data, /\/receita\/bolo-de-cenoura/);
  const feed = await req('GET', '/feed.xml', { auth: 'none' });
  assert.match(feed.data, /<rss/);
  const man = await req('GET', '/manifest.webmanifest', { auth: 'none' });
  const m = man.data;
  assert.equal(m.display, 'standalone');
  assert.ok(m.icons.some((i) => i.purpose === 'maskable'));
  assert.ok(m.share_target);
  const sw = await req('GET', '/sw.js', { auth: 'none' });
  assert.equal(sw.headers.get('service-worker-allowed'), '/');
  for (const p of ['/', '/receitas', '/categorias', '/favoritos', '/lista', '/planejador', '/geladeira', '/conversor', '/sobre', '/api/docs', '/offline']) {
    assert.equal((await req('GET', p, { auth: 'none' })).status, 200, p);
  }
  for (const p of ['/admin', '/admin/receitas', '/admin/receitas/nova', '/admin/importar', '/admin/produtos', '/admin/anuncios', '/admin/configuracoes', '/admin/api', '/admin/comentarios', '/admin/categorias', '/admin/usuarios']) {
    assert.equal((await req('GET', p)).status, 200, p);
  }
});

test('proteção CSRF recusa origem diferente em requisição com cookie', async () => {
  const r = await req('POST', '/api/v1/recipes', { body: { title: 'X' }, headers: { origin: 'https://malicioso.com' } });
  assert.equal(r.status, 403);
});
