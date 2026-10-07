/* Chef — página da receita: porções, checklist, progresso, timeline e Modo Cozinha */
(() => {
  'use strict';
  const { $, $$, esc, store, toast, api, shopping, planner, dateKey, fmtQty, unitLabel, timers, share, track } = window.Chef;
  const dataEl = $('#recipe-data');
  if (!dataEl) return;
  const R = JSON.parse(dataEl.textContent);
  const PKEY = `progress:${R.id}`;

  // ---------------- Estado de progresso (salvo no aparelho) ----------------
  const state = Object.assign({ ings: [], steps: [], current: 0, servings: R.servings, metric: false }, store.get(PKEY, {}));
  function save() {
    const touched = state.ings.length || state.steps.length || state.current > 0;
    if (touched) store.set(PKEY, { ...state, title: R.title, slug: R.slug, cover: R.cover, total: R.steps.length, updatedAt: Date.now() });
    else store.set(PKEY, null);
  }
  const factor = () => state.servings / R.servings;

  // ---------------- Conversão para gramas/ml (aproximada) ----------------
  const ML = { 'xícara': 240, 'colher de sopa': 15, 'colher de chá': 5, 'colher de sobremesa': 10, colher: 15, copo: 200 };
  function metric(ing, q) {
    const ml = ML[ing.unit];
    if (!ml || q == null) return null;
    const dens = window.Chef.density?.(ing.name);
    if (dens) return { q: Math.round((q * ml * dens) / 5) * 5 || Math.round(q * ml * dens), unit: 'g' };
    return { q: Math.round(q * ml), unit: 'ml' };
  }
  function qtyText(ing, f = factor()) {
    if (ing.quantity == null) return '';
    const q = ing.quantity * f;
    const qm = ing.quantityMax ? ing.quantityMax * f : null;
    if (state.metric) {
      const m = metric(ing, q);
      if (m) return `${m.q}${qm ? `–${metric(ing, qm).q}` : ''} ${m.unit}`;
    }
    return `${fmtQty(q)}${qm ? `–${fmtQty(qm)}` : ''}${ing.unit ? ` ${unitLabel(ing.unit, qm || q)}` : ''}`;
  }
  const withDe = (ing, txt) => (txt && ing.unit ? `${txt} de` : txt);

  // ---------------- Porções ----------------
  function paintServings() {
    $$('[data-servings]').forEach((el) => { el.textContent = fmtQty(state.servings); });
    $$('.ing[data-i]').forEach((li) => {
      const q = $('.qty', li);
      if (q) { const ing = R.ingredients[li.dataset.i]; q.textContent = withDe(ing, qtyText(ing)); }
    });
    $$('[data-scale-x]').forEach((b) => b.classList.toggle('active', Math.abs(state.servings / R.servings - Number(b.dataset.scaleX)) < 0.001));
    $('[data-units-toggle]')?.classList.toggle('active', state.metric);
    if (cook.open) cook.render();
  }
  document.addEventListener('click', (e) => {
    const s = e.target.closest('[data-scale]');
    if (s) {
      const step = R.servings >= 4 || state.servings > 2 ? 1 : 0.5;
      state.servings = Math.max(0.5, state.servings + Number(s.dataset.scale) * step);
      paintServings(); save();
    }
    const x = e.target.closest('[data-scale-x]');
    if (x) { state.servings = R.servings * Number(x.dataset.scaleX); paintServings(); save(); }
    if (e.target.closest('[data-units-toggle]')) { state.metric = !state.metric; paintServings(); save(); toast(state.metric ? 'Mostrando em gramas/ml (aproximado)' : 'Mostrando medidas caseiras'); }
  });

  // ---------------- Checklist de ingredientes e passos ----------------
  function paintProgress() {
    $$('[data-ing-check]').forEach((c) => { c.checked = state.ings.includes(Number(c.dataset.ingCheck)); });
    $$('.step[data-step]').forEach((li) => {
      const i = Number(li.dataset.step);
      li.classList.toggle('done', state.steps.includes(i));
      li.classList.toggle('current', i === state.current && state.steps.length > 0 && !state.steps.includes(i));
    });
    const dc = $('[data-done-count]');
    if (dc) dc.textContent = state.steps.length;
    const banner = $('.resume-banner');
    if (banner) {
      const show = state.steps.length > 0 && state.steps.length < R.steps.length;
      banner.hidden = !show;
      if (show) $('[data-resume-step]').textContent = `${state.current + 1} de ${R.steps.length}`;
    }
  }
  document.addEventListener('change', (e) => {
    const c = e.target.closest('[data-ing-check]');
    if (!c) return;
    const i = Number(c.dataset.ingCheck);
    state.ings = c.checked ? [...new Set([...state.ings, i])] : state.ings.filter((x) => x !== i);
    save();
    if (navigator.vibrate) navigator.vibrate(8);
  });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-step-toggle]');
    if (b) {
      const i = Number(b.dataset.stepToggle);
      if (state.steps.includes(i)) state.steps = state.steps.filter((x) => x !== i);
      else { state.steps.push(i); state.current = Math.min(R.steps.length - 1, i + 1); }
      save(); paintProgress();
      if (state.steps.length === R.steps.length) toast('🎉 Receita concluída! Que tal avaliar?');
    }
    if (e.target.closest('[data-ing-clear]')) { state.ings = []; save(); paintProgress(); }
    if (e.target.closest('[data-progress-reset]')) { state.ings = []; state.steps = []; state.current = 0; save(); paintProgress(); }
    const ref = e.target.closest('[data-ing-ref]');
    if (ref) flashIngredient(ref.dataset.ingRef);
  });
  function flashIngredient(i) {
    const li = $(`.ing[data-i="${i}"]`);
    if (!li) return;
    li.classList.add('flash');
    li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    setTimeout(() => li.classList.remove('flash'), 1200);
  }

  // ---------------- Barra de leitura ----------------
  const rail = $('.progress-rail span');
  if (rail) {
    const onScroll = () => {
      const h = document.documentElement.scrollHeight - innerHeight;
      rail.style.width = `${h > 0 ? (scrollY / h) * 100 : 0}%`;
    };
    addEventListener('scroll', onScroll, { passive: true });
  }

  // ---------------- Galeria ----------------
  const gallery = $('[data-gallery]');
  if (gallery) {
    const dots = $$('.gallery-dots button');
    const sync = () => {
      const i = Math.round(gallery.scrollLeft / gallery.clientWidth);
      dots.forEach((d, j) => d.classList.toggle('on', i === j));
    };
    gallery.addEventListener('scroll', () => requestAnimationFrame(sync), { passive: true });
    dots.forEach((d) => d.addEventListener('click', () => gallery.scrollTo({ left: gallery.clientWidth * Number(d.dataset.goto), behavior: 'smooth' })));
    sync();
  }

  // ---------------- Linha do tempo: "fica pronto às…" ----------------
  const hhmm = (d) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  function paintTimeline() {
    const ready = $('[data-ready-at] b');
    if (ready) ready.textContent = hhmm(new Date(Date.now() + R.total * 60000));
  }
  const serve = $('[data-serve-at]');
  if (serve) {
    serve.addEventListener('input', () => {
      if (!serve.value) return;
      const [h, m] = serve.value.split(':').map(Number);
      const t = new Date();
      t.setHours(h, m, 0, 0);
      if (t < Date.now()) t.setDate(t.getDate() + 1);
      const start = new Date(t - R.total * 60000);
      $('[data-start-at]').textContent = start < Date.now() ? `${hhmm(start)} (já passou!)` : hhmm(start);
    });
    paintTimeline();
    setInterval(paintTimeline, 30000);
  }

  // ---------------- Ações ----------------
  document.addEventListener('click', async (e) => {
    if (e.target.closest('[data-share]')) share({ title: R.title, text: `${R.title} — código #${R.code}`, url: R.url });
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      try { await navigator.clipboard.writeText(`#${copy.dataset.copy}`); toast(`Código #${copy.dataset.copy} copiado`); } catch { toast(`Código: #${copy.dataset.copy}`); }
    }
    if (e.target.closest('[data-add-list]')) {
      shopping.addRecipe(R, factor());
      track('add_to_shopping_list', { item_id: R.code });
      toast(`🛒 ${R.ingredients.length} itens adicionados à lista de compras`);
    }
    if (e.target.closest('[data-print]')) { track('print', { item_id: R.code }); window.print(); }
    const cl = e.target.closest('[data-copy-link]');
    if (cl) {
      try { await navigator.clipboard.writeText(cl.dataset.copyLink); toast('🔗 Link copiado!'); } catch { prompt('Copie o link:', cl.dataset.copyLink); }
      track('share', { method: 'copy_link', item_id: R.code });
    }
    const em = e.target.closest('[data-embed]');
    if (em) {
      const code = `<iframe src="${location.origin}/embed/${em.dataset.embed}" width="100%" height="160" style="border:0;max-width:560px" loading="lazy" title="${R.title.replace(/"/g, '')}"></iframe>`;
      try { await navigator.clipboard.writeText(code); toast('📋 Código para incorporar copiado! Cole no seu site ou blog.'); } catch { prompt('Copie o código:', code); }
      track('share', { method: 'embed', item_id: R.code });
    }
    if (e.target.closest('[data-qr]')) {
      const d = $('.qr-dialog');
      $('img', d).src = `/qr/${R.code}.svg`;
      d.showModal();
    }
    if (e.target.closest('[data-close-dialog]')) e.target.closest('dialog').close();
    if (e.target.closest('[data-add-plan]')) openPlanPicker();
  });

  function openPlanPicker() {
    let d = $('.plan-dialog');
    if (!d) {
      d = document.createElement('dialog');
      d.className = 'plan-dialog';
      document.body.appendChild(d);
    }
    const days = [...Array(7)].map((_, i) => { const x = new Date(); x.setDate(x.getDate() + i); return x; });
    d.innerHTML = `<form method="dialog" class="pick-box"><h3>Adicionar ao cardápio</h3>
      <select name="day">${days.map((x, i) => `<option value="${dateKey(x)}">${i === 0 ? 'Hoje' : i === 1 ? 'Amanhã' : x.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric' })}</option>`).join('')}</select>
      <select name="meal"><option value="almoco">Almoço</option><option value="jantar">Jantar</option><option value="cafe">Café da manhã</option><option value="lanche">Lanche</option></select>
      <div><button class="btn" value="cancel">Cancelar</button> <button class="btn btn-primary" value="ok">Adicionar</button></div></form>`;
    d.onclose = () => {
      if (d.returnValue !== 'ok') return;
      const f = $('form', d);
      planner.add(f.day.value, f.meal.value, R);
      toast('📅 Adicionado ao cardápio');
    };
    d.showModal();
  }

  // ---------------- Comentários ----------------
  const cform = $('[data-comment-form]');
  cform?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(cform);
    try {
      const r = await api(`/recipes/${R.id}/comments`, { method: 'POST', body: Object.fromEntries(fd) });
      cform.reset();
      toast(r.pending ? '✅ Obrigado! Seu comentário será publicado após revisão.' : '✅ Comentário publicado!');
      if (!r.pending) setTimeout(() => location.reload(), 800);
    } catch (err) { toast(err.message); }
  });

  // =====================================================================
  //  MODO COZINHA — um passo por tela, swipe, timers, voz e tela sempre acesa
  // =====================================================================
  const cook = {
    open: false,
    el: $('.cook'),
    track: $('.cook-track'),
    idx: 0, // 0 = mise en place; 1..n = passos; n+1 = conclusão
    wakeLock: null,
    speaking: false,
    recog: null,
    get count() { return R.steps.length + 2; },

    /** Destaca no texto do passo as menções aos ingredientes (ignora acentos e plural). */
    highlight(text, ings) {
      const chars = [...text];
      const plain = chars.map((c) => (c.length > 1 ? '?' : c.normalize('NFD')[0].toLowerCase())).join('');
      const marks = new Array(chars.length).fill(0);
      for (const i of ings) {
        const name = R.ingredients[i]?.name || '';
        const word = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^a-z0-9]+/).find((w) => w.length > 2 && !['de', 'com', 'para'].includes(w));
        if (!word) continue;
        const base = word.length > 4 ? word.replace(/(es|s)$/, '') : word;
        const m = new RegExp(`(^|[^a-z0-9])(${base}[a-z]*)`).exec(plain);
        if (!m) continue;
        const from = m.index + m[1].length;
        for (let k = from; k < from + m[2].length; k++) marks[k] = 1;
      }
      let out = '';
      chars.forEach((c, k) => {
        if (marks[k] && !marks[k - 1]) out += '<mark>';
        out += esc(c);
        if (marks[k] && !marks[k + 1]) out += '</mark>';
      });
      return out;
    },

    render() {
      const f = factor();
      const ingRow = (i) => {
        const ing = R.ingredients[i];
        return `<div class="cook-ing${state.ings.includes(i) ? ' got' : ''}" data-cook-ing="${i}"><b>${esc(withDe(ing, qtyText(ing, f)))}</b> ${esc(ing.name)}${ing.note ? ` <small>(${esc(ing.note)})</small>` : ''}</div>`;
      };
      const cards = [];
      cards.push(`<section class="cook-card cook-intro"><span class="cook-step-label">Antes de começar</span><h2>${esc(R.title)}</h2>
        <p>Separe tudo (mise en place). Toque para marcar o que já está na bancada. Rendimento: <b>${fmtQty(state.servings)} ${esc(R.servings_unit)}</b>.</p>
        <div class="cook-checklist">${R.ingredients.map((_, i) => ingRow(i)).join('')}</div></section>`);
      R.steps.forEach((s, i) => {
        cards.push(`<section class="cook-card" data-card-step="${i}">
          <span class="cook-step-label">Passo ${i + 1} de ${R.steps.length}</span>${s.group ? `<span class="cook-group">${esc(s.group)}</span>` : ''}
          <p class="cook-text">${this.highlight(s.text, s.ings || [])}</p>
          ${s.image ? `<img src="${esc(s.image)}" alt="" loading="lazy">` : ''}
          ${s.ings?.length ? `<div class="cook-ings"><h4>Você vai usar</h4>${s.ings.map(ingRow).join('')}</div>` : ''}
          ${s.timer ? `<button class="timer-btn" data-timer="${s.timer}" data-timer-label="Passo ${i + 1}: ${esc(s.text.slice(0, 40))}">⏱️ Iniciar timer de ${window.Chef.fmtTime(s.timer)}</button>` : ''}
        </section>`);
      });
      const adTpl = $('[data-cook-done-ad]');
      cards.push(`<section class="cook-card cook-done"><div class="big">🎉</div><h2>Pronto! Bom apetite!</h2><p>Você concluiu <b>${esc(R.title)}</b>.</p>
        <p><button class="btn btn-primary btn-lg" data-cook-finish>Fiz esta receita!</button></p>
        <p><button class="btn btn-ghost" data-cook-rate>⭐ Avaliar</button> <button class="btn btn-ghost" data-share>Compartilhar</button></p>${adTpl ? adTpl.innerHTML : ''}</section>`);
      this.track.innerHTML = cards.join('');
      $('.cook-drawer ul').innerHTML = R.ingredients.map((ing, i) => `<li class="${state.ings.includes(i) ? 'got' : ''}"><b>${esc(withDe(ing, qtyText(ing, f)))}</b> ${esc(ing.name)}</li>`).join('');
      this.go(this.idx, false);
    },

    go(i, smooth = true) {
      this.idx = Math.max(0, Math.min(this.count - 1, i));
      this.track.scrollTo({ left: this.track.clientWidth * this.idx, behavior: smooth ? 'smooth' : 'instant' });
      this.paint();
    },

    paint() {
      const stepIdx = this.idx - 1;
      $('.cook-progress span', this.el).style.width = `${(this.idx / (this.count - 1)) * 100}%`;
      $('.cook-count', this.el).textContent = this.idx === 0 ? 'Início' : this.idx === this.count - 1 ? 'Fim' : `${this.idx}/${R.steps.length}`;
      $('[data-cook-prev]', this.el).disabled = this.idx === 0;
      const next = $('[data-cook-next]', this.el);
      next.innerHTML = this.idx === 0 ? 'Começar →' : this.idx === this.count - 2 ? 'Concluir ✓' : this.idx === this.count - 1 ? 'Fechar' : 'Próximo →';
      if (stepIdx >= 0 && stepIdx < R.steps.length) {
        state.current = stepIdx;
        for (let k = 0; k < stepIdx; k++) if (!state.steps.includes(k)) state.steps.push(k);
        save(); paintProgress();
      }
      if (this.speaking) this.speak();
    },

    next() {
      if (this.idx === this.count - 1) return this.close();
      if (this.idx >= 1 && this.idx <= R.steps.length && !state.steps.includes(this.idx - 1)) state.steps.push(this.idx - 1);
      this.go(this.idx + 1);
    },
    prev() { this.go(this.idx - 1); },

    async start(resume = false) {
      this.open = true;
      this.el.hidden = false;
      document.body.style.overflow = 'hidden';
      document.body.classList.add('cooking');
      this.idx = resume ? state.current + 1 : 0;
      this.render();
      history.pushState({ cook: true }, '', '#cozinhar');
      try { if ('wakeLock' in navigator) this.wakeLock = await navigator.wakeLock.request('screen'); } catch { /* sem suporte */ }
      try { if (window.innerWidth < 900 && document.documentElement.requestFullscreen && !matchMedia('(display-mode: standalone)').matches) await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); } catch { /* ignore */ }
    },

    close(fromPop = false) {
      this.open = false;
      this.el.hidden = true;
      document.body.style.overflow = '';
      document.body.classList.remove('cooking');
      this.stopVoice();
      this.stopListening();
      this.wakeLock?.release().catch(() => {});
      this.wakeLock = null;
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      if (!fromPop && location.hash === '#cozinhar') history.back();
      paintProgress();
    },

    // --- Leitura em voz alta ---
    speak() {
      if (!('speechSynthesis' in window)) return toast('Seu navegador não suporta leitura em voz alta');
      speechSynthesis.cancel();
      let text;
      if (this.idx === 0) text = `${R.title}. Separe os ingredientes: ${R.ingredients.map((i) => `${qtyText(i)} ${i.name}`).join('; ')}`;
      else if (this.idx === this.count - 1) text = 'Pronto! Bom apetite!';
      else text = `Passo ${this.idx}. ${R.steps[this.idx - 1].text}`;
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'pt-BR';
      u.rate = 0.95;
      const voice = speechSynthesis.getVoices().find((v) => v.lang?.toLowerCase().startsWith('pt-br')) || speechSynthesis.getVoices().find((v) => v.lang?.startsWith('pt'));
      if (voice) u.voice = voice;
      speechSynthesis.speak(u);
    },
    stopVoice() {
      this.speaking = false;
      if ('speechSynthesis' in window) speechSynthesis.cancel();
      $('[data-cook-voice]')?.classList.remove('on');
    },

    // --- Comandos de voz ("próximo", "voltar", "repetir", "timer", "ingredientes") ---
    listen() {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) return toast('Comandos de voz não são suportados neste navegador (use o Chrome)');
      const r = new SR();
      r.lang = 'pt-BR';
      r.continuous = true;
      r.interimResults = false;
      r.onresult = (ev) => {
        const said = ev.results[ev.results.length - 1][0].transcript.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        if (/proxim|avanc|seguinte|next/.test(said)) this.next();
        else if (/volt|anterior|back/.test(said)) this.prev();
        else if (/repet|de novo|ler|leia/.test(said)) this.speak();
        else if (/timer|cronometro|temporizador/.test(said)) { const b = $(`[data-card-step="${this.idx - 1}"] [data-timer]`, this.track); if (b) b.click(); else toast('Este passo não tem timer'); }
        else if (/ingrediente/.test(said)) $('.cook-drawer').hidden = !$('.cook-drawer').hidden;
        else if (/sair|fechar|parar/.test(said)) this.close();
        else return;
        toast(`🎙️ “${said}”`, 1500);
      };
      r.onend = () => { if (this.recog === r) { try { r.start(); } catch { /* ignore */ } } };
      r.onerror = (ev) => { if (ev.error === 'not-allowed') { toast('Permita o uso do microfone'); this.stopListening(); } };
      try { r.start(); } catch { /* ignore */ }
      this.recog = r;
      $('[data-cook-listen]').classList.add('on');
      toast('🎙️ Diga “próximo”, “voltar”, “repetir”, “timer” ou “ingredientes”', 4000);
    },
    stopListening() {
      const r = this.recog;
      this.recog = null;
      try { r?.stop(); } catch { /* ignore */ }
      $('[data-cook-listen]')?.classList.remove('on');
    },
  };

  if (cook.el) {
    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-cook-start]')) { cook.start(false); track('cook_mode_start', { item_id: R.code }); }
      if (e.target.closest('[data-cook-resume]')) cook.start(true);
      if (!cook.open) return;
      if (e.target.closest('[data-cook-close]')) cook.close();
      if (e.target.closest('[data-cook-next]')) cook.next();
      if (e.target.closest('[data-cook-prev]')) cook.prev();
      if (e.target.closest('[data-cook-ings]')) $('.cook-drawer').hidden = !$('.cook-drawer').hidden;
      if (e.target.closest('[data-cook-voice]')) {
        if (cook.speaking) cook.stopVoice();
        else { cook.speaking = true; e.target.closest('[data-cook-voice]').classList.add('on'); cook.speak(); }
      }
      if (e.target.closest('[data-cook-listen]')) { if (cook.recog) cook.stopListening(); else cook.listen(); }
      const ci = e.target.closest('[data-cook-ing]');
      if (ci) {
        const i = Number(ci.dataset.cookIng);
        state.ings = state.ings.includes(i) ? state.ings.filter((x) => x !== i) : [...state.ings, i];
        save();
        $$(`[data-cook-ing="${i}"]`).forEach((el) => el.classList.toggle('got', state.ings.includes(i)));
        paintProgress();
      }
      if (e.target.closest('[data-cook-finish]')) {
        state.steps = R.steps.map((_, i) => i);
        save();
        api(`/recipes/${R.id}/cooked`, { method: 'POST' }).catch(() => {});
        track('recipe_cooked', { item_id: R.code });
        const done = store.get('cookedLog', []);
        done.unshift({ id: R.id, slug: R.slug, title: R.title, at: Date.now() });
        store.set('cookedLog', done.slice(0, 200));
        toast('👩‍🍳 Parabéns! Anotado no seu histórico');
        setTimeout(() => { cook.close(); document.getElementById('comentarios')?.scrollIntoView({ behavior: 'smooth' }); }, 600);
      }
      if (e.target.closest('[data-cook-rate]')) { cook.close(); setTimeout(() => document.getElementById('comentarios')?.scrollIntoView({ behavior: 'smooth' }), 100); }
    });
    // Swipe nativo via scroll-snap: sincroniza o índice ao terminar a rolagem
    let st;
    cook.track.addEventListener('scroll', () => {
      clearTimeout(st);
      st = setTimeout(() => {
        const i = Math.round(cook.track.scrollLeft / cook.track.clientWidth);
        if (i !== cook.idx) { cook.idx = i; cook.paint(); }
      }, 120);
    }, { passive: true });
    document.addEventListener('keydown', (e) => {
      if (!cook.open) return;
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); cook.next(); }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); cook.prev(); }
      if (e.key === 'Escape') cook.close();
    });
    addEventListener('popstate', () => { if (cook.open) cook.close(true); });
    addEventListener('resize', () => { if (cook.open) cook.go(cook.idx, false); });
    document.addEventListener('visibilitychange', async () => {
      if (cook.open && document.visibilityState === 'visible' && 'wakeLock' in navigator) {
        try { cook.wakeLock = await navigator.wakeLock.request('screen'); } catch { /* ignore */ }
      }
    });
    // Ao terminar um timer no modo cozinha, lê o aviso em voz alta
    addEventListener('chef:timer-done', (e) => {
      if (cook.open && 'speechSynthesis' in window) {
        const u = new SpeechSynthesisUtterance(`Atenção! Timer finalizado: ${e.detail.label}`);
        u.lang = 'pt-BR';
        speechSynthesis.speak(u);
      }
    });
    if (location.hash === '#cozinhar') history.replaceState(null, '', location.pathname);
  }

  paintServings();
  paintProgress();
  void timers;
})();
