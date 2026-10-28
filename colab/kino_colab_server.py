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
PLATFORM = os.environ.get("KINO_PLATFORM", "colab")  # "colab" eller "kaggle": samma kod for bada
BASE = "/tmp/kino" if PLATFORM == "kaggle" else "/content"
LS_DIR, LS_PY = f"{BASE}/LatentSync", f"{BASE}/ls_env/bin/python"
INSWAPPER = os.environ.get("KINO_INSWAPPER", f"{BASE}/models/inswapper_128.onnx")
WORK = tempfile.mkdtemp(prefix="kino_")
FPS, MAX_SECONDS, MIN_AGE = 16, 5, 21
SVC_NOTE = "Röstbyte använder Seed-VC (GPL-3.0). Bara röster ur din samtyckta röstlista."
LICENSE_NOTE = "Ansiktsbyte använder InsightFace/inswapper: endast icke-kommersiellt bruk."

# ---------------- Innehallsregler ----------------
MINOR_RE = re.compile(r"(^|[^a-zåäö0-9])(child|children|kids?|minors?|underage|under[\s-]*age|teens?|teenage[rs]?|preteen|tween|adolescent|juvenile|loli(ta|con)?|shota(con)?|young[\s-]*looking|barely[\s-]*legal|jailbait|school[\s-]*(girl|boy|uniform)|kindergarten|toddler|baby|infant|little[\s-]*(girl|boy)|young[\s-]*(girl|boy)|barn(et|en|s)?|skolbarn(et|en)?|barnslig[a-zåäö]*|minderåriga?|omyndig|tonåring(ar)?|tonårs|flick(a|an|or)|pojk(e|en|ar)|skolflicka|skolpojke|dagis|bebis|småbarn)(?=$|[^a-zåäö0-9])", re.I)
AGE_RE = re.compile(r"\b(\d{1,2})\s*(?:-|\s)?\s*(?:yo|y/o|yrs?|years?(?:[\s-]*old)?|år(?:ig|ing|s)?|åring)\b", re.I)
NSFW_RE = re.compile(r"(^|[^a-zåäö0-9])(nsfw|nude|naked|nudity|porn\w*|sex\w*|explicit|erotic\w*|topless|lingerie|genital\w*|nipples?|naken|nakna|porr\w*|erotisk\w*|bröstvårtor?)(?=$|[^a-zåäö0-9])", re.I)
STYLE = "natural handheld phone video, real-life lighting, slight camera shake, authentic, unpolished, true-to-life colors"
IMG_STYLE = "candid phone photo, natural light, real-life, unpolished, true-to-life colors"
NEGATIVE = "AI look, overly smooth skin, plastic, CGI, 3d render, oversaturated, cinematic color grading, glossy, airbrushed, text, watermark, blurry, deformed, extra fingers, static frame"

BARN_EN_RE = re.compile(r"\b(?:(?:the|a|an|red|old|wooden|big|abandoned|rustic|farm|in\s+a|in\s+the)\s+barns?|barns?\s+(?:doors?|owls?|roofs?|walls?|swallows?|dance|wedding|cats?|interior))\b", re.I)
# Termer som aldrig far forekomma tillsammans med barn (SFW) – brett med flit
SEXUAL_RE = re.compile(r"(^|[^a-zåäö0-9])(nsfw|nude|nudes|naked|nudity|porn\w*|sex\w*|sensual\w*|seduc\w*|erotic\w*|explicit|lewd|fetish\w*|provocative|suggestive|intimate|intimacy|"
    r"lingerie|underwear|panties|bra|bras|thong|bikini\w*|swimsuit|topless|shirtless|cleavage|undress\w*|strip\w*|kiss\w*|making[\s-]*out|bed|beds|bedroom|bath\w*|shower\w*|"
    r"genital\w*|nipples?|breasts?|butt|ass|crotch|groin|spread|pose[sd]?\s+seductively|"
    r"naken|nakna|nakenhet|sexig\w*|sensuell\w*|erotisk\w*|porr\w*|underkläder|trosor|behå|bh|bikin\w*|baddräkt|kyss\w*|hångla\w*|säng(en)?|sovrum(met)?|bad(et|ar)?|dusch\w*|"
    r"klä[\s-]*av|avklädd\w*|strippa\w*|intim\w*|utmanande|bröst(en)?|rumpa|skrev)(?=$|[^a-zåäö0-9])", re.I)
HARD_MINOR_RE = re.compile(r"(^|[^a-zåäö0-9])(schoolgirls?|skolflick(a|or)|loli(ta|con)?|shota(con)?|jailbait|barely[\s-]*legal|pedo\w*|pedofil\w*|cp|young[\s-]*looking|childlike|barnslig[a-zåäö]*|underage|under[\s-]*age|minderåriga?|omyndig)(?=$|[^a-zåäö0-9])", re.I)
def has_minor_terms(s):
    return bool(MINOR_RE.search(s) or any(int(m.group(1)) < 18 for m in AGE_RE.finditer(s)))
