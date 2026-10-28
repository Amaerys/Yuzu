import { chromium } from "playwright"; import { spawn } from "node:child_process";
const port = 8784; const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch(); const errors: string[] = [];
try {
  const page = await (await browser.newContext({ viewport: { width: 420, height: 860 } })).newPage();
  page.on("pageerror", (e) => errors.push(e.message)); page.on("dialog", (d) => d.accept());
  await page.goto(`http://127.0.0.1:${port}/`); await page.waitForSelector("text=Nothing to study yet");
  await page.click("nav.tabs >> text=Settings"); await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { (d as HTMLDetailsElement).open = true; }));
  await page.locator("input[type=file]").first().setInputFiles("test/fixtures/medicine-legacy.apkg"); await page.waitForFunction(() => /Imported/.test(document.body.innerText), null, { timeout: 120000 });
  const count = () => page.evaluate(() => `${(window as any).yuzu.notes.size} notes / ${(window as any).yuzu.cards.size} cards`);
  console.log("before:", await count());
  await page.click("nav.tabs >> text=Today"); await page.click(".hero >> text=Study"); await page.waitForTimeout(500);
  if (await page.locator("text=25 cards").count()) await page.click("text=25 cards");
  const front = () => page.evaluate(() => document.querySelector(".card-host")?.shadowRoot?.textContent?.replace(/\s+/g, " ").slice(-60));
  const f1 = await front();
  await page.click('[aria-label="More"]'); await page.click("text=Delete this card"); await page.waitForTimeout(500);
  console.log("after delete:", await count(), "| toast:", await page.evaluate(() => document.body.innerText.match(/Deleted[^\n]*/)?.[0]), "| next card differs:", f1 !== (await front()));
  await page.click('[aria-label="Undo"]'); await page.waitForTimeout(500);
  console.log("after undo:", await count(), "| same card back:", f1 === (await front()));
  await page.click('[aria-label="More"]'); await page.click("text=Delete this card"); await page.waitForTimeout(300);
  await page.reload(); await page.waitForSelector("text=cards ready"); console.log("deleted again + reload:", await count());
  // Library bulk delete + undo
  await page.click("nav.tabs >> text=Library"); await page.waitForTimeout(500);
  const sel = page.locator("text=Select"); if (await sel.count()) { await sel.first().click(); }
  console.log("library select available:", await sel.count());
} finally { console.log("errors:", errors.length ? errors : "none"); await browser.close(); server.kill(); }
