// One file, one step: an Anki export with media → cards, then images and sounds automatically.
import { chromium } from "playwright"; import { spawn } from "node:child_process";
const port = 8775; const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const out = process.argv[2]; const browser = await chromium.launch(); const page = await (await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2 })).newPage();
const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(`http://127.0.0.1:${port}/`); await page.waitForSelector("text=Nothing to study yet");
  await page.click("nav.tabs >> text=Settings"); await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { (d as HTMLDetailsElement).open = true; }));
  const t = Date.now();
  await page.locator('input[type=file]').first().setInputFiles("/home/claude/mediabig/combo.apkg");
  await page.waitForFunction(() => /Imported/.test(document.body.innerText), null, { timeout: 120000 }); console.log(`cards in ${((Date.now() - t) / 1000).toFixed(0)} s`);
  await page.waitForTimeout(3000); await page.locator("summary", { hasText: "Images and sounds" }).scrollIntoViewIfNeeded(); await page.screenshot({ path: `${out}/combo-progress.png` });
  await page.waitForFunction(() => /^(Added|Failed)/m.test(document.body.innerText), null, { timeout: 600000 }); console.log(`all in ${((Date.now() - t) / 1000).toFixed(0)} s`);
  console.log(await page.evaluate(() => document.body.innerText.match(/^(Added|Failed)[^\n]*/m)?.[0]));
  console.log(await page.evaluate(() => { const m = (window as any).yuzu.mediaStatus(); return `${m.images.stored}/${m.images.total} images, ${m.sounds.stored}/${m.sounds.total} sounds, ${(m.bytes / 1048576).toFixed(0)} MB; missing e.g. ${m.missing.slice(0, 5).join(" | ")}`; }));
  await page.locator("summary", { hasText: "Images and sounds" }).scrollIntoViewIfNeeded(); await page.screenshot({ path: `${out}/combo-done.png` });
  // Study a card that has a sound.
  const q = await page.evaluate(() => { const st = (window as any).yuzu; for (const n of st.notes.values()) if (n.fields.some((f: string) => f.includes("[sound:"))) return n.fields.map((f: string) => f.replace(/<[^>]+>|\[sound:[^\]]+\]/g, " ").replace(/&nbsp;/g, " ").trim()).find((x: string) => x.length > 4)?.slice(0, 30); return null; });
  console.log("sound note:", q);
  await page.click("nav.tabs >> text=Library"); await page.fill("input[placeholder^=Search]", q!); await page.waitForTimeout(500);
  await page.locator(".list-row").first().click(); await page.waitForSelector("text=Preview"); await page.waitForTimeout(400);
  console.log("preview sound buttons:", await page.locator(".sheet .card-host").evaluate((el) => el.shadowRoot!.querySelectorAll(".yz-sound[data-src]").length));
  await page.screenshot({ path: `${out}/combo-sound.png` });
  await page.locator(".sheet .card-host").evaluate((el) => (el.shadowRoot!.querySelector(".yz-sound") as HTMLElement).click()); await page.waitForTimeout(300);
  console.log("playing:", await page.locator(".sheet .card-host").evaluate((el) => !!el.shadowRoot!.querySelector(".yz-sound.playing")));
  await page.click('[aria-label="Close preview"]');
  // An image card.
  const qi = await page.evaluate(() => { const st = (window as any).yuzu; for (const n of st.notes.values()) if (n.fields.some((f: string) => /<img/.test(f) && !f.includes("_"))) return n.fields.map((f: string) => f.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").trim()).find((x: string) => x.length > 4)?.slice(0, 30); return null; });
  await page.fill("input[placeholder^=Search]", qi!); await page.waitForTimeout(500); await page.locator(".list-row").first().click(); await page.waitForSelector("text=Preview"); await page.waitForTimeout(600);
  console.log("image:", await page.locator(".sheet .card-host").evaluate((el) => [...el.shadowRoot!.querySelectorAll("img")].map((i) => `${i.src.slice(0, 5)} ${i.naturalWidth}x${i.naturalHeight}${i.classList.contains("missing-media") ? " MISSING" : ""}`).join(", ")));
  await page.screenshot({ path: `${out}/combo-image.png` });
} finally { console.log("errors:", errors.length ? errors : "none"); await browser.close(); server.kill(); }
