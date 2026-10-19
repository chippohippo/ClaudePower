// dsp: a small offline DSP kit for synthesizing the game's sounds in plain JavaScript (SoundBank).
// Seeded noise, oscillators with gliding pitch, envelopes, RBJ biquads (their cutoff can move),
// resonators, echoes, a small reverb, saturation, stereo. Deterministic: the same seed renders the
// same samples, in the browser's sound worker or in a Node test. Everything works on Float32Arrays
// of samples at `sr`; times are in seconds.

export const SR = 48000;
const TAU = Math.PI * 2;

/** A seeded random source in [0, 1). */
export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

export const samples = (sec, sr = SR) => Math.max(1, Math.ceil(sec * sr));
export const buf = (sec, sr = SR) => new Float32Array(samples(sec, sr));

// ---------------------------------------------------------------- sources
/** Noise: 'white', 'pink' (Kellet) or 'brown' (integrated, leaky). */
export function noise(n, r, color = 'white') {
  const out = new Float32Array(n);
  if (color === 'white') { for (let i = 0; i < n; i++) out[i] = r() * 2 - 1; return out; }
  if (color === 'pink') {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < n; i++) {
      const w = r() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
    }
    return out;
  }
  let y = 0;
  for (let i = 0; i < n; i++) { y = y * 0.985 + (r() * 2 - 1) * 0.12; out[i] = y; }
  return out;
}

/**
 * An oscillator whose frequency may glide: f is Hz or f(t). type: sine | saw | square | tri.
 * Phase-accumulated, so any glide is click-free.
 */
export function osc(n, f, type = 'sine', sr = SR, phase0 = 0) {
  const out = new Float32Array(n), fn = typeof f === 'function';
  let ph = phase0;
  for (let i = 0; i < n; i++) {
    const hz = fn ? f(i / sr) : f;
    ph += hz / sr; ph -= Math.floor(ph);
    out[i] = type === 'sine' ? Math.sin(ph * TAU) : type === 'saw' ? 2 * ph - 1 : type === 'square' ? (ph < 0.5 ? 1 : -1) : 1 - 4 * Math.abs(ph - 0.5);
  }
  return out;
}

/** Exponential glide from f0 toward f1 with time constant tau: f(t) = f1 + (f0 - f1) e^(-t/tau). */
export const glide = (f0, f1, tau) => (t) => f1 + (f0 - f1) * Math.exp(-t / tau);
/** A straight exponential sweep from f0 to f1 over `len` seconds (held after). */
export const sweep = (f0, f1, len) => (t) => f0 * (f1 / f0) ** Math.min(1, t / len);

/** FM: a carrier at fc(t), modulated at fc * ratio with an index that decays with time constant tau. */
export function fm(n, fc, ratio, index, tau, sr = SR) {
  const out = new Float32Array(n), fn = typeof fc === 'function';
  let pc = 0, pm = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr, c = fn ? fc(t) : fc, I = index * Math.exp(-t / tau);
    pm += (c * ratio) / sr; pm -= Math.floor(pm);
    pc += (c + Math.sin(pm * TAU) * I * c * ratio) / sr; pc -= Math.floor(pc);
    out[i] = Math.sin(pc * TAU);
  }
  return out;
}

/** Decaying sinusoids (a struck object: bells, metal, a ring): [[Hz, amp, tau], ...]. */
export function modes(n, list, sr = SR, r = null) {
  const out = new Float32Array(n);
  for (const [f, a, tau] of list) {
    const ph = r ? r() * TAU : 0, w = (TAU * f) / sr, k = Math.exp(-1 / (tau * sr));
    let g = a;
    for (let i = 0; i < n && g > 1e-5; i++) { out[i] += Math.sin(w * i + ph) * g; g *= k; }
  }
  return out;
}

/** Sparse grains: `count` short clicks of random level at times drawn by `when(r)`, each `len` s. */
export function grains(n, r, count, when, len = 0.002, sr = SR) {
  const out = new Float32Array(n), m = samples(len, sr);
  for (let c = 0; c < count; c++) {
    const at = Math.floor(when(r) * sr), a = 0.3 + r() * 0.7;
    for (let i = 0; i < m && at + i < n; i++) out[at + i] += (r() * 2 - 1) * a * (1 - i / m);
  }
  return out;
}

