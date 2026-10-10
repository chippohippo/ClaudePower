// Builds data/generated/{provinces,map-geometry}.json from Natural Earth 10m admin-1.
// Usage: npm run build-map -- <path to ne_10m_admin_1_states_provinces.geojson>
import { readFileSync, writeFileSync } from "node:fs";
import type { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon } from "geojson";
import { topology } from "topojson-server";
import { merge, neighbors } from "topojson-client";
import { presimplify, simplify, quantile } from "topojson-simplify";
import { CountriesFile, Map1936File } from "../src/sim/schemas";
import { Rng, seedRng } from "../src/sim/rng";
import { classifyTerrain, isEurope, regionOf, startingDevelopment } from "./map-rules";

const TARGET_PROVINCES = 250;
const EUROPE_WEIGHT = 30;
const MIN_ISLAND_KM2 = 4000;
const SMALL_STATES = new Set(["LUX", "SLV", "DOM", "HTI", "ALB", "EST", "LVA"]);
const DROP = new Set(["ATA", "ATF", "HMD", "SGS", "IOT", "UMI", "CLP", "BMU"]);

const src = process.argv[2];
if (!src) throw new Error("pass path to ne_10m_admin_1_states_provinces.geojson");
const countries = CountriesFile.parse(JSON.parse(readFileSync("data/countries.json", "utf8")));
const rules = Map1936File.parse(JSON.parse(readFileSync("data/map_1936.json", "utf8")));
const tagIndex = new Map(countries.map((c, i) => [c.tag, i]));

const fc = JSON.parse(readFileSync(src, "utf8")) as FeatureCollection<Polygon | MultiPolygon>;
interface A1 { i: number; name: string; owner: number; lon: number; lat: number; area: number }
const a1: A1[] = [];
const kept: Feature<Geometry>[] = [];
for (const f of fc.features) {
  const p = f.properties as Record<string, string | number>;
  const adm0 = String(p.adm0_a3);
  if (DROP.has(adm0) || !f.geometry) continue;
  const name = String(p.name ?? p.name_en ?? adm0);
  const tag = rules.admin1[adm0]?.[name] ?? rules.adm0[adm0];
  if (!tag) continue;
  const owner = tagIndex.get(tag);
  if (owner === undefined) throw new Error(`unknown tag ${tag}`);
  const [lon, lat, area] = centroidArea(f.geometry);
  if (area < MIN_ISLAND_KM2 && Number(p.scalerank) >= 9 && !SMALL_STATES.has(adm0)) continue;
  a1.push({ i: kept.length, name, owner, lon, lat, area });
  kept.push({ type: "Feature", properties: {}, geometry: f.geometry });
}

// Allocate province counts per (owner, region) so colonies don't starve the homeland; Europe weighted.
const weightOf = (a: A1) => a.area * (isEurope(a.lon, a.lat) ? EUROPE_WEIGHT : regionOf(a.lon, a.lat) === 6 ? 3 : 1);
const MAJOR_HOME_MIN = 8;
const isMajorHome = (list: A1[]) => countries[list[0]!.owner]!.major && regionOf(list[0]!.lon, list[0]!.lat) === regionOf(...countries[list[0]!.owner]!.capital);
const groupWeight = (list: A1[]) => {
  const home = list[0]!.owner;
  const w = list.reduce((s, a) => s + weightOf(a), 0) ** 0.7;
  return isMajorHome(list) ? w * 2.5 : w;
};
const byOwner = new Map<number, A1[]>();
const groupKey = (a: A1) => a.owner * 16 + regionOf(a.lon, a.lat);
for (const a of a1) (byOwner.get(groupKey(a)) ?? byOwner.set(groupKey(a), []).get(groupKey(a))!).push(a);
const total = [...byOwner.values()].reduce((s, l) => s + groupWeight(l), 0);
const countsFor = (scale: number) => new Map([...byOwner].map(([o, list]) => {
  const w = groupWeight(list);
  return [o, Math.max(isMajorHome(list) ? MAJOR_HOME_MIN : 1, Math.min(list.length, Math.round((scale * TARGET_PROVINCES * w) / total)))] as const;
}));
let lo = 0, hi = 2, counts = countsFor(1);
for (let it = 0; it < 40; it++) {
  const mid = (lo + hi) / 2;
  counts = countsFor(mid);
  const n = [...counts.values()].reduce((s, c) => s + c, 0);
  if (n > TARGET_PROVINCES) hi = mid; else lo = mid;
}
counts = countsFor(lo);

const rng = new Rng(seedRng(1936));
const groups: A1[][] = [];
for (const [o, list] of [...byOwner].sort((x, y) => x[0] - y[0])) groups.push(...kmeans(list, counts.get(o)!, rng));

// Topology: merge admin-1 shapes into provinces, compute adjacency.
const topo = topology({ a: { type: "FeatureCollection", features: kept } as FeatureCollection }, 1e5);
const simple = simplify(presimplify(topo as never), quantile(presimplify(topo as never), 0.12));
const geoms = (simple.objects.a as unknown as { geometries: never[] }).geometries;
const a1Neighbors = neighbors(geoms);
const provOf = new Int32Array(kept.length);
groups.forEach((g, pid) => g.forEach((a) => (provOf[a.i] = pid)));

