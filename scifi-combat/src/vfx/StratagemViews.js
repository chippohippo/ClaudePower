// StratagemViews: the stratagems as you see them (docs/GAMEPLAY_PLAN.md §2; the sim is
// combat/Stratagems.js, the hardware render/StratagemKit.js). Read-only: it reads
// world.stratagems every frame and never writes back.
//
//  * A soldier typing a code has the wrist pad lit (a glow at the left hand); a beacon in hand
//    (typed, not yet thrown) glows in the right hand in its payload's color, so everyone near can
//    see what's about to come down.
//  * Beacons: the canister tumbles through the air with its lamp lit in the payload's color
//    (palette.json `stratagem`: strike red, supply blue, sentry green, smoke white). Planted, it
//    blinks, and a pillar of light climbs into the sky in that color: drawn wider with distance
//    so it reads from across the map, its pulses running faster as the payload nears. A strike
//    draws its danger outline on the ground (a band, and a low fence of light fading upward so it
//    reads from eye height too). Both go out when the payload arrives.
//    Both are drawn opaque-ish in the saturated color, not added on: the scorched sky is bright
//    orange, and anything added to it just turns it white.
//  * Strike rounds: a white-hot streak behind each round coming down.
//  * Strafing runs and airstrikes: the strike jet comes in low along the run, passes over the
//    beacon as the first round leaves and pulls away.
//  * Pods fall spinning in a trail of fire (BattleFx.reentry) and land upright, spike first. A
//    supply pod folds its four doors down on four crates: one crate per grab left. A sentry pod
//    pops its cap and the turret rises out of it, turning where the sim aims it; destroyed, its
//    head is blown off and the pod stands as a wreck for a while.

import * as THREE from 'three';
import { bus } from '../core/EventBus.js';
import { paintMaterial } from '../render/TrooperMaterial.js';
import { DEFAULT_PALETTE } from '../render/CrowdRenderer.js';
import { beaconModel, podModel, sentryModel, jetModel, POD } from '../render/StratagemKit.js';

