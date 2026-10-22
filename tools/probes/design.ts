import { chromium } from "playwright"; import { spawn } from "node:child_process"; import fs from "node:fs";
const port = 8774; const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800)); fs.mkdirSync("/home/claude/final/design", { recursive: true });
const browser = await chromium.launch(); const page = await (await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2 })).newPage();
const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
const shot = (n: string) => page.screenshot({ path: `/home/claude/final/design/${n}.png` });
try {
  await page.goto(`http://127.0.0.1:${port}/`); await page.waitForTimeout(2500); await page.click("nav.tabs >> text=Settings"); await page.waitForTimeout(400);
  await page.locator('input[type=file]').first().setInputFiles(process.argv[2] ?? "test/fixtures/medicine-legacy.apkg");
  await page.waitForFunction(() => /Imported/.test(document.body.innerText), null, { timeout: 600000 });
  if (process.argv[3]) { await page.locator('input[type=file]').first().setInputFiles(process.argv[3]); await page.waitForFunction(() => /duplicate groups merged/.test(document.body.innerText), null, { timeout: 300000 }); }
  await page.click("nav.tabs >> text=Today"); await page.waitForTimeout(1200); await shot("today");
  await page.click("nav.tabs >> text=Library"); await page.waitForTimeout(500); await shot("library");
  await page.click(".seg >> text=Systems"); await page.waitForTimeout(500); await shot("library-systems");
  await page.click("nav.tabs >> text=Today"); await page.waitForTimeout(300); await page.click("text=Study"); await page.waitForTimeout(600); await shot("plan");
  await page.click("text=25 minutes"); await page.waitForTimeout(800); await shot("study-front");
  await page.click("text=Show answer"); await page.waitForTimeout(400); await shot("study-back");
  await page.click('[aria-label="More"]'); await page.waitForTimeout(300); await shot("study-menu");
  await page.goBack(); await page.waitForTimeout(500); console.log("after back: study still open?", await page.locator(".study").count());
  await page.click("nav.tabs >> text=Progress"); await page.waitForTimeout(1200); await shot("progress");
} finally { console.log("errors:", errors.length ? errors : "none"); await browser.close(); server.kill(); }
