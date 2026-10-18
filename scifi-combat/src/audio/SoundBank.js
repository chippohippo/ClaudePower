// SoundBank: every sound in the game, designed in code and rendered offline (dsp.js), the way a
// sound designer layers real recordings, built from the physics of each sound instead:
//
//  * Kinetic guns (coil-assisted slug throwers): the crack (the muzzle's shock front, a few ms of
//    broadband noise), the thump (the pressure punch, a sine falling an octave or two), the body
//    (the blast's roar, low-passed noise), the bark (a mid band that gives each gun its voice),
//    the action (a click and the ring of its metal), a coil's electric snap; saturated together
//    so they hit as one. A far version: the crack gone, the body dulled, rolling echoes off the
//    city's walls.
//  * Lasers and plasma: the "slinky" blaster (a dispersive chirp falling from kilohertz to a few
//    hundred hertz, its partials, an FM edge, a resonant ring, a sub punch). Solari hard light is
//    bright and glassy, rising in its ring; Void plasma is dark, ring-modulated, with a reversed
//    breath before the shot. Beams are seamless loops.
//  * Near misses (the fear): a supersonic crack (an N-wave) or a bolt's buzzing Doppler pass.
//  * Explosions: the crack, the sub-bass you feel, the blast's roar sweeping down, crackle,
//    debris raining down after; far away only the thud and the rumble rolling back off the city.
//  * Impacts by surface, hits on you and your shield, footsteps by surface (snow crunches),
//    gear, cloth, bodies, weapon handling, engines, fire, melee, call-ins, abilities by signature,
//    ambience.
// Each one-shot has a few variants (another seed, a few % of pitch) so nothing repeats exactly.
// render(id, variant) -> { ch: [L, R] or [mono], sr }: distant versions are mono at half rate
// (they're muffled anyway), anything that came out the same on both sides is stored once.
// Pure: runs in the sound worker or in Node.

import * as D from './dsp.js';

export const VARIANTS = 3;

// ---------------------------------------------------------------- weapon profiles
/**
 * Kinetic: thump [Hz from, Hz to, tau, amp], body [lowpass Hz, tau, amp], bark [Hz, Q, tau, amp],
 * crack [tau, highpass Hz, amp], zap [Hz from, Hz to, s, amp] (a coil's snap) or growl Hz (Void:
 * ring-modulated), mech [delay, Hz, amp], len s, drive, slap: baked near reflections.
 */
const KINETIC = {
  ar_sol: { thump: [140, 52, 0.035, 0.9], body: [1400, 0.03, 0.8], bark: [760, 0.9, 0.018, 0.55], crack: [0.0012, 1800, 1], zap: [4800, 1500, 0.018, 0.22], mech: [0.012, 3100, 0.18], len: 0.3, drive: 1.8 },
  br_sol: { thump: [120, 45, 0.045, 1], body: [1100, 0.04, 0.9], bark: [600, 0.9, 0.025, 0.55], crack: [0.0015, 1600, 1], zap: [4200, 1200, 0.022, 0.26], mech: [0.014, 2700, 0.2], len: 0.36, drive: 2 },
  ar_void: { thump: [110, 40, 0.042, 1], body: [950, 0.036, 0.85], bark: [470, 1.2, 0.024, 0.6], crack: [0.0014, 1400, 0.9], growl: 92, pre: 0.025, mech: [0.013, 2400, 0.2], len: 0.34, drive: 2.2 },
  smg_sol: { thump: [210, 95, 0.02, 0.7], body: [2000, 0.018, 0.65], bark: [1100, 1, 0.012, 0.5], crack: [0.0008, 2400, 0.9], zap: [6000, 2400, 0.012, 0.18], mech: [0.008, 3800, 0.15], len: 0.2, drive: 1.6 },
  smg_void: { thump: [170, 70, 0.024, 0.75], body: [1500, 0.02, 0.7], bark: [800, 1.1, 0.014, 0.55], crack: [0.001, 1900, 0.85], growl: 120, mech: [0.009, 3000, 0.16], len: 0.22, drive: 2 },
  sg_sol: { thump: [100, 38, 0.07, 1.2], body: [800, 0.06, 1], bark: [420, 0.8, 0.04, 0.6], crack: [0.0025, 1200, 1], zap: [3600, 900, 0.03, 0.2], len: 0.55, drive: 2.4 },
  sg_void: { thump: [90, 34, 0.065, 1.2], body: [700, 0.055, 1], bark: [360, 0.9, 0.04, 0.6], crack: [0.0022, 1100, 0.95], growl: 70, pre: 0.03, len: 0.52, drive: 2.6 },
  sr_sol: { thump: [95, 32, 0.09, 1.25], body: [1000, 0.07, 1], bark: [520, 0.8, 0.05, 0.5], crack: [0.0016, 2000, 1.2], zap: [7000, 900, 0.06, 0.45], slap: [[0.13, 0.35, 1600], [0.27, 0.2, 1100]], len: 1, drive: 2.2 },
  sr_void: { thump: [85, 30, 0.085, 1.25], body: [800, 0.07, 1], bark: [440, 0.9, 0.05, 0.5], crack: [0.0014, 2200, 1.2], needle: [9000, 3000, 0.12, 0.3], growl: 60, slap: [[0.13, 0.35, 1400], [0.27, 0.2, 1000]], len: 1, drive: 2.3 },
  hmg: { thump: [115, 42, 0.05, 1.1], body: [1000, 0.045, 0.95], bark: [520, 0.8, 0.03, 0.6], crack: [0.0016, 1500, 1.05], mech: [0.016, 2200, 0.25], len: 0.42, drive: 2.3 },
  autocannon: { thump: [80, 30, 0.08, 1.3], body: [700, 0.07, 1], bark: [300, 0.8, 0.05, 0.6], crack: [0.002, 1200, 1.1], zap: [3000, 700, 0.04, 0.2], mech: [0.02, 1700, 0.3], len: 0.7, drive: 2.6 },
  cannon: { thump: [62, 22, 0.16, 1.5], body: [520, 0.14, 1.1], bark: [230, 0.7, 0.08, 0.5], crack: [0.003, 900, 1.2], mech: [0.08, 900, 0.3], slap: [[0.16, 0.4, 900], [0.38, 0.25, 700], [0.7, 0.15, 500]], len: 1.6, drive: 3 },
};

/**
 * Lasers: chirp [Hz from, Hz to, tau], partials [[ratio, amp]...], fm [ratio, index, tau],
 * ring [Hz, Q, amp], sub [Hz from, Hz to, tau, amp], sizzle amp, growl [Hz, depth], pre
 * (a reversed breath before the shot, s), len, drive.
 */
const LASER = {
  pulse_sol: { chirp: [6200, 420, 0.03], partials: [[1, 1], [2, 0.35], [3, 0.15]], fm: [0.5, 2.5, 0.04], ring: [2800, 14, 0.35], sub: [110, 50, 0.04, 0.7], sizzle: 0.25, len: 0.38, drive: 1.4 },
  pulse_void: { chirp: [3200, 170, 0.045], partials: [[1, 1], [3, 0.45], [5, 0.25]], fm: [1.41, 4, 0.05], ring: [1300, 10, 0.3], sub: [80, 34, 0.05, 0.9], sizzle: 0.15, growl: [75, 0.6], pre: 0.03, len: 0.42, drive: 2 },
  light_sol: { chirp: [7200, 700, 0.022], partials: [[1, 1], [2, 0.3]], fm: [0.5, 1.8, 0.03], ring: [3400, 12, 0.3], sub: [140, 70, 0.025, 0.5], sizzle: 0.2, len: 0.28, drive: 1.3 },
  light_void: { chirp: [3800, 260, 0.03], partials: [[1, 1], [3, 0.4]], fm: [1.41, 3, 0.04], ring: [1600, 9, 0.28], sub: [100, 45, 0.035, 0.7], sizzle: 0.12, growl: [95, 0.5], pre: 0.02, len: 0.32, drive: 1.8 },
  plasma_sol: { chirp: [1600, 60, 0.09], partials: [[1, 1], [1.5, 0.3], [2, 0.2]], fm: [0.5, 3, 0.1], ring: [900, 6, 0.3], sub: [70, 26, 0.12, 1.2], sizzle: 0.5, blast: 0.8, len: 1.3, drive: 2.6 },
  lance_sol: { chirp: [5200, 240, 0.06], partials: [[1, 1], [2, 0.5], [3, 0.3], [4, 0.15]], fm: [0.5, 3, 0.07], ring: [2200, 16, 0.45], sub: [80, 30, 0.08, 1.2], sizzle: 0.35, blast: 0.4, len: 0.9, drive: 2.2 },
  lance_void: { chirp: [2600, 110, 0.07], partials: [[1, 1], [3, 0.5], [5, 0.3]], fm: [1.41, 5, 0.08], ring: [1100, 12, 0.4], sub: [60, 24, 0.09, 1.3], sizzle: 0.2, growl: [55, 0.7], pre: 0.05, blast: 0.4, len: 0.95, drive: 2.6 },
  rail_sol: { chirp: [9000, 300, 0.05], partials: [[1, 1], [2, 0.4], [3.01, 0.25]], fm: [0.5, 4, 0.06], ring: [3100, 20, 0.5], sub: [70, 22, 0.15, 1.4], sizzle: 0.4, blast: 0.6, slap: [[0.15, 0.4, 1800], [0.33, 0.25, 1100]], len: 1.6, drive: 2.6 },
};