def check_text(text: str, has_person_media: bool = False, nsfw: bool = False):
    """NSFW: alla barntermer nekas (skrivna aldrar under 18 nekas). SFW: barn i harmlosa scener ar ok (t.ex. barn upp pa scen),
    men barntermer tillsammans med sexuella/nakna/antydande termer nekas alltid, liksom harda termer (loli, jailbait ...)."""
    s = (text or "").lower()
    if not nsfw and not NSFW_RE.search(s):  # SFW: engelska "barn" (lada) i tydligt byggnadssammanhang ar inte "barn" (children)
        s = BARN_EN_RE.sub(" ", s)
    if HARD_MINOR_RE.search(s) or (has_minor_terms(s) and (nsfw or SEXUAL_RE.search(s))):
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
    return _Interruptible(_cur["obj"])

# ---------------- Avbryt ----------------
class Cancelled(Exception): pass
_now = {"job": None}  # jobbet som kor just nu (en GPU-arbetare)
def check_cancel(job=None):
    j = job or _now["job"]
    if j is not None and j.get("cancel"): raise Cancelled("Avbrutet")
def run_proc(cmd, cwd=None, capture_output=True, text=True, **kw):
    """subprocess.run som gar att avbryta: Popen-handtaget sparas pa jobbet och dodas vid /cancel."""
    check_cancel(); j = _now["job"]
    pr = subprocess.Popen(cmd, cwd=cwd, stdout=subprocess.PIPE if capture_output else None, stderr=subprocess.PIPE if capture_output else None,
                          text=text, start_new_session=True, **kw)
    if j is not None: j.setdefault("procs", []).append(pr)
    try:
        while True:
            try: out, err = pr.communicate(timeout=0.5); break
            except subprocess.TimeoutExpired:
                if j is not None and j.get("cancel"): _kill(pr); pr.communicate(); raise Cancelled("Avbrutet")
    finally:
        if j is not None and pr in j.get("procs", []): j["procs"].remove(pr)
    check_cancel()
    return subprocess.CompletedProcess(cmd, pr.returncode, out, err)
def _kill(pr):
    import signal
    try: os.killpg(pr.pid, signal.SIGKILL)  # hela processgruppen (LatentSync/Seed-VC startar barnprocesser)
    except Exception:
        try: pr.kill()
        except Exception: pass
class _Interruptible:
    """Wrappar en laddad modell: diffusers-pipelines far callback_on_step_end som avbryter mellan steg."""
    def __init__(self, obj): object.__setattr__(self, "_o", obj)
    def __getattr__(self, k): return getattr(self._o, k)
    def __setattr__(self, k, v): setattr(self._o, k, v)
    def __iter__(self): return iter(self._o)
    def __getitem__(self, i): return self._o[i]
    def __call__(self, *a, **kw):
        check_cancel(); o = self._o
        try:
            import inspect; ok = "callback_on_step_end" in inspect.signature(o.__call__).parameters
        except Exception: ok = False
        if ok and "callback_on_step_end" not in kw:
            def cb(pipe, i, t, ckw):
                if _now["job"] is not None and _now["job"].get("cancel"):
                    try: pipe._interrupt = True
                    except Exception: pass
                    raise Cancelled("Avbrutet")
                return ckw
            kw["callback_on_step_end"] = cb
        r = o(*a, **kw); check_cancel(); return r

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
def nsfw_frames(paths_or_imgs, thr=0.6):
    """Billig NSFW-koll (liten ViT-klassare pa CPU). Returnerar True om nagon bild ar over troskeln."""
    if STUB: return False
    from transformers import pipeline
    from PIL import Image
    if _nsfw["p"] is None: _nsfw["p"] = pipeline("image-classification", model=NSFW_ID, device=-1)
    for x in paths_or_imgs:
        img = Image.open(x).convert("RGB") if isinstance(x, str) else x
        r = {d["label"]: d["score"] for d in _nsfw["p"](img)}
        if r.get("nsfw", 0) > thr: return True
    return False

# ---------------- Hjalp ----------------
def ff(*args):
    r = run_proc(["ffmpeg", "-y", "-loglevel", "error", *map(str, args)], capture_output=True, text=True)
    if r.returncode: raise RuntimeError("ffmpeg: " + r.stderr[-400:])
def probe_dur(p):
    r = run_proc(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p], capture_output=True, text=True)
    return float(r.stdout.strip() or 0)
