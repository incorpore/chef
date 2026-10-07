'use strict';
/**
 * Microcache de HTML para visitantes anônimos (absorve picos de tráfego, ex.: receita viralizando).
 * Qualquer escrita na API ou mudança de configuração invalida tudo na hora.
 */
const TTL_MS = Number(process.env.PAGE_CACHE_SECONDS ?? 15) * 1000;
const MAX = 500;
const store = new Map();
let version = 0;

function bump() {
  version++;
  store.clear();
}

function get(key) {
  if (!TTL_MS) return null;
  const e = store.get(key);
  if (!e || e.v !== version || Date.now() > e.exp) return null;
  return e;
}

function set(key, status, body) {
  if (!TTL_MS) return;
  if (store.size >= MAX) store.delete(store.keys().next().value);
  store.set(key, { v: version, exp: Date.now() + TTL_MS, status, body });
}

/** Envia do cache ou renderiza e guarda. Só para GET de visitantes sem login. */
function page(req, res, render) {
  if (req.method !== 'GET' || req.user || req.headers.authorization) return res.send(render());
  const key = req.originalUrl;
  const hit = get(key);
  if (hit) {
    res.setHeader('X-Cache', 'HIT');
    return res.status(hit.status).send(hit.body);
  }
  const body = render();
  set(key, res.statusCode, body);
  res.setHeader('X-Cache', 'MISS');
  return res.send(body);
}

module.exports = { page, bump, get, set };
