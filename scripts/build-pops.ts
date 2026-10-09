// Generates data/generated/pops-1936.json: pop groups and starting buildings per province
// from data/start/countries-1936.json (country/region-level estimates).
import { readFileSync, writeFileSync } from "node:fs";
import { CountriesStartFile, ProvincesFile, REGION_NAMES, ResourcesFile, STRATA, type RegionStartDef } from "../src/sim/schemas";
import { BASE_PRICE, BUILDINGS, CONSTRUCTION_BASKET, GOODS, N_GOODS, NEEDS, PMS, STRATUM, buildingIndex, goodIndex } from "../src/sim/defs";
import { provinceProductivity } from "../src/sim/systems/production";
import { SPEND_RATE } from "../src/sim/systems/consumption";
import { regionOf } from "./map-rules";

const MAX_COMBOS = 5;
const MIN_GROUP = 2000;
const read = (f: string) => JSON.parse(readFileSync(f, "utf8"));
const start = CountriesStartFile.parse(read("data/start/countries-1936.json"));
const { provinces, capitals } = ProvincesFile.parse(read("data/generated/provinces.json"));
const resources = ResourcesFile.parse(read("data/start/resources.json"));
const has = (r: keyof typeof resources, lon: number, lat: number) => resources[r].some(([a, b, c, d]) => lon >= a && lon <= c && lat >= b && lat <= d);

const cultures: string[] = [], religions: string[] = [];
const intern = (list: string[], s: string) => { let i = list.indexOf(s); if (i < 0) { i = list.length; list.push(s); } return i; };
const pops: [number, number, number, number, number, number, number, number, number, number][] = [];
const buildings: [number, number, number][] = [];

// ---- Demand-driven starting industry -------------------------------------------------------------
// Final demand per province from pop incomes (needs tiers at base prices), then a few input–output
// rounds add intermediate demand. Producers are placed by urban workforce (resources: resource provinces only).
const FARM_EMPLOY = (lit: number) => 0.3 + 0.5 * lit;
const finalDemand = new Map<number, Float64Array>(); // province → per-good monthly qty
const provWorkers = new Map<number, number>();
const provPeasants = new Map<number, number>();
const provCountry = new Map<number, string>();
const provPop = new Map<number, number>();
const ARMS_PER_SOLDIER = 0.02;
const INCOME_NET = 0.8; // after income/consumption taxes and saving buffers

function recordDemand(prov: number, tag: string, total: number, sh: Record<string, number>, gdp: number, lit: number) {
  const d = new Float64Array(N_GOODS);
  const meanWeight = STRATA.reduce((s, st) => s + sh[st]! * INCOME_WEIGHT[st], 0);
  const subsistShare = 1 - FARM_EMPLOY(lit);
  const dev = provinces[prov]!.development;
  for (const st of STRATA) {
    const n = total * sh[st]!;
    if (n < 1) continue;
    const budget = ((gdp * 100) / 12) * (INCOME_WEIGHT[st] / meanWeight) * INCOME_NET * n;
    const subsGrain = st === "peasants" ? n * subsistShare * Math.min(1.1, 0.75 * provinceProductivity(dev) + 0.35) : 0;
    const cost = [0, 1, 2].map((t) => NEEDS[t]!.reduce((s, q, g) => s + (t === 0 && g === GRAIN ? Math.max(0, q * n - subsGrain) : q * n) * BASE_PRICE[g]!, 0));
    let rem = budget;
    const t1 = Math.min(1, rem / Math.max(1, cost[0]!)); rem -= t1 * cost[0]!;
    const t2 = t1 >= 1 ? Math.min(1, rem / Math.max(1, cost[1]!)) : 0; rem -= t2 * cost[1]!;
    const k3 = t2 >= 1 ? Math.min(25, rem / Math.max(1, cost[2]!)) : 0;
    for (let g = 0; g < N_GOODS; g++) {
      const q1 = g === GRAIN ? Math.max(0, NEEDS[0]![g]! * n - subsGrain) : NEEDS[0]![g]! * n;
      d[g]! += t1 * q1 + t2 * NEEDS[1]![g]! * n + k3 * NEEDS[2]![g]! * n;
    }
    if (st === "military") d[goodIndex("arms")]! += n * 0.6 * ARMS_PER_SOLDIER;
  }
  // Investment demand: ~8% of income spent on the construction basket (steel/tools/machinery).
  const income = ((gdp * 100) / 12) * total;
  let basketVal = 0;
  for (const [g, q] of CONSTRUCTION_BASKET) basketVal += q * BASE_PRICE[g]!;
  for (const [g, q] of CONSTRUCTION_BASKET) d[g]! += (0.08 * income * q) / basketVal;
  finalDemand.set(prov, d);
  provWorkers.set(prov, total * (sh.workers! + sh.clerks! * 0.5));
  provPeasants.set(prov, total * sh.peasants! * FARM_EMPLOY(lit));
  provCountry.set(prov, tag);
  provPop.set(prov, total);
  // Public buildings sized by professionals.
  const add = (id: string, jobs: number) => { const t = buildingIndex(id); const lv = Math.round(jobs / PMS[t]![0]!.jobs[STRATUM.professionals]!); if (lv > 0) buildings.push([prov, t, lv]); };
  add("university", total * sh.professionals! * 0.12);
  add("hospital", total * sh.professionals! * 0.12);
}
const GRAIN = goodIndex("grain");

