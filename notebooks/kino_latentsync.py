"""LatentSync 1.5 video-to-video lip sync for the KINO session worker (Colab/Kaggle T4 16 GB, sm75, SFW only).

LatentSync (ByteDance, Apache-2.0 code; weights ByteDance/LatentSync-1.5, CreativeML OpenRAIL++-M) redraws the
mouth region of every frame of an EXISTING video so it matches a new audio track (audio-conditioned latent
diffusion at 256x256 on an affine-aligned face crop, pasted back). Upstream: 8 GB VRAM minimum for v1.5
(v1.6 at 512 needs 18 GB, so KINO uses 1.5). A still image works too: it is turned into a static clip first.

Lazy, first job only (or "prefetch" when LATENTSYNC_PREFETCH is on in the notebook):
  * own uv venv (Python 3.10, torch 2.5.1, diffusers 0.32.2, insightface, onnxruntime-gpu …), ~5 GB, 3–8 min
  * the code, pinned to LATENTSYNC_COMMIT (main after the 1.6 release; the 256 px stage2.yaml model config is
    unchanged since the 1.5 release and the main branch has the <10 GB VRAM and DeepCache changes)
  * weights from ByteDance/LatentSync-1.5: latentsync_unet.pt (5.1 GB) + whisper/tiny.pt (75 MB); the VAE
    (stabilityai/sd-vae-ft-mse, 335 MB) and InsightFace buffalo_l (~280 MB) are fetched by the code itself.

KINO changes to upstream inference (in `_run`, the code itself is untouched):
  * fp16 on Turing: upstream switches to fp32 below sm80; T4 runs fp16 fine (fp32 kept as KINO_LATENTSYNC_FP32=1)
  * frames without a face are kept as they are instead of failing the whole clip ("Face not detected")
  * input is scaled so the long side is <= 1280 px and cut to the audio length (the frames are held in RAM)

Everything above `# ---- inside the venv` is plain Python so the notebook and the tests can import it.
"""
from __future__ import annotations

import json
import math
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import threading
import urllib.request
from pathlib import Path

LATENTSYNC_COMMIT = "a229c3948406bc2cf6eaf4873e662e70c6a04746"
LATENTSYNC_TARBALL = f"https://codeload.github.com/bytedance/LatentSync/tar.gz/{LATENTSYNC_COMMIT}"
WEIGHTS_REPO = "ByteDance/LatentSync-1.5"
WEIGHTS = [("latentsync_unet.pt", "latentsync_unet.pt"), ("whisper/tiny.pt", "whisper/tiny.pt")]
UNET_CONFIG = "configs/unet/stage2.yaml"  # 256 px model config = LatentSync 1.5
MAX_SECONDS = 30
MAX_SIDE = 1280
FPS = 25
NEED_GB = 14.0  # venv ~5 GB + weights ~6 GB + room for frames/temp
PIP_PACKAGES = [
    "torch==2.5.1", "torchvision==0.20.1", "diffusers==0.32.2", "transformers==4.48.0", "accelerate==0.26.1",
    "huggingface-hub==0.30.2", "numpy==1.26.4", "einops==0.7.0", "omegaconf==2.3.0", "decord==0.6.0",
    "opencv-python-headless==4.9.0.80", "python_speech_features==0.6", "librosa==0.10.1", "soundfile",
    "ffmpeg-python==0.2.0", "imageio==2.31.1", "imageio-ffmpeg==0.5.1", "kornia==0.8.0", "insightface==0.7.3",
    "onnxruntime-gpu==1.21.0", "DeepCache==0.1.1", "matplotlib", "scipy", "more-itertools", "regex", "tqdm",
]
PIN = "latentsync-1.5:" + LATENTSYNC_COMMIT[:12] + ":" + str(len(PIP_PACKAGES))
_lock = threading.Lock()
_setup_lock = threading.Lock()


def eprint(*a):
    print(*a, file=sys.stderr, flush=True)


# ---------------------------------------------------------------- pure helpers (tested)

def use_fp16(capability, force_fp32: bool = False) -> bool:
    """fp16 on every CUDA GPU from Volta/Turing (sm70+) unless forced off. Upstream uses fp32 below sm80."""
    if force_fp32 or not capability:
        return False
    major = int(capability[0])
    return major >= 7


