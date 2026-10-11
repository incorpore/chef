'use strict';
/** E-mail: esqueci a senha, convite, aviso de comentário, newsletter (confirmação dupla, descadastro, envio) e SMTP real. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chef-mail-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.UPLOADS_DIR = path.join(tmp, 'uploads');
process.env.RATE_LIMIT = 'off';
process.env.MAIL_RATE_PER_MIN = '6000';
delete process.env.MAIL_TRANSPORT;
delete process.env.SMTP_HOST;

const db = require('../src/db');
const auth = require('../src/auth');
const settings = require('../src/settings');
const mail = require('../src/mail');
const notify = require('../src/notify');
const { createApp } = require('../src/app');

let server;
let base;
const PASS = `Pw-${crypto.randomBytes(8).toString('hex')}`;
const PASS2 = `Pw-${crypto.randomBytes(8).toString('hex')}`;
const SITE = 'https://receitas.exemplo.com.br';
let recipe;

function client() {
  let cookie = '';
  return {
    async req(method, url, { body, headers = {} } = {}) {
      const h = { ...headers };
      if (cookie) h.cookie = cookie;
      let payload = body;
      if (body && typeof body !== 'string') { payload = JSON.stringify(body); h['content-type'] = 'application/json'; }
      const res = await fetch(base + url, { method, headers: h, body: payload, redirect: 'manual' });
      const sc = res.headers.get('set-cookie');
      if (sc && /^chef_session=/.test(sc)) cookie = /Max-Age=0/.test(sc) ? '' : sc.split(';')[0];
      const text = await res.text();
      let data = text;
      try { data = JSON.parse(text); } catch { /* html */ }
      return { status: res.status, data, text, headers: res.headers };
    },
    get cookie() { return cookie; },
  };
}
const admin = client();
const author = client();
const visitor = client();
const sent = () => mail.outbox;
const lastTo = (to) => [...mail.outbox].reverse().find((m) => String(m.to).includes(to));
const linkIn = (msg, re) => (msg.text.match(re) || [])[0];
const waitFor = async (fn, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 20)); } return false; };