/** Weapon (and vehicle gun, transform super) -> its design: [kind, profile]. */
const BY_AUDIO = {
  bike_blaster: ['laser', 'light_sol'], skiff_gun: ['laser', 'light_void'], tank_cannon: ['gun', 'cannon'], repeater: ['gun', 'autocannon'],
  rift_mortar: ['gun', 'cannon'], wing_cannons: ['gun', 'autocannon'], void_lances: ['laser', 'lance_void'], door_gun: ['gun', 'hmg'],
  super_lance: ['laser', 'lance_sol'], super_judgment: ['laser', 'rail_sol'], super_rift: ['gun', 'sg_void'], super_siege: ['gun', 'cannon'],
};
const BY_ID = { sol_br_verdict: ['gun', 'br_sol'], sol_plasma_sunburst: ['laser', 'plasma_sol'] };
const BY_ARCH = { assaultRifle: 'ar', smg: 'smg', shotgun: 'sg', sniper: 'sr' };

/** The design for a weapon spec ({ id, audio, archetype, damage }): ['gun' | 'laser' | 'beam', profile]. */
export function weaponDesign(spec) {
  if (!spec) return ['gun', 'ar_sol'];
  const v = /^void|^crawler|^carrier|^skiff/.test(spec.id ?? '') ? 'void' : 'sol';
  if (spec.archetype === 'beam' || /beam/.test(spec.audio ?? '')) return ['beam', v];
  if (BY_AUDIO[spec.audio]) return BY_AUDIO[spec.audio];
  if (BY_ID[spec.id]) return BY_ID[spec.id];
  if (spec.archetype === 'pulseRifle') return ['laser', `pulse_${v}`];
  const a = BY_ARCH[spec.archetype];
  if (a) return ['gun', `${a}_${v}`];
  if ((spec.damage?.splash ?? 0) >= 3) return ['gun', 'cannon'];
  return ['gun', (spec.rpm ?? 600) > 700 ? 'hmg' : `ar_${v}`];
}

// ---------------------------------------------------------------- helpers
const jit = (r, x, k = 0.04) => x * (1 + (r() * 2 - 1) * k);
/** One layer: noise through a filter under an envelope. */
function noiseHit(n, r, { color = 'white', type = 'lowpass', f = 1000, q = 0.707, a = 0.001, tau = 0.05, at = 0 }, sr) {
  const x = D.noise(n, r, color);
  if (type) D.biquad(x, type, f, q, 0, sr);
  return D.mul(x, D.envExp(n, a, tau, sr, at));
}
/** A pitched punch: a sine gliding f0 -> f1 under an exponential envelope. */
function thump(n, f0, f1, tau, sr, attack = 0.0008) {
  return D.mul(D.osc(n, D.glide(f0, f1, tau * 0.6), 'sine', sr), D.envExp(n, attack, tau, sr));
}
/** City echoes for a distant sound: rolling reflections off facades, each duller. */
const FAR_TAPS = [[0.09, 0.55, 1300], [0.21, 0.42, 1000], [0.38, 0.3, 800], [0.62, 0.2, 650], [0.95, 0.12, 500]];

// ---------------------------------------------------------------- kinetic guns
function kinetic(P, view, r, sr) {
  const far = view === 'far', first = view === '1p';
  const len = far ? P.len * 1.5 + 1.15 : P.len + 0.12;
  const n = D.samples(len, sr);
  const core = new Float32Array(n), sideL = new Float32Array(n), sideR = new Float32Array(n);
  const t0 = P.pre && !far ? P.pre : 0;
  // A reversed breath before a Void gun's shot: the air pulled in.
  if (t0) {
    const m = D.samples(t0, sr), pre = D.reverse(D.mul(D.highpass(D.noise(m, r), 1500, 0.7, sr), D.envExp(m, 0.0005, t0 * 0.35, sr)));
    D.mix(core, pre, 0.25);
  }
  const [f0, f1, tt, ta] = P.thump;
  D.mix(core, thump(D.samples(tt * 8, sr), jit(r, f0), f1, jit(r, tt), sr), ta * (first ? 1.25 : 1) * (far ? 0.7 : 1), t0, sr);
  const [blp, bt, ba] = P.body;
  const body = noiseHit(D.samples(bt * 9, sr), r, { color: 'brown', f: far ? Math.min(blp, 650) : blp, q: 0.6, a: 0.0006, tau: jit(r, bt * (far ? 1.6 : 1)) }, sr);
  D.mix(core, D.normalize(body, 1), ba * (first ? 1.15 : 1), t0, sr);
  if (!far) {
    const [bf, bq, btau, bamp] = P.bark;
    for (const side of [sideL, sideR]) D.mix(side, noiseHit(D.samples(btau * 8, sr), r, { type: 'bandpass', f: jit(r, bf, 0.05), q: bq, a: 0.0005, tau: btau }, sr), bamp * 2.2, t0, sr);
    const [ct, chp, ca] = P.crack;
    for (const side of [sideL, sideR]) D.mix(side, noiseHit(D.samples(ct * 10, sr), r, { type: 'highpass', f: chp, q: 0.7, a: 0.00015, tau: jit(r, ct) }, sr), ca * 1.4, t0, sr);
    if (P.zap) {
      const [z0, z1, zl, za] = P.zap, m = D.samples(zl * 3, sr);
      D.mix(core, D.mul(D.osc(m, D.sweep(jit(r, z0), z1, zl), 'sine', sr), D.envExp(m, 0.0004, zl * 0.6, sr)), za, t0, sr);
    }
    if (P.needle) {
      const [z0, z1, zl, za] = P.needle, m = D.samples(zl * 2, sr);
      D.mix(sideL, D.mul(D.osc(m, D.sweep(z0, z1, zl), 'sine', sr), D.envExp(m, 0.001, zl * 0.5, sr)), za, t0, sr);
      D.mix(sideR, D.mul(D.osc(m, D.sweep(z0 * 1.01, z1, zl), 'sine', sr), D.envExp(m, 0.001, zl * 0.5, sr)), za, t0, sr);
    }
    if (P.mech) {
      const [md, mf, ma] = P.mech, m = D.samples(0.06, sr);
      const click = D.mix(noiseHit(m, r, { type: 'bandpass', f: mf, q: 2, a: 0.0002, tau: 0.0015 }, sr), D.modes(m, [[jit(r, mf * 0.93), 0.5, 0.012], [mf * 1.47, 0.3, 0.008], [mf * 2.1, 0.2, 0.005]], sr, r), 0.6);
      D.mix(core, click, ma * (first ? 1.6 : 0.8), md + t0, sr);
      if (first) D.mix(core, click, ma * 0.7, md + 0.05 + t0, sr);       // the bolt carrier going home
    }
  }
  if (P.growl) D.ring(core, P.growl, 0.35, sr);
  D.saturate(core, P.drive * (far ? 0.7 : 1));
  for (const side of [sideL, sideR]) D.saturate(side, P.drive * 0.8);
  let [L, R] = D.stereo(core, sideL, sideR, first ? 1 : 0.8);
  // Near reflections baked in (a sniper's slap off the street); far: the city rolling it back.
  const taps = far ? FAR_TAPS : P.slap ?? [[0.018, 0.22, 3000], [0.034, 0.14, 2200]];
  L = D.echoes(L, taps, 0, sr); R = D.echoes(R, taps.map(([t, g, f]) => [t * 1.07, g, f]), 0, sr);
  if (far) { D.mix(L, R, 1); L = D.lowpass(L, 2400, 0.7, sr); R = L; }      // far off: one muffled source
  const out = D.normalize2([L.subarray(0, n), R === L ? L.subarray(0, n) : R.subarray(0, n)], 0.95);
  D.fadeOut(out[0], 0.03, sr); if (out[1] !== out[0]) D.fadeOut(out[1], 0.03, sr);
  return out;
}

