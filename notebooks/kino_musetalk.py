"""MuseTalk 1.5 lip sync for the KINO session worker (Colab/Kaggle T4 or P100, fp16).

MuseTalk (MIT, TMElyralab/MuseTalk) redraws only the mouth/jaw region of a face, frame by
frame, driven by Whisper features of the audio. It works on a still image (the rest of the
picture stays still) or on a video (it follows the face in every frame) — so for a "living"
image KINO first animates the still with LTX/Wan and then runs MuseTalk on that clip.

Lazy, first use only:
  * the MuseTalk code, pinned to MUSETALK_COMMIT, from codeload.github.com
  * the weights (~4 GB, the UNet is 3.4 GB fp32 on disk) from Hugging Face (MuseTalk 1.5 UNet, sd-vae-ft-mse, whisper-tiny,
    BiSeNet face parsing)
  * small pip packages (librosa, einops, face-alignment, …)

Upstream preprocessing imports mmpose/mmcv (DWPose) at import time; those wheels do not
exist for current Colab/Kaggle torch builds. KINO does not import it: face landmarks come
from the `face-alignment` package (same 68-point layout), and the crop box is computed with
the same formula as upstream `get_landmark_and_bbox` (see `bbox_from_landmarks`).

The helpers at the top (bbox_from_landmarks, fill_missing, ltx_frames_for, extend_plan) are
pure Python/numpy so they can be unit-tested without a GPU.
"""
from __future__ import annotations

import gc
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
from contextlib import contextmanager
from pathlib import Path

MUSETALK_COMMIT = "2536eaf06b85f775d8e04b7fd81bf6699155a58d"
MUSETALK_TARBALL = f"https://codeload.github.com/TMElyralab/MuseTalk/tar.gz/{MUSETALK_COMMIT}"
FPS = 25
EXTRA_MARGIN = 10  # upstream v1.5 default: extend the crop below the chin
MAX_SECONDS = 12

# (hf repo, file in repo, path under MuseTalk/models)
WEIGHTS = [
    ("TMElyralab/MuseTalk", "musetalkV15/musetalk.json", "musetalkV15/musetalk.json"),
    ("TMElyralab/MuseTalk", "musetalkV15/unet.pth", "musetalkV15/unet.pth"),
    ("stabilityai/sd-vae-ft-mse", "config.json", "sd-vae/config.json"),
    ("stabilityai/sd-vae-ft-mse", "diffusion_pytorch_model.safetensors", "sd-vae/diffusion_pytorch_model.safetensors"),
    ("openai/whisper-tiny", "config.json", "whisper/config.json"),
    ("openai/whisper-tiny", "model.safetensors", "whisper/model.safetensors"),
    ("openai/whisper-tiny", "preprocessor_config.json", "whisper/preprocessor_config.json"),
    ("ManyOtherFunctions/face-parse-bisent", "79999_iter.pth", "face-parse-bisent/79999_iter.pth"),
    ("ManyOtherFunctions/face-parse-bisent", "resnet18-5c106cde.pth", "face-parse-bisent/resnet18-5c106cde.pth"),
]
# Google Drive original of the BiSeNet weights, used only if the HF mirror fails.
FACE_PARSE_GDRIVE = "154JgKpzCPW82qINcVieuPH3fZ2e0P812"
PIP_DEPS = {
    "librosa": "librosa", "einops": "einops", "face_alignment": "face-alignment",
    "soundfile": "soundfile", "cv2": "opencv-python-headless", "huggingface_hub": "huggingface_hub",
    "omegaconf": "omegaconf",
}


def eprint(*a):
    print(*a, file=sys.stderr, flush=True)


# ---------------------------------------------------------------- pure helpers (tested)

def bbox_from_landmarks(lm, det_box, frame_h, frame_w=None):
    """Upstream MuseTalk crop: from the nose bridge (pt 29) up by the nose→chin distance,
    landmark x-extent, down to the chin. Falls back to the detector box if degenerate.
    lm: 68x2 (x, y). det_box: (x1, y1, x2, y2[, score]). Returns int (x1, y1, x2, y2)."""
    pts = [(int(p[0]), int(p[1])) for p in lm]
    half_y = pts[29][1]
    max_y = max(p[1] for p in pts)
    half_dist = max_y - half_y
    upper = max(0, half_y - half_dist)
    x1 = min(p[0] for p in pts)
    x2 = max(p[0] for p in pts)
    box = (x1, int(upper), x2, max_y)
    if frame_w is not None:
        box = (max(0, box[0]), box[1], min(int(frame_w), box[2]), min(int(frame_h), box[3]))
    if box[3] - box[1] <= 0 or box[2] - box[0] <= 0 or box[0] < 0:
        d = [int(v) for v in list(det_box)[:4]]
        return (max(0, d[0]), max(0, d[1]), d[2], min(int(frame_h), d[3]))
    return box


