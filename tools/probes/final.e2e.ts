import { chromium } from "playwright"; import { spawn } from "node:child_process";
const port = 8766; const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } }); const page = await ctx.newPage();
const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
try {
  await page.goto(`http://127.0.0.1:${port}/`); await page.waitForTimeout(2000); await page.click("nav.tabs >> text=Settings"); await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { (d as HTMLDetailsElement).open = true; })); await page.waitForTimeout(1000);
  let t0 = Date.now();
  await page.locator('input[type=file]').first().setInputFiles("/home/claude/final/Finalcollex.colpkg");
  await page.waitForFunction(() => /Imported|failed/.test(document.body.innerText), null, { timeout: 600000 });
  console.log("anki import:", ((Date.now() - t0) / 1000).toFixed(0), "s —", await page.evaluate(() => [...document.querySelectorAll("p.small")].map((p) => p.textContent).find((t) => /Imported|failed/.test(t ?? ""))));
  t0 = Date.now();
  await page.locator('input[type=file]').first().setInputFiles("/home/claude/final/curation.yuzu.json");
  await page.waitForFunction(() => /duplicate groups merged|failed/.test(document.body.innerText), null, { timeout: 300000 });
  console.log("curation:", ((Date.now() - t0) / 1000).toFixed(0), "s —", await page.evaluate(() => [...document.querySelectorAll("p.small")].map((p) => p.textContent).find((t) => /duplicate groups merged|failed/.test(t ?? ""))));
  const mem = await page.evaluate(() => (performance as any).memory ? Math.round((performance as any).memory.usedJSHeapSize / 1048576) + " MB heap" : "n/a"); console.log(mem);
  await page.click("nav.tabs >> text=Library");
  for (const v of ["Decks", "Systems", "Specialties", "Exams"]) { await page.click(`text=${v}`); await page.waitForTimeout(300); console.log(`\n[${v}]`, (await page.innerText("main, .screen")).split("\n").filter((l) => l.trim()).slice(0, 28).join(" | ")); }
  // reload: persisted?
  t0 = Date.now(); await page.reload(); await page.waitForSelector("nav.tabs"); await page.waitForTimeout(500); await page.click("nav.tabs >> text=Settings"); await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { (d as HTMLDetailsElement).open = true; })); await page.waitForTimeout(300);
  console.log("\nafter reload (", ((Date.now() - t0) / 1000).toFixed(1), "s ):", (await page.innerText(".screen")).match(/[\d,]+ notes · [\d,]+ cards · [\d,]+ reviews/)?.[0]);
  await page.screenshot({ path: "/home/claude/final/library.png" });
} finally { console.log("errors:", errors.length ? errors.slice(0, 5) : "none"); await browser.close(); server.kill(); }
