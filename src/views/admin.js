'use strict';
const u = require('../util');
const { icon, avatar, ASSET_VERSION } = require('./layout');
const settings = require('../settings');
const { AD_SLOTS } = require('../monetization');
const { codeCopy } = require('./components');

const esc = u.esc;

function adminLayout({ title, body, user, active = '', scripts = [] }) {
  const s = settings.all();
  const item = (href, ic, label, key) => `<a href="${href}" class="${active === key ? 'active' : ''}">${icon(ic)}<span>${label}</span></a>`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)} · Painel ${esc(s.siteName)}</title><meta name="robots" content="noindex"><meta name="theme-color" content="${esc(s.themeColor)}">
<link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="/icons/icon.svg">
<style>:root{--brand:${esc(s.themeColor)}}</style>
<script>try{var t=localStorage.getItem('chef:theme');if(t)document.documentElement.dataset.theme=t}catch(e){}</script>
<link rel="stylesheet" href="/css/app.css?v=${ASSET_VERSION}"><link rel="stylesheet" href="/css/admin.css?v=${ASSET_VERSION}"></head>
<body class="admin">
${user ? `<aside class="admin-nav">
  <a class="brand" href="/">${icon('chef')}<span>${esc(s.siteName)}</span></a>
  ${item('/admin', 'grid', 'Painel', 'dash')}
  ${item('/admin/receitas', 'list', 'Receitas', 'recipes')}
  ${item('/admin/receitas/nova', 'plus', 'Nova receita', 'new')}
  ${item('/admin/importar', 'download', 'Importar', 'import')}
  ${user.role === 'admin' ? item('/admin/categorias', 'layers', 'Categorias', 'cats') : ''}
  ${item('/admin/comentarios', 'star', 'Comentários', 'comments')}
  ${user.role === 'admin' ? item('/admin/produtos', 'cart', 'Afiliados', 'products') : ''}
  ${user.role === 'admin' ? item('/admin/anuncios', 'flame', 'Anúncios', 'ads') : ''}
  ${user.role === 'admin' ? item('/admin/newsletter', 'share', 'Newsletter', 'newsletter') : ''}
  ${item('/admin/api', 'qr', 'API', 'api')}
  ${user.role === 'admin' ? item('/admin/configuracoes', 'edit', 'Configurações', 'settings') : ''}
  ${user.role === 'admin' ? item('/admin/usuarios', 'users', 'Usuários', 'users') : ''}
  ${user.role === 'admin' ? item('/admin/fotos', 'camera', 'Fotos das receitas', 'photos') : ''}
  ${user.role === 'admin' ? item('/admin/google', 'search', 'Google Search', 'google') : ''}
  ${user.role === 'admin' ? item('/admin/auditoria', 'list', 'Auditoria', 'audit') : ''}
  <a href="/admin/perfil" class="nav-profile ${active === 'profile' ? 'active' : ''}">${avatar(user, 'avatar-xs')}<span>Meu perfil</span></a>
  <a href="/" class="nav-site">${icon('home')}<span>Ver o site</span></a>
  <button class="logout" data-logout>${icon('logout')}<span>Sair</span></button>
</aside>` : ''}
<main class="admin-main">${body}</main>
<div class="toast" role="status" aria-live="polite"></div>
<script src="/js/app.js?v=${ASSET_VERSION}" defer></script>
<script src="/js/admin.js?v=${ASSET_VERSION}" defer></script>
${scripts.map((s2) => `<script src="${s2}?v=${ASSET_VERSION}" defer></script>`).join('')}
</body></html>`;
}

function authPage({ mode, next = '/admin', needsToken = false, prefillToken = '' }) {
  const setup = mode === 'setup';
  const body = `<div class="auth-box">
    <div class="brand-big">${icon('chef')}</div>
    <h1>${setup ? 'Bem-vindo! Vamos configurar seu site' : 'Entrar no painel'}</h1>
    <form data-auth="${setup ? 'setup' : 'login'}" data-next="${esc(next)}">
      ${setup && needsToken ? `<label>Token de instalação<input name="setupToken" value="${esc(prefillToken)}" required autocomplete="off"><small>É o valor de <b>SETUP_TOKEN</b> que você colocou no docker-compose (ou o código mostrado no log do app).</small></label>` : ''}
      ${setup ? '<label>Nome do site<input name="siteName" value="Chef" required maxlength="60"></label><label>Seu nome<input name="name" required maxlength="80"></label>' : ''}
      <label>E-mail<input type="email" name="email" required autocomplete="username"></label>
      <label>Senha<input type="password" name="password" required minlength="8" autocomplete="${setup ? 'new-password' : 'current-password'}"></label>
      <button class="btn btn-primary btn-block">${setup ? 'Criar conta de administrador' : 'Entrar'}</button>
      <p class="form-error" hidden></p>
      ${setup ? '' : '<p class="auth-alt"><a href="/admin/esqueci">Esqueci minha senha</a></p>'}
    </form>
  </div>`;
  return adminLayout({ title: setup ? 'Configuração' : 'Entrar', body, user: null });
}

/** "Esqueci minha senha" (sem login). */
function forgotPage({ mailReady }) {
  const body = `<div class="auth-box">
    <div class="brand-big">${icon('chef')}</div>
    <h1>Esqueci minha senha</h1>
    ${mailReady ? `<p>Digite o e-mail da sua conta. Enviaremos um link para você criar uma nova senha.</p>
    <form data-forgot>
      <label>E-mail<input type="email" name="email" required autocomplete="username"></label>
      <button class="btn btn-primary btn-block">Enviar link</button>
      <p class="form-error" hidden></p>
      <p class="form-ok" hidden></p>
    </form>` : `<p>O envio de e-mail ainda não foi configurado neste site.</p>
    <p>Peça ao administrador para redefinir sua senha, ou, se você for o administrador, use no terminal do servidor:</p>
    <pre><code>sudo docker exec -it -u 1000:1000 chef node scripts/reset-password.js seu@email.com</code></pre>`}
    <p class="auth-alt"><a href="/admin/login">Voltar para o login</a></p>
  </div>`;
  return adminLayout({ title: 'Esqueci minha senha', body, user: null });
}

/** Criar nova senha a partir do link do e-mail (redefinição ou convite). */
function resetPage({ token, valid, invite, email }) {
  const body = `<div class="auth-box">
    <div class="brand-big">${icon('chef')}</div>
    <h1>${invite ? 'Crie sua senha' : 'Nova senha'}</h1>
    ${valid ? `<p>${invite ? 'Bem-vindo(a)! Escolha uma senha para entrar no painel' : 'Escolha uma nova senha para'} <b>${esc(email)}</b>.</p>
    <form data-reset data-reset-key="${esc(token)}">
      <label>Nova senha<input type="password" name="password" required minlength="8" maxlength="200" autocomplete="new-password"></label>
      <label>Repita a senha<input type="password" name="password2" required minlength="8" maxlength="200" autocomplete="new-password"></label>
      <small>Mínimo de 8 caracteres. Evite senhas óbvias (12345678, senha123…).</small>
      <button class="btn btn-primary btn-block">${invite ? 'Criar senha e entrar' : 'Salvar nova senha'}</button>
      <p class="form-error" hidden></p>
    </form>` : `<p>Este link é inválido, já foi usado ou expirou.</p><p><a class="btn btn-primary btn-block" href="/admin/esqueci">Pedir um novo link</a></p>`}
  </div>`;
  return adminLayout({ title: invite ? 'Crie sua senha' : 'Nova senha', body, user: null });
}

/** Newsletter: inscritos, envio de receita para a lista e histórico. */
function newsletterAdminPage({ user, preselect }) {
  return simplePage({ user, title: 'Newsletter', active: 'newsletter', body: `
    <div class="stats" data-nl-stats><p>Carregando…</p></div>
    <section class="panel" data-nl-mail></section>
    <section class="panel">
      <h2>Enviar uma receita para os inscritos</h2>
      <form class="nl-form" data-nl-form data-preselect="${esc(preselect || '')}">
        ${field('Receita', '<select name="recipeId" required data-nl-recipes><option value="">Carregando…</option></select>')}
        ${field('Assunto do e-mail', '<input name="subject" maxlength="150" placeholder="Receita nova: …" data-nl-subject>', 'Curto e com vontade de abrir: até ~50 caracteres funciona melhor.')}
        ${field('Mensagem de abertura (opcional)', '<textarea name="intro" rows="4" maxlength="3000" placeholder="Oi! Essa semana testei uma receita que virou a favorita aqui de casa…"></textarea>')}
        <div class="nl-actions">
          <button type="button" class="btn btn-ghost" data-nl-test>${icon('check')} Enviar teste para mim</button>
          <button class="btn btn-primary" data-nl-send>${icon('share')} Enviar para os inscritos</button>
        </div>
        <p class="form-error" hidden></p>
      </form>
    </section>
    <section class="panel"><h2>Envios</h2><div data-nl-campaigns></div></section>
    <section class="panel"><div class="section-head"><h2>Inscritos</h2><a class="btn btn-ghost btn-sm" href="/api/v1/subscribers?format=csv">${icon('download')} Baixar CSV</a></div>
      <table class="table table-admin"><thead><tr><th>E-mail</th><th>Situação</th><th>Desde</th><th></th></tr></thead><tbody data-nl-subs></tbody></table></section>` });
}

function dashboard({ user }) {
  return adminLayout({ title: 'Painel', user, active: 'dash', body: `
    <header class="admin-head"><h1>Olá, ${esc(user.name.split(' ')[0])} 👋</h1><div><a class="btn btn-primary" href="/admin/receitas/nova">${icon('plus')} Nova receita</a> <a class="btn btn-ghost" href="/admin/importar">${icon('download')} Importar por URL</a></div></header>
    <div class="stats" data-stats><p>Carregando…</p></div>
    ${user.role === 'admin' ? '<a class="panel gsc-mini" href="/admin/google" data-gsc-mini hidden></a>' : ''}
    <div class="two-col"><section class="panel"><h2>Mais vistas</h2><ol data-top></ol></section><section class="panel"><h2>Produtos mais clicados</h2><ol data-top-products></ol></section></div>` });
}

function recipeList({ user, categories = [] }) {
  const catOpts = categories.map((c) => `<option value="${esc(c.slug)}">${esc(`${c.icon || ''} ${c.name}`.trim())}</option>`).join('');
  return adminLayout({ title: 'Receitas', user, active: 'recipes', body: `
    <header class="admin-head"><h1>Receitas</h1><div><a class="btn btn-primary" href="/admin/receitas/nova">${icon('plus')} Nova</a> <a class="btn btn-ghost" href="/api/v1/export" download>${icon('download')} Exportar backup</a></div></header>
    <form class="admin-filter" data-recipe-filter>
      <input type="search" name="q" placeholder="Buscar por título, ingrediente ou código">
      <select name="status"><option value="any">Todas</option><option value="published">Publicadas</option><option value="draft">Rascunhos</option></select>
      <select name="category"><option value="">Todas as categorias</option>${catOpts}</select>
    </form>
    <div class="list-head"><p class="list-count" data-list-count></p><label class="check-all-m"><input type="checkbox" data-check-page-m> Selecionar todas da página</label></div>
    <div class="bulk-bar" data-bulk-bar hidden role="region" aria-label="Ações em massa">
      <div class="bulk-info"><strong data-bulk-count>0</strong> <span data-bulk-label>selecionadas</span>
        <button type="button" class="link" data-bulk-all hidden></button>
        <button type="button" class="link" data-bulk-clear>Limpar seleção</button></div>
      <div class="bulk-actions">
        <button type="button" class="btn btn-sm" data-bulk="publish">✅ Publicar</button>
        <button type="button" class="btn btn-sm" data-bulk="draft">⏸️ Desativar (rascunho)</button>
        <select data-bulk-category aria-label="Mudar categoria"><option value="__">📂 Mudar categoria…</option><option value="">— Sem categoria —</option>${categories.map((c) => `<option value="${c.id}">${esc(`${c.icon || ''} ${c.name}`.trim())}</option>`).join('')}</select>
        ${user.role === 'admin' ? '<button type="button" class="btn btn-sm" data-bulk="feature">⭐ Destacar</button><button type="button" class="btn btn-sm" data-bulk="unfeature">Tirar destaque</button>' : ''}
        <button type="button" class="btn btn-sm btn-danger" data-bulk="delete">🗑️ Excluir</button>
      </div>
    </div>
    <div class="table-wrap"><table class="table table-admin table-recipes"><thead><tr><th class="col-check"><input type="checkbox" data-check-page aria-label="Selecionar todas desta página"></th><th></th><th>Receita</th><th>Código</th><th>Status</th><th>Views</th><th></th></tr></thead><tbody data-recipe-rows></tbody></table></div>
    <div class="pager" data-pager></div>` });
}

function field(label, html, hint = '') {
  return `<label class="field"><span>${label}</span>${html}${hint ? `<small>${hint}</small>` : ''}</label>`;
}

function editor({ user, recipe, categories, products, stockReady = false }) {
  const r = recipe || { title: '', images: [], ingredients: [], steps: [], tags: [], diets: [], servings: 4, servings_unit: 'porções', difficulty: 2, status: 'draft', nutrition: null, video: null };
  const linked = new Set((r.products || []).map((p) => p.id));
  const n = r.nutrition || {};
  const body = `
  <form class="editor" data-editor data-id="${r.id || ''}" data-published="${r.status === 'published' ? 1 : 0}" data-admin="${user.role === 'admin' ? 1 : 0}" data-cover-credit="${esc(r.cover_credit || '')}" data-cover-credit-url="${esc(r.cover_credit_url || '')}">
    <header class="admin-head sticky">
      <h1>${r.id ? 'Editar receita' : 'Nova receita'} ${r.code ? codeCopy(r.code) : ''}</h1>
      <div>
        ${r.id && r.status === 'published' && user.role === 'admin' ? `<a class="btn btn-ghost" href="/admin/newsletter?receita=${r.id}" title="Enviar esta receita para os inscritos da newsletter">📧 Enviar</a>` : ''}
        ${r.id ? `<a class="btn btn-ghost" href="/receita/${esc(r.slug)}" target="_blank">Ver</a> <button type="button" class="btn btn-ghost" data-duplicate>Duplicar</button> <button type="button" class="btn btn-danger" data-delete>Excluir</button>` : ''}
        <select name="status" aria-label="Status"><option value="draft"${r.status === 'draft' ? ' selected' : ''}>Rascunho</option><option value="published"${r.status === 'published' ? ' selected' : ''}>Publicada</option></select>
        <button class="btn btn-primary">${icon('check')} Salvar</button>
      </div>
    </header>
    <div class="editor-grid">
      <div class="editor-main">
        <section class="panel">
          ${field('Título', `<input name="title" value="${esc(r.title)}" required maxlength="140" placeholder="Ex.: Bolo de cenoura com cobertura de chocolate">`)}
          ${field('Resumo', `<textarea name="description" rows="2" maxlength="300" placeholder="Uma frase que dá água na boca (aparece no Google e nos cards)">${esc(r.description)}</textarea>`)}
          ${field('História / introdução', `<textarea name="story" rows="5" placeholder="Conte a história da receita. Aceita **negrito**, *itálico*, listas com - e ## títulos.">${esc(r.story)}</textarea>`)}
        </section>

        <section class="panel">
          <h2>Fotos e vídeo</h2>
          <div class="media-drop" data-dropzone>
            <input type="file" accept="image/*,video/*" multiple data-file-input hidden>
            <p>${icon('download')} Arraste fotos/vídeos aqui ou <button type="button" class="link" data-pick-files>escolha arquivos</button>. A primeira foto é a capa. Imagens são otimizadas antes do envio.</p>
          </div>
          <div class="stock-editor-row">
            ${stockReady
    ? `<button type="button" class="btn btn-sm" data-stock-open>${icon('search')} Buscar foto grátis</button><small class="muted">Pexels, Pixabay e Unsplash · uso comercial liberado · crédito automático</small>`
    : user.role === 'admin' ? `<a class="btn btn-ghost btn-sm" href="/admin/fotos">${icon('search')} Ativar busca de fotos grátis</a><small class="muted">Configure uma chave grátis do Pexels, Pixabay ou Unsplash</small>` : ''}
          </div>
          <p class="cover-credit-line" data-cover-credit-line ${r.cover_credit ? '' : 'hidden'}>📷 <span>${esc(r.cover_credit || '')}</span></p>
          <ul class="media-list" data-media>${[r.cover ? { url: r.cover, caption: '' } : null, ...r.images].filter(Boolean).map((m) => mediaItem(m)).join('')}</ul>
          ${field('Vídeo', `<input name="video" value="${esc(r.video?.url || '')}" placeholder="Link do YouTube, Vimeo, TikTok, Instagram ou envie um arquivo acima">`, 'Vídeos enviados acima preenchem este campo automaticamente.')}
        </section>

        <section class="panel">
          <div class="section-head"><h2>Ingredientes</h2><small>Um por linha. Use “## Massa” para criar grupos.</small></div>
          <div class="split">
            <textarea name="ingredients" rows="12" data-ing-input placeholder="## Massa&#10;3 cenouras médias&#10;3 ovos&#10;1 xícara (chá) de óleo&#10;2 xícaras (chá) de açúcar&#10;2 ½ xícaras (chá) de farinha de trigo&#10;1 colher (sopa) de fermento em pó">${esc(u.ingredientsToText(r.ingredients))}</textarea>
            <div class="parse-preview" data-ing-preview aria-live="polite"></div>
          </div>
        </section>

        <section class="panel">
          <div class="section-head"><h2>Modo de preparo</h2><div><button type="button" class="btn btn-ghost btn-sm" data-steps-paste>Colar texto</button> <button type="button" class="btn btn-ghost btn-sm" data-step-add>${icon('plus')} Passo</button></div></div>
          <ol class="step-editor" data-steps>${r.steps.map((s) => stepItem(s)).join('')}</ol>
          <template data-step-template>${stepItem({ text: '', group: '', image: '', timer: null })}</template>
        </section>

        <section class="panel">
          ${field('Dicas', `<textarea name="tips" rows="4" placeholder="- Use ingredientes em temperatura ambiente&#10;- Dá para congelar por até 3 meses">${esc(r.tips)}</textarea>`)}
        </section>
      </div>

      <aside class="editor-side">
        <section class="panel">
          <h2>Detalhes</h2>
          ${field('Código', `<input name="code" value="${esc(r.code || '')}" placeholder="Gerado automaticamente" maxlength="16" pattern="[A-Za-z0-9-]{3,16}">`, 'Use para buscar/compartilhar: /c/CÓDIGO')}
          ${field('Categoria', `<select name="category_id"><option value="">—</option>${categories.map((c) => `<option value="${c.id}"${c.id === r.category_id ? ' selected' : ''}>${esc(`${c.icon || ''} ${c.name}`)}</option>`).join('')}</select>`)}
          <div class="row3">
            ${field('Preparo (min)', `<input type="number" min="0" name="prep_minutes" value="${r.prep_minutes || ''}">`)}
            ${field('Cozimento', `<input type="number" min="0" name="cook_minutes" value="${r.cook_minutes || ''}">`)}
            ${field('Descanso', `<input type="number" min="0" name="rest_minutes" value="${r.rest_minutes || ''}">`)}
          </div>
          <div class="row2">
            ${field('Rendimento', `<input type="number" min="0.5" step="0.5" name="servings" value="${r.servings}">`)}
            ${field('Unidade', `<input name="servings_unit" value="${esc(r.servings_unit)}" list="yield-units"><datalist id="yield-units"><option>porções</option><option>pessoas</option><option>fatias</option><option>unidades</option><option>pedaços</option></datalist>`)}
          </div>
          ${field('Dificuldade', `<select name="difficulty">${[[1, 'Fácil'], [2, 'Média'], [3, 'Difícil']].map(([v, l]) => `<option value="${v}"${r.difficulty === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`)}
          ${field('Cozinha', `<input name="cuisine" value="${esc(r.cuisine)}" placeholder="Brasileira, Italiana…">`)}
          ${field('Tags', `<input name="tags" value="${esc(r.tags.join(', '))}" placeholder="bolo, café da tarde, fácil">`, 'Separe por vírgula')}
          ${field('Dietas', `<input name="diets" value="${esc(r.diets.join(', '))}" placeholder="vegetariana, sem glúten, sem lactose">`)}
          ${user.role === 'admin' ? `<label class="check"><input type="checkbox" name="featured"${r.featured ? ' checked' : ''}> Destacar na página inicial</label>` : ''}
        </section>
        <section class="panel">
          <h2>Produtos de afiliado</h2>
          ${products.length ? `<div class="product-picks">${products.map((p) => `<label class="check">${p.image ? `<img src="${esc(p.image)}" alt="" width="32" height="32">` : ''}<input type="checkbox" name="products" value="${p.id}"${linked.has(p.id) ? ' checked' : ''}> ${esc(p.title)}</label>`).join('')}</div>` : `<p><small>Nenhum produto cadastrado. <a href="/admin/produtos">Cadastrar produtos da Amazon</a></small></p>`}
        </section>
        <section class="panel">
          <h2>Nutrição <small>(por porção)</small></h2>
          <div class="row2">${[['calories', 'Calorias', 'kcal'], ['protein', 'Proteínas', 'g'], ['carbs', 'Carboidratos', 'g'], ['fat', 'Gorduras', 'g'], ['fiber', 'Fibras', 'g'], ['sodium', 'Sódio', 'mg']].map(([k, l, ph]) => field(l, `<input name="nutrition.${k}" value="${esc(n[k] || '')}" placeholder="${ph}">`)).join('')}</div>
        </section>
        <section class="panel">
          <h2>SEO (Google)</h2>
          ${field('Título para o Google', `<input name="seo_title" value="${esc(r.seo_title || '')}" maxlength="120" placeholder="Gerado a partir do título" data-count="60">`, 'Ideal: até 60 caracteres. Use a palavra-chave principal (ex.: “Bolo de cenoura fofinho”).')}
          ${field('Descrição para o Google', `<textarea name="seo_description" rows="3" maxlength="320" placeholder="Gerada automaticamente se vazia" data-count="155">${esc(r.seo_description || '')}</textarea>`, 'Ideal: 120 a 155 caracteres.')}
          <div class="serp" data-serp aria-label="Prévia no Google"><small data-serp-url></small><strong data-serp-title></strong><p data-serp-desc></p></div>
          ${r.id ? `<div class="gsc-page" data-gsc-page="${esc(r.code)}" hidden></div>` : ''}
        </section>
        <section class="panel">
          <h2>Fonte</h2>
          ${field('Nome', `<input name="source_name" value="${esc(r.source_name)}">`)}
          ${field('URL', `<input name="source_url" type="url" value="${esc(r.source_url)}">`)}
        </section>
      </aside>
    </div>
  <dialog class="stock-dialog" data-stock-dialog aria-labelledby="stock-dialog-title">
    <div class="stock-dialog-head"><h2 id="stock-dialog-title">Buscar foto grátis</h2><button type="button" class="icon-btn" data-stock-close aria-label="Fechar">${icon('x')}</button></div>
    <div class="stock-q stock-dialog-q"><input type="search" data-stock-q aria-label="O que buscar" placeholder="Ex.: bolo de cenoura"><button type="button" class="btn btn-primary btn-sm" data-stock-go>Buscar</button></div>
    <p class="hint">O nome é traduzido para inglês automaticamente (os bancos descrevem as fotos em inglês). Fotos com <b>✓ combina</b> citam o prato na descrição.</p>
    <span class="ph-chip" data-stock-chip></span>
    <div class="ph-grid stock-dialog-grid" data-stock-results></div>
  </dialog>
  </form>
<dialog class="paste-dialog"><form method="dialog"><h3>Colar modo de preparo</h3><p>Um passo por linha (numeração é removida). “## Cobertura” cria grupos.</p><textarea rows="12" data-paste-text></textarea><div><button class="btn" value="cancel">Cancelar</button> <button class="btn btn-primary" value="ok" data-paste-ok>Substituir passos</button></div></form></dialog>`;
  return adminLayout({ title: r.id ? `Editar: ${r.title}` : 'Nova receita', user, active: r.id ? 'recipes' : 'new', body });
}

function mediaItem(m) {
  const isVideo = /\.(mp4|webm|ogg|mov|m4v)(\?|$)/i.test(m.url);
  return `<li class="media-item" draggable="true" data-url="${esc(m.url)}">
    ${isVideo ? `<video src="${esc(m.url)}" muted></video>` : `<img src="${esc(m.url)}" alt="">`}
    <input class="media-caption" value="${esc(m.caption || '')}" placeholder="Legenda">
    <div class="media-tools"><button type="button" class="icon-btn" data-media-left title="Mover">${icon('arrowL')}</button><button type="button" class="icon-btn" data-media-remove title="Remover">${icon('x')}</button><button type="button" class="icon-btn" data-media-right title="Mover">${icon('arrowR')}</button></div>
  </li>`;
}

function stepItem(s) {
  return `<li class="step-item">
    <div class="step-item-head"><input class="step-group" value="${esc(s.group || '')}" placeholder="Grupo (opcional)"><span class="drag" title="Arraste para reordenar">⋮⋮</span><button type="button" class="icon-btn" data-step-up title="Subir">↑</button><button type="button" class="icon-btn" data-step-down title="Descer">↓</button><button type="button" class="icon-btn" data-step-remove title="Remover">${icon('x')}</button></div>
    <textarea class="step-text" rows="3" placeholder="Descreva o passo…">${esc(s.text)}</textarea>
    <div class="step-item-foot">
      <label>${icon('timer')} Timer <input class="step-timer" type="number" min="0" step="1" value="${s.timer ? Math.round(s.timer / 60 * 10) / 10 : ''}" placeholder="min"> min</label>
      <span class="step-img-wrap">${s.image ? `<img src="${esc(s.image)}" alt="">` : ''}<input type="hidden" class="step-image" value="${esc(s.image || '')}"><button type="button" class="btn btn-ghost btn-sm" data-step-photo>${icon('download')} Foto do passo</button></span>
    </div>
  </li>`;
}

function importPage({ user, prefill = '' }) {
  return adminLayout({ title: 'Importar', user, active: 'import', body: `
    <header class="admin-head"><h1>Importar receitas</h1></header>
    <section class="panel">
      <h2>De uma URL</h2>
      <p>Funciona com a maioria dos sites de receitas (lê os dados estruturados <code>schema.org/Recipe</code> que o Google usa; se não houver, tenta identificar ingredientes e modo de preparo).</p>
      <form class="import-form" data-import>
        <input type="url" name="url" value="${esc(prefill)}" placeholder="https://site.com/receita-de-bolo" required>
        <label class="check"><input type="checkbox" name="downloadImages" checked> Baixar imagens para o meu servidor</label>
        <button class="btn btn-primary">${icon('download')} Buscar receita</button>
      </form>
      <div class="import-preview" data-import-preview></div>
    </section>
    <section class="panel">
      <h2>Em lote (arquivo JSON)</h2>
      <p>Aceita o backup exportado por este sistema ou uma lista de objetos <code>schema.org/Recipe</code>.</p>
      <form data-import-json><input type="file" accept="application/json,.json" required><button class="btn btn-ghost">Importar arquivo</button></form>
      <div data-import-json-result></div>
    </section>
    <section class="panel">
      <h2>Atalho no navegador</h2>
      <p>Arraste este botão para a barra de favoritos. Em qualquer site de receitas, clique nele para importar:</p>
      <p><a class="btn btn-ghost" data-bookmarklet href="#">➕ Salvar no ${esc(settings.all().siteName)}</a></p>
      <p><small>No celular com o app instalado, use “Compartilhar” → ${esc(settings.all().siteName)} em qualquer receita.</small></p>
    </section>` });
}

const ACTIONS = {
  'login.ok': '✅ Entrou', 'login.fail': '⚠️ Senha errada', 'login.locked': '🔒 Conta bloqueada por tentativas', 'logout.all': '🚪 Saiu de todos os aparelhos',
  'password.change': '🔑 Trocou a senha', 'password.reset': '🔑 Redefiniu a senha pelo e-mail', 'password.forgot': '📧 Pediu link de nova senha',
  'invite.accepted': '🎉 Aceitou o convite', 'email.change': '📧 Trocou o e-mail', 'profile.update': '✏️ Atualizou o perfil', setup: '🚀 Criou a conta de administrador',
};
const fmtWhen = (d) => { try { return new Date(`${String(d).replace(' ', 'T')}Z`).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: process.env.TZ || 'America/Sao_Paulo' }); } catch { return d; } };

