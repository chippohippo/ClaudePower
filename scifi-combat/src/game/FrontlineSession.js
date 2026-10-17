// FrontlineSession: builds and runs a Battlefront-style frontline match for 64-128 fighters.
// Simulation only, so the browser client, headless tests and benchmarks run the exact same match.
//
//  * Build: seeded map (terrain, cover, nav) → CombatWorld with spatial queries → FrontlineMode →
//    two factions of fighters from the class rosters, in squads of 4 → a commander per team →
//    a tactical map (cover spots), suppression tracking and a SquadTactics plan per squad →
//    vehicle pads at the HQs.
//  * Step (fixed 60 Hz): bot think (LOD by distance from the humans: near every tick, mid every
//    2nd, far every 3rd, with the last command held in between) → the same per-fighter pipeline
//    players use (vehicles, movement, abilities, sword, guns) → world (projectiles, zones,
//    deployables, vehicles) → melee resolve → mode → commanders → suppression → squad plans →
//    reinforcement waves.
//  * Reinforcements: the dead come back in waves, on their squad leader when it's safe, otherwise
//    at the safe spawn nearest their front. Every death costs a ticket.

import { Vector3 } from 'three';
import { bus } from '../core/EventBus.js';
import { CombatWorld } from '../combat/CombatWorld.js';
import { MeleeSystem } from '../combat/melee/MeleeSystem.js';
import { revertTransform } from '../combat/TransformSystem.js';
import { CombatBotBrain } from '../ai/CombatBotBrain.js';
import { FrontlineCommander, Squad } from '../ai/FrontlineCommander.js';
import { routeCommand, stripButtons } from '../core/routing.js';
import { buildFighter } from './FighterFactory.js';
import { generateFrontlineMap } from './frontline/FrontlineMap.js';
import { mapSizeFor } from './frontline/MapSizes.js';
import { WireField } from '../world/WireField.js';
import { FrontlineMode } from './frontline/FrontlineMode.js';
import { TacticalMap } from '../ai/tactics/TacticalMap.js';
import { Suppression } from '../ai/tactics/Suppression.js';
import { SquadTactics } from '../ai/tactics/SquadTactics.js';
import { FortifySystem } from './frontline/Fortify.js';

const NONE = Object.freeze({ down: false, pressed: false, released: false });

