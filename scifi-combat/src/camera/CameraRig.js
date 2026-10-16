// CameraRig — single PerspectiveCamera that blends between first person (head anchor) and a
// TLOU-style over-the-shoulder third person. Adds spring follow, collision pull-in, FOV kicks,
// subtle speed-scaled head bob and trauma-based shake. Presentation only (never in the sim).

import { MathUtils, PerspectiveCamera, Raycaster, Vector3, Quaternion, Euler } from 'three';
import { bus } from '../core/EventBus.js';

const _target = new Vector3();
const _offset = new Vector3();
const _dir = new Vector3();
const _q = new Quaternion();
const _e = new Euler(0, 0, 0, 'YXZ');

// Cheap smooth 1D noise for shake (sum of sines; deterministic, no allocation).
const noise = (t, seed) => Math.sin(t * 17.3 + seed) * 0.5 + Math.sin(t * 31.7 + seed * 2.1) * 0.3 + Math.sin(t * 7.1 + seed * 3.3) * 0.2;

export class CameraRig {
  constructor({ aspect = innerWidth / innerHeight, collidables = [], settings = {} } = {}) {
    this.camera = new PerspectiveCamera(72, aspect, 0.05, 2000);
    this.collidables = collidables;
    this.ray = new Raycaster();
    this.settings = { reducedMotion: false, shakeScale: 1, bobScale: 1, baseFov: 72, ...settings };

    this.pov = 0;              // 0 = third person, 1 = first person (blended)
    this.povTarget = 0;
    this.shoulder = 1;         // +1 right shoulder, -1 left
    this.shoulderBlend = 1;
    this.tpOffset = new Vector3(0.45, 0.25, 2.6); // x = shoulder, z = distance behind
    this.adsOffset = new Vector3(0.38, 0.15, 1.4);
    this.ads = 0;

    this.pos = new Vector3();  // smoothed pivot
    this.trauma = 0;           // 0..1, shake = trauma²
    this.fovKick = 0;
    this.bobPhase = 0;
    this.time = 0;
    this.collisionDist = this.tpOffset.z;

    bus.on('melee:parry', () => this.addTrauma(0.35, 3));
    bus.on('melee:hit', (e) => this.addTrauma(e.crit ? 0.3 : 0.18));
    bus.on('melee:guardBreak', () => this.addTrauma(0.45));
    bus.on('move:land', (e) => this.addTrauma(MathUtils.clamp((e.impact - 6) / 20, 0, 0.35)));
    bus.on('move:slide', () => { this.fovKick = 10; });
    bus.on('weapon:fire', (e) => this.addTrauma(e.shake ?? 0.05));
  }

  addTrauma(amount, fovPunch = 0) {
    this.trauma = Math.min(1, this.trauma + amount);
    this.fovKick += fovPunch;
  }
  togglePOV() { this.povTarget = this.povTarget ? 0 : 1; }
  swapShoulder() { this.shoulder *= -1; }

  /**
   * @param {object} m   movement state (position, velocity, yaw, stance, mode, grounded, sprinting)
   * @param {number} pitch
   * @param {number} eyeHeight current capsule eye height (stance-dependent)
   */
  update(dt, m, pitch, eyeHeight, adsHeld = false) {
    const s = this.settings;
    this.time += dt;

    // Smooth blends — framerate-independent exponential damping.
    const damp = (cur, tgt, lambda) => MathUtils.damp(cur, tgt, lambda, dt);
    this.pov = damp(this.pov, this.povTarget, 12);
    this.shoulderBlend = damp(this.shoulderBlend, this.shoulder, 10);
    this.ads = damp(this.ads, adsHeld ? 1 : 0, 14);

    // Pivot follows character with slight vertical lag (feels weighty on landings/stairs).
    _target.set(m.position.x, m.position.y + eyeHeight, m.position.z);
    this.pos.x = damp(this.pos.x, _target.x, 30);
    this.pos.z = damp(this.pos.z, _target.z, 30);
    this.pos.y = damp(this.pos.y, _target.y, 14);

    // Orientation
    _e.set(pitch, m.yaw, 0);
    _q.setFromEuler(_e);

    // Third-person offset (shoulder + distance), shrinking to ADS offset.
    _offset.lerpVectors(this.tpOffset, this.adsOffset, this.ads);
    _offset.x *= this.shoulderBlend;
    // Collision: cast from pivot to desired cam pos; pull in fast, ease out slow (no popping).
    _dir.copy(_offset).applyQuaternion(_q);
    const want = _dir.length();
    _dir.normalize();
    let allowed = want;
    if (this.collidables.length) {
      this.ray.set(this.pos, _dir); this.ray.far = want + 0.2;
      const hit = this.ray.intersectObjects(this.collidables, true)[0];
      if (hit) allowed = Math.max(0.3, hit.distance - 0.2);
    }
    this.collisionDist = allowed < this.collisionDist ? allowed : damp(this.collisionDist, allowed, 4);
    const tpPos = _target.copy(this.pos).addScaledVector(_dir, this.collisionDist);

    // Blend 1P ↔ 3P positions.
    this.camera.position.lerpVectors(tpPos, this.pos, this.pov);
    this.camera.quaternion.copy(_q);

    // Head bob — only in first person, scales with speed, tiny amplitude, disabled in reduced motion.
    const speed = Math.hypot(m.velocity.x, m.velocity.z);
    if (m.grounded && speed > 0.5) this.bobPhase += dt * (6 + speed * 0.9);
    const bobAmt = s.reducedMotion ? 0 : Math.min(0.015, speed * 0.002) * s.bobScale * this.pov * (1 - this.ads);
    this.camera.position.y += Math.sin(this.bobPhase * 2) * bobAmt;
    this.camera.position.addScaledVector(_dir.set(1, 0, 0).applyQuaternion(_q), Math.cos(this.bobPhase) * bobAmt * 0.6);

    // Trauma shake: rotational, squared falloff, clamped. Translational shake causes nausea → avoided in 1P.
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const shake = this.trauma * this.trauma * s.shakeScale * (s.reducedMotion ? 0.25 : 1);
    if (shake > 0) {
      const maxAngle = 0.045;
      this.camera.rotateX(noise(this.time, 1) * maxAngle * shake);
      this.camera.rotateY(noise(this.time, 7) * maxAngle * shake);
      this.camera.rotateZ(noise(this.time, 13) * maxAngle * 0.6 * shake);
    }

    // FOV: sprint widens, ADS narrows, kicks decay.
    this.fovKick = damp(this.fovKick, 0, 5);
    const sprintFov = m.sprinting ? 6 : 0;
    const fov = s.baseFov + sprintFov + (s.reducedMotion ? 0 : this.fovKick) - this.ads * 18;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = damp(this.camera.fov, fov, 10);
      this.camera.updateProjectionMatrix();
    }
  }
}
