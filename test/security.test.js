'use strict';
/**
 * Testes de segurança "como um estranho": tentam burlar login, permissões, validação,
 * uploads, cabeçalhos e limites — cada teste é um ataque que precisa FALHAR.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execSync } = require('node:child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chef-sec-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.UPLOADS_DIR = path.join(tmp, 'uploads');
process.env.SETUP_TOKEN = 'token-de-instalacao-secreto';
process.env.MAX_UPLOAD_MB = '1';
delete process.env.IMPORT_ALLOW_PRIVATE;

const db = require('../src/db');
const sec = require('../src/security');
const { createApp } = require('../src/app');

let server;
let base;

/** Cliente HTTP com "pote de cookies" próprio — cada um representa uma pessoa diferente. */
function client(name) {
  const jar = { cookie: '' };
  return {
    name,
    jar,
    async req(method, url, { body, headers = {}, key } = {}) {
      const h = { ...headers };
      if (jar.cookie) h.cookie = jar.cookie;
      if (key) h.authorization = `Bearer ${key}`;
      let payload = body;
      if (body !== undefined && !(body instanceof FormData) && typeof body !== 'string') {
        payload = JSON.stringify(body);
        h['content-type'] = 'application/json';
      }
      const res = await fetch(base + url, { method, headers: h, body: payload, redirect: 'manual' });
      const sc = res.headers.get('set-cookie');
      if (sc && /^chef_session=/.test(sc)) jar.cookie = /Max-Age=0/.test(sc) ? '' : sc.split(';')[0];
      const type = res.headers.get('content-type') || '';
      const text = await res.text();
      let data = text;
      if (type.includes('json')) { try { data = JSON.parse(text); } catch { /* corpo não-JSON */ } }
      return { status: res.status, headers: res.headers, data, text };
    },
  };
}

const admin = client('admin');
const author = client('autor');
const stranger = client('estranho');
let adminDraft;
let adminRecipe;
let authorRecipe;
let authorKey;

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
test.beforeEach(() => sec.resetLimits());

// ---------------------------------------------------------------- 4/10. Login de verdade e admin protegido
test('instalação exige o token secreto (estranho não cria o admin antes do dono)', async () => {
  let r = await stranger.req('POST', '/api/v1/auth/setup', { body: { email: 'hacker@x.com', password: 'Senha-forte-123', name: 'H' } });
  assert.equal(r.status, 403);
  r = await stranger.req('POST', '/api/v1/auth/setup', { body: { email: 'hacker@x.com', password: 'Senha-forte-123', setupToken: 'chute' } });
  assert.equal(r.status, 403);
  stranger.jar.cookie = '';
  r = await admin.req('POST', '/api/v1/auth/setup', { body: { email: 'dono@chef.com', password: 'Senha-forte-123', name: 'Dono', setupToken: process.env.SETUP_TOKEN } });
  assert.equal(r.status, 201);
  r = await stranger.req('POST', '/api/v1/auth/setup', { body: { email: 'x@x.com', password: 'Senha-forte-123', setupToken: process.env.SETUP_TOKEN } });
  assert.equal(r.status, 409, 'instalação só pode acontecer uma vez');
});

test('senhas fracas e e-mails inválidos são recusados', async () => {
  for (const password of ['1234567', '12345678', 'aaaaaaaaaa', 'senha123']) {
    const r = await admin.req('POST', '/api/v1/users', { body: { email: 'a@b.com', password, name: 'A' } });
    assert.equal(r.status, 400, password);
  }
  const r = await admin.req('POST', '/api/v1/users', { body: { email: 'nao-e-email', password: 'Senha-forte-123' } });
  assert.equal(r.status, 400);
});

