'use strict';
/**
 * Fotos para receitas sem imagem, de bancos de imagens gratuitos com licença para uso comercial:
 *  - Pexels  (https://www.pexels.com/api/)  — 200 consultas/hora, crédito ao fotógrafo apreciado
 *  - Pixabay (https://pixabay.com/api/docs/) — 100 consultas/minuto, imagens devem ser baixadas (sem hotlink)
 * As chaves ficam nas variáveis PEXELS_API_KEY / PIXABAY_API_KEY ou em data/stock-keys.json (600, enviado
 * pelo painel; nunca exibido). As fotos escolhidas são BAIXADAS para o servidor (viram WebP/AVIF como as
 * demais) e a receita guarda o crédito do fotógrafo. Só fala com hosts fixos dos bancos (sem SSRF).
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('./config');
const db = require('./db');
const sec = require('./security');

const endpoints = {
  pexels: 'https://api.pexels.com/v1/search',
  pixabay: 'https://pixabay.com/api/',
};
// Só baixa imagens destes servidores (os testes acrescentam o servidor falso)
const IMAGE_HOSTS = new Set(['images.pexels.com', 'pixabay.com', 'cdn.pixabay.com']);
const MIN_INTERVAL = { pexels: 20000, pixabay: 1000 }; // respeita os limites gratuitos (Pexels: 180/h)
const keyFile = () => path.join(config.dataDir, 'stock-keys.json');
const NAMES = { pexels: 'Pexels', pixabay: 'Pixabay' };

class StockError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

function fileKeys() {
  try { return JSON.parse(fs.readFileSync(keyFile(), 'utf8')) || {}; } catch { return {}; }
}
function keys() {
  const f = fileKeys();
  return { pexels: process.env.PEXELS_API_KEY || f.pexels || '', pixabay: process.env.PIXABAY_API_KEY || f.pixabay || '' };
}
function status() {
  const k = keys();
  return {
    pexels: { configured: !!k.pexels, fromEnv: !!process.env.PEXELS_API_KEY },
    pixabay: { configured: !!k.pixabay, fromEnv: !!process.env.PIXABAY_API_KEY },
    missing: db.get().prepare("SELECT COUNT(*) AS n FROM recipes WHERE status = 'published' AND (cover IS NULL OR cover = '')").get().n,
    job: job ? { ...job, log: job.log.slice(-8) } : null,
  };
}

/** Salva (ou apaga, com valor vazio) a chave de um banco. */
function saveKey(provider, value) {
  if (!NAMES[provider]) throw new StockError('Banco de imagens desconhecido', 400);
  const v = String(value || '').trim();
  if (v && !/^[A-Za-z0-9_-]{10,100}$/.test(v)) throw new StockError('Chave com formato inválido', 400);
  const f = fileKeys();
  if (v) f[provider] = v; else delete f[provider];
  fs.writeFileSync(keyFile(), JSON.stringify(f), { mode: 0o600 });
  try { fs.chmodSync(keyFile(), 0o600); } catch { /* sem chmod */ }
}

const last = { pexels: 0, pixabay: 0 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function pace(provider) {
  const wait = last[provider] + MIN_INTERVAL[provider] - Date.now();
  if (wait > 0) await sleep(wait);
  last[provider] = Date.now();
}

/** Termo de busca a partir do título: tira parênteses e detalhes que atrapalham ("na air fryer" fica). */
function queryFor(title) {
  return String(title || '').replace(/\([^)]*\)/g, ' ').replace(/\b(caseir[oa]s?|simples|fácil|fofinh[oa]|da vovó|de vó|tradicional|perfeit[oa]|cremos[oa]|gourmet)\b/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 90);
}

async function getJson(url, headers) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000), redirect: 'error' }).catch(() => { throw new StockError('Não foi possível falar com o banco de imagens (sem internet no servidor?)'); });
  if (res.status === 401 || res.status === 403) throw new StockError('Chave do banco de imagens recusada', 400);
  if (res.status === 429) throw new StockError('Limite de consultas do banco de imagens atingido; tente mais tarde', 429);
  if (!res.ok) throw new StockError(`Erro do banco de imagens (${res.status})`);
  return res.json();
}

