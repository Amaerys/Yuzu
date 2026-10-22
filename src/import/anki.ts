// Anki package importer (.colpkg / .apkg), media-free.
// Supports the modern format (collection.anki21b, zstd + protobuf tables) and the legacy
// formats (collection.anki21 / collection.anki2, JSON in the col table).
import { ZipFile, type Inflate } from "../lib/zipfile";
import { SqliteReader, type Row } from "../lib/sqlite";
import { decodeProto, protoInt, protoString } from "../lib/proto";
import type { Card, CardState, ImportSummary, Note, Notetype, Rating, Review, Template } from "../lib/model";
import { replay, DEFAULT_W, DAY } from "../scheduler/fsrs";
import { classifyText, specialtiesFromSource } from "../lib/classify";

export interface ImportEnv {
  inflateRaw: Inflate;
  zstd?: (data: Uint8Array) => Promise<Uint8Array>;
  onProgress?: (msg: string, frac?: number) => void;
}

export interface ImportResult {
  notetypes: Notetype[];
  notes: Note[];
  cards: Card[];
  reviews: Review[];
  media: Map<string, number>;
  summary: ImportSummary;
}

const SEP31 = "\x1f";
const mediaRe = /<img[^>]+src=["']([^"']+)["']|\[sound:([^\]]+)\]/gi;

export async function openAnkiPackage(bytes: Uint8Array, env: ImportEnv): Promise<{ db: SqliteReader; format: ImportSummary["format"] }> {
  env.onProgress?.("Reading package");
  const zip = new ZipFile(new Blob([bytes as BlobPart]), env.inflateRaw);
  const byName = new Map((await zip.list()).map((e) => [e.name, e]));
  const modern = byName.get("collection.anki21b");
  if (modern) {
    if (!env.zstd) throw new Error("This export uses the new Anki format (zstd). Tick 'Support older Anki versions' when exporting, or import while online.");
    const packed = await zip.read(modern);
    env.onProgress?.("Decompressing collection");
    const sqlite = await env.zstd(packed);
    return { db: new SqliteReader(sqlite), format: "anki21b" };
  }
  const legacy = byName.get("collection.anki21") ?? byName.get("collection.anki2");
  if (!legacy) throw new Error("No collection found inside the file. Is this an Anki .apkg or .colpkg?");
  env.onProgress?.("Decompressing collection");
  const sqlite = await zip.read(legacy);
  return { db: new SqliteReader(sqlite), format: legacy.name === "collection.anki21" ? "anki21" : "anki2" };
}

function readNotetypes(db: SqliteReader): Map<string, Notetype> {
  const out = new Map<string, Notetype>();
  const tables = db.tableNames();
  if (tables.includes("notetypes") && db.all("notetypes").length) {
    const fieldsByNt = new Map<string, { ord: number; name: string }[]>();
    for (const r of db.rows("fields")) {
      const k = String(r.ntid);
      (fieldsByNt.get(k) ?? fieldsByNt.set(k, []).get(k)!).push({ ord: Number(r.ord), name: String(r.name) });
    }
    const tmplByNt = new Map<string, { ord: number; t: Template }[]>();
    for (const r of db.rows("templates")) {
      const k = String(r.ntid);
      const f = decodeProto(r.config as Uint8Array);
      (tmplByNt.get(k) ?? tmplByNt.set(k, []).get(k)!).push({ ord: Number(r.ord), t: { name: String(r.name), qfmt: protoString(f, 1) ?? "", afmt: protoString(f, 2) ?? "" } });
    }
    for (const r of db.rows("notetypes")) {
      const id = String(r.id);
      const f = decodeProto(r.config as Uint8Array);
      const kind = protoInt(f, 1) === 1 ? "cloze" : "standard";
      out.set(id, {
        id, name: String(r.name), kind, css: protoString(f, 3) ?? "",
        fields: (fieldsByNt.get(id) ?? []).sort((a, b) => a.ord - b.ord).map((x) => x.name),
        templates: (tmplByNt.get(id) ?? []).sort((a, b) => a.ord - b.ord).map((x) => x.t),
      });
    }
    return out;
  }
  // Legacy: JSON in col.models
  const col = db.all("col")[0];
  const models = JSON.parse(String(col.models || "{}")) as Record<string, any>;
  for (const [id, m] of Object.entries(models)) {
    out.set(String(id), {
      id: String(id), name: m.name, kind: m.type === 1 ? "cloze" : "standard", css: m.css ?? "",
      fields: [...(m.flds ?? [])].sort((a: any, b: any) => a.ord - b.ord).map((x: any) => x.name),
      templates: [...(m.tmpls ?? [])].sort((a: any, b: any) => a.ord - b.ord).map((t: any) => ({ name: t.name, qfmt: t.qfmt ?? "", afmt: t.afmt ?? "" })),
    });
  }
  return out;
}

