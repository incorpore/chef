'use strict';
/**
 * Fotos para receitas sem imagem, de bancos de imagens gratuitos com licença para uso comercial:
 *  - Pexels  (https://www.pexels.com/api/)  — 200 consultas/hora, crédito ao fotógrafo apreciado
 *  - Pixabay (https://pixabay.com/api/docs/) — 100 consultas/minuto, imagens devem ser baixadas (sem hotlink)
 *  - Unsplash (https://unsplash.com/developers) — 50/h no modo de teste (5.000/h após aprovação). Pelas regras
 *    da API a foto NÃO é baixada: fica no servidor do Unsplash (hotlink, em tamanhos otimizados) e o site avisa
 *    o Unsplash a cada foto escolhida (download_location). Fotos Unsplash+ (pagas) ficam de fora.
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
const foodterms = require('./foodterms');

const endpoints = {
  pexels: 'https://api.pexels.com/v1/search',
  pixabay: 'https://pixabay.com/api/',
  unsplash: 'https://api.unsplash.com/search/photos',
  unsplashApi: 'https://api.unsplash.com',
};
// Só baixa imagens destes servidores (os testes acrescentam o servidor falso)
const IMAGE_HOSTS = new Set(['images.pexels.com', 'pixabay.com', 'cdn.pixabay.com', 'images.unsplash.com']);
const UNSPLASH_HOSTS = new Set(['images.unsplash.com']);
const UTM = 'utm_source=chef_receitas&utm_medium=referral';
const MIN_SCORE = 2; // automático: a foto precisa citar o tipo de prato (vale 2) ou dois ingredientes
const MIN_INTERVAL = { pexels: 20000, pixabay: 1000, unsplash: 1000 }; // respeita os limites gratuitos (Pexels: 180/h)
const keyFile = () => path.join(config.dataDir, 'stock-keys.json');
const NAMES = { pexels: 'Pexels', pixabay: 'Pixabay', unsplash: 'Unsplash' };
const PROVIDERS = Object.keys(NAMES);

class StockError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

function fileKeys() {
  try { return JSON.parse(fs.readFileSync(keyFile(), 'utf8')) || {}; } catch { return {}; }
}
function allKeys() {
  const f = fileKeys();
  return { pexels: process.env.PEXELS_API_KEY || f.pexels || '', pixabay: process.env.PIXABAY_API_KEY || f.pixabay || '', unsplash: process.env.UNSPLASH_ACCESS_KEY || f.unsplash || '' };
}
/** Bancos desligados pelo administrador (a chave continua guardada). */
function disabled() {
  return new Set(String(require('./settings').all().stockDisabled || '').split(',').filter(Boolean));
}
/** Chaves dos bancos LIGADOS (é o que a busca e o automático usam). */
function keys() {
  const k = allKeys();
  for (const p of disabled()) k[p] = '';
  return k;
}
/** Liga/desliga um banco sem apagar a chave. */
function setEnabled(provider, enabled) {
  if (!NAMES[provider]) throw new StockError('Banco de imagens desconhecido', 400);
  const off = disabled();
  if (enabled) off.delete(provider); else off.add(provider);
  require('./settings').update({ stockDisabled: PROVIDERS.filter((p) => off.has(p)).join(',') });
}
function status() {
  const k = allKeys();
  const off = disabled();
  return {
    pexels: { configured: !!k.pexels, enabled: !off.has('pexels'), fromEnv: !!process.env.PEXELS_API_KEY },
    pixabay: { configured: !!k.pixabay, enabled: !off.has('pixabay'), fromEnv: !!process.env.PIXABAY_API_KEY },
    unsplash: { configured: !!k.unsplash, enabled: !off.has('unsplash'), fromEnv: !!process.env.UNSPLASH_ACCESS_KEY, remaining: unsplashRemaining },
    missing: db.get().prepare("SELECT COUNT(*) AS n FROM recipes WHERE status = 'published' AND (cover IS NULL OR cover = '')").get().n,
    fromBanks: db.get().prepare(`SELECT COUNT(*) AS n FROM recipes WHERE status = 'published' AND ${STOCK_COVER}`).get().n,
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

const last = { pexels: 0, pixabay: 0, unsplash: 0 };
let unsplashRemaining = null; // consultas restantes nesta hora (cabeçalho X-Ratelimit-Remaining)
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

async function getJson(url, headers, provider = '') {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000), redirect: 'error' }).catch(() => { throw new StockError('Não foi possível falar com o banco de imagens (sem internet no servidor?)'); });
  if (provider === 'unsplash') {
    const rem = res.headers.get('x-ratelimit-remaining');
    if (rem !== null) unsplashRemaining = Number(rem);
    // O Unsplash responde 403 "Rate Limit Exceeded" quando acaba a cota da hora
    if (res.status === 403 && (unsplashRemaining === 0 || /rate limit/i.test(await res.clone().text().catch(() => '')))) throw new StockError('Limite de consultas do Unsplash nesta hora atingido (modo de teste: 50/h; peça a aprovação no site do Unsplash para 5.000/h)', 429);
  }
  if (res.status === 401 || res.status === 403) throw new StockError('Chave do banco de imagens recusada', 400);
  if (res.status === 429) throw new StockError('Limite de consultas do banco de imagens atingido; tente mais tarde', 429);
  if (!res.ok) throw new StockError(`Erro do banco de imagens (${res.status})`);
  return res.json();
}

