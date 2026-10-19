// SoundEngine: plays the game's sounds in the world, with depth, through a mix built for a battle
// where everything happens at once. Browser only (WebAudio); the pure parts (distance, layers, the
// loudness window) are exported for the tests.
//
//  * Sounds come from audio/manifest.json (built by tools/audio/forge.mjs). A gun or a blast is a
//    stack of layers (a gun's crack, body, low and mechanism; a blast's crack, body, low and
//    debris; each with a far version by class), every layer dealt from its own shuffled deck at its
//    own slight pitch and level, and mixed by distance: the crack goes first, then the mechanism,
//    the low end lasts, the body longest, and the far layer takes over. No two shots are alike. A
//    simple sound is one deck of takes. Anything not in the manifest is synthesized by the
//    SoundBank (in a worker).
//  * Depth: level falls with distance (each kind its own roll-off), the air takes the highs, sound
//    arrives late (343 m/s: a far gun's flash before its report), walls muffle, behind you is a
//    little duller; and every sound goes into the map's room (Acoustics.js: the trench's rolling
//    thunder, the city's slap and flutter, the night's far towers answering), more of it the further
//    off. The low layers stay out of the room: it never rumbles.
//  * The mix (HDR): every sound knows how loud it'll be where you stand. The loudest go out as they
//    are; everything else is the bed, ducked under them with lookahead (the duck is scheduled with
//    the sound itself, so the hit is never the thing that pumps), and what would be lost under them
//    anyway isn't played at all. At most a few low layers at once. The master splits at 120 Hz and
//    compresses each band on its own (the bass can't pump the mids), then a limiter. Chrome's
//    compressors add makeup gain on their own; it's taken back out, so quiet stays quiet.
//  * The ears: a blast close by dulls the world and rings in your ears (shock); low health dulls it
//    (muffle); rounds cracking past pull the world in a little (suppress).
//  * Voices: at most `maxVoices` (a layered shot is one); a new sound steals the quietest if it's
//    louder, otherwise it isn't played.

import { render as renderLocal, variantsOf } from './SoundBank.js';
import { impulse, roomFor } from './Acoustics.js';

/**
 * Per kind of sound: reference distance and roll-off, how fast the air dulls it, the cut-off,
 * priority, how loud it is (dB, a gun at its reference distance = 0: for the loudness window) and
 * how much of it the room gets (dB of send at the source).
 */
export const KINDS = {
  gun: { ref: 5, rolloff: 1, air: 1, max: 1400, prio: 2, loud: 0, verb: -17 },
  boom: { ref: 12, rolloff: 1, air: 0.7, max: 3200, prio: 3, loud: 8, verb: -14 },
  report: { ref: 30, rolloff: 0.9, air: 0.6, max: 3600, prio: 3, loud: 6, verb: -10 },
  near: { ref: 1.5, rolloff: 1, air: 0, max: 15, prio: 4, loud: -2, verb: -22 },
  incoming: { ref: 25, rolloff: 1, air: 0.5, max: 160, prio: 4, loud: 0, verb: -14 },   // a shell coming down on you
  impact: { ref: 3, rolloff: 1.1, air: 1, max: 80, prio: 1, loud: -10, verb: -15 },
  foley: { ref: 2, rolloff: 1.3, air: 1.2, max: 40, prio: 0, loud: -16, verb: -18 },
  ability: { ref: 6, rolloff: 1, air: 1, max: 160, prio: 2, loud: -4, verb: -14 },
  vehicle: { ref: 8, rolloff: 1, air: 1, max: 400, prio: 1, loud: -8, verb: -16 },
  voice: { ref: 4, rolloff: 1, air: 1, max: 120, prio: 1, loud: -8, verb: -16 },
  war: { ref: 60, rolloff: 0.8, air: 0.45, max: 8000, prio: 0, loud: 4, verb: -6 },    // the war beyond the map (Ambience)
  spot: { ref: 10, rolloff: 0.9, air: 0.8, max: 3000, prio: 0, loud: -8, verb: -9 },    // the atmosphere's things round you (Ambience)
};

/**
 * Layered sounds: each layer's distance window. A near layer [start, end] is whole up to `start` m
 * and gone by `end`; a far layer [from, to] comes in from `from` m, whole by `to`. Equal power.
 */
export const LAYERS = {
  gun: { crack: [8, 45], mech: [4, 15], low: [25, 100], body: [70, 220], far: [60, 180] },
  boom: { crack: [15, 60], debris: [20, 60], low: [45, 150], body: [50, 170], far: [45, 150] },
  report: { crack: [40, 160], low: [120, 400], body: [300, 1200] },
};
/** Your own gun, and anyone else's: each layer's level on top of the gun's own mix (dB). */
export const VIEWS = {
  '1p': { crack: 0, body: 0, low: 4, mech: 5 },
  world: { crack: 0, body: 0, low: -1, mech: -2, far: 0, debris: 0 },
};

