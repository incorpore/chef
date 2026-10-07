'use strict';
const { AsyncLocalStorage } = require('node:async_hooks');
const config = require('./config');

/** Contexto por requisição (nonce do CSP, URL base, caminho), acessível nos templates sem passar parâmetros. */
const als = new AsyncLocalStorage();

function middleware(req, res, next) {
  const base = config.baseUrl || `${req.protocol}://${req.get('host')}`;
  als.run({ req, res, base, path: req.path, nonce: res.locals.nonce || '' }, next);
}

function get() {
  return als.getStore() || { base: config.baseUrl || '', path: '/', nonce: '' };
}

/** Converte caminho relativo em URL absoluta (necessário para og:image, canonical, JSON-LD). */
function absolute(url) {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  return `${get().base}${url.startsWith('/') ? '' : '/'}${url}`;
}

module.exports = { middleware, get, absolute };
