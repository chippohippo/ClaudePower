// DeployableSystem: placed objects (walls, turrets, mines, tripwires, beacons, launch pads,
// recast charges, decoys, vehicle drops, pulse engines).
//
// Each deployable is a lightweight *hittable entity*: it has `id`, `team`, `health` (a real Health),
// and `movement.state.position`. Guns, explosions and abilities damage it through the same code
// paths as players, so shooting a turret core is just shooting.
//
// Clarity contract:
//  * Every deployable is team-colored and emits `deployable:spawn` with its footprint.
//  * Hidden threats (mines, tripwires, charges) always leak information: an audible proximity tick
//    to nearby enemies, a blink or a glint. Nothing is ever invisible and silent at the same time.
//  * Turrets expose `aimYaw` and `target` every tick for laser-sight rendering, and they turn at a
//    readable `turnRate`, so you can strafe faster than they track.
//  * Pulsing devices (Collapse Engine) emit `deployable:charging` 1 s before each pulse.
//
// Per-owner limits stop spam: placing past the limit removes your oldest one of that kind.

import { Vector3 } from 'three';
import { bus } from '../core/EventBus.js';
import { Health } from './Health.js';

const LIMITS = { wall: 1, turret: 2, mine: 2, tripwire: 2, beacon: 1, launchpad: 1, charge: 1, decoy: 1, vehicle: 1, engine: 1 };
const ARM_TIME = { mine: 0.8, tripwire: 0.8 };
const _v = new Vector3();
const _f = new Vector3();
let nextDeployableId = 100000;

export class DeployableSystem {
  constructor(world) {
    this.world = world;
    this.list = [];
  }

  spawn(spec) {
    const owner = this.world.entity(spec.ownerId);
    // Enforce limits: oldest of this kind from this owner goes first.
    const mine = this.list.filter((d) => d.ownerId === spec.ownerId && d.kind === spec.kind);
    const limit = spec.maxPerOwner ?? LIMITS[spec.kind] ?? 1;
    while (mine.length >= limit) this.destroy(mine.shift(), 'replaced');

    const pos = (spec.at ?? owner.movement.state.position).clone();
    // Ground-snap everything except charges, which stick to whatever they hit.
    if (spec.kind !== 'charge' || !spec.at?.onSurface) pos.y = this.world.groundHeight?.(pos) ?? 0;
    if (spec.kind === 'decoy') pos.copy(owner.movement.state.position);

    const d = {
      id: nextDeployableId++, isDeployable: true, ...spec, team: spec.team, owner,
      movement: { state: { position: pos, invulnerable: false, yaw: spec.yaw ?? 0, velocity: new Vector3() } },
      age: 0, armed: !ARM_TIME[spec.kind], aimYaw: spec.yaw ?? 0, target: null, cooldowns: new Map(), sincePulse: 0, sinceTickCue: 0,
    };
    // HP 1 for "shoot it" counterplay objects; real HP for walls, turrets, beacons and engines.
    const hp = spec.hp ?? ({ mine: 1, tripwire: 1, charge: 1, decoy: 1 }[spec.kind]);
    if (hp) d.health = new Health(d, { health: hp, armor: spec.kind === 'wall' || spec.kind === 'engine' ? 'barrier' : 'plate' });
    this.list.push(d);
    bus.emit('deployable:spawn', this.describe(d));
    return d;
  }

  update(dt) {
    for (const d of this.list) {
      d.age += dt;
      if (d.health?.dead) { this.destroy(d, 'destroyed'); continue; }
      if (d.lifetime && d.age >= d.lifetime && d.kind !== 'vehicle') { this.destroy(d, 'expired'); continue; }
      if (!d.armed && d.age >= ARM_TIME[d.kind]) { d.armed = true; bus.emit('deployable:armed', { id: d.id, kind: d.kind }); }
      for (const [k, t] of d.cooldowns) if (t - dt <= 0) d.cooldowns.delete(k); else d.cooldowns.set(k, t - dt);
      const tick = this[`tick_${d.kind}`];
      if (tick) tick.call(this, d, dt);
    }
    this.list = this.list.filter((d) => !d.removed);
  }

