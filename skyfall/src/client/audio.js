// Procedural sound engine. Every sound is synthesised at startup into AudioBuffers with hand-written
// DSP (noise, biquads, pitch sweeps, inharmonic partials, soft clipping) — no asset files needed.
// Playback is positional (HRTF panners) with distance filtering, a convolution reverb send and a
// bus compressor that glues everything together so gunfire hits hard without clipping.

import { WEAPONS } from '../shared/weapons.js';

let SR = 44100;

// ------------------------------------------------------------------ DSP helpers
const buf = (sec) => new Float32Array(Math.max(1, Math.floor(sec * SR)));
const rnd = () => Math.random() * 2 - 1;

function biquad(type, freq, q = 0.707, gainDb = 0) {
  const w0 = (2 * Math.PI * Math.min(freq, SR * 0.45)) / SR;
  const cos = Math.cos(w0), sin = Math.sin(w0), alpha = sin / (2 * q);
  let b0, b1, b2, a0, a1, a2;
  const A = Math.pow(10, gainDb / 40);
  switch (type) {
    case 'lp': b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha; break;
    case 'hp': b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha; break;
    case 'bp': b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha; break;
    case 'peak': b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cos; a2 = 1 - alpha / A; break;
  }
  const f = { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0, x1: 0, x2: 0, y1: 0, y2: 0 };
  f.run = (x) => {
    const y = f.b0 * x + f.b1 * f.x1 + f.b2 * f.x2 - f.a1 * f.y1 - f.a2 * f.y2;
    f.x2 = f.x1; f.x1 = x; f.y2 = f.y1; f.y1 = y;
    return y;
  };
  return f;
}

function filt(data, type, freq, q, gainDb) {
  const f = biquad(type, freq, q, gainDb);
  for (let i = 0; i < data.length; i++) data[i] = f.run(data[i]);
  return data;
}

// add layer: gen(t, i) * env
function layer(out, start, dur, gen, env) {
  const s0 = Math.floor(start * SR), n = Math.floor(dur * SR);
  for (let i = 0; i < n && s0 + i < out.length; i++) {
    const t = i / SR;
    out[s0 + i] += gen(t, i) * env(t);
  }
}

const expEnv = (tau, attack = 0.0005) => (t) => (t < attack ? t / attack : Math.exp(-(t - attack) / tau));

function noiseLayer(len, type, freq, q, tau, amp, start = 0, attack = 0.0005) {
  const n = buf(len);
  for (let i = 0; i < n.length; i++) n[i] = rnd();
  if (type) filt(n, type, freq, q);
  const out = buf(len + start);
  const env = expEnv(tau, attack);
  const s0 = Math.floor(start * SR);
  for (let i = 0; i < n.length; i++) out[s0 + i] = n[i] * env(i / SR) * amp;
  return out;
}

function mix(...layers) {
  let len = 0;
  for (const l of layers) len = Math.max(len, l.length);
  const out = new Float32Array(len);
  for (const l of layers) for (let i = 0; i < l.length; i++) out[i] += l[i];
  return out;
}

function sweep(len, f0, f1, tau, amp, shape = 'sine', curve = 0.06, start = 0) {
  const out = buf(len + start);
  let ph = 0;
  const s0 = Math.floor(start * SR);
  for (let i = 0; i < len * SR; i++) {
    const t = i / SR;
    const f = f1 + (f0 - f1) * Math.exp(-t / curve);
    ph += (2 * Math.PI * f) / SR;
    let v = Math.sin(ph);
    if (shape === 'saw') v = ((ph / Math.PI) % 2) - 1;
    if (shape === 'square') v = Math.sign(v) * 0.7;
    if (shape === 'tri') v = Math.asin(Math.sin(ph)) * 0.63;
    out[s0 + i] = v * amp * Math.exp(-t / tau) * Math.min(1, t / 0.001);
  }
  return out;
}

function partials(len, freqs, tau, amp, start = 0) {
  const out = buf(len + start);
  const s0 = Math.floor(start * SR);
  for (let i = 0; i < len * SR; i++) {
    const t = i / SR;
    let v = 0;
    for (let k = 0; k < freqs.length; k++) v += Math.sin(2 * Math.PI * freqs[k] * t) * Math.exp(-t / (tau * (1 - k * 0.12)));
    out[s0 + i] = (v / freqs.length) * amp * Math.min(1, t / 0.0008);
  }
  return out;
}

