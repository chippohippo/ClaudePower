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
import { EntityGrid } from '../world/EntityGrid.js';

const LIMITS = { wall: 1, turret: 2, mine: 2, tripwire: 2, beacon: 1, launchpad: 1, charge: 1, decoy: 1, vehicle: 1, engine: 1 };
const ARM_TIME = { mine: 0.8, tripwire: 0.8 };
const SCAN = 0.2;   // s between an idle turret's looks around (it re-checks its current target every tick)
const _v = new Vector3();
const _f = new Vector3();
// Scratch that must survive calls back into this system: the turret muzzle is the origin of its
// line-of-sight rays, which run through raycast() -> #raySphere(), so neither may share _v.
const _muzzle = new Vector3();
const _c = new Vector3();
const _drop = new Vector3();   // vehicle drop spot probes

export class DeployableSystem {
  constructor(world) {
    this.world = world;
    this.nextId = 100000;   // (per world: a match plays the same whatever ran before it)
    this.list = [];
    this.walls = [];   // the only kind line-of-sight rays care about
    // Everything else that can be shot, hashed once a tick, so a bullet's ray tests the few
    // deployables along it instead of all of them.
    this.grid = null;
    this.hittable = [];
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
      id: this.nextId++, isDeployable: true, ...spec, team: spec.team, owner,
      movement: { state: { position: pos, invulnerable: false, yaw: spec.yaw ?? 0, velocity: new Vector3() } },
      age: 0, armed: !ARM_TIME[spec.kind], aimYaw: spec.yaw ?? 0, target: null, cooldowns: new Map(), sincePulse: 0, sinceTickCue: 0,
    };
    // HP 1 for "shoot it" counterplay objects; real HP for walls, turrets, beacons and engines.
    const hp = spec.hp ?? ({ mine: 1, tripwire: 1, charge: 1, decoy: 1 }[spec.kind]);
    if (hp) d.health = new Health(d, { health: hp, armor: spec.kind === 'wall' || spec.kind === 'engine' ? 'barrier' : 'plate' });
    this.list.push(d);
    if (d.kind === 'wall') this.walls.push(d);
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
    if (this.list.some((d) => d.removed)) { this.list = this.list.filter((d) => !d.removed); this.walls = this.walls.filter((d) => !d.removed); }
    const H = this.hittable;
    H.length = 0;
    for (const d of this.list) if (d.health && d.kind !== 'wall') H.push(d);
    if (H.length > 12) {
      const t = this.world.terrain;
      this.grid ??= new EntityGrid({ cell: 16, bounds: t ? { minX: t.minX, minZ: t.minZ, width: t.width, depth: t.depth } : null });
      this.grid.rebuild(H);
    }
  }

  // ---------------------------------------------------------------- per-kind behaviour
  tick_turret(d, dt) {
    const p = _muzzle.copy(d.movement.state.position).setY(d.movement.state.position.y + (d.muzzle ?? 1.1));
    // Re-acquire the nearest visible enemy, preferring to keep the current one. With nobody in
    // sight it looks around a few times a second, not every tick.
    // A downed soldier is no threat: a turret leaves him (to be revived or finished by hand) for one on his feet.
    if (!d.target || d.target.health.dead || d.target.health.downed || !this.#visible(p, d.target, d.range)) {
      d.scanT = (d.scanT ?? SCAN) + dt;
      d.target = null;
      if (d.scanT >= SCAN) { d.scanT = 0; d.target = this.#nearestVisibleEnemy(d, p); }
    }
    if (!d.target) return;
    const tp = d.target.movement.state.position;
    const want = Math.atan2(-(tp.x - p.x), -(tp.z - p.z));
    let diff = ((want - d.aimYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    const maxTurn = ((d.turnRate ?? 90) * Math.PI / 180) * dt;
    d.aimYaw += Math.max(-maxTurn, Math.min(maxTurn, diff));
    diff = Math.abs(((want - d.aimYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    // Fire only when roughly on target (within 5°): strafing perpendicular beats a slow turret.
    // The rounds hit whoever is first along the line: a teammate who steps in front takes them.
    if (diff < 0.09) {
      _v.copy(tp); _v.y += 1.1; _v.sub(p);
      const len = _v.length() || 1;
      const ray = this.world.raycast?.(p, _v.divideScalar(len), len + 0.5, d.id, { ignoreCover: true });
      const victim = ray?.entity && !ray.entity.isVehicle ? ray.entity : d.target;
      const share = this.world.harm ? this.world.harm(d.team, victim, 'deployable') : victim.team === d.team ? 0 : 1;
      // Spread: with `falloff` set, fewer rounds find a far or running target (out at full range,
      // or at a sprint, a share `falloff` of them miss).
      let acc = 1;
      if (d.falloff) {
        const vv = victim.movement?.state.velocity, run = vv ? Math.min(1, Math.hypot(vv.x, vv.z) / 6) : 0;
        acc = 1 - d.falloff * Math.min(1, 0.6 * (len / d.range) + 0.4 * run);
      }
      const dmg = d.dps * dt * share * acc;
      if (dmg > 0) {
        victim.health.damage(dmg, { kind: 'deployable', ability: d.ability, ammoType: 'kinetic', friendly: victim.team === d.team }, d.owner);
        if (d.lifesteal && victim.team !== d.team) d.owner?.health.heal(dmg * d.lifesteal);
        if (d.status && victim.team !== d.team) victim.status?.apply(d.status.id, { stacks: (d.status.stacks ?? 1) * dt * 2, source: d.owner });
      }
      d.fireT = (d.fireT ?? 0) + dt;
      if (d.fireT >= 0.125) { d.fireT = 0; bus.emit('deployable:fire', { id: d.id, from: p.toArray(), to: (ray?.point ?? tp).toArray(), team: d.team }); }
    }
  }

  tick_mine(d, dt) {
    if (!d.armed) return;
    const p = d.movement.state.position;
    this.#proximityCue(d, dt, 6);
    let hit = false;
    this.#enemiesNear(d, p, d.trigger, () => { hit = true; });
    if (hit) this.#trigger(d, d.onTrigger, p);
  }

  tick_tripwire(d, dt) {
    if (!d.armed) return;
    // The wire runs `length` metres along the placement yaw. Anyone crossing within 0.35 m trips it.
    const a = d.movement.state.position;
    _f.set(-Math.sin(d.yaw), 0, -Math.cos(d.yaw));
    let tripped = null;
    _c.copy(a).addScaledVector(_f, d.length / 2);
    this.#enemiesNear(d, _c, d.length / 2 + 0.5, (e) => {
      if (tripped) return;
      _v.subVectors(e.movement.state.position, a).setY(0);
      const along = _v.dot(_f);
      if (along < 0 || along > d.length) return;
      if (_v.addScaledVector(_f, -along).length() < 0.35 && e.movement.state.stance !== 'prone') tripped = e;
    });
    if (!tripped) return;
    const e = tripped;
    if (d.onTrigger.status) e.status?.apply(d.onTrigger.status.id, { stacks: d.onTrigger.status.stacks ?? 1, source: d.owner });
    if (d.onTrigger.reveal) e.status?.apply('revealed', { duration: d.onTrigger.reveal, source: d.owner });
    bus.emit('deployable:triggered', { id: d.id, kind: d.kind, victim: e.id, point: e.movement.state.position.toArray() });
    this.destroy(d, 'triggered');
  }

  tick_beacon(d) {
    const a = d.aura, p = d.movement.state.position;
    this.world.fightersNear(p, a.radius, (e) => {
      if (e.team !== d.team || e.movement.state.position.distanceTo(p) > a.radius) return;
      if (a.status) e.status?.apply(a.status, { duration: 0.5, source: d.owner });
      if (a.reloadMul) e.weapons?.applyBuff({ reloadMul: a.reloadMul }, 0.5);
    });
  }

  tick_launchpad(d) {
    this.world.fightersNear(d.movement.state.position, 1.5, (e) => {
      if (e.isVehicle || e.vehicle || e.team !== d.team || d.cooldowns.has(e.id)) return;
      _v.subVectors(e.movement.state.position, d.movement.state.position);
      if (Math.hypot(_v.x, _v.z) < 1.2 && Math.abs(_v.y) < 0.6) {
        e.movement.impulse(0, d.launch, 0, { knockdown: false }); // a launch, not a blast
        d.cooldowns.set(e.id, 1);
        bus.emit('deployable:launch', { id: d.id, entity: e.id });
      }
    });
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
    let blocker = null;
    this.#enemiesNear(d, d.movement.state.position, 2, (e) => { blocker ??= e; });
    if (blocker) { bus.emit('deployable:vehicleDenied', { id: d.id, by: blocker.id, owner: d.ownerId }); this.destroy(d, 'denied'); return; }
    const at = this.#dropSpot(d);
    bus.emit('deployable:vehicleArrived', { id: d.id, vehicle: d.vehicle, at: at.toArray(), owner: d.ownerId, team: d.team });
    const v = this.world.vehicles?.spawn(d.vehicle, d.team, at, d.yaw ?? 0, { ownerId: d.ownerId });
    // Called vehicles drop at the caster's feet: hop straight in if the caster is still close and on foot.
    if (v && d.owner && !d.owner.vehicle && d.owner.movement.state.position.distanceTo(v.movement.state.position) < 4) this.world.vehicles.enter(d.owner, v);
    this.destroy(d, 'delivered');
  }

  /**
   * Where a called vehicle lands: on the marker, unless a teammate or another vehicle is standing
   * there (squads deploy together, and a bike dropped on someone's head reads as a bug). Then it
   * lands at the nearest spot around the marker that is clear of them and of anything too tall to
   * sit on. The caster doesn't count, because they hop straight in.
   */
  #dropSpot(d) {
    const p = d.movement.state.position, w = this.world;
    const r = (w.vehicles?.defs?.vehicles?.[d.vehicle]?.radius ?? 1.5) + 0.5;
    const clear = (x, z) => {
      let ok = true;
      w.fightersNear(_drop.set(x, p.y, z), r + 4, (e) => {
        if (!ok || e === d.owner || e.health?.dead) return;
        const q = e.movement.state.position, reach = r + (e.isVehicle ? e.def.radius : 0.4);
        if (Math.hypot(q.x - x, q.z - z) < reach) ok = false;
      });
      if (!ok) return false;
      const ground = w.groundHeight(_drop.set(x, p.y + 2, z)), k = r - 0.5;
      w.coverIn(x - k, z - k, x + k, z + k, (b) => { if (b.max.y > ground + 1.2 && b.min.y < ground + 2) ok = false; });
      return ok;
    };
    if (clear(p.x, p.z)) return p;
    // Rings around the marker, each tried from the caster's side outward, so the caster can still
    // hop in.
    const o = d.owner?.movement.state.position, a0 = o ? Math.atan2(o.z - p.z, o.x - p.x) : 0;
    for (let ring = 1; ring <= 3; ring++) {
      for (let k = 0; k < 8; k++) {
        const a = a0 + Math.ceil(k / 2) * (k % 2 ? 1 : -1) * (Math.PI / 4), x = p.x + Math.cos(a) * r * ring, z = p.z + Math.sin(a) * r * ring;
        if (clear(x, z)) return new Vector3(x, p.y, z);
      }
    }
    return p;
  }

  tick_engine(d, dt) {
    const pulse = d.pulse;
    d.sincePulse += dt;
    if (!d.charging && d.sincePulse >= pulse.interval - 1) { d.charging = true; bus.emit('deployable:charging', { id: d.id, in: 1, radius: pulse.radius }); }
    if (d.sincePulse >= pulse.interval) {
      d.sincePulse = 0; d.charging = false;
      const p = d.movement.state.position;
      this.#enemiesNear(d, p, pulse.radius, (e) => {
        e.health.damage(pulse.damage, { kind: 'deployable', ability: d.ability }, d.owner);
        if (pulse.status) e.status?.apply(pulse.status, { source: d.owner });
      });
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

  /**
   * Ray vs. deployable hit volumes, nearest hit. Walls are oriented boxes; everything else is a
   * sphere. `kind` limits the test to one kind (line of sight only cares about walls).
   */
  raycast(o, dir, max, team = null, kind = null) {
    let best = null;
    const test = (d) => {
      if (!d.health || d.health.dead || d.removed || (kind && d.kind !== kind)) return;
      const t = d.kind === 'wall' ? this.#rayWall(d, o, dir, best ? best.distance : max) : this.#raySphere(d, o, dir, best ? best.distance : max);
      if (t && (!best || t.distance < best.distance)) best = t;
    };
    if (kind === 'wall') { for (const d of this.walls) test(d); return best; }
    // Walls are few and wide; the rest (spheres under 0.6 m, at most 1.2 m up) come from the grid
    // when there are many: last tick's, so the pad also covers a decoy's run since.
    for (const d of this.walls) test(d);
    if (this.grid && this.hittable.length > 12) this.grid.queryRay(o, dir, max, 2, test);
    else for (const d of this.list) if (d.kind !== 'wall') test(d);
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
    const hit = [];
    // Statuses and reveals are smart (enemies only); a blast is not: friendly fire takes everyone in it.
    const r = t.radius ?? d.trigger;
    this.world.fightersNear(at, r, (e) => {
      if (e.health.dead || e.movement.state.invulnerable || e.movement.state.position.distanceTo(at) > r) return;
      if (e.team !== d.team || (t.damage && (this.world.harm?.(d.team, e, 'deployable') ?? 0) > 0)) hit.push(e);
    });
    for (const e of hit) {
      const enemy = e.team !== d.team;
      if (t.status && enemy) e.status?.apply(t.status.id, { stacks: t.status.stacks ?? 1, duration: t.status.duration, source: d.owner });
      if (t.reveal && enemy) e.status?.apply('revealed', { duration: t.reveal, source: d.owner });
      if (t.damage) {
        e.health.damage(t.damage * (enemy ? 1 : this.world.harm(d.team, e, 'deployable')), { kind: 'deployable', ability: d.ability, friendly: !enemy }, d.owner);
        // A mine or charge going off under you is a blast: you're thrown limp, away from it.
        const q = e.movement.state.position, dx = q.x - at.x, dz = q.z - at.z, l = Math.hypot(dx, dz) || 1;
        e.movement.impulse?.((dx / l) * 5, 3.5, (dz / l) * 5, { cause: 'explosion', at, ragdoll: true });
      }
    }
    bus.emit('deployable:triggered', { id: d.id, kind: d.kind, point: at.toArray(), radius: t.radius ?? d.trigger, team: d.team });
    this.destroy(d, 'triggered');
  }

  #proximityCue(d, dt, range, every = 0.75) {
    d.sinceTickCue += dt;
    if (d.sinceTickCue < every) return;
    d.sinceTickCue = 0;
    const near = [];
    this.#enemiesNear(d, d.movement.state.position, range, (e) => near.push(e.id));
    if (near.length) bus.emit('deployable:proximity', { id: d.id, kind: d.kind, listeners: near, at: d.movement.state.position.toArray() });
  }

  /** cb(e) for each live enemy of `d` within r of p (through the entity grid on big maps). */
  #enemiesNear(d, p, r, cb) {
    this.world.fightersNear(p, r, (e) => {
      if (e.health.dead || e.movement.state.invulnerable || !this.world.hostileTo(d.team, e)) return;   // (a turret never shoots a civilian minding his own business)
      if (e.movement.state.position.distanceTo(p) <= r) cb(e);
    });
  }

  /** Nearest first, so the sight rays stop at the first enemy in view. */
  #nearestVisibleEnemy(d, p) {
    const near = [];
    this.#enemiesNear(d, p, d.range + 1.5, (e) => { if (!e.status?.has('cloak') && !e.health?.downed) near.push(e); });
    near.sort((a, b) => a.movement.state.position.distanceToSquared(p) - b.movement.state.position.distanceToSquared(p));
    for (const e of near) if (this.#visible(p, e, d.range)) return e;
    return null;
  }

  #visible(p, e, range) {
    const tp = _f.copy(e.movement.state.position); tp.y += 1.1;
    const dir = tp.clone().sub(p); const len = dir.length();
    if (len > range) return false;
    return !(this.world.sight ?? this.world.raycastStatic)?.call(this.world, p, dir.divideScalar(len), len);
  }

  #raySphere(d, o, dir, max) {
    // A turret up on its pod (a stratagem's sentry, `muzzle` m up) is a bigger target, higher up.
    const r = d.kind === 'turret' && d.muzzle ? 0.85 : d.kind === 'turret' || d.kind === 'engine' || d.kind === 'beacon' ? 0.6 : 0.25;
    const c = _c.copy(d.movement.state.position); c.y += d.kind === 'turret' ? (d.muzzle ?? 1.6) - 0.6 : d.kind === 'engine' ? 1.2 : d.kind === 'decoy' ? 1.1 : 0.15;
    const oc = c.sub(o);
    const t = oc.dot(dir);
    if (t < 0 || t > max || oc.lengthSq() - t * t > r * r) return null;
    return { entity: d, distance: t, point: o.clone().addScaledVector(dir, t), zone: 'body' };
  }

  #rayWall(d, o, dir, max) {
    const p = d.movement.state.position;
    // Bounding sphere first: most rays pass nowhere near the wall.
    const cx = p.x - o.x, cy0 = p.y + d.height / 2 - o.y, cz = p.z - o.z, R = Math.hypot(d.width / 2, d.height / 2) + 0.3;
    const tc = cx * dir.x + cy0 * dir.y + cz * dir.z;
    if (tc < -R || tc > max + R || cx * cx + cy0 * cy0 + cz * cz - tc * tc > R * R) return null;
    // Transform the ray into wall-local space (x = width, y = up, z = thickness).
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