async function searchPexels(q, perPage, key, lang = 'en') {
  await pace('pexels');
  const url = `${endpoints.pexels}?${new URLSearchParams({ query: q, per_page: String(perPage), orientation: 'landscape', locale: lang === 'pt' ? 'pt-BR' : 'en-US' })}`;
  const d = await getJson(url, { authorization: key });
  return (d.photos || []).map((p) => ({
    provider: 'pexels', id: String(p.id), width: p.width, height: p.height,
    thumb: p.src?.medium || p.src?.small, full: p.src?.large2x || p.src?.large || p.src?.original,
    author: p.photographer || '', authorUrl: p.photographer_url || p.url || '', pageUrl: p.url || '', alt: p.alt || '',
  }));
}

async function searchPixabay(q, perPage, key, lang = 'en') {
  await pace('pixabay');
  const url = `${endpoints.pixabay}?${new URLSearchParams({ key, q, lang, image_type: 'photo', orientation: 'horizontal', category: 'food', safesearch: 'true', per_page: String(Math.max(3, perPage)) })}`;
  const d = await getJson(url, {});
  return (d.hits || []).map((h) => ({
    provider: 'pixabay', id: String(h.id), width: h.imageWidth, height: h.imageHeight,
    thumb: h.webformatURL, fallback: h.previewURL || '', full: h.largeImageURL || h.webformatURL,
    author: h.user || '', authorUrl: h.user && h.user_id ? `https://pixabay.com/users/${encodeURIComponent(h.user)}-${h.user_id}/` : h.pageURL || '', pageUrl: h.pageURL || '', alt: h.tags || '',
  }));
}

async function searchUnsplash(q, perPage, key) {
  await pace('unsplash');
  const url = `${endpoints.unsplash}?${new URLSearchParams({ query: q, per_page: String(Math.max(3, perPage)), orientation: 'landscape', content_filter: 'high' })}`;
  const d = await getJson(url, { authorization: `Client-ID ${key}`, 'accept-version': 'v1' }, 'unsplash');
  return (d.results || []).filter((p) => !p.premium && !p.plus && p.urls?.raw).map((p) => ({
    provider: 'unsplash', id: String(p.id), width: p.width, height: p.height,
    thumb: p.urls.small || p.urls.thumb, full: p.urls.raw,
    author: p.user?.name || '', authorUrl: p.user?.links?.html ? `${p.user.links.html}?${UTM}` : '', pageUrl: p.links?.html ? `${p.links.html}?${UTM}` : '',
    alt: [p.alt_description, p.description, ...(p.tags || []).map((t) => t.title)].filter(Boolean).join(', '),
    downloadLocation: p.links?.download_location || '',
  }));
}

/** Endereço da foto do Unsplash no tamanho certo (o servidor deles redimensiona e converte para WebP/AVIF). */
function unsplashSized(raw, width, format = '') {
  try {
    const u = new URL(raw);
    if (!UNSPLASH_HOSTS.has(u.hostname)) return raw;
    u.searchParams.set('w', String(width));
    u.searchParams.set('q', '75');
    u.searchParams.set('fit', 'max');
    if (format === 'jpeg') { u.searchParams.delete('auto'); u.searchParams.set('fm', 'jpg'); } else { u.searchParams.delete('fm'); u.searchParams.set('auto', 'format'); }
    return u.toString();
  } catch { return raw; }
}

