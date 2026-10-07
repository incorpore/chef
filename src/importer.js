'use strict';
const dns = require('node:dns').promises;
const dnsCb = require('node:dns');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cheerio = require('cheerio');
const u = require('./util');
const config = require('./config');
const db = require('./db');
const sec = require('./security');

const UA = 'Mozilla/5.0 (compatible; ChefRecipeImporter/1.0; +https://github.com/incorpore/chef)';
const MAX_BYTES = 5 * 1024 * 1024;

// Faixas de IP internas/reservadas que o importador nunca pode acessar (proteção SSRF)
const BLOCKED = new net.BlockList();
for (const [ip, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]]) BLOCKED.addSubnet(ip, bits, 'ipv4');
for (const [ip, bits] of [['::', 128], ['::1', 128], ['64:ff9b::', 96], ['100::', 64], ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]]) BLOCKED.addSubnet(ip, bits, 'ipv6');

function isPrivateIp(ip) {
  const v = String(ip).toLowerCase();
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIp(mapped[1]);
  if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(v)) {
    const [hi, lo] = v.slice(7).split(':').map((h) => parseInt(h, 16));
    return isPrivateIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  if (net.isIPv4(v)) return BLOCKED.check(v, 'ipv4');
  if (net.isIPv6(v)) return BLOCKED.check(v, 'ipv6');
  return true; // formato desconhecido: bloqueia
}

const allowPrivate = () => process.env.IMPORT_ALLOW_PRIVATE === '1';

/** Valida a URL (protocolo, porta, host). */
async function assertPublicUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw Object.assign(new Error('URL inválida'), { status: 400 });
  }
  if (!/^https?:$/.test(url.protocol)) throw Object.assign(new Error('Apenas URLs http(s) são permitidas'), { status: 400 });
  if (url.username || url.password) throw Object.assign(new Error('URL com usuário/senha não é permitida'), { status: 400 });
  if (allowPrivate()) return url;
  if (url.port && !['80', '443', '8080', '8443'].includes(url.port)) throw Object.assign(new Error('Porta não permitida'), { status: 400 });
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (/^(localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i.test(host)) throw Object.assign(new Error('Endereço não permitido'), { status: 400 });
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw Object.assign(new Error('Não foi possível resolver o endereço'), { status: 400 });
  if (addrs.some((a) => isPrivateIp(a.address))) throw Object.assign(new Error('Endereço não permitido'), { status: 400 });
  return url;
}

/** lookup usado NA CONEXÃO: revalida o IP resolvido, impedindo DNS rebinding (DNS que muda entre a checagem e a conexão). */
function safeLookup(hostname, options, cb) {
  dnsCb.lookup(hostname, { ...options, all: true }, (err, addrs) => {
    if (err) return cb(err);
    const list = Array.isArray(addrs) ? addrs : [{ address: addrs, family: options.family || 4 }];
    const bad = !allowPrivate() && list.some((a) => isPrivateIp(a.address));
    if (bad) return cb(Object.assign(new Error('Endereço não permitido'), { code: 'EBLOCKED' }));
    if (options.all) return cb(null, list);
    cb(null, list[0].address, list[0].family);
  });
}

function requestOnce(url, { accept, maxBytes }) {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request(url, { method: 'GET', lookup: safeLookup, timeout: 15000, headers: { 'user-agent': UA, accept, 'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8', 'accept-encoding': 'identity' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve({ redirect: new URL(res.headers.location, url).toString() });
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return reject(Object.assign(new Error(`O site respondeu com erro ${res.statusCode}`), { status: 502 }));
      }
      const declared = Number(res.headers['content-length'] || 0);
      if (declared > maxBytes) {
        res.destroy();
        return reject(Object.assign(new Error('Conteúdo grande demais'), { status: 413 }));
      }
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > maxBytes) {
          res.destroy();
          reject(Object.assign(new Error('Conteúdo grande demais'), { status: 413 }));
        } else chunks.push(c);
      });
      res.on('end', () => resolve({ buffer: Buffer.concat(chunks), contentType: String(res.headers['content-type'] || '') }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('O site demorou demais para responder'), { status: 504 })));
    req.on('error', (e) => reject(e.status ? e : Object.assign(new Error(e.code === 'EBLOCKED' ? 'Endereço não permitido' : 'Não foi possível acessar o site'), { status: e.code === 'EBLOCKED' ? 400 : 502 })));
    req.end();
  });
}