function profilePage({ user, stats, activity }) {
  const since = user.created_at ? new Date(`${String(user.created_at).replace(' ', 'T')}Z`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) : '';
  const pw = (name, label, auto, extra = '') => field(label, `<div class="pw-field"><input type="password" name="${name}" autocomplete="${auto}" ${extra}><button type="button" class="pw-toggle" data-pw-toggle aria-label="Mostrar senha" title="Mostrar senha">👁</button></div>`);
  return adminLayout({ title: 'Meu perfil', user, active: 'profile', body: `
  <div class="profile">
    <section class="panel profile-head">
      <div class="avatar-edit">
        <div class="avatar-frame" data-avatar-preview>${avatar(user, 'avatar-xl')}</div>
        <div class="avatar-actions">
          <button type="button" class="btn btn-sm" data-avatar-pick>${icon('camera')} ${user.avatar ? 'Trocar foto' : 'Adicionar foto'}</button>
          <button type="button" class="btn btn-ghost btn-sm" data-avatar-remove ${user.avatar ? '' : 'hidden'}>Remover</button>
          <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" data-avatar-file hidden>
        </div>
      </div>
      <div class="profile-id">
        <h1 data-profile-name>${esc(user.name)}</h1>
        <p class="profile-mail"><span data-profile-email>${esc(user.email)}</span> <span class="role role-${user.role}">${user.role === 'admin' ? 'Administrador(a)' : 'Autor(a)'}</span></p>
        <ul class="profile-stats">
          <li><strong>${stats.published}</strong><span>publicadas</span></li>
          <li><strong>${stats.drafts}</strong><span>rascunhos</span></li>
          <li><strong>${stats.views}</strong><span>visualizações</span></li>
        </ul>
        ${since ? `<p class="muted">Na cozinha desde ${esc(since)}</p>` : ''}
      </div>
    </section>

    <section class="panel">
      <h2>Informações</h2>
      <form data-profile class="profile-form" novalidate>
        <div class="row2">
          ${field('Nome', `<input name="name" value="${esc(user.name)}" required maxlength="80" autocomplete="name">`)}
          ${field('E-mail de acesso', `<input name="email" type="email" value="${esc(user.email)}" required maxlength="254" autocomplete="email" data-email-orig="${esc(user.email)}">`)}
        </div>
        <div data-email-confirm hidden>${pw('currentPassword', 'Senha atual (para confirmar a troca de e-mail)', 'current-password')}</div>
        ${field('Sobre você', `<textarea name="bio" rows="4" maxlength="2000" data-count="2000" placeholder="Conte um pouco da sua história na cozinha.">${esc(user.bio || '')}</textarea>`, user.role === 'admin' ? 'Aparece na página Sobre do site.' : 'Aparece junto às suas receitas.')}
        <details class="avatar-url"><summary>Usar uma foto da internet (link)</summary>${field('Link da foto (https://…)', `<input name="avatar" value="${esc(user.avatar || '')}" placeholder="https://…" inputmode="url">`)}</details>
        <p class="form-error" hidden></p>
        <div class="form-actions"><button class="btn btn-primary">Salvar alterações</button></div>
      </form>
    </section>

    <section class="panel">
      <h2>Senha</h2>
      <form data-password class="profile-form" novalidate>
        ${pw('currentPassword', 'Senha atual', 'current-password', 'required')}
        <div class="row2">
          ${pw('password', 'Nova senha', 'new-password', 'required minlength="8"')}
          ${pw('confirm', 'Repita a nova senha', 'new-password', 'required minlength="8"')}
        </div>
        <div class="pw-meter" data-pw-meter hidden><span></span><small></small></div>
        <p class="hint">Pelo menos 8 caracteres. Ao trocar, os outros aparelhos saem da conta; este continua conectado.</p>
        <p class="form-error" hidden></p>
        <div class="form-actions"><button class="btn btn-primary">Alterar senha</button></div>
      </form>
    </section>

    <section class="panel">
      <h2>Aparência</h2>
      <div class="theme-pick" role="radiogroup" aria-label="Tema">
        <label><input type="radio" name="theme" value="system" data-theme-pick> 🖥️ Igual ao aparelho</label>
        <label><input type="radio" name="theme" value="light" data-theme-pick> ☀️ Claro</label>
        <label><input type="radio" name="theme" value="dark" data-theme-pick> 🌙 Escuro</label>
      </div>
    </section>

    <section class="panel">
      <h2>Segurança</h2>
      ${activity.length ? `<p class="muted">Atividade recente da sua conta:</p><ul class="activity">${activity.map((a) => `<li><span>${esc(ACTIONS[a.action] || a.action)}</span><time>${esc(fmtWhen(a.created_at))}</time></li>`).join('')}</ul>` : ''}
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" data-logout-all>Sair de todos os aparelhos</button>
        <button type="button" class="btn btn-ghost" data-logout>${icon('logout')} Sair deste aparelho</button>
      </div>
    </section>
  </div>` });
}