def scale_for(width: int, height: int, max_side: int = MAX_SIDE):
    """Even dimensions with the long side <= max_side (frames are held in RAM by LatentSync)."""
    w, h = int(width), int(height)
    s = min(1.0, float(max_side) / max(w, h, 1))
    return max(2, int(w * s) // 2 * 2), max(2, int(h * s) // 2 * 2)


def clip_seconds(audio_seconds, max_seconds: int = MAX_SECONDS) -> float:
    a = float(audio_seconds or 0)
    if a <= 0:
        a = 4.0
    return max(1.0, min(float(max_seconds), a))


def fill_faces(found):
    """found: list of bool per frame (face detected). Returns the index each frame should borrow its face crop
    from (nearest earlier, else later detected frame), or None if no frame has a face."""
    idx = [i if ok else None for i, ok in enumerate(found)]
    if not any(v is not None for v in idx):
        return None
    last = None
    for i, v in enumerate(idx):
        if v is None:
            idx[i] = last
        else:
            last = v
    nxt = None
    for i in range(len(idx) - 1, -1, -1):
        if idx[i] is None:
            idx[i] = nxt
        else:
            nxt = idx[i]
    return idx


def ffmpeg_prepare_cmd(src: Path, out: Path, seconds: float, is_image: bool, size=None):
    """ffmpeg command that turns the job's input into a 25 fps H.264 clip of `seconds` (a still becomes a static
    clip; a video is cut, never stretched; LatentSync ping-pongs a video that is shorter than the audio)."""
    vf = [f"fps={FPS}"]
    if size:
        vf.append(f"scale={size[0]}:{size[1]}")
    vf.append("format=yuv420p")
    head = ["ffmpeg", "-nostdin", "-y", "-v", "error"]
    if is_image:
        head += ["-loop", "1", "-framerate", str(FPS), "-t", f"{seconds:.3f}", "-i", str(src)]
    else:
        head += ["-i", str(src), "-t", f"{seconds:.3f}"]
    return head + ["-an", "-vf", ",".join(vf), "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", str(out)]


# ---------------------------------------------------------------- notebook side

def enabled() -> bool:
    return os.environ.get("KINO_LATENTSYNC", "1") != "0"


def _home():
    import kino_venv as kv  # type: ignore
    return kv.pick_home("latentsync", NEED_GB)


def paths():
    home, free, ok = _home()
    return {"home": home, "venv": home / "venv", "code": home / "code", "weights": home / "weights",
            "cache": home / "cache", "free_gb": free, "disk_ok": ok}


def is_ready() -> bool:
    p = paths()
    try:
        return ((p["venv"] / ".kino_ready").read_text().strip() == PIN
                and (p["code"] / ".kino_commit").read_text().strip() == LATENTSYNC_COMMIT
                and all((p["weights"] / rel).exists() for _, rel in WEIGHTS))
    except Exception:
        return False


def _ensure_code(code: Path):
    marker = code / ".kino_commit"
    if marker.exists() and marker.read_text().strip() == LATENTSYNC_COMMIT and (code / "latentsync").is_dir():
        return code
    eprint("LatentSync: hämtar koden", LATENTSYNC_COMMIT[:8])
    tmp = Path(tempfile.mkdtemp(prefix="latentsync-src-"))
    tgz = tmp / "src.tgz"
    urllib.request.urlretrieve(LATENTSYNC_TARBALL, tgz)
    with tarfile.open(tgz) as tf:
        try:
            tf.extractall(tmp, filter="data")
        except TypeError:
            tf.extractall(tmp)
    src = next(p for p in tmp.iterdir() if p.is_dir() and p.name.startswith("LatentSync"))
    if code.exists():
        keep = code / "checkpoints"
        if keep.exists():
            shutil.move(str(keep), str(tmp / "checkpoints_keep"))
        shutil.rmtree(code, ignore_errors=True)
    shutil.move(str(src), str(code))
    if (tmp / "checkpoints_keep").exists():
        shutil.rmtree(code / "checkpoints", ignore_errors=True)
        shutil.move(str(tmp / "checkpoints_keep"), str(code / "checkpoints"))
    marker.write_text(LATENTSYNC_COMMIT)
    shutil.rmtree(tmp, ignore_errors=True)
    return code


def _ensure_weights(weights: Path, code: Path):
    from huggingface_hub import hf_hub_download
    weights.mkdir(parents=True, exist_ok=True)
    for fn, rel in WEIGHTS:
        dest = weights / rel
        if not (dest.exists() and dest.stat().st_size > 0):
            eprint(f"LatentSync: hämtar {WEIGHTS_REPO}/{fn}")
            hf_hub_download(repo_id=WEIGHTS_REPO, filename=fn, local_dir=str(weights))
        link = code / "checkpoints" / rel
        link.parent.mkdir(parents=True, exist_ok=True)
        if link.is_symlink() or link.exists():
            link.unlink()
        os.symlink(os.path.realpath(dest), link)


def ensure(log=eprint):
    """venv + code + weights (disk/network only, no VRAM). Thread-safe, idempotent."""
    import kino_venv as kv  # type: ignore
    p = paths()
    if not p["disk_ok"]:
        raise RuntimeError(f"LatentSync behöver ca {NEED_GB:.0f} GB ledigt, bara {p['free_gb']:.1f} GB finns på {p['home'].parent}.")
    with _setup_lock:
        p["home"].mkdir(parents=True, exist_ok=True)
        py = kv.ensure_venv(p["venv"], PIP_PACKAGES, PIN, "LatentSync", _lock, log)
        _ensure_code(p["code"])
        _ensure_weights(p["weights"], p["code"])
    return py, p


def prefetch(log=eprint):
    ensure(log)
    log("LatentSync 1.5 redo (miljö + vikter hämtade)")


def run(source: Path, audio: Path, work: Path, seconds: float | None = None, timeout: int = 3300) -> Path:
    """source: video (or still image), audio: any ffmpeg-readable file. Returns an mp4 with the audio muxed."""
    import kino_venv as kv  # type: ignore
    py, p = ensure()
    work = Path(work)
    work.mkdir(parents=True, exist_ok=True)
    wav = work / "ls_audio.wav"
    subprocess.check_call(["ffmpeg", "-nostdin", "-y", "-v", "error", "-i", str(audio), "-ac", "1", "-ar", "16000",
                           "-t", str(MAX_SECONDS), str(wav)], timeout=180)
    dur = clip_seconds(seconds or _probe(wav))
    src = Path(source)
    is_image = src.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp", ".bmp")
    w, h = _probe_size(src)
    size = scale_for(w, h) if w and h and max(w, h) > MAX_SIDE else None
    vid = work / "ls_in.mp4"
    subprocess.check_call(ffmpeg_prepare_cmd(src, vid, dur, is_image, size), timeout=600)
    out = work / "ls_out.mp4"
    opts = {"video": str(vid), "audio": str(wav), "out": str(out), "temp": str(work / "ls_tmp"),
            "fp32": os.environ.get("KINO_LATENTSYNC_FP32") == "1",
            "steps": int(os.environ.get("KINO_LATENTSYNC_STEPS", "20")),
            "guidance": float(os.environ.get("KINO_LATENTSYNC_GUIDANCE", "1.5"))}
    (work / "ls_opts.json").write_text(json.dumps(opts))
    eprint(f"LatentSync: startar ({dur:.1f} s, {'bild' if is_image else 'video'})")
    rc, tail = kv.run_logged([py, str(Path(__file__).resolve()), "run", "--opts", str(work / "ls_opts.json")],
                             env=kv.lib_env(p["venv"], p["cache"]), cwd=p["code"], timeout=timeout, prefix="latentsync")
    if rc != 0 or not out.exists() or out.stat().st_size == 0:
        raise RuntimeError(f"LatentSync misslyckades: {kv.error_tail(tail) or rc}")
    return out


def _probe(path) -> float:
    try:
        return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                                              "-of", "default=nw=1:nk=1", str(path)], text=True, timeout=30).strip())
    except Exception:
        return 0.0


