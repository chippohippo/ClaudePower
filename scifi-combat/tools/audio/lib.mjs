// The asset build's toolkit: sound as { L, R } (Float32Array each, 48 kHz), read from the packs and
// written as Ogg through ffmpeg, everything in between in JS (src/audio/dsp.js). Deterministic.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as D from '../../src/audio/dsp.js';

export const SR = 48000;

// ---------------------------------------------------------------- buffers
export const st = (L, R = null) => ({ L, R: R ?? Float32Array.from(L) });
export const empty = (sec) => st(new Float32Array(D.samples(sec, SR)));
export const len = (b) => b.L.length / SR;
export const clone = (b) => ({ L: Float32Array.from(b.L), R: Float32Array.from(b.R) });
/** Both channels through fn(channel) -> channel (in place or new). */
export const each = (b, fn) => ({ L: fn(b.L, 0), R: fn(b.R, 1) });
const split = (x) => { const n = x.length >> 1, L = new Float32Array(n), R = new Float32Array(n); for (let i = 0; i < n; i++) { L[i] = x[2 * i]; R[i] = x[2 * i + 1]; } return { L, R }; };
const join2 = (b) => { const n = b.L.length, x = new Float32Array(2 * n); for (let i = 0; i < n; i++) { x[2 * i] = b.L[i]; x[2 * i + 1] = b.R[i]; } return x; };

let ROOT = '.';
export const packs = (dir) => { ROOT = dir; };
const cache = new Map();
/** A pack file (relative to the packs dir) as { L, R }. */
export function read(rel) {
  if (cache.has(rel)) return clone(cache.get(rel));
  const file = join(ROOT, rel);
  if (!existsSync(file)) throw new Error(`missing ${rel}`);
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '2', '-ar', String(SR), '-'], { maxBuffer: 1 << 30 });
  if (r.status) throw new Error(`ffmpeg read ${rel}: ${r.stderr}`);
  const b = split(new Float32Array(Uint8Array.from(r.stdout).buffer));
  cache.set(rel, b);
  return clone(b);
}
/** Through an ffmpeg audio filter chain. */
export function ff(b, chain) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-f', 'f32le', '-ar', String(SR), '-ac', '2', '-i', '-', '-af', chain, '-f', 'f32le', '-ac', '2', '-ar', String(SR), '-'], { input: Buffer.from(join2(b).buffer), maxBuffer: 1 << 30 });
  if (r.status) throw new Error(`ffmpeg ${chain}: ${r.stderr}`);
  return split(new Float32Array(Uint8Array.from(r.stdout).buffer));
}
/** Played k times faster (pitch and length together: a varispeed, a smaller or bigger gun). */
export const pitch = (b, k) => (Math.abs(k - 1) < 1e-4 ? clone(b) : ff(b, `asetrate=${Math.round(SR * k)},aresample=${SR}:resampler=soxr`));

export function cut(b, t0, t1 = len(b)) {
  const a = Math.max(0, Math.round(t0 * SR)), e = Math.min(b.L.length, Math.round(t1 * SR));
  return { L: b.L.slice(a, Math.max(a + 1, e)), R: b.R.slice(a, Math.max(a + 1, e)) };
}
/** Cosine fades in and out (s). */
export function fade(b, inSec = 0.001, outSec = 0.05) {
  const o = clone(b), n = o.L.length;
  const fi = Math.min(n, Math.round(inSec * SR)), fo = Math.min(n, Math.round(outSec * SR));
  for (let i = 0; i < fi; i++) { const g = 0.5 - 0.5 * Math.cos((Math.PI * i) / fi); o.L[i] *= g; o.R[i] *= g; }
  for (let i = 0; i < fo; i++) { const g = 0.5 - 0.5 * Math.cos((Math.PI * i) / fo), j = n - 1 - i; o.L[j] *= g; o.R[j] *= g; }
  return o;
}
export const gain = (b, db) => { const g = 10 ** (db / 20); return { L: b.L.map((v) => v * g), R: b.R.map((v) => v * g) }; };
/** `layer` mixed into `base` at `at` s, `db` loud (as long as both need). */
export function mix(base, layer, at = 0, db = 0) {
  const g = 10 ** (db / 20), off = Math.round(at * SR), n = Math.max(base.L.length, off + layer.L.length);
  const o = { L: new Float32Array(n), R: new Float32Array(n) };
  o.L.set(base.L); o.R.set(base.R);
  for (let i = 0; i < layer.L.length; i++) { const j = off + i; if (j >= 0 && j < n) { o.L[j] += layer.L[i] * g; o.R[j] += layer.R[i] * g; } }
  return o;
}
export const sum = (...layers) => layers.reduce((a, [b, at = 0, db = 0]) => mix(a, b, at, db), empty(0.001));
export const mono = (b) => { const m = b.L.map((v, i) => 0.5 * (v + b.R[i])); return st(m); };
export const peak = (b) => Math.max(D.peak(b.L), D.peak(b.R));
/** EQ both channels (dsp.eq bands). */
export const eq = (b, bands) => each(clone(b), (x) => D.eq(x, bands, SR));
export const sat = (b, drive, bias = 0) => each(clone(b), (x) => (bias ? D.warm(x, drive, bias) : D.saturate(x, drive)));
export const shape = (b, amount) => each(clone(b), (x) => D.transient(x, amount, SR));
/** Width: mid/side, side scaled by w (0 mono, 1 as is, >1 wider). */
export function width(b, w) {
  const o = clone(b);
  for (let i = 0; i < o.L.length; i++) { const m = 0.5 * (o.L[i] + o.R[i]), s = 0.5 * (o.L[i] - o.R[i]) * w; o.L[i] = m + s; o.R[i] = m - s; }
  return o;
}
/** Convolved with an impulse response [L, R] (wet only), cut to `sec`. */
export function convolve(b, [hL, hR], sec = null) {
  const L = D.convolve(b.L, hL), R = D.convolve(b.R, hR), n = sec ? Math.min(L.length, Math.round(sec * SR)) : L.length;
  return { L: L.subarray(0, n), R: R.subarray(0, n) };
}