function readDecks(db: SqliteReader): Map<string, string> {
  const out = new Map<string, string>();
  if (db.tableNames().includes("decks") && db.all("decks").length) {
    for (const r of db.rows("decks")) out.set(String(r.id), String(r.name).split(SEP31).join("::"));
    return out;
  }
  const col = db.all("col")[0];
  const decks = JSON.parse(String(col.decks || "{}")) as Record<string, any>;
  for (const [id, d] of Object.entries(decks)) out.set(String(id), String(d.name));
  return out;
}

const tagCase = new Map<string, string>();
/** Anki tags are case-insensitive: fold spellings onto the first one seen so "#AK_Step1_v12" and "#AK_Step1_V12" are one tag. */
export function normalizeTag(t: string): string {
  const x = t.trim().replace(/\s+/g, "_"); const k = x.toLowerCase();
  const seen = tagCase.get(k); if (seen) return seen; tagCase.set(k, x); return x;
}

export async function importAnki(bytes: Uint8Array, env: ImportEnv, opts: { skipDeckPrefixes?: string[] } = {}): Promise<ImportResult> {
  const { db, format } = await openAnkiPackage(bytes, env);
  env.onProgress?.("Reading note types");
  const notetypes = readNotetypes(db);
  const decks = readDecks(db);
  const col = db.all("col")[0];
  const crtMs = Number(col.crt) * 1000;
  const skip = (opts.skipDeckPrefixes ?? []).map((s) => s.toLowerCase());

  env.onProgress?.("Reading notes");
  const notes = new Map<string, Note>();
  let skippedNotes = 0;
  for (const r of db.rows("notes")) {
    const ntid = String(r.mid);
    if (!notetypes.has(ntid)) { skippedNotes++; continue; }
    const tags = String(r.tags || "").split(/\s+/).filter(Boolean).map(normalizeTag);
    notes.set(String(r.id), {
      id: String(r.id), ntid, guid: String(r.guid), fields: String(r.flds).split(SEP31), tags,
      created: Number(r.id), modified: Number(r.mod) * 1000,
    });
  }

  env.onProgress?.("Reading cards");
  const cards = new Map<string, Card>();
  const deckTagOfNote = new Map<string, Set<string>>();
  for (const r of db.rows("cards")) {
    const nid = String(r.nid);
    const note = notes.get(nid);
    if (!note) continue;
    const did = String(Number(r.odid) || r.did);
    const deckPath = decks.get(did) ?? "Unsorted";
    if (skip.some((s) => deckPath.toLowerCase().startsWith(s))) continue;
    const type = Number(r.type); const queue = Number(r.queue);
    let state: CardState = "new";
    if (type === 2) state = "review"; else if (type === 1) state = "learning"; else if (type === 3) state = "relearning";
    const id = String(r.id);
    const ivl = Number(r.ivl);
    const dueRaw = Number(r.due);
    let due = Number(r.id);
    if (state === "review") due = crtMs + dueRaw * DAY;
    else if (state !== "new") due = dueRaw > 1e9 ? dueRaw * 1000 : Date.now();
    cards.set(id, {
      id, nid, ord: Number(r.ord), state, suspended: queue === -1, flag: Number(r.flags) & 7,
      due, stability: state === "review" ? Math.max(ivl, 0.1) : 0, difficulty: state === "new" ? 0 : 5,
      reps: Number(r.reps), lapses: Number(r.lapses), lastReview: 0, step: 0, created: Number(r.id), mod: Number(r.mod) * 1000, source: deckPath,
    });
    (deckTagOfNote.get(nid) ?? deckTagOfNote.set(nid, new Set()).get(nid)!).add(deckPath.replace(/\s*::\s*/g, "::"));
  }
  // Notes whose cards were all skipped: drop them.
  for (const nid of [...notes.keys()]) {
    if (!deckTagOfNote.has(nid)) { notes.delete(nid); skippedNotes++; continue; }
    const n = notes.get(nid)!;
    const sources = [...deckTagOfNote.get(nid)!];
    const medical = sources.some((s) => !/^(Languages|Medizin Wortschatz|Anamnese)/i.test(s));
    if (medical) {
      for (const sys of classifyText(n.fields.join(" "))) n.tags.push(`auto::System::${sys}`);
      for (const sp of sources.flatMap(specialtiesFromSource)) n.tags.push(`auto::Specialty::${sp}`);
    }
    n.tags = [...new Set(n.tags)];
  }

  env.onProgress?.("Replaying review history");
  const reviewsByCard = new Map<string, Review[]>();
  const reviews: Review[] = [];
  for (const r of db.rows("revlog")) {
    const cid = String(r.cid);
    if (!cards.has(cid)) continue;
    const ease = Number(r.ease);
    if (ease < 1 || ease > 4) continue; // manual reschedules carry no rating
    const rtype = Number(r.type);
    const stateBefore: CardState = rtype === 0 ? "learning" : rtype === 2 ? "relearning" : "review";
    const rev: Review = {
      id: `${cid}-${r.id}`, cid, ts: Number(r.id), rating: ease as Rating, state: stateBefore,
      elapsedDays: Math.max(0, Number(r.lastIvl)), scheduledDays: Math.max(0, Number(r.ivl)), durationMs: Number(r.time),
    };
    reviews.push(rev);
    (reviewsByCard.get(cid) ?? reviewsByCard.set(cid, []).get(cid)!).push(rev);
  }
  for (const [cid, list] of reviewsByCard) {
    list.sort((a, b) => a.ts - b.ts);
    const c = cards.get(cid)!;
    const replayed = replay(c, list, DEFAULT_W);
    // Keep Anki's own due date for review cards when it has one; FSRS state comes from the replay.
    if (c.state === "review" && c.due > crtMs) replayed.due = c.due;
    replayed.suspended = c.suspended;
    cards.set(cid, replayed);
  }

  env.onProgress?.("Collecting media references");
  const media = new Map<string, number>();
  for (const n of notes.values()) {
    for (const f of n.fields) {
      for (const m of f.matchAll(mediaRe)) {
        const name = (m[1] ?? m[2]).trim();
        if (/^https?:|^data:/i.test(name)) continue;
        media.set(name, (media.get(name) ?? 0) + 1);
      }
    }
  }
  const usedNt = new Set([...notes.values()].map((n) => n.ntid));
  const ntList = [...notetypes.values()].filter((n) => usedNt.has(n.id));
  const tagSet = new Set<string>();
  for (const n of notes.values()) for (const t of n.tags) tagSet.add(t.toLowerCase());
  return {
    notetypes: ntList, notes: [...notes.values()], cards: [...cards.values()], reviews, media,
    summary: { notetypes: ntList.length, notes: notes.size, cards: cards.size, reviews: reviews.length, tags: tagSet.size, media: media.size, skippedNotes, format },
  };
}
