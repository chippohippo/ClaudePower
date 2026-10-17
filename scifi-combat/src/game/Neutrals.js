// Neutrals: the city's other people (data/civilians.json; who fights whom: src/combat/Teams.js).
//  * Civilians (team CIVILIAN): never armed at the start. Spread over the city's sectors (more
//    toward the middle, where the fighting starts), clear of the points and the spawns: in a
//    house's rooms, a ruin, behind a market stall, some out in the street near one. They run
//    from the fighting to the safest shelter they know and stay down there (CivilianBrain). A
//    brave one picks a gun up off the field (WeaponDrops) and then defends himself with it: at
//    whoever comes close armed, or has been shooting at his people. Some shelter together in a
//    house, all of them brave, sometimes with guns hidden there.
//  * Bandit gangs (team BANDIT): armed, holding a turf (the streets round a house or a market)
//    against both armies. The soldiers' own brain (CombatBotBrain) with the turf as the point it
//    defends, so they fight whoever comes in and drift back when he's gone; they don't chase.
//  * The alarm: what a civilian hears (shots, blasts, deaths, for a few seconds): the latest of
//    each from each source, so a firefight's every round doesn't crowd out the one close by.
// None of them respawns, costs a ticket or holds a point (FrontlineSession, FrontlineMode).

import { Vector3 } from 'three';
import { bus } from '../core/EventBus.js';
import { MovementController, FlatGroundBody } from '../movement/MovementController.js';
import { WeaponComponent, WeaponInstance } from '../combat/weapons/WeaponSystem.js';
import { buildWeapon } from '../combat/weapons/WeaponDefs.js';
import { AbilityComponent } from '../combat/AbilitySystem.js';
import { StatusComponent } from '../combat/StatusSystem.js';
import { MeleeComponent } from '../combat/melee/MeleeSystem.js';
import { Health } from '../combat/Health.js';
import { reactToHit, woundSite } from '../combat/HitReactions.js';
import { silhouetteScale } from '../movement/Hitboxes.js';
import { CIVILIAN, BANDIT, GRUDGE } from '../combat/Teams.js';
import { WeaponDrops } from '../combat/WeaponDrops.js';
import { CombatBotBrain } from '../ai/CombatBotBrain.js';
import { CivilianBrain } from '../ai/CivilianBrain.js';

const v3 = (x, y, z) => new Vector3(x, y, z);

/** A gun by id from the weapon files. */
function gun(data, id) {
  const file = data.weaponFiles.find((f) => f.weapons.some((w) => w.id === id));
  return file ? buildWeapon(file, id, data.attachments ?? [], []) : null;
}

/**
 * One of the city's people: a body, health, statuses, a fist's worth of melee, the guns given (a
 * civilian none), no abilities, no call-ins.
 */
export function buildPerson(world, data, { id, team, pos, health, guns = [], faction }) {
  const movement = new MovementController(data.movement, new FlatGroundBody(pos, world.cover, { terrain: world.terrain }), {}, id);
  movement.state.position.copy(pos);
  const e = { id, team, classId: faction, faction, mode: 'gun', movement, role: null };
  e.health = new Health(e, { health, shield: 0, armor: 'flesh', down: data.down ?? null });
  e.status = new StatusComponent(e, data.statuses, world);
  movement.hooks.fallDamage = (amount) => e.health.damage(amount, { kind: 'fall' }, null);
  movement.hooks.vital = () => (e.health.dead ? 'dead' : e.health.downed ? 'downed' : 'alive');
  movement.hooks.scale = () => silhouetteScale(e);
  e.onHit = (res, info, by) => reactToHit(e, res, info, by);
  e.woundSite = (info) => woundSite(e, info);
  e.onRevived = () => e.movement.getUpFromDown();
  e.melee = new MeleeComponent(data.meleeWeapons[0], e, world);
  e.weapons = new WeaponComponent(e, guns.map((s) => new WeaponInstance(s, data.recoil)), world);
  e.abilities = new AbilityComponent(e, {}, world);
  world.add(e);
  return e;
}

