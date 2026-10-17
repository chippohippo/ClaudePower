// TracerPool: every hitscan tracer and live projectile of a 128-player battle in two instanced
// draw calls, with zero allocation per shot (the arena demo's one-mesh-per-shot would melt).
//  * Tracers are glowing streaks that travel the shot's path at tracer speed: ribbons turned to
//    face the camera, a white-hot core in a coloured glow, fading toward the tail. Coloured by the
//    shooter's team (Solari amber, Void violet), so fire direction reads across the map; a planet
//    can make them laser bolts instead (palette.json `fx.bolts`: slower, thicker, shorter, blue
//    for your side and red for the enemy's).
//  * A tracer leaves the shooter's muzzle when it can be found (`muzzle`: the rig's gun), so a
//    third-person shot doesn't come out of the head; it still ends where the sim's ray hit.
//  * Projectiles (bolts, grenades, rockets) are glowing spheres following their sim position.

import * as THREE from 'three';
import { bus } from '../core/EventBus.js';

const TEAM = [new THREE.Color('#ffc46b'), new THREE.Color('#b98cff')];
const _m = new THREE.Matrix4(), _p = new THREE.Vector3();

const VERT = /* glsl */ `
attribute vec4 aA;      // tail xyz, half width
attribute vec4 aB;      // head xyz, brightness
attribute vec3 aC;      // colour
varying vec2 vQ;
varying vec3 vC;
varying float vK;
void main() {
  vec3 p = mix(aA.xyz, aB.xyz, position.x);
  vec3 s = cross(aB.xyz - aA.xyz, p - cameraPosition);
  float l = length(s);
  p += (l > 1e-5 ? s / l : vec3(1.0, 0.0, 0.0)) * position.y * aA.w;
  vQ = position.xy; vC = aC; vK = aB.w;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const FRAG = /* glsl */ `
varying vec2 vQ;
varying vec3 vC;
varying float vK;
void main() {
  float r = abs(vQ.y);
  float core = smoothstep(0.38, 0.0, r), glow = (1.0 - r) * (1.0 - r);
  float along = smoothstep(0.0, 0.7, vQ.x);                     // the tail fades out
  gl_FragColor = vec4((vC * glow * 1.8 + mix(vC, vec3(1.0), 0.6) * core * 0.9) * along * vK, 1.0);   // the team's colour, a paler core
}`;

export class TracerPool {
  /**
   * @param {THREE.Scene} scene
   * @param {object} o { max, getEntity(id) -> { team }, speed (m/s), streak (m), width (m),
   *                    look: a planet's `fx.bolts` { speed, streak, width, friendly, enemy, neutral },
   *                    localTeam (whose side is "friendly"), muzzle(id, outVec3) -> bool }
   */
  constructor(scene, { max = 600, getEntity = () => null, speed = 450, streak = 7, width = 0.06, look = null, localTeam = 0, muzzle = null } = {}) {
    this.max = max; this.getEntity = getEntity; this.muzzle = muzzle;
    this.speed = look?.speed ?? speed; this.streak = look?.streak ?? streak; this.width = look?.width ?? width;
    this.glow = look?.glow ?? 1.6;
    // Colours by team: the factions', or friend and foe from where you stand; a civilian's
    // neutral, a gang's the enemy's (they're everyone's).
    const F = look?.friendly && new THREE.Color(look.friendly), E = look?.enemy && new THREE.Color(look.enemy);
    this.colors = F && E ? (localTeam === 0 ? [F, E] : [E, F]) : [...TEAM];
    this.colors[2] = new THREE.Color(look?.neutral ?? '#ffd98a');
    this.colors[3] = E ?? new THREE.Color('#ff5a3a');

    const quad = new THREE.InstancedBufferGeometry();
    quad.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 0, 1, 0, 1, 1, 0], 3));
    quad.setIndex([0, 1, 2, 2, 1, 3]);
    const F32 = Float32Array, dyn = (n, k) => new THREE.InstancedBufferAttribute(new F32(n * k), k).setUsage(THREE.DynamicDrawUsage);
    this.aA = dyn(max, 4); this.aB = dyn(max, 4); this.aC = dyn(max, 3);
    quad.setAttribute('aA', this.aA); quad.setAttribute('aB', this.aB); quad.setAttribute('aC', this.aC);
    quad.instanceCount = 0;
    this.tracerGeo = quad;
    this.tracerMesh = new THREE.Mesh(quad, new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    this.tracerMesh.frustumCulled = false;
    this.tracerMesh.renderOrder = 4;
    const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.boltMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), mat, 256);
    this.boltMesh.frustumCulled = false; this.boltMesh.count = 0;
    this.boltMesh.setColorAt(0, this.colors[0]); this.boltMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.tracerMesh, this.boltMesh);
    // Ring buffer of tracers: start (the muzzle), direction, length, age.
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
    const dist = Math.max(1, e.dist ?? 100);
    // From the gun's muzzle to where the ray hit.
    if (this.muzzle?.(e.id, _p)) {
      const end = t.o.addScaledVector(t.d, dist);
      t.d.subVectors(end, _p);
      t.dist = Math.max(0.5, t.d.length());
      t.d.divideScalar(t.dist);
      t.o.copy(_p);
    } else t.dist = dist;
    t.t = 0; t.life = t.dist / this.speed + 0.03; t.live = true;
    t.team = this.getEntity(e.id)?.team ?? 0;
  }

  update(dt) {
    let n = 0;
    const A = this.aA.array, B = this.aB.array, C = this.aC.array, w = this.width;
    for (const t of this.tracers) {
      if (!t.live) continue;
      t.t += dt;
      if (t.t > t.life) { t.live = false; continue; }
      // A streak travelling down the path: head at speed * t, tail a streak behind it.
      const head = Math.min(t.dist, this.speed * t.t), tail = Math.max(0, head - this.streak);
      if (head - tail <= 0.01) continue;
      const o = t.o, d = t.d, c = this.colors[t.team] ?? this.colors[0], i4 = n * 4, i3 = n * 3;
      A[i4] = o.x + d.x * tail; A[i4 + 1] = o.y + d.y * tail; A[i4 + 2] = o.z + d.z * tail; A[i4 + 3] = w;
      B[i4] = o.x + d.x * head; B[i4 + 1] = o.y + d.y * head; B[i4 + 2] = o.z + d.z * head; B[i4 + 3] = this.glow;
      C[i3] = c.r; C[i3 + 1] = c.g; C[i3 + 2] = c.b;
      n++;
    }
    this.tracerGeo.instanceCount = n;
    this.aA.needsUpdate = this.aB.needsUpdate = this.aC.needsUpdate = true;
    let b = 0;
    for (const ref of this.bolts) {
      if (!ref.alive) { this.bolts.delete(ref); continue; }
      if (b >= 256) continue;
      const r = ref.spec?.highFly ? 0.32 : ref.spec?.splash ? 0.16 : 0.09;   // shells and rockets read across the sky
      _m.makeScale(r, r, r).setPosition(ref.pos);
      this.boltMesh.setMatrixAt(b, _m);
      this.boltMesh.setColorAt(b, this.colors[ref.team] ?? this.colors[0]);
      b++;
    }
    this.boltMesh.count = b;
    this.boltMesh.instanceMatrix.needsUpdate = true;
    if (this.boltMesh.instanceColor) this.boltMesh.instanceColor.needsUpdate = true;
  }

  /** Tracers in flight (tests, the HUD's debug line). */
  get count() { return this.tracerGeo.instanceCount; }
}
