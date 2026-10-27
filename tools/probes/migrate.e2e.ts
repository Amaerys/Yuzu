import { chromium } from "playwright"; import { spawn } from "node:child_process"; import fs from "node:fs";
const port = 8769; const profile = "/tmp/yuzu-profile"; fs.rmSync(profile, { recursive: true, force: true });
async function run(dir: string, step: (page: any) => Promise<void>) {
  const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", dir], { stdio: "ignore" }); await new Promise((r) => setTimeout(r, 800));
  const ctx = await chromium.launchPersistentContext(profile, { viewport: { width: 1200, height: 800 } }); const page = ctx.pages()[0] ?? await ctx.newPage();
  const errors: string[] = []; page.on("pageerror", (e: any) => errors.push(e.message)); page.on("framenavigated", (f: any) => { if (f === page.mainFrame()) console.log("  nav", f.url(), new Date().toISOString().slice(14, 23)); });
  await page.goto(`http://127.0.0.1:${port}/`); await page.waitForTimeout(4000);
  await step(page); console.log("errors:", errors.length ? errors : "none"); await ctx.close(); server.kill(); await new Promise((r) => setTimeout(r, 500));
}
await run("/tmp/olddocs/docs", async (page) => {
  await page.click("nav.tabs >> text=Settings"); await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { (d as HTMLDetailsElement).open = true; })); await page.waitForTimeout(500);
  await page.locator('input[type=file]').first().setInputFiles("test/fixtures/medicine-legacy.apkg");
  await page.waitForFunction(() => /Imported/.test(document.body.innerText)); console.log("v1:", (await page.innerText(".screen")).match(/[\d,]+ notes · [\d,]+ cards · [\d,]+ reviews/)?.[0]);
  console.log("v1 stores:", await page.evaluate(() => new Promise((res) => { const r = indexedDB.open("yuzu"); r.onsuccess = () => { res([r.result.version, [...r.result.objectStoreNames]]); r.result.close(); }; })));
});
await run("docs", async (page) => {
  // service worker may serve the old build once; force reload
  for (let i = 0; i < 3; i++) { try { await page.reload({ waitUntil: "load" }); } catch {} await page.waitForTimeout(3000); }
  await page.waitForTimeout(1500); await page.click("nav.tabs >> text=Settings"); await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { (d as HTMLDetailsElement).open = true; })); await page.waitForTimeout(500);
  console.log("v2:", (await page.innerText(".screen")).match(/[\d,]+ notes · [\d,]+ cards · [\d,]+ reviews/)?.[0]);
  await page.waitForTimeout(4000); console.log("  evaluating", new Date().toISOString().slice(14, 23));
  const p2 = await page.context().newPage(); await p2.goto(`http://127.0.0.1:${port}/`); await p2.waitForTimeout(3000);
  console.log("v2 stores:", await p2.evaluate(`new Promise((res) => { const r = indexedDB.open("yuzu"); r.onsuccess = async () => { const db = r.result; const cnt = (s) => new Promise((q) => { const c = db.transaction(s).objectStore(s).count(); c.onsuccess = () => q(c.result); }); res([db.version, await cnt("notes"), await cnt("notes_b"), await cnt("cards"), await cnt("cards_b")]); db.close(); }; })`)); await p2.close();
  await page.click("nav.tabs >> text=Library"); await page.waitForTimeout(300); console.log((await page.innerText(".screen")).split("\n").slice(0, 8).join(" | "));
});
