'use strict';
/**
 * Google Search Console dentro do painel: cliques, impressões, posição, buscas e páginas, e envio do sitemap.
 *
 * Autenticação por "conta de serviço" do Google (arquivo JSON com chave privada). A chave fica:
 *  - na variável de ambiente GOOGLE_SERVICE_ACCOUNT (o JSON inteiro ou em base64), ou
 *  - no arquivo data/google-service-account.json (enviado pelo painel; permissão 600, nunca exibido).
 * O token de acesso é obtido assinando um JWT (RS256) com node:crypto — sem bibliotecas extras.
 * Só fala com hosts fixos do Google (sem SSRF). Respostas ficam em cache por 1 hora (cota da API).
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('./config');
const settings = require('./settings');

const SCOPE = 'https://www.googleapis.com/auth/webmasters';
// Endereços da API (os testes apontam para um servidor falso)
const endpoints = {
  tokenUrl: 'https://oauth2.googleapis.com/token',
  apiUrl: 'https://www.googleapis.com/webmasters/v3',
};
const keyFile = () => path.join(config.dataDir, 'google-service-account.json');

class GscError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

function parseKey(raw) {
  let text = String(raw || '').trim();
  if (!text) return null;
  if (!text.startsWith('{')) { try { text = Buffer.from(text, 'base64').toString('utf8'); } catch { return null; } }
  let k;
  try { k = JSON.parse(text); } catch { throw new GscError('O arquivo não é um JSON válido', 400); }
  // (padrão escrito com [A-Z ]* para não parecer uma chave real aos verificadores de segredo)
  if (k.type !== 'service_account' || !k.client_email || !/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(k.private_key || '')) {
    throw new GscError('Este JSON não é a chave de uma conta de serviço do Google (tipo "service_account")', 400);
  }
  try { crypto.createPrivateKey(k.private_key); } catch { throw new GscError('A chave privada do arquivo está corrompida', 400); }
  return { client_email: k.client_email, private_key: k.private_key, project_id: k.project_id || '' };
}

function loadKey() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT) return { ...parseKey(process.env.GOOGLE_SERVICE_ACCOUNT), source: 'env' };
  try { return { ...parseKey(fs.readFileSync(keyFile(), 'utf8')), source: 'file' }; } catch (e) { if (e instanceof GscError) throw e; return null; }
}

/** Grava a chave enviada pelo painel (somente leitura para o dono do processo). */
function saveKey(raw) {
  const k = parseKey(raw);
  if (!k) throw new GscError('Envie o arquivo JSON da conta de serviço', 400);
  fs.writeFileSync(keyFile(), JSON.stringify({ type: 'service_account', ...k }), { mode: 0o600 });
  try { fs.chmodSync(keyFile(), 0o600); } catch { /* sistemas sem chmod */ }
  token = null;
  cache.clear();
  return k.client_email;
}

function removeKey() {
  fs.rmSync(keyFile(), { force: true });
  token = null;
  cache.clear();
}

let token = null; // { value, exp, email }

const b64url = (b) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

async function accessToken() {
  const key = loadKey();
  if (!key) throw new GscError('Google Search não configurado', 400);
  if (token && token.email === key.client_email && token.exp > Date.now() + 60e3) return token.value;
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({ iss: key.client_email, scope: SCOPE, aud: endpoints.tokenUrl, iat: now, exp: now + 3600 }));
  const sig = b64url(crypto.sign('RSA-SHA256', Buffer.from(`${head}.${claim}`), key.private_key));
  const res = await fetch(endpoints.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claim}.${sig}` }),
    signal: AbortSignal.timeout(15000),
  }).catch(() => { throw new GscError('Não foi possível falar com o Google (sem internet no servidor?)'); });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new GscError(/invalid_grant/.test(data.error || '') ? 'O Google recusou a chave (foi apagada ou o relógio do servidor está errado)' : 'O Google recusou a chave da conta de serviço', 400);
  }
  token = { value: data.access_token, exp: Date.now() + (Number(data.expires_in) || 3600) * 1000, email: key.client_email };
  return token.value;
}

async function call(method, urlPath, body) {
  const res = await fetch(`${endpoints.apiUrl}${urlPath}`, {
    method,
    headers: { authorization: `Bearer ${await accessToken()}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  }).catch(() => { throw new GscError('Não foi possível falar com o Google (sem internet no servidor?)'); });
  if (res.status === 204) return {};
  const data = await res.json().catch(() => ({}));
  if (res.status === 403) throw new GscError(`A conta de serviço não tem acesso a esta propriedade. No Search Console, adicione ${loadKey()?.client_email || 'o e-mail da conta de serviço'} em Configurações → Usuários e permissões.`, 403);
  if (res.status === 429) throw new GscError('Limite de consultas do Google atingido; tente de novo em alguns minutos', 429);
  if (!res.ok) throw new GscError(data?.error?.message ? `Google: ${String(data.error.message).slice(0, 200)}` : `Erro do Google (${res.status})`);
  return data;
}

const cache = new Map();
async function cached(key, ms, fn) {
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.value;
  const value = await fn();
  cache.set(key, { value, exp: Date.now() + ms });
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return value;
}

const enc = encodeURIComponent;

/** Propriedades que a conta de serviço enxerga (só as com permissão de leitura ou mais). */
async function sites() {
  return cached('sites', 10 * 60e3, async () => {
    const d = await call('GET', '/sites');
    return (d.siteEntry || []).filter((s) => s.permissionLevel !== 'siteUnverifiedUser').map((s) => ({ siteUrl: s.siteUrl, permission: s.permissionLevel }));
  });
}

