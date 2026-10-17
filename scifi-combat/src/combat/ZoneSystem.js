// ZoneSystem: persistent areas spawned by abilities (healing wells, gravity anchors, domes,
// airstrikes, tethers, storms).
//
// Lifecycle:  ARMING (optional `delay`, telegraph only) → ACTIVE (ticks every `tick` s) → ENDED.
//
// Clarity contract (see docs/ABILITIES.md §4):
//  * Every zone is visible for its whole life, and its shape is exactly the area it affects.
//  * Delayed zones (airstrikes, orbital lance) emit `zone:arming` with the delay. The view draws a
//    fill that grows from the centre and reaches the edge exactly when the zone goes live, so the
//    countdown is readable without any UI.
//  * Every tick emits nothing (too noisy). Starts, ends, tether breaks and bursts emit events.
//
// Zone spec fields (all optional unless noted; from data/abilities/*.json):
//   radius*, lifetime*, tick, delay, attach ('self'), shape ('circle' | 'line', with length/width),
//   damage (per tick, or once when there is no tick), burst (one-off on activation),
//   allyHeal, allyStatus, enemyStatus, enemyStatus2, allyWeaponStatus, revive,
//   pull (m/s toward centre), core { radius, status }, pattern ('rotating_beams'),
//   blocksProjectiles ('enemy' | 'all'), blocksReveal, blocksVision,
//   targets ('aimedAlly' | 'aimedEnemy'): becomes a tether to one target.

import { Vector3 } from 'three';
import { bus } from '../core/EventBus.js';

export const ZonePhase = Object.freeze({ ARMING: 'arming', ACTIVE: 'active', ENDED: 'ended' });

const _d = new Vector3();
const _f = new Vector3();
let nextZoneId = 1;

export class ZoneSystem {
  constructor(world) {
    this.world = world;
    this.zones = [];
  }

