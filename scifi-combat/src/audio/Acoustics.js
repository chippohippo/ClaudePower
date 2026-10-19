// Acoustics: the space each map's sound happens in, as an impulse response the engine convolves
// every shot, blast and step with (SoundEngine's room). Each map answers in its own way, so the same
// rifle sounds different on each:
//
//  * open (The Trenches, the scorched front): earth and sandbags close by, a few hard echoes off
//    ruins and wrecks, then the far hills rolling it back for seconds: thunder that swells and
//    fades, dark, low.
//  * city (Dusk City, snow on everything): the street's walls answering at once, the facades
//    across it slapping back at 0.1-0.5 s, a little flutter between them, a tail the snow keeps
//    dull and short.
//  * night (Night City, the same streets on a cold clear night): sound carries in cold air: the
//    slaps brighter, the tail longer, and the towers far down the avenues answering a second or two
//    later.
//  * interior (a room, for later): small and close.
//
// Pure (no WebAudio): the engine builds its ConvolverNode from it, the asset build (tools/audio/
// forge.mjs) bakes distant versions with it, the tests measure it. Unit energy per channel: the
// room gives back what it's sent, and the send levels decide how much of it you hear.

import * as D from './dsp.js';

export const ROOMS = {
  open: {
    len: 4.2, seed: 377,
    early: { n: 5, from: 0.011, to: 0.07, gain: 0.42, lp: 3200 },
    slaps: [[0.17, 0.26, 2000], [0.31, 0.22, 1600], [0.5, 0.17, 1250], [0.74, 0.13, 1000], [1.05, 0.1, 800], [1.5, 0.07, 650]],
    diffuse: { from: 0.04, t60: 1.0, lp0: 2800, lp1: 800, gain: 0.2 },
    roll: { from: 0.2, peak: 0.6, t60: 2.4, lp0: 1500, lp1: 520, gain: 0.32, rate: 2.6 },
  },
  city: {
    len: 3.2, seed: 911,
    early: { n: 12, from: 0.005, to: 0.05, gain: 0.55, lp: 5200 },
    slaps: [[0.093, 0.4, 3400], [0.155, 0.34, 2800], [0.232, 0.3, 2300], [0.318, 0.23, 1900], [0.44, 0.16, 1500], [0.6, 0.1, 1200]],
    flutter: { period: 0.047, from: 0.06, len: 0.55, gain: 0.1, f: 1700 },
    diffuse: { from: 0.025, t60: 2.0, lp0: 4200, lp1: 850, gain: 0.5 },
  },
  night: {
    len: 4.0, seed: 4242,
    early: { n: 12, from: 0.005, to: 0.05, gain: 0.55, lp: 7000 },
    slaps: [[0.088, 0.42, 5200], [0.149, 0.36, 4400], [0.226, 0.31, 3600], [0.31, 0.25, 3000], [0.43, 0.18, 2400], [0.58, 0.12, 2000],
      [0.86, 0.14, 1700], [1.21, 0.11, 1400], [1.64, 0.08, 1100]],
    flutter: { period: 0.043, from: 0.06, len: 0.7, gain: 0.12, f: 2300 },
    diffuse: { from: 0.025, t60: 2.6, lp0: 6500, lp1: 1300, gain: 0.5 },
  },
  interior: {
    len: 1.2, seed: 77,
    early: { n: 16, from: 0.002, to: 0.03, gain: 0.8, lp: 6000 },
    slaps: [],
    diffuse: { from: 0.01, t60: 0.55, lp0: 5000, lp1: 1800, gain: 0.7 },
  },
};

/** The room a map's sound happens in. */
export const roomFor = (env) => (ROOMS[env] ? env : env === 'trench' ? 'open' : 'city');

/** A short burst: one reflection off a rough surface (a few ms of noise falling away), low-passed. */
function reflection(r, lp, sr) {
  const n = D.samples(0.006, sr), x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = (r() * 2 - 1) * Math.exp(-i / (0.0012 * sr));
  return D.lowpass(D.lowpass(x, lp, 0.6, sr), lp, 0.6, sr);
}

