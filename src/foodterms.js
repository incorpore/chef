'use strict';
/**
 * Tradução de nomes de receitas para inglês, para buscar fotos nos bancos de imagens (Pexels/Pixabay
 * descrevem as fotos em inglês: buscar em português traz fotos que não têm nada a ver).
 * 1) Pratos conhecidos (frases) têm a busca certa pronta ("pão de queijo" → "brazilian cheese bread").
 * 2) Senão, traduz palavra a palavra os termos de culinária e monta "tipo do prato + ingrediente principal".
 * Também devolve as palavras-chave usadas para dar nota às fotos (descrição/etiquetas da foto).
 */
const u = require('./util');

const norm = (s) => u.stripAccents(String(s || '')).toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();

// Pratos e expressões (mais específicas primeiro). Valor: [busca, palavras que a foto precisa mencionar]
const DISHES = [
  ['moqueca de banana', 'plantain stew', ['plantain', 'stew']],
  ['chocolate quente', 'hot chocolate', ['hot chocolate', 'cocoa']],
  ['cafe gelado', 'iced coffee', ['iced', 'coffee']],
  ['torta holandesa', 'dutch chocolate pie', ['pie', 'chocolate']],
  ['torta salgada', 'savory pie', ['pie']],
  ['frango xadrez', 'kung pao chicken', ['chicken', 'stir']],
  ['frango assado', 'roast chicken', ['chicken', 'roast']],
  ['polpetone', 'stuffed meatloaf', ['meatloaf', 'meat']],
  ['chili com carne', 'chili con carne', ['chili']],
  ['biscoito de polvilho', 'cassava biscuits', ['biscuit', 'snack']],
  ['bolinho de chuva', 'donut holes cinnamon sugar', ['donut', 'doughnut', 'fritter']],
  ['dadinho de tapioca', 'tapioca cheese cubes', ['tapioca', 'cube']],
  ['mingau', 'porridge', ['porridge', 'oat']],
  ['morango do amor', 'chocolate covered strawberries', ['strawberr']],
  ['uva do amor', 'candied grapes', ['grape']],
  ['maca do amor', 'candy apple', ['apple']],
  ['pao de queijo', 'brazilian cheese bread', ['cheese', 'bread', 'bun', 'ball']],
  ['pao de mel', 'honey gingerbread cake chocolate', ['gingerbread', 'honey', 'cake']],
  ['pao de lo', 'sponge cake', ['sponge', 'cake']],
  ['pao frances', 'french bread rolls', ['bread', 'roll']],
  ['pao de alho', 'garlic bread', ['garlic', 'bread']],
  ['pao de forma', 'sandwich bread loaf', ['bread', 'loaf']],
  ['pao sirio', 'pita bread', ['pita', 'bread']],
  ['pao de hamburguer', 'burger buns', ['bun', 'burger']],
  ['bolo de rolo', 'swiss roll cake', ['roll', 'cake']],
  ['bolo de pote', 'cake in a jar', ['jar', 'cake']],
  ['bolo de caneca', 'mug cake', ['mug', 'cake']],
  ['bolo formigueiro', 'chocolate sprinkles cake', ['cake', 'sprinkle']],
  ['nega maluca', 'chocolate cake', ['chocolate', 'cake']],
  ['red velvet', 'red velvet cake', ['velvet', 'cake']],
  ['petit gateau', 'chocolate lava cake', ['lava', 'chocolate', 'cake']],
  ['brigadeirao', 'chocolate pudding', ['chocolate', 'pudding']],
  ['brigadeiro', 'brigadeiro chocolate truffles', ['chocolate', 'truffle', 'brigadeiro', 'ball']],
  ['beijinho', 'coconut truffles', ['coconut', 'truffle', 'ball']],
  ['cajuzinho', 'peanut truffles', ['peanut', 'truffle']],
  ['quindim', 'coconut custard', ['custard', 'coconut', 'yellow']],
  ['pudim de leite', 'flan caramel custard', ['flan', 'custard', 'caramel', 'pudding']],
  ['pudim', 'flan caramel pudding', ['flan', 'pudding', 'caramel', 'custard']],
  ['manjar', 'coconut pudding', ['pudding', 'coconut']],
  ['pave', 'trifle dessert layers', ['trifle', 'dessert', 'layer']],
  ['mousse', 'mousse dessert', ['mousse', 'dessert']],
  ['cocada', 'coconut candy', ['coconut']],
  ['pe de moleque', 'peanut brittle', ['peanut', 'brittle']],
  ['pacoca', 'peanut candy', ['peanut']],
  ['romeu e julieta', 'cheese with guava paste', ['cheese', 'guava']],
  ['goiabada', 'guava paste', ['guava']],
  ['doce de leite', 'dulce de leche', ['dulce', 'caramel']],
  ['arroz doce', 'rice pudding', ['rice', 'pudding']],
  ['arroz-doce', 'rice pudding', ['rice', 'pudding']],
  ['canjica', 'hominy corn pudding', ['corn', 'pudding', 'hominy']],
  ['curau', 'sweet corn pudding', ['corn', 'pudding']],
  ['pamonha', 'tamales corn husk', ['corn', 'tamale', 'husk']],
  ['churros', 'churros', ['churro']],
  ['sonho', 'cream filled donut', ['donut', 'doughnut']],
  ['banoffee', 'banoffee pie', ['banoffee', 'banana', 'pie']],
  ['cheesecake', 'cheesecake', ['cheesecake']],
  ['brownie', 'chocolate brownies', ['brownie']],
  ['cookies', 'chocolate chip cookies', ['cookie']],
  ['dalgona', 'dalgona honeycomb candy', ['dalgona', 'candy', 'honeycomb']],
  ['ovo de pascoa', 'chocolate easter egg', ['easter', 'egg', 'chocolate']],
  ['ovo de colher', 'chocolate easter egg', ['easter', 'egg', 'chocolate']],
  ['trufa', 'chocolate truffles', ['truffle', 'chocolate']],
  ['bombom', 'chocolate bonbons', ['chocolate', 'bonbon', 'praline']],
  ['palha italiana', 'chocolate fudge squares', ['chocolate', 'fudge']],
  ['rabanada', 'french toast', ['french toast', 'toast']],
  ['panettone', 'panettone', ['panettone']],
  ['chocotone', 'chocolate panettone', ['panettone']],
  ['feijoada', 'feijoada black bean stew', ['bean', 'stew', 'feijoada']],
  ['feijao tropeiro', 'beans with bacon and cassava flour', ['bean']],
  ['tutu de feijao', 'mashed beans', ['bean']],
  ['baiao de dois', 'rice and beans', ['rice', 'bean']],
  ['arroz carreteiro', 'rice with beef', ['rice', 'beef', 'meat']],
  ['arroz a grega', 'rice with vegetables', ['rice']],
  ['galinhada', 'chicken rice', ['chicken', 'rice']],
  ['risoto', 'risotto', ['risotto']],
  ['paella', 'paella', ['paella']],
  ['moqueca', 'fish stew moqueca', ['stew', 'fish', 'moqueca']],
  ['bobo de camarao', 'shrimp stew', ['shrimp', 'stew']],
  ['vatapa', 'shrimp stew', ['shrimp', 'stew']],
  ['acaraje', 'acaraje fritters', ['fritter', 'acaraje']],
  ['bacalhoada', 'cod fish potatoes', ['cod', 'fish']],
  ['bacalhau', 'cod fish', ['cod', 'fish']],
  ['bolinho de bacalhau', 'cod fritters', ['cod', 'fritter', 'croquette']],
  ['escondidinho', 'cottage pie casserole', ['casserole', 'pie']],
  ['estrogonofe', 'stroganoff', ['stroganoff']],
  ['strogonoff', 'stroganoff', ['stroganoff']],
  ['picadinho', 'beef stew', ['beef', 'stew']],
  ['cozido', 'brazilian beef stew with vegetables', ['stew', 'beef']],
  ['carne de panela', 'pot roast beef', ['beef', 'roast', 'meat']],
  ['carne de sol', 'dried beef', ['beef', 'meat']],
  ['carne seca', 'dried beef', ['beef', 'meat']],
  ['vaca atolada', 'beef ribs stew with cassava', ['beef', 'rib', 'stew']],
  ['rabada', 'oxtail stew', ['oxtail', 'stew']],
  ['dobradinha', 'tripe stew', ['tripe', 'stew']],
  ['bife a parmegiana', 'beef parmigiana', ['parmigiana', 'parmesan']],
  ['frango a parmegiana', 'chicken parmigiana', ['chicken', 'parmigiana', 'parmesan']],
  ['parmegiana', 'parmigiana', ['parmigiana', 'parmesan']],
  ['bife acebolado', 'steak with onions', ['steak', 'onion']],
  ['bife role', 'beef rolls', ['beef', 'roll']],
  ['kafta', 'kofta kebab', ['kofta', 'kebab']],
  ['kibe', 'kibbeh', ['kibbeh']],
  ['quibe', 'kibbeh', ['kibbeh']],
  ['esfiha', 'sfiha meat pie', ['pie', 'flatbread', 'sfiha']],
  ['coxinha', 'coxinha brazilian chicken croquette', ['croquette', 'coxinha', 'fried']],
  ['pastel', 'pastel fried pastry', ['pastry', 'fried', 'pastel', 'empanada']],
  ['empada', 'savory pie', ['pie', 'pastry']],
  ['empadao', 'chicken pot pie', ['pie']],
  ['risoles', 'croquettes', ['croquette']],
  ['croquete', 'croquettes', ['croquette']],
  ['enroladinho', 'pigs in a blanket', ['sausage', 'roll', 'pastry']],
  ['cachorro quente', 'hot dog', ['hot dog', 'hotdog', 'sausage']],
  ['cachorro-quente', 'hot dog', ['hot dog', 'hotdog', 'sausage']],
  ['misto quente', 'grilled ham and cheese sandwich', ['sandwich', 'toast']],
  ['misto-quente', 'grilled ham and cheese sandwich', ['sandwich', 'toast']],
  ['x-tudo', 'cheeseburger', ['burger']],
  ['bauru', 'roast beef sandwich', ['sandwich']],
  ['calzone', 'calzone', ['calzone']],
  ['pizza', 'pizza', ['pizza']],
  ['lasanha', 'lasagna', ['lasagna', 'lasagne']],
  ['nhoque', 'gnocchi', ['gnocchi']],
  ['canelone', 'cannelloni', ['cannelloni']],
  ['rondelli', 'pasta rolls', ['pasta']],
  ['capeletti', 'cappelletti soup', ['pasta', 'soup']],
  ['ravioli', 'ravioli', ['ravioli']],
  ['yakissoba', 'yakisoba noodles', ['noodle']],
  ['macarrao', 'pasta', ['pasta', 'spaghetti', 'noodle', 'macaroni']],
  ['espaguete', 'spaghetti', ['spaghetti', 'pasta']],
  ['talharim', 'tagliatelle', ['tagliatelle', 'pasta']],
  ['fettuccine', 'fettuccine', ['fettuccine', 'pasta']],
  ['mac and cheese', 'mac and cheese', ['macaroni', 'cheese']],
  ['tapioca', 'tapioca crepe', ['tapioca', 'crepe']],
  ['crepioca', 'tapioca crepe', ['crepe']],
  ['cuscuz', 'couscous', ['couscous']],
  ['polenta', 'polenta', ['polenta']],
  ['farofa', 'toasted cassava flour', ['cassava', 'flour']],
  ['vinagrete', 'pico de gallo', ['salsa', 'tomato', 'pico']],
  ['caldo verde', 'kale potato soup', ['soup', 'kale']],
  ['canja', 'chicken rice soup', ['soup', 'chicken']],
  ['caipirinha', 'caipirinha cocktail lime', ['caipirinha', 'cocktail', 'lime']],
  ['quentao', 'mulled wine ginger', ['mulled', 'wine', 'drink']],
  ['vinho quente', 'mulled wine', ['mulled', 'wine']],
  ['limonada suica', 'brazilian lemonade', ['lemonade', 'lime']],
  ['suco verde', 'green smoothie', ['green', 'smoothie', 'juice']],
  ['vitamina', 'smoothie', ['smoothie']],
  ['milkshake', 'milkshake', ['milkshake']],
  ['gemada', 'eggnog', ['eggnog']],
  ['sangria', 'sangria', ['sangria']],
  ['torresmo', 'pork cracklings', ['pork', 'crackling', 'rind']],
  ['tender', 'glazed ham', ['ham']],
  ['pernil', 'roast pork leg', ['pork', 'roast']],
  ['lombo', 'roast pork loin', ['pork', 'loin', 'roast']],
  ['salpicao', 'chicken salad', ['chicken', 'salad']],
  ['maionese de batata', 'potato salad', ['potato', 'salad']],
  ['salada de maionese', 'potato salad', ['potato', 'salad']],
  ['pure de batata', 'mashed potatoes', ['mashed', 'potato']],
  ['batata frita', 'french fries', ['fries', 'french fries']],
  ['batata rustica', 'roasted potatoes', ['potato', 'roast']],
  ['mandioca frita', 'fried cassava', ['cassava', 'yuca', 'fries']],
  ['falafel', 'falafel', ['falafel']],
  ['hommus', 'hummus', ['hummus']],
  ['tabule', 'tabbouleh', ['tabbouleh', 'salad']],
  ['ratatouille', 'ratatouille', ['ratatouille']],
  ['ceviche', 'ceviche', ['ceviche']],
  ['overnight oats', 'overnight oats', ['oat']],
  ['granola', 'granola', ['granola']],
  ['panqueca americana', 'pancakes', ['pancake']],
  ['waffle', 'waffles', ['waffle']],
  ['omelete', 'omelette', ['omelette', 'omelet']],
  ['ovos mexidos', 'scrambled eggs', ['scrambled', 'egg']],
  ['quiche', 'quiche', ['quiche']],
  ['focaccia', 'focaccia', ['focaccia']],
  ['chipa', 'cheese bread', ['cheese', 'bread']],
  ['broa', 'corn bread', ['corn', 'bread']],
];

