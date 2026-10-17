// FieldGuns: crew-served guns (data/vehicles.json `gun` blocks): towed howitzers and AT guns that
// the crew pushes or a truck tows, and self-propelled rocket batteries. Simulation only.
//
//  * Packed (limbered): a towed gun moves at walking pace while its commander pushes it (tank
//    controls), or follows a truck whose driver hitched it (H). A self-propelled battery drives.
//  * H sets the gun up: the trail spades dig in over `deployTime`, and from then on it can't move.
//    H again packs it up over `packTime`.
//  * Set up, the commander (the driver's seat) lays the barrel at the gun's laying rate, within
//    `traverse` degrees either side of the carriage. The crew swings the whole carriage
//    (`shiftRate`) to reach past that. It fires (hold fire) once the barrel is laid and a round is
//    loaded:
//      - direct fire (AT gun): along the commander's aim, like a slow turret;
//      - indirect fire (howitzer, rockets): at a marked point, `cmd.target` [x, z]. That comes from
//        the fire-control view or a bot's fire mission. The fire-control computer picks the charge
//        so every round comes down at `arc` degrees whatever the range (plunging into trenches),
//        and each round lands scattered around the mark, more widely the longer the range;
//      - rockets ripple a salvo of `salvo`, `salvoInterval` apart, then reload for `reload` s.
//    A loader in the second seat loads faster (loaderMul).
//  * Ammo: `ammo` rounds carried, at most `ammoMax`. Logistics refills it (resupply()).
//  * Every indirect round in the air is listed in `incoming` (where and when it lands): the audio
//    plays its whistle, and soldiers under it hit the dirt.
// Events: gun:state { id, state }, gun:fire { id, team, kind, from, at, eta, shell },
//         gun:empty { id }, gun:hitch / gun:unhitch { gun, tower }.

import { Vector3 } from 'three';
import { bus } from '../core/EventBus.js';
import { localToWorld, angleDelta } from '../core/geom.js';
import { rng } from '../combat/weapons/WeaponSystem.js';

const DEG = Math.PI / 180;
const HITCH_RANGE = 3.5;
const LAID = 0.4 * DEG;           // fire when the barrel is this close to the solution
const _m = new Vector3(), _h = new Vector3(), _t = new Vector3(), _dir = new Vector3();
const step = (d, max) => (d > max ? max : d < -max ? -max : d);

/** Two independent standard normal samples (Box-Muller) from a seeded generator. */
function gauss2(rand) {
  const u = Math.max(1e-9, rand()), v = rand(), r = Math.sqrt(-2 * Math.log(u));
  return [r * Math.cos(2 * Math.PI * v), r * Math.sin(2 * Math.PI * v)];
}

/** Unit vector for a barrel at (yaw, pitch): forward is -z at yaw 0, like everything else. */
export function barrelDir(yaw, pitch, out = new Vector3()) {
  const c = Math.cos(pitch);
  return out.set(-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c);
}

export class FieldGuns {
  /** @param {VehicleSystem} vehicles */
  constructor(vehicles) {
    this.vs = vehicles;
    this.world = vehicles.world;
    this.time = 0;
    this.incoming = [];            // { x, y, z, at, radius, team, kind, gun }
  }

  init(v) {
    const g = v.def.gun;
    v.gun = {
      state: 'packed', t: 0, yaw: v.yaw, pitch: g.elevation[0] * DEG,
      ammo: g.ammo ?? 0, load: 0, salvo: 0, salvoT: 0,
      aim: null, sol: null, outOfArc: false, laid: false,
      shots: 0, firedAt: -Infinity, towedBy: null, rand: rng(v.id, 7919),
    };
  }

  /** Per tick, before the vehicles move: drop rounds that have landed from the incoming list. */
  tick(dt) {
    this.time += dt;
    if (this.incoming.length) this.incoming = this.incoming.filter((r) => r.at > this.time - 0.5);
  }

