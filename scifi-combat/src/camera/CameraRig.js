// CameraRig: Helldivers 2-style third-person camera. Presentation only (never in the sim).
//
//  * Look is zero-latency: yaw and pitch come straight from the latest input every render frame.
//    Only the camera's position lags.
//  * Position follows the body with a slight, stiff lag: critically damped springs at about
//    40 ms horizontal and about 70 ms vertical. It reads as weight, never as float.
//  * Over-the-shoulder framing per stance (stand, crouch, prone), pulled back while sprinting,
//    tight for ADS, and wide for vehicles.
//  * Bob is event-driven: every footfall the animation plants (anim:footstep) kicks a stiff
//    spring down with a small rebound (the "thud"), plus an alternating roll. It scales with gait
//    and stance (sprint thuds, prone barely moves) and never wanders like a sine-wave bob.
//  * Sway: the camera banks into sprint carves.
//  * FOV: widens with sprint speed, slides and dives; punches on dive start and dips on heavy landings.
//  * Shake: trauma-squared noise from explosions, hits and knockdowns. Reduced motion scales it all down.

import { MathUtils, PerspectiveCamera, Vector3, Quaternion, Euler } from 'three';
import { bus } from '../core/EventBus.js';
import { Spring } from '../core/Spring.js';

const _target = new Vector3();
const _off = new Vector3();
const _dir = new Vector3();
const _q = new Quaternion();
const _e = new Euler(0, 0, 0, 'YXZ');
const noise = (t, seed) => Math.sin(t * 17.3 + seed) * 0.5 + Math.sin(t * 31.7 + seed * 2.1) * 0.3 + Math.sin(t * 7.1 + seed * 3.3) * 0.2;

// Framing per state: right (shoulder) offset, height above the eye, distance behind.
const FRAMING = {
  stand:  { right: 0.55, up: 0.18, dist: 2.35 },
  crouch: { right: 0.50, up: 0.20, dist: 2.20 },
  prone:  { right: 0.45, up: 0.38, dist: 2.00 },
  slide:  { right: 0.50, up: 0.30, dist: 2.40 },
  dive:   { right: 0.50, up: 0.35, dist: 2.60 },
  ads:    { right: 0.42, up: 0.12, dist: 1.20 },
};
const EYE = { stand: 1.62, crouch: 1.12, prone: 0.45, slide: 0.9, dive: 0.85, knockdown: 0.5, seated: 1.6 };

