'use strict';
const { esc } = require('../util');
const settings = require('../settings');
const ctx = require('../context');

const ROBOTS_INDEX = 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1';

/** URL canônica padrão: endereço atual sem parâmetros (exceto ?page=N > 1). */
function defaultCanonical() {
  const { req, base } = ctx.get();
  if (!req) return '';
  const page = Number(req.query?.page);
  return `${base}${req.path}${page > 1 ? `?page=${page}` : ''}`;
}

function defaultImage() {
  const s = settings.all();
  return ctx.absolute(s.defaultOgImage || s.logo || '/icons/icon-512.png');
}

/**
 * Metatags de SEO e compartilhamento: título, descrição, canonical, Open Graph, Twitter/X,
 * robots, idioma, verificação de propriedade (Google, Bing, Pinterest, Facebook) e paginação.
 */
function seoHead({ title, fullTitle, description, canonical, image, imageAlt, type = 'website', noindex, article, prev, next }) {
  const s = settings.all();
  const url = canonical === false ? '' : canonical || defaultCanonical();
  const img = image ? ctx.absolute(image) : defaultImage();
  const twitter = s.twitterHandle ? `@${s.twitterHandle.replace(/^@/, '')}` : '';
  const tags = [
    `<title>${esc(fullTitle)}</title>`,
    `<meta name="description" content="${esc(description)}">`,
    `<meta name="robots" content="${noindex ? 'noindex, follow' : ROBOTS_INDEX}">`,
    url ? `<link rel="canonical" href="${esc(url)}">` : '',
    url && !noindex ? `<link rel="alternate" hreflang="pt-BR" href="${esc(url)}"><link rel="alternate" hreflang="x-default" href="${esc(url)}">` : '',
    prev ? `<link rel="prev" href="${esc(ctx.absolute(prev))}">` : '',
    next ? `<link rel="next" href="${esc(ctx.absolute(next))}">` : '',
    `<meta property="og:locale" content="pt_BR">`,
    `<meta property="og:site_name" content="${esc(s.siteName)}">`,
    `<meta property="og:type" content="${type}">`,
    `<meta property="og:title" content="${esc(title || s.siteName)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    url ? `<meta property="og:url" content="${esc(url)}">` : '',
    `<meta property="og:image" content="${esc(img)}">`,
    `<meta property="og:image:alt" content="${esc(imageAlt || title || s.siteName)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    twitter ? `<meta name="twitter:site" content="${esc(twitter)}">` : '',
    `<meta name="twitter:title" content="${esc(title || s.siteName)}">`,
    `<meta name="twitter:description" content="${esc(description)}">`,
    `<meta name="twitter:image" content="${esc(img)}">`,
    `<meta name="pinterest-rich-pin" content="true">`,
    s.googleSiteVerification ? `<meta name="google-site-verification" content="${esc(s.googleSiteVerification)}">` : '',
    s.bingSiteVerification ? `<meta name="msvalidate.01" content="${esc(s.bingSiteVerification)}">` : '',
    s.pinterestVerification ? `<meta name="p:domain_verify" content="${esc(s.pinterestVerification)}">` : '',
    s.facebookDomainVerification ? `<meta name="facebook-domain-verification" content="${esc(s.facebookDomainVerification)}">` : '',
  ];
  if (article) {
    if (article.published) tags.push(`<meta property="article:published_time" content="${esc(article.published)}">`);
    if (article.modified) tags.push(`<meta property="article:modified_time" content="${esc(article.modified)}">`);
    if (article.section) tags.push(`<meta property="article:section" content="${esc(article.section)}">`);
    for (const t of article.tags || []) tags.push(`<meta property="article:tag" content="${esc(t)}">`);
  }
  return tags.filter(Boolean).join('\n');
}

/**
 * Google Analytics 4, Tag Manager, AdSense, Meta Pixel e Clarity com Consent Mode v2 (LGPD/GDPR):
 * por padrão nada é armazenado até o visitante aceitar; o AdSense exibe anúncios não personalizados.
 */
