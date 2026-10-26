# KINO Colab-motor: FastAPI-server for videogenerering pa en Colab-GPU.
# KINO_STUB=1 kor utan GPU/modell (for lokalt test).
import os, re, io, uuid, time, threading, queue, secrets, tempfile
from typing import Optional
from fastapi import FastAPI, Form, File, UploadFile, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

TOKEN = os.environ.get("KINO_TOKEN") or secrets.token_urlsafe(24)
STUB = os.environ.get("KINO_STUB") == "1"
MODEL_ID = os.environ.get("KINO_MODEL", "Wan-AI/Wan2.1-T2V-1.3B-Diffusers")
OUT = tempfile.mkdtemp(prefix="kino_")
FPS = 16
MAX_SECONDS = 5  # 81 bildrutor, max for Wan 1.3B

# Innehallsregler: aldrig minderariga; SFW-motor, inget explicit; inga riktiga personers foton i NSFW.
MINOR_RE = re.compile(r"(^|[^a-zåäö0-9])(child|children|kids?|minors?|underage|under[\s-]*age|teens?|teenage[rs]?|preteen|tween|adolescent|juvenile|loli(ta|con)?|shota(con)?|young[\s-]*looking|barely[\s-]*legal|jailbait|school[\s-]*(girl|boy|uniform)|kindergarten|toddler|baby|infant|little[\s-]*(girl|boy)|young[\s-]*(girl|boy)|barn(et|en)?|minderåriga?|omyndig|tonåring(ar)?|tonårs|flick(a|an|or)|pojk(e|en|ar)|skolflicka|skolpojke|dagis|bebis|småbarn)(?=$|[^a-zåäö0-9])", re.I)
AGE_RE = re.compile(r"\b(\d{1,2})\s*(?:-|\s)?\s*(?:yo|y/o|yrs?|years?(?:[\s-]*old)?|år(?:ig|ing|s)?|åring)\b", re.I)
NSFW_RE = re.compile(r"(^|[^a-zåäö0-9])(nsfw|nude|naked|nudity|porn\w*|sex\w*|explicit|erotic\w*|topless|lingerie|genital\w*|nipples?|naken|nakna|porr\w*|erotisk\w*|bröstvårtor?)(?=$|[^a-zåäö0-9])", re.I)
STYLE = ("natural handheld phone video, real-life lighting, slight camera shake, authentic, "
         "unpolished, true-to-life colors")
NEGATIVE = ("AI look, overly smooth skin, plastic, CGI, 3d render, oversaturated, cinematic color grading, "
            "glossy, airbrushed, text, watermark, blurry, deformed, extra fingers, static frame")

def check_prompt(prompt: str, has_image: bool):
    s = (prompt or "").lower()
    if MINOR_RE.search(s) or any(int(m.group(1)) < 18 for m in AGE_RE.finditer(s)):
        raise HTTPException(400, "Nekad: KINO gör aldrig något som rör minderåriga.")
    if NSFW_RE.search(s):
        if has_image:
            raise HTTPException(400, "Nekad: riktiga personers foton får aldrig användas i NSFW.")
        raise HTTPException(400, "Nekad: Colab-motorn är bara SFW.")

ASPECT = {"9:16": (480, 832), "16:9": (832, 480), "1:1": (624, 624)}

pipe = None
def load():
    global pipe
    if STUB or pipe is not None: return
    import torch
    from diffusers import AutoencoderKLWan, WanPipeline
    vae = AutoencoderKLWan.from_pretrained(MODEL_ID, subfolder="vae", torch_dtype=torch.float32)
    pipe = WanPipeline.from_pretrained(MODEL_ID, vae=vae, torch_dtype=torch.float16)  # T4: fp16 (ingen bra bf16)
    pipe.enable_model_cpu_offload()
    try: pipe.vae.enable_tiling()
    except Exception: pass

