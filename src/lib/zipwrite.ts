// Store-only ZIP writer. Names are UTF-8 (flag bit 11). Each part stays under the classic 4 GB /
// 65,535-entry limits; callers split larger sets into several files.
// Two outputs: a Blob assembled from the stored Blobs themselves (no 1 GB in memory), or a stream
// written chunk by chunk into a file on disk (File System Access API on PCs) — one file in memory at a time.
// A file that can't be read is retried through `reread` (a fresh copy from the database) and skipped if
// that fails too, so one bad file never stops the whole save.
const table = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(d: Uint8Array, c = 0xffffffff): number { for (let i = 0; i < d.length; i++) c = table[(c ^ d[i]) & 0xff] ^ (c >>> 8); return c >>> 0; }

export interface ZipInput { name: string; data: Blob | Uint8Array }
export interface ZipOpts { onFile?: (i: number) => void; reread?: (name: string) => Promise<Blob | null | undefined>; skipped?: string[] }
type Sink = (chunk: Uint8Array | Blob) => Promise<void> | void;

async function bytesOf(f: ZipInput, opts: ZipOpts): Promise<{ bytes: Uint8Array; blob?: Blob } | null> {
  if (f.data instanceof Uint8Array) return { bytes: f.data };
  try { return { bytes: new Uint8Array(await f.data.arrayBuffer()), blob: f.data }; }
  catch {
    try { const b = await opts.reread?.(f.name); if (b) return { bytes: new Uint8Array(await b.arrayBuffer()), blob: b }; } catch { /* skip below */ }
    opts.skipped?.push(f.name); return null;
  }
}

async function zipTo(files: ZipInput[], sink: Sink, keepBlobs: boolean, opts: ZipOpts): Promise<number> {
  const enc = new TextEncoder(); const cd: Uint8Array[] = []; let offset = 0, count = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i]; const got = await bytesOf(f, opts);
    if (got) {
      const name = enc.encode(f.name); const { bytes } = got;
      const crc = (crc32(bytes) ^ 0xffffffff) >>> 0; const size = bytes.length;
      const lh = new Uint8Array(30 + name.length); const lv = new DataView(lh.buffer);
      lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true); lv.setUint16(8, 0, true);
      lv.setUint32(14, crc, true); lv.setUint32(18, size, true); lv.setUint32(22, size, true); lv.setUint16(26, name.length, true); lh.set(name, 30);
      const ch = new Uint8Array(46 + name.length); const cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true); cv.setUint16(10, 0, true);
      cv.setUint32(16, crc, true); cv.setUint32(20, size, true); cv.setUint32(24, size, true); cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true); ch.set(name, 46);
      await sink(lh); await sink(keepBlobs && got.blob ? got.blob : bytes); cd.push(ch); offset += lh.length + size; count++;
    }
    opts.onFile?.(i + 1);
  }
  const cdLen = cd.reduce((a, c) => a + c.length, 0);
  for (const c of cd) await sink(c);
  const eocd = new Uint8Array(22); const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, count, true); ev.setUint16(10, count, true); ev.setUint32(12, cdLen, true); ev.setUint32(16, offset, true);
  await sink(eocd);
  return count;
}

/** The ZIP as one Blob (built from the input Blobs, so memory stays small). */
export async function writeZip(files: ZipInput[], onFile?: ((i: number) => void) | ZipOpts): Promise<Blob> {
  const opts: ZipOpts = typeof onFile === "function" ? { onFile } : onFile ?? {};
  const parts: BlobPart[] = []; await zipTo(files, (c) => { parts.push(c as BlobPart); }, true, opts);
  return new Blob(parts, { type: "application/zip" });
}

/** The ZIP streamed into a writable (e.g. FileSystemWritableFileStream); returns the number of files written. */
export async function streamZip(files: ZipInput[], out: { write(c: Uint8Array | Blob): Promise<void> }, opts: ZipOpts = {}): Promise<number> {
  return zipTo(files, (c) => out.write(c), false, opts);
}
