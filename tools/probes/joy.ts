import { chromium } from "playwright"; import { spawn } from "node:child_process"; import fs from "node:fs";
const port = 8777; const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800)); fs.mkdirSync("/home/claude/final/joy", { recursive: true });
const browser = await chromium.launch(); const page = await (await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2 })).newPage();
const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
const shot = (n: string) => page.screenshot({ path: `/home/claude/final/joy/${n}.png` });
try {
  await page.goto(`http://127.0.0.1:${port}/`); await page.waitForTimeout(2500); await page.click("nav.tabs >> text=Settings"); await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { (d as HTMLDetailsElement).open = true; }));
  await page.locator('input[type=file]').first().setInputFiles("test/fixtures/medicine-legacy.apkg"); await page.waitForFunction(() => /Imported/.test(document.body.innerText), null, { timeout: 120000 });
  await page.locator('input[type=file]').first().setInputFiles("test/fixtures/hyperkalemia.yuzu.json"); await page.waitForFunction(() => /cards added/.test(document.body.innerText));
  await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { (d as HTMLDetailsElement).open = false; })); await page.evaluate(() => window.scrollTo(0, 0)); await shot("settings");
  await page.click("nav.tabs >> text=Library"); await page.fill('input[placeholder="Search cards and tags here"]', "peaked"); await page.waitForTimeout(500);
  await page.locator(".list-row").first().click(); await page.waitForTimeout(500); await page.click('[aria-label="Close preview"]');
  // study a cloze card from the pack: hint + hook
  await page.click("nav.tabs >> text=Library"); await page.waitForTimeout(300); await page.fill('input[placeholder="Search cards and tags here"]', ""); await page.waitForTimeout(300);
  await page.click(".tree-row .name >> text=\"Medicine\""); await page.waitForTimeout(300);
  await page.click(".tree-row .name >> text=\"Emergency Medicine\""); await page.waitForTimeout(300); await page.click(".tree-row .name >> text=\"Electrolytes\""); await page.waitForTimeout(300); await page.click(".card-box >> text=Study"); await page.waitForTimeout(600);
  if (await page.locator(".done .btn").count()) await page.click(".done .btn >> text=/^10 minutes/");
  await page.waitForTimeout(500); await page.click("text=Hint"); await page.waitForTimeout(300); await shot("hint");
  await page.click("text=Show answer"); await page.waitForTimeout(300); await page.click('[aria-label="More"]'); await page.click("text=Add my hook"); await page.waitForTimeout(300);
  await page.fill(".hook textarea", "Peaked T = tent poles going up"); await page.click(".hook >> text=Save"); await page.waitForTimeout(400); await shot("hook");
  await page.click('[aria-label="Close"]'); await page.waitForTimeout(400);
  await page.click("nav.tabs >> text=Today"); await page.waitForTimeout(500); await shot("today");
  await page.click("nav.tabs >> text=Progress"); await page.waitForTimeout(800); await shot("progress");
} finally { console.log("errors:", errors.length ? errors : "none"); await browser.close(); server.kill(); }
