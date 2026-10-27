import { store, type View } from "../lib/store";
import { YuzuMark, IconPlay } from "./icons";
import { DAY } from "../scheduler/fsrs";
import { systemColor } from "./theme";
import { useMemo, useState } from "react";

/** A yuzu cut in half, drawn on a 30×30 pixel grid: 8 segments fill (yellow; orange while partly done) toward the daily goal. */
export function YuzuGoal({ value, max, size = 150, center, sub }: { value: number; max: number; size?: number; center?: string | number; sub?: string }) {
  const frac = Math.min(1, max ? value / max : 0);
  const cells = useMemo(() => {
    const N = 30, c = 15, segs = 8, filled = frac * segs, out: [number, number, string][] = [];
    const hole = center !== undefined ? 7.2 : 2.6;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const dx = x + 0.5 - c, dy = y + 0.5 - c, r = Math.hypot(dx, dy);
      if (r > 14.6) continue;
      let col: string;
      if (r > 13.6) col = "#3a2a07";                        // outline
      else if (r > 12.4) col = r > 13.1 ? "#c9971c" : "#f2d34b"; // rind
      else if (r > 11.4) col = "#fff3c2";                    // pith ring
      else if (r < hole) col = r > hole - 1 ? "#fff3c2" : "#1a1508"; // centre (dark hole for the number)
      else {
        let a = Math.atan2(dx, -dy); if (a < 0) a += Math.PI * 2; // 0 at the top, clockwise
        const seg = Math.floor(a / (Math.PI * 2 / segs));
        const edge = Math.min(a % (Math.PI * 2 / segs), Math.PI * 2 / segs - (a % (Math.PI * 2 / segs))) * r;
        if (edge < 0.55) col = "#fff3c2";                    // membrane between segments
        else { const f = Math.max(0, Math.min(1, filled - seg)); col = f >= 1 ? "#f2d34b" : f > 0 ? "#ff7a1a" : "#3b3220"; if (f >= 1 && (x + y) % 7 === 0) col = "#e0b52f"; }
      }
      out.push([x, y, col]);
    }
    return out;
  }, [frac, center !== undefined]);
  const label = String(center ?? `${Math.round(frac * 100)}%`);
  const fs = label.length > 4 ? 2.4 : 4; // in grid units; 4 units = 20 px at 150 px size, so each font pixel is 2×2 screen pixels
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" className="ring" shapeRendering="crispEdges" aria-label={`${value} of ${max} reviews today`}>
      {cells.map(([x, y, c], i) => <rect key={i} x={x} y={y} width={1} height={1} fill={c} />)}
      <text x={15} y={sub ? 15.6 : 17} textAnchor="middle" fontSize={fs} fill="var(--text)" style={{ fontFamily: "var(--px)" }}>{label}</text>
      {sub && <text x={15} y={19.4} textAnchor="middle" fontSize={2} fill="#a99e86" style={{ fontFamily: "var(--px)" }}>{sub}</text>}
    </svg>
  );
}

type OnStudy = (path: string, view?: View, extra?: { only?: "all" | "due" | "new"; preset?: import("../lib/model").Card[]; title?: string }) => void;
export function Today({ onStudy, onInbox, onSearch, onBoss }: { onStudy: OnStudy; onInbox?: () => void; onSearch?: (q: string) => void; onBoss?: (path: string, view: View, name: string) => void }) {
  const v = store.getVersion();
  const d = useMemo(() => derive(), [v]);
  return <TodayView {...d} onStudy={onStudy} onInbox={onInbox} onSearch={onSearch} onBoss={onBoss} />;
}

