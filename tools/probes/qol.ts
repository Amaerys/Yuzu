import { chromium } from "playwright"; import { spawn } from "node:child_process";
const port = 8776; const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch(); const page = await (await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2 })).newPage();
const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(`http://127.0.0.1:${port}/`); await page.waitForTimeout(2500); await page.click("nav.tabs >> text=Settings"); await page.waitForTimeout(400);
  await page.locator('input[type=file]').first().setInputFiles("test/fixtures/medicine-legacy.apkg"); await page.waitForFunction(() => /Imported/.test(document.body.innerText), null, { timeout: 120000 });
  await page.click("nav.tabs >> text=Today"); await page.waitForTimeout(500); await page.click(".hero >> text=Study"); await page.waitForTimeout(500);
  await page.click(".done .btn >> text=/^10 minutes/"); await page.waitForTimeout(500);
  console.log("top bar:", await page.locator(".study-top .num").innerText());
  const ratings = ["again", "good", "again", "good", "good", "again", "hard", "good", "good", "good"];
  for (const r of ratings) { await page.click("text=Show answer"); await page.click(`.answer-bar .${r}`); await page.waitForTimeout(150); }
  // finish the rest quickly
  while (await page.locator(".answer-bar, .show-bar").count() && !(await page.locator(".done").count())) { if (await page.locator("text=Show answer").count()) await page.click("text=Show answer"); else await page.click(".answer-bar .good"); await page.waitForTimeout(60); }
  await page.waitForTimeout(400); await page.screenshot({ path: "/home/claude/final/design/summary.png" });
  console.log("summary:", (await page.locator(".done").innerText()).replace(/\n/g, " | ").slice(0, 300));
  await page.click("text=Redo the missed ones"); await page.waitForTimeout(400); console.log("redo top bar:", await page.locator(".study-top .num").innerText());
  await page.click('[aria-label="Close"]'); await page.waitForTimeout(400); await page.screenshot({ path: "/home/claude/final/design/today2.png" });
  console.log("today has misses card:", await page.locator("text=Redo today's misses").count());
  await page.click("text=Redo today's misses"); await page.waitForTimeout(500); console.log("missed session:", await page.locator(".study-meta .where").innerText(), await page.locator(".study-top .num").innerText());
} finally { console.log("errors:", errors.length ? errors : "none"); await browser.close(); server.kill(); }
