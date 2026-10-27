import { chromium } from "playwright"; import { spawn } from "node:child_process"; import fs from "node:fs";
const port = 8774; const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch(); const page = await (await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2 })).newPage();
const out = process.argv[2]; const mp3 = fs.readFileSync("/home/claude/mediabig/s.mp3").toString("base64");
try {
  await page.goto(`http://127.0.0.1:${port}/`); await page.waitForSelector("text=Nothing to study yet");
  await page.click("nav.tabs >> text=Settings"); await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { (d as HTMLDetailsElement).open = true; }));
  await page.locator('input[type=file]').first().setInputFiles("test/fixtures/medicine-legacy.apkg");
  await page.waitForFunction(() => /Imported/.test(document.body.innerText), null, { timeout: 120000 });
  await page.locator("summary", { hasText: "Images and sounds" }).scrollIntoViewIfNeeded(); await page.evaluate(() => window.scrollBy(0, -10));
  await page.screenshot({ path: `${out}/media-settings.png` });
  // A sound on every card so the first study card shows the button.
  await page.evaluate(async (b64) => { const st = (window as any).yuzu; const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); st.media.set("hallo.mp3", new Blob([bytes], { type: "audio/mpeg" }));
    for (const n of [...st.notes.values()].slice(0, 400)) { const f = [...n.fields]; f[0] = f[0] + " [sound:hallo.mp3]"; await st.updateNote(n.id, f, n.tags.filter((t: string) => !t.startsWith("auto::"))); } }, mp3);
  await page.click("nav.tabs >> text=Today"); await page.click(".hero >> text=Study"); await page.waitForSelector("text=cards ready");
  await page.click(".done .btn >> text=/^25 cards/"); await page.waitForSelector(".study .card-host");
  await page.waitForTimeout(500); await page.screenshot({ path: `${out}/sound-card.png` });
  console.log("buttons:", await page.locator(".study .card-host").evaluate((el) => el.shadowRoot!.querySelectorAll(".yz-sound").length));
} finally { await browser.close(); server.kill(); }
