// Player/AI actions of the core loop. Every button in the UI issues one of these.
import { registerCommand, type Validation } from "../commands";
import { BUILDINGS, PMS } from "../defs";
import { LAWS, activeLaw, enactLaw } from "../laws";
import { getStat } from "../modifiers";
import { TERRAINS } from "../schemas";
import { AUTO_BUDGET, RES_COAL, RES_IRON, RES_OIL } from "../setup";
import { ensureCapacity, type World } from "../world";
import { basketCost } from "../systems/construction";
import { TAX_MAX, TAX_MIN } from "../systems/budget";

export const DEV_KINDS = ["Tax", "Production", "Manpower"] as const;
const DEV_COLS = ["devTax", "devProd", "devMan"] as const;
const POINT_COLS = ["adm", "dip", "mil"] as const;
const POINT_NAMES = ["ADM", "DIP", "MIL"] as const;
export const TERRAIN_DEV_COST: Record<string, number> = { plains: 1, forest: 1.1, hills: 1.2, marsh: 1.3, desert: 1.4, jungle: 1.4, mountains: 1.5, tundra: 1.5 };
export const DEV_BASE = 50, DEV_GROWTH = 0.05;
export const MAX_PLAYER_PROJECTS = 8;
const RES_FLAG: Record<string, number> = { oil: RES_OIL, coal: RES_COAL, iron: RES_IRON };
const ok: Validation = { ok: true };
const no = (reason: string): Validation => ({ ok: false, reason });

export function devCost(w: World, p: number, kind: number): number {
  const level = w.provinces.cols[DEV_COLS[kind]!]![p]!;
  const terrain = TERRAINS[w.provinces.cols.terrain![p]!]!;
  return Math.round(DEV_BASE * (1 + DEV_GROWTH) ** level * TERRAIN_DEV_COST[terrain]!);
}

/** Cheapest province to develop for a point type (used by auto-develop). */
export function cheapestDevelopment(w: World, c: number, kind: number): number {
  let best = -1, cost = Infinity;
  for (let p = 0; p < w.provinces.size; p++) {
    if (w.provinces.cols.owner![p] !== c) continue;
    const k = devCost(w, p, kind);
    if (k < cost) { cost = k; best = p; }
  }
  return cost <= w.countries.cols[POINT_COLS[kind]!]![c]! ? best : -1;
}

registerCommand<{ province: number; kind: number }>("develop", {
  validate({ actor, payload: { province, kind } }, w) {
    if (!(kind >= 0 && kind < 3)) return no("Unknown development type");
    if (w.provinces.cols.owner![province] !== actor) return no("You do not own this province");
    const cost = devCost(w, province, kind), have = w.countries.cols[POINT_COLS[kind]!]![actor]!;
    if (have < cost) return no(`Requires ${cost} ${POINT_NAMES[kind]} (you have ${Math.floor(have)})`);
    return ok;
  },
  apply({ actor, payload: { province, kind } }, w) {
    const cost = devCost(w, province, kind);
    w.countries.cols[POINT_COLS[kind]!]![actor]! -= cost;
    w.provinces.cols[DEV_COLS[kind]!]![province]! += 1;
    w.provinces.cols.development![province]! += 1;
    return [{ type: "developed", data: { province, kind } }];
  },
  preview({ payload: { province, kind } }, w) {
    const cost = devCost(w, province, kind);
    const effect = [
      "Tax efficiency here +3% (more of each wage and profit is collected)",
      "Productivity here +2% (all buildings), more subsistence food",
      "Manpower here +3%",
    ][kind]!;
    return [`Costs ${cost} ${POINT_NAMES[kind]} (base ${DEV_BASE} × ${(1 + DEV_GROWTH).toFixed(2)}^level × terrain)`, `+1 ${DEV_KINDS[kind]} development in ${w.provinceNames[province]}`, effect, `Next level will cost ${Math.round(cost * (1 + DEV_GROWTH))}`];
  },
});

/** State construction cost (cents) for `levels` of a building in country c. */
export function buildCost(w: World, c: number, levels: number): number {
  return Math.round(basketCost(w, c) * levels * getStat(w, `c:${c}`, "construction_cost").value);
}

