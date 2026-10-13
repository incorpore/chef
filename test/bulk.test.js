'use strict';
/** Ações em massa nas receitas, ícone automático de categoria e imagem padrão para receitas sem foto. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chef-bulk-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.UPLOADS_DIR = path.join(tmp, 'uploads');
process.env.RATE_LIMIT = 'off';

const db = require('../src/db');
const auth = require('../src/auth');
const { createApp } = require('../src/app');

let server;
let base;
const PASS = `Pw-${crypto.randomBytes(8).toString('hex')}`;

function client() {
  let cookie = '';
  return {
    async req(method, url, { body } = {}) {
      const h = {};
      if (cookie) h.cookie = cookie;
      let payload = body;
      if (body && typeof body !== 'string') { payload = JSON.stringify(body); h['content-type'] = 'application/json'; }
      const res = await fetch(base + url, { method, headers: h, body: payload, redirect: 'manual' });
      const sc = res.headers.get('set-cookie');
      if (sc && /^chef_session=/.test(sc)) cookie = /Max-Age=0/.test(sc) ? '' : sc.split(';')[0];
      const text = await res.text();
      let data = text;
      try { data = JSON.parse(text); } catch { /* html */ }
      return { status: res.status, data, text };
    },
  };
}
const admin = client();
const author = client();
const other = client();
const visitor = client();
const mk = (c, title, extra = {}) => c.req('POST', '/api/v1/recipes', { body: { title, ingredients: 'a\nb\nc', steps: 'x\ny\nz', status: 'published', ...extra } }).then((r) => r.data);

