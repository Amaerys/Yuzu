// In-memory collection + persistence + derived views (category tree, study queue, stats).
import type { Card, CardState, Note, Notetype, Rating, Review } from "./model";
import * as db from "./db";
import { rate, replay, retrievability, DEFAULT_CONFIG, type SchedulerConfig, DAY } from "../scheduler/fsrs";
import { fit as fitWeights, calibration as calib } from "../scheduler/optimize";
import type { ImportResult } from "../import/anki";
import { parsePack, describePack } from "../import/pack";
import { SIMILAR_TAG, mergeInto, similarPairs } from "./dupes";
import { GitHubSync, SyncError, mergeCards, mergeNotes, mergeReviews, mergeTombstones, type ShardCache, type SyncConfig } from "./sync";

export interface Settings {
  newPerDay: number;
  dailyGoal: number;      // reviews per day
  rollover: number;       // hour of day when a new day starts
  scheduler: SchedulerConfig;
  deviceName: string;
  nightCards: boolean;
  swipe: boolean;
  burySiblings: boolean;
  restDays: number;       // streak-protected days per week
  pins: { view: View; path: string }[];
  /** Scheduler fit: when it last ran, on how many predictions, and the log-loss before/after. */
  fit: { at: number; n: number; before: number; after: number } | null;
  /** Mastery thresholds in days of stability. */
  mastery: { developing: number; mastered: number; durable: number };
  leechThreshold: number;
  /** Boss fight results per node key (view:path). */
  bosses: Record<string, { at: number; score: number; best: number; passed: boolean }>;
  typeAnswers: boolean;
  smart: SmartDeck[];
  sync: { owner: string; repo: string; token: string; auto: boolean };
}
export const DEFAULT_SETTINGS: Settings = {
  newPerDay: 20, dailyGoal: 60, rollover: 4, scheduler: DEFAULT_CONFIG, deviceName: "", nightCards: true, swipe: true, burySiblings: true, restDays: 1,
  sync: { owner: "", repo: "yuzu-data", token: "", auto: true }, pins: [], smart: [],
  fit: null, mastery: { developing: 7, mastered: 30, durable: 90 }, leechThreshold: 8, bosses: {}, typeAnswers: true,
};
export interface SmartDeck { id: string; name: string; systems: string[]; specialties: string[]; decks: string[]; tags: string[]; states: CardState[] }
export interface SyncStatus { state: "idle" | "syncing" | "ok" | "error" | "off"; message: string; at: number; pending?: boolean }
export interface SyncLogEntry { at: number; ok: boolean; message: string; ms: number }

export type View = "decks" | "systems" | "specialties" | "exams" | "tags" | "smart";
export const VIEWS: { id: View; label: string }[] = [
  { id: "decks", label: "Decks" }, { id: "systems", label: "Systems" }, { id: "specialties", label: "Specialties" }, { id: "exams", label: "Exams" }, { id: "tags", label: "Tags" },
];

export interface TreeNode {
  name: string; path: string; children: TreeNode[];
  total: number; due: number; newCount: number; learning: number; suspended: number; reviewed: number;
}

export interface Stats { today: number; goal: number; streak: number; xp: number; level: number; levelFloor: number; levelCeil: number; todayXp: number }

type Listener = () => void;

export class Store {
  notetypes = new Map<string, Notetype>();
  notes = new Map<string, Note>();
  cards = new Map<string, Card>();
  tombstones: Record<string, number> = {};
  reviews: Review[] = [];
  media = new Map<string, Blob>();
  private mediaUrls = new Map<string, string>();
  settings: Settings = { ...DEFAULT_SETTINGS };
  loaded = false;
  syncStatus: SyncStatus = { state: "off", message: "Not set up", at: 0 };
  private dirty = false;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private syncAgain = false;
  private shardCache: ShardCache = new Map();
  syncLog: SyncLogEntry[] = [];
  private listeners = new Set<Listener>();
  private version = 0;
  private treeCache = new Map<View, { v: number; tree: TreeNode }>();

  subscribe = (l: Listener) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  getVersion = () => this.version;
  private bump() { this.version++; this.treeCache.clear(); for (const l of this.listeners) l(); }
  private touch() { if (!this.dirty) { this.dirty = true; db.setMeta("syncDirty", true).catch(() => {}); } this.scheduleSync(); }

