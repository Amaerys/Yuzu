import { store } from "../lib/store";
import { DAY } from "../scheduler/fsrs";
import { YuzuMark } from "./icons";

export function Progress() {
  const stats = store.stats();
  const counts = store.stateCounts();
  const now = Date.now();
  const start = store.dayStart(now);
  // Last 12 weeks heatmap of reviews per day.
  const days = 84;
  const perDay = new Array(days).fill(0);
  for (const r of store.reviews) {
    const d = Math.floor((start + DAY - r.ts) / DAY); // 0 = today
    if (d >= 0 && d < days) perDay[days - 1 - d]++;
  }
  const maxD = Math.max(1, ...perDay);
  // Retention over last 30 days: share of non-Again ratings on review cards.
  let ok = 0, all = 0;
  for (const r of store.reviews) if (r.ts > now - 30 * DAY && r.state === "review") { all++; if (r.rating > 1) ok++; }
  const retention = all ? Math.round((ok / all) * 100) : null;
  const tree = store.tree();
  const cats = tree.children.map((c) => ({ name: c.name, total: c.total, learned: c.reviewed, pct: c.total ? Math.round((c.reviewed / c.total) * 100) : 0 })).sort((a, b) => b.learned - a.learned);

  return (
    <div className="screen">
      <h1>Progress</h1>
      <div className="card-box row">
        <YuzuMark size={48} />
        <div className="grow">
          <div style={{ fontWeight: 700, fontSize: 20 }}>Level {stats.level}</div>
          <div className="bar" style={{ margin: "6px 0" }}><i style={{ width: `${((stats.xp - stats.levelFloor) / (stats.levelCeil - stats.levelFloor)) * 100}%` }} /></div>
          <div className="small muted">{(stats.xp - stats.levelFloor).toLocaleString()} / {(stats.levelCeil - stats.levelFloor).toLocaleString()} XP to next level · {stats.xp.toLocaleString()} total</div>
        </div>
      </div>
      <div className="stat-grid">
        <div className="stat"><b>{stats.streak}</b><span>day streak</span></div>
        <div className="stat"><b>{retention === null ? "–" : retention + "%"}</b><span>retention, 30 days</span></div>
        <div className="stat"><b>{store.reviews.length.toLocaleString()}</b><span>reviews all time</span></div>
      </div>
      <h2>Last 12 weeks</h2>
      <div className="card-box" style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gridAutoFlow: "column", gridTemplateRows: "repeat(7, 1fr)", gap: 3 }}>
        {perDay.map((n, i) => (
          <div key={i} title={`${n} reviews`} style={{ aspectRatio: "1", borderRadius: 3, background: n === 0 ? "var(--bg-3)" : `rgba(255,122,26,${0.25 + 0.75 * (n / maxD)})` }} />
        ))}
      </div>
      <h2>Cards</h2>
      <div className="card-box">
        <div className="row small" style={{ gap: 14, flexWrap: "wrap" }}>
          <span className="c-new">{counts.new.toLocaleString()} new</span>
          <span className="c-learn">{(counts.learning + counts.relearning).toLocaleString()} learning</span>
          <span className="c-due">{counts.review.toLocaleString()} learned</span>
          <span className="muted">{counts.suspended.toLocaleString()} suspended</span>
        </div>
      </div>
      <h2>By category</h2>
      {cats.map((c) => (
        <div key={c.name} className="list-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
          <div className="row"><span className="t">{c.name}</span><span className="small muted">{c.learned.toLocaleString()} / {c.total.toLocaleString()}</span></div>
          <div className="bar" style={{ margin: 0, height: 6 }}><i style={{ width: `${c.pct}%`, background: "var(--orange)" }} /></div>
        </div>
      ))}
    </div>
  );
}
