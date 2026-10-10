import { useState, type ReactNode } from "react";

/** Generic hover tooltip with label/value rows (breakdowns). */
export function Tip({ rows, title, children }: { rows: { label: string; value: string }[]; title?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: "relative", cursor: "help" }} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      {children}
      {open && (
        <div style={{ position: "absolute", top: "100%", left: 0, marginTop: 6, width: 260, padding: 8, background: "#111827", border: "1px solid #444", borderRadius: 6, zIndex: 30, fontSize: 12, color: "#eee", fontWeight: 400 }}>
          {title && <div style={{ fontWeight: 600, marginBottom: 4 }}>{title}</div>}
          {rows.map((r, i) => <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><span>{r.label}</span><span>{r.value}</span></div>)}
        </div>
      )}
    </span>
  );
}
