import type { Command, Preview } from "../sim/commands";
import type { StartScope } from "../sim/setup";
import type { CountryReport } from "../sim/inspect";
import type { Alert } from "../sim/alerts";

export type PlayerCommand = Omit<Command, "issuedOn" | "actor">;

export type ToWorker =
  | { kind: "init"; seed: number; scope: StartScope; player: string }
  | { kind: "command"; cmd: PlayerCommand }
  | { kind: "undo" }
  | { kind: "preview"; id: number; cmds: PlayerCommand[] }
  | { kind: "step"; days: number }
  | { kind: "setSpeed"; speed: number }
  | { kind: "setPaused"; paused: boolean }
  | { kind: "inspect"; country: number | null };

/** Sent once after init: static per-province/country data for the UI. */
export interface SetupInfo {
  player: number;
  srcProvinceIds: number[];
  provinceNames: string[];
  /** Other regions inside each province (e.g. Berlin inside Brandenburg), for search. */
  aka: string[][];
  terrain: number[];
  areaKm2: number[];
  resources: number[];
  neighbors: number[][];
  countries: { tag: string; name: string; color: string; capital: number }[];
}

export interface PlayerState {
  adm: number; dip: number; mil: number; pp: number; manpower: number; stability: number;
  treasury: number; income: number; expense: number; taxRate: number; automation: number;
  gains: { adm: number; dip: number; mil: number; pp: number };
  laws: number[];
  projects: { index: number; province: number; type: number; levels: number; progress: number; state: boolean }[];
  alerts: Alert[];
  canUndo: boolean;
  why: Record<string, { label: string; value: string }[]>;
}

export interface Snapshot {
  date: number; dateLabel: string; paused: boolean; speed: number; rev: number;
  treasury: number[]; owner: number[]; development: number[];
  devTax: number[]; devProd: number[]; devMan: number[];
  provPopulation: number[]; provSol: number[]; provUnemployment: number[]; provUnrest: number[];
  player: PlayerState;
}
export type FromWorker =
  | { kind: "setup"; info: SetupInfo }
  | { kind: "snapshot"; snap: Snapshot }
  | { kind: "report"; report: CountryReport }
  | { kind: "previews"; id: number; results: Preview[] }
  | { kind: "rejected"; reason: string }
  | { kind: "events"; events: string[] };