def fill_missing(coords):
    """Frames without a detected face get the nearest earlier (else later) box, so the
    latent list stays aligned with the frame list. Returns None if no frame has a face."""
    out = list(coords)
    if not any(c is not None for c in out):
        return None
    last = None
    for i, c in enumerate(out):
        if c is None:
            out[i] = last
        else:
            last = c
    nxt = None
    for i in range(len(out) - 1, -1, -1):
        if out[i] is None:
            out[i] = nxt
        else:
            nxt = out[i]
    return out


def ltx_frames_for(seconds, fps=24, cap=97):
    """LTX-Video needs 8k+1 frames. Cap keeps a 480x832 clip inside 16 GB with offload."""
    n = int(round(max(1.0, float(seconds)) * fps))
    n = max(9, min(cap, n))
    return (n - 1) // 8 * 8 + 1


def extend_plan(clip_seconds, target_seconds):
    """How to stretch a short I2V clip to the audio length: 'trim' if it is long enough,
    else 'pingpong' (forward+reverse, repeated) — no visible jump cut."""
    clip = max(0.1, float(clip_seconds))
    target = max(0.1, float(target_seconds))
    if clip + 1e-3 >= target:
        return {"mode": "trim", "loops": 0}
    return {"mode": "pingpong", "loops": int(math.ceil(target / (2 * clip)))}


# ---------------------------------------------------------------- ffmpeg helpers

def probe_seconds(path) -> float:
    try:
        out = subprocess.check_output([
            "ffprobe", "-v", "error", "-show_entries", "format=duration",
            "-of", "default=nw=1:nk=1", str(path)], text=True, timeout=30).strip()
        return float(out)
    except Exception:
        return 0.0


def fit_video_to_audio(video: Path, seconds: float, out: Path, fps: int = FPS) -> Path:
    """Resample to 25 fps and make the clip exactly `seconds` long (ping-pong if short)."""
    clip = probe_seconds(video) or 1.0
    plan = extend_plan(clip, seconds)
    src = video
    if plan["mode"] == "pingpong":
        pp = out.with_name("pingpong.mp4")
        n = plan["loops"]
        flt = f"[0:v]split=2[a][b];[b]reverse[r];[a][r]concat=n=2:v=1:a=0,loop=loop={max(0, n - 1)}:size=32767:start=0[v]"
        subprocess.check_call(["ffmpeg", "-nostdin", "-y", "-v", "error", "-i", str(video), "-filter_complex", flt,
                               "-map", "[v]", "-an", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", str(pp)], timeout=600)
        src = pp
    subprocess.check_call(["ffmpeg", "-nostdin", "-y", "-v", "error", "-i", str(src), "-t", f"{seconds:.3f}",
                           "-vf", f"fps={fps}", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "16",
                           "-pix_fmt", "yuv420p", str(out)], timeout=600)
    return out


def mux_audio(video: Path, audio: Path, out: Path) -> Path:
    subprocess.check_call(["ffmpeg", "-nostdin", "-y", "-v", "error", "-i", str(video), "-i", str(audio),
                           "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
                           "-shortest", str(out)], timeout=300)
    return out


# ---------------------------------------------------------------- setup (lazy)

def _root() -> Path:
    if os.environ.get("KINO_MUSETALK_HOME"):
        return Path(os.environ["KINO_MUSETALK_HOME"])
    for p in (Path("/content"), Path("/kaggle/working")):
        if p.is_dir():
            return p / "MuseTalk"
    return Path.cwd() / "MuseTalk"


def ensure_deps():
    import importlib
    missing = []
    for mod, pkg in PIP_DEPS.items():
        try:
            importlib.import_module(mod)
        except Exception:
            missing.append(pkg)
    if missing:
        eprint("MuseTalk: installerar", " ".join(missing))
        subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", *missing])


def ensure_code(home: Path) -> Path:
    marker = home / ".kino_commit"
    if marker.exists() and marker.read_text().strip() == MUSETALK_COMMIT and (home / "musetalk").is_dir():
        return home
    eprint("MuseTalk: hämtar koden", MUSETALK_COMMIT[:8])
    tmp = Path(tempfile.mkdtemp(prefix="musetalk-src-"))
    tgz = tmp / "src.tgz"
    urllib.request.urlretrieve(MUSETALK_TARBALL, tgz)
    with tarfile.open(tgz) as tf:
        try:
            tf.extractall(tmp, filter="data")
        except TypeError:
            tf.extractall(tmp)
    src = next(p for p in tmp.iterdir() if p.is_dir() and p.name.startswith("MuseTalk"))
    home.mkdir(parents=True, exist_ok=True)
    for item in src.iterdir():
        dest = home / item.name
        if dest.is_dir() and item.name != "models":
            shutil.rmtree(dest)
        if item.name == "models" and dest.exists():
            continue
        shutil.move(str(item), str(dest))
    marker.write_text(MUSETALK_COMMIT)
    shutil.rmtree(tmp, ignore_errors=True)
    return home


def ensure_weights(home: Path):
    from huggingface_hub import hf_hub_download
    models = home / "models"
    for repo, fn, rel in WEIGHTS:
        dest = models / rel
        if dest.exists() and dest.stat().st_size > 0:
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        try:
            src = hf_hub_download(repo_id=repo, filename=fn)
            try:  # symlink into the HF cache: no second 4 GB copy (Kaggle /kaggle/working is ~20 GB)
                if dest.is_symlink():
                    dest.unlink()
                os.symlink(os.path.realpath(src), dest)
            except OSError:
                shutil.copyfile(src, dest)
        except Exception as err:
            if fn == "79999_iter.pth":
                subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "gdown"])
                subprocess.check_call([sys.executable, "-m", "gdown", "--id", FACE_PARSE_GDRIVE, "-O", str(dest)])
            else:
                raise RuntimeError(f"MuseTalk-vikter kunde inte hämtas ({repo}/{fn}): {err}") from err
        eprint("MuseTalk: vikt klar", rel)


