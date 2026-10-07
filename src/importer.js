'use strict';
const dns = require('node:dns').promises;
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cheerio = require('cheerio');
const u = require('./util');
const config = require('./config');

const UA = 'Mozilla/5.0 (compatible; ChefRecipeImporter/1.0; +https://github.com/incorpore/chef)';
const MAX_BYTES = 5 * 1024 * 1024;

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}

/** Valida a URL e bloqueia destinos internos (proteção SSRF). */
async function assertPublicUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw Object.assign(new Error('URL inválida'), { status: 400 });
  }
  if (!/^https?:$/.test(url.protocol)) throw Object.assign(new Error('Apenas URLs http(s) são permitidas'), { status: 400 });
  if (process.env.IMPORT_ALLOW_PRIVATE === '1') return url;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw Object.assign(new Error('Não foi possível resolver o endereço'), { status: 400 });
  if (addrs.some((a) => isPrivateIp(a.address))) throw Object.assign(new Error('Endereço não permitido'), { status: 400 });
  return url;
}

async function fetchLimited(raw, { accept = 'text/html,application/xhtml+xml', maxBytes = MAX_BYTES } = {}) {
  let current = raw;
  for (let i = 0; i < 5; i++) {
    const url = await assertPublicUrl(current);
    const res = await fetch(url, { redirect: 'manual', headers: { 'user-agent': UA, accept, 'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8' }, signal: AbortSignal.timeout(15000) });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location'), url).toString();
      continue;
    }
    if (!res.ok) throw Object.assign(new Error(`O site respondeu com erro ${res.status}`), { status: 502 });
    const reader = res.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) {
        reader.cancel();
        throw Object.assign(new Error('Conteúdo grande demais'), { status: 413 });
      }
      chunks.push(value);
    }
    return { buffer: Buffer.concat(chunks), contentType: res.headers.get('content-type') || '', finalUrl: url.toString() };
  }
  throw Object.assign(new Error('Redirecionamentos demais'), { status: 400 });
}

// ------------------------------------------------------------------
function asArray(v) {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function text(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return text(v.text || v.name || v['@value'] || '');
  return cheerio.load(`<div>${String(v)}</div>`)('div').text().replace(/\s+/g, ' ').trim();
}

function imageUrl(v) {
  for (const i of asArray(v)) {
    if (typeof i === 'string') return i;
    if (i && (i.url || i.contentUrl)) return i.url || i.contentUrl;
  }
  return '';
}

function findRecipeNode(node) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const r = findRecipeNode(n);
      if (r) return r;
    }
    return null;
  }
  const types = asArray(node['@type']).map(String);
  if (types.some((t) => /Recipe$/i.test(t))) return node;
  for (const key of ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement', 'item']) {
    const r = findRecipeNode(node[key]);
    if (r) return r;
  }
  return null;
}

function flattenInstructions(ins) {
  const steps = [];
  const walk = (n, group) => {
    if (!n) return;
    if (typeof n === 'string') {
      for (const line of text(n).split(/\n+|(?<=\.)\s+(?=\d+[.)]\s)/)) if (line.trim()) steps.push({ text: line.trim(), group });
      return;
    }
    if (Array.isArray(n)) return n.forEach((x) => walk(x, group));
    const types = asArray(n['@type']).map(String);
    if (types.includes('HowToSection')) return walk(n.itemListElement || n.steps, text(n.name) || group);
    if (n.itemListElement) return walk(n.itemListElement, group);
    const t = text(n.text || n.description || n.name);
    if (t) steps.push({ text: t, group, image: imageUrl(n.image) });
  };
  walk(ins, '');
  return steps.map((s) => ({ ...s, text: s.text.replace(/^(passo\s*)?\d+\s*[.)\-–:]\s*/i, '') }));
}

function parseNutrition(n) {
  if (!n || typeof n !== 'object') return null;
  const map = { calories: 'calories', proteinContent: 'protein', carbohydrateContent: 'carbs', fatContent: 'fat', fiberContent: 'fiber', sodiumContent: 'sodium', sugarContent: 'sugar', saturatedFatContent: 'saturatedFat' };
  const out = {};
  for (const [k, v] of Object.entries(map)) if (n[k]) out[v] = text(n[k]);
  return Object.keys(out).length ? out : null;
}

