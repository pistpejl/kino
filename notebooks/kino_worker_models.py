"""GPU pipelines for the KINO session worker. Turing T4/P100 (sm75), SFW only.

Designed to fit 16 GB: fp16 (not bf16), PyTorch SDPA (no FlashAttention-2, no FP8
kernels). CPU offload for Wan 2.2 TI2V-5B at 480p. LTX-Video 2B is the LTX variant
that is realistic on this card; full LTX-2.5 is not assumed to fit.

Kandinsky S2V Lite is not loaded: upstream documents ~28 GB even with VAE tiling.

This module is imported only when KINO_WORKER_MOCK is off. It is not executed in
CI. Time estimates in the notebooks are not measured on this machine.
"""
from __future__ import annotations

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


def render_job(job: dict, image: Path | None, audio: Path | None, work: Path) -> Path:
    engine = (job.get("engine") or "ltx-video").lower()
    if "wan" in engine:
        return render_wan(job, image, work)
    return render_ltx(job, image, work)


def render_ltx(job: dict, image: Path | None, work: Path) -> Path:
    import torch
    from diffusers import LTXPipeline, LTXImageToVideoPipeline
    from PIL import Image

    dtype = torch.float16
    seconds = max(2, min(5, float(job.get("seconds") or 4)))
    ratio = job.get("ratio") or "9:16"
    width, height = {"9:16": (480, 832), "16:9": (832, 480), "1:1": (512, 512)}.get(ratio, (480, 832))
    # snap to 32
    width, height = width // 32 * 32, height // 32 * 32
    out = work / "out.mp4"
    if image and Path(image).exists():
        pipe = LTXImageToVideoPipeline.from_pretrained(
            "Lightricks/LTX-Video", torch_dtype=dtype
        )
        pipe = _sdpa_pipe(pipe)
        pipe.enable_model_cpu_offload()
        img = Image.open(image).convert("RGB").resize((width, height))
        video = pipe(
            image=img, prompt=job.get("prompt") or "cinematic motion, SFW",
            negative_prompt=NEG, width=width, height=height,
            num_frames=max(9, int(seconds * 8)), num_inference_steps=20,
        ).frames[0]
    else:
        pipe = LTXPipeline.from_pretrained("Lightricks/LTX-Video", torch_dtype=dtype)
        pipe = _sdpa_pipe(pipe)
        pipe.enable_model_cpu_offload()
        video = pipe(
            prompt=job.get("prompt") or "cinematic motion, SFW",
            negative_prompt=NEG, width=width, height=height,
            num_frames=max(9, int(seconds * 8)), num_inference_steps=20,
        ).frames[0]
    from diffusers.utils import export_to_video
    export_to_video(video, str(out), fps=8)
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
            return out
        except Exception as err:
            last_err = err
            continue
    raise RuntimeError(f"Wan/LTX could not load on this GPU: {last_err}")
