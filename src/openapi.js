'use strict';
/**
 * Especificação OpenAPI 3.1 de TODA a API /api/v1.
 * Cada rota é uma linha da tabela ROUTES; o teste test/api-docs.test.js falha se alguma rota do servidor
 * ficar fora daqui (ou se algo documentado não existir), então a documentação nunca fica desatualizada.
 *
 * Acesso (x-auth): public = qualquer um · user = logado ou chave de API (autor ou admin) · admin = só administradores.
 */

const S = {
  str: (description, extra = {}) => ({ type: 'string', ...(description ? { description } : {}), ...extra }),
  int: (description, extra = {}) => ({ type: 'integer', ...(description ? { description } : {}), ...extra }),
  num: (description) => ({ type: 'number', ...(description ? { description } : {}) }),
  bool: (description) => ({ type: 'boolean', ...(description ? { description } : {}) }),
  arr: (items, description) => ({ type: 'array', items, ...(description ? { description } : {}) }),
  obj: (properties, required, description) => ({ type: 'object', properties, ...(required ? { required } : {}), ...(description ? { description } : {}) }),
  ref: (name) => ({ $ref: `#/components/schemas/${name}` }),
};

const TAGS = [
  ['Sistema', 'Saúde do servidor e a própria documentação'],
  ['Autenticação', 'Login por cookie (painel) e perfil da conta. Integrações usam chave de API (Bearer).'],
  ['Receitas', 'Busca, leitura, criação e edição de receitas'],
  ['Interação', 'Votos, visualizações, "cozinhei" e comentários dos visitantes'],
  ['Comentários', 'Moderação de comentários (autor modera os das próprias receitas)'],
  ['Importação', 'Importar por URL, em lote (JSON) e exportar backup'],
  ['Arquivos', 'Fotos e vídeos enviados ao site'],
  ['Categorias e tags', 'Organização das receitas'],
  ['Afiliados', 'Produtos da Amazon, Shopee e Mercado Livre, utensílios e atualização automática'],
  ['Anúncios', 'Blocos de anúncio por posição da página'],
  ['Configurações', 'Configurações do site'],
  ['Newsletter', 'Inscrição, inscritos e campanhas por e-mail'],
  ['E-mail', 'Situação e teste do SMTP'],
  ['Fotos dos bancos', 'Fotos grátis (Pexels/Pixabay) para receitas sem imagem'],
  ['Google Search Console', 'Relatório do Google dentro do painel'],
  ['Usuários e chaves', 'Contas da equipe e chaves de API'],
  ['Estatísticas', 'Números do painel e auditoria'],
];

// Parâmetros reutilizáveis
const P = {
  ref: { name: 'ref', in: 'path', required: true, description: 'ID, código (ex.: K7M2QX) ou slug da receita', schema: S.str() },
  id: { name: 'id', in: 'path', required: true, description: 'ID numérico', schema: S.int() },
  code: { name: 'code', in: 'path', required: true, description: 'Código da receita (ex.: K7M2QX)', schema: S.str() },
  catRef: { name: 'ref', in: 'path', required: true, description: 'ID ou slug da categoria', schema: S.str() },
  q: (description = 'Texto da busca', required = false) => ({ name: 'q', in: 'query', required, description, schema: S.str() }),
  query: (name, description, schema = S.str()) => ({ name, in: 'query', description, schema }),
};

const RECIPE_QUERY = [
  P.q('Palavras-chave ou código'),
  P.query('code', 'Código exato'),
  P.query('category', 'Slug ou nome da categoria'),
  P.query('tag', 'Tag'),
  P.query('diet', 'Dieta (ex.: vegana, sem-gluten)'),
  P.query('maxTime', 'Tempo total máximo, em minutos', S.int()),
  P.query('difficulty', '1 fácil · 2 média · 3 difícil', S.int(null, { minimum: 1, maximum: 3 })),
  P.query('ingredients', 'O que tenho em casa: lista separada por vírgula (ex.: ovo,tomate)'),
  P.query('sort', 'Ordem', S.str(null, { enum: ['recent', 'popular', 'quick', 'rating', 'title'] })),
  P.query('featured', 'Só destaques (1)', S.str(null, { enum: ['1', 'true'] })),
  P.query('status', 'Logado: draft | published (padrão: todas que você pode ver)', S.str(null, { enum: ['draft', 'published'] })),
  P.query('mine', 'Logado: só as suas (1)', S.str(null, { enum: ['1'] })),
  P.query('page', 'Página (começa em 1)', S.int(null, { minimum: 1 })),
  P.query('perPage', 'Itens por página (máx. 100; também aceita "limit")', S.int(null, { minimum: 1, maximum: 100 })),
];