/**
 * The master. Below 120 Hz a compressor keeps a pile of low ends from swelling into a drone (its
 * 20 ms attack lets every punch through first); above it nothing but the limiter touches the sound,
 * so a shot's crack stays as sharp as it was made: the loudness window (HDR) does the mixing. Each
 * compressor's measured makeup gain is taken back out (Chrome adds it on its own).
 */
export const MASTER = {
  split: 120,
  low: { threshold: -16, knee: 8, ratio: 2.5, attack: 0.02, release: 0.3, makeup: 4.39 },
  limit: { threshold: -1.5, knee: 0, ratio: 20, attack: 0.001, release: 0.08, makeup: 0.85 },
  trim: -5,          // (into the master: headroom, so the biggest hits land under the limiter, not in it)
  gain: 0.9,
};
/** How long a hero stays one (s): its attack; then its body and tail join the bed. */
const HERO_HOLD = { gun: 0.08, boom: 0.35, report: 0.3, near: 0.2, incoming: 0.6 };
/**
 * The loudness window (dB): a sound louder than `hero` and within `heroRange` of the loudest going
 * is a hero (it plays as it is, and a new loudest ducks the rest); one `cull` under the loudest isn't
 * played. The window's top falls `release` dB a second. At most `lows` low layers at once.
 */
export const HDR = { hero: -16, heroRange: 6, cull: 30, release: 18, maxDuck: 12, maxHeroDuck: 9, lows: 3 };

const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const dbToGain = (db) => 10 ** (db / 20);
const gainToDb = (g) => 20 * Math.log10(Math.max(1e-9, g));

/** What `d` metres does to a sound of `kind`: { gain, cutoff (Hz), delay (s), wet (the room's send, linear) }. */
export function distanceShape(d, kind = KINDS.gun) {
  const k = typeof kind === 'string' ? KINDS[kind] : kind;
  // Spreading (the kind's roll-off), and past 60 m the ground and the air taking more: 3 dB more for
  // every doubling (what keeps a barrage 300 m off a rumble, not a wall).
  const gain = d > k.max ? 0 : (k.ref / Math.max(k.ref, d)) ** k.rolloff * Math.min(1, 60 / Math.max(1, d)) ** 0.5 * (d > k.max * 0.8 ? (k.max - d) / (k.max * 0.2) : 1);
  return {
    gain,
    cutoff: Math.max(700, 18000 * Math.exp((-d * (k.air ?? 1)) / 220)),
    delay: d / 343,
    // The further off, the more of it is the room answering: +2.4 dB at 15 m, +8 at 150, +12 at 450.
    wet: Math.min(dbToGain(2), dbToGain((k.verb ?? -14) + 8 * Math.log10(1 + d / 15))),
  };
}

/** How much of each layer of a layered sound to hear at `d` m: { layer: 0..1 } (equal power). */
export function layerWeights(d, kind = 'gun', layers = null) {
  const W = LAYERS[kind] ?? LAYERS.gun, out = {};
  for (const name of layers ?? Object.keys(W)) {
    const w = W[name];
    if (!w) { out[name] = 1; continue; }
    out[name] = name === 'far' ? Math.sin((Math.PI / 2) * smoothstep(w[0], w[1], d)) : Math.cos((Math.PI / 2) * smoothstep(w[0], w[1], d));
  }
  return out;
}

/** How loud a sound will be where you stand (dB, for the loudness window): its level and its kind. */
export const loudness = (level, kind) => gainToDb(level) + (KINDS[kind]?.loud ?? 0);

export class SoundEngine {
  /**
   * @param {object} o { ctx, environment: the map's room ('open' | 'city' | 'night'), occluder(pos) -> 0..1,
   *                     maxVoices, worker: false to render the bank on this thread, recorded: false for the bank only,
   *                     offline: an OfflineAudioContext (the Audio Lab's recordings) }
   */
  constructor({ ctx = null, environment = 'city', occluder = null, maxVoices = 40, worker = true, recorded = true, offline = false } = {}) {
    const AC = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    this.ctx = ctx ?? new AC({ latencyHint: 'interactive' });
    const c = this.ctx, sr = c.sampleRate;
    this.sr = sr; this.maxVoices = maxVoices; this.occluder = occluder;
    // Offline: always "running", and a sound not yet rendered is rendered on the spot instead of skipped.
    this.offline = offline;
    if (offline) worker = false;
    this.environment = roomFor(environment);
    this.buffers = new Map();            // synthesized: id -> [AudioBuffer variants]
    this.asked = new Set();
    this.last = new Map();
    this.voices = [];
    this.loops = new Map();
    this.listener = { x: 0, y: 0, z: 0, yaw: 0 };
    this.lows = [];                      // the low layers playing: { end, level }
    this.duckers = {};                   // name -> { gains: [[AudioParam, depth scale]], events: [{ t, depth, hold, release }] }
    this.window = { t: 0, db: -120 };    // the loudness window's top
    this.stats = { played: 0, culled: 0, stolen: 0, dropped: 0, heroes: 0, lowsSkipped: 0 };
    this.#buildMix(environment);
    // ---- the bank (synthesized sounds)
    if (worker && typeof Worker !== 'undefined') {
      try {
        this.worker = new Worker(new URL('./bankWorker.js', import.meta.url), { type: 'module' });
        this.worker.onmessage = (e) => this.#receive(e.data);
        this.worker.postMessage({ sr });
      } catch { this.worker = null; }
    }
    this.pending = [];
    // ---- the recordings (the forge's manifest)
    this.manifest = null;                // id -> { kind, mix, far, layers: { name: [files] } } | { kind, takes: [files] }
    this.files = new Map();              // 'id|layer' -> [AudioBuffer] once loaded, or 'loading'
    this.decks = new Map();              // 'id|layer' -> the takes still to deal
    this.waiting = [];
    if (recorded && typeof fetch !== 'undefined') this.ready = this.loadManifest().catch(() => null);
  }

