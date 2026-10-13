'use strict';
const u = require('../util');
const { layout, icon, avatar } = require('./layout');
const c = require('./components');
const { renderAd, renderProducts, productsForIngredients, productLink } = require('../monetization');
const settings = require('../settings');
const { breadcrumbLd } = require('./head');

const esc = u.esc;

// Dietas reconhecidas pelo Google (schema.org/RestrictedDiet)
const DIET_SCHEMA = {
  vegana: 'https://schema.org/VeganDiet', vegano: 'https://schema.org/VeganDiet', vegetariana: 'https://schema.org/VegetarianDiet', vegetariano: 'https://schema.org/VegetarianDiet',
  'sem gluten': 'https://schema.org/GlutenFreeDiet', 'sem lactose': 'https://schema.org/LowLactoseDiet', 'low carb': 'https://schema.org/LowCalorieDiet', diabetica: 'https://schema.org/DiabeticDiet',
  'baixo sodio': 'https://schema.org/LowSaltDiet', halal: 'https://schema.org/HalalDiet', kosher: 'https://schema.org/KosherDiet',
};

function jsonLd(r, base) {
  const s = settings.all();
  const abs = (x) => (x && x.startsWith('/') ? `${base}${x}` : x);
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Recipe',
    name: r.title,
    description: r.seo_description || r.description || autoDescription(r),
    image: [r.cover, ...r.images.map((i) => i.url), r.cover || r.images.length ? '' : r.cover_auto].filter(Boolean).map(abs),
    author: { '@type': 'Person', name: r.author_name || s.authorName || s.siteName, url: `${base}/sobre` },
    publisher: { '@id': `${base}/#organization` },
    inLanguage: 'pt-BR',
    mainEntityOfPage: `${base}/receita/${r.slug}`,
    suitableForDiet: r.diets.map((d) => DIET_SCHEMA[u.stripAccents(d).toLowerCase()]).filter(Boolean),
    datePublished: r.published_at || r.created_at,
    dateModified: r.updated_at,
    prepTime: u.minutesToIso(r.prep_minutes),
    cookTime: u.minutesToIso(r.cook_minutes),
    totalTime: u.minutesToIso(r.total_minutes),
    recipeCategory: r.category?.name,
    recipeCuisine: r.cuisine || undefined,
    keywords: [...r.tags, r.cuisine, r.category?.name].filter(Boolean).join(', ') || undefined,
    recipeIngredient: r.ingredients.map((i) => i.raw),
    recipeYield: [String(r.servings), `${r.servings} ${r.servings_unit}`],
    recipeInstructions: r.steps.map((st, i) => ({ '@type': 'HowToStep', position: i + 1, text: st.text, url: `${base}/receita/${r.slug}#passo-${i + 1}`, image: st.image ? abs(st.image) : undefined })),
    identifier: r.code,
    url: `${base}/receita/${r.slug}`,
  };
  if (r.rating.count) ld.aggregateRating = { '@type': 'AggregateRating', ratingValue: r.rating.average, ratingCount: r.rating.count, bestRating: 5, worstRating: 1 };
  if (r.nutrition) {
    const n = r.nutrition;
    ld.nutrition = { '@type': 'NutritionInformation', calories: n.calories, proteinContent: n.protein, carbohydrateContent: n.carbs, fatContent: n.fat, fiberContent: n.fiber, sodiumContent: n.sodium, sugarContent: n.sugar };
  }
  if (!ld.suitableForDiet.length) delete ld.suitableForDiet;
  if (r.video) {
    ld.video = { '@type': 'VideoObject', name: r.title, description: r.description || r.title, thumbnailUrl: r.video.type === 'youtube' ? `https://i.ytimg.com/vi/${r.video.id}/hqdefault.jpg` : abs(r.cover), uploadDate: r.published_at || r.created_at, contentUrl: r.video.type === 'file' ? abs(r.video.url) : undefined, embedUrl: r.video.type === 'youtube' ? `https://www.youtube.com/embed/${r.video.id}` : r.video.type === 'vimeo' ? `https://player.vimeo.com/video/${r.video.id}` : undefined };
  }
  return JSON.parse(JSON.stringify(ld));
}