const schemas = {
  Error: S.obj({ error: S.str('Mensagem em português, pronta para mostrar') }, ['error']),
  Ok: S.obj({ ok: S.bool() }),
  RecipeInput: S.obj({
    title: S.str(null, { maxLength: 200 }),
    code: S.str('Código personalizado (opcional; gerado automaticamente)'),
    description: S.str(), story: S.str('Texto de blog (markdown simples)'),
    cover: S.str('URL da foto de capa (https:// ou /uploads/…)'), cover_credit: S.str('Crédito da foto'),
    images: S.arr({ oneOf: [S.str(), S.obj({ url: S.str(), caption: S.str() })] }),
    video: S.str('URL do YouTube, Vimeo, TikTok, Instagram ou arquivo enviado'),
    ingredients: { oneOf: [S.str('Um por linha; "## Grupo" cria seções'), S.arr({ oneOf: [S.str(), S.obj({ name: S.str(), qty: S.num(), unit: S.str(), note: S.str(), group: S.str() })] })] },
    steps: { oneOf: [S.str('Um passo por linha'), S.arr({ oneOf: [S.str(), S.obj({ text: S.str(), image: S.str(), timer: S.int('segundos'), group: S.str() })] })] },
    tips: S.str(),
    prep_minutes: S.int(), cook_minutes: S.int(), rest_minutes: S.int(),
    servings: S.num(), servings_unit: S.str('ex.: porções, fatias'),
    difficulty: S.int(null, { minimum: 1, maximum: 3 }),
    cuisine: S.str(), category: S.str('Nome da categoria (admin: criada se não existir)'), category_id: S.int(),
    tags: S.arr(S.str()), diets: S.arr(S.str()),
    nutrition: { type: 'object', additionalProperties: S.str(), description: 'ex.: {"calorias":"320 kcal"}' },
    products: S.arr(S.int(), 'IDs de produtos de afiliado'),
    status: S.str(null, { enum: ['draft', 'published'] }), featured: S.bool('Só administradores'),
    seo_title: S.str(), seo_description: S.str(), source_url: S.str(), source_name: S.str(),
  }, ['title']),
  Recipe: { type: 'object', description: 'Receita completa (mesmos campos de RecipeInput + id, slug, url, author, rating, views, likes, datas…)', additionalProperties: true },
  RecipePage: S.obj({ items: S.arr(S.ref('Recipe')), total: S.int(), page: S.int(), pages: S.int(), exactCode: { oneOf: [S.ref('Recipe'), { type: 'null' }] } }),
  Category: S.obj({ id: S.int(), name: S.str(), slug: S.str(), icon: S.str(), description: S.str(), position: S.int(), count: S.int('Receitas publicadas') }),
  CategoryInput: S.obj({ name: S.str(), slug: S.str(), icon: S.str('Emoji'), description: S.str(), position: S.int() }, ['name']),
  Product: { type: 'object', additionalProperties: true, description: 'Produto: id, title, store (amazon|shopee|mercadolivre|outra), url, aff_url, image, price, utensil, category, active, available, clicks, refreshed_at, refresh_error…' },
  ProductInput: S.obj({
    title: S.str(), store: S.str(null, { enum: ['amazon', 'shopee', 'mercadolivre', 'outra'] }), url: S.str('Link do produto (https)'), asin: S.str('Amazon'),
    aff_url: S.str('Link de afiliado (https)'), source_url: S.str('Link original (usado na atualização automática)'), external_id: S.str(),
    image: S.str(), price: S.str('Texto, ex.: R$ 89,90'), price_value: S.num(), badge: S.str(), description: S.str(), keywords: S.str('Palavras dos ingredientes, separadas por vírgula'),
    utensil: S.str('Chave do utensílio, ex.: liquidificador, forma:25'), category: S.str(null, { enum: ['', 'cozinha'] }), active: S.bool(), available: S.bool(),
  }, ['title']),
  Ad: { type: 'object', additionalProperties: true },
  AdInput: S.obj({ name: S.str(), slot: S.str('Posição (veja GET /ads → slots)'), html: S.str('Código do anúncio'), device: S.str(null, { enum: ['all', 'mobile', 'desktop'] }), active: S.bool(), weight: S.int(null, { minimum: 1, maximum: 100 }) }, ['name', 'slot']),
  User: S.obj({ id: S.int(), email: S.str(), name: S.str(), role: S.str(null, { enum: ['admin', 'author'] }), bio: S.str(), avatar: S.str(), created_at: S.str() }),
  Comment: S.obj({ id: S.int(), name: S.str(), body: S.str(), rating: S.int(), status: S.str(), created_at: S.str() }),
};

const B = (schema, required = true) => ({ required, content: { 'application/json': { schema: typeof schema === 'string' ? S.ref(schema) : schema } } });
const items = (schema) => S.obj({ items: S.arr(typeof schema === 'string' ? S.ref(schema) : schema) });

/*
 * [método, caminho, tag, acesso, resumo, { params, body, ok: [status, schema], errors: [códigos], description }]
 */
