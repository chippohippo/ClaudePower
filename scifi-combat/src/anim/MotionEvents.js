// MotionEvents: watches a fighter's sim state and reports the moments animation must sync to:
// body impacts, cloth rustles and the foot plants inside transitions. Both rigs use it
// (ProceduralHumanoid and ClipAnimationController), so procedural and clip-driven characters
// fire identical events from identical rules. It runs on render frames, so each event lands on
// the frame where the pose changes, not on the sim tick.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Transition path for a stance change (data/animation/humanoid.json `transitions`). */
export function transitionPath(cfg, tr, s) {
  const from = tr.from === 'prone' && s.supine ? 'supine' : tr.from;
  const key = `${from}To${tr.to[0].toUpperCase()}${tr.to.slice(1)}`;
  return cfg.transitions[key] ?? { keys: [[0, tr.from], [1, tr.to]] };
}

export class MotionEvents {
  /**
   * @param {object} cfg       data/animation/humanoid.json
   * @param {object} handlers  { impact(kind, intensity, extra), cloth(kind, intensity), step(foot, gait, stance, intensity, pos) }
   */
  constructor(cfg, handlers) {
    this.cfg = cfg;
    this.h = handlers;
    this.reset();
  }

  reset() {
    this.mode = null; this.stanceKey = null; this.stanceU = 0; this.slideT = 0; this.mantleU = 0;
    this.knockPhase = null; this.sprinting = false; this.airVy = 0; this.mantleSteps = 0; this.deadSeen = false;
  }

  /**
   * @param {object} s     movement state
   * @param {object} opts  { dead: bool, root: Vector3 (render root for positional events) }
   */
  observe(s, { dead = false, root } = {}) {
    const h = this.h, cfg = this.cfg, mode = s.mode;
    if (dead) { if (!this.deadSeen) { h.impact('body', 0.9); this.deadSeen = true; } return; }
    this.deadSeen = false;
    if (mode === 'air') this.airVy = Math.min(this.airVy, s.velocity.y);
    if (mode !== this.mode) {
      const prev = this.mode;
      if (mode === 'dive') h.cloth('dive', 0.9);
      if (prev === 'dive' && mode === 'slide') h.impact('diveLand', 1, { heavy: true });
      if (mode === 'slide' && s.slide?.kind === 'feet') { h.cloth('slide', 0.7); this.slideT = 0; }
      if (mode === 'mantle') { h.cloth('mantle', 0.6); this.mantleU = 0; this.mantleSteps = 0; }
      if (mode === 'knockdown') h.cloth('knockdown', 1);
      if (prev === 'air' && (mode === 'ground' || mode === 'land')) {
        const impact = -this.airVy;
        if (mode === 'land') h.impact('land', clamp(impact / 12, 0.6, 1.2), { heavy: true, impact });
        else if (impact > 1) {
          // A normal landing: both feet plant, the leading one a touch harder.
          const intensity = clamp(impact / 8, 0.3, 0.9);
          h.step(0, 'land', 'stand', intensity, root, { impact });
          h.step(1, 'land', 'stand', intensity * 0.8, root, { impact, quiet: true });
        }
      }
      if (prev === 'mantle' && (mode === 'ground' || mode === 'land') && this.mantleSteps < 2) h.step(0, 'land', 'stand', 0.5, root);
      if (mode === 'air') this.airVy = 0;
      this.mode = mode;
    }
    // Feet-first slide: the hip hits the ground just after the drop.
    if (mode === 'slide' && s.slide?.kind === 'feet') {
      const at = cfg.blend.slideImpact;
      if (this.slideT < at && s.slide.t >= at) h.impact('slide', 0.7);
      this.slideT = s.slide.t;
    }
    // Ledge hand plants, then the feet arriving on top of a climb.
    if (mode === 'mantle' && s.mantle) {
      const m = s.mantle, u = m.duration > 0 ? s.modeTime / m.duration : 1;
      const handAt = m.kind === 'vault' ? 0.2 : 0.18;
      if (this.mantleU < handAt && u >= handAt) h.impact('hands', m.kind === 'vault' ? 0.5 : 0.7);
      if (m.kind === 'climb') {
        if (this.mantleU < 0.72 && u >= 0.72) { h.step(1, 'walk', 'stand', 0.45, m.to); this.mantleSteps++; }
        if (this.mantleU < 0.9 && u >= 0.9) { h.step(0, 'walk', 'stand', 0.4, m.to); this.mantleSteps++; }
      }
      this.mantleU = u;
    }
    // Knockdown: the body slams down; the get-up rustles.
    const kp = s.knock?.phase ?? null;
    if (kp !== this.knockPhase) {
      if (kp === 'ground' && this.knockPhase === 'air') h.impact('body', 1, { heavy: true });
      if (kp === 'getup') h.cloth('getup', 0.6);
      this.knockPhase = kp;
    }
    // Stance transitions: rustle at the start, the body hitting the ground at the drop, a foot plant at the end.
    const tr = s.stanceT;
    const sk = tr ? `${tr.from}>${tr.to}` : null;
    if (sk !== this.stanceKey) {
      if (sk) h.cloth('stance', tr.to === 'prone' || tr.from === 'prone' ? 0.6 : 0.3);
      this.stanceKey = sk; this.stanceU = 0;
    }
    if (tr) {
      const path = transitionPath(cfg, tr, s);
      const u = tr.t / tr.dur;
      if (path.impact !== undefined && this.stanceU < path.impact && u >= path.impact) h.impact('proneDrop', 0.8);
      if (path.plant !== undefined && this.stanceU < path.plant && u >= path.plant) h.step(1, 'walk', 'stand', 0.35, root);
      this.stanceU = u;
    }
    if (s.sprinting !== this.sprinting) { if (s.sprinting) h.cloth('sprint', 0.4); this.sprinting = s.sprinting; }
  }
}
