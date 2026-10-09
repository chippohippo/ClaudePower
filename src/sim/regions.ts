// Continental regions (shared by map generation, start data, and migration rules).
import { REGION_NAMES } from "./schemas";

export const isEurope = (lon: number, lat: number) => lon >= -25 && lon <= 45 && lat >= 34 && lat <= 72;

/** Index into REGION_NAMES. */
export function regionOfLonLat(lon: number, lat: number): number {
  if (isEurope(lon, lat)) return 0;
  if (lon < -30) return lat > 12 ? 1 : 2;
  if (lon < 60 && lat < 34 && !(lon > 34 && lat > 12)) return 3;
  if (lon < 60) return 4;
  if (lat < -10 && lon > 110) return 5;
  return 6;
}
export const regionName = (i: number) => REGION_NAMES[i]!;
