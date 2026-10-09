import type { Command } from "../sim/commands";
import type { StartScope } from "../sim/setup";
import type { CountryReport } from "../sim/inspect";

export type ToWorker =
  | { kind: "init"; seed: number; scope: StartScope }
  | { kind: "command"; cmd: Omit<Command, "issuedOn"> }
  | { kind: "step"; days: number }
  | { kind: "setSpeed"; speed: number }
  | { kind: "setPaused"; paused: boolean }
  | { kind: "inspect"; country: number | null };

/** Sent once after init: static per-province/country data for the UI. */
export interface SetupInfo {
  srcProvinceIds: number[];
  provinceNames: string[];
  terrain: number[];
  areaKm2: number[];
  neighbors: number[][];
  countries: { tag: string; name: string; color: string; capital: number }[];
}
export interface Snapshot {
  date: number; dateLabel: string; paused: boolean; speed: number;
  treasury: number[]; owner: number[]; development: number[];
  provPopulation: number[]; provSol: number[]; provUnemployment: number[];
}
export type FromWorker =
  | { kind: "setup"; info: SetupInfo }
  | { kind: "snapshot"; snap: Snapshot }
  | { kind: "report"; report: CountryReport }
  | { kind: "rejected"; reason: string };
