// BattleFx: the battle's fire, dirt and smoke. Presentation only: it reads sim events and the
// projectiles in flight, and never writes back.
//  * Two pooled, instanced billboard particle systems: additive glow (flashes, fireballs, rocket
//    exhaust) and alpha-blended matter (dirt, smoke, dust), with the scene's fog. Two draw calls
//    for the whole battle and no allocation per effect.
//  * Effects:
//      - artillery:impact: flash, fireball, a column of dirt thrown up and falling back, and a
//        smoke plume that drifts for seconds (smaller for rockets);
//      - projectile:explode (grenades, tank shells, bombs): a flash and a puff;
//      - gun:fire: the muzzle blast and its smoke ring, the dust kicked up around the gun; a
//        rocket salvo's launch flare and billowing smoke;
//      - shells and rockets in the air: a faint smoke trail behind every shell, and for rockets a
//        bright exhaust and a thick trail. Artillery can be followed across the sky.
//      - stratagems: a smoke screen's clouds (stratagem:smoke), billowing for as long as the sim
//        blocks sight through them and thinning out as it stops; a drop pod's trail of fire on the
//        way down (reentry, called by StratagemViews) and the dust it throws up landing.

import * as THREE from 'three';
import { bus } from '../core/EventBus.js';

const VERT = /* glsl */ `
  attribute vec3 iPos;
  attribute float iSize;
  attribute vec4 iColor;
  varying vec4 vColor;
  varying vec2 vUv;
  varying float vDepth;
  void main() {
    vColor = iColor;
    vUv = position.xy;
    vec4 mv = viewMatrix * vec4(iPos, 1.0);
    mv.xy += position.xy * iSize;
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;
const FRAG = /* glsl */ `
  uniform vec3 fogColor;
  uniform float fogNear;
  uniform float fogFar;
  uniform float fogDensity;
  uniform float soft;
  varying vec4 vColor;
  varying vec2 vUv;
  varying float vDepth;
  void main() {
    float r = length(vUv) * 2.0;
    if (r > 1.0) discard;
    float a = vColor.a * pow(1.0 - r, soft);
    vec3 c = vColor.rgb;
    float f = fogDensity > 0.0 ? 1.0 - exp(-fogDensity * vDepth) : smoothstep(fogNear, fogFar, vDepth);
    c = mix(c, fogColor, f * (1.0 - soft * 0.0));
    gl_FragColor = vec4(c, a * (1.0 - f * 0.6));
  }`;

/** One pool of particles drawn in one instanced call. */
class Pool {
  constructor(scene, max, additive) {
    this.max = max; this.n = 0;
    const F = Float32Array;
    this.p = new F(max * 3); this.v = new F(max * 3); this.life = new F(max); this.age = new F(max);
    this.s0 = new F(max); this.s1 = new F(max); this.c0 = new F(max * 4); this.c1 = new F(max * 4);
    this.drag = new F(max); this.grav = new F(max);
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index; geo.setAttribute('position', quad.getAttribute('position'));
    this.aPos = new THREE.InstancedBufferAttribute(new F(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.InstancedBufferAttribute(new F(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(new F(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', this.aPos); geo.setAttribute('iSize', this.aSize); geo.setAttribute('iColor', this.aCol);
    geo.instanceCount = 0;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { fogColor: { value: new THREE.Color('#9fb3c8') }, fogNear: { value: 90 }, fogFar: { value: 520 }, fogDensity: { value: 0 }, soft: { value: additive ? 1.6 : 0.7 } },
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 3 : 2;
    this.geo = geo;
    scene.add(this.mesh);
  }

  /** Add a particle (drops the oldest-looking one when full: the pool never grows). */
  add(x, y, z, vx, vy, vz, life, s0, s1, c0, c1, drag = 0, grav = 0) {
    let i = this.n;
    if (i >= this.max) i = (Math.random() * this.max) | 0; else this.n++;
    const i3 = i * 3, i4 = i * 4;
    this.p[i3] = x; this.p[i3 + 1] = y; this.p[i3 + 2] = z;
    this.v[i3] = vx; this.v[i3 + 1] = vy; this.v[i3 + 2] = vz;
    this.life[i] = life; this.age[i] = 0; this.s0[i] = s0; this.s1[i] = s1;
    for (let k = 0; k < 4; k++) { this.c0[i4 + k] = c0[k]; this.c1[i4 + k] = c1[k]; }
    this.drag[i] = drag; this.grav[i] = grav;
  }

  update(dt) {
    let n = this.n;
    const P = this.aPos.array, S = this.aSize.array, C = this.aCol.array;
    for (let i = 0; i < n; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        // Swap the last live particle into this slot.
        n--;
        if (i !== n) this.#move(n, i);
        i--;
        continue;
      }
      const i3 = i * 3, i4 = i * 4, k = Math.exp(-this.drag[i] * dt);
      this.v[i3] *= k; this.v[i3 + 1] = this.v[i3 + 1] * k - this.grav[i] * dt; this.v[i3 + 2] *= k;
      this.p[i3] += this.v[i3] * dt; this.p[i3 + 1] += this.v[i3 + 1] * dt; this.p[i3 + 2] += this.v[i3 + 2] * dt;
      const u = this.age[i] / this.life[i];
      P[i3] = this.p[i3]; P[i3 + 1] = this.p[i3 + 1]; P[i3 + 2] = this.p[i3 + 2];
      S[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * Math.sqrt(u);
      for (let c = 0; c < 4; c++) C[i4 + c] = this.c0[i4 + c] + (this.c1[i4 + c] - this.c0[i4 + c]) * u;
    }
    this.n = n;
    this.geo.instanceCount = n;
    this.aPos.needsUpdate = this.aSize.needsUpdate = this.aCol.needsUpdate = true;
    this.aPos.addUpdateRange?.(0, n * 3); this.aSize.addUpdateRange?.(0, n); this.aCol.addUpdateRange?.(0, n * 4);
  }

  #move(from, to) {
    const f3 = from * 3, t3 = to * 3, f4 = from * 4, t4 = to * 4;
    for (let k = 0; k < 3; k++) { this.p[t3 + k] = this.p[f3 + k]; this.v[t3 + k] = this.v[f3 + k]; }
    for (let k = 0; k < 4; k++) { this.c0[t4 + k] = this.c0[f4 + k]; this.c1[t4 + k] = this.c1[f4 + k]; }
    this.life[to] = this.life[from]; this.age[to] = this.age[from]; this.s0[to] = this.s0[from]; this.s1[to] = this.s1[from];
    this.drag[to] = this.drag[from]; this.grav[to] = this.grav[from];
  }
}

const FIRE = [1.0, 0.62, 0.22, 1], FIRE_END = [0.6, 0.15, 0.02, 0];
const FLASH = [1.0, 0.9, 0.7, 1], FLASH_END = [1.0, 0.5, 0.15, 0];
const DIRT = [0.32, 0.24, 0.16, 0.95], DIRT_END = [0.36, 0.29, 0.21, 0];
const SMOKE = [0.22, 0.21, 0.2, 0.55], SMOKE_END = [0.45, 0.45, 0.46, 0];
const SMOKE_DARK = [0.14, 0.13, 0.12, 0.7];
const PALE = [0.6, 0.58, 0.55, 0.45], PALE_END = [0.75, 0.75, 0.75, 0];
const TEAM_EXHAUST = [[1.0, 0.72, 0.3, 1], [0.75, 0.5, 1.0, 1]];
const SCREEN = [0.6, 0.58, 0.54, 0.62], SCREEN_END = [0.67, 0.66, 0.63, 0];
const TRAIL = [0.16, 0.15, 0.14, 0.45], TRAIL_END = [0.3, 0.29, 0.28, 0];
const DUST = [0.5, 0.42, 0.32, 0.5], DUST_END = [0.56, 0.5, 0.42, 0];

export class BattleFx {
  /**
   * @param {THREE.Scene} scene
   * @param {object} o { fog: THREE.Fog or THREE.FogExp2 }
   */
  constructor(scene, { fog = null, maxGlow = 1600, maxMatter = 5000 } = {}) {
    this.glow = new Pool(scene, maxGlow, true);
    this.matter = new Pool(scene, maxMatter, false);
    if (fog) for (const p of [this.glow, this.matter]) {
      const u = p.mat.uniforms;
      u.fogColor.value.copy(fog.color);
      if (fog.isFogExp2) u.fogDensity.value = fog.density; else { u.fogNear.value = fog.near; u.fogFar.value = fog.far; }
    }
    this.trails = new Map();    // projectile ref -> { kind, t, team }
    this.screens = [];          // smoke screens still billowing: { x, y, z, r, h, left, t }
    this.reT = 0;
    this.rand = (() => { let s = 0x9e3779b9; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; }; })();
    this.off = [
      bus.on('artillery:impact', (e) => this.impact(e.point, e.radius, e.shell)),
      bus.on('projectile:explode', (e) => { if (!e.artillery) this.blast(e.point, e.radius); }),
      bus.on('gun:fire', (e) => this.muzzle(e)),
      bus.on('projectile:spawn', (e) => {
        const st = e.style ?? '';
        if (st.startsWith('shell') || st.startsWith('rocket')) this.trails.set(e.ref, { kind: st.startsWith('rocket') ? 'rocket' : 'shell', t: 0, team: e.ref.team });
      }),
      bus.on('vehicle:destroyed', (e) => this.blast(e.at, 6, 1.6)),
      bus.on('stratagem:smoke', (e) => this.smokeScreen(e.at, e.radius, e.duration, e.height)),
      bus.on('stratagem:land', (e) => this.podLand(e.at)),
    ];
  }

  dispose() { this.off.forEach((f) => f()); }

  #at(p) { return Array.isArray(p) ? p : [p.x, p.y, p.z]; }

  /** A shell or rocket coming down: flash, fireball, a column of dirt, a drifting plume. */
  impact(point, radius = 9, shell = '') {
    const [x, y, z] = this.#at(point), R = this.rand, k = Math.max(0.45, Math.min(1.3, radius / 9)), rocket = /rocket/.test(shell);
    this.glow.add(x, y + 1, z, 0, 0, 0, 0.14, 4 * k, 12 * k, FLASH, FLASH_END);
    for (let i = 0; i < 7; i++) this.glow.add(x + (R() - 0.5) * 2 * k, y + 0.6 + R() * 1.5 * k, z + (R() - 0.5) * 2 * k, (R() - 0.5) * 6, 3 + R() * 6, (R() - 0.5) * 6, 0.3 + R() * 0.25, 1.5 * k, 4.5 * k, FIRE, FIRE_END, 2.5, 0);
    // The dirt column: thrown up steep (20-30 m for a field gun's shell), falling back as clods.
    const n = Math.round((rocket ? 22 : 42) * k);
    for (let i = 0; i < n; i++) {
      const a = R() * Math.PI * 2, out = R() * 5 * k, up = (12 + R() * 15) * k;
      this.matter.add(x + Math.cos(a) * 0.8, y + 0.3, z + Math.sin(a) * 0.8, Math.cos(a) * out, up, Math.sin(a) * out, 1.6 + R() * 1.2, (1 + R() * 0.8) * k, (2.4 + R() * 1.4) * k, DIRT, DIRT_END, 0.3, 14);
    }
    // Smoke: a dark plume that rises and spreads for seconds.
    const m = Math.round((rocket ? 9 : 16) * k);
    for (let i = 0; i < m; i++) {
      const a = R() * Math.PI * 2, r = R() * 2.5 * k;
      this.matter.add(x + Math.cos(a) * r, y + 1 + R() * 5 * k, z + Math.sin(a) * r, Math.cos(a) * 1.4, 1.2 + R() * 2.6, Math.sin(a) * 1.4, 4 + R() * 3.5, 4 * k, (12 + R() * 7) * k, SMOKE_DARK, SMOKE_END, 0.55, -0.15);
    }
    // A ring of dust racing out along the ground.
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + R() * 0.3;
      this.matter.add(x, y + 0.4, z, Math.cos(a) * 9 * k, 0.4, Math.sin(a) * 9 * k, 1.6, 1.2 * k, 4 * k, PALE, PALE_END, 1.6, 0);
    }
  }

  /** Grenades, tank shells, mines, wrecks: a flash and a puff. */
  blast(point, radius = 4, scale = 1) {
    const [x, y, z] = this.#at(point), R = this.rand, k = Math.max(0.35, Math.min(1, radius / 6)) * scale;
    this.glow.add(x, y + 0.5, z, 0, 0, 0, 0.1, 2 * k, 6 * k, FLASH, FLASH_END);
    for (let i = 0; i < 4; i++) this.glow.add(x, y + 0.5, z, (R() - 0.5) * 5, 2 + R() * 3, (R() - 0.5) * 5, 0.25, k, 3 * k, FIRE, FIRE_END, 3, 0);
    for (let i = 0; i < 6; i++) this.matter.add(x + (R() - 0.5), y + 0.5, z + (R() - 0.5), (R() - 0.5) * 3, 1 + R() * 2, (R() - 0.5) * 3, 1.8 + R(), 1.2 * k, 4.5 * k, SMOKE, SMOKE_END, 0.8, -0.1);
  }

  /** The gun's report: muzzle blast, smoke, dust; a rocket salvo's flare and billowing smoke. */
  muzzle(e) {
    const [x, y, z] = e.from, R = this.rand;
    const c = Math.cos(e.pitch ?? 0), dx = -Math.sin(e.yaw ?? 0) * c, dy = Math.sin(e.pitch ?? 0), dz = -Math.cos(e.yaw ?? 0) * c;
    if (e.kind === 'rockets') {
      this.glow.add(x, y, z, dx * 8, dy * 8, dz * 8, 0.18, 1.2, 3, TEAM_EXHAUST[e.team] ?? FIRE, FIRE_END, 4, 0);
      for (let i = 0; i < 4; i++) this.matter.add(x - dx * 2, y - dy * 2, z - dz * 2, -dx * (3 + R() * 4) + (R() - 0.5) * 2, R() * 1.5, -dz * (3 + R() * 4) + (R() - 0.5) * 2, 2.5 + R() * 2, 1.5, 6, PALE, PALE_END, 1.2, -0.1);
      return;
    }
    const big = e.kind === 'howitzer';
    this.glow.add(x + dx, y + dy, z + dz, dx * 12, dy * 12, dz * 12, big ? 0.12 : 0.08, big ? 2.5 : 1.4, big ? 7 : 3.5, FLASH, FLASH_END, 8, 0);
    const puffs = big ? 9 : 5;
    for (let i = 0; i < puffs; i++) {
      const s = 4 + R() * 8;
      this.matter.add(x + dx * 1.5, y + dy * 1.5, z + dz * 1.5, dx * s + (R() - 0.5) * 3, dy * s + R() * 1.5, dz * s + (R() - 0.5) * 3, 2.2 + R() * 1.6, big ? 1.4 : 0.8, big ? 6 : 3.5, PALE, PALE_END, 1.4, -0.12);
    }
    // The blast kicks up the dust around the carriage.
    for (let i = 0; i < (big ? 8 : 4); i++) {
      const a = R() * Math.PI * 2;
      this.matter.add(x - dx * 2 + Math.cos(a) * 1.5, y - 1, z - dz * 2 + Math.sin(a) * 1.5, Math.cos(a) * 4, 0.5, Math.sin(a) * 4, 1.4, 1, 3.2, DIRT, DIRT_END, 1.8, 0);
    }
  }

  /**
   * A smoke screen's cloud: a pop of smoke from the canister, then puffs billowing up and out
   * for as long as the sim blocks sight through it (they stop 4.5 s before, so the cloud has
   * thinned to nothing as the block ends: what you see is what blocks).
   */
  smokeScreen(at, radius = 4.5, duration = 20, height = 7) {
    const [x, y, z] = this.#at(at), R = this.rand;
    for (let i = 0; i < 10; i++) {
      const a = R() * Math.PI * 2, s = 2 + R() * 3;
      this.matter.add(x, y + 0.4, z, Math.cos(a) * s, 1 + R() * 2, Math.sin(a) * s, 3.5 + R() * 2, 1.5, radius * 1.2, SCREEN, SCREEN_END, 0.9, -0.05);
    }
    this.screens.push({ x, y, z, r: radius, h: height, left: Math.max(1, duration - 4.5), t: 0 });
  }

  /** One frame of a drop pod's fall: fire round its nose, a dark trail left hanging behind. */
  reentry(p, dt) {
    const R = this.rand;
    this.reT += dt;
    for (let k = 0; this.reT > 0.012 && k < 4; k++) {
      this.reT -= 0.012;
      this.glow.add(p.x + (R() - 0.5) * 0.6, p.y + 0.6 + R() * 0.8, p.z + (R() - 0.5) * 0.6, 0, 0, 0, 0.22 + R() * 0.12, 1.4, 3.2, FIRE, FIRE_END);
      if (R() < 0.4) this.matter.add(p.x + (R() - 0.5) * 0.6, p.y + 1.6 + R(), p.z + (R() - 0.5) * 0.6, (R() - 0.5) * 0.4, 0.3, (R() - 0.5) * 0.4, 1.4 + R() * 0.8, 0.8, 2.4, TRAIL, TRAIL_END, 0.4, -0.1);
    }
    this.reT = Math.min(this.reT, 0.05);
  }

  /** A drop pod lands: a flash, clods thrown up, dust racing out along the ground and hanging. */
  podLand(at) {
    const [x, y, z] = this.#at(at), R = this.rand;
    this.glow.add(x, y + 0.6, z, 0, 0, 0, 0.1, 2, 5, FLASH, FLASH_END);
    for (let i = 0; i < 22; i++) {
      const a = R() * Math.PI * 2, out = 1 + R() * 3;
      this.matter.add(x + Math.cos(a) * 0.7, y + 0.2, z + Math.sin(a) * 0.7, Math.cos(a) * out, 6 + R() * 8, Math.sin(a) * out, 1.2 + R() * 0.8, 0.5 + R() * 0.4, 1.2 + R() * 0.8, DIRT, DIRT_END, 0.3, 14);
    }
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + R() * 0.3, s = 9 + R() * 4;
      this.matter.add(x, y + 0.3, z, Math.cos(a) * s, 0.4, Math.sin(a) * s, 1.3 + R() * 0.5, 0.8, 3, DUST, DUST_END, 2.2, 0);
    }
    for (let i = 0; i < 4; i++) this.matter.add(x + (R() - 0.5) * 2, y + 0.6 + R() * 0.6, z + (R() - 0.5) * 2, (R() - 0.5), 0.4 + R() * 0.5, (R() - 0.5), 1.8 + R(), 1.5, 3.5, DUST, DUST_END, 0.8, 0.05);
  }

  update(dt) {
    // Smoke screens billow while they last.
    for (let i = this.screens.length - 1; i >= 0; i--) {
      const s = this.screens[i], R = this.rand;
      s.left -= dt; s.t += dt;
      if (s.left <= 0) { this.screens.splice(i, 1); continue; }
      for (; s.t > 0.09; s.t -= 0.09) {
        const a = R() * Math.PI * 2, r = Math.sqrt(R()) * s.r * 0.75;
        // Puffs from grey to near white, so the screen has some body and isn't one flat wall.
        const g = 0.8 + R() * 0.25, c0 = [SCREEN[0] * g, SCREEN[1] * g, SCREEN[2] * g, SCREEN[3]];
        this.matter.add(s.x + Math.cos(a) * r, s.y + 0.5 + R() * s.h * 0.5, s.z + Math.sin(a) * r, Math.cos(a) * 0.4, 0.25 + R() * 0.3, Math.sin(a) * 0.4, 4.5 + R() * 1.5, 2.5, s.r * (1.3 + R() * 0.4), c0, SCREEN_END, 0.3, -0.02);
      }
    }
    // Trails: puffs left behind shells; exhaust and thick smoke behind rockets.
    for (const [ref, tr] of this.trails) {
      if (!ref.alive) { this.trails.delete(ref); continue; }
      tr.t += dt;
      const p = ref.pos, R = this.rand;
      if (tr.kind === 'rocket') {
        this.glow.add(p.x, p.y, p.z, 0, 0, 0, 0.08, 0.7, 1.4, TEAM_EXHAUST[tr.team] ?? FIRE, FIRE_END);
        if (tr.t > 0.03) { tr.t = 0; this.matter.add(p.x, p.y, p.z, (R() - 0.5) * 0.6, R() * 0.4, (R() - 0.5) * 0.6, 1.6 + R(), 0.5, 2.6, PALE, PALE_END, 0.6, -0.05); }
      } else if (tr.t > 0.08) {
        tr.t = 0;
        this.matter.add(p.x, p.y, p.z, 0, 0, 0, 0.9, 0.25, 0.9, [0.55, 0.55, 0.55, 0.3], [0.7, 0.7, 0.7, 0], 0, 0);
      }
    }
    this.glow.update(dt);
    this.matter.update(dt);
  }

  get count() { return this.glow.n + this.matter.n; }
}