function fromJsonLd(node, pageUrl) {
  const yieldTxt = text(asArray(node.recipeYield)[0]);
  const yieldNum = Number((yieldTxt.match(/\d+(?:[.,]\d+)?/) || [])[0]?.replace(',', '.'));
  const keywords = Array.isArray(node.keywords) ? node.keywords : String(node.keywords || '').split(',');
  const video = asArray(node.video)[0];
  const prep = u.isoDurationToMinutes(node.prepTime);
  const cook = u.isoDurationToMinutes(node.cookTime);
  const total = u.isoDurationToMinutes(node.totalTime);
  const resolve = (x) => (x ? new URL(x, pageUrl).toString() : '');
  return {
    title: text(node.name),
    description: text(node.description),
    cover: resolve(imageUrl(node.image)),
    images: asArray(node.image).map((i) => resolve(typeof i === 'string' ? i : i?.url)).filter(Boolean).slice(1, 8),
    video: video ? video.contentUrl || video.embedUrl || video.url || '' : '',
    ingredients: asArray(node.recipeIngredient || node.ingredients).map(text).filter(Boolean),
    steps: flattenInstructions(node.recipeInstructions).map((s) => ({ ...s, image: s.image ? resolve(s.image) : '' })),
    prep_minutes: prep,
    cook_minutes: cook || (total > prep ? total - prep : 0),
    servings: yieldNum || 4,
    servings_unit: yieldTxt.replace(/^[\d.,\s]+/, '').trim() || 'porções',
    cuisine: text(asArray(node.recipeCuisine)[0]),
    category: text(asArray(node.recipeCategory)[0]),
    tags: keywords.map((k) => text(k)).filter(Boolean).slice(0, 15),
    nutrition: parseNutrition(node.nutrition),
  };
}

function fromMicrodata($, pageUrl) {
  const scope = $('[itemtype*="schema.org/Recipe"]').first();
  if (!scope.length) return null;
  const prop = (name) => scope.find(`[itemprop="${name}"]`);
  const val = (el) => el.attr('content') || el.attr('datetime') || el.attr('src') || el.text();
  const img = prop('image').first();
  return {
    title: text(val(prop('name').first())),
    description: text(val(prop('description').first())),
    cover: img.length ? new URL(img.attr('src') || img.attr('content') || img.attr('href') || '', pageUrl).toString() : '',
    ingredients: prop('recipeIngredient').add(prop('ingredients')).map((_, el) => text(val($(el)))).get().filter(Boolean),
    steps: prop('recipeInstructions').map((_, el) => {
      const $el = $(el);
      const lis = $el.find('li');
      return lis.length ? lis.map((__, li) => ({ text: text($(li).text()) })).get() : [{ text: text(val($el)) }];
    }).get().flat().filter((s) => s.text),
    prep_minutes: u.isoDurationToMinutes(val(prop('prepTime').first())),
    cook_minutes: u.isoDurationToMinutes(val(prop('cookTime').first())),
    servings: Number((text(val(prop('recipeYield').first())).match(/\d+/) || [])[0]) || 4,
  };
}

/** Heurística para sites sem dados estruturados: procura listas após títulos "Ingredientes" e "Modo de preparo". */
function fromHeuristics($, pageUrl) {
  const listAfter = (re) => {
    let items = [];
    $('h1,h2,h3,h4,h5,strong,p,b').each((_, el) => {
      if (items.length) return;
      const t = $(el).text().trim();
      if (t.length < 60 && re.test(t)) {
        let next = $(el).nextAll('ul,ol').first();
        if (!next.length) next = $(el).parent().nextAll('ul,ol').first();
        if (!next.length) next = $(el).closest('div,section').find('ul,ol').first();
        items = next.find('li').map((__, li) => text($(li).text())).get().filter(Boolean);
      }
    });
    return items;
  };
  const ingredients = listAfter(/^ingredientes?|^ingredients?/i);
  const steps = listAfter(/modo de preparo|preparo|instru[cç][oõ]es|modo de fazer|como fazer|directions|instructions|method/i).map((t) => ({ text: t }));
  const meta = (n) => $(`meta[property="${n}"]`).attr('content') || $(`meta[name="${n}"]`).attr('content') || '';
  const og = meta('og:image');
  return {
    title: meta('og:title') || $('h1').first().text().trim() || $('title').text().trim(),
    description: meta('og:description') || meta('description'),
    cover: og ? new URL(og, pageUrl).toString() : '',
    ingredients,
    steps,
  };
}

