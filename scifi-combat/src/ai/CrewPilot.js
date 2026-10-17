// CrewPilot: drives a bot's duty vehicle for its team's SupportCommand (gun crews and supply-truck
// drivers), sending the same Command a player would: tank controls, H to set up or pack up, hold
// fire, and `cmd.target` for indirect fire.
//  * Gun commander (seat 0): gets the gun to its post. It packs up first if it's set up
//    elsewhere, then pushes or drives along the flow field, and backs out of whatever it's stuck
//    on. At the post it sets up and fires:
//      - indirect guns (howitzers, rockets) fire the unit's current mission, walking their rounds
//        around the mission's area (a spiral, one aim point per round);
//      - AT guns kill the nearest enemy vehicle in sight within reach, leading it. Enemy infantry
//        in the open is the fallback when no armor is around.
//  * Loader (seat 1): sits tight (a loaded gun reloads faster). If the commander's seat stays
//    empty, it gets out so the brain can take that seat instead.
//  * Truck driver: HQ dump (load) -> forward depot (unload) -> again, stopping inside each until
//    the job is done.

import { Vector3 } from 'three';
import { angleDelta } from '../core/geom.js';
import { barrelDir } from '../vehicles/FieldGuns.js';
import { lineClearOfFriends } from './FireDiscipline.js';

const _m = new Vector3(), _a = new Vector3(), _d = new Vector3();
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const AT_REACH = 320, AT_INFANTRY = 160;

export class CrewPilot {
  constructor(brain) {
    this.brain = brain;
    this.stuck = { t: 0, x: 0, z: 0, until: 0, turn: 1 };
    this.emptyFor = 0;
    this.wait = 0;
  }

  /** In the duty vehicle: fill `cmd` for this tick. */
  drive(dt, cmd, v, unit, seat) {
    cmd.yaw = v.yaw; cmd.pitch = 0;
    if (seat !== 0) {
      // Loader: if the gun has lost its commander, get out and take the seat.
      this.emptyFor = v.seats[0]?.occupant ? 0 : this.emptyFor + dt;
      if (this.emptyFor > 2) { this.emptyFor = 0; this.brain.btn.press('interact'); }
      return;
    }
    if (v.def.cargo) this.#truck(dt, cmd, v, unit);
    else if (v.gun) this.#gun(dt, cmd, v, unit);
  }

  // ---------------------------------------------------------------- guns
  #gun(dt, cmd, v, unit) {
    const G = v.gun, p = v.movement.state.position, post = unit.post, btn = this.brain.btn;
    if (G.towedBy) return;
    const far = post && Math.hypot(post.x - p.x, post.z - p.z) > (unit.kind === 'at' ? 6 : 9);
    if (far) {
      if (G.state === 'deployed') { btn.press('dig'); return; }       // pack up to move
      if (G.state !== 'packed') return;
      this.#steer(dt, cmd, v, post, unit.field, 2.5, 10);
      return;
    }
    const speed = Math.hypot(v.movement.state.velocity.x, v.movement.state.velocity.z);
    if (G.state === 'packed') { if (speed < 0.6) btn.press('dig'); else this.#brake(cmd, v); return; }
    if (G.state !== 'deployed') return;
    if (v.def.gun.indirect) this.#mission(cmd, v, unit);
    else this.#antiTank(cmd, v, unit);
  }