// Palavras soltas. Os "tipos de prato" (DISH_WORDS) vão primeiro na busca e valem mais na nota.
const WORDS = {
  bolo: 'cake', bolos: 'cake', torta: 'pie', tortas: 'pie', cuca: 'crumb cake', rocambole: 'swiss roll', pao: 'bread', paes: 'bread', rosca: 'braided bread',
  sopa: 'soup', caldo: 'broth soup', creme: 'cream soup', salada: 'salad', sanduiche: 'sandwich', hamburguer: 'burger', panqueca: 'pancake', biscoito: 'cookies',
  bolinho: 'fritters', bolinhos: 'fritters', suco: 'juice', cha: 'tea', cafe: 'coffee', cappuccino: 'cappuccino', drink: 'cocktail', batida: 'cocktail', sorvete: 'ice cream', picole: 'popsicle',
  gelatina: 'jelly', doce: 'dessert', geleia: 'jam', molho: 'sauce', assado: 'roasted', assada: 'roasted', frito: 'fried', frita: 'fried', grelhado: 'grilled', grelhada: 'grilled',
  ensopado: 'stew', cozido: 'boiled', cozida: 'boiled', refogado: 'sauteed', refogada: 'sauteed', gratinado: 'gratin', gratinada: 'gratin', empanado: 'breaded', empanada: 'breaded', recheado: 'stuffed', recheada: 'stuffed',
  frango: 'chicken', galinha: 'chicken', peru: 'turkey', chester: 'roast turkey', carne: 'beef', bife: 'steak', picanha: 'picanha steak', costela: 'ribs', cupim: 'beef brisket', maminha: 'beef roast',
  fraldinha: 'flank steak', porco: 'pork', bisteca: 'pork chop', costelinha: 'pork ribs', linguica: 'sausage', salsicha: 'sausage', bacon: 'bacon', presunto: 'ham', figado: 'liver', lingua: 'beef tongue', moela: 'chicken gizzards',
  peixe: 'fish', tilapia: 'tilapia fish', salmao: 'salmon', sardinha: 'sardines', atum: 'tuna', camarao: 'shrimp', lula: 'squid', polvo: 'octopus', siri: 'crab', merluza: 'hake fish', pescada: 'fish',
  arroz: 'rice', feijao: 'beans', lentilha: 'lentils', grao: 'chickpeas', ervilha: 'peas', milho: 'corn', batata: 'potato', mandioca: 'cassava', aipim: 'cassava', mandioquinha: 'parsnip', abobora: 'pumpkin',
  abobrinha: 'zucchini', berinjela: 'eggplant', brocolis: 'broccoli', couve: 'kale', 'couve-flor': 'cauliflower', cenoura: 'carrot', tomate: 'tomato', cebola: 'onion', alho: 'garlic', cogumelo: 'mushroom', cogumelos: 'mushrooms',
  palmito: 'hearts of palm', espinafre: 'spinach', legumes: 'vegetables', quinoa: 'quinoa', aveia: 'oats', ovo: 'egg', ovos: 'eggs', queijo: 'cheese', requeijao: 'cream cheese', iogurte: 'yogurt', leite: 'milk',
  chocolate: 'chocolate', morango: 'strawberry', morangos: 'strawberries', banana: 'banana', maca: 'apple', laranja: 'orange', limao: 'lemon', maracuja: 'passion fruit', abacaxi: 'pineapple', coco: 'coconut', uva: 'grape',
  manga: 'mango', goiaba: 'guava', amendoim: 'peanut', nozes: 'walnut', canela: 'cinnamon', mel: 'honey', fuba: 'cornmeal', tapioca: 'tapioca', pipoca: 'popcorn',
  carbonara: 'carbonara', bolonhesa: 'bolognese', pesto: 'pesto', putanesca: 'puttanesca', alfredo: 'alfredo', acebolada: 'onions', acebolado: 'onions',
  'batata-doce': 'sweet potato', 'grao-de-bico': 'chickpea', 'banana-da-terra': 'plantain', pinhao: 'pine nuts', gengibre: 'ginger', manjericao: 'basil',
  natal: 'christmas', pascoa: 'easter', junina: 'festival', 'air fryer': 'air fryer',
};
const DISH_WORDS = new Set(['cake', 'pie', 'crumb cake', 'swiss roll', 'bread', 'braided bread', 'soup', 'broth soup', 'cream soup', 'salad', 'sandwich', 'burger', 'pancake', 'cookies', 'fritters', 'juice', 'tea', 'coffee', 'cappuccino', 'cocktail', 'ice cream', 'popsicle', 'jelly', 'dessert', 'jam', 'stew', 'sauce']);
const STYLE_WORDS = new Set(['boiled', 'roasted', 'fried', 'grilled', 'sauteed', 'gratin', 'breaded', 'stuffed', 'christmas', 'easter', 'festival', 'air fryer']);

