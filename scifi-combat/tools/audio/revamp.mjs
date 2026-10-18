#!/usr/bin/env node
// The Audio Revamp's build: the recorded sound packs cut, warped and mixed into the game's sounds,
// several takes of each so nothing repeats, and three distance versions of everything heard across
// the battlefield (near: the full crack; mid: the highs gone, the first echoes off the walls; far:
// a dull thud rolling back off the city), plus a first-person version of your own gun. Written as
// .ogg under audio/ with audio/manifest.json, which the game's SoundEngine loads; anything not in
// the manifest stays synthesized (SoundBank.js).
//
//   node tools/audio/revamp.mjs <packs dir> [out dir = audio]
//
// <packs dir> holds the packs extracted: Modern_Firearms_Military_Pack/, SciFi_Cyberpunk_SFX_Pack/,
// and the 400-sound packs' folders (Footsteps/, Weapons/, UI/, Materials/, Combat and Gore/, ...).
// Needs ffmpeg (with libvorbis) on the PATH. Deterministic: the same packs build the same files.

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, rmSync, statSync, mkdtempSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { impulse } from '../../src/audio/SoundEngine.js';

const SR = 44100;
const SRC = resolve(process.argv[2] ?? '.');
const OUT = resolve(process.argv[3] ?? 'audio');

// ---------------------------------------------------------------- buffers (stereo float, 44.1 kHz)
const cache = new Map();
/** A pack file as { L, R } (Float32Array each). */
function read(rel) {
  if (cache.has(rel)) return cache.get(rel);
  const file = join(SRC, rel);
  if (!existsSync(file)) throw new Error(`missing ${rel}`);
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '2', '-ar', String(SR), '-'], { maxBuffer: 1 << 30 });
  if (r.status) throw new Error(`ffmpeg read ${rel}: ${r.stderr}`);
  const b = split(new Float32Array(Uint8Array.from(r.stdout).buffer));
  cache.set(rel, b);
  return b;
}
const split = (x) => { const n = x.length >> 1, L = new Float32Array(n), R = new Float32Array(n); for (let i = 0; i < n; i++) { L[i] = x[2 * i]; R[i] = x[2 * i + 1]; } return { L, R }; };
const join2 = (b) => { const n = b.L.length, x = new Float32Array(2 * n); for (let i = 0; i < n; i++) { x[2 * i] = b.L[i]; x[2 * i + 1] = b.R[i]; } return x; };
const len = (b) => b.L.length / SR;
const empty = (sec) => ({ L: new Float32Array(Math.max(1, Math.round(sec * SR))), R: new Float32Array(Math.max(1, Math.round(sec * SR))) });

/** Run a buffer through an ffmpeg audio filter chain. */
function fx(b, chain, padSec = 0) {
  const af = (padSec ? `apad=pad_dur=${padSec},` : '') + chain;
  const r = spawnSync('ffmpeg', ['-v', 'error', '-f', 'f32le', '-ar', String(SR), '-ac', '2', '-i', '-', '-af', af, '-f', 'f32le', '-ac', '2', '-ar', String(SR), '-'], { input: Buffer.from(join2(b).buffer), maxBuffer: 1 << 30 });
  if (r.status) throw new Error(`ffmpeg ${chain}: ${r.stderr}`);
  return split(new Float32Array(Uint8Array.from(r.stdout).buffer));
}
/** Through a convolution reverb (an impulse response file), dry and wet gains, padded for the tail. */
function verb(b, ir, { dry = 1, wet = 0.5, pad = 1 } = {}) {
  const args = ['-v', 'error', '-f', 'f32le', '-ar', String(SR), '-ac', '2', '-i', '-', '-i', ir, '-filter_complex', `[0:a]apad=pad_dur=${pad}[a];[a][1:a]afir=dry=${dry}:wet=${wet}[o]`, '-map', '[o]', '-f', 'f32le', '-ac', '2', '-ar', String(SR), '-'];
  const r = spawnSync('ffmpeg', args, { input: Buffer.from(join2(b).buffer), maxBuffer: 1 << 30 });
  if (r.status) throw new Error(`ffmpeg afir: ${r.stderr}`);
  return split(new Float32Array(Uint8Array.from(r.stdout).buffer));
}
/** An impulse response written to a temp .wav: the game's own (SoundEngine.impulse), cut to `sec`. */
const TMP = mkdtempSync(join(tmpdir(), 'revamp-'));
function irFile(env, sec, name) {
  const [L, R] = impulse(env, SR), n = Math.min(L.length, Math.round(sec * SR)), fo = Math.round(0.15 * SR);
  const b = { L: L.slice(0, n), R: R.slice(0, n) };
  for (let i = 0; i < fo; i++) { const g = i / fo; b.L[n - 1 - i] *= g; b.R[n - 1 - i] *= g; }
  const file = join(TMP, `${name}.wav`);
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(SR), '-ac', '2', '-i', '-', '-c:a', 'pcm_f32le', file], { input: Buffer.from(join2(b).buffer) });
  if (r.status) throw new Error(`ir ${name}: ${r.stderr}`);
  return file;
}
const IR = { mid: irFile('city', 0.9, 'mid'), far: irFile('open', 2.2, 'far') };

