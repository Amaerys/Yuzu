// Needs improving: mark in Study and Library → Settings list → export for Claude → Claude's curation (edit + split with
// the picture moved + resolved) → marks cleared, review history kept, split card shows the picture.
import { chromium } from "playwright"; import { spawn } from "node:child_process"; import fs from "node:fs";
const port = 8791; const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch(); const errors: string[] = []; const OUT = "/tmp/claude-0/-home-claude/a4e6c5d5-ff32-5a83-8739-0d47ab59416d/scratchpad";
try {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, acceptDownloads: true }); const page = await ctx.newPage(); page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/`); await page.waitForSelector("text=Nothing to study yet");
  await page.click("nav.tabs >> text=Settings"); await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { (d as HTMLDetailsElement).open = true; }));
  await page.locator("input[type=file]").first().setInputFiles("test/fixtures/medicine-legacy.apkg"); await page.waitForFunction(() => /Imported/.test(document.body.innerText), null, { timeout: 120000 });
  // Study: mark the current card
  await page.click("nav.tabs >> text=Today"); await page.click(".hero >> text=Study"); await page.waitForTimeout(300); if (await page.locator("text=25 cards").count()) await page.click("text=25 cards");
  await page.click("text=Show answer"); await page.click(".answer-bar .good"); // one review on the first card
  await page.click('[aria-label="Undo"]'); await page.waitForTimeout(300); await page.click("text=Show answer"); await page.click(".answer-bar .good"); await page.waitForTimeout(200);
  const nid = await page.evaluate(() => { const y = (window as any).yuzu; const r = y.reviews[y.reviews.length - 1]; return y.cards.get(r.cid).nid; });
  await page.click('[aria-label="Undo"]'); await page.waitForTimeout(300); await page.click("text=Show answer"); await page.click(".answer-bar .good"); await page.click('[aria-label="Undo"]'); await page.waitForTimeout(300);
  await page.click('[aria-label="More"]'); await page.click("text=Needs improving…"); await page.waitForTimeout(200);
  await page.click("text=Too much on one card — split it"); await page.click("text=Picture/sound problem"); await page.fill("textarea", "split the causes; ECG picture goes with the answer");
  await page.screenshot({ path: `${OUT}/improve-sheet.png` });
  await page.click("text=Mark for improving"); await page.waitForTimeout(200);
  const marked = await page.evaluate(() => { const y = (window as any).yuzu; return Object.entries(y.improve).filter(([, m]: any) => m.r.length).map(([k, m]: any) => k + " " + m.r.join(",") + " " + m.t); });
  console.log("marked from study:", marked);
  await page.click('[aria-label="Close"]');
  // Settings list + export
  await page.click("nav.tabs >> text=Settings"); await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { (d as HTMLDetailsElement).open = true; }));
  console.log("settings:", await page.evaluate(() => document.body.innerText.match(/\d+ cards? marked[\s\S]{0,160}/)?.[0].replace(/\n/g, " | ")));
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("button:has-text(\"Send to Claude\")")]);
  const fp = `${OUT}/${dl.suggestedFilename()}`; await dl.saveAs(fp); const ex = JSON.parse(fs.readFileSync(fp, "utf8"));
  console.log("export:", dl.suggestedFilename(), "count", ex.count, "| card:", JSON.stringify({ ...ex.cards[0], fields: ex.cards[0].fields.map((f: string) => f.slice(0, 60)) }).slice(0, 400));
  // Claude's answer: edit the note, split one fact off with a picture, resolve
  const target = ex.cards[0]; const reps0 = await page.evaluate((id) => (window as any).yuzu.cardsOfNote(id).map((c: any) => c.reps + "/" + c.state).join(","), target.id);
  const cur = { yuzu_curation: 1, name: "Improved cards", edits: [{ id: target.id, fields: { "0": target.fields[0] + " <i>(improved)</i>" } }], packs: [{ yuzu_pack: 1, id: "improve-test", name: "Split cards", cards: [{ id: "split-1", type: "basic", front: "Split fact?", back: 'Answer with picture <img src="ecg one.png">', category: target.deck }] }], resolved: [target.id] };
  fs.writeFileSync(`${OUT}/curation-improve.json`, JSON.stringify(cur));
  await page.locator("input[type=file]").first().setInputFiles(`${OUT}/curation-improve.json`); await page.waitForFunction(() => /cards improved|Split cards/.test(document.body.innerText), null, { timeout: 60000 });
  console.log("after import: marks", await page.evaluate(() => Object.values((window as any).yuzu.improve).filter((m: any) => m.r.length).length), "| history kept:", reps0 === await page.evaluate((id) => (window as any).yuzu.cardsOfNote(id).map((c: any) => c.reps + "/" + c.state).join(","), target.id), "| split card:", await page.evaluate(() => [...(window as any).yuzu.notes.values()].some((n: any) => /Split fact/.test(n.fields.join()))), "| ecg one.png referenced:", await page.evaluate(() => (window as any).yuzu.mediaRefs().has("ecg one.png")));
  // Library bulk mark
  await page.evaluate(() => (window as any).yuzu.markImprove([...(window as any).yuzu.notes.keys()].slice(10, 13), ["unclear"], ""));
  await page.reload(); await page.waitForSelector("text=cards ready"); console.log("after reload marks:", await page.evaluate(() => Object.values((window as any).yuzu.improve).filter((m: any) => m.r.length).length));
  await page.click("nav.tabs >> text=Settings"); await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { if (/Cards to improve/.test(d.textContent ?? "")) (d as HTMLDetailsElement).open = true; }));
  const sec = page.locator("summary:has-text('Cards to improve')").locator("xpath=.."); await sec.scrollIntoViewIfNeeded(); await sec.screenshot({ path: `${OUT}/improve-settings.png` });
} finally { console.log("errors:", errors.length ? errors : "none"); await browser.close(); server.kill(); }
