// Guided start: three goals for the first year, ticked off by the player's own actions.
import { useUi } from "./store";

const GOALS = [
  { event: "developed", text: "Develop a province — select one of yours and spend ADM, DIP or MIL" },
  { event: "law_enacted", text: "Enact a law — open Government (F1) and pick one you can afford" },
  { event: "construction_started", text: "Start a state construction — turn off Auto-construct in F1, then Build in a province" },
];

export function FirstSteps() {
  const { done, firstStepsDismissed, set, snap } = useUi();
  if (firstStepsDismissed || !snap) return null;
  const all = GOALS.every((g) => done.includes(g.event));
  return (
    <div style={{ position: "absolute", bottom: 12, left: 12, width: 340, padding: 10, background: "rgba(30,41,59,0.95)", color: "#eee", borderRadius: 6, fontSize: 12, zIndex: 3 }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}><strong>First steps {all ? "— done! 🎉" : "for 1936"}</strong>
        <button onClick={() => set({ firstStepsDismissed: true })} style={{ background: "none", color: "#aaa", border: "none", cursor: "pointer" }}>✕</button></div>
      {GOALS.map((g) => <div key={g.event} style={{ opacity: done.includes(g.event) ? 0.5 : 1 }}>{done.includes(g.event) ? "✅" : "⬜"} {g.text}</div>)}
      <div style={{ opacity: 0.6, marginTop: 4 }}>Space pauses · hover any number for why · Ctrl+K to search · Ctrl+Z undo</div>
    </div>
  );
}