// ---------------------------------------------------------------- envelopes
/** Attack in `a` s, then exponential decay with time constant `tau` s (from `at` s). */
export function envExp(n, a, tau, sr = SR, at = 0) {
  const out = new Float32Array(n), s0 = Math.floor(at * sr), as = Math.max(1, a * sr);
  for (let i = s0; i < n; i++) {
    const k = i - s0;
    out[i] = k < as ? k / as : Math.exp(-(k - as) / (tau * sr));
  }
  return out;
}
/** A swell: rises over `rise` s (curve: power), holds, falls over `fall` s, ending at `len`. */
export function envSwell(n, rise, len, fall, sr = SR, power = 2) {
  const out = new Float32Array(n), R = rise * sr, E = len * sr, F = fall * sr;
  for (let i = 0; i < n; i++) out[i] = i < R ? (i / R) ** power : i < E - F ? 1 : i < E ? (E - i) / F : 0;
  return out;
}

// ---------------------------------------------------------------- shaping
export function mul(a, b) { for (let i = 0; i < a.length; i++) a[i] *= b[i] ?? 0; return a; }
export function scale(a, g) { for (let i = 0; i < a.length; i++) a[i] *= g; return a; }
/** dst += src * g, starting `at` seconds into dst. */
export function mix(dst, src, g = 1, at = 0, sr = SR) {
  const o = Math.floor(at * sr);
  for (let i = 0; i < src.length && o + i < dst.length; i++) if (o + i >= 0) dst[o + i] += src[i] * g;
  return dst;
}
export function saturate(a, drive = 1) { const k = Math.tanh(drive); for (let i = 0; i < a.length; i++) a[i] = Math.tanh(a[i] * drive) / k; return a; }
export function reverse(a) { return a.reverse(); }
export function peak(a) { let p = 0; for (let i = 0; i < a.length; i++) { const v = Math.abs(a[i]); if (v > p) p = v; } return p; }
export function normalize(a, to = 0.9) { const p = peak(a); return p > 1e-9 ? scale(a, to / p) : a; }
export function fadeOut(a, sec, sr = SR) { const m = Math.min(a.length, samples(sec, sr)); for (let i = 0; i < m; i++) a[a.length - 1 - i] *= i / m; return a; }
export function fadeIn(a, sec, sr = SR) { const m = Math.min(a.length, samples(sec, sr)); for (let i = 0; i < m; i++) a[i] *= i / m; return a; }
/** Ring modulation by a sine at f (a growl). */
export function ring(a, f, depth = 1, sr = SR) { const w = (TAU * f) / sr; for (let i = 0; i < a.length; i++) a[i] *= 1 - depth + depth * Math.sin(w * i); return a; }
/** Tremolo: amplitude wobble at f. */
export function tremolo(a, f, depth = 0.5, sr = SR) { const w = (TAU * f) / sr; for (let i = 0; i < a.length; i++) a[i] *= 1 - depth * (0.5 + 0.5 * Math.sin(w * i)); return a; }

// ---------------------------------------------------------------- filters
/**
 * RBJ biquad, in place. type: lowpass | highpass | bandpass | peak | notch. f (Hz) and q may be
 * numbers or functions of t (the coefficients follow every 16 samples).
 */