/** Avisa o Unsplash que a foto foi usada (obrigatório pelas regras da API; não baixa o arquivo). */
async function trackUnsplash(photo) {
  const k = keys().unsplash;
  let loc;
  try { loc = new URL(String(photo.downloadLocation || '')); } catch { return; }
  const api = new URL(endpoints.unsplashApi);
  if (!k || loc.host !== api.host || loc.protocol !== api.protocol) return;
  await fetch(loc, { headers: { authorization: `Client-ID ${k}`, 'accept-version': 'v1' }, signal: AbortSignal.timeout(10000), redirect: 'error' }).catch(() => {});
}

/**
 * Busca sugestões nos bancos configurados. O nome da receita é traduzido para inglês (os bancos descrevem
 * as fotos em inglês) e cada foto ganha uma nota: quantas palavras-chave do prato aparecem na descrição ou
 * nas etiquetas dela. A lista volta da mais relevante para a menos.
 */
async function search(term, { perPage = 4, providers } = {}) {
  const k = keys();
  const list = (providers || PROVIDERS).filter((p) => k[p]);
  if (!list.length) throw new StockError(PROVIDERS.some((p) => allKeys()[p]) ? 'Todos os bancos de imagens estão desativados (Painel → Fotos das receitas)' : 'Configure a chave do Pexels, do Pixabay ou do Unsplash', 400);
  const tr = foodterms.translate(term);
  const q = tr.query || queryFor(term);
  const lang = tr.query ? 'en' : 'pt';
  if (!q) return { query: '', items: [] };
  const keywords = tr.keywords.length ? tr.keywords : q.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  const out = [];
  for (const p of list) {
    try {
      out.push(...(await (p === 'pexels' ? searchPexels(q, perPage + 2, k.pexels, lang) : p === 'pixabay' ? searchPixabay(q, perPage + 2, k.pixabay, lang) : searchUnsplash(q, perPage + 2, k.unsplash))));
    } catch (e) {
      if (list.length === 1) throw e;
      console.warn(`[fotos] ${NAMES[p]}:`, e.message);
    }
  }
  const seen = new Set();
  const items = out
    .filter((x) => x.full && x.thumb && !seen.has(`${x.provider}${x.id}`) && seen.add(`${x.provider}${x.id}`))
    .map((x, i) => ({ ...x, score: foodterms.score(x.alt, keywords), order: i }))
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, perPage * 2)
    .map(({ order, ...x }) => x);
  return { query: q, keywords, items };
}

/** Baixa a foto escolhida, guarda como WebP otimizado e coloca na receita com o crédito do fotógrafo. */
/** Baixa a foto escolhida e guarda como WebP otimizado. Devolve o endereço local e o crédito do fotógrafo. */
async function download(photo, userId = null, { auto = false } = {}) {
  if (!NAMES[photo?.provider]) throw new StockError('Banco de imagens desconhecido', 400);
  let url;
  try { url = new URL(String(photo.full || '')); } catch { throw new StockError('Endereço da foto inválido', 400); }
  if (photo.provider === 'unsplash') {
    // Unsplash: a foto fica no servidor deles (hotlink); só avisamos o uso e guardamos o crédito com link
    if (url.protocol !== 'https:' || !UNSPLASH_HOSTS.has(url.hostname)) throw new StockError('A foto precisa vir do Unsplash', 400);
    await trackUnsplash(photo);
    const author = sec.cleanText(String(photo.author || ''), 80).trim();
    return {
      url: unsplashSized(url.toString(), 1600),
      credit: `Foto: ${author ? `${author} / ` : ''}Unsplash`,
      creditUrl: /^https:\/\/unsplash\.com\//.test(photo.authorUrl || '') ? String(photo.authorUrl).slice(0, 500) : `https://unsplash.com/?${UTM}`,
    };
  }
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
  db.get().prepare('INSERT INTO uploads (filename, mime, size, original_name, user_id) VALUES (?, ?, ?, ?, ?)').run(opt.name, opt.mime, opt.size || buf.length, `${auto ? 'auto: ' : ''}${NAMES[photo.provider]} ${String(photo.id || '').slice(0, 40)}`.slice(0, 200), userId);
  images.warm(opt.name);
  const author = sec.cleanText(String(photo.author || ''), 80).trim();
  return {
    url: `/uploads/${opt.name}`,
    credit: `Foto: ${author ? `${author} / ` : ''}${NAMES[photo.provider]}`,
    creditUrl: /^https:\/\//.test(photo.authorUrl || '') ? String(photo.authorUrl).slice(0, 500) : /^https:\/\//.test(photo.pageUrl || '') ? String(photo.pageUrl).slice(0, 500) : '',
  };
}

