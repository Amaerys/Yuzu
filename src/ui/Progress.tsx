import { store } from "../lib/store";
import { DAY } from "../scheduler/fsrs";
import { YuzuMark } from "./icons";
import { useMemo } from "react";

const MASTERY: { key: "durable" | "mastered" | "developing" | "learning"; label: string; color: string }[] = [
  { key: "durable", label: "durable", color: "var(--yuzu)" }, { key: "mastered", label: "mastered", color: "var(--orange)" },
  { key: "developing", label: "developing", color: "var(--orange-2)" }, { key: "learning", label: "learning", color: "var(--again)" },
];

function Calibration() {
  const v = store.getVersion();
  const rows = useMemo(() => store.calibration(), [v]);
  if (!rows.length) return null;
  const W = 300, H = 120, pad = 24;
  const x = (p: number) => pad + p * (W - pad - 6), y = (p: number) => H - pad + 6 - p * (H - pad - 6);
  return (
    <div className="card-box">
      <div className="small muted" style={{ marginBottom: 6 }}>Predicted recall (horizontal) vs what actually happened (vertical). Dots on the line = the scheduler knows your memory.</div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: 420, display: "block" }}>
        <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} stroke="var(--line)" strokeDasharray="4 4" />
        <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(0)} stroke="var(--line)" /><line x1={x(0)} y1={y(0)} x2={x(0)} y2={y(1)} stroke="var(--line)" />
        {[0, 0.5, 1].map((t) => <text key={t} x={x(t)} y={H - 4} fontSize="9" fill="var(--muted)" textAnchor="middle">{t * 100}%</text>)}
        {[0.5, 1].map((t) => <text key={t} x={pad - 4} y={y(t) + 3} fontSize="9" fill="var(--muted)" textAnchor="end">{t * 100}%</text>)}
        {rows.map((r) => <circle key={r.bucket} cx={x(r.predicted)} cy={y(r.observed)} r={3 + Math.min(5, Math.log10(r.n + 1) * 2)} fill="var(--orange)" opacity={0.85}><title>{r.bucket}: predicted {(r.predicted * 100).toFixed(0)}%, observed {(r.observed * 100).toFixed(0)}% ({r.n} reviews)</title></circle>)}
      </svg>
      <div className="small muted">{store.settings.fit ? `Weights fitted ${new Date(store.settings.fit.at).toLocaleDateString()} on ${store.settings.fit.n.toLocaleString()} reviews.` : "Using default FSRS weights; fitting runs automatically once there is enough history (Settings → Studying)."}</div>
    </div>
  );
}

export function Progress({ onBoss }: { onBoss?: (path: string, view: "systems", name: string) => void }) {
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
  const systems = store.systemLevels();
  const mastery = store.masteryBySystem(now);
  const milestones = store.milestones();
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
      <h2>Is the scheduler calibrated?</h2>
      <Calibration />
      {systems.length > 0 && (<><h2>Systems</h2>
        <div className="row small muted" style={{ gap: 10, flexWrap: "wrap", marginBottom: 6 }}>{MASTERY.map((m) => <span key={m.key} className="row" style={{ gap: 4 }}><i style={{ width: 10, height: 10, borderRadius: 2, background: m.color, display: "inline-block" }} />{m.label}</span>)}<span>· mastery from memory stability, not from counts</span></div>
        {systems.map((s) => { const m = mastery.get(s.name); const seen = m ? m.total - m.unseen : 0; return (
          <div key={s.name} className="list-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
            <div className="row"><span className="chip yuzu">Lv {s.level}</span><span className="t">{s.name}</span>{store.settings.bosses[`systems:${s.name}`]?.passed && <span className="chip yuzu" title="Boss defeated">⚔</span>}{m?.secs != null && <span className="small muted">{m.secs.toFixed(0)} s/card</span>}<span className="small muted">{seen.toLocaleString()} / {s.total.toLocaleString()} seen</span>{onBoss && (m?.mastered ?? 0) + (m?.durable ?? 0) >= 10 && <button className="chip" onClick={() => onBoss(s.name, "systems", s.name)}>Boss</button>}</div>
            <div className="bar" style={{ margin: 0, height: 8, display: "flex", overflow: "hidden" }}>{m && MASTERY.map((k) => <i key={k.key} style={{ position: "static", width: `${(m[k.key] / Math.max(1, m.total)) * 100}%`, background: k.color, height: "100%" }} />)}</div>
            {m && seen > 0 && <div className="small muted">{MASTERY.filter((k) => m[k.key]).map((k) => `${m[k.key]} ${k.label}`).join(" · ")}</div>}
          </div>); })}</>)}
      <h2>Milestones</h2>
      <div className="milestones">
        {milestones.map((m) => (
          <div key={m.id} className={"milestone" + (m.earned ? " earned" : "")}><YuzuMark size={22} /><div><b>{m.title}</b><span className="small muted">{m.earned && m.at ? new Date(m.at).toLocaleDateString() : m.detail}</span></div></div>
        ))}
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
