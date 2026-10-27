import { useEffect, useMemo, useRef, useState } from "react";
import { fmtDate, fmtDateTime, fmtTime } from "../lib/dates";
import { store, type View } from "../lib/store";
import type { Card, Rating } from "../lib/model";
import { renderCard, noteTitle } from "../lib/render";
import { previewIntervals, humanInterval, retrievability, DAY } from "../scheduler/fsrs";
import { IconClose, IconUndo, IconFlag, IconPause, IconInfo, IconMore, IconEdit } from "./icons";
import { systemColor, stamp, tilt } from "./theme";
import { useBack } from "./useBack";
import { sfx } from "./sfx";
import { SKIN_CSS, isShortCard } from "./cardskin";
import { wireSounds, playSounds, stopSounds, cardSounds } from "./sound";

export const BASE_CSS = `
:host { display:block; contain: layout paint; }
details.yz-hint { display:inline-block; vertical-align:top; margin:4px 6px 4px 0; }
details.yz-hint[open] { display:block; }
details.yz-hint > summary { list-style:none; cursor:pointer; display:inline-block; padding:4px 10px; border:2px solid currentColor; font-size:13px; opacity:.75; }
details.yz-hint > summary::-webkit-details-marker { display:none; }
details.yz-hint[open] > summary { opacity:1; }
details.yz-hint .hints { display:block !important; margin-top:6px; }
.card { font-size: 20px; line-height: 1.45; font-family: inherit; }
img { max-width: 100%; height: auto; border-radius: 8px; }
hr#answer { border: 0; border-top: 2px dashed rgba(0,0,0,.18); margin: 16px -4px; }
.night_mode hr#answer { border-top-color: rgba(255,255,255,.18); }
.cloze { color: #ff7a1a; font-weight: 700; }
.cloze-inactive { color: inherit; }
.hint { color: #888; font-style: italic; }
.missing-media { opacity: .9; }
.missing-audio { color: #999; }
.yz-sound { display:inline-flex; align-items:center; justify-content:center; width:40px; height:36px; margin:2px 4px; vertical-align:middle; border:2px solid currentColor; background:transparent; color:#ff7a1a; cursor:pointer; box-shadow:2px 2px 0 rgba(0,0,0,.35); clip-path:polygon(0 4px,4px 4px,4px 0,calc(100% - 4px) 0,calc(100% - 4px) 4px,100% 4px,100% calc(100% - 4px),calc(100% - 4px) calc(100% - 4px),calc(100% - 4px) 100%,4px 100%,4px calc(100% - 4px),0 calc(100% - 4px)); }
.yz-sound:active { transform: translate(2px,2px); box-shadow:none; }
.yz-sound.playing { background:#ff7a1a; color:#15120d; animation: yzblink .5s steps(2) infinite; }
.yz-sound.missing { width:auto; height:auto; padding:0 4px; border-style:dashed; color:#999; box-shadow:none; cursor:default; }
@keyframes yzblink { 50% { opacity:.6 } }
.typeans { width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 8px; font-size: 18px; }
.night_mode .card, .card.night_mode { color: #f2f2f0; background: transparent; }
`;

export function CardView({ html, css, dark, side = "front", autoplay = false }: { html: string; css: string; dark: boolean; side?: "front" | "back"; autoplay?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current!;
    const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    const cls = dark ? "night_mode nightMode" : "";
    const skin = store.settings.cardStyle !== "deck";
    root.innerHTML = `<style>${BASE_CSS}</style><style>${css}</style>${skin ? `<style>${SKIN_CSS}</style>` : ""}<div class="${cls}"><div class="card ${cls}${skin && isShortCard(html) ? " yz-short" : ""}">${html}</div></div>`;
    host.scrollTop = 0;
    const own = wireSounds(root, side);
    if (autoplay && own.length) playSounds(own); else stopSounds();
  }, [html, css, dark]);
  useEffect(() => () => stopSounds(), []);
  return <div ref={ref} className={"card-host" + (dark ? " dark" : "")} />;
}

