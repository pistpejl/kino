"""EchoMimic V3 Flash (full-body singing / talking video) for the KINO session worker. T4 16 GB, sm75, SFW only.

Why EchoMimic V3 and not InfiniteTalk: InfiniteTalk is built on Wan2.1-I2V-14B. In fp16 that is ~28 GB of DiT
weights alone (+ ~11 GB umt5-xxl text encoder + CLIP): it does not fit a 16 GB T4, and its "very low VRAM" mode
streams the weights from CPU RAM (Colab has ~12.7 GB RAM). The memory-saving quant shipped upstream is FP8,
which Turing (sm75) cannot run, and the int8/GGUF community ports still have to stream a 14B model through a
T4 at roughly minutes per denoising step, i.e. far beyond KINO's job time for a 10 s clip. EchoMimic V3 (Ant
Group, Apache-2.0) is a 1.3B Wan2.1-Fun-InP model with audio layers, upstream-tested on a 16 GB V100 (also no
bf16/FP8) and documented at ~12 GB VRAM; the Flash weights need 8 steps.

Memory plan on one T4 (no model ever shares the card with umt5-xxl):
  1. umt5-xxl (11.4 GB bf16 file) is mmap-loaded, moved to the GPU in fp16, encodes the prompt + negative
     prompt once, and is freed again.
  2. DiT (EchoMimic V3 Flash, ~1.9B params fp16 ~3.7 GB) + CLIP vision tower + Wan VAE in fp16 on the GPU;
     wav2vec2 (chinese-wav2vec2-base) runs on the CPU.
  3. The clip is generated in chunks of up to 81 frames (3.2 s @ 25 fps); each chunk starts from the last frame
     of the previous one (identity from the original image via CLIP) and colours are matched to the first frame.

Lazy (first job, or ECHOMIMIC_PREFETCH in the notebook): own uv venv (Python 3.10, torch 2.6.0, diffusers 0.31)
~6 GB, code pinned to ECHOMIMIC_COMMIT, ~24 GB of weights (see WEIGHTS). Needs ~34 GB free disk; the worker
does not advertise the engine when the disk or the GPU is too small.

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

ECHOMIMIC_COMMIT = "7e89489ca51c0d008fc1963ec6c03fc5bd0b9397"
ECHOMIMIC_TARBALL = f"https://codeload.github.com/antgroup/echomimic_v3/tar.gz/{ECHOMIMIC_COMMIT}"
BASE = "Wan2.1-Fun-V1.1-1.3B-InP"
# (repo, file, local path under weights/, revision)
WEIGHTS = [
    ("alibaba-pai/Wan2.1-Fun-V1.1-1.3B-InP", f, f"{BASE}/{f}", None) for f in (
        "config.json", "diffusion_pytorch_model.safetensors", "Wan2.1_VAE.pth",
        "models_t5_umt5-xxl-enc-bf16.pth", "models_clip_open-clip-xlm-roberta-large-vit-huge-14.pth",
        "google/umt5-xxl/special_tokens_map.json", "google/umt5-xxl/spiece.model",
        "google/umt5-xxl/tokenizer.json", "google/umt5-xxl/tokenizer_config.json",
        "xlm-roberta-large/sentencepiece.bpe.model", "xlm-roberta-large/special_tokens_map.json",
        "xlm-roberta-large/tokenizer.json", "xlm-roberta-large/tokenizer_config.json")
] + [
    ("BadToBest/EchoMimicV3", "echomimicv3-flash-pro/config.json", "flash/transformer/config.json", None),
    ("BadToBest/EchoMimicV3", "echomimicv3-flash-pro/diffusion_pytorch_model.safetensors",
     "flash/transformer/diffusion_pytorch_model.safetensors", None),
    ("TencentGameMate/chinese-wav2vec2-base", "config.json", "chinese-wav2vec2-base/config.json", "refs/pr/1"),
    ("TencentGameMate/chinese-wav2vec2-base", "preprocessor_config.json", "chinese-wav2vec2-base/preprocessor_config.json", "refs/pr/1"),
    ("TencentGameMate/chinese-wav2vec2-base", "model.safetensors", "chinese-wav2vec2-base/model.safetensors", "refs/pr/1"),
]
WEIGHTS_GB = 24.0
NEED_GB = 34.0
MIN_VRAM_MB = 14500  # a T4 reports 15360 MiB
FPS = 25
CHUNK = 81           # frames per generation (upstream video_length); must be 4k+1
MAX_SECONDS = 12
NEG = ("Gesture is bad. Gesture is unclear. Strange and twisted hands. Bad hands. Bad fingers. Unclear and blurry "
       "hands. Unclear gestures, broken hands, fused fingers. nsfw, nudity, text, watermark, blurry, distorted face")
PIP_PACKAGES = [
    "torch==2.6.0", "torchvision==0.21.0", "diffusers==0.31.0", "transformers==4.46.3", "accelerate==1.2.1",
    "safetensors", "huggingface_hub<1", "numpy<2", "einops", "omegaconf", "decord", "librosa", "pyloudnorm",
    "soundfile", "opencv-python-headless", "imageio[ffmpeg]", "ftfy", "sentencepiece", "timm", "scipy",
    "scikit-image", "func_timeout", "torchdiffeq", "torchsde", "beautifulsoup4", "Pillow",
]
PIN = "echomimic-v3-flash:" + ECHOMIMIC_COMMIT[:12] + ":" + str(len(PIP_PACKAGES))
_lock = threading.Lock()
_setup_lock = threading.Lock()


def eprint(*a):
    print(*a, file=sys.stderr, flush=True)


# ---------------------------------------------------------------- pure helpers (tested)

def fits(vram_mb, free_disk_gb, installed: bool = False):
    """(ok, reason). Advertised only if the card has ~15 GB and the disk can hold the weights."""
    if not vram_mb or int(vram_mb) < MIN_VRAM_MB:
        return False, f"för lite grafikminne ({int(vram_mb or 0)} MB, behöver {MIN_VRAM_MB})"
    if not installed and float(free_disk_gb or 0) < NEED_GB:
        return False, f"för lite disk ({float(free_disk_gb or 0):.0f} GB ledigt, behöver ca {NEED_GB:.0f} GB)"
    return True, "ok"


def frames_for(seconds, fps: int = FPS) -> int:
    """Number of output frames for the audio (at least one chunk's minimum of 5 frames)."""
    s = max(0.2, min(float(MAX_SECONDS), float(seconds or 0) or 4.0))
    return max(5, int(round(s * fps)))


def _valid_len(n: int) -> int:
    """Wan needs 4k+1 frames."""
    n = max(5, int(n))
    return (n - 1) // 4 * 4 + 1


def chunk_plan(total: int, chunk: int = CHUNK):
    """Split `total` frames into generations of <= chunk frames (each 4k+1). Chunk i>0 starts on the last frame of
    chunk i-1 (one frame overlap, dropped when joining). Returns [(start_frame, length)], covering >= total."""
    chunk = _valid_len(chunk)
    total = max(1, int(total))
    plan = []
    start = 0
    while True:
        need = total - start
        length = _valid_len(need + 3) if need + 3 < chunk else chunk  # round up to cover the tail
        plan.append((start, length))
        end = start + length
        if end >= total:
            break
        start = end - 1
    return plan


def sample_hw(img_w: int, img_h: int, area: int):
    """Generation size: keep the image's aspect, area <= `area` pixels, both sides multiples of 16."""
    w, h = float(img_w), float(img_h)
    if w * h > area:
        r = math.sqrt(w * h / float(area))
        w, h = w / r, h / r
    return max(16, int(h) // 16 * 16), max(16, int(w) // 16 * 16)  # (height, width)


def output_size(h: int, w: int, short: int = 720):
    """Upscaled delivery size (even, short side `short`, never downscale)."""
    s = max(1.0, float(short) / min(h, w))
    return int(w * s) // 2 * 2, int(h * s) // 2 * 2  # (width, height)


def gpu_vram_mb() -> int:
    try:
        out = subprocess.check_output(["nvidia-smi", "--query-gpu=memory.total", "--format=csv,noheader,nounits"],
                                      text=True, timeout=8).strip().splitlines()
        return max(int(float(x)) for x in out if x.strip())
    except Exception:
        return 0


# ---------------------------------------------------------------- notebook side

def enabled() -> bool:
    return os.environ.get("KINO_ECHOMIMIC", "1") != "0"


def paths():
    import kino_venv as kv  # type: ignore
    home, free, ok = kv.pick_home("echomimic", NEED_GB)
    return {"home": home, "venv": home / "venv", "code": home / "code", "weights": home / "weights",
            "cache": home / "cache", "free_gb": free, "disk_ok": ok}


def _weights_done(weights: Path) -> bool:
    return all((weights / rel).exists() and (weights / rel).stat().st_size > 0 for _, _, rel, _ in WEIGHTS)


def is_ready() -> bool:
    p = paths()
    try:
        return ((p["venv"] / ".kino_ready").read_text().strip() == PIN
                and (p["code"] / ".kino_commit").read_text().strip() == ECHOMIMIC_COMMIT and _weights_done(p["weights"]))
    except Exception:
        return False


def wanted() -> tuple:
    """(advertise?, reason) — checked once at registration."""
    if not enabled():
        return False, "avstängd (ECHOMIMIC = False)"
    if os.environ.get("KINO_WORKER_MOCK") == "1":
        return True, "mock"
    p = paths()
    return fits(gpu_vram_mb(), p["free_gb"], installed=_weights_done(p["weights"]))


def _ensure_code(code: Path):
    marker = code / ".kino_commit"
    if marker.exists() and marker.read_text().strip() == ECHOMIMIC_COMMIT and (code / "src").is_dir():
        return code
    eprint("EchoMimic V3: hämtar koden", ECHOMIMIC_COMMIT[:8])
    tmp = Path(tempfile.mkdtemp(prefix="echomimic-src-"))
    tgz = tmp / "src.tgz"
    urllib.request.urlretrieve(ECHOMIMIC_TARBALL, tgz)
    with tarfile.open(tgz) as tf:
        try:
            tf.extractall(tmp, filter="data")
        except TypeError:
            tf.extractall(tmp)
    src = next(p for p in tmp.iterdir() if p.is_dir() and p.name.startswith("echomimic"))
    shutil.rmtree(src / "datasets", ignore_errors=True)  # demo media, ~90 MB
    if code.exists():
        shutil.rmtree(code, ignore_errors=True)
    shutil.move(str(src), str(code))
    marker.write_text(ECHOMIMIC_COMMIT)
    shutil.rmtree(tmp, ignore_errors=True)
    return code


def _ensure_weights(weights: Path):
    from huggingface_hub import hf_hub_download
    for repo, fn, rel, rev in WEIGHTS:
        dest = weights / rel
        if dest.exists() and dest.stat().st_size > 0:
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        eprint(f"EchoMimic V3: hämtar {repo}/{fn}")
        tmpdir = weights / ".dl"
        got = hf_hub_download(repo_id=repo, filename=fn, revision=rev, local_dir=str(tmpdir))
        shutil.move(got, str(dest))
    shutil.rmtree(weights / ".dl", ignore_errors=True)


def ensure(log=eprint):
    import kino_venv as kv  # type: ignore
    p = paths()
    if not p["disk_ok"] and not _weights_done(p["weights"]):
        raise RuntimeError(f"EchoMimic V3 behöver ca {NEED_GB:.0f} GB ledigt, bara {p['free_gb']:.1f} GB finns på {p['home'].parent}.")
    with _setup_lock:
        p["home"].mkdir(parents=True, exist_ok=True)
        py = kv.ensure_venv(p["venv"], PIP_PACKAGES, PIN, "EchoMimic V3", _lock, log)
        _ensure_code(p["code"])
        _ensure_weights(p["weights"])
    return py, p


def prefetch(log=eprint):
    ensure(log)
    log("EchoMimic V3 redo (miljö + ~24 GB vikter hämtade)")


def run(image: Path, audio: Path, work: Path, prompt: str = "", seconds: float | None = None,
        ratio: str = "9:16", timeout: int = 5100) -> Path:
    """Still image (or the first frame of a video) + audio -> singing/talking clip with head and body motion."""
    import kino_venv as kv  # type: ignore
    py, p = ensure()
    work = Path(work)
    work.mkdir(parents=True, exist_ok=True)
    wav = work / "em_audio.wav"
    subprocess.check_call(["ffmpeg", "-nostdin", "-y", "-v", "error", "-i", str(audio), "-ac", "1", "-ar", "16000",
                           "-t", str(MAX_SECONDS), str(wav)], timeout=180)
    src = Path(image)
    if src.suffix.lower() not in (".jpg", ".jpeg", ".png", ".webp", ".bmp"):
        still = work / "em_ref.png"
        subprocess.check_call(["ffmpeg", "-nostdin", "-y", "-v", "error", "-i", str(src), "-frames:v", "1", str(still)], timeout=120)
        src = still
    silent = work / "em_silent.mp4"
    opts = {"image": str(src), "audio": str(wav), "out": str(silent), "weights": str(p["weights"]),
            "prompt": prompt, "seconds": seconds,
            "area": int(os.environ.get("KINO_ECHOMIMIC_AREA", str(512 * 512))),
            "steps": int(os.environ.get("KINO_ECHOMIMIC_STEPS", "8")),
            "dtype": os.environ.get("KINO_ECHOMIMIC_DTYPE", "fp16"),
            "short": int(os.environ.get("KINO_ECHOMIMIC_SHORT", "720"))}
    (work / "em_opts.json").write_text(json.dumps(opts))
    eprint(f"EchoMimic V3: startar ({seconds or 0:.1f} s)")
    rc, tail = kv.run_logged([py, str(Path(__file__).resolve()), "run", "--opts", str(work / "em_opts.json")],
                             env=kv.lib_env(p["venv"], p["cache"]), cwd=p["code"], timeout=timeout, prefix="echomimic")
    if rc != 0 or not silent.exists() or silent.stat().st_size == 0:
        raise RuntimeError(f"EchoMimic V3 misslyckades: {kv.error_tail(tail) or rc}")
    out = work / "em_out.mp4"
    subprocess.check_call(["ffmpeg", "-nostdin", "-y", "-v", "error", "-i", str(silent), "-i", str(audio),
                           "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-shortest", str(out)], timeout=300)
    return out


# ---------------------------------------------------------------- inside the venv

def _free():
    import gc
    gc.collect()
    import torch
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


def _filter_kwargs(cls, kwargs):
    import inspect
    names = set(inspect.signature(cls.__init__).parameters) - {"self", "cls"}
    return {k: v for k, v in kwargs.items() if k in names}


def _tload(path):
    """torch.load that maps the file instead of reading it into RAM (Colab has ~12.7 GB; umt5-xxl alone is 11.4 GB)."""
    import torch
    for kw in ({"mmap": True, "weights_only": True}, {"mmap": True, "weights_only": False}, {"weights_only": False}):
        try:
            return torch.load(str(path), map_location="cpu", **kw)
        except Exception as err:  # legacy (non-zip) files cannot be mmapped
            last = err
    raise last


def _load_meta(model, state_dict, device, dtype, what):
    """Copy an (mmapped) state dict into a model built with init_empty_weights, straight onto `device`."""
    import torch
    own = model.state_dict()
    missing = [k for k in own if k not in state_dict]
    if missing:
        raise RuntimeError(f"{what}: {len(missing)} vikter saknas, t.ex. {missing[:3]}")
    model.load_state_dict({k: v for k, v in state_dict.items() if k in own}, strict=False, assign=True)
    model.to(device=device, dtype=dtype)
    for n, prm in model.named_parameters():
        if prm.is_meta:
            raise RuntimeError(f"{what}: {n} laddades inte")
    return model


def _encode_text(cfg, weights: Path, prompts, device, dtype):
    import torch
    from accelerate import init_empty_weights
    from transformers import AutoTokenizer
    from src.wan_text_encoder import WanT5EncoderModel
    kw = dict(cfg["text_encoder_kwargs"])
    tok = AutoTokenizer.from_pretrained(str(weights / BASE / kw.get("tokenizer_subpath", "tokenizer")))
    with init_empty_weights():
        t5 = WanT5EncoderModel(**_filter_kwargs(WanT5EncoderModel, kw))
    sd = _tload(weights / BASE / kw["text_encoder_subpath"])
    t5 = _load_meta(t5, sd, device, dtype, "umt5-xxl").eval()
    del sd
    out = []
    with torch.no_grad():
        for p in prompts:
            ti = tok([p], padding="max_length", max_length=512, truncation=True, add_special_tokens=True, return_tensors="pt")
            n = int(ti.attention_mask.gt(0).sum())
            e = t5(ti.input_ids.to(device), attention_mask=ti.attention_mask.to(device))[0]
            if not torch.isfinite(e).all():
                raise RuntimeError("umt5-xxl gav NaN/inf i fp16 – prova ECHOMIMIC_DTYPE='bf16'")
            out.append(e[0, :n].to(dtype).detach())
    peak = torch.cuda.max_memory_allocated() / 1e9
    del t5
    _free()
    print(f"KINO EchoMimic: text kodad (umt5-xxl, topp {peak:.1f} GB), modellen urladdad", flush=True)
    return out


def _load_transformer(cfg, weights: Path, device, dtype):
    import torch
    from accelerate import init_empty_weights
    from omegaconf import OmegaConf
    from safetensors import safe_open
    from safetensors.torch import load_file
    from src.wan_transformer3d_audio_2512 import WanTransformerAudioMask3DModel as WanTransformer
    base = weights / BASE
    config = json.loads((base / "config.json").read_text())
    kw = OmegaConf.to_container(cfg["transformer_additional_kwargs"])
    for k, v in (kw.get("dict_mapping") or {}).items():
        kw[v] = config[k]
    with init_empty_weights():
        model = WanTransformer.from_config(config, **kw)
    sd = load_file(str(weights / "flash/transformer/diffusion_pytorch_model.safetensors"))
    own = model.state_dict()
    lack = [k for k in own if k not in sd]
    if lack:  # anything the Flash file does not carry comes from the base Wan2.1-Fun model (as upstream strict=False)
        with safe_open(str(base / "diffusion_pytorch_model.safetensors"), framework="pt") as f:
            have = set(f.keys())
            for k in lack:
                if k in have:
                    sd[k] = f.get_tensor(k)
        print(f"KINO EchoMimic: {len(lack)} vikter från bas-Wan", flush=True)
    model = _load_meta(model, sd, device, dtype, "EchoMimic V3 Flash DiT")
    del sd
    return model.eval()


def _load_clip(cfg, weights: Path, device, dtype):
    import torch
    from accelerate import init_empty_weights
    from src.wan_image_encoder import CLIPModel
    with init_empty_weights():
        clip = CLIPModel()
    raw = _tload(weights / BASE / cfg["image_encoder_kwargs"]["image_encoder_subpath"])
    sd = {"model." + k: v for k, v in raw.items()}
    clip = _load_meta(clip, sd, device, dtype, "CLIP")
    del raw, sd
    if hasattr(clip.model, "textual"):
        clip.model.textual = None  # only the vision tower is used (saves ~1 GB VRAM)
    _free()
    return clip.eval()


def _audio_embeds(audio_path, weights: Path, n_frames: int):
    import librosa
    import numpy as np
    import pyloudnorm as pyln
    import torch
    from einops import rearrange
    from transformers import Wav2Vec2FeatureExtractor
    from src.wav2vec2 import Wav2Vec2Model
    d = str(weights / "chinese-wav2vec2-base")
    enc = Wav2Vec2Model.from_pretrained(d, local_files_only=True).to("cpu").eval()
    enc.feature_extractor._freeze_parameters()
    fe = Wav2Vec2FeatureExtractor.from_pretrained(d, local_files_only=True)
    y, sr = librosa.load(audio_path, sr=16000)
    try:
        loud = pyln.Meter(sr).integrated_loudness(y)
        if abs(loud) <= 100:
            y = pyln.normalize.loudness(y, loud, -23)
    except Exception:
        pass
    y = y[: int(n_frames / FPS * sr)]
    if len(y) < int(n_frames / FPS * sr):
        y = np.pad(y, (0, int(n_frames / FPS * sr) - len(y)))
    feat = np.squeeze(fe(y, sampling_rate=sr).input_values)
    feat = torch.from_numpy(feat).float().unsqueeze(0)
    with torch.no_grad():
        emb = enc(feat, seq_len=int(n_frames), output_hidden_states=True)
    emb = torch.stack(emb.hidden_states[1:], dim=1).squeeze(0)
    emb = rearrange(emb, "b s d -> s b d").cpu()
    idx = (torch.arange(0, n_frames).unsqueeze(1) + (torch.arange(5) - 2).unsqueeze(0)).clamp(0, emb.shape[0] - 1)
    del enc
    return emb[idx]  # [F, 5, layers, 768]


def _run(opts_path: str):
    opts = json.loads(Path(opts_path).read_text())
    import numpy as np
    import torch
    from omegaconf import OmegaConf
    from PIL import Image
    from transformers import AutoTokenizer
    from src.wan_vae import AutoencoderKLWan
    from src.pipeline_wan_fun_inpaint_audio_2512 import WanFunInpaintAudioPipeline
    from src.fm_solvers_unipc import FlowUniPCMultistepScheduler
    from src.cache_utils import get_teacache_coefficients
    from src.utils import filter_kwargs, get_image_to_video_latent2, color_transfer

    if not torch.cuda.is_available():
        raise RuntimeError("Ingen CUDA-GPU i EchoMimic-miljön")
    dev = torch.device("cuda")
    dtype = {"fp16": torch.float16, "bf16": torch.bfloat16, "fp32": torch.float32}.get(opts.get("dtype"), torch.float16)
    cap = torch.cuda.get_device_capability()
    print(f"KINO EchoMimic V3 Flash: {torch.cuda.get_device_name()} sm{cap[0]}{cap[1]}, {dtype}, torch {torch.__version__}", flush=True)
    weights = Path(opts["weights"])
    cfg = OmegaConf.load("config/config.yaml")

    ref = Image.open(opts["image"]).convert("RGB")
    audio_sec = float(opts.get("seconds") or 0) or None
    if not audio_sec:
        import librosa
        audio_sec = librosa.get_duration(path=opts["audio"])
    total = frames_for(audio_sec)
    plan = chunk_plan(total)
    h, w = sample_hw(ref.width, ref.height, int(opts.get("area") or 512 * 512))
    print(f"KINO EchoMimic: {total} bildrutor ({audio_sec:.1f} s) i {len(plan)} delar, {w}x{h}", flush=True)

    prompt = ", ".join(x for x in (opts.get("prompt") or "", "a person singing expressively, natural head and body motion, lips in sync with the audio, realistic, SFW") if x)
    pe_t, ne_t = _encode_text(cfg, weights, [prompt, NEG], dev, dtype)
    pe, ne = [pe_t], [ne_t]
    audio_all = _audio_embeds(opts["audio"], weights, plan[-1][0] + plan[-1][1])

    transformer = _load_transformer(cfg, weights, dev, dtype)
    vae = AutoencoderKLWan.from_pretrained(str(weights / BASE / cfg["vae_kwargs"].get("vae_subpath", "vae")),
                                           additional_kwargs=OmegaConf.to_container(cfg["vae_kwargs"])).to(dev, dtype)
    clip = _load_clip(cfg, weights, dev, dtype)
    tok = AutoTokenizer.from_pretrained(str(weights / BASE / cfg["text_encoder_kwargs"].get("tokenizer_subpath", "tokenizer")))
    sk = OmegaConf.to_container(cfg["scheduler_kwargs"])
    sk["shift"] = 1
    scheduler = FlowUniPCMultistepScheduler(**filter_kwargs(FlowUniPCMultistepScheduler, sk))

    class KinoTextStub(torch.nn.Module):
        """umt5-xxl is already freed; the pipeline only reads text_encoder.dtype/.device when embeddings are given."""
        def __init__(self):
            super().__init__()
            self.register_buffer("kino_dtype", torch.zeros(1, dtype=dtype, device=dev))

        @property
        def dtype(self):
            return self.kino_dtype.dtype

        @property
        def device(self):
            return self.kino_dtype.device

    stub = KinoTextStub()
    pipe = WanFunInpaintAudioPipeline(transformer=transformer, vae=vae, tokenizer=tok, text_encoder=stub,
                                      scheduler=scheduler, clip_image_encoder=clip)
    coeff = get_teacache_coefficients(str(weights / BASE))
    steps = int(opts.get("steps") or 8)
    if coeff is not None:
        transformer.enable_teacache(coeff, steps, 0.1, num_skip_start_steps=min(5, steps), offload=False)
    print(f"KINO EchoMimic: modeller laddade, VRAM {torch.cuda.memory_allocated() / 1e9:.1f} GB", flush=True)

    frames = []
    first = None
    start_img = ref
    gen = torch.Generator(device=dev).manual_seed(43)
    for ci, (s0, n) in enumerate(plan):
        if getattr(transformer, "teacache", None) is not None:
            transformer.teacache.reset()
        a = audio_all[s0:s0 + n].unsqueeze(0).to(dev, dtype)
        video, mask, _ = get_image_to_video_latent2(start_img, None, video_length=n, sample_size=[h, w])
        clip_img = ref.resize((w, h), Image.LANCZOS)
        with torch.no_grad():
            out = pipe(prompt, num_frames=n, negative_prompt=NEG, audio_embeds=a, audio_scale=1.0, ip_mask=None,
                       use_un_ip_mask=False, height=h, width=w, generator=gen, neg_scale=1.0, neg_steps=0,
                       use_dynamic_cfg=False, use_dynamic_acfg=False, guidance_scale=6.0, audio_guidance_scale=3.0,
                       num_inference_steps=steps, video=video, mask_video=mask, clip_image=clip_img,
                       cfg_skip_ratio=0.0, shift=5.0, prompt_embeds=pe, negative_prompt_embeds=ne).videos
        v = out if isinstance(out, np.ndarray) else out.float().cpu().numpy()
        v = np.nan_to_num(v[0])  # c t h w, 0..1
        if float(v.mean()) < 0.01:
            raise RuntimeError(f"EchoMimic gav svarta bildrutor i del {ci + 1} ({dtype}) – prova ECHOMIMIC_DTYPE='bf16'")
        clip_frames = [(np.clip(v[:, t].transpose(1, 2, 0), 0, 1) * 255).astype(np.uint8) for t in range(v.shape[1])]
        if first is None:
            first = clip_frames[0]
        clip_frames = [color_transfer(f, first) if k or ci else f for k, f in enumerate(clip_frames)]
        frames.extend(clip_frames if ci == 0 else clip_frames[1:])
        start_img = Image.fromarray(clip_frames[-1])
        print(f"KINO EchoMimic: del {ci + 1}/{len(plan)} klar ({len(frames)} bildrutor, topp-VRAM {torch.cuda.max_memory_allocated() / 1e9:.1f} GB)", flush=True)
        _free()
    frames = frames[:total]
    ow, oh = output_size(frames[0].shape[0], frames[0].shape[1], int(opts.get("short") or 720))
    enc = subprocess.Popen(["ffmpeg", "-nostdin", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
                            "-s", f"{frames[0].shape[1]}x{frames[0].shape[0]}", "-r", str(FPS), "-i", "-",
                            "-vf", f"scale={ow}:{oh}:flags=lanczos", "-c:v", "libx264", "-preset", "veryfast",
                            "-crf", "17", "-pix_fmt", "yuv420p", opts["out"]], stdin=subprocess.PIPE)
    for f in frames:
        enc.stdin.write(np.ascontiguousarray(f).tobytes())
    enc.stdin.close()
    enc.wait(timeout=600)
    print(f"KINO EchoMimic klar: {len(frames)} bildrutor, {ow}x{oh}", flush=True)


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