def render(job):
    path = os.path.join(OUT, job["id"] + ".mp4")
    w, h = ASPECT.get(job["aspect"], ASPECT["9:16"])
    frames = min(job["seconds"], MAX_SECONDS) * FPS + 1
    frames = ((frames - 1) // 4) * 4 + 1  # Wan kräver 4k+1
    if STUB:
        import numpy as np, imageio
        vid = [np.full((h // 4, w // 4, 3), (i * 7) % 255, dtype=np.uint8) for i in range(frames)]
        imageio.mimsave(path, vid, fps=FPS)
        return path
    import torch
    from diffusers.utils import export_to_video
    g = torch.Generator("cpu").manual_seed(job["seed"])
    out = pipe(prompt=f"{job['prompt']}. {STYLE}", negative_prompt=NEGATIVE, height=h, width=w,
               num_frames=frames, num_inference_steps=job["steps"], guidance_scale=5.0, generator=g).frames[0]
    export_to_video(out, path, fps=FPS)
    return path

jobs, q = {}, queue.Queue()
def worker():
    while True:
        job = q.get()
        job["status"] = "running"; job["started"] = time.time()
        try:
            load(); job["file"] = render(job); job["status"] = "done"
        except Exception as e:
            job["status"] = "error"; job["error"] = str(e)[:300]
        job["finished"] = time.time()
threading.Thread(target=worker, daemon=True).start()

app = FastAPI(title="KINO Colab-motor")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

def auth(authorization: Optional[str]):
    if not authorization or not secrets.compare_digest(authorization, f"Bearer {TOKEN}"):
        raise HTTPException(401, "Fel eller saknad token")

@app.get("/health")
def health(authorization: Optional[str] = Header(None)):
    ok = bool(authorization) and secrets.compare_digest(authorization, f"Bearer {TOKEN}")
    gpu = "stub"
    if not STUB:
        try:
            import torch; gpu = torch.cuda.get_device_name(0) if torch.cuda.is_available() else "ingen"
        except Exception: gpu = "okänd"
    return {"ok": True, "auth": ok, "model": MODEL_ID if not STUB else "stub", "gpu": gpu,
            "queue": q.qsize(), "maxSeconds": MAX_SECONDS, "sfwOnly": True}

@app.post("/generate")
async def generate(prompt: str = Form(...), seconds: int = Form(4), aspect: str = Form("9:16"),
                   steps: int = Form(30), seed: int = Form(-1), image: Optional[UploadFile] = File(None),
                   authorization: Optional[str] = Header(None)):
    auth(authorization)
    has_image = image is not None and bool(image.filename)
    check_prompt(prompt, has_image)
    jid = uuid.uuid4().hex[:12]
    jobs[jid] = {"id": jid, "prompt": prompt.strip()[:800], "seconds": max(1, min(int(seconds), MAX_SECONDS)),
                 "aspect": aspect if aspect in ASPECT else "9:16", "steps": max(10, min(int(steps), 50)),
                 "seed": seed if seed >= 0 else secrets.randbelow(2**31), "status": "queued", "created": time.time(),
                 "note": "Bilden används inte: Wan 1.3B är text-till-video." if has_image else None}
    q.put(jobs[jid])
    return {"jobId": jid, "status": "queued", "note": jobs[jid]["note"]}

@app.get("/status/{jid}")
def status(jid: str, authorization: Optional[str] = Header(None)):
    auth(authorization)
    j = jobs.get(jid)
    if not j: raise HTTPException(404, "Okänt jobb")
    return {k: j.get(k) for k in ("id", "status", "error", "note", "seconds", "aspect")} | {
        "url": f"/result/{jid}" if j["status"] == "done" else None,
        "elapsed": round((j.get("finished") or time.time()) - j.get("started", time.time()))}

@app.get("/result/{jid}")
def result(jid: str, authorization: Optional[str] = Header(None)):
    auth(authorization)
    j = jobs.get(jid)
    if not j or j["status"] != "done": raise HTTPException(404, "Inte klart")
    return FileResponse(j["file"], media_type="video/mp4", filename=f"kino-{jid}.mp4")