/** Where each hit starts: the level (of the mid) jumping `jump` dB in 8 ms. */
export function onsets(b, { jump = 12, floor = -38, gap = 0.045 } = {}) {
  const hop = Math.round(SR * 0.002), env = [];
  for (let i = 0; i + hop < b.L.length; i += hop) { let s = 0; for (let k = 0; k < hop; k++) s += (0.5 * (b.L[i + k] + b.R[i + k])) ** 2; env.push(10 * Math.log10(s / hop + 1e-12)); }
  const out = [];
  for (let i = 4; i < env.length; i++) if (env[i] - env[i - 4] > jump && env[i] > floor && (!out.length || (i * hop) / SR - out.at(-1) > gap)) out.push(Math.max(0, ((i - 4) * hop) / SR));
  return out;
}
/** Trimmed to what's there: from just before the first sound to where it's died away (`db` under its peak). */
export function trim(b, db = -44) {
  const th = peak(b) * 10 ** (db / 20); let a = 0, e = b.L.length - 1;
  while (a < e && Math.abs(b.L[a]) < th && Math.abs(b.R[a]) < th) a++;
  while (e > a && Math.abs(b.L[e]) < th && Math.abs(b.R[e]) < th) e--;
  return cut(b, Math.max(0, a / SR - 0.003), (e + 1) / SR + 0.01);
}
/** At most `sec` long, faded out over the last `out` seconds. */
export const upto = (b, sec, out = Math.min(0.25, sec * 0.35)) => fade(cut(b, 0, Math.min(len(b), sec)), 0.001, out);

// ---------------------------------------------------------------- level
/** How hard a sound hits: the RMS of its loudest `win` s (what you hear of a shot is its punch), dBFS. */
export function punch(b, win = 0.05) {
  const n = b.L.length, w = Math.min(n, Math.max(1, Math.round(win * SR))), cs = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) cs[i + 1] = cs[i] + 0.5 * (b.L[i] ** 2 + b.R[i] ** 2);
  let best = 0;
  for (let a = 0; a + w <= n; a += 48) best = Math.max(best, cs[a + w] - cs[a]);
  return 10 * Math.log10(best / w + 1e-20);
}
/**
 * A lookahead limiter: peaks held under `ceil` (linear). The gain each sample needs, its minimum over
 * the next 1.5 ms, smoothed by a 1.5 ms box (so it's down exactly in time for the peak, without a
 * click), released over ~50 ms.
 */
export function limit(b, ceil = 0.89) {
  const o = clone(b), n = o.L.length, look = Math.max(1, Math.round(0.0015 * SR)), rel = 1 - Math.exp(-1 / (0.05 * SR));
  const need = new Float32Array(n), win = new Float32Array(n);
  for (let i = 0; i < n; i++) { const p = Math.max(Math.abs(o.L[i]), Math.abs(o.R[i])); need[i] = p > ceil ? ceil / p : 1; }
  for (let i = 0; i < n; i++) { let m = 1; for (let j = i; j < Math.min(n, i + look); j++) if (need[j] < m) m = need[j]; win[i] = m; }
  // (Before the start the gain is already where the first samples need it: a peak in the first 1.5 ms is held too.)
  let acc = look * (win[0] ?? 1), g = win[0] ?? 1;
  for (let i = 0; i < n; i++) {
    acc += win[i] - (i >= look ? win[i - look] : win[0]);
    const s = acc / look;
    g = s < g ? s : g + (s - g) * rel;
    o.L[i] *= g; o.R[i] *= g;
  }
  return o;
}
/** Levelled: its punch at `db` dBFS, peaks under -1 dBFS. */
export function level(b, db, win = 0.05) {
  const g = gain(b, db - punch(b, win));
  return peak(g) > 0.89 ? limit(g, 0.89) : g;
}

// ---------------------------------------------------------------- write
export function encode(b, file, { stereo = true, sr = SR, q = 4 } = {}) {
  mkdirSync(dirname(file), { recursive: true });
  const args = ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(SR), '-ac', '2', '-i', '-'];
  if (!stereo) args.push('-ac', '1');
  args.push('-ar', String(sr), '-c:a', 'libvorbis', '-q:a', String(q), file);
  const r = spawnSync('ffmpeg', args, { input: Buffer.from(join2(b).buffer), maxBuffer: 1 << 30 });
  if (r.status) throw new Error(`encode ${file}: ${r.stderr}`);
}
/** A 16-bit WAV (for looking at a sound while designing it). */
export function wav(b, file) {
  mkdirSync(dirname(file), { recursive: true });
  const n = b.L.length, buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVE', 8); buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) { buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(b.L[i] * 32767))), 44 + i * 4); buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(b.R[i] * 32767))), 46 + i * 4); }
  writeFileSync(file, buf);
}