  // ---------------------------------------------------------------- the gun itself
  /**
   * The commander's command for this tick (an empty command when the seat is empty).
   * Called for every vehicle with a gun, before it moves.
   */
  update(v, cmd, dt) {
    const G = v.gun, d = v.def.gun, s = v.movement.state;
    const manned = !!v.seats[0]?.occupant;
    const loader = v.seats.some((q) => q.def.role === 'loader' && q.occupant);
    // ---- set up / pack up
    if (manned && cmd.buttons.dig?.pressed && !G.towedBy) {
      if (G.state === 'packed' && Math.hypot(s.velocity.x, s.velocity.z) < 0.8) this.#state(v, 'deploying', d.deployTime);
      else if (G.state === 'deployed') this.#state(v, 'packing', d.packTime);
    }
    if (G.state === 'deploying' || G.state === 'packing') {
      if (manned) G.t -= dt;      // nobody at the gun, nobody digging the spades in or out
      if (G.t <= 0) this.#state(v, G.state === 'deploying' ? 'deployed' : 'packed', 0);
    }
    // ---- loading (a loader speeds it up; nobody loads an unmanned gun)
    if (G.load > 0 && manned) G.load = Math.max(0, G.load - dt / (loader ? d.loaderMul ?? 1 : 1));
    if (G.state !== 'deployed') { G.salvo = 0; G.laid = false; this.#stow(v, dt, G.state === 'deploying' && manned); return; }
    if (!manned) { G.salvo = 0; G.laid = false; return; }

    // ---- laying
    let wantYaw = G.yaw, wantPitch = G.pitch;
    if (d.indirect) {
      const tx = cmd.target?.[0], tz = cmd.target?.[1];
      if (Number.isFinite(tx) && Number.isFinite(tz)) {
        const ty = this.#ground(tx, tz);
        G.aim = G.aim ?? new Vector3();
        G.aim.set(tx, ty, tz);
        G.sol = this.solve(this.#pivot(v, _m), tx, ty, tz, d);
        if (G.sol) { wantYaw = G.sol.yaw; wantPitch = G.sol.pitch; }
      }
    } else {
      wantYaw = cmd.yaw;
      wantPitch = Math.max(d.elevation[0] * DEG, Math.min(d.elevation[1] * DEG, cmd.pitch));
    }
    const tr = d.traverse * DEG;
    let rel = angleDelta(v.yaw, wantYaw);
    if (Math.abs(rel) > tr && d.shiftRate) {
      // Past the traverse: the crew heaves the trail round (slowly), carrying the barrel with it.
      const k = Math.min(d.shiftRate * DEG * dt, Math.abs(rel) - tr) * Math.sign(rel);
      v.yaw += k; G.yaw += k;
      rel = angleDelta(v.yaw, wantYaw);
    }
    G.outOfArc = Math.abs(rel) > tr + 1e-3;
    const yawTo = v.yaw + Math.max(-tr, Math.min(tr, rel));
    G.yaw += step(angleDelta(G.yaw, yawTo), d.layRate[0] * DEG * dt);
    G.pitch += step(wantPitch - G.pitch, d.layRate[1] * DEG * dt);
    G.laid = !G.outOfArc && Math.abs(angleDelta(G.yaw, yawTo)) < LAID && Math.abs(wantPitch - G.pitch) < LAID && (!d.indirect || !!G.sol);

    // ---- fire
    if (G.salvo > 0) {
      G.salvoT -= dt;
      while (G.salvo > 0 && G.salvoT <= 0) {
        if (G.ammo <= 0 || !this.#shoot(v)) { G.salvo = 0; break; }
        G.salvo--; G.salvoT += d.salvoInterval;
      }
      if (G.salvo === 0) G.load = d.reload;
      return;
    }
    if (!cmd.buttons.light?.down || !G.laid || G.load > 0) return;
    if (G.ammo <= 0) { if (cmd.buttons.light.pressed) bus.emit('gun:empty', { id: v.id, team: v.team }); return; }
    if (d.salvo) { G.salvo = Math.min(d.salvo, G.ammo); G.salvoT = 0; return; }   // the ripple starts next tick
    if (this.#shoot(v)) G.load = d.reload;
  }

  /**
   * Packed (or packing): the barrel settles back to its travel position along the carriage.
   * Setting up: the crew already raises it toward its firing elevation while the spades go in.
   */
  #stow(v, dt, raise) {
    const G = v.gun, d = v.def.gun;
    const pitch = raise ? (d.indirect ? d.arc : 0) * DEG : d.elevation[0] * DEG;
    G.yaw += step(angleDelta(G.yaw, v.yaw), d.layRate[0] * DEG * dt * 2);
    G.pitch += step(pitch - G.pitch, d.layRate[1] * DEG * dt * (raise ? 1 : 2));
  }

  #state(v, state, t) {
    v.gun.state = state; v.gun.t = t;
    if (state !== 'deployed') v.gun.sol = null;
    bus.emit('gun:state', { id: v.id, team: v.team, state, duration: t, kind: v.def.gun.kind });
  }

  #ground(x, z) { return this.world.terrain ? this.world.terrain.height(x, z) : 0; }

  /** The barrel's pivot (trunnion) in world space. */
  #pivot(v, out) { return localToWorld(out, v.movement.state.position, v.yaw, v.def.gun.trunnion ?? [0, 1, 0]); }

  /** The muzzle in world space, along the laid barrel. */
  muzzle(v, out = new Vector3()) {
    this.#pivot(v, out);
    return out.addScaledVector(barrelDir(v.gun.yaw, v.gun.pitch, _dir), v.def.gun.barrel ?? 2);
  }

  /**
   * Firing data for an indirect round from `from` to (x, y, z): the charge (muzzle speed) that
   * brings it down there at the gun's `arc`. Null when the point is outside the gun's range
   * (too close or too far).
   * @returns {{ yaw, pitch, speed, eta, range } | null}
   */
  solve(from, x, y, z, d) {
    const dx = x - from.x, dz = z - from.z, R = Math.hypot(dx, dz), dh = y - from.y;
    const th = d.arc * DEG, c = Math.cos(th), den = 2 * c * c * (R * Math.tan(th) - dh);
    if (R < 1 || den <= 0) return null;
    const speed = Math.sqrt((d.gravity * R * R) / den);
    if (speed < d.speedRange[0] || speed > d.speedRange[1]) return null;
    return { yaw: Math.atan2(-dx, -dz), pitch: th, speed, eta: R / (speed * c), range: R };
  }

  /** The gun's reach on flat ground: [min, max] metres. */
  range(d) {
    const s2 = Math.sin(2 * d.arc * DEG);
    return [(d.speedRange[0] ** 2 * s2) / d.gravity, (d.speedRange[1] ** 2 * s2) / d.gravity];
  }

  #shoot(v) {
    const G = v.gun, d = v.def.gun, shell = this.vs.defs.weapons[d.shell];
    if (!shell) return false;
    const muzzle = this.muzzle(v, new Vector3());
    let dir, speed, at = null, eta = null;
    if (d.indirect) {
      if (!G.aim || !G.sol) return false;
      // Each round lands scattered around the mark: sigma = base + a fraction of the range.
      const R = G.sol.range, sig = d.dispersion[0] + d.dispersion[1] * R;
      const [e1, e2] = gauss2(G.rand);
      const ux = (G.aim.x - muzzle.x) / R, uz = (G.aim.z - muzzle.z) / R;
      at = new Vector3(G.aim.x + (ux * e1 - uz * e2) * sig, 0, G.aim.z + (uz * e1 + ux * e2) * sig);
      at.y = this.#ground(at.x, at.z);
      let sol = this.solve(muzzle, at.x, at.y, at.z, d);
      if (!sol) { at.copy(G.aim); sol = this.solve(muzzle, at.x, at.y, at.z, d); }   // scattered out of range: fire on the mark
      if (!sol) return false;
      dir = barrelDir(sol.yaw, sol.pitch, new Vector3());
      speed = sol.speed; eta = sol.eta;
    } else {
      const [e1, e2] = gauss2(G.rand), sig = d.dispersion[1];
      dir = barrelDir(G.yaw + e1 * sig, G.pitch + e2 * sig, new Vector3());
      speed = d.speed;
    }
    this.world.spawnProjectile({
      weapon: shell, origin: muzzle, dir, speed, gravity: d.gravity, maxAge: 40, highFly: !!d.indirect,
      ownerId: v.id, team: v.team, damageMul: 1, splash: shell.damage?.splash ?? 0, deflectable: false, onHit: null,
    });
    G.ammo--; G.shots++; G.firedAt = this.time;
    if (at) this.incoming.push({ x: at.x, y: at.y, z: at.z, at: this.time + eta, radius: shell.damage?.splash ?? 0, team: v.team, kind: d.kind, gun: v.id });
    bus.emit('gun:fire', { id: v.id, team: v.team, kind: d.kind, shell: d.shell, from: muzzle.toArray(), at: at ? at.toArray() : null, eta, yaw: G.yaw, pitch: G.pitch });
    return true;
  }

  /** Logistics: load up to `n` rounds; returns how many went in. */
  resupply(v, n) {
    const G = v.gun;
    if (!G) return 0;
    const k = Math.max(0, Math.min(n, (v.def.gun.ammoMax ?? G.ammo) - G.ammo));
    G.ammo += k;
    return k;
  }

  /** Rounds in the air that land within `r` of (x, z) in the next `within` seconds (any team's). */
  incomingNear(x, z, r, within = 3) {
    let best = null;
    for (const s of this.incoming) {
      const left = s.at - this.time;
      if (left < -0.1 || left > within) continue;
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < r + s.radius && (!best || left < best.left)) best = { ...s, left, dist: d };
    }
    return best;
  }

