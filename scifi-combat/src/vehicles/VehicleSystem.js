// VehicleSystem: hover bikes, light tanks and dropships (data/vehicles.json).
//
// Design goals (Battlefront + Helldivers feel):
//  * Snappy entry and exit. Interact within range seats you in 0.35 s (input locked only that long);
//    interact again hops you out to the first clear side. Destruction ejects everyone, hurt and airborne.
//  * Three physics models, all arcade-first:
//      hover   = steers toward your camera, low lateral grip (drift), boost on sprint
//      tracked = W/S throttle, A/D turns the hull, the turret tracks your camera at a limited rate
//      flyer   = steers toward camera, Space/C climb and descend, carries passengers
//  * Vehicles are real combat entities: Health with the 'vehicle' armor type (ion and explosives
//    are the answer), a StatusComponent (Suppress/Silence = EMP: weapons and boost offline;
//    Slow = lower top speed; Root/Stun = engine stall; Scorch/Volatile don't apply), and a
//    rear weak spot that counts as a headshot.
//  * Counterplay is physical: riders on bikes are exposed, tanks turn slowly, bikes shatter when
//    they crash at speed, and ramming hurts in both directions unless the vehicle is armored.
//  * Pads respawn their vehicle after destruction or abandonment (Battlefront pickups). Called
//    vehicles (Skyrider, Driftcaller) arrive via DeployableSystem's drop marker.
//
// Integration: every tick, call `handleInput(entity, cmd)` for each fighter before its own
// updates. If it returns true the entity is in or entering a vehicle, so skip its own
// movement-driven combat updates. Then `update(dt)` (CombatWorld does this).

import { Vector3 } from 'three';
import { bus } from '../core/EventBus.js';
import { Health } from '../combat/Health.js';
import { StatusComponent } from '../combat/StatusSystem.js';
import { WeaponComponent, WeaponInstance } from '../combat/weapons/WeaponSystem.js';
import { emptyCommand } from '../input/InputManager.js';
import { rayYawBox, localToWorld, angleDelta } from '../core/geom.js';

const DEG = Math.PI / 180;
const ENTER_RANGE = 3.2;
const ENTER_TIME = 0.35;
const VEHICLE_IMMUNE = ['scorch', 'ignite', 'volatile', 'blind', 'weaken', 'cloak', 'haste', 'fortify', 'radiant'];
const _f = new Vector3();
const _r = new Vector3();
const _v = new Vector3();
const _p = new Vector3();
let nextVehicleId = 200000;

export class VehicleSystem {
  constructor(world, defs) {
    this.world = world;
    this.defs = defs;          // data/vehicles.json
    this.list = [];
    this.pads = [];
  }

