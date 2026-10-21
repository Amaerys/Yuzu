// GitHub sync. Data lives in a private repo as sharded JSON files written with the Git Data API
// (one commit per sync). Merge rules: notes → later `modified` wins; cards → later `mod` wins
// (a review bumps `mod`); reviews → union by id; settings → later wins; tombstones → union.
//
// Robustness rules:
// - Every request retries on network errors and 5xx (3 tries, backoff). 4xx errors surface GitHub's message.
// - A brand-new repository (no commits) is bootstrapped with a first commit through the Contents API,
//   because the Git Data API refuses to create blobs or trees in an empty repository.
// - A push that loses a race with another device (non-fast-forward) is retried after re-pulling.
// - Only shards whose fingerprint changed are re-serialized and hashed; unchanged shards reuse cached hashes.
import type { Card, Note, Notetype, Review } from "./model";

export interface SyncConfig { owner: string; repo: string; token: string; branch?: string }
export interface Manifest { version: 1; files: Record<string, string>; updatedAt: number; device?: string }

export interface SyncSnapshot {
  notetypes: Notetype[]; notes: Note[]; cards: Card[]; reviews: Review[]; settings: Record<string, unknown>;
  /** Deleted records: "n:<noteId>" / "c:<cardId>" → time of deletion. A tombstone beats any record modified before it. */
  tombstones?: Record<string, number>;
  /** Small pack images as data URLs (name → data URL). Deck media is per device and never synced. */
  media?: Record<string, string>;
}
export interface SyncResult { pulled: { notes: number; cards: number; reviews: number }; pushed: number; commit?: string }
export type Progress = (message: string) => void;

export const NOTE_SHARDS = 32, CARD_SHARDS = 64;
const shardOf = (id: string, n: number) => { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return h % n; };
const enc = new TextEncoder();