/** Played k times faster (pitch and length together, like a varispeed: a bigger or smaller gun). */
const pitch = (b, k) => (Math.abs(k - 1) < 1e-3 ? b : fx(b, `asetrate=${Math.round(SR * k)},aresample=${SR}:resampler=soxr`));
function cut(b, t0, t1 = len(b)) {
  const a = Math.max(0, Math.round(t0 * SR)), e = Math.min(b.L.length, Math.round(t1 * SR));
  return { L: b.L.slice(a, Math.max(a + 1, e)), R: b.R.slice(a, Math.max(a + 1, e)) };
}
/** Cosine fades in and out. */
function fade(b, inSec = 0.002, outSec = 0.05) {
  const o = { L: b.L.slice(), R: b.R.slice() }, n = o.L.length;
  const fi = Math.min(n, Math.round(inSec * SR)), fo = Math.min(n, Math.round(outSec * SR));
  for (let i = 0; i < fi; i++) { const g = 0.5 - 0.5 * Math.cos((Math.PI * i) / fi); o.L[i] *= g; o.R[i] *= g; }
  for (let i = 0; i < fo; i++) { const g = 0.5 - 0.5 * Math.cos((Math.PI * i) / fo), j = n - 1 - i; o.L[j] *= g; o.R[j] *= g; }
  return o;
}
const gain = (b, db) => { const g = 10 ** (db / 20); return { L: b.L.map((v) => v * g), R: b.R.map((v) => v * g) }; };
/** layer mixed into base at `at` seconds, `db` loud (the result is as long as both need). */
function mix(base, layer, at = 0, db = 0) {
  const g = 10 ** (db / 20), off = Math.round(at * SR), n = Math.max(base.L.length, off + layer.L.length);
  const o = { L: new Float32Array(n), R: new Float32Array(n) };
  o.L.set(base.L); o.R.set(base.R);
  for (let i = 0; i < layer.L.length; i++) { const j = off + i; if (j >= 0 && j < n) { o.L[j] += layer.L[i] * g; o.R[j] += layer.R[i] * g; } }
  return o;
}
const mono = (b) => { const m = b.L.map((v, i) => 0.5 * (v + b.R[i])); return { L: m, R: m.slice() }; };
const peak = (b) => { let p = 0; for (let i = 0; i < b.L.length; i++) p = Math.max(p, Math.abs(b.L[i]), Math.abs(b.R[i])); return p; };
function rms(b, t0 = 0, t1 = len(b)) {
  const a = Math.max(0, Math.round(t0 * SR)), e = Math.min(b.L.length, Math.round(t1 * SR));
  let s = 0; for (let i = a; i < e; i++) s += 0.5 * (b.L[i] ** 2 + b.R[i] ** 2);
  return Math.sqrt(s / Math.max(1, e - a));
}
/** Where each hit starts: the level (of the mid, L+R) jumping `jump` dB in 8 ms (a shot, a step, a clank). */
function onsets(b, { jump = 12, floor = -38, gap = 0.045 } = {}) {
  const hop = Math.round(SR * 0.002), env = [];
  for (let i = 0; i + hop < b.L.length; i += hop) { let s = 0; for (let k = 0; k < hop; k++) s += (0.5 * (b.L[i + k] + b.R[i + k])) ** 2; env.push(10 * Math.log10(s / hop + 1e-12)); }
  const out = [];
  for (let i = 4; i < env.length; i++) if (env[i] - env[i - 4] > jump && env[i] > floor && (!out.length || (i * hop) / SR - out.at(-1) > gap)) out.push(Math.max(0, ((i - 4) * hop) / SR));
  return out;
}
/** Trimmed to what's there: from just before the first sound to where it's died away (`db` under its peak). */
function trim(b, db = -44) {
  const th = peak(b) * 10 ** (db / 20); let a = 0, e = b.L.length - 1;
  while (a < e && Math.abs(b.L[a]) < th && Math.abs(b.R[a]) < th) a++;
  while (e > a && Math.abs(b.L[e]) < th && Math.abs(b.R[e]) < th) e--;
  return cut(b, Math.max(0, a / SR - 0.003), (e + 1) / SR + 0.01);
}
/** At most `sec` long, faded out over the last `out` seconds. */
const upto = (b, sec, out = Math.min(0.25, sec * 0.35)) => fade(cut(b, 0, Math.min(len(b), sec)), 0.002, out);

