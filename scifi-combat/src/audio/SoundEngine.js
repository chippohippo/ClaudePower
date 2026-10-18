// SoundEngine: plays the SoundBank's sounds in the world, with depth. Browser only (WebAudio);
// the pure parts (distanceShape, impulse) are exported for tests.
//
//  * The bank renders in a worker (bankWorker.js) in the order sounds are asked for (prefetch()
//    at load: the guns, impacts, explosions, foley, call-ins), and on demand after that. Each
//    sound arrives as a few variants; a voice never repeats the variant it just played.
//  * Distance, per voice: level falls with distance (each kind its own reference and roll-off),
//    the air takes the highs (a low-pass closing with distance), sound takes time to arrive
//    (343 m/s: a far gun's flash comes before its report), the far version (muffled, rolling
//    echoes) takes over from the near one, and the reverb send grows (far away it's mostly the
//    city answering). Behind you, a little duller. Behind a wall (occluder), muffled.
//  * The room: a convolution reverb from a generated impulse response: the city (walls close by,
//    facades across the street slapping back, a long tail) or the open front (the ground, far
//    hills, a darker tail).
//  * The mix: the world through a shell-shock filter (a blast close by: the world goes dull, a
//    ring in your ears, and comes back over seconds), a glue compressor and a limiter on the
//    master, the UI dry on its own bus.
//  * Voices: at most `maxVoices`; a new sound steals the quietest (as heard here) if it's louder,
//    otherwise it isn't played.

import { render as renderLocal, variantsOf } from './SoundBank.js';
import * as D from './dsp.js';

/** Distance settings per kind of sound: reference distance, roll-off, near->far crossfade, cut-off, priority. */
export const KINDS = {
  gun: { ref: 5, rolloff: 0.68, farStart: 30, farEnd: 130, max: 1000, air: 1, prio: 2 },
  boom: { ref: 12, rolloff: 0.72, farStart: 45, farEnd: 240, max: 2800, air: 0.8, prio: 3 },
  report: { ref: 25, rolloff: 0.68, max: 3200, air: 0.7, prio: 3 },
  near: { ref: 1.5, rolloff: 1, max: 15, air: 0, prio: 4 },
  impact: { ref: 3, rolloff: 1.1, max: 70, air: 1, prio: 1 },
  foley: { ref: 2, rolloff: 1.3, max: 35, air: 1.2, prio: 0 },
  ability: { ref: 6, rolloff: 1, max: 140, air: 1, prio: 2 },
  vehicle: { ref: 8, rolloff: 1, max: 320, air: 1, prio: 1 },
  voice: { ref: 4, rolloff: 1, max: 120, air: 1, prio: 1 },
};
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** What `d` metres does to a sound of `kind`: { gain, cutoff (Hz), delay (s), wet (reverb send), far (crossfade 0..1) }. */
export function distanceShape(d, kind = KINDS.gun) {
  const k = typeof kind === 'string' ? KINDS[kind] : kind;
  const gain = d > k.max ? 0 : (k.ref / Math.max(k.ref, d)) ** k.rolloff * (d > k.max * 0.8 ? (k.max - d) / (k.max * 0.2) : 1);
  return {
    gain,
    cutoff: Math.max(450, 20000 * Math.exp((-d * (k.air ?? 1)) / 160)),
    delay: d / 343,
    wet: Math.min(0.85, 0.1 + d / 150),
    far: k.farStart != null ? smoothstep(k.farStart, k.farEnd, d) : 0,
  };
}

