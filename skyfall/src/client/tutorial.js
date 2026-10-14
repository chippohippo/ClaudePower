// Guided tutorial, played in the Firing Range: a checklist of the basics that ticks itself off as
// you do each thing. ENTER skips a step. Finishing grants a one-time XP bonus.

const STEPS = [
  { id: 'move', text: 'Move with <b>WASD</b> and look around with the mouse', check: (g, s) => s.moved > 12 },
  { id: 'sprint', text: 'Hold <b>SHIFT</b> to sprint', check: (g) => Math.hypot(g.pred.vx, g.pred.vz) > 6.6 },
  { id: 'jump', text: 'Press <b>SPACE</b> to jump', check: (g) => !g.pred.onGround && g.pred.vy > 1 },
  { id: 'slide', text: 'Sprint, then press <b>C</b> / <b>CTRL</b> to slide', check: (g) => g.pred.mode === 'slide' },
  { id: 'slidehop', text: 'Jump out of a slide (<b>SPACE</b> while sliding) to keep your speed', check: (g, s) => s.slideJump },
  { id: 'mantle', text: 'Run at a ledge or crate and hold <b>SPACE</b> to climb over it', check: (g) => g.pred.mode === 'mantle' },
  { id: 'pickup', text: 'Look at loot on the ground and press <b>E</b> to pick it up', check: (g, s) => s.ev.pickup },
  { id: 'reload', text: 'Press <b>R</b> to reload', check: (g, s) => s.ev.reload },
  { id: 'ads', text: 'Hold <b>RIGHT MOUSE</b> to aim down sights', check: (g) => g.adsAmt > 0.8 },
  { id: 'shoot', text: 'Shoot a target dummy (<b>LEFT MOUSE</b>)', check: (g, s) => s.ev.hit },
  { id: 'ping', text: 'Press <b>X</b> (or middle mouse) to ping. Double-tap X: "enemy was here"', check: (g, s) => s.ev.ping },
  { id: 'abil', text: 'Use your tactical ability with <b>Q</b>', check: (g, s) => s.ev.abil },
];

export class Tutorial {
  constructor(onDone) {
    this.i = 0;
    this.state = { moved: 0, ev: {}, slideJump: false, lastX: null, lastZ: null };
    this.onDone = onDone;
    this.done = false;
    this.el = document.createElement('div');
    this.el.id = 'tutorial';
    document.body.appendChild(this.el);
    this.skip = (e) => { if (e.code === 'Enter' && !this.done) this._advance(); };
    addEventListener('keydown', this.skip);
    this._render();
  }

  // called by the game for things that are easier to flag than to poll
  flag(name) { this.state.ev[name] = true; }

  update(g) {
    if (this.done || !g.pred) return;
    const s = this.state;
    if (s.lastX !== null) s.moved += Math.hypot(g.pred.x - s.lastX, g.pred.z - s.lastZ);
    s.lastX = g.pred.x; s.lastZ = g.pred.z;
    if (s.wasSlide && !g.pred.onGround && g.pred.vy > 1) s.slideJump = true;
    s.wasSlide = g.pred.mode === 'slide' || (s.wasSlide && !g.pred.onGround);
    if (STEPS[this.i].check(g, s)) this._advance();
  }

  _advance() {
    this.i++;
    if (this.i >= STEPS.length) {
      this.done = true;
      this.el.innerHTML = '<div class="tut-title">TUTORIAL COMPLETE</div><div class="tut-step">You know the basics. Press <b>ESC</b> → LEAVE MATCH, then hit <b>PLAY</b>.</div>';
      if (this.onDone) this.onDone();
      setTimeout(() => this.dispose(), 9000);
      return;
    }
    this._render();
  }

  _render() {
    const list = STEPS.map((st, k) => `<div class="tut-step${k < this.i ? ' ok' : k === this.i ? ' cur' : ''}">${k < this.i ? '✔' : k === this.i ? '▶' : '·'} ${st.text}</div>`).join('');
    this.el.innerHTML = `<div class="tut-title">TUTORIAL · ${this.i + 1}/${STEPS.length} <small>[ENTER] skip step</small></div>${list}`;
  }

  dispose() {
    removeEventListener('keydown', this.skip);
    this.el.remove();
  }
}