// ---------------------------------------------------------------- distance versions
// near: the source, cleaned up. mid (~40-120 m): the highs gone, the transient rounded, the first
// echoes off the street's walls. far (120 m+): a dull thud with the city rolling it back.
// 1p: your own gun, stereo, a little more weight.
const TIER = {
  near: (b) => mono(fx(b, 'highpass=f=35')),
  mid: (b) => mono(verb(fx(b, 'highpass=f=45,lowpass=f=5200,treble=g=-4:f=2800,acompressor=threshold=0.3:ratio=2.5:attack=6:release=140'), IR.mid, { dry: 1, wet: 0.45, pad: 0.9 })),
  far: (b) => mono(verb(fx(b, 'highpass=f=40,lowpass=f=1500,bass=g=4:f=110,acompressor=threshold=0.25:ratio=2:attack=25:release=300'), IR.far, { dry: 0.45, wet: 1, pad: 2.2 })),
  '1p': (b) => fx(b, 'highpass=f=30,bass=g=2:f=90,treble=g=1:f=6000'),
};

// ---------------------------------------------------------------- the recipes
const M = (n) => `Modern_Firearms_Military_Pack/${n}.wav`;
const F = (n) => `SciFi_Cyberpunk_SFX_Pack/${n}.wav`;
const V3 = (f) => [1, 2, 3].map((i) => f(`0${i}`));
const G = (dir, n) => `${dir}/${n}.wav`;

/** A recording's single hits: [start, end] each, the next hit cutting the one before. */
function hits(b, max = 0.11, o = {}) {
  const on = onsets(b, o);
  return on.map((t, i) => [Math.max(0, t - 0.003), Math.min(t + max, (on[i + 1] ?? len(b)) - 0.004)]);
}
// Shot tails: the long decays after single shots (the street ringing), to hang after a cut punch.
const TAILS = () => [
  fx(fade(cut(read(M('Gun_Sniper_Rifle_Heavy_var03')), 0.12, 1.1), 0.03, 0.4), 'lowpass=f=5000'),
  fx(fade(cut(read(M('Gun_Pistol_9mm_Shot_var01')), 0.1, 0.9), 0.03, 0.35), 'lowpass=f=4500'),
  fx(fade(cut(read(M('Gun_Sniper_Rifle_Heavy_var02')), 0.09, 0.95), 0.03, 0.35), 'lowpass=f=4800'),
];
/** A punch with a tail hung after it. */
const withTail = (punch, tail, db, sec) => fade(mix(punch, upto(tail, sec), len(punch) - 0.03, db), 0.001, 0.08);

/** The assault rifle's single shots, from the burst recordings (clean, distinct ones). */
function arShots() {
  const out = [];
  for (const v of ['03', '02']) {
    const b = read(M(`Gun_Assault_Rifle_Burst_var${v}`));
    const hs = hits(b, 0.1, { jump: 6, gap: 0.05 }).filter(([a, e]) => e - a > 0.045 && a > 0.15 && a < len(b) - 0.4);
    for (let i = 1; i < hs.length && out.length < (v === '03' ? 8 : 12); i += 2) out.push(fade(cut(b, ...hs[i]), 0.001, 0.02));
  }
  return out;
}
/** One shot from a single-shot recording: from its onset, `sec` long. */
function single(rel, sec, out) { const b = read(rel), t = onsets(b)[0] ?? 0; return upto(cut(b, Math.max(0, t - 0.004)), sec, out); }

const faction = {
  sol: (b) => fx(b, 'treble=g=2:f=5000'),
  void: (b) => fx(b, 'bass=g=3:f=100,treble=g=-3:f=4500'),
};

const R = {};          // id -> { kind: 'world' (near/mid/far, 1p for guns) | 'near' | 'ui', takes: [buffers], gain }
const add = (id, kind, takes) => { R[id] = { kind, takes }; };

