/**
 * Cloudflare Workers AI image provider.
 * Primary: Flux Schnell (@cf/black-forest-labs/flux-1-schnell).
 * Bonus: SDXL for other SFW catalog models when CF credentials are set.
 * Credentials: CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN (process.env),
 * optionally synced from /home/box/agent-data/box-secrets.json card keys.
 */

import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { getModelName, IMAGE_MODELS } from "./models";

const GEN_DIR = path.join(process.cwd(), "public", "generated");
const SECRETS_PATH = "/home/box/agent-data/box-secrets.json";
const ENV_LOCAL_PATH = path.join(process.cwd(), ".env.local");

const FLUX_SCHNELL_CF = "@cf/black-forest-labs/flux-1-schnell";
const SDXL_CF = "@cf/stabilityai/stable-diffusion-xl-base-1.0";

export interface CloudflareModelMapping {
  model: string;
  label: string;
  /** Flux uses `steps`; SDXL uses `num_steps`. */
  kind: "flux" | "sdxl";
  steps: number;
}

/** Catalog ids that map to real CF Workers AI models. */
const CF_FLUX_IDS = new Set(["flux-schnell", "flux"]);

/** Optional SDXL stand-in for other SFW stills when Cloudflare is configured. */
const CF_SDXL_IDS = new Set([
  "z-image-turbo",
  "seedream",
  "qwen-image",
  "krea-2",
  "analog",
  "flux-klein",
  "z-image",
  "minimax",
]);

let secretsSynced = false;

/**
 * Upsert KEY=value in .env.local without printing the value.
 * Preserves other lines; never logs secret contents.
 */
function upsertEnvLocal(updates: Record<string, string>): void {
  let text = "";
  try {
    text = fs.readFileSync(ENV_LOCAL_PATH, "utf8");
  } catch {
    text = "";
  }
  const lines = text.length ? text.split(/\r?\n/) : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && Object.prototype.hasOwnProperty.call(updates, m[1])) {
      out.push(`${m[1]}=${updates[m[1]]}`);
      seen.add(m[1]);
    } else {
      out.push(line);
    }
  }
  for (const [k, v] of Object.entries(updates)) {
    if (!seen.has(k)) {
      if (out.length && out[out.length - 1] !== "") out.push("");
      out.push(`${k}=${v}`);
    }
  }
  const body = out.join("\n").replace(/\n*$/, "\n");
  fs.writeFileSync(ENV_LOCAL_PATH, body, { mode: 0o600 });
}

/**
 * Load CLOUDFLARE_* from box-secrets card into process.env + .env.local.
 * Safe to call repeatedly; never logs secret values.
 */
export function syncCloudflareSecretsFromCard(): {
  accountId: boolean;
  token: boolean;
  wrote: boolean;
} {
  let accountId = Boolean(
    process.env.CLOUDFLARE_ACCOUNT_ID?.trim() &&
      process.env.CLOUDFLARE_ACCOUNT_ID.trim() !== "your-account-id"
  );
  let token = Boolean(
    process.env.CLOUDFLARE_API_TOKEN?.trim() &&
      process.env.CLOUDFLARE_API_TOKEN.trim() !== "your-api-token"
  );
  let wrote = false;

  if (accountId && token) {
    secretsSynced = true;
    return { accountId, token, wrote };
  }

  try {
    const raw = fs.readFileSync(SECRETS_PATH, "utf8");
    const data = JSON.parse(raw) as { card?: Record<string, unknown> };
    const card = data.card || {};
    const updates: Record<string, string> = {};

    const cardAccount = card.CLOUDFLARE_ACCOUNT_ID;
    const cardToken = card.CLOUDFLARE_API_TOKEN;

    if (
      !accountId &&
      typeof cardAccount === "string" &&
      cardAccount.trim() &&
      cardAccount.trim() !== "your-account-id"
    ) {
      process.env.CLOUDFLARE_ACCOUNT_ID = cardAccount.trim();
      updates.CLOUDFLARE_ACCOUNT_ID = cardAccount.trim();
      accountId = true;
    }
    if (
      !token &&
      typeof cardToken === "string" &&
      cardToken.trim() &&
      cardToken.trim() !== "your-api-token"
    ) {
      process.env.CLOUDFLARE_API_TOKEN = cardToken.trim();
      updates.CLOUDFLARE_API_TOKEN = cardToken.trim();
      token = true;
    }

    if (Object.keys(updates).length) {
      upsertEnvLocal(updates);
      wrote = true;
      console.log(
        "[kino] synced Cloudflare credentials from box-secrets → .env.local (keys only)"
      );
    }
  } catch {
    /* secrets file missing or unreadable — ignore */
  }

  secretsSynced = true;
  return { accountId, token, wrote };
}

export function hasCloudflareCredentials(): boolean {
  if (!secretsSynced) syncCloudflareSecretsFromCard();
  const id = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const tok = process.env.CLOUDFLARE_API_TOKEN?.trim();
  return Boolean(
    id &&
      tok &&
      id !== "your-account-id" &&
      tok !== "your-api-token"
  );
}

