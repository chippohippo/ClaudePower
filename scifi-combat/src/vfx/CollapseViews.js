// CollapseViews: buildings coming apart (Structures.js), as you see them.
//  * A piece that falls is drawn falling: a wall topples about its foot and lies flat, a slab drops
//    with a wobble, both gathering speed as they go, until the rubble it becomes takes over where
//    it lands (CityRenderer draws that). The piece's own instance is gone from its mesh by then.
//  * Dust and debris (BattleFx): chips off a wall a blast didn't break, chunks thrown from a hole,
//    a trickle where a building is about to go, and a cloud rolling out where each piece lands.
// Presentation only: timed by the frame, starting from the sim's events.

import * as THREE from 'three';
import { bus } from '../core/EventBus.js';

const MAX = 256;
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color(), _ax = new THREE.Vector3();
const X = new THREE.Vector3(1, 0, 0), Z = new THREE.Vector3(0, 0, 1);

export class CollapseViews {
  /**
   * @param {THREE.Scene} scene
   * @param {object} o { fx: BattleFx, colorOf(box): the colour it's drawn in (CityRenderer.colorOf) }
   */
  constructor(scene, { fx = null, colorOf = () => '#77736c' } = {}) {
    this.fx = fx; this.colorOf = colorOf;
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.92 }), MAX);
    this.mesh.count = 0;
    this.mesh.setColorAt(0, _c.set('#777777'));
    this.mesh.castShadow = true; this.mesh.receiveShadow = true; this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.falling = [];        // { i, from: {min, max}, to: [x0, y0, z0, x1, y1, z1], topple, T, t, spin }
    this.free = [];
    this.n = 0;
    this.off = [
      bus.on('structure:fall', (e) => this.#fall(e)),
      bus.on('structure:break', (e) => this.fx?.crumble?.(e.at, e.hole, e.mat, e.fragments.length === 0)),
      bus.on('structure:land', (e) => this.fx?.collapseDust?.(e.at, e.size, e.energy, e.mat)),
      bus.on('structure:creak', (e) => this.fx?.trickle?.(e.at, e.n)),
      bus.on('structure:hit', (e) => this.fx?.chips?.(e.at, e.mat)),
    ];
  }

  dispose() { this.off.forEach((f) => f()); this.mesh.removeFromParent(); }

  #fall(e) {
    const b = e.cover;
    const i = this.free.length ? this.free.pop() : this.n < MAX ? this.n++ : -1;
    if (i < 0) return;
    this.mesh.count = this.n;
    this.mesh.setColorAt(i, _c.set(this.colorOf(b)));
    this.mesh.instanceColor.needsUpdate = true;
    const h = b.min.x * 12.9898 + b.min.z * 78.233;
    this.falling.push({ i, from: { min: b.min.clone(), max: b.max.clone() }, to: e.to, topple: e.topple, T: Math.max(0.2, e.time), t: 0, spin: (Math.sin(h) * 43758.5453) % 1 });
  }

  update(dt) {
    if (!this.falling.length) return;
    for (let k = this.falling.length - 1; k >= 0; k--) {
      const f = this.falling[k];
      f.t += dt;
      const u = Math.min(1, f.t / f.T), g = u * u;           // falling: gathering speed
      const { min, max } = f.from, sx = max.x - min.x, sy = max.y - min.y, sz = max.z - min.z;
      const drop = Math.max(0, min.y - f.to[1]);
      if (f.topple) {
        // About its foot on the side it falls to, the foot itself coming down as far as it has to.
        const { axis, dir } = f.topple, along = axis === 'x';
        const px = along ? (dir > 0 ? max.x : min.x) : (min.x + max.x) / 2, pz = along ? (min.z + max.z) / 2 : (dir > 0 ? max.z : min.z), py = min.y - drop * g;
        const ang = (Math.PI / 2) * g;
        _ax.copy(along ? Z : X);
        _q.setFromAxisAngle(_ax, along ? -dir * ang : dir * ang);
        // The centre, from the foot: half its thickness back, half its height up; turned with it.
        _p.set(along ? -dir * sx / 2 : 0, sy / 2, along ? 0 : -dir * sz / 2).applyQuaternion(_q).add(_s.set(px, py, pz));
      } else {
        // Straight down, with a wobble that settles as it lands flat.
        const w = Math.sin(Math.PI * u) * 0.12 * (f.spin - 0.5) * 2;
        _q.setFromAxisAngle(_ax.set(Math.cos(f.spin * 6.28), 0, Math.sin(f.spin * 6.28)), w);
        _p.set((min.x + max.x) / 2, (min.y + max.y) / 2 - drop * g, (min.z + max.z) / 2);
      }
      this.mesh.setMatrixAt(f.i, _m.compose(_p, _q, _s.set(sx, sy, sz)));
      if (u >= 1) {
        this.mesh.setMatrixAt(f.i, ZERO);
        this.free.push(f.i);
        this.falling.splice(k, 1);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