function guns() {
  const tails = TAILS(), shots = arShots();
  const T = (i) => tails[i % tails.length];
  // Rifles: the burst's punches with a tail; Solari bright, Void lower and darker; the battle rifle heavier.
  add('gun:ar_sol', 'gun', shots.slice(0, 8).map((s, i) => faction.sol(withTail(s, T(i), -13, 0.55))));
  add('gun:ar_void', 'gun', shots.slice(4, 12).map((s, i) => faction.void(withTail(pitch(s, 0.88), T(i + 1), -12, 0.6))));
  add('gun:br_sol', 'gun', shots.slice(8, 14).map((s, i) => fx(withTail(pitch(s, 0.93), T(i + 2), -10, 0.85), 'bass=g=2:f=95,treble=g=1:f=5000')));
  add('gun:hmg', 'gun', shots.slice(2, 8).map((s, i) => fx(withTail(pitch(s, 0.8), T(i), -10, 0.7), 'bass=g=4:f=90')));
  // SMGs: the pistol's crack, cut short (they fire fast), a short tail.
  const pistol = V3((v) => single(M(`Gun_Pistol_9mm_Shot_var${v}`), 0.09, 0.02));
  add('gun:smg_sol', 'gun', [1.0, 1.07].flatMap((k, j) => pistol.map((p, i) => faction.sol(withTail(pitch(p, k), T(i + j), -16, 0.32)))));
  add('gun:smg_void', 'gun', [0.9, 0.95].flatMap((k, j) => pistol.map((p, i) => faction.void(withTail(pitch(p, k), T(i + j), -15, 0.36)))));
  // Shotguns: the blast and its roll (before the action), two pitches each.
  const sg = V3((v) => single(M(`Gun_Shotgun_Blast_Pump_var${v}`), 0.7, 0.3));
  add('gun:sg_sol', 'gun', [1.0, 0.95].flatMap((k) => sg.map((b) => faction.sol(pitch(b, k)))));
  add('gun:sg_void', 'gun', [0.86, 0.9].flatMap((k) => sg.map((b) => faction.void(pitch(b, k)))));
  // Snipers: the heavy rifle's report and its long ring.
  const sr = V3((v) => single(M(`Gun_Sniper_Rifle_Heavy_var${v}`), 1.5, 0.55));
  add('gun:sr_sol', 'gun', [1.0, 1.04].flatMap((k) => sr.map((b) => faction.sol(pitch(b, k)))));
  add('gun:sr_void', 'gun', [0.88, 0.92].flatMap((k) => sr.map((b) => faction.void(pitch(b, k)))));
  // Autocannon: the sniper's report a lot bigger. Tank cannon: a grenade's blast under a cannon's crack.
  add('gun:autocannon', 'gun', sr.flatMap((b, i) => [0.72, 0.76].map((k) => fx(upto(pitch(b, k), 1.1), 'bass=g=4:f=80'))));
  const frag = V3((v) => single(M(`Tactical_Frag_Grenade_Explode_var${v}`), 2.2, 0.8));
  add('gun:cannon', 'gun', frag.map((b, i) => fx(mix(pitch(b, 0.8), upto(pitch(sr[i], 0.6), 0.7), 0, -4), 'bass=g=3:f=70')));
  // Suppressed: the silenced shots.
  const supp = V3((v) => single(M(`Gun_Silenced_Suppressed_var${v}`), 0.5, 0.2));
  add('gun:supp', 'gun', [1.0, 1.06].flatMap((k) => supp.map((b) => pitch(b, k))));
  // Energy weapons: the blaster's zap with its warble cut short for rapid fire; lances and rails from the railgun.
  const plasma = V3((v) => single(F(`Weapon_Plasma_Blaster_var${v}`), 1.4, 0.4));
  add('laser:pulse_sol', 'gun', [1.05, 1.12].flatMap((k) => plasma.map((b) => faction.sol(upto(pitch(b, k), 0.3, 0.17)))));
  add('laser:pulse_void', 'gun', [0.8, 0.86].flatMap((k) => plasma.map((b) => faction.void(upto(pitch(b, k), 0.36, 0.2)))));
  add('laser:light_sol', 'gun', [1.3, 1.36].flatMap((k) => plasma.map((b) => upto(pitch(b, k), 0.3, 0.12))));
  add('laser:light_void', 'gun', [1.02, 1.08].flatMap((k) => plasma.map((b) => faction.void(upto(pitch(b, k), 0.34, 0.14)))));
  add('laser:plasma_sol', 'gun', plasma.map((b) => fx(upto(pitch(b, 0.72), 1.5, 0.5), 'bass=g=3:f=90')));
  const rail = V3((v) => single(F(`Weapon_Railgun_Fire_var${v}`), 2.2, 0.7));
  add('laser:lance_sol', 'gun', rail.map((b) => faction.sol(upto(pitch(b, 1.08), 1.2, 0.45))));
  add('laser:lance_void', 'gun', rail.map((b) => faction.void(upto(pitch(b, 0.85), 1.4, 0.5))));
  add('laser:rail_sol', 'gun', rail.map((b) => upto(b, 2.0, 0.7)));
}

