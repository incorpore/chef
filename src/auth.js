'use strict';
const crypto = require('node:crypto');
const config = require('./config');
const db = require('./db');

const COOKIE = 'chef_session';
const SESSION_DAYS = 30;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [, saltHex, hashHex] = String(stored || '').split('$');
  if (!saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), 64);
  const expected = Buffer.from(hashHex, 'hex');
  return expected.length === hash.length && crypto.timingSafeEqual(hash, expected);
}

function sign(value) {
  return crypto.createHmac('sha256', config.secret).update(value).digest('base64url');
}

function createSessionToken(userId) {
  const exp = Date.now() + SESSION_DAYS * 86400e3;
  const payload = `${userId}.${exp}`;
  return `${payload}.${sign(payload)}`;
}

function readSessionToken(token) {
  if (!token) return null;
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const payload = `${parts[0]}.${parts[1]}`;
  const expected = sign(payload);
  if (expected.length !== parts[2].length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts[2]))) return null;
  if (Number(parts[1]) < Date.now()) return null;
  return Number(parts[0]);
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setSessionCookie(res, userId) {
  const token = createSessionToken(userId);
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${config.isProd ? '; Secure' : ''}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
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
    .run(name || 'Chave', key.slice(0, 10), hashApiKey(key), userId);
  return { id: Number(info.lastInsertRowid), key, prefix: key.slice(0, 10) };
}

/** Middleware: popula req.user a partir do cookie de sessão ou do header Authorization: Bearer <api key>. */
function loadUser(req, _res, next) {
  req.user = null;
  const auth = req.headers.authorization || '';
  const d = db.get();
  if (auth.startsWith('Bearer ')) {
    const row = d.prepare('SELECT k.id AS key_id, u.* FROM api_keys k JOIN users u ON u.id = k.user_id WHERE k.key_hash = ?').get(hashApiKey(auth.slice(7).trim()));
    if (row) {
      d.prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?").run(row.key_id);
      req.user = row;
      req.viaApiKey = true;
    }
  } else {
    const id = readSessionToken(parseCookies(req.headers.cookie)[COOKIE]);
    if (id) req.user = d.prepare('SELECT * FROM users WHERE id = ?').get(id) || null;
  }
  next();
}

function requireUser(req, res, next) {
  if (req.user) return next();
  if (req.path.startsWith('/api/') || req.originalUrl.startsWith('/api/')) return res.status(401).json({ error: 'Não autenticado' });
  return res.redirect(`/admin/login?next=${encodeURIComponent(req.originalUrl)}`);
}

function requireAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') return next();
  if (!req.user) return requireUser(req, res, next);
  return res.status(403).json({ error: 'Apenas administradores' });
}

/** Proteção CSRF simples para requisições de sessão (cookie): exige mesma origem. */
function sameOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.viaApiKey) return next();
  const origin = req.headers.origin || req.headers.referer;
  if (!origin) return next();
  try {
    const o = new URL(origin);
    if (o.host === req.headers.host) return next();
  } catch { /* cai no erro abaixo */ }
  return res.status(403).json({ error: 'Origem inválida' });
}

function userCount() {
  return db.get().prepare('SELECT COUNT(*) AS n FROM users').get().n;
}

function createUser({ email, name, password, role = 'author' }) {
  if (!email || !password || String(password).length < 8) throw Object.assign(new Error('E-mail e senha (mín. 8 caracteres) são obrigatórios'), { status: 400 });
  const info = db.get()
    .prepare('INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(String(email).trim(), String(name || email).trim(), hashPassword(password), role);
  return Number(info.lastInsertRowid);
}

module.exports = {
  hashPassword, verifyPassword, setSessionCookie, clearSessionCookie, loadUser, requireUser, requireAdmin,
  sameOrigin, createApiKey, publicUser, userCount, createUser, parseCookies, readSessionToken, createSessionToken,
};
