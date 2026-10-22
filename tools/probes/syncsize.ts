import fs from "node:fs";
import { GitHubSync, gzip } from "../../src/lib/sync.ts";
const d = JSON.parse(fs.readFileSync("/home/claude/final/dump.json", "utf8"));
const notes = d.notes, cards = d.cards.map((c: any) => ({ ...c, flag: 0, step: 0, difficulty: 5, due: 0, mod: 1, created: 0 }));
const snap = () => ({ notetypes: d.notetypes, notes, cards, reviews: [], settings: {} });
const cache = new Map(); const t0 = Date.now(); const a = await GitHubSync.shard(snap(), cache); const t1 = Date.now();
let total = 0, gz = 0; for (const p of Object.keys(a.hashes)) { const j = a.make(p); total += j.length; gz += j.length > 32768 ? (await gzip(j)).length : j.length; }
console.log("files", Object.keys(a.hashes).length, "| full upload", (total / 1048576).toFixed(0), "MB raw →", (gz / 1048576).toFixed(0), "MB compressed | shard pass", t1 - t0, "ms");
cards[12345] = { ...cards[12345], mod: 2, reps: 1 }; const t2 = Date.now(); const b = await GitHubSync.shard(snap(), cache); const t3 = Date.now();
const changed = Object.keys(b.hashes).filter((p) => a.hashes[p] !== b.hashes[p]); const j = b.make(changed[0]); console.log("one review: changed", changed, "→", j.length, "B raw,", (await gzip(j)).length, "B gz | pass", t3 - t2, "ms");
notes[5000] = { ...notes[5000], tags: [...notes[5000].tags, "x"], modified: 9 }; const c = await GitHubSync.shard(snap(), cache);
const ch2 = Object.keys(c.hashes).filter((p) => b.hashes[p] !== c.hashes[p]); const j2 = c.make(ch2[0]); console.log("one tag edit: changed", ch2, "→", (j2.length / 1024).toFixed(0), "KB raw,", ((await gzip(j2)).length / 1024).toFixed(0), "KB gz");
