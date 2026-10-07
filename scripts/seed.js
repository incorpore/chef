'use strict';
/* Popula o banco com categorias e receitas de exemplo. Uso: npm run seed */
const db = require('../src/db');
const recipes = require('../src/recipes');
const u = require('../src/util');

db.open();
const d = db.get();

const CATS = [
  ['Bolos e tortas', '🍰'], ['Doces e sobremesas', '🍮'], ['Massas', '🍝'], ['Carnes', '🥩'], ['Aves', '🍗'],
  ['Peixes', '🐟'], ['Vegetariano', '🥗'], ['Pães', '🍞'], ['Lanches', '🥪'], ['Bebidas', '🥤'], ['Café da manhã', '☕'], ['Sopas', '🍲'],
];
CATS.forEach(([name, icon], i) => d.prepare('INSERT OR IGNORE INTO categories (name, slug, icon, position) VALUES (?, ?, ?, ?)').run(name, u.slugify(name), icon, i));
const cat = (name) => d.prepare('SELECT id FROM categories WHERE slug = ?').get(u.slugify(name)).id;

const SAMPLES = [
  {
    code: 'BOLO01',
    title: 'Bolo de cenoura com cobertura de chocolate',
    description: 'Fofinho, alaranjado e com aquela casquinha de chocolate que todo mundo ama.',
    story: 'Essa é **a** receita da minha avó. Toda tarde de domingo tinha esse bolo na mesa, ainda morno.\n\nO segredo é bater bem a cenoura com os líquidos no liquidificador — isso deixa a massa super fofa.',
    cover: 'https://images.unsplash.com/photo-1621303837174-89787a7d4729?w=1200&q=80',
    category: 'Bolos e tortas',
    ingredients: '## Massa\n3 cenouras médias picadas\n3 ovos\n1 xícara (chá) de óleo\n2 xícaras (chá) de açúcar\n2 ½ xícaras (chá) de farinha de trigo\n1 colher (sopa) de fermento em pó\n## Cobertura\n1 lata de leite condensado\n1 colher (sopa) de manteiga\n4 colheres (sopa) de chocolate em pó',
    steps: '## Massa\nPreaqueça o forno a 180 °C e unte uma forma com manteiga e farinha.\nNo liquidificador, bata a cenoura, os ovos e o óleo por 3 minutos.\nDespeje em uma tigela, junte o açúcar e a farinha de trigo e misture bem.\nAcrescente o fermento delicadamente.\nAsse por 40 minutos ou até que um palito saia limpo.\n## Cobertura\nEm uma panela, leve o leite condensado, a manteiga e o chocolate em pó ao fogo baixo.\nMexa sem parar por 8 minutos, até engrossar.\nEspalhe sobre o bolo ainda morno.',
    tips: '- Use cenouras bem laranjas para uma cor mais bonita\n- O bolo pode ser congelado por até 2 meses',
    prep_minutes: 20, cook_minutes: 50, servings: 12, servings_unit: 'fatias', difficulty: 1, cuisine: 'Brasileira',
    tags: ['bolo', 'café da tarde', 'chocolate'], diets: ['vegetariana'], featured: true,
    nutrition: { calories: '320 kcal', carbs: '45 g', protein: '5 g', fat: '14 g' },
  },
  {
    code: 'BRIG01',
    title: 'Brigadeiro de panela',
    description: 'O doce mais brasileiro de todos, pronto em 15 minutos.',
    cover: 'https://images.unsplash.com/photo-1541783245831-57d6fb0926d3?w=1200&q=80',
    category: 'Doces e sobremesas',
    ingredients: '1 lata de leite condensado\n1 colher (sopa) de manteiga\n3 colheres (sopa) de chocolate em pó\nChocolate granulado para enrolar',
    steps: 'Coloque o leite condensado, a manteiga e o chocolate em pó em uma panela.\nLeve ao fogo baixo mexendo sempre por 10 minutos, até desgrudar do fundo.\nTransfira para um prato untado e deixe esfriar por 30 minutos.\nUnte as mãos, enrole bolinhas e passe no granulado.',
    prep_minutes: 5, cook_minutes: 10, rest_minutes: 30, servings: 20, servings_unit: 'unidades', difficulty: 1, cuisine: 'Brasileira',
    tags: ['doce', 'festa', 'chocolate'], diets: ['vegetariana', 'sem glúten'], featured: true,
  },
  {
    code: 'CARB01',
    title: 'Espaguete à carbonara',
    description: 'A clássica receita romana: cremosa sem creme de leite.',
    cover: 'https://images.unsplash.com/photo-1612874742237-6526221588e3?w=1200&q=80',
    category: 'Massas',
    ingredients: '400 g de espaguete\n150 g de bacon em cubos\n4 gemas\n1 ovo\n80 g de queijo parmesão ralado\nPimenta-do-reino moída na hora\nSal a gosto',
    steps: 'Cozinhe o espaguete em água fervente com sal por 9 minutos, até ficar al dente.\nEnquanto isso, doure o bacon em uma frigideira por 6 minutos.\nEm uma tigela, misture as gemas, o ovo, o parmesão e bastante pimenta.\nReserve 1 xícara da água do cozimento e escorra a massa.\nFora do fogo, junte a massa ao bacon e adicione a mistura de ovos, mexendo rápido.\nAjuste a cremosidade com a água do cozimento e sirva imediatamente.',
    prep_minutes: 10, cook_minutes: 15, servings: 4, difficulty: 2, cuisine: 'Italiana',
    tags: ['massa', 'jantar', 'rápida'],
  },
  {
    code: 'FRAN01',
    title: 'Frango assado com batatas e alecrim',
    description: 'Um jantar completo em uma assadeira só.',
    cover: 'https://images.unsplash.com/photo-1598103442097-8b74394b95c6?w=1200&q=80',
    category: 'Aves',
    ingredients: '1 kg de coxa e sobrecoxa de frango\n800 g de batata em pedaços\n4 dentes de alho amassados\n3 ramos de alecrim\n4 colheres (sopa) de azeite\nSuco de 1 limão\nSal e pimenta a gosto',
    steps: 'Tempere o frango com alho, limão, sal e pimenta e deixe marinar por 30 minutos.\nPreaqueça o forno a 200 °C.\nDisponha o frango e as batatas em uma assadeira, regue com azeite e espalhe o alecrim.\nCubra com papel-alumínio e asse por 40 minutos.\nRetire o papel e asse por mais 25 minutos, até dourar.',
    prep_minutes: 15, cook_minutes: 65, rest_minutes: 30, servings: 4, difficulty: 1, cuisine: 'Brasileira',
    tags: ['frango', 'almoço de domingo', 'forno'], diets: ['sem glúten', 'sem lactose'],
  },
  {
    code: 'PAO01',
    title: 'Pão de queijo mineiro',
    description: 'Crocante por fora, puxa-puxa por dentro.',
    cover: 'https://images.unsplash.com/photo-1598142982901-df6cec8901cd?w=1200&q=80',
    category: 'Café da manhã',
    ingredients: '500 g de polvilho azedo\n1 xícara (chá) de leite\n½ xícara (chá) de óleo\n1 colher (chá) de sal\n2 ovos\n200 g de queijo meia cura ralado',
    steps: 'Ferva o leite com o óleo e o sal.\nEscalde o polvilho com a mistura quente e mexa até formar uma farofa.\nDeixe amornar por 10 minutos e acrescente os ovos um a um.\nJunte o queijo e sove até a massa ficar lisa.\nFaça bolinhas e asse em forno preaquecido a 200 °C por 25 minutos.',
    prep_minutes: 25, cook_minutes: 25, servings: 30, servings_unit: 'unidades', difficulty: 2, cuisine: 'Mineira',
    tags: ['pão de queijo', 'lanche', 'café da manhã'], diets: ['vegetariana', 'sem glúten'],
  },
  {
    code: 'SALA01',
    title: 'Salada de grão-de-bico com legumes',
    description: 'Refrescante, nutritiva e pronta em 10 minutos.',
    cover: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=1200&q=80',
    category: 'Vegetariano',
    ingredients: '2 xícaras (chá) de grão-de-bico cozido\n1 pepino em cubos\n2 tomates em cubos\n½ cebola roxa picada\nSalsinha a gosto\n3 colheres (sopa) de azeite\nSuco de 1 limão\nSal a gosto',
    steps: 'Em uma tigela, junte o grão-de-bico, o pepino, os tomates e a cebola.\nTempere com azeite, limão, sal e salsinha.\nLeve à geladeira por 15 minutos antes de servir.',
    prep_minutes: 10, rest_minutes: 15, servings: 4, difficulty: 1,
    tags: ['salada', 'saudável', 'rápida'], diets: ['vegana', 'vegetariana', 'sem glúten', 'sem lactose'],
  },
];

for (const s of SAMPLES) {
  if (recipes.getByCode(s.code)) continue;
  const { category, ...rest } = s;
  recipes.create({ ...rest, category_id: cat(category), status: 'published' });
  console.log(`+ ${s.title} (#${s.code})`);
}

if (!d.prepare('SELECT 1 FROM products LIMIT 1').get()) {
  d.prepare("INSERT INTO products (title, asin, image, price, description, badge, keywords) VALUES ('Batedeira planetária 600W', 'B0EXEMPLO1', '', 'R$ 399,00', 'Ideal para bolos e massas', 'Mais vendido', '')").run();
  d.prepare("INSERT INTO products (title, asin, image, price, description, badge, keywords) VALUES ('Cacau em pó 100% — 200 g', 'B0EXEMPLO2', '', 'R$ 29,90', 'Sem açúcar, para receitas', '', 'chocolate em pó, cacau')").run();
  console.log('+ produtos de exemplo (substitua pelos seus ASINs)');
}

console.log('Pronto!');
db.close();