async function fetchLimited(raw, { accept = 'text/html,application/xhtml+xml', maxBytes = MAX_BYTES } = {}) {
  let current = raw;
  for (let i = 0; i < 5; i++) {
    const url = await assertPublicUrl(current); // cada redirecionamento é validado de novo
    const r = await requestOnce(url, { accept, maxBytes });
    if (r.redirect) { current = r.redirect; continue; }
    return { ...r, finalUrl: url.toString() };
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

/** Baixa uma imagem remota para /uploads (evita hotlink). Confere a assinatura real do arquivo. Em caso de falha, mantém a URL remota (se for http/https). */
async function downloadImage(remote, userId = null) {
  if (!remote || typeof remote !== 'string') return '';
  if (remote.startsWith('/uploads/')) return remote;
  if (!/^https?:\/\//i.test(remote)) return '';
  try {
    const { buffer } = await fetchLimited(remote, { accept: 'image/*', maxBytes: 15 * 1024 * 1024 });
    const mime = sec.sniffMime(buffer);
    if (!mime || !mime.startsWith('image/')) return remote;
    const name = `${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}${sec.EXT_BY_MIME[mime]}`;
    fs.writeFileSync(path.join(config.uploadsDir, name), buffer);
    db.get().prepare('INSERT INTO uploads (filename, mime, size, original_name, user_id) VALUES (?, ?, ?, ?, ?)').run(name, mime, buffer.length, remote.slice(0, 200), userId);
    return `/uploads/${name}`;
  } catch {
    return remote;
  }
}

/** Importa uma receita de URL. Não salva — retorna dados prontos para `recipes.create`. */
async function importFromUrl(url, { downloadImages = true, userId = null } = {}) {
  const { buffer, contentType, finalUrl } = await fetchLimited(url);
  let data;
  if (/json/.test(contentType)) {
    const json = JSON.parse(buffer.toString('utf8'));
    const node = findRecipeNode(json);
    data = node ? { ...fromJsonLd(node, finalUrl), source_url: finalUrl, _method: 'json' } : { ...json, source_url: finalUrl, _method: 'chef-json' };
  } else {
    data = parseHtml(buffer.toString('utf8'), finalUrl);
  }
  if (!data.title) throw Object.assign(new Error('Não encontrei uma receita nesta página'), { status: 422 });
  // Conteúdo externo não é confiável: descarta URLs que não sejam http(s) e limita tamanhos
  const okUrl = (x) => (typeof x === 'string' && /^https?:\/\//i.test(x) && x.length < 2000 ? x : '');
  data.cover = okUrl(data.cover);
  data.images = (data.images || []).map((i) => okUrl(typeof i === 'string' ? i : i?.url)).filter(Boolean).slice(0, 20);
  data.video = okUrl(typeof data.video === 'string' ? data.video : '');
  data.steps = (data.steps || []).slice(0, 200).map((st) => ({ ...st, text: String(st.text || '').slice(0, 5000), image: okUrl(st.image) }));
  data.ingredients = (data.ingredients || []).slice(0, 300).map((i) => String(typeof i === 'string' ? i : i?.raw || '').slice(0, 500));
  for (const k of ['title', 'description']) data[k] = String(data[k] || '').slice(0, k === 'title' ? 200 : 500);
  data.tags = (data.tags || []).slice(0, 15).map((t) => String(t).slice(0, 40));
    if (downloadImages) {
    data.cover = await downloadImage(data.cover, userId);
    data.images = await Promise.all((data.images || []).slice(0, 6).map((i) => downloadImage(typeof i === 'string' ? i : i.url, userId)));
  }
  return data;
}

module.exports = { importFromUrl, parseHtml, assertPublicUrl, isPrivateIp, downloadImage, fetchLimited };
