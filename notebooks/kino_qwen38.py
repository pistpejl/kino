#!/usr/bin/env python3
"""Qwen3.8 27B abliterated (vision-language: image + text in, text out) for the KINO session worker.

Model: huihui-ai/Huihui-Qwen3.8-27B-abliterated, GGUF quants from
huihui-ai/Huihui-Qwen3.8-27B-abliterated-GGUF + mmproj-model-bf16.gguf (the vision tower).
It does not generate images; KINO uses it to look at images/video frames and to write manus/prompts.

Runs in llama.cpp's llama-server on 127.0.0.1 (never exposed). Quant by VRAM:
  2×T4 (Kaggle, ~30 GB)  → UD-Q4_K_XL  (17.4 GB, split over both GPUs), ctx 16k
  1×T4 (Colab, ~15 GB)   → UD-IQ3_XXS  (11.0 GB), ctx 8k
Override: KINO_QWEN38_QUANT=<file name>, KINO_QWEN38_CTX=<n>. KINO_QWEN38=0 turns it off.

llama.cpp: the official CUDA release binary needs glibc ≥ 2.38 (Ubuntu 24.04). On older images (Kaggle/Colab
22.04) it is built from the same tag for sm75 only (~10–20 min, once per session, done during prefetch).
The server is stopped (by its own process handle) before any video/lip-sync job so the GPU is free, and
started again on the next Qwen job (~1–3 min to load from disk).
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tarfile
import threading
import time
import urllib.request
from pathlib import Path

REPO = "huihui-ai/Huihui-Qwen3.8-27B-abliterated-GGUF"
MMPROJ = "mmproj-model-bf16.gguf"
QUANT_2GPU = "Huihui-Qwen3.8-27B-abliterated-UD-Q4_K_XL.gguf"
QUANT_1GPU = "Huihui-Qwen3.8-27B-abliterated-UD-IQ3_XXS.gguf"
LLAMA_TAG = os.environ.get("KINO_LLAMA_TAG", "b12728")
PORT = int(os.environ.get("KINO_QWEN38_PORT", "8093"))
ROOT = Path(os.environ.get("KINO_QWEN38_DIR", "/root/.cache/kino-qwen38"))
LABEL = "Qwen3.8 27B abliterated (llama.cpp)"

_lock = threading.RLock()
_proc: subprocess.Popen | None = None
_log = None


def eprint(*a):
    print(*a, file=sys.stderr, flush=True)


def enabled() -> bool:
    return os.environ.get("KINO_QWEN38", "1") != "0"


def gpus() -> list[int]:
    """Total MiB per visible GPU."""
    try:
        out = subprocess.check_output(["nvidia-smi", "--query-gpu=memory.total", "--format=csv,noheader,nounits"], text=True, timeout=10)
        return [int(x.strip()) for x in out.strip().splitlines() if x.strip()]
    except Exception:
        return []


def plan() -> dict | None:
    """Pick quant + context for the visible GPUs; None if it cannot fit."""
    mem = gpus()
    total = sum(mem)
    quant = os.environ.get("KINO_QWEN38_QUANT")
    if len(mem) >= 2 and total >= 29000:
        p = {"quant": quant or QUANT_2GPU, "ctx": 16384, "split": True}
    elif mem and max(mem) >= 14500:
        p = {"quant": quant or QUANT_1GPU, "ctx": 8192, "split": False}
    else:
        return None
    if os.environ.get("KINO_QWEN38_CTX"):
        p["ctx"] = int(os.environ["KINO_QWEN38_CTX"])
    return p


def glibc_ok(need=(2, 38)) -> bool:
    try:
        v = os.confstr("CS_GNU_LIBC_VERSION").split()[-1]
        return tuple(int(x) for x in v.split(".")[:2]) >= need
    except Exception:
        return False


def _download(url: str, dest: Path):
    tmp = dest.with_suffix(dest.suffix + ".part")
    with urllib.request.urlopen(url, timeout=120) as r, open(tmp, "wb") as f:
        shutil.copyfileobj(r, f, 1 << 20)
    tmp.rename(dest)


def _prebuilt() -> Path | None:
    d = ROOT / f"llama-{LLAMA_TAG}"
    exe = d / "llama-server"
    if exe.exists():
        return exe
    base = f"https://github.com/ggml-org/llama.cpp/releases/download/{LLAMA_TAG}"
    ROOT.mkdir(parents=True, exist_ok=True)
    for name in (f"llama-{LLAMA_TAG}-bin-ubuntu-cuda-12.8-x64.tar.gz", f"cudart-llama-{LLAMA_TAG}-bin-ubuntu-cuda-12.8-x64.tar.gz"):
        tgz = ROOT / name
        if not tgz.exists():
            _download(f"{base}/{name}", tgz)
        with tarfile.open(tgz) as t:
            for m in t.getmembers():
                # flatten into one dir so $ORIGIN finds libcudart/libcublas next to the binaries
                if m.isfile():
                    m.name = Path(m.name).name
                    t.extract(m, d)
        tgz.unlink(missing_ok=True)
    exe.chmod(0o755)
    return exe


def _build() -> Path:
    src = ROOT / f"src-{LLAMA_TAG}"
    exe = src / "build" / "bin" / "llama-server"
    if exe.exists():
        return exe
    ROOT.mkdir(parents=True, exist_ok=True)
    if not src.exists():
        subprocess.check_call(["git", "clone", "--depth", "1", "--branch", LLAMA_TAG, "https://github.com/ggml-org/llama.cpp", str(src)])
    if not shutil.which("cmake"):
        subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "cmake"])
    nvcc = shutil.which("nvcc") or "/usr/local/cuda/bin/nvcc"
    eprint("Qwen3.8: bygger llama.cpp för T4 (sm75), tar ~10–20 min första gången …")
    subprocess.check_call(["cmake", "-S", str(src), "-B", str(src / "build"), "-DGGML_CUDA=ON", "-DCMAKE_CUDA_ARCHITECTURES=75",
                           f"-DCMAKE_CUDA_COMPILER={nvcc}", "-DLLAMA_CURL=OFF", "-DLLAMA_BUILD_TESTS=OFF", "-DCMAKE_BUILD_TYPE=Release"],
                          stdout=subprocess.DEVNULL)
    subprocess.check_call(["cmake", "--build", str(src / "build"), "--target", "llama-server", "-j", str(os.cpu_count() or 2)],
                          stdout=subprocess.DEVNULL)
    return exe


def _runs(exe: Path) -> bool:
    try:
        r = subprocess.run([str(exe), "--version"], capture_output=True, text=True, timeout=60)
        return r.returncode == 0
    except Exception:
        return False


_exe: Path | None = None


def binary() -> Path:
    global _exe
    with _lock:
        if _exe and _exe.exists():
            return _exe
        exe = None
        if glibc_ok() and os.environ.get("KINO_LLAMA_BUILD") != "1":
            try:
                exe = _prebuilt()
                if not _runs(exe):
                    exe = None
            except Exception as err:
                eprint(f"Qwen3.8: färdig llama.cpp gick inte ({err}), bygger själv")
                exe = None
        if exe is None:
            exe = _build()
        _exe = exe
        return exe


def weights(p: dict) -> tuple[Path, Path]:
    from huggingface_hub import hf_hub_download  # preinstalled on Colab/Kaggle
    d = ROOT / "gguf"
    m = hf_hub_download(REPO, p["quant"], local_dir=str(d))
    v = hf_hub_download(REPO, MMPROJ, local_dir=str(d))
    return Path(m), Path(v)


def prefetch():
    """Disk/network only (no VRAM): llama.cpp binary + GGUF + mmproj."""
    p = plan()
    if not p:
        raise RuntimeError("för lite GPU-minne för Qwen3.8 27B (behöver T4 16 GB eller 2×T4)")
    binary()
    weights(p)
    return p


def loaded() -> bool:
    return _proc is not None and _proc.poll() is None


def _http(path: str, body: dict | None = None, timeout: float = 10):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"http://127.0.0.1:{PORT}{path}", data=data, headers={"Content-Type": "application/json"},
                                 method="POST" if data else "GET")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode() or "{}")


def ensure_server(max_wait: int = 900):
    global _proc, _log
    with _lock:
        if loaded():
            return
        p = plan()
        if not p:
            raise RuntimeError("för lite GPU-minne för Qwen3.8 27B")
        exe = binary()
        model, mmproj = weights(p)
        args = [str(exe), "-m", str(model), "--mmproj", str(mmproj), "--host", "127.0.0.1", "--port", str(PORT),
                "-ngl", "99", "-c", str(p["ctx"]), "-np", "1", "-fa", "on", "--jinja",
                "--cache-type-k", "q8_0", "--cache-type-v", "q8_0", "--no-webui"]
        if p["split"]:
            args += ["--split-mode", "layer", "--tensor-split", "1,1"]
        if os.environ.get("KINO_QWEN38_MMPROJ_CPU") == "1":
            args += ["--no-mmproj-offload"]
        ROOT.mkdir(parents=True, exist_ok=True)
        _log = open(ROOT / "llama-server.log", "ab")
        env = dict(os.environ, LD_LIBRARY_PATH=f"{exe.parent}:{os.environ.get('LD_LIBRARY_PATH', '')}")
        eprint(f"Qwen3.8: laddar {p['quant']} ({'2×GPU' if p['split'] else '1 GPU'}, ctx {p['ctx']}) …")
        _proc = subprocess.Popen(args, stdout=_log, stderr=subprocess.STDOUT, env=env)
        t0 = time.time()
        while time.time() - t0 < max_wait:
            if _proc.poll() is not None:
                tail = (ROOT / "llama-server.log").read_bytes()[-600:].decode("utf-8", "replace")
                _proc = None
                raise RuntimeError(f"llama-server avslutades: {tail}")
            try:
                if _http("/health", timeout=5).get("status") == "ok":
                    eprint(f"Qwen3.8 27B redo ({int(time.time() - t0)} s)")
                    return
            except Exception:
                pass
            time.sleep(3)
        unload()
        raise RuntimeError("Qwen3.8 laddades inte i tid")


def unload():
    """Stop our own llama-server (by handle) so video/lip-sync jobs get the whole GPU."""
    global _proc
    with _lock:
        if _proc is None:
            return
        if _proc.poll() is None:
            _proc.terminate()
            try:
                _proc.wait(30)
            except subprocess.TimeoutExpired:
                _proc.kill()
                _proc.wait(10)
            eprint("Qwen3.8 urladdad (GPU fri för video)")
        _proc = None


def answer(req: dict, work: Path) -> Path:
    """req = {messages (OpenAI format, images as data: URLs), max_tokens, temperature, json} → work/answer.json"""
    ensure_server()
    body = {
        "messages": req.get("messages") or [],
        "max_tokens": int(req.get("max_tokens") or 1024),
        "temperature": float(req.get("temperature") if req.get("temperature") is not None else 0.4),
        "chat_template_kwargs": {"enable_thinking": False},
    }
    if req.get("json"):
        body["response_format"] = {"type": "json_object"}
    t0 = time.time()
    try:
        r = _http("/v1/chat/completions", body, timeout=1500)
    except Exception:
        body.pop("response_format", None)  # grammar can fail on odd schemas: retry plain (prompt still asks for JSON)
        r = _http("/v1/chat/completions", body, timeout=1500)
    msg = ((r.get("choices") or [{}])[0].get("message") or {})
    content = msg.get("content") or ""
    out = work / "answer.json"
    out.write_text(json.dumps({"content": content, "ms": int((time.time() - t0) * 1000), "usage": r.get("usage")}))
    return out


def mock_answer(req: dict, work: Path) -> Path:
    out = work / "answer.json"
    want_json = bool(req.get("json"))
    out.write_text(json.dumps({"content": '{"mock":true}' if want_json else "mock answer"}))
    return out
