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

export interface CharacterInfo {
  id: number; name: string; role: number; slot: number; age: number; adm: number; dip: number; mil: number;
  traits: string[]; ideology: number; ig: number; seed: number; loyalty: number;
}
export interface IgInfo {
  clout: number; approval: number; radicalism: number; privilege: boolean; strikes: number; leader: CharacterInfo | null;
  parts: { label: string; value: number }[];
}
export interface PoliticsState {
  government: "democracy" | "autocracy"; nextElection: string; academy: number;
  head: CharacterInfo | null; heir: CharacterInfo | null; cabinet: (CharacterInfo | null)[]; high: (CharacterInfo | null)[]; pool: CharacterInfo[];
  igs: IgInfo[]; ideology: number[]; electionScores: number[];
}

export interface FocusState {
  tree: string; treeName: string; current: string | null; progress: number; days: number;
  focuses: { id: string; name: string; x: number; y: number; status: "done" | "current" | "available" | "blocked" | "excluded"; reason: string; prereqs: string[]; anyOf: string[]; exclusive: string[]; branch: string }[];
}
export interface PendingEventView { id: number; title: string; description: string; choices: { name: string; effects: string[] }[] }
export interface AmbitionView { name: string; description: string; done: boolean }

export interface ArmyView { id: number; country: number; prov: number; strength: number; org: number; target: number; battle: number; auto: boolean }
export interface DiploRow { country: number; rel: number; alliance: boolean; guaranteesUs: boolean; weGuarantee: boolean; trade: boolean; truce: boolean; war: boolean; cb: string | null; rival: boolean; overlord: boolean; puppet: boolean; power: number }
export interface WarView { id: number; name: string; attackers: number[]; defenders: number[]; score: number; start: string; ours: boolean; side: "attacker" | "defender" | null; goal: number }
export type BattleView = import("../sim/world").BattleReport & { provName: string; date: string };

export interface Snapshot {
  date: number; dateLabel: string; paused: boolean; speed: number; rev: number;
  treasury: number[]; owner: number[]; development: number[];
  devTax: number[]; devProd: number[]; devMan: number[];
  provPopulation: number[]; provSol: number[]; provUnemployment: number[]; provUnrest: number[];
  player: PlayerState;
  politics: PoliticsState;
  /** Dominant IG per province (−1 none), for the IG map mode. */
  provIg: number[];
  /** Chronicle entries involving the player since the start (UI shows new ones as notifications). */
  chronicle: { date: string; kind: string; text: string; n: number }[];
  focus: FocusState;
  events: PendingEventView[];
  ambitions: AmbitionView[];
  headlines: string[];
  armies: ArmyView[];
  controller: number[];
  diplomacy: DiploRow[];
  wars: WarView[];
  battles: BattleView[];
  claims: number[];
  rivals: number[];
  military: { equip: number; manpower: number; fielded: number; exhaustion: number; nukes: number; power: number };
}
export type FromWorker =
  | { kind: "setup"; info: SetupInfo }
  | { kind: "snapshot"; snap: Snapshot }
  | { kind: "report"; report: CountryReport }
  | { kind: "previews"; id: number; results: Preview[] }
  | { kind: "rejected"; reason: string }
  | { kind: "events"; events: string[] };
