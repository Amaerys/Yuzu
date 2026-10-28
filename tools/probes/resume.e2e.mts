// A study session survives a reload: same cards, same place, same count done.
import { chromium } from "playwright"; import { spawn } from "node:child_process";
const port = 8796; const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch(); const errors: string[] = []; const OUT = "/tmp/claude-0/-home-claude/a4e6c5d5-ff32-5a83-8739-0d47ab59416d/scratchpad";
try {
  const page = await (await browser.newContext({ viewport: { width: 412, height: 915 } })).newPage(); page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/`); await page.waitForSelector("text=Nothing to study yet");
  await page.click("nav.tabs >> text=Settings"); await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { (d as HTMLDetailsElement).open = true; }));
  await page.locator("input[type=file]").first().setInputFiles("test/fixtures/medicine-legacy.apkg"); await page.waitForFunction(() => /Imported/.test(document.body.innerText), null, { timeout: 120000 });
  await page.click("nav.tabs >> text=Today"); await page.click(".hero >> text=Study"); await page.waitForTimeout(300); if (await page.locator("text=25 cards").count()) await page.click("text=25 cards");
  const front = () => page.evaluate(() => document.querySelector(".card-host")?.shadowRoot?.textContent?.replace(/\s+/g, " ").slice(-50));
  for (let i = 0; i < 3; i++) { await page.click("text=Show answer"); await page.click(".answer-bar .good"); await page.waitForTimeout(150); }
  const before = { left: await page.evaluate(() => document.body.innerText.match(/\d+ left/)?.[0]), card: await front(), reviews: await page.evaluate(() => (window as any).yuzu.reviews.length) };
  await page.reload(); await page.waitForSelector("text=Show answer", { timeout: 30000 });
  const after = { left: await page.evaluate(() => document.body.innerText.match(/\d+ left/)?.[0]), card: await front(), reviews: await page.evaluate(() => (window as any).yuzu.reviews.length) };
  console.log("before reload:", JSON.stringify(before)); console.log("after reload: ", JSON.stringify(after), "| same place:", before.left === after.left && before.card === after.card);
  await page.click('[aria-label="Close"]'); await page.waitForTimeout(300); await page.reload(); await page.waitForTimeout(2500);
  console.log("after closing + reload, back on Today:", await page.locator("text=Show answer").count() === 0);
  await page.screenshot({ path: `${OUT}/today-forecast.png`, fullPage: true });
} finally { console.log("errors:", errors.length ? errors : "none"); await browser.close(); server.kill(); }
