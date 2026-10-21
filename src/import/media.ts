// Per-deck media import from an Anki package that includes media (.apkg / .colpkg).
// Only images that the notes in Yuzu reference are extracted; each is resized and re-encoded
// so a 600 MB deck lands at ~100–200 MB on the device. Works on files of any size (streamed).
import type { Note } from "../lib/model";
import { ZipFile } from "../lib/zipfile";
import type { Inflate } from "../lib/zip";
import { decodeProto, protoBytes, protoString } from "../lib/proto";

export interface MediaEnv { inflateRaw: Inflate; zstd?: (d: Uint8Array) => Promise<Uint8Array>; onProgress?: (msg: string, frac?: number) => void }
export interface MediaImportResult { stored: number; skipped: number; missing: number; bytes: number; audio: number }

const IMG = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
const imgRe = /<img[^>]+src=["']([^"']+)["']/gi;

/** Image file names referenced by the given notes. */
export function imageRefs(notes: Iterable<Note>): Set<string> {
  const out = new Set<string>();
  for (const n of notes) for (const f of n.fields) for (const m of f.matchAll(imgRe)) { let name = m[1]; try { name = decodeURIComponent(name); } catch { /* keep */ } if (!/^(https?:|data:|blob:)/i.test(name)) out.add(name); }
  return out;
}

/** Map "zip entry name" → "media file name" from the package's `media` file (legacy JSON or modern zstd protobuf). */
export async function readMediaMap(zip: ZipFile, env: MediaEnv): Promise<{ map: Map<string, string>; modern: boolean }> {
  const entries = await zip.list();
  const mediaEntry = entries.find((e) => e.name === "media");
  if (!mediaEntry) throw new Error("This file has no media list. Export again with “Include media” ticked.");
  const raw = await zip.read(mediaEntry);
  const map = new Map<string, string>();
  if (raw[0] === 0x7b) { // '{' → legacy JSON {"0":"name.png"}
    const obj = JSON.parse(new TextDecoder().decode(raw)) as Record<string, string>;
    for (const [k, v] of Object.entries(obj)) map.set(v, k);
    return { map, modern: false };
  }
  if (!env.zstd) throw new Error("This file uses Anki's newest format and the zstd decoder is unavailable.");
  const buf = await env.zstd(raw);
  // MediaEntries { repeated MediaEntry entries = 1 }, MediaEntry { string name = 1; uint32 size = 2; bytes sha1 = 3 }
  const fields = decodeProto(buf); let i = 0;
  for (const f of fields) if (f.num === 1 && f.value instanceof Uint8Array) { const name = protoString(decodeProto(f.value), 1); if (name) map.set(name, String(i)); i++; }
  void protoBytes;
  return { map, modern: true };
}

/** Resize + re-encode an image for storage. Falls back to the original bytes when the browser cannot decode it (e.g. SVG). */
export async function shrinkImage(data: Uint8Array, name: string, maxPx = 1200): Promise<Blob> {
  const type = /\.png$/i.test(name) ? "image/png" : /\.gif$/i.test(name) ? "image/gif" : /\.svg$/i.test(name) ? "image/svg+xml" : /\.webp$/i.test(name) ? "image/webp" : "image/jpeg";
  const src = new Blob([data as BlobPart], { type });
  if (type === "image/svg+xml" || type === "image/gif" || typeof createImageBitmap !== "function" || typeof OffscreenCanvas === "undefined") return src;
  try {
    const bmp = await createImageBitmap(src);
    const scale = Math.min(1, maxPx / Math.max(bmp.width, bmp.height));
    if (scale === 1 && data.length < 300 * 1024) { bmp.close(); return src; }
    const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = new OffscreenCanvas(w, h); const ctx = canvas.getContext("2d")!; ctx.drawImage(bmp, 0, 0, w, h); bmp.close();
    const out = await canvas.convertToBlob({ type: "image/webp", quality: 0.82 });
    return out.size < src.size ? out : src;
  } catch { return src; }
}

/**
 * Extract the images referenced by `notes` from the package and hand them to `store` one by one.
 * `have` lets the caller skip names already stored.
 */
export async function importMedia(file: Blob, notes: Iterable<Note>, have: (name: string) => boolean, store: (name: string, blob: Blob) => Promise<void>, env: MediaEnv, opts: { maxPx?: number; audio?: boolean } = {}): Promise<MediaImportResult> {
  env.onProgress?.("Reading the package");
  const zip = new ZipFile(file, env.inflateRaw);
  const { map, modern } = await readMediaMap(zip, env);
  const entries = new Map((await zip.list()).map((e) => [e.name, e]));
  const wanted = [...imageRefs(notes)].filter((n) => !have(n));
  const res: MediaImportResult = { stored: 0, skipped: 0, missing: 0, bytes: 0, audio: 0 };
  let done = 0;
  for (const name of wanted) {
    done++;
    if (done % 20 === 0) env.onProgress?.(`Images ${done}/${wanted.length} · ${(res.bytes / 1048576).toFixed(0)} MB stored`, done / wanted.length);
    const key = map.get(name); const entry = key !== undefined ? entries.get(key) : undefined;
    if (!entry) { res.missing++; continue; }
    if (!IMG.test(name)) { res.skipped++; continue; }
    try {
      let data = await zip.read(entry);
      if (modern) data = await env.zstd!(data);
      const blob = await shrinkImage(data, name, opts.maxPx);
      await store(name, blob); res.stored++; res.bytes += blob.size;
    } catch { res.missing++; }
  }
  env.onProgress?.("Done", 1);
  return res;
}
