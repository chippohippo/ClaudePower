// GunFx: small arms in the world (docs/GAMEPLAY_PLAN.md §1): the flash at the muzzle, a puff of
// smoke, what a round does to what it hits, and the holes it leaves. Presentation only; the
// particles go into BattleFx's pools (glow, hard matter, soft dust), so no draw calls of its own
// but the holes.
//  * Muzzle: on weapon:fire, a flash for two frames (35 ms) and a puff that hangs 0.6 s, at the
//    animated gun's barrel (the rig's prop, not the sim's eye-height origin). Your own shots
//    light the scene for those frames (one point light, always in the scene, so no shader rebuilds).
//  * Impacts, by surface: dirt puffs in the dust color, sand spray off sandbags, splinters off
//    timber, grey chips off concrete, sparks off metal and vehicles (and armor plate), a dark mist
//    off flesh. Only within 90 m of the camera: beyond that nobody can see them.
//  * Bullet holes: 256 pooled decals on whatever was hit (not on people), the oldest going first.
//  * Brass: every kinetic round (not lasers or plasma) throws its spent casing out of the
//    ejection port, to the right and up, carried along at the shooter's speed; it tumbles, bounces
//    off whatever is under it (the ground, a rooftop, a sandbag) and lies there a while. Shotguns
//    and bolt guns throw theirs when they're pumped or cycled. Within 30 m of the camera (they're
//    a few centimetres long); 160 at once, the oldest going first; one draw call. The first
//    bounce near the camera rings (fx:brass, for the sound).

import * as THREE from 'three';
import { bus } from '../core/EventBus.js';
import { DEFAULT_PALETTE } from '../render/CrowdRenderer.js';
import { weaponDesign } from '../audio/SoundBank.js';

const SEEN = 90;                 // m: no effects past this from the camera
const HOLES = 256;
const BRASS = 160, BRASS_SEEN = 30, BRASS_LIE = 25;   // casings at once; m from the camera; s on the ground
const G = 9.8;
const _p = new THREE.Vector3(), _d = new THREE.Vector3(), _d2 = new THREE.Vector3(), _n = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new THREE.Vector3();
const _r = new THREE.Vector3(), _u = new THREE.Vector3(), _v = new THREE.Vector3(), _ax = new THREE.Vector3(), X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0);
/** Casing sizes by gun: [half length, radius] in m (a touch bigger than life, so they read). */
const CASE = { rifle: [0.03, 0.0075], heavy: [0.038, 0.009], shell: [0.036, 0.012] };

/**
 * BrassField: spent casings in flight and on the ground. Pure (no scene): GunFx throws them in
 * and draws them. Each one tumbles under gravity, comes down on the highest surface under it as
 * it falls (`floor(x, y, z)`: the ground, a rooftop, a crate; off a roof's edge, the street), bounces at most three times,
 * losing most of its fall and some of its slide each time, and comes to rest lying on its side.
 * The first bounce calls `onRing(x, y, z)` (the tink). The oldest goes when the field is full.
 */
export class BrassField {
  constructor(max = BRASS, { floor = () => 0, onRing = null, rand = Math.random } = {}) {
    this.max = max; this.floor = floor; this.onRing = onRing; this.rand = rand;
    this.at = 0; this.n = 0;
    this.p = new Float32Array(max * 3); this.v = new Float32Array(max * 3); this.axis = new Float32Array(max * 3);
    this.q = Array.from({ length: max }, () => new THREE.Quaternion());
    this.spin = new Float32Array(max); this.size = new Float32Array(max * 2); this.ground = new Float32Array(max);
    this.age = new Float32Array(max); this.rest = new Float32Array(max); this.bounces = new Uint8Array(max); this.shell = new Uint8Array(max);
  }

