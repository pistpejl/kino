/**
 * WaveSpeed AI image provider.
 * Catalog ids → documented WaveSpeed v3 endpoints.
 * Requires process.env.WAVESPEED_API_KEY (never invent a key).
 */

import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

const WS_BASE = "https://api.wavespeed.ai/api/v3";
const GEN_DIR = path.join(process.cwd(), "public", "generated");

async function saveBuffer(
  buf: Buffer,
  ext: string
): Promise<{ publicUrl: string }> {
  await fs.mkdir(GEN_DIR, { recursive: true });
  const name = `${randomUUID()}.${ext.replace(/^\./, "")}`;
  await fs.writeFile(path.join(GEN_DIR, name), buf);
  return { publicUrl: `/api/generated/${name}` };
}
const RESULT_URL = (id: string) => `${WS_BASE}/predictions/${id}/result`;

export type WaveSpeedBodyStyle = "size" | "aspect" | "size_aspect";

export interface WaveSpeedModelMapping {
  /** Path after /api/v3/ e.g. bytedance/seedream-v4.5 */
  endpoint: string;
  /** How to encode dimensions in the POST body */
  bodyStyle: WaveSpeedBodyStyle;
  label: string;
}

/** Catalog model id → WaveSpeed endpoint (documented paths only). */
export const WAVESPEED_IMAGE_MAP: Record<string, WaveSpeedModelMapping> = {
  seedream: {
    endpoint: "bytedance/seedream-v4.5",
    bodyStyle: "size",
    label: "Seedream 4.5",
  },
  "flux-schnell": {
    endpoint: "wavespeed-ai/flux-schnell",
    bodyStyle: "size",
    label: "FLUX Schnell",
  },
  "kling-nsfw": {
    endpoint: "kwaivgi/kling-image-v3/text-to-image",
    bodyStyle: "aspect",
    label: "Kling Image V3",
  },
  "z-image-turbo": {
    endpoint: "wavespeed-ai/z-image/turbo",
    bodyStyle: "size",
    label: "Z-Image Turbo",
  },
  "z-image": {
    endpoint: "wavespeed-ai/z-image/turbo",
    bodyStyle: "size",
    label: "Z-Image Turbo",
  },
  "qwen-image": {
    endpoint: "wavespeed-ai/qwen-image/text-to-image",
    bodyStyle: "size",
    label: "Qwen Image",
  },
  "flux-klein": {
    endpoint: "wavespeed-ai/flux-2-klein-9b/text-to-image",
    bodyStyle: "size",
    label: "FLUX.2 Klein 9B",
  },
  minimax: {
    endpoint: "minimax/image-01/text-to-image",
    bodyStyle: "size",
    label: "MiniMax Image-01",
  },
};

/** Video catalog ids that have a close WaveSpeed still endpoint. */
export const WAVESPEED_VIDEO_STILL_MAP: Record<string, WaveSpeedModelMapping> = {
  "seedance-2-5": {
    endpoint: "bytedance/seedream-v4.5",
    bodyStyle: "size",
    label: "Seedream 4.5 (still)",
  },
  "kling-nsfw-video": {
    endpoint: "kwaivgi/kling-image-v3/text-to-image",
    bodyStyle: "aspect",
    label: "Kling Image V3",
  },
  "minimax-h3": {
    endpoint: "minimax/image-01/text-to-image",
    bodyStyle: "size",
    label: "MiniMax Image-01",
  },
};

export function hasWaveSpeedKey(): boolean {
  const k = process.env.WAVESPEED_API_KEY;
  return Boolean(k && k.trim() && k.trim() !== "your-api-key");
}

export function getWaveSpeedApiKey(): string | null {
  if (!hasWaveSpeedKey()) return null;
  return process.env.WAVESPEED_API_KEY!.trim();
}

export function listSupportedWaveSpeedModels(): string[] {
  return Object.keys(WAVESPEED_IMAGE_MAP);
}

/**
 * Resolve catalog id → WaveSpeed mapping.
 * Returns null when unmapped (caller may fall back to Horde).
 * Use assertWaveSpeedMapping when WaveSpeed-only is required.
 */
export function resolveWaveSpeedMapping(
  modelId: string,
  category: "image" | "video" = "image"
): WaveSpeedModelMapping | null {
  if (category === "video") {
    return (
      WAVESPEED_VIDEO_STILL_MAP[modelId] ||
      WAVESPEED_IMAGE_MAP[modelId] ||
      null
    );
  }
  return WAVESPEED_IMAGE_MAP[modelId] || null;
}

