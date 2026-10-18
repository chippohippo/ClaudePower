// BarkVoices: the soldiers' callouts out loud (docs/GAMEPLAY_PLAN.md §6; the sim's Barks). Your
// squad is heard at any range, any other soldier within `hear` m (40: you hear the enemy's plan
// too). Spoken with the browser's speech synthesis, a voice per army (the Solari brisk and
// bright, the Void low and slow), quieter with distance, and written up as radio chatter at the
// bottom left (the reference clips' style): your squad's lines on an amber rule with the
// speaker's rank and name (your squad leader is the sergeant), anyone else's dimmer, named in
// his side's colour (yours blue, theirs red). One voice at a time: your squad's lines cut in
// ahead of the rest; at most two wait. ?voices=off keeps the chatter and drops the voices.

import { bus } from '../core/EventBus.js';

const US = '#5ab4ff', THEM = '#ff4d4d', AMBER = '#ffc94d';
const VOICE = [{ pitch: 1.05, rate: 1.12 }, { pitch: 0.55, rate: 0.92 }];
const CSS = `
#bark-subs { position: absolute; left: 24px; bottom: calc(var(--lb, 0px) + 16px + 132px * var(--hz, 1)); pointer-events: none; text-align: left; max-width: 46vw;
  transform: scale(var(--hz, 1)); transform-origin: bottom left;
  font: 600 16px var(--text, system-ui); letter-spacing: .02em; text-shadow: 0 1px 2px #000c, 0 0 8px #0008; color: #f4f1e8; }
#bark-subs div { margin-top: 6px; padding: 1px 0 1px 10px; border-left: 2px solid ${AMBER}; transition: opacity .3s; }
#bark-subs b { font: 700 11px var(--disp, system-ui); letter-spacing: 1.5px; margin-right: 10px; text-transform: uppercase; }
#bark-subs .far { opacity: .7; font-size: 14px; border-left-color: #ffffff40; }
`;

export class BarkVoices {
  /** @param {HTMLElement} root the HUD @param {object} o { player, world, hear, voices } */
  constructor(root, { player, world, hear = 40, voices = true }) {
    this.player = player; this.world = world; this.hear = hear;
    this.synth = voices && typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
    if (!document.getElementById('bark-css')) document.head.appendChild(Object.assign(document.createElement('style'), { id: 'bark-css', textContent: CSS }));
    this.el = Object.assign(document.createElement('div'), { id: 'bark-subs' });
    root.appendChild(this.el);
    this.lines = [];            // subtitles: { el, until }
    this.queue = [];            // waiting to be spoken
    this.time = 0;
    this.off = [bus.on('squad:bark', (e) => this.#heard(e))];
  }

  dispose() { this.off.forEach((f) => f()); this.el.remove(); this.synth?.cancel(); }

  /** Voices on or off (the options); the chatter stays written up either way. */
  setVoices(on) {
    if (!on) { this.synth?.cancel(); this.synth = null; this.queue.length = 0; return; }
    this.synth ??= typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
  }

  #heard(e) {
    const me = this.player, p = me.movement.state.position;
    const d = Math.hypot(e.at[0] - p.x, e.at[2] - p.z);
    const mine = e.team === me.team && me.squad && e.squad === me.squad.id;
    if (!mine && d > this.hear) return;
    // The radio line.
    const el = document.createElement('div');
    if (!mine) el.className = 'far';
    const rank = mine ? (me.squad.leader?.id === e.id ? 'SGT ' : 'PVT ') : '';
    el.innerHTML = `<b style="color:${mine ? AMBER : e.team === me.team ? US : THEM}">${rank}${e.name ?? '?'}</b>${e.text}`;
    this.el.appendChild(el);
    this.lines.push({ el, until: this.time + 2.6 + e.text.length * 0.03 });
    while (this.lines.length > 3) this.lines.shift().el.remove();
    // The voice.
    if (!this.synth) return;
    const u = new SpeechSynthesisUtterance(e.text), V = VOICE[e.team] ?? VOICE[0];
    u.pitch = V.pitch; u.rate = V.rate; u.volume = mine ? 0.9 : Math.max(0.15, 0.85 * (1 - d / this.hear));
    const voices = this.synth.getVoices().filter((v) => v.lang?.startsWith('en'));
    if (voices.length) u.voice = voices[(e.team * 3 + (e.id % 2)) % voices.length];
    if (mine) { this.queue = this.queue.filter((q) => q.mine); this.queue.unshift({ u, mine }); }
    else this.queue.push({ u, mine });
    this.queue.length = Math.min(this.queue.length, 2);
  }

  update(dt) {
    this.time += dt;
    for (let i = this.lines.length - 1; i >= 0; i--) {
      const l = this.lines[i];
      if (this.time > l.until) { l.el.remove(); this.lines.splice(i, 1); } else if (this.time > l.until - 0.3) l.el.style.opacity = 0;
    }
    if (this.synth && this.queue.length && !this.synth.speaking && !this.synth.pending) this.synth.speak(this.queue.shift().u);
  }
}