/** Baixa a foto e coloca como capa da receita, com o crédito. */
async function apply(recipeId, photo, userId = null, opts = {}) {
  const recipes = require('./recipes');
  const r = recipes.getById(Number(recipeId));
  if (!r) throw new StockError('Receita não encontrada', 404);
  const d = await download(photo, userId, opts);
  return recipes.update(r.id, { cover: d.url, cover_credit: d.credit, cover_credit_url: d.creditUrl });
}

const configured = () => { const k = keys(); return !!(k.pexels || k.pixabay || k.unsplash); };

const STOCK_COVER = "(cover_credit LIKE 'Foto:%/ Pexels' OR cover_credit LIKE 'Foto:%/ Pixabay' OR cover_credit LIKE 'Foto:%/ Unsplash' OR cover_credit IN ('Foto: Pexels', 'Foto: Pixabay', 'Foto: Unsplash'))";

/** Receitas para revisar: 'sem' = publicadas sem foto (mais vistas primeiro); 'bancos' = com foto vinda do Pexels/Pixabay. */
function missing(limit = 12, offset = 0, mode = 'sem') {
  const where = mode === 'bancos' ? STOCK_COVER : "(cover IS NULL OR cover = '')";
  const d = db.get();
  return {
    total: d.prepare(`SELECT COUNT(*) AS n FROM recipes WHERE status = 'published' AND ${where}`).get().n,
    items: d.prepare(`SELECT id, code, slug, title, description, cover, cover_credit FROM recipes WHERE status = 'published' AND ${where} ORDER BY views DESC, id DESC LIMIT ? OFFSET ?`).all(limit, offset),
  };
}

/** Tira de uma vez as fotos que vieram dos bancos de imagens (as receitas voltam para a capa ilustrada). */
function removeStockCovers() {
  const recipes = require('./recipes');
  const ids = db.get().prepare(`SELECT id FROM recipes WHERE ${STOCK_COVER}`).all().map((r) => r.id);
  db.tx(() => { for (const id of ids) recipes.update(id, { cover: '', cover_credit: '', cover_credit_url: '' }); });
  return ids.length;
}

// ---------------- Modo automático (em segundo plano, respeitando os limites dos bancos) ----------------
let job = null;
function startAuto(userId, { max = 1000 } = {}) {
  if (job && job.running) throw new StockError('A busca automática já está rodando', 409);
  const k = keys();
  if (!k.pexels && !k.pixabay && !k.unsplash) throw new StockError('Configure a chave do Pexels, do Pixabay ou do Unsplash', 400);
  const todo = missing(Math.min(5000, max), 0).items.map((r) => r.id);
  job = { running: true, total: todo.length, done: 0, applied: 0, skipped: 0, failed: 0, startedAt: new Date().toISOString(), log: [] };
  const mine = job;
  (async () => {
    const recipes = require('./recipes');
    // Pixabay é bem mais rápido (100/min); Pexels (180/h) e Unsplash (50/h no modo de teste) entram como reserva
    const order = ['pixabay', 'pexels', 'unsplash'].filter((p) => k[p]);
    for (const id of todo) {
      if (!mine.running) break;
      const r = recipes.getById(id);
      if (!r || r.cover || r.status !== 'published') { mine.done++; continue; }
      try {
        const found = await search(r.title, { perPage: 3, providers: order });
        const best = found.items[0];
        // Só coloca sozinho quando a foto descreve o prato (nota mínima); na dúvida, deixa para a revisão
        if (best && best.score >= MIN_SCORE) {
          await apply(id, best, userId, { auto: true });
          mine.applied++;
          mine.log.push(`✅ ${r.title} (${found.query})`);
        } else {
          mine.skipped++;
          mine.log.push(`— ${r.title}: nenhuma foto confiável para "${found.query || r.title}" (fica para a revisão)`);
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

module.exports = { status, saveKey, setEnabled, hasAnyKey: () => PROVIDERS.some((p) => allKeys()[p]), search, apply, download, configured, removeStockCovers, missing, startAuto, stopAuto, queryFor, unsplashSized, endpoints, IMAGE_HOSTS, UNSPLASH_HOSTS, MIN_INTERVAL, StockError, NAMES, _reset: () => { job = null; last.pexels = 0; last.pixabay = 0; last.unsplash = 0; unsplashRemaining = null; } };