function softclip(data, drive = 1.5) {
  const k = Math.tanh(drive);
  for (let i = 0; i < data.length; i++) data[i] = Math.tanh(data[i] * drive) / k;
  return data;
}

function normalize(data, peak = 0.95) {
  let m = 0;
  for (let i = 0; i < data.length; i++) m = Math.max(m, Math.abs(data[i]));
  if (m > 0) for (let i = 0; i < data.length; i++) data[i] *= peak / m;
  return data;
}

function fade(data, sec = 0.01) {
  const n = Math.min(data.length, Math.floor(sec * SR));
  for (let i = 0; i < n; i++) data[data.length - 1 - i] *= i / n;
  return data;
}

function echo(data, delay, fb, mixAmt, extra = 1) {
  const d = Math.floor(delay * SR);
  const out = new Float32Array(data.length + Math.floor(extra * SR));
  out.set(data);
  for (let i = d; i < out.length; i++) out[i] += out[i - d] * fb * mixAmt;
  return out;
}

// ------------------------------------------------------------------ sound recipes
function gunshot(s, distant = false) {
  const punch = s.punch || 1;
  const layers = [];
  if (!distant) {
    layers.push(noiseLayer(0.03, 'hp', 2500 + s.crack * 1500, 0.7, 0.004 * (0.8 + s.crack * 0.4), 0.9 * s.crack));
    layers.push(noiseLayer(0.25, 'bp', s.body, 0.9, 0.035 * punch, 1.1));
    layers.push(noiseLayer(0.25, 'bp', s.body * 2.3, 1.2, 0.02 * punch, 0.5));
    layers.push(sweep(0.35, s.sub * 2.6, s.sub, 0.07 * punch, 1.1 * punch, 'sine', 0.025));
    layers.push(noiseLayer(0.06, 'bp', 3800, 3, 0.002, 0.5 * s.mech));
    layers.push(noiseLayer(0.06, 'bp', 2400, 3, 0.003, 0.45 * s.mech, 0.03));
    layers.push(noiseLayer(1.6 * s.tail + 0.2, 'lp', 900, 0.6, 0.22 * s.tail, 0.28, 0.012, 0.01));
    if (s.energy) {
      layers.push(sweep(0.12, 2400, 380, 0.05, 0.55, 'square', 0.02));
      layers.push(sweep(0.2, 900, 1400, 0.08, 0.25, 'sine', 0.05));
    }
  } else {
    layers.push(noiseLayer(0.4, 'lp', 600, 0.7, 0.07 * punch, 1.0));
    layers.push(sweep(0.4, s.sub * 1.6, s.sub * 0.8, 0.1 * punch, 0.8, 'sine', 0.04));
    layers.push(noiseLayer(2.2 * s.tail + 0.4, 'lp', 450, 0.6, 0.45 * s.tail + 0.1, 0.35, 0.03, 0.03));
    // supersonic crack arrives first at distance
    layers.push(noiseLayer(0.02, 'hp', 3000, 0.7, 0.003, 0.35 * s.crack));
  }
  let d = mix(...layers);
  d = softclip(d, 1.8 + punch * 0.6);
  if (distant) d = echo(d, 0.19, 0.35, 1, 0.6);
  return fade(normalize(d, distant ? 0.7 : 0.98), 0.05);
}

