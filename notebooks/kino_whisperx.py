"""WhisperX for the KINO session worker (Colab/Kaggle T4 or P100): real word times for Klipp and captions.

WhisperX (BSD-2-Clause, m-bain/whisperX) = faster-whisper large-v3 (fp16 on the GPU, int8_float16 if VRAM is short)
+ forced alignment with a wav2vec2 model per language (Swedish: KBLab/wav2vec2-large-voxrex-swedish, English:
torchaudio WAV2VEC2_ASR_BASE_960H, …) -> a start/end time for every word, not estimated.

Isolation: whisperx pins torch~=2.8 (and pyannote-audio 4); installing it into the notebook's own Python would
replace the torch that diffusers/MuseTalk use. So it lives in its own venv (uv, ~3–5 min first time, ~4 GB) and runs
as a subprocess: `<venv>/bin/python kino_whisperx.py run --audio a --out o.json --opts opts.json`.

Speaker diarization: WhisperX's built-in diarization uses pyannote/speaker-diarization-community-1, which is a
GATED model on Hugging Face (needs an HF token + accepting the terms). KINO does not use it. Instead, optional
"talare" labels come from SpeechBrain ECAPA-TDNN speaker embeddings (speechbrain/spkrec-ecapa-voxceleb,
Apache-2.0, not gated) on ~2–3 s windows + average-linkage clustering (own code below). It is simpler than
pyannote: overlapping speech is not separated and very short replies can land on the wrong speaker.

Modes (opts JSON):
  {"lang": "auto"|"sv"|"en"|…, "diarize": true/false}                          transcribe + align (+ talare)
  {"lang": "sv", "align": [{"start": s, "end": s, "text": "…"}, …]}           align KNOWN text only (TTS captions)

Everything above `def _run` is plain Python (no torch/whisperx) so it can be imported by the notebook process and
unit-tested without a GPU.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

WHISPERX_PIN = "whisperx==3.8.6"
PIP_PACKAGES = [WHISPERX_PIN, "speechbrain>=1.0.3,<2"]
MODEL = os.environ.get("KINO_WHISPERX_MODEL", "large-v3")
VENV = Path(os.environ.get("KINO_WHISPERX_VENV") or (Path(tempfile.gettempdir()) / "kino_whisperx_venv"))
CACHE = Path(os.environ.get("KINO_WHISPERX_CACHE") or (Path(tempfile.gettempdir()) / "kino_whisperx_cache"))
READY_FLAG = VENV / ".kino_ready"
ECAPA = "speechbrain/spkrec-ecapa-voxceleb"
WARM_LANGS = ("sv", "en")
_lock = threading.Lock()


def eprint(*a):
    print(*a, file=sys.stderr, flush=True)


# ----------------------------------------------------------------- pure helpers (unit-tested)

_PUNCT_END = re.compile(r"[.!?…]$")


def estimate_words(text: str, start: float, end: float):
    """Spread the words of one segment over [start, end] by letter count (used only when no alignment model exists)."""
    words = [w for w in str(text or "").split() if w]
    if not words:
        return []
    t0, t1 = float(start), max(float(start) + 0.2, float(end))
    weights = [len(w) + 2 for w in words]
    tot = float(sum(weights))
    out, acc = [], 0.0
    for w, k in zip(words, weights):
        s = t0 + (t1 - t0) * acc / tot
        acc += k
        out.append({"w": w, "s": round(s, 3), "e": round(t0 + (t1 - t0) * acc / tot, 3)})
    return out


def fill_word_times(words, seg_start: float, seg_end: float):
    """WhisperX leaves numbers/symbols it cannot align without start/end. Interpolate them between the neighbours."""
    n = len(words)
    out = [dict(w) for w in words]
    i = 0
    while i < n:
        if out[i].get("s") is not None and out[i].get("e") is not None:
            i += 1
            continue
        j = i
        while j < n and (out[j].get("s") is None or out[j].get("e") is None):
            j += 1
        left = out[i - 1]["e"] if i > 0 else float(seg_start)
        right = out[j]["s"] if j < n else float(seg_end)
        right = max(right, left + 0.08 * (j - i))
        step = (right - left) / (j - i)
        for k in range(i, j):
            out[k]["s"] = round(left + step * (k - i), 3)
            out[k]["e"] = round(left + step * (k - i + 1), 3)
        i = j
    for w in out:
        if w["e"] < w["s"] + 0.02:
            w["e"] = round(w["s"] + 0.02, 3)
    return out


def normalize_segments(segments, aligned: bool):
    """WhisperX segments -> [{start, end, text, words:[{w, s, e, p?}], est}] with every word timed."""
    out = []
    for seg in segments or []:
        text = str(seg.get("text") or "").strip()
        s0 = float(seg.get("start") or 0.0)
        s1 = float(seg.get("end") or s0)
        raw = seg.get("words") or []
        if aligned and raw:
            words = []
            for w in raw:
                word = str(w.get("word") or "").strip()
                if not word:
                    continue
                item = {"w": word, "s": w.get("start"), "e": w.get("end")}
                if w.get("score") is not None:
                    item["p"] = round(float(w["score"]), 3)
                words.append(item)
            words = fill_word_times(words, s0, s1)
            est = False
        else:
            words, est = estimate_words(text, s0, s1), True
        if not words:
            continue
        out.append({"start": round(words[0]["s"], 3), "end": round(words[-1]["e"], 3), "text": text or " ".join(w["w"] for w in words),
                    "words": words, "est": est})
    return out


def speech_windows(segments, target: float = 2.5, max_gap: float = 0.6):
    """Group timed words into ~2.5 s windows for speaker embeddings. Returns [(start, end, [(seg_i, word_i), …])]."""
    wins, cur, cs, ce = [], [], None, None
    for si, seg in enumerate(segments):
        for wi, w in enumerate(seg["words"]):
            if cur and (w["s"] - ce > max_gap or w["e"] - cs > target * 1.6):
                wins.append((cs, ce, cur))
                cur, cs = [], None
            if cs is None:
                cs = w["s"]
            ce = w["e"]
            cur.append((si, wi))
            if ce - cs >= target and _PUNCT_END.search(w["w"]):
                wins.append((cs, ce, cur))
                cur, cs = [], None
    if cur:
        wins.append((cs, ce, cur))
    return wins


def cluster_embeddings(emb, threshold: float = 0.6, max_speakers: int = 6, weights=None):
    """Average-linkage agglomerative clustering on cosine distance (numpy). Returns a label per row (0 = first heard)."""
    import numpy as np
    E = np.asarray(emb, dtype=np.float64)
    n = len(E)
    if n == 0:
        return []
    if n == 1:
        return [0]
    E = E / (np.linalg.norm(E, axis=1, keepdims=True) + 1e-9)
    D = 1.0 - E @ E.T
    np.fill_diagonal(D, np.inf)
    size = np.ones(n)
    alive = np.ones(n, dtype=bool)
    members = {i: [i] for i in range(n)}
    k = n
    while k > 1:
        idx = np.argmin(D)
        a, b = divmod(int(idx), n)
        d = D[a, b]
        if d > threshold and k <= max_speakers:
            break
        # Lance–Williams update for average linkage
        newrow = (size[a] * D[a] + size[b] * D[b]) / (size[a] + size[b])
        D[a, :] = newrow
        D[:, a] = newrow
        D[a, a] = np.inf
        D[b, :] = np.inf
        D[:, b] = np.inf
        size[a] += size[b]
        alive[b] = False
        members[a].extend(members.pop(b))
        k -= 1
    labels = [0] * n
    for lab, (root, mem) in enumerate(members.items()):
        for m in mem:
            labels[m] = lab
    # tiny clusters (<4 % of the speech) are folded into the nearest bigger one
    w = np.asarray(weights if weights is not None else np.ones(n), dtype=np.float64)
    tot = w.sum() or 1.0
    labs = sorted(set(labels))
    cent = {L: E[[i for i in range(n) if labels[i] == L]].mean(axis=0) for L in labs}
    share = {L: w[[i for i in range(n) if labels[i] == L]].sum() / tot for L in labs}
    big = [L for L in labs if share[L] >= 0.04] or [max(labs, key=lambda L: share[L])]
    for L in labs:
        if L in big:
            continue
        tgt = max(big, key=lambda B: float(cent[L] @ cent[B]))
        labels = [tgt if x == L else x for x in labels]
    # relabel by first appearance
    order, out = {}, []
    for x in labels:
        if x not in order:
            order[x] = len(order)
        out.append(order[x])
    return out


def assign_speakers(segments, windows, labels):
    """Write 'spk' on every word (nearest window for words not covered) and a majority 'speaker' per segment."""
    if not windows:
        return segments
    owner = {}
    for (a, b, idx), lab in zip(windows, labels):
        for key in idx:
            owner[key] = lab
    mids = [((a + b) / 2, lab) for (a, b, _), lab in zip(windows, labels)]
    for si, seg in enumerate(segments):
        dur = {}
        for wi, w in enumerate(seg["words"]):
            lab = owner.get((si, wi))
            if lab is None:
                t = (w["s"] + w["e"]) / 2
                lab = min(mids, key=lambda m: abs(m[0] - t))[1]
            w["spk"] = int(lab)
            dur[lab] = dur.get(lab, 0.0) + (w["e"] - w["s"])
        if dur:
            seg["speaker"] = int(max(dur, key=dur.get))
    return segments


# ----------------------------------------------------------------- venv management (notebook process)

def venv_python() -> Path:
    return VENV / "bin" / "python"


def is_ready() -> bool:
    try:
        return READY_FLAG.read_text().strip() == WHISPERX_PIN and venv_python().exists()
    except Exception:
        return False


def _lib_env():
    """ctranslate2 needs the cuDNN/cuBLAS that pip put into the venv; point the loader at them."""
    env = dict(os.environ)
    libs = sorted(str(p) for p in VENV.glob("lib/python*/site-packages/nvidia/*/lib") if p.is_dir())
    if libs:
        env["LD_LIBRARY_PATH"] = ":".join(libs + [env.get("LD_LIBRARY_PATH", "")]).strip(":")
    env["HF_HOME"] = str(CACHE / "hf")
    env["TORCH_HOME"] = str(CACHE / "torch")
    env.setdefault("PYTHONUNBUFFERED", "1")
    env.pop("HF_TOKEN", None)  # nothing here needs a token (no gated models)
    return env


def _sh(cmd, timeout=1800):
    subprocess.check_call([str(c) for c in cmd], timeout=timeout)


def ensure(log=eprint) -> Path:
    """Create the venv and install whisperx (once). Thread-safe; idempotent."""
    with _lock:
        if is_ready():
            return venv_python()
        log("WhisperX: skapar egen Python-miljö (första gången ca 3–5 min)")
        CACHE.mkdir(parents=True, exist_ok=True)
        uv = shutil.which("uv")
        if not uv:
            try:
                _sh([sys.executable, "-m", "pip", "install", "-q", "uv"], 600)
                uv = shutil.which("uv") or str(Path(sys.executable).parent / "uv")
            except Exception as err:
                log(f"uv gick inte att installera ({err}); använder virtualenv + pip")
                uv = None
        if uv:
            if not venv_python().exists():
                _sh([uv, "venv", "--python", sys.executable, VENV], 600)
            _sh([uv, "pip", "install", "--python", venv_python(), "-q", *PIP_PACKAGES], 2400)
        else:
            _sh([sys.executable, "-m", "pip", "install", "-q", "virtualenv"], 600)
            if not venv_python().exists():
                _sh([sys.executable, "-m", "virtualenv", "-q", VENV], 600)
            _sh([venv_python(), "-m", "pip", "install", "-q", *PIP_PACKAGES], 2400)
        READY_FLAG.write_text(WHISPERX_PIN)
        log("WhisperX installerat")
        return venv_python()


def prefetch(log=eprint):
    """Install + download weights in the background (network/disk only, no VRAM)."""
    py = ensure(log)
    subprocess.run([str(py), str(Path(__file__).resolve()), "warm"], env=_lib_env(), timeout=3600, check=True)


def run(audio: Path, work: Path, opts: dict, timeout: int = 2400) -> Path:
    """Run one transcription/alignment job in the venv. Returns the result JSON path."""
    py = ensure()
    work = Path(work)
    opts_file = work / "wx_opts.json"
    out = work / "result.json"
    opts_file.write_text(json.dumps(opts or {}, ensure_ascii=False))
    p = subprocess.run([str(py), str(Path(__file__).resolve()), "run", "--audio", str(audio), "--out", str(out), "--opts", str(opts_file)],
                       env=_lib_env(), timeout=timeout, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if p.returncode != 0 or not out.exists():
        tail = " | ".join((p.stderr or "").strip().splitlines()[-3:])
        raise RuntimeError(f"WhisperX misslyckades: {tail[-280:] or p.returncode}")
    return out


# ----------------------------------------------------------------- inside the venv

def _free():
    import gc
    gc.collect()
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass


def _warm():
    from huggingface_hub import snapshot_download
    snapshot_download(f"Systran/faster-whisper-{MODEL}")
    try:
        import whisperx
        for lang in WARM_LANGS:
            try:
                m, meta = whisperx.load_align_model(language_code=lang, device="cpu")
                del m, meta
            except Exception as err:
                eprint(f"align-modell {lang}: {err}")
    except Exception as err:
        eprint(f"whisperx import: {err}")
    try:
        snapshot_download(ECAPA)
    except Exception as err:
        eprint(f"ECAPA: {err}")
    print("warm ok", flush=True)


def _diarize(audio, segments, max_speakers=6):
    import numpy as np
    import torch
    from speechbrain.inference.speaker import EncoderClassifier
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    enc = EncoderClassifier.from_hparams(source=ECAPA, savedir=str(CACHE / "ecapa"), run_opts={"device": dev})
    wins = speech_windows(segments)
    long_w = [w for w in wins if w[1] - w[0] >= 0.8]
    if len(long_w) < 2:
        return segments, 1 if long_w else 0
    embs, wts = [], []
    sr = 16000
    with torch.no_grad():
        for a, b, _ in long_w:
            x = audio[int(a * sr): int(b * sr)]
            e = enc.encode_batch(torch.tensor(x, dtype=torch.float32)[None].to(dev)).squeeze().detach().cpu().numpy()
            embs.append(e)
            wts.append(b - a)
    labels = cluster_embeddings(np.stack(embs), max_speakers=max_speakers, weights=wts)
    del enc
    _free()
    segments = assign_speakers(segments, long_w, labels)
    return segments, len(set(labels))


def _run(args):
    import torch
    import whisperx
    opts = json.loads(Path(args.opts).read_text() or "{}")
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    lang = (opts.get("lang") or "auto").split("-")[0].lower()
    lang = None if lang in ("", "auto") else lang
    audio = whisperx.load_audio(args.audio)
    dur = len(audio) / 16000.0
    notes = []
    compute = None
    known = opts.get("align") or None
    if known:
        segments = [{"start": float(s["start"]), "end": float(s["end"]), "text": str(s["text"])} for s in known if str(s.get("text", "")).strip()]
        language = lang or "sv"
    else:
        tries = [("float16", 8), ("int8_float16", 4)] if dev == "cuda" else [("int8", 4)]
        res = None
        for i, (ct, bs) in enumerate(tries):
            try:
                try:
                    model = whisperx.load_model(MODEL, dev, compute_type=ct, language=lang, download_root=None)
                except Exception as vad_err:  # pyannote VAD import trouble -> silero VAD
                    if "out of memory" in str(vad_err).lower():
                        raise
                    notes.append(f"pyannote-VAD gick inte ({str(vad_err)[:80]}), använde Silero-VAD")
                    model = whisperx.load_model(MODEL, dev, compute_type=ct, language=lang, vad_method="silero")
                res = model.transcribe(audio, batch_size=bs, language=lang)
                compute = ct
                del model
                _free()
                break
            except RuntimeError as err:
                if "out of memory" in str(err).lower() and i + 1 < len(tries):
                    notes.append(f"{ct} fick slut på VRAM, provade {tries[i + 1][0]}")
                    _free()
                    continue
                raise
        language = res.get("language") or lang or "en"
        segments = res.get("segments") or []
    aligned, align_model = False, None
    if segments:
        try:
            model_a, meta = whisperx.load_align_model(language_code=language, device=dev)
            align_model = str((meta or {}).get("language") or language)
            r = whisperx.align(segments, model_a, meta, audio, dev, return_char_alignments=False)
            segments = r.get("segments") or segments
            aligned = True
            del model_a
            _free()
        except Exception as err:
            notes.append(f"ingen ordjustering för språket '{language}' ({str(err)[:100]}) – ordtiderna uppskattas")
    segs = normalize_segments(segments, aligned)
    diar = None
    if opts.get("diarize") and segs and not known:
        try:
            segs, n = _diarize(audio, segs, int(opts.get("max_speakers") or 6))
            diar = {"engine": "speechbrain-ecapa", "speakers": n}
        except Exception as err:
            notes.append(f"talaridentifiering misslyckades ({str(err)[:100]})")
    out = {"ok": True, "engine": "whisperx", "model": MODEL if not known else None, "compute": compute, "device": dev,
           "language": language, "aligned": aligned, "alignModel": align_model, "duration": round(dur, 3),
           "mode": "align" if known else "transcribe", "diarization": diar, "segments": segs, "notes": notes}
    Path(args.out).write_text(json.dumps(out, ensure_ascii=False))
    print("ok", len(segs), flush=True)


def main(argv=None):
    import argparse
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd")
    r = sub.add_parser("run")
    r.add_argument("--audio", required=True)
    r.add_argument("--out", required=True)
    r.add_argument("--opts", required=True)
    sub.add_parser("warm")
    a = p.parse_args(argv)
    if a.cmd == "run":
        _run(a)
    elif a.cmd == "warm":
        _warm()
    else:
        p.print_help()


if __name__ == "__main__":
    main()