export function getCloudflareCredentials(): {
  accountId: string;
  token: string;
} | null {
  if (!hasCloudflareCredentials()) return null;
  return {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID!.trim(),
    token: process.env.CLOUDFLARE_API_TOKEN!.trim(),
  };
}

/**
 * Map catalog id / display name → Cloudflare Workers AI model.
 * Flux Schnell is primary; other SFW stills may use SDXL as a free bonus.
 */
export function resolveCloudflareMapping(
  modelId: string
): CloudflareModelMapping | null {
  const id = (modelId || "").trim().toLowerCase();
  const catalogName = getModelName(IMAGE_MODELS, modelId).toLowerCase();

  const isFluxSchnell =
    CF_FLUX_IDS.has(id) ||
    id.includes("flux-schnell") ||
    catalogName.includes("flux schnell") ||
    catalogName.includes("flux.1 schnell") ||
    catalogName.includes("flux.1-schnell");

  if (isFluxSchnell) {
    return {
      model: FLUX_SCHNELL_CF,
      label: "Flux Schnell",
      kind: "flux",
      steps: 4,
    };
  }

  if (CF_SDXL_IDS.has(id)) {
    return {
      model: SDXL_CF,
      label: getModelName(IMAGE_MODELS, modelId),
      kind: "sdxl",
      steps: 20,
    };
  }

  return null;
}

async function saveBuffer(
  buf: Buffer,
  ext: string
): Promise<{ publicUrl: string }> {
  await fsPromises.mkdir(GEN_DIR, { recursive: true });
  const name = `${randomUUID()}.${ext.replace(/^\./, "")}`;
  await fsPromises.writeFile(path.join(GEN_DIR, name), buf);
  return { publicUrl: `/api/generated/${name}` };
}

async function b64ToPublic(b64: string): Promise<string> {
  const cleaned = b64.includes("base64,")
    ? b64.slice(b64.indexOf("base64,") + 7)
    : b64.replace(/\s/g, "");
  const buf = Buffer.from(cleaned, "base64");
  if (buf.length < 500) throw new Error("Cloudflare base64 image too small");
  const isPng =
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
  const ext = isPng ? "png" : isJpeg ? "jpg" : "jpg";
  const { publicUrl } = await saveBuffer(buf, ext);
  return publicUrl;
}

function clampDim(n: number, max = 1024): number {
  const rounded = Math.round(n / 8) * 8;
  return Math.min(max, Math.max(256, rounded));
}

/**
 * Generate via Cloudflare Workers AI. Requires ACCOUNT_ID + TOKEN + mapping.
 */
export async function generateViaCloudflare(opts: {
  prompt: string;
  modelId: string;
  width: number;
  height: number;
}): Promise<{ url: string; model: string; label: string; kind: "flux" | "sdxl" }> {
  const creds = getCloudflareCredentials();
  if (!creds) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN not set");
  }

  const mapping = resolveCloudflareMapping(opts.modelId);
  if (!mapping) {
    throw new Error(`Model "${opts.modelId}" has no Cloudflare mapping`);
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${creds.accountId}/ai/run/${mapping.model}`;

  let body: Record<string, unknown>;
  if (mapping.kind === "flux") {
    body = {
      prompt: opts.prompt.slice(0, 2048),
      steps: mapping.steps,
    };
  } else {
    body = {
      prompt: opts.prompt.slice(0, 2048),
      num_steps: mapping.steps,
      width: clampDim(opts.width),
      height: clampDim(opts.height),
    };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90000),
  });

  const ct = res.headers.get("content-type") || "";

  // Some Workers AI models return raw image bytes
  if (ct.includes("image/")) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (!res.ok || buf.length < 500) {
      throw new Error(`Cloudflare image response failed: ${res.status}`);
    }
    const ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : "jpg";
    const { publicUrl } = await saveBuffer(buf, ext);
    return {
      url: publicUrl,
      model: mapping.model,
      label: mapping.label,
      kind: mapping.kind,
    };
  }

  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(
      `Cloudflare bad JSON: ${res.status} ${text.slice(0, 180)}`
    );
  }

  if (!res.ok || json.success === false) {
    const errors = json.errors as { message?: string }[] | undefined;
    const msg =
      errors?.[0]?.message ||
      (json.message as string) ||
      text.slice(0, 200);
    throw new Error(`Cloudflare failed: ${res.status} ${msg}`);
  }

  const result = json.result as
    | { image?: string; images?: string[] }
    | string
    | undefined;

  let b64: string | undefined;
  if (typeof result === "string") {
    b64 = result;
  } else if (result && typeof result === "object") {
    b64 = result.image || result.images?.[0];
  }

  if (!b64) {
    throw new Error("Cloudflare response missing result.image");
  }

  const publicUrl = await b64ToPublic(b64);
  return {
    url: publicUrl,
    model: mapping.model,
    label: mapping.label,
    kind: mapping.kind,
  };
}