/** Noise falling away with t60 (from `from` s), its brightness closing from lp0 to lp1. */
function tail(n, r, { from, t60, lp0, lp1 }, sr, swell = null) {
  const x = D.noise(n, r);
  const s0 = Math.floor(from * sr);
  for (let i = 0; i < n; i++) {
    const t = (i - s0) / sr;
    x[i] = i < s0 ? 0 : x[i] * Math.exp((-6.9 * t) / t60) * Math.min(1, t / 0.01) * (swell ? swell(t) : 1);
  }
  return D.lowpass(D.lowpass(x, (t) => lp1 + (lp0 - lp1) * Math.exp(-t / (t60 * 0.35)), 0.6, sr), (t) => lp1 + (lp0 - lp1) * Math.exp(-t / (t60 * 0.35)), 0.6, sr);
}

/**
 * The impulse response of a room ('open' | 'city' | 'night' | 'interior', or a map's atmosphere
 * name): [L, R], decorrelated, each with unit energy.
 */
export function impulse(env, sr = D.SR) {
  const R = ROOMS[roomFor(env)], n = D.samples(R.len, sr), out = [];
  for (let c = 0; c < 2; c++) {
    const r = D.rng(R.seed * 7 + c * 101), x = new Float32Array(n);
    // The surfaces close by: a cluster of early reflections.
    const E = R.early;
    for (let k = 0; k < E.n; k++) {
      const t = E.from + (E.to - E.from) * (k / E.n + r() / E.n);
      D.mix(x, reflection(r, E.lp * (0.7 + r() * 0.3), sr), E.gain * (0.6 + r() * 0.4) * (1 - 0.5 * k / E.n), t, sr);
    }
    // Hard surfaces further off: the slaps, each later one duller (the two ears hear them a little apart).
    for (const [t, g, lp] of R.slaps) D.mix(x, reflection(r, lp, sr), g * (0.85 + r() * 0.3) * 2.2, t * (1 + (c ? 0.035 : -0.02)) + r() * 0.004, sr);
    // Between parallel facades: a flutter, a ringing train of echoes dying away.
    if (R.flutter) {
      const F = R.flutter;
      for (let t = F.from, k = 0; t < F.from + F.len; t += F.period * (0.97 + r() * 0.06), k++) {
        const ref = D.bandpass(reflection(r, 8000, sr), F.f * (0.9 + r() * 0.2), 1.4, sr);
        D.mix(x, ref, F.gain * 6 * Math.exp(-(t - F.from) / (F.len * 0.4)), t, sr);
      }
    }
    // The diffuse field: everything else, falling away.
    D.mix(x, tail(n, r, R.diffuse, sr), R.diffuse.gain * 0.25);
    // Open ground: the far hills rolling it back, a swell of thunder that comes and goes.
    if (R.roll) {
      const Q = R.roll, wob = D.lowpass(D.noise(n, r), Q.rate, 0.7, sr), wp = D.peak(wob) || 1;
      const swell = (t) => Math.min(1, t / Q.peak) ** 1.5 * (0.35 + 0.65 * Math.max(0, wob[Math.min(n - 1, Math.floor((t + Q.from) * sr))] / wp + 0.5) ** 2);
      D.mix(x, tail(n, r, { from: Q.from, t60: Q.t60, lp0: Q.lp0, lp1: Q.lp1 }, sr, swell), Q.gain * 0.25);
    }
    D.fadeOut(x, 0.25, sr);
    let e = 0;
    for (let i = 0; i < n; i++) e += x[i] * x[i];
    out.push(D.scale(x, 1 / Math.sqrt(e || 1)));
  }
  return out;
}

/** How long a room rings: the time its energy takes to fall 60 dB (from the backwards-integrated decay), s. */
export function rt60(ir, sr = D.SR) {
  const n = ir.length, sch = new Float64Array(n);
  let acc = 0;
  for (let i = n - 1; i >= 0; i--) { acc += ir[i] * ir[i]; sch[i] = acc; }
  const db = (i) => 10 * Math.log10(sch[i] / sch[0] + 1e-30);
  let a = 0, b = 0;
  while (a < n && db(a) > -5) a++;
  b = a;
  while (b < n && db(b) > -25) b++;
  return ((b - a) / sr) * 3;
}