export async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function utf8ToBase64(s: string): string {
  const bytes = enc.encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export class SyncError extends Error {
  constructor(message: string, public kind: "auth" | "notfound" | "conflict" | "network" | "ratelimit" | "other" = "other") { super(message); }
}

/** Cache of serialized shards: path → { fp (fingerprint of the records), json, hash }. */
export type ShardCache = Map<string, { fp: string; json: string; hash: string }>;

export class GitHubSync {
  fetchImpl: typeof fetch = (...a) => fetch(...a);
  constructor(private cfg: SyncConfig) {}
  private get base() { return `https://api.github.com/repos/${this.cfg.owner}/${this.cfg.repo}`; }
  private get branch() { return this.cfg.branch ?? "main"; }
  private headers(extra: Record<string, string> = {}) {
    return { Authorization: `Bearer ${this.cfg.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...extra };
  }

  /** fetch with retries on network failures and 5xx. */
  private async request(url: string, init: RequestInit): Promise<Response> {
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
      try {
        const res = await this.fetchImpl(url, init);
        if (res.status >= 500) { lastErr = new SyncError(`GitHub is having trouble (${res.status}); will retry`, "network"); continue; }
        return res;
      } catch (e: any) { lastErr = new SyncError(`Network error: ${e?.message ?? e}`, "network"); }
    }
    throw lastErr;
  }

  private async explain(res: Response, what: string): Promise<SyncError> {
    let msg = ""; try { msg = (await res.json())?.message ?? ""; } catch { /* no body */ }
    if (res.status === 401) return new SyncError("Token rejected (401). Create a new fine-grained token with Contents: read and write for this repository.", "auth");
    if (res.status === 403 && /rate limit/i.test(msg)) return new SyncError("GitHub rate limit reached; try again in a few minutes.", "ratelimit");
    if (res.status === 403) return new SyncError(`No permission to ${what} (403). The token needs Contents: read and write on ${this.cfg.owner}/${this.cfg.repo}.`, "auth");
    if (res.status === 404) return new SyncError(`Repository ${this.cfg.owner}/${this.cfg.repo} not found, or the token cannot see it.`, "notfound");
    if (res.status === 409 || res.status === 422) return new SyncError(`Conflict while trying to ${what}: ${msg || res.status}`, "conflict");
    return new SyncError(`GitHub ${res.status} while trying to ${what}: ${msg}`.trim(), "other");
  }

  /** JSON API call. GET returning 404/409 (missing path, empty repository) → null. Everything else that fails throws a SyncError. */
  private async api(path: string, init: RequestInit = {}, what = `${init.method ?? "GET"} ${path}`): Promise<any> {
    const res = await this.request(this.base + path, { ...init, headers: this.headers({ ...(init.headers as any), ...(init.body ? { "Content-Type": "application/json" } : {}) }) });
    if (!init.method && (res.status === 404 || res.status === 409)) return null;
    if (!res.ok) throw await this.explain(res, what);
    return res.json();
  }

  async check(): Promise<{ ok: boolean; message: string }> {
    try {
      const repo = await this.api("");
      if (!repo) return { ok: false, message: `Repository ${this.cfg.owner}/${this.cfg.repo} not found. Check the name and that the token can access it.` };
      if (!repo.permissions?.push) return { ok: false, message: "Token has no write access to this repository (needs Contents: read and write)." };
      const m = await this.pullManifest();
      const state = m ? `holds a Yuzu sync from ${m.device || "another device"} (${new Date(m.updatedAt).toLocaleString()})` : "is empty — the first sync will fill it";
      return { ok: true, message: `Connected to ${repo.full_name}${repo.private ? "" : " (PUBLIC — your cards are visible to anyone)"}; it ${state}.` };
    } catch (e: any) { return { ok: false, message: e.message }; }
  }

  private async readFile(path: string): Promise<string | null> {
    const res = await this.request(`${this.base}/contents/${path}?ref=${this.branch}`, { headers: this.headers({ Accept: "application/vnd.github.raw+json" }) });
    if (res.status === 404 || res.status === 409) return null;
    if (!res.ok) throw await this.explain(res, `read ${path}`);
    return res.text();
  }

  /** Head commit seen by the last pullManifest(); push() refuses to build on a different one (another device synced in between). */
  private seenHead: string | null | undefined = undefined;

  async pullManifest(): Promise<Manifest | null> {
    const ref = await this.api(`/git/ref/heads/${this.branch}`);
    this.seenHead = ref?.object?.sha ?? null;
    const t = await this.readFile("manifest.json");
    if (!t) return null;
    const m = JSON.parse(t) as Manifest;
    if (!m || typeof m !== "object" || !m.files) throw new SyncError("manifest.json in the repository is not a Yuzu manifest", "other");
    return m;
  }

  /** Serialize a snapshot into the file map used in the repo. Unchanged shards (same fingerprint) reuse the cache. */
  static async shard(snap: SyncSnapshot, cache: ShardCache = new Map()): Promise<{ files: Record<string, string>; hashes: Record<string, string> }> {
    const files: Record<string, string> = {}; const hashes: Record<string, string> = {};
    const emit = async (path: string, fp: string, make: () => string) => {
      const c = cache.get(path);
      if (c && c.fp === fp) { files[path] = c.json; hashes[path] = c.hash; return; }
      const json = make(); const hash = await sha256(json);
      cache.set(path, { fp, json, hash }); files[path] = json; hashes[path] = hash;
    };
    await emit("notetypes.json", "v" + snap.notetypes.length + ":" + snap.notetypes.map((n) => n.id).join(","), () => JSON.stringify(snap.notetypes));
    await emit("settings.json", JSON.stringify(snap.settings), () => JSON.stringify(snap.settings));
    const media = snap.media ?? {};
    if (Object.keys(media).length) await emit("media.json", "m" + Object.keys(media).sort().join(","), () => JSON.stringify(media));
    const tombs = snap.tombstones ?? {};
    if (Object.keys(tombs).length) await emit("tombstones.json", "t" + Object.keys(tombs).length + ":" + Object.values(tombs).reduce((a, b) => a + b, 0), () => JSON.stringify(tombs));
    const notes: Note[][] = Array.from({ length: NOTE_SHARDS }, () => []);
    for (const n of snap.notes) notes[shardOf(n.id, NOTE_SHARDS)].push(n);
    for (let i = 0; i < NOTE_SHARDS; i++) {
      const list = notes[i]; if (!list.length) continue;
      let sum = 0, ids = 0; for (const n of list) { sum += n.modified; ids = (ids + shardOf(n.id, 1 << 30)) >>> 0; }
      await emit(`notes/${i}.json`, `${list.length}:${sum}:${ids}`, () => JSON.stringify(list.sort((a, b) => a.id < b.id ? -1 : 1)));
    }
    const cards: Card[][] = Array.from({ length: CARD_SHARDS }, () => []);
    for (const c of snap.cards) cards[shardOf(c.id, CARD_SHARDS)].push(c);
    for (let i = 0; i < CARD_SHARDS; i++) {
      const list = cards[i]; if (!list.length) continue;
      let sum = 0, ids = 0; for (const c of list) { sum += (c.mod ?? c.lastReview) + c.due + c.reps + (c.suspended ? 1 : 0) + c.flag; ids = (ids + shardOf(c.id, 1 << 30)) >>> 0; }
      await emit(`cards/${i}.json`, `${list.length}:${sum}:${ids}`, () => JSON.stringify(list.sort((a, b) => a.id < b.id ? -1 : 1)));
    }
    const byMonth = new Map<string, Review[]>();
    for (const r of snap.reviews) { const k = new Date(r.ts).toISOString().slice(0, 7); (byMonth.get(k) ?? byMonth.set(k, []).get(k)!).push(r); }
    for (const [k, list] of byMonth) await emit(`reviews/${k}.json`, `${list.length}:${list.reduce((a, r) => a + r.ts, 0)}`, () => JSON.stringify(list.sort((a, b) => a.ts - b.ts)));
    return { files, hashes };
  }

  /** Download every remote file whose hash differs from `known` and return the parsed remote snapshot parts. */
  async pullChanged(manifest: Manifest, known: Record<string, string>, progress?: Progress): Promise<Partial<SyncSnapshot> & { files: Record<string, string> }> {
    const changed = Object.entries(manifest.files).filter(([p, h]) => known[p] !== h);
    const out: Partial<SyncSnapshot> & { files: Record<string, string> } = { files: {} };
    let doneCount = 0;
    const texts: (readonly [string, string | null])[] = [];
    // Limit concurrency so a phone on a slow link does not open 100 connections at once.
    const queue = [...changed];
    const workers = Array.from({ length: 4 }, async () => {
      while (queue.length) {
        const [p] = queue.shift()!;
        const t = await this.readFile(p);
        texts.push([p, t] as const);
        doneCount++; progress?.(`Downloading ${doneCount}/${changed.length}`);
      }
    });
    await Promise.all(workers);
    for (const [p, t] of texts) {
      if (t == null) continue; // listed in the manifest but missing: skip, it will be rewritten on push
      let data: any;
      try { data = JSON.parse(t); } catch { throw new SyncError(`${p} in the repository is corrupt; sync stopped without changing anything`, "other"); }
      out.files[p] = manifest.files[p];
      if (p === "notetypes.json") out.notetypes = data;
      else if (p === "settings.json") out.settings = data;
      else if (p === "tombstones.json") out.tombstones = data;
      else if (p === "media.json") out.media = data;
      else if (p.startsWith("notes/")) out.notes = (out.notes ?? []).concat(data);
      else if (p.startsWith("cards/")) out.cards = (out.cards ?? []).concat(data);
      else if (p.startsWith("reviews/")) out.reviews = (out.reviews ?? []).concat(data);
    }
    return out;
  }

  /** Current head commit sha, bootstrapping an empty repository with a first commit if needed. */
  private async head(): Promise<string | null> {
    const ref = await this.api(`/git/ref/heads/${this.branch}`);
    if (ref?.object?.sha) return ref.object.sha;
    const repo = await this.api("");
    if (!repo) throw new SyncError(`Repository ${this.cfg.owner}/${this.cfg.repo} not found, or the token cannot see it.`, "notfound");
    if (repo.default_branch && repo.default_branch !== this.branch) {
      const other = await this.api(`/git/ref/heads/${repo.default_branch}`);
      if (other?.object?.sha) throw new SyncError(`The repository's branch is "${repo.default_branch}" but Yuzu syncs to "${this.branch}". Create an empty repository named yuzu-data, or rename its branch to main.`, "other");
    }
    // Empty repository: create the first commit with the Contents API.
    await this.api(`/contents/.yuzu`, { method: "PUT", body: JSON.stringify({ message: "Yuzu sync data", content: utf8ToBase64("Yuzu sync data. Do not edit by hand.\n"), branch: this.branch }) }, "create the first commit");
    const again = await this.api(`/git/ref/heads/${this.branch}`);
    if (!again?.object?.sha) throw new SyncError("Could not create the first commit in the repository", "other");
    return again.object.sha;
  }

  /** Commit the given files (only those whose hash differs from the remote manifest). Returns the new manifest. */
  async push(files: Record<string, string>, hashes: Record<string, string>, remote: Manifest | null, device: string, progress?: Progress): Promise<{ manifest: Manifest; commit: string | null; pushed: number }> {
    const toWrite = Object.keys(files).filter((p) => !remote || remote.files[p] !== hashes[p]);
    const toDelete = remote ? Object.keys(remote.files).filter((p) => !(p in files)) : [];
    const manifest: Manifest = { version: 1, files: hashes, updatedAt: Date.now(), device };
    if (!toWrite.length && !toDelete.length) return { manifest: remote ?? manifest, commit: null, pushed: 0 };
    const baseCommit = await this.head();
    if (this.seenHead !== undefined && this.seenHead !== null && baseCommit !== this.seenHead) throw new SyncError("Another device synced in the meantime", "conflict");
    const baseTree = baseCommit ? (await this.api(`/git/commits/${baseCommit}`, {}, "read the last commit"))?.tree?.sha ?? null : null;
    const tree: any[] = [];
    let n = 0;
    for (const p of toWrite) {
      progress?.(`Uploading ${++n}/${toWrite.length}`);
      const blob = await this.api("/git/blobs", { method: "POST", body: JSON.stringify({ content: utf8ToBase64(files[p]), encoding: "base64" }) }, `upload ${p}`);
      tree.push({ path: p, mode: "100644", type: "blob", sha: blob.sha });
    }
    for (const p of toDelete) tree.push({ path: p, mode: "100644", type: "blob", sha: null });
    const mblob = await this.api("/git/blobs", { method: "POST", body: JSON.stringify({ content: utf8ToBase64(JSON.stringify(manifest)), encoding: "base64" }) }, "upload the manifest");
    tree.push({ path: "manifest.json", mode: "100644", type: "blob", sha: mblob.sha });
    const newTree = await this.api("/git/trees", { method: "POST", body: JSON.stringify({ base_tree: baseTree ?? undefined, tree }) }, "build the commit");
    const commit = await this.api("/git/commits", { method: "POST", body: JSON.stringify({ message: `Yuzu sync from ${device || "device"} (${toWrite.length} files)`, tree: newTree.sha, parents: baseCommit ? [baseCommit] : [] }) }, "create the commit");
    if (baseCommit) await this.api(`/git/refs/heads/${this.branch}`, { method: "PATCH", body: JSON.stringify({ sha: commit.sha, force: false }) }, "advance the branch");
    else await this.api("/git/refs", { method: "POST", body: JSON.stringify({ ref: `refs/heads/${this.branch}`, sha: commit.sha }) }, "create the branch");
    return { manifest, commit: commit.sha, pushed: toWrite.length };
  }
}

/** Union of tombstones (later deletion time wins). */
export function mergeTombstones(local: Record<string, number>, remote: Record<string, number>): Record<string, number> {
  const out = { ...local }; for (const [k, t] of Object.entries(remote)) if ((out[k] ?? -1) < t) out[k] = t; return out;
}
/** Merge remote records into local maps. Returns counts of records that changed locally. */
export function mergeNotes(local: Map<string, Note>, remote: Note[], tombs: Record<string, number> = {}): number {
  let n = 0;
  for (const r of remote) { if ((tombs["n:" + r.id] ?? -1) >= r.modified) continue; const l = local.get(r.id); if (!l || r.modified > l.modified) { local.set(r.id, r); n++; } }
  return n;
}
export function mergeCards(local: Map<string, Card>, remote: Card[], tombs: Record<string, number> = {}): number {
  let n = 0;
  for (const r of remote) {
    if ((tombs["c:" + r.id] ?? -1) >= (r.mod ?? r.lastReview) || (tombs["n:" + r.nid] ?? -1) >= (r.mod ?? r.lastReview)) continue;
    const l = local.get(r.id);
    const rm = (r as any).mod ?? r.lastReview, lm = (l as any)?.mod ?? l?.lastReview ?? -1;
    if (!l || rm > lm) { local.set(r.id, r); n++; }
  }
  return n;
}
export function mergeReviews(local: Review[], remote: Review[]): { list: Review[]; added: number } {
  const ids = new Set(local.map((r) => r.id));
  const add = remote.filter((r) => !ids.has(r.id));
  return { list: add.length ? local.concat(add).sort((a, b) => a.ts - b.ts) : local, added: add.length };
}
