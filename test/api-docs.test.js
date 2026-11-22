'use strict';
/**
 * API completa e documentada: toda rota do servidor está no OpenAPI (e vice-versa), cada rota respeita o acesso
 * documentado (público / logado / admin) e nenhuma leitura quebra (sem erro 500).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chef-apidocs-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.UPLOADS_DIR = path.join(tmp, 'uploads');
process.env.RATE_LIMIT = 'off';
process.env.PAGE_CACHE_SECONDS = '0';
for (const k of ['SHOPEE_APP_ID', 'SHOPEE_SECRET', 'PEXELS_API_KEY', 'PIXABAY_API_KEY', 'GOOGLE_SERVICE_ACCOUNT', 'SMTP_HOST']) delete process.env[k];

const db = require('../src/db');
const auth = require('../src/auth');
const openapi = require('../src/openapi');
const apiRouter = require('../src/routes/api');
const { createApp } = require('../src/app');

const PASS = `Pw-${crypto.randomBytes(8).toString('hex')}`;
let server;
let base;
function client(headers = {}) {
  let cookie = '';
  return {
    async req(method, url, body) {
      const h = { ...headers };
      if (cookie) h.cookie = cookie;
      if (body !== undefined) h['content-type'] = 'application/json';
      const res = await fetch(base + url, { method: method.toUpperCase(), headers: h, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual' });
      const sc = res.headers.get('set-cookie');
      if (sc && /^chef_session=/.test(sc)) cookie = sc.split(';')[0];
      const text = await res.text();
      let data = text; try { data = JSON.parse(text); } catch { /* texto */ }
      return { status: res.status, data, text, type: res.headers.get('content-type') || '' };
    },
  };
}
const admin = client();
const author = client();
const anon = client();
let key;
const ids = {};