function booms() {
  const frag = V3((v) => single(M(`Tactical_Frag_Grenade_Explode_var${v}`), 2.6, 0.9));
  const thud = trim(read(G('Weapons', 'harsh_thud')));
  add('boom:grenade', 'boom', [1.0, 0.94].flatMap((k) => frag.map((b) => pitch(b, k))));
  add('boom:vehicle', 'boom', frag.map((b) => fx(mix(pitch(b, 0.88), pitch(thud, 0.85), 0, -6), 'bass=g=3:f=80')));
  add('boom:shell', 'boom', frag.map((b) => fx(mix(pitch(b, 0.74), pitch(thud, 0.7), 0, -3), 'bass=g=5:f=70')));
  add('boom:bomb', 'boom', frag.map((b) => fx(mix(pitch(b, 0.62), pitch(thud, 0.6), 0, -2), 'bass=g=6:f=60')));
  add('boom:emp', 'boom', V3((v) => fx(single(F(`Weapon_EMP_Explosion_var${v}`), 1.4, 0.7), 'lowpass=f=9000')));
}

function foley() {
  const T = (rel, sec) => upto(trim(read(rel), -30), sec);
  add('mech:magout', 'near', V3((v) => T(M(`Foley_Mag_Eject_Empty_var${v}`), 0.7)));
  add('mech:magin', 'near', V3((v) => T(M(`Foley_Mag_Insert_Lock_var${v}`), 0.8)));
  add('mech:bolt', 'near', V3((v) => T(M(`Foley_Bolt_Cock_Pull_var${v}`), 1.0)));
  add('mech:pump', 'near', V3((v) => pitch(T(M(`Foley_Bolt_Cock_Pull_var${v}`), 0.9), 0.84)));
  add('mech:swap', 'near', ['weapon_equip', 'weapon_equip_short', 'weapon_unequip'].map((n) => T(G('Weapons', n), 0.7)));
  add('mech:dry', 'near', ['click_double_off', 'click_double_off_2', 'toggle_off'].map((n) => T(G('UI', n), 0.25)));
  add('mech:vent', 'near', V3((v) => T(F(`Weapon_Energy_Reload_var${v}`), 1.3)));
  add('mech:overheat', 'near', V3((v) => T(F(`SciFi_Hologram_Flicker_var${v}`), 1.0)));
  const shell = V3((v) => upto(trim(read(M(`Foley_Bullet_Shell_Drop_var${v}`))), 0.5, 0.2));
  add('brass:hard', 'near', shell);
  add('brass:dirt', 'near', shell.map((b) => gain(fx(b, 'lowpass=f=1800'), -6)));
  add('brass:snow', 'near', shell.map((b) => gain(fx(b, 'lowpass=f=700'), -12)));
  add('cloth', 'near', [...['clothing_1', 'clothing_2'].map((n) => T(G('Materials', n), 0.8)), pitch(T(G('Materials', 'clothing_1'), 0.8), 1.1)]);
  add('body:heavy', 'near', [1.0, 0.9, 0.82].map((k) => fx(mix(T(G('Materials', 'clothing_thud'), 0.6), pitch(trim(read(G('Weapons', 'harsh_thud'))), k * 0.8), 0, -6), 'lowpass=f=4000')));
  add('body:slide', 'near', [1.0, 0.9, 1.12].map((k) => pitch(T(G('Materials', 'concrete_scrape'), 1.0), k)));
  add('dig', 'near', [1.0, 0.92, 1.08].map((k) => pitch(T(G('Items', 'shovel_dig'), 1.2), k)));
}

