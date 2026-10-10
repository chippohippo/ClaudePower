import { MAX_SPEED } from "../sim/speed";
import { useUi, type DockTab } from "./store";
import { Tip } from "./Tip";
import { btnStyle } from "./ActionButton";
import { fmtBig, fmtMoney } from "./format";

const MODES = [["political", "Political"], ["development", "Development"], ["population", "Population"], ["sol", "SoL"], ["unrest", "Unrest"], ["ig", "IG"]] as const;

export function TopBar() {
  const { snap, send, mapMode, set, dock, setup } = useUi();
  if (!snap || !setup) return null;
  const p = snap.player, me = setup.countries[setup.player]!;
  const toggle = (t: DockTab) => set({ dock: dock === t ? null : t });
  const res = { display: "inline-flex", gap: 4, alignItems: "center", padding: "0 4px" } as const;
  const delta = p.income - p.expense;
  return (
    <div style={{ position: "absolute", top: 0, left: 0, right: 0, display: "flex", gap: 10, alignItems: "center", padding: "6px 12px", background: "rgba(15,17,26,0.95)", color: "#eee", fontSize: 13, zIndex: 5, flexWrap: "wrap" }}>
      <span style={{ ...res, cursor: "pointer" }} onClick={() => toggle("government")}>
        <span style={{ width: 12, height: 12, background: me.color, display: "inline-block", border: "1px solid #000" }} /><strong>{me.name}</strong>
      </span>
      <span style={{ minWidth: 92 }}>{snap.dateLabel}</span>
      <button style={btnStyle} onClick={() => send({ kind: "setPaused", paused: !snap.paused })}>{snap.paused ? "▶" : "⏸"}</button>
      {Array.from({ length: MAX_SPEED }, (_, i) => i + 1).map((s) => (
        <button key={s} style={{ ...btnStyle, padding: "2px 6px", background: s === snap.speed ? "#8d99ae" : btnStyle.background }} onClick={() => send({ kind: "setSpeed", speed: s })}>{s}</button>
      ))}
      <Tip title="Treasury" rows={[{ label: "Income this month", value: fmtMoney(p.income) }, { label: "Expenses this month", value: fmtMoney(p.expense) }, ...p.why.tax!]}>
        <span style={{ ...res, cursor: "pointer" }} onClick={() => toggle("economy")}>💰 {fmtMoney(p.treasury)} <span style={{ color: delta >= 0 ? "#90be6d" : "#e76f51" }}>{delta >= 0 ? "+" : "−"}{fmtMoney(Math.abs(delta))}</span></span>
      </Tip>
      <Tip title={`ADM +${p.gains.adm.toFixed(1)}/month (cap 999)`} rows={p.why.adm!}><span style={res}>🏛 {Math.floor(p.adm)}</span></Tip>
      <Tip title={`DIP +${p.gains.dip.toFixed(1)}/month (cap 999)`} rows={[{ label: "Base", value: "+5 (interim until leaders)" }]}><span style={res}>🕊 {Math.floor(p.dip)}</span></Tip>
      <Tip title={`MIL +${p.gains.mil.toFixed(1)}/month (cap 999)`} rows={[{ label: "Base", value: "+5 (interim until leaders)" }]}><span style={res}>⚔ {Math.floor(p.mil)}</span></Tip>
      <Tip title={`Political power +${p.gains.pp.toFixed(1)}/month`} rows={p.why.pp!}><span style={{ ...res, cursor: "pointer" }} onClick={() => toggle("government")}>⚖ {Math.floor(p.pp)} PP</span></Tip>
      <Tip title="Manpower" rows={p.why.manpower!}><span style={res}>👥 {fmtBig(p.manpower)}</span></Tip>
      <Tip title="Stability (−3…+3) drifts toward its target" rows={p.why.stability!}><span style={{ ...res, cursor: "pointer", color: p.stability < -1 ? "#e76f51" : p.stability > 1 ? "#90be6d" : undefined }} onClick={() => toggle("government")}>⚓ {p.stability.toFixed(1)}</span></Tip>
      <button style={{ ...btnStyle, opacity: p.canUndo ? 1 : 0.4 }} disabled={!p.canUndo} title="Undo last action (Ctrl+Z) — only before time advances" onClick={() => send({ kind: "undo" })}>↶ Undo</button>
      <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
        {([["government", "F1 Gov"], ["economy", "F2 Economy"], ["population", "F3 Pop"], ["igs", "F4 IGs"], ["focus", "F5 Focus"]] as const).map(([t, l]) => (
          <button key={t} style={{ ...btnStyle, background: dock === t ? "#8d99ae" : btnStyle.background }} onClick={() => toggle(t)}>{l}</button>
        ))}
        <button style={btnStyle} onClick={() => set({ palette: true })} title="Search anything">⌘K</button>
      </span>
      <span style={{ display: "flex", gap: 4 }}>
        {MODES.map(([m, l], i) => (
          <button key={m} style={{ ...btnStyle, background: m === mapMode ? "#8d99ae" : btnStyle.background }} onClick={() => set({ mapMode: m })}>{i + 1} {l}</button>
        ))}
      </span>
    </div>
  );
}
