import { test } from "node:test";
import assert from "node:assert/strict";
import { GitHubSync, SyncError, mergeCards, mergeNotes, mergeReviews, mergeTombstones } from "../src/lib/sync.ts";
import type { Card, Note } from "../src/lib/model.ts";
import { fakeGitHub } from "./fake-github.ts";

const mkCard = (id: string, mod: number): Card => ({ id, nid: "n" + id, ord: 0, state: "review", suspended: false, flag: 0, due: 0, stability: 5, difficulty: 5, reps: 1, lapses: 0, lastReview: mod, step: 0, created: 0, mod, source: "Medicine" });
const mkNote = (id: string, modified: number, text = "x"): Note => ({ id, ntid: "t", guid: id, fields: [text], tags: [], created: 0, modified });
const cfg = { owner: "o", repo: "r", token: "t" };
const client = (gh: ReturnType<typeof fakeGitHub>) => { const c = new GitHubSync(cfg); c.fetchImpl = gh.fetchImpl as any; return c; };

test("two devices converge through push/pull with last-change-wins, starting from an empty repository", async () => {
  const gh = fakeGitHub();
  const A = client(gh), B = client(gh);
  assert.match((await A.check()).message, /empty/);
  const aCards = new Map([["1", mkCard("1", 100)], ["2", mkCard("2", 100)]]);
  const aNotes = new Map([["n1", mkNote("n1", 100)]]);
  const snapA = () => ({ notetypes: [], notes: [...aNotes.values()], cards: [...aCards.values()], reviews: [{ id: "1-100", cid: "1", ts: 100, rating: 3 as const, state: "review" as const, elapsedDays: 0, scheduledDays: 1, durationMs: 0 }], settings: { updatedAt: 1 } });
  const s1 = await GitHubSync.shard(snapA());
  const r1 = await A.push(s1.hashes, s1.make, null, "A");
  assert.ok(r1.pushed > 0); assert.ok(gh.files()[".yuzu"], "bootstrap commit made");
  const man = (await B.pullManifest())!;
  const got = await B.pullChanged(man, {});
  const bCards = new Map<string, Card>(); const bNotes = new Map<string, Note>(); let bReviews: any[] = [];
  mergeCards(bCards, got.cards!); mergeNotes(bNotes, got.notes!); bReviews = mergeReviews(bReviews, got.reviews!).list;
  assert.equal(bCards.size, 2); assert.equal(bNotes.size, 1); assert.equal(bReviews.length, 1);
  bCards.set("1", { ...bCards.get("1")!, mod: 200, lastReview: 200, reps: 2 });
  bReviews.push({ id: "1-200", cid: "1", ts: 200, rating: 3, state: "review", elapsedDays: 1, scheduledDays: 2, durationMs: 0 });
  const s2 = await GitHubSync.shard({ notetypes: [], notes: [...bNotes.values()], cards: [...bCards.values()], reviews: bReviews, settings: { updatedAt: 1 } });
  const r2 = await B.push(s2.hashes, s2.make, man, "B");
  assert.ok(r2.pushed >= 1 && r2.pushed <= 3, "only changed shards pushed: " + r2.pushed);
  aCards.set("2", { ...aCards.get("2")!, suspended: true, mod: 150 });
  const man2 = (await A.pullManifest())!;
  const gotA = await A.pullChanged(man2, r1.manifest.files);
  mergeCards(aCards, gotA.cards!);
  const mergedReviews = mergeReviews(snapA().reviews, gotA.reviews ?? []);
  assert.equal(aCards.get("1")!.reps, 2, "B's newer review state wins");
  assert.equal(aCards.get("2")!.suspended, true, "A's newer suspend survives");
  assert.equal(mergedReviews.list.length, 2);
  const s3 = await GitHubSync.shard({ ...snapA(), cards: [...aCards.values()], reviews: mergedReviews.list });
  const r3 = await A.push(s3.hashes, s3.make, man2, "A");
  assert.ok(r3.pushed >= 1);
  const man3 = (await B.pullManifest())!;
  const gotB = await B.pullChanged(man3, r2.manifest.files);
  mergeCards(bCards, gotB.cards ?? []);
  assert.equal(bCards.get("2")!.suspended, true);
  assert.equal(bCards.get("1")!.reps, 2);
  const s4 = await GitHubSync.shard({ notetypes: [], notes: [...bNotes.values()], cards: [...bCards.values()], reviews: mergedReviews.list, settings: { updatedAt: 1 } });
  const r4 = await B.push(s4.hashes, s4.make, man3, "B");
  assert.equal(r4.pushed, 0, "converged: nothing left to push");
});

