'use strict';

/** Especificação OpenAPI 3.1 da API pública. */
module.exports = function openapi(baseUrl) {
  const ref = { name: 'ref', in: 'path', required: true, description: 'ID, código (ex.: K7M2QX) ou slug', schema: { type: 'string' } };
  const auth = [{ bearer: [] }];
  const json = (schema) => ({ content: { 'application/json': { schema } } });
  const recipeInput = {
    type: 'object',
    required: ['title'],
    properties: {
      title: { type: 'string' },
      code: { type: 'string', description: 'Código personalizado (opcional, gerado automaticamente)' },
      description: { type: 'string' },
      story: { type: 'string', description: 'Texto de blog (markdown simples)' },
      cover: { type: 'string', description: 'URL da foto de capa' },
      images: { type: 'array', items: { oneOf: [{ type: 'string' }, { type: 'object', properties: { url: { type: 'string' }, caption: { type: 'string' } } }] } },
      video: { type: 'string', description: 'URL do YouTube, Vimeo, TikTok, Instagram ou arquivo enviado' },
      ingredients: { oneOf: [{ type: 'string', description: 'Um por linha; "## Grupo" cria seções' }, { type: 'array', items: { type: 'string' } }] },
      steps: { oneOf: [{ type: 'string' }, { type: 'array', items: { oneOf: [{ type: 'string' }, { type: 'object', properties: { text: { type: 'string' }, image: { type: 'string' }, timer: { type: 'integer', description: 'segundos' }, group: { type: 'string' } } }] } }] },
      tips: { type: 'string' },
      prep_minutes: { type: 'integer' }, cook_minutes: { type: 'integer' }, rest_minutes: { type: 'integer' },
      servings: { type: 'number' }, servings_unit: { type: 'string' },
      difficulty: { type: 'integer', minimum: 1, maximum: 3 },
      cuisine: { type: 'string' }, category: { type: 'string', description: 'Nome da categoria (criada se não existir)' }, category_id: { type: 'integer' },
      tags: { type: 'array', items: { type: 'string' } }, diets: { type: 'array', items: { type: 'string' } },
      nutrition: { type: 'object', additionalProperties: { type: 'string' } },
      products: { type: 'array', items: { type: 'integer' }, description: 'IDs de produtos de afiliado' },
      status: { type: 'string', enum: ['draft', 'published'] }, featured: { type: 'boolean' },
      source_url: { type: 'string' }, source_name: { type: 'string' },
    },
  };
  return {
    openapi: '3.1.0',
    info: { title: 'Chef API', version: '1.0.0', description: 'API de receitas. Leitura pública; escrita com `Authorization: Bearer <chave>` (gere chaves em /admin/api).' },
    servers: [{ url: `${baseUrl}/api/v1` }],
    components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } }, schemas: { RecipeInput: recipeInput } },
    paths: {
      '/recipes': {
        get: {
          summary: 'Lista/busca receitas',
          parameters: ['q', 'code', 'category', 'tag', 'diet', 'maxTime', 'difficulty', 'ingredients', 'sort', 'page', 'perPage'].map((n) => ({ name: n, in: 'query', schema: { type: 'string' }, description: { q: 'Palavras-chave ou código', ingredients: 'Lista separada por vírgula (o que tenho em casa)', sort: 'recent | popular | quick | rating | title' }[n] })),
          responses: { 200: { description: 'Resultado paginado' } },
        },
        post: { summary: 'Cria receita', security: auth, requestBody: json({ $ref: '#/components/schemas/RecipeInput' }), responses: { 201: { description: 'Criada' } } },
      },
      '/recipes/{ref}': {
        parameters: [ref],
        get: { summary: 'Obtém receita', responses: { 200: { description: 'Receita' }, 404: { description: 'Não encontrada' } } },
        put: { summary: 'Atualiza receita', security: auth, requestBody: json({ $ref: '#/components/schemas/RecipeInput' }), responses: { 200: { description: 'Atualizada' } } },
        patch: { summary: 'Atualiza parcialmente', security: auth, requestBody: json({ $ref: '#/components/schemas/RecipeInput' }), responses: { 200: { description: 'Atualizada' } } },
        delete: { summary: 'Remove receita', security: auth, responses: { 200: { description: 'Removida' } } },
      },
      '/recipes/code/{code}': { get: { summary: 'Busca exata por código', parameters: [{ name: 'code', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Receita' } } } },
      '/recipes/{ref}/comments': {
        parameters: [ref],
        get: { summary: 'Comentários aprovados', responses: { 200: { description: 'Lista' } } },
        post: { summary: 'Envia comentário/avaliação', requestBody: json({ type: 'object', properties: { name: { type: 'string' }, body: { type: 'string' }, rating: { type: 'integer', minimum: 1, maximum: 5 } } }), responses: { 201: { description: 'Recebido' } } },
      },
      '/search/suggest': { get: { summary: 'Autocomplete', parameters: [{ name: 'q', in: 'query', schema: { type: 'string' } }], responses: { 200: { description: 'Sugestões' } } } },
      '/import': { post: { summary: 'Importa receita de uma URL (JSON-LD, microdata ou heurística)', security: auth, requestBody: json({ type: 'object', required: ['url'], properties: { url: { type: 'string' }, save: { type: 'boolean', description: 'false = apenas pré-visualiza' }, status: { type: 'string' }, downloadImages: { type: 'boolean' } } }), responses: { 200: { description: 'Pré-visualização' }, 201: { description: 'Criada' } } } },
      '/import/json': { post: { summary: 'Importação em lote (formato desta API ou schema.org Recipe)', security: auth, responses: { 201: { description: 'Criadas' } } } },
      '/export': { get: { summary: 'Exporta todas as receitas (backup)', security: auth, responses: { 200: { description: 'JSON' } } } },
      '/uploads': { post: { summary: 'Envia fotos/vídeos (multipart, campo "files")', security: auth, responses: { 201: { description: 'URLs dos arquivos' } } } },
      '/categories': { get: { summary: 'Categorias', responses: { 200: { description: 'Lista' } } }, post: { summary: 'Cria categoria', security: auth, responses: { 201: { description: 'Criada' } } } },
      '/tags': { get: { summary: 'Tags mais usadas', responses: { 200: { description: 'Lista' } } } },
      '/products': { get: { summary: 'Produtos de afiliado', security: auth, responses: { 200: { description: 'Lista' } } }, post: { summary: 'Cria produto (ASIN ou link Amazon)', security: auth, responses: { 201: { description: 'Criado' } } } },
      '/ads': { get: { summary: 'Anúncios e posições', security: auth, responses: { 200: { description: 'Lista' } } }, post: { summary: 'Cria anúncio', security: auth, responses: { 201: { description: 'Criado' } } } },
      '/settings': { get: { summary: 'Configurações', security: auth, responses: { 200: { description: 'Objeto' } } }, put: { summary: 'Atualiza configurações', security: auth, responses: { 200: { description: 'Objeto' } } } },
      '/stats': { get: { summary: 'Estatísticas', security: auth, responses: { 200: { description: 'Objeto' } } } },
    },
  };
};