export class FrontlineSession {
  /**
   * @param {object} data  { movement, weaponFiles, attachments, recoil, statuses, meleeWeapons, kits, classes,
   *                         damageMatrix, supers, vehicleDefs, personalities, difficulty }
   * @param {object} o     { size: '4v4' | '12v12' | '32v32' | '64v64' (or players: the size built for that count),
   *                         seed, humans: [{ id, team, classId }], tickets, waveInterval, timeLimit, lod }
   */
  constructor(data, { size = null, players = null, seed = 1, humans = [], tickets = null, waveInterval = null, timeLimit = null, lod = { near: 60, mid: 160 } } = {}) {
    const profile = mapSizeFor(size, players), M = profile.match;
    players = players ?? profile.players;
    this.data = data;
    this.seed = seed;
    this.size = profile.id;
    this.players = players;
    this.lodCfg = lod;
    this.waveInterval = waveInterval ?? M.waveInterval;
    this.squadSize = M.squadSize;
    this.map = generateFrontlineMap({ seed, size: profile.id });
    this.world = new CombatWorld({
      damageMatrix: data.damageMatrix, cover: this.map.cover, terrain: this.map.terrain, nav: this.map.nav,
      supers: data.supers, meleeWeapons: data.meleeWeapons, recoilDefs: data.recoil, vehicleDefs: data.vehicleDefs, statusDefs: data.statuses,
      down: data.down,
    });
    this.mode = new FrontlineMode(this.map, {
      tickets: tickets ?? Math.round(players * M.ticketsPerPlayer), timeLimit: timeLimit ?? M.timeLimit,
      captureTime: M.captureTime, secureTime: M.secureTime, seed,
    });
    this.world.mode = this.mode;
    this.world.wire = new WireField(this.map.wire);
    this.melee = new MeleeSystem();
    this.fighters = [];
    this.bots = [];
    this.humans = new Map();          // id -> latest command
    this.lastCmd = new Map();         // bot id -> last command (held between LOD thinks)
    this.squads = [[], []];
    this.time = 0; this.tick = 0;
    this.waveTimer = [this.waveInterval, this.waveInterval];
    this.focus = [];                  // positions that keep bots at full think rate (human cameras)
    this.stats = { thinks: 0, simMs: 0 };
    this.#roster(players, humans);
    this.commanders = [0, 1].map((t) => { const c = new FrontlineCommander(t, this.mode, { nav: this.map.nav }); c.squads = this.squads[t]; return c; });
    // Squad tactics: where the cover is, who is pinned down, and a leader's plan per squad.
    this.tactical = new TacticalMap(this.map);
    this.suppression = new Suppression(this.world);
    this.fortify = this.world.fortify = new FortifySystem(this.world, this.map, { cap: M.fortCap ?? 24, tmap: this.tactical });
    for (const team of [0, 1]) for (const sq of this.squads[team]) {
      sq.tactics = new SquadTactics(sq, { world: this.world, map: this.map, tmap: this.tactical, mode: this.mode, commander: this.commanders[team], seed });
    }
    for (const pad of this.map.pads) this.world.vehicles.addPad(pad);
    // Flow fields for every point up front (~25 ms each), so orders never hitch mid-battle.
    for (const p of this.map.points) this.map.nav.field(`pt:${p.id}`, p.pos.x, p.pos.z, p.radius * 0.6);
    this.off = [bus.on('entity:death', (e) => this.#onDeath(e))];
    // Everyone deploys at the start of the match, each squad together at one spawn.
    for (const team of [0, 1]) for (const sq of this.squads[team]) {
      const at = this.mode.spawnPosition(team, () => false, new Vector3());
      for (const f of sq.members) this.#deploy(f, true, at);
    }
    this.world.refreshSpatial();
    for (const c of this.commanders) c.update(0);
  }

  dispose() {
    this.off.forEach((f) => f());
    for (const b of this.bots) b.brain.dispose();
    for (const c of this.commanders) c.dispose();
    this.tactical.dispose(); this.suppression.dispose();
  }

  #roster(players, humans) {
    const d = this.data;
    const perTeam = Math.floor(players / 2);
    let id = 1;
    for (const team of [0, 1]) {
      const classes = d.classes[team].classes.map((c) => c.id);
      const teamHumans = humans.filter((h) => h.team === team);
      for (let i = 0; i < perTeam; i++) {
        const human = teamHumans[i];
        const classId = human?.classId ?? classes[(i * 7 + team * 3) % classes.length];
        const f = buildFighter(this.world, d, { id: human?.id ?? 1000 + id, team, classId, pos: this.map.hq[team].clone() });
        id++;
        f.name = classId.replace('_', '-');
        f.respawnAt = 0;
        this.melee.add(f.melee);
        this.fighters.push(f);
        if (human) this.humans.set(f.id, null);
        else {
          const persona = d.personalities[f.ai] ?? Object.values(d.personalities)[0];
          f.brain = new CombatBotBrain(f, this.world, persona, d.difficulty, { seed: this.seed * 1000 + f.id });
          this.bots.push(f);
        }
      }
      // Squads in roster order (humans lead their squad).
      const members = this.fighters.filter((f) => f.team === team), n = this.squadSize;
      for (let i = 0; i < members.length; i += n) {
        const sq = new Squad(team, this.squads[team].length, members.slice(i, i + n));
        for (const m of sq.members) m.squad = sq;
        this.squads[team].push(sq);
      }
    }
  }

  /** A human's command for the next tick (from InputManager). */
  setCommand(id, cmd) { this.humans.set(id, cmd); }

  // ---------------------------------------------------------------- step
  step(dt) {
    const t0 = performance.now();
    this.time += dt; this.tick++;
    const w = this.world;
    for (const f of this.fighters) { f.status.update(dt); f.health.update(dt); }
    for (const f of this.fighters) {
      if (f.health.dead) { f.movement.simulateCorpse(dt); continue; } // bodies keep falling until they rest
      let cmd;
      if (f.brain) cmd = this.#think(f, dt);
      else cmd = this.humans.get(f.id) ?? EMPTY;
      if (!Number.isFinite(cmd.yaw + cmd.pitch + cmd.moveX + cmd.moveY)) cmd = { ...cmd, yaw: Number.isFinite(cmd.yaw) ? cmd.yaw : f.movement.state.yaw, pitch: Number.isFinite(cmd.pitch) ? cmd.pitch : 0, moveX: Number.isFinite(cmd.moveX) ? cmd.moveX : 0, moveY: Number.isFinite(cmd.moveY) ? cmd.moveY : 0 }; // never let a bad number into the sim
      // Reviving a teammate or digging in owns the tick: kneel, no moving, shooting or casting.
      if (w.revives.handleInput(f, cmd, dt)) { cmd = kneeling(cmd); f.movement.kneel(); }
      else if (this.fortify.handleInput(f, cmd, dt)) { cmd = kneeling(cmd); f.movement.kneel(); }
      if (w.vehicles.handleInput(f, cmd)) { f.movement.update(cmd, dt); continue; }
      const c = f.status.rooted ? stripButtons(cmd, []) : cmd;
      const r = routeCommand(f, c);
      f.movement.update(c, dt);
      const p = f.movement.state.position;
      f.movement.state.speedScale = f.status.speedMul * (w.wire ? w.wire.slowAt(p.x, p.z) : 1); // wire: slow, no sprint
      f.abilities.update(c, dt); f.melee.update(r.meleeCmd, dt); f.weapons.update(r.gunCmd, dt);
    }
    w.update(dt);
    this.melee.resolve();
    this.mode.update(dt, this.fighters, w);
    for (const c of this.commanders) c.update(dt);
    this.suppression.update(dt, this.fighters);
    for (const team of this.squads) for (const sq of team) sq.tactics.update(dt);
    this.#reinforce(dt);
    this.map.nav.maintain(4000); // flow-field refresh after cover breaks, sliced by a work budget
    this.stats.simMs = performance.now() - t0;
  }

  /** Think-rate LOD: bots far from every human camera think less often and hold their last command. */
  #think(f, dt) {
    const p = f.movement.state.position;
    let near = Infinity;
    for (const q of this.focus) near = Math.min(near, Math.abs(q.x - p.x) + Math.abs(q.z - p.z));
    const every = this.focus.length === 0 ? 2 : near < this.lodCfg.near ? 1 : near < this.lodCfg.mid ? 2 : 3;
    const last = this.lastCmd.get(f.id);
    if (last && (this.tick + f.id) % every !== 0) return hold(last);
    this.stats.thinks++;
    const cmd = f.brain.think(dt * (last ? every : 1), this.tick);
    this.lastCmd.set(f.id, cmd);
    return cmd;
  }