/** Campo de imagem: link + botão para enviar arquivo + prévia + remover. */
function imageInput(name, value, fallback = '') {
  const empty = fallback ? 'Capa ilustrada automática' : 'Nenhuma';
  return `<div class="image-input" data-image-input data-empty="${empty}">
    <div class="image-input-preview" data-preview>${value ? `<img src="${value}" alt="">` : `<span class="muted">${empty}</span>`}</div>
    <div class="image-input-ctl">
      <input name="${name}" value="${value}" placeholder="https://... ou /uploads/..." inputmode="url">
      <div class="image-input-btns"><button type="button" class="btn btn-sm" data-image-pick>${icon('camera')} Enviar imagem</button><button type="button" class="btn btn-ghost btn-sm" data-image-clear ${value ? '' : 'hidden'}>Remover</button></div>
      <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" data-image-file hidden>
    </div>
  </div>`;
}

function feedRow(label, url, count) {
  return `<div class="feed-row"><div><strong>${esc(label)}</strong>${count ? ` <small>${count} receitas</small>` : ''}<code>${esc(url)}</code></div><div class="feed-btns"><button type="button" class="btn btn-sm" data-copy-text="${esc(url)}">Copiar</button><a class="btn btn-ghost btn-sm" href="${esc(url)}" target="_blank" rel="noopener">Ver</a></div></div>`;
}

