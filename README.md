# 🍳 Chef — blog de receitas moderno (PWA)

Site/sistema para publicar e compartilhar suas receitas, com **busca por palavra‑chave ou código**, **fotos e vídeos**, **API REST**, **importação por URL**, **anúncios**, **afiliados da Amazon** e um **Modo Cozinha** para acompanhar a receita passo a passo — instalável no celular como um app nativo.

## Destaques

### Uma forma diferente de mostrar a receita
- **Modo Cozinha** (tela cheia): um passo por tela, deslizar para avançar, **tela sempre acesa** (Wake Lock), letras grandes.
  - Começa com a separação dos ingredientes (*mise en place*), cada um com checkbox.
  - Em cada passo aparece **"Você vai usar"**, só com os ingredientes daquele passo, já nas quantidades ajustadas, e eles ficam destacados no texto.
  - **Timers automáticos**: o sistema encontra os tempos no texto ("asse por 40 minutos") e cria um botão de timer. Os timers ficam flutuando na tela, continuam funcionando quando você muda de página, podem ser pausados ou ganhar +1 min, e avisam com som, vibração e notificação.
  - **Leitura em voz alta** e **comandos de voz**: "próximo", "voltar", "repetir", "timer", "ingredientes", "sair".
  - O progresso fica salvo no aparelho: ao voltar, aparece "Você parou no passo 4 — Continuar", e a página inicial mostra "Continue de onde parou".
- **Linha do tempo** com as etapas de preparo, cozimento e descanso, mais **"fica pronto às 19:40"** e **"quero servir às 20:00 → comece às 18:50"**.
- **Ajuste de porções** (½×, 2×, 3× ou +/−), com frações bonitas (1 ½, ¾), e conversão de medidas caseiras para **g/ml**.
- Os passos podem ser marcados como feitos e há uma barra de progresso de leitura. Ao tocar num ingrediente dentro do passo, ele é destacado na lista.

### Busca
- Busca de texto completo (SQLite FTS5) que **ignora acentos** ("acucar" encontra "açúcar"), com autocomplete.
- **Código por receita** (ex.: `#BOLO01`, gerado automaticamente ou personalizado): digite o código na busca, abra `/c/BOLO01`, ou use o **QR code** da receita.
- Filtros por categoria, tempo, dificuldade, tag e dieta, com ordenação.
- **"O que tem na geladeira?"**: você informa os ingredientes que tem e o sistema mostra as receitas possíveis.

### Fotos e vídeos
- Upload de várias fotos (arrastar, escolher ou colar). As imagens são **otimizadas no navegador** (WebP) antes do envio. A primeira foto vira a capa e as outras formam uma galeria com legendas. Cada passo pode ter sua própria foto.
- Vídeo enviado (MP4/WebM/MOV) ou link do **YouTube** (carregamento leve), **Vimeo**, **TikTok** ou **Instagram**.

### Importação e API
- **Importar por URL**: lê `schema.org/Recipe` (JSON‑LD, o mesmo formato que o Google usa), microdata ou, como último recurso, a estrutura da página. Pode baixar as imagens para o seu servidor e tem proteção contra SSRF.
- Formas de importar: atalho de navegador (bookmarklet), **"Compartilhar → Chef"** no celular (PWA share target) e importação em lote de JSON (backup).
- **API REST** `/api/v1` com chaves (Bearer). Documentação em `/api/docs` e OpenAPI em `/api/v1/openapi.json`. A leitura é pública, com CORS.

### Monetização
- **Anúncios** em 9 posições (topo, entre receitas, antes dos ingredientes, entre os passos, barra lateral, tela final do modo cozinha…), com rotação por peso, segmentação celular/desktop e contagem de impressões. Integração com **Google AdSense**, incluindo o `ads.txt` automático.
- **Afiliados Amazon**: cadastre produtos por link ou ASIN e a **tag de associado é adicionada automaticamente**. Os cliques são contados em `/go/ID`. Há vitrine de produtos por receita e **botão de compra ao lado do ingrediente**, que aparece por palavra‑chave. O aviso de afiliado é exibido junto.

