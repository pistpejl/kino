"use client";

import { useStudio } from "@/context/StudioContext";

export default function ModeToggle({ className = "" }: { className?: string }) {
  const { mode, setMode } = useStudio();

  return (
    <div
      className={`inline-flex rounded-full bg-white/5 border border-white/10 p-1 ${className}`}
      role="group"
      aria-label="Content mode"
    >
      <button
        type="button"
        onClick={() => setMode("sfw")}
        className={`min-h-[36px] px-4 rounded-full text-sm font-medium transition ${
          mode === "sfw"
            ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
            : "text-white/50"
        }`}
      >
        SFW
      </button>
      <button
        type="button"
        onClick={() => setMode("nsfw")}
        className={`min-h-[36px] px-4 rounded-full text-sm font-medium transition ${
          mode === "nsfw"
            ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
            : "text-white/50"
        }`}
      >
        NSFW
      </button>
    </div>
  );
}
