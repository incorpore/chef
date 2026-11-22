'use strict';
/**
 * Utensílios citados nas receitas: "leve ao micro-ondas", "unte uma forma de 25 cm", "bata no liquidificador"…
 * Cada utensílio tem uma chave (gravada em products.utensil) e o termo usado para buscar produtos.
 * Formas guardam o tamanho: "forma:25" (e caem para "forma" quando não há produto daquele tamanho).
 */
const u = require('./util');

// [chave, nome exibido, expressão (texto sem acentos, minúsculo), termo de busca, prioridade (maior = mais específico)]
const LIST = [
  ['airfryer', 'Air fryer', /\b(air ?fryer|fritadeira (eletrica|sem oleo))\b/, 'air fryer', 9],
  ['panela-pressao', 'Panela de pressão', /\bpanela de pressao\b/, 'panela de pressão', 9],
  ['panela-arroz', 'Panela elétrica de arroz', /\bpanela (eletrica )?de arroz\b/, 'panela elétrica de arroz', 8],
  ['micro-ondas', 'Micro-ondas', /\bmicro-?ondas\b/, 'micro-ondas', 8],
  ['liquidificador', 'Liquidificador', /\bliquidificador\b/, 'liquidificador', 8],
  ['batedeira', 'Batedeira', /\bbatedeira\b/, 'batedeira', 8],
  ['mixer', 'Mixer de mão', /\bmixer\b/, 'mixer de mão', 8],
  ['processador', 'Processador de alimentos', /\bprocessador\b/, 'processador de alimentos', 8],
  ['sanduicheira', 'Sanduicheira', /\bsanduicheira\b/, 'sanduicheira', 8],
  ['waffle', 'Máquina de waffle', /\b(maquina|forma) de waffle\b/, 'máquina de waffle', 8],
  ['cuscuzeira', 'Cuscuzeira', /\bcuscuzeira\b/, 'cuscuzeira', 8],
  ['grill', 'Grill elétrico', /\bgrill\b/, 'grill elétrico', 7],
  ['wok', 'Wok', /\bwok\b/, 'panela wok', 7],
  ['forma-pudim', 'Forma de pudim', /\bforma (de pudim|com furo( no meio| central)?|de buraco)\b/, 'forma de pudim', 7],
  ['forma-muffin', 'Forma de muffin', /\bforma(s|inhas?)? (de )?(muffins?|cupcakes?|empadas?)\b/, 'forma de muffin', 7],
  ['forma-gelo', 'Forma de gelo', /\bforma(s)? de gelo\b/, 'forma de gelo silicone', 6],
  ['forma-bolo-ingles', 'Forma de bolo inglês', /\bforma (de bolo ingles|de pao|retangular pequena)\b/, 'forma de bolo inglês', 7],
  ['aro', 'Aro de confeitaria', /\baro (de )?(inox|confeitaria|modelador)\b/, 'aro de confeitaria', 6],
  ['saco-confeitar', 'Saco e bicos de confeitar', /\b(saco|manga) de confeit(ar|eiro)|\bbico de confeitar\b/, 'saco de confeitar com bicos', 7],
  ['termometro', 'Termômetro culinário', /\btermometro\b/, 'termômetro culinário', 7],
  ['balanca', 'Balança de cozinha', /\bbalanca\b/, 'balança de cozinha digital', 6],
  ['medidores', 'Xícaras e colheres medidoras', /\b(xicaras?|colher(es)?) medidora/, 'kit medidores de cozinha', 5],
  ['rolo', 'Rolo de massa', /\brolo (de massa|de macarrao)\b|\bcom (a ajuda de )?um rolo\b/, 'rolo de massa', 6],
  ['fouet', 'Fouet (batedor de arame)', /\b(fouet|batedor (de arame|manual))\b/, 'fouet batedor de arame', 6],
  ['espatula', 'Espátula de silicone', /\bespatula\b/, 'espátula de silicone', 5],
  ['peneira', 'Peneira', /\b(peneir(a|e|ado)|coador)\b/, 'peneira inox', 5],
  ['ralador', 'Ralador', /\b(ralador|rale)\b/, 'ralador inox', 4],
  ['mandoline', 'Fatiador (mandoline)', /\bmandolin[ae]|fatiador\b/, 'fatiador mandoline', 6],
  ['espremedor', 'Espremedor', /\bespremedor\b/, 'espremedor de alho', 5],
  ['pilao', 'Pilão', /\bpilao\b/, 'pilão', 6],
  ['frigideira', 'Frigideira antiaderente', /\bfrigideira\b/, 'frigideira antiaderente', 5],
  ['refratario', 'Refratário', /\b(refratario|travessa)\b/, 'refratário de vidro', 4],
  ['assadeira', 'Assadeira', /\bassadeira\b/, 'assadeira antiaderente', 4],
  ['forma', 'Forma', /\b(uma|a|na|numa|da|em|à|duas|as|nas) formas?\b(?! (que|homogenea|uniforme|geral|rapida|delicada|suave|lenta|correta|cuidadosa|de (preparo|servir|consumo)))/, 'forma de bolo', 3],
  ['tabua', 'Tábua de corte', /\btabua\b/, 'tábua de corte', 3],
  ['papel-manteiga', 'Papel manteiga', /\bpapel manteiga\b/, 'papel manteiga', 3],
  ['tapete-silicone', 'Tapete de silicone', /\btapete de silicone\b/, 'tapete de silicone culinário', 5],
  ['panela', 'Jogo de panelas', /\bpanela\b/, 'jogo de panelas antiaderente', 1],
  ['tigela', 'Tigelas (bowls)', /\b(tigela|bowl|vasilha)\b/, 'tigela inox bowl', 1],
];
const BY_KEY = new Map(LIST.map(([key, label, re, query, prio]) => [key, { key, label, re, query, prio }]));

