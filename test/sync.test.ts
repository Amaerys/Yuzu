import { test } from "node:test";
import assert from "node:assert/strict";
import { GitHubSync, mergeCards, mergeNotes, mergeReviews } from "../src/lib/sync.ts";
import type { Card, Note } from "../src/lib/model.ts";

// In-memory fake of the parts of the GitHub API that sync uses.
function fakeGitHub() {
  const blobs = new Map<string, string>();
  const trees = new Map<string, Record<string, string>>(); // tree sha -> path -> blob sha
  const commits = new Map<string, { tree: string; parents: string[] }>();
  let head: string | null = null;
  let n = 0; const sha = () => `sha${++n}`;
  const dec = (b64: string) => Buffer.from(b64, "base64").toString("utf8");
  const fetchImpl = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const u = new URL(url); const p = u.pathname.replace(/^\/repos\/o\/r/, ""); const m = init.method ?? "GET";
    const json = (x: any, status = 200) => new Response(JSON.stringify(x), { status });
    const body = init.body ? JSON.parse(init.body as string) : null;
    if (p === "" && m === "GET") return json({ full_name: "o/r", private: true, permissions: { push: true } });
    if (p.startsWith("/contents/") && m === "GET") {
      if (!head) return new Response("", { status: 404 });
      const path = decodeURIComponent(p.slice(10));
      const tree = trees.get(commits.get(head)!.tree)!;
      const b = tree[path]; if (!b) return new Response("", { status: 404 });
      return new Response(blobs.get(b)!, { status: 200 });
    }
    if (p === "/git/ref/heads/main") return head ? json({ object: { sha: head } }) : new Response(JSON.stringify({ message: "Git Repository is empty." }), { status: 409 });
    if (p.startsWith("/git/commits/") && m === "GET") return json({ tree: { sha: commits.get(p.slice(13))!.tree } });
    if (p === "/contents/.yuzu" && m === "PUT") { const b = sha(); blobs.set(b, dec(body.content)); const t = sha(); trees.set(t, { ".yuzu": b }); const c = sha(); commits.set(c, { tree: t, parents: [] }); head = c; return json({ commit: { sha: c } }); }
    if (!head && p.startsWith("/git/")) return new Response(JSON.stringify({ message: "Git Repository is empty." }), { status: 409 });
    if (p === "/git/blobs" && m === "POST") { const s = sha(); blobs.set(s, dec(body.content)); return json({ sha: s }); }
    if (p === "/git/trees" && m === "POST") {
      const base = body.base_tree ? { ...trees.get(body.base_tree)! } : {};
      for (const t of body.tree) { if (t.sha === null) delete base[t.path]; else base[t.path] = t.sha; }
      const s = sha(); trees.set(s, base); return json({ sha: s });
    }
    if (p === "/git/commits" && m === "POST") { const s = sha(); commits.set(s, { tree: body.tree, parents: body.parents }); return json({ sha: s }); }
    if (p === "/git/refs/heads/main" && m === "PATCH") { head = body.sha; return json({}); }
    if (p === "/git/refs" && m === "POST") { head = body.sha; return json({}); }
    return new Response("nope " + m + " " + p, { status: 500 });
  };
  return { fetchImpl, files: () => (head ? trees.get(commits.get(head)!.tree)! : {}), commits: () => commits.size };
}

const mkCard = (id: string, mod: number): Card => ({ id, nid: "n" + id, ord: 0, state: "review", suspended: false, flag: 0, due: 0, stability: 5, difficulty: 5, reps: 1, lapses: 0, lastReview: mod, step: 0, created: 0, mod, source: "Medicine" });
const mkNote = (id: string, modified: number, text = "x"): Note => ({ id, ntid: "t", guid: id, fields: [text], tags: [], created: 0, modified });

