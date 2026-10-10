// Everything that can change is a modifier stack. value = (base + Σadd) × Π(1 + mult), clamped.
import type { World } from "./world";
import type { SimDate } from "./date";

export type StatKey = string;
/** "c:<id>" country, "p:<id>" province, "g" global. */
export type ScopeRef = string;
export type SourceRef = string;

export interface Modifier { target: StatKey; scope: ScopeRef; add?: number; mult?: number; source: SourceRef; expires?: SimDate }

export interface Contributor { source: SourceRef; add?: number; mult?: number; impact: number }
export interface StatBreakdown { value: number; base: number; contributors: Contributor[] }

export const STAT_CLAMPS: Record<StatKey, [number, number]> = {
  stability: [-3, 3],
  stability_target: [-3, 3],
  tax_efficiency: [0.2, 2],
  mobilisation: [0, 0.3],
  consumption: [0.3, 1.5],
};

/** Default base values for stats not set in world.base. */
export const STAT_DEFAULTS: Record<StatKey, number> = {
  fertility_mult: 1, tax_efficiency: 1, construction_cost: 1, investment_rate: 0.05, state_construction: 0.3,
  mobilisation: 0.01, arms_demand: 1, consumption: 1, adm_gain: 3, dip_gain: 3, mil_gain: 3, pp_gain: 2,
};

export function getStat(world: World, scope: ScopeRef, key: StatKey): StatBreakdown {
  const base = world.base[scope]?.[key] ?? STAT_DEFAULTS[key] ?? 0;
  const mods = world.modifiers.filter(
    (m) => m.target === key && (m.scope === scope || m.scope === "g") && (m.expires === undefined || m.expires > world.date),
  );
  let add = 0;
  let mult = 1;
  for (const m of mods) { add += m.add ?? 0; mult *= 1 + (m.mult ?? 0); }
  const raw = (base + add) * mult;
  const [lo, hi] = STAT_CLAMPS[key] ?? [-Infinity, Infinity];
  const value = Math.min(hi, Math.max(lo, raw));
  const contributors = mods
    .map((m) => ({
      source: m.source,
      ...(m.add !== undefined ? { add: m.add } : {}),
      ...(m.mult !== undefined ? { mult: m.mult } : {}),
      // impact: change to final value if this modifier were removed
      impact: Math.abs((m.add ?? 0) * mult + (base + add) * mult * ((m.mult ?? 0) / (1 + (m.mult ?? 0)))),
    }))
    .sort((a, b) => b.impact - a.impact);
  return { value, base, contributors };
}

/**
 * Fast per-country stat values (same formula as getStat, one pass over modifiers). Use in monthly loops;
 * getStat gives the breakdown for tooltips.
 */
export function countryStat(world: World, key: StatKey): Float64Array {
  const n = world.countries.size, add = new Float64Array(n), mult = new Float64Array(n).fill(1);
  let global = 0, gmult = 1;
  for (const m of world.modifiers) {
    if (m.target !== key || (m.expires !== undefined && m.expires <= world.date)) continue;
    if (m.scope === "g") { global += m.add ?? 0; gmult *= 1 + (m.mult ?? 0); continue; }
    if (m.scope.charCodeAt(0) !== 99 /* c */) continue;
    const c = +m.scope.slice(2);
    add[c]! += m.add ?? 0; mult[c]! *= 1 + (m.mult ?? 0);
  }
  const [lo, hi] = STAT_CLAMPS[key] ?? [-Infinity, Infinity];
  const out = new Float64Array(n);
  for (let c = 0; c < n; c++) {
    const base = world.base[`c:${c}`]?.[key] ?? STAT_DEFAULTS[key] ?? 0;
    out[c] = Math.min(hi, Math.max(lo, (base + add[c]! + global) * mult[c]! * gmult));
  }
  return out;
}

export function removeModifiersWhere(world: World, pred: (m: Modifier) => boolean): void {
  world.modifiers = world.modifiers.filter((m) => !pred(m));
}

export function removeModifiers(world: World, scope: ScopeRef, source: SourceRef): void {
  world.modifiers = world.modifiers.filter((m) => !(m.scope === scope && m.source === source));
}

export function addModifier(world: World, m: Modifier): void { world.modifiers.push(m); }

export function pruneExpired(world: World): void {
  world.modifiers = world.modifiers.filter((m) => m.expires === undefined || m.expires > world.date);
}
