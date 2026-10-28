// Speed at the user's scale: the real Anki export (~150k cards). Times start-up, each tab, opening a study session,
// answering, and the heavier screens. Prints long main-thread tasks.
import { chromium } from "playwright"; import { spawn } from "node:child_process";
const port = 8787; const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch(); const errors: string[] = [];
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } }); const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push(e.message)); page.on("dialog", (d) => d.accept());
const longTasks = () => page.evaluate(() => { const l = (window as any).__lt ?? []; (window as any).__lt = []; return l.length ? `${l.length} long tasks, max ${Math.round(Math.max(...l))} ms, total ${Math.round(l.reduce((a: number, b: number) => a + b, 0))} ms` : "no long tasks"; });
await page.addInitScript(() => { (window as any).__lt = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) (window as any).__lt.push(e.duration); }).observe({ type: "longtask", buffered: true }); } catch {} });
const time = async (label: string, fn: () => Promise<unknown>) => { await longTasks(); const t = Date.now(); await fn(); await page.waitForTimeout(300); console.log(`${label}: ${Date.now() - t - 300} ms · ${await longTasks()}`); };
try {
  await page.goto(`http://127.0.0.1:${port}/`); await page.waitForSelector("text=Nothing to study yet");
  await page.click("nav.tabs >> text=Settings"); await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { (d as HTMLDetailsElement).open = true; }));
  let t = Date.now(); await page.locator("input[type=file]").first().setInputFiles("/mnt/user-data/uploads/collection-2026-10-27_20-46-39.colpkg");
  await page.waitForFunction(() => /^Imported/m.test(document.body.innerText), null, { timeout: 900000 }); console.log(`import: ${((Date.now() - t) / 1000).toFixed(0)} s`);
  console.log("size:", await page.evaluate(() => `${(window as any).yuzu.notes.size} notes, ${(window as any).yuzu.cards.size} cards, ${(window as any).yuzu.reviews.length} reviews`));
  await time("reload to ready", async () => { await page.reload(); await page.waitForSelector("text=cards ready", { timeout: 300000 }); });
  await time("Today", () => page.click("nav.tabs >> text=Today"));
  await time("Library", () => page.click("nav.tabs >> text=Library"));
  await time("Progress", () => page.click("nav.tabs >> text=Progress"));
  await time("Settings", () => page.click("nav.tabs >> text=Settings"));
  await time("Settings: open all sections", () => page.evaluate(() => document.querySelectorAll("details.section").forEach((d) => { (d as HTMLDetailsElement).open = true; })));
  await time("Today again", () => page.click("nav.tabs >> text=Today"));
  await time("start study", async () => { await page.click(".hero >> text=Study"); await page.waitForTimeout(200); if (await page.locator("text=25 cards").count()) await page.click("text=25 cards"); await page.waitForSelector("text=Show answer"); });
  for (let i = 0; i < 5; i++) await time(`answer ${i + 1}`, async () => { await page.click("text=Show answer"); await page.click(".answer-bar .good"); });
  await time("leave study", () => page.click('[aria-label="Close"]'));
  await time("Library search 'ecg'", async () => { await page.click("nav.tabs >> text=Library"); const s = page.locator("input[type=search], input[placeholder*='Search']").first(); if (await s.count()) await s.fill("ecg"); });
  await time("sync snapshot (shard hashes)", () => page.evaluate(async () => { const { GitHubSync } = (window as any).__sync ?? {}; return null; }));
  console.log("memory:", await page.evaluate(() => `${Math.round(((performance as any).memory?.usedJSHeapSize ?? 0) / 1048576)} MB JS heap`));
} finally { console.log("errors:", errors.length ? errors : "none"); await browser.close(); server.kill(); }
