'use strict';
/**
 * Capa ilustrada automática para receitas sem foto: degradê com a cor da categoria,
 * um emoji do prato e o nome da receita. É um SVG leve, gerado na hora, sem direitos autorais.
 */
const crypto = require('node:crypto');
const u = require('./util');

const VERSION = 2; // aumente ao mudar o desenho, para os navegadores baixarem de novo

// Pares de cores (início → fim do degradê), quentes e com bom contraste para texto branco
const PALETTE = [
  ['#e85d2a', '#b8321a'], ['#d9822b', '#a3511a'], ['#c0392b', '#7b1f2a'], ['#8e5a3c', '#4e2f1f'],
  ['#6b8e23', '#3f5a14'], ['#2e8b74', '#1b5446'], ['#2f6f9f', '#1b3f61'], ['#8e44ad', '#552766'],
  ['#d35d8c', '#8f2f57'], ['#b5651d', '#6d3a10'], ['#557a46', '#2f4a26'], ['#c9a227', '#8a6a12'],
];

// Ordem importa: tipos de prato específicos antes dos ingredientes ("bolo de cenoura" → 🍰, não 🥕)
const EMOJI = [
  [/morango do amor|maca do amor|uva do amor/, '🍓'], [/brigadeir|trufa|bombom|ovo de pascoa|ovo de colher|chocotone|brownie|petit gateau/, '🍫'],
  [/pudim|quindim|flan|creme brulee|manjar|brigadeirao|arroz.doce/, '🍮'], [/sorvete|picole|mousse|pave|gelatina|delicia|banoffee|cheesecake|pavlova|merengue|suspiro|papaya/, '🍨'],
  [/cookie|biscoito|bolacha|dalgona|chipa|polvilho/, '🍪'], [/churros|sonho|donut|rosquinha|bolinho de chuva/, '🍩'], [/bolo|cuca|rocambole|panettone|colomba/, '🍰'],
  [/torta|quiche|empad|torta salgada/, '🥧'], [/pao de queijo|chipa/, '🧀'], [/panqueca|waffle|crepioca|rabanada|torrada/, '🥞'], [/pizza|calzone|focaccia/, '🍕'],
  [/cachorro.quente|enroladinho de salsicha/, '🌭'], [/hamburguer|x.tudo|bauru/, '🍔'], [/sanduiche|misto|wrap|bauru|joelho/, '🥪'],
  [/pao|broa|rosca|bisnag|brioche/, '🍞'], [/lasanha|macarr|espaguete|talharim|fettuccine|penne|nhoque|ravioli|capeletti|canelone|rondelli|yakissoba|massa fresca|mac and cheese/, '🍝'],
  [/queijo/, '🧀'], [/camarao|bobo de camarao/, '🦐'], [/lula|polvo/, '🦑'], [/siri|caranguejo/, '🦀'], [/peixe|tilapia|salmao|bacalh|sardinha|pescada|merluza|atum|ceviche/, '🐟'],
  [/feijoada|feijao|tutu/, '🫘'],
  [/frango|galinh|galinhada|peru|chester|nuggets|sobrecoxa|coxinha da asa/, '🍗'], [/coxinha|pastel|esfiha|kibe|quibe(?!be)|risoles|croquete|bolinho|enroladinho|salgado|falafel|acaraje/, '🥟'],
  [/bacon|torresmo|lombo|pernil|bisteca|panceta|linguica|porco|costelinha|tender/, '🥓'],
  [/carne|bife|picanha|costela|cupim|maminha|rosbife|fraldinha|file mignon|medalhao|rabada|kafta|almondega|polpetone|chili|dobradinha|lingua|figado|moela|cozido|vaca atolada|picadinho|feijoada/, '🥩'],
  [/sopa|caldo|canja|minestrone|creme de|caldeirada/, '🍲'], [/arroz|risoto|paella|baiao/, '🍚'], [/feijao|tutu|lentilha|grao.de.bico|hommus/, '🫘'],
  [/salada|tabule|vinagrete|caprese|caesar|salpicao/, '🥗'], [/batata|mandioca|aipim|mandioquinha|pure|chips/, '🥔'], [/milho|pamonha|curau|canjica|polenta/, '🌽'],
  [/pipoca/, '🍿'], [/omelete|\bovos?\b|gemada|tortilha/, '🍳'], [/tapioca|cuscuz/, '🫓'],
  [/chocolate quente|cappuccino|cafe/, '☕'], [/\bcha\b|\bmate\b/, '🍵'], [/vinho|sangria|quentao/, '🍷'], [/caipirinha|drink|batida/, '🍹'],
  [/suco|limonada|vitamina|smoothie|milkshake|leite de coco/, '🥤'], [/granola|aveia|overnight|mingau|iogurte/, '🥣'],
  [/abobora|quibebe/, '🎃'], [/cogumelo/, '🍄'], [/berinjela|ratatouille/, '🍆'], [/brocolis|couve/, '🥦'], [/abobrinha|legume/, '🥒'],
  [/molho|tomate/, '🍅'], [/cebola/, '🧅'], [/farofa/, '🥜'],
  [/cocada|coco/, '🥥'], [/banana/, '🍌'], [/maca/, '🍎'], [/limao/, '🍋'], [/laranja/, '🍊'], [/abacaxi/, '🍍'], [/morango/, '🍓'],
  [/doce de leite|doce|pe de moleque|pacoca|cajuzinho|beijinho|bala|romeu e julieta|goiabada|arroz.doce|palha italiana/, '🍬'],
];

const norm = (s) => u.stripAccents(String(s || '')).toLowerCase();
const hashNum = (s) => crypto.createHash('sha1').update(String(s)).digest().readUInt32BE(0);

function emojiFor(title, categoryIcon) {
  const t = ` ${norm(title)} `;
  for (const [re, e] of EMOJI) if (re.test(t)) return e;
  return categoryIcon || '🍽️';
}

/** Endereço da capa automática (muda quando o título muda, para não ficar velha no cache). */
function autoCoverUrl(r) {
  if (!r?.code) return '';
  const v = crypto.createHash('sha1').update(`${VERSION}|${r.title}`).digest('hex').slice(0, 8);
  return `/capa/${encodeURIComponent(r.code)}.svg?v=${v}`;
}

function svg({ title, code, category }) {
  // Cor varia por receita (não só por categoria), para a lista não ficar toda igual
  const seed = hashNum(`${code}|${title}`);
  const [c1, c2] = PALETTE[seed % PALETTE.length];
  const emoji = emojiFor(title, category?.icon);
  const bx = 860 + (seed % 220);
  const by = 90 + ((seed >> 8) % 200);
  // Sem texto: o nome já aparece embaixo do cartão e no título da página (evita repetição)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 900" width="1200" height="900" role="img" aria-label="${u.esc(title)}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
<rect width="1200" height="900" fill="url(#g)"/>
<circle cx="${bx}" cy="${by}" r="320" fill="#fff" opacity=".08"/>
<circle cx="${bx - 700}" cy="${by + 620}" r="260" fill="#fff" opacity=".06"/>
<circle cx="600" cy="450" r="260" fill="#fff" opacity=".15"/>
<text x="600" y="450" font-size="300" text-anchor="middle" dominant-baseline="central" font-family="'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif">${emoji}</text>
</svg>`;
}

module.exports = { svg, autoCoverUrl, emojiFor };
