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
  social: { instagram: '', youtube: '', tiktok: '', pinterest: '', facebook: '', x: '' },
  twitterHandle: '',
  defaultOgImage: '',
  // Medição e verificação de propriedade
  ga4Id: '',
  gtmId: '',
  metaPixelId: '',
  clarityId: '',
  googleSiteVerification: '',
  bingSiteVerification: '',
  pinterestVerification: '',
  facebookDomainVerification: '',
  consentBanner: true,
  privacyText: 'Usamos cookies para medir audiência e exibir anúncios. Você pode aceitar ou recusar a qualquer momento.',
  shareNetworks: 'whatsapp,pinterest,facebook,telegram,x,email',
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

// Validação de cada configuração no servidor (formato dos IDs, URLs e tamanhos)
const PATTERNS = {
  themeColor: [/^#[0-9a-f]{6}$/i, 'Cor inválida (use #RRGGBB)'],
  adsenseClient: [/^(ca-pub-\d{10,20})?$/, 'ID do AdSense inválido (ex.: ca-pub-1234567890123456)'],
  ga4Id: [/^(G-[A-Z0-9]{4,15})?$/, 'ID do Google Analytics inválido (ex.: G-ABC123XYZ)'],
  gtmId: [/^(GTM-[A-Z0-9]{4,12})?$/, 'ID do Tag Manager inválido (ex.: GTM-ABC1234)'],
  metaPixelId: [/^(\d{5,20})?$/, 'ID do Meta Pixel inválido (apenas números)'],
  clarityId: [/^([a-z0-9]{5,20})?$/i, 'ID do Microsoft Clarity inválido'],
  googleSiteVerification: [/^([\w-]{5,100})?$/, 'Código de verificação do Google inválido'],
  bingSiteVerification: [/^([\w-]{5,100})?$/, 'Código de verificação do Bing inválido'],
  pinterestVerification: [/^([\w-]{5,100})?$/, 'Código de verificação do Pinterest inválido'],
  facebookDomainVerification: [/^([\w-]{5,100})?$/, 'Código de verificação do Facebook inválido'],
  twitterHandle: [/^(@?\w{1,15})?$/, '@ do X/Twitter inválido'],
  amazonTag: [/^([\w-]{2,40})?$/, 'Tag de associado inválida (ex.: meusite-20)'],
  logo: [/^((https:\/\/|\/)[^\s"'<>]{1,1000})?$/, 'URL do logo inválida'],
  defaultOgImage: [/^((https:\/\/|\/)[^\s"'<>]{1,1000})?$/, 'URL da imagem padrão inválida'],
  shareNetworks: [/^[a-z,]{0,200}$/, 'Lista de redes inválida'],
};
const MAX_LEN = { headHtml: 20000, adsTxt: 20000, aboutText: 20000, privacyText: 1000, description: 320, siteName: 60, tagline: 120, amazonDisclosure: 300, authorName: 80 };

function invalid(msg) {
  return Object.assign(new Error(msg), { status: 400 });
}

function update(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw invalid('Configurações inválidas');
  const stmt = db.get().prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  const rows = [];
  for (const [k, v] of Object.entries(patch)) {
    if (!Object.hasOwn(DEFAULTS, k)) continue; // ignora chaves desconhecidas (inclusive __proto__/constructor)
    let value = v;
    const def = DEFAULTS[k];
    if (typeof def === 'boolean') value = v === true || v === 'true' || v === 'on' || v === 1 || v === '1';
    else if (typeof def === 'number') value = Math.min(100, Math.max(1, Math.round(Number(v)) || def));
    else if (typeof def === 'object') {
      const cur = all()[k] || def;
      value = { ...def };
      for (const sk of Object.keys(def)) {
        const sv = String(v?.[sk] ?? cur[sk] ?? '').trim();
        if (sv && !/^https:\/\/[^\s"'<>]{1,500}$/.test(sv)) throw invalid(`Link de ${sk} inválido (use https://)`);
        value[sk] = sv;
      }
    } else {
      value = String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
      if (k !== 'headHtml' && k !== 'adsTxt' && k !== 'aboutText' && k !== 'privacyText') value = value.trim();
      if (PATTERNS[k] && !PATTERNS[k][0].test(value)) throw invalid(PATTERNS[k][1]);
      if (value.length > (MAX_LEN[k] || 500)) throw invalid(`"${k}" excede o tamanho máximo`);
    }
    rows.push([k, value]);
  }
  for (const [k, value] of rows) stmt.run(k, JSON.stringify(value));
  cache = null;
  return all();
}

function reset() {
  cache = null;
}

module.exports = { all, update, reset, DEFAULTS };
