import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createSimBridge } from "../worker/bridge";
import type { StartScope } from "../sim/setup";
import { useUi } from "./store";
import { MapView } from "./MapView";
import { TopBar } from "./TopBar";
import { ProvincePanel } from "./ProvincePanel";
import { Dock } from "./Dock";

function useHotkeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { snap, send, set } = useUi.getState();
      if (!snap || (e.target as HTMLElement).tagName === "INPUT") return;
      if (e.code === "Space") { e.preventDefault(); send({ kind: "setPaused", paused: !snap.paused }); }
      else if (e.key === "+" || e.key === "=") send({ kind: "setSpeed", speed: snap.speed + 1 });
      else if (e.key === "-") send({ kind: "setSpeed", speed: snap.speed - 1 });
      else if (e.key === "1") set({ mapMode: "political" });
      else if (e.key === "2") set({ mapMode: "development" });
      else if (e.key === "3") set({ mapMode: "population" });
      else if (e.key === "4") set({ mapMode: "sol" });
      else if (e.key === "F2") { e.preventDefault(); toggleDock("economy"); }
      else if (e.key === "F3") { e.preventDefault(); toggleDock("population"); }
      else if (e.key === "Escape") set({ selected: null });
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
}

function toggleDock(tab: "economy" | "population") {
  const { dock, set } = useUi.getState();
  set({ dock: dock === tab ? null : tab });
}

/** Keep the worker inspecting the country of the selected province (or the first major) while a panel is open. */
function useInspection() {
  const { dock, selected, snap, setup, send } = useUi();
  const country = setup ? (selected !== null && snap ? snap.owner[selected]! : Math.max(0, setup.countries.findIndex((c) => c.tag === "GER"))) : null;
  useEffect(() => { send({ kind: "inspect", country: dock ? country : null }); }, [dock, country, send]);
}

function App() {
  const [scope, setScope] = useState<StartScope | null>(null);
  const { setup, set } = useUi();
  useHotkeys();
  useInspection();
  useEffect(() => {
    if (!scope) return;
    const b = createSimBridge((m) => {
      if (m.kind === "setup") set({ setup: m.info });
      else if (m.kind === "snapshot") set({ snap: m.snap });
      else if (m.kind === "report") set({ report: m.report });
      else set({ message: m.reason });
    });
    set({ send: b.send });
    b.send({ kind: "init", seed: 1936, scope });
    return () => b.terminate();
  }, [scope, set]);

  if (!scope) return (
    <div style={{ display: "grid", placeItems: "center", height: "100vh", background: "#0f111a", color: "#eee" }}>
      <div style={{ textAlign: "center" }}>
        <h1>Iron &amp; Empire</h1><p>The Long Century, 1936–2026</p>
        <button style={{ margin: 8, padding: "8px 16px" }} onClick={() => setScope("world")}>Start — World</button>
        <button style={{ margin: 8, padding: "8px 16px" }} onClick={() => setScope("europe")}>Quick start — Europe only</button>
      </div>
    </div>
  );
  return (
    <div style={{ position: "fixed", inset: 0, background: "#1d3557", overflow: "hidden", fontFamily: "system-ui, sans-serif" }}>
      {setup ? <><MapView /><TopBar /><Dock /><ProvincePanel /></> : <p style={{ color: "#eee", padding: 16 }}>Loading…</p>}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
