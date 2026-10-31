/* KINO Cinema-läge: kamerakontroller -> välformulerade prompttillägg per motor. UMD: window.KinoCinema / require('./cinema'). */
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.KinoCinema = factory(); }(typeof self !== 'undefined' ? self : this, function () {
  // [id, svensk etikett, engelsk promptfras]
  const OPT = {
    camera: [['', 'Valfri'], ['alexa', 'ARRI Alexa 35 (digital bio)', 'shot on ARRI Alexa 35, natural cinematic dynamic range'], ['red', 'RED V-Raptor (skarp digital)', 'shot on RED V-Raptor 8K, crisp high-detail digital cinema look'], ['film35', '35 mm filmkamera', 'shot on 35mm motion picture film, organic film grain'], ['film16', '16 mm film', 'shot on 16mm film, visible grain, soft indie texture'], ['super8', 'Super 8', 'Super 8 home movie look, heavy grain, gate weave, faded colors'], ['imax', 'IMAX 65 mm', 'shot on IMAX 65mm, immense clarity and scale'], ['vhs', 'VHS-kamera', '1990s VHS camcorder look, tracking lines, chroma bleed'], ['phone', 'Mobilkamera', 'shot on a modern smartphone, vertical social video look'], ['dslr', 'Spegelreflex / mirrorless', 'shot on a full-frame mirrorless camera, clean modern look']],
    lens: [['', 'Valfri'], ['14', '14 mm ultravidvinkel', '14mm ultra-wide lens, exaggerated perspective'], ['24', '24 mm vidvinkel', '24mm wide-angle lens'], ['35', '35 mm', '35mm lens, natural storytelling perspective'], ['50', '50 mm normal', '50mm lens, true-to-eye perspective'], ['85', '85 mm porträtt', '85mm portrait lens, flattering compression'], ['135', '135 mm tele', '135mm telephoto lens, strong background compression'], ['anamorphic', 'Anamorfisk', 'anamorphic lens, oval bokeh, horizontal lens flares, 2.39:1 feel'], ['macro', 'Makro', 'macro lens, extreme close detail']],
    aperture: [['', 'Valfri'], ['1.4', 'f/1.4 – mycket grunt skärpedjup', 'aperture f/1.4, very shallow depth of field, creamy bokeh, subject isolated'], ['2', 'f/2', 'aperture f/2, shallow depth of field, soft background'], ['2.8', 'f/2.8', 'aperture f/2.8, moderately shallow depth of field'], ['4', 'f/4', 'aperture f/4, balanced depth of field'], ['8', 'f/8', 'aperture f/8, deep focus, most of the scene sharp'], ['16', 'f/16 – allt skarpt', 'aperture f/16, everything in sharp focus, deep depth of field']],
    move: [['', 'Valfri'], ['static', 'Stilla (stativ)', 'static locked-off camera on a tripod'], ['dolly-in', 'Dolly in', 'slow dolly in toward the subject'], ['dolly-out', 'Dolly ut', 'slow dolly out away from the subject'], ['pan-left', 'Panorering vänster', 'smooth pan to the left'], ['pan-right', 'Panorering höger', 'smooth pan to the right'], ['tilt-up', 'Tilt upp', 'camera tilts up'], ['tilt-down', 'Tilt ned', 'camera tilts down'], ['orbit', 'Kretsa runt (orbit)', 'camera orbits around the subject in a smooth arc'], ['crane', 'Kranåkning', 'sweeping crane shot rising up'], ['handheld', 'Handhållen', 'handheld camera, subtle natural shake'], ['fpv', 'FPV-drönare', 'fast FPV drone flight, dynamic swooping motion'], ['drone', 'Drönare (lugn)', 'smooth aerial drone shot'], ['zoom-in', 'Zooma in', 'slow optical zoom in'], ['zoom-out', 'Zooma ut', 'slow optical zoom out'], ['tracking', 'Följ (tracking)', 'tracking shot following the subject']],
    shot: [['', 'Valfri'], ['ecu', 'Extrem närbild', 'extreme close-up'], ['cu', 'Närbild', 'close-up shot'], ['mcu', 'Halvnära', 'medium close-up'], ['ms', 'Halvbild', 'medium shot'], ['cowboy', 'Amerikansk (knä)', 'cowboy shot framed from mid-thigh up'], ['fs', 'Helbild', 'full body shot'], ['ws', 'Totalbild', 'wide shot'], ['ews', 'Extrem total', 'extreme wide establishing shot'], ['ots', 'Över axeln', 'over-the-shoulder shot'], ['pov', 'POV', 'first-person point-of-view shot']],
    angle: [['', 'Valfri'], ['eye', 'Ögonhöjd', 'eye-level angle'], ['low', 'Lågvinkel (grodperspektiv)', 'low angle looking up, heroic'], ['high', 'Högvinkel', 'high angle looking down'], ['top', 'Rakt ovanifrån', "top-down bird's-eye view"], ['dutch', 'Snedvinkel (dutch)', 'dutch tilt, canted frame'], ['worm', 'Från marken', "worm's-eye view from the ground"]],
    light: [['', 'Valfri'], ['golden', 'Gyllene timmen', 'warm golden hour sunlight, long soft shadows'], ['blue', 'Blå timmen', 'blue hour twilight, cool ambient light'], ['soft', 'Mjukt fönsterljus', 'soft natural window light'], ['rembrandt', 'Rembrandt', 'Rembrandt lighting, triangle of light on the cheek, dramatic'], ['high-key', 'High-key', 'bright high-key lighting, minimal shadows'], ['low-key', 'Low-key / noir', 'low-key chiaroscuro lighting, deep shadows'], ['neon', 'Neon', 'neon practical lights, magenta and cyan glow'], ['backlit', 'Motljus', 'strong backlight, rim light and glowing silhouette'], ['overcast', 'Mulet', 'soft overcast daylight'], ['practical', 'Praktiska lampor', 'motivated practical lamps in frame, warm pools of light'], ['volumetric', 'Ljusstrålar i dis', 'volumetric light rays through haze']],
    grade: [['', 'Valfri'], ['teal-orange', 'Teal & orange', 'teal and orange color grade'], ['kodak', 'Kodak Portra / Vision3', 'Kodak Vision3 film stock emulation, warm skin tones'], ['fuji', 'Fuji Eterna', 'Fujifilm Eterna film stock, muted greens, gentle contrast'], ['cinestill', 'CineStill 800T', 'CineStill 800T look, halation around lights, tungsten balance'], ['bw', 'Svartvitt', 'black and white, rich contrast'], ['bleach', 'Bleach bypass', 'bleach bypass, desaturated high-contrast'], ['pastel', 'Pastell', 'soft pastel color palette'], ['vivid', 'Mättat', 'vivid saturated colors'], ['muted', 'Dämpat / naturligt', 'muted natural color grade'], ['technicolor', 'Technicolor', 'vintage three-strip Technicolor look']],
  };
  const LABELS = { camera: 'Kamera / filmlook', lens: 'Objektiv', aperture: 'Bländare (skärpedjup)', move: 'Kamerarörelse', shot: 'Bildutsnitt', angle: 'Vinkel', light: 'Ljus', grade: 'Färg / filmstock' };
  const KEYS = Object.keys(OPT);
  const PRESETS = [
    ['Blockbuster', { camera: 'imax', lens: 'anamorphic', aperture: '2.8', move: 'crane', shot: 'ws', angle: 'low', light: 'golden', grade: 'teal-orange' }],
    ['Indie-drama', { camera: 'film16', lens: '35', aperture: '2', move: 'handheld', shot: 'mcu', angle: 'eye', light: 'soft', grade: 'kodak' }],
    ['Porträtt', { camera: 'alexa', lens: '85', aperture: '1.4', move: 'dolly-in', shot: 'cu', angle: 'eye', light: 'rembrandt', grade: 'kodak' }],
    ['Noir', { camera: 'film35', lens: '50', aperture: '4', move: 'static', shot: 'ms', angle: 'low', light: 'low-key', grade: 'bw' }],
    ['Neon-musikvideo', { camera: 'red', lens: '24', aperture: '2', move: 'orbit', shot: 'ms', angle: 'low', light: 'neon', grade: 'cinestill' }],
    ['Drönarepos', { camera: 'imax', lens: '24', aperture: '8', move: 'fpv', shot: 'ews', angle: 'high', light: 'golden', grade: 'vivid' }],
    ['Dokumentär', { camera: 'dslr', lens: '35', aperture: '4', move: 'handheld', shot: 'ms', angle: 'eye', light: 'overcast', grade: 'muted' }],
    ['90-talshemvideo', { camera: 'vhs', lens: '24', aperture: '8', move: 'handheld', shot: 'ms', angle: 'eye', light: 'practical', grade: 'muted' }],
    ['TikTok-mobil', { camera: 'phone', lens: '24', aperture: '2.8', move: 'handheld', shot: 'mcu', angle: 'eye', light: 'soft', grade: 'vivid' }],
  ];
  const phrase = (k, id) => { const o = (OPT[k] || []).find((x) => x[0] === String(id == null ? '' : id)); return o && o[2] ? o[2] : ''; };
  /** Keep only known ids (agent args, saved templates). */
  function normalize(c) { const o = {}; if (!c || typeof c !== 'object') return o; for (const k of KEYS) { const v = String(c[k] == null ? '' : c[k]); if (v && OPT[k].some((x) => x[0] === v)) o[k] = v; } if (typeof c.custom === 'string' && c.custom.trim()) o.custom = c.custom.replace(/\s+/g, ' ').trim().slice(0, 300); return o; }
  const isEmpty = (c) => !Object.keys(normalize(c)).length;
  /**
   * Compile to a prompt addition. kind: 'image' | 'video'. engine: engine id (style tuned: short tag list for
   * SDXL/Horde-type engines, sentences for video/LLM-style engines). Camera movement only for video.
   */
  function compile(c0, { kind = 'image', engine = '' } = {}) {
    const c = normalize(c0); const parts = [];
    const shot = phrase('shot', c.shot); const angle = phrase('angle', c.angle);
    const lens = phrase('lens', c.lens); const ap = phrase('aperture', c.aperture);
    const cam = phrase('camera', c.camera); const light = phrase('light', c.light); const grade = phrase('grade', c.grade);
    const move = kind === 'video' ? phrase('move', c.move) : '';
    const tags = /sdxl|horde|pollinations|turbo|flux1schnell/i.test(engine);
    if (tags) { [shot, angle, lens, ap, cam, light, grade, move, c.custom].filter(Boolean).forEach((x) => parts.push(x)); return parts.length ? parts.join(', ') : ''; }
    const framing = [shot, angle].filter(Boolean).join(', ');
    if (framing) parts.push(`${framing[0].toUpperCase()}${framing.slice(1)}`);
    if (move) parts.push(`Camera movement: ${move}`);
    const optics = [lens, ap].filter(Boolean).join(', '); if (optics) parts.push(`Lens: ${optics}`);
    if (cam) parts.push(cam[0].toUpperCase() + cam.slice(1));
    if (light) parts.push(`Lighting: ${light}`);
    if (grade) parts.push(`Color: ${grade}`);
    if (c.custom) parts.push(c.custom);
    return parts.length ? parts.join('. ') + '.' : '';
  }
  /** Prompt + cinema addition (never duplicates an addition already in the prompt). */
  function apply(prompt, c, opts) { const add = compile(c, opts); const p = String(prompt || '').trim(); if (!add || p.includes(add)) return p; return p ? `${p.replace(/[.\s]+$/, '')}. ${add}` : add; }
  const summary = (c0) => { const c = normalize(c0); return KEYS.filter((k) => c[k]).map((k) => OPT[k].find((x) => x[0] === c[k])[1]).join(' · ') + (c.custom ? (KEYS.some((k) => c[k]) ? ' · ' : '') + 'egen text' : ''); };
  return { OPT, LABELS, KEYS, PRESETS, normalize, compile, apply, summary, isEmpty };
}));
