import { useEffect, useMemo, useRef, useState } from "react";
import { store, type View } from "../lib/store";
import type { Card, Rating } from "../lib/model";
import { renderCard } from "../lib/render";
import { previewIntervals } from "../scheduler/fsrs";
import { IconClose, IconUndo, IconFlag, IconPause } from "./icons";

const BASE_CSS = `
:host { display:block; }
.card { font-size: 20px; line-height: 1.45; }
img { max-width: 100%; height: auto; border-radius: 8px; }
hr#answer { border: 0; border-top: 1px solid #ddd; margin: 14px 0; }
.cloze { color: #ff7a1a; font-weight: 700; }
.cloze-inactive { color: inherit; }
.hint { color: #888; font-style: italic; }
.missing-media { opacity: .9; }
.missing-audio { color: #999; }
.typeans { width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 8px; font-size: 18px; }
`;

function CardView({ html, css, dark }: { html: string; css: string; dark: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current!;
    const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${BASE_CSS}${dark ? ".card{color:#f2f2f0}" : ""}</style><style>${css}</style><div class="card">${html}</div>`;
    host.scrollTop = 0;
  }, [html, css, dark]);
  return <div ref={ref} className={"card-host" + (dark ? " dark" : "")} />;
}

export function Study({ path, view = "decks", onExit }: { path: string; view?: View; onExit: () => void }) {
  const [queue, setQueue] = useState<Card[]>(() => store.queue(path, Date.now(), view));
  const [idx, setIdx] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [doneCount, setDoneCount] = useState(0);
  const [toast, setToast] = useState("");
  const shownAt = useRef(Date.now());
  const total = queue.length + doneCount;
  const card = queue[idx];
  const dark = false;

  // Refill with learning cards that came due while studying.
  useEffect(() => {
    if (idx >= queue.length) {
      const more = store.queue(path, Date.now(), view).filter((c) => !queue.some((q) => q.id === c.id));
      if (more.length) { setQueue(more); setIdx(0); }
    }
  }, [idx, queue, path]);

  useEffect(() => { shownAt.current = Date.now(); setShowAnswer(false); }, [card?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!card) return;
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); if (!showAnswer) setShowAnswer(true); else answer(3); }
      if (showAnswer && ["1", "2", "3", "4"].includes(e.key)) answer(Number(e.key) as Rating);
      if (e.key === "Escape") onExit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const note = card && store.noteFor(card);
  const nt = note && store.notetypeFor(note);
  const rendered = useMemo(() => (card && note && nt ? renderCard({ note, notetype: nt, ord: card.ord, deck: card.source, resolveMedia: () => null }) : null), [card?.id, showAnswer]);
  const intervals = useMemo(() => (card ? previewIntervals(card, Date.now(), store.settings.scheduler) : null), [card?.id]);

  async function answer(g: Rating) {
    if (!card) return;
    await store.answer(card.id, g, Date.now() - shownAt.current);
    setDoneCount((d) => d + 1);
    setIdx((i) => i + 1);
    if (navigator.vibrate) navigator.vibrate(g === 1 ? [30, 40, 30] : 12);
  }
  async function undo() {
    if (await store.undoLast()) {
      setQueue(store.queue(path, Date.now(), view)); setIdx(0); setDoneCount((d) => Math.max(0, d - 1)); flash("Undone");
    } else flash("Nothing to undo");
  }
  function flash(msg: string) { setToast(msg); setTimeout(() => setToast(""), 1400); }

  if (!card) {
    const ahead = store.learningAhead(path, Date.now(), view);
    return (
      <div className="study">
        <div className="study-top"><button className="icon-btn" onClick={onExit} aria-label="Close"><IconClose /></button><div className="grow" /></div>
        <div className="study-body">
          <div className="done">
            <div className="big">{doneCount}</div>
            <div>cards reviewed in this session</div>
            {ahead.length > 0 && <p className="muted small">{ahead.length} learning card{ahead.length > 1 ? "s" : ""} will come back later today.</p>}
            <p className="muted small">New cards per day: {store.settings.newPerDay}. Change it in Settings if you want more.</p>
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
        <div className="progress"><i style={{ width: `${total ? (doneCount / total) * 100 : 0}%` }} /></div>
        <span className="small muted" style={{ minWidth: 60, textAlign: "right" }}>{doneCount}/{total}</span>
        <button className="icon-btn" onClick={undo} aria-label="Undo"><IconUndo /></button>
        <button className={"icon-btn" + (card.flag ? " on" : "")} onClick={() => store.setFlag(card.id, card.flag ? 0 : 1)} aria-label="Flag"><IconFlag /></button>
        <button className="icon-btn" onClick={async () => { await store.setSuspended(card.id, true); flash("Suspended"); setIdx((i) => i + 1); }} aria-label="Suspend"><IconPause /></button>
      </div>
      <div className="row small muted" style={{ padding: "0 14px 6px" }}>
        <span className="chip">{card.state}</span>
        <span className="grow" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{card.source.split("::").slice(-2).join(" › ")}</span>
      </div>
      <div className="study-body" onClick={() => !showAnswer && setShowAnswer(true)}>
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
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
