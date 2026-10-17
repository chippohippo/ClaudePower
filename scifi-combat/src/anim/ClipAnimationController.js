// ClipAnimationController: drives a skinned GLB character (Mixamo-style clips) from the same sim
// state, and with the same event contract, as ProceduralHumanoid. Art can replace the procedural
// rig per fighter without touching gameplay. Presentation only. Mapping: humanoid.json `clips`.
//
//  * Locomotion: a 1D speed blend space per stance (idle/walk/jog/sprint, crouch, crawl). Clips
//    are phase-synced: one shared phase advances by distance travelled / blended stride, and each
//    clip's time is set from it (aligned on its left heel strike). Blended clips never drift and
//    playback always matches ground speed, so there's no foot sliding at any speed.
//  * Footsteps: emitted when the shared phase crosses the dominant clip's heel-strike markers.
//    Impacts, cloth and transition plants come from MotionEvents (same rules as the procedural rig).
//  * States with a sim timer are scrubbed by it: stance transitions, mantles, get-ups, the dive,
//    landings and reloads can't drift from gameplay. Loops (slide, belly slide, air, lying,
//    seated) crossfade with short, data-driven fades.
//  * Upper body: every base clip is split into lower- and upper-body actions (three.js has no
//    masks, so tracks are filtered). The raised/ADS/reload layer takes over the upper body on the
//    sim's own sprint-to-fire timer; while it's down, the base clip's arms show (sprint port arms).
//  * Additive layers (makeClipAdditive): aim pitch, recoil kicks and directional hit reactions.

import {
  AnimationMixer, AnimationClip, AnimationUtils, PropertyBinding, AdditiveAnimationBlendMode, LoopOnce, LoopRepeat, Vector3,
} from 'three';
import { bus } from '../core/EventBus.js';
import { MotionEvents } from './MotionEvents.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const approach = (rate, dt) => 1 - Math.exp(-rate * dt);
const wrap01 = (x) => x - Math.floor(x);
const table = (rows, x) => {
  if (x <= rows[0][0]) return rows[0][1];
  for (let i = 1; i < rows.length; i++) if (x <= rows[i][0]) { const [x0, y0] = rows[i - 1], [x1, y1] = rows[i]; return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0); }
  return rows[rows.length - 1][1];
};
const norm = (name) => name.toLowerCase().replace(/^.*\|/, '').replace(/mixamo\.com/g, '').replace(/[^a-z0-9]/g, '');

function collectUpper(root, rootName) {
  const want = norm(rootName);
  let start = null;
  root.traverse((o) => { if (!start && norm(o.name).endsWith(want)) start = o; });
  const set = new Set();
  start?.traverse((o) => set.add(o.name));
  return set;
}

function split(clip, upper) {
  const isUpper = (t) => upper.has(PropertyBinding.parseTrackName(t.name).nodeName);
  return {
    lower: new AnimationClip(`${clip.name}#lower`, clip.duration, clip.tracks.filter((t) => !isUpper(t))),
    upper: new AnimationClip(`${clip.name}#upper`, clip.duration, clip.tracks.filter(isUpper)),
  };
}

export class ClipAnimationController {
  /**
   * @param {object} entity  fighter (movement, weapons, melee, vehicle, health)
   * @param {Object3D} model skinned model root (clone per fighter with SkeletonUtils.clone)
   * @param {AnimationClip[]} clips
   * @param {object} cfg     data/animation/humanoid.json
   * @param {object} opts    { surfaceAt(x, y, z) }
   */
  constructor(entity, model, clips, cfg, { surfaceAt = null } = {}) {
    this.e = entity; this.id = entity.id; this.cfg = cfg; this.map = cfg.clips;
    this.model = model;
    this.surfaceAt = surfaceAt;
    this.mixer = new AnimationMixer(model);
    this.clips = new Map(clips.map((c) => [norm(c.name), c]));
    this.upperBones = collectUpper(model, this.map.upperBodyRoot ?? 'Spine');
    this.entries = [];          // every managed base clip: { lower, upper, w, target, timeMode }
    this.byKey = new Map();     // 'loco:stand:2', 'state:dive.forward', 'upper:raised', 'add:recoil'
    this.phase = 0;
    this.prevRoot = new Vector3(); this.hasPrev = false;
    this.gunUp = 0;
    this.raise = 1;
    this.baseKey = 'loco';
    this.motion = new MotionEvents(cfg, {
      impact: (kind, intensity) => this.#emit('anim:impact', { kind, intensity }),
      cloth: (kind, intensity) => this.#emit('anim:cloth', { kind, intensity }),
      step: (foot, gait, stance, intensity, pos) => this.#step(foot, gait, stance, intensity, pos),
    });
    this.#build();
  }

