# Segurança — checklist e auditoria

Cada item abaixo tem a implementação e o **teste automatizado** que tenta burlá‑lo (`test/security.test.js`).
Rode tudo com `npm test`, os limites com `npm run stress` e a busca por segredos com `npm run audit:secrets`.

| # | Item | Como está resolvido | Prova |
|---|---|---|---|
| 1 | **Chave de API protegida** | Chaves aleatórias de 192 bits, guardadas **só como hash SHA‑256**, exibidas uma única vez, aceitas **apenas** no cabeçalho `Authorization` (nunca na URL), revogáveis, até 20 por usuário. Uma chave não cria outras chaves nem troca senha. | "chave de API: inválida é recusada…", "chave na URL não é aceita" |
| 2 | **.env nunca exposto** | `.env` é lido pelo servidor (`process.loadEnvFile`), está no `.gitignore` e fica fora de `public/`. Um middleware bloqueia qualquer caminho com dotfile, `.env`, `.db`, `.pem`, `.key`, `.bak`, `/data/`, `/src/`… | "arquivos sensíveis e travessia de diretório" |
| 3 | **Nada de senha no código** | Nenhuma credencial no repositório. Admin inicial por variável de ambiente (`ADMIN_EMAIL/ADMIN_PASSWORD`) ou token de instalação. `SESSION_SECRET` vem do ambiente ou é gerado e salvo com permissão `600`. | `npm run audit:secrets`, "repositório: nenhum segredo versionado" |
| 4 | **Login de verdade** | Senhas com **scrypt** + sal; cookie de sessão **assinado (HMAC)**, `HttpOnly`, `SameSite=Lax`, `Secure` e prefixo `__Host-` em produção. Sessões revogáveis: trocar a senha ou "Sair de todos" invalida todos os cookies. Login em tempo constante (não revela se o e‑mail existe). Senhas fracas são recusadas. Instalação protegida por token, para que um estranho não vire admin antes de você. | "instalação exige o token", "cookie adulterado…", "login: mensagem genérica…" |
| 5 | **Permissão no servidor** | Toda rota verifica papel e dono **no servidor** (`requireUser`, `requireAdmin`, `canEditRecipe`). Esconder um botão na tela não é a proteção. | "estranho (sem login) não acessa nenhuma rota restrita", "autor não acessa áreas de administrador" |
| 6 | **Não confia no ID da tela** | Operações por ID sempre filtram pelo dono (`WHERE id = ? AND user_id = ?`). `author_id`, `views`, `featured`, `slug` etc. enviados pelo cliente são **ignorados**. | "autor não edita, exclui nem modera o que é dos outros (IDOR)", "não apaga chave alheia trocando o ID" |
| 7 | **Cada um só vê o seu** | Rascunhos aparecem só para o dono ou admin (API, página, código, QR, link curto e busca). Exportação, uploads, chaves, comentários e estatísticas são filtrados por usuário. | "rascunho de outra pessoa é invisível…", "cada um só vê o seu…" |
| 8 | **Banco travado** | SQLite fora da pasta pública, com arquivo e pasta em `600/700`. **100% consultas parametrizadas**. Ordenação por lista branca. Busca FTS montada só com palavras alfanuméricas. | "o banco e o segredo de sessão ficam fora da pasta pública…" |
| 9 | **Firebase, Supabase e storage** | Não usamos BaaS: não há chave de banco no navegador nem regras de acesso para esquecer. O storage é a pasta `uploads/`, sem listagem, com nomes aleatórios e CSP `sandbox`. Se migrar para S3/R2, use um bucket **privado** com URLs assinadas. | "upload: tipo falso…" |
| 10 | **Admin protegido** | `/admin` e a API exigem login. Áreas críticas (configurações, anúncios, usuários, auditoria, produtos) são só para admin. O painel tem `noindex` e está fora do `robots.txt`. O redirecionamento pós‑login só aceita caminhos internos (sem *open redirect*). | "autor não acessa áreas de administrador", "open redirect" |
| 11 | **Debug desligado** | Sem `X-Powered-By` e sem stack trace para o cliente. `NODE_ENV=production` ativa HSTS, cookies `Secure` e `upgrade-insecure-requests`. | "erros não revelam detalhes internos" |
| 12 | **Erro sem detalhe** | Mensagens genéricas: "Erro interno", "Já existe um registro com esses dados", "JSON inválido". Detalhes ficam só no log do servidor. | idem |
| 13 | **Valida tudo no servidor** | Limites de tamanho por campo (título 200, passo 5.000, 300 ingredientes, 40 imagens…), tipos, URLs (só `http(s)://` ou `/uploads/`) e IDs numéricos. As configurações validam o formato dos IDs (GA4, GTM, AdSense, Pixel), as cores e os links. Chaves desconhecidas são ignoradas (sem *prototype pollution*). | "validação: tamanhos, tipos e URLs perigosas", "prototype pollution…" |
| 14 | **Limpa o que o usuário manda** | Todo conteúdo é **escapado na saída**. O markdown da história escapa antes de formatar e não gera `javascript:`. Caracteres de controle e de inversão bidi (RTL) são removidos. JSON dentro de `<script>` escapa `<`. O CSV de inscritos é protegido contra fórmulas do Excel. | "XSS: conteúdo de usuários é sempre escapado" |
| 15 | **Upload protegido** | Login obrigatório, lista branca de tipos, **assinatura real do arquivo verificada** (não confia no tipo enviado pelo navegador) e extensão definida pelo conteúdo. Nome aleatório, até 20 arquivos por envio e `MAX_UPLOAD_MB` por arquivo. SVG/HTML recusados. Servidos com `nosniff` + CSP `sandbox`. Dono registrado. | "upload: tipo falso, HTML/SVG disfarçado, arquivo grande…" |
| 16 | **Sem injeção de SQL** | Consultas parametrizadas, sem concatenação de valores. | "SQL injection: busca, filtros, ordenação e IDs" (10 payloads × 11 parâmetros) |
| 17 | **Limite de tentativas** | Login: 10 por IP a cada 15 min **e** bloqueio da conta por 15 min após 5 erros. Limites também para API (600 leituras e 120 escritas por minuto), importação, uploads, comentários (5/min e 30/dia), newsletter e criação de chaves. Envia cabeçalhos `RateLimit-*` e `Retry-After`. Forjar `X-Forwarded-For` não burla os limites. | "força bruta…", "forjar X-Forwarded-For…", `npm run stress` |
| 18 | **Git sem senha vazada** | `.gitignore` cobre `.env*`, `data/`, `uploads/`, `*.db`, `*.pem`, `*.key`. O `npm run audit:secrets` varre os arquivos **e todo o histórico** procurando chaves AWS, Google, Stripe, GitHub, Slack, chaves privadas, URLs com senha e chaves do Chef. | `npm run audit:secrets` |
| 19 | **Headers e CORS certos** | CSP com **nonce por requisição + `strict-dynamic`**: só rodam scripts do servidor, nenhum script injetado executa. Também: `object-src 'none'`, `base-uri 'self'`, `frame-ancestors`, `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `COOP` e HSTS em produção. CORS `*` só para leitura e **sem credenciais**; escrita entre origens só com chave. CSRF bloqueado pela verificação de `Origin`/`Sec-Fetch-Site` + `SameSite`. | "cabeçalhos de segurança…", "CSRF…", "cache: dados privados nunca ficam em cache…" |
| 20 | **Testa como um estranho** | `test/security.test.js` simula três pessoas (admin, autor e estranho) com cookies separados e tenta cada ataque. | `npm test` |
| 21 | **Auditoria completa** | Revisão linha a linha do código (achados abaixo) + registro de auditoria em `/admin/auditoria`: logins, falhas, bloqueios, chaves, configurações, exclusões e importações (IP só como hash). | — |

## E‑mail (SMTP)

- As credenciais do SMTP ficam **somente em variáveis de ambiente**. Não são gravadas no banco, não aparecem no painel e não vão para o Git.
- Envio sempre criptografado: a porta 587 exige STARTTLS, e o mínimo é TLS 1.2. O Nodemailer roda com `disableFileAccess`/`disableUrlAccess`.
- **Redefinição de senha:**
  - o link é de uso único e vale 1 hora;
  - o token é guardado como **SHA‑256**;
  - a resposta é sempre genérica (não revela se o e‑mail existe);
  - o limite é de 5 pedidos/15 min por IP e 3 por hora por conta;
  - redefinir encerra todas as sessões.
- **Proteção contra envenenamento de link:**
  - o endereço usado nos e‑mails nunca vem do cabeçalho `Host`;
  - a ordem é `BASE_URL` → configuração "Endereço do site" → origem aprendida no login do admin (só quando `Origin` = `Host`).
- **Conteúdo e cabeçalhos:**
  - comentários e textos da newsletter são escapados no HTML do e‑mail;
  - os assuntos têm quebras de linha removidas (sem injeção de cabeçalho).
- **Newsletter:**
  - duplo opt‑in com token de 7 dias;
  - descadastro com token HMAC e `List-Unsubscribe` em 1 clique (RFC 8058);
  - o link GET só pergunta, e o descadastro acontece no POST (scanners de e‑mail não descadastram ninguém);
  - envio controlado por minuto, com pausa automática se o SMTP começar a falhar.
- Testes: `test/email.test.js`, que inclui um servidor SMTP real com autenticação.

## Achados da auditoria (e correções)

| Achado | Risco | Correção |
|---|---|---|
| A primeira pessoa a abrir `/admin/setup` virava administradora | Crítico | Token de instalação obrigatório em produção, ou admin criado pelo `.env` |
| Qualquer usuário logado via e editava rascunhos e receitas de outros | Alto | Papéis admin/autor e verificação de dono em todas as rotas |
| Importador por URL acessava a rede interna (SSRF), inclusive via *DNS rebinding* | Alto | IP validado **no momento da conexão**; faixas privadas, reservadas e IPv6 locais bloqueadas; portas e `user:senha@` recusadas |
| Upload aceitava qualquer conteúdo com tipo `image/png` | Alto | Verificação da assinatura real do arquivo + CSP `sandbox` |
| Service worker guardava respostas privadas da API para uso offline | Médio | Só a API pública vai para o cache; respostas `no-store/private` nunca são guardadas; o cache é limpo ao sair |
| `trust proxy` ligado por padrão permitia forjar o IP e burlar os limites | Médio | Desligado por padrão (`TRUST_PROXY=1` só com proxy real) |
| Sessões não podiam ser revogadas | Médio | Versão de sessão: trocar a senha ou "Sair de todos" derruba os cookies antigos |
| Mensagens de erro do SQLite chegavam ao cliente | Baixo | Mensagens genéricas |
| `__proto__` nas configurações | Baixo | `Object.hasOwn` + lista de chaves permitidas |
| CSV de inscritos podia executar fórmulas no Excel | Baixo | Prefixo de escape em células perigosas |
| `onclick` inline (bloqueado pelo CSP rígido) | — | Trocado por `data-print` |

## Riscos aceitos (por design)

- **HTML de anúncios e "HTML extra no `<head>`"** são executados como código. Por isso, **somente administradores** podem editá‑los, e toda alteração fica na auditoria.
- **Bloqueio de conta após 5 erros:** um atacante pode bloquear temporariamente o login de um e‑mail conhecido (por 15 min). É uma troca consciente para impedir força bruta distribuída.
- **Limites de tentativas em memória:** são zerados ao reiniciar o servidor. Para várias instâncias, use um limitador compartilhado (Redis) ou o do seu proxy/CDN.

## Em produção

1. Use HTTPS, defina `NODE_ENV=production`, `BASE_URL`, `SESSION_SECRET` e `TRUST_PROXY=1` se houver proxy na frente (veja `.env.example`).
2. Faça backup de `data/` e `uploads/`. O banco fica em `data/chef.db`.
3. Rode `npm run audit:secrets` antes de cada push e `npm audit` periodicamente.
