import { useMemo, useRef, useState } from "react";
import { store } from "../lib/store";
import { importAnki } from "../import/anki";
import { inflateRaw, zstd } from "../lib/decompress";
import { getMeta } from "../lib/db";
import { useEffect } from "react";
import { GitHubSync } from "../lib/sync";
import { repairApp } from "./App";
import { noteTitle } from "../lib/render";

declare const __VERSION__: string;

export function Settings({ onInbox }: { onInbox?: () => void } = {}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const restoreRef = useRef<HTMLInputElement>(null);
  const mediaRef = useRef<HTMLInputElement>(null);
  const [mediaMsg, setMediaMsg] = useState("");
  async function onMedia(file: File) {
    setBusy(true); setMediaMsg(""); setFrac(0);
    try {
      const r = await store.addMediaFrom(file, { inflateRaw, zstd, onProgress: (m, f) => { setMediaMsg(m); if (f !== undefined) setFrac(f); } });
      setMediaMsg(`${r.stored.toLocaleString()} images added (${(r.bytes / 1048576).toFixed(0)} MB)${r.missing ? `, ${r.missing.toLocaleString()} referenced images are not in this file` : ""}.`);
    } catch (e: any) { setMediaMsg("Failed: " + (e?.message ?? e)); }
    finally { setBusy(false); if (mediaRef.current) mediaRef.current.value = ""; }
  }
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [frac, setFrac] = useState(0);
  const [result, setResult] = useState<string>("");
  const [last, setLast] = useState<{ at: number; summary: any } | null>(null);
  const [skipLanguages, setSkipLanguages] = useState(false);
  const s = store.settings;
  const [syncMsg, setSyncMsg] = useState("");
  const [fitMsg, setFitMsg] = useState("");
  const [revMsg, setRevMsg] = useState("");
  const [scan, setScan] = useState(0); // bump to rescan the collection-wide numbers below
  const reversible = useMemo(() => store.reversibleNotetypes(), [scan, revMsg]);
  const mediaStat = useMemo(() => store.mediaStatus(), [scan, mediaMsg, result]);
  const askList = useMemo(() => [...store.notes.values()].filter((n) => n.tags.includes("ask-claude")), [scan, result]);
  const [showToken, setShowToken] = useState(false);
  const sy = s.sync;
  const setSync = (patch: Partial<typeof sy>) => store.saveSettings({ sync: { ...sy, ...patch } });

  useEffect(() => { getMeta<{ at: number; summary: any } | null>("lastImport", null).then(setLast); }, [result]);
  // Closing the tab halfway through an import would leave it half applied: warn first.
  useEffect(() => {
    if (!busy) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h); return () => window.removeEventListener("beforeunload", h);
  }, [busy]);

  async function onFile(file: File) {
    setBusy(true); setResult(""); setFrac(0);
    try {
      setMsg("Reading file");
      if (/\.json$/i.test(file.name)) {
        const text = await file.text(); const json = JSON.parse(text);
        if (json?.yuzu_curation === 1) { setMsg("Applying curation"); setResult(await store.importCuration(json, (m, f) => { setMsg(m); setFrac(f); })); return; }
        setResult(await store.importPack(json));
        return;
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const res = await importAnki(bytes, {
        inflateRaw, zstd,
        onProgress: (m, f) => { setMsg(m); if (f !== undefined) setFrac(f); },
      }, { skipDeckPrefixes: skipLanguages ? ["Languages"] : [] });
      const merged = await store.applyImport(res, (m, f) => { setMsg(m); setFrac(f); });
      setResult(`Imported ${res.summary.notes.toLocaleString()} notes, ${res.summary.cards.toLocaleString()} cards and ${res.summary.reviews.toLocaleString()} reviews (${merged.newCards.toLocaleString()} new cards, ${merged.updated} updated). ${res.summary.media.toLocaleString()} media files referenced; images will be added in a later step.`);
    } catch (e: any) {
      setResult("Import failed: " + (e?.message ?? String(e)));
    } finally { setBusy(false); setMsg(""); if (fileRef.current) fileRef.current.value = ""; }
  }

  return (
    <div className="screen">
      <h1>Settings</h1>
      <h2>Import from Anki</h2>
      <div className="card-box">
        <p className="small muted" style={{ marginTop: 0 }}>Export from Anki as a <b>collection package (.colpkg)</b> or a deck (.apkg) <b>without media</b>, with scheduling included. Importing again later only adds what's new. Also accepts <b>Yuzu card packs</b> and <b>curation files</b> (.json) made by Claude: duplicates are skipped or merged, cards move to their categories, similar cards get the tag <i>needs-review::similar</i>. Large collections: import on a PC first, then sync to the phone.</p>
        <label className="row small" style={{ marginBottom: 10 }}><input type="checkbox" checked={skipLanguages} onChange={(e) => setSkipLanguages(e.target.checked)} /> Skip the Languages decks</label>
        <input ref={fileRef} type="file" accept=".colpkg,.apkg,.zip,.json" style={{ display: "none" }} onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        <button className="btn primary block" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? "Importing…" : "Choose file"}</button>
        {busy && (<><div className="bar"><i style={{ width: `${frac * 100}%` }} /></div><div className="small muted">{msg} — keep this tab open</div></>)}
        {result && <p className="small" style={{ marginBottom: 0 }}>{result}</p>}
        {last && !busy && <p className="small muted" style={{ marginBottom: 0 }}>Last import {new Date(last.at).toLocaleString()}: {last.summary?.cards?.toLocaleString()} cards.</p>}
      </div>

      <h2>Images</h2>
      <div className="card-box">
        {(() => { const m = mediaStat; return <p className="small muted" style={{ marginTop: 0 }}>{m.stored.toLocaleString()} of {m.total.toLocaleString()} images your cards use are on this device ({(m.bytes / 1048576).toFixed(0)} MB). Images stay on each device; to add some, export a deck from Anki as .apkg <b>with media</b> and choose it here. Only the images your cards reference are kept, shrunk to fit a phone screen.</p>; })()}
        <input ref={mediaRef} type="file" accept=".apkg,.colpkg,.zip" style={{ display: "none" }} onChange={(e) => e.target.files?.[0] && onMedia(e.target.files[0])} />
        <div className="row">
          <button className="btn primary grow" disabled={busy} onClick={() => mediaRef.current?.click()}>{busy ? "Working…" : "Add images from a deck file"}</button>
          <button className="btn" disabled={busy} onClick={async () => { if (confirm("Remove all deck images from this device? Cards keep working, images show as placeholders until added again.")) setResult(`Removed ${await store.clearMedia()} images.`); }}>Remove</button>
        </div>
        {mediaMsg && <p className="small" style={{ marginBottom: 0 }}>{mediaMsg}</p>}
      </div>

      <h2>Inbox</h2>
      <div className="card-box">
        <p className="small muted" style={{ marginTop: 0 }}>Packs placed in the <b>inbox</b> folder of your sync repository arrive here on the next sync and wait for your review. {store.inbox.length ? `${store.inbox.length} waiting.` : "Nothing waiting."}{store.packLog.length ? ` ${store.packLog.length} packs added so far (removable).` : ""}</p>
        <button className="btn block" onClick={onInbox}>Open inbox</button>
      </div>

      <h2>Sync between devices</h2>
      <div className="card-box">
        <p className="small muted" style={{ marginTop: 0 }}>Uses a <b>private</b> GitHub repository, like Orange. Create one named <b>yuzu-data</b>, then a fine-grained token limited to it with <b>Contents: read and write</b>. The token stays on this device.</p>
        <div className="field"><label>GitHub username</label><input value={sy.owner} autoCapitalize="none" onChange={(e) => setSync({ owner: e.target.value.trim() })} placeholder="Amaerys" /></div>
        <div className="field"><label>Repository</label><input value={sy.repo} autoCapitalize="none" onChange={(e) => setSync({ repo: e.target.value.trim() })} /></div>
        <div className="field"><label>Token</label><div className="row"><input className="grow" type={showToken ? "text" : "password"} value={sy.token} autoCapitalize="none" onChange={(e) => setSync({ token: e.target.value.trim() })} placeholder="github_pat_…" /><button className="btn" onClick={() => setShowToken(!showToken)}>{showToken ? "Hide" : "Show"}</button></div></div>
        <div className="field"><label>This device's name</label><input value={s.deviceName} onChange={(e) => store.saveSettings({ deviceName: e.target.value })} placeholder="S25 Ultra" /></div>
        <label className="row small" style={{ margin: "8px 0" }}><input type="checkbox" checked={sy.auto} onChange={(e) => setSync({ auto: e.target.checked })} /> Sync automatically after changes</label>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn" disabled={!store.syncConfigured()} onClick={async () => { setSyncMsg("Checking…"); const r = await new GitHubSync({ owner: sy.owner, repo: sy.repo, token: sy.token }).check(); setSyncMsg(r.message); }}>Test</button>
          <button className="btn primary grow" disabled={!store.syncConfigured() || store.syncStatus.state === "syncing"} onClick={() => store.sync()}>{store.syncStatus.state === "syncing" ? "Syncing…" : "Sync now"}</button>
        </div>
        <p className="small" style={{ marginBottom: 0, color: store.syncStatus.state === "error" ? "var(--again)" : undefined }}>{syncMsg || store.syncStatus.message}{store.syncStatus.at && store.syncStatus.state !== "syncing" ? ` · ${new Date(store.syncStatus.at).toLocaleTimeString()}` : ""}</p>
        {store.syncLog.length > 0 && (
          <details style={{ marginTop: 8 }}>
            <summary className="small muted">Sync history</summary>
            <ul className="small" style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {store.syncLog.map((l) => <li key={l.at} className={l.ok ? "" : "muted"}>{new Date(l.at).toLocaleString()} · {l.ok ? "✓" : "✗"} {l.message} ({(l.ms / 1000).toFixed(1)} s)</li>)}
            </ul>
            <button className="btn" style={{ marginTop: 8 }} onClick={async () => { if (confirm("Forget what has been synced and compare everything with the repository again? Nothing is deleted; the next sync re-downloads and re-uploads changed files.")) { await store.resetSyncState(); store.sync(); } }}>Re-check everything</button>
          </details>
        )}
      </div>

      <h2>Studying</h2>
      <div className="card-box">
        <div className="field"><label>New cards per day</label><input type="number" min={0} max={500} value={s.newPerDay} onChange={(e) => store.saveSettings({ newPerDay: Number(e.target.value) })} /></div>
        <div className="field"><label>Daily review goal</label><input type="number" min={1} max={2000} value={s.dailyGoal} onChange={(e) => store.saveSettings({ dailyGoal: Number(e.target.value) })} /></div>
        <div className="field"><label>Desired retention (FSRS)</label>
          <select value={s.scheduler.desiredRetention} onChange={(e) => store.saveSettings({ scheduler: { ...s.scheduler, desiredRetention: Number(e.target.value) } })}>
            {[0.8, 0.85, 0.9, 0.95].map((r) => <option key={r} value={r}>{Math.round(r * 100)}%</option>)}
          </select></div>
        <div className="field"><label>Scheduler weights</label>
          <div className="row"><button className="btn grow" disabled={!!store.fitting} onClick={async () => { setFitMsg("Fitting…"); setFitMsg(await store.optimizeScheduler()); }}>{store.fitting ? `Fitting… ${Math.round(store.fitting.progress * 100)}%` : "Tune to my history"}</button></div>
          <p className="small muted" style={{ marginBottom: 0 }}>{fitMsg || (s.fit ? `Fitted ${new Date(s.fit.at).toLocaleDateString()} on ${s.fit.n.toLocaleString()} reviews (error ${s.fit.before.toFixed(3)} → ${s.fit.after.toFixed(3)}). Re-runs automatically every ~1000 reviews.` : "Default FSRS weights. Runs automatically once you have ~400 spaced reviews.")}</p>
        </div>
        <label className="row small" style={{ margin: "8px 0" }}><input type="checkbox" checked={s.nightCards} onChange={(e) => store.saveSettings({ nightCards: e.target.checked })} /> Dark cards (night mode for card content)</label>
        <label className="row small" style={{ margin: "8px 0" }}><input type="checkbox" checked={s.swipe} onChange={(e) => store.saveSettings({ swipe: e.target.checked })} /> Swipe to answer (left = Again, right = Good)</label>
        <label className="row small" style={{ margin: "8px 0" }}><input type="checkbox" checked={s.typeAnswers} onChange={(e) => store.saveSettings({ typeAnswers: e.target.checked })} /> Type the answer on language cards</label>
        <label className="row small" style={{ margin: "8px 0" }}><input type="checkbox" checked={s.burySiblings} onChange={(e) => store.saveSettings({ burySiblings: e.target.checked })} /> Bury siblings (don't show two cards of one note in a session)</label>
        <div className="field"><label>Streak rest days per week</label>
          <select value={s.restDays} onChange={(e) => store.saveSettings({ restDays: Number(e.target.value) })}>
            {[0, 1, 2].map((h) => <option key={h} value={h}>{h}</option>)}
          </select></div>
        <div className="field"><label>New day starts at</label>
          <select value={s.rollover} onChange={(e) => store.saveSettings({ rollover: Number(e.target.value) })}>
            {[0, 1, 2, 3, 4, 5, 6].map((h) => <option key={h} value={h}>{h}:00</option>)}
          </select></div>
      </div>

      {reversible.length > 0 && (<>
        <h2>Language cards</h2>
        <div className="card-box">
          <p className="small muted" style={{ marginTop: 0 }}>Reverse cards ask the other direction (German → English as well as English → German). Turning one off suspends its reverse cards; history is kept.</p>
          {reversible.map(({ nt, notes, on }) => (
            <label key={nt.id} className="row small" style={{ margin: "8px 0" }}><input type="checkbox" checked={on && !store.cardsOfNoteType(nt.id, 1).every((c) => c.suspended)} onChange={async (e) => { setRevMsg("Working…"); const n = await store.setReverse(nt.id, e.target.checked); setRevMsg(`${n?.toLocaleString()} reverse cards ${e.target.checked ? "added" : "suspended"}.`); }} /> {nt.name} <span className="muted">· {notes.toLocaleString()} notes</span></label>
          ))}
          {revMsg && <p className="small muted" style={{ marginBottom: 0 }}>{revMsg}</p>}
        </div>
      </>)}
      <h2>Cards to ask Claude about</h2>
      <div className="card-box">
        <p className="small muted" style={{ marginTop: 0 }}>Leeches you marked as "mixed up with something similar". Copy the list into the chat and I'll make contrast cards for them.</p>
        {(() => { const list = askList; return list.length ? (
          <div className="row"><span className="small grow">{list.length} card{list.length === 1 ? "" : "s"}</span><button className="btn" onClick={async () => { const text = list.map((n) => "- " + noteTitle(n)).join("\n"); try { await navigator.clipboard.writeText(text); setResult("Copied " + list.length + " cards."); } catch { prompt("Copy this list:", text); } }}>Copy list</button><button className="btn" onClick={async () => { for (const n of list) await store.updateNote(n.id, n.fields, n.tags.filter((t) => t !== "ask-claude" && !t.startsWith("auto::"))); setScan((x) => x + 1); }}>Clear</button></div>
        ) : <p className="small muted" style={{ margin: 0 }}>Nothing yet.</p>; })()}
      </div>
      <h2>Data</h2>
      <div className="card-box">
        <div className="small muted">{store.notes.size.toLocaleString()} notes · {store.cards.size.toLocaleString()} cards · {store.reviews.length.toLocaleString()} reviews on this device.</div>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn grow" onClick={() => { const blob = new Blob([JSON.stringify(store.backup())], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `yuzu-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }}>Back up</button>
          <button className="btn grow" onClick={() => restoreRef.current?.click()}>Restore backup</button>
          <input ref={restoreRef} type="file" accept=".json,application/json" style={{ display: "none" }} onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { const r = await store.restore(JSON.parse(await f.text())); setResult(`Restored: ${r.cards} cards, ${r.notes} notes and ${r.reviews} reviews merged.`); } catch (err: any) { setResult("Restore failed: " + err.message); } e.target.value = ""; }} />
        </div>
        <button className="btn danger block" style={{ marginTop: 10 }} onClick={async () => { if (confirm("Delete all cards and reviews from this device?")) await store.wipe(); }}>Delete everything on this device</button>
      </div>
      <h2>Diagnostics</h2>
      <Diagnostics />
      <p className="small muted" style={{ textAlign: "center", marginTop: 24 }}>Yuzu {__VERSION__}</p>
    </div>
  );
}