  /** Throw a casing from p at velocity v, leaving along `dir` (unit), [half length, radius]; returns its slot. */
  throw(p, v, dir, [len, rad], shell = false) {
    const R = this.rand, i = this.at, i3 = i * 3;
    this.p[i3] = p.x; this.p[i3 + 1] = p.y; this.p[i3 + 2] = p.z;
    this.v[i3] = v.x; this.v[i3 + 1] = v.y; this.v[i3 + 2] = v.z;
    this.q[i].setFromUnitVectors(X, dir);                       // it leaves along the barrel...
    _ax.set(R() - 0.5, R() - 0.5, R() - 0.5).normalize();
    this.axis[i3] = _ax.x; this.axis[i3 + 1] = _ax.y; this.axis[i3 + 2] = _ax.z;
    this.spin[i] = 20 + R() * 18;                               // ...tumbling end over end
    this.size[i * 2] = len; this.size[i * 2 + 1] = rad; this.shell[i] = shell ? 1 : 0;
    this.ground[i] = this.floor(p.x, p.y, p.z);
    this.age[i] = 0; this.rest[i] = -1; this.bounces[i] = 0;
    this.at = (i + 1) % this.max; this.n = Math.min(this.max, this.n + 1);
    return i;
  }

  /** How much of casing i is left (it shrinks away after lying BRASS_LIE s). */
  left(i) { return this.rest[i] < 0 || this.age[i] - this.rest[i] <= BRASS_LIE ? 1 : Math.max(0, 1 - (this.age[i] - this.rest[i] - BRASS_LIE)); }

  step(dt) {
    for (let i = 0; i < this.n; i++) {
      this.age[i] += dt;
      if (this.rest[i] >= 0) continue;
      const i3 = i * 3, rad = this.size[i * 2 + 1], P = this.p, V = this.v, y0 = P[i3 + 1];
      V[i3 + 1] -= G * dt;
      P[i3] += V[i3] * dt; P[i3 + 1] += V[i3 + 1] * dt; P[i3 + 2] += V[i3 + 2] * dt;
      // Falling: what's under it now, from the height it fell from (so a top it just passed counts).
      if (V[i3 + 1] < 0) this.ground[i] = this.floor(P[i3], y0, P[i3 + 2]);
      _ax.set(this.axis[i3], this.axis[i3 + 1], this.axis[i3 + 2]);
      this.q[i].premultiply(_q.setFromAxisAngle(_ax, this.spin[i] * dt));
      if (P[i3 + 1] >= this.ground[i] + rad) continue;
      P[i3 + 1] = this.ground[i] + rad;
      if (-V[i3 + 1] > 0.9 && this.bounces[i] < 3) {
        // A bounce: most of the fall lost, skidding on; it rings the first time.
        if (this.bounces[i] === 0) this.onRing?.(P[i3], P[i3 + 1], P[i3 + 2]);
        V[i3 + 1] *= -0.3; V[i3] *= 0.45; V[i3 + 2] *= 0.45; this.spin[i] *= 0.5;
        this.bounces[i]++;
      } else {
        // At rest, lying on its side, turned whichever way it skidded.
        this.rest[i] = this.age[i];
        V[i3] = V[i3 + 1] = V[i3 + 2] = 0;
        this.q[i].setFromAxisAngle(Y, this.rand() * Math.PI * 2);
      }
    }
  }
}

const lin = (hex, a = 1) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b, a]; };
const MAG = [0.03, 0.03, 0.035, 1];
const fade = (c) => [c[0], c[1], c[2], 0];

/** A bullet hole: a dark centre fading out through a scorched, ragged edge (alpha). */
function holeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 30);
  r.addColorStop(0, 'rgba(4,3,2,1)'); r.addColorStop(0.3, 'rgba(8,6,5,0.92)'); r.addColorStop(0.6, 'rgba(14,11,8,0.4)'); r.addColorStop(1, 'rgba(14,11,8,0)');
  g.fillStyle = r; g.beginPath();
  for (let i = 0; i <= 16; i++) { const a = (i / 16) * Math.PI * 2, rr = 22 + (i % 3) * 4; g.lineTo(32 + Math.cos(a) * rr, 32 + Math.sin(a) * rr); }
  g.fill();
  return new THREE.CanvasTexture(c);
}