/** One line, rotating, after a session. Each is a well-replicated finding, phrased as something to do. */
const TIPS = [
  "Trying to recall before you look (even when you fail) beats rereading. You're already doing it.",
  "A card you nearly got is worth a hint, not a reveal: a near-miss retrieval strengthens memory more than reading the answer.",
  "Write a hook on cards that keep slipping — your own image or link, however silly. Self-made cues outlast given ones.",
  "Short sessions spread over days beat one long one. Twenty minutes today and tomorrow > forty today.",
  "Mixing topics in one session feels harder and works better: it trains you to tell similar things apart.",
  "Sleep consolidates what you reviewed. Studying right before bed is good; losing sleep to study is not.",
  "Hard ≠ failing. Cards that take effort to recall are the ones being strengthened the most.",
  "Redo the day's misses while they're fresh: one more retrieval the same day is cheap and sticks.",
  "Explaining why an answer is right (to yourself, in a sentence) makes it harder to forget than the fact alone.",
  "Boss fights are cumulative tests: passing one after a gap is the best evidence that an area is really yours.",
];

/** First letters of each cloze answer: a near-miss helper for cards that are on the tip of the tongue. */
function hintFor(note: { fields: string[] } | undefined, ord: number): string | null {
  if (!note) return null;
  const re = new RegExp(`\\{\\{c${ord + 1}::([\\s\\S]*?)(?:::[^}]*)?\\}\\}`, "g");
  const answers = [...(note.fields[0] ?? "").matchAll(re)].map((m) => m[1].replace(/<[^>]+>/g, "").trim()).filter(Boolean);
  if (!answers.length) return null;
  return answers.map((a) => a.split(/\s+/).map((w) => w[0] + "·".repeat(Math.max(1, Math.min(6, w.length - 1)))).join(" ")).join("  /  ");
}

/** The paper index card: system-colored spine, rubber-stamp state, a tiny per-card tilt, and the next card peeking out below. */
export function Paper({ card, html, css, dark, side, children }: { card: Card; html: string; css: string; dark: boolean; side?: "front" | "back"; children?: React.ReactNode }) {
  const note = store.noteFor(card);
  const system = note?.tags.find((t) => t.startsWith("auto::System::"))?.slice(14);
  return (
    <div className="paper-stage" style={{ "--spine": systemColor(system), "--tilt": `${tilt(card.id)}deg` } as any}>
      <div className="paper-under" />
      <div className={"paper" + (dark ? " slate" : "")}>
        <span className="stamp">{stamp(card)}</span>
        <CardView html={html} css={css} dark={dark} side={side} autoplay={store.settings.autoplay} />
        {children}
      </div>
    </div>
  );
}

function estimateSeconds(): number {
  const rs = store.reviews.slice(-200).map((r) => r.durationMs).filter((d) => d > 500 && d < 120000);
  if (rs.length < 10) return 9;
  rs.sort((a, b) => a - b);
  return Math.round(rs[Math.floor(rs.length / 2)] / 1000);
}

