import { NextRequest, NextResponse } from "next/server";
import { containsUnderageContent, safetyRejectMessage } from "@/lib/safety";
import {
  getModelName,
  IMAGE_MODELS,
  NSFW_DEFAULT_PROMPT,
  SFW_DEFAULT_PROMPT,
  VIDEO_MODELS,
} from "@/lib/models";
import {
  generateStill,
  makeMusicVideo,
  stillToVideo,
} from "@/lib/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

type Studio = "image" | "video" | "music" | "edit";

function catalogName(modelId: string, studio: Studio): string {
  if (studio === "video" || studio === "music") {
    return getModelName(VIDEO_MODELS, modelId) !== modelId
      ? getModelName(VIDEO_MODELS, modelId)
      : getModelName(IMAGE_MODELS, modelId);
  }
  return getModelName(IMAGE_MODELS, modelId);
}

function editPromptForTool(
  tool: string,
  prompt: string,
  mode: string
): string {
  const base = prompt.trim();
  switch (tool) {
    case "faceswap":
      return `${base}. faceswap edit: preserve identity from reference, seamless face blend, photoreal adult 21+`;
    case "outfit":
      return `${base}. outfit change edit guided by reference, keep same person adult 21+, new wardrobe`;
    case "nude":
      return mode === "nsfw"
        ? `${base}. tasteful uncensored nude restyle of adult 21+, photoreal, from reference`
        : base;
    case "restyle":
    default:
      return `${base}. restyle edit matching the reference subject, photoreal adult 21+`;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const studio: Studio = (["image", "video", "music", "edit"].includes(
      body.studio
    )
      ? body.studio
      : "image") as Studio;

    let prompt: string = (body.prompt || "").trim();
    const modelId: string =
      body.model ||
      (studio === "video" || studio === "music" ? "skyreels-2" : "seedream");
    const mode: "sfw" | "nsfw" = body.mode === "nsfw" ? "nsfw" : "sfw";
    const ratio: string = body.ratio || (studio === "video" ? "16:9" : "3:4");
    const resolution: string = body.resolution || "512";
    const duration: number = Number(body.duration) || 10;
    const tool: string = body.tool || "restyle";
    const refs: string[] = Array.isArray(body.refs)
      ? body.refs.filter((r: unknown) => typeof r === "string" && r)
      : body.reference
        ? [String(body.reference)]
        : [];
    const bed: string = body.bed || "pop";
    const genBed: boolean = body.genBed !== false;
    const aspect: "16:9" | "9:16" =
      body.aspect === "9:16" ? "9:16" : "16:9";

    if (!prompt) {
      prompt = mode === "nsfw" ? NSFW_DEFAULT_PROMPT : SFW_DEFAULT_PROMPT;
    }

    if (containsUnderageContent(prompt)) {
      return NextResponse.json(
        { error: safetyRejectMessage() },
        { status: 400 }
      );
    }

    if (tool === "nude" && mode !== "nsfw") {
      return NextResponse.json(
        { error: "Nude edit is only available in NSFW mode." },
        { status: 400 }
      );
    }

    const safetyPrefix =
      mode === "nsfw"
        ? "photoreal adult woman 21+ years old, "
        : "photoreal adult person 21+ years old, ";

    const preferred = catalogName(modelId, studio);
    const honestEngine = (approx: boolean, provider?: string) =>
      approx || provider === "horde"
        ? `AI Horde (approx · wanted ${preferred})`
        : preferred;

    // ---------- IMAGE ----------
    if (studio === "image") {
      const fullPrompt = safetyPrefix + prompt;
      const still = await generateStill({
        prompt: fullPrompt,
        modelId,
        mode,
        ratio,
        resolution,
        category: "image",
        sourceImage: refs[0] || null,
      });
      const engine = honestEngine(still.approx, still.provider);

      return NextResponse.json({
        ok: true,
        studio,
        url: still.url,
        type: "image",
        engine,
        model: engine,
        preferredModel: preferred,
        modelId,
        prompt,
        provider: still.provider,
        approx: still.approx,
        providerNote: still.providerNote,
      });
    }

    // ---------- EDIT ----------
    if (studio === "edit") {
      if (!refs.length) {
        return NextResponse.json(
          { error: "Add at least one reference image." },
          { status: 400 }
        );
      }
      const editPrompt = safetyPrefix + editPromptForTool(tool, prompt, mode);
      const still = await generateStill({
        prompt: editPrompt,
        modelId: mode === "nsfw" ? "kling-nsfw" : "seedream",
        mode,
        ratio: "3:4",
        resolution,
        category: "image",
        sourceImage: refs[0],
      });

      const engine = honestEngine(still.approx, still.provider);
      return NextResponse.json({
        ok: true,
        studio,
        url: still.url,
        type: "image",
        engine,
        model: engine,
        preferredModel: preferred,
        modelId,
        tool,
        prompt,
        provider: still.provider,
        approx: still.approx,
        providerNote: still.providerNote,
      });
    }

    // ---------- VIDEO ----------
    if (studio === "video") {
      const fullPrompt =
        safetyPrefix +
        prompt +
        ", cinematic video keyframe, motion photography";
      const still = await generateStill({
        prompt: fullPrompt,
        modelId,
        mode,
        ratio: ratio === "9:16" ? "9:16" : "16:9",
        resolution,
        category: "video",
        sourceImage: refs[0] || null,
      });

      const aspectVid: "16:9" | "9:16" =
        ratio === "9:16" ? "9:16" : "16:9";
      const clip = await stillToVideo(still.url, duration, aspectVid);

      const engine = honestEngine(still.approx, still.provider);
      return NextResponse.json({
        ok: true,
        studio,
        url: clip.videoUrl,
        poster: clip.posterUrl,
        type: "video",
        duration: clip.duration,
        engine,
        model: engine,
        preferredModel: preferred,
        modelId,
        prompt,
        provider: still.provider,
        approx: still.approx,
        providerNote: still.providerNote,
      });
    }

    // ---------- MUSIC ----------
    if (studio === "music") {
      const frameCount = duration > 90 ? 2 : 1;
      const frames: string[] = [];
      let provider = "horde";
      let approx = true;
      let providerNote: string | undefined = "via AI Horde (approx)";

      for (let i = 0; i < frameCount; i++) {
        const framePrompt =
          safetyPrefix +
          prompt +
          `, music video still ${i + 1} of ${frameCount}, beat-synced cinematic frame, ${bed} energy`;
        const still = await generateStill({
          prompt: framePrompt,
          modelId,
          mode,
          ratio: aspect === "9:16" ? "9:16" : "16:9",
          resolution: "512",
          category: "video",
        });
        frames.push(still.url);
        provider = still.provider;
        approx = still.approx;
        providerNote = still.providerNote;
      }

      const mv = await makeMusicVideo({
        imageUrls: frames,
        duration,
        bed,
        aspect,
        genBed,
      });

      return NextResponse.json({
        ok: true,
        studio,
        url: mv.videoUrl,
        poster: mv.posterUrl,
        frames,
        type: "video",
        duration: mv.duration,
        audio: mv.audio,
        engine: honestEngine(approx, provider),
        model: honestEngine(approx, provider),
        preferredModel: preferred,
        modelId,
        bed,
        prompt,
        provider,
        approx,
        providerNote,
      });
    }

    return NextResponse.json({ error: "Unknown studio" }, { status: 400 });
  } catch (err) {
    console.error("generate error", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? `Generation failed: ${err.message}`
            : "Generation failed. Try again.",
      },
      { status: 500 }
    );
  }
}
