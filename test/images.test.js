'use strict';
/** Imagens: conversão para WebP no envio (sem GPS), versões redimensionadas em AVIF/WebP/JPEG e srcset nas páginas. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chef-img-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.UPLOADS_DIR = path.join(tmp, 'uploads');
process.env.RATE_LIMIT = 'off';

const db = require('../src/db');
const auth = require('../src/auth');
const { createApp } = require('../src/app');

let server;
let base;
let cookie = '';
const PASS = `Pw-${crypto.randomBytes(8).toString('hex')}`;

async function req(method, url, { body, headers = {} } = {}) {
  const h = { ...headers };
  if (cookie) h.cookie = cookie;
  let payload = body;
  if (body && !(body instanceof FormData) && typeof body !== 'string') { payload = JSON.stringify(body); h['content-type'] = 'application/json'; }
  const res = await fetch(base + url, { method, headers: h, body: payload, redirect: 'manual' });
  const sc = res.headers.get('set-cookie');
  if (sc && /^chef_session=/.test(sc)) cookie = sc.split(';')[0];
  return res;
}
const upload = async (buf, type, name) => {
  const fd = new FormData();
  fd.append('files', new Blob([buf], { type }), name);
  const r = await req('POST', '/api/v1/uploads', { body: fd });
  return { status: r.status, data: await r.json() };
};

test.before(async () => {
  db.open(':memory:');
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  auth.createUser({ email: 'adm@exemplo.com', name: 'Adm', password: PASS, role: 'admin' });
  await req('POST', '/api/v1/auth/login', { body: { email: 'adm@exemplo.com', password: PASS } });
});
test.after(() => { server.close(); db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('envio: foto de celular vira WebP, sem GPS/EXIF, girada e com no máximo 2560 px', async () => {
  // JPEG 4000×3000 "deitado" (orientação 6 = girar 90°) com localização GPS no EXIF
  const jpg = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: '#d2691e' } })
    .composite([{ input: Buffer.from('<svg width="4000" height="3000"><circle cx="2000" cy="1500" r="900" fill="#fff"/></svg>') }])
    .jpeg({ quality: 95 })
    .withMetadata({ orientation: 6 })
    .withExifMerge({ IFD0: { Make: 'Celular' }, IFD3: { GPSLatitudeRef: 'S', GPSLatitude: '23/1 33/1 0/1' } })
    .toBuffer();
  const before = await sharp(jpg).metadata();
  assert.ok(before.exif && before.orientation === 6, 'o arquivo de teste tem EXIF com GPS e orientação');
  const r = await upload(jpg, 'image/jpeg', 'foto.jpg');
  assert.equal(r.status, 201);
  const f = r.data.files[0];
  assert.match(f.url, /^\/uploads\/[a-z0-9]+-[a-f0-9]{16}\.webp$/);
  assert.ok(f.size < f.originalSize / 2, `ficou bem menor (${f.originalSize} → ${f.size} bytes)`);
  const saved = fs.readFileSync(path.join(process.env.UPLOADS_DIR, path.basename(f.url)));
  const meta = await sharp(saved).metadata();
  assert.equal(meta.format, 'webp');
  assert.equal(meta.exif, undefined, 'EXIF (com GPS) removido');
  assert.deepEqual([meta.width, meta.height], [1920, 2560], 'girada (em pé) e limitada a 2560 px');
  assert.equal(fs.readdirSync(process.env.UPLOADS_DIR).filter((x) => x.endsWith('.jpg')).length, 0, 'o JPEG original não fica guardado');
  const row = db.get().prepare('SELECT mime, size FROM uploads WHERE filename = ?').get(path.basename(f.url));
  assert.deepEqual([row.mime, row.size], ['image/webp', f.size]);
});

test('/img: versões no tamanho pedido, AVIF quando o navegador aceita, WebP senão, JPEG com ?f=jpg', async () => {
  const png = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: '#2e8b57' } }).png().toBuffer();
  const { data } = await upload(png, 'image/png', 'prato.png');
  const file = path.basename(data.files[0].url);

  let r = await req('GET', `/img/320/${file}`, { headers: { accept: 'image/avif,image/webp,*/*' } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/avif');
  assert.match(r.headers.get('vary'), /Accept/);
  assert.match(r.headers.get('cache-control'), /max-age=31536000, immutable/);
  assert.match(r.headers.get('content-security-policy'), /sandbox/);
  let m = await sharp(Buffer.from(await r.arrayBuffer())).metadata();
  assert.equal(m.width, 320);

  r = await req('GET', `/img/640/${file}`, { headers: { accept: 'image/webp,*/*' } });
  assert.equal(r.headers.get('content-type'), 'image/webp');
  m = await sharp(Buffer.from(await r.arrayBuffer())).metadata();
  assert.deepEqual([m.format, m.width, m.height], ['webp', 640, 480]);

  r = await req('GET', `/img/1280/${file}?f=jpg`);
  assert.equal(r.headers.get('content-type'), 'image/jpeg');
  assert.equal(r.headers.get('vary'), null);

  r = await req('GET', `/img/1920/${file}`);
  m = await sharp(Buffer.from(await r.arrayBuffer())).metadata();
  assert.equal(m.width, 1600, 'nunca aumenta a foto');
  assert.ok(fs.existsSync(path.join(process.env.UPLOADS_DIR, '.cache', '640', file)), 'versão fica em cache no disco');
  assert.equal((await req('GET', `/uploads/.cache/640/${file}`)).status, 404, 'pasta de cache não é pública');
});

