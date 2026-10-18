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
//  * What's left unheld creaks for a moment and comes away as a body (physics/RigidWorld.js): each
//    piece of it that hangs together is one rigid body, still fixed to what stands by elastic
//    joints at the corners of every face it touched it by. The joints between them hold as much as
//    `c` times its weight (c drawn for each piece, 0.5 to 2.5: some tear straight off, some hang on),
//    shared out by the faces' areas. So it sags, then tears where it's pulled hardest: a floor let
//    go on three sides tears along its top and swings down on its bottom edge into a ramp onto the
//    floor below, or hangs there, swaying, until the joints tire and it drops; a wall over a hole
//    peels away from the floors it was fixed to. Joints are fixed to members: when one goes, what
//    hung from it is let go; when one comes away itself, what hung from it hangs from it still.
//  * What hits something hard enough breaks up (a wall into slabs, a slab into chunks), each piece
//    carrying on as it was going; it crushes whoever it comes down on (by its energy), pounds the
//    member it lands on (a floor falling on the one below can hole it, or take it down too), and is
//    thrown by blasts. At rest it's rubble: cover you climb over and hide behind, boxes stepped to
//    the lie of each piece (a slab leaning on a wall is a ramp of steps). A blast throws it again.
//
// Simulation only (deterministic). Events: structure:hit {at, cover}, structure:break {cover,
// fragments, at, hole}, structure:creak {at, n}, structure:tear {at, mat}, structure:land {at,
// energy, size, mat}; and world:coverDestroyed / world:coverAdded with `structural: true` for
// everything that stops or starts being cover (TacticalMap, the renderers).

