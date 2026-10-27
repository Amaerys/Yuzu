// Store-only ZIP writer that assembles a Blob from the stored Blobs themselves, so a 1 GB media file
// is written without holding 1 GB in memory. Names are UTF-8 (flag bit 11). Each part stays under
// the classic 4 GB / 65,535-entry limits; callers split larger sets into several files.
const table = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(d: Uint8Array, c = 0xffffffff): number { for (let i = 0; i < d.length; i++) c = table[(c ^ d[i]) & 0xff] ^ (c >>> 8); return c >>> 0; }

export interface ZipInput { name: string; data: Blob | Uint8Array }

export async function writeZip(files: ZipInput[], onFile?: (i: number) => void): Promise<Blob> {
  const enc = new TextEncoder(); const parts: BlobPart[] = []; const cd: Uint8Array[] = []; let offset = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i]; const name = enc.encode(f.name);
    const bytes = f.data instanceof Uint8Array ? f.data : new Uint8Array(await f.data.arrayBuffer());
    const crc = (crc32(bytes) ^ 0xffffffff) >>> 0; const size = bytes.length;
    const lh = new Uint8Array(30 + name.length); const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true); lv.setUint16(8, 0, true);
    lv.setUint32(14, crc, true); lv.setUint32(18, size, true); lv.setUint32(22, size, true); lv.setUint16(26, name.length, true); lh.set(name, 30);
    const ch = new Uint8Array(46 + name.length); const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true); cv.setUint16(10, 0, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, size, true); cv.setUint32(24, size, true); cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true); ch.set(name, 46);
    parts.push(lh, f.data instanceof Blob ? f.data : (bytes as BlobPart)); cd.push(ch); offset += lh.length + size;
    onFile?.(i + 1);
  }
  const cdLen = cd.reduce((a, c) => a + c.length, 0);
  const eocd = new Uint8Array(22); const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true); ev.setUint32(12, cdLen, true); ev.setUint32(16, offset, true);
  return new Blob([...parts, ...(cd as BlobPart[]), eocd], { type: "application/zip" });
}
