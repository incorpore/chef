'use strict';
const u = require('../util');
const { layout, icon } = require('./layout');
const c = require('./components');
const { renderAd } = require('../monetization');
const settings = require('../settings');
const { organizationLd, websiteLd, itemListLd, breadcrumbLd } = require('./head');

const esc = u.esc;

function home({ featured, latest, popular, quick, categories, tags, user }) {
  const s = settings.all();
  const hero = featured[0] || latest[0];
  const body = `
<section class="home-hero">
  <div class="wrap home-hero-in">
    <div>
      <p class="eyebrow">${esc(s.siteName)}</p>
      <h1>${esc(s.tagline)}</h1>
      <p class="lead">${esc(s.description)}</p>
      <form class="hero-search" action="/busca">
        ${icon('search')}<input type="search" name="q" placeholder="Ex.: bolo de cenoura, frango, #K7M2QX" aria-label="Buscar" data-suggest><div class="suggest" hidden></div>
        <button class="btn btn-primary">Buscar</button>
      </form>
      <div class="quick-links">
        <a class="chip" href="/geladeira">${icon('fridge')} O que tem na geladeira?</a>
        <a class="chip" href="/busca?maxTime=30">⚡ Até 30 min</a>
        <a class="chip" href="/busca?difficulty=1">👌 Fáceis</a>
        <a class="chip" href="/surpresa">🎲 Me surpreenda</a>
      </div>
    </div>
    ${hero ? `<a class="hero-feature" href="/receita/${esc(hero.slug)}">${c.thumb(hero.cover || hero.cover_auto, hero.title, { w: 900, h: 700, eager: true })}<span class="hero-feature-info"><small>Em destaque</small><strong>${esc(hero.title)}</strong>${hero.total_minutes ? `<em>${icon('clock')} ${u.formatMinutes(hero.total_minutes)}</em>` : ''}</span></a>` : ''}
  </div>
</section>
${categories.length ? `<section class="wrap cat-strip" aria-label="Categorias">${categories.map((cat) => `<a href="/categoria/${esc(cat.slug)}" class="cat"><span class="cat-icon">${esc(cat.icon || '🍽️')}</span><span>${esc(cat.name)}</span></a>`).join('')}</section>` : ''}
<div class="wrap">
  <section class="continue" data-continue hidden><h2>${icon('layers')} Continue de onde parou</h2><div class="hscroll"></div></section>
  ${featured.length > 1 ? `<section><div class="section-head"><h2>Destaques</h2></div><div class="hscroll">${featured.map((r) => c.recipeCard(r)).join('')}</div></section>` : ''}
  <section><div class="section-head"><h2>Receitas recentes</h2><a href="/receitas">Ver todas →</a></div>${c.grid(latest, { adHtml: renderAd('home_inline') })}</section>
  ${quick.length ? `<section><div class="section-head"><h2>⚡ Rapidinhas</h2><a href="/busca?maxTime=30&sort=quick">Ver mais →</a></div><div class="hscroll">${quick.map((r) => c.recipeCard(r)).join('')}</div></section>` : ''}
  ${popular.length ? `<section><div class="section-head"><h2>🔥 Mais vistas</h2><a href="/receitas?sort=popular">Ver mais →</a></div><div class="hscroll">${popular.map((r) => c.recipeCard(r)).join('')}</div></section>` : ''}
  ${tags.length ? `<section><h2>Explore por tema</h2><div class="tags">${tags.map((t) => `<a class="chip" href="/tag/${encodeURIComponent(t.tag)}">#${esc(t.tag)} <small>${t.n}</small></a>`).join('')}</div></section>` : ''}
  ${!latest.length ? `<section class="empty-state"><h2>Nenhuma receita publicada ainda</h2><p>${user ? '<a class="btn btn-primary" href="/admin/receitas/nova">Criar a primeira receita</a> ou <a href="/admin/importar">importar de uma URL</a>' : 'Volte em breve!'}</p></section>` : ''}
  ${s.newsletterEnabled ? `<form class="newsletter newsletter-wide" data-newsletter><div><h3>Receitas novas no seu e-mail</h3><p>Uma vez por semana, sem spam.</p></div><input type="email" name="email" placeholder="seu@email.com" required><button class="btn btn-primary">Inscrever</button></form>` : ''}
</div>`;
  return layout({ body, nav: 'home', user, jsonLd: [organizationLd(), websiteLd(), latest.length ? itemListLd(latest) : null] });
}