export function biquad(x, type, f, q = 0.707, gainDb = 0, sr = SR) {
  const ff = typeof f === 'function', fq = typeof q === 'function';
  let b0 = 0, b1 = 0, b2 = 0, a1 = 0, a2 = 0, x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const coef = (hz, Q) => {
    const w0 = (TAU * Math.min(Math.max(hz, 10), sr * 0.45)) / sr, c = Math.cos(w0), s = Math.sin(w0), al = s / (2 * Math.max(0.05, Q));
    let n0, n1, n2, d0, d1, d2;
    if (type === 'lowpass') { n0 = (1 - c) / 2; n1 = 1 - c; n2 = n0; }
    else if (type === 'highpass') { n0 = (1 + c) / 2; n1 = -(1 + c); n2 = n0; }
    else if (type === 'bandpass') { n0 = al; n1 = 0; n2 = -al; }
    else if (type === 'notch') { n0 = 1; n1 = -2 * c; n2 = 1; }
    if (type === 'peak') {
      const A = 10 ** (gainDb / 40);
      n0 = 1 + al * A; n1 = -2 * c; n2 = 1 - al * A; d0 = 1 + al / A; d1 = -2 * c; d2 = 1 - al / A;
    } else if (type === 'lowshelf' || type === 'highshelf') {
      const A = 10 ** (gainDb / 40), sq = 2 * Math.sqrt(A) * al, k = type === 'lowshelf' ? 1 : -1;
      n0 = A * ((A + 1) - k * (A - 1) * c + sq); n1 = 2 * k * A * ((A - 1) - k * (A + 1) * c); n2 = A * ((A + 1) - k * (A - 1) * c - sq);
      d0 = (A + 1) + k * (A - 1) * c + sq; d1 = -2 * k * ((A - 1) + k * (A + 1) * c); d2 = (A + 1) + k * (A - 1) * c - sq;
    } else { d0 = 1 + al; d1 = -2 * c; d2 = 1 - al; }
    b0 = n0 / d0; b1 = n1 / d0; b2 = n2 / d0; a1 = d1 / d0; a2 = d2 / d0;
  };
  coef(ff ? f(0) : f, fq ? q(0) : q);
  for (let i = 0; i < x.length; i++) {
    if ((ff || fq) && (i & 15) === 0) coef(ff ? f(i / sr) : f, fq ? q(i / sr) : q);
    const v = x[i], y = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = v; y2 = y1; y1 = y;
    x[i] = y;
  }
  return x;
}
export const lowpass = (x, f, q = 0.707, sr = SR) => biquad(x, 'lowpass', f, q, 0, sr);
export const highpass = (x, f, q = 0.707, sr = SR) => biquad(x, 'highpass', f, q, 0, sr);
export const bandpass = (x, f, q = 1, sr = SR) => biquad(x, 'bandpass', f, q, 0, sr);
/** EQ in place: a list of [type, Hz, dB, q] (peak, lowshelf, highshelf) or [lowpass|highpass, Hz, q]. */
export function eq(x, bands, sr = SR) {
  for (const [type, f, a, b] of bands) {
    if (type === 'lowpass' || type === 'highpass') biquad(x, type, f, a ?? 0.707, 0, sr);
    else biquad(x, type, f, b ?? (type === 'peak' ? 1 : 0.707), a, sr);
  }
  return x;
}

// ---------------------------------------------------------------- the physics of a shot
/**
 * A blast wave (the Friedlander waveform): a near-instant rise, the positive phase falling through
 * zero at `tPos` s into the negative phase, and back. What a muzzle or a charge does to the air;
 * the shorter the positive phase, the higher and sharper the pop (a rifle's ~1 ms, a shell's ~15).
 */
export function friedlander(n, tPos, b = 1.6, rise = 0.00004, sr = SR) {
  const out = new Float32Array(n), r = Math.max(1, rise * sr);
  for (let i = 0; i < n; i++) {
    const t = i / sr, up = Math.min(1, i / r);
    out[i] = up * (1 - t / tPos) * Math.exp((-b * t) / tPos);
  }
  return out;
}

/**
 * Dispersion: a cascade of first-order allpasses (coefficient a, -1 < a < 0: the highs come out
 * first and the lows last). A click through it becomes a falling chirp: the slinky, the stretched
 * spring, the "pew" of a blaster. The more stages, the longer the fall (~N * (1-a)/(1+a) samples for
 * the lowest notes).
 */
export function disperse(x, stages, a, k = 1) {
  const out = Float32Array.from(x);
  if (k > 1) {
    // Stretched: each section (a + z^-k) / (1 + a z^-k): the dispersion repeats k times across the
    // band, k chirps falling together (a spring's metallic twang).
    const xs = new Float32Array(k), ys = new Float32Array(k);
    for (let s = 0; s < stages; s++) {
      xs.fill(0); ys.fill(0);
      for (let i = 0, j = 0; i < out.length; i++, j = (j + 1) % k) { const v = out[i], y = a * v + xs[j] - a * ys[j]; xs[j] = v; ys[j] = y; out[i] = y; }
    }
    return out;
  }
  for (let s = 0; s < stages; s++) {
    let x1 = 0, y1 = 0;
    for (let i = 0; i < out.length; i++) { const v = out[i], y = a * v + x1 - a * y1; x1 = v; y1 = y; out[i] = y; }
  }
  return out;
}

