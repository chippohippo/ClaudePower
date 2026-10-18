// VehicleSystem: hover bikes, light tanks, dropships, field guns, rocket batteries and supply
// trucks (data/vehicles.json).
//
// Design goals (Battlefront + Helldivers feel):
//  * Snappy entry and exit. Interact within range seats you in 0.35 s (input locked only that long);
//    interact again hops you out to the first clear side. Destruction ejects everyone, hurt and airborne.
//  * Physics models:
//      car     = a rigid body on four raycast wheels (CarPhysics): W/S throttle, brake and
//                reverse, A/D steer, Space the handbrake; it squats, drifts, jumps, rolls and
//                crashes. A hard hit damages it and throws out whoever is exposed (the ring-mount
//                gunner, passengers leaning out), flung on with the speed the car just lost;
//                a rollover does the same; at rest on its side or roof everyone climbs out, and a
//                soldier on foot can push it back over (hold interact). Blasts shove it, and can
//                flip it either way. It runs people down from 30 km/h. Killed, it burns a few
//                seconds before it blows. Bailing out at speed keeps the car's speed: you tumble.
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
//  * Crew-served guns (a `gun` block: towed howitzers and AT guns, self-propelled rocket
//    batteries) are vehicles too; FieldGuns owns setting them up, laying and firing them, and
//    towing. A towed gun (model 'gun') moves at walking pace while its crew pushes it; a truck
//    with a `tow` hitch can tow it (its driver presses H by the gun's trail).
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
import { rayYawBox, localToWorld, angleDelta, hyp } from '../core/geom.js';
import { FieldGuns } from './FieldGuns.js';
import { CarBody } from './CarPhysics.js';
import { orientedFaces } from '../movement/CoverFaces.js';
import { Quaternion } from 'three';

const IDLE = Object.freeze({ ...emptyCommand(), buttons: Object.freeze({}) });   // an empty gun seat's command, every tick

const DEG = Math.PI / 180;
const ENTER_RANGE = 3.2;
const ENTER_TIME = 0.35;
const VEHICLE_IMMUNE = ['scorch', 'ignite', 'volatile', 'blind', 'weaken', 'cloak', 'haste', 'fortify', 'radiant'];
const _f = new Vector3();
const _r = new Vector3();
const _v = new Vector3();
const _p = new Vector3();
const _o = new Vector3(), _d = new Vector3(), _qi = new Quaternion();
export const RIGHT_TIME = 1.5;   // s of holding interact to push a car back onto its wheels
const NO_BUTTON = Object.freeze({ down: false, pressed: false, released: false });
/** EMP: the gun's crew can't fire (nor set it up), but the command otherwise stands. */
const stripFire = (cmd) => ({ ...cmd, buttons: { ...cmd.buttons, light: NO_BUTTON, dig: NO_BUTTON } });

