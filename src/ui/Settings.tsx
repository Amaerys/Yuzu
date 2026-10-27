import { useMemo, useRef, useState } from "react";
import { fmtDate, fmtDateTime, fmtTime } from "../lib/dates";
import { store } from "../lib/store";
import { importAnki } from "../import/anki";
import { inflateRaw, zstd } from "../lib/decompress";
import { getMeta } from "../lib/db";
import { useEffect } from "react";
import { GitHubSync } from "../lib/sync";
import { repairApp } from "./App";
import { noteTitle } from "../lib/render";
import { THEMES, sfx } from "./sfx";
import { holdAwake } from "../lib/wake";
import { ZipFile } from "../lib/zipfile";

declare const __VERSION__: string;

export function Settings({ onInbox }: { onInbox?: () => void } = {}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const restoreRef = useRef<HTMLInputElement>(null);
  const mediaRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const stopRef = useRef<AbortController | null>(null);
  const [mediaMsg, setMediaMsg] = useState("");
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaFrac, setMediaFrac] = useState(0);
  const [quota, setQuota] = useState<{ used: number; free: number; persisted: boolean } | null>(null);
  useEffect(() => { (async () => { try { const e = await navigator.storage?.estimate?.(); const p = (await navigator.storage?.persisted?.()) ?? false; if (e) setQuota({ used: e.usage ?? 0, free: Math.max(0, (e.quota ?? 0) - (e.usage ?? 0)), persisted: p }); } catch { /* not available */ } })(); }, [mediaMsg]);
  async function onMedia(input: File | File[]) {
    setBusy(true); setMediaBusy(true); setMediaMsg(""); setMediaFrac(0); stopRef.current = new AbortController();
    try {
      const r = await holdAwake(() => store.addMediaFrom(input, { inflateRaw, zstd, signal: stopRef.current!.signal, onProgress: (m, f) => { setMediaMsg(m); if (f !== undefined) setMediaFrac(f); } }));
      const parts = [r.images && `${r.images.toLocaleString()} images`, r.sounds && `${r.sounds.toLocaleString()} sounds`, r.other && `${r.other.toLocaleString()} template file${r.other === 1 ? "" : "s"}`].filter(Boolean).join(", ");
      setMediaMsg((r.stopped ? "Stopped — run it again with the same file to continue. " : "") + (r.stored ? `Added ${parts} (${(r.bytes / 1048576).toFixed(0)} MB).` : "Nothing new to add.") + (r.already ? ` ${r.already.toLocaleString()} were already here.` : "") + (r.missing ? ` ${r.missing.toLocaleString()} your cards use are not in ${Array.isArray(input) ? "these files" : "this file"}.` : "") + (r.failed ? ` ${r.failed} could not be read.` : ""));
    } catch (e: any) { setMediaMsg("Failed: " + (e?.message ?? e)); }
    finally { setBusy(false); setMediaBusy(false); stopRef.current = null; if (mediaRef.current) mediaRef.current.value = ""; if (folderRef.current) folderRef.current.value = ""; }
  }
  async function hasMedia(file: Blob) { try { const z = new ZipFile(file, inflateRaw); const l = await z.list(); return l.length > 3 && l.some((e) => e.name === "media"); } catch { return false; } }
  async function onExportMedia() {
    setBusy(true); setMediaBusy(true); setMediaMsg("Packing"); setMediaFrac(0);
    try {
      const files = await holdAwake(() => store.exportMedia((m) => setMediaMsg(m)));
      for (const f of files) { const a = document.createElement("a"); a.href = URL.createObjectURL(f.blob); a.download = f.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000); }
      setMediaMsg(files.length ? `Saved ${files.map((f) => `${f.name} (${(f.blob.size / 1048576).toFixed(0)} MB)`).join(", ")}. On the other device choose ${files.length > 1 ? "each file" : "it"} with “Choose file”.` : "No media on this device yet.");
    } catch (e: any) { setMediaMsg("Failed: " + (e?.message ?? e)); }
    finally { setBusy(false); setMediaBusy(false); }
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
      const res = await importAnki(file, {
        inflateRaw, zstd,
        onProgress: (m, f) => { setMsg(m); if (f !== undefined) setFrac(f); },
      }, { skipDeckPrefixes: skipLanguages ? ["Languages"] : [] });
      const merged = await store.applyImport(res, (m, f) => { setMsg(m); setFrac(f); });
      setResult(`Imported ${res.summary.notes.toLocaleString()} notes, ${res.summary.cards.toLocaleString()} cards and ${res.summary.reviews.toLocaleString()} reviews (${merged.newCards.toLocaleString()} new cards, ${merged.updated} updated). ${res.summary.media ? `${res.summary.media.toLocaleString()} images and sounds referenced.` : ""}`);
      // The same file may carry the media: continue straight into adding it.
      if (res.summary.media && await hasMedia(file)) { setBusy(false); await onMedia(file); }
    } catch (e: any) {
      setResult("Import failed: " + (e?.message ?? String(e)));
    } finally { setBusy(false); setMsg(""); if (fileRef.current) fileRef.current.value = ""; }
  }

  return (
    <div className="screen">
      <h1>Settings</h1>
      <details className="section" open><summary>Look and sound <span className="small muted">on this device</span></summary>
        <div className="card-box">
          <div className="themes">{THEMES.map((t) => <button key={t.id} className={s.theme === t.id ? "on" : ""} onClick={() => { store.saveSettings({ theme: t.id }); sfx.tap(); }}><span className="sw">{t.sw.map((c) => <i key={c} style={{ background: c }} />)}</span>{t.name}</button>)}</div>
          <label className="row small" style={{ margin: "12px 0 0" }}><input type="checkbox" checked={s.sfx} onChange={(e) => { store.saveSettings({ sfx: e.target.checked }); if (e.target.checked) setTimeout(() => sfx.answer(3), 50); }} /> Sound effects (short 8-bit blips on answers, goal and boss fights)</label>
        </div>
      </details>
      <details className="section" open><summary>Studying <span className="small muted">new cards, goal, order, scheduler</span></summary>
      <div className="card-box">
        <div className="field"><label>New cards per day</label><input type="number" min={0} max={500} value={s.newPerDay} onChange={(e) => store.saveSettings({ newPerDay: Number(e.target.value) })} /></div>
        <div className="field"><label>Daily review goal</label><input type="number" min={1} max={2000} value={s.dailyGoal} onChange={(e) => store.saveSettings({ dailyGoal: Number(e.target.value) })} /></div>
        <div className="field"><label>Max due cards per day (0 = no limit)</label><input type="number" min={0} max={5000} value={s.maxReviewsPerDay} onChange={(e) => store.saveSettings({ maxReviewsPerDay: Number(e.target.value) })} /><span className="small muted">With a backlog, keeps each day to a size you will actually finish. The rest waits; nothing is lost.</span></div>
        <div className="field"><label>Order of due cards</label>
          <select value={s.dueOrder} onChange={(e) => store.saveSettings({ dueOrder: e.target.value as any })}>
            <option value="forgotten">Most forgotten first (lowest recall probability)</option>
            <option value="due">By due date</option>
            <option value="shuffle">Shuffled</option>
          </select><span className="small muted">Cards are also spread across systems so neighbours differ.</span></div>
        <div className="field"><label>Desired retention (FSRS)</label>
          <select value={s.scheduler.desiredRetention} onChange={(e) => store.saveSettings({ scheduler: { ...s.scheduler, desiredRetention: Number(e.target.value) } })}>
            {[0.8, 0.85, 0.9, 0.95].map((r) => <option key={r} value={r}>{Math.round(r * 100)}%</option>)}
          </select></div>
        <div className="field"><label>Scheduler weights</label>
          <div className="row"><button className="btn grow" disabled={!!store.fitting} onClick={async () => { setFitMsg("Fitting…"); setFitMsg(await store.optimizeScheduler()); }}>{store.fitting ? `Fitting… ${Math.round(store.fitting.progress * 100)}%` : "Tune to my history"}</button></div>
          <p className="small muted" style={{ marginBottom: 0 }}>{fitMsg || (s.fit ? `Fitted ${fmtDate(s.fit.at)} on ${s.fit.n.toLocaleString()} reviews (error ${s.fit.before.toFixed(3)} → ${s.fit.after.toFixed(3)}). Re-runs automatically every ~1000 reviews.` : "Default FSRS weights. Runs automatically once you have ~400 spaced reviews.")}</p>
        </div>
        <label className="row small" style={{ margin: "8px 0" }}><input type="checkbox" checked={s.nightCards} onChange={(e) => store.saveSettings({ nightCards: e.target.checked })} /> Slate cards (dark card paper, easier at night)</label>
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

      </details>
      {reversible.length > 0 && <details className="section"><summary>Language cards <span className="small muted">reverse and typed cards</span></summary>
        <div className="card-box">
          <p className="small muted" style={{ marginTop: 0 }}>Reverse cards ask the other direction (German → English as well as English → German). Turning one off suspends its reverse cards; history is kept.</p>
          {reversible.map(({ nt, notes, on }) => (
            <label key={nt.id} className="row small" style={{ margin: "8px 0" }}><input type="checkbox" checked={on && !store.cardsOfNoteType(nt.id, 1).every((c) => c.suspended)} onChange={async (e) => { setRevMsg("Working…"); const n = await store.setReverse(nt.id, e.target.checked); setRevMsg(`${n?.toLocaleString()} reverse cards ${e.target.checked ? "added" : "suspended"}.`); }} /> {nt.name} <span className="muted">· {notes.toLocaleString()} notes</span></label>
          ))}
          {revMsg && <p className="small muted" style={{ marginBottom: 0 }}>{revMsg}</p>}
        </div>
      </details>}
      <details className="section"><summary>Cards to ask Claude about <span className="small muted">leeches you flagged</span></summary>
      <div className="card-box">
        <p className="small muted" style={{ marginTop: 0 }}>Leeches you marked as "mixed up with something similar". Copy the list into the chat and I'll make contrast cards for them.</p>
        {(() => { const list = askList; return list.length ? (
          <div className="row"><span className="small grow">{list.length} card{list.length === 1 ? "" : "s"}</span><button className="btn" onClick={async () => { const text = list.map((n) => "- " + noteTitle(n)).join("\n"); try { await navigator.clipboard.writeText(text); setResult("Copied " + list.length + " cards."); } catch { prompt("Copy this list:", text); } }}>Copy list</button><button className="btn" onClick={async () => { for (const n of list) await store.updateNote(n.id, n.fields, n.tags.filter((t) => t !== "ask-claude" && !t.startsWith("auto::"))); setScan((x) => x + 1); }}>Clear</button></div>
        ) : <p className="small muted" style={{ margin: 0 }}>Nothing yet.</p>; })()}
      </div>
      </details>
      <details className="section"><summary>Import from Anki <span className="small muted">collection, packs, curation</span></summary>
      <div className="card-box">
        <p className="small muted" style={{ marginTop: 0 }}>Export from Anki as a <b>collection package (.colpkg)</b> or a deck (.apkg) with scheduling included; if it includes media, the images and sounds are added right after the cards. Importing again later only adds what's new. Also accepts <b>Yuzu card packs</b> and <b>curation files</b> (.json) made by Claude: duplicates are skipped or merged, cards move to their categories, similar cards get the tag <i>needs-review::similar</i>. Large collections: import on a PC first, then sync to the phone.</p>
        <label className="row small" style={{ marginBottom: 10 }}><input type="checkbox" checked={skipLanguages} onChange={(e) => setSkipLanguages(e.target.checked)} /> Skip the Languages decks</label>
        <input ref={fileRef} type="file" accept=".colpkg,.apkg,.zip,.json" style={{ display: "none" }} onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        <button className="btn primary block" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? "Importing…" : "Choose file"}</button>
        {busy && (<><div className="bar"><i style={{ width: `${frac * 100}%` }} /></div><div className="small muted">{msg} — keep this tab open</div></>)}
        {result && <p className="small" style={{ marginBottom: 0 }}>{result}</p>}
        {last && !busy && <p className="small muted" style={{ marginBottom: 0 }}>Last import {fmtDateTime(last.at)}: {last.summary?.cards?.toLocaleString()} cards.</p>}
      </div>

      </details>
      <details className="section" open><summary>Images and sounds <span className="small muted">kept on this device</span></summary>
      <div className="card-box">
        {(() => { const m = mediaStat; const pct = m.total ? Math.round((m.stored / m.total) * 100) : 100; return (<>
          <div className="stat-grid" style={{ marginTop: 0 }}>
            <div className="stat"><b>{m.images.stored.toLocaleString()}</b><span>of {m.images.total.toLocaleString()} images</span></div>
            <div className="stat"><b>{m.sounds.stored.toLocaleString()}</b><span>of {m.sounds.total.toLocaleString()} sounds</span></div>
            <div className="stat"><b>{(m.bytes / 1048576).toFixed(0)}<small> MB</small></b><span>{quota ? `${(quota.free / 1073741824).toFixed(1)} GB free` : "used"}</span></div>
          </div>
          {!mediaBusy && <div className="bar" aria-label={`${pct}% of your cards' media is here`}><i style={{ width: `${pct}%` }} /></div>}
          <p className="small muted">{m.total === 0 ? "None of your cards use images or sounds." : m.stored === m.total ? "Everything your cards use is here." : `${(m.total - m.stored).toLocaleString()} files your cards use are not on this device yet.`}{quota && !quota.persisted && m.bytes > 0 ? " The browser may clear big libraries when space runs low; installing Yuzu to the home screen protects it." : ""}</p>
        </>); })()}
        <input ref={mediaRef} type="file" accept=".apkg,.colpkg,.zip" style={{ display: "none" }} onChange={(e) => e.target.files?.[0] && onMedia(e.target.files[0])} />
        <input ref={folderRef} type="file" multiple {...({ webkitdirectory: "", directory: "" } as any)} style={{ display: "none" }} onChange={(e) => e.target.files?.length && onMedia([...e.target.files])} />
        {mediaBusy ? (<>
          <div className="bar"><i style={{ width: `${mediaFrac * 100}%` }} /></div>
          <div className="row" style={{ marginTop: 8 }}><span className="small grow">{mediaMsg || "Working"} — keep Yuzu open; the screen stays on</span>{stopRef.current && <button className="btn" onClick={() => stopRef.current?.abort()}>Stop</button>}</div>
        </>) : (<>
          <div className="row">
            <button className="btn primary grow" disabled={busy} onClick={() => mediaRef.current?.click()}>Choose file</button>
            <button className="btn grow" disabled={busy} onClick={() => folderRef.current?.click()}>Choose media folder</button>
          </div>
          {mediaMsg && <p className="small" style={{ marginBottom: 0 }}>{mediaMsg}</p>}
          <details className="how"><summary className="small">How to bring your Anki media in</summary>
            <ol className="small muted">
              <li><b>Phone only:</b> in AnkiDroid or Anki, export your collection as <b>.colpkg</b> with <b>“Include media”</b> ticked, then choose that file here. Big libraries take a while; you can stop and run it again — it continues where it left off.</li>
              <li><b>PC first (fastest for big libraries):</b> open Yuzu on the PC, press <b>Choose media folder</b> and pick Anki's <code>collection.media</code> folder (Anki → Tools → Check Media → View Files shows it). Then press <b>Save media file</b>, copy that file to the phone and choose it here — it is already shrunk, so it loads in minutes.</li>
              <li>Only files your cards use are kept. Images are resized to phone size (usually 5–10× smaller); sounds stay as they are.</li>
            </ol>
          </details>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn grow" disabled={busy || !mediaStat.stored} onClick={onExportMedia}>Save media file</button>
            <button className="btn" disabled={busy || !mediaStat.bytes} onClick={async () => { if (confirm("Remove all deck images and sounds from this device? Cards keep working; media shows as placeholders until added again.")) { setMediaMsg(`Removed ${(await store.clearMedia()).toLocaleString()} files.`); } }}>Remove</button>
          </div>
          {mediaStat.missing.length > 0 && <details className="how"><summary className="small">Show what's missing</summary><p className="small muted" style={{ wordBreak: "break-all" }}>{mediaStat.missing.slice(0, 60).join(" · ")}{mediaStat.total - mediaStat.stored > 60 ? " …" : ""}</p></details>}
        </>)}
        <label className="row small" style={{ margin: "12px 0 6px" }}><input type="checkbox" checked={s.autoplay} onChange={(e) => store.saveSettings({ autoplay: e.target.checked })} /> Play card sounds automatically (tap ▶ or press R to replay)</label>
        <label className="row small" style={{ margin: "6px 0" }}><input type="checkbox" checked={s.mediaSync} onChange={(e) => store.saveSettings({ mediaSync: e.target.checked })} /> Share images between devices through the sync repository</label>
        <label className="row small" style={{ margin: "6px 0 0" }}><input type="checkbox" checked={s.mediaDownload} onChange={(e) => store.saveSettings({ mediaDownload: e.target.checked })} /> Download shared images on this device</label>
        <p className="small muted" style={{ marginBottom: 0 }}>Sharing moves 15 MB of images per sync, up to about 900 MB in total — fine for a few thousand images. For a whole library, the media file above is faster and keeps your sync repository small.</p>
      </div>

      </details>
      <details className="section"><summary>Inbox <span className="small muted">packs from Claude</span></summary>
      <div className="card-box">
        <p className="small muted" style={{ marginTop: 0 }}>Packs placed in the <b>inbox</b> folder of your sync repository arrive here on the next sync and wait for your review. {store.inbox.length ? `${store.inbox.length} waiting.` : "Nothing waiting."}{store.packLog.length ? ` ${store.packLog.length} packs added so far (removable).` : ""}</p>
        <button className="btn block" onClick={onInbox}>Open inbox</button>
      </div>

      </details>
      <details className="section" open><summary>Sync between devices</summary>
      <div className="card-box">
        <p className="small muted" style={{ marginTop: 0 }}>Uses a <b>private</b> GitHub repository, like Orange. Create one named <b>yuzu-data</b>, then a fine-grained token limited to it with <b>Contents: read and write</b>. The token stays on this device.</p>
        <div className="field"><label>GitHub username</label><input defaultValue={sy.owner} autoCapitalize="none" onBlur={(e) => setSync({ owner: e.target.value.trim() })} placeholder="Amaerys" /></div>
        <div className="field"><label>Repository</label><input defaultValue={sy.repo} autoCapitalize="none" onBlur={(e) => setSync({ repo: e.target.value.trim() })} /></div>
        <div className="field"><label>Token</label><div className="row"><input className="grow" type={showToken ? "text" : "password"} defaultValue={sy.token} autoCapitalize="none" onBlur={(e) => setSync({ token: e.target.value.trim() })} placeholder="github_pat_…" /><button className="btn" onClick={() => setShowToken(!showToken)}>{showToken ? "Hide" : "Show"}</button></div></div>
        <div className="field"><label>This device's name</label><input defaultValue={s.deviceName} onBlur={(e) => store.saveSettings({ deviceName: e.target.value })} placeholder="S25 Ultra" /></div>
        <label className="row small" style={{ margin: "8px 0" }}><input type="checkbox" checked={sy.auto} onChange={(e) => setSync({ auto: e.target.checked })} /> Sync automatically after changes</label>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn" disabled={!store.syncConfigured()} onClick={async () => { setSyncMsg("Checking…"); const r = await new GitHubSync({ owner: sy.owner, repo: sy.repo, token: sy.token }).check(); setSyncMsg(r.message); }}>Test</button>
          <button className="btn primary grow" disabled={!store.syncConfigured() || store.syncStatus.state === "syncing"} onClick={() => store.sync()}>{store.syncStatus.state === "syncing" ? "Syncing…" : "Sync now"}</button>
        </div>
        <p className="small" style={{ marginBottom: 0, color: store.syncStatus.state === "error" ? "var(--again)" : undefined }}>{syncMsg || store.syncStatus.message}{store.syncStatus.at && store.syncStatus.state !== "syncing" ? ` · ${fmtTime(store.syncStatus.at)}` : ""}</p>
        {store.syncLog.length > 0 && (
          <details style={{ marginTop: 8 }}>
            <summary className="small muted">Sync history</summary>
            <ul className="small" style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {store.syncLog.map((l) => <li key={l.at} className={l.ok ? "" : "muted"}>{fmtDateTime(l.at)} · {l.ok ? "✓" : "✗"} {l.message} ({(l.ms / 1000).toFixed(1)} s)</li>)}
            </ul>
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn" onClick={async () => { if (confirm("Forget what has been synced and compare everything with the repository again? Nothing is deleted; the next sync re-downloads and re-uploads changed files.")) { await store.resetSyncState(); store.sync(); } }}>Re-check everything</button>
              <button className="btn" onClick={async () => { setSyncMsg("Compacting…"); setSyncMsg(await store.compactNow()); }}>Compact history</button>
            </div>
            <p className="small muted" style={{ marginBottom: 0 }}>Compacting folds the repository's history into one commit so it stays the size of your collection; Yuzu does this by itself every 300 syncs.</p>
          </details>
        )}
      </div>

      </details>
      <details className="section"><summary>Data <span className="small muted">back up, restore, wipe</span></summary>
      <div className="card-box">
        <div className="small muted">{store.notes.size.toLocaleString()} notes · {store.cards.size.toLocaleString()} cards · {store.reviews.length.toLocaleString()} reviews on this device. A quick backup holds only what cannot be rebuilt (reviews, scheduling, settings, your hooks; about 1 MB); the full one includes every card's text.</div>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn grow" onClick={() => { const blob = new Blob([JSON.stringify(store.quickBackup())], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `yuzu-quick-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }}>Quick backup</button>
          <button className="btn grow" onClick={() => { const blob = new Blob([JSON.stringify(store.backup())], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `yuzu-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }}>Full backup</button>
          <button className="btn grow" onClick={() => restoreRef.current?.click()}>Restore backup</button>
          <input ref={restoreRef} type="file" accept=".json,application/json" style={{ display: "none" }} onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { const r = await store.restore(JSON.parse(await f.text())); setResult(`Restored: ${r.cards} cards, ${r.notes} notes and ${r.reviews} reviews merged.`); } catch (err: any) { setResult("Restore failed: " + err.message); } e.target.value = ""; }} />
        </div>
        <button className="btn danger block" style={{ marginTop: 10 }} onClick={async () => { if (confirm("Delete all cards and reviews from this device?")) await store.wipe(); }}>Delete everything on this device</button>
      </div>
      </details>
      <details className="section"><summary>Diagnostics <span className="small muted">storage, errors, repair</span></summary>
      <Diagnostics />
      </details>
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
      {info.lastError && <div className="muted" style={{ marginTop: 6 }}>Last error ({fmtDateTime(info.lastError.at)}, {info.lastError.where}): {info.lastError.message}</div>}
      <button className="btn block" style={{ marginTop: 10 }} onClick={repairApp}>Repair app (reload the latest version, keep data)</button>
    </div>
  );
}