test.before(async () => {
  db.open(':memory:');
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  auth.createUser({ email: 'adm@exemplo.com', name: 'Adm', password: PASS, role: 'admin' });
  ids.author = auth.createUser({ email: 'aut@exemplo.com', name: 'Aut', password: PASS, role: 'author' });
  await admin.req('post', '/api/v1/auth/login', { email: 'adm@exemplo.com', password: PASS });
  await author.req('post', '/api/v1/auth/login', { email: 'aut@exemplo.com', password: PASS });
  ids.category = (await admin.req('post', '/api/v1/categories', { name: 'Bolos' })).data.id;
  const r = (await admin.req('post', '/api/v1/recipes', { title: 'Bolo simples', ingredients: '2 ovos\n1 xícara de farinha', steps: 'Misture.\nAsse.', status: 'published', category: 'Bolos', tags: ['fácil'] })).data;
  ids.recipe = r.id; ids.code = r.code; ids.slug = r.slug;
  await admin.req('post', '/api/v1/recipes', { title: 'Bolo de cenoura', ingredients: 'cenoura\novos', steps: 'Bata.\nAsse.', status: 'published', category: 'Bolos' });
  ids.product = (await admin.req('post', '/api/v1/products', { title: 'Forma', asin: 'B0FORMA251' })).data.id;
  ids.ad = (await admin.req('post', '/api/v1/ads', { name: 'Topo', slot: 'header', html: '<b>x</b>' })).data.id;
  key = (await admin.req('post', '/api/v1/keys', { name: 'teste' })).data.key;
});
test.after(() => { server.close(); db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

/** Rotas registradas no Express → "get /recipes/{ref}" */
function serverRoutes() {
  const out = new Set();
  for (const layer of apiRouter.stack) {
    if (!layer.route) continue;
    for (const m of Object.keys(layer.route.methods)) if (m !== '_all') out.add(`${m} ${layer.route.path.replace(/:(\w+)/g, '{$1}')}`);
  }
  return out;
}

test('toda rota do servidor está documentada no OpenAPI, e tudo o que está documentado existe', () => {
  const spec = openapi('http://x');
  const documented = new Set();
  for (const [p, ops] of Object.entries(spec.paths)) for (const m of Object.keys(ops)) documented.add(`${m} ${p}`);
  const routes = serverRoutes();
  assert.ok(routes.size > 100, `rotas encontradas: ${routes.size}`);
  assert.deepEqual([...routes].filter((r) => !documented.has(r)), [], 'rotas sem documentação');
  assert.deepEqual([...documented].filter((r) => !routes.has(r)), [], 'documentado mas não existe');
  // Cada operação tem resumo, tag conhecida, acesso definido e operationId único
  const tags = new Set(spec.tags.map((t) => t.name));
  const opIds = new Set();
  for (const ops of Object.values(spec.paths)) {
    for (const op of Object.values(ops)) {
      assert.ok(op.summary && tags.has(op.tags[0]) && ['public', 'user', 'admin'].includes(op['x-auth']), op.operationId);
      assert.ok(!opIds.has(op.operationId), `operationId repetido: ${op.operationId}`);
      opIds.add(op.operationId);
    }
  }
});

const fill = (p) => p.replace('{ref}', String(ids.recipe)).replace('{code}', ids.code).replace('{id}', '999999');

test('acesso de cada rota confere com a documentação (sem login → 401; autor em rota de admin → 403)', async () => {
  const spec = openapi('http://x');
  const wrong = [];
  for (const [p, ops] of Object.entries(spec.paths)) {
    for (const [m, op] of Object.entries(ops)) {
      if (op['x-auth'] === 'public') continue;
      const url = `/api/v1${fill(p)}`;
      const body = m === 'get' || m === 'delete' ? undefined : {};
      const a = await anon.req(m, url, body);
      if (a.status !== 401) wrong.push(`${m} ${p}: anônimo recebeu ${a.status}`);
      if (op['x-auth'] === 'admin') {
        const b = await author.req(m, url, body);
        if (b.status !== 403) wrong.push(`${m} ${p}: autor recebeu ${b.status}`);
      }
    }
  }
  assert.deepEqual(wrong, []);
});

test('todas as leituras (GET) respondem sem erro, em JSON, para o administrador e pela chave de API', async () => {
  const spec = openapi('http://x');
  const bearer = client({ authorization: `Bearer ${key}` });
  const bad = [];
  for (const [p, ops] of Object.entries(spec.paths)) {
    if (!ops.get) continue;
    const url = `/api/v1${p.replace('{ref}', p.startsWith('/categories') ? String(ids.category) : String(ids.recipe)).replace('{code}', ids.code).replace('{id}', p.includes('product') ? String(ids.product) : p.includes('ads') ? String(ids.ad) : p.includes('users') ? String(ids.author) : String(ids.recipe))}`;
    for (const [who, c] of [['admin', admin], ['chave', bearer]]) {
      const r = await c.req('get', url);
      if (r.status >= 500) bad.push(`${who} GET ${p}: ${r.status}`);
      else if (!/json/.test(r.type)) bad.push(`${who} GET ${p}: não respondeu JSON (${r.type})`);
      else if (r.status >= 400 && !(r.data && typeof r.data.error === 'string')) bad.push(`${who} GET ${p}: erro sem mensagem`);
    }
  }
  assert.deepEqual(bad, []);
});

test('rotas novas: saúde, aleatória, parecidas, categoria, produto, anúncio e usuário', async () => {
  assert.equal((await anon.req('get', '/api/v1/health')).data.ok, true);
  const rnd = await anon.req('get', '/api/v1/recipes/random?category=bolos');
  assert.equal(rnd.status, 200);
  assert.match(rnd.data.title, /Bolo/);
  assert.equal((await anon.req('get', '/api/v1/recipes/random?category=nada')).status, 404);
  const rel = await anon.req('get', `/api/v1/recipes/${ids.slug}/related?limit=3`);
  assert.equal(rel.status, 200);
  assert.ok(Array.isArray(rel.data.items));
  assert.equal((await anon.req('get', '/api/v1/categories/bolos')).data.count, 2);
  assert.equal((await anon.req('get', `/api/v1/categories/${ids.category}`)).data.name, 'Bolos');
  assert.equal((await anon.req('get', '/api/v1/categories/nao-existe')).status, 404);
  assert.equal((await author.req('get', `/api/v1/products/${ids.product}`)).data.title, 'Forma');
  assert.equal((await admin.req('get', `/api/v1/ads/${ids.ad}`)).data.name, 'Topo');
  // apagar algo que não existe responde 404 (antes dizia ok)
  for (const p of ['/categories/999999', '/products/999999', '/ads/999999', '/subscribers/999999']) assert.equal((await admin.req('delete', `/api/v1${p}`)).status, 404, p);

  const u = await admin.req('put', `/api/v1/users/${ids.author}`, { name: 'Autora Nova', bio: 'Confeiteira', role: 'admin' });
  assert.equal(u.status, 200, u.text);
  assert.deepEqual([u.data.user.name, u.data.user.role], ['Autora Nova', 'admin']);
  assert.equal((await author.req('get', '/api/v1/auth/me')).data.user, null, 'mudar o papel encerra a sessão da pessoa');
  assert.equal((await admin.req('put', `/api/v1/users/${ids.author}`, { role: 'chefe' })).status, 400);
  const me = (await admin.req('get', '/api/v1/auth/me')).data.user;
  assert.equal((await admin.req('put', `/api/v1/users/${me.id}`, { role: 'author' })).status, 400, 'não tira o próprio acesso');
  assert.equal((await admin.req('get', `/api/v1/users/${ids.author}`)).data.user.email, 'aut@exemplo.com');
  assert.equal((await admin.req('put', `/api/v1/users/${ids.author}`, { role: 'author' })).data.user.role, 'author');
});

test('documentação: /api/docs lista todas as rotas agrupadas e a especificação é válida', async () => {
  const page = await anon.req('get', '/api/docs');
  assert.equal(page.status, 200);
  const spec = (await anon.req('get', '/api/v1/openapi.json')).data;
  assert.equal(spec.openapi, '3.1.0');
  assert.match(spec.servers[0].url, /\/api\/v1$/);
  let n = 0;
  for (const [p, ops] of Object.entries(spec.paths)) {
    for (const m of Object.keys(ops)) {
      n++;
      assert.ok(page.text.includes(`/api/v1${p}`.replace(/&/g, '&amp;')), `docs sem ${m} ${p}`);
    }
  }
  assert.ok(n > 100);
  for (const t of spec.tags) assert.ok(page.text.includes(t.name), `docs sem o grupo ${t.name}`);
});