/** Played k times faster (pitch and length together), by cubic (Hermite) interpolation. */
export function resample(x, k) {
  const n = Math.max(1, Math.floor((x.length - 1) / k)), out = new Float32Array(n);
  const at = (i) => x[Math.max(0, Math.min(x.length - 1, i))];
  for (let j = 0; j < n; j++) {
    const p = j * k, i = Math.floor(p), f = p - i;
    const y0 = at(i - 1), y1 = at(i), y2 = at(i + 1), y3 = at(i + 2);
    const c1 = 0.5 * (y2 - y0), c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3, c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
    out[j] = ((c3 * f + c2) * f + c1) * f + y1;
  }
  return out;
}

/** Warm saturation: tanh with a bias, so it adds even harmonics too (bass you hear on small speakers). */
export function warm(a, drive = 2, bias = 0.2) {
  const k = Math.tanh(drive * (1 + bias)) - Math.tanh(drive * bias);
  const z = Math.tanh(drive * bias);
  for (let i = 0; i < a.length; i++) a[i] = (Math.tanh(drive * (a[i] + bias)) - z) / k;
  return a;
}

/** Transient shaper: the attack pushed up by `amount` (0..2), from the gap between a fast and a slow envelope. */
export function transient(x, amount = 1, sr = SR) {
  const fa = Math.exp(-1 / (0.0007 * sr)), sa = Math.exp(-1 / (0.02 * sr));
  let f = 0, s = 0;
  for (let i = 0; i < x.length; i++) {
    const v = Math.abs(x[i]);
    f = Math.max(v, f * fa); s = s * sa + v * (1 - sa);
    x[i] *= 1 + amount * Math.max(0, Math.min(3, f / (s + 1e-6) - 1)) * 0.5;
  }
  return x;
}

/** Electric crackle: sparse arcs (clicks of random size and sign), `rate` a second, under `env(t)`. */
export function crackle(n, r, rate, env = () => 1, sr = SR) {
  const out = new Float32Array(n);
  let t = 0;
  while (true) {
    t += -Math.log(1 - r() * 0.999) / rate;
    const at = Math.floor(t * sr);
    if (at >= n) break;
    const a = env(t) * (0.2 + r() ** 2 * 0.8) * (r() < 0.5 ? -1 : 1), len = 2 + Math.floor(r() * sr * 0.0008);
    for (let i = 0; i < len && at + i < n; i++) out[at + i] += a * (1 - i / len) * (i % 2 ? -0.6 : 1);
  }
  return out;
}

/** A stereo pair from a mono sound: the right a few ms late and a little duller (wide, still solid in mono). */
export function haas(x, ms = 9, sr = SR) {
  const d = Math.round((ms / 1000) * sr), R = new Float32Array(x.length + d);
  R.set(x, d);
  lowpass(R, 9000, 0.707, sr);
  const L = new Float32Array(R.length); L.set(x);
  return [L, R];
}

// ---------------------------------------------------------------- FFT (offline convolution, analysis)
/** In-place radix-2 FFT of (re, im), length a power of two. inverse: the inverse transform, scaled by 1/n. */
export function fft(re, im, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (TAU / len) * (inverse ? 1 : -1), wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}
/** x convolved with h (FFT), the full length (x.length + h.length - 1). */
export function convolve(x, h) {
  const m = x.length + h.length - 1;
  let n = 1; while (n < m) n <<= 1;
  const ar = new Float64Array(n), ai = new Float64Array(n), br = new Float64Array(n), bi = new Float64Array(n);
  ar.set(x); br.set(h);
  fft(ar, ai); fft(br, bi);
  for (let i = 0; i < n; i++) { const r = ar[i] * br[i] - ai[i] * bi[i]; ai[i] = ar[i] * bi[i] + ai[i] * br[i]; ar[i] = r; }
  fft(ar, ai, true);
  return Float32Array.from(ar.subarray(0, m));
}