function Diagnostics() {
  const [info, setInfo] = useState<{ quota?: string; persisted?: string; lastError?: any; sw?: string }>({});
  useEffect(() => { (async () => {
    const out: typeof info = {};
    try { const e = await navigator.storage?.estimate?.(); if (e?.usage !== undefined) out.quota = `${(e.usage / 1048576).toFixed(0)} MB used${e.quota ? ` of ${(e.quota / 1048576 / 1024).toFixed(1)} GB available` : ""}`; } catch { /* unsupported */ }
    try { out.persisted = (await navigator.storage?.persisted?.()) ? "yes (browser will not evict it)" : "not guaranteed"; } catch { /* unsupported */ }
    try { out.lastError = await getMeta<any>("lastError", null); } catch { /* ignore */ }
    try { out.sw = (await navigator.serviceWorker?.getRegistration())?.active ? "active" : "none"; } catch { /* ignore */ }
    setInfo(out);
  })(); }, []);
  return (
    <div className="card-box small">
      <div>Storage: {info.quota ?? "…"} · persistent: {info.persisted ?? "…"} · offline cache: {info.sw ?? "…"}</div>
      {store.loadNotes.length > 0 && <div className="muted" style={{ marginTop: 6 }}>On load: {store.loadNotes.join("; ")}</div>}
      {info.lastError && <div className="muted" style={{ marginTop: 6 }}>Last error ({new Date(info.lastError.at).toLocaleString()}, {info.lastError.where}): {info.lastError.message}</div>}
      <button className="btn block" style={{ marginTop: 10 }} onClick={repairApp}>Repair app (reload the latest version, keep data)</button>
    </div>
  );
}
