// Number formatting for panels (money is integer cents in the sim).
export const fmtInt = (n: number) => Math.round(n).toLocaleString("en-US");
export function fmtBig(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return n.toFixed(0);
}
/** Cents → dollars, abbreviated. */
export const fmtMoney = (cents: number) => `$${fmtBig(cents / 100)}`;
export const fmtPct = (x: number, d = 1) => `${(100 * x).toFixed(d)}%`;
