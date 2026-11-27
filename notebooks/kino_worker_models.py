"""GPU pipelines for the KINO session worker. Turing T4/P100 (sm75), SFW only.

Designed to fit 16 GB: fp16 (not bf16), PyTorch SDPA (no FlashAttention-2, no FP8
kernels). CPU offload for Wan 2.2 TI2V-5B at 480p. LTX-Video 2B is the LTX variant
that is realistic on this card; full LTX-2.5 is not assumed to fit.

Kandinsky S2V Lite is not loaded: upstream documents ~28 GB even with VAE tiling.

Lip sync ('lipsync' jobs) runs LatentSync 1.5 on videos (kino_latentsync.py), EchoMimic V3 Flash for full-body
singing from a still (kino_echomimic.py), or MuseTalk 1.5 (kino_musetalk.py): engine 'musetalk' redraws the
mouth on the uploaded still or video; engine 'musetalk-alive' ("Levande bild + läppsynk")
first animates the still with LTX-Video (Wan as fallback) for the audio's length, frees the
VRAM, then runs MuseTalk on that clip and muxes the audio.

This module is imported only when KINO_WORKER_MOCK is off. It is not executed in
CI. Time estimates in the notebooks are not measured on this machine.
"""
from __future__ import annotations

import gc
from pathlib import Path

NEG = "blurry, text, watermark, logo, low quality, deformed, nsfw"


def _sdpa_pipe(pipe):
    import torch
    if hasattr(pipe, "transformer") and hasattr(pipe.transformer, "to"):
        pass
    try:
        if hasattr(torch.nn.functional, "scaled_dot_product_attention") and hasattr(pipe, "set_attn_processor"):
            # Prefer SDPA / default processors — never flash-attn 2 on sm75.
            from diffusers.models.attention_processor import AttnProcessor2_0
            pipe.set_attn_processor(AttnProcessor2_0())
    except Exception:
        pass
    return pipe


def _free(*objs):
    """Drop pipelines and give the VRAM back before the next model loads."""
    for o in objs:
        try:
            del o
        except Exception:
            pass
    gc.collect()
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            torch.cuda.ipc_collect()
    except Exception:
        pass


def _unload_musetalk():
    try:
        import kino_musetalk  # type: ignore
        kino_musetalk.unload()
    except Exception:
        pass


def render_job(job: dict, image: Path | None, audio: Path | None, work: Path, video: Path | None = None) -> Path:
    engine = (job.get("engine") or "ltx-video").lower()
    if job.get("kind") == "lipsync" or engine.startswith("musetalk"):
        return render_lipsync(job, image, audio, work, video)
    _unload_musetalk()
    if "wan" in engine:
        return render_wan(job, image, work)
    return render_ltx(job, image, work)


def render_lipsync(job: dict, image: Path | None, audio: Path | None, work: Path, video: Path | None = None) -> Path:
    """Real lip sync. 'musetalk' / 'musetalk-alive' (MuseTalk 1.5, alive = LTX animates the still first),
    'latentsync' (LatentSync 1.5 on a video, own venv) and 'echomimic-v3' (EchoMimic V3 Flash: image + audio ->
    singing with head and body motion, own venv). The venv engines run as subprocesses, so MuseTalk and any
    diffusers pipeline are dropped from VRAM first."""
    import kino_musetalk as mt  # type: ignore
    if not audio or not Path(audio).exists():
        raise RuntimeError("Läppsynk kräver ljud.")
    engine = (job.get("engine") or "musetalk").lower()
    source = video if video and Path(video).exists() else image
    if not source or not Path(source).exists():
        raise RuntimeError("Läppsynk kräver en bild eller video.")
    if engine == "latentsync":
        import kino_latentsync as ls  # type: ignore
        mt.unload()
        _free()
        seconds = max(1.0, min(ls.MAX_SECONDS, mt.probe_seconds(audio) or float(job.get("seconds") or 4)))
        return ls.run(Path(source), Path(audio), work / "ls", seconds=seconds)
    if engine == "echomimic-v3":
        import kino_echomimic as em  # type: ignore
        mt.unload()
        _free()
        seconds = max(1.0, min(em.MAX_SECONDS, mt.probe_seconds(audio) or float(job.get("seconds") or 4)))
        ref = image if image and Path(image).exists() else source
        return em.run(Path(ref), Path(audio), work / "em", prompt=(job.get("prompt") or "").strip(),
                      seconds=seconds, ratio=job.get("ratio") or "9:16")
    seconds = mt.probe_seconds(audio) or float(job.get("seconds") or 4)
    seconds = max(1.0, min(mt.MAX_SECONDS, seconds))
    if engine == "musetalk-alive" and not (video and Path(video).exists()):
        mt.unload()  # LTX/Wan need the whole card
        motion = (job.get("prompt") or "").strip()
        prompt = ", ".join(x for x in (
            motion,
            "the person is singing, mouth moving naturally, expressive face, natural body motion",
            "cinematic, realistic, steady camera, SFW",
        ) if x)
        clip_job = dict(job, prompt=prompt, seconds=seconds)
        try:
            clip = render_ltx(clip_job, image, work, frames=mt.ltx_frames_for(seconds), fps=24, name="alive.mp4")
        except Exception as err:
            print(f"LTX misslyckades ({err}), provar Wan", flush=True)
            _free()
            clip = render_wan(dict(clip_job, engine="wan-2.2"), image, work)
        _free()
        source = clip
    return mt.lipsync(Path(source), Path(audio), work / "mt", seconds=seconds)


