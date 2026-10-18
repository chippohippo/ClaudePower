// CollapseViews: buildings coming apart (Structures.js), as you see them.
//  * Every body that came off a building (physics/RigidWorld.js), falling, swinging on what still
//    holds it, tumbling, or lying as rubble, is drawn box by box at its pose, blended between the
//    sim's last two ticks (so it moves smoothly on any screen), in the colour of the piece it came
//    from, a little dustier. The piece's own instance is gone from its building's mesh by then.
//  * Dust and debris (BattleFx): chips off a wall a blast didn't break, chunks thrown from a hole
//    or where a piece smashes, a trickle where a building is about to go, a puff where a joint
//    tears, and a cloud rolling out where a piece lands.
// Presentation only: it reads the bodies, and times its effects by the frame.

import * as THREE from 'three';
import { bus } from '../core/EventBus.js';
import { concreteTexture, triplanar } from '../render/CoverTextures.js';
import { snowCover } from '../render/SnowCover.js';

const MAX = 3000;
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const DUST = new THREE.Color('#8a857c');
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _o = new THREE.Vector3(), _c = new THREE.Color();

export class CollapseViews {
  /**
   * @param {THREE.Scene} scene
   * @param {object} o { fx: BattleFx, colorOf(box): the colour it's drawn in (CityRenderer.colorOf),
   *   rigid: the structures' RigidWorld, snow: the planet's snow (it settles on rubble too) }
   */
  constructor(scene, { fx = null, colorOf = () => '#77736c', rigid = null, snow = null, anisotropy = 4 } = {}) {
    this.fx = fx; this.colorOf = colorOf; this.rigid = rigid;
    const tex = concreteTexture(); tex.anisotropy = anisotropy;
    const mat = triplanar(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95 }), tex, 0.4, 0.5);
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), snow ? snowCover(mat, snow) : mat, MAX);
    this.mesh.count = 0;
    this.mesh.setColorAt(0, _c.set('#777777'));
    this.mesh.castShadow = true; this.mesh.receiveShadow = true; this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.slots = new Map();          // body -> { i: its boxes' instances, still: drawn at rest }
    this.free = [];
    this.n = 0;
    this.version = -1;
    this.off = [
      bus.on('structure:break', (e) => this.fx?.crumble?.(e.at, e.hole, e.mat, e.fragments.length === 0)),
      bus.on('structure:land', (e) => this.fx?.collapseDust?.(e.at, e.size, e.energy, e.mat)),
      bus.on('structure:creak', (e) => this.fx?.trickle?.(e.at, e.n)),
      bus.on('structure:tear', (e) => this.fx?.trickle?.(e.at, 2)),
      bus.on('structure:hit', (e) => this.fx?.chips?.(e.at, e.mat)),
    ];
  }

  dispose() { this.off.forEach((f) => f()); this.mesh.removeFromParent(); }

  /** How many bodies are drawn, and how many of them moving. */
  get drawn() { let n = 0, moving = 0; for (const [b] of this.slots) { n++; if (!b.asleep) moving++; } return { n, moving }; }

  /** Bodies made and gone since the last look: instances for the new ones, the gone ones' freed. */
  #sync() {
    const R = this.rigid, mesh = this.mesh;
    for (const [b, s] of this.slots) {
      if (!b.removed) continue;
      for (const i of s.i) { mesh.setMatrixAt(i, ZERO); this.free.push(i); }
      this.slots.delete(b);
    }
    for (const b of R.bodies) {
      if (this.slots.has(b)) continue;
      const ids = [];
      for (const k of b.boxes) {
        const i = this.free.length ? this.free.pop() : this.n < MAX ? this.n++ : -1;
        if (i < 0) break;
        ids.push(i);
        mesh.setColorAt(i, _c.set(this.colorOf(k.meta?.src ?? { kind: 'rubble', min: { x: b.x[0], z: b.x[2] } })).lerp(DUST, 0.22));
      }
      this.slots.set(b, { i: ids, still: false });
    }
    mesh.count = this.n;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.version = R.version;
  }

  /** @param {number} alpha how far the sim is from its last tick to the next (FixedLoop) */
  update(dt, alpha = 1) {
    const R = this.rigid;
    if (!R) return;
    if (R.version !== this.version) this.#sync();
    let dirty = this.version !== this.drawnVersion;
    for (const [b, s] of this.slots) {
      if (b.asleep && s.still) continue;
      const a = b.asleep ? 1 : alpha;
      _p.set(b.rx[0] + (b.x[0] - b.rx[0]) * a, b.rx[1] + (b.x[1] - b.rx[1]) * a, b.rx[2] + (b.x[2] - b.rx[2]) * a);
      _q.set(b.rq[0], b.rq[1], b.rq[2], b.rq[3]).slerp(_q2.set(b.q[0], b.q[1], b.q[2], b.q[3]), a);
      for (let k = 0; k < s.i.length; k++) {
        const bx = b.boxes[k];
        _o.set(bx.c[0], bx.c[1], bx.c[2]).applyQuaternion(_q).add(_p);
        this.mesh.setMatrixAt(s.i[k], _m.compose(_o, _q, _s.set(2 * bx.h[0], 2 * bx.h[1], 2 * bx.h[2])));
      }
      s.still = b.asleep;
      dirty = true;
    }
    this.drawnVersion = this.version;
    if (dirty) this.mesh.instanceMatrix.needsUpdate = true;
  }
}
