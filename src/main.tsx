import { createRoot } from "react-dom/client";
import { App } from "./ui/App";
import { store } from "./lib/store";

store.load().catch((e) => console.error("load failed", e));
createRoot(document.getElementById("root")!).render(<App />);

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("./sw.js");
      const notify = () => {
        const w = reg.waiting;
        if (!w) return;
        window.dispatchEvent(new CustomEvent("yuzu:update", { detail: () => { w.postMessage({ type: "SKIP_WAITING" }); } }));
      };
      if (reg.waiting) notify();
      reg.addEventListener("updatefound", () => {
        const nw = reg.installing;
        nw?.addEventListener("statechange", () => { if (nw.state === "installed" && navigator.serviceWorker.controller) notify(); });
      });
      let reloading = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => { if (!reloading) { reloading = true; location.reload(); } });
    } catch (e) { console.warn("sw", e); }
  });
}
