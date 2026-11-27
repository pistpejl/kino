"""Shared helpers for KINO session engines that need their own Python environment.

LatentSync 1.5 pins torch 2.5.1 / diffusers 0.32 and EchoMimic V3 needs torch 2.6 + its own diffusers; installing
either into the notebook's Python would break MuseTalk/LTX/Wan. So each engine gets a uv venv (Python 3.10,
which uv downloads itself if the notebook has a newer Python) and runs as a subprocess. The heavy part (code,
weights) is downloaded lazily on the first job.

Plain Python only (no torch) so the notebook process and the unit tests can import it.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import threading
from collections import deque
from pathlib import Path

PY_VERSION = os.environ.get("KINO_ENGINE_PYTHON", "3.10")


def eprint(*a):
    print(*a, file=sys.stderr, flush=True)


def free_gb(path) -> float:
    """Free disk space (GB) at path or its nearest existing parent."""
    p = Path(path)
    while not p.exists() and p != p.parent:
        p = p.parent
    try:
        return shutil.disk_usage(str(p)).free / 1e9
    except Exception:
        return 0.0


def pick_home(name: str, need_gb: float, candidates=None):
    """Where to keep a big engine (venv + weights). Kaggle's /kaggle/working is capped (~20 GB) and is saved with
    the notebook, so it is never used; the root disk (/tmp, /root) is much larger. Returns (path, free_gb, ok)."""
    if os.environ.get(f"KINO_{name.upper()}_HOME"):
        p = Path(os.environ[f"KINO_{name.upper()}_HOME"])
        return p, free_gb(p), free_gb(p) >= need_gb or p.exists()
    cands = candidates or [Path("/tmp"), Path.home() / ".cache", Path("/content")]
    best = None
    for c in cands:
        c = Path(c)
        if str(c).startswith("/kaggle/working"):
            continue
        home = c / f"kino_{name}"
        if home.exists():  # already installed here: keep using it
            return home, free_gb(home), True
        f = free_gb(c)
        if best is None or f > best[1]:
            best = (home, f)
    if best is None:
        return Path("/tmp") / f"kino_{name}", 0.0, False
    return best[0], best[1], best[1] >= need_gb


def lib_env(venv: Path, cache: Path) -> dict:
    """Env for the engine subprocess: the venv's pip-installed CUDA libs first (cuDNN for onnxruntime etc.),
    HF/torch caches next to the engine, no tokens (no gated models are used)."""
    env = dict(os.environ)
    libs = sorted(str(p) for p in Path(venv).glob("lib/python*/site-packages/nvidia/*/lib") if p.is_dir())
    if libs:
        env["LD_LIBRARY_PATH"] = ":".join(libs + [env.get("LD_LIBRARY_PATH", "")]).strip(":")
    env["HF_HOME"] = str(Path(cache) / "hf")
    env["TORCH_HOME"] = str(Path(cache) / "torch")
    env["HF_HUB_ENABLE_HF_TRANSFER"] = "0"
    env.setdefault("PYTHONUNBUFFERED", "1")
    env.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")
    for k in ("HF_TOKEN", "HUGGING_FACE_HUB_TOKEN", "PYTHONPATH"):
        env.pop(k, None)
    return env


def _sh(cmd, timeout=1800, env=None):
    subprocess.check_call([str(c) for c in cmd], timeout=timeout, env=env)


def ensure_venv(venv: Path, packages: list, pin: str, label: str, lock: threading.Lock, log=eprint) -> Path:
    """Create `venv` with uv (Python PY_VERSION) and install `packages` once. `pin` is written to a ready flag so a
    changed package list reinstalls. Thread-safe, idempotent. Returns the venv's python."""
    venv = Path(venv)
    py = venv / "bin" / "python"
    flag = venv / ".kino_ready"
    with lock:
        try:
            if flag.read_text().strip() == pin and py.exists():
                return py
        except Exception:
            pass
        log(f"{label}: skapar egen Python-miljö {PY_VERSION} (första gången ca 3–8 min)")
        uv = shutil.which("uv")
        if not uv:
            _sh([sys.executable, "-m", "pip", "install", "-q", "uv"], 600)
            uv = shutil.which("uv") or str(Path(sys.executable).parent / "uv")
        venv.parent.mkdir(parents=True, exist_ok=True)
        if not py.exists():
            env = dict(os.environ)
            env.setdefault("UV_PYTHON_INSTALL_DIR", str(venv.parent / "uv-python"))
            _sh([uv, "venv", "--seed", "--python", PY_VERSION, venv], 900, env=env)
        _sh([uv, "pip", "install", "--python", py, "-q", *packages], 3600)
        flag.write_text(pin)
        log(f"{label}: Python-miljön klar")
        return py


def run_logged(cmd, env=None, cwd=None, timeout=3600, prefix="engine", keep=40):
    """Run a subprocess, stream its output to the notebook with a prefix (so the first real run can be debugged
    from the Colab/Kaggle log), and return (returncode, last `keep` lines)."""
    tail = deque(maxlen=keep)
    p = subprocess.Popen([str(c) for c in cmd], env=env, cwd=str(cwd) if cwd else None,
                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
    timer = threading.Timer(timeout, p.kill)
    timer.start()
    try:
        for line in p.stdout:
            line = line.rstrip()
            if not line:
                continue
            tail.append(line)
            # tqdm bars produce a lot of lines; still print them (the notebook shows progress) but shortened
            eprint(f"[{prefix}] {line[:300]}")
        p.wait()
    finally:
        timer.cancel()
        if p.stdout:
            p.stdout.close()
    return p.returncode, list(tail)


def error_tail(lines, n=3, limit=280) -> str:
    """Last meaningful lines of a failed run (Tracebacks end with the exception line)."""
    useful = [l for l in lines if l.strip() and not l.strip().startswith(("|", "%"))]
    return " | ".join(useful[-n:])[-limit:]
