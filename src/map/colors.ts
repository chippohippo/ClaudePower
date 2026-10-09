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
