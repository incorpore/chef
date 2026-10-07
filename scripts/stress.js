'use strict';
/**
 * Teste de carga e de limites da API.
 *   npm run stress                 → sobe um servidor temporário com 2.000 receitas e mede tudo
 *   npm run stress -- --url=https://seusite --seconds=10 --concurrency=50   → contra um servidor real (somente leitura)
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const SECONDS = Number(args.seconds || 5);
const CONCURRENCY = Number(args.concurrency || 32);
const N_RECIPES = Number(args.recipes || 2000);

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function load(base, name, makeReq, { seconds = SECONDS, concurrency = CONCURRENCY } = {}) {
  const lat = [];
  const codes = {};
  let bytes = 0;
  const end = Date.now() + seconds * 1000;
  let i = 0;
  async function worker() {
    while (Date.now() < end) {
      const { url, init } = makeReq(i++);
      const t = performance.now();
      try {
        const res = await fetch(base + url, init);
        const buf = await res.arrayBuffer();
        bytes += buf.byteLength;
        codes[res.status] = (codes[res.status] || 0) + 1;
      } catch (e) {
        codes[e.cause?.code || 'ERR'] = (codes[e.cause?.code || 'ERR'] || 0) + 1;
      }
      lat.push(performance.now() - t);
    }
  }
  const t0 = Date.now();
  await Promise.all(Array.from({ length: concurrency }, worker));
  const dur = (Date.now() - t0) / 1000;
  lat.sort((a, b) => a - b);
  const total = lat.length;
  const ok = Object.entries(codes).filter(([c]) => /^2|^3/.test(c)).reduce((a, [, n]) => a + n, 0);
  return { name, reqs: total, rps: Math.round(total / dur), p50: percentile(lat, 50).toFixed(1), p95: percentile(lat, 95).toFixed(1), p99: percentile(lat, 99).toFixed(1), max: lat[total - 1]?.toFixed(1), okPct: ((ok / total) * 100).toFixed(1), codes, mb: (bytes / 1e6).toFixed(1) };
}

function table(rows) {
  const cols = ['name', 'reqs', 'rps', 'p50', 'p95', 'p99', 'max', 'okPct', 'mb'];
  const head = { name: 'rota', reqs: 'reqs', rps: 'req/s', p50: 'p50 ms', p95: 'p95 ms', p99: 'p99 ms', max: 'máx ms', okPct: '% ok', mb: 'MB' };
  const w = Object.fromEntries(cols.map((c) => [c, Math.max(String(head[c]).length, ...rows.map((r) => String(r[c]).length))]));
  const line = (r) => cols.map((c) => String(r[c]).padEnd(w[c])).join('  ');
  console.log(line(head));
  console.log(cols.map((c) => '-'.repeat(w[c])).join('  '));
  for (const r of rows) console.log(line(r) + (Object.keys(r.codes).some((c) => !/^[23]/.test(c)) ? `   ${JSON.stringify(r.codes)}` : ''));
}

async function main() {
  let base = args.url;
  let stop = () => {};
  let key = '';
  const local = !base;
  if (local) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chef-stress-'));
    process.env.DATA_DIR = path.join(tmp, 'data');
    process.env.UPLOADS_DIR = path.join(tmp, 'uploads');
    const db = require('../src/db');
    db.open();
    const auth = require('../src/auth');
    const recipes = require('../src/recipes');
    const uid = auth.createUser({ email: 'stress@chef.com', password: require('node:crypto').randomBytes(18).toString('base64url'), name: 'Stress', role: 'admin' });
    key = auth.createApiKey(uid, 'stress').key;
    console.log(`Populando ${N_RECIPES} receitas…`);
    const words = ['bolo', 'torta', 'pão', 'frango', 'carne', 'arroz', 'feijão', 'salada', 'sopa', 'massa', 'chocolate', 'cenoura', 'laranja', 'queijo', 'tomate', 'batata', 'peixe', 'ovo', 'leite', 'banana'];
    const t0 = Date.now();
    for (let i = 0; i < N_RECIPES; i++) {
      const a = words[i % words.length];
      const b = words[(i * 7) % words.length];
      recipes.create({ title: `${a} com ${b} ${i}`, description: `Receita de ${a} e ${b}`, ingredients: `2 xícaras de ${a}\n3 ovos\n200 g de ${b}\n1 colher (sopa) de manteiga`, steps: `Misture o ${a}.\nJunte o ${b}.\nAsse por ${20 + (i % 40)} minutos.`, tags: [a, b], prep_minutes: 10 + (i % 30), cook_minutes: i % 60, status: 'published' }, uid);
    }
    console.log(`  ok em ${((Date.now() - t0) / 1000).toFixed(1)}s (${Math.round(N_RECIPES / ((Date.now() - t0) / 1000))} inserções/s)\n`);
    process.env.RATE_LIMIT = 'off';
    const { createApp } = require('../src/app');
    const server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
    stop = () => { server.close(); db.close(); fs.rmSync(tmp, { recursive: true, force: true }); };
  }

  console.log(`Carga: ${CONCURRENCY} conexões simultâneas por ${SECONDS}s em cada rota (${local ? 'servidor local' : base})\n`);
  const q = ['bolo', 'chocolate', 'frango com batata', 'acucar', 'tomate', 'pao'];
  const rows = [];
  rows.push(await load(base, 'GET /api/v1/recipes (lista)', (i) => ({ url: `/api/v1/recipes?page=${(i % 50) + 1}` })));
  rows.push(await load(base, 'GET /api/v1/recipes?q= (busca)', (i) => ({ url: `/api/v1/recipes?q=${encodeURIComponent(q[i % q.length])}` })));
  rows.push(await load(base, 'GET ?ingredients= (geladeira)', (i) => ({ url: `/api/v1/recipes?ingredients=${encodeURIComponent(`${q[i % q.length]},ovo`)}` })));
  rows.push(await load(base, 'GET /api/v1/search/suggest', (i) => ({ url: `/api/v1/search/suggest?q=${q[i % q.length].slice(0, 3)}` })));
  rows.push(await load(base, 'GET /api/v1/recipes/:id', (i) => ({ url: `/api/v1/recipes/${(i % Math.max(1, N_RECIPES)) + 1}` })));
  if (local) {
    const slugs = require('../src/db').get().prepare('SELECT slug FROM recipes LIMIT 500').all().map((r) => r.slug);
    rows.push(await load(base, 'GET /receita/:slug (HTML)', (i) => ({ url: `/receita/${slugs[i % slugs.length]}` })));
  }
  rows.push(await load(base, 'GET / (home HTML)', () => ({ url: '/' })));
  rows.push(await load(base, 'GET /sitemap.xml', () => ({ url: '/sitemap.xml' }), { concurrency: 8 }));
  if (local) {
    rows.push(await load(base, 'POST /api/v1/recipes (escrita)', (i) => ({ url: '/api/v1/recipes', init: { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ title: `Carga ${i}`, ingredients: '1 ovo', steps: 'x', status: 'draft' }) } }), { concurrency: 8 }));
  }
  table(rows);

  if (local) {
    console.log('\nLimites (cada um precisa ser BARRADO):');
    delete process.env.RATE_LIMIT;
    require('../src/security').resetLimits();
    const check = async (label, fn, expect) => {
      const status = await fn();
      console.log(`  ${expect.includes(status) ? '✅' : '❌'} ${label} → HTTP ${status}`);
      return expect.includes(status);
    };
    const results = [];
    results.push(await check('Rajada de 700 leituras/min do mesmo IP', async () => {
      let last = 200;
      for (let i = 0; i < 700 && last !== 429; i++) last = (await fetch(`${base}/api/v1/tags`)).status;
      return last;
    }, [429]));
    require('../src/security').resetLimits();
    results.push(await check('11 logins errados seguidos', async () => {
      let last;
      for (let i = 0; i < 11; i++) last = (await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `a${i}@b.com`, password: 'x'.repeat(10) }) })).status;
      return last;
    }, [429]));
    require('../src/security').resetLimits();
    results.push(await check('JSON de 2 MB numa rota comum', async () => (await fetch(`${base}/api/v1/recipes`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ title: 'x', story: 'a'.repeat(2e6) }) })).status, [413]));
    results.push(await check('Título com 10 mil caracteres', async () => (await fetch(`${base}/api/v1/recipes`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ title: 'x'.repeat(10000) }) })).status, [400]));
    results.push(await check('perPage=100000 (é limitado a 100)', async () => {
      const r = await (await fetch(`${base}/api/v1/recipes?perPage=100000`)).json();
      return r.items.length === 100 ? 200 : 500;
    }, [200]));
    results.push(await check('Busca com 5 mil caracteres', async () => (await fetch(`${base}/api/v1/recipes?q=${'bolo '.repeat(1000)}`)).status, [200]));
    results.push(await check('Página 999999 da lista', async () => (await fetch(`${base}/api/v1/recipes?page=999999`)).status, [200]));
    results.push(await check('Importação em lote com 501 itens', async () => (await fetch(`${base}/api/v1/import/json`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(Array(501).fill({ title: 'x' })) })).status, [413]));
    results.push(await check('Upload de 25 arquivos de uma vez', async () => {
      const fd = new FormData();
      for (let i = 0; i < 25; i++) fd.append('files', new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])], { type: 'image/jpeg' }), 'a.jpg');
      return (await fetch(`${base}/api/v1/uploads`, { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: fd })).status;
    }, [400]));
    console.log(results.every(Boolean) ? '\nTodos os limites funcionaram.' : '\nATENÇÃO: algum limite falhou.');
    if (!results.every(Boolean)) process.exitCode = 1;
  }
  stop();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
