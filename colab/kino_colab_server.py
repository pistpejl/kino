# KINO Colab-motor: FastAPI-server for KINO pa en Colab-GPU (T4).
# Alla anrop kraver token. Modeller laddas lat, en i taget, och VRAM frigors mellan dem.
# KINO_STUB=1: GPU-modeller ersatts av stubbar (lokalt test). KINO_STUB_AUDIO=1: aven Demucs/Whisper stubbas.
import os, sys, re, io, gc, json, uuid, time, base64, shutil, threading, queue, secrets, tempfile, subprocess
from typing import Optional, List
from fastapi import FastAPI, Form, File, UploadFile, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

TOKEN = os.environ.get("KINO_TOKEN") or secrets.token_urlsafe(24)
STUB = os.environ.get("KINO_STUB") == "1"
STUB_AUDIO = os.environ.get("KINO_STUB_AUDIO") == "1"
WAN_ID = "Wan-AI/Wan2.1-T2V-1.3B-Diffusers"
SVD_ID = "stabilityai/stable-video-diffusion-img2vid"
SDXL_ID = "stabilityai/sdxl-turbo"
NSFW_ID = "Falconsai/nsfw_image_detection"
LS_DIR, LS_PY = "/content/LatentSync", "/content/ls_env/bin/python"
INSWAPPER = os.environ.get("KINO_INSWAPPER", "/content/models/inswapper_128.onnx")
WORK = tempfile.mkdtemp(prefix="kino_")
FPS, MAX_SECONDS, MIN_AGE = 16, 5, 21
LICENSE_NOTE = "Ansiktsbyte använder InsightFace/inswapper: endast icke-kommersiellt bruk."

# ---------------- Innehallsregler ----------------
MINOR_RE = re.compile(r"(^|[^a-zåäö0-9])(child|children|kids?|minors?|underage|under[\s-]*age|teens?|teenage[rs]?|preteen|tween|adolescent|juvenile|loli(ta|con)?|shota(con)?|young[\s-]*looking|barely[\s-]*legal|jailbait|school[\s-]*(girl|boy|uniform)|kindergarten|toddler|baby|infant|little[\s-]*(girl|boy)|young[\s-]*(girl|boy)|barn(et|en)?|minderåriga?|omyndig|tonåring(ar)?|tonårs|flick(a|an|or)|pojk(e|en|ar)|skolflicka|skolpojke|dagis|bebis|småbarn)(?=$|[^a-zåäö0-9])", re.I)
AGE_RE = re.compile(r"\b(\d{1,2})\s*(?:-|\s)?\s*(?:yo|y/o|yrs?|years?(?:[\s-]*old)?|år(?:ig|ing|s)?|åring)\b", re.I)
NSFW_RE = re.compile(r"(^|[^a-zåäö0-9])(nsfw|nude|naked|nudity|porn\w*|sex\w*|explicit|erotic\w*|topless|lingerie|genital\w*|nipples?|naken|nakna|porr\w*|erotisk\w*|bröstvårtor?)(?=$|[^a-zåäö0-9])", re.I)
STYLE = "natural handheld phone video, real-life lighting, slight camera shake, authentic, unpolished, true-to-life colors"
IMG_STYLE = "candid phone photo, natural light, real-life, unpolished, true-to-life colors"
NEGATIVE = "AI look, overly smooth skin, plastic, CGI, 3d render, oversaturated, cinematic color grading, glossy, airbrushed, text, watermark, blurry, deformed, extra fingers, static frame"

def check_text(text: str, has_person_media: bool = False, nsfw: bool = False):
    """nsfw=True bara for text-till-bild utan indata: minderarsspärren galler alltid (och aldrar under 21 i NSFW)."""
    s = (text or "").lower()
    if MINOR_RE.search(s) or any(int(m.group(1)) < (MIN_AGE if nsfw else 18) for m in AGE_RE.finditer(s)):
        raise HTTPException(400, "Nekad: KINO gör aldrig något som rör minderåriga.")
    if nsfw:
        if has_person_media: raise HTTPException(400, "Nekad: riktiga personers foton får aldrig användas i NSFW.")
        return
    if NSFW_RE.search(s):
        if has_person_media:
            raise HTTPException(400, "Nekad: riktiga personers foton får aldrig användas i NSFW.")
        raise HTTPException(400, "Nekad: Colab-motorn är bara SFW.")

ASPECT = {"9:16": (480, 832), "16:9": (832, 480), "1:1": (624, 624)}
IMG_ASPECT = {"9:16": (576, 1024), "16:9": (1024, 576), "1:1": (768, 768)}

# ---------------- Modellhanterare: en tung modell i taget ----------------
_lock = threading.Lock()
_cur = {"name": None, "obj": None}
def free_vram():
    _cur["name"], _cur["obj"] = None, None
    gc.collect()
    try:
        import torch
        if torch.cuda.is_available(): torch.cuda.empty_cache()
    except Exception: pass
def use(name, loader):
    if _cur["name"] != name:
        free_vram(); _cur["obj"] = loader(); _cur["name"] = name
    return _cur["obj"]

def load_wan():
    import torch
    from diffusers import AutoencoderKLWan, WanPipeline
    vae = AutoencoderKLWan.from_pretrained(WAN_ID, subfolder="vae", torch_dtype=torch.float32)
    p = WanPipeline.from_pretrained(WAN_ID, vae=vae, torch_dtype=torch.float16); p.enable_model_cpu_offload()
    return p
def load_svd():
    import torch
    from diffusers import StableVideoDiffusionPipeline
    p = StableVideoDiffusionPipeline.from_pretrained(SVD_ID, torch_dtype=torch.float16, variant="fp16"); p.enable_model_cpu_offload()
    return p
def load_sdxl():
    import torch
    from diffusers import AutoPipelineForText2Image
    p = AutoPipelineForText2Image.from_pretrained(SDXL_ID, torch_dtype=torch.float16, variant="fp16"); p.enable_model_cpu_offload()
    return p
def load_whisper():
    import whisper, torch
    return whisper.load_model("small", device="cuda" if torch.cuda.is_available() else "cpu")
def load_faces():
    from insightface.app import FaceAnalysis
    import insightface
    fa = FaceAnalysis(name="buffalo_l", providers=["CUDAExecutionProvider", "CPUExecutionProvider"]); fa.prepare(ctx_id=0, det_size=(640, 640))
    sw = insightface.model_zoo.get_model(INSWAPPER, providers=["CUDAExecutionProvider", "CPUExecutionProvider"]) if os.path.exists(INSWAPPER) else None
    return fa, sw
_nsfw = {"p": None}
def nsfw_frames(paths_or_imgs):
    """Billig NSFW-koll (liten ViT-klassare pa CPU). Returnerar True om nagon bild ar NSFW."""
    if STUB: return False
    from transformers import pipeline
    from PIL import Image
    if _nsfw["p"] is None: _nsfw["p"] = pipeline("image-classification", model=NSFW_ID, device=-1)
    for x in paths_or_imgs:
        img = Image.open(x).convert("RGB") if isinstance(x, str) else x
        r = {d["label"]: d["score"] for d in _nsfw["p"](img)}
        if r.get("nsfw", 0) > 0.6: return True
    return False

