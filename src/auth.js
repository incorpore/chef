'use strict';
const crypto = require('node:crypto');
const config = require('./config');
const db = require('./db');

const COOKIE = config.isProd ? '__Host-chef_session' : 'chef_session';
const SESSION_DAYS = 30;
const DUMMY_HASH = `scrypt$${'0'.repeat(32)}$${'0'.repeat(128)}`;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [, saltHex, hashHex] = String(stored || '').split('$');
  if (!saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(String(password ?? ''), Buffer.from(saltHex, 'hex'), 64);
  const expected = Buffer.from(hashHex, 'hex');
  return expected.length === hash.length && crypto.timingSafeEqual(hash, expected);
}

function sign(value) {
  return crypto.createHmac('sha256', config.secret).update(value).digest('base64url');
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Token = id.versão.expiração.assinatura. Trocar a senha ou "sair de todos" incrementa a versão e invalida tokens antigos. */
function createSessionToken(user) {
  const exp = Date.now() + SESSION_DAYS * 86400e3;
  const payload = `${user.id}.${user.session_version || 0}.${exp}`;
  return `${payload}.${sign(payload)}`;
}

function readSessionToken(token) {
  if (!token) return null;
  const parts = String(token).split('.');
  if (parts.length !== 4) return null;
  const payload = parts.slice(0, 3).join('.');
  if (!safeEqual(sign(payload), parts[3])) return null;
  if (Number(parts[2]) < Date.now()) return null;
  return { id: Number(parts[0]), version: Number(parts[1]) };
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* cookie malformado */ }
  }
  return out;
}

function setSessionCookie(res, user) {
  res.setHeader('Set-Cookie', `${COOKIE}=${createSessionToken(user)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${config.isProd ? '; Secure' : ''}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${config.isProd ? '; Secure' : ''}`);
}

function publicUser(u) {
  if (!u) return null;
  return { id: u.id, email: u.email, name: u.name, role: u.role, bio: u.bio, avatar: u.avatar };
}

function hashApiKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

function createApiKey(userId, name) {
  const key = `chef_${crypto.randomBytes(24).toString('base64url')}`;
  const info = db.get()
    .prepare('INSERT INTO api_keys (name, prefix, key_hash, user_id) VALUES (?, ?, ?, ?)')
    .run(String(name || 'Chave').slice(0, 60), key.slice(0, 10), hashApiKey(key), userId);
  return { id: Number(info.lastInsertRowid), key, prefix: key.slice(0, 10) };
}

/** Popula req.user a partir do cookie de sessão ou do header Authorization: Bearer <chave>. */
function loadUser(req, res, next) {
  req.user = null;
  const auth = req.headers.authorization || '';
  const d = db.get();
  if (/^Bearer\s+/i.test(auth)) {
    const row = d.prepare('SELECT k.id AS key_id, u.* FROM api_keys k JOIN users u ON u.id = k.user_id WHERE k.key_hash = ?').get(hashApiKey(auth.replace(/^Bearer\s+/i, '').trim()));
    if (!row) return res.status(401).json({ error: 'Chave de API inválida' });
    d.prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?").run(row.key_id);
    req.user = row;
    req.viaApiKey = true;
  } else {
    const s = readSessionToken(parseCookies(req.headers.cookie)[COOKIE]);
    if (s) {
      const u = d.prepare('SELECT * FROM users WHERE id = ?').get(s.id);
      if (u && (u.session_version || 0) === s.version) req.user = u;
    }
  }
  next();
}

function isApi(req) {
  return req.originalUrl.startsWith('/api/');
}

function requireUser(req, res, next) {
  if (req.user) return next();
  if (isApi(req)) return res.status(401).json({ error: 'Não autenticado' });
  return res.redirect(`/admin/login?next=${encodeURIComponent(req.originalUrl)}`);
}

function requireAdmin(req, res, next) {
  if (!req.user) return requireUser(req, res, next);
  if (req.user.role === 'admin') return next();
  if (isApi(req)) return res.status(403).json({ error: 'Apenas administradores' });
  return res.status(403).send('Apenas administradores');
}

const isAdmin = (user) => !!user && user.role === 'admin';

/** Autor só altera o que é dele; administrador altera tudo. Nunca confia no author_id vindo do cliente. */
function canEditRecipe(user, recipe) {
  return !!user && !!recipe && (isAdmin(user) || recipe.author_id === user.id);
}

