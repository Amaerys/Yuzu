import { useRef, useState } from "react";
import { store } from "../lib/store";
import { importAnki } from "../import/anki";
import { inflateRaw, zstd } from "../lib/decompress";
import { getMeta } from "../lib/db";
import { useEffect } from "react";

declare const __VERSION__: string;

export function Settings() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [frac, setFrac] = useState(0);
  const [result, setResult] = useState<string>("");
  const [last, setLast] = useState<{ at: number; summary: any } | null>(null);
  const [skipLanguages, setSkipLanguages] = useState(false);
  const s = store.settings;

  useEffect(() => { getMeta<{ at: number; summary: any } | null>("lastImport", null).then(setLast); }, [result]);

  async function onFile(file: File) {
    setBusy(true); setResult(""); setFrac(0);
    try {
      setMsg("Reading file");
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
        <p className="small muted" style={{ marginTop: 0 }}>Export from Anki as a <b>collection package (.colpkg)</b> or a deck (.apkg) <b>without media</b>, with scheduling included. Importing again later only adds what's new.</p>
        <label className="row small" style={{ marginBottom: 10 }}><input type="checkbox" checked={skipLanguages} onChange={(e) => setSkipLanguages(e.target.checked)} /> Skip the Languages decks</label>
        <input ref={fileRef} type="file" accept=".colpkg,.apkg,.zip" style={{ display: "none" }} onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        <button className="btn primary block" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? "Importing…" : "Choose file"}</button>
        {busy && (<><div className="bar"><i style={{ width: `${frac * 100}%` }} /></div><div className="small muted">{msg}</div></>)}
        {result && <p className="small" style={{ marginBottom: 0 }}>{result}</p>}
        {last && !busy && <p className="small muted" style={{ marginBottom: 0 }}>Last import {new Date(last.at).toLocaleString()}: {last.summary?.cards?.toLocaleString()} cards.</p>}
      </div>

      <h2>Studying</h2>
      <div className="card-box">
        <div className="field"><label>New cards per day</label><input type="number" min={0} max={500} value={s.newPerDay} onChange={(e) => store.saveSettings({ newPerDay: Number(e.target.value) })} /></div>
        <div className="field"><label>Daily review goal</label><input type="number" min={1} max={2000} value={s.dailyGoal} onChange={(e) => store.saveSettings({ dailyGoal: Number(e.target.value) })} /></div>
        <div className="field"><label>Desired retention (FSRS)</label>
          <select value={s.scheduler.desiredRetention} onChange={(e) => store.saveSettings({ scheduler: { ...s.scheduler, desiredRetention: Number(e.target.value) } })}>
            {[0.8, 0.85, 0.9, 0.95].map((r) => <option key={r} value={r}>{Math.round(r * 100)}%</option>)}
          </select></div>
        <div className="field"><label>New day starts at</label>
          <select value={s.rollover} onChange={(e) => store.saveSettings({ rollover: Number(e.target.value) })}>
            {[0, 1, 2, 3, 4, 5, 6].map((h) => <option key={h} value={h}>{h}:00</option>)}
          </select></div>
      </div>

      <h2>Data</h2>
      <div className="card-box">
        <div className="small muted">{store.notes.size.toLocaleString()} notes · {store.cards.size.toLocaleString()} cards · {store.reviews.length.toLocaleString()} reviews on this device.</div>
        <button className="btn danger block" style={{ marginTop: 10 }} onClick={async () => { if (confirm("Delete all cards and reviews from this device?")) await store.wipe(); }}>Delete everything on this device</button>
      </div>
      <p className="small muted" style={{ textAlign: "center", marginTop: 24 }}>Yuzu {__VERSION__}</p>
    </div>
  );
}
