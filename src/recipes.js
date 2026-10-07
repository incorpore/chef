'use strict';
const db = require('./db');
const u = require('./util');

function hydrate(row) {
  if (!row) return null;
  const r = { ...row };
  r.images = u.safeJson(r.images, []);
  r.video = u.safeJson(r.video, null);
  r.ingredients = u.safeJson(r.ingredients, []);
  r.steps = u.safeJson(r.steps, []);
  r.nutrition = u.safeJson(r.nutrition, null);
  r.diets = u.safeJson(r.diets, []);
  r.featured = !!r.featured;
  r.total_minutes = (r.prep_minutes || 0) + (r.cook_minutes || 0) + (r.rest_minutes || 0);
  r.tags = db.get().prepare('SELECT tag FROM recipe_tags WHERE recipe_id = ? ORDER BY tag').all(r.id).map((t) => t.tag);
  if (r.category_id) r.category = db.get().prepare('SELECT * FROM categories WHERE id = ?').get(r.category_id) || null;
  const rating = db.get().prepare("SELECT AVG(rating) AS avg, COUNT(rating) AS n FROM comments WHERE recipe_id = ? AND status = 'approved' AND rating IS NOT NULL").get(r.id);
  r.rating = { average: rating.avg ? Math.round(rating.avg * 10) / 10 : null, count: rating.n };
  return r;
}

function uniqueCode(d, wanted, excludeId) {
  if (wanted) {
    const code = u.normalizeCode(wanted).slice(0, 16);
    if (code.length < 3) throw Object.assign(new Error('O código deve ter ao menos 3 letras/números'), { status: 400 });
    const clash = d.prepare('SELECT id FROM recipes WHERE code = ? AND id IS NOT ?').get(code, excludeId ?? null);
    if (clash) throw Object.assign(new Error(`O código ${code} já está em uso`), { status: 409 });
    return code;
  }
  for (;;) {
    const code = u.randomCode(6);
    if (!d.prepare('SELECT 1 FROM recipes WHERE code = ?').get(code)) return code;
  }
}

function uniqueSlug(d, base, excludeId) {
  const root = u.slugify(base);
  let slug = root;
  for (let i = 2; d.prepare('SELECT 1 FROM recipes WHERE slug = ? AND id IS NOT ?').get(slug, excludeId ?? null); i++) slug = `${root}-${i}`;
  return slug;
}

function clampInt(v, min, max, def) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

/** Normaliza o payload vindo de formulário/API/importador. Aceita textos ou listas estruturadas. */
function normalizeInput(input) {
  const out = {};
  const has = (k) => input[k] !== undefined;
  for (const k of ['title', 'description', 'story', 'tips', 'cuisine', 'servings_unit', 'source_url', 'source_name']) if (has(k)) out[k] = String(input[k] ?? '').trim();
  if (has('cover')) out.cover = u.isSafeUrl(input.cover) ? String(input.cover || '') : '';
  if (has('images')) {
    out.images = (Array.isArray(input.images) ? input.images : [])
      .map((i) => (typeof i === 'string' ? { url: i, caption: '' } : { url: i.url, caption: String(i.caption || '') }))
      .filter((i) => i.url && u.isSafeUrl(i.url));
  }
  if (has('video')) {
    const v = u.parseVideo(input.video);
    out.video = v && u.isSafeUrl(v.url) ? v : null;
  }
  if (has('ingredients')) {
    out.ingredients = typeof input.ingredients === 'string'
      ? u.parseIngredientsText(input.ingredients)
      : (input.ingredients || []).map((i) => (typeof i === 'string' ? u.parseIngredient(i) : { ...u.parseIngredient(i.raw || [i.quantity, i.unit, i.name].filter(Boolean).join(' ')), ...pick(i, ['quantity', 'quantityMax', 'unit', 'name', 'note', 'group', 'productId']) }));
  }
  if (has('steps')) {
    out.steps = typeof input.steps === 'string'
      ? u.parseStepsText(input.steps)
      : (input.steps || []).map((s) => {
          const text = String(typeof s === 'string' ? s : s.text || '').trim();
          const base = { text, group: '', image: '', timer: (u.detectTimers(text)[0] || {}).seconds || null };
          if (typeof s === 'object') {
            if (s.group) base.group = String(s.group);
            if (s.image && u.isSafeUrl(s.image)) base.image = String(s.image);
            if (s.timer !== undefined && s.timer !== '') base.timer = s.timer ? clampInt(s.timer, 0, 172800, null) : null;
          }
          return base;
        }).filter((s) => s.text);
  }
  for (const k of ['prep_minutes', 'cook_minutes', 'rest_minutes']) if (has(k)) out[k] = clampInt(input[k], 0, 100000, 0);
  if (has('servings')) out.servings = Math.max(0.5, Number(String(input.servings).replace(',', '.')) || 4);
  if (has('difficulty')) out.difficulty = clampInt(input.difficulty, 1, 3, 2);
  if (has('category_id')) out.category_id = input.category_id ? Number(input.category_id) || null : null;
  if (has('nutrition')) {
    const n = input.nutrition && typeof input.nutrition === 'object' ? input.nutrition : null;
    out.nutrition = n ? Object.fromEntries(Object.entries(n).filter(([, v]) => v !== '' && v !== null && v !== undefined).map(([k, v]) => [k, String(v)])) : null;
    if (out.nutrition && !Object.keys(out.nutrition).length) out.nutrition = null;
  }
  if (has('diets')) out.diets = toList(input.diets);
  if (has('status')) out.status = ['draft', 'published'].includes(input.status) ? input.status : 'draft';
  if (has('featured')) out.featured = input.featured === true || input.featured === 'on' || input.featured === 'true' || input.featured === 1 ? 1 : 0;
  if (has('tags')) out.tags = toList(input.tags).map((t) => t.toLowerCase()).slice(0, 30);
  if (has('products')) out.products = (Array.isArray(input.products) ? input.products : toList(input.products)).map(Number).filter(Boolean);
  if (has('code')) out.code = input.code;
  return out;
}

