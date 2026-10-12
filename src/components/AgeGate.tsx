"use client";

import { useStudio } from "@/context/StudioContext";

export default function AgeGate() {
  const { ageVerified, setAgeVerified } = useStudio();
  if (ageVerified) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black/95 flex items-end sm:items-center justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="w-full max-w-md rounded-3xl bg-kino-card border border-white/10 p-6 sm:p-8 shadow-2xl">
        <p className="text-xs uppercase tracking-[0.2em] text-white/40 mb-3">
          Age verification
        </p>
        <h1 className="font-serif text-3xl text-white mb-3 leading-tight">
          Adults 21+ only
        </h1>
        <p className="text-sm text-white/60 mb-6 leading-relaxed">
          KINO is an uncensored creative studio for adults. By continuing you
          confirm you are at least 21 years old. Content involving anyone under
          18 is permanently blocked.
        </p>
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => setAgeVerified(true)}
            className="w-full min-h-[48px] rounded-full bg-white text-black font-semibold text-base active:scale-[0.98] transition"
          >
            I am 21 or older — Enter
          </button>
          <button
            type="button"
            onClick={() => {
              window.location.href = "https://www.google.com";
            }}
            className="w-full min-h-[44px] rounded-full border border-white/15 text-white/70 text-sm"
          >
            Exit
          </button>
        </div>
      </div>
    </div>
  );
}
