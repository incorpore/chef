'use strict';
/** Afiliados por link (Amazon, Shopee, Mercado Livre), atualização automática, utensílios e vitrine da receita. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chef-aff-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.UPLOADS_DIR = path.join(tmp, 'uploads');
process.env.RATE_LIMIT = 'off';
process.env.PAGE_CACHE_SECONDS = '0';
process.env.IMPORT_ALLOW_PRIVATE = '1';
delete process.env.SHOPEE_APP_ID;
delete process.env.SHOPEE_SECRET;

const db = require('../src/db');
const auth = require('../src/auth');
const shopee = require('../src/shopee');
const affiliates = require('../src/affiliates');
const utensils = require('../src/utensils');
const { createApp } = require('../src/app');

const PASS = `Pw-${crypto.randomBytes(8).toString('hex')}`;
const APP_ID = '18312345678';
const SECRET = 'SecretAbcdef0123456789XYZ';
const seen = { shopee: [], amazonUA: '' };
let price = '1.299,90';
let F;

const amazonHtml = () => `<html><head><title>Amazon.com.br : Batedeira</title><meta property="og:title" content="x"></head><body>
  <span id="productTitle"> Batedeira Planetária Turbo 700W </span>
  <img id="landingImage" data-old-hires="https://m.media-amazon.com/images/I/batedeira.jpg">
  <div id="corePrice_feature_div"><span class="a-price"><span class="a-offscreen">R$ ${price}</span></span></div>
  <div id="availability"><span>Em estoque</span></div></body></html>`;

function fakeStores(req, res) {
  const url = new URL(req.url, F);
  const send = (body, type = 'text/html; charset=utf-8', code = 200) => { res.writeHead(code, { 'content-type': type }); res.end(body); };
  if (url.pathname.startsWith('/dp/')) {
    seen.amazonUA = req.headers['user-agent'];
    if (url.pathname.endsWith('B0CAPTCHA1')) return send('<html><head><title>Amazon.com.br</title></head><body><form action="/errors/validateCaptcha"></form></body></html>');
    return send(amazonHtml());
  }
  if (url.pathname === '/amzn-short') { res.writeHead(301, { location: `${F}/Forma-Redonda-Antiaderente-25cm/dp/B0FORMA251?tag=x` }); return res.end(); }
  if (url.pathname.startsWith('/Forma-Redonda')) return send('<html>ok</html>');
  if (url.pathname.startsWith('/ml/')) {
    return send(`<html><head><meta property="og:title" content="Liquidificador Turbo 12 Velocidades | Mercado Livre"><meta property="og:image" content="https://http2.mlstatic.com/liquidificador.jpg">
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Liquidificador Turbo 12 Velocidades","offers":{"@type":"Offer","price":189.9,"availability":"https://schema.org/InStock"}}</script></head></html>`);
  }
  if (url.pathname === '/graphql') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const m = String(req.headers.authorization).match(/^SHA256 Credential=(\d+), Timestamp=(\d+), Signature=([a-f0-9]{64})$/);
      const ok = m && m[1] === APP_ID && crypto.createHash('sha256').update(`${m[1]}${m[2]}${body}${SECRET}`).digest('hex') === m[3];
      const q = JSON.parse(body);
      seen.shopee.push(q);
      if (!ok) return send(JSON.stringify({ errors: [{ message: 'Invalid Signature', extensions: { code: 10020 } }] }), 'application/json');
      if (/generateShortLink/.test(q.query)) return send(JSON.stringify({ data: { generateShortLink: { shortLink: 'https://s.shopee.com.br/abc123' } } }), 'application/json');
      const kw = q.variables.keyword || '';
      const node = (i, name) => ({ itemId: 900 + i, shopId: 77, productName: name, imageUrl: `https://cf.shopee.com.br/file/${i}`, priceMin: '49.90', priceMax: '59.90', offerLink: `https://s.shopee.com.br/off${i}`, productLink: `https://shopee.com.br/product/77/${900 + i}`, shopName: 'Loja', commissionRate: '0.08', sales: 1000, ratingStar: '4.8' });
      const nodes = q.variables.itemId ? [node(q.variables.itemId - 900, 'Fouet de Silicone Profissional')]
        : /forma de bolo 25/.test(kw) ? [node(1, 'Forma Redonda Antiaderente 25 cm')]
          : /micro-ondas/.test(kw) ? [node(2, 'Pote de Vidro para Micro-ondas')]
            : /panela|cozinha|facas|potes|organizador|tábua|kit/.test(kw) ? [node(3 + kw.length, `Kit cozinha ${kw}`)] : [];
      send(JSON.stringify({ data: { productOfferV2: { nodes } } }), 'application/json');
    });
    return undefined;
  }
  send('not found', 'text/plain', 404);
}

let server;
let fake;
let base;
function client() {
  let cookie = '';
  return {
    async req(method, url, body) {
      const h = {};
      if (cookie) h.cookie = cookie;
      if (body) h['content-type'] = 'application/json';
      const res = await fetch(base + url, { method, headers: h, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
      const sc = res.headers.get('set-cookie');
      if (sc && /^chef_session=/.test(sc)) cookie = sc.split(';')[0];
      const text = await res.text();
      let data = text; try { data = JSON.parse(text); } catch { /* html */ }
      return { status: res.status, data, text, headers: res.headers };
    },
  };
}
const admin = client();
const author = client();
let recipe;

