'use strict';
/**
 * SEO automático (semanal): usa as oportunidades do Google Search Console para ajustar o título SEO e a
 * descrição SEO das receitas, sem tocar no que foi escrito à mão.
 *  - "Quase na 1ª página" (posição 4–20): coloca a busca exata das pessoas no título e na descrição.
 *  - "Aparece, mas não clicam" (top 10, CTR baixo): reescreve o "anúncio" com tempo, dificuldade e rendimento.
 * Regras de segurança: no máximo 10 receitas por rodada; a mesma receita só muda de novo depois de 28 dias;
 * campos personalizados (diferentes do último valor automático) nunca são alterados; tudo fica registrado
 * em seo_changes, com "desfazer".
 */
const db = require('./db');
const settings = require('./settings');
const recipes = require('./recipes');
const u = require('./util');

const MAX_PER_RUN = 10;
const COOLDOWN_DAYS = 28;
const STOP = new Set(['com', 'sem', 'para', 'receita', 'receitas', 'como', 'fazer', 'que', 'de', 'da', 'do', 'das', 'dos', 'e', 'em', 'na', 'no', 'a', 'o']);

const norm = (x) => u.stripAccents(String(x || '')).toLowerCase();
const words = (q) => norm(q).split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w));
const covers = (text, q) => { const w = words(q); const t = norm(text); return w.length > 0 && w.every((x) => t.includes(x)); };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const cut = (s, n) => (s.length <= n ? s : `${s.slice(0, n - 1).replace(/[\s,;:.-]+\S*$/, '')}…`);

