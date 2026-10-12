/**
 * Catalog → provider mapping.
 * 1) WaveSpeed AI (when WAVESPEED_API_KEY set + model mapped).
 * 2) Cloudflare Workers AI (ACCOUNT_ID+TOKEN + CF mapping; Flux Schnell primary).
 * 3) Together.ai FLUX.1-schnell (when TOGETHER_API_KEY set + flux-schnell mapping).
 * 4) AI Horde only (approx) — never Pollinations for catalog models.
 * Engine badges always use catalog display names — never Grok / provider brands.
 */

import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import {
  generateViaWaveSpeed,
  hasWaveSpeedKey,
  resolveWaveSpeedMapping,
} from "./wavespeed";
import {
  generateViaCloudflare,
  hasCloudflareCredentials,
  resolveCloudflareMapping,
  syncCloudflareSecretsFromCard,
} from "./cloudflare";
import {
  generateViaTogether,
  hasTogetherKey,
  resolveTogetherMapping,
} from "./together";

const HORDE = "https://aihorde.net/api/v2";
const GEN_DIR = path.join(process.cwd(), "public", "generated");

export interface ProviderMapping {
  /** @deprecated unused — Pollinations removed from generate path */
  pollinations?: string;
  horde: string[];
  styleHint: string;
}

/** Map KINO catalog ids to real provider model ids + style hints. */
export const IMAGE_PROVIDER_MAP: Record<string, ProviderMapping> = {
  "z-image-turbo": {
    pollinations: "turbo",
    horde: ["AlbedoBase XL (SDXL)", "AlbedoBase XL 3.1", "stable_diffusion"],
    styleHint: "z-image turbo aesthetic, crisp fast render, clean digital photo",
  },
  seedream: {
    pollinations: "flux",
    horde: ["Juggernaut XL", "AlbedoBase XL (SDXL)", "Realistic Vision"],
    styleHint: "seedream cinematic still, rich color grade, polished commercial look",
  },
  "qwen-image": {
    pollinations: "flux",
    horde: ["AlbedoBase XL (SDXL)", "Dreamshaper", "Juggernaut XL"],
    styleHint: "qwen-image style, balanced realism, detailed fabrics",
  },
  "flux-schnell": {
    pollinations: "flux",
    horde: ["AlbedoBase XL (SDXL)", "AlbedoBase XL 3.1", "stable_diffusion"],
    styleHint: "flux schnell look, sharp micro-detail, high clarity",
  },
  "krea-2": {
    pollinations: "flux",
    horde: ["Juggernaut XL", "ICBINP - I Can't Believe It's Not Photography"],
    styleHint: "krea artistic direction, stylized lighting, creative composition",
  },
  analog: {
    pollinations: "dreamshaper",
    horde: [
      "ICBINP - I Can't Believe It's Not Photography",
      "Realistic Vision",
      "Deliberate",
    ],
    styleHint:
      "analog film photograph, kodak portra 400, light grain, soft halation, shot on film",
  },
  "flux-klein": {
    pollinations: "klein",
    horde: ["AlbedoBase XL (SDXL)", "Dreamshaper"],
    styleHint: "flux klein compact aesthetic, soft natural tones",
  },
  "z-image": {
    pollinations: "zimage",
    horde: ["AlbedoBase XL (SDXL)", "Juggernaut XL"],
    styleHint: "z-image aesthetic, clean portrait rendering",
  },
  minimax: {
    pollinations: "flux",
    horde: ["Juggernaut XL", "AlbedoBase XL (SDXL)"],
    styleHint: "minimax cinematic frame, dramatic lighting",
  },
  "kling-nsfw": {
    pollinations: "flux",
    horde: [
      "WAI-NSFW-illustrious-SDXL",
      "AbyssOrangeMix-AfterDark",
      "Abyss OrangeMix",
      "NatViS",
    ],
    styleHint:
      "kling nsfw photoreal adult, uncensored, sensual lighting, adults 21+ only",
  },
  pony: {
    pollinations: "flux",
    horde: [
      "CyberRealistic Pony",
      "WAI-ANI-NSFW-PONYXL",
      "Prefect Pony",
      "WAI-CUTE Pony",
    ],
    styleHint:
      "score_9, score_8_up, score_7_up, pony diffusion, detailed adult character, uncensored",
  },
};

