'use strict';
const express = require('express');
const auth = require('../auth');
const db = require('../db');
const recipes = require('../recipes');
const v = require('../views/admin');
const mail = require('../mail');
const notify = require('../notify');

const router = express.Router();

/** Só aceita redirecionar para caminhos internos (evita open redirect: //site-malicioso.com). */
function safeNext(n) {
  const s = String(n || '/admin');
  return /^\/(?![\/\\])[^\s]*$/.test(s) ? s : '/admin';
}

router.get('/setup', (req, res) => {
  if (auth.userCount() > 0) return res.redirect('/admin/login');
  res.send(v.authPage({ mode: 'setup', needsToken: !!auth.setupToken(), prefillToken: String(req.query.token || '').slice(0, 64) }));
});

router.get('/login', (req, res) => {
  if (auth.userCount() === 0) return res.redirect('/admin/setup');
  const next = safeNext(req.query.next);
  if (req.user) return res.redirect(next);
  res.send(v.authPage({ mode: 'login', next }));
});

// Recuperação de senha e convite: páginas públicas (o link do e-mail é a prova de identidade)
router.get('/esqueci', (req, res) => res.send(v.forgotPage({ mailReady: mail.isConfigured() && !!mail.siteUrl() })));
router.get('/redefinir', (req, res) => {
  const token = String(req.query.t || '').slice(0, 100);
  const row = notify.findResetToken(token);
  res.set('Referrer-Policy', 'no-referrer'); // o token não vaza para outros sites
  res.status(row ? 200 : 400).send(v.resetPage({ token, valid: !!row, invite: row?.purpose === 'invite' || req.query.convite === '1', email: row?.email }));
});

router.use((req, res, next) => {
  if (auth.userCount() === 0) return res.redirect('/admin/setup');
  next();
});
router.use(auth.requireUser);

const products = () => db.get().prepare('SELECT * FROM products ORDER BY title').all();

router.get('/', (req, res) => res.send(v.dashboard({ user: req.user })));
router.get('/perfil', (req, res) => {
  const d = db.get();
  const st = d.prepare("SELECT SUM(status = 'published') AS published, SUM(status <> 'published') AS drafts, COALESCE(SUM(views), 0) AS views FROM recipes WHERE author_id = ?").get(req.user.id);
  const activity = d.prepare("SELECT action, created_at FROM audit_log WHERE user_id = ? AND action IN ('login.ok','logout.all','password.change','password.reset','invite.accepted','email.change','setup') ORDER BY id DESC LIMIT 40").all(req.user.id)
    .filter((a, i, all) => i === 0 || a.action !== all[i - 1].action) // vários logins seguidos viram um só
    .slice(0, 8);
  res.send(v.profilePage({ user: req.user, stats: { published: st.published || 0, drafts: st.drafts || 0, views: st.views || 0 }, activity }));
});
router.get('/receitas', (req, res) => res.send(v.recipeList({ user: req.user, categories: recipes.categories() })));
router.get('/receitas/nova', (req, res) => res.send(v.editor({ user: req.user, recipe: null, categories: recipes.categories(), products: products() })));
router.get('/receitas/:id', (req, res, next) => {
  const r = recipes.getById(Number(req.params.id) || 0);
  if (!r) return next();
  if (!auth.canEditRecipe(req.user, r)) return res.status(403).send(v.forbidden({ user: req.user }));
  r.products = recipes.products(r.id);
  res.send(v.editor({ user: req.user, recipe: r, categories: recipes.categories(), products: products() }));
});
router.get('/importar', (req, res) => {
  // Também é o destino do "Compartilhar" do PWA (share_target): a URL pode vir em url ou dentro de text.
  const fromText = String(req.query.text || '').match(/https?:\/\/\S+/);
  res.send(v.importPage({ user: req.user, prefill: String(req.query.url || (fromText ? fromText[0] : '')) }));
});
router.get('/categorias', auth.requireAdmin, (req, res) => res.send(v.categoriesPage({ user: req.user })));
router.get('/comentarios', (req, res) => res.send(v.commentsPage({ user: req.user })));
router.get('/produtos', auth.requireAdmin, (req, res) => res.send(v.productsPage({ user: req.user })));
router.get('/api', (req, res) => res.send(v.apiPage({ user: req.user })));
router.get('/anuncios', auth.requireAdmin, (req, res) => res.send(v.adsPage({ user: req.user })));
router.get('/configuracoes', auth.requireAdmin, (req, res) => res.send(v.settingsPage({ user: req.user })));
router.get('/usuarios', auth.requireAdmin, (req, res) => res.send(v.usersPage({ user: req.user })));
router.get('/newsletter', auth.requireAdmin, (req, res) => res.send(v.newsletterAdminPage({ user: req.user, preselect: String(req.query.receita || '').replace(/\D/g, '') })));
router.get('/auditoria', auth.requireAdmin, (req, res) => res.send(v.auditPage({ user: req.user })));

module.exports = router;
