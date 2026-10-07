/* Chef — painel administrativo */
(() => {
  'use strict';
  const { $, $$, esc, toast, api } = window.Chef;
  const on = (sel, ev, fn) => document.addEventListener(ev, (e) => { const t = e.target.closest(sel); if (t) fn(e, t); });
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
  on('[data-logout]', 'click', async () => { await api('/auth/logout', { method: 'POST' }); clearOffline(); location.href = '/'; });
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
      $('[data-top]').innerHTML = s.top.map((r) => `<li><a href="/admin/receitas/${r.id}">${esc(r.title)}</a> <small>${r.views} views · #${esc(r.code)}</small></li>`).join('') || '<li>—</li>';
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
      rows.innerHTML = res.items.map((r) => `<tr><td>${r.cover ? `<img class="thumb" src="${esc(r.cover)}" alt="">` : ''}</td><td><a href="/admin/receitas/${r.id}"><strong>${esc(r.title)}</strong></a><br><small>${esc(r.category?.name || '')}</small></td><td><code>#${esc(r.code)}</code></td><td><span class="status status-${r.status}">${r.status === 'published' ? 'Publicada' : 'Rascunho'}</span></td><td>${r.views}</td><td class="row-actions"><a href="/receita/${esc(r.slug)}" target="_blank">ver</a> <a href="/admin/receitas/${r.id}">editar</a></td></tr>`).join('') || '<tr><td colspan="6" class="empty">Nenhuma receita</td></tr>';
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
        const r = await api(id ? `/recipes/${id}` : '/recipes', { method: id ? 'PUT' : 'POST', body: collect() });
        dirty = false;
        toast('✅ Receita salva');
        if (!id) location.href = `/admin/receitas/${r.id}`;
        else $('.admin-head h1 .code-chip') && ($('.admin-head h1 .code-chip').textContent = `#${r.code}`);
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
        await api(id ? `${path}/${id}` : path, { method: id ? 'PUT' : 'POST', body });
        f.reset();
        if (f.id) f.id.value = '';
        toast('✅ Salvo');
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
    row: (u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${u.role === 'admin' ? 'Administrador' : 'Autor'}</td><td class="row-actions"><button class="link" data-del="${u.id}">remover</button></td></tr>`,
  });

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
    on('[data-copy-key]', 'click', async (e, b) => { await navigator.clipboard.writeText(b.dataset.copyKey); toast('Copiada'); });
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
  const acc = $('[data-account]');
  acc?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(acc));
    if (!body.password) { delete body.password; delete body.currentPassword; }
    try { await api('/auth/me', { method: 'PUT', body }); toast('✅ Conta atualizada'); acc.password.value = ''; acc.currentPassword.value = ''; } catch (err) { toast(err.message); }
  });
})();
