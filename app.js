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
    // ids per docs.puter.com/AI/txt2img (BytePlus): plain model id + provider hint; the old puter: ids stay as option values
    { id: 'puter:byteplus/seedream-4-5-251128', model: 'seedream-4-5-251128', provider: 'byteplus', name: 'Seedream 4.5' },
    { id: 'puter:byteplus/seedream-5-0-lite-260128', model: 'seedream-5-0-lite-260128', provider: 'byteplus', name: 'Seedream 5 Lite' },
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
  // Speglar server/kino/safety.js: bara sexualiserade minderåriga stoppas. HARD alltid; barn-/ungdomsord bara ihop med
  // sexuella ord eller i NSFW-läget. Icke-sexuell text med "barn", "ung", "teen", "tonåring" går igenom.
  const B = '(^|[^a-zåäöéü0-9])(', E = ')(?=$|[^a-zåäöéü0-9])';
  const CHILD_RE = new RegExp(B + 'child(ren|like)?|child-like|kids?|kiddie|minors?|under[\\s-]*age|pre[\\s-]*teen|tween|toddler|infant|little[\\s-]*(girl|boy)|young[\\s-]*(girl|boy)|school[\\s-]*(girl|boy)|young[\\s-]*looking|youthful[\\s-]*looking|looks[\\s-]*young|baby[\\s-]*face|elementary[\\s-]*school|middle[\\s-]*school|kindergarten|barn(et|en|slig|sliga|ansikte)?|småbarn|minderåriga?|omyndig|skolflick(a|or)|skolpojk(e|ar)|lågstadiet|mellanstadiet|förskola|dagis|ungt[\\s-]*utseende|ser[\\s-]*ung[\\s-]*ut|liten[\\s-]*(flicka|pojke|tjej|kille)|lilla[\\s-]*tjejen' + E, 'i');
  const YOUTH_RE = new RegExp(B + 'teens?|teenage(rs?)?|teenie|adolescent|young|youthful|flat[\\s-]*chested|high[\\s-]*school|highschool|school[\\s-]*uniform|(step)?daughter|stepson|tonåring(ar)?|tonårs(aktig)?|tonåren|ung|unga|ungdom(ar|lig)?|flick(a|an|or)|pojk(e|en|ar)|skoluniform|högstadiet|gymnasiet|gymnasietjej|elev|dotter|styvdotter' + E, 'i');
  const HARD_RE = new RegExp(B + 'loli(ta|con)?|shota(con)?|jailbait|barely[\\s-]*legal|pedo(phile)?|paedophile|pedofil|nymphet|cp' + E, 'i');
  const SEXUAL_RE = new RegExp(B + 'nsfw|nudes?|naked|nudity|porno?|pornographic|sex|sexy|sexual|sexuali[sz]ed|erotica?|explicit|lewd|fetish|seductive|topless|bottomless|lingerie|panties|undress(ed|ing)?|stripping|stripper|genitals?|nipples?|orgasm|masturbat(ing|ion)?|blowjob|hentai|onlyfans|horny|aroused|xxx|boudoir|naken|nakna|nakenhet|sexig|sexiga|sexuell|sexuella|erotisk|erotiska|porr|avklädd|klär[\\s-]*av[\\s-]*sig|strippar|kåt|onanerar|underkläder|trosor' + E, 'i');
  const ADULTQ_RE = /(^|[^a-zåäö0-9])(young|ung|unga)[\s-]+(adults?|wom[ae]n|m[ae]n|lady|mother|mom|vuxen|vuxna|kvinnor?|man|män|mamma)(?=$|[^a-zåäö0-9])/gi;
  const AGE_RE = /\b(\d{1,2})\s*(?:-|\s)?\s*(?:yo|y\/o|yrs?|years?(?:[\s-]*old)|år(?:ig|ing|s)?|åring)\b|\b(?:age|aged|ålder|åldern)\s*:?\s*(\d{1,2})\b/gi;
  function underAge(s) { let m; AGE_RE.lastIndex = 0; while ((m = AGE_RE.exec(s))) if (Number(m[1] || m[2]) < 18) return true; return false; }
  function minorSignal(s, youth = true) { return CHILD_RE.test(s) || underAge(s) || (youth && YOUTH_RE.test(s.replace(ADULTQ_RE, ' '))); }
  function minorText(t, lane) {
    const s = String(t || '').toLowerCase();
    if (HARD_RE.test(s)) return true;
    if (!((lane || st.lane) === 'nsfw' || SEXUAL_RE.test(s))) return false;
    return minorSignal(s);
  }
  const REFUSE = 'Nekad: KINO gör aldrig något som rör minderåriga.';
  function puterError(e) {
    const o = e || {}; const msg = String((o.error && o.error.message) || o.message || o.code || o).toLowerCase(); const code = o.status || (o.error && o.error.status);
    if (code === 401 || /unauthori|sign.?in|log.?in|auth|popup|cancel|closed/.test(msg)) return 'Seedream kräver inloggning hos Puter';
    if (code === 402 || code === 429 || /credit|fund|balance|quota|limit|insufficient|busy|rate|overload|unavailable/.test(msg)) return 'Seedream är upptaget';
    return `Seedream misslyckades: ${msg.slice(0, 120)}`;
  }
  // Never export a canvas here: Puter images are often cross-origin, so canvas.toBlob/toDataURL throws "Tainted canvases may not be exported".
  // fetch() works for data:, blob: and CORS-enabled https; otherwise return null and the caller shows the <img> src directly.
  // scroll so a status/error box sits above the fixed CTA bar + bottom nav
  function keepClear(el) {
    if (!el || !el.isConnected) return;
    const r = el.getBoundingClientRect(); const bar = document.querySelector('.ctabar');
    const fixed = bar && getComputedStyle(bar).position === 'fixed';
    const limit = (fixed ? bar.getBoundingClientRect().top : innerHeight) - 12;
    if (r.bottom > limit) window.scrollBy({ top: Math.min(r.bottom - limit, Math.max(0, r.top - 70)), behavior: 'smooth' });
  }
  async function imgToBlob(img) {
    const src = img && img.src; if (!src) return null;
    try { const r = await fetch(src); if (r.ok) return await r.blob(); } catch { /* CORS: show src directly */ }
    return null;
  }
  const blobB64 = (b) => new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]); fr.readAsDataURL(b); });
  const PUTER_RATIO = { '1:1': { w: 1, h: 1 }, '9:16': { w: 9, h: 16 }, '16:9': { w: 16, h: 9 }, '4:5': { w: 4, h: 5 } };
  /** Must be called from a tap/Enter handler: sign-in popup first (user gesture), then server text check, then Puter. */
  async function seedream({ engineId, prompt, ratio, ref, signal }) {
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
    const base = { ratio: PUTER_RATIO[ratio] || PUTER_RATIO['1:1'] };
    if (ref) Object.assign(base, { input_image: await blobB64(ref), input_image_mime_type: ref.type || 'image/jpeg' });
    let img; let label = m.name; let note = '';
    try { img = await abortable(p.ai.txt2img(prompt.slice(0, 1800), { ...base, model: m.model, provider: m.provider }), signal); if (!img || !img.src) throw new Error('Seedream är upptaget'); } catch (e) {
      if (e && e.cancelled) throw e;
      // reserv: FLUX via Puter (Cloudflare), sagt rakt ut i statusraden
      const why = e && e.message && /^Seedream/.test(e.message) ? e.message : puterError(e);
      try { img = await abortable(p.ai.txt2img(prompt.slice(0, 1800), { ...base, model: PUTER_FLUX.model, provider: PUTER_FLUX.provider }), signal); } catch (e2) { if (e2 && e2.cancelled) throw e2; throw new Error(`${why}. Reserven FLUX svarade inte heller – försök igen eller välj en annan modell.`); }
      if (!img || !img.src) throw new Error(`${why}. Reserven FLUX gav ingen bild.`);
      label = PUTER_FLUX.name; note = `${why} – bilden gjordes i stället med ${PUTER_FLUX.name}.`;
    }
    if (signal && signal.aborted) throw cancelledErr();
    const blob = await imgToBlob(img);
    const returned = (img.dataset && (img.dataset.model || img.dataset.modelName)) || null;
    if (returned && !note) label = String(returned);
    return { name: `seedream-${Date.now()}.jpg`, url: blob ? URL.createObjectURL(blob) : img.src, blob, engine: m.id, engineName: `${label} (via Puter)`, note: note + (blob ? '' : ' Bilden visas direkt från Puter; använd Ladda ned för att spara den.') };
  }
  const PUTER_FLUX = { model: '@cf/black-forest-labs/flux-1-schnell', provider: 'cloudflare', name: 'FLUX.1 schnell' };

  // ---- lane ----
  const laneBtn = $('#lane');
  function paintLane() {
    const n = st.lane === 'nsfw';
    laneBtn.classList.toggle('nsfw', n); laneBtn.setAttribute('aria-checked', n ? 'true' : 'false');
    laneBtn.setAttribute('aria-label', `Läge: ${n ? 'NSFW' : 'SFW'}. Tryck för att byta till ${n ? 'SFW' : 'NSFW'}`);
    paintPill();
  }
  // header status pill: "● Motor: Auto · SFW" -> Inställningar
  let gpuOn = false;
  function paintPill(on) {
    if (on != null) gpuOn = on;
    const p = $('#pill'); if (!p) return;
    p.classList.toggle('gpu', gpuOn); p.classList.toggle('nsfw', st.lane === 'nsfw');
    $('span', p).textContent = `Motor: ${gpuOn ? 'Egen GPU' : 'Auto'} · ${st.lane === 'nsfw' ? 'NSFW' : 'SFW'}`;
  }
  function setLane(l) {
    if (l === 'nsfw' && localStorage.getItem('kino.21') !== '1') {
      $('#gate').hidden = false;
      $('#gateYes').onclick = () => { localStorage.setItem('kino.21', '1'); $('#gate').hidden = true; setLane('nsfw'); };
      $('#gateNo').onclick = () => { $('#gate').hidden = true; };
      return;
    }
    st.lane = l; localStorage.setItem('kino.lane', l); paintLane(); libReady.then(route, route); document.dispatchEvent(new CustomEvent('kino-lane'));
  }
  laneBtn.onclick = () => setLane(st.lane === 'nsfw' ? 'sfw' : 'nsfw');

  // ---- avbryt: every running job registers here, so one job card or 'Stoppa alla jobb' can stop it ----
  const cancelledErr = () => Object.assign(new Error('Avbrutet.'), { cancelled: true });
  // Puter calls cannot be aborted on their side: race them against the signal and drop the late result
  const abortable = (pr, signal) => (!signal ? pr : new Promise((res, rej) => {
    if (signal.aborted) return rej(cancelledErr());
    const on = () => rej(cancelledErr()); signal.addEventListener('abort', on, { once: true });
    pr.then((v) => { signal.removeEventListener('abort', on); res(v); }, (e) => { signal.removeEventListener('abort', on); rej(e); });
  }));
  const RUNNING = new Set();
  function track(label, cancel) { const e = { label, cancel }; RUNNING.add(e); document.dispatchEvent(new CustomEvent('kino-jobs')); return () => { RUNNING.delete(e); document.dispatchEvent(new CustomEvent('kino-jobs')); }; }
  async function cancelAllJobs() {
    const list = [...RUNNING];
    await Promise.all(list.map((e) => Promise.resolve().then(e.cancel).catch(() => null)));
    // belt and braces: server-side stop-all on Render and on the own-GPU engine (if one is set up)
    await fetch(`${API}/jobs/cancel-all`, { method: 'POST' }).catch(() => null);
    const { url, token } = colabCfg(); if (url && token) await fetch(`${url}/cancel_all`, { method: 'POST', headers: colabHdr(), signal: AbortSignal.timeout(8000) }).catch(() => null);
    return list.length;
  }
  function stopAllButton() {
    const b = h('button', { class: 'text cancel stopall', type: 'button' });
    const paint = () => { b.textContent = RUNNING.size ? `Stoppa alla jobb (${RUNNING.size})` : 'Stoppa alla jobb'; };
    b.onclick = async () => { b.disabled = true; b.textContent = 'Stoppar…'; const n = await cancelAllJobs(); b.disabled = false; paint(); b.title = n ? `${n} jobb stoppade` : 'Inga jobb körs i den här fliken (motorerna fick ändå stoppsignalen)'; };
    document.addEventListener('kino-jobs', paint); paint(); return b;
  }

  // ---- jobs ----
  async function poll(id, onMsg, signal) {
    for (;;) {
      await new Promise((r) => setTimeout(r, 2500));
      if (signal && signal.aborted) throw cancelledErr();
      const j = await fetch(`${API}/jobs/${id}`).then((x) => x.json()).catch(() => null);
      if (!j) continue;
      if (j.status === 'done') return j.result;
      if (j.status === 'cancelled') throw Object.assign(new Error(j.error || 'Avbruten.'), { cancelled: true });
      if (j.status === 'error') throw Object.assign(new Error(j.error), { busy: j.busy, quota: j.quota, refused: j.refused });
      onMsg && onMsg(j.message);
    }
  }

  // ---- composer ----
  // plain engine names: "Snabb" / "Bästa kvalitet"; the real model name stays visible in the option and in a details line
  const plainName = (e) => (e.async || (e.tags || []).some((t) => /kö/i.test(t)) ? 'Bästa kvalitet' : 'Snabb');
  const CTA = { image: 'Skapa bild', video: 'Skapa video', music: 'Skapa musikvideo', edit: 'Redigera bild' };
  const ETA = { image: 'brukar ta 10 s – 2 min', video: 'brukar ta 1–10 min', music: 'brukar ta 1–5 min', edit: 'brukar ta 20 s – 2 min' };
  const fmtClock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  function composer({ kind, placeholder, engineKind, settings, onGo, extraTop, noEngineText, ctaText }) {
    const ta = h('textarea', { rows: 2, placeholder });
    const go = h('button', { class: 'go', title: 'Skapa', 'aria-label': 'Skapa' }, '↑');
    const cta = h('button', { class: 'text primary cta-main', type: 'button' }, ctaText || CTA[kind] || 'Skapa');
    const engDetail = h('div', { class: 'meta engdetail' });
    const job = h('div', { class: 'jobcard', hidden: true }, h('div', { class: 'jobtop' }, h('b', {}, 'Jobbar…'), h('span', { class: 'jobtime meta' })), h('div', { class: 'jobbar' }, h('i')));
    let jobTimer = null;
    const sel = h('select', { 'aria-label': 'Modell' });
    const panel = h('div', { class: 'panel', hidden: true }, settings || []);
    const setBtn = h('button', { class: 'text dim', type: 'button', onclick: () => { panel.hidden = !panel.hidden; } }, 'Inställningar');
    const status = h('div', { class: 'status', role: 'status', 'aria-live': 'polite' });
    const cancelBtn = h('button', { class: 'text cancel', type: 'button', hidden: true }, 'Avbryt');
    const hint = h('div', { class: 'hint', hidden: true });
    const inact = h('details', { class: 'inact', hidden: true });
    let engList = [];
    let cin = null; // Cinema-panel (valfri)
    const withCinema = (p, eng) => (cin && p && !(cin.skip && cin.skip()) && window.KinoCinema ? window.KinoCinema.apply(p, cin.get(), { kind: cin.kind, engine: eng }) : p);
    let run = null; // { ac, extra } for the job in flight
    const stopRun = async () => { const r = run; if (!r || r.ac.signal.aborted) return; r.ac.abort(); if (r.extra) await Promise.resolve().then(r.extra).catch(() => null); };
    const paintCancel = (on) => { cancelBtn.hidden = !on; cancelBtn.disabled = false; cancelBtn.textContent = 'Avbryt'; cancelBtn.onclick = on ? async () => { cancelBtn.disabled = true; cancelBtn.textContent = 'Avbryter…'; await stopRun(); } : null; };
    // onGo may add an engine-specific cancel (Render DELETE, own-GPU /cancel); the abort signal always fires too. null keeps the generic abort.
    const setCancel = (fn) => { if (run) { run.extra = fn || null; paintCancel(true); } else paintCancel(false); };
    const showHint = () => { const e = engList.find((x) => x.id === sel.value); engDetail.textContent = e ? `Modell: ${engineLabel(e)}` : (sel.value === 'colab' ? 'Modell: din egen GPU (Colab / Kaggle)' : ''); hint.hidden = !(e && e.async); hint.textContent = e && e.async ? `${e.name}: ${QUEUE_HINT}${e.detail ? ` Läget nu: ${e.detail}.` : ''}` : ''; };
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
    comp.insertBefore(engDetail, panel);
    job.append(status, h('div', { class: 'cancelrow' }, cancelBtn));
    const box = h('div', { class: 'compbox' }, extraTop || null, comp, hint, job, inact, h('div', { class: 'ctabar' }, cta));
    getEngines(st.lane).then((list) => {
      const ok = list.filter((e) => e.kind === engineKind && !(kind === 'music' && e.noMusic));
      engList = ok;
      [...sel.options].forEach((o) => { if (!o.dataset.keep) o.remove(); }); // keep client-side engines (Colab)
      ok.forEach((e) => sel.append(h('option', { value: e.id, title: e.detail || '' }, `${plainName(e)} · ${engineLabel(e)}`)));
      // engines that exist but are not usable right now (missing server keys, no free image quota, queue closed): greyed, with the honest reason
      const off = kind === 'image' ? getInactive(st.lane).filter((e) => e.kind === 'image') : [];
      off.forEach((e) => sel.append(h('option', { value: '', disabled: true, title: e.note }, `${e.name} · ej aktiv${(e.tags || []).length ? ' · ' + e.tags.join(' · ') : ''}`)));
      if (off.length) { inact.hidden = false; inact.append(h('summary', {}, `Ej aktiva modeller (${off.length})`), ...off.map((e) => h('p', {}, h('b', {}, e.name), ' – ', e.note))); }
      showHint();
      if (!ok.length) { sel.append(h('option', { value: '' }, noEngineText || 'Ingen modell svarar just nu')); sel.disabled = ![...sel.options].some((o) => o.dataset.keep && !o.disabled); if (kind !== 'video' && kind !== 'music') { go.disabled = true; cta.disabled = true; } }
      if (kind === 'edit' && !ok.length) say('Redigering fungerar inte just nu.', true);
    });
    function say(t, err) {
      status.textContent = t || ''; status.classList.toggle('err', Boolean(err));
      job.hidden = !t && !jobTimer; job.classList.toggle('err', Boolean(err));
      if (t) requestAnimationFrame(() => keepClear(job));
      const m = /(\d{1,3})\s?%/.exec(t || ''); const bi = $('.jobbar i', job); if (m) { job.classList.add('pct'); bi.style.width = `${Math.min(100, +m[1])}%`; }
    }
    async function fire() {
      if (go.disabled) return;
      go.disabled = true; cta.disabled = true; cta.classList.add('busy'); go.classList.add('busy'); comp.classList.add('is-busy'); status.classList.add('busy');
      const t0 = Date.now(); $('.jobtop b', job).textContent = 'Jobbar…'; job.hidden = false; job.classList.add('on'); job.classList.remove('pct', 'err');
      const tick = () => { $('.jobtime', job).textContent = `${fmtClock((Date.now() - t0) / 1000)} · ${ETA[kind] || ''}`; }; tick(); jobTimer = setInterval(tick, 1000);
      const ac = new AbortController(); run = { ac, extra: null }; paintCancel(true);
      const untrack = track(CTA[kind] || 'Jobb', stopRun);
      const sayRun = (t, err) => { if (!ac.signal.aborted) say(t, err); }; // late messages from a stopped job are ignored
      sayRun.signal = ac.signal; sayRun.setCancel = setCancel;
      const stopped = new Promise((_, rej) => ac.signal.addEventListener('abort', () => rej(cancelledErr()), { once: true }));
      let cancelled = false;
      try { await Promise.race([onGo({ prompt: withCinema(ta.value.trim(), sel.value), engine: sel.value, say: sayRun, setCancel, signal: ac.signal }), stopped]); } catch (e) {
        cancelled = Boolean(e.cancelled || ac.signal.aborted);
        if (cancelled) say('Avbrutet. Jobbet stoppades och resultatet sparas inte.'); else say(e.message, true);
      } finally {
        clearInterval(jobTimer); jobTimer = null; job.classList.remove('on');
        run = null; untrack(); paintCancel(false); go.disabled = false; cta.disabled = false; cta.classList.remove('busy'); go.classList.remove('busy'); comp.classList.remove('is-busy'); status.classList.remove('busy'); job.hidden = !status.textContent;
        $('.jobtop b', job).textContent = cancelled ? 'Avbrutet' : status.classList.contains('err') ? 'Något gick fel' : 'Klart';
        job.classList.toggle('cancelled', cancelled);
      }
    }
    go.onclick = fire; cta.onclick = fire;
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
    sel.addEventListener('change', () => { cta.disabled = go.disabled; });
    const setCinema = (p) => { cin = p; if (p) comp.after(p.el); };
    return { box, ta, sel, say, panel, cta, setCancel, setCinema };
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
      acts.append(h('button', { class: 'text', onclick: () => { st.lipPortrait = { name: item.name || 'verk.png', url: item.url, blob: item.blob, source: 'verk' }; location.hash = '#/lappsynk'; } }, 'Läppsynk'));
    }
    acts.append(h('button', { class: 'text dim', onclick: () => { const i = st.results[kind].indexOf(item); if (i >= 0) st.results[kind].splice(i, 1); if (item.libId && LIB) LIB.remove(item.libId).catch(() => null); card.remove(); } }, 'Ta bort'));
    card.append(acts);
    // Coverr API terms: show a clickable Coverr credit when Coverr clips are used
    if (item.credits && item.credits.coverr) card.append(h('div', { class: 'meta' }, h('a', { href: item.credits.coverr.url || 'https://coverr.co', target: '_blank', rel: 'noopener' }, item.credits.coverr.text || 'Video från Coverr')));
    return card;
  }
  const EMPTY = { image: 'Dina bilder visas här.', video: 'Dina videoklipp visas här.', music: 'Din musikvideo visas här.', edit: 'Dina redigerade bilder visas här.' };
  const pagehead = (t, sub) => h('div', { class: 'pagehead' }, h('h2', {}, t), sub ? h('p', {}, sub) : null);
  function results(kind) { const g = h('div', { class: 'results', 'data-empty': EMPTY[kind] || 'Inget här än.' }); st.results[kind].forEach((i) => g.append(resultCard(i, kind))); return g; }

  // ---- Tillgångsbibliotek (IndexedDB, bara i den här webbläsaren) ----
  const LIB = window.KinoLib || null;
  const LIB_RK = { image: 'image', edit: 'image', video: 'video', music: 'video' };
  const fmtMB = (b) => `${(b / 1048576).toFixed(b < 10485760 ? 1 : 0)} MB`;
  const libAuto = () => localStorage.getItem('kino.lib.auto') !== '0';
  function persistResult(item, rk) {
    if (!LIB || !item || item.libId || !item.url) return;
    LIB.add({ blob: item.blob, url: abs(item.url), name: item.name || `${rk}-${Date.now()}`, kind: LIB_RK[rk], origin: 'verk', meta: { rk, engineName: item.engineName || '', credits: item.credits || null } })
      .then((rec) => { if (rec) item.libId = rec.id; }).catch(() => null);
  }
  // Mina verk sparas automatiskt: varje nytt resultat (unshift) kopieras till biblioteket.
  Object.keys(st.results).forEach((k) => { const a = st.results[k]; a.unshift = function (...xs) { xs.forEach((x) => persistResult(x, k)); return Array.prototype.unshift.apply(this, xs); }; });
  const libReady = !LIB ? Promise.resolve() : LIB.list({ origin: 'verk' }).then((l) => {
    l.forEach((rec) => { const rk = (rec.meta && rec.meta.rk) || (rec.kind === 'image' ? 'image' : 'video'); if (!st.results[rk] || rec.kind === 'audio') return; Array.prototype.push.call(st.results[rk], { name: rec.name, url: LIB.src(rec), blob: rec.blob, engineName: (rec.meta && rec.meta.engineName) || 'Sparad', credits: rec.meta && rec.meta.credits, libId: rec.id }); });
  }).catch(() => null);
  // Uppladdningar sparas (capture-fas, så det sker innan sidans egna onchange tömmer fältet).
  document.addEventListener('change', (e) => {
    const t = e.target; if (!LIB || !t || t.type !== 'file' || t._fromLib || !t.files || !libAuto()) return;
    [...t.files].forEach((f) => { if (f.size <= LIB.MAX_ITEM && LIB.kindOf(f.type, f.name)) LIB.add({ blob: f, name: f.name, origin: 'upload' }).catch(() => null); });
  }, true);
  /** Put library files into a file input (works for hidden inputs too) and fire its change handler. */
  async function fillInput(inp, recs) {
    const dt = new DataTransfer(); for (const r of recs) dt.items.add(await LIB.file(r));
    inp.files = dt.files; inp._fromLib = true; try { inp.dispatchEvent(new Event('change', { bubbles: true })); inp.dispatchEvent(new Event('input', { bubbles: true })); } finally { inp._fromLib = false; }
  }
  const acceptKinds = (accept) => { const a = String(accept || ''); const k = []; if (/image/.test(a)) k.push('image'); if (/video/.test(a)) k.push('video'); if (/audio|\.mp3|\.wav/.test(a)) k.push('audio'); return k.length ? k : LIB ? LIB.KINDS : []; };
  /** Browser: tabs Uppladdningar / Mina verk, kind filter, delete, clear. onPick(rec) makes it a picker. */
  function libraryBrowser({ kinds, onPick, multi } = {}) {
    kinds = kinds || (LIB ? LIB.KINDS : []);
    let origin = 'upload'; let kind = ''; const chosen = new Set();
    const KN = { image: 'Bilder', video: 'Video', audio: 'Ljud' };
    const grid = h('div', { class: 'libgrid' }); const info = h('div', { class: 'meta' });
    const tabs = seg(...[['upload', 'Uppladdningar'], ['verk', 'Mina verk']].map(([o, t]) => h('button', { type: 'button', 'aria-pressed': String(o === origin), onclick: (e) => { origin = o; tabs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); paint(); } }, t)));
    const filt = select([['', kinds.length > 1 ? 'Alla typer' : KN[kinds[0]]], ...(kinds.length > 1 ? kinds.map((k) => [k, KN[k]]) : [])], '');
    filt.setAttribute('aria-label', 'Filtrera på typ'); filt.onchange = () => { kind = filt.value; paint(); };
    const clearBtn = h('button', { class: 'text dim danger', type: 'button', onclick: async () => { if (!confirm(`Rensa allt under ${origin === 'upload' ? 'Uppladdningar' : 'Mina verk'}? Det går inte att ångra.`)) return; await LIB.clear(origin); if (origin === 'verk') Object.keys(st.results).forEach((k) => st.results[k].splice(0)); paint(); } }, 'Rensa');
    const pickBtn = multi ? h('button', { class: 'text primary', type: 'button', disabled: true, onclick: async () => { const l = (await LIB.list()).filter((a) => chosen.has(a.id)); onPick(l); } }, 'Använd valda') : null;
    async function paint() {
      grid.innerHTML = ''; if (!LIB) return grid.append(empty('Biblioteket fungerar inte här.', 'Webbläsaren saknar IndexedDB (t.ex. privat läge).'));
      let l; try { l = (await LIB.list({ origin, kind: kind || undefined })).filter((a) => kinds.includes(a.kind)); } catch (e) { return grid.append(empty('Biblioteket kunde inte öppnas.', String(e.message || e))); }
      const u = await LIB.usage().catch(() => null);
      info.textContent = `${l.length} filer här${u ? ` · totalt ${fmtMB(u.bytes)} av ${fmtMB(u.max)} (äldst rensas automatiskt)` : ''}`;
      if (!l.length) grid.append(empty(origin === 'upload' ? 'Inga uppladdningar ännu.' : 'Inga sparade verk ännu.', origin === 'upload' ? 'Filer du laddar upp i KINO hamnar här.' : 'Det du skapar sparas här automatiskt.'));
      l.forEach((a) => {
        const s = LIB.src(a);
        const media = a.kind === 'image' ? h('img', { src: s, alt: '', loading: 'lazy' }) : a.kind === 'video' ? h('video', { src: s, muted: true, playsinline: true, preload: 'metadata', controls: !onPick }) : h('audio', { src: s, controls: true, preload: 'none' });
        const card = h('div', { class: 'libitem' + (chosen.has(a.id) ? ' on' : '') }, media, h('div', { class: 'meta' }, `${a.name.slice(0, 40)} · ${a.size ? fmtMB(a.size) : 'länk'}`));
        const acts = h('div', { class: 'acts' });
        if (onPick) acts.append(h('button', { class: 'text primary', type: 'button', onclick: () => { if (!multi) return onPick([a]); if (chosen.has(a.id)) chosen.delete(a.id); else chosen.add(a.id); card.classList.toggle('on', chosen.has(a.id)); pickBtn.disabled = !chosen.size; pickBtn.textContent = `Använd valda (${chosen.size})`; } }, multi ? 'Välj' : 'Använd'));
        else acts.append(h('a', { class: 'text', href: s, download: a.name, target: '_blank' }, 'Ladda ned'));
        acts.append(h('button', { class: 'text dim danger', type: 'button', onclick: async () => { await LIB.remove(a.id); Object.keys(st.results).forEach((k) => { const i = st.results[k].findIndex((x) => x.libId === a.id); if (i >= 0) st.results[k].splice(i, 1); }); card.remove(); } }, 'Ta bort'));
        card.append(acts); grid.append(card);
      });
    }
    paint();
    return h('div', { class: 'libbrowser' }, h('div', { class: 'librow' }, tabs, filt, clearBtn, pickBtn), info, grid);
  }
  function openLibrary({ kinds, onPick, multi }) {
    const close = () => { ov.remove(); document.removeEventListener('keydown', esc); };
    const esc = (e) => { if (e.key === 'Escape') close(); };
    const ov = h('div', { class: 'gate libmodal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Tillgångsbibliotek', onclick: (e) => { if (e.target === ov) close(); } },
      h('div', { class: 'gatebox libbox' }, h('div', { class: 'librow' }, h('b', {}, 'Tillgångsbibliotek'), h('button', { class: 'text dim', type: 'button', onclick: close }, 'Stäng')),
        libraryBrowser({ kinds, multi, onPick: async (recs) => { try { await onPick(recs); close(); } catch (e) { alert(String(e.message || e)); } } })));
    document.addEventListener('keydown', esc); document.body.append(ov);
  }
  /** "Från biblioteket" button that fills a file input. */
  const libButton = (inp, label = 'Från biblioteket') => (LIB ? h('button', { class: 'text dim libpick', type: 'button', onclick: (e) => { e.preventDefault(); e.stopPropagation(); openLibrary({ kinds: acceptKinds(inp.accept), multi: inp.multiple, onPick: (recs) => fillInput(inp, recs) }); } }, label) : null);
  function bibliotekView(v) {
    v.append(pagehead('Tillgångsbibliotek', 'Dina uppladdningar och färdiga verk, sparade i den här webbläsaren (inget laddas upp). Välj dem i alla filfält med "Från biblioteket".'),
      h('label', { class: 'meta' }, (() => { const cb = h('input', { type: 'checkbox', checked: libAuto(), onchange: () => localStorage.setItem('kino.lib.auto', cb.checked ? '1' : '0') }); return cb; })(), ' Spara mina uppladdningar automatiskt'),
      libraryBrowser({}));
  }

  // ---- Cinema-läge: kamera, objektiv, bländare, rörelse, utsnitt, vinkel, ljus, färg ----
  function cinemaPanel(kind) {
    const C = window.KinoCinema; if (!C) return null;
    const LS = `kino.cinema.${kind}`;
    let cur = C.normalize((() => { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch { return {}; } })());
    const keys = C.KEYS.filter((k) => kind === 'video' || k !== 'move');
    const sels = {}; const custom = h('input', { type: 'text', placeholder: 'Egen text, t.ex. "regn på rutan, 1970-tal"', maxlength: 200 });
    const prev = h('div', { class: 'meta cinprev' }); const sum = h('span', { class: 'meta' });
    keys.forEach((k) => { const s = select(C.OPT[k].map(([id, sv]) => [id, sv]), cur[k] || ''); s.onchange = () => { cur[k] = s.value; save(); }; sels[k] = s; });
    custom.value = cur.custom || ''; custom.oninput = () => { cur.custom = custom.value; save(); };
    const presetBtns = C.PRESETS.map(([name, c]) => h('button', { class: 'chip', type: 'button', title: C.summary(c), onclick: () => set(c) }, h('span', { class: 'cn' }, name)));
    function paint() { keys.forEach((k) => { sels[k].value = cur[k] || ''; }); custom.value = cur.custom || ''; const t = C.compile(cur, { kind }); prev.textContent = t ? `Läggs till prompten: ${t}` : 'Inget valt – prompten skickas som den är.'; sum.textContent = C.isEmpty(cur) ? '' : `· ${C.summary(cur)}`; }
    function save() { cur = C.normalize(cur); localStorage.setItem(LS, JSON.stringify(cur)); paint(); }
    function set(c) { cur = C.normalize(c || {}); save(); el.open = true; }
    const el = h('details', { class: 'cinema' }, h('summary', {}, h('b', {}, 'Cinema'), ' ', sum),
      h('div', { class: 'meta' }, 'Kamera, objektiv, ljus och färg som en filmfotograf. Välj en förinställning eller egna val – det läggs till din prompt anpassat för motorn.'),
      h('div', { class: 'chips cinpresets' }, ...presetBtns, h('button', { class: 'chip', type: 'button', onclick: () => set({}) }, h('span', { class: 'cn' }, 'Rensa'))),
      h('div', { class: 'cingrid' }, ...keys.map((k) => field(C.LABELS[k], sels[k])), field('Egen text', custom, true)), prev);
    const onEv = (e) => { if (!el.isConnected) return document.removeEventListener('kino-cinema', onEv); set(e.detail); };
    document.addEventListener('kino-cinema', onEv);
    st.cinemaGet = () => (C.isEmpty(cur) ? null : { ...cur });
    paint();
    return { el, kind, get: () => cur, set };
  }

  // ---- Läppsynk: porträtt + ljud -> talande/sjungande klipp ----
  async function lappsynkView(v) {
    v.append(pagehead('Läppsynk', 'Välj ett porträtt ur din artistlista (eller egen AI-figur) och ett ljud – få ett klipp där munnen följer rösten. Bara era egna artister, aldrig kändisar.'));
    const roster = rosterLocal().filter((a) => a.photos && a.photos.length);
    let portrait = st.lipPortrait || null; st.lipPortrait = null;
    const pick = st.agentPick && st.agentPick.lipsync ? st.agentPick.lipsync : null; if (pick) st.agentPick.lipsync = null;
    const pv = h('div', { class: 'lipportrait' });
    const paintP = () => { pv.innerHTML = ''; if (!portrait) return pv.append(h('span', { class: 'meta' }, 'Inget porträtt valt.')); pv.append(h('img', { src: portrait.blob ? URL.createObjectURL(portrait.blob) : abs(portrait.url), alt: '' }), h('span', { class: 'meta' }, `${portrait.name} · ${({ roster: 'artistlistan', persona: 'AI-figur', verk: 'Mina verk', upload: 'egen uppladdning' })[portrait.source]}`)); paintC(); };
    const rosterChips = h('div', { class: 'chips' }, ...(roster.length ? roster.map((a) => h('button', { class: 'chip', type: 'button', onclick: async () => { portrait = { name: a.name, blob: await dataBlob(a.photos[0]), source: a.ai || a.persona ? 'persona' : 'roster' }; paintP(); } }, h('img', { src: a.photos[0], alt: '', class: 'chipimg' }), h('span', { class: 'cn' }, a.name), h('span', { class: 'ch' }, a.ai || a.persona ? 'AI-figur' : 'artist'))) : [h('span', { class: 'meta' }, 'Artistlistan är tom. '), h('a', { href: '#/persona' }, 'Skapa en AI-artist'), h('span', { class: 'meta' }, ' eller lägg till under Egen GPU › Artistlista.')]));
    if (pick && pick.artist) { const a = roster.find((x) => x.name.toLowerCase() === String(pick.artist).toLowerCase()); if (a) dataBlob(a.photos[0]).then((b) => { portrait = { name: a.name, blob: b, source: a.ai || a.persona ? 'persona' : 'roster' }; paintP(); }); }
    const pUp = h('input', { type: 'file', accept: 'image/*', onchange: () => { const f = pUp.files[0]; if (f) { portrait = { name: f.name, blob: f, source: pUp._fromLib ? 'verk' : 'upload' }; paintP(); } } });
    // audio
    const aIn = h('input', { type: 'file', accept: '.mp3,.wav,.m4a,.ogg,audio/*' });
    const from = h('input', { type: 'number', min: 0, step: 0.5, value: 0 }); const to = h('input', { type: 'number', min: 0, step: 0.5, value: 8 });
    const tts = h('textarea', { rows: 3, maxlength: 600, placeholder: 'Eller skriv text som läses upp (text till tal), t.ex. "Hej! Nya singeln släpps på fredag."' });
    const lang = select([['sv', 'Svenska'], ['en', 'Engelska']], 'sv');
    if (pick && pick.text) tts.value = pick.text;
    const amode = select([['file', 'Ljudfil eller del av låt'], ['tts', 'Text till tal']], pick && pick.text ? 'tts' : 'file');
    const fileBox = h('div', { class: 'grid2' }, field('Ljud / låt', aIn, true), field('Från (s)', from), field('Till (s)', to), h('small', { class: 'meta wide' }, 'Max 12 sekunder per klipp. Välj den del av låten som ska sjungas.'));
    const ttsBox = h('div', {}, field('Text', tts, true), field('Språk', lang));
    const paintA = () => { fileBox.hidden = amode.value !== 'file'; ttsBox.hidden = amode.value !== 'tts'; }; amode.onchange = paintA; paintA();
    const vocals = h('input', { type: 'checkbox' });
    // engine
    const eng = select([['auto', 'Automatiskt (egen GPU om ansluten, annars Hugging Face)'], ['gpu', 'Egen GPU: LatentSync 1.5 (Kaggle / Colab)'], ['hf', 'Hugging Face LTX-2 (gratis, ca 1 klipp/dag)']], 'auto');
    const engInfo = h('div', { class: 'meta' }, 'Kollar motorer…');
    let gpuOk = false; let hfOk = false;
    Promise.all([colabHealth(), fetch(`${API}/lipsync/info`).then((r) => r.json()).catch(() => null)]).then(([c, i]) => {
      gpuOk = c.state === 'on' && (!c.info || !c.info.features || c.info.features.includes('lipsync')); hfOk = Boolean(i && i.hf && i.hf.available);
      engInfo.textContent = `Egen GPU: ${c.state === 'on' ? (gpuOk ? 'ansluten, LatentSync redo' : 'ansluten men LatentSync är inte installerad (kör LatentSync-cellen i notebooken)') : 'inte ansluten'} · Hugging Face: ${hfOk ? 'tillgänglig' : 'inte aktiverad på servern'}`;
    });
    const consent = h('input', { type: 'checkbox' });
    const consentTxt = h('span', {});
    function paintC() { consentTxt.textContent = portrait && portrait.source === 'upload' ? ' Jag intygar att personen på bilden är jag själv eller vår egen artist och har gett samtycke (inga kändisar, inga minderåriga)' : ' Jag intygar att porträttet är vår egen artist eller AI-figur och att samtycke finns'; }
    paintC();
    const status = h('div', { class: 'status', role: 'status', 'aria-live': 'polite' });
    const say = (m, err) => { status.textContent = m; status.classList.toggle('err', Boolean(err)); };
    const grid = h('div', { class: 'results', 'data-empty': 'Dina läppsynkade klipp visas här.' });
    st.results.video.filter((x) => /läppsynk|lipsync/i.test(x.engineName || '')).forEach((x) => grid.append(resultCard(x, 'video')));
    const cancelBtn = h('button', { class: 'text cancel', type: 'button', hidden: true }, 'Avbryt');
    const go = h('button', { class: 'text primary cta-main', type: 'button' }, 'Skapa läppsynk');
    let ac = null;
    async function getAudio(signal) {
      if (amode.value === 'tts') {
        const text = tts.value.trim(); if (!text) throw new Error('Skriv texten som ska läsas upp.');
        if (minorText(text)) throw new Error(REFUSE);
        say('Läser upp texten (text till tal)…');
        const r = await fetch(`${API}/lipsync/tts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, lang: lang.value, lane: st.lane }), signal });
        if (!r.ok) throw new Error(await errMsg(r));
        const j = await r.json(); const out = await poll(j.jobId, (m) => say(m), signal);
        return new File([await fetch(abs(out.url), { signal }).then((x) => x.blob())], 'tal.wav', { type: 'audio/wav' });
      }
      const f = aIn.files[0]; if (!f) throw new Error('Välj ett ljud eller en låt.'); if (f.size > 20 * 1048576) throw new Error('Ljudet får vara max 20 MB.'); return f;
    }
    go.onclick = async () => {
      if (!portrait) return say('Välj ett porträtt först.', true);
      if (!consent.checked) return say('Kryssa i samtycket först.', true);
      if (st.lane === 'nsfw' && portrait.source === 'upload') return say('I vuxenläget går läppsynk bara med porträtt ur artistlistan, AI-figurer eller dina egna verk.', true);
      const s0 = +from.value || 0; const s1 = +to.value || 0;
      if (amode.value === 'file' && s1 && s1 <= s0) return say('"Till" måste vara större än "Från".', true);
      const which = eng.value === 'auto' ? (gpuOk ? 'gpu' : 'hf') : eng.value;
      if (which === 'gpu' && !gpuOk) return say('Egen GPU är inte ansluten eller saknar LatentSync. Anslut under Inställningar › Egen GPU, eller välj Hugging Face.', true);
      ac = new AbortController(); go.disabled = true; cancelBtn.hidden = false;
      let serverJob = null;
      const untrack = track('Läppsynk', async () => { ac.abort(); if (serverJob) await fetch(`${API}/jobs/${serverJob}`, { method: 'DELETE' }).catch(() => null); });
      cancelBtn.onclick = async () => { cancelBtn.disabled = true; ac.abort(); if (serverJob) await fetch(`${API}/jobs/${serverJob}`, { method: 'DELETE' }).catch(() => null); };
      status.classList.add('busy');
      try {
        const img = new File([portrait.blob || await fetch(abs(portrait.url)).then((x) => x.blob())], /\.(png|jpe?g|webp)$/i.test(portrait.name) ? portrait.name : 'portratt.jpg', { type: (portrait.blob && portrait.blob.type) || 'image/jpeg' });
        let out;
        if (which === 'gpu') {
          const audio = await getAudio(ac.signal);
          const fd = new FormData(); fd.append('image', img); fd.append('audio', audio);
          fd.append('start', amode.value === 'file' ? String(s0) : '0'); fd.append('end', amode.value === 'file' ? String(s1 || s0 + 12) : '0');
          fd.append('vocals', vocals.checked && amode.value === 'file' ? 'true' : 'false'); fd.append('consent', 'true');
          const sayG = (m) => say(m); sayG.signal = ac.signal;
          say('Skickar till din GPU (LatentSync)…');
          const r = await colabJob('/lipsync', fd, sayG);
          const f = (r.files || []).find((x) => /\.mp4$/i.test(x.name)) || (r.files || [])[0]; if (!f) throw new Error('GPU:n gav inget klipp.');
          out = { name: f.name, url: f.url, blob: f.blob, engineName: 'LatentSync 1.5 läppsynk (egen GPU)' };
        } else {
          const fd = new FormData(); fd.append('lane', st.lane); fd.append('image', img); fd.append('consent', 'true'); fd.append('source', portrait.source); fd.append('name', portrait.name);
          if (amode.value === 'tts') { const t = tts.value.trim(); if (!t) throw new Error('Skriv texten som ska läsas upp.'); fd.append('ttsText', t); fd.append('lang', lang.value); }
          else { const f = aIn.files[0]; if (!f) throw new Error('Välj ett ljud eller en låt.'); fd.append('audio', f); fd.append('start', String(s0)); fd.append('end', String(s1)); }
          say('Skickar till Hugging Face (gratis, kan köa)…');
          const r = await fetch(`${API}/lipsync`, { method: 'POST', body: fd, signal: ac.signal });
          if (!r.ok) throw new Error(await errMsg(r));
          const j = await r.json(); serverJob = j.jobId;
          out = await poll(j.jobId, (m) => say(m || 'Jobbar…'), ac.signal);
        }
        st.results.video.unshift(out); grid.prepend(resultCard(out, 'video')); say(`Klart! Gjord av ${out.engineName}. Sparad i Mina verk.`);
      } catch (e) { say(e.cancelled || ac.signal.aborted ? 'Avbrutet.' : String(e.message || e).slice(0, 300), !(e.cancelled || ac.signal.aborted)); }
      finally { untrack(); go.disabled = false; cancelBtn.hidden = true; cancelBtn.disabled = false; status.classList.remove('busy'); }
    };
    paintP();
    v.classList.add('two');
    v.append(h('div', { class: 'compbox lipsync' },
      h('section', { class: 'step' }, h('b', {}, '1. Porträtt'), rosterChips, h('div', { class: 'librow' }, field('Eget foto / från biblioteket', pUp, true)), pv),
      h('section', { class: 'step' }, h('b', {}, '2. Ljud'), field('Källa', amode), fileBox, ttsBox, h('label', {}, vocals, ' Isolera sången först (bara egen GPU)')),
      h('section', { class: 'step' }, h('b', {}, '3. Motor'), field('Motor', eng, true), engInfo, h('label', { class: 'wide' }, consent, consentTxt)),
      status, h('div', { class: 'ctabar' }, go, cancelBtn)), grid);
  }

  // ---- views ----
  const ICONS = {
    viral: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
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
  Object.assign(ICONS, {
    lipsync: '<path d="M4 12c2-3 5-4 8-4s6 1 8 4c-2 3-5 4-8 4s-6-1-8-4z"/><path d="M4 12h16"/>',
    face: '<circle cx="12" cy="12" r="8"/><circle cx="9" cy="10.5" r=".8"/><circle cx="15" cy="10.5" r=".8"/><path d="M9 15c1.7 1.3 4.3 1.3 6 0"/>',
    agent: '<path d="M4 5h16v11H9l-5 4z"/><path d="M9 10h.01M12 10h.01M15 10h.01"/>',
    voice: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  });
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
    st.homeTiles = TILES; st.tile = tile;
    const big = ([ic, t, d, href, grad]) => h('a', { class: 'bigcard' + (grad ? ' grad' : ''), href }, h('span', { class: 'ti' }, icon(ic)), h('span', {}, h('b', {}, t), h('small', {}, d)), h('span', { class: 'arr', 'aria-hidden': 'true' }, '›'));
    const last = localStorage.getItem('kino.last'); const lastT = LAST_NAMES[last];
    const nRes = Object.values(st.results).reduce((a, x) => a + x.length, 0);
    v.append(
      h('section', { class: 'hero' },
        h('h1', {}, 'Vad vill du skapa?'),
        h('p', { class: 'lede' }, 'Skriv på svenska eller engelska.')),
      h('div', { class: 'bigcards' },
        big(['music', 'Musikvideo', 'Låt + idé blir en klippt video', '#/music', true]),
        big(['video', 'Video', 'Text eller bild blir ett klipp', '#/video']),
        big(['image', 'Bild', 'Skriv en text, få en bild', '#/image'])),
      ...((lastT || nRes) ? [h('h2', { class: 'sect' }, 'Fortsätt där du var'), h('div', { class: 'continue' },
        lastT ? h('a', { class: 'contcard', href: '#/' + last }, h('b', {}, lastT), h('small', {}, 'Senast öppnad')) : null,
        nRes ? h('a', { class: 'contcard', href: '#/verk' }, h('b', {}, `Mina verk (${nRes})`), h('small', {}, 'Från den här sessionen')) : null)] : []),
      h('div', { class: 'quick' }, h('a', { class: 'text dim', href: '#/skapa' }, 'Allt du kan skapa'), h('a', { class: 'text dim', href: '#/verktyg' }, 'Verktyg')),
      h('p', { class: 'lanenote' + (nsfw ? ' nsfw' : '') }, nsfw
        ? 'NSFW-läge är på: endast för vuxna 21+. Minderåriga blockeras alltid, inga foton på riktiga personer, modellnamn visas ärligt och det finns ingen tyst reservmodell. Byt läge under Inställningar (Motor-knappen uppe till höger).'
        : 'Läge: SFW. Vuxenläget (21+) finns under Inställningar.'),
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

  const LAST_NAMES = { image: 'Bild', video: 'Video', music: 'Musikvideo', script: 'Manus', edit: 'Redigera bild', timeline: 'Tidslinje', klipp: 'Klipp ur lång video', lappsynk: 'Läppsynk' };
  const hub = (v, title, sub, items) => {
    const nsfw = st.lane === 'nsfw';
    v.append(pagehead(title, sub), h('div', { class: 'hub' }, items.map(([ic, t, d, href, preset, sfwOnly]) => {
      const off = Boolean(sfwOnly && nsfw);
      return h('a', { class: 'hubcard' + (off ? ' off' : ''), href: off ? null : href, 'aria-disabled': off ? 'true' : null, onclick: () => { st.preset = preset || null; } }, h('span', { class: 'ti' }, icon(ic)), h('span', {}, h('b', {}, t), h('small', {}, off ? 'Bara i SFW-läget' : d)), h('span', { class: 'arr', 'aria-hidden': 'true' }, '›'));
    })));
  };
  function skapaView(v) {
    hub(v, 'Skapa', 'Välj vad du vill göra.', [
      ['agent', 'AI-agent', 'Skriv ett önskemål – agenten kör rätt verktyg åt dig', '#/agent'],
      ['music', 'Musikvideo', 'Låt + idé blir en klippt video', '#/music'],
      ['video', 'Video', 'Text eller bild blir ett klipp', '#/video'],
      ['lipsync', 'Läppsynk', 'Din artist sjunger eller pratar', '#/lappsynk'],
      ['image', 'Bild', 'Skriv en text, få en bild', '#/image'],
      ['script', 'Manus', 'En idé blir scenkort att ändra', '#/script'],
      ['viral', 'Viral-mixer', 'TikTok-trender (video + musik) blir en prompt', '#/viral'],
      ['face', 'Skapa influencer-artist', 'Hitta på en AI-artist, få 4 ansikten, spara i artistlistan', '#/persona'],
      ['stock', 'Stockklipp till låt', 'Riktiga klipp i takt med musiken', '#/music', 'stock', true],
    ]);
  }
  function verktygView(v) {
    hub(v, 'Verktyg', 'Ändra, klipp och byt. Verktyg märkta "egen GPU" kräver Colab eller Kaggle.', [
      ['edit', 'Redigera', 'Ändra en bild med text', '#/edit'],
      ['klipp', 'Klipp', 'Lång video blir korta klipp med text', '#/klipp'],
      ['timeline', 'Tidslinje', 'Klipp ihop och exportera mp4', '#/timeline'],
      ['analyze', 'Analysera video', 'Ladda upp ett klipp, få scener', '#/script', 'analyze'],
      ['lipsync', 'Läppsynk', 'Porträtt + låt eller text blir ett sjungande klipp', '#/lappsynk'],
      ['image', 'Tillgångsbibliotek', 'Uppladdningar och färdiga verk, sparade i webbläsaren', '#/bibliotek'],
      ['face', 'Ansiktsbyte', 'Egen GPU · bara samtyckta artister', '#/motor?t=faceswap'],
      ['voice', 'Röstbyte', 'Egen GPU · röster ur din röstlista', '#/motor?t=voice'],
      ['music', 'Fler GPU-verktyg', 'Sång/instrumental, låttext, auto-klipp, skala upp', '#/motor'],
    ]);
  }
  function verkView(v) {
    const kinds = [['music', 'Musikvideor'], ['video', 'Video'], ['image', 'Bilder'], ['edit', 'Redigerade bilder']];
    const n = kinds.reduce((a, [k]) => a + st.results[k].length, 0);
    v.append(pagehead('Mina verk', LIB ? 'Allt du skapat sparas i den här webbläsaren (Tillgångsbiblioteket). Ladda ned det du vill ha kvar för säkerhets skull.' : 'Allt du skapat i den här sessionen. Ladda ned det du vill spara – det försvinner när du stänger sidan.'), LIB ? h('a', { class: 'text', href: '#/bibliotek' }, 'Öppna Tillgångsbiblioteket ›') : null, h('div', { class: 'stoprow' }, stopAllButton(), h('span', { class: 'meta' }, 'Stoppar allt som körs: Render-servern, din egen GPU och Seedream i den här fliken.')));
    if (!n) return v.append(empty('Inget här än.', 'Det du skapar visas här.'), h('div', { class: 'quick' }, h('a', { class: 'text primary', href: '#/skapa' }, 'Skapa något')));
    kinds.forEach(([k, t]) => { if (st.results[k].length) v.append(h('h2', { class: 'sect' }, `${t} (${st.results[k].length})`), results(k)); });
  }
  function settingsView(v, q) {
    const tool = new URLSearchParams(q || '').get('t');
    const laneCard = h('section', { class: 'setcard' }, h('div', {}, h('b', {}, 'Läge'), h('small', {}, st.lane === 'nsfw' ? 'NSFW: bara för vuxna 21+. Minderåriga blockeras alltid.' : 'SFW. Vuxenläget (21+) kräver ålderskontroll.')), laneBtn);
    const panel = colabPanel((on) => paintPill(on));
    panel.open = true;
    v.append(pagehead(/^#\/motor/.test(location.hash) ? 'Egen GPU' : 'Inställningar', 'Motor och läge. Allt sparas bara i den här webbläsaren.'), laneCard, h('div', { class: 'stoprow' }, stopAllButton()), h('h2', { class: 'sect' }, 'Motor: Colab / Kaggle (egen GPU)'), panel);
    if (tool) setTimeout(() => { const el = document.getElementById(`tool-${tool}`); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 300);
  }

  async function imageView(v) {
    const ratio = select([['1:1', '1:1'], ['9:16', '9:16'], ['16:9', '16:9'], ['4:5', '4:5']], '1:1');
    const res = select([['standard', 'Standard'], ['high', 'Hög']], 'standard');
    const count = select([['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']], '1');
    const lora = select([['auto', 'auto'], ['none', 'ingen'], ['photo', 'foto'], ['cinematic', 'filmisk']], 'auto');
    const grid = results('image');
    const c = composer({ kind: 'image', engineKind: 'image', placeholder: 'Beskriv en bild', settings: [field('Format', ratio), field('Upplösning', res), field('Antal', count), field('LoRA', lora)],
      onGo: async ({ prompt, engine, say, setCancel, signal }) => {
        if (!prompt) return say('Skriv en prompt.', true);
        if (engine.startsWith('puter:')) {
          const n = Math.max(1, Math.min(4, +count.value || 1));
          for (let i = 0; i < n; i++) {
            say(i ? `Seedream ${i + 1}/${n}…` : 'Seedream (Puter)… första gången ber den dig logga in hos Puter.');
            const item = await seedream({ engineId: engine, prompt, ratio: ratio.value, signal });
            st.results.image.unshift(item); grid.prepend(resultCard(item, 'image'));
          }
          return say(`Gjord av ${st.results.image[0].engineName}.${st.results.image[0].note ? ' ' + st.results.image[0].note.trim() : ''}${lora.value === 'photo' || lora.value === 'cinematic' ? ' LoRA finns inte för Seedream.' : ''}`);
        }
        say('Skapar…');
        const r = await fetch(`${API}/image`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lane: st.lane, engine, prompt, ratio: ratio.value, resolution: res.value, count: count.value, lora: lora.value }), signal });
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
    const cinI = cinemaPanel('image'); if (cinI) { c.setCinema(cinI); if (st.cinemaPrefill) { cinI.set(st.cinemaPrefill); st.cinemaPrefill = null; } }
    v.classList.add('two');
    if (st.imagePrefill) { c.ta.value = st.imagePrefill; st.imagePrefill = null; c.ta.dispatchEvent(new Event('input')); }
    v.append(pagehead('Bild', 'Skriv vad du vill se. Format och antal finns under Inställningar.'), c.box, grid);
  }

  function fileField(label, accept, carry) {
    const inp = h('input', { type: 'file', accept });
    const wrap = h('label', {}, label, inp);
    const o = { el: wrap, inp, ref: carry && !carry.blob && !/^(https?:|blob:|data:)/.test(carry.url) ? carry.name : null, blob: carry && carry.blob ? carry.blob : null };
    if (carry) {
      const t = h('div', { class: 'thumb' }, h('img', { src: abs(carry.url) }), h('button', { type: 'button', 'aria-label': 'Ta bort', onclick: (e) => { e.preventDefault(); o.ref = null; o.blob = null; t.remove(); } }, '×'));
      wrap.append(t);
    }
    return o;
  }

  const CLIP_TOOLS = [['Google Vids', 'https://vids.google.com/'], ['Google Flow', 'https://labs.google/flow'], ['Dola', 'https://www.dola.com/'], ['Grok Imagine', 'https://grok.com/imagine'], ['Digen', 'https://digen.ai/create'], ['DreamFace', 'https://www.dreamfaceapp.com/tools/free-ai-video-generator'], ['Bing Video Creator', 'https://www.bing.com/images/create/ai-video-generator'], ['PixVerse', 'https://app.pixverse.ai/'], ['Kling', 'https://kling.ai/app/'], ['Vidu', 'https://www.vidu.com/'], ['Krea', 'https://www.krea.ai/video'], ['Meta AI (bild)', 'https://www.meta.ai/'], ['giz.ai', 'https://www.giz.ai/text-to-video/'], ['Hugging Face Wan 2.2', 'https://huggingface.co/spaces/zerogpu-aoti/wan2-2-fp8da-aoti-faster'], ['Coverr', 'https://coverr.co/'], ['Mixkit', 'https://mixkit.co/free-stock-video/'], ['ImagineArt', 'https://www.imagine.art/ai-video-generator'], ['fal H3', 'https://fal.ai/minimax-h3-max'], ['fal Wan 3', 'https://fal.ai/wan-video-free'], ['Pippit', 'https://www.pippit.ai/'], ['Topview T1', 'https://www.topview.ai/topview-t1'], ['ToolFK Wan', 'https://www.toolfk.com/tools/hf-wan-image-to-video.html'], ['ToolFK Bild', 'https://www.toolfk.com/tools/online-text-to-img.html'], ['Finputsa i OpenCut', 'https://opencut.app']];
  // Grouping + small free-allowance hints live in a separate map, so a new [name, url] pair added to CLIP_TOOLS still shows up (in Video-AI) without touching this.
  // Hints are rough and can change at any time; the footnote says so.
  const CLIP_GROUPS = [['v', 'Video-AI', 'Text/bild → videoklipp'], ['i', 'Bild-AI', 'Gör en bild, animera den under Video'], ['s', 'Stockklipp', 'Riktiga klipp, gratis att ladda ned'], ['e', 'Redigera', 'Finputsa klippen du laddat ned']];
  const CLIP_META = {
    'Google Vids': ['v', 'några gratisklipp/mån'], 'Google Flow': ['v', 'dagskrediter (ev. plan)'], 'Dola': ['v', 'kolla gratisnivå'], 'Grok Imagine': ['v', 'gratisnivå varierar'],
    'Digen': ['v', 'några gratisförsök/dag'], 'DreamFace': ['v', 'kolla gratisnivå'], 'Bing Video Creator': ['v', '10 snabba, sen långsamt'], 'PixVerse': ['v', 'dagskrediter'],
    'Kling': ['v', 'gratiskrediter'], 'Vidu': ['v', 'bonus vid inloggning'], 'Krea': ['v', 'dagskrediter'], 'giz.ai': ['v', 'kolla gratisnivå'],
    'Hugging Face Wan 2.2': ['v', 'gratis, ibland kö'], 'ImagineArt': ['v', 'dagskrediter'], 'fal H3': ['v', 'kolla gratisnivå'], 'fal Wan 3': ['v', 'kolla gratisnivå'], 'Pippit': ['v', 'gratis krediter, vattenstämpel'], 'Topview T1': ['v', 'betald'], 'ToolFK Wan': ['v', 'bild till video, gratis dagskvot, gäster har gräns'],
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
  // ---- Colab (egen GPU): user's own Colab notebook, called directly from the browser; URL + token in localStorage only ----
  const COLAB_NB = 'https://colab.research.google.com/github/pistpejl/kino/blob/main/colab/kino_colab_engine.ipynb';
  const KAGGLE_NB_GH = 'https://github.com/pistpejl/kino/blob/main/kaggle/kino_kaggle_engine.ipynb';
  const colabCfg = () => ({ url: (localStorage.getItem('kino.colab.url') || '').trim().replace(/\/+$/, ''), token: localStorage.getItem('kino.colab.token') || '' });
  const colabHdr = () => ({ Authorization: `Bearer ${colabCfg().token}` });
  async function colabHealth() {
    const { url, token } = colabCfg(); if (!url || !token) return { state: 'none' };
    try {
      const r = await fetch(`${url}/health`, { headers: colabHdr(), signal: AbortSignal.timeout(8000) });
      if (!r.ok) return { state: 'off' };
      const j = await r.json(); return j.auth ? { state: 'on', info: j } : { state: 'auth' };
    } catch { return { state: 'off' }; }
  }
  async function colabVideo({ prompt, seconds, ratio, image, say }) {
    const { url } = colabCfg(); const fd = new FormData();
    fd.append('prompt', prompt); fd.append('seconds', String(Math.min(Number(seconds) || 4, 5))); fd.append('aspect', ratio || '9:16');
    if (image) fd.append('image', image, image.name || 'bild.jpg');
    const signal = say && say.signal;
    const r = await fetch(`${url}/generate`, { method: 'POST', headers: colabHdr(), body: fd, signal });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.detail || `Colab svarade ${r.status}`);
    const untrack = colabCancelable(j.jobId, say);
    try {
    say(`Colab jobbar…${j.note ? ' ' + j.note : ''} Ett klipp tar ofta 5–12 min på en T4.`);
    for (;;) {
      await new Promise((res) => setTimeout(res, 5000));
      if (signal && signal.aborted) throw cancelledErr();
      const s = await fetch(`${url}/status/${j.jobId}`, { headers: colabHdr() }).then((x) => x.json()).catch(() => null);
      if (!s) throw new Error('Colab svarar inte längre (stängd flik?).');
      if (s.status === 'cancelled') throw cancelledErr();
      if (s.status === 'error') throw new Error(`Colab misslyckades: ${s.error || ''}`);
      if (s.status === 'done') {
        const blob = await fetch(url + s.url, { headers: colabHdr(), signal }).then((x) => x.blob());
        return { name: `colab-${j.jobId}.mp4`, url: URL.createObjectURL(blob), blob, engineName: 'Colab / Kaggle (egen GPU) · Wan 2.1 1.3B' };
      }
      say(`Colab ${s.status === 'queued' ? 'i kö' : 'renderar'}… ${s.elapsed || 0} s`);
    }
    } finally { untrack(); }
  }
  // own-GPU job: Avbryt (job card or tool) and 'Stoppa alla jobb' call POST /cancel/{id} on the engine
  function colabCancelable(id, say) {
    const cancel = () => fetch(`${colabCfg().url}/cancel/${id}`, { method: 'POST', headers: colabHdr(), signal: AbortSignal.timeout(8000) }).catch(() => null);
    if (say && say.setCancel) say.setCancel(cancel);
    if (say) say.cancel = cancel;
    return say && say.setCancel ? () => {} : track('Egen GPU', () => { if (say && say.abort) say.abort(); return cancel(); }); // composer jobs are already tracked
  }

  // ---- Colab-verktyg: bild, sång/instrumental, låttext, auto-klipp, lipsync, artistlista + ansiktsbyte ----
  async function colabJob(path, fd, say, onStatus) {
    const { url } = colabCfg(); const signal = say && say.signal;
    const r = await fetch(`${url}${path}`, { method: 'POST', headers: colabHdr(), body: fd, signal });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.detail || `Colab svarade ${r.status}`);
    if (!j.jobId) return j;
    const untrack = colabCancelable(j.jobId, say);
    try {
      if (onStatus) onStatus(null, j);
      for (;;) {
        await new Promise((res) => setTimeout(res, 3000));
        if (signal && signal.aborted) throw cancelledErr();
        const s = await fetch(`${url}/status/${j.jobId}`, { headers: colabHdr() }).then((x) => x.json()).catch(() => null);
        if (!s) throw new Error('Colab svarar inte längre (stängd flik?).');
        if (s.status === 'cancelled') throw cancelledErr();
        if (s.status === 'error') throw new Error(s.error || 'Colab misslyckades');
        if (s.status === 'done') {
          const files = await Promise.all(s.files.map(async (f) => { const b = await fetch(url + f.url, { headers: colabHdr(), signal }).then((x) => x.blob()); return { name: f.name, blob: b, url: URL.createObjectURL(b) }; }));
          return { ...s, files };
        }
        if (onStatus) onStatus(s, j); else say(`${s.status === 'queued' ? 'I kö' : 'Jobbar'}… ${s.elapsed || 0} s`);
      }
    } finally { untrack(); }
  }
  const ROSTER_KEY = 'kino.colab.roster';
  const rosterLocal = () => { try { return JSON.parse(localStorage.getItem(ROSTER_KEY) || '[]'); } catch { return []; } };
  const rosterSave = (l) => localStorage.setItem(ROSTER_KEY, JSON.stringify(l));
  const rosterServer = {}; // local id -> server id (this Colab session only)
  const shrink = (file) => new Promise((res) => { const img = new Image(); img.onload = () => { const k = Math.min(1, 640 / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = img.width * k; c.height = img.height * k; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', 0.85)); }; img.src = URL.createObjectURL(file); });
  const dataBlob = (d) => fetch(d).then((r) => r.blob());
  async function rosterSync() {
    const { url } = colabCfg();
    const live = await fetch(`${url}/roster`, { headers: colabHdr() }).then((x) => x.json()).catch(() => []);
    const ids = new Set(live.map((a) => a.id));
    for (const a of rosterLocal()) {
      if (rosterServer[a.id] && ids.has(rosterServer[a.id])) continue;
      const fd = new FormData(); fd.append('name', a.name); fd.append('consent', 'true');
      for (const [i, p] of a.photos.entries()) fd.append('photos', await dataBlob(p), `foto${i}.jpg`);
      const r = await fetch(`${url}/roster`, { method: 'POST', headers: colabHdr(), body: fd }).then((x) => x.json()).catch(() => ({}));
      if (r.id) rosterServer[a.id] = r.id;
    }
  }
  function colabTools() {
    const outBox = (files) => h('div', { class: 'colab-out' }, ...files.map((f) => {
      const ext = f.name.split('.').pop();
      const media = ext === 'mp4' ? h('video', { src: f.url, controls: true, playsinline: true, style: 'max-width:100%' }) : ext === 'png' ? h('img', { src: f.url, style: 'max-width:100%' }) : (ext === 'mp3' || ext === 'wav') ? h('audio', { src: f.url, controls: true }) : null;
      return h('div', {}, media, h('a', { href: f.url, download: `kino-${f.name}`, class: 'meta' }, `Ladda ned ${f.name}`));
    }));
    const tool = (title, sub, inputs, btnText, run) => {
      const st = h('div', { class: 'meta' }); const out = h('div');
      const stop = h('button', { type: 'button', class: 'text cancel', hidden: true }, 'Avbryt');
      const btn = h('button', { type: 'button', class: 'btn colab-need', onclick: async () => {
        const ac = new AbortController(); let done = false;
        const say = (t, err) => { if (ac.signal.aborted && !done) return; st.textContent = t; st.classList.toggle('err', Boolean(err)); };
        say.signal = ac.signal; say.abort = () => ac.abort();
        stop.onclick = async () => { stop.disabled = true; stop.textContent = 'Avbryter…'; ac.abort(); if (say.cancel) await say.cancel(); };
        btn.disabled = true; stop.hidden = false; stop.disabled = false; stop.textContent = 'Avbryt'; out.innerHTML = ''; say('Skickar…');
        try { const r = await run(say); if (ac.signal.aborted) throw cancelledErr(); if (r) { out.append(outBox(r.files)); if (r.extra) out.append(r.extra); say('Klart.'); } }
        catch (e) { done = true; if (e.cancelled || ac.signal.aborted) { st.textContent = 'Avbrutet. Jobbet stoppades på motorn.'; st.classList.remove('err'); } else say(e.message, true); }
        finally { done = true; stop.hidden = true; btn.disabled = !st.closest('.colab').classList.contains('on'); }
      } }, btnText);
      return h('section', { class: 'cgroup' }, h('h3', {}, title, h('small', {}, sub)), ...inputs, h('div', { class: 'toolbtns' }, btn, stop), st, out);
    };
    const file = (label, accept, multiple) => { const i = h('input', { type: 'file', accept, multiple: Boolean(multiple) }); return { el: field(label, i, true), i }; };
    const num = (v) => h('input', { type: 'number', value: v, min: 0, step: 'any', style: 'width:6em' });
    const aspectSel = () => select([['9:16', '9:16'], ['16:9', '16:9'], ['1:1', '1:1']], '9:16');
    const need = (f, msg) => { if (!f) throw new Error(msg); return f; };
    // Bild: välj modell (öppna vikter, laddas en i taget i Colab)
    const IMG_MODELS = [['sdxl', 'SDXL-Turbo (snabbast)'], ['flux3klein', 'FLUX 3 Image Klein (kräver HF_TOKEN)'], ['flux2klein', 'FLUX.2 klein 4B'], ['flux1schnell', 'FLUX.1 schnell'],
      ['qwen21', 'Qwen-Image 2.1 (långsam, bäst text)'], ['qwen2512', 'Qwen-Image 2512'], ['zimage', 'Z-Image Turbo'], ['ernie', 'ERNIE-Image Turbo']];
    const iP = h('input', { type: 'text', placeholder: 'Beskriv en bild' }); const iA = aspectSel(); const iM = select(IMG_MODELS, 'flux2klein');
    // NSFW (18+): bara synlig i KINO:s NSFW-läge, bara text-till-bild, aldrig foton på riktiga personer, delas aldrig automatiskt
    const nsfwToggle = (text) => {
      const i = h('input', { type: 'checkbox' }); const wrap = h('label', { class: 'meta' }, i, text);
      const sync = () => { wrap.hidden = st.lane !== 'nsfw'; if (wrap.hidden) i.checked = false; };
      i.onchange = () => { if (i.checked && !confirm('Bekräfta att du är minst 18 år och att bilden bara är för dig (den delas aldrig automatiskt).')) i.checked = false; };
      document.addEventListener('kino-lane', sync); sync(); return { i, wrap };
    };
    const { i: iN, wrap: iNWrap } = nsfwToggle(' NSFW (18+) – bara text till bild, inga foton på riktiga personer. Minderåriga blockeras alltid och ansikten under 21 avvisas.');
    const tImg = tool('Bild', 'Välj modell. Första gången laddas modellen ner (kan ta flera minuter).', [field('Prompt', iP, true), field('Modell', iM), field('Format', iA), iNWrap], 'Skapa bild', async (say) => {
      if (minorText(iP.value)) throw new Error(REFUSE);
      const fd = new FormData(); fd.append('prompt', need(iP.value.trim(), 'Skriv en prompt.')); fd.append('aspect', iA.value); fd.append('model', iM.value);
      if (iN.checked && st.lane === 'nsfw') fd.append('nsfw', 'true');
      const r = await colabJob('/image', fd, say);
      return { ...r, extra: editBtn(r) };
    });
    // Redigera bild (Qwen-Image-Edit / FLUX.2 klein)
    const eI = file('Bild', 'image/*'); const eP = h('input', { type: 'text', placeholder: 'Vad ska ändras? T.ex. "byt bakgrund till en strand"' });
    const eM = select([['qwenedit', 'Qwen-Image-Edit 2511'], ['flux2klein', 'FLUX.2 klein 4B']], 'qwenedit');
    let eSrc = null; // { id, url } bild som Colab skapat i denna session
    const eSrcBox = h('div', { class: 'meta' });
    const setSrc = (src) => {
      eSrc = src; eSrcBox.innerHTML = '';
      if (src) eSrcBox.append(h('img', { src: src.url, style: 'max-width:160px;display:block' }), 'Redigerar bilden KINO skapade. ', h('button', { type: 'button', class: 'btn', onclick: () => setSrc(null) }, 'Använd egen bild i stället'));
    };
    const { i: eN, wrap: eNWrap } = nsfwToggle(' NSFW (18+) – bara bilder KINO skapat i denna Colab-session, aldrig uppladdade foton. Ansikten under 21 avvisas.');
    const tEdit = tool('Redigera bild', 'Bild + instruktion. Personer under 21 nekas.', [eSrcBox, eI.el, field('Instruktion', eP, true), field('Modell', eM), eNWrap], 'Redigera', async (say) => {
      if (minorText(eP.value)) throw new Error(REFUSE);
      const nsfw = eN.checked && st.lane === 'nsfw';
      if (nsfw && !eSrc) throw new Error('Uppladdade foton kan inte redigeras i NSFW – välj en bild KINO skapat');
      const fd = new FormData(); fd.append('prompt', need(eP.value.trim(), 'Skriv en instruktion.')); fd.append('model', eM.value);
      if (eSrc) fd.append('source_id', eSrc.id); else fd.append('image', need(eI.i.files[0], 'Välj en bild.'));
      if (nsfw) fd.append('nsfw', 'true');
      const r = await colabJob('/edit', fd, say);
      return { ...r, extra: editBtn(r) };
    });
    function editBtn(r) {
      const f = (r.files || []).find((x) => x.name.endsWith('.png'));
      return f ? h('button', { type: 'button', class: 'btn', onclick: () => { setSrc({ id: r.id, url: f.url }); tEdit.scrollIntoView({ behavior: 'smooth' }); } }, 'Redigera') : null;
    }
    // Skala upp (Real-ESRGAN x4)
    const uI = file('Bild', 'image/*');
    const tUp = tool('Skala upp', 'Real-ESRGAN x4 (max 768 px in, 4x ut)', [uI.el], 'Skala upp', async (say) => {
      const fd = new FormData(); fd.append('image', need(uI.i.files[0], 'Välj en bild.')); return colabJob('/upscale', fd, say);
    });
    // Sång / instrumental (Demucs)
    const sA = file('Låt', 'audio/*');
    const tStem = tool('Sång / instrumental', 'Demucs: delar låten i två spår', [sA.el], 'Dela låten', async (say) => {
      const fd = new FormData(); fd.append('audio', need(sA.i.files[0], 'Välj en låt.')); return colabJob('/stems', fd, say);
    });
    // Låttext (Whisper)
    const lA = file('Låt', 'audio/*'); const lV = h('input', { type: 'checkbox', checked: true }); const lL = select([['sv', 'Svenska'], ['en', 'Engelska'], ['', 'Auto']], 'sv');
    const tLyr = tool('Låttext', 'Whisper: text med tidskoder (SRT)', [lA.el, field('Språk', lL), h('label', {}, lV, ' Isolera sången först (Demucs)')], 'Hämta låttext', async (say) => {
      const fd = new FormData(); fd.append('audio', need(lA.i.files[0], 'Välj en låt.')); fd.append('language', lL.value); fd.append('vocals', lV.checked ? 'true' : 'false');
      const r = await colabJob('/lyrics', fd, say);
      return { ...r, extra: h('textarea', { rows: 8, style: 'width:100%' }, (r.data && r.data.srt) || 'Ingen sång hittades.') };
    });
    // Auto-klipp
    const aS = file('Låt', 'audio/*'); const aC = file('Dina klipp (flera)', 'video/*', true); const aE = select([['1', 'varje slag'], ['2', 'vartannat'], ['4', 'var 4:e'], ['8', 'var 8:e']], '4'); const aSt = num(0); const aLen = num(30); const aR = aspectSel();
    const tCut = tool('Auto-klipp till låt', 'Klipper dina klipp i takt, låten spelas utan hopp', [aS.el, aC.el, field('Byt klipp', aE), field('Start (s)', aSt), field('Längd (s)', aLen), field('Format', aR)], 'Klipp ihop', async (say) => {
      const fd = new FormData(); fd.append('audio', need(aS.i.files[0], 'Välj en låt.'));
      need(aC.i.files.length, 'Välj minst ett klipp.'); [...aC.i.files].forEach((f) => fd.append('clips', f));
      fd.append('every', aE.value); fd.append('start', aSt.value); fd.append('seconds', aLen.value); fd.append('aspect', aR.value); return colabJob('/autocut', fd, say);
    });
    // Lipsync (LatentSync 1.5)
    const pV = file('Video med ansiktet', 'video/*'); const pA = file('Låt / ljud', 'audio/*'); const pS = num(0); const pE = num(10); const pVoc = h('input', { type: 'checkbox', checked: true }); const pC = h('input', { type: 'checkbox' });
    const tLip = tool('Lipsync', 'LatentSync 1.5, bara era egna artister / AI-figurer', [pV.el, pA.el, field('Från (s)', pS), field('Till (s)', pE), h('label', {}, pVoc, ' Använd isolerad sång (Demucs) som input – originallåten läggs på efteråt'), h('label', { class: 'wide' }, pC, ' Jag intygar att personen i klippet är vår egen artist eller AI-figur och har gett samtycke')], 'Kör lipsync', async (say) => {
      if (!pC.checked) throw new Error('Kryssa i samtycket först.');
      const fd = new FormData(); fd.append('video', need(pV.i.files[0], 'Välj en video.')); fd.append('audio', need(pA.i.files[0], 'Välj ljud.'));
      fd.append('start', pS.value); fd.append('end', pE.value); fd.append('vocals', pVoc.checked ? 'true' : 'false'); fd.append('consent', 'true'); return colabJob('/lipsync', fd, say);
    });
    // Artistlista + ansiktsbyte
    const list = h('div', { class: 'chips' });
    const renderList = () => { list.innerHTML = ''; rosterLocal().forEach((a) => list.append(h('span', { class: 'chip' }, h('span', { class: 'cn' }, a.name), h('span', { class: 'ch' }, a.ai ? `AI-genererad ${a.added}` : `samtycke ${a.added}`), a.ai && a.persona ? h('button', { type: 'button', class: 'text', onclick: () => personaToImage(a) }, 'Skapa bilder med artisten') : null, h('button', { type: 'button', 'aria-label': 'Ta bort', onclick: () => { rosterSave(rosterLocal().filter((x) => x.id !== a.id)); renderList(); } }, '×')))); };
    const rN = h('input', { type: 'text', placeholder: 'Namn, t.ex. Ida Stina' }); const rP = file('Referensfoton', 'image/*', true); const rC = h('input', { type: 'checkbox' });
    const tRos = tool('Artistlista', 'Bara artister här kan bytas in. Sparas i din webbläsare och Colab-sessionen', [list, field('Namn', rN, true), rP.el, h('label', { class: 'wide' }, rC, ' Personen har gett samtycke')], 'Lägg till artist', async (say) => {
      if (!rC.checked) throw new Error('Kryssa i samtycket först.');
      const name = need(rN.value.trim(), 'Skriv ett namn.'); need(rP.i.files.length, 'Välj minst ett foto.');
      const photos = await Promise.all([...rP.i.files].slice(0, 4).map(shrink));
      const a = { id: Math.random().toString(36).slice(2, 10), name, photos, consent: true, added: new Date().toLocaleString('sv-SE') };
      const fd = new FormData(); fd.append('name', name); fd.append('consent', 'true'); for (const [i, p] of photos.entries()) fd.append('photos', await dataBlob(p), `foto${i}.jpg`);
      const r = await fetch(`${colabCfg().url}/roster`, { method: 'POST', headers: colabHdr(), body: fd }); const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || 'Kunde inte lägga till');
      rosterServer[a.id] = j.id; rosterSave([...rosterLocal(), a]); renderList(); rN.value = ''; rP.i.value = ''; rC.checked = false; say(`${name} tillagd ${a.added}. ${j.licenseNote || ''}`); return null;
    });
    renderList();
    const fM = file('Video eller bild', 'video/*,image/*'); const fS = num(0); const fL = num(0); const map = h('div', { class: 'chips' }); let scan = null; const sels = [];
    const scanBtn = h('button', { type: 'button', class: 'btn colab-need', onclick: async () => {
      map.innerHTML = ''; sels.length = 0; scan = null;
      try {
        await rosterSync();
        const fd = new FormData(); fd.append('media', need(fM.i.files[0], 'Välj en video eller bild.'));
        const r = await fetch(`${colabCfg().url}/faces`, { method: 'POST', headers: colabHdr(), body: fd }); const j = await r.json(); if (!r.ok) throw new Error(j.detail);
        scan = j.scanId;
        j.faces.forEach((f) => { const s2 = select([['', '– behåll –'], ...rosterLocal().filter((a) => rosterServer[a.id]).map((a) => [rosterServer[a.id], a.name])], ''); sels.push([f.index, s2]); map.append(h('label', { class: 'chip' }, h('img', { src: f.thumb, style: 'height:56px;border-radius:6px' }), s2)); });
      } catch (e) { map.append(h('span', { class: 'meta err' }, e.message)); }
    } }, 'Hitta ansikten');
    const tSwap = tool('Ansiktsbyte', 'Upp till 4 ansikten, välj en artist ur listan för varje. Endast icke-kommersiellt (InsightFace-licens)', [fM.el, scanBtn, map, field('Start (s)', fS), field('Längd (s, 0 = hela)', fL)], 'Byt ansikten', async (say) => {
      if (!scan) throw new Error('Tryck "Hitta ansikten" först.');
      const m = {}; sels.forEach(([i, s2]) => { if (s2.value) m[i] = s2.value; });
      const fd = new FormData(); fd.append('scan_id', scan); fd.append('mapping', JSON.stringify(m)); fd.append('start', fS.value); fd.append('length', fL.value); return colabJob('/swap', fd, say);
    });

    // Byt röst (Seed-VC): bara röster ur den samtyckta röstlistan
    const recorder = (label) => {
      let rec = null; let chunks = []; let t0 = 0; let tick = null; const out = { blob: null };
      const info = h('span', { class: 'meta' }, ''); const play = h('audio', { controls: true, hidden: true, style: 'max-width:100%' });
      const btn = h('button', { type: 'button', class: 'btn', onclick: async () => {
        if (rec && rec.state === 'recording') { rec.stop(); return; }
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          rec = new MediaRecorder(stream); chunks = [];
          rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
          rec.onstop = () => { stream.getTracks().forEach((x) => x.stop()); clearInterval(tick); out.blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' }); play.src = URL.createObjectURL(out.blob); play.hidden = false; btn.textContent = `● ${label}`; info.textContent = `Inspelat ${Math.round((Date.now() - t0) / 1000)} s`; };
          rec.start(1000); t0 = Date.now(); btn.textContent = '■ Stoppa';
          tick = setInterval(() => { const s = Math.round((Date.now() - t0) / 1000); info.textContent = `Spelar in… ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; if (s >= 600) rec.stop(); }, 500);
        } catch (e) { info.textContent = 'Kunde inte starta mikrofonen: ' + e.message; }
      } }, `● ${label}`);
      out.el = h('div', { class: 'wide' }, btn, ' ', info, play); out.clear = () => { out.blob = null; play.hidden = true; info.textContent = ''; }; return out;
    };
    const recExt = (b) => (b.type.includes('ogg') ? 'ogg' : b.type.includes('mp4') ? 'm4a' : 'webm');
    let voiceList = [];
    const vList = h('div', { class: 'chips' }); const vSel = select([['', '– välj röst –']], '');
    const renderVoices = () => {
      vList.innerHTML = ''; const cur = vSel.value; vSel.innerHTML = ''; vSel.append(h('option', { value: '' }, '– välj röst ur röstlistan –'));
      voiceList.forEach((v) => {
        const stt = v.status === 'ready' ? `samtycke ${v.added}${v.finetuned ? ' · finjusterad' : ''}` : v.status === 'error' ? 'träning misslyckades' : 'tränas…';
        vList.append(h('span', { class: 'chip' }, h('span', { class: 'cn' }, v.name), h('span', { class: 'ch' }, stt), h('button', { type: 'button', 'aria-label': 'Ta bort', onclick: async () => { if (!confirm(`Ta bort rösten ${v.name} från motorn?`)) return; await fetch(`${colabCfg().url}/voices/${v.id}`, { method: 'DELETE', headers: colabHdr() }).catch(() => {}); voicesSync(); } }, '×')));
        if (v.status === 'ready') vSel.append(h('option', { value: v.id }, v.name));
      });
      vSel.value = [...vSel.options].some((o) => o.value === cur) ? cur : ''; agentPick(vSel, 'voice');
    };
    async function voicesSync() { voiceList = await fetch(`${colabCfg().url}/voices`, { headers: colabHdr() }).then((x) => (x.ok ? x.json() : [])).catch(() => []); renderVoices(); }
    const vN = h('input', { type: 'text', placeholder: 'Namn, t.ex. Ida Stina' }); const vF = file('Träningsljud (1–10 min totalt, mp3/wav/m4a)', 'audio/*', true);
    const vRec = recorder('Spela in träningsljud'); const vC = h('input', { type: 'checkbox' }); const vFt = h('input', { type: 'checkbox' });
    const vBar = h('progress', { max: 100, value: 0, style: 'width:100%', hidden: true });
    const tVoice = tool('🎤 Röstlista', 'Bara röster här kan användas vid röstbyte. Gäller denna Colab/Kaggle-session', [vList, field('Namn', vN, true), vF.el, vRec.el,
      h('label', {}, vFt, ' Finjustera modellen på rösten (bättre likhet, ca 10–20 min extra)'),
      h('label', { class: 'wide' }, vC, ' Personen har gett samtycke till att rösten spelas in och används för röstbyte'), vBar], 'Lägg till röst', async (say) => {
      if (!vC.checked) throw new Error('Kryssa i samtycket först.');
      const name = need(vN.value.trim(), 'Skriv ett namn.');
      const fd = new FormData(); fd.append('name', name); fd.append('consent', 'true'); fd.append('finetune', vFt.checked ? 'true' : 'false');
      [...vF.i.files].forEach((f) => fd.append('audio', f)); if (vRec.blob) fd.append('audio', vRec.blob, `inspelning.${recExt(vRec.blob)}`);
      need(vF.i.files.length || vRec.blob, 'Välj ljudfiler eller spela in minst 1 minut.');
      vBar.hidden = false; vBar.value = 0;
      await colabJob('/voices', fd, say, (s, j) => { if (!s) { voicesSync(); return say(`${j.name}: ${Math.round(j.seconds / 6) / 10} min ljud mottaget, tränar…`); } const p = s.progress || {}; if (p.total) vBar.value = Math.round((p.done / p.total) * 100); say(`${p.step || 'I kö'} · ${s.elapsed || 0} s`); });
      vBar.value = 100; vN.value = ''; vF.i.value = ''; vRec.clear(); vC.checked = false; await voicesSync(); say(`${name} är klar att använda.`); return null;
    });
    const sSrc = select([['file', 'Ljud- eller videofil'], ['rec', 'Spela in i webbläsaren'], ['url', 'Länk (direkt fil eller egen Suno-låt)']], 'file');
    const sF = file('Fil (mp3, wav, m4a, mp4, mov…)', 'audio/*,video/*'); const sRec = recorder('Spela in'); const sU = h('input', { type: 'url', placeholder: 'https://suno.com/song/… eller https://…/lat.mp3' });
    const sUf = field('Länk', sU, true);
    const showSrc = () => { sF.el.hidden = sSrc.value !== 'file'; sRec.el.hidden = sSrc.value !== 'rec'; sUf.hidden = sSrc.value !== 'url'; }; sSrc.onchange = showSrc; showSrc();
    const sP = h('input', { type: 'number', value: 0, min: -12, max: 12, step: 1, style: 'width:6em' }); const sSep = h('input', { type: 'checkbox', checked: true }); const sMux = h('input', { type: 'checkbox', checked: true }); const sR = h('input', { type: 'checkbox' });
    const sBar = h('progress', { max: 100, value: 0, style: 'width:100%', hidden: true });
    const tVsw = tool('🎙️ Byt röst', 'Seed-VC: sången byts till en röst ur din röstlista och mixas med instrumentalen. Inga kändis- eller Spotify-röster', [field('Källa', sSrc), sF.el, sRec.el, sUf, field('Röst', vSel),
      field('Tonart (halvtoner)', sP), h('label', {}, sSep, ' Separera sången först (Demucs) – avmarkera om ljudet bara är sång/tal'), h('label', {}, sMux, ' Lägg tillbaka nya ljudet på videon (om källan är video)'),
      h('label', { class: 'wide' }, sR, ' Jag äger låten/videon eller har rätt att använda den'), sBar], 'Byt röst', async (say) => {
      const vid = need(vSel.value, 'Välj en röst ur röstlistan (lägg till en ovan).'); if (!sR.checked) throw new Error('Intyga att du har rätt att använda låten/videon.');
      const fd = new FormData(); fd.append('voice_id', vid); fd.append('rights', 'true'); fd.append('pitch', sP.value || '0'); fd.append('separate', sSep.checked ? 'true' : 'false'); fd.append('mux', sMux.checked ? 'true' : 'false');
      if (sSrc.value === 'file') fd.append('media', need(sF.i.files[0], 'Välj en fil.'));
      else if (sSrc.value === 'rec') fd.append('media', need(sRec.blob, 'Spela in något först.'), `inspelning.${sRec.blob ? recExt(sRec.blob) : 'webm'}`);
      else { const u = need(sU.value.trim(), 'Klistra in en länk.'); if (/spotify\.|music\.apple\.|youtube\.|youtu\.be|tidal\.|deezer\./i.test(u)) throw new Error('Strömningstjänster stöds inte. Använd en egen fil eller en Suno-låt du äger.'); fd.append('url', u); }
      sBar.hidden = false; sBar.value = 0;
      const r = await colabJob('/voiceswap', fd, say, (s) => { if (!s) return say('Startat…'); const p = s.progress || {}; if (p.total) sBar.value = Math.round((p.done / p.total) * 100); say(`${s.status === 'queued' ? 'I kö' : (p.step || 'Jobbar')} · ${s.elapsed || 0} s`); });
      sBar.value = 100; return r;
    });
    // Karaktärsbyte (Openjutsu: ComfyUI + MiniMax H3 + SAM 3.1) – bara artister ur artistlistan
    const oV = file('Video (huvudpersonen byts)', 'video/*'); const oA = select([['', '– välj artist –']], ''); const oS = num(0);
    const oL = h('input', { type: 'number', value: 5, min: 2, max: 6, step: 0.5, style: 'width:6em' }); const oR = select([['480p', '480p (rekommenderas på T4)'], ['720p', '720p (långsammare)']], '480p');
    const oLip = h('input', { type: 'checkbox', checked: true }); const oC = h('input', { type: 'checkbox' }); const oBar = h('progress', { max: 100, value: 0, style: 'width:100%', hidden: true });
    const oFill = () => { const cur = oA.value; oA.innerHTML = ''; [['', '– välj artist –'], ...rosterLocal().filter((a) => rosterServer[a.id]).map((a) => [rosterServer[a.id], a.name])].forEach(([v, t]) => oA.append(h('option', { value: v }, t))); oA.value = cur; agentPick(oA, 'artist'); };
    oA.onfocus = oFill;
    const tOj = tool('🎭 Karaktärsbyte (Openjutsu)', 'Huvudpersonen i klippet byts mot en artist ur artistlistan – kamera, rörelse och ljud behålls. Max 6 s. Experimentellt på T4: räkna med 30–90 min', [oV.el, field('Artist (ur artistlistan)', oA),
      field('Start (s)', oS), field('Längd (s, 2–6)', oL), field('Upplösning', oR), h('label', {}, oLip, ' Munnen följer ljudet (lipsync)'),
      h('label', { class: 'wide' }, oC, ' Jag intygar att artisten har gett samtycke och att jag har rätt att använda videon'), oBar], 'Byt karaktär', async (say) => {
      await rosterSync(); oFill();
      const aid = need(oA.value, 'Välj en artist ur artistlistan (lägg till en ovan).'); if (!oC.checked) throw new Error('Kryssa i samtycket först.');
      const len = Number(oL.value); if (!(len >= 2 && len <= 6)) throw new Error('Längden måste vara 2–6 s.');
      const fd = new FormData(); fd.append('video', need(oV.i.files[0], 'Välj en video.')); fd.append('artist_id', aid); fd.append('start', oS.value || '0'); fd.append('length', String(len));
      fd.append('resolution', oR.value); fd.append('lipsync', oLip.checked ? 'true' : 'false');
      oBar.hidden = false; oBar.value = 0;
      const r = await colabJob('/openjutsu/swap', fd, say, (st) => { if (!st) return say('Startat…'); const p = st.progress || {}; if (p.total) oBar.value = Math.round((p.done / p.total) * 100); say(`${st.status === 'queued' ? 'I kö' : (p.step || 'Jobbar')} · ${Math.round((st.elapsed || 0) / 60)} min`); });
      oBar.value = 100; return r;
    });
    tOj.id = 'tool-openjutsu';
    const tVoices = h('div', { id: 'tool-voice' }, tVoice, tVsw);
    tLip.id = 'tool-lipsync'; tSwap.id = 'tool-faceswap'; tRos.id = 'tool-roster'; tStem.id = 'tool-stems'; tLyr.id = 'tool-lyrics'; tCut.id = 'tool-autocut'; tUp.id = 'tool-upscale';
    // Bilder + låt -> musikvideo (en knapp)
    const mI = file('Bilder (en eller flera)', 'image/*', true); const mS = file('Låt', 'audio/*');
    const mSec = select([['start', 'Från början'], ['custom', 'Egen start'], ['chorus', 'Refrängen (gissas)']], 'start'); const mSt = num(0); const mLen = num(30); const mR = aspectSel();
    const mK = h('input', { type: 'checkbox' }); const mLs = h('div', { class: 'chips' }); const mC = h('input', { type: 'checkbox' });
    const stField = field('Start (s)', mSt); stField.hidden = true; mSec.onchange = () => { stField.hidden = mSec.value !== 'custom'; };
    const fmt = (sec) => (sec >= 90 ? `${Math.round(sec / 60)} min` : `${Math.round(sec)} s`);
    const eta = h('div', { class: 'meta' });
    const updEta = () => { const n = mI.i.files.length; const shots = Math.min(24, Math.max(2, Math.round((Number(mLen.value) || 30) / 2.5))); eta.textContent = n ? `${n} bilder → ca ${shots} klipp. Beräknad tid på T4: ca ${fmt(shots * 150 + (mK.checked ? 120 : 0) + 30)}${mLs.querySelector('input:checked') ? ' + lipsync' : ''}.` : ''; };
    mI.i.onchange = () => { mLs.innerHTML = ''; [...mI.i.files].forEach((f, i) => mLs.append(h('label', { class: 'chip' }, h('img', { src: URL.createObjectURL(f), style: 'height:48px;border-radius:6px' }), h('input', { type: 'checkbox', value: String(i), onchange: updEta }), ' lipsync'))); updEta(); };
    mLen.oninput = updEta; mK.onchange = updEta;
    const bar = h('progress', { max: 100, value: 0, style: 'width:100%', hidden: true });
    const tMv = tool('🎵 Bilder + låt → musikvideo', 'En knapp: klipp i takt, låten utan hopp, mobilvideo-look', [mI.el, mS.el, field('Del av låten', mSec), stField, field('Längd (s)', mLen), field('Format', mR),
      h('label', {}, mK, ' Karaoketext (Whisper)'), h('div', { class: 'meta' }, 'Lipsync på bilder (valfritt, kräver lipsync-cellen):'), mLs,
      h('label', { class: 'wide' }, mC, ' Jag intygar att personen i klippet är vår egen artist eller AI-figur och har gett samtycke'), eta, bar], 'Skapa musikvideo', async (say) => {
      need(mI.i.files.length, 'Välj minst en bild.'); need(mS.i.files[0], 'Välj en låt.');
      const ls = [...mLs.querySelectorAll('input:checked')].map((x) => x.value);
      if (ls.length && !mC.checked) throw new Error('Kryssa i samtycket för lipsync.');
      const fd = new FormData(); [...mI.i.files].forEach((f) => fd.append('images', f)); fd.append('audio', mS.i.files[0]);
      fd.append('section', mSec.value === 'chorus' ? 'chorus' : 'start'); fd.append('start', mSec.value === 'custom' ? mSt.value : '0'); fd.append('seconds', mLen.value); fd.append('aspect', mR.value);
      fd.append('karaoke', mK.checked ? 'true' : 'false'); fd.append('lipsync', ls.join(',')); fd.append('consent', mC.checked ? 'true' : '');
      bar.hidden = false; bar.value = 0; let total = 0;
      const r = await colabJob('/musicvideo', fd, say, (st, j) => {
        if (!st) { total = j.etaSeconds; return say(`Startat: ca ${j.shots} klipp, beräknad tid ca ${fmt(j.etaSeconds)}.`); }
        const p = st.progress || {}; if (p.total) bar.value = Math.round((p.done / p.total) * 90);
        say(`${st.status === 'queued' ? 'I kö' : (p.step || 'Jobbar')} · ${fmt(st.elapsed || 0)}${total ? ` av ca ${fmt(total)}` : ''}${st.info && st.info.cachedShots ? ` · ${st.info.cachedShots} klipp från cache` : ''}`);
      });
      bar.value = 100; return r;
    });
    tMv.classList.add('hl'); tMv.id = 'tool-mv';
    const box = h('div', { class: 'colab-tools' }, tMv, h('div', { class: 'meta' }, 'Bild till video: välj Colab som motor på Video-sidan och lägg en första bildruta – den används (SVD).'), tImg, tEdit, tUp, tStem, tLyr, tCut, tLip, tRos, tSwap, tOj, tVoices);
    return { box, onState: (on, feats) => { box.querySelectorAll('.colab-need').forEach((b) => { b.disabled = !on; }); tLip.hidden = on && feats && !feats.includes('lipsync'); tSwap.hidden = on && feats && !feats.includes('faceswap'); tRos.hidden = on && feats && !feats.includes('faceswap') && !feats.includes('openjutsu'); tOj.hidden = !(on && feats && feats.includes('openjutsu')); tMv.hidden = on && feats && !feats.includes('musicvideo'); tVoices.hidden = on && feats && !feats.includes('voiceswap'); if (on) { rosterSync().then(oFill).catch(() => {}); voicesSync(); } } };
  }
  function colabPanel(onChange) {
    const c = colabCfg();
    const dot = h('span', { class: 'colab-dot', style: 'display:inline-block;width:10px;height:10px;border-radius:50%;background:#888;margin-right:6px' });
    const txt = h('span', {}, 'Inte inställd');
    const url = h('input', { type: 'url', placeholder: 'https://….trycloudflare.com', value: c.url });
    const tok = h('input', { type: 'password', placeholder: 'Token från Colab', value: c.token, autocomplete: 'off' });
    const set = (col, t) => { dot.style.background = col; txt.textContent = t; };
    const tools = colabTools();
    async function check() {
      set('#cc0', 'Kollar…'); const r = await colabHealth();
      if (r.state === 'on') set('#2a2', `Online · ${r.info.gpu} · kö ${r.info.queue}`);
      else if (r.state === 'auth') set('#c33', 'Fel token');
      else if (r.state === 'off') set('#c33', 'Offline – använder gratismotorerna');
      else set('#888', 'Inte inställd');
      const on = r.state === 'on'; d.classList.toggle('on', on); if (on) d.open = true; tools.onState(on, on ? r.info.features : null);
      onChange(on);
    }
    const save = h('button', { type: 'button', class: 'btn', onclick: () => { localStorage.setItem('kino.colab.url', url.value.trim()); localStorage.setItem('kino.colab.token', tok.value.trim()); check(); } }, 'Spara & testa');
    const clear = h('button', { type: 'button', class: 'btn', onclick: () => { localStorage.removeItem('kino.colab.url'); localStorage.removeItem('kino.colab.token'); url.value = ''; tok.value = ''; check(); } }, 'Rensa');
    const open = h('a', { class: 'btn', href: COLAB_NB, target: '_blank', rel: 'noopener' }, 'Öppna i Colab');
    const kOpen = h('a', { class: 'btn', href: 'https://www.kaggle.com/code', target: '_blank', rel: 'noopener' }, 'Öppna Kaggle');
    const kCopy = h('button', { type: 'button', class: 'btn', onclick: () => { navigator.clipboard && navigator.clipboard.writeText(KAGGLE_NB_GH); kCopy.textContent = 'Länk kopierad'; } }, 'Kopiera Kaggle-länk');
    const kHelp = h('details', { class: 'meta' }, h('summary', {}, 'Colab ansluter inte? Kör samma motor på Kaggle'),
      h('ol', {},
        h('li', {}, 'Gå till kaggle.com → Create → New Notebook.'),
        h('li', {}, 'File → Import Notebook → klistra in länken: ', h('code', { style: 'user-select:all' }, KAGGLE_NB_GH)),
        h('li', {}, 'Settings (högerpanelen): Accelerator → GPU T4 x2, Internet → On (kräver telefonverifierat konto).'),
        h('li', {}, 'Valfritt: Add-ons → Secrets → HF_TOKEN (bara för FLUX 3 Image Klein).'),
        h('li', {}, 'Run All. Klistra in adressen och nyckeln från den gröna rutan här ovanför och tryck Spara & testa.')),
      h('div', { class: 'under' }, kOpen, kCopy));
    const d = h('details', { class: 'clips colab' }, h('summary', {}, h('span', { class: 'ttl' }, dot, 'Colab / Kaggle (egen GPU)'), h('span', { class: 'count' }, txt)),
      h('div', { class: 'clips-body' }, field('URL', url, true), field('Token', tok, true), h('div', { class: 'under' }, save, clear, open),
        h('div', { class: 'meta' }, 'Kör anteckningsboken i Colab eller Kaggle (gratis T4), klistra in URL och token. Sparas bara i den här webbläsaren. Video max 5 s.'), kHelp, tools.box));
    check();
    return d;
  }

  // ---- Färdiga prompter (musikvideo-presets) ----
  const NEG = 'blurry, low quality, distorted faces, extra fingers, warped hands, watermark, logo, text artifacts, flicker, jitter, deformed body, oversaturated';
  const VS = ', vertical 9:16 framing, subject centered with headroom for captions, smooth motion, high detail, no text';
  const PRESETS = [
    { g: 'Färdiga prompter', items: [
      ['Neonnatt i stan', 'Bilfärd genom regnvåt neonstad', 'cinematic night drive through a rain-slick neon city, camera mounted on car hood looking at the singer behind the wheel, magenta and cyan reflections sliding across the windshield, bokeh traffic lights, slow push-in, moody synth atmosphere', 'neon'],
      ['Arenashow', 'Stor scen, publik och ljusshow', 'epic live arena concert, performer on a huge stage with sweeping moving-head lights and haze, crowd of raised hands in silhouette in the foreground, low-angle crane shot rising over the audience, confetti burst on the drop, euphoric energy', 'live'],
      ['Gatuframträdande one-take', 'Rå, obruten tagning på gatan', 'gritty one-take handheld street performance, singer walking toward camera through a busy urban alley at dusk, continuous tracking shot, passersby reacting, sodium streetlights, raw documentary texture, slight film grain', 'standard'],
      ['VHS 90-talshemvideo', 'Nostalgisk camcorder-känsla', '1990s home video shot on a VHS camcorder, friends dancing in a living room, tracking lines, chroma bleed, washed colors, date stamp feel, shaky zooms, warm nostalgic mood', 'vhs'],
      ['Slowmotion-dans', 'Filmisk dans i ultrarapid', 'cinematic slow-motion contemporary dance, dancer in flowing fabric in an empty warehouse, single hard backlight through dust, 120fps feel, fabric and hair floating, slow orbiting camera, emotional and graceful', 'cinematic'],
      ['Ökenroadtrip i gyllene timmen', 'Vägresa, solnedgång och frihet', 'desert road trip at golden hour, vintage convertible on an endless highway, singer standing up in the passenger seat with arms out, lens flares, warm orange light, drone follow then cut to close-up, carefree summer mood', 'cinematic'],
      ['Regnigt tak', 'Melankoli på ett tak i regnet', 'rainy rooftop at night, singer alone under city skyline, heavy rain backlit by a single spotlight, droplets in slow motion, slow dolly around the subject, blue and amber palette, melancholic and intimate', 'cinematic'],
      ['Klubb med strobe', 'Svettig klubbfest med blixtljus', 'packed nightclub party, strobe lights freezing dancers mid-motion, laser beams cutting through haze, handheld camera moving through the crowd, quick beat-synced cuts, red and white light, high energy', 'neon'],
      ['Drömsk skogsfantasi', 'Sagolik skog med ljusstrålar', 'dreamy fantasy forest, soft god rays through mist, floating glowing particles, performer in a flowing gown walking between ancient trees, slow gliding camera, pastel ethereal colors, magical calm', 'dreamy'],
      ['Animemontage', 'Tecknad anime-stil, snabba klipp', 'anime-style music video montage, cel-shaded characters on a train platform at sunset, wind in hair, speed lines, dramatic close-ups of eyes, cherry blossoms, vibrant colors, energetic cuts on the beat', 'anime'],
      ['Svartvit noir', 'Kontrastrik film noir', 'black and white film noir, singer under a single streetlamp in fog, venetian blind shadows, deep contrast, cigarette-free smoky haze, slow push-in, mysterious and elegant', 'bw'],
      ['Festival filmad med mobil', 'Äkta publikklipp från festivalen', 'festival crowd clip filmed on a phone, shaky handheld from inside the audience, stage lights flaring, people singing along, slight digital noise, authentic amateur feel, summer evening sky', 'live'],
      ['Studioframträdande med band', 'Bandet spelar live i studio', 'live studio session with a full band, warm tungsten lighting, wood panels, microphones and amps in frame, slow slider shots between drummer, guitarist and singer, intimate and polished', 'standard'],
      ['Retro 80-tal synthwave', 'Neonsol, rutnät och palmer', 'retro 1980s synthwave aesthetic, neon grid horizon, giant striped sunset, palm silhouettes, chrome sports car, VHS glow, pink and purple palette, slow forward camera movement', 'vhs'],
      ['Episk drönarvy', 'Svepande landskap från ovan', 'epic drone shot over dramatic mountain landscape, performer standing on a cliff edge, camera pulling back and rising to reveal vast valley and clouds, golden light, grand cinematic scale', 'cinematic'],
      ['Lyrikvideo (viral)', 'Text på skärmen över vardagsklipp', 'lyric video style, simple everyday b-roll of a person walking at sunset, clean empty space in the center for large on-screen lyrics, soft natural light, calm steady handheld, minimal and readable', 'standard'],
      ['TikTok-hook första 3 sek', 'Stark öppning direkt på refrängen', 'scroll-stopping opening: extreme close-up of the singer snapping into frame on the first beat, instant whip-pan into a wide shot, bold color, punchy fast cuts in the first three seconds, high energy', 'standard'],
      ['Monokrom mode-look', 'Minimalistisk, en färg', 'minimal one-color fashion look, model in an all-red outfit against a seamless red studio backdrop, sharp editorial lighting, slow controlled poses, graphic composition, high-fashion mood', 'cover'],
      ['Skivomslag i rörelse', 'Levande albumomslag', 'animated album cover, centered portrait in a striking pose, subtle looping motion of hair and light, rich textured background, dramatic studio lighting, iconic composition', 'cover'],
    ] },
    { g: 'Viralt på TikTok', items: [
      ['Publiken sjunger med', 'Hela publiken tar refrängen', 'concert crowd singing the chorus loudly together, camera on stage looking out over thousands of phone lights, performer stepping back to listen, goosebumps moment, warm stage wash', 'live'],
      ['Mikrofonen till publiken', 'Artisten räcker ut micken', 'performer holding the microphone out toward the front row, a fan in the crowd sings the line, camera close on the mic between them then cutting to the cheering crowd, spotlight, joyful', 'live'],
      ['Fan upp på scen', 'Vuxen fan bjuds upp och sjunger', 'adult fan invited up on stage, nervous then confident, singing next to the performer, crowd erupting, handheld phone angle from the audience, emotional surprise', 'stagekid'],
      ['Första lyssningen – reaktion', 'Ärlig reaktion på låten', 'first-listen reaction video, young adult wearing headphones in a cozy bedroom, face lighting up as the beat drops, natural window light, static phone camera, genuine expressions', 'standard'],
      ['Bilsingalong', 'Kompisar sjunger högt i bilen', 'car singalong, group of adult friends in a car belting the chorus, dashboard camera angle, sunlight flickering through windows, laughing and air-drumming, summer road', 'standard'],
      ['Dansutmaning', 'Lätt koreografi att härma', 'dance challenge, dancer performing a simple catchy repeatable routine facing the camera, full body in frame, clean bright background, locked-off phone shot, crisp moves on the beat', 'standard'],
      ['POV-text och läppsynk', 'Känslosam POV med lip-sync', 'emotional POV lip-sync, close-up of a young adult mouthing the lyrics to camera, soft moody bedroom lighting, slow zoom in, space at top for POV caption text, relatable feeling', 'standard'],
      ['Före/efter-avslöjande', 'Glow-up-transition på droppet', 'before and after reveal transition, person in casual clothes covers the lens with hand, on the beat drop cut to the same person in a stunning stage outfit with dramatic lighting, seamless match cut', 'standard'],
      ['Duett i lip-sync', 'Två som avslutar varandras rader', 'lip-sync duet, two adult friends side by side finishing each other\'s lyrics, playful glances, split-screen feel, bright natural light, quick reaction cuts', 'standard'],
      ['Lugnt till galet', 'Calm-to-crazy-transition', 'calm to crazy transition, person sitting still in a quiet room, on the drop the room explodes into colored lights, wind and dancing, hard cut on the beat, energetic chaos', 'neon'],
      ['Hushållsföremål som mikrofon', 'Sjunger i en hårborste', 'person dancing around the kitchen singing into a hairbrush as a microphone, playful overacting, morning sunlight, handheld phone camera, fun and relatable', 'standard'],
      ['Sommarmontage', 'Snabba klipp från en sommar', 'summer montage, quick cuts of adult friends at a lake, sparklers at dusk, road trip snacks, film-photo warmth, light leaks, nostalgic and joyful, cuts on every beat', 'dreamy'],
    ] },
  ];
  function presetsBox(onPick) {
    const sel = []; const all = PRESETS.flatMap((g) => g.items);
    const own = h('textarea', { rows: 2, placeholder: 'Egna idéer (svenska eller engelska) – vägs tyngst' });
    const out = h('textarea', { rows: 4, placeholder: 'Kombinerad prompt visas här och kan redigeras' });
    const info = h('div', { class: 'meta' });
    const mineBox = h('div', { class: 'chips' });
    const CAT = { cam: /\b(camera|shot|dolly|drone|handheld|tracking|crane|slider|orbit|push-in|zoom|pan)\b/i, light: /\b(light|lighting|lights|backlit|spotlight|sun|golden hour|tungsten|strobe)\b/i };
    const combine = () => {
      const parts = []; const seen = new Set(); const used = {};
      const add = (ph, isOwn) => { const k = ph.toLowerCase().trim(); if (!k || seen.has(k)) return; if (!isOwn) for (const c in CAT) if (CAT[c].test(k)) { if (used[c] >= 2) return; used[c] = (used[c] || 0) + 1; } seen.add(k); parts.push(ph.trim()); };
      if (own.value.trim()) { parts.push(own.value.trim()); seen.add(own.value.trim().toLowerCase()); }
      sel.forEach((i) => all[i][2].split(',').forEach((ph) => add(ph)));
      return parts.length ? parts.join(', ') + VS : '';
    };
    const refresh = () => { out.value = combine(); info.textContent = sel.length ? `Valda: ${sel.map((i) => all[i][0]).join(' + ')} (max 3)` : 'Välj 1–3 prompter och/eller skriv egna idéer.'; };
    own.oninput = refresh;
    const chip = (it) => { const i = all.indexOf(it); const b = h('button', { class: 'chip', type: 'button', title: it[1], 'aria-pressed': 'false', onclick: () => { const at = sel.indexOf(i); if (at >= 0) sel.splice(at, 1); else { if (sel.length >= 3) sel.shift(); sel.push(i); } body.querySelectorAll('.chip[data-i]').forEach((c) => { const on = sel.includes(+c.dataset.i); c.setAttribute('aria-pressed', String(on)); c.classList.toggle('on', on); }); refresh(); } }, h('span', { class: 'cn' }, it[0]), h('span', { class: 'ch' }, it[1])); b.dataset.i = i; return b; };
    const MK = 'kino.mymixes'; const load = () => { try { return JSON.parse(localStorage.getItem(MK)) || []; } catch { return []; } };
    const paintMine = () => { mineBox.innerHTML = ''; const m = load(); if (!m.length) return mineBox.append(h('span', { class: 'meta' }, 'Inga egna mallar ännu.')); m.forEach((x, k) => mineBox.append(h('span', { class: 'chip' }, h('button', { class: 'text', type: 'button', onclick: () => { out.value = x.prompt; info.textContent = `Egen mall: ${x.title}${x.cinema ? ' (med Cinema-val)' : ''}`; if (x.cinema) document.dispatchEvent(new CustomEvent('kino-cinema', { detail: x.cinema })); } }, x.title + (x.cinema ? ' 🎬' : '')), h('button', { class: 'text dim danger', type: 'button', 'aria-label': 'Ta bort', onclick: () => { const n = load(); n.splice(k, 1); localStorage.setItem(MK, JSON.stringify(n)); paintMine(); } }, 'Ta bort')))); };
    const tplOf = () => (sel.length ? all[sel[0]][3] : 'standard');
    const use = h('button', { class: 'text', type: 'button', onclick: () => { if (!out.value.trim()) return (info.textContent = 'Välj en prompt eller skriv egna idéer först.'); onPick({ title: sel.length ? sel.map((i) => all[i][0]).join(' + ') : 'Egen idé', prompt: out.value.trim(), negative: NEG, template: tplOf() }); } }, 'Använd prompt');
    const save = h('button', { class: 'text', type: 'button', onclick: () => { if (!out.value.trim()) return; const title = (prompt('Namn på mallen:', sel.map((i) => all[i][0]).join(' + ') || 'Min mix') || '').trim(); if (!title) return; const n = load(); const cinema = st.cinemaGet && document.querySelector('details.cinema') ? st.cinemaGet() : null; n.unshift(cinema ? { title, prompt: out.value.trim(), cinema } : { title, prompt: out.value.trim() }); localStorage.setItem(MK, JSON.stringify(n.slice(0, 50))); paintMine(); } }, 'Spara som egen mall');
    const body = h('div', { class: 'clips-body' },
      PRESETS.map((grp) => h('section', { class: 'cgroup' }, h('h3', {}, grp.g, h('small', {}, `${grp.items.length} st`)), h('div', { class: 'chips' }, grp.items.map(chip)))),
      h('label', { class: 'wide' }, 'Egna idéer', own), info, h('label', { class: 'wide' }, 'Kombinerad prompt (redigerbar)', out),
      h('div', { class: 'under' }, use, save), h('section', { class: 'cgroup' }, h('h3', {}, 'Mina mallar'), mineBox));
    refresh(); paintMine();
    return h('details', { class: 'clips presets' }, h('summary', {}, h('span', { class: 'ttl' }, 'Stilar'), h('span', { class: 'count' }, 'välj 1–3'), h('span', { class: 'chev', 'aria-hidden': 'true' })), body);
  }

  // ---- Viral-mixer: publika trendmönster (video + musik) → en redigerbar viral prompt ----
  function viralBox(here) {
    const S = { kind: 'video', data: {}, sel: new Set(), mix: null };
    const tabs = h('div', { class: 'chips' });
    const srcInfo = h('div', { class: 'meta' }, 'Tryck Hämta virala trender. Bara mönster analyseras – inga andras videor eller ljud laddas ner eller återanvänds.');
    const cardsBox = h('div', { class: 'chips viralcards' });
    const idea = h('textarea', { rows: 3, placeholder: 'Din idé (vägs tyngst) – t.ex. tema, känsla, plats, vad som ska hända' });
    const song = h('input', { placeholder: 'Låt / egen artist (din egen musik)' });
    const genre = h('input', { placeholder: 'Genre, t.ex. synthpop' });
    const mood = h('input', { placeholder: 'Stämning, t.ex. melankolisk men dansant' });
    const lyrics = h('input', { placeholder: 'Textrad ur din låt (valfritt)' });
    const fmt = select([['9:16', '9:16'], ['1:1', '1:1'], ['16:9', '16:9']], '9:16');
    const len = select([['8', '8 s'], ['10', '10 s'], ['15', '15 s'], ['20', '20 s'], ['30', '30 s'], ['45', '45 s'], ['60', '60 s']], '15');
    const musicFields = h('div', { class: 'grid2' }, field('Låt / artist', song), field('Genre', genre), field('Stämning', mood), field('Textrad', lyrics));
    const out = h('textarea', { rows: 6, placeholder: 'Mixad viral prompt visas här och kan redigeras' });
    const shots = h('textarea', { rows: 8, placeholder: 'Bildlista (0–1 s hook, beats, loop-slut), text på skärmen, caption och hashtags' });
    const status = h('div', { class: 'meta', role: 'status' });
    const say = (t, bad) => { status.textContent = t; status.classList.toggle('err', Boolean(bad)); };
    const fmtDate = (iso) => { try { return new Date(iso).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' }); } catch { return iso; } };
    const paintTabs = () => { tabs.innerHTML = ''; [['video', 'Video'], ['music', 'Musik']].forEach(([k, t]) => tabs.append(h('button', { class: 'chip' + (S.kind === k ? ' on' : ''), type: 'button', 'aria-pressed': String(S.kind === k), onclick: () => { S.kind = k; S.sel.clear(); paintTabs(); paint(); } }, h('span', { class: 'cn' }, t)))); musicFields.hidden = S.kind !== 'music'; };
    const paint = () => {
      cardsBox.innerHTML = ''; const d = S.data[S.kind];
      if (!d) { srcInfo.textContent = 'Inga trender hämtade för ' + (S.kind === 'music' ? 'Musik' : 'Video') + ' än.'; return; }
      srcInfo.textContent = `Källa: ${d.source}${d.live ? '' : ' – live-hämtning misslyckades'} · hämtat ${fmtDate(d.fetchedAt)}${d.cached ? ' (cache)' : ''}${d.model ? ' · analys: ' + d.model : ''}. Välj 2–4 kort.`;
      d.cards.forEach((c) => {
        const on = S.sel.has(c.id);
        const cb = h('input', { type: 'checkbox' }); cb.checked = on;
        cb.onchange = () => { if (cb.checked) { if (S.sel.size >= 4) { cb.checked = false; return say('Max 4 kort.', true); } S.sel.add(c.id); } else S.sel.delete(c.id); say(`${S.sel.size} valda`); };
        const extra = S.kind === 'music' ? [c.songSection && h('div', {}, h('b', {}, 'Del av låten: '), c.songSection), (c.length || c.bpm) && h('div', {}, h('b', {}, 'Längd/BPM: '), [c.length, c.bpm].filter(Boolean).join(' · '))] : [];
        cardsBox.append(h('label', { class: 'vcard' }, h('div', { class: 'vhead' }, cb, h('b', {}, c.name), c.format ? h('small', {}, ' · ' + c.format) : ''),
          h('div', { class: 'meta' }, c.why), h('div', {}, h('b', {}, 'Hook: '), c.hook), ...extra.filter(Boolean),
          c.structure && c.structure.length ? h('div', { class: 'meta' }, c.structure.join(' → ')) : '',
          h('div', { class: 'meta' }, [c.visual, c.textOverlay && 'Text: ' + c.textOverlay, c.soundVibe && 'Ljud: ' + c.soundVibe].filter(Boolean).join(' · ')),
          c.hashtags && c.hashtags.length ? h('div', { class: 'meta' }, c.hashtags.join(' ')) : ''));
      });
    };
    const fetchBtn = h('button', { class: 'text primary', type: 'button', onclick: async () => {
      const k = S.kind; say('Hämtar och analyserar trender… (kan ta upp till en minut)'); fetchBtn.disabled = true;
      try { const r = await fetch(`${API}/viral/trends?kind=${k}`).then((x) => x.json()); if (!r.ok) throw new Error(r.error || 'fel'); S.data[k] = r; S.sel.clear(); say(`${r.cards.length} trendkort.`); paint(); }
      catch (e) { say('Kunde inte hämta trender: ' + e.message, true); } finally { fetchBtn.disabled = false; }
    } }, 'Hämta virala trender');
    const mixBtn = h('button', { class: 'text primary', type: 'button', onclick: async () => {
      const d = S.data[S.kind]; const cards = d ? d.cards.filter((c) => S.sel.has(c.id)) : [];
      if (cards.length < 2) return say('Välj 2–4 trendkort först.', true);
      say('Mixar…'); mixBtn.disabled = true;
      try {
        const r = await fetch(`${API}/viral/mashup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: S.kind, cards, idea: idea.value, song: song.value, genre: genre.value, mood: mood.value, lyrics: lyrics.value, format: fmt.value, seconds: Number(len.value), lane: st.lane }) }).then((x) => x.json());
        if (!r.ok) throw new Error(r.error || 'fel');
        S.mix = r; out.value = r.prompt;
        shots.value = [...r.shots.map((x) => `${x.t} [${x.beat}] ${x.visual}${x.text ? ' — text: ' + x.text : ''}`), '', r.songSection ? 'Del av låten: ' + r.songSection : '', r.loop ? 'Loop: ' + r.loop : '', 'Text på skärmen: ' + (r.onScreenText || []).join(' | '), 'Caption: ' + r.caption, 'Hashtags: ' + (r.hashtags || []).join(' ')].filter((x) => x !== '').join('\n');
        say(`Klar: ”${r.title}” (${r.model || 'LLM'}). Redigera fritt.`);
      } catch (e) { say('Mixen misslyckades: ' + e.message, true); } finally { mixBtn.disabled = false; }
    } }, 'Mixa till prompt');
    const payload = () => ({ title: (S.mix && S.mix.title) || 'Viral mix', prompt: out.value.trim(), shots: shots.value.trim(), format: fmt.value });
    const useIn = (target) => { if (!out.value.trim()) return say('Mixa eller skriv en prompt först.', true); const p = payload(); if (here && here.name === target) return here.apply(p); st.viral = { ...p, target }; location.hash = target === 'music' ? '#/music' : '#/video'; };
    const MK = 'kino.mymixes';
    const btns = h('div', { class: 'under' },
      h('button', { class: 'text', type: 'button', onclick: () => useIn('video') }, 'Använd i Video'),
      h('button', { class: 'text', type: 'button', onclick: () => useIn('music') }, 'Använd i Musikvideo'),
      h('button', { class: 'text', type: 'button', onclick: () => { const t = out.value + (shots.value ? '\n\n' + shots.value : ''); (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => say('Kopierat.'), () => say('Kunde inte kopiera – markera texten manuellt.', true)); } }, 'Kopiera'),
      h('button', { class: 'text', type: 'button', onclick: () => { if (!out.value.trim()) return; const title = (prompt('Namn på mallen:', payload().title) || '').trim(); if (!title) return; let n = []; try { n = JSON.parse(localStorage.getItem(MK)) || []; } catch {} n.unshift({ title, prompt: out.value.trim() }); localStorage.setItem(MK, JSON.stringify(n.slice(0, 50))); say('Sparad i Mina mallar.'); } }, 'Spara i Mina mallar'));
    paintTabs();
    const body = h('div', { class: 'clips-body' }, tabs, h('div', { class: 'under' }, fetchBtn), srcInfo, cardsBox,
      h('label', { class: 'wide' }, 'Din idé', idea), musicFields, h('div', { class: 'grid2' }, field('Format', fmt), field('Längd', len)),
      h('div', { class: 'under' }, mixBtn), status, h('label', { class: 'wide' }, 'Viral prompt (redigerbar)', out), h('label', { class: 'wide' }, 'Bildlista, text, caption & hashtags', shots), btns,
      h('div', { class: 'meta' }, 'Bara mönster: KINO laddar aldrig ner eller återanvänder andras videor eller ljud och härmar inga verkliga artisters röst eller utseende. Använd din egen musik.'));
    return h('details', { class: 'clips presets viral' }, h('summary', {}, h('span', { class: 'ttl' }, 'Viral-mixer'), h('span', { class: 'count' }, 'TikTok-trender → prompt'), h('span', { class: 'chev', 'aria-hidden': 'true' })), body);
  }
  function viralView(v) {
    const b = viralBox(null); b.open = true;
    v.append(pagehead('Viral-mixer', 'Analysera virala TikTok-mönster (video och musik) och mixa dem med din idé till en prompt.'), b);
  }
  function takeViral(target, apply) { const x = st.viral; if (x && x.target === target) { st.viral = null; setTimeout(() => apply(x), 0); } }

  async function videoView(v) {
    const carry = st.carry; st.carry = null;
    const first = fileField('Första bildruta', 'image/*', carry);
    const last = fileField('Sista bildruta', 'image/*');
    const len = select([['2', '2 s'], ['3', '3 s'], ['4', '4 s'], ['5', '5 s'], ['6', '6 s'], ['8', '8 s'], ['10', '10 s'], ['12', '12 s'], ['15', '15 s (Grok)'], ['30', '30 s (Grok)'], ['60', '1 min (Grok)'], ['120', '2 min (Grok)']], '4');
    const ratio = select([['16:9', '16:9'], ['9:16', '9:16'], ['1:1', '1:1']], '16:9');
    const g = await grokToggle();
    const grid = results('video');
    const c = composer({ kind: 'video', engineKind: 'video', placeholder: 'Beskriv ett klipp', settings: [first.el, last.el, field('Längd', len), field('Format', ratio), g.el],
      onGo: async ({ prompt, engine, say, setCancel, signal }) => {
        if (!prompt) return say('Skriv en prompt.', true);
        if (engine === 'colab' && !g.cb.checked) {
          if (minorText(prompt)) return say(REFUSE, true);
          try {
            const out = await colabVideo({ prompt, seconds: len.value, ratio: ratio.value, image: first.inp.files[0] || first.blob || null, say });
            st.results.video.unshift(out); grid.prepend(resultCard(out, 'video')); return say(`Gjord av ${out.engineName}.`);
          } catch (e) { if (e.cancelled) throw e; return say(`${e.message} Välj en annan motor.`, true); }
        }
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
        setCancel(async () => { await fetch(`${API}/jobs/${j.jobId}`, { method: 'DELETE' }).catch(() => null); });
        try {
          const out = await poll(j.jobId, (m) => say(m));
          st.results.video.unshift(out); grid.prepend(resultCard(out, 'video')); say(`Gjord av ${out.engineName}.`);
        } catch (e) { if (e.cancelled) throw e; say(e.message, true); }
      } });
    const sel = c.box.querySelector('select');
    const colabOpt = h('option', { value: 'colab', disabled: true, 'data-keep': '1' }, 'Colab / Kaggle (egen GPU) · offline');
    sel.prepend(colabOpt);
    const onColab = (on) => {
      colabOpt.disabled = !on; colabOpt.textContent = on ? 'Colab / Kaggle (egen GPU) · din GPU · max 5 s' : 'Colab / Kaggle (egen GPU) · offline';
      if (on) { sel.disabled = false; if (localStorage.getItem('kino.colab.url')) sel.value = 'colab'; } else if (sel.value === 'colab') sel.selectedIndex = [...sel.options].findIndex((o) => !o.disabled);
      sel.dispatchEvent(new Event('change'));
    };
    colabHealth().then((r) => { onColab(r.state === 'on'); paintPill(r.state === 'on'); });
    const gpuNote = h('a', { class: 'meta gpulink', href: '#/installningar' }, 'Egen GPU (Colab / Kaggle) ställs in under Inställningar ›');
    const pre = presetsBox(({ prompt, negative, title }) => { const ta = c.box.querySelector('textarea'); if (ta) { ta.value = prompt; ta.dispatchEvent(new Event('input')); ta.focus(); } ratio.value = '9:16'; c.box.querySelector('.status') && (c.box.querySelector('.status').textContent = `${title} ifylld · format 9:16 · negativ prompt (om motorn stöder det): ${negative}`); });
    pre.open = true; c.box.querySelector('.composer').after(pre);
    const applyV = (x) => { const ta = c.box.querySelector('textarea'); if (ta) { ta.value = x.prompt + (x.shots ? '\n\n' + x.shots : ''); ta.dispatchEvent(new Event('input')); ta.focus(); } if ([...ratio.options].some((o) => o.value === x.format)) ratio.value = x.format; const stt = c.box.querySelector('.status'); if (stt) stt.textContent = `${x.title} från Viral-mixer ifylld · format ${ratio.value}`; };
    const vHere = { name: 'video', apply: applyV }; const vb = viralBox(vHere); pre.after(vb); takeViral('video', applyV);
    const cinV = cinemaPanel('video'); if (cinV) { c.setCinema(cinV); if (st.cinemaPrefill) { cinV.set(st.cinemaPrefill); st.cinemaPrefill = null; } }
    v.classList.add('two');
    v.append(pagehead('Video', 'Beskriv ett klipp eller börja från en bild.'), c.box, gpuNote, clipSources(), grid);
  }

  async function musicView(v) {
    const songIn = h('input', { type: 'file', accept: '.mp3,.wav,.m4a,audio/mpeg,audio/wav,audio/x-m4a,audio/mp4', hidden: true });
    const imgIn = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
    let song = null; let imgs = []; const stepSync = { fn: () => {} };
    const songBox = h('div', { class: 'drop' });
    const thumbs = h('div', { class: 'thumbs' });
    function paintSong() {
      songBox.innerHTML = ''; stepSync.fn();
      if (!song) return songBox.append(h('div', { class: 'hintline' }, h('button', { class: 'text', onclick: () => songIn.click() }, 'Välj låt'), libButton(songIn)));
      songBox.append(h('div', { class: 'hintline' }, h('b', {}, song.name), h('button', { class: 'text dim', onclick: () => { song = null; paintSong(); } }, 'Ta bort låt')), h('audio', { controls: true, src: URL.createObjectURL(song) }));
    }
    function paintImgs() {
      thumbs.innerHTML = ''; stepSync.fn();
      imgs.forEach((f, i) => thumbs.append(h('div', { class: 'thumb' }, h('img', { src: URL.createObjectURL(f) }), h('button', { type: 'button', 'aria-label': 'Ta bort', onclick: () => { imgs.splice(i, 1); paintImgs(); } }, '×'))));
    }
    songIn.onchange = () => { const f = songIn.files[0]; songIn.value = ''; if (!f) return; if (f.size > 20 * 1024 * 1024 || !/\.(mp3|wav|m4a)$/i.test(f.name)) return alert('Låten måste vara mp3, wav eller m4a, max 20 MB.'); song = f; paintSong(); };
    imgIn.onchange = () => { imgs = imgs.concat([...imgIn.files]).slice(0, 8); imgIn.value = ''; paintImgs(); };
    paintSong();
    // 3-step guide: Låt -> Idé/stil -> Bilder (valfritt), fixed "Skapa musikvideo" button
    const stepHead = (n, t, sub) => h('div', { class: 'stephead' }, h('span', { class: 'stepn' }, String(n)), h('div', {}, h('b', {}, t), h('small', {}, sub)), h('span', { class: 'stepok', 'aria-hidden': 'true' }, '✓'));
    const step1 = h('section', { class: 'step' }, stepHead(1, 'Låt', 'mp3, wav eller m4a · max 20 MB'), songIn, songBox);
    const step3 = h('section', { class: 'step' }, stepHead(3, 'Bilder (valfritt)', 'Upp till 8 – annars skapar KINO dem'), imgIn, h('div', { class: 'drop' }, h('div', { class: 'hintline' }, h('button', { class: 'text', onclick: () => imgIn.click() }, 'Välj bilder'), libButton(imgIn)), thumbs));
    const bars = h('div', { class: 'steps', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'));
    const top = h('div', { class: 'uploads' }, step1);
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
      onGo: async ({ prompt, engine, say, setCancel, signal }) => {
        const cancelJob = (id) => setCancel(async () => { await fetch(`${API}/jobs/${id}`, { method: 'DELETE' }).catch(() => null); });
        if (motion.value === 'stock') {
          if (!song) return say('Stockläge kräver en uppladdad låt.', true);
          const sf = new FormData();
          sf.append('prompt', prompt); sf.append('text', overlay.value); sf.append('seconds', len.value === '60' ? '45' : len.value); sf.append('source', stockSrc); sf.append('song', song);
          say('Laddar upp…');
          const r0 = await fetch(`${API}/stock`, { method: 'POST', body: sf });
          if (!r0.ok) return say(await errMsg(r0), true);
          const j0 = await r0.json(); cancelJob(j0.jobId);
          try {
            const out = await poll(j0.jobId, (m) => say(m));
            const by = out.credits.footage.map((f) => f.by).join('; ');
            const lbl = out.source === 'ai' ? 'AI-genererade stockklipp (Pixabay)' : out.source === 'mix' ? (out.kind || 'stockklipp, riktiga + AI-genererade') : 'riktigt stockmaterial, inte AI-video';
            out.credits = { ...out.credits, images: `${lbl}: ${by}` };
            st.results.music.unshift(out); grid.prepend(resultCard(out, 'music'));
            say(`${out.engineName} · ${lbl} · Låt: ${out.credits.song} · Material: ${by}`);
          } catch (e) { if (e.cancelled) throw e; say(e.message, true); }
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
        const j = await r.json(); cancelJob(j.jobId);
        try {
          const out = await poll(j.jobId, (m) => say(m));
          st.results.music.unshift(out); grid.prepend(resultCard(out, 'music'));
          say(`Låt: ${out.credits.song} · Bilder: ${out.credits.images} · Rörelse: ${out.credits.motion}`);
        } catch (e) { if (e.cancelled) throw e; say(e.message, true); }
      } });
    if (st.preset === 'stock' && st.lane === 'sfw' && [...motion.options].some((o) => o.value === 'stock')) {
      motion.value = 'stock'; c.panel.hidden = false;
      c.say('Stockklipp: ladda upp en låt, välj källa under Inställningar och skapa.');
    }
    st.preset = null;
    const pre = presetsBox(({ prompt, title }) => { c.ta.value = prompt; c.ta.dispatchEvent(new Event('input')); c.say(`${title} ifylld. Ändra texten om du vill.`); });
    c.box.querySelector('.composer').after(pre);
    const applyM = (x) => { c.ta.value = x.prompt + (x.shots ? '\n\n' + x.shots : ''); c.ta.dispatchEvent(new Event('input')); c.say(`${x.title} från Viral-mixer ifylld. Ändra texten om du vill.`); };
    const mb = viralBox({ name: 'music', apply: applyM }); pre.after(mb); takeViral('music', applyM);
    const cinM = cinemaPanel('video'); if (cinM) { cinM.skip = () => motion.value === 'stock'; c.setCinema(cinM); }
    const step2 = h('section', { class: 'step' }, stepHead(2, 'Vad handlar den om?', 'Skriv själv eller välj stilar'), c.box);
    const syncSteps = () => { const done = [Boolean(song), Boolean(c.ta.value.trim()), imgs.length > 0]; [step1, step2, step3].forEach((s2, i) => s2.classList.toggle('done', done[i])); const cur = done.indexOf(false); [step1, step2, step3].forEach((s2, i) => s2.classList.toggle('cur', i === (cur < 0 ? 2 : cur))); [...bars.children].forEach((b, i) => b.classList.toggle('on', done[i])); };
    stepSync.fn = syncSteps; c.ta.addEventListener('input', syncSteps); syncSteps();
    v.classList.add('two');
    v.append(musicTabs('mv'), pagehead('Ny musikvideo', '3 steg. Stockklipp och fler val finns under Inställningar i steg 2.'), bars, top, step2, step3, grid);
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
    const top = h('div', { class: 'uploads' }, imgIn, h('div', { class: 'tl-top' }, seg(h('span', { class: 'on', 'aria-current': 'page' }, 'Redigera'), h('a', { href: '#/timeline' }, 'Tidslinje'))), h('div', { class: 'drop' }, h('div', { class: 'hintline' }, h('button', { class: 'text', onclick: () => imgIn.click() }, 'Lägg till referensbilder'), libButton(imgIn)), thumbs));
    const grid = results('edit');
    const c = composer({ kind: 'edit', engineKind: 'edit', placeholder: 'Vad ska ändras?', noEngineText: 'Redigering fungerar inte just nu.',
      onGo: async ({ prompt, engine, say, setCancel, signal }) => {
        if (!prompt) return say('Skriv en prompt.', true);
        if (!files.length && !refs.length) return say('Lägg till en referensbild.', true);
        if (engine.startsWith('puter:')) {
          const ref = files[0] || (refs[0] && (refs[0].blob || await fetch(abs(refs[0].url)).then((x) => x.blob())));
          say('Seedream (Puter)… första gången ber den dig logga in hos Puter.');
          const item = await seedream({ engineId: engine, prompt, ratio: '1:1', ref, signal });
          st.results.edit.unshift(item); grid.prepend(resultCard(item, 'edit'));
          return say(`Gjord av ${item.engineName}.${item.note ? ' ' + item.note.trim() : ''}${files.length + refs.length > 1 ? ' Seedream via Puter tar en referens; den första användes.' : ''}`);
        }
        const fd = new FormData();
        fd.append('lane', st.lane); fd.append('engine', engine); fd.append('prompt', prompt);
        files.forEach((f) => fd.append('images', f)); refs.forEach((r) => (r.blob ? fd.append('images', r.blob, 'seedream.jpg') : /^(https?:|blob:|data:)/.test(r.url) ? null : fd.append('refs', r.name)));
        say('Skickar…');
        const r = await fetch(`${API}/edit`, { method: 'POST', body: fd });
        if (!r.ok) return say(await errMsg(r), true);
        const j = await r.json(); setCancel(async () => { await fetch(`${API}/jobs/${j.jobId}`, { method: 'DELETE' }).catch(() => null); });
        try {
          const out = await poll(j.jobId, (m) => say(m));
          st.results.edit.unshift(out); grid.prepend(resultCard(out, 'edit')); say(out.note || `Gjord av ${out.engineName}.`);
        } catch (e) { if (e.cancelled) throw e; say(e.message, true); }
      } });
    v.classList.add('two');
    v.append(top, pagehead('Redigera', 'Lägg till en bild och skriv vad som ska ändras.'), c.box, clipSources(), grid);
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
      } catch (e) { say(e.cancelled ? 'Avbrutet.' : e.message, !e.cancelled); }
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
    let stop = false;
    const untrack = track('Manus', async () => { stop = true; await fetch(`${API}/script/jobs/${id}`, { method: 'DELETE' }).catch(() => null); });
    try {
    for (;;) {
      await new Promise((r) => setTimeout(r, 2500));
      if (stop) throw cancelledErr();
      const j = await fetch(`${API}/script/jobs/${id}`).then((x) => x.json()).catch(() => null);
      if (!j) continue;
      if (j.status === 'cancelled') throw cancelledErr();
      if (j.status === 'done') return j.result;
      if (j.status === 'error') throw new Error(j.error);
      onMsg && onMsg(j.message);
    }
    } finally { untrack(); }
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
    const EN = { standard: 'Standard', live: 'Livekonsert', stagekid: 'Barn upp på scen (viral)', cinematic: 'Filmisk', anime: 'Anime', vhs: 'Retro VHS / 80-tal', neon: 'Neon / Cyberpunk', dreamy: 'Drömsk', bw: 'Svartvitt', cover: 'Skivomslag' };
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
      if (!S.song) return songBox.append(h('div', { class: 'hintline' }, h('button', { class: 'text', onclick: () => songIn.click() }, 'Lägg till låt'), libButton(songIn), h('span', { class: 'meta' }, 'valfritt · mp3, wav, m4a · låttext behövs inte')));
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
      } catch (e) { say(e.cancelled ? 'Avbrutet.' : e.message, !e.cancelled); }
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
      } catch (e) { say(e.cancelled ? 'Avbrutet.' : e.message, !e.cancelled); }
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
      presetsBox(({ prompt, title, template }) => { idea.value = prompt; S.idea = prompt; if ([...tplSel.options].some((o) => o.value === template)) { tplSel.value = template; S.template = template; } say(`${title} ifylld · mall: ${tplSel.options[tplSel.selectedIndex] ? tplSel.options[tplSel.selectedIndex].text : ''}`); idea.focus(); }),
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
      let stop = false;
      const untrack = track('Klipp', async () => { stop = true; await fetch(`${API}/klipp/jobs/${id}`, { method: 'DELETE' }).catch(() => null); });
      try {
      for (let miss = 0; ;) {
        await new Promise((r) => setTimeout(r, 2500));
        if (stop) throw cancelledErr();
        const r = await fetch(`${API}/klipp/jobs/${id}`).catch(() => null);
        if (!r) { if (++miss > 20) throw new Error('Tappade kontakten med servern.'); continue; }
        if (r.status === 404) throw new Error('Jobbet finns inte längre (servern kan ha startat om, eller så har filerna raderats). Ladda upp videon igen.');
        const j = await r.json().catch(() => null); if (!j) continue; miss = 0;
        on && on(j.progress, j.message, j);
        if (j.status === 'cancelled') throw cancelledErr();
        if (j.status === 'done') return j.result;
        if (j.status === 'error') throw Object.assign(new Error(j.error || 'Något gick fel.'), { refused: j.refused, info: j.info });
      }
      } finally { untrack(); }
    }
    async function follow(id) {
      go.disabled = true; K.job = id; K.error = null;
      try {
        const res = await pollKlipp(id, (p, m, j) => { K.progress = p; K.message = m; K.info = j.info || {}; setBar(p); paintHow(K.info); say(`${m} (${Math.round(p * 100)} %)`, false, true); });
        K.result = res; K.status = 'done'; setBar(null); say('Klart! Spela upp, ladda ner eller skapa om med annan längd.'); paintResult();
      } catch (e) {
        K.status = e.cancelled ? 'cancelled' : 'error'; K.error = e.message; setBar(null); if (e.info) { K.info = e.info; paintHow(e.info); }
        say(e.cancelled ? 'Avbrutet. Jobbet stoppades på servern.' : e.message, !e.cancelled);
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

  // ---- Skapa influencer-artist: påhittad vuxen AI-persona -> 4 porträtt -> artistlistan ----
  const P_TEEN_RE = /(^|[^a-zåäö0-9])(teens?|teenage(rs?)?|teenie|tonåring(ar)?|tonårs\w*|tonåren|flick(a|an|or)|pojk(e|en|ar))(?=$|[^a-zåäö0-9])/i;
  const P_REAL_RE = /(look(s|ing)?[\s-]*(a[\s-]*)?like|look[\s-]*alike|lookalike|resembl\w*|doppelg(a|ä)nger|som liknar|liknar|ser ut som|kopia av|tvilling till)\s+(a\s+|an\s+|en\s+|ett\s+)?(\p{Lu}|(famous|celebrit|kändis|känd|berömd|real|verklig)\w*)|(celebrity|celeb|kändis)[\s-]*(look[\s-]*alike|lookalike|dubbelgångare)|dubbelgångare|look[\s-]*alike/u;
  function personaCheck(p) {
    if (!p.name) return 'Skriv ett namn på artisten.';
    if (!(Number(p.age) >= 18)) return 'Åldern måste vara minst 18 år. KINO skapar bara vuxna personer.';
    const all = Object.values(p).join(' \n ');
    const low = all.toLowerCase();
    if (HARD_RE.test(low) || P_TEEN_RE.test(low) || minorSignal(low, false)) return 'Nekad: bara vuxna (18+). Ord som syftar på barn, tonåringar eller barnsligt utseende är inte tillåtna.';
    if (P_REAL_RE.test(all)) return 'Nekad: inga "liknar …"-beskrivningar av verkliga personer. Artisten måste vara helt påhittad (kända namn stoppas av servern).';
    return null;
  }
  const PORTRAIT_PREF = ['flux-klein', 'qwen-image', 'z-image', 'sana-sprint'];
  async function personaView(v) {
    const inp = (ph, type) => h('input', { type: type || 'text', placeholder: ph });
    const f = { name: inp('t.ex. Nova Lind'), gender: select([['kvinna', 'Kvinna'], ['man', 'Man'], ['ickebinär', 'Ickebinär / androgyn']], 'kvinna'), age: h('input', { type: 'number', min: '18', max: '99', value: '25', step: '1' }),
      hair: inp('t.ex. långt lockigt rött'), eyes: inp('t.ex. gröna'), body: inp('t.ex. atletisk'), ethnicity: inp('valfritt, t.ex. nordisk'), style: inp('t.ex. streetwear, minimalistisk'), genre: inp('t.ex. synthpop'), vibe: inp('t.ex. självsäker och varm') };
    f.age.oninput = () => { if (Number(f.age.value) < 18) f.age.setCustomValidity('Minst 18 år'); else f.age.setCustomValidity(''); };
    const rewrite = h('input', { type: 'checkbox', checked: true });
    const status = h('div', { class: 'status', role: 'status', 'aria-live': 'polite' });
    const say = (t, err) => { status.textContent = t; status.classList.toggle('err', Boolean(err)); };
    const grid = h('div', { class: 'persona-grid' });
    const cardBox = h('div', { class: 'persona-card', hidden: true });
    const genBtn = h('button', { class: 'text primary', type: 'button' }, 'Generera ansikten');
    const saveBtn = h('button', { class: 'text primary', type: 'button', disabled: true }, 'Spara i artistrostern');
    let chosen = null; let lastPrompt = ''; let busy = false;
    const persona = () => Object.fromEntries(Object.entries(f).map(([k, el]) => [k, k === 'age' ? Math.floor(Number(el.value)) : el.value.trim()]));
    const describe = (p) => [`fiktiv vuxen AI-artist ${p.name}, ${p.age} år`, p.gender, p.hair && `${p.hair} hår`, p.eyes && `${p.eyes} ögon`, p.body, p.ethnicity, p.style, p.genre && `${p.genre}-artist`, p.vibe].filter(Boolean).join(', ');
    genBtn.onclick = async () => {
      if (busy) return; const p = persona(); const err = personaCheck(p); if (err) return say(err, true);
      busy = true; genBtn.disabled = true; saveBtn.disabled = true; chosen = null; grid.innerHTML = ''; cardBox.hidden = true;
      try {
        say(rewrite.checked ? 'Bygger porträttprompt (AI översätter till engelska)…' : 'Bygger porträttprompt…');
        const r = await fetch(`${API}/persona/prompt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ persona: p, rewrite: rewrite.checked, lane: st.lane }) });
        const pj = await r.json().catch(() => ({})); if (!r.ok || !pj.ok) throw new Error(pj.error || `Servern svarade ${r.status}`);
        lastPrompt = pj.prompt;
        // Porträttet görs i aktuellt läge (alltid vuxen; SFW icke-explicit).
        const list = (await getEngines(st.lane)).filter((e) => e.kind === 'image' && !e.puter && !e.async && e.id !== 'gpu-image' && e.status !== 'down');
        const ids = [...PORTRAIT_PREF.filter((id) => list.some((e) => e.id === id)), ...list.map((e) => e.id).filter((id) => !PORTRAIT_PREF.includes(id))];
        if (!ids.length) throw new Error('Ingen bildmotor svarar just nu. Försök igen om en stund.');
        let made = 0; let engineName = ''; let lastErr = '';
        for (const eng of ids) {
          if (made >= 4) break;
          say(`Genererar ${4 - made} porträtt med ${(list.find((e) => e.id === eng) || {}).name || eng}…`);
          const ir = await fetch(`${API}/image`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lane: st.lane, engine: eng, prompt: lastPrompt, ratio: '1:1', count: 4 - made, lora: 'none' }) });
          if (!ir.ok) { lastErr = await errMsg(ir); continue; }
          const ij = await ir.json();
          for (const im of ij.images || []) {
            made++; engineName = ij.engineName;
            const img = h('img', { src: abs(im.url), alt: `Porträttförslag ${made}` });
            const b = h('button', { type: 'button', class: 'persona-pick', 'aria-pressed': 'false', onclick: () => { grid.querySelectorAll('.persona-pick').forEach((x) => x.setAttribute('aria-pressed', 'false')); b.setAttribute('aria-pressed', 'true'); chosen = { ...im, engineName: ij.engineName }; saveBtn.disabled = false; } }, img);
            grid.append(b);
          }
        }
        if (!made) throw new Error(lastErr || 'Inga porträtt kunde skapas.');
        say(`${made} förslag från ${engineName}${pj.rewritten ? ` (prompt omskriven av ${pj.model})` : ''}. Välj ett ansikte och spara.`);
      } catch (e) { say(e.message, true); } finally { busy = false; genBtn.disabled = false; }
    };
    saveBtn.onclick = async () => {
      if (!chosen) return say('Välj ett ansikte först.', true);
      const p = persona(); const err = personaCheck(p); if (err) return say(err, true);
      saveBtn.disabled = true;
      try {
        say('Skriver persona-kort…');
        const cr = await fetch(`${API}/persona/card`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ persona: p }) });
        const card = await cr.json().catch(() => ({})); if (!cr.ok || !card.ok) throw new Error(card.error || 'Kunde inte skapa persona-kortet');
        const blob = await fetch(abs(chosen.url)).then((x) => { if (!x.ok) throw new Error('Kunde inte hämta bilden'); return x.blob(); });
        const photo = await shrink(blob);
        const a = { id: Math.random().toString(36).slice(2, 10), name: p.name, photos: [photo], consent: true, ai: true, added: new Date().toLocaleString('sv-SE'),
          persona: { ...p, lane: st.lane, description: describe(p), prompt: lastPrompt, engine: chosen.engineName }, card: { bio: card.bio, tone: card.tone, hashtags: card.hashtags } };
        rosterSave([...rosterLocal(), a]);
        cardBox.hidden = false; cardBox.innerHTML = '';
        cardBox.append(h('img', { src: photo, alt: p.name }), h('div', {}, h('b', {}, `${p.name} `, h('span', { class: 'etag' }, 'AI-genererad / påhittad')), h('p', {}, card.bio), h('p', { class: 'meta' }, `Ton i bildtexter: ${card.tone}`), h('p', { class: 'meta' }, card.hashtags.join(' ')),
          h('div', { class: 'quick' }, h('button', { class: 'text primary', type: 'button', onclick: () => personaToImage(a) }, 'Skapa bilder med artisten'), h('a', { class: 'text dim', href: '#/motor?t=roster' }, 'Visa artistlistan'))));
        say(`${p.name} är sparad i artistlistan och kan användas i ansiktsbyte och Openjutsu (synkas när egen GPU är ansluten).`);
      } catch (e) { say(e.message, true); saveBtn.disabled = false; }
    };
    v.append(pagehead('Skapa influencer-artist', 'Hitta på en egen AI-artist: beskriv personen, generera fyra ansikten, välj ett och spara i artistlistan. Gratis, med KINO:s egna bildmotorer.'),
      h('div', { class: 'grid2' }, field('Namn', f.name), field('Kön / stil', f.gender), field('Ålder (minst 18)', f.age), field('Hår', f.hair), field('Ögon', f.eyes), field('Kroppstyp', f.body), field('Etnicitet (valfritt)', f.ethnicity),
        field('Stil', f.style), field('Genre', f.genre), field('Personlighet / vibe', f.vibe, true), h('label', { class: 'wide' }, rewrite, ' Låt AI skriva om prompten (svenska → engelska)')),
      h('p', { class: 'lanenote' + (st.lane === 'nsfw' ? ' nsfw' : '') }, `Läge: ${st.lane === 'nsfw' ? 'NSFW' : 'SFW'} (sparas med artisten). Porträtten görs i aktuellt läge (SFW: icke-explicit; NSFW: valfri stil, alltid vuxen). Bara vuxna (18+), inga verkliga eller kända personer och inga uppladdade foton.`),
      h('div', { class: 'quick' }, genBtn, saveBtn), status, grid, cardBox);
  }
  function personaToImage(a) { st.imagePrefill = `${a.persona.description}, adult`; location.hash = '#/image'; }
  // ---- AI-agent (#/agent): önskemål på svenska -> plan (server) -> stegen körs här med KINO:s vanliga routes/sidor ----
  const AGENT_KEY = 'kino.agent.chat';
  const AGENT_TOOLS = { persona: 'Influencer-artist', image: 'Bilder', script: 'Manus', viral_trends: 'Trender', viral_mashup: 'Viral-mix', save_template: 'Spara i Mina mallar',
    video: 'Video', music_video: 'Musikvideo', stock_clips: 'Stockklipp', voice_swap: 'Röstbyte', face_swap: 'Ansiktsbyte', openjutsu: 'Karaktärsbyte (Openjutsu)', lip_sync: 'Läppsynk', klipp: 'Klipp' };
  const HANDOFF = { video: 1, music_video: 1, stock_clips: 1, voice_swap: 1, face_swap: 1, openjutsu: 1, lip_sync: 1, klipp: 1 };
  const STATUS_SV = { wait: 'Väntar', confirm: 'Bekräfta', run: 'Kör…', done: 'Klar', err: 'Fel', cancel: 'Avbruten', skip: 'Hoppades över' };
  const agentLoad = () => { try { return JSON.parse(localStorage.getItem(AGENT_KEY) || '[]'); } catch { return []; } };
  const agentSave = (l) => { const x = l.slice(-50); try { localStorage.setItem(AGENT_KEY, JSON.stringify(x)); } catch { localStorage.setItem(AGENT_KEY, JSON.stringify(x.slice(-20))); } return x; };
  function agentPick(sel, key) { const want = st.agentPick && st.agentPick[key]; if (!want) return; const o = [...sel.options].find((x) => x.textContent.trim().toLowerCase() === want.toLowerCase()); if (o) { sel.value = o.value; st.agentPick[key] = null; } }
  async function agentContext() {
    const g = await colabHealth(); const gpu = g.state === 'on'; let voices = [];
    if (gpu) voices = await fetch(`${colabCfg().url}/voices`, { headers: colabHdr(), signal: AbortSignal.timeout(8000) }).then((x) => (x.ok ? x.json() : [])).then((l) => l.filter((v) => v.status === 'ready').map((v) => v.name)).catch(() => []);
    const engines = (await getEngines(st.lane).catch(() => [])).filter((e) => e.status !== 'down').map((e) => `${e.kind}:${e.id}`);
    return { gpu, voices, roster: rosterLocal().map((a) => a.name), engines };
  }
  async function agentScript(args, signal) {
    const r = await fetch(`${API}/script`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...args, lane: st.lane }), signal });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message || j.error || `Servern svarade ${r.status}`);
    for (;;) {
      await abortable(new Promise((ok) => setTimeout(ok, 2500)), signal);
      const s = await fetch(`${API}/script/jobs/${j.jobId}`, { signal }).then((x) => x.json()).catch(() => null);
      if (!s) continue; if (s.status === 'done') return s.result; if (s.status === 'error') throw new Error(s.refused ? REFUSE : s.error);
    }
  }
  async function agentImages({ prompt, count, ratio, persona }, signal, setCancel, say) {
    if (minorText(prompt)) throw new Error(REFUSE);
    const lane = st.lane; // porträtt i aktuellt läge (alltid vuxen)
    const list = (await getEngines(lane)).filter((e) => e.kind === 'image' && !e.puter && e.id !== 'gpu-image' && e.status !== 'down');
    const pref = persona ? PORTRAIT_PREF : [];
    const ids = [...pref.filter((id) => list.some((e) => e.id === id)), ...list.filter((e) => !e.async).map((e) => e.id).filter((id) => !pref.includes(id)), ...list.filter((e) => e.async).map((e) => e.id)];
    if (!ids.length) throw new Error('Ingen bildmotor svarar just nu.');
    const out = []; let lastErr = '';
    for (const eng of ids) {
      if (out.length >= count) break;
      say(`${count - out.length} bild(er) med ${(list.find((e) => e.id === eng) || {}).name || eng}…`);
      const n = Math.min(4, count - out.length);
      const r = await fetch(`${API}/image`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lane, engine: eng, prompt, ratio: ratio || '1:1', count: n, lora: persona ? 'none' : 'auto' }), signal });
      if (!r.ok) { lastErr = await errMsg(r); if (r.status === 422) throw new Error(lastErr); continue; }
      let j = await r.json();
      if (j.async) { setCancel(() => fetch(`${API}/jobs/${j.jobId}`, { method: 'DELETE' }).catch(() => null)); try { j = await poll(j.jobId, say, signal); } catch (e) { if (e.cancelled) throw e; lastErr = e.message; continue; } finally { setCancel(null); } }
      for (const im of j.images || []) { const item = { ...im, engineName: j.engineName }; st.results.image.unshift(item); out.push(item); }
    }
    if (!out.length) throw new Error(lastErr || 'Inga bilder kunde skapas.');
    return out;
  }
  const promptOf = (o) => (o && (o.prompt || o.idea)) || '';
  async function agentRunStep(step, outs, ctl) {
    const a = step.args || {}; const prev = a.from != null ? outs[a.from] : null; const { signal, say, setCancel } = ctl;
    const json = async (path, body) => { const r = await fetch(`${API}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal }); const j = await r.json().catch(() => ({})); if (!r.ok || j.ok === false) { const msg = j.error || j.message || `Servern svarade ${r.status}`; throw new Error(/^Refused/.test(msg) ? (/minor/.test(msg) ? REFUSE : 'Nekad av säkerhetsfiltret.') : msg); } return j; };
    switch (step.tool) {
      case 'persona': {
        const p = { name: a.name, gender: a.gender, age: a.age, hair: a.hair, eyes: a.eyes, body: a.body, ethnicity: a.ethnicity, style: a.style, genre: a.genre, vibe: a.vibe };
        const err = personaCheck(p); if (err) throw new Error(err);
        say('Porträttprompt…'); const pj = await json('/persona/prompt', { persona: p, rewrite: true, lane: st.lane });
        say('Persona-kort…'); const card = await json('/persona/card', { persona: p });
        const description = [`fiktiv vuxen AI-artist ${p.name}, ${p.age} år`, p.gender, p.hair && `${p.hair} hår`, p.eyes && `${p.eyes} ögon`, p.body, p.style, p.genre && `${p.genre}-artist`, p.vibe].filter(Boolean).join(', ');
        return { persona: p, prompt: pj.prompt, card, description, text: `${p.name}, ${p.age} år – ${card.bio}\n${(card.hashtags || []).join(' ')}` };
      }
      case 'image': {
        const persona = prev && prev.persona ? prev : null;
        const prompt0 = a.prompt && !persona ? a.prompt : persona ? persona.prompt : `${promptOf(prev)}${a.prompt ? ', ' + a.prompt : ''}`;
        const prompt = a.cinema && window.KinoCinema && prompt0 ? window.KinoCinema.apply(prompt0, a.cinema, { kind: 'image' }) : prompt0;
        if (!prompt) throw new Error('Ingen prompt att göra bild av.');
        const imgs = await agentImages({ prompt, count: a.count || 1, ratio: persona ? '1:1' : a.ratio, persona: Boolean(persona) }, signal, setCancel, say);
        let note = `${imgs.length} bild(er) från ${imgs[0].engineName}. Finns också i Mina verk.`;
        if (persona) {
          const blob = await fetch(abs(imgs[0].url)).then((x) => x.blob()).catch(() => null);
          if (blob) {
            const p = persona.persona;
            rosterSave([...rosterLocal(), { id: Math.random().toString(36).slice(2, 10), name: p.name, photos: [await shrink(blob)], consent: true, ai: true, added: new Date().toLocaleString('sv-SE'),
              persona: { ...p, lane: st.lane, description: persona.description, prompt: persona.prompt, engine: imgs[0].engineName }, card: { bio: persona.card.bio, tone: persona.card.tone, hashtags: persona.card.hashtags } }]);
            note += ` ${p.name} är sparad i artistlistan (första bilden).`;
          }
        }
        return { images: imgs.map((i) => abs(i.url)), prompt, text: note };
      }
      case 'script': {
        say('Skriver manus…'); const r = await agentScript({ idea: a.idea || promptOf(prev), seconds: a.seconds, scenes: a.scenes, song: a.song }, signal);
        const scenes = r.scenes || [];
        return { prompt: scenes.map((s) => s.prompt).join(' | '), text: scenes.map((s, i) => `${i + 1}. ${s.text || s.prompt}`).join('\n'), link: '#/script' };
      }
      case 'viral_trends': {
        say('Hämtar trender…'); const r = await fetch(`${API}/viral/trends?kind=${a.kind}`, { signal }).then((x) => x.json()); if (!r.ok) throw new Error(r.error || 'Kunde inte hämta trender');
        return { cards: r.cards, kind: a.kind, text: r.cards.slice(0, 6).map((c) => `• ${c.name}: ${c.hook || c.format || ''}`).join('\n') };
      }
      case 'viral_mashup': {
        let cards = prev && prev.cards;
        if (!cards) { const r = await fetch(`${API}/viral/trends?kind=${a.kind}`, { signal }).then((x) => x.json()); cards = r.cards || []; }
        cards = cards.filter((c) => !minorText(JSON.stringify(c))); // bara trygga mönster (undviker nekade mixar)
        if (cards.length < 2) throw new Error('För få trendmönster att mixa just nu.');
        say('Mixar trendmönster…');
        let m; try { m = await json('/viral/mashup', { kind: a.kind, lane: st.lane, cards: cards.slice(0, a.picks || 2), idea: a.idea, seconds: a.seconds, format: '9:16' }); }
        catch (e) { if (e.name === 'AbortError' || cards.length < 4) throw e; say('Försöker med andra trender…'); m = await json('/viral/mashup', { kind: a.kind, lane: st.lane, cards: cards.slice(2, 2 + (a.picks || 2)), idea: a.idea, seconds: a.seconds, format: '9:16' }); }
        const shots = (m.shots || []).map((s) => `${s.t} ${s.visual}${s.text ? ` [${s.text}]` : ''}`).join('\n');
        return { prompt: m.prompt, shots, title: m.title, text: `${m.title}\n${m.prompt}` };
      }
      case 'save_template': {
        const p = promptOf(prev); if (!p) throw new Error('Ingen prompt att spara.');
        let n = []; try { n = JSON.parse(localStorage.getItem('kino.mymixes')) || []; } catch { /* tom */ }
        n.unshift({ title: a.title, prompt: p }); localStorage.setItem('kino.mymixes', JSON.stringify(n.slice(0, 50)));
        return { text: `Sparad i Mina mallar som "${a.title}".` };
      }
      case 'video': case 'music_video': case 'stock_clips': {
        const target = step.tool === 'video' ? 'video' : 'music';
        const prompt = [a.prompt || a.idea, promptOf(prev)].filter(Boolean).join('\n\n');
        if (minorText(prompt)) throw new Error(REFUSE);
        if (a.cinema && step.tool === 'video') st.cinemaPrefill = a.cinema;
        st.viral = { title: 'Från agenten', prompt, shots: (prev && prev.shots) || '', format: a.ratio || '9:16', target };
        if (step.tool === 'stock_clips') st.preset = 'stock';
        return { text: target === 'video' ? 'Video-sidan öppnas ifylld. Välj motor och tryck Skapa video – där syns kö och Avbryt.' : 'Musikvideo-sidan öppnas ifylld. Ladda upp låten och tryck Skapa musikvideo.', go: target === 'video' ? '#/video' : '#/music' };
      }
      case 'voice_swap': st.agentPick = { ...(st.agentPick || {}), voice: a.voice }; return { text: `Röstbyte öppnas med rösten ${a.voice} vald. Ladda upp låten och intyga rättigheterna.`, go: '#/motor?t=voice' };
      case 'face_swap': st.agentPick = { ...(st.agentPick || {}), artist: a.artist }; return { text: `Ansiktsbyte öppnas. Välj ${a.artist} för ansiktet i bilden/klippet.`, go: '#/motor?t=faceswap' };
      case 'openjutsu': st.agentPick = { ...(st.agentPick || {}), artist: a.artist }; return { text: `Karaktärsbyte öppnas med ${a.artist} vald. Ladda upp klippet (max 6 s).`, go: '#/motor?t=openjutsu' };
      case 'lip_sync': st.agentPick = { ...(st.agentPick || {}), lipsync: { artist: a.artist, text: a.text } }; return { text: `Läppsynk öppnas med ${a.artist} vald${a.text ? ' och repliken ifylld (text till tal)' : ''}. ${a.text ? '' : 'Välj ljud eller en del av låten, '}intyga samtycket och tryck Skapa läppsynk.`, go: '#/lappsynk' };
      case 'klipp': return { text: 'Klipp öppnas. Ladda upp den långa videon.', go: '#/klipp' };
      default: throw new Error('Okänt verktyg.');
    }
  }
  const AG = { msgs: null, live: new Map() };
  function agentView(v) {
    if (!AG.msgs) AG.msgs = agentLoad();
    let msgs = AG.msgs;
    const list = h('div', { class: 'agent-list', 'aria-live': 'polite' });
    const ta = h('textarea', { rows: 2, placeholder: 'Skriv ett önskemål, t.ex. "skapa en influencer-artist som gör neon-pop och gör 3 bilder av henne"' });
    const send = h('button', { class: 'text primary', type: 'button' }, 'Skicka');
    const clear = h('button', { class: 'text dim', type: 'button' }, 'Rensa');
    const store = () => { msgs = AG.msgs = agentSave(msgs); document.dispatchEvent(new CustomEvent('kino-agent')); };
    const live = AG.live; // msg index -> { ac, cancel }
    const argText = (s) => Object.entries(s.args || {}).filter(([k, x]) => x !== '' && x != null && k !== 'from').map(([k, x]) => `${k}: ${String(x).slice(0, 80)}`).join(' · ') + (s.args && s.args.from != null ? ` · från steg ${s.args.from + 1}` : '');
    function paint() {
      list.innerHTML = '';
      if (!msgs.length) list.append(empty('Vad vill du skapa?', 'Agenten planerar och kör KINO:s verktyg steg för steg. Tunga jobb (video, GPU, många bilder) frågar först.'));
      msgs.forEach((m, mi) => {
        const box = h('div', { class: `agent-msg ${m.role}` }, h('p', {}, m.text || ''));
        if (m.question) box.append(h('p', { class: 'agent-q' }, m.question));
        if (m.steps && m.steps.length) {
          const ol = h('ol', { class: 'agent-steps' });
          m.steps.forEach((s, si) => {
            const res = h('div', { class: 'agent-res' });
            if (s.out && s.out.images) res.append(h('div', { class: 'agent-thumbs' }, s.out.images.map((u) => h('a', { href: u, target: '_blank', rel: 'noopener' }, h('img', { src: u, alt: 'Resultat', loading: 'lazy' })))));
            if (s.out && s.out.text) res.append(h('pre', {}, s.out.text));
            if (s.out && s.out.go) res.append(h('a', { class: 'text', href: s.out.go }, 'Öppna igen ›'));
            if (s.out && s.out.link) res.append(h('a', { class: 'text dim', href: s.out.link }, 'Öppna Manus ›'));
            if (s.error) res.append(h('p', { class: 'status err' }, s.error));
            if (s.status === 'run' && s.msg) res.append(h('p', { class: 'meta' }, s.msg));
            const row = h('div', { class: 'quick' });
            if (s.status === 'confirm') row.append(h('button', { class: 'text primary', type: 'button', onclick: () => run(mi, si, true) }, 'Kör'), h('button', { class: 'text dim', type: 'button', onclick: () => stopRest(mi, si) }, 'Avbryt'));
            if (s.status === 'run') row.append(h('button', { class: 'text cancel', type: 'button', onclick: () => { const l = live.get(mi); if (l) { l.ac.abort(); if (l.cancel) l.cancel(); } } }, 'Avbryt'));
            ol.append(h('li', { class: `agent-step ${s.status}` }, h('div', { class: 'agent-st' }, h('b', {}, AGENT_TOOLS[s.tool] || s.tool), s.heavy ? h('span', { class: 'etag' }, 'tungt') : null, h('span', { class: 'chip' }, STATUS_SV[s.status] || s.status)),
              h('small', { class: 'meta' }, argText(s)), s.why ? h('small', {}, s.why) : null, res, row));
          });
          box.append(ol);
        }
        list.append(box);
      });
      list.lastElementChild && list.lastElementChild.scrollIntoView({ block: 'end' });
    }
    function stopRest(mi, si) { msgs[mi].steps.forEach((s, i) => { if (i >= si && ['wait', 'confirm'].includes(s.status)) s.status = 'cancel'; }); store(); paint(); }
    async function run(mi, from, confirmed) {
      const m = msgs[mi]; if (!m || live.has(mi)) return;
      for (let si = from; si < m.steps.length; si++) {
        const s = m.steps[si]; if (s.status === 'done') continue;
        if (['cancel', 'skip'].includes(s.status) && si !== from) continue;
        if (s.heavy && !(confirmed && si === from)) { s.status = 'confirm'; store(); paint(); return; }
        const dep = s.args && s.args.from != null ? m.steps[s.args.from] : null;
        if (dep && dep.status !== 'done') { s.status = 'skip'; s.error = `Steg ${s.args.from + 1} blev inte klart.`; continue; }
        const ac = new AbortController(); const l = { ac, cancel: null }; live.set(mi, l);
        const untrack = track(`Agent: ${AGENT_TOOLS[s.tool]}`, () => { ac.abort(); if (l.cancel) return l.cancel(); });
        s.status = 'run'; s.error = null; s.msg = ''; store(); paint();
        try {
          const outs = m.steps.map((x) => x.out || null);
          s.out = await agentRunStep(s, outs, { signal: ac.signal, say: (t) => { s.msg = t; document.dispatchEvent(new CustomEvent('kino-agent')); }, setCancel: (fn) => { l.cancel = fn; } });
          s.status = 'done';
        } catch (e) {
          s.status = e.cancelled || ac.signal.aborted ? 'cancel' : 'err'; s.error = s.status === 'cancel' ? 'Avbrutet. Jobbet stoppades.' : e.message;
        } finally { untrack(); live.delete(mi); }
        store(); paint();
        if (s.status !== 'done') { stopRest(mi, si + 1); return; }
        if (s.out && s.out.go) { const rest = m.steps.slice(si + 1).some((x) => x.status === 'wait'); if (rest) { m.steps[si + 1].status = 'confirm'; store(); } location.hash = s.out.go; return; }
        confirmed = false;
      }
    }
    async function ask() {
      const wish = ta.value.trim(); if (!wish || send.disabled) return;
      ta.value = ''; msgs.push({ role: 'user', text: wish, ts: Date.now() }); store(); paint();
      if (minorText(wish)) { msgs.push({ role: 'agent', text: REFUSE }); store(); return paint(); }
      send.disabled = true; const wait = { role: 'agent', text: 'Planerar…' }; msgs.push(wait); paint();
      try {
        const context = await agentContext();
        const history = msgs.slice(-8, -2).map((x) => ({ role: x.role, text: x.text }));
        const r = await fetch(`${API}/agent/plan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wish, lane: st.lane, context, history }) });
        const j = await r.json().catch(() => ({}));
        msgs.pop();
        if (!r.ok || !j.ok) msgs.push({ role: 'agent', text: j.error || `Kunde inte planera (servern svarade ${r.status}).` });
        else msgs.push({ role: 'agent', text: j.reply || (j.question ? '' : 'Här är planen.'), question: j.question || null, steps: (j.steps || []).map((s) => ({ ...s, status: 'wait' })), model: j.model });
      } catch (e) { msgs.pop(); msgs.push({ role: 'agent', text: `Kunde inte nå servern: ${e.message}` }); } finally { send.disabled = false; }
      store(); paint();
      const mi = msgs.length - 1; if (msgs[mi].steps && msgs[mi].steps.length) run(mi, 0, false);
    }
    send.onclick = ask;
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } });
    clear.onclick = () => { if (live.size) return alert('Stoppa pågående steg först.'); if (!msgs.length || confirm('Rensa hela chatten?')) { msgs = []; store(); paint(); } };
    v.append(pagehead('AI-agent', 'Skriv vad du vill göra på svenska. Agenten väljer verktyg, visar varje steg och frågar innan tunga jobb.'),
      h('p', { class: 'lanenote' + (st.lane === 'nsfw' ? ' nsfw' : '') }, `Läge: ${st.lane === 'nsfw' ? 'NSFW' : 'SFW'}. Samma säkerhetsregler som i resten av KINO: bara vuxna, inga verkliga eller kända personer i NSFW, röst- och ansiktsbyte bara ur dina samtyckta listor.`),
      list, h('div', { class: 'agent-input' }, ta, h('div', { class: 'quick' }, send, clear)));
    paint();
    const onAg = () => { if (!list.isConnected) return document.removeEventListener('kino-agent', onAg); msgs = AG.msgs; paint(); };
    document.addEventListener('kino-agent', onAg);
  }
  const VIEWS = { agent: agentView, persona: personaView, klipp: klippView, script: scriptView, '': home, image: imageView, video: videoView, music: musicView, edit: editView, timeline: timelineView,
    skapa: skapaView, viral: viralView, verktyg: verktygView, verk: verkView, lappsynk: lappsynkView, bibliotek: bibliotekView, installningar: settingsView, motor: settingsView };
  const ALIAS = { lipsync: 'lappsynk', 'läppsynk': 'lappsynk', library: 'bibliotek', create: 'skapa', tools: 'verktyg', settings: 'installningar', 'inställningar': 'installningar', results: 'verk', home: '' };
  const SECTION = { '': '', agent: 'skapa', persona: 'skapa', skapa: 'skapa', image: 'skapa', video: 'skapa', music: 'skapa', script: 'skapa', viral: 'skapa', verktyg: 'verktyg', edit: 'verktyg', timeline: 'verktyg', klipp: 'verktyg', motor: 'verktyg', lappsynk: 'verktyg', verk: 'verk', bibliotek: 'verk' };
  function route() {
    let raw = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
    let [k, q] = raw.split('?'); k = k || '';
    if (k in ALIAS) { location.replace(`#/${ALIAS[k]}${q ? '?' + q : ''}`); return; }
    const sec = SECTION[k];
    document.querySelectorAll('nav a').forEach((a) => {
      const on = a.dataset.sec === sec;
      a.classList.toggle('on', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    if (LAST_NAMES[k]) localStorage.setItem('kino.last', k);
    const v = $('#view'); v.innerHTML = ''; v.className = ''; v.dataset.route = k; window.scrollTo(0, 0);
    (VIEWS[k] || home)(v, q);
  }
  window.addEventListener('hashchange', route);
  // custom Swedish upload box for every visible file input (the input stays in place, so .files / onchange keep working)
  function dressFile(inp) {
    if (inp.dataset.dressed || inp.hidden) return; inp.dataset.dressed = '1';
    const multi = inp.multiple; const isVid = /video/.test(inp.accept); const isAud = /audio/.test(inp.accept) && !isVid;
    const name = h('span', { class: 'upname' }, 'Ingen fil vald');
    const btn = h('button', { type: 'button', class: 'upbox' }, h('span', { class: 'upicon', 'aria-hidden': 'true' }, '＋'), h('span', {}, h('b', {}, multi ? `Välj ${isVid ? 'filer' : isAud ? 'ljudfiler' : 'filer'}` : `Välj ${isVid ? 'video' : isAud ? 'ljudfil' : 'fil'}`), name));
    btn.onclick = (e) => { e.preventDefault(); inp.click(); };
    const upd = () => { const n = inp.files ? inp.files.length : 0; name.textContent = !n ? 'Ingen fil vald' : n === 1 ? inp.files[0].name : `${n} filer valda`; btn.classList.toggle('has', n > 0); };
    inp.addEventListener('change', upd); inp.classList.add('vh'); inp.tabIndex = -1; inp.after(btn); const lb = libButton(inp); if (lb) btn.after(lb);
  }
  new MutationObserver(() => document.querySelectorAll('#view input[type=file]').forEach(dressFile)).observe($('#view'), { childList: true, subtree: true });
  const fab = h('a', { class: 'agentfab', href: '#/agent', 'aria-label': 'Öppna AI-agenten', title: 'AI-agent' }, icon('agent')); document.body.append(fab);
  const paintFab = () => { fab.hidden = /^#\/agent/.test(location.hash); }; window.addEventListener('hashchange', paintFab); paintFab();
  paintLane(); route();
  colabHealth().then((r) => paintPill(r.state === 'on'));
})();