// ---------------------------------------------------------------- lasers and plasma
function laser(P, view, r, sr) {
  const far = view === 'far', first = view === '1p';
  const len = far ? P.len * 1.4 + 1.1 : P.len + 0.1;
  const n = D.samples(len, sr);
  const core = new Float32Array(n), sideL = new Float32Array(n), sideR = new Float32Array(n);
  const t0 = P.pre && !far ? P.pre : 0;
  if (t0) {
    // The reversed breath: a swell of filtered noise sucked into the shot.
    const m = D.samples(t0 + 0.02, sr), pre = D.reverse(D.mul(D.bandpass(D.noise(m, r), 1800, 0.8, sr), D.envExp(m, 0.001, (t0 + 0.02) * 0.4, sr)));
    D.mix(core, pre, 0.5);
  }
  const [c0, c1, ctau] = P.chirp;
  const f = D.glide(jit(r, c0, 0.06), jit(r, c1, 0.05), jit(r, ctau, 0.08));
  const m = D.samples(P.len, sr);
  const tone = new Float32Array(m);
  for (const [k, a] of P.partials) D.mix(tone, D.osc(m, (t) => f(t) * k, 'sine', sr, r()), a);
  const [fr, fi, ft] = P.fm;
  D.mix(tone, D.fm(m, f, fr, fi, ft, sr), 0.6);
  D.mul(tone, D.envExp(m, 0.0006, P.len * (far ? 0.4 : 0.22), sr));
  D.fadeOut(tone, P.len * 0.25, sr);                     // (no click where the tone stops)
  if (P.growl) D.ring(tone, P.growl[0], P.growl[1], sr);
  // The ring: the metal of the emitter answering (a high-Q resonance the chirp sweeps through).
  const [rf, rq, ra] = P.ring;
  const ringed = D.bandpass(Float32Array.from(tone), jit(r, rf, 0.03), rq, sr);
  D.mix(sideL, ringed, ra * 3, t0, sr);
  D.mix(sideR, D.bandpass(Float32Array.from(tone), jit(r, rf * 1.012, 0.03), rq, sr), ra * 3, t0, sr);
  if (far) D.lowpass(tone, 1600, 0.7, sr);
  D.mix(core, tone, far ? 0.5 : 1, t0, sr);
  const [s0, s1, st, sa] = P.sub;
  D.mix(core, thump(D.samples(st * 8, sr), s0, s1, st, sr), sa * (first ? 1.2 : 1), t0, sr);
  if (!far) {
    // The tick of the discharge and the sizzle of the air it burned.
    D.mix(core, noiseHit(D.samples(0.01, sr), r, { type: 'highpass', f: 3000, a: 0.0001, tau: 0.0008 }, sr), 0.6, t0, sr);
    for (const side of [sideL, sideR]) D.mix(side, noiseHit(D.samples(0.4, sr), r, { type: 'highpass', f: 5500, a: 0.002, tau: 0.05 }, sr), P.sizzle, t0, sr);
  }
  if (P.blast) D.mix(core, noiseHit(D.samples(P.len, sr), r, { color: 'brown', f: (t) => 2400 * Math.exp(-t / 0.2) + 200, q: 0.6, a: 0.002, tau: P.len * 0.3 }, sr), P.blast * 6, t0, sr);
  D.saturate(core, P.drive * (far ? 0.7 : 1));
  let [L, R] = D.stereo(core, sideL, sideR, first ? 1 : 0.85);
  const taps = far ? FAR_TAPS : P.slap ?? [[0.02, 0.2, 4000], [0.041, 0.12, 2600]];
  L = D.echoes(L, taps, 0, sr); R = D.echoes(R, taps.map(([t, g, f2]) => [t * 1.06, g, f2]), 0, sr);
  if (far) { D.mix(L, R, 1); L = D.lowpass(L, 2000, 0.7, sr); R = L; }
  const out = D.normalize2([L.subarray(0, n), R === L ? L.subarray(0, n) : R.subarray(0, n)], 0.95);
  D.fadeOut(out[0], 0.04, sr); if (out[1] !== out[0]) D.fadeOut(out[1], 0.04, sr);
  return out;
}

/** A beam, held: a seamless loop. Solari: a harmonic hum, shimmering; Void: a throbbing growl. */
function beam(faction, r, sr) {
  const len = 2.4, n = D.samples(len, sr), sol = faction === 'sol';
  const base = sol ? 110 : 55;
  const hum = D.osc(n, (t) => base * (1 + 0.004 * Math.sin(t * 5.3)), 'saw', sr);
  D.bandpass(hum, (t) => (sol ? 900 : 380) * (1 + 0.25 * Math.sin(t * 2.6)), 1.2, sr);
  const shimmer = D.tremolo(D.osc(n, sol ? 3300 : 1650, 'sine', sr), sol ? 13 : 7, 0.7, sr);
  const sub = D.osc(n, base / (sol ? 2 : 1), 'sine', sr);
  const crackle = D.bandpass(D.grains(n, r, 140, (q) => q() * len, 0.0015, sr), 4000, 0.8, sr);
  const core = new Float32Array(n);
  D.mix(core, hum, 1.2); D.mix(core, shimmer, sol ? 0.25 : 0.12); D.mix(core, sub, sol ? 0.4 : 0.8); D.mix(core, crackle, 0.6);
  if (!sol) D.tremolo(core, 6, 0.35, sr);
  D.saturate(core, 1.6);
  const out = D.loopify(core, 0.2, sr);
  return D.normalize2([out, Float32Array.from(out)], 0.8);
}

/** A charge building (the plasma gun): rising tone and hiss over 1.2 s, tremolo quickening. */
function charge(faction, r, sr) {
  const len = 1.3, n = D.samples(len, sr);
  const f = D.sweep(faction === 'sol' ? 300 : 160, faction === 'sol' ? 2400 : 900, 1.2);
  const tone = D.osc(n, f, faction === 'sol' ? 'tri' : 'saw', sr);
  if (faction !== 'sol') D.lowpass(tone, 1800, 0.8, sr);
  const hiss = D.highpass(D.noise(n, r), (t) => 2000 + t * 4000, 0.7, sr);
  const core = new Float32Array(n);
  D.mix(core, tone, 0.7); D.mix(core, hiss, 0.15);
  for (let i = 0; i < n; i++) { const t = i / sr; core[i] *= Math.min(1, t / 1.1) * (0.75 + 0.25 * Math.sin(2 * Math.PI * (6 + t * 18) * t)); }
  D.fadeOut(core, 0.05, sr);
  return D.normalize2([core, Float32Array.from(core)], 0.7);
}

// ---------------------------------------------------------------- near misses
/** A supersonic round passing: the N-wave crack, a zing. */
function crack(r, sr) {
  const n = D.samples(0.18, sr), x = new Float32Array(n);
  const up = Math.round(0.00035 * sr), down = Math.round(jit(r, 0.0009) * sr);
  for (let i = 0; i < up; i++) x[i] = i / up;
  for (let i = 0; i < down; i++) x[up + i] = 1 - (2 * i) / down;
  for (let i = 0; i < up; i++) x[up + down + i] = -1 + i / up;
  D.highpass(x, 700, 0.7, sr);
  D.mix(x, D.mul(D.osc(n, D.glide(jit(r, 2300), 1300, 0.04), 'sine', sr), D.envExp(n, 0.002, 0.03, sr)), 0.12);
  D.mix(x, noiseHit(n, r, { type: 'highpass', f: 3500, a: 0.0005, tau: 0.012 }, sr), 0.25);
  D.normalize(x, 1);
  return [x, Float32Array.from(x)];
}
/** A bolt buzzing past: its pitch falling as it goes by (Doppler), loudest at the pass. */
function whizz(kind, r, sr) {
  const len = 0.32, n = D.samples(len, sr), tp = 0.1;
  const fc = kind === 'void' ? 520 : kind === 'slug' ? 1600 : 1150;
  const f = (t) => fc * (1 + 0.32 * Math.tanh((tp - t) / 0.025));
  const x = kind === 'slug' ? D.bandpass(D.noise(n, r), f, 2.5, sr) : D.osc(n, f, kind === 'void' ? 'saw' : 'square', sr);
  if (kind !== 'slug') D.bandpass(x, fc * 1.3, 1.6, sr);
  if (kind === 'void') D.ring(x, 70, 0.5, sr);
  for (let i = 0; i < n; i++) { const t = i / sr; x[i] *= Math.exp(-(((t - tp) / 0.045) ** 2)); }
  D.mix(x, D.mul(D.highpass(D.noise(n, r), 4000, 0.7, sr), D.envSwell(n, tp, len, 0.18, sr)), 0.15);
  D.normalize(x, 0.9);
  return [x, Float32Array.from(x)];
}

// ---------------------------------------------------------------- explosions
/** size: 1 a grenade, 1.6 a vehicle, 2.4 a shell, 3 a big bomb. far: the thud and the rumble. */
function explosion(size, view, r, sr) {
  const far = view === 'far';
  const len = far ? 2.8 + size * 0.8 : 2.2 + size * 0.6, n = D.samples(len, sr);
  const core = new Float32Array(n), sideL = new Float32Array(n), sideR = new Float32Array(n);
  D.mix(core, thump(D.samples(1.6 * size, sr), jit(r, 72 - size * 6), 22, jit(r, 0.28 * size), sr, 0.004), far ? 1.4 : 1.3);
  const roar = noiseHit(n, r, { color: 'brown', f: (t) => (far ? 380 : 7000) * Math.exp(-t / (far ? 0.6 : 0.16)) + (far ? 120 : 260), q: 0.6, a: 0.002, tau: jit(r, 0.25 * size) }, sr);
  D.mix(core, D.normalize(roar, 1), far ? 0.9 : 1.1);
  if (!far) {
    for (const side of [sideL, sideR]) {
      D.mix(side, noiseHit(D.samples(0.05, sr), r, { type: 'highpass', f: 900, a: 0.0002, tau: 0.003 * size }, sr), 1.3);
      // Crackle, then the debris coming back down (thick at first, then a patter).
      D.mix(side, D.bandpass(D.grains(n, r, Math.round(40 * size), (q) => q() ** 2 * 1.1 * size, 0.0018, sr), 2600, 0.8, sr), 0.5);
      D.mix(side, D.lowpass(D.grains(n, r, Math.round(70 * size), (q) => 0.3 + q() ** 1.6 * 2 * size, 0.004, sr), 3200, 0.7, sr), 0.35);
    }
  }
  D.saturate(core, far ? 1.6 : 2.6);
  let [L, R] = D.stereo(core, sideL, sideR, 0.9);
  const taps = far ? FAR_TAPS.map(([t, g, f]) => [t * 2.2, g * 1.2, f * 0.6]) : [[0.06, 0.3, 1500], [0.17, 0.22, 900], [0.4, 0.14, 600]];
  L = D.echoes(L, taps, 0, sr); R = D.echoes(R, taps.map(([t, g, f]) => [t * 1.08, g, f]), 0, sr);
  if (far) { D.mix(L, R, 1); L = D.lowpass(L, 900, 0.7, sr); R = L; }
  const out = D.normalize2([L.subarray(0, n), R === L ? L.subarray(0, n) : R.subarray(0, n)], 0.98);
  D.fadeOut(out[0], 0.2, sr); if (out[1] !== out[0]) D.fadeOut(out[1], 0.2, sr);
  return out;
}

