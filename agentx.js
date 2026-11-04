/* KINO AI-agent, tillägg: kör riktiga jobb från chatten (server /agent/run), förlopp, resultat inline.
   Laddas före app.js; app.js anropar KinoAgentX.init(deps) och använder små krokar. */
(function () {
  const RUNNABLE = { video: 1, music_video: 1, stock_clips: 1, lip_sync: 1, remake_clip: 1 };
  const PAGE_SV = { '#/video': 'Öppna Video-sidan ›', '#/music': 'Öppna Musikvideo ›', '#/lappsynk': 'Öppna Läppsynk ›', '#/gor-om': 'Öppna Gör om klipp ›', '#/snabbvideo': 'Öppna Snabbvideo ›' };
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
      const r = await serverRun(tool, a, ids, ctl);
      if (!r) return null;
      for (const m of r.media || []) { const bucket = m.kind === 'image' ? 'image' : m.kind === 'audio' ? 'music' : 'video'; (st.results[bucket] || []).unshift({ name: m.url.split('/').pop(), url: m.url, engineName: `Agent: ${tool}` }); }
      return { text: r.text || 'Klart.', media: (r.media || []).map((m) => ({ kind: m.kind, url: abs(m.url) })), page: r.page, job: { tool, args: a, attachments: ids, script: r.script, spec: r.spec, session: r.session } };
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
    return { RUNNABLE, serverRun, runStep, mediaBox };
  }
  window.KinoAgentX = { init };
})();
