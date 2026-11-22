'use strict';
/**
 * Shopee Afiliados — Open API (GraphQL).
 * Credenciais (AppID + Senha do painel de afiliados → Open API): variáveis SHOPEE_APP_ID / SHOPEE_SECRET ou
 * data/shopee.json (600, salvo pelo painel; nunca exibido). Endereço: SHOPEE_API_URL (padrão: Brasil).
 * Assinatura: Authorization: SHA256 Credential=<AppID>, Timestamp=<segundos>, Signature=sha256(AppID+Timestamp+corpo+Senha).
 * O corpo assinado precisa ser exatamente o JSON enviado.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('./config');

const endpoints = { graphql: process.env.SHOPEE_API_URL || 'https://open-api.affiliate.shopee.com.br/graphql' };
const keyFile = () => path.join(config.dataDir, 'shopee.json');

class ShopeeError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

function creds() {
  if (process.env.SHOPEE_APP_ID && process.env.SHOPEE_SECRET) return { appId: process.env.SHOPEE_APP_ID, secret: process.env.SHOPEE_SECRET, source: 'env' };
  try {
    const f = JSON.parse(fs.readFileSync(keyFile(), 'utf8'));
    if (f.appId && f.secret) return { appId: String(f.appId), secret: String(f.secret), source: 'file' };
  } catch { /* não configurado */ }
  return null;
}
const configured = () => !!creds();
function status() {
  const c = creds();
  return { configured: !!c, appId: c ? `${c.appId.slice(0, 4)}…` : '', fromEnv: c?.source === 'env', endpoint: endpoints.graphql };
}

function saveCreds(appId, secret) {
  const a = String(appId || '').trim();
  const s = String(secret || '').trim();
  if (!a && !s) { fs.rmSync(keyFile(), { force: true }); return; }
  if (!/^\d{5,20}$/.test(a)) throw new ShopeeError('AppID inválido (só números, como aparece no painel da Shopee)', 400);
  if (!/^[A-Za-z0-9_-]{10,100}$/.test(s)) throw new ShopeeError('Senha (Secret) com formato inválido', 400);
  fs.writeFileSync(keyFile(), JSON.stringify({ appId: a, secret: s }), { mode: 0o600 });
  try { fs.chmodSync(keyFile(), 0o600); } catch { /* sem chmod */ }
}

const ERRORS = {
  10020: 'A Shopee recusou a assinatura: confira o AppID e a Senha (e se o relógio do servidor está certo)',
  10030: 'Limite de consultas da Shopee atingido; tente em alguns minutos',
  10031: 'Limite de consultas da Shopee atingido; tente em alguns minutos',
  10035: 'Sua conta de afiliado ainda não tem acesso à Open API da Shopee',
};

let last = 0;
const limits = { gapMs: 600 };
async function gql(query, variables = {}) {
  const c = creds();
  if (!c) throw new ShopeeError('Configure o AppID e a Senha da Shopee Afiliados', 400);
  const wait = last + limits.gapMs - Date.now(); // no máximo ~2 consultas por segundo
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  const body = JSON.stringify({ query, variables });
  const ts = Math.floor(Date.now() / 1000);
  const sig = crypto.createHash('sha256').update(`${c.appId}${ts}${body}${c.secret}`).digest('hex');
  const res = await fetch(endpoints.graphql, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `SHA256 Credential=${c.appId}, Timestamp=${ts}, Signature=${sig}` },
    body,
    signal: AbortSignal.timeout(15000),
  }).catch(() => { throw new ShopeeError('Não foi possível falar com a Shopee (sem internet no servidor?)'); });
  const data = await res.json().catch(() => ({}));
  if (data.errors?.length) {
    const code = Number(data.errors[0]?.extensions?.code);
    throw new ShopeeError(ERRORS[code] || `Shopee: ${String(data.errors[0]?.message || 'erro desconhecido').slice(0, 200)}`, code === 10020 || code === 10035 ? 400 : code === 10030 ? 429 : 502);
  }
  if (!res.ok) throw new ShopeeError(`Erro da Shopee (${res.status})`);
  return data.data || {};
}

const OFFER_FIELDS = 'itemId shopId productName imageUrl priceMin priceMax offerLink productLink shopName commissionRate sales ratingStar';

function normalize(n) {
  if (!n) return null;
  const min = Number(n.priceMin);
  return {
    store: 'shopee', externalId: `${n.shopId}.${n.itemId}`, title: String(n.productName || '').slice(0, 200), image: n.imageUrl || '',
    priceValue: Number.isFinite(min) ? min : null, price: Number.isFinite(min) ? `R$ ${min.toFixed(2).replace('.', ',')}` : '',
    url: n.productLink || '', affUrl: n.offerLink || '', commission: n.commissionRate || '', sales: Number(n.sales || 0), rating: n.ratingStar || '',
  };
}

/** Um produto pelo par loja/item (vem do link da Shopee). */
async function product(shopId, itemId) {
  const d = await gql(`query($shopId: Int64, $itemId: Int64) { productOfferV2(shopId: $shopId, itemId: $itemId, limit: 1) { nodes { ${OFFER_FIELDS} } } }`, { shopId: Number(shopId), itemId: Number(itemId) });
  return normalize(d.productOfferV2?.nodes?.[0]);
}

/** Busca por palavra (sortType 2 = mais vendidos). */
async function search(keyword, { limit = 5, sortType = 2 } = {}) {
  const d = await gql(`query($keyword: String, $limit: Int, $sortType: Int) { productOfferV2(keyword: $keyword, limit: $limit, sortType: $sortType, page: 1) { nodes { ${OFFER_FIELDS} } } }`, { keyword: String(keyword).slice(0, 100), limit, sortType });
  return (d.productOfferV2?.nodes || []).map(normalize).filter(Boolean);
}

/** Link curto de afiliado para qualquer URL da Shopee. */
async function shortLink(originUrl) {
  const d = await gql('mutation($url: String!) { generateShortLink(input: { originUrl: $url, subIds: ["chef"] }) { shortLink } }', { url: originUrl });
  return d.generateShortLink?.shortLink || '';
}

/** Extrai loja/item de links da Shopee: ...-i.123.456  |  /product/123/456 */
function idsFromUrl(url) {
  const s = String(url || '');
  const m = s.match(/-i\.(\d+)\.(\d+)/) || s.match(/\/product\/(\d+)\/(\d+)/) || s.match(/[?&]shopid=(\d+).*?[?&]itemid=(\d+)/i);
  return m ? { shopId: m[1], itemId: m[2] } : null;
}

async function test() {
  const r = await search('panela', { limit: 1 });
  return { ok: true, sample: r[0]?.title || '(nenhum produto encontrado)' };
}

module.exports = { configured, status, saveCreds, product, search, shortLink, idsFromUrl, test, endpoints, limits, ShopeeError };
