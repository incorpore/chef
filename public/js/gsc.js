/* Chef — Painel → Google Search: relatório do Search Console */
(() => {
  'use strict';
  const { $, $$, esc, toast, api } = window.Chef;
  const root = $('[data-gsc-report]');
  if (!root) return;

  const nf = (n, d = 0) => Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: d });
  const pct = (n) => `${nf((n || 0) * 100, 1)}%`;
  const pos = (n) => (n ? nf(n, 1) : '—');
  const dfmt = (s, long) => new Date(`${s}T12:00:00`).toLocaleDateString('pt-BR', long ? { day: '2-digit', month: 'long', year: 'numeric' } : { day: '2-digit', month: 'short' }).replace('.', '');
  const METRICS = {
    clicks: { label: 'Cliques', fmt: (v) => nf(v), note: '' },
    impressions: { label: 'Impressões', fmt: (v) => nf(v), note: 'vezes que o site apareceu nos resultados' },
    ctr: { label: 'CTR', fmt: pct, note: 'cliques ÷ impressões' },
    position: { label: 'Posição média', fmt: pos, note: 'quanto menor, melhor (1 = primeiro resultado)', invert: true },
  };
  let metric = 'clicks';
  let data = null;

  const show = (sel, on) => { const el = $(sel); if (el) el.hidden = !on; };
  const err = (msg) => { const e = $('[data-gsc-error]'); e.textContent = msg || ''; e.hidden = !msg; };

  // ---------- Configuração (chave da conta de serviço) ----------
  async function sendKey(text) {
    try {
      const r = await api('/gsc/key', { method: 'POST', body: { key: text } });
      toast('🔑 Chave salva');
      await init(r.email);
    } catch (e) { toast(`⚠️ ${e.message}`, 6000); }
  }
  $('[data-gsc-file]').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    if (f.size > 20000) return toast('Arquivo grande demais para ser a chave da conta de serviço');
    sendKey(await f.text());
  });
  $('[data-gsc-paste-save]').addEventListener('click', () => sendKey($('[data-gsc-paste]').value));
  $('[data-gsc-copy-email]').addEventListener('click', async () => { if (await window.Chef.copyText($('[data-gsc-email]').textContent)) toast('📋 E-mail copiado'); });
  $('[data-gsc-remove]').addEventListener('click', async () => {
    if (!confirm('Remover a chave do Google? O relatório deixa de aparecer até você enviar outra.')) return;
    await api('/gsc/key', { method: 'DELETE' });
    location.reload();
  });

  // ---------- Relatório ----------
  function kpis() {
    const t = data.totals; const p = data.previous;
    $('[data-gsc-kpis]').innerHTML = Object.entries(METRICS).map(([k, m]) => {
      const cur = t[k]; const prev = p[k];
      let delta = '';
      if (prev) {
        const ch = k === 'position' ? prev - cur : (cur - prev) / prev; // posição: cair o número é melhorar
        const shown = k === 'position' ? Math.round(Math.abs(ch) * 10) : Math.round(Math.abs(ch) * 100); // o que aparece na tela
        const good = ch > 0 && shown > 0; const bad = ch < 0 && shown > 0;
        const txt = k === 'position' ? `${nf(Math.abs(prev - cur), 1)} ${good ? 'melhor' : bad ? 'pior' : ''}` : `${nf(Math.abs(ch) * 100, 0)}%`;
        delta = `<span class="gsc-delta ${good ? 'up' : bad ? 'down' : ''}">${good ? '▲' : bad ? '▼' : '='} ${good || bad ? txt : 'igual'}</span>`;
      }
      return `<button type="button" role="radio" class="gsc-kpi${k === metric ? ' on' : ''}" aria-checked="${k === metric}" data-metric="${k}"><span class="gsc-kpi-l">${m.label}</span><strong>${m.fmt(cur)}</strong>${delta}<small>vs. ${data.days} dias anteriores</small></button>`;
    }).join('');
  }

  function chart() {
    const m = METRICS[metric];
    $('[data-gsc-chart-title]').textContent = `${m.label} por dia`;
    $('[data-gsc-chart-note]').textContent = m.note;
    const box = $('[data-gsc-chart]');
    const pts = data.daily;
    if (!pts.length) { box.innerHTML = '<p class="empty">Ainda não há dados neste período. O Google leva alguns dias para mostrar os números de um site novo.</p>'; return; }
    const W = Math.max(320, box.clientWidth || 640); const H = 240;
    const pad = { l: 46, r: 14, t: 14, b: 28 };
    const vals = pts.map((d) => d[metric]);
    let lo = Math.min(...vals); let hi = Math.max(...vals);
    if (metric !== 'position') lo = 0;
    if (hi === lo) hi = lo + 1;
    const span = hi - lo; hi += span * 0.08; if (metric === 'position') lo = Math.max(0, lo - span * 0.08);
    const x = (i) => pad.l + (pts.length === 1 ? (W - pad.l - pad.r) / 2 : (i * (W - pad.l - pad.r)) / (pts.length - 1));
    const y = (v) => (m.invert ? pad.t + ((v - lo) / (hi - lo)) * (H - pad.t - pad.b) : H - pad.b - ((v - lo) / (hi - lo)) * (H - pad.t - pad.b));
    const ticks = [0, 1, 2, 3].map((i) => lo + ((hi - lo) * i) / 3);
    const every = Math.max(1, Math.ceil(pts.length / Math.max(2, Math.floor((W - pad.l) / 90))));
    const line = pts.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[metric]).toFixed(1)}`).join('');
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="${esc(m.label)} por dia, ${esc(dfmt(pts[0].date))} a ${esc(dfmt(pts[pts.length - 1].date))}" tabindex="0">
      <g class="gsc-grid">${ticks.map((t) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/><text x="${pad.l - 8}" y="${(y(t) + 4).toFixed(1)}" text-anchor="end">${esc(metric === 'ctr' ? pct(t) : metric === 'position' ? nf(t, 1) : nf(t))}</text>`).join('')}</g>
      <g class="gsc-xlab">${pts.map((d, i) => (i % every === 0 ? `<text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="${i === 0 ? 'start' : i > pts.length - every ? 'end' : 'middle'}">${esc(dfmt(d.date))}</text>` : '')).join('')}</g>
      <path class="gsc-line" d="${line}"/>
      <line class="gsc-cross" y1="${pad.t}" y2="${H - pad.b}" visibility="hidden"/>
      <circle class="gsc-dot" r="5" visibility="hidden"/>
      <rect class="gsc-hit" x="${pad.l - 10}" y="0" width="${W - pad.l - pad.r + 20}" height="${H}" fill="transparent"/>
    </svg><div class="gsc-tip" role="status" hidden></div>`;
    const svg = $('svg', box); const tip = $('.gsc-tip', box); const cross = $('.gsc-cross', box); const dot = $('.gsc-dot', box);
    let idx = -1;
    const place = (i) => {
      idx = Math.max(0, Math.min(pts.length - 1, i));
      const d = pts[idx]; const cx = x(idx); const cy = y(d[metric]);
      cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible');
      dot.setAttribute('cx', cx); dot.setAttribute('cy', cy); dot.setAttribute('visibility', 'visible');
      tip.replaceChildren();
      const strong = document.createElement('strong'); strong.textContent = m.fmt(d[metric]);
      const lab = document.createElement('span'); lab.textContent = ` ${m.label.toLowerCase()}`;
      const date = document.createElement('small'); date.textContent = dfmt(d.date, true);
      const extra = document.createElement('small'); extra.textContent = metric === 'clicks' ? `${nf(d.impressions)} impressões` : metric === 'impressions' ? `${nf(d.clicks)} cliques` : `${nf(d.clicks)} cliques · ${nf(d.impressions)} impressões`;
      tip.append(date, strong, lab, extra);
      tip.hidden = false;
      const scale = box.clientWidth / W;
      tip.style.left = `${Math.min(box.clientWidth - tip.offsetWidth - 4, Math.max(4, cx * scale - tip.offsetWidth / 2))}px`;
      tip.style.top = `${Math.max(0, cy - 70)}px`;
    };
    const hide = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); };
    svg.addEventListener('pointermove', (e) => {
      const r = svg.getBoundingClientRect(); const px = ((e.clientX - r.left) / r.width) * W;
      place(Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (pts.length - 1)));
    });
    svg.addEventListener('pointerleave', hide);
    svg.addEventListener('blur', hide);
    svg.addEventListener('focus', () => place(idx < 0 ? pts.length - 1 : idx));
    svg.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); place((idx < 0 ? pts.length - 1 : idx) + (e.key === 'ArrowRight' ? 1 : -1)); }
      if (e.key === 'Escape') hide();
    });
    // Tabela (mesmos números, sem depender do mouse)
    $('[data-gsc-daily]').innerHTML = `<table class="table"><thead><tr><th>Dia</th><th>Cliques</th><th>Impressões</th><th>CTR</th><th>Posição</th></tr></thead><tbody>${pts.slice().reverse().map((d) => `<tr><td>${esc(dfmt(d.date, true))}</td><td>${nf(d.clicks)}</td><td>${nf(d.impressions)}</td><td>${pct(d.ctr)}</td><td>${pos(d.position)}</td></tr>`).join('')}</tbody></table>`;
  }

  const table = (rows, first, cell) => (rows.length ? `<div class="table-wrap"><table class="table gsc-table"><thead><tr><th>${first}</th><th>Cliques</th><th>Impr.</th><th>Posição</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${cell(r)}</td><td>${nf(r.clicks)}</td><td>${nf(r.impressions)}</td><td>${pos(r.position)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">Sem dados neste período.</p>');

  function lists() {
    $('[data-gsc-queries]').innerHTML = table(data.queries, 'Busca', (r) => esc(r.key));
    $('[data-gsc-pages]').innerHTML = table(data.pages, 'Página', (r) => (r.recipeId ? `<a href="/admin/receitas/${r.recipeId}">${esc(r.title)}</a>` : `<a href="${esc(r.key)}" target="_blank" rel="noopener">${esc(r.path === '/' ? 'Página inicial' : r.path)}</a>`));
    const DEV = { MOBILE: '📱 Celular', DESKTOP: '💻 Computador', TABLET: '📟 Tablet' };
    const max = Math.max(1, ...data.devices.map((d) => d.clicks));
    $('[data-gsc-devices]').innerHTML = data.devices.length ? `<ul class="gsc-bars">${data.devices.map((d) => `<li><span class="gsc-bar-l">${esc(DEV[d.key] || d.key)}</span><span class="gsc-bar"><i style="width:${Math.max(2, (d.clicks / max) * 100).toFixed(1)}%"></i></span><b>${nf(d.clicks)}</b><small>${pct(data.totals.clicks ? d.clicks / data.totals.clicks : 0)}</small></li>`).join('')}</ul>` : '<p class="empty">Sem dados neste período.</p>';
    $('[data-gsc-sitemaps]').innerHTML = data.sitemaps.length ? `<ul class="gsc-sitemaps">${data.sitemaps.map((sm) => `<li><code>${esc(sm.path)}</code><span>${sm.pending ? '⏳ aguardando o Google' : sm.errors ? `⚠️ ${sm.errors} erro(s)` : '✅ lido pelo Google'}${sm.lastDownloaded ? ` em ${esc(new Date(sm.lastDownloaded).toLocaleDateString('pt-BR'))}` : ''}${sm.submitted ? ` · ${nf(sm.submitted)} endereços` : ''}</span></li>`).join('')}</ul>` : '<p class="empty">Nenhum sitemap enviado ainda.</p>';
  }

  // ---------------- Oportunidades (busca + página) ----------------
  let ops = null;
  let opTab = 'almost';
  const HINT = {
    almost: 'Buscas em que a receita aparece entre a 4ª e a 20ª posição. Use o termo exatamente como as pessoas buscam no título, na descrição e no primeiro parágrafo; acrescente dicas e variações que respondam a essa busca.',
    ctr: 'A receita já aparece no topo, mas poucas pessoas clicam. Reescreva o título SEO e a descrição SEO para ficarem mais convidativos (ex.: tempo de preparo, "sem forno", "fofinho", "fácil").',
  };
  function renderOps() {
    if (!ops) return;
    for (const k of ['almost', 'ctr']) $(`[data-gsc-op-n="${k}"]`).textContent = ops[k].length;
    document.querySelectorAll('[data-gsc-op]').forEach((b) => b.classList.toggle('on', b.dataset.gscOp === opTab));
    $('[data-gsc-op-hint]').textContent = HINT[opTab];
    const list = ops[opTab];
    const todo = (o) => {
      if (opTab === 'ctr') return 'Reescrever título e descrição SEO';
      const miss = [!o.inTitle && 'título', !o.inDescription && 'descrição'].filter(Boolean);
      return miss.length ? `Colocar “${o.query}” no ${miss.join(' e na ')}` : 'Já está no título e na descrição: enriqueça o texto (dicas, variações, perguntas comuns)';
    };
    $('[data-gsc-ops]').innerHTML = list.length ? `<ol class="gsc-ops-list">${list.map((o) => `<li>
      <div class="gsc-op-q"><b>${esc(o.query)}</b><span class="gsc-op-pos" title="Posição média">#${o.position.toFixed(1).replace('.', ',')}</span></div>
      <div class="gsc-op-meta">${nf(o.impressions)} exibições · ${nf(o.clicks)} cliques · CTR ${pct(o.ctr)} · ${o.recipeId ? `<a href="/admin/receitas/${o.recipeId}">${esc(o.title)}</a>` : `<code>${esc(o.path)}</code>`}</div>
      <div class="gsc-op-todo">👉 ${esc(todo(o))}</div></li>`).join('')}</ol>` : `<p class="empty">${opTab === 'almost' ? 'Nenhuma busca entre a 4ª e a 20ª posição com exibições suficientes neste período.' : 'Nenhuma página do top 10 com poucos cliques. 👏'}</p>`;
  }
  async function loadOps() {
    try {
      ops = await api(`/gsc/oportunidades?dias=${$('[data-gsc-days]').value}`);
      renderOps();
    } catch (e) { $('[data-gsc-ops]').innerHTML = `<p class="empty">${esc(e.message)}</p>`; }
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-gsc-op]');
    if (!b) return;
    opTab = b.dataset.gscOp;
    renderOps();
  });

  async function load() {
    err('');
    root.classList.add('loading');
    try {
      data = await api(`/gsc/report?dias=${$('[data-gsc-days]').value}`);
      $('[data-gsc-range]').textContent = `${data.site} · ${dfmt(data.range.startDate, true)} a ${dfmt(data.range.endDate, true)} (o Google leva cerca de 2 dias para fechar os números)`;
      show('[data-gsc-report]', true); // mostra antes de desenhar: o gráfico usa a largura real do cartão
      kpis(); chart(); lists();
      loadOps();
    } catch (e) {
      show('[data-gsc-report]', false);
      err(e.message);
    } finally { root.classList.remove('loading'); }
  }

  $('[data-gsc-kpis]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-metric]');
    if (!b) return;
    metric = b.dataset.metric;
    kpis(); chart();
  });
  $('[data-gsc-days]').addEventListener('change', load);
  $('[data-gsc-site]').addEventListener('change', async (e) => {
    try { await api('/settings', { method: 'PUT', body: { gscProperty: e.target.value } }); load(); } catch (x) { toast(x.message); }
  });
  $('[data-gsc-submit]').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try { const r = await api('/gsc/sitemap', { method: 'POST' }); toast(`✅ Sitemap enviado: ${r.url}`, 5000); load(); } catch (x) { toast(`⚠️ ${x.message}`, 7000); } finally { e.target.disabled = false; }
  });
  let rt;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => data && chart(), 150); });

  async function init() {
    const st = await api('/gsc/status');
    show('[data-gsc-setup]', !st.configured);
    show('[data-gsc-account]', st.configured);
    if (st.error) err(st.error);
    if (!st.configured) return;
    $('[data-gsc-email]').textContent = st.email;
    if (st.source === 'env') $('[data-gsc-remove]').hidden = true;
    try {
      const s = await api('/gsc/sites');
      const sel = $('[data-gsc-site]');
      sel.innerHTML = s.items.map((it) => `<option value="${esc(it.siteUrl)}"${it.siteUrl === s.current ? ' selected' : ''}>${esc(it.siteUrl.replace(/^sc-domain:/, 'Domínio: '))}</option>`).join('');
      show('[data-gsc-filters]', s.items.length > 0);
      const msg = $('[data-gsc-msg]');
      if (!s.items.length) {
        msg.innerHTML = `Falta um passo: no Search Console, abra sua propriedade → <b>Configurações → Usuários e permissões → Adicionar usuário</b> e cole <code>${esc(st.email)}</code> com permissão <b>Completo</b>. Depois recarregue esta página.`;
        msg.hidden = false;
        return;
      }
      msg.hidden = true;
      load();
    } catch (e) { err(e.message); }
  }
  init();
})();
