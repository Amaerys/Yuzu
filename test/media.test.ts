import { test } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { importMedia, imageRefs, readMediaMap } from "../src/import/media.ts";
import { ZipFile } from "../src/lib/zipfile.ts";

// Minimal zip writer (stored entries) for fixtures.
function makeZip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const parts: Uint8Array[] = []; const cd: Uint8Array[] = []; let offset = 0; const enc = new TextEncoder();
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc32 = (d: Uint8Array) => { let c = 0xffffffff; for (const b of d) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  for (const f of files) {
    const name = enc.encode(f.name); const crc = crc32(f.data);
    const lh = new Uint8Array(30 + name.length); const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(8, 0, true); lv.setUint32(14, crc, true); lv.setUint32(18, f.data.length, true); lv.setUint32(22, f.data.length, true); lv.setUint16(26, name.length, true); lh.set(name, 30);
    const ch = new Uint8Array(46 + name.length); const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(10, 0, true); cv.setUint32(16, crc, true); cv.setUint32(20, f.data.length, true); cv.setUint32(24, f.data.length, true); cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true); ch.set(name, 46);
    parts.push(lh, f.data); cd.push(ch); offset += lh.length + f.data.length;
  }
  const cdLen = cd.reduce((a, c) => a + c.length, 0);
  const eocd = new Uint8Array(22); const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true); ev.setUint32(12, cdLen, true); ev.setUint32(16, offset, true);
  const all = [...parts, ...cd, eocd]; const out = new Uint8Array(all.reduce((a, c) => a + c.length, 0)); let p = 0; for (const c of all) { out.set(c, p); p += c.length; }
  return out;
}
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const env = { inflateRaw: async (d: Uint8Array) => new Uint8Array(zlib.inflateRawSync(d)), zstd: async (d: Uint8Array) => new Uint8Array(zlib.zstdDecompressSync(d)) };
const notes = [{ id: "n1", ntid: "t", guid: "g", fields: ['Look: <img src="ecg%201.png"> and <img src="missing.jpg">', "[sound:a.mp3]"], tags: [], created: 0, modified: 0 }];

test("media: legacy apkg (JSON media map) — referenced images extracted, missing counted", async () => {
  const zip = makeZip([{ name: "media", data: new TextEncoder().encode(JSON.stringify({ "0": "ecg 1.png", "1": "a.mp3" })) }, { name: "0", data: png }, { name: "1", data: new Uint8Array([1, 2]) }]);
  assert.deepEqual([...imageRefs(notes)], ["ecg 1.png", "missing.jpg"]);
  const stored: Record<string, number> = {};
  const r = await importMedia(new Blob([zip]), notes, () => false, async (n, b) => { stored[n] = b.size; }, env);
  assert.equal(r.stored, 1); assert.equal(r.missing, 1); assert.equal(stored["ecg 1.png"], png.length);
});

test("media: modern apkg (zstd protobuf media list, zstd entries)", async () => {
  // MediaEntries { entries: [ MediaEntry{name="ecg 1.png"} ] } hand-encoded: field 1 (len-delimited) containing field 1 string
  const name = new TextEncoder().encode("ecg 1.png");
  const entry = new Uint8Array([0x0a, name.length, ...name]); const list = new Uint8Array([0x0a, entry.length, ...entry]);
  const zip = makeZip([{ name: "media", data: new Uint8Array(zlib.zstdCompressSync(list)) }, { name: "0", data: new Uint8Array(zlib.zstdCompressSync(png)) }]);
  const zf = new ZipFile(new Blob([zip]), env.inflateRaw); const m = await readMediaMap(zf, env);
  assert.equal(m.modern, true); assert.equal(m.map.get("ecg 1.png"), "0");
  const stored: Record<string, number> = {};
  const r = await importMedia(new Blob([zip]), notes, () => false, async (n, b) => { stored[n] = b.size; }, env);
  assert.equal(r.stored, 1); assert.equal(stored["ecg 1.png"], png.length);
});
