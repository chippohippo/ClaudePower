// Logistics: the supply war (match sizes with `support` in MapSizes). Simulation only.
//
//  * Supplies are produced at each team's HQ dump (`production` a minute, up to `hqCap`) and have
//    to be hauled to the front. Supply trucks load at the HQ dump and unload at the team's forward
//    depot. That depot sits in the team's front sector and moves with the front: it keeps 75% of
//    its stock when the front moves up, and 30% when it is overrun. A truck standing still inside a
//    depot loads or unloads by itself (RATE a second).
//  * The front lives off the forward depot:
//      - ammo: soldiers refill their guns at any depot of theirs (fast), and in the trenches on
//        their own side of the line (slowly: runners bring it up the communication trenches).
//        Batteries within BATTERY_REACH of a depot reload from it;
//      - sandbags (Fortify) and every vehicle or gun that comes back from the motor pool or the
//        park cost supplies (COST).
//    With an empty depot the guns go quiet, rifles run dry and tanks stop coming. A soldier who
//    redeploys always brings a full loadout (that comes from the HQ).
//  * Interdiction: a destroyed truck loses its cargo, and every shell that lands in a depot burns
//    some of its stock.
// Events: logistics:load / logistics:unload { truck, team, amount, depot }, logistics:moved
//         { team, depot, stock }, logistics:lost { team, amount, what }, logistics:short { team, what }.

import { Vector3 } from 'three';
import { bus } from '../../core/EventBus.js';

/** Supplies each thing costs. Rounds are per shell or rocket; a magazine is one magazine's worth. */
export const COST = {
  tank: 120, hoverbike: 25, recon: 35, howitzer: 70, rockets: 90, at: 40, truck: 0,
  sandbags: 6, mag: 1, howitzerRound: 2, rocketsRound: 1, atRound: 2,
};
const RATE = 25;                 // supplies a second a truck loads or unloads
const DEPOT_R = 10, HQ_R = 13;   // metres: a truck parked inside a depot is loading or unloading
const BATTERY_REACH = 320;       // metres from a depot that ammo carriers will run shells (AT guns sit up by the line)
const SHELL_BURN = 8;            // stock a shell burns when it lands in a depot (scaled by its burst)
const DIR = [1, -1];