/** Liga cada oportunidade à receita e diz se a busca já está no título/descrição. */
function annotate(op, siteUrl) {
  const prefix = `${siteUrl}/receita/`;
  for (const it of [...op.almost, ...op.ctr]) {
    const slug = it.page.startsWith(prefix) ? decodeURIComponent(it.page.slice(prefix.length).split(/[?#]/)[0]) : '';
    const r = slug ? db.get().prepare('SELECT id, title, seo_title, description, seo_description FROM recipes WHERE slug = ?').get(slug) : null;
    it.path = it.page.replace(/^https?:\/\/[^/]+/, '') || '/';
    it.recipeId = r?.id || null;
    it.title = r?.title || '';
    it.inTitle = !!r && covers(`${r.seo_title || ''} ${r.title}`, it.query);
    it.inDescription = !!r && covers(`${r.seo_description || ''} ${r.description || ''}`, it.query);
  }
  return op;
}

/** Busca limpa ("receita de bolo de fubá cremoso" → "bolo de fubá cremoso"). */
const cleanQuery = (q) => String(q || '').trim().replace(/\s+/g, ' ').replace(/^(receitas?|como fazer|modo de (fazer|preparo))( de| do| da)?\s+/i, '').slice(0, 70);

function facts(r) {
  return {
    time: r.total_minutes ? u.formatMinutes(r.total_minutes) : '',
    easy: r.difficulty === 1,
    yields: r.servings ? `${String(r.servings).replace('.', ',')} ${r.servings_unit || 'porções'}` : '',
    ings: r.ingredients.slice(0, 3).map((i) => i.name.toLowerCase()).filter(Boolean),
  };
}

function fitTitle(base, suffixes) {
  for (const sfx of suffixes) if (`${base}: ${sfx}`.length <= 60) return `${base}: ${sfx}`;
  return cut(base, 65);
}

/** Texto novo (título e descrição) para uma receita a partir da oportunidade. */
function proposal(r, opp) {
  const f = facts(r);
  const q = cleanQuery(opp.query);
  // A busca é uma variação do nome da receita? Então ela vira o nome no título (é o que as pessoas digitam)
  const variant = q && covers(q, r.title) && q.length <= 55;
  const base = variant ? cap(q) : r.title;
  let title;
  let desc;
  if (opp.kind === 'ctr') {
    const timed = f.time && `${base} em ${f.time}`.length <= 45 ? `${base} em ${f.time}` : base; // "em 50 min" serve para qualquer prato
    title = fitTitle(timed, [`${f.easy ? 'fácil e ' : ''}passo a passo`, 'passo a passo']);
    desc = `Aprenda a fazer ${base.toLowerCase()}${f.time ? ` em ${f.time}` : ''}${f.ings.length ? ` com ${f.ings.join(', ')}` : ''}${f.yields ? `; rende ${f.yields}` : ''}. ${f.easy ? 'Receita fácil, ' : 'Receita '}com dicas, timers e modo cozinha.`;
  } else {
    title = fitTitle(base, [f.easy ? 'receita fácil e passo a passo' : 'receita passo a passo', 'receita fácil', 'passo a passo']);
    const also = !variant && q && !covers(r.title, q) ? ` Ideal para quem procura ${q}.` : '';
    desc = `Receita de ${base.toLowerCase()}${f.time ? ` pronta em ${f.time}` : ''}${f.ings.length ? `: ${f.ings.join(', ')}` : ''}.${also} Passo a passo com dicas, timers e modo cozinha.`;
  }
  return { title: cut(title, 70), description: cut(desc.replace(/\s+/g, ' '), 158) };
}

/** Último valor automático de cada campo (para saber se o atual foi escrito à mão). */
function lastAuto(recipeId) {
  return db.get().prepare('SELECT * FROM seo_changes WHERE recipe_id = ? AND reverted = 0 ORDER BY id DESC LIMIT 1').get(recipeId) || null;
}

/** Escolhe até MAX_PER_RUN receitas e aplica (ou só simula, com dryRun). */
async function run({ days = 28, dryRun = false, gsc = require('./gsc'), siteUrl = require('./mail').siteUrl() } = {}) {
  const op = annotate(await gsc.opportunities(days), siteUrl);
  const d = db.get();
  const byRecipe = new Map();
  for (const it of op.almost) if (it.recipeId && !it.inTitle) { const cur = byRecipe.get(it.recipeId); if (!cur || it.impressions > cur.impressions) byRecipe.set(it.recipeId, { ...it, kind: 'almost' }); }
  for (const it of op.ctr) if (it.recipeId && !byRecipe.has(it.recipeId)) byRecipe.set(it.recipeId, { ...it, kind: 'ctr' });
  const chosen = [...byRecipe.values()].sort((a, b) => b.impressions - a.impressions);
  const out = { changed: [], skipped: [] };
  for (const opp of chosen) {
    if (out.changed.length >= MAX_PER_RUN) break;
    const r = recipes.getById(opp.recipeId);
    if (!r || r.status !== 'published') continue;
    const recent = d.prepare(`SELECT 1 FROM seo_changes WHERE recipe_id = ? AND reverted = 0 AND created_at > datetime('now', '-${COOLDOWN_DAYS} days')`).get(r.id);
    if (recent) { out.skipped.push({ recipeId: r.id, title: r.title, reason: 'alterada há menos de 4 semanas' }); continue; }
    const auto = lastAuto(r.id);
    const manualTitle = r.seo_title && r.seo_title !== auto?.new_title;
    const manualDesc = r.seo_description && r.seo_description !== auto?.new_desc;
    if (manualTitle && manualDesc) { out.skipped.push({ recipeId: r.id, title: r.title, reason: 'título e descrição escritos à mão' }); continue; }
    const p = proposal(r, opp);
    const next = { seo_title: manualTitle ? r.seo_title : p.title, seo_description: manualDesc ? r.seo_description : p.description };
    if (next.seo_title === r.seo_title && next.seo_description === r.seo_description) continue;
    const change = {
      recipeId: r.id, recipeTitle: r.title, query: opp.query, kind: opp.kind, position: opp.position, impressions: opp.impressions,
      oldTitle: r.seo_title || '', newTitle: next.seo_title, oldDesc: r.seo_description || '', newDesc: next.seo_description,
    };
    if (!dryRun) {
      recipes.update(r.id, next);
      d.prepare('INSERT INTO seo_changes (recipe_id, query, kind, position, impressions, old_title, new_title, old_desc, new_desc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(r.id, opp.query, opp.kind, opp.position, opp.impressions, change.oldTitle, change.newTitle, change.oldDesc, change.newDesc);
    }
    out.changed.push(change);
  }
  if (!dryRun) {
    settings.update({ seoAutoLastRun: new Date().toISOString() });
    if (out.changed.length) require('./cache').bump();
  }
  return out;
}

/** Desfaz uma alteração (se a receita não foi editada depois). */
function undo(id) {
  const d = db.get();
  const c = d.prepare('SELECT * FROM seo_changes WHERE id = ?').get(id);
  if (!c) throw Object.assign(new Error('Alteração não encontrada'), { status: 404 });
  if (c.reverted) throw Object.assign(new Error('Esta alteração já foi desfeita'), { status: 409 });
  const r = recipes.getById(c.recipe_id);
  if (!r) throw Object.assign(new Error('Receita não encontrada'), { status: 404 });
  if ((r.seo_title || '') !== c.new_title || (r.seo_description || '') !== c.new_desc) throw Object.assign(new Error('A receita foi editada depois desta alteração; ajuste pelo editor'), { status: 409 });
  recipes.update(r.id, { seo_title: c.old_title, seo_description: c.old_desc });
  d.prepare('UPDATE seo_changes SET reverted = 1 WHERE id = ?').run(c.id);
  require('./cache').bump();
}

function log(limit = 50) {
  return db.get().prepare('SELECT c.*, r.title AS recipe_title, r.slug FROM seo_changes c LEFT JOIN recipes r ON r.id = c.recipe_id ORDER BY c.id DESC LIMIT ?').all(limit);
}

// ---------------- agendador (uma rodada por semana) ----------------
let timer = null;
async function tick() {
  const s = settings.all();
  const gsc = require('./gsc');
  if (!s.seoAuto || !gsc.status().configured || !require('./mail').siteUrl()) return;
  const lastRun = Date.parse(s.seoAutoLastRun || '') || 0;
  if (Date.now() - lastRun < 7 * 86400e3) return;
  try {
    const r = await run();
    if (r.changed.length) console.log(`🔎 SEO automático: ${r.changed.length} receita(s) ajustada(s)`);
  } catch (e) { console.warn('SEO automático:', e.message); }
}
function start() {
  if (timer) return;
  timer = setInterval(tick, 6 * 3600e3);
  timer.unref();
  setTimeout(tick, 5 * 60e3).unref();
}

module.exports = { annotate, proposal, run, undo, log, tick, start, cleanQuery, MAX_PER_RUN };