function ingredientLine(i, idx, productByKw) {
  const kw = [...productByKw.keys()].find((k) => u.stripAccents(i.name).toLowerCase().includes(k));
  const prod = kw ? productByKw.get(kw) : null;
  const qty = i.quantity !== null && i.quantity !== undefined
    ? `<span class="qty" data-q="${i.quantity}"${i.quantityMax ? ` data-qmax="${i.quantityMax}"` : ''} data-unit="${esc(i.unit)}">${u.formatQuantity(i.quantity)}${i.quantityMax ? `–${u.formatQuantity(i.quantityMax)}` : ''}${i.unit ? ` ${esc(u.unitLabel(i.unit, i.quantityMax || i.quantity))} de` : ''}</span> `
    : '';
  return `<li class="ing" data-i="${idx}">
    <label><input type="checkbox" data-ing-check="${idx}"><span class="box">${icon('check')}</span>
    <span class="ing-text">${qty}<span class="ing-name">${esc(i.name)}</span>${i.note ? ` <small>(${esc(i.note)})</small>` : ''}</span></label>
    ${prod ? `<a class="ing-buy" href="${productLink(prod)}" target="_blank" rel="sponsored noopener nofollow" title="${esc(prod.title)}">${icon('cart')}</a>` : ''}
  </li>`;
}

function timelineBar(r) {
  const parts = [['prep', 'Preparo', r.prep_minutes], ['cook', 'Cozimento', r.cook_minutes], ['rest', 'Descanso', r.rest_minutes]].filter((p) => p[2] > 0);
  if (!parts.length) return '';
  const total = r.total_minutes;
  return `<div class="timeline" data-total="${total}">
    <div class="timeline-bar">${parts.map(([k, label, m]) => `<span class="tl-${k}" style="flex:${m}" title="${label}: ${u.formatMinutes(m)}"></span>`).join('')}</div>
    <div class="timeline-legend">${parts.map(([k, label, m]) => `<span><i class="dot tl-${k}"></i>${label} <b>${u.formatMinutes(m)}</b></span>`).join('')}<span class="tl-total">Total <b>${u.formatMinutes(total)}</b></span></div>
    <div class="timeline-plan">
      <span data-ready-at>Começando agora, fica pronto às <b>--:--</b></span>
      <label>Quero servir às <input type="time" data-serve-at> → começar às <b data-start-at>--:--</b></label>
    </div>
  </div>`;
}

function stepsHtml(r, links, adEvery) {
  let group = '';
  const ad = adEvery ? renderAd('recipe_steps') : '';
  const out = [];
  r.steps.forEach((s, i) => {
    if ((s.group || '') !== group) {
      group = s.group || '';
      if (group) out.push(`<li class="step-group"><h3>${esc(group)}</h3></li>`);
    }
    const ings = links[i].map((idx) => r.ingredients[idx]).filter(Boolean);
    out.push(`<li class="step" id="passo-${i + 1}" data-step="${i}">
      <button class="step-num" data-step-toggle="${i}" aria-label="Marcar passo ${i + 1} como feito"><span>${i + 1}</span>${icon('check')}</button>
      <div class="step-body">
        <p>${esc(s.text)}</p>
        ${ings.length ? `<div class="step-ings">${links[i].map((idx) => `<span class="chip" data-ing-ref="${idx}">${esc(r.ingredients[idx].name)}</span>`).join('')}</div>` : ''}
        ${s.timer ? `<button class="timer-btn" data-timer="${s.timer}" data-timer-label="Passo ${i + 1}">${icon('timer')} Timer ${u.formatMinutes(Math.round(s.timer / 60)) || `${s.timer}s`}</button>` : ''}
        ${s.image ? `<figure class="step-img">${c.thumb(s.image, `Passo ${i + 1}`, { w: 800, h: 600 })}</figure>` : ''}
      </div>
    </li>`);
    if (ad && (i + 1) % 3 === 0 && i < r.steps.length - 1) out.push(`<li class="step-ad">${ad}</li>`);
  });
  return out.join('');
}

