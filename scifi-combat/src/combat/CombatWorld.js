// CombatWorld: the single query/spawn surface every combat system talks to.
//
// It owns fighters, static cover (some destructible), and the Projectile, Zone and Deployable
// systems. It implements the `world` interface that WeaponSystem, AbilitySystem, StatusSystem,
// ZoneSystem and DeployableSystem expect, so they never reference each other directly.
// Runs headless (server, tests) as well as in the browser.
//
// Scale (64-128 fighters, ~1 km maps): pass `cover` as a CoverIndex and a `terrain`, and the
// world switches its queries to spatial structures: cover rays walk grid cells, fighters are
// hashed into an EntityGrid once per tick, fighters() is cached, and the ground is the terrain.
// With a plain cover array and no terrain, everything behaves exactly as on small test maps.

import { Vector3, Box3 } from 'three';
import { bus } from '../core/EventBus.js';
import { ProjectileSystem } from './weapons/WeaponSystem.js';
import { ZoneSystem } from './ZoneSystem.js';
import { DeployableSystem } from './DeployableSystem.js';
import { VehicleSystem } from '../vehicles/VehicleSystem.js';
import { ReviveSystem } from './ReviveSystem.js';
import { StratagemSystem } from './Stratagems.js';
import { PassiveSystem } from './Passives.js';
import { SupportItems } from './SupportItems.js';
import { hitSpheres, silhouetteScale, BOUND } from '../movement/Hitboxes.js';
import { EntityGrid } from '../world/EntityGrid.js';
import { rayBox } from '../world/CoverIndex.js';
import { CIVILIAN, civilianFights, civilianEngaging } from './Teams.js';

/** Friendly fire by default (data/rules.json can change any share): everything hurts everyone. */
const FRIENDLY_FIRE = { gun: 1, beam: 1, projectile: 1, explosion: 1, status: 1, melee: 1, ram: 1, deployable: 1, zone: 1, self: 0.5 };