function pick(o, keys) {
  const r = {};
  for (const k of keys) if (o[k] !== undefined) r[k] = o[k];
  return r;
}

function toList(v) {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  return String(v || '').split(',').map((x) => x.trim()).filter(Boolean);
}

const COLUMNS = ['title', 'description', 'story', 'cover', 'images', 'video', 'ingredients', 'steps', 'tips', 'prep_minutes', 'cook_minutes', 'rest_minutes', 'servings', 'servings_unit', 'difficulty', 'cuisine', 'category_id', 'nutrition', 'diets', 'source_url', 'source_name', 'status', 'featured'];
const JSON_COLS = new Set(['images', 'video', 'ingredients', 'steps', 'nutrition', 'diets']);

function toDbValue(k, v) {
  if (JSON_COLS.has(k)) return v === null || v === undefined ? (k === 'video' || k === 'nutrition' ? null : '[]') : JSON.stringify(v);
  return v;
}

function indexFts(d, id) {
  const r = d.prepare('SELECT * FROM recipes WHERE id = ?').get(id);
  d.prepare('DELETE FROM recipes_fts WHERE rowid = ?').run(id);
  if (!r) return;
  const tags = d.prepare('SELECT tag FROM recipe_tags WHERE recipe_id = ?').all(id).map((t) => t.tag).join(' ');
  const cat = r.category_id ? (d.prepare('SELECT name FROM categories WHERE id = ?').get(r.category_id) || {}).name || '' : '';
  d.prepare('INSERT INTO recipes_fts (rowid, code, title, description, ingredients, steps, tags) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    id,
    r.code,
    r.title,
    `${r.description || ''} ${r.cuisine || ''} ${cat}`,
    u.safeJson(r.ingredients, []).map((i) => i.name).join(' · '),
    u.safeJson(r.steps, []).map((s) => s.text).join(' '),
    `${tags} ${u.safeJson(r.diets, []).join(' ')}`,
  );
}

function setRelations(d, id, data) {
  if (data.tags) {
    d.prepare('DELETE FROM recipe_tags WHERE recipe_id = ?').run(id);
    const ins = d.prepare('INSERT OR IGNORE INTO recipe_tags (recipe_id, tag) VALUES (?, ?)');
    for (const t of data.tags) ins.run(id, t);
  }
  if (data.products) {
    d.prepare('DELETE FROM recipe_products WHERE recipe_id = ?').run(id);
    const ins = d.prepare('INSERT OR IGNORE INTO recipe_products (recipe_id, product_id, position) SELECT ?, id, ? FROM products WHERE id = ?');
    data.products.forEach((pid, i) => ins.run(id, i, pid));
  }
}

