// Procedural sound engine (v2). Every sound is synthesised at startup into AudioBuffers with
// hand-written DSP: noise, biquads, pitch sweeps, N-wave cracks, inharmonic partials, a formant
// voice for effort grunts, and saturation. No asset files are needed.
//
// Gunshots are built per weapon from the `sound` profile in shared/weapons.js. Each one has:
//   transient crack → mechanical snap → body → sub punch, kept short so auto-fire stays tight,
//   plus a separate tail buffer played at the end of a burst, and a distant version.
// Playback chain: source → (lowpass for distance/occlusion) → gain → HRTF panner → sfx bus →
// master low-pass (low HP / knocked) → master gain → glue compressor → limiter → output.
// A convolution reverb send sits alongside.

import { WEAPONS } from '../shared/weapons.js';
import { FEEL } from './tuning.js';

let SR = 44100;

// ------------------------------------------------------------------ DSP helpers
const buf = (sec) => new Float32Array(Math.max(1, Math.floor(sec * SR)));
let seed = 1234567;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2147483648 - 1; };

function biquad(type, freq, q = 0.707, gainDb = 0) {
  const w0 = (2 * Math.PI * Math.min(Math.max(freq, 10), SR * 0.45)) / SR;
  const cos = Math.cos(w0), sin = Math.sin(w0), alpha = sin / (2 * q);
  const A = Math.pow(10, gainDb / 40);
  let b0, b1, b2, a0, a1, a2;
  switch (type) {
    case 'lp': b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha; break;
    case 'hp': b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha; break;
    case 'bp': b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha; break;
    default: b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cos; a2 = 1 - alpha / A; break;
  }
  const f = { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0, x1: 0, x2: 0, y1: 0, y2: 0 };
  f.run = (x) => {
    const y = f.b0 * x + f.b1 * f.x1 + f.b2 * f.x2 - f.a1 * f.y1 - f.a2 * f.y2;
    f.x2 = f.x1; f.x1 = x; f.y2 = f.y1; f.y1 = y;
    return y;
  };
  return f;
}
function filt(d, type, freq, q, g) { const f = biquad(type, freq, q, g); for (let i = 0; i < d.length; i++) d[i] = f.run(d[i]); return d; }
const expEnv = (tau, attack = 0.0004) => (t) => (t < attack ? t / attack : Math.exp(-(t - attack) / tau));

// filtered noise burst with exponential decay
function noise(len, type, freq, q, tau, amp, start = 0, attack = 0.0004) {
  const n = buf(len);
  for (let i = 0; i < n.length; i++) n[i] = rnd();
  if (type) filt(n, type, freq, q);
  if (type === 'bp') filt(n, type, freq, q); // second pass: steeper band
  // normalise the filtered noise so `amp` means peak level regardless of filter bandwidth
  let pk = 0;
  for (let i = 0; i < n.length; i++) pk = Math.max(pk, Math.abs(n[i]));
  if (pk > 0) for (let i = 0; i < n.length; i++) n[i] /= pk;
  const out = buf(len + start), env = expEnv(tau, attack), s0 = Math.floor(start * SR);
  for (let i = 0; i < n.length; i++) out[s0 + i] = n[i] * env(i / SR) * amp;
  return out;
}
function mix(...ls) {
  let len = 0;
  for (const l of ls) len = Math.max(len, l.length);
  const o = new Float32Array(len);
  for (const l of ls) for (let i = 0; i < l.length; i++) o[i] += l[i];
  return o;
}
// tone with exponential pitch glide f0→f1 (curve = glide time constant)
function tone(len, f0, f1, tau, amp, shape = 'sine', curve = 0.05, start = 0, attack = 0.0008) {
  const o = buf(len + start), s0 = Math.floor(start * SR);
  let ph = 0;
  for (let i = 0; i < len * SR; i++) {
    const t = i / SR, f = f1 + (f0 - f1) * Math.exp(-t / curve);
    ph += (2 * Math.PI * f) / SR;
    let v = Math.sin(ph);
    if (shape === 'saw') v = ((ph / Math.PI) % 2) - 1;
    else if (shape === 'square') v = Math.tanh(Math.sin(ph) * 4);
    else if (shape === 'tri') v = Math.asin(Math.sin(ph)) * 0.637;
    o[s0 + i] = v * amp * Math.exp(-t / tau) * Math.min(1, t / attack);
  }
  return o;
}
function partials(len, freqs, tau, amp, start = 0, decayTilt = 0.15) {
  const o = buf(len + start), s0 = Math.floor(start * SR);
  for (let i = 0; i < len * SR; i++) {
    const t = i / SR;
    let v = 0;
    for (let k = 0; k < freqs.length; k++) v += Math.sin(2 * Math.PI * freqs[k] * t + k) * Math.exp(-t / (tau * Math.max(0.1, 1 - k * decayTilt)));
    o[s0 + i] = (v / Math.sqrt(freqs.length)) * amp * Math.min(1, t / 0.0006);
  }
  return o;
}
// supersonic N-wave crack (sniper / DMR at range)
function nwave(ms, amp, start = 0) {
  const n = Math.floor((ms / 1000) * SR), o = buf(ms / 1000 + start + 0.01), s0 = Math.floor(start * SR);
  for (let i = 0; i < n; i++) o[s0 + i] = amp * (1 - (2 * i) / n);
  return filt(o, 'hp', 1200, 0.7);
}
// glottal formant voice — effort grunts ("uh", "hnn")
function grunt(len, f0, f1, formants, amp, breath = 0.25) {
  const src = buf(len);
  let ph = 0;
  for (let i = 0; i < src.length; i++) {
    const t = i / SR, f = f0 + (f1 - f0) * (t / len) + Math.sin(t * 31) * 3;
    ph += f / SR;
    const p = ph % 1;
    src[i] = (p < 0.4 ? Math.sin((p / 0.4) * Math.PI) : 0) * 0.9 + rnd() * breath; // glottal pulse + breath
  }
  const o = buf(len);
  for (const [fq, bw, g] of formants) {
    const f = biquad('bp', fq, fq / bw);
    for (let i = 0; i < src.length; i++) o[i] += f.run(src[i]) * g;
  }
  for (let i = 0; i < o.length; i++) { const t = i / SR; o[i] *= amp * Math.min(1, t / 0.02) * Math.min(1, (len - t) / 0.06); }
  return o;
}
function sat(d, drive = 1.4) { const k = Math.tanh(drive); for (let i = 0; i < d.length; i++) d[i] = Math.tanh(d[i] * drive) / k; return d; }
function norm(d, peak = 0.9) { let m = 0; for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i])); if (m > 0) for (let i = 0; i < d.length; i++) d[i] *= peak / m; return d; }
function fadeOut(d, sec = 0.01) { const n = Math.min(d.length, Math.floor(sec * SR)); for (let i = 0; i < n; i++) d[d.length - 1 - i] *= i / n; return d; }
function echo(d, delay, fb, extra = 1) {
  const dl = Math.floor(delay * SR), o = new Float32Array(d.length + Math.floor(extra * SR));
  o.set(d);
  for (let i = dl; i < o.length; i++) o[i] += o[i - dl] * fb;
  return o;
}
function multiTap(d, taps, extra = 1.5) {
  const o = new Float32Array(d.length + Math.floor(extra * SR));
  o.set(d);
  for (const [t, g, lp] of taps) {
    const off = Math.floor(t * SR), c = Float32Array.from(d);
    if (lp) filt(c, 'lp', lp, 0.7);
    for (let i = 0; i < c.length && off + i < o.length; i++) o[off + i] += c[i] * g;
  }
  return o;
}
function loopify(d, xf = 0.15) {
  const x = Math.floor(xf * SR);
  for (let i = 0; i < x; i++) { const k = i / x; d[i] = d[i] * k + d[d.length - x + i] * (1 - k); }
  return d.subarray(0, d.length - x);
}
function noiseLoop(len, shaper) {
  const n = buf(len);
  for (let i = 0; i < n.length; i++) n[i] = rnd();
  shaper(n);
  return loopify(n);
}

