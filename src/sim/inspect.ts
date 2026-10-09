// Read-only country report for the UI panels: every number traces to the model (§0 "simulation is honest").
import { BUILDINGS, GOODS, N_GOODS, PMS } from "./defs";
import { getStat } from "./modifiers";
import { popSize } from "./pops";
import { STRATA } from "./schemas";
import { BUDGET_LINES, type World } from "./world";
import { toYmd } from "./date";
import { medicine, schooling, TFR_FLOOR, TFR_RANGE } from "./systems/demography";
import { HISTORY_KEYS } from "./systems/stats";
import { consumerPriceIndex } from "./systems/budget";

export interface Contributor { label: string; value: string }
export interface CountryReport {
  tag: string;
  stats: Record<string, number>;
  strata: { name: string; size: number; sol: number; literacy: number; wage: number; unemployment: number }[];
  cultures: { name: string; size: number }[];
  religions: { name: string; size: number }[];
  ages: [number, number, number];
  budget: { line: string; value: number }[];
  market: { good: string; price: number; base: number; supply: number; demand: number }[];
  sectors: { name: string; levels: number; staffing: number; revenue: number; profit: number; pm: string }[];
  explain: Record<string, Contributor[]>;
  history: { years: number[]; series: Record<string, number[]> };
}

const pct = (x: number) => `${(100 * x).toFixed(1)}%`;