function sizeBuildings() {
  const producer = new Int32Array(N_GOODS).fill(-1);
  BUILDINGS.forEach((b, t) => { if (b.owner === "private") for (const g of Object.keys(b.pms[0]!.outputs)) producer[goodIndex(g)] = t; });
  const nonResource = new Set(GOODS.map((_, g) => g).filter((g) => producer[g]! >= 0 && !BUILDINGS[producer[g]!]!.resource));
  // country-level and world-level (resource goods) demand with I–O rounds
  const byCountry = new Map<string, Float64Array>();
  for (const [prov, d] of finalDemand) {
    const t = provCountry.get(prov)!;
    const a = byCountry.get(t) ?? byCountry.set(t, new Float64Array(N_GOODS)).get(t)!;
    for (let g = 0; g < N_GOODS; g++) a[g]! += d[g]!;
  }
  const worldRes = new Float64Array(N_GOODS);
  const levels = new Map<string, Float64Array>(); // country → levels per building type (fractional)
  const avgProd = new Map<string, number>();
  for (const [t] of byCountry) {
    const ps = [...provCountry].filter(([, c]) => c === t).map(([p]) => p);
    const wsum = ps.reduce((s, p) => s + provWorkers.get(p)!, 0);
    avgProd.set(t, ps.reduce((s, p) => s + provinceProductivity(provinces[p]!.development) * provWorkers.get(p)!, 0) / Math.max(1, wsum));
  }
  for (const [t, final] of byCountry) {
    const total = Float64Array.from(final), lv = new Float64Array(BUILDINGS.length);
    for (let round = 0; round < 6; round++) {
      const need = Float64Array.from(final);
      lv.fill(0);
      for (let g = 0; g < N_GOODS; g++) {
        const b = producer[g]!;
        if (b < 0 || !nonResource.has(g)) continue;
        const pm = PMS[b]![0]!;
        lv[b] = total[g]! / (pm.outputs[g]! * avgProd.get(t)!);
        for (let h = 0; h < N_GOODS; h++) need[h]! += pm.inputs[h]! * lv[b]!;
      }
      total.set(need);
    }
    levels.set(t, lv);
    for (let g = 0; g < N_GOODS; g++) if (producer[g]! >= 0 && !nonResource.has(g)) worldRes[g]! += total[g]!;
  }
  // resource goods also need their own inputs (tools, electricity) — small; ignored at start.
  for (const [t, lv] of levels) {
    const ps = [...provCountry].filter(([, c]) => c === t).map(([p]) => p);
    const wsum = ps.reduce((s, p) => s + provWorkers.get(p)!, 0);
    const psum = ps.reduce((s, p) => s + provPeasants.get(p)!, 0);
    lv.forEach((L, b) => {
      if (L <= 0) return;
      const farm = BUILDINGS[b]!.id === "farm";
      for (const p of ps) {
        const share = farm ? provPeasants.get(p)! / Math.max(1, psum) : provWorkers.get(p)! / Math.max(1, wsum);
        const n = Math.round(L * share);
        if (n > 0) buildings.push([p, b, n]);
      }
    });
  }
  // Resource extraction placed worldwide in resource provinces, weighted by population.
  for (let g = 0; g < N_GOODS; g++) {
    const b = producer[g]!;
    if (b < 0 || nonResource.has(g)) continue;
    const res = BUILDINGS[b]!.resource!;
    const ps = provinces.filter((p) => has(res, p.lon, p.lat) && finalDemand.has(p.id));
    const wsum = ps.reduce((s, p) => s + provPop.get(p.id)!, 0);
    const pm = PMS[b]![0]!;
    const L = (worldRes[g]! * 1.3) / pm.outputs[g]!;
    for (const p of ps) {
      const n = Math.round((L * provPop.get(p.id)!) / wsum / provinceProductivity(p.development));
      if (n > 0) buildings.push([p.id, b, n]);
    }
  }
}
void SPEND_RATE;

