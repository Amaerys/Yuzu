import { SqliteReader } from "../src/lib/sqlite.ts";
import { decodeProto } from "../src/lib/proto.ts";
import fs from "node:fs";
const db = new SqliteReader(new Uint8Array(fs.readFileSync(process.argv[2])));
const dec = new TextDecoder();
const show = (b: Uint8Array) => decodeProto(b).map(f => `${f.num}:${f.wire}=${f.wire===2 ? JSON.stringify(dec.decode(f.value as Uint8Array).slice(0,70)) : String(f.value)}`);
const nts = db.all("notetypes");
for (const nt of nts.filter(n => /^(Basic|Cloze|Image Occlusion Enhanced\+)$/.test(n.name as string)).slice(0,3)) {
  console.log("\nNOTETYPE", nt.name); console.log(show(nt.config as Uint8Array).slice(0,12));
}
const t = db.all("templates").find(r => r.ntid === nts.find(n=>n.name==="Cloze")!.id)!;
console.log("\nTEMPLATE", t.name); console.log(show(t.config as Uint8Array));
const f = db.all("fields").filter(r => r.ntid === nts.find(n=>n.name==="Cloze")!.id);
console.log("\nFIELDS", f.map(r=>[r.ord,r.name])); console.log(show(f[0].config as Uint8Array));
const d = db.all("decks")[5]; console.log("\nDECK", d.name, show(d.common as Uint8Array), show(d.kind as Uint8Array));
const cfg = db.all("config").map(r => [r.KEY, dec.decode(r.val as Uint8Array).slice(0,60)]); console.log("\nCONFIG", cfg.filter(c=>/fsrs|sched|curDeck|rollover|collapseTime|newSpread|dayLearn/i.test(c[0] as string)));
