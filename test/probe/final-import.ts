import fs from "node:fs"; import zlib from "node:zlib";
import { importAnki } from "../../src/import/anki.ts";
import { noteTitle } from "../../src/lib/render.ts";
const bytes = new Uint8Array(fs.readFileSync("/home/claude/final/Finalcollex.colpkg"));
const t0 = Date.now();
const r = await importAnki(bytes, { inflateRaw: async (d) => new Uint8Array(zlib.inflateRawSync(d)), zstd: async (d) => new Uint8Array(zlib.zstdDecompressSync(d)) });
console.log("took", Date.now() - t0, "ms", JSON.stringify(r.summary));
const nt = new Map(r.notetypes.map((n) => [n.id, n]));
// per deck: notes, cards, reviews, states
const perDeck = new Map<string, { notes: Set<string>; cards: number; new: number; review: number; susp: number; reviewed: number }>();
const revByCard = new Map<string, number>(); for (const v of r.reviews) revByCard.set(v.cid, (revByCard.get(v.cid) ?? 0) + 1);
for (const c of r.cards) { const d = perDeck.get(c.source) ?? perDeck.set(c.source, { notes: new Set(), cards: 0, new: 0, review: 0, susp: 0, reviewed: 0 }).get(c.source)!; d.notes.add(c.nid); d.cards++; if (c.state === "new") d.new++; else d.review++; if (c.suspended) d.susp++; if (revByCard.has(c.id)) d.reviewed++; }
const rows = [...perDeck].sort((a, b) => a[0].localeCompare(b[0]));
let out = "deck\tnotes\tcards\tnew\tnot new\tsuspended\twith reviews\n";
for (const [k, d] of rows) out += `${k}\t${d.notes.size}\t${d.cards}\t${d.new}\t${d.review}\t${d.susp}\t${d.reviewed}\n`;
fs.writeFileSync("/home/claude/final/decks.tsv", out); console.log(out);
const ntCount = new Map<string, number>(); for (const n of r.notes) ntCount.set(n.ntid, (ntCount.get(n.ntid) ?? 0) + 1);
console.log("notetypes:", [...ntCount].map(([id, n]) => `${nt.get(id)?.name} (${nt.get(id)?.kind}, ${nt.get(id)?.fields.length}f): ${n}`).join("\n"));
// save a compact dump for the duplicate analysis
fs.writeFileSync("/home/claude/final/dump.json", JSON.stringify({ notetypes: r.notetypes, notes: r.notes, cards: r.cards.map((c) => ({ id: c.id, nid: c.nid, ord: c.ord, source: c.source, state: c.state, stability: c.stability, reps: c.reps, lapses: c.lapses, suspended: c.suspended, lastReview: c.lastReview })), reviewsPerCard: [...revByCard] }));
