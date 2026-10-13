/* Chef — ferramentas offline: favoritos, lista de compras, cardápio, geladeira e conversor */
(() => {
  'use strict';
  const { $, $$, esc, store, toast, api, favs, paintFavs, shopping, planner, dateKey, fmtQty, unitLabel, share, density } = window.Chef;

  const miniCard = (r) => `<article class="card"><a class="card-link" href="/receita/${esc(r.slug)}"><div class="card-media">${r.cover ? `<img src="${esc(r.cover)}" alt="" loading="lazy">` : '<div class="ph"></div>'}</div><div class="card-body"><h3>${esc(r.title)}</h3></div></a>
    <button class="fav-btn" data-fav="${r.id}" data-slug="${esc(r.slug)}" data-title="${esc(r.title)}" data-cover="${esc(r.cover || '')}" aria-label="Favoritar"><svg class="ico" viewBox="0 0 24 24"><path d="M12 20s-7-4.4-9.2-8.6C1.1 8 3 4.5 6.6 4.5c2 0 3.4 1.1 4.4 2.5 1-1.4 2.4-2.5 4.4-2.5C19 4.5 20.9 8 19.2 11.4 17 15.6 12 20 12 20Z"/></svg></button></article>`;

  // ---------------- Favoritos ----------------
  const favGrid = $('[data-favorites]');
  if (favGrid) {
    const paint = () => {
      const list = favs.all();
      favGrid.innerHTML = list.map(miniCard).join('');
      $('[data-favorites-empty]').hidden = list.length > 0;
      paintFavs();
    };
    addEventListener('chef:store', (e) => { if (e.detail.key === 'favs') paint(); });
    paint();
  }

  // ---------------- Lista de compras ----------------
  const shopEl = $('[data-shopping]');
  if (shopEl) {
    const paint = () => {
      const list = shopping.all();
      if (!list.length) { shopEl.innerHTML = '<p class="empty">Sua lista está vazia. Abra uma receita e toque em 🛒 para adicionar os ingredientes.</p>'; return; }
      const groups = new Map();
      for (const it of list) {
        const g = it.recipe ? it.recipe.title : 'Outros itens';
        if (!groups.has(g)) groups.set(g, { recipe: it.recipe, items: [] });
        groups.get(g).items.push(it);
      }
      shopEl.innerHTML = [...groups].map(([title, g]) => `<section class="shop-group"><h3>${g.recipe ? `<a href="/receita/${esc(g.recipe.slug)}">${esc(title)}</a>` : esc(title)}<button class="link" data-remove-group="${esc(title)}">remover</button></h3>
        ${g.items.sort((a, b) => a.checked - b.checked).map((it) => `<div class="shop-item${it.checked ? ' checked' : ''}"><label><input type="checkbox" data-shop-check="${it.id}"${it.checked ? ' checked' : ''}><span>${it.quantity != null ? `<b>${fmtQty(it.quantity)}${it.unit ? ` ${esc(unitLabel(it.unit, it.quantity))} de` : ''}</b> ` : ''}${esc(it.name)}${it.sources?.length > 1 ? ` <small>(${it.sources.length} receitas)</small>` : ''}</span></label><button class="icon-btn" data-shop-remove="${it.id}" aria-label="Remover">✕</button></div>`).join('')}</section>`).join('');
    };
    shopEl.addEventListener('change', (e) => {
      const c = e.target.closest('[data-shop-check]');
      if (!c) return;
      const list = shopping.all();
      const it = list.find((x) => x.id === c.dataset.shopCheck);
      if (it) it.checked = c.checked;
      shopping.save(list);
    });
    document.addEventListener('click', (e) => {
      const r = e.target.closest('[data-shop-remove]');
      if (r) shopping.save(shopping.all().filter((x) => x.id !== r.dataset.shopRemove));
      const g = e.target.closest('[data-remove-group]');
      if (g) shopping.save(shopping.all().filter((x) => (x.recipe ? x.recipe.title : 'Outros itens') !== g.dataset.removeGroup));
      if (e.target.closest('[data-clear-checked]')) shopping.save(shopping.all().filter((x) => !x.checked));
      if (e.target.closest('[data-clear-list]') && confirm('Limpar toda a lista?')) shopping.save([]);
      if (e.target.closest('[data-share-list]')) {
        const text = shopping.all().filter((x) => !x.checked).map((x) => `☐ ${x.quantity != null ? `${fmtQty(x.quantity)}${x.unit ? ` ${unitLabel(x.unit, x.quantity)} de` : ''} ` : ''}${x.name}`).join('\n');
        share({ title: 'Lista de compras', text: `🛒 Lista de compras\n\n${text}`, url: '' });
      }
    });
    $('[data-add-item]').addEventListener('submit', (e) => {
      e.preventDefault();
      shopping.addText(e.target.item.value.trim());
      e.target.reset();
    });
    addEventListener('chef:store', (e) => { if (e.detail.key === 'shopping') paint(); });
    paint();
  }

  // ---------------- Cardápio semanal ----------------
  const planEl = $('[data-planner]');
  if (planEl) {
    const MEALS = [['cafe', 'Café da manhã'], ['almoco', 'Almoço'], ['lanche', 'Lanche'], ['jantar', 'Jantar']];
    let offset = 0;
    let picking = null;
    const weekStart = () => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offset * 7);
      return d;
    };
    const days = () => [...Array(7)].map((_, i) => { const d = weekStart(); d.setDate(d.getDate() + i); return d; });
    const paint = () => {
      const plan = planner.all();
      const today = dateKey(new Date());
      const ds = days();
      $('[data-week-label]').textContent = `${ds[0].toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })} – ${ds[6].toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })}`;
      planEl.innerHTML = ds.map((d) => {
        const k = dateKey(d);
        return `<div class="day${k === today ? ' today' : ''}"><h3><span>${d.toLocaleDateString('pt-BR', { weekday: 'long' })}</span><small>${d.getDate()}/${d.getMonth() + 1}</small></h3>
          ${MEALS.map(([m, label]) => `<div class="meal"><small>${label}</small>${(plan[k]?.[m] || []).map((r, i) => `<div class="meal-item">${r.cover ? `<img src="${esc(r.cover)}" alt="">` : ''}<a href="/receita/${esc(r.slug)}">${esc(r.title)}</a><button data-meal-remove="${k}|${m}|${i}" aria-label="Remover">✕</button></div>`).join('')}<button class="meal-add" data-meal-add="${k}|${m}">+ adicionar</button></div>`).join('')}</div>`;
      }).join('');
    };
    const dlg = $('.pick-dialog');
    const results = $('[data-pick-results]');
    const search = async (q) => {
      const items = q ? (await api(`/recipes?q=${encodeURIComponent(q)}&perPage=12`)).items : favs.all();
      results.innerHTML = items.map((r) => `<li><button type="button" data-pick='${esc(JSON.stringify({ id: r.id, slug: r.slug, title: r.title, cover: r.image || r.cover || '' }))}'>${r.image || r.cover ? `<img src="${esc(r.image || r.cover)}" alt="">` : ''}${esc(r.title)}</button></li>`).join('') || '<li class="empty">Busque uma receita (ou favorite algumas para aparecerem aqui)</li>';
    };
    document.addEventListener('click', (e) => {
      const w = e.target.closest('[data-week]');
      if (w) { offset += Number(w.dataset.week); paint(); }
      const a = e.target.closest('[data-meal-add]');
      if (a) { picking = a.dataset.mealAdd.split('|'); search(''); dlg.showModal(); $('[data-pick-search]').value = ''; $('[data-pick-search]').focus(); }
      const p = e.target.closest('[data-pick]');
      if (p && picking) { planner.add(picking[0], picking[1], JSON.parse(p.dataset.pick)); dlg.close(); paint(); }
      const rm = e.target.closest('[data-meal-remove]');
      if (rm) {
        const [k, m, i] = rm.dataset.mealRemove.split('|');
        const plan = planner.all();
        plan[k][m].splice(Number(i), 1);
        store.set('plan', plan);
        paint();
      }
    });
    let t;
    $('[data-pick-search]').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => search(e.target.value.trim()).catch(() => {}), 200); });
    $('[data-plan-to-list]').addEventListener('click', async () => {
      const plan = planner.all();
      const refs = days().flatMap((d) => Object.values(plan[dateKey(d)] || {}).flat());
      if (!refs.length) return toast('Adicione receitas ao cardápio primeiro');
      let ok = 0;
      for (const ref of refs) {
        try { shopping.addRecipe(await api(`/recipes/${ref.id}`)); ok++; } catch { /* offline */ }
      }
      toast(`🛒 Ingredientes de ${ok} receitas adicionados à lista`);
    });
    paint();
  }

  // ---------------- O que tem na geladeira ----------------
  const fridge = $('[data-fridge]');
  if (fridge) {
    let chips = store.get('fridge', []);
    const input = $('[data-fridge-input]');
    const paintChips = () => {
      $('[data-fridge-chips]').innerHTML = chips.map((c, i) => `<button type="button" class="chip" data-fridge-rm="${i}">${esc(c)} ✕</button>`).join('');
      store.set('fridge', chips);
    };
    const add = (v) => {
      for (const part of String(v).split(',').map((x) => x.trim()).filter(Boolean)) if (!chips.includes(part.toLowerCase())) chips.push(part.toLowerCase());
      input.value = '';
      paintChips();
    };
    const run = async () => {
      if (input.value.trim()) add(input.value);
      const out = $('[data-fridge-results]');
      if (!chips.length) { out.innerHTML = ''; return; }
      out.innerHTML = '<p class="empty">Procurando…</p>';
      // Busca com todos; se não houver resultado, tenta combinações menores
      let res = await api(`/recipes?ingredients=${encodeURIComponent(chips.join(','))}&perPage=24`);
      let partial = false;
      if (!res.items.length && chips.length > 1) {
        const seen = new Map();
        for (const c of chips) for (const r of (await api(`/recipes?ingredients=${encodeURIComponent(c)}&perPage=24`)).items) seen.set(r.id, { r, n: (seen.get(r.id)?.n || 0) + 1 });
        res = { items: [...seen.values()].sort((a, b) => b.n - a.n).map((x) => x.r) };
        partial = true;
      }
      out.innerHTML = res.items.length
        ? `<p class="result-count">${partial ? 'Nenhuma receita usa todos — estas usam parte do que você tem:' : `${res.items.length} receitas com ${chips.join(', ')}`}</p><div class="grid">${res.items.map(miniCard).join('')}</div>`
        : '<p class="empty">Nada encontrado com esses ingredientes 😕</p>';
      paintFavs();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); if (input.value.trim()) add(input.value); else run(); }
      if (e.key === 'Backspace' && !input.value && chips.length) { chips.pop(); paintChips(); }
    });
    fridge.addEventListener('submit', (e) => { e.preventDefault(); run().catch((err) => toast(err.message)); });
    document.addEventListener('click', (e) => {
      const a = e.target.closest('[data-fridge-add]');
      if (a) { add(a.dataset.fridgeAdd); run().catch(() => {}); }
      const r = e.target.closest('[data-fridge-rm]');
      if (r) { chips.splice(Number(r.dataset.fridgeRm), 1); paintChips(); run().catch(() => {}); }
    });
    if (input.value) add(input.value);
    paintChips();
    if (chips.length) run().catch(() => {});
  }

  // ---------------- Conversor de medidas ----------------
  const conv = $('[data-converter]');
  if (conv) {
    const ING = ['água / leite', 'óleo', 'farinha de trigo', 'açúcar', 'açúcar mascavo', 'açúcar de confeiteiro', 'chocolate em pó', 'cacau em pó', 'manteiga', 'amido de milho', 'fubá', 'aveia', 'arroz', 'coco ralado', 'leite em pó', 'queijo ralado', 'mel', 'sal', 'fermento'];
    conv.ingredient.innerHTML = ING.map((i) => `<option>${i}</option>`).join('');
    const ML = { 'xícara': 240, 'colher de sopa': 15, 'colher de chá': 5, copo: 200, ml: 1 };
    const out = $('[data-converter-out]');
    const calc = () => {
      const amount = Number(conv.amount.value) || 0;
      const dens = density(conv.ingredient.value) || (/oleo|óleo/.test(conv.ingredient.value) ? 0.9 : 1);
      const unit = conv.unit.value;
      const ml = unit === 'g' ? amount / dens : amount * ML[unit];
      const g = ml * dens;
      const cups = ml / 240;
      out.innerHTML = `≈ <b>${Math.round(g)} g</b> · <b>${Math.round(ml)} ml</b> · <b>${fmtQty(cups)}</b> xícara · <b>${fmtQty(ml / 15)}</b> colher (sopa)`;
    };
    conv.addEventListener('input', calc);
    calc();
  }
})();