  clip(name) { return name ? this.clips.get(norm(name)) ?? null : null; }

  #entry(key, clip, { loop = true, timeMode = 'free', additive = false, upperOnly = false } = {}) {
    if (!clip) return null;
    const mk = (c) => {
      const a = this.mixer.clipAction(c);
      if (additive) a.blendMode = AdditiveAnimationBlendMode;
      a.setLoop(loop ? LoopRepeat : LoopOnce, Infinity);
      a.clampWhenFinished = !loop;
      if (timeMode !== 'free') a.timeScale = 0;
      a.enabled = true; a.setEffectiveWeight(0); a.play();
      return a;
    };
    let lower = null, upper;
    if (additive) {
      const src = clip.clone();
      AnimationUtils.makeClipAdditive(src);
      upper = mk(src);
    } else if (upperOnly) {
      upper = mk(split(clip, this.upperBones).upper);
    } else {
      const parts = split(clip, this.upperBones);
      lower = mk(parts.lower); upper = mk(parts.upper);
    }
    const en = { key, clip, lower, upper, w: 0, target: 0, timeMode, duration: clip.duration };
    this.entries.push(en);
    this.byKey.set(key, en);
    return en;
  }

  #build() {
    const M = this.map;
    this.loco = {};
    for (const [stance, list] of Object.entries(M.locomotion)) {
      this.loco[stance] = list.map((d, i) => {
        const c = this.clip(d.clip);
        const en = this.#entry(`loco:${stance}:${i}`, c, { timeMode: d.speed > 0 ? 'phase' : 'free' });
        if (en) { en.speed = d.speed; en.steps = d.steps ?? [0, 0.5]; en.stride = d.speed * (c?.duration ?? 1); }
        return en;
      }).filter(Boolean);
    }
    for (const [name, d] of Object.entries(M.states)) {
      for (const [k, v] of Object.entries(d)) {
        if (typeof v !== 'string') continue;
        // Sim-timed clips are scrubbed; everything else loops, except one-shot exits.
        const scrub = d.scrub || name === 'dive' || name === 'land' || name === 'dash' || k === 'enter';
        this.#entry(`state:${name}.${k}`, this.clip(v), { loop: !scrub && k !== 'exit', timeMode: scrub ? 'scrub' : 'free' });
      }
    }
    for (const [k, v] of Object.entries(M.upper)) this.#entry(`upper:${k}`, this.clip(v), { upperOnly: true, timeMode: k === 'reload' ? 'scrub' : 'free' });
    for (const [k, v] of Object.entries(M.additive)) this.#entry(`add:${k}`, this.clip(v), { additive: true, loop: k.startsWith('aim'), timeMode: k.startsWith('aim') ? 'scrub' : 'free' });
    this.add = { recoil: this.byKey.get('add:recoil'), hits: ['hitFront', 'hitBack', 'hitLeft', 'hitRight'].map((k) => this.byKey.get(`add:${k}`)) };
    this.off = [
      bus.on('weapon:recoil', (ev) => ev.id === this.id && this.#oneShot(this.add.recoil, Math.min(1, ev.kick ?? 0.5))),
      bus.on('weapon:hit', (ev) => ev.victim === this.id && this.#hit(ev.attacker)),
      bus.on('melee:hit', (ev) => ev.defender === this.id && this.#hit(ev.attacker)),
    ];
  }

  dispose() { for (const f of this.off) f(); this.mixer.stopAllAction(); }

  #oneShot(en, weight) {
    if (!en) return;
    en.upper.reset(); en.upper.play(); en.target = weight; en.w = weight; en.upper.setEffectiveWeight(weight); en.oneShot = true;
  }

  #hit(attackerId) {
    const s = this.e.movement.state;
    const a = this.getEntity?.(attackerId)?.movement?.state?.position;
    let idx = 0;
    if (a) {
      const dx = s.position.x - a.x, dz = s.position.z - a.z;
      const fx = -Math.sin(s.bodyYaw), fz = -Math.cos(s.bodyYaw);
      const along = dx * fx + dz * fz, side = dx * fz - dz * fx;
      idx = Math.abs(along) > Math.abs(side) ? (along > 0 ? 1 : 0) : side > 0 ? 3 : 2;
    }
    this.#oneShot(this.add.hits[idx], 0.8);
  }

  /**
   * @param {number} dt
   * @param {Vector3} root render-interpolated root
   * @param {object} ctx   { yaw, lag, emit, getEntity }
   */
  update(dt, root, ctx = {}) {
    const e = this.e, s = e.movement.state, M = this.map, lag = ctx.lag ?? 0;
    this.getEntity = ctx.getEntity ?? this.getEntity;
    this.emit = ctx.emit !== false;
    this.root = root;
    if (!this.hasPrev || root.distanceTo(this.prevRoot) > 3) { this.prevRoot.copy(root); this.hasPrev = true; this.motion.reset(); }
    const travel = Math.hypot(root.x - this.prevRoot.x, root.z - this.prevRoot.z);
    this.prevRoot.copy(root);
    this.motion.observe(s, { dead: !!e.health?.dead, root });

    // ---- base: locomotion or a committed state
    for (const en of this.entries) if (!en.key.startsWith('add:') && !en.key.startsWith('upper:')) en.target = 0;
    const base = this.#baseState(s, lag);
    this.baseKey = base.key;
    const fade = base.fade ?? M.fades.locomotion;
    if (base.key === 'loco') this.#locomotion(s, travel, lag);
    else for (const [key, w, t] of base.parts) { const en = this.byKey.get(key); if (!en) continue; en.target = w; if (t !== undefined) en.scrubT = t; }

    // ---- upper layer: weapon up on the sim's timers
    const w = e.weapons, sword = e.mode === 'sword' && e.melee;
    const u = w && w.phaseDuration > 0 ? clamp((w.phaseTime - lag) / w.phaseDuration, 0, 1) : 1;
    let raise = !s.weaponReady || s.sprinting ? 0 : w?.phase === 'sprintRecover' ? u : w?.phase === 'swapping' ? Math.abs(1 - 2 * u) : 1;
    raise *= base.gunUp ?? 1;
    this.raise += (raise - this.raise) * approach(raise < this.raise ? 16 : 45, dt);
    const ads = sword ? 0 : (w?.ads ?? 0);
    const reloading = !sword && w?.phase === 'reloading';
    const up = (k) => this.byKey.get(`upper:${k}`);
    for (const k of Object.keys(M.upper)) { const en = up(k); if (en) en.target = 0; }
    const R = this.raise;
    if (sword) { const g = e.melee.guarding; if (up('guard')) up('guard').target = g ? R : 0; if (up('sword')) up('sword').target = g ? 0 : R; }
    else if (reloading && up('reload')) { up('reload').target = R; up('reload').scrubT = u; }
    else { if (up('raised')) up('raised').target = R * (1 - ads); if (up('ads')) up('ads').target = R * ads; }
    const layerUp = Object.keys(M.upper).reduce((acc, k) => acc + (up(k)?.target ?? 0), 0);
    this.gunUp = clamp(layerUp, 0, 1);

    // ---- additive: aim pitch
    const pitch = w?.weaponPitch ?? 0;
    const aimUp = this.byKey.get('add:aimUp'), aimDown = this.byKey.get('add:aimDown');
    if (aimUp) { aimUp.target = clamp(pitch / 1.2, 0, 1); aimUp.scrubT = 0; }
    if (aimDown) { aimDown.target = clamp(-pitch / 1.2, 0, 1); aimDown.scrubT = 0; }

    // ---- weights, times, mixer
    const rate = 3 / Math.max(0.02, fade);
    for (const en of this.entries) {
      const add = en.key.startsWith('add:'), isUpper = en.key.startsWith('upper:');
      if (en.oneShot) {
        en.w = Math.max(0, en.w - dt * 4); if (en.w <= 0) en.oneShot = false;
      } else {
        en.w += (en.target - en.w) * approach(isUpper ? 3 / M.fades.upper : add ? 30 : rate, dt);
      }
      if (en.w < 1e-4 && en.target === 0) en.w = 0;
      if (en.timeMode === 'phase') { const t = wrap01(this.phase + en.steps[0]) * en.duration; if (en.lower) en.lower.time = t; en.upper.time = t; }
      else if (en.timeMode === 'scrub' && en.scrubT !== undefined) { const t = clamp(en.scrubT, 0, 1) * en.duration * 0.999; if (en.lower) en.lower.time = t; en.upper.time = t; }
      if (en.lower) en.lower.setEffectiveWeight(en.w);
      // Base clips' arms give way to the weapon layer as it comes up.
      en.upper.setEffectiveWeight(isUpper || add ? en.w : en.w * (1 - this.gunUp));
    }
    this.mixer.update(dt);
    this.model.position.copy(root);
    this.model.rotation.y = ctx.yaw ?? s.bodyYaw;
  }

  /** Base state for the sim state (null parts = locomotion). parts: [entryKey, weight, scrub01?]. */
  #baseState(s, lag) {
    const e = this.e, M = this.map.states, has = (k) => this.byKey.has(`state:${k}`);
    if (e.vehicle && has('seated.clip')) return { key: 'seated', parts: [['state:seated.clip', 1]], fade: M.seated.fade };
    switch (s.mode) {
      case 'slide':
        if (s.slide?.kind === 'belly') { const k = `belly.${s.slide.from ?? 'forward'}`; if (has(k)) return { key: 'belly', parts: [[`state:${k}`, 1]], fade: M.belly.fade }; break; }
        if (has('slide.enter') && s.slide.t < (this.byKey.get('state:slide.enter').duration)) return { key: 'slide', parts: [['state:slide.enter', 1, (s.slide.t - lag) / this.byKey.get('state:slide.enter').duration]], fade: M.slide.fade };
        if (has('slide.loop')) return { key: 'slide', parts: [['state:slide.loop', 1]], fade: M.slide.fade };
        break;
      case 'dive': {
        const k = `dive.${s.dive?.kind ?? 'forward'}`;
        if (has(k)) return { key: 'dive', parts: [[`state:${k}`, 1, (s.dive.t - lag) / this.byKey.get(`state:${k}`).duration]], fade: M.dive.fade };
        break;
      }
      case 'air': case 'wallrun': {
        const upK = clamp((s.velocity.y + 1) / 4, 0, 1);
        if (has('air.up')) return { key: 'air', parts: [['state:air.up', upK], ['state:air.fall', 1 - upK]], fade: M.air.fade };
        break;
      }
      case 'land': if (has('land.clip')) return { key: 'land', parts: [['state:land.clip', 1, (s.modeTime - lag) / 0.4]], fade: M.land.fade }; break;
      case 'mantle': {
        const k = s.mantle?.kind === 'vault' ? 'vault' : 'climb';
        if (has(`${k}.clip`)) return { key: k, parts: [[`state:${k}.clip`, 1, (s.modeTime - lag) / (s.mantle?.duration ?? 0.5)]], fade: M[k].fade, gunUp: 0 };
        break;
      }
      case 'knockdown': {
        const kn = s.knock;
        if (kn?.phase === 'air' && has('knockAir.clip')) return { key: 'knock', parts: [['state:knockAir.clip', 1]], fade: M.knockAir.fade, gunUp: 0 };
        if (kn?.phase === 'ground') { const k = kn.supine ? 'knockBack' : 'knockFront'; if (has(`${k}.clip`)) return { key: 'knock', parts: [[`state:${k}.clip`, 1]], fade: M[k].fade, gunUp: 0 }; }
        if (kn?.phase === 'getup') { const k = kn.supine ? 'getupBack' : 'getupFront'; if (has(`${k}.clip`)) return { key: 'getup', parts: [[`state:${k}.clip`, 1, (kn.t - lag) / (this.e.movement.t?.knockdown?.getUpTime ?? 0.85)]], fade: M[k].fade, gunUp: 0 }; }
        break;
      }
      case 'dodge': if (has('dash.clip') && s.dodgeStyle !== 'shoulderBash') return { key: 'dash', parts: [['state:dash.clip', 1, s.modeTime / 0.24]], fade: M.dash.fade }; break;
      default: {
        const tr = s.stanceT;
        if (tr && tr.to === 'prone' && tr.from === 'stand' && has('standToProne.clip')) return { key: 'stanceClip', parts: [['state:standToProne.clip', 1, (tr.t - lag) / tr.dur]], fade: M.standToProne.fade, gunUp: 0 };
        if (tr && tr.from === 'prone' && tr.to === 'stand' && has('proneToStand.clip')) return { key: 'stanceClip', parts: [['state:proneToStand.clip', 1, (tr.t - lag) / tr.dur]], fade: M.proneToStand.fade, gunUp: 0 };
      }
    }
    return { key: 'loco' };
  }

  /** Phase-synced speed blend per stance; stance changes crossfade on the sim's stanceT progress. */
  #locomotion(s, travel, lag) {
    const tr = s.stanceT;
    const stanceW = { stand: 0, crouch: 0, prone: 0 };
    if (tr) { const u = clamp((tr.t - lag) / tr.dur, 0, 1); stanceW[tr.from] += 1 - u; stanceW[tr.to] += u; } else stanceW[s.stance] = 1;
    const v = s.speed;
    let strideSum = 0, strideW = 0, dominant = null, domW = 0;
    for (const [stance, list] of Object.entries(this.loco)) {
      const sw = stanceW[stance] ?? 0;
      if (sw <= 0 || !list.length) continue;
      const ws = this.#speedWeights(list, v);
      for (let i = 0; i < list.length; i++) {
        const en = list[i], wi = ws[i] * sw;
        en.target = wi;
        if (en.speed > 0 && wi > 0) { strideSum += en.stride * wi; strideW += wi; if (wi > domW) { domW = wi; dominant = en; } }
      }
    }
    const stride = strideW > 0 ? strideSum / strideW : 1;
    const before = this.phase;
    this.phase += travel / Math.max(0.1, stride);
    // Footsteps: heel strikes of the dominant clip, only while actually walking.
    if (dominant && strideW > 0.5 && travel > 0) {
      const off = wrap01(dominant.steps[1] - dominant.steps[0]);
      const crouchK = stanceW.crouch, stance = stanceW.prone > 0.5 ? 'prone' : crouchK > 0.5 ? 'crouch' : 'stand';
      if (Math.floor(before) !== Math.floor(this.phase)) this.#footstep(0, stance, crouchK);
      if (Math.floor(before - off) !== Math.floor(this.phase - off)) this.#footstep(1, stance, crouchK);
    }
  }

  /** Weights over a speed-sorted clip list (idle at speed 0), linear between neighbours. */
  #speedWeights(list, v) {
    const out = list.map(() => 0);
    if (v <= list[0].speed) { out[0] = 1; return out; }
    for (let i = 1; i < list.length; i++) {
      if (v <= list[i].speed) { const k = (v - list[i - 1].speed) / (list[i].speed - list[i - 1].speed); out[i - 1] = 1 - k; out[i] = k; return out; }
    }
    out[list.length - 1] = 1;
    return out;
  }

  #footstep(foot, stance, crouchK) {
    const s = this.e.movement.state, g = this.cfg.gait, fs = this.cfg.footstep;
    let intensity = stance === 'prone' ? table(g.prone.intensity, s.speed) : table(g.stand.intensity, s.speed) * (1 - crouchK) + table(g.crouch.intensity, s.speed) * crouchK;
    intensity *= (fs.stanceMul[stance] ?? 1) * (fs.armorMul[this.e.movement.armor ?? 'medium'] ?? 1);
    const gait = stance === 'prone' ? 'crawl' : stance === 'crouch' ? 'crouch' : s.gait === 'idle' ? 'walk' : s.gait;
    this.#step(foot, gait, stance, intensity, this.root);
  }

  #step(foot, gait, stance, intensity, pos) {
    if (!this.emit) return;
    const p = pos ?? this.root;
    bus.emit('anim:footstep', { id: this.id, foot, gait, stance, intensity, surface: this.surfaceAt?.(p.x, p.y, p.z) ?? 'dirt', x: p.x, y: p.y, z: p.z, speed: this.e.movement.state.speed });
  }

  #emit(type, extra) {
    if (!this.emit) return;
    const p = this.root;
    bus.emit(type, { id: this.id, ...extra, surface: this.surfaceAt?.(p.x, p.y, p.z) ?? 'dirt', x: p.x, y: p.y, z: p.z });
  }

  /** Current effective base weights (for tests and the debug overlay). */
  weights() { return Object.fromEntries(this.entries.filter((e) => e.w > 1e-3).map((e) => [e.key, +e.w.toFixed(3)])); }
}
