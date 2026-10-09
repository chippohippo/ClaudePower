import { StrictMode, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { createSimBridge } from "../worker/bridge";
import { useUi } from "./store";

function App() {
  const { snap, message, set } = useUi();
  const bridge = useRef<ReturnType<typeof createSimBridge> | null>(null);
  useEffect(() => {
    const b = createSimBridge((m) => (m.kind === "snapshot" ? set({ snap: m.snap }) : set({ message: m.reason })));
    b.send({ kind: "init", seed: 1936 });
    bridge.current = b;
    return () => b.terminate();
  }, [set]);
  return (
    <main style={{ fontFamily: "system-ui", padding: 16 }}>
      <h1>Iron &amp; Empire</h1>
      <p>Date: {snap?.dateLabel ?? "…"} · Treasury C00: {((snap?.treasury[0] ?? 0) / 100).toFixed(2)}</p>
      <button onClick={() => bridge.current?.send({ kind: "step", days: 30 })}>+30 days</button>{" "}
      <button onClick={() => { bridge.current?.send({ kind: "command", cmd: { type: "debug_add_treasury", actor: 0, payload: { cents: 10000 } } }); bridge.current?.send({ kind: "step", days: 1 }); }}>+100 treasury</button>
      <p>{message}</p>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
