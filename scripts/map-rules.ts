// Coarse geographic rules for generated province attributes (tunable; see docs/decisions.md).
export type Terrain = "plains" | "forest" | "hills" | "mountains" | "desert" | "jungle" | "tundra" | "marsh";
type Box = [number, number, number, number]; // lonMin, latMin, lonMax, latMax
const inBox = (lon: number, lat: number, [a, b, c, d]: Box) => lon >= a && lon <= c && lat >= b && lat <= d;

const MOUNTAINS: Box[] = [[5.5, 45, 15.5, 47.8], [70, 27, 102, 38], [-76, -40, -66, 6], [-122, 35, -104, 52], [39, 40.5, 49, 44.5], [21, 45, 27, 49.5], [-1.5, 42, 3, 43.5], [44, 35, 60, 40]];
const DESERT: Box[] = [[-17, 15, 34, 31], [35, 15, 60, 31], [75, 36, 110, 46], [120, -32, 142, -19], [52, 26, 70, 35], [-118, 27, -108, 37], [12, -28, 25, -18]];
const JUNGLE: Box[] = [[-79, -15, -45, 8], [8, -8, 31, 6], [95, -10, 155, 12], [-92, 7, -77, 18]];
const MARSH: Box[] = [[23, 51, 31, 53.3]];
const HILLS: Box[] = [[8, 48, 19, 51], [12, 37, 17, 44], [-9, 37, -1, 42.5], [19, 39, 28, 43], [26, 36, 45, 41.5]];

export function classifyTerrain(lon: number, lat: number): Terrain {
  if (Math.abs(lat) > 64) return "tundra";
  if (MOUNTAINS.some((b) => inBox(lon, lat, b))) return "mountains";
  if (DESERT.some((b) => inBox(lon, lat, b))) return "desert";
  if (JUNGLE.some((b) => inBox(lon, lat, b))) return "jungle";
  if (MARSH.some((b) => inBox(lon, lat, b))) return "marsh";
  if (HILLS.some((b) => inBox(lon, lat, b))) return "hills";
  if (lat > 56 || (lat > 46 && lon < -60) || (lat > 50 && lon > 60)) return "forest";
  return "plains";
}

export const isEurope = (lon: number, lat: number) => inBox(lon, lat, [-25, 34, 45, 72]);

/** Starting development 1–20: rough 1936 industrial core weighting. */
export function startingDevelopment(lon: number, lat: number): number {
  if (inBox(lon, lat, [-5, 43, 20, 57])) return 14;
  if (isEurope(lon, lat)) return 9;
  if (inBox(lon, lat, [-98, 30, -66, 50])) return 13;
  if (inBox(lon, lat, [128, 30, 146, 46])) return 10;
  if (lat > 30 || lat < -30) return 6;
  return 3;
}

/** Coarse continent index for grouping colonies separately from homelands. */
export function regionOf(lon: number, lat: number): number {
  if (isEurope(lon, lat)) return 0;
  if (lon < -30) return lat > 12 ? 1 : 2;
  if (lon < 60 && lat < 34 && !(lon > 34 && lat > 12)) return 3;
  if (lon < 60) return 4;
  if (lat < -10 && lon > 110) return 5;
  return 6;
}
