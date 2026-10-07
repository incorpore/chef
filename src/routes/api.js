'use strict';
const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const multer = require('multer');
const db = require('../db');
const auth = require('../auth');
const recipes = require('../recipes');
const settings = require('../settings');
const importer = require('../importer');
const u = require('../util');
const config = require('../config');
const sec = require('../security');
const { AD_SLOTS } = require('../monetization');
const openapi = require('../openapi');
const pageCache = require('../cache');

const router = express.Router();
const { rateLimit } = sec;

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const baseUrl = (req) => config.baseUrl || `${req.protocol}://${req.get('host')}`;
const isAdmin = (req) => auth.isAdmin(req.user);
const forbid = (res, msg = 'Sem permissão para esta ação') => res.status(403).json({ error: msg });
const notFound = (res, msg = 'Não encontrado') => res.status(404).json({ error: msg });
const idParam = (v) => (/^\d{1,15}$/.test(String(v)) ? Number(v) : null);

// CORS: leitura pública para qualquer origem; escrita entre origens só com chave (Bearer), nunca com cookie.
router.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Max-Age', '600');
  // Leitura pública anônima pode ficar em cache por 1 min (CDN/offline); o resto nunca é guardado
  res.setHeader('Cache-Control', req.method === 'GET' && !req.user && !req.headers.authorization && /^\/(recipes|search\/suggest|categories|tags|openapi\.json)(\/|$)/.test(req.path) ? 'public, max-age=60' : 'no-store');
  res.setHeader('Vary', 'Authorization, Cookie');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
router.use(auth.sameOrigin);

// Limites globais por IP (leitura e escrita)
router.use((req, res, next) => (['GET', 'HEAD'].includes(req.method) ? rateLimit('api-read', 600, 60e3) : rateLimit('api-write', 120, 60e3))(req, res, next));

// Qualquer escrita invalida o cache de páginas
router.use((req, res, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) res.on('finish', () => { if (res.statusCode < 400) pageCache.bump(); });
  next();
});

// Corpo JSON precisa ser objeto ou lista
router.use((req, res, next) => {
  if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.is('application/json') && (req.body === null || typeof req.body !== 'object')) return res.status(400).json({ error: 'JSON inválido' });
  next();
});

// ---------------- Documentação ----------------
router.get('/', (req, res) => res.json({ name: 'Chef API', version: 1, docs: `${baseUrl(req)}/api/docs`, openapi: `${baseUrl(req)}/api/v1/openapi.json` }));
router.get('/openapi.json', (req, res) => res.json(openapi(baseUrl(req))));

// ---------------- Autenticação ----------------
router.post('/auth/setup', rateLimit('setup', 10, 15 * 60e3), (req, res) => {
  if (auth.userCount() > 0) return res.status(409).json({ error: 'O sistema já foi configurado' });
  const token = auth.setupToken();
  if (token && !auth.safeEqual(String(req.body?.setupToken || ''), token)) return res.status(403).json({ error: 'Token de instalação inválido (veja o log do servidor ou a variável SETUP_TOKEN)' });
  const id = auth.createUser({ ...req.body, role: 'admin' });
  if (req.body.siteName) settings.update({ siteName: sec.cleanText(req.body.siteName, 60), authorName: sec.cleanText(req.body.name || '', 80) });
  const user = db.get().prepare('SELECT * FROM users WHERE id = ?').get(id);
  req.user = user;
  auth.audit(req, 'setup', user.email);
  auth.setSessionCookie(res, user);
  res.status(201).json({ user: auth.publicUser(user) });
});

router.post('/auth/login', rateLimit('login', 10, 15 * 60e3), (req, res) => {
  const email = sec.cleanText(req.body?.email, 254).trim().toLowerCase();
  const password = String(req.body?.password ?? '').slice(0, 200);
  if (sec.loginLocked(email)) {
    auth.audit(req, 'login.locked', email);
    return res.status(429).json({ error: 'Muitas tentativas. Conta bloqueada por 15 minutos.' });
  }
  const user = auth.authenticate(email, password);
  if (!user) {
    sec.loginFailed(email);
    auth.audit(req, 'login.fail', email);
    return res.status(401).json({ error: 'E-mail ou senha incorretos' });
  }
  sec.loginSucceeded(email);
  req.user = user;
  auth.audit(req, 'login.ok');
  auth.setSessionCookie(res, user);
  res.json({ user: auth.publicUser(user) });
});

router.post('/auth/logout', (req, res) => {
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});