/** Echoes: copies of x (each low-passed at its own cutoff) at [[seconds, gain, lowpassHz], ...], into a longer buffer. */
export function echoes(x, taps, tail = 0, sr = SR) {
  const last = Math.max(0, ...taps.map((t) => t[0]));
  const out = new Float32Array(x.length + samples(last + tail, sr));
  out.set(x);
  for (const [t, g, lp] of taps) mix(out, lp ? lowpass(Float32Array.from(x), lp, 0.6, sr) : x, g, t, sr);
  return out;
}

/** A small Schroeder reverb (4 combs, 2 allpasses), wet only. decay: comb feedback 0..0.98; damp: 0..1. */
export function reverb(x, { decay = 0.84, damp = 0.35, size = 1, seconds = 1.2 } = {}, sr = SR) {
  const out = new Float32Array(x.length + samples(seconds, sr));
  const combs = [1116, 1188, 1277, 1356].map((d) => Math.round(d * size * (sr / 44100)));
  for (const d of combs) {
    const line = new Float32Array(d); let p = 0, f = 0;
    for (let i = 0; i < out.length; i++) {
      const y = line[p]; f = y * (1 - damp) + f * damp;
      line[p] = (i < x.length ? x[i] : 0) + f * decay; p = (p + 1) % d;
      out[i] += y * 0.25;
    }
  }
  for (const d of [556, 441].map((v) => Math.round(v * size * (sr / 44100)))) {
    const line = new Float32Array(d); let p = 0;
    for (let i = 0; i < out.length; i++) { const b = line[p], v = out[i]; line[p] = v + b * 0.5; out[i] = b - v; p = (p + 1) % d; }
  }
  return out;
}

// ---------------------------------------------------------------- stereo
/** Stereo from a mono core: [L, R], each `core + side * ±width` (a decorrelated side keeps it wide, the core keeps it solid). */
export function stereo(core, sideL = null, sideR = null, width = 1) {
  const n = Math.max(core.length, sideL?.length ?? 0, sideR?.length ?? 0), L = new Float32Array(n), R = new Float32Array(n);
  L.set(core); R.set(core);
  if (sideL) mix(L, sideL, width);
  if (sideR) mix(R, sideR, width);
  return [L, R];
}
/** Normalize a stereo pair together to a peak. */
export function normalize2([L, R], to = 0.9) {
  const p = Math.max(peak(L), peak(R));
  if (p > 1e-9) { scale(L, to / p); scale(R, to / p); }
  return [L, R];
}
/** Make a buffer loop seamlessly: crossfade its last `sec` into its start, then trim. */
export function loopify(x, sec, sr = SR) {
  const m = samples(sec, sr), n = x.length - m, out = x.slice(0, n);
  for (let i = 0; i < m; i++) { const k = i / m; out[i] = x[i] * k + x[n + i] * (1 - k); }
  return out;
}

// ---------------------------------------------------------------- analysis (tests, tuning)
/** Spectral centroid (Hz) of a window of x from `t0` for `len` s (a naive DFT on a few bins: fine offline). */
export function centroid(x, t0 = 0, len = 0.05, sr = SR) {
  const s0 = Math.floor(t0 * sr), m = Math.min(x.length - s0, samples(len, sr));
  if (m <= 8) return 0;
  let num = 0, den = 0;
  for (let k = 1; k < 96; k++) {
    const f = (k * sr) / (2 * 96) * 0.9, w = (TAU * f) / sr;
    let re = 0, im = 0;
    for (let i = 0; i < m; i += 2) { const v = x[s0 + i] * (0.5 - 0.5 * Math.cos((TAU * i) / m)); re += v * Math.cos(w * i); im += v * Math.sin(w * i); }
    const mag = Math.hypot(re, im);
    num += f * mag; den += mag;
  }
  return den > 0 ? num / den : 0;
}
/** RMS of a window. */
export function rms(x, t0 = 0, len = 0.05, sr = SR) {
  const s0 = Math.floor(t0 * sr), m = Math.min(x.length - s0, samples(len, sr));
  let s = 0; for (let i = 0; i < m; i++) s += x[s0 + i] ** 2;
  return m > 0 ? Math.sqrt(s / m) : 0;
}