def render_ltx(job: dict, image: Path | None, work: Path, frames: int | None = None, fps: int = 8, name: str = "out.mp4") -> Path:
    import torch
    from diffusers import LTXPipeline, LTXImageToVideoPipeline
    from PIL import Image

    dtype = torch.float16
    seconds = max(2, min(5, float(job.get("seconds") or 4)))
    ratio = job.get("ratio") or "9:16"
    width, height = {"9:16": (480, 832), "16:9": (832, 480), "1:1": (512, 512)}.get(ratio, (480, 832))
    # snap to 32
    width, height = width // 32 * 32, height // 32 * 32
    out = work / name
    n_frames = frames or max(9, int(seconds * 8))
    if image and Path(image).exists():
        pipe = LTXImageToVideoPipeline.from_pretrained(
            "Lightricks/LTX-Video", torch_dtype=dtype
        )
        pipe = _sdpa_pipe(pipe)
        pipe.enable_model_cpu_offload()
        from PIL import ImageOps
        img = ImageOps.fit(Image.open(image).convert("RGB"), (width, height))  # crop, don't squash faces
        video = pipe(
            image=img, prompt=job.get("prompt") or "cinematic motion, SFW",
            negative_prompt=NEG, width=width, height=height,
            num_frames=n_frames, num_inference_steps=20,
        ).frames[0]
    else:
        pipe = LTXPipeline.from_pretrained("Lightricks/LTX-Video", torch_dtype=dtype)
        pipe = _sdpa_pipe(pipe)
        pipe.enable_model_cpu_offload()
        video = pipe(
            prompt=job.get("prompt") or "cinematic motion, SFW",
            negative_prompt=NEG, width=width, height=height,
            num_frames=n_frames, num_inference_steps=20,
        ).frames[0]
    from diffusers.utils import export_to_video
    export_to_video(video, str(out), fps=fps)
    pipe = None
    _free(pipe)
    return out


def render_wan(job: dict, image: Path | None, work: Path) -> Path:
    """Wan 2.2 TI2V-5B at 480p with CPU offload, or 1.3B if 5B cannot load."""
    import torch
    from PIL import Image

    dtype = torch.float16
    seconds = max(2, min(5, float(job.get("seconds") or 4)))
    ratio = job.get("ratio") or "9:16"
    width, height = {"9:16": (480, 832), "16:9": (832, 480), "1:1": (512, 512)}.get(ratio, (480, 832))
    width, height = width // 16 * 16, height // 16 * 16
    out = work / "out.mp4"
    prompt = job.get("prompt") or "cinematic motion, SFW"
    last_err = None
    for repo, cls_name in (
        ("Wan-AI/Wan2.2-TI2V-5B", "WanPipeline"),
        ("Wan-AI/Wan2.1-T2V-1.3B", "WanPipeline"),
    ):
        try:
            import diffusers
            cls = getattr(diffusers, cls_name, None) or getattr(diffusers, "DiffusionPipeline")
            pipe = cls.from_pretrained(repo, torch_dtype=dtype)
            pipe = _sdpa_pipe(pipe)
            pipe.enable_model_cpu_offload()
            kw = dict(prompt=prompt, negative_prompt=NEG, width=width, height=height, num_frames=max(17, int(seconds * 8)))
            if image and Path(image).exists() and hasattr(pipe, "__call__"):
                try:
                    kw["image"] = Image.open(image).convert("RGB").resize((width, height))
                except Exception:
                    pass
            video = pipe(**kw).frames[0]
            from diffusers.utils import export_to_video
            export_to_video(video, str(out), fps=8)
            pipe = None
            _free()
            return out
        except Exception as err:
            last_err = err
            pipe = None
            _free()
            continue
    raise RuntimeError(f"Wan/LTX could not load on this GPU: {last_err}")