function simplePage({ user, title, active, body }) {
  return adminLayout({ title, user, active, body: `<header class="admin-head"><h1>${title}</h1></header>${body}` });
}

const CATEGORY_ICONS = ['🍰', '🎂', '🍮', '🍫', '🍪', '🍩', '🍨', '🍝', '🍕', '🥩', '🍗', '🥓', '🐟', '🦐', '🥗', '🥦', '🍞', '🥐', '🥪', '🍔', '🥟', '🌮', '🍣', '🍚', '🫘', '🍲', '🥣', '☕', '🥤', '🍹', '🍷', '🥞', '🍳', '🌽', '🍟', '🎉', '🎄', '🐣', '🧒', '🌱', '🥑', '❤️', '⭐', '🔥', '⏱️', '💰', '🍽️'];

function categoriesPage({ user }) {
  return simplePage({ user, title: 'Categorias', active: 'cats', body: `
    <section class="panel"><h2 data-cat-title>Nova categoria</h2>
      <form class="cat-form" data-cat-form>
        <input type="hidden" name="id">
        <div class="cat-form-row">
          <label class="field cat-icon-field"><span>Ícone</span><input name="icon" placeholder="Automático" maxlength="8" class="w-emoji" data-cat-icon></label>
          ${field('Nome da categoria', '<input name="name" required maxlength="60">')}
          ${field('Descrição (opcional)', '<input name="description" maxlength="500">')}
          ${field('Ordem', '<input name="position" type="number" class="w-num">')}
        </div>
        <div class="emoji-pick" role="group" aria-label="Escolha um ícone">${CATEGORY_ICONS.map((e) => `<button type="button" data-emoji="${e}" aria-label="Usar ${e}">${e}</button>`).join('')}</div>
        <p class="hint">Sem ícone, o sistema escolhe um a partir do nome (ex.: "Lanches" → 🥪).</p>
        <div class="form-actions"><button class="btn btn-primary">${icon('check')} Salvar</button><button type="reset" class="btn btn-ghost" data-cat-cancel hidden>Cancelar edição</button></div>
      </form></section>
    <table class="table table-admin"><thead><tr><th>Ícone</th><th>Nome</th><th>Receitas</th><th>Ordem</th><th></th></tr></thead><tbody data-cat-rows></tbody></table>` });
}

