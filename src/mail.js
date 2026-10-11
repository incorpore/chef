'use strict';
/**
 * Envio de e-mails (SMTP via Nodemailer).
 *
 * As credenciais ficam SOMENTE em variáveis de ambiente (docker-compose / .env):
 *   SMTP_HOST, SMTP_PORT (587), SMTP_USER, SMTP_PASS, SMTP_SECURE (auto: true na porta 465),
 *   MAIL_FROM ("Receitas da Ana <contato@meusite.com>"), MAIL_REPLY_TO, MAIL_ADMIN (quem recebe avisos),
 *   MAIL_RATE_PER_MIN (velocidade da newsletter, padrão 30/min)
 * Para testes: MAIL_TRANSPORT=memory guarda os e-mails em memória (mail.outbox).
 */
const nodemailer = require('nodemailer');
const settings = require('./settings');
const config = require('./config');
const db = require('./db');
const { esc } = require('./util');

const env = () => process.env;
const outbox = [];
let transport = null;
let transportKey = '';

function smtpConfig() {
  const e = env();
  const port = Number(e.SMTP_PORT) || 587;
  return {
    host: (e.SMTP_HOST || '').trim(),
    port,
    secure: e.SMTP_SECURE ? /^(1|true|yes|sim)$/i.test(e.SMTP_SECURE) : port === 465,
    user: (e.SMTP_USER || '').trim(),
    pass: e.SMTP_PASS || '',
    from: (e.MAIL_FROM || '').trim(),
    replyTo: (e.MAIL_REPLY_TO || '').trim(),
    rejectUnauthorized: !/^(0|false|no|nao|não)$/i.test(e.SMTP_TLS_VERIFY || 'true'),
  };
}

function isMemory() {
  return env().MAIL_TRANSPORT === 'memory';
}

/** E-mail está configurado? (sem isso, as funções de e-mail ficam desligadas e o site funciona normalmente) */
function isConfigured() {
  return isMemory() || !!smtpConfig().host;
}

function getTransport() {
  const c = smtpConfig();
  const key = JSON.stringify([isMemory(), c.host, c.port, c.secure, c.user, c.pass, c.rejectUnauthorized]);
  if (transport && key === transportKey) return transport;
  if (transport && transport.close) transport.close();
  transportKey = key;
  if (isMemory()) {
    transport = { sendMail: async (msg) => { outbox.push(msg); return { messageId: `<mem-${outbox.length}@chef>`, accepted: [msg.to] }; }, verify: async () => true };
    return transport;
  }
  transport = nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.secure,
    requireTLS: !c.secure && c.port === 587, // porta 587: exige STARTTLS (nunca envia senha sem criptografia)
    auth: c.user ? { user: c.user, pass: c.pass } : undefined,
    pool: true,
    maxConnections: 2,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
    disableFileAccess: true, // nunca anexar arquivos do servidor
    disableUrlAccess: true, // nunca buscar conteúdo de URLs
    tls: { rejectUnauthorized: c.rejectUnauthorized, minVersion: 'TLSv1.2' },
  });
  return transport;
}

function fromAddress() {
  const c = smtpConfig();
  const s = settings.all();
  if (c.from) return c.from;
  const addr = c.user && c.user.includes('@') ? c.user : `no-reply@${hostOf(siteUrl()) || 'localhost'}`;
  return { name: s.siteName, address: addr };
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return ''; }
}

/**
 * Endereço do site usado nos links dos e-mails.
 * NUNCA vem do cabeçalho Host da requisição (um atacante poderia forjá-lo e receber o link de
 * redefinição de senha da vítima). Ordem: BASE_URL → configuração "siteUrl" → último login do admin.
 */
function siteUrl() {
  return (config.baseUrl || settings.all().siteUrl || '').replace(/\/+$/, '');
}

const oneLine = (s) => String(s ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200);

/** Envia um e-mail. Lança erro com mensagem amigável se falhar. */
async function send({ to, subject, html, text, headers, replyTo }) {
  if (!isConfigured()) throw Object.assign(new Error('E-mail não configurado (defina SMTP_HOST e demais variáveis)'), { status: 400 });
  const c = smtpConfig();
  const msg = {
    from: fromAddress(),
    to,
    subject: oneLine(subject),
    html,
    text,
    headers,
    replyTo: replyTo || c.replyTo || undefined,
  };
  try {
    return await getTransport().sendMail(msg);
  } catch (e) {
    throw Object.assign(new Error(friendlyError(e)), { status: 502, cause: e });
  }
}

