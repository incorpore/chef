'use strict';
/**
 * Imagem vertical (1000×1500, formato 2:3 que o Pinterest prefere) para cada receita:
 * foto em cima (ou degradê colorido, se não houver foto) e, embaixo, categoria, nome da receita,
 * tempo/dificuldade e o endereço do site. Gerada com fontes embutidas (assets/fonts), então funciona
 * na imagem Docker sem fontes do sistema. Fica em cache no disco até a receita mudar.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('./config');
const settings = require('./settings');
const u = require('./util');

const W = 1000;
const H = 1500;
const PHOTO_H = 1000;
const FONTS = path.join(config.root, 'assets', 'fonts');
const SERIF = path.join(FONTS, 'PlayfairDisplay-Bold.ttf');
const SANS = path.join(FONTS, 'Inter-Medium.ttf');
const SANS_BOLD = path.join(FONTS, 'Inter-Bold.ttf');
const DIFFICULTY = { 1: 'Fácil', 2: 'Média', 3: 'Difícil' };
const PALETTE = [['#e85d2a', '#b8321a'], ['#d9822b', '#a3511a'], ['#c0392b', '#7b1f2a'], ['#8e5a3c', '#4e2f1f'], ['#6b8e23', '#3f5a14'], ['#2e8b74', '#1b5446'], ['#2f6f9f', '#1b3f61'], ['#8e44ad', '#552766'], ['#d35d8c', '#8f2f57'], ['#b5651d', '#6d3a10']];

let sharp = null;
try { require('./images'); sharp = require('sharp'); } catch { /* sem sharp, sem imagem de pin */ } // images.js configura as fontes antes

