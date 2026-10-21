import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePack } from "../src/import/pack.ts";
import fs from "node:fs";
test("pack import: cloze ords, images, exact and near duplicates", () => {
  const pack = JSON.parse(fs.readFileSync("test/fixtures/hyperkalemia.yuzu.json", "utf8"));
  const r = parsePack(pack, []);
  assert.equal(r.notes.length, 5); assert.equal(r.media.length, 1);
  assert.equal(r.cards.filter((c) => c.nid === r.notes[1].id).length, 3, "three cloze cards");
  assert.ok(r.notes[0].fields[2].includes("<img src=\"pack-"));
  assert.equal(r.similar, 1, "the shorter restatement is flagged as similar");
  // Importing again: everything is an exact duplicate.
  const again = parsePack(pack, r.notes);
  assert.equal(again.notes.length, 0); assert.equal(again.skipped, 5);
});

test("pack revision: cards with id/replaces update in place, new cloze numbers add cards", () => {
  const v1 = { yuzu_pack: 1, id: "k", cards: [{ id: "a", type: "cloze", text: "K > {{c1::5.5}}" }, { type: "basic", front: "Old front", back: "Old back" }] };
  const r1 = parsePack(v1, []);
  const legacy = r1.notes[1].id;
  const v2 = { yuzu_pack: 1, id: "k", cards: [{ id: "a", type: "cloze", text: "US {{c1::5.0}}, UK {{c2::5.5}}" }, { id: "b", replaces: legacy, type: "basic", front: "New front", back: "New back" }] };
  const r2 = parsePack(v2, r1.notes);
  assert.deepEqual(r2.updated.sort(), [r1.notes[0].id, legacy].sort());
  assert.equal(r2.cards.filter((c) => c.nid === r1.notes[0].id).length, 2);
  assert.equal(parsePack(v2, r2.notes).unchanged, 2);
});

test("duplicates: similar pairs and merge keep the stronger history and union tags", async () => {
  const { similarPairs, mergeInto } = await import("../src/lib/dupes.ts");
  const mk = (id: string, text: string, tags: string[]) => ({ id, ntid: "t", guid: id, fields: [text, ""], tags, created: 0, modified: 0 });
  const a = mk("a", "Which language center is the center for language comprehension? Wernicke area", ["needs-review::similar", "x"]);
  const b = mk("b", "Which language center is the center for language comprehension? Wernicke's area", ["needs-review::similar", "y"]);
  const c = mk("c", "Treatment of PDA involves indomethacin", ["needs-review::similar"]);
  const pairs = similarPairs([a, b, c]);
  assert.equal(pairs.length, 1); assert.deepEqual([pairs[0][0], pairs[0][1]].sort(), ["a", "b"]);
  const card = (id: string, nid: string, reps: number) => ({ id, nid, ord: 0, state: "review" as const, suspended: false, flag: 0, due: 1, stability: reps, difficulty: 5, reps, lapses: 0, lastReview: reps, step: 0, created: 0, mod: 0, source: "M" });
  const m = mergeInto(a, [card("a0", "a", 1)], b, [card("b0", "b", 7)], 100);
  assert.deepEqual(m.note.tags.sort(), ["x", "y"]);
  assert.equal(m.cards[0].id, "a0"); assert.equal(m.cards[0].reps, 7, "stronger scheduling copied onto the kept card");
});