def has_audio(p):
    r = run_proc(["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", p], capture_output=True, text=True)
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
        job = q.get()
        if job.get("cancel"): job["status"] = "cancelled"; job["finished"] = job["started"] = time.time(); continue
        job["status"] = "running"; job["started"] = time.time()
        try:
            with _lock:
                _now["job"] = job
                try: job["fn"](job); check_cancel(job)
                finally: _now["job"] = None
            job["status"] = "done"
        except Exception as e:
            if job.get("cancel") or isinstance(e, Cancelled): job["status"] = "cancelled"; job["error"] = "Avbrutet"
            else: job["status"] = "error"; job["error"] = str(e)[:400]
        finally:
            job["finished"] = time.time()
            if job["kind"] in ("lipsync", "voiceswap", "voicetrain") or job["status"] == "cancelled": free_vram()
            if job["status"] == "cancelled": _empty_cache()
def _empty_cache():
    gc.collect()
    if STUB: return
    try:
        import torch
        if torch.cuda.is_available(): torch.cuda.empty_cache()
    except Exception: pass
def cancel_job(j):
    if j["status"] in ("done", "error", "cancelled"): return False
    j["cancel"] = True
    if j["status"] == "queued": j["status"] = "cancelled"; j["error"] = "Avbrutet"; j["finished"] = time.time()
    for pr in list(j.get("procs", [])): _kill(pr)
    return True
threading.Thread(target=worker, daemon=True).start()