const brand = () => (/^#[0-9a-f]{6}$/i.test(settings.all().themeColor) ? settings.all().themeColor : '#e85d2a');
const hostOf = (url) => { try { return new URL(url).host.replace(/^www\./, ''); } catch { return ''; } };
const xml = (s) => u.esc(String(s ?? '')).replace(/&#39;/g, '&apos;');

/** Versão da imagem: muda quando título, foto, categoria, tempo, cor ou nome do site mudam. */
function version(r) {
  const s = settings.all();
  return crypto.createHash('sha1').update(JSON.stringify([2, r.title, r.cover, r.category?.name, r.total_minutes, r.difficulty, r.servings, s.siteName, s.themeColor, s.siteUrl])).digest('hex').slice(0, 10);
}

function pinUrl(r) {
  return sharp && r?.code ? `/pin/${encodeURIComponent(r.code)}.jpg?v=${version(r)}` : '';
}

/** Texto com fonte embutida → imagem PNG transparente. */
function text(str, { font, fontfile, size, color, width, height, align = 'left', lineSpacing }) {
  return sharp({
    text: {
      // cor #RRGGBB ou #RRGGBBAA (a transparência vai em fgalpha, que o Pango entende)
      text: `<span foreground="${color.slice(0, 7)}"${color.length === 9 ? ` fgalpha="${Math.round((parseInt(color.slice(7), 16) / 255) * 100)}%"` : ''} size="${Math.round(size * 1024 * 0.75)}">${xml(str)}</span>`,
      font, fontfile, width, height, rgba: true, align, wrap: 'word', ...(lineSpacing ? { spacing: lineSpacing } : {}),
    },
  }).png().toBuffer({ resolveWithObject: true });
}

/** Ajusta o tamanho da fonte do título para caber em até `maxLines` linhas na altura disponível. */
async function fitTitle(title, width, maxHeight, color = '#1d1a17', sizes = [76, 68, 60, 54, 48, 42]) {
  for (const size of sizes) {
    const out = await text(title, { font: 'Playfair Display Bold', fontfile: SERIF, size, color, width });
    if (out.info.height <= maxHeight) return out;
  }
  const short = title.length > 80 ? `${title.slice(0, 77).replace(/\s+\S*$/, '')}…` : title;
  return text(short, { font: 'Playfair Display Bold', fontfile: SERIF, size: sizes[sizes.length - 1], color, width });
}

function localCover(r) {
  const ok = r.cover && /^\/uploads\/[A-Za-z0-9_-][A-Za-z0-9._-]*\.(jpe?g|png|webp|gif|avif)$/i.test(r.cover);
  const f = ok ? path.join(config.uploadsDir, path.basename(r.cover)) : '';
  return f && fs.existsSync(f) ? f : '';
}

function metaLine(r) {
  return [r.total_minutes ? u.formatMinutes(r.total_minutes) : '', DIFFICULTY[r.difficulty] || '', r.servings ? `${String(r.servings).replace('.', ',')} ${r.servings_unit || 'porções'}` : ''].filter(Boolean).join('   •   ');
}

const svgBuf = (svg) => Buffer.from(svg);

/** Pin com foto: foto em cima, texto centralizado na faixa clara de baixo. */
async function renderPhoto(r, cover) {
  const s = settings.all();
  const color = brand();
  const pad = 70;
  const photo = await sharp(cover, { limitInputPixels: 60e6 }).rotate().resize(W, PHOTO_H, { fit: 'cover', position: sharp.strategy.attention }).toBuffer();
  const cat = await text((r.category?.name || 'Receita').toUpperCase(), { font: 'Inter Bold', fontfile: SANS_BOLD, size: 26, color, width: W - pad * 2 });
  const meta = metaLine(r) ? await text(metaLine(r), { font: 'Inter Medium', fontfile: SANS, size: 28, color: '#5d554d', width: W - pad * 2 }) : null;
  const footer = await text(hostOf(s.siteUrl || config.baseUrl) || s.siteName, { font: 'Inter Medium', fontfile: SANS, size: 24, color: '#8f857b', width: W - pad * 2 });
  const area = H - PHOTO_H - 10 - footer.info.height - 50; // espaço entre a foto e o rodapé
  const title = await fitTitle(r.title, W - pad * 2, area - cat.info.height - (meta ? meta.info.height : 0) - 90, '#1d1a17');
  const block = cat.info.height + 22 + title.info.height + (meta ? 24 + meta.info.height : 0);
  let y = PHOTO_H + 10 + Math.max(36, Math.round((area - block) / 2));
  const layers = [{ input: photo, top: 0, left: 0 }, { input: svgBuf(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="10"><rect width="${W}" height="10" fill="${color}"/></svg>`), top: PHOTO_H, left: 0 }];
  layers.push({ input: cat.data, top: y, left: pad }); y += cat.info.height + 22;
  layers.push({ input: title.data, top: y, left: pad }); y += title.info.height + 24;
  if (meta) layers.push({ input: meta.data, top: y, left: pad });
  layers.push({ input: footer.data, top: H - 44 - footer.info.height, left: pad });
  return sharp({ create: { width: W, height: H, channels: 3, background: '#fffaf5' } }).composite(layers).jpeg({ quality: 86, mozjpeg: true }).toBuffer();
}

/** Pin sem foto: "pin de texto" colorido de ponta a ponta. */
async function renderText(r) {
  const s = settings.all();
  const pad = 80;
  const seed = crypto.createHash('sha1').update(`${r.code}|${r.title}`).digest().readUInt32BE(0);
  const [c1, c2] = PALETTE[seed % PALETTE.length];
  const bg = await sharp(svgBuf(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#g)"/><circle cx="${800 + (seed % 160)}" cy="${170 + ((seed >> 8) % 140)}" r="340" fill="#fff" opacity=".09"/><circle cx="${120 + ((seed >> 4) % 120)}" cy="1330" r="300" fill="#fff" opacity=".07"/>
    <rect x="${pad}" y="${H - 250}" width="120" height="6" rx="3" fill="#fff" opacity=".8"/></svg>`)).png().toBuffer();
  const cat = await text((r.category?.name || 'Receita').toUpperCase(), { font: 'Inter Bold', fontfile: SANS_BOLD, size: 30, color: '#ffffffd9', width: W - pad * 2 });
  const title = await fitTitle(r.title, W - pad * 2, 760, '#ffffff', [104, 92, 82, 72, 64, 56]);
  const meta = metaLine(r) ? await text(metaLine(r), { font: 'Inter Medium', fontfile: SANS, size: 32, color: '#ffffffe6', width: W - pad * 2 }) : null;
  const footer = await text(hostOf(s.siteUrl || config.baseUrl) || s.siteName, { font: 'Inter Bold', fontfile: SANS_BOLD, size: 30, color: '#ffffff', width: W - pad * 2 });
  const block = cat.info.height + 36 + title.info.height;
  let y = Math.round((H - 300 - block) / 2) + 40;
  const layers = [{ input: bg, top: 0, left: 0 }, { input: cat.data, top: y, left: pad }];
  y += cat.info.height + 36;
  layers.push({ input: title.data, top: y, left: pad });
  if (meta) layers.push({ input: meta.data, top: H - 220, left: pad });
  layers.push({ input: footer.data, top: H - 120, left: pad });
  return sharp({ create: { width: W, height: H, channels: 3, background: c2 } }).composite(layers).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
}

function render(r) {
  const cover = localCover(r);
  return cover ? renderPhoto(r, cover) : renderText(r);
}

const inflight = new Map();

/** Caminho do JPEG do pin (gera e guarda em cache se necessário). */
async function file(r) {
  if (!sharp) return null;
  const v = version(r);
  const dir = path.join(config.uploadsDir, '.cache', 'pin');
  const dest = path.join(dir, `${r.code}-${v}.jpg`);
  if (fs.existsSync(dest)) return dest;
  if (inflight.has(dest)) return inflight.get(dest);
  const job = (async () => {
    fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
    for (const old of fs.readdirSync(dir)) if (old.startsWith(`${r.code}-`)) fs.rmSync(path.join(dir, old), { force: true }); // versões antigas
    const tmp = `${dest}.${process.pid}.part`;
    fs.writeFileSync(tmp, await render(r));
    fs.renameSync(tmp, dest);
    return dest;
  })().finally(() => inflight.delete(dest));
  inflight.set(dest, job);
  return job;
}

// ---------------- Capas para o Google (Recipe rich results) e compartilhamento ----------------
// O Google pede fotos em 1:1, 4:3 e 16:9 (mín. 50 mil pixels) e não aceita SVG. Com foto: recorte inteligente
// da própria foto. Sem foto: cartão colorido com o nome da receita (mesmo estilo do pin de texto).
const RATIOS = { '1x1': [1200, 1200], '4x3': [1200, 900], '16x9': [1200, 675] };

async function renderCard(r, cw, ch) {
  const pad = Math.round(cw * 0.07);
  const seed = crypto.createHash('sha1').update(`${r.code}|${r.title}`).digest().readUInt32BE(0);
  const [c1, c2] = PALETTE[seed % PALETTE.length];
  const bg = await sharp(svgBuf(`<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="${ch}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
    <rect width="${cw}" height="${ch}" fill="url(#g)"/><circle cx="${cw - 160 - (seed % 120)}" cy="${120 + ((seed >> 8) % 100)}" r="${Math.round(ch * 0.33)}" fill="#fff" opacity=".09"/><circle cx="${100 + ((seed >> 4) % 100)}" cy="${ch - 60}" r="${Math.round(ch * 0.26)}" fill="#fff" opacity=".07"/></svg>`)).png().toBuffer();
  const s = settings.all();
  const scale = Math.min(1, ch / 900);
  const cat = await text((r.category?.name || 'Receita').toUpperCase(), { font: 'Inter Bold', fontfile: SANS_BOLD, size: Math.round(30 * Math.max(scale, 0.8)), color: '#ffffffd9', width: cw - pad * 2 });
  const footer = await text(hostOf(s.siteUrl || config.baseUrl) || s.siteName, { font: 'Inter Bold', fontfile: SANS_BOLD, size: Math.round(28 * Math.max(scale, 0.8)), color: '#ffffff', width: cw - pad * 2 });
  const meta = metaLine(r) ? await text(metaLine(r), { font: 'Inter Medium', fontfile: SANS, size: Math.round(30 * Math.max(scale, 0.8)), color: '#ffffffe6', width: cw - pad * 2 }) : null;
  const room = ch - pad * 2 - cat.info.height - 30 - footer.info.height - (meta ? meta.info.height + 24 : 0) - 40;
  const title = await fitTitle(r.title, cw - pad * 2, room, '#ffffff', [104, 92, 82, 72, 64, 56, 48, 42].map((x) => Math.round(x * Math.max(scale, 0.7))));
  const block = cat.info.height + 30 + title.info.height + (meta ? 24 + meta.info.height : 0);
  let y = Math.max(pad, Math.round((ch - footer.info.height - pad - block) / 2));
  const layers = [{ input: bg, top: 0, left: 0 }, { input: cat.data, top: y, left: pad }];
  y += cat.info.height + 30;
  layers.push({ input: title.data, top: y, left: pad });
  y += title.info.height + 24;
  if (meta) layers.push({ input: meta.data, top: y, left: pad });
  layers.push({ input: footer.data, top: ch - pad - footer.info.height, left: pad });
  return sharp({ create: { width: cw, height: ch, channels: 3, background: c2 } }).composite(layers).jpeg({ quality: 86, mozjpeg: true }).toBuffer();
}

async function renderCover(r, ratio) {
  const [cw, ch] = RATIOS[ratio];
  const photo = localCover(r);
  if (photo) return sharp(photo, { limitInputPixels: 60e6 }).rotate().resize(cw, ch, { fit: 'cover', position: sharp.strategy.attention }).jpeg({ quality: 84, mozjpeg: true }).toBuffer();
  return renderCard(r, cw, ch);
}

/** URL da capa JPEG no formato pedido ("1x1", "4x3", "16x9"); vazio se a foto for de outro site. */
function coverUrl(r, ratio = '16x9') {
  if (!sharp || !r?.code || !RATIOS[ratio]) return '';
  if (r.cover && !localCover(r)) return ''; // foto externa: o site não recorta
  return `/capa/${encodeURIComponent(r.code)}-${ratio}.jpg?v=${version(r)}`;
}

async function coverFile(r, ratio) {
  if (!sharp || !RATIOS[ratio]) return null;
  const v = version(r);
  const dir = path.join(config.uploadsDir, '.cache', 'capa');
  const dest = path.join(dir, `${r.code}-${ratio}-${v}.jpg`);
  if (fs.existsSync(dest)) return dest;
  if (inflight.has(dest)) return inflight.get(dest);
  const job = (async () => {
    fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
    for (const old of fs.readdirSync(dir)) if (old.startsWith(`${r.code}-${ratio}-`)) fs.rmSync(path.join(dir, old), { force: true });
    const tmp = `${dest}.${process.pid}.part`;
    fs.writeFileSync(tmp, await renderCover(r, ratio));
    fs.renameSync(tmp, dest);
    return dest;
  })().finally(() => inflight.delete(dest));
  inflight.set(dest, job);
  return job;
}

module.exports = { file, pinUrl, render, version, W, H, RATIOS, coverUrl, coverFile };