function footsteps() {
  const T = (rel) => upto(trim(read(rel), -50), 0.45, 0.12);
  const four = (f) => [1, 2, 3, 4].map(f);
  add('foot:concrete', 'near', four((i) => T(G('Footsteps', `foley_footstep_concrete_${i}`))));
  add('foot:dirt', 'near', [...four((i) => T(G('Footsteps', `foley_footstep_gravel_${i}`))), ...four((i) => T(G('Footsteps/digital', `digital_footstep_gravel_${i}`)))]);
  add('foot:snow', 'near', four((i) => T(G('Footsteps/digital', `digital_footstep_snow_${i}`))));
  add('foot:wood', 'near', four((i) => T(G('Footsteps/digital', `digital_footstep_wood_${i}`))));
  const tap = trim(read(G('Materials', 'metal_blunt_tap')));
  add('foot:metal', 'near', four((i) => mix(T(G('Footsteps', `foley_footstep_vinyl_${i}`)), upto(pitch(tap, 1.2 + i * 0.05), 0.3), 0.004, -16)));
}

function impacts() {
  const T = (rel, sec) => upto(trim(read(rel)), sec);
  add('impact:metal', 'near', [T(G('Materials', 'metal_clang'), 0.6), T(G('Materials', 'metal_blunt_tap'), 0.5), pitch(T(G('Materials', 'metal_clang'), 0.6), 1.2), pitch(T(G('Materials', 'pottery_clang'), 0.5), 0.9)]);
  add('impact:vehicle', 'near', [0.7, 0.78, 0.86].map((k) => pitch(T(G('Materials', 'metal_clang'), 0.7), k)));
  add('impact:wood', 'near', [T(G('Materials', 'wood_small_drop'), 0.4), T(G('Materials', 'wood_small_hollow'), 0.4), T(G('Materials', 'bamboo_drop'), 0.4)]);
  add('impact:flesh', 'near', ['splat_quick', 'splat_double_quick', 'crunch_splat', 'crunch_splat_2', 'squelching_1'].map((n) => T(G('Combat and Gore', n), 0.35)));
}

function melee() {
  const T = (rel, sec) => upto(trim(read(rel)), sec);
  add('melee:swing', 'near', [T(G('Combat and Gore', 'swipe'), 0.5), T(G('Weapons', 'sword_light'), 0.5), pitch(T(G('Combat and Gore', 'swipe'), 0.5), 1.15)]);
  add('melee:hit', 'near', [...['punch', 'punch_2', 'punch_3', 'kick'].map((n) => T(G('Combat and Gore', n), 0.45)), ...V3((v) => T(M(`Tactical_Knife_Stab_Slash_var${v}`), 0.5))]);
  add('melee:block', 'near', [T(G('Weapons', 'sword_clash'), 0.8), T(G('Weapons', 'sword_clash_2'), 0.8), pitch(T(G('Weapons', 'sword_clash'), 0.8), 0.92)]);
  add('melee:parry', 'near', [1.15, 1.22, 1.3].map((k) => pitch(T(G('Weapons', 'sword_clash_2'), 0.8), k)));
  add('melee:deflect', 'near', [1.3, 1.4, 1.5].map((k) => pitch(T(G('Weapons', 'sword_clash'), 0.6), k)));
  add('melee:guardbreak', 'near', [0.9, 1.0, 1.1].map((k) => mix(pitch(T(G('Combat and Gore', 'bone_snap'), 0.6), k), T(G('Weapons', 'harsh_thud'), 0.6), 0, -4)));
}