const RECIPES = {
  hit_flesh: () => normalize(softclip(mix(
    sweep(0.12, 340, 140, 0.03, 1.0, 'sine', 0.02),
    noiseLayer(0.05, 'bp', 2400, 1.5, 0.006, 0.9),
    noiseLayer(0.08, 'lp', 900, 0.7, 0.02, 0.5),
  ), 2), 0.9),
  hit_shield: () => normalize(mix(
    partials(0.22, [1850, 2780, 4130, 5560], 0.055, 1.0),
    noiseLayer(0.03, 'hp', 4000, 0.7, 0.004, 0.6),
    sweep(0.1, 600, 300, 0.02, 0.5),
  ), 0.85),
  hit_head: () => normalize(mix(
    partials(0.35, [3150, 4720, 6300], 0.09, 1.0),
    noiseLayer(0.03, 'hp', 5000, 0.7, 0.003, 0.7),
    sweep(0.12, 520, 200, 0.03, 0.6),
  ), 0.95),
  shield_break: () => {
    const layers = [sweep(0.5, 260, 70, 0.12, 0.9, 'sine', 0.05), noiseLayer(0.6, 'hp', 3000, 0.7, 0.09, 0.7)];
    for (let i = 0; i < 26; i++) layers.push(partials(0.25, [2000 + Math.random() * 6000], 0.03 + Math.random() * 0.05, 0.35, Math.random() * 0.22));
    layers.push(partials(0.6, [1320, 1980], 0.18, 0.6, 0.02));
    return normalize(softclip(mix(...layers), 1.4), 0.95);
  },
  knock: () => normalize(softclip(mix(
    sweep(0.6, 180, 45, 0.18, 1.2, 'sine', 0.08),
    noiseLayer(0.3, 'lp', 700, 0.8, 0.06, 0.8),
    partials(0.7, [523, 392, 311], 0.25, 0.5, 0.05),
  ), 1.6), 0.95),
  kill: () => normalize(softclip(mix(
    sweep(0.5, 150, 40, 0.14, 1.2, 'sine', 0.05),
    noiseLayer(0.12, 'bp', 1800, 1, 0.02, 0.6),
    partials(0.6, [880, 1320, 1760], 0.16, 0.7, 0.03),
    partials(0.7, [1320, 1980, 2640], 0.2, 0.55, 0.11),
  ), 1.3), 0.95),
  evo: () => normalize(mix(
    partials(0.5, [660, 990], 0.15, 0.6, 0), partials(0.5, [880, 1320], 0.15, 0.6, 0.08),
    partials(0.6, [1100, 1650], 0.2, 0.6, 0.16), partials(0.8, [1320, 1980, 2640], 0.3, 0.7, 0.24),
  ), 0.8),
  step: () => normalize(mix(noiseLayer(0.12, 'lp', 500 + Math.random() * 300, 0.9, 0.025, 1), noiseLayer(0.06, 'bp', 2200, 1.4, 0.008, 0.25)), 0.6),
  step2: () => normalize(mix(noiseLayer(0.12, 'lp', 400 + Math.random() * 300, 0.9, 0.022, 1), noiseLayer(0.06, 'bp', 3000, 1.4, 0.006, 0.3)), 0.6),
  step3: () => normalize(mix(noiseLayer(0.12, 'lp', 650, 0.9, 0.02, 1), noiseLayer(0.06, 'bp', 1800, 1.4, 0.01, 0.3)), 0.6),
  jump: () => normalize(mix(noiseLayer(0.25, 'bp', 900, 0.8, 0.06, 0.6, 0, 0.03), noiseLayer(0.1, 'lp', 400, 0.8, 0.02, 0.6)), 0.5),
  land: () => normalize(mix(noiseLayer(0.2, 'lp', 350, 0.9, 0.04, 1), sweep(0.2, 120, 60, 0.05, 0.7)), 0.7),
  hardland: () => normalize(softclip(mix(noiseLayer(0.35, 'lp', 300, 0.9, 0.08, 1), sweep(0.3, 110, 40, 0.09, 1.0), noiseLayer(0.1, 'bp', 1500, 1, 0.02, 0.4)), 1.4), 0.85),
  slide: () => {
    // seamless 1.2s loop of grit
    const n = buf(1.2);
    for (let i = 0; i < n.length; i++) n[i] = rnd();
    filt(n, 'bp', 1400, 0.9); filt(n, 'lp', 3500, 0.7);
    for (let i = 0; i < n.length; i++) n[i] *= 0.8 + 0.2 * Math.sin(i / SR * 40);
    const x = Math.floor(0.1 * SR);
    for (let i = 0; i < x; i++) { const k = i / x; n[i] = n[i] * k + n[n.length - x + i] * (1 - k); }
    return normalize(n.subarray(0, n.length - x), 0.6);
  },
  slidestart: () => normalize(mix(noiseLayer(0.4, 'bp', 1200, 0.8, 0.12, 1, 0, 0.02), sweep(0.2, 200, 80, 0.06, 0.5)), 0.7),
  mantle: () => normalize(mix(noiseLayer(0.3, 'bp', 700, 0.8, 0.07, 0.8, 0, 0.02), noiseLayer(0.2, 'bp', 2400, 1.2, 0.03, 0.4, 0.08), sweep(0.2, 150, 70, 0.05, 0.6)), 0.6),
  wallkick: () => normalize(softclip(mix(sweep(0.25, 160, 60, 0.06, 1.0), noiseLayer(0.3, 'bp', 1000, 0.7, 0.08, 0.7, 0.02, 0.02)), 1.3), 0.75),
  superglide: () => normalize(mix(noiseLayer(0.7, 'bp', 1400, 0.6, 0.25, 0.8, 0, 0.05), sweep(0.5, 300, 900, 0.3, 0.3, 'sine', 0.2)), 0.7),
  pad: () => normalize(mix(sweep(0.7, 90, 520, 0.3, 1, 'sine', 0.12), sweep(0.7, 180, 1040, 0.2, 0.4, 'tri', 0.12), noiseLayer(0.5, 'bp', 1500, 0.7, 0.15, 0.4, 0, 0.03)), 0.9),
  jet: () => {
    const n = buf(1.0);
    for (let i = 0; i < n.length; i++) n[i] = rnd();
    filt(n, 'lp', 1100, 0.9); filt(n, 'peak', 300, 1, 8);
    return normalize(n, 0.6);
  },
  mag_out: () => normalize(mix(noiseLayer(0.08, 'bp', 2800, 2.5, 0.01, 1), noiseLayer(0.1, 'bp', 900, 2, 0.02, 0.6)), 0.6),
  mag_in: () => normalize(softclip(mix(noiseLayer(0.1, 'bp', 1600, 2, 0.015, 1), sweep(0.1, 260, 120, 0.02, 0.8), noiseLayer(0.06, 'bp', 4200, 3, 0.004, 0.5, 0.02)), 1.5), 0.75),
  charge: () => normalize(mix(noiseLayer(0.08, 'bp', 3200, 3, 0.006, 1), noiseLayer(0.1, 'bp', 2000, 3, 0.01, 0.9, 0.07), sweep(0.1, 300, 150, 0.02, 0.4, 'sine', 0.02, 0.07)), 0.7),
  pump: () => normalize(mix(noiseLayer(0.12, 'bp', 1500, 2, 0.02, 1), noiseLayer(0.15, 'bp', 1100, 2, 0.025, 1, 0.13), sweep(0.1, 200, 90, 0.02, 0.6, 'sine', 0.02, 0.13)), 0.75),
  bolt: () => normalize(mix(noiseLayer(0.1, 'bp', 2600, 2, 0.015, 1), noiseLayer(0.12, 'bp', 1800, 2, 0.02, 0.9, 0.18), noiseLayer(0.1, 'bp', 3000, 3, 0.01, 0.8, 0.32)), 0.75),
  dry: () => normalize(noiseLayer(0.05, 'bp', 3500, 4, 0.004, 1), 0.4),
  draw: () => normalize(mix(noiseLayer(0.15, 'bp', 2200, 2, 0.02, 0.7), noiseLayer(0.1, 'bp', 3400, 3, 0.008, 0.6, 0.1)), 0.5),
  whiz: () => {
    const len = 0.22, out = buf(len);
    const n = buf(len);
    for (let i = 0; i < n.length; i++) n[i] = rnd();
    const f = biquad('bp', 3000, 2.5);
    for (let i = 0; i < n.length; i++) {
      const t = i / SR;
      if (i % 64 === 0) { const ff = biquad('bp', 4200 - t * 9000, 2.5); f.b0 = ff.b0; f.b1 = ff.b1; f.b2 = ff.b2; f.a1 = ff.a1; f.a2 = ff.a2; }
      out[i] = f.run(n[i]) * Math.sin((Math.PI * t) / len) ** 2;
    }
    return normalize(out, 0.6);
  },
  impact: () => normalize(mix(noiseLayer(0.05, 'hp', 2500, 0.7, 0.006, 1), noiseLayer(0.25, 'bp', 1200, 1, 0.04, 0.4, 0.01)), 0.5),
  boom: () => {
    const l = [sweep(1.6, 70, 28, 0.45, 1.3, 'sine', 0.15), noiseLayer(2.0, 'lp', 500, 0.7, 0.35, 1.1), noiseLayer(0.15, 'hp', 1500, 0.7, 0.03, 0.6)];
    for (let i = 0; i < 18; i++) l.push(noiseLayer(0.05, 'bp', 1500 + Math.random() * 3000, 2, 0.008, 0.25, 0.1 + Math.random() * 0.9));
    return fade(normalize(softclip(echo(mix(...l), 0.23, 0.3, 1, 0.8), 2.2), 0.98), 0.2);
  },
  stim: () => normalize(mix(noiseLayer(0.5, 'hp', 4000, 0.7, 0.15, 0.7, 0, 0.01), sweep(0.8, 500, 1700, 0.4, 0.5, 'saw', 0.25), sweep(0.3, 120, 60, 0.08, 0.7)), 0.8),
  phase: () => {
    const a = sweep(0.9, 120, 600, 0.6, 0.8, 'saw', 0.3);
    filt(a, 'lp', 1400, 2);
    const n = noiseLayer(0.9, 'bp', 600, 0.6, 0.5, 0.8, 0, 0.3);
    return normalize(mix(a, n, partials(0.9, [311, 466, 622], 0.4, 0.5, 0.2)), 0.85);
  },
  drone: () => normalize(mix(partials(0.8, [660, 990, 1320], 0.3, 0.6), sweep(0.4, 800, 1600, 0.2, 0.4, 'tri', 0.1)), 0.7),
  dome: () => {
    const l = [sweep(1.2, 40, 110, 0.5, 1.0, 'sine', 0.3), noiseLayer(0.8, 'lp', 400, 0.8, 0.25, 0.7, 0, 0.05)];
    l.push(partials(1.2, [880, 1108, 1318, 1760], 0.45, 0.5, 0.1));
    return normalize(softclip(mix(...l), 1.3), 0.9);
  },
  pulse: () => normalize(echo(mix(partials(0.8, [1180, 2360], 0.25, 1), sweep(0.4, 300, 90, 0.1, 0.6)), 0.16, 0.45, 1, 0.8), 0.85),
  gas: () => normalize(mix(noiseLayer(1.6, 'bp', 1800, 0.5, 0.7, 0.8, 0, 0.05), noiseLayer(1.2, 'lp', 300, 0.7, 0.4, 0.6)), 0.7),
  smoke: () => normalize(mix(sweep(0.3, 140, 50, 0.08, 1), noiseLayer(1.8, 'bp', 1200, 0.5, 0.8, 0.7, 0.05, 0.05)), 0.8),
  launch: () => normalize(mix(sweep(0.25, 200, 70, 0.06, 1), noiseLayer(0.5, 'bp', 900, 0.7, 0.15, 0.6, 0, 0.01)), 0.8),
  missiles: () => normalize(mix(noiseLayer(1.0, 'bp', 1600, 0.6, 0.35, 0.9, 0, 0.02), sweep(1.0, 400, 1400, 0.5, 0.35, 'saw', 0.4)), 0.85),
  call: () => normalize(mix(partials(0.15, [1400], 0.1, 0.8), partials(0.15, [1400], 0.1, 0.8, 0.2), partials(0.3, [1750], 0.15, 0.8, 0.4), noiseLayer(0.6, 'bp', 2500, 1, 0.3, 0.2)), 0.6),
  skyward: () => {
    const n = noiseLayer(2.4, 'lp', 1300, 0.8, 1.4, 1, 0, 0.3);
    return normalize(mix(n, sweep(2.0, 80, 260, 1.2, 0.6, 'saw', 0.8)), 0.9);
  },
  riftstart: () => normalize(mix(partials(1.0, [220, 330, 415], 0.5, 0.8), sweep(0.8, 1200, 300, 0.4, 0.4, 'saw', 0.3)), 0.8),
  riftopen: () => normalize(mix(partials(1.4, [261, 392, 523, 659], 0.6, 0.9), noiseLayer(1, 'bp', 700, 0.6, 0.4, 0.4, 0, 0.1)), 0.85),
  portal: () => normalize(mix(sweep(0.6, 800, 150, 0.25, 0.8, 'saw', 0.15), noiseLayer(0.5, 'bp', 900, 0.6, 0.2, 0.6, 0, 0.05)), 0.8),
  carepkg: () => {
    const len = 3.0, out = buf(len);
    let ph = 0;
    for (let i = 0; i < out.length; i++) { const t = i / SR; const f = 2200 - t * 600; ph += (2 * Math.PI * f) / SR; out[i] = Math.sin(ph) * 0.4 * Math.min(1, t / 0.5); }
    filt(out, 'bp', 1500, 0.8);
    return normalize(mix(out, noiseLayer(3, 'lp', 400, 0.7, 2.0, 0.5, 0, 1.5)), 0.7);
  },
  throw: () => normalize(noiseLayer(0.3, 'bp', 1100, 0.8, 0.07, 1, 0, 0.03), 0.5),
  ult_ready: () => normalize(mix(partials(0.5, [784, 1175], 0.2, 0.7), partials(0.8, [1046, 1568, 2093], 0.3, 0.8, 0.12)), 0.6),
  ring_close: () => {
    const l = [];
    for (let i = 0; i < 3; i++) l.push(sweep(0.5, 220, 196, 0.4, 0.8, 'saw', 0.3, i * 0.6));
    const d = mix(...l);
    filt(d, 'lp', 900, 1.5);
    return normalize(echo(d, 0.3, 0.4, 1, 1), 0.7);
  },
  ring_burn: () => {
    const n = buf(1.0);
    for (let i = 0; i < n.length; i++) n[i] = Math.random() < 0.004 ? rnd() * 3 : rnd() * 0.3;
    filt(n, 'bp', 2400, 0.7);
    return normalize(n, 0.6);
  },
  wind: () => {
    const len = 6, n = buf(len);
    for (let i = 0; i < n.length; i++) n[i] = rnd();
    filt(n, 'lp', 380, 0.7); filt(n, 'lp', 600, 0.7);
    for (let i = 0; i < n.length; i++) { const t = i / SR; n[i] *= 0.6 + 0.4 * Math.sin((t / len) * Math.PI * 2 * 2) * Math.sin((t / len) * Math.PI * 2 * 3 + 1); }
    const x = Math.floor(0.3 * SR);
    for (let i = 0; i < x; i++) { const k = i / x; n[i] = n[i] * k + n[n.length - x + i] * (1 - k); }
    return normalize(n.subarray(0, n.length - x), 0.5);
  },
  skywind: () => {
    const len = 3, n = buf(len);
    for (let i = 0; i < n.length; i++) n[i] = rnd();
    filt(n, 'bp', 700, 0.5);
    const x = Math.floor(0.2 * SR);
    for (let i = 0; i < x; i++) { const k = i / x; n[i] = n[i] * k + n[n.length - x + i] * (1 - k); }
    return normalize(n.subarray(0, n.length - x), 0.6);
  },
  ship: () => {
    const len = 4, n = buf(len);
    let ph = 0, ph2 = 0;
    for (let i = 0; i < n.length; i++) { ph += (2 * Math.PI * 55) / SR; ph2 += (2 * Math.PI * 82.5) / SR; n[i] = Math.sin(ph) * 0.5 + Math.sin(ph2) * 0.3 + rnd() * 0.25; }
    filt(n, 'lp', 300, 0.8);
    return normalize(n, 0.5);
  },
  heal_loop: () => {
    const len = 1, n = buf(len);
    let ph = 0;
    for (let i = 0; i < n.length; i++) { ph += (2 * Math.PI * 440) / SR; n[i] = Math.sin(ph) * 0.2 * (0.5 + 0.5 * Math.sin(i / SR * Math.PI * 2 * 8)) + rnd() * 0.08; }
    filt(n, 'bp', 900, 0.6);
    return normalize(n, 0.35);
  },
  healed: () => normalize(mix(partials(0.4, [988, 1480], 0.15, 0.7), partials(0.5, [1318, 1975], 0.2, 0.7, 0.09)), 0.55),
  pickup: () => normalize(mix(noiseLayer(0.05, 'bp', 2600, 2, 0.008, 0.8), partials(0.15, [1600], 0.04, 0.4, 0.02)), 0.5),
  pickup_armor: () => normalize(mix(noiseLayer(0.1, 'bp', 1200, 1.5, 0.03, 0.8), partials(0.4, [740, 1110, 1480], 0.12, 0.6, 0.03)), 0.6),
  ui: () => normalize(partials(0.06, [2200], 0.015, 1), 0.3),
  ui_hover: () => normalize(partials(0.04, [1700], 0.01, 1), 0.15),
  heartbeat: () => normalize(mix(sweep(0.15, 90, 50, 0.04, 1), sweep(0.15, 80, 45, 0.04, 0.8, 'sine', 0.06, 0.18)), 0.7),
  warn: () => normalize(mix(partials(0.6, [311, 330], 0.25, 0.6), noiseLayer(0.5, 'bp', 3000, 4, 0.2, 0.2, 0, 0.1)), 0.5),
  countdown: () => normalize(partials(0.15, [1000], 0.06, 1), 0.5),
  victory: () => {
    const notes = [[523, 0], [659, 0.15], [784, 0.3], [1046, 0.45], [784, 0.75], [1046, 0.9]];
    return normalize(mix(...notes.map(([f, t]) => partials(0.9, [f, f * 2, f * 1.5], 0.35, 0.6, t))), 0.7);
  },
  dropjump: () => normalize(mix(noiseLayer(1.0, 'bp', 600, 0.6, 0.4, 1, 0, 0.1), sweep(0.4, 300, 120, 0.15, 0.4)), 0.7),
  enemy_down_ping: () => normalize(mix(partials(0.2, [1568], 0.06, 0.8), partials(0.25, [2093], 0.08, 0.8, 0.07)), 0.5),
  ping: () => normalize(mix(partials(0.25, [1318, 1975], 0.08, 0.8), partials(0.25, [1760], 0.08, 0.6, 0.08)), 0.5),
  low_ammo: () => normalize(noiseLayer(0.05, 'bp', 4500, 4, 0.004, 1), 0.25),
};

