"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Home", icon: "⌂" },
  { href: "/image", label: "Image", icon: "▣" },
  { href: "/video", label: "Video", icon: "▶" },
  { href: "/music", label: "Music", icon: "♪" },
  { href: "/edit", label: "Edit", icon: "✎" },
  { href: "/chat", label: "Chat", icon: "◉" },
];

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 border-t border-white/10 bg-kino-bg/95 backdrop-blur-xl pb-[env(safe-area-inset-bottom)]"
      aria-label="Main"
    >
      <div className="mx-auto max-w-lg flex items-stretch justify-between px-1">
        {LINKS.map((link) => {
          const active =
            link.href === "/"
              ? pathname === "/"
              : pathname.startsWith(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 min-h-[56px] text-[10px] sm:text-xs font-medium transition ${
                active ? "text-white" : "text-white/40"
              }`}
            >
              <span className="text-base leading-none" aria-hidden>
                {link.icon}
              </span>
              <span>{link.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