@contextmanager
def _in_dir(path: Path):
    old = os.getcwd()
    os.chdir(path)
    try:
        yield
    finally:
        os.chdir(old)


# ---------------------------------------------------------------- model cache / VRAM

_STATE: dict = {}
_SETUP_LOCK = threading.Lock()


def prefetch():
    """Download code + weights only (no GPU). The worker runs this in a background thread
    right after pairing so the first lip-sync job does not spend minutes downloading."""
    with _SETUP_LOCK:
        ensure_deps()
        home = ensure_code(_root())
        ensure_weights(home)
        return home


def unload():
    """Free MuseTalk from VRAM (called before LTX/Wan load, and by the worker on demand)."""
    if not _STATE:
        return
    _STATE.clear()
    gc.collect()
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass


def free_cuda():
    gc.collect()
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            torch.cuda.ipc_collect()
    except Exception:
        pass


def load_models():
    if _STATE.get("ready"):
        return _STATE
    home = prefetch()
    if str(home) not in sys.path:
        sys.path.insert(0, str(home))
    import torch
    from transformers import WhisperModel
    import face_alignment
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    with _in_dir(home):
        from musetalk.utils.utils import load_all_model
        from musetalk.utils.audio_processor import AudioProcessor
        from musetalk.utils.face_parsing import FaceParsing
        vae, unet, pe = load_all_model(
            unet_model_path=os.path.join("models", "musetalkV15", "unet.pth"),
            vae_type="sd-vae",
            unet_config=os.path.join("models", "musetalkV15", "musetalk.json"),
            device=device,
        )
        pe = pe.half().to(device)
        vae.vae = vae.vae.half().to(device)
        unet.model = unet.model.half().to(device)
        audio_processor = AudioProcessor(feature_extractor_path="models/whisper")
        whisper = WhisperModel.from_pretrained("models/whisper").to(device=device, dtype=unet.model.dtype).eval()
        whisper.requires_grad_(False)
        fp = FaceParsing(left_cheek_width=90, right_cheek_width=90)
    lt = getattr(face_alignment.LandmarksType, "TWO_D", None) or getattr(face_alignment.LandmarksType, "_2D")
    fa = face_alignment.FaceAlignment(lt, flip_input=False, device="cuda" if device.type == "cuda" else "cpu")
    _STATE.update(ready=True, home=home, device=device, vae=vae, unet=unet, pe=pe, whisper=whisper,
                  audio=audio_processor, fp=fp, fa=fa, timesteps=torch.tensor([0], device=device))
    return _STATE


# ---------------------------------------------------------------- inference