test('preparação: admin cria autor e receitas', async () => {
  let r = await admin.req('POST', '/api/v1/users', { body: { email: 'autor@chef.com', password: 'Outra-senha-456', name: 'Autor', role: 'author' } });
  assert.equal(r.status, 201);
  r = await author.req('POST', '/api/v1/auth/login', { body: { email: 'AUTOR@chef.com', password: 'Outra-senha-456' } });
  assert.equal(r.status, 200, 'login ignora maiúsculas no e-mail');
  adminDraft = (await admin.req('POST', '/api/v1/recipes', { body: { title: 'Receita secreta do dono', code: 'SEGREDO1', ingredients: 'ingrediente secreto', steps: 'x', status: 'draft' } })).data;
  adminRecipe = (await admin.req('POST', '/api/v1/recipes', { body: { title: 'Bolo público', code: 'PUB001', ingredients: '2 ovos', steps: 'Misture.', status: 'published' } })).data;
  authorRecipe = (await author.req('POST', '/api/v1/recipes', { body: { title: 'Torta do autor', ingredients: '1 ovo', steps: 'Asse.', status: 'published', featured: true, author_id: 1, views: 99999 } })).data;
  assert.equal(authorRecipe.featured, false, 'autor não pode destacar na home');
  assert.equal(authorRecipe.views, 0, 'campos internos não podem ser definidos pelo cliente');
  assert.notEqual(authorRecipe.author_id, 1, 'author_id vem da sessão, não do corpo');
  authorKey = (await author.req('POST', '/api/v1/keys', { body: { name: 'script' } })).data.key;
});

test('login: mensagem genérica e sem revelar se o e-mail existe', async () => {
  const a = await stranger.req('POST', '/api/v1/auth/login', { body: { email: 'dono@chef.com', password: 'errada-errada' } });
  const b = await stranger.req('POST', '/api/v1/auth/login', { body: { email: 'ninguem@chef.com', password: 'errada-errada' } });
  assert.equal(a.status, 401);
  assert.equal(b.status, 401);
  assert.equal(a.data.error, b.data.error);
});

// ---------------------------------------------------------------- 17. Limite de tentativas
test('força bruta: conta bloqueia após 5 erros, mesmo com a senha certa depois', async () => {
  for (let i = 0; i < 5; i++) await stranger.req('POST', '/api/v1/auth/login', { body: { email: 'dono@chef.com', password: `chute${i}xx` } });
  const r = await stranger.req('POST', '/api/v1/auth/login', { body: { email: 'dono@chef.com', password: 'Senha-forte-123' } });
  assert.equal(r.status, 429);
});

test('força bruta: limite de 10 tentativas por IP em 15 minutos', async () => {
  let last;
  for (let i = 0; i < 11; i++) last = await stranger.req('POST', '/api/v1/auth/login', { body: { email: `x${i}@chef.com`, password: 'qualquer-coisa' } });
  assert.equal(last.status, 429);
  assert.ok(last.headers.get('retry-after'));
});

test('forjar X-Forwarded-For não burla o limite de tentativas', async () => {
  let last;
  for (let i = 0; i < 11; i++) last = await stranger.req('POST', '/api/v1/auth/login', { headers: { 'x-forwarded-for': `203.0.113.${i}` }, body: { email: `y${i}@chef.com`, password: 'qualquer-coisa' } });
  assert.equal(last.status, 429);
});

test('spam: limite de comentários por minuto', async () => {
  let last;
  for (let i = 0; i < 6; i++) last = await stranger.req('POST', `/api/v1/recipes/${adminRecipe.id}/comments`, { body: { name: 'Bot', body: `oi ${i}` } });
  assert.equal(last.status, 429);
});

// ---------------------------------------------------------------- 1. Chave de API protegida
test('chave de API: inválida é recusada, guardada só como hash e mostrada uma única vez', async () => {
  const r = await stranger.req('GET', '/api/v1/keys', { key: 'chef_inventada' });
  assert.equal(r.status, 401);
  const stored = db.get().prepare('SELECT * FROM api_keys').all();
  assert.ok(stored.every((k) => !JSON.stringify(k).includes(authorKey)), 'a chave em texto puro não fica no banco');
  const list = await author.req('GET', '/api/v1/keys');
  assert.ok(!JSON.stringify(list.data).includes(authorKey), 'listagem não devolve a chave');
  const viaKey = await stranger.req('POST', '/api/v1/keys', { key: authorKey, body: { name: 'outra' } });
  assert.equal(viaKey.status, 403, 'uma chave não pode criar outras chaves');
});