/** Encerra a sessão em todos os aparelhos (invalida todos os cookies emitidos). */
router.post('/auth/logout-all', auth.requireUser, (req, res) => {
  auth.bumpSessionVersion(req.user.id);
  auth.audit(req, 'logout.all');
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/auth/me', (req, res) => res.json({ user: auth.publicUser(req.user), needsSetup: auth.userCount() === 0, needsSetupToken: !!auth.setupToken() }));

router.put('/auth/me', auth.requireUser, (req, res) => {
  const { name, bio, avatar, password, currentPassword } = req.body || {};
  const d = db.get();
  if (avatar && !u.isSafeUrl(avatar)) return res.status(400).json({ error: 'URL da foto inválida' });
  if (password) {
    if (req.viaApiKey) return forbid(res, 'Troque a senha pelo painel');
    if (!auth.verifyPassword(currentPassword, req.user.password_hash)) return res.status(400).json({ error: 'Senha atual incorreta' });
    const err = auth.validatePassword(password);
    if (err) return res.status(400).json({ error: err });
    d.prepare('UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ?').run(auth.hashPassword(password), req.user.id);
    auth.audit(req, 'password.change');
  }
  d.prepare('UPDATE users SET name = COALESCE(?, name), bio = COALESCE(?, bio), avatar = COALESCE(?, avatar) WHERE id = ?')
    .run(name ? sec.cleanText(name, 80) : null, bio !== undefined ? sec.cleanText(bio, 2000) : null, avatar !== undefined ? String(avatar) : null, req.user.id);
  const user = d.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (password) auth.setSessionCookie(res, user); // mantém este aparelho logado, derruba os outros
  res.json({ user: auth.publicUser(user) });
});

// ---------------- Usuários (admin) ----------------
router.get('/users', auth.requireAdmin, (req, res) => res.json({ items: db.get().prepare('SELECT * FROM users ORDER BY id').all().map(auth.publicUser) }));
router.post('/users', auth.requireAdmin, (req, res) => {
  const id = auth.createUser({ ...req.body, role: req.body.role === 'admin' ? 'admin' : 'author' });
  auth.audit(req, 'user.create', `${id}`);
  res.status(201).json({ user: auth.publicUser(db.get().prepare('SELECT * FROM users WHERE id = ?').get(id)) });
});
router.delete('/users/:id', auth.requireAdmin, (req, res) => {
  const id = idParam(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'Você não pode remover a si mesmo' });
  const target = db.get().prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!target) return notFound(res, 'Usuário não encontrado');
  db.get().prepare('DELETE FROM users WHERE id = ?').run(id);
  auth.audit(req, 'user.delete', target.email);
  res.json({ ok: true });
});

// ---------------- Chaves de API ----------------
router.get('/keys', auth.requireUser, (req, res) => {
  res.json({ items: db.get().prepare('SELECT id, name, prefix, last_used_at, created_at FROM api_keys WHERE user_id = ? ORDER BY id DESC').all(req.user.id) });
});
router.post('/keys', auth.requireUser, rateLimit('keys', 20, 60 * 60e3), (req, res) => {
  if (req.viaApiKey) return forbid(res, 'Crie chaves pelo painel');
  const n = db.get().prepare('SELECT COUNT(*) AS n FROM api_keys WHERE user_id = ?').get(req.user.id).n;
  if (n >= 20) return res.status(400).json({ error: 'Limite de 20 chaves por usuário' });
  const k = auth.createApiKey(req.user.id, sec.cleanText(req.body?.name, 60));
  auth.audit(req, 'key.create', k.prefix);
  res.status(201).json(k);
});
router.delete('/keys/:id', auth.requireUser, (req, res) => {
  // Filtra pelo dono: o ID vindo da tela nunca é suficiente
  const r = db.get().prepare('DELETE FROM api_keys WHERE id = ? AND user_id = ?').run(idParam(req.params.id), req.user.id);
  if (!r.changes) return notFound(res, 'Chave não encontrada');
  auth.audit(req, 'key.delete', req.params.id);
  res.json({ ok: true });
});

// ---------------- Receitas ----------------
/** Visibilidade: visitante vê só publicadas; autor vê publicadas + as suas; admin vê tudo. */
function visibility(req) {
  if (!req.user) return { status: 'published' };
  if (isAdmin(req)) return { status: req.query.status && ['draft', 'published'].includes(req.query.status) ? req.query.status : 'any' };
  return { status: req.query.status && ['draft', 'published'].includes(req.query.status) ? req.query.status : 'any', ownerId: req.user.id };
}
function canView(req, r) {
  return !!r && (r.status === 'published' || auth.canEditRecipe(req.user, r));
}

