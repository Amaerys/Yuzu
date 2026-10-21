import { test } from "node:test";
import assert from "node:assert/strict";
import { importAnki } from "../src/import/anki.ts";
import { rate, replay, DEFAULT_CONFIG, DAY } from "../src/scheduler/fsrs.ts";
import { renderCard } from "../src/lib/render.ts";
import fs from "node:fs";
import zlib from "node:zlib";
const env = { inflateRaw: async (d: Uint8Array) => new Uint8Array(zlib.inflateRawSync(d)), zstd: async (d: Uint8Array) => new Uint8Array(zlib.zstdDecompressSync(d)) };

test("legacy apkg imports with counts matching the source", async () => {
  const res = await importAnki(new Uint8Array(fs.readFileSync("test/fixtures/medicine-legacy.apkg")), env);
  assert.equal(res.summary.format, "anki21");
  assert.equal(res.summary.notes, 7222);
  assert.equal(res.summary.cards, 7687);
  assert.equal(res.summary.reviews, 595);
  assert.ok(res.notetypes.length > 10);
  const cloze = res.notes.find((n) => res.notetypes.find((t) => t.id === n.ntid)?.kind === "cloze" && /\{\{c1::/.test(n.fields[0]))!;
  const nt = res.notetypes.find((t) => t.id === cloze.ntid)!;
  const card = res.cards.find((c) => c.nid === cloze.id)!;
  const r = renderCard({ note: cloze, notetype: nt, ord: card.ord });
  assert.match(r.front, /\[\.\.\.\]|\[[^\]]+\]/);
  assert.ok(!/\{\{c\d+::/.test(r.back), "cloze markup fully rendered");
});

test("review cards keep history and have a due date", async () => {
  const res = await importAnki(new Uint8Array(fs.readFileSync("test/fixtures/medicine-legacy.apkg")), env);
  const reviewed = res.cards.filter((c) => c.reps > 0);
  assert.ok(reviewed.length > 100);
  for (const c of reviewed) { assert.ok(c.stability > 0); assert.ok(c.difficulty >= 1 && c.difficulty <= 10); assert.ok(c.due > 0); }
});

test("FSRS: Good on a new card schedules a learning step, then a review", () => {
  const now = Date.now();
  const card = { id: "1", nid: "1", ord: 0, state: "new" as const, suspended: false, flag: 0, due: 0, stability: 0, difficulty: 0, reps: 0, lapses: 0, lastReview: 0, step: 0, created: 0, source: "x" };
  const a = rate(card, 3, now);
  assert.equal(a.card.state, "learning"); assert.equal(a.card.due - now, 10 * 60000);
  const b = rate(a.card, 3, now + 10 * 60000);
  assert.equal(b.card.state, "review"); assert.ok(b.intervalDays >= 1);
  const c = rate(b.card, 1, b.card.due);
  assert.equal(c.card.state, "relearning"); assert.equal(c.card.lapses, 1);
  const e = rate(card, 4, now);
  assert.equal(e.card.state, "review"); assert.ok(e.intervalDays >= 4);
});

test("FSRS replay grows stability with successful reviews", () => {
  const card = { id: "1", nid: "1", ord: 0, state: "new" as const, suspended: false, flag: 0, due: 0, stability: 0, difficulty: 0, reps: 0, lapses: 0, lastReview: 0, step: 0, created: 0, source: "x" };
  const t0 = Date.parse("2026-01-01");
  const mk = (d: number, rating: 1 | 2 | 3 | 4) => ({ id: `1-${d}`, cid: "1", ts: t0 + d * DAY, rating, state: "review" as const, elapsedDays: 0, scheduledDays: 0, durationMs: 0 });
  const c1 = replay(card, [mk(0, 3)]);
  const c2 = replay(card, [mk(0, 3), mk(3, 3), mk(10, 3), mk(30, 3)]);
  assert.ok(c2.stability > c1.stability * 3, `${c2.stability} vs ${c1.stability}`);
  assert.equal(c2.reps, 4);
  const c3 = replay(card, [mk(0, 3), mk(3, 3), mk(10, 1)]);
  assert.ok(c3.stability < c2.stability); assert.equal(c3.lapses, 1);
});