  // ---------------------------------------------------------------- spawning
  spawn(type, team, at, yaw = 0, { pad = null, ownerId = null } = {}) {
    const def = this.defs.vehicles[type];
    if (!def) { console.warn(`Unknown vehicle "${type}"`); return null; }
    // One called vehicle per owner: calling a new one scraps the old one if it's empty.
    if (ownerId != null) for (const old of this.list) if (old.calledBy === ownerId && !old.removed && !old.seats.some((s) => s.occupant)) this.#remove(old, 'replaced');

    const pos = at.clone();
    pos.y = this.world.groundHeight(pos) + (def.hoverHeight ?? 0);
    const v = {
      id: nextVehicleId++, isVehicle: true, type, def, team, calledBy: ownerId, pad,
      yaw, turretYaw: yaw, altitude: 0, boostTime: 0, boostCd: 0, emptyTime: 0, removed: false, ramCd: new Map(),
    };
    v.movement = {
      state: { position: pos, velocity: new Vector3(), yaw, grounded: true, stance: 'stand', mode: 'vehicle', invulnerable: false, speedScale: 1, sprinting: false, locks: {} },
      // Knock-backs barely move heavy vehicles: scaled by a rough mass from HP.
      impulse: (x, y, z) => { const m = Math.max(1, def.hp / 400); v.movement.state.velocity.x += x / m; v.movement.state.velocity.z += z / m; },
    };
    v.health = new Health(v, { health: def.hp, armor: def.armor ?? 'vehicle' });
    v.status = new StatusComponent(v, this.world.statusDefs ?? {}, this.world);
    v.status.immune = new Set(VEHICLE_IMMUNE);
    v.seats = def.seats.map((sd) => ({ def: sd, occupant: null, cmd: null, weapons: sd.weapon ? this.#seatWeapons(v, sd) : null }));
    this.list.push(v);
    this.world.version++;
    bus.emit('vehicle:spawn', this.describe(v));
    return v;
  }

  addPad({ vehicle, team, at, yaw = 0, respawn = 20, slot = 0 }) {
    const pad = { vehicle, team, at: at.clone(), yaw, respawn, slot, timer: 0, current: null };
    pad.current = this.spawn(vehicle, team, at, yaw, { pad });
    this.pads.push(pad);
    return pad;
  }

  /**
   * The motor pool moves up with the front: the pad moves, and its vehicle, if nobody's in it,
   * is taken away and turns up at the new spot a few seconds later.
   */
  movePad(pad, at, yaw = pad.yaw) {
    pad.at.copy(at); pad.yaw = yaw;
    const v = pad.current;
    if (v && !v.removed && !v.seats.some((s) => s.occupant) && v.movement.state.position.distanceTo(at) > 15) {
      this.#remove(v, 'relocated');
      pad.current = null;
      pad.timer = Math.max(0, pad.respawn - 5);
    }
  }

  #seatWeapons(v, sd) {
    const stats = this.defs.weapons[sd.weapon];
    // The seat's gun is owned by a proxy so it shoots from the vehicle, ignores the vehicle in its
    // raycasts (owner id = vehicle id) and credits damage to the vehicle.
    const proxyState = { position: v.movement.state.position, velocity: v.movement.state.velocity, grounded: true, stance: 'stand', mode: 'vehicle', speedScale: 1, sprinting: false, yaw: v.yaw, locks: {} };
    const proxy = { id: v.id, team: v.team, health: v.health, muzzleHeight: stats.muzzleHeight ?? 1.5, movement: { state: proxyState } };
    return new WeaponComponent(proxy, [new WeaponInstance(stats, this.world.recoilDefs ?? {})], this.world);
  }

  // ---------------------------------------------------------------- input
  handleInput(e, cmd) {
    if (e.vehicle) {
      const v = e.vehicle.veh, seat = v.seats[e.vehicle.seat];
      if (e.vehicle.lock > 0) { seat.cmd = emptyCommand(); return true; }
      if (cmd.buttons.interact?.pressed) { this.exit(e); return true; }
      seat.cmd = cmd;
      return true;
    }
    if (cmd.buttons.interact?.pressed) {
      const v = this.nearestEnterable(e);
      if (v) return this.enter(e, v);
    }
    return false;
  }

  /** Closest vehicle in range that this entity's team can use and that has a free seat. Also used by the HUD prompt. */
  nearestEnterable(e) {
    let best = null, bd = ENTER_RANGE;
    for (const v of this.list) {
      if (v.removed || v.team !== e.team || !v.seats.some((s) => !s.occupant)) continue;
      const d = Math.hypot(v.movement.state.position.x - e.movement.state.position.x, v.movement.state.position.z - e.movement.state.position.z) - v.def.radius;
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  enter(e, v, seatIndex = null) {
    if (e.health.dead || e.transform || v.team !== e.team) return false;
    const idx = seatIndex ?? v.seats.findIndex((s) => !s.occupant);
    if (idx < 0 || v.seats[idx].occupant) return false;
    e.abilities?.interrupt?.('vehicle');
    e.weapons?.interrupt?.('vehicle');
    v.seats[idx].occupant = e;
    v.seats[idx].cmd = emptyCommand();
    e.vehicle = { veh: v, seat: idx, lock: ENTER_TIME, exposed: !!v.seats[idx].def.exposed };
    this.world.version++;
    e.movement.enterVehicle();
    v.emptyTime = 0;
    bus.emit('vehicle:enter', { id: v.id, entity: e.id, seat: idx, role: v.seats[idx].def.role, duration: ENTER_TIME, team: v.team });
    return true;
  }

  exit(e, { eject = false } = {}) {
    const ref = e.vehicle;
    if (!ref) return;
    const v = ref.veh;
    v.seats[ref.seat].occupant = null;
    v.seats[ref.seat].cmd = null;
    e.vehicle = null;
    this.world.version++;
    const pos = this.#exitPoint(v);
    const vel = v.movement.state.velocity.clone().multiplyScalar(eject ? 0.2 : 0.5);
    if (eject) vel.y = 6;
    e.movement.exitVehicle(pos, vel);
    bus.emit('vehicle:exit', { id: v.id, entity: e.id, eject });
  }

  /** First clear spot to the left, right, back or front, falling back to on top. */
  #exitPoint(v) {
    const s = v.movement.state;
    const r = v.def.radius + 0.8;
    for (const off of [[-r, 0, 0], [r, 0, 0], [0, 0, r + 0.5], [0, 0, -(r + 0.5)]]) {
      localToWorld(_p, s.position, v.yaw, off);
      if (!this.#blocked(_p, 0.4)) { const out = _p.clone(); out.y = Math.max(this.world.groundHeight(out), s.position.y - (v.def.hoverHeight ?? 0)); return out; }
    }
    return s.position.clone().setY(s.position.y + v.def.size.y + 0.2);
  }

  #blocked(p, radius) {
    let blocked = false;
    this.world.coverIn(p.x - radius, p.z - radius, p.x + radius, p.z + radius, (b) => {
      if (blocked || p.y >= b.max.y - 0.1) return;
      const cx = Math.max(b.min.x, Math.min(p.x, b.max.x)), cz = Math.max(b.min.z, Math.min(p.z, b.max.z));
      if (Math.hypot(p.x - cx, p.z - cz) < radius) blocked = true;
    });
    return blocked;
  }

  // ---------------------------------------------------------------- simulation
  update(dt) {
    for (const v of this.list) {
      if (v.removed) continue;
      v.status.update(dt);
      v.health.update(dt);
      if (v.health.dead) { this.#destroy(v); continue; }
      for (const s of v.seats) if (s.occupant?.vehicle) s.occupant.vehicle.lock = Math.max(0, s.occupant.vehicle.lock - dt);

      const driver = v.seats.find((s) => s.def.role === 'driver');
      const cmd = driver?.occupant ? driver.cmd ?? emptyCommand() : emptyCommand();
      const stalled = v.status.rooted;
      const emp = v.status.silenced;

      if (v.def.model === 'tracked') this.#tracked(v, cmd, dt, stalled);
      else if (v.def.model === 'flyer') this.#flyer(v, cmd, dt, stalled);
      else this.#hover(v, cmd, dt, stalled, emp);

      this.#collide(v);
      if (v.def.ram) this.#ram(v, driver?.occupant, dt);
      this.#seatsAndWeapons(v, dt, emp);

      // Abandonment: an empty pad vehicle far from its pad respawns there after a while.
      const occupied = v.seats.some((s) => s.occupant);
      v.emptyTime = occupied ? 0 : v.emptyTime + dt;
      if (v.pad && !occupied && v.emptyTime > (this.defs.pads?.abandonTime ?? 40) && v.movement.state.position.distanceTo(v.pad.at) > 15) this.#remove(v, 'abandoned');
    }
    this.list = this.list.filter((v) => !v.removed);
    for (const pad of this.pads) {
      if (pad.current && !pad.current.removed) continue;
      pad.timer += dt;
      if (pad.timer >= pad.respawn) { pad.timer = 0; pad.current = this.spawn(pad.vehicle, pad.team, pad.at, pad.yaw, { pad }); }
    }
  }

  #basis(yaw) {
    _f.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    _r.set(-_f.z, 0, _f.x);
  }

  #hover(v, cmd, dt, stalled, emp) {
    const d = v.def, s = v.movement.state;
    // Steer toward where the driver is looking: the "point and go" feel of a speeder bike.
    if (!stalled) v.yaw += Math.max(-d.turnRate * DEG * dt, Math.min(d.turnRate * DEG * dt, angleDelta(v.yaw, cmd.yaw)));
    this.#basis(v.yaw);
    const boosting = this.#boost(v, cmd, dt, emp || stalled);
    const throttle = stalled ? 0 : boosting ? 1 : cmd.moveY;
    const top = (boosting ? d.boost.speed : throttle < 0 ? d.reverseSpeed : d.maxSpeed) * v.status.speedMul;
    s.velocity.addScaledVector(_f, throttle * d.accel * dt).addScaledVector(_r, (stalled ? 0 : cmd.moveX) * d.accel * 0.45 * dt);
    this.#gripAndDrag(v, dt, throttle === 0);
    this.#clampSpeed(s.velocity, top);
    s.position.addScaledVector(s.velocity, dt);
    // Float at hover height over whatever is below, including low cover (you can skim over crates)
    // and across trenches (the highest ground under the hull carries it).
    const target = this.#support(v, 0.75) + d.hoverHeight;
    s.position.y += (target - s.position.y) * Math.min(1, dt * 12);
  }

  /**
   * The ground a hull rests on: the highest point under its footprint (centre, nose, tail and
   * both sides at `k` of its half-size). A tank spans a trench instead of nosing into it, a
   * hover bike lifts over the parapet on the far side.
   */
  #support(v, k) {
    const s = v.movement.state, d = v.def, hl = (d.size?.z ?? 2) * 0.5 * k, hw = (d.size?.x ?? 1) * 0.5 * k;
    // Box tops the hull can get onto count as ground: what a hover skims (1.5 m), what tracks
    // climb (0.5 m; anything taller stops them, or is crushed).
    const base = s.position.y - (d.hoverHeight ?? 0), probeY = d.model === 'tracked' ? base - 1 : base;
    let best = -Infinity;
    for (const [lx, lz] of [[0, 0], [0, -hl], [0, hl], [-hw, 0], [hw, 0]]) {
      localToWorld(_p, s.position, v.yaw, [lx, 0, lz]);
      _p.y = probeY;
      best = Math.max(best, this.world.groundHeight(_p));
    }
    return best;
  }

  #tracked(v, cmd, dt, stalled) {
    const d = v.def, s = v.movement.state;
    // Tank controls: A/D turn the hull, W/S throttle; the turret follows the camera at its own rate.
    if (!stalled) v.yaw -= cmd.moveX * d.turnRate * DEG * dt;
    v.turretYaw += Math.max(-d.turretTurnRate * DEG * dt, Math.min(d.turretTurnRate * DEG * dt, angleDelta(v.turretYaw, cmd.yaw)));
    this.#basis(v.yaw);
    const throttle = stalled ? 0 : cmd.moveY;
    const top = (throttle < 0 ? d.reverseSpeed : d.maxSpeed) * v.status.speedMul;
    s.velocity.addScaledVector(_f, throttle * d.accel * dt);
    this.#gripAndDrag(v, dt, throttle === 0);
    this.#clampSpeed(s.velocity, top);
    s.position.addScaledVector(s.velocity, dt);
    // Tracks bridge a trench (the hull rests on its edges) and settle smoothly after a crossing.
    const ground = this.#support(v, 0.85);
    s.position.y = ground > s.position.y ? ground : s.position.y + (ground - s.position.y) * Math.min(1, dt * 10);
    // What tanks were built for: wire flattened under the tracks.
    if (Math.hypot(s.velocity.x, s.velocity.z) > 1) this.world.cutWire?.(s.position, d.radius * 0.8);
  }