function ui() {
  const T = (rel, sec = 1.5) => upto(trim(read(rel)), sec);
  const U = (n, sec) => T(G('UI', n), sec);
  add('ui:hit', 'ui', [1, 2, 3, 4].map((i) => pitch(U(`pop_${i}`, 0.2), 1.25)));
  add('ui:hit_head', 'ui', [1.0, 1.06, 1.12].map((k) => pitch(U('sci_fi_hover_high', 0.3), k)));
  add('ui:hit_kill', 'ui', [1.0, 1.04, 0.96].map((k) => pitch(U('sci_fi_select', 0.45), k)));
  add('ui:hit_plink', 'ui', [1.3, 1.4, 1.5].map((k) => gain(pitch(U('click_double_off', 0.2), k), -4)));
  add('ui:hit_shieldbreak', 'ui', [1.0, 1.08, 0.94].map((k) => pitch(U('sci_fi_deselect', 0.5), k)));
  add('ui:hit_friendly', 'ui', [1.0, 1.05, 0.95].map((k) => pitch(U('sci_fi_disallow', 0.5), k)));
  add('ui:ability_hit', 'ui', [1.1, 1.18, 1.26].map((k) => pitch(U('sci_fi_select', 0.35), k)));
  add('ui:open', 'ui', V3((v) => T(F(`SciFi_UI_Beep_Select_var${v}`), 0.6)));
  // The call-in code: one beep rising a whole tone per arrow typed.
  const beep = T(F('SciFi_UI_Beep_Select_var03'), 0.4);
  for (let k = 1; k <= 10; k++) add(`arrow:${k}`, 'ui', [pitch(beep, 2 ** ((2 * (k - 1)) / 12))]);
  add('ui:error', 'ui', [U('sci_fi_error', 0.6), ...V3((v) => T(F(`SciFi_UI_Error_Denied_var${v}`), 0.6)).slice(0, 2)]);
  add('ui:denied', 'ui', [U('sci_fi_disallow', 0.5), U('synth_error', 0.5), T(F('SciFi_UI_Error_Denied_var03'), 0.6)]);
  add('ui:armed', 'ui', V3((v) => T(F(`SciFi_UI_Confirm_Access_var${v}`), 1.2)));
  add('ui:beacon', 'ui', V3((v) => upto(T(F(`SciFi_UI_Data_Scanning_var${v}`), 2.5), 0.9, 0.3)));
  add('ui:beep', 'ui', [1.0, 1.04, 0.97].map((k) => pitch(U('sci_fi_hover', 0.3), k)));
  add('ui:throw', 'ui', [0.9, 1.0, 1.1].map((k) => pitch(T(G('Combat and Gore', 'swipe'), 0.5), k)));
  add('ui:grab', 'ui', [T(G('Weapons', 'weapon_pick_up'), 0.8), T(G('Items', 'item_equip'), 0.8), pitch(T(G('Weapons', 'weapon_pick_up'), 0.8), 1.08)]);
  add('ui:stim', 'ui', [1.0, 1.06, 0.95].map((k) => mix(pitch(T(G('Environment', 'air_burst'), 0.7), k), T(G('Items', 'item_equip'), 0.6), 0.12, -6)));
  add('ui:repair', 'ui', [T(G('Machines', 'hydraulic_up'), 1.0), T(G('Machines', 'hydraulic_down'), 1.0), pitch(T(G('Machines', 'hydraulic_up'), 1.0), 1.1)]);
  add('ui:bp', 'ui', [1, 2, 3, 4].map((i) => U(`select_${i}`, 0.4)));
  add('ui:buy', 'ui', [U('synth_confirmation', 1.0), pitch(U('synth_confirmation', 1.0), 1.06), U('sci_fi_confirm', 0.8)]);
  add('ui:ready', 'ui', [U('synth_process_complete', 1.0), pitch(U('synth_process_complete', 1.0), 1.06), U('sci_fi_select_big', 0.8)]);
  add('ui:super_ready', 'ui', V3((v) => T(F(`SciFi_Power_Core_Boot_var${v}`), 2.0)));
  add('ui:hero', 'ui', [T(G('Musical Effects', 'brass_level_start'), 3.0)]);
  add('ui:smoke', 'near', V3((v) => T(M(`Tactical_Smoke_Grenade_Hiss_var${v}`), 2.8)));
  add('ui:revive', 'ui', [U('sci_fi_confirm', 0.8), pitch(U('sci_fi_confirm', 0.8), 1.06), pitch(U('sci_fi_confirm', 0.8), 0.95)]);
  add('ui:revived', 'ui', [U('synth_process_complete', 1.2), pitch(U('synth_process_complete', 1.2), 1.05), pitch(U('synth_process_complete', 1.2), 0.96)]);
  add('ui:down', 'ui', [U('synth_shut_down', 1.5), pitch(U('synth_shut_down', 1.5), 0.95), pitch(U('synth_shut_down', 1.5), 1.05)]);
  add('ui:empty', 'ui', [U('click_double_off', 0.25), U('click_double_off_2', 0.25), pitch(U('click_double_off', 0.25), 0.9)]);
  // The stratagem pod's doors coming open, and the end of the match.
  add('pod:open', 'near', [...V3((v) => T(F(`SciFi_Door_Hydraulic_Open_var${v}`), 1.8)), T(G('Machines', 'industrial_door_open'), 2.0)]);
  add('music:victory', 'ui', [T(G('Musical Effects', 'brass_level_complete'), 6)]);
  add('music:defeat', 'ui', [T(G('Musical Effects', 'brass_defeated'), 6)]);
}

