// Static game definitions (goods, needs, buildings), validated once at import.
import goodsJson from "../../data/goods.json";
import needsJson from "../../data/needs.json";
import buildingsJson from "../../data/buildings.json";
import { BuildingsFile, GoodsFile, NEED_TIERS, NeedsFile, STRATA, type Stratum } from "./schemas";

export const GOODS = GoodsFile.parse(goodsJson);
export const N_GOODS = GOODS.length;
export const goodIndex = (id: string): number => {
  const i = GOODS.findIndex((g) => g.id === id);
  if (i < 0) throw new Error(`unknown good ${id}`);
  return i;
};
export const BASE_PRICE = Float64Array.from(GOODS.map((g) => g.basePrice));

/** Per-capita monthly need by tier as dense arrays over goods. */
const needs = NeedsFile.parse(needsJson);
export const NEEDS: Float64Array[] = NEED_TIERS.map((t) => {
  const a = new Float64Array(N_GOODS);
  for (const [g, q] of Object.entries(needs[t])) a[goodIndex(g)] = q;
  return a;
});

export const BUILDINGS = BuildingsFile.parse(buildingsJson);
export const buildingIndex = (id: string): number => BUILDINGS.findIndex((b) => b.id === id);
export const STRATUM: Record<Stratum, number> = Object.fromEntries(STRATA.map((s, i) => [s, i])) as Record<Stratum, number>;
export const N_STRATA = STRATA.length;

/** Dense production-method data: per building type, per PM. */
export interface PmData { year: number; jobs: Float64Array; inputs: Float64Array; outputs: Float64Array; name: string }
export const PMS: PmData[][] = BUILDINGS.map((b) => b.pms.map((pm) => {
  const jobs = new Float64Array(N_STRATA), inputs = new Float64Array(N_GOODS), outputs = new Float64Array(N_GOODS);
  for (const [s, n] of Object.entries(pm.jobs)) jobs[STRATUM[s as Stratum]] = n!;
  for (const [g, q] of Object.entries(pm.inputs)) inputs[goodIndex(g)] = q;
  for (const [g, q] of Object.entries(pm.outputs)) outputs[goodIndex(g)] = q;
  return { year: pm.year, jobs, inputs, outputs, name: pm.name };
}));

/** Construction basket per building level (units of goods). */
export const CONSTRUCTION_BASKET: [number, number][] = [[goodIndex("steel"), 15000], [goodIndex("tools"), 7000], [goodIndex("machinery"), 2500]];