registerCommand<{ province: number; type: number; levels: number }>("build", {
  validate({ actor, payload: { province, type, levels } }, w) {
    const def = BUILDINGS[type];
    if (!def) return no("Unknown building");
    if (w.provinces.cols.owner![province] !== actor) return no("You do not own this province");
    if (!(levels >= 1 && levels <= 200 && Number.isInteger(levels))) return no("Levels must be 1–200");
    if (def.resource && !(w.provinces.cols.res![province]! & RES_FLAG[def.resource]!)) return no(`Needs ${def.resource} deposits in this province`);
    let active = 0;
    for (let j = 0; j < w.projects.size; j++) if (w.projects.cols.country![j] === actor && w.projects.cols.state![j] === 1) active++;
    if (active >= MAX_PLAYER_PROJECTS) return no(`At most ${MAX_PLAYER_PROJECTS} state projects at once`);
    const cost = buildCost(w, actor, levels);
    if (w.countries.cols.treasury![actor]! < cost * 0.25) return no(`Treasury must hold 25% of the cost up front ($${fmt(cost * 0.25)})`);
    return ok;
  },
  apply({ actor, payload: { province, type, levels } }, w) {
    ensureCapacity(w.projects, w.projects.size + 1);
    const j = w.projects.size++, pc = w.projects.cols;
    pc.country![j] = actor; pc.prov![j] = province; pc.type![j] = type; pc.progress![j] = 0; pc.state![j] = 1; pc.levels![j] = levels;
    return [{ type: "construction_started", data: { province, type, levels } }];
  },
  preview({ actor, payload: { province, type, levels } }, w) {
    const def = BUILDINGS[type]!, pm = PMS[type]![0]!;
    const jobs = [...pm.jobs].reduce((a, b) => a + b, 0) * levels;
    return [`Cost ≈ $${fmt(buildCost(w, actor, levels))} of steel, tools and machinery, paid by the treasury as goods arrive`,
      `${def.name} ×${levels} in ${w.provinceNames[province]}: ~${Math.round(jobs).toLocaleString("en-US")} jobs`,
      def.owner === "state" ? `State-run: improves ${def.effect} in the province; staff paid from the budget` : "Profits go to local elites (dividends) and taxes"];
  },
});

registerCommand<{ project: number }>("cancel_project", {
  validate({ actor, payload: { project } }, w) {
    if (!(project >= 0 && project < w.projects.size) || w.projects.cols.country![project] !== actor || w.projects.cols.state![project] !== 1) return no("Not one of your state projects");
    return ok;
  },
  apply({ payload: { project } }, w) {
    for (const a of Object.values(w.projects.cols)) a.copyWithin(project, project + 1, w.projects.size);
    w.projects.size--;
    return [{ type: "construction_cancelled" }];
  },
  preview() { return ["Stops the project. Goods already delivered are lost."]; },
});

export const lawChangeCost = (w: World, c: number, cat: number, law: number) => {
  const base = LAWS[cat]!.laws[law]!.ppCost;
  const steps = Math.abs(law - activeLaw(w, c, cat));
  return Math.round(base * (1 + 0.5 * (steps - 1)));
};

registerCommand<{ category: number; law: number }>("set_law", {
  validate({ actor, payload: { category, law } }, w) {
    const cat = LAWS[category];
    if (!cat || !cat.laws[law]) return no("Unknown law");
    if (activeLaw(w, actor, category) === law) return no("Already in force");
    const cost = lawChangeCost(w, actor, category, law), pp = w.countries.cols.pp![actor]!;
    if (pp < cost) return no(`Requires ${cost} political power (you have ${Math.floor(pp)})`);
    return ok;
  },
  apply({ actor, payload: { category, law } }, w) {
    w.countries.cols.pp![actor]! -= lawChangeCost(w, actor, category, law);
    enactLaw(w, actor, category, law);
    return [{ type: "law_enacted", data: { category, law } }];
  },
  preview({ actor, payload: { category, law } }, w) {
    const l = LAWS[category]!.laws[law]!;
    const pop = w.countries.cols.population![actor]!;
    const fx = l.modifiers.map((m) => m.target === "education_spending"
      ? `Schooling costs ≈ $${fmt((m.add ?? 0) * pop)}/month at today's population (bought as services)`
      : `${m.target.replace(/_/g, " ")} ${m.add !== undefined ? (m.add > 0 ? "+" : "") + m.add : ""}${m.mult !== undefined ? `${m.mult > 0 ? "+" : ""}${Math.round(m.mult * 100)}%` : ""}`);
    return [`Costs ${lawChangeCost(w, actor, category, law)} PP (jumping several steps costs more)`, l.description, ...(fx.length ? fx : ["No modifiers (baseline)"]), "Replaces: " + LAWS[category]!.laws[activeLaw(w, actor, category)]!.name];
  },
});