export class GunFx {
  /**
   * @param {THREE.Scene} scene
   * @param {object} o { fx: BattleFx, anim: AnimationSystem (the barrels), world, player, palette }
   */
  constructor(scene, { fx, anim = null, world, player = null, palette = DEFAULT_PALETTE }) {
    this.fx = fx; this.anim = anim; this.world = world; this.player = player;
    this.eye = new THREE.Vector3(0, 1e6, 0);
    const V = palette.vfx ?? {}, M = palette.materials ?? {};
    this.col = {
      flash: lin(V.muzzle ?? '#ffe0a0'), smoke: lin('#7d776e', 0.22), dust: lin(V.dust ?? '#b9976a', 0.85), dirt: lin(V.dirt ?? '#6b5236', 0.95),
      sand: lin(M.sandbag ?? '#a68e66', 0.75), wood: lin(M.timber ?? '#6c4f32', 1), stone: lin(M.concrete ?? '#8a8478', 0.7),
      spark: lin(V.spark ?? '#ffc56b'), blood: lin(V.blood ?? '#5e1410', 0.8), shield: lin('#7fd6ff', 0.9),
    };
    for (const k of ['flash', 'spark', 'shield']) this.col[k] = this.col[k].map((x, i) => (i < 3 ? x * 4 : x));   // hot: blooms
    this.rand = (() => { let s = 0x2545f491; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; }; })();
    // Your own muzzle flash lights the scene.
    this.light = new THREE.PointLight(new THREE.Color(V.muzzle ?? '#ffe0a0'), 0, 9, 2);
    scene.add(this.light);
    this.lightT = 0;
    // Bullet holes.
    const geo = new THREE.PlaneGeometry(1, 1);
    this.holes = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ map: holeTexture(), transparent: true, depthWrite: false, fog: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), HOLES);
    this.holes.count = 0; this.holes.frustumCulled = false; this.holes.renderOrder = 1;
    this.holes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.holes);
    this.holeAt = 0;
    // Spent brass: a casing along local x (scaled per round: a shotgun shell is fatter and red).
    const case_ = new THREE.CylinderGeometry(1, 1, 1, 7, 1).rotateZ(Math.PI / 2);
    // Lit by the scene and a little by itself, so it still glints gold on a night street.
    const brassCol = new THREE.Color(V.brass ?? '#d4a94e');
    this.brass = new THREE.InstancedMesh(case_, new THREE.MeshStandardMaterial({ color: '#ffffff', metalness: 0.55, roughness: 0.3, emissive: brassCol.clone().multiplyScalar(0.32) }), BRASS);
    this.brass.count = 0; this.brass.frustumCulled = false;
    this.brass.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.brass.setColorAt(0, brassCol);   // (makes instanceColor before the shaders are compiled)
    scene.add(this.brass);
    this.brassCol = { brass: brassCol, shell: new THREE.Color(V.shell ?? '#9a2e20') };
    // (The floor: the highest surface at (x, z) at or below y.)
    this.casings = new BrassField(BRASS, {
      rand: this.rand,
      floor: (x, y, z) => (this.world.groundHeight ? this.world.groundHeight(_v.set(x, y - 1.5, z)) : 0),
      onRing: (x, y, z) => { if ((x - this.eye.x) ** 2 + (z - this.eye.z) ** 2 < 12 * 12) bus.emit('fx:brass', { x, y, z, surface: this.world.surfaceAt?.(x, y - 0.02, z) }); },
    });
    this.off = [
      bus.on('weapon:fire', (e) => this.#muzzle(e)),
      bus.on('weapon:chamber', (e) => { const a = this.world.entity(e.id)?.weapons?.current?.s.archetype; if (a === 'shotgun' || a === 'sniper') this.#eject(e.id, a); }),
      bus.on('weapon:impact', (e) => this.#impact(e.point, e.normal, e.surface)),
      bus.on('weapon:hit', (e) => this.#hit(e)),
      bus.on('weapon:magOut', (e) => this.#magOut(e)),
    ];
  }

  dispose() { this.off.forEach((f) => f()); }

  #near(p) { return (p.x - this.eye.x) ** 2 + (p.y - this.eye.y) ** 2 + (p.z - this.eye.z) ** 2 < SEEN * SEEN; }

  // ---------------------------------------------------------------- the muzzle
  /**
   * Where fighter `id`'s muzzle is (the rig's gun when it's posed close up, else from its aim),
   * into `p` and the barrel's direction into `d`; false for a vehicle or nobody. (TracerPool
   * starts its streaks here.)
   */
  muzzleAt(id, p, d = _d2) {
    const ent = this.world.entity(id);
    if (!ent || ent.vehicle || !ent.movement) return false;
    const rec = this.anim?.record(id), pr = rec?.lod <= 1 ? rec.h?.prop : null;
    if (pr?.kind === 'gun') { p.copy(pr.base).addScaledVector(pr.dir, pr.length * 1.02); d.copy(pr.dir); return true; }
    const s = ent.movement.state, w = ent.weapons;
    const yaw = w?.aimYaw ?? s.yaw, pitch = w?.aimPitch ?? 0;
    d.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    p.copy(s.position).addScaledVector(d, 0.8); p.y += s.stance === 'prone' ? 0.35 : s.stance === 'crouch' ? 1.0 : 1.45;
    return true;
  }

  #muzzle(e) {
    if (!this.muzzleAt(e.id, _p, _d) || !this.#near(_p)) return;
    const ent = this.world.entity(e.id);
    const R = this.rand, C = this.col, big = /shotgun|sniper|marksman|heavy|launcher/.test(e.weaponId ?? '') ? 1.5 : 1;
    this.fx.glow.add(_p.x, _p.y, _p.z, _d.x * 3, _d.y * 3, _d.z * 3, 0.035, 0.1 * big, 0.26 * big, C.flash, fade(C.flash), 0, 0);
    this.fx.glow.add(_p.x + _d.x * 0.12, _p.y + _d.y * 0.12, _p.z + _d.z * 0.12, _d.x * 6, _d.y * 6, _d.z * 6, 0.03, 0.06 * big, 0.18 * big, C.flash, fade(C.flash), 0, 0);
    if (!e.suppressed) this.fx.dust.add(_p.x + _d.x * 0.2, _p.y + _d.y * 0.2, _p.z + _d.z * 0.2, _d.x * 1.5 + (R() - 0.5) * 0.3, _d.y * 1.5 + 0.25, _d.z * 1.5 + (R() - 0.5) * 0.3, 0.6, 0.06 * big, 0.3 * big, C.smoke, fade(C.smoke), 2.2, -0.15);
    if (ent === this.player && !e.suppressed) { this.light.position.copy(_p); this.light.intensity = 5 * big; this.lightT = 0.035; }
    const spec = ent?.weapons?.current?.s;
    if (spec && spec.archetype !== 'shotgun' && spec.archetype !== 'sniper' && weaponDesign(spec)[0] === 'gun') this.#eject(e.id, spec.archetype);
  }

  // ---------------------------------------------------------------- brass
  /** Throw fighter `id`'s spent casing out of the gun's ejection port (only a gun the rig is holding, near the camera). */
  #eject(id, archetype) {
    const rec = this.anim?.record(id), pr = rec?.lod <= 1 ? rec.h?.prop : null, ent = this.world.entity(id);
    if (pr?.kind !== 'gun' || !ent?.movement) return;
    _p.copy(pr.base).addScaledVector(pr.dir, pr.length * 0.42);
    if ((_p.x - this.eye.x) ** 2 + (_p.y - this.eye.y) ** 2 + (_p.z - this.eye.z) ** 2 > BRASS_SEEN * BRASS_SEEN) return;
    const R = this.rand, sv = ent.movement.state.velocity;
    _r.crossVectors(pr.dir, pr.up).normalize();                 // the gun's right: the ejection port's side
    _u.crossVectors(_r, pr.dir);
    _p.addScaledVector(_r, 0.035).addScaledVector(_u, 0.03);
    const out = 2 + R() * 0.9, up = 1.8 + R() * 0.8, back = 0.3 + R() * 0.4;
    _d.copy(_r).multiplyScalar(out).addScaledVector(_u, up).addScaledVector(pr.dir, -back);
    _d.x += sv.x; _d.y += Math.max(0, sv.y); _d.z += sv.z;      // carried along at the shooter's speed
    const shell = archetype === 'shotgun';
    const i = this.casings.throw(_p, _d, pr.dir, shell ? CASE.shell : archetype === 'sniper' ? CASE.heavy : CASE.rifle, shell);
    this.brass.setColorAt(i, shell ? this.brassCol.shell : this.brassCol.brass);
    this.brass.instanceColor.needsUpdate = true;
  }

  #brassUpdate(dt) {
    const C = this.casings, n = C.n;
    if (!n) return;
    C.step(dt);
    for (let i = 0; i < n; i++) {
      const k = C.left(i), len = C.size[i * 2], rad = C.size[i * 2 + 1];
      _p.set(C.p[i * 3], C.p[i * 3 + 1], C.p[i * 3 + 2]);
      _m.compose(_p, C.q[i], _s.set(len * 2 * k, rad * k, rad * k));
      this.brass.setMatrixAt(i, _m);
    }
    this.brass.count = n;
    this.brass.instanceMatrix.needsUpdate = true;
  }

  // ---------------------------------------------------------------- impacts
  #impact(point, normal, surface) {
    const p = point;
    if (!p || !this.#near(p)) return;
    _n.set(normal?.x ?? 0, normal?.y ?? 1, normal?.z ?? 0);
    if (_n.lengthSq() < 0.5) _n.set(0, 1, 0);
    const kind = surface ?? (_n.y > 0.7 ? 'dirt' : 'concrete');
    const R = this.rand, C = this.col, F = this.fx;
    const out = (s, up = 0.5) => [_n.x * s + (R() - 0.5) * s * 0.8, _n.y * s + up + R() * up, _n.z * s + (R() - 0.5) * s * 0.8];
    // Every round shows where it landed for a frame or two: a little flash off the surface.
    F.glow.add(p.x + _n.x * 0.03, p.y + _n.y * 0.03, p.z + _n.z * 0.03, 0, 0, 0, 0.04, 0.06, 0.16, C.flash, fade(C.flash), 0, 0);
    if (kind === 'metal' || kind === 'vehicle' || kind === 'hardlight' || kind === 'dome') {
      for (let i = 0; i < 6; i++) { const [vx, vy, vz] = out(4 + R() * 6, 1.2); F.glow.add(p.x, p.y, p.z, vx, vy, vz, 0.22 + R() * 0.2, 0.09, 0.03, C.spark, fade(C.spark), 0.6, 9.8); }
      F.glow.add(p.x, p.y, p.z, 0, 0, 0, 0.06, 0.12, 0.4, C.spark, fade(C.spark), 0, 0);
    } else if (kind === 'wood') {
      for (let i = 0; i < 4; i++) { const [vx, vy, vz] = out(2.5 + R() * 2, 1.2); F.matter.add(p.x, p.y, p.z, vx, vy, vz, 0.5 + R() * 0.3, 0.05, 0.04, C.wood, fade(C.wood), 0.4, 9.8); }
      { const [vx, vy, vz] = out(0.6, 0.2); F.dust.add(p.x, p.y, p.z, vx, vy, vz, 0.5, 0.08, 0.35, C.dust, fade(C.dust), 2, 0); }
    } else if (kind === 'sandbag') {
      for (let i = 0; i < 5; i++) { const [vx, vy, vz] = out(1.5 + R() * 1.5, 1); F.matter.add(p.x, p.y, p.z, vx, vy, vz, 0.45 + R() * 0.3, 0.05, 0.12, C.sand, fade(C.sand), 0.6, 9.8); }
      { const [vx, vy, vz] = out(0.6, 0.3); F.dust.add(p.x, p.y, p.z, vx, vy, vz, 0.8, 0.15, 0.7, C.sand, fade(C.sand), 1.6, -0.05); }
    } else if (kind === 'concrete') {
      for (let i = 0; i < 3; i++) { const [vx, vy, vz] = out(2.5 + R() * 2, 0.8); F.matter.add(p.x, p.y, p.z, vx, vy, vz, 0.4 + R() * 0.2, 0.04, 0.03, C.stone, fade(C.stone), 0.3, 9.8); }
      { const [vx, vy, vz] = out(0.7, 0.2); F.dust.add(p.x, p.y, p.z, vx, vy, vz, 0.6, 0.08, 0.4, C.stone, fade(C.stone), 2, -0.05); }
    } else {
      // Dirt: a puff kicked up off the ground and a few clods.
      // Dirt: clods and a spray of dust thrown up and out, a low cloud that settles.
      for (let i = 0; i < 4; i++) { const [vx, vy, vz] = out(1.4 + R(), 2); F.matter.add(p.x, p.y + 0.05, p.z, vx * 0.6, vy, vz * 0.6, 0.5 + R() * 0.25, 0.06, 0.07, C.dirt, fade(C.dirt), 0.3, 9.8); }
      for (let i = 0; i < 3; i++) { const [vx, vy, vz] = out(0.8 + R() * 0.8, 1.6 + R()); F.dust.add(p.x, p.y + 0.08, p.z, vx * 0.7, vy, vz * 0.7, 0.55 + R() * 0.3, 0.06, 0.32 + R() * 0.15, C.dust, fade(C.dust), 2.4, 1.5); }
      F.dust.add(p.x, p.y + 0.05, p.z, (R() - 0.5) * 0.8, 0.25, (R() - 0.5) * 0.8, 0.7, 0.1, 0.45, C.dust, fade(C.dust), 2, 0);
    }
    if (kind !== 'dome' && kind !== 'hardlight' && (p.x - this.eye.x) ** 2 + (p.z - this.eye.z) ** 2 < 60 * 60) this.#hole(p, _n, kind === 'dirt' ? 0.2 : 0.13);
  }

  #hit(e) {
    const p = e.point;
    if (!p || !this.#near(p)) return;
    const v = this.world.entity(e.victim);
    if (!v) return;
    if (e.armor === 'shield') {
      // An energy shield takes it: a flash of its color where the round met it.
      const R = this.rand, S = this.col.shield;
      for (let i = 0; i < 3; i++) this.fx.glow.add(p.x, p.y, p.z, (R() - 0.5) * 2, (R() - 0.5) * 2, (R() - 0.5) * 2, 0.12, 0.1, 0.35, S, fade(S), 3, 0);
      return;
    }
    if (v.isVehicle || v.isDeployable || e.armor === 'plate' || e.armor === 'barrier' || e.armor === 'vehicle') {
      // Off armor: sparks back toward the shooter.
      const a = this.world.entity(e.attacker)?.movement?.state.position;
      if (a) _n.set(a.x - p.x, 0.3, a.z - p.z).normalize(); else _n.set(0, 1, 0);
      this.#impact(p, _n, 'metal');
      return;
    }
    // Flesh: a dark mist, a little more for a headshot.
    const R = this.rand, C = this.col, n = e.zone === 'head' ? 4 : 2;
    for (let i = 0; i < n; i++) this.fx.dust.add(p.x, p.y, p.z, (R() - 0.5) * 1.2, R() * 0.6, (R() - 0.5) * 1.2, 0.35 + R() * 0.2, 0.06, 0.3, C.blood, fade(C.blood), 2.5, 1);
  }

  /** A reload throws the old mag away: it drops from the gun, tumbling. */
  #magOut(e) {
    const rec = this.anim?.record(e.id), pr = rec?.lod === 0 ? rec.h?.prop : null;
    if (pr?.kind !== 'gun' || !this.#near(pr.base)) return;
    _p.copy(pr.base).addScaledVector(pr.dir, pr.length * 0.35);
    this.fx.matter.add(_p.x, _p.y - 0.08, _p.z, (this.rand() - 0.5) * 0.6, -0.4, (this.rand() - 0.5) * 0.6, 0.55, 0.09, 0.08, MAG, MAG, 0, 9.8);
  }

  /** A hole on the surface at p, facing along n. */
  #hole(p, n, size) {
    _q.setFromUnitVectors(_s.set(0, 0, 1), n);
    _p.copy(p).addScaledVector(n, 0.012);
    const k = size * (0.8 + this.rand() * 0.5);
    _m.compose(_p, _q, _s.set(k, k, k));
    this.holes.setMatrixAt(this.holeAt, _m);
    this.holeAt = (this.holeAt + 1) % HOLES;
    this.holes.count = Math.min(HOLES, this.holes.count + 1);
    this.holes.instanceMatrix.needsUpdate = true;
  }

  update(dt, camera) {
    this.eye.copy(camera.position);
    if (this.lightT > 0) { this.lightT -= dt; if (this.lightT <= 0) this.light.intensity = 0; }
    this.#brassUpdate(dt);
  }
}