/** A gun's report from the artillery line: howitzer boom, AT gun crack, a rocket leaving its rail. */
function report(kind, r, sr) {
  if (kind === 'rocket') {
    const len = 1.6, n = D.samples(len, sr), x = new Float32Array(n);
    D.mix(x, noiseHit(D.samples(0.04, sr), r, { type: 'lowpass', f: 2000, a: 0.0005, tau: 0.01 }, sr), 0.8);
    D.mix(x, D.mul(D.bandpass(D.noise(n, r), D.sweep(450, 3200, 0.9), 1.1, sr), D.envSwell(n, 0.06, len, 1.1, sr, 1)), 0.9);
    D.mix(x, D.mul(D.lowpass(D.noise(n, r, 'brown'), 900, 0.7, sr), D.envExp(n, 0.02, 0.5, sr)), 1.2);
    D.saturate(x, 1.8);
    return D.normalize2([x, Float32Array.from(x)], 0.9);
  }
  const P = kind === 'at' ? { ...KINETIC.cannon, crack: [0.004, 1400, 1.6], thump: [90, 32, 0.12, 1.4], zap: [5000, 900, 0.05, 0.3], len: 1.4 }
    : { ...KINETIC.cannon, thump: [55, 18, 0.24, 1.7], body: [420, 0.2, 1.2], len: 2.2, slap: [[0.22, 0.5, 800], [0.5, 0.35, 600], [0.9, 0.22, 450], [1.4, 0.12, 380]] };
  return kinetic(P, 'near', r, sr);
}

/** An incoming round's whistle, falling to the impact (play its last `t` seconds for an impact `t` away). */
function whistleIncoming(r, sr) {
  const len = 3, n = D.samples(len, sr);
  const x = D.osc(n, (t) => 1750 * (600 / 1750) ** (t / len) * (1 + 0.012 * Math.sin(t * 44)), 'sine', sr);
  D.mix(x, D.bandpass(D.noise(n, r), (t) => 1750 * (600 / 1750) ** (t / len), 6, sr), 0.6);
  for (let i = 0; i < n; i++) { const t = i / sr; x[i] *= (t / len) ** 2.2 * (t > len - 0.03 ? (len - t) / 0.03 : 1); }
  return D.normalize2([x, Float32Array.from(x)], 0.75);
}

// ---------------------------------------------------------------- impacts and hits
function impact(surface, r, sr) {
  const n = D.samples(surface === 'metal' ? 0.7 : 0.4, sr), x = new Float32Array(n), side = new Float32Array(n);
  if (surface === 'metal' || surface === 'vehicle') {
    const f0 = jit(r, surface === 'vehicle' ? 620 : 1150, 0.15);
    D.mix(x, D.modes(n, [[f0, 0.6, 0.18], [f0 * 2.76, 0.35, 0.11], [f0 * 5.4, 0.2, 0.07], [f0 * 8.93, 0.12, 0.04]], sr, r), 1);
    D.mix(side, noiseHit(D.samples(0.02, sr), r, { type: 'highpass', f: 2500, a: 0.0001, tau: 0.0015 }, sr), 1);
    if (r() < 0.4) D.mix(x, D.mul(D.osc(n, D.glide(3400, 1700, 0.14), 'sine', sr), D.envExp(n, 0.01, 0.12, sr)), 0.35, 0.01, sr);   // a ricochet
  } else if (surface === 'wood') {
    D.mix(x, noiseHit(n, r, { type: 'bandpass', f: jit(r, 700), q: 3, a: 0.0005, tau: 0.025 }, sr), 2);
    D.mix(x, D.modes(n, [[jit(r, 310), 0.3, 0.05], [870, 0.2, 0.03]], sr, r), 1);
    D.mix(side, D.bandpass(D.grains(n, r, 8, (q) => q() * 0.15, 0.002, sr), 2500, 1, sr), 0.6);
  } else if (surface === 'energy' || surface === 'hardlight' || surface === 'dome') {
    D.mix(x, noiseHit(n, r, { type: 'highpass', f: 4000, a: 0.002, tau: 0.12 }, sr), 0.5);
    D.mix(x, thump(D.samples(0.05, sr), 320, 120, 0.012, sr), 0.8);
    D.mix(x, D.mul(D.osc(n, (t) => 1250 * (1 + 0.05 * Math.sin(t * 2 * Math.PI * 40)), 'saw', sr), D.envExp(n, 0.002, 0.05, sr)), 0.15);
    D.mix(side, D.bandpass(D.grains(n, r, 14, (q) => q() * 0.22, 0.0015, sr), 3500, 0.8, sr), 0.7);
  } else if (surface === 'flesh') {
    D.mix(x, thump(D.samples(0.12, sr), 140, 60, 0.03, sr), 1);
    D.mix(x, noiseHit(n, r, { type: 'bandpass', f: 300, q: 0.9, a: 0.001, tau: 0.04 }, sr), 1.5);
  } else {
    // Concrete, dirt, snow: a crack of chips, the thud into it, debris spraying.
    const hard = surface === 'concrete' || surface === 'stone';
    D.mix(side, noiseHit(D.samples(0.02, sr), r, { type: 'highpass', f: hard ? 1500 : 900, a: 0.0001, tau: hard ? 0.0012 : 0.0025 }, sr), hard ? 1 : 0.6);
    D.mix(x, noiseHit(n, r, { type: 'bandpass', f: hard ? 380 : 220, q: 1, a: 0.0006, tau: hard ? 0.02 : 0.03 }, sr), 1.6);
    if (hard) D.mix(x, D.modes(n, [[jit(r, 2400, 0.1), 0.15, 0.01], [3700, 0.1, 0.008]], sr, r), 1);
    D.mix(side, D.bandpass(D.grains(n, r, hard ? 7 : 10, (q) => 0.01 + q() * 0.25, 0.002, sr), hard ? 3000 : 1800, 0.8, sr), 0.5);
    if (!hard) D.mix(x, noiseHit(n, r, { type: 'highpass', f: 2000, a: 0.002, tau: 0.08 }, sr), 0.3);
  }
  D.saturate(x, 1.4);
  return D.normalize2(D.stereo(x, side, side, 0.8), 0.9);
}

/** Hits on you: the round slamming into your armor; your shield taking it; your shield gone. */
function hitOnYou(kind, r, sr) {
  const n = D.samples(kind === 'shieldbreak' ? 0.9 : 0.35, sr), x = new Float32Array(n), side = new Float32Array(n);
  if (kind === 'armor') {
    D.mix(x, thump(D.samples(0.15, sr), 130, 55, 0.04, sr), 1.2);
    D.mix(x, noiseHit(n, r, { type: 'bandpass', f: 320, q: 0.9, a: 0.0008, tau: 0.05 }, sr), 1.5);
    D.mix(side, D.modes(n, [[jit(r, 1700), 0.4, 0.04], [2900, 0.2, 0.02]], sr, r), 0.6);
  } else if (kind === 'shield') {
    D.mix(side, noiseHit(n, r, { type: 'bandpass', f: 3500, q: 2, a: 0.001, tau: 0.07 }, sr), 1.4);
    D.mix(x, D.modes(n, [[jit(r, 2600), 0.4, 0.15], [3900, 0.25, 0.1], [1300, 0.3, 0.08]], sr, r), 0.9);
  } else {
    D.mix(side, D.highpass(D.grains(n, r, 45, (q) => q() ** 1.5 * 0.45, 0.003, sr), 3000, 0.7, sr), 1);
    D.mix(x, D.modes(n, [[2200, 0.5, 0.3], [3310, 0.35, 0.2], [4870, 0.2, 0.12]], sr, r), 0.7);
    D.mix(x, D.mul(D.osc(n, D.glide(1900, 700, 0.15), 'sine', sr), D.envExp(n, 0.001, 0.12, sr)), 0.4);
    D.mix(x, thump(D.samples(0.2, sr), 110, 50, 0.05, sr), 0.8);
  }
  return D.normalize2(D.stereo(x, side, side, 1), 0.9);
}

