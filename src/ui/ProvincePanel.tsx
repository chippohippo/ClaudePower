import { TERRAINS } from "../sim/schemas";
import { useUi } from "./store";

export function ProvincePanel() {
  const { setup, snap, selected, hovered, set } = useUi();
  const id = selected ?? hovered;
  if (!setup || !snap || id === null) return null;
  const owner = setup.countries[snap.owner[id]!]!;
  const isCap = owner.capital === id;
  return (
    <div style={{ position: "absolute", bottom: 12, left: 12, width: 300, padding: 12, background: "rgba(15,17,26,0.92)", color: "#eee", borderRadius: 6, fontSize: 14, zIndex: 2, opacity: selected === null ? 0.8 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 14, height: 14, background: owner.color, display: "inline-block", border: "1px solid #000" }} />
        <strong>{setup.provinceNames[id]}</strong>{isCap && <span title="Capital">★</span>}
      </div>
      <div>Owner: {owner.name} ({owner.tag})</div>
      <div>Terrain: {TERRAINS[setup.terrain[id]!]}</div>
      <div>Development: {snap.development[id]!.toFixed(0)}</div>
      <div>Neighbours: {setup.neighbors[id]!.map((n) => (
        <a key={n} href="#" style={{ color: "#8ecae6", marginRight: 6 }} onClick={(e) => { e.preventDefault(); set({ selected: n }); }}>{setup.provinceNames[n]}</a>
      ))}</div>
    </div>
  );
}