test('chave na URL (?key=) não é aceita — só no cabeçalho Authorization', async () => {
  const r = await stranger.req('POST', `/api/v1/recipes?key=${authorKey}&api_key=${authorKey}`, { body: { title: 'x' } });
  assert.equal(r.status, 401);
});

// ---------------------------------------------------------------- 5/6/7. Permissão no servidor, não confia no ID, cada um só vê o seu
test('estranho (sem login) não acessa nenhuma rota restrita', async () => {
  const routes = [['GET', '/api/v1/keys'], ['GET', '/api/v1/settings'], ['PUT', '/api/v1/settings'], ['GET', '/api/v1/users'], ['GET', '/api/v1/comments'], ['GET', '/api/v1/export'], ['GET', '/api/v1/stats'], ['GET', '/api/v1/audit'], ['GET', '/api/v1/uploads'], ['POST', '/api/v1/uploads'], ['GET', '/api/v1/products'], ['POST', '/api/v1/products'], ['GET', '/api/v1/ads'], ['POST', '/api/v1/recipes'], ['DELETE', `/api/v1/recipes/${adminRecipe.id}`], ['PATCH', `/api/v1/recipes/${adminRecipe.id}`], ['POST', '/api/v1/import'], ['GET', '/api/v1/subscribers']];
  for (const [m, u] of routes) {
    const r = await stranger.req(m, u, { body: m === 'GET' ? undefined : {} });
    assert.equal(r.status, 401, `${m} ${u}`);
  }
  for (const p of ['/admin', '/admin/receitas', '/admin/configuracoes', `/admin/receitas/${adminRecipe.id}`]) {
    const r = await stranger.req('GET', p);
    assert.equal(r.status, 302, p);
    assert.match(r.headers.get('location'), /^\/admin\/login/);
  }
});

test('rascunho de outra pessoa é invisível (API, página, código, link curto e busca)', async () => {
  for (const who of [stranger, author]) {
    assert.equal((await who.req('GET', `/api/v1/recipes/${adminDraft.id}`)).status, 404, who.name);
    assert.equal((await who.req('GET', '/api/v1/recipes/code/SEGREDO1')).status, 404, who.name);
    assert.equal((await who.req('GET', `/receita/${adminDraft.slug}`)).status, 404, who.name);
    assert.equal((await who.req('GET', '/c/SEGREDO1')).status, 404, who.name);
    assert.equal((await who.req('GET', '/qr/SEGREDO1.svg')).status, 404, who.name);
    const s = await who.req('GET', '/api/v1/recipes?q=secreto&status=draft');
    assert.ok(!s.data.items.some((i) => i.id === adminDraft.id), `${who.name}: busca`);
    const s2 = await who.req('GET', '/api/v1/recipes?q=SEGREDO1');
    assert.equal(s2.data.exactCode, null, `${who.name}: código`);
  }
  assert.equal((await admin.req('GET', `/api/v1/recipes/${adminDraft.id}`)).status, 200);
});

test('autor não edita, exclui nem modera o que é dos outros (IDOR)', async () => {
  const id = adminRecipe.id;
  assert.equal((await author.req('PATCH', `/api/v1/recipes/${id}`, { body: { title: 'hackeado' } })).status, 403);
  assert.equal((await author.req('PUT', `/api/v1/recipes/PUB001`, { body: { title: 'hackeado' } })).status, 403);
  assert.equal((await author.req('DELETE', `/api/v1/recipes/${id}`)).status, 403);
  assert.equal((await stranger.req('PATCH', `/api/v1/recipes/${id}`, { key: authorKey, body: { title: 'hackeado' } })).status, 403, 'nem com a chave de API do autor');
  assert.equal((await author.req('PATCH', `/api/v1/recipes/${adminDraft.id}`, { body: { title: 'x' } })).status, 404, 'rascunho alheio nem "existe"');
  assert.equal((await author.req('GET', `/admin/receitas/${id}`)).status, 403);
  const r = await admin.req('GET', `/api/v1/recipes/${id}`);
  assert.equal(r.data.title, 'Bolo público');
  // O autor edita a própria receita normalmente
  assert.equal((await author.req('PATCH', `/api/v1/recipes/${authorRecipe.id}`, { body: { description: 'minha' } })).status, 200);
  // Comentário na receita do admin: autor não vê nem modera
  const c = await stranger.req('POST', `/api/v1/recipes/${id}/comments`, { body: { name: 'Ana', body: 'Comentário' } });
  const list = await author.req('GET', '/api/v1/comments?status=all');
  assert.ok(!list.data.items.some((i) => i.id === c.data.id));
  assert.equal((await author.req('PATCH', `/api/v1/comments/${c.data.id}`, { body: { status: 'approved' } })).status, 404);
  assert.equal((await author.req('DELETE', `/api/v1/comments/${c.data.id}`)).status, 404);
});

