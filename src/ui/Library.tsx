import { useMemo, useState } from "react";
import { store, VIEWS, type TreeNode, type View, type SmartDeck } from "../lib/store";
import { noteTitle, renderCard } from "../lib/render";
import { SYSTEM_NAMES } from "../lib/classify";
import type { Card, CardState } from "../lib/model";
import { IconChevron, IconPlay, IconClose, IconPin } from "./icons";
import { useEffect, useRef } from "react";

function findNode(root: TreeNode, path: string): TreeNode | null {
  if (!path) return root;
  const parts = path.split("::");
  let n: TreeNode | null = root;
  for (const p of parts) { n = n?.children.find((c) => c.name === p) ?? null; if (!n) return null; }
  return n;
}

function Preview({ card, onClose }: { card: Card; onClose: () => void }) {
  const note = store.noteFor(card)!; const nt = store.notetypeFor(note)!;
  const r = renderCard({ note, notetype: nt, ord: card.ord, deck: card.source, resolveMedia: () => null });
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const h = ref.current!; const root = h.shadowRoot ?? h.attachShadow({ mode: "open" }); root.innerHTML = `<style>.card{font-size:17px;line-height:1.4;color:#f2f2f0} img{max-width:100%} .cloze{color:#ff7a1a;font-weight:700} hr#answer{border:0;border-top:1px solid #333;margin:10px 0}</style><style>${r.css}</style><div class="night_mode nightMode"><div class="card night_mode">${r.back}</div></div>`; }, [card.id]);
  return (
    <div className="sheet-backdrop" onClick={onClose}><div className="sheet" onClick={(e) => e.stopPropagation()}>
      <div className="row" style={{ marginBottom: 8 }}><b className="grow">Preview</b><span className="chip">{card.suspended ? "suspended" : card.state}</span><button className="icon-btn" aria-label="Close preview" onClick={onClose}><IconClose /></button></div>
      <div ref={ref} className="card-host dark" />
      <p className="small muted">{card.source}{note.tags.length ? " · " + note.tags.filter((t) => !t.startsWith("auto::")).join(", ") : ""}</p>
      <div className="row"><button className="btn grow" onClick={async () => { await store.setSuspended(card.id, !card.suspended); onClose(); }}>{card.suspended ? "Unsuspend" : "Suspend"}</button><button className="btn grow" onClick={async () => { await store.setFlag(card.id, card.flag ? 0 : 1); onClose(); }}>{card.flag ? "Unflag" : "Flag"}</button></div>
    </div></div>
  );
}

function SmartEditor({ initial, onClose }: { initial?: SmartDeck; onClose: () => void }) {
  const [sd, setSd] = useState<SmartDeck>(initial ?? { id: String(Date.now()), name: "", systems: [], specialties: [], decks: [], tags: [], states: [] });
  const specialties = useMemo(() => store.tree("specialties").children.map((c) => c.name).filter((n) => n !== "Other"), []);
  const decks = useMemo(() => store.tree("decks").children.map((c) => c.name), []);
  const toggle = (key: "systems" | "specialties" | "decks" | "states", v: string) => setSd({ ...sd, [key]: (sd[key] as string[]).includes(v) ? (sd[key] as string[]).filter((x) => x !== v) : [...(sd[key] as string[]), v] });
  const Group = ({ title, items, k }: { title: string; items: string[]; k: "systems" | "specialties" | "decks" | "states" }) => (
    <><h2 style={{ marginTop: 10 }}>{title}</h2><div className="row" style={{ flexWrap: "wrap", gap: 6 }}>{items.map((x) => <button key={x} className={"chip" + ((sd[k] as string[]).includes(x) ? " orange" : "")} onClick={() => toggle(k, x)}>{x}</button>)}</div></>
  );
  const n = store.cardsMatching(sd).length;
  return (
    <div className="sheet-backdrop" onClick={onClose}><div className="sheet" onClick={(e) => e.stopPropagation()}>
      <div className="row"><b className="grow">{initial ? "Edit smart deck" : "New smart deck"}</b><button className="icon-btn" aria-label="Close editor" onClick={onClose}><IconClose /></button></div>
      <p className="small muted" style={{ marginTop: 4 }}>Pick anything from each group; a card matches if it fits every group you picked. {n.toLocaleString()} cards match now.</p>
      <div className="field"><label>Name</label><input value={sd.name} onChange={(e) => setSd({ ...sd, name: e.target.value })} placeholder="Step 1 · Cardio" /></div>
      <Group title="Systems" items={SYSTEM_NAMES} k="systems" />
      <Group title="Specialties" items={specialties} k="specialties" />
      <Group title="Decks" items={decks} k="decks" />
      <Group title="State" items={["new", "learning", "review", "relearning"]} k="states" />
      <div className="row" style={{ marginTop: 14 }}>
        {initial && <button className="btn danger" onClick={async () => { await store.saveSettings({ smart: store.settings.smart.filter((x) => x.id !== sd.id) }); onClose(); }}>Delete</button>}
        <button className="btn primary grow" disabled={!sd.name.trim()} onClick={async () => { const rest = store.settings.smart.filter((x) => x.id !== sd.id); await store.saveSettings({ smart: [...rest, sd] }); onClose(); }}>Save</button>
      </div>
    </div></div>
  );
}

