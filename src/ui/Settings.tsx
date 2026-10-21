import { useRef, useState } from "react";
import { store } from "../lib/store";
import { importAnki } from "../import/anki";
import { inflateRaw, zstd } from "../lib/decompress";
import { getMeta } from "../lib/db";
import { useEffect } from "react";
import { GitHubSync } from "../lib/sync";

declare const __VERSION__: string;

export function Settings() {
  const fileRef = useRef<HTMLInputElement>(null);
  const restoreRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [frac, setFrac] = useState(0);
  const [result, setResult] = useState<string>("");
  const [last, setLast] = useState<{ at: number; summary: any } | null>(null);
  const [skipLanguages, setSkipLanguages] = useState(false);
  const s = store.settings;
  const [syncMsg, setSyncMsg] = useState("");
  const [showToken, setShowToken] = useState(false);
  const sy = s.sync;
  const setSync = (patch: Partial<typeof sy>) => store.saveSettings({ sync: { ...sy, ...patch } });

  useEffect(() => { getMeta<{ at: number; summary: any } | null>("lastImport", null).then(setLast); }, [result]);

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
        {busy && (<><div className="bar"><i style={{ width: `${frac * 100}%` }} /></div><div className="small muted">{msg}</div></>)}
        {result && <p className="small" style={{ marginBottom: 0 }}>{result}</p>}
        {last && !busy && <p className="small muted" style={{ marginBottom: 0 }}>Last import {new Date(last.at).toLocaleString()}: {last.summary?.cards?.toLocaleString()} cards.</p>}
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
        <p className="small muted" style={{ marginBottom: 0 }}>{syncMsg || store.syncStatus.message}{store.syncStatus.at ? ` · ${new Date(store.syncStatus.at).toLocaleTimeString()}` : ""}</p>
      </div>

      <h2>Studying</h2>
      <div className="card-box">
        <div className="field"><label>New cards per day</label><input type="number" min={0} max={500} value={s.newPerDay} onChange={(e) => store.saveSettings({ newPerDay: Number(e.target.value) })} /></div>
        <div className="field"><label>Daily review goal</label><input type="number" min={1} max={2000} value={s.dailyGoal} onChange={(e) => store.saveSettings({ dailyGoal: Number(e.target.value) })} /></div>
        <div className="field"><label>Desired retention (FSRS)</label>
          <select value={s.scheduler.desiredRetention} onChange={(e) => store.saveSettings({ scheduler: { ...s.scheduler, desiredRetention: Number(e.target.value) } })}>
            {[0.8, 0.85, 0.9, 0.95].map((r) => <option key={r} value={r}>{Math.round(r * 100)}%</option>)}
          </select></div>
        <label className="row small" style={{ margin: "8px 0" }}><input type="checkbox" checked={s.nightCards} onChange={(e) => store.saveSettings({ nightCards: e.target.checked })} /> Dark cards (night mode for card content)</label>
        <label className="row small" style={{ margin: "8px 0" }}><input type="checkbox" checked={s.swipe} onChange={(e) => store.saveSettings({ swipe: e.target.checked })} /> Swipe to answer (left = Again, right = Good)</label>
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
      <p className="small muted" style={{ textAlign: "center", marginTop: 24 }}>Yuzu {__VERSION__}</p>
    </div>
  );
}