### Funções de blog de receitas
Favoritos (funcionam offline), lista de compras que **soma ingredientes** de várias receitas, **cardápio semanal** que gera a lista de compras, conversor de medidas, avaliações com estrelas e comentários moderados (com anti‑spam), "Fiz esta receita!", receitas relacionadas, anterior/próxima, "Me surpreenda", newsletter (exporta CSV), categorias com ícone, tags, dietas, informação nutricional, dicas, história da receita, versão para impressão e compartilhamento (WhatsApp/Web Share).

### SEO e PWA
JSON‑LD `Recipe` completo (com rich results no Google), Open Graph, `sitemap.xml` com imagens, RSS, `robots.txt` e URLs amigáveis. O PWA tem manifest, ícones *maskable*, atalhos e service worker com offline: as receitas visitadas e favoritadas ficam disponíveis sem internet. A interface tem barra de abas no estilo app nativo, tema claro/escuro e convite de instalação.

### Painel
Painel com estatísticas, editor de receitas (grupos de ingredientes com pré‑visualização, passos que podem ser reordenados, timers detectados, colar texto, Ctrl+S), duplicar, rascunho/publicado, destaque, categorias, comentários, produtos, anúncios, chaves de API, usuários (admin/autor) e configurações (nome, cor, logo, redes sociais, AdSense, tag Amazon, HTML extra no `<head>` para Analytics).

## Como rodar

Requisitos: **Node.js 22.13+**. O banco é o SQLite nativo do Node, então não é preciso instalar banco de dados.

```bash
npm install
npm run seed      # opcional: categorias e receitas de exemplo
npm start         # http://localhost:3000
```

Acesse `/admin` para criar a conta de administrador. Para desenvolvimento, use `npm run dev`. Para rodar os testes, use `npm test`.

### Docker
```bash
docker build -t chef .
docker run -p 3000:3000 -v chef-data:/app/data -v chef-uploads:/app/uploads -e BASE_URL=https://seusite.com.br chef
```

### Variáveis de ambiente
| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `3000` | Porta HTTP |
| `BASE_URL` | auto | URL pública (usada em sitemap, RSS, QR e JSON‑LD) |
| `DATA_DIR` | `./data` | Banco SQLite e segredo de sessão |
| `UPLOADS_DIR` | `./uploads` | Fotos e vídeos enviados |
| `SESSION_SECRET` | gerado | Segredo para assinar sessões |
| `MAX_UPLOAD_MB` | `200` | Tamanho máximo por arquivo |
| `NODE_ENV` | — | `production` ativa cookies `Secure` e cache de estáticos |

> Em produção, use HTTPS (necessário para PWA, microfone e notificações), por exemplo com Caddy ou Nginx na frente.

## Exemplos de API

```bash
# Buscar
curl "https://seusite/api/v1/recipes?q=bolo&maxTime=60"
curl "https://seusite/api/v1/recipes/code/BOLO01"
curl "https://seusite/api/v1/recipes?ingredients=ovo,tomate"

# Criar (gere a chave em /admin/api)
curl -X POST https://seusite/api/v1/recipes -H "Authorization: Bearer SUA_CHAVE" -H "Content-Type: application/json" \
  -d '{"title":"Brigadeiro","ingredients":"1 lata de leite condensado\n1 colher (sopa) de manteiga","steps":"Mexa em fogo baixo por 10 minutos.","status":"published"}'

# Importar por URL
curl -X POST https://seusite/api/v1/import -H "Authorization: Bearer SUA_CHAVE" -H "Content-Type: application/json" \
  -d '{"url":"https://site.com/receita","save":true}'

# Upload
curl -X POST https://seusite/api/v1/uploads -H "Authorization: Bearer SUA_CHAVE" -F "files=@foto.jpg"
```

## Estrutura
```
server.js            entrada
src/app.js           Express e middlewares
src/db.js            esquema SQLite e FTS5
src/recipes.js       CRUD, busca (palavra-chave, código, ingredientes)
src/importer.js      importação por URL (JSON-LD, microdata, heurística)
src/monetization.js  anúncios e afiliados Amazon
src/routes/          api.js (REST), pages.js (site), admin.js (painel)
src/views/           templates HTML renderizados no servidor
public/js/           app.js (PWA, timers, favoritos), recipe.js (modo cozinha), tools.js, admin.js
public/sw.js         service worker
```