function filters(q, categories) {
  const sel = (v, cur) => (String(v) === String(cur ?? '') ? ' selected' : '');
  return `<form class="filters" action="/busca">
    <div class="filters-row">
      <label class="filter-q">${icon('search')}<input type="search" name="q" value="${esc(q.q || '')}" placeholder="Palavra-chave ou #código" data-suggest><div class="suggest" hidden></div></label>
      <select name="category" aria-label="Categoria"><option value="">Todas as categorias</option>${categories.map((cat) => `<option value="${esc(cat.slug)}"${sel(cat.slug, q.category)}>${esc(cat.name)}</option>`).join('')}</select>
      <select name="maxTime" aria-label="Tempo"><option value="">Qualquer tempo</option>${[15, 30, 45, 60, 120].map((m) => `<option value="${m}"${sel(m, q.maxTime)}>Até ${u.formatMinutes(m)}</option>`).join('')}</select>
      <select name="difficulty" aria-label="Dificuldade"><option value="">Qualquer dificuldade</option>${[1, 2, 3].map((d) => `<option value="${d}"${sel(d, q.difficulty)}>${c.DIFFICULTY[d]}</option>`).join('')}</select>
      <select name="sort" aria-label="Ordenar"><option value="">Relevância</option><option value="recent"${sel('recent', q.sort)}>Mais recentes</option><option value="popular"${sel('popular', q.sort)}>Mais vistas</option><option value="rating"${sel('rating', q.sort)}>Mais bem avaliadas</option><option value="quick"${sel('quick', q.sort)}>Mais rápidas</option><option value="title"${sel('title', q.sort)}>A–Z</option></select>
      ${q.tag ? `<input type="hidden" name="tag" value="${esc(q.tag)}">` : ''}
      ${q.diet ? `<input type="hidden" name="diet" value="${esc(q.diet)}">` : ''}
      <button class="btn btn-primary">Filtrar</button>
    </div>
  </form>`;
}

function listing({ title, intro = '', result, q = {}, categories, basePath = '/busca', user, nav = 'search', canonical = '', description = '', crumbs = null, indexable = false }) {
  const qs = (page) => {
    const p = new URLSearchParams(Object.entries({ ...q, page }).filter(([, v]) => v !== undefined && v !== ''));
    return `${basePath}?${p}`;
  };
  const codeHit = result.exactCode;
  const body = `<div class="wrap">
    <header class="page-head"><h1>${esc(title)}</h1>${intro}</header>
    ${filters(q, categories)}
    ${codeHit ? `<div class="code-hit">${c.codeCopy(codeHit.code, { label: true })}<a href="/receita/${esc(codeHit.slug)}">encontrado: <strong>${esc(codeHit.title)}</strong> →</a></div>` : ''}
    <p class="result-count">${result.total} ${result.total === 1 ? 'receita' : 'receitas'}${q.q ? ` para “${esc(q.q)}”` : ''}</p>
    ${c.grid(result.items, { adHtml: renderAd('home_inline') })}
    ${c.pagination(result.page, result.pages, qs)}
  </div>`;
  // Páginas de busca/filtro não são indexadas (conteúdo duplicado); categorias e tags sim
  const filtered = ['q', 'maxTime', 'difficulty', 'sort', 'diet', 'ingredients'].some((k) => q[k]);
  const pageHref = (p) => (p > 1 ? `${basePath}?page=${p}` : basePath);
  return layout({
    title: result.page > 1 ? `${title} — página ${result.page}` : title,
    description: description || `${result.total} receitas: ${title}. Receitas testadas com passo a passo, timers e modo cozinha.`,
    body, user, nav, canonical,
    noindex: filtered || !indexable || !result.total,
    prev: !filtered && result.page > 1 ? pageHref(result.page - 1) : '',
    next: !filtered && result.page < result.pages ? pageHref(result.page + 1) : '',
    jsonLd: [result.items.length ? itemListLd(result.items) : null, crumbs ? breadcrumbLd(crumbs) : null],
  });
}

function categoriesPage({ categories, user }) {
  const body = `<div class="wrap"><header class="page-head"><h1>Categorias</h1></header>
    <div class="cat-grid">${categories.map((cat) => `<a class="cat-card" href="/categoria/${esc(cat.slug)}"><span class="cat-icon">${esc(cat.icon || '🍽️')}</span><strong>${esc(cat.name)}</strong><small>${cat.count} receitas</small></a>`).join('') || '<p class="empty">Nenhuma categoria cadastrada.</p>'}</div></div>`;
  return layout({ title: 'Categorias', body, user, nav: 'recipes' });
}

