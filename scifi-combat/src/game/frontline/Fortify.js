// Fortify: digging in. A soldier holding the dig key (H) where he stands, crouched and still,
// builds a fighting position in stages, and a line of them grows into a trench:
//
//   1. foxhole   - a pit 0.65 m deep with a thrown-up lip (prone in it: covered from everything)
//   2. sandbags  - a 2.4 m wall on the lip toward the enemy: stand to fire over it, crouch behind it
//   3. trench    - from a finished position, keep digging and a fire trench is cut to the nearest
//                  friendly position within 11 m: positions dug along a line join into a trench
//                  line over the course of a match (bots holding a line do exactly that).
//
// Everything built goes through the same paths as the map's own: the terrain is carved (the
// renderer rebuilds just those chunks, the ground turns to mud), sandbag walls are real cover
// boxes (bullets, movement, nav, the tactical map, the renderer), and blasts can knock them down.
// Each team may build `cap` positions per match (sized to the map). Sandbags cost supplies from the
// forward depot when the match has logistics (`pay`); digging is free.
// Events: fort:dig { id, stage, progress }, fort:built { team, kind, x, z, by }, fort:short { id, team }.

import { Vector3 } from 'three';
import { bus } from '../../core/EventBus.js';

const STAGE_TIME = [3.5, 4, 6];     // foxhole, sandbags, trench link (seconds of digging)
const LINK_RANGE = 11;

export class FortifySystem {
  /**
   * @param {object} world  CombatWorld (cover, nav)
   * @param {object} map    generateFrontlineMap() output (terrain)
   * @param {object} o      { cap (positions per team), tmap: TacticalMap }
   */
  constructor(world, map, { cap = 24, tmap = null } = {}) {
    this.world = world; this.map = map; this.terrain = map.terrain; this.cap = cap; this.tmap = tmap;
    this.pay = null;            // (team) -> boolean: logistics pays for the sandbags (null = free)
    this.sites = [];
    this.built = [0, 0];
    this.jobs = new Map();      // fighter id -> { site, t }
  }

  /** Positions of a team (for squads looking for a place to hold, and for tests). */
  sitesOf(team) { return this.sites.filter((s) => s.team === team); }

  /**
   * Process a soldier's dig input. Returns true while he's digging (the session kneels him:
   * no moving, shooting or casting).
   */
  handleInput(f, cmd, dt) {
    const want = !!cmd.buttons?.dig?.down;
    const st = f.movement.state;
    const job = this.jobs.get(f.id);
    const able = want && !f.vehicle && f.health.up && st.grounded && st.mode === 'ground' && Math.hypot(st.velocity.x, st.velocity.z) < 1.2;
    if (!able) { if (job) this.#cancel(f, job); return false; }
    let j = job;
    if (!j) {
      const site = this.#siteFor(f);
      if (!site) return false;
      j = { site, t: 0 };
      this.jobs.set(f.id, j);
    }
    const site = j.site;
    const stage = site.stage;
    if (stage >= 2 && !this.#linkTarget(site)) { this.#cancel(f, j); return false; }   // nothing left to dig here
    const rate = f.role === 'engineer' ? 1.5 : 1;
    j.t += dt * rate;
    const need = STAGE_TIME[Math.min(stage, 2)];
    bus.emit('fort:dig', { id: f.id, stage, progress: Math.min(1, j.t / need) });
    if (j.t >= need) {
      // Sandbags come from the forward depot: no supplies, no wall (the hole and trench are free).
      if (stage === 1 && this.pay && !this.pay(f.team)) { j.t = need; bus.emit('fort:short', { id: f.id, team: f.team }); return false; }
      j.t = 0;
      if (stage === 0) this.#foxhole(site, f);
      else if (stage === 1) this.#sandbags(site, f);
      else this.#link(site, this.#linkTarget(site), f);
    }
    return true;
  }

  #cancel(f, job) { this.jobs.delete(f.id); if (job.site.stage === 0 && !job.site.started) this.#forget(job.site); }

  /** A position abandoned before its hole was dug doesn't count against the team's cap. */
  #forget(site) { const i = this.sites.indexOf(site); if (i >= 0) { this.sites.splice(i, 1); this.built[site.team]--; } }

  /** One of the team's positions within 1.6 m of (x, z), if any. */
  siteAt(team, x, z) {
    let best = null, bd = 1.6;
    for (const s of this.sites) { if (s.team !== team) continue; const d = Math.hypot(s.x - x, s.z - z); if (d < bd) { bd = d; best = s; } }
    return best;
  }

  /**
   * Could a new position be dug at (x, z)? Under the team's cap, on fairly level ground that
   * isn't a trench already (a shallow shell hole is fine), clear of cover and of other positions.
   */
  canDig(team, x, z) {
    if (this.siteAt(team, x, z)) return true;
    if (this.built[team] >= this.cap) return false;
    const t = this.terrain;
    if (t && (t.slopeDeg(x, z) > 18 || t.undug(x, z) - t.height(x, z) > 0.5)) return false;
    if (this.sites.some((s) => Math.hypot(s.x - x, s.z - z) < 3.2)) return false;
    let blocked = false;
    this.world.coverIn(x - 1.6, z - 1.6, x + 1.6, z + 1.6, () => { blocked = true; });
    return !blocked;
  }

  /** The position a soldier works on: one of his team's within 1.6 m, or a new one where he stands. */
  #siteFor(f) {
    const p = f.movement.state.position;
    const near = this.siteAt(f.team, p.x, p.z);
    if (near) return near;
    if (!this.canDig(f.team, p.x, p.z)) return null;
    if (this.terrain && Math.abs(p.y - this.terrain.height(p.x, p.z)) > 0.3) return null;   // standing on something
    // Face the enemy's side of the map (the line runs across it).
    const face = f.team === 0 ? 1 : -1;
    const site = { team: f.team, x: p.x, z: p.z, y: p.y, stage: 0, face, links: new Set(), box: null, spot: null, started: false, id: this.sites.length };
    this.sites.push(site);
    this.built[f.team]++;
    return site;
  }

  #foxhole(site, by) {
    const t = this.terrain;
    site.started = true;
    t?.carveDisc(site.x, site.z, 1.15, 0.65, 0.22);
    site.y = t ? t.height(site.x, site.z) : site.y - 0.65;
    site.stage = 1;
    this.#settle(site.x - 2, site.z - 2, site.x + 2, site.z + 2);
    site.spot = this.tmap?.addFort?.(site) ?? null;
    bus.emit('fort:built', { team: site.team, kind: 'foxhole', x: site.x, z: site.z, by: by?.id });
  }

