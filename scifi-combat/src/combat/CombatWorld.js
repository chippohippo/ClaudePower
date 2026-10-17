// CombatWorld: the single query/spawn surface every combat system talks to.
//
// It owns fighters, static cover (some destructible), and the Projectile, Zone and Deployable
// systems. It implements the `world` interface that WeaponSystem, AbilitySystem, StatusSystem,
// ZoneSystem and DeployableSystem expect, so they never reference each other directly.
// Runs headless (server, tests) as well as in the browser.

import { Vector3, Ray, Box3 } from 'three';
import { bus } from '../core/EventBus.js';
import { ProjectileSystem } from './weapons/WeaponSystem.js';
import { ZoneSystem } from './ZoneSystem.js';
import { DeployableSystem } from './DeployableSystem.js';
import { VehicleSystem } from '../vehicles/VehicleSystem.js';
import { hitSpheres } from '../movement/Hitboxes.js';

const _oc = new Vector3();
const _pt = new Vector3();
const _ray = new Ray();
const _box = new Box3();

export class CombatWorld {
  /**
   * @param {object} opts { damageMatrix, cover: [{ min: Vector3, max: Vector3, destructible?, surface? }] }
   *        `cover` is shared by reference with the movement bodies, so destroyed cover stops colliding too.
   */
  /**
   * Also takes `supers` (data/supers.json), `meleeWeapons` (melee.json weapons) and `recoilDefs`
   * (recoil.json patterns). Transform supers need them to build temporary weapons and movesets.
   */
  constructor({ damageMatrix = {}, cover = [], supers = null, meleeWeapons = [], recoilDefs = {}, vehicleDefs = null, statusDefs = null } = {}) {
    this.damageMatrix = damageMatrix;
    this.statusDefs = statusDefs;
    this.supers = supers; this.meleeWeapons = meleeWeapons; this.recoilDefs = recoilDefs;
    this.cover = cover;
    this.entities = [];
    this.projectiles = new ProjectileSystem(this);
    this.zones = new ZoneSystem(this);
    this.deployables = new DeployableSystem(this);
    this.vehicles = new VehicleSystem(this, vehicleDefs ?? { vehicles: {}, weapons: {} });
  }

  add(e) { this.entities.push(e); return e; }
  entity(id) { return this.entities.find((e) => e.id === id) ?? this.deployables.list.find((d) => d.id === id) ?? this.vehicles.list.find((v) => v.id === id); }

  /**
   * Everything that can be targeted by area effects, turrets and zones: on-foot fighters, riders
   * in exposed seats (bikes) and vehicles. Occupants of enclosed seats are protected by the hull.
   */
  fighters() {
    const out = this.entities.filter((e) => !e.vehicle || e.vehicle.exposed);
    for (const v of this.vehicles.list) if (!v.removed) out.push(v);
    return out;
  }

  update(dt) {
    this.vehicles.update(dt);
    this.projectiles.update(dt);
    this.zones.update(dt);
    this.deployables.update(dt);
  }

  // ---------------------------------------------------------------- spawning
  spawnProjectile(spec) { return this.projectiles.spawn(spec); }
  spawnZone(spec) { return this.zones.spawn(spec); }
  spawnDeployable(spec) { return this.deployables.spawn(spec); }

  // ---------------------------------------------------------------- spatial queries
  entitiesInRadius(p, r) { return this.fighters().filter((e) => !e.health.dead && e.movement.state.position.distanceTo(p) <= r); }

  entitiesInShape(s, o, d) {
    const f = d.clone().setY(0).normalize();
    return this.fighters().filter((e) => {
      if (e.health.dead) return false;
      const v = e.movement.state.position.clone().sub(o).setY(0);
      const t = v.dot(f);
      if (s.kind === 'cone') return t > 0 && v.length() < s.length && v.normalize().dot(f) > Math.cos((s.angle * Math.PI) / 360);
      return t > 0 && t < s.length && v.addScaledVector(f, -t).length() < (s.width ?? 2) / 2 + 0.4;
    });
  }

