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
// (appended) actions on flagged cards: study them, preview → edit, preview → needs improving, select → study
{
  const browser2 = await chromium.launch(); const errs: string[] = [];
  const server2 = spawn("python3", ["-m", "http.server", "8793", "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" }); await new Promise((r) => setTimeout(r, 800));
  try {
    const page = await (await browser2.newContext({ viewport: { width: 412, height: 915 } })).newPage(); page.on("pageerror", (e) => errs.push(e.message)); page.on("dialog", (d) => d.accept());
    await page.goto("http://127.0.0.1:8793/"); await page.waitForSelector("text=Nothing to study yet");
    await page.click("nav.tabs >> text=Settings"); await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { (d as HTMLDetailsElement).open = true; }));
    await page.locator("input[type=file]").first().setInputFiles("test/fixtures/medicine-legacy.apkg"); await page.waitForFunction(() => /Imported/.test(document.body.innerText), null, { timeout: 120000 });
    await page.evaluate(async () => { const y = (window as any).yuzu; const cs = [...y.cards.values()]; for (const i of [3, 400, 2000]) await y.setFlag(cs[i].id, 1); });
    await page.click("nav.tabs >> text=Library"); await page.click("button.chip:has-text('Flagged')"); await page.waitForTimeout(300);
    await page.click("button:has-text('Study these')"); await page.waitForSelector("text=Show answer", { timeout: 10000 }).catch(() => {});
    if (await page.locator("text=3 cards").count()) await page.click("text=3 cards");
    console.log("study these:", await page.evaluate(() => document.body.innerText.match(/\d+ left/)?.[0]), "| title:", await page.evaluate(() => document.querySelector(".study-meta .where, .where")?.textContent));
    await page.click("text=Show answer"); await page.click(".answer-bar .good"); await page.click('[aria-label="Close"]'); await page.waitForTimeout(400);
    await page.click("nav.tabs >> text=Library"); await page.click("button.chip:has-text('Flagged')"); await page.waitForTimeout(300);
    await page.locator(".list-row").first().click(); await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/preview-actions.png` });
    await page.click(".sheet button:has-text('Edit')"); await page.waitForTimeout(300);
    console.log("editor open:", await page.evaluate(() => /Edit|Save/.test(document.querySelector(".sheet")?.textContent ?? "")));
    await page.keyboard.press("Escape").catch(() => {}); await page.goBack().catch(() => {}); await page.waitForTimeout(300);
    console.log("back to preview:", await page.locator(".sheet:has-text('Preview')").count());
    await page.click(".sheet button:has-text('Needs improving')"); await page.click("text=Unclear question or answer"); await page.click("text=Mark for improving"); await page.waitForTimeout(300);
    console.log("marked:", await page.evaluate(() => Object.values((window as any).yuzu.improve).filter((m: any) => m.r.length).length), "| preview shows mark:", await page.locator(".sheet .chip:has-text('to improve')").count());
  } finally { console.log("errors2:", errs.length ? errs : "none"); await browser2.close(); server2.kill(); }
}