# ---------------- Hjalp ----------------
def ff(*args):
    r = subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *map(str, args)], capture_output=True, text=True)
    if r.returncode: raise RuntimeError("ffmpeg: " + r.stderr[-400:])
def probe_dur(p):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p], capture_output=True, text=True)
    return float(r.stdout.strip() or 0)
def has_audio(p):
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", p], capture_output=True, text=True)
    return bool(r.stdout.strip())
async def save_upload(u: UploadFile, d, name=None):
    ext = os.path.splitext(u.filename or "")[1][:8] or ".bin"
    p = os.path.join(d, (name or uuid.uuid4().hex[:8]) + ext)
    with open(p, "wb") as f: f.write(await u.read())
    return p
def srt_time(t):
    ms = int(round(t * 1000)); h, ms = divmod(ms, 3600000); m, ms = divmod(ms, 60000); s, ms = divmod(ms, 1000)
    return f"{h:02}:{m:02}:{s:02},{ms:03}"
def fit_filter(w, h):
    return f"scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},setsar=1,fps=30"

# ---------------- Jobb ----------------
jobs, q = {}, queue.Queue()
def submit(kind, fn, **meta):
    jid = uuid.uuid4().hex[:12]; d = os.path.join(WORK, jid); os.makedirs(d)
    jobs[jid] = {"id": jid, "kind": kind, "status": "queued", "dir": d, "files": {}, "data": None, "created": time.time(), "fn": fn, **meta}
    return jid, d
def go(jid, **extra):
    jobs[jid].update(extra); q.put(jobs[jid]); return {"jobId": jid, "status": "queued"}
def worker():
    while True:
        job = q.get(); job["status"] = "running"; job["started"] = time.time()
        try:
            with _lock: job["fn"](job)
            job["status"] = "done"
        except Exception as e:
            job["status"] = "error"; job["error"] = str(e)[:400]
        finally:
            job["finished"] = time.time()
            if job["kind"] in ("lipsync",): free_vram()
threading.Thread(target=worker, daemon=True).start()