/** Strata shares of a province population given its urban share. */
function strataShares(u: number): Record<(typeof STRATA)[number], number> {
  const s = { workers: 0.6 * u, clerks: 0.18 * u, professionals: 0.07 * u, elites: 0.012 + 0.02 * u, military: 0.008, bureaucrats: 0.005 + 0.015 * u, peasants: 0 };
  s.peasants = 1 - Object.values(s).reduce((a, b) => a + b, 0);
  return s;
}
const INCOME_WEIGHT = { peasants: 0.5, workers: 1, clerks: 1.5, professionals: 3, elites: 10, military: 1, bureaucrats: 1.5 };

// Group provinces by (owner, region) and assign each group its start record.
const groups = new Map<string, number[]>();
for (const p of provinces) {
  const k = `${p.owner}:${regionOf(p.lon, p.lat)}`;
  (groups.get(k) ?? groups.set(k, []).get(k)!).push(p.id);
}
for (const [k, ids] of groups) {
  const [tag, regionStr] = k.split(":") as [string, string];
  const region = REGION_NAMES[Number(regionStr)]!;
  const home = start[tag];
  if (!home) throw new Error(`no start data for ${tag}`);
  const cap = provinces[capitals[tag]!]!;
  const isHome = regionOf(cap.lon, cap.lat) === Number(regionStr);
  const rec: RegionStartDef = isHome ? home : home.colonies?.[region] ?? { ...home, population: 0.05, urban: 0.1, literacy: 0.1, gdpPerCapita: 800 };
  // A home record shared by several regions (e.g. USA mainland + Alaska) is split by weight below.
  const weight = (id: number) => { const p = provinces[id]!; return Math.sqrt(p.areaKm2) * p.development ** 1.2 * (capitals[tag] === id ? 1.5 : 1); };
  const W = ids.reduce((s, id) => s + weight(id), 0);
  const avgDev = ids.reduce((s, id) => s + provinces[id]!.development, 0) / ids.length;
  const combos = comboShares(rec);
  for (const id of ids) {
    const p = provinces[id]!;
    const total = (rec.population * 1e6 * weight(id)) / W;
    const u = Math.min(0.95, Math.max(0.02, rec.urban * Math.sqrt(p.development / avgDev)));
    const lit = rec.literacy;
    const health = Math.min(0.9, Math.max(0.15, 0.2 + 0.18 * Math.log(rec.gdpPerCapita / 400)));
    const ageYoung = 0.4 - 0.15 * lit, ageOld = 0.035 + 0.055 * lit;
    const shares = strataShares(u);
    const meanWeight = STRATA.reduce((s, st) => s + shares[st] * INCOME_WEIGHT[st], 0);
    for (const st of STRATA) {
      const perCapIncome = (rec.gdpPerCapita * 100 / 12) * INCOME_WEIGHT[st] / meanWeight; // cents/month
      for (const [cul, rel, share] of combos) {
        const n = total * shares[st] * share;
        if (n < MIN_GROUP && !(cul === combos[0]![0] && rel === combos[0]![1])) continue;
        if (n < 1) continue;
        const strLit = Math.min(1, lit * (st === "peasants" ? 0.8 : st === "professionals" || st === "elites" ? 1.6 : 1.1));
        pops.push([id, cul, rel, STRATUM[st], n * ageYoung, n * (1 - ageYoung - ageOld), n * ageOld, round3(strLit), round3(health), Math.round(n * perCapIncome * 2)]);
      }
    }
    recordDemand(id, tag, total, shares, rec.gdpPerCapita, lit);
  }
}

function comboShares(rec: RegionStartDef): [number, number, number][] {
  const top = (o: Record<string, number>, n: number) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n);
  const cs = top(rec.cultures, 3), rs = top(rec.religions, 2);
  const combos = cs.flatMap(([c, cw]) => rs.map(([r, rw]) => [intern(cultures, c), intern(religions, r), cw * rw] as [number, number, number]))
    .sort((a, b) => b[2] - a[2]).slice(0, MAX_COMBOS);
  const s = combos.reduce((a, c) => a + c[2], 0);
  return combos.map(([c, r, w]) => [c, r, w / s]);
}


function round3(x: number) { return Math.round(x * 1000) / 1000; }

sizeBuildings();
writeFileSync("data/generated/pops-1936.json", JSON.stringify({ cultures, religions, pops: pops.map((r) => r.map((v, i) => (i >= 4 && i <= 6 ? Math.round(v) : v))), buildings }));
const perProv = new Map<number, number>();
for (const p of pops) perProv.set(p[0], (perProv.get(p[0]) ?? 0) + 1);
console.log(`${pops.length} pop groups (avg ${(pops.length / perProv.size).toFixed(1)}, max ${Math.max(...perProv.values())}/province), ${buildings.length} buildings, world pop ${(pops.reduce((s, p) => s + p[4] + p[5] + p[6], 0) / 1e9).toFixed(3)}B`);
void BUILDINGS;