export class VehicleSystem {
  constructor(world, defs) {
    this.world = world;
    this.defs = defs;          // data/vehicles.json
    this.nextId = 200000;      // (per world: a match plays the same whatever ran before it)
    this.list = [];
    this.pads = [];
    this.guns = new FieldGuns(this);
    this.payFor = null;        // (pad) -> boolean: logistics pays for a pad's respawn (null = free)
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
      id: this.nextId++, isVehicle: true, type, def, team, calledBy: ownerId, pad,
      yaw, turretYaw: yaw, altitude: 0, boostTime: 0, boostCd: 0, emptyTime: 0, removed: false, ramCd: new Map(),
    };
    v.movement = {
      state: { position: pos, velocity: new Vector3(), yaw, grounded: true, stance: 'stand', mode: 'vehicle', invulnerable: false, speedScale: 1, sprinting: false, locks: {} },
      // Knock-backs barely move heavy vehicles: scaled by a rough mass from HP.
      impulse: (x, y, z) => { const m = Math.max(1, def.hp / 400); v.movement.state.velocity.x += x / m; v.movement.state.velocity.z += z / m; },
    };
    if (def.model === 'car') {
      // A rigid body on four wheels: its base is the vehicle's position from here on.
      v.car = new CarBody(def, pos, yaw);
      v.flippedT = 0;
      v.movement.impulse = (x, y, z) => v.car.impulse(_v.set(x, y, z).multiplyScalar(v.car.m * 0.12), v.car.c);
    }
    v.health = new Health(v, { health: def.hp, armor: def.armor ?? 'vehicle' });
    v.status = new StatusComponent(v, this.world.statusDefs ?? {}, this.world);
    v.status.immune = new Set(VEHICLE_IMMUNE);
    v.seats = def.seats.map((sd) => ({ def: sd, occupant: null, cmd: null, weapons: sd.weapon ? this.#seatWeapons(v, sd) : null }));
    if (def.gun) this.guns.init(v);
    if (def.cargo) v.cargo = 0;
    v.towing = null;
    this.list.push(v);
    this.world.version++;
    bus.emit('vehicle:spawn', this.describe(v));
    return v;
  }

  addPad({ vehicle, team, at, yaw = 0, respawn = 20, slot = 0, kind = null, group = 'pool' }) {
    const pad = { vehicle, team, at: at.clone(), yaw, respawn, slot, kind, group, timer: 0, current: null };
    pad.current = this.spawn(vehicle, team, at, yaw, { pad });
    this.pads.push(pad);
    return pad;
  }

  /**
   * The motor pool moves up with the front: the pad moves, and its vehicle, if nobody's in it,
   * is taken away and turns up at the new spot a few seconds later. With relocate: false (field
   * guns) the vehicle stays where it is: its crew moves it, and only replacements come to the
   * new spot.
   */
  movePad(pad, at, yaw = pad.yaw, { relocate = true } = {}) {
    pad.at.copy(at); pad.yaw = yaw;
    const v = pad.current;
    if (relocate && v && !v.removed && !v.seats.some((s) => s.occupant) && v.movement.state.position.distanceTo(at) > 15) {
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
  handleInput(e, cmd, dt = 1 / 60) {
    if (e.vehicle) {
      const v = e.vehicle.veh, seat = v.seats[e.vehicle.seat];
      if (e.vehicle.lock > 0) { seat.cmd = emptyCommand(); return true; }
      if (cmd.buttons.interact?.pressed) { this.exit(e); return true; }
      seat.cmd = cmd;
      return true;
    }
    // A car on its side or roof: hold interact beside it to push it back onto its wheels.
    if (cmd.buttons.interact?.down && !e.health.dead && !e.health.downed) {
      const c = this.#flippedNear(e);
      if (c) {
        e.righting = { car: c, t: (e.righting?.car === c ? e.righting.t : 0) + dt };
        if (e.righting.t >= RIGHT_TIME) { c.car.rightIt(); e.righting = null; bus.emit('vehicle:righted', { id: c.id, by: e.id }); }
        return false;
      }
    }
    if (e.righting && !cmd.buttons.interact?.down) e.righting = null;
    if (cmd.buttons.interact?.pressed) {
      const v = this.nearestEnterable(e);
      if (!v) return false;
      const want = cmd.seat;           // a crew member asks for its own seat (commander, loader)
      if (want != null && v.seats[want] && !v.seats[want].occupant) return this.enter(e, v, want);
      return this.enter(e, v);
    }
    return false;
  }

  /** A friendly car lying on its side or roof within reach (the HUD prompts, interact rights it). */
  #flippedNear(e) {
    const p = e.movement.state.position;
    for (const v of this.list) if (v.car && !v.removed && !v.wreck && v.team === e.team && v.car.upright < 0.35 && v.car.speed < 1.5 && v.movement.state.position.distanceTo(p) < v.def.radius + 1.6) return v;
    return null;
  }
  flippedNear(e) { return this.#flippedNear(e); }

  /** Closest vehicle in range that this entity's team can use and that has a free seat. Also used by the HUD prompt. */
  nearestEnterable(e) {
    let best = null, bd = ENTER_RANGE;
    for (const v of this.list) {
      if (v.removed || v.team !== e.team || v.gun?.towedBy || !v.seats.some((s) => !s.occupant) || v.wreck || (v.car && v.car.upright < 0.5)) continue;
      const d = hyp(v.movement.state.position.x - e.movement.state.position.x, v.movement.state.position.z - e.movement.state.position.z) - v.def.radius;
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  enter(e, v, seatIndex = null) {
    const mode = e.movement.state.mode;
    if (e.health.dead || e.health.downed || e.transform || v.team !== e.team || mode === 'ragdoll' || mode === 'knockdown') return false;
    const idx = seatIndex ?? v.seats.findIndex((s) => !s.occupant);
    if (idx < 0 || v.seats[idx].occupant) return false;
    e.abilities?.interrupt?.('vehicle');
    e.weapons?.interrupt?.('vehicle');
    v.seats[idx].occupant = e;
    v.seats[idx].cmd = emptyCommand();
    const lock = ENTER_TIME * (e.perks?.enterTime ?? 1);           // Ace and Drift board faster
    const sd = v.seats[idx].def;
    e.vehicle = { veh: v, seat: idx, lock, exposed: !!sd.exposed, shown: !!sd.shown, pose: sd.pose ?? null };   // shown: protected, but in sight (an open car's driver)
    this.world.version++;
    e.movement.enterVehicle();
    // A seat to lean out of with your own gun (a car's passengers): the gun stays up.
    e.movement.state.armedSeat = !!v.seats[idx].def.ownWeapon;
    if (e.movement.state.armedSeat && e.weapons) e.mode = 'gun';
    v.emptyTime = 0;
    bus.emit('vehicle:enter', { id: v.id, entity: e.id, seat: idx, role: v.seats[idx].def.role, duration: lock, team: v.team });
    return true;
  }

  /**
   * Out of the seat. `eject`: thrown out (destruction); `fling`: thrown out of a crash or a
   * rollover with that velocity, tumbling (a ragdoll). Out of a car you keep its speed, and at
   * speed you tumble too.
   */
  exit(e, { eject = false, fling = null } = {}) {
    const ref = e.vehicle;
    if (!ref) return;
    const v = ref.veh;
    const seat = v.seats[ref.seat];
    seat.occupant = null;
    seat.cmd = null;
    e.vehicle = null;
    e.movement.state.armedSeat = false;
    v.ramCd.set(e.id, 1.5);           // whoever just got out (or was thrown) isn't run over by his own ride
    this.world.version++;
    if (fling) {
      // Thrown from where he sat, on with the speed the car just lost.
      const from = v.car ? v.car.point(_v.fromArray(seat.def.offset), new Vector3()) : localToWorld(new Vector3(), v.movement.state.position, v.yaw, seat.def.offset);
      from.y = Math.max(from.y, this.world.groundHeight(from) + 0.3);
      e.movement.exitVehicle(from, fling);
      // Folded as he sat (a gunner at a ring mount stands), and shoved along the throw at head
      // height: he goes head over heels, not up like a post.
      if (seat.def.pose !== 'stand') e.movement.state.stance = 'crouch';
      e.movement.startRagdoll?.(fling.x * 0.6, 2, fling.z * 0.6, { cause: 'thrown', at: { x: from.x, y: from.y + 1.3, z: from.z }, focus: 0.8 });
      bus.emit('vehicle:exit', { id: v.id, entity: e.id, eject: true, thrown: true });
      return;
    }
    const pos = this.#exitPoint(v);
    const vel = v.movement.state.velocity.clone().multiplyScalar(v.car ? 1 : eject ? 0.2 : 0.5);
    if (eject) vel.y = 6;
    e.movement.exitVehicle(pos, vel);
    // Bailing out of a moving car: you keep its speed, and past a run you go tumbling.
    if (v.car && !eject && Math.hypot(vel.x, vel.z) > 7) e.movement.startRagdoll?.(0, 1, 0, { cause: 'bail' });
    bus.emit('vehicle:exit', { id: v.id, entity: e.id, eject });
  }

  /** First clear spot to the left, right, back or front, falling back to on top. */
  #exitPoint(v) {
    const s = v.movement.state;
    const r = v.car ? v.def.size.x / 2 + 0.7 : v.def.radius + 0.8;
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
      if (hyp(p.x - cx, p.z - cz) < radius) blocked = true;
    });
    return blocked;
  }

  // ---------------------------------------------------------------- simulation
  update(dt) {
    this.guns.tick(dt);
    for (const v of this.list) {
      if (v.removed) continue;
      v.status.update(dt);
      v.health.update(dt);
      if (v.health.dead) {
        // A car burns a few seconds before it blows (time to bail); everything else goes at once.
        if (!v.car || (v.wreck && v.wreck.t >= (v.def.car.burn ?? 6))) { this.#destroy(v); continue; }
        if (!v.wreck) { v.wreck = { t: 0 }; bus.emit('vehicle:burning', { id: v.id, at: v.movement.state.position.toArray(), duration: v.def.car.burn ?? 6 }); }
        v.wreck.t += dt;
      }
      for (const s of v.seats) if (s.occupant?.vehicle) s.occupant.vehicle.lock = Math.max(0, s.occupant.vehicle.lock - dt);

      const driver = v.seats.find((s) => s.def.role === 'driver');
      const cmd = driver?.occupant ? driver.cmd ?? emptyCommand() : emptyCommand();
      const stalled = v.status.rooted;
      const emp = v.status.silenced;

      if (v.gun) this.guns.update(v, emp ? stripFire(cmd) : cmd, dt);
      if (v.def.tow && driver?.occupant && cmd.buttons.dig?.pressed) {
        if (v.towing) this.guns.unhitch(v);
        else { const g = this.guns.hitchable(v); if (g) this.guns.hitch(v, g); }
      }
      if (v.gun?.towedBy) continue;            // trails its tower (below), after the tower has moved
      if (v.car) { this.#car(v, cmd, dt, stalled, driver?.occupant); this.#seatsAndWeapons(v, dt, emp); this.#abandon(v, dt); continue; }
      if (v.def.model === 'gun') this.#carriage(v, cmd, dt, stalled);
      else if (v.def.model === 'tracked') this.#tracked(v, cmd, dt, stalled);
      else if (v.def.model === 'flyer') this.#flyer(v, cmd, dt, stalled);
      else this.#hover(v, cmd, dt, stalled, emp);

      this.#collide(v);
      if (v.def.ram) this.#ram(v, driver?.occupant, dt);
      this.#seatsAndWeapons(v, dt, emp);
      this.#abandon(v, dt);
    }
    this.#carsMeet();
    for (const v of this.list) if (!v.removed && v.gun?.towedBy) { this.guns.follow(v, dt, this.#ground); this.#seatsAndWeapons(v, dt, false); }
    this.list = this.list.filter((v) => !v.removed);
    for (const pad of this.pads) {
      if (pad.current && !pad.current.removed) continue;
      pad.timer += dt;
      if (pad.timer < pad.respawn) continue;
      if (this.payFor && !this.payFor(pad)) { pad.timer = pad.respawn; continue; }   // waits for supplies
      pad.timer = 0; pad.current = this.spawn(pad.vehicle, pad.team, pad.at, pad.yaw, { pad });
    }
  }

  /** Abandonment: an empty pad vehicle far from its pad respawns there after a while. */
  #abandon(v, dt) {
    const occupied = v.seats.some((s) => s.occupant);
    v.emptyTime = occupied ? 0 : v.emptyTime + dt;
    if (v.pad && !occupied && v.emptyTime > (this.defs.pads?.abandonTime ?? 40) && v.movement.state.position.distanceTo(v.pad.at) > 15) this.#remove(v, 'abandoned');
  }

  // ---------------------------------------------------------------- cars
  /** What the car physics asks of the world. */
  #carWorld = {
    terrainHeight: (x, z) => this.world.terrain ? this.world.terrain.height(x, z) : 0,
    terrainNormal: (x, z, out) => this.world.terrain ? this.world.terrain.normal(x, z, out) : out.set(0, 1, 0),
    groundHeight: (p) => this.world.groundHeight(p),
    coverIn: (x0, z0, x1, z1, fn) => this.world.coverIn(x0, z0, x1, z1, fn),
  };

  #car(v, cmd, dt, stalled, driver) {
    const s = v.movement.state, C = v.car;
    if (s.position.distanceToSquared(C.base) > 1e-4) C.teleport(s.position);   // somebody moved it
    // (Smashed past a fifth of its HP, its engine's gone: it rolls, it doesn't drive.)
    const res = C.step(this.#carWorld, { throttle: cmd.moveY, steer: cmd.moveX, handbrake: !!cmd.buttons.jump?.down, dead: stalled || !!v.wreck || !driver || v.health.hp < v.health.max * 0.2 }, dt, driver?.perks?.handling ?? 1);
    s.position.copy(C.base); s.velocity.copy(C.vel); v.yaw = C.yaw;
    s.grounded = res.grounded;
    const gunner = v.seats.find((q) => q.def.role === 'gunner');
    if (gunner?.cmd) v.turretYaw = gunner.cmd.yaw;
    this.#crash(v, res, dt);
    if (v.def.ram) this.#ram(v, driver, dt);
    if (Math.hypot(s.velocity.x, s.velocity.z) > 1) this.world.cutWire?.(s.position, 0.8);
  }

  /**
   * What a crash does: the car takes the hit; past `eject`, or rolling over, everyone exposed is
   * thrown out with the speed the car had; past `hurt`, those inside are hurt. At rest on its
   * side or roof, everyone climbs out.
   */
  #crash(v, res, dt) {
    const Cr = v.def.car.crash, C = v.car, up = C.upright, impact = res.impact;
    if (impact > Cr.min) {
      v.health.damage((impact - Cr.min) * Cr.damage, { kind: 'crash' }, null);
      bus.emit('vehicle:crash', { id: v.id, impact, at: v.movement.state.position.toArray(), rolled: up < 0.3 });
    }
    // Going over (past the tipping point, ~53 degrees: it will roll): nobody stays in an open seat.
    const rolling = up < 0.6;
    if (impact > Cr.eject || rolling) {
      for (const seat of v.seats) {
        const e = seat.occupant;
        if (!e || !seat.def.exposed) continue;
        // On with the speed the car had before the hit; rolling, with the speed his seat had and
        // out of the hatch the way the roof is going over.
        const base = impact > Cr.eject ? res.before : C.pointVelocity(_v.fromArray(seat.def.offset), _p);
        const fling = new Vector3(base.x * 0.9, Math.min(7, Math.max(3, base.y + 3 + Math.min(4, impact * 0.25))), base.z * 0.9);
        if (impact <= Cr.eject) { _d.set(0, 1, 0).applyQuaternion(C.q).setY(0); if (_d.lengthSq() > 1e-4) fling.addScaledVector(_d.normalize(), Cr.roll ?? 4); }
        this.exit(e, { fling });
        e.health.damage(Math.max(8, impact * 3), { kind: 'crash', thrown: true }, null);
      }
    }
    if (impact > Cr.hurt) {
      for (const seat of v.seats) if (seat.occupant && !seat.def.exposed) seat.occupant.health.damage((impact - Cr.hurt) * Cr.hurtMul, { kind: 'crash' }, null);
    }
    // On its side or roof and stopped: everyone climbs out.
    v.flippedT = up < 0.35 && C.speed < 1.5 ? v.flippedT + dt : 0;
    if (v.flippedT > 0.6) for (const seat of v.seats) if (seat.occupant) this.exit(seat.occupant);
  }

  /** Cars against each other and against other vehicles: pushed apart, an impulse each. */
  #carsMeet() {
    const cars = this._cars ??= [];
    cars.length = 0;
    for (const v of this.list) if (v.car && !v.removed) cars.push(v);
    if (!cars.length) return;
    for (const a of cars) {
      const A = a.car, pa = a.movement.state.position;
      for (const b of this.list) {
        if (b === a || b.removed || (b.car && b.id < a.id)) continue;
        const pb = b.movement.state.position, R = a.def.radius * 0.85 + b.def.radius * 0.85;
        const dx = pa.x - pb.x, dz = pa.z - pb.z, d = Math.hypot(dx, dz);
        if (d >= R || d < 1e-4 || Math.abs(pa.y - pb.y) > 3) continue;
        const nx = dx / d, nz = dz / d, push = (R - d) * 0.5;
        _d.set(nx, 0, nz);
        const mb = b.car ? b.car.m : Math.max(1500, b.def.hp * 3);
        const share = mb / (A.m + mb);
        A.c.addScaledVector(_d, push * 2 * share);
        const vb = b.car ? b.car.vel : b.movement.state.velocity;
        const rel = (A.vel.x - vb.x) * nx + (A.vel.z - vb.z) * nz;
        if (rel >= 0) continue;
        const j = (-1.2 * rel) / (1 / A.m + 1 / mb);
        const at = _o.set(pa.x - nx * a.def.size.x * 0.4, A.c.y, pa.z - nz * a.def.size.x * 0.4);
        A.impulse(_v.set(nx * j, 0, nz * j), at);
        if (b.car) { b.car.c.addScaledVector(_d, -push * 2 * (1 - share)); b.car.impulse(_v.set(-nx * j, 0, -nz * j), at); }
        else { vb.x -= nx * j / mb; vb.z -= nz * j / mb; }
        const dv = j / A.m;
        if (dv > a.def.car.crash.min) this.#crash(a, { impact: dv, before: A.prevVel.clone(), grounded: true }, 0);
        if (b.car && j / b.car.m > b.def.car.crash.min) this.#crash(b, { impact: j / b.car.m, before: b.car.prevVel.clone(), grounded: true }, 0);
      }
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
    // Back on the stick (S) cuts a boost short: the brake.
    if (v.boostTime > 0 && cmd.moveY < -0.5) { v.boostTime = 0; bus.emit('vehicle:boostEnd', { id: v.id }); }
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
    // climb (0.5 m; anything taller stops them, or is crushed), what a truck rides over (`climb`).
    const base = s.position.y - (d.hoverHeight ?? 0), probeY = d.model === 'hover' || d.model === 'flyer' ? base : base + (d.climb ?? 0.5) - 1.5;
    let best = -Infinity;
    const c = Math.cos(v.yaw), sn = Math.sin(v.yaw);
    for (let k = 0; k < 5; k++) {
      // Centre, nose, tail, left, right (localToWorld's rotation, without an array per probe).
      const lx = k === 3 ? -hw : k === 4 ? hw : 0, lz = k === 1 ? -hl : k === 2 ? hl : 0;
      _p.set(s.position.x + lx * c + lz * sn, probeY, s.position.z - lx * sn + lz * c);
      best = Math.max(best, this.world.groundHeight(_p));
    }
    return best;
  }

  #tracked(v, cmd, dt, stalled) {
    const d = v.def, s = v.movement.state;
    // A self-propelled gun that is set up (or setting up) has its stabilizers down: it can't move.
    const anchored = stalled || (v.gun && v.gun.state !== 'packed');
    // Tank controls: A/D turn the hull, W/S throttle; the turret follows the camera at its own rate.
    if (!anchored) v.yaw -= cmd.moveX * d.turnRate * DEG * dt;
    v.turretYaw += Math.max(-d.turretTurnRate * DEG * dt, Math.min(d.turretTurnRate * DEG * dt, angleDelta(v.turretYaw, cmd.yaw)));
    this.#basis(v.yaw);
    const throttle = anchored ? 0 : cmd.moveY;
    const top = (throttle < 0 ? d.reverseSpeed : d.maxSpeed) * v.status.speedMul * (v.towing ? 0.75 : 1);
    if (anchored && v.gun) s.velocity.multiplyScalar(Math.exp(-6 * dt));
    s.velocity.addScaledVector(_f, throttle * d.accel * dt);
    this.#gripAndDrag(v, dt, throttle === 0);
    this.#clampSpeed(s.velocity, top);
    s.position.addScaledVector(s.velocity, dt);
    // Tracks bridge a trench (the hull rests on its edges) and settle smoothly after a crossing.
    const ground = this.#support(v, 0.85);
    s.position.y = ground > s.position.y ? ground : s.position.y + (ground - s.position.y) * Math.min(1, dt * 10);
    // What tanks were built for: wire flattened under the tracks.
    if ((d.cutsWire ?? true) && hyp(s.velocity.x, s.velocity.z) > 1) this.world.cutWire?.(s.position, d.radius * 0.8);
  }

  /**
   * A towed gun on its own wheels: the commander pushes it with tank controls at walking pace
   * while it's packed. Set up (or setting up), its spades are in the ground and it doesn't move.
   */
  #carriage(v, cmd, dt, stalled) {
    const d = v.def, s = v.movement.state, packed = v.gun.state === 'packed';
    const pushing = packed && !stalled && !!v.seats[0]?.occupant;
    if (pushing) v.yaw -= cmd.moveX * d.turnRate * DEG * dt;
    this.#basis(v.yaw);
    const throttle = pushing ? cmd.moveY : 0;
    s.velocity.addScaledVector(_f, throttle * d.accel * dt);
    this.#gripAndDrag(v, dt, throttle === 0);
    this.#clampSpeed(s.velocity, (throttle < 0 ? d.reverseSpeed : d.maxSpeed) * v.status.speedMul);
    if (!packed) s.velocity.set(0, 0, 0);
    s.position.addScaledVector(s.velocity, dt);
    const ground = this.#support(v, 0.8);
    s.position.y = ground > s.position.y ? ground : s.position.y + (ground - s.position.y) * Math.min(1, dt * 10);
  }

  /** Ground under a vehicle's hull (a bound helper for towed guns). */
  #ground = (v) => this.#support(v, 0.8);

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
    const h = hyp(vel.x, vel.z);
    if (h > top && h > 0) { vel.x *= top / h; vel.z *= top / h; }
  }

  /** Circle vs. cover boxes in XZ. Low cover is skimmed over (hover) or ignored (flyers above it). */
  #collide(v) {
    const s = v.movement.state, d = v.def;
    const base = s.position.y - (d.hoverHeight ?? 0);
    const near = this._near ??= [];
    near.length = 0;
    this.world.coverIn(s.position.x - d.radius, s.position.z - d.radius, s.position.x + d.radius, s.position.z + d.radius, (b) => near.push(b));
    const speed = hyp(s.velocity.x, s.velocity.z);
    for (const b of near) {
      // Tanks crush what's destructible and not too tall under their tracks (sandbags, crates,
      // broken walls): a tank crossing a trench line leaves a gap in the parapet behind it.
      if ((d.crush ?? d.model === 'tracked') && b.destructible && b.max.y - base < 2 && b.max.y > base - 0.3 && speed > 0.8) {
        const cx = Math.max(b.min.x, Math.min(s.position.x, b.max.x)), cz = Math.max(b.min.z, Math.min(s.position.z, b.max.z));
        if (hyp(s.position.x - cx, s.position.z - cz) < d.radius * 0.8) {
          this.world.removeCover?.(b, v.seats.find((q) => q.def.role === 'driver')?.occupant ?? v);
          s.velocity.multiplyScalar(0.93);
          continue;
        }
      }
      if (b.max.y <= base + (d.model === 'tracked' || d.model === 'gun' ? d.climb ?? 0.5 : 1.2)) continue;
      if (d.model === 'flyer' && base > b.max.y) continue;
      const cx = Math.max(b.min.x, Math.min(s.position.x, b.max.x)), cz = Math.max(b.min.z, Math.min(s.position.z, b.max.z));
      let nx = s.position.x - cx, nz = s.position.z - cz;
      const dist = hyp(nx, nz);
      if (dist >= d.radius) continue;
      if (dist < 1e-4) { nx = 1; nz = 0; } else { nx /= dist; nz /= dist; }
      s.position.x = cx + nx * d.radius; s.position.z = cz + nz * d.radius;
      const vn = s.velocity.x * nx + s.velocity.z * nz;
      if (vn < 0) {
        const pre = _o.copy(s.velocity);
        s.velocity.x -= 1.3 * vn * nx; s.velocity.z -= 1.3 * vn * nz;
        const impact = -vn;
        if (d.crash && impact > d.crash.minSpeed) {
          v.health.damage((impact - d.crash.minSpeed + 1) * d.crash.damagePerMs, { kind: 'crash' }, null);
          bus.emit('vehicle:crash', { id: v.id, impact, at: s.position.toArray() });
          // Over the bars: a hard enough hit throws an exposed rider up and on, the way he was going.
          if (impact > (d.crash.eject ?? Infinity)) {
            for (const seat of v.seats) {
              const e = seat.occupant;
              if (!e || !seat.def.exposed) continue;
              this.exit(e, { fling: new Vector3(pre.x * 0.5, 5.5, pre.z * 0.5) });
              e.health.damage(impact, { kind: 'crash', thrown: true }, null);
            }
          }
        }
      }
    }
  }

