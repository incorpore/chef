# 🍳 Chef no ZimaOS — guia passo a passo

Este guia explica, sem complicação, como colocar o seu site de receitas para rodar no **ZimaOS**
(ZimaBoard, ZimaBlade, ZimaCube ou qualquer PC com ZimaOS/CasaOS).

---

## Como funciona (em 30 segundos)

```
 Você muda o código      O GitHub monta a "caixinha"        O ZimaOS baixa a caixinha
 e envia ao GitHub  ───▶  (imagem Docker) e testa tudo  ───▶  e liga o site na sua casa
                          sozinho, em ~5 minutos              http://IP-do-Zima:8484
```

- **Imagem Docker** = uma "caixinha" com o programa pronto para rodar. Você não precisa instalar
  Node.js nem nada no ZimaOS.
- **GitHub Actions** = um robô do GitHub. A cada mudança no código, ele **roda os 61 testes**,
  monta a imagem, **testa a imagem simulando um ZimaOS** e só então a publica em
  `ghcr.io/incorpore/chef`.
- **docker-compose** = a "receita de instalação": diz qual imagem usar, qual porta abrir e
  onde guardar seus dados. O ZimaOS lê esse arquivo e faz o resto.

Seus dados ficam **fora** da caixinha, em pastas do ZimaOS. Por isso você pode atualizar ou
reinstalar o app sem perder nada:

| Pasta no ZimaOS | O que guarda |
|---|---|
| `/DATA/AppData/chef/data` | Banco de dados (receitas, usuários, configurações) |
| `/DATA/AppData/chef/uploads` | Fotos e vídeos |

---

## Passo 1 — Deixar a imagem pública no GitHub (só uma vez)

O GitHub cria a imagem sozinho na primeira vez que o código é enviado. Mas, por padrão, ela nasce
**privada**, e o ZimaOS não consegue baixar imagem privada sem senha. Para torná-la pública:

1. Abra **https://github.com/incorpore/chef/actions** e confira se a execução mais recente de
   **"Imagem Docker"** está com ✅ verde. Se estiver amarelo 🟡, espere terminar (de 2 a 10 minutos).
   *Uma execução cinza ⊘ "cancelled" é normal: ela foi substituída por uma mais nova.*
