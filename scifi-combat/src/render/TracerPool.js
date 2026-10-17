// TracerPool: every hitscan tracer and live projectile of a 128-player battle in two instanced
// draw calls, with zero allocation per shot (the arena demo's one-mesh-per-shot would melt).
//  * Tracers are short glowing streaks that travel the shot's path at tracer speed, colored by
//    the shooter's team (Solari amber, Void violet), so fire direction reads across the map.
//  * Projectiles (bolts, grenades, rockets) are glowing spheres following their sim position.

import * as THREE from 'three';
import { bus } from '../core/EventBus.js';

const TEAM = [new THREE.Color('#ffc46b'), new THREE.Color('#b98cff')];
const _m = new THREE.Matrix4();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _p = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class TracerPool {
  /**
   * @param {THREE.Scene} scene
   * @param {object} o { max, getEntity(id) -> { team }, speed (m/s), streak (m) }
   */
  constructor(scene, { max = 600, getEntity = () => null, speed = 450, streak = 7 } = {}) {
    this.max = max; this.getEntity = getEntity; this.speed = speed; this.streak = streak;
    const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.tracerMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5), mat, max);
    this.boltMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), mat.clone(), 256);
    for (const m of [this.tracerMesh, this.boltMesh]) { m.frustumCulled = false; m.count = 0; m.setColorAt(0, TEAM[0]); m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(m); }
    // Ring buffer of tracers: { ox, oy, oz, dx, dy, dz, dist, t, team }
    this.tracers = Array.from({ length: max }, () => ({ o: new THREE.Vector3(), d: new THREE.Vector3(), dist: 0, t: 0, life: 0, team: 0, live: false }));
    this.head = 0;
    this.bolts = new Set();
    this.off = [
      bus.on('weapon:tracer', (e) => this.#tracer(e)),
      bus.on('projectile:spawn', (e) => this.bolts.add(e.ref)),
    ];
  }

  dispose() { this.off.forEach((f) => f()); }

  #tracer(e) {
    const t = this.tracers[this.head];
    this.head = (this.head + 1) % this.max;
    t.o.fromArray(e.from); t.d.fromArray(e.dir);
    t.dist = Math.max(1, e.dist ?? 100);
    t.t = 0; t.life = t.dist / this.speed + 0.03; t.live = true;
    t.team = this.getEntity(e.id)?.team ?? 0;
  }

  update(dt) {
    let n = 0;
    for (const t of this.tracers) {
      if (!t.live) continue;
      t.t += dt;
      if (t.t > t.life) { t.live = false; continue; }
      // A streak travelling down the path: head at speed * t, tail a streak behind it.
      const head = Math.min(t.dist, this.speed * t.t), tail = Math.max(0, head - this.streak);
      const len = head - tail;
      if (len <= 0.01) continue;
      _z.copy(t.d).multiplyScalar(len);
      _x.crossVectors(t.d, UP);
      if (_x.lengthSq() < 1e-6) _x.set(1, 0, 0);
      _x.normalize().multiplyScalar(0.035);
      _y.crossVectors(_z, _x).normalize().multiplyScalar(0.035);
      _p.copy(t.o).addScaledVector(t.d, tail);
      _m.makeBasis(_x, _y, _z).setPosition(_p);
      this.tracerMesh.setMatrixAt(n, _m);
      this.tracerMesh.setColorAt(n, TEAM[t.team] ?? TEAM[0]);
      n++;
    }
    this.tracerMesh.count = n;
    this.tracerMesh.instanceMatrix.needsUpdate = true;
    if (this.tracerMesh.instanceColor) this.tracerMesh.instanceColor.needsUpdate = true;
    let b = 0;
    for (const ref of this.bolts) {
      if (!ref.alive) { this.bolts.delete(ref); continue; }
      if (b >= 256) continue;
      const r = ref.spec?.highFly ? 0.32 : ref.spec?.splash ? 0.16 : 0.09;   // shells and rockets read across the sky
      _m.makeScale(r, r, r).setPosition(ref.pos);
      this.boltMesh.setMatrixAt(b, _m);
      this.boltMesh.setColorAt(b, TEAM[ref.team] ?? TEAM[0]);
      b++;
    }
    this.boltMesh.count = b;
    this.boltMesh.instanceMatrix.needsUpdate = true;
    if (this.boltMesh.instanceColor) this.boltMesh.instanceColor.needsUpdate = true;
  }
}
