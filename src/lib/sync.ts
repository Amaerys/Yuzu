// GitHub sync. Data lives in a private repo as sharded JSON files written with the Git Data API
// (one commit per sync). Merge rules: notes → later `modified` wins; cards → later `mod` wins
// (a review bumps `mod`); reviews → union by id; settings → later wins.
import type { Card, Note, Notetype, Review } from "./model";

export interface SyncConfig { owner: string; repo: string; token: string; branch?: string }
export interface Manifest { version: 1; files: Record<string, string>; updatedAt: number; device?: string }

export interface SyncSnapshot {
  notetypes: Notetype[]; notes: Note[]; cards: Card[]; reviews: Review[]; settings: Record<string, unknown>;
  /** Deleted records: "n:<noteId>" / "c:<cardId>" → time of deletion. A tombstone beats any record modified before it. */
  tombstones?: Record<string, number>;
}
export interface SyncResult { pulled: { notes: number; cards: number; reviews: number }; pushed: number; commit?: string }

const SHARDS = 16;
const shardOf = (id: string) => { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return h % SHARDS; };
const enc = new TextEncoder();

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function utf8ToBase64(s: string): string {
  const bytes = enc.encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export class GitHubSync {
  constructor(private cfg: SyncConfig) {}
  private get base() { return `https://api.github.com/repos/${this.cfg.owner}/${this.cfg.repo}`; }
  private get branch() { return this.cfg.branch ?? "main"; }
  private headers(extra: Record<string, string> = {}) {
    return { Authorization: `Bearer ${this.cfg.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...extra };
  }
  private async api(path: string, init: RequestInit = {}): Promise<any> {
    const res = await fetch(this.base + path, { ...init, headers: this.headers({ ...(init.headers as any), ...(init.body ? { "Content-Type": "application/json" } : {}) }) });
    if (res.status === 404 || res.status === 409) return null; // 409 = "Git Repository is empty" (brand-new repo, no commits yet)
    if (!res.ok) throw new Error(`GitHub ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  }

  async check(): Promise<{ ok: boolean; message: string }> {
    try {
      const repo = await this.api("");
      if (!repo) return { ok: false, message: "Repository not found. Check the name and that the token can access it." };
      if (!repo.permissions?.push) return { ok: false, message: "Token has no write access to this repository." };
      return { ok: true, message: `Connected to ${repo.full_name}${repo.private ? " (private)" : " (PUBLIC — your cards are visible to anyone)"}` };
    } catch (e: any) { return { ok: false, message: e.message }; }
  }

  private async readFile(path: string): Promise<string | null> {
    const res = await fetch(`${this.base}/contents/${path}?ref=${this.branch}`, { headers: this.headers({ Accept: "application/vnd.github.raw+json" }) });
    if (res.status === 404 || res.status === 409) return null;
    if (!res.ok) throw new Error(`GitHub ${res.status} reading ${path}`);
    return res.text();
  }

  async pullManifest(): Promise<Manifest | null> {
    const t = await this.readFile("manifest.json");
    return t ? (JSON.parse(t) as Manifest) : null;
  }

  /** Serialize a snapshot into the file map used in the repo. */
  static shard(snap: SyncSnapshot): Record<string, string> {
    const files: Record<string, string> = {};
    files["notetypes.json"] = JSON.stringify(snap.notetypes);
    files["settings.json"] = JSON.stringify(snap.settings);
    if (snap.tombstones && Object.keys(snap.tombstones).length) files["tombstones.json"] = JSON.stringify(snap.tombstones);
    const notes: Note[][] = Array.from({ length: SHARDS }, () => []);
    for (const n of snap.notes) notes[shardOf(n.id)].push(n);
    notes.forEach((list, i) => { files[`notes/${i}.json`] = JSON.stringify(list.sort((a, b) => a.id < b.id ? -1 : 1)); });
    const cards: Card[][] = Array.from({ length: SHARDS }, () => []);
    for (const c of snap.cards) cards[shardOf(c.id)].push(c);
    cards.forEach((list, i) => { files[`cards/${i}.json`] = JSON.stringify(list.sort((a, b) => a.id < b.id ? -1 : 1)); });
    const byMonth = new Map<string, Review[]>();
    for (const r of snap.reviews) { const k = new Date(r.ts).toISOString().slice(0, 7); (byMonth.get(k) ?? byMonth.set(k, []).get(k)!).push(r); }
    for (const [k, list] of byMonth) files[`reviews/${k}.json`] = JSON.stringify(list.sort((a, b) => a.ts - b.ts));
    return files;
  }

  /** Download every remote file whose hash differs from `known` and return the parsed remote snapshot parts. */
  async pullChanged(manifest: Manifest, known: Record<string, string>): Promise<Partial<SyncSnapshot> & { files: Record<string, string> }> {
    const changed = Object.entries(manifest.files).filter(([p, h]) => known[p] !== h);
    const out: Partial<SyncSnapshot> & { files: Record<string, string> } = { files: {} };
    const texts = await Promise.all(changed.map(async ([p]) => [p, await this.readFile(p)] as const));
    for (const [p, t] of texts) {
      if (t == null) continue;
      out.files[p] = manifest.files[p];
      const data = JSON.parse(t);
      if (p === "notetypes.json") out.notetypes = data;
      else if (p === "settings.json") out.settings = data;
      else if (p === "tombstones.json") out.tombstones = data;
      else if (p.startsWith("notes/")) out.notes = (out.notes ?? []).concat(data);
      else if (p.startsWith("cards/")) out.cards = (out.cards ?? []).concat(data);
      else if (p.startsWith("reviews/")) out.reviews = (out.reviews ?? []).concat(data);
    }
    return out;
  }

  /** Commit the given files (only those whose content hash differs from `remoteHashes`). Returns the new manifest. */
  async push(files: Record<string, string>, remote: Manifest | null, device: string): Promise<{ manifest: Manifest; commit: string | null; pushed: number }> {
    const hashes: Record<string, string> = {};
    for (const [p, c] of Object.entries(files)) hashes[p] = await sha256(c);
    const toWrite = Object.keys(files).filter((p) => !remote || remote.files[p] !== hashes[p]);
    const toDelete = remote ? Object.keys(remote.files).filter((p) => !(p in files)) : [];
    const manifest: Manifest = { version: 1, files: hashes, updatedAt: Date.now(), device };
    if (!toWrite.length && !toDelete.length) return { manifest: remote ?? manifest, commit: null, pushed: 0 };
    const ref = await this.api(`/git/ref/heads/${this.branch}`);
    const baseCommit = ref?.object?.sha ?? null;
    const baseTree = baseCommit ? (await this.api(`/git/commits/${baseCommit}`)).tree.sha : null;
    const tree: any[] = [];
    for (const p of toWrite) {
      const blob = await this.api("/git/blobs", { method: "POST", body: JSON.stringify({ content: utf8ToBase64(files[p]), encoding: "base64" }) });
      tree.push({ path: p, mode: "100644", type: "blob", sha: blob.sha });
    }
    for (const p of toDelete) tree.push({ path: p, mode: "100644", type: "blob", sha: null });
    const mblob = await this.api("/git/blobs", { method: "POST", body: JSON.stringify({ content: utf8ToBase64(JSON.stringify(manifest)), encoding: "base64" }) });
    tree.push({ path: "manifest.json", mode: "100644", type: "blob", sha: mblob.sha });
    const newTree = await this.api("/git/trees", { method: "POST", body: JSON.stringify({ base_tree: baseTree ?? undefined, tree }) });
    const commit = await this.api("/git/commits", { method: "POST", body: JSON.stringify({ message: `Yuzu sync from ${device || "device"} (${toWrite.length} files)`, tree: newTree.sha, parents: baseCommit ? [baseCommit] : [] }) });
    if (baseCommit) await this.api(`/git/refs/heads/${this.branch}`, { method: "PATCH", body: JSON.stringify({ sha: commit.sha, force: false }) });
    else await this.api("/git/refs", { method: "POST", body: JSON.stringify({ ref: `refs/heads/${this.branch}`, sha: commit.sha }) });
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