function create(input, authorId) {
  const data = normalizeInput(input);
  if (!data.title) throw Object.assign(new Error('Título é obrigatório'), { status: 400 });
  return db.tx((d) => {
    const code = uniqueCode(d, data.code);
    const slug = uniqueSlug(d, data.title);
    const cols = COLUMNS.filter((c) => data[c] !== undefined);
    const info = d.prepare(`INSERT INTO recipes (code, slug, author_id, ${cols.join(', ')}, published_at) VALUES (?, ?, ?, ${cols.map(() => '?').join(', ')}, ?)`).run(
      code, slug, authorId ?? null, ...cols.map((c) => toDbValue(c, data[c])), data.status === 'published' ? new Date().toISOString() : null,
    );
    const id = Number(info.lastInsertRowid);
    setRelations(d, id, data);
    indexFts(d, id);
    return getById(id);
  });
}

function update(id, input) {
  const data = normalizeInput(input);
  return db.tx((d) => {
    const current = d.prepare('SELECT * FROM recipes WHERE id = ?').get(id);
    if (!current) throw Object.assign(new Error('Receita não encontrada'), { status: 404 });
    const sets = [];
    const vals = [];
    for (const c of COLUMNS) {
      if (data[c] === undefined) continue;
      sets.push(`${c} = ?`);
      vals.push(toDbValue(c, data[c]));
    }
    if (data.code !== undefined && u.normalizeCode(data.code) !== current.code) {
      sets.push('code = ?');
      vals.push(uniqueCode(d, data.code || null, id));
    }
    if (data.title && data.title !== current.title && input.keepSlug !== true) {
      sets.push('slug = ?');
      vals.push(uniqueSlug(d, data.title, id));
    }
    if (data.status === 'published' && !current.published_at) {
      sets.push('published_at = ?');
      vals.push(new Date().toISOString());
    }
    sets.push("updated_at = datetime('now')");
    d.prepare(`UPDATE recipes SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
    setRelations(d, id, data);
    indexFts(d, id);
    return getById(id);
  });
}

function remove(id) {
  return db.tx((d) => {
    d.prepare('DELETE FROM recipes_fts WHERE rowid = ?').run(id);
    return d.prepare('DELETE FROM recipes WHERE id = ?').run(id).changes > 0;
  });
}

function getById(id) {
  return hydrate(db.get().prepare('SELECT * FROM recipes WHERE id = ?').get(id));
}
function getBySlug(slug) {
  return hydrate(db.get().prepare('SELECT * FROM recipes WHERE slug = ?').get(slug));
}
function getByCode(code) {
  const c = u.normalizeCode(code);
  return c ? hydrate(db.get().prepare('SELECT * FROM recipes WHERE code = ?').get(c)) : null;
}
/** Aceita id numérico, código ou slug. */
function find(ref) {
  const s = String(ref);
  return (/^\d+$/.test(s) && getById(Number(s))) || getByCode(s) || getBySlug(s);
}

function ftsQuery(q) {
  const words = u.stripAccents(q).toLowerCase().match(/[a-z0-9]+/g) || [];
  return words.filter((w) => w.length > 1 || /\d/.test(w)).slice(0, 12).map((w) => `"${w}"*`).join(' ');
}

/**
 * Busca de receitas.
 * opts: { q, code, category, tag, diet, maxTime, difficulty, ingredients[], status, sort, page, perPage, featured }
 * Se `q` parecer um código (ex.: "#K7M2QX"), a correspondência exata vem primeiro em `exactCode`.
 */
function search(opts = {}) {
  const d = db.get();
  const where = [];
  const params = [];
  let join = '';
  let rankExpr = null;
  const perPage = clampInt(opts.perPage, 1, 100, 12);
  const page = clampInt(opts.page, 1, 100000, 1);

  if (opts.status !== 'any') {
    where.push('r.status = ?');
    params.push(opts.status || 'published');
  }

  let exactCode = null;
  const q = String(opts.q || '').trim();
  const codeCandidate = opts.code || (/^#?[A-Za-z0-9-]{3,16}$/.test(q) ? q : null);
  if (codeCandidate) {
    const r = d.prepare(`SELECT id FROM recipes r WHERE r.code = ?${opts.status !== 'any' ? ' AND r.status = ?' : ''}`).get(...[u.normalizeCode(codeCandidate)].concat(opts.status !== 'any' ? [opts.status || 'published'] : []));
    if (r) exactCode = getById(r.id);
    if (opts.code) {
      return { items: exactCode ? [exactCode] : [], total: exactCode ? 1 : 0, page: 1, perPage, pages: 1, exactCode };
    }
  }

  if (q) {
    const fq = ftsQuery(q);
    if (fq) {
      join += ' JOIN recipes_fts ON recipes_fts.rowid = r.id';
      where.push('recipes_fts MATCH ?');
      params.push(fq);
      rankExpr = 'bm25(recipes_fts, 10.0, 8.0, 3.0, 4.0, 1.0, 5.0)';
    }
  }
  if (opts.category) {
    where.push('r.category_id IN (SELECT id FROM categories WHERE slug = ? OR id = ?)');
    params.push(String(opts.category), Number(opts.category) || -1);
  }
  if (opts.tag) {
    where.push('r.id IN (SELECT recipe_id FROM recipe_tags WHERE tag = ?)');
    params.push(String(opts.tag).toLowerCase());
  }
  if (opts.diet) {
    where.push('EXISTS (SELECT 1 FROM json_each(r.diets) WHERE lower(value) = lower(?))');
    params.push(String(opts.diet));
  }
  if (opts.maxTime) {
    where.push('(r.prep_minutes + r.cook_minutes + r.rest_minutes) <= ?');
    params.push(Number(opts.maxTime));
  }
  if (opts.difficulty) {
    where.push('r.difficulty = ?');
    params.push(Number(opts.difficulty));
  }
  if (opts.featured) where.push('r.featured = 1');
  const ingredients = (Array.isArray(opts.ingredients) ? opts.ingredients : toList(opts.ingredients)).slice(0, 10);
  for (const ing of ingredients) {
    // "O que tem na geladeira?": cada ingrediente precisa aparecer na lista da receita
    where.push('r.id IN (SELECT rowid FROM recipes_fts WHERE recipes_fts MATCH ?)');
    params.push(`ingredients : ${ftsQuery(ing) || '""'}`);
  }

  const order = {
    recent: 'COALESCE(r.published_at, r.created_at) DESC',
    popular: 'r.views DESC',
    quick: '(r.prep_minutes + r.cook_minutes + r.rest_minutes) ASC',
    rating: "(SELECT AVG(rating) FROM comments c WHERE c.recipe_id = r.id AND c.status='approved') DESC NULLS LAST",
    title: 'r.title COLLATE NOCASE ASC',
    updated: 'r.updated_at DESC',
  }[opts.sort] || (rankExpr ? `${rankExpr} ASC` : 'COALESCE(r.published_at, r.created_at) DESC');

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  let total;
  let rows;
  try {
    total = d.prepare(`SELECT COUNT(*) AS n FROM recipes r ${join} ${whereSql}`).get(...params).n;
    rows = d.prepare(`SELECT r.id FROM recipes r ${join} ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params, perPage, (page - 1) * perPage);
  } catch (e) {
    if (!/fts5|MATCH/i.test(e.message)) throw e;
    total = 0;
    rows = [];
  }
  let items = rows.map((r) => getById(r.id));
  if (exactCode && page === 1) {
    items = [exactCode, ...items.filter((i) => i.id !== exactCode.id)];
    if (!rows.some((r) => r.id === exactCode.id)) total += 1;
  }
  return { items, total, page, perPage, pages: Math.max(1, Math.ceil(total / perPage)), exactCode };
}

/** Sugestões rápidas para o autocomplete. */
function suggest(q, limit = 8) {
  const d = db.get();
  const out = [];
  const code = u.normalizeCode(q);
  if (code.length >= 3) {
    for (const r of d.prepare("SELECT id, code, slug, title, cover FROM recipes WHERE status='published' AND code LIKE ? LIMIT 3").all(`${code}%`)) out.push({ ...r, matchedCode: true });
  }
  const fq = ftsQuery(q);
  if (fq) {
    try {
      for (const r of d.prepare(`SELECT r.id, r.code, r.slug, r.title, r.cover FROM recipes r JOIN recipes_fts ON recipes_fts.rowid = r.id WHERE recipes_fts MATCH ? AND r.status='published' ORDER BY bm25(recipes_fts, 10.0, 8.0, 3.0, 4.0, 1.0, 5.0) LIMIT ?`).all(fq, limit)) {
        if (!out.some((o) => o.id === r.id)) out.push(r);
      }
    } catch { /* consulta inválida */ }
  }
  return out.slice(0, limit);
}

function related(recipe, limit = 4) {
  const d = db.get();
  const ids = d.prepare(`
    SELECT r.id, (CASE WHEN r.category_id = ? THEN 3 ELSE 0 END) + (SELECT COUNT(*) FROM recipe_tags t WHERE t.recipe_id = r.id AND t.tag IN (SELECT tag FROM recipe_tags WHERE recipe_id = ?)) AS score
    FROM recipes r WHERE r.status = 'published' AND r.id != ? ORDER BY score DESC, r.views DESC LIMIT ?`).all(recipe.category_id ?? -1, recipe.id, recipe.id, limit);
  return ids.map((r) => getById(r.id));
}

function products(recipeId) {
  return db.get().prepare('SELECT p.* FROM recipe_products rp JOIN products p ON p.id = rp.product_id WHERE rp.recipe_id = ? AND p.active = 1 ORDER BY rp.position').all(recipeId);
}

function adjacent(recipe) {
  const d = db.get();
  const at = recipe.published_at || recipe.created_at;
  return {
    prev: d.prepare("SELECT slug, title FROM recipes WHERE status='published' AND COALESCE(published_at, created_at) < ? ORDER BY COALESCE(published_at, created_at) DESC LIMIT 1").get(at) || null,
    next: d.prepare("SELECT slug, title FROM recipes WHERE status='published' AND COALESCE(published_at, created_at) > ? ORDER BY COALESCE(published_at, created_at) ASC LIMIT 1").get(at) || null,
  };
}

function incrementViews(id) {
  db.get().prepare('UPDATE recipes SET views = views + 1 WHERE id = ?').run(id);
}
function incrementCooked(id) {
  db.get().prepare('UPDATE recipes SET cooked = cooked + 1 WHERE id = ?').run(id);
}

function allTags(limit = 50) {
  return db.get().prepare("SELECT t.tag, COUNT(*) AS n FROM recipe_tags t JOIN recipes r ON r.id = t.recipe_id AND r.status='published' GROUP BY t.tag ORDER BY n DESC, t.tag LIMIT ?").all(limit);
}

function categories() {
  return db.get().prepare("SELECT c.*, (SELECT COUNT(*) FROM recipes r WHERE r.category_id = c.id AND r.status='published') AS count FROM categories c ORDER BY c.position, c.name").all();
}

/** Formato público/API (sem campos internos). */
function toPublic(r, baseUrl = '') {
  if (!r) return null;
  return {
    id: r.id,
    code: r.code,
    slug: r.slug,
    url: `${baseUrl}/receita/${r.slug}`,
    title: r.title,
    description: r.description,
    story: r.story,
    cover: r.cover,
    images: r.images,
    video: r.video,
    ingredients: r.ingredients,
    steps: r.steps,
    tips: r.tips,
    prep_minutes: r.prep_minutes,
    cook_minutes: r.cook_minutes,
    rest_minutes: r.rest_minutes,
    total_minutes: r.total_minutes,
    servings: r.servings,
    servings_unit: r.servings_unit,
    difficulty: r.difficulty,
    cuisine: r.cuisine,
    category: r.category ? { id: r.category.id, name: r.category.name, slug: r.category.slug } : null,
    tags: r.tags,
    diets: r.diets,
    nutrition: r.nutrition,
    rating: r.rating,
    source_url: r.source_url,
    source_name: r.source_name,
    status: r.status,
    featured: r.featured,
    views: r.views,
    cooked: r.cooked,
    created_at: r.created_at,
    updated_at: r.updated_at,
    published_at: r.published_at,
  };
}

module.exports = {
  create, update, remove, getById, getBySlug, getByCode, find, search, suggest, related, products, adjacent,
  incrementViews, incrementCooked, allTags, categories, toPublic, normalizeInput, reindexAll: () => {
    const d = db.get();
    for (const r of d.prepare('SELECT id FROM recipes').all()) indexFts(d, r.id);
  },
};
