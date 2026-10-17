// FrontlineMode: Battlefront-style frontline rules for 64-128 players. Simulation only.
//
//  * The map is a line of sectors: Team 0 HQ | line sectors | Team 1 HQ. Each team owns the
//    sectors behind its front. The middle sector starts neutral.
//  * Each team attacks the sector in front of its own front (both race for the neutral middle;
//    after that, each attacks the other's front sector while defending its own). Only points in
//    attacked sectors can change hands; everything behind the lines is locked.
//  * Capturing: soldiers inside a point's radius push its progress by their headcount difference
//    (capped at 3). One soldier takes a neutral point in `captureTime` seconds; an enemy point
//    has to be neutralized first (twice as long). Defenders on their own point cancel attackers.
//  * Owning every point of the attacked sector for `secureTime` captures the sector: the front
//    moves up, the loser falls back to its previous sector, and the attacker gets reinforcements.
//  * Losing the last line sector in front of your HQ is a breakthrough: defeat. So is running out
//    of tickets (one per death). At the time limit, the team holding more of the line wins.
//  * Spawns follow the front: each team spawns at the safe spawn closest to its front.
// Events: mode:point, mode:sector, mode:front, mode:tickets, mode:victory.

import { Vector3 } from 'three';
import { bus } from '../../core/EventBus.js';
import { mulberry32 } from '../../world/Terrain.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const DIR = [1, -1];   // team 0 pushes toward +X (higher sector indices), team 1 toward -X

export class FrontlineMode {
  /**
   * @param {object} map  generateFrontlineMap() output
   * @param {object} o    { tickets, sectorBonus, captureTime, secureTime, timeLimit, regen, seed }
   */
  constructor(map, { tickets = 400, sectorBonus = 30, captureTime = 10, secureTime = 3, timeLimit = 1500, regen = 0.04, seed = 1 } = {}) {
    this.map = map;
    this.cfg = { tickets, sectorBonus, captureTime, secureTime, timeLimit, regen };
    this.rand = mulberry32(seed * 31 + 7);
    const last = map.sectors.length - 1;
    this.sectors = map.sectors.map((s) => ({ index: s.index, kind: s.kind, owner: s.kind === 'hq' ? (s.index === 0 ? 0 : 1) : -1, points: s.points, secure: [0, 0] }));
    // Initial lines: everything left of the middle is Team 0's, right is Team 1's, the middle is neutral.
    const mid = Math.floor(last / 2);
    for (const s of this.sectors) if (s.kind !== 'hq') s.owner = s.index < mid ? 0 : s.index > mid ? 1 : -1;
    this.front = [mid - 1, mid + 1];
    this.points = map.points.map((p) => {
      const owner = this.sectors[p.sector].owner;
      return { id: p.id, name: p.name, sector: p.sector, pos: p.pos, radius: p.radius, owner, progress: owner === 0 ? 1 : owner === 1 ? -1 : 0, counts: [0, 0], contested: false, capturing: -1 };
    });
    this.tickets = [tickets, tickets];
    this.time = 0;
    this.winner = -1;
    this.reason = null;
  }

  attackSector(team) { return this.front[team] + DIR[team]; }
  isAttacked(sectorIndex) { return this.attackSector(0) === sectorIndex || this.attackSector(1) === sectorIndex; }
  capturable(p) { return this.winner < 0 && this.isAttacked(p.sector); }

  /** Points a team is attacking (enemy or neutral) and defending (its own, under attack). */
  objectives(team) {
    const atk = this.attackSector(team), def = this.attackSector(1 - team);
    return {
      attack: this.points.filter((p) => p.sector === atk),
      defend: this.points.filter((p) => p.sector === def && p.owner === team),
    };
  }

