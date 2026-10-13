'use strict';
/** Meu perfil (nome, foto, e-mail, bio, senha) e menu de conta: "Entrar" some quando a pessoa está logada. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chef-profile-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.UPLOADS_DIR = path.join(tmp, 'uploads');
process.env.RATE_LIMIT = 'off';
process.env.MAIL_TRANSPORT = 'memory';

const db = require('../src/db');
const auth = require('../src/auth');
const mail = require('../src/mail');
const { createApp } = require('../src/app');

let server;
let base;
const PASS = `Pw-${crypto.randomBytes(8).toString('hex')}`;
const PASS2 = `Pw-${crypto.randomBytes(8).toString('hex')}`;

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
const ana = client();
const other = client();
const visitor = client();
const waitFor = async (fn, ms = 2000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await new Promise((r) => setTimeout(r, 20)); } return false; };

test.before(async () => {
  db.open(':memory:');
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  auth.createUser({ email: 'ana@exemplo.com', name: 'Ana', password: PASS, role: 'author' });
  auth.createUser({ email: 'beto@exemplo.com', name: 'Beto', password: PASS, role: 'admin' });
  await ana.req('POST', '/api/v1/auth/login', { body: { email: 'ana@exemplo.com', password: PASS } });
  await other.req('POST', '/api/v1/auth/login', { body: { email: 'beto@exemplo.com', password: PASS } });
});
test.after(() => { server.close(); db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('menu: visitante vê "Entrar"; logado vê o menu da conta (perfil, painel, sair) e não vê "Entrar"', async () => {
  for (const url of ['/', '/receitas', '/sobre']) {
    const g = await visitor.req('GET', url);
    assert.match(g.text, />Entrar</, `${url}: visitante vê Entrar`);
    assert.doesNotMatch(g.text, /data-account-menu/);
    const l = await ana.req('GET', url);
    assert.doesNotMatch(l.text, />Entrar</, `${url}: logado não vê Entrar`);
    assert.match(l.text, /data-account-menu/);
    assert.match(l.text, /href="\/admin\/perfil"/);
    assert.match(l.text, /data-logout/);
  }
  // A página em cache do visitante nunca é servida para quem está logado (nem o contrário)
  const again = await visitor.req('GET', '/');
  assert.doesNotMatch(again.text, /ana@exemplo\.com/);
});

test('página Meu perfil abre para autores e administradores; visitante vai para o login', async () => {
  const p = await ana.req('GET', '/admin/perfil');
  assert.equal(p.status, 200);
  assert.match(p.text, /data-profile/);
  assert.match(p.text, /data-password/);
  assert.match(p.text, /data-avatar-file/);
  assert.match(p.text, /Autor\(a\)/);
  const v = await visitor.req('GET', '/admin/perfil');
  assert.ok([302, 303].includes(v.status), 'redireciona para o login');
});

test('perfil: nome, bio e foto (só /uploads ou https; nada de javascript:)', async () => {
  let r = await ana.req('PUT', '/api/v1/auth/me', { body: { name: '   ' } });
  assert.equal(r.status, 400);
  r = await ana.req('PUT', '/api/v1/auth/me', { body: { name: 'Ana <b>Paula</b>', bio: 'Amo bolos' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.bio, 'Amo bolos');
  for (const bad of ['javascript:alert(1)', 'data:image/png;base64,AAA', 'http://inseguro.com/a.jpg', '/uploads/../.env', '//evil.com/x.png', 'https://x.com/a.jpg" onerror="alert(1)']) {
    r = await ana.req('PUT', '/api/v1/auth/me', { body: { avatar: bad } });
    assert.equal(r.status, 400, `recusa ${bad}`);
  }
  r = await ana.req('PUT', '/api/v1/auth/me', { body: { avatar: '/uploads/abc123.jpg' } });
  assert.equal(r.data.user.avatar, '/uploads/abc123.jpg');
  r = await ana.req('PUT', '/api/v1/auth/me', { body: { avatar: 'https://cdn.exemplo.com/eu.jpg' } });
  assert.equal(r.status, 200);
  const page = await ana.req('GET', '/');
  assert.match(page.text, /class="avatar avatar-sm" src="https:\/\/cdn\.exemplo\.com\/eu\.jpg"/);
  r = await ana.req('PUT', '/api/v1/auth/me', { body: { avatar: '' } });
  assert.equal(r.data.user.avatar, '');
  assert.match((await ana.req('GET', '/')).text, /avatar-initials avatar-sm/, 'sem foto: iniciais');
});

test('perfil: trocar e-mail exige a senha atual, recusa e-mail repetido e avisa o endereço antigo', async () => {
  let r = await ana.req('PUT', '/api/v1/auth/me', { body: { email: 'ana.nova@exemplo.com' } });
  assert.equal(r.status, 400);
  assert.equal(r.data.field, 'currentPassword');
  r = await ana.req('PUT', '/api/v1/auth/me', { body: { email: 'ana.nova@exemplo.com', currentPassword: 'errada' } });
  assert.equal(r.status, 400);
  r = await ana.req('PUT', '/api/v1/auth/me', { body: { email: 'BETO@exemplo.com', currentPassword: PASS } });
  assert.equal(r.status, 409, 'e-mail de outra conta');
  r = await ana.req('PUT', '/api/v1/auth/me', { body: { email: 'não é email', currentPassword: PASS } });
  assert.equal(r.status, 400);
  // mesmo e-mail (só maiúsculas diferentes) não é troca e não pede senha
  r = await ana.req('PUT', '/api/v1/auth/me', { body: { email: 'ANA@exemplo.com', name: 'Ana Paula' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.email, 'ana@exemplo.com');

  mail.outbox.length = 0;
  r = await ana.req('PUT', '/api/v1/auth/me', { body: { email: 'Ana.Nova@exemplo.com', currentPassword: PASS } });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.email, 'ana.nova@exemplo.com');
  assert.ok(await waitFor(() => mail.outbox.some((m) => m.to === 'ana@exemplo.com')), 'aviso vai para o e-mail antigo');
  const login = await client().req('POST', '/api/v1/auth/login', { body: { email: 'ana.nova@exemplo.com', password: PASS } });
  assert.equal(login.status, 200);
  const audit = db.get().prepare("SELECT detail FROM audit_log WHERE action = 'email.change'").get();
  assert.match(audit.detail, /ana@exemplo\.com → ana\.nova@exemplo\.com/);
});

test('perfil: trocar senha exige a atual, valida a nova, derruba outros aparelhos e mantém este', async () => {
  const phone = client();
  await phone.req('POST', '/api/v1/auth/login', { body: { email: 'ana.nova@exemplo.com', password: PASS } });
  assert.equal((await phone.req('GET', '/api/v1/auth/me')).data.user.name, 'Ana Paula');

  let r = await ana.req('PUT', '/api/v1/auth/me', { body: { password: PASS2 } });
  assert.equal(r.status, 400);
  r = await ana.req('PUT', '/api/v1/auth/me', { body: { password: '123', currentPassword: PASS } });
  assert.equal(r.status, 400);
  assert.equal(r.data.field, 'password');
  mail.outbox.length = 0;
  r = await ana.req('PUT', '/api/v1/auth/me', { body: { password: PASS2, currentPassword: PASS } });
  assert.equal(r.status, 200);
  assert.ok(r.data.user.name, 'continua logada neste aparelho');
  assert.equal((await ana.req('GET', '/api/v1/auth/me')).data.user.email, 'ana.nova@exemplo.com');
  assert.equal((await phone.req('GET', '/api/v1/auth/me')).data.user, null, 'outro aparelho saiu');
  assert.ok(await waitFor(() => mail.outbox.some((m) => m.to === 'ana.nova@exemplo.com' && /alterada/.test(m.subject))));
  const old = await client().req('POST', '/api/v1/auth/login', { body: { email: 'ana.nova@exemplo.com', password: PASS } });
  assert.equal(old.status, 401);
});

test('perfil: chave de API não troca e-mail nem senha', async () => {
  const key = (await ana.req('POST', '/api/v1/keys', { body: { name: 'teste' } })).data.key;
  assert.ok(key);
  const res = await fetch(`${base}/api/v1/auth/me`, { method: 'PUT', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ email: 'hacker@exemplo.com', currentPassword: PASS2 }) });
  assert.equal(res.status, 403);
});

test('receita mostra foto e bio de quem escreveu', async () => {
  await ana.req('PUT', '/api/v1/auth/me', { body: { avatar: '/uploads/ana.jpg', bio: 'Cozinheira de **domingo**' } });
  const r = (await ana.req('POST', '/api/v1/recipes', { body: { title: 'Pudim de leite', ingredients: '1 lata de leite condensado', steps: 'Misture e asse.', status: 'published' } })).data;
  const page = await visitor.req('GET', `/receita/${r.slug}`);
  assert.match(page.text, /class="byline"><img class="avatar avatar-byline" src="\/uploads\/ana\.jpg"/);
  assert.match(page.text, /class="author-card"/);
  assert.match(page.text, /<strong>domingo<\/strong>/);
});

test('receita sem foto ganha capa ilustrada (SVG seguro); com foto, usa a foto', async () => {
  const r = (await ana.req('POST', '/api/v1/recipes', { body: { title: 'Bolo <script>alert(1)</script> de fubá', ingredients: '2 xícaras de fubá\n3 ovos', steps: 'Misture.\nAsse por 40 minutos.', status: 'published' } })).data;
  assert.match(r.image, /^\/capa\/[A-Z0-9]+\.svg\?v=[0-9a-f]{8}$/);
  assert.equal(r.cover, '', 'a capa automática não é gravada como foto');
  const card = await visitor.req('GET', '/receitas');
  assert.ok(card.text.includes(r.image.replace(/&/g, '&amp;')), 'cartão usa a capa ilustrada');
  const svg = await fetch(base + r.image.split('?')[0]);
  assert.equal(svg.status, 200);
  assert.match(svg.headers.get('content-type'), /image\/svg\+xml/);
  const body = await svg.text();
  assert.match(body, /🍰/);
  assert.doesNotMatch(body, /<script/i, 'título escapado');
  const page = await visitor.req('GET', `/receita/${r.slug}`);
  assert.match(page.text, /"image":\["[^"]*\/capa\//, 'JSON-LD tem imagem');
  const draft = (await ana.req('POST', '/api/v1/recipes', { body: { title: 'Rascunho secreto', ingredients: 'a\nb\nc', steps: 'x\ny\nz', status: 'draft' } })).data;
  assert.equal((await fetch(`${base}/capa/${draft.code}.svg`)).status, 404, 'rascunho não aparece para visitantes');
  const withPhoto = (await ana.req('POST', '/api/v1/recipes', { body: { title: 'Com foto', cover: '/uploads/x.jpg', ingredients: 'a\nb\nc', steps: 'x\ny\nz', status: 'published' } })).data;
  assert.equal(withPhoto.image, '/uploads/x.jpg');
});
