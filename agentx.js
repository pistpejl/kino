/* KINO AI-agent, tillägg: kör riktiga jobb från chatten (server /agent/run), förlopp, resultat inline.
   Laddas före app.js; app.js anropar KinoAgentX.init(deps) och använder små krokar. */
(function () {
  const COACH = { critique: 1, hooks: 1, script_coach: 1, cta: 1, series: 1 };
  const RUNNABLE = { critique: 1, hooks: 1, script_coach: 1, cta: 1, series: 1, produce: 1, video: 1, music_video: 1, stock_clips: 1, lip_sync: 1, remake_clip: 1 };
  const PAGE_SV = { '#/video': 'Öppna Video-sidan ›', '#/music': 'Öppna Musikvideo ›', '#/lappsynk': 'Öppna Läppsynk ›', '#/gor-om': 'Öppna Gör om klipp ›', '#/snabbvideo': 'Öppna Snabbvideo ›' };
  const EDIT_RE = /^(korta|förläng|byt|ny hook|ändra|större text|mindre text|gul|vit|rosa|cyan|text(en)? (upptill|uppe|nere|i mitten)|ingen (text|musik)|ta bort (scen|sista|första|andra|tredje)|lägg till cta|snabbare|långsammare|gör den kortare|ord för ord)/i;
  const STEP_ICON = { wait: '○', run: '◐', done: '●', err: '✕', skip: '–' };
  function init(d) {
    const { API, h, abs, st } = d;
    const sleep = (ms, signal) => d.abortable(new Promise((ok) => setTimeout(ok, ms)), signal);
    async function dataUrlFile(url, name) { const b = await fetch(url).then((r) => r.blob()); return new File([b], name, { type: b.type || 'image/jpeg' }); }
    /** Starta verktyget på servern och polla. null = verktyget saknar serverrecept (sidan öppnas i stället). */
    async function serverRun(tool, args, attIds, ctl) {
      const { signal, say, setCancel } = ctl;
      const r = await fetch(`${API}/agent/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tool, args, attachments: attIds, lane: st.lane }), signal });
      const j = await r.json().catch(() => ({}));
      if (r.status === 404 && j.error === 'no_recipe') return null;
      if (!r.ok || !j.ok) throw new Error(j.error || `Servern svarade ${r.status}`);
      const id = j.jobId; setCancel && setCancel(() => fetch(`${API}/agent/run/jobs/${id}`, { method: 'DELETE' }).catch(() => null));
      for (;;) {
        await sleep(2500, signal);
        const s = await fetch(`${API}/agent/run/jobs/${id}`, { signal }).then((x) => x.json()).catch(() => null);
        if (!s) continue;
        if (s.steps && ctl.step) ctl.step.live = s.steps;
        say && say(`${Math.round((s.progress || 0) * 100)} % – ${s.message || 'kör'}`, s.progress);
        if (s.status === 'done') return s.result;
        if (s.status === 'cancelled') throw Object.assign(new Error('Avbrutet'), { cancelled: true });
        if (s.status === 'error') throw Object.assign(new Error(s.error || 'Jobbet misslyckades.'), { needs: s.needs, refused: s.refused });
      }
    }
    /** Kör ett agentsteg som riktigt jobb. Returnerar null om sidan ska öppnas (saknade filer, inget recept). */
    async function runStep(step, prev, ctl, files) {
      const a = { ...(step.args || {}) }; const tool = step.tool;
      if (!RUNNABLE[tool]) return null;
      if (COACH[tool]) return coachStep(tool, a, ctl, files);
      const ids = (files || []).map((f) => f.id).filter(Boolean);
      if (tool === 'video' || tool === 'music_video' || tool === 'stock_clips') {
        const p = [a.prompt || a.idea, prev && (prev.prompt || prev.idea)].filter(Boolean).join('\n\n');
        if (tool === 'video') a.prompt = p; else a.idea = p;
        if (tool === 'video' && a.cinema && window.KinoCinema && p) a.prompt = window.KinoCinema.apply(p, a.cinema, { kind: 'video' });
        if (tool !== 'video' && !(files || []).some((f) => f.kind === 'audio')) return null; // låten saknas -> sidan
      }
      if (tool === 'remake_clip' && !((files || []).some((f) => f.kind === 'video') && (files || []).some((f) => f.kind === 'image'))) {
        const ar = a.artist && d.rosterLocal().find((x) => x.name.toLowerCase() === a.artist.toLowerCase());
        if (!(files || []).some((f) => f.kind === 'video')) return null;
        if (ar && ar.photos && ar.photos[0]) { ctl.say('Laddar upp artistens bild…'); const up = await d.attUpload(await dataUrlFile(ar.photos[0], `${ar.name}.jpg`), () => {}); ids.unshift(up.id); }
        else return null;
      }
      if (tool === 'lip_sync') {
        const ar = d.rosterLocal().find((x) => x.name.toLowerCase() === String(a.artist || '').toLowerCase());
        if (!(files || []).some((f) => f.kind === 'image')) {
          if (!ar || !ar.photos || !ar.photos[0] || !ar.consent) return null;
          ctl.say('Laddar upp porträttet…'); const up = await d.attUpload(await dataUrlFile(ar.photos[0], `${ar.name}.jpg`), () => {}); ids.unshift(up.id);
        }
        if (!a.text && !(files || []).some((f) => f.kind === 'audio')) return null;
      }
      ctl.say('Startar jobbet på servern…');
      if (tool === 'produce' && d.profile) a.profile = d.profile();
      const r = await serverRun(tool, a, ids, { ...ctl, step });
      if (!r) return null;
      for (const m of r.media || []) { const bucket = m.kind === 'image' ? 'image' : m.kind === 'audio' ? 'music' : 'video'; (st.results[bucket] || []).unshift({ name: m.url.split('/').pop(), url: m.url, engineName: `Agent: ${tool}` }); }
      return { text: r.text || 'Klart.', media: (r.media || []).map((m) => ({ kind: m.kind, url: abs(m.url) })), page: r.page, job: { tool, args: a, attachments: ids, spec: r.spec, keyframes: r.keyframes, session: r.session }, steps: r.steps };
    }
    /** Resultat inline i chatten + länkar. */
    function mediaBox(out) {
      const box = h('div', { class: 'agent-media' });
      for (const m of out.media || []) {
        box.append(m.kind === 'video' ? h('video', { src: m.url, controls: true, playsinline: true, preload: 'metadata' }) : m.kind === 'audio' ? h('audio', { src: m.url, controls: true }) : h('img', { src: m.url, alt: 'Resultat', loading: 'lazy' }));
        box.append(h('div', { class: 'quick' }, h('a', { class: 'text', href: m.url, target: '_blank', rel: 'noopener' }, 'Öppna filen ›'), h('a', { class: 'text dim', href: m.url, download: '' }, 'Ladda ner')));
      }
      if (out.page) box.append(h('a', { class: 'text dim', href: out.page }, PAGE_SV[out.page] || 'Öppna sidan ›'));
      return box;
    }
    let UI = null; // { store, paint, live, msgs, ask } från agentvyn
    const post = async (p, body, signal) => { const r = await fetch(`${API}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal }); const j = await r.json().catch(() => ({})); if (!r.ok || !j.ok) throw new Error(j.error || `Servern svarade ${r.status}`); return j; };
    async function coachStep(tool, a, ctl, files) {
      const state = UI ? lastState(UI.msgs) : null; const ids = (files || []).map((f) => f.id).filter(Boolean);
      if (tool === 'critique') { ctl.say('Granskar klippet…'); const j = await post('/agent/critique', { state, attachments: ids }, ctl.signal); return { text: j.summary || 'Granskning:', coach: { type: 'critique', ...j }, state }; }
      if (tool === 'hooks') { ctl.say('Skriver 10 hooks…'); const j = await post('/agent/hooks', { idea: a.idea || (state && state.spec.title) }, ctl.signal); return { text: '10 hook-varianter (generiska mönster):', coach: { type: 'hooks', hooks: j.hooks } }; }
      if (tool === 'script_coach') { ctl.say('Läser manuset rad för rad…'); const text = a.text || (state ? state.spec.sentences.map((x) => x.text).join('\n') : ''); if (!text) throw new Error('Klistra in manuset (eller gör en video först).'); const j = await post('/agent/coach', { text }, ctl.signal); return { text: 'Feedback rad för rad:', coach: { type: 'lines', lines: j.lines } }; }
      if (tool === 'cta') { const j = await post('/agent/cta', { idea: a.idea || (state && state.spec.title), goal: a.goal }, ctl.signal); return { text: 'CTA-förslag:', coach: { type: 'cta', ctas: j.ctas } }; }
      const j = await post('/agent/series', { idea: a.idea, count: a.count }, ctl.signal); return { text: `${j.title} (3-2-1-serie)`, coach: { type: 'series', episodes: j.episodes } };
    }
    function coachBox(out) {
      const c = out.coach; const box = h('div', { class: 'agent-coach' });
      if (c.type === 'critique') {
        const L = { hook: 'Hook', pacing: 'Tempo', captions: 'Textning', cta: 'CTA' };
        box.append(h('div', { class: 'scores' }, Object.entries(c.scores || {}).map(([k, v]) => h('div', { class: 'score' }, h('b', {}, `${L[k] || k} ${v}/10`), h('span', { class: 'bar' }, h('i', { style: `width:${v * 10}%` }))))));
        box.append(h('ul', {}, (c.fixes || []).map((f) => h('li', {}, f.text))));
        const ops = (c.fixes || []).flatMap((f) => f.ops || []);
        if (c.canApply && ops.length && out.state) box.append(h('button', { class: 'text primary', type: 'button', onclick: () => runEdit(out.state, { command: 'Tillämpa åtgärderna', ops }, []) }, 'Tillämpa åtgärderna'));
      }
      if (c.type === 'hooks') box.append(h('ol', {}, c.hooks.map((x) => h('li', {}, h('b', {}, `${x.type}: `), x.text, x.visual ? h('small', { class: 'meta' }, ` – ${x.visual}`) : null, ' ', h('button', { class: 'text dim', type: 'button', onclick: () => UI && UI.ask(`Producera en video med hooken "${x.text}"`) }, 'Gör utkast')))));
      if (c.type === 'lines') box.append(h('ol', {}, c.lines.map((x) => h('li', { class: `v-${x.verdict}` }, h('b', {}, `[${x.verdict}] `), x.line, h('br'), h('small', {}, `Tips: ${x.tip}`), x.rewrite && x.rewrite !== x.line ? h('small', { class: 'meta' }, ` → ${x.rewrite}`) : null))));
      if (c.type === 'cta') box.append(h('ul', {}, c.ctas.map((x) => h('li', {}, h('b', {}, `${x.goal} (${x.placement}): `), x.text, h('small', { class: 'meta' }, ` – ${x.why}`)))));
      if (c.type === 'series') box.append(h('ol', {}, c.episodes.map((e) => h('li', {}, h('b', {}, e.title), h('br'), h('small', {}, `Hook: ${e.hook} · Länk: ${e.link} · CTA: ${e.cta}`), ' ', h('button', { class: 'text dim', type: 'button', onclick: () => UI && UI.ask(`Producera en video: ${e.title}. Hook: ${e.hook}. ${e.content || ''} Avsluta med: ${e.cta}`) }, 'Gör utkast')))));
      return box;
    }
    function liveSteps(list) { return h('ol', { class: 'agent-live' }, list.map((x) => h('li', { class: x.status }, h('span', {}, STEP_ICON[x.status] || '○'), h('b', {}, x.name), x.note ? h('small', { class: 'meta' }, x.note) : null))); }
    /** Extra UI per steg: live-steglista, media, rörelseval före Kör. */
    function extras(s, repaint, ui) {
      if (ui) UI = ui;
      const f = document.createDocumentFragment();
      if (s.out && s.out.coach) f.append(coachBox(s.out));
      const list = (s.status === 'run' && s.live) || (s.out && s.out.steps);
      if (list) f.append(liveSteps(list));
      if (s.out && (s.out.media || s.out.page)) f.append(mediaBox(s.out));
      if (s.status === 'confirm' && (s.tool === 'produce' || s.tool === 'music_video')) {
        s.args = s.args || {}; const ai = s.tool === 'produce' ? s.args.motion === 'ai' : s.args.motion === 'hf-auto';
        f.append(h('div', { class: 'seg', role: 'group' },
          h('button', { type: 'button', class: ai ? '' : 'on', onclick: () => { s.args.motion = s.tool === 'produce' ? 'stills' : 'none'; repaint(); } }, 'Stillbilder + Ken Burns (gratis)'),
          h('button', { type: 'button', class: ai ? 'on' : '', onclick: () => { s.args.motion = s.tool === 'produce' ? 'ai' : 'hf-auto'; repaint(); } }, 'AI-rörelse (kvot)')));
      }
      return f;
    }
    /** Senaste resultat med storyboard (för ändring med ord). */
    function lastState(msgs) {
      for (let i = msgs.length - 1; i >= 0; i--) for (const s of [...(msgs[i].steps || [])].reverse()) {
        const j = s.out && s.out.job; if (!j) continue;
        if (j.spec) return { spec: j.spec, keyframes: j.keyframes || [] };
        if (j.script) return { spec: { title: j.script.title, sentences: j.script.sentences, lang: (j.args && j.args.lang) || 'sv', ratio: (j.args && j.args.ratio) || '9:16', subs: j.script.subs, transition: j.script.transition }, keyframes: [] };
      }
      return null;
    }
    /** "korta första scenen", "större text" … -> gör om bara den delen. true = hanterat. */
    async function maybeEdit(wish, atts, msgs, ui) {
      UI = ui; if (!EDIT_RE.test(wish.trim())) return false;
      const state = lastState(msgs); if (!state) return false;
      await runEdit(state, { command: wish }, atts); return true;
    }
    async function runEdit(state, { command: wish, ops }, atts) {
      const ui = UI; const msgs = ui.msgs;
      const step = { tool: 'edit', args: { command: wish }, status: 'run', heavy: false, why: 'Gör om bara den berörda delen med sparat storyboard.' };
      const msg = { role: 'agent', text: 'Ändrar…', steps: [step] }; msgs.push(msg); ui.store(); ui.paint();
      const ac = new AbortController(); const mi = msgs.length - 1; ui.live.set(mi, { ac, cancel: null });
      try {
        const r = await fetch(`${API}/agent/edit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: wish, ops, state, attachments: atts.filter((x) => x.id).map((x) => x.id), lane: st.lane }), signal: ac.signal });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) throw new Error(j.error || `Servern svarade ${r.status}`);
        if (!j.jobId) { msg.text = j.question || 'Jag förstod inte ändringen.'; step.status = 'skip'; return; }
        ui.live.get(mi).cancel = () => fetch(`${API}/agent/run/jobs/${j.jobId}`, { method: 'DELETE' }).catch(() => null);
        msg.text = 'Här är den ändrade versionen.';
        for (;;) {
          await sleep(2500, ac.signal);
          const s = await fetch(`${API}/agent/run/jobs/${j.jobId}`, { signal: ac.signal }).then((x) => x.json()).catch(() => null); if (!s) continue;
          step.live = s.steps; step.msg = `${Math.round((s.progress || 0) * 100)} % – ${s.message || ''}`; ui.paint();
          if (s.status === 'done') { const o = s.result; step.out = { text: o.text, media: (o.media || []).map((m) => ({ kind: m.kind, url: abs(m.url) })), page: o.page, steps: o.steps, job: { tool: 'edit', spec: o.spec, keyframes: o.keyframes } }; step.status = 'done'; break; }
          if (s.status === 'error' || s.status === 'cancelled') throw Object.assign(new Error(s.error || 'Ändringen misslyckades.'), { cancelled: s.status === 'cancelled' });
        }
      } catch (e) { step.status = e.cancelled || ac.signal.aborted ? 'cancel' : 'err'; step.error = step.status === 'cancel' ? 'Avbrutet.' : e.message; }
      finally { ui.live.delete(mi); ui.store(); ui.paint(); }
    }
    return { RUNNABLE, serverRun, runStep, mediaBox, extras, maybeEdit, runEdit, lastState, setUI: (u) => { UI = u; } };
  }
  window.KinoAgentX = { init };
})();
