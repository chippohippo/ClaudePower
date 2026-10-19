// Each map's atmosphere: what you hear when nobody near you is shooting, and under it when they
// are. Beds (long stereo loops the Ambience plays together, each drifting in level on its own, so
// they never line up the same way twice) and spots (one-shot things placed round you at a distance:
// a gust, a siren, a creak, a fire flaring, an aircraft going over). The war beyond the map (far
// barrages, machine guns, blasts) is played at runtime from the guns' and blasts' far layers.
//
//  * The Trenches (scorched ash front): hot gusting wind over open ground, the whole front rumbling
//    far off (barrages swelling and dying), ash and embers ticking; wire posts creaking, fires
//    flaring up, a far aircraft droning over.
//  * Dusk City (snowfall at dusk): snowy wind, soft and dark; the megacity's hum and far roar; snow
//    hissing; far sirens, a PA klaxon, patrol drones, neon buzzing, steel groaning, snow sliding off
//    a roof.
//  * Night City (the aurora, a cold clear night): still cold air, wind singing through the towers,
//    a deeper electric hum; searchlights turning, an air-raid siren, dropships passing,
//    transformers arcing. Cold air carries: the far war is louder here (Ambience).

import * as D from '../../src/audio/dsp.js';
import * as B from './lib.mjs';

const SR = B.SR;
const seeded = (id, k = 0) => { let h = 2166136261; for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619); return D.rng((h ^ ((k + 1) * 0x9e3779b9)) >>> 0); };
const jit = (r, x, k = 0.1) => x * (1 + (r() * 2 - 1) * k);

/** A slow random curve: points every `step` s (0..1), joined smoothly (cosine), `len` s long, as f(t). */
function drift(r, len, step, lo = 0, hi = 1) {
  const pts = Array.from({ length: Math.ceil(len / step) + 3 }, () => lo + (hi - lo) * r());
  return (t) => { const x = t / step, i = Math.floor(x), f = 0.5 - 0.5 * Math.cos(Math.PI * (x - i)); return pts[i] * (1 - f) + pts[i + 1] * f; };
}
/** A seamless stereo loop from two channel renderers (each gets its own random source). */
function bed(id, len, render) {
  const n = D.samples(len + 1.5, SR), L = render(seeded(id, 1), n), R = render(seeded(id, 2), n);
  return B.st(D.loopify(L, 1.5, SR), D.loopify(R, 1.5, SR));
}

