'use strict';
const crypto = require('node:crypto');
const config = require('./config');

// ---------------------------------------------------------------------------
// Cabeçalhos de segurança + Content-Security-Policy com nonce por requisição
// ---------------------------------------------------------------------------

/**
 * CSP "strict-dynamic": só executam scripts com o nonce desta resposta (e os que eles carregarem,
 * como AdSense, gtag e Pixel). Scripts injetados por um atacante não têm nonce e são bloqueados.
 */
function buildCsp(nonce, { embed = false } = {}) {
  const directives = [
    "default-src 'self'",
    `script-src 'nonce-${nonce}' 'strict-dynamic' https: 'unsafe-inline'`, // https:/unsafe-inline só valem em navegadores antigos sem suporte a nonce
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${embed ? '*' : "'self'"}`,
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https:",
    "font-src 'self' data: https:",
    "style-src 'self' 'unsafe-inline' https:",
    "connect-src 'self' https:",
    'frame-src https:',
    "worker-src 'self'",
    "manifest-src 'self'",
  ];
  if (config.isProd) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}

function headers(req, res, next) {
  const nonce = crypto.randomBytes(16).toString('base64');
  res.locals.nonce = nonce;
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), payment=(), usb=(), microphone=(self), screen-wake-lock=(self)');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader('X-DNS-Prefetch-Control', 'on');
  if (config.isProd) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  const embed = req.path.startsWith('/embed/');
  if (req.path.startsWith('/api/')) {
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  } else if (req.path.startsWith('/uploads/')) {
    // Arquivos enviados nunca executam nada, mesmo que alguém consiga enviar algo malicioso
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox");
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  } else {
    res.setHeader('Content-Security-Policy', buildCsp(nonce, { embed }));
    if (!embed) res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  }
  // Toda tag <script> do HTML gerado pelo servidor recebe o nonce. Conteúdo vindo de usuários é sempre
  // escapado (vira "&lt;script"), então só scripts do template e do HTML de anúncios do admin recebem nonce.
  const send = res.send.bind(res);
  res.send = (body) => {
    if (typeof body === 'string' && body.startsWith('<!doctype html>')) {
      body = body.replace(/<script(?=[\s>])/gi, `<script nonce="${nonce}"`);
      if (!res.get('Content-Type')) res.type('html');
      if (!res.get('Cache-Control')) res.setHeader('Cache-Control', req.user ? 'private, no-store' : 'public, max-age=0, must-revalidate');
    }
    return send(body);
  };
  next();
}

// ---------------------------------------------------------------------------
// Limite de tentativas (em memória, por IP e por "balde")
// ---------------------------------------------------------------------------
const buckets = new Map();

function hit(key, max, windowMs) {
  const now = Date.now();
  let e = buckets.get(key);
  if (!e || now - e.t > windowMs) {
    e = { n: 0, t: now };
    buckets.set(key, e);
  }
  e.n++;
  return { over: e.n > max, remaining: Math.max(0, max - e.n), reset: Math.ceil((e.t + windowMs - now) / 1000) };
}

// Limpa entradas antigas para a memória não crescer indefinidamente
setInterval(() => {
  const now = Date.now();
  for (const [k, e] of buckets) if (now - e.t > 3600e3) buckets.delete(k);
}, 600e3).unref();

/** Middleware de limite por IP. `name` agrupa rotas (ex.: "login", "api"). */
function rateLimit(name, max, windowMs) {
  return (req, res, next) => {
    if (process.env.RATE_LIMIT === 'off') return next();
    const r = hit(`${name}:${req.ip}`, max, windowMs);
    res.setHeader('RateLimit-Limit', max);
    res.setHeader('RateLimit-Remaining', r.remaining);
    res.setHeader('RateLimit-Reset', r.reset);
    if (r.over) {
      res.setHeader('Retry-After', r.reset);
      return res.status(429).json({ error: 'Muitas requisições. Tente novamente em instantes.' });
    }
    next();
  };
}

// Bloqueio de conta após falhas de login seguidas (protege contra força bruta distribuída por vários IPs)
const failures = new Map();
const LOCK_AFTER = 5;
const LOCK_MS = 15 * 60e3;
function loginLocked(email) {
  const f = failures.get(String(email).toLowerCase());
  return !!(f && f.n >= LOCK_AFTER && Date.now() - f.t < LOCK_MS);
}
function loginFailed(email) {
  const key = String(email).toLowerCase();
  const f = failures.get(key);
  if (!f || Date.now() - f.t > LOCK_MS) failures.set(key, { n: 1, t: Date.now() });
  else { f.n++; f.t = Date.now(); }
}
function loginSucceeded(email) {
  failures.delete(String(email).toLowerCase());
}

function resetLimits() {
  buckets.clear();
  failures.clear();
}

// ---------------------------------------------------------------------------
// Verificação do conteúdo real dos arquivos (não confia no tipo informado pelo navegador)
// ---------------------------------------------------------------------------
function sniffMime(buf) {
  if (!buf || buf.length < 12) return null;
  const hex = buf.subarray(0, 12).toString('hex');
  const ascii = buf.subarray(0, 12).toString('latin1');
  if (hex.startsWith('ffd8ff')) return 'image/jpeg';
  if (hex.startsWith('89504e470d0a1a0a')) return 'image/png';
  if (ascii.startsWith('GIF87a') || ascii.startsWith('GIF89a')) return 'image/gif';
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'image/webp';
  if (hex.startsWith('1a45dfa3')) return 'video/webm';
  if (ascii.startsWith('OggS')) return 'video/ogg';
  if (ascii.slice(4, 8) === 'ftyp') {
    const brand = buf.subarray(8, 12).toString('latin1');
    if (/^avi[fs]/.test(brand)) return 'image/avif';
    if (brand === 'qt  ') return 'video/quicktime';
    return 'video/mp4';
  }
  return null;
}

const EXT_BY_MIME = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp', 'image/avif': '.avif', 'video/mp4': '.mp4', 'video/webm': '.webm', 'video/ogg': '.ogv', 'video/quicktime': '.mov' };

/** Remove caracteres de controle (exceto quebra de linha/tab) de textos enviados. */
function cleanText(v, max) {
  let s = String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/g, '');
  if (max && s.length > max) s = s.slice(0, max);
  return s;
}

/** Evita injeção de fórmulas ao abrir CSV no Excel/Sheets. */
function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

module.exports = { headers, buildCsp, rateLimit, hit, loginLocked, loginFailed, loginSucceeded, resetLimits, sniffMime, EXT_BY_MIME, cleanText, csvCell };