// ------------------------------------------------------------------ gunshots
function gunNear(s) {
  const L = [];
  // 1. transient: a one-sample click + 2 ms bright burst. This is what makes it "crack".
  const click = buf(0.005);
  click[0] = 1; click[1] = -0.6;
  L.push(click.map((v) => v * s.crack));
  L.push(noise(0.02, 'hp', 4200, 0.7, 0.0018, 0.9 * s.crack));
  if (s.nwave) L.push(nwave(1.6, 1.3 * s.crack));
  // 2. mechanical snap / action
  L.push(noise(0.05, 'bp', s.snapHz, 1.6, 0.007, 0.75));
  if (s.mech) L.push(noise(0.04, 'bp', 3800, 3, 0.0025, 0.5 * s.mech, 0.018));
  // 3. body
  L.push(noise(0.2, 'bp', s.bodyHz, s.bodyQ, s.bodyDecay, 1.0));
  L.push(noise(0.15, 'bp', s.bodyHz * 2.1, 1.4, s.bodyDecay * 0.6, 0.45));
  // 4. sub punch: fast glide from 2.6x down to the fundamental
  L.push(tone(0.3, s.subHz * 2.6, s.subHz, s.subDecay, 0.62 * s.sub, 'sine', 0.012, 0.0015, 0.0015));
  // class character
  if (s.zap) {
    L.push(tone(0.12, 3200, 520, 0.035, 0.6, 'square', 0.018));
    L.push(tone(0.15, 1100, 1650, 0.05, 0.25, 'tri', 0.04));
    L.push(noise(0.1, 'bp', 6000, 2, 0.02, 0.35));
  }
  if (s.scatter) for (let i = 0; i < 7; i++) L.push(noise(0.02, 'bp', 1200 + rnd() * 2000, 2, 0.002, 0.35, 0.002 + Math.abs(rnd()) * 0.012));
  if (s.rattle) L.push(noise(0.05, 'bp', 2600, 4, 0.004, 0.45, 0.032));
  if (s.ring) L.push(partials(0.4, [2250, 3410, 5120], 0.06, 0.12, 0.004));
  // short early reflection so the near shot isn't bone-dry
  L.push(noise(0.12, 'lp', s.tailHz * 1.3, 0.7, 0.03, 0.22, 0.008, 0.004));
  let d = mix(...L);
  // transient shaper: keep the first ~5 ms at full level, pull the sustain down so the crack
  // leads and back-to-back auto-fire shots stay separated
  const keep = s.sustain ?? (s.cls === 'smg' || s.cls === 'pistol' || s.cls === 'energy' ? 0.45 : s.cls === 'ar' ? 0.55 : 0.7);
  for (let i = 0; i < d.length; i++) {
    const t = i / SR;
    d[i] *= t < 0.005 ? 1.25 : keep + (1.25 - keep) * Math.exp(-(t - 0.005) / 0.012);
  }
  d = sat(d, 1.25);
  d = norm(d, 0.92 * s.gain);
  return fadeOut(d, 0.03);
}

function gunTail(s) {
  const len = 0.4 + s.tail * 1.1;
  let d = noise(len, 'lp', s.tailHz, 0.6, 0.12 + s.tail * 0.28, 0.6, 0, 0.02);
  d = mix(d, noise(len * 0.6, 'bp', s.tailHz * 0.45, 0.7, 0.08 + s.tail * 0.15, 0.4, 0.01, 0.015));
  if (s.slap) d = multiTap(d, [[0.18, 0.35, 900], [0.42, 0.2, 700], [0.8, 0.1, 500]], 1);
  return fadeOut(norm(d, 0.55 * s.gain), 0.2);
}

function gunFar(s) {
  // what a fight 150-500 m away sounds like: a dull thump, a delayed crack, rolling echoes
  const L = [noise(0.3, 'lp', 520, 0.7, 0.05 + s.sub * 0.03, 1.0), tone(0.3, s.subHz * 1.5, s.subHz * 0.8, 0.07, 0.7, 'sine', 0.03)];
  if (s.crack > 0.95) L.push(noise(0.02, 'hp', 2500, 0.7, 0.002, 0.45 * s.crack));
  let d = mix(...L);
  d = multiTap(d, [[0.21, 0.45, 600], [0.55, 0.28, 450], [1.0, 0.15, 350]], 1.4);
  return fadeOut(norm(d, 0.75 * s.gain), 0.25);
}

// ------------------------------------------------------------------ recipes
const VOWEL_UH = [[640, 80, 1], [1190, 90, 0.5], [2390, 120, 0.25]];
const VOWEL_HN = [[300, 60, 1], [2200, 150, 0.2], [2900, 200, 0.12]];

function stepSurface(kind, v) {
  const r = 0.9 + v * 0.1;
  if (kind === 'water') return norm(mix(noise(0.25, 'bp', 900 * r, 0.7, 0.06, 1, 0, 0.01), noise(0.2, 'hp', 3500, 0.7, 0.05, 0.5, 0.02, 0.01), tone(0.12, 300 * r, 120, 0.03, 0.4)), 0.65);
  if (kind === 'metal') return norm(mix(partials(0.25, [380 * r, 1090 * r, 2310 * r, 3900 * r], 0.05, 0.6), noise(0.06, 'bp', 2400, 1.5, 0.006, 0.8), noise(0.1, 'lp', 400, 0.8, 0.02, 0.6)), 0.7);
  if (kind === 'concrete') return norm(mix(noise(0.06, 'bp', 2800 * r, 1.4, 0.004, 1), noise(0.12, 'lp', 520 * r, 0.9, 0.018, 0.9), tone(0.08, 160, 90, 0.015, 0.4)), 0.65);
  // dirt / grass: soft thud + gritty crunch
  return norm(mix(noise(0.14, 'lp', 380 * r, 0.9, 0.025, 1), noise(0.12, 'bp', 3200 * r, 0.9, 0.018, 0.35, 0.005, 0.004), noise(0.05, 'hp', 6000, 0.7, 0.01, 0.12, 0.01)), 0.6);
}

