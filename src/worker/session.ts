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
import type { CharacterInfo, PlayerCommand, PoliticsState, SetupInfo, Snapshot } from "./protocol";
import { CABINET_SLOTS, HIGH_COMMAND_SLOTS, Role, TRAITS, ageOf, charactersOf, findRole } from "../sim/characters";
import { IGS, N_IGS, hasPrivilege, igRow } from "../sim/igs";
import { approvalParts, computeClout, lastIgMonth } from "../sim/systems/igs";
import { electionScores } from "../sim/systems/politics";
import "../sim/commands/politics";

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
    computeClout(this.world);
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

  private character(i: number): CharacterInfo | null {
    if (i < 0) return null;
    const c = this.world.characters.cols;
    if (!c.alive![i]) return null;
    return {
      id: i, name: this.world.characterNames[i]!, role: c.role![i]!, slot: c.slot![i]!, age: Math.floor(ageOf(this.world, i)),
      adm: c.adm![i]!, dip: c.dip![i]!, mil: c.mil![i]!, traits: [c.trait0![i]!, c.trait1![i]!, c.trait2![i]!].filter((t) => t >= 0).map((t) => TRAITS[t]!.name),
      ideology: c.ideology![i]!, ig: c.ig![i]!, seed: c.seed![i]!, loyalty: c.loyalty![i]!,
    };
  }

  private politics(): PoliticsState {
    const w = this.world, k = this.player, cc = w.countries.cols, ic = w.igs.cols;
    const m = lastIgMonth();
    const leaders = charactersOf(w, k, Role.IgLeader);
    const next = cc.nextElection![k]!;
    return {
      government: cc.government![k] === 0 ? "democracy" : "autocracy",
      nextElection: cc.government![k] === 0 ? `${["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][next % 100]} ${Math.floor(next / 100)}` : "—",
      academy: cc.academy![k]!,
      head: this.character(findRole(w, k, Role.Head)), heir: this.character(cc.heir![k]!),
      cabinet: CABINET_SLOTS.map((_, s) => this.character(findRole(w, k, Role.Cabinet, s))),
      high: HIGH_COMMAND_SLOTS.map((_, s) => this.character(findRole(w, k, Role.HighCommand, s))),
      pool: charactersOf(w, k, Role.Pool).map((i) => this.character(i)!),
      igs: IGS.map((_, g) => {
        const r = igRow(k, g);
        return {
          clout: ic.clout![r]!, approval: ic.approval![r]!, radicalism: ic.radicalism![r]!, privilege: hasPrivilege(w, k, g), strikes: ic.strikes![r]!,
          leader: this.character(leaders.find((i) => w.characters.cols.ig![i] === g) ?? -1),
          parts: approvalParts(w, k, g, m ? m.memberSol[r]! : 45),
        };
      }),
      ideology: [cc.ideoDem![k]!, cc.ideoFas![k]!, cc.ideoCom![k]!, cc.ideoNon![k]!],
      electionScores: electionScores(w, k),
    };
  }

  private provIg(): number[] {
    const m = lastIgMonth(), n = this.world.provinces.size, out = new Array<number>(n).fill(-1);
    if (!m) return out;
    for (let p = 0; p < n; p++) { let best = -1, v = 0; for (let g = 0; g < N_IGS; g++) { const x = m.provMembers[p * N_IGS + g]!; if (x > v) { v = x; best = g; } } out[p] = best; }
    return out;
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
      politics: this.politics(), provIg: this.provIg(),
      chronicle: w.chronicle.map((e, n) => ({ ...e, n })).filter((e) => e.country === c).slice(-30).map((e) => ({ date: formatDate(e.date), kind: e.kind, text: e.text, n: e.n })),
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
