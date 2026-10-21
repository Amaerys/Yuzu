// Browser-side decompression helpers for the importer.
export async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function zstd(data: Uint8Array): Promise<Uint8Array> {
  // 1) Native support, where the browser has it.
  try {
    const ds = new DecompressionStream("zstd" as unknown as CompressionFormat);
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch { /* fall through */ }
  // 2) Bundled pure-JS decoder (fzstd), loaded lazily so it stays out of the main bundle until an import needs it.
  const { decompress } = await import("../vendor/fzstd");
  return decompress(data);
}
