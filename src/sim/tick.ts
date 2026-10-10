// Fixed system order (§3.5). Never reorder silently.
import type { World } from "./world";
import { toYmd } from "./date";
import { applyCommand, type Command, type SimEvent } from "./commands";
import { pruneExpired } from "./modifiers";
import * as eco from "./systems/economy";
import { runMigration } from "./systems/migration";
import { runAssimilation } from "./systems/mobility";
import { recordYear } from "./systems/stats";
import { yearlyFiscalPolicy } from "./systems/budget";
import { mergeSmallPops } from "./pops";
import { runCore } from "./systems/core";
import { runFocus } from "./systems/focus";
import { runEvents } from "./systems/events";
import { runAmbitions } from "./systems/ambitions";
import { runEra } from "./systems/era";
import "./commands/content";
import "./commands/war";
import { runMovement } from "./systems/armies";
import { runCombat, runSieges } from "./systems/combat";
import { runWarScore } from "./systems/wars";
import { runDiplomacyAi, runRivals } from "./systems/diplo-ai";
import { aiPeace, aiRecruit, autoCommand } from "./systems/war-ai";
import { runIgs } from "./systems/igs";
import { runIdeologyDrift, runPolitics } from "./systems/politics";

export type System = (world: World, events: SimEvent[]) => void;
const noop: System = () => {};

export const DAILY: [string, System][] = [
  ["movement", runMovement], ["combat", runCombat], ["sieges", runSieges], ["character_health", noop],
];
export const MONTHLY: [string, System][] = [
  ["points_pp", runCore], ["production", eco.production], ["markets", eco.markets], ["wages_income", eco.wagesIncome],
  ["consumption_sol", eco.consumptionSol], ["state_budget", eco.stateBudget], ["construction", eco.construction],
  // Demography is yearly in the design; rates are applied monthly (/12) for smoothness, with mobility.
  ["demography_smoothed", eco.demographyMonthly],
  ["research_focus", (w) => { runEra(w); runFocus(w); }], ["ig_approval", (w) => { runIgs(w); runPolitics(w); }], ["stability_unrest", noop], ["events", runEvents], ["ai", (w) => { runWarScore(w); runDiplomacyAi(w); aiPeace(w); aiRecruit(w); autoCommand(w); }], ["alerts", noop],
];
export const YEARLY: [string, System][] = [
  ["demography", noop], ["migration", runMigration], ["assimilation_mobility", runAssimilation], ["ig_clout", noop],
  ["ideology_drift", runIdeologyDrift], ["rankings", (w) => { yearlyFiscalPolicy(w); mergeSmallPops(w); runAmbitions(w); runRivals(w); }], ["chronicle", recordYear], ["autosave", noop],
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