export const stabilityCost = (w: World, c: number) => Math.round(100 + 40 * (w.countries.cols.stability![c]! + 3));
registerCommand<Record<string, never>>("raise_stability", {
  validate({ actor }, w) {
    const s = w.countries.cols.stability![actor]!;
    if (s >= 2.5) return no("Stability is already near maximum");
    const cost = stabilityCost(w, actor);
    if (w.countries.cols.adm![actor]! < cost) return no(`Requires ${cost} ADM (you have ${Math.floor(w.countries.cols.adm![actor]!)})`);
    return ok;
  },
  apply({ actor }, w) {
    w.countries.cols.adm![actor]! -= stabilityCost(w, actor);
    w.countries.cols.stability![actor] = Math.min(3, w.countries.cols.stability![actor]! + 0.5);
    return [{ type: "stability_raised" }];
  },
  preview({ actor }, w) {
    return [`Costs ${stabilityCost(w, actor)} ADM (more when already stable)`, "Stability +0.5 now; it then drifts toward its target", "Higher stability: more PP, less unrest"];
  },
});

registerCommand<{ flags: number }>("set_automation", {
  validate({ payload: { flags } }) { return Number.isInteger(flags) && flags >= 0 && flags <= 7 ? ok : no("Invalid automation flags"); },
  apply({ actor, payload: { flags } }, w) { w.countries.cols.automation![actor] = flags; return [{ type: "automation_changed" }]; },
  preview() { return ["Automated systems are run by the same logic as the AI; you can take over any time."]; },
});

registerCommand<{ rate: number }>("set_tax_rate", {
  validate({ actor, payload: { rate } }, w) {
    if (w.countries.cols.automation![actor]! & AUTO_BUDGET) return no("Turn off automatic budget first");
    if (!(rate >= TAX_MIN - 1e-9 && rate <= TAX_MAX + 1e-9)) return no(`Tax rate must be ${TAX_MIN * 100}–${TAX_MAX * 100}%`);
    return ok;
  },
  apply({ actor, payload: { rate } }, w) { w.countries.cols.taxRate![actor] = Math.round(rate * 100) / 100; return [{ type: "tax_changed" }]; },
  preview({ actor, payload: { rate } }, w) {
    const cur = w.countries.cols.taxRate![actor]!, delta = rate - cur;
    const taxes = w.budget.cols.income_tax![actor]! + w.budget.cols.profit_tax![actor]! + w.budget.cols.consumption_tax![actor]!;
    const change = taxes > 0 ? `≈ ${delta >= 0 ? "+" : "−"}$${fmt(Math.abs(taxes * (delta / Math.max(0.01, cur))))}/month in taxes` : "Revenue estimate available after the first month";
    return [`Tax rate ${Math.round(cur * 100)}% → ${Math.round(rate * 100)}%`, change, delta > 0 ? "Pops keep less of their wages: lower SoL" : "Pops keep more: higher SoL, smaller budget"];
  },
});

function fmt(cents: number): string {
  const d = cents / 100, a = Math.abs(d);
  return a >= 1e9 ? `${(d / 1e9).toFixed(1)}B` : a >= 1e6 ? `${(d / 1e6).toFixed(1)}M` : a >= 1e3 ? `${(d / 1e3).toFixed(0)}k` : d.toFixed(0);
}