/** Páginas que são renderizadas no cliente a partir do armazenamento local (funcionam offline). */
function clientPage({ title, nav, user, body, scripts = [], indexable = false, description = '' }) {
  return layout({ title, description, nav, user, body: `<div class="wrap">${body}</div>`, scripts: ['/js/tools.js', ...scripts], noindex: !indexable });
}

function favorites(user) {
  return clientPage({ title: 'Favoritos', nav: 'favs', user, body: `<header class="page-head"><h1>${icon('heart')} Meus favoritos</h1><p>Salvos neste aparelho — funcionam offline depois de abertos uma vez.</p></header><div class="grid" data-favorites></div><p class="empty" data-favorites-empty hidden>Você ainda não favoritou nenhuma receita. Toque no ${icon('heart')} de uma receita para salvar aqui.</p>` });
}

function shoppingList(user) {
  return clientPage({ title: 'Lista de compras', nav: 'list', user, body: `<header class="page-head"><h1>${icon('cart')} Lista de compras</h1><p>Itens das receitas somados automaticamente. Marque o que já pegou.</p></header>
    <form class="add-item" data-add-item><input name="item" placeholder="Adicionar item (ex.: 2 kg de batata)" required><button class="btn btn-primary">${icon('plus')}</button></form>
    <div data-shopping></div>
    <div class="list-actions"><button class="btn btn-ghost" data-share-list>${icon('share')} Compartilhar</button><button class="btn btn-ghost" data-clear-checked>Remover marcados</button><button class="btn btn-ghost" data-clear-list>Limpar tudo</button></div>` });
}

function planner(user) {
  return clientPage({ title: 'Cardápio da semana', nav: 'plan', user, body: `<header class="page-head"><h1>${icon('calendar')} Cardápio da semana</h1><p>Planeje suas refeições e gere a lista de compras da semana inteira em um toque.</p></header>
    <div class="week-nav"><button class="icon-btn" data-week="-1" aria-label="Semana anterior">${icon('arrowL')}</button><strong data-week-label></strong><button class="icon-btn" data-week="1" aria-label="Próxima semana">${icon('arrowR')}</button></div>
    <div class="planner" data-planner></div>
    <div class="list-actions"><button class="btn btn-primary" data-plan-to-list>${icon('cart')} Gerar lista de compras da semana</button></div>
    <dialog class="pick-dialog"><form method="dialog" class="pick-box"><h3>Escolher receita</h3><input type="search" placeholder="Buscar..." data-pick-search><ul data-pick-results></ul><button class="btn">Cancelar</button></form></dialog>` });
}

function fridge({ user, q }) {
  return clientPage({ title: 'O que tem na geladeira?', nav: 'fridge', user, body: `<header class="page-head"><h1>${icon('fridge')} O que tem na geladeira?</h1><p>Digite os ingredientes que você tem e descubra o que dá para fazer.</p></header>
    <form class="fridge-form" data-fridge><div class="chips-input"><div data-fridge-chips></div><input placeholder="Ex.: ovo, tomate, queijo… (Enter para adicionar)" data-fridge-input value="${esc(q || '')}"></div><button class="btn btn-primary">Buscar receitas</button></form>
    <div class="fridge-suggestions">${['ovo', 'frango', 'arroz', 'tomate', 'queijo', 'batata', 'leite', 'chocolate', 'banana', 'carne moída', 'cenoura', 'farinha'].map((i) => `<button class="chip" data-fridge-add="${i}">+ ${i}</button>`).join('')}</div>
    <div data-fridge-results></div>` });
}

function converter(user) {
  return clientPage({ title: 'Conversor de medidas de cozinha (xícara, colher, gramas)', description: 'Converta xícaras e colheres em gramas e mililitros para farinha, açúcar, manteiga, chocolate e mais. Tabela de temperatura do forno.', indexable: true, nav: '', user, body: `<header class="page-head"><h1>Conversor de medidas</h1><p>Converta xícaras e colheres em gramas e mililitros (valores aproximados).</p></header>
    <form class="converter" data-converter>
      <input type="number" step="any" min="0" value="1" name="amount" aria-label="Quantidade">
      <select name="unit" aria-label="Unidade"><option value="xícara">xícara</option><option value="colher de sopa">colher de sopa</option><option value="colher de chá">colher de chá</option><option value="copo">copo americano</option><option value="ml">ml</option><option value="g">g</option></select>
      <span>de</span>
      <select name="ingredient" aria-label="Ingrediente"></select>
    </form>
    <div class="converter-out" data-converter-out></div>
    <h2>Temperatura do forno</h2>
    <table class="table"><thead><tr><th>Forno</th><th>°C</th><th>°F</th><th>Gás</th></tr></thead><tbody>
      <tr><td>Baixo</td><td>150–160</td><td>300–320</td><td>2–3</td></tr><tr><td>Médio</td><td>180</td><td>350</td><td>4</td></tr><tr><td>Médio-alto</td><td>200</td><td>390</td><td>6</td></tr><tr><td>Alto</td><td>220–240</td><td>430–460</td><td>7–9</td></tr>
    </tbody></table>` });
}

