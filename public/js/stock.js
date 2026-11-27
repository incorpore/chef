/* Chef — Painel → Fotos das receitas: revisão uma receita por vez + automático (Pexels / Pixabay / Unsplash) */
(() => {
  'use strict';
  const { $, $$, esc, toast, api } = window.Chef;
  const stage = $('[data-ph-stage]');
  if (!stage) return;
  const NAMES = { pexels: 'Pexels', pixabay: 'Pixabay', unsplash: 'Unsplash' };
  let mode = 'sem';
  let queue = [];
  let total = 0;
  let idx = 0;
  let loadedOffset = 0;
  let busy = false;
  let poll = null;
  let current = null; // { recipe, items, query }
  let undoTimer = null;

  // ---------------- Chaves e situação ----------------
  function paintStatus(st) {
    const P = ['pexels', 'pixabay', 'unsplash'];
    const active = (p) => st[p].configured && st[p].enabled;
    const ok = P.some(active);
    const anyKey = P.some((p) => st[p].configured);
    for (const p of P) {
      const b = $(`[data-stock-badge="${p}"]`);
      b.textContent = !st[p].configured ? 'sem chave' : !st[p].enabled ? '○ desativado' : st[p].fromEnv ? '✓ configurada (variável)' : '✓ configurada';
      b.classList.toggle('on', active(p));
      $(`[data-stock-switch-wrap="${p}"]`).hidden = !st[p].configured;
      $(`[data-stock-switch="${p}"]`).checked = st[p].enabled;
      const input = $(`[data-stock-key="${p}"] input`);
      input.placeholder = st[p].configured ? 'Chave salva — cole outra para trocar (vazio + Salvar remove)' : `Cole a chave do ${NAMES[p]}`;
      input.disabled = st[p].fromEnv;
    }
    // Atalhos: um toque liga/desliga o banco (sem abrir as chaves)
    $('[data-stock-chips]').innerHTML = P.filter((p) => st[p].configured).map((p) => `<button type="button" class="stock-chip${st[p].enabled ? ' on' : ''}" data-stock-toggle="${p}" aria-pressed="${st[p].enabled}" title="${st[p].enabled ? 'Ativo: toque para desativar' : 'Desativado: toque para ativar'}">${st[p].enabled ? '✓' : '○'} ${NAMES[p]}</button>`).join('') + P.filter((p) => !st[p].configured).map((p) => `<span class="stock-chip off">✗ ${NAMES[p]}</span>`).join('');
    $('[data-ph-keys-line]').hidden = !anyKey;
    $('[data-ph-keys-form]').hidden = anyKey && !$('[data-ph-keys]').classList.contains('editing');
    $('[data-ph-review]').hidden = !ok;
    $('[data-ph-auto]').hidden = !ok;
    $('[data-ph-count="sem"]').textContent = st.missing.toLocaleString('pt-BR');
    $('[data-ph-count="bancos"]').textContent = st.fromBanks.toLocaleString('pt-BR');
    $('[data-ph-count="bancos2"]').textContent = st.fromBanks.toLocaleString('pt-BR');
    $('[data-ph-remove-all]').hidden = !st.fromBanks;
    const j = st.job;
    const running = !!(j && j.running);
    $('[data-stock-auto]').hidden = running;
    $('[data-stock-auto]').disabled = !st.missing;
    $('[data-stock-stop]').hidden = !running;
    if (j) {
      $('[data-stock-progress]').hidden = false;
      $('[data-stock-bar]').style.width = `${j.total ? Math.round((j.done / j.total) * 100) : 100}%`;
      $('[data-stock-progress-text]').textContent = `${running ? '⏳ Buscando…' : j.stopReason ? `⏹ ${j.stopReason}` : '✅ Concluído'} ${j.done} de ${j.total} · ${j.applied} com foto · ${j.skipped} ficaram para a revisão${j.failed ? ` · ${j.failed} com erro` : ''}`;
      $('[data-stock-log]').replaceChildren(...j.log.slice().reverse().map((t) => Object.assign(document.createElement('li'), { textContent: t })));
    }
    clearTimeout(poll);
    if (running) poll = setTimeout(refresh, 3000);
    return ok;
  }
  const refresh = async () => { try { return paintStatus(await api('/fotos/status')); } catch { return false; } };

  const toggleBank = async (provider, enabled) => {
    try {
      paintStatus(await api('/fotos/bancos', { method: 'PUT', body: { provider, enabled } }));
      toast(`${NAMES[provider]} ${enabled ? 'ativado' : 'desativado'}`);
    } catch (err) { toast(`⚠️ ${err.message}`); refresh(); }
  };
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-stock-toggle]'); if (b) toggleBank(b.dataset.stockToggle, b.getAttribute('aria-pressed') !== 'true'); });
  $$('[data-stock-switch]').forEach((c) => c.addEventListener('change', () => toggleBank(c.dataset.stockSwitch, c.checked)));
  $('[data-ph-keys-edit]').addEventListener('click', () => { $('[data-ph-keys]').classList.add('editing'); $('[data-ph-keys-form]').hidden = false; });
  $$('[data-stock-key]').forEach((f) => f.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const st = await api('/fotos/chaves', { method: 'PUT', body: { provider: f.dataset.stockKey, key: f.key.value } });
      f.key.value = '';
      $('[data-ph-keys]').classList.remove('editing');
      toast('🔑 Chave salva');
      if (paintStatus(st) && !current) start();
    } catch (err) { toast(`⚠️ ${err.message}`); }
  }));

  // ---------------- Revisão: uma receita por vez ----------------
  async function fetchMore() {
    const d = await api(`/fotos/pendentes?modo=${mode}&offset=${loadedOffset}`);
    total = d.total;
    loadedOffset += d.items.length;
    queue.push(...d.items);
    return d.items.length;
  }

  function showEmpty(msg) {
    stage.hidden = true;
    const e = $('[data-ph-empty]');
    e.hidden = false;
    e.textContent = msg;
  }

  function cardFor(ph, n) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ph-opt';
    b.dataset.n = n;
    b.setAttribute('aria-label', `Usar a foto ${n}: ${ph.alt || ''} (${ph.author} / ${NAMES[ph.provider]})`);
    const img = Object.assign(document.createElement('img'), { src: ph.thumb, alt: '', loading: 'lazy', decoding: 'async' });
    if (ph.fallback) img.addEventListener('error', () => { if (img.src !== ph.fallback) img.src = ph.fallback; }, { once: true });
    const num = Object.assign(document.createElement('span'), { className: 'ph-num', textContent: n });
    const use = Object.assign(document.createElement('span'), { className: 'ph-use', textContent: 'Usar esta foto' });
    const meta = document.createElement('span');
    meta.className = 'ph-meta';
    meta.textContent = `${ph.author} · ${NAMES[ph.provider]}`;
    b.append(img, num, use, meta);
    if (ph.score >= 2) b.append(Object.assign(document.createElement('span'), { className: 'ph-match', textContent: '✓ combina', title: 'A descrição da foto cita o prato' }));
    b.addEventListener('click', () => choose(ph, b));
    return b;
  }

  async function searchFor(q) {
    const grid = $('[data-ph-grid]');
    grid.classList.add('loading');
    grid.innerHTML = '<p class="muted ph-wait">Buscando fotos…</p>';
    try {
      const r = current.recipe;
      const d = await api(`/fotos/sugestoes/${r.id}${q ? `?q=${encodeURIComponent(q)}` : ''}`);
      if (current?.recipe !== r) return; // usuário já passou para outra
      current.items = d.items;
      $('[data-ph-chip]').textContent = d.query ? `Buscando: “${d.query}”` : '';
      if (!d.items.length) { grid.innerHTML = '<p class="muted ph-wait">Nenhuma foto encontrada. Use “buscar outra coisa” com um termo mais simples, de preferência em inglês (ex.: “chicken stew”).</p>'; return; }
      grid.replaceChildren(...d.items.slice(0, 6).map((ph, i) => cardFor(ph, i + 1)));
    } catch (err) {
      grid.replaceChildren(Object.assign(document.createElement('p'), { className: 'form-error', textContent: err.message }));
    } finally { grid.classList.remove('loading'); }
  }

  async function show(i) {
    if (i >= queue.length && queue.length < total) await fetchMore();
    if (i >= queue.length) {
      showEmpty(mode === 'sem' ? (total ? '🎉 Você revisou todas as receitas desta lista.' : '🎉 Todas as receitas publicadas já têm foto.') : 'Nenhuma foto dos bancos para conferir.');
      return;
    }
    idx = Math.max(0, i);
    const r = queue[idx];
    current = { recipe: r, items: [] };
    stage.hidden = false;
    $('[data-ph-empty]').hidden = true;
    $('[data-ph-pos]').textContent = `${idx + 1} de ${total.toLocaleString('pt-BR')}`;
    $('[data-ph-bar]').style.width = `${total ? Math.round(((idx + 1) / total) * 100) : 0}%`;
    const t = $('[data-ph-title]');
    t.replaceChildren(Object.assign(document.createElement('a'), { href: `/admin/receitas/${r.id}`, target: '_blank', textContent: r.title, title: 'Abrir no editor' }));
    $('[data-ph-desc]').textContent = r.description || '';
    const cur = $('[data-ph-current]');
    cur.hidden = !r.cover;
    if (r.cover) {
      $('[data-ph-current-img]').src = window.Chef.img(r.cover, 320);
      $('[data-ph-current-credit]').textContent = r.cover_credit || '';
    }
    $('[data-ph-q]').hidden = true;
    $('[data-ph-q-open]').hidden = false;
    $('[data-ph-q]').q.value = '';
    $('[data-ph-prev]').disabled = idx === 0;
    $('[data-ph-skip]').innerHTML = mode === 'bancos' ? '<span class="lg-only">Manter a atual · </span>próxima →' : '<span class="lg-only">Nenhuma combina · </span>pular →';
    searchFor('');
  }

  function offerUndo(text, fn) {
    clearTimeout(undoTimer);
    const bar = $('[data-ph-undo]');
    $('[data-ph-undo-text]').textContent = text;
    bar.hidden = false;
    const btn = $('[data-ph-undo-btn]');
    btn.onclick = async () => { bar.hidden = true; await fn(); };
    undoTimer = setTimeout(() => { bar.hidden = true; }, 8000);
  }

  async function choose(ph, btn) {
    if (busy || !current) return;
    busy = true;
    const r = current.recipe;
    const before = { cover: r.cover || '', cover_credit: r.cover_credit || '' };
    $$('.ph-opt', stage).forEach((x) => { x.disabled = true; });
    btn.classList.add('chosen');
    try {
      const saved = await api('/fotos/aplicar', { method: 'POST', body: { recipeId: r.id, photo: ph } });
      offerUndo(`✅ Foto aplicada em “${r.title}”.`, async () => {
        await api(`/recipes/${r.id}`, { method: 'PATCH', body: { cover: before.cover, cover_credit: before.cover_credit } });
        toast('Desfeito');
        refresh();
      });
      Object.assign(r, { cover: saved.cover, cover_credit: saved.cover_credit });
      refresh();
      setTimeout(() => { busy = false; show(idx + 1); }, 450);
    } catch (err) {
      busy = false;
      toast(`⚠️ ${err.message}`, 6000);
      btn.classList.remove('chosen');
      $$('.ph-opt', stage).forEach((x) => { x.disabled = false; });
    }
  }

  $('[data-ph-skip]').addEventListener('click', () => show(idx + 1));
  $('[data-ph-prev]').addEventListener('click', () => show(idx - 1));
  $('[data-ph-q-open]').addEventListener('click', (e) => { e.target.hidden = true; const f = $('[data-ph-q]'); f.hidden = false; f.q.focus(); });
  $('[data-ph-q]').addEventListener('submit', (e) => { e.preventDefault(); const q = e.target.q.value.trim(); if (q) searchFor(q); });
  $('[data-ph-remove]').addEventListener('click', async () => {
    const r = current?.recipe;
    if (!r || !confirm(`Remover a foto de “${r.title}”? Ela volta para a capa ilustrada.`)) return;
    const before = { cover: r.cover, cover_credit: r.cover_credit };
    await api(`/recipes/${r.id}`, { method: 'PATCH', body: { cover: '' } });
    offerUndo(`Foto removida de “${r.title}”.`, async () => { await api(`/recipes/${r.id}`, { method: 'PATCH', body: before }); refresh(); });
    refresh();
    show(idx + 1);
  });
  // Atalhos: 1–6 escolhe, → pula, ← volta (fora de campos de texto)
  document.addEventListener('keydown', (e) => {
    if (stage.hidden || e.target.closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^[1-6]$/.test(e.key)) { const b = $(`.ph-opt[data-n="${e.key}"]`, stage); if (b && !b.disabled) { e.preventDefault(); b.click(); } }
    if (e.key === 'ArrowRight') { e.preventDefault(); show(idx + 1); }
    if (e.key === 'ArrowLeft' && idx > 0) { e.preventDefault(); show(idx - 1); }
  });

  async function start() {
    queue = []; idx = 0; loadedOffset = 0; current = null;
    $$('[data-ph-mode]').forEach((b) => { const on = b.dataset.phMode === mode; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    await fetchMore();
    show(0);
  }
  $$('[data-ph-mode]').forEach((b) => b.addEventListener('click', () => { if (mode !== b.dataset.phMode) { mode = b.dataset.phMode; start(); } }));

  // ---------------- Automático e limpeza ----------------
  $('[data-stock-auto]').addEventListener('click', async () => {
    if (!confirm('Buscar fotos para as receitas sem foto? Só entram as fotos que a descrição confirma o prato; as outras ficam para você escolher.')) return;
    try { paintStatus(await api('/fotos/auto', { method: 'POST' })); toast('⏳ Busca automática iniciada'); } catch (err) { toast(`⚠️ ${err.message}`); }
  });
  $('[data-stock-stop]').addEventListener('click', async () => paintStatus(await api('/fotos/auto/parar', { method: 'POST' })));
  $('[data-ph-remove-all]').addEventListener('click', async () => {
    const n = $('[data-ph-count="bancos2"]').textContent;
    if (!confirm(`Remover as fotos dos bancos (Pexels, Pixabay e Unsplash) de ${n} receitas? Elas voltam para a capa ilustrada. Fotos enviadas por você não são afetadas.`)) return;
    const r = await api('/fotos/remover-bancos', { method: 'POST' });
    toast(`🗑️ ${r.removed} fotos removidas`);
    paintStatus(r);
    start();
  });

  refresh().then((ok) => { if (ok) start(); });
})();