export function Library({ onStudy }: { onStudy: (path: string, view: View) => void }) {
  const [view, setView] = useState<View>("decks");
  const [path, setPath] = useState("");
  const [showCards, setShowCards] = useState(false);
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<Card | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editSmart, setEditSmart] = useState<SmartDeck | null | "new">(null);
  const [moveTo, setMoveTo] = useState<string | null>(null);
  const v = store.getVersion();
  const tree = store.tree(view === "smart" ? "decks" : view);
  const node = view === "smart" ? null : (findNode(tree, path) ?? tree);
  const crumbs = path ? path.split("::") : [];
  const smart = view === "smart" && path ? store.settings.smart.find((s) => s.id === path) : null;
  const pinned = store.settings.pins.some((p) => p.view === view && p.path === path);

  const scopeCards = useMemo(() => (view === "smart" ? (smart ? store.cardsMatching(smart) : []) : store.cardsIn(path, view)), [path, view, v]);
  const counts = useMemo(() => {
    const now = Date.now(); let due = 0, learning = 0, fresh = 0, susp = 0, studied = 0;
    for (const c of scopeCards) { if (c.suspended) { susp++; continue; } if (c.state === "new") fresh++; else if (c.due <= now) due++; if (c.state === "learning" || c.state === "relearning") learning++; if (c.reps) studied++; }
    return { due, learning, fresh, susp, studied, total: scopeCards.length };
  }, [scopeCards]);

  const list = useMemo(() => {
    if (!showCards && !query) return [];
    const q = query.trim().toLowerCase();
    const seen = new Set<string>();
    const out: { card: Card; title: string; state: string }[] = [];
    for (const c of scopeCards) {
      if (seen.has(c.nid)) continue;
      const n = store.noteFor(c); if (!n) continue;
      const title = noteTitle(n, store.notetypeFor(n));
      if (q && !title.toLowerCase().includes(q) && !n.tags.some((t) => t.toLowerCase().includes(q))) continue;
      seen.add(c.nid);
      out.push({ card: c, title, state: c.suspended ? "suspended" : c.state });
      if (out.length >= 300) break;
    }
    return out;
  }, [scopeCards, showCards, query]);

  if (store.cards.size === 0) {
    return (<div className="screen"><h1>Library</h1><div className="empty">No cards yet. Import your Anki collection from Settings.</div></div>);
  }

  const go = (p: string) => { setPath(p); setShowCards(false); setSelecting(false); setSelected(new Set()); };
  const doBulk = async (action: Parameters<typeof store.bulk>[1]) => { await store.bulk([...selected], action); setSelected(new Set()); setSelecting(false); };
  const title = view === "smart" ? (smart?.name ?? "Smart decks") : node!.name;

  return (
    <div className="screen">
      <h1>Library</h1>
      <div className="seg">
        {[...VIEWS, { id: "smart" as View, label: "Smart" }].map((x) => <button key={x.id} className={view === x.id ? "on" : ""} onClick={() => { setView(x.id); go(""); }}>{x.label}</button>)}
      </div>
      {view !== "smart" && (
        <div className="crumbs">
          <button onClick={() => go("")}>All</button>
          {crumbs.map((c, i) => (<span key={i} className="row" style={{ gap: 4 }}><span className="muted">›</span><button onClick={() => go(crumbs.slice(0, i + 1).join("::"))}>{c}</button></span>))}
        </div>
      )}
      {view === "smart" && !smart ? (
        <>
          <p className="small muted">Smart decks combine systems, specialties, decks and states into one study scope, e.g. "Step 1 · Cardio".</p>
          {store.settings.smart.map((sd) => (
            <button key={sd.id} className="tree-row" style={{ width: "100%", textAlign: "left" }} onClick={() => go(sd.id)}><span className="name">{sd.name}</span><span className="small muted">{store.cardsMatching(sd).length.toLocaleString()} cards</span><span className="muted"><IconChevron /></span></button>
          ))}
          <button className="btn block" style={{ marginTop: 12 }} onClick={() => setEditSmart("new")}>New smart deck</button>
        </>
      ) : (
        <>
          <div className="card-box">
            <div className="row">
              <div className="grow">
                <div style={{ fontWeight: 700, fontSize: 18 }}>{title}</div>
                <div className="small muted">{counts.total.toLocaleString()} cards · {counts.susp.toLocaleString()} suspended · {counts.studied.toLocaleString()} studied</div>
              </div>
              <button className={"icon-btn" + (pinned ? " on" : "")} aria-label="Pin" onClick={() => store.saveSettings({ pins: pinned ? store.settings.pins.filter((p) => !(p.view === view && p.path === path)) : [...store.settings.pins, { view, path }] })}><IconPin /></button>
              <button className="btn primary" onClick={() => onStudy(path, view)} disabled={counts.due + counts.fresh + counts.learning === 0}><IconPlay /> Study</button>
            </div>
            <div className="row small" style={{ marginTop: 10, gap: 14 }}>
              <span className="c-due">{counts.due} due</span><span className="c-learn">{counts.learning} learning</span><span className="c-new">{counts.fresh} new</span>
              {smart && <button className="chip" style={{ marginLeft: "auto" }} onClick={() => setEditSmart(smart)}>Edit</button>}
            </div>
          </div>
          <div className="field"><input placeholder="Search cards and tags here" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
          {!query && node && node.children.length > 0 && (
            <>
              <h2>Categories</h2>
              {node.children.map((c) => (
                <button key={c.path} className="tree-row" style={{ width: "100%", textAlign: "left" }} onClick={() => go(c.path)}>
                  <span className="name">{c.name}</span>
                  <span className="counts"><span className="c-due">{c.due}</span><span className="c-learn">{c.learning}</span><span className="c-new">{c.newCount}</span></span>
                  <span className="muted"><IconChevron /></span>
                </button>
              ))}
            </>
          )}
          {!query && !showCards && <button className="btn ghost block" style={{ marginTop: 12 }} onClick={() => setShowCards(true)}>Show cards in {title}</button>}
          {(showCards || query) && (
            <>
              <div className="row" style={{ marginTop: 18 }}>
                <h2 className="grow" style={{ margin: 0 }}>Cards {list.length >= 300 ? "(first 300)" : `(${list.length})`}</h2>
                <button className="chip" onClick={() => { setSelecting(!selecting); setSelected(new Set()); }}>{selecting ? "Cancel" : "Select"}</button>
                {selecting && <button className="chip" onClick={() => setSelected(new Set(list.map((r) => r.card.id)))}>All</button>}
              </div>
              {list.map((r) => (
                <button key={r.card.id} className="list-row" style={{ width: "100%", textAlign: "left" }} onClick={() => { if (selecting) { const s = new Set(selected); s.has(r.card.id) ? s.delete(r.card.id) : s.add(r.card.id); setSelected(s); } else setPreview(r.card); }}>
                  {selecting && <input type="checkbox" readOnly checked={selected.has(r.card.id)} />}
                  <span className="t">{r.title}</span><span className={"chip " + (r.state === "new" ? "" : "orange")}>{r.state}</span>
                </button>
              ))}
            </>
          )}
        </>
      )}
      {selecting && selected.size > 0 && (
        <div className="bulk-bar">
          <span className="small">{selected.size} selected</span>
          <button className="btn" onClick={() => doBulk({ suspended: true })}>Suspend</button>
          <button className="btn" onClick={() => doBulk({ suspended: false })}>Unsuspend</button>
          <button className="btn" onClick={() => doBulk({ flag: 1 })}>Flag</button>
          <button className="btn" onClick={() => { const t = prompt("Tag to add (use :: for hierarchy)"); if (t) doBulk({ addTag: t.trim().replace(/\s+/g, "_") }); }}>Tag</button>
          <button className="btn" onClick={() => setMoveTo("")}>Move</button>
        </div>
      )}
      {moveTo !== null && (
        <div className="sheet-backdrop" onClick={() => setMoveTo(null)}><div className="sheet" onClick={(e) => e.stopPropagation()}>
          <b>Move {selected.size} cards to</b>
          <div className="field"><label>Category path (use :: for levels)</label><input value={moveTo} list="deckpaths" onChange={(e) => setMoveTo(e.target.value)} placeholder="Medicine::Cardiology::ECG" /></div>
          <datalist id="deckpaths">{[...new Set([...store.cards.values()].map((c) => c.source))].sort().map((p) => <option key={p} value={p} />)}</datalist>
          <button className="btn primary block" disabled={!moveTo.trim()} onClick={async () => { await doBulk({ source: moveTo.trim() }); setMoveTo(null); }}>Move</button>
        </div></div>
      )}
      {preview && <Preview card={preview} onClose={() => setPreview(null)} />}
      {editSmart && <SmartEditor initial={editSmart === "new" ? undefined : editSmart} onClose={() => { setEditSmart(null); if (view === "smart" && path && !store.settings.smart.some((s) => s.id === path)) go(""); }} />}
    </div>
  );
}