/** Throw a clear error listing supported catalog ids. */
export function assertWaveSpeedMapping(
  modelId: string,
  category: "image" | "video" = "image"
): WaveSpeedModelMapping {
  const m = resolveWaveSpeedMapping(modelId, category);
  if (m) return m;
  const supported = listSupportedWaveSpeedModels().join(", ");
  throw new Error(
    `Model "${modelId}" has no WaveSpeed mapping. Supported: ${supported}. ` +
      `Set a mapped model, or omit WAVESPEED_API_KEY to use AI Horde (approx).`
  );
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function clampSize(width: number, height: number): { w: number; h: number } {
  // WaveSpeed models generally accept 512–2048; keep reasonable defaults.
  const w = Math.min(2048, Math.max(512, Math.round(width / 64) * 64));
  const h = Math.min(2048, Math.max(512, Math.round(height / 64) * 64));
  return { w, h };
}

function nearestAspect(ratio: string): string {
  const allowed = [
    "1:1",
    "3:4",
    "4:3",
    "9:16",
    "16:9",
    "2:3",
    "3:2",
    "21:9",
  ];
  if (allowed.includes(ratio)) return ratio;
  return "3:4";
}

export function buildWaveSpeedBody(
  mapping: WaveSpeedModelMapping,
  opts: {
    prompt: string;
    width: number;
    height: number;
    ratio?: string;
  }
): Record<string, unknown> {
  const { w, h } = clampSize(opts.width, opts.height);
  const body: Record<string, unknown> = {
    prompt: opts.prompt.slice(0, 2000),
  };

  if (mapping.bodyStyle === "aspect") {
    body.aspect_ratio = nearestAspect(opts.ratio || "3:4");
    body.resolution = w >= 1536 || h >= 1536 ? "2k" : "1k";
    body.num_images = 1;
    body.output_format = "jpeg";
  } else if (mapping.bodyStyle === "size_aspect") {
    body.size = `${w}*${h}`;
    body.aspect_ratio = nearestAspect(opts.ratio || "3:4");
  } else {
    body.size = `${w}*${h}`;
  }

  return body;
}

async function downloadOutputToPublic(output: string): Promise<string> {
  if (output.startsWith("data:")) {
    const idx = output.indexOf("base64,");
    if (idx < 0) throw new Error("Invalid base64 output from WaveSpeed");
    const buf = Buffer.from(output.slice(idx + 7), "base64");
    const { publicUrl } = await saveBuffer(buf, "jpg");
    return publicUrl;
  }

  // Naked base64 (no data: prefix)
  if (!/^https?:\/\//i.test(output) && /^[A-Za-z0-9+/=\s]+$/.test(output.slice(0, 80))) {
    try {
      const buf = Buffer.from(output.replace(/\s/g, ""), "base64");
      if (buf.length > 2000) {
        const { publicUrl } = await saveBuffer(buf, "jpg");
        return publicUrl;
      }
    } catch {
      /* fall through to URL fetch */
    }
  }

  const res = await fetch(output, {
    cache: "no-store",
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) {
    throw new Error(`WaveSpeed output download failed: ${res.status}`);
  }
  const ct = res.headers.get("content-type") || "image/jpeg";
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 500) throw new Error("WaveSpeed output image too small");
  const ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : "jpg";
  const { publicUrl } = await saveBuffer(buf, ext);
  return publicUrl;
}

/**
 * Submit → poll → download. Requires a real WAVESPEED_API_KEY.
 */
export async function generateViaWaveSpeed(opts: {
  prompt: string;
  modelId: string;
  width: number;
  height: number;
  ratio?: string;
  category?: "image" | "video";
}): Promise<{ url: string; endpoint: string }> {
  const key = getWaveSpeedApiKey();
  if (!key) {
    throw new Error("WAVESPEED_API_KEY is not set");
  }

  const mapping = assertWaveSpeedMapping(
    opts.modelId,
    opts.category || "image"
  );
  const body = buildWaveSpeedBody(mapping, {
    prompt: opts.prompt,
    width: opts.width,
    height: opts.height,
    ratio: opts.ratio,
  });

  const submitUrl = `${WS_BASE}/${mapping.endpoint}`;
  const submitRes = await fetch(submitUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  });

  const submitText = await submitRes.text();
  let submitJson: Record<string, unknown> = {};
  try {
    submitJson = JSON.parse(submitText) as Record<string, unknown>;
  } catch {
    throw new Error(
      `WaveSpeed submit bad JSON: ${submitRes.status} ${submitText.slice(0, 180)}`
    );
  }

  if (!submitRes.ok) {
    const msg =
      (submitJson.message as string) ||
      (submitJson.error as string) ||
      submitText.slice(0, 200);
    throw new Error(`WaveSpeed submit failed: ${submitRes.status} ${msg}`);
  }

  const task = (submitJson.data && typeof submitJson.data === "object"
    ? submitJson.data
    : submitJson) as Record<string, unknown>;
  const predictionId = String(task.id || "");
  if (!predictionId) {
    throw new Error("WaveSpeed did not return a prediction id");
  }

  // Sync mode may already complete
  if (task.status === "completed" && Array.isArray(task.outputs) && task.outputs[0]) {
    const url = await downloadOutputToPublic(String(task.outputs[0]));
    return { url, endpoint: mapping.endpoint };
  }

  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    await sleep(2000);
    const pollRes = await fetch(RESULT_URL(predictionId), {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(30000),
    });
    if (!pollRes.ok) continue;
    const pollJson = (await pollRes.json()) as Record<string, unknown>;
    const result = (pollJson.data && typeof pollJson.data === "object"
      ? pollJson.data
      : pollJson) as {
      status?: string;
      outputs?: unknown[];
      error?: string;
    };
    const status = result.status || "";
    if (status === "completed") {
      const out = result.outputs?.[0];
      if (!out) throw new Error("WaveSpeed completed with empty outputs");
      const url = await downloadOutputToPublic(String(out));
      return { url, endpoint: mapping.endpoint };
    }
    if (["failed", "cancelled", "timeout", "deleted"].includes(status)) {
      throw new Error(
        `WaveSpeed job ${status}: ${result.error || "no details"}`
      );
    }
  }

  throw new Error("WaveSpeed generation timed out");
}