/** Proteção CSRF: para requisições com cookie, exige mesma origem. */
function sameOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.viaApiKey) return next();
  const origin = req.headers.origin || req.headers.referer;
  if (!origin) {
    // Navegadores modernos sempre enviam Origin em POST; sem ele e com cookie, recusa por precaução
    if (req.headers.cookie && req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') return res.status(403).json({ error: 'Origem inválida' });
    return next();
  }
  try {
    if (new URL(origin).host === req.headers.host) return next();
  } catch { /* cai no erro abaixo */ }
  return res.status(403).json({ error: 'Origem inválida' });
}

function userCount() {
  return db.get().prepare('SELECT COUNT(*) AS n FROM users').get().n;
}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

function validatePassword(password) {
  const p = String(password || '');
  if (p.length < 8) return 'A senha deve ter ao menos 8 caracteres';
  if (p.length > 200) return 'Senha longa demais';
  if (/^(.)\1+$/.test(p) || ['12345678', '123456789', 'password', 'senha123', 'senha1234', 'qwerty123'].includes(p.toLowerCase())) return 'Senha fraca demais';
  return null;
}

function createUser({ email, name, password, role = 'author' }) {
  const e = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(e)) throw Object.assign(new Error('E-mail inválido'), { status: 400 });
  const pwErr = validatePassword(password);
  if (pwErr) throw Object.assign(new Error(pwErr), { status: 400 });
  if (db.get().prepare('SELECT 1 FROM users WHERE email = ?').get(e)) throw Object.assign(new Error('Já existe um usuário com este e-mail'), { status: 409 });
  const info = db.get()
    .prepare('INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(e, String(name || e.split('@')[0]).trim().slice(0, 80), hashPassword(password), role === 'admin' ? 'admin' : 'author');
  return Number(info.lastInsertRowid);
}

/** Login com tempo constante: mesmo e-mail inexistente custa um scrypt (evita descobrir quais e-mails existem). */
function authenticate(email, password) {
  const user = db.get().prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').trim().toLowerCase());
  const ok = verifyPassword(password, user ? user.password_hash : DUMMY_HASH);
  return ok && user ? user : null;
}

function bumpSessionVersion(userId) {
  db.get().prepare('UPDATE users SET session_version = session_version + 1 WHERE id = ?').run(userId);
}

function audit(req, action, detail = '') {
  try {
    const ipHash = crypto.createHash('sha256').update(`${req?.ip || ''}${config.secret}`).digest('hex').slice(0, 16);
    db.get().prepare('INSERT INTO audit_log (user_id, action, detail, ip_hash) VALUES (?, ?, ?, ?)').run(req?.user?.id ?? null, action, String(detail).slice(0, 500), ipHash);
  } catch { /* auditoria nunca derruba a requisição */ }
}

/**
 * Configuração inicial segura: em produção exige o SETUP_TOKEN (definido no ambiente ou impresso no log
 * na primeira inicialização), para que um estranho não crie o administrador antes de você.
 */
let generatedSetupToken = '';
function setupToken() {
  if (config.setupToken) return config.setupToken;
  if (!config.isProd) return '';
  if (!generatedSetupToken) generatedSetupToken = crypto.randomBytes(12).toString('base64url');
  return generatedSetupToken;
}

/** Cria o administrador a partir de ADMIN_EMAIL / ADMIN_PASSWORD, se definidos e não houver usuários. */
function bootstrapAdmin() {
  if (userCount() > 0) return null;
  const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME } = process.env;
  if (ADMIN_EMAIL && ADMIN_PASSWORD) {
    createUser({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, name: ADMIN_NAME || 'Admin', role: 'admin' });
    return 'env';
  }
  return setupToken() ? 'token' : 'open';
}

module.exports = {
  COOKIE, hashPassword, verifyPassword, setSessionCookie, clearSessionCookie, loadUser, requireUser, requireAdmin, isAdmin, canEditRecipe,
  sameOrigin, createApiKey, publicUser, userCount, createUser, validatePassword, authenticate, bumpSessionVersion, audit,
  parseCookies, readSessionToken, createSessionToken, setupToken, bootstrapAdmin, safeEqual, EMAIL_RE,
};
