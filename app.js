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
  const abs = (u) => (/^(https?:|blob:|data:)/.test(u) ? u : API.replace(/\/api\/kino$/, '') + u);

  async function getEngines(lane, force) {
    const c = st.engines[lane];
    if (!force && c && Date.now() - c.at < 5 * 60000) return c.list;
    const r = await fetch(`${API}/engines?lane=${lane}`).then((x) => x.json()).catch(() => ({ engines: [] }));
    st.engines[lane] = { at: Date.now(), list: [...(r.engines || []), ...puterEngines(lane)] };
    return st.engines[lane].list;
  }
  async function getConfig() {
    if (!st.config) st.config = await fetch(`${API}/config`).then((x) => x.json()).catch(() => ({ grok: { available: false, message: 'Grok needs an API key' } }));
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
      const t = setTimeout(() => rej(new Error('Seedream is busy (Puter.js did not load).')), 20000);
      el.onload = () => { clearTimeout(t); window.puter ? res(window.puter) : rej(new Error('Seedream is busy (Puter.js did not load).')); };
      el.onerror = () => { clearTimeout(t); rej(new Error('Seedream is busy (Puter.js did not load).')); };
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
  const REFUSE = 'Refused: KINO never makes anything involving minors.';
  function puterError(e) {
    const o = e || {}; const msg = String((o.error && o.error.message) || o.message || o.code || o).toLowerCase(); const code = o.status || (o.error && o.error.status);
    if (code === 401 || /unauthori|sign.?in|log.?in|auth|popup|cancel|closed/.test(msg)) return 'Seedream needs Puter sign-in';
    if (code === 402 || code === 429 || /credit|fund|balance|quota|limit|insufficient|busy|rate|overload|unavailable/.test(msg)) return 'Seedream is busy';
    return `Seedream failed: ${msg.slice(0, 120)}`;
  }
  async function imgToBlob(img) {
    if (!img.complete || !img.naturalWidth) await new Promise((r, j) => { img.onload = r; img.onerror = () => j(new Error('Seedream returned an unreadable image')); });
    try { const r = await fetch(img.src); if (r.ok) return await r.blob(); } catch { /* canvas fallback */ }
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return new Promise((r, j) => c.toBlob((b) => (b ? r(b) : j(new Error('Could not read the Seedream image'))), 'image/jpeg', 0.92));
  }
  const blobB64 = (b) => new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]); fr.readAsDataURL(b); });
  const PUTER_RATIO = { '1:1': { w: 1, h: 1 }, '9:16': { w: 9, h: 16 }, '16:9': { w: 16, h: 9 }, '4:5': { w: 4, h: 5 } };
  /** Must be called from a tap/Enter handler: sign-in popup first (user gesture), then server text check, then Puter. */
  async function seedream({ engineId, prompt, ratio, ref }) {
    const m = PUTER_MODELS.find((x) => x.id === engineId);
    if (!m || st.lane !== 'sfw') throw new Error('Seedream is SFW only.');
    if (minorText(prompt)) throw new Error(REFUSE);
    let p;
    try {
      p = await loadPuter();
      if (p.auth && p.auth.isSignedIn && !p.auth.isSignedIn()) await p.auth.signIn();
    } catch (e) { throw new Error(e && /busy/.test(e.message || '') ? e.message : 'Seedream needs Puter sign-in'); }
    if (p.auth && p.auth.isSignedIn && !p.auth.isSignedIn()) throw new Error('Seedream needs Puter sign-in');
    const chk = await fetch(`${API}/check`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: prompt }) }).catch(() => null);
    if (!chk || !chk.ok) throw new Error(chk && chk.status === 422 ? REFUSE : 'Safety check unavailable, so Seedream was not run.');
    const opts = { model: m.model, ratio: PUTER_RATIO[ratio] || PUTER_RATIO['1:1'] };
    if (ref) Object.assign(opts, { input_image: await blobB64(ref), input_image_mime_type: ref.type || 'image/jpeg' });
    let img;
    try { img = await p.ai.txt2img(prompt.slice(0, 1800), opts); } catch (e) { throw new Error(puterError(e)); }
    if (!img || !img.src) throw new Error('Seedream is busy');
    const blob = await imgToBlob(img);
    const returned = (img.dataset && (img.dataset.model || img.dataset.modelName)) || img.model || null;
    const label = returned ? String(returned) : m.name;
    return { name: `seedream-${Date.now()}.jpg`, url: URL.createObjectURL(blob), blob, engine: m.id, engineName: `${label} (via Puter)` };
  }

  // ---- lane ----
  const laneBtn = $('#lane');
  function paintLane() { laneBtn.textContent = st.lane === 'nsfw' ? 'NSFW' : 'SFW'; laneBtn.classList.toggle('nsfw', st.lane === 'nsfw'); laneBtn.setAttribute('aria-label', `Lane: ${laneBtn.textContent}. Tap to switch`); }
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
      await new Promise((r) => setTimeout(r, 3000));
      const j = await fetch(`${API}/jobs/${id}`).then((x) => x.json()).catch(() => null);
      if (!j) continue;
      if (j.status === 'done') return j.result;
      if (j.status === 'error') throw Object.assign(new Error(j.error), { busy: j.busy });
      onMsg && onMsg(j.message);
    }
  }

  // ---- composer ----
  function composer({ kind, placeholder, engineKind, settings, onGo, extraTop, noEngineText }) {
    const ta = h('textarea', { rows: 2, placeholder });
    const go = h('button', { class: 'go', title: 'Generate', 'aria-label': 'Generate' }, '↑');
    const sel = h('select', { 'aria-label': 'Model' });
    const panel = h('div', { class: 'panel', hidden: true }, settings || []);
    const setBtn = h('button', { class: 'text dim', type: 'button', onclick: () => { panel.hidden = !panel.hidden; } }, 'Settings');
    const status = h('div', { class: 'status' });
    // optional Swedish/any-language prompt rewrite (GMV /api/prompt/enhance), minors check first
    const enhBtn = h('button', { class: 'text dim', type: 'button', onclick: async () => {
      const p0 = ta.value.trim(); if (!p0) return;
      if (minorText(p0)) { status.textContent = REFUSE; status.classList.add('err'); return; }
      enhBtn.disabled = true; status.classList.remove('err'); status.textContent = 'Enhancing prompt…';
      try {
        const r = await fetch(`${API.replace(/\/api\/kino$/, '')}/api/prompt/enhance`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: p0, aspectRatio: '9:16' }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.prompt) throw new Error(j.message || 'Enhance is busy right now.');
        ta.value = j.prompt; status.textContent = `Prompt enhanced by ${j.model}. Edit it or generate.`;
      } catch (e) { status.textContent = `Enhance failed: ${e.message}`.slice(0, 200); status.classList.add('err'); } finally { enhBtn.disabled = false; }
    } }, 'Enhance prompt');
    const box = h('div', {}, extraTop || null,
      h('div', { class: 'composer' }, h('div', { class: 'row' }, ta, go), h('div', { class: 'under' }, sel, settings ? setBtn : null, kind === 'image' || kind === 'video' ? enhBtn : null), panel), status);
    getEngines(st.lane).then((list) => {
      const ok = list.filter((e) => e.kind === engineKind);
      sel.innerHTML = '';
      ok.forEach((e) => sel.append(h('option', { value: e.id }, e.name)));
      if (!ok.length) { sel.append(h('option', { value: '' }, noEngineText || 'No model is responding right now')); sel.disabled = true; if (kind !== 'video' && kind !== 'music') go.disabled = true; }
      if (kind === 'edit' && !ok.length) say("Edit can't run right now.", true);
    });
    function say(t, err) { status.textContent = t || ''; status.classList.toggle('err', Boolean(err)); }
    async function fire() {
      if (go.disabled) return;
      go.disabled = true;
      try { await onGo({ prompt: ta.value.trim(), engine: sel.value, say }); } catch (e) { say(e.message, true); } finally { go.disabled = false; }
    }
    go.onclick = fire;
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); fire(); } });
    return { box, ta, sel, say };
  }
  const field = (label, input, wide) => h('label', { class: wide ? 'wide' : null }, label, input);
  const select = (opts, val) => { const s = h('select'); opts.forEach(([v, t]) => s.append(h('option', { value: v, selected: v === val }, t))); return s; };
  async function grokToggle() {
    const c = await getConfig();
    const cb = h('input', { type: 'checkbox', disabled: !c.grok.available });
    return { el: h('label', {}, 'Grok', h('span', {}, cb, ' ', c.grok.available ? 'off by default' : 'Grok needs an API key')), cb };
  }
  async function errMsg(r) { const j = await r.json().catch(() => ({})); return j.message || `Error ${r.status}`; }

  function resultCard(item, kind) {
    const media = kind === 'image' || kind === 'edit' ? h('img', { src: abs(item.url), alt: '' }) : h('video', { src: abs(item.url), controls: true, playsinline: true });
    const card = h('div', { class: 'card' }, media, h('div', { class: 'meta' }, item.engineName + (item.credits ? ` · song: ${item.credits.song} · images: ${item.credits.images}` : '')));
    const acts = h('div', { class: 'acts' }, h('a', { class: 'text', href: abs(item.url), download: item.name, target: '_blank' }, 'Download'));
    if (kind === 'image' || kind === 'edit') {
      acts.append(h('button', { class: 'text', onclick: () => { st.carry = { name: item.name, url: item.url, blob: item.blob }; location.hash = '#/video'; } }, 'Animate'));
      acts.append(h('button', { class: 'text', onclick: () => { st.carry = { name: item.name, url: item.url, blob: item.blob }; location.hash = '#/edit'; } }, 'Edit'));
    }
    acts.append(h('button', { class: 'text dim', onclick: () => { st.results[kind] = st.results[kind].filter((x) => x !== item); card.remove(); } }, 'Delete'));
    card.append(acts);
    // Coverr API terms: show a clickable Coverr credit when Coverr clips are used
    if (item.credits && item.credits.coverr) card.append(h('div', { class: 'meta' }, h('a', { href: item.credits.coverr.url || 'https://coverr.co', target: '_blank', rel: 'noopener' }, item.credits.coverr.text || 'Video från Coverr')));
    return card;
  }
  function results(kind) { const g = h('div', { class: 'results' }); st.results[kind].forEach((i) => g.append(resultCard(i, kind))); return g; }

  // ---- views ----
  async function home(v) {
    const b = (lane, t, s) => h('button', { class: 'choice' + (st.lane === lane ? ' on' : ''), onclick: () => setLane(lane) }, t, h('small', {}, s));
    const models = h('div', { class: 'models' }, 'Checking which models respond…');
    v.append(h('h1', {}, 'Image, video, music video.'), h('div', { class: 'choices' }, b('sfw', 'Normal / SFW', 'Everyday images, video and music video'), b('nsfw', 'Adult 21+ / NSFW', 'Consenting adults only')), models);
    const list = await getEngines(st.lane);
    const kinds = { image: 'Image', video: 'Video', edit: 'Edit', music: 'Song' };
    models.innerHTML = '';
    models.append(st.lane === 'nsfw' ? 'Responding now · NSFW' : 'Responding now · SFW');
    const ul = h('ul');
    list.forEach((e) => ul.append(h('li', {}, h('b', {}, e.name), `${kinds[e.kind] || e.kind}${e.puter ? ' · running via Puter' : ''}`)));
    if (!list.length) ul.append(h('li', {}, 'No model is responding right now.'));
    models.append(ul);
  }

  async function imageView(v) {
    const ratio = select([['1:1', '1:1'], ['9:16', '9:16'], ['16:9', '16:9'], ['4:5', '4:5']], '1:1');
    const res = select([['standard', 'Standard'], ['high', 'High']], 'standard');
    const count = select([['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']], '1');
    const lora = select([['auto', 'auto'], ['none', 'none'], ['photo', 'photo'], ['cinematic', 'cinematic']], 'auto');
    const grid = results('image');
    const c = composer({ kind: 'image', engineKind: 'image', placeholder: 'Describe an image', settings: [field('Ratio', ratio), field('Resolution', res), field('Count', count), field('LoRA', lora)],
      onGo: async ({ prompt, engine, say }) => {
        if (!prompt) return say('Write a prompt.', true);
        if (engine.startsWith('puter:')) {
          const n = Math.max(1, Math.min(4, +count.value || 1));
          for (let i = 0; i < n; i++) {
            say(i ? `Seedream ${i + 1}/${n}…` : 'Seedream (Puter)… first use asks you to sign in to Puter.');
            const item = await seedream({ engineId: engine, prompt, ratio: ratio.value });
            st.results.image.unshift(item); grid.prepend(resultCard(item, 'image'));
          }
          return say(`Made by ${st.results.image[0].engineName}.${lora.value === 'photo' || lora.value === 'cinematic' ? ' LoRA is not available for Seedream.' : ''}`);
        }
        say('Generating…');
        const r = await fetch(`${API}/image`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lane: st.lane, engine, prompt, ratio: ratio.value, resolution: res.value, count: count.value, lora: lora.value }) });
        if (!r.ok) return say(await errMsg(r), true);
        const j = await r.json();
        j.images.forEach((i) => { st.results.image.unshift(i); grid.prepend(resultCard(i, 'image')); });
        say(j.loraNote || `Made by ${j.engineName}.`);
      } });
    v.append(c.box, grid);
  }

  function fileField(label, accept, carry) {
    const inp = h('input', { type: 'file', accept });
    const wrap = h('label', {}, label, inp);
    const o = { el: wrap, inp, ref: carry && !carry.blob ? carry.name : null, blob: carry && carry.blob ? carry.blob : null };
    if (carry) {
      const t = h('div', { class: 'thumb' }, h('img', { src: abs(carry.url) }), h('button', { type: 'button', onclick: (e) => { e.preventDefault(); o.ref = null; o.blob = null; t.remove(); } }, '×'));
      wrap.append(t);
    }
    return o;
  }

  const CLIP_TOOLS = [['Google Vids', 'https://vids.google.com/'], ['Google Flow', 'https://labs.google/flow'], ['Dola', 'https://www.dola.com/'], ['Grok Imagine', 'https://grok.com/imagine'], ['Digen', 'https://digen.ai/create'], ['DreamFace', 'https://www.dreamfaceapp.com/tools/free-ai-video-generator'], ['Bing Video Creator', 'https://www.bing.com/images/create/ai-video-generator'], ['PixVerse', 'https://app.pixverse.ai/'], ['Kling', 'https://kling.ai/app/'], ['Vidu', 'https://www.vidu.com/'], ['Krea', 'https://www.krea.ai/video'], ['Meta AI (bild)', 'https://www.meta.ai/'], ['giz.ai', 'https://www.giz.ai/text-to-video/'], ['Hugging Face Wan 2.2', 'https://huggingface.co/spaces/zerogpu-aoti/wan2-2-fp8da-aoti-faster'], ['Coverr', 'https://coverr.co/'], ['Mixkit', 'https://mixkit.co/free-stock-video/'], ['ImagineArt', 'https://www.imagine.art/ai-video-generator'], ['fal H3', 'https://fal.ai/minimax-h3-max'], ['fal Wan 3', 'https://fal.ai/wan-video-free'], ['Pippit', 'https://www.pippit.ai/']];
  function clipSources() {
    const links = h('span', { class: 'src-links' });
    CLIP_TOOLS.forEach(([n, u]) => links.append(h('a', { class: 'text', href: u, target: '_blank', rel: 'noopener' }, n)));
    return h('div', { class: 'srcrow' }, h('span', {}, 'Get clips from'), links, h('div', { class: 'meta' }, 'Make clips there, download them, then upload them here.'));
  }
  async function videoView(v) {
    const carry = st.carry; st.carry = null;
    const first = fileField('First frame', 'image/*', carry);
    const last = fileField('Last frame', 'image/*');
    const len = select([['2', '2 s'], ['3', '3 s'], ['4', '4 s'], ['5', '5 s'], ['6', '6 s'], ['8', '8 s'], ['10', '10 s'], ['12', '12 s'], ['15', '15 s (Grok)'], ['30', '30 s (Grok)'], ['60', '1 min (Grok)'], ['120', '2 min (Grok)']], '4');
    const ratio = select([['16:9', '16:9'], ['9:16', '9:16'], ['1:1', '1:1']], '16:9');
    const g = await grokToggle();
    const grid = results('video');
    const c = composer({ kind: 'video', engineKind: 'video', placeholder: 'Describe a shot', settings: [first.el, last.el, field('Length', len), field('Ratio', ratio), g.el],
      onGo: async ({ prompt, engine, say }) => {
        if (!prompt) return say('Write a prompt.', true);
        if (!g.cb.checked && !engine) return say('No video model is responding right now.', true);
        const fd = new FormData();
        fd.append('lane', st.lane); fd.append('engine', engine); fd.append('prompt', prompt); fd.append('seconds', len.value); fd.append('ratio', ratio.value); fd.append('grok', g.cb.checked ? '1' : '0');
        if (first.inp.files[0]) fd.append('first', first.inp.files[0]); else if (first.blob) fd.append('first', first.blob, 'seedream.jpg'); else if (first.ref) fd.append('firstRef', first.ref);
        if (last.inp.files[0]) fd.append('last', last.inp.files[0]);
        say('Sending…');
        const r = await fetch(`${API}/video`, { method: 'POST', body: fd });
        if (!r.ok) return say(await errMsg(r), true);
        const j = await r.json();
        say(`${j.engineName} is working… video can take a few minutes.`);
        try {
          const out = await poll(j.jobId, (m) => say(m));
          st.results.video.unshift(out); grid.prepend(resultCard(out, 'video')); say(`Made by ${out.engineName}.`);
        } catch (e) { say(e.message, true); }
      } });
    v.append(clipSources(), c.box, grid);
  }

  async function musicView(v) {
    const songIn = h('input', { type: 'file', accept: '.mp3,.wav,.m4a,audio/mpeg,audio/wav,audio/x-m4a,audio/mp4', hidden: true });
    const imgIn = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
    let song = null; let imgs = [];
    const songBox = h('div');
    const thumbs = h('div', { class: 'thumbs' });
    function paintSong() {
      songBox.innerHTML = '';
      if (!song) return songBox.append(h('button', { class: 'text', onclick: () => songIn.click() }, 'Upload song'), h('span', { class: 'meta' }, '  mp3, wav, m4a · max 20 MB'));
      songBox.append(h('div', {}, song.name, '  ', h('button', { class: 'text dim', onclick: () => { song = null; paintSong(); } }, 'Remove song')), h('audio', { controls: true, src: URL.createObjectURL(song) }));
    }
    function paintImgs() {
      thumbs.innerHTML = '';
      imgs.forEach((f, i) => thumbs.append(h('div', { class: 'thumb' }, h('img', { src: URL.createObjectURL(f) }), h('button', { onclick: () => { imgs.splice(i, 1); paintImgs(); } }, '×'))));
    }
    songIn.onchange = () => { const f = songIn.files[0]; songIn.value = ''; if (!f) return; if (f.size > 20 * 1024 * 1024 || !/\.(mp3|wav|m4a)$/i.test(f.name)) return alert('Song must be mp3, wav or m4a, max 20 MB.'); song = f; paintSong(); };
    imgIn.onchange = () => { imgs = imgs.concat([...imgIn.files]).slice(0, 8); imgIn.value = ''; paintImgs(); };
    paintSong();
    const top = h('div', { class: 'uploads' }, songIn, imgIn, songBox, h('div', {}, h('button', { class: 'text', onclick: () => imgIn.click() }, 'Upload images'), h('span', { class: 'meta' }, '  up to 8'), thumbs));
    const cfg = await getConfig();
    const genre = select((cfg.genres || ['pop', 'r&b', 'rap', 'rock', 'hyperpop', 'ballad', 'rave', 'score']).map((x) => [x, x]), 'pop');
    const ratio = select([['9:16', '9:16'], ['16:9', '16:9'], ['1:1', '1:1']], '9:16');
    const len = select([['10', '10 s'], ['15', '15 s'], ['30', '30 s'], ['60', '60 s']], '15');
    const lyrics = h('textarea', { rows: 3 });
    const look = h('input', { type: 'text' });
    const action = h('input', { type: 'text' });
    const overlay = h('input', { type: 'text', placeholder: 'Stock mode: optional title text' });
    const g = await grokToggle();
    const motion = select([['none', 'none (cuts on the beat)'], ...(st.lane === 'sfw' && cfg.agnes && cfg.agnes.available ? [['agnes', 'Agnes Video (real motion, up to 30 s, ~1 clip/min)']] : []), ...(st.lane === 'sfw' ? [['stock', `Stock clips (${(cfg.stock && cfg.stock.source) || 'Wikimedia Commons'}) – real stock footage, not AI`]] : [])], 'none');
    // Stock source: 3-way toggle Riktiga / AI / Blanda (sent as source=real|ai|mix)
    let stockSrc = 'real';
    const srcBtns = [['real', 'Riktiga'], ['ai', 'AI'], ['mix', 'Blanda']].map(([v, t]) => h('button', { type: 'button', class: 'text', 'data-v': v, onclick: () => { stockSrc = v; paintSrc(); } }, t));
    const srcHint = h('span', { class: 'meta' });
    const paintSrc = () => {
      srcBtns.forEach((b) => { const on = b.getAttribute('data-v') === stockSrc; b.style.fontWeight = on ? '700' : '400'; b.style.textDecoration = on ? 'underline' : 'none'; b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
      srcHint.textContent = { real: '  riktiga stockklipp (ej AI)', ai: '  AI-genererade stockklipp från Pixabay', mix: '  både riktiga och AI-genererade' }[stockSrc];
    };
    const srcToggle = h('div', { role: 'group', 'aria-label': 'Stockkälla' }, ...srcBtns, srcHint);
    paintSrc();
    const grid = results('music');
    const c = composer({ kind: 'music', engineKind: 'image', placeholder: 'What is the video about?', noEngineText: 'No image model responding (needed without images)',
      settings: [field('Genre', genre), field('Ratio', ratio), field('Length', len), field('Look', look), field('Action', action), field('Motion', motion), field('Stockklipp', srcToggle), field('Text overlay', overlay), g.el, field('Lyrics', lyrics, true)],
      onGo: async ({ prompt, engine, say }) => {
        if (motion.value === 'stock') {
          if (!song) return say('Stock mode needs an uploaded song.', true);
          const sf = new FormData();
          sf.append('prompt', prompt); sf.append('text', overlay.value); sf.append('seconds', len.value === '60' ? '45' : len.value); sf.append('source', stockSrc); sf.append('song', song);
          say('Uploading…');
          const r0 = await fetch(`${API}/stock`, { method: 'POST', body: sf });
          if (!r0.ok) return say(await errMsg(r0), true);
          const j0 = await r0.json();
          try {
            const out = await poll(j0.jobId, (m) => say(m));
            const by = out.credits.footage.map((f) => f.by).join('; ');
            const lbl = out.source === 'ai' ? 'AI-generated stock clips (Pixabay)' : out.source === 'mix' ? (out.kind || 'stock clips, real + AI-generated') : 'real stock footage, not AI video';
            out.credits = { ...out.credits, images: `${lbl}: ${by}` };
            st.results.music.unshift(out); grid.prepend(resultCard(out, 'music'));
            say(`${out.engineName} · ${lbl} · Song: ${out.credits.song} · Footage: ${by}`);
          } catch (e) { say(e.message, true); }
          return;
        }
        if (!imgs.length && !engine) return say('Upload images: no image model is responding right now.', true);
        if (!imgs.length && engine.startsWith('puter:')) return say('Seedream runs in your browser and can’t make music-video stills. Pick another model or upload images.', true);
        const fd = new FormData();
        fd.append('lane', st.lane); fd.append('prompt', prompt); fd.append('genre', genre.value); fd.append('ratio', ratio.value); fd.append('seconds', len.value);
        fd.append('lyrics', lyrics.value); fd.append('look', look.value); fd.append('action', action.value); fd.append('grok', g.cb.checked ? '1' : '0'); fd.append('motion', motion.value); fd.append('imageEngine', engine.startsWith('puter:') ? '' : engine);
        if (song) fd.append('song', song);
        imgs.forEach((f) => fd.append('images', f));
        say('Uploading…');
        const r = await fetch(`${API}/music`, { method: 'POST', body: fd });
        if (!r.ok) return say(await errMsg(r), true);
        const j = await r.json();
        try {
          const out = await poll(j.jobId, (m) => say(m));
          st.results.music.unshift(out); grid.prepend(resultCard(out, 'music'));
          say(`Song: ${out.credits.song} · Images: ${out.credits.images} · Motion: ${out.credits.motion}`);
        } catch (e) { say(e.message, true); }
      } });
    v.append(musicTabs('mv'), top, c.box, grid);
  }

  async function editView(v) {
    const carry = st.carry; st.carry = null;
    const imgIn = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
    let files = []; let refs = carry ? [carry] : [];
    const thumbs = h('div', { class: 'thumbs' });
    function paint() {
      thumbs.innerHTML = '';
      refs.forEach((r, i) => thumbs.append(h('div', { class: 'thumb' }, h('img', { src: abs(r.url) }), h('button', { onclick: () => { refs.splice(i, 1); paint(); } }, '×'))));
      files.forEach((f, i) => thumbs.append(h('div', { class: 'thumb' }, h('img', { src: URL.createObjectURL(f) }), h('button', { onclick: () => { files.splice(i, 1); paint(); } }, '×'))));
    }
    imgIn.onchange = () => { files = files.concat([...imgIn.files]).slice(0, 8); imgIn.value = ''; paint(); };
    paint();
    const top = h('div', { class: 'uploads' }, imgIn, h('div', { class: 'under' }, h('b', {}, 'Edit'), h('a', { class: 'text dim', href: '#/timeline' }, 'Timeline')), h('div', {}, h('button', { class: 'text', onclick: () => imgIn.click() }, 'Add reference images'), thumbs));
    const grid = results('edit');
    const c = composer({ kind: 'edit', engineKind: 'edit', placeholder: 'What should change?', noEngineText: "Edit can't run right now.",
      onGo: async ({ prompt, engine, say }) => {
        if (!prompt) return say('Write a prompt.', true);
        if (!files.length && !refs.length) return say('Add a reference image.', true);
        if (engine.startsWith('puter:')) {
          const ref = files[0] || (refs[0] && (refs[0].blob || await fetch(abs(refs[0].url)).then((x) => x.blob())));
          say('Seedream (Puter)… first use asks you to sign in to Puter.');
          const item = await seedream({ engineId: engine, prompt, ratio: '1:1', ref });
          st.results.edit.unshift(item); grid.prepend(resultCard(item, 'edit'));
          return say(`Made by ${item.engineName}.${files.length + refs.length > 1 ? ' Seedream via Puter takes one reference; the first was used.' : ''}`);
        }
        const fd = new FormData();
        fd.append('lane', st.lane); fd.append('engine', engine); fd.append('prompt', prompt);
        files.forEach((f) => fd.append('images', f)); refs.forEach((r) => (r.blob ? fd.append('images', r.blob, 'seedream.jpg') : fd.append('refs', r.name)));
        say('Sending…');
        const r = await fetch(`${API}/edit`, { method: 'POST', body: fd });
        if (!r.ok) return say(await errMsg(r), true);
        const j = await r.json();
        try {
          const out = await poll(j.jobId, (m) => say(m));
          st.results.edit.unshift(out); grid.prepend(resultCard(out, 'edit')); say(out.note || `Made by ${out.engineName}.`);
        } catch (e) { say(e.message, true); }
      } });
    v.append(clipSources(), top, c.box, grid);
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
    const status = h('div', { class: 'status' });
    const say = (t, err) => { status.textContent = t || ''; status.classList.toggle('err', Boolean(err)); };
    const stage = h('div', { class: 'tl-stage' });
    const out = h('div', { class: 'results' });

    fileIn.onchange = async () => {
      for (const f of [...fileIn.files]) await addClip({ kind: f.type.startsWith('image') ? 'image' : 'video', file: f, url: URL.createObjectURL(f), label: f.name });
      fileIn.value = ''; paintList();
    };
    musicIn.onchange = () => { const f = musicIn.files[0]; musicIn.value = ''; if (f) { T.music = { file: f, url: URL.createObjectURL(f), name: f.name, volume: 1 }; paintMusic(); } };

    function paintPick() {
      pickBox.innerHTML = '';
      const items = sessionItems();
      if (!items.length) pickBox.append(h('div', { class: 'meta' }, 'Nothing made this session yet.'));
      items.forEach((it) => pickBox.append(h('button', { class: 'text', onclick: async () => { await addClip(it.blob ? { kind: it.kind, file: new File([it.blob], it.name, { type: it.blob.type || 'image/jpeg' }), url: it.url, label: it.label } : { kind: it.kind, ref: it.name, url: it.url, label: it.label }); paintList(); } }, `${it.kind === 'image' ? 'Image' : 'Video'} · ${it.label}`)));
    }
    function paintMusic() {
      musicBox.innerHTML = '';
      const songs = st.results.music;
      if (!T.music) {
        musicBox.append(h('button', { class: 'text', onclick: () => musicIn.click() }, 'Upload music'));
        songs.forEach((s) => musicBox.append(' ', h('button', { class: 'text dim', onclick: () => { T.music = { ref: s.name, url: abs(s.url), name: `KINO song (${s.credits ? s.credits.song : s.engineName})`, volume: 1 }; paintMusic(); } }, 'Use KINO song')));
        return;
      }
      const vol = h('input', { type: 'range', min: 0, max: 1.5, step: 0.05, value: T.music.volume });
      vol.oninput = () => { T.music.volume = +vol.value; };
      musicBox.append(h('div', {}, `Music: ${T.music.name}  `, h('button', { class: 'text dim', onclick: () => { T.music = null; paintMusic(); } }, 'Remove')), h('label', { class: 'tl-vol' }, 'Volume ', vol));
    }
    function num(val, on, step = 0.1) { const i = h('input', { type: 'number', step, min: 0, value: val, inputmode: 'decimal' }); i.onchange = () => on(+i.value); return i; }
    function paintList() {
      list.innerHTML = '';
      if (!T.clips.length) list.append(h('div', { class: 'meta' }, 'No clips yet.'));
      T.clips.forEach((c, idx) => {
        const handle = h('span', { class: 'tl-handle' }, 'Move');
        const txt = h('input', { type: 'text', placeholder: 'Text on clip', value: c.text });
        txt.oninput = () => { c.text = txt.value; };
        const fields = c.kind === 'image'
          ? [h('label', {}, 'Seconds', num(c.duration, (x) => { c.duration = x; }))]
          : [h('label', {}, 'Start', num(c.start, (x) => { c.start = x; })), h('label', {}, 'End', num(c.end, (x) => { c.end = x; }))];
        const thumb = c.kind === 'image' ? h('img', { src: c.url }) : h('video', { src: c.url, muted: true, playsinline: true, preload: 'metadata' });
        const row = h('div', { class: 'tl-row', 'data-id': c.id }, handle, h('div', { class: 'tl-thumb' }, thumb),
          h('div', { class: 'tl-fields' }, h('div', { class: 'meta' }, `${idx + 1}. ${c.label || c.kind}`), h('div', { class: 'tl-nums' }, ...fields), txt),
          h('button', { class: 'text dim', onclick: () => { T.clips = T.clips.filter((x) => x !== c); paintList(); } }, 'Remove'));
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
      if (!T.clips.length) return say('Add clips first.', true);
      let stopped = false; const audio = T.music ? new Audio(T.music.url) : null;
      playing = { stop: () => { stopped = true; if (audio) audio.pause(); stage.innerHTML = ''; playing = null; prevBtn.textContent = 'Preview'; } };
      prevBtn.textContent = 'Stop';
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
      if (!T.clips.length) return say('Add clips first.', true);
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
      say('Uploading for export…');
      const r = await fetch(`${API}/timeline`, { method: 'POST', body: fd });
      if (!r.ok) return say(await errMsg(r), true);
      const j = await r.json();
      try {
        const res = await poll(j.jobId, (m) => say(`Rendering · ${m}`));
        st.results.video.unshift(res); out.prepend(resultCard(res, 'video'));
        say(`Exported ${res.width}×${res.height}, ${res.duration.toFixed(1)} s. Uploaded files were deleted from the server.`);
      } catch (e) { say(e.message, true); }
    }
    const prevBtn = h('button', { class: 'text', onclick: preview }, 'Preview');
    v.append(
      clipSources(),
      h('div', { class: 'under tl-top' }, h('a', { class: 'text dim', href: '#/edit' }, 'Edit'), h('b', {}, 'Timeline'), field('Ratio', ratio)),
      fileIn, musicIn,
      h('div', { class: 'uploads' },
        h('div', {}, h('button', { class: 'text', onclick: () => { pickBox.hidden = !pickBox.hidden; paintPick(); } }, 'Add from this session'), '  ', h('button', { class: 'text', onclick: () => fileIn.click() }, 'Add videos / images')),
        pickBox, list, musicBox),
      stage,
      h('div', { class: 'under' }, prevBtn, h('button', { class: 'text', onclick: () => exportMp4().catch((e) => say(e.message, true)) }, 'Export mp4')),
      status, out);
    paintList(); paintMusic(); paintStage();
  }


  // ---- Script mode (storyboard): idea -> scene cards -> make scenes -> Edit timeline ----
  st.sc = st.sc || { scenes: [], song: null, section: null, ref: '', template: 'standard', seq: 0 };
  const BASE = API.replace(/\/api\/kino$/, '');
  const musicTabs = (on) => h('div', { class: 'under tl-top' }, on === 'mv' ? h('b', {}, 'Music video') : h('a', { class: 'text dim', href: '#/music' }, 'Music video'), on === 'script' ? h('b', {}, 'Script') : h('a', { class: 'text dim', href: '#/script' }, 'Script'));
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
    const status = h('div', { class: 'status' });
    const say = (t, err) => { status.textContent = t || ''; status.classList.toggle('err', Boolean(err)); };
    const idea = h('textarea', { rows: 2, placeholder: 'Your idea, in Swedish or English' });
    idea.value = S.idea || ''; idea.oninput = () => { S.idea = idea.value; };
    // settings
    const tplSel = h('select'); const tpls = await fetch(`${API}/script/templates`).then((x) => x.json()).catch(() => ({ templates: [{ id: 'standard', sv: 'Standard' }] }));
    const EN = { standard: 'Standard', live: 'Live concert', cinematic: 'Cinematic', anime: 'Anime', vhs: 'Retro VHS / 80s', neon: 'Neon / Cyberpunk', dreamy: 'Dreamy', bw: 'Black & white', cover: 'Album cover' };
    tpls.templates.forEach((t) => tplSel.append(h('option', { value: t.id, selected: t.id === S.template }, EN[t.id] || t.sv)));
    tplSel.onchange = () => { S.template = tplSel.value; };
    const len = select([['15', '15 s'], ['30', '30 s'], ['45', '45 s'], ['60', '60 s']], String(S.seconds || 30)); len.onchange = () => { S.seconds = +len.value; };
    const count = select([['4', '4'], ['5', '5'], ['6', '6'], ['8', '8']], String(S.count || 6)); count.onchange = () => { S.count = +count.value; };
    const songName = h('input', { type: 'text', placeholder: 'optional, e.g. artist – title', value: S.songName || '' }); songName.oninput = () => { S.songName = songName.value; };
    const refIn = h('input', { type: 'file', accept: 'image/*', hidden: true });
    const refBox = h('div', { class: 'meta' });
    const paintRef = () => { refBox.innerHTML = ''; refBox.append(S.ref ? h('span', {}, `Character: ${S.ref.slice(0, 140)}${S.ref.length > 140 ? '…' : ''}  `, h('button', { class: 'text dim', type: 'button', onclick: () => { S.ref = ''; paintRef(); } }, 'Remove')) : h('button', { class: 'text', type: 'button', onclick: () => refIn.click() }, 'Add reference image')); };
    refIn.onchange = async () => {
      const f = refIn.files[0]; refIn.value = ''; if (!f) return;
      refBox.textContent = 'Describing the character…';
      const fd = new FormData(); fd.append('lane', st.lane); fd.append('image', f);
      const r = await fetch(`${API}/script/reference`, { method: 'POST', body: fd }).catch(() => null);
      if (!r || !r.ok) { paintRef(); return say(r ? await errMsg(r) : 'Reference description failed.', true); }
      S.ref = (await r.json()).description; paintRef(); say('Reference added: it is written into every scene prompt.');
    };
    paintRef();
    const laneSel = select([['image', 'Image → still clip'], ['video', 'AI video'], ['stock', 'Stock footage']], S.make || 'image');
    const engSel = h('select');
    async function paintEngines() {
      engSel.innerHTML = '';
      if (laneSel.value === 'stock') { engSel.append(h('option', { value: 'stock' }, `Stock (${((await getConfig()).stock || {}).source || 'Wikimedia Commons'})`)); return; }
      const list = (await getEngines(st.lane)).filter((e) => e.kind === laneSel.value && !e.puter && !e.needsFirstFrame);
      if (!list.length) engSel.append(h('option', { value: '' }, laneSel.value === 'video' ? 'No AI video engine is ready' : 'No image engine is ready'));
      const pref = laneSel.value === 'image' ? (st.lane === 'nsfw' ? 'pony' : 'flux-klein') : null;
      list.sort((a, b) => (b.id === pref) - (a.id === pref)).forEach((e) => engSel.append(h('option', { value: e.id }, e.name)));
    }
    laneSel.onchange = () => { S.make = laneSel.value; paintEngines(); };
    paintEngines();
    const panel = h('div', { class: 'panel', hidden: true }, field('Template', tplSel), field('Length', len), field('Scenes', count), field('Make scenes with', laneSel), field('Engine', engSel), field('Song name', songName), h('label', { class: 'wide' }, 'Reference (same character in every scene)', refIn, refBox));
    // song + section picker
    const songIn = h('input', { type: 'file', accept: '.mp3,.wav,.m4a,audio/*', hidden: true });
    const songBox = h('div');
    function paintSong() {
      songBox.innerHTML = '';
      if (!S.song) return songBox.append(h('button', { class: 'text', onclick: () => songIn.click() }, 'Add song'), h('span', { class: 'meta' }, '  optional · mp3, wav, m4a · lyrics not needed'));
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
      const paintLab = () => { lab.textContent = `Section ${S.section.start.toFixed(1)}–${Math.min(d, S.section.start + want).toFixed(1)} s of ${d.toFixed(1)} s${Math.abs(S.section.start - S.song.suggested.start) < 0.05 ? ' · suggested chorus' : ''}${d < want ? ' · song is shorter, it loops' : ''}`; };
      range.oninput = () => { S.section.start = +range.value; S.section.cut = null; draw(); paintLab(); };
      cv.onclick = (e) => { const r = cv.getBoundingClientRect(); S.section.start = Math.max(0, Math.min(d - want, ((e.clientX - r.left) / r.width) * d - want / 2)); if (S.section.start < 0) S.section.start = 0; range.value = S.section.start; S.section.cut = null; draw(); paintLab(); };
      const au = h('audio', { src: abs(S.song.url), preload: 'none' });
      const playBtn = h('button', { class: 'text', onclick: () => { if (!au.paused) { au.pause(); playBtn.textContent = 'Play section'; return; } au.currentTime = S.section.start; au.play(); playBtn.textContent = 'Stop'; setTimeout(() => { au.pause(); playBtn.textContent = 'Play section'; }, Math.min(want, d) * 1000); } }, 'Play section');
      songBox.append(h('div', {}, S.song.fileName, '  ', h('button', { class: 'text dim', onclick: () => { S.song = null; paintSong(); } }, 'Remove')), cv, range,
        h('div', { class: 'under' }, playBtn, h('button', { class: 'text dim', onclick: () => { S.section.start = S.song.suggested.start; S.section.cut = null; paintSong(); } }, 'Chorus'), lab), au);
      draw(); paintLab();
    }
    songIn.onchange = async () => {
      const f = songIn.files[0]; songIn.value = ''; if (!f) return;
      if (f.size > 20 * 1024 * 1024) return say('Song must be max 20 MB.', true);
      songBox.textContent = 'Finding the chorus…';
      const fd = new FormData(); fd.append('song', f); fd.append('seconds', String(S.seconds || 30));
      const r = await fetch(`${API}/script/song`, { method: 'POST', body: fd }).catch(() => null);
      if (!r || !r.ok) { S.song = null; paintSong(); return say(r ? await errMsg(r) : 'Upload failed.', true); }
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
        const media = !s.result && s.thumb ? h('img', { src: abs(s.thumb), title: 'Original frame' }) : s.result ? (s.result.kind === 'image' ? h('img', { src: abs(s.result.url) }) : h('video', { src: abs(s.result.url), muted: true, playsinline: true, loop: true, autoplay: true })) : null;
        const msg = h('div', { class: 'meta' + (s.err ? ' err' : '') }, s.msg || (s.result ? s.result.engineName : ''));
        const alt = h('div', { class: 'under sc-alt' });
        if (s.err && s.offer) {
          alt.append(h('button', { class: 'text', onclick: () => makeOne(s, 'stock').then(paintCards) }, 'Use stock instead'));
          s.offer.forEach((e) => alt.append(h('button', { class: 'text', onclick: () => makeOne(s, e.kind, e.id).then(paintCards) }, `Try ${e.name}`)));
        }
        cards.append(h('div', { class: 'sc-card' },
          h('div', { class: 'sc-head' }, h('b', {}, `Scene ${i + 1}`), h('label', {}, dur, ' s'), h('span', { class: 'sc-acts' },
            h('button', { class: 'text dim', disabled: i === 0, onclick: () => { S.scenes.splice(i - 1, 0, S.scenes.splice(i, 1)[0]); paintCards(); } }, 'Up'),
            h('button', { class: 'text dim', disabled: i === S.scenes.length - 1, onclick: () => { S.scenes.splice(i + 1, 0, S.scenes.splice(i, 1)[0]); paintCards(); } }, 'Down'),
            h('button', { class: 'text dim', onclick: () => { S.scenes.splice(i, 1); paintCards(); } }, 'Delete'))),
          media ? h('div', { class: 'sc-media' }, media) : null,
          inp(s.prompt, 'Visual prompt (English)', (x) => { s.prompt = x; }, 'textarea'),
          h('div', { class: 'sc-row' }, inp(s.keywords.join(', '), 'Stock keywords', (x) => { s.keywords = x.split(',').map((k) => k.trim()).filter(Boolean); }), inp([s.camera, s.mood].filter(Boolean).join(' · '), 'Camera · mood', (x) => { const [c, m] = x.split('·'); s.camera = (c || '').trim(); s.mood = (m || '').trim(); })),
          s.people && s.people.length ? h('div', { class: 'meta' }, `Huvudpersoner: ${s.people.map((x) => 'Person ' + x).join(', ')}${s.start != null ? ` · original ${s.start}–${s.end} s` : ''}`) : null,
          inp(s.text, 'On-screen text (optional)', (x) => { s.text = x; }),
          msg, alt));
      });
      total.textContent = totalTxt();
      makeBtn.disabled = !S.scenes.length; tlBtn.hidden = !S.scenes.some((s) => s.result);
    }
    const totalTxt = () => (S.scenes.length ? `${S.scenes.length} scenes · ${S.scenes.reduce((a, s) => a + (+s.duration || 0), 0).toFixed(1)} s` : '');
    const total = h('span', { class: 'meta' });
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
      peopleBox.append(h('b', {}, 'Huvudpersoner'), h('div', { class: 'meta' }, 'Swap or edit a character here; every scene that says “Person A” uses it.'));
      (S.people || []).forEach((x) => { const t = h('textarea', { rows: 2 }); t.value = x.look; t.oninput = () => { x.look = t.value; }; peopleBox.append(h('label', { class: 'wide' }, `Person ${x.id}`, t)); });
      const sty = h('textarea', { rows: 2, placeholder: 'Global style prompt' }); sty.value = S.style || ''; sty.oninput = () => { S.style = sty.value; };
      peopleBox.append(h('label', { class: 'wide' }, 'Global style', sty));
    }
    const vidIn = h('input', { type: 'file', accept: 'video/*', hidden: true });
    const keepAudio = h('input', { type: 'checkbox', checked: true });
    vidIn.onchange = async () => {
      const f = vidIn.files[0]; vidIn.value = ''; if (!f) return;
      if (f.size > 80 * 1024 * 1024) return say('Video must be max 80 MB.', true);
      say('Uploading video…');
      const fd = new FormData(); fd.append('lane', st.lane); fd.append('keepAudio', keepAudio.checked ? '1' : '0'); fd.append('video', f);
      const r = await fetch(`${API}/script/analyze`, { method: 'POST', body: fd }).catch(() => null);
      if (!r || !r.ok) return say(r ? await errMsg(r) : 'Upload failed.', true);
      try {
        const out = await pollScript((await r.json()).jobId, (m) => say(m));
        S.scenes = out.scenes.map((x) => newScene(x)); S.title = out.title; S.people = out.people || []; S.style = out.style || '';
        if (out.song) { S.song = { ...out.song, fileName: `${f.name} (audio)` }; S.section = { start: 0, cut: null }; S.seconds = Math.round(out.seconds); }
        paintPeople(); paintSong(); paintCards();
        say(`${out.scenes.length} scenes analysed by ${out.model}. ${out.note || ''} Edit Huvudpersoner and the cards, then Make scenes.`);
      } catch (e) { say(e.message, true); }
    };
    // honest per-scene generation: a busy/failed engine is reported on the card with alternatives; never silently swapped
    async function makeOne(s, kind, engine) {
      s.err = false; s.offer = null; s.msg = 'Working…'; paintCards();
      const prompt = fullPrompt(s);
      try {
        if (kind !== 'stock') {
          const chk = await fetch(`${API}/check`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: prompt + ' ' + (s.text || '') }) }).catch(() => null);
          if (!chk || !chk.ok) throw Object.assign(new Error(chk && chk.status === 422 ? REFUSE : 'Safety check unavailable, so this scene was not made.'), { final: true });
        }
        if (kind === 'stock') {
          if (st.lane !== 'sfw') throw Object.assign(new Error('Stock footage is SFW lane only.'), { final: true });
          const r = await fetch(`${API}/script/stock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keywords: s.keywords.length ? s.keywords : [s.prompt.split(',')[0].slice(0, 40)], seconds: s.duration }) });
          if (!r.ok) throw new Error(await errMsg(r));
          const j = await r.json(); s.result = { kind: 'video', name: j.name, url: j.url, duration: j.duration, engineName: `${j.engineName}: ${j.credit.title} by ${j.credit.by}` };
        } else if (kind === 'image') {
          if (!engine) throw new Error('No image engine is ready right now.');
          const r = await fetch(`${API}/image`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lane: st.lane, engine, prompt, ratio: '9:16', count: 1 }) });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw Object.assign(new Error(j.message || `Error ${r.status}`), { busy: j.busy, final: j.refused });
          const im = j.images[0]; s.result = { kind: 'image', name: im.name, url: im.url, engineName: `${im.engineName || j.engineName} → still clip` };
        } else {
          if (!engine) throw new Error('No AI video engine is ready right now.');
          const fd = new FormData(); fd.append('lane', st.lane); fd.append('engine', engine); fd.append('prompt', prompt); fd.append('seconds', String(Math.ceil(s.duration))); fd.append('ratio', '9:16');
          const r = await fetch(`${API}/video`, { method: 'POST', body: fd });
          if (!r.ok) throw new Error(await errMsg(r));
          const out = await poll((await r.json()).jobId, (m) => { s.msg = m; const n = cards.children[S.scenes.indexOf(s)]; if (n) n.querySelector('.meta').textContent = m; });
          s.result = { kind: 'video', name: out.name, url: out.url, duration: out.duration, engineName: out.engineName };
        }
        s.msg = s.result.engineName;
      } catch (e) {
        s.err = true; s.msg = e.message;
        if (!e.final) {
          const others = (await getEngines(st.lane, true)).filter((x) => (x.kind === 'image' || x.kind === 'video') && !x.puter && !x.needsFirstFrame && x.id !== engine).slice(0, 2);
          s.offer = st.lane === 'sfw' || others.length ? others : null;
          if (st.lane !== 'sfw' && s.offer) s.offer = others; // stock button only meaningful in SFW
        }
      }
    }
    async function writeScript() {
      if (!idea.value.trim()) return say('Write an idea.', true);
      say('Writing script…');
      const r = await fetch(`${API}/script`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idea: idea.value, song: S.songName || (S.song && S.song.fileName) || '', template: tplSel.value, seconds: +len.value, scenes: +count.value, reference: S.ref, lane: st.lane }) });
      if (!r.ok) return say(await errMsg(r), true);
      try {
        const out = await pollScript((await r.json()).jobId, (m) => say(m));
        S.scenes = out.scenes.map((x) => newScene(x)); S.title = out.title;
        paintCards(); say(out.note || `Script “${out.title}” by ${out.model || out.via}. Edit, reorder or delete scenes, then Make scenes.`);
      } catch (e) { say(e.message, true); }
    }
    async function makeAll() {
      const kind = laneSel.value; const engine = engSel.value;
      for (const s of S.scenes) { if (s.result) continue; await makeOne(s, kind, engine); paintCards(); }
      const bad = S.scenes.filter((s) => !s.result).length;
      if (bad) return say(`${bad} scene(s) not made: see the cards for alternatives.`, true);
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
          say('Cutting the song section…');
          const r = await fetch(`${API}/script/song/cut`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: S.song.name, start: S.section.start, end: S.section.start + want }) });
          if (!r.ok) return say(await errMsg(r), true);
          S.section.cut = await r.json();
        }
        T.music = { ref: S.section.cut.name, url: abs(S.section.cut.url), name: `${S.song.fileName} (${S.section.start.toFixed(1)} s →)`, volume: 1 };
      }
      say('Scenes are in the Edit timeline, in order, with the song. Open Edit → Timeline to export mp4.');
      tlBtn.hidden = false;
      if (open) location.hash = '#/timeline';
    }
    const makeBtn = h('button', { class: 'text', onclick: () => makeAll().catch((e) => say(e.message, true)) }, 'Make scenes');
    const tlBtn = h('button', { class: 'text', hidden: true, onclick: () => toTimeline(true).catch((e) => say(e.message, true)) }, 'Open in Edit');
    const writeBtn = h('button', { class: 'go', title: 'Write script', 'aria-label': 'Write script', onclick: () => writeScript().catch((e) => say(e.message, true)) }, '↑');
    v.append(musicTabs('script'), songIn, vidIn,
      h('div', { class: 'composer' }, h('div', { class: 'row' }, idea, writeBtn), h('div', { class: 'under' }, h('span', {}, 'Write script'), h('button', { class: 'text', type: 'button', onclick: () => vidIn.click() }, 'Analysera video'), h('label', { class: 'meta' }, keepAudio, ' keep audio as song'), h('button', { class: 'text dim', type: 'button', onclick: () => { panel.hidden = !panel.hidden; } }, 'Settings')), panel),
      h('div', { class: 'uploads' }, songBox), peopleBox, status,
      h('div', { class: 'under' }, total), cards,
      h('div', { class: 'under' }, h('button', { class: 'text dim', onclick: () => { S.scenes.push(newScene()); paintCards(); } }, 'Add scene'), makeBtn, tlBtn));
    paintPeople(); paintCards();
  }

  const VIEWS = { script: scriptView, '': home, image: imageView, video: videoView, music: musicView, edit: editView, timeline: timelineView };
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
