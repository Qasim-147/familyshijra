/* store-supabase.js — data layer for the GitHub Pages site.
   Uses Supabase (Postgres + Storage + Auth) through its public API.
   If config.js is not filled in yet, falls back to a "setup preview" that keeps data in this browser only. */
(function (root) {
  const PERSON_COLS = ['id', 'slug', 'first_name', 'middle_name', 'last_name', 'maiden_name', 'nickname', 'gender',
    'birth_date', 'birth_place', 'death_date', 'death_place', 'is_living', 'current_place', 'occupation', 'bio',
    'photo_url', 'father_id', 'mother_id', 'spouse_ids', 'visible', 'sample', 'created_at', 'entered_by'];
  const pickPerson = (p) => {
    p = root.Family ? root.Family.upperPerson(p) : p;
    const o = {};
    for (const k of PERSON_COLS) if (k in p) o[k] = p[k] === '' ? null : p[k];
    o.spouse_ids = Array.isArray(p.spouse_ids) ? p.spouse_ids : [];
    return o;
  };
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  function saveBlob(name, text, type = 'application/json') {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
  }

  function createSupabaseStore(cfg) {
    // An emailed invite or password-reset link lands here with type=invite / type=recovery in the address.
    const linkType = (String(location.hash).match(/type=(invite|recovery|signup|magiclink)/) || [])[1] || null;
    const sb = root.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    const listeners = { people: new Set(), settings: new Set(), subs: new Set() };
    const cache = { people: [], settings: {}, subs: [] };
    let admin = false;
    const emit = (k) => listeners[k].forEach((fn) => fn(cache[k]));

    async function fetchAll(table) {
      const out = []; let from = 0;
      for (;;) {
        const { data, error } = await sb.from(table).select('*').order('id').range(from, from + 999);
        if (error) throw error;
        out.push(...data);
        if (data.length < 1000) break;
        from += 1000;
      }
      return out;
    }
    const loadPeople = async () => { cache.people = (await fetchAll('people')).map(Family.upperPerson); emit('people'); };
    const loadSettings = async () => {
      const { data } = await sb.from('settings').select('data').eq('id', 1).maybeSingle();
      cache.settings = (data && data.data) || {}; emit('settings');
    };
    const loadSubs = async () => {
      if (!admin) { cache.subs = []; emit('subs'); return; }
      const { data, error } = await sb.from('submissions').select('*').order('created_at', { ascending: false }).limit(1000);
      if (!error) { cache.subs = data; emit('subs'); }
    };
    const refreshPeople = debounce(() => loadPeople().catch(console.error), 400);
    const refreshSubs = debounce(() => loadSubs().catch(console.error), 400);

    async function checkAdmin() {
      const { data: { session } } = await sb.auth.getSession();
      if (!session) { admin = false; return false; }
      const { data } = await sb.rpc('is_admin');
      admin = !!data; return admin;
    }

    return {
      mode: 'supabase',
      supportsLogin: true,
      photoMax: 700,
      heroMax: 1600,
      async init() {
        await checkAdmin();
        sb.channel('family-live')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'people' }, refreshPeople)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'settings' }, () => loadSettings())
          .on('postgres_changes', { event: '*', schema: 'public', table: 'submissions' }, refreshSubs)
          .subscribe();
        window.addEventListener('focus', () => { refreshPeople(); if (admin) refreshSubs(); });
        await Promise.all([loadPeople(), loadSettings(), loadSubs()]);
        const { data: { session } } = await sb.auth.getSession();
        return { isAdmin: admin, canSubmit: true, needsPassword: !!(session && (linkType === 'invite' || linkType === 'recovery')), signedInEmail: session ? session.user.email : null };
      },
      subscribePeople(fn) { listeners.people.add(fn); fn(cache.people); return () => listeners.people.delete(fn); },
      subscribeSettings(fn) { listeners.settings.add(fn); fn(cache.settings); return () => listeners.settings.delete(fn); },
      subscribeSubmissions(fn) { listeners.subs.add(fn); fn(cache.subs); return () => listeners.subs.delete(fn); },

      async submit(sub) {
        const row = { id: sub.id, type: sub.type, target_id: sub.target_id || null, relation: sub.relation || 'none',
          relative_id: sub.relative_id || null, person: sub.person, submitter: sub.submitter, status: 'pending' };
        const { error } = await sb.from('submissions').insert(row);
        if (error) throw new Error(error.message);
      },
      async savePerson(p) {
        const { error } = await sb.from('people').upsert(pickPerson(p));
        if (error) throw new Error(error.message);
        refreshPeople(); return p;
      },
      async savePeople(list) {
        for (let i = 0; i < list.length; i += 400) {
          const { error } = await sb.from('people').upsert(list.slice(i, i + 400).map(pickPerson));
          if (error) throw new Error(error.message);
        }
        await loadPeople();
      },
      async deletePerson(id) {
        const { error } = await sb.from('people').delete().eq('id', id);
        if (error) throw new Error(error.message);
        refreshPeople();
      },
      async saveSettings(s) {
        const { error } = await sb.from('settings').upsert({ id: 1, data: s });
        if (error) throw new Error(error.message);
        cache.settings = s; emit('settings');
      },
      async updateSubmission(sub, patch) {
        const { error } = await sb.from('submissions').update(patch).eq('id', sub.id);
        if (error) throw new Error(error.message);
        refreshSubs();
      },
      async deleteSubmission(sub) {
        const { error } = await sb.from('submissions').delete().eq('id', sub.id);
        if (error) throw new Error(error.message);
        refreshSubs();
      },
      async uploadPhoto(blob, folder) {
        const path = `${folder}/${Family.uid()}.jpg`;
        const { error } = await sb.storage.from(cfg.photoBucket || 'photos').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
        if (error) throw new Error('Photo upload failed: ' + error.message);
        return sb.storage.from(cfg.photoBucket || 'photos').getPublicUrl(path).data.publicUrl;
      },
      async login(email, password) {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw new Error(error.message);
        const ok = await checkAdmin();
        if (!ok) { await sb.auth.signOut(); throw new Error('This account is not an admin. Add it to the admins table (see README).'); }
        await Promise.all([loadPeople(), loadSubs()]);
        return true;
      },
      async setPassword(password) {
        const { error } = await sb.auth.updateUser({ password });
        if (error) throw new Error(error.message);
        await checkAdmin(); await Promise.all([loadPeople(), loadSubs()]);
        return admin;
      },
      async logout() { await sb.auth.signOut(); admin = false; await Promise.all([loadPeople(), loadSubs()]); },
      async resetPassword(email) {
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.href.split('#')[0] + '#admin' });
        if (error) throw new Error(error.message);
      },
      async exportFile(name, text) { saveBlob(name, text); },
      shareUrl(p) {
        const base = cfg.siteUrl || location.href.split('#')[0].replace(/index\.html$/, '');
        return base.replace(/\/?$/, '/') + 'person/' + p.slug + '/';
      },
    };
  }

  /* Setup preview: runs before Supabase is configured, so you can try the site locally.
     Everything is saved in this browser's localStorage only. */
  function createLocalStore() {
    const KEY = 'shijra-preview-v2';
    let state = null;
    const listeners = { people: new Set(), settings: new Set(), subs: new Set() };
    const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage full or blocked */ } };
    const emit = (k) => listeners[k].forEach((fn) => fn(state[k]));
    const toData = (blob) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
    return {
      mode: 'local',
      supportsLogin: false,
      photoMax: 360,
      heroMax: 1000,
      async init() {
        try { state = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { state = null; }
        if (!state) {
          state = { people: [], settings: {}, subs: [] };
          try {
            const sample = await (await fetch('sample-family.json')).json();
            state.people = sample.people.map((p) => ({ ...p, slug: Family.slugify(p) }));
            state.settings = sample.settings || {};
          } catch (e) { /* no sample file */ }
          persist();
        }
        state.people = state.people.map(Family.upperPerson);
        return { isAdmin: true, canSubmit: true, setupMode: true };
      },
      subscribePeople(fn) { listeners.people.add(fn); fn(state.people); return () => listeners.people.delete(fn); },
      subscribeSettings(fn) { listeners.settings.add(fn); fn(state.settings); return () => listeners.settings.delete(fn); },
      subscribeSubmissions(fn) { listeners.subs.add(fn); fn(state.subs); return () => listeners.subs.delete(fn); },
      async submit(sub) { state.subs = [{ ...sub, created_at: new Date().toISOString() }, ...state.subs]; persist(); emit('subs'); },
      async savePerson(p) { state.people = [...state.people.filter((x) => x.id !== p.id), pickPerson(p)]; persist(); emit('people'); return p; },
      async savePeople(list) { const ids = new Set(list.map((p) => p.id)); state.people = [...state.people.filter((x) => !ids.has(x.id)), ...list.map(pickPerson)]; persist(); emit('people'); },
      async deletePerson(id) { state.people = state.people.filter((x) => x.id !== id); persist(); emit('people'); },
      async saveSettings(s) { state.settings = s; persist(); emit('settings'); },
      async updateSubmission(sub, patch) { state.subs = state.subs.map((x) => (x.id === sub.id ? { ...x, ...patch } : x)); persist(); emit('subs'); },
      async deleteSubmission(sub) { state.subs = state.subs.filter((x) => x.id !== sub.id); persist(); emit('subs'); },
      async uploadPhoto(blob) { return toData(blob); },
      async exportFile(name, text) { saveBlob(name, text); },
      shareUrl(p) { return location.href.split('#')[0] + '#p-' + p.slug; },
    };
  }

  root.createStore = function () {
    const cfg = root.FAMILY_CONFIG || {};
    const configured = cfg.supabaseUrl && !/YOUR-PROJECT/.test(cfg.supabaseUrl) && cfg.supabaseAnonKey && !/YOUR-ANON/.test(cfg.supabaseAnonKey);
    if (configured && root.supabase) return createSupabaseStore(cfg);
    return createLocalStore();
  };
})(window);
