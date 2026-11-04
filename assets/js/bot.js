/* bot.js — "Shijra Helper": a free, built-in assistant (no API key).
   Understands English plus common Urdu/Hindustani family words (abba, ammi, dada, nani, beta, bhai, behen…).
   It finds people, lists relatives, explains how two people are related, and guides visitors through adding family. */
(function (root) {
  const F = root.Family;

  function createBot(ctx) {
    // ctx: { getIdx(), getSettings(), getMe(), isPrivate(p), avatarHTML(p,size), esc(), openAdd(opts), openSuggest(id), openRelChooser(id), localOn() }
    const esc = ctx.esc;
    const norm = (s) => ' ' + String(s).toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, ' ').replace(/'s\b/g, ' ').replace(/\s+/g, ' ').trim() + ' ';

    function findPeopleIn(text) {
      const idx = ctx.getIdx(); const t = norm(text);
      const hits = [];
      for (const p of idx.people) {
        const names = [F.fullName(p), F.shortName(p), p.nickname, [p.first_name, p.middle_name].filter(Boolean).join(' '), p.first_name].filter(Boolean);
        for (const n of names) {
          const key = norm(n);
          if (key.trim().length < 2) continue;
          const at = t.indexOf(key);
          if (at >= 0) { hits.push({ p, at, len: key.length }); break; }
        }
      }
      hits.sort((a, b) => b.len - a.len);
      const chosen = [];
      for (const h of hits) {
        if (chosen.some((c) => c.p.id === h.p.id)) continue;
        if (chosen.some((c) => h.at >= c.at && h.at + h.len <= c.at + c.len && c.len > h.len)) continue;
        chosen.push(h);
      }
      return chosen.sort((a, b) => a.at - b.at).map((h) => h.p);
    }
    const me = () => { const id = ctx.getMe(); return id ? ctx.getIdx().byId.get(id) : null; };
    const mentionsMe = (t) => /\b(my|me|mine|i|mera|meri|mere)\b/i.test(t);

    const card = (p, sub) => `<button class="rel" data-action="open" data-id="${esc(p.id)}">${ctx.avatarHTML(p, 'sm')}<span><b>${esc(F.fullName(p))}</b><small>${esc(sub || F.years(p, ctx.isPrivate(p)))}${!sub && p.nickname ? ' · ' + esc(p.nickname) : ''}</small></span></button>`;
    const list = (arr, subFn) => arr.map((p) => card(p, subFn ? subFn(p) : '')).join('');
    const termOf = (aId, bId) => { const r = F.relationship(ctx.getIdx(), aId, bId); return r && ctx.localOn() && r.local ? r.local : ''; };

    // kind → regex of words that ask for it
    const KIN = [
      ['grandparents', /\b(grand ?parents?|grand ?father|grand ?mother|grandpa|grandma|dada|dadi|nana|nani)\b/i],
      ['grandchildren', /\b(grand ?children|grand ?kids|grand ?sons?|grand ?daughters?|pota|poti|potay|nawasa|nawasi)\b/i],
      ['parents', /\b(parents?|father|mother|dad|mom|mum|abba|abbu|ammi|ammy|amma|walid|walida|walidain|papa|mama ji)\b/i],
      ['children', /\b(children|kids|sons?|daughters?|beta|beti|bete|betiyan|aulad|bachche)\b/i],
      ['spouses', /\b(wife|husband|spouse|married|shohar|biwi|begum|shauhar|miyan)\b/i],
      ['siblings', /\b(siblings?|brothers?|sisters?|bhai|behen|bahen|behan|apa|baji)\b/i],
      ['uncles', /\b(uncles?|aunts?|chacha|chachi|taya|tau|phuphi|phupho|mamu|mamoo|khala|khalu)\b/i],
      ['cousins', /\b(cousins?|chachazad|mamuzad|khalazad|phuphizad)\b/i],
      ['descendants', /\b(descendants|nasl|offspring)\b/i],
    ];

    function greet(menu) {
      const s = ctx.getSettings(); const m = me();
      return {
        html: `${menu ? '' : esc(s.bot_welcome || 'Assalam-o-Alaikum! How can I help?') + '<br><br>'}You can ask me things like:`,
        quick: [
          { label: m ? `Who is my Dada?` : 'Who are the elders?', ask: m ? 'Who is my dada?' : 'Who is the eldest?' },
          { label: 'Show the family tree', ask: 'How do I see the tree?' },
          { label: 'How many people are here?', ask: 'How many people are in the shijra?' },
          { label: 'How are two people related?', ask: 'How is ' },
          { label: 'Find someone', ask: 'Find ' },
        ],
      };
    }

    function subject(t) {
      // the person the question is about: a named person, or the viewer for "my …"
      const ps = findPeopleIn(t);
      if (ps.length) return { p: ps[0] };
      if (mentionsMe(t) && me()) return { p: me(), mine: true };
      if (mentionsMe(t)) return { needMe: true };
      const words = t.replace(/\b(who|whom|is|are|was|the|of|what|show|me|find|tell|about|list|all|ka|ki|ke|kaun|hai|hain|\?)\b/gi, ' ');
      const cleaned = KIN.reduce((acc, [, re]) => acc.replace(new RegExp(re.source, 'gi'), ' '), words).trim();
      if (!cleaned) return {};
      const res = F.search(ctx.getIdx(), cleaned, 5);
      if (res.length === 1) return { p: res[0] };
      if (res.length > 1) return { many: res, name: cleaned };
      return { none: cleaned };
    }

    function kin(t, kind) {
      const r = subject(t);
      if (r.needMe) return { html: 'Tell me who you are first: tap <b>Who are you in this family?</b> above the tree, or ask about someone by name, e.g. <i>Who is Ayaan\'s dada?</i>' };
      if (r.many) return { html: `I found more than one ${esc(r.name)}. Which one did you mean?${list(r.many)}` };
      if (!r.p) return { html: `Whose ${kind}? Tell me a name, for example <i>${kind} of Imran</i>.` };
      const idx = ctx.getIdx(); const p = r.p;
      const who = r.mine ? 'Your' : `${esc(F.shortName(p))}'s`;
      let arr = [];
      const parents = (x) => F.parents(idx, x);
      if (kind === 'parents') arr = parents(p);
      if (kind === 'children') arr = F.children(idx, p.id);
      if (kind === 'spouses') arr = F.spouses(idx, p.id);
      if (kind === 'siblings') arr = F.siblings(idx, p);
      if (kind === 'grandparents') arr = parents(p).flatMap(parents);
      if (kind === 'grandchildren') arr = F.children(idx, p.id).flatMap((c) => F.children(idx, c.id));
      if (kind === 'uncles') { const set = new Map(); for (const par of parents(p)) for (const s of F.siblings(idx, par)) { set.set(s.id, s); for (const sp of F.spouses(idx, s.id)) set.set(sp.id, sp); } arr = [...set.values()]; }
      if (kind === 'cousins') { const set = new Map(); for (const par of parents(p)) for (const s of F.siblings(idx, par)) for (const c of F.children(idx, s.id)) set.set(c.id, c); arr = [...set.values()]; }
      if (kind === 'descendants') { const out = []; const seen = new Set(); const walk = (id) => { for (const c of F.children(idx, id)) if (!seen.has(c.id)) { seen.add(c.id); out.push(c); walk(c.id); } }; walk(p.id); arr = out; }
      const label = { parents: 'parents', children: 'children', spouses: 'husband or wife', siblings: 'brothers and sisters', grandparents: 'grandparents', grandchildren: 'grandchildren', uncles: 'uncles and aunts', cousins: 'first cousins', descendants: 'descendants' }[kind];
      if (!arr.length) {
                return { html: `${who} ${label} aren't recorded in the shijra yet.` };
      }
      const sub = (x) => { const w = termOf(p.id, x.id); return [w, F.years(x, ctx.isPrivate(x))].filter(Boolean).join(' · '); };
      return { html: `${who} ${label} (${arr.length}):${list(arr.slice(0, 14), sub)}${arr.length > 14 ? `<small>…and ${arr.length - 14} more</small>` : ''}` };
    }

    function relation(t) {
      let ps = findPeopleIn(t);
      if (ps.length === 1 && mentionsMe(t) && me() && me().id !== ps[0].id) ps = [ps[0], me()];
      if (ps.length < 2) return { html: 'Tell me two names, for example <i>How is Hamza related to Imran?</i>' + (me() ? '' : ' Or tap <b>Who are you in this family?</b> and ask <i>How am I related to Zubaida?</i>') };
      const [b, a] = ps; // "how is B related to A"
      const r = F.relationship(ctx.getIdx(), a.id, b.id);
      const local = ctx.localOn() && r.local ? `<span class="term">${esc(r.local)}</span>` : '';
      return { html: `${local}<b>${esc(r.text)}</b>${r.path.length > 2 ? `<div class="path">${esc(F.pathText(ctx.getIdx(), r.path))}</div>` : ''}${list([b, a])}` };
    }

    function extreme(dir) {
      const withYear = ctx.getIdx().people.filter((p) => F.year(p.birth_date));
      if (!withYear.length) return { html: 'No birth years are recorded yet.' };
      withYear.sort((a, b) => dir * String(a.birth_date).localeCompare(String(b.birth_date)));
      const living = withYear.filter(F.isLiving);
      let html = `${dir > 0 ? 'The earliest-born person in the shijra is' : 'The youngest member is'}:${list([withYear[0]])}`;
      if (dir > 0 && living[0] && living[0].id !== withYear[0].id) html += `The eldest living member is:${list([living[0]])}`;
      return { html };
    }

    const intents = [
      { re: /^(hi|hello|hey|salam|salaam|assalam|asalam|aoa|namaste|adaab|aadab)\b/i, run: () => ({ html: 'Wa Alaikum Assalam! ' + greet(true).html, quick: greet(true).quick }) },
      { re: /\b(help|what can you do|options|menu)\b/i, run: () => greet(true) },
      { re: /\b(relat(ed|ion|ionship)|connected|rishta|rishtedar|rishte)\b/i, run: relation },
      { re: /\b(how many|count|total|number of|kitne)\b/i, run: () => {
        const idx = ctx.getIdx(); const n = idx.people.length;
        const living = idx.people.filter(F.isLiving).length;
        const names = new Set(idx.people.map((p) => (p.last_name || '').trim()).filter(Boolean));
        return { html: `The shijra has <b>${n}</b> people (${living} living), across ${names.size} family names: ${[...names].slice(0, 6).map(esc).join(', ')}.` };
      } },
      { re: /\b(oldest|eldest|earliest|first ancestor|founder|elders?|buzurg)\b/i, run: () => extreme(1) },
      { re: /\b(youngest|newest|latest born|chhota|chota)\b/i, run: () => extreme(-1) },
      { re: /\b(add|join|submit|register|include|new member|put me|enter|shamil|wrong|mistake|correct|correction|fix|update|edit|change|spelling|galat|remove|delete)\b/i, run: () => ({ html: 'The shijra is kept by the family admin, who adds and corrects every entry. If someone is missing or a detail is wrong, please tell the family admin and they will update it.' }) },
      { re: /\b(privacy|private|hide|living|safe)\b/i, run: () => ({ html: `Entries are added only by the family admin.${ctx.getSettings().show_living_dates ? '' : ' Birth dates and places of living people are hidden from visitors and search engines.'} To have something hidden or removed, please contact the family admin.` }) },
      { re: /\b(zoom|move|navigate|expand|grow|see more|scroll|open|see the tree|tree view|tree)\b/i, run: () => ({ html: 'Drag the tree to move around. Pinch, or hold Ctrl and scroll, to zoom. Double-click (or tap) a folder in the family explorer to open the next generation, or press <b>Tree</b> to see the family as a tree and tap the gold <b>Show children</b> buttons.' }) },
      { re: /\b(shijra|shajra|what is this|meaning)\b/i, run: () => ({ html: '<b>Shijra</b> (شجرہ) means family tree, from the Arabic <i>shajarah</i>, a tree. A <i>shijra-e-nasab</i> records a family\'s lineage across generations.' }) },
      { re: /\b(thanks|thank you|shukriya|jazakallah|jazak|great|ok|okay)\b/i, run: () => ({ html: 'Khushi hui! Ask me about anyone in the family.' }) },
    ];

    function answer(text) {
      const t = text.trim();
      if (!t) return greet(true);
      // relation questions first, then kinship words, then the rest
      if (intents[2].re.test(t)) return relation(t);
      // ignore kinship words that are part of someone's name or nickname ("Bade Abba")
      let bare = norm(t);
      for (const p of findPeopleIn(t)) for (const n of [p.nickname, F.fullName(p), F.shortName(p)].filter(Boolean)) bare = bare.split(norm(n).trim()).join(' ');
      if (!/\b(add|join)\b/i.test(t)) {
        let best = null;
        for (const [kind, re] of KIN) { const m = bare.match(re); if (m && (!best || m.index < best.at)) best = { kind, at: m.index }; }
        if (best) return kin(t, best.kind);
      }
      for (const it of intents) if (it.re.test(t)) { const r = it.run(t); if (r) return r; }
      const q = t.replace(/^(who is|who's|find|search|show me|look up|tell me about|kaun hai)\s+/i, '').replace(/\?$/, '');
      const people = findPeopleIn(t);
      const res = people.length ? people : F.search(ctx.getIdx(), q, 6);
      if (res.length === 1) {
        const p = res[0]; const m = me();
        const w = m && m.id !== p.id ? termOf(m.id, p.id) : '';
        return { html: `${w ? `<span class="term">Your ${esc(w)}</span>` : ''}${card(p)}${p.bio ? `<div style="margin-top:6px">${esc(p.bio.slice(0, 220))}${p.bio.length > 220 ? '…' : ''}</div>` : ''}`, quick: [{ label: `${F.shortName(p)}'s children`, ask: `Children of ${F.fullName(p)}` }, { label: 'Parents', ask: `Parents of ${F.fullName(p)}` }] };
      }
      if (res.length) return { html: `Here's who I found:${list(res)}` };
      return {
        html: `I couldn't find "${esc(q)}" in the shijra. Ask me about a person by name, or how two people are related.`,
      };
    }

    return { answer, greet };
  }

  root.createBot = createBot;
})(window);
