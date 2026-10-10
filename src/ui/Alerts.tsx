// Right column: alerts (click to jump, mute per type) and the outliner (construction, laws).
import { BUILDINGS } from "../sim/defs";
import { LAWS } from "../sim/laws";
import { ActionButton } from "./ActionButton";
import { toggleMute, useUi } from "./store";

const COLORS = { 1: "#8ecae6", 2: "#ffb703", 3: "#e76f51" } as const;

export function AlertsColumn() {
  const { snap, setup, muted, set, jumpTo } = useUi();
  if (!snap || !setup) return null;
  const p = snap.player;
  const alerts = p.alerts.filter((a) => !muted.includes(a.type));
  return (
    <div style={{ position: "absolute", top: 72, right: 12, width: 300, color: "#eee", fontSize: 12, zIndex: 4, display: "flex", flexDirection: "column", gap: 4, maxHeight: "55vh", overflowY: "auto" }}>
      {alerts.map((a, i) => (
        <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", padding: "4px 8px", background: "rgba(15,17,26,0.92)", borderLeft: `3px solid ${COLORS[a.severity]}`, borderRadius: 4, cursor: a.province !== undefined || a.panel ? "pointer" : undefined }}
          onClick={() => { if (a.province !== undefined) jumpTo(a.province); if (a.panel) set({ dock: a.panel }); }}>
          <span style={{ flex: 1 }}>{a.text}</span>
          <button title="Mute this alert type" style={{ background: "none", border: "none", color: "#888", cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); toggleMute(a.type); }}>🔕</button>
        </div>
      ))}
      {muted.length > 0 && <div style={{ opacity: 0.6, cursor: "pointer" }} onClick={() => muted.forEach(toggleMute)}>{muted.length} alert type(s) muted — click to unmute</div>}
      <div style={{ marginTop: 6, padding: 8, background: "rgba(15,17,26,0.92)", borderRadius: 4 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Outliner</div>
        <div style={{ opacity: 0.7 }}>Construction</div>
        {p.projects.length === 0 && <div style={{ opacity: 0.6 }}>— none —</div>}
        {p.projects.map((pr) => (
          <div key={pr.index} style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ flex: 1, cursor: "pointer" }} onClick={() => jumpTo(pr.province)}>
              {pr.state ? "🏗" : "💼"} {BUILDINGS[pr.type]!.name} ×{pr.levels} · {setup.provinceNames[pr.province]} · {Math.round(100 * pr.progress)}%
            </span>
            {pr.state && <ActionButton cmd={{ type: "cancel_project", payload: { project: pr.index } }}>✕</ActionButton>}
          </div>
        ))}
        <div style={{ opacity: 0.7, marginTop: 4 }}>Laws</div>
        {LAWS.map((cat, k) => <div key={cat.id} style={{ cursor: "pointer" }} onClick={() => set({ dock: "government" })}>{cat.name}: {cat.laws[p.laws[k]!]!.name}</div>)}
      </div>
    </div>
  );
}
