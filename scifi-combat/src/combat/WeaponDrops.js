// WeaponDrops: guns lying on the ground (simulation only; DropViews draws them). A fighter who
// dies with a gun in his hands sometimes drops it where he fell; the city's civilians also find
// guns left from earlier fighting near where they shelter (caches, placed by Neutrals). Whoever
// stands on one can take it (`take`): for a civilian, the only way he is ever armed (Teams.js).
// Guns left lying are gone after a while (picked over), the oldest first when there are too many.

import { Vector3 } from 'three';
import { bus } from '../core/EventBus.js';
import { WeaponInstance } from './weapons/WeaponSystem.js';

export class WeaponDrops {
  /**
   * @param {CombatWorld} world
   * @param {object} cfg  data/civilians.json `drops`: { chance, ttl, max }
   * @param {object} o    { recoil: recoil patterns (for the instances it hands out), seed }
   */
  constructor(world, cfg = {}, { recoil = {}, seed = 1 } = {}) {
    this.world = world; this.cfg = cfg; this.recoil = recoil;
    this.list = [];
    this.nextId = 1;
    let s = (seed * 2654435761) >>> 0 || 1;
    this.rand = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return (s % 1e6) / 1e6; };
    this.off = [bus.on('entity:death', (e) => this.#onDeath(e))];
  }

  dispose() { this.off.forEach((f) => f()); }

  #onDeath(e) {
    const v = this.world.entity(e.id), w = v?.weapons?.current;
    if (!v || v.isVehicle || v.isDeployable || !w || this.rand() > (this.cfg.chance ?? 0.6)) return;
    const p = v.movement.state.position, a = this.rand() * Math.PI * 2;
    this.drop(new Vector3(p.x + Math.cos(a) * 0.6, this.world.groundHeight?.(new Vector3(p.x, p.y + 1, p.z)) ?? p.y, p.z + Math.sin(a) * 0.6), w.s, { mag: w.mag, reserve: Math.round(w.reserve * 0.5) });
  }

  /** A gun on the ground at `pos` (spec: the weapon's stats; ammo: what's left in it). */
  drop(pos, spec, { mag = spec.mag ?? 0, reserve = spec.reserve ?? 0, ttl = this.cfg.ttl ?? 150, cache = false } = {}) {
    if (this.list.length >= (this.cfg.max ?? 60)) {
      const old = this.list.findIndex((d) => !d.cache);
      this.#remove(this.list[old >= 0 ? old : 0]);
    }
    const d = { id: this.nextId++, pos: pos.clone(), spec, mag, reserve, ttl, cache, yaw: this.rand() * Math.PI * 2 };
    this.list.push(d);
    bus.emit('drop:spawn', { id: d.id, at: d.pos.toArray(), weapon: spec.id, archetype: spec.archetype ?? null });
    return d;
  }

  /** The nearest gun within r of p (on about the same level), or null. */
  nearest(p, r, filter = null) {
    let best = null, bd = r;
    for (const d of this.list) {
      if (filter && !filter(d)) continue;
      const dd = Math.hypot(d.pos.x - p.x, d.pos.z - p.z);
      if (dd < bd && Math.abs(d.pos.y - p.y) < 1.6) { bd = dd; best = d; }
    }
    return best;
  }

  /**
   * Take a gun off the ground: it goes into e's hands (his loadout, made current). Only within
   * reach (1.5 m), only a fighter with hands free of nothing better.
   */
  take(e, d) {
    if (!d || !this.list.includes(d) || !e.weapons || e.health?.dead) return false;
    const p = e.movement.state.position;
    if (Math.hypot(d.pos.x - p.x, d.pos.z - p.z) > 1.5 || Math.abs(d.pos.y - p.y) > 1.6) return false;
    const inst = new WeaponInstance(d.spec, this.recoil);
    inst.mag = d.mag; inst.reserve = d.reserve;
    const W = e.weapons;
    if (W.loadout.length >= 2) W.loadout[W.index] = inst; else W.loadout.push(inst);
    W.index = W.loadout.indexOf(inst);
    W.phase = 'ready'; W.cooldown = 0.4;
    e.mode = 'gun';
    this.#remove(d);
    bus.emit('drop:taken', { id: d.id, by: e.id, weapon: d.spec.id });
    return true;
  }

  #remove(d) {
    const i = this.list.indexOf(d);
    if (i < 0) return;
    this.list.splice(i, 1);
    bus.emit('drop:gone', { id: d.id });
  }

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const d = this.list[i];
      if (d.cache) continue;
      d.ttl -= dt;
      if (d.ttl <= 0) this.#remove(d);
    }
  }
}