/** Video catalog ids map to image backends for poster/still pipelines. */
export const VIDEO_PROVIDER_MAP: Record<string, ProviderMapping> = {
  "skyreels-2": {
    pollinations: "flux",
    horde: ["Juggernaut XL", "AlbedoBase XL (SDXL)"],
    styleHint: "skyreels 2.0 cinematic motion still, filmic depth of field, 35mm",
  },
  "ltx-2-3": {
    pollinations: "flux",
    horde: ["AlbedoBase XL (SDXL)", "Dreamshaper"],
    styleHint: "ltx video keyframe, smooth cinematic lighting",
  },
  "wan-3": {
    pollinations: "flux",
    horde: ["Juggernaut XL", "Realistic Vision"],
    styleHint: "wan 3.0 video frame, dynamic composition",
  },
  "hunyuan-1-5": {
    pollinations: "flux",
    horde: ["AlbedoBase XL (SDXL)", "Juggernaut XL"],
    styleHint: "hunyuan video still, rich atmosphere",
  },
  "seedance-2-5": {
    pollinations: "flux",
    horde: ["Juggernaut XL", "AlbedoBase XL (SDXL)"],
    styleHint: "seedance choreography keyframe, dance energy",
  },
  "veo-3": {
    pollinations: "flux",
    horde: ["Juggernaut XL", "ICBINP - I Can't Believe It's Not Photography"],
    styleHint: "veo cinematic photoreal frame, natural motion blur hint",
  },
  "sora-2": {
    pollinations: "flux",
    horde: ["AlbedoBase XL (SDXL)", "Juggernaut XL"],
    styleHint: "sora-like epic still, wide cinematic framing",
  },
  runway: {
    pollinations: "flux",
    horde: ["Realistic Vision", "Juggernaut XL"],
    styleHint: "runway gen video still, clean commercial grade",
  },
  "kling-nsfw-video": {
    pollinations: "flux",
    horde: [
      "WAI-NSFW-illustrious-SDXL",
      "AbyssOrangeMix-AfterDark",
      "CyberRealistic Pony",
    ],
    styleHint: "kling nsfw video keyframe, uncensored adult, sensual motion",
  },
  "minimax-h3": {
    pollinations: "flux",
    horde: [
      "WAI-NSFW-illustrious-SDXL",
      "Abyss OrangeMix",
      "NatViS",
    ],
    styleHint: "minimax h3 adult video frame, dramatic body language",
  },
};

export function getMapping(
  modelId: string,
  category: "image" | "video" = "image"
): ProviderMapping {
  const table = category === "video" ? VIDEO_PROVIDER_MAP : IMAGE_PROVIDER_MAP;
  return (
    table[modelId] ||
    IMAGE_PROVIDER_MAP[modelId] || {
      horde: [],
      styleHint: "",
    }
  );
}

export function parseSize(
  ratio: string,
  res: string
): { width: number; height: number } {
  const requested = Math.min(
    768,
    Math.max(512, parseInt(res || "512", 10) || 512)
  );
  const map: Record<string, [number, number]> = {
    "1:1": [1, 1],
    "3:4": [3, 4],
    "4:3": [4, 3],
    "9:16": [9, 16],
    "16:9": [16, 9],
  };
  const [rw, rh] = map[ratio] || [1, 1];
  let width: number;
  let height: number;
  if (rw >= rh) {
    width = requested;
    height = Math.round((requested * rh) / rw);
  } else {
    height = requested;
    width = Math.round((requested * rw) / rh);
  }
  width = Math.max(512, Math.round(width / 64) * 64);
  height = Math.max(512, Math.round(height / 64) * 64);
  while (width * height > 512 * 768) {
    width = Math.max(512, width - 64);
    height = Math.max(512, height - 64);
  }
  return { width, height };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function ensureGenDir() {
  await fs.mkdir(GEN_DIR, { recursive: true });
}

export async function saveBuffer(
  buf: Buffer,
  ext: string
): Promise<{ filePath: string; publicUrl: string }> {
  await ensureGenDir();
  const id = randomUUID();
  const name = `${id}.${ext.replace(/^\./, "")}`;
  const filePath = path.join(GEN_DIR, name);
  await fs.writeFile(filePath, buf);
  return { filePath, publicUrl: `/api/generated/${name}` };
}

async function toDataUrlOrPass(url: string): Promise<string> {
  if (url.startsWith("data:")) return url;
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) return url;
    const ct = res.headers.get("content-type") || "image/webp";
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 500) return url;
    // Prefer saving to disk for gallery durability
    const ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : "jpg";
    const { publicUrl } = await saveBuffer(buf, ext);
    return publicUrl;
  } catch {
    return url;
  }
}

