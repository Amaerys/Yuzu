// The user's real sequence: Oct collection + v2 curation (= today's Yuzu) → new Anki export → the final file.
import { chromium } from "playwright"; import { spawn } from "node:child_process"; import fs from "node:fs";
const FINAL = process.argv[2]; const SHOTS = process.argv[3];
const port = 8777; const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch({ args: ["--js-flags=--max-old-space-size=6000"] }); const page = await (await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2 })).newPage();
const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
const f = JSON.parse(fs.readFileSync(FINAL, "utf8"));
const settings = async () => { await page.click("nav.tabs >> text=Settings"); await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { (d as HTMLDetailsElement).open = true; })); };
const pick = async (file: string, done: RegExp, label: string) => { const t = Date.now(); await page.locator("input[type=file]").first().setInputFiles(file); await page.waitForFunction((src) => new RegExp(src, "m").test(document.body.innerText), done.source, { timeout: 1500000 }); console.log(label, `${((Date.now() - t) / 1000).toFixed(0)} s`); };
const stats = () => page.evaluate((f) => { const st = (window as any).yuzu; const cards = [...st.cards.values()];
  const edited = f.edits.filter((e: any) => { const n = st.notes.get(e.id); return n && Object.entries(e.fields).every(([k, v]) => n.fields[Number(k)] === v); }).length;
  const present = f.edits.filter((e: any) => st.notes.has(e.id)).length;
  const reviewedKept = f.edits.filter((e: any) => cards.some((c: any) => c.nid === e.id && c.reps > 0)).length;
  const srcs = new Set(cards.map((c: any) => c.source)); const top = new Map<string, number>(); for (const c of cards) { const k = c.source.split("::").slice(0, 3).join("::"); top.set(k, (top.get(k) ?? 0) + 1); }
  const susp = f.suspend.filter((id: string) => cards.some((c: any) => c.nid === id && c.suspended)).length;
  return { notes: st.notes.size, cards: cards.length, reviews: st.reviews.length, edits: `${edited}/${present} applied`, editedWithHistory: reviewedKept, suspended: `${susp}/${f.suspend.length}`, folders: srcs.size, underscores: [...srcs].filter((s: any) => /_/.test(s)).length, top: Object.fromEntries([...top].sort((a, b) => b[1] - a[1]).slice(0, 14)) }; }, f);
try {
  await page.goto(`http://127.0.0.1:${port}/`); await page.waitForSelector("text=Nothing to study yet"); await settings();
  await pick("/mnt/user-data/uploads/Finalcollex.colpkg", /^Imported/, "Oct collection");
  await page.locator("input[type=file]").first().setInputFiles("/home/claude/final/yuzu-curation-v2-2026-10-21.json"); await page.waitForFunction(() => /duplicate groups merged/.test(document.body.innerText), null, { timeout: 600000 });
  await page.evaluate(() => (window as any).yuzu.saveSettings({ deckMap: {} }));
  // a little review history on cards the final file edits, to prove it survives
  const nids = f.edits.slice(0, 40).map((e: any) => e.id);
  await page.evaluate(async (nids) => { const st = (window as any).yuzu; for (const id of nids) { const c = [...st.cards.values()].find((c: any) => c.nid === id); if (c) { st.cards.set(c.id, { ...c, reps: 3, state: "review", stability: 12, lastReview: Date.now() - 86400000 }); } } }, nids);
  await pick("/mnt/user-data/uploads/collection-2026-10-27_20-46-39.colpkg", /^Imported/, "new Anki export");
  const t = Date.now(); await page.locator("input[type=file]").first().setInputFiles(FINAL);
  await page.waitForFunction(() => /duplicate groups merged/.test(document.body.innerText), null, { timeout: 1500000 });
  console.log(`final file ${((Date.now() - t) / 1000).toFixed(0)} s:`, (await page.evaluate(() => document.body.innerText.match(/^.*duplicate groups merged.*$/m)?.[0]))?.slice(0, 1200));
  console.log("after:", JSON.stringify(await stats(), null, 1));
  await page.reload(); await page.waitForSelector("text=cards ready", { timeout: 300000 }); console.log("after reload:", JSON.stringify(await stats()));
  // Library screenshot of the tree + a study card in the new look
  await page.click("nav.tabs >> text=Library"); await page.click(".seg >> text=Decks"); await page.waitForTimeout(800); await page.screenshot({ path: `${SHOTS}/final-library.png` });
  await page.click("text=Medicine"); await page.waitForTimeout(500); await page.screenshot({ path: `${SHOTS}/final-medicine.png` });
  await page.click("text=Skills"); await page.waitForTimeout(500); await page.screenshot({ path: `${SHOTS}/final-skills.png` });
} finally { console.log("errors:", errors.length ? errors : "none"); await browser.close(); server.kill(); }
