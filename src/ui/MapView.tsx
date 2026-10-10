import { useEffect, useRef } from "react";
import geometry from "../../data/generated/map-geometry.json";
import { MapRenderer } from "../map/MapRenderer";
import { densityColor, developmentColor, hexToNum, lighten, relationColor, solColor, unrestColor } from "../map/colors";
import { useUi } from "./store";
import { IGS } from "../sim/igs";

export function MapView() {
  const el = useRef<HTMLDivElement>(null);
  const r = useRef<MapRenderer | null>(null);
  const lastColors = useRef<number[] | null>(null);
  const { setup, snap, mapMode, set } = useUi();

  useEffect(() => {
    if (!setup || !el.current) return;
    const rings = setup.srcProvinceIds.map((id) => (geometry as number[][][])[id]!);
    const map = new MapRenderer(rings, {
      onHover: (p) => set({ hovered: p }), onSelect: (p) => set({ selected: p }),
      onArmy: (id) => set({ selectedArmy: id, dock: "military" }),
      onRightClick: (p) => { const s = useUi.getState(); if (s.selectedArmy !== null) s.send({ kind: "command", cmd: { type: "move_army", payload: { army: s.selectedArmy, province: p } } }); },
    });
    let alive = true;
    lastColors.current = null;
    map.mount(el.current).then(() => { if (alive) { r.current = map; set({ jumpTo: (p: number) => { map.centerOn(p); map.select(p); } }); (window as unknown as { __map: MapRenderer }).__map = map; paint(); } else map.destroy(); });
    return () => { alive = false; if (r.current === map) { map.destroy(); r.current = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setup]);

  const paint = () => {
    const s = useUi.getState();
    if (!r.current || !s.setup || !s.snap) return;
    const { owner, development, provPopulation, provSol } = s.snap, setup = s.setup;
    const colors = owner.map((o, i) => {
      switch (s.mapMode) {
        case "political": return hexToNum(setup.countries[o]!.color);
        case "development": return developmentColor(development[i]!);
        case "population": return densityColor(provPopulation[i]! / setup.areaKm2[i]!);
        case "sol": return solColor(provSol[i]!);
        case "unrest": return unrestColor(s.snap!.provUnrest[i]!);
        case "ig": { const g = s.snap!.provIg[i]!; return g < 0 ? 0x888888 : hexToNum(IGS[g]!.color); }
        case "relations": { if (o === setup.player) return 0xffd60a; const r = s.snap!.diplomacy.find((d) => d.country === o); return r ? relationColor(r.rel, r.alliance, r.war) : 0x888888; }
        case "occupation": { const ctrl = s.snap!.controller[i]!; return ctrl !== o ? hexToNum(setup.countries[ctrl]!.color) : lighten(hexToNum(setup.countries[o]!.color), 0.6); }
      }
    });
    // Repaint only when a colour changed (most snapshots leave the political map untouched).
    const prev = lastColors.current;
    if (prev && prev.length === colors.length && prev.every((c, i) => c === colors[i])) return;
    lastColors.current = colors;
    r.current.setColors(colors);
  };
  useEffect(paint, [snap, mapMode]);
  const selectedArmy = useUi((st) => st.selectedArmy);
  useEffect(() => {
    const s = useUi.getState();
    if (!r.current || !s.snap || !s.setup) return;
    r.current.setArmies(s.snap.armies.filter((a) => a.country === s.setup!.player || s.snap!.diplomacy.find((d) => d.country === a.country)?.war || a.battle >= 0).map((a) => ({
      id: a.id, prov: a.prov, color: hexToNum(s.setup!.countries[a.country]!.color), label: `${Math.round(a.strength / 1000)}k`, selected: a.id === selectedArmy, battle: a.battle >= 0,
    })));
  }, [snap, selectedArmy]);

  return <div ref={el} style={{ position: "absolute", inset: 0 }} />;
}