// ---------------------------------------------------------------- foley
/** A footstep: heel then toe. Snow crunches, concrete taps, metal clanks, wood knocks, dirt thuds. */
function footstep(surface, r, sr) {
  const n = D.samples(0.22, sr), x = new Float32Array(n);
  const step = (at, k) => {
    const m = D.samples(0.12, sr);
    if (surface === 'snow') {
      D.mix(x, D.bandpass(D.grains(m, r, 26, (q) => q() ** 1.4 * 0.07, 0.0016, sr), jit(r, 3200, 0.15), 0.7, sr), 1.4 * k, at, sr);
      D.mix(x, noiseHit(m, r, { type: 'lowpass', f: 220, a: 0.003, tau: 0.03 }, sr), 1.1 * k, at, sr);
    } else if (surface === 'metal') {
      D.mix(x, D.modes(m, [[jit(r, 620, 0.1), 0.4, 0.06], [1710, 0.25, 0.04], [2900, 0.15, 0.03]], sr, r), 0.9 * k, at, sr);
      D.mix(x, noiseHit(m, r, { type: 'lowpass', f: 300, a: 0.001, tau: 0.02 }, sr), 1 * k, at, sr);
    } else if (surface === 'wood') {
      D.mix(x, noiseHit(m, r, { type: 'bandpass', f: jit(r, 420), q: 2.5, a: 0.0008, tau: 0.03 }, sr), 2 * k, at, sr);
      D.mix(x, D.modes(m, [[jit(r, 310), 0.3, 0.05], [870, 0.2, 0.03]], sr, r), 0.6 * k, at, sr);
    } else {
      const hard = surface !== 'dirt' && surface !== 'mud';
      if (hard) D.mix(x, noiseHit(m, r, { type: 'highpass', f: 2200, a: 0.0002, tau: 0.0009 }, sr), 0.5 * k, at, sr);
      D.mix(x, noiseHit(m, r, { type: 'bandpass', f: hard ? 190 : 150, q: 0.8, a: 0.0008, tau: 0.022 }, sr), 1.8 * k, at, sr);
      D.mix(x, noiseHit(m, r, { type: 'bandpass', f: hard ? 1500 : 900, q: 0.7, a: 0.003, tau: 0.03 }, sr), 0.35 * k, at, sr);
    }
  };
  step(0, 1); step(jit(r, 0.045, 0.2), 0.5);
  return D.normalize2([x, Float32Array.from(x)], 0.85);
}
/** Gear and armor rattling on a running soldier: little metal pings. */
function rattle(r, sr) {
  const n = D.samples(0.18, sr), x = new Float32Array(n);
  for (let k = 0; k < 4; k++) D.mix(x, D.modes(D.samples(0.05, sr), [[jit(r, 2800 + k * 900, 0.2), 0.4, 0.012], [jit(r, 6100, 0.2), 0.2, 0.006]], sr, r), 0.5 + r() * 0.5, r() * 0.12, sr);
  return D.normalize2([x, Float32Array.from(x)], 0.7);
}
function cloth(r, sr) {
  const n = D.samples(0.3, sr), x = D.bandpass(D.noise(n, r), jit(r, 1500, 0.2), 0.6, sr);
  D.mul(x, D.envSwell(n, 0.06, 0.3, 0.2, sr, 1.5));
  D.mul(x, D.lowpass(D.noise(n, r), 30, 0.7, sr).map((v) => 0.5 + Math.abs(v) * 8));
  return D.normalize2([x, Float32Array.from(x)], 0.6);
}
/** Bodies: a heavy landing (dives, ragdolls), a slide's scrape, hands catching a fall. */
function body(kind, r, sr) {
  const n = D.samples(kind === 'slide' ? 0.7 : 0.45, sr), x = new Float32Array(n);
  if (kind === 'slide') {
    D.mix(x, D.mul(D.bandpass(D.noise(n, r), 900, 0.7, sr), D.envSwell(n, 0.04, 0.7, 0.4, sr, 1)), 1);
    D.mix(x, D.lowpass(D.grains(n, r, 60, (q) => q() * 0.6, 0.003, sr), 2200, 0.7, sr), 0.4);
  } else {
    D.mix(x, thump(D.samples(0.25, sr), kind === 'hands' ? 160 : 95, 40, kind === 'hands' ? 0.025 : 0.055, sr), 1.2);
    D.mix(x, noiseHit(n, r, { type: 'lowpass', f: 450, a: 0.002, tau: 0.08 }, sr), 1.2);
    if (kind !== 'hands') D.mix(x, D.bandpass(D.grains(n, r, 10, (q) => 0.01 + q() * 0.2, 0.002, sr), 2500, 1, sr), 0.4);
  }
  return D.normalize2([x, Float32Array.from(x)], 0.9);
}
/** Weapon handling: mags, bolts, pumps, the dry click, the swap, vents. */
function mech(kind, r, sr) {
  const n = D.samples(kind === 'vent' || kind === 'overheat' ? 1.1 : 0.4, sr), x = new Float32Array(n), side = new Float32Array(n);
  const click = (at, f, a, ring = 0.02) => {
    D.mix(x, noiseHit(D.samples(0.03, sr), r, { type: 'bandpass', f, q: 1.5, a: 0.0002, tau: 0.002 }, sr), a * 2, at, sr);
    D.mix(x, D.modes(D.samples(0.1, sr), [[jit(r, f * 0.9), 0.4, ring], [f * 1.6, 0.2, ring * 0.6]], sr, r), a, at, sr);
  };
  const slide = (at, f, len, a) => D.mix(side, D.mul(D.bandpass(D.noise(D.samples(len, sr), r), f, 1.2, sr), D.envSwell(D.samples(len, sr), len * 0.3, len, len * 0.5, sr, 1)), a, at, sr);
  if (kind === 'magout') { click(0, 2600, 0.8); slide(0.02, 2200, 0.09, 0.5); }
  else if (kind === 'magin') { slide(0, 1800, 0.06, 0.4); click(0.05, 2100, 1, 0.03); D.mix(x, noiseHit(D.samples(0.05, sr), r, { type: 'bandpass', f: 900, a: 0.0003, tau: 0.012 }, sr), 1.4, 0.05, sr); }
  else if (kind === 'bolt') { click(0, 1900, 0.8); slide(0.01, 1600, 0.1, 0.5); click(0.14, 2300, 1, 0.03); }
  else if (kind === 'pump') { slide(0, 1200, 0.08, 0.7); click(0.07, 1500, 0.9); slide(0.16, 1000, 0.07, 0.6); click(0.22, 1800, 1); }
  else if (kind === 'dry') click(0, 3200, 0.6, 0.01);
  else if (kind === 'swap') { slide(0, 1400, 0.15, 0.4); click(0.13, 2000, 0.6); }
  else if (kind === 'vent' || kind === 'overheat') {
    D.mix(side, D.mul(D.highpass(D.noise(n, r), 2500, 0.7, sr), D.envSwell(n, 0.04, 1.05, 0.7, sr, 1)), 0.8);
    click(0, 1400, 0.8, 0.04);
    if (kind === 'overheat') for (const at of [0.05, 0.2, 0.35]) D.mix(x, D.mul(D.osc(D.samples(0.08, sr), 1700, 'square', sr), D.envExp(D.samples(0.08, sr), 0.002, 0.03, sr)), 0.15, at, sr);
  }
  return D.normalize2(D.stereo(x, side, side, 1), 0.8);
}

/** A spent casing landing: brass ringing at its inharmonic modes, bouncing twice; dull on dirt, all but gone in snow. */
function brass(surface, r, sr) {
  const n = D.samples(0.4, sr), x = new Float32Array(n);
  const damp = surface === 'snow' ? 0.15 : surface === 'dirt' ? 0.35 : 1, f = jit(r, 3700, 0.12);
  // The tick of it striking: bright off something hard, a soft pat in dirt or snow.
  const tick = surface === 'snow' ? { type: 'lowpass', f: 700 } : surface === 'dirt' ? { type: 'bandpass', f: 1400, q: 0.8 } : { type: 'highpass', f: 2500 };
  for (const [at, a] of [[0, 1], [0.06 + r() * 0.05, 0.42], [0.14 + r() * 0.06, 0.16]]) {
    D.mix(x, noiseHit(D.samples(0.03, sr), r, { ...tick, a: 0.0001, tau: surface === 'hard' ? 0.0015 : 0.004 }, sr), a * (surface === 'hard' ? 0.5 : 1.2), at, sr);
    D.mix(x, D.modes(D.samples(0.3, sr), [[f, 1, 0.09 * damp], [f * 2.32, 0.5, 0.05 * damp], [f * 4.07, 0.22, 0.028 * damp], [f * 0.61, 0.3, 0.04 * damp]], sr, r), a * 0.5 * damp, at, sr);
  }
  return D.normalize2([x, Float32Array.from(x)], 0.7);
}

// ---------------------------------------------------------------- engines, fire
function engine(model, r, sr) {
  const len = 3, n = D.samples(len, sr), x = new Float32Array(n);
  if (model === 'tracked' || model === 'car') {
    const f0 = model === 'car' ? 52 : 36;
    // Firing pulses (a jittery pulse train) through the exhaust's low-pass, and the tracks' clatter.
    const pulses = new Float32Array(n);
    let next = 0;
    for (let i = 0; i < n; i++) { if (i >= next) { pulses[i] = 0.7 + r() * 0.3; next = i + Math.round(sr / (f0 * (1 + (r() - 0.5) * 0.04))); } }
    D.mix(x, D.lowpass(pulses, model === 'car' ? 700 : 420, 0.9, sr), 6);
    D.mix(x, D.lowpass(D.noise(n, r, 'brown'), 300, 0.7, sr), 0.6);
    if (model === 'tracked') for (let k = 0; k < len * 11; k++) D.mix(x, D.bandpass(D.grains(D.samples(0.03, sr), r, 3, (q) => q() * 0.01, 0.002, sr), 1600, 1, sr), 0.6, k / 11 + r() * 0.01, sr);
    D.mix(x, D.osc(n, model === 'car' ? 330 : 220, 'saw', sr).map((v) => v * 0.04));
  } else if (model === 'hover') {
    D.mix(x, D.osc(n, (t) => 1180 * (1 + 0.006 * Math.sin(t * 7)), 'sine', sr), 0.3);
    D.mix(x, D.osc(n, 2360, 'sine', sr), 0.1);
    D.mix(x, D.bandpass(D.noise(n, r, 'pink'), 600, 0.5, sr), 1.2);
    D.mix(x, D.osc(n, 60, 'sine', sr), 0.25);
  } else {
    D.mix(x, D.lowpass(D.noise(n, r, 'brown'), 1100, 0.7, sr), 1.4);
    D.mix(x, D.bandpass(D.noise(n, r, 'pink'), 3000, 0.8, sr), 0.4);
    D.mix(x, D.osc(n, (t) => 3400 * (1 + 0.004 * Math.sin(t * 3)), 'sine', sr), 0.06);
    D.mix(x, D.osc(n, 45, 'sine', sr), 0.3);
  }
  D.saturate(x, 1.3);
  const out = D.loopify(x, 0.25, sr);
  return D.normalize2([out, Float32Array.from(out)], 0.7);
}
function fireLoop(r, sr) {
  const len = 3, n = D.samples(len, sr), x = new Float32Array(n);
  D.mix(x, D.lowpass(D.noise(n, r, 'brown'), 650, 0.7, sr), 1.2);
  D.mix(x, D.bandpass(D.grains(n, r, 160, (q) => q() * len, 0.0025, sr), 2200, 0.7, sr), 0.6);
  for (let k = 0; k < 6; k++) D.mix(x, thump(D.samples(0.08, sr), 180, 80, 0.015, sr), 0.4, r() * (len - 0.1), sr);
  const out = D.loopify(x, 0.25, sr);
  return D.normalize2([out, Float32Array.from(out)], 0.7);
}

