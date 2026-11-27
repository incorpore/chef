'use strict';
/**
 * Imagens leves e no tamanho certo.
 *
 * 1) No envio (optimizeUpload): gira conforme o EXIF, remove metadados (inclusive a localização GPS do
 *    celular), limita a 2560 px e grava em WebP (qualidade 82: visualmente igual ao original, bem menor).
 *    GIF animado é mantido como está.
 * 2) Na exibição (/img/LARGURA/arquivo): gera sob demanda versões redimensionadas em AVIF (o formato mais
 *    leve, quando o navegador aceita) ou WebP, guarda em cache no disco e entrega com cache de 1 ano.
 *    As páginas usam srcset, então o celular baixa a versão pequena e o computador a grande.
 *    Funciona também para as fotos enviadas antes desta versão (JPG/PNG), sem precisar converter nada.
 */
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');

let sharp = null;
try {
  // Fontes embutidas (assets/fonts) para o texto das imagens do Pinterest; evita depender de fontes do sistema
  if (!process.env.FONTCONFIG_FILE) {
    process.env.FONTCONFIG_FILE = path.join(config.root, 'assets', 'fonts', 'fonts.conf');
    try { fs.mkdirSync('/tmp/chef-fontconfig', { recursive: true }); } catch { /* sem cache de fontes: só fica mais lento */ }
  }
  sharp = require('sharp');
  sharp.concurrency(1); // aparelhos pequenos (ZimaOS/Raspberry): uma imagem por vez, pouca memória
  sharp.cache(false);
} catch (e) {
  console.warn('[imagens] sharp indisponível: as fotos serão servidas sem otimização.', e.message);
}

const WIDTHS = [160, 320, 480, 640, 960, 1280, 1920];
const MAX_SIDE = 2560;
const MAX_PIXELS = 60e6; // proteção contra "bombas" de descompressão
const QUALITY = { webp: 82, avif: 60, jpeg: 84 }; // visualmente iguais ao original, muito menores
const RASTER = /\.(jpe?g|png|webp|gif|avif)$/i;
const FILE_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,150}$/;

const available = () => !!sharp;
const cacheDir = () => path.join(config.uploadsDir, '.cache');

/** Converte a foto recém-enviada para WebP otimizado. Devolve o novo nome (ou o mesmo, se não mudou). */
async function optimizeUpload(name, mime) {
  if (!sharp || !/^image\/(jpeg|png|webp|gif)$/.test(mime)) return { name, mime };
  const src = path.join(config.uploadsDir, name);
  try {
    const meta = await sharp(src, { limitInputPixels: MAX_PIXELS, animated: true }).metadata();
    if (mime === 'image/gif' && (meta.pages || 1) > 1) return { name, mime }; // GIF animado fica como está
    // Já é WebP leve (ex.: reduzido no navegador pelo painel): não comprime de novo, para não perder qualidade
    if (mime === 'image/webp' && !meta.exif && !meta.xmp && (meta.orientation || 1) === 1 && Math.max(meta.width, meta.height) <= MAX_SIDE) return { name, mime };
    const out = name.replace(/\.[a-z0-9]+$/i, '') + '.webp';
    const tmp = path.join(config.uploadsDir, `${out}.part`);
    await sharp(src, { limitInputPixels: MAX_PIXELS })
      .rotate() // respeita a orientação da câmera
      .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: QUALITY.webp, effort: 5, smartSubsample: true })
      .toFile(tmp); // sem withMetadata(): EXIF/GPS são descartados
    fs.renameSync(tmp, path.join(config.uploadsDir, out));
    if (out !== name) fs.rmSync(src, { force: true });
    return { name: out, mime: 'image/webp', size: fs.statSync(path.join(config.uploadsDir, out)).size };
  } catch (e) {
    console.warn('[imagens] não foi possível otimizar', name, e.message);
    return { name, mime };
  }
}

const inflight = new Map();

