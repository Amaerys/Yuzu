import { test } from "node:test";
import assert from "node:assert/strict";
import { importAnki } from "../src/import/anki.ts";
import fs from "node:fs"; import zlib from "node:zlib";
const env = { inflateRaw: async (d: Uint8Array) => new Uint8Array(zlib.inflateRawSync(d)), zstd: async (d: Uint8Array) => new Uint8Array(zlib.zstdDecompressSync(d)) };
test("classifier tags most medical notes with a system", async () => {
  const res = await importAnki(new Uint8Array(fs.readFileSync("test/fixtures/medicine-legacy.apkg")), env);
  const counts: Record<string, number> = {}; let tagged = 0;
  for (const n of res.notes) { const s = n.tags.filter((t) => t.startsWith("auto::System::")); if (s.length) tagged++; for (const t of s) counts[t.slice(14)] = (counts[t.slice(14)] ?? 0) + 1; }
  console.log(`tagged ${tagged}/${res.notes.length}`, Object.entries(counts).sort((a, b) => b[1] - a[1]));
  assert.ok(tagged / res.notes.length > 0.6);
});