function trackingHead() {
  const s = settings.all();
  const needsConsent = s.consentBanner;
  const out = [];
  const anyGoogle = s.ga4Id || s.gtmId || (s.adsEnabled && s.adsenseClient);
  if (anyGoogle) {
    out.push(`<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}
var c=${needsConsent ? "null;try{c=localStorage.getItem('chef:consent')}catch(e){}" : "'granted';"}
var g=c==='granted'?'granted':'denied';
gtag('consent','default',{ad_storage:g,ad_user_data:g,ad_personalization:g,analytics_storage:g,functionality_storage:'granted',security_storage:'granted',wait_for_update:500});
gtag('set','ads_data_redaction',g==='denied');gtag('set','url_passthrough',true);
${s.adsEnabled && s.adsenseClient ? "(window.adsbygoogle=window.adsbygoogle||[]).requestNonPersonalizedAds=g==='granted'?0:1;" : ''}</script>`);
  }
  if (s.ga4Id) {
    out.push(`<link rel="preconnect" href="https://www.googletagmanager.com">`);
    out.push(`<script async src="https://www.googletagmanager.com/gtag/js?id=${esc(s.ga4Id)}"></script>`);
    out.push(`<script>gtag('js',new Date());gtag('config',${JSON.stringify(s.ga4Id)},{anonymize_ip:true});</script>`);
  }
  if (s.gtmId) {
    out.push(`<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;var n=d.querySelector('[nonce]');if(n)j.nonce=n.nonce||n.getAttribute('nonce');f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer',${JSON.stringify(s.gtmId)});</script>`);
  }
  if (s.adsEnabled && s.adsenseClient) {
    out.push(`<meta name="google-adsense-account" content="${esc(s.adsenseClient)}">`);
    out.push(`<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${esc(s.adsenseClient)}" crossorigin="anonymous"></script>`);
  }
  // Configuração lida pelo app.js (Pixel e Clarity só carregam depois do consentimento)
  out.push(`<script type="application/json" id="chef-config">${JSON.stringify({ consent: needsConsent, ga4: s.ga4Id || '', gtm: s.gtmId || '', pixel: s.metaPixelId || '', clarity: s.clarityId || '' }).replace(/</g, '\\u003c')}</script>`);
  return out.join('\n');
}

function gtmNoscript() {
  const s = settings.all();
  return s.gtmId ? `<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${esc(s.gtmId)}" height="0" width="0" style="display:none;visibility:hidden" title="GTM"></iframe></noscript>` : '';
}

function consentBanner() {
  const s = settings.all();
  if (!s.consentBanner) return '';
  return `<div class="consent" role="dialog" aria-live="polite" aria-label="Privacidade" hidden>
  <p>🍪 ${esc(s.privacyText)} <a href="/privacidade">Política de privacidade</a></p>
  <div><button class="btn btn-ghost btn-sm" data-consent="denied">Recusar</button><button class="btn btn-primary btn-sm" data-consent="granted">Aceitar</button></div>
</div>`;
}

/** JSON-LD seguro dentro de <script> (escapa "<" para impedir fechar a tag). */
function jsonLdTags(jsonLd) {
  if (!jsonLd) return '';
  const list = Array.isArray(jsonLd) ? jsonLd : [jsonLd];
  return list.filter(Boolean).map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`).join('\n');
}

function organizationLd() {
  const s = settings.all();
  const base = ctx.get().base;
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${base}/#organization`,
    name: s.siteName,
    url: `${base}/`,
    logo: ctx.absolute(s.logo || '/icons/icon-512.png'),
    sameAs: Object.values(s.social || {}).filter(Boolean),
  };
}

function websiteLd() {
  const s = settings.all();
  const base = ctx.get().base;
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${base}/#website`,
    name: s.siteName,
    description: s.description,
    inLanguage: 'pt-BR',
    url: `${base}/`,
    publisher: { '@id': `${base}/#organization` },
    potentialAction: { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: `${base}/busca?q={search_term_string}` }, 'query-input': 'required name=search_term_string' },
  };
}

function breadcrumbLd(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map(([name, url], i) => ({ '@type': 'ListItem', position: i + 1, name, ...(url ? { item: ctx.absolute(url) } : {}) })),
  };
}

function itemListLd(recipes) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: recipes.map((r, i) => ({ '@type': 'ListItem', position: i + 1, url: ctx.absolute(`/receita/${r.slug}`) })),
  };
}

module.exports = { seoHead, trackingHead, gtmNoscript, consentBanner, jsonLdTags, organizationLd, websiteLd, breadcrumbLd, itemListLd, ROBOTS_INDEX };