function CardInfo({ card, onClose, onSaved, onTag }: { card: Card; onClose: () => void; onSaved: () => void; onTag?: (tag: string) => void }) {
  useBack(true, onClose);
  const note = store.noteFor(card)!;
  const nt = store.notetypeFor(note)!;
  const [editing, setEditing] = useState(false);
  const [fields, setFields] = useState(note.fields);
  const [tags, setTags] = useState(note.tags.filter((t) => !t.startsWith("auto::")).join(" "));
  const history = store.reviews.filter((r) => r.cid === card.id).slice(-12).reverse();
  const now = Date.now();
  const r = card.lastReview ? retrievability((now - card.lastReview) / DAY, card.stability) : null;
  const labels = ["", "Again", "Hard", "Good", "Easy"];
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ marginBottom: 8 }}><b className="grow">{editing ? "Edit card" : "Card info"}</b><button className="icon-btn" aria-label="Close info" onClick={onClose}><IconClose /></button></div>
        {!editing ? (
          <>
            <div className="stat-grid" style={{ marginTop: 0 }}>
              <div className="stat"><b>{card.state}</b><span>state</span></div>
              <div className="stat"><b>{card.stability ? humanInterval(card.stability * DAY) : "–"}</b><span>stability</span></div>
              <div className="stat"><b>{card.difficulty ? card.difficulty.toFixed(1) : "–"}</b><span>difficulty /10</span></div>
              <div className="stat"><b>{r === null ? "–" : Math.round(r * 100) + "%"}</b><span>recall now</span></div>
              <div className="stat"><b>{card.reps}</b><span>reviews</span></div>
              <div className="stat"><b>{card.lapses}</b><span>lapses</span></div>
            </div>
            <p className="small muted">Due {card.state === "new" ? "never studied" : fmtDateTime(card.due)}<br />Source: {card.source}<br />Type: {nt.name}</p>
            {note.tags.length > 0 && <div className="row" style={{ flexWrap: "wrap", gap: 6, marginBottom: 8 }}>{note.tags.filter((t) => !t.startsWith("manual::")).map((t) => <button key={t} className={"chip" + (t.startsWith("auto::") ? " orange" : "")} onClick={() => onTag?.(t)} title="Browse this tag">{t.replace(/^auto::(System|Specialty|Exam|Level)::/, "$1: ")}</button>)}</div>}
            {history.length > 0 && (<><h2 style={{ marginTop: 6 }}>History</h2>
              {history.map((h) => <div key={h.id} className="list-row"><span className="t">{fmtDate(h.ts)} <span className="muted">{fmtTime(h.ts)}</span></span><span className={"chip " + (h.rating === 1 ? "" : "orange")}>{labels[h.rating]}</span><span className="small muted">{h.scheduledDays ? h.scheduledDays + "d" : ""}</span></div>)}
            </>)}
            <button className="btn block" style={{ marginTop: 12 }} onClick={() => setEditing(true)}>Edit this card</button>
          </>
        ) : (
          <>
            {nt.fields.map((name, i) => (
              <div className="field" key={name}><label>{name}</label><textarea rows={i === 0 ? 5 : 3} value={fields[i] ?? ""} onChange={(e) => { const f = [...fields]; f[i] = e.target.value; setFields(f); }} /></div>
            ))}
            <div className="field"><label>Tags (space separated)</label><input value={tags} onChange={(e) => setTags(e.target.value)} /></div>
            <div className="row"><button className="btn grow" onClick={() => setEditing(false)}>Cancel</button>
              <button className="btn primary grow" onClick={async () => { await store.updateNote(note.id, fields, tags.split(/\s+/).filter(Boolean)); setEditing(false); onSaved(); }}>Save</button></div>
          </>
        )}
      </div>
    </div>
  );
}

export type StudyScope = { path: string; view?: View; only?: "all" | "due" | "new"; preset?: Card[]; title?: string };

