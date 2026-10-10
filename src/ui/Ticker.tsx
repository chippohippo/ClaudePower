// Headline ticker (§14): newspaper strip of era-flavoured headlines from real sim events.
import { useUi } from "./store";

export function Ticker() {
  const items = useUi((s) => s.snap?.headlines);
  if (!items?.length) return null;
  const text = items.join("   ✦   ");
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 22, background: "#e8dfc8", color: "#2a241a", fontFamily: "Georgia, serif", fontSize: 13, overflow: "hidden", zIndex: 2, borderTop: "1px solid #8a7a5a" }}>
      <div style={{ whiteSpace: "nowrap", display: "inline-block", paddingLeft: "100%", animation: `ticker ${Math.max(30, text.length / 6)}s linear infinite`, lineHeight: "22px" }}>📰 {text}</div>
      <style>{"@keyframes ticker { from { transform: translateX(0); } to { transform: translateX(-100%); } }"}</style>
    </div>
  );
}