def _probe_size(path):
    try:
        out = subprocess.check_output(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                                       "stream=width,height", "-of", "csv=p=0", str(path)], text=True, timeout=30).strip()
        w, h = out.split("\n")[0].split(",")[:2]
        return int(w), int(h)
    except Exception:
        return 0, 0


# ---------------------------------------------------------------- inside the venv

def _patch_pipeline(LipsyncPipeline):
    """Frames without a detectable face keep the original picture instead of aborting the clip."""
    import numpy as np
    import torch

    orig_restore = LipsyncPipeline.restore_video

    def affine_transform_video(self, video_frames):
        faces, boxes, mats, found = [], [], [], []
        print(f"Affine transforming {len(video_frames)} faces...", flush=True)
        for frame in video_frames:
            try:
                face, box, mat = self.image_processor.affine_transform(frame)
                faces.append(face); boxes.append(box); mats.append(mat); found.append(True)
            except RuntimeError:
                faces.append(None); boxes.append(None); mats.append(None); found.append(False)
        src = fill_faces(found)
        if src is None:
            raise RuntimeError("LatentSync hittade inget ansikte i videon")
        miss = found.count(False)
        if miss:
            print(f"KINO: {miss} av {len(found)} bildrutor utan ansikte behålls som de är", flush=True)
        faces = [faces[j] for j in src]
        return torch.stack(faces), boxes, mats

    def restore_video(self, faces, video_frames, boxes, affine_matrices):
        n = len(faces)
        video_frames = video_frames[:n]
        valid = [i for i in range(n) if boxes[i] is not None]
        if len(valid) == n:
            return orig_restore(self, faces, video_frames, boxes, affine_matrices)
        out = np.array(video_frames, copy=True)
        if valid:
            res = orig_restore(self, faces[valid], video_frames[valid], [boxes[i] for i in valid], [affine_matrices[i] for i in valid])
            for k, i in enumerate(valid):
                out[i] = res[k]
        return out

    LipsyncPipeline.affine_transform_video = affine_transform_video
    LipsyncPipeline.restore_video = restore_video


