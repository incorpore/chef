'use strict';
const express = require('express');
const compression = require('compression');
const path = require('node:path');
const config = require('./config');
const auth = require('./auth');
const sec = require('./security');
const ctx = require('./context');
const pages = require('./views/pages');

function createApp() {
  const app = express();
  // Só confia em X-Forwarded-For se houver proxy de verdade na frente (senão o IP pode ser forjado
  // para burlar os limites de tentativas). Atrás de Nginx/Caddy/Cloudflare: TRUST_PROXY=1
  app.set('trust proxy', Number(process.env.TRUST_PROXY || 0));
  app.disable('x-powered-by');
  app.set('etag', 'strong');
  app.set('query parser', 'simple'); // evita objetos aninhados vindos da URL (?a[b]=c)

  app.use(sec.headers);
  app.use(compression({ threshold: 1024 }));

  // URLs canônicas: sem barra no final (evita conteúdo duplicado no Google)
  app.use((req, res, next) => {
    if (req.method === 'GET' && req.path.length > 1 && req.path.endsWith('/') && !req.path.startsWith('/api/')) {
      const q = req.originalUrl.slice(req.path.length);
      return res.redirect(301, req.path.replace(/\/+$/, '') + q);
    }
    next();
  });

  // Arquivos sensíveis nunca são servidos, mesmo se forem parar por engano em uma pasta pública
  app.use((req, res, next) => {
    if (/(^|\/)\.(?!well-known)|\.(env|db|sqlite|sqlite3|db-wal|db-shm|log|bak|pem|key)$/i.test(req.path) || /\/(data|node_modules|src|test|scripts)\//.test(req.path)) {
      return res.status(404).type('text/plain').send('Não encontrado');
    }
    next();
  });

  // O service worker precisa ser servido da raiz para controlar todo o site
  app.get('/sw.js', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Service-Worker-Allowed', '/');
    res.sendFile(path.join(config.root, 'public', 'sw.js'));
  });
  app.use(express.static(path.join(config.root, 'public'), { maxAge: config.isProd ? '7d' : 0, index: false, dotfiles: 'deny', redirect: false }));
  app.use('/uploads', express.static(config.uploadsDir, {
    maxAge: '30d', immutable: true, index: false, dotfiles: 'deny', redirect: false, fallthrough: false,
    setHeaders: (res, file) => {
      // Somente imagens e vídeos; qualquer outra coisa é baixada como arquivo, nunca exibida
      if (!/\.(jpe?g|png|gif|webp|avif|mp4|webm|ogv|mov)$/i.test(file)) res.setHeader('Content-Disposition', 'attachment');
    },
  }));

  // Corpo das requisições: limites de tamanho (importação em lote aceita mais)
  app.use('/api/v1/import/json', express.json({ limit: '20mb' }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb', parameterLimit: 100 }));
  app.use(auth.loadUser);
  app.use(ctx.middleware);

  app.use('/api/v1', require('./routes/api'));
  app.use('/admin', require('./routes/admin'));
  app.use('/', require('./routes/pages'));

  app.use((req, res) => res.status(404).send(pages.notFound(req.user)));
  // Erro sem detalhes para o visitante; detalhes completos apenas no log do servidor
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(`[erro] ${req.method} ${req.originalUrl}`, err);
    if (req.originalUrl.startsWith('/api/') || req.originalUrl.startsWith('/uploads/')) {
      return res.status(status).json({ error: status === 404 ? 'Não encontrado' : status >= 500 ? 'Erro interno' : 'Requisição inválida' });
    }
    res.status(status).send(pages.notFound(req.user, status === 404 ? 'Página não encontrada' : status < 500 ? 'Requisição inválida' : 'Ops! Algo deu errado'));
  });
  return app;
}

module.exports = { createApp };