export class Neutrals {
  /**
   * @param {FrontlineSession} session  (its world, map, data, fighters, melee, barks, seed)
   * @param {object} o { firstId }
   */
  constructor(session, { firstId = 50000 } = {}) {
    this.s = session; this.world = session.world; this.map = session.map;
    const cfg = this.cfg = session.data.civilians ?? {};
    this.C = cfg.civilians ?? {}; this.B = cfg.bandits ?? {};
    let r = ((session.seed ?? 1) * 40503 + 7) >>> 0;
    this.rand = () => { r = (Math.imul(r, 1664525) + 1013904223) >>> 0; return r / 4294967296; };
    this.R = (a, b) => a + (b - a) * this.rand();
    this.nextId = firstId;
    this.civilians = []; this.bandits = []; this.gangs = []; this.groups = [];
    this.noise = new Map();             // what's been heard, the latest per source: key -> { x, z, t, loud }
    this.drops = this.world.drops = new WeaponDrops(this.world, cfg.drops ?? {}, { recoil: session.data.recoil, seed: session.seed });
    this.#shelters();
    this.#spawnGangs();
    this.#spawnCivilians();
    let blasts = 0;
    const hear = (key, p, loud) => {
      if (!p) return;
      const q = this.noise.get(key) ?? {};
      q.x = p[0] ?? p.x; q.z = p[2] ?? p.z; q.t = this.world.time; q.loud = loud;
      this.noise.set(key, q);
    };
    this.off = [
      bus.on('weapon:fire', (e) => { const f = this.world.entity(e.id); if (f && f.team !== CIVILIAN) hear(e.id, f.movement.state.position, 1); }),
      bus.on('gun:fire', (e) => hear(`g${e.id}`, e.from, 2)),
      bus.on('artillery:impact', (e) => hear(`b${blasts++ % 48}`, e.point, 3)),
      bus.on('projectile:explode', (e) => hear(`b${blasts++ % 48}`, e.point, 2.5)),
      bus.on('entity:death', (e) => { const f = this.world.entity(e.id); if (f && !f.isVehicle) hear(`d${e.id}`, f.movement.state.position, 1.5); }),
    ];
  }

  dispose() { this.off.forEach((f) => f()); this.drops.dispose(); for (const f of [...this.civilians, ...this.bandits]) f.brain?.dispose?.(); }

  /** Everyone of theirs, for the session to run (simulated like any fighter). */
  get all() { return [...this.civilians, ...this.bandits]; }

