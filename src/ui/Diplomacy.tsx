// F6 Diplomacy: relations with every nation, treaties, claims, and actions (all Commands with previews).
import { useState } from "react";
import { ActionButton } from "./ActionButton";
import { useUi } from "./store";
import { fmtBig } from "./format";

export function Diplomacy() {
  const { snap, setup, selected } = useUi();
  const [q, setQ] = useState("");
  const [focus, setFocus] = useState<number | null>(null);
  if (!snap || !setup) return null;
  const name = (c: number) => setup.countries[c]!.name;
  const rows = [...snap.diplomacy].filter((d) => !q || name(d.country).toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => Number(b.war) - Number(a.war) || Number(b.alliance) - Number(a.alliance) || Number(b.rival) - Number(a.rival) || b.power - a.power);
  const sel = focus ?? (selected !== null && snap.owner[selected] !== setup.player ? snap.owner[selected]! : null);
  const d = sel !== null ? snap.diplomacy.find((x) => x.country === sel) : undefined;
  const selProv = selected !== null && snap.owner[selected] !== setup.player ? selected : null;
  return (
    <>
      <div style={{ fontSize: 12, margin: "4px 0" }}>Rivals: {snap.rivals.map(name).join(", ") || "none"} · Claims: {snap.claims.map((p) => setup.provinceNames[p]).join(", ") || "none"}</div>
      {d && (
        <div style={{ padding: 8, margin: "6px 0", background: "rgba(255,255,255,0.05)", borderRadius: 4 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}><strong>{name(d.country)}</strong><span>relations {Math.round(d.rel)}</span></div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>{[d.alliance && "allied", d.trade && "trade agreement", d.weGuarantee && "we guarantee them", d.guaranteesUs && "they guarantee us", d.truce && "truce", d.war && "AT WAR", d.rival && "rival", d.puppet && "our puppet", d.overlord && "our overlord"].filter(Boolean).join(" · ") || "no treaties"} · army power {fmtBig(d.power)}</div>
          <div style={{ fontSize: 12 }}>Casus belli: {d.cb ?? "none"}</div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
            <ActionButton cmd={{ type: "improve_relations", payload: { target: d.country } }}>Improve relations</ActionButton>
            <ActionButton cmd={{ type: "propose_trade", payload: { target: d.country } }}>Trade deal</ActionButton>
            {d.alliance ? <ActionButton cmd={{ type: "break_alliance", payload: { target: d.country } }}>Break alliance</ActionButton> : <ActionButton cmd={{ type: "propose_alliance", payload: { target: d.country } }}>Alliance</ActionButton>}
            <ActionButton cmd={{ type: "guarantee", payload: { target: d.country } }}>Guarantee</ActionButton>
            {selProv !== null && snap.owner[selProv] === d.country && <ActionButton cmd={{ type: "fabricate_claim", payload: { province: selProv } }}>Claim {setup.provinceNames[selProv]}</ActionButton>}
            <ActionButton cmd={{ type: "declare_war", payload: { target: d.country } }} style={{ background: "#5c1f1f" }}>Declare war</ActionButton>
          </div>
        </div>
      )}
      <input placeholder="Filter nations…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: "100%", padding: 4, background: "#1f2937", color: "#eee", border: "1px solid #555", borderRadius: 4, boxSizing: "border-box" }} />
      <table style={{ width: "100%", fontSize: 12, marginTop: 4 }}>
        <tbody>
          {rows.slice(0, 60).map((r) => (
            <tr key={r.country} onClick={() => setFocus(r.country)} style={{ cursor: "pointer", background: r.country === sel ? "rgba(255,214,10,0.12)" : undefined }}>
              <td><span style={{ display: "inline-block", width: 10, height: 10, background: setup.countries[r.country]!.color, marginRight: 4 }} />{name(r.country)}</td>
              <td align="right" style={{ color: r.rel > 50 ? "#90be6d" : r.rel < -50 ? "#e76f51" : undefined }}>{Math.round(r.rel)}</td>
              <td>{r.war ? "⚔" : r.alliance ? "🤝" : r.trade ? "⚖" : ""}{r.rival ? " 🎯" : ""}{r.cb ? " 📜" : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ fontSize: 11, opacity: 0.6 }}>⚔ war · 🤝 ally · ⚖ trade · 🎯 rival · 📜 you have a casus belli · select a foreign province on the map to claim it</div>
    </>
  );
}
