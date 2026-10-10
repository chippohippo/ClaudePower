// A button that issues a Command. Greyed out with the reason from Command.validate; hovering shows the
// action preview (effects before committing).
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { PlayerCommand } from "../worker/protocol";
import { cmdKey, requestPreview, useUi } from "./store";

export const btnStyle: CSSProperties = { padding: "2px 8px", background: "#2b2d42", color: "#eee", border: "1px solid #555", borderRadius: 4, cursor: "pointer", fontSize: 12 };

export function ActionButton({ cmd, children, style, onDone }: { cmd: PlayerCommand; children: ReactNode; style?: CSSProperties; onDone?: () => void }) {
  const key = cmdKey(cmd);
  const preview = useUi((s) => s.previews[key]);
  // Refresh previews once per game month (and after any action), not every tick.
  const month = useUi((s) => (s.snap ? Math.floor(s.snap.date / 30) : 0));
  const rev = useUi((s) => s.snap?.rev);
  const [hover, setHover] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  useEffect(() => { requestPreview(cmd); }, [key, month, rev]); // eslint-disable-line react-hooks/exhaustive-deps
  const disabled = preview ? !preview.ok : true;
  return (
    <span style={{ position: "relative", display: "inline-block" }} onMouseEnter={(e) => { setAlignRight(e.currentTarget.getBoundingClientRect().left > innerWidth / 2); setHover(true); }} onMouseLeave={() => setHover(false)}>
      <button
        style={{ ...btnStyle, ...style, opacity: disabled ? 0.45 : 1, cursor: disabled ? "not-allowed" : "pointer" }}
        disabled={disabled}
        onClick={() => { useUi.getState().send({ kind: "command", cmd }); onDone?.(); }}
      >{children}</button>
      {hover && preview && (
        <div style={{ position: "absolute", bottom: "100%", ...(alignRight ? { right: 0 } : { left: 0 }), marginBottom: 4, width: 300, padding: 8, background: "#111827", border: "1px solid #444", borderRadius: 6, zIndex: 20, fontSize: 12, color: "#eee", pointerEvents: "none" }}>
          {!preview.ok && <div style={{ color: "#f4a261", marginBottom: 4 }}>✖ {preview.reason}</div>}
          {preview.effects.map((e, i) => <div key={i}>• {e}</div>)}
        </div>
      )}
    </span>
  );
}
