'use strict';
/**
 * Produtos de afiliado por link: cole o link da Amazon, Shopee ou Mercado Livre e o resto é preenchido.
 * - Amazon: ASIN + sua tag; título, foto e preço lidos da página do produto (com plano B quando a Amazon bloqueia).
 * - Shopee: Open API de afiliados (link de comissão, foto, preço); sem a API, só o básico do link.
 * - Mercado Livre: cole o link gerado no painel de afiliados (meli.la/…); dados lidos da página do produto.
 * Atualização automática: preço, disponibilidade e link a cada N horas (configurações → productRefreshHours).
 */
const cheerio = require('cheerio');
const db = require('./db');
const settings = require('./settings');
const importer = require('./importer');
const shopee = require('./shopee');
const utensils = require('./utensils');
const u = require('./util');

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const STORES = { amazon: 'Amazon', shopee: 'Shopee', mercadolivre: 'Mercado Livre', outra: 'Loja' };
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
// Endereços lidos (trocados nos testes por servidores falsos)
const endpoints = { mlApi: 'https://api.mercadolibre.com', amazonPage: (asin) => `https://www.amazon.com.br/dp/${asin}`, shopeePage: (shopId, itemId) => `https://shopee.com.br/product/${shopId}/${itemId}` };
const hostAlias = new Map(); // host:porta → loja (só testes)

function detectStore(url) {
  let h = '';
  try { const x = new URL(url); h = x.hostname.toLowerCase(); if (hostAlias.has(x.host)) return hostAlias.get(x.host); } catch { return ''; }
  // amazon.com.br, amzn.to, a.co e os links curtos novos do SiteStripe (link.amazon / *.amazon)
  if (/(^|\.)(amazon\.[a-z.]+|amazon|amzn\.to|amzn\.eu|amzn\.com|a\.co)$/.test(h)) return 'amazon';
  if (/(^|\.)(shopee\.com\.br|shopee\.[a-z.]+|shp\.ee)$/.test(h)) return 'shopee';
  if (/(^|\.)(mercadolivre\.com\.br|mercadolibre\.[a-z.]+|meli\.la|mercadolivre\.com)$/.test(h)) return 'mercadolivre';
  return 'outra';
}

