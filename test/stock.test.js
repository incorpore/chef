'use strict';
/** Fotos automáticas: chaves, busca no Pexels/Pixabay, download seguro, crédito do fotógrafo e modo automático. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const sharp = require('sharp');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chef-stock-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.UPLOADS_DIR = path.join(tmp, 'uploads');
process.env.RATE_LIMIT = 'off';
delete process.env.PEXELS_API_KEY;
delete process.env.PIXABAY_API_KEY;

const db = require('../src/db');
const auth = require('../src/auth');
const stock = require('../src/stock');
const { createApp } = require('../src/app');

const PASS = `Pw-${crypto.randomBytes(8).toString('hex')}`;
const PEXELS_KEY = 'pexelsKEY1234567890abcdef';
const PIXABAY_KEY = '12345678-abcdef0123456789abcdef01';
const seen = { pexelsAuth: [], pixabayKeys: [], queries: [] };
let jpg;
let fake;
let F;
function fakeBanks(req, res) {
  const url = new URL(req.url, F);
  const json = (o, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (url.pathname === '/pexels') {
    seen.pexelsAuth.push(req.headers.authorization); seen.queries.push(url.searchParams.get('query'));
    if (/nada/.test(url.searchParams.get('query'))) return json({ photos: [] });
    // como no Pexels real: a 1ª foto nem sempre é a melhor; a descrição (alt) diz o que aparece
    const alts = ['Woman cooking in a kitchen', /cake/.test(url.searchParams.get('query')) ? 'Slice of carrot cake with frosting' : 'Bowl of black bean stew'];
    return json({ photos: [1, 2].map((i) => ({ id: 100 + i, width: 1600, height: 1200, photographer: i === 2 ? 'Ana Lima' : 'Bruno Costa', photographer_url: 'https://www.pexels.com/@ana', url: `https://www.pexels.com/photo/${100 + i}/`, alt: alts[i - 1], src: { medium: `${F}/img/p${i}.jpg`, large2x: `${F}/img/p${i}.jpg` } })) });
  }
  if (url.pathname === '/pixabay') {
    seen.pixabayKeys.push(url.searchParams.get('key'));
    seen.pixabayLang = url.searchParams.get('lang');
    if (/nada/.test(url.searchParams.get('q'))) return json({ hits: [] });
    const tags = /flan/.test(url.searchParams.get('q')) ? 'flan, caramel, dessert' : /sorvete/.test(url.searchParams.get('q')) ? 'kitchen, table' : 'food, table';
    return json({ hits: [{ id: 555, imageWidth: 1280, imageHeight: 853, webformatURL: `${F}/img/x.jpg`, previewURL: `${F}/img/x-prev.jpg`, largeImageURL: `${F}/img/x.jpg`, user: 'chefpix', user_id: 9, pageURL: 'https://pixabay.com/photos/555/', tags }] });
  }
  if (url.pathname.startsWith('/img/')) { res.writeHead(200, { 'content-type': 'image/jpeg' }); return res.end(jpg); }
  if (url.pathname === '/html') { res.writeHead(200, { 'content-type': 'image/jpeg' }); return res.end('<html><script>alert(1)</script>'); }
  json({ error: 'not found' }, 404);
}

let server;
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
      return { status: res.status, data, text };
    },
  };
}
const admin = client();
const author = client();
let r1;
let r2;

test.before(async () => {
  jpg = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: '#d2691e' } }).jpeg({ quality: 90 }).toBuffer();
  fake = http.createServer(fakeBanks).listen(0);
  await new Promise((r) => fake.once('listening', r));
  F = `http://127.0.0.1:${fake.address().port}`;
  stock.endpoints.pexels = `${F}/pexels`;
  stock.endpoints.pixabay = `${F}/pixabay`;
  stock.IMAGE_HOSTS.add('127.0.0.1');
  stock.MIN_INTERVAL.pexels = 0; stock.MIN_INTERVAL.pixabay = 0;
  db.open(':memory:');
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  auth.createUser({ email: 'adm@exemplo.com', name: 'Adm', password: PASS, role: 'admin' });
  auth.createUser({ email: 'aut@exemplo.com', name: 'Aut', password: PASS, role: 'author' });
  await admin.req('POST', '/api/v1/auth/login', { email: 'adm@exemplo.com', password: PASS });
  await author.req('POST', '/api/v1/auth/login', { email: 'aut@exemplo.com', password: PASS });
  const mk = async (title) => (await admin.req('POST', '/api/v1/recipes', { title, ingredients: 'a\nb\nc', steps: 'x\ny\nz', status: 'published' })).data;
  r1 = await mk('Bolo de cenoura (fofinho)');
  r2 = await mk('Pudim de leite');
  await mk('Receita nada encontrada');
});
test.after(() => { server.close(); fake.close(); db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('sem chave: tela orienta e a busca responde com mensagem clara; só admin acessa', async () => {
  const st = await admin.req('GET', '/api/v1/fotos/status');
  assert.deepEqual([st.data.pexels.configured, st.data.pixabay.configured, st.data.missing], [false, false, 3]);
  assert.equal((await admin.req('GET', `/api/v1/fotos/sugestoes/${r1.id}`)).status, 400);
  assert.equal((await author.req('GET', '/api/v1/fotos/status')).status, 403);
  assert.equal((await author.req('GET', '/admin/fotos')).status, 403);
  const page = await admin.req('GET', '/admin/fotos');
  assert.match(page.text, /pexels\.com\/api/);
  assert.match(page.text, /\/js\/stock\.js/);
});

test('chaves: formato validado, guardadas no servidor (600) e nunca devolvidas', async () => {
  assert.equal((await admin.req('PUT', '/api/v1/fotos/chaves', { provider: 'pexels', key: 'curta' })).status, 400);
  assert.equal((await admin.req('PUT', '/api/v1/fotos/chaves', { provider: 'outro', key: PEXELS_KEY })).status, 400);
  let r = await admin.req('PUT', '/api/v1/fotos/chaves', { provider: 'pexels', key: PEXELS_KEY });
  assert.equal(r.data.pexels.configured, true);
  r = await admin.req('PUT', '/api/v1/fotos/chaves', { provider: 'pixabay', key: PIXABAY_KEY });
  assert.equal(r.data.pixabay.configured, true);
  assert.doesNotMatch(JSON.stringify(r.data), new RegExp(PEXELS_KEY));
  assert.equal(fs.statSync(path.join(process.env.DATA_DIR, 'stock-keys.json')).mode & 0o777, 0o600);
});

test('sugestões: nome traduzido para inglês, chaves certas e foto mais relevante primeiro', async () => {
  const r = await admin.req('GET', `/api/v1/fotos/sugestoes/${r1.id}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.query, 'carrot cake', '"Bolo de cenoura (fofinho)" vira "carrot cake"');
  assert.equal(seen.queries.at(-1), 'carrot cake');
  assert.equal(seen.pixabayLang, 'en');
  assert.equal(seen.pexelsAuth.at(-1), PEXELS_KEY);
  assert.equal(seen.pixabayKeys.at(-1), PIXABAY_KEY);
  assert.equal(r.data.items[0].alt, 'Slice of carrot cake with frosting', 'a foto que descreve o prato sobe para o topo');
  assert.ok(r.data.items[0].score >= 2);
  assert.equal(r.data.items.at(-1).score, 0);
  assert.equal(r.data.items.find((i) => i.provider === 'pixabay').fallback, `${F}/img/x-prev.jpg`, 'miniatura reserva do Pixabay');
  const q = await admin.req('GET', `/api/v1/fotos/sugestoes/${r1.id}?q=${encodeURIComponent('carrot cake')}`);
  assert.equal(q.data.query, 'carrot cake', 'termo digitado em inglês é usado como está');
});

test('tradutor de culinária: pratos brasileiros e combinações comuns', () => {
  const { translate, score } = require('../src/foodterms');
  const cases = {
    'Bolo de cenoura com cobertura de chocolate': 'carrot chocolate cake',
    'Pão de queijo mineiro': 'brazilian cheese bread',
    'Lasanha de frango': 'chicken lasagna',
    'Salada de grão-de-bico': 'chickpea salad',
    'Moqueca de banana-da-terra': 'plantain stew',
    'Macarrão à carbonara': 'carbonara pasta',
    'Feijoada completa': 'feijoada black bean stew',
  };
  for (const [pt, en] of Object.entries(cases)) assert.equal(translate(pt).query, en, pt);
  assert.equal(score('Slice of carrot cake on a plate', translate('Bolo de cenoura').keywords), 3);
  assert.equal(score('Woman cooking in a kitchen', translate('Bolo de cenoura').keywords), 0);
});

test('aplicar: baixa só dos bancos, confere que é foto, guarda WebP e mostra o crédito', async () => {
  const ph = (await admin.req('GET', `/api/v1/fotos/sugestoes/${r1.id}`)).data.items[0];
  assert.equal((await admin.req('POST', '/api/v1/fotos/aplicar', { recipeId: r1.id, photo: { ...ph, full: 'https://evil.example.com/x.jpg' } })).status, 400, 'host fora da lista');
  assert.equal((await admin.req('POST', '/api/v1/fotos/aplicar', { recipeId: r1.id, photo: { ...ph, full: 'file:///etc/passwd' } })).status, 400);
  assert.equal((await admin.req('POST', '/api/v1/fotos/aplicar', { recipeId: r1.id, photo: { ...ph, full: `${F}/html` } })).status, 400, 'conteúdo que não é foto');
  assert.equal((await author.req('POST', '/api/v1/fotos/aplicar', { recipeId: r1.id, photo: ph })).status, 403);
  const r = await admin.req('POST', '/api/v1/fotos/aplicar', { recipeId: r1.id, photo: ph });
  assert.equal(r.status, 200);
  assert.match(r.data.cover, /^\/uploads\/[a-z0-9]+-[a-f0-9]{16}\.webp$/);
  assert.equal(r.data.cover_credit, 'Foto: Ana Lima / Pexels');
  assert.equal(r.data.cover_credit_url, 'https://www.pexels.com/@ana');
  assert.ok(fs.existsSync(path.join(process.env.UPLOADS_DIR, path.basename(r.data.cover))));
  const page = await (await fetch(`${base}/receita/${r1.slug}`)).text();
  assert.match(page, /<p class="photo-credit"><a href="https:\/\/www\.pexels\.com\/@ana" target="_blank" rel="nofollow noopener">Foto: Ana Lima \/ Pexels<\/a><\/p>/);
  assert.equal((await admin.req('GET', '/api/v1/fotos/status')).data.missing, 2);
  // trocar a foto no editor apaga o crédito antigo
  const patched = await admin.req('PATCH', `/api/v1/recipes/${r1.id}`, { cover: '/uploads/minha-foto.jpg' });
  assert.deepEqual([patched.data.cover_credit, patched.data.cover_credit_url], ['', '']);
});

test('automático: coloca foto nas que faltam, pula as sem resultado e informa o andamento', async () => {
  const st = await admin.req('POST', '/api/v1/fotos/auto');
  assert.equal(st.status, 200);
  assert.equal(st.data.job.total, 2);
  assert.equal((await admin.req('POST', '/api/v1/fotos/auto')).status, 409, 'não roda duas vezes ao mesmo tempo');
  for (let i = 0; i < 100 && (await admin.req('GET', '/api/v1/fotos/status')).data.job.running; i++) await new Promise((r) => setTimeout(r, 50));
  const done = (await admin.req('GET', '/api/v1/fotos/status')).data;
  assert.deepEqual([done.job.applied, done.job.skipped, done.job.failed, done.missing], [1, 1, 0, 1]);
  const pudim = (await admin.req('GET', `/api/v1/recipes/${r2.code}`)).data;
  assert.equal(pudim.cover_credit, 'Foto: chefpix / Pixabay', 'Pixabay (etiquetas "flan, caramel") confirma o pudim');
  assert.ok(db.get().prepare("SELECT 1 FROM uploads WHERE original_name LIKE 'auto: Pixabay%'").get(), 'foto automática fica marcada');
  assert.ok(db.get().prepare("SELECT 1 FROM audit_log WHERE action = 'fotos.auto'").get());
});

test('editor: autor busca e baixa foto grátis; a receita nova salva capa e crédito', async () => {
  const page = await author.req('GET', '/admin/receitas/nova');
  assert.match(page.text, /data-stock-open/, 'botão aparece quando há chave configurada');
  assert.match(page.text, /data-stock-dialog/);
  assert.equal((await author.req('GET', '/api/v1/fotos/buscar?q=')).data.items.length, 0);
  const found = await author.req('GET', `/api/v1/fotos/buscar?q=${encodeURIComponent('Feijoada (completa)')}`);
  assert.equal(found.status, 200);
  assert.equal(found.data.query, 'feijoada black bean stew');
  assert.ok(found.data.items.length >= 2);
  assert.equal((await author.req('POST', '/api/v1/fotos/baixar', { photo: { ...found.data.items[0], full: 'https://evil.example.com/a.jpg' } })).status, 400);
  const d = await author.req('POST', '/api/v1/fotos/baixar', { photo: found.data.items[0] });
  assert.equal(d.status, 201);
  assert.match(d.data.url, /^\/uploads\/.+\.webp$/);
  assert.equal(d.data.credit, `Foto: ${found.data.items[0].author} / Pexels`);
  const r = (await author.req('POST', '/api/v1/recipes', { title: 'Feijoada completa', cover: d.data.url, cover_credit: d.data.credit, cover_credit_url: d.data.creditUrl, ingredients: 'a\nb\nc', steps: 'x\ny\nz', status: 'published' })).data;
  assert.deepEqual([r.cover, r.cover_credit], [d.data.url, d.data.credit]);
  const edit = await author.req('GET', `/admin/receitas/${r.id}`);
  assert.match(edit.text, /data-cover-credit="Foto: .+ \/ Pexels"/, 'editor conhece o crédito da capa atual');
  assert.equal((await author.req('PATCH', `/api/v1/recipes/${r.id}`, { cover_credit_url: 'javascript:alert(1)' })).status, 400);
});

test('automático só aplica foto que confirma o prato; o resto fica para a revisão', async () => {
  const sorvete = (await admin.req('POST', '/api/v1/recipes', { title: 'Sorvete caseiro de creme', ingredients: 'a\nb\nc', steps: 'x\ny\nz', status: 'published' })).data;
  stock._reset();
  await admin.req('POST', '/api/v1/fotos/auto');
  for (let i = 0; i < 100 && (await admin.req('GET', '/api/v1/fotos/status')).data.job.running; i++) await new Promise((r) => setTimeout(r, 50));
  const st = (await admin.req('GET', '/api/v1/fotos/status')).data;
  assert.equal((await admin.req('GET', `/api/v1/recipes/${sorvete.code}`)).data.cover, '', 'foto genérica ("kitchen, table") não entra sozinha');
  assert.ok(st.job.log.some((l) => /Sorvete caseiro de creme: nenhuma foto confiável/.test(l)));
});

test('conferir e limpar: lista as fotos dos bancos e remove todas de uma vez (sem tocar nas enviadas)', async () => {
  const mine = (await admin.req('POST', '/api/v1/recipes', { title: 'Receita com foto minha', cover: '/uploads/minha.jpg', ingredients: 'a\nb\nc', steps: 'x\ny\nz', status: 'published' })).data;
  const st = (await admin.req('GET', '/api/v1/fotos/status')).data;
  assert.ok(st.fromBanks >= 1);
  const list = (await admin.req('GET', '/api/v1/fotos/pendentes?modo=bancos')).data;
  assert.equal(list.total, st.fromBanks);
  assert.ok(list.items.every((r) => /Pexels|Pixabay/.test(r.cover_credit)));
  assert.equal((await author.req('POST', '/api/v1/fotos/remover-bancos')).status, 403);
  const r = await admin.req('POST', '/api/v1/fotos/remover-bancos');
  assert.equal(r.data.removed, st.fromBanks);
  assert.equal(r.data.fromBanks, 0);
  assert.equal((await admin.req('GET', `/api/v1/recipes/${mine.code}`)).data.cover, '/uploads/minha.jpg', 'foto enviada pelo usuário fica');
  assert.ok(db.get().prepare("SELECT 1 FROM audit_log WHERE action = 'fotos.remover-bancos'").get());
});

test('editor sem chave: autor vê aviso claro; admin vê atalho para configurar', async () => {
  await admin.req('PUT', '/api/v1/fotos/chaves', { provider: 'pexels', key: '' });
  await admin.req('PUT', '/api/v1/fotos/chaves', { provider: 'pixabay', key: '' });
  const a = await author.req('GET', '/api/v1/fotos/buscar?q=bolo');
  assert.equal(a.status, 400);
  assert.match(a.data.error, /administrador/);
  assert.doesNotMatch((await author.req('GET', '/admin/receitas/nova')).text, /data-stock-open/);
  assert.match((await admin.req('GET', '/admin/receitas/nova')).text, /Ativar busca de fotos grátis/);
});
