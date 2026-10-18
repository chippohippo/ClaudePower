// Structures: what holds the city's buildings up, and what happens when it's shot away.
//
//  * Every house, scaffold and skybridge is a structure; its pieces are its members (Houses.js:
//    piers, bands, floor slabs, balconies, stairs, rails; CityExtras.js: decks, stairs, ramps).
//  * Blasts damage the members they reach: P (1 - d/R)^1.5, P the weapon's structural power (its
//    damage, ×2.5 for explosives, ×4 for artillery, ×6 for a charge set against the wall), R 90% of
//    its splash. Where that's more than a wall or a slab can take (its material's patch strength,
//    for its thickness) it breaks through: the member is split into what's left round a hole.
//    Smaller hits wear a member down; worn out (or small, like a rail), it goes altogether.
//  * What holds what: a member stands on the ground, bears on a standing member under it, or hangs
//    from members beside it that stand or bear (nothing hangs from what itself hangs from what
//    hangs), gripped at or below its middle (a slab across the top of a pier doesn't hold the pier
//    up). Walls are frames: a pier is carried only by the band (lintel) under it, a band only by
//    the piers at its ends; slabs, stairs, rails and decks hang from whatever they're fixed to. A
//    hang holds only as far as its material reaches past its supports (concrete 2.2 m: a floor with
//    one wall left under it goes, all but the strip along that wall), and a beam bridges only as
//    wide a gap as its material spans (concrete 6 m: the lintel over one blown-out pier carries the
//    wall above, the one over an eight-metre hole breaks and the wall above comes down). A skybridge
//    is a welded frame between its two houses: it stands while they hold both ends (or it stands on
//    its ramp), and goes down whole.
//  * What's left unheld creaks for a moment, then falls: a wall topples and lies flat, a slab drops,
//    landing on whatever is below (the street, the rubble, the floor under it). It crushes whoever
//    it lands on, hammers the member it lands on (a floor falling on the one below can take that
//    with it), and stays there as rubble to climb over and hide behind.
//
// Simulation only (deterministic). Events: structure:hit {at, cover}, structure:break {cover,
// fragments, at, hole}, structure:creak {at, n}, structure:fall {cover, to, topple, time, mat},
// structure:land {at, energy, size, mat}; and world:coverDestroyed / world:coverAdded with
// `structural: true` for everything that stops or starts being cover (TacticalMap, the renderers).

import { Vector3 } from 'three';
import { bus } from '../core/EventBus.js';
import { mulberry32 } from './Terrain.js';

export const MATERIAL = {
  // density t/m³, hp per m³, patch: the blast a 0.3 m slab of it takes per m² before it breaks
  // through, reach: how far (m) a member of it holds out past its last support, span: the widest
  // gap a beam of it bridges between two supports.
  concrete: { density: 2.4, hp: 400, patch: 400, reach: 2.2, span: 6 },
  metal: { density: 1.2, hp: 600, patch: 160, reach: 2.0, span: 8 },   // grating, rails and frames: mostly air
  wood: { density: 0.6, hp: 150, patch: 120, reach: 1.2, span: 4 },
};
const E = 0.06;                 // m: touching
const G = 9.8;
const CREAK = 0.35;             // s of creaking before the first piece goes
const RUBBLE_CAP = 90;          // rubble boxes a structure leaves (the rest is dust)
const RUBBLE_MIN = 0.12;        // m³: smaller pieces are dust, not cover
const CRUSH = 6;                // damage per kJ to whoever a falling piece lands on
const POUND = 2.5;              // damage per kJ to the member it lands on
const METAL_KINDS = new Set(['hrail', 'brail', 'sstair']);
const _p = new Vector3();

/** What a blast does to buildings: its damage, scaled by how it goes off. */
export function structuralPower(weapon, { charge = false } = {}) {
  const base = weapon?.damage?.base ?? 0;
  return base * (charge ? 6 : weapon?.artillery ? 4 : weapon?.ammoType === 'explosive' ? 2.5 : 1.5);
}

const vol = (b) => (b.max.x - b.min.x) * (b.max.y - b.min.y) * (b.max.z - b.min.z);
/** Can m hang by contact r? Only if it's gripped at or below its middle: a slab across the top of a pier doesn't hold the pier up. */
const grips = (m, r) => r[4] <= (m.min.y + m.max.y) / 2 + 0.01;
/**
 * Can m hang from b at all? A wall is a frame: a pier is carried only by the band (lintel) under
 * it, a band only by the piers at its ends (or the band it continues); slabs, stairs, rails and
 * decks hang from whatever they're fixed to.
 */