  // ---------------------------------------------------------------- towing
  hitchPoint(tower, out = _h) { return localToWorld(out, tower.movement.state.position, tower.yaw, tower.def.tow.hitch); }
  trailPoint(gun, out = _t) { return localToWorld(out, gun.movement.state.position, gun.yaw, [0, 0, gun.def.size.z / 2 + 0.3]); }

  /** The packed, unmanned gun of the tower's team whose trail is in reach of its hitch, if any. */
  hitchable(tower) {
    if (!tower.def.tow || tower.towing) return null;
    const h = this.hitchPoint(tower, new Vector3());
    let best = null, bd = HITCH_RANGE;
    for (const g of this.vs.list) {
      if (g.removed || !g.gun || !g.def.towable || g.team !== tower.team || g.gun.towedBy || g.gun.state !== 'packed' || g.seats.some((q) => q.occupant)) continue;
      const dist = this.trailPoint(g).distanceTo(h);
      if (dist < bd) { bd = dist; best = g; }
    }
    return best;
  }

  hitch(tower, gun) {
    tower.towing = gun; gun.gun.towedBy = tower; gun.gun.hitchT = 0;
    bus.emit('gun:hitch', { gun: gun.id, tower: tower.id, team: tower.team });
  }

  unhitch(tower) {
    const gun = tower.towing;
    tower.towing = null;
    if (!gun) return;
    gun.gun.towedBy = null;
    gun.movement.state.velocity.set(0, 0, 0);
    bus.emit('gun:unhitch', { gun: gun.id, tower: tower.id, team: tower.team });
  }

  /**
   * A towed gun trails its tower like a trailer: its trail eye on the hitch, the barrel pointing
   * back the way they came. It eases onto the hitch over the first moments after hitching.
   */
  follow(gun, dt, support) {
    const tower = gun.gun.towedBy;
    if (!tower || tower.removed || tower.health.dead) { if (tower) tower.towing = null; gun.gun.towedBy = null; return; }
    const s = gun.movement.state, h = this.hitchPoint(tower), L = gun.def.size.z / 2 + 0.3;
    let dx = s.position.x - h.x, dz = s.position.z - h.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    gun.gun.hitchT = (gun.gun.hitchT ?? 1) + dt;
    const k = gun.gun.hitchT < 0.5 ? Math.min(1, dt * 8) : 1;
    const nx = s.position.x + (h.x + dx * L - s.position.x) * k, nz = s.position.z + (h.z + dz * L - s.position.z) * k;
    s.velocity.set((nx - s.position.x) / dt, 0, (nz - s.position.z) / dt);
    s.position.x = nx; s.position.z = nz;
    gun.yaw = Math.atan2(-dx, -dz);
    s.position.y = support(gun);
  }
}
