'use strict';
const express = require('express');
const auth = require('../auth');
const db = require('../db');
const recipes = require('../recipes');
const v = require('../views/admin');

const router = express.Router();

router.get('/setup', (req, res) => {
  if (auth.userCount() > 0) return res.redirect('/admin/login');
  res.send(v.authPage({ mode: 'setup' }));
});

router.get('/login', (req, res) => {
  if (auth.userCount() === 0) return res.redirect('/admin/setup');
  if (req.user) return res.redirect(String(req.query.next || '/admin').startsWith('/') ? String(req.query.next || '/admin') : '/admin');
  res.send(v.authPage({ mode: 'login', next: String(req.query.next || '/admin') }));
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
  const r = recipes.getById(Number(req.params.id));
  if (!r) return next();
  r.products = recipes.products(r.id);
  res.send(v.editor({ user: req.user, recipe: r, categories: recipes.categories(), products: products() }));
});
router.get('/importar', (req, res) => {
  // Também é o destino do "Compartilhar" do PWA (share_target): a URL pode vir em url ou dentro de text.
  const fromText = String(req.query.text || '').match(/https?:\/\/\S+/);
  res.send(v.importPage({ user: req.user, prefill: String(req.query.url || (fromText ? fromText[0] : '')) }));
});
router.get('/categorias', (req, res) => res.send(v.categoriesPage({ user: req.user })));
router.get('/comentarios', (req, res) => res.send(v.commentsPage({ user: req.user })));
router.get('/produtos', (req, res) => res.send(v.productsPage({ user: req.user })));
router.get('/api', (req, res) => res.send(v.apiPage({ user: req.user })));
router.get('/anuncios', auth.requireAdmin, (req, res) => res.send(v.adsPage({ user: req.user })));
router.get('/configuracoes', auth.requireAdmin, (req, res) => res.send(v.settingsPage({ user: req.user })));
router.get('/usuarios', auth.requireAdmin, (req, res) => res.send(v.usersPage({ user: req.user })));

module.exports = router;
