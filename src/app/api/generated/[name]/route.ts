import { NextRequest, NextResponse } from "next/server";
import { access, readFile, stat } from "fs/promises";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_EXT = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "webm",
  "wav",
  "mp4",
]);

const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  webm: "video/webm",
  wav: "audio/wav",
  mp4: "video/mp4",
};

const GEN_DIR = path.join(process.cwd(), "public", "generated");

function safeName(raw: string): string | null {
  if (!raw || typeof raw !== "string") return null;
  const base = path.basename(raw);
  // Reject anything that isn't a plain basename (no traversal / nested paths)
  if (base !== raw || base.includes("..")) return null;
  const ext = base.split(".").pop()?.toLowerCase() || "";
  if (!ALLOWED_EXT.has(ext)) return null;
  if (!/^[a-zA-Z0-9._-]+$/.test(base)) return null;
  return base;
}

export async function GET(
  _req: NextRequest,
  context: { params: { name: string } }
) {
  const name = safeName(context.params.name);
  if (!name) {
    return new NextResponse("Not found", { status: 404 });
  }

  const filePath = path.join(GEN_DIR, name);
  const resolved = path.resolve(filePath);
  const genRoot = path.resolve(GEN_DIR);
  if (!resolved.startsWith(genRoot + path.sep)) {
    return new NextResponse("Not found", { status: 404 });
  }

  try {
    await access(resolved);
    const st = await stat(resolved);
    if (!st.isFile()) {
      return new NextResponse("Not found", { status: 404 });
    }
    const buf = await readFile(resolved);
    const ext = name.split(".").pop()!.toLowerCase();
    const contentType = CONTENT_TYPES[ext] || "application/octet-stream";
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(st.size),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