async function searchPexels(q, perPage, key) {
  await pace('pexels');
  const url = `${endpoints.pexels}?${new URLSearchParams({ query: q, per_page: String(perPage), orientation: 'landscape', locale: 'pt-BR' })}`;
  const d = await getJson(url, { authorization: key });
  return (d.photos || []).map((p) => ({
    provider: 'pexels', id: String(p.id), width: p.width, height: p.height,
    thumb: p.src?.medium || p.src?.small, full: p.src?.large2x || p.src?.large || p.src?.original,
    author: p.photographer || '', authorUrl: p.photographer_url || p.url || '', pageUrl: p.url || '', alt: p.alt || '',
  }));
}

async function searchPixabay(q, perPage, key) {
  await pace('pixabay');
  const url = `${endpoints.pixabay}?${new URLSearchParams({ key, q, lang: 'pt', image_type: 'photo', orientation: 'horizontal', category: 'food', safesearch: 'true', per_page: String(Math.max(3, perPage)) })}`;
  const d = await getJson(url, {});
  return (d.hits || []).map((h) => ({
    provider: 'pixabay', id: String(h.id), width: h.imageWidth, height: h.imageHeight,
    thumb: h.webformatURL, full: h.largeImageURL || h.webformatURL,
    author: h.user || '', authorUrl: h.user && h.user_id ? `https://pixabay.com/users/${encodeURIComponent(h.user)}-${h.user_id}/` : h.pageURL || '', pageUrl: h.pageURL || '', alt: h.tags || '',
  }));
}

/** Busca sugestões nos bancos configurados (Pexels primeiro, depois Pixabay). */
async function search(term, { perPage = 4, providers } = {}) {
  const k = keys();
  const list = (providers || ['pexels', 'pixabay']).filter((p) => k[p]);
  if (!list.length) throw new StockError('Configure a chave do Pexels ou do Pixabay', 400);
  const q = queryFor(term);
  if (!q) return [];
  const out = [];
  for (const p of list) {
    try {
      out.push(...(await (p === 'pexels' ? searchPexels(q, perPage, k.pexels) : searchPixabay(q, perPage, k.pixabay))));
    } catch (e) {
      if (list.length === 1) throw e;
      console.warn(`[fotos] ${NAMES[p]}:`, e.message);
    }
    if (out.length >= perPage * 2) break;
  }
  return out.filter((x) => x.full && x.thumb).slice(0, perPage * 2);
}

/** Baixa a foto escolhida, guarda como WebP otimizado e coloca na receita com o crédito do fotógrafo. */
/** Baixa a foto escolhida e guarda como WebP otimizado. Devolve o endereço local e o crédito do fotógrafo. */
async function download(photo, userId = null) {
  if (!NAMES[photo?.provider]) throw new StockError('Banco de imagens desconhecido', 400);
  let url;
  try { url = new URL(String(photo.full || '')); } catch { throw new StockError('Endereço da foto inválido', 400); }
  if (!['https:', 'http:'].includes(url.protocol) || !IMAGE_HOSTS.has(url.hostname)) throw new StockError('A foto precisa vir do Pexels ou do Pixabay', 400);
  const res = await fetch(url, { signal: AbortSignal.timeout(30000), redirect: 'error' }).catch(() => { throw new StockError('Não foi possível baixar a foto'); });
  if (!res.ok) throw new StockError(`Não foi possível baixar a foto (${res.status})`);
  const len = Number(res.headers.get('content-length') || 0);
  if (len > 15 * 1024 * 1024) throw new StockError('Foto grande demais', 400);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 15 * 1024 * 1024) throw new StockError('Foto grande demais', 400);
  const mime = sec.sniffMime(buf.subarray(0, 16));
  if (!mime || !/^image\/(jpeg|png|webp)$/.test(mime)) throw new StockError('O arquivo baixado não é uma foto válida', 400);
  const name = `${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}${sec.EXT_BY_MIME[mime]}`;
  fs.writeFileSync(path.join(config.uploadsDir, name), buf);
  const images = require('./images');
  const opt = await images.optimizeUpload(name, mime);
  db.get().prepare('INSERT INTO uploads (filename, mime, size, original_name, user_id) VALUES (?, ?, ?, ?, ?)').run(opt.name, opt.mime, opt.size || buf.length, `${NAMES[photo.provider]} ${String(photo.id || '').slice(0, 40)}`.slice(0, 200), userId);
  images.warm(opt.name);
  const author = sec.cleanText(String(photo.author || ''), 80).trim();
  return {
    url: `/uploads/${opt.name}`,
    credit: `Foto: ${author ? `${author} / ` : ''}${NAMES[photo.provider]}`,
    creditUrl: /^https:\/\//.test(photo.authorUrl || '') ? String(photo.authorUrl).slice(0, 500) : /^https:\/\//.test(photo.pageUrl || '') ? String(photo.pageUrl).slice(0, 500) : '',
  };
}

