import type { Command } from "../sim/commands";
import type { StartScope } from "../sim/setup";

export type ToWorker =
  | { kind: "init"; seed: number; scope: StartScope }
  | { kind: "command"; cmd: Omit<Command, "issuedOn"> }
  | { kind: "step"; days: number }
  | { kind: "setSpeed"; speed: number }
  | { kind: "setPaused"; paused: boolean };

/** Sent once after init: static per-province/country data for the UI. */
export interface SetupInfo {
  srcProvinceIds: number[];
  provinceNames: string[];
  terrain: number[];
  neighbors: number[][];
  countries: { tag: string; name: string; color: string; capital: number }[];
}
export interface Snapshot {
  date: number; dateLabel: string; paused: boolean; speed: number;
  treasury: number[]; owner: number[]; development: number[];
}
export type FromWorker =
  | { kind: "setup"; info: SetupInfo }
  | { kind: "snapshot"; snap: Snapshot }
  | { kind: "rejected"; reason: string };
