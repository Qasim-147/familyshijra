/* store-claude.js — data layer for the hosted live demo (claude.ai artifact).
   people/<id>       public tree (everyone reads, editors write)
   config/settings   site settings (everyone reads, editors write)
   submissions/<uid> each visitor's own entries; only editors can read all of them */
(function (root) {
  root.createStore = function () {
    let db = null, user = null, uid = null;
    const cache = { people: [], settings: {}, subs: [] };
    const loaded = { people: false, settings: false, subs: false };
    const listeners = { people: new Set(), settings: new Set(), subs: new Set() };
    const emit = (k) => { loaded[k] = true; listeners[k].forEach((fn) => fn(cache[k])); };
    const clean = (o) => JSON.parse(JSON.stringify(o));
    const toData = (blob) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
    const retry = async (fn) => { try { return await fn(); } catch (e) { if (e && e.code === 'unavailable') { await new Promise((r) => setTimeout(r, 400 + Math.random() * 600)); return fn(); } throw e; } };
    const friendly = (e) => {
      const code = e && e.code;
      if (code === 'invalid_argument') return new Error('You don\'t have permission to do that here');
      if (code === 'quota_exceeded') return new Error('The demo database is full. Remove some entries and try again');
      return new Error((e && e.message) || 'Something went wrong');
    };
    return {
      mode: 'artifact',
      supportsLogin: false,
      photoMax: 260,
      heroMax: 900,
      async init() {
        if (!root.claude || !root.claude.use) throw new Error('This demo needs to be opened on claude.ai.');
        [db, user] = await Promise.all([root.claude.use('db'), root.claude.use('user')]);
        if (!db) throw new Error('Data is unavailable in this view.');
        const isAdmin = user ? await user.canEdit() : false;
        uid = user ? await user.id() : null;
        const canWrite = user ? await user.can('data.write') : null;
        db.collection('people').limit(1000).onSnapshot((snap) => { cache.people = snap.docs.map((d) => ({ ...d.data(), id: d.id })); emit('people'); }, console.error);
        db.doc('config/settings').onSnapshot((snap) => { cache.settings = snap.exists ? snap.data() : {}; emit('settings'); }, console.error);
        if (isAdmin) {
          db.collection('submissions').limit(500).onSnapshot((snap) => {
            const out = [];
            for (const d of snap.docs) for (const [, item] of Object.entries((d.data() || {}).items || {})) out.push({ ...item, owner: d.id });
            cache.subs = out; emit('subs');
          }, console.error);
        }
        return { isAdmin, canSubmit: !!uid && canWrite !== false };
      },
      subscribePeople(fn) { listeners.people.add(fn); if (loaded.people) fn(cache.people); return () => listeners.people.delete(fn); },
      subscribeSettings(fn) { listeners.settings.add(fn); if (loaded.settings) fn(cache.settings); return () => listeners.settings.delete(fn); },
      subscribeSubmissions(fn) { listeners.subs.add(fn); if (loaded.subs) fn(cache.subs); return () => listeners.subs.delete(fn); },

      async submit(sub) {
        if (!uid) throw new Error('Sign in to claude.ai to send entries');
        const ref = db.doc('submissions/' + uid);
        try {
          const snap = await retry(() => ref.get());
          const items = { ...((snap.exists && snap.data().items) || {}) };
          items[sub.id] = clean(sub);
          await retry(() => ref.set({ items }));
        } catch (e) { throw friendly(e); }
      },
      async savePerson(p) {
        const body = clean({ ...p, spouse_ids: p.spouse_ids || [] }); delete body.id;
        try { await retry(() => db.doc('people/' + p.id).set(body)); } catch (e) { throw friendly(e); }
        return p;
      },
      async savePeople(list) { for (const p of list) await this.savePerson(p); },
      async deletePerson(id) { try { await retry(() => db.doc('people/' + id).delete()); } catch (e) { throw friendly(e); } },
      async saveSettings(s) { try { await retry(() => db.doc('config/settings').set(clean(s))); } catch (e) { throw friendly(e); } },
      async updateSubmission(sub, patch) {
        try { await retry(() => db.doc('submissions/' + sub.owner).update({ items: { [sub.id]: clean(patch) } })); } catch (e) { throw friendly(e); }
      },
      async deleteSubmission(sub) {
        const ref = db.doc('submissions/' + sub.owner);
        try {
          const snap = await ref.get();
          const items = { ...((snap.exists && snap.data().items) || {}) };
          delete items[sub.id];
          await ref.set({ items });
        } catch (e) { throw friendly(e); }
      },
      async uploadPhoto(blob) { return toData(blob); },
      async exportFile(name, text) {
        const dl = await root.claude.use('downloads');
        if (!dl) throw new Error('Downloads are unavailable here');
        await dl.save({ filename: name, data: text });
      },
      shareUrl(p) { return location.href.split('#')[0] + '#p-' + p.slug; },
    };
  };
})(window);
