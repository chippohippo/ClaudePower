// Event engine: emergent events from sim state (mean time to happen), templates with {country}
// {province} {ig} {leader}; AI picks the highest-weight choice, the player gets a pending event.
import { Rng } from "../rng";
import { EVENTS, EVENT_BY_ID } from "../script/bundle";
import type { EventDef } from "../script/content";
import { apply, fill, setQueueEvent, test, type Ctx } from "../script/eval";
import { N_IGS } from "../igs";
import { chronicle } from "../characters";
import type { EventBinding, World } from "../world";

import { PLAYER_EVENTS } from "../automation";

function bind(w: World, c: number, e: EventDef, rng: Rng): EventBinding | null {
  if (e.scope === "country") return {};
  if (e.scope === "province") {
    const cands: number[] = [];
    for (let p = 0; p < w.provinces.size; p++) if (w.provinces.cols.owner![p] === c && (!e.bindIf || test(e.bindIf, { w, c, bind: { province: p } }))) cands.push(p);
    return cands.length ? { province: cands[rng.int(0, cands.length - 1)]! } : null;
  }
  const igs: number[] = [];
  for (let g = 0; g < N_IGS; g++) if (!e.bindIf || test(e.bindIf, { w, c, bind: { ig: g } })) igs.push(g);
  return igs.length ? { ig: igs[rng.int(0, igs.length - 1)]! } : null;
}

export function fireEvent(w: World, c: number, e: EventDef, b: EventBinding): void {
  w.eventLog[`${c}:${e.id}`] = w.date;
  if (w.countries.cols.automation![c]! & PLAYER_EVENTS) {
    w.pendingEvents.push({ id: w.nextEventId++, country: c, event: e.id, bind: b, date: w.date });
    return;
  }
  resolveEvent(w, c, e, b, e.choices.reduce((best, ch, i) => (ch.ai > e.choices[best]!.ai ? i : best), 0));
}

export function resolveEvent(w: World, c: number, e: EventDef, b: EventBinding, choice: number): void {
  const ch = e.choices[choice]!;
  const x: Ctx = { w, c, bind: b };
  apply(ch.effects, x, `event:${e.id}`);
  if (e.mtth > 0 || e.reactsTo.length) chronicle(w, c, "event", `${fill(e.title, x)} — ${fill(ch.name, x)}`);
}

/** Monthly scan: each eligible event fires with probability 1/mtth (immediately if mtth is 0). */
export function runEvents(w: World): void {
  const rng = new Rng(w.rng);
  for (let c = 0; c < w.countries.size; c++) {
    if (w.countries.cols.population![c]! < 1) continue;
    for (const e of EVENTS) {
      if (e.triggeredOnly) continue;
      const last = w.eventLog[`${c}:${e.id}`];
      if (last !== undefined && (e.once || w.date - last < e.cooldown * 30.44)) continue;
      if (w.pendingEvents.some((p) => p.country === c && p.event === e.id)) continue;
      if (!test(e.trigger, { w, c })) continue;
      if (e.mtth > 0 && !rng.chance(1 / e.mtth)) continue;
      const b = bind(w, c, e, rng);
      if (b) fireEvent(w, c, e, b);
    }
  }
  w.rng = rng.state;
}

setQueueEvent((w, c, id, b) => { const e = EVENT_BY_ID.get(id); if (e) fireEvent(w, c, e, b); });