  // ---------------------------------------------------------------- the mix
  #buildMix(environment) {
    const c = this.ctx;
    const comp = (o) => { const n = c.createDynamicsCompressor(); n.threshold.value = o.threshold; n.knee.value = o.knee; n.ratio.value = o.ratio; n.attack.value = o.attack; n.release.value = o.release; return n; };
    const gain = (v = 1) => { const g = c.createGain(); g.gain.value = v; return g; };
    const filter = (type, f, q = 0.7071) => { const b = c.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
    // The master: split at 120 Hz (Linkwitz-Riley: two Butterworths each side), the low band compressed, a limiter.
    const M = MASTER;
    this.master = gain(M.gain);
    const lo1 = filter('lowpass', M.split), lo2 = filter('lowpass', M.split), hi1 = filter('highpass', M.split), hi2 = filter('highpass', M.split);
    const loC = comp(M.low), loG = gain(dbToGain(-M.low.makeup));
    const sum = gain(1), lim = comp(M.limit), limG = gain(dbToGain(-M.limit.makeup));
    this.pre = gain(dbToGain(M.trim));
    this.pre.connect(lo1); lo1.connect(lo2); lo2.connect(loC); loC.connect(loG); loG.connect(sum);
    this.pre.connect(hi1); hi1.connect(hi2); hi2.connect(sum);
    sum.connect(lim); lim.connect(limG); limG.connect(this.master); this.master.connect(c.destination);
    this.output = this.master;           // (what reaches your speakers: tests record it)
    this.comps = { low: loC, limit: lim };
    // The world goes through the shell-shock filter and its duck. Four ways in: your own (fp: your
    // gun, hits on you), the loudest thing going (lead: as it is), the other heroes (ducked under the
    // lead and your gun), and the bed (ducked under all of them).
    this.shockFilter = filter('lowpass', 20000, 0.5);
    this.duck = gain(1);
    this.shockFilter.connect(this.duck); this.duck.connect(this.pre);
    this.fp = gain(1); this.fp.connect(this.shockFilter);
    this.lead = gain(1); this.lead.connect(this.shockFilter);
    this.heroDuck = gain(1); this.heroDuck.connect(this.shockFilter);
    this.hero = gain(1); this.hero.connect(this.heroDuck);
    this.bedDuck = gain(1); this.bedDuck.connect(this.shockFilter);
    this.world = gain(1); this.world.connect(this.bedDuck);
    // The room: every sound's send, convolved with the map's impulse response; never its lowest octave.
    this.reverbIn = gain(1);
    this.reverb = c.createConvolver(); this.reverb.normalize = false;
    this.#setRoom(environment);
    this.verbHp = filter('highpass', 200, 0.6);
    this.reverbOut = gain(0.9);
    this.verbDuck = gain(1);
    this.reverbIn.connect(this.reverb); this.reverb.connect(this.verbHp); this.verbHp.connect(this.reverbOut); this.reverbOut.connect(this.verbDuck); this.verbDuck.connect(this.shockFilter);
    // The atmosphere (beds and the war beyond the map): its own duck, deeper.
    this.amb = gain(0.7); this.ambDuck = gain(1);
    this.amb.connect(this.ambDuck); this.ambDuck.connect(this.shockFilter);
    this.ui = gain(1); this.ui.connect(this.pre);                       // dry, never shocked
    this.duckers.hero = { gains: [[this.heroDuck.gain, 1]], events: [] };
    this.duckers.bed = { gains: [[this.bedDuck.gain, 1], [this.verbDuck.gain, 0.7], [this.ambDuck.gain, 1.3]], events: [] };
    // A ring in the ears after a blast close by: a narrow band of noise round 4 kHz, not a pure tone.
    const n = Math.floor(this.sr * 2), nb = c.createBuffer(1, n, this.sr), nd = nb.getChannelData(0);
    let s = 7; for (let i = 0; i < n; i++) { s = (s * 16807) % 2147483647; nd[i] = s / 1073741823.5 - 1; }
    this.tinnitus = c.createBufferSource(); this.tinnitus.buffer = nb; this.tinnitus.loop = true;
    const tb1 = filter('bandpass', 3900, 18), tb2 = filter('bandpass', 3900, 18);
    this.tinGain = gain(0);
    this.tinnitus.connect(tb1); tb1.connect(tb2); tb2.connect(this.tinGain); this.tinGain.connect(this.pre); this.tinnitus.start();
    this.muffle = 0; this.supp = 0;
  }