  spawn(spec) {
    const owner = this.world.entity(spec.ownerId);
    const z = {
      id: nextZoneId++, ...spec,
      center: (spec.center ?? owner?.movement.state.position).clone(),
      yaw: spec.yaw ?? owner?.movement.state.yaw ?? 0,
      phase: spec.delay ? ZonePhase.ARMING : ZonePhase.ACTIVE,
      time: 0, sinceTick: 0, owner,
    };
    // Tethers lock onto one target at spawn: the nearest valid target within 15° of the aim.
    if (z.targets) {
      z.target = this.#pickTarget(z, owner);
      if (!z.target) { bus.emit('zone:fizzle', { id: z.id, ability: z.ability, owner: z.ownerId, reason: 'noTarget' }); return null; }
    }
    this.zones.push(z);
    bus.emit(z.phase === ZonePhase.ARMING ? 'zone:arming' : 'zone:start', this.#describe(z));
    if (z.phase === ZonePhase.ACTIVE) this.#activate(z);
    return z;
  }

  update(dt) {
    for (const z of this.zones) {
      z.time += dt;
      if (z.attach === 'self' && z.owner) {
        if (z.owner.health.dead) { this.#end(z, 'ownerDied'); continue; }
        z.center.copy(z.owner.movement.state.position);
      }
      if (z.phase === ZonePhase.ARMING) {
        if (z.time >= z.delay) { z.phase = ZonePhase.ACTIVE; z.time = 0; bus.emit('zone:start', this.#describe(z)); this.#activate(z); }
        continue;
      }
      if (z.target && !this.#tetherHolds(z)) { bus.emit('zone:tetherBreak', { id: z.id, ability: z.ability, owner: z.ownerId, target: z.target.id }); this.#end(z, 'tetherBroken'); continue; }

      // Pull is continuous, not per tick, so it feels like a current rather than a series of jerks.
      if (z.pull) this.#pull(z, dt);

      if (z.tick) {
        z.sinceTick += dt;
        while (z.sinceTick >= z.tick) { z.sinceTick -= z.tick; this.#applyTick(z); }
      }
      if (z.time >= z.lifetime) this.#end(z, 'expired');
    }
    this.zones = this.zones.filter((z) => z.phase !== ZonePhase.ENDED);
  }

  // ---------------------------------------------------------------- queries other systems use
  /** Called by CombatWorld.raycast: does a dome block this segment for this team? Returns distance or null. */
  blockDistance(o, d, max, team) {
    let best = null;
    for (const z of this.zones) {
      if (z.phase !== ZonePhase.ACTIVE || !z.blocksProjectiles) continue;
      if (z.blocksProjectiles === 'enemy' && z.team === team) continue;
      // Ray vs. sphere: block where the ray crosses the shell, in either direction.
      _d.subVectors(o, z.center);
      const b = _d.dot(d), c = _d.lengthSq() - z.radius * z.radius;
      const disc = b * b - c;
      if (disc < 0) continue;
      const s = Math.sqrt(disc);
      for (const t of [-b - s, -b + s]) if (t > 0.01 && t <= max && (best === null || t < best)) { best = t; break; }
    }
    return best;
  }
  blocksRevealAt(p) { return this.zones.some((z) => z.phase === ZonePhase.ACTIVE && z.blocksReveal && this.#inside(z, p)); }
  blocksVisionBetween(a, b) {
    for (const z of this.zones) {
      if (z.phase !== ZonePhase.ACTIVE || !z.blocksVision) continue;
      const ia = this.#inside(z, a), ib = this.#inside(z, b);
      if (ia !== ib) return true;               // one of us is in the cloud
      if (ia || z.shape === 'line') continue;   // both in it (close enough to see), or a wall-shaped field
      // Both outside: does the sight line pass through the cloud (below its top)?
      const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1e-9;
      const t = Math.max(0, Math.min(1, ((z.center.x - a.x) * dx + (z.center.z - a.z) * dz) / l2));
      const cx = a.x + dx * t - z.center.x, cz = a.z + dz * t - z.center.z;
      if (cx * cx + cz * cz < z.radius * z.radius && a.y + (b.y - a.y) * t < z.center.y + (z.smokeHeight ?? 6)) return true;
    }
    return false;
  }
  /** Threat vector for AI: points away from hostile zones the entity is standing in (zero if safe). */
  threatAt(p, team, out = new Vector3()) {
    out.set(0, 0, 0);
    for (const z of this.zones) {
      if (z.team === team || !(z.damage || z.pull || z.enemyStatus || z.burst)) continue;
      // Arming zones are threats too; that is the whole point of telegraphing them.
      if (this.#inside(z, p, 1)) { _d.subVectors(p, z.center).setY(0); out.add(_d.lengthSq() > 1e-4 ? _d.normalize() : _d.set(1, 0, 0)); }
    }
    return out;
  }

  // ---------------------------------------------------------------- internals
  #activate(z) {
    if (z.burst) for (const e of this.#enemiesIn(z)) e.health.damage(z.burst, { kind: 'ability', ability: z.ability }, z.owner);
    // No tick means everything applies once, on activation (strafing runs, instant fields).
    if (!z.tick) this.#applyTick(z);
  }

  #applyTick(z) {
    const src = z.owner;
    if (z.target) {
      if (z.damage && z.target.team !== z.team) z.target.health.damage(z.damage, { kind: 'ability', ability: z.ability }, src);
      if (z.allyHeal) {
        // Repair tether heals its target; Siphon heals whichever ally is closest to the caster.
        const healTarget = z.target.team === z.team ? z.target : this.#closestAlly(z);
        healTarget?.health.heal(z.allyHeal);
      }
      return;
    }
    const enemies = this.#enemiesIn(z).filter((e) => this.#patternHits(z, e));
    const allies = this.#alliesIn(z);
    for (const e of enemies) {
      if (z.damage) e.health.damage(z.damage, { kind: 'ability', ability: z.ability }, src);
      if (z.enemyStatus) e.status?.apply(z.enemyStatus.id, { stacks: z.enemyStatus.stacks ?? 1, duration: z.enemyStatus.duration, source: src });
      if (z.enemyStatus2) e.status?.apply(z.enemyStatus2.id, { stacks: z.enemyStatus2.stacks ?? 1, source: src });
      if (z.core && e.movement.state.position.distanceTo(z.center) <= z.core.radius) {
        e.status?.apply(z.core.status.id, { duration: z.core.status.duration, source: src });
      }
    }
    // Friendly fire: a purely harmful field (fire, arcs, a strafing run; nothing in it helps
    // allies) burns teammates standing in it too, the caster included.
    const share = z.damage && !z.allyHeal && !z.allyStatus && !z.allyWeaponStatus && !z.revive ? this.world.harm?.(z.team, allies[0] ?? null, 'zone') ?? 0 : 0;
    for (const a of allies) {
      if (z.allyHeal) a.health.heal(z.allyHeal);
      if (z.allyStatus) a.status?.apply(z.allyStatus.id, { duration: z.allyStatus.duration, source: src });
      if (z.allyWeaponStatus) a.weapons?.applyBuff({ onHitStatus: z.allyWeaponStatus }, (z.tick ?? 0.5) + 0.1);
      if (z.revive && a.health.dead) a.health.revive(0.5);
      if (share > 0 && !a.health.dead && !a.movement.state.invulnerable && this.#patternHits(z, a)) {
        a.health.damage(z.damage * (a === src ? Math.min(share, this.world.ff?.self ?? share) : share), { kind: 'ability', ability: z.ability, friendly: true }, src);
      }
    }
    if (z.damage) this.world.damageDeployables?.(z.center, z.radius, z.damage, src, null, z.team);
  }

  #pull(z, dt) {
    for (const e of this.#enemiesIn(z)) {
      if (!e.movement.body) continue; // vehicles and riders are carried by their own physics
      _d.subVectors(z.center, e.movement.state.position).setY(0);
      const dist = _d.length();
      if (dist < 0.3) continue;
      // Displace directly, not through velocity, so ground acceleration can't fight it.
      // Players can still out-run a pull weaker than their run speed, as the counterplay says.
      _d.multiplyScalar(Math.min(dist, z.pull * dt) / dist);
      const res = e.movement.body.move(_d);
      e.movement.state.position.add(res.delta);
    }
  }

  #patternHits(z, e) {
    if (z.pattern !== 'rotating_beams') return true;
    // 6 spokes rotating at 60°/s. You are hit only when a spoke passes over you, so a player can
    // read the gaps and step between them.
    _d.subVectors(e.movement.state.position, z.center);
    const angle = Math.atan2(_d.z, _d.x) - z.time * (Math.PI / 3);
    const spoke = Math.PI / 3;
    const off = ((angle % spoke) + spoke) % spoke;
    return Math.min(off, spoke - off) < 0.14; // about 8°
  }

  #inside(z, p, pad = 0) {
    if (z.shape === 'line') {
      _f.set(-Math.sin(z.yaw), 0, -Math.cos(z.yaw));
      _d.subVectors(p, z.center).setY(0);
      const along = _d.dot(_f);
      return Math.abs(along) <= z.length / 2 + pad && _d.addScaledVector(_f, -along).length() <= z.width / 2 + pad;
    }
    _d.subVectors(p, z.center).setY(0);
    return _d.length() <= z.radius + pad;
  }

  #enemiesIn(z) { return this.world.fighters().filter((e) => e.team !== z.team && !e.health.dead && !e.movement.state.invulnerable && this.#inside(z, e.movement.state.position)); }
  #alliesIn(z) { return this.world.fighters().filter((e) => e.team === z.team && this.#inside(z, e.movement.state.position)); }

  #closestAlly(z) {
    let best = null, bd = Infinity;
    for (const e of this.world.fighters()) {
      if (e.team !== z.team || e.health.dead) continue;
      const d = e.movement.state.position.distanceTo(z.owner.movement.state.position);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  #pickTarget(z, owner) {
    if (!owner) return null;
    const wantAlly = z.targets === 'aimedAlly';
    const o = owner.movement.state.position;
    _f.set(-Math.sin(owner.movement.state.yaw), 0, -Math.cos(owner.movement.state.yaw));
    let best = null, bestDot = Math.cos((15 * Math.PI) / 180);
    const candidates = [...this.world.fighters(), ...(wantAlly ? this.world.deployables?.list ?? [] : [])];
    for (const e of candidates) {
      if (e === owner || e.health?.dead || (e.team === owner.team) !== wantAlly) continue;
      _d.subVectors(e.movement.state.position, o).setY(0);
      const dist = _d.length();
      if (dist > z.radius || dist < 0.1) continue;
      const dot = _d.divideScalar(dist).dot(_f);
      if (dot > bestDot) { bestDot = dot; best = e; }
    }
    return best;
  }

  #tetherHolds(z) {
    const a = z.owner?.movement.state.position, b = z.target.movement.state.position;
    if (!a || z.target.health?.dead || a.distanceTo(b) > z.radius) return false;
    // Line of sight, measured chest to chest. Cover breaks tethers (the stated counterplay).
    const from = a.clone().setY(a.y + 1.2);
    const to = b.clone().setY(b.y + 1.2);
    const dir = to.clone().sub(from); const len = dir.length(); dir.divideScalar(len);
    const hit = this.world.raycastStatic?.(from, dir, len);
    return !hit;
  }

  #end(z, reason) {
    if (z.phase === ZonePhase.ENDED) return;
    z.phase = ZonePhase.ENDED;
    bus.emit('zone:end', { id: z.id, ability: z.ability, owner: z.ownerId, reason });
  }

  #describe(z) {
    return {
      id: z.id, ability: z.ability, owner: z.ownerId, team: z.team, center: z.center.toArray(), radius: z.radius,
      shape: z.shape ?? 'circle', length: z.length, width: z.width, yaw: z.yaw, delay: z.delay ?? 0, lifetime: z.lifetime,
      attach: z.attach, pattern: z.pattern, dome: !!z.blocksProjectiles, tether: z.target?.id, hostile: !!(z.damage || z.pull || z.enemyStatus || z.burst),
      smoke: !!z.blocksVision,
    };
  }
}