const norm = (s) => u.stripAccents(String(s || '')).toLowerCase().replace(/\s+/g, ' ');

/** Tamanho da forma: "forma redonda de 25 cm", "forma 20x30", "assadeira de 30 x 40 cm". */
function formaSize(text) {
  const m = text.match(/\b(forma|assadeira)( (redonda|quadrada|retangular|media|grande|pequena|untada|com furo))?( de| com)?( aproximadamente| cerca de)? (\d{2})( ?x ?(\d{2}))? ?(cm|centimetros)?\b/);
  if (!m || (!m[9] && !m[8])) return null; // precisa de "cm" ou "20x30" para não confundir com quantidades
  const kind = m[1] === 'assadeira' ? 'assadeira' : 'forma';
  return { base: kind, size: m[8] ? `${m[6]}x${m[8]}` : m[6] };
}

/** Utensílios citados em um texto (mais específicos primeiro). */
function detectText(raw, max = 6) {
  const text = norm(raw);
  const found = [];
  for (const it of BY_KEY.values()) if (it.re.test(text)) found.push({ ...it });
  // Quando já há uma forma específica (pudim, muffin…), a genérica sobra
  const keys = new Set(found.map((f) => f.key));
  let out = found.filter((f) => !(f.key === 'forma' && [...keys].some((k) => k.startsWith('forma-'))) && !(f.key === 'panela' && (keys.has('panela-pressao') || keys.has('panela-arroz'))));
  const size = formaSize(text);
  if (size) {
    out = out.map((f) => (f.key === size.base ? { ...f, key: `${size.base}:${size.size}`, label: `${f.label} ${size.size.replace('x', ' × ')} cm`, query: `${f.query} ${size.size.replace('x', ' x ')} cm` } : f));
  }
  return out.sort((a, b) => b.prio - a.prio).slice(0, max).map(({ key, label, query }) => ({ key, label, query }));
}

/** Utensílios da receita: modo de preparo + ingredientes + dicas. */
function detect(r, max = 6) {
  const steps = (r.steps || []).map((s) => (typeof s === 'string' ? s : s.text)).join(' \n ');
  const ings = (r.ingredients || []).map((i) => (typeof i === 'string' ? i : `${i.name || ''} ${i.note || ''}`)).join(' \n ');
  return detectText(`${steps} \n ${ings} \n ${r.tips || ''}`, max);
}

/** Melhor palpite de utensílio para um produto (pelo título). */
function guess(title) {
  const key = detectText(`na ${title}`, 1)[0]?.key || '';
  if (key !== 'forma' && key !== 'assadeira') return key;
  const m = norm(title).match(/\b(\d{2})( ?x ?(\d{2}))? ?cm\b/); // títulos: "Forma Redonda Antiaderente 25cm"
  return m ? `${key}:${m[3] ? `${m[1]}x${m[3]}` : m[1]}` : key;
}

const baseKey = (key) => String(key || '').split(':')[0];
const label = (key) => {
  const [b, size] = String(key || '').split(':');
  const it = BY_KEY.get(b);
  return it ? `${it.label}${size ? ` ${size.replace('x', ' × ')} cm` : ''}` : '';
};
const options = () => LIST.map(([key, lbl]) => ({ key, label: lbl }));

module.exports = { detect, detectText, guess, baseKey, label, options, BY_KEY };
