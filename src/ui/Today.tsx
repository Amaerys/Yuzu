import { store } from "../lib/store";
import { YuzuMark, IconPlay, IconFlame } from "./icons";
import { DAY } from "../scheduler/fsrs";

function Ring({ value, max, label }: { value: number; max: number; label: string }) {
  const r = 40, c = 2 * Math.PI * r;
  const frac = Math.min(1, max ? value / max : 0);
  return (
    <svg className="ring" viewBox="0 0 96 96">
      <circle cx="48" cy="48" r={r} fill="none" stroke="var(--bg-3)" strokeWidth="9" />
      <circle cx="48" cy="48" r={r} fill="none" stroke={frac >= 1 ? "var(--yuzu)" : "var(--orange)"} strokeWidth="9" strokeLinecap="round" strokeDasharray={`${c * frac} ${c}`} transform="rotate(-90 48 48)" />
      <text x="48" y="45" textAnchor="middle" fontSize="20" fontWeight="700" fill="var(--text)">{value}</text>
      <text x="48" y="62" textAnchor="middle" fontSize="10" fill="var(--muted)">{label}</text>
    </svg>
  );
}

export function Today({ onStudy }: { onStudy: (path: string) => void }) {
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
            <Ring value={stats.today} max={stats.goal} label={`of ${stats.goal} goal`} />
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
