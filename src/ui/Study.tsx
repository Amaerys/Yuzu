import { useEffect, useMemo, useRef, useState } from "react";
import { store, type View } from "../lib/store";
import type { Card, Rating } from "../lib/model";
import { renderCard } from "../lib/render";
import { previewIntervals, humanInterval, retrievability, DAY } from "../scheduler/fsrs";
import { IconClose, IconUndo, IconFlag, IconPause, IconInfo } from "./icons";

const BASE_CSS = `
:host { display:block; }
.card { font-size: 20px; line-height: 1.45; }
img { max-width: 100%; height: auto; border-radius: 8px; }
hr#answer { border: 0; border-top: 1px solid #ddd; margin: 14px 0; }
.night_mode hr#answer { border-top-color: #333; }
.cloze { color: #ff7a1a; font-weight: 700; }
.cloze-inactive { color: inherit; }
.hint { color: #888; font-style: italic; }
.missing-media { opacity: .9; }
.missing-audio { color: #999; }
.typeans { width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 8px; font-size: 18px; }
.night_mode .card, .card.night_mode { color: #f2f2f0; background: transparent; }
`;

function CardView({ html, css, dark }: { html: string; css: string; dark: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current!;
    const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    const cls = dark ? "night_mode nightMode" : "";
    root.innerHTML = `<style>${BASE_CSS}</style><style>${css}</style><div class="${cls}"><div class="card ${cls}">${html}</div></div>`;
    host.scrollTop = 0;
  }, [html, css, dark]);
  return <div ref={ref} className={"card-host" + (dark ? " dark" : "")} />;
}

function estimateSeconds(): number {
  const rs = store.reviews.slice(-200).map((r) => r.durationMs).filter((d) => d > 500 && d < 120000);
  if (rs.length < 10) return 9;
  rs.sort((a, b) => a - b);
  return Math.round(rs[Math.floor(rs.length / 2)] / 1000);
}

