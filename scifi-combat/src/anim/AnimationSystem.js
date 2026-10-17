// AnimationSystem: one rig per fighter, scheduled for 64-128 players. Presentation only.
//
//  * Interpolation: snapshot() before each sim tick keeps the previous root, body yaw and weapon
//    aim. update() renders between that and the current sim state (render alpha), and hands the
//    rigs the matching lag for sim timers, so poses and positions agree on high-refresh screens.
//  * LOD by distance from the camera: near rigs solve every frame and emit footstep, impact and
//    cloth events; mid rigs solve every `midInterval` frames with no events or cape; far fighters
//    get no pose at all (CrowdRenderer draws an impostor). The followed fighter is always near.
//  * Event routing: a single bus listener per event type looks the rig up by id (O(1)), instead
//    of every rig subscribing to everything.

import { Vector3 } from 'three';
import { bus } from '../core/EventBus.js';
import { ProceduralHumanoid } from './ProceduralHumanoid.js';
import { angleDelta } from './ik.js';

const _dir = new Vector3();

export class AnimationSystem {
  /**
   * @param {object} cfg   data/animation/humanoid.json
   * @param {object} opts  { getEntity(id), groundY(x, z), surfaceAt(x, y, z), simDt }
   */
  constructor(cfg, { getEntity = () => null, groundY = null, surfaceAt = null, simDt = 1 / 60 } = {}) {
    this.cfg = cfg;
    this.getEntity = getEntity;
    this.groundY = groundY;
    this.surfaceAt = surfaceAt;
    this.simDt = simDt;
    this.rigs = new Map();     // id -> record
    this.list = [];
    this.focusId = null;
    this.frame = 0;
    this.stats = { near: 0, mid: 0, far: 0, solved: 0 };
    this.off = [
      bus.on('weapon:recoil', (e) => this.rigs.get(e.id)?.h.onEvent('weapon:recoil', e)),
      bus.on('weapon:hit', (e) => this.#hit(e.victim, e.attacker, e.damage)),
      bus.on('melee:hit', (e) => this.#hit(e.defender, e.attacker, e.damage)),
      bus.on('ability:hit', (e) => this.#hit(e.victim, e.attacker, e.damage)),
      bus.on('entity:death', (e) => this.rigs.get(e.id)?.h.onEvent('death', e)),
    ];
  }

  dispose() { for (const f of this.off) f(); this.rigs.clear(); this.list.length = 0; }

  add(e) {
    if (this.rigs.has(e.id)) return this.rigs.get(e.id).h;
    const s = e.movement.state;
    const r = {
      e, slot: this.list.length,
      h: new ProceduralHumanoid(e, this.cfg, { groundY: this.groundY, surfaceAt: this.surfaceAt }),
      prevPos: s.position.clone(), prevYaw: s.bodyYaw, prevAim: e.weapons?.aimYaw ?? s.yaw, prevPitch: e.weapons?.aimPitch ?? 0,
      root: s.position.clone(), lod: 0, dist: 0, acc: 0,
    };
    this.rigs.set(e.id, r);
    this.list.push(r);
    return r.h;
  }

  remove(id) {
    const r = this.rigs.get(id);
    if (!r) return;
    this.rigs.delete(id);
    this.list.splice(this.list.indexOf(r), 1);
  }

  get(id) { return this.rigs.get(id)?.h ?? null; }
  record(id) { return this.rigs.get(id) ?? null; }

  /** Call before every sim tick. */
  snapshot() {
    for (const r of this.list) {
      const s = r.e.movement.state;
      r.prevPos.copy(s.position);
      r.prevYaw = s.bodyYaw;
      r.prevAim = r.e.weapons?.aimYaw ?? s.yaw;
      r.prevPitch = r.e.weapons?.aimPitch ?? 0;
    }
  }

  /**
   * @param {number} dt      render frame time
   * @param {number} alpha   render interpolation between the last two sim ticks (0..1)
   * @param {Vector3} camPos camera position for LOD (null = everything near)
   */
  update(dt, alpha = 1, camPos = null) {
    const L = this.cfg.lod, lag = (1 - alpha) * this.simDt;
    this.frame++;
    const st = this.stats; st.near = st.mid = st.far = st.solved = 0;
    for (const r of this.list) {
      const e = r.e, s = e.movement.state;
      r.root.lerpVectors(r.prevPos, s.position, alpha);
      r.dist = camPos ? r.root.distanceTo(camPos) : 0;
      const lod = e.id === this.focusId ? 0 : r.dist < L.near ? 0 : r.dist < L.mid ? 1 : 2;
      if (lod === 2) { r.lod = 2; r.acc = 0; st.far++; continue; }
      if (r.lod === 2) r.h.resync();   // coming back from impostor: start from a clean pose
      r.lod = lod;
      r.acc += dt;
      if (lod === 1) { st.mid++; if ((this.frame + r.slot) % L.midInterval !== 0) continue; } else st.near++;
      const yaw = r.prevYaw + angleDelta(r.prevYaw, s.bodyYaw) * alpha;
      const aimNow = e.weapons?.aimYaw ?? s.yaw, pitchNow = e.weapons?.aimPitch ?? 0;
      r.h.update(Math.min(r.acc, 0.1), r.root, {
        yaw, aimYaw: r.prevAim + angleDelta(r.prevAim, aimNow) * alpha, aimPitch: r.prevPitch + (pitchNow - r.prevPitch) * alpha,
        lag, lod, emit: lod === 0,
      });
      r.acc = 0;
      st.solved++;
    }
  }

  #hit(victimId, attackerId, damage) {
    const r = this.rigs.get(victimId);
    if (!r) return;
    const vp = r.e.movement.state.position;
    const a = this.getEntity(attackerId);
    const ap = a?.movement?.state?.position;
    if (ap) _dir.set(vp.x - ap.x, 0, vp.z - ap.z); else _dir.set(Math.sin(this.frame), 0, Math.cos(this.frame));
    const l = _dir.length();
    if (l < 1e-4) _dir.set(0, 0, 1); else _dir.divideScalar(l);
    r.h.onEvent('hit', { dir: _dir, damage });
  }
}
