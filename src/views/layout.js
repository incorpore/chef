'use strict';
const { esc } = require('../util');
const settings = require('../settings');
const { renderAd } = require('../monetization');
const { seoHead, trackingHead, gtmNoscript, consentBanner, jsonLdTags } = require('./head');

const ASSET_VERSION = Date.now().toString(36);

const ICONS = {
  search: '<path d="m21 21-4.3-4.3M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z"/>',
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  heart: '<path d="M12 20s-7-4.4-9.2-8.6C1.1 8 3 4.5 6.6 4.5c2 0 3.4 1.1 4.4 2.5 1-1.4 2.4-2.5 4.4-2.5C19 4.5 20.9 8 19.2 11.4 17 15.6 12 20 12 20Z"/>',
  cart: '<path d="M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h9.2a1 1 0 0 0 1-.8L21 8H6.2M10 20.5a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0Zm8 0a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0Z"/>',
  calendar: '<path d="M7 3v3m10-3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"/>',
  grid: '<path d="M4 4h7v7H4zm9 0h7v7h-7zM4 13h7v7H4zm9 0h7v7h-7z"/>',
  clock: '<path d="M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/>',
  users: '<path d="M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1m20 0v-1a4 4 0 0 0-3-3.9M15 3.1a4 4 0 0 1 0 7.8M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z"/>',
  chef: '<path d="M6 13.9V20h12v-6.1A4 4 0 0 0 17 6a5 5 0 0 0-10 0 4 4 0 0 0-1 7.9ZM6 17h12"/>',
  play: '<path d="M7 4v16l13-8z"/>',
  share: '<path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4m4-4v13"/>',
  print: '<path d="M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1h-2M6 14h12v7H6z"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>',
  qr: '<path d="M4 4h6v6H4zm10 0h6v6h-6zM4 14h6v6H4zm10 0h2v2h-2zm4 0h2v2h-2zm-4 4h2v2h-2zm4 0h2v2h-2z"/>',
  flame: '<path d="M12 22c4 0 7-2.8 7-7 0-3-1.6-5.3-3.2-7-.4 2-1.5 3-2.8 3.4C13.6 8 12.6 4.7 9.5 2c.3 3.3-1.5 5.4-3 7.2C5.3 10.7 5 12.5 5 15c0 4.2 3 7 7 7Z"/>',
  timer: '<path d="M10 2h4m-2 9v4m8-2a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z"/>',
  check: '<path d="m5 12 5 5L20 7"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  mic: '<path d="M12 15a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v7a3 3 0 0 0 3 3Zm7-3a7 7 0 0 1-14 0m7 7v3"/>',
  volume: '<path d="M11 5 6 9H2v6h4l5 4zm4.5 3.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  arrowL: '<path d="M15 18 9 12l6-6"/>',
  arrowR: '<path d="m9 18 6-6-6-6"/>',
  star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7zm-10 10 10 5 10-5M2 17l10 5 10-5"/>',
  download: '<path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v3h16v-3"/>',
  user: '<path d="M20 21v-1a5 5 0 0 0-5-5H9a5 5 0 0 0-5 5v1M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z"/>',
  logout: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5m5 5H3"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Zm8 9a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"/>',
  fridge: '<path d="M6 2h12a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Zm-1 8h14M9 5v2m0 6v3"/>',
};

