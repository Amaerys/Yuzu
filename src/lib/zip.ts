// Minimal ZIP reader (central directory based). Supports "stored" and "deflate" entries.
// Decompression is injected so the same code runs in the browser (DecompressionStream)
// and in Node (zlib) for tests.

export type Inflate = (data: Uint8Array) => Promise<Uint8Array>;

export interface ZipEntry {
  name: string;
  method: number; // 0 = stored, 8 = deflate
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

const SIG_EOCD = 0x06054b50;
const SIG_CDIR = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
const SIG_ZIP64_LOC = 0x07064b50;
const SIG_ZIP64_EOCD = 0x06064b50;

export function listZip(buf: Uint8Array): ZipEntry[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // Find end of central directory (search backwards, comment may be up to 64K).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Not a zip file (no end-of-central-directory record)");
  let count = dv.getUint16(eocd + 10, true);
  let cdOffset = dv.getUint32(eocd + 16, true);
  // ZIP64 support (large collections).
  if (count === 0xffff || cdOffset === 0xffffffff) {
    const loc = eocd - 20;
    if (loc >= 0 && dv.getUint32(loc, true) === SIG_ZIP64_LOC) {
      const z64 = Number(dv.getBigUint64(loc + 8, true));
      if (dv.getUint32(z64, true) !== SIG_ZIP64_EOCD) throw new Error("Bad zip64 record");
      count = Number(dv.getBigUint64(z64 + 32, true));
      cdOffset = Number(dv.getBigUint64(z64 + 48, true));
    }
  }
  const entries: ZipEntry[] = [];
  let p = cdOffset;
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== SIG_CDIR) throw new Error("Bad central directory entry");
    const method = dv.getUint16(p + 10, true);
    let compressedSize = dv.getUint32(p + 20, true);
    let uncompressedSize = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    let localHeaderOffset = dv.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    // zip64 extra field
    let e = p + 46 + nameLen;
    const extraEnd = e + extraLen;
    while (e + 4 <= extraEnd) {
      const id = dv.getUint16(e, true);
      const sz = dv.getUint16(e + 2, true);
      if (id === 0x0001) {
        let q = e + 4;
        if (uncompressedSize === 0xffffffff) { uncompressedSize = Number(dv.getBigUint64(q, true)); q += 8; }
        if (compressedSize === 0xffffffff) { compressedSize = Number(dv.getBigUint64(q, true)); q += 8; }
        if (localHeaderOffset === 0xffffffff) { localHeaderOffset = Number(dv.getBigUint64(q, true)); q += 8; }
      }
      e += 4 + sz;
    }
    entries.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

export async function readZipEntry(buf: Uint8Array, entry: ZipEntry, inflateRaw: Inflate): Promise<Uint8Array> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const p = entry.localHeaderOffset;
  if (dv.getUint32(p, true) !== SIG_LOCAL) throw new Error("Bad local file header for " + entry.name);
  const nameLen = dv.getUint16(p + 26, true);
  const extraLen = dv.getUint16(p + 28, true);
  const start = p + 30 + nameLen + extraLen;
  const data = buf.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return data;
  if (entry.method === 8) return inflateRaw(data);
  throw new Error(`Unsupported zip compression method ${entry.method} for ${entry.name}`);
}
