import sharp from "sharp";
import fs from "node:fs";
const svg = fs.readFileSync("scripts/icon.svg");
fs.mkdirSync("public/icons", { recursive: true });
for (const [name, size, pad] of [["icon-192.png", 192, 0], ["icon-512.png", 512, 0], ["apple-touch-icon.png", 180, 0], ["maskable-512.png", 512, 60]]) {
  const inner = await sharp(svg).resize(size - pad * 2).png().toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: "#0b0b0c" } }).composite([{ input: inner, left: pad, top: pad }]).png().toFile("public/icons/" + name);
}
console.log("icons ok");