test.before(async () => {
  fake = http.createServer(fakeStores).listen(0);
  await new Promise((r) => fake.once('listening', r));
  F = `http://127.0.0.1:${fake.address().port}`;
  affiliates.endpoints.amazonPage = (asin) => `${F}/dp/${asin}`;
  affiliates.endpoints.shopeePage = () => `${F}/nada`;
  affiliates.hostAlias.set(new URL(F).host, 'amazon');
  shopee.endpoints.graphql = `${F}/graphql`;
  shopee.limits.gapMs = 0;
  db.open(':memory:');
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  auth.createUser({ email: 'adm@exemplo.com', name: 'Adm', password: PASS, role: 'admin' });
  auth.createUser({ email: 'aut@exemplo.com', name: 'Aut', password: PASS, role: 'author' });
  await admin.req('POST', '/api/v1/auth/login', { email: 'adm@exemplo.com', password: PASS });
  await author.req('POST', '/api/v1/auth/login', { email: 'aut@exemplo.com', password: PASS });
  recipe = (await admin.req('POST', '/api/v1/recipes', {
    title: 'Bolo de fubá', ingredients: '2 xícaras de fubá\n3 ovos\n1 xícara de leite', status: 'published',
    steps: 'Bata tudo no liquidificador.\nDespeje em uma forma redonda de 25 cm untada.\nMisture de forma homogênea a cobertura e leve ao micro-ondas por 1 minuto.',
  })).data;
  await admin.req('POST', '/api/v1/recipes', { title: 'Salada simples', ingredients: 'alface\ntomate\nsal', steps: 'Lave as folhas.\nTempere.\nSirva.', status: 'published' });
});
test.after(() => { server.close(); fake.close(); db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('utensílios: detecta no preparo (com tamanho da forma) e ignora "de forma homogênea"', () => {
  const found = utensils.detect({ steps: [{ text: 'Bata no liquidificador. Despeje em uma forma redonda de 25 cm.' }, { text: 'Misture de forma homogênea e leve ao micro-ondas.' }], ingredients: [] });
  assert.deepEqual(found.map((f) => f.key), ['micro-ondas', 'liquidificador', 'forma:25']);
  assert.equal(found[2].label, 'Forma 25 cm');
  assert.deepEqual(utensils.detectText('Misture de forma homogênea'), []);
  assert.equal(utensils.guess('Forma Redonda Antiaderente 25cm Fundo Removível'), 'forma:25');
  assert.equal(utensils.guess('Liquidificador Philco 1200W'), 'liquidificador');
});

test('Amazon: colar o link preenche título, foto, preço e utensílio; só admin', async () => {
  assert.equal((await author.req('POST', '/api/v1/products/preview', { url: 'B0BATEDOR1' })).status, 403);
  const r = await admin.req('POST', '/api/v1/products/preview', { url: `${F}/Batedeira-Planetaria/dp/B0BATEDOR1?ref=abc` });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.store, 'amazon');
  assert.equal(r.data.asin, 'B0BATEDOR1');
  assert.equal(r.data.title, 'Batedeira Planetária Turbo 700W');
  assert.equal(r.data.image, 'https://m.media-amazon.com/images/I/batedeira.jpg');
  assert.equal(r.data.priceValue, 1299.9);
  assert.equal(r.data.price, 'R$ 1.299,90');
  assert.equal(r.data.utensil, 'batedeira');
  assert.equal(r.data.url, 'https://www.amazon.com.br/dp/B0BATEDOR1');
  assert.match(seen.amazonUA, /Chrome/);
  // link curto (amzn.to) → segue o redirecionamento até o ASIN
  const s = await admin.req('POST', '/api/v1/products/preview', { url: `${F}/amzn-short` });
  assert.equal(s.data.asin, 'B0FORMA251');
  // Amazon bloqueou (captcha) → usa o link e a foto padrão do ASIN, com aviso
  const c = await admin.req('POST', '/api/v1/products/preview', { url: 'B0CAPTCHA1' });
  assert.equal(c.data.title, 'Produto Amazon B0CAPTCHA1');
  assert.match(c.data.image, /images\/P\/B0CAPTCHA1/);
  assert.equal(c.data.warn.length, 1);
});

test('salvar, não duplicar, /go com tag e atualização de preço', async () => {
  await admin.req('PUT', '/api/v1/settings', { amazonTag: 'meusite-20' });
  const pv = (await admin.req('POST', '/api/v1/products/preview', { url: 'B0BATEDOR1' })).data;
  const body = { store: pv.store, external_id: pv.externalId, source_url: pv.source, aff_url: pv.affUrl, asin: pv.asin, price_value: pv.priceValue, title: pv.title, price: pv.price, image: pv.image, url: pv.url, utensil: pv.utensil };
  const saved = await admin.req('POST', '/api/v1/products', body);
  assert.equal(saved.status, 201, saved.text);
  assert.equal((await admin.req('POST', '/api/v1/products', body)).status, 409);
  assert.ok((await admin.req('POST', '/api/v1/products/preview', { url: 'B0BATEDOR1' })).data.duplicate);
  const go = await admin.req('GET', `/go/${saved.data.id}`);
  assert.equal(go.status, 302);
  assert.equal(go.headers.get('location'), 'https://www.amazon.com.br/dp/B0BATEDOR1?tag=meusite-20');
  price = '999,00';
  const ref = await admin.req('POST', `/api/v1/products/${saved.data.id}/refresh`);
  assert.equal(ref.data.price, 'R$ 999,00');
  assert.equal(ref.data.refresh_error, '');
  assert.equal(ref.data.title, 'Batedeira Planetária Turbo 700W'); // título editado não é sobrescrito
  // vencidos entram na fila de atualização automática
  db.get().prepare("UPDATE products SET refreshed_at = datetime('now', '-30 hours') WHERE id = ?").run(saved.data.id);
  assert.equal(affiliates.due().length, 1);
  db.get().prepare("UPDATE products SET refreshed_at = datetime('now') WHERE id = ?").run(saved.data.id);
  assert.equal(affiliates.due().length, 0);
});

test('Mercado Livre: link de afiliado + dados da página (JSON-LD)', async () => {
  affiliates.hostAlias.set(new URL(F).host, 'mercadolivre');
  try {
    const r = await admin.req('POST', '/api/v1/products/preview', { url: `${F}/ml/MLB-3456789012-liquidificador-turbo-_JM?matt_tool=123&matt_word=chef` });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.data.store, 'mercadolivre');
    assert.equal(r.data.externalId, 'MLB3456789012');
    assert.equal(r.data.title, 'Liquidificador Turbo 12 Velocidades');
    assert.equal(r.data.priceValue, 189.9);
    assert.equal(r.data.image, 'https://http2.mlstatic.com/liquidificador.jpg');
    assert.match(r.data.affUrl, /matt_tool=123/);
    assert.equal(r.data.utensil, 'liquidificador');
    assert.deepEqual(r.data.warn, []);
    const plain = await admin.req('POST', '/api/v1/products/preview', { url: `${F}/ml/MLB-3456789012-liquidificador` });
    assert.equal(plain.data.affUrl, '');
    assert.match(plain.data.warn[0], /afiliado/);
  } finally { affiliates.hostAlias.set(new URL(F).host, 'amazon'); }
});

