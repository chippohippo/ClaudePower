// Fixed system order (§3.5). Never reorder silently.
import type { World } from "./world";
import { toYmd } from "./date";
import { applyCommand, type Command, type SimEvent } from "./commands";
import { pruneExpired } from "./modifiers";

export type System = (world: World, events: SimEvent[]) => void;
const noop: System = () => {};

export const DAILY: [string, System][] = [
  ["movement", noop], ["combat", noop], ["sieges", noop], ["character_health", noop],
];
export const MONTHLY: [string, System][] = [
  ["points_pp", noop], ["production", noop], ["markets", noop], ["wages_income", noop],
  ["consumption_sol", noop], ["state_budget", noop], ["construction", noop], ["research_focus", noop],
  ["ig_approval", noop], ["stability_unrest", noop], ["events", noop], ["ai", noop], ["alerts", noop],
];
export const YEARLY: [string, System][] = [
  ["demography", noop], ["migration", noop], ["assimilation_mobility", noop], ["ig_clout", noop],
  ["ideology_drift", noop], ["rankings", noop], ["chronicle", noop], ["autosave", noop],
];

/** Advance one day. Commands run first, then daily/monthly/yearly systems on boundaries. */
export function tickDay(world: World, commands: Command[] = []): SimEvent[] {
  const events: SimEvent[] = [];
  for (const c of commands) events.push(...applyCommand(c, world));
  for (const [, s] of DAILY) s(world, events);
  world.date++;
  const { month, day } = toYmd(world.date);
  if (day === 1) {
    for (const [, s] of MONTHLY) s(world, events);
    pruneExpired(world);
    if (month === 1) for (const [, s] of YEARLY) s(world, events);
  }
  return events;
}

export function runDays(world: World, n: number): void {
  for (let i = 0; i < n; i++) tickDay(world);
}
