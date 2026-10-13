# 🍳 Chef — blog de receitas moderno (PWA)

[![Imagem Docker](https://github.com/incorpore/chef/actions/workflows/docker.yml/badge.svg)](https://github.com/incorpore/chef/actions/workflows/docker.yml) · Imagem: [`ghcr.io/incorpore/chef:latest`](https://github.com/users/incorpore/packages/container/package/chef)

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
- **Código por receita** (ex.: `#BOLO01`, gerado automaticamente ou personalizado), com **botão de copiar** ao lado em todo lugar onde aparece: digite o código na busca, abra `/c/BOLO01`, ou use o **QR code** da receita.
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

### Compartilhar
- Botões de **WhatsApp, Pinterest (Rich Pins), Facebook, Telegram, X e e‑mail**, que funcionam até sem JavaScript. Os links carregam **UTM**, para você ver no Analytics de onde vieram as visitas.
- **Copiar link**, compartilhamento nativo do celular, **link curto** `/c/CODIGO` e **QR code**.
- **"Incorporar"**: gera um `<iframe>` com o cartão da receita para outros blogs, com link de volta para o seu site.
- Imagens e textos de pré‑visualização (Open Graph e Twitter Card) em todas as páginas, com imagem padrão configurável.

### Google AdSense, Analytics e outros (Painel → Configurações)
Basta colar os IDs; os scripts são inseridos automaticamente:
- **Google Analytics 4**, **Google Tag Manager**, **Google AdSense** (com `ads.txt` e a meta `google-adsense-account`), **Meta Pixel** e **Microsoft Clarity**.
- **Aviso de cookies (LGPD) com Google Consent Mode v2**: nada é rastreado antes do "Aceitar". Sem consentimento, o AdSense mostra anúncios não personalizados, e o Pixel e o Clarity só carregam após o aceite.
- Páginas de **Política de privacidade** e **Termos de uso**, exigidas pelo AdSense.
- **Verificação de propriedade**: Google Search Console, Bing, Pinterest e Facebook.
- **Eventos enviados automaticamente**: `share`, `affiliate_click`, `cook_mode_start`, `recipe_cooked`, `add_to_shopping_list` e `print`.

### SEO (boas práticas)
- `title` otimizado (≤ 60 caracteres) e `meta description` (≤ 160 caracteres), editáveis por receita com **prévia do Google** no editor; se ficarem vazios, são gerados automaticamente.
- `canonical` absoluto, `hreflang`, `robots` com `max-image-preview:large`, Open Graph `article` e `og:image` absoluta.
- Dados estruturados: **Recipe** completo (inclui dietas `suitableForDiet`, vídeo, nota e nutrição), **BreadcrumbList**, **Organization**, **WebSite** com caixa de busca e **ItemList**.
- Busca e filtros com `noindex`; categorias e tags indexáveis, com `rel=prev/next`; página inexistente responde 404.
- **Redirecionamento 301 automático** quando o título (e o endereço) de uma receita muda; barra final também redireciona com 301.
- `sitemap.xml` com imagens, categorias e tags; RSS com `atom:link`; `robots.txt`; autor e datas visíveis (E‑E‑A‑T); link "Ir direto para a receita".
- **Desempenho**: compressão gzip/brotli, ETag e microcache de páginas (home 8× mais rápida no teste de carga).

### E‑mail (opcional, SMTP)
- **"Esqueci minha senha"** com link de uso único (1 h) e **convite de usuário** por e‑mail.
- **Aviso de comentário novo** para o autor da receita e os administradores.
- **Newsletter**: duplo opt‑in, e‑mail de boas‑vindas, envio de receitas pelo painel com prévia de teste, barra de progresso, envio controlado (`MAIL_RATE_PER_MIN`), retomada e descadastro em 1 clique (RFC 8058).
- Botão **"Enviar e‑mail de teste"** no painel, com mensagens de erro em português. Veja o passo 8 de [zimaos/LEIA-ME.md](zimaos/LEIA-ME.md).

### PWA
O PWA tem manifest, ícones *maskable*, atalhos e service worker com offline: as receitas visitadas e favoritadas ficam disponíveis sem internet. A interface tem barra de abas no estilo app nativo, tema claro/escuro e convite de instalação.

### Painel
**Meu perfil** (menu da foto no topo do site ou do painel): troque foto (recortada em quadrado automaticamente), nome, e‑mail de acesso (pede a senha atual e avisa o e‑mail antigo), bio (aparece no cartão "Quem fez esta receita"), senha (com medidor de força) e tema; veja a atividade recente e saia de todos os aparelhos. Quem está logado não vê mais "Entrar": o menu mostra Meu perfil, Painel, Nova receita e Sair.

Painel com estatísticas, editor de receitas (grupos de ingredientes com pré‑visualização, passos que podem ser reordenados, timers detectados, colar texto, Ctrl+S), duplicar, rascunho/publicado, destaque, categorias, comentários, produtos, anúncios, chaves de API, usuários (admin/autor) e configurações (nome, cor, logo, redes sociais, AdSense, tag Amazon, HTML extra no `<head>` para Analytics).

## Como rodar

Requisitos: **Node.js 22.13+**. O banco é o SQLite nativo do Node, então não é preciso instalar banco de dados.

```bash
npm install
npm run seed      # opcional: categorias e receitas de exemplo
npm start         # http://localhost:3000
```

Acesse `/admin` para criar a conta de administrador. Em produção, o primeiro acesso exige o **token de instalação**, que aparece no log ao iniciar (ou defina `SETUP_TOKEN`, ou `ADMIN_EMAIL`/`ADMIN_PASSWORD`). Copie `.env.example` para `.env` e preencha.

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor com recarga automática |
| `npm test` | 79 testes: funcionalidades, **segurança (ataques)** e **SEO** |
| `npm run stress` | Teste de carga e de limites da API (2.000 receitas, 32 conexões) |
| `npm run audit:secrets` | Procura senhas/chaves vazadas nos arquivos **e no histórico do Git** |
| `sh scripts/smoke-test.sh IMAGEM` | Testa a imagem Docker como se fosse o ZimaOS (instalação, login, upload, reinício) |
| `node scripts/reset-password.js EMAIL` | Redefine uma senha esquecida |

Segurança: veja **[SECURITY.md](SECURITY.md)** (checklist de 21 itens com a prova de cada um).

### 🏠 ZimaOS / CasaOS (recomendado para casa)
O GitHub gera a imagem `ghcr.io/incorpore/chef` sozinho a cada mudança (amd64 + arm64) e só a publica se todos os testes passarem.
Para instalar no ZimaOS, siga o guia passo a passo **[zimaos/LEIA-ME.md](zimaos/LEIA-ME.md)** e use o arquivo [`zimaos/docker-compose.yml`](zimaos/docker-compose.yml).

### Docker (qualquer servidor)
```bash
# edite SETUP_TOKEN em docker-compose.yml e depois:
docker compose up -d
# abra http://IP-DO-SERVIDOR:8484/admin
```
Para gerar a imagem a partir do código: `docker build -t chef .`. Para testar a imagem simulando o ZimaOS: `sh scripts/smoke-test.sh chef`.

### Variáveis de ambiente
| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `3000` | Porta HTTP (dentro do container) |
| `PUID` / `PGID` | `1000` | Usuário/grupo dono dos arquivos (Docker) |
| `TZ` | `America/Sao_Paulo` | Fuso horário (Docker) |
| `BASE_URL` | auto | URL pública (usada em sitemap, RSS, QR e JSON‑LD) |
| `DATA_DIR` | `./data` | Banco SQLite e segredo de sessão |
| `UPLOADS_DIR` | `./uploads` | Fotos e vídeos enviados |
| `SESSION_SECRET` | gerado | Segredo para assinar sessões |
| `MAX_UPLOAD_MB` | `200` | Tamanho máximo por arquivo |
| `NODE_ENV` | — | `production` ativa cookies `Secure`, HSTS e cache de estáticos |
| `TRUST_PROXY` | `0` | Número de proxies reversos na frente (use `1` atrás de Nginx/Caddy/Cloudflare) |
| `SETUP_TOKEN` | gerado | Token exigido em `/admin/setup` em produção |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | — | Cria o administrador na primeira inicialização |
| `PAGE_CACHE_SECONDS` | `15` | Microcache de páginas para visitantes (0 desliga) |
| `SMTP_HOST` | — | Servidor SMTP (vazio = e‑mail desligado) |
| `SMTP_PORT` | `587` | `587` (STARTTLS obrigatório) ou `465` (SSL) |
| `SMTP_USER` / `SMTP_PASS` | — | Login do SMTP (no Gmail, use uma senha de app) |
| `SMTP_SECURE` | auto | `true` força SSL (automático na porta 465) |
| `MAIL_FROM` / `MAIL_REPLY_TO` | `SMTP_USER` | Remetente e endereço de resposta |
| `MAIL_ADMIN` | admins | Quem recebe os avisos (separe vários por vírgula) |
| `MAIL_RATE_PER_MIN` | `30` | Velocidade de envio da newsletter |

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