router.get('/recipes', (req, res) => {
  const q = req.query;
  const str = (v, max = 200) => (v === undefined ? undefined : sec.cleanText(Array.isArray(v) ? v[0] : v, max));
  const result = recipes.search({
    q: str(q.q), code: str(q.code, 40), category: str(q.category, 80), tag: str(q.tag, 40), diet: str(q.diet, 40), maxTime: str(q.maxTime, 6), difficulty: str(q.difficulty, 1),
    ingredients: str(q.ingredients, 500), sort: str(q.sort, 10), page: str(q.page, 6), perPage: str(q.perPage || q.limit, 3), featured: q.featured === '1' || q.featured === 'true',
    authorId: q.mine === '1' && req.user ? req.user.id : undefined,
    ...visibility(req),
  });
  res.json({ ...result, items: result.items.map((r) => recipes.toPublic(r, baseUrl(req))), exactCode: result.exactCode ? recipes.toPublic(result.exactCode, baseUrl(req)) : null });
});

router.get('/search/suggest', (req, res) => res.json({ items: recipes.suggest(sec.cleanText(req.query.q, 100), 8) }));

router.get('/recipes/code/:code', (req, res) => {
  const r = recipes.getByCode(req.params.code);
  if (!canView(req, r)) return notFound(res, 'Nenhuma receita com este código');
  res.json(recipes.toPublic(r, baseUrl(req)));
});

router.get('/recipes/:ref', (req, res) => {
  const r = recipes.find(req.params.ref);
  if (!canView(req, r)) return notFound(res, 'Receita não encontrada');
  const out = recipes.toPublic(r, baseUrl(req));
  out.products = recipes.products(r.id).map((p) => ({ id: p.id, title: p.title, image: p.image, price: p.price, url: `${baseUrl(req)}/go/${p.id}` }));
  res.json(out);
});

/** Converte "category" (nome) em category_id. Só administradores criam categorias novas. */
function mapCategory(data, req) {
  if (data.category && !data.category_id) {
    const name = sec.cleanText(String(data.category), 60).trim();
    const d = db.get();
    let c = d.prepare('SELECT id FROM categories WHERE name = ? COLLATE NOCASE OR slug = ?').get(name, u.slugify(name));
    if (!c && name && isAdmin(req) && data.createCategory !== false) {
      d.prepare('INSERT OR IGNORE INTO categories (name, slug) VALUES (?, ?)').run(name, u.slugify(name));
      c = d.prepare('SELECT id FROM categories WHERE slug = ?').get(u.slugify(name));
    }
    if (c) data.category_id = c.id;
  }
  if (data.category_id && !db.get().prepare('SELECT 1 FROM categories WHERE id = ?').get(Number(data.category_id))) data.category_id = null;
  delete data.category;
  // Campos que o cliente não pode definir
  for (const k of ['author_id', 'views', 'cooked', 'created_at', 'updated_at', 'published_at', 'slug', 'id']) delete data[k];
  if (!isAdmin(req)) delete data.featured;
  return data;
}

router.post('/recipes', auth.requireUser, (req, res) => {
  const r = recipes.create(mapCategory({ ...req.body }, req), req.user.id);
  auth.audit(req, 'recipe.create', r.code);
  res.status(201).json(recipes.toPublic(r, baseUrl(req)));
});

const updateRecipe = (req, res) => {
  const current = recipes.find(req.params.ref);
  if (!current) return notFound(res, 'Receita não encontrada');
  if (!auth.canEditRecipe(req.user, current)) return canView(req, current) ? forbid(res, 'Você só pode editar as suas receitas') : notFound(res, 'Receita não encontrada');
  const r = recipes.update(current.id, mapCategory({ ...req.body }, req));
  res.json(recipes.toPublic(r, baseUrl(req)));
};
router.put('/recipes/:ref', auth.requireUser, updateRecipe);
router.patch('/recipes/:ref', auth.requireUser, updateRecipe);

router.delete('/recipes/:ref', auth.requireUser, (req, res) => {
  const r = recipes.find(req.params.ref);
  if (!r) return notFound(res, 'Receita não encontrada');
  if (!auth.canEditRecipe(req.user, r)) return canView(req, r) ? forbid(res, 'Você só pode excluir as suas receitas') : notFound(res, 'Receita não encontrada');
  recipes.remove(r.id);
  auth.audit(req, 'recipe.delete', r.code);
  res.json({ ok: true });
});

