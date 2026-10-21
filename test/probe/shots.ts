// Phone-size screenshots of the new screens on the real collection.
import { chromium } from "playwright"; import { spawn } from "node:child_process"; import fs from "node:fs";
const port = 8773; const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800)); fs.mkdirSync("/home/claude/final/shots", { recursive: true });
const browser = await chromium.launch(); const page = await (await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2 })).newPage();
const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("dialog", (d) => d.accept());
const shot = (n: string) => page.screenshot({ path: `/home/claude/final/shots/${n}.png` });
try {
  await page.goto(`http://127.0.0.1:${port}/`); await page.waitForTimeout(2500); await page.click("nav.tabs >> text=Settings"); await page.waitForTimeout(500);
  await page.locator('input[type=file]').first().setInputFiles("/home/claude/final/Finalcollex.colpkg");
  await page.waitForFunction(() => /Imported/.test(document.body.innerText), null, { timeout: 600000 });
  await page.locator('input[type=file]').first().setInputFiles("/home/claude/final/curation.yuzu.json");
  await page.waitForFunction(() => /duplicate groups merged/.test(document.body.innerText), null, { timeout: 300000 });
  await page.locator('input[type=file]').first().setInputFiles("/home/claude/packs/hyperkalemia-ed.yuzu.json");
  await page.waitForFunction(() => /cards added/.test(document.body.innerText), null, { timeout: 60000 });
  // fit scheduler
  const t0 = Date.now(); await page.click("text=Tune to my history"); await page.waitForFunction(() => /Scheduler tuned|already close|Not enough/.test(document.body.innerText), null, { timeout: 300000 });
  console.log("fit:", ((Date.now() - t0) / 1000).toFixed(0), "s —", await page.evaluate(() => document.body.innerText.match(/(Scheduler tuned[^\n]*|already close[^\n]*|Not enough[^\n]*)/)?.[1]));
  await page.click("nav.tabs >> text=Library"); await page.waitForTimeout(500); await shot("library");
  await page.click("text=Medicine"); await page.waitForTimeout(400); await shot("library-medicine");
  await page.click("text=Specialties"); await page.waitForTimeout(400); await shot("library-specialties");
  await page.click("text=similar pairs"); await page.waitForTimeout(600); await shot("duplicates");
  await page.click('[aria-label="Close duplicates"]'); await page.waitForTimeout(300);
  await page.click(".seg >> text=Systems"); await page.waitForTimeout(400); await page.click("text=Cardiovascular"); await page.waitForTimeout(500); await shot("system-node");
  const boss = await page.locator("text=Boss fight").count(); console.log("boss available on Cardiovascular:", boss);
  if (boss) { await page.click("text=Boss fight"); await page.waitForTimeout(800); await shot("boss"); await page.click("text=Show answer"); await page.waitForTimeout(300); await page.click("text=Got it"); await page.waitForTimeout(300); await page.click('[aria-label="Close"]'); }
  await page.click("nav.tabs >> text=Progress"); await page.waitForTimeout(1500); await shot("progress"); await page.evaluate(() => window.scrollBy(0, 900)); await page.waitForTimeout(300); await shot("progress-2");
  await page.click("nav.tabs >> text=Settings"); await page.waitForTimeout(500); await page.evaluate(() => window.scrollBy(0, 600)); await shot("settings");
  console.log("mastery sample:", await page.evaluate(() => { const m = (window as any).yuzu.masteryBySystem(); return [...m].slice(0, 3).map(([k, v]: any) => `${k}: ${JSON.stringify(v)}`).join(" | "); }));
} finally { console.log("errors:", errors.length ? errors : "none"); await browser.close(); server.kill(); }
