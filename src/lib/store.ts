// In-memory collection + persistence + derived views (category tree, study queue, stats).
import type { Card, CardState, Note, Notetype, Rating, Review } from "./model";
import * as db from "./db";
import { rate, DEFAULT_CONFIG, type SchedulerConfig, DAY } from "../scheduler/fsrs";
import type { ImportResult } from "../import/anki";
import { GitHubSync, mergeCards, mergeNotes, mergeReviews, type Manifest, type SyncConfig } from "./sync";

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
  sync: { owner: string; repo: string; token: string; auto: boolean };
}
export const DEFAULT_SETTINGS: Settings = {
  newPerDay: 20, dailyGoal: 60, rollover: 4, scheduler: DEFAULT_CONFIG, deviceName: "", nightCards: true, swipe: true, burySiblings: true, restDays: 1,
  sync: { owner: "", repo: "yuzu-data", token: "", auto: true },
};
export interface SyncStatus { state: "idle" | "syncing" | "ok" | "error" | "off"; message: string; at: number }

export type View = "decks" | "systems" | "specialties" | "tags";
export const VIEWS: { id: View; label: string }[] = [
  { id: "decks", label: "Decks" }, { id: "systems", label: "Systems" }, { id: "specialties", label: "Specialties" }, { id: "tags", label: "Tags" },
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
  reviews: Review[] = [];
  settings: Settings = { ...DEFAULT_SETTINGS };
  loaded = false;
  syncStatus: SyncStatus = { state: "off", message: "Not set up", at: 0 };
  private dirty = false;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<Listener>();
  private version = 0;
  private treeCache = new Map<View, { v: number; tree: TreeNode }>();

  subscribe = (l: Listener) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  getVersion = () => this.version;
  private bump() { this.version++; this.treeCache.clear(); for (const l of this.listeners) l(); }
  private touch() { this.dirty = true; this.scheduleSync(); }

  // ---- sync ---------------------------------------------------------------
  syncConfigured(): boolean { const s = this.settings.sync; return !!(s.owner && s.repo && s.token); }
  scheduleSync(delay = 8000) {
    if (!this.syncConfigured() || !this.settings.sync.auto) return;
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => { this.syncTimer = null; this.sync().catch(() => {}); }, delay);
  }
  private setSync(state: SyncStatus["state"], message: string) { this.syncStatus = { state, message, at: Date.now() }; this.bump(); }

  async sync(): Promise<void> {
    if (!this.syncConfigured()) { this.setSync("off", "Not set up"); return; }
    if (this.syncStatus.state === "syncing") return;
    if (!navigator.onLine) { this.setSync("error", "Offline — will retry"); return; }
    const cfg: SyncConfig = { owner: this.settings.sync.owner, repo: this.settings.sync.repo, token: this.settings.sync.token };
    const gh = new GitHubSync(cfg);
    this.setSync("syncing", "Syncing…");
    try {
      const known = await db.getMeta<Record<string, string>>("syncKnown", {});
      const remote = await gh.pullManifest();
      let pulledN = 0, pulledC = 0, pulledR = 0;
      if (remote) {
        const got = await gh.pullChanged(remote, known);
        if (got.notetypes) { for (const nt of got.notetypes) this.notetypes.set(nt.id, nt); await db.putMany("notetypes", got.notetypes); }
        if (got.notes) { const before = new Map(this.notes); pulledN = mergeNotes(this.notes, got.notes); const changed = got.notes.filter((n) => this.notes.get(n.id) === n && before.get(n.id) !== n); await db.putMany("notes", changed); }
        if (got.cards) { const changed: Card[] = []; for (const c of got.cards) { const l = this.cards.get(c.id); if (!l || (c.mod ?? c.lastReview) > (l.mod ?? l.lastReview)) changed.push(c); } pulledC = mergeCards(this.cards, got.cards); await db.putMany("cards", changed); }
        if (got.reviews) { const m = mergeReviews(this.reviews, got.reviews); pulledR = m.added; if (m.added) { const ids = new Set(this.reviews.map((r) => r.id)); await db.putMany("reviews", got.reviews.filter((r) => !ids.has(r.id))); this.reviews = m.list; } }
        if (got.settings && (got.settings as any).updatedAt > ((this.settings as any).updatedAt ?? 0)) {
          const { sync: _s, ...rest } = got.settings as any; this.settings = { ...this.settings, ...rest }; await db.setMeta("settings", this.settings);
        }
      }
      const files = GitHubSync.shard({
        notetypes: [...this.notetypes.values()], notes: [...this.notes.values()], cards: [...this.cards.values()], reviews: this.reviews,
        settings: { ...this.settings, sync: undefined, updatedAt: (this.settings as any).updatedAt ?? 0 },
      });
      const res = await gh.push(files, remote, this.settings.deviceName);
      await db.setMeta("syncKnown", res.manifest.files);
      this.dirty = false;
      const parts = [];
      if (pulledN + pulledC + pulledR) parts.push(`pulled ${pulledC} cards, ${pulledR} reviews`);
      if (res.pushed) parts.push(`pushed ${res.pushed} files`);
      this.setSync("ok", parts.length ? parts.join(", ") : "Up to date");
      this.bump();
    } catch (e: any) {
      this.setSync("error", e?.message ?? String(e));
    }
  }

  /** Paths a card belongs to in a given view (a card can sit in several categories). */
  paths(c: Card, view: View): string[] {
    if (view === "decks") return [c.source];
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
    const p = n.tags.filter((t) => !t.startsWith("auto::"));
    return p.length ? p : ["Untagged"];
  }

  async load() {
    const snap = await db.loadSnapshot();
    this.notetypes = new Map(snap.notetypes.map((n) => [n.id, n]));
    this.notes = new Map(snap.notes.map((n) => [n.id, n]));
    this.cards = new Map(snap.cards.map((c) => [c.id, c]));
    this.reviews = snap.reviews.sort((a, b) => a.ts - b.ts);
    const saved = await db.getMeta<Partial<Settings>>("settings", {});
    this.settings = { ...DEFAULT_SETTINGS, ...saved, sync: { ...DEFAULT_SETTINGS.sync, ...(saved.sync ?? {}) }, scheduler: { ...DEFAULT_CONFIG, ...(saved.scheduler ?? {}) } };
    this.loaded = true;
    if (this.syncConfigured()) this.syncStatus = { state: "idle", message: "Ready", at: 0 };
    this.bump();
    if (typeof window !== "undefined") {
      this.scheduleSync(1500);
      window.addEventListener("online", () => this.scheduleSync(2000));
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") this.scheduleSync(2000); });
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
    for (const n of res.notes) {
      const existing = this.notes.get(n.id);
      if (!existing) newNotes++; else if (existing.modified < n.modified) updated++; else continue;
      this.notes.set(n.id, n);
    }
    const knownReviewIds = new Set(this.reviews.map((r) => r.id));
    for (const c of res.cards) {
      const existing = this.cards.get(c.id);
      if (!existing) { this.cards.set(c.id, c); newCards++; continue; }
      // Whichever side has the more recent review keeps its scheduling state.
      if (c.lastReview >= existing.lastReview) this.cards.set(c.id, { ...c, flag: existing.flag });
      else this.cards.set(c.id, { ...existing, source: c.source });
    }
    const addedReviews = res.reviews.filter((r) => !knownReviewIds.has(r.id));
    this.reviews = this.reviews.concat(addedReviews).sort((a, b) => a.ts - b.ts);
    onProgress?.("Saving note types", 0.05);
    await db.putMany("notetypes", res.notetypes);
    onProgress?.("Saving notes", 0.1);
    await db.putMany("notes", res.notes, 1000, (f) => onProgress?.("Saving notes", 0.1 + f * 0.4));
    onProgress?.("Saving cards", 0.5);
    await db.putMany("cards", res.cards, 2000, (f) => onProgress?.("Saving cards", 0.5 + f * 0.3));
    onProgress?.("Saving reviews", 0.8);
    await db.putMany("reviews", addedReviews, 5000, (f) => onProgress?.("Saving reviews", 0.8 + f * 0.2));
    await db.setMeta("lastImport", { at: Date.now(), summary: res.summary });
    this.bump(); this.touch();
    return { newNotes, newCards, updated, reviews: addedReviews.length };
  }

  async wipe() {
    await db.clearAll();
    this.notetypes.clear(); this.notes.clear(); this.cards.clear(); this.reviews = [];
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

  cardsIn(path: string, view: View = "decks"): Card[] {
    const out: Card[] = [];
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
    const { card: next, review } = rate(card, g, now, this.settings.scheduler, durationMs);
    this.cards.set(cardId, next);
    this.reviews.push(review);
    await Promise.all([db.putOne("cards", next), db.putOne("reviews", review), db.setMeta("undo:" + review.id, card)]);
    this.bump(); this.touch();
    return next;
  }

  async undoLast(): Promise<boolean> {
    const last = this.reviews[this.reviews.length - 1];
    if (!last || last.ts < Date.now() - 10 * 60000) return false;
    const prev = await db.getMeta<Card | null>("undo:" + last.id, null);
    if (!prev) return false;
    this.cards.set(prev.id, prev);
    this.reviews.pop();
    await Promise.all([db.putOne("cards", prev), db.deleteMany("reviews", [last.id])]);
    this.bump();
    return true;
  }

  async updateNote(noteId: string, fields: string[], userTags: string[]) {
    const n = this.notes.get(noteId); if (!n) return;
    const auto = n.tags.filter((t) => t.startsWith("auto::"));
    const next = { ...n, fields, tags: [...new Set([...userTags, ...auto])], modified: Date.now() };
    this.notes.set(noteId, next); await db.putOne("notes", next); this.bump(); this.touch();
  }

  async setSuspended(cardId: string, suspended: boolean) {
    const c = this.cards.get(cardId); if (!c) return;
    const next = { ...c, suspended, mod: Date.now() }; this.cards.set(cardId, next); await db.putOne("cards", next); this.bump(); this.touch();
  }
  async setFlag(cardId: string, flag: number) {
    const c = this.cards.get(cardId); if (!c) return;
    const next = { ...c, flag, mod: Date.now() }; this.cards.set(cardId, next); await db.putOne("cards", next); this.bump(); this.touch();
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
    if (!days.has(d)) d--;
    while (days.has(d)) { streak++; d--; }
    // Level: each level needs 15% more than the last, starting at 500 XP.
    let level = 1, floor = 0, need = 500;
    while (xp >= floor + need) { floor += need; need = Math.round(need * 1.15); level++; }
    return { today, goal: this.settings.dailyGoal, streak, xp, level, levelFloor: floor, levelCeil: floor + need, todayXp };
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