/** Propriedade em uso: a escolhida nas configurações ou a que combina com o endereço do site. */
async function property() {
  const chosen = settings.all().gscProperty;
  const list = await sites();
  if (chosen && list.some((s) => s.siteUrl === chosen)) return chosen;
  const host = (() => { try { return new URL(require('./mail').siteUrl()).hostname; } catch { return ''; } })();
  const match = list.find((s) => host && (s.siteUrl.replace(/\/$/, '') === `https://${host}` || s.siteUrl === `sc-domain:${host}` || (s.siteUrl.startsWith('sc-domain:') && host.endsWith(`.${s.siteUrl.slice(10)}`))));
  return (match || list[0])?.siteUrl || '';
}

const day = (d) => d.toISOString().slice(0, 10);

/** Janela de N dias terminando 2 dias atrás (o Search Console demora ~2 dias para fechar os números). */
function range(days, offsetDays = 0) {
  const end = new Date(Date.now() - (2 + offsetDays) * 86400e3);
  const start = new Date(end.getTime() - (days - 1) * 86400e3);
  return { startDate: day(start), endDate: day(end) };
}

async function query(site, body) {
  return cached(`q:${site}:${JSON.stringify(body)}`, 60 * 60e3, async () => (await call('POST', `/sites/${enc(site)}/searchAnalytics/query`, body)).rows || []);
}

const totals = (rows) => {
  const t = rows.reduce((a, r) => ({ clicks: a.clicks + r.clicks, impressions: a.impressions + r.impressions, pos: a.pos + r.position * r.impressions }), { clicks: 0, impressions: 0, pos: 0 });
  return { clicks: t.clicks, impressions: t.impressions, ctr: t.impressions ? t.clicks / t.impressions : 0, position: t.impressions ? t.pos / t.impressions : 0 };
};

/** Relatório completo do período (dias = 7, 28 ou 90). */
async function report(days = 28) {
  const site = await property();
  if (!site) throw new GscError('Nenhuma propriedade encontrada. Adicione o e-mail da conta de serviço como usuário no Search Console.', 404);
  const cur = range(days);
  const prev = range(days, days);
  const [daily, prevDaily, queries, pages, devices, sitemaps] = await Promise.all([
    query(site, { ...cur, dimensions: ['date'], rowLimit: 500 }),
    query(site, { ...prev, dimensions: ['date'], rowLimit: 500 }),
    query(site, { ...cur, dimensions: ['query'], rowLimit: 25 }),
    query(site, { ...cur, dimensions: ['page'], rowLimit: 25 }),
    query(site, { ...cur, dimensions: ['device'], rowLimit: 5 }),
    listSitemaps(site).catch(() => []),
  ]);
  const row = (r) => ({ key: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position });
  return {
    site, days, range: cur,
    totals: totals(daily), previous: totals(prevDaily),
    daily: daily.map((r) => ({ date: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position })),
    queries: queries.map(row), pages: pages.map(row), devices: devices.map(row), sitemaps,
  };
}

/** Números de uma página (para o editor da receita). */
async function page(url, days = 28) {
  const site = await property();
  if (!site) return null;
  const cur = range(days);
  const [tot, qs] = await Promise.all([
    query(site, { ...cur, dimensions: ['page'], dimensionFilterGroups: [{ filters: [{ dimension: 'page', operator: 'equals', expression: url }] }], rowLimit: 1 }),
    query(site, { ...cur, dimensions: ['query'], dimensionFilterGroups: [{ filters: [{ dimension: 'page', operator: 'equals', expression: url }] }], rowLimit: 5 }),
  ]);
  return { days, ...(tot[0] ? { clicks: tot[0].clicks, impressions: tot[0].impressions, ctr: tot[0].ctr, position: tot[0].position } : { clicks: 0, impressions: 0, ctr: 0, position: 0 }), queries: qs.map((r) => ({ query: r.keys[0], clicks: r.clicks, impressions: r.impressions, position: r.position })) };
}

async function listSitemaps(site) {
  const d = await cached(`sm:${site}`, 15 * 60e3, () => call('GET', `/sites/${enc(site)}/sitemaps`));
  return (d.sitemap || []).map((s) => ({ path: s.path, lastSubmitted: s.lastSubmitted || '', lastDownloaded: s.lastDownloaded || '', pending: !!s.isPending, errors: Number(s.errors || 0), warnings: Number(s.warnings || 0), submitted: (s.contents || []).reduce((a, c) => a + Number(c.submitted || 0), 0) }));
}

/** Envia (ou reenvia) o sitemap do site para o Google. */
async function submitSitemap() {
  const site = await property();
  const base = require('./mail').siteUrl();
  if (!site || !base) throw new GscError('Defina o endereço do site e a propriedade do Search Console', 400);
  await call('PUT', `/sites/${enc(site)}/sitemaps/${enc(`${base}/sitemap.xml`)}`);
  cache.clear();
  return `${base}/sitemap.xml`;
}

function status() {
  let key = null;
  let error = '';
  try { key = loadKey(); } catch (e) { error = e.message; }
  return { configured: !!key, email: key?.client_email || '', source: key?.source || '', error, property: settings.all().gscProperty || '' };
}

module.exports = { status, saveKey, removeKey, sites, property, report, page, submitSitemap, endpoints, GscError, _reset: () => { token = null; cache.clear(); } };