  /**
   * @param {number} dt
   * @param {Iterable} fighters  all fighters (soldiers); presence counts alive soldiers not inside hulls
   * @param {object} world       CombatWorld (spatial queries when available)
   */
  update(dt, fighters, world = null) {
    if (this.winner >= 0) return;
    this.time += dt;
    const { captureTime, regen } = this.cfg;
    for (const p of this.points) {
      if (!this.capturable(p)) { p.counts[0] = p.counts[1] = 0; p.contested = false; p.capturing = -1; continue; }
      const c = p.counts; c[0] = c[1] = 0;
      const count = (e) => {
        if (e.isVehicle || e.isDeployable || e.health?.dead || e.health?.downed || (e.vehicle && !e.vehicle.exposed) || e.team === undefined) return;
        const q = e.movement.state.position;
        if (Math.abs(q.y - p.pos.y) > 4 || Math.hypot(q.x - p.pos.x, q.z - p.pos.z) > p.radius) return;
        c[e.team]++;
      };
      if (world?.spatial) world.fightersNear(p.pos, p.radius, count); else for (const e of fighters) count(e);
      const diff = clamp(c[0] - c[1], -3, 3);
      const was = p.owner, wasContested = p.contested;
      p.contested = c[0] > 0 && c[1] > 0;
      if (diff !== 0) {
        p.progress = clamp(p.progress + (diff / captureTime) * dt, -1, 1);
        p.capturing = diff > 0 ? 0 : 1;
      } else {
        // Nobody (or a stalemate): owned points slowly recover, neutral progress ebbs away.
        const home = p.owner === 0 ? 1 : p.owner === 1 ? -1 : 0;
        if (!p.contested) p.progress += clamp(home - p.progress, -regen * dt, regen * dt);
        p.capturing = -1;
      }
      if (p.owner === 0 && p.progress <= 0) p.owner = -1;
      else if (p.owner === 1 && p.progress >= 0) p.owner = -1;
      if (p.progress >= 1) p.owner = 0; else if (p.progress <= -1) p.owner = 1;
      if (p.owner !== was) bus.emit('mode:point', { point: p.id, name: p.name, owner: p.owner, from: was });
      if (p.contested !== wasContested) bus.emit('mode:contested', { point: p.id, on: p.contested });
    }
    // Sector capture: the attacker owns every point of the attacked sector for secureTime.
    for (const team of [0, 1]) {
      const s = this.sectors[this.attackSector(team)];
      if (!s || s.kind === 'hq') continue;
      // Per-team timers: both teams attack the neutral middle sector at the same time.
      const all = s.points.length > 0 && s.points.every((id) => this.points[id].owner === team);
      s.secure[team] = all ? s.secure[team] + dt : 0;
      if (s.secure[team] >= this.cfg.secureTime) this.#captureSector(s, team);
      if (this.winner >= 0) return;
    }
    if (this.time >= this.cfg.timeLimit) {
      const held = [0, 1].map((t) => this.sectors.filter((s) => s.kind !== 'hq' && s.owner === t).length);
      this.#win(held[0] !== held[1] ? (held[0] > held[1] ? 0 : 1) : this.tickets[0] >= this.tickets[1] ? 0 : 1, 'time');
    }
  }

  #captureSector(s, team) {
    const enemy = 1 - team, was = s.owner;
    s.owner = team; s.secure[0] = s.secure[1] = 0;
    this.front[team] = s.index;
    // If it was the enemy's front, their line falls back one sector.
    if (was === enemy) this.front[enemy] = s.index + DIR[team];
    this.tickets[team] += this.cfg.sectorBonus;
    // Points behind the new lines lock to their sector's owner (half-taken points don't linger).
    for (const p of this.points) {
      if (this.isAttacked(p.sector)) continue;
      const owner = this.sectors[p.sector].owner;
      if (p.owner !== owner) bus.emit('mode:point', { point: p.id, name: p.name, owner, from: p.owner });
      p.owner = owner; p.progress = owner === 0 ? 1 : owner === 1 ? -1 : 0; p.counts[0] = p.counts[1] = 0; p.contested = false;
    }
    bus.emit('mode:sector', { sector: s.index, team, from: was });
    bus.emit('mode:front', { front: [...this.front] });
    bus.emit('mode:tickets', { tickets: [...this.tickets] });
    // The defender's new front: if that's its HQ, the line is broken.
    if (this.sectors[this.front[enemy]]?.kind === 'hq') this.#win(team, 'breakthrough');
  }

  /** A soldier of `team` died: one reinforcement ticket. */
  onDeath(team) {
    if (this.winner >= 0 || team < 0) return;
    this.tickets[team] = Math.max(0, this.tickets[team] - 1);
    bus.emit('mode:tickets', { tickets: [...this.tickets] });
    if (this.tickets[team] <= 0) this.#win(1 - team, 'tickets');
  }

  #win(team, reason) {
    if (this.winner >= 0) return;
    this.winner = team; this.reason = reason;
    bus.emit('mode:victory', { team, reason, time: this.time });
  }

  /**
   * A spawn position for `team`: the safe spawn nearest the team's front (no enemy within
   * `safeRadius`), falling back sector by sector toward the HQ.
   */
  spawnPosition(team, enemiesNear = () => false, out = new Vector3()) {
    for (let i = this.front[team]; i >= 0 && i < this.sectors.length; i -= DIR[team]) {
      const sec = this.map.sectors[i];
      if (this.sectors[i].owner !== team) continue;
      const groups = sec.kind === 'hq' ? [[this.map.hq[team]]] : [sec.spawns[team], sec.rearSpawns?.[team] ?? []];
      for (const list of groups) {
        const safe = list.filter((p) => !enemiesNear(p));
        if (safe.length || sec.kind === 'hq') {
          const p = (safe.length ? safe : list)[Math.floor(this.rand() * (safe.length || list.length))];
          return out.set(p.x + (this.rand() - 0.5) * 6, p.y, p.z + (this.rand() - 0.5) * 6);
        }
      }
    }
    return out.copy(this.map.hq[team]);
  }

  /** Compact state for HUDs and network snapshots. */
  snapshot() {
    return {
      time: this.time, tickets: [...this.tickets], front: [...this.front], winner: this.winner, reason: this.reason,
      sectors: this.sectors.map((s) => ({ owner: s.owner, secure: Math.max(...s.secure) / this.cfg.secureTime })),
      points: this.points.map((p) => ({ id: p.id, owner: p.owner, progress: +p.progress.toFixed(3), counts: [...p.counts], contested: p.contested, capturable: this.capturable(p) })),
    };
  }
}
