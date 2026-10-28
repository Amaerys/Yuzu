// Which store calls are slow at full scale (real export, ~147k cards).
import { chromium } from "playwright"; import { spawn } from "node:child_process";
const port = 8788; const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch(); const page = await (await browser.newContext()).newPage();
try {
  await page.goto(`http://127.0.0.1:${port}/`); await page.waitForSelector("text=Nothing to study yet");
  await page.click("nav.tabs >> text=Settings"); await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { (d as HTMLDetailsElement).open = true; }));
  await page.locator("input[type=file]").first().setInputFiles("/mnt/user-data/uploads/collection-2026-10-27_20-46-39.colpkg");
  await page.waitForFunction(() => /^Imported/m.test(document.body.innerText), null, { timeout: 900000 });
  const r = await page.evaluate(`(() => { const y = window.yuzu; const out = []; const T = (name, f) => { const t = performance.now(); f(); const a = performance.now() - t; const t2 = performance.now(); f(); out.push(name + ": " + a.toFixed(0) + " ms (again " + (performance.now() - t2).toFixed(0) + ")"); };
    T("stats", () => y.stats()); T("stateCounts", () => y.stateCounts()); T("tree", () => y.tree()); T("tree systems", () => y.tree("systems")); T("queue root", () => y.queue("")); T("reviewedToday", () => y.reviewedToday()); T("missedToday", () => y.missedToday()); T("weakestSystem", () => y.weakestSystem()); T("masteryBySystem", () => y.masteryBySystem(Date.now()));
    T("mediaRefs", () => y.mediaRefs()); T("mediaStatus", () => y.mediaStatus()); T("masteryCandidates", () => y.masteryCandidates()); T("otherWants", () => y.otherWants()); T("reversibleNotetypes", () => y.reversibleNotetypes()); T("typicalAnswerMs", () => y.typicalAnswerMs()); T("calibration", () => y.calibration());
    y.bump && 0; return out; })()`);
  console.log((r as string[]).join("\n"));
  const r2 = await page.evaluate(`(async () => { const y = window.yuzu; const c = [...y.cards.values()][5]; await y.setFlag(c.id, 1); const t = performance.now(); y.mediaRefs(); const a = performance.now() - t; const t1 = performance.now(); y.stats(); y.tree(); return "after one change: mediaRefs " + a.toFixed(0) + " ms, stats+tree " + (performance.now() - t1).toFixed(0) + " ms"; })()`);
  console.log(r2);
} finally { await browser.close(); server.kill(); }