/** Baixa a foto e coloca como capa da receita, com o crédito. */
async function apply(recipeId, photo, userId = null) {
  const recipes = require('./recipes');
  const r = recipes.getById(Number(recipeId));
  if (!r) throw new StockError('Receita não encontrada', 404);
  const d = await download(photo, userId);
  return recipes.update(r.id, { cover: d.url, cover_credit: d.credit, cover_credit_url: d.creditUrl });
}

const configured = () => { const k = keys(); return !!(k.pexels || k.pixabay); };

/** Receitas publicadas ainda sem foto (as mais vistas primeiro). */
function missing(limit = 12, offset = 0) {
  return db.get().prepare("SELECT id, code, slug, title FROM recipes WHERE status = 'published' AND (cover IS NULL OR cover = '') ORDER BY views DESC, id DESC LIMIT ? OFFSET ?").all(limit, offset);
}

// ---------------- Modo automático (em segundo plano, respeitando os limites dos bancos) ----------------
let job = null;
function startAuto(userId, { max = 1000 } = {}) {
  if (job && job.running) throw new StockError('A busca automática já está rodando', 409);
  const k = keys();
  if (!k.pexels && !k.pixabay) throw new StockError('Configure a chave do Pexels ou do Pixabay', 400);
  const todo = missing(Math.min(5000, max), 0).map((r) => r.id);
  job = { running: true, total: todo.length, done: 0, applied: 0, skipped: 0, failed: 0, startedAt: new Date().toISOString(), log: [] };
  const mine = job;
  (async () => {
    const recipes = require('./recipes');
    // Pixabay é bem mais rápido (100/min); Pexels (180/h) entra como reserva
    const order = k.pixabay ? ['pixabay', 'pexels'] : ['pexels'];
    for (const id of todo) {
      if (!mine.running) break;
      const r = recipes.getById(id);
      if (!r || r.cover || r.status !== 'published') { mine.done++; continue; }
      try {
        const found = await search(r.title, { perPage: 3, providers: order });
        if (found.length) {
          await apply(id, found[0], userId);
          mine.applied++;
          mine.log.push(`✅ ${r.title}`);
        } else {
          mine.skipped++;
          mine.log.push(`— ${r.title}: nenhuma foto encontrada`);
        }
      } catch (e) {
        mine.failed++;
        mine.log.push(`⚠️ ${r.title}: ${e.message}`);
        if (e.status === 400 || e.status === 429) { mine.running = false; mine.stopReason = e.message; break; }
      }
      mine.done++;
      if (mine.log.length > 50) mine.log.splice(0, mine.log.length - 50);
    }
    mine.running = false;
    mine.finishedAt = new Date().toISOString();
    require('./cache').bump();
  })().catch((e) => { mine.running = false; mine.stopReason = e.message; });
  return job;
}
function stopAuto() {
  if (job) { job.running = false; job.stopReason = 'Parada pelo administrador'; }
}

module.exports = { status, saveKey, search, apply, download, configured, missing, startAuto, stopAuto, queryFor, endpoints, IMAGE_HOSTS, MIN_INTERVAL, StockError, NAMES, _reset: () => { job = null; last.pexels = 0; last.pixabay = 0; } };