// ---------------------------------------------------------------- melee
function melee(kind, r, sr) {
  const len = kind === 'parry' ? 1.4 : kind === 'block' || kind === 'guardbreak' ? 0.9 : 0.5, n = D.samples(len, sr);
  const x = new Float32Array(n), side = new Float32Array(n);
  const whoosh = (dur, f0, f1, a, at = 0, rev = false) => {
    const m = D.samples(dur, sr), w = D.mul(D.bandpass(D.noise(m, r), (t) => f0 + (f1 - f0) * Math.sin(Math.PI * Math.min(1, t / dur)), 1.4, sr), D.envSwell(m, dur * 0.45, dur, dur * 0.5, sr, 1.5));
    D.mix(side, rev ? D.reverse(w) : w, a, at, sr);
  };
  const clang = (f0, a, at = 0, tau = 0.25) => D.mix(x, D.modes(n, [[f0, 0.7, tau], [f0 * 2.32, 0.4, tau * 0.7], [f0 * 4.25, 0.25, tau * 0.5], [f0 * 6.63, 0.15, tau * 0.3]], sr, r), a, at, sr);
  const sparks = (a, at = 0) => D.mix(side, D.highpass(D.grains(n, r, 30, (q) => q() ** 2 * 0.3, 0.0015, sr), 3000, 0.7, sr), a, at, sr);
  if (kind === 'swing' || kind === 'swing_flame') {
    whoosh(0.3, 350, 1600, 1.2);
    if (kind === 'swing_flame') D.mix(x, D.mul(D.lowpass(D.noise(n, r, 'brown'), 900, 0.7, sr), D.envSwell(n, 0.12, 0.4, 0.25, sr)), 1.2);
  } else if (kind === 'hit') {
    D.mix(x, thump(D.samples(0.2, sr), 160, 60, 0.035, sr), 1.2);
    D.mix(side, noiseHit(n, r, { type: 'bandpass', f: 2000, a: 0.0005, tau: 0.03 }, sr), 1);
    D.mix(side, noiseHit(n, r, { type: 'highpass', f: 4000, a: 0.002, tau: 0.12 }, sr), 0.4);    // the flame's sizzle
  } else if (kind === 'block') { clang(jit(r, 700), 1); sparks(0.6); D.mix(x, thump(D.samples(0.15, sr), 140, 70, 0.03, sr), 0.6); }
  else if (kind === 'parry') {
    // The loudest, most satisfying thing in the game: a bright bell over a punch, a shimmer, sparks.
    clang(jit(r, 1400, 0.02), 1, 0, 0.6);
    D.mix(x, D.modes(n, [[2100, 0.3, 0.5], [2800, 0.2, 0.4]], sr, r), 0.6);
    D.mix(x, thump(D.samples(0.3, sr), 120, 45, 0.06, sr), 1);
    whoosh(0.25, 800, 3200, 0.6, 0, true);
    sparks(1);
  } else if (kind === 'guardbreak') { clang(jit(r, 420), 1, 0, 0.35); D.mix(x, thump(D.samples(0.3, sr), 90, 35, 0.08, sr), 1.3); sparks(0.7); }
  else if (kind === 'windup') whoosh(0.4, 200, 1200, 1);
  else if (kind === 'windup_unblockable') {
    whoosh(0.45, 120, 700, 1);
    D.mix(x, D.mul(D.ring(D.osc(n, D.sweep(180, 360, 0.4), 'saw', sr), 60, 0.6, sr), D.envSwell(n, 0.35, 0.5, 0.12, sr)), 0.5);
  } else if (kind === 'deflect') { clang(jit(r, 1800), 0.8, 0, 0.12); D.mix(x, D.mul(D.osc(n, D.glide(4200, 1600, 0.05), 'sine', sr), D.envExp(n, 0.001, 0.05, sr)), 0.4); }
  D.saturate(x, 1.4);
  return D.normalize2(D.stereo(x, side, side, 1), 0.9);
}

