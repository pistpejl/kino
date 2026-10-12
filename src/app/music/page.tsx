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

const BEDS = ["pop", "r&b", "rap", "rave", "score"] as const;

export default function MusicPage() {
  const { mode } = useStudio();
  const [prompt, setPrompt] = useState(
    "Adult performer 21+ lip-sync music video, cinematic lighting, locked face"
  );
  const [modelId, setModelId] = useState(DEFAULT_VIDEO_MODEL.sfw);
  const [bed, setBed] = useState<(typeof BEDS)[number]>("pop");
  const [genBed, setGenBed] = useState(true);
  const [trackName, setTrackName] = useState<string | null>(null);
  const [lockFace, setLockFace] = useState(true);
  const [duration, setDuration] = useState(60);
  const [aspect, setAspect] = useState<"16:9" | "9:16">("9:16");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
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

  const onTrack = (file: File | null) => {
    if (!file) {
      setTrackName(null);
      return;
    }
    setTrackName(file.name);
    setGenBed(false);
  };

  const generate = async () => {
    setError(null);
    setResultUrl(null);
    if (containsUnderageContent(prompt)) {
      setError(safetyRejectMessage());
      return;
    }
    setLoading(true);
    setProgress(5);
    const name = getModelName(VIDEO_MODELS, modelId);
    setEngineBadge(name);
    const mins = Math.floor(duration / 60);
    const secs = duration % 60;
    setStatus(
      genBed
        ? `Generating ${bed} bed + ${name} visuals…`
        : `Analyzing ${trackName || "track"} · ${name}…`
    );

    const tick = window.setInterval(() => {
      setProgress((p) => (p < 88 ? p + 2 : p));
    }, 1500);

    try {
      if (lockFace) setStatus(`Locking face · rendering ${aspect}…`);
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studio: "music",
          prompt: lockFace
            ? `${prompt}. locked face identity across shots`
            : prompt,
          model: modelId,
          mode,
          duration,
          aspect,
          bed,
          genBed,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || "Music video generation failed");
        setStatus(null);
        return;
      }
      setProgress(100);
      setResultUrl(data.url);
      setPosterUrl(data.poster || null);
      setEngineBadge(data.engine || data.model || name);
      setStatus(
        `Ready · ${mins}m${secs.toString().padStart(2, "0")}s · ${data.engine || name} · ${bed}`
      );
    } catch {
      setError("Network error. Check connection and try again.");
      setStatus(null);
    } finally {
      window.clearInterval(tick);
      setLoading(false);
    }
  };

  return (
    <>
      <Header title="Music" />
      <main className="mx-auto max-w-lg px-4 pt-4 pb-36">
        <PromptField value={prompt} onChange={setPrompt} label="Visual prompt" />

        <div className="mt-4">
          <ModelSelect
            models={models}
            value={modelId}
            onChange={setModelId}
            label="Look / model"
          />
        </div>

        <div className="mt-4">
          <span className="text-xs text-white/40 uppercase tracking-wider mb-1.5 block">
            Audio
          </span>
          <label className="flex flex-col items-center justify-center min-h-[88px] rounded-2xl border border-dashed border-white/15 bg-white/[0.03] cursor-pointer px-4">
            <span className="text-sm text-white/50">
              {trackName || "Upload mp3 / wav"}
            </span>
            <input
              type="file"
              accept="audio/mpeg,audio/wav,audio/*,.mp3,.wav"
              className="hidden"
              onChange={(e) => onTrack(e.target.files?.[0] || null)}
            />
          </label>
        </div>

        <label className="mt-4 flex items-center gap-3 min-h-[44px]">
          <input
            type="checkbox"
            checked={genBed}
            onChange={(e) => setGenBed(e.target.checked)}
            className="w-5 h-5 accent-white"
          />
          <span className="text-sm text-white/70">Generate music bed</span>
        </label>

        {genBed && (
          <div className="flex flex-wrap gap-2 mt-2">
            {BEDS.map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setBed(b)}
                className={`kino-pill capitalize min-h-[36px] ${
                  bed === b ? "bg-white/15 text-white border-white/30" : ""
                }`}
              >
                {b}
              </button>
            ))}
          </div>
        )}

        <label className="mt-4 flex items-center gap-3 min-h-[44px]">
          <input
            type="checkbox"
            checked={lockFace}
            onChange={(e) => setLockFace(e.target.checked)}
            className="w-5 h-5 accent-white"
          />
          <span className="text-sm text-white/70">Lock face</span>
        </label>

        <label className="block mt-4">
          <span className="text-xs text-white/40 uppercase tracking-wider mb-1.5 block">
            Duration · {Math.floor(duration / 60)}m{" "}
            {(duration % 60).toString().padStart(2, "0")}s
          </span>
          <input
            type="range"
            min={15}
            max={600}
            step={15}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className="w-full accent-white"
          />
          <div className="flex justify-between text-[10px] text-white/30 mt-1">
            <span>15s</span>
            <span>10 min</span>
          </div>
        </label>

        <div className="flex gap-2 mt-4">
          {(["16:9", "9:16"] as const).map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setAspect(a)}
              className={`flex-1 min-h-[44px] rounded-full text-sm border ${
                aspect === a
                  ? "bg-white text-black border-white"
                  : "border-white/15 text-white/70"
              }`}
            >
              {a}
            </button>
          ))}
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
                className="h-full bg-white transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-sm text-white/60">{status}</p>
            {resultUrl && (
              <div
                className={`mt-4 rounded-2xl overflow-hidden border border-white/10 bg-black relative ${
                  aspect === "9:16"
                    ? "aspect-[9/16] max-h-96 mx-auto w-48"
                    : "aspect-video"
                }`}
              >
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
                  <span className="absolute top-2 left-2 text-[10px] px-2 py-1 rounded-full bg-black/70 border border-white/15">
                    {engineBadge}
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </main>
      <GenerateBar
        onGenerate={generate}
        loading={loading}
        label="Generate music video"
        hint={`${getModelName(VIDEO_MODELS, modelId)} · ${aspect} · ${duration}s · ${mode.toUpperCase()}`}
      />
    </>
  );
}