test('Shopee: credenciais protegidas, assinatura correta, link de comissão', async () => {
  assert.equal((await admin.req('PUT', '/api/v1/affiliates/shopee', { appId: 'abc', secret: SECRET })).status, 400);
  assert.equal((await author.req('PUT', '/api/v1/affiliates/shopee', { appId: APP_ID, secret: SECRET })).status, 403);
  let st = await admin.req('PUT', '/api/v1/affiliates/shopee', { appId: APP_ID, secret: 'Errada0123456789' });
  assert.equal(st.data.configured, true);
  const bad = await admin.req('POST', '/api/v1/affiliates/shopee/test');
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /assinatura/);
  st = await admin.req('PUT', '/api/v1/affiliates/shopee', { appId: APP_ID, secret: SECRET });
  assert.doesNotMatch(JSON.stringify(st.data), new RegExp(SECRET));
  assert.equal(fs.statSync(path.join(process.env.DATA_DIR, 'shopee.json')).mode & 0o777, 0o600);
  assert.equal((await admin.req('POST', '/api/v1/affiliates/shopee/test')).data.ok, true);
  const status = await admin.req('GET', '/api/v1/affiliates/status');
  assert.doesNotMatch(JSON.stringify(status.data), new RegExp(SECRET));

  const r = await admin.req('POST', '/api/v1/products/preview', { url: 'https://shopee.com.br/Fouet-de-Silicone-i.77.905' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.store, 'shopee');
  assert.equal(r.data.externalId, '77.905');
  assert.equal(r.data.title, 'Fouet de Silicone Profissional');
  assert.equal(r.data.affUrl, 'https://s.shopee.com.br/off5');
  assert.equal(r.data.price, 'R$ 49,90');
  assert.equal(r.data.utensil, 'fouet');
  const q = seen.shopee.at(-1);
  assert.deepEqual([q.variables.shopId, q.variables.itemId], [77, 905]);
  const saved = await admin.req('POST', '/api/v1/products', { store: 'shopee', external_id: r.data.externalId, source_url: r.data.source, aff_url: r.data.affUrl, title: r.data.title, price: r.data.price, image: r.data.image, url: r.data.url, utensil: r.data.utensil });
  assert.equal(saved.status, 201, saved.text);
  const go = await admin.req('GET', `/go/${saved.data.id}`);
  assert.equal(go.headers.get('location'), 'https://s.shopee.com.br/off5');
});

