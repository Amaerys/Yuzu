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

test("optimizer: fitting on synthetic reviews from known weights lowers loss", async () => {
  const { fit, samplesFrom, logLoss } = await import("../src/scheduler/optimize.ts");
  const { DEFAULT_W, updateMemory, retrievability, DAY } = await import("../src/scheduler/fsrs.ts");
  // simulate a learner whose memory is stronger than the defaults (stabilities ×2)
  const trueW = DEFAULT_W.slice(); trueW[0] *= 2; trueW[1] *= 2; trueW[2] *= 2; trueW[3] *= 2;
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const reviews: any[] = [];
  for (let c = 0; c < 400; c++) {
    let card = { stability: 0, difficulty: 0, reps: 0 }; let t = 1e12 + c * 1000; let ivl = 0;
    for (let i = 0; i < 8; i++) {
      const elapsed = i === 0 ? 0 : ivl;
      const p = i === 0 ? 1 : retrievability(elapsed, card.stability);
      const rating = rnd() < p ? 3 : 1;
      reviews.push({ id: `${c}-${t}`, cid: String(c), ts: t, rating, state: i ? "review" : "new", elapsedDays: elapsed, scheduledDays: 0, durationMs: 0 });
      const mem = updateMemory(trueW, card, rating as any, elapsed); card = { stability: mem.stability, difficulty: mem.difficulty, reps: card.reps + 1 };
      ivl = Math.max(1, Math.round(card.stability)); t += ivl * DAY;
    }
  }
  const s = samplesFrom(reviews); const before = logLoss(DEFAULT_W, s).loss;
  const r = await fit(reviews, DEFAULT_W, { iterations: 40 });
  assert.ok(r.after < before, `loss should drop: ${before} → ${r.after}`);
  assert.ok(r.w[2] > DEFAULT_W[2], "initial stability for Good moved up toward the true value");
});