  #flyer(v, cmd, dt, stalled) {
    const d = v.def, s = v.movement.state;
    v.yaw += Math.max(-d.turnRate * DEG * dt, Math.min(d.turnRate * DEG * dt, angleDelta(v.yaw, cmd.yaw)));
    this.#basis(v.yaw);
    const climb = (cmd.buttons.jump?.down ? 1 : 0) - (cmd.buttons.crouch?.down ? 1 : 0);
    // A stalled (rooted/stunned) dropship sinks: Gravity Flak and Arc Snares bring it down.
    v.altitude = Math.max(d.minAltitude, Math.min(d.maxAltitude, v.altitude + (stalled ? -d.climbRate * 0.6 : climb * d.climbRate) * dt));
    const airborne = v.altitude > 0.3;
    const throttle = stalled || !airborne ? 0 : cmd.moveY;
    s.velocity.addScaledVector(_f, throttle * d.accel * dt).addScaledVector(_r, (stalled || !airborne ? 0 : cmd.moveX) * d.accel * 0.6 * dt);
    this.#gripAndDrag(v, dt, throttle === 0);
    this.#clampSpeed(s.velocity, (throttle < 0 ? d.reverseSpeed : d.maxSpeed) * v.status.speedMul);
    s.position.addScaledVector(s.velocity, dt);
    const ground = this.world.groundHeight(s.position);
    s.position.y += (ground + v.altitude - s.position.y) * Math.min(1, dt * 4);
    s.grounded = !airborne;
  }

  #boost(v, cmd, dt, blocked) {
    const b = v.def.boost;
    if (!b) return false;
    v.boostCd = Math.max(0, v.boostCd - dt);
    if (v.boostTime > 0) { v.boostTime -= dt; if (v.boostTime <= 0) bus.emit('vehicle:boostEnd', { id: v.id }); return !blocked && v.boostTime > 0; }
    if (!blocked && cmd.buttons.sprint?.pressed && v.boostCd <= 0) {
      v.boostTime = b.duration; v.boostCd = b.cooldown + b.duration;
      bus.emit('vehicle:boost', { id: v.id, team: v.team, phase: !!b.phase });
      return true;
    }
    return false;
  }

  #gripAndDrag(v, dt, coasting) {
    // Split velocity into forward and lateral parts; lateral bleeds by grip (low grip = drift).
    const s = v.movement.state.velocity;
    const fwd = s.x * _f.x + s.z * _f.z, lat = s.x * _r.x + s.z * _r.z;
    const latK = Math.exp(-v.def.grip * dt), fwdK = coasting ? Math.exp(-v.def.drag * dt) : 1;
    s.x = _f.x * fwd * fwdK + _r.x * lat * latK;
    s.z = _f.z * fwd * fwdK + _r.z * lat * latK;
  }

  #clampSpeed(vel, top) {
    const h = Math.hypot(vel.x, vel.z);
    if (h > top && h > 0) { vel.x *= top / h; vel.z *= top / h; }
  }

  /** Circle vs. cover boxes in XZ. Low cover is skimmed over (hover) or ignored (flyers above it). */
  #collide(v) {
    const s = v.movement.state, d = v.def;
    const base = s.position.y - (d.hoverHeight ?? 0);
    const near = this._near ??= [];
    near.length = 0;
    this.world.coverIn(s.position.x - d.radius, s.position.z - d.radius, s.position.x + d.radius, s.position.z + d.radius, (b) => near.push(b));
    const speed = Math.hypot(s.velocity.x, s.velocity.z);
    for (const b of near) {
      // Tanks crush what's destructible and not too tall under their tracks (sandbags, crates,
      // broken walls): a tank crossing a trench line leaves a gap in the parapet behind it.
      if (d.model === 'tracked' && b.destructible && b.max.y - base < 2 && b.max.y > base - 0.3 && speed > 0.8) {
        const cx = Math.max(b.min.x, Math.min(s.position.x, b.max.x)), cz = Math.max(b.min.z, Math.min(s.position.z, b.max.z));
        if (Math.hypot(s.position.x - cx, s.position.z - cz) < d.radius * 0.8) {
          this.world.removeCover?.(b, v.seats.find((q) => q.def.role === 'driver')?.occupant ?? v);
          s.velocity.multiplyScalar(0.93);
          continue;
        }
      }
      if (b.max.y <= base + (d.model === 'tracked' ? 0.5 : 1.2)) continue;
      if (d.model === 'flyer' && base > b.max.y) continue;
      const cx = Math.max(b.min.x, Math.min(s.position.x, b.max.x)), cz = Math.max(b.min.z, Math.min(s.position.z, b.max.z));
      let nx = s.position.x - cx, nz = s.position.z - cz;
      const dist = Math.hypot(nx, nz);
      if (dist >= d.radius) continue;
      if (dist < 1e-4) { nx = 1; nz = 0; } else { nx /= dist; nz /= dist; }
      s.position.x = cx + nx * d.radius; s.position.z = cz + nz * d.radius;
      const vn = s.velocity.x * nx + s.velocity.z * nz;
      if (vn < 0) {
        s.velocity.x -= 1.3 * vn * nx; s.velocity.z -= 1.3 * vn * nz;
        const impact = -vn;
        if (d.crash && impact > d.crash.minSpeed) {
          v.health.damage((impact - d.crash.minSpeed + 1) * d.crash.damagePerMs, { kind: 'crash' }, null);
          bus.emit('vehicle:crash', { id: v.id, impact, at: s.position.toArray() });
        }
      }
    }
  }

  #ram(v, driver, dt) {
    const s = v.movement.state, r = v.def.ram;
    for (const [k, t] of v.ramCd) if (t - dt <= 0) v.ramCd.delete(k); else v.ramCd.set(k, t - dt);
    const speed = Math.hypot(s.velocity.x, s.velocity.z);
    for (const e of this.world.entities) {
      if (e.vehicle || e.health.dead || v.ramCd.has(e.id)) continue;
      _v.subVectors(e.movement.state.position, s.position); _v.y = 0;
      const dist = _v.length();
      if (dist > v.def.radius + 0.4 || Math.abs(e.movement.state.position.y - (s.position.y - (v.def.hoverHeight ?? 0))) > 2) continue;
      _v.divideScalar(dist || 1);
      v.ramCd.set(e.id, 0.6);
      if (e.team === v.team || speed < r.minSpeed) { e.movement.impulse?.(_v.x * 3, 0, _v.z * 3); continue; } // nudge, no damage
      const dmg = speed * r.damagePerMs;
      e.health.damage(dmg, { kind: 'ram', vehicle: v.type }, driver ?? v);
      e.movement.impulse?.(_v.x * r.knock, 4, _v.z * r.knock);
      const phased = v.boostTime > 0 && v.def.boost?.phase;
      if (r.selfDamageMul && !phased) v.health.damage(dmg * r.selfDamageMul, { kind: 'ramSelf' }, null);
      s.velocity.multiplyScalar(0.8);
      bus.emit('vehicle:ram', { id: v.id, victim: e.id, damage: dmg, speed });
    }
  }

  #seatsAndWeapons(v, dt, emp) {
    const s = v.movement.state;
    for (const seat of v.seats) {
      const occ = seat.occupant;
      if (occ) {
        localToWorld(occ.movement.state.position, s.position, v.yaw, seat.def.offset);
        occ.movement.state.velocity.copy(s.velocity);
        occ.movement.body?.teleport?.(occ.movement.state.position);
      }
      if (!seat.weapons) continue;
      const wc = seat.weapons;
      wc.owner.movement.state.position = s.position;
      if (!occ) { wc.update(emptyCommand(), dt); continue; }
      const c = seat.cmd ?? emptyCommand();
      // Aim rules: hull guns fire within ±25° of the nose; turrets fire along the turret; free mounts aim anywhere.
      let yaw = c.yaw;
      if (seat.def.aim === 'hull') yaw = v.yaw + Math.max(-25 * DEG, Math.min(25 * DEG, angleDelta(v.yaw, c.yaw)));
      if (seat.def.aim === 'turret') yaw = v.turretYaw;
      const wcmd = { ...c, yaw, buttons: { ...c.buttons } };
      // EMP (Suppress/Silence) shuts the guns off, and the driver can't fire during the enter animation.
      if (emp || occ.vehicle?.lock > 0) wcmd.buttons.light = { down: false, pressed: false, released: false };
      // Driver: sprint is the boost, not sprint-lowering the gun; crouch and jump drive the flyer.
      wcmd.buttons.sprint = { down: false, pressed: false, released: false };
      wc.update(wcmd, dt);
    }
  }

  // ---------------------------------------------------------------- damage and destruction
  /** Ray vs. vehicle hulls. The rear 30% of a vehicle with a rear weak spot counts as a headshot. */
  raycast(o, dir, max, ignoreId) {
    let best = null;
    for (const v of this.list) {
      if (v.removed || v.id === ignoreId) continue;
      const d = v.def;
      const base = _p.copy(v.movement.state.position); base.y -= d.hoverHeight ?? 0;
      const hit = rayYawBox(o, dir, base, v.yaw, { x: d.size.x / 2, y: d.size.y, z: d.size.z / 2 }, max);
      if (!hit || (best && hit.t >= best.distance)) continue;
      const weak = d.weakSpot === 'rear' && hit.local.z > d.size.z * 0.2;
      best = { entity: v, distance: hit.t, point: o.clone().addScaledVector(dir, hit.t), zone: weak ? 'head' : 'body', weakSpot: weak, surface: 'vehicle' };
    }
    return best;
  }

  #destroy(v) {
    const s = v.movement.state;
    bus.emit('vehicle:destroyed', { id: v.id, type: v.type, team: v.team, at: s.position.toArray() });
    for (const seat of v.seats) {
      const e = seat.occupant;
      if (!e) continue;
      this.exit(e, { eject: true });
      e.health.damage(40, { kind: 'vehicleExplosion' }, null);
    }
    this.world.explode(s.position.clone(), 5, { id: `${v.type}:wreck`, ammoType: 'explosive', damage: { base: 120 } }, { ownerId: v.id, team: -1 });
    this.#remove(v, 'destroyed');
  }

  #remove(v, reason) {
    if (v.removed) return;
    for (const seat of v.seats) if (seat.occupant) this.exit(seat.occupant);
    v.removed = true;
    this.world.version++;
    bus.emit('vehicle:removed', { id: v.id, reason });
  }

  describe(v) {
    return { id: v.id, type: v.type, team: v.team, name: v.def.name, model: v.def.model, at: v.movement.state.position.toArray(), yaw: v.yaw, size: v.def.size };
  }

  /** Compact state for netcode snapshots. */
  serialize(v) {
    return { id: v.id, type: v.type, team: v.team, p: v.movement.state.position.toArray(), vel: v.movement.state.velocity.toArray(), yaw: v.yaw, turret: v.turretYaw, alt: v.altitude, hp: v.health.hp, seats: v.seats.map((s) => s.occupant?.id ?? null) };
  }
}
