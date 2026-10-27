import { chromium } from "playwright"; import { spawn } from "node:child_process";
const dir = process.argv[2]; const port = 8778; const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", dir], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 700));
const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 760, height: 300 } })).newPage();
await p.goto(`http://127.0.0.1:${port}/`); await p.waitForTimeout(700); await p.screenshot({ path: dir + "/font.png" }); await b.close(); server.kill();
