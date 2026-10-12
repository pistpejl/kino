"use client";

import Link from "next/link";
import ModeToggle from "./ModeToggle";

export default function Header({ title }: { title?: string }) {
  return (
    <header className="sticky top-0 z-20 bg-kino-bg/90 backdrop-blur-xl border-b border-white/5 pt-[env(safe-area-inset-top)]">
      <div className="mx-auto max-w-lg px-4 h-14 flex items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-2 min-w-0">
          <span className="font-serif text-xl tracking-wide text-white">
            KINO
          </span>
          {title && (
            <span className="text-white/40 text-sm truncate hidden sm:inline">
              / {title}
            </span>
          )}
        </Link>
        <ModeToggle />
      </div>
    </header>
  );
}