router.post('/recipes/:ref/duplicate', auth.requireUser, (req, res) => {
  const r = recipes.find(req.params.ref);
  if (!canView(req, r)) return notFound(res, 'Receita não encontrada');
  const { code, slug, id, ...pub } = recipes.toPublic(r);
  const copy = recipes.create({ ...pub, title: `${r.title} (cópia)`.slice(0, 200), status: 'draft', featured: false, category_id: r.category_id, products: recipes.products(r.id).map((p) => p.id) }, req.user.id);
  res.status(201).json(recipes.toPublic(copy, baseUrl(req)));
});

router.post('/recipes/:ref/cooked', rateLimit('cooked', 20, 60e3), (req, res) => {
  const r = recipes.find(req.params.ref);
  if (!r || r.status !== 'published') return notFound(res, 'Receita não encontrada');
  recipes.incrementCooked(r.id);
  res.json({ cooked: r.cooked + 1 });
});

// ---------------- Comentários e avaliações ----------------
router.get('/recipes/:ref/comments', (req, res) => {
  const r = recipes.find(req.params.ref);
  if (!r || r.status !== 'published') return notFound(res, 'Receita não encontrada');
  res.json({ items: db.get().prepare("SELECT id, name, body, rating, created_at FROM comments WHERE recipe_id = ? AND status = 'approved' ORDER BY id DESC LIMIT 200").all(r.id) });
});

