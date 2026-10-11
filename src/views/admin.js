'use strict';
const u = require('../util');
const { icon, ASSET_VERSION } = require('./layout');
const settings = require('../settings');
const { AD_SLOTS } = require('../monetization');

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
  ${user.role === 'admin' ? item('/admin/produtos', 'cart', 'Afiliados Amazon', 'products') : ''}
  ${user.role === 'admin' ? item('/admin/anuncios', 'flame', 'Anúncios', 'ads') : ''}
  ${item('/admin/api', 'qr', 'API', 'api')}
  ${user.role === 'admin' ? item('/admin/configuracoes', 'edit', 'Configurações', 'settings') : ''}
  ${user.role === 'admin' ? item('/admin/usuarios', 'users', 'Usuários', 'users') : ''}
  ${user.role === 'admin' ? item('/admin/auditoria', 'list', 'Auditoria', 'audit') : ''}
  <button class="logout" data-logout>${icon('x')}<span>Sair</span></button>
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
    </form>
  </div>`;
  return adminLayout({ title: setup ? 'Configuração' : 'Entrar', body, user: null });
}

function dashboard({ user }) {
  return adminLayout({ title: 'Painel', user, active: 'dash', body: `
    <header class="admin-head"><h1>Olá, ${esc(user.name.split(' ')[0])} 👋</h1><div><a class="btn btn-primary" href="/admin/receitas/nova">${icon('plus')} Nova receita</a> <a class="btn btn-ghost" href="/admin/importar">${icon('download')} Importar por URL</a></div></header>
    <div class="stats" data-stats><p>Carregando…</p></div>
    <div class="two-col"><section class="panel"><h2>Mais vistas</h2><ol data-top></ol></section><section class="panel"><h2>Produtos mais clicados</h2><ol data-top-products></ol></section></div>` });
}

function recipeList({ user }) {
  return adminLayout({ title: 'Receitas', user, active: 'recipes', body: `
    <header class="admin-head"><h1>Receitas</h1><div><a class="btn btn-primary" href="/admin/receitas/nova">${icon('plus')} Nova</a> <a class="btn btn-ghost" href="/api/v1/export" download>${icon('download')} Exportar backup</a></div></header>
    <form class="admin-filter" data-recipe-filter><input type="search" name="q" placeholder="Buscar por título, ingrediente ou código"><select name="status"><option value="any">Todas</option><option value="published">Publicadas</option><option value="draft">Rascunhos</option></select></form>
    <table class="table table-admin"><thead><tr><th></th><th>Receita</th><th>Código</th><th>Status</th><th>Views</th><th></th></tr></thead><tbody data-recipe-rows></tbody></table>
    <div class="pager" data-pager></div>` });
}

function field(label, html, hint = '') {
  return `<label class="field"><span>${label}</span>${html}${hint ? `<small>${hint}</small>` : ''}</label>`;
}

function editor({ user, recipe, categories, products }) {
  const r = recipe || { title: '', images: [], ingredients: [], steps: [], tags: [], diets: [], servings: 4, servings_unit: 'porções', difficulty: 2, status: 'draft', nutrition: null, video: null };
  const linked = new Set((r.products || []).map((p) => p.id));
  const n = r.nutrition || {};
  const body = `
  <form class="editor" data-editor data-id="${r.id || ''}">
    <header class="admin-head sticky">
      <h1>${r.id ? 'Editar receita' : 'Nova receita'} ${r.code ? `<span class="code-chip static">#${esc(r.code)}</span>` : ''}</h1>
      <div>
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
        </section>
        <section class="panel">
          <h2>Fonte</h2>
          ${field('Nome', `<input name="source_name" value="${esc(r.source_name)}">`)}
          ${field('URL', `<input name="source_url" type="url" value="${esc(r.source_url)}">`)}
        </section>
      </aside>
    </div>
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

function simplePage({ user, title, active, body }) {
  return adminLayout({ title, user, active, body: `<header class="admin-head"><h1>${title}</h1></header>${body}` });
}

function categoriesPage({ user }) {
  return simplePage({ user, title: 'Categorias', active: 'cats', body: `
    <section class="panel"><form class="inline-form" data-cat-form><input name="icon" placeholder="🍰" maxlength="4" class="w-emoji"><input name="name" placeholder="Nome da categoria" required><input name="description" placeholder="Descrição (opcional)"><input name="position" type="number" placeholder="Ordem" class="w-num"><button class="btn btn-primary">${icon('plus')} Adicionar</button></form></section>
    <table class="table table-admin"><thead><tr><th>Ícone</th><th>Nome</th><th>Receitas</th><th>Ordem</th><th></th></tr></thead><tbody data-cat-rows></tbody></table>` });
}

