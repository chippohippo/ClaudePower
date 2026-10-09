// One-line-per-country text summary for headless runs.
import type { World } from "../src/sim/world";
import { formatDate } from "../src/sim/date";

export function worldSummary(w: World, tags: string[]): string {
  const cc = w.countries.cols;
  let pop = 0, urb = 0;
  for (let c = 0; c < w.countries.size; c++) { pop += cc.population![c]!; urb += cc.urban![c]! * cc.population![c]!; }
  let levels = 0;
  for (let i = 0; i < w.buildings.size; i++) levels += w.buildings.cols.level![i]!;
  const lines = [`== ${formatDate(w.date)}  world ${(pop / 1e9).toFixed(2)}B  urban ${(100 * urb / pop).toFixed(0)}%  pops ${w.pops.size}  buildings ${w.buildings.size} levels ${levels} projects ${w.projects.size}`];
  for (const t of tags) {
    const c = w.countryTags.indexOf(t);
    if (c < 0) continue;
    const gdpPc = cc.gdpYear![c]! / Math.max(1, cc.population![c]!) / 100;
    lines.push(`${t} pop ${(cc.population![c]! / 1e6).toFixed(0)}M gdp/c $${gdpPc.toFixed(0)} SoL ${cc.sol![c]!.toFixed(0)} LE ${cc.lifeExp![c]!.toFixed(0)} TFR ${cc.tfr![c]!.toFixed(1)} urb ${(100 * cc.urban![c]!).toFixed(0)}% lit ${(100 * cc.literacy![c]!).toFixed(0)}% unemp ${(100 * cc.unemployment![c]!).toFixed(0)}% infl ${(100 * cc.inflation![c]!).toFixed(1)}% debt/gdp ${(cc.debt![c]! / Math.max(1, cc.gdpYear![c]!)).toFixed(2)} tax ${(100 * cc.taxRate![c]!).toFixed(0)}% PL ${cc.priceLevel![c]!.toFixed(2)}`);
  }
  return lines.join("\n");
}
