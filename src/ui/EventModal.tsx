// Event pop-up: description, 2–3 choices, each with its previewed effects (no hidden gotchas).
import { useUi } from "./store";
import { btnStyle } from "./ActionButton";

export function EventModal() {
  const ev = useUi((s) => s.snap?.events[0]);
  const send = useUi((s) => s.send);
  if (!ev) return null;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 45, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: 460, padding: 16, background: "#f2ead8", color: "#222", borderRadius: 8, border: "3px double #6b5a3a", fontFamily: "Georgia, serif", boxShadow: "0 8px 30px rgba(0,0,0,0.5)" }}>
        <h2 style={{ margin: "0 0 8px", fontSize: 20 }}>{ev.title}</h2>
        <p style={{ margin: "0 0 12px", lineHeight: 1.4 }}>{ev.description}</p>
        {ev.choices.map((c, i) => (
          <button key={i} onClick={() => send({ kind: "command", cmd: { type: "choose_event", payload: { pending: ev.id, choice: i } } })}
            style={{ ...btnStyle, display: "block", width: "100%", textAlign: "left", margin: "6px 0", padding: 8, background: "#3d3a33", fontSize: 13 }}>
            <strong>{c.name}</strong>
            {c.effects.map((e, k) => <div key={k} style={{ fontSize: 12, opacity: 0.85 }}>• {e}</div>)}
          </button>
        ))}
      </div>
    </div>
  );
}
