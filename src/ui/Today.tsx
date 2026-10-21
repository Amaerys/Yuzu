import { store, type View } from "../lib/store";
import { YuzuMark, IconPlay, IconFlame } from "./icons";
import { DAY } from "../scheduler/fsrs";

/** A yuzu cut in half: 8 segments fill as the daily goal is reached. */
export function YuzuGoal({ value, max, size = 104 }: { value: number; max: number; size?: number }) {
  const segs = 8, cx = 52, cy = 52, R = 44, r0 = 10, gap = 0.06;
  const frac = Math.min(1, max ? value / max : 0);
  const filled = frac * segs;
  const wedge = (i: number) => {
    const a0 = (i / segs) * Math.PI * 2 - Math.PI / 2 + gap, a1 = ((i + 1) / segs) * Math.PI * 2 - Math.PI / 2 - gap;
    const p = (a: number, r: number) => `${cx + r * Math.cos(a)} ${cy + r * Math.sin(a)}`;
    return `M ${p(a0, r0)} L ${p(a0, R)} A ${R} ${R} 0 0 1 ${p(a1, R)} L ${p(a1, r0)} A ${r0} ${r0} 0 0 0 ${p(a0, r0)} Z`;
  };
  return (
    <svg width={size} height={size} viewBox="0 0 104 104" className="ring" aria-label={`${value} of ${max}`}>
      <circle cx={cx} cy={cy} r={50} fill="#2a2415" stroke="#d9b93a" strokeWidth="3" />
      {Array.from({ length: segs }, (_, i) => {
        const f = Math.max(0, Math.min(1, filled - i));
        return <path key={i} d={wedge(i)} fill={f >= 1 ? "var(--yuzu)" : f > 0 ? "var(--orange)" : "#3a3320"} opacity={f > 0 && f < 1 ? 0.5 + f * 0.5 : 1} />;
      })}
      <circle cx={cx} cy={cy} r={r0 - 2} fill="#1a160a" />
      <text x={cx} y={cy + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--text)">{Math.round(frac * 100)}%</text>
    </svg>
  );
}

export function Today({ onStudy }: { onStudy: (path: string, view?: View) => void }) {
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

  return (
    <div className="screen">
      <div className="row" style={{ marginBottom: 6 }}><YuzuMark /><h1 style={{ margin: 0 }}>Yuzu</h1><div className="grow" />
        {store.syncConfigured() && <span className={"chip" + (store.syncStatus.state === "error" ? "" : " yuzu")} title={store.syncStatus.message} onClick={() => store.sync()}>{store.syncStatus.state === "syncing" ? "syncing" : store.syncStatus.state === "error" ? "sync failed" : "synced"}</span>}
        <span className="chip orange"><IconFlame /> {stats.streak} day{stats.streak === 1 ? "" : "s"}</span>
      </div>
      {store.cards.size === 0 ? (
        <div className="card-box"><div style={{ fontWeight: 700, marginBottom: 6 }}>Nothing to study yet</div><div className="muted small">Go to Settings and import your Anki collection. Review history comes with it, so nothing starts over.</div></div>
      ) : (
        <>
          <div className="card-box hero">
            <div>
              <div className="big">{queue.length}</div>
              <div className="muted">cards ready now</div>
              <div className="row small" style={{ marginTop: 8, gap: 12 }}>
                <span className="c-due">{tree.due} due</span><span className="c-learn">{tree.learning} learning</span><span className="c-new">{Math.min(tree.newCount, Math.max(0, store.settings.newPerDay - store.reviewedToday().newCards))} new</span>
              </div>
              <button className="btn primary" style={{ marginTop: 14 }} onClick={() => onStudy("")} disabled={queue.length === 0}><IconPlay /> Study everything</button>
            </div>
            <div style={{ textAlign: "center" }}><YuzuGoal value={stats.today} max={stats.goal} /><div className="small muted">{stats.today} / {stats.goal}</div></div>
          </div>
          <div className="stat-grid">
            <div className="stat"><b>Lv {stats.level}</b><span>{stats.xp - stats.levelFloor} / {stats.levelCeil - stats.levelFloor} XP</span></div>
            <div className="stat"><b>+{stats.todayXp}</b><span>XP today</span></div>
            <div className="stat"><b>{counts.review.toLocaleString()}</b><span>cards learned</span></div>
          </div>
          <h2>Next 7 days</h2>
          <div className="card-box" style={{ display: "flex", gap: 6, alignItems: "flex-end", height: 90 }}>
            {forecast.map((n, i) => (
              <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <span className="small muted">{n}</span>
                <div style={{ width: "100%", height: Math.max(3, (n / maxF) * 48), background: i === 0 ? "var(--orange)" : "var(--bg-3)", borderRadius: 4 }} />
                <span className="small muted">{i === 0 ? "today" : new Date(now + i * DAY).toLocaleDateString(undefined, { weekday: "short" })}</span>
              </div>
            ))}
          </div>
          {pins.length > 0 && (<><h2>Pinned</h2>
            {pins.map((p) => (
              <button key={p.view + p.path} className="tree-row" style={{ width: "100%", textAlign: "left" }} onClick={() => onStudy(p.path, p.view)}>
                <span className="name">{p.name} <span className="small muted">{p.view}</span></span>
                <span className="counts"><span className="c-due">{p.due}</span><span className="c-new">{p.fresh}</span></span>
                <span className="muted"><IconPlay /></span>
              </button>
            ))}</>)}
          {top.length > 0 && (<><h2>By category</h2>
            {top.map((c) => (
              <button key={c.path} className="tree-row" style={{ width: "100%", textAlign: "left" }} onClick={() => onStudy(c.path)}>
                <span className="name">{c.name}</span>
                <span className="counts"><span className="c-due">{c.due}</span><span className="c-learn">{c.learning}</span><span className="c-new">{c.newCount}</span></span>
                <span className="muted"><IconPlay /></span>
              </button>
            ))}</>)}
        </>
      )}
    </div>
  );
}