const project = ([lon, lat]: number[]): [number, number] =>
  [round2(lon! * 4), round2(-(Math.log(Math.tan(Math.PI / 4 + (Math.max(-80, Math.min(84, lat!)) * Math.PI) / 450)) * 1.25 * 180 / Math.PI) * 4)];

const provinces = groups.map((g, id) => {
  const main = g.reduce((m, a) => (a.area > m.area ? a : m));
  const area = g.reduce((s, a) => s + a.area, 0);
  const lon = g.reduce((s, a) => s + a.lon * a.area, 0) / area;
  const lat = g.reduce((s, a) => s + a.lat * a.area, 0) / area;
  const nb = new Set<number>();
  for (const a of g) for (const n of a1Neighbors[a.i]!) if (provOf[n] !== id) nb.add(provOf[n]!);
  const aka = g.filter((a) => a !== main).sort((x, y) => y.area - x.area).map((a) => a.name).filter((n) => n && n !== main.name);
  return { id, name: main.name, aka, owner: countries[g[0]!.owner]!.tag, terrain: classifyTerrain(lon, lat),
    development: startingDevelopment(lon, lat), areaKm2: Math.round(area), lon: round2(lon), lat: round2(lat),
    neighbors: [...nb].sort((x, y) => x - y) };
});
const geometry = groups.map((g) => {
  const mp = merge(simple as never, g.map((a) => geoms[a.i]!)) as MultiPolygon;
  return mp.coordinates.map((poly) => poly[0]!.map(project).flat()).filter((r) => r.length >= 6);
});

// Capitals: province whose area-weighted centroid is nearest among the owner's provinces.
const capitals: Record<string, number> = {};
for (const c of countries) {
  const own = provinces.filter((p) => p.owner === c.tag);
  if (!own.length) continue;
  capitals[c.tag] = own.reduce((b, p) => (dist(p, c.capital) < dist(b, c.capital) ? p : b)).id;
}

writeFileSync("data/generated/provinces.json", JSON.stringify({ capitals, provinces }));
writeFileSync("data/generated/map-geometry.json", JSON.stringify(geometry));
console.log(`${provinces.length} provinces, ${provinces.filter((p) => !p.neighbors.length).length} without land neighbours`);

function dist(p: { lon: number; lat: number }, c: [number, number]) { return (p.lon - c[0]) ** 2 + (p.lat - c[1]) ** 2; }
function round2(x: number) { return Math.round(x * 100) / 100; }

function kmeans(list: A1[], k: number, r: Rng): A1[][] {
  if (k >= list.length) return list.map((a) => [a]);
  const sorted = [...list].sort((x, y) => y.area - x.area);
  const cs = [sorted[0]!];
  while (cs.length < k) cs.push(sorted.reduce((best, a) => (minD(a) > minD(best) ? a : best)));
  function minD(a: A1) { return Math.min(...cs.map((c) => (a.lon - c.lon) ** 2 + (a.lat - c.lat) ** 2)); }
  let centers = cs.map((c) => [c.lon, c.lat] as [number, number]);
  let assign: number[] = [];
  for (let it = 0; it < 25; it++) {
    assign = list.map((a) => { let b = 0, bd = Infinity; centers.forEach(([x, y], j) => { const d = (a.lon - x) ** 2 + (a.lat - y) ** 2; if (d < bd) { bd = d; b = j; } }); return b; });
    centers = centers.map((c, j) => {
      const m = list.filter((_, i) => assign[i] === j);
      if (!m.length) { const a = list[r.int(0, list.length - 1)]!; return [a.lon, a.lat]; }
      const w = m.reduce((s, a) => s + a.area, 0);
      return [m.reduce((s, a) => s + a.lon * a.area, 0) / w, m.reduce((s, a) => s + a.lat * a.area, 0) / w];
    });
  }
  return centers.map((_, j) => list.filter((_, i) => assign[i] === j)).filter((g) => g.length);
}

function centroidArea(g: Polygon | MultiPolygon): [number, number, number] {
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  let A = 0, X = 0, Y = 0;
  for (const poly of polys) {
    const ring = poly[0]!;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [x0, y0] = ring[j]!, [x1, y1] = ring[i]!;
      const cr = x0! * y1! - x1! * y0!;
      A += cr; X += (x0! + x1!) * cr; Y += (y0! + y1!) * cr;
    }
  }
  if (Math.abs(A) < 1e-12) { const [x, y] = polys[0]![0]![0]!; return [x!, y!, 1]; }
  const cx = X / (3 * A), cy = Y / (3 * A);
  const km2 = Math.abs(A / 2) * 111.32 * 111.32 * Math.cos((cy * Math.PI) / 180);
  return [cx, cy, Math.max(1, km2)];
}