router.post('/recipes/:ref/comments', rateLimit('comment', 5, 60e3), (req, res) => {
  const r = recipes.find(req.params.ref);
  if (!r || r.status !== 'published') return notFound(res, 'Receita não encontrada');
  const { name, body, rating, website } = req.body || {};
  if (website) return res.status(201).json({ ok: true, pending: true }); // honeypot anti-spam
  const n = sec.cleanText(name, 60).trim();
  const b = sec.cleanText(body, 3000).trim();
  const rt = rating ? Math.min(5, Math.max(1, Math.round(Number(rating)) || 1)) : null;
  if (!n || (!b && !rt)) return res.status(400).json({ error: 'Informe seu nome e um comentário ou nota' });
  if ((b.match(/https?:\/\//g) || []).length > 2) return res.status(400).json({ error: 'Comentários com muitos links não são permitidos' });
  const ipHash = crypto.createHash('sha256').update(`${req.ip}${config.secret}`).digest('hex').slice(0, 16);
  const today = db.get().prepare("SELECT COUNT(*) AS n FROM comments WHERE ip_hash = ? AND created_at > datetime('now', '-1 day')").get(ipHash).n;
  if (today >= 30) return res.status(429).json({ error: 'Limite diário de comentários atingido' });
  const status = auth.canEditRecipe(req.user, r) || !settings.all().commentsModeration ? 'approved' : 'pending';
  const info = db.get().prepare('INSERT INTO comments (recipe_id, name, body, rating, status, ip_hash) VALUES (?, ?, ?, ?, ?, ?)').run(r.id, n, b, rt, status, ipHash);
  res.status(201).json({ id: Number(info.lastInsertRowid), pending: status === 'pending' });
});

/** Admin modera todos; autor modera apenas os comentários das próprias receitas. */
function commentScope(req) {
  return isAdmin(req) ? { sql: '', params: [] } : { sql: ' AND r.author_id = ?', params: [req.user.id] };
}
router.get('/comments', auth.requireUser, (req, res) => {
  const status = ['pending', 'approved', 'spam', 'all'].includes(req.query.status) ? req.query.status : 'pending';
  const scope = commentScope(req);
  res.json({
    items: db.get().prepare(`SELECT c.id, c.recipe_id, c.name, c.body, c.rating, c.status, c.created_at, r.title AS recipe_title, r.slug AS recipe_slug FROM comments c JOIN recipes r ON r.id = c.recipe_id WHERE 1=1 ${status === 'all' ? '' : 'AND c.status = ?'}${scope.sql} ORDER BY c.id DESC LIMIT 200`)
      .all(...(status === 'all' ? [] : [status]), ...scope.params),
  });
});
function findComment(req) {
  const scope = commentScope(req);
  return db.get().prepare(`SELECT c.id FROM comments c JOIN recipes r ON r.id = c.recipe_id WHERE c.id = ?${scope.sql}`).get(idParam(req.params.id), ...scope.params);
}
router.patch('/comments/:id', auth.requireUser, (req, res) => {
  const c = findComment(req);
  if (!c) return notFound(res, 'Comentário não encontrado');
  const status = ['approved', 'pending', 'spam'].includes(req.body?.status) ? req.body.status : 'approved';
  db.get().prepare('UPDATE comments SET status = ? WHERE id = ?').run(status, c.id);
  res.json({ ok: true });
});
router.delete('/comments/:id', auth.requireUser, (req, res) => {
  const c = findComment(req);
  if (!c) return notFound(res, 'Comentário não encontrado');
  db.get().prepare('DELETE FROM comments WHERE id = ?').run(c.id);
  res.json({ ok: true });
});

// ---------------- Importação / Exportação ----------------
router.post('/import', auth.requireUser, rateLimit('import', 20, 60e3), wrap(async (req, res) => {
  const { url, save = false, status = 'draft', downloadImages = true } = req.body || {};
  if (!url || typeof url !== 'string' || url.length > 2000) return res.status(400).json({ error: 'Informe a URL' });
  const data = await importer.importFromUrl(url, { downloadImages: downloadImages !== false && downloadImages !== 'false', userId: req.user.id });
  if (!save) return res.json({ preview: data });
  const r = recipes.create(mapCategory({ ...data, status }, req), req.user.id);
  auth.audit(req, 'recipe.import', url);
  res.status(201).json(recipes.toPublic(r, baseUrl(req)));
}));

/** Importação em lote de JSON (formato desta API ou schema.org Recipe). */
router.post('/import/json', auth.requireUser, rateLimit('import-json', 5, 60e3), (req, res) => {
  const body = req.body;
  const list = Array.isArray(body) ? body : Array.isArray(body?.items) ? body.items : [body];
  if (list.length > 500) return res.status(413).json({ error: 'Máximo de 500 receitas por importação' });
  const created = [];
  const errors = [];
  list.forEach((item, i) => {
    try {
      if (!item || typeof item !== 'object') throw new Error('Item inválido');
      const data = /Recipe/.test(String(item['@type'])) ? importer.parseHtml(`<script type="application/ld+json">${JSON.stringify(item).replace(/</g, '\\u003c')}</script>`, 'https://localhost/') : item;
      const { url, rating, category, ...rest } = data;
      const payload = { ...rest, category: typeof category === 'object' && category ? category.name : category };
      if (rest.code && recipes.getByCode(rest.code)) delete payload.code;
      created.push(recipes.toPublic(recipes.create(mapCategory(payload, req), req.user.id), baseUrl(req)));
    } catch (e) {
      errors.push({ index: i, error: e.status && e.status < 500 ? e.message : 'Item inválido' });
    }
  });
  auth.audit(req, 'recipe.import-json', `${created.length}`);
  res.status(created.length ? 201 : 400).json({ created: created.length, items: created, errors });
});

router.get('/export', auth.requireUser, (req, res) => {
  const ids = recipes.allIds();
  const items = [];
  for (const id of ids) {
    const r = recipes.getById(id);
    if (!isAdmin(req) && r.author_id !== req.user.id) continue; // autor exporta só as suas
    items.push({ ...recipes.toPublic(r, baseUrl(req)), products: recipes.products(r.id).map((p) => p.id) });
  }
  auth.audit(req, 'export', `${items.length}`);
  res.setHeader('Content-Disposition', `attachment; filename="receitas-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json({
    exported_at: new Date().toISOString(),
    count: items.length,
    items,
    categories: recipes.categories(),
    products: isAdmin(req) ? db.get().prepare('SELECT * FROM products').all() : [],
  });
});

// ---------------- Upload de fotos e vídeos ----------------
const upload = multer({
  storage: multer.diskStorage({
    destination: config.uploadsDir,
    filename: (_req, _file, cb) => cb(null, `${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}.tmp`),
  }),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 20, fields: 10, fieldSize: 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /^(image\/(jpeg|png|webp|gif|avif)|video\/(mp4|webm|ogg|quicktime|x-m4v))$/.test(file.mimetype);
    cb(ok ? null : Object.assign(new Error('Formato não suportado (use JPG, PNG, WebP, GIF, AVIF, MP4, WebM ou MOV)'), { status: 415 }), ok);
  },
});

/** Confere o conteúdo real (assinatura do arquivo), renomeia com a extensão correta e registra o dono. */
function finalizeUpload(file, userId) {
  const tmp = path.join(config.uploadsDir, file.filename);
  const fd = fs.openSync(tmp, 'r');
  const head = Buffer.alloc(16);
  fs.readSync(fd, head, 0, 16, 0);
  fs.closeSync(fd);
  const mime = sec.sniffMime(head);
  if (!mime) {
    fs.rmSync(tmp, { force: true });
    return null;
  }
  const name = file.filename.replace(/\.tmp$/, sec.EXT_BY_MIME[mime]);
  fs.renameSync(tmp, path.join(config.uploadsDir, name));
  db.get().prepare('INSERT INTO uploads (filename, mime, size, original_name, user_id) VALUES (?, ?, ?, ?, ?)').run(name, mime, file.size, sec.cleanText(file.originalname, 200), userId);
  return { url: `/uploads/${name}`, type: mime.startsWith('video/') ? 'video' : 'image', size: file.size, name: sec.cleanText(file.originalname, 200) };
}

router.post('/uploads', auth.requireUser, rateLimit('upload', 60, 60e3), upload.array('files', 20), (req, res) => {
  const files = [];
  let rejected = 0;
  for (const f of req.files || []) {
    const out = finalizeUpload(f, req.user.id);
    if (out) files.push(out); else rejected++;
  }
  if (!files.length) return res.status(rejected ? 415 : 400).json({ error: rejected ? 'O conteúdo do arquivo não é uma imagem/vídeo válido' : 'Nenhum arquivo enviado (campo "files")' });
  res.status(201).json({ files, rejected });
});

router.post('/uploads/from-url', auth.requireUser, rateLimit('upload', 60, 60e3), wrap(async (req, res) => {
  const url = await importer.downloadImage(String(req.body?.url || '').slice(0, 2000), req.user.id);
  if (!url || !url.startsWith('/uploads/')) return res.status(422).json({ error: 'Não foi possível baixar a imagem' });
  res.status(201).json({ url });
}));

router.get('/uploads', auth.requireUser, (req, res) => {
  const rows = isAdmin(req)
    ? db.get().prepare('SELECT * FROM uploads ORDER BY id DESC LIMIT 300').all()
    : db.get().prepare('SELECT * FROM uploads WHERE user_id = ? ORDER BY id DESC LIMIT 300').all(req.user.id);
  res.json({ items: rows.map((r) => ({ id: r.id, url: `/uploads/${r.filename}`, size: r.size, type: r.mime.startsWith('video/') ? 'video' : 'image', created_at: r.created_at })) });
});

router.delete('/uploads/:id', auth.requireUser, (req, res) => {
  const row = db.get().prepare('SELECT * FROM uploads WHERE id = ?').get(idParam(req.params.id));
  if (!row || (!isAdmin(req) && row.user_id !== req.user.id)) return notFound(res, 'Arquivo não encontrado');
  fs.rmSync(path.join(config.uploadsDir, path.basename(row.filename)), { force: true });
  db.get().prepare('DELETE FROM uploads WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

// ---------------- Categorias e tags ----------------
router.get('/categories', (req, res) => res.json({ items: recipes.categories() }));
function categoryPayload(b) {
  const name = sec.cleanText(b.name, 60).trim();
  if (!name) throw Object.assign(new Error('Nome é obrigatório'), { status: 400 });
  return [name, u.slugify(b.slug || name), sec.cleanText(b.icon || '', 8), sec.cleanText(b.description || '', 500), Math.max(-1000, Math.min(1000, Number(b.position) || 0))];
}
router.post('/categories', auth.requireAdmin, (req, res) => {
  const info = db.get().prepare('INSERT INTO categories (name, slug, icon, description, position) VALUES (?, ?, ?, ?, ?)').run(...categoryPayload(req.body || {}));
  res.status(201).json(db.get().prepare('SELECT * FROM categories WHERE id = ?').get(info.lastInsertRowid));
});
router.put('/categories/:id', auth.requireAdmin, (req, res) => {
  const c = db.get().prepare('SELECT * FROM categories WHERE id = ?').get(idParam(req.params.id));
  if (!c) return notFound(res, 'Categoria não encontrada');
  db.get().prepare('UPDATE categories SET name = ?, slug = ?, icon = ?, description = ?, position = ? WHERE id = ?').run(...categoryPayload({ ...c, ...req.body }), c.id);
  recipes.reindexAll();
  res.json(db.get().prepare('SELECT * FROM categories WHERE id = ?').get(c.id));
});
router.delete('/categories/:id', auth.requireAdmin, (req, res) => {
  db.get().prepare('DELETE FROM categories WHERE id = ?').run(idParam(req.params.id));
  res.json({ ok: true });
});
router.get('/tags', (req, res) => res.json({ items: recipes.allTags(200) }));

// ---------------- Produtos de afiliado (Amazon) ----------------
// Autores podem listar (para vincular às receitas); só o admin cadastra/edita
router.get('/products', auth.requireUser, (req, res) => res.json({ items: db.get().prepare('SELECT * FROM products ORDER BY id DESC').all() }));
function productPayload(b, current = {}) {
  const p = { ...current, ...b };
  const asin = String(p.asin || u.extractAsin(p.url) || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
  const title = sec.cleanText(p.title, 200).trim();
  if (!title) throw Object.assign(new Error('Título do produto é obrigatório'), { status: 400 });
  if (!asin && !p.url) throw Object.assign(new Error('Informe o ASIN ou o link do produto'), { status: 400 });
  if (p.url && (!/^https:\/\/[^\s]+$/i.test(p.url) || String(p.url).length > 2000)) throw Object.assign(new Error('Link inválido (use https://)'), { status: 400 });
  if (p.image && !/^(https:\/\/|\/uploads\/)[^\s"'<>]+$/i.test(p.image)) throw Object.assign(new Error('URL da imagem inválida'), { status: 400 });
  return [title, asin, String(p.url || ''), String(p.image || ''), sec.cleanText(p.price || '', 40), sec.cleanText(p.description || '', 300), sec.cleanText(p.badge || '', 30), sec.cleanText(p.keywords || '', 300), p.active === false || p.active === 0 || p.active === '0' ? 0 : 1];
}
router.post('/products', auth.requireAdmin, (req, res) => {
  const info = db.get().prepare('INSERT INTO products (title, asin, url, image, price, description, badge, keywords, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(...productPayload(req.body || {}));
  res.status(201).json(db.get().prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid));
});
router.put('/products/:id', auth.requireAdmin, (req, res) => {
  const p = db.get().prepare('SELECT * FROM products WHERE id = ?').get(idParam(req.params.id));
  if (!p) return notFound(res, 'Produto não encontrado');
  db.get().prepare('UPDATE products SET title = ?, asin = ?, url = ?, image = ?, price = ?, description = ?, badge = ?, keywords = ?, active = ? WHERE id = ?').run(...productPayload(req.body || {}, p), p.id);
  res.json(db.get().prepare('SELECT * FROM products WHERE id = ?').get(p.id));
});
router.delete('/products/:id', auth.requireAdmin, (req, res) => {
  db.get().prepare('DELETE FROM products WHERE id = ?').run(idParam(req.params.id));
  res.json({ ok: true });
});

// ---------------- Anúncios (HTML confiável: somente administradores) ----------------
router.get('/ads', auth.requireAdmin, (req, res) => res.json({ slots: AD_SLOTS, items: db.get().prepare('SELECT * FROM ads ORDER BY slot, id').all() }));
function adPayload(b, cur = {}) {
  const a = { ...cur, ...b };
  if (!a.name || !Object.hasOwn(AD_SLOTS, a.slot)) throw Object.assign(new Error('Nome e posição válidos são obrigatórios'), { status: 400 });
  if (String(a.html || '').length > 20000) throw Object.assign(new Error('Código do anúncio grande demais'), { status: 400 });
  return [sec.cleanText(a.name, 80), a.slot, String(a.html || ''), ['all', 'mobile', 'desktop'].includes(a.device) ? a.device : 'all', a.active === false || a.active === 0 || a.active === '0' ? 0 : 1, Math.min(100, Math.max(1, Number(a.weight) || 1))];
}
router.post('/ads', auth.requireAdmin, (req, res) => {
  const info = db.get().prepare('INSERT INTO ads (name, slot, html, device, active, weight) VALUES (?, ?, ?, ?, ?, ?)').run(...adPayload(req.body || {}));
  auth.audit(req, 'ad.create', `${info.lastInsertRowid}`);
  res.status(201).json(db.get().prepare('SELECT * FROM ads WHERE id = ?').get(info.lastInsertRowid));
});
router.put('/ads/:id', auth.requireAdmin, (req, res) => {
  const a = db.get().prepare('SELECT * FROM ads WHERE id = ?').get(idParam(req.params.id));
  if (!a) return notFound(res, 'Anúncio não encontrado');
  db.get().prepare('UPDATE ads SET name = ?, slot = ?, html = ?, device = ?, active = ?, weight = ? WHERE id = ?').run(...adPayload(req.body || {}, a), a.id);
  auth.audit(req, 'ad.update', `${a.id}`);
  res.json(db.get().prepare('SELECT * FROM ads WHERE id = ?').get(a.id));
});
router.delete('/ads/:id', auth.requireAdmin, (req, res) => {
  db.get().prepare('DELETE FROM ads WHERE id = ?').run(idParam(req.params.id));
  res.json({ ok: true });
});

// ---------------- Configurações ----------------
router.get('/settings', auth.requireAdmin, (req, res) => res.json(settings.all()));
router.put('/settings', auth.requireAdmin, (req, res) => {
  const s = settings.update(req.body || {});
  auth.audit(req, 'settings.update', Object.keys(req.body || {}).join(',').slice(0, 300));
  res.json(s);
});

// ---------------- Newsletter ----------------
router.post('/subscribe', rateLimit('subscribe', 5, 60e3), (req, res) => {
  const email = sec.cleanText(req.body?.email, 254).trim().toLowerCase();
  if (!auth.EMAIL_RE.test(email)) return res.status(400).json({ error: 'E-mail inválido' });
  db.get().prepare('INSERT OR IGNORE INTO subscribers (email) VALUES (?)').run(email);
  res.status(201).json({ ok: true }); // mesma resposta se já existir (não revela quem está inscrito)
});
router.get('/subscribers', auth.requireAdmin, (req, res) => {
  const items = db.get().prepare('SELECT email, created_at FROM subscribers ORDER BY id DESC').all();
  if (req.query.format === 'csv') {
    res.type('text/csv').setHeader('Content-Disposition', 'attachment; filename="inscritos.csv"');
    return res.send(['email,created_at', ...items.map((i) => `${sec.csvCell(i.email)},${sec.csvCell(i.created_at)}`)].join('\n'));
  }
  res.json({ items });
});

// ---------------- Auditoria e estatísticas ----------------
router.get('/audit', auth.requireAdmin, (req, res) => {
  res.json({ items: db.get().prepare('SELECT a.*, u.email FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 300').all() });
});

router.get('/stats', auth.requireUser, (req, res) => {
  const d = db.get();
  const own = !isAdmin(req);
  const w = own ? ' WHERE author_id = ?' : '';
  const a = own ? [req.user.id] : [];
  const one = (sql, ...p) => Object.values(d.prepare(sql).get(...p))[0];
  res.json({
    recipes: one(`SELECT COUNT(*) FROM recipes${w}`, ...a),
    published: one(`SELECT COUNT(*) FROM recipes${w ? `${w} AND` : ' WHERE'} status='published'`, ...a),
    drafts: one(`SELECT COUNT(*) FROM recipes${w ? `${w} AND` : ' WHERE'} status='draft'`, ...a),
    views: one(`SELECT COALESCE(SUM(views),0) FROM recipes${w}`, ...a),
    cooked: one(`SELECT COALESCE(SUM(cooked),0) FROM recipes${w}`, ...a),
    pendingComments: one(`SELECT COUNT(*) FROM comments c JOIN recipes r ON r.id = c.recipe_id WHERE c.status='pending'${own ? ' AND r.author_id = ?' : ''}`, ...a),
    subscribers: own ? null : one('SELECT COUNT(*) FROM subscribers'),
    productClicks: own ? null : one('SELECT COALESCE(SUM(clicks),0) FROM products'),
    adImpressions: own ? null : one('SELECT COALESCE(SUM(impressions),0) FROM ads'),
    top: d.prepare(`SELECT id, code, slug, title, views, cooked FROM recipes${w} ORDER BY views DESC LIMIT 5`).all(...a),
    topProducts: own ? [] : d.prepare('SELECT id, title, clicks FROM products ORDER BY clicks DESC LIMIT 5').all(),
  });
});

router.use((req, res) => notFound(res, 'Rota não encontrada'));

// Erros: mensagem amigável para o cliente, detalhes técnicos só no log do servidor
// eslint-disable-next-line no-unused-vars
router.use((err, req, res, _next) => {
  let status = err.status || err.statusCode || 500;
  let message = err.message;
  if (err.code === 'LIMIT_FILE_SIZE') { status = 413; message = `Arquivo maior que ${config.maxUploadMb} MB`; }
  else if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') { status = 400; message = 'Arquivos demais ou campo inválido (use "files")'; }
  else if (err.type === 'entity.parse.failed') { status = 400; message = 'JSON inválido'; }
  else if (err.type === 'entity.too.large') { status = 413; message = 'Requisição grande demais'; }
  else if (/UNIQUE constraint/.test(err.message || '')) { status = 409; message = 'Já existe um registro com esses dados'; }
  else if (/SQLITE|constraint/i.test(err.message || '')) { status = 400; message = 'Dados inválidos'; }
  if (status >= 500) {
    console.error(`[api] ${req.method} ${req.originalUrl}`, err);
    message = 'Erro interno';
  }
  res.status(status).json({ error: message });
});

module.exports = router;
