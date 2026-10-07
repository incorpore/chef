'use strict';
const db = require('./db');
const settings = require('./settings');
const u = require('./util');

const AD_SLOTS = {
  header: 'Topo do site (abaixo do menu)',
  home_inline: 'Entre as receitas da página inicial/listas',
  recipe_top: 'Receita — antes dos ingredientes',
  recipe_middle: 'Receita — entre ingredientes e preparo',
  recipe_steps: 'Receita — entre os passos (a cada 3 passos)',
  recipe_bottom: 'Receita — após o preparo',
  sidebar: 'Barra lateral (desktop)',
  cook_mode: 'Modo cozinha — tela de conclusão',
  footer: 'Rodapé',
};

/** Escolhe um anúncio ativo para o slot (sorteio ponderado pelo peso). */
function pickAd(slot) {
  const s = settings.all();
  if (!s.adsEnabled) return null;
  const ads = db.get().prepare('SELECT * FROM ads WHERE slot = ? AND active = 1').all(slot);
  if (!ads.length) return null;
  const total = ads.reduce((a, b) => a + Math.max(1, b.weight), 0);
  let r = Math.random() * total;
  for (const ad of ads) {
    r -= Math.max(1, ad.weight);
    if (r <= 0) return ad;
  }
  return ads[0];
}

/** HTML do slot. O HTML do anúncio é confiável (cadastrado pelo admin). */
function renderAd(slot) {
  const ad = pickAd(slot);
  if (!ad) return '';
  db.get().prepare('UPDATE ads SET impressions = impressions + 1 WHERE id = ?').run(ad.id);
  const device = ad.device === 'mobile' ? ' ad-mobile' : ad.device === 'desktop' ? ' ad-desktop' : '';
  return `<aside class="ad ad-${u.esc(slot)}${device}" aria-label="Publicidade"><span class="ad-label">Publicidade</span>${ad.html}</aside>`;
}

function productLink(p) {
  return `/go/${p.id}`;
}

function renderProducts(list, { title = 'Utensílios e ingredientes que eu uso', compact = false } = {}) {
  if (!list || !list.length) return '';
  const s = settings.all();
  const cards = list.map((p) => `
    <a class="product-card" href="${productLink(p)}" target="_blank" rel="sponsored noopener nofollow">
      ${p.image ? `<img src="${u.esc(p.image)}" alt="" loading="lazy" width="120" height="120">` : '<div class="product-ph">🛒</div>'}
      <span class="product-info">
        ${p.badge ? `<span class="badge">${u.esc(p.badge)}</span>` : ''}
        <strong>${u.esc(p.title)}</strong>
        ${!compact && p.description ? `<small>${u.esc(p.description)}</small>` : ''}
        <span class="product-cta">${p.price ? `<em>${u.esc(p.price)}</em>` : ''} Ver na Amazon →</span>
      </span>
    </a>`).join('');
  return `<section class="products"><h2>${u.esc(title)}</h2><div class="product-grid">${cards}</div>${s.amazonDisclosure ? `<p class="disclosure">${u.esc(s.amazonDisclosure)}</p>` : ''}</section>`;
}

/** Produtos cujas palavras-chave aparecem nos ingredientes (sugestão automática). */
function productsForIngredients(ingredients, excludeIds = []) {
  const all = db.get().prepare("SELECT * FROM products WHERE active = 1 AND keywords != ''").all();
  const names = u.stripAccents(ingredients.map((i) => i.name).join(' | ')).toLowerCase();
  const map = new Map();
  for (const p of all) {
    if (excludeIds.includes(p.id)) continue;
    const kws = p.keywords.split(',').map((k) => u.stripAccents(k.trim()).toLowerCase()).filter(Boolean);
    const hit = kws.find((k) => names.includes(k));
    if (hit) map.set(hit, p);
  }
  return map; // keyword normalizada -> produto
}

function outboundUrl(product) {
  return u.amazonUrl(product, settings.all().amazonTag);
}

module.exports = { AD_SLOTS, pickAd, renderAd, renderProducts, productsForIngredients, outboundUrl, productLink };
