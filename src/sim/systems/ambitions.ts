// Ambitions (§14): three long-term goals per nation, assigned at start, checked yearly; rewards on completion.
import { Rng } from "../rng";
import { AMBITIONS } from "../script/bundle";
import { apply, test } from "../script/eval";
import { chronicle } from "../characters";
import type { World } from "../world";

export function assignAmbitions(w: World): void {
  const rng = new Rng(w.rng);
  for (let c = 0; c < w.countries.size; c++) {
    const pool = AMBITIONS.filter((a) => test(a.eligible, { w, c }));
    const picks: string[] = [];
    while (picks.length < 3 && picks.length < pool.length) { const a = pool[rng.int(0, pool.length - 1)]!; if (!picks.includes(a.id)) picks.push(a.id); }
    w.ambitions[c] = picks.map((id) => ({ id, done: -1 }));
  }
  w.rng = rng.state;
}

export function runAmbitions(w: World): void {
  for (let c = 0; c < w.countries.size; c++) for (const a of w.ambitions[c] ?? []) {
    if (a.done >= 0) continue;
    const def = AMBITIONS.find((x) => x.id === a.id);
    if (!def || !test(def.goal, { w, c })) continue;
    a.done = w.date;
    apply(def.reward, { w, c }, `ambition:${a.id}`);
    chronicle(w, c, "ambition", `${w.countryTags[c]} fulfils an ambition: ${def.name}.`);
  }
}