# ---------------- Uppgifter ----------------
def task_video(job):
    path = os.path.join(job["dir"], "video.mp4"); w, h = ASPECT[job["aspect"]]
    frames = ((min(job["seconds"], MAX_SECONDS) * FPS) // 4) * 4 + 1
    if STUB:
        import numpy as np, imageio
        imageio.mimsave(path, [np.full((h // 4, w // 4, 3), (i * 7) % 255, dtype=np.uint8) for i in range(frames)], fps=FPS, macro_block_size=1)
    elif job.get("image"):  # SVD bild-till-video: den uppladdade forsta bildrutan anvands
        import torch
        from PIL import Image, ImageOps
        from diffusers.utils import export_to_video
        p = use("svd", load_svd)
        sw, sh = (576, 1024) if job["aspect"] == "9:16" else (1024, 576) if job["aspect"] == "16:9" else (768, 768)
        img = ImageOps.fit(Image.open(job["image"]).convert("RGB"), (sw, sh))
        out = p(img, decode_chunk_size=2, num_frames=14, motion_bucket_id=job["motion"], noise_aug_strength=0.02,
                generator=torch.Generator("cpu").manual_seed(job["seed"])).frames[0]
        export_to_video(out, path, fps=7)
    else:
        import torch
        from diffusers.utils import export_to_video
        p = use("wan", load_wan)
        out = p(prompt=f"{job['prompt']}. {STYLE}", negative_prompt=NEGATIVE, height=h, width=w, num_frames=frames,
                num_inference_steps=job["steps"], guidance_scale=5.0, generator=torch.Generator("cpu").manual_seed(job["seed"])).frames[0]
        export_to_video(out, path, fps=FPS)
    job["files"]["video.mp4"] = path

# ---------------- Bildmodeller (oppna vikter fran Hugging Face, 4-bit/nf4 + CPU-offload for T4) ----------------
HF_TOKEN = os.environ.get("HF_TOKEN") or None  # bara for gated modeller (FLUX 3 klein); skrivs aldrig ut
ESRGAN_REPO, ESRGAN_FILE = "ai-forever/Real-ESRGAN", "RealESRGAN_x4.pth"
# nyckel: (etikett, HF-id, gated, steg, guidance)
IMAGE_MODELS = {
    "sdxl":       ("SDXL-Turbo (snabbast)", SDXL_ID, False, 2, 0.0),
    "flux3klein": ("FLUX 3 Image Klein", "black-forest-labs/flux-3-image-klein", True, 4, 1.0),
    "flux2klein": ("FLUX.2 klein 4B", "black-forest-labs/FLUX.2-klein-4B", False, 4, 1.0),
    "flux1schnell": ("FLUX.1 schnell (nf4)", "magespace/FLUX.1-schnell-bnb-nf4", False, 4, 0.0),
    "qwen21":     ("Qwen-Image 2.1", "Qwen/Qwen-Image-2.1", False, 20, 4.0),
    "qwen2512":   ("Qwen-Image 2512 (4-bit)", "ovedrive/Qwen-Image-2512-4bit", False, 20, 4.0),
    "zimage":     ("Z-Image Turbo", "Tongyi-MAI/Z-Image-Turbo", False, 9, 0.0),
    "ernie":      ("ERNIE-Image Turbo", "baidu/ERNIE-Image-Turbo", False, 8, 1.0),
}
EDIT_MODELS = {
    "qwenedit":   ("Qwen-Image-Edit 2511 (4-bit)", "ovedrive/Qwen-Image-Edit-2511-4bit", 20, 4.0),
    "flux2klein": ("FLUX.2 klein 4B (redigera)", "black-forest-labs/FLUX.2-klein-4B", 4, 1.0),
}
def model_available(key):
    return key in IMAGE_MODELS and (not IMAGE_MODELS[key][2] or bool(HF_TOKEN))

def nf4(*components):
    import torch
    from diffusers.quantizers import PipelineQuantizationConfig
    return PipelineQuantizationConfig(quant_backend="bitsandbytes_4bit", components_to_quantize=list(components),
        quant_kwargs={"load_in_4bit": True, "bnb_4bit_quant_type": "nf4", "bnb_4bit_compute_dtype": torch.bfloat16})

def load_diffusers(key, edit=False):
    """Laddar en pipeline sa att den far plats pa en T4 (15 GB): 4-bit-vikter + modell-CPU-offload."""
    import torch, diffusers
    bf = torch.bfloat16
    repo = (EDIT_MODELS if edit else IMAGE_MODELS)[key][1]
    if key == "flux3klein":  # bara modular-pipeline i diffusers 0.42
        from diffusers import ModularPipeline, BitsAndBytesConfig
        from transformers import BitsAndBytesConfig as TBnb
        qd = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_compute_dtype=bf)
        qt = TBnb(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_compute_dtype=bf)
        p = ModularPipeline.from_pretrained(repo, token=HF_TOKEN)
        p.load_components(torch_dtype=bf, token=HF_TOKEN, quantization_config={"transformer": qd, "text_encoder": qt})
        p.to("cuda"); return p
    if key == "qwenedit":
        p = diffusers.QwenImageEditPlusPipeline.from_pretrained(repo, torch_dtype=bf)  # redan 4-bit
    elif key == "qwen2512":
        p = diffusers.QwenImagePipeline.from_pretrained(repo, torch_dtype=bf)  # redan 4-bit
    elif key == "flux1schnell":
        p = diffusers.FluxPipeline.from_pretrained(repo, torch_dtype=bf)  # redan nf4
    elif key == "qwen21":
        p = diffusers.QwenImage21Pipeline.from_pretrained(repo, torch_dtype=bf, quantization_config=nf4("transformer", "text_encoder"))
    elif key == "flux2klein":
        p = diffusers.Flux2KleinPipeline.from_pretrained(repo, torch_dtype=bf, quantization_config=nf4("transformer", "text_encoder"))
    elif key == "zimage":
        p = diffusers.ZImagePipeline.from_pretrained(repo, torch_dtype=bf, quantization_config=nf4("transformer", "text_encoder"))
    elif key == "ernie":  # promptforbattraren (pe, 8 GB) hoppas over for att spara minne
        p = diffusers.ErnieImagePipeline.from_pretrained(repo, torch_dtype=bf, pe=None, pe_tokenizer=None,
                                                         quantization_config=nf4("transformer", "text_encoder"))
    else: raise RuntimeError("Okänd modell: " + key)
    p.enable_model_cpu_offload(); return p

def load_esrgan():
    import torch, spandrel
    from huggingface_hub import hf_hub_download
    m = spandrel.ModelLoader().load_from_file(hf_hub_download(ESRGAN_REPO, ESRGAN_FILE))
    return m.cuda().half().eval() if torch.cuda.is_available() else m.eval()

def check_output(img, nsfw=False):
    """Minderarsparr pa varje utdata (InsightFace-alder under 21 = nekad, aven i NSFW). NSFW-klassaren hoppas bara over i NSFW-text-till-bild."""
    if STUB: return
    import cv2, numpy as np
    try: faces = detect(cv2.cvtColor(np.array(img.convert("RGB")), cv2.COLOR_RGB2BGR))
    except Exception as e: raise RuntimeError("Ålderskontrollen kunde inte köras, bilden avvisas: " + str(e)[:120])
    for f in faces:
        if not face_age_ok(f): raise RuntimeError("Nekad: en person i resultatet bedöms vara under 21 år.")
    if not nsfw and nsfw_frames([img]): raise RuntimeError("Nekad: bilden flaggades som NSFW.")

def run_t2i(key, prompt, w, h, seed, nsfw=False):
    import torch
    _, _, _, steps, g = IMAGE_MODELS[key]
    gen = torch.Generator("cpu").manual_seed(seed)
    if key == "sdxl":
        p = use("sdxl", load_sdxl)
        neg = NEGATIVE + (", child, teen, young-looking, childlike" if nsfw else "")
        return p(prompt=f"{prompt}, {IMG_STYLE}" + (", adult" if nsfw else ""), negative_prompt=neg, width=w, height=h, num_inference_steps=steps,
                 guidance_scale=g, generator=gen).images[0]
    p = use("img:" + key, lambda: load_diffusers(key)); full = f"{prompt}, {IMG_STYLE}" + (", adults only" if nsfw else "")
    if key == "flux3klein":
        return p(prompt=full, width=w, height=h, num_inference_steps=steps, generator=gen, output="images")[0]
    if key in ("qwen21", "qwen2512"):
        return p(prompt=full, negative_prompt=NEGATIVE, true_cfg_scale=g, width=w, height=h, num_inference_steps=steps, generator=gen).images[0]
    if key == "flux1schnell":
        return p(prompt=full, width=w, height=h, num_inference_steps=steps, guidance_scale=g, max_sequence_length=256, generator=gen).images[0]
    if key == "ernie":
        return p(prompt=full, width=w, height=h, num_inference_steps=steps, guidance_scale=g, use_pe=False, generator=gen).images[0]
    return p(prompt=full, width=w, height=h, num_inference_steps=steps, guidance_scale=g, generator=gen).images[0]

def task_image(job):
    path = os.path.join(job["dir"], "image.png"); w, h = IMG_ASPECT[job["aspect"]]
    if STUB:
        from PIL import Image; Image.new("RGB", (w // 4, h // 4), (120, 110, 100)).save(path)
    else:
        img = run_t2i(job["model"], job["prompt"], w, h, job["seed"], job.get("nsfw", False))
        check_output(img, job.get("nsfw", False)); img.save(path)
    job["files"]["image.png"] = path; job["data"] = {"model": job["model"], "modelId": IMAGE_MODELS[job["model"]][1], "nsfw": job.get("nsfw", False)}

def task_edit(job):
    if not STUB: check_images([job["image"]])  # minderarsparr (InsightFace <21 nekas) + NSFW pa indata
    from PIL import Image, ImageOps
    path = os.path.join(job["dir"], "edit.png")
    src = ImageOps.exif_transpose(Image.open(job["image"])).convert("RGB")
    if STUB: src.save(path); job["files"]["edit.png"] = path; return
    import torch
    src.thumbnail((1024, 1024)); w, h = (src.width // 16) * 16, (src.height // 16) * 16; src = src.resize((w, h))
    key = job["model"]; _, _, steps, g = EDIT_MODELS[key]
    p = use("edit:" + key, lambda: load_diffusers(key, edit=True)); gen = torch.Generator("cpu").manual_seed(job["seed"])
    if key == "qwenedit":
        img = p(image=[src], prompt=job["prompt"], negative_prompt=" ", true_cfg_scale=g, num_inference_steps=steps, generator=gen).images[0]
    else:
        img = p(image=src, prompt=job["prompt"], width=w, height=h, num_inference_steps=steps, guidance_scale=g, generator=gen).images[0]
    check_output(img); img.save(path); job["files"]["edit.png"] = path

def task_upscale(job):
    if not STUB: check_images([job["image"]])  # minderarsparr (InsightFace <21 nekas) + NSFW pa indata
    from PIL import Image, ImageOps
    path = os.path.join(job["dir"], "upscale.png")
    src = ImageOps.exif_transpose(Image.open(job["image"])).convert("RGB"); src.thumbnail((768, 768))
    if STUB: src.resize((src.width * 4, src.height * 4)).save(path); job["files"]["upscale.png"] = path; return
    import torch, numpy as np
    m = use("esrgan", load_esrgan); dev = next(m.model.parameters()).device
    x = torch.from_numpy(np.array(src)).permute(2, 0, 1)[None].float().div(255).to(dev)
    if dev.type == "cuda": x = x.half()
    with torch.inference_mode(): y = m(x)
    img = Image.fromarray((y[0].float().clamp(0, 1).permute(1, 2, 0).cpu().numpy() * 255).round().astype("uint8"))
    check_output(img); img.save(path); job["files"]["upscale.png"] = path

def run_demucs(src, outdir):
    """Returnerar (vocals.wav, no_vocals.wav)."""
    if STUB_AUDIO:
        a, b = os.path.join(outdir, "vocals.wav"), os.path.join(outdir, "no_vocals.wav")
        shutil.copy(src, a) if src.endswith(".wav") else ff("-i", src, a); shutil.copy(a, b); return a, b
    free_vram()
    import torch
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    r = subprocess.run([sys.executable, "-m", "demucs", "-n", "htdemucs", "--two-stems=vocals", "-d", dev, "-o", outdir, src], capture_output=True, text=True)
    if r.returncode: raise RuntimeError("Demucs: " + r.stderr[-400:])
    base = os.path.join(outdir, "htdemucs", os.path.splitext(os.path.basename(src))[0])
    return os.path.join(base, "vocals.wav"), os.path.join(base, "no_vocals.wav")

def task_stems(job):
    v, n = run_demucs(job["audio"], job["dir"])
    for name, src in (("sang.mp3", v), ("instrumental.mp3", n)):
        dst = os.path.join(job["dir"], name); ff("-i", src, "-b:a", "192k", dst); job["files"][name] = dst

def task_lyrics(job):
    src = job["audio"]
    if job.get("vocals"): src, _ = run_demucs(src, job["dir"])
    if STUB_AUDIO:
        segs = [{"start": 0.0, "end": 2.0, "text": "stubbtext rad ett"}, {"start": 2.0, "end": 4.0, "text": "stubbtext rad två"}]
    else:
        m = use("whisper", load_whisper) if not job.get("tiny") else __import__("whisper").load_model("tiny", device="cpu")
        r = m.transcribe(src, language=job["lang"] or None, word_timestamps=False, fp16=False if STUB or job.get("tiny") else True)
        segs = [{"start": round(s["start"], 2), "end": round(s["end"], 2), "text": s["text"].strip()} for s in r["segments"] if s["text"].strip()]
    srt = "\n".join(f"{i}\n{srt_time(s['start'])} --> {srt_time(s['end'])}\n{s['text']}\n" for i, s in enumerate(segs, 1))
    p = os.path.join(job["dir"], "lyrics.srt"); open(p, "w").write(srt); job["files"]["lyrics.srt"] = p
    job["data"] = {"text": "\n".join(s["text"] for s in segs), "segments": segs, "srt": srt}

def task_autocut(job):
    import librosa, numpy as np
    d, start, w, h = job["dir"], job["start"], *ASPECT[job["aspect"]]
    song_len = probe_dur(job["audio"])
    if start >= song_len: raise RuntimeError("Starten ligger efter låtens slut.")
    dur = min(job["seconds"], song_len - start)
    y, sr = librosa.load(job["audio"], sr=22050, offset=start, duration=dur)
    _, bf = librosa.beat.beat_track(y=y, sr=sr)
    beats = [float(t) for t in librosa.frames_to_time(bf, sr=sr)]
    cuts = beats[::max(1, job["every"])]
    cuts = [0.0] + [c for c in cuts if 0.3 < c < dur - 0.3] + [dur]
    if len(cuts) < 3: cuts = list(np.arange(0, dur, 2.0)) + [dur]
    clips = job["clips"]; lens = [max(0.5, probe_dur(c)) for c in clips]; pos = [0.0] * len(clips)
    segs = []
    for i in range(len(cuts) - 1):
        k = i % len(clips); seg_len = cuts[i + 1] - cuts[i]
        if pos[k] + seg_len > lens[k]: pos[k] = 0.0
        sp = os.path.join(d, f"s{i:04}.mp4")
        ff("-ss", f"{pos[k]:.3f}", "-stream_loop", "-1", "-i", clips[k], "-t", f"{seg_len:.3f}", "-an", "-vf", fit_filter(w, h),
           "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", sp)
        pos[k] += seg_len; segs.append(sp)
    lst = os.path.join(d, "list.txt"); open(lst, "w").write("".join(f"file '{s}'\n" for s in segs))
    silent = os.path.join(d, "silent.mp4"); ff("-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", silent)
    out = os.path.join(d, "autocut.mp4")
    # Laten laggs pa i ett enda sammanhangande stycke: inga hopp i ljudet
    ff("-i", silent, "-ss", f"{start:.3f}", "-t", f"{dur:.3f}", "-i", job["audio"], "-map", "0:v", "-map", "1:a",
       "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", out)
    job["files"]["autocut.mp4"] = out; job["data"] = {"cuts": len(segs), "beats": len(beats), "seconds": round(dur, 2)}

def ls_run(video25, wav16k, out, steps=20, tmp="/tmp/ls"):
    if STUB: shutil.copy(video25, out); return
    free_vram()
    if not os.path.exists(LS_PY): raise RuntimeError("LatentSync är inte installerat: kör lipsync-cellen i notebooken.")
    r = subprocess.run([LS_PY, "-m", "scripts.inference", "--unet_config_path", "configs/unet/stage2.yaml",
                        "--inference_ckpt_path", "checkpoints/latentsync_unet.pt", "--inference_steps", str(steps),
                        "--guidance_scale", "1.5", "--video_path", video25, "--audio_path", wav16k, "--video_out_path", out,
                        "--temp_dir", tmp], cwd=LS_DIR, capture_output=True, text=True)
    if r.returncode or not os.path.exists(out): raise RuntimeError("LatentSync: " + (r.stdout + r.stderr)[-500:])

def task_lipsync(job):
    d, s, e = job["dir"], job["start"], job["end"]
    v25, wav, orig = os.path.join(d, "in25.mp4"), os.path.join(d, "cond.wav"), os.path.join(d, "orig.wav")
    trim = (["-ss", f"{s:.3f}"] if s > 0 else []) + (["-t", f"{e - s:.3f}"] if e > s else [])
    ff(*trim, "-i", job["audio"], orig)
    ff("-stream_loop", "-1", "-i", job["video"], "-t", f"{probe_dur(orig):.3f}", "-r", "25", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", v25)
    cond = run_demucs(orig, d)[0] if job["vocals"] else orig
    ff("-i", cond, "-ar", "16000", "-ac", "1", wav)
    raw = os.path.join(d, "ls_raw.mp4")
    ls_run(v25, wav, raw, job["steps"], os.path.join(d, "tmp"))
    out = os.path.join(d, "lipsync.mp4")
    ff("-i", raw, "-i", orig, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", out)
    job["files"]["lipsync.mp4"] = out

# ---------------- Artistlista (bara i sessionen) + ansiktsbyte ----------------
roster, scans = {}, {}
_fa = {"a": None}
def face_age_ok(face):
    age = getattr(face, "age", None)
    return age is not None and age >= MIN_AGE
def detect(img):
    if STUB:
        class F: pass
        f = F(); f.bbox = (10, 10, 60, 60); f.age = 30; f.normed_embedding = __import__("numpy").ones(4) / 2; return [f]
    if _fa["a"] is None:  # liten detektor som ligger kvar, sa aldersspärren inte kastar ut bildmodellen
        from insightface.app import FaceAnalysis
        _fa["a"] = FaceAnalysis(name="buffalo_l", providers=["CUDAExecutionProvider", "CPUExecutionProvider"]); _fa["a"].prepare(ctx_id=0, det_size=(640, 640))
    fa = _fa["a"]; return sorted(fa.get(img), key=lambda f: -(f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))
def swap_frame(img, mapping_faces):
    """mapping_faces: lista av (malansikte-embedding, kallansikte). Byter varje hittat ansikte mot basta matchning."""
    import numpy as np
    faces = detect(img)
    for f in faces:
        if not face_age_ok(f): raise RuntimeError("Nekad: ett ansikte i klippet bedöms vara under 21 år.")
    if STUB: return img
    _, sw = use("faces", load_faces)
    for f in faces:
        best, src = -1.0, None
        for emb, s in mapping_faces:
            sim = float(np.dot(f.normed_embedding, emb))
            if sim > best: best, src = sim, s
        if src is not None and best >= 0.3: img = sw.get(img, f, src, paste_back=True)
    return img

def task_swap(job):
    import cv2
    scan = scans[job["scan"]]; pairs = [(scan["faces"][int(i)].normed_embedding, roster[a]["face"]) for i, a in job["mapping"].items()]
    src, d = scan["path"], job["dir"]
    if scan["kind"] == "image":
        img = swap_frame(cv2.imread(src), pairs)
        from PIL import Image
        if nsfw_frames([Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))]): raise RuntimeError("Nekad: bilden flaggades som NSFW.")
        p = os.path.join(d, "swap.png"); cv2.imwrite(p, img); job["files"]["swap.png"] = p; return
    cap = cv2.VideoCapture(src); fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    w, h = int(cap.get(3)), int(cap.get(4)); tmp = os.path.join(d, "noaudio.mp4")
    out = cv2.VideoWriter(tmp, cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h)); n = 0; check = []
    s0 = int(job["start"] * fps); maxn = int(job["length"] * fps) if job["length"] > 0 else 10**9
    if s0: cap.set(cv2.CAP_PROP_POS_FRAMES, s0)
    while n < maxn:
        ok, fr = cap.read()
        if not ok: break
        fr = swap_frame(fr, pairs); out.write(fr)
        if n % int(fps * 2) == 0: check.append(os.path.join(d, f"chk{n}.jpg")); cv2.imwrite(check[-1], fr)
        n += 1
    cap.release(); out.release()
    if nsfw_frames(check): raise RuntimeError("Nekad: klippet flaggades som NSFW.")
    res = os.path.join(d, "swap.mp4")
    if has_audio(src):  # originalljudet, sammanhangande fran samma startpunkt
        ff("-i", tmp, "-ss", f"{job['start']:.3f}", "-i", src, "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", res)
    else:
        ff("-i", tmp, "-c:v", "libx264", "-pix_fmt", "yuv420p", res)
    job["files"]["swap.mp4"] = res

# ---------------- API ----------------
app = FastAPI(title="KINO Colab-motor")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
def auth(a: Optional[str]):
    if not a or not secrets.compare_digest(a, f"Bearer {TOKEN}"): raise HTTPException(401, "Fel eller saknad token")
def seed_of(s): return s if s >= 0 else secrets.randbelow(2**31)
def asp(a): return a if a in ASPECT else "9:16"

@app.get("/health")
def health(authorization: Optional[str] = Header(None)):
    ok = bool(authorization) and secrets.compare_digest(authorization, f"Bearer {TOKEN}")
    gpu = "stub"
    if not STUB:
        try:
            import torch; gpu = torch.cuda.get_device_name(0) if torch.cuda.is_available() else "ingen"
        except Exception: gpu = "okänd"
    feats = ["video", "img2video", "image", "edit", "upscale", "stems", "lyrics", "autocut", "musicvideo"]
    if STUB or os.path.exists(LS_PY): feats.append("lipsync")
    if STUB or os.path.exists(INSWAPPER): feats.append("faceswap")
    return {"ok": True, "auth": ok, "gpu": gpu, "queue": q.qsize(), "loaded": _cur["name"], "maxSeconds": MAX_SECONDS,
            "sfwOnly": False, "nsfwEndpoints": ["/image"], "features": feats, "imageModels": [k for k in IMAGE_MODELS if model_available(k)], "editModels": list(EDIT_MODELS), "licenseNote": LICENSE_NOTE}

@app.post("/generate")
async def generate(prompt: str = Form(...), seconds: int = Form(4), aspect: str = Form("9:16"), steps: int = Form(30),
                   seed: int = Form(-1), motion: int = Form(100), image: Optional[UploadFile] = File(None), authorization: Optional[str] = Header(None)):
    auth(authorization); has_img = image is not None and bool(image.filename); check_text(prompt, has_img)
    jid, d = submit("video", task_video, prompt=prompt.strip()[:800], seconds=max(1, min(int(seconds), MAX_SECONDS)), aspect=asp(aspect),
                    steps=max(10, min(int(steps), 50)), seed=seed_of(seed), motion=max(20, min(int(motion), 255)))
    if has_img: jobs[jid]["image"] = await save_upload(image, d, "first")
    go(jid)
    return {"jobId": jid, "status": "queued", "note": "Bild till video (SVD, ca 2 s)." if has_img else None}

@app.get("/models")
def models_ep(authorization: Optional[str] = Header(None)):
    auth(authorization)
    return {"image": [{"key": k, "label": v[0], "id": v[1], "available": model_available(k), "needsHfToken": v[2]} for k, v in IMAGE_MODELS.items()],
            "edit": [{"key": k, "label": v[0], "id": v[1]} for k, v in EDIT_MODELS.items()],
            "nsfw": {"endpoints": ["/image"], "minAge": MIN_AGE,
                     "note": "Ingen av modellerna här är tränad för explicit innehåll; FLUX/Qwen/Z-Image/ERNIE ger oftast ofullständiga eller censurerade resultat. SDXL-Turbo och FLUX.1 schnell är minst filtrerade. Minderårsspärren gäller alltid."},
            "upscale": [{"key": "esrgan4x", "label": "Real-ESRGAN x4", "id": ESRGAN_REPO}]}

@app.post("/image")
async def image_ep(prompt: str = Form(...), aspect: str = Form("9:16"), seed: int = Form(-1), model: str = Form("sdxl"), nsfw: bool = Form(False),
                   image: Optional[UploadFile] = File(None), authorization: Optional[str] = Header(None)):
    auth(authorization); has_img = image is not None and bool(image.filename)
    if has_img: raise HTTPException(400, "Nekad: riktiga personers foton får aldrig användas i NSFW." if nsfw else "/image tar ingen bild; använd /edit.")
    check_text(prompt, False, nsfw)
    if model not in IMAGE_MODELS: raise HTTPException(400, "Okänd bildmodell.")
    if not model_available(model): raise HTTPException(400, "Modellen kräver HF_TOKEN (godkänn licensen på Hugging Face och lägg token i Colab-hemligheter).")
    jid, _ = submit("image", task_image, prompt=prompt.strip()[:500], aspect=asp(aspect), seed=seed_of(seed), model=model, nsfw=bool(nsfw))
    return go(jid)

async def _checked_input(image, d):
    if image is None or not image.filename: raise HTTPException(400, "Ladda upp en bild.")
    return await save_upload(image, d, "src")  # kontrolleras i jobbet (under GPU-laset)

@app.post("/edit")
async def edit_ep(prompt: str = Form(...), image: UploadFile = File(...), model: str = Form("qwenedit"), seed: int = Form(-1), authorization: Optional[str] = Header(None)):
    auth(authorization); check_text(prompt, True)
    if model not in EDIT_MODELS: raise HTTPException(400, "Okänd redigeringsmodell.")
    jid, d = submit("edit", task_edit, prompt=prompt.strip()[:500], model=model, seed=seed_of(seed))
    return go(jid, image=await _checked_input(image, d))

@app.post("/upscale")
async def upscale_ep(image: UploadFile = File(...), authorization: Optional[str] = Header(None)):
    auth(authorization); jid, d = submit("upscale", task_upscale)
    return go(jid, image=await _checked_input(image, d))

@app.post("/stems")
async def stems(audio: UploadFile = File(...), authorization: Optional[str] = Header(None)):
    auth(authorization); jid, d = submit("stems", task_stems)
    return go(jid, audio=await save_upload(audio, d, "song"))

@app.post("/lyrics")
async def lyrics(audio: UploadFile = File(...), language: str = Form("sv"), vocals: bool = Form(True), authorization: Optional[str] = Header(None)):
    auth(authorization); jid, d = submit("lyrics", task_lyrics, lang=(language or "")[:5], vocals=vocals, tiny=os.environ.get("KINO_WHISPER_TINY") == "1")
    return go(jid, audio=await save_upload(audio, d, "song"))

@app.post("/autocut")
async def autocut(audio: UploadFile = File(...), clips: List[UploadFile] = File(...), every: int = Form(4), start: float = Form(0),
                  seconds: float = Form(30), aspect: str = Form("9:16"), authorization: Optional[str] = Header(None)):
    auth(authorization)
    if not clips or len(clips) > 30: raise HTTPException(400, "Ladda upp 1–30 klipp.")
    jid, d = submit("autocut", task_autocut, every=max(1, min(int(every), 16)), start=max(0.0, float(start)), seconds=max(3.0, min(float(seconds), 240.0)), aspect=asp(aspect))
    return go(jid, audio=await save_upload(audio, d, "song"), clips=[await save_upload(c, d, f"clip{i:02}") for i, c in enumerate(clips)])

@app.post("/lipsync")
async def lipsync(video: UploadFile = File(...), audio: UploadFile = File(...), start: float = Form(0), end: float = Form(0),
                  vocals: bool = Form(True), steps: int = Form(20), consent: str = Form(""), description: str = Form(""),
                  authorization: Optional[str] = Header(None)):
    auth(authorization)
    if consent != "true": raise HTTPException(400, "Nekad: du måste intyga att personen är er egen artist eller AI-figur och har gett samtycke.")
    check_text(description, True)
    if end and end - start > 60: raise HTTPException(400, "Max 60 s per lipsync-körning på en T4.")
    jid, d = submit("lipsync", task_lipsync, start=max(0.0, float(start)), end=float(end or 0), vocals=vocals, steps=max(10, min(int(steps), 40)))
    return go(jid, video=await save_upload(video, d, "video"), audio=await save_upload(audio, d, "song"))

@app.post("/roster")
async def roster_add(name: str = Form(...), consent: str = Form(""), photos: List[UploadFile] = File(...), authorization: Optional[str] = Header(None)):
    auth(authorization)
    if consent != "true": raise HTTPException(400, "Kryssa i 'Personen har gett samtycke'.")
    import numpy as np, cv2
    best = None
    with _lock:
        for ph in photos[:8]:
            img = cv2.imdecode(np.frombuffer(await ph.read(), np.uint8), cv2.IMREAD_COLOR)
            if img is None: continue
            fs = detect(img)
            if not fs: continue
            if not face_age_ok(fs[0]): raise HTTPException(400, "Nekad: personen på fotot bedöms vara under 21 år.")
            if best is None: best = fs[0]
    if best is None: raise HTTPException(400, "Hittade inget ansikte på fotona.")
    aid = uuid.uuid4().hex[:8]; now = time.strftime("%Y-%m-%d %H:%M:%S")
    roster[aid] = {"id": aid, "name": name.strip()[:60], "face": best, "consent": True, "added": now}
    print(f"[roster] {now} artist tillagd: {roster[aid]['name']} (samtycke intygat)")
    return {"id": aid, "name": roster[aid]["name"], "added": now, "licenseNote": LICENSE_NOTE}

@app.get("/roster")
def roster_list(authorization: Optional[str] = Header(None)):
    auth(authorization); return [{"id": a["id"], "name": a["name"], "added": a["added"]} for a in roster.values()]

@app.delete("/roster/{aid}")
def roster_del(aid: str, authorization: Optional[str] = Header(None)):
    auth(authorization); roster.pop(aid, None); return {"ok": True}

@app.post("/faces")
async def faces(media: UploadFile = File(...), authorization: Optional[str] = Header(None)):
    """Hittar upp till 4 ansikten i en video/bild. Svarar med scanId + miniatyrer (base64 jpeg)."""
    auth(authorization)
    import cv2, numpy as np
    sid = uuid.uuid4().hex[:10]; d = os.path.join(WORK, "scan_" + sid); os.makedirs(d)
    p = await save_upload(media, d, "media"); kind = "image" if (media.content_type or "").startswith("image") else "video"
    found, thumbs = [], []
    with _lock:
        frames = [cv2.imread(p)] if kind == "image" else []
        if kind == "video":
            cap = cv2.VideoCapture(p); total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1
            for i in range(0, total, max(1, total // 20)):
                cap.set(cv2.CAP_PROP_POS_FRAMES, i); ok, fr = cap.read()
                if ok: frames.append(fr)
            cap.release()
        for fr in frames:
            if fr is None: continue
            for f in detect(fr):
                if not face_age_ok(f): raise HTTPException(400, "Nekad: ett ansikte i klippet bedöms vara under 21 år.")
                if any(float(np.dot(f.normed_embedding, g.normed_embedding)) > 0.4 for g in found) or len(found) >= 4: continue
                found.append(f); x1, y1, x2, y2 = [max(0, int(v)) for v in f.bbox]
                ok, buf = cv2.imencode(".jpg", fr[y1:y2, x1:x2]); thumbs.append(base64.b64encode(buf.tobytes()).decode() if ok else "")
    if not found: raise HTTPException(400, "Hittade inga ansikten.")
    scans[sid] = {"path": p, "kind": kind, "faces": found}
    return {"scanId": sid, "kind": kind, "faces": [{"index": i, "thumb": "data:image/jpeg;base64," + t} for i, t in enumerate(thumbs)]}

@app.post("/swap")
async def swap(scan_id: str = Form(...), mapping: str = Form(...), start: float = Form(0), length: float = Form(0),
               authorization: Optional[str] = Header(None)):
    """mapping: JSON {"0": "<artistId>", ...}. Kallansikten kommer ENBART fran artistlistan."""
    auth(authorization)
    if scan_id not in scans: raise HTTPException(404, "Skanna klippet först.")
    try: m = {str(int(k)): str(v) for k, v in json.loads(mapping).items() if v}
    except Exception: raise HTTPException(400, "Ogiltig mappning.")
    if not m: raise HTTPException(400, "Välj minst en artist.")
    for k, v in m.items():
        if v not in roster: raise HTTPException(400, "Källansiktet måste vara en artist i listan.")
        if int(k) >= len(scans[scan_id]["faces"]): raise HTTPException(400, "Ogiltigt ansikte.")
    jid, _ = submit("swap", task_swap, scan=scan_id, mapping=m, start=max(0.0, float(start)), length=max(0.0, float(length)))
    return {**go(jid), "licenseNote": LICENSE_NOTE}


# ---------------- Bilder + lat -> musikvideo (orkestrerat jobb) ----------------
CACHE = os.environ.get("KINO_CACHE", "/content/kino_cache" if os.path.isdir("/content") else os.path.join(tempfile.gettempdir(), "kino_cache"))
MOTIONS = [90, 127, 160, 110, 70, 140]
CROPS = [(0.5, 0.5), (0.35, 0.5), (0.65, 0.5), (0.5, 0.35), (0.5, 0.65)]
SVD_SECONDS = 14 / 7  # 14 bildrutor i 7 fps
ETA = {"shot": 150, "karaoke": 120, "lipsync": 240, "edit": 30}  # sekunder pa en T4, grovt

def progress(job, step, done=0, total=0):
    job["progress"] = {"step": step, "done": done, "total": total}

def find_chorus(path, length):
    """Gissar refrangen: det mest energirika fonstret (inte i forsta 10 %). Returnerar starttid i sekunder."""
    import librosa, numpy as np
    y, sr = librosa.load(path, sr=11025, mono=True)
    rms = librosa.feature.rms(y=y, hop_length=512)[0]; hop = 512 / sr
    win = max(1, int(length / hop)); total = len(rms) * hop
    if total <= length: return 0.0
    cs = np.concatenate([[0], np.cumsum(rms)]); best, bt = -1, 0.0
    for i in range(int(0.1 * len(rms)), len(rms) - win, max(1, int(0.5 / hop))):
        m = cs[i + win] - cs[i]
        if m > best: best, bt = m, i * hop
    return round(bt, 2)

def plan_shots(audio, start, dur):
    import librosa
    y, sr = librosa.load(audio, sr=22050, offset=start, duration=dur)
    tempo, bf = librosa.beat.beat_track(y=y, sr=sr)
    beats = [float(t) for t in librosa.frames_to_time(bf, sr=sr)]
    bpm = float(tempo[0] if hasattr(tempo, "__len__") else tempo) or 120.0
    per = max(1, round(2.5 / (60.0 / bpm)))  # ca 2,5 s per bild, alltid pa ett slag
    cuts = [0.0] + [b for b in beats[per::per] if 0.8 < b < dur - 0.8] + [dur]
    if len(cuts) < 3 and dur > 5: cuts = [x * dur / max(2, round(dur / 2.5)) for x in range(int(max(2, round(dur / 2.5))) + 1)]
    while len(cuts) - 1 > 24: cuts = cuts[::2] + ([dur] if cuts[::2][-1] != dur else [])  # max 24 klipp
    return cuts, bpm, len(beats)

def svd_shot(img_path, aspect, motion, crop, seed, out):
    if os.path.exists(out): return True  # cache: redan gjord
    sw, sh = (576, 1024) if aspect == "9:16" else (1024, 576) if aspect == "16:9" else (768, 768)
    if STUB:
        ff("-loop", "1", "-i", img_path, "-t", f"{SVD_SECONDS}", "-vf", f"scale={sw // 4}:{sh // 4}:force_original_aspect_ratio=increase,crop={sw // 4}:{sh // 4},fps=7", "-pix_fmt", "yuv420p", out + ".tmp.mp4")
    else:
        import torch
        from PIL import Image, ImageOps
        from diffusers.utils import export_to_video
        p = use("svd", load_svd)
        img = ImageOps.fit(Image.open(img_path).convert("RGB"), (sw, sh), centering=crop)
        frames = p(img, decode_chunk_size=2, num_frames=14, motion_bucket_id=motion, noise_aug_strength=0.02,
                   generator=torch.Generator("cpu").manual_seed(seed)).frames[0]
        export_to_video(frames, out + ".tmp.mp4", fps=7)
    os.replace(out + ".tmp.mp4", out); return False

def check_images(paths):
    import cv2
    with_faces = False
    for pth in paths:
        img = cv2.imread(pth)
        if img is None: raise RuntimeError("En bild gick inte att läsa.")
        try: fs = detect(img)
        except Exception as e: raise RuntimeError("Ålderskontrollen kunde inte köras (kör installationscellen): " + str(e)[:120])
        for f in fs:
            if not face_age_ok(f): raise RuntimeError("Nekad: en person på bilderna bedöms vara under 21 år.")
        with_faces = with_faces or bool(fs)
    if nsfw_frames(paths): raise RuntimeError("Nekad: en bild flaggades som NSFW.")
    return with_faces

def task_musicvideo(job):
    d, imgs, aspect = job["dir"], job["images"], job["aspect"]; w, h = ASPECT[aspect]
    progress(job, "Kontrollerar bilder"); check_images(imgs)
    song_len = probe_dur(job["audio"])
    dur = min(job["seconds"], song_len)
    start = find_chorus(job["audio"], dur) if job["section"] == "chorus" else min(job["start"], max(0.0, song_len - dur))
    dur = min(dur, song_len - start)
    progress(job, "Hittar takten"); cuts, bpm, nbeats = plan_shots(job["audio"], start, dur)
    n = len(cuts) - 1
    job["data"] = {"start": start, "seconds": round(dur, 2), "shots": n, "bpm": round(bpm), "beats": nbeats}
    # 1) Klipp med SVD, cachade per bild/rorelse/beskarning sa en omstart hoppar over fardiga klipp
    import hashlib
    os.makedirs(os.path.join(CACHE, "shots"), exist_ok=True); shots, cached = [], 0
    for i in range(n):
        progress(job, f"Klipp {i + 1}/{n}", i, n)
        k = i % len(imgs); motion = MOTIONS[(i // len(imgs) + k) % len(MOTIONS)]; crop = CROPS[(i // len(imgs)) % len(CROPS)]
        key = hashlib.sha1(open(imgs[k], "rb").read() + f"{aspect}{motion}{crop}{STUB}".encode()).hexdigest()[:16]
        out = os.path.join(CACHE, "shots", key + ".mp4")
        cached += svd_shot(imgs[k], aspect, motion, crop, int(key[:6], 16), out); shots.append(out)
    free_vram(); job["data"]["cachedShots"] = cached
    section = os.path.join(d, "section.wav"); ff("-ss", f"{start:.3f}", "-t", f"{dur:.3f}", "-i", job["audio"], "-ac", "2", "-ar", "44100", section)
    vocals = None
    # 2) Karaoke: Demucs -> Whisper -> SRT
    srt = None
    if job["karaoke"] or job["lipsync"]:
        progress(job, "Isolerar sång (Demucs)"); vocals = run_demucs(section, d)[0]
    if job["karaoke"]:
        progress(job, "Låttext (Whisper)")
        if STUB_AUDIO: segs = [{"start": 0.5, "end": min(dur, 3.0), "text": "Stubbtext i refrängen"}]
        else:
            m = use("whisper", load_whisper); r = m.transcribe(vocals, language=job["lang"] or None, fp16=not STUB)
            segs = [{"start": s_["start"], "end": s_["end"], "text": s_["text"].strip()} for s_ in r["segments"] if s_["text"].strip()]
            free_vram()
        srt = os.path.join(d, "lyrics.srt")
        open(srt, "w").write("\n".join(f"{i}\n{srt_time(x['start'])} --> {srt_time(x['end'])}\n{x['text']}\n" for i, x in enumerate(segs, 1)))
        job["files"]["lyrics.srt"] = srt
    # 3) Lipsync pa valda klipp (bara med samtycke, bara om LatentSync finns)
    segfiles = []
    for i in range(n):
        seg_len = cuts[i + 1] - cuts[i]; sp = os.path.join(d, f"seg{i:03}.mp4")
        speed = max(0.25, SVD_SECONDS / seg_len)  # dra ut/korta SVD-klippet till exakt klipplangd
        ff("-i", shots[i], "-vf", f"setpts=PTS/{speed:.4f},{fit_filter(w, h)},tpad=stop_mode=clone:stop_duration=1", "-t", f"{seg_len:.3f}", "-an",
           "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", sp)
        if (i % len(imgs)) in job["lipsync"] and vocals:
            progress(job, f"Lipsync klipp {i + 1}/{n}", i, n)
            v25, wav, lo = sp + ".25.mp4", sp + ".wav", sp + ".ls.mp4"
            ff("-i", sp, "-r", "25", "-c:v", "libx264", "-pix_fmt", "yuv420p", v25)
            ff("-ss", f"{cuts[i]:.3f}", "-t", f"{seg_len:.3f}", "-i", vocals, "-ar", "16000", "-ac", "1", wav)
            ls_run(v25, wav, lo, 20, sp + "_tmp")
            ff("-i", lo, "-vf", fit_filter(w, h), "-t", f"{seg_len:.3f}", "-an", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", sp)
        segfiles.append(sp)
    free_vram()
    # 4) Klipp ihop + mobilvideo-look + lat i ett enda stycke + kort uttoning
    progress(job, "Klipper ihop", n, n)
    lst = os.path.join(d, "list.txt"); open(lst, "w").write("".join(f"file '{x}'\n" for x in segfiles))
    silent = os.path.join(d, "silent.mp4"); ff("-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", silent)
    fade = min(1.5, dur / 4)
    look = (f"crop=iw-16:ih-16:8+5*sin(t*2.1):8+4*cos(t*1.7),scale={w}:{h},eq=saturation=0.88:contrast=1.03,"
            f"noise=alls=7:allf=t,vignette=PI/7")
    if srt: look += f",subtitles={srt}:force_style='FontName=DejaVu Sans,Fontsize=15,Bold=1,PrimaryColour=&H0000EBFF,OutlineColour=&H00000000,Outline=2,Shadow=0,Alignment=2,MarginV=60'"
    look += f",fade=t=out:st={dur - fade:.3f}:d={fade:.3f},format=yuv420p"
    out = os.path.join(d, "musikvideo.mp4")
    ff("-i", silent, "-i", section, "-filter_complex", f"[0:v]{look}[v];[1:a]afade=t=out:st={dur - fade:.3f}:d={fade:.3f}[a]",
       "-map", "[v]", "-map", "[a]", "-t", f"{dur:.3f}", "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out)
    job["files"] = {"musikvideo.mp4": out, **job["files"]}
    progress(job, "Klar", n, n)

@app.post("/musicvideo")
async def musicvideo(images: List[UploadFile] = File(...), audio: UploadFile = File(...), section: str = Form("start"), start: float = Form(0),
                     seconds: float = Form(30), aspect: str = Form("9:16"), karaoke: bool = Form(False), language: str = Form("sv"),
                     lipsync: str = Form(""), consent: str = Form(""), description: str = Form(""), authorization: Optional[str] = Header(None)):
    """lipsync: kommaseparerade bildindex (0, 1, ...) som ska fa lipsync. Kraver consent=true."""
    auth(authorization); check_text(description, True)
    if not images or len(images) > 20: raise HTTPException(400, "Ladda upp 1–20 bilder.")
    ls = sorted({int(x) for x in lipsync.split(",") if x.strip().isdigit()})
    if ls and consent != "true": raise HTTPException(400, "Nekad: lipsync kräver att du intygar samtycke.")
    if ls and not (STUB or os.path.exists(LS_PY)): raise HTTPException(400, "Lipsync-cellen är inte körd i Colab.")
    secs = max(5.0, min(float(seconds), 180.0))
    jid, d = submit("musicvideo", task_musicvideo, section="chorus" if section == "chorus" else "start", start=max(0.0, float(start)),
                    seconds=secs, aspect=asp(aspect), karaoke=karaoke, lang=(language or "")[:5], lipsync=ls)
    shots = int(min(24, max(2, secs / 2.5)))
    eta = shots * ETA["shot"] + (ETA["karaoke"] if karaoke else 0) + len(ls) * max(1, shots // max(1, len(images))) * ETA["lipsync"] + ETA["edit"]
    res = go(jid, images=[await save_upload(f, d, f"img{i:02}") for i, f in enumerate(images)], audio=await save_upload(audio, d, "song"))
    return {**res, "etaSeconds": eta, "shots": shots}

@app.get("/status/{jid}")
def status(jid: str, authorization: Optional[str] = Header(None)):
    auth(authorization); j = jobs.get(jid)
    if not j: raise HTTPException(404, "Okänt jobb")
    files = [{"name": n, "url": f"/result/{jid}?file={n}"} for n in j["files"]] if j["status"] == "done" else []
    return {"id": jid, "kind": j["kind"], "status": j["status"], "error": j.get("error"), "data": j["data"] if j["status"] == "done" else None,
            "files": files, "url": files[0]["url"] if files else None,
            "elapsed": round((j.get("finished") or time.time()) - j.get("started", time.time())), "queue": q.qsize(),
            "progress": j.get("progress"), "info": j["data"] if j["kind"] == "musicvideo" else None}

@app.get("/result/{jid}")
def result(jid: str, file: Optional[str] = Query(None), authorization: Optional[str] = Header(None)):
    auth(authorization); j = jobs.get(jid)
    if not j or j["status"] != "done": raise HTTPException(404, "Inte klart")
    name = file or next(iter(j["files"]), None)
    if name not in j["files"]: raise HTTPException(404, "Okänd fil")
    mt = {".mp4": "video/mp4", ".png": "image/png", ".mp3": "audio/mpeg", ".srt": "text/plain"}.get(os.path.splitext(name)[1], "application/octet-stream")
    return FileResponse(j["files"][name], media_type=mt, filename=f"kino-{jid}-{name}")