function about({ user, author }) {
  const s = settings.all();
  const body = `<div class="wrap narrow prose"><h1>Sobre</h1>${author?.avatar ? `<img class="avatar-lg" src="${esc(author.avatar)}" alt="">` : ''}${u.miniMarkdown(s.aboutText)}${author?.bio ? u.miniMarkdown(author.bio) : ''}
  <h2>Como usar</h2><ul><li><b>Busque por código:</b> cada receita tem um código curto (ex.: <code>#K7M2QX</code>). Digite na busca ou acesse <code>/c/K7M2QX</code>.</li><li><b>Modo cozinha:</b> tela cheia com um passo por vez, timers automáticos, leitura em voz alta e comandos de voz. A tela não apaga enquanto você cozinha.</li><li><b>Ajuste porções:</b> as quantidades são recalculadas automaticamente.</li><li><b>Instale o app:</b> no celular, use "Adicionar à tela inicial" para usar offline.</li></ul></div>`;
  return layout({ title: 'Sobre', description: String(s.aboutText || '').slice(0, 160), body, user, jsonLd: author ? { '@context': 'https://schema.org', '@type': 'ProfilePage', mainEntity: { '@type': 'Person', name: author.name, description: author.bio || undefined, image: author.avatar || undefined, sameAs: Object.values(s.social || {}).filter(Boolean) } } : null });
}

function legalPage({ user, kind }) {
  const s = settings.all();
  const name = esc(s.siteName);
  const privacy = `<h1>Política de privacidade</h1>
  <p>Esta política explica como o <b>${name}</b> trata dados pessoais, conforme a Lei Geral de Proteção de Dados (LGPD — Lei 13.709/2018).</p>
  <h2>Dados que coletamos</h2><ul>
  <li><b>Comentários e avaliações:</b> nome e texto que você escreve. Seu endereço IP é guardado apenas de forma irreversível (hash) para combater spam.</li>
  <li><b>Newsletter:</b> seu e-mail, somente se você se inscrever. Você pode pedir a remoção a qualquer momento.</li>
  <li><b>Favoritos, lista de compras, cardápio e progresso nas receitas:</b> ficam salvos <i>apenas no seu aparelho</i> e não são enviados para nós.</li>
  <li><b>Medição de audiência e anúncios</b> (Google Analytics, Google AdSense, Meta Pixel, Microsoft Clarity, quando ativos): usam cookies <i>somente após o seu consentimento</i>. Sem consentimento, os anúncios exibidos não são personalizados.</li></ul>
  <h2>Cookies</h2><p>Usamos um cookie técnico para manter o login do painel. Cookies de medição e publicidade só são ativados se você clicar em “Aceitar”. Você pode mudar sua escolha em <button class="link" data-consent-open>preferências de cookies</button>.</p>
  <h2>Links de afiliado</h2><p>${esc(s.amazonDisclosure)}</p>
  <h2>Seus direitos</h2><p>Você pode solicitar acesso, correção ou exclusão dos seus dados entrando em contato pelos nossos canais${Object.values(s.social || {}).some(Boolean) ? ' nas redes sociais' : ''}.</p>
  <p><small>Última atualização: ${new Date().getFullYear()}.</small></p>`;
  const terms = `<h1>Termos de uso</h1>
  <p>Ao usar o <b>${name}</b>, você concorda com estes termos.</p>
  <h2>Conteúdo</h2><p>As receitas, textos, fotos e vídeos pertencem aos seus autores. Você pode compartilhar links e usar o recurso “Incorporar”, mas não pode copiar o conteúdo integral sem autorização.</p>
  <h2>Comentários</h2><p>Comentários ofensivos, spam ou com propaganda podem ser removidos sem aviso.</p>
  <h2>Responsabilidade</h2><p>As informações nutricionais e conversões de medidas são aproximadas. Verifique alergias e restrições alimentares antes de preparar uma receita.</p>
  <h2>API</h2><p>O uso da API está sujeito a limites de requisições. Chaves de acesso são pessoais e podem ser revogadas em caso de abuso.</p>`;
  return layout({ title: kind === 'privacy' ? 'Política de privacidade' : 'Termos de uso', user, body: `<div class="wrap narrow prose">${kind === 'privacy' ? privacy : terms}</div>` });
}

