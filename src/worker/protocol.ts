import type { Command } from "../sim/commands";

export type ToWorker =
  | { kind: "init"; seed: number }
  | { kind: "command"; cmd: Omit<Command, "issuedOn"> }
  | { kind: "step"; days: number };

export interface Snapshot { date: number; dateLabel: string; treasury: number[] }
export type FromWorker = { kind: "snapshot"; snap: Snapshot } | { kind: "rejected"; reason: string };
