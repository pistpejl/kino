"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ContentMode } from "@/lib/models";
import { MODE_KEY } from "@/lib/storage";

interface StudioContextValue {
  mode: ContentMode;
  setMode: (mode: ContentMode) => void;
  ageVerified: boolean;
  setAgeVerified: (v: boolean) => void;
}

const StudioContext = createContext<StudioContextValue | null>(null);

export function StudioProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ContentMode>("sfw");
  const [ageVerified, setAgeVerified] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const m = localStorage.getItem(MODE_KEY) as ContentMode | null;
      if (m === "sfw" || m === "nsfw") setModeState(m);
      const age = localStorage.getItem("kino-age-verified-21");
      setAgeVerified(age === "true");
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, []);

  const setMode = useCallback((m: ContentMode) => {
    setModeState(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo(
    () => ({
      mode,
      setMode,
      ageVerified,
      setAgeVerified: (v: boolean) => {
        setAgeVerified(v);
        try {
          localStorage.setItem("kino-age-verified-21", v ? "true" : "false");
        } catch {
          /* ignore */
        }
      },
    }),
    [mode, setMode, ageVerified]
  );

  if (!hydrated) {
    return (
      <div className="min-h-dvh bg-kino-bg flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-white/20 border-t-white animate-spin" />
      </div>
    );
  }

  return (
    <StudioContext.Provider value={value}>{children}</StudioContext.Provider>
  );
}

export function useStudio() {
  const ctx = useContext(StudioContext);
  if (!ctx) throw new Error("useStudio must be used within StudioProvider");
  return ctx;
}