2. Abra a página da imagem: **https://github.com/users/incorpore/packages/container/package/chef**.
   Outros caminhos que levam até ela: o seu perfil → aba **Packages** (https://github.com/incorpore?tab=packages)
   ou a página do repositório → coluna da direita → **Packages → chef**.
3. Nessa página, clique em **Package settings** (à direita, embaixo).
4. Role até **Danger Zone** → **Change visibility** → escolha **Public** → digite `chef` para
   confirmar.
5. Para conferir se deu certo, abra o link do passo 2 numa **janela anônima** do navegador. Se a página
   abrir sem pedir login, a imagem está pública.

> **Prefere manter a imagem privada?** Dá para fazer, mas pelo terminal do ZimaOS (veja o passo 7):
>
> 1. No GitHub, abra *Settings → Developer settings → Personal access tokens → Tokens (classic) →
>    Generate new token (classic)*. Marque **só** `read:packages`, gere o token e copie (começa com `ghp_`).
> 2. No terminal do ZimaOS, faça login (cole o token quando pedir a senha) e baixe a imagem:
>    ```sh
>    sudo docker login ghcr.io -u incorpore
>    sudo docker pull ghcr.io/incorpore/chef:latest
>    ```
> 3. Volte ao painel e instale normalmente (passo 2). Como a imagem já está no ZimaOS, ele não
>    precisa baixá-la de novo. Se o painel insistir em baixar e falhar, instale pelo terminal:
>    ```sh
>    sudo mkdir -p /DATA/AppData/chef
>    sudo nano /DATA/AppData/chef/docker-compose.yml   # cole o conteúdo do arquivo e troque o SETUP_TOKEN
>    sudo docker compose -f /DATA/AppData/chef/docker-compose.yml up -d
>    ```

---

## Passo 2 — Instalar no ZimaOS

1. Abra o painel do ZimaOS no navegador (ex.: `http://192.168.0.50`).
2. Abra a **App Store**.
3. Clique no **"+"** no canto superior direito → **Instalar um app personalizado**
   (*Install a customized app*).
4. No canto superior direito da janela que abriu, clique em **Importar** (*Import*).
5. Copie **todo** o conteúdo do arquivo [`docker-compose.yml`](docker-compose.yml) desta pasta e
   cole na caixa. Clique em **Enviar** (*Submit*).
6. O ZimaOS preenche o formulário sozinho. **Antes de instalar**, procure a variável
   **`SETUP_TOKEN`** e troque `troque-este-codigo` por um código só seu, por exemplo
   `cozinha-da-maria-2026`. Anote esse código.
7. Clique em **Instalar** (*Install*). Em 1 ou 2 minutos aparece o ícone 🍳 **Chef** no painel.

> ⚠️ Se você esquecer de trocar o `SETUP_TOKEN`, o Chef **recusa** criar o administrador e avisa
> o motivo. Isso é proposital: ninguém da sua rede consegue "tomar" o seu site com o código de
> exemplo. Para corrigir: clique nos **⋮** do app → **Configurações**, troque o valor e salve.

---

## Passo 3 — Primeiro acesso

1. Clique no ícone do **Chef** no painel do ZimaOS ou abra `http://IP-DO-ZIMAOS:8484/admin`.
2. Preencha:
   - **Token de instalação**: o código que você escolheu no passo 2;
   - **Nome do site**, **seu nome**, **e-mail** e **senha** (mínimo de 8 caracteres; evite senhas óbvias).
3. Pronto! Você já está no painel. Crie sua primeira receita ou importe uma por URL.

> Depois desse primeiro acesso, o `SETUP_TOKEN` não serve para mais nada. O login passa a ser
> o seu e-mail e a sua senha.

### Quer ver o site já com receitas de exemplo?

No terminal do ZimaOS (veja o passo 7), rode:

```sh
sudo docker exec -u 1000:1000 chef node --disable-warning=ExperimentalWarning scripts/seed.js
```

> Use sempre o `-u 1000:1000`. Ele roda o comando como o mesmo usuário do app, para não
> bagunçar as permissões do banco.

---

## Passo 4 — Usar no celular como app

1. No celular, conectado ao **mesmo Wi‑Fi**, abra `http://IP-DO-ZIMAOS:8484`.
2. No Android/Chrome, toque em **⋮ → Instalar app** ou **Adicionar à tela inicial**. No iPhone/Safari, toque em
   **Compartilhar → Adicionar à Tela de Início**.

> Alguns recursos do navegador só funcionam com **HTTPS**: microfone (comandos de voz),
> notificações dos timers e instalação completa como app. Na rede de casa, por HTTP, as receitas,
> a busca, os timers e o modo cozinha funcionam normalmente. Para ter tudo, veja o passo 6.

---

## Passo 5 — Atualizar para a versão mais nova

Sempre que o código mudar no GitHub, o robô gera uma imagem nova (`latest`). Para trazê‑la:

**Pelo painel:** se o ZimaOS mostrar o aviso de atualização no app Chef, clique em **Atualizar**.

**Pelo terminal** (funciona sempre):

```sh
sudo docker pull ghcr.io/incorpore/chef:latest
sudo docker compose -f /var/lib/casaos/apps/chef/docker-compose.yml up -d
```

Seus dados **não são apagados** em atualizações, porque ficam em `/DATA/AppData/chef`.

> Quer travar numa versão específica? Troque `latest` por `sha-abc1234` (a etiqueta aparece no
> resumo de cada execução em *Actions*) ou, se criar versões no GitHub (tag `v1.2.0`), use `1.2.0`.

---

## Passo 6 (opcional) — Abrir para a internet com domínio e HTTPS

Para o site ser visto por qualquer pessoa (e o Google indexar suas receitas):

1. Use um **túnel** com HTTPS automático. Os mais simples são o **Cloudflare Tunnel** (grátis) e o
   **Tailscale Funnel**. Outra opção é o **Nginx Proxy Manager**, que também roda como app no ZimaOS.
2. Aponte o túnel ou proxy para `http://IP-DO-ZIMAOS:8484`.
3. Nas configurações do app Chef no ZimaOS, mude:
   - `BASE_URL` → `https://receitas.seudominio.com.br`
   - `TRUST_PROXY` → `1`
4. Salve. Com HTTPS, o Chef liga sozinho as proteções extras: cookie seguro, HSTS e
   `upgrade-insecure-requests`.

> Por que `TRUST_PROXY=1`? Atrás de um proxy, todos os visitantes parecem vir do mesmo IP (o do
> proxy). Com `1`, o Chef lê o IP real enviado pelo proxy, e os limites de tentativas de login
> continuam funcionando por pessoa. **Não** use `1` sem proxy: alguém poderia forjar o IP.

---

## Passo 7 — Terminal do ZimaOS (quando precisar)

No ZimaOS, abra **Configurações → Geral → Acesso para desenvolvedores** e ative o **SSH**. Depois, no
seu computador:

```sh
ssh SEU_USUARIO@IP-DO-ZIMAOS
```

Comandos úteis:

| Para… | Comando |
|---|---|
| Ver os registros (logs) do app | `sudo docker logs --tail 100 chef` |
| Ver se está saudável | `sudo docker ps --filter name=chef` (deve aparecer `healthy`) |
| Reiniciar | `sudo docker restart chef` |
| Testar por dentro | `curl http://localhost:8484/healthz` → `{"ok":true,...}` |
| Redefinir senha esquecida | `sudo docker exec -it -u 1000:1000 chef node scripts/reset-password.js seu@email.com` |

---

## Passo 8 (opcional) — E‑mail (SMTP)

Com e‑mail configurado, o Chef ganha:

- **"Esqueci minha senha"** na tela de login (o link chega por e‑mail e vale 1 hora);
- **Convite de usuário**: a pessoa recebe um link para criar a própria senha;
- **Aviso de comentário novo** para você e para o autor da receita;
- **Newsletter**: confirmação de inscrição (duplo opt‑in), boas‑vindas e envio de receitas pelo
  painel (**Painel → Newsletter**). Ao publicar uma receita, o Chef pergunta se você quer enviá‑la.

Sem e‑mail, tudo continua funcionando; essas funções só ficam desligadas.

**Como ligar:** no ZimaOS, abra as configurações do app Chef, preencha as variáveis abaixo e salve.

| Variável | Gmail | Brevo (300 e‑mails/dia grátis) |
|---|---|---|
| `SMTP_HOST` | `smtp.gmail.com` | `smtp-relay.brevo.com` |
| `SMTP_PORT` | `587` | `587` |
| `SMTP_USER` | seu e‑mail do Gmail | o login SMTP mostrado no Brevo |
| `SMTP_PASS` | uma **senha de app** (veja abaixo) | a chave SMTP do Brevo |
| `MAIL_FROM` | `Receitas da Ana <seuemail@gmail.com>` | um remetente verificado no Brevo |

- **Senha de app do Gmail:** ative a *Verificação em duas etapas* na sua conta Google e depois abra
  https://myaccount.google.com/apppasswords. Crie uma senha (ex.: "Chef") e cole os 16 caracteres
  em `SMTP_PASS`. A senha normal do Gmail **não** funciona. O Gmail permite cerca de 500 e‑mails por dia.
- **E‑mail do seu domínio** (Hostinger, Locaweb, Zoho…): use o servidor SMTP do provedor, porta
  `587` (ou `465`) e o e‑mail e a senha da caixa.
- `MAIL_ADMIN` (opcional): quem recebe os avisos. Vazio = os administradores.
- `MAIL_RATE_PER_MIN`: velocidade da newsletter. O padrão (30 por minuto) evita bloqueios.

**Testar:** em **Painel → Configurações → E‑mail (SMTP)**, clique em **Enviar e‑mail de teste**.
Se der erro, a mensagem explica o motivo (senha recusada, porta errada etc.).

> **Endereço do site nos e‑mails:** os links dos e‑mails usam o `BASE_URL`. Se ele estiver vazio, o Chef usa o
> endereço em que você entrou no painel como administrador, que também aparece em *Configurações →
> Endereço do site*. Quem acessa de fora de casa precisa de um endereço público (passo 6).

> **Segurança:** a senha do SMTP fica só nas variáveis do app. Ela não é gravada no banco e não aparece no painel.

---

## Backup (importante!)

Escolha uma das opções:

- **Tudo de uma vez:** copie a pasta `/DATA/AppData/chef` inteira, pelo app **Arquivos** do ZimaOS ou
  pela rede (SMB), para um HD externo ou para a nuvem. Pare o app antes da cópia para garantir um banco consistente.
- **Só as receitas:** no painel do Chef, vá em **Receitas → Exportar backup**. É um arquivo JSON, que pode ser importado
  de volta em **Importar → Em lote**.

---

## Problemas comuns

| O que aparece | Causa | Solução |
|---|---|---|
| *"Falha ao baixar a imagem após tentar 5 métodos de espelho diferentes"*, *pull access denied*, *unauthorized* ou *denied* | A imagem ainda é **privada** (o padrão do GitHub quando o repositório é privado) | Faça o **passo 1**: Package settings → Change visibility → Public |
| "Não encontro a imagem no GitHub" | Ela fica em **Packages**, não em *Releases* nem nos arquivos do repositório | https://github.com/users/incorpore/packages/container/package/chef |
| *port is already allocated* | Outro app já usa a porta 8484 | Nas configurações do app, troque a porta do host para `8485` (ou outra) |
| "O SETUP_TOKEN ainda é o de exemplo" | Você não trocou o código | Edite o app, troque o `SETUP_TOKEN` e salve |
| "Token de instalação inválido" | O código digitado é diferente do configurado | Confira maiúsculas, minúsculas e espaços |
| Esqueci a senha | — | Com e‑mail configurado (passo 8), use **"Esqueci minha senha"** no login. Sem e‑mail, no terminal: `sudo docker exec -it -u 1000:1000 chef node scripts/reset-password.js seu@email.com` e digite a nova senha |
| Fotos não aparecem depois de restaurar um backup | Dono dos arquivos errado | Reinicie o app: ele corrige as permissões sozinho ao iniciar |
| E‑mail de teste: *"Usuário ou senha do SMTP recusados"* | No Gmail, a senha normal não é aceita | Crie uma **senha de app** (passo 8) |
| E‑mail de teste: *"não respondeu"* | Porta bloqueada pela operadora | Tente `SMTP_PORT` `465` ou outro provedor (Brevo) |
| E‑mails caem no spam | Remetente diferente da conta | Use em `MAIL_FROM` o mesmo e‑mail do `SMTP_USER` ou um remetente verificado |
| O ícone do app não aparece no painel | O repositório do GitHub é privado | É só estético; o app funciona normalmente |

---

## Detalhes técnicos (para curiosos)

- **Arquiteturas:** `amd64` (ZimaBoard, ZimaCube, PCs) e `arm64` (Raspberry Pi e similares). O Docker
  escolhe a certa sozinho.
- **Leve:** cerca de 64 MB de download e ~30 MB de RAM em uso, com limite de 512 MB no compose.
- **Seguro por padrão:**
  - O app **não roda como root**: ao iniciar, ele ajusta as pastas para o usuário `1000` e "abaixa" os privilégios.
  - A pasta do banco fica com permissão `700`.
  - O segredo de sessão é gerado sozinho e salvo em `data/.secret`.
- **Saúde:** o Docker consulta `/healthz` a cada 30 s e marca o container como `healthy`.
- **Desligamento limpo:** um `docker stop` fecha o banco corretamente, sem risco de corromper.
- **Logs** limitados a 3 arquivos de 10 MB, para não lotar o disco.
- **Testado automaticamente:** em toda mudança, o GitHub roda
  [`scripts/smoke-test.sh`](../scripts/smoke-test.sh) na imagem. Esse teste:
  - simula as pastas do ZimaOS criadas como root e o acesso por HTTP pelo IP;
  - verifica a instalação com e sem token, o login, a criação de receita e o envio de foto;
  - reinicia o container e confere que nada se perdeu.