  // ---------------------------------------------------------------- per-kind behaviour
  tick_turret(d, dt) {
    const p = _v.copy(d.movement.state.position).setY(d.movement.state.position.y + 1.1);
    // Re-acquire the nearest visible enemy, preferring to keep the current one.
    if (!d.target || d.target.health.dead || !this.#visible(p, d.target, d.range)) d.target = this.#nearestVisibleEnemy(d, p);
    if (!d.target) return;
    const tp = d.target.movement.state.position;
    const want = Math.atan2(-(tp.x - p.x), -(tp.z - p.z));
    let diff = ((want - d.aimYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    const maxTurn = ((d.turnRate ?? 90) * Math.PI / 180) * dt;
    d.aimYaw += Math.max(-maxTurn, Math.min(maxTurn, diff));
    diff = Math.abs(((want - d.aimYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    // Fire only when roughly on target (within 5°): strafing perpendicular beats a slow turret.
    if (diff < 0.09) {
      const dmg = d.dps * dt;
      d.target.health.damage(dmg, { kind: 'deployable', ability: d.ability, ammoType: 'kinetic' }, d.owner);
      if (d.lifesteal) d.owner?.health.heal(dmg * d.lifesteal);
      if (d.status) d.target.status?.apply(d.status.id, { stacks: (d.status.stacks ?? 1) * dt * 2, source: d.owner });
      d.fireT = (d.fireT ?? 0) + dt;
      if (d.fireT >= 0.125) { d.fireT = 0; bus.emit('deployable:fire', { id: d.id, from: p.toArray(), to: tp.toArray(), team: d.team }); }
    }
  }

  tick_mine(d, dt) {
    if (!d.armed) return;
    const p = d.movement.state.position;
    this.#proximityCue(d, dt, 6);
    const victim = this.#enemies(d).find((e) => e.movement.state.position.distanceTo(p) <= d.trigger);
    if (victim) this.#trigger(d, d.onTrigger, p);
  }

  tick_tripwire(d, dt) {
    if (!d.armed) return;
    // The wire runs `length` metres along the placement yaw. Anyone crossing within 0.35 m trips it.
    const a = d.movement.state.position;
    _f.set(-Math.sin(d.yaw), 0, -Math.cos(d.yaw));
    for (const e of this.#enemies(d)) {
      _v.subVectors(e.movement.state.position, a).setY(0);
      const along = _v.dot(_f);
      if (along < 0 || along > d.length) continue;
      if (_v.addScaledVector(_f, -along).length() < 0.35 && e.movement.state.stance !== 'prone') {
        if (d.onTrigger.status) e.status?.apply(d.onTrigger.status.id, { stacks: d.onTrigger.status.stacks ?? 1, source: d.owner });
        if (d.onTrigger.reveal) e.status?.apply('revealed', { duration: d.onTrigger.reveal, source: d.owner });
        bus.emit('deployable:triggered', { id: d.id, kind: d.kind, victim: e.id, point: e.movement.state.position.toArray() });
        this.destroy(d, 'triggered');
        return;
      }
    }
  }

  tick_beacon(d) {
    const a = d.aura;
    for (const e of this.world.fighters()) {
      if (e.team !== d.team || e.movement.state.position.distanceTo(d.movement.state.position) > a.radius) continue;
      if (a.status) e.status?.apply(a.status, { duration: 0.5, source: d.owner });
      if (a.reloadMul) e.weapons?.applyBuff({ reloadMul: a.reloadMul }, 0.5);
    }
  }

  tick_launchpad(d) {
    for (const e of this.world.fighters()) {
      if (e.team !== d.team || d.cooldowns.has(e.id)) continue;
      _v.subVectors(e.movement.state.position, d.movement.state.position);
      if (Math.hypot(_v.x, _v.z) < 1.2 && Math.abs(_v.y) < 0.6) {
        e.movement.impulse(0, d.launch, 0);
        d.cooldowns.set(e.id, 1);
        bus.emit('deployable:launch', { id: d.id, entity: e.id });
      }
    }
  }

  tick_decoy(d, dt) {
    // Runs forward along the owner's facing for its lifetime. No footstep audio (its tell).
    _f.set(-Math.sin(d.yaw), 0, -Math.cos(d.yaw));
    d.movement.state.position.addScaledVector(_f, 5.5 * dt);
  }

  tick_vehicle(d) {
    if (d.arrived || d.age < (d.delay ?? 2)) return;
    d.arrived = true;
    // Standing on the marker denies the drop (stated counterplay). The cooldown is not refunded.
    const blocker = this.#enemies(d).find((e) => e.movement.state.position.distanceTo(d.movement.state.position) < 2);
    if (blocker) { bus.emit('deployable:vehicleDenied', { id: d.id, by: blocker.id, owner: d.ownerId }); this.destroy(d, 'denied'); return; }
    bus.emit('deployable:vehicleArrived', { id: d.id, vehicle: d.vehicle, at: d.movement.state.position.toArray(), owner: d.ownerId, team: d.team });
    this.destroy(d, 'delivered');
  }

  tick_engine(d, dt) {
    const pulse = d.pulse;
    d.sincePulse += dt;
    if (!d.charging && d.sincePulse >= pulse.interval - 1) { d.charging = true; bus.emit('deployable:charging', { id: d.id, in: 1, radius: pulse.radius }); }
    if (d.sincePulse >= pulse.interval) {
      d.sincePulse = 0; d.charging = false;
      const p = d.movement.state.position;
      for (const e of this.#enemies(d)) {
        if (e.movement.state.position.distanceTo(p) > pulse.radius) continue;
        e.health.damage(pulse.damage, { kind: 'deployable', ability: d.ability }, d.owner);
        if (pulse.status) e.status?.apply(pulse.status, { source: d.owner });
      }
      bus.emit('deployable:pulse', { id: d.id, center: p.toArray(), radius: pulse.radius, team: d.team });
    }
  }

  tick_charge(d, dt) { this.#proximityCue(d, dt, 8, 0.5); }

  // ---------------------------------------------------------------- queries
  /** Recast hook: returns the planted charge's position and removes it, or null if it's gone. */
  consumeCharge(ownerId, ability) {
    const d = this.list.find((x) => x.kind === 'charge' && x.ownerId === ownerId && x.ability === ability && !x.removed);
    if (!d) return null;
    const p = d.movement.state.position.clone();
    this.destroy(d, 'detonated');
    return p;
  }

  /** Ray vs. deployable hit volumes. Walls are oriented boxes; everything else is a sphere. */
  raycast(o, dir, max, team = null) {
    let best = null;
    for (const d of this.list) {
      if (!d.health || d.health.dead || d.removed) continue;
      const t = d.kind === 'wall' ? this.#rayWall(d, o, dir, max) : this.#raySphere(d, o, dir, max);
      if (t && (!best || t.distance < best.distance)) best = t;
    }
    return best;
  }

  inRadius(p, r) { return this.list.filter((d) => d.health && !d.removed && d.movement.state.position.distanceTo(p) <= r); }

  destroy(d, reason) {
    if (d.removed) return;
    d.removed = true;
    bus.emit('deployable:removed', { id: d.id, kind: d.kind, reason, owner: d.ownerId, team: d.team });
  }

  describe(d) {
    return {
      id: d.id, kind: d.kind, team: d.team, owner: d.ownerId, ability: d.ability, at: d.movement.state.position.toArray(), yaw: d.yaw ?? 0,
      width: d.width, height: d.height, length: d.length, range: d.range, trigger: d.trigger, radius: d.aura?.radius ?? d.pulse?.radius, lifetime: d.lifetime,
    };
  }

  // ---------------------------------------------------------------- internals
  #trigger(d, t, at) {
    for (const e of this.#enemies(d)) {
      if (e.movement.state.position.distanceTo(at) > (t.radius ?? d.trigger)) continue;
      if (t.status) e.status?.apply(t.status.id, { stacks: t.status.stacks ?? 1, duration: t.status.duration, source: d.owner });
      if (t.reveal) e.status?.apply('revealed', { duration: t.reveal, source: d.owner });
      if (t.damage) e.health.damage(t.damage, { kind: 'deployable', ability: d.ability }, d.owner);
    }
    bus.emit('deployable:triggered', { id: d.id, kind: d.kind, point: at.toArray(), radius: t.radius ?? d.trigger, team: d.team });
    this.destroy(d, 'triggered');
  }

  #proximityCue(d, dt, range, every = 0.75) {
    d.sinceTickCue += dt;
    if (d.sinceTickCue < every) return;
    d.sinceTickCue = 0;
    const near = this.#enemies(d).filter((e) => e.movement.state.position.distanceTo(d.movement.state.position) <= range).map((e) => e.id);
    if (near.length) bus.emit('deployable:proximity', { id: d.id, kind: d.kind, listeners: near, at: d.movement.state.position.toArray() });
  }

  #enemies(d) { return this.world.fighters().filter((e) => e.team !== d.team && !e.health.dead && !e.movement.state.invulnerable); }

  #nearestVisibleEnemy(d, p) {
    let best = null, bd = Infinity;
    for (const e of this.#enemies(d)) {
      if (e.status?.has('cloak')) continue;
      const dist = e.movement.state.position.distanceTo(p);
      if (dist < bd && this.#visible(p, e, d.range)) { bd = dist; best = e; }
    }
    return best;
  }

  #visible(p, e, range) {
    const tp = _f.copy(e.movement.state.position); tp.y += 1.1;
    const dir = tp.clone().sub(p); const len = dir.length();
    if (len > range) return false;
    return !this.world.raycastStatic?.(p, dir.divideScalar(len), len);
  }

  #raySphere(d, o, dir, max) {
    const r = d.kind === 'turret' || d.kind === 'engine' || d.kind === 'beacon' ? 0.6 : 0.25;
    const c = _v.copy(d.movement.state.position); c.y += d.kind === 'turret' ? 1.0 : d.kind === 'engine' ? 1.2 : d.kind === 'decoy' ? 1.1 : 0.15;
    const oc = c.sub(o);
    const t = oc.dot(dir);
    if (t < 0 || t > max || oc.lengthSq() - t * t > r * r) return null;
    return { entity: d, distance: t, point: o.clone().addScaledVector(dir, t), zone: 'body' };
  }

  #rayWall(d, o, dir, max) {
    // Transform the ray into wall-local space (x = width, y = up, z = thickness).
    const p = d.movement.state.position;
    const cy = Math.cos(-d.yaw), sy = Math.sin(-d.yaw);
    const lo = { x: (o.x - p.x) * cy + (o.z - p.z) * sy, y: o.y - p.y, z: -(o.x - p.x) * sy + (o.z - p.z) * cy };
    const ld = { x: dir.x * cy + dir.z * sy, y: dir.y, z: -dir.x * sy + dir.z * cy };
    const half = { x: d.width / 2, y: d.height, z: 0.2 };
    let tmin = 0, tmax = max;
    for (const a of ['x', 'y', 'z']) {
      const lo_ = a === 'y' ? 0 : -half[a], hi = half[a];
      if (Math.abs(ld[a]) < 1e-8) { if (lo[a] < lo_ || lo[a] > hi) return null; continue; }
      let t1 = (lo_ - lo[a]) / ld[a], t2 = (hi - lo[a]) / ld[a];
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
    const point = o.clone().addScaledVector(dir, tmin);
    // The emitter strip along the base counts as a headshot (Aegis Wall counterplay).
    return { entity: d, distance: tmin, point, zone: point.y - p.y < 0.35 ? 'head' : 'body', normal: new Vector3(Math.sin(d.yaw), 0, Math.cos(d.yaw)), surface: 'hardlight' };
  }
}
