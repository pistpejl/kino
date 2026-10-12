import { NextRequest, NextResponse } from "next/server";
import { containsUnderageContent, safetyRejectMessage } from "@/lib/safety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHARACTERS: Record<string, string> = {
  luna: "Luna",
  kai: "Kai",
  nova: "Nova",
};

function reply(userText: string, character: string, mode: string): string {
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
  const pick = pool[Math.floor(Math.random() * pool.length)];
  return `${pick} (${userText.slice(0, 40)}${userText.length > 40 ? "…" : ""})`;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const text = String(body.message || body.text || "").trim();
    const mode = body.mode === "nsfw" ? "nsfw" : "sfw";
    const characterId = String(body.character || "luna");
    const character = CHARACTERS[characterId] || "Luna";

    if (!text) {
      return NextResponse.json({ error: "Empty message" }, { status: 400 });
    }
    if (containsUnderageContent(text)) {
      return NextResponse.json(
        { error: safetyRejectMessage() },
        { status: 400 }
      );
    }

    // Tiny delay to feel conversational
    await new Promise((r) => setTimeout(r, 400 + Math.random() * 500));

    return NextResponse.json({
      ok: true,
      reply: reply(text, character, mode),
      character,
      mode,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Chat failed",
      },
      { status: 500 }
    );
  }
}
