import { chromium } from "playwright"; import { spawn } from "node:child_process";
const server = spawn("python3", ["-m", "http.server", "4174", "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" }); await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch(); const page = await browser.newPage();
page.on("console", (m) => console.log("console:", m.text()));
try {
  await page.goto("http://127.0.0.1:4174/"); await page.waitForSelector("text=Nothing to study yet");
  await page.click("nav.tabs >> text=Settings"); await page.setInputFiles('input[type=file] >> nth=0', "test/fixtures/hyperkalemia.yuzu.json");
  await page.waitForFunction(() => document.body.innerText.includes("cards added"));
  const n = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open("yuzu"); r.onsuccess = () => { const t = r.result.transaction("media").objectStore("media").getAll(); t.onsuccess = () => res(t.result.map((m: any) => [m.name, m.blob?.size])); }; }));
  console.log("media store:", n);
  await page.click("nav.tabs >> text=Library"); await page.fill("input[placeholder^=Search]", "tented"); await page.waitForTimeout(300);
  await page.locator(".list-row").first().click(); await page.waitForSelector("text=Preview");
  console.log(await page.locator(".sheet .card-host").evaluate((el) => el.shadowRoot!.innerHTML.slice(-400)));
} finally { await browser.close(); server.kill(); }