def _run(opts_path: str):
    opts = json.loads(Path(opts_path).read_text())
    import torch
    from omegaconf import OmegaConf
    from diffusers import AutoencoderKL, DDIMScheduler
    from accelerate.utils import set_seed
    from latentsync.models.unet import UNet3DConditionModel
    from latentsync.pipelines.lipsync_pipeline import LipsyncPipeline
    from latentsync.whisper.audio2feature import Audio2Feature

    if not torch.cuda.is_available():
        raise RuntimeError("Ingen CUDA-GPU i LatentSync-miljön")
    cap = torch.cuda.get_device_capability()
    fp16 = use_fp16(cap, bool(opts.get("fp32")))
    dtype = torch.float16 if fp16 else torch.float32
    print(f"KINO LatentSync 1.5: {torch.cuda.get_device_name()} sm{cap[0]}{cap[1]}, {'fp16' if fp16 else 'fp32'}, torch {torch.__version__}", flush=True)
    _patch_pipeline(LipsyncPipeline)
    config = OmegaConf.load(UNET_CONFIG)
    scheduler = DDIMScheduler.from_pretrained("configs")
    audio_encoder = Audio2Feature(model_path="checkpoints/whisper/tiny.pt", device="cuda",
                                  num_frames=config.data.num_frames, audio_feat_length=config.data.audio_feat_length)
    vae = AutoencoderKL.from_pretrained("stabilityai/sd-vae-ft-mse", torch_dtype=dtype)
    vae.config.scaling_factor = 0.18215
    vae.config.shift_factor = 0
    unet, _ = UNet3DConditionModel.from_pretrained(OmegaConf.to_container(config.model), "checkpoints/latentsync_unet.pt", device="cpu")
    unet = unet.to(dtype=dtype)
    pipe = LipsyncPipeline(vae=vae, audio_encoder=audio_encoder, unet=unet, scheduler=scheduler).to("cuda")
    try:
        from DeepCache import DeepCacheSDHelper
        helper = DeepCacheSDHelper(pipe=pipe)
        helper.set_params(cache_interval=3, cache_branch_id=0)
        helper.enable()
    except Exception as err:
        print(f"DeepCache av ({err})", flush=True)
    set_seed(1247)
    pipe(video_path=opts["video"], audio_path=opts["audio"], video_out_path=opts["out"],
         num_frames=config.data.num_frames, num_inference_steps=int(opts.get("steps") or 20),
         guidance_scale=float(opts.get("guidance") or 1.5), weight_dtype=dtype,
         width=config.data.resolution, height=config.data.resolution,
         mask_image_path=config.data.mask_image_path, temp_dir=opts.get("temp") or "temp")
    peak = torch.cuda.max_memory_allocated() / 1e9
    print(f"KINO LatentSync klar, topp-VRAM {peak:.1f} GB", flush=True)
    if not Path(opts["out"]).exists():
        raise RuntimeError("LatentSync skrev ingen video")


def main(argv=None):
    import argparse
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd")
    r = sub.add_parser("run")
    r.add_argument("--opts", required=True)
    a = ap.parse_args(argv)
    if a.cmd == "run":
        sys.path.insert(0, os.getcwd())
        _run(a.opts)
    else:
        ap.print_help()


if __name__ == "__main__":
    main()