test('autor não acessa áreas de administrador', async () => {
  for (const [m, u, body] of [['GET', '/api/v1/settings'], ['PUT', '/api/v1/settings', { siteName: 'x' }], ['GET', '/api/v1/users'], ['POST', '/api/v1/users', { email: 'z@z.com', password: 'Senha-forte-999', role: 'admin' }], ['GET', '/api/v1/ads'], ['POST', '/api/v1/ads', { name: 'x', slot: 'header', html: '<script>alert(1)</script>' }], ['POST', '/api/v1/products', { title: 'x', asin: 'B000000000' }], ['POST', '/api/v1/categories', { name: 'x' }], ['DELETE', '/api/v1/categories/1'], ['GET', '/api/v1/audit'], ['GET', '/api/v1/subscribers']]) {
    assert.equal((await author.req(m, u, { body })).status, 403, `${m} ${u}`);
  }
  for (const p of ['/admin/configuracoes', '/admin/anuncios', '/admin/usuarios', '/admin/auditoria', '/admin/produtos', '/admin/categorias']) assert.equal((await author.req('GET', p)).status, 403, p);
});

test('cada um só vê o seu: exportação, uploads, chaves e estatísticas', async () => {
  const exp = await author.req('GET', '/api/v1/export');
  assert.ok(exp.data.items.every((i) => i.author_id === authorRecipe.author_id));
  assert.equal(exp.data.products.length, 0);
  const stats = await author.req('GET', '/api/v1/stats');
  assert.equal(stats.data.recipes, 1);
  assert.equal(stats.data.subscribers, null);
  const adminKeys = await admin.req('POST', '/api/v1/keys', { body: { name: 'do admin' } });
  assert.equal((await author.req('DELETE', `/api/v1/keys/${adminKeys.data.id}`)).status, 404, 'não apaga chave alheia trocando o ID');
  assert.equal((await admin.req('GET', '/api/v1/keys')).data.items.length, 1);
});

// ---------------------------------------------------------------- Sessão
test('cookie adulterado é ignorado; "sair de todos" e troca de senha derrubam sessões antigas', async () => {
  const forged = author.jar.cookie.replace(/^chef_session=(\d+)/, 'chef_session=1');
  const f = await stranger.req('GET', '/api/v1/auth/me', { headers: { cookie: forged } });
  assert.equal(f.data.user, null, 'trocar o ID no cookie invalida a assinatura');
  const old = author.jar.cookie;
  const other = client('autor-celular');
  await other.req('POST', '/api/v1/auth/login', { body: { email: 'autor@chef.com', password: 'Outra-senha-456' } });
  await author.req('PUT', '/api/v1/auth/me', { body: { currentPassword: 'Outra-senha-456', password: 'Nova-senha-789' } });
  assert.equal((await other.req('GET', '/api/v1/auth/me')).data.user, null, 'outro aparelho foi desconectado');
  assert.equal((await stranger.req('GET', '/api/v1/auth/me', { headers: { cookie: old } })).data.user, null, 'cookie antigo não vale mais');
  assert.equal((await author.req('GET', '/api/v1/auth/me')).data.user.email, 'autor@chef.com', 'este aparelho continua logado');
  await author.req('POST', '/api/v1/auth/logout-all');
  assert.equal((await author.req('GET', '/api/v1/auth/me')).data.user, null);
  await author.req('POST', '/api/v1/auth/login', { body: { email: 'autor@chef.com', password: 'Nova-senha-789' } });
});

test('cookie de sessão é HttpOnly e SameSite', async () => {
  const c = client('x');
  const res = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'dono@chef.com', password: 'Senha-forte-123' }) });
  const sc = res.headers.get('set-cookie');
  assert.match(sc, /HttpOnly/);
  assert.match(sc, /SameSite=Lax/);
  void c;
});