function commentsPage({ user }) {
  return simplePage({ user, title: 'Comentários', active: 'comments', body: `
    <div class="tabs" data-comment-tabs><button data-status="pending" class="active">Pendentes</button><button data-status="approved">Aprovados</button><button data-status="spam">Spam</button><button data-status="all">Todos</button></div>
    <div data-comment-list></div>` });
}

function productsPage({ user }) {
  const s = settings.all();
  return simplePage({ user, title: 'Afiliados Amazon', active: 'products', body: `
    <section class="panel">
      <p>Tag de associado: <b>${s.amazonTag ? esc(s.amazonTag) : '<span class="warn">não configurada</span>'}</b> — <a href="/admin/configuracoes">alterar</a>. A tag é adicionada automaticamente a todos os links da Amazon. Cliques passam por <code>/go/ID</code> para contagem.</p>
      <form class="product-form" data-product-form>
        <input type="hidden" name="id">
        <div class="row2">${field('Link da Amazon ou ASIN', '<input name="url" placeholder="https://www.amazon.com.br/dp/B0... ou amzn.to/..." required>')}${field('Título', '<input name="title" required>')}</div>
        <div class="row3">${field('Imagem (URL)', '<input name="image" placeholder="https://m.media-amazon.com/images/...">')}${field('Preço (texto)', '<input name="price" placeholder="R$ 89,90">')}${field('Selo', '<input name="badge" placeholder="Mais vendido">')}</div>
        ${field('Descrição curta', '<input name="description">')}
        ${field('Palavras-chave (ingredientes)', '<input name="keywords" placeholder="chocolate, cacau">', 'Quando um ingrediente da receita contiver uma dessas palavras, um botão de compra aparece ao lado dele.')}
        <div><button class="btn btn-primary">Salvar produto</button> <button type="reset" class="btn btn-ghost">Limpar</button></div>
      </form>
    </section>
    <div class="product-admin-grid" data-product-list></div>` });
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

function settingsPage({ user }) {
  const s = settings.all();
  const v = (k) => esc(s[k]);
  return simplePage({ user, title: 'Configurações', active: 'settings', body: `
  <form class="settings-form" data-settings>
    <section class="panel"><h2>Site</h2>
      <div class="row2">${field('Nome do site', `<input name="siteName" value="${v('siteName')}">`)}${field('Slogan', `<input name="tagline" value="${v('tagline')}">`)}</div>
      ${field('Descrição (SEO)', `<textarea name="description" rows="2">${v('description')}</textarea>`)}
      <div class="row3">${field('Cor principal', `<input type="color" name="themeColor" value="${v('themeColor')}">`)}${field('Logo (URL)', `<input name="logo" value="${v('logo')}">`)}${field('Receitas por página', `<input type="number" min="4" max="48" name="recipesPerPage" value="${v('recipesPerPage')}">`)}</div>
      ${field('Nome do autor', `<input name="authorName" value="${v('authorName')}">`)}
      ${field('Texto "Sobre"', `<textarea name="aboutText" rows="5">${v('aboutText')}</textarea>`)}
    </section>
    <section class="panel"><h2>Redes sociais</h2><div class="row3">${Object.keys(s.social).map((k) => field(k, `<input name="social.${k}" value="${esc(s.social[k])}" placeholder="https://">`)).join('')}</div></section>
    <section class="panel"><h2>Google Analytics, Tag Manager e pixels</h2>
      <p><small>Basta colar os IDs — os scripts são inseridos automaticamente e respeitam o consentimento de cookies (LGPD / Consent Mode v2).</small></p>
      <div class="row2">${field('Google Analytics 4 (ID de medição)', `<input name="ga4Id" value="${v('ga4Id')}" placeholder="G-XXXXXXXXXX">`)}${field('Google Tag Manager', `<input name="gtmId" value="${v('gtmId')}" placeholder="GTM-XXXXXXX">`)}
      ${field('Meta (Facebook/Instagram) Pixel', `<input name="metaPixelId" value="${v('metaPixelId')}" placeholder="123456789012345">`)}${field('Microsoft Clarity', `<input name="clarityId" value="${v('clarityId')}" placeholder="abcd1234ef">`)}</div>
      <label class="check"><input type="checkbox" name="consentBanner"${s.consentBanner ? ' checked' : ''}> Exibir aviso de cookies e pedir consentimento (recomendado — exigido pela LGPD e pelo Google AdSense)</label>
      ${field('Texto do aviso de cookies', `<input name="privacyText" value="${v('privacyText')}">`)}
    </section>
    <section class="panel"><h2>Verificação de propriedade</h2>
      <p><small>Cole apenas o código do atributo <code>content</code> da meta tag fornecida por cada serviço.</small></p>
      <div class="row2">${field('Google Search Console', `<input name="googleSiteVerification" value="${v('googleSiteVerification')}">`)}${field('Bing Webmaster', `<input name="bingSiteVerification" value="${v('bingSiteVerification')}">`)}
      ${field('Pinterest', `<input name="pinterestVerification" value="${v('pinterestVerification')}">`)}${field('Facebook (domínio)', `<input name="facebookDomainVerification" value="${v('facebookDomainVerification')}">`)}</div>
    </section>
    <section class="panel"><h2>Compartilhamento</h2>
      <div class="row2">${field('Botões de compartilhar (ordem)', `<input name="shareNetworks" value="${v('shareNetworks')}">`, 'Opções: whatsapp, pinterest, facebook, telegram, x, email')}${field('@ no X/Twitter', `<input name="twitterHandle" value="${v('twitterHandle')}" placeholder="@seusite">`)}</div>
      ${field('Imagem padrão para compartilhamento (1200×630)', `<input name="defaultOgImage" value="${v('defaultOgImage')}" placeholder="https://... ou /uploads/...">`, 'Usada quando a página não tem foto própria.')}
    </section>
    <section class="panel"><h2>Amazon Associados</h2>
      <div class="row2">${field('Tag de associado', `<input name="amazonTag" value="${v('amazonTag')}" placeholder="seusite-20">`)}${field('Aviso de afiliado', `<input name="amazonDisclosure" value="${v('amazonDisclosure')}">`)}</div>
    </section>
    <section class="panel"><h2>Anúncios</h2>
      <label class="check"><input type="checkbox" name="adsEnabled"${s.adsEnabled ? ' checked' : ''}> Exibir anúncios</label>
      <div class="row2">${field('Google AdSense — ID do editor', `<input name="adsenseClient" value="${v('adsenseClient')}" placeholder="ca-pub-0000000000000000">`, 'Carrega o script do AdSense (inclui Anúncios Automáticos se ativados na sua conta AdSense).')}${field('ads.txt', `<textarea name="adsTxt" rows="2" placeholder="Gerado automaticamente a partir do AdSense">${v('adsTxt')}</textarea>`)}</div>
    </section>
    <section class="panel"><h2>Comunidade</h2>
      <label class="check"><input type="checkbox" name="commentsModeration"${s.commentsModeration ? ' checked' : ''}> Moderar comentários antes de publicar</label>
      <label class="check"><input type="checkbox" name="newsletterEnabled"${s.newsletterEnabled ? ' checked' : ''}> Mostrar formulário de newsletter</label>
      <p><a href="/api/v1/subscribers?format=csv">Baixar inscritos (CSV)</a></p>
    </section>
    <section class="panel"><h2>Avançado</h2>${field('HTML extra no &lt;head&gt;', `<textarea name="headHtml" rows="4" placeholder="Outras ferramentas de medição">${v('headHtml')}</textarea>`, 'Atenção: código inserido aqui roda em todas as páginas. Use apenas códigos de fontes confiáveis.')}</section>
    <button class="btn btn-primary btn-lg">Salvar configurações</button>
  </form>
  <section class="panel"><h2>Minha conta</h2><form data-account class="row3">${field('Nome', `<input name="name" value="${esc(user.name)}">`)}${field('Senha atual', '<input type="password" name="currentPassword" autocomplete="current-password">')}${field('Nova senha', '<input type="password" name="password" minlength="8" autocomplete="new-password">')}${field('Bio', `<textarea name="bio" rows="2">${esc(user.bio || '')}</textarea>`)}${field('Foto (URL)', `<input name="avatar" value="${esc(user.avatar || '')}">`)}<div><button class="btn">Atualizar conta</button></div></form></section>` });
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
    <section class="panel"><form class="inline-form" data-user-form><input name="name" placeholder="Nome" required><input name="email" type="email" placeholder="E-mail" required><input name="password" type="password" placeholder="Senha (mín. 8)" minlength="8" required><select name="role"><option value="author">Autor</option><option value="admin">Administrador</option></select><button class="btn btn-primary">Adicionar</button></form></section>
    <table class="table table-admin"><thead><tr><th>Nome</th><th>E-mail</th><th>Papel</th><th></th></tr></thead><tbody data-user-rows></tbody></table>` });
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

module.exports = { auditPage, forbidden, adminLayout, authPage, dashboard, recipeList, editor, importPage, categoriesPage, commentsPage, productsPage, adsPage, settingsPage, apiPage, usersPage };
