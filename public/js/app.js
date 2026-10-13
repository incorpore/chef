/* Chef — scripts comuns a todas as páginas (PWA, favoritos, busca, timers, lista de compras) */
(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------------- Armazenamento local ----------------
  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(`chef:${key}`);
        return v === null ? fallback : JSON.parse(v);
      } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(`chef:${key}`, JSON.stringify(value)); } catch { /* cota cheia ou modo privado */ }
      window.dispatchEvent(new CustomEvent('chef:store', { detail: { key } }));
    },
  };

  // ---------------- Toast ----------------
  let toastTimer;
  function toast(msg, ms = 2600) {
    const el = $('.toast');
    if (!el) return;
    el.innerHTML = `<span class="toast-text">${esc(msg)}</span>`;
    el.title = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  async function api(path, opts = {}) {
    const res = await fetch(`/api/v1${path}`, {
      credentials: 'same-origin',
      ...opts,
      headers: { ...(opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) },
      body: opts.body && !(opts.body instanceof FormData) && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body,
    });
    const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
    if (!res.ok) throw Object.assign(new Error(data?.error || `Erro ${res.status}`), { status: res.status, data });
    return data;
  }

  // ---------------- Tema ----------------
  document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-theme-toggle]')) return;
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('chef:theme', next); } catch { /* ignore */ }
  });

  // ---------------- Conta: menu do avatar e "Sair" ----------------
  document.addEventListener('click', (e) => {
    for (const d of document.querySelectorAll('[data-account-menu][open]')) if (!d.contains(e.target)) d.open = false;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const d = document.querySelector('[data-account-menu][open]');
    if (d) { d.open = false; d.querySelector('summary')?.focus(); }
  });
  document.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-logout]')) return;
    try { await api('/auth/logout', { method: 'POST' }); } catch { /* sai mesmo assim */ }
    navigator.serviceWorker?.controller?.postMessage({ type: 'logout' });
    location.href = '/';
  });

  // ---------------- Imagem quebrada (link externo que saiu do ar) ----------------
  // Em vez do texto alternativo por cima do cartão, mostra um fundo neutro com o chapéu de chef.
  const PH = '/icons/placeholder.svg';
  const brokenImg = (img) => {
    if (!(img instanceof HTMLImageElement) || img.dataset.broken || !img.getAttribute('src') || img.getAttribute('src') === PH) return;
    img.dataset.broken = '1';
    img.removeAttribute('srcset');
    img.classList.add('img-broken');
    if (img.classList.contains('avatar')) { img.replaceWith(Object.assign(document.createElement('span'), { className: `${img.className} avatar-initials`, textContent: '?' })); return; }
    img.src = PH;
  };
  document.addEventListener('error', (e) => brokenImg(e.target), true);
  for (const img of document.images) if (img.complete && img.naturalWidth === 0 && img.loading !== 'lazy' && img.getAttribute('src')) brokenImg(img);

  // ---------------- Favoritos ----------------
  const favs = {
    all: () => store.get('favs', []),
    has: (id) => favs.all().some((f) => String(f.id) === String(id)),
    toggle(item) {
      let list = favs.all();
      const on = !list.some((f) => String(f.id) === String(item.id));
      list = on ? [{ ...item, savedAt: Date.now() }, ...list] : list.filter((f) => String(f.id) !== String(item.id));
      store.set('favs', list);
      // Guarda a página da receita no cache para leitura offline
      if (on && navigator.serviceWorker?.controller) navigator.serviceWorker.controller.postMessage({ type: 'cache-url', url: `/receita/${item.slug}` });
      return on;
    },
  };
  function paintFavs() {
    $$('[data-fav]').forEach((b) => {
      const on = favs.has(b.dataset.fav);
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on);
    });
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-fav]');
    if (!b) return;
    e.preventDefault();
    const on = favs.toggle({ id: Number(b.dataset.fav), slug: b.dataset.slug, title: b.dataset.title, cover: b.dataset.cover });
    paintFavs();
    toast(on ? '❤️ Salvo nos favoritos (disponível offline)' : 'Removido dos favoritos');
    if (navigator.vibrate) navigator.vibrate(15);
  });

  // ---------------- Lista de compras ----------------
  const UNIT_ALIASES = { 'xícaras': 'xícara', colheres: 'colher' };
  const shopping = {
    all: () => store.get('shopping', []),
    save: (l) => store.set('shopping', l),
    /** Adiciona ingredientes de uma receita (já escalados). Itens iguais são somados. */
    addRecipe(recipe, factor = 1) {
      const list = shopping.all();
      for (const ing of recipe.ingredients) {
        const key = `${(ing.name || '').toLowerCase().trim()}|${UNIT_ALIASES[ing.unit] || ing.unit || ''}`;
        const qty = ing.quantity != null ? ing.quantity * factor : null;
        const existing = list.find((x) => x.key === key && !x.checked);
        if (existing && qty != null && existing.quantity != null) {
          existing.quantity += qty;
          existing.sources = [...new Set([...(existing.sources || []), recipe.title])];
        } else if (!existing) {
          list.push({ id: Math.random().toString(36).slice(2), key, name: ing.name, unit: ing.unit || '', quantity: qty, note: ing.note || '', checked: false, recipe: { slug: recipe.slug, title: recipe.title }, sources: [recipe.title] });
        }
      }
      shopping.save(list);
    },
    addText(text) {
      const list = shopping.all();
      list.push({ id: Math.random().toString(36).slice(2), key: text.toLowerCase(), name: text, unit: '', quantity: null, checked: false, recipe: null, sources: [] });
      shopping.save(list);
    },
  };

  // ---------------- Cardápio ----------------
  const planner = {
    all: () => store.get('plan', {}),
    add(dateKey, meal, recipe) {
      const p = planner.all();
      p[dateKey] = p[dateKey] || {};
      p[dateKey][meal] = [...(p[dateKey][meal] || []), { id: recipe.id, slug: recipe.slug, title: recipe.title, cover: recipe.cover || '' }];
      store.set('plan', p);
    },
  };
  const dateKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // ---------------- Quantidades ----------------
  const FR = [[0.125, '⅛'], [0.25, '¼'], [1 / 3, '⅓'], [0.375, '⅜'], [0.5, '½'], [0.625, '⅝'], [2 / 3, '⅔'], [0.75, '¾'], [0.875, '⅞']];
  function fmtQty(q) {
    if (q == null || isNaN(q)) return '';
    if (q >= 20) return String(Math.round(q));
    const w = Math.floor(q);
    const f = q - w;
    if (f < 0.04) return String(w);
    if (f > 0.96) return String(w + 1);
    let best = null;
    for (const [v, s] of FR) { const d = Math.abs(f - v); if (d < 0.04 && (!best || d < best[0])) best = [d, s]; }
    if (best) return w ? `${w} ${best[1]}` : best[1];
    return String(Math.round(q * 100) / 100).replace('.', ',');
  }

  const PLURALS = { 'xícara': 'xícaras', 'colher de sopa': 'colheres de sopa', 'colher de chá': 'colheres de chá', 'colher de sobremesa': 'colheres de sobremesa', colher: 'colheres', copo: 'copos', lata: 'latas', caixa: 'caixas', pacote: 'pacotes', dente: 'dentes', fatia: 'fatias', pitada: 'pitadas', 'maço': 'maços', ramo: 'ramos', unidade: 'unidades', tablete: 'tabletes', envelope: 'envelopes' };
  const unitLabel = (unit, q) => (unit && q > 1 && PLURALS[unit] ? PLURALS[unit] : unit || '');

  // ---------------- Timers (persistem entre páginas) ----------------
  let audioCtx;
  function beep(times = 3) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      for (let i = 0; i < times; i++) {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = 'sine';
        o.frequency.value = i % 2 ? 660 : 880;
        g.gain.setValueAtTime(0.0001, audioCtx.currentTime + i * 0.35);
        g.gain.exponentialRampToValueAtTime(0.4, audioCtx.currentTime + i * 0.35 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + i * 0.35 + 0.3);
        o.connect(g).connect(audioCtx.destination);
        o.start(audioCtx.currentTime + i * 0.35);
        o.stop(audioCtx.currentTime + i * 0.35 + 0.32);
      }
    } catch { /* sem áudio */ }
  }
  const timers = {
    all: () => store.get('timers', []),
    save: (l) => { store.set('timers', l); renderTimers(); },
    start(seconds, label) {
      const l = timers.all();
      l.push({ id: Math.random().toString(36).slice(2), label, duration: seconds, endAt: Date.now() + seconds * 1000, paused: false, remaining: seconds * 1000, done: false });
      timers.save(l);
      if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
      toast(`⏱️ Timer de ${fmtTime(seconds)} iniciado`);
      try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); } catch { /* ignore */ }
    },
  };
  function fmtTime(s) {
    s = Math.max(0, Math.round(s));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
  }
  const RING = 2 * Math.PI * 14;
  const timerLeft = (t) => (t.paused ? t.remaining : t.endAt - Date.now());
  let dockKey = '';
  function renderTimers() {
    let dock = $('.timer-dock');
    const list = timers.all();
    if (!dock) {
      if (!list.length) return;
      dock = document.createElement('div');
      dock.className = 'timer-dock';
      document.body.appendChild(dock);
    }
    // Mesmo conjunto de timers e estados: só atualiza o relógio (não recria os botões a cada segundo)
    const key = list.map((t) => `${t.id}:${t.done}:${t.paused}`).join('|');
    if (key === dockKey && dock.children.length === list.length) {
      list.forEach((t, i) => {
        const el = dock.children[i];
        const left = timerLeft(t);
        el.querySelector('.t-time').textContent = t.done ? 'Pronto!' : fmtTime(left / 1000);
        el.querySelector('.fg').setAttribute('stroke-dashoffset', RING * (1 - Math.max(0, Math.min(1, left / (t.duration * 1000)))));
      });
      return;
    }
    dockKey = key;
    dock.innerHTML = list.map((t) => {
      const left = timerLeft(t);
      const frac = Math.max(0, Math.min(1, left / (t.duration * 1000)));
      return `<div class="timer${t.done ? ' done' : ''}${t.paused ? ' paused' : ''}" data-tid="${t.id}" title="${esc(t.label)}">
        <svg class="t-ring" viewBox="0 0 34 34" aria-hidden="true"><circle class="bg" cx="17" cy="17" r="14"/><circle class="fg" cx="17" cy="17" r="14" stroke-dasharray="${RING}" stroke-dashoffset="${RING * (1 - frac)}"/></svg>
        <span class="t-info"><span class="t-time">${t.done ? 'Pronto!' : fmtTime(left / 1000)}</span><span class="t-label">${esc(t.label)}</span></span>
        ${t.done ? '' : `<button data-tpause aria-label="${t.paused ? 'Continuar' : 'Pausar'}">${t.paused ? '▶' : '❚❚'}</button><button data-tadd aria-label="Mais 1 minuto">+1</button>`}
        <button data-tclose aria-label="Fechar timer">✕</button>
      </div>`;
    }).join('');
    // Timer novo aparece à vista (o mais recente fica no fim da fileira)
    dock.scrollLeft = dock.scrollWidth;
    layoutFloats();
  }

  /**
   * "Pilha" de elementos flutuantes no rodapé: banner (cookies/instalar) → timers → aviso.
   * Mede a altura de cada camada e expõe em variáveis CSS para uma nunca cobrir a outra.
   */
  function layoutFloats() {
    const root = document.documentElement.style;
    // offsetParent é sempre null em elementos position:fixed, por isso a checagem usa display/hidden
    const visible = (el) => el && !el.hidden && getComputedStyle(el).display !== 'none';
    const banner = [$('.consent'), $('.install-banner')].filter(visible).reduce((h, el) => Math.max(h, el.getBoundingClientRect().height + 10), 0);
    const dock = $('.timer-dock');
    const dockH = dock && dock.children.length ? dock.getBoundingClientRect().height + 6 : 0;
    if (dock) {
      dock.classList.toggle('many', dock.children.length > 1);
      dock.classList.toggle('scrolls', dock.scrollWidth > dock.clientWidth + 2);
    }
    root.setProperty('--banner-h', `${Math.round(banner)}px`);
    root.setProperty('--dock-h', `${Math.round(dockH)}px`);
  }
  if ('ResizeObserver' in window) {
    const ro = new ResizeObserver(() => layoutFloats());
    for (const sel of ['.consent', '.install-banner']) { const el = $(sel); if (el) ro.observe(el); }
    new MutationObserver(() => layoutFloats()).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['hidden', 'class'] });
  }
  addEventListener('resize', () => layoutFloats());

  function tickTimers() {
    const list = timers.all();
    let changed = false;
    for (const t of list) {
      if (!t.done && !t.paused && t.endAt <= Date.now()) {
        t.done = true;
        changed = true;
        beep(6);
        if (navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 600]);
        const body = `${t.label} — ${fmtTime(t.duration)}`;
        if ('Notification' in window && Notification.permission === 'granted') {
          navigator.serviceWorker?.ready.then((reg) => reg.showNotification('⏰ Timer finalizado!', { body, tag: t.id, vibrate: [300, 150, 300], requireInteraction: true })).catch(() => new Notification('⏰ Timer finalizado!', { body }));
        }
        toast(`⏰ ${body}`, 6000);
        window.dispatchEvent(new CustomEvent('chef:timer-done', { detail: t }));
      }
    }
    if (changed) store.set('timers', list);
    if (list.length) renderTimers();
  }
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-tid]');
    if (!el) return;
    const list = timers.all();
    const t = list.find((x) => x.id === el.dataset.tid);
    if (!t) return;
    if (e.target.closest('[data-tclose]')) return timers.save(list.filter((x) => x !== t));
    if (e.target.closest('[data-tadd]')) {
      if (t.paused) t.remaining += 60000; else t.endAt += 60000;
      t.duration += 60;
    }
    if (e.target.closest('[data-tpause]')) {
      if (t.paused) { t.endAt = Date.now() + t.remaining; t.paused = false; } else { t.remaining = t.endAt - Date.now(); t.paused = true; }
    }
    timers.save(list);
  });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-timer]');
    if (b) timers.start(Number(b.dataset.timer), b.dataset.timerLabel || 'Timer');
  });
  setInterval(tickTimers, 1000);
  window.addEventListener('storage', (e) => { if (e.key === 'chef:timers') renderTimers(); if (e.key === 'chef:favs') paintFavs(); });

  // ---------------- Autocomplete da busca ----------------
  function setupSuggest(input) {
    const box = input.parentElement.querySelector('.suggest');
    if (!box) return;
    let ctl;
    let idx = -1;
    const close = () => { box.hidden = true; idx = -1; };
    input.addEventListener('input', () => {
      const q = input.value.trim();
      if (q.length < 2) return close();
      ctl?.abort();
      ctl = new AbortController();
      clearTimeout(input._t);
      input._t = setTimeout(() => {
        fetch(`/api/v1/search/suggest?q=${encodeURIComponent(q)}`, { signal: ctl.signal }).then((r) => r.json()).then(({ items }) => {
          if (!items.length) return close();
          box.innerHTML = items.map((r) => `<a href="/receita/${esc(r.slug)}">${r.cover ? `<img src="${esc(r.cover)}" alt="" loading="lazy">` : '<span class="ph-sm"></span>'}<span>${esc(r.title)}</span><small>#${esc(r.code)}</small></a>`).join('');
          box.hidden = false;
          idx = -1;
        }).catch(() => {});
      }, 150);
    });
    input.addEventListener('keydown', (e) => {
      const links = $$('a', box);
      if (box.hidden || !links.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        idx = (idx + (e.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length;
        links.forEach((l, i) => l.classList.toggle('focus', i === idx));
      } else if (e.key === 'Enter' && idx >= 0) {
        e.preventDefault();
        location.href = links[idx].href;
      } else if (e.key === 'Escape') close();
    });
    document.addEventListener('click', (e) => { if (!input.parentElement.contains(e.target)) close(); });
  }
  $$('[data-suggest]').forEach(setupSuggest);

  // ---------------- Copiar (funciona também em HTTP, ex.: http://IP-do-ZimaOS) ----------------
  /** navigator.clipboard só existe em HTTPS/localhost; em HTTP usa o método antigo (textarea + execCommand). */
  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch { /* cai no método alternativo */ }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }

  // Botão de copiar o código da receita (em cartões, página, busca, painel…)
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-copy-code]');
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    const code = `#${b.dataset.copyCode}`;
    const ok = await copyText(code);
    if (ok) {
      b.classList.add('copied');
      b.setAttribute('aria-label', `Código ${code} copiado`);
      setTimeout(() => { b.classList.remove('copied'); b.setAttribute('aria-label', `Copiar código ${code}`); }, 1600);
      toast(`📋 Código ${code} copiado`);
      track('copy_code', { item_id: b.dataset.copyCode });
      if (navigator.vibrate) navigator.vibrate(10);
    } else {
      prompt('Copie o código:', code);
    }
  });

  // ---------------- Compartilhar ----------------
  async function share({ title, text, url }) {
    if (navigator.share) {
      try { await navigator.share({ title, text, url }); track('share', { method: 'native' }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    if (await copyText(url || text)) toast('🔗 Link copiado!'); else prompt('Copie o link:', url || text);
  }

  // ---------------- Vídeo do YouTube "leve" ----------------
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.yt-lite');
    if (!b) return;
    const frame = b.closest('[data-yt]');
    frame.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(frame.dataset.yt)}?autoplay=1&rel=0" title="Vídeo" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
  });

  // ---------------- Newsletter ----------------
  document.addEventListener('submit', async (e) => {
    const f = e.target.closest('[data-newsletter]');
    if (!f) return;
    e.preventDefault();
    try {
      const r = await api('/subscribe', { method: 'POST', body: { email: f.email.value } });
      f.innerHTML = r.pending
        ? '<h3>📬 Quase lá!</h3><p>Enviamos um link de confirmação para o seu e-mail. Clique nele para começar a receber as receitas (confira também o spam).</p>'
        : '<h3>🎉 Inscrição confirmada!</h3><p>Obrigado! Você vai receber as novidades.</p>';
      track('sign_up', { method: 'newsletter' });
    } catch (err) { toast(err.message); }
  });

  // ---------------- Medição (GA4/GTM/Pixel/Clarity) com consentimento ----------------
  const CFG = (() => { try { return JSON.parse($('#chef-config')?.textContent || '{}'); } catch { return {}; } })();
  const consent = {
    get: () => { try { return localStorage.getItem('chef:consent'); } catch { return null; } },
    set(v) {
      try { localStorage.setItem('chef:consent', v); } catch { /* ignore */ }
      apply(v);
      const b = $('.consent');
      if (b) b.hidden = true;
    },
  };
  let extrasLoaded = false;
  function loadScript(src) {
    const el = document.createElement('script');
    el.async = true;
    el.src = src;
    document.head.appendChild(el);
  }
  function apply(v) {
    const g = v === 'granted' ? 'granted' : 'denied';
    if (window.gtag) window.gtag('consent', 'update', { ad_storage: g, ad_user_data: g, ad_personalization: g, analytics_storage: g });
    if (window.adsbygoogle) window.adsbygoogle.requestNonPersonalizedAds = g === 'granted' ? 0 : 1;
    if (g !== 'granted' || extrasLoaded) return;
    extrasLoaded = true;
    // Ferramentas que gravam cookies próprios só carregam depois do "Aceitar"
    if (CFG.pixel) {
      /* eslint-disable */
      !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[]}(window,document);
      /* eslint-enable */
      window.fbq('init', CFG.pixel);
      window.fbq('track', 'PageView');
      loadScript('https://connect.facebook.net/en_US/fbevents.js');
    }
    if (CFG.clarity) {
      window.clarity = window.clarity || function () { (window.clarity.q = window.clarity.q || []).push(arguments); };
      loadScript(`https://www.clarity.ms/tag/${encodeURIComponent(CFG.clarity)}`);
    }
  }
  if (CFG.consent) {
    const v = consent.get();
    if (v) apply(v);
    else setTimeout(() => { const b = $('.consent'); if (b) b.hidden = false; }, 800);
  } else apply('granted');
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-consent]');
    if (b) consent.set(b.dataset.consent);
    if (e.target.closest('[data-consent-open]')) { const c = $('.consent'); if (c) c.hidden = false; }
  });

  /** Envia um evento para GA4/GTM/Pixel (somente o que estiver configurado e consentido). */
  function track(name, params = {}) {
    try {
      if (window.gtag) window.gtag('event', name, params);
      else if (window.dataLayer) window.dataLayer.push({ event: name, ...params });
      if (window.fbq) window.fbq('trackCustom', name, params);
    } catch { /* medição nunca quebra a página */ }
  }
  // Cliques em links de afiliado e compartilhamentos
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="/go/"]');
    if (a) track('affiliate_click', { product_id: a.getAttribute('href').split('/')[2], link_text: a.textContent.trim().slice(0, 80) });
    const n = e.target.closest('[data-share-net]');
    if (n) track('share', { method: n.dataset.shareNet, content_type: 'recipe', item_id: document.querySelector('[data-copy-code]')?.dataset.copyCode || '' });
  });

  // ---------------- PWA: service worker e instalação ----------------
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }
  let deferredPrompt;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (!store.get('installDismissed', false) && !document.body.classList.contains('admin')) setTimeout(() => { const b = $('.install-banner'); if (b) b.hidden = false; }, 4000);
  });
  document.addEventListener('click', async (e) => {
    if (e.target.closest('[data-install]') && deferredPrompt) {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      $('.install-banner').hidden = true;
    }
    if (e.target.closest('[data-install-dismiss]')) {
      $('.install-banner').hidden = true;
      store.set('installDismissed', true);
    }
  });
  window.addEventListener('online', () => toast('✅ Conexão restabelecida'));
  window.addEventListener('offline', () => toast('📴 Sem conexão — modo offline'));

  // ---------------- Densidades (g por ml) para converter medidas caseiras ----------------
  const DENSITY = [
    ['farinha de trigo', 0.5], ['farinha de amendoa', 0.4], ['farinha de rosca', 0.45], ['farinha de mandioca', 0.6], ['farinha', 0.5],
    ['acucar mascavo', 0.6], ['acucar de confeiteiro', 0.5], ['acucar refinado', 0.75], ['acucar cristal', 0.85], ['acucar demerara', 0.8], ['acucar', 0.75],
    ['chocolate em po', 0.38], ['cacau', 0.38], ['achocolatado', 0.45], ['gotas de chocolate', 0.7], ['chocolate', 0.6],
    ['manteiga', 0.95], ['margarina', 0.95], ['amido de milho', 0.5], ['maisena', 0.5], ['fuba', 0.55], ['polvilho', 0.6], ['tapioca', 0.6],
    ['aveia', 0.35], ['granola', 0.45], ['arroz', 0.8], ['feijao', 0.8], ['lentilha', 0.8], ['quinoa', 0.75], ['coco ralado', 0.33],
    ['leite em po', 0.42], ['queijo ralado', 0.4], ['parmesao', 0.4], ['mel', 1.4], ['sal', 1.2], ['fermento', 0.9], ['bicarbonato', 0.9],
    ['nozes', 0.5], ['castanha', 0.55], ['amendoim', 0.6], ['uva passa', 0.6], ['canela', 0.5], ['gergelim', 0.6], ['chia', 0.65],
  ];
  const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  function density(name) {
    const n = norm(name);
    if (/\b(leite|agua|oleo|caldo|suco|vinho|creme de leite|azeite|vinagre|cafe|cerveja)\b/.test(n) && !/leite em po|leite condensado/.test(n)) return null;
    const hit = DENSITY.find(([k]) => n.includes(k));
    return hit ? hit[1] : null;
  }

  // ---------------- "Continue de onde parou" (página inicial) ----------------
  const cont = $('[data-continue]');
  if (cont) {
    const items = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith('chef:progress:')) continue;
      const p = store.get(k.slice(5), null);
      if (p && p.slug && p.steps?.length && p.steps.length < p.total) items.push(p);
    }
    if (items.length) {
      items.sort((a, b) => b.updatedAt - a.updatedAt);
      $('.hscroll', cont).innerHTML = items.slice(0, 8).map((p) => `<article class="card"><a class="card-link" href="/receita/${esc(p.slug)}"><div class="card-media">${p.cover ? `<img src="${esc(p.cover)}" alt="" loading="lazy">` : '<div class="ph"></div>'}</div><div class="card-body"><span class="card-cat">Passo ${p.current + 1} de ${p.total}</span><h3>${esc(p.title)}</h3><div class="timeline-bar"><span class="tl-cook" style="flex:${p.steps.length}"></span><span style="flex:${p.total - p.steps.length};background:var(--line)"></span></div></div></a></article>`).join('');
      cont.hidden = false;
    }
  }

  paintFavs();
  renderTimers();
  layoutFloats();

  window.Chef = { $, $$, esc, store, toast, api, favs, paintFavs, shopping, planner, dateKey, fmtQty, unitLabel, timers, fmtTime, share, beep, density, norm, track, layoutFloats, copyText };
})();