function CardInfo({ card, onClose, onSaved }: { card: Card; onClose: () => void; onSaved: () => void }) {
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
            <p className="small muted">Due {card.state === "new" ? "never studied" : new Date(card.due).toLocaleString()}<br />Source: {card.source}<br />Type: {nt.name}{note.tags.length ? <><br />Tags: {note.tags.join(", ")}</> : null}</p>
            {history.length > 0 && (<><h2 style={{ marginTop: 6 }}>History</h2>
              {history.map((h) => <div key={h.id} className="list-row"><span className="t">{new Date(h.ts).toLocaleDateString()} <span className="muted">{new Date(h.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></span><span className={"chip " + (h.rating === 1 ? "" : "orange")}>{labels[h.rating]}</span><span className="small muted">{h.scheduledDays ? h.scheduledDays + "d" : ""}</span></div>)}
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

export function Study({ path, view = "decks", onExit }: { path: string; view?: View; onExit: () => void }) {
  const fullQueue = useMemo(() => store.queue(path, Date.now(), view), [path, view]);
  const [plan, setPlan] = useState<number | null>(fullQueue.length > 15 ? null : fullQueue.length);
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
  const total = queue.length;
  const card = queue[idx];
  const dark = store.settings.nightCards;
  const secs = useMemo(estimateSeconds, []);

  useEffect(() => {
    if (plan !== null && idx >= queue.length) {
      const more = store.queue(path, Date.now(), view).filter((c) => !queue.some((q) => q.id === c.id));
      if (more.length) { setQueue(more); setIdx(0); }
    }
  }, [idx, queue, path, view, plan]);

  useEffect(() => { shownAt.current = Date.now(); setShowAnswer(false); setInfo(false); }, [card?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!card || info) return;
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); if (!showAnswer) setShowAnswer(true); else answer(3); }
      if (showAnswer && ["1", "2", "3", "4"].includes(e.key)) answer(Number(e.key) as Rating);
      if (e.key === "i") setInfo(true);
      if (e.key === "z" && (e.ctrlKey || e.metaKey)) undo();
      if (e.key === "Escape") onExit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const note = card && store.noteFor(card);
  const nt = note && store.notetypeFor(note);
  const rendered = useMemo(() => (card && note && nt ? renderCard({ note, notetype: nt, ord: card.ord, deck: card.source, resolveMedia: () => null }) : null), [card?.id, rev]);
  const intervals = useMemo(() => (card ? previewIntervals(card, Date.now(), store.settings.scheduler) : null), [card?.id, rev]);

  async function answer(g: Rating) {
    if (!card) return;
    await store.answer(card.id, g, Date.now() - shownAt.current);
    setDoneCount((d) => d + 1);
    setIdx((i) => i + 1);
    if (navigator.vibrate) navigator.vibrate(g === 1 ? [30, 40, 30] : 12);
  }
  async function undo() {
    if (await store.undoLast()) { setQueue(store.queue(path, Date.now(), view).slice(0, Math.max(1, (plan ?? 0) - doneCount + 1))); setIdx(0); setDoneCount((d) => Math.max(0, d - 1)); flash("Undone"); }
    else flash("Nothing to undo");
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
              {options.map((n) => <button key={n} className={"btn block" + (n === fullQueue.length ? " primary" : "")} onClick={() => { setPlan(n); setQueue(fullQueue.slice(0, n)); }}>{n === fullQueue.length ? `All ${n} cards` : `${n} cards`} <span className="muted small">· {mins(n)} min</span></button>)}
              {[10, 25].map((m) => <button key={m} className="btn block" onClick={() => { const n = byMin(m); setPlan(n); setQueue(fullQueue.slice(0, n)); }}>{m} minutes <span className="muted small">· {byMin(m)} cards</span></button>)}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!card) {
    const ahead = store.learningAhead(path, Date.now(), view);
    const left = store.queue(path, Date.now(), view).length;
    return (
      <div className="study">
        <div className="study-top"><button className="icon-btn" onClick={onExit} aria-label="Close"><IconClose /></button><div className="grow" /></div>
        <div className="study-body">
          <div className="done">
            <div className="big">{doneCount}</div>
            <div>cards reviewed in this session</div>
            {left > 0 && <p className="muted small">{left} more ready. <button className="btn" style={{ marginLeft: 6 }} onClick={() => { setQueue(store.queue(path, Date.now(), view)); setIdx(0); setPlan(left); }}>Keep going</button></p>}
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
        <span className="small muted" style={{ minWidth: 56, textAlign: "right" }}>{idx}/{total}</span>
        <button className="icon-btn" onClick={undo} aria-label="Undo"><IconUndo /></button>
        <button className="icon-btn" onClick={() => setInfo(true)} aria-label="Card info"><IconInfo /></button>
        <button className={"icon-btn" + (card.flag ? " on" : "")} onClick={() => store.setFlag(card.id, card.flag ? 0 : 1)} aria-label="Flag"><IconFlag /></button>
        <button className="icon-btn" onClick={async () => { await store.setSuspended(card.id, true); flash("Suspended"); setIdx((i) => i + 1); }} aria-label="Suspend"><IconPause /></button>
      </div>
      <div className="row small muted" style={{ padding: "0 14px 6px" }}>
        <span className="chip">{card.state}</span>
        <span className="grow" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{card.source.split("::").slice(-2).join(" › ")}</span>
      </div>
      <div className="study-body" onClick={() => !showAnswer && setShowAnswer(true)} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
        style={{ transform: drag ? `translateX(${drag * 0.4}px)` : undefined, transition: drag ? "none" : "transform .15s" }}>
        {drag < -40 && <div className="swipe-hint again">Again</div>}
        {drag > 40 && <div className="swipe-hint good">Good</div>}
        {rendered && <CardView html={showAnswer ? rendered.back : rendered.front} css={rendered.css} dark={dark} />}
      </div>
      {!showAnswer ? (
        <div className="show-bar"><button className="btn primary block" onClick={() => setShowAnswer(true)}>Show answer</button></div>
      ) : (
        <div className="answer-bar">
          <button className="again" onClick={() => answer(1)}>Again<small>{intervals?.[1]}</small></button>
          <button className="hard" onClick={() => answer(2)}>Hard<small>{intervals?.[2]}</small></button>
          <button className="good" onClick={() => answer(3)}>Good<small>{intervals?.[3]}</small></button>
          <button className="easy" onClick={() => answer(4)}>Easy<small>{intervals?.[4]}</small></button>
        </div>
      )}
      {info && <CardInfo card={card} onClose={() => setInfo(false)} onSaved={() => { setRev((r) => r + 1); flash("Saved"); }} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