// ---------------------------------------------------------------- beds
/** Wind: noise through a low-pass that breathes with the gusts, louder when it gusts. */
function wind(r, n, { lo = 180, hi = 900, gust = 6, floor = 0.25, color = 'pink' } = {}) {
  const len = n / SR, g = drift(r, len, gust, 0, 1), g2 = drift(r, len, gust * 0.37, 0, 1);
  const x = D.noise(n, r, color);
  D.lowpass(x, (t) => lo + (hi - lo) * g(t) ** 1.5 * (0.7 + 0.3 * g2(t)), 0.6, SR);
  D.highpass(x, 60, 0.7, SR);
  for (let i = 0; i < n; i++) { const t = i / SR; x[i] *= floor + (1 - floor) * g(t) ** 2 * (0.6 + 0.4 * g2(t)); }
  return D.normalize(x, 0.5);
}
/** The front far off: a low rumble that never stops, barrages swelling in it and dying away. */
function frontRumble(r, n) {
  const len = n / SR, x = D.lowpass(D.noise(n, r, 'brown'), 110, 0.7, SR);
  const sw = drift(r, len, 7, 0.3, 1);
  for (let i = 0; i < n; i++) x[i] *= sw(i / SR);
  D.normalize(x, 0.5);
  // Far guns: soft thuds, the air having taken everything but their weight.
  for (let t = r() * 2; t < len - 3; t += 0.6 + r() ** 2 * 5) {
    const m = D.samples(2.4, SR), k = D.osc(m, D.glide(jit(r, 55, 0.2), jit(r, 30, 0.15), 0.3), 'sine', SR);
    D.mul(k, D.envExp(m, jit(r, 0.05, 0.4), jit(r, 0.5, 0.4), SR));
    D.mix(k, D.mul(D.lowpass(D.noise(m, r, 'brown'), 160, 0.7, SR), D.envExp(m, 0.04, jit(r, 0.9, 0.3), SR)), 2);
    D.mix(x, k, 0.15 + r() * 0.3, t, SR);
  }
  return D.normalize(D.lowpass(x, 220, 0.7, SR), 0.5);
}
/** Ash and embers: a faint hiss with ticks of things burning. */
function ash(r, n) {
  const len = n / SR, x = D.highpass(D.noise(n, r, 'pink'), 3500, 0.7, SR);
  const f = drift(r, len, 4, 0.4, 1);
  for (let i = 0; i < n; i++) x[i] *= 0.12 * f(i / SR);
  D.mix(x, D.bandpass(D.crackle(n, r, 9, (t) => 0.3 + 0.7 * f(t), SR), 2200, 0.7, SR), 0.5);
  return D.normalize(x, 0.4);
}
/** A city's hum: mains and transformers drifting, a far roar of a megacity (traffic, vents, machines). */
function cityHum(r, n, { base = 50, roar = 320, tone = 0.12 } = {}) {
  const len = n / SR, x = new Float32Array(n), d1 = drift(r, len, 9, -1, 1), d2 = drift(r, len, 13, 0.6, 1);
  for (const [k, a] of [[1, 1], [2, 0.6], [3, 0.3], [4, 0.15]]) D.mix(x, D.osc(n, (t) => base * k * (1 + 0.002 * d1(t)), 'sine', SR, r()), a * tone);
  const ro = D.lowpass(D.bandpass(D.noise(n, r, 'pink'), roar, 0.5, SR), roar * 2, 0.7, SR);
  for (let i = 0; i < n; i++) ro[i] *= d2(i / SR);
  D.mix(x, D.normalize(ro, 1), 0.8);
  return D.normalize(x, 0.5);
}
/** Snow falling: the faintest hiss, its texture shifting. */
function snowHiss(r, n) {
  const len = n / SR, x = D.bandpass(D.noise(n, r), 6500, 0.4, SR), f = drift(r, len, 3, 0.5, 1);
  for (let i = 0; i < n; i++) x[i] *= f(i / SR);
  return D.normalize(x, 0.3);
}
/** Wind singing through the towers: narrow bands of noise gliding slowly, coming and going. */
function singing(r, n) {
  const len = n / SR, x = new Float32Array(n);
  for (let k = 0; k < 4; k++) {
    const f0 = jit(r, [520, 760, 1080, 1460][k], 0.1), gl = drift(r, len, jit(r, 9, 0.3), 0.92, 1.08), a = drift(r, len, jit(r, 11, 0.3), 0, 1);
    const s = D.bandpass(D.noise(n, r), (t) => f0 * gl(t), 28, SR);
    for (let i = 0; i < n; i++) s[i] *= a(i / SR) ** 3;
    D.mix(x, D.normalize(s, 1), 0.5);
  }
  return D.normalize(D.lowpass(x, 2500, 0.7, SR), 0.4);
}

