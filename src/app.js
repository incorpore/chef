'use strict';
const express = require('express');
const path = require('node:path');
const config = require('./config');
const auth = require('./auth');
const pages = require('./views/pages');

function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=(self), screen-wake-lock=(self)');
    if (!req.path.startsWith('/api/')) res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    next();
  });

  // O service worker precisa ser servido da raiz para controlar todo o site
  app.get('/sw.js', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Service-Worker-Allowed', '/');
    res.sendFile(path.join(config.root, 'public', 'sw.js'));
  });
  app.use(express.static(path.join(config.root, 'public'), { maxAge: config.isProd ? '7d' : 0, index: false }));
  app.use('/uploads', express.static(config.uploadsDir, { maxAge: '30d', immutable: true, index: false }));

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));
  app.use(auth.loadUser);

  app.use('/api/v1', require('./routes/api'));
  app.use('/admin', require('./routes/admin'));
  app.use('/', require('./routes/pages'));

  app.use((req, res) => res.status(404).send(pages.notFound(req.user)));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    console.error(err);
    res.status(err.status || 500).send(pages.notFound(req.user, err.status && err.status < 500 ? err.message : 'Ops! Algo deu errado'));
  });
  return app;
}

module.exports = { createApp };
