// Dump notetypes + decks from a modern Anki collection as legacy-style JSON (for building test fixtures).
import { SqliteReader } from "../src/lib/sqlite.ts";
import { decodeProto, protoInt, protoString } from "../src/lib/proto.ts";
import fs from "node:fs";
const db = new SqliteReader(new Uint8Array(fs.readFileSync(process.argv[2])));
const models: Record<string, any> = {};
const flds = new Map<string, any[]>(), tmpls = new Map<string, any[]>();
for (const r of db.rows("fields")) (flds.get(String(r.ntid)) ?? flds.set(String(r.ntid), []).get(String(r.ntid))!).push({ name: r.name, ord: Number(r.ord) });
for (const r of db.rows("templates")) { const f = decodeProto(r.config as Uint8Array); (tmpls.get(String(r.ntid)) ?? tmpls.set(String(r.ntid), []).get(String(r.ntid))!).push({ name: r.name, ord: Number(r.ord), qfmt: protoString(f, 1) ?? "", afmt: protoString(f, 2) ?? "" }); }
for (const r of db.rows("notetypes")) { const f = decodeProto(r.config as Uint8Array); const id = String(r.id); models[id] = { id: Number(id), name: r.name, type: protoInt(f, 1) === 1 ? 1 : 0, css: protoString(f, 3) ?? "", flds: (flds.get(id) ?? []).sort((a, b) => a.ord - b.ord), tmpls: (tmpls.get(id) ?? []).sort((a, b) => a.ord - b.ord) }; }
const decks: Record<string, any> = {};
for (const r of db.rows("decks")) decks[String(r.id)] = { id: Number(r.id), name: String(r.name).split("\x1f").join("::") };
fs.writeFileSync(process.argv[3], JSON.stringify({ models, decks }));
console.log("models", Object.keys(models).length, "decks", Object.keys(decks).length);
