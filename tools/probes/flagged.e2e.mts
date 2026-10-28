import { chromium } from "playwright"; import { spawn } from "node:child_process";
const port = 8792; const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch(); const errors: string[] = []; const OUT = "/tmp/claude-0/-home-claude/a4e6c5d5-ff32-5a83-8739-0d47ab59416d/scratchpad";
try {
  const page = await (await browser.newContext({ viewport: { width: 412, height: 915 } })).newPage(); page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/`); await page.waitForSelector("text=Nothing to study yet");
  await page.click("nav.tabs >> text=Settings"); await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { (d as HTMLDetailsElement).open = true; }));
  await page.locator("input[type=file]").first().setInputFiles("test/fixtures/medicine-legacy.apkg"); await page.waitForFunction(() => /Imported/.test(document.body.innerText), null, { timeout: 120000 });
  await page.evaluate(async () => { const y = (window as any).yuzu; const cs = [...y.cards.values()]; await y.setFlag(cs[3].id, 1); await y.setFlag(cs[400].id, 1); await y.setFlag(cs[2000].id, 1); await y.markImprove([cs[50].nid], ["unclear"], ""); });
  await page.click("nav.tabs >> text=Library"); await page.waitForTimeout(400);
  console.log("chips:", await page.evaluate(() => [...document.querySelectorAll(".chip")].map((c) => c.textContent).filter((t) => /·/.test(t ?? "")).join(" | ")));
  await page.click("button.chip:has-text('Flagged')"); await page.waitForTimeout(400);
  console.log("list rows:", await page.locator(".list-row").count()); await page.screenshot({ path: `${OUT}/flagged.png` });
  await page.click("button.chip:has-text('To improve')"); await page.waitForTimeout(300); console.log("improve rows:", await page.locator(".list-row").count());
} finally { console.log("errors:", errors.length ? errors : "none"); await browser.close(); server.kill(); }