test('CSRF: escrita com cookie vinda de outro site é recusada', async () => {
  let r = await admin.req('POST', '/api/v1/recipes', { body: { title: 'x' }, headers: { origin: 'https://site-malicioso.com' } });
  assert.equal(r.status, 403);
  r = await admin.req('DELETE', `/api/v1/recipes/${adminRecipe.id}`, { headers: { 'sec-fetch-site': 'cross-site' } });
  assert.equal(r.status, 403);
  assert.equal((await admin.req('GET', `/api/v1/recipes/${adminRecipe.id}`)).status, 200);
});

test('open redirect: ?next= só aceita caminhos internos', async () => {
  for (const next of ['//evil.com', 'https://evil.com', '/\\evil.com', '//evil.com/%2e%2e']) {
    const r = await admin.req('GET', `/admin/login?next=${encodeURIComponent(next)}`);
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/admin', next);
  }
});

// ---------------------------------------------------------------- 13/14. Valida tudo no servidor e limpa o que o usuário manda
test('validação: tamanhos, tipos e URLs perigosas', async () => {
  const bad = [
    { title: 'x'.repeat(201) },
    { title: 'ok', ingredients: Array(301).fill('1 ovo') },
    { title: 'ok', images: 'não é lista' },
    { title: 'ok', cover: 'javascript:alert(1)' },
    { title: 'ok', video: 'javascript:alert(1)' },
    { title: 'ok', source_url: 'data:text/html,<script>alert(1)</script>' },
    { title: 'ok', steps: [{ text: 'x'.repeat(5001) }] },
    { title: 'ok', images: [{ url: 'vbscript:x' }] },
  ];
  for (const body of bad) assert.equal((await admin.req('POST', '/api/v1/recipes', { body })).status, 400, JSON.stringify(body).slice(0, 60));
  assert.equal((await admin.req('POST', '/api/v1/recipes', { body: '[1,2' , headers: { 'content-type': 'application/json' } })).status, 400);
  assert.equal((await admin.req('POST', '/api/v1/recipes', { body: 'null', headers: { 'content-type': 'application/json' } })).status, 400);
  for (const body of [{ ga4Id: '<script>' }, { adsenseClient: 'ca-pub-1"><script>' }, { themeColor: 'red;}</style><script>' }, { social: { instagram: 'javascript:alert(1)' } }, { logo: 'javascript:alert(1)' }]) {
    assert.equal((await admin.req('PUT', '/api/v1/settings', { body })).status, 400, JSON.stringify(body));
  }
});

test('prototype pollution pelas configurações não afeta o servidor', async () => {
  await admin.req('PUT', '/api/v1/settings', { body: JSON.parse('{"__proto__":{"polluted":"sim"},"constructor":{"prototype":{"polluted":"sim"}}}') });
  assert.equal({}.polluted, undefined);
});

test('XSS: conteúdo de usuários é sempre escapado', async () => {
  const payload = '"><img src=x onerror=alert(1)><script>alert(document.cookie)</script>';
  const r = await admin.req('POST', '/api/v1/recipes', { body: { title: `Bolo ${payload}`, description: payload, story: `[clique](javascript:alert(1)) ${payload}`, ingredients: `1 ovo ${payload}`, steps: `Passo ${payload}`, tags: payload, status: 'published' } });
  assert.equal(r.status, 201);
  await stranger.req('POST', `/api/v1/recipes/${r.data.id}/comments`, { body: { name: payload, body: payload, rating: 5 } });
  db.get().exec("UPDATE comments SET status = 'approved'");
  const page = await stranger.req('GET', `/receita/${r.data.slug}`);
  assert.equal(page.status, 200);
  assert.ok(!page.text.includes('<img src=x onerror'), 'tag injetada não aparece crua');
  assert.ok(!/<script>alert/.test(page.text), 'script injetado não aparece cru');
  assert.ok(!page.text.includes('href="javascript:'), 'link javascript: não é gerado');
  // Todo <script> da página tem o nonce do CSP: um script injetado não executaria
  const nonce = page.headers.get('content-security-policy').match(/'nonce-([^']+)'/)[1];
  const scripts = page.text.match(/<script\b[^>]*>/gi);
  assert.ok(scripts.every((s) => s.includes(`nonce="${nonce}"`)), 'todos os scripts têm nonce');
  for (const url of ['/', '/receitas', '/sitemap.xml', '/feed.xml', `/embed/${r.data.code}`]) {
    const p = await stranger.req('GET', url);
    assert.ok(!p.text.includes('<img src=x onerror') && !/<script>alert/.test(p.text), url);
  }
});

