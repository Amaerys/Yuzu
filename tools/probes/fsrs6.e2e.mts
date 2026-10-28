// FSRS-6 upgrade on an existing device + trade-off table + mastered stats.
import { chromium } from "playwright"; import { spawn } from "node:child_process";
const port = 8786; const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch(); const errors: string[] = []; const OUT = "/tmp/claude-0/-home-claude/a4e6c5d5-ff32-5a83-8739-0d47ab59416d/scratchpad";
try {
  const page = await (await browser.newContext({ viewport: { width: 420, height: 900 } })).newPage();
  page.on("pageerror", (e) => errors.push(e.message)); page.on("dialog", (d) => d.accept());
  await page.goto(`http://127.0.0.1:${port}/`); await page.waitForSelector("text=Nothing to study yet");
  await page.click("nav.tabs >> text=Settings"); await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { (d as HTMLDetailsElement).open = true; }));
  await page.locator("input[type=file]").first().setInputFiles("test/fixtures/medicine-legacy.apkg"); await page.waitForFunction(() => /Imported/.test(document.body.innerText), null, { timeout: 120000 });
  // pretend this device was tuned under FSRS-5 (19 weights) and fitted
  await page.evaluate(`(async () => { const st = window.yuzu; await st.saveSettings({ scheduler: { ...st.settings.scheduler, w: [0.5,1.3,3.5,16,7,0.55,1.5,0.005,1.6,0.12,1.0,1.9,0.11,0.3,2.2,0.23,3.0,0.5,0.66] }, fit: { at: Date.now(), n: 500, before: 0.4, after: 0.38 } }); })()`);
  const due0 = await page.evaluate(() => { const c = [...(window as any).yuzu.cards.values()].find((c: any) => c.state === "review"); return c ? [c.id, c.due] : null; });
  await page.reload(); await page.waitForSelector("text=cards ready");
  console.log("after upgrade:", await page.evaluate(() => { const s = (window as any).yuzu.settings; return `w ${s.scheduler.w.length} (w19 ${s.scheduler.w[19]}, decay ${s.scheduler.w[20]}), fit ${s.fit ? "kept" : "cleared → re-tunes"}`; }), "| due unchanged:", await page.evaluate((d) => d && (window as any).yuzu.cards.get(d[0]).due === d[1], due0));
  // rate a few cards: intervals sane
  console.log("intervals for a card:", await page.evaluate(() => { const y = (window as any).yuzu; const c = [...y.cards.values()].find((c: any) => c.state === "review"); return c ? JSON.stringify((window as any).yuzu.previewFor?.(c.id) ?? null) : "none"; }));
  await page.click("nav.tabs >> text=Settings"); await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { if (/What each choice/.test(d.querySelector("summary")?.textContent ?? "")) (d as HTMLDetailsElement).open = true; }));
  await page.waitForFunction(() => /Still remembered after a year/.test(document.body.innerText), null, { timeout: 30000 });
  const tbl = page.locator("text=Still remembered after a year").locator("xpath=ancestor::details[1]"); await tbl.scrollIntoViewIfNeeded(); await tbl.screenshot({ path: `${OUT}/tradeoff.png` });
  console.log("table:", (await tbl.innerText()).split("\n").slice(1, 10).join(" | "));
  // mastered stats
  await page.evaluate(`(async () => { const st = window.yuzu; const cs = [...st.cards.values()].slice(0, 6); for (const [i, c] of cs.entries()) { const now = Date.now() - 86400000 * 3; st.cards.set(c.id, { ...c, state: "review", reps: 8, lastReview: now, due: now + (i < 2 ? 25 : i < 4 ? 6 : 3) * 365.25 * 86400000 }); } await st.autoMaster(); })()`);
  await page.click("nav.tabs >> text=Progress"); await page.waitForTimeout(500); await page.screenshot({ path: `${OUT}/progress-mastered.png` });
  console.log("progress:", await page.evaluate(() => document.body.innerText.match(/Mastered[\s\S]{0,220}/)?.[0].replace(/\n/g, " | ")));
  await page.click("nav.tabs >> text=Today"); await page.waitForTimeout(400); console.log("today:", await page.evaluate(() => document.body.innerText.match(/\d+\s*mastered/)?.[0]));
} finally { console.log("errors:", errors.length ? errors : "none"); await browser.close(); server.kill(); }
