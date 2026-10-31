/* KINO Tillgångsbibliotek: uppladdningar + färdiga verk (bild, video, ljud) i webbläsarens IndexedDB.
 * Blobbar sparas lokalt (ingenting laddas upp någonstans). Gränser: max 80 MB per fil, ca 600 MB totalt –
 * äldsta posterna rensas automatiskt när gränsen nås. window.KinoLib */
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.KinoLib = factory(); }(typeof self !== 'undefined' ? self : this, function () {
  const DB = 'kino-library'; const STORE = 'assets'; const MAX_ITEM = 80 * 1048576; const MAX_TOTAL = 600 * 1048576;
  const KINDS = ['image', 'video', 'audio'];
  const kindOf = (type, name) => { const t = String(type || ''); const n = String(name || '').toLowerCase(); if (/^image\//.test(t) || /\.(png|jpe?g|webp|gif|avif)$/.test(n)) return 'image'; if (/^video\//.test(t) || /\.(mp4|mov|webm|m4v|mkv)$/.test(n)) return 'video'; if (/^audio\//.test(t) || /\.(mp3|wav|m4a|ogg|flac|aac|opus)$/.test(n)) return 'audio'; return null; };
  let dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      if (typeof indexedDB === 'undefined') return rej(new Error('IndexedDB saknas i den här webbläsaren'));
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => { const s = r.result.createObjectStore(STORE, { keyPath: 'id' }); s.createIndex('created', 'created'); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error || new Error('IndexedDB kunde inte öppnas'));
    }).catch((e) => { dbp = null; throw e; });
    return dbp;
  }
  const tx = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction(STORE, mode); const s = t.objectStore(STORE); let out; Promise.resolve(fn(s, (v) => { out = v; })).catch(rej); t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('avbröts (fullt lagringsutrymme?)')); }); };
  const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const listeners = new Set(); const emit = () => listeners.forEach((f) => { try { f(); } catch { /* ignore */ } });
  async function all() { return (await tx('readonly', async (s, set) => set(await req(s.getAll())))) || []; }
  /** Sorted newest first; filter by origin ('upload' | 'verk') and kind. */
  async function list({ origin, kind } = {}) { return (await all()).filter((a) => (!origin || a.origin === origin) && (!kind || a.kind === kind)).sort((a, b) => b.created - a.created); }
  async function usage() { const l = await all(); return { count: l.length, bytes: l.reduce((n, a) => n + (a.size || 0), 0), max: MAX_TOTAL }; }
  async function trim(extra) {
    const l = (await all()).sort((a, b) => a.created - b.created); let tot = l.reduce((n, a) => n + (a.size || 0), 0) + extra; const drop = [];
    for (const a of l) { if (tot <= MAX_TOTAL) break; tot -= a.size || 0; drop.push(a.id); }
    if (drop.length) await tx('readwrite', (s) => drop.forEach((id) => s.delete(id)));
    return drop.length;
  }
  /** Same file (name + size + origin) is stored once. Returns the stored record (without re-reading). */
  async function add({ blob, url, name, kind, origin = 'upload', meta = {} }) {
    kind = kind || kindOf(blob && blob.type, name || url); if (!KINDS.includes(kind)) return null;
    if (!blob && url) blob = await fetch(url).then((r) => (r.ok ? r.blob() : null)).catch(() => null); // serverns filer är tillfälliga: spara en kopia
    if (blob && blob.size > MAX_ITEM) blob = null; // för stor: bara länk sparas (om den finns)
    if (!blob && !url) return null;
    const size = blob ? blob.size : 0;
    const dup = (await all()).find((a) => a.origin === origin && a.name === name && a.size === size && (blob ? true : a.url === url));
    if (dup) return dup;
    await trim(size);
    const rec = { id: `a_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, kind, origin, name: String(name || `${kind}-${Date.now()}`).slice(0, 120), type: blob ? blob.type : '', size, blob: blob || null, url: blob ? null : url, created: Date.now(), meta };
    await tx('readwrite', (s) => s.put(rec)); emit(); return rec;
  }
  async function remove(id) { await tx('readwrite', (s) => s.delete(id)); emit(); }
  async function clear(origin) { if (!origin) await tx('readwrite', (s) => s.clear()); else { const ids = (await list({ origin })).map((a) => a.id); await tx('readwrite', (s) => ids.forEach((id) => s.delete(id))); } emit(); }
  const urls = new Map();
  /** Object URL for display (cached per id). */
  function src(a) { if (!a) return ''; if (!a.blob) return a.url || ''; if (!urls.has(a.id)) urls.set(a.id, URL.createObjectURL(a.blob)); return urls.get(a.id); }
  /** A File for <input type=file> / FormData. */
  async function file(a) { const b = a.blob || (a.url ? await fetch(a.url).then((r) => { if (!r.ok) throw new Error('Filen finns inte längre på servern'); return r.blob(); }) : null); if (!b) throw new Error('Filen saknas'); return new File([b], a.name, { type: b.type || a.type || '' }); }
  return { add, list, remove, clear, usage, src, file, kindOf, onChange: (f) => { listeners.add(f); return () => listeners.delete(f); }, MAX_ITEM, MAX_TOTAL, KINDS };
}));
