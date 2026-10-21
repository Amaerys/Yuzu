import { parsePack } from "../../src/import/pack.ts"; import fs from "node:fs";
const r = parsePack(JSON.parse(fs.readFileSync(process.argv[2], "utf8")), []);
console.log("notes", r.notes.length, "cards", r.cards.length, "similar", r.similar, "skipped", r.skipped, "media", r.media.length);