  // ---------------------------------------------------------------- where people shelter
  /**
   * Shelters: inside the houses' rooms (away from the doors), the ruins' rooms, behind the market
   * stalls. Each { x, y, z, kind, indoor, house }.
   */
  #shelters() {
    const C = this.map.city, out = this.shelters = [];
    if (!C) return;
    const roomSpots = (room, kind, house = null, y = null) => {
      const cx = (room.min.x + room.max.x) / 2, cz = (room.min.z + room.max.z) / 2;
      // Away from the doors: the room's middle pushed back from its first door.
      const d = room.doors[0];
      const bx = d ? -Math.sign(d.x - cx) * Math.min(1.2, (room.max.x - room.min.x) / 4) : 0, bz = d ? -Math.sign(d.z - cz) * Math.min(1.2, (room.max.z - room.min.z) / 4) : 0;
      const x = cx + bx, z = cz + bz;
      out.push({ x, z, y: y ?? this.map.terrain.height(x, z), kind, indoor: kind === 'house', house, room });
    };
    for (const h of C.houses ?? []) for (const room of h.rooms) roomSpots(room, 'house', h, h.base);
    for (const ru of this.map.ruins ?? []) if (!ru.stair) for (const room of ru.rooms) roomSpots(room, 'ruin');
    for (const m of C.markets ?? []) for (const st of m.stalls) {
      // Behind the counter, between it and the shelf.
      const [fx, fz] = st.face;
      out.push({ x: st.x - fx * 0.75, z: st.z - fz * 0.75, y: m.base, kind: 'market', indoor: false });
    }
  }

  /** Far enough from the armies' spawns and HQs (where nobody would live through the first minute)? */
  #quiet(x, z, r) {
    const M = this.map;
    if (M.hq.some((h) => Math.hypot(h.x - x, h.z - z) < r + 20)) return false;
    for (const s of M.sectors) for (const t of [0, 1]) for (const p of [...(s.spawns?.[t] ?? []), ...(s.rearSpawns?.[t] ?? [])]) if (Math.hypot(p.x - x, p.z - z) < r) return false;
    return true;
  }

  // ---------------------------------------------------------------- bandits
  #spawnGangs() {
    const n = this.B.gangs?.[this.s.size] ?? 0, M = this.map;
    if (!n || !M.city) return;
    const b = M.bounds, W = b.maxX - b.minX;
    // Turfs: a house or a market in the middle stretch of the map, clear of spawns and the points,
    // apart (on a small map, as clear as it can find).
    const all = [...(M.city.houses ?? []).map((h) => ({ x: (h.min.x + h.max.x) / 2, z: (h.min.z + h.max.z) / 2, house: h })), ...(M.city.markets ?? []).map((m) => ({ x: (m.x0 + m.x1) / 2, z: (m.z0 + m.z1) / 2 }))];
    let sites = [];
    for (const [quiet, pad] of [[55, 22], [38, 16], [24, 12]]) {
      sites = all.filter((q) => q.x > b.minX + W * 0.18 && q.x < b.maxX - W * 0.18 && this.#quiet(q.x, q.z, quiet) && M.points.every((p) => Math.hypot(p.pos.x - q.x, p.pos.z - q.z) > p.radius + pad));
      if (sites.length >= n) break;
    }
    const turfs = [];
    const apart = Math.min(120, W / (n + 1));
    for (let tries = 0; turfs.length < n && tries < 200 && sites.length; tries++) {
      const q = sites[Math.floor(this.rand() * sites.length)];
      if (turfs.some((t) => Math.hypot(t.x - q.x, t.z - q.z) < apart)) continue;
      turfs.push(q);
    }
    const names = this.cfg.gangs ?? ['Gang'], guns = (this.B.guns ?? []).map((id) => gun(this.s.data, id)).filter(Boolean);
    const persona = this.s.data.personalities?.[this.B.persona] ?? Object.values(this.s.data.personalities ?? {})[0];
    // Worse shots than soldiers, slower to react, and they only see as far as their own streets.
    const diff = { ...(this.s.data.difficulty ?? {}), aimError: (this.s.data.difficulty?.aimError ?? 2) * 1.5, reactionTime: Math.max(0.45, this.s.data.difficulty?.reactionTime ?? 0.4), perceptionRange: this.B.sight ?? 60 };
    turfs.forEach((t, gi) => {
      const gang = { id: gi, name: names[gi % names.length], x: t.x, z: t.z, r: this.B.turf ?? 30, members: [] };
      const size = Math.round(this.R(...(this.B.size ?? [4, 6])));
      for (let k = 0; k < size; k++) {
        const a = (k / size) * Math.PI * 2 + this.rand(), d = this.R(2, 7);
        const pos = v3(t.x + Math.cos(a) * d, 0, t.z + Math.sin(a) * d);
        pos.y = this.world.groundHeight(v3(pos.x, 60, pos.z));
        if (t.house) { pos.y = t.house.base + 0.05; pos.x = Math.max(t.house.min.x + 1.2, Math.min(t.house.max.x - 1.2, pos.x)); pos.z = Math.max(t.house.min.z + 1.2, Math.min(t.house.max.z - 1.2, pos.z)); }
        const g1 = guns[Math.floor(this.rand() * guns.length)];
        const e = buildPerson(this.world, this.s.data, { id: this.nextId++, team: BANDIT, pos, health: this.B.health ?? 120, guns: g1 ? [g1] : [], faction: 'bandit' });
        e.gang = gang; e.name = this.s.barks?.name(e) ?? `Bandit ${k + 1}`;
        e.brain = new CombatBotBrain(e, this.world, persona, diff, { seed: (this.s.seed ?? 1) * 977 + e.id });
        // Their turf is the point they hold: a slot each round it, fighting whoever comes in.
        e.brain.objective = { id: 1000 + gi, pos: v3(t.x, pos.y, t.z), radius: Math.max(6, gang.r * 0.35), role: 'defend', slot: k, of: size, field: `turf:${gi}` };
        gang.members.push(e); this.bandits.push(e);
      }
      this.gangs.push(gang);
    });
  }

  // ---------------------------------------------------------------- civilians
  #spawnCivilians() {
    const C = this.C, M = this.map;
    if (!M.city || !this.shelters.length) return;
    const n = Math.max(C.min ?? 6, Math.min(C.max ?? 64, Math.round(this.s.players * (C.perPlayers ?? 0.45))));
    // Clear of the spawns, the gangs' turfs and the points (on a small map, as clear as it can find).
    let free = [];
    for (const quiet of [30, 18, 10]) {
      free = this.shelters.filter((q) => this.#quiet(q.x, q.z, quiet) && !this.gangs.some((g) => Math.hypot(g.x - q.x, g.z - q.z) < g.r + 10)
        && M.points.every((p) => Math.hypot(p.pos.x - q.x, p.pos.z - q.z) > p.radius + 12));
      if (free.length >= n / 2) break;
    }
    if (!free.length) return;
    // Over the line sectors, more toward the middle (where the fighting starts), and fewer to
    // each market stall than to a room (a market has a dozen).
    const mid = (M.sectors.length - 1) / 2;
    const weight = (q) => {
      const sec = M.sectors.find((x) => q.x >= x.x0 && q.x < x.x1);
      return !sec || sec.kind === 'hq' ? 0 : (q.kind === 'market' ? 0.35 : 1) / (1 + Math.abs(sec.index - mid) * 0.6);
    };
    const draw = (list) => {
      let sum = 0;
      for (const q of list) sum += weight(q);
      if (sum <= 0) return list.length ? list.splice(Math.floor(this.rand() * list.length), 1)[0] : null;
      let r = this.rand() * sum;
      for (let i = 0; i < list.length; i++) if ((r -= weight(list[i])) <= 0 || i === list.length - 1) return list.splice(i, 1)[0];
      return null;
    };
    const used = new Set();
    const place = (q, k = 0) => {
      const a = this.rand() * Math.PI * 2, d = k ? this.R(0.6, 1.4) : 0;
      return v3(q.x + Math.cos(a) * d, q.y + 0.05, q.z + Math.sin(a) * d);
    };
    let made = 0;
    // Groups: in a house's room together, all brave, sometimes with guns hidden there.
    const houseRooms = free.filter((q) => q.kind === 'house');
    const nGroups = Math.round(n * (C.groups ?? 0.3) / 4);
    for (let g = 0; g < nGroups && houseRooms.length && made < n; g++) {
      const q = draw(houseRooms);
      used.add(q);
      const group = { id: g, home: q, members: [] };
      const size = Math.min(n - made, Math.round(this.R(...(C.groupSize ?? [3, 5]))));
      for (let k = 0; k < size; k++) { group.members.push(this.#civilian(place(q, k), q, { brave: true, group })); made++; }
      // A cache: a gun or two hidden in the shelter (picked up off the field all the same).
      if (this.rand() < (C.cache ?? 0.6)) {
        const ids = this.B.guns ?? [];
        for (let k = 0; k < 1 + Math.floor(this.rand() * 2); k++) {
          const s = gun(this.s.data, ids[Math.floor(this.rand() * ids.length)]);
          if (s) this.drops.drop(place(q, 1), s, { cache: true });
        }
      }
      this.groups.push(group);
    }
    // Everyone else: alone, one to a shelter while there are enough; some out in the street near
    // theirs when the battle starts (they go about between a few spots there until it reaches
    // them), the market's between its stalls.
    const rest = free.filter((q) => !used.has(q)), pool = [...rest];
    for (let k = 0; made < n && (rest.length || pool.length); k++) {
      const q = draw(rest.length ? rest : [...pool]);
      if (!q) break;
      const out = q.kind !== 'market' && this.rand() < (C.out ?? 0.3) ? this.#streetSpots(q) : null;
      const haunt = out?.length ? out : q.kind === 'market' ? this.shelters.filter((x) => x.kind === 'market' && x !== q && Math.hypot(x.x - q.x, x.z - q.z) < 16).slice(0, 4) : null;
      const pos = out?.length ? v3(out[0].x, this.world.groundHeight(v3(out[0].x, out[0].y + 1.5, out[0].z)) + 0.05, out[0].z) : place(q, k % 2);
      this.#civilian(pos, q, { brave: this.rand() < (C.brave ?? 0.4), haunt: haunt?.length ? haunt : null });
      made++;
    }
  }

  /** A few walkable spots in the street within a dozen metres of a shelter (at street level). */
  #streetSpots(q) {
    const nav = this.world.nav, T = this.map.terrain, out = [];
    for (let i = 0; i < 24 && out.length < 4; i++) {
      const a = this.rand() * Math.PI * 2, d = this.R(5, 13), x = q.x + Math.cos(a) * d, z = q.z + Math.sin(a) * d;
      if (nav?.blocked(x, z)) continue;
      const y = this.world.groundHeight(v3(x, T.height(x, z) + 1.5, z));
      if (y - T.height(x, z) > 0.4 || !this.#quiet(x, z, 30)) continue;     // the street, not a roof or a stall's counter
      out.push({ x, y, z });
    }
    return out;
  }

  #civilian(pos, home, { brave = false, group = null, haunt = null } = {}) {
    const e = buildPerson(this.world, this.s.data, { id: this.nextId++, team: CIVILIAN, pos, health: this.C.health ?? 70, faction: 'civilian' });
    e.civ = { foes: {}, engaged: {}, defend: group ? this.C.groupDefend ?? 18 : this.C.defend ?? 12, brave, group, home, haunt, hitFrom: null };
    e.name = this.s.barks?.name(e) ?? 'Civilian';
    // Hurt by someone: his side is this one's foe for a while, and his group's.
    const hit = e.onHit;
    e.onHit = (res, info, by) => {
      hit(res, info, by);
      const q = by?.movement?.state?.position;
      if (q) e.civ.hitFrom = { x: q.x, z: q.z };
      if (!by || by.team == null || by.team === CIVILIAN) return;
      const until = this.world.time + GRUDGE;
      e.civ.foes[by.team] = until;
      for (const m of group?.members ?? []) if (m !== e && !m.health.dead) m.civ.foes[by.team] = Math.max(m.civ.foes[by.team] ?? 0, until);
    };
    e.brain = new CivilianBrain(e, this.world, this, { seed: (this.s.seed ?? 1) * 131 + e.id });
    this.civilians.push(e);
    return e;
  }

  /** The loudest thing heard within r (times its loudness) of p in the last `since` s: { x, z, t, loud, d } or null. */
  heard(p, r, since = 4) {
    let best = null, bs = 0;
    const now = this.world.time;
    for (const q of this.noise.values()) {
      if (now - q.t > since) continue;
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d > r * q.loud) continue;
      const s = q.loud / (1 + d / 20);
      if (s > bs) { bs = s; best = { ...q, d }; }
    }
    return best;
  }

  update(dt) {
    this.drops.update(dt);
    // Forget what's long over (a source quiet for a while).
    if ((this.forgetT = (this.forgetT ?? 0) + dt) > 5) {
      this.forgetT = 0;
      const now = this.world.time;
      for (const [k, q] of this.noise) if (now - q.t > 10) this.noise.delete(k);
    }
  }
}
