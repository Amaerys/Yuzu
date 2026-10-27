import { test } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { importMedia, imageRefs, mediaRefs, readMediaMap, YUZU_MEDIA_MARK } from "../src/import/media.ts";
import { writeZip, streamZip } from "../src/lib/zipwrite.ts";
import { rewriteMedia, rewriteCssUrls } from "../src/lib/render.ts";
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
  assert.equal(r.stored, 2); assert.equal(r.images, 1); assert.equal(r.sounds, 1); assert.equal(r.missing, 1); assert.equal(stored["ecg 1.png"], png.length); assert.equal(stored["a.mp3"], 2);
  assert.deepEqual(r.missingNames, ["missing.jpg"]);
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

test("media: refs cover sounds, <audio>, CSS url() and template files", () => {
  const nt = { id: "t", name: "Basic", kind: "standard" as const, css: '@font-face{src:url("_pixel.woff")} .card{background:url(_bg.png)}', fields: ["Front"], templates: [{ name: "c", qfmt: '{{Front}}<img src="_logo.png">', afmt: "{{FrontSide}}" }] };
  const ns = [{ id: "n", ntid: "t", guid: "g", fields: ['[sound:wort.mp3] <audio src="b%20c.ogg"></audio> <img src="http://x/y.png">', ""], tags: [], created: 0, modified: 0 }];
  assert.deepEqual([...mediaRefs(ns as any, [nt as any])].sort(), ["_bg.png", "_logo.png", "_pixel.woff", "b c.ogg", "wort.mp3"]);
});

test("media: sounds render as play buttons, CSS urls resolve, unknown sounds show a placeholder", () => {
  const html = rewriteMedia("Hör: [sound:wort.mp3] [sound:gone.mp3]", (n) => (n === "wort.mp3" ? "blob:w" : null));
  assert.match(html, /class="yz-sound" data-src="blob:w"/); assert.match(html, /yz-sound missing/);
  assert.equal(rewriteCssUrls('a{background:url("_bg.png")} b{background:url(http://x)}', (n) => (n === "_bg.png" ? "blob:b" : null)), 'a{background:url("blob:b")} b{background:url(http://x)}');
});

test("media: Yuzu media file round-trip (zip writer → importer), resume skips stored names", async () => {
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 9]);
  const blob = await writeZip([{ name: YUZU_MEDIA_MARK, data: new TextEncoder().encode("{}") }, { name: "m/ecg 1.png", data: new Blob([webp]) }, { name: "m/a.mp3", data: new Uint8Array([7, 7, 7]) }, { name: "m/Ärger ß.png", data: png }]);
  const ns = [...notes, { id: "n2", ntid: "t", guid: "g2", fields: ['<img src="Ärger ß.png">'], tags: [], created: 0, modified: 0 }];
  const stored: Record<string, Blob> = {};
  const r = await importMedia(blob, ns, (n) => n === "a.mp3", async (n, b) => { stored[n] = b; }, env);
  assert.equal(r.stored, 2, JSON.stringify(r)); assert.equal(r.already, 1); assert.equal(r.missing, 1);
  assert.equal(stored["ecg 1.png"].type, "image/webp"); assert.equal(stored["Ärger ß.png"].size, png.length);
});

test("media: picked folder of files (Anki's collection.media)", async () => {
  const files = [new File([png], "ecg 1.png"), new File([new Uint8Array([1])], "a.mp3"), new File([png], "unused.png")];
  const stored: string[] = [];
  const r = await importMedia(files, notes, () => false, async (n) => { stored.push(n); }, env);
  assert.deepEqual(stored.sort(), ["a.mp3", "ecg 1.png"]); assert.equal(r.missing, 1);
});

test("media: stop halfway keeps what was stored", async () => {
  const many = Array.from({ length: 40 }, (_, i) => new File([png], `p${i}.png`));
  const ns = [{ id: "n", ntid: "t", guid: "g", fields: [many.map((f) => `<img src="${f.name}">`).join("")], tags: [], created: 0, modified: 0 }];
  const ac = new AbortController(); let n = 0;
  const r = await importMedia(many, ns, () => false, async () => { if (++n === 10) ac.abort(); }, { ...env, signal: ac.signal }, { parallel: 1 });
  assert.equal(r.stopped, true); assert.equal(r.stored, 10);
});

test("hidden fields: Sketchy content is not rendered and its pictures are not wanted", async () => {
  const { renderCard, setHiddenFields } = await import("../src/lib/render.ts");
  const nt = { id: "ak", name: "AnKingOverhaul", kind: "cloze" as const, css: "", fields: ["Text", "Extra", "Sketchy"], templates: [{ name: "c", qfmt: "{{cloze:Text}}", afmt: "{{cloze:Text}}{{#Extra}}<div id=extra>{{Extra}}</div>{{/Extra}}{{#Sketchy}}<span class=\"hintBtn\" data-name=\"Sketchy\"><div class=\"hints\">{{Sketchy}}</div></span>{{/Sketchy}}" }] };
  const note = { id: "n", ntid: "ak", guid: "g", fields: ["{{c1::Lynch}} is right-sided", "<img src=\"keep.png\">", "<img src=\"sk1.jpg\"><img src=\"sk2.jpg\">"], tags: [], created: 0, modified: 0 };
  setHiddenFields(["Sketchy"]);
  const back = renderCard({ note: note as any, notetype: nt as any, ord: 0 }).back;
  assert.ok(!/Sketchy|sk1/.test(back)); assert.match(back, /keep\.png/);
  const refs = mediaRefs([note as any], [nt as any], (n, i) => i === 2);
  assert.deepEqual([...refs].sort(), ["keep.png"]);
  setHiddenFields([]);
  assert.match(renderCard({ note: note as any, notetype: nt as any, ord: 0 }).back, /sk1\.jpg/);
});

test("media: an unreadable stored file is re-read, then skipped — the save still finishes (blob and stream)", async () => {
  const bad = { size: 3, type: "", arrayBuffer: async () => { throw new DOMException("The requested file could not be read", "NotReadableError"); } } as unknown as Blob;
  const files = [{ name: YUZU_MEDIA_MARK, data: new TextEncoder().encode("{}") }, { name: "m/ecg 1.png", data: bad }, { name: "m/a.mp3", data: bad }, { name: "m/Ärger ß.png", data: new Blob([png]) }];
  const skipped: string[] = [];
  const reread = async (n: string) => (n === "m/ecg 1.png" ? new Blob([png]) : null);
  const blob = await writeZip(files, { reread, skipped });
  assert.deepEqual(skipped, ["m/a.mp3"]);
  const ns = [...notes, { id: "n2", ntid: "t", guid: "g2", fields: ['<img src="Ärger ß.png">'], tags: [], created: 0, modified: 0 }];
  const got: string[] = []; const r = await importMedia(blob, ns, () => false, async (n) => { got.push(n); }, env);
  assert.deepEqual(got.sort(), ["ecg 1.png", "Ärger ß.png"].sort()); assert.ok(!got.includes("a.mp3"));
  // streamed to "disk": same bytes as the Blob version
  const chunks: BlobPart[] = []; const sk2: string[] = [];
  const n = await streamZip(files, { write: async (c) => { chunks.push(c as BlobPart); } }, { reread, skipped: sk2 });
  assert.equal(n, 3); assert.deepEqual(sk2, ["m/a.mp3"]);
  assert.deepEqual(new Uint8Array(await new Blob(chunks).arrayBuffer()), new Uint8Array(await blob.arrayBuffer()));
});