export class Logistics {
  /**
   * @param {CombatWorld} world
   * @param {object} map    generateFrontlineMap() output (with .support)
   * @param {FrontlineMode} mode
   */
  constructor(world, map, mode) {
    const S = map.support;
    this.world = world; this.map = map; this.mode = mode; this.cfg = S;
    this.depots = [];
    for (const team of [0, 1]) {
      this.depots.push({ id: `hq${team}`, team, kind: 'hq', pos: map.hqDepot[team].clone(), radius: HQ_R, stock: S.hqStart, cap: S.hqCap, sector: map.sectors[team === 0 ? 0 : map.sectors.length - 1].index });
      const sec = map.sectors[mode.front[team]];
      this.depots.push({ id: `front${team}`, team, kind: 'front', pos: (sec?.depot?.[team] ?? map.hqDepot[team]).clone(), radius: DEPOT_R, stock: S.frontStart, cap: S.frontCap, sector: sec?.index ?? -1 });
    }
    this.trench = this.#trenchGrid(map);
    this.clock = 0;
    this.lastOut = [-1e9, -1e9];  // when each team's last loaded truck left the HQ dump (see spacing)
    this.debt = [0, 0];          // fractional supplies owed (rounds and magazines cost fractions)
    this.carried = new Map();    // truck id -> { mode, amount, depot } for load/unload events
    this.shortAt = new Map();    // `${team}:${what}` -> time of the last shortage event
    this.offs = [
      bus.on('mode:front', () => this.#follow()),
      bus.on('artillery:impact', (e) => this.#shelled(e)),
      bus.on('vehicle:destroyed', (e) => this.#truckLost(e)),
    ];
  }

  dispose() { this.offs.forEach((f) => f()); }

  hq(team) { return this.depots[team * 2]; }
  front(team) { return this.depots[team * 2 + 1]; }

  /** Pay `n` supplies out of the team's forward depot (or the HQ dump if the front has no depot). */
  spend(team, n, what = 'supplies') {
    if (n <= 0) return true;
    const d = this.front(team).sector >= 0 ? this.front(team) : this.hq(team);
    if (d.stock < n) { this.#short(team, what); return false; }
    d.stock -= n;
    return true;
  }

  /** Fractional costs (rounds, magazines) add up and come off the depot a whole supply at a time. */
  #charge(team, d, n) {
    this.debt[team] += n;
    const whole = Math.floor(this.debt[team]);
    if (whole > 0) { d.stock = Math.max(0, d.stock - whole); this.debt[team] -= whole; }
  }

  #short(team, what) {
    const k = `${team}:${what}`, t = this.mode.time;
    if (t - (this.shortAt.get(k) ?? -1e9) < 10) return;
    this.shortAt.set(k, t);
    bus.emit('logistics:short', { team, what });
  }

  update(dt, fighters) {
    this.clock += dt;
    for (const team of [0, 1]) { const h = this.hq(team); h.stock = Math.min(h.cap, h.stock + (this.cfg.production / 60) * dt); }
    this.#trucks(dt);
    // Ammo and batteries: every half second, staggered by soldier.
    const tick = Math.floor(this.clock * 60);
    for (const f of fighters) if ((tick + f.id) % 30 === 0) this.#resupply(f);
    if (tick % 60 === 0) this.#batteries();
  }

  // ---------------------------------------------------------------- trucks
  #trucks(dt) {
    for (const v of this.world.vehicles.list) {
      if (v.removed || !v.def.cargo) continue;
      const s = v.movement.state, still = Math.hypot(s.velocity.x, s.velocity.z) < 1.2;
      let moved = 0, at = null, mode = null;
      if (still) {
        for (const d of this.depots) {
          if (d.team !== v.team || Math.hypot(d.pos.x - s.position.x, d.pos.z - s.position.z) > d.radius) continue;
          at = d;
          if (d.kind === 'hq') { mode = 'load'; moved = Math.min(RATE * dt, v.def.cargo - v.cargo, d.stock); v.cargo += moved; d.stock -= moved; }
          else { mode = 'unload'; moved = Math.min(RATE * dt, v.cargo, d.cap - d.stock); v.cargo -= moved; d.stock += moved; }
          break;
        }
      }
      // One event per visit, when the truck has finished (or drives off).
      const c = this.carried.get(v.id);
      if (c && (c.mode !== mode || c.depot !== at || moved <= 1e-6)) {
        if (c.amount >= 1) bus.emit(`logistics:${c.mode}`, { truck: v.id, team: v.team, amount: Math.round(c.amount), depot: c.depot.id, cargo: Math.round(v.cargo) });
        this.carried.delete(v.id);
      }
      if (moved > 1e-6) {
        const cur = this.carried.get(v.id) ?? { mode, amount: 0, depot: at };
        cur.amount += moved;
        this.carried.set(v.id, cur);
      }
    }
  }

  #truckLost(e) {
    const v = this.world.vehicles.list.find((x) => x.id === e.id);
    if (v?.def.cargo && v.cargo >= 1) bus.emit('logistics:lost', { team: v.team, amount: Math.round(v.cargo), what: 'truck' });
  }

