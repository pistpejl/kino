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
  const abs = (u) => (/^https?:/.test(u) ? u : API.replace(/\/api\/kino$/, '') + u);

  async function getEngines(lane, force) {
    const c = st.engines[lane];
    if (!force && c && Date.now() - c.at < 5 * 60000) return c.list;
    const r = await fetch(`${API}/engines?lane=${lane}`).then((x) => x.json()).catch(() => ({ engines: [] }));
    st.engines[lane] = { at: Date.now(), list: r.engines || [] };
    return st.engines[lane].list;
  }
  async function getConfig() {
    if (!st.config) st.config = await fetch(`${API}/config`).then((x) => x.json()).catch(() => ({ grok: { available: false, message: 'Grok needs an API key' } }));
    return st.config;
  }

  // ---- lane ----
  const laneBtn = $('#lane');
  function paintLane() { laneBtn.textContent = st.lane === 'nsfw' ? 'NSFW' : 'SFW'; laneBtn.classList.toggle('nsfw', st.lane === 'nsfw'); }
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
    const box = h('div', {}, extraTop || null,
      h('div', { class: 'composer' }, h('div', { class: 'row' }, ta, go), h('div', { class: 'under' }, sel, settings ? setBtn : null), panel), status);
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
      acts.append(h('button', { class: 'text', onclick: () => { st.carry = { name: item.name, url: item.url }; location.hash = '#/video'; } }, 'Animate'));
      acts.append(h('button', { class: 'text', onclick: () => { st.carry = { name: item.name, url: item.url }; location.hash = '#/edit'; } }, 'Edit'));
    }
    acts.append(h('button', { class: 'text dim', onclick: () => { st.results[kind] = st.results[kind].filter((x) => x !== item); card.remove(); } }, 'Delete'));
    card.append(acts);
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
    list.forEach((e) => ul.append(h('li', {}, h('b', {}, e.name), kinds[e.kind] || e.kind)));
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
    const o = { el: wrap, inp, ref: carry ? carry.name : null };
    if (carry) {
      const t = h('div', { class: 'thumb' }, h('img', { src: abs(carry.url) }), h('button', { type: 'button', onclick: (e) => { e.preventDefault(); o.ref = null; t.remove(); } }, '×'));
      wrap.append(t);
    }
    return o;
  }

  async function videoView(v) {
    const carry = st.carry; st.carry = null;
    const first = fileField('First frame', 'image/*', carry);
    const last = fileField('Last frame', 'image/*');
    const len = select([['2', '2 s'], ['3', '3 s'], ['4', '4 s'], ['5', '5 s'], ['15', '15 s (Grok)'], ['30', '30 s (Grok)'], ['60', '1 min (Grok)'], ['120', '2 min (Grok)']], '4');
    const ratio = select([['16:9', '16:9'], ['9:16', '9:16'], ['1:1', '1:1']], '16:9');
    const g = await grokToggle();
    const grid = results('video');
    const c = composer({ kind: 'video', engineKind: 'video', placeholder: 'Describe a shot', settings: [first.el, last.el, field('Length', len), field('Ratio', ratio), g.el],
      onGo: async ({ prompt, engine, say }) => {
        if (!prompt) return say('Write a prompt.', true);
        if (!g.cb.checked && !engine) return say('No video model is responding right now.', true);
        const fd = new FormData();
        fd.append('lane', st.lane); fd.append('engine', engine); fd.append('prompt', prompt); fd.append('seconds', len.value); fd.append('ratio', ratio.value); fd.append('grok', g.cb.checked ? '1' : '0');
        if (first.inp.files[0]) fd.append('first', first.inp.files[0]); else if (first.ref) fd.append('firstRef', first.ref);
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
    v.append(c.box, grid);
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
    const g = await grokToggle();
    const grid = results('music');
    const c = composer({ kind: 'music', engineKind: 'image', placeholder: 'What is the video about?', noEngineText: 'No image model responding (needed without images)',
      settings: [field('Genre', genre), field('Ratio', ratio), field('Length', len), field('Look', look), field('Action', action), g.el, field('Lyrics', lyrics, true)],
      onGo: async ({ prompt, engine, say }) => {
        if (!imgs.length && !engine) return say('Upload images: no image model is responding right now.', true);
        const fd = new FormData();
        fd.append('lane', st.lane); fd.append('prompt', prompt); fd.append('genre', genre.value); fd.append('ratio', ratio.value); fd.append('seconds', len.value);
        fd.append('lyrics', lyrics.value); fd.append('look', look.value); fd.append('action', action.value); fd.append('grok', g.cb.checked ? '1' : '0'); fd.append('imageEngine', engine);
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
    v.append(top, c.box, grid);
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
    const top = h('div', { class: 'uploads' }, imgIn, h('div', {}, h('button', { class: 'text', onclick: () => imgIn.click() }, 'Add reference images'), thumbs));
    const grid = results('edit');
    const c = composer({ kind: 'edit', engineKind: 'edit', placeholder: 'What should change?', noEngineText: "Edit can't run right now.",
      onGo: async ({ prompt, engine, say }) => {
        if (!prompt) return say('Write a prompt.', true);
        if (!files.length && !refs.length) return say('Add a reference image.', true);
        const fd = new FormData();
        fd.append('lane', st.lane); fd.append('engine', engine); fd.append('prompt', prompt);
        files.forEach((f) => fd.append('images', f)); refs.forEach((r) => fd.append('refs', r.name));
        say('Sending…');
        const r = await fetch(`${API}/edit`, { method: 'POST', body: fd });
        if (!r.ok) return say(await errMsg(r), true);
        const j = await r.json();
        try {
          const out = await poll(j.jobId, (m) => say(m));
          st.results.edit.unshift(out); grid.prepend(resultCard(out, 'edit')); say(out.note || `Made by ${out.engineName}.`);
        } catch (e) { say(e.message, true); }
      } });
    v.append(top, c.box, grid);
  }

  const VIEWS = { '': home, image: imageView, video: videoView, music: musicView, edit: editView };
  function route() {
    const k = (location.hash.replace(/^#\/?/, '').split('?')[0]) || '';
    document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === `#/${k}`));
    const v = $('#view'); v.innerHTML = '';
    (VIEWS[k] || home)(v);
  }
  window.addEventListener('hashchange', route);
  paintLane(); route();
})();