const hangsFrom = (m, b) => (m.role === 'pier' ? b.role === 'band' : m.role === 'band' ? b.role === 'pier' || b.role === 'band' : true);
const dims = (b) => [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z];
const centerOf = (b, out = new Vector3()) => out.set((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2);
const boxDist = (p, b) => Math.hypot(Math.max(b.min.x - p.x, 0, p.x - b.max.x), Math.max(b.min.y - p.y, 0, p.y - b.max.y), Math.max(b.min.z - p.z, 0, p.z - b.max.z));
/** The axis a slab or a wall is thin along (under 0.45 m, the other two over 1 m), or null. */
function thinAxis(b) {
  const [dx, dy, dz] = dims(b), m = Math.min(dx, dy, dz);
  if (m > 0.45) return null;
  if (m === dy && dx > 1 && dz > 1) return 'y';
  if (m === dx && dy > 1 && dz > 1) return 'x';
  if (m === dz && dx > 1 && dy > 1) return 'z';
  return null;
}
/** Rectangle minus rectangle: up to four pieces (rects [a0, c0, a1, c1]). */
function minus([a0, c0, a1, c1], [h0, k0, h1, k1]) {
  h0 = Math.max(a0, h0); k0 = Math.max(c0, k0); h1 = Math.min(a1, h1); k1 = Math.min(c1, k1);
  if (h0 >= h1 || k0 >= k1) return [[a0, c0, a1, c1]];
  const out = [];
  if (k0 > c0 + 0.01) out.push([a0, c0, a1, k0]);
  if (k1 < c1 - 0.01) out.push([a0, k1, a1, c1]);
  if (h0 > a0 + 0.01) out.push([a0, k0, h0, k1]);
  if (h1 < a1 - 0.01) out.push([h1, k0, a1, k1]);
  return out;
}

/**
 * A beam (a member three times longer than it is deep) held across a gap wider than its material
 * spans: { m, axis, u0, u1 } (the unsupported stretch), or null.
 */
function gap(m, rects) {
  const dx = m.max.x - m.min.x, dz = m.max.z - m.min.z, axis = dx >= dz ? 'x' : 'z', len = Math.max(dx, dz);
  if (len < 3 * Math.min(dx, dz) || len < 3) return null;
  const i0 = axis === 'x' ? 0 : 1, i1 = axis === 'x' ? 2 : 3, lo = m.min[axis], hi = m.max[axis];
  const iv = rects.map((r) => [Math.max(lo, r[i0]), Math.min(hi, r[i1])]).filter(([a, b]) => b >= a).sort((p, q) => p[0] - q[0]);
  let best = null, end = -Infinity;
  for (const [a, b] of iv) {
    if (end > -Infinity && a - end > (best ? best.u1 - best.u0 : 0)) best = { u0: end, u1: a };
    end = Math.max(end, b);
  }
  return best && best.u1 - best.u0 > MATERIAL[m.st.mat].span ? { m, axis, ...best } : null;
}

/**
 * How two boxes meet, from m's side: 'below' (b holds m up), 'above' (m holds b up), 'side', or
 * null; and where: r = [x0, z0, x1, z1, y0, y1] (the contact's footprint, and its height range).
 */
function contact(m, b) {
  const ox = Math.min(m.max.x, b.max.x) - Math.max(m.min.x, b.min.x);
  const oz = Math.min(m.max.z, b.max.z) - Math.max(m.min.z, b.min.z);
  if (ox < -E || oz < -E) return null;
  const oy = Math.min(m.max.y, b.max.y) - Math.max(m.min.y, b.min.y);
  const r = [Math.max(m.min.x, b.min.x), Math.max(m.min.z, b.min.z), Math.min(m.max.x, b.max.x), Math.min(m.max.z, b.max.z), Math.max(m.min.y, b.min.y), Math.min(m.max.y, b.max.y)];
  if (ox > 0.01 && oz > 0.01) {
    if (m.min.y >= b.max.y - 0.3 && m.min.y <= b.max.y + E && m.min.y > b.min.y + 0.05) return { type: 'below', r };
    if (b.min.y >= m.max.y - 0.3 && b.min.y <= m.max.y + E && b.min.y > m.min.y + 0.05) return { type: 'above', r };
    return oy > 0.05 ? { type: 'side', r } : null;
  }
  return oy > 0.05 && (ox > 0.01 || oz > 0.01) ? { type: 'side', r } : null;
}

export class StructureSystem {
  /**
   * @param {CombatWorld} world
   * @param {object} map  the frontline map (its city: houses, scaffolds, bridges)
   */
  constructor(world, map, { seed = 1 } = {}) {
    this.world = world; this.map = map;
    this.rand = mulberry32(seed * 7919 + 17);
    this.time = 0;
    this.list = [];
    this.creaking = [];          // { m, at } members coming down at `at`
    this.falls = [];             // { m, S, t, T, to, from, E, topple, by }
    this.dirty = [];             // nav rects to redo [x0, z0, x1, z1]
    this.rubbleCount = 0;
    this.stats = { breaks: 0, holes: 0, falls: 0, crushed: 0, rubble: 0 };
    const C = map.city;
    for (const h of C?.houses ?? []) this.register('house', [...h.parts.wall, ...h.parts.floor, ...h.parts.stair, ...h.parts.rail], { id: h.id, house: h });
    for (const sc of C?.scaffolds ?? []) this.register('scaffold', [...sc.parts.deck, ...sc.parts.stair]);
    for (const br of C?.bridges ?? []) this.register('bridge', [...br.parts.deck, ...br.parts.rail, ...br.parts.ramp], { welded: true });
    // Work one out now, so the first shell to hit a building mid-match doesn't pay for compiling all this.
    if (this.list.length) { this.#adjacency(this.list[0]); this.#standing(this.list[0]); }
  }

  /**
   * A structure from boxes already in the cover (piers: role 'pier', beams: role 'band'; anything
   * else hangs from whatever it's fixed to). Welded: a frame that stands or falls whole.
   */
  register(kind, members, { id = this.list.length, welded = false, house = null } = {}) {
    if (!members.length) return null;
    const S = { id: this.list.length, kind, key: id, welded, house, members: new Set(), adj: false, rubble: 0, min: members[0].min.clone(), max: members[0].max.clone(), near: [], on: new Set() };
    for (const m of members) this.#member(m, S);
    this.list.push(S);
    for (const T of this.list) if (T !== S && T.max.x >= S.min.x - 0.2 && T.min.x <= S.max.x + 0.2 && T.max.z >= S.min.z - 0.2 && T.min.z <= S.max.z + 0.2) { S.near.push(T); T.near.push(S); }
    return S;
  }

  /** Take member m out (as if shot away) and let the rest of its structure find out what that means. */
  knockOut(m) {
    if (!m?.st || m.st.gone) return;
    const S = m.st.S;
    this.#breakUp(m, centerOf(m, new Vector3()), []);
    this.#settle(S);
  }

  #member(m, S, frac = 1) {
    const mat = METAL_KINDS.has(m.kind) || m.surface === 'metal' ? 'metal' : m.surface === 'wood' ? 'wood' : 'concrete', M = MATERIAL[mat], v = vol(m);
    const max = Math.max(25, v * M.hp);
    m.st = { S, mat, max, hp: max * frac, mass: v * M.density, up: [], down: [], side: [], ext: [], doomed: false, gone: false, by: null };
    S.members.add(m);
    S.min.min(m.min); S.max.max(m.max);
    return m;
  }

  /** The structure a cover box belongs to, if any. */
  of(b) { return b?.st?.S ?? null; }

  // ---------------------------------------------------------------- damage
  /**
   * A blast at `point` (CombatWorld.explode, a breach charge).
   * @param {object} weapon   its def (damage.base, ammoType, artillery)
   * @param {object} o        { charge: set against the wall (a breach charge), by: who set it off }
   */
  blast(point, radius, weapon, { charge = false, by = null } = {}) {
    const P = structuralPower(weapon, { charge }), R = Math.max(1.2, radius * 0.9);
    if (P <= 0 || !this.list.length) return 0;
    const hit = [];
    this.world.coverIn(point.x - R, point.z - R, point.x + R, point.z + R, (b) => { if (b.st && !b.st.gone && !b.st.doomed && boxDist(point, b) < R) hit.push(b); });
    if (!hit.length) return 0;
    const touched = new Set();
    for (const m of hit) {
      const d = boxDist(point, m);
      touched.add(m.st.S);
      m.st.by = by;
      this.#damage(m, P * (1 - d / R) ** 1.5, point, P, R);
    }
    for (const S of touched) this.#settle(S);
    return hit.length;
  }

  #damage(m, dmg, point, P = dmg, R = 1) {
    const st = m.st, M = MATERIAL[st.mat];
    if (st.gone || dmg <= 0) return;
    // Broken through: a wall or a slab the blast is too strong for, where it's that strong, is
    // split round a hole (the radius from the blast inside which P (1 - r/R)^1.5 beats its patch).
    const thin = thinAxis(m);
    if (thin) {
      const t = dims(m)[thin === 'x' ? 0 : thin === 'y' ? 1 : 2], S = M.patch * Math.max(0.5, t / 0.3);
      if (P > S) {
        const rc = R * (1 - (S / P) ** (2 / 3)), mid = (m.min[thin] + m.max[thin]) / 2, off = Math.max(0, Math.abs(point[thin] - mid) - t / 2);
        const r = rc > off ? Math.sqrt(rc * rc - off * off) : 0;
        if (r >= 0.35) { this.#hole(m, point, r, thin); return; }
      }
    }
    st.hp -= dmg;
    if (st.hp <= 0) this.#breakUp(m, point, []);
    else bus.emit('structure:hit', { at: [point.x, point.y, point.z], cover: m, mat: st.mat });
  }

  /** A hole of half-width r round the blast's point on member m (thin along `axis`): what's left of it stays. */
  #hole(m, point, r, axis) {
    const [u, v] = axis === 'y' ? ['x', 'z'] : axis === 'x' ? ['z', 'y'] : ['x', 'y'];
    const rect = [m.min[u], m.min[v], m.max[u], m.max[v]];
    const pu = Math.min(m.max[u], Math.max(m.min[u], point[u])), pv = Math.min(m.max[v], Math.max(m.min[v], point[v]));
    const hole = [pu - r, pv - r, pu + r, pv + r];
    const left = minus(rect, hole).filter(([a0, c0, a1, c1]) => a1 - a0 >= 0.2 && c1 - c0 >= 0.2);
    const frac = Math.max(0.3, m.st.hp / m.st.max);
    const frags = left.map(([a0, c0, a1, c1]) => {
      const min = m.min.clone(), max = m.max.clone();
      min[u] = a0; min[v] = c0; max[u] = a1; max[v] = c1;
      return { min, max, surface: m.surface, kind: m.kind, destructible: m.destructible, render: m.render, house: m.house, group: m.group, role: m.role };
    });
    const hb = { min: m.min.clone(), max: m.max.clone() };
    hb.min[u] = Math.max(m.min[u], hole[0]); hb.min[v] = Math.max(m.min[v], hole[1]); hb.max[u] = Math.min(m.max[u], hole[2]); hb.max[v] = Math.min(m.max[v], hole[3]);
    this.stats.holes++;
    this.#breakUp(m, point, frags, frac, [hb.min.x, hb.min.y, hb.min.z, hb.max.x, hb.max.y, hb.max.z]);
  }

  /** Member m is gone (blown away, or all but `frags`, which take its place). */
  #breakUp(m, point, frags, frac = 1, hole = null) {
    const S = m.st.S, by = m.st.by;
    this.#remove(m);
    this.stats.breaks++;
    for (const f of frags) {
      this.#member(f, S, frac);
      f.st.by = by;
      this.world.cover.add ? this.world.cover.add(f) : this.world.cover.push(f);
      if (S.adj) this.#link(f, S);
    }
    bus.emit('structure:break', { cover: m, fragments: frags, at: [point.x, point.y, point.z], hole: hole ?? [m.min.x, m.min.y, m.min.z, m.max.x, m.max.y, m.max.z], mat: m.st.mat, structure: S.id });
    for (const f of frags) bus.emit('world:coverAdded', { cover: f, structural: true });
  }

  /** Beam m breaks either side of its unsupported stretch [u0, u1] along `axis`: three pieces; returns the middle one (unheld). */
  #cut({ m, axis, u0, u1 }) {
    if (m.st.gone) return null;
    const S = m.st.S, frac = m.st.hp / m.st.max, by = m.st.by;
    const pieces = [[m.min[axis], u0], [u0, u1], [u1, m.max[axis]]].filter(([a, b]) => b - a >= 0.2).map(([a, b]) => {
      const min = m.min.clone(), max = m.max.clone();
      min[axis] = a; max[axis] = b;
      return { min, max, surface: m.surface, kind: m.kind, destructible: m.destructible, render: m.render, house: m.house, group: m.group, role: m.role };
    });
    this.#remove(m);
    for (const f of pieces) {
      this.#member(f, S, frac);
      f.st.by = by;
      this.world.cover.add ? this.world.cover.add(f) : this.world.cover.push(f);
      this.#link(f, S);
    }
    bus.emit('structure:break', { cover: m, fragments: pieces, at: [(m.min.x + m.max.x) / 2, (m.min.y + m.max.y) / 2, (m.min.z + m.max.z) / 2], hole: null, mat: m.st.mat, structure: S.id, cut: true });
    for (const f of pieces) bus.emit('world:coverAdded', { cover: f, structural: true });
    return pieces.find((f) => f.min[axis] >= u0 - 1e-6 && f.max[axis] <= u1 + 1e-6) ?? null;
  }

  /** Out of the cover (and the structure): the routes and the cover spots round it change. */
  #remove(m) {
    const st = m.st;
    if (st.gone) return;
    st.gone = true;
    st.S.members.delete(m);
    if (this.world.cover.remove) this.world.cover.remove(m); else { const i = this.world.cover.indexOf(m); if (i >= 0) this.world.cover.splice(i, 1); }
    this.dirty.push([m.min.x, m.min.z, m.max.x, m.max.z]);
    bus.emit('world:coverDestroyed', { cover: m, by: st.by ?? undefined, center: [(m.min.x + m.max.x) / 2, (m.min.y + m.max.y) / 2, (m.min.z + m.max.z) / 2], structural: true });
    // Bodies lying on it wake up and fall.
    this.world.fightersNear?.(centerOf(m, _p), Math.max(m.max.x - m.min.x, m.max.z - m.min.z) / 2 + 1, (e) => {
      const rd = e.movement?.ragdoll, q = e.movement?.state.position;
      if (rd?.asleep && q && q.x > m.min.x - 0.5 && q.x < m.max.x + 0.5 && q.z > m.min.z - 0.5 && q.z < m.max.z + 0.5 && q.y > m.max.y - 0.6) { rd.asleep = false; rd.restT = 0; }
    });
  }

  // ---------------------------------------------------------------- what holds what
  /** S's contacts, worked out the first time it's hit: its members against each other (a sweep along x), and against what else is in its footprint. */
  #adjacency(S) {
    if (S.adj) return;
    S.adj = true;
    const ms = [...S.members].sort((a, b) => a.min.x - b.min.x);
    for (const m of ms) { const st = m.st; st.up = []; st.down = []; st.side = []; st.ext = []; }
    for (let i = 0; i < ms.length; i++) {
      const a = ms[i];
      for (let j = i + 1; j < ms.length && ms[j].min.x <= a.max.x + E; j++) {
        const b = ms[j], c = contact(a, b);
        if (!c) continue;
        if (c.type === 'below') { a.st.down.push({ b, r: c.r }); b.st.up.push({ b: a, r: c.r }); }
        else if (c.type === 'above') { a.st.up.push({ b, r: c.r }); b.st.down.push({ b: a, r: c.r }); }
        else { a.st.side.push({ b, r: c.r }); b.st.side.push({ b: a, r: c.r }); }
      }
    }
    // Outside it: the kerb it stands on, a tower a deck hangs off, the houses a bridge spans between.
    const ext = [];
    this.world.coverIn(S.min.x - E, S.min.z - E, S.max.x + E, S.max.z + E, (b) => { if (b.st?.S !== S && !b.st?.gone) ext.push(b); });
    for (const m of ms) for (const b of ext) {
      if (b.max.x < m.min.x - E || b.min.x > m.max.x + E || b.max.z < m.min.z - E || b.min.z > m.max.z + E) continue;
      const c = contact(m, b);
      if (c && c.type !== 'above') { m.st.ext.push({ b, type: c.type, r: c.r }); if (b.st) S.on.add(b.st.S); }
    }
  }

  /** m's contacts, from its side: with its structure's members (up, down, side) and everything else (ext). */
  #contacts(m, S) {
    const st = m.st;
    this.world.coverIn(m.min.x - E, m.min.z - E, m.max.x + E, m.max.z + E, (b) => {
      if (b === m || b.st?.gone) return;
      const c = contact(m, b);
      if (!c) return;
      if (b.st?.S === S) (c.type === 'below' ? st.down : c.type === 'above' ? st.up : st.side).push({ b, r: c.r });
      else if (c.type !== 'above') st.ext.push({ b, type: c.type, r: c.r });
    });
  }

  /** A new member (a fragment): its contacts, and theirs with it. */
  #link(f, S) {
    this.#contacts(f, S);
    for (const x of f.st.ext) if (x.b.st) S.on.add(x.b.st.S);
    for (const { b, r } of f.st.down) b.st.up.push({ b: f, r });
    for (const { b, r } of f.st.up) b.st.down.push({ b: f, r });
    for (const { b, r } of f.st.side) b.st.side.push({ b: f, r });
  }

  #grounded(m) {
    const t = this.world.terrain, g = t ? t.height((m.min.x + m.max.x) / 2, (m.min.z + m.max.z) / 2) : 0;
    return m.min.y <= g + 0.35;
  }

  /** Is an anchor outside the structure (the ground's cover, a tower, another structure's member) still there? */
  #live(b) { return b.st ? !b.st.gone && !b.st.doomed : true; }

  /**
   * The members of S that still stand: levels from the ground (0: stands or bears on what stands,
   * +1 for each hang), hangs only from level 0 or 1, every hanging or bearing member's centre within
   * its supports (by its material's reach, for a hang). Members that fail drop out and it's done again.
   * A beam held at both ends across a gap wider than its material spans goes into `spans` (it breaks there).
   */
  #standing(S, spans = []) {
    const out = new Set([...S.members].filter((m) => !m.st.doomed));
    if (S.welded) return this.#standingWelded(S, out);
    for (let pass = 0; pass < 64; pass++) {
      const level = new Map(), buckets = [[], [], []];
      for (const m of out) {
        if (this.#grounded(m) || m.st.ext.some((x) => x.type === 'below' && this.#live(x.b))) { level.set(m, 0); buckets[0].push(m); }
        else if (m.st.ext.some((x) => x.type === 'side' && grips(m, x.r) && hangsFrom(m, x.b) && this.#live(x.b))) { level.set(m, 1); buckets[1].push(m); }
      }
      for (let L = 0; L < 3; L++) {
        for (let i = 0; i < buckets[L].length; i++) {
          const a = buckets[L][i];
          if (level.get(a) !== L) continue;
          for (const { b } of a.st.up) if (out.has(b) && !(level.get(b) <= L)) { level.set(b, L); buckets[L].push(b); }
          if (L <= 1) for (const { b, r } of a.st.side) if (out.has(b) && !(level.get(b) <= L + 1) && grips(b, r) && hangsFrom(b, a)) { level.set(b, L + 1); buckets[L + 1].push(b); }
        }
      }
      // Check the geometry: what bears has its centre over its supports; what hangs, within reach of them.
      let failed = 0;
      for (const m of out) {
        const L = level.get(m);
        if (L === undefined) continue;
        if (this.#grounded(m)) continue;
        const cx = (m.min.x + m.max.x) / 2, cz = (m.min.z + m.max.z) / 2;
        const bear = [], hang = [];
        for (const { b, r } of m.st.down) if (out.has(b) && level.has(b)) bear.push(r);
        for (const x of m.st.ext) if (this.#live(x.b) && (x.type === 'below' || (grips(m, x.r) && hangsFrom(m, x.b)))) (x.type === 'below' ? bear : hang).push(x.r);
        for (const { b, r } of m.st.side) if (out.has(b) && level.get(b) <= 1 && grips(m, r) && hangsFrom(m, b)) hang.push(r);
        const within = (rs, pad) => {
          if (!rs.length) return false;
          let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
          for (const r of rs) { x0 = Math.min(x0, r[0]); z0 = Math.min(z0, r[1]); x1 = Math.max(x1, r[2]); z1 = Math.max(z1, r[3]); }
          return cx >= x0 - pad && cx <= x1 + pad && cz >= z0 - pad && cz <= z1 + pad;
        };
        if (within(bear, 0.35)) continue;
        if (within([...bear, ...hang], MATERIAL[m.st.mat].reach)) { const g = gap(m, [...bear, ...hang]); if (g) spans.push(g); continue; }
        out.delete(m); failed++;
      }
      // Whatever no path reached is out too.
      for (const m of [...out]) if (!level.has(m)) { out.delete(m); failed++; }
      if (!failed) return out;
      spans.length = 0;
    }
    return out;
  }

  /** A welded frame (a skybridge): each connected piece of it stands on the ground, on an anchor, or hangs between anchors that hold its middle. */
  #standingWelded(S, out) {
    const seen = new Set(), keep = new Set();
    for (const start of out) {
      if (seen.has(start)) continue;
      const part = [], q = [start];
      seen.add(start);
      while (q.length) {
        const a = q.pop();
        part.push(a);
        for (const { b } of [...a.st.up, ...a.st.down, ...a.st.side]) if (out.has(b) && !seen.has(b)) { seen.add(b); q.push(b); }
      }
      let mass = 0, cx = 0, cz = 0, stands = false, x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const m of part) {
        mass += m.st.mass; cx += m.st.mass * (m.min.x + m.max.x) / 2; cz += m.st.mass * (m.min.z + m.max.z) / 2;
        if (this.#grounded(m)) stands = true;
        for (const x of m.st.ext) {
          if (!this.#live(x.b)) continue;
          if (x.type === 'below') stands = true;
          x0 = Math.min(x0, x.r[0]); z0 = Math.min(z0, x.r[1]); x1 = Math.max(x1, x.r[2]); z1 = Math.max(z1, x.r[3]);
        }
      }
      cx /= mass || 1; cz /= mass || 1;
      const reach = MATERIAL.concrete.reach;
      if (stands || (x1 >= x0 && cx >= x0 - reach && cx <= x1 + reach && cz >= z0 - reach && cz <= z1 + reach)) for (const m of part) keep.add(m);
    }
    return keep;
  }

  /** After damage to S: what no longer stands creaks, then comes down (the lowest first). Structures leaning on S are looked at too. */
  #settle(S, seen = new Set()) {
    if (seen.has(S)) return;
    seen.add(S);
    this.#adjacency(S);
    const spans = [];
    let stand = this.#standing(S, spans);
    // Beams across too wide a gap break there: the stretch over the gap comes down, the ends stay.
    const broke = [];
    if (spans.length) {
      for (const g of spans) { const mid = this.#cut(g); if (mid) { mid.st.doomed = true; broke.push(mid); } }
      stand = this.#standing(S);
    }
    const unheld = [...broke, ...[...S.members].filter((m) => !m.st.doomed && !stand.has(m))];
    if (unheld.length) {
      const base = Math.min(...unheld.map((m) => m.min.y));
      let cx = 0, cy = 0, cz = 0;
      for (const m of unheld) {
        m.st.doomed = true;   // (the broken middle of a beam already is)
        // Lowest first, the rest a beat behind: what's above rides down on what's below.
        this.creaking.push({ m, at: this.time + CREAK * (0.6 + 0.8 * this.rand()) + (m.min.y - base) * 0.03 });
        cx += (m.min.x + m.max.x) / 2; cy += m.max.y; cz += (m.min.z + m.max.z) / 2;
      }
      const n = unheld.length;
      bus.emit('structure:creak', { at: [cx / n, cy / n, cz / n], n, structure: S.id });
    }
    // Other structures resting on or hanging from this one's members (a skybridge on a house).
    for (const T of S.near) {
      if (seen.has(T)) continue;
      this.#adjacency(T);
      if (T.on.has(S)) this.#settle(T, seen);
    }
  }

  // ---------------------------------------------------------------- falling
  /** How a falling member lies once down: a wall topples (away from its building's middle) and lies flat; anything else drops. */
  #pose(m) {
    const [dx, dy, dz] = dims(m), S = m.st.S;
    const tall = dy > 1.2 && dy > 2.5 * Math.min(dx, dz);
    if (!tall) return { box: { min: m.min.clone(), max: m.max.clone() }, topple: null };
    const ax = dx < dz ? 'x' : 'z';              // it's thin along ax: it topples that way
    const mid = (S.min[ax] + S.max[ax]) / 2, at = (m.min[ax] + m.max[ax]) / 2;
    const dir = Math.abs(at - mid) < 0.5 ? (this.rand() < 0.5 ? -1 : 1) : Math.sign(at - mid);
    const min = m.min.clone(), max = m.max.clone();
    const t = m.max[ax] - m.min[ax];
    if (dir > 0) { min[ax] = m.max[ax]; max[ax] = m.max[ax] + dy; } else { max[ax] = m.min[ax]; min[ax] = m.min[ax] - dy; }
    max.y = min.y + t;
    return { box: { min, max }, topple: { axis: ax, dir } };
  }

  /** The top of what's under a footprint, below `under` (the ground, or cover still standing). */
  #floorUnder(x0, z0, x1, z1, under) {
    const t = this.world.terrain;
    let top = -Infinity;
    if (t) for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1], [(x0 + x1) / 2, (z0 + z1) / 2]]) top = Math.max(top, t.height(x, z));
    else top = 0;
    this.world.coverIn(x0, z0, x1, z1, (b) => {
      if (b.st?.gone || b.st?.doomed) return;
      if (b.max.x <= x0 || b.min.x >= x1 || b.max.z <= z0 || b.min.z >= z1) return;
      if (b.max.y <= under + 0.05 && b.max.y > top) top = b.max.y;
    });
    return top;
  }

  #fall(m) {
    const st = m.st, S = st.S;
    this.#remove(m);
    const { box, topple } = this.#pose(m);
    // What it comes down on: below where it was (not the last support it slid off, level with it);
    // a toppled wall can come down on the kerb it stood beside.
    const y = this.#floorUnder(box.min.x, box.min.z, box.max.x, box.max.z, topple ? m.min.y + 0.4 : m.min.y - 0.3);
    const drop = Math.max(0, m.min.y - y), h = box.max.y - box.min.y;
    box.min.y = y; box.max.y = y + h;
    const T = Math.max(0.2, Math.sqrt((2 * drop) / G) + (topple ? 0.35 : 0));
    const energy = (st.mass * G * Math.max(drop, topple ? (m.max.y - m.min.y) / 2 : 0)) / 1;   // kJ (t · m/s² · m)
    this.falls.push({ m, S, t: 0, T, to: box, from: { min: m.min.clone(), max: m.max.clone() }, energy, topple, by: st.by, mat: st.mat });
    this.stats.falls++;
    bus.emit('structure:fall', { cover: m, to: [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z], topple, time: T, mat: st.mat, structure: S.id });
  }

  #land(f) {
    const b = f.to, at = centerOf(b, new Vector3());
    // Whoever is under it.
    const crush = Math.min(5000, f.energy * CRUSH);
    if (crush >= 1) {
      const R = Math.hypot(b.max.x - b.min.x, b.max.z - b.min.z) / 2 + 0.6;
      this.world.fightersNear?.(at, R, (e) => {
        if (e.health?.dead || e.vehicle) return;
        const q = e.movement.state.position;
        if (q.x < b.min.x - 0.3 || q.x > b.max.x + 0.3 || q.z < b.min.z - 0.3 || q.z > b.max.z + 0.3) return;
        if (q.y < b.min.y - 0.6 || q.y > f.from.min.y + 0.3) return;
        e.health.damage(crush, { kind: 'crush', noDown: crush >= 200, from: [at.x, b.max.y + 2, at.z] }, this.world.entity?.(f.by) ?? null);
        this.stats.crushed++;
      });
    }
    // What it lands on takes the blow (a floor coming down on the one below can take that too).
    const under = [];
    this.world.coverIn(b.min.x, b.min.z, b.max.x, b.max.z, (c) => { if (c.st && !c.st.gone && !c.st.doomed && Math.abs(c.max.y - b.min.y) < 0.3 && c.max.x > b.min.x && c.min.x < b.max.x && c.max.z > b.min.z && c.min.z < b.max.z) under.push(c); });
    const touched = new Set();
    for (const c of under) { c.st.by = f.by; touched.add(c.st.S); this.#damage(c, (f.energy * POUND) / under.length, at); }
    for (const S of touched) this.#settle(S);
    // Rubble where it lies (stacked on any that came down there before it).
    if (vol(b) >= RUBBLE_MIN && f.S.rubble < RUBBLE_CAP) {
      let y = b.min.y;
      const pile = [];
      this.world.coverIn(b.min.x, b.min.z, b.max.x, b.max.z, (c) => { if (c.kind === 'rubble' && c.max.x > b.min.x && c.min.x < b.max.x && c.max.z > b.min.z && c.min.z < b.max.z) pile.push(c); });
      pile.sort((p, q) => p.min.y - q.min.y);
      for (const c of pile) if (c.min.y <= y + 0.1 && c.max.y > y) y = c.max.y;
      const lift = y - b.min.y, h = b.max.y - b.min.y;
      const r = { min: new Vector3(b.min.x, b.min.y + lift, b.min.z), max: new Vector3(b.max.x, b.min.y + lift + h, b.max.z), kind: 'rubble', surface: f.mat === 'metal' ? 'metal' : 'concrete', destructible: true, render: 'city', rubble: f.mat };
      this.world.cover.add ? this.world.cover.add(r) : this.world.cover.push(r);
      f.S.rubble++; this.stats.rubble++;
      this.dirty.push([r.min.x, r.min.z, r.max.x, r.max.z]);
      bus.emit('world:coverAdded', { cover: r, structural: true });
    }
    bus.emit('structure:land', { at: [at.x, b.min.y, at.z], energy: f.energy, size: [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z], mat: f.mat, structure: f.S.id });
  }

  // ---------------------------------------------------------------- per tick
  update(dt) {
    this.time += dt;
    if (this.creaking.length) {
      this.creaking.sort((a, b) => a.at - b.at);
      while (this.creaking.length && this.creaking[0].at <= this.time) this.#fall(this.creaking.shift().m);
    }
    for (let i = this.falls.length - 1; i >= 0; i--) {
      const f = this.falls[i];
      f.t += dt;
      if (f.t < f.T) continue;
      this.falls.splice(i, 1);
      this.#land(f);
    }
    // The routes round whatever changed, redone once a tick.
    if (this.dirty.length) {
      const nav = this.world.nav;
      if (nav) {
        let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
        for (const [a, b, c, d] of this.dirty) { x0 = Math.min(x0, a); z0 = Math.min(z0, b); x1 = Math.max(x1, c); z1 = Math.max(z1, d); }
        if ((x1 - x0) * (z1 - z0) < 6400) nav.updateRegion(x0, z0, x1, z1);
        else for (const [a, b, c, d] of this.dirty) nav.updateRegion(a, b, c, d);
      }
      this.dirty.length = 0;
    }
  }

  /** Is anything still coming down? */
  get busy() { return this.creaking.length > 0 || this.falls.length > 0; }
}
