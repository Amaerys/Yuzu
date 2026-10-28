// Mastery: >20 y retires on start, >5 y offered in Progress; log syncs; retired cards stay gone after reload.
import { chromium } from "playwright"; import { spawn } from "node:child_process";
const port = 8785; const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch(); const errors: string[] = []; const OUT = "/tmp/claude-0/-home-claude/a4e6c5d5-ff32-5a83-8739-0d47ab59416d/scratchpad";
try {
  const page = await (await browser.newContext({ viewport: { width: 420, height: 900 } })).newPage();
  page.on("pageerror", (e) => errors.push(e.message)); page.on("dialog", (d) => d.accept());
  await page.goto(`http://127.0.0.1:${port}/`); await page.waitForSelector("text=Nothing to study yet");
  await page.click("nav.tabs >> text=Settings"); await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { (d as HTMLDetailsElement).open = true; }));
  await page.locator("input[type=file]").first().setInputFiles("test/fixtures/medicine-legacy.apkg"); await page.waitForFunction(() => /Imported/.test(document.body.innerText), null, { timeout: 120000 });
  // 3 cards at 25 years, 6 at 7 years, 4 at 3 years (stays)
  await page.evaluate(`(async () => { const st = window.yuzu; const cs = [...st.cards.values()].slice(0, 13); const D = 86400000, now = Date.now() - 2 * D; const db = []; cs.forEach((c, i) => { const y = i < 3 ? 25 : i < 9 ? 7 : 3; const n = { ...c, state: "review", reps: 9, lastReview: now, due: now + y * 365.25 * D, mod: Date.now() }; st.cards.set(c.id, n); db.push(n); }); await st.saveCardsForTest?.(db); window.__ids = cs.map((c) => c.id); })()`);
  // persist through the store's own path: flag toggle writes the card
  await page.evaluate(`(async () => { const st = window.yuzu; for (const id of window.__ids) { await st.setFlag(id, 1); await st.setFlag(id, 0); } })()`);
  const n0 = await page.evaluate(() => (window as any).yuzu.cards.size);
  await page.reload(); await page.waitForSelector("text=cards ready"); await page.waitForTimeout(4500);
  console.log("cards before/after start-up:", n0, "→", await page.evaluate(() => (window as any).yuzu.cards.size), "| log:", await page.evaluate(() => (window as any).yuzu.mastery.log.map((e: any) => e.by + " " + e.intervalDays + "d " + e.front.slice(0, 40))));
  await page.click("nav.tabs >> text=Progress"); await page.waitForTimeout(500);
  console.log("progress:", await page.evaluate(() => document.body.innerText.match(/Mastered[^\n]*\n[^\n]*\n[^\n]*/)?.[0]?.replace(/\n/g, " | ")));
  await page.screenshot({ path: `${OUT}/progress.png` }); await page.click("text=/ready to retire/"); await page.waitForTimeout(400); await page.screenshot({ path: `${OUT}/retire-list.png` });
  // untick 2 → keep them; mark the other 4
  const boxes = page.locator(".sheet input[type=checkbox]"); console.log("listed:", await boxes.count());
  await boxes.nth(0).uncheck(); await boxes.nth(1).uncheck();
  await page.click("text=/Mark mastered \\(4\\)/"); await page.waitForTimeout(500);
  await page.click("text=/ready to retire/"); await page.waitForTimeout(300); await page.click("button:has-text(\"Keep studying\")"); await page.waitForTimeout(400);
  console.log("after:", await page.evaluate(() => { const y = (window as any).yuzu; return `${y.cards.size} cards, ${y.masteryCandidates().length} candidates, log ${y.mastery.log.length}, kept ${Object.keys(y.mastery.kept).length}`; }));
  await page.reload(); await page.waitForSelector("text=cards ready"); await page.click("nav.tabs >> text=Progress"); await page.waitForTimeout(500);
  console.log("after reload:", await page.evaluate(() => { const y = (window as any).yuzu; return `${y.cards.size} cards, ${y.masteryCandidates().length} candidates, log ${y.mastery.log.length}`; }));
  await page.click("text=/Log · /"); await page.waitForTimeout(400); await page.screenshot({ path: `${OUT}/retire-log.png` });
} finally { console.log("errors:", errors.length ? errors : "none"); await browser.close(); server.kill(); }
