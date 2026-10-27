// Side-by-side: deck look vs Yuzu look, for real notes of the top note types (paper + slate, front + back).
import fs from "node:fs";
import { renderCard } from "../../src/lib/render.ts";
import { SKIN_CSS, isShortCard } from "../../src/ui/cardskin.ts";
const study = fs.readFileSync("src/ui/Study.tsx", "utf8"); const BASE = study.match(/export const BASE_CSS = `([\s\S]*?)`;/)![1];
const d = JSON.parse(fs.readFileSync("/home/claude/final2/dump.json", "utf8"));
const nts = new Map<string, any>(d.notetypes.map((t: any) => [t.id, t]));
const byNt = new Map<string, any[]>(); for (const n of d.notes) (byNt.get(n.ntid) ?? byNt.set(n.ntid, []).get(n.ntid)!).push(n);
const top = [...byNt.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, Number(process.argv[3] ?? 10));
const card = (html: string, css: string, dark: boolean, skin: boolean) => { const cls = dark ? "night_mode nightMode" : ""; return `<div class="paper ${dark ? "slate" : ""}"><template shadowrootmode="open"><style>${BASE}</style><style>${css}</style>${skin ? `<style>${SKIN_CSS}</style>` : ""}<div class="${cls}"><div class="card ${cls}${skin && isShortCard(html) ? " yz-short" : ""}">${html}</div></div></template></div>`; };
let body = "";
for (const [ntid, notes] of top) {
  const nt = nts.get(ntid); const pick = [notes[Math.floor(notes.length * 0.37)], notes[Math.floor(notes.length * 0.81)]];
  for (const n of pick) {
    const r = renderCard({ note: n, notetype: nt, ord: 0, deck: "", resolveMedia: () => null });
    body += `<h3>${nt.name.slice(0, 60)}</h3><div class="row">${card(r.back, r.css, false, false)}${card(r.back, r.css, false, true)}${card(r.back, r.css, true, true)}</div>`;
  }
}
fs.writeFileSync(process.argv[2], `<!doctype html><meta charset=utf-8><style>body{background:#15120d;color:#ffd9b0;font:14px system-ui;margin:12px;--sans:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif} .row{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:22px} .paper{background:#f4ebd6;color:#1b1710;border:2px solid #1b1710;padding:16px 16px 16px 22px;min-height:140px;max-height:640px;overflow:hidden} .paper.slate{background:#231d14;color:#ffd9b0} h3{margin:6px 0;font-size:13px}</style><div class="row"><b>Deck's own (paper)</b><b>Yuzu (paper)</b><b>Yuzu (slate / night)</b></div>${body}`);
console.log("written", top.length * 2, "samples");