  /** The map's room (a new impulse response for the convolver). */
  #setRoom(env) {
    const [L, R] = impulse(env, this.sr), ir = this.ctx.createBuffer(2, L.length, this.sr);
    ir.copyToChannel(L, 0); ir.copyToChannel(R, 1);
    this.reverb.buffer = ir;
    this.environment = roomFor(env);
  }
  setRoom(env) { if (roomFor(env) !== this.environment) this.#setRoom(env); }

  /**
   * A ducker ('hero' or 'bed') pushed down under a louder sound, from `t` (scheduled with that sound:
   * lookahead): `depth` dB, held `hold` s, back over `release` s. A deeper duck takes over; a
   * shallower one under it is ignored.
   */
  #duck(name, t, depth, hold, release) {
    const D = this.duckers[name];
    depth = Math.min(name === 'bed' ? HDR.maxDuck : HDR.maxHeroDuck, depth);
    if (!D || depth < 0.5) return;
    const now = this.#duckAt(name, t);
    if (depth <= now + 0.3) return;
    D.events = D.events.filter((e) => e.t + e.hold + e.release * 4 > t);
    D.events.push({ t, depth, hold, release });
    for (const [g, k] of D.gains) {
      const to = dbToGain(-depth * k), from = dbToGain(-now * k);
      g.cancelScheduledValues(t); g.setValueAtTime(from, t); g.linearRampToValueAtTime(to, t + 0.006); g.setTargetAtTime(1, t + 0.006 + hold, release / 3);
    }
  }
  /** How far a ducker is down at time t (dB). */
  #duckAt(name, t) {
    let d = 0;
    for (const e of this.duckers[name]?.events ?? []) {
      if (t < e.t) continue;
      const u = t - e.t - 0.006 - e.hold;
      d = Math.max(d, u <= 0 ? e.depth : e.depth * Math.exp(-u / (e.release / 3)));
    }
    return d;
  }
  /** The loudness window's top at time t (dB): the loudest recent sound, falling HDR.release dB a second. */
  #top(t) { return this.window.db - Math.max(0, t - this.window.t) * HDR.release; }

  // ---------------------------------------------------------------- the manifest (recordings)
  /** Load audio/manifest.json; ids asked for meanwhile are routed when it's in. */
  async loadManifest(url = new URL('../../audio/manifest.json', import.meta.url)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`manifest ${res.status}`);
    const m = await res.json();
    this.audioBase = new URL('.', res.url || url);
    this.manifest = m.sounds ?? {};
    const ids = this.waiting; this.waiting = [];
    this.prefetch(ids);
    return this.manifest;
  }

  /** The manifest entry an id plays ('gun:ar_sol:near' and 'gun:ar_sol:1p' are both 'gun:ar_sol'), or null. */
  recordedId(id) {
    const M = this.manifest;
    if (!M) return null;
    if (M[id]) return id;
    const base = id.replace(/:(near|mid|far|1p)$/, '');
    return base !== id && M[base] ? base : null;
  }
  /** A layer's files ('takes' for a simple sound). */
  #list(base, layer) { const e = this.manifest[base]; return layer === 'takes' ? e?.takes : e?.layers?.[layer]; }

  /** A layer's decoded takes, or null while they load (asked for the first time they're needed). */
  #layer(base, layer) {
    const key = `${base}|${layer}`, got = this.files.get(key);
    if (got) return got === 'loading' ? null : got;
    const files = this.#list(base, layer);
    if (!files?.length) return null;
    this.files.set(key, 'loading');
    Promise.all(files.map((f) => fetch(new URL(f, this.audioBase)).then((r) => r.arrayBuffer()).then((a) => this.ctx.decodeAudioData(a))))
      .then((list) => this.files.set(key, list))
      .catch(() => this.files.delete(key));
    return null;
  }
  /** The next take of a layer, from a shuffled deck: never the one just played, every take before a repeat. */
  #deal(base, layer) {
    const list = this.#layer(base, layer);
    if (!list) return null;
    const key = `${base}|${layer}`;
    let deck = this.decks.get(key);
    if (!deck?.length) {
      deck = list.map((_, i) => i);
      for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
      const last = this.last.get(key);
      if (deck.length > 1 && deck.at(-1) === last) [deck[0], deck[deck.length - 1]] = [deck[deck.length - 1], deck[0]];
      this.decks.set(key, deck);
    }
    const i = deck.pop();
    this.last.set(key, i);
    return list[i];
  }
  /** Every layer of every sound in the manifest decoded up front (offline: nothing may arrive late in a recording). */
  async loadAllRecorded() {
    await this.ready;
    const jobs = [];
    for (const [base, e] of Object.entries(this.manifest ?? {})) {
      for (const layer of e.takes ? ['takes'] : Object.keys(e.layers ?? {})) {
        const key = `${base}|${layer}`;
        if (Array.isArray(this.files.get(key))) continue;
        jobs.push(Promise.all(this.#list(base, layer).map((f) => fetch(new URL(f, this.audioBase)).then((r) => r.arrayBuffer()).then((a) => this.ctx.decodeAudioData(a)))).then((list) => this.files.set(key, list)));
      }
    }
    await Promise.all(jobs);
  }

  /** Start (the first click: browsers keep audio off until you've touched the page). */
  resume() { if (!this.offline && this.ctx.state !== 'running') this.ctx.resume(); }
  get running() { return this.offline || this.ctx.state === 'running'; }

  /** Ask for sounds ahead of need (most important first): the manifest's layers load, the rest is synthesized. */
  prefetch(ids) {
    if (this.offline) return;                // (offline: everything's loaded before the recording starts, or rendered as it's needed)
    if (!this.manifest && this.ready) { this.waiting.push(...ids); return; }
    const synth = [];
    for (const id of ids) {
      const base = this.recordedId(id);
      if (!base) { synth.push(id); continue; }
      const e = this.manifest[base];
      if (e.takes) this.#layer(base, 'takes');
      else for (const layer of Object.keys(e.layers)) this.#layer(base, layer);
      if (e.far) this.#layer(e.far, 'far');
    }
    const fresh = synth.filter((id) => !this.asked.has(id));
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
  /** A synthesized sound's next variant (never the one it played last). */
  #pick(id) {
    let list = this.buffers.get(id);
    if (!list?.length && this.offline) { this.asked.add(id); this.#receive({ id, variants: Array.from({ length: variantsOf(id) }, (_, v) => renderLocal(id, v, this.sr)) }); list = this.buffers.get(id); }
    if (!list?.length) { if (!this.asked.has(id)) this.prefetch([id]); return null; }
    let v = Math.floor(Math.random() * list.length);
    if (list.length > 1 && v === this.last.get(id)) v = (v + 1) % list.length;
    this.last.set(id, v);
    return list[v];
  }

  has(id) { const base = this.recordedId(id); return base ? !!this.#layer(base, this.manifest[base].takes ? 'takes' : Object.keys(this.manifest[base].layers)[0]) : this.buffers.has(id); }

  setListener(pos, yaw) { if (pos) { this.listener.x = pos.x; this.listener.y = pos.y; this.listener.z = pos.z; } this.listener.yaw = yaw ?? this.listener.yaw; }

  /** Where a source is from here: distance, and its bearing relative to where you face (0 ahead, +right). */
  relative(pos) {
    const L = this.listener, dx = pos.x - L.x, dy = (pos.y ?? L.y) - L.y, dz = pos.z - L.z;
    const d = Math.hypot(dx, dy, dz);
    const fx = -Math.sin(L.yaw), fz = -Math.cos(L.yaw), rx = -fz, rz = fx;
    const along = dx * fx + dz * fz, side = dx * rx + dz * rz;
    return { d, az: Math.atan2(side, along) };
  }

  // ---------------------------------------------------------------- playing
  /**
   * Play a sound. o: { pos (world; omit for in your head), kind (KINDS key), gain, rate (playback
   * rate), jitter (± rate), offset (s into it), delay (true: sound's travel time), occlude (true: ask
   * the occluder), ui (the dry UI bus), amb (the atmosphere's bus), wait (s before it starts), hero
   * (true: never ducked, ducks the bed), far (a synthesized far version's id, for the bank's sounds) }.
   * Returns the voice or null.
   */
  play(id, o = {}) {
    if (!this.running) return null;
    const base = this.recordedId(id);
    const view = id.endsWith(':1p') ? '1p' : 'world';
    if (base) return this.#play(base, view, o, null);
    // The bank: one buffer (or its near and far versions crossfaded).
    return this.#play(null, view, o, id);
  }

  /** Where it is and what that does to it: { d, az, shape, pan }. */
  #place(pos, K, occlude) {
    if (!pos) return { d: 0, az: 0, pan: 0, shape: { gain: 1, cutoff: 20000, delay: 0, wet: dbToGain(K.verb ?? -14) } };
    const { d, az } = this.relative(pos), shape = distanceShape(d, K);
    shape.cutoff *= 0.65 + 0.35 * (0.5 + 0.5 * Math.cos(az));             // behind you: duller
    // Behind a wall: duller and quieter, but the room still carries it round (the send stays).
    if (occlude && this.occluder && d > 2 && d < 260) { const o = this.occluder(pos); if (o > 0) { shape.cutoff *= 1 - 0.65 * o; shape.gain *= 1 - 0.35 * o; shape.wet *= 1 + 0.3 * o; } }
    return { d, az, shape, pan: Math.sin(az) * (d < 2 ? d / 2 : 1) * 0.85 };
  }

  #play(base, view, o, synthId) {
    const c = this.ctx, E = base ? this.manifest[base] : null;
    const kindName = o.kind ?? (E?.kind && KINDS[E.kind] ? E.kind : 'gun'), K = KINDS[kindName] ?? KINDS.gun;
    const pl = this.#place(view === '1p' || o.ui ? null : o.pos, K, o.occlude);
    if (pl.shape.gain <= 0.0005) return null;
    const level = (o.gain ?? 1) * pl.shape.gain * dbToGain(((Math.random() * 2 - 1) * 1));    // ±1 dB a play
    const t = c.currentTime + (o.wait ?? 0) + (o.pos && o.delay !== false && view !== '1p' ? pl.shape.delay : 0) + 0.005;
    // The loudness window: how loud this will be here, against the loudest thing going.
    const L = loudness(level, kindName) + (view === '1p' ? 4 : 0), top = this.#top(t);
    const hero = !o.ui && !o.amb && (o.hero ?? (view === '1p' || (L > HDR.hero && L > top - HDR.heroRange)));
    if (!hero && !o.ui && K.prio < 3 && L < top - HDR.cull) { this.stats.culled++; return null; }
    // Voices: steal the quietest if this one is louder (priority breaks ties toward what matters).
    // Footsteps and handling share a few of them (a squad's boots shouldn't take a gunshot's voice).
    this.voices = this.voices.filter((v) => !v.done);
    const small = kindName === 'foley' || kindName === 'impact';
    if (small && this.voices.filter((v) => v.small).length >= 10) { this.stats.dropped++; return null; }
    if (this.voices.length >= this.maxVoices) {
      let q = null;
      for (const v of this.voices) if (!q || v.level * (1 + v.prio) < q.level * (1 + q.prio)) q = v;
      if (q.level * (1 + q.prio) >= level * (1 + K.prio)) { this.stats.dropped++; return null; }
      this.#stop(q, 0.03); this.stats.stolen++;
    }
    // What to play: each layer's next take and its weight here.
    const picks = this.#picks(E, base, view, kindName, pl.d, synthId, o, t, level);
    if (!picks.length) return null;
    if (L > top) { this.window.db = L; this.window.t = t; }
    // The lead: a hero as loud as the loudest going (or louder). It plays as it is and pushes the
    // other heroes and the bed down under it, as long and as deep as it is loud: a shot a moment, a
    // blast a second or more. Your own gun ducks them a little, every shot. A lesser hero, just the bed.
    const lead = hero && view !== '1p' && L >= top - 1, long = kindName === 'boom' || kindName === 'report' || kindName === 'incoming';
    if (hero) {
      this.stats.heroes++;
      const over = Math.max(0, L - HDR.hero);
      if (view === '1p') { this.#duck('hero', t, 3, 0.04, 0.15); this.#duck('bed', t, 5, 0.05, 0.2); }
      else if (lead) { this.#duck('hero', t, over * (long ? 0.45 : 0.3), long ? 0.25 : 0.05, long ? 1 : 0.2); this.#duck('bed', t, over * (long ? 0.6 : 0.4), long ? 0.3 : 0.05, long ? 1.4 : 0.25); }
      else this.#duck('bed', t, Math.min(4, over * 0.25), 0.04, 0.2);
    }
    // The voice: the layers into a mix (and the low ones beside it, out of the room), the air's
    // low-pass, the pan, the bus; a send into the room.
    const v = { srcs: [], level, prio: K.prio, done: false, end: t, L, small };
    const mix = c.createGain(); mix.gain.value = level;
    const lowMix = picks.some((p) => p.low) ? c.createGain() : null;     // (only when there's a low layer to keep out of the room)
    if (lowMix) lowMix.gain.value = level;
    if (view !== '1p') for (const m of [mix, lowMix]) if (m) { m.channelCount = 1; m.channelCountMode = 'explicit'; }   // out in the world: a point
    let node = mix;
    if (pl.shape.cutoff < 19000) { const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = pl.shape.cutoff; lp.Q.value = 0.5; mix.connect(lp); node = lp; }
    // A hero is a hero for its attack: after it (a shot's first 80 ms, a blast's first 350), its body
    // and tail cross over to the bed, so the next hero ducks them like everything else.
    let bus = o.ui ? this.ui : view === '1p' ? this.fp : o.amb ? this.amb : this.world, out = null;
    if (hero && view !== '1p') {
      const hold = HERO_HOLD[kindName] ?? 0.15, hg = c.createGain(), bg = c.createGain();
      hg.gain.setValueAtTime(1, t); hg.gain.setValueAtTime(1, t + hold); hg.gain.linearRampToValueAtTime(0, t + hold + 0.12);
      bg.gain.setValueAtTime(0, t); bg.gain.setValueAtTime(0, t + hold); bg.gain.linearRampToValueAtTime(1, t + hold + 0.12);
      hg.connect(lead ? this.lead : this.hero); bg.connect(this.world);
      out = c.createGain(); out.connect(hg); out.connect(bg);
      bus = out;
    }
    if (o.pos && view !== '1p' && !o.ui && c.createStereoPanner) {
      const p = c.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pl.pan));
      node.connect(p); lowMix?.connect(p); p.connect(bus);
    } else { node.connect(bus); lowMix?.connect(bus); }
    if (!o.ui) { const send = c.createGain(); send.gain.value = pl.shape.wet * (view === '1p' ? 0.8 : 1); node.connect(send); send.connect(this.reverbIn); }
    v.out = mix; v.lowOut = lowMix;
    const r = (o.rate ?? 1) * (1 + (Math.random() * 2 - 1) * Math.max(o.jitter ?? 0.02, base ? 0.02 : 0));
    for (const p of picks) {
      const s = c.createBufferSource(); s.buffer = p.buf;
      s.playbackRate.value = r * p.rate;
      const g = c.createGain(); g.gain.value = p.gain;
      s.connect(g); g.connect(p.low ? lowMix : mix);
      const off = Math.min(o.offset ?? 0, p.buf.duration - 0.01);
      s.start(t + (p.at ?? 0), off);
      v.srcs.push(s); v.end = Math.max(v.end, t + (p.at ?? 0) + (p.buf.duration - off) / s.playbackRate.value);
      s.onended = () => { s.ended = true; if (v.srcs.every((x) => x.ended)) { v.done = true; mix.disconnect(); lowMix?.disconnect(); } };
    }
    this.voices.push(v);
    this.stats.played++;
    return v;
  }

  /** The buffers a play is made of: [{ buf, gain, rate, low, at }]. */
  #picks(E, base, view, kindName, d, synthId, o, t, level) {
    const out = [];
    if (!E) {
      // The bank: its near version, and its far one crossfaded in from far off.
      const K = KINDS[kindName] ?? KINDS.gun, f = o.far && K.ref ? smoothstep(30, 130, d) : 0;
      const nb = f < 0.98 || !o.far ? this.#pick(synthId) : null, fb = o.far && f > 0.02 ? this.#pick(o.far) : null;
      if (nb) out.push({ buf: nb, gain: fb ? Math.cos((Math.PI / 2) * f) : 1, rate: 1 });
      if (fb) out.push({ buf: fb, gain: nb ? Math.sin((Math.PI / 2) * f) : 1, rate: 1 });
      return out;
    }
    if (E.takes) {
      const b = this.#deal(base, 'takes');
      if (b) out.push({ buf: b, gain: 1, rate: 1 });
      return out;
    }
    // Layered: every layer's weight at this distance, its own take, its own few % of pitch. A layer
    // for one room only ('debris@city') plays in that room (the night's streets are the city's).
    const room = this.environment === 'night' ? 'city' : this.environment;
    const names = Object.keys(E.layers).filter((n) => !n.includes('@') || n.endsWith(`@${room}`) || n.endsWith(`@${this.environment}`));
    if (E.far) names.push('far');
    const plain = (n) => n.split('@')[0];
    const W = view === '1p' ? null : layerWeights(d, LAYERS[E.kind] ? E.kind : 'gun', names.map(plain));
    const V = VIEWS[view] ?? VIEWS.world, mixDb = E.mix ?? {};
    // The low end: at most a few at once (your own always).
    this.lows = this.lows.filter((x) => x.end > t);
    let lowOk = view === '1p' || this.lows.length < HDR.lows || this.lows.some((x) => x.level < level);
    for (const name of names) {
      if (view === '1p' && name === 'far') continue;
      const w = W ? W[plain(name)] : 1;
      if (w < 0.05) continue;                         // (a layer that faint adds nothing but cost)
      const low = name === 'low';
      if (low && !lowOk) { this.stats.lowsSkipped++; continue; }
      const b = name === 'far' ? this.#deal(E.far, 'far') : this.#deal(base, name);
      if (!b) continue;
      if (low) { this.lows.push({ end: t + b.duration, level }); if (this.lows.length > HDR.lows) { this.lows.sort((a, z) => a.level - z.level); this.lows.shift(); } }
      out.push({ buf: b, gain: w * dbToGain((mixDb[name] ?? 0) + (V[plain(name)] ?? 0)), rate: 1 + (Math.random() * 2 - 1) * 0.025, low });
    }
    return out;
  }

  #stop(v, fade = 0.05) {
    if (v.done) return;
    v.done = true;
    const t = this.ctx.currentTime;
    for (const g of [v.out, v.lowOut]) { if (!g) continue; g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(0, t + fade); }
    for (const s of v.srcs) { try { s.stop(t + fade + 0.01); } catch { /* not started */ } }
  }
  stop(v, fade) { if (v) this.#stop(v, fade); }

  // ---------------------------------------------------------------- loops (engines, beams, fire, heartbeat, the atmosphere's beds)
  /** A looping sound under `key`, positioned like play() and updated by updateLoop(). o: { pos, kind, gain, rate, ui, amb, start }. */
  loop(key, id, o = {}) {
    if (this.loops.has(key) || !this.running) return;
    const base = this.recordedId(id);
    const b = base ? this.#deal(base, this.manifest[base].takes ? 'takes' : Object.keys(this.manifest[base].layers)[0]) : this.#pick(id);
    if (!b) return;
    const c = this.ctx, s = c.createBufferSource(); s.buffer = b; s.loop = true; s.playbackRate.value = o.rate ?? 1;
    const g = c.createGain(); g.gain.value = 0;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 20000;
    const p = c.createStereoPanner && o.pos ? c.createStereoPanner() : null;
    s.connect(g); g.connect(lp); let node = lp;
    if (p) { lp.connect(p); node = p; }
    const bus = o.ui ? this.ui : o.amb ? this.amb : this.world;
    node.connect(bus);
    let send = null;
    if (!o.ui && !o.amb) { send = c.createGain(); send.gain.value = 0.1; node.connect(send); send.connect(this.reverbIn); }
    s.start(c.currentTime, o.start ?? Math.random() * b.duration * 0.9);
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
      level *= sh.gain; cutoff = sh.cutoff * (0.65 + 0.35 * (0.5 + 0.5 * Math.cos(az))); pan = Math.sin(az) * 0.85; wet = sh.wet;
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
   * Shell shock: a blast close by. The world goes dull and quieter, a ring sounds in your ears
   * (only for the close ones, and not again for a while), and it all comes back over seconds. k 0..1.
   */
  shock(k) {
    if (!this.running || k <= 0.02) return;
    const t = this.ctx.currentTime, f = this.shockFilter.frequency, base = this.#base();
    const to = Math.max(260, base * (1 - 0.985 * Math.min(1, k)));
    f.cancelScheduledValues(t); f.setValueAtTime(f.value, t); f.exponentialRampToValueAtTime(to, t + 0.03); f.setTargetAtTime(base, t + 0.25 + 0.6 * k, 0.6 + 1.2 * k);
    const dg = this.duck.gain;
    dg.cancelScheduledValues(t); dg.setValueAtTime(dg.value, t); dg.linearRampToValueAtTime(1 - 0.45 * Math.min(1, k), t + 0.03); dg.setTargetAtTime(1, t + 0.3, 0.8 + k);
    if (k > 0.45 && t > (this.ringUntil ?? 0)) {
      this.ringUntil = t + 6;
      const tg = this.tinGain.gain, a = 0.05 * Math.min(1, (k - 0.45) / 0.4);
      tg.cancelScheduledValues(t); tg.setValueAtTime(tg.value, t); tg.linearRampToValueAtTime(a, t + 0.08); tg.setTargetAtTime(0, t + 0.5, 0.9 + 1.2 * k);
    }
  }
  /** Rounds cracking past (0..1): the world pulled in a little for a moment, and it stacks. */
  suppress(k) {
    if (!this.running || k <= 0.05) return;
    const t = this.ctx.currentTime;
    this.supp = Math.min(1, this.supp * Math.exp(-((t - (this.suppT ?? t)) / 1.5)) + k * 0.35);
    this.suppT = t;
    const f = this.shockFilter.frequency, to = Math.max(1800, this.#base() * (1 - 0.75 * this.supp));
    if (f.value > to * 1.02) { f.cancelScheduledValues(t); f.setValueAtTime(f.value, t); f.linearRampToValueAtTime(to, t + 0.04); f.setTargetAtTime(this.#base(), t + 0.2, 0.9); }
  }
  /** Low health (0..1): the world a little dull, the way it gets when you're hurt. */
  setMuffle(k) {
    if (Math.abs(k - this.muffle) < 0.02) return;
    this.muffle = k;
    if (this.running) this.shockFilter.frequency.setTargetAtTime(this.#base(), this.ctx.currentTime, 0.4);
  }
  #base() { return 20000 * (1 - this.muffle) + 1400 * this.muffle; }

  setVolume(v) { this.master.gain.setTargetAtTime(MASTER.gain * v, this.ctx.currentTime, 0.05); }
}
