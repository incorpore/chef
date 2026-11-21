/* Chef — Painel → Fotos automáticas (Pexels / Pixabay) */
(() => {
  'use strict';
  const { $, $$, esc, toast, api } = window.Chef;
  const list = $('[data-stock-list]');
  if (!list) return;
  let offset = 0;
  let configured = false;
  let poll = null;

  function paintStatus(st) {
    for (const p of ['pexels', 'pixabay']) {
      const b = $(`[data-stock-badge="${p}"]`);
      b.textContent = st[p].configured ? (st[p].fromEnv ? '✓ configurada (variável)' : '✓ configurada') : 'sem chave';
      b.classList.toggle('on', st[p].configured);
      const f = $(`[data-stock-key="${p}"]`);
      f.querySelector('input').placeholder = st[p].configured ? 'Chave salva — cole outra para trocar (vazio + Salvar remove)' : `Cole a chave do ${p === 'pexels' ? 'Pexels' : 'Pixabay'}`;
      f.querySelector('input').disabled = st[p].fromEnv;
    }
    configured = st.pexels.configured || st.pixabay.configured;
    $('[data-stock-missing]').textContent = st.missing.toLocaleString('pt-BR');
    const j = st.job;
    const running = !!(j && j.running);
    $('[data-stock-auto]').hidden = running;
    $('[data-stock-auto]').disabled = !configured || !st.missing;
    $('[data-stock-stop]').hidden = !running;
    if (j) {
      $('[data-stock-progress]').hidden = false;
      $('[data-stock-bar]').style.width = `${j.total ? Math.round((j.done / j.total) * 100) : 100}%`;
      $('[data-stock-progress-text]').textContent = `${running ? '⏳ Buscando…' : j.stopReason ? `⏹ ${j.stopReason}` : '✅ Concluído'} ${j.done} de ${j.total} · ${j.applied} com foto · ${j.skipped} sem resultado${j.failed ? ` · ${j.failed} com erro` : ''}`;
      const log = $('[data-stock-log]');
      log.replaceChildren(...j.log.slice().reverse().map((t) => Object.assign(document.createElement('li'), { textContent: t })));
    }
    clearTimeout(poll);
    if (running) poll = setTimeout(refresh, 3000);
  }
  async function refresh() { try { paintStatus(await api('/fotos/status')); } catch { /* tenta de novo no próximo ciclo */ } }

  // Chaves
  $$('[data-stock-key]').forEach((f) => f.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const st = await api('/fotos/chaves', { method: 'PUT', body: { provider: f.dataset.stockKey, key: f.key.value } });
      f.key.value = '';
      toast('🔑 Chave salva');
      paintStatus(st);
      if (configured && !list.querySelector('.stock-card')) { offset = 0; loadMore(); }
    } catch (err) { toast(`⚠️ ${err.message}`); }
  }));

  // Automático
  $('[data-stock-auto]').addEventListener('click', async () => {
    const n = $('[data-stock-missing]').textContent;
    if (!confirm(`Colocar automaticamente a primeira foto encontrada em ${n} receitas? Você pode trocar qualquer uma depois.`)) return;
    try { paintStatus(await api('/fotos/auto', { method: 'POST' })); toast('⏳ Busca automática iniciada'); } catch (err) { toast(`⚠️ ${err.message}`); }
  });
  $('[data-stock-stop]').addEventListener('click', async () => paintStatus(await api('/fotos/auto/parar', { method: 'POST' })));

  // Revisão: um cartão por receita, com as opções de foto
  const NAMES = { pexels: 'Pexels', pixabay: 'Pixabay' };
  function card(r) {
    const el = document.createElement('article');
    el.className = 'stock-card';
    el.innerHTML = `<div class="stock-card-head"><a href="/admin/receitas/${r.id}" target="_blank"><strong></strong></a>
      <form class="stock-q"><input name="q" aria-label="Termo de busca"><button class="btn btn-sm">Buscar</button></form>
      <button type="button" class="link" data-skip>Pular</button></div>
      <div class="stock-grid"><p class="muted">Buscando…</p></div>`;
    $('strong', el).textContent = r.title;
    el.querySelector('[name=q]').value = r.title;
    const grid = $('.stock-grid', el);
    const searchFor = async (q) => {
      grid.innerHTML = '<p class="muted">Buscando…</p>';
      try {
        const d = await api(`/fotos/sugestoes/${r.id}?q=${encodeURIComponent(q || '')}`);
        if (!d.items.length) { grid.innerHTML = '<p class="muted">Nenhuma foto encontrada. Tente um termo mais simples (ex.: só "bolo de cenoura").</p>'; return; }
        grid.replaceChildren(...d.items.map((ph) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'stock-opt';
          b.title = `Usar esta foto (${ph.author} / ${NAMES[ph.provider]})`;
          const img = Object.assign(document.createElement('img'), { src: ph.thumb, alt: ph.alt || r.title, loading: 'lazy' });
          const cap = document.createElement('span');
          cap.textContent = `${ph.author} · ${NAMES[ph.provider]}`;
          b.append(img, cap);
          b.addEventListener('click', async () => {
            $$('.stock-opt', grid).forEach((x) => { x.disabled = true; });
            b.classList.add('busy');
            try {
              const saved = await api('/fotos/aplicar', { method: 'POST', body: { recipeId: r.id, photo: ph } });
              el.classList.add('done');
              el.innerHTML = `<div class="stock-done"><img alt=""><div><strong></strong><small></small><span class="stock-done-actions"><a href="/receita/${encodeURIComponent(saved.slug)}" target="_blank">ver receita</a><button type="button" class="link" data-undo>desfazer</button></span></div></div>`;
              $('img', el).src = window.Chef.img(saved.cover, 320);
              $('strong', el).textContent = `✅ ${saved.title}`;
              $('small', el).textContent = saved.cover_credit;
              $('[data-undo]', el).addEventListener('click', async () => {
                await api(`/recipes/${r.id}`, { method: 'PATCH', body: { cover: '' } });
                toast('Foto removida');
                el.replaceWith(card(r));
                refresh();
              });
              refresh();
            } catch (err) {
              toast(`⚠️ ${err.message}`);
              $$('.stock-opt', grid).forEach((x) => { x.disabled = false; });
              b.classList.remove('busy');
            }
          });
          return b;
        }));
      } catch (err) { grid.innerHTML = ''; grid.append(Object.assign(document.createElement('p'), { className: 'form-error', textContent: err.message })); }
    };
    $('.stock-q', el).addEventListener('submit', (e) => { e.preventDefault(); searchFor(e.target.q.value); });
    $('[data-skip]', el).addEventListener('click', () => el.remove());
    // busca quando o cartão aparece na tela (economiza consultas)
    const io = new IntersectionObserver((ents) => { if (ents.some((x) => x.isIntersecting)) { io.disconnect(); searchFor(r.title); } }, { rootMargin: '200px' });
    io.observe(el);
    return el;
  }

  async function loadMore() {
    if (!configured) { list.innerHTML = '<p class="muted">Salve pelo menos uma chave acima para ver as sugestões.</p>'; return; }
    if (offset === 0) list.innerHTML = '';
    const d = await api(`/fotos/pendentes?offset=${offset}`);
    offset += d.items.length;
    if (!d.items.length && !list.children.length) list.innerHTML = '<p class="muted">🎉 Todas as receitas publicadas já têm foto.</p>';
    d.items.forEach((r) => list.append(card(r)));
    $('[data-stock-more]').hidden = offset >= d.total || !d.items.length;
  }
  $('[data-stock-more]').addEventListener('click', loadMore);

  refresh().then(loadMore);
})();