  #ram(v, driver, dt) {
    const s = v.movement.state, r = v.def.ram;
    for (const [k, t] of v.ramCd) if (t - dt <= 0) v.ramCd.delete(k); else v.ramCd.set(k, t - dt);
    const speed = hyp(s.velocity.x, s.velocity.z);
    if (speed < 0.5 && !v.ramCd.size) return;      // parked: nobody gets rammed
    const near = this._ramNear ??= [];
    near.length = 0;
    this.world.fightersNear(s.position, v.def.radius + 1.5, (e) => { if (!e.isVehicle && !e.isDeployable) near.push(e); });
    for (const e of near) {
      if (e.vehicle || e.health.dead || v.ramCd.has(e.id)) continue;
      _v.subVectors(e.movement.state.position, s.position); _v.y = 0;
      const dist = _v.length();
      if (dist > v.def.radius + 0.4 || Math.abs(e.movement.state.position.y - (s.position.y - (v.def.hoverHeight ?? 0))) > 2) continue;
      _v.divideScalar(dist || 1);
      v.ramCd.set(e.id, 0.6);
      // Friendly fire: a vehicle at speed runs down whoever is in its way (rules: `ram`).
      const share = this.world.harm ? this.world.harm(v.team, e, 'ram') : e.team === v.team ? 0 : 1;
      if (!share || speed < r.minSpeed) { e.movement.impulse?.(_v.x * 3, 0, _v.z * 3); continue; } // nudge, no damage
      const dmg = speed * r.damagePerMs * share;
      e.health.damage(dmg, { kind: 'ram', vehicle: v.type, friendly: e.team === v.team }, driver ?? v);
      e.movement.impulse?.(_v.x * r.knock, 4, _v.z * r.knock);
      const phased = v.boostTime > 0 && v.def.boost?.phase;
      if (r.selfDamageMul && !phased) v.health.damage(dmg * r.selfDamageMul, { kind: 'ramSelf' }, null);
      if (v.car) v.car.vel.multiplyScalar(0.9); else s.velocity.multiplyScalar(0.8);
      bus.emit('vehicle:ram', { id: v.id, victim: e.id, damage: dmg, speed });
    }
  }

  #seatsAndWeapons(v, dt, emp) {
    const s = v.movement.state;
    for (const seat of v.seats) {
      const occ = seat.occupant;
      if (occ) {
        if (v.car) v.car.point(_v.fromArray(seat.def.offset), occ.movement.state.position);
        else localToWorld(occ.movement.state.position, s.position, v.yaw, seat.def.offset);
        occ.movement.state.velocity.copy(s.velocity);
        occ.movement.body?.teleport?.(occ.movement.state.position);
      }
      // Leaning out with his own gun: it fires along his aim, from where he sits.
      if (occ && seat.def.ownWeapon && occ.weapons) {
        const c = seat.cmd ?? emptyCommand();
        occ.weapons.update(occ.vehicle?.lock > 0 ? IDLE : { ...c, buttons: { ...c.buttons, sprint: NO_BUTTON } }, dt);
      }
      if (!seat.weapons) continue;
      const wc = seat.weapons;
      wc.owner.movement.state.position = s.position;
      if (!occ) { wc.update(IDLE, dt); continue; }
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
      const h = this.rayOne(v, o, dir, best ? best.distance : max, ignoreId);
      if (h) best = h;
    }
    return best;
  }

  /**
   * Ray vs. one hull (CombatWorld tests the hulls its spatial grid finds along the ray, instead
   * of every vehicle on the map). A bounding-sphere check first, then the oriented box.
   */
  rayOne(v, o, dir, max, ignoreId) {
    if (v.removed || v.id === ignoreId) return null;
    if (ignoreId != null && v.seats.some((s) => s.occupant?.id === ignoreId)) return null;   // your own ride doesn't stop your rounds
    const d = v.def;
    const vp = v.movement.state.position, cx = vp.x - o.x, cy = vp.y - (d.hoverHeight ?? 0) + d.size.y * 0.5 - o.y, cz = vp.z - o.z;
    const along = Math.max(0, Math.min(max, cx * dir.x + cy * dir.y + cz * dir.z));
    const ex = cx - dir.x * along, ey = cy - dir.y * along, ez = cz - dir.z * along, rb = (v.boundR ??= 0.5 * hyp(d.size.x, d.size.y, d.size.z));
    if (ex * ex + ey * ey + ez * ez > rb * rb) return null;
    const base = _p.copy(vp); base.y -= d.hoverHeight ?? 0;
    let hit;
    if (v.car) {
      // A car can be on its side or roof: the ray into its body frame, against the upright box.
      _qi.copy(v.car.q).invert();
      _o.subVectors(o, base).applyQuaternion(_qi).add(base);
      _d.copy(dir).applyQuaternion(_qi);
      hit = rayYawBox(_o, _d, base, 0, v.half ??= { x: d.size.x / 2, y: d.size.y, z: d.size.z / 2 }, max);
    } else hit = rayYawBox(o, dir, base, v.yaw, v.half ??= { x: d.size.x / 2, y: d.size.y, z: d.size.z / 2 }, max);
    if (!hit) return null;
    const weak = d.weakSpot === 'rear' && hit.local.z > d.size.z * 0.2;
    return { entity: v, distance: hit.t, point: o.clone().addScaledVector(dir, hit.t), zone: weak ? 'head' : 'body', weakSpot: weak, surface: 'vehicle' };
  }

  #destroy(v) {
    const s = v.movement.state;
    if (v.towing) this.guns.unhitch(v);
    if (v.gun?.towedBy) this.guns.unhitch(v.gun.towedBy);
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
    if (v.towing) this.guns.unhitch(v);
    if (v.gun?.towedBy) this.guns.unhitch(v.gun.towedBy);
    for (const seat of v.seats) if (seat.occupant) this.exit(seat.occupant);
    v.removed = true;
    this.world.version++;
    bus.emit('vehicle:removed', { id: v.id, reason });
  }

  /**
   * The sides of the parked cars near (x, z) to take cover behind (movement's cover: CoverFaces),
   * as high as their bodywork (you crouch behind a car and come up over its bonnet to shoot).
   */
  coverFaces(x, z, r, out) {
    for (const v of this.list) {
      if (!this.coverHolds(v)) continue;
      const p = v.movement.state.position, S = v.def.size, R = r + v.def.radius;
      if (Math.abs(p.x - x) > R || Math.abs(p.z - z) > R) continue;
      orientedFaces(p.x, p.z, v.yaw, S.x / 2, S.z / 2, p.y, p.y + Math.min(S.y, 1.25), v, out);
    }
  }

  /** Is a car still cover? Parked: whole, on its wheels, standing still (not driven off, not burning). */
  coverHolds(v) { return !!(v.car && !v.removed && !v.wreck && !v.health.dead && v.car.upright > 0.7 && v.car.speed < 0.8); }

  describe(v) {
    return { id: v.id, type: v.type, team: v.team, name: v.def.name, model: v.def.model, at: v.movement.state.position.toArray(), yaw: v.yaw, size: v.def.size, gun: v.def.gun?.kind ?? null };
  }

  /** Compact state for netcode snapshots. */
  serialize(v) {
    const g = v.gun;
    return {
      id: v.id, type: v.type, team: v.team, p: v.movement.state.position.toArray(), vel: v.movement.state.velocity.toArray(), yaw: v.yaw, turret: v.turretYaw, alt: v.altitude, hp: v.health.hp, seats: v.seats.map((s) => s.occupant?.id ?? null),
      ...(g ? { gun: { st: g.state, t: g.t, y: g.yaw, p: g.pitch, a: g.ammo, l: g.load, tow: g.towedBy?.id ?? null } } : {}),
      ...(v.def.cargo ? { cargo: v.cargo } : {}),
    };
  }
}