/** Cartão para incorporar a receita em outros sites (iframe). */
function embed({ r, base }) {
  const time = u.formatMinutes(r.total_minutes);
  const s = settings.all();
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><link rel="canonical" href="${esc(base)}/receita/${esc(r.slug)}"><title>${esc(r.title)}</title><link rel="stylesheet" href="/css/app.css"><style>:root{--brand:${esc(s.themeColor)}}body{padding:0;background:transparent}.embed{display:flex;gap:14px;padding:12px;border:1px solid var(--line);border-radius:18px;background:var(--surface);text-decoration:none;font-family:var(--font)}.embed img{width:120px;height:120px;object-fit:cover;border-radius:12px}.embed h1{font-size:1.15rem;margin:0 0 4px}.embed p{margin:0 0 6px;color:var(--ink-2);font-size:.9rem}.embed small{color:var(--brand);font-weight:700}</style></head>
  <body><a class="embed" href="${esc(base)}/receita/${esc(r.slug)}?utm_source=embed&utm_medium=iframe" target="_blank" rel="noopener">${r.cover || r.cover_auto ? `<img src="${esc(r.cover || r.cover_auto)}" alt="">` : ''}<span><h1>${esc(r.title)}</h1><p>${esc(r.description || '')}</p><p>${time ? `⏱ ${time} · ` : ''}#${esc(r.code)}</p><small>Ver receita completa no ${esc(s.siteName)} →</small></span></a></body></html>`;
}

/** Páginas de resultado da newsletter (confirmar / cancelar inscrição). */
function newsletterPage({ user, kind, email = '', token = '' }) {
  const s = settings.all();
  const box = (emoji, title, text, extra = '') => `<div class="wrap narrow empty-state"><h1>${emoji} ${esc(title)}</h1><p>${text}</p>${extra}<p><a class="btn btn-primary" href="/">Ver receitas</a></p></div>`;
  const bodies = {
    confirmed: box('🎉', 'Inscrição confirmada!', `Pronto! Você vai receber as receitas novas do <b>${esc(s.siteName)}</b> no seu e-mail.`),
    invalid: box('😕', 'Link inválido ou expirado', 'Este link de confirmação não vale mais. Inscreva-se de novo no formulário do site para receber um novo.'),
    ask: `<div class="wrap narrow empty-state"><h1>Cancelar inscrição?</h1><p>O e-mail <b>${esc(email)}</b> deixará de receber as receitas do ${esc(s.siteName)}.</p>
      <form method="post" action="/newsletter/sair"><input type="hidden" name="e" value="${esc(email)}"><input type="hidden" name="t" value="${esc(token)}"><button class="btn btn-primary">Sim, cancelar inscrição</button></form>
      <p><a href="/">Não, quero continuar recebendo</a></p></div>`,
    left: box('👋', 'Inscrição cancelada', 'Você não vai mais receber nossos e-mails. Se mudar de ideia, é só se inscrever de novo no site.'),
  };
  return layout({ title: kind === 'left' || kind === 'ask' ? 'Cancelar inscrição' : 'Newsletter', user, noindex: true, body: bodies[kind] || bodies.invalid });
}

function notFound(user, message = 'Página não encontrada') {
  return layout({ title: message, user, noindex: true, body: `<div class="wrap narrow empty-state"><h1>😕 ${esc(message)}</h1><p>Tente buscar uma receita ou pelo código.</p><form class="hero-search" action="/busca">${icon('search')}<input type="search" name="q" placeholder="Buscar..." autofocus><button class="btn btn-primary">Buscar</button></form><p><a href="/">Voltar ao início</a></p></div>` });
}

function offline() {
  return layout({ title: 'Sem conexão', noindex: true, body: `<div class="wrap narrow empty-state"><h1>📴 Você está offline</h1><p>As receitas que você já abriu e seus favoritos continuam disponíveis.</p><p><a class="btn btn-primary" href="/favoritos">Ver favoritos</a> <a class="btn btn-ghost" href="/lista">Lista de compras</a></p></div>` });
}

