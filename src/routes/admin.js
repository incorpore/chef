'use strict';
const express = require('express');
const auth = require('../auth');
const db = require('../db');
const recipes = require('../recipes');
const v = require('../views/admin');

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

router.use((req, res, next) => {
  if (auth.userCount() === 0) return res.redirect('/admin/setup');
  next();
});
router.use(auth.requireUser);

const products = () => db.get().prepare('SELECT * FROM products ORDER BY title').all();

router.get('/', (req, res) => res.send(v.dashboard({ user: req.user })));
router.get('/receitas', (req, res) => res.send(v.recipeList({ user: req.user })));
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
router.get('/auditoria', auth.requireAdmin, (req, res) => res.send(v.auditPage({ user: req.user })));

module.exports = router;
