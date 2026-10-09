import { useEffect, useRef } from "react";
import geometry from "../../data/generated/map-geometry.json";
import { MapRenderer } from "../map/MapRenderer";
import { developmentColor, hexToNum } from "../map/colors";
import { useUi } from "./store";

export function MapView() {
  const el = useRef<HTMLDivElement>(null);
  const r = useRef<MapRenderer | null>(null);
  const { setup, snap, mapMode, set } = useUi();

  useEffect(() => {
    if (!setup || !el.current) return;
    const rings = setup.srcProvinceIds.map((id) => (geometry as number[][][])[id]!);
    const map = new MapRenderer(rings, { onHover: (p) => set({ hovered: p }), onSelect: (p) => set({ selected: p }) });
    let alive = true;
    map.mount(el.current).then(() => { if (alive) { r.current = map; (window as unknown as { __map: MapRenderer }).__map = map; paint(); } else map.destroy(); });
    return () => { alive = false; if (r.current === map) { map.destroy(); r.current = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setup]);

  const paint = () => {
    const s = useUi.getState();
    if (!r.current || !s.setup || !s.snap) return;
    const { owner, development } = s.snap;
    r.current.setColors(owner.map((o, i) => s.mapMode === "political" ? hexToNum(s.setup!.countries[o]!.color) : developmentColor(development[i]!)));
  };
  useEffect(paint, [snap, mapMode]);

  return <div ref={el} style={{ position: "absolute", inset: 0 }} />;
}
