'use strict';
/**
 * Auditoria de responsividade: abre o site num navegador real em 8 larguras de tela (300 → 1366 px)
 * e procura qualquer elemento que saia da tela ou transborde do próprio espaço — inclusive no modo
 * cozinha (cada passo), com timers, avisos e banners abertos, e nas telas do painel.
 *
 *   npm run audit:responsive          (precisa do Playwright: npx playwright install chromium)
 *   SHOTS=1 npm run audit:responsive  (também salva capturas em ./responsive-shots)
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let chromium;
try { ({ chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')); } catch {
  console.error('Playwright não encontrado. Instale com: npm i --no-save playwright && npx playwright install chromium');
  process.exit(2);
}

const WIDTHS = (process.env.WIDTHS || '300,320,360,390,414,768,1024,1366').split(',').map(Number);
const SHOTS = process.env.SHOTS === '1';
const SHOT_DIR = path.join(process.cwd(), 'responsive-shots');
const LONG = 'SuperCalifragilisticoExpialidociousIngredienteSemEspacosNenhumParaTestarQuebra';
let B;

async function startServer() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chef-resp-'));
  process.env.DATA_DIR = path.join(tmp, 'data');
  process.env.UPLOADS_DIR = path.join(tmp, 'uploads');
  process.env.RATE_LIMIT = 'off';
  process.env.PAGE_CACHE_SECONDS = '0';
  const db = require('../src/db');
  db.open();
  const auth = require('../src/auth');
  const recipes = require('../src/recipes');
  const uid = auth.createUser({ email: 'ana@exemplo.com', password: PASS, name: 'Ana', role: 'admin' });
  db.get().prepare("INSERT INTO categories (name, slug, icon) VALUES ('Tortas e salgados de forno', 'tortas', '🥧')").run();
  recipes.create({ title: 'Bolo de cenoura', ingredients: '3 cenouras\n3 ovos', steps: 'Bata.\nAsse por 40 minutos.', status: 'published' }, uid);
  recipes.create({
    title: 'Torta salgada de frango com requeijão cremoso, milho verde, ervilha e azeitonas pretas fatiadas', code: 'LONGA1', category_id: 1,
    description: 'Receita de teste com textos muito longos para verificar a responsividade em telas pequenas.',
    ingredients: `## Massa amanteigada de liquidificador para tortas\n3 xícaras (chá) de farinha de trigo especial sem fermento peneirada duas vezes\n2 colheres (sopa) de fermento químico em pó para bolos e tortas\n1 lata de creme de leite fresco sem soro (300 g) bem gelado\n## Recheio\n500 g de peito de frango desfiado temperado com alho, cebola, cheiro-verde e pimenta-do-reino moída na hora\n1 copo de requeijão cremoso tradicional de boa qualidade\n${LONG}\n1 colher (chá) de sal`,
    steps: `## Massa\nBata no liquidificador a farinha de trigo especial, o fermento químico em pó e o creme de leite fresco por 5 minutos.\nDespeje metade da massa na forma untada.\n## Recheio\nEspalhe o peito de frango desfiado temperado e o requeijão cremoso tradicional.\nCubra com o restante da massa e o ${LONG}.\nAsse em forno preaquecido a 200 °C por 45 minutos até dourar, depois deixe descansar 10 minutos.\nSirva com farinha de trigo especial, fermento químico em pó, creme de leite fresco, peito de frango desfiado e requeijão cremoso por cima.`,
    prep_minutes: 25, cook_minutes: 45, rest_minutes: 10, servings: 10, servings_unit: 'pedaços generosos', tags: `torta salgada, almoço de domingo em família, ${LONG.slice(0, 40)}`, status: 'published',
  }, uid);
  const { createApp } = require('../src/app');
  const server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  B = `http://127.0.0.1:${server.address().port}`;
  return () => { server.close(); db.close(); fs.rmSync(tmp, { recursive: true, force: true }); };
}
const PASS = `Pw-${require('node:crypto').randomBytes(9).toString('hex')}`;

const detect = () => {
  const vw = document.documentElement.clientWidth;
  const out = [];
  const name = (el) => el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '') + (el.dataset && Object.keys(el.dataset)[0] ? `[data-${Object.keys(el.dataset)[0].replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}]` : '');
  const clippedByScroller = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) return p;
    }
    return null;
  };
  if (document.documentElement.scrollWidth > vw + 1) out.push(`PÁGINA com rolagem lateral: ${document.documentElement.scrollWidth}px > ${vw}px`);
  for (const el of document.querySelectorAll('body *')) {
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || el.closest('[hidden]') || el.closest('template') || el.closest('dialog:not([open])')) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (el.matches('.skip, .hp, .skip *, .hp *')) continue; // escondidos de propósito (acessibilidade e anti-spam)
    const sc = clippedByScroller(el);
    // 1) sai da tela (só conta se não estiver dentro de um carrossel/rolagem horizontal intencional)
    if ((r.right > vw + 1 || r.left < -1) && !sc && st.position !== 'fixed' && !el.closest('.cook-track')) out.push(`fora da tela: ${name(el)} (${Math.round(r.left)}→${Math.round(r.right)} de ${vw})`);
    if (st.position === 'fixed' && (r.right > vw + 1 || r.left < -1)) out.push(`FIXO fora da tela: ${name(el)} (${Math.round(r.left)}→${Math.round(r.right)} de ${vw})`);
    // 2) texto/conteúdo transbordando do próprio elemento (overflow visível)
    if (st.overflowX === 'visible' && el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0 && !['svg', 'path', 'circle', 'img', 'video', 'iframe', 'input', 'select', 'textarea'].includes(el.tagName.toLowerCase()) && el.children.length < 30) out.push(`transborda: ${name(el)} (conteúdo ${el.scrollWidth}px em ${el.clientWidth}px)`);
    // 3) dentro do modo cozinha: cada cartão é uma tela; nada pode passar da largura do cartão
    const card = el.closest('.cook-card');
    if (card && el !== card) {
      const cr = card.getBoundingClientRect();
      if (r.right > cr.right + 1 || r.left < cr.left - 1) out.push(`fora do cartão do modo cozinha: ${name(el)}`);
    }
  }
  return [...new Set(out)];
};

(async () => {
  const stop = await startServer();
  if (SHOTS) fs.mkdirSync(SHOT_DIR, { recursive: true });
  const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const report = {};
  const add = (k, list) => { if (list.length) report[k] = list; };
  // login para páginas do admin
  const login = await b.newContext();
  const lp = await login.newPage();
  await lp.goto(B + '/admin');
  await lp.goto(B + '/admin/login');
  await lp.fill('[name=email]', 'ana@exemplo.com'); await lp.fill('[name=password]', PASS);
  await lp.click('button.btn-primary'); await lp.waitForURL('**/admin');
  const cookies = await login.cookies();
  for (const w of WIDTHS) {
    const ctx = await b.newContext({ viewport: { width: w, height: 800 }, isMobile: w < 900, hasTouch: w < 900, deviceScaleFactor: SHOTS ? 2 : 1 });
    await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort()); // sem internet: só o próprio site
    const p = await ctx.newPage();
    const pages = ['/', '/receitas', '/busca?q=torta', '/c/LONGA1', '/categorias', '/geladeira?q=SuperCalifragilisticoExpialidociousIngredienteSemEspacos', '/conversor', '/sobre', '/privacidade', '/api/docs', '/favoritos', '/planejador'];
    for (const u of pages) {
      await p.goto(B + u, { waitUntil: 'load' });
      await p.waitForTimeout(250);
      add(`${w}px ${u.slice(0, 40)}`, await p.evaluate(detect));
    }
    // receita longa: lista de compras + timers + toast + modo cozinha
    const R = B + '/c/LONGA1';
    await p.goto(R);
    await p.evaluate(() => {
      for (const l of ['Passo 5: Asse em forno preaquecido a 200 °C por 45 minutos até dourar', 'Passo 1: Bata no liquidificador', 'SuperCalifragilisticoExpialidociousTimerSemEspacos', 'Passo 6']) window.Chef.timers.start(2700, l);
      window.Chef.toast('⏰ Passo 5: Asse em forno preaquecido a 200 °C por 45 minutos até dourar — 45:00 e mais um texto bem comprido para testar', 8000);
      document.querySelector('.consent') && (document.querySelector('.consent').hidden = false);
      document.querySelector('.install-banner').hidden = false;
    });
    await p.waitForTimeout(400);
    add(`${w}px receita+timers+toast+banners`, await p.evaluate(detect));
    if (SHOTS && w <= 390) await p.screenshot({ path: path.join(SHOT_DIR, `${w}-timers.png`) });
    await p.evaluate(() => { document.querySelector('.consent') && (document.querySelector('.consent').hidden = true); document.querySelector('.install-banner').hidden = true; });
    await p.locator('.actions [data-cook-start]').dispatchEvent('click');
    await p.waitForTimeout(300);
    const n = await p.$$eval('.cook-card', (c) => c.length);
    for (let i = 0; i < n; i++) {
      await p.evaluate((k) => { const t = document.querySelector('.cook-track'); t.scrollTo({ left: t.clientWidth * k, behavior: 'instant' }); }, i);
      await p.waitForTimeout(220);
      add(`${w}px modo cozinha cartão ${i}`, await p.evaluate(detect));
      if (SHOTS && w <= 390 && [0, 5, 6].includes(i)) await p.screenshot({ path: path.join(SHOT_DIR, `${w}-cozinha-${i}.png`) });
    }
    await p.click('[data-cook-ings]');
    await p.waitForTimeout(600); // espera a animação de entrada da gaveta
    add(`${w}px modo cozinha gaveta`, await p.evaluate(detect));
    if (SHOTS && w <= 390) await p.screenshot({ path: path.join(SHOT_DIR, `${w}-gaveta.png`) });
    await p.click('[data-cook-close]').catch(() => {});
    await p.locator('.actions [data-add-list]').dispatchEvent('click');
    await p.evaluate(() => window.Chef.shopping.addText('SuperCalifragilisticoExpialidociousItemDaListaSemEspacosNenhum'));
    await p.goto(B + '/lista'); await p.waitForTimeout(250);
    add(`${w}px /lista`, await p.evaluate(detect));
    await p.goto(B + '/planejador'); await p.waitForTimeout(250);
    await p.evaluate(() => { const k = window.Chef.dateKey(new Date()); window.Chef.planner.add(k, 'almoco', { id: 999, slug: 'x', title: 'Torta salgada de frango com requeijão cremoso, milho verde, ervilha e azeitonas pretas fatiadas', cover: '' }); });
    await p.reload(); await p.waitForTimeout(250);
    add(`${w}px /planejador com item`, await p.evaluate(detect));
    await p.evaluate(() => localStorage.clear());
    // admin
    await ctx.addCookies(cookies);
    for (const u of ['/admin', '/admin/receitas', '/admin/receitas/2', '/admin/importar', '/admin/configuracoes', '/admin/produtos', '/admin/anuncios', '/admin/api', '/admin/comentarios', '/admin/auditoria']) {
      await p.goto(B + u); await p.waitForTimeout(300);
      add(`${w}px ${u}`, await p.evaluate(detect));
    }
    await ctx.close();
  }
  const keys = Object.keys(report);
  if (!keys.length) console.log('✅ Nenhum problema de responsividade encontrado.');
  for (const k of keys) console.log(`\n■ ${k}\n  - ${report[k].slice(0, 12).join('\n  - ')}${report[k].length > 12 ? `\n  … +${report[k].length - 12}` : ''}`);
  console.log(`\nTelas verificadas: ${WIDTHS.length} larguras. Telas com problema: ${keys.length}`);
  await b.close();
  stop();
  process.exitCode = keys.length ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });
