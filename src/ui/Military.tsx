// F7 Military: armies, recruitment, wars with war score and the peace-deal builder, battle reports.
import { useState } from "react";
import { ActionButton } from "./ActionButton";
import { useUi } from "./store";
import { fmtBig, fmtPct } from "./format";
import type { PlayerCommand } from "../worker/protocol";

type Term = PlayerCommand["payload"];
const h = { margin: "12px 0 4px", fontSize: 13, textTransform: "uppercase", letterSpacing: 0.5, opacity: 0.7 } as const;

export function Military() {
  const { snap, setup, selectedArmy, selected, set, jumpTo } = useUi();
  const [divs, setDivs] = useState(5);
  if (!snap || !setup) return null;
  const me = setup.player, m = snap.military, name = (c: number) => setup.countries[c]!.name;
  const mine = snap.armies.filter((a) => a.country === me);
  const recruitAt = selected !== null && snap.owner[selected] === me ? selected : setup.countries[me]!.capital;
  return (
    <>
      <div style={{ fontSize: 12 }}>Fielded {fmtBig(m.fielded)} / manpower {fmtBig(m.manpower)} · equipment {fmtPct(m.equip, 0)} · war exhaustion {m.exhaustion.toFixed(0)} · warheads {m.nukes}</div>
      <div style={h}>Armies</div>
      {mine.length === 0 && <div style={{ opacity: 0.6 }}>No armies.</div>}
      {mine.map((a) => (
        <div key={a.id} onClick={() => { set({ selectedArmy: a.id }); jumpTo(a.prov); }} style={{ padding: 4, margin: "2px 0", borderRadius: 4, cursor: "pointer", background: a.id === selectedArmy ? "rgba(255,214,10,0.15)" : "rgba(255,255,255,0.03)", fontSize: 12 }}>
          <strong>{Math.round(a.strength / 1000)}k</strong> in {setup.provinceNames[a.prov]} · org {fmtPct(a.org, 0)} {a.battle >= 0 ? "· ⚔ in battle" : a.target >= 0 ? `→ ${setup.provinceNames[a.target]}` : ""}
          <span style={{ float: "right", display: "flex", gap: 3 }} onClick={(e) => e.stopPropagation()}>
            <ActionButton cmd={{ type: "set_army_auto", payload: { army: a.id, auto: !a.auto } }}>{a.auto ? "Auto ✓" : "Manual"}</ActionButton>
            <ActionButton cmd={{ type: "disband", payload: { army: a.id } }}>✕</ActionButton>
          </span>
        </div>
      ))}
      <div style={{ fontSize: 11, opacity: 0.6 }}>Select an army, then right-click a province to move it (turns auto-command off).</div>
      <div style={{ display: "flex", gap: 4, alignItems: "center", marginTop: 6 }}>
        Recruit <input type="number" min={1} max={50} value={divs} onChange={(e) => setDivs(Math.max(1, Math.min(50, +e.target.value || 1)))} style={{ width: 48, background: "#2b2d42", color: "#eee" }} /> divisions in {setup.provinceNames[recruitAt]}
        <ActionButton cmd={{ type: "recruit", payload: { province: recruitAt, divisions: divs } }}>Recruit</ActionButton>
      </div>
      <div style={{ display: "flex", gap: 4, marginTop: 4 }}><ActionButton cmd={{ type: "build_nuke", payload: {} }}>Build warhead</ActionButton>
        {selected !== null && <ActionButton cmd={{ type: "launch_nuke", payload: { province: selected } }} style={{ background: "#5c1f1f" }}>☢ Strike {setup.provinceNames[selected]}</ActionButton>}</div>
      <div style={h}>Wars</div>
      {snap.wars.filter((x) => x.ours).length === 0 && <div style={{ opacity: 0.6 }}>At peace.</div>}
      {snap.wars.filter((x) => x.ours).map((war) => <WarCard key={war.id} id={war.id} />)}
      <div style={h}>Battle reports</div>
      {snap.battles.map((b) => (
        <div key={b.id} onClick={() => set({ battle: b.id })} style={{ fontSize: 12, cursor: "pointer", padding: "2px 0" }}>
          {b.winner === "ongoing" ? "⏳" : "📋"} {b.date} · {b.provName}: {name(b.attacker)} {Math.round(b.aStart / 1000)}k vs {name(b.defender)} {Math.round(b.dStart / 1000)}k {b.winner !== "ongoing" ? `→ ${b.winner} wins` : ""}
        </div>
      ))}
    </>
  );
}

function WarCard({ id }: { id: number }) {
  const { snap, setup } = useUi();
  const [terms, setTerms] = useState<Term[]>([]);
  const war = snap!.wars.find((x) => x.id === id)!;
  const me = setup!.player, name = (c: number) => setup!.countries[c]!.name;
  const ourScore = war.side === "attacker" ? war.score : -war.score;
  const enemy = war.side === "attacker" ? war.defenders[0]! : war.attackers[0]!;
  const occupied = snap!.controller.map((c, p) => [c, p] as const).filter(([c, p]) => snap!.owner[p] === enemy && (c === me || (war.side === "attacker" ? war.attackers : war.defenders).includes(c))).map(([, p]) => p);
  const toggle = (t: Term) => setTerms((cur) => { const k = JSON.stringify(t); return cur.some((x) => JSON.stringify(x) === k) ? cur.filter((x) => JSON.stringify(x) !== k) : [...cur, t]; });
  const has = (t: Term) => terms.some((x) => JSON.stringify(x) === JSON.stringify(t));
  return (
    <div style={{ padding: 8, margin: "4px 0", background: "rgba(139,0,0,0.15)", borderRadius: 4, fontSize: 12 }}>
      <strong>{war.name}</strong> (since {war.start})
      <div>{war.attackers.map(name).join(", ")} vs {war.defenders.map(name).join(", ")}</div>
      <div>War score (ours): <strong style={{ color: ourScore > 0 ? "#90be6d" : ourScore < 0 ? "#e76f51" : undefined }}>{ourScore.toFixed(0)}</strong> · goal {setup!.provinceNames[war.goal]}</div>
      <div style={{ marginTop: 4 }}>Peace terms:</div>
      {occupied.slice(0, 8).map((p) => <label key={p} style={{ display: "block" }}><input type="checkbox" checked={has({ type: "annex", province: p })} onChange={() => toggle({ type: "annex", province: p })} /> Annex {setup!.provinceNames[p]}</label>)}
      {(["reparations", "demilitarise", "change_government", "puppet"] as const).map((t) => <label key={t} style={{ display: "inline-block", marginRight: 8 }}><input type="checkbox" checked={has({ type: t })} onChange={() => toggle({ type: t })} /> {t.replace("_", " ")}</label>)}
      <div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap" }}>
        <ActionButton cmd={{ type: "offer_peace", payload: { war: id, terms } }}>Demand terms</ActionButton>
        <ActionButton cmd={{ type: "offer_peace", payload: { war: id, terms: [{ type: "white_peace" }] } }}>Offer white peace</ActionButton>
        <ActionButton cmd={{ type: "concede", payload: { war: id } }} style={{ background: "#5c1f1f" }}>Concede</ActionButton>
      </div>
    </div>
  );
}

export function BattleModal() {
  const { snap, setup, battle, set } = useUi();
  const b = snap?.battles.find((x) => x.id === battle);
  if (!b || !setup) return null;
  const name = (c: number) => setup.countries[c]!.name;
  const lost = (s: number, e: number) => `${Math.round((s - e) / 1000)}k (${Math.round((100 * (s - e)) / Math.max(1, s))}%)`;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 45, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => set({ battle: null })}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 480, padding: 16, background: "#f2ead8", color: "#222", borderRadius: 8, border: "3px double #6b5a3a", fontFamily: "Georgia, serif" }}>
        <h2 style={{ margin: "0 0 4px" }}>Battle of {b.provName}</h2>
        <div style={{ marginBottom: 8 }}>{b.date} · {b.winner === "ongoing" ? "still raging" : `${b.winner === "attacker" ? name(b.attacker) : name(b.defender)} victorious after ${Math.max(1, b.end - b.start)} days`}</div>
        <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
          <thead><tr><th align="left"></th><th align="right">{name(b.attacker)} (att.)</th><th align="right">{name(b.defender)} (def.)</th></tr></thead>
          <tbody>
            <tr><td>Strength at start</td><td align="right">{Math.round(b.aStart / 1000)}k</td><td align="right">{Math.round(b.dStart / 1000)}k</td></tr>
            <tr><td>Losses</td><td align="right">{lost(b.aStart, b.aEnd)}</td><td align="right">{lost(b.dStart, b.dEnd)}</td></tr>
            {b.modifiers.filter((m) => m.label !== "Men").map((m) => (
              <tr key={m.label} style={{ borderTop: "1px solid #c9bc9c" }}><td>{m.label}</td>
                <td align="right" style={{ fontWeight: m.attacker > m.defender ? 700 : 400 }}>×{m.attacker.toFixed(2)}</td>
                <td align="right" style={{ fontWeight: m.defender > m.attacker ? 700 : 400 }}>×{m.defender.toFixed(2)}</td></tr>
            ))}
          </tbody>
        </table>
        <div style={{ fontSize: 12, marginTop: 8, opacity: 0.8 }}>Daily losses scale with the enemy's combat power (men × all factors above) relative to yours, capped at 3% per day. A side retreats when its organisation falls below 25%.</div>
      </div>
    </div>
  );
}