function commentsPage({ user }) {
  return simplePage({ user, title: 'Comentários', active: 'comments', body: `
    <div class="tabs" data-comment-tabs><button data-status="pending" class="active">Pendentes</button><button data-status="approved">Aprovados</button><button data-status="spam">Spam</button><button data-status="all">Todos</button></div>
    <div data-comment-list></div>` });
}

function productsPage({ user }) {
  const s = settings.all();
  const utensilOptions = require('../utensils').options().map((o) => `<option value="${esc(o.key)}">${esc(o.label)}</option>`).join('');
  return adminLayout({ title: 'Afiliados', user, active: 'products', scripts: ['/js/products.js'], body: `
  <header class="admin-head"><h1>Afiliados</h1></header>

  <section class="panel aff-add">
    <h2>Adicionar produto pelo link</h2>
    <p class="hint">Cole o link do produto da <b>Amazon</b>, da <b>Shopee</b> ou do <b>Mercado Livre</b>. Título, foto, preço e link de afiliado são preenchidos sozinhos; você só confere e salva.</p>
    <form class="aff-paste" data-aff-paste>
      <input name="url" type="text" inputmode="url" placeholder="https://www.amazon.com.br/dp/…  ·  https://shopee.com.br/…  ·  https://meli.la/…" aria-label="Link do produto" autocomplete="off" spellcheck="false" required>
      <button class="btn btn-primary">Buscar dados</button>
    </form>
    <div class="aff-preview" data-aff-preview hidden>
      <div class="aff-preview-img"><img alt="" data-aff-img><span class="aff-store" data-aff-store></span></div>
      <form class="aff-form" data-aff-form>
        <input type="hidden" name="id"><input type="hidden" name="store"><input type="hidden" name="external_id"><input type="hidden" name="source_url"><input type="hidden" name="aff_url"><input type="hidden" name="asin"><input type="hidden" name="price_value">
        <ul class="aff-warn" data-aff-warn hidden></ul>
        ${field('Título', '<input name="title" required maxlength="200">')}
        <div class="row3">${field('Preço', '<input name="price" placeholder="R$ 89,90">')}${field('Selo (opcional)', '<input name="badge" placeholder="Mais vendido" maxlength="30">')}${field('Utensílio', `<select name="utensil"><option value="">— nenhum —</option>${utensilOptions}</select>`, 'Aparece nas receitas que citam esse utensílio.')}</div>
        ${field('Imagem', '<input name="image" placeholder="https://…">')}
        ${field('Link do produto', '<input name="url" placeholder="https://…">')}
        ${field('Palavras-chave (ingredientes)', '<input name="keywords" placeholder="chocolate, cacau">', 'Opcional: quando um ingrediente contiver uma dessas palavras, aparece um carrinho ao lado dele.')}
        ${field('Descrição curta (opcional)', '<input name="description" maxlength="300">')}
        <label class="check"><input type="checkbox" name="cozinha"> Mostrar também como sugestão geral de cozinha (receitas sem utensílio)</label>
        <div class="aff-actions"><button class="btn btn-primary" data-aff-save>Salvar produto</button><button type="button" class="btn btn-ghost" data-aff-cancel>Cancelar</button></div>
      </form>
    </div>
  </section>

  <div class="two-col aff-cols">
    <section class="panel aff-shopee" data-aff-shopee>
      <div class="aff-head"><h2>Shopee Afiliados</h2><span class="stock-badge" data-shopee-badge>—</span></div>
      <p class="hint">No <a href="https://affiliate.shopee.com.br/open_api" target="_blank" rel="noopener">painel de afiliados da Shopee → Open API</a>, copie o <b>AppID</b> e a <b>Senha</b>. Com isso o site gera links de comissão e encontra utensílios sozinho.</p>
      <form class="aff-shopee-form" data-shopee-form>
        <div class="row2">${field('AppID', '<input name="appId" inputmode="numeric" autocomplete="off" spellcheck="false">')}${field('Senha (Secret)', '<input name="secret" type="password" autocomplete="new-password" spellcheck="false">')}</div>
        <div class="aff-actions"><button class="btn btn-sm btn-primary">Salvar</button><button type="button" class="btn btn-sm" data-shopee-test>Testar conexão</button><button type="button" class="link danger" data-shopee-remove hidden>remover</button></div>
      </form>
      <p class="hint" data-shopee-result></p>
    </section>
    <section class="panel aff-auto" data-aff-auto>
      <h2>Automático</h2>
      <form class="aff-auto-form" data-aff-auto-form>
        <label class="check"><input type="checkbox" name="productAutoRefresh"> Atualizar preço, estoque e link sozinho</label>
        <label class="aff-hours"><span>A cada</span><select name="productRefreshHours"><option value="6">6 horas</option><option value="12">12 horas</option><option value="24">24 horas</option><option value="48">2 dias</option><option value="72">3 dias</option><option value="96">4 dias</option></select></label>
        <label class="check"><input type="checkbox" name="utensilsAuto"> Buscar na Shopee os utensílios citados nas receitas</label>
        <label class="check"><input type="checkbox" name="cookModeProducts"> Mostrar os utensílios no modo cozinha (discreto, sem interromper)</label>
      </form>
      <p class="hint">Amazon: tag <b>${s.amazonTag ? esc(s.amazonTag) : '<span class="warn">não configurada</span>'}</b> (<a href="/admin/configuracoes">alterar</a>) — vai em todos os links da Amazon. Mercado Livre: cole o link gerado no painel de afiliados (<code>meli.la/…</code>).</p>
    </section>
  </div>

  <section class="panel aff-cov" data-aff-cov>
    <div class="aff-head"><h2>Utensílios nas receitas</h2><button type="button" class="btn btn-sm" data-aff-fill>Buscar produtos agora</button></div>
    <p class="hint" data-aff-cov-sum>Carregando…</p>
    <div class="aff-chips" data-aff-cov-list></div>
  </section>

  <section class="panel aff-list-panel">
    <div class="aff-toolbar">
      <div class="aff-filters" role="tablist" data-aff-filters>
        <button type="button" class="on" data-store="">Todos</button><button type="button" data-store="amazon">Amazon</button><button type="button" data-store="shopee">Shopee</button><button type="button" data-store="mercadolivre">Mercado Livre</button><button type="button" data-store="erro">Com erro</button>
      </div>
      <input type="search" placeholder="Filtrar…" aria-label="Filtrar produtos" data-aff-q>
    </div>
    <div class="aff-bulk" data-aff-bulk hidden><b data-aff-sel>0</b> selecionados <button type="button" class="btn btn-sm" data-aff-bulk-do="activate">Ativar</button><button type="button" class="btn btn-sm" data-aff-bulk-do="deactivate">Desativar</button><button type="button" class="btn btn-sm danger" data-aff-bulk-do="delete">Excluir</button></div>
    <div class="aff-list" data-aff-list><p class="empty">Carregando…</p></div>
  </section>` });
}