/** Extrai receita de um HTML (exportado para testes). */
function parseHtml(html, pageUrl) {
  const $ = cheerio.load(html);
  let data = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    if (data) return;
    try {
      const json = JSON.parse($(el).contents().text().replace(/^\s*<!--|-->\s*$/g, ''));
      const node = findRecipeNode(json);
      if (node) data = fromJsonLd(node, pageUrl);
    } catch { /* JSON-LD inválido */ }
  });
  let method = 'json-ld';
  if (!data || !data.ingredients.length) {
    const md = fromMicrodata($, pageUrl);
    if (md && md.ingredients.length) { data = { ...(data || {}), ...md }; method = 'microdata'; }
  }
  if (!data || !data.ingredients.length) {
    const h = fromHeuristics($, pageUrl);
    data = { ...h, ...(data || {}), ingredients: h.ingredients, steps: data?.steps?.length ? data.steps : h.steps };
    method = 'heuristic';
  }
  if (!data.video) {
    const iframe = $('iframe[src*="youtube.com/embed"], iframe[src*="player.vimeo.com"]').first().attr('src');
    if (iframe) data.video = iframe.startsWith('//') ? `https:${iframe}` : iframe;
  }
  let host = '';
  try { host = new URL(pageUrl).hostname.replace(/^www\./, ''); } catch { /* ignore */ }
  const siteName = $('meta[property="og:site_name"]').attr('content') || host;
  return { ...data, source_url: pageUrl, source_name: siteName, _method: method };
}

const IMAGE_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif' };

/** Baixa uma imagem remota para /uploads (evita hotlink). Retorna a URL local ou a original em caso de falha. */
async function downloadImage(remote) {
  if (!remote || remote.startsWith('/')) return remote;
  try {
    const { buffer, contentType } = await fetchLimited(remote, { accept: 'image/*', maxBytes: 15 * 1024 * 1024 });
    const ext = IMAGE_EXT[contentType.split(';')[0].trim()];
    if (!ext) return remote;
    const name = `${Date.now().toString(36)}-${crypto.randomBytes(5).toString('hex')}${ext}`;
    fs.writeFileSync(path.join(config.uploadsDir, name), buffer);
    return `/uploads/${name}`;
  } catch {
    return remote;
  }
}

/** Importa uma receita de URL. Não salva — retorna dados prontos para `recipes.create`. */
async function importFromUrl(url, { downloadImages = true } = {}) {
  const { buffer, contentType, finalUrl } = await fetchLimited(url);
  let data;
  if (/json/.test(contentType)) {
    const json = JSON.parse(buffer.toString('utf8'));
    const node = findRecipeNode(json);
    data = node ? { ...fromJsonLd(node, finalUrl), source_url: finalUrl, _method: 'json' } : { ...json, source_url: json.source_url || finalUrl, _method: 'chef-json' };
  } else {
    data = parseHtml(buffer.toString('utf8'), finalUrl);
  }
  if (!data.title) throw Object.assign(new Error('Não encontrei uma receita nesta página'), { status: 422 });
  if (downloadImages) {
    data.cover = await downloadImage(data.cover);
    data.images = await Promise.all((data.images || []).slice(0, 6).map((i) => downloadImage(typeof i === 'string' ? i : i.url)));
  }
  return data;
}

module.exports = { importFromUrl, parseHtml, assertPublicUrl, isPrivateIp, downloadImage, fetchLimited };