# ---------------- Uppgifter ----------------
def task_video(job):
    path = os.path.join(job["dir"], "video.mp4"); w, h = ASPECT[job["aspect"]]
    frames = ((min(job["seconds"], MAX_SECONDS) * FPS) // 4) * 4 + 1
    if STUB:
        import numpy as np, imageio
        imageio.mimsave(path, [np.full((h // 4, w // 4, 3), (i * 7) % 255, dtype=np.uint8) for i in range(frames)], fps=FPS, macro_block_size=1)
    elif job.get("image"):  # SVD bild-till-video: den uppladdade forsta bildrutan anvands
        check_images([job["image"]], min_age=0 if sha_file(job["image"]) in GEN_HASH else CHILD_AGE)  # riktiga barnfoton animeras aldrig
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
    check_video_sfw(path)  # /generate ar alltid SFW
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

GENERATED = {}  # jobb-id -> sokvag, bara bilder som servern sjalv skapat i denna session (/image, /edit)
GEN_HASH = set()
def sha_file(p):
    import hashlib
    with open(p, "rb") as f: return hashlib.sha256(f.read()).hexdigest()
def register_generated(job, path):
    GENERATED[job["id"]] = path; GEN_HASH.add(sha_file(path))

CHILD_AGE, CHILD_NSFW_THR = 18, 0.15  # SFW: finns ett ansikte under 18 racker minsta NSFW-antydan for att neka
def check_output(img, nsfw=False):
    """NSFW-lage: ansikte under 21 nekas, ingen NSFW-klassare. SFW: NSFW-klassaren alltid pa; barn i bild ar ok,
    men om nagot ansikte bedoms under 18 nekas bilden redan vid svag NSFW-signal. Kan kontrollen inte koras nekas bilden."""
    if STUB: return
    import cv2, numpy as np
    try: faces = detect(cv2.cvtColor(np.array(img.convert("RGB")), cv2.COLOR_RGB2BGR))
    except Exception as e: raise RuntimeError("Ålderskontrollen kunde inte köras, bilden avvisas: " + str(e)[:120])
    if nsfw:
        for f in faces:
            if not face_age_ok(f): raise RuntimeError("Nekad: en person i resultatet bedöms vara under 21 år.")
        return
    child = any(not face_age_ok(f, CHILD_AGE) for f in faces)
    if nsfw_frames([img], CHILD_NSFW_THR if child else 0.6):
        raise RuntimeError("Nekad: bilden med ett barn flaggades som olämplig." if child else "Nekad: bilden flaggades som NSFW.")

def check_video_sfw(path):
    """SFW-video: kontrollerar ett par bildrutor med samma regler som check_output."""
    if STUB: return
    from PIL import Image
    d = path + "_chk"; os.makedirs(d, exist_ok=True)
    ff("-i", path, "-vf", "fps=1", "-frames:v", "6", os.path.join(d, "f%02d.jpg"))
    for f in sorted(os.listdir(d)): check_output(Image.open(os.path.join(d, f)).convert("RGB"))
    shutil.rmtree(d, ignore_errors=True)

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
    register_generated(job, path); job["files"]["image.png"] = path; job["data"] = {"model": job["model"], "modelId": IMAGE_MODELS[job["model"]][1], "nsfw": job.get("nsfw", False)}

def task_edit(job):
    nsfw = job.get("nsfw", False)
    if not STUB:
        if nsfw: check_images([job["image"]], nsfw_check=False)  # NSFW: ansikte under 21 nekas
        elif job.get("generated"): check_images([job["image"]], min_age=0)  # KINO-skapad SFW-bild: barn i scen ok, NSFW-klassare pa
        else: check_images([job["image"]], min_age=CHILD_AGE)  # uppladdat foto: riktiga barns foton redigeras aldrig
    from PIL import Image, ImageOps
    path = os.path.join(job["dir"], "edit.png")
    src = ImageOps.exif_transpose(Image.open(job["image"])).convert("RGB")
    if STUB: src.save(path); register_generated(job, path); job["files"]["edit.png"] = path; return
    import torch
    src.thumbnail((1024, 1024)); w, h = (src.width // 16) * 16, (src.height // 16) * 16; src = src.resize((w, h))
    key = job["model"]; _, _, steps, g = EDIT_MODELS[key]
    if nsfw: job["prompt"] += ", all people are adults"
    p = use("edit:" + key, lambda: load_diffusers(key, edit=True)); gen = torch.Generator("cpu").manual_seed(job["seed"])
    if key == "qwenedit":
        img = p(image=[src], prompt=job["prompt"], negative_prompt="child, teen, young-looking, childlike" if nsfw else " ", true_cfg_scale=g, num_inference_steps=steps, generator=gen).images[0]
    else:
        img = p(image=src, prompt=job["prompt"], width=w, height=h, num_inference_steps=steps, guidance_scale=g, generator=gen).images[0]
    check_output(img, nsfw); img.save(path); register_generated(job, path); job["files"]["edit.png"] = path

def task_upscale(job):
    if not STUB: check_images([job["image"]], min_age=0 if sha_file(job["image"]) in GEN_HASH else CHILD_AGE)  # uppladdade barnfoton nekas
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
    r = run_proc([sys.executable, "-m", "demucs", "-n", "htdemucs", "--two-stems=vocals", "-d", dev, "-o", outdir, src], capture_output=True, text=True)
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
        check_cancel()
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
    r = run_proc([LS_PY, "-m", "scripts.inference", "--unet_config_path", "configs/unet/stage2.yaml",
                        "--inference_ckpt_path", "checkpoints/latentsync_unet.pt", "--inference_steps", str(steps),
                        "--guidance_scale", "1.5", "--video_path", video25, "--audio_path", wav16k, "--video_out_path", out,
                        "--temp_dir", tmp], cwd=LS_DIR, capture_output=True, text=True)
    if r.returncode or not os.path.exists(out): raise RuntimeError("LatentSync: " + (r.stdout + r.stderr)[-500:])

def check_video_faces(path, min_age=MIN_AGE):
    """Lipsync/ansiktsbyte: varje ansikte i ett par bildrutor maste bedomas minst min_age (21). Kan det inte kontrolleras nekas det."""
    if STUB: return
    d = path + "_faces"; os.makedirs(d, exist_ok=True)
    ff("-i", path, "-vf", "fps=1", "-frames:v", "8", os.path.join(d, "f%02d.jpg"))
    check_images([os.path.join(d, f) for f in sorted(os.listdir(d))], nsfw_check=True, min_age=min_age)
    shutil.rmtree(d, ignore_errors=True)

def task_lipsync(job):
    check_video_faces(job["video"])  # ingen lipsync pa barn: ansikten under 21 nekas
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
def face_age_ok(face, min_age=MIN_AGE):
    age = getattr(face, "age", None)
    return age is not None and age >= min_age
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
    check_cancel(); faces = detect(img)
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
# ---------------- Rostbyte (Seed-VC, zero-shot + valfri finjustering) med samtyckt rostlista ----------------
# Seed-VC (Plachtaa/seed-vc, GPL-3.0) kors i en egen Python 3.10-miljo (egna torch/transformers-pins), som LatentSync.
SVC_DIR, SVC_PY = f"{BASE}/seed-vc", f"{BASE}/svc_env/bin/python"
SVC_CFG = "configs/presets/config_dit_mel_seed_uvit_whisper_base_f0_44k.yml"  # sangmodellen (44,1 kHz, f0)
VOICE_MIN, VOICE_MAX, REF_SECONDS = 60, 600, 25
voices = {}  # id -> {id, name, consent, added, dir, ref, ckpt, config, status}
BLOCKED_HOSTS = ("spotify.", "music.apple.", "tidal.", "deezer.", "youtube.", "youtu.be", "soundcloud.")
SUNO_RE = re.compile(r"^https?://(?:www\.|app\.)?suno\.(?:com|ai)/(?:song|s|embed)/([A-Za-z0-9-]+)")
UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")

def to_wav(src, dst, sr=44100, ch=1):
    ff("-i", src, "-vn", "-ac", ch, "-ar", sr, dst); return dst

def task_voicetrain(job):
    try: _voicetrain(job)
    except Exception:
        if job["voice"] in voices: voices[job["voice"]]["status"] = "error"
        raise
def _voicetrain(job):
    v = voices[job["voice"]]; d = v["dir"]
    progress(job, "Förbereder träningsljud", 0, 3)
    parts = [to_wav(p, os.path.join(d, f"part{i:02}.wav")) for i, p in enumerate(job["audio"])]
    lst = os.path.join(d, "parts.txt")
    with open(lst, "w") as f: f.writelines(f"file '{p}'\n" for p in parts)
    allw = os.path.join(d, "all.wav"); ff("-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", allw)
    # ta bort tystnad sa referensen bara innehaller rost
    clean = os.path.join(d, "clean.wav")
    ff("-i", allw, "-af", "silenceremove=stop_periods=-1:stop_duration=0.4:stop_threshold=-40dB,loudnorm=I=-18:TP=-2", "-ar", 44100, clean)
    dur = probe_dur(clean)
    if dur < VOICE_MIN * 0.8: raise RuntimeError(f"För lite röst efter att tystnad tagits bort ({dur:.0f} s). Spela in minst 1 minut tal/sång.")
    ref = os.path.join(d, "ref.wav"); ff("-i", clean, "-t", REF_SECONDS, ref)
    v.update(ref=ref, seconds=round(dur))
    if job.get("finetune") and not STUB:
        progress(job, "Finjusterar Seed-VC på rösten (ca 10–20 min)", 1, 3)
        ds = os.path.join(d, "dataset"); os.makedirs(ds, exist_ok=True)
        ff("-i", clean, "-f", "segment", "-segment_time", 10, "-c", "copy", os.path.join(ds, "seg%03d.wav"))
        import yaml
        cfg = yaml.safe_load(open(os.path.join(SVC_DIR, SVC_CFG))); cfg["log_dir"] = os.path.join(d, "runs")
        cfgp = os.path.join(d, "ft_config.yml"); yaml.safe_dump(cfg, open(cfgp, "w"))
        free_vram()
        r = run_proc([SVC_PY, "train.py", "--config", cfgp, "--dataset-dir", ds, "--run-name", "ft", "--batch-size", "2",
                            "--max-steps", str(job.get("steps", 300)), "--max-epochs", "1000", "--save-every", "100000", "--num-workers", "0"],
                           cwd=SVC_DIR, capture_output=True, text=True)
        ck = os.path.join(d, "runs", "ft", "ft_model.pth")
        if r.returncode or not os.path.exists(ck): raise RuntimeError("Seed-VC-träning: " + (r.stderr or r.stdout)[-400:])
        v.update(ckpt=ck, config=os.path.join(d, "runs", "ft", os.path.basename(cfgp)))
    v["status"] = "ready"; progress(job, "Klar", 3, 3)
    job["data"] = {"voiceId": v["id"], "seconds": v["seconds"], "finetuned": bool(v.get("ckpt"))}
    print(f"[voices] {time.strftime('%Y-%m-%d %H:%M:%S')} röst klar: {v['name']} ({v['seconds']} s, samtycke intygat)")

def resolve_url(url):
    """Direkt ljud/video-fil eller en Suno-delningslank -> nedladdningsbar URL. Inga streamingtjanster."""
    u = (url or "").strip()
    if not re.match(r"^https?://", u, re.I): raise HTTPException(400, "Länken måste börja med http(s)://")
    host = re.sub(r"^https?://([^/]+).*", r"\1", u).lower()
    if any(b in host for b in BLOCKED_HOSTS): raise HTTPException(400, "Nekad: strömningstjänster (Spotify m.fl.) stöds inte. Använd en egen fil eller en Suno-låt du äger.")
    m = SUNO_RE.match(u)
    if m:
        sid = m.group(1)
        if not UUID_RE.fullmatch(sid):  # kort delningslank: folj omdirigeringen till /song/<uuid>
            import urllib.request
            req = urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=20) as r: final = r.geturl(); body = r.read(400000).decode("utf-8", "ignore")
            mm = UUID_RE.search(final) or UUID_RE.search(body)
            if not mm: raise HTTPException(400, "Kunde inte hitta låten bakom Suno-länken. Är den publik?")
            sid = mm.group(0)
        return f"https://cdn1.suno.ai/{sid}.mp3"
    return u

def download_media(url, d, limit=300 * 1024 * 1024):
    import urllib.request
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 KINO"})
    with urllib.request.urlopen(req, timeout=60) as r:
        ct = (r.headers.get("Content-Type") or "").lower()
        if not (ct.startswith(("audio/", "video/", "application/octet-stream")) or re.search(r"\.(mp3|wav|m4a|aac|flac|ogg|mp4|mov|webm|mkv)(\?|$)", url, re.I)):
            raise RuntimeError(f"Länken är ingen ljud/video-fil ({ct or 'okänd typ'}).")
        ext = os.path.splitext(url.split("?")[0])[1][:6] or (".mp4" if ct.startswith("video/") else ".mp3")
        p = os.path.join(d, "input" + ext); n = 0
        with open(p, "wb") as f:
            while True:
                b = r.read(1 << 20)
                if not b: break
                n += len(b)
                if n > limit: raise RuntimeError("Filen är större än 300 MB.")
                f.write(b)
    return p

def has_video(p):
    r = run_proc(["ffprobe", "-v", "error", "-select_streams", "v", "-show_entries", "stream=codec_name", "-of", "csv=p=0", p], capture_output=True, text=True)
    return bool(r.stdout.strip()) and not r.stdout.strip().startswith(("mjpeg", "png"))  # omslagsbild i mp3 raknas inte

def svc_convert(src, voice, out_dir, pitch=0, steps=30):
    if STUB:
        dst = os.path.join(out_dir, "converted.wav"); shutil.copy(src, dst); return dst
    free_vram()
    cmd = [SVC_PY, "inference.py", "--source", src, "--target", voice["ref"], "--output", out_dir, "--diffusion-steps", str(steps),
           "--f0-condition", "True", "--auto-f0-adjust", "False", "--semi-tone-shift", str(int(pitch)), "--fp16", "True", "--inference-cfg-rate", "0.7"]
    if voice.get("ckpt"): cmd += ["--checkpoint", voice["ckpt"], "--config", voice["config"]]
    r = run_proc(cmd, cwd=SVC_DIR, capture_output=True, text=True)
    outs = sorted((os.path.join(out_dir, f) for f in os.listdir(out_dir) if f.endswith(".wav")), key=os.path.getmtime)
    if r.returncode or not outs: raise RuntimeError("Seed-VC: " + (r.stderr or r.stdout)[-400:])
    return outs[-1]

def task_voiceswap(job):
    d = job["dir"]; v = voices.get(job["voice"])
    if not v or v.get("status") != "ready" or not v.get("consent"): raise RuntimeError("Rösten finns inte (eller är inte klar) i den samtyckta röstlistan.")
    src = job.get("media")
    if job.get("url"):
        progress(job, "Hämtar länken", 0, 5); src = download_media(job["url"], d)
    is_video = has_video(src)
    if probe_dur(src) > 600: raise RuntimeError("Max 10 minuter per körning.")
    progress(job, "Extraherar ljud", 1, 5)
    song = to_wav(src, os.path.join(d, "song.wav"), 44100, 2)
    if job.get("separate", True):
        progress(job, "Delar sång / instrumental (Demucs)", 2, 5)
        voc, inst = run_demucs(song, d)
    else: voc, inst = song, None
    progress(job, f"Byter röst till {v['name']} (Seed-VC)", 3, 5)
    vdir = os.path.join(d, "vc"); os.makedirs(vdir, exist_ok=True)
    conv = svc_convert(to_wav(voc, os.path.join(d, "vocals44.wav")), v, vdir, job.get("pitch", 0), job.get("steps", 30))
    progress(job, "Mixar ihop", 4, 5)
    wav = os.path.join(d, "ny_rost.wav")
    if inst:
        ff("-i", conv, "-i", inst, "-filter_complex", f"[0:a]volume={job.get('vocal_gain', 1.0)}[v];[1:a][v]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.95[m]", "-map", "[m]", "-ar", 44100, "-ac", 2, wav)
    else: ff("-i", conv, "-ar", 44100, "-ac", 2, wav)
    mp3 = os.path.join(d, "ny_rost.mp3"); ff("-i", wav, "-b:a", "256k", mp3)
    job["files"]["ny_rost.mp3"] = mp3; job["files"]["ny_rost.wav"] = wav
    vo = os.path.join(d, "sang_ny_rost.wav"); shutil.copy(conv, vo); job["files"]["sang_ny_rost.wav"] = vo
    if is_video and job.get("mux", True):
        mp4 = os.path.join(d, "video_ny_rost.mp4")
        ff("-i", src, "-i", wav, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", mp4)
        job["files"]["video_ny_rost.mp4"] = mp4
    progress(job, "Klar", 5, 5)
    job["data"] = {"voice": v["name"], "video": is_video}
    print(f"[voices] {time.strftime('%Y-%m-%d %H:%M:%S')} röstbyte till {v['name']} (samtyckt röst)")

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
    feats = ["cancel", "video", "img2video", "image", "edit", "upscale", "stems", "lyrics", "autocut", "musicvideo"]
    if STUB or os.path.exists(LS_PY): feats.append("lipsync")
    if STUB or os.path.exists(INSWAPPER): feats.append("faceswap")
    if STUB or os.path.exists(SVC_PY): feats.append("voiceswap")
    return {"ok": True, "auth": ok, "platform": PLATFORM, "gpu": gpu, "queue": q.qsize(), "loaded": _cur["name"], "maxSeconds": MAX_SECONDS,
            "sfwOnly": False, "nsfwEndpoints": ["/image", "/edit"], "features": feats, "imageModels": [k for k in IMAGE_MODELS if model_available(k)], "editModels": list(EDIT_MODELS), "licenseNote": LICENSE_NOTE, "voiceNote": SVC_NOTE}

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
            "nsfw": {"endpoints": ["/image", "/edit (bara bilder skapade i denna session, via source_id)"], "minWrittenAge": 18, "minAge": MIN_AGE,
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
async def edit_ep(prompt: str = Form(...), image: Optional[UploadFile] = File(None), source_id: str = Form(""), model: str = Form("qwenedit"),
                  seed: int = Form(-1), nsfw: bool = Form(False), authorization: Optional[str] = Header(None)):
    auth(authorization); check_text(prompt, not nsfw, nsfw)
    if model not in EDIT_MODELS: raise HTTPException(400, "Okänd redigeringsmodell.")
    src = GENERATED.get(source_id.strip()) if source_id else None
    if source_id and not src: raise HTTPException(400, "Okänd bild (skapad i en tidigare Colab-session?).")
    has_img = image is not None and bool(image.filename)
    if not src and not has_img: raise HTTPException(400, "Ladda upp en bild eller välj en bild KINO skapat.")
    jid, d = submit("edit", task_edit, prompt=prompt.strip()[:500], model=model, seed=seed_of(seed), nsfw=bool(nsfw))
    if src:
        pth = os.path.join(d, "src.png"); shutil.copy(src, pth); jobs[jid]["generated"] = True
    else:
        pth = await save_upload(image, d, "src"); jobs[jid]["generated"] = sha_file(pth) in GEN_HASH
        if nsfw and sha_file(pth) not in GEN_HASH:
            shutil.rmtree(d, ignore_errors=True); jobs.pop(jid, None)
            raise HTTPException(400, "Uppladdade foton kan inte redigeras i NSFW – välj en bild KINO skapat.")
    return go(jid, image=pth)

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
CACHE = os.environ.get("KINO_CACHE", f"{BASE}/kino_cache" if os.path.isdir(BASE) else os.path.join(tempfile.gettempdir(), "kino_cache"))
MOTIONS = [90, 127, 160, 110, 70, 140]
CROPS = [(0.5, 0.5), (0.35, 0.5), (0.65, 0.5), (0.5, 0.35), (0.5, 0.65)]
SVD_SECONDS = 14 / 7  # 14 bildrutor i 7 fps
ETA = {"shot": 150, "karaoke": 120, "lipsync": 240, "edit": 30}  # sekunder pa en T4, grovt

def progress(job, step, done=0, total=0):
    check_cancel(job)
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

def check_images(paths, nsfw_check=True, min_age=MIN_AGE):
    import cv2
    with_faces = False
    for pth in paths:
        check_cancel()
        img = cv2.imread(pth)
        if img is None: raise RuntimeError("En bild gick inte att läsa.")
        try: fs = detect(img)
        except Exception as e: raise RuntimeError("Ålderskontrollen kunde inte köras (kör installationscellen): " + str(e)[:120])
        for f in fs:
            if not face_age_ok(f, min_age): raise RuntimeError(f"Nekad: en person på bilderna bedöms vara under {min_age} år.")
        with_faces = with_faces or bool(fs)
    if nsfw_check and nsfw_frames(paths): raise RuntimeError("Nekad: en bild flaggades som NSFW.")
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
        check_cancel()
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
        check_cancel()
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

@app.post("/voices")
async def voices_add(name: str = Form(...), consent: str = Form(""), audio: List[UploadFile] = File(...), finetune: bool = Form(False),
                     steps: int = Form(300), authorization: Optional[str] = Header(None)):
    """Lagg till en samtyckt rost: 1-10 min traningsljud. Zero-shot-referens direkt, valfri Seed-VC-finjustering."""
    auth(authorization)
    if consent != "true": raise HTTPException(400, "Kryssa i 'Personen har gett samtycke till att rösten används'.")
    nm = name.strip()[:60]
    if not nm: raise HTTPException(400, "Skriv ett namn.")
    check_text(nm)
    if not audio or len(audio) > 20: raise HTTPException(400, "Ladda upp 1–20 ljudfiler.")
    if not STUB and not os.path.exists(SVC_PY): raise HTTPException(400, "Röstbyte är inte installerat: kör cellen 'Röstbyte (Seed-VC)' i notebooken.")
    vid = uuid.uuid4().hex[:8]; vd = os.path.join(WORK, "voice_" + vid); os.makedirs(vd)
    files = [await save_upload(a, vd, f"train{i:02}") for i, a in enumerate(audio)]
    total = sum(probe_dur(p) for p in files)
    if total < VOICE_MIN: shutil.rmtree(vd, True); raise HTTPException(400, f"För kort: {total:.0f} s. Minst 1 minut träningsljud.")
    if total > VOICE_MAX + 30: shutil.rmtree(vd, True); raise HTTPException(400, f"För långt: {total/60:.1f} min. Max 10 minuter.")
    now = time.strftime("%Y-%m-%d %H:%M:%S")
    voices[vid] = {"id": vid, "name": nm, "consent": True, "added": now, "dir": vd, "status": "training"}
    jid, _ = submit("voicetrain", task_voicetrain, voice=vid, finetune=bool(finetune), steps=max(100, min(int(steps), 1000)))
    print(f"[voices] {now} röst tillagd: {nm} ({total:.0f} s, samtycke intygat)")
    return {**go(jid, audio=files), "id": vid, "name": nm, "added": now, "seconds": round(total), "licenseNote": SVC_NOTE}

@app.get("/voices")
def voices_list(authorization: Optional[str] = Header(None)):
    auth(authorization)
    return [{"id": v["id"], "name": v["name"], "added": v["added"], "status": v["status"], "seconds": v.get("seconds"), "finetuned": bool(v.get("ckpt"))} for v in voices.values()]

@app.delete("/voices/{vid}")
def voices_del(vid: str, authorization: Optional[str] = Header(None)):
    auth(authorization); v = voices.pop(vid, None)
    if v: shutil.rmtree(v["dir"], True)
    return {"ok": True}

@app.post("/voiceswap")
async def voiceswap(voice_id: str = Form(...), media: Optional[UploadFile] = File(None), url: str = Form(""), separate: bool = Form(True),
                    pitch: int = Form(0), steps: int = Form(30), mux: bool = Form(True), rights: str = Form(""), authorization: Optional[str] = Header(None)):
    """Byt sangrosten i en lat/video till en rost ur den samtyckta rostlistan. Mal-roster kan ALDRIG komma utifran."""
    auth(authorization)
    v = voices.get(voice_id)
    if not v or not v.get("consent"): raise HTTPException(400, "Välj en röst ur din samtyckta röstlista.")
    if v["status"] != "ready": raise HTTPException(400, "Rösten tränas fortfarande – vänta tills den är klar.")
    if rights != "true": raise HTTPException(400, "Intyga att du äger eller har rätt att använda låten/videon.")
    if not media and not url.strip(): raise HTTPException(400, "Välj en fil, en inspelning eller en länk.")
    src_url = resolve_url(url) if (url.strip() and not media) else None
    jid, d = submit("voiceswap", task_voiceswap, voice=voice_id, url=src_url, separate=bool(separate), pitch=max(-12, min(int(pitch), 12)),
                    steps=max(10, min(int(steps), 60)), mux=bool(mux))
    return go(jid, media=await save_upload(media, d, "input") if media else None)

@app.post("/cancel/{jid}")
def cancel_ep(jid: str, authorization: Optional[str] = Header(None)):
    auth(authorization); j = jobs.get(jid)
    if not j: raise HTTPException(404, "Okänt jobb")
    hit = cancel_job(j)
    return {"id": jid, "cancelled": hit, "status": ("cancelling" if j["status"] == "running" else "cancelled") if hit else j["status"],
            "note": "Avbryts efter pågående steg." if hit and j["status"] == "running" else None}

@app.post("/cancel_all")
def cancel_all_ep(authorization: Optional[str] = Header(None)):
    auth(authorization); ids = [j["id"] for j in list(jobs.values()) if cancel_job(j)]
    return {"cancelled": ids, "count": len(ids)}

@app.get("/jobs")
def jobs_ep(authorization: Optional[str] = Header(None)):
    auth(authorization)
    act = [j for j in jobs.values() if j["status"] in ("queued", "running")]
    return {"jobs": [{"id": j["id"], "kind": j["kind"], "status": j["status"], "cancelling": bool(j.get("cancel")), "progress": j.get("progress"),
                      "elapsed": round(time.time() - j.get("started", j["created"]))} for j in sorted(act, key=lambda j: j["created"])]}

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
    mt = {".mp4": "video/mp4", ".png": "image/png", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".srt": "text/plain"}.get(os.path.splitext(name)[1], "application/octet-stream")
    return FileResponse(j["files"][name], media_type=mt, filename=f"kino-{jid}-{name}")
