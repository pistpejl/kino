/**
 * Together.ai image provider (FLUX.1 Schnell).
 * Requires process.env.TOGETHER_API_KEY (never invent a key).
 * Docs: POST https://api.together.xyz/v1/images/generations
 */

import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { getModelName, IMAGE_MODELS } from "./models";

const TOGETHER_URL = "https://api.together.xyz/v1/images/generations";
const FLUX_SCHNELL_MODEL = "black-forest-labs/FLUX.1-schnell";
const GEN_DIR = path.join(process.cwd(), "public", "generated");

export interface TogetherModelMapping {
  model: string;
  label: string;
  steps: number;
}

async function saveBuffer(
  buf: Buffer,
  ext: string
): Promise<{ publicUrl: string }> {
  await fs.mkdir(GEN_DIR, { recursive: true });
  const name = `${randomUUID()}.${ext.replace(/^\./, "")}`;
  await fs.writeFile(path.join(GEN_DIR, name), buf);
  return { publicUrl: `/api/generated/${name}` };
}

export function hasTogetherKey(): boolean {
  const k = process.env.TOGETHER_API_KEY;
  return Boolean(k && k.trim() && k.trim() !== "your-api-key");
}

export function getTogetherApiKey(): string | null {
  if (!hasTogetherKey()) return null;
  return process.env.TOGETHER_API_KEY!.trim();
}

/**
 * Map catalog id / display name → Together FLUX.1-schnell.
 * Matches flux-schnell, plain flux, or names containing "flux schnell".
 */
export function resolveTogetherMapping(
  modelId: string
): TogetherModelMapping | null {
  const id = (modelId || "").trim().toLowerCase();
  const catalogName = getModelName(IMAGE_MODELS, modelId).toLowerCase();

  const isFluxSchnell =
    id === "flux-schnell" ||
    id === "flux" ||
    id.includes("flux-schnell") ||
    catalogName.includes("flux schnell") ||
    catalogName.includes("flux.1 schnell") ||
    catalogName.includes("flux.1-schnell");

  if (!isFluxSchnell) return null;

  return {
    model: FLUX_SCHNELL_MODEL,
    label: "Flux Schnell",
    steps: 4,
  };
}

function clampDim(n: number): number {
  // Together FLUX typically accepts multiples of 16; keep 256–1440.
  const rounded = Math.round(n / 16) * 16;
  return Math.min(1440, Math.max(256, rounded));
}

async function downloadUrlToPublic(url: string): Promise<string> {
  const res = await fetch(url, {
    cache: "no-store",
    headers: { "User-Agent": "KINO/1.0" },
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) {
    throw new Error(`Together output download failed: ${res.status}`);
  }
  const ct = res.headers.get("content-type") || "image/jpeg";
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 500) throw new Error("Together output image too small");
  const ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : "jpg";
  const { publicUrl } = await saveBuffer(buf, ext);
  return publicUrl;
}

async function b64ToPublic(b64: string): Promise<string> {
  const cleaned = b64.includes("base64,")
    ? b64.slice(b64.indexOf("base64,") + 7)
    : b64.replace(/\s/g, "");
  const buf = Buffer.from(cleaned, "base64");
  if (buf.length < 500) throw new Error("Together base64 image too small");
  // PNG magic or default jpg
  const isPng =
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const { publicUrl } = await saveBuffer(buf, isPng ? "png" : "jpg");
  return publicUrl;
}

/**
 * Generate via Together images API. Requires TOGETHER_API_KEY + flux mapping.
 * Handles response_format url and base64 / b64_json.
 */
export async function generateViaTogether(opts: {
  prompt: string;
  modelId: string;
  width: number;
  height: number;
}): Promise<{ url: string; model: string }> {
  const key = getTogetherApiKey();
  if (!key) {
    throw new Error("TOGETHER_API_KEY is not set");
  }

  const mapping = resolveTogetherMapping(opts.modelId);
  if (!mapping) {
    throw new Error(`Model "${opts.modelId}" has no Together mapping`);
  }

  const width = clampDim(opts.width);
  const height = clampDim(opts.height);

  // Prefer base64 so we avoid a second CDN fetch (User-Agent quirks).
  const body = {
    model: mapping.model,
    prompt: opts.prompt.slice(0, 2000),
    width,
    height,
    steps: mapping.steps,
    n: 1,
    response_format: "base64" as const,
  };

  const res = await fetch(TOGETHER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90000),
  });

  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(
      `Together bad JSON: ${res.status} ${text.slice(0, 180)}`
    );
  }

  if (!res.ok) {
    const errObj = json.error as { message?: string } | string | undefined;
    const msg =
      (typeof errObj === "object" && errObj?.message) ||
      (typeof errObj === "string" ? errObj : null) ||
      (json.message as string) ||
      text.slice(0, 200);
    throw new Error(`Together failed: ${res.status} ${msg}`);
  }

  const data = json.data;
  if (!Array.isArray(data) || !data[0]) {
    throw new Error("Together returned empty data");
  }

  const item = data[0] as {
    url?: string;
    b64_json?: string;
    b64?: string;
  };

  if (item.b64_json || item.b64) {
    const url = await b64ToPublic(item.b64_json || item.b64 || "");
    return { url, model: mapping.model };
  }

  if (item.url) {
    // May be a data URL or http(s)
    if (item.url.startsWith("data:")) {
      const url = await b64ToPublic(item.url);
      return { url, model: mapping.model };
    }
    const url = await downloadUrlToPublic(item.url);
    return { url, model: mapping.model };
  }

  throw new Error("Together response missing url/b64_json");
}
