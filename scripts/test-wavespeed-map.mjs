/**
 * Unit tests for WaveSpeed catalog mapping (no API key / no live network).
 * Run: node scripts/test-wavespeed-map.mjs
 */
import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { spawnSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

// Compile wavespeed.ts (+ minimal deps) via npx tsx if available, else parse source.
function loadViaTsx() {
  const runner = `
import assert from "assert";
import {
  WAVESPEED_IMAGE_MAP,
  resolveWaveSpeedMapping,
  assertWaveSpeedMapping,
  buildWaveSpeedBody,
  listSupportedWaveSpeedModels,
  hasWaveSpeedKey,
} from "../src/lib/wavespeed.ts";

assert.ok(WAVESPEED_IMAGE_MAP.seedream);
assert.strictEqual(
  WAVESPEED_IMAGE_MAP.seedream.endpoint,
  "bytedance/seedream-v4.5"
);
assert.strictEqual(
  WAVESPEED_IMAGE_MAP["flux-schnell"].endpoint,
  "wavespeed-ai/flux-schnell"
);
assert.strictEqual(
  WAVESPEED_IMAGE_MAP["kling-nsfw"].endpoint,
  "kwaivgi/kling-image-v3/text-to-image"
);
assert.strictEqual(
  WAVESPEED_IMAGE_MAP["z-image-turbo"].endpoint,
  "wavespeed-ai/z-image/turbo"
);
assert.strictEqual(
  WAVESPEED_IMAGE_MAP["qwen-image"].endpoint,
  "wavespeed-ai/qwen-image/text-to-image"
);
assert.strictEqual(
  WAVESPEED_IMAGE_MAP["flux-klein"].endpoint,
  "wavespeed-ai/flux-2-klein-9b/text-to-image"
);
assert.strictEqual(
  WAVESPEED_IMAGE_MAP.minimax.endpoint,
  "minimax/image-01/text-to-image"
);

assert.strictEqual(resolveWaveSpeedMapping("krea-2"), null);
assert.strictEqual(resolveWaveSpeedMapping("analog"), null);
assert.strictEqual(resolveWaveSpeedMapping("pony"), null);

assert.throws(
  () => assertWaveSpeedMapping("krea-2"),
  /no WaveSpeed mapping/
);

const body = buildWaveSpeedBody(WAVESPEED_IMAGE_MAP.seedream, {
  prompt: "test",
  width: 768,
  height: 1024,
  ratio: "3:4",
});
assert.strictEqual(body.size, "768*1024");
assert.ok(body.prompt);

const klingBody = buildWaveSpeedBody(WAVESPEED_IMAGE_MAP["kling-nsfw"], {
  prompt: "adult test",
  width: 768,
  height: 1024,
  ratio: "3:4",
});
assert.strictEqual(klingBody.aspect_ratio, "3:4");
assert.ok(klingBody.resolution);

const supported = listSupportedWaveSpeedModels();
assert.ok(supported.includes("seedream"));
assert.ok(!supported.includes("pony"));

// No invented key
delete process.env.WAVESPEED_API_KEY;
assert.strictEqual(hasWaveSpeedKey(), false);
process.env.WAVESPEED_API_KEY = "your-api-key";
assert.strictEqual(hasWaveSpeedKey(), false);
process.env.WAVESPEED_API_KEY = "";
assert.strictEqual(hasWaveSpeedKey(), false);

console.log("OK — WaveSpeed mapping unit tests passed (" + supported.length + " mapped)");
`;
  const tmp = path.join(root, "scripts", "_run-ws-test.mts");
  fs.writeFileSync(tmp, runner);
  const r = spawnSync(
    "npx",
    ["--yes", "tsx", tmp],
    { cwd: root, encoding: "utf8", env: { ...process.env } }
  );
  fs.unlinkSync(tmp);
  if (r.status !== 0) {
    console.error(r.stdout);
    console.error(r.stderr);
    process.exit(r.status || 1);
  }
  process.stdout.write(r.stdout);
}

// Also assert providers no longer call Pollinations in generateStill
const providers = fs.readFileSync(
  path.join(root, "src/lib/providers.ts"),
  "utf8"
);
const genStill = providers.split("export async function generateStill")[1]?.split(
  "function runFfmpeg"
)[0] || "";
assert.ok(
  !/tryPollinations\s*\(/.test(genStill),
  "generateStill must not call tryPollinations"
);
assert.ok(genStill.includes("generateViaWaveSpeed"));
assert.ok(genStill.includes("approx: true"));
assert.ok(
  providers.includes("never Pollinations") ||
    providers.toLowerCase().includes("never pollinations")
);

loadViaTsx();