test('/img: entradas inválidas não geram arquivos (largura livre, caminho, inexistente)', async () => {
  const png = await sharp({ create: { width: 50, height: 50, channels: 3, background: '#000' } }).png().toBuffer();
  const file = path.basename((await upload(png, 'image/png', 'p.png')).data.files[0].url);
  let r = await req('GET', `/img/777/${file}`);
  assert.equal(r.status, 302, 'largura fora da lista → original');
  assert.equal(r.headers.get('location'), `/uploads/${file}`);
  r = await req('GET', '/img/320/..%2F..%2Fdata%2Fchef.db');
  assert.notEqual(r.status, 200);
  r = await req('GET', '/img/320/nao-existe.jpg');
  assert.equal(r.status, 302);
  assert.equal((await req('GET', r.headers.get('location'))).status, 404);
  assert.ok(!fs.existsSync(path.join(process.env.UPLOADS_DIR, '.cache', '777')));
});

test('fotos antigas (JPG enviado antes desta versão) também saem otimizadas', async () => {
  const old = await sharp({ create: { width: 2000, height: 1500, channels: 3, background: '#c0392b' } }).jpeg({ quality: 95 }).toBuffer();
  fs.writeFileSync(path.join(process.env.UPLOADS_DIR, 'antiga.jpg'), old);
  const r = await req('GET', '/img/480/antiga.jpg', { headers: { accept: 'image/webp' } });
  assert.equal(r.headers.get('content-type'), 'image/webp');
  const buf = Buffer.from(await r.arrayBuffer());
  assert.ok(buf.length < old.length / 5, `480 px em WebP é muito menor (${old.length} → ${buf.length})`);
});

test('GIF animado é mantido; GIF parado vira WebP; apagar o arquivo limpa as versões em cache', async () => {
  const frame = (c) => sharp({ create: { width: 40, height: 40, channels: 3, background: c } }).png().toBuffer();
  const animated = await sharp([await frame('#f00'), await frame('#00f')], { join: { animated: true } }).gif({ loop: 0 }).toBuffer();
  assert.equal((await sharp(animated, { animated: true }).metadata()).pages, 2, 'arquivo de teste tem 2 quadros');
  const anim = await upload(animated, 'image/gif', 'anim.gif');
  assert.match(anim.data.files[0].url, /\.gif$/, 'animação preservada');

  const one = await upload(await sharp(await frame('#0f0')).gif().toBuffer(), 'image/gif', 'um.gif');
  assert.match(one.data.files[0].url, /\.webp$/);
  const file = path.basename(one.data.files[0].url);
  await req('GET', `/img/160/${file}`, { headers: { accept: 'image/webp' } });
  const cached = path.join(process.env.UPLOADS_DIR, '.cache', '160', file);
  assert.ok(fs.existsSync(cached));
  const id = db.get().prepare('SELECT id FROM uploads WHERE filename = ?').get(file).id;
  assert.equal((await req('DELETE', `/api/v1/uploads/${id}`)).status, 200);
  assert.ok(!fs.existsSync(cached), 'cache removido junto');
});

test('páginas usam srcset com /img e og:image em JPEG; imagens de fora ficam como estão', async () => {
  const png = await sharp({ create: { width: 1200, height: 900, channels: 3, background: '#8e44ad' } }).png().toBuffer();
  const cover = (await upload(png, 'image/png', 'capa.png')).data.files[0].url;
  const file = path.basename(cover);
  const r = await (await req('POST', '/api/v1/recipes', { body: { title: 'Bolo com foto', cover, ingredients: 'a\nb\nc', steps: 'x\ny\nz', status: 'published' } })).json();
  const page = await (await fetch(`${base}/receita/${r.slug}`)).text();
  assert.match(page, new RegExp(`srcset="/img/320/${file} 320w, /img/480/${file} 480w, /img/640/${file} 640w, /img/960/${file} 960w, /img/1280/${file} 1280w, /img/1920/${file} 1920w" sizes="\\(min-width: 900px\\) 50vw, 100vw"`));
  assert.match(page, new RegExp(`property="og:image" content="[^"]*/img/1280/${file}\\?f=jpg"`));
  const list = await (await fetch(`${base}/receitas`)).text();
  assert.match(list, new RegExp(`src="/img/640/${file}" srcset="/img/320/${file} 320w, /img/480/${file} 480w, /img/640/${file} 640w"`), 'cartão pede no máximo 640 px');
  const ext = await (await req('POST', '/api/v1/recipes', { body: { title: 'Foto externa', cover: 'https://exemplo.com/foto.jpg', ingredients: 'a\nb\nc', steps: 'x\ny\nz', status: 'published' } })).json();
  const p2 = await (await fetch(`${base}/receita/${ext.slug}`)).text();
  assert.match(p2, /src="https:\/\/exemplo\.com\/foto\.jpg"/);
});

test('WebP já otimizado (como o painel envia) não é comprimido de novo', async () => {
  const webp = await sharp({ create: { width: 1200, height: 900, channels: 3, background: '#557a46' } }).webp({ quality: 85 }).toBuffer();
  const r = await upload(webp, 'image/webp', 'ja-leve.webp');
  const saved = fs.readFileSync(path.join(process.env.UPLOADS_DIR, path.basename(r.data.files[0].url)));
  assert.ok(saved.equals(webp), 'arquivo guardado exatamente como enviado');
});
