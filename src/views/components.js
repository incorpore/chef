'use strict';
const u = require('../util');
const { icon } = require('./layout');

const esc = u.esc;
const DIFFICULTY = { 1: 'Fácil', 2: 'Média', 3: 'Difícil' };

function stars(avg, count) {
  if (!avg) return '';
  const full = Math.round(avg);
  return `<span class="stars" title="${avg} de 5 (${count} avaliações)" aria-label="${avg} de 5">${'★'.repeat(full)}${'☆'.repeat(5 - full)}<small>${String(avg).replace('.', ',')}</small></span>`;
}

function thumb(src, alt, { w = 600, h = 450, eager = false } = {}) {
  if (!src) return `<div class="ph" aria-hidden="true">${icon('chef')}</div>`;
  return `<img src="${esc(src)}" alt="${esc(alt)}" width="${w}" height="${h}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`;
}

function recipeCard(r, { eager = false } = {}) {
  const time = u.formatMinutes(r.total_minutes);
  return `<article class="card" data-recipe-id="${r.id}">
  <a href="/receita/${esc(r.slug)}" class="card-link">
    <div class="card-media">${thumb(r.cover, r.title, { eager })}${r.video ? `<span class="chip chip-video">${icon('play')} Vídeo</span>` : ''}</div>
    <div class="card-body">
      <span class="card-cat">${r.category ? esc(`${r.category.icon || ''} ${r.category.name}`.trim()) : '&nbsp;'}</span>
      <h3>${esc(r.title)}</h3>
      <div class="card-meta">
        ${time ? `<span>${icon('clock')} ${time}</span>` : ''}
        <span>${icon('flame')} ${DIFFICULTY[r.difficulty] || ''}</span>
        ${stars(r.rating?.average, r.rating?.count)}
      </div>
    </div>
  </a>
  <span class="code-chip" title="Código da receita">#${esc(r.code)}</span>
  <button class="fav-btn" data-fav="${r.id}" data-slug="${esc(r.slug)}" data-title="${esc(r.title)}" data-cover="${esc(r.cover)}" aria-label="Favoritar ${esc(r.title)}">${icon('heart')}</button>
</article>`;
}

function grid(items, { adHtml = '', every = 6 } = {}) {
  if (!items.length) return '<p class="empty">Nenhuma receita encontrada.</p>';
  const parts = [];
  items.forEach((r, i) => {
    parts.push(recipeCard(r, { eager: i < 2 }));
    if (adHtml && (i + 1) % every === 0 && i < items.length - 1) parts.push(`<div class="grid-ad">${adHtml}</div>`);
  });
  return `<div class="grid">${parts.join('')}</div>`;
}

function pagination(page, pages, makeHref) {
  if (pages <= 1) return '';
  const links = [];
  if (page > 1) links.push(`<a href="${makeHref(page - 1)}" rel="prev">${icon('arrowL')} Anterior</a>`);
  links.push(`<span>Página ${page} de ${pages}</span>`);
  if (page < pages) links.push(`<a href="${makeHref(page + 1)}" rel="next">Próxima ${icon('arrowR')}</a>`);
  return `<nav class="pagination">${links.join('')}</nav>`;
}

function videoEmbed(v, title = '') {
  if (!v) return '';
  switch (v.type) {
    case 'youtube':
      return `<div class="video-frame" data-yt="${esc(v.id)}"><button class="yt-lite" aria-label="Assistir vídeo"><img src="https://i.ytimg.com/vi/${esc(v.id)}/hqdefault.jpg" alt="" loading="lazy">${icon('play')}</button></div>`;
    case 'vimeo':
      return `<div class="video-frame"><iframe src="https://player.vimeo.com/video/${esc(v.id)}" title="${esc(title)}" loading="lazy" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe></div>`;
    case 'tiktok':
      return `<div class="video-frame video-vertical"><iframe src="https://www.tiktok.com/embed/v2/${esc(v.id)}" title="${esc(title)}" loading="lazy" allowfullscreen></iframe></div>`;
    case 'instagram':
      return `<div class="video-frame video-vertical"><iframe src="https://www.instagram.com/p/${esc(v.id)}/embed" title="${esc(title)}" loading="lazy" allowfullscreen></iframe></div>`;
    case 'file':
      return `<div class="video-frame"><video src="${esc(v.url)}" controls preload="metadata" playsinline></video></div>`;
    default:
      return `<p><a class="btn btn-ghost" href="${esc(v.url)}" target="_blank" rel="noopener">${icon('play')} Assistir ao vídeo</a></p>`;
  }
}

const STOP = new Set(['de', 'do', 'da', 'dos', 'das', 'e', 'a', 'o', 'em', 'com', 'para', 'gosto', 'ou', 'picado', 'picada', 'ralado', 'ralada', 'fresco', 'fresca', 'grande', 'grandes', 'pequeno', 'pequena', 'medio', 'media', 'inteiro', 'cozido', 'cozida', 'po']);

/** Para cada passo, índices dos ingredientes mencionados no texto. */
function linkIngredients(steps, ingredients) {
  const keys = ingredients.map((i) => {
    const words = u.stripAccents(i.name).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
    return words.slice(0, 1).map((w) => (w.length > 4 ? w.replace(/(s|es)$/, '') : w));
  });
  return steps.map((s) => {
    const t = u.stripAccents(s.text).toLowerCase();
    const hits = [];
    keys.forEach((k, idx) => {
      if (k.length && k.every((w) => new RegExp(`\\b${w}`).test(t))) hits.push(idx);
    });
    return hits;
  });
}

module.exports = { recipeCard, grid, pagination, stars, thumb, videoEmbed, linkIngredients, DIFFICULTY };