test.before(async () => {
  db.open(':memory:');
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  auth.createUser({ email: 'adm@exemplo.com', name: 'Adm', password: PASS, role: 'admin' });
  auth.createUser({ email: 'aut@exemplo.com', name: 'Aut', password: PASS, role: 'author' });
  auth.createUser({ email: 'out@exemplo.com', name: 'Out', password: PASS, role: 'author' });
  for (const [c, e] of [[admin, 'adm'], [author, 'aut'], [other, 'out']]) await c.req('POST', '/api/v1/auth/login', { body: { email: `${e}@exemplo.com`, password: PASS } });
});
test.after(() => { server.close(); db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('categoria sem ícone ganha emoji pelo nome (criação e importação)', async () => {
  let c = (await admin.req('POST', '/api/v1/categories', { body: { name: 'Lanches e salgados' } })).data;
  assert.equal(c.icon, '🥪');
  c = (await admin.req('POST', '/api/v1/categories', { body: { name: 'Bolos', icon: '🎂' } })).data;
  assert.equal(c.icon, '🎂', 'ícone escolhido é mantido');
  await admin.req('POST', '/api/v1/import/json', { body: [{ title: 'Caldo verde', category: 'Sopas e caldos', ingredients: 'a\nb\nc', steps: 'x\ny\nz' }] });
  const cats = (await visitor.req('GET', '/api/v1/categories')).data.items;
  assert.equal(cats.find((x) => x.name === 'Sopas e caldos').icon, '🍲');
  // categorias antigas sem ícone são corrigidas ao iniciar (migração em db.open) usando a mesma função
  const { categoryEmoji } = require('../src/cover');
  assert.equal(categoryEmoji('Bebidas'), '🥤');
  assert.equal(categoryEmoji('Receitas de vó'), '🍽️');
});

test('em massa: publicar, desativar, mudar categoria, destacar e excluir', async () => {
  const ids = [];
  for (let i = 0; i < 6; i++) ids.push((await mk(admin, `Receita em massa ${i}`)).id);
  const cat = (await visitor.req('GET', '/api/v1/categories')).data.items.find((c) => c.name === 'Bolos');
  let r = await admin.req('POST', '/api/v1/recipes/bulk', { body: { ids: ids.slice(0, 3), action: 'draft' } });
  assert.deepEqual([r.status, r.data.done], [200, 3]);
  assert.equal((await visitor.req('GET', '/api/v1/recipes?q=massa&perPage=50')).data.total, 3, 'rascunhos somem do site');
  r = await admin.req('POST', '/api/v1/recipes/bulk', { body: { ids, action: 'category', value: cat.id } });
  assert.equal(r.data.done, 6);
  assert.equal((await admin.req('GET', `/api/v1/recipes?category=${cat.slug}&perPage=50`)).data.total, 6);
  r = await admin.req('POST', '/api/v1/recipes/bulk', { body: { ids: ids.slice(0, 2), action: 'category', value: '' } });
  assert.equal(r.data.done, 2, 'tirar categoria');
  r = await admin.req('POST', '/api/v1/recipes/bulk', { body: { ids, action: 'feature' } });
  assert.equal(r.data.done, 6);
  r = await admin.req('POST', '/api/v1/recipes/bulk', { body: { ids: ids.slice(0, 3), action: 'publish' } });
  assert.equal(r.data.done, 3);
  assert.equal((await visitor.req('GET', '/api/v1/recipes?q=massa&perPage=50')).data.total, 6);
  r = await admin.req('POST', '/api/v1/recipes/bulk', { body: { ids: ids.slice(4), action: 'delete' } });
  assert.equal(r.data.done, 2);
  assert.equal((await visitor.req('GET', '/api/v1/recipes?q=massa&perPage=50')).data.total, 4);
  const audit = db.get().prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE 'recipe.bulk.%'").get().n;
  assert.ok(audit >= 6, 'ações em massa ficam na auditoria');
});

test('em massa: "todas do filtro" respeita a busca', async () => {
  for (let i = 0; i < 4; i++) await mk(admin, `Pudim filtro ${i}`);
  const r = await admin.req('POST', '/api/v1/recipes/bulk', { body: { all: true, filter: { q: 'pudim filtro' }, action: 'draft' } });
  assert.equal(r.data.done, 4);
  assert.equal((await visitor.req('GET', '/api/v1/recipes?q=pudim&perPage=50')).data.total, 0);
  assert.ok((await visitor.req('GET', '/api/v1/recipes?q=massa&perPage=50')).data.total > 0, 'outras receitas intactas');
});

test('em massa: autor só mexe nas próprias; destacar é só admin; entradas inválidas', async () => {
  const mine = await mk(author, 'Receita do autor');
  const theirs = await mk(other, 'Receita de outro autor');
  let r = await author.req('POST', '/api/v1/recipes/bulk', { body: { ids: [mine.id, theirs.id], action: 'delete' } });
  assert.deepEqual([r.data.done, r.data.denied], [1, 1]);
  assert.equal((await visitor.req('GET', `/api/v1/recipes/${theirs.code}`)).status, 200, 'receita de outro não foi apagada');
  r = await author.req('POST', '/api/v1/recipes/bulk', { body: { all: true, filter: {}, action: 'draft' } });
  assert.equal(r.data.denied, 0, '"todas" do autor só inclui as dele');
  assert.equal((await visitor.req('GET', `/api/v1/recipes/${theirs.code}`)).status, 200);
  assert.equal((await author.req('POST', '/api/v1/recipes/bulk', { body: { ids: [theirs.id], action: 'feature' } })).status, 403);
  assert.equal((await admin.req('POST', '/api/v1/recipes/bulk', { body: { ids: [1], action: 'hack' } })).status, 400);
  assert.equal((await admin.req('POST', '/api/v1/recipes/bulk', { body: { ids: [], action: 'draft' } })).status, 400);
  assert.equal((await admin.req('POST', '/api/v1/recipes/bulk', { body: { ids: [1], action: 'category', value: 99999 } })).status, 400);
  assert.equal((await visitor.req('POST', '/api/v1/recipes/bulk', { body: { ids: [1], action: 'delete' } })).status, 401);
});

test('imagem padrão das receitas sem foto: configurável; vazio = capa ilustrada', async () => {
  const r = await mk(admin, 'Sem foto nenhuma');
  assert.match((await visitor.req('GET', `/api/v1/recipes/${r.code}`)).data.image, /^\/capa\//);
  assert.equal((await admin.req('PUT', '/api/v1/settings', { body: { defaultRecipeImage: 'javascript:alert(1)' } })).status, 400);
  assert.equal((await admin.req('PUT', '/api/v1/settings', { body: { defaultRecipeImage: '//evil.com/x.jpg' } })).status, 400);
  assert.equal((await admin.req('PUT', '/api/v1/settings', { body: { defaultRecipeImage: '/uploads/padrao.jpg' } })).status, 200);
  assert.equal((await visitor.req('GET', `/api/v1/recipes/${r.code}`)).data.image, '/uploads/padrao.jpg');
  assert.match((await visitor.req('GET', '/receitas')).text, /src="\/uploads\/padrao\.jpg"/);
  await admin.req('PUT', '/api/v1/settings', { body: { defaultRecipeImage: '' } });
  assert.match((await visitor.req('GET', `/api/v1/recipes/${r.code}`)).data.image, /^\/capa\//);
});