import { Vector3 } from 'three';
import { bus } from '../core/EventBus.js';
import { mulberry32 } from './Terrain.js';
import { RigidWorld } from '../physics/RigidWorld.js';

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
const CREAK = 0.25;             // s of creaking before a piece comes away (more or less)
const RUBBLE_MIN = 0.12;        // m³: smaller pieces are dust, not cover
const CRUSH = 6;                // damage per kJ to whoever a falling piece hits
const CRUSH_V = 2.5;            // m/s: slower than this it only shoves
const POUND = 2.5;              // damage per kJ to the member it lands on
const PUSH = 0.01;              // t·m/s a blast gives a body per unit of its power (at its heart)
const TIRE = 0.1;               // a piece's joints tire past 10% of their strength (so what's left hanging comes down in a few seconds)
const AWAKE_CAP = 160;          // bodies moving at once, past which nothing breaks up further
const BODY_CAP = 480;           // bodies in all, past which the smallest at rest go to dust
const METAL_KINDS = new Set(['hrail', 'brail', 'sstair']);
const _p = new Vector3(), _q = new Vector3(), _v = new Float64Array(3), _w = new Float64Array(3);

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
    this.creaking = [];          // { ms, S, at }: pieces coming away at `at`
    this.dirty = [];             // nav rects to redo [x0, z0, x1, z1]
    this.stats = { breaks: 0, holes: 0, falls: 0, bodies: 0, tears: 0, shatters: 0, crushed: 0, rubble: 0 };
    const T = world.terrain;
    this.rigid = new RigidWorld({
      ground: T ? (x, z) => T.height(x, z) : null,
      normal: T ? (x, z, out) => { T.normal(x, z, _q); out[0] = _q.x; out[1] = _q.y; out[2] = _q.z; } : null,
      statics: (x0, z0, x1, z1, cb) => world.coverIn(x0, z0, x1, z1, cb),
    });
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
    m.st = { id: this.nextMember = (this.nextMember ?? 0) + 1, S, mat, max, hp: max * frac, mass: v * M.density, up: [], down: [], side: [], ext: [], doomed: false, gone: false, by: null };
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
    if (P <= 0) return 0;
    if (this.rigid.bodies.length) this.#blastBodies(point, P, R);
    if (!this.list.length) return 0;
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
    this.#handOver(m, frags);
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
    this.#handOver(m, pieces);
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

  /** What hung from m by joints hangs from whichever of the pieces that take its place the joint is on (if any). */
  #handOver(m, pieces) {
    if (!pieces.length) return;
    for (const j of this.rigid.joints) {
      if (j.broken || j.box !== m) continue;
      const [x, y, z] = j.lb;
      j.box = pieces.find((f) => x >= f.min.x - 0.1 && x <= f.max.x + 0.1 && y >= f.min.y - 0.1 && y <= f.max.y + 0.1 && z >= f.min.z - 0.1 && z <= f.max.z + 0.1) ?? m;
    }
  }

  /** Out of the cover (and the structure): the routes and the cover spots round it change, and whatever hung from it is let go. */
  #remove(m) {
    const st = m.st;
    if (st.gone) return;
    st.gone = true;
    st.S.members.delete(m);
    this.rigid.unanchor(m);
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
      let cx = 0, cy = 0, cz = 0;
      for (const m of unheld) {
        m.st.doomed = true;   // (the broken middle of a beam already is)
        cx += (m.min.x + m.max.x) / 2; cy += m.max.y; cz += (m.min.z + m.max.z) / 2;
      }
      // Each piece that hangs together creaks a moment, then comes away.
      for (const ms of this.#islands(unheld)) this.creaking.push({ ms, S, at: this.time + CREAK * (0.6 + 0.8 * this.rand()) });
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

  // ---------------------------------------------------------------- coming away
  /** The unheld members in the pieces that hang together (touching one another). */
  #islands(ms) {
    const set = new Set(ms), seen = new Set(), out = [];
    for (const m of ms) {
      if (seen.has(m)) continue;
      const part = [], q = [m];
      seen.add(m);
      while (q.length) {
        const a = q.pop();
        part.push(a);
        for (const list of [a.st.up, a.st.down, a.st.side]) for (const { b } of list) if (set.has(b) && !seen.has(b)) { seen.add(b); q.push(b); }
      }
      out.push(part);
    }
    return out;
  }

  /**
   * A piece comes away: its members in bodies of a few each (those that sit together), joined to
   * one another, and to what still stands, by joints at the corners of every face they touched by:
   * the joints to what stands hold as much as c times the body's weight (c drawn for the piece,
   * shared out by the faces' areas), those between its bodies as much as k times the lighter's
   * (k drawn for each face). So it sags and comes apart where it's pulled hardest, in chunks. A
   * welded frame (a skybridge) is one body. Each body is free of colliding with what it was beside
   * until it's clear of it; whatever hung from its members by joints hangs from it.
   */
  #release(ms, S) {
    ms = ms.filter((m) => !m.st.gone);
    if (!ms.length) return [];
    const parts = S.welded ? [ms] : chunks(ms), bodyOf = new Map(), bodies = [];
    const c = 0.5 + 2 * this.rand();
    for (const part of parts) {
      const set = new Set(part), boxes = [], ignore = new Set(), faces = [];
      const mats = { concrete: 0, metal: 0, wood: 0 };
      let by = null;
      for (const m of part) {
        const st = m.st;
        boxes.push({ min: m.min, max: m.max, density: MATERIAL[st.mat].density, meta: { src: m, mat: st.mat, kind: m.kind } });
        mats[st.mat] += st.mass;
        by ??= st.by;
        const touch = (b, r, type) => {
          if (set.has(b) || (b.st && (b.st.gone || b.st.doomed))) return;
          if (type === 'side') ignore.add(b);
          faces.push(face(m, b, r, type));
        };
        for (const { b, r } of st.down) touch(b, r, 'below');
        for (const { b, r } of st.up) touch(b, r, 'above');
        for (const { b, r } of st.side) touch(b, r, 'side');
        for (const x of st.ext) touch(x.b, x.r, x.type);
      }
      const mat = mats.metal > mats.concrete && mats.metal > mats.wood ? 'metal' : mats.wood > mats.concrete ? 'wood' : 'concrete';
      const body = this.rigid.addBody(boxes, { ignore: [...ignore], data: { S, by, mat, crush: new Map(), land: -1, cover: null } });
      const W = body.m * G;
      let area = 0;
      for (const f of faces) area += f.area;
      for (const f of faces) for (const p of f.pts) this.rigid.joint(body, p, null, { strength: (c * W * f.area) / (area * f.pts.length), stretch: 0.015, normal: f.n, tire: TIRE, box: f.b });
      for (const m of part) bodyOf.set(m, body);
      bodies.push(body);
    }
    // Between its bodies: the faces their members touched by.
    const done = new Set();
    for (const m of ms) {
      const A = bodyOf.get(m);
      for (const [list, type] of [[m.st.down, 'below'], [m.st.up, 'above'], [m.st.side, 'side']]) for (const { b, r } of list) {
        const B = bodyOf.get(b);
        if (!B || B === A) continue;
        this.rigid.apart(A, B);
        const key = m.st.id < b.st.id ? `${m.st.id}:${b.st.id}` : `${b.st.id}:${m.st.id}`;
        if (done.has(key)) continue;
        done.add(key);
        const f = face(m, b, r, type), k = 0.6 + this.rand(), F = k * Math.min(A.m, B.m) * G;
        for (const p of f.pts) this.rigid.joint(A, p, B, { strength: F / f.pts.length, stretch: 0.015, normal: f.n, tire: TIRE });
      }
    }
    // Whatever was fixed to these members is fixed to the body each is in now.
    for (const m of ms) this.rigid.reanchor(m, bodyOf.get(m));
    for (const m of ms) this.#remove(m);
    this.stats.falls += ms.length; this.stats.bodies += bodies.length;
    return bodies;
  }

  // ---------------------------------------------------------------- bodies
  /** A body hit something: a crash, the blow to what it hit, and it breaks up if it hit hard enough. */
  #hit({ b, energy, speed, at }, statics) {
    if (b.removed || !b.data?.S) return;
    const D = b.data, A = b.aabb;
    if (energy > 8 && this.time - D.land > 0.25) {
      D.land = this.time;
      bus.emit('structure:land', { at, energy, speed, size: [A[3] - A[0], A[4] - A[1], A[5] - A[2]], mat: D.mat, structure: D.S.id });
    }
    // What it hit takes the blow (a floor coming down on the one below can take that too).
    const under = statics ? [...statics].filter((c) => c.st && !c.st.gone && !c.st.doomed) : [];
    if (under.length && energy > 4) {
      const touched = new Set(), p = _p.set(at[0], at[1], at[2]);
      for (const c of under) { c.st.by = D.by; touched.add(c.st.S); this.#damage(c, (energy * POUND) / under.length, p); }
      for (const S of touched) this.#settle(S);
    }
    if (this.rigid.awake.length < AWAKE_CAP) this.#shatter(b, energy / b.m, at);
  }

  /** Hit hard (e kJ a tonne): a body of many pieces breaks into a few, a big slab into chunks. */
  #shatter(b, e, at) {
    let pieces;
    if (b.boxes.length > 1) {
      if (e < 4) return;
      pieces = groups(b.boxes, Math.min(b.boxes.length, 2 + Math.floor(e / 6), 8));
    } else {
      const k = b.boxes[0], [hx, hy, hz] = k.h, long = 2 * Math.max(hx, hy, hz);
      if (e < 9 || long < 1.4 || 8 * hx * hy * hz < 0.35) return;
      const ax = hx >= hy && hx >= hz ? 0 : hy >= hz ? 1 : 2, n = e > 25 && long > 3 ? 3 : 2;
      // Cut across its length at (seeded) random places, no piece under a third of an even share.
      const cuts = [];
      for (let i = 1; i < n; i++) cuts.push((i + (this.rand() - 0.5) * 0.6) / n);
      pieces = [];
      let from = 0;
      for (const t of [...cuts, 1]) {
        const c = k.c.slice(), h = k.h.slice();
        c[ax] = k.c[ax] - k.h[ax] + 2 * k.h[ax] * (from + t) / 2;
        h[ax] = k.h[ax] * (t - from);
        pieces.push([{ c, h, rho: k.rho, meta: k.meta }]);
        from = t;
      }
    }
    const D = b.data, A = b.aabb;
    const out = this.rigid.fracture(b, pieces, { hit: (boxes) => boxes.some((k) => k.hit !== false) });
    for (const p of out) p.data = { ...D, crush: new Map(), cover: null };
    this.stats.shatters++;
    const r = 1.2;
    bus.emit('structure:break', { cover: null, fragments: [], at, hole: [Math.max(A[0], at[0] - r), Math.max(A[1], at[1] - 0.5), Math.max(A[2], at[2] - r), Math.min(A[3], at[0] + r), Math.min(A[4], at[1] + r), Math.min(A[5], at[2] + r)], mat: D.mat, structure: D.S.id, impact: true });
  }

  /** Whoever a moving body runs into: crushed by how hard it's going, shoved if it's barely moving. */
  #crush() {
    for (const b of this.rigid.awake) {
      const vb = b.v, wb = b.w;
      if (Math.hypot(vb[0], vb[1], vb[2]) + Math.hypot(wb[0], wb[1], wb[2]) * b.r < CRUSH_V) continue;
      const A = b.aabb, D = b.data;
      this.world.fightersNear?.(_p.set(b.x[0], b.x[1], b.x[2]), b.r + 1, (e) => {
        if (e.health?.dead || e.vehicle || !e.movement) return;
        const q = e.movement.state.position;
        if (q.x < A[0] - 0.4 || q.x > A[3] + 0.4 || q.z < A[2] - 0.4 || q.z > A[5] + 0.4 || q.y > A[4] + 0.2 || q.y + 1.8 < A[1]) return;
        for (const up of [0.3, 0.9, 1.5]) {
          if (!this.rigid.boxAt(b, q.x, q.y + up, q.z, 0.3)) continue;
          const v = b.velocityAt(q.x, q.y + up, q.z, _v), sp = Math.hypot(v[0], v[1], v[2]);
          if (sp < CRUSH_V || this.time - (D.crush.get(e.id) ?? -9) < 0.5) return;
          D.crush.set(e.id, this.time);
          const dmg = Math.min(5000, 0.5 * Math.min(b.m, 4) * sp * sp * CRUSH);
          e.health.damage(dmg, { kind: 'crush', noDown: dmg >= 200, from: [q.x - v[0], q.y + up - v[1], q.z - v[2]] }, this.world.entity?.(D.by) ?? null);
          this.stats.crushed++;
          return;
        }
      });
    }
  }

  /** A body at rest: rubble, cover to climb and hide behind (boxes stepped to the lie of each piece). */
  #cover(b) {
    if (b.removed || !b.asleep || b.data.cover) return;
    const out = [];
    for (const k of b.boxes) {
      if (8 * k.h[0] * k.h[1] * k.h[2] < RUBBLE_MIN) continue;   // dust
      const mat = k.meta?.mat ?? 'concrete';
      restingBoxes(k.wc, b.ax, k.h, (x0, y0, z0, x1, y1, z1) => out.push({ min: new Vector3(x0, y0, z0), max: new Vector3(x1, y1, z1), kind: 'rubble', surface: mat === 'metal' ? 'metal' : 'concrete', destructible: false, render: 'body', rubble: mat, body: b.id }));
    }
    b.data.cover = out;
    for (const r of out) {
      this.world.cover.add ? this.world.cover.add(r) : this.world.cover.push(r);
      this.dirty.push([r.min.x, r.min.z, r.max.x, r.max.z]);
      bus.emit('world:coverAdded', { cover: r, structural: true });
    }
    this.stats.rubble += out.length;
  }

  /** Moving again: no longer cover where it lay. */
  #uncover(b) {
    const out = b.data?.cover;
    if (!out) return;
    b.data.cover = null;
    for (const r of out) {
      if (this.world.cover.remove) this.world.cover.remove(r); else { const i = this.world.cover.indexOf(r); if (i >= 0) this.world.cover.splice(i, 1); }
      this.dirty.push([r.min.x, r.min.z, r.max.x, r.max.z]);
      bus.emit('world:coverDestroyed', { cover: r, center: [(r.min.x + r.max.x) / 2, (r.min.y + r.max.y) / 2, (r.min.z + r.max.z) / 2], structural: true });
      // Bodies lying on it wake up and fall.
      this.world.fightersNear?.(centerOf(r, _p), Math.max(r.max.x - r.min.x, r.max.z - r.min.z) / 2 + 1, (e) => {
        const rd = e.movement?.ragdoll, q = e.movement?.state.position;
        if (rd?.asleep && q && q.x > r.min.x - 0.5 && q.x < r.max.x + 0.5 && q.z > r.min.z - 0.5 && q.z < r.max.z + 0.5 && q.y > r.max.y - 0.6) { rd.asleep = false; rd.restT = 0; }
      });
    }
  }

  /** A blast throws the bodies it reaches (asleep or not), and weakens the joints near it. */
  #blastBodies(point, P, R) {
    const RW = this.rigid;
    for (const b of [...RW.bodies]) {
      const A = b.aabb;
      const cx = Math.max(A[0], Math.min(A[3], point.x)), cy = Math.max(A[1], Math.min(A[4], point.y)), cz = Math.max(A[2], Math.min(A[5], point.z));
      let dx = cx - point.x, dy = cy - point.y, dz = cz - point.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > R) continue;
      if (d < 0.05) { dx = b.x[0] - point.x; dy = b.x[1] - point.y; dz = b.x[2] - point.z; }
      const l = Math.hypot(dx, dy, dz) || 1, k = (1 - d / R) ** 1.5, J = Math.min(P * k * PUSH, b.m * 12);
      dx /= l; dy = dy / l + 0.35; dz /= l;
      const l2 = Math.hypot(dx, dy, dz);
      RW.push(b, { x: cx, y: cy, z: cz }, { x: (dx / l2) * J, y: (dy / l2) * J, z: (dz / l2) * J });
    }
    for (const j of RW.joints) {
      if (j.broken) continue;
      const p = j.b ? j.b.toWorld(j.lb[0], j.lb[1], j.lb[2], _w) : j.lb;
      const d = Math.hypot(p[0] - point.x, p[1] - point.y, p[2] - point.z);
      if (d < R) j.S *= 1 - 0.7 * (1 - d / R);
    }
  }

  // ---------------------------------------------------------------- per tick
  update(dt) {
    this.time += dt;
    if (this.creaking.length) {
      this.creaking.sort((a, b) => a.at - b.at);
      while (this.creaking.length && this.creaking[0].at <= this.time) { const c = this.creaking.shift(); this.#release(c.ms, c.S); }
    }
    const RW = this.rigid;
    RW.step(dt);
    // Torn: a crack, a puff of dust (a few a tick at most: a wall tearing off is one sound).
    let n = 0;
    for (const j of RW.torn) {
      this.stats.tears++;
      if (n++ >= 3 || !j.a.data) continue;
      const p = j.a.toWorld(j.la[0], j.la[1], j.la[2], _w);
      bus.emit('structure:tear', { at: [p[0], p[1], p[2]], mat: j.a.data.mat, structure: j.a.data.S?.id });
    }
    RW.torn.length = 0;
    const hits = RW.hits.splice(0);
    for (const h of hits) this.#hit(h, h.statics);
    this.#crush();
    for (const b of RW.woke) this.#uncover(b);
    for (const b of RW.slept) this.#cover(b);
    RW.woke.length = 0; RW.slept.length = 0;
    // Too many lying about: the smallest at rest go to dust.
    if (RW.bodies.length > BODY_CAP) {
      const still = RW.bodies.filter((b) => b.asleep).sort((p, q) => p.m - q.m || p.id - q.id);
      for (const b of still) { if (RW.bodies.length <= BODY_CAP * 0.9) break; this.#uncover(b); RW.remove(b); }
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
  get busy() { return this.creaking.length > 0 || this.rigid.awake.length > 0; }
}

/**
 * The face member m touched b by (contact r = [x0, z0, x1, z1, y0, y1], of `type` from m's side):
 * its area, its normal (out of b into m), and the points to fix m on at: its corners, and every
 * 3 m along it.
 */
function face(m, b, r, type) {
  const [x0, z0, x1, z1, y0, y1] = r, pts = [];
  let n, area;
  const along = (a0, a1, f) => { const k = Math.max(1, Math.ceil((a1 - a0) / 3)); for (let i = 0; i <= k; i++) f(a0 + ((a1 - a0) * i) / k); };
  if (type === 'below' || type === 'above') {
    const y = type === 'below' ? m.min.y : m.max.y;
    n = { x: 0, y: type === 'below' ? 1 : -1, z: 0 };
    area = Math.max(0.01, (x1 - x0) * (z1 - z0));
    for (const z of [z0, z1]) along(x0, x1, (x) => pts.push(new Vector3(x, y, z)));
  } else {
    const ox = x1 - x0, oz = z1 - z0, h = Math.max(0.05, y1 - y0);
    if (ox <= oz) {
      const x = (x0 + x1) / 2;
      n = { x: (m.min.x + m.max.x) / 2 >= (b.min.x + b.max.x) / 2 ? 1 : -1, y: 0, z: 0 };
      area = Math.max(0.01, oz * h);
      for (const y of [y0, y1]) along(z0, z1, (z) => pts.push(new Vector3(x, y, z)));
    } else {
      const z = (z0 + z1) / 2;
      n = { x: 0, y: 0, z: (m.min.z + m.max.z) / 2 >= (b.min.z + b.max.z) / 2 ? 1 : -1 };
      area = Math.max(0.01, ox * h);
      for (const y of [y0, y1]) along(x0, x1, (x) => pts.push(new Vector3(x, y, z)));
    }
  }
  return { b, n, area, pts };
}

/**
 * Unheld members in chunks of a few that sit together: halved along their longest spread until
 * each is at most four members and 4 m across, then split into what touches what.
 */
function chunks(ms) {
  const out = [], todo = [ms];
  while (todo.length) {
    const g = todo.pop();
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (const m of g) { x0 = Math.min(x0, m.min.x); y0 = Math.min(y0, m.min.y); z0 = Math.min(z0, m.min.z); x1 = Math.max(x1, m.max.x); y1 = Math.max(y1, m.max.y); z1 = Math.max(z1, m.max.z); }
    if (g.length > 1 && (g.length > 4 || Math.max(x1 - x0, y1 - y0, z1 - z0) > 4)) {
      const a = x1 - x0 >= y1 - y0 && x1 - x0 >= z1 - z0 ? 'x' : y1 - y0 >= z1 - z0 ? 'y' : 'z';
      const sorted = g.slice().sort((p, q) => p.min[a] + p.max[a] - q.min[a] - q.max[a] || p.st.id - q.st.id), mid = sorted.length >> 1;
      todo.push(sorted.slice(mid), sorted.slice(0, mid));
      continue;
    }
    // (Members that only sit near each other are pieces of their own.)
    const set = new Set(g), seen = new Set();
    for (const m of g) {
      if (seen.has(m)) continue;
      const part = [], q = [m];
      seen.add(m);
      while (q.length) {
        const a = q.pop();
        part.push(a);
        for (const list of [a.st.up, a.st.down, a.st.side]) for (const { b } of list) if (set.has(b) && !seen.has(b)) { seen.add(b); q.push(b); }
      }
      out.push(part);
    }
  }
  return out;
}

/** A body's boxes split into n groups that sit together (halved along their longest spread, biggest group first). */
function groups(boxes, n) {
  const out = [boxes.slice()];
  while (out.length < n) {
    let gi = 0;
    for (let i = 1; i < out.length; i++) if (out[i].length > out[gi].length) gi = i;
    const g = out[gi];
    if (g.length < 2) break;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const k of g) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], k.c[a]); hi[a] = Math.max(hi[a], k.c[a]); }
    const a = hi[0] - lo[0] >= hi[1] - lo[1] && hi[0] - lo[0] >= hi[2] - lo[2] ? 0 : hi[1] - lo[1] >= hi[2] - lo[2] ? 1 : 2;
    const sorted = g.slice().sort((p, q) => p.c[a] - q.c[a]), mid = sorted.length >> 1;
    out.splice(gi, 1, sorted.slice(0, mid), sorted.slice(mid));
  }
  return out;
}