const _oc = new Vector3();
const _pt = new Vector3();
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
  constructor({ damageMatrix = {}, cover = [], supers = null, meleeWeapons = [], recoilDefs = {}, vehicleDefs = null, statusDefs = null, terrain = null, nav = null, spatial = !!cover?.queryAABB, down = null, rules = null, stratagems = null, passives = null, support = null } = {}) {
    this.damageMatrix = damageMatrix;
    this.time = 0;                // seconds of sim (grudges and engagements are timed on it)
    // Friendly fire (data/rules.json): on everywhere unless the rules say otherwise.
    this.ff = { ...FRIENDLY_FIRE, ...(rules?.friendlyFire ?? {}) };
    this.terrain = terrain;
    this.nav = nav;
    this.spatial = spatial;
    this.grid = new EntityGrid({ cell: 12, bounds: terrain ? { minX: terrain.minX, minZ: terrain.minZ, width: terrain.width, depth: terrain.depth } : null });
    this.version = 0;             // bumped when fighter membership changes (adds, vehicles, seats)
    this._fighters = null; this._fightersVersion = -1;
    this.statusDefs = statusDefs;
    this.supers = supers; this.meleeWeapons = meleeWeapons; this.recoilDefs = recoilDefs;
    this.cover = cover;
    this.entities = [];
    this.projectiles = new ProjectileSystem(this);
    this.zones = new ZoneSystem(this);
    this.deployables = new DeployableSystem(this);
    this.vehicles = new VehicleSystem(this, vehicleDefs ?? { vehicles: {}, weapons: {} });
    this.revives = new ReviveSystem(this, down?.enabled ? down : null);
    this.stratagems = new StratagemSystem(this, stratagems);   // call-ins (data/stratagems.json)
    this.passives = new PassiveSystem(this, passives);         // class passives (data/passives.json)
    this.support = new SupportItems(this, support);            // stims, ammo packs, repairs (data/support.json)
  }

  add(e) { this.entities.push(e); this.version++; return e; }
  remove(e) { const i = this.entities.indexOf(e); if (i >= 0) { this.entities.splice(i, 1); this.version++; } }
  entity(id) { return this.entities.find((e) => e.id === id) ?? this.deployables.list.find((d) => d.id === id) ?? this.vehicles.list.find((v) => v.id === id); }

  /**
   * Everything that can be targeted by area effects, turrets and zones: on-foot fighters, riders
   * in exposed seats (bikes) and vehicles. Occupants of enclosed seats are protected by the hull.
   */
  fighters() {
    // Cached until membership changes (spawns, deaths don't matter: callers check health).
    if (this._fighters && this._fightersVersion === this.version) return this._fighters;
    const out = this.entities.filter((e) => !e.vehicle || e.vehicle.exposed);
    for (const v of this.vehicles.list) if (!v.removed) out.push(v);
    this._fighters = out; this._fightersVersion = this.version;
    return out;
  }

  /** Re-hash fighters into the entity grid (once per tick on big maps; queries pad by 1 m for staleness). */
  refreshSpatial() { if (this.spatial) this.grid.rebuild(this.fighters()); }

  /** cb(box) for cover overlapping an XZ rectangle (grid lookup on big maps). */
  coverIn(minX, minZ, maxX, maxZ, cb) {
    if (this.cover.queryAABB) return this.cover.queryAABB(minX, minZ, maxX, maxZ, cb);
    for (const b of this.cover) if (b.max.x >= minX && b.min.x <= maxX && b.max.z >= minZ && b.min.z <= maxZ) cb(b);
  }

  /** Fighters within r of p (alive or not; callers filter). */
  fightersNear(p, r, cb) {
    if (!this.spatial) { for (const e of this.fighters()) cb(e); return; }
    this.grid.queryCircle(p.x, p.z, r + 1, cb);
  }

  update(dt) {
    this.time += dt;
    this.refreshSpatial();
    this.vehicles.update(dt);
    this.projectiles.update(dt);
    this.zones.update(dt);
    this.deployables.update(dt);
    this.stratagems.update(dt);
    this.support.update(dt);
    this.passives.update(dt);
  }

  // ---------------------------------------------------------------- spawning
  spawnProjectile(spec) { return this.projectiles.spawn(spec); }
  spawnZone(spec) { return this.zones.spawn(spec); }
  spawnDeployable(spec) { return this.deployables.spawn(spec); }

  /**
   * Friendly fire: the share of a hit by `team` of kind `kind` (gun, beam, projectile, explosion,
   * status, melee, ram, deployable, zone) that lands on `victim`. Enemies (and the teamless) take
   * all of it; teammates the rules' share (data/rules.json, 1 by default: Helldivers rules).
   */
  harm(team, victim, kind) {
    if (team == null || team < 0 || victim?.team !== team) return 1;
    return this.ff[kind] ?? 1;
  }

  /**
   * Is a fight on between a and b: would a shoot at b? (Teams.js: the armies and the bandits
   * always; a civilian only armed, close or wronged, and only while he's shooting does anyone
   * shoot back.) Targeting asks this; damage doesn't (stray rounds hurt everyone).
   */
  hostile(a, b) {
    if (!a || !b || a === b || a.team === b.team || a.team == null || b.team == null) return false;
    if (a.team === CIVILIAN) return civilianFights(this, a, b);
    if (b.team === CIVILIAN) return civilianEngaging(this, b, a.team);
    return true;
  }

  /** The same for a side (a gun crew, a turret, a team's call-ins): would `team` shoot at e? */
  hostileTo(team, e) {
    if (!e || team == null || e.team === team || e.team == null) return false;
    if (e.team === CIVILIAN) return civilianEngaging(this, e, team);
    return team !== CIVILIAN;
  }

  // ---------------------------------------------------------------- spatial queries
  /** Surface under a point, for footstep and impact sounds: cover tops report their material. */
  surfaceAt(x, y, z) {
    let found = null;
    this.coverIn(x - 0.05, z - 0.05, x + 0.05, z + 0.05, (b) => { if (!found && Math.abs(y - b.max.y) < 0.12) found = b.surface ?? 'metal'; });
    return found ?? this.terrain?.surface ?? this.groundSurface ?? 'dirt';
  }

  entitiesInRadius(p, r) {
    const out = [];
    this.fightersNear(p, r + (this.spatial ? 6 : 0), (e) => { if (!e.health.dead && e.movement.state.position.distanceTo(p) <= r) out.push(e); });
    return out;
  }

  entitiesInShape(s, o, d) {
    const f = d.clone().setY(0).normalize();
    const reach = (s.length ?? 10) + (s.width ?? 2);
    const pool = [];
    this.fightersNear(o, reach + (this.spatial ? 6 : 0), (e) => pool.push(e));
    return pool.filter((e) => {
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
    const reach = () => (best ? best.distance : max);

    // What doesn't move goes first (cover, ground, domes): most shots on a battlefield end in the
    // dirt or a sandbag a few metres out, and then only that much of the ray is searched for
    // fighters. Piercing shots (Judgment) only test characters and vehicles.
    if (!opts.ignoreCover) {
      consider(this.raycastStatic(o, d, max, { includeWalls: false }));
      consider(this.raycastGround(o, d, reach()));
      const team = opts.team ?? this.entity(ignoreId)?.team;
      const domeT = this.zones.blockDistance(o, d, reach(), team);
      if (domeT !== null) consider({ entity: null, distance: domeT, point: o.clone().addScaledVector(d, domeT), surface: 'dome', blocked: true });
    }
    const testFighter = (e) => {
      // Hulls the grid finds along the ray are tested here (the grid holds vehicles too).
      if (e.isVehicle) { if (this.spatial) consider(this.vehicles.rayOne(e, o, d, reach(), ignoreId)); return; }
      // Skip the shooter, the dead, protected occupants and riders of the shooting vehicle itself.
      if (e.isDeployable || e.id === ignoreId || e.health.dead || (e.vehicle && (!e.vehicle.exposed || e.vehicle.veh.id === ignoreId))) return;
      // A bounding sphere first (most soldiers along a ray's corridor are metres off it), then the
      // stance-aware spheres: prone, sliding and diving soldiers really are harder to hit.
      const s = e.movement.state, p = s.position;
      if (s.mode !== 'ragdoll') {
        const sc = silhouetteScale(e), R = BOUND[1] * sc;
        _oc.set(p.x - o.x, p.y + BOUND[0] * sc - o.y, p.z - o.z);
        const t = _oc.dot(d);
        if (t < -R || t > reach() + R || _oc.lengthSq() - t * t > R * R) return;
      }
      const hs = hitSpheres(e);
      for (let i = 0; i < hs.length; i++) {
        const h = hs[i];
        _oc.set(h.x - o.x, h.y - o.y, h.z - o.z);
        const t = _oc.dot(d);
        // part: which sphere (head, chest, lower torso, legs): where the wound is (HitReactions)
        if (t >= 0 && t <= reach() && _oc.lengthSq() - t * t < h.r * h.r) consider({ entity: e, distance: t, point: o.clone().addScaledVector(d, t), zone: h.zone, part: i });
      }
    };
    // The pad covers a soldier's spheres and moves since the grid was built, and a hull's size
    // (the grid holds vehicles by their centre).
    if (this.spatial) this.grid.queryRay(o, d, reach(), 6, testFighter);
    else {
      for (const e of this.entities) testFighter(e);
      const veh = this.vehicles.raycast(o, d, reach(), ignoreId);
      if (veh) consider(veh);
    }
    if (!opts.ignoreCover) {
      const dep = this.deployables.raycast(o, d, reach());
      if (dep && dep.entity.id !== ignoreId) consider(dep);
    }
    if (best?.blocked) bus.emit('zone:blocked', { point: best.point.toArray() });
    return best;
  }

  /** Line-of-sight test: cover plus deployable walls. Ignores characters. `filter(box)` false skips a box. */
  raycastStatic(o, d, max, { includeWalls = true, filter = null } = {}) {
    let best = null;
    if (this.cover.raycast) {
      best = this.cover.raycast(o, d, max, filter);
      if (includeWalls) {
        // Walls only: a turret's ray starts inside its own sphere, which would otherwise be the
        // nearest hit and mask a wall behind it.
        const w = this.deployables.raycast(o, d, max, null, 'wall');
        if (w && (!best || w.distance < best.distance)) best = w;
      }
      return best;
    }
    // Same slab test as CoverIndex: a ray that starts inside cover is blocked at once.
    for (const b of this.cover) {
      if (filter && !filter(b)) continue;
      const h = rayBox(o, d, b, best ? best.distance : max);
      if (!h) continue;
      const normal = new Vector3(); normal.setComponent(h.axis, h.sign);
      best = { entity: null, distance: h.t, point: o.clone().addScaledVector(d, h.t), normal, surface: b.surface ?? 'metal', cover: b };
    }
    if (includeWalls) {
      const w = this.deployables.raycast(o, d, max, null, 'wall');
      if (w && (!best || w.distance < best.distance)) best = w;
    }
    return best;
  }

  /**
   * Line of sight: cover, deployable walls and the ground. A ridge hides a soldier as well as a
   * wall does (and stops rounds the same way), so this is what seeing and aiming ask.
   */
  sight(o, d, max) {
    const a = this.raycastStatic(o, d, max);
    const b = this.terrain ? this.terrain.raycast(o, d, a ? a.distance : max) : null;
    return b && (!a || b.distance < a.distance) ? b : a;
  }

  /** The ground itself: terrain heightfield on big maps, the y = 0 plane otherwise. */
  raycastGround(o, d, max) {
    if (this.terrain) return this.terrain.raycast(o, d, max);
    if (d.y < 0 && o.y > 0) { const t = -o.y / d.y; if (t <= max) return { entity: null, distance: t, point: o.clone().addScaledVector(d, t), normal: new Vector3(0, 1, 0), surface: 'concrete' }; }
    return null;
  }

  /** Highest walkable surface under p: terrain (or 0) and cover tops within reach. */
  groundHeight(p) {
    const h = this.terrain ? this.terrain.height(p.x, p.z) : 0;
    if (this.cover.topAt) return Math.max(h, this.cover.topAt(p.x, p.z, p.y + 1.5));
    let top = h;
    for (const b of this.cover) if (p.x >= b.min.x && p.x <= b.max.x && p.z >= b.min.z && p.z <= b.max.z && b.max.y <= p.y + 1.5) top = Math.max(top, b.max.y);
    return top;
  }

  // ---------------------------------------------------------------- damage helpers
  /** Splash damage with linear falloff to 30% at the edge. Owners take 50% self damage. */
  explode(point, radius, weapon, projectile) {
    const base = weapon.damage?.base ?? 0;
    if (!base) return;
    const owner = this.entity(projectile?.ownerId);
    const thrown = new Set();
    for (const e of this.entitiesInRadius(point, radius)) {
      const isOwner = e.id === projectile?.ownerId;
      if (isOwner && e.isVehicle) continue; // a tank is never hurt by its own shell's splash
      const share = isOwner ? this.ff.self * (e.perks?.selfBlast ?? 1) : this.harm(projectile?.team, e, 'explosion');   // blasts hurt everyone (friendly fire); Blast-Proof halves your own
      if (!share) continue;
      const dist = e.movement.state.position.distanceTo(point);
      const fall = 1 - 0.7 * Math.min(1, dist / radius);
      const armor = e.health.armorFor?.('body') ?? 'flesh';
      const mul = this.damageMatrix[weapon.ammoType]?.[armor] ?? 1;
      const dealt = base * fall * mul * share * (projectile?.spec?.damageMul ?? 1);
      e.health.damage(dealt, { kind: 'explosion', weapon: weapon.id, ammoType: weapon.ammoType, friendly: !isOwner && e.team === projectile?.team, from: [point.x, point.y, point.z] }, owner);
      e.weapons?.flinch?.(dealt, point);
      if (!e.isVehicle) { this.#blast(e, point, radius, dist, weapon); thrown.add(e); }
    }
    // Bodies already on the ground get thrown too.
    this.fightersNear(point, radius + (this.spatial ? 6 : 0), (e) => {
      if (thrown.has(e) || !e.health.dead || e.isVehicle || e.movement.state.mode !== 'ragdoll') return;
      const dist = e.movement.state.position.distanceTo(point);
      if (dist <= radius) this.#blast(e, point, radius, dist, weapon);
    });
    this.damageDeployables(point, radius, base, owner, weapon.ammoType, projectile?.team);
    // Cars are thrown about by any blast, whoever's it is: rocked, lifted, rolled over (or back).
    for (const v of this.vehicles.list) if (v.car && !v.removed && v.id !== projectile?.ownerId && v.movement.state.position.distanceTo(point) < radius + 3) v.car.blast(point, radius, weapon.knockback);
    // Shells cut barbed wire: the gap opens for everyone (and for the bots' routes).
    this.cutWire(point, radius * 0.6);
  }

  /** Cut the barbed wire within r of a point (shells, tank tracks): routes open through the gap. */
  cutWire(point, r) {
    const cut = this.wire?.cut(point, r);
    if (!cut?.length) return 0;
    for (const w of cut) this.nav?.removeZones(w.min.x, w.min.z, w.max.x, w.max.z);
    bus.emit('world:wireCut', { belts: cut.map((w) => w.id), center: [point.x, point.y ?? 0, point.z] });
    return cut.length;
  }

  /** Remove one piece of destructible cover (crushed under a tank's tracks). */
  removeCover(b, by = null) {
    if (this.cover.remove) this.cover.remove(b); else this.cover.splice(this.cover.indexOf(b), 1);
    this.nav?.updateRegion(b.min.x, b.min.z, b.max.x, b.max.z);
    bus.emit('world:coverDestroyed', { cover: b, by: by?.id, center: [(b.min.x + b.max.x) / 2, b.max.y, (b.min.z + b.max.z) / 2], crushed: true });
  }

  /**
   * HD2: explosions throw people. Anyone within ragdoll.blastRadiusFrac of the radius goes limp
   * (prone soldiers resist: proneResist shrinks that reach); everyone else in it is shoved.
   */
  #blast(e, point, radius, dist, weapon) {
    const mv = e.movement, R = mv.t?.ragdoll;
    const away = _oc.subVectors(mv.state.position, point).setY(0);
    const len = away.length() || 1;
    // Mass: a soldier who can't be knocked back stands his ground while he's up (not once he's down).
    const kb = e.health.up ? e.perks?.knockback ?? 1 : 1;
    if (kb <= 0) return;
    const k = (weapon.knockback ?? 10) * (1 - Math.min(1, dist / radius)) * kb;
    const reach = R ? radius * R.blastRadiusFrac / (mv.state.stance === 'prone' ? mv.t.knockdown.proneResist : 1) : 0;
    const limp = dist < reach;
    mv.impulse?.((away.x / len) * k, k * 0.45 + (limp ? 1.5 : 0), (away.z / len) * k, { cause: 'explosion', at: point, ragdoll: limp });
  }

  damageDeployables(center, radius, amount, by, ammoType = 'explosive', team = by?.team) {
    for (const d of this.deployables.inRadius(center, radius)) {
      const share = this.harm(team, d, 'explosion');
      if (!share) continue;
      d.health.damage(amount * share * (this.damageMatrix[ammoType]?.barrier ?? 1), { kind: 'splash' }, by);
    }
  }

  /**
   * Where an artillery round lands (FieldGuns shells and rockets, AT slugs): the destructible
   * cover within `artillery.cover` is blown away (sandbag parapets, crates, dug-in positions) and,
   * on open ground, the shell leaves a crater (`artillery.crater` [radius, depth, rim]): carved
   * into the terrain (the renderer and nav redo that patch), muddy like the trenches. A round
   * that bursts on a building or a blockhouse leaves no crater (and walls never float).
   */
  shellImpact(point, weapon, projectile) {
    const A = weapon.artillery, by = this.entity(projectile?.ownerId);
    if (A.cover) this.destroyCover(point, A.cover, by);
    let crater = 0;
    if (A.crater && this.terrain) {
      const [r, depth, rim = 0] = A.crater, reach = r * 1.35, g = this.terrain.height(point.x, point.z);
      let hard = false;
      this.coverIn(point.x - reach, point.z - reach, point.x + reach, point.z + reach, (b) => { if (!b.destructible && b.min.y < g + 1) hard = true; });
      if (!hard && point.y - g < 1.2) {
        this.terrain.carveDisc(point.x, point.z, r, depth, rim);
        this.nav?.updateRegion(point.x - reach, point.z - reach, point.x + reach, point.z + reach);
        crater = r;
      }
    }
    bus.emit('artillery:impact', { point: [point.x, point.y, point.z], radius: weapon.damage?.splash ?? 0, crater, shell: weapon.id, team: projectile?.team ?? -1, ownerId: projectile?.ownerId ?? null });
  }

  /** Breach/Rift charges remove destructible cover overlapping the blast. */
  destroyCover(center, radius, by) {
    const hit = [];
    this.coverIn(center.x - radius, center.z - radius, center.x + radius, center.z + radius, (b) => {
      if (!b.destructible) return;
      _box.set(b.min, b.max);
      if (_box.distanceToPoint(center) <= radius) hit.push(b);
    });
    for (const b of hit) {
      if (this.cover.remove) this.cover.remove(b); else this.cover.splice(this.cover.indexOf(b), 1);
      // Bots route through the gap from now on.
      this.nav?.updateRegion(b.min.x, b.min.z, b.max.x, b.max.z);
      bus.emit('world:coverDestroyed', { cover: b, by: by?.id, center: center.toArray() });
    }
  }
}
