// Map-mode colour functions (pure, testable).
export const hexToNum = (h: string) => parseInt(h.slice(1), 16);

/** Development 0..20 → pale yellow to deep green. */
export function developmentColor(dev: number): number {
  const t = Math.max(0, Math.min(1, dev / 20));
  const r = Math.round(240 - 200 * t), g = Math.round(230 - 90 * t), b = Math.round(160 - 110 * t);
  return (r << 16) | (g << 8) | b;
}

export function lighten(c: number, amt: number): number {
  const ch = (s: number) => Math.min(255, Math.round(((c >> s) & 255) + (255 - ((c >> s) & 255)) * amt));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** Sequential ramp (light → dark) for t in 0..1. */
export function ramp(t: number, from: [number, number, number], to: [number, number, number]): number {
  t = Math.max(0, Math.min(1, t));
  const ch = (i: number) => Math.round(from[i]! + (to[i]! - from[i]!) * t);
  return (ch(0) << 16) | (ch(1) << 8) | ch(2);
}
/** Population density (people/km²), log scale. */
export const densityColor = (density: number) => ramp(Math.log10(1 + density) / 3, [245, 238, 220], [120, 30, 60]);
/** SoL 0..100: red → yellow → green (diverging around 50). */
export function solColor(sol: number): number {
  return sol < 50 ? ramp(sol / 50, [178, 34, 34], [240, 220, 120]) : ramp((sol - 50) / 50, [240, 220, 120], [34, 120, 60]);
}
/** Unrest 0..10: pale → deep red. */
export const unrestColor = (u: number) => ramp(u / 8, [235, 235, 225], [150, 20, 20]);
