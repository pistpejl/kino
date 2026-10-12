"use client";

import { useCallback, useEffect, useState } from "react";
import Header from "@/components/Header";
import GenerateBar from "@/components/GenerateBar";
import PromptField from "@/components/PromptField";
import ModelSelect from "@/components/ModelSelect";
import { useStudio } from "@/context/StudioContext";
import {
  DEFAULT_IMAGE_MODEL,
  IMAGE_MODELS,
  NSFW_DEFAULT_PROMPT,
  RATIOS,
  RESOLUTIONS,
  SFW_DEFAULT_PROMPT,
  filterModels,
  getModelName,
  resolveModelId,
} from "@/lib/models";
import {
  addGalleryItem,
  loadGallery,
  type GalleryItem,
} from "@/lib/storage";
import { containsUnderageContent, safetyRejectMessage } from "@/lib/safety";
import ImageLightbox from "@/components/ImageLightbox";

export default function ImagePage() {
  const { mode } = useStudio();
  const [prompt, setPrompt] = useState("");
  const [look, setLook] = useState("");
  const [event, setEvent] = useState("");
  const [modelId, setModelId] = useState(DEFAULT_IMAGE_MODEL.sfw);
  const [ratio, setRatio] = useState<string>("3:4");
  const [resolution, setResolution] = useState("768");
  const [count, setCount] = useState(1);
  const [lora, setLora] = useState("");
  const [refPreview, setRefPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  const [lightbox, setLightbox] = useState<GalleryItem | null>(null);
  const [prefilled, setPrefilled] = useState(false);

  const models = filterModels(IMAGE_MODELS, mode);

  useEffect(() => {
    setGallery(loadGallery());
  }, []);

  useEffect(() => {
    setModelId((cur) =>
      resolveModelId(IMAGE_MODELS, cur, mode, DEFAULT_IMAGE_MODEL)
    );
    setPrompt((cur) => {
      const isDefault =
        !cur.trim() ||
        cur === SFW_DEFAULT_PROMPT ||
        cur === NSFW_DEFAULT_PROMPT ||
        !prefilled;
      if (isDefault) {
        return mode === "nsfw" ? NSFW_DEFAULT_PROMPT : SFW_DEFAULT_PROMPT;
      }
      return cur;
    });
    setPrefilled(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const onRef = (file: File | null) => {
    if (!file) {
      setRefPreview(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setRefPreview(String(reader.result));
    reader.readAsDataURL(file);
  };

  const generate = useCallback(async () => {
    setError(null);
    const full = [prompt, look && `look: ${look}`, event && `event: ${event}`]
      .filter(Boolean)
      .join(". ");

    if (containsUnderageContent(full)) {
      setError(safetyRejectMessage());
      return;
    }

    setLoading(true);
    try {
      const n = Math.min(4, Math.max(1, count));
      for (let i = 0; i < n; i++) {
        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            studio: "image",
            prompt: full,
            model: modelId,
            mode,
            ratio,
            resolution,
            refs: refPreview ? [refPreview] : [],
          }),
        });
        const data = await res.json();
        if (!res.ok || data.error) {
          setError(data.error || "Generation failed");
          break;
        }
        const approx =
          data.provider !== "cloudflare" &&
          data.provider !== "wavespeed" &&
          data.provider !== "together" &&
          (Boolean(data.approx) ||
            data.provider === "horde" ||
            String(data.providerNote || "").toLowerCase().includes("horde"));
        const item: GalleryItem = {
          id: `${Date.now()}-${i}`,
          url: data.url,
          prompt: data.prompt || full,
          model: data.engine || data.model || getModelName(IMAGE_MODELS, modelId),
          mode,
          createdAt: Date.now(),
          approx,
          provider: data.provider,
          providerNote: data.providerNote,
        };
        const next = addGalleryItem(item);
        setGallery(next);
      }
    } catch {
      setError("Network error. Check connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [prompt, look, event, modelId, mode, ratio, resolution, count, refPreview]);

  const download = (item: GalleryItem) => {
    const a = document.createElement("a");
    a.href = item.url;
    a.download = `kino-${item.model.replace(/\s+/g, "-").toLowerCase()}-${item.id}.jpg`;
    a.click();
  };

  return (
    <>
      <Header title="Image" />
      <main className="mx-auto max-w-lg px-4 pt-4 pb-36">
        <PromptField
          value={prompt}
          onChange={setPrompt}
          placeholder="Describe your still…"
        />

        <div className="grid grid-cols-2 gap-3 mt-4">
          <label className="block">
            <span className="text-xs text-white/40 uppercase tracking-wider mb-1.5 block">
              Look
            </span>
            <input
              value={look}
              onChange={(e) => setLook(e.target.value)}
              placeholder="Film still, soft light…"
              className="w-full min-h-[44px] rounded-2xl bg-white/5 border border-white/10 px-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-white/20"
            />
          </label>
          <label className="block">
            <span className="text-xs text-white/40 uppercase tracking-wider mb-1.5 block">
              Event
            </span>
            <input
              value={event}
              onChange={(e) => setEvent(e.target.value)}
              placeholder="Rain, neon night…"
              className="w-full min-h-[44px] rounded-2xl bg-white/5 border border-white/10 px-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-white/20"
            />
          </label>
        </div>

        <div className="mt-4">
          <span className="text-xs text-white/40 uppercase tracking-wider mb-1.5 block">
            Reference
          </span>
          <label className="flex items-center justify-center min-h-[88px] rounded-2xl border border-dashed border-white/15 bg-white/[0.03] cursor-pointer overflow-hidden">
            {refPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={refPreview} alt="Reference" className="max-h-40 object-contain" />
            ) : (
              <span className="text-sm text-white/40">Tap to upload</span>
            )}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => onRef(e.target.files?.[0] || null)}
            />
          </label>
        </div>

        <div className="mt-4 space-y-3">
          <ModelSelect models={models} value={modelId} onChange={setModelId} />
          <label className="block">
            <span className="text-xs text-white/40 uppercase tracking-wider mb-1.5 block">
              LoRA
            </span>
            <input
              value={lora}
              onChange={(e) => setLora(e.target.value)}
              placeholder="Optional style LoRA name"
              className="w-full min-h-[44px] rounded-2xl bg-white/5 border border-white/10 px-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-white/20"
            />
          </label>
          <div className="grid grid-cols-3 gap-2">
            <label className="block">
              <span className="text-xs text-white/40 uppercase tracking-wider mb-1.5 block">
                Ratio
              </span>
              <select
                value={ratio}
                onChange={(e) => setRatio(e.target.value)}
                className="w-full min-h-[44px] rounded-2xl bg-white/5 border border-white/10 px-2 text-sm text-white"
              >
                {RATIOS.map((r) => (
                  <option key={r} value={r} className="bg-neutral-900">
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-white/40 uppercase tracking-wider mb-1.5 block">
                Res
              </span>
              <select
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                className="w-full min-h-[44px] rounded-2xl bg-white/5 border border-white/10 px-2 text-sm text-white"
              >
                {RESOLUTIONS.map((r) => (
                  <option key={r} value={r} className="bg-neutral-900">
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-white/40 uppercase tracking-wider mb-1.5 block">
                Count
              </span>
              <select
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                className="w-full min-h-[44px] rounded-2xl bg-white/5 border border-white/10 px-2 text-sm text-white"
              >
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n} className="bg-neutral-900">
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {error && (
          <p className="mt-4 text-sm text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-2xl px-4 py-3">
            {error}
          </p>
        )}

        <section className="mt-8">
          <h2 className="text-xs uppercase tracking-wider text-white/40 mb-3">
            Gallery
          </h2>
          {gallery.length === 0 ? (
            <p className="text-sm text-white/35">Generated stills appear here.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {gallery.map((item) => (
                <article
                  key={item.id}
                  className="rounded-2xl overflow-hidden border border-white/10 bg-kino-card"
                >
                  <button
                    type="button"
                    onClick={() => setLightbox(item)}
                    className="block w-full text-left"
                    aria-label="Öppna bild"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.url}
                      alt={item.prompt.slice(0, 80)}
                      className="w-full aspect-[3/4] object-cover bg-black"
                    />
                  </button>
                  <div className="p-2.5 space-y-2">
                    <div>
                      <p className="text-[11px] text-white/70 truncate font-medium">
                        {item.model}
                      </p>
                      {(item.approx || item.provider === "horde") &&
                        item.provider !== "together" &&
                        item.provider !== "wavespeed" &&
                        item.provider !== "cloudflare" && (
                        <p className="text-[10px] text-amber-300/80 mt-0.5">
                          approx / free backend
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <button
                        type="button"
                        onClick={() => setLightbox(item)}
                        className="kino-pill !py-1 !px-2 text-[10px]"
                      >
                        Zooma
                      </button>
                      <button
                        type="button"
                        onClick={() => download(item)}
                        className="kino-pill !py-1 !px-2 text-[10px]"
                      >
                        Spara
                      </button>
                      <button
                        type="button"
                        onClick={() => setPrompt(item.prompt)}
                        className="kino-pill !py-1 !px-2 text-[10px]"
                      >
                        Restyle
                      </button>
                      <a
                        href="/edit"
                        className="kino-pill !py-1 !px-2 text-[10px]"
                      >
                        Edit
                      </a>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
      <ImageLightbox item={lightbox} onClose={() => setLightbox(null)} />
      <GenerateBar
        onGenerate={generate}
        loading={loading}
        hint={`${getModelName(IMAGE_MODELS, modelId)} · ${mode.toUpperCase()}`}
      />
    </>
  );
}