test('utensílios automáticos (Shopee) e vitrine da receita com plano B "cozinha"', async () => {
  const before = await admin.req('GET', '/api/v1/affiliates/status');
  const cov = before.data.coverage;
  assert.ok(cov.items.some((x) => x.key === 'forma:25' && !x.covered));
  assert.ok(cov.items.some((x) => x.key === 'liquidificador' && !x.covered));
  const fill = await admin.req('POST', '/api/v1/affiliates/utensils/fill');
  assert.equal(fill.status, 200, fill.text);
  const titles = fill.data.added.map((a) => a.title);
  assert.ok(titles.includes('Forma Redonda Antiaderente 25 cm'));
  assert.ok(titles.includes('Pote de Vidro para Micro-ondas'));
  assert.ok(fill.data.added.some((a) => a.utensil === 'Cozinha'));
  // não repete a mesma busca logo em seguida
  const n = seen.shopee.length;
  await admin.req('POST', '/api/v1/affiliates/utensils/fill');
  assert.ok(seen.shopee.length - n <= 2);

  const page = await admin.req('GET', `/receita/${recipe.slug}`);
  assert.match(page.text, /Utensílios desta receita/);
  assert.match(page.text, /Para: Forma 25 cm/);
  assert.match(page.text, /Ver na Shopee/);
  assert.match(page.text, /Alguns links são de afiliados/);
  // receita sem utensílio → vitrine geral "cozinha"
  const salada = await admin.req('GET', '/receita/salada-simples');
  assert.match(salada.text, /Para a sua cozinha/);
  assert.match(salada.text, /Kit cozinha/);
});

test('painel: página nova, ações em massa e produto desativado some do site', async () => {
  const page = await admin.req('GET', '/admin/produtos');
  assert.match(page.text, /Adicionar produto pelo link/);
  assert.match(page.text, /\/js\/products\.js/);
  assert.equal((await author.req('GET', '/admin/produtos')).status, 403);
  const list = (await admin.req('GET', '/api/v1/products')).data.items;
  const auto = list.filter((p) => p.auto);
  const r = await admin.req('POST', '/api/v1/products/bulk', { ids: auto.map((p) => p.id), action: 'deactivate' });
  assert.equal(r.data.count, auto.length);
  assert.equal((await admin.req('POST', '/api/v1/products/bulk', { ids: [1], action: 'hack' })).status, 400);
  const pageAfter = await admin.req('GET', `/receita/${recipe.slug}`);
  assert.doesNotMatch(pageAfter.text, /Para: Forma 25 cm/);
  assert.equal((await admin.req('GET', `/go/${auto[0].id}`)).status, 404);
});