const ROUTES = [
  // Sistema
  ['get', '/', 'Sistema', 'public', 'Índice da API (links da documentação)'],
  ['get', '/openapi.json', 'Sistema', 'public', 'Esta especificação OpenAPI'],
  ['get', '/health', 'Sistema', 'public', 'Saúde do servidor e do banco de dados', { ok: [200, S.obj({ ok: S.bool(), version: S.str(), uptime: S.int('segundos'), recipes: S.int() })] }],

  // Autenticação
  ['post', '/auth/setup', 'Autenticação', 'public', 'Cria o primeiro administrador (só funciona com o banco vazio)', { body: B(S.obj({ email: S.str(), password: S.str(), name: S.str(), siteName: S.str(), setupToken: S.str('Token de instalação (SETUP_TOKEN)') }, ['email', 'password'])), ok: [201], errors: [400, 403, 409] }],
  ['post', '/auth/login', 'Autenticação', 'public', 'Login (cria o cookie de sessão)', { body: B(S.obj({ email: S.str(), password: S.str() }, ['email', 'password'])), ok: [200, S.obj({ user: S.ref('User') })], errors: [400, 401, 429], description: 'Limite: 10 tentativas/15 min por IP; a conta é bloqueada por alguns minutos após 5 erros.' }],
  ['post', '/auth/logout', 'Autenticação', 'public', 'Sai deste aparelho', { ok: [200, 'Ok'] }],
  ['post', '/auth/logout-all', 'Autenticação', 'user', 'Sai de todos os aparelhos (invalida todas as sessões)', { ok: [200, 'Ok'] }],
  ['post', '/auth/forgot', 'Autenticação', 'public', 'Envia o link de nova senha por e-mail (resposta sempre igual)', { body: B(S.obj({ email: S.str() }, ['email'])), ok: [200, 'Ok'], errors: [429, 503] }],
  ['post', '/auth/reset', 'Autenticação', 'public', 'Define nova senha com o token do e-mail (uso único, 1 h)', { body: B(S.obj({ token: S.str(), password: S.str('Mín. 10 caracteres') }, ['token', 'password'])), ok: [200, S.obj({ user: S.ref('User') })], errors: [400, 429] }],
  ['get', '/auth/me', 'Autenticação', 'public', 'Conta logada (user = null se ninguém)', { ok: [200, S.obj({ user: { oneOf: [S.ref('User'), { type: 'null' }] }, needsSetup: S.bool(), needsSetupToken: S.bool() })] }],
  ['put', '/auth/me', 'Autenticação', 'user', 'Atualiza o próprio perfil', { body: B(S.obj({ name: S.str(), bio: S.str(), avatar: S.str('/uploads/… ou https://'), email: S.str('Exige currentPassword'), password: S.str('Exige currentPassword'), currentPassword: S.str() })), ok: [200, S.obj({ user: S.ref('User') })], errors: [400, 403, 409], description: 'Pela chave de API não é possível trocar e-mail ou senha.' }],

  // Usuários e chaves
  ['get', '/users', 'Usuários e chaves', 'admin', 'Lista as contas', { ok: [200, items('User')] }],
  ['post', '/users', 'Usuários e chaves', 'admin', 'Cria conta (com senha ou convite por e-mail)', { body: B(S.obj({ email: S.str(), name: S.str(), role: S.str(null, { enum: ['admin', 'author'] }), password: S.str('Obrigatória sem convite'), invite: S.bool('Envia convite para a pessoa criar a senha') }, ['email'])), ok: [201, S.obj({ user: S.ref('User'), invited: S.bool(), warning: S.str() })], errors: [400, 409] }],
  ['get', '/users/{id}', 'Usuários e chaves', 'admin', 'Uma conta', { params: [P.id], ok: [200, S.obj({ user: S.ref('User') })], errors: [404] }],
  ['put', '/users/{id}', 'Usuários e chaves', 'admin', 'Altera nome, bio, foto ou papel de uma conta', { params: [P.id], body: B(S.obj({ name: S.str(), bio: S.str(), avatar: S.str(), role: S.str(null, { enum: ['admin', 'author'] }) })), ok: [200, S.obj({ user: S.ref('User') })], errors: [400, 404], description: 'Mudar o papel encerra as sessões da pessoa. Você não pode tirar o seu próprio acesso de administrador.' }],
  ['delete', '/users/{id}', 'Usuários e chaves', 'admin', 'Remove uma conta', { params: [P.id], ok: [200, 'Ok'], errors: [400, 404] }],
  ['post', '/users/{id}/invite', 'Usuários e chaves', 'admin', 'Reenvia o convite por e-mail', { params: [P.id], ok: [200, 'Ok'], errors: [404, 502] }],
  ['get', '/keys', 'Usuários e chaves', 'user', 'Suas chaves de API (sem o segredo)', { ok: [200, items(S.obj({ id: S.int(), name: S.str(), prefix: S.str(), last_used_at: S.str(), created_at: S.str() }))] }],
  ['post', '/keys', 'Usuários e chaves', 'user', 'Cria chave de API (o segredo aparece só nesta resposta)', { body: B(S.obj({ name: S.str() }), false), ok: [201, S.obj({ id: S.int(), key: S.str('Guarde: não é mostrada de novo'), prefix: S.str() })], errors: [400, 403], description: 'Só pelo painel (cookie), não com outra chave. Máx. 20 por pessoa.' }],
  ['delete', '/keys/{id}', 'Usuários e chaves', 'user', 'Revoga uma chave sua', { params: [P.id], ok: [200, 'Ok'], errors: [404] }],

  // Receitas
  ['get', '/recipes', 'Receitas', 'public', 'Lista e busca receitas', { params: RECIPE_QUERY, ok: [200, 'RecipePage'], description: 'Visitante vê só publicadas; autor vê publicadas + as suas; admin vê todas.' }],
  ['post', '/recipes', 'Receitas', 'user', 'Cria receita', { body: B('RecipeInput'), ok: [201, 'Recipe'], errors: [400] }],
  ['get', '/recipes/random', 'Receitas', 'public', 'Receita publicada aleatória', { params: [P.query('category', 'Slug ou nome da categoria (opcional)')], ok: [200, 'Recipe'], errors: [404] }],
  ['get', '/recipes/code/{code}', 'Receitas', 'public', 'Busca exata por código', { params: [P.code], ok: [200, 'Recipe'], errors: [404] }],
  ['get', '/recipes/{ref}', 'Receitas', 'public', 'Uma receita (com produtos vinculados)', { params: [P.ref], ok: [200, 'Recipe'], errors: [404] }],
  ['put', '/recipes/{ref}', 'Receitas', 'user', 'Atualiza receita (autor: só as suas)', { params: [P.ref], body: B('RecipeInput'), ok: [200, 'Recipe'], errors: [400, 403, 404] }],
  ['patch', '/recipes/{ref}', 'Receitas', 'user', 'Atualiza só os campos enviados', { params: [P.ref], body: B('RecipeInput'), ok: [200, 'Recipe'], errors: [400, 403, 404] }],
  ['delete', '/recipes/{ref}', 'Receitas', 'user', 'Remove receita', { params: [P.ref], ok: [200, 'Ok'], errors: [403, 404] }],
  ['get', '/recipes/{ref}/related', 'Receitas', 'public', 'Receitas parecidas', { params: [P.ref, P.query('limit', '1 a 12 (padrão 4)', S.int())], ok: [200, items('Recipe')], errors: [404] }],
  ['post', '/recipes/{ref}/duplicate', 'Receitas', 'user', 'Duplica como rascunho', { params: [P.ref], ok: [201, 'Recipe'], errors: [403, 404] }],
  ['post', '/recipes/bulk', 'Receitas', 'user', 'Ações em massa', { body: B(S.obj({ ids: S.arr(S.int()), all: S.bool('Todas do filtro'), filter: S.obj({ q: S.str(), status: S.str(), category: S.str() }), action: S.str(null, { enum: ['publish', 'draft', 'delete', 'category', 'feature', 'unfeature'] }), value: S.int('ID da categoria (action=category)') }, ['action'])), ok: [200, S.obj({ done: S.int(), denied: S.int() })], errors: [400, 403], description: 'Autor só altera as próprias receitas; destacar é só para administradores.' }],
  ['get', '/search/suggest', 'Receitas', 'public', 'Sugestões para o autocomplete', { params: [P.q()], ok: [200, items(S.obj({ title: S.str(), slug: S.str(), code: S.str() }))] }],

  // Interação
  ['post', '/recipes/{ref}/vote', 'Interação', 'public', 'Gostei (1) / não gostei (-1) / tirar voto (0)', { params: [P.ref], body: B(S.obj({ value: S.int(null, { enum: [1, -1, 0] }), voter: S.str('Identificador aleatório do aparelho (16–64 caracteres)') }, ['value', 'voter'])), ok: [200, S.obj({ likes: S.int(), dislikes: S.int(), mine: S.int() })], errors: [400, 404, 429] }],
  ['post', '/recipes/{ref}/view', 'Interação', 'public', 'Registra uma visualização real', { params: [P.ref], ok: [200, S.obj({ counted: S.bool() })], errors: [404, 429], description: 'O site envia depois de 3 s com a página visível. Não conta robôs, a equipe do site nem a mesma pessoa de novo em 30 min.' }],
  ['post', '/recipes/{ref}/cooked', 'Interação', 'public', 'Marca "cozinhei esta receita"', { params: [P.ref], ok: [200, S.obj({ cooked: S.int() })], errors: [404, 429] }],
  ['get', '/recipes/{ref}/comments', 'Interação', 'public', 'Comentários aprovados', { params: [P.ref], ok: [200, items('Comment')], errors: [404] }],
  ['post', '/recipes/{ref}/comments', 'Interação', 'public', 'Envia comentário e nota (pode passar por moderação)', { params: [P.ref], body: B(S.obj({ name: S.str(), body: S.str(), rating: S.int(null, { minimum: 1, maximum: 5 }) }, ['name', 'body'])), ok: [201, S.obj({ ok: S.bool(), status: S.str() })], errors: [400, 404, 429] }],

  // Comentários
  ['get', '/comments', 'Comentários', 'user', 'Comentários para moderar', { params: [P.query('status', 'pending (padrão) | approved | spam | all', S.str(null, { enum: ['pending', 'approved', 'spam', 'all'] }))], ok: [200, items('Comment')] }],
  ['patch', '/comments/{id}', 'Comentários', 'user', 'Aprova, volta para pendente ou marca como spam', { params: [P.id], body: B(S.obj({ status: S.str(null, { enum: ['approved', 'pending', 'spam'] }) })), ok: [200, 'Ok'], errors: [404] }],
  ['delete', '/comments/{id}', 'Comentários', 'user', 'Remove comentário', { params: [P.id], ok: [200, 'Ok'], errors: [404] }],

  // Importação
  ['post', '/import', 'Importação', 'user', 'Importa receita de uma URL (JSON-LD, microdata ou heurística)', { body: B(S.obj({ url: S.str(), save: S.bool('false = só pré-visualiza (padrão)'), status: S.str(null, { enum: ['draft', 'published'] }), downloadImages: S.bool('Baixa as fotos para o site (padrão true)') }, ['url'])), ok: [200, S.obj({ preview: S.ref('RecipeInput') })], errors: [400, 413, 429, 502, 504], description: 'Com save=true responde 201 com a receita criada. Limite: 20/min.' }],
  ['post', '/import/json', 'Importação', 'user', 'Importação em lote (formato desta API ou schema.org Recipe)', { body: B({ oneOf: [S.arr(S.ref('RecipeInput')), S.obj({ items: S.arr(S.ref('RecipeInput')) }), S.ref('RecipeInput')] }), ok: [201, S.obj({ created: S.int(), items: S.arr(S.ref('Recipe')), errors: S.arr(S.obj({ index: S.int(), error: S.str() })) })], errors: [400, 413, 429], description: 'Até 500 receitas e 20 MB por envio.' }],
  ['get', '/export', 'Importação', 'user', 'Backup em JSON (autor: só as suas)', { ok: [200, items('Recipe')] }],

  // Arquivos
  ['get', '/uploads', 'Arquivos', 'user', 'Arquivos enviados (autor: só os seus; últimos 300)', { ok: [200, items(S.obj({ id: S.int(), url: S.str(), size: S.int(), type: S.str(null, { enum: ['image', 'video'] }), created_at: S.str() }))] }],
  ['post', '/uploads', 'Arquivos', 'user', 'Envia fotos/vídeos (multipart, campo "files", até 20)', { body: { required: true, content: { 'multipart/form-data': { schema: S.obj({ files: S.arr(S.str(null, { format: 'binary' })) }) } } }, ok: [201, S.obj({ files: S.arr(S.obj({ id: S.int(), url: S.str(), type: S.str() })), rejected: S.int() })], errors: [400, 413, 415, 429], description: 'Fotos são otimizadas (WebP/AVIF em vários tamanhos); o conteúdo é conferido, não só a extensão.' }],
  ['post', '/uploads/from-url', 'Arquivos', 'user', 'Baixa uma imagem de um link para o site', { body: B(S.obj({ url: S.str() }, ['url'])), ok: [201, S.obj({ url: S.str() })], errors: [400, 422, 429] }],
  ['delete', '/uploads/{id}', 'Arquivos', 'user', 'Remove arquivo (dono ou admin)', { params: [P.id], ok: [200, 'Ok'], errors: [404] }],

  // Categorias e tags
  ['get', '/categories', 'Categorias e tags', 'public', 'Categorias (com número de receitas)', { ok: [200, items('Category')] }],
  ['post', '/categories', 'Categorias e tags', 'admin', 'Cria categoria', { body: B('CategoryInput'), ok: [201, 'Category'], errors: [400, 409] }],
  ['get', '/categories/{ref}', 'Categorias e tags', 'public', 'Uma categoria', { params: [P.catRef], ok: [200, 'Category'], errors: [404] }],
  ['put', '/categories/{id}', 'Categorias e tags', 'admin', 'Altera categoria', { params: [P.id], body: B('CategoryInput'), ok: [200, 'Category'], errors: [400, 404, 409] }],
  ['delete', '/categories/{id}', 'Categorias e tags', 'admin', 'Remove categoria (as receitas ficam sem categoria)', { params: [P.id], ok: [200, 'Ok'], errors: [404] }],
  ['get', '/tags', 'Categorias e tags', 'public', 'Tags mais usadas', { ok: [200, items(S.obj({ tag: S.str(), count: S.int() }))] }],

  // Afiliados
  ['get', '/products', 'Afiliados', 'user', 'Produtos de afiliado', { ok: [200, items('Product')] }],
  ['post', '/products', 'Afiliados', 'admin', 'Cadastra produto', { body: B('ProductInput'), ok: [201, 'Product'], errors: [400, 409] }],
  ['get', '/products/{id}', 'Afiliados', 'user', 'Um produto', { params: [P.id], ok: [200, 'Product'], errors: [404] }],
  ['put', '/products/{id}', 'Afiliados', 'admin', 'Altera produto', { params: [P.id], body: B('ProductInput'), ok: [200, 'Product'], errors: [400, 404] }],
  ['delete', '/products/{id}', 'Afiliados', 'admin', 'Remove produto', { params: [P.id], ok: [200, 'Ok'], errors: [404] }],
  ['post', '/products/preview', 'Afiliados', 'admin', 'Lê um link da Amazon, Shopee ou Mercado Livre e devolve os dados (não grava)', { body: B(S.obj({ url: S.str('Link do produto ou ASIN') }, ['url'])), ok: [200, S.obj({ store: S.str(), externalId: S.str(), title: S.str(), image: S.str(), price: S.str(), priceValue: S.num(), url: S.str(), affUrl: S.str(), utensil: S.str(), warn: S.arr(S.str()), duplicate: { oneOf: [S.obj({ id: S.int(), title: S.str() }), { type: 'null' }] } })], errors: [400] }],
  ['post', '/products/{id}/refresh', 'Afiliados', 'admin', 'Atualiza agora preço, estoque e link', { params: [P.id], ok: [200, 'Product'], errors: [404] }],
  ['post', '/products/bulk', 'Afiliados', 'admin', 'Ativa, desativa ou exclui vários', { body: B(S.obj({ ids: S.arr(S.int()), action: S.str(null, { enum: ['activate', 'deactivate', 'delete'] }) }, ['ids', 'action'])), ok: [200, S.obj({ ok: S.bool(), count: S.int() })], errors: [400] }],
  ['get', '/affiliates/status', 'Afiliados', 'admin', 'Situação: Shopee, atualização automática e utensílios cobertos', { ok: [200, { type: 'object', additionalProperties: true }] }],
  ['put', '/affiliates/settings', 'Afiliados', 'admin', 'Atualização automática e busca de utensílios', { body: B(S.obj({ productAutoRefresh: S.bool(), productRefreshHours: S.int('1 a 100'), utensilsAuto: S.bool() })), ok: [200, 'Ok'] }],
  ['put', '/affiliates/shopee', 'Afiliados', 'admin', 'Salva (ou remove, com campos vazios) o AppID e a Senha da Shopee', { body: B(S.obj({ appId: S.str(), secret: S.str() })), ok: [200, S.obj({ configured: S.bool(), appId: S.str('Mascarado'), fromEnv: S.bool() })], errors: [400], description: 'A senha nunca é devolvida.' }],
  ['post', '/affiliates/shopee/test', 'Afiliados', 'admin', 'Testa a conexão com a Shopee', { ok: [200, S.obj({ ok: S.bool(), sample: S.str() })], errors: [400, 429, 502] }],
  ['post', '/affiliates/utensils/fill', 'Afiliados', 'admin', 'Busca na Shopee produtos para os utensílios citados nas receitas', { ok: [200, S.obj({ added: S.arr(S.obj({ utensil: S.str(), title: S.str() })), remaining: S.int() })], errors: [400, 429, 502] }],

  // Anúncios
  ['get', '/ads', 'Anúncios', 'admin', 'Anúncios e posições disponíveis', { ok: [200, S.obj({ slots: { type: 'object', additionalProperties: S.str() }, items: S.arr(S.ref('Ad')) })] }],
  ['post', '/ads', 'Anúncios', 'admin', 'Cria anúncio', { body: B('AdInput'), ok: [201, 'Ad'], errors: [400] }],
  ['get', '/ads/{id}', 'Anúncios', 'admin', 'Um anúncio', { params: [P.id], ok: [200, 'Ad'], errors: [404] }],
  ['put', '/ads/{id}', 'Anúncios', 'admin', 'Altera anúncio', { params: [P.id], body: B('AdInput'), ok: [200, 'Ad'], errors: [400, 404] }],
  ['delete', '/ads/{id}', 'Anúncios', 'admin', 'Remove anúncio', { params: [P.id], ok: [200, 'Ok'], errors: [404] }],

  // Configurações
  ['get', '/settings', 'Configurações', 'admin', 'Todas as configurações', { ok: [200, { type: 'object', additionalProperties: true }] }],
  ['put', '/settings', 'Configurações', 'admin', 'Altera configurações (só as chaves enviadas; formatos validados)', { body: B({ type: 'object', additionalProperties: true }), ok: [200, { type: 'object', additionalProperties: true }], errors: [400] }],

  // Newsletter
  ['post', '/subscribe', 'Newsletter', 'public', 'Inscreve um e-mail (confirmação dupla quando o SMTP está ativo)', { body: B(S.obj({ email: S.str() }, ['email'])), ok: [201, S.obj({ ok: S.bool(), pending: S.bool(), message: S.str() })], errors: [400, 429] }],
  ['get', '/subscribers', 'Newsletter', 'admin', 'Inscritos (JSON ou CSV)', { params: [P.query('format', 'csv para baixar planilha', S.str(null, { enum: ['csv'] }))], ok: [200, items(S.obj({ id: S.int(), email: S.str(), status: S.str(), created_at: S.str() }))] }],
  ['delete', '/subscribers/{id}', 'Newsletter', 'admin', 'Remove inscrito', { params: [P.id], ok: [200, 'Ok'], errors: [404] }],
  ['get', '/newsletter', 'Newsletter', 'admin', 'Resumo: inscritos, campanhas e receitas', { ok: [200, { type: 'object', additionalProperties: true }] }],
  ['post', '/newsletter/campaigns', 'Newsletter', 'admin', 'Envia uma receita para a lista (ou teste para você)', { body: B(S.obj({ recipeId: S.int(), subject: S.str(), intro: S.str(), test: S.bool('Envia só para você'), force: S.bool('Reenviar receita já enviada') }, ['recipeId'])), ok: [201, { type: 'object', additionalProperties: true }], errors: [400, 409, 429] }],
  ['post', '/newsletter/campaigns/{id}/cancel', 'Newsletter', 'admin', 'Pausa/cancela o envio', { params: [P.id], ok: [200, 'Ok'] }],
  ['post', '/newsletter/campaigns/{id}/resume', 'Newsletter', 'admin', 'Retoma o envio', { params: [P.id], ok: [200, 'Ok'] }],

  // E-mail
  ['get', '/mail/status', 'E-mail', 'admin', 'Situação do SMTP (nunca mostra a senha)', { ok: [200, { type: 'object', additionalProperties: true }] }],
  ['post', '/mail/test', 'E-mail', 'admin', 'Envia um e-mail de teste para você', { ok: [200, S.obj({ ok: S.bool(), to: S.str() })], errors: [400, 429, 502] }],

  // Fotos dos bancos
  ['get', '/fotos/status', 'Fotos dos bancos', 'admin', 'Chaves configuradas e andamento do automático', { ok: [200, { type: 'object', additionalProperties: true }] }],
  ['put', '/fotos/chaves', 'Fotos dos bancos', 'admin', 'Salva/remove a chave do Pexels ou do Pixabay', { body: B(S.obj({ provider: S.str(null, { enum: ['pexels', 'pixabay'] }), key: S.str('Vazio remove') }, ['provider'])), ok: [200, { type: 'object', additionalProperties: true }], errors: [400] }],
  ['get', '/fotos/pendentes', 'Fotos dos bancos', 'admin', 'Receitas sem foto ou com foto dos bancos', { params: [P.query('modo', 'sem (padrão) | bancos', S.str(null, { enum: ['sem', 'bancos'] })), P.query('offset', 'Paginação', S.int())], ok: [200, S.obj({ total: S.int(), items: S.arr({ type: 'object' }) })] }],
  ['get', '/fotos/sugestoes/{id}', 'Fotos dos bancos', 'admin', 'Fotos sugeridas para uma receita', { params: [P.id, P.q('Outro termo de busca')], ok: [200, { type: 'object', additionalProperties: true }], errors: [400, 404, 429, 502] }],
  ['get', '/fotos/buscar', 'Fotos dos bancos', 'user', 'Busca livre nos bancos (editor de receita)', { params: [P.q('Termo (traduzido para inglês automaticamente)', true)], ok: [200, S.obj({ query: S.str(), items: S.arr({ type: 'object' }) })], errors: [400, 429, 502] }],
  ['post', '/fotos/aplicar', 'Fotos dos bancos', 'admin', 'Usa uma foto como capa de uma receita (com crédito)', { body: B(S.obj({ recipeId: S.int(), photo: { type: 'object', description: 'Item devolvido pela busca' } }, ['recipeId', 'photo'])), ok: [200, { type: 'object', additionalProperties: true }], errors: [400, 404, 502] }],
  ['post', '/fotos/baixar', 'Fotos dos bancos', 'user', 'Baixa uma foto do banco para o site (editor)', { body: B(S.obj({ photo: { type: 'object' } }, ['photo'])), ok: [201, S.obj({ url: S.str(), credit: S.str(), creditUrl: S.str() })], errors: [400, 502] }],
  ['post', '/fotos/remover-bancos', 'Fotos dos bancos', 'admin', 'Remove de uma vez as capas que vieram dos bancos', { ok: [200, S.obj({ removed: S.int() })] }],
  ['post', '/fotos/auto', 'Fotos dos bancos', 'admin', 'Inicia o preenchimento automático (em segundo plano)', { ok: [200, { type: 'object', additionalProperties: true }], errors: [400, 409] }],
  ['post', '/fotos/auto/parar', 'Fotos dos bancos', 'admin', 'Para o automático', { ok: [200, { type: 'object', additionalProperties: true }] }],

  // Google Search Console
  ['get', '/gsc/status', 'Google Search Console', 'admin', 'Chave configurada e propriedade', { ok: [200, { type: 'object', additionalProperties: true }] }],
  ['post', '/gsc/key', 'Google Search Console', 'admin', 'Salva o JSON da conta de serviço do Google', { body: B(S.obj({ key: S.str('Conteúdo do arquivo .json') }, ['key'])), ok: [200, S.obj({ ok: S.bool(), email: S.str() })], errors: [400, 409, 429] }],
  ['delete', '/gsc/key', 'Google Search Console', 'admin', 'Remove a chave do Google', { ok: [200, 'Ok'] }],
  ['get', '/gsc/sites', 'Google Search Console', 'admin', 'Propriedades que a conta de serviço enxerga', { ok: [200, S.obj({ items: S.arr({ type: 'object' }), current: S.str() })], errors: [400, 502] }],
  ['get', '/gsc/report', 'Google Search Console', 'admin', 'Cliques, impressões, consultas e páginas', { params: [P.query('dias', '7, 28 (padrão) ou 90', S.int(null, { enum: [7, 28, 90] }))], ok: [200, { type: 'object', additionalProperties: true }], errors: [400, 403, 429, 502] }],
  ['get', '/gsc/page/{ref}', 'Google Search Console', 'user', 'Desempenho de uma receita no Google', { params: [P.ref], ok: [200, { type: 'object', additionalProperties: true }], errors: [404, 429] }],
  ['post', '/gsc/sitemap', 'Google Search Console', 'admin', 'Envia o sitemap ao Google', { ok: [200, S.obj({ ok: S.bool(), url: S.str() })], errors: [400, 429, 502] }],

  // Estatísticas
  ['get', '/stats', 'Estatísticas', 'user', 'Números do painel (autor: só as suas receitas)', { ok: [200, { type: 'object', additionalProperties: true }] }],
  ['get', '/audit', 'Estatísticas', 'admin', 'Registro de auditoria (últimos 300)', { ok: [200, items({ type: 'object' })] }],
];

