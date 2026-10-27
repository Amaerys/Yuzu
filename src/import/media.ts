// Media import for the cards in Yuzu: images, sounds and the template files ("_font.woff", "_bg.png").
// Sources: an Anki package exported with media (.apkg/.colpkg), Anki's own media folder (picked as a
// folder or a multi-selection of files), or a Yuzu media file (images already shrunk, moves in minutes).
// Only files that cards reference are kept; images are resized to phone size and re-encoded as WebP;
// sounds are stored as they are. Everything is streamed, so a 16 GB package never has to fit in memory.
import type { Note, Notetype } from "../lib/model";
import { ZipFile, type Inflate, type ZipEntry } from "../lib/zipfile";
import { decodeProto, protoString } from "../lib/proto";

export interface MediaEnv { inflateRaw: Inflate; zstd?: (d: Uint8Array) => Promise<Uint8Array>; onProgress?: (msg: string, frac?: number) => void; signal?: AbortSignal }
export interface MediaImportResult { stored: number; images: number; sounds: number; other: number; already: number; missing: number; failed: number; bytes: number; missingNames: string[]; stopped?: boolean }

export const IMG = /\.(png|jpe?g|gif|webp|svg|bmp|avif|tiff?)$/i;
export const AUDIO = /\.(mp3|ogg|oga|opus|m4a|aac|wav|flac|spx|3gp|amr)$/i;
const FONT = /\.(woff2?|ttf|otf)$/i;
const VIDEO = /\.(mp4|webm|mov|mkv|avi|mpe?g)$/i;
export const YUZU_MEDIA_MARK = "yuzu-media.json";

export function mimeFor(name: string): string {
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  return ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp", avif: "image/avif", tif: "image/tiff", tiff: "image/tiff",
    mp3: "audio/mpeg", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg", m4a: "audio/mp4", aac: "audio/aac", wav: "audio/wav", flac: "audio/flac", spx: "audio/ogg", "3gp": "audio/3gpp", amr: "audio/amr",
    woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf", mp4: "video/mp4", webm: "video/webm" } as Record<string, string>)[ext] ?? "application/octet-stream";
}