const toNumber = (v) => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).replace(/[^\d.,]/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.'); // 1.299,90 → 1299.90
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const brl = (n) => (n ? `R$ ${n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}` : '');
const clean = (s, n = 200) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
// Imagens e links: só https (http:// e //cdn… são convertidos; o site serve em https e a CSP bloquearia http)
const httpsOnly = (s) => {
  const v = String(s || '').trim().replace(/^\/\//, 'https://').replace(/^http:\/\//i, 'https://');
  return /^https:\/\/[^\s"'<>]+$/i.test(v) ? v : '';
};

/** Dados genéricos de produto: JSON-LD (Product), Open Graph e microdados. */
function parseProductHtml(html, pageUrl) {
  const $ = cheerio.load(html);
  const out = { title: '', image: '', priceValue: null, available: null };
  $('script[type="application/ld+json"]').each((_, el) => {
    let data;
    try { data = JSON.parse($(el).contents().text()); } catch { return; }
    const nodes = [].concat(data, data?.['@graph'] || []).flat();
    for (const n of nodes) {
      const t = [].concat(n?.['@type'] || []);
      if (!t.includes('Product')) continue;
      out.title ||= clean(n.name);
      const img = [].concat(n.image || [])[0];
      out.image ||= httpsOnly(typeof img === 'object' ? img?.url : img);
      const offer = [].concat(n.offers || [])[0] || {};
      out.priceValue ??= toNumber(offer.price ?? offer.lowPrice);
      if (offer.availability) out.available = !/OutOfStock|SoldOut|Discontinued/i.test(offer.availability);
    }
  });
  const meta = (k) => $(`meta[property="${k}"]`).attr('content') || $(`meta[name="${k}"]`).attr('content') || '';
  out.title ||= clean(meta('og:title') || $('title').text());
  out.image ||= httpsOnly(meta('og:image'));
  out.priceValue ??= toNumber(meta('product:price:amount') || $('[itemprop="price"]').attr('content'));
  // Amazon
  const az = clean($('#productTitle').text());
  if (az) out.title = az;
  const hi = $('#landingImage').attr('data-old-hires') || Object.keys(u.safeJson($('#landingImage').attr('data-a-dynamic-image'), {}))[0] || $('#imgBlkFront').attr('src');
  if (hi) out.image = httpsOnly(hi) || out.image;
  if (out.priceValue === null) out.priceValue = toNumber($('#corePrice_feature_div .a-offscreen, #corePriceDisplay_desktop_feature_div .a-offscreen, .a-price .a-offscreen').first().text());
  const avail = clean($('#availability').text(), 120).toLowerCase();
  if (avail) out.available = !/indispon|unavailable|esgotad/.test(avail);
  if (/captcha|robot check|digite os caracteres/i.test($('title').text() + $('form[action*="validateCaptcha"]').length)) out.blocked = true;
  out.title = out.title.replace(/\s*[|:-]\s*(Amazon\.com\.br|Mercado Livre|Shopee Brasil).*$/i, '').replace(/^Amazon\.com\.br\s*:\s*/i, '');
  if (/^(amazon\.com\.br|mercado livre|shopee)$/i.test(out.title)) out.title = '';
  void pageUrl;
  return out;
}

const slugTitle = (url, re) => {
  try {
    const m = decodeURIComponent(new URL(url).pathname).match(re);
    return m ? clean(m[1].replace(/[-_]+/g, ' ')) : '';
  } catch { return ''; }
};

async function readPage(url) {
  try {
    const r = await importer.fetchLimited(url, { userAgent: BROWSER_UA, maxBytes: 8 * 1024 * 1024 });
    return { html: r.buffer.toString('utf8'), finalUrl: r.finalUrl };
  } catch (e) {
    return { html: '', finalUrl: e.finalUrl || url, error: e.message };
  }
}

async function fromAmazon(url) {
  let asin = /^[A-Z0-9]{10}$/i.test(url) ? url.toUpperCase() : u.extractAsin(url);
  let finalUrl = url;
  if (!asin) { // link curto (amzn.to): segue o redirecionamento
    const p = await readPage(url);
    finalUrl = p.finalUrl;
    asin = u.extractAsin(p.finalUrl);
  }
  if (!asin) throw bad('Não encontrei o código (ASIN) do produto nesse link da Amazon');
  // Link curto do SiteStripe já traz a tag de quem gerou; vale quando a tag não está nas configurações
  let linkTag = '';
  try { linkTag = (new URL(finalUrl).searchParams.get('tag') || '').replace(/[^\w-]/g, '').slice(0, 40); } catch { /* sem tag */ }
  const affUrl = linkTag && !settings.all().amazonTag ? `https://www.amazon.com.br/dp/${asin}?tag=${linkTag}` : '';
  const page = `https://www.amazon.com.br/dp/${asin}`;
  const p = await readPage(endpoints.amazonPage(asin));
  const d = p.html ? parseProductHtml(p.html, page) : {};
  const warn = [];
  if (!p.html || d.blocked || !d.title) warn.push('A Amazon não mostrou a página para o servidor; título e foto vieram do link — confira e ajuste se precisar.');
  return {
    store: 'amazon', externalId: asin, asin, url: page,
    title: (!d.blocked && d.title) || slugTitle(finalUrl, /\/([^/]+)\/dp\//) || `Produto Amazon ${asin}`,
    image: (!d.blocked && d.image) || `https://m.media-amazon.com/images/P/${asin}.01._SCLZZZZZZZ_.jpg`,
    priceValue: d.blocked ? null : d.priceValue ?? null, available: d.blocked ? null : d.available ?? null,
    affUrl, warn,
  };
}

async function fromShopee(url) {
  let ids = shopee.idsFromUrl(url);
  let finalUrl = url;
  if (!ids) { // shp.ee / s.shopee.com.br
    const p = await readPage(url);
    finalUrl = p.finalUrl;
    ids = shopee.idsFromUrl(p.finalUrl);
  }
  if (!ids) throw bad('Não encontrei o produto nesse link da Shopee (abra o produto e copie o link da barra de endereço)');
  const productUrl = `https://shopee.com.br/product/${ids.shopId}/${ids.itemId}`;
  const warn = [];
  if (shopee.configured()) {
    try {
      const p = await shopee.product(ids.shopId, ids.itemId);
      if (p) return { ...p, url: p.url || productUrl, affUrl: p.affUrl || (await shopee.shortLink(productUrl).catch(() => '')), available: true, warn };
      warn.push('A Shopee não encontrou esse produto no programa de afiliados (pode não pagar comissão).');
      const short = await shopee.shortLink(productUrl).catch(() => '');
      return { store: 'shopee', externalId: `${ids.shopId}.${ids.itemId}`, title: slugTitle(finalUrl, /\/([^/]+)-i\.\d+\.\d+/) || 'Produto Shopee', image: '', priceValue: null, url: productUrl, affUrl: short, available: null, warn };
    } catch (e) {
      warn.push(`API da Shopee: ${e.message}`);
    }
  } else warn.push('Sem a API da Shopee configurada o link não gera comissão automática. Configure abaixo ou cole o link de afiliado (s.shopee.com.br/…).');
  const p = await readPage(endpoints.shopeePage(ids.shopId, ids.itemId));
  const d = p.html ? parseProductHtml(p.html, productUrl) : {};
  const isAff = /(^|\.)(shp\.ee|s\.shopee\.com\.br)$/i.test((() => { try { return new URL(url).hostname; } catch { return ''; } })());
  return {
    store: 'shopee', externalId: `${ids.shopId}.${ids.itemId}`, url: productUrl, affUrl: isAff ? url : '',
    title: d.title || slugTitle(finalUrl, /\/([^/]+)-i\.\d+\.\d+/) || 'Produto Shopee', image: d.image || '', priceValue: d.priceValue ?? null, available: d.available ?? null, warn,
  };
}

/** API pública do Mercado Livre: anúncio (MLB123…) ou produto de catálogo (/p/MLB…). Plano B quando a página não abre. */
async function mlApi(id, catalog) {
  const get = async (path) => {
    try { return JSON.parse((await importer.fetchLimited(`${endpoints.mlApi}${path}`, { accept: 'application/json', maxBytes: 2 * 1024 * 1024 })).buffer.toString('utf8')); } catch { return null; }
  };
  if (!catalog) {
    const it = await get(`/items/${id}`);
    if (it?.title) return { title: clean(it.title), image: httpsOnly(it.pictures?.[0]?.secure_url || it.pictures?.[0]?.url || it.secure_thumbnail || it.thumbnail), priceValue: toNumber(it.price), available: it.status ? it.status === 'active' : null };
  }
  const pr = await get(`/products/${id}`);
  if (pr?.name) return { title: clean(pr.name), image: httpsOnly(pr.pictures?.[0]?.url || pr.pictures?.[0]?.secure_url), priceValue: toNumber(pr.buy_box_winner?.price), available: pr.status ? pr.status === 'active' : null };
  return null;
}

async function fromMercadoLivre(url) {
  const host = new URL(url).hostname;
  const isAff = /(^|\.)meli\.la$/i.test(host) || /[?&#](matt_tool|matt_word)=/.test(url);
  const p = await readPage(url);
  const finalUrl = p.finalUrl;
  const id = (finalUrl.match(/\b(MLB)-?(\d{6,})/i) || url.match(/\b(MLB)-?(\d{6,})/i) || []).slice(1).join('').toUpperCase();
  const d = p.html ? parseProductHtml(p.html, finalUrl) : {};
  // Página bloqueada ou sem foto/preço: completa pela API pública (catálogo "/p/MLB…" ou anúncio "MLB-…")
  if (id && (!d.title || !d.image || d.priceValue == null)) {
    const catalog = /\/p\/MLB\d/i.test(finalUrl) || /\/p\/MLB\d/i.test(url);
    const itemId = (finalUrl.match(/[?&#](?:item_id|wid)=(MLB\d{6,})/i) || [])[1];
    const api = (itemId && await mlApi(itemId.toUpperCase(), false)) || await mlApi(id, catalog);
    if (api) {
      d.title ||= api.title;
      d.image ||= api.image;
      d.priceValue ??= api.priceValue;
      d.available ??= api.available;
    }
  }
  const warn = [];
  if (!isAff) warn.push('Este não parece um link de afiliado. Gere o link no painel de afiliados do Mercado Livre (meli.la/…) para receber comissão.');
  if (!d.title) warn.push('Não consegui ler a página do Mercado Livre; confira título, foto e preço.');
  else if (!d.image) warn.push('O Mercado Livre não mostrou a foto; cole o link da imagem no campo "Imagem".');
  let cleanUrl = finalUrl;
  try { const x = new URL(finalUrl); x.search = ''; x.hash = ''; cleanUrl = x.toString(); } catch { /* mantém */ }
  return {
    store: 'mercadolivre', externalId: id, url: cleanUrl, affUrl: isAff ? url : '',
    title: d.title || slugTitle(finalUrl, /\/(?:MLB-?\d+-)?([^/]+?)(?:-_JM)?$/) || 'Produto Mercado Livre', image: d.image || '', priceValue: d.priceValue ?? null, available: d.available ?? null, warn,
  };
}

async function fromOther(url) {
  const p = await readPage(url);
  const d = p.html ? parseProductHtml(p.html, p.finalUrl) : {};
  if (!d.title) throw bad(`Não consegui ler esse link${p.error ? ` (${p.error})` : ''}`);
  return { store: 'outra', externalId: '', url, affUrl: '', title: d.title, image: d.image || '', priceValue: d.priceValue ?? null, available: d.available ?? null, warn: [] };
}

/** Lê o link colado e devolve os dados do produto (não grava nada). */
async function fromUrl(raw) {
  const s = String(raw || '').trim();
  if (/^[A-Z0-9]{10}$/i.test(s)) return finish(await fromAmazon(s), s);
  if (!/^https?:\/\/\S+$/i.test(s) || s.length > 2000) throw bad('Cole o link completo do produto (começando com https://)');
  let url = s;
  try { if (!hostAlias.has(new URL(s).host)) url = s.replace(/^http:/i, 'https:'); } catch { throw bad('Link inválido'); }
  const store = detectStore(url);
  const fn = { amazon: fromAmazon, shopee: fromShopee, mercadolivre: fromMercadoLivre }[store] || fromOther;
  return finish(await fn(url), url);
}

function finish(d, source) {
  const title = clean(d.title, 200);
  return {
    ...d, title, source,
    price: brl(d.priceValue),
    utensil: utensils.guess(title),
    storeName: STORES[d.store] || 'Loja',
    warn: (d.warn || []).filter(Boolean),
  };
}

// ---------------- gravação e atualização ----------------
const nowSql = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

/** Grava um produto novo a partir dos dados lidos (sem duplicar loja + código). */
function upsert(d, extra = {}) {
  const dbh = db.get();
  const existing = d.externalId ? dbh.prepare('SELECT * FROM products WHERE store = ? AND external_id = ?').get(d.store, d.externalId) : null;
  if (existing) return { product: existing, created: false };
  const info = dbh.prepare(`INSERT INTO products (title, asin, url, image, price, price_value, description, badge, keywords, active, store, external_id, source_url, aff_url, refreshed_at, available, auto, utensil, category)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    d.title, d.asin || '', httpsOnly(d.url), httpsOnly(d.image), d.price || '', d.priceValue ?? null, extra.description || '', extra.badge || '', extra.keywords || '', extra.active === false ? 0 : 1,
    d.store, d.externalId || '', String(d.source || d.url || '').slice(0, 2000), httpsOnly(d.affUrl), nowSql(), d.available === false ? 0 : 1, extra.auto ? 1 : 0, extra.utensil ?? d.utensil ?? '', extra.category || '',
  );
  return { product: dbh.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid), created: true };
}

/** Atualiza preço, disponibilidade, link e (se estiverem vazios) título/foto. */
async function refresh(p) {
  const dbh = db.get();
  const source = p.source_url || p.url || p.asin;
  if (!source) return p;
  try {
    const d = await fromUrl(source);
    // Produto salvo antes com a loja errada (ex.: link.amazon como "Loja"): corrige loja, código e link
    if (d.store !== (p.store || 'amazon') || (!p.external_id && d.externalId)) {
      dbh.prepare('UPDATE products SET store = ?, external_id = ?, asin = ?, url = ? WHERE id = ?').run(d.store, d.externalId || '', d.asin || '', httpsOnly(d.url) || p.url, p.id);
    }
    dbh.prepare(`UPDATE products SET price = CASE WHEN ? != '' THEN ? ELSE price END, price_value = COALESCE(?, price_value), available = ?, aff_url = CASE WHEN ? != '' THEN ? ELSE aff_url END,
      image = CASE WHEN image = '' THEN ? ELSE image END, title = CASE WHEN title = '' THEN ? ELSE title END, refreshed_at = ?, refresh_error = '' WHERE id = ?`)
      .run(d.price, d.price, d.priceValue ?? null, d.available === false ? 0 : 1, httpsOnly(d.affUrl), httpsOnly(d.affUrl), httpsOnly(d.image), d.title, nowSql(), p.id);
  } catch (e) {
    dbh.prepare('UPDATE products SET refreshed_at = ?, refresh_error = ? WHERE id = ?').run(nowSql(), String(e.message).slice(0, 200), p.id);
  }
  return dbh.prepare('SELECT * FROM products WHERE id = ?').get(p.id);
}

function due(limit = 5) {
  const hours = Math.max(1, Number(settings.all().productRefreshHours) || 24);
  return db.get().prepare(`SELECT * FROM products WHERE (source_url != '' OR asin != '') AND (refreshed_at IS NULL OR refreshed_at < datetime('now', ?)) ORDER BY refreshed_at IS NOT NULL, refreshed_at LIMIT ?`).all(`-${hours} hours`, limit);
}

// ---------------- utensílios automáticos (Shopee) ----------------
const COZINHA_QUERIES = ['utensílios de cozinha kit silicone', 'organizador de cozinha', 'jogo de facas cozinha', 'potes herméticos vidro', 'jogo de panelas antiaderente', 'tábua de corte'];

/** Utensílios citados nas receitas publicadas que ainda não têm produto. */
function missingUtensils() {
  const dbh = db.get();
  const have = new Set(dbh.prepare("SELECT DISTINCT utensil FROM products WHERE active = 1 AND utensil != ''").all().map((r) => r.utensil));
  const tried = new Set(dbh.prepare("SELECT key FROM utensil_searches WHERE searched_at > datetime('now', '-7 days')").all().map((r) => r.key));
  const count = new Map();
  for (const r of dbh.prepare("SELECT steps, ingredients, tips FROM recipes WHERE status = 'published'").all()) {
    const rec = { steps: u.safeJson(r.steps, []), ingredients: u.safeJson(r.ingredients, []), tips: r.tips };
    for (const t of utensils.detect(rec)) {
      if (have.has(t.key) || tried.has(t.key)) continue;
      const c = count.get(t.key) || { ...t, recipes: 0 };
      c.recipes++;
      count.set(t.key, c);
    }
  }
  return [...count.values()].sort((a, b) => b.recipes - a.recipes);
}

function coverage() {
  const dbh = db.get();
  const have = new Set(dbh.prepare("SELECT DISTINCT utensil FROM products WHERE active = 1 AND utensil != ''").all().map((r) => r.utensil));
  const seen = new Map();
  for (const r of dbh.prepare("SELECT steps, ingredients, tips FROM recipes WHERE status = 'published'").all()) {
    for (const t of utensils.detect({ steps: u.safeJson(r.steps, []), ingredients: u.safeJson(r.ingredients, []), tips: r.tips })) {
      const c = seen.get(t.key) || { key: t.key, label: t.label, recipes: 0, covered: have.has(t.key) || have.has(utensils.baseKey(t.key)) };
      c.recipes++;
      seen.set(t.key, c);
    }
  }
  const list = [...seen.values()].sort((a, b) => b.recipes - a.recipes);
  return { total: list.length, covered: list.filter((x) => x.covered).length, cozinha: dbh.prepare("SELECT COUNT(*) n FROM products WHERE active = 1 AND category = 'cozinha'").get().n, items: list.slice(0, 40) };
}

/** Busca na Shopee produtos para os utensílios sem produto (e para a vitrine "cozinha"). */
async function autoFill({ max = 5 } = {}) {
  if (!shopee.configured()) throw bad('Configure a API da Shopee para buscar utensílios automaticamente');
  const dbh = db.get();
  const mark = dbh.prepare("INSERT INTO utensil_searches (key, searched_at) VALUES (?, datetime('now')) ON CONFLICT(key) DO UPDATE SET searched_at = excluded.searched_at");
  const added = [];
  for (const t of missingUtensils().slice(0, max)) {
    const found = await shopee.search(t.query, { limit: 3 });
    mark.run(t.key);
    const best = found.find((f) => f.title && f.affUrl);
    if (best) {
      const r = upsert(finish(best, best.url), { auto: true, utensil: t.key });
      if (!r.created && !r.product.utensil) dbh.prepare('UPDATE products SET utensil = ? WHERE id = ?').run(t.key, r.product.id);
      added.push({ utensil: t.label, title: r.product.title });
    }
  }
  const cozinha = dbh.prepare("SELECT COUNT(*) n FROM products WHERE active = 1 AND category = 'cozinha'").get().n;
  if (cozinha < 8) {
    for (const q of COZINHA_QUERIES) {
      const key = `cozinha:${q}`;
      if (dbh.prepare("SELECT 1 FROM utensil_searches WHERE key = ? AND searched_at > datetime('now', '-7 days')").get(key)) continue;
      const found = await shopee.search(q, { limit: 2 });
      mark.run(key);
      for (const f of found.filter((x) => x.title && x.affUrl)) {
        const r = upsert(finish(f, f.url), { auto: true, category: 'cozinha', utensil: '' });
        if (r.created) added.push({ utensil: 'Cozinha', title: r.product.title });
      }
      break; // uma busca por rodada (respeita o limite da API)
    }
  }
  if (added.length) require('./cache').bump?.();
  return { added, remaining: missingUtensils().length };
}

// ---------------- vitrine da receita ----------------
/**
 * Produtos para a página da receita: os vinculados à mão primeiro, depois os utensílios citados no preparo
 * e, se nada combinar, produtos da categoria "cozinha".
 */
function forRecipe(r, linked = []) {
  const dbh = db.get();
  const out = [...linked];
  const ids = new Set(out.map((p) => p.id));
  const found = utensils.detect(r);
  const byKey = new Map();
  for (const p of dbh.prepare("SELECT * FROM products WHERE active = 1 AND available != 0 AND utensil != '' ORDER BY auto, clicks DESC").all()) {
    if (!byKey.has(p.utensil)) byKey.set(p.utensil, p);
  }
  let viaUtensil = 0;
  for (const t of found) {
    const p = byKey.get(t.key) || byKey.get(utensils.baseKey(t.key));
    if (p && !ids.has(p.id)) { out.push({ ...p, forLabel: t.label }); ids.add(p.id); viaUtensil++; }
    if (out.length >= 6) break;
  }
  let title = linked.length || viaUtensil ? 'Utensílios desta receita' : '';
  if (out.length < 2) {
    const more = dbh.prepare("SELECT * FROM products WHERE active = 1 AND available != 0 AND category = 'cozinha' ORDER BY random() LIMIT 8").all().filter((p) => !ids.has(p.id)).slice(0, 4 - out.length);
    if (more.length) { out.push(...more); title ||= 'Para a sua cozinha'; }
  }
  return { list: out, title: title || 'Utensílios e ingredientes que eu uso', utensils: found };
}

// ---------------- agendador ----------------
let timer = null;
let running = false;
async function tick() {
  if (running) return;
  running = true;
  try {
    const s = settings.all();
    if (s.productAutoRefresh) for (const p of due(5)) { await refresh(p); await new Promise((r) => setTimeout(r, 2000)); }
    if (s.utensilsAuto && shopee.configured()) await autoFill({ max: 3 }).catch(() => {});
  } catch (e) {
    console.warn('Afiliados: falha na atualização automática:', e.message);
  } finally { running = false; }
}
function start(everyMs = 20 * 60e3) {
  if (timer) return;
  timer = setInterval(tick, everyMs);
  timer.unref();
  setTimeout(tick, 60e3).unref();
}

module.exports = { detectStore, parseProductHtml, fromUrl, upsert, refresh, due, forRecipe, autoFill, missingUtensils, coverage, tick, start, STORES, BROWSER_UA, endpoints, hostAlias };
