"use client";

import { useEffect, useState } from "react";
import Header from "@/components/Header";
import GenerateBar from "@/components/GenerateBar";
import PromptField from "@/components/PromptField";
import ModelSelect from "@/components/ModelSelect";
import { useStudio } from "@/context/StudioContext";
import {
  DEFAULT_VIDEO_MODEL,
  VIDEO_MODELS,
  filterModels,
  getModelName,
  resolveModelId,
} from "@/lib/models";
import { containsUnderageContent, safetyRejectMessage } from "@/lib/safety";
import { VIDEO_STILL_KEY } from "@/components/ImageLightbox";

export default function VideoPage() {
  const { mode } = useStudio();
  const [prompt, setPrompt] = useState(
    "Cinematic tracking shot of an adult woman 21+ walking through neon rain, shallow depth of field, 35mm film"
  );
  const [modelId, setModelId] = useState(DEFAULT_VIDEO_MODEL.sfw);
  const [duration, setDuration] = useState(10);
  const [firstFrame, setFirstFrame] = useState<string | null>(null);
  const [lastFrame, setLastFrame] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [engineBadge, setEngineBadge] = useState<string | null>(null);

  const models = filterModels(VIDEO_MODELS, mode);

  useEffect(() => {
    setModelId((cur) =>
      resolveModelId(VIDEO_MODELS, cur, mode, DEFAULT_VIDEO_MODEL)
    );
  }, [mode]);

  // Prefill first frame (+ optional prompt) from Image lightbox "Generera video"
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = sessionStorage.getItem(VIDEO_STILL_KEY);
        if (!raw) return;
        sessionStorage.removeItem(VIDEO_STILL_KEY);
        const data = JSON.parse(raw) as { url?: string; prompt?: string };
        if (data.prompt && data.prompt.trim()) {
          setPrompt((cur) =>
            cur.startsWith("Cinematic tracking") ? data.prompt! : cur
          );
        }
        if (!data.url) return;
        // Prefer data URL so Horde img2img accepts it (same as file upload)
        let frame = data.url;
        if (data.url.startsWith("/") || data.url.startsWith("http")) {
          const res = await fetch(data.url);
          const blob = await res.blob();
          frame = await new Promise<string>((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result));
            r.onerror = () => reject(r.error);
            r.readAsDataURL(blob);
          });
        }
        if (!cancelled) {
          setFirstFrame(frame);
          setStatus("First frame from gallery — ready to generate");
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const readFile = (
    file: File | null,
    setter: (v: string | null) => void
  ) => {
    if (!file) {
      setter(null);
      return;
    }
    const r = new FileReader();
    r.onload = () => setter(String(r.result));
    r.readAsDataURL(file);
  };

  const generate = async () => {
    setError(null);
    setResultUrl(null);
    setPosterUrl(null);
    if (containsUnderageContent(prompt)) {
      setError(safetyRejectMessage());
      return;
    }
    setLoading(true);
    setProgress(8);
    const name = getModelName(VIDEO_MODELS, modelId);
    setStatus(`Queuing ${name}…`);
    setEngineBadge(name);

    const tick = window.setInterval(() => {
      setProgress((p) => (p < 90 ? p + 3 : p));
    }, 1200);

    try {
      setStatus(`Running ${name}…`);
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studio: "video",
          prompt,
          model: modelId,
          mode,
          duration,
          ratio: "16:9",
          refs: [firstFrame, lastFrame].filter(Boolean),
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || "Video generation failed");
        setStatus(null);
        return;
      }
      setProgress(100);
      setResultUrl(data.url);
      setPosterUrl(data.poster || null);
      setEngineBadge(data.engine || data.model || name);
      setDuration(data.duration || duration);
      setStatus(`Ready · ${data.duration || duration}s · ${data.engine || name}`);
    } catch {
      setError("Network error. Check connection and try again.");
      setStatus(null);
    } finally {
      window.clearInterval(tick);
      setLoading(false);
    }
  };

  const extend = () => {
    setDuration((d) => {
      const next = Math.min(60, d + 15);
      setStatus(`Extended +15s → ${next}s`);
      return next;
    });
  };

  return (
    <>
      <Header title="Video" />
      <main className="mx-auto max-w-lg px-4 pt-4 pb-36">
        <PromptField value={prompt} onChange={setPrompt} label="Text" />

        <div className="grid grid-cols-2 gap-3 mt-4">
          {(
            [
              ["First frame", firstFrame, setFirstFrame],
              ["Last frame", lastFrame, setLastFrame],
            ] as const
          ).map(([label, preview, setter]) => (
            <div key={label}>
              <span className="text-xs text-white/40 uppercase tracking-wider mb-1.5 block">
                {label}
              </span>
              <label className="flex items-center justify-center min-h-[100px] rounded-2xl border border-dashed border-white/15 bg-white/[0.03] cursor-pointer overflow-hidden">
                {preview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={preview} alt={label} className="max-h-28 object-cover w-full" />
                ) : (
                  <span className="text-xs text-white/40 px-2 text-center">
                    Optional upload
                  </span>
                )}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) =>
                    readFile(e.target.files?.[0] || null, setter)
                  }
                />
              </label>
            </div>
          ))}
        </div>

        <div className="mt-4 space-y-3">
          <ModelSelect models={models} value={modelId} onChange={setModelId} />
          <label className="block">
            <span className="text-xs text-white/40 uppercase tracking-wider mb-1.5 block">
              Duration · {duration}s
            </span>
            <input
              type="range"
              min={5}
              max={60}
              step={5}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="w-full accent-white"
            />
            <div className="flex justify-between text-[10px] text-white/30 mt-1">
              <span>5s</span>
              <span>60s</span>
            </div>
          </label>
          <button
            type="button"
            onClick={extend}
            className="w-full min-h-[44px] rounded-full border border-white/15 text-sm text-white/80"
          >
            Extend +15s
          </button>
        </div>

        {error && (
          <p className="mt-4 text-sm text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-2xl px-4 py-3">
            {error}
          </p>
        )}

        {(loading || status || resultUrl) && (
          <div className="mt-6 rounded-3xl border border-white/10 bg-kino-card p-4">
            <div className="h-2 rounded-full bg-white/10 overflow-hidden mb-3">
              <div
                className="h-full bg-white transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-sm text-white/60">{status}</p>
            {resultUrl && (
              <div className="mt-4 aspect-video rounded-2xl overflow-hidden border border-white/10 bg-black relative">
                <video
                  key={resultUrl}
                  src={resultUrl}
                  poster={posterUrl || undefined}
                  controls
                  playsInline
                  autoPlay
                  loop
                  className="w-full h-full object-contain"
                />
                {engineBadge && (
                  <span className="absolute top-2 left-2 text-[10px] px-2 py-1 rounded-full bg-black/70 border border-white/15 text-white/90">
                    {engineBadge}
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        <p className="mt-6 text-xs text-white/30 leading-relaxed">
          Default SFW model is SkyReels 2.0. NSFW mode switches the catalog to
          Kling NSFW / MiniMax H3.
        </p>
      </main>
      <GenerateBar
        onGenerate={generate}
        loading={loading}
        label="Generate video"
        hint={`${getModelName(VIDEO_MODELS, modelId)} · ${duration}s · ${mode.toUpperCase()}`}
      />
    </>
  );
}