function recipePage({ r, base, related, products, adjacent, comments, user }) {
  const s = settings.all();
  const links = c.linkIngredients(r.steps, r.ingredients);
  const productByKw = productsForIngredients(r.ingredients, products.map((p) => p.id));
  const gallery = [r.cover ? { url: r.cover, caption: r.title } : null, ...r.images].filter(Boolean);
  if (!gallery.length && r.cover_auto) gallery.push({ url: r.cover_auto, caption: r.title });
  let group = '';
  const ingHtml = r.ingredients.map((i, idx) => {
    let pre = '';
    if ((i.group || '') !== group) {
      group = i.group || '';
      if (group) pre = `<li class="ing-group">${esc(group)}</li>`;
    }
    return pre + ingredientLine(i, idx, productByKw);
  }).join('');

  const data = {
    id: r.id, code: r.code, slug: r.slug, title: r.title, cover: r.cover || r.cover_auto, servings: r.servings, servings_unit: r.servings_unit,
    ingredients: r.ingredients, steps: r.steps.map((st, i) => ({ ...st, ings: links[i] })), total: r.total_minutes, url: `${base}/receita/${r.slug}`,
  };

  const body = `
<article class="recipe" data-recipe='${esc(JSON.stringify({ id: r.id, slug: r.slug }))}'>
  <div class="progress-rail" aria-hidden="true"><span></span></div>
  <header class="recipe-hero">
    <div class="hero-media">
      ${gallery.length ? `<div class="gallery" data-gallery>${gallery.map((g, i) => `<figure>${c.thumb(g.url, g.caption || r.title, { w: 1200, h: 900, eager: i === 0 })}${g.caption && i ? `<figcaption>${esc(g.caption)}</figcaption>` : ''}</figure>`).join('')}</div>${gallery.length > 1 ? `<div class="gallery-dots">${gallery.map((_, i) => `<button data-goto="${i}" aria-label="Foto ${i + 1}"></button>`).join('')}</div>` : ''}` : `<div class="ph ph-hero">${icon('chef')}</div>`}
      ${r.video ? `<a href="#video" class="chip chip-video hero-video">${icon('play')} Ver vídeo</a>` : ''}
    </div>
    <div class="hero-info">
      <nav class="crumbs"><a href="/">Início</a> › ${r.category ? `<a href="/categoria/${esc(r.category.slug)}">${esc(r.category.name)}</a> › ` : ''}<span>${esc(r.title)}</span></nav>
      ${r.status !== 'published' ? '<span class="chip chip-warn">Rascunho</span>' : ''}
      <h1>${esc(r.title)}</h1>
      <p class="byline">${r.author ? avatar(r.author, 'avatar-byline') : ''}<span>Por <a href="/sobre" rel="author">${esc(r.author_name || settings.all().authorName || settings.all().siteName)}</a> · <time datetime="${esc(r.published_at || r.created_at)}">${fmtDate(r.published_at || r.created_at)}</time>${r.updated_at && (r.updated_at || '').slice(0, 10) !== (r.published_at || r.created_at || '').slice(0, 10) ? ` · atualizada em <time datetime="${esc(r.updated_at)}">${fmtDate(r.updated_at)}</time>` : ''}</span></p>
      <div class="code-row">${c.codeCopy(r.code, { label: true, cls: 'code-copy-lg' })}<button type="button" class="code-qr" data-qr aria-label="Mostrar QR code da receita" title="QR code">${icon('qr')}</button></div>
      ${r.description ? `<p class="lead">${esc(r.description)}</p>` : ''}
      <div class="meta-pills">
        ${r.total_minutes ? `<span class="pill">${icon('clock')}<b>${u.formatMinutes(r.total_minutes)}</b><small>tempo total</small></span>` : ''}
        <span class="pill">${icon('users')}<b>${String(r.servings).replace('.', ',')}</b><small>${esc(r.servings_unit)}</small></span>
        <span class="pill">${icon('flame')}<b>${c.DIFFICULTY[r.difficulty]}</b><small>dificuldade</small></span>
        ${r.rating.count ? `<a href="#comentarios" class="pill">${icon('star')}<b>${String(r.rating.average).replace('.', ',')}</b><small>${r.rating.count} avaliações</small></a>` : ''}
        ${r.cooked ? `<span class="pill">${icon('chef')}<b>${r.cooked}</b><small>já fizeram</small></span>` : ''}
      </div>
      ${r.diets.length || r.tags.length ? `<div class="tags">${r.diets.map((d) => `<a class="chip chip-diet" href="/busca?diet=${encodeURIComponent(d)}">${esc(d)}</a>`).join('')}${r.tags.map((t) => `<a class="chip" href="/tag/${encodeURIComponent(t)}">#${esc(t)}</a>`).join('')}</div>` : ''}
      <div class="actions">
        <button class="btn btn-primary btn-lg" data-cook-start>${icon('chef')} Modo cozinha</button>
        <button class="icon-btn lg fav-btn" data-fav="${r.id}" data-slug="${esc(r.slug)}" data-title="${esc(r.title)}" data-cover="${esc(r.cover || r.cover_auto)}" aria-label="Favoritar">${icon('heart')}</button>
        <button class="icon-btn lg" data-share aria-label="Compartilhar" title="Compartilhar">${icon('share')}</button>
        <button class="icon-btn lg" data-add-list aria-label="Adicionar à lista de compras" title="Adicionar à lista de compras">${icon('cart')}</button>
        <button class="icon-btn lg" data-add-plan aria-label="Adicionar ao cardápio" title="Adicionar ao cardápio">${icon('calendar')}</button>
        <button class="icon-btn lg" data-qr aria-label="QR code" title="QR code">${icon('qr')}</button>
        <button class="icon-btn lg" data-print aria-label="Imprimir" title="Imprimir">${icon('print')}</button>
        ${user ? `<a class="icon-btn lg" href="/admin/receitas/${r.id}" aria-label="Editar" title="Editar">${icon('edit')}</a>` : ''}
      </div>
      ${shareBar(r, base)}
      <div class="resume-banner" hidden>${icon('layers')} Você parou no passo <b data-resume-step></b>. <button class="btn btn-sm" data-cook-resume>Continuar</button> <button class="link" data-progress-reset>Recomeçar</button></div>
    </div>
  </header>

  ${timelineBar(r)}

  <div class="recipe-layout">
    <div class="recipe-main">
      ${r.story ? `<a class="jump" href="#ingredientes">${icon('arrowR')} Ir direto para a receita</a><section class="story prose">${u.miniMarkdown(r.story)}</section>` : ''}
      ${renderAd('recipe_top')}
      ${r.video ? `<section id="video" class="video-section"><h2>${icon('play')} Vídeo</h2>${c.videoEmbed(r.video, r.title)}</section>` : ''}

      <section class="ingredients" id="ingredientes">
        <div class="section-head">
          <h2>Ingredientes</h2>
          <div class="scaler" role="group" aria-label="Ajustar porções">
            <button class="icon-btn" data-scale="-1" aria-label="Menos porções">${icon('minus')}</button>
            <span><b data-servings>${String(r.servings).replace('.', ',')}</b> ${esc(r.servings_unit)}</span>
            <button class="icon-btn" data-scale="1" aria-label="Mais porções">${icon('plus')}</button>
          </div>
        </div>
        <div class="scale-quick">${[0.5, 1, 2, 3].map((x) => `<button class="chip" data-scale-x="${x}">${x === 0.5 ? '½' : x}×</button>`).join('')}<button class="chip" data-units-toggle title="Converter medidas caseiras para gramas/ml (aprox.)">g / ml</button></div>
        <ul class="ing-list">${ingHtml}</ul>
        <div class="ing-actions">
          <button class="btn btn-ghost btn-sm" data-add-list>${icon('cart')} Adicionar à lista de compras</button>
          <button class="btn btn-ghost btn-sm" data-ing-clear>Desmarcar tudo</button>
        </div>
      </section>

      ${renderAd('recipe_middle')}

      <section class="method" id="preparo">
        <div class="section-head">
          <h2>Modo de preparo</h2>
          <span class="step-progress"><b data-done-count>0</b>/${r.steps.length} passos</span>
        </div>
        <ol class="steps">${stepsHtml(r, links, true)}</ol>
        <button class="btn btn-primary btn-block" data-cook-start>${icon('chef')} Cozinhar passo a passo (timers e voz)</button>
      </section>

      ${r.tips ? `<section class="tips prose"><h2>💡 Dicas</h2>${u.miniMarkdown(r.tips)}</section>` : ''}
      ${r.nutrition ? nutritionTable(r) : ''}
      ${renderProducts(products)}
      ${renderAd('recipe_bottom')}
      ${r.author?.bio ? `<aside class="author-card">${avatar(r.author, 'avatar-lg2')}<div><p class="author-k">Quem fez esta receita</p><p class="author-n">${esc(r.author.name)}</p>${u.miniMarkdown(String(r.author.bio).slice(0, 600))}</div></aside>` : ''}
      ${r.source_url ? `<p class="source">Fonte/inspiração: <a href="${esc(r.source_url)}" rel="nofollow noopener" target="_blank">${esc(r.source_name || r.source_url)}</a></p>` : ''}

      <section class="comments" id="comentarios">
        <h2>Comentários e avaliações</h2>
        <form class="comment-form" data-comment-form>
          <div class="rate" role="radiogroup" aria-label="Sua nota">${[5, 4, 3, 2, 1].map((n) => `<input type="radio" name="rating" value="${n}" id="rt${n}"><label for="rt${n}" title="${n} estrelas">★</label>`).join('')}</div>
          <input name="name" placeholder="Seu nome" required maxlength="60">
          <textarea name="body" placeholder="Fez a receita? Conte como ficou!" rows="3" maxlength="3000"></textarea>
          <input name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
          <button class="btn btn-primary">Enviar</button>
        </form>
        <ul class="comment-list">${comments.map((cm) => `<li><div class="comment-head"><strong>${esc(cm.name)}</strong>${cm.rating ? `<span class="stars">${'★'.repeat(cm.rating)}${'☆'.repeat(5 - cm.rating)}</span>` : ''}<time>${esc(new Date(cm.created_at + 'Z').toLocaleDateString('pt-BR'))}</time></div>${cm.body ? `<p>${esc(cm.body)}</p>` : ''}</li>`).join('') || '<li class="empty">Seja o primeiro a comentar!</li>'}</ul>
      </section>

      <nav class="adjacent">
        ${adjacent.prev ? `<a href="/receita/${esc(adjacent.prev.slug)}">${icon('arrowL')}<span><small>Anterior</small>${esc(adjacent.prev.title)}</span></a>` : '<span></span>'}
        ${adjacent.next ? `<a href="/receita/${esc(adjacent.next.slug)}" class="next"><span><small>Próxima</small>${esc(adjacent.next.title)}</span>${icon('arrowR')}</a>` : ''}
      </nav>
    </div>
    <aside class="recipe-side">
      ${renderAd('sidebar')}
      ${s.newsletterEnabled ? `<form class="newsletter" data-newsletter><h3>Receitas no seu e-mail</h3><p>Novidades toda semana, sem spam.</p><input type="email" name="email" placeholder="seu@email.com" required><button class="btn btn-primary btn-block">Quero receber</button></form>` : ''}
    </aside>
  </div>

  ${related.length ? `<section class="related wrap-inner"><h2>Você também vai gostar</h2>${c.grid(related)}</section>` : ''}
</article>

<div class="cook" hidden aria-modal="true" role="dialog" aria-label="Modo cozinha">
  <div class="cook-top">
    <button class="icon-btn" data-cook-close aria-label="Sair do modo cozinha">${icon('x')}</button>
    <div class="cook-progress"><span></span></div>
    <span class="cook-count"></span>
    <button class="icon-btn" data-cook-voice aria-label="Ler em voz alta" title="Ler em voz alta">${icon('volume')}</button>
    <button class="icon-btn" data-cook-listen aria-label="Comandos de voz" title='Comandos de voz: "próximo", "voltar", "repetir", "timer"'>${icon('mic')}</button>
    <button class="icon-btn" data-cook-ings aria-label="Ver ingredientes">${icon('list')}</button>
  </div>
  <div class="cook-track"></div>
  <div class="cook-nav">
    <button class="btn btn-ghost btn-lg" data-cook-prev>${icon('arrowL')} Voltar</button>
    <button class="btn btn-primary btn-lg" data-cook-next>Próximo ${icon('arrowR')}</button>
  </div>
  <div class="cook-drawer" hidden><h3>Ingredientes</h3><ul></ul></div>
  <template data-cook-done-ad>${renderAd('cook_mode')}</template>
</div>
<div class="timer-dock" aria-live="polite"></div>
<dialog class="qr-dialog"><div class="qr-box"><img alt="QR code da receita" width="240" height="240"><p>Aponte a câmera para abrir a receita</p>${c.codeCopy(r.code, { cls: 'code-copy-lg' })}<button class="btn" data-close-dialog>Fechar</button></div></dialog>
<script type="application/json" id="recipe-data">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;

  const crumbs = [['Início', '/'], ...(r.category ? [[r.category.name, `/categoria/${r.category.slug}`]] : []), [r.title, `/receita/${r.slug}`]];
  return layout({
    title: r.title,
    seoTitle: r.seo_title || seoTitle(r),
    description: r.seo_description || r.description || autoDescription(r),
    canonical: `${base}/receita/${r.slug}`,
    image: r.cover || '',
    imageAlt: r.title,
    type: 'article',
    article: { published: r.published_at || r.created_at, modified: r.updated_at, section: r.category?.name, tags: r.tags },
    jsonLd: [jsonLd(r, base), breadcrumbLd(crumbs)],
    body,
    bodyClass: 'page-recipe',
    scripts: ['/js/recipe.js'],
    noindex: r.status !== 'published',
    user,
  });
}

/** Título otimizado (até ~60 caracteres no Google): "Bolo de cenoura: receita fácil e passo a passo". */
function seoTitle(r) {
  if (/^receita/i.test(r.title) || r.title.length > 40) return r.title;
  const suffix = r.difficulty === 1 ? ': receita fácil e passo a passo' : ': receita passo a passo';
  return `${r.title}${(r.title + suffix).length <= 62 ? suffix : ''}`;
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(/T|Z$/.test(iso) ? iso : `${iso.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });
}