function apiDocs(base) {
  const body = `<div class="wrap narrow prose"><h1>API do ${esc(settings.all().siteName)}</h1>
  <p>API REST em JSON. Leitura pública (CORS liberado); escrita exige uma chave gerada em <a href="/admin/api">Painel → API</a>, enviada <b>somente</b> no cabeçalho <code>Authorization: Bearer …</code> (nunca na URL).</p>
  <p><b>Limites:</b> 600 leituras e 120 escritas por minuto por IP (veja os cabeçalhos <code>RateLimit-Remaining</code> e <code>Retry-After</code>); 20 importações por minuto; corpo JSON até 1 MB (20 MB na importação em lote); até 20 arquivos de ${Number(process.env.MAX_UPLOAD_MB) || 200} MB por envio.</p>
  <p>Especificação OpenAPI: <a href="/api/v1/openapi.json"><code>/api/v1/openapi.json</code></a></p>
  <h2>Exemplos</h2>
  <pre><code># Buscar por palavra-chave
curl "${esc(base)}/api/v1/recipes?q=bolo&amp;maxTime=60"

# Buscar por código
curl "${esc(base)}/api/v1/recipes/code/K7M2QX"

# O que fazer com o que tenho em casa
curl "${esc(base)}/api/v1/recipes?ingredients=ovo,tomate"

# Criar receita
curl -X POST "${esc(base)}/api/v1/recipes" \\
  -H "Authorization: Bearer SUA_CHAVE" -H "Content-Type: application/json" \\
  -d '{"title":"Brigadeiro","ingredients":"1 lata de leite condensado\\n1 colher (sopa) de manteiga\\n4 colheres (sopa) de chocolate em pó","steps":"Misture tudo em fogo baixo.\\nMexa por 10 minutos até desgrudar.","status":"published"}'

# Importar de uma URL (pré-visualizar ou salvar)
curl -X POST "${esc(base)}/api/v1/import" \\
  -H "Authorization: Bearer SUA_CHAVE" -H "Content-Type: application/json" \\
  -d '{"url":"https://site.com/receita","save":true,"status":"draft"}'

# Enviar foto ou vídeo
curl -X POST "${esc(base)}/api/v1/uploads" -H "Authorization: Bearer SUA_CHAVE" -F "files=@foto.jpg"</code></pre>
  <h2>Endpoints</h2>
  <table class="table"><tbody>
  ${[['GET', '/recipes', 'Lista/busca (q, code, category, tag, diet, maxTime, difficulty, ingredients, sort, page, perPage)'], ['GET', '/recipes/{id|código|slug}', 'Detalhe'], ['GET', '/recipes/code/{código}', 'Busca exata por código'], ['POST', '/recipes', 'Criar 🔑'], ['PUT/PATCH', '/recipes/{ref}', 'Atualizar 🔑'], ['DELETE', '/recipes/{ref}', 'Remover 🔑'], ['POST', '/recipes/{ref}/duplicate', 'Duplicar 🔑'], ['GET/POST', '/recipes/{ref}/comments', 'Comentários e notas'], ['GET', '/search/suggest?q=', 'Autocomplete'], ['POST', '/import', 'Importar por URL 🔑'], ['POST', '/import/json', 'Importar JSON em lote 🔑'], ['GET', '/export', 'Backup completo 🔑'], ['POST', '/uploads', 'Fotos e vídeos 🔑'], ['GET/POST', '/categories', 'Categorias'], ['GET', '/tags', 'Tags'], ['GET/POST/PUT/DELETE', '/products', 'Produtos de afiliado 🔑'], ['GET/POST/PUT/DELETE', '/ads', 'Anúncios 🔑'], ['GET/PUT', '/settings', 'Configurações 🔑'], ['GET', '/stats', 'Estatísticas 🔑'], ['POST', '/auth/logout-all', 'Sair de todos os aparelhos 🔑'], ['DELETE', '/uploads/{id}', 'Remover arquivo 🔑'], ['GET', '/audit', 'Auditoria (admin) 🔑']].map(([m, p, d]) => `<tr><td><code>${m}</code></td><td><code>/api/v1${esc(p)}</code></td><td>${d}</td></tr>`).join('')}
  </tbody></table></div>`;
  return layout({ title: 'API', body });
}

module.exports = { newsletterPage, legalPage, embed, home, listing, categoriesPage, favorites, shoppingList, planner, fridge, converter, about, notFound, offline, apiDocs };
