/* Chef — painel administrativo */
(() => {
  'use strict';
  const { $, $$, esc, toast, api } = window.Chef;
  const on = (sel, ev, fn) => document.addEventListener(ev, (e) => { const t = e.target.closest(sel); if (t) fn(e, t); });
  // Código da receita com botão de copiar (mesmo visual das páginas públicas)
  const COPY_ICO = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg><svg class="ico ico-ok" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5L20 7"/></svg>';
  const codeCopy = (code) => `<span class="code-copy"><span class="code-copy-text">#${esc(code)}</span><button type="button" class="code-copy-btn" data-copy-code="${esc(code)}" aria-label="Copiar código #${esc(code)}" title="Copiar código">${COPY_ICO}</button></span>`;
  const fmtDate = (s) => (s ? new Date(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`).toLocaleDateString('pt-BR') : '—');

  // ---------------- Login / configuração inicial ----------------
  on('[data-auth]', 'submit', async (e, f) => {
    e.preventDefault();
    const err = $('.form-error', f);
    err.hidden = true;
    try {
      await api(`/auth/${f.dataset.auth}`, { method: 'POST', body: Object.fromEntries(new FormData(f)) });
      location.href = f.dataset.next?.startsWith('/') ? f.dataset.next : '/admin';
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  });
  const clearOffline = () => navigator.serviceWorker?.controller?.postMessage({ type: 'logout' });
  on('[data-logout-all]', 'click', async () => {
    if (!confirm('Encerrar a sessão em todos os aparelhos (inclusive este)?')) return;
    await api('/auth/logout-all', { method: 'POST' });
    clearOffline();
    location.href = '/admin/login';
  });

  // Auditoria
  const auditRows = $('[data-audit-rows]');
  if (auditRows) {
    api('/audit').then(({ items }) => {
      auditRows.innerHTML = items.map((a) => `<tr><td>${esc(new Date(`${a.created_at.replace(' ', 'T')}Z`).toLocaleString('pt-BR'))}</td><td>${esc(a.email || '—')}</td><td><code>${esc(a.action)}</code></td><td>${esc(a.detail)}</td><td><small>${esc(a.ip_hash)}</small></td></tr>`).join('') || '<tr><td colspan="5" class="empty">Sem registros</td></tr>';
    });
  }

  // Contadores de caracteres e prévia do resultado no Google
  $$('[data-count]').forEach((el) => {
    const small = el.closest('.field')?.querySelector('small');
    const ideal = Number(el.dataset.count);
    const paint = () => { if (small) small.dataset.count = `${el.value.length}/${ideal}`; small?.classList.toggle('over', el.value.length > ideal); };
    el.addEventListener('input', paint);
    paint();
  });
  const serp = $('[data-serp]');
  if (serp) {
    const f = serp.closest('form');
    const paint = () => {
      const title = f.seo_title.value || f.title.value || 'Título da receita';
      const desc = f.seo_description.value || f.description.value || 'A descrição aparece aqui. Escreva algo que convença a pessoa a clicar.';
      $('[data-serp-url]', serp).textContent = `${location.host} › receita › ${(f.title.value || 'nova-receita').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
      $('[data-serp-title]', serp).textContent = title.length > 60 ? `${title.slice(0, 57)}…` : title;
      $('[data-serp-desc]', serp).textContent = desc.length > 155 ? `${desc.slice(0, 152)}…` : desc;
    };
    f.addEventListener('input', paint);
    paint();
  }

  // ---------------- Painel ----------------
  const stats = $('[data-stats]');
  if (stats) {
    api('/stats').then((s) => {
      const box = (n, l, href) => `<a class="stat" ${href ? `href="${href}"` : ''}><b>${Number(n).toLocaleString('pt-BR')}</b><span>${l}</span></a>`;
      stats.innerHTML = box(s.published, 'publicadas', '/admin/receitas') + box(s.drafts, 'rascunhos', '/admin/receitas') + box(s.views, 'visualizações') + box(s.cooked, 'vezes cozinhadas') + box(s.pendingComments, 'comentários pendentes', '/admin/comentarios') + box(s.subscribers, 'inscritos') + box(s.productClicks, 'cliques em afiliados', '/admin/produtos') + box(s.adImpressions, 'impressões de anúncios');
      $('[data-top]').innerHTML = s.top.map((r) => `<li><a href="/admin/receitas/${r.id}">${esc(r.title)}</a><div class="top-meta">${codeCopy(r.code)}<small>${r.views} ${r.views === 1 ? 'visualização' : 'visualizações'}</small></div></li>`).join('') || '<li>—</li>';
      $('[data-top-products]').innerHTML = s.topProducts.map((p) => `<li>${esc(p.title)} <small>${p.clicks} cliques</small></li>`).join('') || '<li>—</li>';
    });
  }

  // ---------------- Lista de receitas ----------------
  const rows = $('[data-recipe-rows]');
  if (rows) {
    const f = $('[data-recipe-filter]');
    let page = 1;
    const load = async () => {
      const q = new URLSearchParams({ q: f.q.value, status: f.status.value, page, perPage: 25, sort: f.q.value ? '' : 'updated' });
      const res = await api(`/recipes?${q}`);
      rows.innerHTML = res.items.map((r) => `<tr><td>${r.image || r.cover ? `<img class="thumb" src="${esc(r.image || r.cover)}" alt="">` : ''}</td><td><a href="/admin/receitas/${r.id}"><strong>${esc(r.title)}</strong></a><br><small>${esc(r.category?.name || '')}</small></td><td>${codeCopy(r.code)}</td><td><span class="status status-${r.status}">${r.status === 'published' ? 'Publicada' : 'Rascunho'}</span></td><td>${r.views}</td><td class="row-actions"><a href="/receita/${esc(r.slug)}" target="_blank">ver</a> <a href="/admin/receitas/${r.id}">editar</a></td></tr>`).join('') || '<tr><td colspan="6" class="empty">Nenhuma receita</td></tr>';
      $('[data-pager]').innerHTML = res.pages > 1 ? `${page > 1 ? '<button class="btn btn-sm" data-page="-1">← Anterior</button>' : ''} <span>Página ${page} de ${res.pages}</span> ${page < res.pages ? '<button class="btn btn-sm" data-page="1">Próxima →</button>' : ''}` : '';
    };
    let t;
    f.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { page = 1; load(); }, 200); });
    f.addEventListener('submit', (e) => e.preventDefault());
    on('[data-page]', 'click', (e, b) => { page += Number(b.dataset.page); load(); });
    load();
  }

  // ---------------- Upload (com redimensionamento de imagens no navegador) ----------------
  async function shrinkImage(file, max = 2000, quality = 0.85) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 400 * 1024) return file;
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bmp.width * scale);
      canvas.height = Math.round(bmp.height * scale);
      canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/webp', quality));
      return blob && blob.size < file.size ? new File([blob], file.name.replace(/\.\w+$/, '.webp'), { type: 'image/webp' }) : file;
    } catch { return file; }
  }
  async function uploadFiles(files) {
    const fd = new FormData();
    for (const f of files) fd.append('files', await shrinkImage(f));
    toast(`Enviando ${files.length} arquivo(s)…`, 10000);
    const res = await api('/uploads', { method: 'POST', body: fd });
    toast('✅ Enviado');
    return res.files;
  }
  function pickFiles(accept, multiple = true) {
    return new Promise((resolve) => {
      const i = document.createElement('input');
      i.type = 'file';
      i.accept = accept;
      i.multiple = multiple;
      i.onchange = () => resolve([...i.files]);
      i.click();
    });
  }

  // ---------------- Editor de receitas ----------------
  const editor = $('[data-editor]');
  if (editor) {
    const media = $('[data-media]');
    const mediaItem = (url, caption = '') => {
      const li = document.createElement('li');
      li.className = 'media-item';
      li.draggable = true;
      li.dataset.url = url;
      const isVideo = /\.(mp4|webm|ogg|mov|m4v)(\?|$)/i.test(url);
      li.innerHTML = `${isVideo ? `<video src="${esc(url)}" muted></video>` : `<img src="${esc(url)}" alt="">`}<input class="media-caption" value="${esc(caption)}" placeholder="Legenda"><div class="media-tools"><button type="button" class="icon-btn" data-media-left>‹</button><button type="button" class="icon-btn" data-media-remove>✕</button><button type="button" class="icon-btn" data-media-right>›</button></div>`;
      return li;
    };
    const addMedia = async (files) => {
      try {
        for (const f of await uploadFiles(files)) {
          if (f.type === 'video') {
            editor.video.value = f.url;
            toast('🎬 Vídeo definido como vídeo da receita');
          } else media.appendChild(mediaItem(f.url));
        }
      } catch (err) { toast(err.message); }
    };
    on('[data-pick-files]', 'click', async () => addMedia(await pickFiles('image/*,video/*')));
    const dz = $('[data-dropzone]');
    ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('over'); }));
    dz.addEventListener('drop', (e) => { if (e.dataTransfer.files.length) addMedia([...e.dataTransfer.files]); });
    // Colar imagem da área de transferência
    document.addEventListener('paste', (e) => {
      const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
      if (files.length && !e.target.closest('textarea, input')) { e.preventDefault(); addMedia(files); }
    });
    on('[data-media-remove]', 'click', (e, b) => b.closest('.media-item').remove());
    on('[data-media-left]', 'click', (e, b) => { const li = b.closest('.media-item'); if (li.previousElementSibling) li.parentNode.insertBefore(li, li.previousElementSibling); });
    on('[data-media-right]', 'click', (e, b) => { const li = b.closest('.media-item'); if (li.nextElementSibling) li.parentNode.insertBefore(li.nextElementSibling, li); });
    let dragged;
    media.addEventListener('dragstart', (e) => { dragged = e.target.closest('.media-item'); });
    media.addEventListener('dragover', (e) => { e.preventDefault(); const over = e.target.closest('.media-item'); if (dragged && over && over !== dragged) media.insertBefore(dragged, over.compareDocumentPosition(dragged) & Node.DOCUMENT_POSITION_FOLLOWING ? over : over.nextSibling); });

    // Pré-visualização do parser de ingredientes
    const ingInput = $('[data-ing-input]');
    const preview = $('[data-ing-preview]');
    const QTY = /^((?:\d+\s+\d+\/\d+)|(?:\d+\s*[½⅓⅔¼¾⅛])|(?:\d+\/\d+)|(?:\d+(?:[.,]\d+)?)|[½⅓⅔¼¾⅛])/;
    const paintPreview = () => {
      preview.innerHTML = ingInput.value.split('\n').filter((l) => l.trim()).map((l) => {
        const t = l.trim();
        if (/^#/.test(t)) return `<div class="pv-group">${esc(t.replace(/^#+\s*/, ''))}</div>`;
        const m = t.match(QTY);
        return `<div class="pv-line">${m ? `<b>${esc(m[1])}</b>${esc(t.slice(m[0].length))}` : `<span class="pv-noqty">${esc(t)}</span>`}</div>`;
      }).join('') || '<small>A pré-visualização aparece aqui. Quantidades em destaque serão ajustadas automaticamente ao mudar as porções.</small>';
    };
    ingInput.addEventListener('input', paintPreview);
    paintPreview();

    // Passos
    const steps = $('[data-steps]');
    const tpl = $('[data-step-template]');
    const newStep = (text = '') => {
      const li = tpl.content.firstElementChild.cloneNode(true);
      $('.step-text', li).value = text;
      return li;
    };
    const TIME_RE = /(\d+(?:[.,]\d+)?)(?:\s*(?:a|-|–|ou)\s*(\d+(?:[.,]\d+)?))?\s*(horas?|h\b|minutos?|min\b)/i;
    const autoTimer = (li) => {
      const timer = $('.step-timer', li);
      if (timer.dataset.touched) return;
      const m = $('.step-text', li).value.match(TIME_RE);
      timer.value = m ? Number((m[2] || m[1]).replace(',', '.')) * (/^h/i.test(m[3]) ? 60 : 1) : '';
    };
    on('[data-step-add]', 'click', () => { const li = newStep(); steps.appendChild(li); $('.step-text', li).focus(); });
    on('[data-step-remove]', 'click', (e, b) => b.closest('.step-item').remove());
    on('[data-step-up]', 'click', (e, b) => { const li = b.closest('.step-item'); if (li.previousElementSibling) steps.insertBefore(li, li.previousElementSibling); });
    on('[data-step-down]', 'click', (e, b) => { const li = b.closest('.step-item'); if (li.nextElementSibling) steps.insertBefore(li.nextElementSibling, li); });
    steps.addEventListener('input', (e) => {
      if (e.target.matches('.step-text')) autoTimer(e.target.closest('.step-item'));
      if (e.target.matches('.step-timer')) e.target.dataset.touched = '1';
    });
    on('[data-step-photo]', 'click', async (e, b) => {
      const files = await pickFiles('image/*', false);
      if (!files.length) return;
      try {
        const [f] = await uploadFiles(files);
        const wrap = b.closest('.step-img-wrap');
        $('.step-image', wrap).value = f.url;
        $('img', wrap)?.remove();
        wrap.insertAdjacentHTML('afterbegin', `<img src="${esc(f.url)}" alt="">`);
      } catch (err) { toast(err.message); }
    });
    const pasteDlg = $('.paste-dialog');
    on('[data-steps-paste]', 'click', () => { $('[data-paste-text]').value = $$('.step-text', steps).map((t) => t.value).join('\n'); pasteDlg.showModal(); });
    pasteDlg.addEventListener('close', () => {
      if (pasteDlg.returnValue !== 'ok') return;
      steps.innerHTML = '';
      let group = '';
      for (const line of $('[data-paste-text]').value.split('\n').map((l) => l.trim()).filter(Boolean)) {
        if (/^#/.test(line)) { group = line.replace(/^#+\s*/, ''); continue; }
        const li = newStep(line.replace(/^(passo\s*)?\d+\s*[.)\-–:]\s*/i, ''));
        $('.step-group', li).value = group;
        autoTimer(li);
        steps.appendChild(li);
      }
    });
    if (!steps.children.length) steps.appendChild(newStep());

    const collect = () => {
      const fd = new FormData(editor);
      const data = {};
      for (const k of ['title', 'description', 'story', 'video', 'ingredients', 'tips', 'code', 'category_id', 'seo_title', 'seo_description', 'prep_minutes', 'cook_minutes', 'rest_minutes', 'servings', 'servings_unit', 'difficulty', 'cuisine', 'tags', 'diets', 'source_name', 'source_url', 'status']) data[k] = fd.get(k) ?? '';
      if (editor.featured) data.featured = editor.featured.checked;
      data.products = fd.getAll('products').map(Number);
      data.nutrition = {};
      for (const [k, v] of fd) if (k.startsWith('nutrition.') && v) data.nutrition[k.slice(10)] = v;
      const items = $$('.media-item', media).map((li) => ({ url: li.dataset.url, caption: $('.media-caption', li).value }));
      data.cover = items[0]?.url || '';
      data.images = items.slice(1);
      data.steps = $$('.step-item', steps).map((li) => ({
        text: $('.step-text', li).value.trim(),
        group: $('.step-group', li).value.trim(),
        image: $('.step-image', li).value,
        timer: $('.step-timer', li).value ? Math.round(Number($('.step-timer', li).value) * 60) : 0,
      })).filter((s) => s.text);
      if (!data.code) delete data.code;
      return data;
    };
    let dirty = false;
    editor.addEventListener('input', () => { dirty = true; });
    addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
    editor.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = editor.dataset.id;
      try {
        const wasPublished = editor.dataset.published === '1';
        const r = await api(id ? `/recipes/${id}` : '/recipes', { method: id ? 'PUT' : 'POST', body: collect() });
        dirty = false;
        toast('✅ Receita salva');
        // Acabou de publicar: oferece enviar para os inscritos da newsletter
        if (r.status === 'published' && !wasPublished && editor.dataset.admin === '1') {
          editor.dataset.published = '1';
          try {
            const nl = await api('/newsletter');
            if (nl.mail.configured && nl.subscribers.confirmed > 0 && confirm(`Receita publicada! 🎉\n\nQuer enviar “${r.title}” para os ${nl.subscribers.confirmed} inscritos da newsletter?`)) {
              location.href = `/admin/newsletter?receita=${r.id}`;
              return;
            }
          } catch { /* sem permissão ou sem e-mail: segue normal */ }
        }
        if (!id) location.href = `/admin/receitas/${r.id}`;
        else if ($('.admin-head h1 .code-copy')) $('.admin-head h1 .code-copy').outerHTML = codeCopy(r.code);
      } catch (err) { toast(`⚠️ ${err.message}`, 5000); }
    });
    document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); editor.requestSubmit(); } });
    on('[data-delete]', 'click', async () => {
      if (!confirm('Excluir esta receita definitivamente?')) return;
      await api(`/recipes/${editor.dataset.id}`, { method: 'DELETE' });
      dirty = false;
      location.href = '/admin/receitas';
    });
    on('[data-duplicate]', 'click', async () => {
      const r = await api(`/recipes/${editor.dataset.id}/duplicate`, { method: 'POST' });
      dirty = false;
      location.href = `/admin/receitas/${r.id}`;
    });
  }

  // ---------------- Importação ----------------
  const imp = $('[data-import]');
  if (imp) {
    const out = $('[data-import-preview]');
    let preview;
    imp.addEventListener('submit', async (e) => {
      e.preventDefault();
      out.innerHTML = '<p>Lendo a página…</p>';
      try {
        ({ preview } = await api('/import', { method: 'POST', body: { url: imp.url.value, downloadImages: imp.downloadImages.checked } }));
        out.innerHTML = `<div class="import-card">${preview.cover ? `<img src="${esc(preview.cover)}" alt="">` : ''}<div><h3>${esc(preview.title)}</h3><p>${esc(preview.description || '')}</p>
          <p><small>Detectado via <b>${esc(preview._method)}</b> · ${preview.ingredients?.length || 0} ingredientes · ${preview.steps?.length || 0} passos${preview.video ? ' · com vídeo' : ''}</small></p>
          <details><summary>Ver ingredientes e passos</summary><ul>${(preview.ingredients || []).map((i) => `<li>${esc(typeof i === 'string' ? i : i.raw)}</li>`).join('')}</ul><ol>${(preview.steps || []).map((s) => `<li>${esc(s.text || s)}</li>`).join('')}</ol></details>
          <p><button class="btn btn-primary" data-import-save="draft">Salvar como rascunho e editar</button> <button class="btn btn-ghost" data-import-save="published">Publicar direto</button></p></div></div>`;
      } catch (err) { out.innerHTML = `<p class="form-error">⚠️ ${esc(err.message)}</p>`; }
    });
    on('[data-import-save]', 'click', async (e, b) => {
      try {
        const r = await api('/recipes', { method: 'POST', body: { ...preview, status: b.dataset.importSave } });
        location.href = `/admin/receitas/${r.id}`;
      } catch (err) { toast(err.message); }
    });
    const bm = $('[data-bookmarklet]');
    bm.href = `javascript:(()=>{window.open('${location.origin}/admin/importar?url='+encodeURIComponent(location.href),'_blank')})()`;
    bm.addEventListener('click', (e) => { e.preventDefault(); toast('Arraste o botão para a barra de favoritos'); });
    if (imp.url.value) imp.requestSubmit();
    const jf = $('[data-import-json]');
    jf.addEventListener('submit', async (e) => {
      e.preventDefault();
      const file = $('input[type=file]', jf).files[0];
      if (!file) return;
      try {
        const json = JSON.parse(await file.text());
        const res = await api('/import/json', { method: 'POST', body: json });
        $('[data-import-json-result]').innerHTML = `<p>✅ ${res.created} receitas importadas${res.errors.length ? `, ${res.errors.length} com erro` : ''}.</p>`;
      } catch (err) { $('[data-import-json-result]').innerHTML = `<p class="form-error">⚠️ ${esc(err.message)}</p>`; }
    });
  }

  // ---------------- Formulários CRUD genéricos ----------------
  function crud({ form, list, path, row, toBody = (f) => Object.fromEntries(new FormData(f)), fill }) {
    const f = $(form);
    const el = $(list);
    if (!f || !el) return;
    let items = [];
    const load = async () => {
      const res = await api(path);
      items = res.items;
      el.innerHTML = items.map(row).join('') || '<tr><td colspan="9" class="empty">Nada cadastrado ainda</td></tr>';
    };
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = toBody(f);
      const id = f.id?.value;
      try {
        const saved = await api(id ? `${path}/${id}` : path, { method: id ? 'PUT' : 'POST', body });
        f.reset();
        if (f.id) f.id.value = '';
        f.dispatchEvent(new Event('change'));
        toast(saved?.warning ? `⚠️ ${saved.warning}` : saved?.invited ? '📧 Convite enviado por e-mail' : '✅ Salvo', saved?.warning ? 7000 : 2600);
        load();
      } catch (err) { toast(`⚠️ ${err.message}`); }
    });
    el.addEventListener('click', async (e) => {
      const del = e.target.closest('[data-del]');
      if (del && confirm('Remover?')) { await api(`${path}/${del.dataset.del}`, { method: 'DELETE' }); load(); }
      const ed = e.target.closest('[data-edit]');
      if (ed && fill) { fill(f, items.find((i) => String(i.id) === ed.dataset.edit)); f.scrollIntoView({ behavior: 'smooth' }); }
    });
    load();
    return { load };
  }

  crud({
    form: '[data-cat-form]', list: '[data-cat-rows]', path: '/categories',
    row: (c) => `<tr><td style="font-size:1.5rem">${esc(c.icon)}</td><td><strong>${esc(c.name)}</strong><br><small>/categoria/${esc(c.slug)}</small></td><td>${c.count}</td><td>${c.position}</td><td class="row-actions"><button class="link" data-del="${c.id}">remover</button></td></tr>`,
  });

  crud({
    form: '[data-product-form]', list: '[data-product-list]', path: '/products',
    toBody: (f) => { const b = Object.fromEntries(new FormData(f)); if (/^[A-Z0-9]{10}$/i.test(b.url.trim())) { b.asin = b.url.trim(); b.url = ''; } return b; },
    fill: (f, p) => { for (const k of ['id', 'title', 'image', 'price', 'badge', 'description', 'keywords']) f[k].value = p[k] || ''; f.url.value = p.url || p.asin; },
    row: (p) => `<div class="product-admin">${p.image ? `<img src="${esc(p.image)}" alt="">` : '<div class="product-ph">🛒</div>'}<div><strong>${esc(p.title)}</strong><br><small>${p.asin ? `ASIN ${esc(p.asin)} · ` : ''}${p.clicks} cliques${p.keywords ? ` · 🔑 ${esc(p.keywords)}` : ''}</small><div class="row-actions"><a href="/go/${p.id}" target="_blank">testar link</a> <button class="link" data-edit="${p.id}">editar</button> <button class="link" data-del="${p.id}">remover</button></div></div></div>`,
  });

  crud({
    form: '[data-ad-form]', list: '[data-ad-rows]', path: '/ads',
    toBody: (f) => ({ ...Object.fromEntries(new FormData(f)), active: f.active.checked }),
    fill: (f, a) => { for (const k of ['id', 'name', 'slot', 'device', 'html', 'weight']) f[k].value = a[k]; f.active.checked = !!a.active; },
    row: (a) => `<tr><td><strong>${esc(a.name)}</strong></td><td>${esc(a.slot)}</td><td>${esc(a.device)}</td><td>${a.impressions}</td><td>${a.active ? '✅' : '—'}</td><td class="row-actions"><button class="link" data-edit="${a.id}">editar</button> <button class="link" data-del="${a.id}">remover</button></td></tr>`,
  });

  crud({
    form: '[data-user-form]', list: '[data-user-rows]', path: '/users',
    toBody: (f) => { const b = Object.fromEntries(new FormData(f)); b.invite = !!f.invite?.checked; if (b.invite) delete b.password; return b; },
    row: (u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${u.role === 'admin' ? 'Administrador' : 'Autor'}</td><td class="row-actions">${mailReady ? `<button class="link" data-reinvite="${u.id}">enviar convite</button> ` : ''}<button class="link" data-del="${u.id}">remover</button></td></tr>`,
  });

  // ---------------- Usuários: convite por e-mail ----------------
  let mailReady = false;
  const userForm = $('[data-user-form]');
  if (userForm) {
    api('/mail/status').then((st) => {
      mailReady = st.configured && !!st.siteUrl;
      $('[data-invite-wrap]').hidden = !mailReady;
    }).catch(() => {});
    userForm.addEventListener('change', () => {
      const inv = userForm.invite?.checked;
      const pass = $('[data-user-pass]', userForm);
      pass.required = !inv;
      pass.hidden = !!inv;
    });
    on('[data-reinvite]', 'click', async (e, b) => {
      try { await api(`/users/${b.dataset.reinvite}/invite`, { method: 'POST' }); toast('📧 Convite enviado'); } catch (err) { toast(`⚠️ ${err.message}`, 6000); }
    });
  }

  // Chaves de API (mostra a chave uma única vez)
  const keyForm = $('[data-key-form]');
  if (keyForm) {
    const listEl = $('[data-key-rows]');
    const loadKeys = async () => { const res = await api('/keys'); listEl.innerHTML = res.items.map((k) => `<tr><td>${esc(k.name)}</td><td><code>${esc(k.prefix)}…</code></td><td>${fmtDate(k.created_at)}</td><td>${fmtDate(k.last_used_at)}</td><td class="row-actions"><button class="link" data-revoke="${k.id}">revogar</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty">Nenhuma chave</td></tr>'; };
    keyForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const k = await api('/keys', { method: 'POST', body: { name: keyForm.name.value } });
      keyForm.reset();
      const box = $('[data-key-reveal]');
      box.hidden = false;
      box.innerHTML = `<p>🔑 Copie sua chave agora — ela não será exibida novamente:</p><pre><code>${esc(k.key)}</code></pre><button class="btn btn-sm" data-copy-key="${esc(k.key)}">Copiar</button>`;
      loadKeys();
    });
    on('[data-copy-key]', 'click', async (e, b) => { if (await window.Chef.copyText(b.dataset.copyKey)) toast('🔑 Chave copiada'); else prompt('Copie a chave:', b.dataset.copyKey); });
    on('[data-revoke]', 'click', async (e, b) => { if (confirm('Revogar esta chave?')) { await api(`/keys/${b.dataset.revoke}`, { method: 'DELETE' }); loadKeys(); } });
    loadKeys();
  }

  // Comentários
  const clist = $('[data-comment-list]');
  if (clist) {
    let status = 'pending';
    const load = async () => {
      const res = await api(`/comments?status=${status}`);
      clist.innerHTML = res.items.map((c) => `<div class="panel comment-admin"><div class="comment-head"><strong>${esc(c.name)}</strong>${c.rating ? `<span class="stars">${'★'.repeat(c.rating)}</span>` : ''} em <a href="/receita/${esc(c.recipe_slug)}#comentarios" target="_blank">${esc(c.recipe_title)}</a><time>${fmtDate(c.created_at)}</time></div><p>${esc(c.body)}</p>
        <div class="row-actions">${c.status !== 'approved' ? `<button class="btn btn-sm btn-primary" data-cstatus="approved" data-cid="${c.id}">Aprovar</button>` : ''} ${c.status !== 'spam' ? `<button class="btn btn-sm" data-cstatus="spam" data-cid="${c.id}">Spam</button>` : ''} <button class="btn btn-sm btn-danger" data-cdel="${c.id}">Excluir</button></div></div>`).join('') || '<p class="empty">Nenhum comentário aqui.</p>';
    };
    on('[data-comment-tabs] button', 'click', (e, b) => { status = b.dataset.status; $$('[data-comment-tabs] button').forEach((x) => x.classList.toggle('active', x === b)); load(); });
    on('[data-cstatus]', 'click', async (e, b) => { await api(`/comments/${b.dataset.cid}`, { method: 'PATCH', body: { status: b.dataset.cstatus } }); load(); });
    on('[data-cdel]', 'click', async (e, b) => { if (confirm('Excluir comentário?')) { await api(`/comments/${b.dataset.cdel}`, { method: 'DELETE' }); load(); } });
    load();
  }

  // Configurações
  const sf = $('[data-settings]');
  if (sf) {
    sf.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = { social: {} };
      for (const el of sf.elements) {
        if (!el.name) continue;
        const v = el.type === 'checkbox' ? el.checked : el.value;
        if (el.name.startsWith('social.')) body.social[el.name.slice(7)] = v; else body[el.name] = v;
      }
      try { await api('/settings', { method: 'PUT', body }); toast('✅ Configurações salvas'); } catch (err) { toast(err.message); }
    });
  }
  // ---------------- Meu perfil ----------------
  const prof = $('[data-profile]');
  if (prof) {
    const showErr = (form, msg, field) => {
      const el = $('.form-error', form);
      el.textContent = msg || ''; el.hidden = !msg;
      if (field && form.elements[field]) form.elements[field].focus();
    };
    const paintUser = (u) => {
      $$('[data-profile-name]').forEach((el) => { el.textContent = u.name; });
      $$('[data-profile-email]').forEach((el) => { el.textContent = u.email; });
    };
    const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
    const paintAvatar = (u) => {
      const html = u.avatar ? `<img class="avatar avatar-xl" src="${esc(u.avatar)}" alt="">` : `<span class="avatar avatar-initials avatar-xl">${esc(initials(u.name))}</span>`;
      $('[data-avatar-preview]').innerHTML = html;
      const small = u.avatar ? `<img class="avatar avatar-xs" src="${esc(u.avatar)}" alt="">` : `<span class="avatar avatar-initials avatar-xs">${esc(initials(u.name))}</span>`;
      const nav = $('.nav-profile .avatar'); if (nav) nav.outerHTML = small;
      $('[data-avatar-remove]').hidden = !u.avatar;
      $('[data-avatar-pick]').lastChild.textContent = u.avatar ? ' Trocar foto' : ' Adicionar foto';
      prof.elements.avatar.value = u.avatar || '';
    };

    // E-mail: ao mudar, pede a senha atual
    const emailIn = prof.elements.email;
    const syncEmail = () => { $('[data-email-confirm]', prof).hidden = emailIn.value.trim().toLowerCase() === emailIn.dataset.emailOrig.toLowerCase(); };
    emailIn.addEventListener('input', syncEmail);

    const bio = prof.elements.bio;

    prof.addEventListener('submit', async (e) => {
      e.preventDefault();
      showErr(prof, '');
      const body = { name: prof.elements.name.value.trim(), email: emailIn.value.trim(), bio: bio.value, avatar: prof.elements.avatar.value.trim() };
      if (!body.name) return showErr(prof, 'Informe seu nome', 'name');
      if (!emailIn.checkValidity()) return showErr(prof, 'E-mail inválido', 'email');
      const changingEmail = !$('[data-email-confirm]', prof).hidden;
      if (changingEmail) {
        body.currentPassword = prof.elements.currentPassword.value;
        if (!body.currentPassword) return showErr(prof, 'Digite sua senha atual para trocar o e-mail', 'currentPassword');
      }
      const btn = $('button.btn-primary', prof); btn.disabled = true;
      try {
        const { user } = await api('/auth/me', { method: 'PUT', body });
        paintUser(user); paintAvatar(user);
        emailIn.dataset.emailOrig = user.email; prof.elements.currentPassword.value = ''; syncEmail();
        toast(changingEmail ? '✅ Perfil salvo. Use o novo e-mail no próximo login.' : '✅ Perfil salvo');
      } catch (err) { showErr(prof, err.message, err.data?.field); } finally { btn.disabled = false; }
    });

    // Foto: escolhe, recorta em quadrado (centro), reduz para 512 px e envia
    const fileIn = $('[data-avatar-file]');
    on('[data-avatar-pick]', 'click', () => fileIn.click());
    const squareJpeg = (file) => new Promise((resolve) => {
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return resolve(file); // GIF animado vai como está
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        const size = Math.min(512, side);
        const c = Object.assign(document.createElement('canvas'), { width: size, height: size });
        c.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
        URL.revokeObjectURL(url);
        c.toBlob((b) => resolve(b ? new File([b], 'avatar.jpg', { type: 'image/jpeg' }) : file), 'image/jpeg', 0.88);
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
    fileIn.addEventListener('change', async () => {
      const file = fileIn.files[0]; fileIn.value = '';
      if (!file) return;
      if (file.size > 15 * 1024 * 1024) return toast('A foto é muito grande (máx. 15 MB)');
      const pick = $('[data-avatar-pick]'); pick.disabled = true;
      $('[data-avatar-preview]').classList.add('loading');
      try {
        const fd = new FormData();
        fd.append('files', await squareJpeg(file));
        const up = await api('/uploads', { method: 'POST', body: fd });
        const { user } = await api('/auth/me', { method: 'PUT', body: { avatar: up.files[0].url } });
        paintAvatar(user); toast('📸 Foto atualizada');
      } catch (err) { toast(err.message); } finally { pick.disabled = false; $('[data-avatar-preview]').classList.remove('loading'); }
    });
    on('[data-avatar-remove]', 'click', async () => {
      if (!confirm('Remover sua foto de perfil?')) return;
      try { const { user } = await api('/auth/me', { method: 'PUT', body: { avatar: '' } }); paintAvatar(user); toast('Foto removida'); } catch (err) { toast(err.message); }
    });

    // Senha
    const pwf = $('[data-password]');
    const meter = $('[data-pw-meter]', pwf);
    const strength = (p) => {
      let n = 0;
      if (p.length >= 8) n++; if (p.length >= 12) n++;
      if (/[a-z]/.test(p) && /[A-Z]/.test(p)) n++; if (/\d/.test(p)) n++; if (/[^\w\s]/.test(p)) n++;
      return Math.min(4, Math.max(p.length ? 1 : 0, n - (p.length < 8 ? 2 : 0)));
    };
    pwf.elements.password.addEventListener('input', () => {
      const p = pwf.elements.password.value;
      meter.hidden = !p;
      const n = strength(p);
      meter.dataset.level = n;
      meter.querySelector('small').textContent = ['', 'Fraca', 'Razoável', 'Boa', 'Forte'][n];
    });
    pwf.addEventListener('submit', async (e) => {
      e.preventDefault();
      showErr(pwf, '');
      const { currentPassword, password, confirm: conf } = pwf.elements;
      if (!currentPassword.value) return showErr(pwf, 'Digite sua senha atual', 'currentPassword');
      if (password.value.length < 8) return showErr(pwf, 'A nova senha precisa ter pelo menos 8 caracteres', 'password');
      if (password.value !== conf.value) return showErr(pwf, 'As duas senhas novas não são iguais', 'confirm');
      const btn = $('button.btn-primary', pwf); btn.disabled = true;
      try {
        await api('/auth/me', { method: 'PUT', body: { currentPassword: currentPassword.value, password: password.value } });
        pwf.reset(); meter.hidden = true;
        toast('🔑 Senha alterada. Os outros aparelhos saíram da conta.');
      } catch (err) { showErr(pwf, err.message, err.data?.field); } finally { btn.disabled = false; }
    });

    // Mostrar/ocultar senha
    on('[data-pw-toggle]', 'click', (e, b) => {
      e.preventDefault();
      const input = b.previousElementSibling;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      b.setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha');
      b.classList.toggle('on', show);
    });

    // Tema
    let cur = 'system';
    try { cur = localStorage.getItem('chef:theme') || 'system'; } catch { /* ignore */ }
    $$('[data-theme-pick]').forEach((r) => { r.checked = r.value === cur; });
    on('[data-theme-pick]', 'change', (e, r) => {
      try {
        if (r.value === 'system') { localStorage.removeItem('chef:theme'); delete document.documentElement.dataset.theme; } else { localStorage.setItem('chef:theme', r.value); document.documentElement.dataset.theme = r.value; }
      } catch { /* ignore */ }
    });
  }

  // ---------------- Esqueci minha senha / nova senha ----------------
  const forgot = $('[data-forgot]');
  forgot?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('.form-error', forgot);
    const ok = $('.form-ok', forgot);
    err.hidden = true;
    try {
      const r = await api('/auth/forgot', { method: 'POST', body: { email: forgot.email.value } });
      ok.textContent = `📧 ${r.message}`;
      ok.hidden = false;
      $('button', forgot).disabled = true;
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  });
  const reset = $('[data-reset]');
  reset?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('.form-error', reset);
    err.hidden = true;
    if (reset.password.value !== reset.password2.value) { err.textContent = 'As senhas não conferem'; err.hidden = false; return; }
    try {
      await api('/auth/reset', { method: 'POST', body: { token: reset.dataset.resetKey, password: reset.password.value } });
      toast('✅ Senha salva! Entrando…');
      setTimeout(() => { location.href = '/admin'; }, 700);
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  });

  // ---------------- Configurações: status do e-mail e envio de teste ----------------
  const mailBox = $('[data-mail-status]');
  if (mailBox) {
    const paint = (st) => {
      mailBox.innerHTML = st.configured
        ? `<p class="mail-ok">✅ E-mail configurado: <b>${esc(st.host)}</b>:${st.port} ${st.secure ? '(SSL)' : '(STARTTLS)'} · remetente <b>${esc(st.from)}</b></p>
           ${st.siteUrl ? `<p><small>Links dos e-mails apontam para <b>${esc(st.siteUrl)}</b></small></p>` : '<p class="warn">⚠️ Defina o endereço do site abaixo (ou entre no painel pelo endereço que seus leitores usam) para os links dos e-mails funcionarem.</p>'}
           <p><button type="button" class="btn btn-sm" data-mail-test>📧 Enviar e-mail de teste para mim</button></p>`
        : `<p class="warn">✉️ E-mail ainda não configurado. Sem ele o site funciona normalmente, mas não envia: “esqueci minha senha”, avisos de comentário, confirmação/boas-vindas da newsletter e envio de receitas para os inscritos.</p>
           <p><small>Veja como configurar (Gmail, Brevo, domínio próprio) no guia <code>zimaos/LEIA-ME.md</code> → “E-mail (SMTP)”.</small></p>`;
    };
    api('/mail/status').then(paint).catch(() => { mailBox.textContent = ''; });
    on('[data-mail-test]', 'click', async (e, b) => {
      b.disabled = true;
      b.textContent = 'Enviando…';
      try { const r = await api('/mail/test', { method: 'POST' }); toast(`✅ E-mail de teste enviado para ${r.to}. Confira a caixa de entrada (e o spam).`, 7000); } catch (err) { toast(`⚠️ ${err.message}`, 9000); }
      b.disabled = false;
      b.textContent = '📧 Enviar e-mail de teste para mim';
    });
  }

  // ---------------- Newsletter ----------------
  const nlForm = $('[data-nl-form]');
  if (nlForm) {
    const STATUS = { sending: '⏳ Enviando', done: '✅ Concluído', paused: '⏸ Pausado', cancelled: '✖ Cancelado', failed: '⚠️ Falhou' };
    const SUB = { confirmed: '✅ Confirmado', pending: '⏳ Aguardando confirmação', unsubscribed: '✖ Cancelou' };
    let data;
    let poll;
    const load = async () => {
      data = await api('/newsletter');
      const { subscribers: sb, mail: m } = data;
      $('[data-nl-stats]').innerHTML = `<a class="stat"><b>${sb.confirmed}</b><span>inscritos confirmados</span></a><a class="stat"><b>${sb.pending}</b><span>aguardando confirmação</span></a><a class="stat"><b>${sb.unsubscribed}</b><span>cancelaram</span></a>`;
      $('[data-nl-mail]').innerHTML = m.configured
        ? `<p class="mail-ok">✅ Envio por <b>${esc(m.host)}</b> como <b>${esc(m.from)}</b> · velocidade: ${m.ratePerMin} e-mails/min ${m.siteUrl ? '' : '<br><span class="warn">⚠️ Defina o endereço do site em Configurações → E-mail.</span>'}</p>`
        : '<p class="warn">✉️ Configure o e-mail (SMTP) para enviar newsletters. Enquanto isso, você pode baixar os inscritos em CSV.</p>';
      const sel = $('[data-nl-recipes]');
      if (!sel.dataset.filled) {
        sel.innerHTML = '<option value="">Escolha uma receita publicada…</option>' + data.recipes.map((r) => `<option value="${r.id}">${esc(r.title)}${r.sent_before ? ' (já enviada)' : ''}</option>`).join('');
        sel.dataset.filled = '1';
        if (nlForm.dataset.preselect) { sel.value = nlForm.dataset.preselect; sel.dispatchEvent(new Event('change')); }
      }
      $('[data-nl-campaigns]').innerHTML = data.campaigns.length ? `<table class="table table-admin"><thead><tr><th>Quando</th><th>Receita / assunto</th><th>Progresso</th><th>Situação</th><th></th></tr></thead><tbody>${data.campaigns.map((c) => {
        const pct = c.total ? Math.round(((c.sent + c.failed) / c.total) * 100) : 0;
        return `<tr><td>${esc(new Date(`${c.created_at.replace(' ', 'T')}Z`).toLocaleString('pt-BR'))}</td><td><strong>${esc(c.recipe_title || '—')}</strong><br><small>${esc(c.subject)}</small></td>
          <td><div class="nl-bar"><span style="width:${pct}%"></span></div><small>${c.sent} enviados${c.failed ? ` · ${c.failed} falharam` : ''} de ${c.total}</small>${c.last_error ? `<br><small class="warn">${esc(c.last_error)}</small>` : ''}</td>
          <td>${STATUS[c.status] || esc(c.status)}</td>
          <td class="row-actions">${c.status === 'sending' || c.status === 'paused' ? `<button class="link" data-nl-cancel="${c.id}">cancelar</button>` : ''}${c.status === 'paused' ? ` <button class="link" data-nl-resume="${c.id}">retomar</button>` : ''}</td></tr>`;
      }).join('')}</tbody></table>` : '<p class="empty">Nenhum envio ainda.</p>';
      clearTimeout(poll);
      if (data.campaigns.some((c) => c.status === 'sending')) poll = setTimeout(load, 3000);
      const subs = await api('/subscribers');
      $('[data-nl-subs]').innerHTML = subs.items.slice(0, 500).map((x) => `<tr><td>${esc(x.email)}</td><td>${SUB[x.status] || esc(x.status)}</td><td>${esc(fmtDate(x.created_at))}</td><td class="row-actions"><button class="link" data-nl-del="${x.id}">remover</button></td></tr>`).join('') || '<tr><td colspan="4" class="empty">Ninguém inscrito ainda.</td></tr>';
    };
    $('[data-nl-recipes]').addEventListener('change', (e) => {
      const r = data?.recipes.find((x) => String(x.id) === e.target.value);
      if (r && !nlForm.subject.dataset.touched) nlForm.subject.value = `Receita nova: ${r.title}`.slice(0, 150);
    });
    nlForm.subject.addEventListener('input', () => { nlForm.subject.dataset.touched = '1'; });
    const body = (extra = {}) => ({ recipeId: nlForm.recipeId.value, subject: nlForm.subject.value, intro: nlForm.intro.value, ...extra });
    const err = $('.form-error', nlForm);
    on('[data-nl-test]', 'click', async () => {
      err.hidden = true;
      if (!nlForm.recipeId.value) { err.textContent = 'Escolha uma receita'; err.hidden = false; return; }
      try { const r = await api('/newsletter/campaigns', { method: 'POST', body: body({ test: true }) }); toast(`📧 Teste enviado para ${r.to}`, 5000); } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    });
    nlForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.hidden = true;
      const n = data?.subscribers.confirmed || 0;
      if (!confirm(`Enviar para ${n} inscrito(s) confirmado(s)? Não dá para desfazer depois que os e-mails saírem.`)) return;
      try {
        await api('/newsletter/campaigns', { method: 'POST', body: body() });
        toast('🚀 Envio iniciado! Acompanhe o progresso abaixo.', 5000);
        load();
      } catch (ex) {
        if (ex.data?.duplicate && confirm(`${ex.message}\n\nEnviar mesmo assim?`)) {
          try { await api('/newsletter/campaigns', { method: 'POST', body: body({ force: true }) }); toast('🚀 Envio iniciado!'); load(); } catch (ex2) { err.textContent = ex2.message; err.hidden = false; }
        } else if (!ex.data?.duplicate) { err.textContent = ex.message; err.hidden = false; }
      }
    });
    on('[data-nl-cancel]', 'click', async (e, b) => { if (confirm('Cancelar este envio? Quem já recebeu, recebeu.')) { await api(`/newsletter/campaigns/${b.dataset.nlCancel}/cancel`, { method: 'POST' }); load(); } });
    on('[data-nl-resume]', 'click', async (e, b) => { await api(`/newsletter/campaigns/${b.dataset.nlResume}/resume`, { method: 'POST' }); load(); });
    on('[data-nl-del]', 'click', async (e, b) => { if (confirm('Remover este inscrito da lista?')) { await api(`/subscribers/${b.dataset.nlDel}`, { method: 'DELETE' }); load(); } });
    load();
  }
})();