  /**
   * Full combat raycast: fighters, deployables, cover, ground and projectile-blocking domes.
   * `opts.team` defaults to the ignored entity's team (who is shooting), which domes need.
   */
  raycast(o, d, max, ignoreId, opts = {}) {
    let best = null;
    const consider = (h) => { if (h && h.distance <= max && (!best || h.distance < best.distance)) best = h; };

    for (const e of this.entities) {
      // Skip the shooter, the dead, protected occupants, and riders of the shooting vehicle itself.
      if (e.id === ignoreId || e.health.dead || (e.vehicle && (!e.vehicle.exposed || e.vehicle.veh.id === ignoreId))) continue;
      // Stance-aware spheres: prone, sliding and diving soldiers really are harder to hit.
      for (const h of hitSpheres(e)) {
        _oc.set(h.x - o.x, h.y - o.y, h.z - o.z);
        const t = _oc.dot(d);
        if (t >= 0 && t <= max && _oc.lengthSq() - t * t < h.r * h.r) consider({ entity: e, distance: t, point: o.clone().addScaledVector(d, t), zone: h.zone });
      }
    }
    const veh = this.vehicles.raycast(o, d, max, ignoreId);
    if (veh) consider(veh);
    // Piercing shots (Judgment) only test characters and vehicles: cover, walls, domes and ground are ignored.
    if (opts.ignoreCover) return best;
    const dep = this.deployables.raycast(o, d, max);
    if (dep && dep.entity.id !== ignoreId) consider(dep);
    consider(this.raycastStatic(o, d, max, { includeWalls: false }));
    if (d.y < 0 && o.y > 0) { const t = -o.y / d.y; consider({ entity: null, distance: t, point: o.clone().addScaledVector(d, t), normal: new Vector3(0, 1, 0), surface: 'concrete' }); }

    const team = opts.team ?? this.entity(ignoreId)?.team;
    const domeT = this.zones.blockDistance(o, d, max, team);
    if (domeT !== null) consider({ entity: null, distance: domeT, point: o.clone().addScaledVector(d, domeT), surface: 'dome', blocked: true });
    if (best?.blocked) bus.emit('zone:blocked', { point: best.point.toArray() });
    return best;
  }

  /** Line-of-sight test: cover plus deployable walls. Ignores characters. */
  raycastStatic(o, d, max, { includeWalls = true } = {}) {
    let best = null;
    _ray.set(o, d);
    for (const b of this.cover) {
      _box.set(b.min, b.max);
      if (_ray.intersectBox(_box, _pt)) {
        const t = _pt.distanceTo(o);
        if (t <= max && (!best || t < best.distance)) best = { entity: null, distance: t, point: _pt.clone(), normal: new Vector3(0, 1, 0), surface: b.surface ?? 'metal', cover: b };
      }
    }
    if (includeWalls) {
      const w = this.deployables.raycast(o, d, max);
      if (w?.entity.kind === 'wall' && (!best || w.distance < best.distance)) best = w;
    }
    return best;
  }

  groundHeight(p) {
    let h = 0;
    for (const b of this.cover) if (p.x >= b.min.x && p.x <= b.max.x && p.z >= b.min.z && p.z <= b.max.z && b.max.y <= p.y + 1.5) h = Math.max(h, b.max.y);
    return h;
  }

  // ---------------------------------------------------------------- damage helpers
  /** Splash damage with linear falloff to 30% at the edge. Owners take 50% self damage. */
  explode(point, radius, weapon, projectile) {
    const base = weapon.damage?.base ?? 0;
    if (!base) return;
    const owner = this.entity(projectile?.ownerId);
    for (const e of this.entitiesInRadius(point, radius)) {
      const isOwner = e.id === projectile?.ownerId;
      if (isOwner && e.isVehicle) continue; // a tank is never hurt by its own shell's splash
      if (!isOwner && e.team === projectile?.team) continue;
      const dist = e.movement.state.position.distanceTo(point);
      const fall = 1 - 0.7 * Math.min(1, dist / radius);
      const armor = e.health.armorFor?.('body') ?? 'flesh';
      const mul = this.damageMatrix[weapon.ammoType]?.[armor] ?? 1;
      e.health.damage(base * fall * mul * (isOwner ? 0.5 : 1) * (projectile?.spec?.damageMul ?? 1), { kind: 'explosion', weapon: weapon.id, ammoType: weapon.ammoType }, owner);
      // HD2: explosions throw people. Close blasts knock you down; prone soldiers resist (MovementController).
      if (!e.isVehicle && !e.health.dead) {
        const away = _oc.subVectors(e.movement.state.position, point).setY(0);
        const len = away.length() || 1;
        const k = (weapon.knockback ?? 10) * (1 - Math.min(1, dist / radius));
        e.movement.impulse?.((away.x / len) * k, k * 0.45, (away.z / len) * k, { cause: 'explosion' });
      }
    }
    this.damageDeployables(point, radius, base, owner, weapon.ammoType, projectile?.team);
  }

  damageDeployables(center, radius, amount, by, ammoType = 'explosive', team = by?.team) {
    for (const d of this.deployables.inRadius(center, radius)) {
      if (d.team === team) continue;
      d.health.damage(amount * (this.damageMatrix[ammoType]?.barrier ?? 1), { kind: 'splash' }, by);
    }
  }

  /** Breach/Rift charges remove destructible cover overlapping the blast. */
  destroyCover(center, radius, by) {
    for (let i = this.cover.length - 1; i >= 0; i--) {
      const b = this.cover[i];
      if (!b.destructible) continue;
      _box.set(b.min, b.max);
      if (_box.distanceToPoint(center) <= radius) {
        this.cover.splice(i, 1);
        bus.emit('world:coverDestroyed', { cover: b, by: by?.id, center: center.toArray() });
      }
    }
  }
}
