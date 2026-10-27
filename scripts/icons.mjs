// App icons from the 16×16 yuzu sprite, scaled with nearest-neighbour so every sprite pixel stays a crisp square.
import sharp from "sharp";
import fs from "node:fs";
import { createRequire } from "node:module";
const src = fs.readFileSync(new URL("../src/ui/sprites.ts", import.meta.url), "utf8");
const PALETTE = Object.fromEntries([...src.matchAll(/^\s+(\w): "(#[0-9a-f]{6})"/gim)].map((m) => [m[1], m[2]]));
const YUZU = JSON.parse("[" + src.split("export const YUZU = [")[1].split("];")[0].trim().replace(/,\s*$/, "") + "]");
const N = 16; const raw = Buffer.alloc(N * N * 4);
YUZU.forEach((row, y) => [...row].forEach((ch, x) => { const c = PALETTE[ch]; if (!c) return; const i = (y * N + x) * 4; raw[i] = parseInt(c.slice(1, 3), 16); raw[i + 1] = parseInt(c.slice(3, 5), 16); raw[i + 2] = parseInt(c.slice(5, 7), 16); raw[i + 3] = 255; }));
const sprite = sharp(raw, { raw: { width: N, height: N, channels: 4 } });
fs.mkdirSync("public/icons", { recursive: true });
const BG = "#15120d";
for (const [name, size, scale] of [["icon-192.png", 192, 10], ["icon-512.png", 512, 28], ["apple-touch-icon.png", 180, 9], ["maskable-512.png", 512, 20], ["favicon-32.png", 32, 2]]) {
  const inner = await sprite.clone().resize(N * scale, N * scale, { kernel: "nearest" }).png().toBuffer();
  const off = Math.floor((size - N * scale) / 2);
  await sharp({ create: { width: size, height: size, channels: 4, background: BG } }).composite([{ input: inner, left: off, top: off }]).png().toFile("public/icons/" + name);
}
await sprite.clone().resize(256, 256, { kernel: "nearest" }).png().toFile("/tmp/yuzu-sprite-preview.png");
console.log("icons ok");
