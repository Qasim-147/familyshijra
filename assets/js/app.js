/* app.js — the shijra website: hero, interactive tree, profiles, relation finder, submissions,
   admin review with full add / edit / delete, feature switches and the helper bot.
   Talks to data only through `store` (store-supabase.js on the real site, store-claude.js in the demo). */
(function () {
  'use strict';
  const F = window.Family;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX'];
  const roman = (n) => ROMAN[n] || String(n);
  const icon = (id) => `<svg aria-hidden="true"><use href="#${id}"/></svg>`;
  const pattern = () => '<div class="hero-pattern" aria-hidden="true"><svg><rect width="100%" height="100%" fill="url(#girih)"/></svg></div>';
  const ls = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } } };

  const DEFAULTS = {
    site_title: 'Family Shijra',
    site_title_local: 'شجرۂ نسب',
    tagline: 'Generations, connected',
    about: '',
    root_id: null,
    submissions_open: true,
    allow_photos: true,
    require_email: true,
    require_phone: false,
    bot_enabled: true,
    bot_teaser: true,
    bot_welcome: 'Assalam-o-Alaikum! I can help you find relatives, explain how two people are related, and add your family to the shijra.',
    search_enabled: true,
    relationship_finder: true,
    show_local_terms: true,
    show_living_dates: false,
    show_spouses: true,
    show_generation: true,
    show_founders: true,
    show_elders: true,
    show_recent: true,
    show_how: true,
    default_depth: 2,
    default_view: 'icons',
    hero_image: '',
    announcement: '',
  };

  const S = {
    store: null, people: [], allPeople: [], idx: F.buildIndex([]), settings: { ...DEFAULTS }, subs: [],
    isAdmin: false, canSubmit: false, setupMode: false, previewVisitor: false,
    rootId: null, expanded: new Set(), justOpened: null, view: { x: 0, y: 0, k: 1 }, highlight: null, firstRender: true,
    openProfileId: null, adminTab: 'pending', adminOpen: false, meId: ls.get('shijra-me'), relA: null, relB: null,
  };
  const admin = () => S.isAdmin && !S.previewVisitor;
  const HERO_DEFAULT = document.getElementById('heroImg') ? document.getElementById('heroImg').getAttribute('src') : '';
  const isPrivate = (p) => !admin() && !S.settings.show_living_dates && F.isLiving(p);
  const localOn = () => S.settings.show_local_terms !== false;

  // ---------- small UI helpers ----------
  function portraitHTML(p, size = '') {
    const cls = `portrait ${size}`;
    if (p && p.photo_url) return `<div class="${cls}"><img src="${esc(p.photo_url)}" alt="${esc(F.fullName(p))}" loading="lazy"></div>`;
    return `<div class="${cls}" aria-hidden="true">${esc(F.initials(p))}</div>`;
  }
  const avatarHTML = portraitHTML; // used by bot.js
  function toast(msg) {
    const host = $('#toastHost');
    host.innerHTML = `<div class="toast" role="status">${esc(msg)}</div>`;
    clearTimeout(toast.t); toast.t = setTimeout(() => { host.innerHTML = ''; }, 3200);
  }
  function confirmBox(title, body, okLabel = 'Delete') {
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.className = 'modal-wrap';
      wrap.innerHTML = `<div class="modal confirm" role="alertdialog" aria-modal="true" aria-labelledby="cfTitle" style="width:min(440px,100%)">
        <div class="modal-head"><h2 id="cfTitle">${esc(title)}</h2></div>
        <div class="modal-body"><p>${esc(body)}</p></div>
        <div class="modal-foot"><button class="btn" data-r="0" type="button">Cancel</button><button class="btn danger solid" data-r="1" type="button">${esc(okLabel)}</button></div></div>`;
      document.body.appendChild(wrap);
      wrap.addEventListener('click', (e) => {
        const b = e.target.closest('[data-r]');
        if (b || e.target === wrap) { wrap.remove(); resolve(!!(b && b.dataset.r === '1')); }
      });
      $('[data-r="1"]', wrap).focus();
    });
  }
  async function compressImage(file, max) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.82));
    } finally { URL.revokeObjectURL(url); }
  }
  /** Relation of person `id` to the viewer ("Your Dada"), or null. */
  const relCache = new Map();
  function relToMe(id) {
    if (!S.meId || !S.idx.byId.has(S.meId) || id === S.meId) return null;
    if (relCache.has(id)) return relCache.get(id);
    const r = F.relationship(S.idx, S.meId, id);
    const out = r && r.path.length ? { word: (localOn() && r.local) || r.label.replace(/ \((paternal|maternal) side\)$/, ''), r } : null;
    relCache.set(id, out); return out;
  }
  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

  // ---------- data ----------
  function setPeople(list) {
    S.allPeople = list.map((p) => ({ ...p, spouse_ids: p.spouse_ids || [] }));
    applyVisibility();
  }
  function applyVisibility() {
    S.people = admin() ? S.allPeople : S.allPeople.filter((p) => p.visible !== false);
    S.idx = F.buildIndex(S.people);
    relCache.clear();
    if (S.rootId && !S.idx.byId.has(S.rootId)) S.rootId = null;
    if (S.meId && !S.idx.byId.has(S.meId) && S.people.length) { S.meId = null; ls.set('shijra-me', null); }
    renderAll();
    if (S.openProfileId) { if (S.idx.byId.has(S.openProfileId)) openProfile(S.openProfileId, { keepHash: true }); else closeDrawer(); }
    if (S.adminOpen) renderAdmin();
    updateBadge();
  }
  function currentRoot() {
    if (S.rootId && S.idx.byId.has(S.rootId)) return S.rootId;
    if (S.settings.root_id && S.idx.byId.has(S.settings.root_id)) return S.settings.root_id;
    return F.autoRoot(S.idx);
  }
  function familyRoot() {
    if (S.settings.root_id && S.idx.byId.has(S.settings.root_id)) return S.settings.root_id;
    return F.autoRoot(S.idx);
  }
  function generationOf(id, seenSp = new Set()) {
    let gen = 1; let cur = S.idx.byId.get(id); const seen = new Set();
    while (cur && !seen.has(cur.id)) { seen.add(cur.id); const up = S.idx.byId.get(cur.father_id) || S.idx.byId.get(cur.mother_id); if (!up) break; gen++; cur = up; }
    // someone who married in takes their partner's generation
    if (gen === 1 && !seenSp.has(id)) {
      seenSp.add(id);
      for (const s of F.spouses(S.idx, id)) if (S.idx.byId.get(s.father_id) || S.idx.byId.get(s.mother_id)) return generationOf(s.id, seenSp);
    }
    return gen;
  }
  function renderAll() {
    renderHero(); renderExplorer(); renderTree(); renderElders(); renderRelate(); renderRecent();
  }

  // ---------- header / settings ----------
  function applySettings() {
    const s = S.settings;
    const title = s.site_title || DEFAULTS.site_title;
    $('#navTitle').textContent = title; $('#heroTitle').textContent = title; $('#footTitle').textContent = title;
    $('#heroLocal').textContent = s.site_title_local || ''; $('#heroLocal').hidden = !s.site_title_local;
    $('#footLocal').textContent = s.site_title_local || '';
    $('#heroTagline').textContent = s.tagline || '';
    $('#searchBox').hidden = !s.search_enabled;
    const canAdd = s.submissions_open || admin();
    $('#addBtn').hidden = !canAdd; $('#heroAdd').hidden = !canAdd;
    $('#heroBot').hidden = !s.bot_enabled;
    $('#elders').hidden = !s.show_elders; $('#relations').hidden = !s.relationship_finder; $('#how').hidden = !s.show_how;
    $$('[data-sec="elders"]').forEach((a) => { a.hidden = !s.show_elders; });
    $$('[data-sec="relations"]').forEach((a) => { a.hidden = !s.relationship_finder; });
    $$('[data-sec="how"]').forEach((a) => { a.hidden = !s.show_how; });
    $$('#how .band').forEach((b) => { b.hidden = !canAdd; });
    $('#founders').hidden = !s.show_founders;
    $('#heroImg').src = s.hero_image || HERO_DEFAULT;
    document.title = s.tagline ? `${title} – ${s.tagline}` : title;
    const parts = [];
    if (S.setupMode) parts.push('<strong>Setup preview:</strong> not connected to Supabase yet, so changes stay in this browser.');
    if (S.previewVisitor) parts.push('<strong>Viewing as a visitor.</strong> <button class="btn sm" type="button" data-action="exit-preview">Back to admin view</button>');
    if (admin() && S.allPeople.some((p) => p.sample)) parts.push('<strong>Sample family:</strong> example names for the demo. Remove them in Admin → Data.');
    if (s.announcement) parts.push(esc(s.announcement));
    $('#bannerIn').innerHTML = parts.map((x) => `<span>${x}</span>`).join('');
    $('#banner').hidden = !parts.length;
    renderBot();
  }
  function updateBadge() {
    const n = S.subs.filter((x) => x.status === 'pending').length;
    const b = $('#pendingBadge');
    b.textContent = n; b.hidden = !(admin() && n);
  }

  // ---------- hero ----------
  function renderHero() {
    const n = S.people.length;
    const root = familyRoot();
    let gens = 0;
    const depth = (id, seen = new Set()) => { if (seen.has(id)) return 0; seen.add(id); let m = 0; for (const c of S.idx.children.get(id) || []) m = Math.max(m, depth(c, seen)); return m + 1; };
    for (const p of S.people) if (!S.idx.byId.has(p.father_id) && !S.idx.byId.has(p.mother_id)) gens = Math.max(gens, depth(p.id));
    const cities = new Set(S.people.flatMap((p) => [p.birth_place, isPrivate(p) ? null : p.current_place]).filter(Boolean).map((c) => c.trim().toLowerCase()));
    $('#heroFacts').innerHTML = n
      ? `<b>${n}</b> family members across <b>${gens}</b> generation${gens === 1 ? '' : 's'}, from <b>${cities.size}</b> cit${cities.size === 1 ? 'y' : 'ies'}.`
      : 'Be the first to add a name to the family tree.';
    const f = $('#founders');
    const p = root && S.idx.byId.get(root);
    if (!p) { f.innerHTML = ''; return; }
    const sp = F.spouses(S.idx, root)[0];
    const nm = (x) => esc(x.nickname || F.shortName(x));
    f.innerHTML = `<button class="founders-card" type="button" data-action="xp-go" data-id="${esc(p.id)}" aria-label="Open the family of ${esc(F.fullName(p))}"><span class="pair">${portraitHTML(p, 'sm')}${sp ? portraitHTML(sp, 'sm') : ''}</span><span><small>The family begins with</small><b>${nm(p)}${sp ? ` &amp; ${nm(sp)}` : ''}</b></span></button>`;
  }

  // ---------- tree ----------
  const stage = $('#stage'), canvas = $('#canvas'), treeEl = $('#tree-root'), stageWrap = $('#stageWrap');

  function expandToDepth(rootId, depth) {
    const walk = (id, d, seen) => {
      if (d >= depth || seen.has(id)) return; seen.add(id);
      if ((S.idx.children.get(id) || []).length) S.expanded.add(id);
      for (const c of S.idx.children.get(id) || []) walk(c, d + 1, seen);
    };
    walk(rootId, 0, new Set());
  }

  function nodeHTML(p, gen, opts = {}) {
    const hideDates = isPrivate(p);
    const cls = ['node', p.gender === 'male' ? 'male' : p.gender === 'female' ? 'female' : '', p.visible === false ? 'hidden-person' : '', S.highlight === p.id ? 'highlight' : '', S.meId === p.id ? 'is-me' : ''].join(' ');
    let up = '';
    const hasParents = S.idx.byId.has(p.father_id) || S.idx.byId.has(p.mother_id);
    if (opts.showUp && hasParents) up = `<button class="btn sm up" type="button" data-action="up" data-id="${esc(p.id)}" title="Show parents">Parents ↑</button>`;
    else if (opts.spouse && hasParents) up = `<button class="btn sm up" type="button" data-action="up" data-id="${esc(p.id)}" title="Show ${esc(F.shortName(p))}'s own family">Family ↑</button>`;
    const me = relToMe(p.id);
    const you = S.meId === p.id ? '<span class="you">You</span>' : me ? `<span class="you">Your ${esc(me.word)}</span>` : '';
    const tools = admin() ? `<div class="node-tools">
        <button type="button" data-action="n-edit" data-id="${esc(p.id)}" aria-label="Edit ${esc(F.shortName(p))}" title="Edit">${icon('i-edit')}</button>
        <button type="button" data-action="n-add" data-id="${esc(p.id)}" aria-label="Add a relative of ${esc(F.shortName(p))}" title="Add relative">${icon('i-plus')}</button>
        <button type="button" class="del" data-action="n-del" data-id="${esc(p.id)}" aria-label="Delete ${esc(F.shortName(p))}" title="Delete">${icon('i-trash')}</button></div>` : '';
    return `<div class="${cls}" data-id="${esc(p.id)}" role="button" tabindex="0" aria-label="${esc(F.fullName(p))}">
      ${up}${S.settings.show_generation && !opts.spouse ? `<span class="gen" title="Generation ${gen}">${roman(gen)}</span>` : ''}
      ${portraitHTML(p)}
      <div class="name">${esc(F.shortName(p))}</div>
      <div class="years">${esc(F.years(p, hideDates)) || '&nbsp;'}</div>${you}${tools}
    </div>`;
  }

  function branchHTML(id, gen, seen, isRoot) {
    const p = S.idx.byId.get(id);
    if (!p || seen.has(id)) return '';
    seen.add(id);
    const spouses = S.settings.show_spouses ? F.spouses(S.idx, id) : [];
    const kids = S.idx.children.get(id) || [];
    const open = S.expanded.has(id);
    let html = `<li><div class="couple ${admin() ? 'has-tools' : ''}">${nodeHTML(p, gen, { showUp: isRoot })}`;
    for (const s of spouses) html += `<svg class="knot" aria-label="married"><use href="#i-knot"/></svg>${nodeHTML(s, gen, { spouse: true })}`;
    html += '</div>';
    if (kids.length) {
      html += `<button class="expand ${open ? 'open' : ''}" type="button" data-action="toggle" data-id="${esc(id)}" aria-expanded="${open}">${open ? 'Hide' : 'Show'} ${kids.length} ${kids.length === 1 ? 'child' : 'children'}</button>`;
      if (open) {
        html += `<ul class="${S.justOpened === id ? 'grow' : ''}">`;
        for (const k of kids) html += branchHTML(k, gen + 1, seen, false);
        html += '</ul>';
      }
    }
    return html + '</li>';
  }

  function renderTree(anchorId) {
    if (xpView() !== 'chart') return;
    const empty = !S.people.length;
    $('#emptyState').hidden = !empty;
    const btn = $('#emptyState [data-action="add"]');
    if (btn) btn.hidden = !S.settings.submissions_open && !admin();
    if (empty) { treeEl.innerHTML = ''; return; }
    const root = currentRoot();
    let before = null;
    if (anchorId) { const el = treeEl.querySelector(`.node[data-id="${CSS.escape(anchorId)}"]`); if (el) before = el.getBoundingClientRect(); }
    if (S.firstRender) expandToDepth(root, Math.max(1, Number(S.settings.default_depth) || 2));
    treeEl.innerHTML = branchHTML(root, generationOf(root), new Set(), true);
    S.justOpened = null;
    if (S.firstRender) { S.firstRender = false; requestAnimationFrame(() => fit(true)); return; }
    if (before) {
      const el = treeEl.querySelector(`.node[data-id="${CSS.escape(anchorId)}"]`);
      if (el) { const after = el.getBoundingClientRect(); S.view.x += before.left - after.left; S.view.y += before.top - after.top; applyView(); }
    }
  }

  // pan & zoom
  function applyView() { canvas.style.transform = `translate(${S.view.x}px, ${S.view.y}px) scale(${S.view.k})`; }
  function zoomAt(px, py, factor) {
    const k2 = Math.min(2.2, Math.max(0.15, S.view.k * factor));
    S.view.x = px - (px - S.view.x) * (k2 / S.view.k);
    S.view.y = py - (py - S.view.y) * (k2 / S.view.k);
    S.view.k = k2; applyView();
  }
  function fit(initial) {
    const w = canvas.offsetWidth, h = canvas.offsetHeight, sw = stage.clientWidth, sh = stage.clientHeight;
    if (!w || !h) return;
    const k = Math.max(0.2, Math.min(1, sw / w, sh / h));
    if (initial === true && k < 0.55) {
      S.view = { k: sw < 700 ? 0.66 : Math.min(0.85, Math.max(0.62, sw / w)), x: 0, y: 0 }; applyView();
      const top = treeEl.querySelector('.couple');
      if (top) {
        const r = top.getBoundingClientRect(), sr = stage.getBoundingClientRect();
        S.view.x = sw / 2 - (r.left - sr.left + r.width / 2);
        S.view.y = 30 - (r.top - sr.top) + 20;
      }
      applyView(); return;
    }
    S.view = { k, x: (sw - w * k) / 2, y: Math.max(0, (sh - h * k) / 2 * 0.5) };
    applyView();
  }
  function centerOn(id) {
    const el = treeEl.querySelector(`.node[data-id="${CSS.escape(id)}"]`);
    if (!el) return;
    const sr = stage.getBoundingClientRect();
    let r = el.getBoundingClientRect();
    if (S.view.k < 0.6) { zoomAt(r.left + r.width / 2 - sr.left, r.top + r.height / 2 - sr.top, 0.85 / S.view.k); r = el.getBoundingClientRect(); }
    const wide = window.innerWidth > 640 && S.openProfileId;
    const targetX = wide ? Math.max(sr.width - 440, sr.width * 0.4) / 2 : sr.width / 2;
    const targetY = window.innerWidth > 640 ? sr.height / 2 : sr.height * 0.3;
    S.view.x += targetX - (r.left - sr.left + r.width / 2);
    S.view.y += targetY - (r.top - sr.top + r.height / 2);
    applyView();
  }
  (function setupPanZoom() {
    const pts = new Map(); let moved = 0; let last = null; let pinch = null;
    stage.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button, a, input')) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2 && e.pointerType !== 'mouse') { try { for (const k of pts.keys()) stage.setPointerCapture(k); } catch (err) { /* ignore */ } }
      moved = 0; last = { x: e.clientX, y: e.clientY };
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) }; }
    });
    stage.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2 && pinch) {
        const [a, b] = [...pts.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
        const sr = stage.getBoundingClientRect();
        zoomAt((a.x + b.x) / 2 - sr.left, (a.y + b.y) / 2 - sr.top, d / pinch.d); pinch.d = d; moved += 10; return;
      }
      const dx = e.clientX - last.x, dy = e.clientY - last.y; last = { x: e.clientX, y: e.clientY };
      moved += Math.abs(dx) + Math.abs(dy);
      if (moved > 4 && !stage.classList.contains('dragging')) { stage.classList.add('dragging'); try { stage.setPointerCapture(e.pointerId); } catch (err) { /* released */ } }
      S.view.x += dx; S.view.y += dy; applyView();
    });
    const end = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (!pts.size) stage.classList.remove('dragging'); if (pts.size === 1) last = [...pts.values()][0]; };
    stage.addEventListener('pointerup', end); stage.addEventListener('pointercancel', end);
    stage.addEventListener('click', (e) => { if (moved > 6) { e.stopPropagation(); e.preventDefault(); moved = 0; } }, true);
    let hintT;
    stage.addEventListener('wheel', (e) => {
      const full = XP.max;
      if (!(e.ctrlKey || e.metaKey || full)) {
        if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) { e.preventDefault(); S.view.x -= e.deltaX; applyView(); return; }
        const h = $('#stageHint'); h.textContent = /Mac/.test(navigator.platform) ? 'Hold ⌘ and scroll to zoom, or maximize the window' : 'Hold Ctrl and scroll to zoom, or maximize the window';
        h.hidden = false; clearTimeout(hintT); hintT = setTimeout(() => { h.hidden = true; }, 1300);
        return; // let the page scroll
      }
      e.preventDefault();
      const sr = stage.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) zoomAt(e.clientX - sr.left, e.clientY - sr.top, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
      else { S.view.x -= e.deltaX; applyView(); }
    }, { passive: false });
    $('#zoomIn').onclick = () => zoomAt(stage.clientWidth / 2, stage.clientHeight / 2, 1.25);
    $('#zoomOut').onclick = () => zoomAt(stage.clientWidth / 2, stage.clientHeight / 2, 0.8);
    $('#zoomFit').onclick = () => fit();
    $('#expandAll').onclick = () => {
      const root = currentRoot(); const allOpen = $('#expandAll').dataset.open === '1';
      if (allOpen) { S.expanded.clear(); expandToDepth(root, 1); $('#expandAll').textContent = 'Open all'; $('#expandAll').dataset.open = '0'; }
      else { expandToDepth(root, 99); $('#expandAll').textContent = 'Close all'; $('#expandAll').dataset.open = '1'; }
      renderTree(); requestAnimationFrame(() => fit());
    };
  })();

  /** Find the chain of tree nodes from the root to the node that shows `id` (as a person or as a spouse). */
  function displayPath(rootId, id) {
    const seen = new Set();
    const walk = (cur) => {
      if (seen.has(cur)) return null; seen.add(cur);
      if (cur === id || (S.settings.show_spouses && (S.idx.spouses.get(cur) || new Set()).has(id))) return [cur];
      for (const k of S.idx.children.get(cur) || []) { const r = walk(k); if (r) return [cur, ...r]; }
      return null;
    };
    return walk(rootId);
  }
  function chartReveal(id) {
    if (!S.idx.byId.has(id) || xpView() !== 'chart') return;
    let path = displayPath(currentRoot(), id);
    if (!path) { S.rootId = F.topAncestor(S.idx, id); path = displayPath(S.rootId, id) || [S.rootId]; }
    path.slice(0, -1).forEach((x) => S.expanded.add(x));
    S.highlight = id;
    renderTree();
    requestAnimationFrame(() => centerOn(id));
    clearTimeout(reveal.t); reveal.t = setTimeout(() => { S.highlight = null; const el = treeEl.querySelector('.node.highlight'); if (el) el.classList.remove('highlight'); }, 4000);
  }

  treeEl.addEventListener('click', (e) => {
    const act = e.target.closest('[data-action]');
    if (act) {
      const id = act.dataset.id;
      switch (act.dataset.action) {
        case 'toggle':
          if (S.expanded.has(id)) S.expanded.delete(id); else { S.expanded.add(id); S.justOpened = id; }
          renderTree(id); return;
        case 'up': {
          const p = S.idx.byId.get(id);
          const parent = S.idx.byId.get(p.father_id) || S.idx.byId.get(p.mother_id);
          if (parent) { xpGo(parent.id, { select: p.id }); chartReveal(p.id); }
          return;
        }
        case 'n-edit': openEditor(id); return;
        case 'n-add': openRelChooser(id); return;
        case 'n-del': askDelete(id); return;
        default:
      }
    }
    const node = e.target.closest('.node');
    if (node) openProfile(node.dataset.id);
  });
  treeEl.addEventListener('keydown', (e) => {
    const node = e.target.closest('.node');
    if (node && e.target === node && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openProfile(node.dataset.id); }
  });

  // ---------- family explorer (file-explorer style window) ----------
  const XP = {
    folder: null, sel: null, mode: 'folder', query: '', back: [], fwd: [], open: new Set(), shut: new Set(),
    sort: { key: null, dir: 1 }, view: ls.get('shijra-view'), nav: ls.get('shijra-nav') !== '0', details: ls.get('shijra-details') !== '0',
    max: false, min: false, navMobile: false, started: false,
  };
  const xp = $('#xp'), xpContent = $('#xpContent'), xpMain = $('#xpMain'), xpNav = $('#xpNav');
  const touchy = () => matchMedia('(hover: none)').matches;
  const narrow = () => window.innerWidth <= 760;
  const ico = (id) => `<svg aria-hidden="true"><use href="#${id}"/></svg>`;
  function xpView() {
    const v = ['icons', 'details', 'chart'].includes(XP.view) ? XP.view : (S.settings.default_view || 'icons');
    return v === 'chart' && XP.mode !== 'folder' ? 'details' : v;
  }
  const hasParentsIn = (p) => S.idx.byId.has(p.father_id) || S.idx.byId.has(p.mother_id);
  const kidsOf = (id) => S.idx.children.get(id) || [];
  const spOf = (id) => (S.settings.show_spouses ? F.spouses(S.idx, id) : []);
  const isFull = (id) => kidsOf(id).length > 0 || spOf(id).length > 0;
  function scrollInto(el, box) {
    if (!el || !box) return;
    const er = el.getBoundingClientRect(), br = box.getBoundingClientRect();
    if (er.top < br.top + 30) box.scrollTop -= br.top - er.top + 36;
    else if (er.bottom > br.bottom) box.scrollTop += er.bottom - br.bottom + 8;
  }

  let rootsCache = { idx: null, pref: null, list: [], set: new Set() };
  /** Top-level family folders: founders without parents in the tree (a married-in spouse lives in the partner's folder). */
  function xpRoots() {
    if (rootsCache.idx === S.idx && rootsCache.pref === S.settings.root_id) return rootsCache.list;
    const idx = S.idx; const taken = new Set(); const out = []; const pref = S.settings.root_id;
    const cand = idx.people.filter((p) => !hasParentsIn(p)).map((p) => ({ p, n: F.countDescendants(idx, p.id) }))
      .sort((a, b) => (b.p.id === pref) - (a.p.id === pref) || b.n - a.n || (a.p.gender === 'male' ? -1 : b.p.gender === 'male' ? 1 : 0) || F.fullName(a.p).localeCompare(F.fullName(b.p)));
    for (const { p } of cand) {
      if (taken.has(p.id)) continue;
      const sp = F.spouses(idx, p.id);
      if (sp.some(hasParentsIn)) continue;
      out.push(p); taken.add(p.id); sp.forEach((s) => taken.add(s.id));
    }
    rootsCache = { idx, pref, list: out, set: new Set(out.map((p) => p.id)) };
    return out;
  }
  /** The folder a person lives in: their father's (or mother's), or their partner's if they married in, or Home. */
  function homeOf(id) {
    const p = S.idx.byId.get(id); if (!p) return null;
    if (S.idx.byId.has(p.father_id)) return p.father_id;
    if (S.idx.byId.has(p.mother_id)) return p.mother_id;
    xpRoots();
    if (rootsCache.set.has(id)) return null;
    const sp = F.spouses(S.idx, id);
    const best = sp.find(hasParentsIn) || sp.find((s) => rootsCache.set.has(s.id)) || sp[0];
    return best ? best.id : null;
  }
  function xpPath(id) { const out = []; const seen = new Set(); let c = id; while (c && !seen.has(c)) { seen.add(c); out.unshift(c); c = homeOf(c); } return out; }
  const pathText = (id) => ['Home', ...xpPath(id).map((x) => F.shortName(S.idx.byId.get(x)))].join(' › ');

  function folderIcon(p, size = '') {
    const g = p.gender === 'male' || p.gender === 'female' ? p.gender : '';
    const badge = size === 'sm' || size === 'xs' ? '' : `<span class="bd">${p.photo_url ? `<img src="${esc(p.photo_url)}" alt="" loading="lazy">` : esc(F.initials(p))}</span>`;
    return `<span class="xp-fi ${size} ${g}" aria-hidden="true"><svg viewBox="0 0 64 52"><path class="fb" d="M3 8.5A4.5 4.5 0 0 1 7.5 4h13.2a4 4 0 0 1 2.9 1.2L28 9.6h28.5A4.5 4.5 0 0 1 61 14.1v29.4a4.5 4.5 0 0 1-4.5 4.5h-49A4.5 4.5 0 0 1 3 43.5z"/>${isFull(p.id) ? '<rect class="fp" x="8" y="11" width="48" height="20" rx="2"/>' : ''}<path class="ff" d="M2 20.5A4.5 4.5 0 0 1 6.5 16h51a4.5 4.5 0 0 1 4.5 4.5v23a4.5 4.5 0 0 1-4.5 4.5h-51A4.5 4.5 0 0 1 2 43.5z"/></svg>${badge}</span>`;
  }
  /** How `p` is related to the folder owner: Wife, Son… (with the family word when enabled). */
  function xpRel(owner, p) {
    if (!owner) return '';
    const L = localOn();
    if ((S.idx.spouses.get(owner) || new Set()).has(p.id)) return p.gender === 'female' ? (L ? 'Biwi · Wife' : 'Wife') : p.gender === 'male' ? (L ? 'Shohar · Husband' : 'Husband') : 'Spouse';
    if (p.father_id === owner || p.mother_id === owner) return p.gender === 'female' ? (L ? 'Beti · Daughter' : 'Daughter') : p.gender === 'male' ? (L ? 'Beta · Son' : 'Son') : 'Child';
    return '';
  }
  function contentsText(id) {
    const k = kidsOf(id).length, s = spOf(id).length;
    if (k) return `${k} ${k === 1 ? 'child' : 'children'}`;
    if (s) return `${s} spouse${s === 1 ? '' : 's'}`;
    return 'Empty';
  }
  function xpGroups() {
    const idx = S.idx;
    if (XP.mode === 'search') return [{ key: 'search', title: 'Search results', items: F.search(idx, XP.query, 300) }];
    if (XP.mode === 'recent') return [{ key: 'recent', title: 'Recently added', items: [...S.people].filter((p) => p.created_at).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 40) }];
    if (!XP.folder) { const r = xpRoots(); return [{ key: 'roots', title: r.length > 1 ? 'Founding families' : 'Founding family', items: r }]; }
    const owner = idx.byId.get(XP.folder);
    const sp = spOf(XP.folder);
    const spTitle = sp.length > 1 ? 'Husbands and wives' : owner.gender === 'female' ? 'Husband' : owner.gender === 'male' ? 'Wife' : 'Spouse';
    return [{ key: 'spouses', title: spTitle, items: sp }, { key: 'children', title: 'Children', items: F.children(idx, XP.folder) }].filter((g) => g.items.length);
  }
  function xpSub(p) {
    const yrs = F.years(p, isPrivate(p));
    if (XP.mode !== 'folder') { const h = homeOf(p.id); return [yrs, h ? `in ${F.shortName(S.idx.byId.get(h))}` : 'in Home'].filter(Boolean).join(' · '); }
    if (!XP.folder) { const sp = spOf(p.id)[0]; return [sp ? `& ${F.shortName(sp)}` : '', yrs].filter(Boolean).join(' · '); }
    return [xpRel(XP.folder, p), yrs].filter(Boolean).join(' · ');
  }
  function meTag(p) {
    if (S.meId === p.id) return '<span class="xp-tag">You</span>';
    const r = relToMe(p.id); return r ? `<span class="xp-tag">Your ${esc(r.word)}</span>` : '';
  }
  const sortFns = {
    name: (a, b) => F.fullName(a).localeCompare(F.fullName(b)),
    birth: (a, b) => String(a.birth_date || '9999').localeCompare(String(b.birth_date || '9999')),
    place: (a, b) => String(a.birth_place || '~').localeCompare(String(b.birth_place || '~')),
    contents: (a, b) => kidsOf(a.id).length - kidsOf(b.id).length,
    rel: (a, b) => xpSub(a).localeCompare(xpSub(b)),
  };

  function xpRenderContent() {
    if (xpView() === 'chart') return;
    const canAdd = S.settings.submissions_open || admin();
    if (!S.people.length) {
      xpContent.innerHTML = `<div class="xp-empty"><span class="xp-fi lg" aria-hidden="true"><svg viewBox="0 0 64 52"><path class="fb" d="M3 8.5A4.5 4.5 0 0 1 7.5 4h13.2a4 4 0 0 1 2.9 1.2L28 9.6h28.5A4.5 4.5 0 0 1 61 14.1v29.4a4.5 4.5 0 0 1-4.5 4.5h-49A4.5 4.5 0 0 1 3 43.5z"/><path class="ff" d="M2 20.5A4.5 4.5 0 0 1 6.5 16h51a4.5 4.5 0 0 1 4.5 4.5v23a4.5 4.5 0 0 1-4.5 4.5h-51A4.5 4.5 0 0 1 2 43.5z"/></svg></span><h3>The shijra is waiting for its first name</h3><p>Start with the eldest ancestor you know. Every entry is reviewed before it appears here.</p>${canAdd ? '<button class="btn primary" type="button" data-action="add">Add the first family member</button>' : ''}</div>`;
      return;
    }
    const groups = xpGroups();
    if (!groups.some((g) => g.items.length)) {
      if (XP.mode === 'search') xpContent.innerHTML = `<div class="xp-empty"><h3>No one matches "${esc(XP.query)}"</h3><p>Try a first name, a nickname like Bade Abba, or a city.</p>${S.settings.submissions_open && !admin() ? `<button class="btn" type="button" data-xadd-name="${esc(XP.query)}">Add ${esc(XP.query)} to the shijra</button>` : ''}</div>`;
      else if (XP.mode === 'recent') xpContent.innerHTML = '<div class="xp-empty"><h3>Nothing added recently</h3></div>';
      else {
        const o = S.idx.byId.get(XP.folder);
        xpContent.innerHTML = `<div class="xp-empty">${folderIcon(o, 'lg')}<h3>This folder is empty</h3><p>No husband, wife or children are recorded for ${esc(F.shortName(o))} yet.</p>${canAdd ? `<button class="btn primary" type="button" data-action="add-rel" data-id="${esc(o.id)}">${ico('i-plus')}Add a relative of ${esc(F.shortName(o))}</button>` : ''}</div>`;
      }
      return;
    }
    const sorted = (items) => (XP.sort.key && sortFns[XP.sort.key] ? [...items].sort((a, b) => XP.sort.dir * sortFns[XP.sort.key](a, b)) : items);
    const gh = (g) => `<button class="xp-group-h" type="button" data-xgrp="${g.key}" aria-expanded="${!XP.shut.has(g.key)}">${ico('i-chev')}${esc(g.title)} <span>(${g.items.length})</span></button>`;
    const sel = (p) => (XP.sel === p.id ? 'sel' : '');
    let html = '';
    if (xpView() === 'details') {
      const folderMode = XP.mode === 'folder';
      const th = (key, label, cls = '') => `<th class="${cls}"><button type="button" data-xsort="${key}">${label}${XP.sort.key === key ? (XP.sort.dir > 0 ? ' ▲' : ' ▼') : ''}</button></th>`;
      html = `<table class="xp-table"><thead><tr>${th('name', 'Name')}${th('rel', folderMode ? (XP.folder ? 'Relation' : 'Married to') : 'Location')}${th('birth', 'Born')}${th('place', 'Birthplace', 'hide-sm')}${th('contents', 'Contents', 'hide-sm')}<th class="hide-sm">Status</th></tr></thead>`;
      for (const g of groups) {
        html += `<tbody><tr><td colspan="6" style="padding:0">${gh(g)}</td></tr>`;
        if (!XP.shut.has(g.key)) for (const p of sorted(g.items)) {
          const priv = isPrivate(p);
          const relCell = folderMode ? (XP.folder ? xpRel(XP.folder, p) : (spOf(p.id).map(F.shortName).join(', '))) : pathText(homeOf(p.id) || '').replace(/ › $/, '');
          html += `<tr class="xp-trow ${sel(p)} ${p.visible === false ? 'hidden-person' : ''}" data-xid="${esc(p.id)}" role="option" aria-selected="${XP.sel === p.id}">
            <td><span class="xp-tname">${folderIcon(p, 'sm')}<span>${esc(F.fullName(p))}</span>${meTag(p)}</span></td>
            <td>${esc(relCell)}</td><td class="num">${esc(priv ? 'Living' : F.fmtDate(p.birth_date) || '')}</td>
            <td class="hide-sm">${esc(priv ? '' : p.birth_place || '')}</td><td class="hide-sm num">${esc(contentsText(p.id))}</td>
            <td class="hide-sm">${F.isLiving(p) ? 'Living' : 'Passed away'}</td></tr>`;
        }
        html += '</tbody>';
      }
      html += '</table>';
    } else {
      for (const g of groups) {
        html += gh(g);
        if (XP.shut.has(g.key)) continue;
        html += '<div class="xp-icons">';
        for (const p of g.items) {
          html += `<div class="xp-item ${sel(p)} ${p.visible === false ? 'hidden-person' : ''}" data-xid="${esc(p.id)}" role="option" aria-selected="${XP.sel === p.id}" title="${esc(F.fullName(p))}">${folderIcon(p)}<div class="xp-iname">${esc(F.shortName(p))}</div><div class="xp-isub">${esc(xpSub(p))}</div>${meTag(p)}</div>`;
        }
        html += '</div>';
      }
    }
    const st = xpContent.scrollTop;
    xpContent.innerHTML = html;
    xpContent.scrollTop = st;
  }

  function xpNavRows(p, depth, seen) {
    if (seen.has(p.id)) return ''; seen.add(p.id);
    const kids = kidsOf(p.id);
    const open = XP.open.has(p.id);
    const cur = XP.mode === 'folder' && XP.folder === p.id;
    const sp = spOf(p.id)[0];
    let h = `<div class="xp-row ${cur ? 'cur' : ''}" role="treeitem" aria-level="${depth + 1}" ${kids.length ? `aria-expanded="${open}"` : ''} aria-selected="${cur}" data-xgo="${esc(p.id)}" style="--d:${Math.min(depth, 14)}" tabindex="-1" title="${esc(F.fullName(p))}${sp ? ` & ${esc(F.fullName(sp))}` : ''}">
      ${kids.length ? `<button class="xp-tw" type="button" data-xtw="${esc(p.id)}" aria-label="${open ? 'Collapse' : 'Expand'} ${esc(F.shortName(p))}" tabindex="-1">${ico('i-chev')}</button>` : '<span class="xp-tw"></span>'}
      ${folderIcon(p, 'xs')}<span class="xp-rn">${esc(F.shortName(p))}</span></div>`;
    if (open && kids.length) h += `<div role="group">${kids.map((k) => xpNavRows(S.idx.byId.get(k), depth + 1, seen)).join('')}</div>`;
    return h;
  }
  function xpRenderNav() {
    const me = S.meId && S.idx.byId.get(S.meId);
    const q = (go, icon, label, cur, extra = '') => `<div class="xp-row ${cur ? 'cur' : ''}" role="treeitem" aria-selected="${cur}" tabindex="-1" ${go === '@recent' ? 'data-xmode="recent"' : `data-xgo="${esc(go)}"`} ${extra}><svg class="qi" aria-hidden="true"><use href="#${icon}"/></svg><span class="xp-rn">${esc(label)}</span></div>`;
    let h = `<h4 id="xpQa">Quick access</h4><div role="tree" aria-labelledby="xpQa">
      ${q('', 'i-home', 'Home', XP.mode === 'folder' && !XP.folder)}
      ${me ? q(homeOf(me.id) || '', 'i-user', `You (${F.shortName(me)})`, false, `data-xselect="${esc(me.id)}"`) : ''}
      ${q('@recent', 'i-clock', 'Recently added', XP.mode === 'recent')}</div>
      <h4 id="xpFf">Family folders</h4><div role="tree" aria-labelledby="xpFf">`;
    const seen = new Set();
    for (const r of xpRoots()) h += xpNavRows(r, 0, seen);
    h += '</div>';
    const st = xpNav.scrollTop;
    xpNav.innerHTML = h;
    xpNav.scrollTop = st;
    const cur = $('.xp-row.cur', xpNav) || $('.xp-row', xpNav);
    if (cur) cur.tabIndex = 0;
  }
  function xpRenderAddress() {
    const el = $('#xpAddress');
    const sep = (folder) => {
      const name = folder ? F.shortName(S.idx.byId.get(folder)) : 'Home';
      return `<li><button class="xp-sep" type="button" data-xdrop="${esc(folder || '')}" aria-label="Folders inside ${esc(name)}">${ico('i-chev')}</button></li>`;
    };
    const atHome = XP.mode === 'folder' && !XP.folder;
    const parts = [`<li><button class="xp-crumb" type="button" data-xgo="" ${atHome ? 'aria-current="page"' : ''}>${ico('i-home')}Home</button></li>`];
    if (XP.mode === 'search') parts.push(`<li><span class="xp-sep" aria-hidden="true">${ico('i-chev')}</span></li><li><span class="xp-crumb" aria-current="page">Search results for "${esc(XP.query)}"</span></li>`);
    else if (XP.mode === 'recent') parts.push(`<li><span class="xp-sep" aria-hidden="true">${ico('i-chev')}</span></li><li><span class="xp-crumb" aria-current="page">Recently added</span></li>`);
    else {
      let prev = '';
      for (const id of (XP.folder ? xpPath(XP.folder) : [])) {
        parts.push(sep(prev));
        parts.push(`<li><button class="xp-crumb" type="button" data-xgo="${esc(id)}" ${id === XP.folder ? 'aria-current="page"' : ''}>${esc(F.shortName(S.idx.byId.get(id)))}</button></li>`);
        prev = id;
      }
      if ((XP.folder ? kidsOf(XP.folder).length : xpRoots().length)) parts.push(sep(XP.folder || ''));
    }
    el.innerHTML = `<ol class="xp-crumbs">${parts.join('')}</ol>`;
    el.scrollLeft = el.scrollWidth;
  }
  const xpTarget = () => XP.sel || (XP.mode === 'folder' ? XP.folder : null);
  function xpRenderCmd() {
    const t = xpTarget(); const p = t && S.idx.byId.get(t);
    const canAdd = S.settings.submissions_open || admin();
    const v = xpView();
    const me = S.meId && S.idx.byId.get(S.meId);
    const dis = p ? '' : 'disabled';
    $('#xpCmd').innerHTML = `
      ${canAdd ? `<button class="xp-c primary" type="button" data-xcmd="new">${ico('i-plus')}${p ? 'Add relative' : 'Add member'}</button>` : ''}
      ${admin() ? `<button class="xp-c" type="button" data-xcmd="edit" ${dis}>${ico('i-edit')}Edit</button><button class="xp-c danger" type="button" data-xcmd="delete" ${dis}>${ico('i-trash')}Delete</button>`
        : S.settings.submissions_open ? `<button class="xp-c" type="button" data-xcmd="suggest" ${dis}>${ico('i-edit')}Suggest an edit</button>` : ''}
      <button class="xp-c" type="button" data-xcmd="profile" ${dis}>${ico('i-card')}Profile</button>
      <button class="xp-c" type="button" data-xcmd="share" ${dis}>${ico('i-link')}Copy link</button>
      <span class="xp-vr" aria-hidden="true"></span>
      <div class="xp-seg" role="group" aria-label="View">
        <button class="xp-c" type="button" data-xview="icons" aria-pressed="${v === 'icons'}" title="Large icons">${ico('i-grid')}<span>Icons</span></button>
        <button class="xp-c" type="button" data-xview="details" aria-pressed="${v === 'details'}" title="Details list">${ico('i-list')}<span>Details</span></button>
        <button class="xp-c" type="button" data-xview="chart" aria-pressed="${v === 'chart'}" title="Family chart" ${XP.mode !== 'folder' ? 'disabled' : ''}>${ico('i-chart')}<span>Chart</span></button>
      </div>
      <span class="xp-spacer"></span>
      ${S.people.length ? `<button class="xp-c" type="button" id="meChip" data-xcmd="me">${me ? `${portraitHTML(me, 'sm')}You: ${esc(F.shortName(me))}` : `${ico('i-user')}Who are you?`}</button>` : ''}
      <button class="xp-c hide-narrow" type="button" data-xcmd="navpane" aria-pressed="${XP.nav}" aria-label="Folders pane" title="Folders pane">${ico('i-pane-l')}</button>
      <button class="xp-c hide-narrow" type="button" data-xcmd="detailspane" aria-pressed="${XP.details}" aria-label="Details pane" title="Details pane">${ico('i-pane-r')}</button>`;
  }
  function xpRenderDetails() {
    const el = $('#xpDetails'); if (el.hidden) return;
    const id = xpTarget(); const p = id && S.idx.byId.get(id);
    const canAdd = S.settings.submissions_open || admin();
    if (!p) {
      const living = S.people.filter(F.isLiving).length;
      el.innerHTML = `<div class="xp-d"><div class="xp-d-hero"><svg viewBox="0 0 24 24" width="64" height="64" style="color:var(--gold)" aria-hidden="true"><use href="#i-home"/></svg><h3>${esc(S.settings.site_title || 'Family Shijra')}</h3><div class="years">${S.people.length} members · ${living} living</div></div>
        <p class="xp-d-hint">${XP.mode === 'search' ? 'Select a result to see who they are and where they sit in the family.' : 'Select a folder to see details. Double-click to open it and see the next generation.'}</p></div>`;
      return;
    }
    const priv = isPrivate(p); const me = relToMe(id);
    const facts = [];
    const add = (k, v) => { if (v) facts.push(`<dt>${k}</dt><dd>${esc(v)}</dd>`); };
    if (S.settings.show_generation) add('Generation', roman(generationOf(id)));
    if (!priv) add('Born', [F.fmtDate(p.birth_date), p.birth_place].filter(Boolean).join(', '));
    if (!F.isLiving(p)) add('Passed away', [F.fmtDate(p.death_date), p.death_place].filter(Boolean).join(', ') || 'Yes');
    if (!priv && F.isLiving(p)) add('Lives in', p.current_place);
    add('Occupation', p.occupation);
    add('Parents', F.parents(S.idx, p).map(F.shortName).join(' & '));
    add('Contents', contentsText(id));
    el.innerHTML = `<div class="xp-d"><div class="xp-d-hero">${portraitHTML(p)}<h3>${esc(F.fullName(p))}</h3>${p.nickname ? `<div class="nick">${esc(p.nickname)}</div>` : ''}<div class="years">${esc(F.years(p, priv))}</div></div>
      ${S.meId === id ? '<div class="xp-d-rel"><b>This is you</b></div>' : me ? `<div class="xp-d-rel"><b>Your ${esc(me.word)}</b>${esc(me.r.text)}</div>` : ''}
      <dl>${facts.join('')}</dl>
      <div class="xp-d-acts">
        ${XP.folder !== id || XP.mode !== 'folder' ? `<button class="btn sm primary" type="button" data-xopen="${esc(id)}">Open folder</button>` : ''}
        <button class="btn sm" type="button" data-action="xp-profile" data-id="${esc(id)}">Full profile</button>
        ${canAdd ? `<button class="btn sm" type="button" data-action="add-rel" data-id="${esc(id)}">${ico('i-plus')}Add relative</button>` : ''}
        ${admin() ? `<button class="btn sm" type="button" data-action="edit" data-id="${esc(id)}">${ico('i-edit')}Edit</button><button class="btn sm danger" type="button" data-action="delete" data-id="${esc(id)}">${ico('i-trash')}Delete</button>`
          : S.settings.submissions_open ? `<button class="btn sm" type="button" data-action="suggest" data-id="${esc(id)}">${ico('i-edit')}Suggest an edit</button>` : ''}
      </div>
      ${touchy() ? '' : '<p class="xp-d-hint">Double-click a folder to open it. Right-click any person for more options.</p>'}</div>`;
  }
  function xpRenderStatus() {
    const n = xpView() === 'chart' ? null : xpGroups().reduce((a, g) => a + g.items.length, 0);
    const left = n === null ? 'Family chart' : `${n} item${n === 1 ? '' : 's'}${XP.sel ? ' · 1 selected' : ''}`;
    const right = XP.mode === 'folder' && XP.folder ? (S.settings.show_generation ? `Generation ${roman(generationOf(XP.folder))} · ${contentsText(XP.folder)}` : contentsText(XP.folder)) : XP.mode === 'search' ? 'Searching all members' : `${S.people.length} members`;
    $('#xpStatus').innerHTML = `<span>${esc(left)}</span><span>${esc(right)}</span>`;
  }
  function xpRenderToolbar() {
    $('#xpBack').disabled = !XP.back.length;
    $('#xpFwd').disabled = !XP.fwd.length;
    $('#xpUp').disabled = XP.mode === 'folder' && !XP.folder;
    const p = XP.mode === 'folder' && XP.folder && S.idx.byId.get(XP.folder);
    $('#xpTitle').textContent = XP.mode === 'search' ? `Search results – ${S.settings.site_title || 'Family Shijra'}` : XP.mode === 'recent' ? 'Recently added' : p ? F.fullName(p) : (S.settings.site_title || 'Family Shijra');
  }
  function xpLayout() {
    const chart = xpView() === 'chart';
    const showDetails = XP.details && !chart && window.innerWidth > 980;
    const showNav = narrow() ? true : XP.nav;
    xpNav.hidden = !showNav;
    xpNav.classList.toggle('open', XP.navMobile && narrow());
    $('#xpDetails').hidden = !showDetails;
    xpContent.hidden = chart; $('#xpChart').hidden = !chart;
    xpMain.style.gridTemplateColumns = narrow() ? '' : [showNav ? '250px' : '', 'minmax(0, 1fr)', showDetails ? '290px' : ''].filter(Boolean).join(' ');
    xpMain.classList.toggle('no-nav', !showNav || narrow());
    $('#xpNavToggle').setAttribute('aria-expanded', String(XP.navMobile));
  }
  function renderExplorer() {
    if (!xp) return;
    if (!XP.started && S.people.length) {
      XP.started = true;
      const r = xpRoots();
      if (r.length === 1 && !XP.folder && isFull(r[0].id)) { XP.folder = r[0].id; XP.open.add(r[0].id); }
    }
    if (XP.folder && !S.idx.byId.has(XP.folder)) XP.folder = null;
    if (XP.sel && !S.idx.byId.has(XP.sel)) XP.sel = null;
    xpLayout(); xpRenderToolbar(); xpRenderAddress(); xpRenderNav(); xpRenderCmd(); xpRenderContent(); xpRenderDetails(); xpRenderStatus();
  }
  const xpSnap = () => ({ folder: XP.folder, mode: XP.mode, query: XP.query, sel: XP.sel });
  function xpRestore(st) {
    Object.assign(XP, st);
    $('#searchInput').value = st.mode === 'search' ? st.query : '';
    renderExplorer(); if (xpView() === 'chart') chartShow();
  }
  function xpGo(folder, { select = null, mode = 'folder', push = true } = {}) {
    if (push) { XP.back.push(xpSnap()); if (XP.back.length > 80) XP.back.shift(); XP.fwd = []; }
    XP.mode = mode; if (mode === 'folder') XP.folder = folder || null; XP.sel = select;
    if (mode !== 'search') { XP.query = ''; $('#searchInput').value = ''; }
    if (mode === 'folder' && folder) xpPath(folder).forEach((id) => XP.open.add(id));
    XP.navMobile = false;
    renderExplorer();
    if (xpView() === 'chart') chartShow();
    if (select) scrollInto(xpContent.querySelector(`[data-xid="${CSS.escape(select)}"]`), xpContent);
  }
  function xpSelect(id) {
    XP.sel = id || null;
    $$('[data-xid]', xpContent).forEach((el) => { const on = el.dataset.xid === XP.sel; el.classList.toggle('sel', on); el.setAttribute('aria-selected', String(on)); });
    if (XP.sel) scrollInto(xpContent.querySelector(`[data-xid="${CSS.escape(XP.sel)}"]`), xpContent);
    xpRenderDetails(); xpRenderStatus(); xpRenderCmd();
  }
  function xpActivate(id) { if (isFull(id)) xpGo(id); else openProfile(id); }
  function chartShow() {
    if (xpView() !== 'chart') return;
    S.rootId = XP.mode === 'folder' && XP.folder ? XP.folder : null;
    S.firstRender = true; S.expanded.clear();
    renderTree();
  }
  function scrollToExplorer() {
    if (XP.max) return;
    const r = xp.getBoundingClientRect();
    if (r.top < 0 || r.top > window.innerHeight * 0.45) xp.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }
  function reveal(id, { scroll = true } = {}) {
    if (!S.idx.byId.has(id)) return;
    if (XP.min) xpMinimize(false);
    const home = homeOf(id);
    if (XP.mode !== 'folder' || XP.folder !== home) xpGo(home, { select: id }); else xpSelect(id);
    if (xpView() === 'chart') chartReveal(id);
    else {
      const el = xpContent.querySelector(`[data-xid="${CSS.escape(id)}"]`);
      if (el) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); scrollInto(el, xpContent); }
    }
    if (scroll) scrollToExplorer();
  }
  function xpMaximize(on) {
    XP.max = on; xp.classList.toggle('max', on);
    document.body.classList.toggle('no-scroll', on || S.adminOpen);
    $('#xpMax').setAttribute('aria-pressed', String(on)); $('#xpMax').setAttribute('aria-label', on ? 'Restore window size' : 'Maximize window'); $('#xpMax').title = on ? 'Restore' : 'Maximize';
    if (on && XP.min) xpMinimize(false);
    requestAnimationFrame(() => { if (xpView() === 'chart') fit(); });
  }
  function xpMinimize(on) {
    XP.min = on; xp.classList.toggle('min', on);
    $('#xpMin').setAttribute('aria-expanded', String(!on)); $('#xpMin').setAttribute('aria-label', on ? 'Restore window' : 'Minimize window'); $('#xpMin').title = on ? 'Restore' : 'Minimize';
    if (on && XP.max) xpMaximize(false);
  }
  function setView(v) {
    XP.view = v; ls.set('shijra-view', v);
    renderExplorer();
    if (v === 'chart') { chartShow(); if (XP.sel) chartReveal(XP.sel); }
  }
  async function copyLink(id) {
    const p = S.idx.byId.get(id); if (!p) return;
    const url = S.store.shareUrl ? S.store.shareUrl(p) : location.href;
    try { await navigator.clipboard.writeText(url); toast('Link copied.'); } catch (err) { toast(url); }
  }

  // context menus
  let menuEl = null, menuReturn = null, menuAt = 0;
  function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; if (menuReturn && document.contains(menuReturn)) menuReturn.focus({ preventScroll: true }); menuReturn = null; } }
  function openMenu(x, y, items, heading) {
    closeMenu();
    const list = items.filter(Boolean).filter((it, i, a) => it !== '-' || (i > 0 && i < a.length - 1 && a[i - 1] !== '-'));
    menuReturn = document.activeElement; menuAt = Date.now();
    menuEl = document.createElement('div'); menuEl.className = 'xp-menu'; menuEl.setAttribute('role', 'menu');
    menuEl.innerHTML = (heading ? `<div class="xp-menu-h">${esc(heading)}</div>` : '') + list.map((it, i) => (it === '-' ? '<hr>' : `<button type="button" role="menuitem" data-mi="${i}" class="${it.danger ? 'danger' : ''}">${it.icon || ''}<span>${esc(it.label)}</span></button>`)).join('');
    document.body.appendChild(menuEl);
    const r = menuEl.getBoundingClientRect();
    menuEl.style.left = Math.max(8, Math.min(x, window.innerWidth - r.width - 8)) + 'px';
    menuEl.style.top = Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) + 'px';
    menuEl.addEventListener('click', (e) => { const b = e.target.closest('[data-mi]'); if (!b) return; const it = list[+b.dataset.mi]; menuReturn = null; closeMenu(); it.run(); });
    menuEl.addEventListener('keydown', (e) => {
      const btns = $$('button', menuEl); const i = btns.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); btns[(i + 1) % btns.length].focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length].focus(); }
      if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); closeMenu(); }
    });
    $('button', menuEl)?.focus({ preventScroll: true });
  }
  document.addEventListener('pointerdown', (e) => { if (menuEl && !menuEl.contains(e.target)) { menuReturn = null; closeMenu(); } }, true);
  window.addEventListener('scroll', (e) => { if (menuEl && !menuEl.contains(e.target) && Date.now() - menuAt > 400) { menuReturn = null; closeMenu(); } }, true);
  function itemMenu(id) {
    const canAdd = S.settings.submissions_open || admin();
    return [
      { label: 'Open', icon: ico('i-chev'), run: () => xpGo(id) },
      { label: 'View profile', icon: ico('i-card'), run: () => openProfile(id) },
      { label: 'Show in family chart', icon: ico('i-chart'), run: () => { XP.view = 'chart'; ls.set('shijra-view', 'chart'); xpGo(homeOf(id), { select: id }); chartReveal(id); } },
      '-',
      canAdd && { label: 'Add a relative…', icon: ico('i-plus'), run: () => openRelChooser(id) },
      { label: 'Copy link', icon: ico('i-link'), run: () => copyLink(id) },
      S.meId !== id && { label: 'This is me', icon: ico('i-user'), run: () => { setMe(id); toast('Cards now show how each person is related to you.'); } },
      '-',
      admin() ? { label: 'Edit', icon: ico('i-edit'), run: () => openEditor(id) } : S.settings.submissions_open && { label: 'Suggest an edit', icon: ico('i-edit'), run: () => openSuggest(id) },
      admin() ? { label: 'Delete', danger: true, icon: ico('i-trash'), run: () => askDelete(id) } : S.settings.submissions_open && { label: 'Request removal', danger: true, icon: ico('i-trash'), run: () => openRemoval(id) },
    ];
  }
  function backgroundMenu() {
    const canAdd = S.settings.submissions_open || admin();
    const f = XP.mode === 'folder' && XP.folder;
    return [
      { label: 'Large icons', icon: ico('i-grid'), run: () => setView('icons') },
      { label: 'Details list', icon: ico('i-list'), run: () => setView('details') },
      XP.mode === 'folder' && { label: 'Family chart', icon: ico('i-chart'), run: () => setView('chart') },
      '-',
      canAdd && (f ? { label: `Add a relative of ${F.shortName(S.idx.byId.get(f))}…`, icon: ico('i-plus'), run: () => openRelChooser(f) } : { label: 'Add a family member…', icon: ico('i-plus'), run: () => openAdd({}) }),
      f && { label: 'Up one generation', icon: ico('i-up'), run: () => xpUp() },
      f && { label: 'Copy link to this folder', icon: ico('i-link'), run: () => copyLink(f) },
    ];
  }
  function xpUp() {
    if (XP.mode !== 'folder') { xpGo(XP.folder); return; }
    if (!XP.folder) return;
    const cur = XP.folder; xpGo(homeOf(cur), { select: cur });
  }
  function moveSel(key) {
    const els = $$('[data-xid]', xpContent); if (!els.length) return;
    const i = els.findIndex((el) => el.dataset.xid === XP.sel);
    if (i < 0) { xpSelect(els[0].dataset.xid); return; }
    let j = i;
    if (xpView() === 'details' || key === 'ArrowLeft' || key === 'ArrowRight') j = i + (key === 'ArrowDown' || key === 'ArrowRight' ? 1 : -1);
    else {
      const r = els[i].getBoundingClientRect();
      const rows = els.map((el, k) => ({ k, r: el.getBoundingClientRect() })).filter((o) => (key === 'ArrowDown' ? o.r.top > r.top + 5 : o.r.top < r.top - 5));
      if (rows.length) {
        const ty = key === 'ArrowDown' ? Math.min(...rows.map((o) => o.r.top)) : Math.max(...rows.map((o) => o.r.top));
        const row = rows.filter((o) => Math.abs(o.r.top - ty) < 5);
        j = row.reduce((b, o) => (Math.abs(o.r.left - r.left) < Math.abs(b.r.left - r.left) ? o : b)).k;
      }
    }
    j = Math.max(0, Math.min(els.length - 1, j));
    xpSelect(els[j].dataset.xid);
  }

  (function wireExplorer() {
    if (!xp) return;
    $('#xpBack').onclick = () => { if (!XP.back.length) return; XP.fwd.push(xpSnap()); xpRestore(XP.back.pop()); };
    $('#xpFwd').onclick = () => { if (!XP.fwd.length) return; XP.back.push(xpSnap()); xpRestore(XP.fwd.pop()); };
    $('#xpUp').onclick = xpUp;
    $('#xpMax').onclick = () => xpMaximize(!XP.max);
    $('#xpMin').onclick = () => xpMinimize(!XP.min);
    $('#xpTitleBar').addEventListener('dblclick', (e) => { if (!e.target.closest('button')) xpMaximize(!XP.max); });
    $('#xpTitleBar').addEventListener('click', (e) => { if (XP.min && !e.target.closest('button')) xpMinimize(false); });
    $('#xpNavToggle').onclick = () => { XP.navMobile = !XP.navMobile; xpLayout(); if (XP.navMobile) ($('.xp-row.cur', xpNav) || $('.xp-row', xpNav))?.focus(); };

    xp.addEventListener('click', (e) => {
      const go = e.target.closest('[data-xgo]:not(.xp-row)');
      if (go && !e.target.closest('[data-xtw]')) { xpGo(go.dataset.xgo || null); return; }
      const drop = e.target.closest('[data-xdrop]');
      if (drop) {
        const f = drop.dataset.xdrop || null;
        const items = f ? F.children(S.idx, f) : xpRoots();
        const r = drop.getBoundingClientRect();
        openMenu(r.left, r.bottom + 4, items.map((p) => ({ label: F.shortName(p), icon: folderIcon(p, 'xs'), run: () => xpGo(p.id) })), f ? `Inside ${F.shortName(S.idx.byId.get(f))}` : 'Family folders');
        return;
      }
      const op = e.target.closest('[data-xopen]'); if (op) { xpGo(op.dataset.xopen); return; }
      const an = e.target.closest('[data-xadd-name]'); if (an) { openAdd({ name: an.dataset.xaddName }); return; }
      const v = e.target.closest('[data-xview]'); if (v && !v.disabled) { setView(v.dataset.xview); return; }
      const c = e.target.closest('[data-xcmd]');
      if (c && !c.disabled) {
        const t = xpTarget();
        switch (c.dataset.xcmd) {
          case 'new': if (t) openRelChooser(t); else openAdd({}); break;
          case 'edit': openEditor(t); break;
          case 'delete': askDelete(t); break;
          case 'suggest': openSuggest(t); break;
          case 'profile': openProfile(t); break;
          case 'share': copyLink(t); break;
          case 'me': openMePicker(); break;
          case 'navpane': XP.nav = !XP.nav; ls.set('shijra-nav', XP.nav ? '1' : '0'); xpLayout(); xpRenderCmd(); break;
          case 'detailspane': XP.details = !XP.details; ls.set('shijra-details', XP.details ? '1' : '0'); xpLayout(); xpRenderDetails(); xpRenderCmd(); break;
          default:
        }
      }
    });

    // navigation pane
    xpNav.addEventListener('click', (e) => {
      const tw = e.target.closest('[data-xtw]');
      if (tw) { const id = tw.dataset.xtw; if (XP.open.has(id)) XP.open.delete(id); else XP.open.add(id); xpRenderNav(); $(`.xp-row[data-xgo="${CSS.escape(id)}"]`, xpNav)?.focus({ preventScroll: true }); return; }
      const row = e.target.closest('.xp-row'); if (!row) return;
      if (row.dataset.xmode === 'recent') { xpGo(XP.folder, { mode: 'recent' }); return; }
      xpGo(row.dataset.xgo || null, { select: row.dataset.xselect || null });
    });
    xpNav.addEventListener('keydown', (e) => {
      const rows = $$('.xp-row', xpNav); const row = e.target.closest('.xp-row'); if (!row) return;
      const i = rows.indexOf(row); const id = row.dataset.xgo;
      const focus = (r) => { if (!r) return; rows.forEach((x) => { x.tabIndex = -1; }); r.tabIndex = 0; r.focus(); };
      if (e.key === 'ArrowDown') { e.preventDefault(); focus(rows[i + 1]); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); focus(rows[i - 1]); }
      else if (e.key === 'ArrowRight' && row.hasAttribute('aria-expanded')) { e.preventDefault(); if (!XP.open.has(id)) { XP.open.add(id); xpRenderNav(); focus($(`.xp-row[data-xgo="${CSS.escape(id)}"]`, xpNav)); } else focus(rows[i + 1]); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); if (id && XP.open.has(id)) { XP.open.delete(id); xpRenderNav(); focus($(`.xp-row[data-xgo="${CSS.escape(id)}"]`, xpNav)); } else { const h = id && homeOf(id); if (h) focus($(`.xp-row[data-xgo="${CSS.escape(h)}"]`, xpNav)); } }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); row.click(); }
      else if (e.key === 'Escape' && XP.navMobile) { XP.navMobile = false; xpLayout(); }
    });

    // content pane
    xpContent.addEventListener('click', (e) => {
      const g = e.target.closest('[data-xgrp]');
      if (g) { const k = g.dataset.xgrp; if (XP.shut.has(k)) XP.shut.delete(k); else XP.shut.add(k); xpRenderContent(); return; }
      const so = e.target.closest('[data-xsort]');
      if (so) { const k = so.dataset.xsort; XP.sort = { key: k, dir: XP.sort.key === k ? -XP.sort.dir : 1 }; xpRenderContent(); return; }
      if (e.target.closest('button, a')) return;
      const it = e.target.closest('[data-xid]');
      if (!it) { xpSelect(null); return; }
      if (touchy()) xpActivate(it.dataset.xid); else xpSelect(it.dataset.xid);
    });
    xpContent.addEventListener('dblclick', (e) => { const it = e.target.closest('[data-xid]'); if (it && !touchy()) xpGo(it.dataset.xid); });
    xpContent.addEventListener('contextmenu', (e) => {
      if (e.target.closest('button:not([data-xid]), a, input')) return;
      e.preventDefault();
      const it = e.target.closest('[data-xid]');
      if (it) { xpSelect(it.dataset.xid); openMenu(e.clientX, e.clientY, itemMenu(it.dataset.xid), F.fullName(S.idx.byId.get(it.dataset.xid))); }
      else openMenu(e.clientX, e.clientY, backgroundMenu());
    });
    xpContent.addEventListener('keydown', (e) => {
      if (e.target !== xpContent) return;
      const t = XP.sel;
      if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) { e.preventDefault(); moveSel(e.key); }
      else if (e.key === 'Home') { e.preventDefault(); const f = $('[data-xid]', xpContent); if (f) xpSelect(f.dataset.xid); }
      else if (e.key === 'End') { e.preventDefault(); const l = $$('[data-xid]', xpContent).pop(); if (l) xpSelect(l.dataset.xid); }
      else if (e.key === 'Enter' && t) { e.preventDefault(); xpGo(t); }
      else if (e.key === 'Backspace' || (e.altKey && e.key === 'ArrowUp')) { e.preventDefault(); xpUp(); }
      else if (e.key === 'Delete' && t && admin()) { e.preventDefault(); askDelete(t); }
      else if (e.key === 'F2' && t && admin()) { e.preventDefault(); openEditor(t); }
      else if ((e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) && t) {
        e.preventDefault(); const el = xpContent.querySelector(`[data-xid="${CSS.escape(t)}"]`); const r = el.getBoundingClientRect();
        openMenu(r.left + 20, r.top + 30, itemMenu(t), F.fullName(S.idx.byId.get(t)));
      }
    });

    // search
    const input = $('#searchInput'); let st;
    input.addEventListener('input', () => {
      clearTimeout(st);
      st = setTimeout(() => {
        const q = input.value.trim();
        if (q) {
          if (XP.mode !== 'search') { XP.back.push(xpSnap()); XP.fwd = []; }
          XP.mode = 'search'; XP.query = q; XP.sel = null; renderExplorer();
        } else if (XP.mode === 'search') xpRestore(XP.back.pop() || { folder: null, mode: 'folder', query: '', sel: null });
      }, 140);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); clearTimeout(st); input.dispatchEvent(new Event('input')); setTimeout(() => { const f = $('[data-xid]', xpContent); if (f) { xpSelect(f.dataset.xid); xpContent.focus({ preventScroll: true }); } }, 160); }
      if (e.key === 'Escape') { input.value = ''; input.dispatchEvent(new Event('input')); }
    });
    window.addEventListener('resize', () => { clearTimeout(wireExplorer.t); wireExplorer.t = setTimeout(() => { xpLayout(); xpRenderDetails(); }, 120); });
  })();

  // ---------- "who are you" ----------
  function renderMeChip() { xpRenderCmd(); xpRenderNav(); }
  function setMe(id) {
    S.meId = id; ls.set('shijra-me', id); relCache.clear();
    renderExplorer(); renderTree(); renderRelate();
    if (S.openProfileId) openProfile(S.openProfileId, { keepHash: true });
  }
  function openMePicker() {
    const m = openModal('Who are you in this family?', `<p class="muted" style="margin:0">Choose yourself and every card in the tree will show how that person is related to you, like <b>Your Dada</b> or <b>Your Khala</b>. This is remembered on this device only.</p><div class="field"><span class="lbl">Find your name</span><div id="mePick"></div></div>`,
      `${S.meId ? '<button class="btn" type="button" data-clear-me>Forget me</button>' : ''}<button class="btn" type="button" data-cancel>Cancel</button>`);
    personPicker($('#mePick', m.wrap), { value: null, placeholder: 'Type your name', onChange: (id) => { if (id) { setMe(id); m.close(); toast('Done. Cards now show how each person is related to you.'); } } });
    const c = $('[data-clear-me]', m.wrap); if (c) c.onclick = () => { setMe(null); m.close(); };
  }

  // ---------- elders, relation finder, recent ----------
  function renderElders() {
    const el = $('#eldersList'); if (!el) return;
    const root = familyRoot();
    if (!root) { el.innerHTML = '<p class="muted">The elders will appear here once the first names are added.</p>'; return; }
    const list = [S.idx.byId.get(root), ...F.spouses(S.idx, root), ...F.children(S.idx, root)].filter(Boolean);
    el.innerHTML = list.map((p) => {
      const d = F.countDescendants(S.idx, p.id);
      return `<button class="elder" type="button" data-action="open" data-id="${esc(p.id)}">${portraitHTML(p)}<b>${esc(F.shortName(p))}</b>${p.nickname ? `<div class="nick">${esc(p.nickname)}</div>` : ''}<div class="yrs">${esc(F.years(p, isPrivate(p)))}</div>${d ? `<div class="desc">${d} descendant${d === 1 ? '' : 's'}</div>` : ''}</button>`;
    }).join('');
  }
  let relPickA = null, relPickB = null;
  function renderRelate() {
    if (!S.settings.relationship_finder || !S.people.length) return;
    if (!S.relA || !S.idx.byId.has(S.relA)) {
      const youngest = [...S.people].filter((p) => F.year(p.birth_date)).sort((a, b) => String(b.birth_date).localeCompare(String(a.birth_date)))[0];
      S.relA = (S.meId && S.idx.byId.has(S.meId)) ? S.meId : youngest ? youngest.id : S.people[0].id;
    }
    if (!S.relB || !S.idx.byId.has(S.relB) || S.relB === S.relA) { const r = familyRoot(); S.relB = r !== S.relA ? r : (S.people.find((p) => p.id !== S.relA) || {}).id; }
    relPickA = personPicker($('#relA'), { value: S.relA, placeholder: 'Search a name', onChange: (id) => { S.relA = id; drawRelOut(); } });
    relPickB = personPicker($('#relB'), { value: S.relB, placeholder: 'Search a name', onChange: (id) => { S.relB = id; drawRelOut(); } });
    drawRelOut();
  }
  function drawRelOut() {
    const out = $('#relOut');
    const bg = pattern();
    if (!S.relA || !S.relB) { out.innerHTML = `${bg}<div class="term">Choose two people</div><p class="sentence">Their relation and the path between them will appear here.</p>`; return; }
    const r = F.relationship(S.idx, S.relA, S.relB);
    const a = S.idx.byId.get(S.relA), b = S.idx.byId.get(S.relB);
    const term = r.path.length ? (localOn() && r.local ? r.local : cap(r.label.replace(/ \((paternal|maternal) side\)$/, ''))) : 'Not connected yet';
    out.innerHTML = `${bg}<div class="term">${esc(term)}</div>
      <p class="sentence">${esc(r.text)}${localOn() && r.local ? ` In the family, ${esc(F.shortName(a))} would call ${esc(F.shortName(b))} <b>${esc(r.local)}</b>.` : ''}</p>
      ${r.path.length > 1 ? `<div class="chain">${r.path.map((id, i) => `${i ? '<span aria-hidden="true">→</span>' : ''}<button type="button" data-action="open" data-id="${esc(id)}">${esc(F.shortName(S.idx.byId.get(id)))}</button>`).join('')}</div>` : ''}`;
  }
  $('#relSwap').onclick = () => { [S.relA, S.relB] = [S.relB, S.relA]; relPickA.set(S.relA); relPickB.set(S.relB); drawRelOut(); };
  function renderRecent() {
    const el = $('#recentList'); if (!el) return;
    const list = [...S.people].filter((p) => p.created_at).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 9);
    $('#recentSec').hidden = !S.settings.show_recent || !list.length;
    el.innerHTML = list.map((p) => relRow(p, [F.years(p, isPrivate(p)), p.current_place && !isPrivate(p) ? p.current_place : p.birth_place].filter(Boolean).join(' · '))).join('');
  }

  // ---------- profile drawer ----------
  function relRow(p, sub) {
    return `<button class="rel" type="button" data-action="open" data-id="${esc(p.id)}">${portraitHTML(p, 'sm')}<span><b>${esc(F.fullName(p))}</b><small>${esc(sub || F.years(p, isPrivate(p)))}</small></span></button>`;
  }
  function openProfile(id, opts = {}) {
    const p = S.idx.byId.get(id);
    if (!p) return;
    S.openProfileId = id;
    const priv = isPrivate(p);
    const s = S.settings;
    const parents = F.parents(S.idx, p), spouses = F.spouses(S.idx, id), kids = F.children(S.idx, id), sibs = F.siblings(S.idx, p);
    const facts = [];
    const add = (k, v) => { if (v) facts.push(`<dt>${k}</dt><dd>${esc(v)}</dd>`); };
    if (p.maiden_name) add('Born as', `${p.first_name || ''} ${p.maiden_name}`.trim());
    if (!priv) add('Born', [F.fmtDate(p.birth_date), p.birth_place].filter(Boolean).join(', '));
    if (!F.isLiving(p)) add('Passed away', [F.fmtDate(p.death_date), p.death_place].filter(Boolean).join(', '));
    if (!priv) add('Lives in', F.isLiving(p) ? p.current_place : '');
    add('Occupation', p.occupation);
    const desc = F.countDescendants(S.idx, id);
    const me = relToMe(id);
    const relWord = (x) => { const r = F.relationship(S.idx, id, x.id); return r && localOn() && r.local ? `${r.local} · ${F.years(x, isPrivate(x))}` : F.years(x, isPrivate(x)); };
    const html = `
      <div class="drawer-head">
        <button class="btn sm" type="button" data-action="share" data-id="${esc(id)}">Copy link</button>
        <button class="btn sm icon" type="button" data-action="close-drawer" aria-label="Close">✕</button>
      </div>
      <div class="drawer-body" tabindex="-1">
        <div class="drawer-band">${pattern()}</div>
        <div class="profile-hero">
          ${portraitHTML(p, 'lg')}
          <h2 id="profileName">${esc(F.fullName(p))}</h2>
          ${p.nickname ? `<div class="nick">${esc(p.nickname)}</div>` : ''}
          <div class="years">${esc(F.years(p, priv))}</div>
          <div class="chips">
            ${s.show_generation ? `<span class="chip gold">Generation ${roman(generationOf(id))}</span>` : ''}
            ${desc ? `<span class="chip">${desc} descendant${desc === 1 ? '' : 's'}</span>` : ''}
            ${p.visible === false ? '<span class="chip warn">Hidden from visitors</span>' : ''}
            ${p.sample ? '<span class="chip">Sample entry</span>' : ''}
          </div>
          ${S.meId === id ? '<div class="your-rel"><b>This is you</b><span>Cards across the tree show how others are related to you.</span></div>'
            : me ? `<div class="your-rel"><b>Your ${esc(me.word)}</b><span>${esc(me.r.text)}</span></div>` : ''}
        </div>
        ${facts.length ? `<dl class="facts">${facts.join('')}</dl>` : ''}
        ${p.bio ? `<h3 class="section-title">Story</h3><p class="bio">${esc(p.bio)}</p>` : ''}
        ${parents.length ? `<h3 class="section-title">Parents</h3><div class="rel-list">${parents.map((x) => relRow(x, `${x.id === p.father_id ? 'Father' : 'Mother'} · ${F.years(x, isPrivate(x))}`)).join('')}</div>` : ''}
        ${spouses.length ? `<h3 class="section-title">${spouses.length > 1 ? 'Spouses' : p.gender === 'female' ? 'Husband' : p.gender === 'male' ? 'Wife' : 'Spouse'}</h3><div class="rel-list">${spouses.map((x) => relRow(x)).join('')}</div>` : ''}
        ${kids.length ? `<h3 class="section-title">Children (${kids.length})</h3><div class="rel-list">${kids.map((x) => relRow(x, relWord(x))).join('')}</div>` : ''}
        ${sibs.length ? `<h3 class="section-title">Brothers and sisters (${sibs.length})</h3><div class="rel-list">${sibs.map((x) => relRow(x, relWord(x))).join('')}</div>` : ''}
        <div class="profile-actions">
          <button class="btn" type="button" data-action="focus" data-id="${esc(id)}">Show in tree</button>
          ${s.submissions_open || admin() ? `<button class="btn primary" type="button" data-action="add-rel" data-id="${esc(id)}">${icon('i-plus')}Add relative</button>` : ''}
          ${admin() ? `<button class="btn" type="button" data-action="edit" data-id="${esc(id)}">${icon('i-edit')}Edit</button><button class="btn danger" type="button" data-action="delete" data-id="${esc(id)}">${icon('i-trash')}Delete</button>` : ''}
          ${s.submissions_open && !admin() ? `<button class="btn" type="button" data-action="suggest" data-id="${esc(id)}">${icon('i-edit')}Suggest an edit</button><button class="btn ghost" type="button" data-action="remove-req" data-id="${esc(id)}">Request removal</button>` : ''}
          ${S.meId !== id ? `<button class="btn ghost" type="button" data-action="set-me" data-id="${esc(id)}">This is me</button>` : ''}
        </div>
      </div>`;
    const host = $('#drawerHost');
    const wasOpen = !!$('.drawer', host);
    host.innerHTML = `${window.innerWidth <= 640 ? '<div class="scrim" data-action="close-drawer"></div>' : ''}<aside class="drawer" role="dialog" aria-labelledby="profileName" ${wasOpen ? 'style="animation:none"' : ''}>${html}</aside>`;
    if (!opts.keepHash) setHash('p-' + (p.slug || F.slugify(p)));
    if (!wasOpen) setTimeout(() => $('.drawer .drawer-body', host)?.focus({ preventScroll: true }), 50);
  }
  function closeDrawer() {
    S.openProfileId = null; $('#drawerHost').innerHTML = '';
    if (/^#p-/.test(location.hash)) setHash('');
  }
  function setHash(h) {
    try { history.replaceState(null, '', h ? '#' + h : location.pathname + location.search); } catch (e) { location.hash = h; }
  }

  // ---------- person picker ----------
  function personPicker(el, { value = null, exclude = [], placeholder = 'Search by name', onChange, allowNone = true, people = null } = {}) {
    let current = value;
    const idx = () => (people ? F.buildIndex(people()) : S.idx);
    const draw = () => {
      const p = current && idx().byId.get(current);
      if (p) {
        el.innerHTML = `<div class="picker"><div class="selected">${portraitHTML(p, 'sm')}<span>${esc(F.fullName(p))} <small class="muted">${esc(F.years(p, isPrivate(p)))}</small></span>${allowNone ? '<button class="btn sm ghost icon" type="button" data-clear aria-label="Clear">✕</button>' : ''}</div></div>`;
        $('[data-clear]', el)?.addEventListener('click', () => { current = null; draw(); onChange && onChange(null); $('input', el)?.focus(); });
      } else {
        el.innerHTML = `<div class="picker"><input type="search" placeholder="${esc(placeholder)}" autocomplete="off" aria-label="${esc(placeholder)}"><div class="list" hidden></div></div>`;
        const input = $('input', el), list = $('.list', el);
        input.addEventListener('input', () => {
          const res = F.search(idx(), input.value, 8).filter((x) => !exclude.includes(x.id));
          list.innerHTML = res.length ? res.map((x) => `<button class="result" type="button" data-id="${esc(x.id)}">${portraitHTML(x, 'sm')}<span><b>${esc(F.fullName(x))}</b><small>${esc(F.years(x, isPrivate(x)))}</small></span></button>`).join('') : '<div class="result muted">No matches</div>';
          list.hidden = !input.value.trim();
        });
        list.addEventListener('mousedown', (e) => e.preventDefault());
        list.addEventListener('click', (e) => { const b = e.target.closest('[data-id]'); if (b) { current = b.dataset.id; draw(); onChange && onChange(current); } });
        input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 150));
      }
    };
    draw();
    return { get: () => current, set: (v) => { current = v; draw(); } };
  }
  function multiPicker(el, { values = [], exclude = [], placeholder = 'Add a person', people = null } = {}) {
    let vals = [...values];
    const tags = document.createElement('div'); tags.className = 'tags';
    const pickHost = document.createElement('div');
    el.innerHTML = ''; el.append(tags, pickHost);
    const drawTags = () => {
      tags.innerHTML = vals.map((v) => { const p = S.allPeople.find((x) => x.id === v); return p ? `<span class="tag">${esc(F.fullName(p))}<button type="button" data-rm="${esc(v)}" aria-label="Remove">✕</button></span>` : ''; }).join('');
    };
    tags.addEventListener('click', (e) => { const b = e.target.closest('[data-rm]'); if (b) { vals = vals.filter((x) => x !== b.dataset.rm); drawTags(); } });
    const pk = personPicker(pickHost, { exclude, placeholder, people, onChange: (id) => { if (id && !vals.includes(id)) vals.push(id); drawTags(); pk.set(null); } });
    drawTags();
    return { get: () => vals };
  }

  // ---------- modal helper ----------
  function openModal(title, bodyHTML, footHTML, { wide = false } = {}) {
    const host = $('#modalHost');
    host.innerHTML = `<div class="modal-wrap"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="mTitle" ${wide ? 'style="width:min(780px,100%)"' : ''}>
      <div class="modal-head"><h2 id="mTitle">${esc(title)}</h2><button class="btn sm icon" type="button" data-close aria-label="Close">✕</button></div>
      <form class="modal-form" novalidate><div class="modal-body">${bodyHTML}</div>${footHTML ? `<div class="modal-foot">${footHTML}</div>` : ''}</form></div></div>`;
    const wrap = $('.modal-wrap', host);
    const close = () => { host.innerHTML = ''; if (location.hash === '#add') setHash(''); };
    $('[data-close]', wrap).onclick = close;
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
    $$('[data-cancel]', wrap).forEach((b) => { b.onclick = close; });
    setTimeout(() => $('input:not([type=hidden]):not(.hp):not([type=radio]):not([type=file]), select, textarea', wrap)?.focus({ preventScroll: true }), 40);
    return { wrap, form: $('form', wrap), close };
  }

  const personFieldsHTML = (p = {}, { photos = true, prefix = 'f' } = {}) => `
    <div class="grid2">
      <div class="field"><label for="${prefix}First">First name *</label><input id="${prefix}First" name="first_name" type="text" required maxlength="80" value="${esc(p.first_name)}" placeholder="e.g. Mohammad Yusuf"></div>
      <div class="field"><label for="${prefix}Last">Family name</label><input id="${prefix}Last" name="last_name" type="text" maxlength="80" value="${esc(p.last_name)}" placeholder="e.g. Siddiqui"></div>
      <div class="field"><label for="${prefix}Middle">Middle name</label><input id="${prefix}Middle" name="middle_name" type="text" maxlength="80" value="${esc(p.middle_name)}"></div>
      <div class="field"><label for="${prefix}Maiden">Family name at birth (if changed)</label><input id="${prefix}Maiden" name="maiden_name" type="text" maxlength="80" value="${esc(p.maiden_name)}"></div>
      <div class="field"><label for="${prefix}Nick">Known in the family as</label><input id="${prefix}Nick" name="nickname" type="text" maxlength="80" value="${esc(p.nickname)}" placeholder="e.g. Bade Abba, Bi Apa"></div>
      <div class="field"><span class="lbl" id="${prefix}GenderL">Gender</span>
        <div class="seg" role="radiogroup" aria-labelledby="${prefix}GenderL">
          ${[['male', 'Male'], ['female', 'Female'], ['other', 'Other']].map(([g, l]) => `<label><input type="radio" name="gender" value="${g}" ${p.gender === g ? 'checked' : ''}><span>${l}</span></label>`).join('')}
        </div></div>
    </div>
    <div class="field"><span class="lbl" id="${prefix}LivingL">Status</span>
      <div class="seg" role="radiogroup" aria-labelledby="${prefix}LivingL">
        <label><input type="radio" name="is_living" value="yes" ${p.is_living !== false && !p.death_date ? 'checked' : ''}><span>Living</span></label>
        <label><input type="radio" name="is_living" value="no" ${p.is_living === false || p.death_date ? 'checked' : ''}><span>Passed away</span></label>
      </div></div>
    <div class="grid2">
      <div class="field"><label for="${prefix}Birth">Date of birth</label><input id="${prefix}Birth" name="birth_date" type="text" inputmode="numeric" placeholder="1950 or 1950-08-15" value="${esc(p.birth_date)}"><span class="hint">Year only is fine</span></div>
      <div class="field"><label for="${prefix}BirthPlace">Place of birth</label><input id="${prefix}BirthPlace" name="birth_place" type="text" maxlength="120" value="${esc(p.birth_place)}"></div>
      <div class="field" data-dead><label for="${prefix}Death">Date of passing</label><input id="${prefix}Death" name="death_date" type="text" inputmode="numeric" placeholder="2001 or 2001-03-02" value="${esc(p.death_date)}"></div>
      <div class="field" data-dead><label for="${prefix}DeathPlace">Place of passing</label><input id="${prefix}DeathPlace" name="death_place" type="text" maxlength="120" value="${esc(p.death_place)}"></div>
      <div class="field" data-alive><label for="${prefix}Current">Lives in</label><input id="${prefix}Current" name="current_place" type="text" maxlength="120" value="${esc(p.current_place)}"></div>
      <div class="field"><label for="${prefix}Occ">Occupation</label><input id="${prefix}Occ" name="occupation" type="text" maxlength="120" value="${esc(p.occupation)}"></div>
    </div>
    <div class="field"><label for="${prefix}Bio">Story, memories or notes</label><textarea id="${prefix}Bio" name="bio" maxlength="5000">${esc(p.bio)}</textarea></div>
    ${photos ? `<div class="field"><span class="lbl">Photo</span><div class="photo-pick"><div>${portraitHTML(p, '')}</div><div><input id="${prefix}Photo" name="photo" type="file" accept="image/*"><div class="hint">A clear face photo. It is resized automatically.</div>${p.photo_url ? `<label style="display:flex;gap:6px;align-items:center;margin-top:6px;font-size:.88rem"><input type="checkbox" name="remove_photo" id="${prefix}RmPhoto"> Remove current photo</label>` : ''}</div></div></div>` : ''}`;

  function wireLiving(form) {
    const sync = () => {
      const dead = form.querySelector('input[name=is_living][value=no]').checked;
      $$('[data-dead]', form).forEach((x) => { x.hidden = !dead; });
      $$('[data-alive]', form).forEach((x) => { x.hidden = dead; });
    };
    $$('input[name=is_living]', form).forEach((r) => r.addEventListener('change', sync)); sync();
    const file = form.querySelector('input[name=photo]');
    if (file) file.addEventListener('change', () => {
      const f = file.files[0]; const prev = file.closest('.photo-pick').firstElementChild;
      if (f) prev.innerHTML = `<div class="portrait"><img src="${URL.createObjectURL(f)}" alt="Selected photo"></div>`;
    });
  }
  function readPerson(form) {
    const fd = new FormData(form); const o = {};
    for (const k of ['first_name', 'middle_name', 'last_name', 'maiden_name', 'nickname', 'gender', 'birth_date', 'birth_place', 'death_date', 'death_place', 'current_place', 'occupation', 'bio']) {
      const v = (fd.get(k) || '').toString().trim(); o[k] = v || null;
    }
    o.is_living = fd.get('is_living') !== 'no';
    if (o.is_living) { o.death_date = null; o.death_place = null; } else o.current_place = null;
    return o;
  }
  function validatePerson(form, o) {
    $$('.field.err', form).forEach((x) => x.classList.remove('err'));
    const errs = [];
    if (!o.first_name) { errs.push('Enter a first name.'); form.querySelector('[name=first_name]').closest('.field').classList.add('err'); }
    for (const k of ['birth_date', 'death_date']) if (!F.validDate(o[k])) { errs.push('Write dates as a year (1950) or year-month-day (1950-08-15).'); form.querySelector(`[name=${k}]`).closest('.field').classList.add('err'); }
    return errs;
  }
  const submitterHTML = (s, p) => `
    <fieldset class="fieldset"><legend>About you</legend>
      <div class="grid2">
        <div class="field"><label for="${p}You">Your name *</label><input id="${p}You" name="sub_name" type="text" required maxlength="100"></div>
        <div class="field"><label for="${p}Email">Email${s.require_email ? ' *' : ''}</label><input id="${p}Email" name="sub_email" type="email" maxlength="160"></div>
        <div class="field"><label for="${p}Phone">Phone${s.require_phone ? ' *' : ''}</label><input id="${p}Phone" name="sub_phone" type="tel" maxlength="30"></div>
        <div class="field"><label for="${p}RelYou">Your relation to them</label><input id="${p}RelYou" name="sub_relation" type="text" maxlength="80" placeholder="e.g. grandson, bhatija"></div>
      </div>
      <div class="field"><label for="${p}Note">Message for the admin</label><textarea id="${p}Note" name="sub_note" maxlength="2000" placeholder="Sources, extra details, or anything to check"></textarea></div>
      <input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
    </fieldset>`;
  function readSubmitter(fd, s, errs) {
    const sub = { name: (fd.get('sub_name') || '').toString().trim(), email: (fd.get('sub_email') || '').toString().trim(), phone: (fd.get('sub_phone') || '').toString().trim(), relation_to_person: (fd.get('sub_relation') || '').toString().trim(), note: (fd.get('sub_note') || '').toString().trim() };
    if (!sub.name) errs.push('Enter your name so the admin knows who sent this.');
    if (s.require_email && !/^\S+@\S+\.\S+$/.test(sub.email)) errs.push('Enter a valid email address.');
    if (s.require_phone && sub.phone.replace(/\D/g, '').length < 7) errs.push('Enter a phone number.');
    return sub;
  }
  function canVisitorSend() {
    if (!S.settings.submissions_open) { toast('New entries are closed right now.'); return false; }
    if (!S.canSubmit) { toast('Your access to this page is view-only, so you can\'t send entries.'); return false; }
    return true;
  }

  // ---------- relation chooser ----------
  const RELATIONS = [['child', 'Child of'], ['spouse', 'Husband / wife of'], ['parent', 'Parent of'], ['sibling', 'Brother / sister of'], ['none', 'Not sure / first entry']];
  function openRelChooser(id) {
    const p = S.idx.byId.get(id) || S.allPeople.find((x) => x.id === id); if (!p) return;
    if (!admin() && !canVisitorSend()) return;
    const n = esc(F.shortName(p));
    const m = openModal(`Add a relative of ${F.shortName(p)}`, `<div class="choice-grid">
      <button class="choice" type="button" data-rel="child"><b>Son or daughter</b><small>A child of ${n}</small></button>
      <button class="choice" type="button" data-rel="spouse"><b>Husband or wife</b><small>Married to ${n}</small></button>
      <button class="choice" type="button" data-rel="parent"><b>Father or mother</b><small>A parent of ${n}</small></button>
      <button class="choice" type="button" data-rel="sibling"><b>Brother or sister</b><small>Shares ${n}'s parents</small></button></div>`, '');
    $$('[data-rel]', m.wrap).forEach((b) => { b.onclick = () => { m.close(); openAdd({ relativeId: id, relation: b.dataset.rel }); }; });
  }

  // ---------- public submission forms ----------
  function openAdd({ relativeId = null, relation = 'child', name = '' } = {}) {
    if (admin()) { openEditor(null, { relativeId, relation, name }); return; }
    if (!canVisitorSend()) return;
    const s = S.settings;
    const [first, ...rest] = name.split(' ');
    const rel = relativeId && S.idx.byId.get(relativeId);
    const body = `
      <p class="muted" style="margin:0">Tell us about the person you'd like to add. The family admin checks every entry before it appears in the shijra.</p>
      <fieldset class="fieldset"><legend>How are they related?</legend>
        <div class="grid2">
          <div class="field"><label for="aRel">They are the…</label><select id="aRel" name="relation">${RELATIONS.map(([v, l]) => `<option value="${v}" ${v === relation ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          <div class="field" id="aRelWrap"><span class="lbl">…this person in the tree</span><div id="aRelPick"></div></div>
        </div>
      </fieldset>
      <fieldset class="fieldset"><legend>About them</legend>${personFieldsHTML({ first_name: first || '', last_name: rest.join(' ') || (relation === 'child' && rel && rel.gender !== 'female' ? rel.last_name : '') }, { photos: s.allow_photos, prefix: 'a' })}</fieldset>
      ${submitterHTML(s, 'a')}
      <div class="form-error" id="aErr" role="alert"></div>`;
    const m = openModal('Add a family member', body, '<button class="btn" type="button" data-cancel>Cancel</button><button class="btn primary" type="submit">Send for review</button>');
    wireLiving(m.form);
    const pick = personPicker($('#aRelPick', m.wrap), { value: relativeId, placeholder: 'Search the tree' });
    const relSel = $('#aRel', m.wrap);
    const syncRel = () => { $('#aRelWrap', m.wrap).hidden = relSel.value === 'none'; };
    relSel.onchange = syncRel; syncRel();
    m.form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(m.form);
      if (fd.get('website')) { m.close(); return; }
      const person = readPerson(m.form);
      const errs = validatePerson(m.form, person);
      const sub = readSubmitter(fd, s, errs);
      if (relSel.value !== 'none' && !pick.get()) errs.push('Choose who they are related to, or pick "Not sure".');
      $('#aErr', m.wrap).textContent = errs[0] || '';
      if (errs.length) return;
      const btn = $('button[type=submit]', m.wrap); btn.disabled = true; btn.textContent = 'Sending…';
      try {
        const file = m.form.querySelector('input[name=photo]')?.files[0];
        if (file) person.photo_url = await S.store.uploadPhoto(await compressImage(file, S.store.photoMax), 'submissions');
        await S.store.submit({ id: F.uid(), type: 'new', relation: relSel.value, relative_id: relSel.value === 'none' ? null : pick.get(), person, submitter: sub, status: 'pending', created_at: new Date().toISOString() });
        $('.modal-body', m.wrap).innerHTML = `<div class="success"><svg width="56" height="56" viewBox="0 0 24 24" style="color:var(--gold)"><use href="#i-star"/></svg><h3>JazakAllah, ${esc(sub.name.split(' ')[0])}!</h3><p>${esc(person.first_name)} has been sent to the family admin. Once approved, they'll appear in the shijra.</p></div>`;
        $('.modal-foot', m.wrap).innerHTML = '<button class="btn" type="button" data-again>Add another</button><button class="btn primary" type="button" data-done>Done</button>';
        $('[data-done]', m.wrap).onclick = m.close;
        $('[data-again]', m.wrap).onclick = () => openAdd({ relativeId: relSel.value === 'none' ? null : pick.get(), relation: relSel.value });
      } catch (err) {
        btn.disabled = false; btn.textContent = 'Send for review';
        $('#aErr', m.wrap).textContent = 'Couldn\'t send: ' + (err.message || err) + '. Please try again.';
      }
    });
  }

  function openSuggest(id) {
    const p = S.idx.byId.get(id); if (!p || !canVisitorSend()) return;
    const s = S.settings;
    const shown = isPrivate(p) ? { ...p, birth_date: '', birth_place: '', current_place: '' } : p;
    const body = `
      <p class="muted" style="margin:0">Change anything that's wrong or missing for <b>${esc(F.fullName(p))}</b>. The admin reviews it before it goes live.</p>
      <fieldset class="fieldset"><legend>Details</legend>${personFieldsHTML(shown, { photos: s.allow_photos, prefix: 'c' })}</fieldset>
      ${submitterHTML(s, 'c')}<div class="form-error" id="cErr" role="alert"></div>`;
    const m = openModal('Suggest an edit', body, '<button class="btn" type="button" data-cancel>Cancel</button><button class="btn primary" type="submit">Send for review</button>');
    wireLiving(m.form);
    m.form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(m.form);
      if (fd.get('website')) { m.close(); return; }
      const person = readPerson(m.form);
      const errs = validatePerson(m.form, person);
      const sub = readSubmitter(fd, s, errs);
      $('#cErr', m.wrap).textContent = errs[0] || '';
      if (errs.length) return;
      const btn = $('button[type=submit]', m.wrap); btn.disabled = true; btn.textContent = 'Sending…';
      try {
        const file = m.form.querySelector('input[name=photo]')?.files[0];
        if (file) person.photo_url = await S.store.uploadPhoto(await compressImage(file, S.store.photoMax), 'submissions');
        if (fd.get('remove_photo')) person.remove_photo = true;
        await S.store.submit({ id: F.uid(), type: 'edit', target_id: id, relation: 'none', person, submitter: sub, status: 'pending', created_at: new Date().toISOString() });
        m.close(); toast('Thank you. Your edit was sent for review.');
      } catch (err) { btn.disabled = false; btn.textContent = 'Send for review'; $('#cErr', m.wrap).textContent = 'Couldn\'t send: ' + (err.message || err); }
    });
  }

  function openRemoval(id) {
    const p = S.idx.byId.get(id); if (!p || !canVisitorSend()) return;
    const s = S.settings;
    const body = `<p class="muted" style="margin:0">Ask the admin to remove or hide <b>${esc(F.fullName(p))}</b>. Please explain why, for example a duplicate entry or a privacy request.</p>
      <div class="field"><label for="rWhy">Reason *</label><textarea id="rWhy" name="why" maxlength="1500" required></textarea></div>
      ${submitterHTML(s, 'r')}<div class="form-error" id="rErr" role="alert"></div>`;
    const m = openModal('Request removal', body, '<button class="btn" type="button" data-cancel>Cancel</button><button class="btn danger solid" type="submit">Send request</button>');
    m.form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(m.form);
      if (fd.get('website')) { m.close(); return; }
      const errs = [];
      const why = (fd.get('why') || '').toString().trim();
      if (!why) errs.push('Tell the admin why this entry should be removed.');
      const sub = readSubmitter(fd, s, errs);
      sub.note = [why, sub.note].filter(Boolean).join('\n\n');
      $('#rErr', m.wrap).textContent = errs[0] || '';
      if (errs.length) return;
      try {
        await S.store.submit({ id: F.uid(), type: 'remove', target_id: id, relation: 'none', person: { first_name: p.first_name, last_name: p.last_name }, submitter: sub, status: 'pending', created_at: new Date().toISOString() });
        m.close(); toast('Your removal request was sent to the admin.');
      } catch (err) { $('#rErr', m.wrap).textContent = 'Couldn\'t send: ' + (err.message || err); }
    });
  }

  // ---------- admin: person editor ----------
  /** Admin-only actions explain why they can't run instead of doing nothing. */
  function needAdmin() {
    if (admin()) return true;
    if (S.isAdmin && S.previewVisitor) toast('You are viewing as a visitor. Tap "Back to admin view" first.');
    else toast('Sign in as admin to do this.');
    return false;
  }
  function openEditor(id, pre = {}) {
    if (!needAdmin()) return;
    const existing = id ? S.allPeople.find((x) => x.id === id) : null;
    let p = existing ? { ...existing } : { id: F.uid(), visible: true, spouse_ids: [], is_living: true };
    if (pre.values) p = { ...p, ...Object.fromEntries(Object.entries(pre.values).filter(([k, v]) => v !== null && v !== '' && k !== 'remove_photo')) };
    if (pre.values && pre.values.remove_photo) p.photo_url = null;
    if (!existing && pre.name) { const [a, ...b] = pre.name.split(' '); p.first_name = p.first_name || a; p.last_name = p.last_name || b.join(' '); }
    let afterSave = null;
    const rel = pre.relativeId && S.allPeople.find((x) => x.id === pre.relativeId);
    const allIdx = F.buildIndex(S.allPeople);
    if (!existing && rel) {
      if (pre.relation === 'child') {
        if (rel.gender === 'female') p.mother_id = rel.id; else p.father_id = rel.id;
        const sp = F.spouses(allIdx, rel.id);
        if (sp.length === 1) { if (rel.gender === 'female') p.father_id = sp[0].id; else p.mother_id = sp[0].id; }
        if (!p.last_name) { const dad = allIdx.byId.get(p.father_id); if (dad) p.last_name = dad.last_name; }
      } else if (pre.relation === 'spouse') p.spouse_ids = [rel.id];
      else if (pre.relation === 'sibling') { p.father_id = rel.father_id; p.mother_id = rel.mother_id; if (!p.last_name) p.last_name = rel.gender === 'female' ? rel.maiden_name || rel.last_name : rel.last_name; }
      else if (pre.relation === 'parent') afterSave = async (np) => {
        const key = np.gender === 'female' ? 'mother_id' : 'father_id';
        const fresh = S.allPeople.find((x) => x.id === rel.id) || rel;
        if (!fresh[key]) await S.store.savePerson({ ...fresh, [key]: np.id });
        else toast(`${F.shortName(rel)} already has a ${np.gender === 'female' ? 'mother' : 'father'} recorded. Link them by hand if needed.`);
      };
    }
    const relNote = !existing && rel && pre.relation && pre.relation !== 'none' ? `<div class="card" style="background:var(--gold-soft);border:0;padding:12px 16px">Adding the <b>${esc((RELATIONS.find((r) => r[0] === pre.relation) || [, ''])[1].toLowerCase())}</b> <b>${esc(F.fullName(rel))}</b>. Family links below are filled in for you.</div>` : '';
    const title = existing ? `Edit ${F.shortName(existing)}` : pre.fromSub ? 'Review and add to the shijra' : 'Add a person';
    const body = `
      ${pre.fromSub ? `<div class="card" style="background:var(--gold-soft);border:0"><b>Sent by ${esc(pre.fromSub.submitter?.name || 'a visitor')}</b>${pre.fromSub.submitter?.note ? `<div>${esc(pre.fromSub.submitter.note)}</div>` : ''}<div class="hint">Check and edit anything below, then publish it.</div></div>` : relNote}
      ${personFieldsHTML(p, { photos: true, prefix: 'e' })}
      <fieldset class="fieldset"><legend>Family links</legend>
        <div class="grid2">
          <div class="field"><span class="lbl">Father</span><div id="eFather"></div></div>
          <div class="field"><span class="lbl">Mother</span><div id="eMother"></div></div>
        </div>
        <div class="field"><span class="lbl">Husband / wife</span><div id="eSpouses"></div></div>
      </fieldset>
      <div class="switch"><div class="txt"><b>Show on the public shijra</b><small>Turn off to keep this person visible to admins only.</small></div><label class="toggle"><input type="checkbox" id="eVisible" ${p.visible !== false ? 'checked' : ''} aria-label="Show on the public shijra"><span></span></label></div>
      <div class="form-error" id="eErr" role="alert"></div>`;
    const foot = `${existing ? `<button class="btn danger" type="button" data-del style="margin-right:auto">${icon('i-trash')}Delete</button>` : ''}<button class="btn" type="button" data-cancel>Cancel</button><button class="btn primary" type="submit">${pre.fromSub ? 'Approve and publish' : existing ? 'Save changes' : 'Add to shijra'}</button>`;
    const m = openModal(title, body, foot, { wide: true });
    wireLiving(m.form);
    const everyone = () => S.allPeople;
    const fPick = personPicker($('#eFather', m.wrap), { value: p.father_id, exclude: [p.id], people: everyone });
    const mPick = personPicker($('#eMother', m.wrap), { value: p.mother_id, exclude: [p.id], people: everyone });
    const spPick = multiPicker($('#eSpouses', m.wrap), { values: [...new Set([...(p.spouse_ids || []), ...F.spouses(allIdx, p.id).map((x) => x.id)])], exclude: [p.id], people: everyone });
    const del = $('[data-del]', m.wrap);
    if (del) del.onclick = async () => { m.close(); await askDelete(existing.id); };
    m.form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const vals = readPerson(m.form);
      const errs = validatePerson(m.form, vals);
      $('#eErr', m.wrap).textContent = errs[0] || '';
      if (errs.length) return;
      const btn = $('button[type=submit]', m.wrap); const label = btn.textContent; btn.disabled = true; btn.textContent = 'Saving…';
      try {
        const np = { ...p, ...vals, father_id: fPick.get(), mother_id: mPick.get(), spouse_ids: spPick.get(), visible: $('#eVisible', m.wrap).checked };
        if (!existing) np.created_at = new Date().toISOString();
        const file = m.form.querySelector('input[name=photo]')?.files[0];
        if (file) np.photo_url = await S.store.uploadPhoto(await compressImage(file, S.store.photoMax), 'people');
        else if (m.form.querySelector('input[name=remove_photo]')?.checked) np.photo_url = null;
        np.slug = existing?.slug || F.slugify(np);
        await savePersonWithLinks(np, existing);
        if (afterSave) await afterSave(np);
        if (pre.fromSub) await S.store.updateSubmission(pre.fromSub, { status: 'approved', person_id: np.id, reviewed_at: new Date().toISOString() });
        m.close(); toast(pre.fromSub ? `${F.shortName(np)} is now in the shijra.` : existing ? 'Changes saved.' : `${F.shortName(np)} added to the shijra.`);
        if (!S.adminOpen) setTimeout(() => { reveal(np.id); openProfile(np.id); }, 300);
      } catch (err) { btn.disabled = false; btn.textContent = label; $('#eErr', m.wrap).textContent = 'Couldn\'t save: ' + (err.message || err); }
    });
  }

  /** Save a person and keep husband/wife links two-way. */
  async function savePersonWithLinks(np, old) {
    await S.store.savePerson(np);
    const before = new Set(old ? old.spouse_ids || [] : []);
    const after = new Set(np.spouse_ids || []);
    for (const q of S.allPeople) if ((q.spouse_ids || []).includes(np.id)) before.add(q.id);
    for (const sid of after) {
      const s = S.allPeople.find((x) => x.id === sid);
      if (s && !(s.spouse_ids || []).includes(np.id)) await S.store.savePerson({ ...s, spouse_ids: [...(s.spouse_ids || []), np.id] });
    }
    for (const sid of before) {
      if (after.has(sid)) continue;
      const s = S.allPeople.find((x) => x.id === sid);
      if (s && (s.spouse_ids || []).includes(np.id)) await S.store.savePerson({ ...s, spouse_ids: s.spouse_ids.filter((x) => x !== np.id) });
    }
  }
  async function deletePerson(id) {
    for (const q of S.allPeople) {
      const patch = {};
      if (q.father_id === id) patch.father_id = null;
      if (q.mother_id === id) patch.mother_id = null;
      if ((q.spouse_ids || []).includes(id)) patch.spouse_ids = q.spouse_ids.filter((x) => x !== id);
      if (Object.keys(patch).length) await S.store.savePerson({ ...q, ...patch });
    }
    await S.store.deletePerson(id);
    if (S.settings.root_id === id) await S.store.saveSettings({ ...S.settings, root_id: null });
  }
  async function askDelete(id) {
    const p = S.allPeople.find((x) => x.id === id); if (!p || !needAdmin()) return false;
    const kids = S.allPeople.filter((q) => q.father_id === id || q.mother_id === id).length;
    const ok = await confirmBox(`Delete ${F.shortName(p)}?`, `${F.fullName(p)} will be removed from the shijra.${kids ? ` Their ${kids} child${kids === 1 ? '' : 'ren'} will stay but lose this parent link.` : ''} This can't be undone. To keep them but hide them from visitors, use Edit and turn off "Show on the public shijra" instead.`);
    if (!ok) return false;
    try { await deletePerson(id); if (S.openProfileId === id) closeDrawer(); toast(`${F.shortName(p)} was deleted.`); return true; }
    catch (err) { toast('Couldn\'t delete: ' + (err.message || err)); return false; }
  }

  // ---------- admin panel ----------
  function openAdmin() {
    // The admin panel always works as admin, so leave "View as visitor" first.
    if (S.previewVisitor) { S.previewVisitor = false; applySettings(); applyVisibility(); }
    S.adminOpen = true; setHash('admin'); document.body.classList.add('no-scroll'); renderAdmin();
  }
  function closeAdmin() { S.adminOpen = false; $('#adminHost').innerHTML = ''; document.body.classList.toggle('no-scroll', XP.max); if (location.hash === '#admin') setHash(''); }

  function renderAdmin() {
    const host = $('#adminHost');
    const head = (extra) => `<div class="admin-top"><h2><svg aria-hidden="true"><use href="#i-star"/></svg>Shijra admin</h2>${extra}<button class="btn sm gold" type="button" data-action="close-admin">Back to the shijra</button></div>`;
    if (!S.isAdmin) {
      host.innerHTML = `<div class="admin">${head('')}<div class="admin-body">${S.store.supportsLogin ? loginHTML() : `<div class="card login"><h3>Admins only</h3><p class="muted">Only the site owner and editors can review entries. If you manage this shijra, ask the owner to give you Editor access.</p></div>`}</div></div>`;
      wireLogin(); return;
    }
    const pending = S.subs.filter((x) => x.status === 'pending').length;
    const tabs = [['pending', 'Submissions', pending], ['people', 'People', S.allPeople.length], ['settings', 'Settings'], ['data', 'Data']];
    const scrollTop = $('.admin-body', host)?.scrollTop || 0;
    host.innerHTML = `<div class="admin">
      ${head(`<button class="btn sm" type="button" data-action="preview-visitor">View as visitor</button>${S.store.supportsLogin ? '<button class="btn sm" type="button" data-action="logout">Sign out</button>' : ''}`)}
      <div class="tabs" role="tablist">${tabs.map(([k, l, n]) => `<button class="tab" role="tab" type="button" aria-selected="${S.adminTab === k}" data-tab="${k}">${l}${n ? ` <span class="badge" ${k === 'pending' ? '' : 'style="background:rgb(255 255 255 / .18)"'}>${n}</span>` : ''}</button>`).join('')}</div>
      <div class="admin-body"><div class="admin-inner" id="adminInner"></div></div></div>`;
    $$('.tab', host).forEach((t) => { t.onclick = () => { S.adminTab = t.dataset.tab; renderAdmin(); }; });
    const inner = $('#adminInner', host);
    ({ pending: adminPending, people: adminPeople, settings: adminSettings, data: adminData })[S.adminTab](inner);
    $('.admin-body', host).scrollTop = scrollTop;
  }

  function loginHTML() {
    return `<form class="card login" id="loginForm"><h3>Admin sign in</h3><p class="muted">Use the admin account created in Supabase.</p>
      <div class="field"><label for="lEmail">Email</label><input id="lEmail" type="email" required autocomplete="username"></div>
      <div class="field"><label for="lPass">Password</label><input id="lPass" type="password" required autocomplete="current-password"></div>
      <div class="form-error" id="lErr" role="alert"></div>
      <div class="toolbar" style="margin-top:12px"><button class="btn primary" type="submit">Sign in</button><button class="btn ghost" type="button" id="lReset">Forgot password?</button></div></form>`;
  }
  function wireLogin() {
    const f = $('#loginForm'); if (!f) return;
    f.addEventListener('submit', async (e) => {
      e.preventDefault(); $('#lErr').textContent = '';
      const b = $('button[type=submit]', f); b.disabled = true; b.textContent = 'Signing in…';
      try { await S.store.login($('#lEmail').value.trim(), $('#lPass').value); S.isAdmin = true; applySettings(); applyVisibility(); toast('Signed in.'); }
      catch (err) { $('#lErr').textContent = err.message || String(err); b.disabled = false; b.textContent = 'Sign in'; }
    });
    $('#lReset').onclick = async () => {
      const email = $('#lEmail').value.trim();
      if (!email) { $('#lErr').textContent = 'Enter your email first, then tap Forgot password.'; return; }
      try { await S.store.resetPassword(email); toast('Password reset email sent.'); } catch (err) { $('#lErr').textContent = err.message; }
    };
  }

  function subSummary(sub) {
    const per = sub.person || {};
    const rel = sub.relative_id && S.allPeople.find((x) => x.id === sub.relative_id);
    const target = sub.target_id && S.allPeople.find((x) => x.id === sub.target_id);
    const relLabel = (RELATIONS.find((r) => r[0] === sub.relation) || [, ''])[1];
    const rows = [];
    const add = (k, v) => { if (v) rows.push(`<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`); };
    if (sub.type === 'edit') {
      for (const [k, label] of [['first_name', 'First name'], ['middle_name', 'Middle'], ['last_name', 'Family name'], ['maiden_name', 'Born as'], ['nickname', 'Known as'], ['gender', 'Gender'], ['birth_date', 'Born'], ['birth_place', 'Birthplace'], ['death_date', 'Passed away'], ['death_place', 'Place of passing'], ['current_place', 'Lives in'], ['occupation', 'Occupation'], ['bio', 'Story']]) {
        const nv = per[k] ?? null, ov = target ? target[k] ?? null : null;
        if ((nv || '') !== (ov || '') && nv) add(label, `${ov ? ov + ' → ' : ''}${nv}`);
      }
      if (target && per.is_living === false && F.isLiving(target)) add('Status', 'Marked as passed away');
      if (per.remove_photo) add('Photo', 'Asked to remove photo');
      if (per.photo_url) add('Photo', 'New photo attached');
    } else if (sub.type === 'new') {
      add('Name', F.fullName(per)); add('Known as', per.nickname); add('Gender', per.gender);
      add('Born', [per.birth_date, per.birth_place].filter(Boolean).join(', '));
      if (per.is_living === false) add('Passed away', [per.death_date, per.death_place].filter(Boolean).join(', ') || 'Yes');
      add('Lives in', per.current_place); add('Occupation', per.occupation); add('Story', per.bio);
    }
    const contact = [sub.submitter?.email, sub.submitter?.phone].filter(Boolean).join(' · ');
    const title = sub.type === 'edit' ? `Edit for ${target ? F.fullName(target) : 'a deleted person'}` : sub.type === 'remove' ? `Remove ${target ? F.fullName(target) : F.fullName(per)}` : F.fullName(per);
    const kind = { new: 'New member', edit: 'Edit', remove: 'Removal request' }[sub.type] || sub.type;
    let actions = '';
    if (sub.status === 'pending') {
      if (sub.type === 'remove') actions = target ? `<button class="btn sm" type="button" data-sub="hide" data-sid="${esc(sub.id)}">Hide from visitors</button><button class="btn danger sm" type="button" data-sub="remove" data-sid="${esc(sub.id)}">${icon('i-trash')}Delete person</button><button class="btn sm ghost" type="button" data-sub="reject" data-sid="${esc(sub.id)}">Keep and reject</button>` : `<button class="btn sm" type="button" data-sub="reject" data-sid="${esc(sub.id)}">Close request</button>`;
      else actions = `<button class="btn primary sm" type="button" data-sub="review" data-sid="${esc(sub.id)}">Review and approve</button><button class="btn sm" type="button" data-sub="reject" data-sid="${esc(sub.id)}">Reject</button>`;
    } else if (sub.person_id) actions = `<button class="btn sm" type="button" data-sub="view" data-sid="${esc(sub.id)}">View in tree</button>`;
    return `<div class="card sub-card">
      ${portraitHTML(sub.type !== 'new' && !per.photo_url ? target || per : per, '')}
      <div style="min-width:0">
        <div class="toolbar"><h3 style="margin:0">${esc(title)}</h3><span class="kind ${sub.type === 'remove' ? 'remove' : ''}">${esc(kind)}</span><span class="status ${esc(sub.status)}">${esc(cap(sub.status))}</span></div>
        <div class="meta">${sub.type === 'new' ? (rel ? `${esc(relLabel)} <b>${esc(F.fullName(rel))}</b> · ` : sub.relation === 'none' ? 'No relation given · ' : '') : ''}Sent by <b>${esc(sub.submitter?.name || 'Unknown')}</b>${sub.submitter?.relation_to_person ? ` (${esc(sub.submitter.relation_to_person)})` : ''}${contact ? ` · <span style="user-select:all">${esc(contact)}</span>` : ''}${sub.created_at ? ` · ${esc(new Date(sub.created_at).toLocaleDateString())}` : ''}</div>
        ${rows.length ? `<dl>${rows.join('')}</dl>` : sub.type === 'edit' ? '<p class="muted">No changes listed.</p>' : ''}
        ${sub.submitter?.note ? `<div class="meta" style="margin-top:6px;white-space:pre-wrap"><b>Message:</b> ${esc(sub.submitter.note)}</div>` : ''}
        <div class="sub-actions">${actions}<button class="btn sm ghost" type="button" data-sub="delete" data-sid="${esc(sub.id)}">Delete entry</button></div>
      </div></div>`;
  }
  let subFilter = 'pending';
  function adminPending(el) {
    const list = S.subs.filter((x) => subFilter === 'all' || x.status === subFilter);
    el.innerHTML = `<div class="toolbar"><div class="seg" role="radiogroup" aria-label="Filter">${[['pending', 'Waiting'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['all', 'All']].map(([v, l]) => `<label><input type="radio" name="sf" value="${v}" ${subFilter === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
      <span class="muted" style="margin-left:auto">Visitor entries are ${S.settings.submissions_open ? '<b style="color:var(--ok)">open</b>' : '<b style="color:var(--danger)">closed</b>'}. Change this in Settings.</span></div>
      ${list.length ? list.map(subSummary).join('') : `<div class="card"><h3>${subFilter === 'pending' ? 'Nothing waiting for review' : 'No entries here'}</h3><p class="muted">When visitors use <b>Add member</b>, <b>Suggest an edit</b> or <b>Request removal</b>, their entries appear here for you to check and approve.</p></div>`}`;
    $$('input[name=sf]', el).forEach((r) => { r.onchange = () => { subFilter = r.value; renderAdmin(); }; });
    el.onclick = async (e) => {
      const b = e.target.closest('[data-sub]'); if (!b) return;
      const sub = S.subs.find((x) => x.id === b.dataset.sid); if (!sub) return;
      const now = new Date().toISOString();
      try {
        switch (b.dataset.sub) {
          case 'review':
            if (sub.type === 'edit') {
              if (!S.allPeople.find((x) => x.id === sub.target_id)) { toast('That person was deleted. Reject this edit instead.'); return; }
              openEditor(sub.target_id, { values: sub.person, fromSub: sub });
            } else openEditor(null, { values: sub.person, relativeId: sub.relative_id, relation: sub.relation, fromSub: sub });
            break;
          case 'reject': await S.store.updateSubmission(sub, { status: 'rejected', reviewed_at: now }); toast('Marked as rejected.'); break;
          case 'hide': {
            const t = S.allPeople.find((x) => x.id === sub.target_id);
            await S.store.savePerson({ ...t, visible: false }); await S.store.updateSubmission(sub, { status: 'approved', reviewed_at: now }); toast(`${F.shortName(t)} is now hidden from visitors.`); break;
          }
          case 'remove': if (await askDelete(sub.target_id)) await S.store.updateSubmission(sub, { status: 'approved', reviewed_at: now }); break;
          case 'delete': if (await confirmBox('Delete this entry?', 'It will be removed from the list. People already added to the shijra stay.')) { await S.store.deleteSubmission(sub); toast('Entry deleted.'); } break;
          case 'view': closeAdmin(); reveal(sub.person_id); openProfile(sub.person_id); break;
          default:
        }
      } catch (err) { toast('Couldn\'t update: ' + (err.message || err)); }
    };
  }

  let peopleQuery = '', peopleFilter = 'all';
  function adminPeople(el) {
    const idx = F.buildIndex(S.allPeople);
    let list = peopleQuery ? F.search(idx, peopleQuery, 5000) : [...S.allPeople].sort((a, b) => F.fullName(a).localeCompare(F.fullName(b)));
    if (peopleFilter === 'hidden') list = list.filter((p) => p.visible === false);
    if (peopleFilter === 'nophoto') list = list.filter((p) => !p.photo_url);
    if (peopleFilter === 'unlinked') list = list.filter((p) => !p.father_id && !p.mother_id && !(idx.spouses.get(p.id) || new Set()).size && !(idx.children.get(p.id) || []).length);
    if (peopleFilter === 'sample') list = list.filter((p) => p.sample);
    const shown = list.slice(0, 300);
    el.innerHTML = `<div class="toolbar">
        <div class="field"><label for="pq" class="sr-only">Search people</label><input id="pq" type="search" placeholder="Search ${S.allPeople.length} people" value="${esc(peopleQuery)}"></div>
        <div class="field" style="flex:0 0 auto;min-width:170px"><label for="pf" class="sr-only">Filter</label><select id="pf">${[['all', 'Everyone'], ['hidden', 'Hidden from visitors'], ['nophoto', 'Without photo'], ['unlinked', 'Not linked to anyone'], ['sample', 'Sample entries']].map(([v, l]) => `<option value="${v}" ${peopleFilter === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <button class="btn primary" type="button" data-p="add">${icon('i-plus')}Add person</button></div>
      <div class="card table-wrap" style="padding:0"><table class="people-table"><thead><tr><th>Name</th><th>Years</th><th class="hide-sm">Parents</th><th>Public</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>
      ${shown.map((p) => `<tr><td><div class="who">${portraitHTML(p, 'sm')}<span>${esc(F.fullName(p))}${p.nickname ? `<br><small class="muted">${esc(p.nickname)}</small>` : ''}</span></div></td><td class="years">${esc(F.years(p, false))}</td>
        <td class="hide-sm muted">${esc(F.parents(idx, p).map(F.shortName).join(' & '))}</td>
        <td><label class="toggle"><input type="checkbox" data-vis="${esc(p.id)}" ${p.visible !== false ? 'checked' : ''} aria-label="Show ${esc(F.fullName(p))} publicly"><span></span></label></td>
        <td class="acts"><button class="btn sm" type="button" data-p="rel" data-id="${esc(p.id)}" title="Add relative" aria-label="Add a relative of ${esc(F.shortName(p))}">${icon('i-plus')}</button><button class="btn sm" type="button" data-p="edit" data-id="${esc(p.id)}">${icon('i-edit')}Edit</button><button class="btn sm danger" type="button" data-p="del" data-id="${esc(p.id)}" aria-label="Delete ${esc(F.fullName(p))}">${icon('i-trash')}</button></td></tr>`).join('') || '<tr><td colspan="5" class="muted">No one matches.</td></tr>'}
      </tbody></table></div>${list.length > shown.length ? `<p class="muted">Showing 300 of ${list.length}. Search to narrow the list.</p>` : ''}`;
    const q = $('#pq', el);
    q.oninput = () => { peopleQuery = q.value; clearTimeout(adminPeople.t); adminPeople.t = setTimeout(() => { renderAdmin(); const n = $('#pq'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); };
    $('#pf', el).onchange = (e) => { peopleFilter = e.target.value; renderAdmin(); };
    el.onclick = (e) => {
      const b = e.target.closest('[data-p]'); if (!b) return;
      if (b.dataset.p === 'add') openEditor(null);
      if (b.dataset.p === 'edit') openEditor(b.dataset.id);
      if (b.dataset.p === 'rel') openRelChooser(b.dataset.id);
      if (b.dataset.p === 'del') askDelete(b.dataset.id);
    };
    el.onchange = async (e) => {
      const t = e.target.closest('[data-vis]'); if (!t) return;
      const p = S.allPeople.find((x) => x.id === t.dataset.vis);
      await S.store.savePerson({ ...p, visible: t.checked }); toast(t.checked ? 'Now shown to visitors.' : 'Hidden from visitors.');
    };
  }

  function adminSettings(el) {
    const s = S.settings;
    const sw = (key, label, hint) => `<div class="switch"><div class="txt"><b>${label}</b><small>${hint}</small></div><label class="toggle"><input type="checkbox" name="${key}" ${s[key] ? 'checked' : ''} aria-label="${esc(label)}"><span></span></label></div>`;
    el.innerHTML = `<form id="setForm" class="admin-inner" novalidate>
      <div class="card"><h3>Website</h3>
        <div class="grid2" style="margin-top:10px">
          <div class="field"><label for="sTitle">Site name</label><input id="sTitle" name="site_title" type="text" maxlength="80" value="${esc(s.site_title)}"></div>
          <div class="field"><label for="sLocal">Title in Urdu or another script</label><input id="sLocal" name="site_title_local" type="text" maxlength="80" value="${esc(s.site_title_local)}" dir="auto" style="font-family:var(--font-script);font-size:1.1rem"></div>
        </div>
        <div class="field" style="margin-top:10px"><label for="sTag">Tagline</label><input id="sTag" name="tagline" type="text" maxlength="140" value="${esc(s.tagline)}"></div>
        <div class="field" style="margin-top:10px"><label for="sAbout">About the family (shown to Google and on the members page)</label><textarea id="sAbout" name="about" maxlength="3000">${esc(s.about)}</textarea></div>
        <div class="field" style="margin-top:10px"><label for="sAnn">Announcement banner</label><input id="sAnn" name="announcement" type="text" maxlength="200" value="${esc(s.announcement)}" placeholder="e.g. Family get-together after Eid in Lucknow. Add your branch before then!"></div>
        <div class="field" style="margin-top:12px"><span class="lbl">Homepage photo</span>
          <div class="photo-pick"><img id="sHeroPrev" src="${esc(s.hero_image || HERO_DEFAULT)}" alt="Current homepage photo" style="width:168px;height:132px;object-fit:cover;border-radius:84px 84px 12px 12px;box-shadow:0 0 0 2px var(--gold);flex:none">
          <div><input id="sHero" type="file" accept="image/*"><div class="hint">A wide photo of the family home, village or a family gathering works best.</div><button class="btn sm" type="button" id="sHeroReset" style="margin-top:8px">Use the default photo</button></div></div></div>
      </div>
      <div class="card"><h3>Homepage sections</h3>
        ${sw('show_founders', 'Founders badge', 'The badge on the homepage photo naming the founding couple.')}
        ${sw('show_elders', 'Our elders', 'Cards for the founders and their children.')}
        ${sw('relationship_finder', 'Relationship finder', 'The "How are we related?" section and the finder on each profile.')}
        ${sw('show_recent', 'Recently added', 'The newest names approved into the shijra.')}
        ${sw('show_how', 'How to add your branch', 'The three steps and the call to add a member.')}
      </div>
      <div class="card"><h3>Tree</h3>
        <div class="field" style="margin-top:10px"><span class="lbl">Start the tree from</span><div id="sRoot"></div><span class="hint">Leave empty to start from the founding ancestor with the largest family.</span></div>
        <div class="field" style="margin-top:10px;max-width:280px"><label for="sView">Family explorer opens as</label><select id="sView" name="default_view">${[['icons', 'Large icons'], ['details', 'Details list'], ['chart', 'Family chart']].map(([v, l]) => `<option value="${v}" ${(s.default_view || 'icons') === v ? 'selected' : ''}>${l}</option>`).join('')}</select><span class="hint">Visitors can switch views. Their choice is remembered on their device.</span></div>
        <div class="field" style="margin-top:10px;max-width:280px"><label for="sDepth">Generations open when the page loads</label><select id="sDepth" name="default_depth">${[1, 2, 3, 4, 5, 8].map((n) => `<option value="${n}" ${Number(s.default_depth) === n ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
        ${sw('show_spouses', 'Show husbands and wives', 'Display spouses next to each person in the tree.')}
        ${sw('show_generation', 'Show generation numbers', 'Roman numerals I, II, III on each card.')}
        ${sw('show_local_terms', 'Use family words for relations', 'Dada, Nani, Chacha, Khala, Bhabhi… alongside English.')}
      </div>
      <div class="card"><h3>Visitor features</h3>
        ${sw('submissions_open', 'Accept new members, edits and removal requests', 'Visitors can send entries for you to review.')}
        ${sw('allow_photos', 'Allow photo uploads', 'Visitors can attach a photo to their entry.')}
        ${sw('require_email', 'Require email from senders', 'So you can contact them about their entry.')}
        ${sw('require_phone', 'Require phone from senders', 'Useful for WhatsApp follow-ups.')}
        ${sw('search_enabled', 'Search box', 'Search by name, nickname or city.')}
        ${sw('bot_enabled', 'Shijra Helper chat', 'The helper in the corner of every page.')}
        ${sw('bot_teaser', 'Helper greeting bubble', 'A short greeting that pops up a few seconds after the page opens.')}
        <div class="field" style="margin-top:10px"><label for="sWelcome">Helper greeting</label><input id="sWelcome" name="bot_welcome" type="text" maxlength="220" value="${esc(s.bot_welcome)}"></div>
      </div>
      <div class="card"><h3>Privacy</h3>
        ${sw('show_living_dates', 'Show birth dates and places of living people', 'Off by default. When off, visitors and search engines see "Living" instead.')}
      </div>
      <div class="toolbar" style="position:sticky;bottom:0;background:var(--bg);padding:12px 0"><button class="btn primary" type="submit">Save settings</button><span class="muted" id="setMsg"></span></div>
    </form>`;
    const rootPick = personPicker($('#sRoot', el), { value: s.root_id, placeholder: 'Search for the founding ancestor', people: () => S.allPeople });
    let heroFile = null, heroReset = false;
    $('#sHero', el).onchange = (e) => { heroFile = e.target.files[0] || null; heroReset = false; if (heroFile) $('#sHeroPrev', el).src = URL.createObjectURL(heroFile); };
    $('#sHeroReset', el).onclick = () => { heroFile = null; heroReset = true; $('#sHero', el).value = ''; $('#sHeroPrev', el).src = HERO_DEFAULT; };
    $('#setForm', el).addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target; const fd = new FormData(f); const next = { ...S.settings };
      for (const k of ['site_title', 'site_title_local', 'tagline', 'about', 'announcement', 'bot_welcome']) next[k] = (fd.get(k) || '').toString().trim();
      for (const k of ['submissions_open', 'allow_photos', 'require_email', 'require_phone', 'search_enabled', 'relationship_finder', 'bot_enabled', 'bot_teaser', 'show_living_dates', 'show_spouses', 'show_generation', 'show_local_terms', 'show_founders', 'show_elders', 'show_recent', 'show_how']) next[k] = !!f.elements[k].checked;
      next.default_depth = Number(fd.get('default_depth')) || 2;
      next.default_view = String(fd.get('default_view') || 'icons');
      next.root_id = rootPick.get();
      const b = $('button[type=submit]', f); b.disabled = true;
      try {
        if (heroFile) { b.textContent = 'Uploading photo…'; next.hero_image = await S.store.uploadPhoto(await compressImage(heroFile, S.store.heroMax || 1400), 'site'); }
        else if (heroReset) next.hero_image = '';
        S.rootId = null; S.firstRender = true; S.expanded.clear(); await S.store.saveSettings(stripDefaults(next)); heroFile = null; heroReset = false; toast('Settings saved.');
      }
      catch (err) { $('#setMsg').textContent = 'Couldn\'t save: ' + err.message; }
      b.disabled = false; b.textContent = 'Save settings';
    });
  }
  const stripDefaults = (s) => { const o = {}; for (const k of Object.keys(DEFAULTS)) o[k] = s[k] ?? DEFAULTS[k]; return o; };

  function adminData(el) {
    const idx = F.buildIndex(S.allPeople);
    const living = S.allPeople.filter(F.isLiving).length;
    const photos = S.allPeople.filter((p) => p.photo_url).length;
    let gens = 0;
    const depth = (id, seen = new Set()) => { if (seen.has(id)) return 0; seen.add(id); let m = 0; for (const c of idx.children.get(id) || []) m = Math.max(m, depth(c, seen)); return m + 1; };
    for (const p of S.allPeople) if (!p.father_id && !p.mother_id) gens = Math.max(gens, depth(p.id));
    const samples = S.allPeople.filter((p) => p.sample).length;
    el.innerHTML = `<div class="stats">
        <div class="stat"><b>${S.allPeople.length}</b><span>people</span></div>
        <div class="stat"><b>${gens}</b><span>generations</span></div>
        <div class="stat"><b>${living}</b><span>living</span></div>
        <div class="stat"><b>${photos}</b><span>with photos</span></div>
        <div class="stat"><b>${S.subs.filter((x) => x.status === 'pending').length}</b><span>waiting for review</span></div>
      </div>
      <div class="card"><h3>Back up the shijra</h3><p class="muted">Download everyone and all settings as one file. Keep a copy somewhere safe.</p><button class="btn" type="button" data-d="export">Download backup</button></div>
      <div class="card"><h3>Restore or import</h3><p class="muted">Upload a backup file. People with the same ID are updated and new people are added. Nobody is deleted.</p><input type="file" accept="application/json,.json" id="importFile" aria-label="Choose a backup file"><div class="form-error" id="impErr"></div></div>
      ${samples ? `<div class="card"><h3>Sample family</h3><p class="muted">${samples} example people are loaded so you can try the site. Remove them before adding your real family.</p><button class="btn danger" type="button" data-d="clear-sample">${icon('i-trash')}Remove sample people</button></div>` : ''}
      ${S.store.mode === 'supabase' ? '<div class="card"><h3>Search engine pages</h3><p class="muted">Each public person gets their own page for Google. Pages rebuild automatically every 6 hours. To update now, open your GitHub repository, then Actions → "Build and deploy" → Run workflow.</p></div>' : ''}`;
    el.onclick = async (e) => {
      const b = e.target.closest('[data-d]'); if (!b) return;
      if (b.dataset.d === 'export') {
        const text = JSON.stringify({ exported_at: new Date().toISOString(), settings: S.settings, people: S.allPeople }, null, 1);
        try { await S.store.exportFile(`shijra-backup-${new Date().toISOString().slice(0, 10)}.json`, text); } catch (err) { toast('The download was cancelled.'); }
      }
      if (b.dataset.d === 'clear-sample' && await confirmBox('Remove all sample people?', `${samples} example people will be deleted. Your own entries stay.`, 'Remove')) {
        const ids = new Set(S.allPeople.filter((p) => p.sample).map((p) => p.id));
        for (const id of ids) await S.store.deletePerson(id);
        for (const q of S.allPeople) if (!ids.has(q.id) && ((q.spouse_ids || []).some((x) => ids.has(x)) || ids.has(q.father_id) || ids.has(q.mother_id))) {
          await S.store.savePerson({ ...q, father_id: ids.has(q.father_id) ? null : q.father_id, mother_id: ids.has(q.mother_id) ? null : q.mother_id, spouse_ids: (q.spouse_ids || []).filter((x) => !ids.has(x)) });
        }
        if (ids.has(S.settings.root_id)) await S.store.saveSettings({ ...S.settings, root_id: null });
        toast('Sample people removed.');
      }
    };
    $('#importFile', el).onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        const list = (data.people || []).filter((p) => p && p.id && p.first_name).map((p) => ({ ...p, slug: p.slug || F.slugify(p), spouse_ids: p.spouse_ids || [] }));
        if (!list.length) throw new Error('No people found in this file.');
        await S.store.savePeople(list);
        if (data.settings && Object.keys(data.settings).length) await S.store.saveSettings(stripDefaults({ ...S.settings, ...data.settings }));
        toast(`Imported ${list.length} people.`);
      } catch (err) { $('#impErr').textContent = 'Import failed: ' + err.message; }
    };
  }

  // ---------- bot ----------
  let bot = null, botOpen = false, toggleBot = () => {};
  function renderBot() {
    const host = $('#botHost');
    if (!S.settings.bot_enabled) { host.innerHTML = ''; return; }
    if (!bot) bot = window.createBot({ getIdx: () => S.idx, getSettings: () => S.settings, getMe: () => S.meId, isPrivate, avatarHTML, esc, openAdd, openSuggest, openRelChooser, localOn });
    if ($('.bot-fab', host)) return;
    host.innerHTML = `<button class="bot-fab" type="button" aria-expanded="false" aria-controls="botPanel"><span class="ava">${icon('i-chat')}</span><span class="label">Shijra Helper</span></button>
      <div class="bot-teaser" id="botTeaser" hidden role="status"><button type="button" aria-label="Dismiss">✕</button><b>Assalam-o-Alaikum!</b> Looking for someone, or want to know how you're related? Ask me.</div>
      <section class="bot" id="botPanel" hidden aria-label="Shijra Helper chat">
        <div class="bot-head">${pattern()}<span class="ava">${icon('i-star')}</span><div><b>Shijra Helper</b><small>Answers from the family tree</small></div><button class="btn sm ghost icon" type="button" data-bot-close aria-label="Close chat">✕</button></div>
        <div class="bot-log" id="botLog" aria-live="polite"></div>
        <form class="bot-form" id="botForm"><label for="botInput" class="sr-only">Ask the Shijra Helper</label><input id="botInput" type="text" placeholder="e.g. Who is Ayaan's dada?" autocomplete="off"><button class="btn primary icon" type="submit" aria-label="Send"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button></form>
      </section>`;
    const fab = $('.bot-fab', host), panel = $('#botPanel', host), log = $('#botLog', host), teaser = $('#botTeaser', host);
    const quickActs = new Map();
    const say = (r) => {
      const div = document.createElement('div'); div.className = 'msg from-bot'; div.innerHTML = r.html;
      if (r.quick && r.quick.length) {
        const q = document.createElement('div'); q.className = 'quick';
        for (const item of r.quick) { const k = F.uid(); quickActs.set(k, item); q.insertAdjacentHTML('beforeend', `<button type="button" data-q="${k}">${esc(item.label)}</button>`); }
        div.appendChild(q);
      }
      log.appendChild(div); log.scrollTop = log.scrollHeight;
    };
    const ask = (text) => {
      const me = document.createElement('div'); me.className = 'msg from-me'; me.textContent = text; log.appendChild(me);
      const typing = document.createElement('div'); typing.className = 'msg from-bot typing'; typing.innerHTML = '<i></i><i></i><i></i>'; log.appendChild(typing);
      log.scrollTop = log.scrollHeight;
      setTimeout(() => { typing.remove(); say(bot.answer(text)); }, 420 + Math.random() * 300);
    };
    toggleBot = (open) => {
      botOpen = open; panel.hidden = !open; teaser.hidden = true; fab.setAttribute('aria-expanded', open);
      if (open) { if (!log.children.length) say(bot.greet()); setTimeout(() => $('#botInput').focus(), 50); }
    };
    fab.onclick = () => toggleBot(!botOpen);
    $('[data-bot-close]', host).onclick = () => toggleBot(false);
    teaser.onclick = (e) => { if (e.target.closest('button')) { teaser.hidden = true; ls.set('shijra-teaser', '1'); } else toggleBot(true); };
    if (S.settings.bot_teaser && !ls.get('shijra-teaser')) setTimeout(() => { if (!botOpen && S.settings.bot_enabled) teaser.hidden = false; }, 4500);
    $('#botForm', host).onsubmit = (e) => { e.preventDefault(); const i = $('#botInput'); const v = i.value.trim(); if (!v) return; i.value = ''; ask(v); };
    log.addEventListener('click', (e) => {
      const q = e.target.closest('[data-q]');
      if (q) { const item = quickActs.get(q.dataset.q); if (item.act) item.act(); else if (/\s$/.test(item.ask)) { const i = $('#botInput'); i.value = item.ask; i.focus(); } else ask(item.ask); return; }
      const o = e.target.closest('[data-action="open"]');
      if (o) { reveal(o.dataset.id); openProfile(o.dataset.id); if (window.innerWidth <= 640) toggleBot(false); }
    });
  }

  // ---------- global actions ----------
  document.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-action]');
    if (!a || a.closest('#tree-root') || a.closest('#botLog')) return;
    const id = a.dataset.id;
    switch (a.dataset.action) {
      case 'open': reveal(id, { scroll: !a.closest('.drawer') }); openProfile(id); break;
      case 'close-drawer': closeDrawer(); break;
      case 'xp-profile': openProfile(id); break;
      case 'xp-go': if (XP.min) xpMinimize(false); xpGo(id); scrollToExplorer(); break;
      case 'focus': reveal(id); if (window.innerWidth <= 640) closeDrawer(); break;
      case 'add': openAdd({}); break;
      case 'add-rel': openRelChooser(id); break;
      case 'suggest': openSuggest(id); break;
      case 'remove-req': openRemoval(id); break;
      case 'edit': openEditor(id); break;
      case 'delete': askDelete(id); break;
      case 'set-me': setMe(id); toast('Cards now show how each person is related to you.'); break;
      case 'open-bot': toggleBot(true); break;
      case 'share': copyLink(id); break;
      case 'close-admin': closeAdmin(); break;
      case 'logout': await S.store.logout(); S.isAdmin = false; applySettings(); applyVisibility(); renderAdmin(); toast('Signed out.'); break;
      case 'preview-visitor': S.previewVisitor = true; closeAdmin(); applySettings(); applyVisibility(); break;
      case 'exit-preview': S.previewVisitor = false; applySettings(); applyVisibility(); break;
      default:
    }
  });
  $('#addBtn').onclick = () => openAdd({});
  $('#adminBtn').onclick = () => (S.adminOpen ? closeAdmin() : openAdmin());
  $('#brandLink').onclick = () => { closeDrawer(); if (S.people.length) { const r = xpRoots(); xpGo(r.length === 1 ? r[0].id : null); } };
  $('#menuBtn').onclick = () => { const m = $('#mobileMenu'); m.hidden = !m.hidden; $('#menuBtn').setAttribute('aria-expanded', !m.hidden); };
  $('#mobileMenu').onclick = (e) => { if (e.target.closest('a')) { $('#mobileMenu').hidden = true; $('#menuBtn').setAttribute('aria-expanded', 'false'); } };
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (menuEl) { closeMenu(); return; }
    if ($('#modalHost').innerHTML) { $('#modalHost').innerHTML = ''; return; }
    if (S.openProfileId) { closeDrawer(); return; }
    if (XP.navMobile) { XP.navMobile = false; xpLayout(); return; }
    if (XP.max) xpMaximize(false);
  });
  window.addEventListener('resize', () => { clearTimeout(window.__rz); window.__rz = setTimeout(() => { if (S.openProfileId) openProfile(S.openProfileId, { keepHash: true }); }, 200); });

  function route() {
    const h = location.hash.replace(/^#/, '');
    if (/access_token|error_description/.test(h)) return;
    if (h === 'admin') openAdmin();
    else if (h === 'add') openAdd({});
    else if (h.startsWith('p-')) {
      const p = S.people.find((x) => x.slug === h.slice(2));
      if (p) { reveal(p.id); openProfile(p.id, { keepHash: true }); }
    }
  }
  window.addEventListener('hashchange', route);


  // ---------- first-time admin password (from an emailed invite or reset link) ----------
  function openSetPassword(email) {
    if (/access_token|type=/.test(location.hash)) setHash('');
    const m = openModal('Set your password', `<p class="muted" style="margin:0">You're signed in as <b>${esc(email || 'the invited user')}</b>. Choose a password for signing in to the shijra admin from now on.</p>
      <div class="field"><label for="npw1">New password</label><input id="npw1" type="password" autocomplete="new-password" minlength="8" required></div>
      <div class="field"><label for="npw2">Type it again</label><input id="npw2" type="password" autocomplete="new-password" minlength="8" required></div>
      <div class="form-error" id="npwErr" role="alert"></div>`, '<button class="btn primary" type="submit">Save password</button>');
    m.form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const a = $('#npw1', m.wrap).value, b = $('#npw2', m.wrap).value;
      const err = a.length < 8 ? 'Use at least 8 characters.' : a !== b ? 'The two passwords don\'t match.' : '';
      $('#npwErr', m.wrap).textContent = err; if (err) return;
      const btn = $('button[type=submit]', m.wrap); btn.disabled = true; btn.textContent = 'Saving…';
      try {
        const isAdm = await S.store.setPassword(a);
        S.isAdmin = !!isAdm; applySettings(); applyVisibility(); m.close();
        toast(isAdm ? 'Password saved. You are signed in as admin.' : 'Password saved. This account is not an admin yet.');
      } catch (er) { btn.disabled = false; btn.textContent = 'Save password'; $('#npwErr', m.wrap).textContent = 'Couldn\'t save: ' + er.message; }
    });
  }

  // ---------- boot ----------
  async function boot(store) {
    S.store = store;
    try {
      const info = await store.init();
      S.isAdmin = !!info.isAdmin; S.canSubmit = info.canSubmit !== false; S.setupMode = !!info.setupMode;
      if (info.needsPassword) setTimeout(() => openSetPassword(info.signedInEmail), 300);
    } catch (err) {
      console.error(err);
      $('#bannerIn').textContent = 'The shijra couldn\'t load. Check your connection and refresh the page.'; $('#banner').hidden = false;
      return;
    }
    let routed = false;
    applySettings();
    store.subscribeSettings((s) => { S.settings = { ...DEFAULTS, ...(s || {}) }; relCache.clear(); applySettings(); if (S.people.length) renderAll(); });
    store.subscribeSubmissions((list) => { S.subs = (list || []).slice().sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))); updateBadge(); if (S.adminOpen) renderAdmin(); });
    store.subscribePeople((list) => {
      setPeople(list || []);
      applySettings();
      if (!routed && S.people.length) { routed = true; setTimeout(route, 60); }
      else if (!routed && /^#(admin|add)$/.test(location.hash)) { routed = true; route(); }
    });
  }
  window.FamilyApp = { boot };
  if (window.createStore) boot(window.createStore());
})();
