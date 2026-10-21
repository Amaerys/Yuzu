import { chromium } from "playwright"; import { spawn } from "node:child_process";
const port = 8772; const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch(); const page = await (await browser.newContext({ viewport: { width: 420, height: 860 } })).newPage();
const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(`http://127.0.0.1:${port}/`); await page.waitForTimeout(2500); await page.click("nav.tabs >> text=Settings"); await page.waitForTimeout(500);
  await page.locator('input[type=file]').first().setInputFiles("test/fixtures/medicine-legacy.apkg");
  await page.waitForFunction(() => /Imported/.test(document.body.innerText), null, { timeout: 120000 });
  console.log("before:", await page.evaluate(() => document.body.innerText.match(/[\d,]+ of [\d,]+ images[^.]*\./)?.[0]));
  await page.locator('input[type=file][accept*=apkg]').nth(1).setInputFiles("test/fixtures/legacy-with-media.apkg");
  await page.waitForFunction(() => /images added/.test(document.body.innerText), null, { timeout: 120000 });
  console.log("result:", await page.evaluate(() => document.body.innerText.match(/[\d,]+ images added[^.]*\./)?.[0]));
  console.log("after:", await page.evaluate(() => document.body.innerText.match(/[\d,]+ of [\d,]+ images[^.]*\./)?.[0]));
  // find a card using the big image and preview it
  await page.click("nav.tabs >> text=Library"); await page.waitForTimeout(300);
  const title = await page.evaluate(() => { const st = (window as any).yuzu; for (const n of st.notes.values()) if (n.fields.some((f: string) => f.includes("img_20150110121948"))) { const t = n.fields.map((f: string) => f.replace(/<[^>]+>/g, " ").trim()).find((x: string) => x.length > 3); return (t || "").slice(0, 25); } return ""; });
  console.log("search for:", title);
  await page.fill('input[placeholder="Search cards and tags here"]', title); await page.waitForTimeout(500);
  const n = await page.locator(".list-row").count(); console.log("rows for search:", n);
  if (n) { await page.locator(".list-row").first().click(); await page.waitForTimeout(800);
    console.log("preview img:", await page.evaluate(() => { const host = document.querySelector(".sheet .card-host") as any; const img = host?.shadowRoot?.querySelector("img"); return img ? `${img.src.slice(0, 5)} ${img.naturalWidth}x${img.naturalHeight} missing=${img.classList.contains("missing-media")}` : "none"; })); }
  await page.reload(); await page.waitForTimeout(2500); await page.click("nav.tabs >> text=Settings"); await page.waitForTimeout(300);
  console.log("after reload:", await page.evaluate(() => document.body.innerText.match(/[\d,]+ of [\d,]+ images[^.]*\./)?.[0]));
} finally { console.log("errors:", errors.length ? errors : "none"); await browser.close(); server.kill(); }
