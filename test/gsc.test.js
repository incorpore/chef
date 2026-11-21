'use strict';
/** Google Search Console no painel: chave da conta de serviço, token JWT assinado, relatório, sitemap e permissões. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chef-gsc-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.UPLOADS_DIR = path.join(tmp, 'uploads');
process.env.RATE_LIMIT = 'off';
delete process.env.GOOGLE_SERVICE_ACCOUNT;

const db = require('../src/db');
const auth = require('../src/auth');
const gsc = require('../src/gsc');
const { createApp } = require('../src/app');

const PASS = `Pw-${crypto.randomBytes(8).toString('hex')}`;
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const KEY = { type: 'service_account', project_id: 'chef-teste', client_email: 'chef@chef-teste.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), private_key_id: 'abc' };

// ---------- "Google" falso ----------
const google = { tokens: 0, calls: [], deny: false, sitemapPut: '' };
const day = (d) => new Date(Date.now() - d * 86400e3).toISOString().slice(0, 10);
let gServer;
let gBase;
function fakeGoogle(req, res) {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
    if (req.url === '/token') {
      const assertion = new URLSearchParams(body).get('assertion') || '';
      const [h, c, s] = assertion.split('.');
      const ok = s && crypto.verify('RSA-SHA256', Buffer.from(`${h}.${c}`), publicKey, Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
      const claim = ok ? JSON.parse(Buffer.from(c, 'base64').toString()) : {};
      if (!ok || claim.iss !== KEY.client_email || !/webmasters/.test(claim.scope)) return send(400, { error: 'invalid_grant' });
      google.tokens++;
      return send(200, { access_token: 'tok-123', expires_in: 3600 });
    }
    if (req.headers.authorization !== 'Bearer tok-123') return send(401, { error: { message: 'no auth' } });
    google.calls.push(`${req.method} ${req.url}`);
    if (google.deny) return send(403, { error: { message: 'User does not have sufficient permission' } });
    if (req.url === '/v3/sites') return send(200, { siteEntry: [{ siteUrl: 'https://outro.com/', permissionLevel: 'siteOwner' }, { siteUrl: 'sc-domain:exemplo.com.br', permissionLevel: 'siteFullUser' }, { siteUrl: 'https://naoverificado.com/', permissionLevel: 'siteUnverifiedUser' }] });
    const m = req.url.match(/^\/v3\/sites\/([^/]+)\/(searchAnalytics\/query|sitemaps)(?:\/(.+))?$/);
    if (!m) return send(404, { error: { message: 'not found' } });
    if (m[2] === 'sitemaps' && req.method === 'PUT') { google.sitemapPut = decodeURIComponent(m[3]); return send(204); }
    if (m[2] === 'sitemaps') return send(200, { sitemap: [{ path: 'https://receitas.exemplo.com.br/sitemap.xml', lastDownloaded: '2026-11-10T10:00:00Z', isPending: false, errors: '0', contents: [{ type: 'web', submitted: '512' }] }] });
    const q = JSON.parse(body);
    const old = q.startDate < day(30); // período anterior
    const dim = q.dimensions[0];
    if (dim === 'date') return send(200, { rows: [0, 1, 2].map((i) => ({ keys: [day(3 + i)], clicks: old ? 5 : 10 + i, impressions: old ? 100 : 200, ctr: 0.05, position: old ? 9 : 6 })) });
    if (dim === 'query' && q.dimensionFilterGroups) return send(200, { rows: [{ keys: ['bolo de fubá cremoso'], clicks: 7, impressions: 90, ctr: 0.07, position: 3.2 }] });
    if (dim === 'page' && q.dimensionFilterGroups) return send(200, { rows: [{ keys: [q.dimensionFilterGroups[0].filters[0].expression], clicks: 9, impressions: 120, ctr: 0.075, position: 4.1 }] });
    if (dim === 'query') return send(200, { rows: [{ keys: ['bolo de cenoura'], clicks: 20, impressions: 300, ctr: 0.066, position: 4.5 }] });
    if (dim === 'page') return send(200, { rows: [{ keys: ['https://receitas.exemplo.com.br/receita/bolo-de-fuba'], clicks: 15, impressions: 250, ctr: 0.06, position: 5 }, { keys: ['https://receitas.exemplo.com.br/'], clicks: 3, impressions: 40, ctr: 0.075, position: 8 }] });
    if (dim === 'device') return send(200, { rows: [{ keys: ['MOBILE'], clicks: 25, impressions: 500, ctr: 0.05, position: 6 }, { keys: ['DESKTOP'], clicks: 8, impressions: 100, ctr: 0.08, position: 5 }] });
    return send(200, { rows: [] });
  });
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

test.before(async () => {
  gServer = http.createServer(fakeGoogle).listen(0);
  await new Promise((r) => gServer.once('listening', r));
  gBase = `http://127.0.0.1:${gServer.address().port}`;
  gsc.endpoints.tokenUrl = `${gBase}/token`;
  gsc.endpoints.apiUrl = `${gBase}/v3`;
  db.open(':memory:');
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  auth.createUser({ email: 'adm@exemplo.com', name: 'Adm', password: PASS, role: 'admin' });
  auth.createUser({ email: 'aut@exemplo.com', name: 'Aut', password: PASS, role: 'author' });
  await admin.req('POST', '/api/v1/auth/login', { email: 'adm@exemplo.com', password: PASS });
  await author.req('POST', '/api/v1/auth/login', { email: 'aut@exemplo.com', password: PASS });
  await admin.req('PUT', '/api/v1/settings', { siteUrl: 'https://receitas.exemplo.com.br' });
});
test.after(() => { server.close(); gServer.close(); db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('sem chave: painel mostra a configuração guiada e a API responde com mensagem clara', async () => {
  const st = await admin.req('GET', '/api/v1/gsc/status');
  assert.equal(st.data.configured, false);
  const r = await admin.req('GET', '/api/v1/gsc/report');
  assert.equal(r.status, 400);
  const page = await admin.req('GET', '/admin/google');
  assert.equal(page.status, 200);
  assert.match(page.text, /data-gsc-setup/);
  assert.match(page.text, /\/js\/gsc\.js/);
});

test('chave: só aceita JSON de conta de serviço válido; fica no servidor (600) e nunca volta na API', async () => {
  assert.equal((await admin.req('POST', '/api/v1/gsc/key', { key: 'isso não é json' })).status, 400);
  assert.equal((await admin.req('POST', '/api/v1/gsc/key', { key: JSON.stringify({ type: 'authorized_user', client_id: 'x' }) })).status, 400);
  assert.equal((await admin.req('POST', '/api/v1/gsc/key', { key: JSON.stringify({ ...KEY, private_key: `-----BEGIN ${'PRIVATE'} KEY-----\nlixo\n-----END ${'PRIVATE'} KEY-----` }) })).status, 400);
  assert.equal((await author.req('POST', '/api/v1/gsc/key', { key: JSON.stringify(KEY) })).status, 403, 'só administradores');
  const r = await admin.req('POST', '/api/v1/gsc/key', { key: JSON.stringify(KEY) });
  assert.deepEqual([r.status, r.data.email], [200, KEY.client_email]);
  const file = path.join(process.env.DATA_DIR, 'google-service-account.json');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  const st = await admin.req('GET', '/api/v1/gsc/status');
  assert.equal(st.data.email, KEY.client_email);
  assert.doesNotMatch(JSON.stringify(st.data), /PRIVATE KEY/);
  // base64 também é aceito
  assert.equal((await admin.req('POST', '/api/v1/gsc/key', { key: Buffer.from(JSON.stringify(KEY)).toString('base64') })).status, 200);
  assert.ok(db.get().prepare("SELECT 1 FROM audit_log WHERE action = 'gsc.key'").get(), 'fica na auditoria');
});

test('relatório: propriedade detectada pelo endereço do site, totais, comparação e páginas ligadas às receitas', async () => {
  gsc._reset(); google.tokens = 0;
  await admin.req('POST', '/api/v1/recipes', { title: 'Bolo de fubá', ingredients: 'a\nb\nc', steps: 'x\ny\nz', status: 'published' });
  const s = await admin.req('GET', '/api/v1/gsc/sites');
  assert.deepEqual(s.data.items.map((i) => i.siteUrl), ['https://outro.com/', 'sc-domain:exemplo.com.br'], 'não verificadas ficam fora');
  assert.equal(s.data.current, 'sc-domain:exemplo.com.br', 'escolhe a do domínio do site');
  const r = await admin.req('GET', '/api/v1/gsc/report?dias=28');
  assert.equal(r.status, 200);
  assert.equal(r.data.site, 'sc-domain:exemplo.com.br');
  assert.deepEqual([r.data.totals.clicks, r.data.totals.impressions], [33, 600]);
  assert.equal(r.data.previous.clicks, 15);
  assert.equal(r.data.totals.position, 6);
  assert.equal(r.data.daily.length, 3);
  assert.equal(r.data.queries[0].key, 'bolo de cenoura');
  assert.equal(r.data.pages[0].title, 'Bolo de fubá', 'página → receita');
  assert.ok(r.data.pages[0].recipeId);
  assert.equal(r.data.pages[1].path, '/');
  assert.equal(r.data.devices[0].key, 'MOBILE');
  assert.equal(r.data.sitemaps[0].submitted, 512);
  assert.equal(google.tokens, 1, 'um token serve para todas as consultas');
  const n = google.calls.length;
  await admin.req('GET', '/api/v1/gsc/report?dias=28');
  assert.equal(google.calls.length, n, 'segunda vez vem do cache (cota da API)');
  // escolher outra propriedade
  await admin.req('PUT', '/api/v1/settings', { gscProperty: 'https://outro.com/' });
  assert.equal((await admin.req('GET', '/api/v1/gsc/sites')).data.current, 'https://outro.com/');
  await admin.req('PUT', '/api/v1/settings', { gscProperty: '' });
  assert.equal((await admin.req('PUT', '/api/v1/settings', { gscProperty: 'javascript:alert(1)' })).status, 400);
});

test('números da receita no editor (autor vê só as dele) e envio do sitemap', async () => {
  const mine = (await author.req('POST', '/api/v1/recipes', { title: 'Cuscuz do autor', ingredients: 'a\nb\nc', steps: 'x\ny\nz', status: 'published' })).data;
  const p = await author.req('GET', `/api/v1/gsc/page/${mine.code}`);
  assert.equal(p.status, 200);
  assert.deepEqual([p.data.clicks, p.data.queries[0].query], [9, 'bolo de fubá cremoso']);
  const other = (await admin.req('POST', '/api/v1/recipes', { title: 'Receita do admin', ingredients: 'a\nb\nc', steps: 'x\ny\nz', status: 'published' })).data;
  assert.equal((await author.req('GET', `/api/v1/gsc/page/${other.code}`)).status, 404);
  assert.equal((await author.req('GET', '/api/v1/gsc/report')).status, 403);
  const editor = await author.req('GET', `/admin/receitas/${mine.id}`);
  assert.match(editor.text, new RegExp(`data-gsc-page="${mine.code}"`));
  const sm = await admin.req('POST', '/api/v1/gsc/sitemap');
  assert.equal(sm.status, 200);
  assert.equal(google.sitemapPut, 'https://receitas.exemplo.com.br/sitemap.xml');
});

test('sem permissão no Search Console: mensagem diz exatamente o que fazer', async () => {
  gsc._reset(); google.deny = true;
  const r = await admin.req('GET', '/api/v1/gsc/report?dias=7');
  google.deny = false;
  assert.equal(r.status, 403);
  assert.match(r.data.error, /chef@chef-teste\.iam\.gserviceaccount\.com/);
  assert.match(r.data.error, /Usuários e permissões/);
});

test('chave recusada pelo Google e remoção da chave', async () => {
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
  await admin.req('POST', '/api/v1/gsc/key', { key: JSON.stringify({ ...KEY, private_key: other }) });
  const r = await admin.req('GET', '/api/v1/gsc/report');
  assert.equal(r.status, 400);
  assert.match(r.data.error, /recusou/);
  assert.equal((await admin.req('DELETE', '/api/v1/gsc/key')).status, 200);
  assert.equal((await admin.req('GET', '/api/v1/gsc/status')).data.configured, false);
  assert.ok(!fs.existsSync(path.join(process.env.DATA_DIR, 'google-service-account.json')));
});
