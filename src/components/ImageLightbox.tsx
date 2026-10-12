"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { GalleryItem } from "@/lib/storage";

export const VIDEO_STILL_KEY = "kino-video-first-frame";

type Props = {
  item: GalleryItem | null;
  onClose: () => void;
};

export default function ImageLightbox({ item, onClose }: Props) {
  const router = useRouter();
  const [zoomed, setZoomed] = useState(false);
  const [saving, setSaving] = useState(false);
  const lastTap = useRef(0);

  useEffect(() => {
    if (!item) return;
    setZoomed(false);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [item, onClose]);

  const download = useCallback(async () => {
    if (!item) return;
    setSaving(true);
    try {
      const res = await fetch(item.url);
      const blob = await res.blob();
      const ext =
        blob.type.includes("png")
          ? "png"
          : blob.type.includes("webp")
            ? "webp"
            : "jpg";
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `kino-${item.model.replace(/\s+/g, "-").toLowerCase()}-${item.id}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      // Fallback: open in new tab
      window.open(item.url, "_blank");
    } finally {
      setSaving(false);
    }
  }, [item]);

  const toVideo = useCallback(() => {
    if (!item) return;
    try {
      sessionStorage.setItem(
        VIDEO_STILL_KEY,
        JSON.stringify({
          url: item.url,
          prompt: item.prompt,
          model: item.model,
        })
      );
    } catch {
      /* ignore quota */
    }
    onClose();
    router.push("/video");
  }, [item, onClose, router]);

  const onImageTap = () => {
    const now = Date.now();
    if (now - lastTap.current < 320) {
      setZoomed((z) => !z);
    }
    lastTap.current = now;
  };

  if (!item) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex flex-col bg-black/95"
      role="dialog"
      aria-modal="true"
      aria-label="Bildförstoring"
    >
      {/* Top bar */}
      <div className="flex items-center justify-between gap-2 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2 shrink-0">
        <div className="flex-1 pl-1 min-w-0">
          <p className="text-xs text-white/60 truncate">{item.model}</p>
          {(item.approx || item.provider === "horde") &&
            item.provider !== "together" &&
            item.provider !== "wavespeed" &&
            item.provider !== "cloudflare" && (
            <p className="text-[10px] text-amber-300/80 truncate">
              approx / free backend
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="min-h-[44px] min-w-[44px] rounded-full bg-white/10 text-white text-xl leading-none flex items-center justify-center"
          aria-label="Stäng"
        >
          ×
        </button>
      </div>

      {/* Image stage — pan when zoomed */}
      <div
        className={`flex-1 min-h-0 relative ${
          zoomed ? "overflow-auto" : "overflow-hidden flex items-center justify-center"
        }`}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.url}
          alt={item.prompt.slice(0, 120)}
          onClick={onImageTap}
          className={
            zoomed
              ? "max-w-none w-[200%] h-auto select-none"
              : "max-w-full max-h-full object-contain select-none px-2"
          }
          draggable={false}
        />
      </div>

      <p className="text-[10px] text-white/35 text-center px-4 py-1 shrink-0">
        Dubbeltryck för zoom · Double-tap to zoom
      </p>

      {/* Actions */}
      <div className="shrink-0 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={download}
          disabled={saving}
          className="min-h-[48px] rounded-full bg-white text-black font-semibold text-sm disabled:opacity-60"
        >
          {saving ? "Sparar…" : "Spara / Save"}
        </button>
        <button
          type="button"
          onClick={toVideo}
          className="min-h-[48px] rounded-full border border-white/30 bg-white/10 text-white font-semibold text-sm"
        >
          Generera video
        </button>
      </div>
    </div>
  );
}