/** Descrição automática para SEO quando o autor não escreveu uma (até ~155 caracteres). */
function autoDescription(r) {
  const parts = [`Receita de ${r.title}`];
  if (r.total_minutes) parts.push(`pronta em ${u.formatMinutes(r.total_minutes)}`);
  parts.push(`rende ${String(r.servings).replace('.', ',')} ${r.servings_unit}`);
  const ings = r.ingredients.slice(0, 4).map((i) => i.name.toLowerCase()).join(', ');
  return `${parts.join(', ')}. ${ings ? `Leva ${ings}. ` : ''}Passo a passo com timers e modo cozinha.`.slice(0, 160);
}

/** Barra de compartilhamento: links diretos funcionam mesmo sem JavaScript. */
function shareBar(r, base) {
  const s = settings.all();
  const url = `${base}/receita/${r.slug}`;
  const enc = encodeURIComponent;
  const text = `${r.title} — receita #${r.code}`;
  const img = r.cover ? (r.cover.startsWith('/') ? base + r.cover : r.cover) : '';
  const utm = (src) => `${url}?utm_source=${src}&utm_medium=social&utm_campaign=share`;
  const nets = {
    whatsapp: ['WhatsApp', `https://wa.me/?text=${enc(`${text}\n${utm('whatsapp')}`)}`, '#25D366'],
    pinterest: ['Pinterest', `https://pinterest.com/pin/create/button/?url=${enc(utm('pinterest'))}&media=${enc(img)}&description=${enc(text)}`, '#E60023'],
    facebook: ['Facebook', `https://www.facebook.com/sharer/sharer.php?u=${enc(utm('facebook'))}`, '#1877F2'],
    telegram: ['Telegram', `https://t.me/share/url?url=${enc(utm('telegram'))}&text=${enc(text)}`, '#26A5E4'],
    x: ['X', `https://x.com/intent/post?url=${enc(utm('x'))}&text=${enc(text)}${s.twitterHandle ? `&via=${enc(s.twitterHandle.replace(/^@/, ''))}` : ''}`, '#000'],
    email: ['E-mail', `mailto:?subject=${enc(r.title)}&body=${enc(`${text}\n\n${url}`)}`, '#6b625a'],
  };
  const enabled = String(s.shareNetworks || '').split(',').filter((k) => nets[k]);
  return `<div class="share-bar" aria-label="Compartilhar">
    <span>Compartilhar:</span>
    ${enabled.map((k) => `<a class="share-btn share-${k}" href="${esc(nets[k][1])}" target="_blank" rel="noopener nofollow" data-share-net="${k}" style="--c:${nets[k][2]}" title="Compartilhar no ${nets[k][0]}">${nets[k][0]}</a>`).join('')}
    <button class="share-btn" data-copy-link="${esc(url)}">Copiar link</button>
    <button class="share-btn" data-embed="${esc(r.code)}">Incorporar</button>
  </div>`;
}

const NUTRI_LABELS = { calories: 'Calorias', protein: 'Proteínas', carbs: 'Carboidratos', fat: 'Gorduras', saturatedFat: 'Gord. saturadas', fiber: 'Fibras', sugar: 'Açúcares', sodium: 'Sódio' };
function nutritionTable(r) {
  const rows = Object.entries(r.nutrition).filter(([k]) => NUTRI_LABELS[k]).map(([k, v]) => `<div><dt>${NUTRI_LABELS[k]}</dt><dd>${esc(v)}</dd></div>`).join('');
  return rows ? `<section class="nutrition"><h2>Informação nutricional <small>por porção (aprox.)</small></h2><dl>${rows}</dl></section>` : '';
}

module.exports = { recipePage, jsonLd };
