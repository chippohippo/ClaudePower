import { useEffect, useRef } from "react";
import geometry from "../../data/generated/map-geometry.json";
import { MapRenderer } from "../map/MapRenderer";
import { densityColor, developmentColor, hexToNum, solColor, unrestColor } from "../map/colors";
import { useUi } from "./store";

export function MapView() {
  const el = useRef<HTMLDivElement>(null);
  const r = useRef<MapRenderer | null>(null);
  const lastColors = useRef<number[] | null>(null);
  const { setup, snap, mapMode, set } = useUi();

  useEffect(() => {
    if (!setup || !el.current) return;
    const rings = setup.srcProvinceIds.map((id) => (geometry as number[][][])[id]!);
    const map = new MapRenderer(rings, { onHover: (p) => set({ hovered: p }), onSelect: (p) => set({ selected: p }) });
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
      }
    });
    // Repaint only when a colour changed (most snapshots leave the political map untouched).
    const prev = lastColors.current;
    if (prev && prev.length === colors.length && prev.every((c, i) => c === colors[i])) return;
    lastColors.current = colors;
    r.current.setColors(colors);
  };
  useEffect(paint, [snap, mapMode]);

  return <div ref={el} style={{ position: "absolute", inset: 0 }} />;
}