  // ---------------------------------------------------------------- deaths and reinforcements
  #onDeath(e) {
    const f = this.fighters.find((x) => x.id === e.id);
    if (!f) return;
    this.mode.onDeath(f.team);
    f.respawnAt = this.time + 4;
    this.lastCmd.delete(f.id);
  }

  #reinforce(dt) {
    for (const team of [0, 1]) {
      this.waveTimer[team] -= dt;
      if (this.waveTimer[team] > 0) continue;
      this.waveTimer[team] = this.waveInterval;
      if (this.mode.winner >= 0 || this.mode.tickets[team] <= 0) continue;
      for (const f of this.fighters) if (f.team === team && f.health.dead && this.time >= f.respawnAt && !this.humans.has(f.id)) this.#deploy(f);
    }
  }

  /** The safe spawn nearest the rest of the squad (so a reinforcement rejoins it), else the front's. */
  #squadSpawn(f, enemiesNear, out) {
    const mates = f.squad?.members.filter((m) => m !== f && !m.health.dead && !m.vehicle) ?? [];
    if (!mates.length) return this.mode.spawnPosition(f.team, enemiesNear, out);
    const c = new Vector3();
    for (const m of mates) c.add(m.movement.state.position);
    c.divideScalar(mates.length);
    let best = null, bd = Infinity;
    for (const [i, s] of this.map.sectors.entries()) {
      if (this.mode.sectors[i].owner !== f.team || s.kind !== 'line') continue;
      for (const p of [...s.spawns[f.team], ...s.rearSpawns[f.team]]) {
        if (enemiesNear(p)) continue;
        const d = Math.hypot(p.x - c.x, p.z - c.z);
        if (d < bd) { bd = d; best = p; }
      }
    }
    if (!best) return this.mode.spawnPosition(f.team, enemiesNear, out);
    return out.set(best.x + (this.mode.rand() - 0.5) * 6, best.y, best.z + (this.mode.rand() - 0.5) * 6);
  }

  /** Human respawn request (the client decides when). */
  respawn(id) { const f = this.fighters.find((x) => x.id === id); if (f?.health.dead && this.time >= f.respawnAt) this.#deploy(f); }

  #deploy(f, initial = false, near = null) {
    const w = this.world, team = f.team;
    if (f.vehicle) w.vehicles.exit(f);
    revertTransform(f, 'respawn');
    const enemiesNear = (p) => { let found = false; w.fightersNear(p, 25, (e) => { if (!found && e.team !== team && !e.health.dead && e.movement.state.position.distanceTo(p) < 25) found = true; }); return found; };
    const pos = new Vector3();
    const lead = f.squad?.leader;
    // On the squad leader when it's safe (alive, on foot, not under fire, no enemy close).
    if (near) pos.set(near.x + (this.mode.rand() - 0.5) * 7, 0, near.z + (this.mode.rand() - 0.5) * 7);
    else if (!initial && lead && lead !== f && !lead.vehicle && !lead.health.dead && !lead.health.downed && lead.health.sinceDamage > 3 && !enemiesNear(lead.movement.state.position)) {
      const lp = lead.movement.state.position;
      pos.set(lp.x + (this.mode.rand() - 0.5) * 4, 0, lp.z + (this.mode.rand() - 0.5) * 4);
    } else this.#squadSpawn(f, enemiesNear, pos);
    pos.y = w.groundHeight(new Vector3(pos.x, pos.y + 50, pos.z));
    f.movement.reset(pos, team === 0 ? -Math.PI / 2 : Math.PI / 2);
    if (f.health.dead) f.health.revive(1);
    f.health.shield = f.health.maxShield;
    f.status.cleanse();
    bus.emit('fighter:deploy', { id: f.id, team, pos: pos.toArray() });
  }
}

const EMPTY = Object.freeze({ moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons: {} });
/** A reviver's command: keep looking where they look, nothing else (interact stays held for the job). */
function kneeling(cmd) { return { ...cmd, moveX: 0, moveY: 0, buttons: { interact: cmd.buttons.interact ?? NONE } }; }
/** The last command with its edges removed: held buttons stay held, nothing is pressed twice. */
function hold(cmd) {
  const b = {};
  for (const k in cmd.buttons) b[k] = cmd.buttons[k].down ? HELD : NONE;
  return { ...cmd, buttons: b };
}
const HELD = Object.freeze({ down: true, pressed: false, released: false });
