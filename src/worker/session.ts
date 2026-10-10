// Game session: owns the World, the player country, the clock, and undo. Pure (no postMessage) so it
// can be tested in Node; sim.worker.ts wraps it.
import type { World } from "../sim/world";
import { tickDay } from "../sim/tick";
import { applyCommand, previewCommand, validateCommand, type Preview } from "../sim/commands";
import "../sim/commands/player";
import { formatDate } from "../sim/date";
import { createWorld, neighborsOf, type StartScope } from "../sim/setup";
import { loadContent } from "../sim/content";
import { updateStats } from "../sim/systems/stats";
import { runLabour } from "../sim/systems/labour";
import { updateManpower } from "../sim/systems/core";
import { loadWorld, saveWorld } from "../sim/save";
import { computeAlerts } from "../sim/alerts";
import { countryStat, getStat } from "../sim/modifiers";
import { LAWS, activeLaw, sourceLabel } from "../sim/laws";
import type { PlayerCommand, SetupInfo, Snapshot } from "./protocol";

export const UNDO_DEPTH = 10;

export class GameSession {
  world: World;
  player: number;
  paused = true;
  speed = 3;
  /** Bumped on every command/undo so the UI refreshes action previews. */
  rev = 0;
  private undo: { date: number; bytes: Uint8Array }[] = [];
  private srcIds: number[];
  private countries: SetupInfo["countries"];

  constructor(seed: number, scope: StartScope, playerTag: string) {
    const content = loadContent();
    const start = createWorld(seed, content, scope);
    this.world = start.world;
    this.srcIds = start.srcProvinceIds;
    this.player = Math.max(0, this.world.countryTags.indexOf(playerTag));
    this.countries = start.countries.map((c, i) => ({ tag: c.tag, name: c.name, color: c.color, capital: this.world.countries.cols.capital![i]! }));
    // Day-zero derived state so the first frame is honest (employment, unemployment, manpower).
    runLabour(this.world);
    updateStats(this.world);
    updateManpower(this.world);
    this.areas = start.srcProvinceIds.map((id) => content.provinces[id]!.areaKm2);
    this.aka = start.srcProvinceIds.map((id) => content.provinces[id]!.aka);
  }
  private areas: number[];
  private aka: string[][];

  setup(): SetupInfo {
    const w = this.world;
    return {
      player: this.player, srcProvinceIds: this.srcIds, provinceNames: w.provinceNames, aka: this.aka,
      terrain: Array.from(w.provinces.cols.terrain!), areaKm2: this.areas, resources: Array.from(w.provinces.cols.res!),
      neighbors: w.provinceNames.map((_, i) => Array.from(neighborsOf(w, i))), countries: this.countries,
    };
  }

  /** Advance whole days; time advancing clears the undo stack. */
  advance(days: number): void {
    for (let i = 0; i < days; i++) tickDay(this.world);
    if (days > 0) this.undo = [];
  }

  /** Apply a player command now (between ticks). Returns a rejection reason or null. */
  command(c: PlayerCommand): { error: string | null; events: string[] } {
    const cmd = { ...c, actor: this.player, issuedOn: this.world.date };
    const v = validateCommand(cmd, this.world);
    if (!v.ok) return { error: v.reason, events: [] };
    this.undo.push({ date: this.world.date, bytes: saveWorld(this.world) });
    if (this.undo.length > UNDO_DEPTH) this.undo.shift();
    const ev = applyCommand(cmd, this.world);
    this.rev++;
    updateStats(this.world);
    return { error: null, events: ev.map((e) => e.type) };
  }

  canUndo(): boolean { return this.undo.length > 0 && this.undo[this.undo.length - 1]!.date === this.world.date; }

  undoLast(): boolean {
    if (!this.canUndo()) return false;
    this.world = loadWorld(this.undo.pop()!.bytes);
    this.rev++;
    return true;
  }

  preview(cmds: PlayerCommand[]): Preview[] {
    return cmds.map((c) => previewCommand({ ...c, actor: this.player, issuedOn: this.world.date }, this.world));
  }

  snapshot(): Snapshot {
    const w = this.world, cc = w.countries.cols, pc = w.provinces.cols, c = this.player;
    const projects = [];
    for (let j = 0; j < w.projects.size; j++) {
      if (w.projects.cols.country![j] !== c) continue;
      projects.push({ index: j, province: w.projects.cols.prov![j]!, type: w.projects.cols.type![j]!, levels: w.projects.cols.levels![j]!, progress: w.projects.cols.progress![j]!, state: w.projects.cols.state![j] === 1 });
    }
    const why = (key: string) => getStat(w, `c:${c}`, key).contributors.map((x) => ({ label: sourceLabel(w, c, x.source), value: x.mult !== undefined ? `${x.mult > 0 ? "+" : ""}${Math.round(100 * x.mult)}%` : `${(x.add ?? 0) > 0 ? "+" : ""}${x.add}` }));
    const stat = (k: string) => countryStat(w, k)[c]!;
    return {
      date: w.date, dateLabel: formatDate(w.date), paused: this.paused, speed: this.speed, rev: this.rev,
      treasury: Array.from(cc.treasury!), owner: Array.from(pc.owner!), development: Array.from(pc.development!),
      devTax: Array.from(pc.devTax!), devProd: Array.from(pc.devProd!), devMan: Array.from(pc.devMan!),
      provPopulation: Array.from(pc.population!), provSol: Array.from(pc.sol!), provUnemployment: Array.from(pc.unemployment!), provUnrest: Array.from(pc.unrest!),
      player: {
        adm: cc.adm![c]!, dip: cc.dip![c]!, mil: cc.mil![c]!, pp: cc.pp![c]!, manpower: cc.manpower![c]!, stability: cc.stability![c]!,
        treasury: cc.treasury![c]!, income: cc.income![c]!, expense: cc.expense![c]!, taxRate: cc.taxRate![c]!, automation: cc.automation![c]!,
        gains: { adm: stat("adm_gain"), dip: stat("dip_gain"), mil: stat("mil_gain"), pp: stat("pp_gain") + 0.5 * cc.stability![c]! },
        laws: LAWS.map((_, k) => activeLaw(w, c, k)), projects, alerts: computeAlerts(w, c), canUndo: this.canUndo(),
        why: {
          stability: [...why("stability_target"), { label: "Standard of living", value: ((cc.sol![c]! - 45) / 25).toFixed(2) }, { label: "Drifts toward target", value: "2%/month" }],
          pp: [{ label: "Base", value: "+4" }, { label: "Stability", value: (0.5 * cc.stability![c]!).toFixed(2) }, ...why("pp_gain")],
          adm: [{ label: "Base", value: "+5 (interim, until leaders in M4)" }, ...why("adm_gain"), { label: "Leaders and advisors", value: "arrive in M4" }],
          manpower: [{ label: "Mobilisation rate", value: `${(100 * stat("mobilisation")).toFixed(1)}% of adults` }, ...why("mobilisation")],
          tax: [{ label: "Tax rate", value: `${Math.round(100 * cc.taxRate![c]!)}%` }, ...why("tax_efficiency"), { label: "Tax development", value: "+3% per level, per province" }],
        },
      },
    };
  }
}