// ---------------------------------------------------------------- 16. Sem injeção de SQL
test('SQL injection: busca, filtros, ordenação e IDs', async () => {
  const before = db.get().prepare('SELECT COUNT(*) AS n FROM recipes').get().n;
  const payloads = ["' OR 1=1 --", '" OR ""="', "bolo'); DROP TABLE recipes; --", '*', '"', 'NEAR(a b)', 'title:x OR code:*', "1; DELETE FROM users", '%', '\\'];
  for (const p of payloads) {
    for (const k of ['q', 'category', 'tag', 'diet', 'sort', 'ingredients', 'code', 'maxTime', 'difficulty', 'page', 'perPage']) {
      const r = await stranger.req('GET', `/api/v1/recipes?${k}=${encodeURIComponent(p)}`);
      assert.ok([200, 400].includes(r.status), `${k}=${p} → ${r.status}`);
      if (r.status === 200) assert.ok(r.data.items.every((i) => i.status === 'published'), `${k}=${p} vazou rascunho`);
    }
    assert.notEqual((await stranger.req('GET', `/api/v1/recipes/${encodeURIComponent(p)}`)).status, 500);
    assert.notEqual((await stranger.req('GET', `/busca?q=${encodeURIComponent(p)}`)).status, 500);
    assert.notEqual((await stranger.req('GET', `/api/v1/search/suggest?q=${encodeURIComponent(p)}`)).status, 500);
  }
  assert.equal(db.get().prepare('SELECT COUNT(*) AS n FROM recipes').get().n, before);
  assert.ok(db.get().prepare('SELECT COUNT(*) AS n FROM users').get().n >= 2);
  // Parâmetros repetidos/aninhados não quebram o servidor
  assert.equal((await stranger.req('GET', '/api/v1/recipes?q=a&q=b&page[x]=1&sort[]=title')).status, 200);
});

// ---------------------------------------------------------------- 2/8. .env e banco nunca expostos
test('arquivos sensíveis e travessia de diretório', async () => {
  fs.writeFileSync(path.join(process.env.UPLOADS_DIR, '.env'), 'SEGREDO=1');
  for (const p of ['/.env', '/.git/config', '/data/chef.db', '/data/.secret', '/uploads/.env', '/uploads/../data/.secret', '/uploads/%2e%2e/data/.secret', '/uploads/..%2fdata%2f.secret', '/%2e%2e/%2e%2e/etc/passwd', '/package.json', '/src/config.js', '/server.js', '/node_modules/express/package.json', '/chef.db', '/backup.sql.bak']) {
    const r = await stranger.req('GET', p);
    assert.ok([400, 403, 404].includes(r.status), `${p} → ${r.status}`);
    assert.ok(!r.text.includes('SEGREDO=') && !r.text.includes('SQLite format'), p);
  }
});

test('o banco e o segredo de sessão ficam fora da pasta pública e com permissão restrita', () => {
  const config = require('../src/config');
  assert.ok(!config.dataDir.startsWith(path.join(config.root, 'public')));
  const mode = fs.statSync(config.dataDir).mode & 0o777;
  assert.equal(mode & 0o077, 0, `pasta de dados acessível por outros usuários (${mode.toString(8)})`);
});

