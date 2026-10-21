// Boss fight: a short, mixed, no-hints quiz over well-learned cards of one area. Graded pass/fail;
// each answer is a real review, so it also schedules. Interleaving and cumulative testing in one feature.
import { useEffect, useMemo, useRef, useState } from "react";
import { store, type View } from "../lib/store";
import type { Card } from "../lib/model";
import { renderCard } from "../lib/render";
import { IconClose } from "./icons";
import { YuzuMark } from "./icons";

export const BOSS_SIZE = 20, BOSS_PASS = 0.85, BOSS_MIN_STABILITY = 7;

export function bossPool(path: string, view: View): Card[] {
  return store.cardsIn(path, view).filter((c) => !c.suspended && c.state === "review" && c.stability >= BOSS_MIN_STABILITY);
}

function CardView({ html, css, dark }: { html: string; css: string; dark: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = ref.current!; const root = h.shadowRoot ?? h.attachShadow({ mode: "open" });
    root.innerHTML = `<style>.card{font-size:19px;line-height:1.45;color:${dark ? "#f2f2f0" : "#111"}} img{max-width:100%} .cloze{color:#ff7a1a;font-weight:700} hr#answer{border:0;border-top:1px solid #8884;margin:12px 0}</style><style>${css}</style><div class="${dark ? "night_mode nightMode" : ""}"><div class="card ${dark ? "night_mode" : ""}">${html}</div></div>`;
  }, [html, css, dark]);
  return <div ref={ref} className={"card-host" + (dark ? " dark" : "")} />;
}

export function Boss({ path, view, name, onExit }: { path: string; view: View; name: string; onExit: () => void }) {
  const key = `${view}:${path}`;
  const cards = useMemo(() => { const pool = bossPool(path, view); for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; } return pool.slice(0, BOSS_SIZE); }, []);
  const [idx, setIdx] = useState(0);
  const [show, setShow] = useState(false);
  const [hits, setHits] = useState(0);
  const shownAt = useRef(Date.now());
  const card = cards[idx];
  const note = card && store.noteFor(card); const nt = note && store.notetypeFor(note);
  const rendered = useMemo(() => (card && note && nt ? renderCard({ note, notetype: nt, ord: card.ord, deck: card.source, resolveMedia: store.mediaUrl }) : null), [card?.id]);
  useEffect(() => { shownAt.current = Date.now(); setShow(false); }, [card?.id]);
  const done = idx >= cards.length;
  const score = cards.length ? hits / cards.length : 0;
  useEffect(() => { if (done && cards.length) store.recordBoss(key, score, score >= BOSS_PASS); }, [done]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (done) return; if (e.key === " " || e.key === "Enter") { e.preventDefault(); if (!show) setShow(true); } if (show && e.key === "1") grade(false); if (show && (e.key === "3" || e.key === "2" || e.key === "4")) grade(true); if (e.key === "Escape") onExit(); };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  });
  async function grade(ok: boolean) {
    if (!card) return;
    await store.answer(card.id, ok ? 3 : 1, Date.now() - shownAt.current);
    if (ok) setHits((h) => h + 1);
    setIdx((i) => i + 1);
  }
  if (cards.length < 10) {
    return (
      <div className="study"><div className="study-top"><button className="icon-btn" onClick={onExit} aria-label="Close"><IconClose /></button><div className="grow" /></div>
        <div className="study-body"><div className="done"><YuzuMark size={48} /><div style={{ marginTop: 12 }}>Not ready for a boss fight yet</div><p className="muted small">A boss fight needs at least 10 well-learned cards in {name} (stability a week or more). You have {cards.length}.</p><button className="btn primary" onClick={onExit}>Back</button></div></div></div>
    );
  }
  if (done) {
    const passed = score >= BOSS_PASS;
    return (
      <div className="study"><div className="study-top"><button className="icon-btn" onClick={onExit} aria-label="Close"><IconClose /></button><div className="grow" /></div>
        <div className="study-body"><div className="done">
          <YuzuMark size={56} />
          <div className="boss-score">{Math.round(score * 100)}%</div>
          <div style={{ fontWeight: 700, fontSize: 20 }}>{passed ? `${name} boss defeated` : "Not this time"}</div>
          <p className="muted small">{hits} of {cards.length} recalled without hints. {passed ? "This counts toward the system level." : `You need ${Math.round(BOSS_PASS * 100)}%. The misses are scheduled sooner; try again in a few days.`}</p>
          <button className="btn primary" onClick={onExit}>Done</button>
        </div></div></div>
    );
  }
  return (
    <div className="study">
      <div className="study-top">
        <button className="icon-btn" onClick={onExit} aria-label="Close"><IconClose /></button>
        <div className="progress"><i style={{ width: `${(idx / cards.length) * 100}%`, background: "var(--yuzu)" }} /></div>
        <span className="small muted" style={{ minWidth: 56, textAlign: "right" }}>{idx}/{cards.length}</span>
      </div>
      <div className="row small muted" style={{ padding: "0 14px 6px" }}><span className="chip yuzu">boss fight · {name}</span><span className="grow" /><span>{hits} right</span></div>
      <div className="study-body" onClick={() => !show && setShow(true)}>
        {rendered && <CardView html={show ? rendered.back : rendered.front} css={rendered.css} dark={store.settings.nightCards} />}
      </div>
      {!show ? <div className="show-bar"><button className="btn primary block" onClick={() => setShow(true)}>Show answer</button></div>
        : <div className="answer-bar"><button className="again" onClick={() => grade(false)}>Missed</button><button className="good" onClick={() => grade(true)}>Got it</button></div>}
    </div>
  );
}
