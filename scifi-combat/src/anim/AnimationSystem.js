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
//  * Corpses: when a fighter respawns, the body it left behind is kept as a frozen pose
//    (`corpses`, newest last, capped at `maxCorpses`) so the battlefield remembers the fight.

import { Vector3 } from 'three';
import { bus } from '../core/EventBus.js';
import { ProceduralHumanoid } from './ProceduralHumanoid.js';
import { angleDelta } from './ik.js';

const _dir = new Vector3();

export class AnimationSystem {
  /**
   * @param {object} cfg   data/animation/humanoid.json
   * @param {object} opts  { getEntity(id), groundY(x, z, nearY), surfaceAt(x, y, z), simDt, bodies: BodyContacts }
   */
  constructor(cfg, { getEntity = () => null, groundY = null, surfaceAt = null, simDt = 1 / 60, bodies = null } = {}) {
    this.cfg = cfg;
    this.getEntity = getEntity;
    this.groundY = groundY;
    this.bodies = bodies;
    this.surfaceAt = surfaceAt;
    this.simDt = simDt;
    this.rigs = new Map();     // id -> record
    this.list = [];
    this.focusId = null;
    this.frame = 0;
    this.stats = { near: 0, mid: 0, far: 0, solved: 0 };
    this.corpses = [];          // { j, F, scale, d, prop, capeInit, team, look, root, born }
    this.maxCorpses = 96;
    this.corpseLife = 90;       // seconds a body stays after its soldier redeployed
    this.time = 0;
    this.off = [
      bus.on('weapon:recoil', (e) => this.rigs.get(e.id)?.h.onEvent('weapon:recoil', e)),
      bus.on('weapon:hit', (e) => this.#hit(e.victim, e.attacker, e.damage)),
      bus.on('melee:hit', (e) => this.#hit(e.defender, e.attacker, e.damage)),
      bus.on('ability:hit', (e) => this.#hit(e.victim, e.attacker, e.damage)),
      bus.on('entity:death', (e) => this.rigs.get(e.id)?.h.onEvent('death', e)),
      bus.on('fighter:nearMiss', (e) => {
        const r = this.rigs.get(e.id);
        if (!r) return;
        const vp = r.e.movement.state.position;
        _dir.set(vp.x - e.from[0], 0, vp.z - e.from[2]);
        const l = _dir.length();
        if (l < 1e-4) return;
        r.h.onEvent('nearMiss', { dir: _dir.divideScalar(l), k: e.k });
      }),
    ];
  }

  dispose() { for (const f of this.off) f(); this.rigs.clear(); this.list.length = 0; }

  add(e) {
    if (this.rigs.has(e.id)) return this.rigs.get(e.id).h;
    const s = e.movement.state;
    const r = {
      e, slot: this.list.length,
      h: this.#rig(e),
      prevPos: s.position.clone(), prevStep: s.stepOff ?? 0, prevYaw: s.bodyYaw, prevAim: e.weapons?.aimYaw ?? s.yaw, prevPitch: e.weapons?.aimPitch ?? 0,
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

  #rig(e) {
    const h = new ProceduralHumanoid(e, this.cfg, { groundY: this.groundY, surfaceAt: this.surfaceAt, bodies: this.bodies });
    h.onCorpse = (rig) => this.#keepCorpse(rig);
    return h;
  }

  /** Freeze the body a respawning fighter leaves behind (a pose snapshot the crowd renderer can draw). */
  #keepCorpse(h) {
    const c = this.corpses.length >= this.maxCorpses ? this.corpses.shift() : {
      j: {
        pelvis: new Vector3(), neck: new Vector3(), neckTop: new Vector3(), head: new Vector3(), chestC: new Vector3(),
        hip: [new Vector3(), new Vector3()], knee: [new Vector3(), new Vector3()], ankle: [new Vector3(), new Vector3()],
        shoulder: [new Vector3(), new Vector3()], elbow: [new Vector3(), new Vector3()], hand: [new Vector3(), new Vector3()],
        footYaw: [0, 0], footPitch: [0, 0],
      },
      F: { pelvis: { r: new Vector3(), d: new Vector3(), n: new Vector3() }, chest: { r: new Vector3(), d: new Vector3(), n: new Vector3() }, head: { r: new Vector3(), d: new Vector3(), n: new Vector3() } },
      prop: { kind: null, length: 0 }, capeInit: false, root: new Vector3(),
    };
    const j = h.j;
    for (const k of ['pelvis', 'neck', 'neckTop', 'head', 'chestC']) c.j[k].copy(j[k]);
    for (const k of ['hip', 'knee', 'ankle', 'shoulder', 'elbow', 'hand']) { c.j[k][0].copy(j[k][0]); c.j[k][1].copy(j[k][1]); }
    for (let i = 0; i < 2; i++) { c.j.footYaw[i] = j.footYaw[i]; c.j.footPitch[i] = j.footPitch[i]; }
    for (const k of ['pelvis', 'chest', 'head']) { c.F[k].r.copy(h.F[k].r); c.F[k].d.copy(h.F[k].d); c.F[k].n.copy(h.F[k].n); }
    c.scale = h.scale; c.d = h.d; c.team = h.e.team; c.root.copy(j.pelvis); c.born = this.time;
    c.look = { team: h.e.team, status: null, flame: null, highlight: false, kit: h.e.look?.kit ?? null, number: h.e.look?.number ?? 0 };
    this.corpses.push(c);
  }

  get(id) { return this.rigs.get(id)?.h ?? null; }
  record(id) { return this.rigs.get(id) ?? null; }

  /** Call before every sim tick. */
  snapshot() {
    for (const r of this.list) {
      const s = r.e.movement.state;
      r.prevPos.copy(s.position);
      r.prevStep = s.stepOff ?? 0;
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
    this.time += dt;
    while (this.corpses.length && this.time - this.corpses[0].born > this.corpseLife) this.corpses.shift();
    const st = this.stats; st.near = st.mid = st.far = st.solved = 0;
    for (const r of this.list) {
      const e = r.e, s = e.movement.state;
      r.root.lerpVectors(r.prevPos, s.position, alpha);
      r.root.y += r.prevStep + ((s.stepOff ?? 0) - r.prevStep) * alpha;   // a kerb or a stair, eased (MovementController.stepOff)
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
        lag, lod, emit: lod === 0, alpha,
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
