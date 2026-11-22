/* Chef — Painel → Afiliados: colar link → conferir → salvar; Shopee; automático; utensílios */
(() => {
  'use strict';
  const { $, $$, esc, toast, api } = window.Chef;
  const paste = $('[data-aff-paste]');
  if (!paste) return;
  const STORE = { amazon: 'Amazon', shopee: 'Shopee', mercadolivre: 'Mercado Livre', outra: 'Loja' };
  const preview = $('[data-aff-preview]');
  const form = $('[data-aff-form]');
  const listEl = $('[data-aff-list]');
  let items = [];
  let filter = '';
  const selected = new Set();
  let utensilLabels = {};

  // ---------------- colar link → prévia ----------------
  const showPreview = (d) => {
    form.reset();
    for (const k of ['id', 'store', 'external_id', 'source_url', 'aff_url', 'asin', 'price_value', 'title', 'price', 'badge', 'image', 'url', 'keywords', 'description']) {
      if (form[k]) form[k].value = d[k] ?? '';
    }
    if (form.utensil) form.utensil.value = d.utensil || '';
    form.cozinha.checked = d.category === 'cozinha';
    $('[data-aff-img]').src = d.image || '/icons/icon.svg';
    const st = $('[data-aff-store]');
    st.textContent = STORE[d.store] || 'Loja';
    st.dataset.store = d.store || '';
    const w = $('[data-aff-warn]');
    w.innerHTML = (d.warn || []).map((x) => `<li>${esc(x)}</li>`).join('');
    w.hidden = !(d.warn || []).length;
    $('[data-aff-save]').textContent = d.id ? 'Salvar alterações' : 'Salvar produto';
    preview.hidden = false;
    preview.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    form.title.focus({ preventScroll: true });
  };
  form.image.addEventListener('change', () => { $('[data-aff-img]').src = form.image.value || '/icons/icon.svg'; });

  paste.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button', paste);
    btn.disabled = true;
    btn.textContent = 'Buscando…';
    try {
      const d = await api('/products/preview', { method: 'POST', body: { url: paste.url.value.trim() } });
      if (d.duplicate) {
        toast(`ℹ️ Já cadastrado: ${d.duplicate.title}`, 5000);
        const p = items.find((i) => i.id === d.duplicate.id);
        if (p) return edit(p);
      }
      showPreview({ store: d.store, external_id: d.externalId, source_url: d.source, aff_url: d.affUrl, asin: d.asin || '', price_value: d.priceValue ?? '', title: d.title, price: d.price, image: d.image, url: d.url, utensil: d.utensil, warn: d.warn });
    } catch (err) { toast(`⚠️ ${err.message}`, 6000); } finally {
      btn.disabled = false;
      btn.textContent = 'Buscar dados';
    }
  });

  const hide = () => { preview.hidden = true; form.reset(); paste.reset(); };
  $('[data-aff-cancel]').addEventListener('click', hide);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(form));
    b.category = form.cozinha.checked ? 'cozinha' : '';
    delete b.cozinha;
    const id = b.id;
    delete b.id;
    try {
      await api(id ? `/products/${id}` : '/products', { method: id ? 'PUT' : 'POST', body: b });
      toast('✅ Produto salvo');
      hide();
      load();
    } catch (err) { toast(`⚠️ ${err.message}`, 6000); }
  });

  const edit = (p) => showPreview({ ...p, warn: p.refresh_error ? [`Última atualização falhou: ${p.refresh_error}`] : [] });

  // ---------------- lista ----------------
  const ago = (s) => {
    if (!s) return 'nunca atualizado';
    const min = Math.round((Date.now() - new Date(`${s.replace(' ', 'T')}Z`).getTime()) / 60000);
    if (min < 2) return 'atualizado agora';
    if (min < 60) return `atualizado há ${min} min`;
    if (min < 48 * 60) return `atualizado há ${Math.round(min / 60)} h`;
    return `atualizado há ${Math.round(min / 1440)} dias`;
  };
  const visible = () => {
    const q = ($('[data-aff-q]').value || '').toLowerCase();
    return items.filter((p) => (!filter || (filter === 'erro' ? p.refresh_error : (p.store || 'amazon') === filter)) && (!q || `${p.title} ${p.utensil} ${p.keywords}`.toLowerCase().includes(q)));
  };
  const render = () => {
    const list = visible();
    listEl.innerHTML = list.map((p) => `
      <article class="aff-item${p.active ? '' : ' off'}" data-id="${p.id}">
        <label class="aff-sel"><input type="checkbox" data-aff-check="${p.id}"${selected.has(p.id) ? ' checked' : ''} aria-label="Selecionar ${esc(p.title)}"></label>
        ${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy">` : '<div class="product-ph">🛒</div>'}
        <div class="aff-body">
          <div class="aff-tags"><span class="aff-store" data-store="${esc(p.store || 'amazon')}">${STORE[p.store || 'amazon']}</span>${p.utensil ? `<span class="aff-tag">Utensílio: ${esc(utensilLabels[p.utensil.split(':')[0]] || p.utensil)}${p.utensil.includes(':') ? ` ${esc(p.utensil.split(':')[1])} cm` : ''}</span>` : ''}${p.category === 'cozinha' ? '<span class="aff-tag">Cozinha</span>' : ''}${p.auto ? '<span class="aff-tag">automático</span>' : ''}${p.active ? '' : '<span class="aff-tag warn">desativado</span>'}${p.available === 0 ? '<span class="aff-tag warn">indisponível</span>' : ''}</div>
          <strong>${esc(p.title)}</strong>
          <small>${p.price ? `${esc(p.price)} · ` : ''}${p.clicks} cliques · ${p.source_url || p.asin ? ago(p.refreshed_at) : 'cadastro manual'}${p.refresh_error ? ` · <span class="warn" title="${esc(p.refresh_error)}">erro ao atualizar</span>` : ''}${(p.store || 'amazon') !== 'amazon' && !p.aff_url ? ' · <span class="warn">sem link de afiliado</span>' : ''}</small>
          <div class="row-actions"><a href="/go/${p.id}" target="_blank" rel="noopener">abrir link</a> <button class="link" data-aff-edit="${p.id}">editar</button>${p.source_url || p.asin ? ` <button class="link" data-aff-refresh="${p.id}">atualizar agora</button>` : ''} <button class="link danger" data-aff-del="${p.id}">remover</button></div>
        </div>
      </article>`).join('') || `<p class="empty">${items.length ? 'Nenhum produto neste filtro' : 'Nenhum produto ainda. Cole um link acima para começar.'}</p>`;
    paintBulk();
  };
  const load = async () => {
    const r = await api('/products');
    items = r.items;
    for (const id of [...selected]) if (!items.some((p) => p.id === id)) selected.delete(id);
    render();
  };
  const paintBulk = () => {
    $('[data-aff-bulk]').hidden = !selected.size;
    $('[data-aff-sel]').textContent = selected.size;
  };

  $('[data-aff-filters]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-store]');
    if (!b) return;
    filter = b.dataset.store;
    $$('[data-store]', e.currentTarget).forEach((x) => x.classList.toggle('on', x === b));
    render();
  });
  $('[data-aff-q]').addEventListener('input', render);

  listEl.addEventListener('change', (e) => {
    const c = e.target.closest('[data-aff-check]');
    if (!c) return;
    const id = Number(c.dataset.affCheck);
    if (c.checked) selected.add(id); else selected.delete(id);
    paintBulk();
  });
  listEl.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.affEdit) edit(items.find((p) => String(p.id) === t.dataset.affEdit));
    if (t.dataset.affDel && confirm('Remover este produto?')) {
      await api(`/products/${t.dataset.affDel}`, { method: 'DELETE' }).catch((err) => toast(`⚠️ ${err.message}`));
      load();
    }
    if (t.dataset.affRefresh) {
      t.disabled = true;
      t.textContent = 'atualizando…';
      try {
        const p = await api(`/products/${t.dataset.affRefresh}/refresh`, { method: 'POST' });
        toast(p.refresh_error ? `⚠️ ${p.refresh_error}` : '✅ Atualizado', p.refresh_error ? 6000 : 2600);
      } catch (err) { toast(`⚠️ ${err.message}`); }
      load();
    }
  });
  $('[data-aff-bulk]').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-aff-bulk-do]');
    if (!b) return;
    const action = b.dataset.affBulkDo;
    if (action === 'delete' && !confirm(`Excluir ${selected.size} produto(s)?`)) return;
    try {
      const r = await api('/products/bulk', { method: 'POST', body: { ids: [...selected], action } });
      toast(`✅ ${r.count} produto(s)`);
      if (action === 'delete') selected.clear();
      load();
    } catch (err) { toast(`⚠️ ${err.message}`); }
  });

  // ---------------- Shopee + automático + utensílios ----------------
  const sf = $('[data-shopee-form]');
  const result = $('[data-shopee-result]');
  const paintShopee = (st) => {
    const badge = $('[data-shopee-badge]');
    badge.textContent = st.configured ? `conectada · ${st.appId}` : 'não configurada';
    badge.classList.toggle('on', st.configured);
    $('[data-shopee-remove]').hidden = !st.configured || st.fromEnv;
    sf.appId.placeholder = st.configured ? 'já salvo (digite para trocar)' : 'Ex.: 18312345678';
    sf.secret.placeholder = st.configured ? '••••••••' : '';
    if (st.fromEnv) { sf.appId.disabled = true; sf.secret.disabled = true; result.textContent = 'Credenciais vindas das variáveis de ambiente do servidor.'; }
    $('[data-aff-fill]').disabled = !st.configured;
  };
  sf.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      paintShopee(await api('/affiliates/shopee', { method: 'PUT', body: { appId: sf.appId.value, secret: sf.secret.value } }));
      sf.reset();
      toast('✅ Shopee salva. Testando…');
      test();
    } catch (err) { toast(`⚠️ ${err.message}`, 6000); }
  });
  const test = async () => {
    result.textContent = 'Testando conexão…';
    try {
      const r = await api('/affiliates/shopee/test', { method: 'POST' });
      result.textContent = `✅ Conectado. Exemplo encontrado: ${r.sample}`;
    } catch (err) { result.textContent = `⚠️ ${err.message}`; }
  };
  $('[data-shopee-test]').addEventListener('click', test);
  $('[data-shopee-remove]').addEventListener('click', async () => {
    if (!confirm('Remover as credenciais da Shopee?')) return;
    paintShopee(await api('/affiliates/shopee', { method: 'PUT', body: { appId: '', secret: '' } }));
    result.textContent = '';
  });

  const af = $('[data-aff-auto-form]');
  af.addEventListener('change', async () => {
    try {
      await api('/affiliates/settings', { method: 'PUT', body: { productAutoRefresh: af.productAutoRefresh.checked, utensilsAuto: af.utensilsAuto.checked, cookModeProducts: af.cookModeProducts.checked, productRefreshHours: Number(af.productRefreshHours.value) } });
      toast('✅ Salvo');
    } catch (err) { toast(`⚠️ ${err.message}`); }
  });

  const paintCoverage = (c) => {
    $('[data-aff-cov-sum]').textContent = c.total
      ? `${c.covered} de ${c.total} utensílios citados nas receitas já têm produto · ${c.cozinha} produto(s) na vitrine geral de cozinha (usada quando a receita não cita utensílio).`
      : 'Nenhum utensílio encontrado nas receitas publicadas ainda.';
    $('[data-aff-cov-list]').innerHTML = c.items.map((x) => `<span class="aff-chip${x.covered ? ' on' : ''}" title="${x.recipes} receita(s)">${x.covered ? '✓' : '○'} ${esc(x.label)} <b>${x.recipes}</b></span>`).join('');
  };
  const status = async () => {
    const st = await api('/affiliates/status');
    utensilLabels = Object.fromEntries(st.utensils.map((x) => [x.key, x.label]));
    paintShopee(st.shopee);
    af.productAutoRefresh.checked = !!st.productAutoRefresh;
    af.utensilsAuto.checked = !!st.utensilsAuto;
    af.cookModeProducts.checked = !!st.cookModeProducts;
    const h = String(st.productRefreshHours);
    if (![...af.productRefreshHours.options].some((o) => o.value === h)) af.productRefreshHours.add(new Option(`${h} horas`, h));
    af.productRefreshHours.value = h;
    paintCoverage(st.coverage);
    render();
  };
  $('[data-aff-fill]').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    b.textContent = 'Buscando…';
    try {
      const r = await api('/affiliates/utensils/fill', { method: 'POST' });
      toast(r.added.length ? `✅ ${r.added.length} produto(s) adicionados${r.remaining ? ` · faltam ${r.remaining}` : ''}` : 'Nada novo encontrado agora', 5000);
      await Promise.all([load(), status()]);
    } catch (err) { toast(`⚠️ ${err.message}`, 6000); } finally {
      b.disabled = false;
      b.textContent = 'Buscar produtos agora';
    }
  });

  load();
  status().catch((err) => toast(`⚠️ ${err.message}`));
})();
