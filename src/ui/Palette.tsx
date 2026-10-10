// Ctrl+K: search provinces, countries, panels, laws and map modes; Enter to jump/open.
import { useEffect, useMemo, useRef, useState } from "react";
import { LAWS } from "../sim/laws";
import { useUi, type DockTab, type MapMode } from "./store";

interface Item { label: string; hint: string; run: () => void; also?: string[] }

export function Palette() {
  const { palette, setup, set, jumpTo } = useUi();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (palette) { setQ(""); setSel(0); setTimeout(() => input.current?.focus(), 0); } }, [palette]);
  const items = useMemo<Item[]>(() => {
    if (!setup) return [];
    const close = () => set({ palette: false });
    const dock = (d: DockTab) => () => { set({ dock: d }); close(); };
    const mode = (m: MapMode) => () => { set({ mapMode: m }); close(); };
    return [
      { label: "Government", hint: "panel · F1", run: dock("government") },
      { label: "Economy", hint: "panel · F2", run: dock("economy") },
      { label: "Population", hint: "panel · F3", run: dock("population") },
      { label: "Interest Groups", hint: "panel · F4", run: dock("igs") },
      { label: "National Focus", hint: "panel · F5", run: dock("focus") },
      { label: "Diplomacy", hint: "panel · F6", run: dock("diplomacy") },
      { label: "Military", hint: "panel · F7", run: dock("military") },
      { label: "Technology & Ideas", hint: "panel · F8", run: dock("tech") },
      ...(["political", "development", "population", "sol", "unrest", "ig", "relations", "occupation"] as const).map((m) => ({ label: `${m} map`, hint: "map mode", run: mode(m) })),
      ...LAWS.flatMap((c) => c.laws.map((l) => ({ label: l.name, hint: `law · ${c.name}`, run: dock("government") }))),
      ...setup.countries.map((c) => ({ label: c.name, hint: `country · ${c.tag}`, run: () => { jumpTo(c.capital); close(); } })),
      ...setup.provinceNames.map((n, i) => ({ label: n, also: setup.aka[i], hint: setup.aka[i]!.length ? `province · incl. ${setup.aka[i]!.slice(0, 3).join(", ")}` : "province", run: () => { jumpTo(i); close(); } })),
    ];
  }, [setup, set, jumpTo]);
  if (!palette) return null;
  const ql = q.toLowerCase();
  // Rank: exact name, then prefix, then substring; aliases (regions inside a province) count one step lower.
  const score = (i: Item) => {
    const names = [i.label, ...(i.also ?? [])].map((n) => n.toLowerCase());
    let best = 99;
    names.forEach((n, k) => {
      const s = n === ql ? 0 : n.startsWith(ql) ? 1 : n.includes(ql) ? 2 : 99;
      best = Math.min(best, s + (k > 0 && s < 99 ? 0.5 : 0));
    });
    return best;
  };
  const hits = (ql ? items.map((i) => [i, score(i)] as const).filter(([, s]) => s < 99).sort((a, b) => a[1] - b[1]).map(([i]) => i) : items).slice(0, 12);
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 50, display: "flex", justifyContent: "center", paddingTop: "12vh" }} onClick={() => set({ palette: false })}>
      <div style={{ width: 460, background: "#111827", border: "1px solid #444", borderRadius: 8, padding: 8, color: "#eee", height: "fit-content" }} onClick={(e) => e.stopPropagation()}>
        <input ref={input} value={q} placeholder="Search provinces, countries, laws, panels…" onChange={(e) => { setQ(e.target.value); setSel(0); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setSel((s) => Math.min(hits.length - 1, s + 1));
            else if (e.key === "ArrowUp") setSel((s) => Math.max(0, s - 1));
            else if (e.key === "Enter") hits[sel]?.run();
            else if (e.key === "Escape") set({ palette: false });
          }}
          style={{ width: "100%", padding: 8, background: "#1f2937", color: "#eee", border: "1px solid #555", borderRadius: 4, fontSize: 14, boxSizing: "border-box" }} />
        {hits.map((h, i) => (
          <div key={h.label + i} onClick={h.run} style={{ display: "flex", justifyContent: "space-between", padding: "4px 8px", background: i === sel ? "#374151" : undefined, borderRadius: 4, cursor: "pointer" }}>
            <span>{h.label}</span><span style={{ opacity: 0.6, fontSize: 12 }}>{h.hint}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