  /** Walk the rounds around the mission's area: one aim point per round, on a spiral. */
  #mission(cmd, v, unit) {
    const m = unit.mission;
    if (!m) return;
    if (m.start === null) m.start = v.gun.shots;
    const k = v.gun.shots - m.start, a = k * 2.399963, r = m.r * Math.sqrt(((k % 7) + 0.5) / 7);
    cmd.target = [m.x + Math.cos(a) * r, m.z + Math.sin(a) * r];
    this.brain.btn.hold('light');
  }

  #antiTank(cmd, v, unit) {
    const w = this.brain.world, d = v.def.gun;
    const muzzle = w.vehicles.guns.muzzle(v, _m);
    const t = this.#atTarget(v, muzzle);
    if (!t) { cmd.yaw = unit.facing ?? v.yaw; cmd.pitch = 0; return; }
    // Lead the target, aim at its middle, and hold the slug's drop.
    const tp = t.movement.state.position, tv = t.movement.state.velocity;
    const dist = Math.hypot(tp.x - muzzle.x, tp.z - muzzle.z), tof = dist / d.speed;
    _a.set(tp.x + tv.x * tof, tp.y + (t.isVehicle ? Math.min(1.4, t.def.size.y * 0.5) : 1.0), tp.z + tv.z * tof);
    const h = Math.hypot(_a.x - muzzle.x, _a.z - muzzle.z), drop = 0.5 * d.gravity * tof * tof;
    cmd.yaw = Math.atan2(-(_a.x - muzzle.x), -(_a.z - muzzle.z));
    cmd.pitch = Math.atan2(_a.y + drop - muzzle.y, h);
    // Friendly fire: hold the slug while one of ours is between the gun and the target.
    if (lineClearOfFriends(w, v.team, muzzle, _a, { width: 1.2, exclude: this.brain.self })) this.brain.btn.hold('light');
    unit.engaged = t.id;
  }

  /** The enemy vehicle in sight within reach (closest first); else enemy infantry in the open nearby. */
  #atTarget(v, muzzle) {
    const w = this.brain.world, team = v.team;
    let best = null, bd = AT_REACH;
    for (const e of w.vehicles.list) {
      if (e.removed || e.team === team || e.health.dead) continue;
      const d = e.movement.state.position.distanceTo(muzzle);
      if (d < bd && this.#sees(muzzle, e.movement.state.position, d, 1.2)) { bd = d; best = e; }
    }
    if (best) return best;
    // No armor: the gunner's own target, if it's out in the open within reach.
    const t = this.brain.target;
    if (t && !t.health?.dead && !t.health?.downed && !t.vehicle) {
      const d = t.movement.state.position.distanceTo(muzzle);
      if (d < AT_INFANTRY && this.#sees(muzzle, t.movement.state.position, d, 1.1)) return t;
    }
    return null;
  }

  #sees(from, p, d, up) {
    _d.set(p.x - from.x, p.y + up - from.y, p.z - from.z);
    const l = _d.length();
    return l < 0.5 || !this.brain.world.sight(from, _d.divideScalar(l), Math.min(d, l) - 1);   // a ridge in the way: the shell would bury itself
  }

  // ---------------------------------------------------------------- trucks
  #truck(dt, cmd, v, unit) {
    const L = this.brain.world.logistics;
    if (!L || v.towing) return;
    const team = v.team, hq = L.hq(team), fr = L.front(team);
    const leg = unit.leg ?? (unit.leg = v.cargo >= v.def.cargo * 0.5 ? 'deliver' : 'load');
    const d = leg === 'load' ? hq : fr;
    const field = leg === 'load' ? `logi:${team}:hq:${fr.sector}` : `logi:${team}:front:${fr.sector}`;   // one per front position: each covers that run
    const there = this.#steer(dt, cmd, v, d.pos, field, Math.max(3, d.radius - 4), 18, leg === 'load' ? fr.pos : hq.pos);   // the whole haul: HQ to the front can be 1.3 km
    if (!there) { this.wait = 0; return; }
    this.#brake(cmd, v);
    this.wait += dt;
    const done = leg === 'load'
      ? v.cargo >= v.def.cargo - 0.5 || (hq.stock < 2 && v.cargo >= 20) || this.wait > 30
      : v.cargo < 0.5 || fr.stock >= fr.cap - 0.5 || this.wait > 30;
    // Loaded trucks leave the dump `spacing` seconds apart (a stream of deliveries rather than one
    // convoy every few minutes), unless one has waited a minute.
    const gap = L.cfg.spacing ?? 0;
    if (done && leg === 'load' && gap && L.clock - L.lastOut[team] < gap && this.wait < 60) return;
    if (done && this.wait > 1) { if (leg === 'load') L.lastOut[team] = L.clock; unit.leg = leg === 'load' ? 'deliver' : 'load'; this.wait = 0; }
  }

  // ---------------------------------------------------------------- driving
  /** Hold still: throttle against whatever way we're still rolling. */
  #brake(cmd, v) {
    const s = v.movement.state, fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw), fwd = s.velocity.x * fx + s.velocity.z * fz;
    cmd.moveX = 0; cmd.moveY = fwd > 0.6 ? -1 : fwd < -0.6 ? 1 : 0;
  }

  /**
   * Tank controls toward `dest` along the flow field `field`: turn toward the way to go (in place
   * if it's well off), throttle when lined up, slow down near the end. Backs out of anything it
   * sticks on. Returns true when within `arrive`.
   */
  #steer(dt, cmd, v, dest, field, arrive, slowR, from = v.movement.state.position) {
    const s = v.movement.state, p = s.position, nav = this.brain.world.nav, S = this.stuck, now = this.brain.time;
    const dist = Math.hypot(dest.x - p.x, dest.z - p.z);
    if (dist < arrive) { cmd.moveX = 0; cmd.moveY = 0; S.t = 0; return true; }
    if (now < S.until) { cmd.moveY = -1; cmd.moveX = S.turn; return false; }
    let dx = dest.x - p.x, dz = dest.z - p.z;
    // The field covers the trip (from here, or from the far end of a supply run), not the map.
    const f = nav && field && dist > 12 ? nav.want(field, dest.x, dest.z, Math.max(2, arrive * 0.5), { from }) : null;
    if (f && nav.sample(f, p.x, p.z, _m)) { dx = _m.x; dz = _m.z; }
    const turn = angleDelta(v.yaw, Math.atan2(-dx, -dz)), a = Math.abs(turn);
    cmd.moveX = clamp(-turn * 2, -1, 1);
    cmd.moveY = a < 0.5 ? 1 : a < 1.2 ? 0.35 : 0;
    if (dist < slowR) cmd.moveY *= 0.5;
    // Stuck: trying to move but going nowhere for 3 s -> reverse, turning away, for a moment.
    S.t += dt;
    if (S.t > 3) {
      if (Math.hypot(p.x - S.x, p.z - S.z) < 1 && cmd.moveY > 0) { S.until = now + 1.6; S.turn = this.brain.rand() < 0.5 ? -1 : 1; }
      S.t = 0; S.x = p.x; S.z = p.z;
    }
    return false;
  }
}

/** Unit vector a gun's barrel points along (for tests and views). */
export const barrelOf = (v, out = new Vector3()) => barrelDir(v.gun.yaw, v.gun.pitch, out);