/** The room's impulse response: 'city' (walls close, facades slapping back, a long tail) or 'open' (ground, far hills, darker). */
export function impulse(env, sr = D.SR) {
  const city = env === 'city', len = city ? 2.6 : 2.2, n = D.samples(len, sr), r = D.rng(city ? 911 : 377);
  const out = [];
  for (let c = 0; c < 2; c++) {
    const x = D.noise(n, r);
    const T60 = city ? 2.1 : 1.5;
    for (let i = 0; i < n; i++) x[i] *= Math.exp((-6.9 * i) / (T60 * sr)) * Math.min(1, i / (0.012 * sr));
    D.lowpass(x, (t) => (city ? 7000 : 4000) * Math.exp(-t / (city ? 0.7 : 0.45)) + (city ? 700 : 450), 0.6, sr);
    const taps = city ? [[0.011, 0.5], [0.019, 0.42], [0.027, 0.36], [0.041, 0.3], [0.063, 0.26], [0.087, 0.2], [0.14, 0.32], [0.23, 0.24], [0.31, 0.17], [0.42, 0.1]]
      : [[0.004, 0.55], [0.009, 0.25], [0.55, 0.18], [0.9, 0.13], [1.3, 0.08]];
    for (const [t, g] of taps) {
      const at = Math.floor((t * (1 + (c ? 0.03 : -0.02))) * sr);
      for (let k = 0; k < 96 && at + k < n; k++) x[at + k] += (r() * 2 - 1) * g * Math.exp(-k / 18) * 3;
    }
    out.push(D.normalize(x, 0.6));
  }
  return out;
}

export class SoundEngine {
  /**
   * @param {object} o { ctx, environment: 'city' | 'open', occluder(pos) -> 0..1, maxVoices, worker: false to render on this thread }
   */
  constructor({ ctx = null, environment = 'city', occluder = null, maxVoices = 48, worker = true } = {}) {
    const AC = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    this.ctx = ctx ?? new AC({ latencyHint: 'interactive' });
    const c = this.ctx, sr = c.sampleRate;
    this.sr = sr; this.maxVoices = maxVoices; this.occluder = occluder;
    this.buffers = new Map();            // id -> [AudioBuffer variants]
    this.asked = new Set();
    this.last = new Map();               // id -> the variant it played last
    this.voices = [];
    this.loops = new Map();
    this.listener = { x: 0, y: 0, z: 0, yaw: 0 };
    // ---- the mix
    this.master = c.createGain(); this.master.gain.value = 0.85;
    const glue = c.createDynamicsCompressor();
    glue.threshold.value = -20; glue.knee.value = 12; glue.ratio.value = 3.5; glue.attack.value = 0.004; glue.release.value = 0.25;
    const limit = c.createDynamicsCompressor();
    limit.threshold.value = -2; limit.knee.value = 0; limit.ratio.value = 20; limit.attack.value = 0.001; limit.release.value = 0.08;
    this.master.connect(glue); glue.connect(limit); limit.connect(c.destination);
    this.output = limit;                 // (what reaches your speakers: tests record it)
    // The world: dry and reverb sends into the shell-shock filter, then the duck, then the master.
    this.shockFilter = c.createBiquadFilter(); this.shockFilter.type = 'lowpass'; this.shockFilter.frequency.value = 20000; this.shockFilter.Q.value = 0.5;
    this.duck = c.createGain();
    this.shockFilter.connect(this.duck); this.duck.connect(this.master);
    this.world = c.createGain(); this.world.connect(this.shockFilter);
    this.reverbIn = c.createGain();
    this.reverb = c.createConvolver();
    const [L, R] = impulse(environment, sr), ir = c.createBuffer(2, L.length, sr);
    ir.copyToChannel(L, 0); ir.copyToChannel(R, 1);
    this.reverb.buffer = ir;
    this.reverbOut = c.createGain(); this.reverbOut.gain.value = 0.55;
    this.reverbIn.connect(this.reverb); this.reverb.connect(this.reverbOut); this.reverbOut.connect(this.shockFilter);
    this.ui = c.createGain(); this.ui.connect(this.master);
    this.amb = c.createGain(); this.amb.gain.value = 0.5; this.amb.connect(this.shockFilter);
    // A ring in the ears after a blast close by.
    this.tinnitus = c.createOscillator(); this.tinnitus.frequency.value = 3950;
    this.tinGain = c.createGain(); this.tinGain.gain.value = 0;
    this.tinnitus.connect(this.tinGain); this.tinGain.connect(this.master); this.tinnitus.start();
    this.muffle = 0;                     // low health: the world a little dull
    // ---- the bank
    if (worker && typeof Worker !== 'undefined') {
      try {
        this.worker = new Worker(new URL('./bankWorker.js', import.meta.url), { type: 'module' });
        this.worker.onmessage = (e) => this.#receive(e.data);
        this.worker.postMessage({ sr });
      } catch { this.worker = null; }
    }
    this.pending = [];
  }