function derive() {
  const pins = store.settings.pins.map((p) => {
    const cards = store.cardsIn(p.path, p.view); const now = Date.now();
    const name = p.view === "smart" ? (store.settings.smart.find((s) => s.id === p.path)?.name ?? "Smart deck") : (p.path.split("::").pop() || "All");
    return { ...p, name, due: cards.filter((c) => !c.suspended && c.state !== "new" && c.due <= now).length, fresh: cards.filter((c) => !c.suspended && c.state === "new").length };
  });
  const tree = store.tree();
  const stats = store.stats();
  const queue = store.queue("");
  const counts = store.stateCounts();
  const now = Date.now();
  const forecast = [0, 1, 2, 3, 4, 5, 6].map((d) => {
    const start = store.dayStart(now) + d * DAY, end = start + DAY;
    let n = 0; for (const c of store.cards.values()) if (!c.suspended && c.state === "review" && c.due >= (d === 0 ? 0 : start) && c.due < end) n++;
    return n;
  });
  const maxF = Math.max(1, ...forecast);
  const top = tree.children.filter((c) => c.due + c.newCount + c.learning > 0).sort((a, b) => b.due - a.due).slice(0, 6);
  const missed = store.missedToday(now); const weakest = store.weakestSystem(now);
  // A boss fight worth offering: a system with 10+ well-learned cards that has not been beaten in the last 14 days.
  const mastery = store.masteryBySystem(now);
  const bossReady = [...mastery].filter(([name, m]) => m.mastered + m.durable >= 10 && (now - (store.settings.bosses[`systems:${name}`]?.at ?? 0)) > 14 * DAY).sort((a, b) => (b[1].mastered + b[1].durable) - (a[1].mastered + a[1].durable)).slice(0, 1).map(([name, m]) => ({ name, ready: m.mastered + m.durable }))[0] ?? null;
  return { pins, tree, stats, queue, counts, now, forecast, maxF, top, missed, weakest, bossReady };
}