async function bufferFromDataUrl(dataUrl: string): Promise<Buffer | null> {
  const idx = dataUrl.indexOf("base64,");
  if (!dataUrl.startsWith("data:") || idx < 0) return null;
  return Buffer.from(dataUrl.slice(idx + 7), "base64");
}

/** @deprecated Pollinations removed from catalog generate path (watermark / mislabel). */
export async function tryPollinations(
  prompt: string,
  width: number,
  height: number,
  pollinationsModel: string
): Promise<string | null> {
  const encoded = encodeURIComponent(prompt.slice(0, 450));
  const seed = Math.floor(Math.random() * 1_000_000);
  const model = encodeURIComponent(pollinationsModel || "flux");
  const urls = [
    `https://image.pollinations.ai/prompt/${encoded}?width=${width}&height=${height}&seed=${seed}&model=${model}&nologo=true&enhance=false`,
    `https://gen.pollinations.ai/image/${encoded}?width=${width}&height=${height}&seed=${seed}&model=${model}&nologo=true`,
  ];
  for (const url of urls) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, {
          headers: {
            Accept: "image/*",
            "User-Agent": "Mozilla/5.0 KINO/1.0",
            Referer: "https://pollinations.ai/",
          },
          cache: "no-store",
          signal: AbortSignal.timeout(42000),
        });
        if (res.status === 429) {
          await sleep(1500 + attempt * 1500);
          continue;
        }
        if (!res.ok) break;
        const ct = res.headers.get("content-type") || "";
        if (!ct.includes("image")) break;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < 2000) break;
        const ext = ct.includes("png") ? "png" : "jpg";
        const { publicUrl } = await saveBuffer(buf, ext);
        return publicUrl;
      } catch {
        /* try next */
      }
    }
  }
  return null;
}

export async function generateViaHorde(opts: {
  prompt: string;
  width: number;
  height: number;
  nsfw: boolean;
  models: string[];
  sourceImage?: string | null;
  strength?: number;
}): Promise<string> {
  const negative =
    "child, children, kid, kids, toddler, infant, baby, minor, underage, teen, teenager, loli, shota, young girl, young boy, preteen, under 18";

  const body: Record<string, unknown> = {
    prompt: `${opts.prompt} ### ${negative}`,
    params: {
      width: opts.width,
      height: opts.height,
      steps: opts.sourceImage ? 12 : 10,
      cfg_scale: 6.5,
      sampler_name: "k_euler_a",
      n: 1,
      denoising_strength: opts.sourceImage ? opts.strength ?? 0.55 : undefined,
    },
    nsfw: opts.nsfw,
    censor_nsfw: false,
    models: opts.models.length ? opts.models : [],
    r2: true,
    shared: false,
    slow_workers: true,
  };

  if (opts.sourceImage) {
    let b64 = opts.sourceImage;
    if (b64.startsWith("data:")) {
      b64 = b64.split(",")[1] || "";
    }
    if (b64) {
      body.source_image = b64;
      body.source_processing = "img2img";
    }
  }

  const submitRes = await fetch(`${HORDE}/generate/async`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: "0000000000",
      "Client-Agent": "KINO:1.0:kino-studio",
    },
    body: JSON.stringify(body),
  });

  if (!submitRes.ok) {
    const errText = await submitRes.text();
    throw new Error(`Horde submit failed: ${submitRes.status} ${errText.slice(0, 200)}`);
  }

  const { id } = (await submitRes.json()) as { id: string };
  if (!id) throw new Error("Horde did not return a job id");

  const deadline = Date.now() + 85000;
  while (Date.now() < deadline) {
    await sleep(2000);
    const statusRes = await fetch(`${HORDE}/generate/status/${id}`, {
      cache: "no-store",
    });
    if (!statusRes.ok) continue;
    const status = (await statusRes.json()) as {
      done?: boolean;
      faulted?: boolean;
      generations?: { img?: string }[];
    };
    if (status.faulted) throw new Error("Horde job faulted");
    if (status.done && status.generations?.[0]?.img) {
      return status.generations[0].img;
    }
  }
  throw new Error("Horde generation timed out — try again in a moment");
}