// ---------------------------------------------------------------- level, write, manifest
/** How loud a take hits: the RMS of its loudest 150 ms (what you hear of a shot is its punch). */
function punch(b) {
  const n = b.L.length, w = Math.min(n, Math.round(0.15 * SR)), cs = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) cs[i + 1] = cs[i] + 0.5 * (b.L[i] ** 2 + b.R[i] ** 2);
  let best = 0;
  for (let a = 0; a + w <= n; a += 220) best = Math.max(best, cs[a + w] - cs[a]);
  return Math.sqrt(best / Math.max(1, w)) || 1e-6;
}
/** The punch each kind of sound is levelled to (dBFS RMS); the game's mix sets them against each other from there. */
function targetFor(id, kind) {
  if (kind === 'gun') return -10;
  if (kind === 'boom') return -8;
  const P = [['foot:', -19], ['brass:', -21], ['mech:', -17], ['cloth', -18], ['body:', -17], ['impact:', -16], ['melee:', -14], ['arrow:', -18], ['music:', -15], ['pod:', -15], ['dig', -17], ['ui:', -17]];
  return (P.find(([p]) => id.startsWith(p)) ?? [null, -17])[1];
}
/** Every take of a sound hitting as hard as the others at the kind's level, peaks held under -1 dBFS. */
function levelled(takes, db) {
  const t = 10 ** (db / 20);
  return takes.map((b) => {
    const g = gain(b, 20 * Math.log10(t / punch(b)));
    return peak(g) > 0.89 ? fx(g, 'alimiter=limit=0.89:attack=1:release=60:level=false:latency=true') : g;
  });
}
function encode(b, file, { stereo = false, sr = SR, q = 4 } = {}) {
  mkdirSync(dirname(file), { recursive: true });
  const args = ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(SR), '-ac', '2', '-i', '-'];
  if (!stereo) args.push('-ac', '1');
  args.push('-ar', String(sr), '-c:a', 'libvorbis', '-q:a', String(q), file);
  const r = spawnSync('ffmpeg', args, { input: Buffer.from(join2(b).buffer), maxBuffer: 1 << 30 });
  if (r.status) throw new Error(`encode ${file}: ${r.stderr}`);
}

const t0 = Date.now();
guns(); booms(); foley(); footsteps(); impacts(); melee(); ui();
if (existsSync(OUT)) rmSync(OUT, { recursive: true });
const manifest = { version: 1, note: 'Built by tools/audio/revamp.mjs from the recorded packs (the Audio Revamp).', sounds: {} };
let files = 0, bytes = 0;
for (const [id, { kind, takes }] of Object.entries(R)) {
  const tiers = kind === 'gun' ? ['near', 'mid', 'far', '1p'] : kind === 'boom' ? ['near', 'mid', 'far'] : kind === 'near' ? ['near'] : ['ui'];
  const entry = { kind, tiers: {} };
  for (const tier of tiers) {
    // Far off, a few takes do (it's a blur by then), and the tails are cut where they've died away.
    const make = TIER[tier] ?? ((b) => b), few = tier === 'far' ? 3 : tier === 'mid' ? 4 : takes.length;
    const cap = tier === 'far' ? (kind === 'boom' ? 3.6 : 2.6) : tier === 'mid' ? (kind === 'boom' ? 2.8 : 1.6) : Infinity;
    const list = levelled(takes.slice(0, few).map((b) => { const t = make(b); return len(t) > cap ? upto(t, cap, Math.min(0.8, cap * 0.4)) : t; }), targetFor(id, kind));
    entry.tiers[tier] = list.map((b, i) => {
      const rel = `${id.replace(/:/g, '/')}/${tier}-${i + 1}.ogg`, file = join(OUT, rel);
      encode(b, file, { stereo: tier === '1p' || tier === 'ui', sr: tier === 'far' ? 22050 : tier === 'mid' ? 32000 : SR, q: tier === 'far' ? 2 : tier === 'mid' ? 3 : 4 });
      files++; bytes += statSync(file).size;
      return rel;
    });
  }
  manifest.sounds[id] = entry;
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
rmSync(TMP, { recursive: true });
console.log(`${Object.keys(R).length} sounds, ${files} files, ${(bytes / 1048576).toFixed(1)} MB in ${((Date.now() - t0) / 1000).toFixed(0)} s -> ${OUT}`);