  // ---- sync ---------------------------------------------------------------
  hasUnsynced(): boolean { return this.dirty; }
  syncConfigured(): boolean { const s = this.settings.sync; return !!(s.owner && s.repo && s.token); }
  scheduleSync(delay = 8000) {
    if (!this.syncConfigured() || !this.settings.sync.auto) return;
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => { this.syncTimer = null; this.sync().catch(() => {}); }, delay);
  }
  private setSync(state: SyncStatus["state"], message: string) { this.syncStatus = { state, message, at: Date.now() }; this.bump(); }

  async sync(reason = "manual"): Promise<void> {
    if (!this.syncConfigured()) { this.setSync("off", "Not set up"); return; }
    if (this.syncStatus.state === "syncing") { this.syncAgain = true; return; }
    if (typeof navigator !== "undefined" && !navigator.onLine) { this.setSync("error", "Offline — will sync when back online"); return; }
    const cfg: SyncConfig = { owner: this.settings.sync.owner, repo: this.settings.sync.repo, token: this.settings.sync.token };
    const gh = new GitHubSync(cfg);
    const t0 = Date.now();
    this.setSync("syncing", "Syncing…");
    const progress = (m: string) => { this.syncStatus = { ...this.syncStatus, message: m }; this.bump(); };
    try {
      let summary = "";
      for (let attempt = 0; attempt < 3; attempt++) {
        const known = await db.getMeta<Record<string, string>>("syncKnown", {});
        const remote = await gh.pullManifest();
        let pulledN = 0, pulledC = 0, pulledR = 0;
        if (remote) {
          const got = await gh.pullChanged(remote, known, progress);
          progress("Merging");
          if (got.notetypes) { for (const nt of got.notetypes) this.notetypes.set(nt.id, nt); await db.putMany("notetypes", got.notetypes); }
          if (got.tombstones) {
            this.tombstones = mergeTombstones(this.tombstones, got.tombstones); await db.setMeta("tombstones", this.tombstones);
            const dn: string[] = [], dc: string[] = [];
            for (const [k, t] of Object.entries(got.tombstones)) {
              if (k.startsWith("n:")) { const id = k.slice(2); const n = this.notes.get(id); if (n && n.modified <= t) { this.notes.delete(id); dn.push(id); for (const c of this.cards.values()) if (c.nid === id) { this.cards.delete(c.id); dc.push(c.id); } } }
              else if (k.startsWith("c:")) { const id = k.slice(2); const c = this.cards.get(id); if (c && (c.mod ?? c.lastReview) <= t) { this.cards.delete(id); dc.push(id); } }
            }
            if (dn.length) await db.deleteMany("notes", dn); if (dc.length) await db.deleteMany("cards", dc);
          }
          if (got.notes) { const before = new Map(this.notes); pulledN = mergeNotes(this.notes, got.notes, this.tombstones); const changed = got.notes.filter((n) => this.notes.get(n.id) === n && before.get(n.id) !== n); await db.putMany("notes", changed); }
          if (got.cards) { const changed: Card[] = []; for (const c of got.cards) { const l = this.cards.get(c.id); if ((this.tombstones["c:" + c.id] ?? -1) >= (c.mod ?? c.lastReview) || (this.tombstones["n:" + c.nid] ?? -1) >= (c.mod ?? c.lastReview)) continue; if (!l || (c.mod ?? c.lastReview) > (l.mod ?? l.lastReview)) changed.push(c); } pulledC = mergeCards(this.cards, got.cards, this.tombstones); await db.putMany("cards", changed); }
          if (got.reviews) { const m = mergeReviews(this.reviews, got.reviews); pulledR = m.added; if (m.added) { const ids = new Set(this.reviews.map((r) => r.id)); await db.putMany("reviews", got.reviews.filter((r) => !ids.has(r.id))); this.reviews = m.list; } }
          if (got.settings && (got.settings as any).updatedAt > ((this.settings as any).updatedAt ?? 0)) {
            const { sync: _s, ...rest } = got.settings as any; this.settings = { ...this.settings, ...rest }; await db.setMeta("settings", this.settings);
          }
          if (pulledN + pulledC + pulledR) this.treeCache.clear();
        }
        progress("Preparing upload");
        const { files, hashes } = await GitHubSync.shard({
          notetypes: [...this.notetypes.values()], notes: [...this.notes.values()], cards: [...this.cards.values()], reviews: this.reviews, tombstones: this.tombstones,
          settings: { ...this.settings, sync: undefined, updatedAt: (this.settings as any).updatedAt ?? 0 },
        }, this.shardCache);
        try {
          const res = await gh.push(files, hashes, remote, this.settings.deviceName, progress);
          await db.setMeta("syncKnown", res.manifest.files);
          this.dirty = false; await db.setMeta("syncDirty", false);
          const parts = [];
          if (pulledN + pulledC + pulledR) parts.push(`pulled ${pulledC.toLocaleString()} cards, ${pulledR.toLocaleString()} reviews`);
          if (res.pushed) parts.push(`pushed ${res.pushed} files`);
          summary = parts.length ? parts.join(", ") : "Up to date";
          break;
        } catch (e) {
          // Another device pushed in between: pull again and retry.
          if (e instanceof SyncError && e.kind === "conflict" && attempt < 2) { progress("Another device synced at the same time — retrying"); continue; }
          throw e;
        }
      }
      this.log(true, summary, Date.now() - t0);
      this.setSync("ok", summary);
      this.bump();
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      this.log(false, msg, Date.now() - t0);
      this.setSync("error", msg);
    } finally {
      if (this.syncAgain) { this.syncAgain = false; this.scheduleSync(1000); }
    }
  }
  /** Forget the known remote hashes and the shard cache so the next sync compares everything again. */
  async resetSyncState() { await db.setMeta("syncKnown", {}); this.shardCache.clear(); this.dirty = true; await db.setMeta("syncDirty", true); }
  private log(ok: boolean, message: string, ms: number) {
    this.syncLog = [{ at: Date.now(), ok, message, ms }, ...this.syncLog].slice(0, 20);
    db.setMeta("syncLog", this.syncLog).catch(() => {});
  }


  /** Paths a card belongs to in a given view (a card can sit in several categories). */
  paths(c: Card, view: View): string[] {
    if (view === "decks" || view === "smart") return [c.source];
    const n = this.notes.get(c.nid);
    if (!n) return [];
    if (view === "systems") {
      const p = n.tags.filter((t) => t.startsWith("auto::System::")).map((t) => t.slice(14));
      return p.length ? p : ["Unclassified"];
    }
    if (view === "specialties") {
      const p = n.tags.filter((t) => t.startsWith("auto::Specialty::")).map((t) => t.slice(17));
      return p.length ? p : ["Other"];
    }
    if (view === "exams") {
      const p = n.tags.filter((t) => t.startsWith("auto::Exam::") || t.startsWith("auto::Level::")).map((t) => t.startsWith("auto::Exam::") ? t.slice(12) : "German level::" + t.slice(13));
      return p.length ? p : ["No exam"];
    }
    const p = n.tags.filter((t) => !t.startsWith("auto::") && !t.startsWith("manual::"));
    return p.length ? p : ["Untagged"];
  }

  loadError: string | null = null;
  saveError: string | null = null;
  /** Problems found while loading (orphan cards dropped, bad values fixed). Shown in Settings → Diagnostics. */
  loadNotes: string[] = [];

  /** Run a persistence write; a failure is remembered and shown instead of silently losing data. */
  protected async persist<T>(what: string, p: Promise<T>): Promise<T | undefined> {
    try { const r = await p; if (this.saveError) { this.saveError = null; this.bump(); } return r; }
    catch (e: any) {
      this.saveError = `${what}: ${e?.message ?? e}`; console.error("save failed", what, e); this.bump();
      db.setMeta("lastError", { at: Date.now(), where: what, message: String(e?.message ?? e) }).catch(() => {});
      return undefined;
    }
  }

  async load() {
    try { await this.loadInner(); }
    catch (e: any) { this.loadError = e?.message ?? String(e); console.error("load failed", e); this.bump(); throw e; }
  }
  private async loadInner() {
    const snap = await db.loadSnapshot();
    this.notetypes = new Map(snap.notetypes.map((n) => [n.id, n]));
    this.notes = new Map(snap.notes.map((n) => [n.id, n]));
    // Validate: drop cards whose note is gone, repair impossible numbers so the scheduler can never choke on them.
    const cards = new Map<string, Card>(); let orphans = 0, repaired = 0;
    for (const c of snap.cards) {
      if (!this.notes.has(c.nid)) { orphans++; continue; }
      let x = c;
      if (!Number.isFinite(x.due) || !Number.isFinite(x.stability) || !Number.isFinite(x.difficulty) || !Number.isFinite(x.mod ?? 0)) { x = { ...x, due: Number.isFinite(x.due) ? x.due : Date.now(), stability: Number.isFinite(x.stability) ? x.stability : 0, difficulty: Number.isFinite(x.difficulty) ? x.difficulty : 5, mod: Number.isFinite(x.mod ?? 0) ? x.mod : x.lastReview }; repaired++; }
      cards.set(x.id, x);
    }
    this.cards = cards;
    if (orphans) this.loadNotes.push(`${orphans} cards without a note were ignored`);
    if (repaired) this.loadNotes.push(`${repaired} cards had invalid scheduling values and were repaired`);
    this.reviews = snap.reviews.filter((r) => Number.isFinite(r.ts)).sort((a, b) => a.ts - b.ts);
    for (const m of await db.getAll<{ name: string; blob: Blob }>("media")) this.media.set(m.name, m.blob);
    const saved = await db.getMeta<Partial<Settings>>("settings", {});
    this.tombstones = await db.getMeta<Record<string, number>>("tombstones", {});
    this.dirty = await db.getMeta<boolean>("syncDirty", false);
    this.syncLog = await db.getMeta<SyncLogEntry[]>("syncLog", []);
    this.dismissedPairs = new Set(await db.getMeta<string[]>("dismissedPairs", []));
    this.mergeLog = await db.getMeta<typeof this.mergeLog>("mergeLog2", []);
    this.settings = { ...DEFAULT_SETTINGS, ...saved, sync: { ...DEFAULT_SETTINGS.sync, ...(saved.sync ?? {}) }, scheduler: { ...DEFAULT_CONFIG, ...(saved.scheduler ?? {}) } };
    this.loaded = true;
    if (this.syncConfigured()) this.syncStatus = { state: "idle", message: "Ready", at: 0 };
    this.bump();
    if (typeof window !== "undefined") {
      // Ask the browser not to evict our data under storage pressure (silently ignored where unsupported).
      navigator.storage?.persist?.().catch(() => {});
      // Re-fit the scheduler in the background once enough new reviews have accumulated.
      const since = this.settings.fit ? this.reviews.filter((r) => r.ts > this.settings.fit!.at).length : this.reviews.length;
      if (since >= 1000) setTimeout(() => { this.optimizeScheduler().catch(() => {}); }, 15000);
      this.scheduleSync(1500);
      window.addEventListener("online", () => this.scheduleSync(2000));
      // Leaving the app: push unsynced changes right away (the 8 s debounce would otherwise lose the last reviews
      // if the phone kills the tab). Coming back: pull what other devices did.
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") { if (this.dirty && this.syncConfigured()) { if (this.syncTimer) clearTimeout(this.syncTimer); this.syncTimer = null; this.sync("hidden").catch(() => {}); } }
        else this.scheduleSync(this.dirty ? 500 : 2000);
      });
    }
  }

  async saveSettings(patch: Partial<Settings>) {
    this.settings = { ...this.settings, ...patch, updatedAt: Date.now() } as Settings;
    await db.setMeta("settings", this.settings);
    this.bump(); this.touch();
  }

  /** Merge an import. Existing cards keep their Yuzu review state unless they had none. */
  async applyImport(res: ImportResult, onProgress?: (msg: string, frac: number) => void) {
    for (const nt of res.notetypes) this.notetypes.set(nt.id, nt);
    let newNotes = 0, newCards = 0, updated = 0;
    const notesOut: Note[] = []; const cardsOut: Card[] = [];
    for (const n of res.notes) {
      if ((this.tombstones["n:" + n.id] ?? -1) >= n.modified) continue; // merged away in Yuzu
      const existing = this.notes.get(n.id);
      if (!existing) newNotes++; else if (existing.modified < n.modified) updated++; else continue;
      // Keep tags added in Yuzu (auto::…, needs-review, pack tags) when Anki's version of the note is newer.
      const keepTags = existing ? existing.tags.filter((t) => t.startsWith("auto::") || t.startsWith("needs-review::") || t.startsWith("manual::") || t.startsWith("leech") || t === "ask-claude") : [];
      const importTags = existing?.tags.includes("manual::classified") ? n.tags.filter((t) => !t.startsWith("auto::")) : n.tags; // manual classification wins over the classifier
      const merged = existing ? { ...n, tags: [...new Set([...importTags, ...keepTags])] } : n;
      this.notes.set(n.id, merged); notesOut.push(merged);
    }
    const knownReviewIds = new Set(this.reviews.map((r) => r.id));
    for (const c of res.cards) {
      if ((this.tombstones["c:" + c.id] ?? -1) >= c.mod || (this.tombstones["n:" + c.nid] ?? -1) >= c.mod || !this.notes.has(c.nid)) continue;
      const existing = this.cards.get(c.id);
      if (!existing) { this.cards.set(c.id, c); cardsOut.push(c); newCards++; continue; }
      // Whichever side has the more recent review keeps its scheduling state. Yuzu owns the category (source) once imported.
      if (c.lastReview > existing.lastReview) { const m = { ...c, flag: existing.flag, source: existing.source }; this.cards.set(c.id, m); cardsOut.push(m); }
    }
    const addedReviews = res.reviews.filter((r) => !knownReviewIds.has(r.id));
    this.reviews = this.reviews.concat(addedReviews).sort((a, b) => a.ts - b.ts);
    onProgress?.("Saving note types", 0.05);
    await db.putMany("notetypes", res.notetypes);
    onProgress?.("Saving notes", 0.1);
    await db.putMany("notes", notesOut, 1000, (f) => onProgress?.("Saving notes", 0.1 + f * 0.4));
    onProgress?.("Saving cards", 0.5);
    await db.putMany("cards", cardsOut, 2000, (f) => onProgress?.("Saving cards", 0.5 + f * 0.3));
    onProgress?.("Saving reviews", 0.8);
    await db.putMany("reviews", addedReviews, 5000, (f) => onProgress?.("Saving reviews", 0.8 + f * 0.2));
    await db.setMeta("lastImport", { at: Date.now(), summary: res.summary });
    this.bump(); this.touch();
    return { newNotes, newCards, updated, reviews: addedReviews.length };
  }

  mediaUrl = (name: string): string | null => {
    const hit = this.mediaUrls.get(name); if (hit) return hit;
    const b = this.media.get(name); if (!b) return null;
    const u = URL.createObjectURL(b); this.mediaUrls.set(name, u); return u;
  };

  async importPack(json: unknown): Promise<string> {
    const r = parsePack(json, this.notes.values());
    for (const nt of r.notetypes) this.notetypes.set(nt.id, nt);
    for (const n of r.notes) this.notes.set(n.id, n);
    // Revised notes keep their existing cards (and scheduling); new cloze numbers get new cards,
    // cloze numbers that disappeared are suspended rather than deleted so sync stays consistent.
    const updated = new Set(r.updated); const cardsOut: Card[] = [];
    for (const c of r.cards) { if (updated.has(c.nid) && this.cards.has(c.id)) continue; this.cards.set(c.id, c); cardsOut.push(c); }
    if (updated.size) {
      const keep = new Set(r.cards.map((c) => c.id)); const now = Date.now();
      for (const c of this.cards.values()) if (updated.has(c.nid) && !keep.has(c.id) && !c.suspended) { const s2 = { ...c, suspended: true, mod: now }; this.cards.set(c.id, s2); cardsOut.push(s2); }
    }
    r.cards = cardsOut;
    const blobs: { name: string; blob: Blob }[] = [];
    for (const m of r.media) { const res = await fetch(m.dataUrl); const blob = await res.blob(); this.media.set(m.name, blob); blobs.push({ name: m.name, blob }); }
    await db.putMany("notetypes", r.notetypes); await db.putMany("notes", r.notes); await db.putMany("cards", r.cards); if (blobs.length) await db.putMany("media", blobs);
    this.bump(); this.touch();
    return describePack(r);
  }

  /** Apply a curation file made by Claude: deck moves, note merges (keep one note, drop the copies, union tags) and tag additions. */
  async importCuration(json: unknown, onProgress?: (msg: string, frac: number) => void): Promise<string> {
    const c = json as { yuzu_curation: 1; name?: string; decks?: Record<string, string | null>; merges?: { keep: string; drop: string[]; tags?: string[] }[]; review?: string[][]; tags?: Record<string, string[]> };
    if (!c || c.yuzu_curation !== 1) throw new Error("Not a Yuzu curation file");
    const now = Date.now();
    const changedNotes = new Map<string, Note>(); const changedCards = new Map<string, Card>();
    const delNotes: string[] = []; const delCards: string[] = [];
    const touchNote = (id: string, f: (n: Note) => void) => { const n = changedNotes.get(id) ?? this.notes.get(id); if (!n) return; const m = { ...n, tags: [...n.tags] }; f(m); m.modified = now; changedNotes.set(id, m); this.notes.set(id, m); };
    // 1. merges
    onProgress?.("Merging duplicates", 0.1);
    let merged = 0, moved = 0, tagged = 0, dropped = 0;
    const log: { keep: string; dropped: Note[]; cards: Card[] }[] = [];
    const byNid = new Map<string, Card[]>(); for (const card of this.cards.values()) (byNid.get(card.nid) ?? byNid.set(card.nid, []).get(card.nid)!).push(card);
    for (const m of c.merges ?? []) {
      if (!this.notes.has(m.keep)) continue;
      const entry = { keep: m.keep, dropped: [] as Note[], cards: [] as Card[] };
      for (const d of m.drop) {
        const n = this.notes.get(d); if (!n || d === m.keep) continue;
        entry.dropped.push(n); delNotes.push(d); this.notes.delete(d);
        for (const card of byNid.get(d) ?? []) { entry.cards.push(card); delCards.push(card.id); this.cards.delete(card.id); }
        this.tombstones["n:" + d] = now; dropped++;
      }
      if (entry.dropped.length) { log.push(entry); merged++; }
      if (m.tags?.length) touchNote(m.keep, (n) => { for (const t of m.tags!) if (!n.tags.includes(t)) n.tags.push(t); });
    }
    // 2. deck moves (exact deck path → new path; null = drop the deck)
    onProgress?.("Moving decks", 0.4);
    const decks = c.decks ?? {};
    for (const card of [...this.cards.values()]) {
      if (!(card.source in decks)) continue;
      const to = decks[card.source];
      if (to === null) { delCards.push(card.id); this.cards.delete(card.id); this.tombstones["c:" + card.id] = now; const sibs = byNid.get(card.nid) ?? []; if (sibs.every((x) => !this.cards.has(x.id)) && this.notes.has(card.nid)) { delNotes.push(card.nid); this.notes.delete(card.nid); this.tombstones["n:" + card.nid] = now; } dropped++; continue; }
      if (to === card.source) continue;
      const m = { ...card, source: to, mod: now }; this.cards.set(card.id, m); changedCards.set(card.id, m); moved++;
    }
    // 3. tags
    onProgress?.("Tagging", 0.7);
    for (const [tag, ids] of Object.entries(c.tags ?? {})) for (const id of ids) { const n = this.notes.get(id); if (n && !n.tags.includes(tag)) { touchNote(id, (x) => x.tags.push(tag)); tagged++; } }
    for (const g of c.review ?? []) for (const id of g) { const n = this.notes.get(id); if (n && !n.tags.includes("needs-review::similar")) touchNote(id, (x) => x.tags.push("needs-review::similar")); }
    onProgress?.("Saving", 0.85);
    await db.putMany("notes", [...changedNotes.values()]); await db.putMany("cards", [...changedCards.values()]);
    if (delNotes.length) await db.deleteMany("notes", delNotes); if (delCards.length) await db.deleteMany("cards", delCards);
    await db.setMeta("tombstones", this.tombstones);
    const prev = await db.getMeta<unknown[]>("mergeLog", []); await db.setMeta("mergeLog", [...prev, { at: now, name: c.name ?? "", merges: log }]);
    this.bump(); this.touch();
    return `${merged} duplicate groups merged (${dropped} notes removed), ${moved.toLocaleString()} cards moved to new categories, ${tagged.toLocaleString()} tags added${c.review?.length ? `, ${c.review.length} similar pairs tagged needs-review::similar` : ""}.`;
  }

  // ---- duplicates --------------------------------------------------------
  dismissedPairs = new Set<string>();
  mergeLog: { at: number; keep: string; dropped: Note[]; cards: Card[]; keepBefore: Note; keepCardsBefore: Card[] }[] = [];
  cardsOfNote(nid: string): Card[] { const out: Card[] = []; for (const c of this.cards.values()) if (c.nid === nid) out.push(c); return out; }
  similarPairs() { return similarPairs(this.notes.values(), this.dismissedPairs); }
  /** Merge note `drop` into `keep` (tags united, stronger scheduling kept); the dropped note can be restored from the merge log. */
  async mergeNotes(keepId: string, dropId: string) {
    const keep = this.notes.get(keepId), drop = this.notes.get(dropId); if (!keep || !drop || keepId === dropId) return;
    const now = Date.now(); const keepCards = this.cardsOfNote(keepId), dropCards = this.cardsOfNote(dropId);
    const m = mergeInto(keep, keepCards, drop, dropCards, now);
    this.notes.set(keepId, m.note); for (const c of m.cards) this.cards.set(c.id, c);
    this.notes.delete(dropId); for (const c of dropCards) this.cards.delete(c.id);
    this.tombstones["n:" + dropId] = now;
    this.mergeLog = [{ at: now, keep: keepId, dropped: [drop], cards: dropCards, keepBefore: keep, keepCardsBefore: keepCards }, ...this.mergeLog].slice(0, 200);
    await this.persist("merging the cards", (async () => {
      await db.putOne("notes", m.note); await db.putMany("cards", m.cards); await db.deleteMany("notes", [dropId]); await db.deleteMany("cards", dropCards.map((c) => c.id));
      await db.setMeta("tombstones", this.tombstones); await db.setMeta("mergeLog2", this.mergeLog);
    })());
    this.bump(); this.touch();
  }
  /** Keep both notes: drop the review tag and remember the pair so it is not offered again. */
  async keepBoth(a: string, b: string) {
    const now = Date.now(); const out: Note[] = [];
    for (const id of [a, b]) { const n = this.notes.get(id); if (n && n.tags.includes(SIMILAR_TAG)) { const m = { ...n, tags: n.tags.filter((t) => t !== SIMILAR_TAG), modified: now }; this.notes.set(id, m); out.push(m); } }
    this.dismissedPairs.add([a, b].sort().join("|"));
    await this.persist("updating the cards", (async () => { await db.putMany("notes", out); await db.setMeta("dismissedPairs", [...this.dismissedPairs]); })());
    this.bump(); this.touch();
  }
  async undoMerge(at: number) {
    const e = this.mergeLog.find((x) => x.at === at); if (!e) return;
    const now = Date.now();
    this.notes.set(e.keep, { ...e.keepBefore, modified: now }); for (const c of e.keepCardsBefore) this.cards.set(c.id, { ...c, mod: now });
    for (const n of e.dropped) { this.notes.set(n.id, { ...n, modified: now }); delete this.tombstones["n:" + n.id]; }
    for (const c of e.cards) this.cards.set(c.id, { ...c, mod: now });
    this.mergeLog = this.mergeLog.filter((x) => x.at !== at);
    await this.persist("undoing the merge", (async () => {
      await db.putMany("notes", [this.notes.get(e.keep)!, ...e.dropped.map((n) => this.notes.get(n.id)!)]);
      await db.putMany("cards", [...e.keepCardsBefore, ...e.cards].map((c) => this.cards.get(c.id)!));
      await db.setMeta("tombstones", this.tombstones); await db.setMeta("mergeLog2", this.mergeLog);
    })());
    this.bump(); this.touch();
  }

  async wipe() {
    await db.clearAll();
    this.notetypes.clear(); this.notes.clear(); this.cards.clear(); this.reviews = []; this.media.clear();
    this.bump();
  }

  // ---- derived -------------------------------------------------------------

  dayStart(now = Date.now()): number {
    const d = new Date(now);
    d.setHours(this.settings.rollover, 0, 0, 0);
    if (d.getTime() > now) d.setDate(d.getDate() - 1);
    return d.getTime();
  }

  /** Category tree for a view. Counts are per card; a card in two categories is counted in both. */
  tree(view: View = "decks"): TreeNode {
    const cached = this.treeCache.get(view);
    if (cached && cached.v === this.version) return cached.tree;
    const root: TreeNode = { name: "All", path: "", children: [], total: 0, due: 0, newCount: 0, learning: 0, suspended: 0, reviewed: 0 };
    const now = Date.now();
    const index = new Map<string, TreeNode>();
    index.set("", root);
    const getNode = (path: string): TreeNode => {
      const hit = index.get(path);
      if (hit) return hit;
      const parts = path.split("::");
      const parentPath = parts.slice(0, -1).join("::");
      const parent = getNode(parentPath);
      const node: TreeNode = { name: parts[parts.length - 1], path, children: [], total: 0, due: 0, newCount: 0, learning: 0, suspended: 0, reviewed: 0 };
      parent.children.push(node);
      index.set(path, node);
      return node;
    };
    const count = (node: TreeNode, c: Card) => {
      node.total++;
      if (c.suspended) { node.suspended++; return; }
      if (c.state === "new") node.newCount++;
      else if (c.due <= now) node.due++;
      if (c.state === "learning" || c.state === "relearning") node.learning++;
      if (c.reps > 0) node.reviewed++;
    };
    for (const c of this.cards.values()) {
      count(root, c);
      const seen = new Set<string>();
      for (const p of this.paths(c, view)) {
        const parts = p.split("::");
        for (let i = 1; i <= parts.length; i++) {
          const key = parts.slice(0, i).join("::");
          if (seen.has(key)) continue;
          seen.add(key);
          count(getNode(key), c);
        }
      }
    }
    const sortRec = (n: TreeNode) => { n.children.sort((a, b) => a.name.localeCompare(b.name)); n.children.forEach(sortRec); };
    sortRec(root);
    this.treeCache.set(view, { v: this.version, tree: root });
    return root;
  }

  /** Cards matching a smart deck: AND across groups, OR within a group. */
  cardsMatching(sd: SmartDeck): Card[] {
    const out: Card[] = [];
    for (const c of this.cards.values()) {
      if (sd.states.length && !sd.states.includes(c.state)) continue;
      if (sd.decks.length && !sd.decks.some((d) => c.source === d || c.source.startsWith(d + "::"))) continue;
      const n = this.notes.get(c.nid); if (!n) continue;
      if (sd.systems.length && !sd.systems.some((x) => n.tags.includes("auto::System::" + x))) continue;
      if (sd.specialties.length && !sd.specialties.some((x) => n.tags.includes("auto::Specialty::" + x))) continue;
      if (sd.tags.length && !sd.tags.some((x) => n.tags.some((t) => t === x || t.startsWith(x + "::")))) continue;
      out.push(c);
    }
    return out;
  }

  cardsIn(path: string, view: View = "decks"): Card[] {
    const out: Card[] = [];
    if (view === "smart") { const sd = this.settings.smart.find((x) => x.id === path); return sd ? this.cardsMatching(sd) : []; }
    if (!path) return [...this.cards.values()];
    for (const c of this.cards.values()) {
      if (this.paths(c, view).some((p) => p === path || p.startsWith(path + "::"))) out.push(c);
    }
    return out;
  }

  /** Cards reviewed today (count), for the daily goal and new-card budget. */
  reviewedToday(now = Date.now()): { reviews: number; newCards: number } {
    const start = this.dayStart(now);
    let reviews = 0; const newIds = new Set<string>();
    for (let i = this.reviews.length - 1; i >= 0; i--) {
      const r = this.reviews[i];
      if (r.ts < start) break;
      reviews++;
      if (r.state === "new") newIds.add(r.cid);
    }
    return { reviews, newCards: newIds.size };
  }

  /** Build today's queue for a scope: learning due → reviews due → new (within budget). */
  queue(path: string, now = Date.now(), view: View = "decks"): Card[] {
    const cards = this.cardsIn(path, view).filter((c) => !c.suspended);
    const learning = cards.filter((c) => (c.state === "learning" || c.state === "relearning") && c.due <= now).sort((a, b) => a.due - b.due);
    const review = cards.filter((c) => c.state === "review" && c.due <= now).sort((a, b) => a.due - b.due);
    const budget = Math.max(0, this.settings.newPerDay - this.reviewedToday(now).newCards);
    const fresh = cards.filter((c) => c.state === "new").sort((a, b) => a.due - b.due || a.created - b.created).slice(0, budget);
    // Interleave new cards among reviews so a session isn't all-new at the end.
    const out: Card[] = [...learning];
    if (this.settings.burySiblings) {
      const seenNotes = new Set<string>();
      const start = this.dayStart(now);
      for (let i = this.reviews.length - 1; i >= 0 && this.reviews[i].ts >= start; i--) { const c = this.cards.get(this.reviews[i].cid); if (c) seenNotes.add(c.nid); }
      const keep = (c: Card) => { if (seenNotes.has(c.nid)) return false; seenNotes.add(c.nid); return true; };
      for (const c of learning) seenNotes.add(c.nid);
      review.splice(0, review.length, ...review.filter(keep));
      fresh.splice(0, fresh.length, ...fresh.filter(keep));
    }
    const step = fresh.length ? Math.max(1, Math.floor((review.length + fresh.length) / fresh.length)) : Infinity;
    let fi = 0;
    for (let i = 0; i < review.length; i++) {
      out.push(review[i]);
      if ((i + 1) % step === 0 && fi < fresh.length) out.push(fresh[fi++]);
    }
    while (fi < fresh.length) out.push(fresh[fi++]);
    return out;
  }

  /** Learning cards that are due later today (shown after the main queue drains). */
  learningAhead(path: string, now = Date.now(), view: View = "decks"): Card[] {
    const end = this.dayStart(now) + DAY;
    return this.cardsIn(path, view).filter((c) => !c.suspended && (c.state === "learning" || c.state === "relearning") && c.due > now && c.due < end).sort((a, b) => a.due - b.due);
  }

  async answer(cardId: string, g: Rating, durationMs = 0, now = Date.now()) {
    const card = this.cards.get(cardId);
    if (!card) return;
    const { card: next, review, intervalDays } = rate(card, g, now, this.settings.scheduler, durationMs);
    // Hesitant "Good" (much slower than usual) earns a slightly shorter interval: correct, but not yet fluent.
    if (g === 3 && intervalDays >= 2 && durationMs > Math.max(15000, 2.5 * this.typicalAnswerMs())) next.due = now + Math.round((next.due - now) * 0.85);
    this.cards.set(cardId, next);
    this.reviews.push(review);
    // Leech: every `leechThreshold` lapses, mark the note and let the UI ask what went wrong.
    let leech = false;
    const note = this.notes.get(card.nid);
    if (g === 1 && note && next.lapses >= this.settings.leechThreshold && next.lapses % this.settings.leechThreshold === 0) {
      leech = true;
      if (!note.tags.includes("leech")) { const m = { ...note, tags: [...note.tags, "leech"], modified: now }; this.notes.set(note.id, m); await this.persist("tagging a leech", db.putOne("notes", m)); }
    }
    this.lastAnswer = { cardId, leech, lapses: next.lapses };
    await this.persist("saving the review", Promise.all([db.putOne("cards", next), db.putOne("reviews", review), db.setMeta("undo:" + review.id, card)]));
    this.bump(); this.touch();
    return next;
  }
  lastAnswer: { cardId: string; leech: boolean; lapses: number } | null = null;

  /** Record why a leech was missed; tags drive later remediation (packs from Claude, suspension). */
  async leechReason(cardId: string, reason: "knowledge" | "retrieval" | "confusion" | "suspend") {
    const c = this.cards.get(cardId); const n = c && this.notes.get(c.nid); if (!c || !n) return;
    if (reason === "suspend") { await this.setSuspended(cardId, true); return; }
    const tags = n.tags.filter((t) => !t.startsWith("leech::")).concat("leech::" + reason, ...(reason === "confusion" ? ["ask-claude"] : []));
    await this.updateNote(n.id, n.fields, tags.filter((t) => !t.startsWith("auto::")));
  }

  /** Language note types (standard, single template) that can get reverse cards. */
  reversibleNotetypes(): { nt: Notetype; notes: number; on: boolean }[] {
    const count = new Map<string, number>();
    for (const c of this.cards.values()) { if (!c.source.startsWith("Languages") || c.ord !== 0) continue; const n = this.notes.get(c.nid); if (n) count.set(n.ntid, (count.get(n.ntid) ?? 0) + 1); }
    return [...count].map(([id, n]) => ({ nt: this.notetypes.get(id)!, notes: n, on: !!this.notetypes.get(id)?.templates.some((t) => t.name === "Yuzu reverse") })).filter((x) => x.nt && x.nt.kind === "standard" && x.nt.fields.length >= 2 && (x.nt.templates.length === 1 || x.on)).sort((a, b) => b.notes - a.notes);
  }
  /** Add (or suspend) reverse cards for a language note type: back → front. */
  async setReverse(ntid: string, on: boolean) {
    const nt = this.notetypes.get(ntid); if (!nt) return; const now = Date.now();
    const hasRev = nt.templates.some((t) => t.name === "Yuzu reverse");
    if (on && !hasRev) {
      const [f1, f2] = nt.fields;
      const next = { ...nt, templates: [...nt.templates, { name: "Yuzu reverse", qfmt: `{{${f2}}}`, afmt: `{{FrontSide}}<hr id=answer>{{${f1}}}` }] };
      this.notetypes.set(ntid, next); await db.putOne("notetypes", next);
    }
    const ord = nt.templates.findIndex((t) => t.name === "Yuzu reverse"); const revOrd = ord >= 0 ? ord : nt.templates.length;
    const out: Card[] = [];
    for (const c of [...this.cards.values()]) {
      if (c.ord !== 0) continue; const n = this.notes.get(c.nid); if (!n || n.ntid !== ntid) continue;
      const id = `${c.nid}-r${revOrd}`; const existing = this.cards.get(id);
      if (on) { if (existing) { if (existing.suspended) out.push({ ...existing, suspended: false, mod: now }); } else out.push({ id, nid: c.nid, ord: revOrd, state: "new", suspended: false, flag: 0, due: now, stability: 0, difficulty: 0, reps: 0, lapses: 0, lastReview: 0, step: 0, created: now, mod: now, source: c.source }); }
      else if (existing && !existing.suspended) out.push({ ...existing, suspended: true, mod: now });
    }
    for (const c of out) this.cards.set(c.id, c);
    await this.persist("updating reverse cards", db.putMany("cards", out));
    this.bump(); this.touch();
    return out.length;
  }
  /** Rename or move a deck node: every card under `from` gets the same path with `to` in its place. */
  async renamePath(from: string, to: string): Promise<number> {
    to = to.trim().replace(/\s*::\s*/g, "::").replace(/^::|::$/g, ""); if (!from || !to || from === to) return 0;
    const now = Date.now(); const out: Card[] = [];
    for (const c of this.cards.values()) if (c.source === from || c.source.startsWith(from + "::")) out.push({ ...c, source: to + c.source.slice(from.length), mod: now });
    for (const c of out) this.cards.set(c.id, c);
    const pins = this.settings.pins.map((p) => (p.view === "decks" && (p.path === from || p.path.startsWith(from + "::")) ? { ...p, path: to + p.path.slice(from.length) } : p));
    await this.persist("renaming the category", db.putMany("cards", out)); if (pins.some((p, i) => p !== this.settings.pins[i])) await this.saveSettings({ pins });
    this.bump(); this.touch();
    return out.length;
  }
  /** Add or remove a classification tag (auto::System::X / auto::Specialty::Y) on the notes of the given cards. Manual choices survive re-imports. */
  async classify(cardIds: string[], kind: "System" | "Specialty", name: string, on: boolean): Promise<number> {
    const tag = `auto::${kind}::${name}`; const now = Date.now(); const out: Note[] = []; const seen = new Set<string>();
    for (const id of cardIds) { const c = this.cards.get(id); if (!c || seen.has(c.nid)) continue; seen.add(c.nid); const n = this.notes.get(c.nid); if (!n) continue;
      const manual = n.tags.includes("manual::classified") ? [] : ["manual::classified"]; // from now on the automatic classifier leaves this note alone
      if (on && !n.tags.includes(tag)) out.push({ ...n, tags: [...n.tags, tag, ...manual], modified: now }); else if (!on && n.tags.includes(tag)) out.push({ ...n, tags: [...n.tags.filter((t) => t !== tag), ...manual], modified: now }); }
    for (const n of out) this.notes.set(n.id, n);
    await this.persist("updating categories", db.putMany("notes", out));
    this.bump(); this.touch();
    return out.length;
  }
  cardsOfNoteType(ntid: string, ord: number): Card[] { const out: Card[] = []; for (const c of this.cards.values()) if (c.ord === ord) { const n = this.notes.get(c.nid); if (n?.ntid === ntid) out.push(c); } return out; }
  async recordBoss(key: string, score: number, passed: boolean) {
    const prev = this.settings.bosses[key]; await this.saveSettings({ bosses: { ...this.settings.bosses, [key]: { at: Date.now(), score, best: Math.max(score, prev?.best ?? 0), passed: passed || !!prev?.passed } } });
  }

  /** Median answer time over the last 200 reviews (ms), or 8 s when there is no history. */
  typicalAnswerMs(): number {
    const d = this.reviews.slice(-200).map((r) => r.durationMs).filter((x) => x > 500 && x < 120000).sort((a, b) => a - b);
    return d.length >= 20 ? d[Math.floor(d.length / 2)] : 8000;
  }

  // ---- learning engine ----------------------------------------------------
  fitting: { progress: number } | null = null;
  /** Fit FSRS weights to this user's review log, then rebuild every reviewed card's memory state with them. */
  async optimizeScheduler(): Promise<string> {
    if (this.fitting) return "Already running";
    this.fitting = { progress: 0 }; this.bump();
    try {
      const res = await fitWeights(this.reviews, this.settings.scheduler.w, { iterations: 120, yieldEvery: 1, onProgress: (i) => { this.fitting = { progress: i / 120 }; this.bump(); } });
      if (res.iterations === 0) return `Not enough history yet (${res.n} usable reviews; needs about 400). Keep studying — this runs again automatically.`;
      const gain = res.before > 0 ? (1 - res.after / res.before) * 100 : 0;
      if (gain < 0.5) { await this.saveSettings({ fit: { at: Date.now(), n: res.n, before: res.before, after: res.after } }); return "Your weights were already close to optimal; nothing changed."; }
      await this.saveSettings({ scheduler: { ...this.settings.scheduler, w: res.w }, fit: { at: Date.now(), n: res.n, before: res.before, after: res.after } });
      const n = await this.rebuildMemory();
      return `Scheduler tuned to your history: prediction error down ${gain.toFixed(0)}% over ${res.n.toLocaleString()} reviews; ${n.toLocaleString()} cards rescheduled.`;
    } finally { this.fitting = null; this.bump(); }
  }
  /** Recompute stability/difficulty/due for every reviewed card from its review log with the current weights. */
  async rebuildMemory(): Promise<number> {
    const by = new Map<string, Review[]>();
    for (const r of this.reviews) (by.get(r.cid) ?? by.set(r.cid, []).get(r.cid)!).push(r);
    const now = Date.now(); const out: Card[] = [];
    for (const [cid, list] of by) {
      const c = this.cards.get(cid); if (!c || c.state === "new") continue;
      const r = replay(c, list.sort((a, b) => a.ts - b.ts), this.settings.scheduler.w, this.settings.scheduler.desiredRetention);
      out.push({ ...r, suspended: c.suspended, flag: c.flag, source: c.source, mod: now });
    }
    for (const c of out) this.cards.set(c.id, c);
    await this.persist("rescheduling cards", db.putMany("cards", out));
    this.bump(); this.touch();
    return out.length;
  }
  calibration() { return calib(this.reviews, this.settings.scheduler.w); }
  /** Mastery label of a card from its stability and current recall. */
  masteryOf(c: Card, now = Date.now()): "unseen" | "learning" | "developing" | "mastered" | "durable" {
    if (c.state === "new" || c.reps === 0) return "unseen";
    const t = this.settings.mastery; const s = c.stability;
    if (s < t.developing) return "learning";
    if (s < t.mastered) return "developing";
    const r = retrievability((now - c.lastReview) / DAY, s);
    if (s >= t.durable && r >= 0.8) return "durable";
    return "mastered";
  }
  /** Mastery distribution and average answer time (last 30 days) per system. */
  masteryBySystem(now = Date.now()) {
    const out = new Map<string, { unseen: number; learning: number; developing: number; mastered: number; durable: number; total: number; secs: number | null }>();
    const get = (k: string) => out.get(k) ?? out.set(k, { unseen: 0, learning: 0, developing: 0, mastered: 0, durable: 0, total: 0, secs: null }).get(k)!;
    for (const c of this.cards.values()) {
      if (c.suspended) continue;
      const n = this.notes.get(c.nid); if (!n) continue;
      const m = this.masteryOf(c, now);
      for (const t of n.tags) if (t.startsWith("auto::System::")) { const e = get(t.slice(14)); e[m]++; e.total++; }
    }
    const sum = new Map<string, { ms: number; n: number }>();
    for (const r of this.reviews) {
      if (r.ts < now - 30 * DAY || !r.durationMs || r.durationMs > 120000) continue;
      const n = this.notes.get(this.cards.get(r.cid)?.nid ?? ""); if (!n) continue;
      for (const t of n.tags) if (t.startsWith("auto::System::")) { const e = sum.get(t.slice(14)) ?? sum.set(t.slice(14), { ms: 0, n: 0 }).get(t.slice(14))!; e.ms += r.durationMs; e.n++; }
    }
    for (const [k, v] of sum) if (out.has(k) && v.n >= 5) out.get(k)!.secs = v.ms / v.n / 1000;
    return out;
  }

  async undoLast(): Promise<boolean> {
    const last = this.reviews[this.reviews.length - 1];
    if (!last || last.ts < Date.now() - 10 * 60000) return false;
    const prev = await db.getMeta<Card | null>("undo:" + last.id, null);
    if (!prev) return false;
    this.cards.set(prev.id, prev);
    this.reviews.pop();
    await this.persist("undoing the review", Promise.all([db.putOne("cards", prev), db.deleteMany("reviews", [last.id])]));
    this.bump();
    return true;
  }

  async bulk(cardIds: string[], action: { suspended?: boolean; flag?: number; addTag?: string; source?: string }) {
    const now = Date.now(); const cards: Card[] = []; const notes: Note[] = [];
    for (const id of cardIds) {
      const c = this.cards.get(id); if (!c) continue;
      const next = { ...c, mod: now };
      if (action.suspended !== undefined) next.suspended = action.suspended;
      if (action.flag !== undefined) next.flag = action.flag;
      if (action.source) next.source = action.source;
      this.cards.set(id, next); cards.push(next);
      if (action.addTag) { const n = this.notes.get(c.nid); if (n && !n.tags.includes(action.addTag)) { const nn = { ...n, tags: [...n.tags, action.addTag], modified: now }; this.notes.set(n.id, nn); notes.push(nn); } }
    }
    await this.persist("saving the bulk change", (async () => { await db.putMany("cards", cards); if (notes.length) await db.putMany("notes", notes); })());
    this.bump(); this.touch();
  }

  /** Full backup as a plain object (token excluded). */
  backup() {
    const { sync, ...settings } = this.settings;
    return { app: "yuzu", version: 1, at: Date.now(), settings: { ...settings, sync: { ...sync, token: "" } }, notetypes: [...this.notetypes.values()], notes: [...this.notes.values()], cards: [...this.cards.values()], reviews: this.reviews, tombstones: this.tombstones };
  }
  async restore(data: any, onProgress?: (m: string, f: number) => void) {
    if (data?.app !== "yuzu") throw new Error("Not a Yuzu backup file");
    for (const nt of data.notetypes ?? []) this.notetypes.set(nt.id, nt);
    if (data.tombstones) { this.tombstones = mergeTombstones(this.tombstones, data.tombstones); await db.setMeta("tombstones", this.tombstones); }
    const n = mergeNotes(this.notes, data.notes ?? [], this.tombstones); const c = mergeCards(this.cards, data.cards ?? [], this.tombstones);
    const known = new Set(this.reviews.map((r) => r.id));
    const m = mergeReviews(this.reviews, data.reviews ?? []); this.reviews = m.list;
    onProgress?.("Saving", 0.3);
    await db.putMany("notetypes", data.notetypes ?? []);
    await db.putMany("notes", (data.notes ?? []).filter((x: Note) => this.notes.get(x.id) === x), 1000);
    await db.putMany("cards", (data.cards ?? []).filter((x: Card) => this.cards.get(x.id) === x), 2000);
    await db.putMany("reviews", (data.reviews ?? []).filter((r: Review) => !known.has(r.id)), 5000);
    if (data.settings) { const { sync, ...rest } = data.settings; this.settings = { ...this.settings, ...rest, sync: { ...this.settings.sync, ...(sync ?? {}), token: this.settings.sync.token || sync?.token || "" } }; await db.setMeta("settings", this.settings); }
    this.bump(); this.touch();
    return { notes: n, cards: c, reviews: m.added };
  }

  async updateNote(noteId: string, fields: string[], userTags: string[]) {
    const n = this.notes.get(noteId); if (!n) return;
    const auto = n.tags.filter((t) => t.startsWith("auto::"));
    const next = { ...n, fields, tags: [...new Set([...userTags, ...auto])], modified: Date.now() };
    this.notes.set(noteId, next); await this.persist("editing the card", db.putOne("notes", next)); this.bump(); this.touch();
  }

  async setSuspended(cardId: string, suspended: boolean) {
    const c = this.cards.get(cardId); if (!c) return;
    const next = { ...c, suspended, mod: Date.now() }; this.cards.set(cardId, next); await this.persist("suspending the card", db.putOne("cards", next)); this.bump(); this.touch();
  }
  async setFlag(cardId: string, flag: number) {
    const c = this.cards.get(cardId); if (!c) return;
    const next = { ...c, flag, mod: Date.now() }; this.cards.set(cardId, next); await this.persist("flagging the card", db.putOne("cards", next)); this.bump(); this.touch();
  }

  stats(now = Date.now()): Stats {
    const { reviews: today } = this.reviewedToday(now);
    // XP: 10 per review, +5 for Good, +8 for Easy, +2 for Hard; nothing extra for Again.
    const xpFor = (r: Review) => 10 + (r.rating === 4 ? 8 : r.rating === 3 ? 5 : r.rating === 2 ? 2 : 0);
    let xp = 0, todayXp = 0; const start = this.dayStart(now);
    for (const r of this.reviews) { const x = xpFor(r); xp += x; if (r.ts >= start) todayXp += x; }
    // Streak: consecutive days (ending today or yesterday) with at least one review.
    const days = new Set<number>();
    for (const r of this.reviews) days.add(Math.floor((r.ts - this.settings.rollover * 3600000) / DAY));
    let streak = 0; let d = Math.floor((now - this.settings.rollover * 3600000) / DAY);
    if (!days.has(d)) d--; // today isn't over yet
    // Rest days: up to `restDays` missed days per 7 don't break the streak (shift weeks happen).
    const rests: number[] = [];
    while (true) {
      if (days.has(d)) { streak++; d--; continue; }
      const recent = rests.filter((r) => r - d < 7).length;
      if (days.size && recent < this.settings.restDays && streak > 0) { rests.push(d); d--; continue; }
      break;
    }
    // Level: each level needs 15% more than the last, starting at 500 XP.
    let level = 1, floor = 0, need = 500;
    while (xp >= floor + need) { floor += need; need = Math.round(need * 1.15); level++; }
    return { today, goal: this.settings.dailyGoal, streak, xp, level, levelFloor: floor, levelCeil: floor + need, todayXp };
  }

  /** XP and level per system (from reviews of cards tagged auto::System::X). */
  systemLevels(): { name: string; xp: number; level: number; pct: number; total: number; learned: number }[] {
    const xpBy = new Map<string, number>(); const totals = new Map<string, { total: number; learned: number }>();
    const sysOf = (c: Card) => (this.notes.get(c.nid)?.tags ?? []).filter((t) => t.startsWith("auto::System::")).map((t) => t.slice(14));
    for (const c of this.cards.values()) for (const sname of sysOf(c)) { const t = totals.get(sname) ?? { total: 0, learned: 0 }; t.total++; if (c.state === "review") t.learned++; totals.set(sname, t); }
    for (const r of this.reviews) { const c = this.cards.get(r.cid); if (!c) continue; const x = 10 + (r.rating === 4 ? 8 : r.rating === 3 ? 5 : r.rating === 2 ? 2 : 0); for (const sname of sysOf(c)) xpBy.set(sname, (xpBy.get(sname) ?? 0) + x); }
    const out = [...totals.entries()].map(([name, t]) => {
      const xp = xpBy.get(name) ?? 0; let level = 1, floor = 0, need = 150; while (xp >= floor + need) { floor += need; need = Math.round(need * 1.2); level++; }
      return { name, xp, level, pct: Math.round(((xp - floor) / need) * 100), total: t.total, learned: t.learned };
    });
    return out.sort((a, b) => b.xp - a.xp || b.total - a.total);
  }

  milestones(): { id: string; title: string; detail: string; earned: boolean; at?: number }[] {
    const stats = this.stats();
    const reviewsAt = (n: number) => (this.reviews.length >= n ? this.reviews[n - 1].ts : undefined);
    const learned = [...this.cards.values()].filter((c) => c.state === "review" && !c.suspended).length;
    const sys = this.systemLevels();
    const best = sys.filter((s) => s.total >= 50).sort((a, b) => b.learned / b.total - a.learned / a.total)[0];
    const m = [
      ...[100, 1000, 5000, 10000, 25000].map((n) => ({ id: `rev${n}`, title: `${n.toLocaleString()} reviews`, detail: "all time", earned: this.reviews.length >= n, at: reviewsAt(n) })),
      ...[7, 30, 100, 365].map((n) => ({ id: `streak${n}`, title: `${n}-day streak`, detail: `current: ${stats.streak}`, earned: stats.streak >= n })),
      ...[100, 500, 2000, 5000].map((n) => ({ id: `learned${n}`, title: `${n.toLocaleString()} cards learned`, detail: `now ${learned.toLocaleString()}`, earned: learned >= n })),
      { id: "sys90", title: "A system 90% learned", detail: best ? `${best.name}: ${Math.round((best.learned / best.total) * 100)}%` : "", earned: !!best && best.learned / best.total >= 0.9 },
      ...[5, 10, 20].map((n) => ({ id: `lvl${n}`, title: `Level ${n}`, detail: `now level ${stats.level}`, earned: stats.level >= n })),
    ];
    return m;
  }

  noteFor(card: Card): Note | undefined { return this.notes.get(card.nid); }
  notetypeFor(note: Note): Notetype | undefined { return this.notetypes.get(note.ntid); }
  stateCounts(): Record<CardState | "suspended", number> {
    const out = { new: 0, learning: 0, review: 0, relearning: 0, suspended: 0 };
    for (const c of this.cards.values()) { if (c.suspended) out.suspended++; else out[c.state]++; }
    return out;
  }
}

export const store = new Store();