function slideLoop(kind) {
  return noiseLoop(1.4, (n) => {
    if (kind === 'metal') { filt(n, 'bp', 1800, 2); filt(n, 'peak', 3400, 4, 10); }
    else if (kind === 'concrete') { filt(n, 'bp', 2200, 0.8); filt(n, 'lp', 5000, 0.7); }
    else if (kind === 'water') { filt(n, 'bp', 1100, 0.6); for (let i = 0; i < n.length; i++) n[i] *= 0.6 + 0.4 * Math.abs(Math.sin(i / SR * 17)); }
    else { filt(n, 'bp', 900, 0.7); filt(n, 'lp', 2600, 0.7); }
    for (let i = 0; i < n.length; i++) n[i] *= 0.75 + 0.25 * Math.sin((i / SR) * 47) * Math.sin((i / SR) * 13);
  });
}

const RECIPES = {
  // --- hit feedback ---------------------------------------------------------
  hit_flesh: () => norm(mix(noise(0.03, 'bp', 2300, 1.2, 0.004, 1.0), tone(0.09, 420, 170, 0.022, 0.8, 'sine', 0.012), noise(0.06, 'lp', 1100, 0.7, 0.012, 0.4)), 0.9),
  hit_shield: () => norm(mix(partials(0.2, [1980, 2960, 4420, 5900], 0.045, 1.0), noise(0.02, 'hp', 5000, 0.7, 0.002, 0.7), tone(0.06, 900, 520, 0.012, 0.4)), 0.85),
  hit_head: () => norm(mix(partials(0.42, [3300, 4950, 6600, 2470], 0.11, 1.0, 0, 0.1), noise(0.02, 'hp', 6000, 0.7, 0.002, 0.8), tone(0.1, 640, 260, 0.025, 0.6)), 0.95),
  shield_crack: () => {
    const L = [noise(0.08, 'hp', 3000, 0.7, 0.012, 0.8)];
    for (let i = 0; i < 9; i++) L.push(partials(0.08, [2500 + Math.abs(rnd()) * 5000], 0.012, 0.35, Math.abs(rnd()) * 0.04));
    L.push(tone(0.08, 300, 140, 0.02, 0.5));
    return norm(mix(...L), 0.8);
  },
  shield_break: () => {
    const L = [tone(0.7, 300, 60, 0.16, 1.1, 'sine', 0.06), noise(0.08, 'hp', 2000, 0.7, 0.01, 0.9)];
    for (let i = 0; i < 40; i++) L.push(partials(0.3, [2200 + Math.abs(rnd()) * 7000], 0.025 + Math.abs(rnd()) * 0.05, 0.4, Math.abs(rnd()) * 0.28));
    L.push(noise(0.6, 'hp', 3500, 0.7, 0.12, 0.5, 0.01, 0.01));
    L.push(partials(0.8, [1046, 1568, 2093], 0.22, 0.55, 0.04)); // the "pop" chime
    return norm(sat(mix(...L), 1.3), 0.95);
  },
  knock: () => norm(sat(mix(
    noise(0.04, 'hp', 3000, 0.7, 0.005, 0.8),
    tone(0.7, 220, 42, 0.2, 1.3, 'sine', 0.07),
    noise(0.25, 'lp', 600, 0.8, 0.05, 0.7),
    partials(0.9, [392, 311, 233], 0.3, 0.5, 0.06),
  ), 1.5), 0.95),
  kill: () => norm(sat(mix(
    noise(0.04, 'hp', 3500, 0.7, 0.004, 0.9),
    tone(0.6, 160, 38, 0.17, 1.3, 'sine', 0.05),
    noise(0.15, 'bp', 1600, 1, 0.025, 0.6),
    partials(0.9, [880, 1320, 1760], 0.22, 0.75, 0.05),
    partials(1.0, [1320, 1980, 2640], 0.3, 0.6, 0.15),
    partials(1.1, [1760, 2640, 3520], 0.35, 0.45, 0.25),
  ), 1.25), 0.95),
  evo: () => norm(mix(partials(0.5, [660, 990], 0.15, 0.6), partials(0.5, [880, 1320], 0.15, 0.6, 0.08), partials(0.6, [1100, 1650], 0.2, 0.6, 0.16), partials(0.9, [1320, 1980, 2640], 0.35, 0.8, 0.24), tone(0.6, 80, 160, 0.3, 0.5, 'sine', 0.2)), 0.8),
  tinnitus: () => { const d = partials(3, [3600, 3640], 0.9, 0.5); for (let i = 0; i < d.length; i++) d[i] *= Math.min(1, i / SR / 0.15); return norm(d, 0.35); },

  // --- movement ----------------------------------------------------------------
  jump: () => norm(mix(noise(0.2, 'bp', 1000, 0.7, 0.05, 0.6, 0, 0.02), noise(0.08, 'lp', 450, 0.8, 0.015, 0.7), grunt(0.12, 150, 130, VOWEL_HN, 0.15, 0.4)), 0.5),
  land: () => norm(mix(noise(0.2, 'lp', 380, 0.9, 0.035, 1), tone(0.2, 130, 60, 0.04, 0.7), noise(0.06, 'bp', 2500, 1, 0.008, 0.3)), 0.7),
  hardland: () => norm(sat(mix(noise(0.35, 'lp', 300, 0.9, 0.07, 1), tone(0.3, 120, 38, 0.09, 1.1), noise(0.1, 'bp', 1800, 1, 0.02, 0.5), grunt(0.22, 135, 105, VOWEL_UH, 0.5, 0.35)), 1.4), 0.9),
  slidestart: () => norm(mix(noise(0.45, 'bp', 1400, 0.8, 0.13, 1, 0, 0.015), tone(0.2, 200, 80, 0.05, 0.6), noise(0.3, 'hp', 4000, 0.7, 0.06, 0.3, 0, 0.01)), 0.75),
  mantle: () => norm(mix(noise(0.3, 'bp', 800, 0.8, 0.06, 0.8, 0, 0.015), noise(0.15, 'bp', 2600, 1.2, 0.03, 0.45, 0.07), grunt(0.24, 165, 120, VOWEL_UH, 0.7, 0.3)), 0.65),
  wallkick: () => norm(sat(mix(noise(0.03, 'bp', 2400, 1, 0.004, 0.8), tone(0.25, 190, 55, 0.06, 1.1), noise(0.3, 'bp', 1100, 0.7, 0.07, 0.6, 0.02, 0.02), grunt(0.14, 160, 140, VOWEL_HN, 0.35, 0.4)), 1.3), 0.8),
  superglide: () => norm(mix(noise(0.8, 'bp', 1500, 0.6, 0.28, 0.8, 0, 0.04), tone(0.6, 300, 1100, 0.35, 0.3, 'sine', 0.25), noise(0.4, 'hp', 5000, 0.7, 0.12, 0.25)), 0.75),
  pad: () => norm(mix(tone(0.8, 85, 560, 0.32, 1, 'sine', 0.13), tone(0.8, 170, 1120, 0.22, 0.35, 'tri', 0.13), noise(0.6, 'bp', 1500, 0.7, 0.16, 0.45, 0, 0.03), noise(0.05, 'hp', 3000, 0.7, 0.006, 0.6)), 0.9),
  jet: () => noiseLoop(1.2, (n) => { filt(n, 'lp', 1300, 0.9); filt(n, 'peak', 320, 1, 9); for (let i = 0; i < n.length; i++) n[i] *= 0.85 + 0.15 * Math.sin(i / SR * 60); }),
  zipline: () => noiseLoop(1.2, (n) => { filt(n, 'bp', 2600, 3); filt(n, 'peak', 5200, 6, 8); for (let i = 0; i < n.length; i++) n[i] *= 0.7 + 0.3 * Math.sin(i / SR * 90); }),
  zip_attach: () => norm(mix(noise(0.05, 'bp', 3000, 3, 0.006, 1), partials(0.3, [1800, 2700, 4100], 0.07, 0.5, 0.01)), 0.7),

  // --- weapon handling --------------------------------------------------------
  mag_out: () => norm(mix(noise(0.08, 'bp', 2900, 2.5, 0.009, 1), noise(0.1, 'bp', 950, 2, 0.02, 0.6), partials(0.1, [1900, 3100], 0.02, 0.3)), 0.6),
  mag_in: () => norm(sat(mix(noise(0.1, 'bp', 1700, 2, 0.014, 1), tone(0.1, 280, 120, 0.02, 0.8), noise(0.06, 'bp', 4400, 3, 0.004, 0.6, 0.022), partials(0.12, [2400, 3600], 0.025, 0.3, 0.02)), 1.5), 0.75),
  charge: () => norm(mix(noise(0.08, 'bp', 3300, 3, 0.006, 1), noise(0.1, 'bp', 2100, 3, 0.01, 0.9, 0.07), tone(0.1, 320, 150, 0.02, 0.5, 'sine', 0.02, 0.07), partials(0.15, [2800, 4300], 0.03, 0.3, 0.08)), 0.7),
  pump: () => norm(mix(noise(0.12, 'bp', 1500, 2, 0.02, 1), noise(0.15, 'bp', 1100, 2, 0.025, 1, 0.13), tone(0.1, 200, 90, 0.02, 0.6, 'sine', 0.02, 0.13), partials(0.1, [2300, 3500], 0.02, 0.3, 0.14)), 0.75),
  bolt: () => norm(mix(noise(0.1, 'bp', 2600, 2, 0.015, 1), noise(0.12, 'bp', 1800, 2, 0.02, 0.9, 0.18), noise(0.1, 'bp', 3000, 3, 0.01, 0.8, 0.32), partials(0.15, [2100, 3300], 0.03, 0.3, 0.33)), 0.75),
  dry: () => norm(mix(noise(0.05, 'bp', 3500, 4, 0.004, 1), partials(0.05, [2800], 0.01, 0.3)), 0.4),
  draw: () => norm(mix(noise(0.15, 'bp', 2200, 2, 0.02, 0.7), noise(0.1, 'bp', 3400, 3, 0.008, 0.6, 0.1), partials(0.12, [1700, 2600], 0.03, 0.3, 0.1)), 0.5),
  low_ammo: () => norm(partials(0.06, [3800, 5100], 0.012, 1), 0.3),
  whiz: () => {
    const len = 0.24, o = buf(len), n = buf(len);
    for (let i = 0; i < n.length; i++) n[i] = rnd();
    let f = biquad('bp', 4500, 2.5);
    for (let i = 0; i < n.length; i++) {
      const t = i / SR;
      if (i % 64 === 0) { const ff = biquad('bp', 5200 - t * 14000, 2.5); Object.assign(f, { b0: ff.b0, b1: ff.b1, b2: ff.b2, a1: ff.a1, a2: ff.a2 }); }
      o[i] = f.run(n[i]) * Math.sin((Math.PI * t) / len) ** 3;
    }
    return norm(mix(o, nwave(0.8, 0.5, 0.11)), 0.7);
  },
  impact: () => norm(mix(noise(0.04, 'hp', 2800, 0.7, 0.005, 1), noise(0.25, 'bp', 1300, 1, 0.035, 0.4, 0.008)), 0.5),
  ricochet: () => norm(mix(noise(0.03, 'hp', 3500, 0.7, 0.004, 0.8), tone(0.35, 4200, 1600, 0.12, 0.45, 'sine', 0.15)), 0.5),
  impact_metal: () => norm(mix(noise(0.03, 'hp', 3000, 0.7, 0.004, 0.9), partials(0.4, [1250, 2890, 4630], 0.07, 0.6)), 0.55),

  // --- explosions & abilities ------------------------------------------------
  boom: () => {
    const L = [noise(0.05, 'hp', 1500, 0.7, 0.01, 1.0), tone(1.8, 85, 26, 0.5, 1.4, 'sine', 0.12), noise(2.2, 'lp', 520, 0.7, 0.38, 1.1, 0, 0.004)];
    for (let i = 0; i < 24; i++) L.push(noise(0.05, 'bp', 1500 + Math.abs(rnd()) * 3500, 2, 0.008, 0.25, 0.08 + Math.abs(rnd()) * 1.0));
    return fadeOut(norm(sat(echo(mix(...L), 0.23, 0.3, 0.8), 2.0), 0.98), 0.25);
  },
  boom_far: () => fadeOut(norm(multiTap(mix(noise(1.2, 'lp', 260, 0.7, 0.3, 1), tone(1.2, 60, 28, 0.4, 1, 'sine', 0.2)), [[0.3, 0.4, 300], [0.8, 0.25, 250]], 1.2), 0.8), 0.3),
  incoming: () => { const len = 1.4, o = buf(len); let ph = 0; for (let i = 0; i < o.length; i++) { const t = i / SR; const f = 2600 - t * 1400; ph += (2 * Math.PI * f) / SR; o[i] = Math.sin(ph) * Math.min(1, t / 0.3) * 0.5; } return norm(mix(filt(o, 'bp', 1800, 0.8), noise(len, 'hp', 3000, 0.7, 1.4, 0.15)), 0.55); },
  stim: () => norm(mix(noise(0.5, 'hp', 4000, 0.7, 0.15, 0.7, 0, 0.01), tone(0.9, 500, 1800, 0.45, 0.5, 'saw', 0.25), tone(0.3, 140, 60, 0.08, 0.8), tone(0.2, 2400, 2400, 0.08, 0.2, 'sine', 1, 0.05)), 0.8),
  phase: () => { const a = tone(1.0, 110, 640, 0.65, 0.8, 'saw', 0.3); filt(a, 'lp', 1500, 2); return norm(mix(a, noise(1.0, 'bp', 600, 0.6, 0.55, 0.8, 0, 0.3), partials(1.0, [311, 466, 622], 0.45, 0.5, 0.2), tone(0.6, 60, 40, 0.3, 0.6)), 0.85); },
  drone: () => norm(mix(partials(0.8, [660, 990, 1320], 0.3, 0.6), tone(0.4, 800, 1600, 0.2, 0.4, 'tri', 0.1), noise(0.05, 'bp', 3000, 2, 0.006, 0.5)), 0.7),
  dome: () => norm(sat(mix(noise(0.05, 'hp', 2000, 0.7, 0.008, 0.6), tone(1.4, 38, 120, 0.55, 1.1, 'sine', 0.3), noise(0.9, 'lp', 400, 0.8, 0.25, 0.7, 0, 0.05), partials(1.4, [880, 1108, 1318, 1760], 0.5, 0.5, 0.1)), 1.3), 0.9),
  pulse: () => norm(echo(mix(partials(0.8, [1180, 2360], 0.25, 1), tone(0.4, 300, 90, 0.1, 0.6), noise(0.05, 'hp', 3000, 0.7, 0.008, 0.4)), 0.16, 0.45, 0.8), 0.85),
  gas: () => norm(mix(noise(0.08, 'lp', 400, 0.8, 0.03, 0.9), noise(1.6, 'bp', 1800, 0.5, 0.7, 0.8, 0.02, 0.05), noise(1.2, 'lp', 300, 0.7, 0.4, 0.6)), 0.75),
  smoke: () => norm(mix(tone(0.3, 140, 50, 0.08, 1), noise(1.8, 'bp', 1200, 0.5, 0.8, 0.7, 0.05, 0.05), noise(0.05, 'hp', 2500, 0.7, 0.006, 0.5)), 0.8),
  launch: () => norm(mix(tone(0.25, 200, 70, 0.06, 1), noise(0.5, 'bp', 900, 0.7, 0.15, 0.6, 0, 0.01), noise(0.03, 'hp', 3000, 0.7, 0.004, 0.6)), 0.8),
  missiles: () => norm(mix(noise(1.0, 'bp', 1600, 0.6, 0.35, 0.9, 0, 0.02), tone(1.0, 400, 1400, 0.5, 0.35, 'saw', 0.4), noise(0.05, 'hp', 3000, 0.7, 0.006, 0.6)), 0.85),
  call: () => norm(mix(partials(0.15, [1400], 0.1, 0.8), partials(0.15, [1400], 0.1, 0.8, 0.2), partials(0.3, [1750], 0.15, 0.8, 0.4), noise(0.6, 'bp', 2500, 1, 0.3, 0.2)), 0.6),
  skyward: () => norm(mix(noise(2.4, 'lp', 1300, 0.8, 1.4, 1, 0, 0.3), tone(2.0, 80, 260, 1.2, 0.6, 'saw', 0.8), tone(0.4, 70, 35, 0.2, 0.8)), 0.9),
  riftstart: () => norm(mix(partials(1.0, [220, 330, 415], 0.5, 0.8), tone(0.8, 1200, 300, 0.4, 0.4, 'saw', 0.3)), 0.8),
  riftopen: () => norm(mix(partials(1.4, [261, 392, 523, 659], 0.6, 0.9), noise(1, 'bp', 700, 0.6, 0.4, 0.4, 0, 0.1), tone(0.6, 50, 90, 0.3, 0.6)), 0.85),
  portal: () => norm(mix(tone(0.6, 900, 150, 0.25, 0.8, 'saw', 0.15), noise(0.5, 'bp', 900, 0.6, 0.2, 0.6, 0, 0.05)), 0.8),
  carepkg: () => { const len = 3.0, o = buf(len); let ph = 0; for (let i = 0; i < o.length; i++) { const t = i / SR; const f = 2200 - t * 600; ph += (2 * Math.PI * f) / SR; o[i] = Math.sin(ph) * 0.4 * Math.min(1, t / 0.5); } filt(o, 'bp', 1500, 0.8); return norm(mix(o, noise(3, 'lp', 400, 0.7, 2.0, 0.5, 0, 1.5)), 0.7); },
  throw: () => norm(mix(noise(0.3, 'bp', 1100, 0.8, 0.07, 1, 0, 0.03), noise(0.03, 'bp', 3000, 2, 0.004, 0.4)), 0.5),
  nade_tick: () => norm(partials(0.05, [3100], 0.01, 1), 0.45),
  arc_hum: () => noiseLoop(1, (n) => { let ph = 0; for (let i = 0; i < n.length; i++) { ph += 2 * Math.PI * 120 / SR; n[i] = Math.sign(Math.sin(ph)) * 0.3 + n[i] * 0.4; } filt(n, 'bp', 2400, 1.5); }),
  ult_ready: () => norm(mix(partials(0.5, [784, 1175], 0.2, 0.7), partials(0.8, [1046, 1568, 2093], 0.3, 0.8, 0.12), tone(0.5, 100, 200, 0.2, 0.3)), 0.6),

  // --- ability linger loops (positional) ----------------------------------
  riotwall: () => norm(sat(mix(noise(0.05, 'lp', 300, 0.8, 0.03, 1.0), tone(0.6, 70, 34, 0.18, 1.2, 'sine', 0.05), noise(0.6, 'bp', 1800, 1, 0.2, 0.4, 0.02, 0.02), partials(0.9, [440, 660, 880], 0.35, 0.4, 0.05)), 1.5), 0.92),
  breach: () => norm(sat(mix(noise(0.7, 'bp', 700, 0.6, 0.3, 1.0, 0, 0.05), tone(0.7, 60, 140, 0.4, 0.8, 'saw', 0.3), noise(0.06, 'lp', 400, 0.8, 0.03, 0.8, 0.45), tone(0.4, 110, 40, 0.12, 1.0, 'sine', 0.05, 0.45), grunt(0.3, 140, 110, VOWEL_UH, 0.6, 0.35)), 1.4), 0.92),
  dome_hum: () => noiseLoop(2, (n) => { let p1 = 0, p2 = 0; for (let i = 0; i < n.length; i++) { p1 += 2 * Math.PI * 110 / SR; p2 += 2 * Math.PI * 165.7 / SR; n[i] = Math.sin(p1) * 0.4 + Math.sin(p2) * 0.25 + n[i] * 0.05 * (1 + Math.sin(i / SR * 6)); } filt(n, 'lp', 900, 0.8); }),
  gas_loop: () => noiseLoop(2, (n) => { filt(n, 'bp', 2000, 0.6); for (let i = 0; i < n.length; i++) n[i] *= 0.6 + 0.4 * Math.sin(i / SR * 2.1) ** 2; }),
  smoke_loop: () => noiseLoop(2, (n) => { filt(n, 'lp', 700, 0.7); }),
  drone_hum: () => noiseLoop(1.5, (n) => { let p = 0; for (let i = 0; i < n.length; i++) { p += 2 * Math.PI * (330 + Math.sin(i / SR * 5) * 6) / SR; n[i] = Math.sin(p) * 0.4 + Math.sin(p * 2) * 0.2 + n[i] * 0.03; } }),
  portal_hum: () => noiseLoop(2, (n) => { let p = 0, q = 0; for (let i = 0; i < n.length; i++) { p += 2 * Math.PI * 147 / SR; q += 2 * Math.PI * 221 / SR; n[i] = (Math.sin(p) + Math.sin(q) * 0.7) * (0.6 + 0.4 * Math.sin(i / SR * 3)) * 0.4 + n[i] * 0.04; } filt(n, 'lp', 1500, 1); }),
  pad_hum: () => noiseLoop(1, (n) => { let p = 0; for (let i = 0; i < n.length; i++) { p += 2 * Math.PI * 92 / SR; n[i] = Math.sin(p) * (0.5 + 0.5 * Math.sin(i / SR * 2 * Math.PI * 2)) * 0.5 + n[i] * 0.02; } }),
  missile_loop: () => noiseLoop(0.8, (n) => { filt(n, 'bp', 1800, 0.8); }),
  exhibit_drone: () => noiseLoop(3, (n) => { let p = 0; for (let i = 0; i < n.length; i++) { p += 2 * Math.PI * 70 / SR; n[i] = Math.sin(p) * 0.4 * (0.7 + 0.3 * Math.sin(i / SR * 1.3)) + n[i] * 0.03; } filt(n, 'lp', 600, 0.7); }),

  // --- ring / ambience / tension ---------------------------------------------
  ring_close: () => { const L = []; for (let i = 0; i < 3; i++) L.push(tone(0.5, 220, 196, 0.4, 0.8, 'saw', 0.3, i * 0.6)); const d = mix(...L); filt(d, 'lp', 900, 1.5); return norm(echo(d, 0.3, 0.4, 1), 0.7); },
  ring_burn: () => { const n = buf(1.0); for (let i = 0; i < n.length; i++) n[i] = Math.abs(rnd()) < 0.008 ? rnd() * 3 : rnd() * 0.3; filt(n, 'bp', 2400, 0.7); return norm(n, 0.6); },
  ring_wall: () => noiseLoop(3, (n) => { let p = 0; const c = Float32Array.from(n); filt(n, 'lp', 220, 0.8); for (let i = 0; i < n.length; i++) { p += 2 * Math.PI * 48 / SR; n[i] = n[i] * 2 + Math.sin(p) * 0.25 + (Math.abs(c[i]) > 0.985 ? c[i] * 2 : 0); } }),
  tension_low: () => noiseLoop(8, (n) => {
    let a = 0, b = 0, c = 0;
    for (let i = 0; i < n.length; i++) {
      const t = i / SR;
      a += 2 * Math.PI * 55 / SR; b += 2 * Math.PI * 55.4 / SR; c += 2 * Math.PI * 82.6 / SR;
      const pulse = 0.55 + 0.45 * Math.max(0, Math.sin(t * Math.PI * 2 * 0.5)) ** 3;
      n[i] = ((((a / Math.PI) % 2) - 1) * 0.3 + (((b / Math.PI) % 2) - 1) * 0.3 + Math.sin(c) * 0.25) * pulse + n[i] * 0.02;
    }
    filt(n, 'lp', 420, 1.2);
  }),
  tension_high: () => noiseLoop(4, (n) => {
    let a = 0;
    for (let i = 0; i < n.length; i++) {
      const t = i / SR;
      a += 2 * Math.PI * 110 / SR;
      const beat = (t * 2.5) % 1; // 150 bpm pulse
      n[i] = Math.sin(a) * Math.exp(-beat * 9) * 0.6 + Math.sin(a * 1.5) * 0.1 + n[i] * 0.04 * Math.exp(-beat * 20);
    }
    filt(n, 'lp', 1400, 1);
  }),
  wind: () => noiseLoop(6, (n) => { filt(n, 'lp', 380, 0.7); filt(n, 'lp', 600, 0.7); for (let i = 0; i < n.length; i++) { const t = i / SR; n[i] *= 0.6 + 0.4 * Math.sin((t / 6) * Math.PI * 4) * Math.sin((t / 6) * Math.PI * 6 + 1); } }),
  skywind: () => noiseLoop(3, (n) => { filt(n, 'bp', 700, 0.5); }),
  ship: () => { const n = buf(4); let a = 0, b = 0; for (let i = 0; i < n.length; i++) { a += 2 * Math.PI * 55 / SR; b += 2 * Math.PI * 82.5 / SR; n[i] = Math.sin(a) * 0.5 + Math.sin(b) * 0.3 + rnd() * 0.25; } filt(n, 'lp', 300, 0.8); return norm(n, 0.5); },
  heal_loop: () => noiseLoop(1, (n) => { let p = 0; for (let i = 0; i < n.length; i++) { p += 2 * Math.PI * 440 / SR; n[i] = Math.sin(p) * 0.2 * (0.5 + 0.5 * Math.sin(i / SR * Math.PI * 16)) + n[i] * 0.08; } filt(n, 'bp', 900, 0.6); }),
  healed: () => norm(mix(partials(0.4, [988, 1480], 0.15, 0.7), partials(0.5, [1318, 1975], 0.2, 0.7, 0.09)), 0.55),
  pickup: () => norm(mix(noise(0.05, 'bp', 2600, 2, 0.008, 0.8), partials(0.15, [1600, 2400], 0.04, 0.4, 0.02)), 0.5),
  pickup_armor: () => norm(mix(noise(0.1, 'bp', 1200, 1.5, 0.03, 0.8), partials(0.4, [740, 1110, 1480], 0.12, 0.6, 0.03)), 0.6),
  bin_open: () => norm(mix(noise(0.2, 'bp', 700, 1, 0.05, 0.9), tone(0.3, 180, 120, 0.1, 0.5), partials(0.5, [660, 990, 1320], 0.18, 0.4, 0.15)), 0.65),
  // zone entry: airy whoosh into a two-note bell, quiet enough to sit under combat
  zone_call: () => norm(mix(noise(0.6, 'bp', 1800, 0.6, 0.35, 0.5, 0, 0.25), partials(0.9, [587, 880, 1174], 0.4, 0.6, 0.18), partials(1.1, [784, 1175, 1568], 0.5, 0.55, 0.32), tone(0.5, 90, 70, 0.3, 0.35, 'sine', 0.15, 0.18)), 0.45),
  ui: () => norm(partials(0.06, [2200], 0.015, 1), 0.3),
  ui_hover: () => norm(partials(0.04, [1700], 0.01, 1), 0.15),
  heartbeat: () => norm(mix(tone(0.15, 90, 50, 0.04, 1), tone(0.15, 80, 45, 0.04, 0.8, 'sine', 0.06, 0.18)), 0.7),
  warn: () => norm(mix(partials(0.6, [311, 330], 0.25, 0.6), noise(0.5, 'bp', 3000, 4, 0.2, 0.2, 0, 0.1)), 0.5),
  countdown: () => norm(partials(0.15, [1000], 0.06, 1), 0.5),
  victory: () => { const notes = [[523, 0], [659, 0.15], [784, 0.3], [1046, 0.45], [784, 0.75], [1046, 0.9]]; return norm(mix(...notes.map(([f, t]) => partials(0.9, [f, f * 2, f * 1.5], 0.35, 0.6, t)), tone(1.5, 65, 65, 0.8, 0.4, 'sine', 1)), 0.7); },
  dropjump: () => norm(mix(noise(1.0, 'bp', 600, 0.6, 0.4, 1, 0, 0.1), tone(0.4, 300, 120, 0.15, 0.4)), 0.7),
  enemy_down_ping: () => norm(mix(partials(0.2, [1568], 0.06, 0.8), partials(0.25, [2093], 0.08, 0.8, 0.07)), 0.5),
  ping: () => norm(mix(partials(0.25, [1318, 1975], 0.08, 0.8), partials(0.25, [1760], 0.08, 0.6, 0.08)), 0.5),
  banner: () => norm(mix(partials(0.5, [523, 784], 0.2, 0.6), partials(0.6, [659, 988], 0.25, 0.6, 0.12)), 0.6),
};
for (const s of ['dirt', 'concrete', 'metal', 'water']) {
  for (let v = 0; v < 3; v++) RECIPES[`step_${s}${v}`] = () => stepSurface(s, v - 1);
  RECIPES[`slide_${s}`] = () => slideLoop(s);
}

