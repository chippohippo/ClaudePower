// Game session: owns the World, the player country, the clock, and undo. Pure (no postMessage) so it
// can be tested in Node; sim.worker.ts wraps it.
import type { World } from "../sim/world";
import { tickDay } from "../sim/tick";
import { applyCommand, previewCommand, validateCommand, type Preview } from "../sim/commands";
import "../sim/commands/player";
import { formatDate } from "../sim/date";
import { AUTO_ALL, AUTO_DIPLOMACY, AUTO_FOCUS, PLAYER_EVENTS, createWorld, neighborsOf, type StartScope } from "../sim/setup";
import { loadContent } from "../sim/content";
import { updateStats } from "../sim/systems/stats";
import { runLabour } from "../sim/systems/labour";
import { updateManpower } from "../sim/systems/core";
import { loadWorld, saveWorld } from "../sim/save";
import { computeAlerts } from "../sim/alerts";
import { countryStat, getStat } from "../sim/modifiers";
import { LAWS, activeLaw, sourceLabel } from "../sim/laws";
import type { CharacterInfo, FocusState, PlayerCommand, PoliticsState, SetupInfo, Snapshot } from "./protocol";
import { CABINET_SLOTS, HIGH_COMMAND_SLOTS, Role, TRAITS, ageOf, charactersOf, findRole } from "../sim/characters";
import { IGS, N_IGS, hasPrivilege, igRow } from "../sim/igs";
import { approvalParts, computeClout, lastIgMonth } from "../sim/systems/igs";
import { electionScores } from "../sim/systems/politics";
import "../sim/commands/politics";
import "../sim/commands/content";
import "../sim/commands/war";
import { IDEAS, N_TREES, ideaBlocker, ideaSlots, techYear } from "../sim/techs";
import { allied, casusBelli, guarantees, hasTrade, militaryPower, rel, truceWith, warBetween } from "../sim/diplomacy";
import { AMBITIONS, CONTENT, EVENT_BY_ID, focusById, treeById } from "../sim/script/bundle";
import { describeEffect, fill } from "../sim/script/eval";
import { focusBlocker } from "../sim/systems/focus";
import { GOODS, N_GOODS } from "../sim/defs";

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
    // The player decides events and picks focuses; other automation starts on (toggle in F1).
    this.world.countries.cols.automation![this.player] = (AUTO_ALL & ~AUTO_FOCUS & ~AUTO_DIPLOMACY) | PLAYER_EVENTS;
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

  private focusState(): FocusState {
    const w = this.world, c = this.player, st = w.focus[c]!, t = treeById(st.tree);
    if (!t) return { tree: "", treeName: "", current: null, progress: 0, days: 0, focuses: [] };
    const cur = st.current ? focusById(st.tree, st.current) : null;
    return {
      tree: t.id, treeName: t.name, current: st.current, progress: st.progress, days: cur?.days ?? 0,
      focuses: t.focuses.map((f) => {
        const done = st.done.includes(f.id), reason = done ? "" : focusBlocker(w, c, f) ?? "";
        const excluded = f.exclusive.some((x) => st.done.includes(x) || st.current === x);
        const [x, y] = t.layout[f.id] ?? [0, 0];
        return { id: f.id, name: f.name, x, y, status: done ? "done" : st.current === f.id ? "current" : excluded ? "excluded" : reason ? "blocked" : "available", reason, prereqs: f.prerequisites, anyOf: f.anyOf, exclusive: f.exclusive, branch: f.branch ?? "main" };
      }),
    };
  }

  private headlines(): string[] {
    const w = this.world, names = this.countries.map((c) => c.name), out: string[] = [];
    for (const e of w.chronicle.slice(-12).reverse()) {
      const pool = CONTENT.headlines[e.kind];
      if (!pool) continue;
      out.push(pool[(e.date + e.country) % pool.length]!.replaceAll("{country}", names[e.country] ?? "") + (e.kind === "event" || e.kind === "story" || e.kind === "focus" ? ` — ${e.text}` : ""));
    }
    // Price spikes from the market (sim-derived, not scripted).
    const k0 = this.player * N_GOODS;
    for (let g = 0; g < N_GOODS; g++) if (w.markets.cols.price![k0 + g]! > GOODS[g]!.basePrice * w.countries.cols.priceLevel![this.player]! * 2) {
      const pool = CONTENT.headlines.price_spike!;
      out.push(pool[g % pool.length]!.replace("{good}", GOODS[g]!.name).replace("{country}", names[this.player]!));
    }
    return out.slice(0, 10);
  }

  private warState() {
    const w = this.world, c = this.player, a = w.armies.cols, cc = w.countries.cols;
    const armies = [];
    for (let i = 0; i < w.armies.size; i++) if (a.alive![i]) armies.push({ id: i, country: a.country![i]!, prov: a.prov![i]!, strength: a.strength![i]!, org: a.org![i]!, target: a.target![i]!, battle: a.battle![i]!, auto: a.auto![i] === 1 });
    const fieldedMen = armies.filter((x) => x.country === c).reduce((s, x) => s + x.strength, 0);
    const diplomacy = [];
    for (let k = 0; k < w.countries.size; k++) {
      if (k === c || cc.capital![k]! < 0) continue;
      const cb = casusBelli(w, c, k);
      diplomacy.push({ country: k, rel: rel(w, c, k), alliance: allied(w, c, k), guaranteesUs: guarantees(w, k, c), weGuarantee: guarantees(w, c, k), trade: hasTrade(w, c, k), truce: truceWith(w, c, k), war: !!warBetween(w, c, k), cb: cb ? `${cb.type}: ${w.provinceNames[cb.province]}` : null, rival: w.rivals[c]!.includes(k), overlord: cc.overlord![c] === k, puppet: cc.overlord![k] === c, power: militaryPower(w, k) });
    }
    const wars = w.wars.filter((x) => x.end < 0).map((x) => ({ id: x.id, name: x.name, attackers: x.attackers, defenders: x.defenders, score: x.score, start: formatDate(x.start), ours: x.attackers.includes(c) || x.defenders.includes(c), side: x.attackers.includes(c) ? "attacker" as const : x.defenders.includes(c) ? "defender" as const : null, goal: x.goal.province }));
    const ourWars = new Set(wars.filter((x) => x.ours).map((x) => x.id));
    const battles = w.battles.filter((b) => ourWars.has(b.war) || b.attacker === c || b.defender === c).slice(-15).reverse().map((b) => ({ ...b, provName: w.provinceNames[b.prov]!, date: formatDate(b.start) }));
    return {
      armies, controller: Array.from(w.provinces.cols.controller!), diplomacy, wars, battles, claims: [...w.claims[c]!], rivals: [...w.rivals[c]!],
      tech: { years: Array.from({ length: N_TREES }, (_, k) => techYear(w, c, k)), slots: ideaSlots(w, c), ideas: w.ideas[c]!.map((x) => ({ ...x })), blockers: IDEAS.groups.map((_, g) => ideaBlocker(w, c, g)) },
      military: { equip: cc.equip![c]!, manpower: cc.manpower![c]!, fielded: fieldedMen, exhaustion: cc.warExhaustion![c]!, nukes: cc.nukes![c]!, power: militaryPower(w, c) },
    };
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
      focus: this.focusState(),
      events: w.pendingEvents.filter((p) => p.country === c).map((p) => {
        const e = EVENT_BY_ID.get(p.event)!, x = { w, c, bind: p.bind }, names = this.countries.map((k) => k.name);
        return { id: p.id, title: fill(e.title, x, names), description: fill(e.description, x, names), choices: e.choices.map((ch) => ({ name: fill(ch.name, x, names), effects: ch.effects.map(describeEffect).filter(Boolean) })) };
      }),
      ambitions: (w.ambitions[c] ?? []).map((a) => { const d = AMBITIONS.find((x) => x.id === a.id)!; return { name: d.name, description: d.description, done: a.done >= 0 }; }),
      headlines: this.headlines(),
      ...this.warState(),
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
