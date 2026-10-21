import { useMemo, useState } from "react";
import { store, type TreeNode } from "../lib/store";
import { noteTitle } from "../lib/render";
import { IconChevron, IconPlay } from "./icons";

function findNode(root: TreeNode, path: string): TreeNode | null {
  if (!path) return root;
  const parts = path.split("::");
  let n: TreeNode | null = root;
  for (const p of parts) { n = n?.children.find((c) => c.name === p) ?? null; if (!n) return null; }
  return n;
}

export function Library({ onStudy }: { onStudy: (path: string) => void }) {
  const [path, setPath] = useState("");
  const [showCards, setShowCards] = useState(false);
  const [query, setQuery] = useState("");
  const tree = store.tree();
  const node = findNode(tree, path) ?? tree;
  const crumbs = path ? path.split("::") : [];

  const list = useMemo(() => {
    if (!showCards && !query) return [];
    const cards = store.cardsIn(path);
    const q = query.trim().toLowerCase();
    const seen = new Set<string>();
    const out: { id: string; title: string; state: string; nt: string }[] = [];
    for (const c of cards) {
      if (seen.has(c.nid)) continue;
      const n = store.noteFor(c); if (!n) continue;
      const nt = store.notetypeFor(n);
      const title = noteTitle(n, nt);
      if (q && !title.toLowerCase().includes(q) && !n.tags.some((t) => t.toLowerCase().includes(q))) continue;
      seen.add(c.nid);
      out.push({ id: c.id, title, state: c.suspended ? "suspended" : c.state, nt: nt?.name ?? "" });
      if (out.length >= 300) break;
    }
    return out;
  }, [path, showCards, query, store.getVersion()]);

  if (store.cards.size === 0) {
    return (<div className="screen"><h1>Library</h1><div className="empty">No cards yet. Import your Anki collection from Settings.</div></div>);
  }

  return (
    <div className="screen">
      <h1>Library</h1>
      <div className="crumbs">
        <button onClick={() => { setPath(""); setShowCards(false); }}>All</button>
        {crumbs.map((c, i) => (
          <span key={i} className="row" style={{ gap: 4 }}><span className="muted">›</span><button onClick={() => { setPath(crumbs.slice(0, i + 1).join("::")); setShowCards(false); }}>{c}</button></span>
        ))}
      </div>
      <div className="card-box">
        <div className="row">
          <div className="grow">
            <div style={{ fontWeight: 700, fontSize: 18 }}>{node.name}</div>
            <div className="small muted">{node.total.toLocaleString()} cards · {node.suspended.toLocaleString()} suspended · {node.reviewed.toLocaleString()} studied</div>
          </div>
          <button className="btn primary" onClick={() => onStudy(path)} disabled={node.due + node.newCount + node.learning === 0}><IconPlay /> Study</button>
        </div>
        <div className="row small" style={{ marginTop: 10, gap: 14 }}>
          <span className="c-due">{node.due} due</span><span className="c-learn">{node.learning} learning</span><span className="c-new">{node.newCount} new</span>
        </div>
      </div>
      <div className="field"><input placeholder="Search cards and tags in this category" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
      {!query && node.children.length > 0 && (
        <>
          <h2>Categories</h2>
          {node.children.map((c) => (
            <button key={c.path} className="tree-row" style={{ width: "100%", textAlign: "left" }} onClick={() => { setPath(c.path); setShowCards(false); }}>
              <span className="name">{c.name}</span>
              <span className="counts"><span className="c-due">{c.due}</span><span className="c-learn">{c.learning}</span><span className="c-new">{c.newCount}</span></span>
              <span className="muted"><IconChevron /></span>
            </button>
          ))}
        </>
      )}
      {!query && !showCards && <button className="btn ghost block" style={{ marginTop: 12 }} onClick={() => setShowCards(true)}>Show cards in {node.name}</button>}
      {(showCards || query) && (
        <>
          <h2>Cards {list.length >= 300 ? "(first 300)" : `(${list.length})`}</h2>
          {list.map((r) => (
            <div key={r.id} className="list-row"><span className="t">{r.title}</span><span className={"chip " + (r.state === "new" ? "" : "orange")}>{r.state}</span></div>
          ))}
        </>
      )}
    </div>
  );
}