/**
 * Cover for a box lying askew (centre c, axes: three unit rows, half sizes h): emit(x0, y0, z0, x1,
 * y1, z1) for each axis-aligned box standing in for it. Square to the world (within 10°), it's one;
 * otherwise columns over the ground it covers, each as high as the box is there, merged where they
 * match: a slab leaning on a wall is a ramp of steps you can walk up (if it isn't too steep).
 */
export function restingBoxes(c, ax, h, emit) {
  // Its half size along each of the world's axes, and how square to them it lies.
  let square = true;
  const ext = [0, 0, 0], perm = [0, 0, 0];
  for (let w = 0; w < 3; w++) {
    let best = 0;
    for (let k = 0; k < 3; k++) {
      const a = Math.abs(ax[k * 3 + w]);
      ext[w] += a * h[k];
      if (a > best) { best = a; perm[w] = k; }
    }
    if (best < 0.985) square = false;
  }
  if (square) { emit(c[0] - h[perm[0]], c[1] - h[perm[1]], c[2] - h[perm[2]], c[0] + h[perm[0]], c[1] + h[perm[1]], c[2] + h[perm[2]]); return 1; }
  let cs = Math.max(0.45, Math.max(ext[0], ext[2]) / 6), count = 0;
  for (let tries = 0; tries < 4; tries++, cs *= 1.5) {
    const nx = Math.max(1, Math.round((2 * ext[0]) / cs)), nz = Math.max(1, Math.round((2 * ext[2]) / cs));
    const sx = (2 * ext[0]) / nx, sz = (2 * ext[2]) / nz, X0 = c[0] - ext[0], Z0 = c[2] - ext[2];
    // How high the box is over the middle of each cell (its underside and top), or nothing.
    const col = (x, z) => {
      let lo = -Infinity, hi = Infinity;
      const dx = x - c[0], dz = z - c[2];
      for (let k = 0; k < 3; k++) {
        const o = ax[k * 3] * dx + ax[k * 3 + 2] * dz, u = ax[k * 3 + 1];
        if (Math.abs(u) < 1e-6) { if (Math.abs(o) > h[k]) return null; continue; }
        let t0 = (-h[k] - o) / u, t1 = (h[k] - o) / u;
        if (t0 > t1) { const t = t0; t0 = t1; t1 = t; }
        if (t0 > lo) lo = t0;
        if (t1 < hi) hi = t1;
      }
      return hi - lo > 0.05 ? [c[1] + lo, c[1] + hi] : null;
    };
    // Rows of cells along x, merged where they match; then rows merged along z.
    const runs = [];
    for (let j = 0; j < nz; j++) {
      let cur = null;
      for (let i = 0; i < nx; i++) {
        const v = col(X0 + (i + 0.5) * sx, Z0 + (j + 0.5) * sz);
        if (cur && v && Math.abs(v[0] - cur.lo) < 0.12 && Math.abs(v[1] - cur.hi) < 0.12) { cur.i1 = i; cur.lo = Math.min(cur.lo, v[0]); cur.hi = Math.max(cur.hi, v[1]); continue; }
        if (cur) runs.push(cur);
        cur = v ? { i0: i, i1: i, j0: j, j1: j, lo: v[0], hi: v[1] } : null;
      }
      if (cur) runs.push(cur);
    }
    const boxes = [];
    for (const r of runs) {
      const above = boxes.find((q) => q.j1 === r.j0 - 1 && q.i0 === r.i0 && q.i1 === r.i1 && Math.abs(q.lo - r.lo) < 0.12 && Math.abs(q.hi - r.hi) < 0.12);
      if (above) { above.j1 = r.j1; above.lo = Math.min(above.lo, r.lo); above.hi = Math.max(above.hi, r.hi); } else boxes.push(r);
    }
    if (boxes.length > 24 && tries < 3) continue;
    for (const q of boxes) { emit(X0 + q.i0 * sx, q.lo, Z0 + q.j0 * sz, X0 + (q.i1 + 1) * sx, q.hi, Z0 + (q.j1 + 1) * sz); count++; }
    return count;
  }
  return count;
}