// ---------------------------------------------------------------- 15. Upload protegido
test('upload: tipo falso, HTML/SVG disfarçado, arquivo grande e excesso de arquivos', async () => {
  const send = async (parts) => {
    const fd = new FormData();
    for (const [buf, type, name] of parts) fd.append('files', new Blob([buf], { type }), name);
    return admin.req('POST', '/api/v1/uploads', { body: fd });
  };
  assert.equal((await send([['<html><script>alert(1)</script>', 'image/png', 'foto.png']])).status, 415, 'HTML com tipo image/png');
  assert.equal((await send([['<svg onload=alert(1)>', 'image/svg+xml', 'x.svg']])).status, 415, 'SVG');
  assert.equal((await send([['#!/bin/sh', 'application/x-sh', 'x.sh']])).status, 415);
  assert.equal((await send([[Buffer.alloc(1.5 * 1024 * 1024, 1), 'image/jpeg', 'grande.jpg']])).status, 413, 'acima do limite');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  assert.equal((await send(Array(21).fill([png, 'image/png', 'a.png']))).status, 400, 'mais de 20 arquivos');
  const ok = await send([[png, 'image/png', '../../../etc/evil.png.php']]);
  assert.equal(ok.status, 201);
  assert.match(ok.data.files[0].url, /^\/uploads\/[a-z0-9]+-[a-f0-9]{16}\.png$/, 'nome aleatório, extensão pelo conteúdo real');
  const file = await stranger.req('GET', ok.data.files[0].url);
  assert.equal(file.status, 200);
  assert.match(file.headers.get('content-security-policy'), /sandbox/);
  assert.equal(file.headers.get('x-content-type-options'), 'nosniff');
  // Autor não apaga upload do admin
  const id = (await admin.req('GET', '/api/v1/uploads')).data.items[0].id;
  assert.equal((await author.req('DELETE', `/api/v1/uploads/${id}`)).status, 404);
  assert.equal((await author.req('GET', '/api/v1/uploads')).data.items.length, 0);
});

// ---------------------------------------------------------------- SSRF no importador
test('importador não acessa a rede interna (SSRF)', async () => {
  for (const url of ['http://127.0.0.1:3000/', 'http://localhost/', 'http://169.254.169.254/latest/meta-data/', 'http://[::1]/', 'http://10.0.0.1/', 'http://0x7f000001/', 'http://2130706433/', 'file:///etc/passwd', 'gopher://127.0.0.1/', 'http://user:pass@example.com/', 'http://example.com:22/']) {
    const r = await admin.req('POST', '/api/v1/import', { body: { url } });
    assert.equal(r.status, 400, `${url} → ${r.status} ${JSON.stringify(r.data)}`);
  }
  const { isPrivateIp } = require('../src/importer');
  for (const ip of ['::ffff:127.0.0.1', '::ffff:7f00:1', '100.64.1.1', '198.18.0.1', 'fd00::1', 'fe80::1', '0.0.0.0']) assert.ok(isPrivateIp(ip), ip);
});

// ---------------------------------------------------------------- 11/12. Debug desligado, erro sem detalhe
test('erros não revelam detalhes internos', async () => {
  const checks = [
    await admin.req('POST', '/api/v1/recipes', { body: '{"title": ', headers: { 'content-type': 'application/json' } }),
    await admin.req('POST', '/api/v1/categories', { body: { name: 'Repetida' } }).then(() => admin.req('POST', '/api/v1/categories', { body: { name: 'Repetida' } })),
    await stranger.req('GET', '/api/v1/rota-que-nao-existe'),
    await stranger.req('GET', '/pagina-que-nao-existe'),
  ];
  for (const r of checks) {
    assert.ok(r.status >= 400 && r.status < 500, String(r.status));
    assert.ok(!/at .*\.js:\d+|SQLITE|constraint|node_modules|stack/i.test(r.text), r.text.slice(0, 200));
  }
  assert.equal(checks[1].status, 409);
  assert.equal(checks[0].headers.get('x-powered-by'), null);
});