// ---------------------------------------------------------------- spots
function gust(r) {
  const len = jit(r, 3.2, 0.25), n = D.samples(len, SR), x = D.noise(n, r, 'pink'), peak = jit(r, 0.45, 0.3);
  D.lowpass(x, (t) => 250 + 1100 * Math.sin(Math.PI * Math.min(1, t / len)) ** 2, 0.6, SR);
  for (let i = 0; i < n; i++) { const u = i / n; x[i] *= u < peak ? (u / peak) ** 2 : ((1 - u) / (1 - peak)) ** 1.5; }
  return B.st(D.normalize(x, 0.8));
}
/** Steel groaning, or wire and its posts creaking: stick-slip pulses through the metal's resonances. */
function creak(r, metal = 1) {
  const len = jit(r, 1.6, 0.3), n = D.samples(len, SR), x = new Float32Array(n), rate = drift(r, len, 0.25, 18, 70);
  for (let t = 0.05; t < len - 0.1;) {
    const u = t / len, a = Math.sin(Math.PI * u) ** 0.7 * (0.5 + r() * 0.5);
    x[Math.floor(t * SR)] += a;
    t += 1 / rate(t) * (0.7 + r() * 0.6);
  }
  const out = new Float32Array(n);
  // (Resonances wide enough to groan, not squeal: a creak that sings on a pitch every half minute grates.)
  for (const [f, q, g] of [[jit(r, 300, 0.25) * metal, 7, 1], [jit(r, 820, 0.25) * metal, 9, 0.55], [jit(r, 1900, 0.25) * metal, 10, 0.25]]) D.mix(out, D.bandpass(Float32Array.from(x), f, q, SR), g);
  D.mix(out, D.lowpass(Float32Array.from(x), 900, 0.7, SR), 0.4);
  return B.st(D.normalize(D.lowpass(out, 2500, 0.7, SR), 0.7));
}
function fireFlare(r) {
  const len = jit(r, 2.6, 0.2), n = D.samples(len, SR), x = new Float32Array(n), env = (t) => Math.sin(Math.PI * Math.min(1, t / len)) ** 0.8;
  D.mix(x, D.mul(D.lowpass(D.noise(n, r, 'brown'), 500, 0.7, SR), Float32Array.from({ length: n }, (_, i) => env(i / SR))), 2);
  D.mix(x, D.bandpass(D.crackle(n, r, 60, env, SR), 2000, 0.6, SR), 0.8);
  return B.st(D.normalize(x, 0.7));
}
/** A siren far off: a slow wail up and down (the Directorate's air-raid siren), its two horns beating. */
function siren(r, kind = 'wail') {
  const len = kind === 'raid' ? jit(r, 9, 0.15) : jit(r, 7, 0.15), n = D.samples(len, SR), x = new Float32Array(n);
  const lo = jit(r, 420, 0.1), hi = lo * jit(r, 1.75, 0.08), per = kind === 'raid' ? len : jit(r, 2.6, 0.2);
  const f = kind === 'raid' ? (t) => lo + (hi - lo) * Math.sin(Math.PI * Math.min(1, t / len)) ** 0.6 : (t) => lo + (hi - lo) * (0.5 - 0.5 * Math.cos((2 * Math.PI * t) / per));
  for (const det of [1, 1.006]) D.mix(x, D.osc(n, (t) => f(t) * det, 'saw', SR, r()), 0.5);
  D.lowpass(x, 1800, 0.7, SR); D.highpass(x, 200, 0.7, SR);
  for (let i = 0; i < n; i++) { const t = i / SR; x[i] *= Math.min(1, t / 0.8, (len - t) / 1.2); }
  return B.st(D.normalize(x, 0.7));
}
/** A PA klaxon somewhere in the towers: two tones, three times. */
function klaxon(r) {
  const n = D.samples(3.2, SR), x = new Float32Array(n), a = jit(r, 392, 0.06), b = a * 1.26;
  for (let k = 0; k < 3; k++) for (const [f, t0] of [[a, k * 1.0], [b, k * 1.0 + 0.45]]) {
    const m = D.samples(0.42, SR), s = D.osc(m, f, 'tri', SR);
    D.mul(s, D.envSwell(m, 0.02, 0.42, 0.05, SR, 1));
    D.mix(x, s, 0.5, t0, SR);
  }
  return B.st(D.normalize(D.lowpass(D.lowpass(D.highpass(x, 250, 0.7, SR), 1600, 0.7, SR), 1600, 0.7, SR), 0.6));
}
/** A patrol drone going over: rotor thrum and a motor whine dropping as it passes. */
function drone(r) {
  const len = jit(r, 5, 0.2), n = D.samples(len, SR), tp = len * jit(r, 0.5, 0.15);
  const thrum = D.lowpass(D.noise(n, r, 'pink'), 900, 0.7, SR);
  D.tremolo(thrum, jit(r, 95, 0.15), 0.7, SR);
  const whine = D.osc(n, (t) => jit(r, 1350, 0.15) * (1 + 0.06 * Math.tanh((tp - t) / 0.5)), 'tri', SR);
  const x = new Float32Array(n);
  D.mix(x, D.normalize(thrum, 1), 1); D.mix(x, whine, 0.05);
  for (let i = 0; i < n; i++) { const t = i / SR; x[i] *= Math.exp(-(((t - tp) / (len * 0.3)) ** 2)); }
  return B.st(D.normalize(x, 0.7));
}
/** Something big flying over far up: the roar swelling and fading, a turbine's whine dropping. */
function flyover(r, big = 1) {
  const len = jit(r, 8, 0.2), n = D.samples(len, SR), tp = len * jit(r, 0.5, 0.1);
  const roar = D.lowpass(D.noise(n, r, 'pink'), (t) => 500 + 900 * Math.exp(-(((t - tp) / 1.5) ** 2)), 0.6, SR);
  D.mix(roar, D.lowpass(D.noise(n, r, 'brown'), 140, 0.7, SR), 2 * big);
  const whine = D.lowpass(D.osc(n, (t) => jit(r, 760, 0.15) * (1 + 0.12 * Math.tanh((tp - t) / 1.2)), 'saw', SR), 1600, 0.7, SR);
  const x = new Float32Array(n);
  D.mix(x, D.normalize(roar, 1), 1); D.mix(x, D.normalize(whine, 1), 0.06);
  for (let i = 0; i < n; i++) { const t = i / SR; x[i] *= Math.exp(-(((t - tp) / (len * 0.28)) ** 2)); }
  return B.st(D.normalize(x, 0.7));
}
/** A searchlight turning on its mount: the servo's whine, a clunk where it stops. */
function searchlight(r) {
  const len = jit(r, 2.2, 0.2), n = D.samples(len, SR), run = len * jit(r, 0.7, 0.1);
  const f = (t) => jit(r, 520, 0.1) * (1 + 0.25 * Math.sin(Math.PI * Math.min(1, t / run)));
  const x = D.mul(D.osc(n, f, 'saw', SR), D.envSwell(n, 0.15, run, 0.25, SR, 1));
  D.lowpass(x, 1800, 0.7, SR);
  D.mix(x, D.mul(D.bandpass(D.noise(n, r), 900, 2, SR), D.envExp(n, 0.001, 0.03, SR, run)), 3);
  return B.st(D.normalize(x, 0.6));
}
/** A transformer arcing: a buzz and a burst of crackle. */
function arc(r) {
  const len = jit(r, 1.4, 0.3), n = D.samples(len, SR), on = (t) => (Math.sin(t * jit(r, 9, 0.4)) > -0.2 ? 1 : 0) * Math.min(1, (len - t) / 0.2);
  const buzz = D.osc(n, 100, 'saw', SR);
  D.lowpass(buzz, 900, 0.7, SR);
  for (let i = 0; i < n; i++) buzz[i] *= on(i / SR);
  const x = new Float32Array(n);
  D.mix(x, buzz, 0.25); D.mix(x, D.highpass(D.crackle(n, r, 300, on, SR), 1200, 0.7, SR), 1);
  return B.st(D.normalize(x, 0.6));
}
function snowSlide(r) {
  const len = jit(r, 1.6, 0.2), n = D.samples(len, SR), x = D.mul(D.lowpass(D.noise(n, r, 'pink'), 1200, 0.7, SR), D.envSwell(n, len * 0.6, len - 0.1, 0.1, SR, 1.5));
  const m = D.samples(0.5, SR);
  D.mix(x, D.mul(D.lowpass(D.noise(m, r, 'brown'), 300, 0.7, SR), D.envExp(m, 0.004, 0.08, SR)), 3, len - 0.35, SR);
  return B.st(D.normalize(x, 0.6));
}
function neon(r) {
  const len = jit(r, 1.5, 0.3), n = D.samples(len, SR), x = D.osc(n, 120, 'saw', SR);
  D.bandpass(x, 1100, 0.8, SR);
  for (let i = 0; i < n; i++) { const t = i / SR; x[i] *= (Math.sin(t * 37) + Math.sin(t * 11.3) > -0.6 ? 1 : 0.1) * Math.min(1, t / 0.05, (len - t) / 0.1); }
  return B.st(D.normalize(x, 0.4));
}

