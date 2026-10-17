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

import * as THREE from 'three';
import { bus } from '../core/EventBus.js';
import { DEFAULT_PALETTE } from '../render/CrowdRenderer.js';

const SEEN = 90;                 // m: no effects past this from the camera
const HOLES = 256;
const _p = new THREE.Vector3(), _d = new THREE.Vector3(), _n = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new THREE.Vector3();

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
    this.off = [
      bus.on('weapon:fire', (e) => this.#muzzle(e)),
      bus.on('weapon:impact', (e) => this.#impact(e.point, e.normal, e.surface)),
      bus.on('weapon:hit', (e) => this.#hit(e)),
      bus.on('weapon:magOut', (e) => this.#magOut(e)),
    ];
  }

  dispose() { this.off.forEach((f) => f()); }

  #near(p) { return (p.x - this.eye.x) ** 2 + (p.y - this.eye.y) ** 2 + (p.z - this.eye.z) ** 2 < SEEN * SEEN; }

  // ---------------------------------------------------------------- the muzzle
  #muzzle(e) {
    const ent = this.world.entity(e.id);
    if (!ent || ent.vehicle) return;
    const rec = this.anim?.record(e.id), pr = rec?.lod <= 1 ? rec.h?.prop : null;
    if (pr?.kind === 'gun') { _p.copy(pr.base).addScaledVector(pr.dir, pr.length * 1.02); _d.copy(pr.dir); }
    else {
      const s = ent.movement.state, w = ent.weapons;
      const yaw = w?.aimYaw ?? s.yaw, pitch = w?.aimPitch ?? 0;
      _d.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
      _p.copy(s.position).addScaledVector(_d, 0.8); _p.y += s.stance === 'prone' ? 0.35 : s.stance === 'crouch' ? 1.0 : 1.45;
    }
    if (!this.#near(_p)) return;
    const R = this.rand, C = this.col, big = /shotgun|sniper|marksman|heavy|launcher/.test(e.weaponId ?? '') ? 1.5 : 1;
    this.fx.glow.add(_p.x, _p.y, _p.z, _d.x * 3, _d.y * 3, _d.z * 3, 0.035, 0.1 * big, 0.26 * big, C.flash, fade(C.flash), 0, 0);
    this.fx.glow.add(_p.x + _d.x * 0.12, _p.y + _d.y * 0.12, _p.z + _d.z * 0.12, _d.x * 6, _d.y * 6, _d.z * 6, 0.03, 0.06 * big, 0.18 * big, C.flash, fade(C.flash), 0, 0);
    if (!e.suppressed) this.fx.dust.add(_p.x + _d.x * 0.2, _p.y + _d.y * 0.2, _p.z + _d.z * 0.2, _d.x * 1.5 + (R() - 0.5) * 0.3, _d.y * 1.5 + 0.25, _d.z * 1.5 + (R() - 0.5) * 0.3, 0.6, 0.06 * big, 0.3 * big, C.smoke, fade(C.smoke), 2.2, -0.15);
    if (ent === this.player && !e.suppressed) { this.light.position.copy(_p); this.light.intensity = 5 * big; this.lightT = 0.035; }
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
  }
}