def _read_frames(src: Path, work: Path, seconds: float):
    import cv2
    ext = src.suffix.lower()
    if ext in (".jpg", ".jpeg", ".png", ".webp", ".bmp"):
        img = cv2.imread(str(src))
        if img is None:
            raise RuntimeError("Kunde inte läsa bilden.")
        h, w = img.shape[:2]
        if max(h, w) > 1280:  # keep VRAM / time sane
            s = 1280 / max(h, w)
            img = cv2.resize(img, (int(w * s) // 2 * 2, int(h * s) // 2 * 2), interpolation=cv2.INTER_AREA)
        return [img], FPS
    fixed = fit_video_to_audio(src, seconds, work / "mt_in.mp4")
    cap = cv2.VideoCapture(str(fixed))
    frames = []
    while True:
        ok, fr = cap.read()
        if not ok:
            break
        frames.append(fr)
    cap.release()
    if not frames:
        raise RuntimeError("Videon gav inga bildrutor.")
    return frames, FPS


def _detect(frames, fa):
    coords = []
    for fr in frames:
        rgb = fr[:, :, ::-1].copy()
        try:
            res = fa.get_landmarks_from_image(rgb, return_bboxes=True)
        except TypeError:
            res = (fa.get_landmarks_from_image(rgb), None, None)
        lms, _, boxes = res if isinstance(res, tuple) else (res, None, None)
        if not lms:
            coords.append(None)
            continue
        # largest face
        areas = [(max(p[0] for p in l) - min(p[0] for p in l)) * (max(p[1] for p in l) - min(p[1] for p in l)) for l in lms]
        i = max(range(len(lms)), key=lambda k: areas[k])
        lm = lms[i]
        det = boxes[i] if boxes is not None and len(boxes) > i else (min(p[0] for p in lm), min(p[1] for p in lm), max(p[0] for p in lm), max(p[1] for p in lm))
        coords.append(bbox_from_landmarks(lm, det, fr.shape[0], fr.shape[1]))
    return fill_missing(coords)


def lipsync(source: Path, audio: Path, work: Path, seconds: float | None = None) -> Path:
    """source: still image or video. audio: wav/mp3. Returns an mp4 with the audio muxed."""
    import copy
    import cv2
    import numpy as np
    import torch

    work = Path(work)
    work.mkdir(parents=True, exist_ok=True)
    wav = work / "mt_audio.wav"
    subprocess.check_call(["ffmpeg", "-nostdin", "-y", "-v", "error", "-i", str(audio), "-ac", "1", "-ar", "16000",
                           "-t", str(MAX_SECONDS), str(wav)], timeout=120)
    dur = seconds or probe_seconds(wav) or 4.0
    dur = max(1.0, min(MAX_SECONDS, float(dur)))
    st = load_models()
    frames, fps = _read_frames(Path(source), work, dur)
    coords = _detect(frames, st["fa"])
    if coords is None:
        raise RuntimeError("MuseTalk hittade inget ansikte i bilden/videon.")
    vae, unet, pe, fp = st["vae"], st["unet"], st["pe"], st["fp"]
    with _in_dir(st["home"]):
        from musetalk.utils.blending import get_image
        from musetalk.utils.utils import datagen
        feats, length = st["audio"].get_audio_feature(str(wav))
        chunks = st["audio"].get_whisper_chunk(feats, st["device"], unet.model.dtype, st["whisper"], length,
                                               fps=fps, audio_padding_length_left=2, audio_padding_length_right=2)
        latents = []
        boxes = []
        for (x1, y1, x2, y2), fr in zip(coords, frames):
            y2 = min(y2 + EXTRA_MARGIN, fr.shape[0])
            boxes.append((x1, y1, x2, y2))
            crop = cv2.resize(fr[y1:y2, x1:x2], (256, 256), interpolation=cv2.INTER_LANCZOS4)
            latents.append(vae.get_latents_for_unet(crop))
        frame_cycle = frames + frames[::-1]
        box_cycle = boxes + boxes[::-1]
        latent_cycle = latents + latents[::-1]
        h, w = frames[0].shape[:2]
        tmp_video = work / "mt_silent.mp4"
        enc = subprocess.Popen(["ffmpeg", "-nostdin", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "bgr24",
                                "-s", f"{w}x{h}", "-r", str(fps), "-i", "-", "-c:v", "libx264", "-preset", "veryfast",
                                "-crf", "17", "-pix_fmt", "yuv420p", str(tmp_video)], stdin=subprocess.PIPE)
        idx = 0
        try:
            with torch.no_grad():
                for wb, lb in datagen(whisper_chunks=chunks, vae_encode_latents=latent_cycle, batch_size=8,
                                      delay_frame=0, device=st["device"]):
                    feat = pe(wb.to(st["device"]))
                    pred = unet.model(lb.to(st["device"], dtype=unet.model.dtype), st["timesteps"], encoder_hidden_states=feat).sample
                    for res in vae.decode_latents(pred):
                        x1, y1, x2, y2 = box_cycle[idx % len(box_cycle)]
                        ori = copy.deepcopy(frame_cycle[idx % len(frame_cycle)])
                        try:
                            res = cv2.resize(res.astype(np.uint8), (x2 - x1, y2 - y1))
                            ori = get_image(ori, res, [x1, y1, x2, y2], mode="jaw", fp=fp)
                        except Exception:
                            pass
                        enc.stdin.write(np.ascontiguousarray(ori).astype(np.uint8).tobytes())
                        idx += 1
        finally:
            enc.stdin.close()
            enc.wait(timeout=600)
    if idx == 0 or not tmp_video.exists():
        raise RuntimeError("MuseTalk gav inga bildrutor.")
    out = work / "out.mp4"
    mux_audio(tmp_video, audio, out)
    return out
