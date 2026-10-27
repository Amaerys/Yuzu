// Stress: ~1 GB zip64 Anki package with 2,000 photos (2400×1800) + 600 sounds → phone-sized library;
// then "Save media file" and load it on a fresh device. Prints timings and sizes.
import { chromium } from "playwright"; import { spawn } from "node:child_process"; import fs from "node:fs";
const port = 8773; const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const names: string[] = JSON.parse(fs.readFileSync("/home/claude/mediabig/names.json", "utf8"));
const browser = await chromium.launch();
const errors: string[] = [];
async function device(label: string) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, acceptDownloads: true }); const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(label + ": " + e.message));
  await page.goto(`http://127.0.0.1:${port}/`); await page.waitForSelector("text=Nothing to study yet");
  await page.click("nav.tabs >> text=Settings"); await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { (d as HTMLDetailsElement).open = true; }));
  await page.locator('input[type=file]').first().setInputFiles("test/fixtures/medicine-legacy.apkg");
  await page.waitForFunction(() => /Imported/.test(document.body.innerText), null, { timeout: 120000 });
  // Point 2,600 notes at the synthetic media (images with spaces/umlauts in the name; sounds).
  await page.evaluate(async (names) => { const st = (window as any).yuzu; const ns = [...st.notes.values()].slice(0, names.length); for (let i = 0; i < ns.length; i++) { const n = ns[i]; const f = [...n.fields]; f[f.length - 1] += names[i].endsWith(".mp3") ? ` [sound:${names[i]}]` : ` <img src="${names[i]}">`; await st.updateNote(n.id, f, n.tags.filter((t: string) => !t.startsWith("auto::"))); } }, names);
  await page.click("nav.tabs >> text=Today"); await page.click("nav.tabs >> text=Settings"); await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { (d as HTMLDetailsElement).open = true; }));
  return { ctx, page };
}
const media = (page: any) => page.evaluate(() => { const m = (window as any).yuzu.mediaStatus(); return `${m.images.stored}/${m.images.total} images, ${m.sounds.stored}/${m.sounds.total} sounds, ${(m.bytes / 1048576).toFixed(0)} MB`; });
try {
  const A = await device("A");
  console.log("A before:", await media(A.page));
  let t = Date.now();
  await A.page.locator('input[type=file][accept*=colpkg]').nth(1).setInputFiles("/home/claude/mediabig/big.apkg");
  let peak = 0; const tick = setInterval(async () => { try { const m = await A.page.evaluate(() => (performance as any).memory?.usedJSHeapSize ?? 0); peak = Math.max(peak, m); } catch {} }, 1000);
  await A.page.waitForFunction(() => /^Added|Nothing new/m.test(document.body.innerText) || /Failed/.test(document.body.innerText), null, { timeout: 900000 });
  clearInterval(tick);
  console.log(`A import: ${((Date.now() - t) / 1000).toFixed(0)} s, JS heap peak ${(peak / 1048576).toFixed(0)} MB`);
  console.log("A msg:", await A.page.evaluate(() => document.body.innerText.match(/(Added|Nothing new)[^\n]*/)?.[0]));
  console.log("A after:", await media(A.page));
  // Render check: preview a card with an image and one with a sound
  const check = await A.page.evaluate(async () => { const st = (window as any).yuzu; const u = st.mediaUrl("Röntgen Bild 5.jpg"); const s = st.mediaUrl("wort_3.mp3"); const img = new Image(); img.src = u; await img.decode(); const b = st.media.get("Röntgen Bild 5.jpg"); return `img ${img.naturalWidth}x${img.naturalHeight} ${b.type} ${(b.size / 1024).toFixed(0)} KB · sound ${!!s} ${st.media.get("wort_3.mp3")?.type}`; });
  console.log("A render:", check);
  // Resume: run again with the same file → nothing new
  t = Date.now(); await A.page.locator('input[type=file][accept*=colpkg]').nth(1).setInputFiles("/home/claude/mediabig/big.apkg");
  await A.page.waitForFunction(() => /Nothing new to add/.test(document.body.innerText), null, { timeout: 120000 }); console.log(`A rerun: ${((Date.now() - t) / 1000).toFixed(1)} s (nothing new)`);
  // Save media file
  t = Date.now(); const [dl] = await Promise.all([A.page.waitForEvent("download", { timeout: 300000 }), A.page.click("button:has-text(\"Save media file\")")]);
  const out = "/home/claude/mediabig/" + dl.suggestedFilename(); await dl.saveAs(out); console.log(`A export: ${((Date.now() - t) / 1000).toFixed(0)} s → ${dl.suggestedFilename()} ${(fs.statSync(out).size / 1048576).toFixed(0)} MB`);
  // Persist across reload
  await A.page.reload(); await A.page.waitForSelector("text=cards ready"); console.log("A after reload:", await media(A.page));
  // Fresh device B loads the media file
  const B = await device("B");
  t = Date.now(); await B.page.locator('input[type=file][accept*=colpkg]').nth(1).setInputFiles(out);
  await B.page.waitForFunction(() => /^Added|Failed/m.test(document.body.innerText), null, { timeout: 600000 });
  console.log(`B import of media file: ${((Date.now() - t) / 1000).toFixed(0)} s ·`, await media(B.page));
  // Study a sound card on B: play button present
  const ok = await B.page.evaluate(() => { const st = (window as any).yuzu; const html = (window as any).yuzu.mediaUrl("wort_1.mp3"); return !!html; });
  console.log("B sound resolves:", ok);
  await B.page.screenshot({ path: "/home/claude/mediabig/settings-media.png", fullPage: false });
} finally { console.log("errors:", errors.length ? errors : "none"); await browser.close(); server.kill(); }