/** Caminho da versão redimensionada (gera na primeira vez). Formatos: avif, webp, jpeg. */
async function variant(file, width, format) {
  if (!sharp || !FILE_RE.test(file) || !RASTER.test(file) || !WIDTHS.includes(width)) return null;
  const src = path.join(config.uploadsDir, file);
  if (path.dirname(src) !== path.resolve(config.uploadsDir) || !fs.existsSync(src)) return null;
  const ext = format === 'jpeg' ? 'jpg' : format;
  const dest = path.join(cacheDir(), String(width), `${file.replace(/\.[a-z0-9]+$/i, '')}.${ext}`);
  try {
    if (fs.statSync(dest).mtimeMs >= fs.statSync(src).mtimeMs) return dest;
  } catch { /* ainda não existe */ }
  if (inflight.has(dest)) return inflight.get(dest);
  const job = (async () => {
    fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o750 });
    const tmp = `${dest}.${process.pid}.part`;
    let img = sharp(src, { limitInputPixels: MAX_PIXELS }).rotate().resize({ width, withoutEnlargement: true });
    if (format === 'avif') img = img.avif({ quality: QUALITY.avif, effort: 4 });
    else if (format === 'jpeg') img = img.flatten({ background: '#ffffff' }).jpeg({ quality: QUALITY.jpeg, mozjpeg: true });
    else img = img.webp({ quality: QUALITY.webp, effort: 4, smartSubsample: true });
    await img.toFile(tmp);
    fs.renameSync(tmp, dest);
    return dest;
  })().finally(() => inflight.delete(dest));
  inflight.set(dest, job);
  return job;
}

/**
 * Gera em segundo plano os tamanhos mais pedidos (celular e computador), para o primeiro visitante não esperar.
 * Roda uma imagem por vez (sharp.concurrency(1)), então não pesa no servidor.
 */
function warm(name, widths = [640, 1280], formats = ['avif', 'webp']) {
  if (!sharp || !RASTER.test(name)) return Promise.resolve();
  return (async () => {
    for (const w of widths) for (const f of formats) await variant(name, w, f).catch(() => {});
  })();
}

/** Menor largura da lista que cobre a pedida (ex.: 700 → 960). */
function fit(width) {
  return WIDTHS.find((w) => w >= width) || WIDTHS[WIDTHS.length - 1];
}

/** É uma foto enviada ao site (que pode ser redimensionada)? */
function isLocal(url) {
  return typeof url === 'string' && /^\/uploads\/[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(url) && RASTER.test(url) && !!sharp;
}

/** URL redimensionada de uma foto enviada; outras URLs voltam iguais. */
const isUnsplash = (url) => typeof url === 'string' && /^https:\/\/images\.unsplash\.com\//.test(url);
function sized(url, width, format = '') {
  if (isUnsplash(url)) return require('./stock').unsplashSized(url, fit(width), format);
  if (!isLocal(url)) return url;
  const file = url.slice('/uploads/'.length);
  return `/img/${fit(width)}/${file}${format === 'jpeg' ? '?f=jpg' : ''}`;
}

/** Atributos src/srcset/sizes para <img>. `max` = maior largura útil para aquele lugar da página. */
function attrs(url, { sizes = '100vw', max = 1920, min = 320 } = {}) {
  if (!isLocal(url) && !isUnsplash(url)) return { src: url, srcset: '', sizes: '' };
  const list = WIDTHS.filter((w) => w >= min && w <= fit(max));
  return {
    src: sized(url, Math.min(960, fit(max))),
    srcset: list.map((w) => `${sized(url, w)} ${w}w`).join(', '),
    sizes,
  };
}

/** Remove o cache das versões de uma foto (ex.: ao apagar o arquivo). */
function purge(file) {
  for (const w of WIDTHS) for (const ext of ['avif', 'webp', 'jpg']) fs.rmSync(path.join(cacheDir(), String(w), `${file.replace(/\.[a-z0-9]+$/i, '')}.${ext}`), { force: true });
}

module.exports = { optimizeUpload, variant, warm, sized, attrs, isLocal, fit, purge, available, WIDTHS };