  // ---------------------------------------------------------------- the front
  /** The front moved: each team's forward depot moves to its new front sector. */
  #follow() {
    for (const team of [0, 1]) {
      const d = this.front(team), si = this.mode.front[team], sec = this.map.sectors[si];
      if (!sec || si === d.sector) continue;
      const advanced = (si - d.sector) * DIR[team] > 0;
      const lost = d.stock * (advanced ? 0.25 : 0.7);
      d.stock -= lost;
      d.sector = si;
      d.pos.copy(sec.depot?.[team] ?? this.map.hqDepot[team]);
      if (lost >= 1) bus.emit('logistics:lost', { team, amount: Math.round(lost), what: advanced ? 'move' : 'overrun' });
      bus.emit('logistics:moved', { team, depot: d.id, at: d.pos.toArray(), stock: Math.round(d.stock), sector: si, advanced });
    }
  }

  #shelled(e) {
    for (const d of this.depots) {
      const dist = Math.hypot(d.pos.x - e.point[0], d.pos.z - e.point[2]);
      if (dist > d.radius + 6 || d.stock <= 0) continue;
      const burn = Math.min(d.stock, SHELL_BURN * Math.max(0.5, (e.radius || 6) / 9));
      d.stock -= burn;
      bus.emit('logistics:lost', { team: d.team, amount: Math.round(burn), what: 'shelled', depot: d.id });
    }
  }

  // ---------------------------------------------------------------- ammo
  /** Is (x, z) inside a trench (fire bay, traverse, communication trench or dugout)? */
  inTrench(x, z) {
    const G = this.trench;
    if (!G) return false;
    const ix = Math.floor((x - G.minX) / G.cell), iz = Math.floor((z - G.minZ) / G.cell);
    if (ix < 0 || iz < 0 || ix >= G.nx || iz >= G.nz || !G.cells[iz * G.nx + ix]) return false;
    for (const r of G.rects[G.cells[iz * G.nx + ix] - 1]) if (x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3]) return true;
    return false;
  }

  /** On a team's own side of the line (behind its front, with the front-line trench). */
  ownSide(team, x) {
    const sec = this.map.sectors[this.mode.front[team]];
    if (!sec) return false;
    return team === 0 ? x <= sec.x1 + 6 : x >= sec.x0 - 6;
  }

  #resupply(f) {
    if (f.health.dead || f.vehicle || !f.weapons?.missing) return;
    // Stims and ammo packs come from the dumps too (free: they're light).
    if (f.items && f.items.left < f.items.max) {
      const q = f.movement.state.position;
      if (this.depots.some((d) => d.team === f.team && Math.hypot(d.pos.x - q.x, d.pos.z - q.z) < d.radius + 4)) this.world.support?.refill(f);
    }
    const miss = f.weapons.missing();
    if (miss < 0.5) return;
    const p = f.movement.state.position;
    let d = null;
    for (const q of this.depots) if (q.team === f.team && Math.hypot(q.pos.x - p.x, q.pos.z - p.z) < q.radius + 4) { d = q; break; }
    let mags = 0;
    if (d) mags = 1;                                                     // at a dump: a magazine every half second
    else if (this.ownSide(f.team, p.x) && this.inTrench(p.x, p.z)) {     // in our trenches: one every 4 s
      d = this.front(f.team);
      if (d.sector < 0) return;
      f.trenchSupply = (f.trenchSupply ?? 0) + 0.125;
      if (f.trenchSupply < 1) return;
      f.trenchSupply -= 1; mags = 1;
    }
    if (!mags) return;
    if (d.stock < COST.mag) { this.#short(f.team, 'ammo'); return; }
    const got = f.weapons.resupply(mags);
    if (got > 0) { this.#charge(f.team, d, got * COST.mag); bus.emit('logistics:resupplied', { id: f.id, team: f.team, mags: got, depot: d.id }); }
  }

  /** Batteries reload from the nearest depot of theirs within reach: a round a second each. */
  #batteries() {
    for (const v of this.world.vehicles.list) {
      const G = v.gun;
      if (v.removed || !G || G.ammo >= (v.def.gun.ammoMax ?? G.ammo)) continue;
      const p = v.movement.state.position;
      let d = null, bd = BATTERY_REACH;
      for (const q of this.depots) { if (q.team !== v.team) continue; const dist = Math.hypot(q.pos.x - p.x, q.pos.z - p.z); if (dist < bd) { bd = dist; d = q; } }
      if (!d) continue;
      const cost = COST[`${v.def.gun.kind}Round`] ?? 2;
      if (d.stock < cost) { this.#short(v.team, 'shells'); continue; }
      if (this.world.vehicles.guns.resupply(v, 1)) this.#charge(v.team, d, cost);
    }
  }

  /** A coarse grid over the trench corridors for inTrench(): cell -> rects that overlap it. */
  #trenchGrid(map) {
    if (!map.trenches?.length) return null;
    const cell = 8, b = map.bounds;
    const nx = Math.ceil((b.maxX - b.minX) / cell), nz = Math.ceil((b.maxZ - b.minZ) / cell);
    const cells = new Uint16Array(nx * nz), rects = [];
    for (const T of map.trenches) for (const r of T.corridors) {
      const x0 = Math.max(0, Math.floor((r[0] - b.minX) / cell)), x1 = Math.min(nx - 1, Math.floor((r[2] - b.minX) / cell));
      const z0 = Math.max(0, Math.floor((r[1] - b.minZ) / cell)), z1 = Math.min(nz - 1, Math.floor((r[3] - b.minZ) / cell));
      for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) {
        const i = iz * nx + ix;
        if (!cells[i]) { rects.push([]); cells[i] = rects.length; }
        rects[cells[i] - 1].push(r);
      }
    }
    return { cell, nx, nz, minX: b.minX, minZ: b.minZ, cells, rects };
  }

  /** For the HUD and netcode. */
  snapshot(team) {
    const trucks = this.world.vehicles.list.filter((v) => !v.removed && v.def.cargo && v.team === team).map((v) => ({ id: v.id, cargo: Math.round(v.cargo) }));
    return { hq: Math.round(this.hq(team).stock), front: Math.round(this.front(team).stock), frontCap: this.front(team).cap, sector: this.front(team).sector, trucks };
  }
}

/** Where a team's forward depot is (for AI and HUD) without a Logistics instance. */
export const depotOf = (map, mode, team) => map.sectors[mode.front[team]]?.depot?.[team] ?? map.hqDepot?.[team] ?? new Vector3();
