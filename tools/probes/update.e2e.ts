// Real sequence: old collection + v2 curation (= the user's Yuzu today) → new Anki export → update curation.
import { chromium } from "playwright"; import { spawn } from "node:child_process"; import fs from "node:fs";
const port = 8776; const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch({ args: ["--js-flags=--max-old-space-size=6000"] }); const page = await (await browser.newContext({ viewport: { width: 412, height: 915 } })).newPage();
const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
const changed = JSON.parse(fs.readFileSync("/home/claude/final2/changed.json", "utf8"));
const cur = JSON.parse(fs.readFileSync("/home/claude/final2/yuzu-curation-anki-update-27-10-2026.json", "utf8"));
const settings = async () => { await page.click("nav.tabs >> text=Settings"); await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { (d as HTMLDetailsElement).open = true; })); };
const step = async (file: string, done: RegExp, label: string) => { const t = Date.now(); await page.locator("input[type=file]").first().setInputFiles(file); await page.waitForFunction((src) => new RegExp(src, "m").test(document.body.innerText), done.source, { timeout: 1500000 }); console.log(label, `${((Date.now() - t) / 1000).toFixed(0)} s:`, await page.evaluate((src) => document.body.innerText.match(new RegExp("^.*" + src + ".*$", "m"))?.[0], done.source)); };
const count = () => page.evaluate(([cur, ch]: any) => { const st = (window as any).yuzu; const newIds = cur.tags["anki::new-27-10-2026"]; const susp = cur.suspend.filter((id: string) => [...st.cards.values()].some((c: any) => c.nid === id && c.suspended)).length;
  const srcs = new Set(newIds.flatMap((id: string) => [...st.cards.values()].filter((c: any) => c.nid === id).map((c: any) => c.source)));
  const back = cur.merges.flatMap((m: any) => m.drop).filter((d: string) => st.notes.has(d)).length;
  let upd = 0, tot = 0; for (const [id, f] of Object.entries(ch)) { const x = st.notes.get(id); if (!x) continue; tot++; if (x.fields.join("|") === (f as string[]).join("|")) upd++; }
  return `Anki edits in Yuzu ${upd}/${tot} | notes ${st.notes.size} cards ${st.cards.size} reviews ${st.reviews.length} | new present ${newIds.filter((id: string) => st.notes.has(id)).length} in ${[...srcs].join(" ; ")} | suspended-gone ${susp}/${cur.suspend.length} | merged-back ${back} | deckMap ${Object.keys(st.settings.deckMap).length}`; }, [cur, changed]);
try {
  await page.goto(`http://127.0.0.1:${port}/`); await page.waitForSelector("text=Nothing to study yet"); await settings();
  await step("/mnt/user-data/uploads/Finalcollex.colpkg", /^Imported/, "old collection");
  await page.locator("input[type=file]").first().setInputFiles("/home/claude/final/yuzu-curation-v2-2026-10-21.json"); await page.waitForFunction(() => /duplicate groups merged/.test(document.body.innerText), null, { timeout: 600000 });
  // simulate "already applied before this release": forget the learned map
  await page.evaluate(() => (window as any).yuzu.saveSettings({ deckMap: {} }));
  console.log("today's Yuzu:", await count());
  await step("/mnt/user-data/uploads/collection-2026-10-27_20-46-39.colpkg", /^Imported/, "new export");
  console.log("after import:", await count());
  await page.locator("input[type=file]").first().setInputFiles("/home/claude/final2/yuzu-curation-anki-update-27-10-2026.json"); await page.waitForFunction(() => /cards suspended|duplicate groups merged/.test(document.body.innerText), null, { timeout: 600000 });
  console.log("curation:", await page.evaluate(() => document.body.innerText.match(/^.*duplicate groups merged.*$/m)?.[0]));
  console.log("after update file:", await count());
  // Next import is organized by itself now
  await step("/mnt/user-data/uploads/collection-2026-10-27_20-46-39.colpkg", /^Imported/, "re-import");
  console.log("after re-import:", await count());
  await page.reload(); await page.waitForSelector("text=cards ready", { timeout: 300000 }); console.log("after reload:", await count());
} finally { console.log("errors:", errors.length ? errors : "none"); await browser.close(); server.kill(); }