// ---------------------------------------------------------------- 19. Headers e CORS certos
test('cabeçalhos de segurança nas páginas, na API e nos arquivos', async () => {
  const page = await stranger.req('GET', '/');
  const csp = page.headers.get('content-security-policy');
  assert.match(csp, /script-src 'nonce-[^']+' 'strict-dynamic'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-ancestors 'self'/);
  assert.match(csp, /base-uri 'self'/);
  assert.equal(page.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(page.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.ok(page.headers.get('permissions-policy'));
  const tagsOnly = page.text.replace(/"[^"]*"/g, '""');
  assert.ok(!/<[a-z][^>]*\son[a-z]+\s*=/i.test(tagsOnly), 'sem handlers inline em tags (bloqueados pelo CSP)');
  const api = await stranger.req('GET', '/api/v1/recipes');
  assert.equal(api.headers.get('content-security-policy'), "default-src 'none'; frame-ancestors 'none'");
  assert.equal(api.headers.get('access-control-allow-origin'), '*');
  assert.equal(api.headers.get('access-control-allow-credentials'), null, 'CORS nunca libera cookies para outros sites');
  const pre = await fetch(`${base}/api/v1/recipes`, { method: 'OPTIONS', headers: { origin: 'https://outro.com', 'access-control-request-method': 'POST' } });
  assert.equal(pre.status, 204);
  const embed = await stranger.req('GET', '/embed/PUB001');
  assert.match(embed.headers.get('content-security-policy'), /frame-ancestors \*/, 'apenas o embed pode ser colocado em iframe de outros sites');
});

test('cache: dados privados nunca ficam em cache (navegador, CDN ou offline)', async () => {
  for (const u of ['/admin', `/receita/${adminDraft.slug}`, '/receitas']) assert.match((await admin.req('GET', u)).headers.get('cache-control'), /no-store/, u);
  for (const u of ['/api/v1/stats', '/api/v1/export', '/api/v1/keys', '/api/v1/recipes']) assert.match((await admin.req('GET', u)).headers.get('cache-control'), /no-store/, u);
  assert.match((await stranger.req('GET', '/api/v1/recipes')).headers.get('cache-control'), /public/);
  const sw = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');
  assert.match(sw, /no-store\|private/, 'service worker respeita no-store/private');
});

// ---------------------------------------------------------------- 3/18. Nada de senha no código, Git sem segredo vazado
test('repositório: nenhum segredo versionado', () => {
  const root = path.join(__dirname, '..');
  let files;
  try { files = execSync('git ls-files', { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean); } catch { return; }
  assert.ok(!files.some((f) => /(^|\/)\.env($|\.)(?!example)|\.db$|\.sqlite|(^|\/)data\/|\.pem$|\.key$|id_rsa/.test(f)), 'arquivo sensível versionado');
  const patterns = [/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, /AKIA[0-9A-Z]{16}/, /sk_live_[0-9a-zA-Z]{20,}/, /ghp_[0-9A-Za-z]{36}/, /chef_[A-Za-z0-9_-]{32}/, /xox[bp]-[0-9A-Za-z-]{20,}/, /AIza[0-9A-Za-z_-]{35}/];
  for (const f of files) {
    if (/\.(png|jpg|ico|lock)$/.test(f) || f === 'package-lock.json') continue;
    const content = fs.readFileSync(path.join(root, f), 'utf8');
    for (const p of patterns) assert.ok(!p.test(content), `${f} contém algo parecido com segredo (${p})`);
  }
  const gi = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  for (const entry of ['.env', 'data/', 'uploads/', 'node_modules/']) assert.ok(gi.includes(entry), `.gitignore sem ${entry}`);
});

// ---------------------------------------------------------------- Medição e consentimento
test('GA4/AdSense entram com Consent Mode "negado" por padrão (LGPD)', async () => {
  await admin.req('PUT', '/api/v1/settings', { body: { ga4Id: 'G-TESTE12345', adsenseClient: 'ca-pub-1234567890123456', gtmId: 'GTM-ABC1234', metaPixelId: '1234567890' } });
  const page = await stranger.req('GET', '/');
  assert.match(page.text, /googletagmanager\.com\/gtag\/js\?id=G-TESTE12345/);
  assert.match(page.text, /gtag\('consent','default'/);
  assert.match(page.text, /adsbygoogle\.js\?client=ca-pub-1234567890123456/);
  assert.match(page.text, /GTM-ABC1234/);
  assert.match(page.text, /class="consent"/);
  assert.ok(!page.text.includes('connect.facebook.net'), 'Pixel só carrega após o consentimento (pelo app.js)');
  const robots = await stranger.req('GET', '/ads.txt');
  assert.match(robots.text, /google\.com, pub-1234567890123456, DIRECT/);
});
