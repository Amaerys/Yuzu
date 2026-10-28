import { chromium } from "playwright"; import { spawn } from "node:child_process";
const port = 8789; const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch(); const page = await (await browser.newContext({ viewport: { width: 412, height: 915 } })).newPage();
try {
  await page.goto(`http://127.0.0.1:${port}/`); await page.waitForSelector("text=Nothing to study yet");
  await page.click("nav.tabs >> text=Settings"); await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { (d as HTMLDetailsElement).open = true; }));
  await page.locator("input[type=file]").first().setInputFiles("/mnt/user-data/uploads/collection-2026-10-27_20-46-39.colpkg");
  await page.waitForFunction(() => /^Imported/m.test(document.body.innerText), null, { timeout: 900000 });
  await page.click("nav.tabs >> text=Today"); await page.click(".hero >> text=Study"); await page.waitForTimeout(200); if (await page.locator("text=25 cards").count()) await page.click("text=25 cards");
  for (let i = 0; i < 3; i++) { await page.click("text=Show answer"); await page.click(".answer-bar .good"); }
  const cdp = await page.context().newCDPSession(page); await cdp.send("Profiler.enable"); await cdp.send("Profiler.setSamplingInterval", { interval: 200 }); await cdp.send("Profiler.start");
  await page.click('[aria-label="Close"]'); await page.waitForTimeout(800);
  const { profile } = await cdp.send("Profiler.stop") as any;
  const self = new Map<string, number>(); const dt = profile.timeDeltas; const byId = new Map(profile.nodes.map((n: any) => [n.id, n]));
  profile.samples.forEach((id: number, i: number) => { const n: any = byId.get(id); const k = `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").pop()}:${n.callFrame.lineNumber}`; self.set(k, (self.get(k) ?? 0) + (dt[i] ?? 0) / 1000); });
  console.log([...self].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => `${v.toFixed(0)} ms  ${k}`).join("\n"));
} finally { await browser.close(); server.kill(); }
