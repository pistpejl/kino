"use client";

import Link from "next/link";
import Header from "@/components/Header";
import { useStudio } from "@/context/StudioContext";
import { IMAGE_MODELS, VIDEO_MODELS, filterModels } from "@/lib/models";

const CARDS = [
  {
    href: "/image",
    title: "Image",
    desc: "Stills in seconds. Looks, LoRAs, references.",
  },
  {
    href: "/video",
    title: "Video",
    desc: "5–60s clips. First & last frame, extend.",
  },
  {
    href: "/music",
    title: "Music video",
    desc: "Upload a track or generate a bed. Lock face.",
  },
  {
    href: "/chat",
    title: "Chat",
    desc: "Adult character chat. Uncensored for 21+.",
  },
];

const APPS = [
  { href: "/music", label: "Music video" },
  { href: "/edit", label: "Kiss" },
  { href: "/video", label: "Dance" },
  { href: "/video", label: "Twerk" },
  { href: "/video", label: "First+last frame" },
  { href: "/video", label: "Extend" },
];

export default function HomePage() {
  const { mode } = useStudio();
  const featured = [
    ...filterModels(IMAGE_MODELS, mode).slice(0, 3),
    ...filterModels(VIDEO_MODELS, mode).slice(0, 2),
  ];

  return (
    <>
      <Header />
      <main className="mx-auto max-w-lg px-4 pt-6 pb-8">
        <p className="text-xs uppercase tracking-[0.25em] text-white/40 mb-3">
          AI studio
        </p>
        <h1 className="font-serif text-[2.1rem] sm:text-4xl leading-[1.15] text-white mb-3">
          Image, video and music videos. No credits.
        </h1>
        <p className="text-sm text-white/50 mb-8 leading-relaxed">
          Dark cinematic tools for adults 21+. Toggle{" "}
          <span className="text-white/80">SFW</span> or{" "}
          <span className="text-white/80">NSFW</span> — your choice, never auto.
        </p>

        <div className="grid grid-cols-2 gap-3 mb-10">
          {CARDS.map((c) => (
            <Link
              key={c.href + c.title}
              href={c.href}
              className="kino-card min-h-[120px] flex flex-col justify-between active:scale-[0.98] transition hover:border-white/20"
            >
              <span className="font-serif text-xl text-white">{c.title}</span>
              <span className="text-xs text-white/45 leading-snug">{c.desc}</span>
            </Link>
          ))}
        </div>

        <section className="mb-10">
          <h2 className="text-xs uppercase tracking-wider text-white/40 mb-3">
            Featured · {mode.toUpperCase()}
          </h2>
          <div className="flex flex-wrap gap-2">
            {featured.map((m) => (
              <span
                key={m.id}
                className={`kino-pill ${
                  m.mode === "nsfw"
                    ? "border-rose-500/30 text-rose-200"
                    : "border-emerald-500/30 text-emerald-200"
                }`}
              >
                {m.name}
                <span className="ml-1.5 opacity-50">{m.mode.toUpperCase()}</span>
              </span>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-xs uppercase tracking-wider text-white/40 mb-3">
            Apps
          </h2>
          <div className="flex flex-wrap gap-2">
            {APPS.map((a) => (
              <Link
                key={a.label}
                href={a.href}
                className="kino-pill hover:bg-white/10 transition min-h-[36px] inline-flex items-center"
              >
                {a.label}
              </Link>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