  /** Start (the first click: browsers keep audio off until you've touched the page). */
  resume() { if (this.ctx.state !== 'running') this.ctx.resume(); }
  get running() { return this.ctx.state === 'running'; }

  /** Ask for sounds ahead of need (most important first). */
  prefetch(ids) {
    const fresh = ids.filter((id) => !this.asked.has(id));
    for (const id of fresh) this.asked.add(id);
    if (!fresh.length) return;
    if (this.worker) this.worker.postMessage({ ids: fresh });
    else { this.pending.push(...fresh); this.#pumpLocal(); }
  }

  /** No worker: render a few per frame on this thread. */
  #pumpLocal() {
    if (this.pumping) return;
    this.pumping = true;
    const step = () => {
      const t0 = performance.now();
      while (this.pending.length && performance.now() - t0 < 6) {
        const id = this.pending.shift(), n = variantsOf(id), variants = [];
        for (let v = 0; v < n; v++) variants.push(renderLocal(id, v, this.sr));
        this.#receive({ id, variants });
      }
      if (this.pending.length) setTimeout(step, 16); else this.pumping = false;
    };
    setTimeout(step, 0);
  }

  #receive({ id, variants }) {
    this.buffers.set(id, variants.map(({ ch, sr }) => {
      const b = this.ctx.createBuffer(ch.length, ch[0].length, sr);
      ch.forEach((x, i) => b.copyToChannel(x, i));
      return b;
    }));
  }

  has(id) { return this.buffers.has(id); }

  setListener(pos, yaw) { if (pos) { this.listener.x = pos.x; this.listener.y = pos.y; this.listener.z = pos.z; } this.listener.yaw = yaw ?? this.listener.yaw; }

  /** Where a source is from here: distance, and its bearing relative to where you face (0 ahead, +right). */
  relative(pos) {
    const L = this.listener, dx = pos.x - L.x, dy = (pos.y ?? L.y) - L.y, dz = pos.z - L.z;
    const d = Math.hypot(dx, dy, dz);
    const fx = -Math.sin(L.yaw), fz = -Math.cos(L.yaw), rx = -fz, rz = fx;
    const along = dx * fx + dz * fz, side = dx * rx + dz * rz;
    return { d, az: Math.atan2(side, along) };
  }

  #pick(id) {
    const list = this.buffers.get(id);
    if (!list?.length) { if (!this.asked.has(id)) this.prefetch([id]); return null; }
    let v = Math.floor(Math.random() * list.length);
    if (list.length > 1 && v === this.last.get(id)) v = (v + 1) % list.length;
    this.last.set(id, v);
    return list[v];
  }

  /**
   * Play a sound. o: { pos (world; omit for 2D), far: the far version's id, kind (KINDS key), gain,
   * rate (playback rate), jitter (± rate), offset (s into the buffer), delay (true: sound's travel
   * time), occlude (true: ask the occluder), ui (true: the dry UI bus) }. Returns the voice or null.
   */
  play(id, { pos = null, far = null, kind = 'gun', gain = 1, rate = 1, jitter = 0.02, offset = 0, delay = true, occlude = false, ui = false } = {}) {
    if (!this.running) return null;
    const c = this.ctx, K = KINDS[kind] ?? KINDS.gun;
    let shape = { gain: 1, cutoff: 20000, delay: 0, wet: 0.08, far: 0 }, pan = 0, az = 0, d = 0;
    if (pos) {
      ({ d, az } = this.relative(pos));
      shape = distanceShape(d, K);
      if (shape.gain <= 0.0005) return null;
      pan = Math.sin(az) * (d < 2 ? d / 2 : 1) * 0.85;
      shape.cutoff *= 0.6 + 0.4 * (0.5 + 0.5 * Math.cos(az));         // behind you: duller
      // Behind a wall: duller and a little quieter (sound bends round corners; far off it's mostly echo anyway).
      if (occlude && this.occluder && d > 2 && d < 220) { const o = this.occluder(pos); if (o > 0) { shape.cutoff *= 1 - 0.6 * o; shape.gain *= 1 - 0.3 * o; } }
    }
    const level = gain * shape.gain;
    // Voices: steal the quietest if this one is louder (priority breaks ties toward what matters).
    this.voices = this.voices.filter((v) => !v.done);
    if (this.voices.length >= this.maxVoices) {
      let q = null;
      for (const v of this.voices) if (!q || v.level * (1 + v.prio) < q.level * (1 + q.prio)) q = v;
      if (q.level * (1 + q.prio) >= level * (1 + K.prio)) return null;
      this.#stop(q, 0.03);
    }
    const nearBuf = shape.far < 0.98 || !far ? this.#pick(id) : null;
    const farBuf = far && shape.far > 0.02 ? this.#pick(far) : null;
    if (!nearBuf && !farBuf) return null;
    const out = c.createGain(); out.gain.value = level;
    let node = out;
    if (shape.cutoff < 19000) { const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = shape.cutoff; lp.Q.value = 0.5; out.connect(lp); node = lp; }
    if (pos && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); node.connect(p); node = p; }
    if (ui) node.connect(this.ui);
    else {
      node.connect(this.world);
      const send = c.createGain(); send.gain.value = shape.wet; node.connect(send); send.connect(this.reverbIn);
    }
    const t = c.currentTime + (pos && delay ? shape.delay : 0) + 0.005, r = rate * (1 + (Math.random() * 2 - 1) * jitter);
    const voice = { srcs: [], out, level, prio: K.prio, done: false, end: t };
    const start = (b, g) => {
      const s = c.createBufferSource(); s.buffer = b; s.playbackRate.value = r;
      const sg = c.createGain(); sg.gain.value = g; s.connect(sg); sg.connect(out);
      s.start(t, Math.min(offset, b.duration - 0.01));
      voice.srcs.push(s); voice.end = Math.max(voice.end, t + (b.duration - offset) / r);
      s.onended = () => { if (voice.srcs.every((x) => x.ended || x === s)) { voice.done = true; out.disconnect(); } s.ended = true; };
    };
    if (nearBuf) start(nearBuf, farBuf ? 1 - shape.far : 1);
    if (farBuf) start(farBuf, nearBuf ? shape.far : 1);
    this.voices.push(voice);
    return voice;
  }

  #stop(v, fade = 0.05) {
    if (v.done) return;
    v.done = true;
    const t = this.ctx.currentTime;
    v.out.gain.cancelScheduledValues(t); v.out.gain.setValueAtTime(v.out.gain.value, t); v.out.gain.linearRampToValueAtTime(0, t + fade);
    for (const s of v.srcs) { try { s.stop(t + fade + 0.01); } catch { /* not started */ } }
  }
  stop(v, fade) { if (v) this.#stop(v, fade); }

  // ---------------------------------------------------------------- loops (engines, beams, fire, heartbeat, ambience)
  /** A looping sound under `key`, positioned like play() and updated by updateLoop(). */
  loop(key, id, o = {}) {
    if (this.loops.has(key) || !this.running) return;
    const b = this.#pick(id);
    if (!b) return;
    const c = this.ctx, s = c.createBufferSource(); s.buffer = b; s.loop = true; s.playbackRate.value = o.rate ?? 1;
    const g = c.createGain(); g.gain.value = 0;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 20000;
    const p = c.createStereoPanner ? c.createStereoPanner() : null;
    s.connect(g); g.connect(lp); let node = lp;
    if (p) { lp.connect(p); node = p; }
    const bus = o.ui ? this.ui : o.amb ? this.amb : this.world;
    node.connect(bus);
    let send = null;
    if (!o.ui && !o.amb) { send = c.createGain(); send.gain.value = 0.1; node.connect(send); send.connect(this.reverbIn); }
    s.start(c.currentTime, Math.random() * b.duration * 0.9);
    const L = { s, g, lp, p, send, kind: o.kind ?? 'vehicle', gain: o.gain ?? 1 };
    this.loops.set(key, L);
    this.updateLoop(key, o, 0.25);
  }
  updateLoop(key, { pos = null, gain = null, rate = null } = {}, ramp = 0.08) {
    const L = this.loops.get(key);
    if (!L) return;
    const t = this.ctx.currentTime;
    if (gain != null) L.gain = gain;
    let level = L.gain, cutoff = 20000, pan = 0, wet = 0.1;
    if (pos) {
      const { d, az } = this.relative(pos), sh = distanceShape(d, KINDS[L.kind] ?? KINDS.vehicle);
      level *= sh.gain; cutoff = sh.cutoff * (0.6 + 0.4 * (0.5 + 0.5 * Math.cos(az))); pan = Math.sin(az) * 0.85; wet = sh.wet;
    }
    L.g.gain.setTargetAtTime(level, t, ramp / 3);
    L.lp.frequency.setTargetAtTime(cutoff, t, ramp / 3);
    if (L.p) L.p.pan.setTargetAtTime(pan, t, ramp / 3);
    if (L.send) L.send.gain.setTargetAtTime(wet, t, ramp / 3);
    if (rate != null) L.s.playbackRate.setTargetAtTime(rate, t, 0.1);
  }
  stopLoop(key, fade = 0.2) {
    const L = this.loops.get(key);
    if (!L) return;
    this.loops.delete(key);
    const t = this.ctx.currentTime;
    L.g.gain.cancelScheduledValues(t); L.g.gain.setTargetAtTime(0, t, fade / 3);
    try { L.s.stop(t + fade + 0.05); } catch { /* gone */ }
  }
  hasLoop(key) { return this.loops.has(key); }

  // ---------------------------------------------------------------- the ears
  /**
   * Shell shock: a blast close by. The world goes dull and a little quieter, a ring sounds in your
   * ears, and both come back over a few seconds. k 0..1.
   */
  shock(k) {
    if (!this.running || k <= 0.02) return;
    const t = this.ctx.currentTime, f = this.shockFilter.frequency, base = this.#base();
    const to = Math.max(260, base * (1 - 0.985 * Math.min(1, k)));
    f.cancelScheduledValues(t); f.setValueAtTime(f.value, t); f.exponentialRampToValueAtTime(to, t + 0.03); f.setTargetAtTime(base, t + 0.25 + 0.6 * k, 0.6 + 1.2 * k);
    const dg = this.duck.gain;
    dg.cancelScheduledValues(t); dg.setValueAtTime(dg.value, t); dg.linearRampToValueAtTime(1 - 0.45 * Math.min(1, k), t + 0.03); dg.setTargetAtTime(1, t + 0.3, 0.8 + k);
    const tg = this.tinGain.gain;
    tg.cancelScheduledValues(t); tg.setValueAtTime(tg.value, t); tg.linearRampToValueAtTime(0.06 * Math.min(1, k), t + 0.06); tg.setTargetAtTime(0, t + 0.4, 0.9 + 1.4 * k);
  }
  /** Low health (0..1): the world a little dull, the way it gets when you're hurt. */
  setMuffle(k) {
    if (Math.abs(k - this.muffle) < 0.02) return;
    this.muffle = k;
    if (this.running) this.shockFilter.frequency.setTargetAtTime(this.#base(), this.ctx.currentTime, 0.4);
  }
  #base() { return 20000 * (1 - this.muffle) + 1400 * this.muffle; }

  setVolume(v) { this.master.gain.setTargetAtTime(0.85 * v, this.ctx.currentTime, 0.05); }
}