test("two devices converge through push/pull with last-change-wins", async () => {
  const gh = fakeGitHub();
  const origFetch = globalThis.fetch;
  globalThis.fetch = gh.fetchImpl as any;
  try {
    const cfg = { owner: "o", repo: "r", token: "t" };
    const A = new GitHubSync(cfg), B = new GitHubSync(cfg);
    // Device A pushes its state.
    const aCards = new Map([["1", mkCard("1", 100)], ["2", mkCard("2", 100)]]);
    const aNotes = new Map([["n1", mkNote("n1", 100)]]);
    const snapA = () => ({ notetypes: [], notes: [...aNotes.values()], cards: [...aCards.values()], reviews: [{ id: "1-100", cid: "1", ts: 100, rating: 3 as const, state: "review" as const, elapsedDays: 0, scheduledDays: 1, durationMs: 0 }], settings: { updatedAt: 1 } });
    const r1 = await A.push(GitHubSync.shard(snapA()), null, "A");
    assert.ok(r1.pushed > 0);
    // Device B starts empty, pulls everything.
    const man = (await B.pullManifest())!;
    const got = await B.pullChanged(man, {});
    const bCards = new Map<string, Card>(); const bNotes = new Map<string, Note>(); let bReviews: any[] = [];
    mergeCards(bCards, got.cards!); mergeNotes(bNotes, got.notes!); bReviews = mergeReviews(bReviews, got.reviews!).list;
    assert.equal(bCards.size, 2); assert.equal(bNotes.size, 1); assert.equal(bReviews.length, 1);
    // B reviews card 1 later; A suspends card 2 at the same time (older mod on card 1).
    bCards.set("1", { ...bCards.get("1")!, mod: 200, lastReview: 200, reps: 2 });
    bReviews.push({ id: "1-200", cid: "1", ts: 200, rating: 3, state: "review", elapsedDays: 1, scheduledDays: 2, durationMs: 0 });
    const r2 = await B.push(GitHubSync.shard({ notetypes: [], notes: [...bNotes.values()], cards: [...bCards.values()], reviews: bReviews, settings: { updatedAt: 1 } }), man, "B");
    assert.ok(r2.pushed >= 1 && r2.pushed <= 3, "only changed shards pushed: " + r2.pushed);
    aCards.set("2", { ...aCards.get("2")!, suspended: true, mod: 150 });
    // A syncs: pulls B's changes (card 1 newer there), keeps its own card 2 (newer locally), pushes.
    const man2 = (await A.pullManifest())!;
    const gotA = await A.pullChanged(man2, r1.manifest.files);
    mergeCards(aCards, gotA.cards!);
    const mergedReviews = mergeReviews(snapA().reviews, gotA.reviews ?? []);
    assert.equal(aCards.get("1")!.reps, 2, "B's newer review state wins");
    assert.equal(aCards.get("2")!.suspended, true, "A's newer suspend survives");
    assert.equal(mergedReviews.list.length, 2);
    const r3 = await A.push(GitHubSync.shard({ ...snapA(), cards: [...aCards.values()], reviews: mergedReviews.list }), man2, "A");
    assert.ok(r3.pushed >= 1);
    // Final remote state has both changes.
    const man3 = (await B.pullManifest())!;
    const fin = await B.pullChanged(man3, {});
    const finCards = new Map<string, Card>(); mergeCards(finCards, fin.cards!);
    assert.equal(finCards.get("1")!.reps, 2); assert.equal(finCards.get("2")!.suspended, true);
    assert.equal(fin.reviews!.length, 2);
    // Nothing to push when unchanged.
    const r4 = await B.push(GitHubSync.shard({ notetypes: [], notes: fin.notes!, cards: [...finCards.values()], reviews: fin.reviews!, settings: fin.settings as any }), man3, "B");
    assert.equal(r4.pushed, 0);
  } finally { globalThis.fetch = origFetch; }
});

test("tombstones: a deleted note does not come back from remote, later edits do", async () => {
  const { mergeNotes, mergeCards, mergeTombstones } = await import("../src/lib/sync.ts");
  const local = new Map<string, any>(); const tombs = { "n:a": 1000, "c:x": 1000 };
  assert.equal(mergeNotes(local, [{ id: "a", modified: 900 } as any], tombs), 0);
  assert.equal(mergeNotes(local, [{ id: "a", modified: 1001 } as any], tombs), 1, "an edit after the deletion wins");
  const cards = new Map<string, any>();
  assert.equal(mergeCards(cards, [{ id: "x", nid: "b", mod: 500 } as any, { id: "y", nid: "a", mod: 500 } as any], tombs), 0, "card tombstone and note tombstone both apply");
  assert.deepEqual(mergeTombstones({ "n:a": 5 }, { "n:a": 3, "n:b": 9 }), { "n:a": 5, "n:b": 9 });
});
