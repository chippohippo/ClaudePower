// F4 Interest Groups: clout, approval (with breakdown), radicalism, leader, privileges, suppress / co-opt.
import { IGS } from "../sim/igs";
import { ActionButton } from "./ActionButton";
import { CharacterCard } from "./People";
import { Tip } from "./Tip";
import { useUi } from "./store";

const IDEO = ["Democratic", "Fascist", "Communist", "Non-aligned"];
const bar = (v: number, color: string, w = 120) => <span style={{ display: "inline-block", width: w, height: 6, background: "#333", borderRadius: 3, verticalAlign: "middle" }}><span style={{ display: "block", width: `${Math.max(0, Math.min(100, v))}%`, height: 6, background: color, borderRadius: 3 }} /></span>;

export function Igs() {
  const pol = useUi((s) => s.snap?.politics);
  const year = useUi((s) => (s.snap ? +s.snap.dateLabel.slice(-4) : 1936));
  if (!pol) return null;
  const order = pol.igs.map((g, i) => [g, i] as const).sort((a, b) => b[0].clout - a[0].clout);
  const totalScore = pol.electionScores.reduce((a, b) => a + b, 0) || 1;
  return (
    <>
      <div style={{ fontSize: 12, margin: "6px 0" }}>Population ideology: {pol.ideology.map((x, i) => `${IDEO[i]} ${(100 * x).toFixed(0)}%`).join(" · ")}</div>
      {order.map(([g, i]) => (
        <div key={i} style={{ margin: "8px 0", padding: 8, borderLeft: `4px solid ${IGS[i]!.color}`, background: "rgba(255,255,255,0.03)", borderRadius: 4 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <strong>{IGS[i]!.name}</strong>
            <span>{(100 * g.clout).toFixed(1)}% clout {pol.government === "democracy" && <span style={{ opacity: 0.7 }}>· vote {(100 * pol.electionScores[i]! / totalScore).toFixed(0)}%</span>}</span>
          </div>
          <div style={{ fontSize: 12 }}>
            <Tip title="Approval (target; moves ~8%/month)" rows={g.parts.filter((p) => p.value !== 0).map((p) => ({ label: p.label, value: `${p.value > 0 ? "+" : ""}${p.value.toFixed(1)}` }))}>
              Approval <strong style={{ color: g.approval > 20 ? "#90be6d" : g.approval < -20 ? "#e76f51" : undefined }}>{g.approval.toFixed(0)}</strong>
            </Tip>
            {" · "}Radicalism {bar(g.radicalism, g.radicalism > 40 ? "#e76f51" : "#ffb703", 80)} {g.radicalism.toFixed(0)}
            {g.strikes > 0 && <span style={{ color: "#e76f51" }}> · ✊ striking</span>}
            <span style={{ opacity: 0.7 }}> · {IDEO[["dem", "fas", "com", "non"].indexOf(IGS[i]!.ideology)]}</span>
          </div>
          {g.leader && <CharacterCard c={g.leader} title="Leader" year={year} />}
          <div style={{ fontSize: 12, opacity: 0.85 }} title={IGS[i]!.privileges[0]!.description}>Privilege: {IGS[i]!.privileges[0]!.name} {g.privilege ? "✅ granted" : ""}</div>
          <div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap" }}>
            {g.privilege
              ? <ActionButton cmd={{ type: "revoke_privilege", payload: { ig: i } }}>Revoke privilege</ActionButton>
              : <ActionButton cmd={{ type: "grant_privilege", payload: { ig: i } }}>Grant privilege</ActionButton>}
            <ActionButton cmd={{ type: "co_opt_ig", payload: { ig: i } }}>Co-opt</ActionButton>
            <ActionButton cmd={{ type: "suppress_ig", payload: { ig: i } }}>Suppress</ActionButton>
          </div>
        </div>
      ))}
    </>
  );
}
