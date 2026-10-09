// Minimal SVG line chart for yearly history series.
export function LineChart({ years, values, label, format, color = "#8ecae6" }: {
  years: number[]; values: number[]; label: string; format: (v: number) => string; color?: string;
}) {
  const W = 260, H = 70, pad = 4;
  if (values.length < 2) return <div style={{ fontSize: 12, opacity: 0.7 }}>{label}: history builds yearly…</div>;
  const lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1;
  const x = (i: number) => pad + (i * (W - 2 * pad)) / (values.length - 1);
  const y = (v: number) => H - pad - ((v - lo) * (H - 2 * pad)) / span;
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
        <span>{label}</span><span>{format(values[values.length - 1]!)}</span>
      </div>
      <svg width={W} height={H} style={{ background: "rgba(255,255,255,0.04)", borderRadius: 4 }}>
        <title>{`${label}: ${years[0]}–${years[years.length - 1]}, ${format(lo)} – ${format(hi)}`}</title>
        <path d={d} fill="none" stroke={color} strokeWidth={1.5} />
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, opacity: 0.6 }}>
        <span>{years[0]}</span><span>{years[years.length - 1]}</span>
      </div>
    </div>
  );
}
