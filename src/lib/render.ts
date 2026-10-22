// Anki template renderer: fields, conditionals, cloze, FrontSide, media rewriting.
import type { Note, Notetype } from "./model";

export interface RenderCtx {
  note: Note;
  notetype: Notetype;
  ord: number;
  deck?: string;
  resolveMedia?: (name: string) => string | null; // returns URL or null when missing
}

const clozeRe = /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g;

function fieldMap(ctx: RenderCtx): Record<string, string> {
  const m: Record<string, string> = {};
  ctx.notetype.fields.forEach((f, i) => { m[f] = ctx.note.fields[i] ?? ""; });
  return m;
}

function stripHtml(s: string): string { return s.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " "); }

function applyCloze(text: string, ord: number, side: "q" | "a"): string {
  const n = ord + 1;
  return text.replace(clozeRe, (_, num, body, hint) => {
    if (Number(num) === n) {
      if (side === "q") return `<span class="cloze" data-cloze="${num}">[${hint ? escapeHtml(hint) : "..."}]</span>`;
      return `<span class="cloze" data-cloze="${num}">${body}</span>`;
    }
    return side === "q" ? body : `<span class="cloze-inactive">${body}</span>`;
  });
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

function renderTemplate(tmpl: string, ctx: RenderCtx, side: "q" | "a", frontHtml?: string): string {
  const fields = fieldMap(ctx);
  const nonEmpty = (name: string) => {
    if (/^c\d+$/.test(name)) return ctx.notetype.kind === "cloze" && Number(name.slice(1)) === ctx.ord + 1;
    const raw = fields[name] ?? "";
    if (/<img|\[sound:|<audio|<video/i.test(raw)) return true;
    return stripHtml(raw.replace(/<br\s*\/?>/gi, "")).trim().length > 0;
  };
  // Conditionals (innermost first, repeat until stable).
  let out = tmpl;
  const condRe = /\{\{([#^])([^}]+)\}\}([\s\S]*?)\{\{\/\2\}\}/;
  for (let i = 0; i < 50; i++) {
    const m = out.match(condRe);
    if (!m) break;
    const [whole, kind, name, body] = m;
    const show = kind === "#" ? nonEmpty(name.trim()) : !nonEmpty(name.trim());
    out = out.replace(whole, show ? body : "");
  }
  out = out.replace(/\{\{([^}]+)\}\}/g, (whole, rawName: string) => {
    const name = rawName.trim();
    if (name === "FrontSide") return frontHtml ?? "";
    if (name === "Tags") return ctx.note.tags.join(" ");
    if (name === "Deck" || name === "Subdeck") return ctx.deck ?? "";
    if (name === "Card") return ctx.notetype.templates[ctx.ord]?.name ?? "";
    if (name === "Type") return ctx.notetype.name;
    const parts = name.split(":");
    const fname = parts[parts.length - 1];
    const filters = parts.slice(0, -1);
    let val = fields[fname];
    if (val === undefined) return whole;
    for (const f of filters.reverse()) {
      if (f === "cloze") val = applyCloze(val, ctx.ord, side);
      else if (f === "text") val = stripHtml(val);
      else if (f === "hint") val = side === "q" && val ? `<span class="hint">[${fname}]</span>` : val;
      else if (f === "type") val = side === "q" ? `<input class="typeans" placeholder="Type the answer" />` : `<div class="typeans-answer">${val}</div>`;
      else if (f === "cloze-only") val = applyCloze(val, ctx.ord, side);
    }
    return val;
  });
  return out;
}

export function rewriteMedia(html: string, resolve?: (name: string) => string | null): string {
  let out = html.replace(/<img([^>]*?)\ssrc=["']([^"']+)["']/gi, (whole, attrs, src) => {
    if (/^(https?:|data:|blob:)/i.test(src)) return whole;
    const url = resolve?.(decodeURIComponent(src)) ?? resolve?.(src);
    if (url) return `<img${attrs} src="${url}"`;
    return `<img${attrs} data-missing="${escapeHtml(src)}" alt="" class="missing-media" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='60'%3E%3Crect width='120' height='60' rx='8' fill='%23222'/%3E%3Ctext x='60' y='35' font-size='11' fill='%23888' text-anchor='middle' font-family='sans-serif'%3Eimage not loaded%3C/text%3E%3C/svg%3E"`;
  });
  out = out.replace(/\[sound:([^\]]+)\]/g, (_, name) => {
    const url = resolve?.(name);
    return url ? `<audio controls preload="none" src="${url}"></audio>` : ""; // audio is not imported; show nothing rather than a broken control
  });
  out = out.replace(/<script[\s\S]*?<\/script>/gi, "");
  // Deck HTML runs in the app's origin: drop inline event handlers and javascript: URLs (their functions are gone with the scripts anyway).
  out = out.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "").replace(/(href|src)\s*=\s*(["']?)\s*javascript:[^"'>\s]*\2/gi, "");
  return out;
}

export function renderCard(ctx: RenderCtx): { front: string; back: string; css: string } {
  const tmpl = ctx.notetype.templates[Math.min(ctx.ord, ctx.notetype.templates.length - 1)] ?? ctx.notetype.templates[0];
  const front = renderTemplate(tmpl?.qfmt ?? "{{Front}}", ctx, "q");
  const back = renderTemplate(tmpl?.afmt ?? "{{FrontSide}}<hr id=answer>{{Back}}", ctx, "a", front);
  return { front: rewriteMedia(front, ctx.resolveMedia), back: rewriteMedia(back, ctx.resolveMedia), css: ctx.notetype.css };
}

/** Plain-text preview of a note (first non-empty field), for lists and duplicate detection. */
export function noteTitle(note: Note, nt?: Notetype): string {
  for (const f of note.fields) {
    const t = stripHtml(f.replace(clozeRe, (_, __, body) => body).replace(/\[sound:[^\]]+\]/g, "")).trim();
    if (t) return t.length > 140 ? t.slice(0, 140) + "…" : t;
  }
  return nt?.name ? `(${nt.name}, empty)` : "(empty)";
}
