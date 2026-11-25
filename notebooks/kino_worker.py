#!/usr/bin/env python3
"""KINO rendering-session worker (pull model).

The notebook polls the KINO server for jobs and uploads results. No inbound
tunnel is required. SFW only.

  python kino_worker.py --server https://grok-musik-video.onrender.com --code AB12-CD34

Set KINO_WORKER_MOCK=1 (or --mock) to skip GPU models and write a short mp4
with ffmpeg — used by tests and to check the pairing loop.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

DEFAULT_SERVER = os.environ.get("KINO_SERVER", "https://grok-musik-video.onrender.com")
SUPPORTS = ["video", "wan-2.2", "wan-2.2-ti2v-5b", "ltx-video", "lipsync", "musetalk", "musetalk-alive", "whisperx"]
# 'whisperx' = speech-to-text with real word times (forced alignment) for Klipp and word-by-word captions,
# optional speaker labels (SpeechBrain ECAPA, not the gated pyannote model). See kino_whisperx.py.
# 'qwen38-vl' = Qwen3.8 27B abliterated (vision-language, image+text in → text out) in llama.cpp, added at
# registration when the GPU has room (kino_qwen38.py). It is unloaded before every other GPU job.
READY: set = set()  # engines whose code + weights are downloaded; sent with every heartbeat
# 'musetalk' = real MuseTalk 1.5 lip sync on a still or a video; 'musetalk-alive' = the still is
# first animated with LTX/Wan ("Levande bild + läppsynk"), then lip-synced. See kino_musetalk.py.
# Kandinsky S2V Lite is documented at ~28 GB even with VAE tiling — it does not
# fit a 16 GB T4/P100, so it is not advertised as a supported engine here.


def eprint(*a):
    print(*a, file=sys.stderr, flush=True)


class WorkerClient:
    def __init__(self, server: str, token: str | None = None, timeout: int = 40):
        self.server = server.rstrip("/")
        self.token = token
        self.timeout = timeout

    def _req(self, method: str, path: str, data=None, headers=None, raw=False, timeout=None):
        url = self.server + path
        hdrs = {"User-Agent": "kino-session-worker/1.0", "Accept": "application/json"}
        if self.token:
            hdrs["Authorization"] = f"Bearer {self.token}"
        if headers:
            hdrs.update(headers)
        body = data
        if isinstance(data, dict) and not raw:
            hdrs["Content-Type"] = "application/json"
            body = json.dumps(data).encode()
        req = urllib.request.Request(url, data=body, headers=hdrs, method=method)
        try:
            with urllib.request.urlopen(req, timeout=timeout or self.timeout) as r:
                payload = r.read()
                ctype = r.headers.get("Content-Type", "")
                if "application/json" in ctype:
                    return json.loads(payload.decode() or "{}")
                return payload
        except urllib.error.HTTPError as err:
            msg = err.read().decode("utf-8", "replace")[:400]
            raise RuntimeError(f"HTTP {err.code} {path}: {msg}") from err

    def pair_register(self, code: str, platform: str, gpu: str):
        r = self._req("POST", "/api/kino/worker/register", {
            "code": code, "platform": platform, "gpu": gpu, "supports": supports_list(),
        })
        if not r.get("ok") or not r.get("token"):
            raise RuntimeError(r.get("message") or "register failed")
        self.token = r["token"]
        return r

    def heartbeat(self):
        return self._req("POST", "/api/kino/worker/heartbeat", {"ready": sorted(READY)})

    def next_job(self, wait: int = 25):
        return self._req("GET", f"/api/kino/worker/next?wait={int(wait)}", timeout=wait + 15)

    def download(self, path: str, dest: Path):
        data = self._req("GET", path, raw=True, timeout=120)
        dest.write_bytes(data)
        return dest

    def submit(self, job_id: str, file: Path | None, engine_name: str, error: str | None = None):
        boundary = "----KinoWorkerBoundary7f3"
        parts = []

        def add(name, value, filename=None, mime=None):
            disp = f'Content-Disposition: form-data; name="{name}"'
            if filename:
                disp += f'; filename="{filename}"'
            headers = disp + "\r\n"
            if mime:
                headers += f"Content-Type: {mime}\r\n"
            payload = value if isinstance(value, (bytes, bytearray)) else str(value).encode()
            parts.append(b"--" + boundary.encode() + b"\r\n" + headers.encode() + b"\r\n" + payload + b"\r\n")

        add("jobId", job_id)
        add("engineName", engine_name)
        if error:
            add("error", error)
        if file and file.exists():
            mime = "application/json" if file.suffix == ".json" else "video/mp4"
            add("file", file.read_bytes(), filename=file.name, mime=mime)
        parts.append(b"--" + boundary.encode() + b"--\r\n")
        body = b"".join(parts)
        return self._req(
            "POST",
            "/api/kino/worker/result",
            data=body,
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
            raw=True,
            timeout=120,
        )


def qwen38_wanted() -> bool:
    try:
        import kino_qwen38  # type: ignore
        if not kino_qwen38.enabled():
            return False
        return os.environ.get("KINO_WORKER_MOCK") == "1" or kino_qwen38.plan() is not None
    except Exception:
        return False


def supports_list() -> list:
    return SUPPORTS + (["qwen38-vl"] if qwen38_wanted() else [])


def qwen38_unload():
    try:
        import kino_qwen38  # type: ignore
        kino_qwen38.unload()
    except Exception as err:
        eprint(f"Qwen3.8 unload: {err}")


def detect_platform():
    if os.environ.get("KINO_PLATFORM"):
        return os.environ["KINO_PLATFORM"]
    if os.path.isdir("/kaggle"):
        return "kaggle"
    if os.path.isdir("/content") or "COLAB_RELEASE_TAG" in os.environ:
        return "colab"
    return "colab"


def detect_gpu():
    try:
        out = subprocess.check_output(
            ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
            text=True, timeout=8,
        ).strip()
        if "P100" in out:
            return "P100"
        if "T4" in out:
            return "T4"
        return (out.split("\n")[0] or "GPU")[:24]
    except Exception:
        return os.environ.get("KINO_GPU", "T4")


def mock_render(job: dict, image: Path | None, work: Path, audio: Path | None = None) -> Path:
    """Short 480p clip via ffmpeg. Not a real model — for wiring tests only.

    Avoid `ffmpeg -loop 1 -i still` with `-t` only as an output option: on some
    builds that input never EOFs and the encode hangs. A lavfi color source has
    a finite duration. `-nostdin` keeps ffmpeg from blocking on stdin.
    """
    out = work / "out.mp4"
    seconds = max(1, min(5, float(job.get("seconds") or 2)))
    ratio = job.get("ratio") or "9:16"
    w, h = {"9:16": (480, 832), "16:9": (832, 480), "1:1": (512, 512)}.get(ratio, (480, 832))
    src = f"color=c=0x1a1a1a:s={w}x{h}:d={seconds:.2f}:r=16"
    cmd = [
        "ffmpeg", "-nostdin", "-y", "-f", "lavfi", "-i", src,
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-an", str(out),
    ]
    # Image is still downloaded by the worker; it is not required for the mock mux.
    _ = image
    if audio is not None and Path(audio).exists():
        # Lip-sync wiring test: silent colour clip + the job's audio, like the real MuseTalk output.
        cmd = [
            "ffmpeg", "-nostdin", "-y", "-f", "lavfi", "-i", src, "-i", str(audio),
            "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-shortest", str(out),
        ]
    subprocess.check_call(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20)
    return out


def mock_asr(job: dict, work: Path) -> Path:
    """Fake WhisperX result (no model) so the server wiring can be tested end to end."""
    opts = job.get("options") or {}
    segs = []
    known = opts.get("align") or []
    if known:
        for s in known:
            words = str(s.get("text") or "").split()
            a, b = float(s.get("start") or 0), float(s.get("end") or 0)
            step = (b - a) / max(1, len(words))
            segs.append({"start": a, "end": b, "text": s.get("text"), "est": False,
                         "words": [{"w": w, "s": round(a + i * step, 3), "e": round(a + (i + 1) * step, 3)} for i, w in enumerate(words)]})
    else:
        t = 0.5
        for k, line in enumerate(["Det här är ett test av KINO.", "Nu pratar någon annan här."]):
            words = []
            for w in line.split():
                words.append({"w": w, "s": round(t, 3), "e": round(t + 0.35, 3), "spk": k})
                t += 0.4
            segs.append({"start": words[0]["s"], "end": words[-1]["e"], "text": line, "words": words, "est": False, "speaker": k})
            t += 0.5
    out = work / "result.json"
    out.write_text(json.dumps({"ok": True, "engine": "whisperx", "model": "mock", "language": opts.get("lang") if opts.get("lang") not in (None, "", "auto") else "sv",
                               "aligned": True, "mode": "align" if known else "transcribe",
                               "diarization": {"engine": "speechbrain-ecapa", "speakers": 2} if opts.get("diarize") and not known else None,
                               "segments": segs, "notes": ["mock"]}, ensure_ascii=False))
    return out


def real_asr(job: dict, audio: Path, work: Path) -> Path:
    """WhisperX in its own venv (subprocess). MuseTalk is unloaded first so the card is free."""
    try:
        import kino_worker_models as km  # type: ignore
        km._unload_musetalk()
        km._free()
    except Exception:
        pass
    import kino_whisperx as wx  # type: ignore
    out = wx.run(audio, work, job.get("options") or {})
    READY.add("whisperx")
    return out


def real_render(job: dict, image: Path | None, audio: Path | None, work: Path, video: Path | None = None) -> Path:
    """Lazy-import GPU pipelines that fit 16 GB Turing (sm75): fp16 + SDPA, no FA2/FP8."""
    # Imported only on the GPU machine; the mock path never reaches here.
    from kino_worker_models import render_job  # type: ignore
    return render_job(job, image, audio, work, video)


def engine_label(job: dict) -> str:
    eng = (job.get("engine") or "video").lower()
    if job.get("kind") == "vlm":
        return "Qwen3.8 27B abliterated (llama.cpp)"
    if job.get("kind") == "asr" or eng == "whisperx":
        return "WhisperX large-v3 + ordjustering"
    if eng == "musetalk-alive":
        return "MuseTalk 1.5 läppsynk + levande bild (LTX-Video)"
    if job.get("kind") == "lipsync" or eng.startswith("musetalk"):
        return "MuseTalk 1.5 läppsynk"
    return eng


def process_job(client: WorkerClient, job: dict, mock: bool) -> None:
    work = Path(tempfile.mkdtemp(prefix="kino-job-"))
    try:
        image = audio = None
        if job.get("imageUrl"):
            image = client.download(job["imageUrl"], work / "start.jpg")
        if job.get("audioUrl"):
            audio = client.download(job["audioUrl"], work / "audio.wav")
        video = None
        if job.get("videoUrl"):
            video = client.download(job["videoUrl"], work / "input.mp4")
        if job.get("kind") == "vlm":
            import kino_qwen38  # type: ignore
            req = client._req("GET", job["requestUrl"], timeout=120)
            if not isinstance(req, dict):
                req = json.loads(bytes(req).decode() or "{}")
            out = kino_qwen38.mock_answer(req, work) if mock else kino_qwen38.answer(req, work)
            client.submit(job["id"], out, f"GPU-session ({engine_label(job)})")
            eprint(f"ok job {job['id']} (Qwen3.8)")
            return
        if not mock:
            qwen38_unload()  # free the GPU for video / lip sync / WhisperX
        if job.get("kind") == "asr":
            if not audio:
                raise RuntimeError("Transkribering kräver ljud.")
            out = mock_asr(job, work) if mock else real_asr(job, audio, work)
            name = f"GPU-session ({'mock, ' if mock else ''}{engine_label(job)})"
        elif mock:
            out = mock_render(job, image, work, audio if job.get("kind") == "lipsync" else None)
            name = f"GPU-session (mock ffmpeg, {engine_label(job)})"
        else:
            out = real_render(job, image, audio, work, video)
            name = f"GPU-session ({engine_label(job)})"
        client.submit(job["id"], out, name)
        eprint(f"ok job {job['id']}")
    except Exception as err:
        eprint(f"fail job {job.get('id')}: {err}")
        try:
            client.submit(job["id"], None, "GPU-session", error=str(err)[:300])
        except Exception as submit_err:
            eprint(f"could not report failure: {submit_err}")
    finally:
        shutil.rmtree(work, ignore_errors=True)


def prefetch_musetalk():
    """Fetch MuseTalk code + weights in the background (disk/network only, no VRAM)."""
    try:
        import kino_musetalk  # type: ignore
        kino_musetalk.prefetch()
        eprint("MuseTalk 1.5 redo (vikter hämtade)")
    except Exception as err:
        eprint(f"MuseTalk-förhämtning misslyckades, försöker igen vid första läppsynken: {err}")


def prefetch_whisperx():
    """Install WhisperX in its own venv and download large-v3 + Swedish/English alignment models (no VRAM)."""
    try:
        import kino_whisperx  # type: ignore
        kino_whisperx.prefetch()
        READY.add("whisperx")
        eprint("WhisperX redo (large-v3 + ordjustering sv/en hämtade)")
    except Exception as err:
        eprint(f"WhisperX-förhämtning misslyckades, försöker igen vid första transkriberingen: {err}")


def prefetch_qwen38():
    """llama.cpp + GGUF + mmproj to disk in the background (no VRAM)."""
    try:
        import kino_qwen38  # type: ignore
        p = kino_qwen38.prefetch()
        READY.add("qwen38-vl")
        eprint(f"Qwen3.8 27B hämtad ({p['quant']}) – laddas vid första bild-/manusfrågan")
    except Exception as err:
        eprint(f"Qwen3.8-förhämtning misslyckades, försöker igen vid första frågan: {err}")


def heartbeat_loop(client: WorkerClient, stop: threading.Event):
    while True:
        try:
            client.heartbeat()
        except Exception as err:
            eprint(f"heartbeat: {err}")
        if stop.wait(15):
            return


def run_loop(server: str, code: str, mock: bool = False, platform: str | None = None, gpu: str | None = None):
    client = WorkerClient(server)
    info = client.pair_register(code, platform or detect_platform(), gpu or detect_gpu())
    # Never print the session token.
    eprint(f"ansluten: {info.get('platform')} {info.get('gpu')} (id {info.get('workerId')})")
    if mock:
        READY.add("whisperx")  # nothing to download in mock mode; report it with the first heartbeat
        if "qwen38-vl" in (info.get("supports") or []):
            READY.add("qwen38-vl")
    stop = threading.Event()
    hb = threading.Thread(target=heartbeat_loop, args=(client, stop), daemon=True)
    hb.start()
    if not mock and os.environ.get("KINO_MUSETALK_PREFETCH", "1") != "0":
        threading.Thread(target=prefetch_musetalk, daemon=True).start()
    if not mock and os.environ.get("KINO_WHISPERX_PREFETCH", "1") != "0":
        threading.Thread(target=prefetch_whisperx, daemon=True).start()
    if not mock and os.environ.get("KINO_QWEN38_PREFETCH", "1") != "0" and "qwen38-vl" in (info.get("supports") or []):
        threading.Thread(target=prefetch_qwen38, daemon=True).start()
    try:
        while True:
            nxt = client.next_job(25)
            job = nxt.get("job") if isinstance(nxt, dict) else None
            if not job:
                continue
            eprint(f"job {job.get('id')} {job.get('kind')} {job.get('seconds')}s")
            process_job(client, job, mock)
    finally:
        stop.set()


def main(argv=None):
    p = argparse.ArgumentParser(description="KINO rendering-session worker")
    p.add_argument("--server", default=DEFAULT_SERVER)
    p.add_argument("--code", default=os.environ.get("KINO_PAIR_CODE", ""))
    p.add_argument("--mock", action="store_true", default=os.environ.get("KINO_WORKER_MOCK") == "1")
    p.add_argument("--platform", default=os.environ.get("KINO_PLATFORM"))
    p.add_argument("--gpu", default=os.environ.get("KINO_GPU"))
    args = p.parse_args(argv)
    if not args.code.strip():
        eprint("Klistra in parningskoden från KINO (--code eller KINO_PAIR_CODE).")
        return 2
    run_loop(args.server, args.code.strip(), mock=args.mock, platform=args.platform, gpu=args.gpu)
    return 0


if __name__ == "__main__":
    sys.exit(main())