// ---------------------------------------------------------------- the maps
/**
 * id -> { kind: 'amb' (a bed: Ambience loops it) | 'spot' (Ambience places it round you), takes,
 * level (the takes' punch, dBFS over 0.4 s), enc, spot: { every: [s, s], dist: [m, m], gain } }.
 */
export function atmos() {
  const R = {};
  const bedOf = (id, len, fn, level) => { R[id] = { kind: 'amb', takes: [bed(id, len, fn)], level, enc: 'bed' }; };
  const spotOf = (id, fn, k, spot, level = -18) => { R[id] = { kind: 'spot', takes: Array.from({ length: k }, (_, i) => fn(seeded(id, i))), level, enc: 'spot', spot }; };
  // The Trenches
  bedOf('amb:trench:wind', 37, (r, n) => wind(r, n, { lo: 160, hi: 1100, gust: 5, floor: 0.2 }), -24);
  bedOf('amb:trench:front', 31, frontRumble, -26);
  bedOf('amb:trench:ash', 23, ash, -36);
  spotOf('spot:trench:gust', gust, 4, { maps: ['trench'], every: [9, 22], dist: [15, 40], gain: 0.5 });
  spotOf('spot:trench:wire', (r) => creak(r, 1.3), 4, { maps: ['trench'], every: [14, 35], dist: [12, 35], gain: 0.35 });
  spotOf('spot:trench:fire', fireFlare, 3, { maps: ['trench'], every: [12, 30], dist: [20, 60], gain: 0.4 });
  spotOf('spot:trench:aircraft', (r) => flyover(r, 1.2), 3, { maps: ['trench'], every: [45, 110], dist: [500, 900], gain: 0.8 });
  // Dusk City
  bedOf('amb:city:wind', 33, (r, n) => wind(r, n, { lo: 140, hi: 650, gust: 7, floor: 0.35, color: 'brown' }), -27);
  bedOf('amb:city:hum', 41, (r, n) => cityHum(r, n, { base: 50, roar: 300, tone: 0.1 }), -28);
  bedOf('amb:city:snow', 19, snowHiss, -40);
  spotOf('spot:city:siren', (r) => siren(r, 'wail'), 3, { maps: ['city'], every: [30, 70], dist: [400, 900], gain: 0.6 });
  spotOf('spot:city:klaxon', klaxon, 3, { maps: ['city', 'night'], every: [60, 130], dist: [300, 700], gain: 0.4 });
  spotOf('spot:city:drone', drone, 3, { maps: ['city', 'night'], every: [25, 60], dist: [40, 120], gain: 0.45 });
  spotOf('spot:city:neon', neon, 3, { maps: ['city', 'night'], every: [18, 45], dist: [8, 20], gain: 0.25 });
  spotOf('spot:city:steel', (r) => creak(r, 0.8), 4, { maps: ['city', 'night'], every: [20, 50], dist: [20, 80], gain: 0.4 });
  spotOf('spot:city:snowslide', snowSlide, 3, { maps: ['city'], every: [20, 50], dist: [10, 35], gain: 0.4 });
  // Night City
  bedOf('amb:night:air', 43, (r, n) => wind(r, n, { lo: 110, hi: 480, gust: 9, floor: 0.4, color: 'brown' }), -29);
  bedOf('amb:night:hum', 29, (r, n) => cityHum(r, n, { base: 60, roar: 240, tone: 0.16 }), -28);
  bedOf('amb:night:sing', 37, singing, -40);
  spotOf('spot:night:searchlight', searchlight, 4, { maps: ['night'], every: [14, 35], dist: [60, 180], gain: 0.4 });
  spotOf('spot:night:raid', (r) => siren(r, 'raid'), 3, { maps: ['night'], every: [60, 140], dist: [600, 1200], gain: 0.7 });
  spotOf('spot:night:dropship', (r) => flyover(r, 1.6), 3, { maps: ['night', 'city'], every: [50, 120], dist: [250, 600], gain: 0.8 });
  spotOf('spot:night:arc', arc, 3, { maps: ['night'], every: [25, 60], dist: [20, 60], gain: 0.35 });
  return R;
}