/** Traduz erros comuns de SMTP para algo que a pessoa consiga resolver. */
function friendlyError(e) {
  const m = `${e.code || ''} ${e.responseCode || ''} ${e.message || ''}`;
  if (/EAUTH|535|534|Invalid login|Username and Password not accepted/i.test(m)) return 'Usuário ou senha do SMTP recusados. No Gmail, use uma "senha de app" (não a senha normal).';
  if (/ENOTFOUND|EAI_AGAIN/i.test(m)) return 'Servidor SMTP não encontrado (confira SMTP_HOST).';
  if (/ECONNREFUSED/i.test(m)) return 'Conexão recusada pelo servidor SMTP (confira SMTP_PORT).';
  if (/ETIMEDOUT|ESOCKET|timeout/i.test(m)) return 'O servidor SMTP não respondeu (porta bloqueada? Tente 587 ou 465).';
  if (/certificate|self.signed|CERT/i.test(m)) return 'Certificado TLS do servidor SMTP inválido.';
  if (/wrong version number|SSL routines/i.test(m)) return 'Tipo de conexão errado: use SMTP_PORT=465 com SSL ou 587 com STARTTLS.';
  if (/55\d/.test(String(e.responseCode))) return `O servidor SMTP recusou a mensagem (${e.responseCode}). Verifique se o remetente (MAIL_FROM) é permitido.`;
  return 'Não foi possível enviar o e-mail. Veja os detalhes no log do servidor.';
}

async function verify() {
  if (!isConfigured()) return { ok: false, error: 'E-mail não configurado' };
  try {
    await getTransport().verify();
    return { ok: true };
  } catch (e) {
    console.error('[mail] verificação falhou:', e.message);
    return { ok: false, error: friendlyError(e) };
  }
}

function status() {
  const c = smtpConfig();
  const from = fromAddress();
  return {
    configured: isConfigured(),
    host: isMemory() ? '(memória/teste)' : c.host,
    port: c.port,
    secure: c.secure,
    user: c.user ? c.user.replace(/^(.{2}).*(@.*)?$/, (m, a, b) => `${a}•••${b || ''}`) : '',
    from: typeof from === 'string' ? from : `${from.name} <${from.address}>`,
    siteUrl: siteUrl(),
    ratePerMin: rate(),
  };
}

function rate() {
  return Math.max(1, Math.min(6000, Number(env().MAIL_RATE_PER_MIN) || 30));
}

/** Quem recebe avisos do sistema: MAIL_ADMIN ou todos os administradores. */
function adminEmails() {
  const fromEnv = (env().MAIL_ADMIN || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (fromEnv.length) return fromEnv;
  return db.get().prepare("SELECT email FROM users WHERE role = 'admin'").all().map((u) => u.email);
}

// ---------------------------------------------------------------------------
// Modelo visual dos e-mails (HTML simples, compatível com Gmail/Outlook/celular)
// ---------------------------------------------------------------------------
function layout({ title, preheader = '', body, footer = '' }) {
  const s = settings.all();
  const color = /^#[0-9a-f]{6}$/i.test(s.themeColor) ? s.themeColor : '#e85d2a';
  const url = siteUrl();
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#f6f1eb;font-family:Arial,Helvetica,sans-serif;color:#1d1a17">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f1eb;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden">
<tr><td style="background:${color};padding:18px 24px;color:#ffffff;font-size:20px;font-weight:bold">${url ? `<a href="${esc(url)}/" style="color:#ffffff;text-decoration:none">🍳 ${esc(s.siteName)}</a>` : `🍳 ${esc(s.siteName)}`}</td></tr>
<tr><td style="padding:24px;font-size:16px;line-height:1.55">${body}</td></tr>
<tr><td style="padding:16px 24px;background:#faf6f1;color:#8f857b;font-size:12px;line-height:1.5">${footer || esc(s.tagline)}</td></tr>
</table></td></tr></table></body></html>`;
}

function button(href, label) {
  const color = /^#[0-9a-f]{6}$/i.test(settings.all().themeColor) ? settings.all().themeColor : '#e85d2a';
  return `<p style="margin:24px 0"><a href="${esc(href)}" style="display:inline-block;background:${color};color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:999px">${esc(label)}</a></p>`;
}

/** Texto do usuário → HTML seguro com quebras de linha. */
function paragraphs(text) {
  return String(text || '').split(/\n{2,}/).map((p) => `<p style="margin:0 0 12px">${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
}

module.exports = { send, verify, status, isConfigured, siteUrl, adminEmails, layout, button, paragraphs, outbox, rate, friendlyError, smtpConfig };
