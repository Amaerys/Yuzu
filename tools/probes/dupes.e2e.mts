import { chromium } from "playwright"; import { spawn } from "node:child_process";
const port = 8790; const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch(); const errors: string[] = []; const OUT = "/tmp/claude-0/-home-claude/a4e6c5d5-ff32-5a83-8739-0d47ab59416d/scratchpad";
try {
  const page = await (await browser.newContext({ viewport: { width: 412, height: 915 } })).newPage(); page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/`); await page.waitForSelector("text=Nothing to study yet");
  await page.click("nav.tabs >> text=Settings"); await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { (d as HTMLDetailsElement).open = true; }));
  await page.locator("input[type=file]").first().setInputFiles("test/fixtures/medicine-legacy.apkg"); await page.waitForFunction(() => /Imported/.test(document.body.innerText), null, { timeout: 120000 });
  // make a near-duplicate of the first basic note
  await page.evaluate(`(async () => { const st = window.yuzu; const n = [...st.notes.values()].find((n) => n.fields.length >= 2 && n.fields[1].length > 20 && !/\\{\\{c/.test(n.fields[0])); const f = [...n.fields]; f[1] = f[1] + " again"; const id = "dup" + Date.now(); st.notes.set(id, { ...n, id, guid: id, fields: f, tags: [...n.tags, "needs-review::similar"], modified: Date.now() }); st.notes.set(n.id, { ...n, tags: [...n.tags, "needs-review::similar"] }); const c = st.cardsOfNote(n.id)[0]; st.cards.set(id + "c", { ...c, id: id + "c", nid: id, reps: 0, state: "new" }); await st.setFlag(id + "c", 1); })()`);
  console.log("pairs:", await page.evaluate(() => (window as any).yuzu.similarPairs().length));
  await page.click("nav.tabs >> text=Library"); await page.waitForTimeout(300);
  const btn = page.locator("text=/Similar|duplicates/i").first(); console.log("library entry:", await btn.count()); await btn.click(); await page.waitForTimeout(400);
  await page.locator("text=Show full card").first().click(); await page.waitForTimeout(500);
  console.log("cards rendered:", await page.locator(".paper .card-host, .paper [class*=card]").count());
  await page.screenshot({ path: `${OUT}/dupes-full.png`, fullPage: true });
} finally { console.log("errors:", errors.length ? errors : "none"); await browser.close(); server.kill(); }
