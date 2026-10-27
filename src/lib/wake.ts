// Keep the screen on during long jobs (media import, big syncs). Re-acquired when the tab becomes visible again.
let sentinel: any = null; let wanted = 0;
async function grab() { try { if (wanted > 0 && !sentinel && document.visibilityState === "visible") { sentinel = await (navigator as any).wakeLock?.request("screen"); sentinel?.addEventListener?.("release", () => { sentinel = null; }); } } catch { sentinel = null; } }
if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => { void grab(); });
export async function holdAwake<T>(job: () => Promise<T>): Promise<T> {
  wanted++; await grab();
  try { return await job(); }
  finally { wanted--; if (wanted === 0 && sentinel) { try { await sentinel.release(); } catch { /* gone */ } sentinel = null; } }
}