// ---------------------------------------------------------------- UI and call-ins (2D, clean)
function tone(x, type, f0, f1, at, len, a, sr, attack = 0.003) {
  const m = D.samples(len + 0.02, sr);
  D.mix(x, D.mul(D.osc(m, f0 === f1 ? f0 : D.sweep(f0, f1, len), type, sr), D.envExp(m, attack, len * 0.35, sr)), a, at, sr);
}
function ui(kind, r, sr) {
  const n = D.samples(1.2, sr), x = new Float32Array(n);
  const click = (at, f, a) => D.mix(x, noiseHit(D.samples(0.02, sr), r, { type: 'highpass', f, a: 0.0001, tau: 0.0007 }, sr), a, at, sr);
  let end = 0.3;
  switch (kind) {
    case 'hit': click(0, 3200, 1); tone(x, 'sine', 1500, 1300, 0, 0.04, 0.4, sr); end = 0.08; break;
    case 'hit_head': click(0, 3500, 0.8); tone(x, 'sine', 2400, 2400, 0, 0.07, 0.6, sr); tone(x, 'sine', 3200, 3200, 0.05, 0.09, 0.5, sr); end = 0.18; break;
    case 'hit_kill': click(0, 2500, 0.8); D.mix(x, thump(D.samples(0.25, sr), 170, 80, 0.05, sr), 1); tone(x, 'tri', 1320, 1320, 0.01, 0.25, 0.4, sr); end = 0.3; break;
    case 'hit_plink': tone(x, 'tri', 420, 300, 0, 0.07, 0.6, sr); D.mix(x, noiseHit(D.samples(0.05, sr), r, { type: 'lowpass', f: 600, a: 0.0005, tau: 0.01 }, sr), 0.6); end = 0.1; break;
    case 'hit_shieldbreak': D.mix(x, noiseHit(D.samples(0.15, sr), r, { type: 'bandpass', f: 3800, a: 0.0005, tau: 0.04 }, sr), 1.6); tone(x, 'sine', 1900, 950, 0, 0.14, 0.4, sr); end = 0.2; break;
    case 'hit_friendly': tone(x, 'tri', 520, 520, 0, 0.08, 0.4, sr); tone(x, 'tri', 390, 390, 0.09, 0.1, 0.4, sr); end = 0.22; break;
    case 'ability_hit': click(0, 2800, 0.5); tone(x, 'sine', 1100, 1300, 0, 0.06, 0.35, sr); end = 0.1; break;
    case 'ready': tone(x, 'sine', 880, 880, 0, 0.12, 0.35, sr); tone(x, 'sine', 1320, 1320, 0.07, 0.16, 0.3, sr); end = 0.3; break;
    case 'super_ready': [523, 659, 784, 1046].forEach((f, i) => tone(x, 'tri', f, f, i * 0.07, 0.4, 0.25, sr)); D.mix(x, thump(D.samples(0.5, sr), 90, 60, 0.15, sr), 0.6); end = 0.8; break;
    case 'denied': tone(x, 'tri', 200, 180, 0, 0.1, 0.5, sr); tone(x, 'tri', 200, 170, 0.12, 0.12, 0.5, sr); end = 0.28; break;
    case 'stinger': D.mix(x, D.mul(D.ring(D.osc(n, D.sweep(220, 110, 0.9), 'saw', sr), 47, 0.5, sr), D.envSwell(n, 0.05, 1.1, 0.6, sr)), 0.4); D.mix(x, thump(D.samples(0.8, sr), 70, 30, 0.3, sr), 1); end = 1.15; break;
    case 'empty': click(0, 3200, 0.7); end = 0.04; break;
    case 'open': tone(x, 'sine', 660, 990, 0, 0.07, 0.6, sr); end = 0.1; break;
    case 'error': tone(x, 'saw', 150, 140, 0, 0.09, 0.35, sr); tone(x, 'saw', 150, 132, 0.12, 0.13, 0.35, sr); end = 0.27; break;
    case 'armed': [880, 1175, 1568].forEach((f, i) => tone(x, 'sine', f, f, i * 0.055, 0.14, 0.5, sr)); end = 0.32; break;
    case 'beacon': tone(x, 'sine', 2093, 2093, 0, 0.35, 0.6, sr); tone(x, 'sine', 3136, 3136, 0, 0.18, 0.25, sr); end = 0.4; break;
    case 'beep': tone(x, 'sine', 1760, 1760, 0, 0.05, 0.45, sr); end = 0.07; break;
    case 'throw': D.mix(x, D.mul(D.bandpass(D.noise(D.samples(0.22, sr), r), D.sweep(1800, 420, 0.22), 1.4, sr), D.envExp(D.samples(0.22, sr), 0.03, 0.08, sr)), 0.8); end = 0.25; break;
    case 'grab': for (const at of [0, 0.13]) { click(at, 2200, 0.8); D.mix(x, thump(D.samples(0.1, sr), 180, 110, 0.03, sr), 0.6, at, sr); } end = 0.3; break;
    case 'stim': D.mix(x, noiseHit(D.samples(0.3, sr), r, { type: 'highpass', f: 3200, a: 0.01, tau: 0.1 }, sr), 0.6); tone(x, 'square', 1400, 1400, 0, 0.02, 0.15, sr); tone(x, 'sine', 440, 660, 0.05, 0.25, 0.25, sr); end = 0.4; break;
    case 'repair': for (const at of [0, 0.11, 0.22, 0.33]) D.mix(x, noiseHit(D.samples(0.04, sr), r, { type: 'bandpass', f: 2400, q: 3, a: 0.002, tau: 0.01 }, sr), 1.5, at, sr); end = 0.45; break;
    case 'bp': tone(x, 'sine', 1318, 1318, 0, 0.08, 0.35, sr); tone(x, 'sine', 1975, 1975, 0.055, 0.16, 0.28, sr); end = 0.3; break;
    case 'buy': tone(x, 'tri', 784, 784, 0, 0.06, 0.5, sr); tone(x, 'tri', 1175, 1175, 0.05, 0.11, 0.45, sr); D.mix(x, thump(D.samples(0.2, sr), 98, 70, 0.05, sr), 0.6); end = 0.25; break;
    case 'hero': [523, 659, 784, 1046].forEach((f, i) => tone(x, 'saw', f, f, i * 0.08, 0.5, 0.12, sr)); D.mix(x, thump(D.samples(0.9, sr), 65, 98, 0.3, sr), 0.6); end = 1; break;
    case 'smoke': D.mix(x, noiseHit(D.samples(0.08, sr), r, { type: 'lowpass', f: 900, a: 0.002, tau: 0.02 }, sr), 1); D.mix(x, D.mul(D.highpass(D.noise(n, r), 2600, 0.7, sr), D.envSwell(n, 0.08, 1.15, 0.8, sr, 1)), 0.35, 0.03, sr); end = 1.2; break;
    case 'revive': tone(x, 'sine', 659, 988, 0, 0.3, 0.35, sr); end = 0.35; break;
    case 'revived': [880, 1175, 1760].forEach((f, i) => tone(x, 'sine', f, f, i * 0.06, 0.3, 0.3, sr)); end = 0.45; break;
    case 'down': D.mix(x, thump(D.samples(0.6, sr), 80, 32, 0.2, sr), 1.2); D.mix(x, D.mul(D.osc(n, 3900, 'sine', sr), D.envExp(n, 0.05, 0.6, sr)), 0.08); end = 1; break;
    default: tone(x, 'sine', 1000, 1000, 0, 0.05, 0.3, sr); end = 0.08;
  }
  const out = x.subarray(0, D.samples(end + 0.02, sr));
  D.fadeOut(out, 0.01, sr);
  return D.normalize2([out, Float32Array.from(out)], 0.8);
}
/** The wrist pad's arrows: a whole tone higher for each key of the code (1..10). */
function arrow(k, sr) {
  const x = new Float32Array(D.samples(0.09, sr)), f = 520 * 2 ** ((k - 1) / 6);
  tone(x, 'square', f, f, 0, 0.05, 0.22, sr); tone(x, 'sine', f * 2, f * 2, 0, 0.04, 0.2, sr);
  return D.normalize2([x, Float32Array.from(x)], 0.6);
}
/** An officer's pea whistle: two blasts, the second long; the enemy's lower and rougher. */
function squadWhistle(enemy, sr) {
  const len = 1.75, n = D.samples(len, sr);
  const x = D.osc(n, (t) => (enemy ? 2300 : 2800) + Math.sin(t * 2 * Math.PI * 28) * (enemy ? 260 : 180), enemy ? 'saw' : 'sine', sr);
  if (enemy) D.lowpass(x, 4000, 0.7, sr);
  for (let i = 0; i < n; i++) { const t = i / sr; x[i] *= (t < 0.55 ? Math.min(1, t / 0.02, (0.55 - t) / 0.04) : t > 0.75 && t < 1.6 ? Math.min(1, (t - 0.75) / 0.02, (1.6 - t) / 0.04) : 0); }
  return D.normalize2([x, Float32Array.from(x)], 0.6);
}
function heartbeat(sr) {
  const len = 1, n = D.samples(len, sr), x = new Float32Array(n);
  D.mix(x, thump(D.samples(0.2, sr), 60, 40, 0.05, sr), 1); D.mix(x, thump(D.samples(0.2, sr), 55, 38, 0.05, sr), 0.7, 0.28, sr);
  return D.normalize2([x, Float32Array.from(x)], 0.8);
}
function dig(r, sr) {
  const n = D.samples(0.4, sr), x = new Float32Array(n);
  D.mix(x, noiseHit(n, r, { type: 'bandpass', f: 1300, q: 1.1, a: 0.012, tau: 0.08 }, sr), 1.5);
  D.mix(x, thump(D.samples(0.15, sr), 120, 70, 0.03, sr), 0.6);
  D.mix(x, D.lowpass(D.grains(n, r, 20, (q) => 0.1 + q() * 0.25, 0.003, sr), 1500, 0.8, sr), 0.5);
  return D.normalize2([x, Float32Array.from(x)], 0.8);
}
/** The things that come down from the sky: a pod's rising roar (play its last t s), the strike jet. */
function skyfall(kind, r, sr) {
  const len = kind === 'pod' ? 4 : 4.2, n = D.samples(len, sr), x = new Float32Array(n);
  if (kind === 'pod') {
    D.mix(x, D.lowpass(D.noise(n, r, 'brown'), (t) => 260 + (t / len) ** 2 * 2400, 0.9, sr), 1.4);
    D.mix(x, D.osc(n, (t) => 55 + (t / len) * 30, 'tri', sr), 0.4);
    for (let i = 0; i < n; i++) { const t = i / sr; x[i] *= (0.02 + (t / len) ** 2.5) * (t > len - 0.02 ? 0 : 1); }
  } else {
    D.mix(x, D.mul(D.bandpass(D.noise(n, r), D.sweep(2600, 480, len), 0.8, sr), D.envSwell(n, len * 0.2, len, len * 0.75, sr, 1.5)), 1.6);
    D.mix(x, D.mul(D.osc(n, D.sweep(920, 410, len), 'saw', sr), D.envSwell(n, len * 0.2, len, len * 0.75, sr, 1.5)), 0.08);
    D.mix(x, D.mul(D.osc(n, D.sweep(48, 34, len), 'sine', sr), D.envSwell(n, len * 0.15, len * 0.8, len * 0.5, sr)), 0.7);
  }
  D.saturate(x, 1.4);
  return D.normalize2([x, Float32Array.from(x)], 0.85);
}