// ------------------------------------------------------------------ engine
function buildBus(ctx) {
  const sfx = ctx.createGain();
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 20000; lp.Q.value = 0.5;
  const master = ctx.createGain();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18; comp.knee.value = 6; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.15;
  const limit = ctx.createDynamicsCompressor();
  limit.threshold.value = -2; limit.knee.value = 0; limit.ratio.value = 20; limit.attack.value = 0.001; limit.release.value = 0.06;
  sfx.connect(lp).connect(master).connect(comp).connect(limit).connect(ctx.destination);
  const reverb = ctx.createConvolver();
  const ir = ctx.createBuffer(2, Math.floor(ctx.sampleRate * 1.6), ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3.5) * 0.55;
  }
  reverb.buffer = ir;
  const revGain = ctx.createGain();
  revGain.gain.value = 0.2;
  reverb.connect(revGain).connect(lp);
  return { sfx, lp, master, reverb };
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.buffers = {};
    this.loops = {};
    this.voices = 0;
    this.enabled = true;
    this.volume = 0.8;
    this.listener = { x: 0, y: 0, z: 0 };
    this.lpTarget = 20000;
  }

  async init() {
    if (this.ctx) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    this.ctx = ctx;
    SR = ctx.sampleRate;
    Object.assign(this, buildBus(ctx));
    this.master.gain.value = this.volume;
    const jobs = [];
    for (const [id, w] of Object.entries(WEAPONS)) {
      jobs.push(['gun_' + id, () => gunNear(w.sound)]);
      jobs.push(['guntail_' + id, () => gunTail(w.sound)]);
      jobs.push(['gund_' + id, () => gunFar(w.sound)]);
    }
    for (const [k, fn] of Object.entries(RECIPES)) jobs.push([k, fn]);
    let t0 = performance.now();
    for (const [k, fn] of jobs) {
      const data = fn();
      const b = ctx.createBuffer(1, data.length, SR);
      b.copyToChannel(data, 0);
      this.buffers[k] = b;
      if (performance.now() - t0 > 30) { await new Promise((r) => setTimeout(r, 0)); t0 = performance.now(); }
    }
  }

  // Recorded samples (manifest "sounds", e.g. Kenney UI/impact packs or freesound CC0) replace the
  // synthesized recipe of the same name; everything else stays procedural.
  async useSamples(map) {
    if (!this.ctx) return;
    for (const [name, data] of Object.entries(map || {})) {
      try { this.buffers[name] = await this.ctx.decodeAudioData(data.slice(0)); } catch (e) { console.warn('[audio] sample', name, e.message); }
    }
  }

  resume() { if (this.ctx && this.ctx.state !== 'running') this.ctx.resume(); }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }

  // Master low-pass: muffles the world when low on health, knocked or phased.
  setMuffle(freq) {
    if (!this.ctx || Math.abs(freq - this.lpTarget) < 1) return;
    this.lpTarget = freq;
    this.lp.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.12);
  }

  setListener(x, y, z, fx, fy, fz) {
    if (!this.ctx) return;
    this.listener.x = x; this.listener.y = y; this.listener.z = z;
    const L = this.ctx.listener, t = this.ctx.currentTime;
    if (L.positionX) {
      L.positionX.setValueAtTime(x, t); L.positionY.setValueAtTime(y, t); L.positionZ.setValueAtTime(z, t);
      L.forwardX.setValueAtTime(fx, t); L.forwardY.setValueAtTime(fy, t); L.forwardZ.setValueAtTime(fz, t);
      L.upX.setValueAtTime(0, t); L.upY.setValueAtTime(1, t); L.upZ.setValueAtTime(0, t);
    } else { L.setPosition(x, y, z); L.setOrientation(fx, fy, fz, 0, 1, 0); }
  }

  // play(name, pos?, {vol, rate, var, delay, reverb, lp, ref, rolloff, occluded, important})
  play(name, pos = null, opts = {}) {
    if (!this.ctx || !this.enabled) return null;
    const b = this.buffers[name];
    if (!b) return null;
    if (this.voices > 72 && !opts.important) return null;
    const ctx = this.ctx, src = ctx.createBufferSource();
    src.buffer = b;
    src.playbackRate.value = (opts.rate || 1) * (1 + (opts.var || 0) * (Math.random() * 2 - 1));
    const g = ctx.createGain();
    let vol = opts.vol ?? 1;
    let node = src;
    let lpf = opts.lp || 0;
    if (opts.occluded) { lpf = Math.min(lpf || 20000, FEEL.mix.occludedLowpass); vol *= FEEL.mix.occludedGain; }
    if (pos && !lpf) {
      // air absorption: distant sounds lose their highs
      const d = Math.hypot(pos.x - this.listener.x, pos.y - this.listener.y, pos.z - this.listener.z);
      if (d > 25) lpf = Math.max(1200, 20000 - d * 70);
    }
    if (lpf) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = lpf;
      node.connect(f);
      node = f;
    }
    g.gain.value = vol;
    node.connect(g);
    let out = g;
    if (pos) {
      const p = ctx.createPanner();
      p.panningModel = 'HRTF'; p.distanceModel = 'inverse';
      p.refDistance = opts.ref || 4; p.rolloffFactor = opts.rolloff ?? 1.1; p.maxDistance = 3000;
      if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; }
      else p.setPosition(pos.x, pos.y, pos.z);
      g.connect(p);
      out = p;
    }
    out.connect(this.sfx);
    if (opts.reverb) { const rg = ctx.createGain(); rg.gain.value = opts.reverb; out.connect(rg).connect(this.reverb); }
    this.voices++;
    src.onended = () => { this.voices--; };
    src.start(ctx.currentTime + (opts.delay || 0));
    return { src, gain: g };
  }

  // Gunshot with distance tiers: near (<70 m) crack+body, mid blends in the far layer, far (>150 m)
  // is a dull thump with echoes that stays audible to ~600 m as a third-party cue.
  gunshot(weaponId, pos, isLocal, opts = {}) {
    if (!this.ctx) return;
    const s = WEAPONS[weaponId].sound;
    if (isLocal) {
      this.play('gun_' + weaponId, null, { vol: FEEL.mix.gunLocal, var: s.pitchVar, reverb: 0.25, important: true });
      if (opts.tail) this.play('guntail_' + weaponId, null, { vol: FEEL.mix.gunTailLocal, var: 0.03, reverb: 0.3 });
      return;
    }
    const d = Math.hypot(pos.x - this.listener.x, pos.y - this.listener.y, pos.z - this.listener.z);
    const delay = Math.min(1.8, d / 343);
    const occ = opts.occluded;
    if (d < 90) this.play('gun_' + weaponId, pos, { vol: FEEL.mix.gunRemote * (d < 60 ? 1 : (90 - d) / 30), var: 0.04, reverb: 0.25, ref: 7, rolloff: 0.9, delay, occluded: occ });
    if (d < 70 && opts.tail) this.play('guntail_' + weaponId, pos, { vol: 0.5, ref: 10, rolloff: 0.7, delay, occluded: occ });
    if (d > 40) this.play('gund_' + weaponId, pos, { vol: Math.min(1, (d - 40) / 50) * 0.95, var: 0.05, ref: 45, rolloff: 0.55, delay, lp: Math.max(500, 3000 - d * 4) });
  }

  loop(id, name, vol, rate = 1, pos = null) {
    if (!this.ctx) return;
    let l = this.loops[id];
    if (!l && vol <= 0.001) return;
    if (!l) {
      const b = this.buffers[name];
      if (!b) return;
      const src = this.ctx.createBufferSource();
      src.buffer = b; src.loop = true;
      src.loopStart = 0; src.loopEnd = b.duration;
      const g = this.ctx.createGain();
      g.gain.value = 0;
      src.connect(g);
      l = { src, g };
      if (pos) {
        const p = this.ctx.createPanner();
        p.panningModel = 'HRTF'; p.refDistance = 5; p.rolloffFactor = 1.2;
        g.connect(p).connect(this.sfx);
        l.p = p;
      } else g.connect(this.sfx);
      src.start(0, Math.random() * b.duration);
      this.loops[id] = l;
    }
    const t = this.ctx.currentTime;
    l.g.gain.setTargetAtTime(vol, t, 0.06);
    l.src.playbackRate.setTargetAtTime(rate, t, 0.05);
    if (pos && l.p && l.p.positionX) { l.p.positionX.value = pos.x; l.p.positionY.value = pos.y; l.p.positionZ.value = pos.z; }
    if (vol <= 0.001) {
      if (!l.stopT) l.stopT = t + 0.5;
      else if (t > l.stopT) { try { l.src.stop(); } catch {} delete this.loops[id]; }
    } else l.stopT = 0;
  }

  // Fade out every loop whose id starts with prefix and isn't in keep.
  sweepLoops(prefix, keep) {
    for (const id of Object.keys(this.loops)) if (id.startsWith(prefix) && !keep.has(id)) this.loop(id, null, 0);
  }

  stopAll() {
    for (const id in this.loops) { try { this.loops[id].src.stop(); } catch {} }
    this.loops = {};
  }

  // ---- offline rendering through the real bus (used by tools/audio/capture.mjs) ----
  async renderScene(events, dur) {
    const oc = new OfflineAudioContext(1, Math.ceil(dur * SR), SR);
    const bus = buildBus(oc);
    bus.master.gain.value = 1;
    for (const [t, name, o = {}] of events) {
      const b = this.buffers[name];
      if (!b) continue;
      const s = oc.createBufferSource();
      s.buffer = b;
      s.playbackRate.value = o.rate || 1;
      const g = oc.createGain();
      g.gain.value = o.vol ?? 1;
      s.connect(g).connect(bus.sfx);
      if (o.reverb) { const r = oc.createGain(); r.gain.value = o.reverb; g.connect(r).connect(bus.reverb); }
      s.start(t);
    }
    const out = await oc.startRendering();
    return out.getChannelData(0);
  }

  testScenes() {
    const burst = (id, rpm, n, tail = true) => {
      const ev = [];
      for (let i = 0; i < n; i++) ev.push([0.05 + (i * 60) / rpm, 'gun_' + id, { vol: FEEL.mix.gunLocal, reverb: 0.25 }]);
      if (tail) ev.push([0.05 + (n * 60) / rpm, 'guntail_' + id, { vol: FEEL.mix.gunTailLocal, reverb: 0.3 }]);
      return ev;
    };
    return {
      ar_burst: { dur: 2.2, events: burst('talon', 780, 12) },
      smg_burst: { dur: 2, events: burst('hornet', 1080, 14) },
      lmg_burst: { dur: 2.6, events: burst('bulwark', 540, 10) },
      shotgun: { dur: 1.8, events: [...burst('breacher', 75, 1), [0.37, 'pump', { vol: 0.7 }]] },
      sniper: { dur: 2.6, events: [...burst('sentinel', 50, 1), [0.5, 'bolt', { vol: 0.7 }]] },
      fight_feedback: { dur: 2.2, events: [[0.05, 'gun_talon'], [0.1, 'hit_shield'], [0.13, 'gun_talon'], [0.18, 'hit_shield'], [0.21, 'gun_talon'], [0.26, 'shield_crack'], [0.26, 'hit_shield'], [0.29, 'gun_talon'], [0.34, 'shield_break'], [0.37, 'gun_talon'], [0.42, 'hit_flesh'], [0.45, 'gun_talon'], [0.5, 'hit_head'], [0.53, 'gun_talon'], [0.58, 'knock'], [1.2, 'gun_talon'], [1.25, 'kill']] },
    };
  }
}

export const audio = new AudioEngine();
