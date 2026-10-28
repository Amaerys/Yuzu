// Leaving the app and coming back at full scale: what blocks the main thread (sync on hide/show), and how long
// pressing Study takes while that runs. Real export (~147k cards) + in-process fake GitHub.
import { chromium } from "playwright"; import { spawn } from "node:child_process";
import { fakeGitHub } from "../../test/fake-github.ts";
const port = 8795; const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const gh = fakeGitHub(); const browser = await chromium.launch(); const errors: string[] = [];
const page = await (await browser.newContext({ viewport: { width: 412, height: 915 } })).newPage();
page.on("pageerror", (e) => errors.push(e.message)); page.on("dialog", (d) => d.accept());
await page.addInitScript(`window.__lt = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: "longtask", buffered: true }); } catch (e) {}`);
await page.route("https://api.github.com/**", async (route) => { const req = route.request(); const res = await gh.fetchImpl(req.url(), { method: req.method(), body: req.postData() ?? undefined } as any); await route.fulfill({ status: res.status, body: Buffer.from(await res.arrayBuffer()), contentType: "application/octet-stream" }); });
const lt = () => page.evaluate(`(() => { const l = window.__lt; window.__lt = []; return l.length ? l.length + " long tasks: " + l.map((x) => x[1]).sort((a, b) => b - a).slice(0, 6).join(", ") + " ms" : "none"; })()`);
const syncDone = () => page.waitForFunction(() => (window as any).yuzu.syncStatus.state !== "syncing", null, { timeout: 600000 });
try {
  await page.goto(`http://127.0.0.1:${port}/`); await page.waitForSelector("text=Nothing to study yet");
  await page.click("nav.tabs >> text=Settings"); await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { (d as HTMLDetailsElement).open = true; }));
  await page.locator("input[type=file]").first().setInputFiles("/mnt/user-data/uploads/collection-2026-10-27_20-46-39.colpkg");
  await page.waitForFunction(() => /^Imported/m.test(document.body.innerText), null, { timeout: 900000 });
  await page.evaluate(() => (window as any).yuzu.saveSettings({ sync: { owner: "o", repo: "r", token: "t", auto: true }, deviceName: "S25" }));
  let t = Date.now(); await page.evaluate(() => (window as any).yuzu.sync()); await syncDone(); console.log(`first sync ${((Date.now() - t) / 1000).toFixed(0)} s:`, await page.evaluate(() => (window as any).yuzu.syncStatus.message));
  await page.reload(); await page.waitForSelector("text=cards ready", { timeout: 300000 }); await page.waitForTimeout(4000); await syncDone(); await lt();
  // study a few cards
  await page.click("nav.tabs >> text=Today"); await page.click(".hero >> text=Study"); await page.waitForTimeout(300); if (await page.locator("text=25 cards").count()) await page.click("text=25 cards");
  for (let i = 0; i < 4; i++) { await page.click("text=Show answer"); await page.click(".answer-bar .good"); }
  await lt();
  // leave the app (hidden) and come back (visible) — profiled
  const cdp = await page.context().newCDPSession(page); await cdp.send("Profiler.enable"); await cdp.send("Profiler.setSamplingInterval", { interval: 200 }); await cdp.send("Profiler.start");
  t = Date.now();
  await page.evaluate(`Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }); document.dispatchEvent(new Event("visibilitychange"));`);
  await page.waitForTimeout(200); await syncDone(); console.log(`sync on leaving: ${Date.now() - t} ms · ${await lt()} ·`, await page.evaluate(() => (window as any).yuzu.syncStatus.message));
  { const { profile } = await cdp.send("Profiler.stop") as any; const self = new Map<string, number>(); const byId = new Map(profile.nodes.map((n: any) => [n.id, n])); const parent = new Map<number, number>(); for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
    profile.samples.forEach((id: number, i: number) => { let n: any = byId.get(id); const chain: string[] = []; for (let k = 0; k < 4 && n; k++) { chain.push(n.callFrame.functionName || "(anon)"); n = byId.get(parent.get(n.id)!); } const key = chain.join(" < "); self.set(key, (self.get(key) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000); });
    console.log([...self].filter(([k]) => !/^\(idle\)|^\(program\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `  ${v.toFixed(0)} ms  ${k}`).join("\n")); }
  await page.evaluate(`Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" }); document.dispatchEvent(new Event("visibilitychange"));`);
  t = Date.now(); await page.waitForTimeout(2600); await syncDone(); console.log(`sync on return: ${Date.now() - t} ms · ${await lt()} ·`, await page.evaluate(() => (window as any).yuzu.syncStatus.message));
  // pressing Study (Show answer + Good) right as the return-sync starts
  await page.evaluate(() => { document.dispatchEvent(new Event("visibilitychange")); });
  await page.waitForTimeout(600); t = Date.now(); await page.click("text=Show answer"); await page.click(".answer-bar .good"); console.log(`answer during return-sync: ${Date.now() - t} ms`); await syncDone(); console.log("  long tasks:", await lt());
} finally { console.log("errors:", errors.length ? errors : "none"); await browser.close(); server.kill(); }
