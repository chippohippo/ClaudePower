import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createSimBridge } from "../worker/bridge";
import type { StartScope } from "../sim/setup";
import { useUi } from "./store";
import { MapView } from "./MapView";
import { TopBar } from "./TopBar";
import { ProvincePanel } from "./ProvincePanel";
import { Dock } from "./Dock";
import { AlertsColumn } from "./Alerts";
import { Palette } from "./Palette";
import { FirstSteps } from "./FirstSteps";
import { EventModal } from "./EventModal";
import { Ticker } from "./Ticker";
import { BattleModal } from "./Military";
import { receivePreviews } from "./store";

const MAJORS = [["GER", "Germany"], ["USA", "United States"], ["GBR", "United Kingdom"], ["FRA", "France"], ["ITA", "Italy"], ["SOV", "Soviet Union"], ["JAP", "Japan"], ["CHI", "China"]] as const;
const MAJOR_BLURB: Record<string, string> = {
  GER: "Recommended first game. Industrial heartland, rearming, closed borders — a compact country to learn the economy.",
  USA: "Recommended first game. Vast, rich and laissez-faire, with room to grow and few neighbours to fear.",
  GBR: "An empire on which the sun never sets — and whose colonies are poor.",
  FRA: "A rich core with a huge, poor colonial empire.",
  ITA: "Ambitious, mobilising, short of coal and oil.",
  SOV: "Command economy, universal schooling, enormous and poor.",
  JAP: "Rising industrial power with Korea and Taiwan.",
  CHI: "Half a billion people, little industry. Hard mode.",
};

/** New chronicle entries for the player become notifications; leadership changes auto-pause (§9). */
const PAUSE_KINDS = new Set(["succession", "coup", "election", "death", "war", "peace", "nuke"]);
let lastEventCount = 0;
function notify(snap: import("../worker/protocol").Snapshot) {
  const { seenChronicle, notes, set, send } = useUi.getState();
  // A new event awaiting a choice pauses the game (§4 auto-pause).
  if (snap.events.length > lastEventCount && !snap.paused) send({ kind: "setPaused", paused: true });
  lastEventCount = snap.events.length;
  const fresh = snap.chronicle.filter((e) => e.n > seenChronicle);
  if (!fresh.length) return;
  const first = seenChronicle < 0 && snap.date === 0;
  set({ seenChronicle: Math.max(...snap.chronicle.map((e) => e.n)), notes: first ? notes : [...notes, ...fresh.map((e) => ({ text: `${e.date}: ${e.text}`, kind: e.kind }))].slice(-6) });
  if (!first && fresh.some((e) => PAUSE_KINDS.has(e.kind)) && !snap.paused) send({ kind: "setPaused", paused: true });
}

function Notes() {
  const { notes, set } = useUi();
  if (!notes.length) return null;
  return (
    <div style={{ position: "absolute", top: 46, left: "50%", transform: "translateX(-50%)", width: 520, zIndex: 6, display: "flex", flexDirection: "column", gap: 4 }}>
      {notes.map((n, i) => (
        <div key={i} style={{ padding: "6px 10px", background: n.kind === "coup" || n.kind === "strike" ? "#7f1d1d" : "#1e3a5f", color: "#fff", borderRadius: 6, fontSize: 13, display: "flex", gap: 8 }}>
          <span style={{ flex: 1 }}>{{ death: "⚱", succession: "👑", election: "🗳", coup: "⚔", strike: "✊" }[n.kind] ?? "📰"} {n.text}</span>
          <button style={{ background: "none", border: "none", color: "#fff", cursor: "pointer" }} onClick={() => set({ notes: notes.filter((_, k) => k !== i) })}>✕</button>
        </div>
      ))}
    </div>
  );
}

function Toast() {
  const message = useUi((s) => s.message);
  if (!message) return null;
  return <div style={{ position: "absolute", top: 80, left: "50%", transform: "translateX(-50%)", padding: "6px 12px", background: "#7f1d1d", color: "#fff", borderRadius: 6, zIndex: 40, fontSize: 13 }}>{message}</div>;
}

function useHotkeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { snap, send, set } = useUi.getState();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); set({ palette: !useUi.getState().palette }); return; }
      if (!snap || ["INPUT", "SELECT"].includes((e.target as HTMLElement).tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); send({ kind: "undo" }); return; }
      if (e.code === "Space") { e.preventDefault(); send({ kind: "setPaused", paused: !snap.paused }); }
      else if (e.key === "+" || e.key === "=") send({ kind: "setSpeed", speed: snap.speed + 1 });
      else if (e.key === "-") send({ kind: "setSpeed", speed: snap.speed - 1 });
      else if (e.key === "1") set({ mapMode: "political" });
      else if (e.key === "2") set({ mapMode: "development" });
      else if (e.key === "3") set({ mapMode: "population" });
      else if (e.key === "4") set({ mapMode: "sol" });
      else if (e.key === "5") set({ mapMode: "unrest" });
      else if (e.key === "6") set({ mapMode: "ig" });
      else if (e.key === "F4") { e.preventDefault(); toggleDock("igs"); }
      else if (e.key === "F5") { e.preventDefault(); toggleDock("focus"); }
      else if (e.key === "F6") { e.preventDefault(); toggleDock("diplomacy"); }
      else if (e.key === "F7") { e.preventDefault(); toggleDock("military"); }
      else if (e.key === "F8") { e.preventDefault(); toggleDock("tech"); }
      else if (e.key === "7") set({ mapMode: "relations" });
      else if (e.key === "8") set({ mapMode: "occupation" });
      else if (e.key === "F1") { e.preventDefault(); toggleDock("government"); }
      else if (e.key === "F2") { e.preventDefault(); toggleDock("economy"); }
      else if (e.key === "F3") { e.preventDefault(); toggleDock("population"); }
      else if (e.key === "Escape") set({ selected: null });
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
}

function toggleDock(tab: "government" | "economy" | "population" | "igs" | "focus" | "diplomacy" | "military" | "tech") {
  const { dock, set } = useUi.getState();
  set({ dock: dock === tab ? null : tab });
}

/** Keep the worker inspecting the country of the selected province (or the first major) while a panel is open. */
function useInspection() {
  const { dock, selected, snap, setup, send } = useUi();
  const country = setup ? (selected !== null && snap ? snap.owner[selected]! : setup.player) : null;
  useEffect(() => { send({ kind: "inspect", country: dock && dock !== "government" && dock !== "igs" ? country : null }); }, [dock, country, send]);
}

function App() {
  const [scope, setScope] = useState<StartScope | null>(null);
  const [player, setPlayer] = useState("GER");
  const { setup, set } = useUi();
  useHotkeys();
  useInspection();
  useEffect(() => {
    if (!scope) return;
    const b = createSimBridge((m) => {
      if (m.kind === "setup") set({ setup: m.info });
      else if (m.kind === "snapshot") { set({ snap: m.snap }); notify(m.snap); }
      else if (m.kind === "report") set({ report: m.report });
      else if (m.kind === "previews") receivePreviews(m.id, m.results);
      else if (m.kind === "events") { const done = useUi.getState().done; set({ done: [...new Set([...done, ...m.events])], message: "" }); }
      else { set({ message: m.reason }); setTimeout(() => set({ message: "" }), 3000); }
    });
    set({ send: b.send });
    b.send({ kind: "init", seed: 1936, scope, player });
    return () => b.terminate();
  }, [scope, set]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!scope) return (
    <div style={{ display: "grid", placeItems: "center", height: "100vh", background: "#0f111a", color: "#eee" }}>
      <div style={{ textAlign: "center" }}>
        <h1>Iron &amp; Empire</h1><p>The Long Century, 1936–2026</p>
        <p>Choose your nation</p>
        <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap", maxWidth: 520 }}>
          {MAJORS.map(([tag, name]) => (
            <button key={tag} onClick={() => setPlayer(tag)} style={{ padding: "6px 10px", background: player === tag ? "#ffd60a" : "#2b2d42", color: player === tag ? "#000" : "#eee", border: "1px solid #555", borderRadius: 4, cursor: "pointer" }}>{name}</button>
          ))}
        </div>
        <p style={{ opacity: 0.7, fontSize: 13 }}>{MAJOR_BLURB[player]}</p>
        <button style={{ margin: 8, padding: "8px 16px" }} onClick={() => setScope("world")}>Start — World</button>
        <button style={{ margin: 8, padding: "8px 16px" }} onClick={() => setScope("europe")}>Quick start — Europe only</button>
      </div>
    </div>
  );
  return (
    <div style={{ position: "fixed", inset: 0, background: "#1d3557", overflow: "hidden", fontFamily: "system-ui, sans-serif" }}>
      {setup ? <><MapView /><TopBar /><Dock /><AlertsColumn /><ProvincePanel /><FirstSteps /><Palette /><Toast /><Notes /><EventModal /><BattleModal /><Ticker /></> : <p style={{ color: "#eee", padding: 16 }}>Loading…</p>}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
