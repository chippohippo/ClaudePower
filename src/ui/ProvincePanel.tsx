import { useState } from "react";
import { BUILDINGS } from "../sim/defs";
import { TERRAINS } from "../sim/schemas";
import { DEV_KINDS } from "../sim/commands/player";
import { RES_COAL, RES_IRON, RES_OIL } from "../sim/setup";
import { useUi } from "./store";
import { fmtBig, fmtPct } from "./format";
import { ActionButton, btnStyle } from "./ActionButton";

const RES = { oil: RES_OIL, coal: RES_COAL, iron: RES_IRON } as const;

export function ProvincePanel() {
  const { setup, snap, selected, hovered, set } = useUi();
  const [type, setType] = useState(BUILDINGS.findIndex((b) => b.id === "consumer_factory"));
  const [levels, setLevels] = useState(20);
  const id = selected ?? hovered;
  if (!setup || !snap || id === null) return null;
  const owner = setup.countries[snap.owner[id]!]!;
  const mine = snap.owner[id] === setup.player && selected === id;
  const isCap = owner.capital === id;
  const devs = [snap.devTax[id]!, snap.devProd[id]!, snap.devMan[id]!];
  const buildable = BUILDINGS.map((b, i) => ({ b, i })).filter(({ b }) => !b.resource || setup.resources[id]! & RES[b.resource]);
  return (
    <div style={{ position: "absolute", bottom: 12, right: 12, width: 320, padding: 12, background: "rgba(15,17,26,0.95)", color: "#eee", borderRadius: 6, fontSize: 13, zIndex: 4, opacity: selected === null ? 0.85 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 14, height: 14, background: owner.color, display: "inline-block", border: "1px solid #000" }} />
        <strong>{setup.provinceNames[id]}</strong>{isCap && <span title="Capital">★</span>}
        {selected !== null && <button style={{ ...btnStyle, marginLeft: "auto" }} onClick={() => set({ selected: null })}>✕</button>}
      </div>
      <div>{owner.name} · {TERRAINS[setup.terrain[id]!]} · {fmtBig(snap.provPopulation[id]!)} people</div>
      <div>SoL {snap.provSol[id]!.toFixed(0)} · Unemployment {fmtPct(snap.provUnemployment[id]!)} · Unrest {snap.provUnrest[id]!.toFixed(1)}</div>
      <div style={{ marginTop: 6 }}>Development {snap.development[id]!.toFixed(0)}</div>
      {DEV_KINDS.map((k, kind) => (
        <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "2px 0" }}>
          <span>{k} {devs[kind]!.toFixed(1)}</span>
          {mine && <ActionButton cmd={{ type: "develop", payload: { province: id, kind } }}>+1 {["ADM", "DIP", "MIL"][kind]}</ActionButton>}
        </div>
      ))}
      {mine && (
        <div style={{ marginTop: 8, display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
          <select value={type} onChange={(e) => { setType(+e.target.value); e.target.blur(); }} style={{ background: "#2b2d42", color: "#eee", fontSize: 12 }}>
            {buildable.map(({ b, i }) => <option key={b.id} value={i}>{b.name}</option>)}
          </select>
          <input type="number" min={1} max={200} value={levels} onChange={(e) => setLevels(Math.max(1, Math.min(200, Math.round(+e.target.value || 1))))} onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur(); }} style={{ width: 52, background: "#2b2d42", color: "#eee", fontSize: 12 }} />
          <ActionButton cmd={{ type: "build", payload: { province: id, type, levels } }}>Build</ActionButton>
        </div>
      )}
      {!mine && selected === id && <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>Not your province.</div>}
      {selected === null && <div style={{ fontSize: 12, opacity: 0.6, marginTop: 4 }}>Click to select</div>}
    </div>
  );
}