const COLORS = { strike: '#ff5a3c', supply: '#4db3ff', sentry: '#5dff8f', smoke: '#ece7db' };
const TICK = 1 / 60;
const JET = { speed: 150, show: 1100, back: 45 };   // m/s; drawn this far either side of the pass (m); the sim's release offset behind each round (m)
const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3(), _m = new THREE.Matrix4(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();

// A cylindrical billboard from the beacon up into the sky (position.x across, position.y up 0..1).
const BEAM_VERT = /* glsl */ `
  uniform float uHeight;
  varying vec2 vUv;
  varying float vNear;
  void main() {
    vec3 base = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vec3 toCam = cameraPosition - base; toCam.y = 0.0;
    float d = max(0.5, length(toCam));
    vec3 side = vec3(toCam.z, 0.0, -toCam.x) / d;
    float w = max(0.7, d * 0.013);                   // never thinner than a few pixels
    vec3 p = base + side * position.x * w + vec3(0.0, position.y * uHeight, 0.0);
    vUv = vec2(position.x * 2.0, position.y);
    vNear = smoothstep(1.5, 7.0, d);                 // standing in it, it doesn't fill the screen
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }`;
const BEAM_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime, uAlpha, uRate, uHeight;
  varying vec2 vUv;
  varying float vNear;
  void main() {
    float x = vUv.x, y = vUv.y, m = y * uHeight;
    float core = exp(-x * x * 7.0), halo = exp(-x * x * 1.6) * 0.45;
    float fall = pow(1.0 - y, 1.4) * smoothstep(0.0, 1.2, m);
    float pulse = 0.72 + 0.28 * sin(m * 0.16 - uTime * uRate);
    float a = min(1.0, (core + halo) * fall * pulse) * uAlpha * (0.3 + 0.7 * vNear);
    gl_FragColor = vec4(uColor * (1.0 + core * 0.6), a);   // a hot center, saturated edges
  }`;

let MODELS = null;
const models = () => (MODELS ??= { beacon: beaconModel(), pod: podModel(), sentry: sentryModel(), jet: jetModel() });

let GLOW = null;
/** A soft round glow for sprites (lamps, flares). */
function glowTexture() {
  if (GLOW) return GLOW;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d'), grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.22, 'rgba(255,255,255,0.5)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  GLOW = new THREE.CanvasTexture(c);
  return GLOW;
}

const easeOutBack = (u) => { const c = 1.9; return 1 + (c + 1) * (u - 1) ** 3 + c * (u - 1) ** 2; };
const clamp01 = (x) => Math.max(0, Math.min(1, x));

export class StratagemViews {
  /**
   * @param {THREE.Scene} scene
   * @param {object} world  CombatWorld (world.stratagems, world.deployables)
   * @param {object} o { palette (palette.json), fx: BattleFx (pod trails), groundY(x, z), anim: AnimationSystem (beacons in hand) }
   */
  constructor(scene, world, { palette = DEFAULT_PALETTE, fx = null, groundY = null, anim = null } = {}) {
    this.scene = scene; this.world = world; this.fx = fx; this.palette = palette; this.anim = anim;
    this.groundY = groundY ?? ((x, z) => world.groundHeight?.(_v.set(x, 0, z)) ?? 0);
    this.kinds = {};
    for (const [k, c] of Object.entries({ ...COLORS, ...(palette.stratagem ?? {}) })) {
      const color = new THREE.Color(c);
      this.kinds[k] = {
        color,
        lamp: new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(4), toneMapped: false }),
        glow: new THREE.SpriteMaterial({ map: glowTexture(), color: color.clone().multiplyScalar(2.5), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }),
      };
    }
    this.body = [0, 1].map((team) => paintMaterial(palette, { team, number: 0 }));   // beacons
    this.jetPaint = [0, 1].map((team) => paintMaterial(palette, { team, number: 7 + team * 31 }));
    this.padGlow = new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(palette.ui?.accent ?? '#ffe14d').multiplyScalar(2.5), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false });
    this.pads = [];          // lit wrist pads (pooled)
    this.flare = new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color('#ffb46b').multiplyScalar(3), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false });
    this.beacons = new Map();
    this.held = [];          // beacons in hand (pooled)
    this.pods = new Map();
    this.jets = [];
    this.flashes = [];
    this.time = 0;
    // Strike rounds: white-hot at the head, fading down the streak (vertex colors, additive).
    const streak = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5).toNonIndexed();
    const sp = streak.attributes.position, col = new Float32Array(sp.count * 3);
    for (let i = 0; i < sp.count; i++) col.fill(1 - sp.getZ(i), i * 3, i * 3 + 3);
    streak.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.streakMesh = new THREE.InstancedMesh(streak, new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd7a3').multiplyScalar(4), vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }), 64);
    this.streakMesh.frustumCulled = false; this.streakMesh.count = 0;
    this.streakMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.streakMesh);
    this.rounds = new Set();
    this.off = [
      bus.on('projectile:spawn', (e) => { if (this.world.stratagems?.shells?.[e.ref.spec?.weapon?.id]) this.rounds.add(e.ref); }),
      bus.on('stratagem:land', (e) => { const v = this.pods.get(e.beacon); if (v && !v.landed) { v.landed = true; v.t = 0; v.root.position.fromArray(e.at); } }),
      bus.on('deployable:removed', (e) => this.#sentryGone(e)),
      bus.on('deployable:fire', (e) => this.#sentryFire(e)),
    ];
  }

  dispose() {
    this.off.forEach((f) => f());
    for (const v of this.beacons.values()) this.#dropBeacon(v);
    for (const v of this.pods.values()) this.#dropPod(v);
    for (const j of this.jets) if (j.mesh) this.scene.remove(j.mesh);
    this.scene.remove(this.streakMesh);
  }

  /** @param {number} alpha  the sim's interpolation fraction (FixedLoop), for things moving fast */
  update(dt, camera, alpha = 0) {
    this.time += dt;
    const S = this.world.stratagems;
    if (!S) return;
    const now = S.time + alpha * TICK;
    this.#held();
    this.#beacons(S, dt, now, alpha);
    this.#pods(S, dt, alpha);
    this.#jets(now);
    this.#streaks(alpha);
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life -= dt;
      if (f.life <= 0) { f.sprite.parent?.remove(f.sprite); this.flashes.splice(i, 1); }
    }
  }

  // ---------------------------------------------------------------- beacons
  /** In the right hand of every nearby soldier holding one (rigs at full or mid detail). */
  #held() {
    let n = 0, m = 0;
    for (const r of this.anim?.list ?? []) {
      const S = r.e.stratagems;
      if (!S || S.state === 'idle' || r.lod > 1 || r.e.health.dead || !r.h?.j) continue;
      if (S.state === 'typing') {
        const pad = this.pads[m] ?? (this.pads[m] = new THREE.Sprite(this.padGlow));
        if (!pad.parent) this.scene.add(pad);
        m++;
        pad.position.copy(r.h.j.hand[0]).lerp(r.h.j.elbow[0], 0.45);
        pad.scale.setScalar(0.16 + (S.code.length ? 0.04 : 0) + Math.random() * 0.02);
        pad.visible = true;
        continue;
      }
      const v = this.held[n] ?? (this.held[n] = this.#heldMesh());
      n++;
      const kind = this.kinds[S.armed.def.kind] ?? this.kinds.strike;
      v.body.material = this.body[r.e.team] ?? this.body[0]; v.lamp.material = kind.lamp; v.glow.material = kind.glow;
      v.root.position.copy(r.h.j.hand[1]);
      v.root.rotation.set(0.5, r.e.movement.state.yaw, 0);
      v.glow.scale.setScalar(Math.sin(this.time * 9) > 0 ? 0.3 : 0.2);
      v.root.visible = true;
    }
    for (let i = n; i < this.held.length; i++) this.held[i].root.visible = false;
    for (let i = m; i < this.pads.length; i++) this.pads[i].visible = false;
  }

  #heldMesh() {
    const M = models().beacon, root = new THREE.Group();
    const body = new THREE.Mesh(M.body, this.body[0]), lamp = new THREE.Mesh(M.lamp, this.kinds.strike.lamp), glow = new THREE.Sprite(this.kinds.strike.glow);
    body.position.y = lamp.position.y = -0.12; glow.position.y = 0.15;
    root.add(body, lamp, glow);
    this.scene.add(root);
    return { root, body, lamp, glow };
  }

  #beacons(S, dt, now, alpha) {
    for (const b of S.beacons) {
      const v = this.beacons.get(b.id) ?? this.#addBeacon(b);
      v.seen = this.time;
      if (!b.planted) {
        v.root.position.copy(b.pos).addScaledVector(b.vel, alpha * TICK);
        v.root.rotation.set(b.age * 13, b.age * 3, b.age * 9);   // tumbling end over end
        continue;
      }
      if (!v.planted) this.#plant(v, b);
      v.root.position.copy(b.pos); v.root.position.y -= 0.04;
      v.root.rotation.set(0, 0, 0);
      const delay = b.def.delay ?? 0, eta = Math.max(0, delay - (now - b.at)), u = delay > 0 ? 1 - eta / delay : 1;
      const on = Math.sin(this.time * (6 + 16 * u)) > -0.2;
      v.glow.scale.setScalar(on ? 0.9 : 0.35);
      const arrived = b.plan.every((s) => s.fired) && eta <= 0;
      v.fade = arrived ? Math.max(0, v.fade - dt * 2) : Math.min(1, v.fade + dt * 3);
      const U = v.beam.material.uniforms;
      U.uTime.value = this.time; U.uRate.value = 4 + 14 * u; U.uAlpha.value = v.fade;
      if (v.ring) {
        v.ring.material.uniforms.uAlpha.value = v.fade * (on ? 0.9 : 0.6);
        if (b.shift) v.ring.position.set(b.shift.x, 0, b.shift.z);   // stuck on someone: the strike follows them
      }
    }
    // Gone from the sim: the light fades out, then the view goes.
    for (const [id, v] of this.beacons) {
      if (v.seen === this.time) continue;
      v.fade -= dt * 2.5;
      if (v.beam) v.beam.material.uniforms.uAlpha.value = Math.max(0, v.fade);
      if (v.ring) v.ring.material.uniforms.uAlpha.value = Math.max(0, v.fade) * 0.6;
      v.glow.visible = false;
      if (v.fade <= 0) { this.#dropBeacon(v); this.beacons.delete(id); }
    }
  }

  #addBeacon(b) {
    const M = models().beacon, kind = this.kinds[b.def.kind] ?? this.kinds.strike;
    const root = new THREE.Group();
    root.add(new THREE.Mesh(M.body, this.body[b.team] ?? this.body[0]), new THREE.Mesh(M.lamp, kind.lamp));
    const glow = new THREE.Sprite(kind.glow);
    glow.position.y = 0.27; glow.scale.setScalar(0.5);
    root.add(glow);
    this.scene.add(root);
    const v = { id: b.id, root, glow, kind, planted: false, beam: null, ring: null, fade: 0, seen: this.time };
    this.beacons.set(b.id, v);
    return v;
  }

  #plant(v, b) {
    v.planted = true;
    const beam = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0), new THREE.ShaderMaterial({
      vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uColor: { value: v.kind.color.clone().multiplyScalar(2.4) }, uTime: { value: 0 }, uAlpha: { value: 0 }, uRate: { value: 4 }, uHeight: { value: 220 } },
    }));
    beam.frustumCulled = false; beam.renderOrder = 4;
    beam.position.y = 0.2;
    v.root.add(beam);
    v.beam = beam;
    if (b.def.kind === 'strike') { v.ring = this.#ring(b, v.kind.color); this.scene.add(v.ring); }
    // A run or a stick of bombs: the jet that flies it.
    const P = b.def.payload, first = b.plan?.[0];
    if (P.kind === 'line' && first?.dir) {
      this.jets.push({ team: b.team, pass: b.at + first.t, x: first.x - first.dir[0] * JET.back, y: first.y + (P.height ?? 80), z: first.z - first.dir[1] * JET.back, dx: first.dir[0], dz: first.dir[1], mesh: null, roll: (b.id % 2 ? 1 : -1) });
    }
  }

  /**
   * The danger outline of a strike, draped over the ground where the plan puts its rounds (the
   * plan is fixed at planting, so it stays put if the beacon rides off): a circle of spread +
   * splash round a barrage, a capsule of splash round a run or a stick of bombs.
   */
  #ring(b, color) {
    const P = b.def.payload, splash = this.world.stratagems.shells?.[P.shell]?.damage?.splash ?? 0;
    let A = [b.pos.x, b.pos.z], B = A, r = (P.spread ?? 0) + splash;
    if (P.kind === 'line' && b.plan.length > 1) { const f = b.plan[0], l = b.plan[b.plan.length - 1]; A = [f.x, f.z]; B = [l.x, l.z]; r = splash + 1; }
    const N = 112, g = new THREE.BufferGeometry(), pos = new Float32Array((N + 1) * 12), fade = new Float32Array((N + 1) * 4);
    let dx = B[0] - A[0], dz = B[1] - A[1];
    const L = Math.hypot(dx, dz);
    if (L > 1e-3) { dx /= L; dz /= L; } else { dx = 0; dz = 1; }
    const nx = -dz, nz = dx, w = Math.max(0.35, r * 0.04), H = 1.1;
    for (let i = 0; i <= N; i++) {
      // Round the far end (B) for the first half, the near end (A) for the second.
      const t = (i / N) * Math.PI * 2, C = t <= Math.PI || i === N ? B : A;
      const ox = Math.cos(t) * nx + Math.sin(t) * dx, oz = Math.cos(t) * nz + Math.sin(t) * dz;
      const px = C[0] + ox * r, pz = C[1] + oz * r, qx = C[0] + ox * (r - w), qz = C[1] + oz * (r - w);
      const gy = Math.max(this.groundY(px, pz), this.groundY(qx, qz));      // the band stays flat over a crater's lip
      // Four vertices per step: the band (inner, outer) and the fence (foot, top).
      pos.set([qx, gy + 0.1, qz, px, gy + 0.1, pz, px, gy + 0.05, pz, px, gy + H, pz], i * 12);
      fade.set([0, 0, 0, 1], i * 4);
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aH', new THREE.BufferAttribute(fade, 1));
    const idx = [];
    for (let i = 0; i < N; i++) for (const o of [0, 2]) { const a = i * 4 + o, b = a + 4; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    g.setIndex(idx);
    const m = new THREE.Mesh(g, new THREE.ShaderMaterial({
      vertexShader: 'attribute float aH; varying float vH; void main() { vH = aH; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 uColor; uniform float uAlpha; varying float vH; void main() { gl_FragColor = vec4(uColor, uAlpha * pow(1.0 - vH, 1.7)); }',
      uniforms: { uColor: { value: color.clone().multiplyScalar(1.6) }, uAlpha: { value: 0 } }, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    }));
    m.frustumCulled = false; m.renderOrder = 3;
    return m;
  }

  #dropBeacon(v) {
    this.scene.remove(v.root);
    v.beam?.geometry.dispose(); v.beam?.material.dispose();
    if (v.ring) { this.scene.remove(v.ring); v.ring.geometry.dispose(); v.ring.material.dispose(); }
  }

  // ---------------------------------------------------------------- pods
  #pods(S, dt, alpha) {
    for (const p of S.pods) {
      const v = this.pods.get(p.id) ?? this.#addPod(p);
      v.seen = this.time;
      if (!p.landed) {
        v.root.position.copy(p.pos);
        v.root.position.y = Math.max(p.ground, p.pos.y + p.vy * alpha * TICK);
        v.root.rotation.y += dt * 2.2;
        this.fx?.reentry?.(v.root.position, dt);
        continue;
      }
      v.grabs = p.grabs;
    }
    for (const [id, v] of this.pods) {
      if (!v.landed) { if (v.seen !== this.time) { this.#dropPod(v); this.pods.delete(id); } continue; }
      v.t += dt;
      const gone = v.seen !== this.time;
      if (v.contents === 'sentry') this.#sentry(v, dt, gone);
      else this.#supply(v, dt, gone);
      if (v.sink > 0) {
        v.sink -= dt;
        if (v.sink <= 1.5) v.root.position.y -= dt * 1.4;
        if (v.sink <= 0) { this.#dropPod(v); this.pods.delete(id); }
      }
    }
  }

  #addPod(p) {
    const M = models().pod, kind = this.kinds[p.def.kind] ?? this.kinds.supply;
    const paint = paintMaterial(this.palette, { team: p.team, number: (p.id * 23 + 5) % 100 });
    const mesh = (geo, mat = paint) => { const m = new THREE.Mesh(geo, mat); m.castShadow = m.receiveShadow = true; return m; };
    const root = new THREE.Group();
    root.add(mesh(M.core));
    const capPivot = new THREE.Group();
    capPivot.position.y = POD.y1 + 0.1;
    const cap = mesh(M.cap); cap.position.y = -capPivot.position.y;
    const ring = new THREE.Mesh(M.lampRing, kind.lamp); ring.position.y = -capPivot.position.y;
    capPivot.add(cap, ring);
    root.add(capPivot);
    const doors = [], crates = [];
    for (const f of M.faces) {
      const s = Math.sin(f.yaw), c = Math.cos(f.yaw);
      const pivot = new THREE.Group();
      pivot.rotation.order = 'YXZ';
      pivot.position.set(-s * M.hinge.r, M.hinge.y, -c * M.hinge.r);
      pivot.rotation.y = f.yaw;
      pivot.add(mesh(M.door));
      root.add(pivot);
      doors.push(pivot);
      if (p.contents === 'supply') {
        const crate = mesh(M.crate);
        crate.position.set(-s * M.crateAt.r, M.crateAt.y, -c * M.crateAt.r);
        crate.rotation.y = f.yaw;
        root.add(crate);
        crates.push(crate);
      }
    }
    const v = { id: p.id, root, paint, kind, capPivot, ring, doors, crates, contents: p.contents, stratagem: p.beacon?.stratagem, team: p.team, landed: false, t: 0, grabs: p.grabs, seen: this.time, sink: 0 };
    if (p.contents === 'sentry') {
      const S = models().sentry, head = new THREE.Group();
      head.add(mesh(S.head));
      const mast = mesh(S.mast); mast.position.y = -1.0;
      head.add(mast);
      head.position.y = POD.sentryHead - 0.45;
      head.visible = false;
      root.add(head);
      v.head = head; v.muzzle = S.muzzle;
    }
    root.position.copy(p.pos);
    this.scene.add(root);
    this.pods.set(p.id, v);
    return v;
  }

  /** A supply pod: the doors fold down on the crates; one crate per grab left. */
  #supply(v, dt, gone) {
    const open = easeOutBack(clamp01((v.t - 0.35) / 0.55)) * 1.3;   // ~75°: open petals, tips clear of the ground
    for (const d of v.doors) d.rotation.x = -open;
    v.crates.forEach((c, k) => (c.visible = k < (gone ? 0 : v.grabs)));
    v.ring.visible = !gone && Math.sin(this.time * 3.2) > -0.4;
    if (gone && !v.sink) v.sink = 12;    // emptied or left: the shell stands a while, then sinks
  }

  /** A sentry pod: the cap pops, the turret rises out and turns where the sim aims it. */
  #sentry(v, dt, gone) {
    if (gone && !v.dep && !v.dead) {
      // The sim hands the pod over to a turret deployable as it lands.
      const at = v.root.position;
      v.dep = this.world.deployables?.list.find((d) => d.kind === 'turret' && !d.removed && d.ability === v.stratagem && d.movement.state.position.distanceToSquared(at) < 1) ?? null;
      if (!v.dep) { v.dead = 'expired'; v.sink = 3; }
    }
    // The cap: up, tumbling off to the side, gone.
    const c = clamp01((v.t - 0.2) / 0.7);
    if (c > 0 && c < 1) { v.capPivot.position.y = POD.y1 + 0.1 + c * 2.4 - c * c * 2.6; v.capPivot.position.x = c * 1.4; v.capPivot.rotation.z = -c * 2.2; }
    v.capPivot.visible = c < 1;
    // The head rises out of the opened top.
    const up = v.dead === 'expired' ? 1 - clamp01((3 - v.sink) / 1) : clamp01((v.t - 0.35) / 0.7);
    v.head.visible = up > 0.02 && v.dead !== 'destroyed';
    v.head.position.y = POD.sentryHead - 0.45 * (1 - easeOutBack(up));
    if (v.dep && !v.dep.removed) v.head.rotation.y = v.dep.aimYaw;
  }

  #sentryGone(e) {
    for (const v of this.pods.values()) {
      if (v.dep?.id !== e.id) continue;
      v.dead = e.reason === 'destroyed' ? 'destroyed' : 'expired';
      if (v.dead === 'destroyed') {
        const h = v.head.getWorldPosition(_v);
        this.fx?.blast(h, 3, 1.1);
        v.paint.paint.uTint.value = 0.35;         // a scorched wreck
        v.sink = 8;
      } else v.sink = 3;
      v.dep = null;
    }
  }

  #sentryFire(e) {
    for (const v of this.pods.values()) {
      if (v.dep?.id !== e.id || !v.head.visible) continue;
      const f = new THREE.Sprite(this.flare);
      f.position.set(0, -0.02, v.muzzle);
      f.scale.setScalar(0.7 + Math.random() * 0.4);
      v.head.add(f);
      this.flashes.push({ sprite: f, life: 0.05 });
    }
  }

  #dropPod(v) {
    this.scene.remove(v.root);
    v.paint.dispose();
  }

  // ---------------------------------------------------------------- the strike jet
  #jets(now) {
    for (let i = this.jets.length - 1; i >= 0; i--) {
      const j = this.jets[i], s = (now - j.pass) * JET.speed;
      if (s > JET.show) { if (j.mesh) this.scene.remove(j.mesh); this.jets.splice(i, 1); continue; }
      if (s < -JET.show) continue;
      if (!j.mesh) j.mesh = this.#jetMesh(j.team);
      // Level through the run, then a climbing turn away.
      const k = Math.max(0, s - 30), climb = k * k * 0.0005, slope = k * 0.001;
      j.mesh.position.set(j.x + j.dx * s, j.y + climb, j.z + j.dz * s);
      j.mesh.rotation.set(Math.atan(slope), Math.atan2(-j.dx, -j.dz), j.roll * Math.min(0.5, k * 0.0016), 'YXZ');
    }
  }

  #jetMesh(team) {
    const M = models().jet, g = new THREE.Group();
    g.add(new THREE.Mesh(M.body, this.jetPaint[team] ?? this.jetPaint[0]));
    for (const n of M.nozzles) {
      const f = new THREE.Sprite(this.flare);
      f.position.set(...n); f.scale.setScalar(2.2);
      g.add(f);
    }
    this.scene.add(g);
    return g;
  }

  // ---------------------------------------------------------------- rounds coming down
  #streaks(alpha) {
    let n = 0;
    for (const ref of this.rounds) {
      if (!ref.alive) { this.rounds.delete(ref); continue; }
      const sp = ref.vel.length();
      if (sp < 1 || n >= 64) continue;
      const small = ref.spec.weapon.id === 'strat_strafe', w = small ? 0.22 : 0.42;
      const len = Math.min(small ? 9 : 34, ref.age * sp + 0.5);
      _z.copy(ref.vel).divideScalar(-sp);
      _x.crossVectors(_z, UP);
      if (_x.lengthSq() < 1e-6) _x.set(1, 0, 0);
      _x.normalize();
      _y.crossVectors(_z, _x).normalize().multiplyScalar(w);
      _x.multiplyScalar(w);
      _m.makeBasis(_x, _y, _z.multiplyScalar(len)).setPosition(_v.copy(ref.pos).addScaledVector(ref.vel, alpha * TICK));
      this.streakMesh.setMatrixAt(n++, _m);
    }
    this.streakMesh.count = n;
    this.streakMesh.instanceMatrix.needsUpdate = true;
  }
}
