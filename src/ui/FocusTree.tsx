// F5 Focus tree: auto-laid-out nodes, prerequisite lines, exclusive markers; hover = preview, click = start.
import { ActionButton } from "./ActionButton";
import { useUi } from "./store";

const W = 150, H = 54, GX = 165, GY = 80;
const COLORS = { done: "#2d6a4f", current: "#b08900", available: "#1f4e79", blocked: "#333a44", excluded: "#3a1f1f" } as const;

export function FocusTree() {
  const f = useUi((s) => s.snap?.focus);
  if (!f || !f.tree) return <div>No focus tree.</div>;
  const pos = new Map(f.focuses.map((n) => [n.id, n]));
  const maxX = Math.max(...f.focuses.map((n) => n.x)) + 1, maxY = Math.max(...f.focuses.map((n) => n.y)) + 1;
  const cur = f.current ? pos.get(f.current) : null;
  return (
    <div>
      <div style={{ margin: "6px 0" }}><strong>{f.treeName}</strong> — {cur ? <>working on <em>{cur.name}</em> ({Math.min(100, Math.round((100 * f.progress) / Math.max(1, f.days)))}%) <ActionButton cmd={{ type: "cancel_focus", payload: {} }}>Cancel</ActionButton></> : "no focus in progress — pick one"}</div>
      <div style={{ overflow: "auto", maxHeight: "calc(100vh - 160px)", position: "relative" }}>
        <div style={{ position: "relative", width: maxX * GX + 20, height: maxY * GY + 20 }}>
          <svg width={maxX * GX + 20} height={maxY * GY + 20} style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }}>
            {f.focuses.flatMap((n) => [...n.prereqs.map((p) => [p, n.id, false] as const), ...n.anyOf.map((p) => [p, n.id, true] as const)]).map(([a, b, dashed], i) => {
              const A = pos.get(a), B = pos.get(b);
              if (!A || !B) return null;
              return <line key={i} x1={A.x * GX + W / 2 + 10} y1={A.y * GY + H + 10} x2={B.x * GX + W / 2 + 10} y2={B.y * GY + 10} stroke="#8892a0" strokeWidth={1.5} strokeDasharray={dashed ? "4 3" : undefined} />;
            })}
          </svg>
          {f.focuses.map((n) => (
            <div key={n.id} style={{ position: "absolute", left: n.x * GX + 10, top: n.y * GY + 10, width: W }}>
              <div title={n.reason || undefined} style={{ height: H, padding: 4, boxSizing: "border-box", background: COLORS[n.status], border: `1px solid ${n.exclusive.length ? "#e76f51" : "#556"}`, borderRadius: 6, fontSize: 11, color: "#eee", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                <div style={{ fontWeight: 600, lineHeight: 1.15 }}>{n.exclusive.length ? "⚔ " : ""}{n.name}</div>
                {n.status === "available" && !f.current && <ActionButton cmd={{ type: "start_focus", payload: { focus: n.id } }} style={{ padding: "0 6px", fontSize: 11 }}>Start</ActionButton>}
                {n.status === "done" && <span>✔ done</span>}
                {n.status === "excluded" && <span style={{ opacity: 0.7 }}>locked out</span>}
                {n.status === "blocked" && <span style={{ opacity: 0.6 }}>{n.reason.length > 28 ? n.reason.slice(0, 26) + "…" : n.reason}</span>}
                {n.status === "current" && <span>⏳ in progress</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ fontSize: 11, opacity: 0.7, marginTop: 4 }}>⚔ = mutually exclusive choice · dashed line = any one of · hover Start for effects</div>
    </div>
  );
}
