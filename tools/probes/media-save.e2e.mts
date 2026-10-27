// "Save media file" robustness: an unreadable in-memory blob is re-read from the database; a file that
// is gone is skipped (and becomes "missing"); saving into a picked folder (OPFS stands in for the
// PC folder) and as a download; case-different names are found; the missing list + CSV.
import { chromium } from "playwright"; import { spawn } from "node:child_process"; import fs from "node:fs";
const port = 8781; const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch(); const errors: string[] = [];
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
try {
  const ctx = await browser.newContext({ acceptDownloads: true }); const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/`); await page.waitForSelector("text=Nothing to study yet");
  await page.click("nav.tabs >> text=Settings"); await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { (d as HTMLDetailsElement).open = true; }));
  await page.locator("input[type=file]").first().setInputFiles("test/fixtures/medicine-legacy.apkg");
  await page.waitForFunction(() => /Imported/.test(document.body.innerText), null, { timeout: 120000 });
  // 6 notes use pictures; one card spells it in capitals, one file isn't in the folder
  const names = ["ecg one.png", "Lead II.PNG", "xray.jpg", "heart.mp3", "lung.mp3", "not-in-folder.png"];
  await page.evaluate(async (names) => { const st = (window as any).yuzu; const ns = [...st.notes.values()].slice(0, names.length); for (let i = 0; i < ns.length; i++) { const n = ns[i]; const f = [...n.fields]; f[0] += names[i].endsWith(".mp3") ? ` [sound:${names[i]}]` : ` <img src="${names[i]}">`; await st.updateNote(n.id, f, n.tags); } }, names);
  await page.click("nav.tabs >> text=Today"); await page.click("nav.tabs >> text=Settings"); await page.evaluate(() => document.querySelectorAll("details:not(.how)").forEach((d) => { (d as HTMLDetailsElement).open = true; }));
  const dir = "/tmp/claude-0/-home-claude/a4e6c5d5-ff32-5a83-8739-0d47ab59416d/scratchpad/mfolder"; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  for (const [n, d] of [["ecg one.png", png], ["lead ii.png", png], ["xray.jpg", png], ["heart.mp3", Buffer.from([1, 2, 3])], ["lung.mp3", Buffer.from([4, 5, 6])]] as const) fs.writeFileSync(`${dir}/${n}`, d);
  await page.locator("input[webkitdirectory]").setInputFiles(dir);
  await page.waitForFunction(() => /^Added|Nothing new|Failed/m.test(document.body.innerText), null, { timeout: 60000 });
  console.log("folder:", await page.evaluate(() => document.body.innerText.match(/(Added|Failed)[^\n]*/)?.[0]));
  // break two in-memory blobs: one still fine in the database, one gone from it too
  await page.evaluate(`(async () => { const st = window.yuzu; const bad = { size: 3, type: "", arrayBuffer: async () => { throw new DOMException("The requested file could not be read", "NotReadableError"); } };
    st.media.set("heart.mp3", bad); st.media.set("lung.mp3", bad);
    await new Promise((res, rej) => { const r = indexedDB.open("yuzu"); r.onsuccess = () => { const tx = r.result.transaction("media", "readwrite"); tx.objectStore("media").delete("lung.mp3"); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }; r.onerror = () => rej(r.error); }); })()`);
  // 1) PC: save into a picked folder (OPFS handle in place of the picker)
  await page.evaluate(() => { (window as any).showDirectoryPicker = async () => { const root = await navigator.storage.getDirectory(); return root.getDirectoryHandle("Downloads", { create: true }); }; });
  await page.click('button:has-text("Save media file")');
  await page.waitForFunction(() => /^Saved .*|Failed/m.test(document.body.innerText), null, { timeout: 60000 });
  console.log("folder save:", await page.evaluate(() => document.body.innerText.match(/(Saved|Failed)[^\n]*/)?.[0]));
  const opfs = await page.evaluate(`(async () => { const root = await navigator.storage.getDirectory(); const d = await root.getDirectoryHandle("Downloads"); const out = []; for await (const [n, h] of d.entries()) { const f = await h.getFile(); out.push(n + " " + f.size); window.__zip = Array.from(new Uint8Array(await f.arrayBuffer())); } return out; })()`);
  console.log("in folder:", opfs);
  const zipBytes = Buffer.from(await page.evaluate(() => (window as any).__zip)); const zf = `${dir}/../saved.zip`; fs.writeFileSync(zf, zipBytes);
  // 2) phone / other browsers: download
  await page.evaluate(() => { delete (window as any).showDirectoryPicker; });
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click('button:has-text("Save media file")')]);
  const dlp = `${dir}/../dl.zip`; await dl.saveAs(dlp); console.log("download:", dl.suggestedFilename(), fs.statSync(dlp).size, "bytes; same as folder:", Buffer.compare(fs.readFileSync(dlp).subarray(100), zipBytes.subarray(100)) === 0 || "(timestamps differ)");
  // 3) missing list + CSV
  await page.evaluate(() => { for (const d of document.querySelectorAll("details")) if (/Show what's missing/.test(d.querySelector("summary")?.textContent ?? "")) d.open = true; });
  await page.waitForFunction(() => /files \([\d,]+ images/.test(document.body.innerText));
  console.log("missing:", await page.evaluate(() => document.body.innerText.match(/[\d,]+ files \([^\n]*?other\)/)?.[0]));
  const [csv] = await Promise.all([page.waitForEvent("download"), page.click('button:has-text("Save the list (CSV)")')]);
  const cp = `${dir}/../missing.csv`; await csv.saveAs(cp); console.log("csv:", csv.suggestedFilename()); console.log(fs.readFileSync(cp, "utf8"));
  // the reloaded device still has what was saved
  await page.reload(); await page.waitForSelector("text=cards ready");
  console.log("after reload:", await page.evaluate(() => { const m = (window as any).yuzu.mediaStatus(); return `${m.stored}/${m.total} stored, missing ${m.missing.join(", ")}`; }));
  await page.click("nav.tabs >> text=Settings"); await page.evaluate(() => { for (const d of document.querySelectorAll("details")) if (/Show what's missing|Images and sounds|How to/.test(d.querySelector("summary")?.textContent ?? "")) d.open = true; });
  await page.evaluate(() => { for (const d of document.querySelectorAll("details")) if (/Show what's missing/.test(d.querySelector("summary")?.textContent ?? "")) { d.open = true; d.querySelectorAll("details").forEach((x) => ((x as HTMLDetailsElement).open = true)); } });
  await page.waitForTimeout(400); const el = page.locator("text=Show what's missing"); await el.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${dir}/../missing.png` });
} finally { console.log("errors:", errors.length ? errors : "none"); await browser.close(); server.kill(); }