/**
 * "Bolo de cenoura com cobertura de chocolate" → { query: 'carrot cake chocolate', keywords: ['cake','carrot','chocolate'] }
 */
function translate(title) {
  // Tira conectivos soltos ("de", "com"...), mas não dentro de palavras com hífen (grão-de-bico)
  const t = ` ${norm(title).replace(/(?<![\w-])(com|de|da|do|das|dos|e|na|no|ao|a|em)(?![\w-])/g, ' ').replace(/\s+/g, ' ')} `;
  const full = ` ${norm(title)} `;
  for (const [pt, query, keywords] of DISHES) {
    if (full.includes(` ${pt} `) || full.includes(` ${pt}-`) || t.includes(` ${pt} `)) {
      // Acrescenta um ingrediente marcante fora da expressão (ex.: "lasanha de frango" → "chicken lasagna")
      const rest = full.replace(` ${pt} `, ' ').split(' ').map((w) => WORDS[w]).filter((w) => w && !DISH_WORDS.has(w) && !STYLE_WORDS.has(w) && !query.includes(w));
      const extra = rest[0] ? `${rest[0]} ` : '';
      return { query: `${extra}${query}`.trim(), keywords: [...new Set([...keywords, ...(rest[0] ? [rest[0].split(' ')[0]] : [])])] };
    }
  }
  const words = t.trim().split(' ');
  const out = [];
  for (let i = 0; i < words.length; i++) {
    const two = `${words[i]} ${words[i + 1] || ''}`.trim();
    if (WORDS[two]) { out.push(WORDS[two]); i++; continue; }
    if (WORDS[words[i]]) out.push(WORDS[words[i]]);
  }
  const dish = out.filter((w) => DISH_WORDS.has(w));
  const ing = out.filter((w) => !DISH_WORDS.has(w) && !STYLE_WORDS.has(w));
  const style = out.filter((w) => STYLE_WORDS.has(w));
  // Em inglês o ingrediente vem antes do prato: "carrot cake", "chicken soup"
  const parts = [...new Set([...ing.slice(0, 2), ...dish.slice(0, 1), ...style.slice(0, 1)])];
  if (!parts.length) return { query: '', keywords: [] };
  const keywords = [...new Set([...dish.slice(0, 1), ...ing.slice(0, 2)].flatMap((w) => w.split(' ')).filter((w) => w.length > 2))];
  return { query: parts.join(' '), keywords };
}

/** Nota de relevância de uma foto: quantas palavras-chave aparecem na descrição/etiquetas (prato vale mais). */
function score(text, keywords) {
  const d = ` ${norm(text)} `;
  let n = 0;
  keywords.forEach((k, i) => { if (d.includes(k.length > 4 ? k.slice(0, k.length - 1) : ` ${k}`)) n += i === 0 ? 2 : 1; });
  return n;
}

module.exports = { translate, score };
