'use strict';
const db = require('./db');

const DEFAULTS = {
  siteName: 'Chef',
  tagline: 'Receitas de verdade, passo a passo',
  description: 'Blog de receitas com modo cozinha, timers e lista de compras.',
  themeColor: '#e85d2a',
  logo: '',
  authorName: '',
  aboutText: 'Bem-vindo à minha cozinha! Aqui compartilho receitas testadas, com dicas e passo a passo.',
  social: { instagram: '', youtube: '', tiktok: '', pinterest: '', facebook: '' },
  amazonTag: '',
  amazonDisclosure: 'Como associado da Amazon, recebo por compras qualificadas. Isso não altera o preço para você.',
  adsEnabled: true,
  adsenseClient: '',
  adsenseAutoAds: false,
  adsTxt: '',
  headHtml: '',
  commentsModeration: true,
  newsletterEnabled: true,
  recipesPerPage: 12,
};

let cache = null;

function all() {
  if (cache) return cache;
  const rows = db.get().prepare('SELECT key, value FROM settings').all();
  const s = structuredClone(DEFAULTS);
  for (const r of rows) {
    try {
      s[r.key] = JSON.parse(r.value);
    } catch { /* ignora valor corrompido */ }
  }
  cache = s;
  return s;
}

function update(patch) {
  const stmt = db.get().prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const [k, v] of Object.entries(patch || {})) {
    if (!(k in DEFAULTS)) continue;
    let value = v;
    const def = DEFAULTS[k];
    if (typeof def === 'boolean') value = v === true || v === 'true' || v === 'on' || v === 1 || v === '1';
    else if (typeof def === 'number') value = Number(v) || def;
    else if (typeof def === 'object') value = { ...def, ...(typeof v === 'object' ? v : {}) };
    else value = String(v ?? '');
    stmt.run(k, JSON.stringify(value));
  }
  cache = null;
  return all();
}

function reset() {
  cache = null;
}

module.exports = { all, update, reset, DEFAULTS };