export function Study({ path, view = "decks", only = "all", preset, title, onExit, onBrowseTag }: StudyScope & { onExit: () => void; onBrowseTag?: (tag: string) => void }) {
  const fullQueue = useMemo(() => preset ?? store.queue(path, Date.now(), view, only), [path, view, only]);
  const [plan, setPlan] = useState<number | null>(preset || fullQueue.length <= 15 ? fullQueue.length : null);
  const startedAt = useRef(Date.now());
  const [results, setResults] = useState<{ id: string; g: Rating; ms: number }[]>([]);
  const [queue, setQueue] = useState<Card[]>(fullQueue);
  const [idx, setIdx] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [doneCount, setDoneCount] = useState(0);
  const [toast, setToast] = useState("");
  const [info, setInfo] = useState(false);
  const [rev, setRev] = useState(0);
  const shownAt = useRef(Date.now());
  const touch = useRef<{ x: number; y: number; t: number } | null>(null);
  const [drag, setDrag] = useState(0);
  const [typed, setTyped] = useState("");
  const [hint, setHint] = useState(false);
  const [hookOpen, setHookOpen] = useState(false);
  const [hookText, setHookText] = useState("");
  const [leech, setLeech] = useState<{ cardId: string; lapses: number } | null>(null);
  const [menu, setMenu] = useState(false);
  const total = queue.length;
  useBack(true, onExit);
  const card = queue[idx] ? (store.cards.get(queue[idx].id) ?? queue[idx]) : undefined;
  const dark = store.settings.nightCards;
  const secs = useMemo(estimateSeconds, []);

  // Learning cards from this session that became due again (rated Again/Hard minutes ago) come back
  // at their due time, interleaved into what is left; the planned size is otherwise respected.
  useEffect(() => {
    if (plan === null) return;
    const now = Date.now(); const remaining = new Set(queue.slice(idx).map((c) => c.id));
    const back = queue.slice(0, idx).map((c) => store.cards.get(c.id)!).filter((c) => c && !c.suspended && (c.state === "learning" || c.state === "relearning") && c.due <= now && !remaining.has(c.id));
    if (!back.length) return;
    setQueue((q) => { const seen = new Set(q.slice(idx).map((c) => c.id)); const add = back.filter((c) => !seen.has(c.id)); if (!add.length) return q; const at = Math.min(q.length, idx + 1); return [...q.slice(0, at), ...add, ...q.slice(at)]; });
  }, [idx]);

  useEffect(() => { shownAt.current = Date.now(); setShowAnswer(false); setInfo(false); setTyped(""); setHint(false); setHookOpen(false); setHookText(card ? store.hookFor(card.nid) : ""); }, [card?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!card || info || leech) return;
      if ((e.target as HTMLElement)?.tagName === "INPUT") { if (e.key === "Enter") { e.preventDefault(); setShowAnswer(true); (e.target as HTMLInputElement).blur(); } return; }
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); if (!showAnswer) setShowAnswer(true); else answer(3); }
      if (showAnswer && ["1", "2", "3", "4"].includes(e.key)) answer(Number(e.key) as Rating);
      if (e.key === "i") setInfo(true);
      if (e.key === "h" && !showAnswer) setHint(true);
      if (e.key === "r") playSounds(cardSounds(document.querySelector(".study .card-host")?.shadowRoot));
      if (e.key === "z" && (e.ctrlKey || e.metaKey)) undo();
      if (e.key === "Escape") onExit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const note = card && store.noteFor(card);
  const nt = note && store.notetypeFor(note);
  const rendered = useMemo(() => (card && note && nt ? renderCard({ note, notetype: nt, ord: card.ord, deck: card.source, resolveMedia: store.mediaUrl }) : null), [card?.id, rev]);
  const intervals = useMemo(() => (card ? previewIntervals(card, Date.now(), store.settings.scheduler) : null), [card?.id, rev]);
  // Typed answers for language cards: the answer is whatever the back shows that the front did not.
  const typing = !!card && store.settings.typeAnswers && card.source.startsWith("Languages") && !!nt && nt.kind === "standard";
  const answerText = useMemo(() => {
    if (!typing || !nt || !note) return "";
    const t = nt.templates[Math.min(card!.ord, nt.templates.length - 1)]; const used = (fmt: string) => [...fmt.matchAll(/\{\{([^#/^}][^}]*)\}\}/g)].map((m) => m[1].split(":").pop()!.trim());
    const front = new Set(used(t.qfmt)); const back = used(t.afmt).filter((f) => !front.has(f) && f !== "FrontSide");
    const idx = back.map((f) => nt.fields.indexOf(f)).filter((i) => i >= 0);
    return idx.map((i) => note.fields[i]).join(" ").replace(/\[sound:[^\]]+\]/g, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  }, [card?.id, typing]);
  const norm = (x: string) => x.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const hintText = useMemo(() => (card ? hintFor(note ?? undefined, card.ord) : null), [card?.id]);
  const typedOk = typed && answerText ? norm(typed) === norm(answerText) || norm(answerText).split(/[;,/]|\s-\s/).map((x) => x.trim()).includes(norm(typed)) : null;

  const busy = useRef(false);
  async function answer(g: Rating) {
    if (!card || busy.current) return;
    busy.current = true;
    const ms = Date.now() - shownAt.current;
    const before = store.stats().today;
    sfx.answer(g);
    try { await store.answer(card.id, g, ms); } finally { busy.current = false; }
    if (before < store.settings.dailyGoal && before + 1 >= store.settings.dailyGoal) { setTimeout(() => sfx.goal(), 180); flash("Daily goal reached ★"); }
    setResults((r) => [...r, { id: card.id, g, ms }]);
    setDoneCount((d) => d + 1);
    if (store.lastAnswer?.leech && store.lastAnswer.cardId === card.id) setLeech({ cardId: card.id, lapses: store.lastAnswer.lapses });
    setIdx((i) => i + 1);
    if (navigator.vibrate) navigator.vibrate(g === 1 ? [30, 40, 30] : 12);
  }
  async function undo() {
    const prev = await store.undoLast();
    if (prev) {
      // Show the undone card again, in place: it is still in the queue at idx-1 (or was inserted later as a lapse).
      setQueue((q) => { const at = q.findIndex((c, i) => i < idx && c.id === prev.id); if (at >= 0) { const c = [...q]; c[at] = prev; return c; } return [prev, ...q.slice(idx)]; });
      setIdx((i) => { const at = queue.findIndex((c, k) => k < i && c.id === prev.id); return at >= 0 ? at : 0; });
      setDoneCount((d) => Math.max(0, d - 1)); setResults((r) => r.slice(0, -1)); flash("Undone");
    } else flash("Nothing to undo");
  }
  function flash(msg: string) { setToast(msg); setTimeout(() => setToast(""), 1400); }

  // Swipe to answer (only once the answer is visible).
  const onTouchStart = (e: React.TouchEvent) => { const t = e.touches[0]; touch.current = { x: t.clientX, y: t.clientY, t: Date.now() }; };
  const onTouchMove = (e: React.TouchEvent) => { if (!touch.current || !showAnswer || !store.settings.swipe) return; const dx = e.touches[0].clientX - touch.current.x; const dy = e.touches[0].clientY - touch.current.y; if (Math.abs(dx) > Math.abs(dy)) setDrag(dx); };
  const onTouchEnd = () => {
    const d = drag; setDrag(0);
    if (!touch.current || !showAnswer || !store.settings.swipe) { touch.current = null; return; }
    touch.current = null;
    if (d < -90) answer(1); else if (d > 90) answer(3);
  };

  if (plan === null) {
    const mins = (n: number) => Math.max(1, Math.round((n * secs) / 60));
    const options = [fullQueue.length, 25, 50].filter((n, i, a) => n <= fullQueue.length && a.indexOf(n) === i);
    const byMin = (m: number) => Math.min(fullQueue.length, Math.max(5, Math.round((m * 60) / secs)));
    return (
      <div className="study">
        <div className="study-top"><button className="icon-btn" onClick={onExit} aria-label="Close"><IconClose /></button><div className="grow" /></div>
        <div className="study-body">
          <div className="done" style={{ paddingTop: 30 }}>
            <div className="big">{fullQueue.length}</div>
            <div>cards ready · about {mins(fullQueue.length)} min</div>
            <p className="muted small">Based on your usual {secs}s per card. Pick how much to do now:</p>
            <div style={{ display: "grid", gap: 8, marginTop: 16 }}>
              {[10, 25].map((m) => <button key={m} className={"btn block" + (m === 25 ? " primary" : "")} onClick={() => { const n = byMin(m); setPlan(n); setQueue(fullQueue.slice(0, n)); }}>{m} minutes <span className="muted small">· {byMin(m)} cards</span></button>)}
              {options.map((n) => <button key={n} className="btn block" onClick={() => { setPlan(n); setQueue(fullQueue.slice(0, n)); }}>{n === fullQueue.length ? `All ${n.toLocaleString()} cards` : `${n} cards`} <span className="muted small">· {mins(n)} min</span></button>)}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!card) {
    const ahead = preset ? [] : store.learningAhead(path, Date.now(), view);
    const left = preset ? 0 : store.queue(path, Date.now(), view, only).length;
    const missed = [...new Set(results.filter((r) => r.g === 1).map((r) => r.id))].map((id) => store.cards.get(id)!).filter(Boolean);
    const graded = results.filter((r) => store.cards.get(r.id)); const ok = results.filter((r) => r.g > 1).length;
    const mins = Math.max(1, Math.round((Date.now() - startedAt.current) / 60000));
    const slow = [...graded].sort((a, b) => b.ms - a.ms).slice(0, 3).filter((r) => r.ms > 15000);
    return (
      <div className="study">
        <div className="study-top"><button className="icon-btn" onClick={onExit} aria-label="Close"><IconClose /></button><div className="grow" /></div>
        <div className="study-body">
          <div className="done">
            <div className="big">{doneCount}</div>
            <div>cards in {mins} min{results.length ? ` · ${Math.round((ok / results.length) * 100)}% recalled` : ""}</div>
            <p className="small muted tip">{TIPS[(doneCount + new Date().getDate()) % TIPS.length]}</p>
            {missed.length > 0 && (
              <div className="card-box" style={{ textAlign: "left", marginTop: 18 }}>
                <b>{missed.length} missed</b>
                <div className="small muted" style={{ margin: "4px 0 10px" }}>Going through them once more now, while they are fresh, is the cheapest review you will ever do.</div>
                {missed.slice(0, 5).map((c) => { const n = store.noteFor(c); return <div key={c.id} className="small" style={{ padding: "4px 0", borderTop: "1px solid var(--line-soft)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n ? noteTitle(n) : ""}</div>; })}
                <button className="btn primary block" style={{ marginTop: 10 }} onClick={() => { setQueue(missed); setIdx(0); setPlan(missed.length); setResults([]); setDoneCount(0); startedAt.current = Date.now(); }}>Redo the missed ones</button>
              </div>
            )}
            {slow.length > 0 && <p className="muted small">Slowest: {slow.map((r) => `${Math.round(r.ms / 1000)} s`).join(", ")} — correct but slow is a card worth reading twice.</p>}
            {left > 0 && <p className="muted small">{left.toLocaleString()} more ready. <button className="btn" style={{ marginLeft: 6 }} onClick={() => { setQueue(store.queue(path, Date.now(), view, only)); setIdx(0); setPlan(left); setResults([]); setDoneCount(0); startedAt.current = Date.now(); }}>Keep going</button></p>}
            {ahead.length > 0 && <p className="muted small">{ahead.length} learning card{ahead.length > 1 ? "s" : ""} will come back later today.</p>}
            <button className="btn primary" onClick={onExit} style={{ marginTop: 16 }}>Done</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="study">
      <div className="study-top">
        <button className="icon-btn" onClick={onExit} aria-label="Close"><IconClose /></button>
        <div className="progress"><i style={{ width: `${total ? (idx / total) * 100 : 0}%` }} /></div>
        <span className="small muted num" style={{ minWidth: 64, textAlign: "right" }} title="cards left · minutes left">{total - idx} left · {Math.max(1, Math.round(((total - idx) * secs) / 60))}m</span>
        <button className="icon-btn" onClick={undo} aria-label="Undo"><IconUndo /></button>
        <button className={"icon-btn" + (menu ? " on" : "")} onClick={() => setMenu(!menu)} aria-label="More"><IconMore /></button>
      </div>
      {menu && (<>
        <div style={{ position: "fixed", inset: 0, zIndex: 34 }} onClick={() => setMenu(false)} />
        <div className="menu">
          <button onClick={() => { setMenu(false); setInfo(true); }}><IconInfo /> Card info and edit</button>
          <button onClick={() => { setMenu(false); setShowAnswer(true); setHookOpen(true); }}><IconEdit /> {hookText ? "Edit my hook" : "Add my hook"}</button>
          <button onClick={() => { setMenu(false); store.setFlag(card.id, card.flag ? 0 : 1); }}><IconFlag /> {card.flag ? "Remove flag" : "Flag this card"}</button>
          <button className="danger" onClick={async () => { setMenu(false); await store.setSuspended(card.id, true); flash("Paused — won't be shown again until unsuspended"); setIdx((i) => i + 1); }}><IconPause /> Pause this card</button>
        </div>
      </>)}
      <div className="study-meta">
        <span className="where">{title ?? card.source.split("::").slice(-2).join(" › ")}</span>
        {card.flag ? <span className="chip orange" style={{ minHeight: 24, padding: "2px 8px" }}>flagged</span> : null}
      </div>
      <div className="study-body" onClick={() => !showAnswer && setShowAnswer(true)} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
        style={{ transform: drag ? `translateX(${drag * 0.4}px)` : undefined, transition: drag ? "none" : "transform .15s" }}>
        {drag < -40 && <div className="swipe-hint again">Again</div>}
        {drag > 40 && <div className="swipe-hint good">Good</div>}
        {rendered && <Paper card={card} html={showAnswer ? rendered.back : rendered.front} side={showAnswer ? "back" : "front"} css={rendered.css} dark={dark}>
          {typing && !showAnswer && <div style={{ marginTop: 12 }} onClick={(e) => e.stopPropagation()}><input className="typeans" autoFocus={false} placeholder="Type the answer, then Enter" value={typed} onChange={(e) => setTyped(e.target.value)} autoCapitalize="none" autoCorrect="off" /></div>}
          {!showAnswer && hint && hintText && <div className="hint-line" onClick={(e) => e.stopPropagation()}>{hintText}</div>}
          {showAnswer && (hookOpen || hookText) && (
            <div className="hook" onClick={(e) => e.stopPropagation()}>
              {hookOpen ? (
                <>
                  <textarea className="typeans" rows={2} placeholder="My hook — an image, a link, a mnemonic that makes this stick" value={hookText} onChange={(e) => setHookText(e.target.value)} autoFocus />
                  <div className="row" style={{ marginTop: 6 }}><button className="btn grow" onClick={() => { setHookOpen(false); setHookText(store.hookFor(card.nid)); }}>Cancel</button><button className="btn primary grow" onClick={async () => { await store.setHook(card.nid, hookText); setHookOpen(false); flash(hookText.trim() ? "Hook saved" : "Hook removed"); }}>Save</button></div>
                </>
              ) : <button className="hook-text" onClick={() => setHookOpen(true)}><span className="small muted">my hook</span>{hookText}</button>}
            </div>
          )}
          {typing && showAnswer && typed && <div style={{ marginTop: 10 }}><span className="chip" style={{ background: typedOk ? "rgba(127,163,74,.2)" : "rgba(214,90,60,.18)", color: typedOk ? "#4e6e2a" : "#a33a22" }}>{typedOk ? "✓ " : "✗ "}{typed}{!typedOk && answerText ? ` → ${answerText}` : ""}</span></div>}
        </Paper>}
      </div>
      {!showAnswer ? (
        <div className="show-bar row">{hintText && !hint && <button className="btn" onClick={() => setHint(true)} title="First letters (h)">Hint</button>}<button className="btn primary grow" onClick={() => setShowAnswer(true)}>Show answer</button></div>
      ) : (
        <div className="answer-bar">
          <button className="again" onClick={() => answer(1)}>Again<small>{intervals?.[1]}</small></button>
          <button className="hard" onClick={() => answer(2)}>Hard<small>{intervals?.[2]}</small></button>
          <button className="good" onClick={() => answer(3)}>Good<small>{intervals?.[3]}</small></button>
          <button className="easy" onClick={() => answer(4)}>Easy<small>{intervals?.[4]}</small></button>
        </div>
      )}
      {info && <CardInfo card={card} onClose={() => setInfo(false)} onSaved={() => { setRev((r) => r + 1); flash("Saved"); }} onTag={onBrowseTag ? (t) => { setInfo(false); onBrowseTag(t); } : undefined} />}
      {leech && (
        <div className="sheet-backdrop" onClick={() => setLeech(null)}><div className="sheet" onClick={(e) => e.stopPropagation()}>
          <b>This card keeps slipping</b>
          <p className="small muted" style={{ marginTop: 4 }}>{leech.lapses} times forgotten after learning it. Why, this time?</p>
          <div style={{ display: "grid", gap: 8 }}>
            <button className="btn block" onClick={async () => { await store.leechReason(leech.cardId, "knowledge"); setLeech(null); flash("Marked: never really learned it"); }}>I never really learned it</button>
            <button className="btn block" onClick={async () => { await store.leechReason(leech.cardId, "retrieval"); setLeech(null); flash("Marked: can't recall it"); }}>I know it but can't recall it</button>
            <button className="btn block" onClick={async () => { await store.leechReason(leech.cardId, "confusion"); setLeech(null); flash("Added to the list for Claude"); }}>I mix it up with something similar</button>
            <button className="btn danger block" onClick={async () => { await store.leechReason(leech.cardId, "suspend"); setLeech(null); flash("Suspended"); }}>Suspend it for now</button>
          </div>
          <p className="small muted" style={{ marginBottom: 0 }}>Mix-ups are collected under Settings → "Cards to ask Claude about"; send me that list and I'll make contrast cards.</p>
        </div></div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
