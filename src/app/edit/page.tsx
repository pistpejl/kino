"use client";

import { useState } from "react";
import Header from "@/components/Header";
import GenerateBar from "@/components/GenerateBar";
import PromptField from "@/components/PromptField";
import { useStudio } from "@/context/StudioContext";
import { containsUnderageContent, safetyRejectMessage } from "@/lib/safety";

type EditTool = "faceswap" | "outfit" | "restyle" | "nude";

export default function EditPage() {
  const { mode } = useStudio();
  const [refs, setRefs] = useState<(string | null)[]>(Array(6).fill(null));
  const [tool, setTool] = useState<EditTool>("restyle");
  const [prompt, setPrompt] = useState("Restyle as golden-hour film still, adult 21+");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [engineBadge, setEngineBadge] = useState<string | null>(null);

  const tools: { id: EditTool; label: string; nsfwOnly?: boolean }[] = [
    { id: "faceswap", label: "Faceswap" },
    { id: "outfit", label: "Outfit" },
    { id: "restyle", label: "Restyle" },
    { id: "nude", label: "Nude", nsfwOnly: true },
  ];

  const setRefAt = (idx: number, file: File | null) => {
    if (!file) {
      setRefs((prev) => {
        const next = [...prev];
        next[idx] = null;
        return next;
      });
      return;
    }
    const r = new FileReader();
    r.onload = () =>
      setRefs((prev) => {
        const next = [...prev];
        next[idx] = String(r.result);
        return next;
      });
    r.readAsDataURL(file);
  };

  const generate = async () => {
    setError(null);
    setResult(null);
    if (tool === "nude" && mode !== "nsfw") {
      setError("Nude edit is only available in NSFW mode.");
      return;
    }
    if (containsUnderageContent(prompt)) {
      setError(safetyRejectMessage());
      return;
    }
    if (!refs.some(Boolean)) {
      setError("Add at least one reference image.");
      return;
    }
    setLoading(true);
    setProgress(10);
    setStatus(`Reading references…`);
    const tick = window.setInterval(() => {
      setProgress((p) => (p < 90 ? p + 4 : p));
    }, 1000);

    try {
      setStatus(`Applying ${tool}…`);
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studio: "edit",
          prompt,
          tool,
          mode,
          model: mode === "nsfw" ? "kling-nsfw" : "seedream",
          refs: refs.filter(Boolean),
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || "Edit failed");
        setStatus(null);
        return;
      }
      setProgress(100);
      setResult(data.url);
      setEngineBadge(data.engine || data.model || tool);
      setStatus(`Edit complete · ${data.engine || tool}`);
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
      <Header title="Edit" />
      <main className="mx-auto max-w-lg px-4 pt-4 pb-36">
        <span className="text-xs text-white/40 uppercase tracking-wider mb-2 block">
          References · up to 6
        </span>
        <div className="grid grid-cols-3 gap-2">
          {refs.map((preview, i) => (
            <label
              key={i}
              className="aspect-square rounded-2xl border border-dashed border-white/15 bg-white/[0.03] flex items-center justify-center cursor-pointer overflow-hidden"
            >
              {preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview} alt={`Ref ${i + 1}`} className="w-full h-full object-cover" />
              ) : (
                <span className="text-white/30 text-lg">+</span>
              )}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => setRefAt(i, e.target.files?.[0] || null)}
              />
            </label>
          ))}
        </div>

        <div className="flex flex-wrap gap-2 mt-5">
          {tools.map((t) => {
            if (t.nsfwOnly && mode !== "nsfw") return null;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTool(t.id)}
                className={`kino-pill min-h-[36px] ${
                  tool === t.id
                    ? "bg-white/15 text-white border-white/30"
                    : ""
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
        {mode === "sfw" && (
          <p className="text-[11px] text-white/35 mt-2">
            Switch to NSFW to unlock Nude restyle.
          </p>
        )}

        <div className="mt-4">
          <PromptField value={prompt} onChange={setPrompt} label="Edit prompt" />
        </div>

        {error && (
          <p className="mt-4 text-sm text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-2xl px-4 py-3">
            {error}
          </p>
        )}

        {(loading || status || result) && (
          <div className="mt-6 rounded-3xl border border-white/10 bg-kino-card p-4">
            <div className="h-2 rounded-full bg-white/10 overflow-hidden mb-3">
              <div
                className="h-full bg-white transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-sm text-white/60 mb-3">{status}</p>
            {result && (
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={result}
                  alt="Edit result"
                  className="w-full rounded-2xl"
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
        label="Apply edit"
        hint={`${tool} · ${mode.toUpperCase()}`}
      />
    </>
  );
}