test.before(async () => {
  db.open(':memory:');
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  auth.createUser({ email: 'dona@exemplo.com', name: 'Dona', password: PASS, role: 'admin' });
  auth.createUser({ email: 'autor@exemplo.com', name: 'Autor', password: PASS, role: 'author' });
  await admin.req('POST', '/api/v1/auth/login', { body: { email: 'dona@exemplo.com', password: PASS } });
  await author.req('POST', '/api/v1/auth/login', { body: { email: 'autor@exemplo.com', password: PASS } });
  recipe = (await author.req('POST', '/api/v1/recipes', { body: { title: 'Bolo de laranja', description: 'Fofinho', ingredients: '2 laranjas', steps: 'Bata e asse por 40 minutos.', status: 'published' } })).data;
});
test.after(() => { server.close(); db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('sem SMTP: o site funciona e as funções de e-mail ficam desligadas com mensagem clara', async () => {
  assert.equal(mail.isConfigured(), false);
  const f = await visitor.req('POST', '/api/v1/auth/forgot', { body: { email: 'dona@exemplo.com' } });
  assert.equal(f.status, 503);
  const s = await visitor.req('POST', '/api/v1/subscribe', { body: { email: 'leitor0@exemplo.com' } });
  assert.equal(s.data.pending, false, 'sem e-mail, a inscrição é confirmada na hora');
  const page = await visitor.req('GET', '/admin/esqueci');
  assert.match(page.text, /reset-password\.js/);
  const st = await admin.req('GET', '/api/v1/mail/status');
  assert.equal(st.data.configured, false);
});

test('com SMTP (memória): status, e-mail de teste e bloqueio para não-admin', async () => {
  process.env.MAIL_TRANSPORT = 'memory';
  settings.update({ siteUrl: SITE });
  const st = await admin.req('GET', '/api/v1/mail/status');
  assert.equal(st.data.configured, true);
  assert.equal(JSON.stringify(st.data).includes('SMTP_PASS'), false);
  const t = await admin.req('POST', '/api/v1/mail/test');
  assert.equal(t.status, 200);
  assert.equal(lastTo('dona@').subject, '✅ Teste de e-mail — Chef');
  for (const [m, u] of [['GET', '/api/v1/mail/status'], ['POST', '/api/v1/mail/test'], ['GET', '/api/v1/newsletter'], ['POST', '/api/v1/newsletter/campaigns']]) {
    assert.equal((await author.req(m, u, { body: m === 'POST' ? {} : undefined })).status, 403, `${m} ${u}`);
  }
});

test('esqueci a senha: resposta igual para quem existe e quem não existe, link de uso único e válido por 1h', async () => {
  const before = sent().length;
  const a = await visitor.req('POST', '/api/v1/auth/forgot', { body: { email: 'ninguem@exemplo.com' } });
  const b = await visitor.req('POST', '/api/v1/auth/forgot', { body: { email: 'DONA@exemplo.com' }, headers: { host: 'site-do-atacante.com' } });
  assert.equal(a.status, 200);
  assert.deepEqual(a.data, b.data, 'não revela se o e-mail tem conta');
  await waitFor(() => sent().length > before);
  assert.equal(sent().length, before + 1, 'só a conta existente recebe');
  const msg = lastTo('dona@');
  const link = linkIn(msg, /https?:\/\/\S+\/admin\/redefinir\?t=[\w-]+/);
  assert.ok(link.startsWith(`${SITE}/admin/redefinir`), `link usa o endereço configurado, nunca o Host da requisição: ${link}`);
  assert.ok(!msg.html.includes('site-do-atacante'));
  const token = new URL(link).searchParams.get('t');
  assert.equal(db.get().prepare('SELECT COUNT(*) AS n FROM password_resets WHERE token_hash = ?').get(token).n, 0, 'token não fica em texto puro no banco');
  const page = await visitor.req('GET', `/admin/redefinir?t=${token}`);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
  assert.equal((await visitor.req('POST', '/api/v1/auth/reset', { body: { token, password: '123' } })).status, 400, 'senha fraca recusada');
  const ok = await visitor.req('POST', '/api/v1/auth/reset', { body: { token, password: PASS2 } });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.user.email, 'dona@exemplo.com');
  assert.equal((await visitor.req('POST', '/api/v1/auth/reset', { body: { token, password: PASS2 } })).status, 400, 'link não pode ser usado duas vezes');
  assert.equal((await admin.req('GET', '/api/v1/auth/me')).data.user, null, 'sessões antigas foram encerradas');
  assert.equal((await visitor.req('POST', '/api/v1/auth/login', { body: { email: 'dona@exemplo.com', password: PASS } })).status, 401, 'senha antiga não vale mais');
  assert.equal((await admin.req('POST', '/api/v1/auth/login', { body: { email: 'dona@exemplo.com', password: PASS2 } })).status, 200);
});

test('esqueci a senha: link expirado não vale e cada conta recebe no máximo 3 por hora', async () => {
  const user = db.get().prepare("SELECT * FROM users WHERE email = 'autor@exemplo.com'").get();
  const token = notify.createResetToken(user.id);
  db.get().prepare("UPDATE password_resets SET expires_at = '2000-01-01T00:00:00Z'").run();
  assert.equal((await visitor.req('POST', '/api/v1/auth/reset', { body: { token, password: PASS2 } })).status, 400);
  const before = sent().length;
  for (let i = 0; i < 5; i++) await visitor.req('POST', '/api/v1/auth/forgot', { body: { email: 'autor@exemplo.com' } });
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(sent().length - before, 3);
});

test('convite: admin convida por e-mail e a pessoa cria a própria senha', async () => {
  const r = await admin.req('POST', '/api/v1/users', { body: { name: 'Nova Autora', email: 'nova@exemplo.com', role: 'author', invite: true } });
  assert.equal(r.status, 201);
  assert.equal(r.data.invited, true);
  const msg = lastTo('nova@');
  assert.match(msg.subject, /convidado/);
  const link = linkIn(msg, /https?:\/\/\S+\/admin\/redefinir\?t=[\w-]+&convite=1/);
  const token = new URL(link).searchParams.get('t');
  const page = await visitor.req('GET', `/admin/redefinir?t=${token}&convite=1`);
  assert.match(page.text, /Crie sua senha/);
  const nova = client();
  assert.equal((await nova.req('POST', '/api/v1/auth/reset', { body: { token, password: PASS2 } })).status, 200);
  assert.equal((await nova.req('GET', '/api/v1/auth/me')).data.user.email, 'nova@exemplo.com');
});

test('comentário novo avisa o autor da receita e a administradora, com conteúdo escapado', async () => {
  const before = sent().length;
  const xss = '<script>alert(1)</script><img src=x onerror=alert(2)>';
  const stranger = client(); // visitante sem login (quem é dono/admin não gera aviso para si mesmo)
  const c = await stranger.req('POST', `/api/v1/recipes/${recipe.id}/comments`, { body: { name: `Ana ${xss}`, body: `Ficou ótimo! ${xss}`, rating: 5 } });
  assert.equal(c.status, 201);
  await waitFor(() => sent().slice(before).some((m) => /comentário/i.test(m.subject)));
  const msg = sent().slice(before).find((m) => /comentário/i.test(m.subject));
  assert.ok(msg, 'e-mail de aviso enviado');
  assert.ok(msg.to.includes('autor@exemplo.com') && msg.to.includes('dona@exemplo.com'), msg.to);
  assert.match(msg.subject, /aguardando aprovação/);
  assert.ok(!msg.html.includes('<script>alert') && !msg.html.includes('<img src=x'), 'HTML do comentário é escapado no e-mail');
  assert.match(msg.html, /\/admin\/comentarios/);
  settings.update({ notifyComments: false });
  const n = sent().length;
  await stranger.req('POST', `/api/v1/recipes/${recipe.id}/comments`, { body: { name: 'Bia', body: 'oi' } });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(sent().length, n, 'aviso pode ser desligado');
  settings.update({ notifyComments: true });
});

test('newsletter: confirmação dupla, boas-vindas, proteção contra flood e descadastro em um clique', async () => {
  const before = sent().length;
  const r = await visitor.req('POST', '/api/v1/subscribe', { body: { email: 'Leitor1@Exemplo.com' } });
  assert.equal(r.data.pending, true);
  assert.equal(db.get().prepare("SELECT status FROM subscribers WHERE email = 'leitor1@exemplo.com'").get().status, 'pending');
  await waitFor(() => sent().length > before);
  const confirmMsg = lastTo('leitor1@');
  assert.match(confirmMsg.subject, /Confirme/);
  await visitor.req('POST', '/api/v1/subscribe', { body: { email: 'leitor1@exemplo.com' } });
  await new Promise((r2) => setTimeout(r2, 100));
  assert.equal(sent().filter((m) => m.to === 'leitor1@exemplo.com').length, 1, 'repetir a inscrição não reenvia na hora (anti-flood)');
  const link = linkIn(confirmMsg, /https?:\/\/\S+\/newsletter\/confirmar\?t=[\w-]+/);
  assert.equal((await visitor.req('GET', '/newsletter/confirmar?t=invalido')).status, 400);
  const page = await visitor.req('GET', new URL(link).pathname + new URL(link).search);
  assert.equal(page.status, 200);
  assert.match(page.text, /Inscrição confirmada/);
  await waitFor(() => lastTo('leitor1@')?.subject.includes('Bem-vindo'));
  const welcome = lastTo('leitor1@');
  assert.match(welcome.subject, /Bem-vindo/);
  assert.match(welcome.headers['List-Unsubscribe'], /\/newsletter\/sair\?e=/);
  assert.equal(welcome.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.match(welcome.html, /Bolo de laranja/);
  // Mesma resposta para e-mail já confirmado (não revela quem está na lista)
  assert.equal((await visitor.req('POST', '/api/v1/subscribe', { body: { email: 'leitor1@exemplo.com' } })).data.pending, true);
  // Descadastro: GET só pergunta; POST com token errado falha; POST certo cancela
  const unsub = new URL(welcome.headers['List-Unsubscribe'].slice(1, -1));
  const ask = await visitor.req('GET', unsub.pathname + unsub.search);
  assert.match(ask.text, /Cancelar inscrição\?/);
  assert.equal(db.get().prepare("SELECT status FROM subscribers WHERE email = 'leitor1@exemplo.com'").get().status, 'confirmed', 'abrir o link (ou um robô de e-mail abrir) não cancela');
  assert.equal((await visitor.req('POST', `/newsletter/sair?e=leitor1%40exemplo.com&t=errado`)).status, 400);
  const one = await fetch(base + unsub.pathname + unsub.search, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' });
  assert.equal(one.status, 200);
  assert.equal(db.get().prepare("SELECT status FROM subscribers WHERE email = 'leitor1@exemplo.com'").get().status, 'unsubscribed');
});

test('envio da newsletter: só para confirmados, com descadastro em cada e-mail, sem duplicar por engano', async () => {
  for (const e of ['a@exemplo.com', 'b@exemplo.com', 'c@exemplo.com']) db.get().prepare("INSERT INTO subscribers (email, status, confirmed_at) VALUES (?, 'confirmed', datetime('now'))").run(e);
  db.get().prepare("INSERT INTO subscribers (email, status) VALUES ('pendente@exemplo.com', 'pending')").run();
  const testSend = await admin.req('POST', '/api/v1/newsletter/campaigns', { body: { recipeId: recipe.id, test: true, subject: 'Olá' } });
  assert.equal(testSend.status, 200);
  assert.match(lastTo('dona@').subject, /^\[TESTE\] Olá/);
  const before = sent().length;
  const c = await admin.req('POST', '/api/v1/newsletter/campaigns', { body: { recipeId: recipe.id, subject: 'Receita nova: Bolo de laranja\r\nBcc: x@evil.com', intro: 'Oi! <b>teste</b>' } });
  assert.equal(c.status, 201, JSON.stringify(c.data));
  assert.equal(c.data.total, 4, 'leitor0 (confirmado sem SMTP) + 3 novos; pendente e descadastrado ficam de fora');
  assert.ok(await waitFor(() => db.get().prepare('SELECT status FROM newsletter_campaigns WHERE id = ?').get(c.data.id).status === 'done', 5000), 'envio terminou');
  const batch = sent().slice(before);
  assert.deepEqual(batch.map((m) => m.to).sort(), ['a@exemplo.com', 'b@exemplo.com', 'c@exemplo.com', 'leitor0@exemplo.com']);
  assert.ok(batch.every((m) => m.headers['List-Unsubscribe'] && m.html.includes('Cancelar inscrição')));
  assert.ok(batch.every((m) => !/[\r\n]/.test(m.subject)), 'assunto sem quebra de linha (sem injeção de cabeçalho)');
  assert.ok(!batch[0].html.includes('<b>teste</b>'), 'mensagem de abertura é escapada');
  assert.match(batch[0].html, /utm_source=newsletter/);
  const again = await admin.req('POST', '/api/v1/newsletter/campaigns', { body: { recipeId: recipe.id } });
  assert.equal(again.status, 409, 'avisa antes de mandar a mesma receita de novo');
  const nl = await admin.req('GET', '/api/v1/newsletter');
  assert.equal(nl.data.campaigns[0].sent, 4);
  assert.equal(nl.data.subscribers.confirmed, 4);
});

test('endereço do site é aprendido no login da administradora (e nunca de visitante)', async () => {
  settings.update({ siteUrl: '' });
  await visitor.req('POST', '/api/v1/subscribe', { body: { email: 'z@exemplo.com' }, headers: { origin: 'http://evil.com' } });
  assert.equal(settings.all().siteUrl, '');
  const host = new URL(base).host;
  await admin.req('POST', '/api/v1/auth/login', { body: { email: 'dona@exemplo.com', password: PASS2 }, headers: { origin: base, host } });
  assert.equal(settings.all().siteUrl, base);
  settings.update({ siteUrl: SITE });
});

test('SMTP de verdade: autentica, entrega e traduz erro de senha errada', async () => {
  const { SMTPServer } = require('smtp-server');
  const received = [];
  const smtp = new SMTPServer({
    authOptional: false, disabledCommands: ['STARTTLS'], logger: false,
    onAuth(a, s, cb) { return a.username === 'chef' && a.password === 'segredo-smtp' ? cb(null, { user: 'chef' }) : cb(Object.assign(new Error('Invalid login'), { responseCode: 535 })); },
    onData(stream, s, cb) { let raw = ''; stream.on('data', (d) => { raw += d; }); stream.on('end', () => { received.push({ raw, user: s.user }); cb(); }); },
  });
  await new Promise((r) => smtp.listen(0, '127.0.0.1', r));
  const port = smtp.server.address().port;
  delete process.env.MAIL_TRANSPORT;
  Object.assign(process.env, { SMTP_HOST: '127.0.0.1', SMTP_PORT: String(port), SMTP_USER: 'chef', SMTP_PASS: 'segredo-smtp', MAIL_FROM: 'Chef <contato@exemplo.com>' });
  try {
    const ok = await admin.req('POST', '/api/v1/mail/test');
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.equal(received.length, 1);
    assert.equal(received[0].user, 'chef');
    assert.match(received[0].raw, /From: Chef <contato@exemplo\.com>/);
    assert.match(received[0].raw, /To: dona@exemplo\.com/);
    process.env.SMTP_PASS = 'senha-errada';
    const bad = await admin.req('POST', '/api/v1/mail/test');
    assert.equal(bad.status, 400);
    assert.match(bad.data.error, /senha do SMTP recusados/);
    assert.ok(!JSON.stringify(bad.data).includes('senha-errada'), 'a senha nunca aparece na resposta');
  } finally {
    for (const k of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM']) delete process.env[k];
    process.env.MAIL_TRANSPORT = 'memory';
    await new Promise((r) => smtp.close(r));
  }
});
