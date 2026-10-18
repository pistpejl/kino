(() => {
  const API = (window.KINO_CONFIG && window.KINO_CONFIG.proxyUrl || '').replace(/\/$/, '') + '/api/kino';
  const $ = (s, r = document) => r.querySelector(s);
  const h = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v === true) e.setAttribute(k, '');
      else if (v !== false && v != null) e.setAttribute(k, v);
    }
    for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(k));
    return e;
  };
  const st = {
    lane: localStorage.getItem('kino.lane') === 'nsfw' && localStorage.getItem('kino.21') === '1' ? 'nsfw' : 'sfw',
    engines: {}, config: null, carry: null, results: { image: [], video: [], music: [], edit: [] },
  };
  // UI helpers (visual only): busy spinner on a status line, segmented tabs, empty state
  async function withBusy(el, fn) { el.classList.add('busy'); try { return await fn(); } finally { el.classList.remove('busy'); } }
  const seg = (...items) => h('div', { class: 'seg', role: 'group' }, ...items);
  const empty = (t, sub) => h('div', { class: 'empty' }, h('b', {}, t), sub ? h('span', {}, sub) : null);
  const abs = (u) => (/^(https?:|blob:|data:)/.test(u) ? u : API.replace(/\/api\/kino$/, '') + u);

  async function getEngines(lane, force) {
    const c = st.engines[lane];
    if (!force && c && Date.now() - c.at < 5 * 60000) return c.list;
    const r = await fetch(`${API}/engines?lane=${lane}`).then((x) => x.json()).catch(() => ({ engines: [] }));
    st.engines[lane] = { at: Date.now(), list: [...(r.engines || []), ...puterEngines(lane)], inactive: r.inactive || [] };
    return st.engines[lane].list;
  }
  const getInactive = (lane) => (st.engines[lane] && st.engines[lane].inactive) || [];
  // option / list label: real engine name + small tags (gratis, kö, NSFW-läge, bara SFW)
  const engineLabel = (e) => e.name + ((e.tags && e.tags.length) ? ` · ${e.tags.join(' · ')}` : '');
  const QUEUE_HINT = 'Gratis och delad: kön kan ta 10 sekunder till flera minuter. Du ser köplats och beräknad tid och kan avbryta.';
  async function getConfig() {
    if (!st.config) st.config = await fetch(`${API}/config`).then((x) => x.json()).catch(() => ({ grok: { available: false, message: 'Grok kräver en API-nyckel' } }));
    return st.config;
  }


  // ---- Seedream via Puter.js (client-side, SFW only, user's own Puter account) ----
  const PUTER_SRC = 'https://js.puter.com/v2/';
  const PUTER_MODELS = [
    { id: 'puter:byteplus/seedream-4-5-251128', model: 'byteplus/seedream-4-5-251128', name: 'Seedream 4.5' },
    { id: 'puter:byteplus/seedream-5-0-lite-260128', model: 'byteplus/seedream-5-0-lite-260128', name: 'Seedream 5 Lite' },
  ];
  const puterEngines = (lane) => (lane === 'sfw' ? PUTER_MODELS.flatMap((m) => [
    { id: m.id, name: `${m.name} (via Puter)`, kind: 'image', puter: true, status: 'via Puter' },
    { id: m.id, name: `${m.name} (via Puter)`, kind: 'edit', puter: true, status: 'via Puter' },
  ]) : []);
  let puterLoading = null;
  function loadPuter() {
    if (window.puter) return Promise.resolve(window.puter);
    if (!puterLoading) puterLoading = new Promise((res, rej) => {
      const el = document.createElement('script'); el.src = PUTER_SRC; el.async = true;
      const t = setTimeout(() => rej(new Error('Seedream är upptaget (Puter.js laddades inte).')), 20000);
      el.onload = () => { clearTimeout(t); window.puter ? res(window.puter) : rej(new Error('Seedream är upptaget (Puter.js laddades inte).')); };
      el.onerror = () => { clearTimeout(t); rej(new Error('Seedream är upptaget (Puter.js laddades inte).')); };
      document.head.append(el);
    }).catch((e) => { puterLoading = null; throw e; });
    return puterLoading;
  }
  const TERMS_RE = /(^|[^a-zåäö0-9])(child|children|kids?|minors?|underage|under[\s-]*age|teens?|teenage[rs]?|preteen|tween|adolescent|juvenile|loli(ta|con)?|shota(con)?|young[\s-]*looking|youthful[\s-]*looking|barely[\s-]*legal|jailbait|school[\s-]*(girl|boy|uniform)|pupil|kindergarten|toddler|baby|infant|little[\s-]*(girl|boy)|young[\s-]*(girl|boy)|girls?|boys?|(step)?daughter|(step)?son|barn(et|en|slig)?|ungen?|ungar|minderåriga?|omyndig|tonåring(ar)?|tonårs|tonåren|flick(a|an|or)|pojk(e|en|ar)|skol(flicka|pojke|tjej|uniform|an)|elev(er)?|högstadiet?|mellanstadiet|lågstadiet|gymnasiet|förskola|dagis|bebis|småbarn|dotter|ungdom(ar)?)(?=$|[^a-zåäö0-9])/i;
  const AGE_RE = /\b(\d{1,2})\s*(?:-|\s)?\s*(?:yo|y\/o|yrs?|years?(?:[\s-]*old)?|år(?:ig|ing|s)?|åring)\b|\b(?:age|aged|ålder|åldern)\s*(\d{1,2})\b/gi;
  function minorText(t) {
    const s = String(t || '').toLowerCase();
    if (TERMS_RE.test(s)) return true;
    let m; AGE_RE.lastIndex = 0;
    while ((m = AGE_RE.exec(s))) if (Number(m[1] || m[2]) < 18) return true;
    return false;
  }
  const REFUSE = 'Nekad: KINO gör aldrig något som rör minderåriga.';
  function puterError(e) {
    const o = e || {}; const msg = String((o.error && o.error.message) || o.message || o.code || o).toLowerCase(); const code = o.status || (o.error && o.error.status);
    if (code === 401 || /unauthori|sign.?in|log.?in|auth|popup|cancel|closed/.test(msg)) return 'Seedream kräver inloggning hos Puter';
    if (code === 402 || code === 429 || /credit|fund|balance|quota|limit|insufficient|busy|rate|overload|unavailable/.test(msg)) return 'Seedream är upptaget';
    return `Seedream misslyckades: ${msg.slice(0, 120)}`;
  }
  async function imgToBlob(img) {
    if (!img.complete || !img.naturalWidth) await new Promise((r, j) => { img.onload = r; img.onerror = () => j(new Error('Seedream returnerade en oläsbar bild')); });
    try { const r = await fetch(img.src); if (r.ok) return await r.blob(); } catch { /* canvas fallback */ }
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return new Promise((r, j) => c.toBlob((b) => (b ? r(b) : j(new Error('Kunde inte läsa Seedream-bilden'))), 'image/jpeg', 0.92));
  }
  const blobB64 = (b) => new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]); fr.readAsDataURL(b); });
  const PUTER_RATIO = { '1:1': { w: 1, h: 1 }, '9:16': { w: 9, h: 16 }, '16:9': { w: 16, h: 9 }, '4:5': { w: 4, h: 5 } };
  /** Must be called from a tap/Enter handler: sign-in popup first (user gesture), then server text check, then Puter. */
  async function seedream({ engineId, prompt, ratio, ref }) {
    const m = PUTER_MODELS.find((x) => x.id === engineId);
    if (!m || st.lane !== 'sfw') throw new Error('Seedream är bara för SFW.');
    if (minorText(prompt)) throw new Error(REFUSE);
    let p;
    try {
      p = await loadPuter();
      if (p.auth && p.auth.isSignedIn && !p.auth.isSignedIn()) await p.auth.signIn();
    } catch (e) { throw new Error(e && /upptaget/.test(e.message || '') ? e.message : 'Seedream kräver inloggning hos Puter'); }
    if (p.auth && p.auth.isSignedIn && !p.auth.isSignedIn()) throw new Error('Seedream kräver inloggning hos Puter');
    const chk = await fetch(`${API}/check`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: prompt }) }).catch(() => null);
    if (!chk || !chk.ok) throw new Error(chk && chk.status === 422 ? REFUSE : 'Säkerhetskontrollen är inte tillgänglig, så Seedream kördes inte.');
    const opts = { model: m.model, ratio: PUTER_RATIO[ratio] || PUTER_RATIO['1:1'] };
    if (ref) Object.assign(opts, { input_image: await blobB64(ref), input_image_mime_type: ref.type || 'image/jpeg' });
    let img;
    try { img = await p.ai.txt2img(prompt.slice(0, 1800), opts); } catch (e) { throw new Error(puterError(e)); }
    if (!img || !img.src) throw new Error('Seedream är upptaget');
    const blob = await imgToBlob(img);
    const returned = (img.dataset && (img.dataset.model || img.dataset.modelName)) || img.model || null;
    const label = returned ? String(returned) : m.name;
    return { name: `seedream-${Date.now()}.jpg`, url: URL.createObjectURL(blob), blob, engine: m.id, engineName: `${label} (via Puter)` };
  }

  // ---- lane ----
  const laneBtn = $('#lane');
  function paintLane() {
    const n = st.lane === 'nsfw';
    laneBtn.classList.toggle('nsfw', n); laneBtn.setAttribute('aria-checked', n ? 'true' : 'false');
    laneBtn.setAttribute('aria-label', `Läge: ${n ? 'NSFW' : 'SFW'}. Tryck för att byta till ${n ? 'SFW' : 'NSFW'}`);
  }
  function setLane(l) {
    if (l === 'nsfw' && localStorage.getItem('kino.21') !== '1') {
      $('#gate').hidden = false;
      $('#gateYes').onclick = () => { localStorage.setItem('kino.21', '1'); $('#gate').hidden = true; setLane('nsfw'); };
      $('#gateNo').onclick = () => { $('#gate').hidden = true; };
      return;
    }
    st.lane = l; localStorage.setItem('kino.lane', l); paintLane(); route();
  }
  laneBtn.onclick = () => setLane(st.lane === 'nsfw' ? 'sfw' : 'nsfw');

  // ---- jobs ----
  async function poll(id, onMsg) {
    for (;;) {
      await new Promise((r) => setTimeout(r, 2500));
      const j = await fetch(`${API}/jobs/${id}`).then((x) => x.json()).catch(() => null);
      if (!j) continue;
      if (j.status === 'done') return j.result;
      if (j.status === 'cancelled') throw Object.assign(new Error(j.error || 'Avbruten.'), { cancelled: true });
      if (j.status === 'error') throw Object.assign(new Error(j.error), { busy: j.busy, quota: j.quota, refused: j.refused });
      onMsg && onMsg(j.message);
    }
  }

  // ---- composer ----
  function composer({ kind, placeholder, engineKind, settings, onGo, extraTop, noEngineText }) {
    const ta = h('textarea', { rows: 2, placeholder });
    const go = h('button', { class: 'go', title: 'Skapa', 'aria-label': 'Skapa' }, '↑');
    const sel = h('select', { 'aria-label': 'Modell' });
    const panel = h('div', { class: 'panel', hidden: true }, settings || []);
    const setBtn = h('button', { class: 'text dim', type: 'button', onclick: () => { panel.hidden = !panel.hidden; } }, 'Inställningar');
    const status = h('div', { class: 'status', role: 'status', 'aria-live': 'polite' });
    const cancelBtn = h('button', { class: 'text cancel', type: 'button', hidden: true }, 'Avbryt');
    const hint = h('div', { class: 'hint', hidden: true });
    const inact = h('details', { class: 'inact', hidden: true });
    let engList = [];
    const setCancel = (fn) => { cancelBtn.hidden = !fn; cancelBtn.disabled = false; cancelBtn.onclick = fn ? async () => { cancelBtn.disabled = true; cancelBtn.textContent = 'Avbryter…'; try { await fn(); } finally { cancelBtn.textContent = 'Avbryt'; } } : null; };
    const showHint = () => { const e = engList.find((x) => x.id === sel.value); hint.hidden = !(e && e.async); hint.textContent = e && e.async ? `${e.name}: ${QUEUE_HINT}${e.detail ? ` Läget nu: ${e.detail}.` : ''}` : ''; };
    sel.addEventListener('change', showHint);
    sel.append(h('option', { value: '' }, 'Laddar modeller…')); // replaced when the engine list arrives
    // optional Swedish/any-language prompt rewrite (GMV /api/prompt/enhance), minors check first
    const enhBtn = h('button', { class: 'text dim', type: 'button', onclick: async () => {
      const p0 = ta.value.trim(); if (!p0) return;
      if (minorText(p0)) { status.textContent = REFUSE; status.classList.add('err'); return; }
      enhBtn.disabled = true; status.classList.remove('err'); status.classList.add('busy'); status.textContent = 'Förbättrar prompten…';
      try {
        const r = await fetch(`${API.replace(/\/api\/kino$/, '')}/api/prompt/enhance`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: p0, aspectRatio: '9:16' }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.prompt) throw new Error(j.message || 'Förbättra är upptaget just nu.');
        ta.value = j.prompt; status.textContent = `Prompten förbättrades av ${j.model}. Ändra den eller skapa.`;
      } catch (e) { status.textContent = `Det gick inte att förbättra: ${e.message}`.slice(0, 200); status.classList.add('err'); } finally { enhBtn.disabled = false; status.classList.remove('busy'); }
    } }, 'Förbättra prompt');
    const comp = h('div', { class: 'composer' }, h('div', { class: 'row' }, ta, go), h('div', { class: 'under' }, sel, settings ? setBtn : null, kind === 'image' || kind === 'video' ? enhBtn : null), panel);
    const box = h('div', {}, extraTop || null, comp, hint, status, h('div', { class: 'cancelrow' }, cancelBtn), inact);
    getEngines(st.lane).then((list) => {
      const ok = list.filter((e) => e.kind === engineKind && !(kind === 'music' && e.noMusic));
      engList = ok;
      sel.innerHTML = '';
      ok.forEach((e) => sel.append(h('option', { value: e.id, title: e.detail || '' }, engineLabel(e))));
      // engines that exist but are not usable right now (missing server keys, no free image quota, queue closed): greyed, with the honest reason
      const off = kind === 'image' ? getInactive(st.lane).filter((e) => e.kind === 'image') : [];
      off.forEach((e) => sel.append(h('option', { value: '', disabled: true, title: e.note }, `${e.name} · ej aktiv${(e.tags || []).length ? ' · ' + e.tags.join(' · ') : ''}`)));
      if (off.length) { inact.hidden = false; inact.append(h('summary', {}, `Ej aktiva modeller (${off.length})`), ...off.map((e) => h('p', {}, h('b', {}, e.name), ' – ', e.note))); }
      showHint();
      if (!ok.length) { sel.append(h('option', { value: '' }, noEngineText || 'Ingen modell svarar just nu')); sel.disabled = true; if (kind !== 'video' && kind !== 'music') go.disabled = true; }
      if (kind === 'edit' && !ok.length) say('Redigering fungerar inte just nu.', true);
    });
    function say(t, err) { status.textContent = t || ''; status.classList.toggle('err', Boolean(err)); }
    async function fire() {
      if (go.disabled) return;
      go.disabled = true; go.classList.add('busy'); comp.classList.add('is-busy'); status.classList.add('busy');
      try { await onGo({ prompt: ta.value.trim(), engine: sel.value, say, setCancel }); } catch (e) { say(e.message, !e.cancelled); } finally { setCancel(null); go.disabled = false; go.classList.remove('busy'); comp.classList.remove('is-busy'); status.classList.remove('busy'); }
    }
    go.onclick = fire;
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); fire(); } });
    // optional Gemini prompt rewrite (free text model; SFW lane only; image output is paid-only at Google so there is no Gemini image engine)
    if (kind === 'image' && st.lane === 'sfw') getConfig().then((c) => {
      if (!c.gemini || !c.gemini.available) return;
      const gb = h('button', { class: 'text dim', type: 'button', onclick: async () => {
        const p0 = ta.value.trim(); if (!p0) return;
        if (minorText(p0)) { status.textContent = REFUSE; status.classList.add('err'); return; }
        gb.disabled = true; status.classList.remove('err'); status.classList.add('busy'); status.textContent = 'Gemini skriver om prompten…';
        try {
          const r = await fetch(`${API}/gemini/rewrite`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lane: 'sfw', prompt: p0 }) });
          const j = await r.json().catch(() => ({}));
          if (!r.ok || !j.prompt) throw new Error(j.message || 'Gemini är upptaget just nu.');
          ta.value = j.prompt; status.textContent = `Prompten skrevs om av ${j.engineName}. Ändra den eller skapa.`;
        } catch (e) { status.textContent = String(e.message).slice(0, 220); status.classList.add('err'); } finally { gb.disabled = false; status.classList.remove('busy'); }
      } }, 'Förbättra med Gemini');
      $('.under', comp).append(gb);
    });
    return { box, ta, sel, say, panel };
  }
  const field = (label, input, wide) => h('label', { class: wide ? 'wide' : null }, label, input);
  const select = (opts, val) => { const s = h('select'); opts.forEach(([v, t]) => s.append(h('option', { value: v, selected: v === val }, t))); return s; };
  async function grokToggle() {
    const c = await getConfig();
    const cb = h('input', { type: 'checkbox', disabled: !c.grok.available });
    return { el: h('label', {}, 'Grok', h('span', {}, cb, ' ', c.grok.available ? 'av som standard' : 'Grok kräver en API-nyckel')), cb };
  }
  async function errMsg(r) { const j = await r.json().catch(() => ({})); return j.message || `Error ${r.status}`; }

  function resultCard(item, kind) {
    const media = kind === 'image' || kind === 'edit' ? h('img', { src: abs(item.url), alt: '' }) : h('video', { src: abs(item.url), controls: true, playsinline: true });
    const card = h('div', { class: 'card' }, media, h('div', { class: 'meta' }, item.engineName + (item.credits ? ` · låt: ${item.credits.song} · bilder: ${item.credits.images}` : '')));
    const acts = h('div', { class: 'acts' }, h('a', { class: 'text', href: abs(item.url), download: item.name, target: '_blank' }, 'Ladda ned'));
    if (kind === 'image' || kind === 'edit') {
      acts.append(h('button', { class: 'text', onclick: () => { st.carry = { name: item.name, url: item.url, blob: item.blob }; location.hash = '#/video'; } }, 'Animera'));
      acts.append(h('button', { class: 'text', onclick: () => { st.carry = { name: item.name, url: item.url, blob: item.blob }; location.hash = '#/edit'; } }, 'Redigera'));
    }
    acts.append(h('button', { class: 'text dim', onclick: () => { st.results[kind] = st.results[kind].filter((x) => x !== item); card.remove(); } }, 'Ta bort'));
    card.append(acts);
    // Coverr API terms: show a clickable Coverr credit when Coverr clips are used
    if (item.credits && item.credits.coverr) card.append(h('div', { class: 'meta' }, h('a', { href: item.credits.coverr.url || 'https://coverr.co', target: '_blank', rel: 'noopener' }, item.credits.coverr.text || 'Video från Coverr')));
    return card;
  }
  const EMPTY = { image: 'Dina bilder visas här.', video: 'Dina videoklipp visas här.', music: 'Din musikvideo visas här.', edit: 'Dina redigerade bilder visas här.' };
  const pagehead = (t, sub) => h('div', { class: 'pagehead' }, h('h2', {}, t), sub ? h('p', {}, sub) : null);
  function results(kind) { const g = h('div', { class: 'results', 'data-empty': EMPTY[kind] || 'Inget här än.' }); st.results[kind].forEach((i) => g.append(resultCard(i, kind))); return g; }

  // ---- views ----
  const ICONS = {
    image: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="m21 16-5-5-8 9"/>',
    video: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10.5 9.5 4 2.5-4 2.5z"/>',
    music: '<path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
    script: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h5"/>',
    analyze: '<rect x="3" y="5" width="18" height="14" rx="3"/><circle cx="11" cy="12" r="3"/><path d="m13.2 14.2 2.3 2.3"/>',
    stock: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M7 20h10M12 16v4M3 10h18M8 4v6M16 4v6"/>',
    edit: '<circle cx="6" cy="7" r="2.5"/><circle cx="6" cy="17" r="2.5"/><path d="M8 8.5 20 18M8 15.5 20 6"/>',
    timeline: '<rect x="3" y="6" width="7" height="12" rx="2"/><rect x="12" y="6" width="9" height="12" rx="2"/>',
    klipp: '<circle cx="6" cy="6.5" r="2.5"/><circle cx="6" cy="17.5" r="2.5"/><path d="M8.2 7.8 20 16M8.2 16.2 14 12.3"/><rect x="15" y="4" width="6" height="6" rx="1.5"/>',
  };
  const icon = (k) => { const e = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); e.setAttribute('viewBox', '0 0 24 24'); e.setAttribute('aria-hidden', 'true'); e.innerHTML = ICONS[k]; return e; };
  async function home(v) {
    const nsfw = st.lane === 'nsfw';
    // [icon, title, one-line description, route, preset, SFW-only]
    const TILES = [
      ['image', 'Bild', 'Skriv en text, få en bild', '#/image'],
      ['video', 'Video', 'Text eller bild blir ett videoklipp', '#/video'],
      ['music', 'Musikvideo', 'Låt och bilder blir en klippt video', '#/music'],
      ['script', 'Manus', 'En idé blir scenkort att ändra', '#/script'],
      ['analyze', 'Analysera video', 'Ladda upp ett klipp, få scener', '#/script', 'analyze'],
      ['stock', 'Stockklipp', 'Riktiga klipp till din låt', '#/music', 'stock', true],
      ['edit', 'Redigera', 'Ändra en bild med text', '#/edit'],
      ['timeline', 'Tidslinje', 'Klipp ihop och exportera mp4', '#/timeline'],
      ['klipp', 'Klipp ur lång video', 'Ladda upp en lång video, få de bästa korta klippen med text', '#/klipp', null, false, true],
    ];
    const tile = ([ic, t, d, href, preset, sfwOnly, wide]) => {
      const off = Boolean(sfwOnly && nsfw);
      return h('a', { class: 'tile' + (off ? ' off' : '') + (wide ? ' wide' : ''), href: off ? null : href, 'aria-disabled': off ? 'true' : null, onclick: () => { st.preset = preset || null; } },
        h('span', { class: 'ti' }, icon(ic)), h('b', {}, t), h('small', {}, off ? 'Bara i SFW-läget' : d));
    };
    const models = h('details', { class: 'models' }, h('summary', {}, h('span', { class: 'ttl' }, 'Kollar vilka modeller som svarar…')));
    models.classList.add('loading');
    v.append(
      h('section', { class: 'hero' },
        h('p', { class: 'eyebrow' }, 'AI-studio för bild, video och musik'),
        h('h1', {}, 'Gör bild, video och musikvideo', h('em', {}, '.')),
        h('p', { class: 'lede' }, 'Beskriv en idé, släpp in en låt eller ett klipp så gör KINO resten. Skriv på svenska eller engelska.'),
        h('div', { class: 'cta' }, h('a', { class: 'text primary lg', href: '#/image' }, 'Skapa bild'), h('a', { class: 'text lg', href: '#/music' }, 'Musikvideo'))),
      h('h2', { class: 'sect' }, 'Vad vill du göra?'),
      h('div', { class: 'tiles' }, TILES.map(tile)),
      h('p', { class: 'lanenote' + (nsfw ? ' nsfw' : '') }, nsfw
        ? 'NSFW-läge är på: endast för vuxna 21+. Minderåriga blockeras alltid, inga foton på riktiga personer, modellnamn visas ärligt och det finns ingen tyst reservmodell. Byt tillbaka med SFW-knappen uppe till höger.'
        : 'Läge: SFW. Vuxeninnehåll (21+) finns bakom NSFW-knappen uppe till höger.'),
      models);
    const list = await getEngines(st.lane);
    const kinds = { image: 'Bild', video: 'Video', edit: 'Redigera', music: 'Låt' };
    models.classList.remove('loading');
    models.innerHTML = '';
    models.append(h('summary', {}, h('span', { class: 'ttl' }, `Modeller som svarar nu · ${nsfw ? 'NSFW' : 'SFW'}`), h('span', { class: 'count' }, String(list.length)), h('span', { class: 'chev', 'aria-hidden': 'true' })));
    const ul = h('ul');
    list.forEach((e) => ul.append(h('li', {}, h('b', {}, e.name, ...(e.tags || []).map((t) => h('span', { class: 'etag' + (t === 'NSFW-läge' ? ' nsfw' : '') }, t))), `${kinds[e.kind] || e.kind}${e.puter ? ' · körs via Puter' : ''}`)));
    getInactive(st.lane).forEach((e) => ul.append(h('li', { class: 'off', title: e.note }, h('b', {}, e.name, ...(e.tags || []).map((t) => h('span', { class: 'etag' }, t)), h('span', { class: 'etag off' }, 'ej aktiv')), h('span', { class: 'why' }, e.note))));
    if (!list.length) ul.append(h('li', {}, 'Ingen modell svarar just nu.'));
    models.append(ul);
  }

  async function imageView(v) {
    const ratio = select([['1:1', '1:1'], ['9:16', '9:16'], ['16:9', '16:9'], ['4:5', '4:5']], '1:1');
    const res = select([['standard', 'Standard'], ['high', 'Hög']], 'standard');
    const count = select([['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']], '1');
    const lora = select([['auto', 'auto'], ['none', 'ingen'], ['photo', 'foto'], ['cinematic', 'filmisk']], 'auto');
    const grid = results('image');
    const c = composer({ kind: 'image', engineKind: 'image', placeholder: 'Beskriv en bild', settings: [field('Format', ratio), field('Upplösning', res), field('Antal', count), field('LoRA', lora)],
      onGo: async ({ prompt, engine, say, setCancel }) => {
        if (!prompt) return say('Skriv en prompt.', true);
        if (engine.startsWith('puter:')) {
          const n = Math.max(1, Math.min(4, +count.value || 1));
          for (let i = 0; i < n; i++) {
            say(i ? `Seedream ${i + 1}/${n}…` : 'Seedream (Puter)… första gången ber den dig logga in hos Puter.');
            const item = await seedream({ engineId: engine, prompt, ratio: ratio.value });
            st.results.image.unshift(item); grid.prepend(resultCard(item, 'image'));
          }
          return say(`Gjord av ${st.results.image[0].engineName}.${lora.value === 'photo' || lora.value === 'cinematic' ? ' LoRA finns inte för Seedream.' : ''}`);
        }
        say('Skapar…');
        const r = await fetch(`${API}/image`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lane: st.lane, engine, prompt, ratio: ratio.value, resolution: res.value, count: count.value, lora: lora.value }) });
        if (!r.ok) return say(await errMsg(r), true);
        let j = await r.json();
        if (j.async) {
          // queue-based engine (AI Horde): live queue position / estimated wait from the server, with a cancel button
          setCancel(async () => { await fetch(`${API}/jobs/${j.jobId}`, { method: 'DELETE' }).catch(() => null); });
          j = await poll(j.jobId, (m) => say(m));
          setCancel(null);
        }
        j.images.forEach((i) => { st.results.image.unshift(i); grid.prepend(resultCard(i, 'image')); });
        say(j.loraNote || (j.images[0] && j.images[0].waitedSeconds != null ? `Gjord av ${j.engineName} (${j.images[0].waitedSeconds} s totalt).${j.note ? ' ' + j.note : ''}` : `Gjord av ${j.engineName}.`));
      } });
    v.append(pagehead('Bild', 'Skriv vad du vill se. Välj modell och format under Inställningar.'), c.box, grid);
  }

  function fileField(label, accept, carry) {
    const inp = h('input', { type: 'file', accept });
    const wrap = h('label', {}, label, inp);
    const o = { el: wrap, inp, ref: carry && !carry.blob ? carry.name : null, blob: carry && carry.blob ? carry.blob : null };
    if (carry) {
      const t = h('div', { class: 'thumb' }, h('img', { src: abs(carry.url) }), h('button', { type: 'button', 'aria-label': 'Ta bort', onclick: (e) => { e.preventDefault(); o.ref = null; o.blob = null; t.remove(); } }, '×'));
      wrap.append(t);
    }
    return o;
  }

  const CLIP_TOOLS = [['Google Vids', 'https://vids.google.com/'], ['Google Flow', 'https://labs.google/flow'], ['Dola', 'https://www.dola.com/'], ['Grok Imagine', 'https://grok.com/imagine'], ['Digen', 'https://digen.ai/create'], ['DreamFace', 'https://www.dreamfaceapp.com/tools/free-ai-video-generator'], ['Bing Video Creator', 'https://www.bing.com/images/create/ai-video-generator'], ['PixVerse', 'https://app.pixverse.ai/'], ['Kling', 'https://kling.ai/app/'], ['Vidu', 'https://www.vidu.com/'], ['Krea', 'https://www.krea.ai/video'], ['Meta AI (bild)', 'https://www.meta.ai/'], ['giz.ai', 'https://www.giz.ai/text-to-video/'], ['Hugging Face Wan 2.2', 'https://huggingface.co/spaces/zerogpu-aoti/wan2-2-fp8da-aoti-faster'], ['Coverr', 'https://coverr.co/'], ['Mixkit', 'https://mixkit.co/free-stock-video/'], ['ImagineArt', 'https://www.imagine.art/ai-video-generator'], ['fal H3', 'https://fal.ai/minimax-h3-max'], ['fal Wan 3', 'https://fal.ai/wan-video-free'], ['Pippit', 'https://www.pippit.ai/'], ['ToolFK Wan', 'https://www.toolfk.com/tools/hf-wan-image-to-video.html'], ['ToolFK Bild', 'https://www.toolfk.com/tools/online-text-to-img.html'], ['Finputsa i OpenCut', 'https://opencut.app']];
  // Grouping + small free-allowance hints live in a separate map, so a new [name, url] pair added to CLIP_TOOLS still shows up (in Video-AI) without touching this.
  // Hints are rough and can change at any time; the footnote says so.
  const CLIP_GROUPS = [['v', 'Video-AI', 'Text/bild → videoklipp'], ['i', 'Bild-AI', 'Gör en bild, animera den under Video'], ['s', 'Stockklipp', 'Riktiga klipp, gratis att ladda ned'], ['e', 'Redigera', 'Finputsa klippen du laddat ned']];
  const CLIP_META = {
    'Google Vids': ['v', 'några gratisklipp/mån'], 'Google Flow': ['v', 'dagskrediter (ev. plan)'], 'Dola': ['v', 'kolla gratisnivå'], 'Grok Imagine': ['v', 'gratisnivå varierar'],
    'Digen': ['v', 'några gratisförsök/dag'], 'DreamFace': ['v', 'kolla gratisnivå'], 'Bing Video Creator': ['v', '10 snabba, sen långsamt'], 'PixVerse': ['v', 'dagskrediter'],
    'Kling': ['v', 'gratiskrediter'], 'Vidu': ['v', 'bonus vid inloggning'], 'Krea': ['v', 'dagskrediter'], 'giz.ai': ['v', 'kolla gratisnivå'],
    'Hugging Face Wan 2.2': ['v', 'gratis, ibland kö'], 'ImagineArt': ['v', 'dagskrediter'], 'fal H3': ['v', 'kolla gratisnivå'], 'fal Wan 3': ['v', 'kolla gratisnivå'], 'Pippit': ['v', 'kolla gratisnivå'], 'ToolFK Wan': ['v', 'bild till video, gratis dagskvot, gäster har gräns'],
    'Meta AI (bild)': ['i', 'gratis med konto'], 'ToolFK Bild': ['i', 'Flux, FLUX.2 Dev'], 'Coverr': ['s', 'gratis stockklipp'], 'Mixkit': ['s', 'gratis stockklipp'], 'Finputsa i OpenCut': ['e', 'gratis editor i webbläsaren'],
  };
  // Small secondary link to a free in-browser editor (shown on Tidslinje and Klipp results).
  const finputsaLink = (cls = '') => h('div', { class: ('meta finputsa ' + cls).trim() }, h('a', { href: 'https://opencut.app', target: '_blank', rel: 'noopener' }, 'Finputsa i OpenCut'), ' – gratis editor i webbläsaren, filerna stannar på din enhet');
  function clipSources({ open } = {}) {
    const chip = ([n, u]) => { const hint = (CLIP_META[n] || [])[1]; return h('a', { class: 'chip', href: u, target: '_blank', rel: 'noopener' }, h('span', { class: 'cn' }, n), hint ? h('span', { class: 'ch' }, hint) : null); };
    const groups = CLIP_GROUPS.map(([g, title, sub]) => {
      const tools = CLIP_TOOLS.filter(([n]) => ((CLIP_META[n] || [])[0] || 'v') === g);
      return tools.length ? h('section', { class: 'cgroup' }, h('h3', {}, title, h('small', {}, sub)), h('div', { class: 'chips' }, tools.map(chip))) : null;
    });
    const d = h('details', { class: 'clips' }, h('summary', {}, h('span', { class: 'ttl' }, 'Hämta klipp från'), h('span', { class: 'count' }, `${CLIP_TOOLS.length} länkar`), h('span', { class: 'chev', 'aria-hidden': 'true' })),
      h('div', { class: 'clips-body' }, ...groups, h('div', { class: 'meta clips-note' }, 'Gör klipp där, ladda ned dem och ladda sedan upp dem här.'), h('div', { class: 'meta clips-note' }, 'Gratisnivåerna är ungefärliga och ändras ofta – kolla varje tjänst.')));
    d.open = Boolean(open);
    return h('div', { class: 'srcrow' }, d);
  }
  async function videoView(v) {
    const carry = st.carry; st.carry = null;
    const first = fileField('Första bildruta', 'image/*', carry);
    const last = fileField('Sista bildruta', 'image/*');
    const len = select([['2', '2 s'], ['3', '3 s'], ['4', '4 s'], ['5', '5 s'], ['6', '6 s'], ['8', '8 s'], ['10', '10 s'], ['12', '12 s'], ['15', '15 s (Grok)'], ['30', '30 s (Grok)'], ['60', '1 min (Grok)'], ['120', '2 min (Grok)']], '4');
    const ratio = select([['16:9', '16:9'], ['9:16', '9:16'], ['1:1', '1:1']], '16:9');
    const g = await grokToggle();
    const grid = results('video');
    const c = composer({ kind: 'video', engineKind: 'video', placeholder: 'Beskriv ett klipp', settings: [first.el, last.el, field('Längd', len), field('Format', ratio), g.el],
      onGo: async ({ prompt, engine, say }) => {
        if (!prompt) return say('Skriv en prompt.', true);
        if (!g.cb.checked && !engine) return say('Ingen videomodell svarar just nu.', true);
        const fd = new FormData();
        fd.append('lane', st.lane); fd.append('engine', engine); fd.append('prompt', prompt); fd.append('seconds', len.value); fd.append('ratio', ratio.value); fd.append('grok', g.cb.checked ? '1' : '0');
        if (first.inp.files[0]) fd.append('first', first.inp.files[0]); else if (first.blob) fd.append('first', first.blob, 'seedream.jpg'); else if (first.ref) fd.append('firstRef', first.ref);
        if (last.inp.files[0]) fd.append('last', last.inp.files[0]);
        say('Skickar…');
        const r = await fetch(`${API}/video`, { method: 'POST', body: fd });
        if (!r.ok) return say(await errMsg(r), true);
        const j = await r.json();
        say(`${j.engineName} jobbar… video kan ta några minuter.`);
        try {
          const out = await poll(j.jobId, (m) => say(m));
          st.results.video.unshift(out); grid.prepend(resultCard(out, 'video')); say(`Gjord av ${out.engineName}.`);
        } catch (e) { say(e.message, true); }
      } });
    v.append(pagehead('Video', 'Beskriv ett klipp, eller börja från en bild. Video kan ta några minuter.'), c.box, clipSources(), grid);
  }

  async function musicView(v) {
    const songIn = h('input', { type: 'file', accept: '.mp3,.wav,.m4a,audio/mpeg,audio/wav,audio/x-m4a,audio/mp4', hidden: true });
    const imgIn = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
    let song = null; let imgs = [];
    const songBox = h('div', { class: 'drop' });
    const thumbs = h('div', { class: 'thumbs' });
    function paintSong() {
      songBox.innerHTML = '';
      if (!song) return songBox.append(h('div', { class: 'hintline' }, h('button', { class: 'text', onclick: () => songIn.click() }, 'Ladda upp låt'), h('span', { class: 'meta' }, 'mp3, wav, m4a · max 20 MB')));
      songBox.append(h('div', { class: 'hintline' }, h('b', {}, song.name), h('button', { class: 'text dim', onclick: () => { song = null; paintSong(); } }, 'Ta bort låt')), h('audio', { controls: true, src: URL.createObjectURL(song) }));
    }
    function paintImgs() {
      thumbs.innerHTML = '';
      imgs.forEach((f, i) => thumbs.append(h('div', { class: 'thumb' }, h('img', { src: URL.createObjectURL(f) }), h('button', { type: 'button', 'aria-label': 'Ta bort', onclick: () => { imgs.splice(i, 1); paintImgs(); } }, '×'))));
    }
    songIn.onchange = () => { const f = songIn.files[0]; songIn.value = ''; if (!f) return; if (f.size > 20 * 1024 * 1024 || !/\.(mp3|wav|m4a)$/i.test(f.name)) return alert('Låten måste vara mp3, wav eller m4a, max 20 MB.'); song = f; paintSong(); };
    imgIn.onchange = () => { imgs = imgs.concat([...imgIn.files]).slice(0, 8); imgIn.value = ''; paintImgs(); };
    paintSong();
    const top = h('div', { class: 'uploads' }, songIn, imgIn, songBox, h('div', { class: 'drop' }, h('div', { class: 'hintline' }, h('button', { class: 'text', onclick: () => imgIn.click() }, 'Ladda upp bilder'), h('span', { class: 'meta' }, 'upp till 8')), thumbs));
    const cfg = await getConfig();
    const genre = select((cfg.genres || ['pop', 'r&b', 'rap', 'rock', 'hyperpop', 'ballad', 'rave', 'score']).map((x) => [x, x]), 'pop');
    const ratio = select([['9:16', '9:16'], ['16:9', '16:9'], ['1:1', '1:1']], '9:16');
    const len = select([['10', '10 s'], ['15', '15 s'], ['30', '30 s'], ['60', '60 s']], '15');
    const lyrics = h('textarea', { rows: 3 });
    const look = h('input', { type: 'text' });
    const action = h('input', { type: 'text' });
    const overlay = h('input', { type: 'text', placeholder: 'Stockläge: valfri titeltext' });
    const g = await grokToggle();
    const motion = select([['none', 'ingen (klipp i takt med musiken)'], ...(st.lane === 'sfw' && cfg.agnes && cfg.agnes.available ? [['agnes', 'Agnes Video (riktig rörelse, upp till 30 s, ca 1 klipp/min)']] : []), ...(st.lane === 'sfw' ? [['stock', `Stockklipp (${(cfg.stock && cfg.stock.source) || 'Wikimedia Commons'}) – riktigt stockmaterial, inte AI`]] : [])], 'none');
    // Stock source: 3-way toggle Riktiga / AI / Blanda (sent as source=real|ai|mix)
    let stockSrc = 'real';
    const srcBtns = [['real', 'Riktiga'], ['ai', 'AI'], ['mix', 'Blanda']].map(([v, t]) => h('button', { type: 'button', class: 'seg-b', 'data-v': v, onclick: () => { stockSrc = v; paintSrc(); } }, t));
    const srcHint = h('span', { class: 'meta seg-hint' });
    const paintSrc = () => {
      srcBtns.forEach((b) => { const on = b.getAttribute('data-v') === stockSrc; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
      srcHint.textContent = { real: 'riktiga stockklipp (ej AI)', ai: 'AI-genererade stockklipp från Pixabay', mix: 'både riktiga och AI-genererade' }[stockSrc];
    };
    const srcToggle = h('div', { class: 'seg-wrap', role: 'group', 'aria-label': 'Stockkälla' }, seg(...srcBtns), srcHint);
    paintSrc();
    const grid = results('music');
    const c = composer({ kind: 'music', engineKind: 'image', placeholder: 'Vad handlar videon om?', noEngineText: 'Ingen bildmodell svarar (behövs utan egna bilder)',
      settings: [field('Genre', genre), field('Format', ratio), field('Längd', len), field('Utseende', look), field('Handling', action), field('Rörelse', motion, true), field('Stockklipp', srcToggle, true), field('Text i bild', overlay), g.el, field('Låttext', lyrics, true)],
      onGo: async ({ prompt, engine, say }) => {
        if (motion.value === 'stock') {
          if (!song) return say('Stockläge kräver en uppladdad låt.', true);
          const sf = new FormData();
          sf.append('prompt', prompt); sf.append('text', overlay.value); sf.append('seconds', len.value === '60' ? '45' : len.value); sf.append('source', stockSrc); sf.append('song', song);
          say('Laddar upp…');
          const r0 = await fetch(`${API}/stock`, { method: 'POST', body: sf });
          if (!r0.ok) return say(await errMsg(r0), true);
          const j0 = await r0.json();
          try {
            const out = await poll(j0.jobId, (m) => say(m));
            const by = out.credits.footage.map((f) => f.by).join('; ');
            const lbl = out.source === 'ai' ? 'AI-genererade stockklipp (Pixabay)' : out.source === 'mix' ? (out.kind || 'stockklipp, riktiga + AI-genererade') : 'riktigt stockmaterial, inte AI-video';
            out.credits = { ...out.credits, images: `${lbl}: ${by}` };
            st.results.music.unshift(out); grid.prepend(resultCard(out, 'music'));
            say(`${out.engineName} · ${lbl} · Låt: ${out.credits.song} · Material: ${by}`);
          } catch (e) { say(e.message, true); }
          return;
        }
        if (!imgs.length && !engine) return say('Ladda upp bilder: ingen bildmodell svarar just nu.', true);
        if (!imgs.length && engine.startsWith('puter:')) return say('Seedream körs i din webbläsare och kan inte göra stillbilder till musikvideo. Välj en annan modell eller ladda upp bilder.', true);
        const fd = new FormData();
        fd.append('lane', st.lane); fd.append('prompt', prompt); fd.append('genre', genre.value); fd.append('ratio', ratio.value); fd.append('seconds', len.value);
        fd.append('lyrics', lyrics.value); fd.append('look', look.value); fd.append('action', action.value); fd.append('grok', g.cb.checked ? '1' : '0'); fd.append('motion', motion.value); fd.append('imageEngine', engine.startsWith('puter:') ? '' : engine);
        if (song) fd.append('song', song);
        imgs.forEach((f) => fd.append('images', f));
        say('Laddar upp…');
        const r = await fetch(`${API}/music`, { method: 'POST', body: fd });
        if (!r.ok) return say(await errMsg(r), true);
        const j = await r.json();
        try {
          const out = await poll(j.jobId, (m) => say(m));
          st.results.music.unshift(out); grid.prepend(resultCard(out, 'music'));
          say(`Låt: ${out.credits.song} · Bilder: ${out.credits.images} · Rörelse: ${out.credits.motion}`);
        } catch (e) { say(e.message, true); }
      } });
    if (st.preset === 'stock' && st.lane === 'sfw' && [...motion.options].some((o) => o.value === 'stock')) {
      motion.value = 'stock'; c.panel.hidden = false;
      c.say('Stockklipp: ladda upp en låt, välj källa under Inställningar och skapa.');
    }
    st.preset = null;
    v.append(musicTabs('mv'), pagehead('Musikvideo', 'Ladda upp en låt och bilder, eller låt KINO göra stillbilderna. Stockklipp finns under Inställningar.'), top, c.box, grid);
  }

  async function editView(v) {
    const carry = st.carry; st.carry = null;
    const imgIn = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
    let files = []; let refs = carry ? [carry] : [];
    const thumbs = h('div', { class: 'thumbs' });
    function paint() {
      thumbs.innerHTML = '';
      refs.forEach((r, i) => thumbs.append(h('div', { class: 'thumb' }, h('img', { src: abs(r.url) }), h('button', { type: 'button', 'aria-label': 'Ta bort', onclick: () => { refs.splice(i, 1); paint(); } }, '×'))));
      files.forEach((f, i) => thumbs.append(h('div', { class: 'thumb' }, h('img', { src: URL.createObjectURL(f) }), h('button', { type: 'button', 'aria-label': 'Ta bort', onclick: () => { files.splice(i, 1); paint(); } }, '×'))));
    }
    imgIn.onchange = () => { files = files.concat([...imgIn.files]).slice(0, 8); imgIn.value = ''; paint(); };
    paint();
    const top = h('div', { class: 'uploads' }, imgIn, h('div', { class: 'tl-top' }, seg(h('span', { class: 'on', 'aria-current': 'page' }, 'Redigera'), h('a', { href: '#/timeline' }, 'Tidslinje'))), h('div', { class: 'drop' }, h('div', { class: 'hintline' }, h('button', { class: 'text', onclick: () => imgIn.click() }, 'Lägg till referensbilder')), thumbs));
    const grid = results('edit');
    const c = composer({ kind: 'edit', engineKind: 'edit', placeholder: 'Vad ska ändras?', noEngineText: 'Redigering fungerar inte just nu.',
      onGo: async ({ prompt, engine, say }) => {
        if (!prompt) return say('Skriv en prompt.', true);
        if (!files.length && !refs.length) return say('Lägg till en referensbild.', true);
        if (engine.startsWith('puter:')) {
          const ref = files[0] || (refs[0] && (refs[0].blob || await fetch(abs(refs[0].url)).then((x) => x.blob())));
          say('Seedream (Puter)… första gången ber den dig logga in hos Puter.');
          const item = await seedream({ engineId: engine, prompt, ratio: '1:1', ref });
          st.results.edit.unshift(item); grid.prepend(resultCard(item, 'edit'));
          return say(`Gjord av ${item.engineName}.${files.length + refs.length > 1 ? ' Seedream via Puter tar en referens; den första användes.' : ''}`);
        }
        const fd = new FormData();
        fd.append('lane', st.lane); fd.append('engine', engine); fd.append('prompt', prompt);
        files.forEach((f) => fd.append('images', f)); refs.forEach((r) => (r.blob ? fd.append('images', r.blob, 'seedream.jpg') : fd.append('refs', r.name)));
        say('Skickar…');
        const r = await fetch(`${API}/edit`, { method: 'POST', body: fd });
        if (!r.ok) return say(await errMsg(r), true);
        const j = await r.json();
        try {
          const out = await poll(j.jobId, (m) => say(m));
          st.results.edit.unshift(out); grid.prepend(resultCard(out, 'edit')); say(out.note || `Gjord av ${out.engineName}.`);
        } catch (e) { say(e.message, true); }
      } });
    v.append(top, pagehead('Redigera', 'Ändra en bild med text. Lägg till en eller flera referensbilder.'), c.box, clipSources(), grid);
  }


  // ---- Timeline ----
  st.tl = st.tl || { ratio: '9:16', clips: [], music: null };
  let tlSeq = 0;
  const RATIO_WH = { '9:16': [720, 1280], '1:1': [720, 720], '16:9': [1280, 720] };
  function sessionItems() {
    const out = [];
    for (const k of ['image', 'edit']) st.results[k].forEach((i) => out.push({ kind: 'image', name: i.name, url: abs(i.url), label: i.engineName, blob: i.blob }));
    for (const k of ['video', 'music']) st.results[k].forEach((i) => out.push({ kind: 'video', name: i.name, url: abs(i.url), label: i.engineName }));
    return out;
  }
  function mediaDuration(url) {
    return new Promise((res) => { const v = document.createElement('video'); v.preload = 'metadata'; v.onloadedmetadata = () => res(v.duration || 0); v.onerror = () => res(0); v.src = url; });
  }
  async function addClip(c) {
    const clip = { id: ++tlSeq, text: '', duration: 3, start: 0, end: 0, ...c };
    if (clip.kind === 'video') { clip.mediaDur = await mediaDuration(clip.url); clip.end = +clip.mediaDur.toFixed(2); }
    st.tl.clips.push(clip);
  }
  function clipLen(c) { return c.kind === 'image' ? Math.max(0.3, +c.duration || 3) : Math.max(0.1, (+c.end || c.mediaDur || 0) - (+c.start || 0)); }
  async function overlayBlob(text, ratio) {
    const [w, hh] = RATIO_WH[ratio];
    const cv = document.createElement('canvas'); cv.width = w; cv.height = hh;
    const g = cv.getContext('2d');
    const size = Math.round(w * 0.075);
    g.font = `italic 800 ${size}px -apple-system, Helvetica, Arial, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'bottom';
    g.shadowColor = 'rgba(0,0,0,.85)'; g.shadowBlur = size * 0.4;
    g.fillStyle = '#fff';
    const words = text.split(/\s+/); const lines = []; let line = '';
    for (const wd of words) { const t = line ? line + ' ' + wd : wd; if (g.measureText(t).width > w * 0.86 && line) { lines.push(line); line = wd; } else line = t; }
    if (line) lines.push(line);
    lines.forEach((l, i) => g.fillText(l, w / 2, hh * 0.88 - (lines.length - 1 - i) * size * 1.15));
    return new Promise((r) => cv.toBlob(r, 'image/png'));
  }

  async function timelineView(v) {
    const T = st.tl;
    const ratio = select([['9:16', '9:16'], ['1:1', '1:1'], ['16:9', '16:9']], T.ratio);
    ratio.onchange = () => { T.ratio = ratio.value; paintStage(); };
    const fileIn = h('input', { type: 'file', accept: 'video/*,image/*', multiple: true, hidden: true });
    const musicIn = h('input', { type: 'file', accept: 'audio/*,.mp3,.wav,.m4a', hidden: true });
    const list = h('div', { class: 'tl-list' });
    const pickBox = h('div', { class: 'tl-pick', hidden: true });
    const musicBox = h('div');
    const status = h('div', { class: 'status', role: 'status', 'aria-live': 'polite' });
    const say = (t, err) => { status.textContent = t || ''; status.classList.toggle('err', Boolean(err)); };
    const stage = h('div', { class: 'tl-stage' });
    const out = h('div', { class: 'results', 'data-empty': 'Din exporterade video visas här.' });

    fileIn.onchange = async () => {
      for (const f of [...fileIn.files]) await addClip({ kind: f.type.startsWith('image') ? 'image' : 'video', file: f, url: URL.createObjectURL(f), label: f.name });
      fileIn.value = ''; paintList();
    };
    musicIn.onchange = () => { const f = musicIn.files[0]; musicIn.value = ''; if (f) { T.music = { file: f, url: URL.createObjectURL(f), name: f.name, volume: 1 }; paintMusic(); } };

    function paintPick() {
      pickBox.innerHTML = '';
      const items = sessionItems();
      if (!items.length) pickBox.append(empty('Inget har gjorts i den här sessionen än.'));
      items.forEach((it) => pickBox.append(h('button', { class: 'text', onclick: async () => { await addClip(it.blob ? { kind: it.kind, file: new File([it.blob], it.name, { type: it.blob.type || 'image/jpeg' }), url: it.url, label: it.label } : { kind: it.kind, ref: it.name, url: it.url, label: it.label }); paintList(); } }, `${it.kind === 'image' ? 'Bild' : 'Video'} · ${it.label}`)));
    }
    function paintMusic() {
      musicBox.innerHTML = '';
      musicBox.className = 'drop';
      const songs = st.results.music;
      if (!T.music) {
        musicBox.append(h('div', { class: 'hintline' }, h('button', { class: 'text', onclick: () => musicIn.click() }, 'Ladda upp musik')));
        songs.forEach((s) => musicBox.firstChild.append(h('button', { class: 'text dim', onclick: () => { T.music = { ref: s.name, url: abs(s.url), name: `KINO-låt (${s.credits ? s.credits.song : s.engineName})`, volume: 1 }; paintMusic(); } }, 'Använd KINO-låt')));
        return;
      }
      const vol = h('input', { type: 'range', min: 0, max: 1.5, step: 0.05, value: T.music.volume });
      vol.oninput = () => { T.music.volume = +vol.value; };
      musicBox.append(h('div', { class: 'hintline' }, h('b', {}, `Musik: ${T.music.name}`), h('button', { class: 'text dim danger', onclick: () => { T.music = null; paintMusic(); } }, 'Ta bort')), h('label', { class: 'tl-vol' }, 'Volym ', vol));
    }
    function num(val, on, step = 0.1) { const i = h('input', { type: 'number', step, min: 0, value: val, inputmode: 'decimal' }); i.onchange = () => on(+i.value); return i; }
    function paintList() {
      list.innerHTML = '';
      if (!T.clips.length) list.append(empty('Inga klipp än.', 'Lägg till videor eller bilder, eller välj något du gjort i den här sessionen.'));
      T.clips.forEach((c, idx) => {
        const handle = h('span', { class: 'tl-handle' }, 'Flytta');
        const txt = h('input', { type: 'text', placeholder: 'Text på klippet', value: c.text });
        txt.oninput = () => { c.text = txt.value; };
        const fields = c.kind === 'image'
          ? [h('label', {}, 'Sekunder', num(c.duration, (x) => { c.duration = x; }))]
          : [h('label', {}, 'Start', num(c.start, (x) => { c.start = x; })), h('label', {}, 'Slut', num(c.end, (x) => { c.end = x; }))];
        const thumb = c.kind === 'image' ? h('img', { src: c.url }) : h('video', { src: c.url, muted: true, playsinline: true, preload: 'metadata' });
        const row = h('div', { class: 'tl-row', 'data-id': c.id }, handle, h('div', { class: 'tl-thumb' }, thumb),
          h('div', { class: 'tl-fields' }, h('div', { class: 'meta' }, `${idx + 1}. ${c.label || c.kind}`), h('div', { class: 'tl-nums' }, ...fields), txt),
          h('button', { class: 'text dim danger', onclick: () => { T.clips = T.clips.filter((x) => x !== c); paintList(); } }, 'Ta bort'));
        dragify(handle, row);
        list.append(row);
      });
    }
    // touch + mouse drag to reorder (pointer events)
    function dragify(handle, row) {
      handle.addEventListener('pointerdown', (e) => {
        e.preventDefault(); row.classList.add('drag');
        const move = (ev) => {
          const rows = [...list.querySelectorAll('.tl-row')];
          const target = rows.find((r2) => r2 !== row && ev.clientY > r2.getBoundingClientRect().top && ev.clientY < r2.getBoundingClientRect().bottom);
          if (!target) return;
          const r = target.getBoundingClientRect();
          list.insertBefore(row, ev.clientY < r.top + r.height / 2 ? target : target.nextSibling);
        };
        const up = () => {
          window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
          row.classList.remove('drag');
          const order = [...list.querySelectorAll('.tl-row')].map((r2) => +r2.dataset.id);
          T.clips.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
          paintList();
        };
        window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
      });
    }
    // preview: plays clips in order with text, music underneath
    let playing = null;
    function paintStage() { const [w, hh] = RATIO_WH[T.ratio]; stage.style.aspectRatio = `${w} / ${hh}`; stage.style.width = `min(100%, calc(60vh * ${(w / hh).toFixed(4)}))`; }
    async function preview() {
      if (playing) { playing.stop(); return; }
      if (!T.clips.length) return say('Lägg till klipp först.', true);
      let stopped = false; const audio = T.music ? new Audio(T.music.url) : null;
      playing = { stop: () => { stopped = true; if (audio) audio.pause(); stage.innerHTML = ''; playing = null; prevBtn.textContent = 'Förhandsvisa'; } };
      prevBtn.textContent = 'Stopp';
      if (audio) { audio.volume = Math.min(1, T.music.volume); audio.play().catch(() => {}); }
      for (const c of T.clips) {
        if (stopped) return;
        stage.innerHTML = '';
        const el = c.kind === 'image' ? h('img', { src: c.url }) : h('video', { src: c.url, muted: true, playsinline: true, autoplay: true });
        stage.append(el); if (c.text) stage.append(h('div', { class: 'tl-text' }, c.text));
        if (c.kind === 'video') { el.currentTime = +c.start || 0; el.play().catch(() => {}); }
        await new Promise((r) => setTimeout(r, clipLen(c) * 1000));
      }
      if (!stopped) playing.stop();
    }
    async function exportMp4() {
      if (!T.clips.length) return say('Lägg till klipp först.', true);
      const fd = new FormData(); let n = 0; const files = [];
      const addFile = (blob, name) => { files.push([blob, name]); return `file:${n++}`; };
      const spec = { lane: st.lane, ratio: T.ratio, clips: [], music: null };
      for (const c of T.clips) {
        const item = { kind: c.kind, start: +c.start || 0, end: +c.end || 0, duration: +c.duration || 3, text: c.text || '' };
        item.src = c.ref ? `ref:${c.ref}` : addFile(c.file, c.file.name);
        if (c.text && c.text.trim()) item.overlay = addFile(await overlayBlob(c.text.trim(), T.ratio), 'overlay.png');
        spec.clips.push(item);
      }
      if (T.music) spec.music = { volume: T.music.volume, src: T.music.ref ? `ref:${T.music.ref}` : addFile(T.music.file, T.music.name) };
      fd.append('spec', JSON.stringify(spec));
      files.forEach(([b, name]) => fd.append('files', b, name));
      say('Laddar upp för export…');
      const r = await fetch(`${API}/timeline`, { method: 'POST', body: fd });
      if (!r.ok) return say(await errMsg(r), true);
      const j = await r.json();
      try {
        const res = await poll(j.jobId, (m) => say(`Renderar · ${m}`));
        st.results.video.unshift(res); out.prepend(resultCard(res, 'video'));
        say(`Exporterad ${res.width}×${res.height}, ${res.duration.toFixed(1)} s. Uppladdade filer raderades från servern.`);
      } catch (e) { say(e.message, true); }
    }
    const prevBtn = h('button', { class: 'text', onclick: preview }, 'Förhandsvisa');
    v.append(
      h('div', { class: 'tl-top' }, seg(h('a', { href: '#/edit' }, 'Redigera'), h('span', { class: 'on', 'aria-current': 'page' }, 'Tidslinje')), field('Format', ratio)),
      pagehead('Tidslinje', 'Lägg ihop klipp, text och musik och exportera som mp4.'),
      fileIn, musicIn,
      h('div', { class: 'uploads' },
        h('div', { class: 'under' }, h('button', { class: 'text primary', onclick: () => fileIn.click() }, 'Lägg till videor / bilder'), h('button', { class: 'text', onclick: () => { pickBox.hidden = !pickBox.hidden; paintPick(); } }, 'Lägg till från sessionen')),
        pickBox, clipSources(), list, musicBox),
      finputsaLink(),
      stage,
      h('div', { class: 'actbar' }, prevBtn, h('button', { class: 'text primary', onclick: () => withBusy(status, () => exportMp4()).catch((e) => say(e.message, true)) }, 'Exportera mp4')),
      status, out);
    paintList(); paintMusic(); paintStage();
  }


  // ---- Script mode (storyboard): idea -> scene cards -> make scenes -> Edit timeline ----
  st.sc = st.sc || { scenes: [], song: null, section: null, ref: '', template: 'standard', seq: 0 };
  const BASE = API.replace(/\/api\/kino$/, '');
  const musicTabs = (on) => h('div', { class: 'tl-top' }, seg(on === 'mv' ? h('span', { class: 'on', 'aria-current': 'page' }, 'Musikvideo') : h('a', { href: '#/music' }, 'Musikvideo'), on === 'script' ? h('span', { class: 'on', 'aria-current': 'page' }, 'Manus') : h('a', { href: '#/script' }, 'Manus')));
  async function pollScript(id, onMsg) {
    for (;;) {
      await new Promise((r) => setTimeout(r, 2500));
      const j = await fetch(`${API}/script/jobs/${id}`).then((x) => x.json()).catch(() => null);
      if (!j) continue;
      if (j.status === 'done') return j.result;
      if (j.status === 'error') throw new Error(j.error);
      onMsg && onMsg(j.message);
    }
  }
  async function scriptView(v) {
    const S = st.sc;
    let making = false;
    const status = h('div', { class: 'status', role: 'status', 'aria-live': 'polite' });
    const say = (t, err) => { status.textContent = t || ''; status.classList.toggle('err', Boolean(err)); };
    const idea = h('textarea', { rows: 2, placeholder: 'Din idé, på svenska eller engelska' });
    idea.value = S.idea || ''; idea.oninput = () => { S.idea = idea.value; };
    // settings
    const tplSel = h('select'); const tpls = await fetch(`${API}/script/templates`).then((x) => x.json()).catch(() => ({ templates: [{ id: 'standard', sv: 'Standard' }] }));
    const EN = { standard: 'Standard', live: 'Livekonsert', cinematic: 'Filmisk', anime: 'Anime', vhs: 'Retro VHS / 80-tal', neon: 'Neon / Cyberpunk', dreamy: 'Drömsk', bw: 'Svartvitt', cover: 'Skivomslag' };
    tpls.templates.forEach((t) => tplSel.append(h('option', { value: t.id, selected: t.id === S.template }, EN[t.id] || t.sv)));
    tplSel.onchange = () => { S.template = tplSel.value; };
    const len = select([['15', '15 s'], ['30', '30 s'], ['45', '45 s'], ['60', '60 s']], String(S.seconds || 30)); len.onchange = () => { S.seconds = +len.value; };
    const count = select([['4', '4'], ['5', '5'], ['6', '6'], ['8', '8']], String(S.count || 6)); count.onchange = () => { S.count = +count.value; };
    const songName = h('input', { type: 'text', placeholder: 'valfritt, t.ex. artist – titel', value: S.songName || '' }); songName.oninput = () => { S.songName = songName.value; };
    const refIn = h('input', { type: 'file', accept: 'image/*', hidden: true });
    const refBox = h('div', { class: 'meta' });
    const paintRef = () => { refBox.innerHTML = ''; refBox.append(S.ref ? h('span', {}, `Karaktär: ${S.ref.slice(0, 140)}${S.ref.length > 140 ? '…' : ''}  `, h('button', { class: 'text dim', type: 'button', onclick: () => { S.ref = ''; paintRef(); } }, 'Ta bort')) : h('button', { class: 'text', type: 'button', onclick: () => refIn.click() }, 'Lägg till referensbild')); };
    refIn.onchange = async () => {
      const f = refIn.files[0]; refIn.value = ''; if (!f) return;
      refBox.textContent = 'Beskriver karaktären…';
      const fd = new FormData(); fd.append('lane', st.lane); fd.append('image', f);
      const r = await fetch(`${API}/script/reference`, { method: 'POST', body: fd }).catch(() => null);
      if (!r || !r.ok) { paintRef(); return say(r ? await errMsg(r) : 'Det gick inte att beskriva referensen.', true); }
      S.ref = (await r.json()).description; paintRef(); say('Referens tillagd: den skrivs in i varje scenprompt.');
    };
    paintRef();
    const laneSel = select([['image', 'Bild → stillbildsklipp'], ['video', 'AI-video'], ['stock', 'Stockmaterial']], S.make || 'image');
    const engSel = h('select');
    async function paintEngines() {
      engSel.innerHTML = '';
      if (laneSel.value === 'stock') { engSel.append(h('option', { value: 'stock' }, `Stock (${((await getConfig()).stock || {}).source || 'Wikimedia Commons'})`)); return; }
      const list = (await getEngines(st.lane)).filter((e) => e.kind === laneSel.value && !e.puter && !e.needsFirstFrame);
      if (!list.length) engSel.append(h('option', { value: '' }, laneSel.value === 'video' ? 'Ingen AI-videomotor är redo' : 'Ingen bildmotor är redo'));
      const pref = laneSel.value === 'image' ? (st.lane === 'nsfw' ? 'pony' : 'flux-klein') : null;
      list.sort((a, b) => (b.id === pref) - (a.id === pref)).forEach((e) => engSel.append(h('option', { value: e.id }, e.name)));
    }
    laneSel.onchange = () => { S.make = laneSel.value; paintEngines(); };
    paintEngines();
    const panel = h('div', { class: 'panel', hidden: true }, field('Mall', tplSel), field('Längd', len), field('Scener', count), field('Skapa scener med', laneSel), field('Motor', engSel), field('Låtnamn', songName), h('label', { class: 'wide' }, 'Referens (samma karaktär i varje scen)', refIn, refBox));
    // song + section picker
    const songIn = h('input', { type: 'file', accept: '.mp3,.wav,.m4a,audio/*', hidden: true });
    const songBox = h('div', { class: 'drop' });
    function paintSong() {
      songBox.innerHTML = ''; songBox.classList.remove('busy');
      if (!S.song) return songBox.append(h('div', { class: 'hintline' }, h('button', { class: 'text', onclick: () => songIn.click() }, 'Lägg till låt'), h('span', { class: 'meta' }, 'valfritt · mp3, wav, m4a · låttext behövs inte')));
      const want = S.seconds || 30; const d = S.song.duration;
      const cv = h('canvas', { class: 'wave', width: 600, height: 60 });
      const g = cv.getContext('2d');
      const draw = () => {
        g.clearRect(0, 0, 600, 60); const pk = S.song.peaks || [];
        const a = (S.section.start / d) * 600; const b = (Math.min(d, S.section.start + want) / d) * 600;
        g.fillStyle = 'rgba(255,59,48,.18)'; g.fillRect(a, 0, b - a, 60);
        pk.forEach((p, i) => { const x = (i / pk.length) * 600; g.fillStyle = x >= a && x <= b ? '#ff3b30' : '#444'; g.fillRect(x, 30 - p * 28, Math.max(1, 600 / pk.length - 1), p * 56); });
      };
      const range = h('input', { type: 'range', min: 0, max: Math.max(0, d - want), step: 0.1, value: S.section.start, class: 'secrange' });
      const lab = h('span', { class: 'meta' });
      const paintLab = () => { lab.textContent = `Avsnitt ${S.section.start.toFixed(1)}–${Math.min(d, S.section.start + want).toFixed(1)} s av ${d.toFixed(1)} s${Math.abs(S.section.start - S.song.suggested.start) < 0.05 ? ' · föreslagen refräng' : ''}${d < want ? ' · låten är kortare, den loopas' : ''}`; };
      range.oninput = () => { S.section.start = +range.value; S.section.cut = null; draw(); paintLab(); };
      cv.onclick = (e) => { const r = cv.getBoundingClientRect(); S.section.start = Math.max(0, Math.min(d - want, ((e.clientX - r.left) / r.width) * d - want / 2)); if (S.section.start < 0) S.section.start = 0; range.value = S.section.start; S.section.cut = null; draw(); paintLab(); };
      const au = h('audio', { src: abs(S.song.url), preload: 'none' });
      const playBtn = h('button', { class: 'text', onclick: () => { if (!au.paused) { au.pause(); playBtn.textContent = 'Spela avsnitt'; return; } au.currentTime = S.section.start; au.play(); playBtn.textContent = 'Stopp'; setTimeout(() => { au.pause(); playBtn.textContent = 'Spela avsnitt'; }, Math.min(want, d) * 1000); } }, 'Spela avsnitt');
      songBox.append(h('div', { class: 'hintline' }, h('b', {}, S.song.fileName), h('button', { class: 'text dim danger', onclick: () => { S.song = null; paintSong(); } }, 'Ta bort')), cv, range,
        h('div', { class: 'under' }, playBtn, h('button', { class: 'text dim', onclick: () => { S.section.start = S.song.suggested.start; S.section.cut = null; paintSong(); } }, 'Refräng'), lab), au);
      draw(); paintLab();
    }
    songIn.onchange = async () => {
      const f = songIn.files[0]; songIn.value = ''; if (!f) return;
      if (f.size > 20 * 1024 * 1024) return say('Låten får vara max 20 MB.', true);
      songBox.textContent = 'Hittar refrängen…'; songBox.classList.add('busy');
      const fd = new FormData(); fd.append('song', f); fd.append('seconds', String(S.seconds || 30));
      const r = await fetch(`${API}/script/song`, { method: 'POST', body: fd }).catch(() => null);
      if (!r || !r.ok) { S.song = null; paintSong(); return say(r ? await errMsg(r) : 'Uppladdningen misslyckades.', true); }
      const j = await r.json();
      S.song = { ...j, fileName: f.name }; S.section = { start: j.suggested.start, cut: null }; paintSong();
    };
    paintSong();
    // cards
    const cards = h('div', { class: 'sc-list' });
    const newScene = (s = {}) => ({ id: ++S.seq, duration: 5, prompt: '', keywords: [], camera: '', mood: '', text: '', result: null, msg: '', ...s });
    function paintCards() {
      cards.innerHTML = '';
      S.scenes.forEach((s, i) => {
        const inp = (val, ph, on, tag = 'input') => { const e = h(tag, tag === 'input' ? { type: 'text', placeholder: ph, value: val } : { rows: 3, placeholder: ph }); if (tag !== 'input') e.value = val; e.oninput = () => on(e.value); return e; };
        const dur = h('input', { type: 'number', min: 1, max: 15, step: 0.5, value: s.duration, inputmode: 'decimal' }); dur.onchange = () => { s.duration = +dur.value || 5; total.textContent = totalTxt(); };
        const media = !s.result && s.thumb ? h('img', { src: abs(s.thumb), title: 'Originalbild' }) : s.result ? (s.result.kind === 'image' ? h('img', { src: abs(s.result.url) }) : h('video', { src: abs(s.result.url), muted: true, playsinline: true, loop: true, autoplay: true })) : null;
        const msg = h('div', { class: 'meta sc-msg' + (s.err ? ' err' : '') }, s.msg || (s.result ? s.result.engineName : ''));
        const alt = h('div', { class: 'under sc-alt' });
        if (s.err && s.offer) {
          alt.append(h('button', { class: 'text', onclick: () => makeOne(s, 'stock').then(paintCards) }, 'Använd stock istället'));
          s.offer.forEach((e) => alt.append(h('button', { class: 'text', onclick: () => makeOne(s, e.kind, e.id).then(paintCards) }, `Prova ${e.name}`)));
        }
        cards.append(h('div', { class: 'sc-card' + (s.busy ? ' working' : '') + (s.err ? ' failed' : '') + (s.result ? ' done' : '') },
          h('div', { class: 'sc-head' }, h('b', {}, `Scen ${i + 1}`), h('label', { class: 'sc-dur' }, dur, ' s'), h('span', { class: 'sc-acts' },
            h('button', { class: 'text dim icon', title: 'Upp', 'aria-label': 'Upp', disabled: i === 0, onclick: () => { S.scenes.splice(i - 1, 0, S.scenes.splice(i, 1)[0]); paintCards(); } }, '↑'),
            h('button', { class: 'text dim icon', title: 'Ned', 'aria-label': 'Ned', disabled: i === S.scenes.length - 1, onclick: () => { S.scenes.splice(i + 1, 0, S.scenes.splice(i, 1)[0]); paintCards(); } }, '↓'),
            h('button', { class: 'text dim icon danger', title: 'Ta bort', 'aria-label': 'Ta bort', onclick: () => { S.scenes.splice(i, 1); paintCards(); } }, '✕'))),
          h('div', { class: 'sc-body' + (media ? ' has-media' : '') },
            media ? h('div', { class: 'sc-media' }, media) : null,
            h('div', { class: 'sc-fields' },
              inp(s.prompt, 'Bildprompt (engelska)', (x) => { s.prompt = x; }, 'textarea'),
              h('div', { class: 'sc-row' }, inp(s.keywords.join(', '), 'Stock-sökord', (x) => { s.keywords = x.split(',').map((k) => k.trim()).filter(Boolean); }), inp([s.camera, s.mood].filter(Boolean).join(' · '), 'Kamera · stämning', (x) => { const [c, m] = x.split('·'); s.camera = (c || '').trim(); s.mood = (m || '').trim(); })),
              s.people && s.people.length ? h('div', { class: 'meta' }, `Huvudpersoner: ${s.people.map((x) => 'Person ' + x).join(', ')}${s.start != null ? ` · original ${s.start}–${s.end} s` : ''}`) : null,
              inp(s.text, 'Text i bild (valfritt)', (x) => { s.text = x; }))),
          msg, alt));
      });
      if (!S.scenes.length) cards.append(empty('Inga scener än.', 'Skriv en idé ovan, eller använd Analysera video.'));
      const made = S.scenes.filter((x) => x.result).length;
      prog.hidden = !made; prog.firstChild.style.setProperty('--w', `${S.scenes.length ? (made / S.scenes.length) * 100 : 0}%`); prog.lastChild.textContent = `${made}/${S.scenes.length} klara`;
      total.textContent = totalTxt();
      makeBtn.disabled = !S.scenes.length || making; tlBtn.hidden = !S.scenes.some((s) => s.result);
    }
    const totalTxt = () => (S.scenes.length ? `${S.scenes.length} scener · ${S.scenes.reduce((a, s) => a + (+s.duration || 0), 0).toFixed(1)} s` : '');
    const total = h('span', { class: 'meta' });
    const prog = h('div', { class: 'sc-prog', hidden: true }, h('i'), h('span', { class: 'meta' }));
    const fullPrompt = (s) => {
      let p = s.prompt;
      (S.people || []).forEach((x) => { p = p.replace(new RegExp(`\\bPerson ${x.id}\\b`, 'g'), x.look ? `(${x.look})` : 'a person'); });
      if (S.ref && !p.includes(S.ref.slice(0, 30))) p = `${p}. Main character: ${S.ref}`;
      if (S.style && !p.includes(S.style.slice(0, 30))) p = `${p}. Style: ${S.style}`;
      return p;
    };
    // Huvudpersoner (from Analysera video): editable person descriptions referenced as "Person A" in prompts
    const peopleBox = h('div', { class: 'sc-people' });
    function paintPeople() {
      peopleBox.innerHTML = '';
      if (!(S.people && S.people.length) && !S.style) return;
      peopleBox.append(h('b', {}, 'Huvudpersoner'), h('div', { class: 'meta' }, 'Byt eller ändra en karaktär här; varje scen som nämner ”Person A” använder den.'));
      (S.people || []).forEach((x) => { const t = h('textarea', { rows: 2 }); t.value = x.look; t.oninput = () => { x.look = t.value; }; peopleBox.append(h('label', { class: 'wide' }, `Person ${x.id}`, t)); });
      const sty = h('textarea', { rows: 2, placeholder: 'Global stilprompt' }); sty.value = S.style || ''; sty.oninput = () => { S.style = sty.value; };
      peopleBox.append(h('label', { class: 'wide' }, 'Global stil', sty));
    }
    const vidIn = h('input', { type: 'file', accept: 'video/*', hidden: true });
    const keepAudio = h('input', { type: 'checkbox', checked: true });
    vidIn.onchange = () => withBusy(status, async () => {
      const f = vidIn.files[0]; vidIn.value = ''; if (!f) return;
      if (f.size > 80 * 1024 * 1024) return say('Videon får vara max 80 MB.', true);
      say('Laddar upp video…');
      const fd = new FormData(); fd.append('lane', st.lane); fd.append('keepAudio', keepAudio.checked ? '1' : '0'); fd.append('video', f);
      const r = await fetch(`${API}/script/analyze`, { method: 'POST', body: fd }).catch(() => null);
      if (!r || !r.ok) return say(r ? await errMsg(r) : 'Uppladdningen misslyckades.', true);
      try {
        const out = await pollScript((await r.json()).jobId, (m) => say(m));
        S.scenes = out.scenes.map((x) => newScene(x)); S.title = out.title; S.people = out.people || []; S.style = out.style || '';
        if (out.song) { S.song = { ...out.song, fileName: `${f.name} (audio)` }; S.section = { start: 0, cut: null }; S.seconds = Math.round(out.seconds); }
        paintPeople(); paintSong(); paintCards();
        say(`${out.scenes.length} scener analyserade av ${out.model}. ${out.note || ''} Ändra Huvudpersoner och korten och tryck sedan Skapa scener.`);
      } catch (e) { say(e.message, true); }
    });
    // honest per-scene generation: a busy/failed engine is reported on the card with alternatives; never silently swapped
    async function makeOne(s, kind, engine) {
      s.err = false; s.offer = null; s.msg = 'Jobbar…'; s.busy = true; paintCards();
      const prompt = fullPrompt(s);
      try {
        if (kind !== 'stock') {
          const chk = await fetch(`${API}/check`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: prompt + ' ' + (s.text || '') }) }).catch(() => null);
          if (!chk || !chk.ok) throw Object.assign(new Error(chk && chk.status === 422 ? REFUSE : 'Säkerhetskontrollen är inte tillgänglig, så scenen gjordes inte.'), { final: true });
        }
        if (kind === 'stock') {
          if (st.lane !== 'sfw') throw Object.assign(new Error('Stockmaterial finns bara i SFW-läget.'), { final: true });
          const r = await fetch(`${API}/script/stock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keywords: s.keywords.length ? s.keywords : [s.prompt.split(',')[0].slice(0, 40)], seconds: s.duration }) });
          if (!r.ok) throw new Error(await errMsg(r));
          const j = await r.json(); s.result = { kind: 'video', name: j.name, url: j.url, duration: j.duration, engineName: `${j.engineName}: ${j.credit.title} by ${j.credit.by}` };
        } else if (kind === 'image') {
          if (!engine) throw new Error('Ingen bildmotor är redo just nu.');
          const r = await fetch(`${API}/image`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lane: st.lane, engine, prompt, ratio: '9:16', count: 1 }) });
          let j = await r.json().catch(() => ({}));
          if (!r.ok) throw Object.assign(new Error(j.message || `Error ${r.status}`), { busy: j.busy, final: j.refused });
          if (j.async) j = await poll(j.jobId, (m) => { s.msg = m; const n = cards.children[S.scenes.indexOf(s)]; if (n) n.querySelector('.sc-msg').textContent = m; });
          const im = j.images[0]; s.result = { kind: 'image', name: im.name, url: im.url, engineName: `${im.engineName || j.engineName} → stillbildsklipp` };
        } else {
          if (!engine) throw new Error('Ingen AI-videomotor är redo just nu.');
          const fd = new FormData(); fd.append('lane', st.lane); fd.append('engine', engine); fd.append('prompt', prompt); fd.append('seconds', String(Math.ceil(s.duration))); fd.append('ratio', '9:16');
          const r = await fetch(`${API}/video`, { method: 'POST', body: fd });
          if (!r.ok) throw new Error(await errMsg(r));
          const out = await poll((await r.json()).jobId, (m) => { s.msg = m; const n = cards.children[S.scenes.indexOf(s)]; if (n) n.querySelector('.sc-msg').textContent = m; });
          s.result = { kind: 'video', name: out.name, url: out.url, duration: out.duration, engineName: out.engineName };
        }
        s.msg = s.result.engineName; s.busy = false;
      } catch (e) {
        s.busy = false; s.err = true; s.msg = e.message;
        if (!e.final) {
          const others = (await getEngines(st.lane, true)).filter((x) => (x.kind === 'image' || x.kind === 'video') && !x.puter && !x.needsFirstFrame && x.id !== engine).slice(0, 2);
          s.offer = st.lane === 'sfw' || others.length ? others : null;
          if (st.lane !== 'sfw' && s.offer) s.offer = others; // stock button only meaningful in SFW
        }
      }
    }
    async function writeScript() {
      if (!idea.value.trim()) return say('Skriv en idé.', true);
      say('Skriver manus…');
      const r = await fetch(`${API}/script`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idea: idea.value, song: S.songName || (S.song && S.song.fileName) || '', template: tplSel.value, seconds: +len.value, scenes: +count.value, reference: S.ref, lane: st.lane }) });
      if (!r.ok) return say(await errMsg(r), true);
      try {
        const out = await pollScript((await r.json()).jobId, (m) => say(m));
        S.scenes = out.scenes.map((x) => newScene(x)); S.title = out.title;
        paintCards(); say(out.note || `Manus ”${out.title}” av ${out.model || out.via}. Ändra, flytta eller ta bort scener och tryck sedan Skapa scener.`);
      } catch (e) { say(e.message, true); }
    }
    async function makeAll() {
      const kind = laneSel.value; const engine = engSel.value;
      making = true; makeBtn.disabled = true;
      try {
        const todo = S.scenes.filter((x) => !x.result); let n = 0;
        for (const s of S.scenes) { if (s.result) continue; say(`Gör scen ${S.scenes.indexOf(s) + 1} (${++n} av ${todo.length})…`); await makeOne(s, kind, engine); paintCards(); }
      } finally { making = false; makeBtn.disabled = !S.scenes.length; }
      const bad = S.scenes.filter((s) => !s.result).length;
      if (bad) return say(`${bad} scen(er) gjordes inte: se korten för alternativ.`, true);
      await toTimeline(false);
    }
    async function toTimeline(open = true) {
      const T = st.tl; T.ratio = '9:16'; T.clips = [];
      for (const s of S.scenes.filter((x) => x.result)) {
        const r = s.result;
        await addClip(r.kind === 'image' ? { kind: 'image', ref: r.name, url: abs(r.url), label: r.engineName, duration: +s.duration, text: s.text || '' } : { kind: 'video', ref: r.name, url: abs(r.url), label: r.engineName, text: s.text || '' });
        const c = T.clips[T.clips.length - 1]; if (c.kind === 'video') c.end = Math.min(c.end || s.duration, +s.duration);
      }
      if (S.song) {
        const want = S.scenes.reduce((a, s) => a + (+s.duration || 0), 0);
        if (!S.section.cut) {
          say('Klipper låtavsnittet…');
          const r = await fetch(`${API}/script/song/cut`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: S.song.name, start: S.section.start, end: S.section.start + want }) });
          if (!r.ok) return say(await errMsg(r), true);
          S.section.cut = await r.json();
        }
        T.music = { ref: S.section.cut.name, url: abs(S.section.cut.url), name: `${S.song.fileName} (${S.section.start.toFixed(1)} s →)`, volume: 1 };
      }
      say('Scenerna ligger i tidslinjen under Redigera, i ordning och med låten. Öppna Redigera → Tidslinje för att exportera mp4.');
      tlBtn.hidden = false;
      if (open) location.hash = '#/timeline';
    }
    const makeBtn = h('button', { class: 'text primary', onclick: () => withBusy(status, makeAll).catch((e) => say(e.message, true)) }, 'Skapa scener');
    const tlBtn = h('button', { class: 'text', hidden: true, onclick: () => toTimeline(true).catch((e) => say(e.message, true)) }, 'Öppna i Redigera');
    const writeBtn = h('button', { class: 'go', title: 'Skriv manus', 'aria-label': 'Skriv manus', onclick: () => withBusy(status, writeScript).catch((e) => say(e.message, true)) }, '↑');
    v.append(musicTabs('script'), pagehead('Manus', 'Skriv en idé eller analysera en video, justera scenkorten och skapa scenerna.'), songIn, vidIn,
      h('div', { class: 'composer' }, h('div', { class: 'row' }, idea, writeBtn), h('div', { class: 'under' }, h('span', {}, 'Skriv manus'), h('button', { class: 'text', type: 'button', onclick: () => vidIn.click() }, 'Analysera video'), h('label', { class: 'meta' }, keepAudio, ' behåll ljudet som låt'), h('button', { class: 'text dim', type: 'button', onclick: () => { panel.hidden = !panel.hidden; } }, 'Inställningar')), panel),
      h('div', { class: 'uploads' }, songBox), peopleBox, status,
      h('div', { class: 'under sc-total' }, total, prog), cards,
      h('div', { class: 'actbar' }, h('button', { class: 'text dim', onclick: () => { S.scenes.push(newScene()); paintCards(); } }, 'Lägg till scen'), tlBtn, makeBtn));
    paintPeople(); paintCards();
    if (st.preset === 'analyze') say('Tryck på Analysera video och välj ett klipp (max 80 MB). Du får scenkort att ändra.');
    st.preset = null;
  }


  // ---- Klipp (Opus Clip-style): long video -> best short clips with captions ----
  st.kl = st.kl || { job: null, status: null, progress: 0, message: '', info: {}, result: null, error: null, refused: false, opts: { count: '4', length: 'auto', aspect: '9:16', crop: 'center', captions: true, lang: 'auto', hint: '', url: '' }, fileName: '' };
  const fmtBytes = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(n >= 10485760 ? 0 : 1)} MB` : `${Math.max(1, Math.round(n / 1024))} kB`);
  const fmtT = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  const KL_MAX_MB = 200; const KL_MAX_MIN = 30;
  const CROP_SV = { center: 'Mitten', left: 'Vänster', right: 'Höger', smart: 'Smart (följer rörelse)' };
  function uploadKlipp(fd, onPct) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest(); x.open('POST', `${API}/klipp`); x.responseType = 'json';
      x.upload.onprogress = (e) => { if (e.lengthComputable) onPct(e.loaded / e.total); };
      x.onload = () => { const j = x.response || {}; if (x.status >= 200 && x.status < 300 && j.jobId) resolve(j); else reject(new Error(j.message || (x.status === 413 ? `Filen är för stor. Max ${KL_MAX_MB} MB.` : `Uppladdningen misslyckades (${x.status}).`))); };
      x.onerror = () => reject(new Error('Ingen kontakt med servern. Kolla nätet och försök igen.'));
      x.ontimeout = () => reject(new Error('Uppladdningen tog för lång tid.'));
      x.timeout = 20 * 60000; x.send(fd);
    });
  }
  async function klippView(v) {
    const K = st.kl; const O = K.opts;
    const status = h('div', { class: 'status', role: 'status', 'aria-live': 'polite' });
    const say = (t, err, busy) => { status.textContent = t || ''; status.classList.toggle('err', Boolean(err)); status.classList.toggle('busy', Boolean(busy)); status.hidden = !t; };
    say('');
    const fileIn = h('input', { type: 'file', accept: 'video/*,.mp4,.mov,.webm,.mkv,.m4v', 'aria-label': 'Välj video' });
    let file = null;
    const fileInfo = h('div', { class: 'meta kl-file' }, K.fileName ? `Senast: ${K.fileName}` : 'Ingen video vald än.');
    fileIn.onchange = () => {
      file = fileIn.files[0] || null;
      if (!file) { fileInfo.textContent = 'Ingen video vald än.'; return; }
      fileInfo.textContent = `${file.name} · ${fmtBytes(file.size)}`;
      if (file.size > KL_MAX_MB * 1048576) { fileInfo.textContent += ` – för stor, max ${KL_MAX_MB} MB.`; fileInfo.classList.add('err'); } else fileInfo.classList.remove('err');
    };
    const url = h('input', { type: 'text', inputmode: 'url', placeholder: 'https://…/video.mp4', value: O.url || '', 'aria-label': 'Direktlänk till en videofil' }); url.oninput = () => { O.url = url.value; };
    const count = select([['3', '3 klipp'], ['4', '4 klipp'], ['5', '5 klipp'], ['6', '6 klipp']], O.count); count.onchange = () => { O.count = count.value; };
    const length = select([['auto', 'Auto, 15–60 s'], ['kort', 'Kort, 15–30 s'], ['mellan', 'Mellan, 30–45 s'], ['lang', 'Lång, 45–60 s']], O.length); length.onchange = () => { O.length = length.value; };
    const aspect = select([['9:16', '9:16 (stående)'], ['1:1', '1:1 (kvadrat)'], ['16:9', '16:9 (liggande)']], O.aspect); aspect.onchange = () => { O.aspect = aspect.value; };
    const crop = select(Object.entries(CROP_SV), O.crop); crop.onchange = () => { O.crop = crop.value; };
    const lang = select([['auto', 'Hitta språk själv'], ['sv', 'Svenska'], ['en', 'Engelska']], O.lang); lang.onchange = () => { O.lang = lang.value; };
    const caps = h('input', { type: 'checkbox', checked: O.captions }); caps.onchange = () => { O.captions = caps.checked; };
    const hint = h('input', { type: 'text', maxlength: 200, placeholder: 'valfritt, t.ex. tips om sömn', value: O.hint || '' }); hint.oninput = () => { O.hint = hint.value; };
    const go = h('button', { class: 'text primary lg', type: 'button' }, 'Skapa klipp');
    const bar = h('div', { class: 'kprog', hidden: true, role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' }, h('i'));
    const how = h('div', { class: 'khow', hidden: true });
    const out = h('div', { class: 'results kresults', 'data-empty': 'Dina klipp visas här.' });
    const setBar = (p) => { bar.hidden = p == null; if (p != null) { bar.firstChild.style.width = `${Math.round(p * 100)}%`; bar.setAttribute('aria-valuenow', String(Math.round(p * 100))); } };

    function paintHow(info) {
      how.innerHTML = '';
      const i = info || {}; const rows = [];
      if (i.transkribering) rows.push(['Transkribering', i.transkribering.text]);
      if (i.urval) rows.push(['Urval', i.urval.text]);
      if (i.safety) rows.push(['Säkerhet', i.safety]);
      if (i.note) rows.push(['Obs', i.note]);
      how.hidden = !rows.length;
      if (rows.length) how.append(h('b', {}, 'Så gjordes det'), ...rows.map(([k, t]) => h('div', {}, h('span', {}, k), t)));
    }
    function clipCard(c, idx) {
      const [aw, ah] = c.aspect.split(':').map(Number);
      const vid = h('video', { controls: true, playsinline: true, preload: 'none', poster: c.thumb ? abs(c.thumb) : null, src: abs(c.url), style: `aspect-ratio:${aw} / ${ah}` });
      const score = c.score == null ? h('span', { class: 'score none', title: 'Inget AI-betyg i det här läget' }, 'Betyg: –') : h('span', { class: 'score ' + (c.score >= 80 ? 'hi' : c.score >= 60 ? 'mid' : 'lo') }, h('b', {}, String(c.score)), '/100 viralitetsbetyg');
      const sel = select([['15', '15 s'], ['30', '30 s'], ['45', '45 s'], ['60', '60 s']], c.duration < 22 ? '15' : c.duration < 38 ? '30' : c.duration < 52 ? '45' : '60');
      const redo = h('button', { class: 'text', type: 'button' }, 'Skapa om');
      const note = h('div', { class: 'meta kl-note' });
      redo.onclick = async () => {
        redo.disabled = true; note.textContent = 'Klipper om…'; note.classList.remove('err');
        try {
          const r = await fetch(`${API}/klipp/recut`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobId: K.job, index: idx, seconds: +sel.value }) });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j.message || `Fel ${r.status}`);
          const res = await pollKlipp(j.jobId, (p, m) => { note.textContent = m || 'Klipper om…'; });
          const nc = res.clips[0]; K.result.clips[idx] = nc;
          const fresh = clipCard(nc, idx); card.replaceWith(fresh);
        } catch (e) { note.textContent = e.message; note.classList.add('err'); redo.disabled = false; }
      };
      const card = h('article', { class: 'card kcard' },
        h('div', { class: 'kv' }, vid),
        h('div', { class: 'kbody' },
          h('h3', {}, c.title || `Klipp ${idx + 1}`),
          score,
          c.reason ? h('p', { class: 'kreason' }, c.reason) : null,
          c.hook ? h('p', { class: 'khook' }, h('span', {}, 'Hook'), `“${c.hook}”`) : null,
          h('div', { class: 'meta kl-tags' }, `${fmtT(c.start)}–${fmtT(c.end)} i originalet · ${Math.round(c.duration)} s · ${c.aspect} · ${fmtBytes(c.bytes)}`),
          h('div', { class: 'meta kl-tags' }, `Textremsor: ${c.captions}${c.captionNote ? ` – ${c.captionNote}` : ''}`),
          c.crop && c.crop.note ? h('div', { class: 'meta kl-tags' }, `Beskärning: ${CROP_SV[c.crop.mode] || c.crop.mode}. ${c.crop.note}`) : null),
        h('div', { class: 'acts' },
          h('a', { class: 'text primary', href: `${abs(c.url)}${c.url.includes('?') ? '&' : '?'}dl=1`, download: `klipp-${idx + 1}.mp4` }, 'Ladda ner'),
          sel, redo), note);
      return card;
    }
    function paintResult() {
      out.innerHTML = '';
      const R = K.result; if (!R) return;
      if (R.mode === 'icke-tal') out.append(h('div', { class: 'status kl-wide' }, 'Inget tal hittades eller kunde läsas, så klippen valdes efter ljudstyrka och scenbyten. Det är ingen AI-bedömning, och textremsor saknas.'));
      R.clips.forEach((c, i) => out.append(clipCard(c, i)));
      out.append(h('div', { class: 'meta kl-wide' }, `Klippen och originalet raderas från servern efter ca ${R.expiresInMin} minuter. Ladda ner det du vill ha.`));
      out.append(finputsaLink('kl-wide'));
    }
    async function pollKlipp(id, on) {
      for (let miss = 0; ;) {
        await new Promise((r) => setTimeout(r, 2500));
        const r = await fetch(`${API}/klipp/jobs/${id}`).catch(() => null);
        if (!r) { if (++miss > 20) throw new Error('Tappade kontakten med servern.'); continue; }
        if (r.status === 404) throw new Error('Jobbet finns inte längre (servern kan ha startat om, eller så har filerna raderats). Ladda upp videon igen.');
        const j = await r.json().catch(() => null); if (!j) continue; miss = 0;
        on && on(j.progress, j.message, j);
        if (j.status === 'done') return j.result;
        if (j.status === 'error') throw Object.assign(new Error(j.error || 'Något gick fel.'), { refused: j.refused, info: j.info });
      }
    }
    async function follow(id) {
      go.disabled = true; K.job = id; K.error = null;
      try {
        const res = await pollKlipp(id, (p, m, j) => { K.progress = p; K.message = m; K.info = j.info || {}; setBar(p); paintHow(K.info); say(`${m} (${Math.round(p * 100)} %)`, false, true); });
        K.result = res; K.status = 'done'; setBar(null); say('Klart! Spela upp, ladda ner eller skapa om med annan längd.'); paintResult();
      } catch (e) {
        K.status = 'error'; K.error = e.message; setBar(null); if (e.info) { K.info = e.info; paintHow(e.info); }
        say(e.message, true);
      } finally { go.disabled = false; K.following = false; }
    }
    go.onclick = async () => {
      if (K.following) return;
      const u = url.value.trim();
      if (!file && !u) return say('Välj en videofil, eller klistra in en direktlänk till en videofil.', true);
      if (file && file.size > KL_MAX_MB * 1048576) return say(`Filen är för stor. Max ${KL_MAX_MB} MB.`, true);
      if (minorText(hint.value)) return say(REFUSE, true);
      const fd = new FormData();
      if (file) fd.append('video', file); else fd.append('url', u);
      fd.append('lane', st.lane); fd.append('count', count.value); fd.append('length', length.value); fd.append('aspect', aspect.value); fd.append('crop', crop.value);
      fd.append('captions', caps.checked ? '1' : '0'); fd.append('lang', lang.value); fd.append('hint', hint.value.trim());
      K.following = true; K.result = null; K.info = {}; out.innerHTML = ''; paintHow(null); go.disabled = true; K.fileName = file ? file.name : u;
      try {
        say(file ? 'Laddar upp…' : 'Skickar länken…', false, true); setBar(0);
        const j = await uploadKlipp(fd, (p) => { setBar(p); say(`Laddar upp ${Math.round(p * 100)} %`, false, true); });
        setBar(0); await follow(j.jobId);
      } catch (e) { K.following = false; go.disabled = false; setBar(null); say(e.message, true); }
    };
    const panel = h('div', { class: 'panel kpanel' },
      field('Antal klipp', count), field('Längd', length), field('Bildformat', aspect), field('Beskärning', crop), field('Språk i videon', lang),
      h('label', { class: 'chk' }, h('span', {}, caps, 'Textremsor (ord för ord)')),
      h('label', { class: 'wide' }, 'Vad ska klippen handla om?', hint));
    v.append(
      pagehead('Klipp', 'Ladda upp en lång video. KINO lyssnar, väljer de bästa ögonblicken och gör korta, färdiga klipp med textremsor.'),
      h('div', { class: 'drop kdrop' },
        h('label', { class: 'kfile' }, h('span', {}, 'Välj video'), fileIn), fileInfo,
        h('label', { class: 'kurl' }, 'Eller en direktlänk till en videofil', url),
        h('div', { class: 'meta' }, `Max ${KL_MAX_MB} MB och ${KL_MAX_MIN} minuter. YouTube-länkar går inte: ladda upp filen i stället. Filer och klipp raderas efter ca en timme. KINO klipper bara din egen video och skapar inget nytt innehåll.`)),
      panel,
      h('div', { class: 'cta kcta' }, go),
      bar, status, how, out,
      h('p', { class: 'lanenote' + (st.lane === 'nsfw' ? ' nsfw' : '') }, st.lane === 'nsfw' ? 'NSFW-läge (21+): bilder i videon kontrolleras extra noga och minderåriga blockeras alltid. Går kontrollen inte att göra, avvisas videon.' : 'Minderåriga blockeras alltid, även i klippen. Transkribering och urval görs av AI-modeller på servern, och vilka som användes visas under varje körning.'));
    if (K.job && K.status === 'done' && K.result) { paintHow(K.info); paintResult(); say('Dina senaste klipp (raderas efter ca en timme).'); }
    else if (K.job && K.status === 'error' && K.error) say(K.error, true);
    else if (K.job && K.following) { go.disabled = true; follow(K.job); }
    if (K.job && K.status !== 'done' && K.status !== 'error' && !K.following) { K.following = true; follow(K.job); }
  }

  const VIEWS = { klipp: klippView, script: scriptView, '': home, image: imageView, video: videoView, music: musicView, edit: editView, timeline: timelineView };
  function route() {
    const k = (location.hash.replace(/^#\/?/, '').split('?')[0]) || '';
    document.querySelectorAll('nav a').forEach((a) => {
      const on = a.getAttribute('href') === `#/${k === 'timeline' ? 'edit' : k === 'script' ? 'music' : k}`;
      a.classList.toggle('on', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    const v = $('#view'); v.innerHTML = ''; window.scrollTo(0, 0);
    (VIEWS[k] || home)(v);
  }
  window.addEventListener('hashchange', route);
  paintLane(); route();
})();