// ------------------------------------------------------------------ engine
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.buffers = {};
    this.loops = {};
    this.voices = 0;
    this.enabled = true;
    this.volume = 0.8;
    this.listener = { x: 0, y: 0, z: 0 };
  }

  async init() {
    if (this.ctx) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    this.ctx = ctx;
    SR = ctx.sampleRate;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 8; comp.ratio.value = 5; comp.attack.value = 0.002; comp.release.value = 0.18;
    this.master.connect(comp).connect(ctx.destination);
    // reverb send
    this.reverb = ctx.createConvolver();
    const ir = ctx.createBuffer(2, Math.floor(SR * 1.8), SR);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < d.length; i++) d[i] = rnd() * Math.pow(1 - i / d.length, 3.2) * 0.6;
    }
    this.reverb.buffer = ir;
    this.revGain = ctx.createGain();
    this.revGain.gain.value = 0.22;
    this.reverb.connect(this.revGain).connect(this.master);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    // synthesise everything (spread over frames so the UI stays responsive)
    const jobs = [];
    for (const [id, w] of Object.entries(WEAPONS)) {
      jobs.push(['gun_' + id, () => gunshot(w.sound, false)]);
      jobs.push(['gund_' + id, () => gunshot(w.sound, true)]);
    }
    for (const [k, fn] of Object.entries(RECIPES)) jobs.push([k, fn]);
    for (const [k, fn] of jobs) {
      const data = fn();
      const b = ctx.createBuffer(1, data.length, SR);
      b.copyToChannel(data, 0);
      this.buffers[k] = b;
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  resume() {
    if (this.ctx && this.ctx.state !== 'running') this.ctx.resume();
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  setListener(x, y, z, fx, fy, fz) {
    if (!this.ctx) return;
    this.listener.x = x; this.listener.y = y; this.listener.z = z;
    const L = this.ctx.listener;
    const t = this.ctx.currentTime;
    if (L.positionX) {
      L.positionX.setValueAtTime(x, t); L.positionY.setValueAtTime(y, t); L.positionZ.setValueAtTime(z, t);
      L.forwardX.setValueAtTime(fx, t); L.forwardY.setValueAtTime(fy, t); L.forwardZ.setValueAtTime(fz, t);
      L.upX.setValueAtTime(0, t); L.upY.setValueAtTime(1, t); L.upZ.setValueAtTime(0, t);
    } else {
      L.setPosition(x, y, z);
      L.setOrientation(fx, fy, fz, 0, 1, 0);
    }
  }

  // Play a buffer. pos = {x,y,z} for 3D, omit for 2D. opts: vol, rate, delay, reverb, lp
  play(name, pos = null, opts = {}) {
    if (!this.ctx || !this.enabled) return null;
    const b = this.buffers[name];
    if (!b) return null;
    if (this.voices > 64 && !opts.important) return null;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.playbackRate.value = (opts.rate || 1) * (1 + (opts.var || 0) * (Math.random() * 2 - 1));
    const g = ctx.createGain();
    g.gain.value = opts.vol ?? 1;
    let node = src;
    if (opts.lp) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = opts.lp;
      node.connect(f);
      node = f;
    }
    node.connect(g);
    let out = g;
    if (pos) {
      const p = ctx.createPanner();
      p.panningModel = 'HRTF';
      p.distanceModel = 'inverse';
      p.refDistance = opts.ref || 4;
      p.rolloffFactor = opts.rolloff ?? 1.1;
      p.maxDistance = 2000;
      if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; }
      else p.setPosition(pos.x, pos.y, pos.z);
      g.connect(p);
      out = p;
    }
    out.connect(this.sfx);
    if (opts.reverb) {
      const rg = ctx.createGain();
      rg.gain.value = opts.reverb;
      out.connect(rg).connect(this.reverb);
    }
    this.voices++;
    src.onended = () => { this.voices--; };
    src.start(ctx.currentTime + (opts.delay || 0));
    return { src, gain: g };
  }

  // Positional gunshot with distance-based near/far blend and speed-of-sound delay.
  gunshot(weaponId, pos, isLocal) {
    if (!this.ctx) return;
    if (isLocal) {
      this.play('gun_' + weaponId, null, { vol: 0.95, var: WEAPONS[weaponId].sound.pitchVar, reverb: 0.35, important: true });
      return;
    }
    const d = Math.hypot(pos.x - this.listener.x, pos.y - this.listener.y, pos.z - this.listener.z);
    const delay = Math.min(1.2, d / 343);
    if (d < 70) {
      this.play('gun_' + weaponId, pos, { vol: 1.0, var: 0.04, reverb: 0.3, ref: 6, rolloff: 0.9, delay, lp: 18000 - d * 140 });
    }
    if (d > 35) {
      this.play('gund_' + weaponId, pos, { vol: Math.min(1, (d - 35) / 40) * 0.9, var: 0.04, ref: 30, rolloff: 0.6, delay, reverb: 0.2 });
    }
  }

  // Looping sounds keyed by id; call with vol 0 to fade out.
  loop(id, name, vol, rate = 1, pos = null) {
    if (!this.ctx) return;
    let l = this.loops[id];
    if (!l && vol <= 0.001) return;
    if (!l) {
      const b = this.buffers[name];
      if (!b) return;
      const src = this.ctx.createBufferSource();
      src.buffer = b;
      src.loop = true;
      const g = this.ctx.createGain();
      g.gain.value = 0;
      src.connect(g);
      let out = g;
      if (pos) {
        const p = this.ctx.createPanner();
        p.panningModel = 'HRTF';
        p.refDistance = 4;
        g.connect(p);
        out = p;
        l = { src, g, p };
      } else l = { src, g };
      out.connect(this.sfx);
      src.start();
      this.loops[id] = l;
    }
    const t = this.ctx.currentTime;
    l.g.gain.setTargetAtTime(vol, t, 0.06);
    l.src.playbackRate.setTargetAtTime(rate, t, 0.05);
    if (pos && l.p) {
      if (l.p.positionX) { l.p.positionX.value = pos.x; l.p.positionY.value = pos.y; l.p.positionZ.value = pos.z; }
    }
    if (vol <= 0.001) {
      if (!l.stopT) l.stopT = t + 0.5;
      else if (t > l.stopT) { try { l.src.stop(); } catch {} delete this.loops[id]; }
    } else l.stopT = 0;
  }

  stopAll() {
    for (const id in this.loops) { try { this.loops[id].src.stop(); } catch {} }
    this.loops = {};
  }
}

export const audio = new AudioEngine();