function TodayView({ pins, tree, stats, queue, counts, now, forecast, maxF, top, missed, weakest, bossReady, onStudy, onInbox, onSearch, onBoss }: ReturnType<typeof derive> & { onStudy: OnStudy; onInbox?: () => void; onSearch?: (q: string) => void; onBoss?: (path: string, view: View, name: string) => void }) {
  const [q, setQ] = useState("");
  const goalDone = stats.today >= stats.goal && stats.goal > 0;
  return (
    <div className="screen">
      <div className="brand"><YuzuMark size={32} /><h1>Yuzu</h1><div className="grow" />
        {store.syncConfigured() && <span className={"chip" + (store.syncStatus.state === "error" ? "" : " yuzu")} title={store.syncStatus.message} onClick={() => store.sync()}>{store.syncStatus.state === "syncing" ? "syncing…" : store.syncStatus.state === "error" ? "sync failed" : store.hasUnsynced() ? "unsynced" : "synced"}</span>}
      </div>
      {store.inbox.length > 0 && onInbox && <button className="card-box row" style={{ width: "100%", textAlign: "left", marginBottom: 10, borderColor: "var(--yuzu)" }} onClick={onInbox}><span className="grow"><b>{store.inbox.length} new pack{store.inbox.length === 1 ? "" : "s"} from Claude</b><div className="small muted">Review the cards before they join your collection</div></span><span className="chip yuzu">Review</span></button>}
      {store.cards.size === 0 ? (
        <div className="card-box"><div style={{ fontWeight: 700, marginBottom: 6 }}>Nothing to study yet</div><div className="muted small">Go to Settings and import your Anki collection. Review history comes with it, so nothing starts over.</div></div>
      ) : (
        <>
          <div className={"hero" + (goalDone ? " goal-done" : "")}>
            <YuzuGoal value={stats.today} max={stats.goal} size={150} center={queue.length} sub="ready" />
            <div>
              <div className="lead"><b>{queue.length.toLocaleString()} cards</b> ready: {tree.due.toLocaleString()} due, {tree.learning} learning and {Math.min(tree.newCount, Math.max(0, store.settings.newPerDay - store.reviewedToday().newCards))} new for today.</div>
              <div className="lead" style={{ marginTop: 6 }}>Goal <b>{stats.today} / {stats.goal}</b>{stats.today >= stats.goal ? ", done for today" : ""}.</div>
              <button className="btn primary" style={{ marginTop: 14 }} onClick={() => onStudy("")} disabled={queue.length === 0}><IconPlay /> Study</button>
            </div>
          </div>
          <div className="stat-grid">
            <div className="stat"><b>{stats.streak}</b><span>day streak</span></div>
            <div className="stat"><b>{stats.today}</b><span>reviews today</span></div>
            <div className="stat"><b>{counts.review.toLocaleString()}</b><span>cards learned</span></div>
          </div>
          {onSearch && <form className="field" style={{ margin: "12px 0 0" }} onSubmit={(e) => { e.preventDefault(); if (q.trim()) onSearch(q.trim()); }}><input placeholder="Search all cards and tags" value={q} onChange={(e) => setQ(e.target.value)} /></form>}
          {(missed.length >= 3 || weakest || bossReady) && (
            <>
              <h2>Worth a few minutes</h2>
              {bossReady && onBoss && (
                <button className="stack" style={{ "--spine": "var(--yuzu)" } as any} onClick={() => onBoss(bossReady.name, "systems", bossReady.name)}>
                  <span className="name">Boss fight: {bossReady.name}<div className="meta">{bossReady.ready} well-learned cards — 20 at random, no hints, 85% to pass</div></span><span className="muted"><IconPlay /></span>
                </button>
              )}
              {missed.length >= 3 && (
                <button className="stack" style={{ "--spine": "var(--clay)" } as any} onClick={() => onStudy("", "decks", { preset: missed, title: "Missed today" })}>
                  <span className="name">Redo today's misses<div className="meta">{missed.length} cards you got wrong today, once more while they're fresh</div></span><span className="muted"><IconPlay /></span>
                </button>
              )}
              {weakest && (
                <button className="stack" style={{ "--spine": systemColor(weakest.name) } as any} onClick={() => onStudy(weakest.name, "systems")}>
                  <span className="name">{weakest.name} is slipping<div className="meta">{Math.round(weakest.retention * 100)}% recalled this week over {weakest.n} reviews — a focused session helps</div></span><span className="muted"><IconPlay /></span>
                </button>
              )}
            </>
          )}
          <h2>Next 7 days</h2>
          <div className="card-box forecast" style={{ height: 108 }}>
            {forecast.map((n, i) => (
              <div key={i} className={i === 0 ? "today" : ""}>
                <span className="small muted num">{n.toLocaleString()}</span>
                <i style={{ height: Math.max(3, (n / maxF) * 44) }} />
                <span className="small muted">{i === 0 ? "today" : new Date(now + i * DAY).toLocaleDateString(undefined, { weekday: "short" })}</span>
              </div>
            ))}
          </div>
          {pins.length > 0 && (<><h2>Pinned</h2>
            {pins.map((p) => (
              <button key={p.view + p.path} className="stack" style={{ "--spine": p.view === "systems" ? systemColor(p.name) : "var(--orange)" } as any} onClick={() => onStudy(p.path, p.view)}>
                <span className="name">{p.name}<div className="meta">{p.due.toLocaleString()} due · {p.fresh.toLocaleString()} new</div></span>
                <span className="muted"><IconPlay /></span>
              </button>
            ))}</>)}
          {top.length > 0 && (<><h2>By category</h2>
            {top.map((c) => (
              <button key={c.path} className="stack" style={{ "--spine": "var(--yuzu)" } as any} onClick={() => onStudy(c.path)}>
                <span className="name">{c.name}<div className="meta">{c.due.toLocaleString()} due · {c.learning} learning · {c.newCount.toLocaleString()} new</div></span>
                <span className="muted"><IconPlay /></span>
              </button>
            ))}</>)}
        </>
      )}
    </div>
  );
}