export function inspectCountry(w: World, c: number): CountryReport {
  const cc = w.countries.cols, p = w.pops.cols;
  const stats: Record<string, number> = {};
  for (const k of ["population", "gdpYear", "sol", "urban", "literacy", "lifeExp", "tfr", "inflation", "unemployment", "debt", "treasury", "taxRate", "priceLevel", "pensionRate", "income", "expense", "investPool"]) stats[k] = cc[k]![c]!;
  stats.gdpPerCapita = stats.gdpYear! / Math.max(1, stats.population!);
  stats.cpi = consumerPriceIndex(w, c);

  const st = STRATA.map((name) => ({ name, size: 0, sol: 0, literacy: 0, wage: cc[`wage${STRATA.indexOf(name)}`]![c]!, unemployment: 0, adults: 0, emp: 0 }));
  const cul = new Map<number, number>(), rel = new Map<number, number>();
  const ages: [number, number, number] = [0, 0, 0];
  let health = 0, pop = 0;
  for (let i = 0; i < w.pops.size; i++) {
    if (w.provinces.cols.owner![p.prov![i]!] !== c) continue;
    const s = popSize(w, i), r = st[p.stratum![i]!]!;
    r.size += s; r.sol += p.sol![i]! * s; r.literacy += p.literacy![i]! * s; r.adults += p.a1![i]!; r.emp += p.employed![i]!;
    cul.set(p.culture![i]!, (cul.get(p.culture![i]!) ?? 0) + s);
    rel.set(p.religion![i]!, (rel.get(p.religion![i]!) ?? 0) + s);
    ages[0] += p.a0![i]!; ages[1] += p.a1![i]!; ages[2] += p.a2![i]!;
    health += p.health![i]! * s; pop += s;
  }
  const strata = st.map((r) => ({ name: r.name, size: r.size, sol: r.size ? r.sol / r.size : 0, literacy: r.size ? r.literacy / r.size : 0, wage: r.wage, unemployment: r.adults ? 1 - r.emp / r.adults : 0 }));
  const top = (m: Map<number, number>, names: string[], n: number) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ name: names[k] ?? `#${k}`, size: v }));

  const budget = BUDGET_LINES.map((line) => ({ line, value: w.budget.cols[line]![c]! })).filter((l) => l.value !== 0);

  const market = GOODS.map((g, k) => {
    const m = c * N_GOODS + k;
    return { good: g.name, price: w.markets.cols.price![m]!, base: g.basePrice * cc.priceLevel![c]!, supply: w.markets.cols.supply![m]!, demand: w.markets.cols.demand![m]! };
  });

  const sec = BUILDINGS.map((b) => ({ name: b.name, levels: 0, staffing: 0, revenue: 0, profit: 0, pm: "", pmLevels: new Map<string, number>() }));
  const b = w.buildings.cols;
  for (let i = 0; i < w.buildings.size; i++) {
    if (w.provinces.cols.owner![b.prov![i]!] !== c) continue;
    const r = sec[b.type![i]!]!, lv = b.level![i]!, pm = PMS[b.type![i]!]![b.pm![i]!]!.name;
    r.levels += lv; r.staffing += b.staffing![i]! * lv; r.revenue += b.revenue![i]!; r.profit += b.profit![i]!;
    r.pmLevels.set(pm, (r.pmLevels.get(pm) ?? 0) + lv);
  }
  const sectors = sec.filter((r) => r.levels > 0).map((r) => ({
    name: r.name, levels: r.levels, staffing: r.staffing / r.levels, revenue: r.revenue, profit: r.profit,
    pm: [...r.pmLevels].sort((a, b2) => b2[1] - a[1])[0]![0],
  }));

  const year = toYmd(w.date).year, lit = stats.literacy!, urb = stats.urban!, sol = stats.sol!;
  const fert = getStat(w, `c:${c}`, "fertility_mult");
  const explain: Record<string, Contributor[]> = {
    tfr: [
      { label: "Baseline", value: `${TFR_FLOOR.toFixed(1)} + ${TFR_RANGE.toFixed(1)} × factors` },
      { label: `Literacy ${pct(lit)}`, value: `×${(1 - 0.6 * lit).toFixed(2)}` },
      { label: `Urbanisation ${pct(urb)}`, value: `×${(1 - 0.3 * urb).toFixed(2)}` },
      { label: `Standard of living ${sol.toFixed(0)}`, value: `×${(1 - 0.65 * sol / 100).toFixed(2)}` },
      ...fert.contributors.map((x) => ({ label: x.source, value: x.mult !== undefined ? `×${(1 + x.mult).toFixed(2)}` : `+${x.add}` })),
    ],
    lifeExp: [
      { label: "Global medicine", value: medicine(year).toFixed(2) },
      { label: "Average health", value: (pop ? health / pop : 0).toFixed(2) },
      { label: `Standard of living ${sol.toFixed(0)}`, value: "raises health target" },
      { label: "Hospitals", value: `${sec.find((s) => s.name === "Hospital")?.levels ?? 0} levels` },
    ],
    literacy: [
      { label: "Global schooling reach", value: schooling(year).toFixed(2) },
      { label: `Standard of living ${sol.toFixed(0)}`, value: "raises literacy target" },
      { label: "Universities", value: `${sec.find((s) => s.name === "University")?.levels ?? 0} levels` },
    ],
    sol: strata.filter((s) => s.size > 0).sort((a, b2) => b2.size - a.size).map((s) => ({ label: `${s.name} (${pct(s.size / Math.max(1, pop))})`, value: `SoL ${s.sol.toFixed(0)}` })),
    inflation: [
      { label: "Price level", value: stats.priceLevel!.toFixed(3) },
      { label: "Consumer prices vs base", value: stats.cpi!.toFixed(2) },
      { label: "Debt / GDP", value: (stats.debt! / Math.max(1, stats.gdpYear!)).toFixed(2) },
      { label: "Printing and borrowing push prices up; monetary policy offsets deflation", value: "" },
    ],
    gdp: sectors.sort((a, b2) => b2.revenue - a.revenue).slice(0, 8).map((s) => ({ label: s.name, value: `revenue ${(s.revenue / 100 / 1e6).toFixed(0)}M/mo` })),
  };

  const series: Record<string, number[]> = {};
  for (const k of HISTORY_KEYS) series[k] = w.history.series[k]?.[c] ?? [];
  return {
    tag: w.countryTags[c]!, stats, strata, cultures: top(cul, w.cultures, 8), religions: top(rel, w.religions, 6), ages,
    budget, market, sectors, explain, history: { years: w.history.year, series },
  };
}
