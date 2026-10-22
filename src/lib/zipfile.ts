// Streaming ZIP reader over a Blob/File: reads the central directory from the tail and each entry
// on demand with slice(), so a multi-gigabyte deck package never has to fit in memory.
export type Inflate = (data: Uint8Array) => Promise<Uint8Array>;
export interface ZipEntry { name: string; method: number; compressedSize: number; uncompressedSize: number; localHeaderOffset: number }

const SIG_LOCAL = 0x04034b50;

export class ZipFile {
  private entries: ZipEntry[] | null = null;
  constructor(private blob: Blob, private inflateRaw: Inflate) {}
  get size() { return this.blob.size; }

  private async bytes(start: number, end: number): Promise<Uint8Array> { return new Uint8Array(await this.blob.slice(start, Math.min(end, this.blob.size)).arrayBuffer()); }

  /** Central directory. Reads the last 64 KB to find the end record, then only the directory itself. */
  async list(): Promise<ZipEntry[]> {
    if (this.entries) return this.entries;
    const tailLen = Math.min(this.blob.size, 65535 + 22 + 20);
    const tail = await this.bytes(this.blob.size - tailLen, this.blob.size);
    const dv = new DataView(tail.buffer);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error("Not a zip file");
    let cdOffset = dv.getUint32(eocd + 16, true); let cdSize = dv.getUint32(eocd + 12, true);
    if (cdOffset === 0xffffffff || cdSize === 0xffffffff || dv.getUint16(eocd + 10, true) === 0xffff) {
      const loc = eocd - 20;
      if (loc >= 0 && dv.getUint32(loc, true) === 0x07064b50) {
        const z64 = Number(dv.getBigUint64(loc + 8, true));
        const rec = await this.bytes(z64, z64 + 56); const rv = new DataView(rec.buffer);
        if (rv.getUint32(0, true) !== 0x06064b50) throw new Error("Bad zip64 record");
        cdSize = Number(rv.getBigUint64(40, true)); cdOffset = Number(rv.getBigUint64(48, true));
      }
    }
    this.entries = walkDirectory(await this.bytes(cdOffset, cdOffset + cdSize));
    return this.entries;
  }

  async read(entry: ZipEntry): Promise<Uint8Array> {
    const head = await this.bytes(entry.localHeaderOffset, entry.localHeaderOffset + 30);
    const dv = new DataView(head.buffer);
    if (dv.getUint32(0, true) !== SIG_LOCAL) throw new Error("Bad local header for " + entry.name);
    const nameLen = dv.getUint16(26, true), extraLen = dv.getUint16(28, true);
    const start = entry.localHeaderOffset + 30 + nameLen + extraLen;
    const data = await this.bytes(start, start + entry.compressedSize);
    if (entry.method === 0) return data;
    if (entry.method === 8) return this.inflateRaw(data);
    throw new Error(`Unsupported compression ${entry.method}`);
  }
}

/** Parse central-directory records from a buffer that starts at the first record. */
function walkDirectory(buf: Uint8Array): ZipEntry[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength); const dec = new TextDecoder(); const out: ZipEntry[] = []; let p = 0;
  while (p + 46 <= buf.length && dv.getUint32(p, true) === 0x02014b50) {
    const method = dv.getUint16(p + 10, true); let compressedSize = dv.getUint32(p + 20, true); let uncompressedSize = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    let localHeaderOffset = dv.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    let e = p + 46 + nameLen; const extraEnd = e + extraLen;
    while (e + 4 <= extraEnd) { const id = dv.getUint16(e, true), sz = dv.getUint16(e + 2, true); if (id === 1) { let q = e + 4; if (uncompressedSize === 0xffffffff) { uncompressedSize = Number(dv.getBigUint64(q, true)); q += 8; } if (compressedSize === 0xffffffff) { compressedSize = Number(dv.getBigUint64(q, true)); q += 8; } if (localHeaderOffset === 0xffffffff) { localHeaderOffset = Number(dv.getBigUint64(q, true)); q += 8; } } e += 4 + sz; }
    out.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