const ERROR_TEXT = {
  400: 'Dados inválidos (a mensagem explica)', 401: 'Não autenticado', 403: 'Sem permissão', 404: 'Não encontrado', 409: 'Conflito (já existe)',
  413: 'Grande demais', 415: 'Tipo de arquivo inválido', 422: 'Não foi possível processar', 429: 'Muitas requisições (veja Retry-After)',
  502: 'Falha no serviço externo', 503: 'Serviço não configurado', 504: 'O site externo demorou demais',
};

function build(baseUrl) {
  const paths = {};
  for (const [method, p, tag, access, summary, o = {}] of ROUTES) {
    const [code, schema] = o.ok || [200];
    const responses = { [code]: { description: 'Sucesso', ...(schema ? { content: { 'application/json': { schema: typeof schema === 'string' ? S.ref(schema) : schema } } } : {}) } };
    const errs = new Set(o.errors || []);
    if (access !== 'public') errs.add(401);
    if (access === 'admin') errs.add(403);
    for (const e of [...errs].sort()) responses[e] = { description: ERROR_TEXT[e] || 'Erro', content: { 'application/json': { schema: S.ref('Error') } } };
    const op = {
      tags: [tag], summary, operationId: `${method}${p.replace(/\{(\w+)\}/g, 'By_$1').replace(/[^a-zA-Z0-9]+(.)?/g, (m, c) => (c ? c.toUpperCase() : ''))}`,
      'x-auth': access,
      ...(o.description || access !== 'public' ? { description: [access === 'admin' ? '🔒 Somente administradores.' : access === 'user' ? '🔑 Exige login ou chave de API.' : '', o.description || ''].filter(Boolean).join(' ') } : {}),
      ...(o.params ? { parameters: o.params } : {}),
      ...(o.body ? { requestBody: o.body } : {}),
      responses,
      ...(access !== 'public' ? { security: [{ bearer: [] }, { cookie: [] }] } : {}),
    };
    paths[p] = paths[p] || {};
    paths[p][method] = op;
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Chef API', version: '1.1.0',
      description: 'API REST em JSON de todo o site. Leitura pública com CORS; escrita com `Authorization: Bearer <chave>` (crie em Painel → API) ou cookie do painel. '
        + 'Erros sempre como `{"error": "mensagem"}`. Limites por IP: 600 leituras e 120 escritas por minuto (cabeçalhos RateLimit-* e Retry-After).',
    },
    servers: [{ url: `${baseUrl}/api/v1` }],
    tags: TAGS.map(([name, description]) => ({ name, description })),
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer', description: 'Chave de API' }, cookie: { type: 'apiKey', in: 'cookie', name: 'chef_session', description: 'Sessão do painel (mesma origem)' } },
      schemas,
    },
    paths,
  };
}

module.exports = build;
module.exports.ROUTES = ROUTES;
module.exports.TAGS = TAGS;
