"use client";

import { useEffect, useRef, useState } from "react";
import Header from "@/components/Header";
import { useStudio } from "@/context/StudioContext";
import { containsUnderageContent, safetyRejectMessage } from "@/lib/safety";

interface Msg {
  id: string;
  role: "user" | "assistant";
  text: string;
}

const CHARACTERS = [
  { id: "luna", name: "Luna", blurb: "Midnight muse · witty · 28" },
  { id: "kai", name: "Kai", blurb: "Film director · intense · 32" },
  { id: "nova", name: "Nova", blurb: "Club DJ · playful · 26" },
];

function mockReply(userText: string, character: string, mode: string): string {
  const soft = [
    `*smiles* Interesting… tell me more about that.`,
    `As ${character}, I'd say that has cinematic potential.`,
    `Mmm. Keep talking — I'm listening.`,
  ];
  const spicy = [
    `*leans closer* That's bold. I like adults who know what they want.`,
    `Careful… you're getting me curious. What happens next?`,
    `Between us? That fantasy stays uncensored.`,
  ];
  const pool = mode === "nsfw" ? spicy : soft;
  return pool[Math.floor(Math.random() * pool.length)] + ` (${userText.slice(0, 40)}${userText.length > 40 ? "…" : ""})`;
}

export default function ChatPage() {
  const { mode } = useStudio();
  const [character, setCharacter] = useState(CHARACTERS[0].id);
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [typing, setTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const char = CHARACTERS.find((c) => c.id === character)!;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, typing]);

  useEffect(() => {
    setMsgs([
      {
        id: "welcome",
        role: "assistant",
        text: `Hey — I'm ${char.name}. ${char.blurb}. Adults only. What are we creating tonight?`,
      },
    ]);
  }, [character]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    setError(null);
    const text = input.trim();
    if (!text) return;
    if (containsUnderageContent(text)) {
      setError(safetyRejectMessage());
      return;
    }
    setInput("");
    setMsgs((m) => [
      ...m,
      { id: `u-${Date.now()}`, role: "user", text },
    ]);
    setTyping(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          character,
          mode,
        }),
      });
      const data = await res.json();
      const reply =
        res.ok && data.reply
          ? data.reply
          : mockReply(text, char.name, mode);
      if (!res.ok && data.error) setError(data.error);
      setMsgs((m) => [
        ...m,
        { id: `a-${Date.now()}`, role: "assistant", text: reply },
      ]);
    } catch {
      const reply = mockReply(text, char.name, mode);
      setMsgs((m) => [
        ...m,
        { id: `a-${Date.now()}`, role: "assistant", text: reply },
      ]);
    } finally {
      setTyping(false);
    }
  };

  return (
    <>
      <Header title="Chat" />
      <main className="mx-auto max-w-lg px-4 pt-3 pb-28 flex flex-col min-h-[calc(100dvh-8rem)]">
        <div className="flex gap-2 overflow-x-auto pb-3 -mx-1 px-1 scrollbar-none">
          {CHARACTERS.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCharacter(c.id)}
              className={`shrink-0 rounded-full px-4 min-h-[40px] text-sm border ${
                character === c.id
                  ? "bg-white text-black border-white"
                  : "border-white/15 text-white/60"
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto">
          {msgs.map((m) => (
            <div
              key={m.id}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-3xl px-4 py-2.5 text-sm leading-relaxed ${
                  m.role === "user"
                    ? "bg-white text-black rounded-br-md"
                    : "bg-white/10 text-white/90 rounded-bl-md"
                }`}
              >
                {m.text}
              </div>
            </div>
          ))}
          {typing && (
            <p className="text-xs text-white/40 px-2">{char.name} is typing…</p>
          )}
          <div ref={bottomRef} />
        </div>

        {error && (
          <p className="mt-2 text-sm text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-2xl px-4 py-2">
            {error}
          </p>
        )}

        <div className="sticky bottom-0 pt-3 pb-2 bg-gradient-to-t from-kino-bg via-kino-bg to-transparent">
          <div className="flex gap-2 items-end">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              rows={1}
              placeholder={`Message ${char.name}…`}
              className="flex-1 min-h-[48px] max-h-32 rounded-3xl bg-white/5 border border-white/10 px-4 py-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-white/20 resize-none"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <button
              type="button"
              onClick={send}
              className="min-h-[48px] min-w-[48px] rounded-full bg-white text-black font-semibold text-sm px-4 shrink-0"
            >
              Send
            </button>
          </div>
          <p className="text-[10px] text-white/30 text-center mt-2">
            Mock LLM · {mode.toUpperCase()} · 21+ only
          </p>
        </div>
      </main>
    </>
  );
}