// ---------------------------------------------------------------- abilities
const NOTE = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
export const noteHz = (n) => { const m = /^([A-G]#?)(-?\d)$/.exec(n ?? 'A4'); return m ? 440 * 2 ** ((NOTE[m[1]] + (+m[2] - 4) * 12 - 9) / 12) : 440; };
const timbreClass = (t = '') =>
  /bell|chime|crystal|glass|harp|ring|ping|sonar|tick/.test(t) ? 'bell'
    : /brass|choir|organ|chord/.test(t) ? 'choir'
      : /sub|boom|quake|grav|black|implosion|thrum|rumble|thump|stone/.test(t) ? 'sub'
        : /hiss|sizzle|flare|smoke|whisper|flame|fire|jet|static|inhale|roar|slurp|suck/.test(t) ? 'air'
          : /servo|tool|engine|mech|pump|chain|buzz|gnash|grind/.test(t) ? 'mech'
            : /zap|laser|phase|beep|psi|shriek|whine/.test(t) ? 'zap' : 'choir';
/**
 * An ability's cue from its signature (root note, timbre) and its army (Solari rises, bright;
 * Void falls, dark, ring-modulated). kind: cast | threat | loop | end | impact | zone | arming | place.
 */
function ability(root, timbre, faction, kind, r, sr) {
  const f = noteHz(root), sol = faction !== 'void', cls = timbreClass(timbre), threat = kind === 'threat';
  const len = kind === 'loop' || kind === 'zone' ? 2.4 : kind === 'arming' ? 1.2 : kind === 'end' ? 0.5 : threat ? 0.9 : 0.75;
  const n = D.samples(len, sr), x = new Float32Array(n), side = new Float32Array(n);
  const base = f * (threat ? 0.5 : 1), dir = sol ? 1.5 : 0.66;
  const pitch = kind === 'loop' || kind === 'zone' ? (t) => base * (1 + 0.01 * Math.sin(t * 5)) : kind === 'arming' ? D.sweep(base * 0.7, base * 1.3, len) : D.sweep(base, base * dir, 0.3);
  if (cls === 'bell') D.mix(x, D.modes(n, [[base, 0.6, 0.6], [base * 2.76, 0.3, 0.35], [base * 5.4, 0.15, 0.2]], sr, r), 1);
  else if (cls === 'choir') for (const det of [0.995, 1, 1.006]) D.mix(x, D.bandpass(D.osc(n, (t) => pitch(t) * det, 'saw', sr), base * 3, 1.2, sr), 0.6);
  else if (cls === 'sub') D.mix(x, D.osc(n, (t) => pitch(t) * 0.5, 'sine', sr), 1.2);
  else if (cls === 'air') D.mix(side, D.bandpass(D.noise(n, r, 'pink'), (t) => pitch(t) * 3, 1.5, sr), 2);
  else if (cls === 'mech') D.mix(x, D.lowpass(D.osc(n, (t) => pitch(t) * 0.5, 'square', sr), base * 4, 1, sr), 0.6);
  else D.mix(x, D.fm(n, pitch, 2.01, 3, 0.15, sr), 0.8);
  // A body under every cue: a breath of air, and a punch for impacts and threats.
  D.mix(side, D.bandpass(D.noise(n, r), sol ? 2400 : 900, 0.8, sr), 0.25);
  if (kind === 'impact' || threat) D.mix(x, thump(D.samples(0.4, sr), sol ? 160 : 90, sol ? 70 : 35, 0.08, sr), 1);
  if (!sol) D.ring(x, 47 + (f % 23), 0.4, sr);
  const env = kind === 'loop' || kind === 'zone' ? D.envSwell(n, 0.2, len, 0.2, sr, 1) : kind === 'arming' ? D.envSwell(n, len * 0.8, len, 0.1, sr, 2) : D.envExp(n, threat ? 0.002 : kind === 'end' ? 0.01 : 0.008, len * 0.3, sr);
  D.mul(x, env); D.mul(side, env);
  if (!sol && kind !== 'loop' && kind !== 'zone' && kind !== 'arming') { D.reverse(x); D.reverse(side); D.fadeIn(x, 0.01, sr); D.fadeIn(side, 0.01, sr); }   // the Void's reversed swells
  D.saturate(x, threat ? 2.2 : 1.4);
  let [L, R] = D.stereo(x, side, side, 0.7);
  if (kind === 'loop' || kind === 'zone') { L = D.loopify(L, 0.2, sr); R = D.loopify(R, 0.2, sr); }
  return D.normalize2([L, R], threat ? 0.95 : 0.8);
}

// ---------------------------------------------------------------- ambience
/** The battlefield's bed: the city's wind and far hum, or the open front's wind (8 s loops, 2D). */
function ambience(env, r, sr) {
  const len = 8, n = D.samples(len, sr);
  const wind = D.mul(D.lowpass(D.noise(n, r, 'pink'), (t) => 500 + 300 * Math.sin(t * 0.7) + 200 * Math.sin(t * 1.9), 0.6, sr), D.lowpass(D.noise(n, r), 1.5, 0.7, sr).map((v) => 0.5 + Math.abs(v) * 30));
  const L = new Float32Array(n), R = new Float32Array(n);
  D.mix(L, wind, 1); D.mix(R, D.mul(D.lowpass(D.noise(n, r, 'pink'), (t) => 520 + 280 * Math.sin(t * 0.8 + 1), 0.6, sr), D.lowpass(D.noise(n, r), 1.5, 0.7, sr).map((v) => 0.5 + Math.abs(v) * 30)), 1);
  if (env === 'city') {
    // The megacity humming far off, slowly beating; snow hissing.
    for (const out of [L, R]) { D.mix(out, D.osc(n, 55.3, 'sine', sr), 0.06); D.mix(out, D.osc(n, 110.7, 'sine', sr), 0.04); D.mix(out, D.highpass(D.noise(n, r), 6000, 0.7, sr), 0.02); }
  }
  return D.normalize2([D.loopify(L, 0.5, sr), D.loopify(R, 0.5, sr)], 0.5);
}

// ---------------------------------------------------------------- the catalogue
const IMPACT_SURFACES = ['concrete', 'metal', 'vehicle', 'dirt', 'snow', 'wood', 'energy', 'flesh'];
const FOOT_SURFACES = ['concrete', 'snow', 'dirt', 'metal', 'wood'];

/**
 * Every sound id the game plays, most needed first (the worker renders them in this order):
 * the guns (each view), lasers, near misses, impacts, explosions, foley, ... Ability cues are
 * added by signature at run time (abilityId(...)).
 */
export function catalogue() {
  const ids = [];
  for (const p of Object.keys(KINETIC)) for (const v of ['near', 'far', '1p']) ids.push(`gun:${p}:${v}`);
  for (const p of Object.keys(LASER)) for (const v of ['near', 'far', '1p']) ids.push(`laser:${p}:${v}`);
  ids.push('crack', 'whizz:sol', 'whizz:void', 'whizz:slug');
  for (const s of IMPACT_SURFACES) ids.push(`impact:${s}`);
  for (const k of ['armor', 'shield', 'shieldbreak']) ids.push(`hit:${k}`);
  for (const [size, k] of [[1, 'grenade'], [1.6, 'vehicle'], [2.4, 'shell'], [3, 'bomb']]) for (const v of ['near', 'far']) ids.push(`boom:${k}:${v}`);
  for (const k of ['howitzer', 'at', 'rocket']) ids.push(`report:${k}`);
  ids.push('incoming', 'sky:pod', 'sky:jet');
  for (const s of FOOT_SURFACES) ids.push(`foot:${s}`);
  ids.push('rattle', 'cloth', 'body:heavy', 'body:hands', 'body:slide');
  for (const k of ['magout', 'magin', 'bolt', 'pump', 'dry', 'swap', 'vent', 'overheat']) ids.push(`mech:${k}`);
  for (const s of ['hard', 'dirt', 'snow']) ids.push(`brass:${s}`);
  ids.push('beam:sol', 'beam:void', 'charge:sol', 'charge:void');
  for (const m of ['tracked', 'car', 'hover', 'flyer']) ids.push(`engine:${m}`);
  ids.push('fire');
  for (const k of ['swing', 'swing_flame', 'hit', 'block', 'parry', 'guardbreak', 'windup', 'windup_unblockable', 'deflect']) ids.push(`melee:${k}`);
  for (const k of ['hit', 'hit_head', 'hit_kill', 'hit_plink', 'hit_shieldbreak', 'hit_friendly', 'ability_hit', 'ready', 'super_ready', 'denied', 'stinger', 'empty', 'open', 'error', 'armed', 'beacon', 'beep', 'throw', 'grab', 'stim', 'repair', 'bp', 'buy', 'hero', 'smoke', 'revive', 'revived', 'down']) ids.push(`ui:${k}`);
  for (let k = 1; k <= 10; k++) ids.push(`arrow:${k}`);
  ids.push('whistle:ours', 'whistle:enemy', 'heartbeat', 'dig', 'amb:city', 'amb:trench');
  return ids;
}
/** An ability cue's id: its signature, its army, what it's doing. */
export const abilityId = (sig, faction, kind) => `ability:${sig?.root ?? 'A4'}:${sig?.timbre ?? 'tone'}:${faction === 'void' ? 'void' : 'sol'}:${kind}`;

/** How many variants an id has (loops and the pad's arrows have one; your own gun and far sounds two). */
export function variantsOf(id) {
  if (/^(beam|charge|engine|fire|amb|arrow|whistle|heartbeat|incoming|sky|ui|ability:.*:(loop|zone))/.test(id)) return 1;
  return /:(far|1p)$|^boom/.test(id) ? 2 : VARIANTS;
}

/** Render one sound: { ch: [L, R] | [mono], sr }. Distant versions render at half rate (they're muffled). */
export function render(id, variant = 0, sr = D.SR) {
  const rate = /:far$/.test(id) ? sr / 2 : sr;
  const [L, R] = design(id, variant, rate);
  let same = L.length === R.length;
  for (let i = 0; same && i < L.length; i++) if (L[i] !== R[i]) same = false;
  return { ch: same ? [L] : [L, R], sr: rate };
}

function design(id, variant, sr) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  const r = D.rng((h ^ (variant * 0x9e3779b9)) >>> 0);
  const p = id.split(':');
  switch (p[0]) {
    case 'gun': return kinetic(KINETIC[p[1]] ?? KINETIC.ar_sol, p[2], r, sr);
    case 'laser': return laser(LASER[p[1]] ?? LASER.pulse_sol, p[2], r, sr);
    case 'beam': return beam(p[1], r, sr);
    case 'charge': return charge(p[1], r, sr);
    case 'crack': return crack(r, sr);
    case 'whizz': return whizz(p[1], r, sr);
    case 'impact': return impact(p[1], r, sr);
    case 'hit': return hitOnYou(p[1], r, sr);
    case 'boom': return explosion({ grenade: 1, vehicle: 1.6, shell: 2.4, bomb: 3 }[p[1]] ?? 1, p[2], r, sr);
    case 'report': return report(p[1], r, sr);
    case 'incoming': return whistleIncoming(r, sr);
    case 'sky': return skyfall(p[1], r, sr);
    case 'foot': return footstep(p[1], r, sr);
    case 'rattle': return rattle(r, sr);
    case 'cloth': return cloth(r, sr);
    case 'body': return body(p[1], r, sr);
    case 'mech': return mech(p[1], r, sr);
    case 'brass': return brass(p[1], r, sr);
    case 'engine': return engine(p[1], r, sr);
    case 'fire': return fireLoop(r, sr);
    case 'melee': return melee(p[1], r, sr);
    case 'ui': return ui(p[1], r, sr);
    case 'arrow': return arrow(+p[1] || 1, sr);
    case 'whistle': return squadWhistle(p[1] === 'enemy', sr);
    case 'heartbeat': return heartbeat(sr);
    case 'dig': return dig(r, sr);
    case 'amb': return ambience(p[1], r, sr);
    case 'ability': return ability(p[1], p[2], p[3], p[4], r, sr);
    default: return ui('default', r, sr);
  }
}