const dec = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };
const local = (s: string) => !/^(https?:|data:|blob:|\/\/)/i.test(s);
const entity = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/** Every local file name referenced by card content: <img>, <audio>/<source>/<video>, [sound:], CSS url(), and template "_files". */
export function mediaRefs(notes: Iterable<Note>, notetypes: Iterable<Notetype> = [], skipField?: (note: Note, index: number) => boolean): Set<string> {
  const out = new Set<string>();
  const scan = (html: string) => {
    if (!html) return;
    if (html.includes("src")) for (const m of html.matchAll(/<(?:img|audio|source|video|embed)\b[^>]*?\ssrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi)) { const n = dec(entity((m[1] ?? m[2] ?? m[3]).trim())); if (local(n)) out.add(n); }
    if (html.includes("[sound:")) for (const m of html.matchAll(/\[sound:([^\]]+)\]/g)) out.add(entity(m[1]).trim());
    if (html.includes("url(")) for (const m of html.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) { const n = dec(entity(m[1])); if (local(n)) out.add(n); }
  };
  for (const n of notes) n.fields.forEach((f, i) => { if (!skipField?.(n, i)) scan(f); });
  for (const nt of notetypes) {
    scan(nt.css);
    for (const t of nt.templates) { scan(t.qfmt); scan(t.afmt); }
    for (const m of (nt.css + nt.templates.map((t) => t.qfmt + t.afmt).join(" ")).matchAll(/["'(\s](_[^"')\s]+\.[a-z0-9]{2,5})/gi)) out.add(m[1]);
  }
  return out;
}

/** Back-compat: image names only. */
export function imageRefs(notes: Iterable<Note>): Set<string> { return new Set([...mediaRefs(notes)].filter((n) => IMG.test(n))); }

/** Map "media file name" → "zip entry name" from the package's `media` file (legacy JSON or modern zstd protobuf). */
export async function readMediaMap(zip: ZipFile, env: MediaEnv): Promise<{ map: Map<string, string>; modern: boolean }> {
  const entries = await zip.list();
  const mediaEntry = entries.find((e) => e.name === "media");
  if (!mediaEntry) throw new Error("This file has no media list. In Anki, export again with “Include media” ticked.");
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
  return { map, modern: true };
}

/** Resize + re-encode an image for storage. Falls back to the original bytes when the browser cannot decode it (e.g. SVG). */
export async function shrinkImage(data: Uint8Array, name: string, maxPx = 1200): Promise<Blob> {
  const type = mimeFor(name);
  const src = new Blob([data as BlobPart], { type });
  if (type === "image/svg+xml" || type === "image/gif" || typeof createImageBitmap !== "function" || typeof OffscreenCanvas === "undefined") return src;
  try {
    const bmp = await createImageBitmap(src);
    const scale = Math.min(1, maxPx / Math.max(bmp.width, bmp.height));
    if (scale === 1 && data.length < 200 * 1024 && type !== "image/bmp" && type !== "image/tiff") { bmp.close(); return src; }
    const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = new OffscreenCanvas(w, h); const ctx = canvas.getContext("2d")!; ctx.drawImage(bmp, 0, 0, w, h); bmp.close();
    const out = await canvas.convertToBlob({ type: "image/webp", quality: 0.8 });
    return out.size < src.size ? out : src;
  } catch { return src; }
}

/** A place media files can be read from by name. */
interface Source { kind: "anki" | "yuzu" | "folder"; has(name: string): boolean; read(name: string): Promise<Uint8Array | Blob | null>; names(): Iterable<string> }

async function zipSource(file: Blob, env: MediaEnv): Promise<Source> {
  const zip = new ZipFile(file, env.inflateRaw);
  const list = await zip.list();
  const byName = new Map(list.map((e) => [e.name, e] as [string, ZipEntry]));
  if (byName.has(YUZU_MEDIA_MARK)) {
    const files = new Map<string, ZipEntry>(); for (const e of list) if (e.name.startsWith("m/")) files.set(e.name.slice(2), e);
    return { kind: "yuzu", has: (n) => files.has(n), names: () => files.keys(), read: async (n) => { const e = files.get(n); return e ? zip.read(e) : null; } };
  }
  const { map, modern } = await readMediaMap(zip, env);
  return {
    kind: "anki", has: (n) => map.has(n), names: () => map.keys(),
    read: async (n) => { const k = map.get(n); const e = k !== undefined ? byName.get(k) : undefined; if (!e) return null; let d = await zip.read(e); if (modern) d = await env.zstd!(d); return d; },
  };
}

function folderSource(files: Iterable<File>): Source {
  const byName = new Map<string, File>(); for (const f of files) byName.set(f.name.normalize("NFC"), f);
  return { kind: "folder", has: (n) => byName.has(n.normalize("NFC")), names: () => byName.keys(), read: async (n) => byName.get(n.normalize("NFC")) ?? null };
}

const sec = (ms: number) => { const s = Math.round(ms / 1000); return s < 90 ? `${s} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`; };

/**
 * Bring the media that `notes`/`notetypes` reference into the device. `have` skips names already
 * stored (so a stopped import resumes where it left off); `store` persists one file.
 */
export async function importMedia(input: Blob | File[], notes: Iterable<Note>, have: (name: string) => boolean, store: (name: string, blob: Blob) => Promise<void>, env: MediaEnv, opts: { maxPx?: number; notetypes?: Iterable<Notetype>; parallel?: number; skipField?: (note: Note, index: number) => boolean } = {}): Promise<MediaImportResult> {
  env.onProgress?.("Reading the file list", 0);
  const src = Array.isArray(input) ? folderSource(input) : await zipSource(input, env);
  const refs = mediaRefs(notes, opts.notetypes, opts.skipField);
  const res: MediaImportResult = { stored: 0, images: 0, sounds: 0, other: 0, already: 0, missing: 0, failed: 0, bytes: 0, missingNames: [] };
  const wanted: string[] = [];
  for (const n of refs) {
    if (have(n)) { res.already++; continue; }
    if (VIDEO.test(n)) continue; // videos stay out: too large for a phone library
    if (!src.has(n)) { res.missing++; if (res.missingNames.length < 30) res.missingNames.push(n); continue; }
    wanted.push(n);
  }
  // Sounds and template files first (small and quick), then images.
  wanted.sort((a, b) => Number(IMG.test(a)) - Number(IMG.test(b)));
  const t0 = Date.now(); let done = 0, lastMsg = 0;
  const report = () => {
    const now = Date.now(); if (now - lastMsg < 300 && done < wanted.length) return; lastMsg = now;
    const left = done > 5 ? ((now - t0) / done) * (wanted.length - done) : 0;
    env.onProgress?.(`${done.toLocaleString()} of ${wanted.length.toLocaleString()} files · ${(res.bytes / 1048576).toFixed(0)} MB stored${left ? ` · about ${sec(left)} left` : ""}`, wanted.length ? done / wanted.length : 1);
  };
  let next = 0;
  const worker = async () => {
    while (next < wanted.length) {
      if (env.signal?.aborted) { res.stopped = true; return; }
      const name = wanted[next++];
      try {
        const raw = await src.read(name);
        if (!raw) { res.missing++; continue; }
        // Bytes, not the picked File: a File handle stops working once the picker's grant expires.
        const bytes = raw instanceof Blob ? new Uint8Array(await raw.arrayBuffer()) : raw;
        const blob = IMG.test(name) && src.kind !== "yuzu" ? await shrinkImage(bytes, name, opts.maxPx)
          : new Blob([bytes as BlobPart], { type: IMG.test(name) ? sniffImage(bytes) ?? mimeFor(name) : mimeFor(name) });
        await store(name, blob);
        res.stored++; res.bytes += blob.size;
        if (IMG.test(name)) res.images++; else if (AUDIO.test(name)) res.sounds++; else res.other++;
      } catch { res.failed++; }
      finally { done++; report(); }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.parallel ?? 3) }, worker));
  env.onProgress?.(res.stopped ? "Stopped" : "Done", 1);
  return res;
}

/** The real type of an already-shrunk image (a .png name may hold WebP bytes). */
function sniffImage(b: Uint8Array): string | null {
  if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) return "image/webp";
  if (b[0] === 0x89 && b[1] === 0x50) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b[0] === 0x47 && b[1] === 0x49) return "image/gif";
  return null;
}
