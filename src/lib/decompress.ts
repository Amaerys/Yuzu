// Browser-side decompression helpers for the importer.
export async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

let fzstd: { decompress: (d: Uint8Array) => Uint8Array } | null = null;

export async function zstd(data: Uint8Array): Promise<Uint8Array> {
  // 1) Native support, where the browser has it.
  try {
    const ds = new DecompressionStream("zstd" as unknown as CompressionFormat);
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch { /* fall through */ }
  // 2) Small pure-JS decoder fetched on demand (needs internet once; cached by the service worker).
  if (!fzstd) {
    try {
      const url = "https://cdn.jsdelivr.net/npm/fzstd@0.1.1/+esm";
      fzstd = await (new Function("u", "return import(u)")(url) as Promise<{ decompress: (d: Uint8Array) => Uint8Array }>);
    } catch {
      throw new Error("This file uses Anki's newest format and your browser can't unpack it offline. Either connect to the internet and try again, or export from Anki with “Support older Anki versions” ticked.");
    }
  }
  return fzstd!.decompress(data);
}