  #sandbags(site, by) {
    const t = this.terrain, cx = site.x + site.face * 1.05, z0 = site.z - 1.2, z1 = site.z + 1.2;
    const x0 = cx - 0.3, x1 = cx + 0.3;
    let lo = Infinity, hi = -Infinity;
    for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1], [cx, site.z]]) { const h = t ? t.height(x, z) : 0; lo = Math.min(lo, h); hi = Math.max(hi, h); }
    // Its top stands 1.45 m over the foxhole floor: fire over it standing, hidden crouched.
    const top = Math.max(hi + 0.35, site.y + 1.45);
    const box = { min: new Vector3(x0, lo - 0.25, z0), max: new Vector3(x1, top, z1), surface: 'sandbag', kind: 'fort', destructible: true, team: site.team };
    this.world.cover.add ? this.world.cover.add(box) : this.world.cover.push(box);
    site.box = box; site.stage = 2;
    this.world.nav?.updateRegion(x0 - 1, z0 - 1, x1 + 1, z1 + 1);
    bus.emit('world:coverAdded', { cover: box });
    if (site.spot) { site.spot.fire = 'over'; site.spot.h = 1.45; }
    bus.emit('fort:built', { team: site.team, kind: 'sandbags', x: site.x, z: site.z, by: by?.id });
  }

  /** The nearest friendly position this one isn't joined to yet, within LINK_RANGE. */
  #linkTarget(site) {
    let best = null, bd = LINK_RANGE;
    for (const s of this.sites) {
      if (s === site || s.team !== site.team || s.stage < 1 || site.links.has(s)) continue;
      const d = Math.hypot(s.x - site.x, s.z - site.z);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  #link(a, b, by) {
    if (!b) return;
    const t = this.terrain;
    // A zigzag in plan would be truer to life; a straight cut between two holes reads fine and
    // keeps the floor walkable on the nav grid.
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.8);
    for (let k = 0; k <= steps; k++) {
      const u = k / steps;
      t?.carveDisc(a.x + (b.x - a.x) * u, a.z + (b.z - a.z) * u, 0.9, 0.6, 0.12);
    }
    a.links.add(b); b.links.add(a);
    this.#settle(Math.min(a.x, b.x) - 2, Math.min(a.z, b.z) - 2, Math.max(a.x, b.x) + 2, Math.max(a.z, b.z) + 2);
    bus.emit('fort:built', { team: a.team, kind: 'trench', x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, from: [a.x, a.z], to: [b.x, b.z], by: by?.id });
  }

  /** Ground changed: the nav re-reads slopes there (the renderer reads terrain.dirty itself). */
  #settle(x0, z0, x1, z1) { this.world.nav?.updateRegion(x0, z0, x1, z1); }
}
