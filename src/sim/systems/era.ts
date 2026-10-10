// Era bands (§4): set global era flags so content can gate on them (consistency engine).
import { toYmd } from "../date";
import type { World } from "../world";

export const ERAS: [number, string][] = [[1936, "era_crisis"], [1946, "era_reconstruction"], [1960, "era_cold_war"], [1990, "era_globalisation"], [2010, "era_information"]];

export function runEra(w: World): void {
  const y = toYmd(w.date).year;
  for (const [from, flag] of ERAS) if (y >= from && !(flag in w.flags)) w.flags[flag] = w.date;
}
