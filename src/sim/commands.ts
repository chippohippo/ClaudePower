// Every player/AI action is a Command: validate → apply. No direct mutation from UI or AI.
import { Acct, burn, mint } from "./money";
import type { CountryId, World } from "./world";
import type { SimDate } from "./date";

export interface Command { type: string; actor: CountryId; payload: unknown; issuedOn: SimDate }
export interface SimEvent { type: string; data?: unknown }
export type Validation = { ok: true } | { ok: false; reason: string };

export interface CommandHandler<P = unknown> {
  validate(cmd: Command & { payload: P }, world: World): Validation;
  apply(cmd: Command & { payload: P }, world: World): SimEvent[];
}

const registry = new Map<string, CommandHandler<never>>();

export function registerCommand<P>(type: string, h: CommandHandler<P>): void {
  registry.set(type, h as CommandHandler<never>);
}

export function validateCommand(cmd: Command, world: World): Validation {
  const h = registry.get(cmd.type);
  if (!h) return { ok: false, reason: `Unknown command "${cmd.type}"` };
  if (cmd.actor < 0 || cmd.actor >= world.countries.size) return { ok: false, reason: "Invalid actor" };
  return h.validate(cmd as never, world);
}

export function applyCommand(cmd: Command, world: World): SimEvent[] {
  const v = validateCommand(cmd, world);
  if (!v.ok) return [{ type: "command_rejected", data: { cmd: cmd.type, reason: v.reason } }];
  return registry.get(cmd.type)!.apply(cmd as never, world);
}

// Built-in debug command: adjust treasury (integer cents).
registerCommand<{ cents: number }>("debug_add_treasury", {
  validate(cmd, world) {
    if (!Number.isInteger(cmd.payload?.cents)) return { ok: false, reason: "Amount must be whole cents" };
    const t = world.countries.cols.treasury![cmd.actor]!;
    if (t + cmd.payload.cents < 0) return { ok: false, reason: "Insufficient funds" };
    return { ok: true };
  },
  apply(cmd, world) {
    if (cmd.payload.cents >= 0) mint(world, Acct.Treasury, cmd.actor, cmd.payload.cents);
    else burn(world, Acct.Treasury, cmd.actor, -cmd.payload.cents);
    return [{ type: "treasury_changed", data: { actor: cmd.actor, delta: cmd.payload.cents } }];
  },
});
