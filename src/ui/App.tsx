import { useEffect, useState, useSyncExternalStore } from "react";
import { store, type View } from "../lib/store";
import { Today } from "./Today";
import { Library } from "./Library";
import { Settings } from "./Settings";
import { Study } from "./Study";
import { IconToday, IconLibrary, IconProgress, IconSettings, YuzuMark } from "./icons";
import { Progress } from "./Progress";

type Tab = "today" | "library" | "progress" | "settings";

export function App() {
  useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);
  const [tab, setTab] = useState<Tab>("today");
  const [study, setStudy] = useState<{ path: string; view: View } | null>(null);
  const startStudy = (path: string, view: View = "decks") => setStudy({ path, view });
  const [update, setUpdate] = useState<(() => void) | null>(null);

  useEffect(() => {
    const onUpdate = (e: Event) => setUpdate(() => (e as CustomEvent).detail as () => void);
    window.addEventListener("yuzu:update", onUpdate);
    return () => window.removeEventListener("yuzu:update", onUpdate);
  }, []);

  if (!store.loaded) {
    return <div className="screen" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "80dvh" }}><YuzuMark size={56} /></div>;
  }
  if (study !== null) return <Study path={study.path} view={study.view} onExit={() => setStudy(null)} />;

  return (
    <div className="app">
      {tab === "today" && <Today onStudy={startStudy} />}
      {tab === "library" && <Library onStudy={startStudy} />}
      {tab === "progress" && <Progress />}
      {tab === "settings" && <Settings />}
      {update && <div className="toast row">New version ready <button className="btn primary" style={{ minHeight: 32, padding: "4px 12px" }} onClick={update}>Update</button></div>}
      <nav className="tabs">
        {([["today", "Today", <IconToday />], ["library", "Library", <IconLibrary />], ["progress", "Progress", <IconProgress />], ["settings", "Settings", <IconSettings />]] as const).map(([k, label, icon]) => (
          <button key={k} className={"tab" + (tab === k ? " active" : "")} onClick={() => setTab(k)}>{icon}{label}</button>
        ))}
      </nav>
    </div>
  );
}
