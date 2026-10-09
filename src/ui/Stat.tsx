import { useState } from "react";
import type { Contributor } from "../sim/inspect";

/** A labelled value whose hover tooltip lists its causes (one hover to understand why). */
export function Stat({ label, value, why }: { label: string; value: string; why?: Contributor[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative", display: "flex", justifyContent: "space-between", padding: "2px 0", cursor: why ? "help" : undefined, borderBottom: why ? "1px dotted rgba(255,255,255,0.15)" : undefined }}
      onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <span style={{ opacity: 0.8 }}>{label}</span><strong>{value}</strong>
      {open && why && why.length > 0 && (
        <div style={{ position: "absolute", left: "100%", top: 0, marginLeft: 8, width: 280, padding: 8, background: "#111827", border: "1px solid #444", borderRadius: 6, zIndex: 10, fontSize: 12 }}>
          {why.map((c, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><span>{c.label}</span><span>{c.value}</span></div>
          ))}
        </div>
      )}
    </div>
  );
}