/** Shrink a data-URL image via ffmpeg for Horde img2img payload size. */
export async function shrinkDataUrl(
  dataUrl: string,
  maxSide = 768
): Promise<string> {
  if (!dataUrl.startsWith("data:")) return dataUrl;
  const buf = await bufferFromDataUrl(dataUrl);
  if (!buf) return dataUrl;
  if (buf.length < 350_000) return dataUrl;
  await ensureGenDir();
  const inPath = path.join(GEN_DIR, `${randomUUID()}_in.jpg`);
  const outPath = path.join(GEN_DIR, `${randomUUID()}_out.jpg`);
  await fs.writeFile(inPath, buf);
  try {
    await runFfmpeg([
      "-i",
      inPath,
      "-vf",
      `scale=${maxSide}:${maxSide}:force_original_aspect_ratio=decrease`,
      "-q:v",
      "4",
      outPath,
    ]);
    const out = await fs.readFile(outPath);
    return `data:image/jpeg;base64,${out.toString("base64")}`;
  } catch {
    return dataUrl;
  } finally {
    await fs.unlink(inPath).catch(() => {});
    await fs.unlink(outPath).catch(() => {});
  }
}

export async function generateStill(opts: {
  prompt: string;
  modelId: string;
  mode: "sfw" | "nsfw";
  ratio?: string;
  resolution?: string;
  category?: "image" | "video";
  sourceImage?: string | null;
}): Promise<{
  url: string;
  provider: string;
  mapping: ProviderMapping;
  approx: boolean;
  providerNote?: string;
}> {
  const mapping = getMapping(opts.modelId, opts.category || "image");
  const { width, height } = parseSize(
    opts.ratio || "3:4",
    opts.resolution || "512"
  );

  const styled = [opts.prompt, mapping.styleHint].filter(Boolean).join(", ");
  const sourceImage = opts.sourceImage
    ? await shrinkDataUrl(opts.sourceImage)
    : null;

  const errors: string[] = [];

  // 1) WaveSpeed first when key present + model mapped + text-only
  if (!sourceImage && hasWaveSpeedKey()) {
    const wsMap = resolveWaveSpeedMapping(
      opts.modelId,
      opts.category || "image"
    );
    if (wsMap) {
      try {
        const { url } = await generateViaWaveSpeed({
          prompt: styled,
          modelId: opts.modelId,
          width,
          height,
          ratio: opts.ratio || "3:4",
          category: opts.category || "image",
        });
        console.log("[kino] image provider: wavespeed", wsMap.endpoint);
        return {
          url,
          provider: "wavespeed",
          mapping,
          approx: false,
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "wavespeed failed";
        console.log("[kino] wavespeed failed — falling through to Horde:", msg);
        errors.push(msg);
      }
    } else {
      console.log(
        `[kino] no WaveSpeed mapping for ${opts.modelId} — AI Horde (approx)`
      );
    }
  }

  // 2) Cloudflare Workers AI (Flux Schnell primary; SDXL bonus for other SFW)
  if (!sourceImage) {
    syncCloudflareSecretsFromCard();
    if (hasCloudflareCredentials()) {
      const cfMap = resolveCloudflareMapping(opts.modelId);
      if (cfMap) {
        try {
          const { url, model: cfModel, kind } = await generateViaCloudflare({
            prompt: styled,
            modelId: opts.modelId,
            width,
            height,
          });
          console.log("[kino] image provider: cloudflare", cfModel);
          return {
            url,
            provider: "cloudflare",
            mapping,
            approx: false,
            providerNote:
              kind === "flux"
                ? "via Cloudflare Workers AI"
                : "via Cloudflare Workers AI (SDXL)",
          };
        } catch (e) {
          const msg = e instanceof Error ? e.message : "cloudflare failed";
          console.log(
            "[kino] cloudflare failed — falling through:",
            msg
          );
          errors.push(msg);
        }
      }
    }
  }

  // 3) Together.ai for Flux Schnell when key present + mapped + text-only
  if (!sourceImage && hasTogetherKey()) {
    const tgMap = resolveTogetherMapping(opts.modelId);
    if (tgMap) {
      try {
        const { url } = await generateViaTogether({
          prompt: styled,
          modelId: opts.modelId,
          width,
          height,
        });
        console.log("[kino] image provider: together", tgMap.model);
        return {
          url,
          provider: "together",
          mapping,
          approx: false,
          providerNote: "via Together FLUX.1-schnell",
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "together failed";
        console.log("[kino] together failed — falling through to Horde:", msg);
        errors.push(msg);
      }
    }
  }

  // 4) AI Horde only (never Pollinations). Always mark approx when used.
  const hordeModels =
    opts.mode === "nsfw" || sourceImage ? mapping.horde : [];

  const approxNote = "via AI Horde (approx)";

  try {
    const remote = await generateViaHorde({
      prompt: styled,
      width,
      height,
      nsfw: opts.mode === "nsfw",
      models: hordeModels,
      sourceImage,
    });
    const url = await toDataUrlOrPass(remote);
    console.log("[kino] image provider: horde (approx)");
    return {
      url,
      provider: "horde",
      mapping,
      approx: true,
      providerNote: approxNote,
    };
  } catch (e) {
    errors.push(e instanceof Error ? e.message : "horde failed");
  }

  // 5) Last resort: Horde with any worker
  if (hordeModels.length) {
    try {
      const remote = await generateViaHorde({
        prompt: styled,
        width,
        height,
        nsfw: opts.mode === "nsfw",
        models: [],
        sourceImage,
      });
      const url = await toDataUrlOrPass(remote);
      console.log("[kino] image provider: horde-any (approx)");
      return {
        url,
        provider: "horde",
        mapping,
        approx: true,
        providerNote: approxNote,
      };
    } catch (e) {
      errors.push(e instanceof Error ? e.message : "horde-any failed");
    }
  }

  throw new Error(errors.join(" · ") || "All image providers failed");
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", ["-y", ...args], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let err = "";
    p.stderr.on("data", (d) => {
      err += d.toString();
    });
    p.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg failed (${code}): ${err.slice(-400)}`));
    });
  });
}

async function materializeImage(url: string): Promise<string> {
  await ensureGenDir();
  if (url.startsWith("/api/generated/")) {
    return path.join(process.cwd(), "public", "generated", path.basename(url));
  }
  if (url.startsWith("/generated/")) {
    return path.join(process.cwd(), "public", "generated", path.basename(url));
  }
  if (url.startsWith("data:")) {
    const buf = await bufferFromDataUrl(url);
    if (!buf) throw new Error("Invalid data URL");
    const { filePath } = await saveBuffer(buf, "jpg");
    return filePath;
  }
  if (url.startsWith("http")) {
    const res = await fetch(url, { signal: AbortSignal.timeout(25000) });
    const buf = Buffer.from(await res.arrayBuffer());
    const { filePath } = await saveBuffer(buf, "jpg");
    return filePath;
  }
  throw new Error("Unsupported image url");
}

/** Ken Burns style webm from a still — playable result with duration. */
export async function stillToVideo(
  imageUrl: string,
  durationSec: number,
  aspect: "16:9" | "9:16" | "1:1" = "16:9"
): Promise<{ videoUrl: string; posterUrl: string; duration: number }> {
  const duration = Math.max(3, Math.min(60, Math.round(durationSec)));
  const stillPath = await materializeImage(imageUrl);
  const posterUrl = imageUrl.startsWith("/")
    ? imageUrl
    : (await saveBuffer(await fs.readFile(stillPath), "jpg")).publicUrl;

  const [vw, vh] =
    aspect === "9:16" ? [720, 1280] : aspect === "1:1" ? [720, 720] : [1280, 720];
  const frames = duration * 25;
  const outName = `${randomUUID()}.webm`;
  const outPath = path.join(GEN_DIR, outName);

  // zoompan Ken Burns
  const vf = `scale=${vw * 2}:${vh * 2}:force_original_aspect_ratio=increase,crop=${vw * 2}:${vh * 2},zoompan=z='min(zoom+0.0012,1.25)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${vw}x${vh}:fps=25`;

  try {
    await runFfmpeg([
      "-loop",
      "1",
      "-i",
      stillPath,
      "-vf",
      vf,
      "-t",
      String(duration),
      "-c:v",
      "libvpx-vp9",
      "-b:v",
      "1M",
      "-pix_fmt",
      "yuv420p",
      "-an",
      outPath,
    ]);
  } catch {
    // Fallback: static framed mp4/webm without zoompan
    await runFfmpeg([
      "-loop",
      "1",
      "-i",
      stillPath,
      "-vf",
      `scale=${vw}:${vh}:force_original_aspect_ratio=decrease,pad=${vw}:${vh}:(ow-iw)/2:(oh-ih)/2`,
      "-t",
      String(duration),
      "-c:v",
      "libvpx",
      "-b:v",
      "800k",
      "-pix_fmt",
      "yuv420p",
      "-an",
      outPath,
    ]);
  }

  return {
    videoUrl: `/api/generated/${outName}`,
    posterUrl,
    duration,
  };
}

/** Simple synthetic music bed (oscillators via ffmpeg) + slideshow video. */
export async function makeMusicVideo(opts: {
  imageUrls: string[];
  duration: number;
  bed: string;
  aspect: "16:9" | "9:16";
  genBed: boolean;
}): Promise<{ videoUrl: string; posterUrl: string; duration: number; audio: boolean }> {
  const duration = Math.max(15, Math.min(600, Math.round(opts.duration)));
  const paths: string[] = [];
  for (const u of opts.imageUrls) {
    paths.push(await materializeImage(u));
  }
  if (!paths.length) throw new Error("No frames for music video");

  const [vw, vh] = opts.aspect === "9:16" ? [720, 1280] : [1280, 720];
  const per = Math.max(2, duration / paths.length);
  const listFile = path.join(GEN_DIR, `${randomUUID()}.txt`);
  const lines = paths
    .map((p) => `file '${p.replace(/'/g, "'\\''")}'\nduration ${per}`)
    .join("\n");
  // last frame needs a trailing file entry for concat demuxer
  await fs.writeFile(
    listFile,
    lines + `\nfile '${paths[paths.length - 1].replace(/'/g, "'\\''")}'\n`
  );

  const silentVideo = path.join(GEN_DIR, `${randomUUID()}_silent.webm`);
  await runFfmpeg([
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listFile,
    "-vf",
    `scale=${vw}:${vh}:force_original_aspect_ratio=decrease,pad=${vw}:${vh}:(ow-iw)/2:(oh-ih)/2:color=black,fps=24`,
    "-t",
    String(duration),
    "-c:v",
    "libvpx",
    "-b:v",
    "1M",
    "-pix_fmt",
    "yuv420p",
    "-an",
    silentVideo,
  ]);

  const outName = `${randomUUID()}.webm`;
  const outPath = path.join(GEN_DIR, outName);
  let audio = false;

  if (opts.genBed) {
    const freqs: Record<string, [number, number]> = {
      pop: [220, 330],
      "r&b": [110, 165],
      rap: [55, 90],
      rave: [440, 880],
      score: [196, 294],
    };
    const [f1, f2] = freqs[opts.bed] || freqs.pop;
    const audioPath = path.join(GEN_DIR, `${randomUUID()}.wav`);
    await runFfmpeg([
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=${f1}:duration=${duration}`,
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=${f2}:duration=${duration}`,
      "-filter_complex",
      "[0][1]amix=inputs=2:duration=longest,volume=0.25",
      audioPath,
    ]);
    await runFfmpeg([
      "-i",
      silentVideo,
      "-i",
      audioPath,
      "-c:v",
      "copy",
      "-c:a",
      "libopus",
      "-b:a",
      "96k",
      "-shortest",
      outPath,
    ]);
    audio = true;
    await fs.unlink(audioPath).catch(() => {});
  } else {
    await fs.rename(silentVideo, outPath);
  }

  await fs.unlink(listFile).catch(() => {});
  if (opts.genBed) await fs.unlink(silentVideo).catch(() => {});

  const posterUrl = opts.imageUrls[0].startsWith("/")
    ? opts.imageUrls[0]
    : (await saveBuffer(await fs.readFile(paths[0]), "jpg")).publicUrl;

  return {
    videoUrl: `/api/generated/${outName}`,
    posterUrl,
    duration,
    audio,
  };
}
