/* family.js — pure family-data helpers shared by the website, the bot and the SEO page generator.
   Works in the browser (window.Family) and in Node (module.exports). */
(function (root) {
  const F = {};

  F.fullName = (p) => (p ? [p.first_name, p.middle_name, p.last_name].filter(Boolean).join(' ').trim() : '') || 'Unnamed';
  F.shortName = (p) => (p ? [p.first_name, p.last_name].filter(Boolean).join(' ').trim() : '') || 'Unnamed';
  F.initials = (p) => {
    const a = (p?.first_name || '?')[0] || '?';
    const b = (p?.last_name || '')[0] || '';
    return (a + b).toUpperCase();
  };
  F.year = (d) => (d ? String(d).trim().slice(0, 4) : '');

  /** Treat someone as living unless a death date is recorded, they're marked deceased,
   *  or they would be over 105 years old. */
  F.isLiving = (p) => {
    if (!p) return false;
    if (p.is_living === false || p.death_date) return false;
    if (p.is_living === true) return true;
    const y = parseInt(F.year(p.birth_date), 10);
    return !(y && new Date().getFullYear() - y > 105);
  };

  /** "1932–2001", "b. 1960", "1932–?", or "Living" when dates are private. */
  F.years = (p, hideLivingDates) => {
    const living = F.isLiving(p);
    if (living && hideLivingDates) return 'Living';
    const b = F.year(p.birth_date), d = F.year(p.death_date);
    if (b && d) return `${b}–${d}`;
    if (b && living) return `b. ${b}`;
    if (b) return `${b}–?`;
    if (d) return `d. ${d}`;
    return living ? '' : 'Deceased';
  };

  /** Human date from "1950" / "1950-08" / "1950-08-15". */
  F.fmtDate = (d) => {
    if (!d) return '';
    const s = String(d).trim();
    const m = s.match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/);
    if (!m) return s;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    if (m[3]) return `${parseInt(m[3], 10)} ${months[parseInt(m[2], 10) - 1] || ''} ${m[1]}`.replace(/\s+/g, ' ');
    if (m[2]) return `${months[parseInt(m[2], 10) - 1] || ''} ${m[1]}`.trim();
    return m[1];
  };
  F.validDate = (d) => !d || /^\d{4}(-\d{1,2}(-\d{1,2})?)?$/.test(String(d).trim());

  F.slugify = (p) => {
    const base = F.shortName(p).normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'member';
    return `${base}-${String(p.id || '').replace(/[^a-z0-9]/gi, '').slice(0, 6).toLowerCase()}`;
  };

  F.uid = () => (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });

  const birthKey = (p) => {
    const s = String(p.birth_date || '').trim();
    return s ? s.padEnd(10, '0') : '9999';
  };

  /** Index people for fast lookups. */
  F.buildIndex = (people) => {
    const byId = new Map();
    const children = new Map();
    const spouses = new Map();
    for (const p of people) { byId.set(p.id, p); children.set(p.id, []); spouses.set(p.id, new Set()); }
    for (const p of people) {
      for (const pid of [p.father_id, p.mother_id]) {
        if (pid && children.has(pid) && pid !== p.id) children.get(pid).push(p.id);
      }
      for (const s of p.spouse_ids || []) {
        if (s !== p.id && byId.has(s)) { spouses.get(p.id).add(s); spouses.get(s).add(p.id); }
      }
    }
    for (const [, list] of children) list.sort((a, b) => birthKey(byId.get(a)).localeCompare(birthKey(byId.get(b))));
    return { byId, children, spouses, people };
  };

  F.get = (idx, id) => (id ? idx.byId.get(id) || null : null);
  F.parents = (idx, p) => [F.get(idx, p.father_id), F.get(idx, p.mother_id)].filter(Boolean);
  F.children = (idx, id) => (idx.children.get(id) || []).map((c) => idx.byId.get(c));
  F.spouses = (idx, id) => [...(idx.spouses.get(id) || [])].map((s) => idx.byId.get(s)).filter(Boolean);
  F.siblings = (idx, p) => {
    const set = new Set();
    for (const par of F.parents(idx, p)) for (const c of idx.children.get(par.id) || []) if (c !== p.id) set.add(c);
    return [...set].map((id) => idx.byId.get(id)).sort((a, b) => birthKey(a).localeCompare(birthKey(b)));
  };
  F.countDescendants = (idx, id, seen = new Set()) => {
    if (seen.has(id)) return 0; seen.add(id);
    let n = 0;
    for (const c of idx.children.get(id) || []) n += 1 + F.countDescendants(idx, c, seen);
    return n;
  };

  /** Walk up through fathers first, then mothers, to the top-most known ancestor. */
  F.topAncestor = (idx, id) => {
    let cur = F.get(idx, id); const seen = new Set();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      const next = F.get(idx, cur.father_id) || F.get(idx, cur.mother_id);
      if (!next) break; cur = next;
    }
    return cur ? cur.id : id;
  };

  /** The default root: the founding ancestor with the largest family below them. */
  F.autoRoot = (idx) => {
    let best = null, bestN = -1;
    for (const p of idx.people) {
      if (F.get(idx, p.father_id) || F.get(idx, p.mother_id)) continue;
      // Skip someone who only married in; their spouse's line represents the couple.
      const n = F.countDescendants(idx, p.id);
      const tie = n === bestN && best && (p.gender === 'male' && best.gender !== 'male');
      if (n > bestN || tie) { best = p; bestN = n; }
    }
    return best ? best.id : (idx.people[0] ? idx.people[0].id : null);
  };

  /** Simple search across names, nicknames and places. */
  F.search = (idx, q, limit = 8) => {
    const s = String(q || '').toLowerCase().trim();
    if (!s) return [];
    const terms = s.split(/\s+/);
    const scored = [];
    for (const p of idx.people) {
      const hay = [F.fullName(p), p.nickname, p.maiden_name, p.birth_place, p.current_place, p.occupation].filter(Boolean).join(' ').toLowerCase();
      if (!terms.every((t) => hay.includes(t))) continue;
      const name = F.fullName(p).toLowerCase();
      let score = 0;
      if (name === s) score += 100;
      if (name.startsWith(s)) score += 50;
      if ((p.first_name || '').toLowerCase().startsWith(terms[0])) score += 20;
      scored.push([score, p]);
    }
    scored.sort((a, b) => b[0] - a[0] || F.fullName(a[1]).localeCompare(F.fullName(b[1])));
    return scored.slice(0, limit).map((x) => x[1]);
  };

  // ---------- Relationship calculator ----------
  const word = (g, m, f, n) => (g === 'male' ? m : g === 'female' ? f : n);
  const ordinal = (n) => ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'][n] || `${n}th`;
  const removed = (n) => (n === 0 ? '' : n === 1 ? ' once removed' : n === 2 ? ' twice removed' : ` ${n} times removed`);
  const greats = (n) => (n <= 0 ? '' : n === 1 ? 'great-' : `${n}× great-`);

  function ancestorMap(idx, id) {
    const dist = new Map([[id, 0]]); const prev = new Map(); const q = [id];
    while (q.length) {
      const cur = q.shift(); const p = idx.byId.get(cur); if (!p) continue;
      for (const par of [p.father_id, p.mother_id]) {
        if (par && idx.byId.has(par) && !dist.has(par)) { dist.set(par, dist.get(cur) + 1); prev.set(par, cur); q.push(par); }
      }
    }
    return { dist, prev };
  }

  /** Blood relationship of B to A ("B is A's ___"), or null. */
  function blood(idx, aId, bId) {
    if (aId === bId) return null;
    const A = ancestorMap(idx, aId), B = ancestorMap(idx, bId);
    let best = null;
    for (const [id, da] of A.dist) {
      if (!B.dist.has(id)) continue;
      const db = B.dist.get(id);
      if (!best || da + db < best.da + best.db) best = { id, da, db };
    }
    if (!best) return null;
    const { da, db } = best;
    const b = idx.byId.get(bId); const g = b.gender;
    // path A -> ... -> common -> ... -> B
    const up = []; let c = best.id; while (c !== undefined) { up.unshift(c); c = A.prev.get(c); }
    const down = []; c = B.prev.get(best.id); while (c !== undefined) { down.push(c); c = B.prev.get(c); }
    const path = [...up, ...down];
    // paternal / maternal side, decided by which parent of A the path climbs through
    const aP = idx.byId.get(aId);
    const side = path[1] && da >= 2 ? (path[1] === aP.father_id ? 'paternal' : path[1] === aP.mother_id ? 'maternal' : '') : '';
    let label;
    if (da === 0) {
      label = db === 1 ? word(g, 'son', 'daughter', 'child') : greats(db - 2) + 'grand' + word(g, 'son', 'daughter', 'child');
    } else if (db === 0) {
      label = da === 1 ? word(g, 'father', 'mother', 'parent') : greats(da - 2) + 'grand' + word(g, 'father', 'mother', 'parent');
    } else if (da === 1 && db === 1) {
      const pa = [aP.father_id, aP.mother_id].filter(Boolean), pb = [b.father_id, b.mother_id].filter(Boolean);
      const shared = pa.filter((x) => pb.includes(x)).length;
      const half = shared === 1 && pa.length === 2 && pb.length === 2;
      label = (half ? 'half-' : '') + word(g, 'brother', 'sister', 'sibling');
    } else if (da === 1) {
      label = greats(db - 3) + (db >= 3 ? 'grand-' : '') + word(g, 'nephew', 'niece', 'nephew or niece');
    } else if (db === 1) {
      label = greats(da - 2) + word(g, 'uncle', 'aunt', 'uncle or aunt');
    } else {
      label = `${ordinal(Math.min(da, db) - 1)} cousin${removed(Math.abs(da - db))}`;
    }
    if (side && (db === 0 || db === 1 || (da >= 2 && db >= 2))) label += ` (${side} side)`;
    return { label, path, da, db };
  }

  // ---------- Urdu / Hindustani kinship terms (shijra vocabulary) ----------
  const olderThan = (x, y) => { const a = parseInt(F.year(x && x.birth_date), 10), b = parseInt(F.year(y && y.birth_date), 10); return a && b ? a < b : null; };
  function localBlood(idx, path, da, db) {
    const P = (i) => idx.byId.get(path[i]);
    const A = P(0), B = P(path.length - 1); if (!A || !B) return null;
    const g = B.gender;
    const w = (m, f) => (g === 'female' ? f : g === 'male' ? m : `${m} / ${f}`);
    const viaFather = path[1] === A.father_id;
    if (da === 1 && db === 0) return w('Abba (Walid)', 'Ammi (Walida)');
    if (da === 2 && db === 0) return viaFather ? w('Dada', 'Dadi') : w('Nana', 'Nani');
    if (da === 3 && db === 0) return viaFather ? w('Par-dada', 'Par-dadi') : w('Par-nana', 'Par-nani');
    if (da === 0 && db === 1) return w('Beta', 'Beti');
    if (da === 0 && db === 2) return P(1).gender === 'female' ? w('Nawasa', 'Nawasi') : w('Pota', 'Poti');
    if (da === 0 && db === 3) return P(1).gender === 'female' ? w('Par-nawasa', 'Par-nawasi') : w('Par-pota', 'Par-poti');
    if (da === 1 && db === 1) return w('Bhai', 'Behen');
    if (da === 2 && db === 1) {
      const par = P(1);
      if (par.gender === 'female') return w('Mamu', 'Khala');
      if (g === 'female') return 'Phuphi';
      return olderThan(B, par) ? 'Taya (Tau)' : 'Chacha';
    }
    if (da === 3 && db === 1) {
      const gp = P(2);
      const gt = viaFather ? (gp.gender === 'female' ? 'Dadi' : 'Dada') : (gp.gender === 'female' ? 'Nani' : 'Nana');
      return g === 'female' ? `${gt} ki behen` : `${gt} ke bhai`;
    }
    if (da === 1 && db === 2) return P(2).gender === 'female' ? w('Bhanja', 'Bhanji') : w('Bhatija', 'Bhatiji');
    if (da === 2 && db === 2) {
      const par = P(1), unc = P(3);
      const pre = par.gender === 'female' ? (unc.gender === 'female' ? 'Khalazad' : 'Mamuzad') : (unc.gender === 'female' ? 'Phuphizad' : 'Chachazad');
      return `${pre} ${w('bhai', 'behen')}`;
    }
    return null;
  }
  const spouseOfLocal = {
    'Beta': 'Bahu', 'Beti': 'Damad', 'Bhai': 'Bhabhi', 'Behen': 'Behnoi (Jijaji)', 'Chacha': 'Chachi', 'Taya (Tau)': 'Tai',
    'Mamu': 'Mumani', 'Khala': 'Khalu', 'Phuphi': 'Phupha', 'Pota': 'Pot-bahu', 'Nawasa': 'Nawas-bahu', 'Bhatija': 'Bhatije ki bahu', 'Bhanja': 'Bhanje ki bahu',
  };

  const inLaw = {
    father: 'father-in-law', mother: 'mother-in-law', parent: 'parent-in-law',
    brother: 'brother-in-law', sister: 'sister-in-law', sibling: 'sibling-in-law',
  };
  const viaSpouse = (base, g) => (['son', 'daughter', 'child'].includes(base)
    ? word(g, 'son-in-law', 'daughter-in-law', 'child-in-law')
    : ['brother', 'sister', 'sibling', 'half-brother', 'half-sister', 'half-sibling'].includes(base)
      ? word(g, 'brother-in-law', 'sister-in-law', 'sibling-in-law') : null);

  /** Full relationship of B to A. Returns { text, label, path } — text reads "B is A's label". */
  F.relationship = (idx, aId, bId) => {
    const a = idx.byId.get(aId), b = idx.byId.get(bId);
    if (!a || !b) return null;
    const an = F.shortName(a), bn = F.shortName(b);
    if (aId === bId) return { label: 'same person', text: `That's the same person.`, path: [aId] };
    const mk = (label, path, local = null) => ({ label, path, local, text: `${bn} is ${an}'s ${label}.` });

    if ((idx.spouses.get(aId) || new Set()).has(bId)) return mk(word(b.gender, 'husband', 'wife', 'spouse'), [aId, bId], word(b.gender, 'Shohar', 'Biwi', 'Shareek-e-hayat'));

    const direct = blood(idx, aId, bId);
    if (direct) return mk(direct.label, direct.path, localBlood(idx, direct.path, direct.da, direct.db));

    // B is a blood relative of A's spouse  → "spouse's ___" / in-law terms
    for (const s of F.spouses(idx, aId)) {
      const r = blood(idx, s.id, bId);
      if (r) {
        const base = r.label.replace(/ \((paternal|maternal) side\)$/, '');
        const label = inLaw[base] || `${word(s.gender, "husband's", "wife's", "spouse's")} ${r.label}`;
        let local = null;
        if (r.da === 1 && r.db === 0) local = word(b.gender, 'Sasur', 'Saas', 'Saas / Sasur');
        else if (r.da === 1 && r.db === 1) {
          if (s.gender === 'female') local = word(b.gender, 'Saala', 'Saali', 'Saala / Saali');
          else local = b.gender === 'female' ? 'Nanad' : olderThan(b, s) ? 'Jeth' : 'Devar';
        }
        return mk(label, [aId, ...r.path], local);
      }
    }
    // B is the spouse of A's blood relative
    for (const t of F.spouses(idx, bId)) {
      const r = blood(idx, aId, t.id);
      if (r) {
        const base = r.label.replace(/ \((paternal|maternal) side\)$/, '');
        const sideM = r.label.match(/ \((paternal|maternal) side\)$/);
        const uncleAunt = base.match(/^((?:\d+× )?(?:great-)*)(uncle|aunt)/);
        const label = viaSpouse(base, b.gender)
          || (uncleAunt ? `${uncleAunt[1]}${word(b.gender, 'uncle', 'aunt', 'uncle or aunt')} by marriage${sideM ? sideM[0] : ''}` : `${base}'s ${word(b.gender, 'husband', 'wife', 'spouse')}${sideM ? sideM[0] : ''}`);
        const tl = localBlood(idx, r.path, r.da, r.db);
        return mk(label, [...r.path, bId], tl && spouseOfLocal[tl] ? spouseOfLocal[tl] : null);
      }
    }
    // Fall back to any connection through the family graph.
    const prev = new Map([[aId, null]]); const q = [aId];
    while (q.length) {
      const cur = q.shift(); if (cur === bId) break;
      const p = idx.byId.get(cur);
      const next = [p.father_id, p.mother_id, ...(idx.children.get(cur) || []), ...(idx.spouses.get(cur) || [])];
      for (const n of next) if (n && idx.byId.has(n) && !prev.has(n)) { prev.set(n, cur); q.push(n); }
    }
    if (!prev.has(bId)) return { label: 'not connected', text: `${an} and ${bn} aren't connected in the tree yet.`, path: [] };
    const path = []; let c = bId; while (c) { path.unshift(c); c = prev.get(c); }
    return { label: 'relative by marriage', text: `${bn} is related to ${an} by marriage, through ${path.length - 2} ${path.length - 2 === 1 ? 'person' : 'people'}.`, path };
  };

  F.pathText = (idx, path) => path.map((id) => F.shortName(idx.byId.get(id))).join(' → ');

  if (typeof module !== 'undefined' && module.exports) module.exports = F;
  else root.Family = F;
})(typeof window !== 'undefined' ? window : globalThis);