function icon(name, cls = '') {
  return `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

/** Foto do usuário ou, se não houver, as iniciais do nome num círculo colorido. */
function avatar(user, cls = '') {
  const name = String(user?.name || '?').trim();
  if (user?.avatar) return `<img class="avatar ${cls}" src="${esc(user.avatar)}" alt="" width="40" height="40" loading="lazy" decoding="async">`;
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
  return `<span class="avatar avatar-initials ${cls}" aria-hidden="true">${esc(initials)}</span>`;
}

const SOCIAL_LABELS = { instagram: 'Instagram', youtube: 'YouTube', tiktok: 'TikTok', pinterest: 'Pinterest', facebook: 'Facebook', x: 'X (Twitter)' };

/** Menu da conta no topo (só aparece para quem está logado). */
function accountMenu(user) {
  return `<details class="account" data-account-menu>
    <summary aria-label="Minha conta: ${esc(user.name)}" title="Minha conta">${avatar(user, 'avatar-sm')}</summary>
    <div class="account-menu" role="menu">
      <div class="account-who">${avatar(user)}<div><strong>${esc(user.name)}</strong><small>${esc(user.email)}</small></div></div>
      <a href="/admin/perfil" role="menuitem">${icon('user')} Meu perfil</a>
      <a href="/admin" role="menuitem">${icon('grid')} Painel</a>
      <a href="/admin/receitas/nova" role="menuitem">${icon('plus')} Nova receita</a>
      <button type="button" role="menuitem" data-logout>${icon('logout')} Sair</button>
    </div>
  </details>`;
}

function footer(s, user) {
  const social = Object.entries(s.social || {}).filter(([, v]) => v);
  const col = (title, links) => `<nav class="footer-col" aria-label="${title}"><p class="footer-h">${title}</p>${links}</nav>`;
  return `<footer class="footer">
  <div class="wrap">
    <div class="footer-grid">
      <div class="footer-brand">
        <a class="brand" href="/">${s.logo ? `<img src="${esc(s.logo)}" alt="" width="32" height="32">` : `<span class="brand-mark">${icon('chef')}</span>`}<span>${esc(s.siteName)}</span></a>
        <p>${esc(s.tagline)}</p>
        ${social.length ? `<p class="social">${social.map(([k, v]) => `<a href="${esc(v)}" rel="me noopener" target="_blank">${esc(SOCIAL_LABELS[k] || k)}</a>`).join('')}</p>` : ''}
      </div>
      ${col('Receitas', '<a href="/receitas">Todas as receitas</a><a href="/categorias">Categorias</a><a href="/geladeira">O que tem na geladeira?</a><a href="/surpresa" rel="nofollow">Me surpreenda</a>')}
      ${col('Ferramentas', '<a href="/favoritos">Favoritos</a><a href="/lista">Lista de compras</a><a href="/planejador">Cardápio da semana</a><a href="/conversor">Conversor de medidas</a>')}
      ${col('Sobre', `<a href="/sobre">Quem somos</a><a href="/privacidade">Privacidade</a><a href="/termos">Termos de uso</a>${s.consentBanner ? '<button type="button" class="link" data-consent-open>Cookies</button>' : ''}<a href="/feed.xml">RSS</a><a href="/api/docs">API</a>`)}
      ${user
    ? col('Minha conta', '<a href="/admin/perfil">Meu perfil</a><a href="/admin">Painel</a><a href="/admin/receitas/nova">Nova receita</a><button type="button" class="link" data-logout>Sair</button>')
    : col('Conta', '<a href="/admin" rel="nofollow">Entrar</a>')}
    </div>
    <div class="footer-bottom"><span>© ${new Date().getFullYear()} ${esc(s.siteName)}</span><a href="#main" class="to-top">Voltar ao topo ↑</a></div>
  </div>
</footer>`;
}

function layout({ title, seoTitle, description, body, head = '', canonical = '', image = '', imageAlt = '', type = 'website', article = null, prev = '', next = '', bodyClass = '', jsonLd = null, scripts = [], noindex = false, user = null, nav = '' }) {
  const s = settings.all();
  const t = seoTitle || title;
  const fullTitle = t ? `${t} · ${s.siteName}` : `${s.siteName} — ${s.tagline}`;
  const desc = String(description || s.description).replace(/\s+/g, ' ').trim().slice(0, 300);
  const navItem = (href, ic, label, key) => `<a href="${href}" class="${nav === key ? 'active' : ''}"${nav === key ? ' aria-current="page"' : ''}>${icon(ic)}<span>${label}</span></a>`;
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${seoHead({ title: t, fullTitle, description: desc, canonical, image, imageAlt, type, noindex, article, prev, next })}
<meta name="theme-color" content="${esc(s.themeColor)}">
<meta name="format-detection" content="telephone=no">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icons/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/icons/icon-192.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="${esc(s.siteName)}">
<link rel="alternate" type="application/rss+xml" title="${esc(s.siteName)}" href="/feed.xml">
<style>:root{--brand:${esc(s.themeColor)}}</style>
<script>try{var t=localStorage.getItem('chef:theme');if(t)document.documentElement.dataset.theme=t}catch(e){}</script>
<link rel="stylesheet" href="/css/app.css?v=${ASSET_VERSION}">
${jsonLdTags(jsonLd)}
${trackingHead()}
${head}
${s.headHtml || ''}
</head>
<body class="${esc(bodyClass)}">
${gtmNoscript()}
<a class="skip" href="#main">Pular para o conteúdo</a>
<header class="topbar">
  <div class="wrap topbar-in">
    <a class="brand" href="/">${s.logo ? `<img src="${esc(s.logo)}" alt="" width="32" height="32">` : `<span class="brand-mark">${icon('chef')}</span>`}<span>${esc(s.siteName)}</span></a>
    <form class="search" action="/busca" role="search" autocomplete="off">
      ${icon('search')}
      <input type="search" name="q" placeholder="Buscar receita, ingrediente ou #código" aria-label="Buscar" data-suggest>
      <div class="suggest" hidden></div>
    </form>
    <nav class="topnav">
      ${navItem('/receitas', 'grid', 'Receitas', 'recipes')}
      ${navItem('/geladeira', 'fridge', 'Geladeira', 'fridge')}
      ${navItem('/favoritos', 'heart', 'Favoritos', 'favs')}
      ${navItem('/lista', 'cart', 'Compras', 'list')}
      ${navItem('/planejador', 'calendar', 'Cardápio', 'plan')}
      <button class="icon-btn" data-theme-toggle aria-label="Alternar tema">${icon('moon')}</button>
    </nav>
    ${user ? accountMenu(user) : ''}
  </div>
</header>
${renderAd('header')}
<main id="main">
${body}
</main>
${renderAd('footer')}
${footer(s, user)}
<nav class="tabbar" aria-label="Navegação principal">
  ${navItem('/', 'home', 'Início', 'home')}
  ${navItem('/busca', 'search', 'Buscar', 'search')}
  ${navItem('/favoritos', 'heart', 'Favoritos', 'favs')}
  ${navItem('/lista', 'cart', 'Compras', 'list')}
  ${navItem('/planejador', 'calendar', 'Cardápio', 'plan')}
</nav>
<div class="toast" role="status" aria-live="polite"></div>
${consentBanner()}
<div class="install-banner" hidden>
  <span>${icon('download')} Instale o app ${esc(s.siteName)} para usar offline</span>
  <button class="btn btn-sm" data-install>Instalar</button>
  <button class="icon-btn" data-install-dismiss aria-label="Fechar">${icon('x')}</button>
</div>
<script src="/js/app.js?v=${ASSET_VERSION}" defer></script>
${scripts.map((src) => `<script src="${src}?v=${ASSET_VERSION}" defer></script>`).join('\n')}
</body>
</html>`;
}

module.exports = { layout, icon, avatar, ASSET_VERSION };