test("a push that loses the race gets a conflict error; retrying after a pull succeeds", async () => {
  const gh = fakeGitHub();
  const A = client(gh), B = client(gh);
  const base = await GitHubSync.shard({ notetypes: [], notes: [], cards: [mkCard("1", 1)], reviews: [], settings: { updatedAt: 1 } });
  const r0 = await A.push(base.hashes, base.make, null, "A");
  const manA = (await A.pullManifest())!; const manB = (await B.pullManifest())!;
  const sB = await GitHubSync.shard({ notetypes: [], notes: [], cards: [mkCard("1", 1), mkCard("2", 2)], reviews: [], settings: { updatedAt: 1 } });
  await B.push(sB.hashes, sB.make, manB, "B");
  const sA = await GitHubSync.shard({ notetypes: [], notes: [], cards: [mkCard("1", 1), mkCard("3", 3)], reviews: [], settings: { updatedAt: 1 } });
  await assert.rejects(A.push(sA.hashes, sA.make, manA, "A"), (e: any) => e instanceof SyncError && e.kind === "conflict");
  const man2 = (await A.pullManifest())!; const got = await A.pullChanged(man2, r0.manifest.files);
  const cards = new Map([["1", mkCard("1", 1)], ["3", mkCard("3", 3)]]); mergeCards(cards, got.cards!);
  const sA2 = await GitHubSync.shard({ notetypes: [], notes: [], cards: [...cards.values()], reviews: [], settings: { updatedAt: 1 } });
  const r = await A.push(sA2.hashes, sA2.make, man2, "A");
  assert.ok(r.pushed >= 1);
  const final = await B.pullChanged((await B.pullManifest())!, {});
  assert.deepEqual(final.cards!.map((c) => c.id).sort(), ["1", "2", "3"]);
});

test("transient 5xx responses are retried; a bad token gives a readable error", async () => {
  const gh = fakeGitHub({ flaky: 2 });
  const A = client(gh);
  assert.equal(await A.pullManifest(), null, "survived two 502s");
  const bad = new GitHubSync(cfg); bad.fetchImpl = (async () => new Response(JSON.stringify({ message: "Bad credentials" }), { status: 401 })) as any;
  const r = await bad.check(); assert.equal(r.ok, false); assert.match(r.message, /Token rejected/);
});

test("shard cache: unchanged shards are not re-serialized, changed ones are", async () => {
  const cache = new Map();
  const cards = [mkCard("1", 1), mkCard("2", 1)];
  const a = await GitHubSync.shard({ notetypes: [], notes: [], cards, reviews: [], settings: {} }, cache);
  const sizeBefore = cache.size;
  cards[0] = { ...cards[0], mod: 2 };
  const b = await GitHubSync.shard({ notetypes: [], notes: [], cards, reviews: [], settings: {} }, cache);
  assert.equal(cache.size, sizeBefore);
  const changed = Object.keys(a.hashes).filter((p) => a.hashes[p] !== b.hashes[p]);
  assert.equal(changed.length, 1, "exactly one card shard changed: " + changed.join());
});

test("tombstones: a deleted note does not come back from remote, later edits do", async () => {
  const local = new Map<string, any>(); const tombs = { "n:a": 1000, "c:x": 1000 };
  assert.equal(mergeNotes(local, [{ id: "a", modified: 900 } as any], tombs), 0);
  assert.equal(mergeNotes(local, [{ id: "a", modified: 1001 } as any], tombs), 1, "an edit after the deletion wins");
  const cards = new Map<string, any>();
  assert.equal(mergeCards(cards, [{ id: "x", nid: "b", mod: 500 } as any, { id: "y", nid: "a", mod: 500 } as any], tombs), 0, "card tombstone and note tombstone both apply");
  assert.deepEqual(mergeTombstones({ "n:a": 5 }, { "n:a": 3, "n:b": 9 }), { "n:a": 5, "n:b": 9 });
});

test("large shards are stored gzip-compressed and round-trip; changing one card re-uploads kilobytes", async () => {
  const gh = fakeGitHub(); const A = client(gh), B = client(gh);
  const cards = Array.from({ length: 40000 }, (_, i) => mkCard(String(i), 1));
  const s1 = await GitHubSync.shard({ notetypes: [], notes: [], cards, reviews: [], settings: { updatedAt: 1 } });
  const r1 = await A.push(s1.hashes, s1.make, null, "A");
  assert.ok(Object.values(r1.manifest.stored ?? {}).some((p) => p.endsWith(".gz")), "some shards gzipped");
  const got = await B.pullChanged((await B.pullManifest())!, {});
  assert.equal(got.cards!.length, 40000, "all cards come back through gunzip");
  cards[7] = { ...cards[7], mod: 2, reps: 2 };
  const s2 = await GitHubSync.shard({ notetypes: [], notes: [], cards, reviews: [], settings: { updatedAt: 1 } });
  const r2 = await A.push(s2.hashes, s2.make, (await A.pullManifest())!, "A");
  assert.equal(r2.pushed, 1); assert.ok(r2.bytes < 20000, `one review should upload a few KB, got ${r2.bytes}`);
});