function adsPage({ user }) {
  const s = settings.all();
  return simplePage({ user, title: 'Anúncios', active: 'ads', body: `
    <section class="panel">
      <p>Anúncios estão <b>${s.adsEnabled ? 'ativados' : 'desativados'}</b>. ${s.adsenseClient ? `AdSense: <code>${esc(s.adsenseClient)}</code>` : 'Configure o Google AdSense em <a href="/admin/configuracoes">Configurações</a> ou cole códigos de qualquer rede abaixo.'}</p>
      <form class="ad-form" data-ad-form>
        <input type="hidden" name="id">
        <div class="row3">${field('Nome', '<input name="name" required placeholder="Banner topo">')}${field('Posição', `<select name="slot">${Object.entries(AD_SLOTS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>`)}${field('Dispositivo', '<select name="device"><option value="all">Todos</option><option value="mobile">Só celular</option><option value="desktop">Só computador</option></select>')}</div>
        ${field('Código HTML do anúncio', '<textarea name="html" rows="6" placeholder="&lt;ins class=&quot;adsbygoogle&quot; ...&gt;&lt;/ins&gt;&lt;script&gt;(adsbygoogle=window.adsbygoogle||[]).push({});&lt;/script&gt;  — ou —  &lt;a href=&quot;...&quot;&gt;&lt;img src=&quot;banner.jpg&quot;&gt;&lt;/a&gt;"></textarea>', 'AdSense, Amazon Native Ads, banners próprios ou patrocinadores.')}
        <div class="row3">${field('Peso (rotação)', '<input type="number" name="weight" min="1" value="1">')}<label class="check"><input type="checkbox" name="active" checked> Ativo</label><div><button class="btn btn-primary">Salvar anúncio</button> <button type="reset" class="btn btn-ghost">Limpar</button></div></div>
      </form>
    </section>
    <table class="table table-admin"><thead><tr><th>Nome</th><th>Posição</th><th>Dispositivo</th><th>Impressões</th><th>Ativo</th><th></th></tr></thead><tbody data-ad-rows></tbody></table>` });
}

function settingsPage({ user, categories = [], siteUrl = '' }) {
  const s = settings.all();
  const v = (k) => esc(s[k]);
  return simplePage({ user, title: 'Configurações', active: 'settings', body: `
  <form class="settings-form" data-settings>
    <section class="panel"><h2>Site</h2>
      <div class="row2">${field('Nome do site', `<input name="siteName" value="${v('siteName')}">`)}${field('Slogan', `<input name="tagline" value="${v('tagline')}">`)}</div>
      ${field('Descrição (SEO)', `<textarea name="description" rows="2">${v('description')}</textarea>`)}
      <div class="row3">${field('Cor principal', `<input type="color" name="themeColor" value="${v('themeColor')}">`)}${field('Logo', imageInput('logo', v('logo')))}${field('Receitas por página', `<input type="number" min="4" max="48" name="recipesPerPage" value="${v('recipesPerPage')}">`)}</div>
      ${field('Nome do autor', `<input name="authorName" value="${v('authorName')}">`)}
      ${field('Texto "Sobre"', `<textarea name="aboutText" rows="5">${v('aboutText')}</textarea>`)}
    </section>
    <section class="panel"><h2>Redes sociais</h2><div class="row3">${Object.keys(s.social).map((k) => field(k, `<input name="social.${k}" value="${esc(s.social[k])}" placeholder="https://">`)).join('')}</div></section>
    <section class="panel"><h2>Google Analytics, Tag Manager e pixels</h2>
      <p><small>Basta colar os IDs — os scripts são inseridos automaticamente e respeitam o consentimento de cookies (LGPD / Consent Mode v2).</small></p>
      <div class="row2">${field('Google Analytics 4 (ID de medição)', `<input name="ga4Id" value="${v('ga4Id')}" placeholder="G-XXXXXXXXXX">`)}${field('Google Tag Manager', `<input name="gtmId" value="${v('gtmId')}" placeholder="GTM-XXXXXXX">`)}
      ${field('Meta (Facebook/Instagram) Pixel', `<input name="metaPixelId" value="${v('metaPixelId')}" placeholder="123456789012345">`)}${field('Microsoft Clarity', `<input name="clarityId" value="${v('clarityId')}" placeholder="abcd1234ef">`)}</div>
      ${field('Cloudflare Web Analytics (token)', `<input name="cfBeaconToken" value="${v('cfBeaconToken')}" placeholder="32 letras e números" spellcheck="false">`, 'Na Cloudflare: Analytics &amp; Logs → Web Analytics → seu site → <b>Manage site</b> → copie o <code>token</code> do trecho de código. <b>Desligue a "instalação automática"</b> (Automatic setup) lá, senão o navegador mostra avisos de CSP, porque o script injetado pela Cloudflare não é autorizado pela política de segurança do site.')}
      <label class="check"><input type="checkbox" name="consentBanner"${s.consentBanner ? ' checked' : ''}> Exibir aviso de cookies e pedir consentimento (recomendado — exigido pela LGPD e pelo Google AdSense)</label>
      ${field('Texto do aviso de cookies', `<input name="privacyText" value="${v('privacyText')}">`)}
    </section>
    <section class="panel"><h2>Verificação de propriedade</h2>
      <p><small>Cole apenas o código do atributo <code>content</code> da meta tag fornecida por cada serviço.</small></p>
      <div class="row2">${field('Google Search Console', `<input name="googleSiteVerification" value="${v('googleSiteVerification')}">`)}${field('Bing Webmaster', `<input name="bingSiteVerification" value="${v('bingSiteVerification')}">`)}
      ${field('Pinterest', `<input name="pinterestVerification" value="${v('pinterestVerification')}">`)}${field('Facebook (domínio)', `<input name="facebookDomainVerification" value="${v('facebookDomainVerification')}">`)}</div>
    </section>
    <section class="panel" id="pinterest"><h2>📌 Pinterest (publicação automática)</h2>
      <p>O Pinterest pode criar um Pin sozinho para cada receita nova, a partir de um <b>feed</b>. Cada Pin usa uma imagem vertical (1000×1500) gerada pelo site, com foto, nome da receita, tempo e o endereço do site.</p>
      ${siteUrl ? '' : '<p class="form-error">Defina o <b>Endereço do site</b> (na seção E-mail) ou a variável BASE_URL: o Pinterest precisa do endereço público completo.</p>'}
      <div class="feed-list">
        ${feedRow('Todas as receitas', `${siteUrl}/feed/pinterest.xml`)}
        ${categories.filter((c) => c.count).map((c) => feedRow(`${c.icon || ''} ${c.name}`.trim(), `${siteUrl}/feed/pinterest.xml?categoria=${encodeURIComponent(c.slug)}`, c.count)).join('')}
      </div>
      <details class="howto"><summary>Como ligar no Pinterest (5 minutos)</summary><ol>
        <li>Use uma <b>conta comercial</b> do Pinterest (é grátis; dá para converter a sua em Configurações → Conta).</li>
        <li><b>Reivindique o site</b>: Configurações → Contas reivindicadas → Sites. Escolha "Adicionar tag HTML", copie só o código do <code>content</code> e cole em <b>Verificação → Pinterest</b> aqui nesta página. Salve e confirme no Pinterest.</li>
        <li>Crie uma <b>pasta</b> para cada feed que quiser (ex.: "Bolos", ou uma pasta só com todas as receitas).</li>
        <li>No Pinterest: Configurações → <b>Criar Pins em massa</b> → <b>Publicar automaticamente</b> (Auto-publish) → cole o endereço do feed e escolha a pasta. Repita para cada categoria.</li>
        <li>Pronto: o Pinterest confere o feed regularmente (até 1 vez por dia) e publica as receitas novas, até 200 Pins por dia.</li>
      </ol><p><small>Dica: com a verificação do site feita, os Pins viram <b>Rich Pins</b> (mostram ingredientes e tempo) automaticamente, porque as páginas já têm os dados estruturados de receita.</small></p></details>
    </section>
    <section class="panel"><h2>Compartilhamento</h2>
      <div class="row2">${field('Botões de compartilhar (ordem)', `<input name="shareNetworks" value="${v('shareNetworks')}">`, 'Opções: whatsapp, pinterest, facebook, telegram, x, email')}${field('@ no X/Twitter', `<input name="twitterHandle" value="${v('twitterHandle')}" placeholder="@seusite">`)}</div>
      ${field('Imagem padrão para compartilhamento (1200×630)', imageInput('defaultOgImage', v('defaultOgImage')), 'Usada quando a página não tem foto própria.')}
    </section>
    <section class="panel"><h2>Receitas sem foto</h2>
      <p>Sem imagem escolhida, cada receita sem foto ganha uma <b>capa ilustrada automática</b> (cor + emoji do prato). Se preferir, envie uma imagem padrão do seu site para usar no lugar.</p>
      ${field('Imagem padrão das receitas', imageInput('defaultRecipeImage', v('defaultRecipeImage'), '/icons/placeholder.svg'), 'Ideal: 1200×900 (formato 4:3). Deixe vazio para usar a capa ilustrada.')}
    </section>
    <section class="panel"><h2>Amazon Associados</h2>
      <div class="row2">${field('Tag de associado', `<input name="amazonTag" value="${v('amazonTag')}" placeholder="seusite-20">`)}${field('Aviso de afiliado', `<input name="amazonDisclosure" value="${v('amazonDisclosure')}">`)}</div>
    </section>
    <section class="panel"><h2>Anúncios</h2>
      <label class="check"><input type="checkbox" name="adsEnabled"${s.adsEnabled ? ' checked' : ''}> Exibir anúncios</label>
      <div class="row2">${field('Google AdSense — ID do editor', `<input name="adsenseClient" value="${v('adsenseClient')}" placeholder="ca-pub-0000000000000000">`, 'Carrega o script do AdSense (inclui Anúncios Automáticos se ativados na sua conta AdSense).')}${field('ads.txt', `<textarea name="adsTxt" rows="2" placeholder="Gerado automaticamente a partir do AdSense">${v('adsTxt')}</textarea>`)}</div>
    </section>
    <section class="panel" id="email"><h2>E-mail (SMTP)</h2>
      <div class="mail-status" data-mail-status><p>Verificando…</p></div>
      <p><small>Servidor, usuário e senha do SMTP ficam nas <b>variáveis do app</b> (no ZimaOS: ⋮ do app → Configurações; ou no <code>docker-compose.yml</code>): <code>SMTP_HOST</code>, <code>SMTP_PORT</code>, <code>SMTP_USER</code>, <code>SMTP_PASS</code>, <code>MAIL_FROM</code>. Assim a senha nunca fica gravada no banco nem aparece na tela.</small></p>
      ${field('Endereço do site (usado nos links dos e-mails)', `<input name="siteUrl" value="${v('siteUrl')}" placeholder="http://192.168.0.50:8484 ou https://receitas.meusite.com.br">`, 'Preenchido automaticamente no seu login. Se você usar domínio próprio, coloque-o aqui. Se a variável BASE_URL estiver definida, ela tem prioridade.')}
      <label class="check"><input type="checkbox" name="notifyComments"${s.notifyComments ? ' checked' : ''}> Avisar por e-mail quando chegar comentário novo (para o autor da receita e os administradores)</label>
      <label class="check"><input type="checkbox" name="newsletterDoubleOptIn"${s.newsletterDoubleOptIn ? ' checked' : ''}> Newsletter com confirmação por e-mail (recomendado pela LGPD e evita listas falsas)</label>
      <label class="check"><input type="checkbox" name="newsletterWelcome"${s.newsletterWelcome ? ' checked' : ''}> Enviar e-mail de boas-vindas ao confirmar a inscrição</label>
    </section>
    <section class="panel"><h2>Comunidade</h2>
      <label class="check"><input type="checkbox" name="commentsModeration"${s.commentsModeration ? ' checked' : ''}> Moderar comentários antes de publicar</label>
      <label class="check"><input type="checkbox" name="newsletterEnabled"${s.newsletterEnabled ? ' checked' : ''}> Mostrar formulário de newsletter</label>
      <p><a href="/admin/newsletter">Gerenciar newsletter e inscritos →</a></p>
    </section>
    <section class="panel"><h2>Avançado</h2>${field('HTML extra no &lt;head&gt;', `<textarea name="headHtml" rows="4" placeholder="Outras ferramentas de medição">${v('headHtml')}</textarea>`, 'Atenção: código inserido aqui roda em todas as páginas. Use apenas códigos de fontes confiáveis.')}</section>
    <button class="btn btn-primary btn-lg">Salvar configurações</button>
  </form>
  <section class="panel"><h2>Minha conta</h2><p>Nome, foto, e-mail e senha agora ficam em <a href="/admin/perfil">Meu perfil</a>.</p></section>` });
}

function apiPage({ user }) {
  return simplePage({ user, title: 'API', active: 'api', body: `
    <section class="panel"><p>Use chaves para criar e editar receitas por integrações (Zapier, n8n, scripts, apps). Documentação: <a href="/api/docs">/api/docs</a> · <a href="/api/v1/openapi.json">OpenAPI</a></p>
    <form class="inline-form" data-key-form><input name="name" placeholder="Nome da chave (ex.: n8n)" required><button class="btn btn-primary">Gerar chave</button></form>
    <div class="key-reveal" data-key-reveal hidden></div></section>
    <table class="table table-admin"><thead><tr><th>Nome</th><th>Prefixo</th><th>Criada</th><th>Último uso</th><th></th></tr></thead><tbody data-key-rows></tbody></table>` });
}

function usersPage({ user }) {
  return simplePage({ user, title: 'Usuários', active: 'users', body: `
    <section class="panel"><form class="inline-form" data-user-form><input name="name" placeholder="Nome" required maxlength="80"><input name="email" type="email" placeholder="E-mail" required><input name="password" type="password" placeholder="Senha (mín. 8)" minlength="8" data-user-pass required><select name="role"><option value="author">Autor</option><option value="admin">Administrador</option></select>
      <label class="check" data-invite-wrap hidden><input type="checkbox" name="invite" data-invite> Enviar convite por e-mail (a pessoa cria a própria senha)</label>
      <button class="btn btn-primary">Adicionar</button></form></section>
    <table class="table table-admin"><thead><tr><th>Nome</th><th>E-mail</th><th>Papel</th><th></th></tr></thead><tbody data-user-rows></tbody></table>` });
}

function photosPage({ user }) {
  return adminLayout({ title: 'Fotos das receitas', user, active: 'photos', body: `
  <header class="admin-head"><h1>Fotos das receitas</h1></header>

  <section class="panel ph-keys" data-ph-keys>
    <div class="ph-keys-line" data-ph-keys-line hidden><span data-ph-keys-status></span><button type="button" class="link" data-ph-keys-edit>alterar chaves</button></div>
    <div class="ph-keys-form" data-ph-keys-form>
      <h2>Bancos de imagens grátis</h2>
      <p class="hint">Fotos com licença para uso comercial (inclusive com anúncios). Basta uma chave; com as duas há mais opções.</p>
      <div class="stock-keys">
        <form class="stock-key" data-stock-key="pexels">
          <div class="stock-key-head"><strong>Pexels</strong><span class="stock-badge" data-stock-badge="pexels"></span></div>
          <p class="hint">Chave grátis em <a href="https://www.pexels.com/api/new/" target="_blank" rel="noopener">pexels.com/api</a>.</p>
          <div class="inline-form"><input name="key" placeholder="Cole a chave do Pexels" autocomplete="off" spellcheck="false"><button class="btn btn-sm">Salvar</button></div>
        </form>
        <form class="stock-key" data-stock-key="pixabay">
          <div class="stock-key-head"><strong>Pixabay</strong><span class="stock-badge" data-stock-badge="pixabay"></span></div>
          <p class="hint">Crie a conta em <a href="https://pixabay.com/accounts/register/" target="_blank" rel="noopener">pixabay.com</a> e copie a chave em <a href="https://pixabay.com/api/docs/" target="_blank" rel="noopener">api/docs</a>.</p>
          <div class="inline-form"><input name="key" placeholder="Cole a chave do Pixabay" autocomplete="off" spellcheck="false"><button class="btn btn-sm">Salvar</button></div>
        </form>
        <form class="stock-key" data-stock-key="unsplash">
          <div class="stock-key-head"><strong>Unsplash</strong><span class="stock-badge" data-stock-badge="unsplash"></span></div>
          <p class="hint">Em <a href="https://unsplash.com/oauth/applications" target="_blank" rel="noopener">unsplash.com/developers</a>, crie um app e copie a <b>Access Key</b>. Modo de teste: 50 buscas/hora; peça a aprovação (grátis) para 5.000/hora. As fotos ficam no servidor do Unsplash.</p>
          <div class="inline-form"><input name="key" placeholder="Cole a Access Key do Unsplash" autocomplete="off" spellcheck="false"><button class="btn btn-sm">Salvar</button></div>
        </form>
      </div>
    </div>
  </section>

  <section class="panel ph-review" data-ph-review hidden>
    <div class="ph-tabs" role="tablist">
      <button type="button" role="tab" class="ph-tab on" data-ph-mode="sem" aria-selected="true">Sem foto <b data-ph-count="sem">0</b></button>
      <button type="button" role="tab" class="ph-tab" data-ph-mode="bancos" aria-selected="false">Fotos dos bancos <b data-ph-count="bancos">0</b><small>conferir</small></button>
    </div>
    <div class="ph-undo" data-ph-undo hidden><span data-ph-undo-text></span><button type="button" class="btn btn-sm" data-ph-undo-btn>Desfazer</button></div>
    <div class="ph-stage" data-ph-stage>
      <div class="ph-head">
        <div class="ph-progress"><span data-ph-pos>—</span><div class="nl-bar"><span data-ph-bar></span></div></div>
        <h2 class="ph-title" data-ph-title>Carregando…</h2>
        <p class="ph-desc" data-ph-desc></p>
        <div class="ph-current" data-ph-current hidden><img alt="" data-ph-current-img><div><small>Foto atual</small><span data-ph-current-credit></span><button type="button" class="link danger" data-ph-remove>Remover esta foto</button></div></div>
      </div>
      <div class="ph-search">
        <span class="ph-chip" data-ph-chip></span>
        <form class="ph-q" data-ph-q hidden><input name="q" aria-label="Buscar outra coisa" placeholder="Ex.: carrot cake, feijoada"><button class="btn btn-sm btn-primary">Buscar</button></form>
        <button type="button" class="link" data-ph-q-open>buscar outra coisa</button>
      </div>
      <div class="ph-grid" data-ph-grid></div>
      <div class="ph-actions">
        <button type="button" class="btn btn-ghost" data-ph-prev>← Anterior</button>
        <span class="ph-keys-hint">Teclas: <kbd>1</kbd>–<kbd>6</kbd> escolher · <kbd>→</kbd> pular</span>
        <button type="button" class="btn" data-ph-skip>Nenhuma combina · pular →</button>
      </div>
    </div>
    <div class="ph-empty" data-ph-empty hidden></div>
  </section>

  <section class="panel ph-auto" data-ph-auto hidden>
    <h2>Automático</h2>
    <p class="hint">Coloca foto sozinho só quando a descrição da foto confirma o prato (ex.: "carrot cake" para bolo de cenoura). As que ficarem em dúvida continuam na aba <b>Sem foto</b> para você escolher.</p>
    <div class="form-actions">
      <button type="button" class="btn btn-primary" data-stock-auto>${icon('camera')} Buscar fotos para as sem foto</button>
      <button type="button" class="btn btn-ghost" data-stock-stop hidden>Parar</button>
      <button type="button" class="btn btn-ghost danger" data-ph-remove-all><span>Remover todas as fotos dos bancos (<b data-ph-count="bancos2">0</b>)</span></button>
    </div>
    <div class="stock-progress" data-stock-progress hidden><div class="nl-bar"><span data-stock-bar></span></div><p data-stock-progress-text></p><ul class="stock-log" data-stock-log></ul></div>
  </section>`, scripts: ['/js/stock.js'] });
}

function googlePage({ user }) {
  return adminLayout({ title: 'Google Search', user, active: 'google', body: `
  <header class="admin-head"><h1>Google Search</h1>
    <div class="gsc-filters" data-gsc-filters hidden>
      <label class="sr-only" for="gsc-days">Período</label>
      <select id="gsc-days" data-gsc-days><option value="7">Últimos 7 dias</option><option value="28" selected>Últimos 28 dias</option><option value="90">Últimos 3 meses</option></select>
      <label class="sr-only" for="gsc-site">Propriedade</label>
      <select id="gsc-site" data-gsc-site></select>
    </div>
  </header>

  <section class="panel gsc-setup" data-gsc-setup hidden>
    <h2>Ligar o Google Search Console</h2>
    <p>Veja aqui no painel quantas pessoas encontram suas receitas no Google, com quais buscas e em que posição, e envie o sitemap com um clique. A ligação usa uma <b>conta de serviço</b> do Google, um "usuário robô" que só lê os dados do seu site.</p>
    <ol class="steps-howto">
      <li>Abra <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noopener">console.cloud.google.com</a> e crie um projeto (ex.: "Chef").</li>
      <li>Ative a API: <a href="https://console.cloud.google.com/apis/library/searchconsole.googleapis.com" target="_blank" rel="noopener">Google Search Console API</a> → <b>Ativar</b>.</li>
      <li>Vá em <a href="https://console.cloud.google.com/iam-admin/serviceaccounts" target="_blank" rel="noopener">IAM → Contas de serviço</a> → <b>Criar conta de serviço</b> (nome: "chef"). Não precisa dar nenhum papel.</li>
      <li>Abra a conta criada → aba <b>Chaves</b> → <b>Adicionar chave</b> → <b>Criar nova chave</b> → <b>JSON</b>. Um arquivo será baixado.</li>
      <li>Envie esse arquivo abaixo.</li>
      <li>No <a href="https://search.google.com/search-console" target="_blank" rel="noopener">Search Console</a>, na sua propriedade: <b>Configurações → Usuários e permissões → Adicionar usuário</b>, cole o e-mail da conta de serviço (aparece aqui depois do envio) com permissão <b>Completo</b>.</li>
    </ol>
    <div class="gsc-upload">
      <label class="btn btn-primary">${icon('download')} Enviar arquivo JSON<input type="file" accept="application/json,.json" data-gsc-file hidden></label>
      <details><summary>ou colar o conteúdo do arquivo</summary><textarea rows="5" data-gsc-paste placeholder='{"type": "service_account", ...}'></textarea><button type="button" class="btn btn-sm" data-gsc-paste-save>Salvar chave</button></details>
    </div>
    <p class="hint">A chave fica só no servidor (pasta de dados, com acesso restrito) e nunca é exibida de novo. Você pode removê-la a qualquer momento.</p>
  </section>

  <section class="panel gsc-account" data-gsc-account hidden>
    <div><small>Conta de serviço</small><code data-gsc-email></code></div>
    <div class="gsc-account-btns"><button type="button" class="btn btn-sm" data-gsc-copy-email>Copiar e-mail</button><button type="button" class="btn btn-ghost btn-sm" data-gsc-remove>Remover chave</button></div>
    <p class="gsc-msg" data-gsc-msg hidden></p>
  </section>

  <div class="gsc-report" data-gsc-report hidden>
    <p class="gsc-range" data-gsc-range></p>
    <div class="gsc-kpis" role="radiogroup" aria-label="Métrica do gráfico" data-gsc-kpis></div>
    <section class="panel gsc-chart-card">
      <div class="gsc-chart-head"><h2 data-gsc-chart-title>Cliques por dia</h2><small data-gsc-chart-note></small></div>
      <div class="gsc-chart" data-gsc-chart></div>
      <details class="gsc-table-view"><summary>Ver em tabela</summary><div data-gsc-daily></div></details>
    </section>
    <section class="panel gsc-ops">
      <div class="gsc-chart-head"><h2>Oportunidades para subir no Google</h2><small>ajustes de texto com maior chance de ganho</small></div>
      <div class="gsc-ops-tabs" role="tablist"><button type="button" class="on" data-gsc-op="almost">Quase na 1ª página <b data-gsc-op-n="almost">0</b></button><button type="button" data-gsc-op="ctr">Aparece, mas não clicam <b data-gsc-op-n="ctr">0</b></button></div>
      <p class="hint" data-gsc-op-hint></p>
      <div data-gsc-ops></div>
    </section>
    <div class="two-col">
      <section class="panel"><h2>Buscas que trazem visitas</h2><div data-gsc-queries></div></section>
      <section class="panel"><h2>Receitas mais vistas no Google</h2><div data-gsc-pages></div></section>
    </div>
    <div class="two-col">
      <section class="panel"><h2>Aparelhos</h2><div data-gsc-devices></div></section>
      <section class="panel"><h2>Sitemap</h2><div data-gsc-sitemaps></div><button type="button" class="btn btn-sm" data-gsc-submit>${icon('share')} Enviar sitemap agora</button></section>
    </div>
  </div>
  <p class="gsc-error form-error" data-gsc-error hidden></p>`, scripts: ['/js/gsc.js'] });
}

function auditPage({ user }) {
  return simplePage({ user, title: 'Auditoria', active: 'audit', body: `
    <section class="panel"><p>Registro das ações sensíveis (logins, falhas de login, chaves de API, configurações, exclusões). IPs são guardados apenas como hash.</p>
    <button class="btn btn-ghost btn-sm" data-logout-all>Sair de todos os aparelhos</button></section>
    <table class="table table-admin"><thead><tr><th>Quando</th><th>Usuário</th><th>Ação</th><th>Detalhe</th><th>IP (hash)</th></tr></thead><tbody data-audit-rows></tbody></table>` });
}

function forbidden({ user }) {
  return simplePage({ user, title: 'Sem permissão', active: '', body: '<section class="panel"><p>Você só pode editar as suas próprias receitas.</p><p><a class="btn" href="/admin/receitas">Voltar</a></p></section>' });
}

module.exports = { photosPage, googlePage, profilePage, forgotPage, resetPage, newsletterAdminPage, auditPage, forbidden, adminLayout, authPage, dashboard, recipeList, editor, importPage, categoriesPage, commentsPage, productsPage, adsPage, settingsPage, apiPage, usersPage };
