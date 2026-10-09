import { MAX_SPEED } from "../sim/speed";
import { useUi } from "./store";

export function TopBar() {
  const { snap, send, mapMode, set } = useUi();
  if (!snap) return null;
  const btn = { padding: "2px 8px", background: "#2b2d42", color: "#eee", border: "1px solid #555", borderRadius: 4, cursor: "pointer" } as const;
  return (
    <div style={{ position: "absolute", top: 0, left: 0, right: 0, display: "flex", gap: 12, alignItems: "center", padding: "6px 12px", background: "rgba(15,17,26,0.9)", color: "#eee", fontSize: 14, zIndex: 2 }}>
      <strong>Iron &amp; Empire</strong>
      <span style={{ minWidth: 110 }}>{snap.dateLabel}</span>
      <button style={btn} onClick={() => send({ kind: "setPaused", paused: !snap.paused })}>{snap.paused ? "▶ Play" : "⏸ Pause"}</button>
      <span>Speed</span>
      {Array.from({ length: MAX_SPEED }, (_, i) => i + 1).map((s) => (
        <button key={s} style={{ ...btn, background: s === snap.speed ? "#8d99ae" : btn.background }} onClick={() => send({ kind: "setSpeed", speed: s })}>{s}</button>
      ))}
      <span style={{ marginLeft: "auto" }}>Map:</span>
      {(["political", "development"] as const).map((m, i) => (
        <button key={m} style={{ ...btn, background: m === mapMode ? "#8d99ae" : btn.background }} onClick={() => set({ mapMode: m })}>{i + 1} {m}</button>
      ))}
    </div>
  );
}
