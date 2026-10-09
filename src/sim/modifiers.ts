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
  tax_efficiency: [0, 2],
};

export function getStat(world: World, scope: ScopeRef, key: StatKey): StatBreakdown {
  const base = world.base[scope]?.[key] ?? 0;
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

export function addModifier(world: World, m: Modifier): void { world.modifiers.push(m); }

export function pruneExpired(world: World): void {
  world.modifiers = world.modifiers.filter((m) => m.expires === undefined || m.expires > world.date);
}