export class CameraRig {
  /**
   * @param {object} opts { aspect, raycast(o, dir, max) -> { distance } | null, settings }
   */
  constructor({ aspect = innerWidth / innerHeight, raycast = null, settings = {} } = {}) {
    this.camera = new PerspectiveCamera(70, aspect, 0.05, 3000);
    this.raycast = raycast;
    this.settings = { reducedMotion: false, shakeScale: 1, bobScale: 1, baseFov: 70, fovEffects: true, ...settings };
    this.targetId = null;
    this.shoulder = 1;
    this.shoulderBlend = new Spring(10, 1, 1);
    this.povTarget = 0;              // 0 third person (HD2 default), 1 first person
    this.pov = new Spring(14, 1, 0);
    this.followX = new Spring(24); this.followY = new Spring(14); this.followZ = new Spring(24);
    this.frame = { right: new Spring(10, 1, 0.55), up: new Spring(10, 1, 0.18), dist: new Spring(8, 1, 2.35) };
    this.eye = new Spring(16, 1, 1.62);
    this.bobY = new Spring(26, 0.45); this.bobRoll = new Spring(14, 0.6); this.bobPitch = new Spring(20, 0.5);
    this.sway = new Spring(8, 1);
    this.fov = new Spring(9, 1, 70);
    this.fovKick = 0;
    this.collisionDist = 2.35;
    this.trauma = 0;
    this.time = 0;
    this.initialized = false;
    this.lastFoot = 0;

    bus.on('anim:footstep', (e) => this.#footstep(e));
    bus.on('move:dive', (e) => e.id === this.targetId && (this.fovKick += 5));
    bus.on('move:land', (e) => { if (e.id !== this.targetId) return; this.fovKick -= e.heavy ? 4 : 1; this.bobY.v -= Math.min(2.2, e.impact * 0.12); if (e.heavy) this.addTrauma(0.18); });
    bus.on('move:diveLand', (e) => { if (e.id !== this.targetId) return; this.bobY.v -= 1.4; this.addTrauma(0.12); });
    bus.on('move:knockdown', (e) => { if (e.id !== this.targetId) return; this.addTrauma(0.4); this.fovKick += 6; });
    bus.on('move:slide', (e) => e.id === this.targetId && (this.bobY.v -= 0.8));
    bus.on('melee:parry', () => this.addTrauma(0.3));
    bus.on('melee:hit', (e) => (e.defender === this.targetId || e.attacker === this.targetId) && this.addTrauma(e.crit ? 0.3 : 0.16));
    bus.on('melee:guardBreak', () => this.addTrauma(0.4));
    bus.on('weapon:fire', (e) => e.id === this.targetId && this.addTrauma(e.shake ?? 0.05));
    bus.on('projectile:explode', (e) => this.#explosion(e));
    bus.on('stratagem:land', (e) => this.#explosion({ point: { x: e.at[0], y: e.at[1], z: e.at[2] }, radius: 3.5 }));   // a pod slamming in
  }

  addTrauma(amount) { this.trauma = Math.min(1, this.trauma + amount); }
  togglePOV() { this.povTarget = this.povTarget ? 0 : 1; }
  swapShoulder() { this.shoulder *= -1; }

  #footstep(e) {
    if (e.id !== this.targetId) return;
    // The thud: a downward kick into a stiff, slightly underdamped spring, plus alternating roll.
    const k = (this.settings.reducedMotion ? 0.25 : 1) * this.settings.bobScale;
    this.bobY.v -= e.intensity * 0.55 * k;
    this.bobPitch.v += e.intensity * 0.04 * k;
    if (!this.settings.reducedMotion) this.bobRoll.v += (e.foot === 0 ? 1 : -1) * e.intensity * 0.06 * k;
  }

  #explosion(e) {
    if (!this.camera) return;
    const p = this.camera.position;
    const d = Math.hypot(e.point.x - p.x, e.point.y - p.y, e.point.z - p.z);
    const r = (e.radius ?? 3) * 4;
    if (d < r) this.addTrauma(0.5 * (1 - d / r));
  }

  /**
   * @param {number} dt
   * @param {object} o {
   *   target: fighter entity (movement.state used),   pos: render-interpolated position (Vector3),
   *   yaw, pitch: look angles (input, zero-latency, recoil included),
   *   ads: 0..1, adsFov: weapon ADS FOV, vehicle: { distance, height } | null, scale: silhouette scale }
   */
  update(dt, o) {
    const s = this.settings, st = o.target.movement.state;
    this.time += dt;
    this.targetId = o.target.id;
    const scale = o.scale ?? 1;

    // ---- framing for the current state
    let f = FRAMING.stand, eye = EYE.stand;
    const mode = st.mode;
    if (o.vehicle) { f = { right: 0, up: o.vehicle.height * 0.3, dist: o.vehicle.distance }; eye = EYE.seated; }
    else if (mode === 'dive') { f = FRAMING.dive; eye = EYE.dive; }
    else if (mode === 'slide') { f = st.slide?.kind === 'belly' ? FRAMING.prone : FRAMING.slide; eye = st.slide?.kind === 'belly' ? EYE.prone : EYE.slide; }
    else if (mode === 'knockdown' || mode === 'ragdoll') { f = FRAMING.dive; eye = EYE.knockdown; }
    else {
      const stance = st.stanceT ? (st.stanceT.t / st.stanceT.dur > 0.5 ? st.stanceT.to : st.stanceT.from) : st.stance;
      f = FRAMING[stance] ?? FRAMING.stand; eye = EYE[stance] ?? EYE.stand;
    }
    const ads = o.ads ?? 0;
    const sprintPull = st.sprinting ? 0.35 : 0;
    const right = MathUtils.lerp(f.right, FRAMING.ads.right, ads) * scale;
    const up = MathUtils.lerp(f.up, FRAMING.ads.up, ads) * scale;
    const dist = (MathUtils.lerp(f.dist + sprintPull, FRAMING.ads.dist, ads)) * (o.vehicle ? 1 : scale);
    this.frame.right.step(right, dt); this.frame.up.step(up, dt); this.frame.dist.step(dist, dt);
    this.eye.step(eye * (o.vehicle ? 1 : scale), dt);
    this.shoulderBlend.step(this.shoulder, dt);
    this.pov.step(o.vehicle ? 0 : this.povTarget, dt);

    // ---- follow: stiff springs on the pivot (slight lag = weight, never float)
    _target.set(o.pos.x, o.pos.y + this.eye.x, o.pos.z);
    if (!this.initialized) {
      this.followX.x = _target.x; this.followY.x = _target.y; this.followZ.x = _target.z; this.initialized = true;
    }
    const px = this.followX.step(_target.x, dt), py = this.followY.step(_target.y, dt), pz = this.followZ.step(_target.z, dt);

    // ---- bob and sway springs relax toward zero; footsteps kick them
    this.bobY.step(0, dt); this.bobRoll.step(0, dt); this.bobPitch.step(0, dt);
    const swayTarget = s.reducedMotion ? 0 : MathUtils.clamp(-(st.bodyTurnRate ?? 0) * Math.min(1, (st.speed ?? 0) / 7) * 0.012, -0.045, 0.045);
    this.sway.step(swayTarget, dt);

    // ---- orientation (zero-latency look) + bob pitch/roll
    _e.set(o.pitch + this.bobPitch.x, o.yaw, this.bobRoll.x + this.sway.x);
    _q.setFromEuler(_e);

    // ---- desired camera position: pivot + shoulder offset + back, with collision pull-in
    _off.set(right * this.shoulderBlend.x, this.frame.up.x, this.frame.dist.x).applyQuaternion(_q);
    const want = _off.length();
    _dir.copy(_off).divideScalar(want || 1);
    const pivot = _target.set(px, py, pz);
    let allowed = want;
    if (this.raycast) {
      const hit = this.raycast(pivot, _dir, want + 0.3);
      if (hit) allowed = Math.max(0.3, hit.distance - 0.25);
    }
    // Pull in instantly (never clip through walls), ease back out.
    this.collisionDist = allowed < this.collisionDist ? allowed : MathUtils.damp(this.collisionDist, allowed, 4, dt);
    const tp = pivot.clone().addScaledVector(_dir, this.collisionDist);
    tp.y += this.bobY.x * 0.06;

    // First person (optional): the camera sits at the eye.
    this.camera.position.lerpVectors(tp, pivot, this.pov.x);
    this.camera.quaternion.copy(_q);

    // ---- shake: trauma squared, rotational only (translational shake is what makes people sick)
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const shake = this.trauma * this.trauma * s.shakeScale * (s.reducedMotion ? 0.25 : 1);
    if (shake > 0) {
      const m = 0.045;
      this.camera.rotateX(noise(this.time, 1) * m * shake);
      this.camera.rotateY(noise(this.time, 7) * m * shake);
      this.camera.rotateZ(noise(this.time, 13) * m * 0.6 * shake);
    }

    // ---- FOV: sprint speed, slides and dives widen; kicks decay; ADS narrows to the weapon's ADS FOV
    let fov = s.baseFov;
    if (s.fovEffects && !s.reducedMotion) {
      const sprintK = st.sprinting ? MathUtils.clamp(((st.speed ?? 0) - 4.5) / 2.7, 0, 1) : 0;
      fov += 6 * sprintK + (mode === 'slide' ? 8 : 0) + (mode === 'dive' ? 10 : 0) + this.fovKick;
    }
    this.fovKick = MathUtils.damp(this.fovKick, 0, 5, dt);
    fov = MathUtils.lerp(fov, o.adsFov ?? s.baseFov * 0.78, ads);
    this.fov.step(fov, dt);
    if (Math.abs(this.camera.fov - this.fov.x) > 0.01) { this.camera.fov = this.fov.x; this.camera.updateProjectionMatrix(); }
  }
}
