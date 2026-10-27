// PC flows with the File System Access API (OPFS folders stand in for the real pickers):
//  A) "Phone media file straight from Anki": Anki folder → shrunk zip parts on disk, nothing stored in the browser.
//  B) the phone loads that file. C) "Choose media folder" stores into the browser; a refused write stops the
//  import with the browser's reason and leaves nothing half-saved in memory.
import { chromium } from "playwright"; import { spawn } from "node:child_process"; import fs from "node:fs";
const port = 8782; const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch(); const errors: string[] = [];
const OUT = "/tmp/claude-0/-home-claude/a4e6c5d5-ff32-5a83-8739-0d47ab59416d/scratchpad";
async function device(label: string) {
  const ctx = await browser.newContext({ acceptDownloads: true }); const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(label + ": " + e.message));
  await page.goto(`http://127.0.0.1:${port}/`); await page.waitForSelector("text=Nothing to study yet");
  await page.click("nav.tabs >> text=Settings"); await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { (d as HTMLDetailsElement).open = true; }));
  await page.locator("input[type=file]").first().setInputFiles("test/fixtures/medicine-legacy.apkg");
  await page.waitForFunction(() => /Imported/.test(document.body.innerText), null, { timeout: 120000 });
  // 300 notes use pictures/sounds (big PNG photos), names incl. spaces and capitals
  await page.evaluate(`(async () => { const st = window.yuzu; const ns = [...st.notes.values()].slice(0, 300); for (let i = 0; i < ns.length; i++) { const n = ns[i]; const f = [...n.fields]; f[0] += i % 5 === 4 ? " [sound:wort " + i + ".mp3]" : ' <img src="Bild ' + i + (i % 7 === 0 ? '.PNG' : '.png') + '">'; await st.updateNote(n.id, f, n.tags); } })()`);
  await page.click("nav.tabs >> text=Today"); await page.click("nav.tabs >> text=Settings"); await page.evaluate(() => document.querySelectorAll("details:not(.how)").forEach((d) => { (d as HTMLDetailsElement).open = true; }));
  return { ctx, page };
}
const media = (page: any) => page.evaluate(() => { const m = (window as any).yuzu.mediaStatus(); return `${m.images.stored}/${m.images.total} images, ${m.sounds.stored}/${m.sounds.total} sounds, ${(m.bytes / 1048576).toFixed(1)} MB`; });
try {
  const A = await device("PC");
  // a fake Anki media folder in OPFS: 240 photos (1600×1200 PNG, lower-case names) + 60 sounds + 50 unused files
  await A.page.evaluate(`(async () => { const root = await navigator.storage.getDirectory(); const d = await root.getDirectoryHandle("collection.media", { create: true });
    const c = new OffscreenCanvas(1600, 1200); const g = c.getContext("2d");
    for (let i = 0; i < 350; i++) { const name = i >= 300 ? "unused " + i + ".png" : i % 5 === 4 ? "wort " + i + ".mp3" : "bild " + i + ".png";
      let blob; if (name.endsWith(".mp3")) blob = new Blob([new Uint8Array(30000).fill(i % 255)]); else { g.fillStyle = "hsl(" + (i * 7) + ",70%,50%)"; g.fillRect(0, 0, 1600, 1200); g.fillStyle = "#fff"; g.font = "120px sans-serif"; g.fillText("Bild " + i, 200, 600); blob = await c.convertToBlob({ type: "image/png" }); }
      const fh = await d.getFileHandle(name, { create: true }); const w = await fh.createWritable(); await w.write(blob); await w.close(); }
    await root.getDirectoryHandle("Downloads", { create: true });
    window.showDirectoryPicker = async (o) => (o && o.id === "anki-media") ? root.getDirectoryHandle("collection.media") : root.getDirectoryHandle("Downloads");
  })()`);
  await A.page.reload(); await A.page.waitForSelector("text=cards ready"); await A.page.click("nav.tabs >> text=Settings"); await A.page.evaluate(() => document.querySelectorAll("details:not(.how)").forEach((d) => { (d as HTMLDetailsElement).open = true; }));
  await A.page.evaluate(`(async () => { const root = await navigator.storage.getDirectory(); window.showDirectoryPicker = async (o) => (o && o.id === "anki-media") ? root.getDirectoryHandle("collection.media") : root.getDirectoryHandle("Downloads"); })()`);
  await A.page.click("text=1. Pick Anki's media folder"); await A.page.waitForSelector("text=/collection.media” · 350 files/");
  let t = Date.now(); await A.page.click("text=2. Save phone media file…");
  await A.page.waitForFunction(() => /^Saved yuzu-media|Failed/m.test(document.body.innerText), null, { timeout: 300000 });
  console.log(`A) phone file in ${((Date.now() - t) / 1000).toFixed(1)} s:`, await A.page.evaluate(() => document.body.innerText.match(/^(Saved|Failed)[^\n]*/m)?.[0]));
  console.log("   PC browser storage after (should be 0 images):", await media(A.page));
  const zip = Buffer.from(await A.page.evaluate(`(async () => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle("Downloads"); for await (const [n, h] of d.entries()) return Array.from(new Uint8Array(await (await h.getFile()).arrayBuffer())); })()`) as number[]);
  fs.writeFileSync(`${OUT}/phone-media.zip`, zip); console.log("   zip", (zip.length / 1048576).toFixed(1), "MB; unzip -t:");
  // B) phone loads it
  const B = await device("phone");
  t = Date.now(); await B.page.locator("input[type=file][accept*=colpkg]").nth(1).setInputFiles(`${OUT}/phone-media.zip`);
  await B.page.waitForFunction(() => /^Added|Failed/m.test(document.body.innerText), null, { timeout: 300000 });
  console.log(`B) phone import ${((Date.now() - t) / 1000).toFixed(1)} s:`, await B.page.evaluate(() => document.body.innerText.match(/^(Added|Failed)[^\n]*/m)?.[0]), "·", await media(B.page));
  await B.page.reload(); await B.page.waitForSelector("text=cards ready"); console.log("   after reload:", await media(B.page));
  const ok = await B.page.evaluate(`(async () => { const u = window.yuzu.mediaUrl("Bild 7.PNG"); const im = new Image(); im.src = u; await im.decode(); return im.naturalWidth + "x" + im.naturalHeight; })()`); console.log("   'Bild 7.PNG' (capitals on the card, lower-case file) renders:", ok);
  // C) PC "Choose media folder" with the browser refusing after 100 files
  await A.page.evaluate(`(() => { let n = 0; const put = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function (v, ...r) { if (this.name === "media" && ++n > 100) throw new DOMException("The quota has been exceeded.", "QuotaExceededError"); return put.call(this, v, ...r); }; })()`);
  await A.page.click('button:has-text("Choose media folder")');
  await A.page.waitForFunction(() => /^(Added|Failed|Nothing new)[^\n]*/m.test(document.body.innerText), null, { timeout: 300000 });
  console.log("C) refused write:", await A.page.evaluate(() => document.body.innerText.match(/^(Added|Failed|Nothing new)[^\n]*/m)?.[0]));
  const st = await A.page.evaluate(`(async () => { const st = window.yuzu; let bad = 0; for (const b of st.media.values()) { try { await b.arrayBuffer(); } catch { bad++; } } return st.media.size + " in memory, " + bad + " unreadable"; })()`); console.log("   memory:", st, "·", await media(A.page));
  await A.page.reload(); await A.page.waitForSelector("text=cards ready"); console.log("   after reload:", await media(A.page));
  await A.page.click("nav.tabs >> text=Settings"); await A.page.evaluate(() => document.querySelectorAll("details:not(.how)").forEach((d) => { (d as HTMLDetailsElement).open = true; }));
  await A.page.locator("label:has-text(\"Phone media file straight from Anki\")").scrollIntoViewIfNeeded(); await A.page.screenshot({ path: `${OUT}/pc-media.png` });
} finally { console.log("errors:", errors.length ? errors : "none"); await browser.close(); server.kill(); }
