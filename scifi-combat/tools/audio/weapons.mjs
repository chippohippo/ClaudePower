// The guns, designed in layers the way a game's weapons are: the engine plays every shot as a
// stack of them, each take dealt from its own deck at its own pitch, mixed by distance, so no two
// shots are alike and each holds together from your own hands out to a dull thud at 500 m.
//
//   crack  the first ms: the muzzle's blast wave, the ground answering, the supersonic snap; a
//          blaster's discharge. Bright: it's what tells you a gun just went off, and it's the first
//          thing distance takes.
//   body   the shot itself: the gas roaring out (recorded shots, varispeeded per gun), the receiver
//          ringing, the faction's colour: Solari bright and hard, Void dark and growling; a
//          blaster's "pew" (a click through a dispersive chain: the slinky, the spring).
//   low    the punch you feel: a sine dropping an octave and more, saturated so its harmonics carry
//          on small speakers, and a thump of low noise. The heavier the gun, the deeper and longer.
//   mech   the machine: the bolt (or the coil) cycling, the capacitor's tick, a heat sink's breath.
//          Close up only (and loud in your own hands).
//   far    by class, not by gun: what's left of a shot from 150 m on: the pop and the thump, dull;
//          the room (Acoustics.js) rolls it back at runtime.
//
// Every layer has its takes (6 to 10), all levelled to the same punch; the manifest's `mix` sets
// each gun's balance between them.

import * as D from '../../src/audio/dsp.js';
import * as B from './lib.mjs';

const SR = B.SR;
const M = (n) => `Modern_Firearms_Military_Pack/${n}.wav`;
const F = (n) => `SciFi_Cyberpunk_SFX_Pack/${n}.wav`;
const V3 = (f) => [1, 2, 3].map((i) => f(`0${i}`));
const jit = (r, x, k = 0.06) => x * (1 + (r() * 2 - 1) * k);
const mono = (x) => B.st(x);

// ---------------------------------------------------------------- the guns
/**
 * kind: kinetic | energy. cls: the far class. size: the body's varispeed (< 1: bigger, lower).
 * body: [source, weight] recordings; synth: the synthesized body's [lowpass Hz, decay s, resonances [[Hz, dB]]].
 * low: [Hz from, Hz to, decay s, warmth]; crack: [blast positive phase s, supersonic snap 0..1];
 * mech: the action ('rifle' | 'smg' | 'heavy' | 'pump' | 'bolt' | 'breech' | 'coil' | 'emitter' | 'rail' | 'none');
 * faction: 'sol' (bright, a coil's zap) | 'void' (dark, a growl) | null.
 * mix: each layer's level at runtime (dB) and the first-person extras.
 */
export const GUNS = {
  ar_sol: { kind: 'kinetic', cls: 'rifle', faction: 'sol', size: 1.0, body: [['ar', 1], ['pistol', 0.5]], synth: [2600, 0.045, [[420, 3], [1150, 2]]], low: [100, 48, 0.07, 0.25], crack: [0.0011, 0.5], mech: 'rifle', mix: { crack: -4, body: 0, low: -3, mech: -9 } },
  br_sol: { kind: 'kinetic', cls: 'heavy', faction: 'sol', size: 0.92, body: [['ar', 1], ['sniper', 0.6]], synth: [2200, 0.06, [[360, 3], [980, 2]]], low: [92, 42, 0.095, 0.3], crack: [0.0014, 0.7], mech: 'bolt', mix: { crack: -3, body: 0, low: -2, mech: -8 } },
  ar_void: { kind: 'kinetic', cls: 'rifle', faction: 'void', size: 0.88, body: [['ar', 1], ['pistol', 0.4]], synth: [1900, 0.055, [[310, 4], [820, 2]]], low: [88, 40, 0.085, 0.35], crack: [0.0013, 0.4], mech: 'rifle', mix: { crack: -5, body: 0, low: -2, mech: -9 } },
  smg_sol: { kind: 'kinetic', cls: 'light', faction: 'sol', size: 1.06, body: [['pistol', 1], ['ar', 0.4]], synth: [3200, 0.03, [[520, 3], [1500, 2]]], low: [120, 60, 0.045, 0.2], crack: [0.0008, 0.2], mech: 'smg', mix: { crack: -4, body: 0, low: -5, mech: -10 } },
  smg_void: { kind: 'kinetic', cls: 'light', faction: 'void', size: 0.94, body: [['pistol', 1], ['ar', 0.4]], synth: [2600, 0.035, [[400, 4], [1100, 2]]], low: [110, 52, 0.05, 0.3], crack: [0.0009, 0.15], mech: 'smg', mix: { crack: -5, body: 0, low: -4, mech: -10 } },
  sg_sol: { kind: 'kinetic', cls: 'shotgun', faction: 'sol', size: 1.0, body: [['shotgun', 1]], synth: [1800, 0.09, [[240, 4], [700, 2]]], low: [80, 34, 0.14, 0.35], crack: [0.0022, 0], mech: 'pump', mix: { crack: -2, body: 0, low: -1, mech: -10 } },
  sg_void: { kind: 'kinetic', cls: 'shotgun', faction: 'void', size: 0.88, body: [['shotgun', 1]], synth: [1500, 0.1, [[200, 5], [600, 2]]], low: [74, 30, 0.16, 0.4], crack: [0.0024, 0], mech: 'pump', mix: { crack: -2, body: 0, low: 0, mech: -10 } },
  sr_sol: { kind: 'kinetic', cls: 'sniper', faction: 'sol', size: 1.0, body: [['sniper', 1]], synth: [2400, 0.08, [[300, 3], [900, 2]]], low: [86, 32, 0.16, 0.35], crack: [0.0016, 1], mech: 'bolt', mix: { crack: 1, body: 0, low: -1, mech: -9 } },
  sr_void: { kind: 'kinetic', cls: 'sniper', faction: 'void', size: 0.9, body: [['sniper', 1]], synth: [2000, 0.09, [[260, 4], [760, 2]]], low: [80, 28, 0.18, 0.4], crack: [0.0017, 1], mech: 'bolt', mix: { crack: 1, body: 0, low: 0, mech: -9 } },
  hmg: { kind: 'kinetic', cls: 'heavy', faction: null, size: 0.8, body: [['ar', 1], ['thud', 0.5]], synth: [1700, 0.07, [[260, 4], [640, 2]]], low: [84, 36, 0.11, 0.35], crack: [0.0016, 0.6], mech: 'heavy', mix: { crack: -3, body: 0, low: -1, mech: -7 } },
  autocannon: { kind: 'kinetic', cls: 'cannon', faction: null, size: 0.72, body: [['sniper', 1], ['shotgun', 0.6]], synth: [1300, 0.12, [[180, 5], [460, 3]]], low: [66, 26, 0.22, 0.45], crack: [0.0035, 0.5], mech: 'breech', mix: { crack: -3, body: 0, low: 0, mech: -6 } },
  cannon: { kind: 'kinetic', cls: 'cannon', faction: null, size: 0.6, body: [['frag', 1], ['sniper', 0.5]], synth: [900, 0.25, [[120, 5], [320, 3]]], low: [52, 20, 0.45, 0.5], crack: [0.007, 0.3], mech: 'breech', mix: { crack: -2, body: 0, low: 1, mech: -6 } },
  supp: { kind: 'kinetic', cls: 'quiet', faction: null, size: 1.0, body: [['supp', 1]], synth: [1600, 0.03, [[500, 3]]], low: [110, 60, 0.04, 0.2], crack: [0.0007, 0], mech: 'rifle', mix: { crack: -14, body: 0, low: -8, mech: -4 } },
  // Energy: hard light (Solari) and plasma (Void). pew: [stages, coefficient, brightness Hz] of the dispersive
  // chirp (400 stages at -0.89: down through 1 kHz at 60 ms, 500 Hz at 110).
  pulse_sol: { kind: 'energy', cls: 'rifle', faction: 'sol', size: 1.05, body: [['plasma', 0.12]], pew: [400, -0.89, 2600], low: [104, 46, 0.075, 0.3], crack: [0.0008, 0], mech: 'emitter', mix: { crack: -2, body: 0, low: -7, mech: -10 } },
  pulse_void: { kind: 'energy', cls: 'rifle', faction: 'void', size: 0.82, body: [['plasma', 0.35]], pew: [600, -0.91, 1300], low: [90, 38, 0.09, 0.4], crack: [0.001, 0], mech: 'emitter', mix: { crack: -6, body: 0, low: -6, mech: -10 } },
  light_sol: { kind: 'energy', cls: 'heavy', faction: 'sol', size: 1.2, body: [['plasma', 0.12]], pew: [340, -0.88, 3000], low: [112, 54, 0.06, 0.25], crack: [0.0007, 0], mech: 'emitter', mix: { crack: -3, body: 0, low: -8, mech: -11 } },
  light_void: { kind: 'energy', cls: 'heavy', faction: 'void', size: 1.0, body: [['plasma', 0.35]], pew: [520, -0.9, 1500], low: [96, 42, 0.08, 0.35], crack: [0.0009, 0], mech: 'emitter', mix: { crack: -6, body: 0, low: -7, mech: -11 } },
  plasma_sol: { kind: 'energy', cls: 'shotgun', faction: 'sol', size: 0.72, body: [['plasma', 0.5]], pew: [900, -0.93, 1200], low: [70, 26, 0.3, 0.45], crack: [0.003, 0], mech: 'emitter', whoomp: 1, mix: { crack: -4, body: 0, low: -4, mech: -8 } },
  lance_sol: { kind: 'energy', cls: 'sniper', faction: 'sol', size: 1.0, body: [['rail', 0.8]], pew: [620, -0.9, 2200], low: [76, 28, 0.22, 0.4], crack: [0.0018, 1], mech: 'rail', mix: { crack: -2, body: 0, low: -3, mech: -7 } },
  lance_void: { kind: 'energy', cls: 'sniper', faction: 'void', size: 0.85, body: [['rail', 0.8]], pew: [900, -0.925, 1100], low: [68, 24, 0.26, 0.45], crack: [0.002, 0.8], mech: 'rail', mix: { crack: -3, body: 0, low: -3, mech: -7 } },
  rail_sol: { kind: 'energy', cls: 'cannon', faction: 'sol', size: 0.9, body: [['rail', 1]], pew: [760, -0.92, 1800], low: [60, 20, 0.4, 0.5], crack: [0.003, 1], mech: 'rail', mix: { crack: -1, body: 0, low: -2, mech: -6 } },
};

/** The far classes: what each sounds like from 150 m on, and which gun's dry shot stands for it. */
export const FAR = { light: 'smg_sol', rifle: 'ar_sol', heavy: 'br_sol', shotgun: 'sg_void', sniper: 'sr_sol', cannon: 'autocannon', quiet: 'supp' };

// ---------------------------------------------------------------- recorded sources
let SRC = null;
/** The recordings a body is cut from: single shots, each from its onset. */
function sources() {
  if (SRC) return SRC;
  const single = (rel, sec) => { const b = B.read(rel), t = B.onsets(b)[0] ?? 0; return B.upto(B.cut(b, Math.max(0, t - 0.002)), sec, sec * 0.4); };
  // The assault rifle: its bursts' single shots (clean, distinct ones), the next shot cutting each.
  const ar = [];
  for (const v of ['03', '02', '01']) {
    const b = B.read(M(`Gun_Assault_Rifle_Burst_var${v}`)), on = B.onsets(b, { jump: 6, gap: 0.05 });
    for (let i = 1; i < on.length - 1 && ar.length < 24; i += 2) {
      const a = on[i] - 0.002, e = Math.min(on[i] + 0.16, on[i + 1] - 0.004);
      if (e - a > 0.05 && a > 0.12) ar.push(B.fade(B.cut(b, a, e), 0.0005, 0.03));
    }
  }
  const hum = (b) => B.eq(b, [['highpass', 70, 0.7], ['highpass', 70, 0.7]]);   // (the pistol and sniper takes hum at 45 Hz under the shot)
  SRC = {
    ar,
    pistol: V3((v) => hum(single(M(`Gun_Pistol_9mm_Shot_var${v}`), 0.5))),
    sniper: V3((v) => hum(single(M(`Gun_Sniper_Rifle_Heavy_var${v}`), 1.1))),
    shotgun: V3((v) => single(M(`Gun_Shotgun_Blast_Pump_var${v}`), 0.75)),
    supp: V3((v) => single(M(`Gun_Silenced_Suppressed_var${v}`), 0.35)),
    frag: V3((v) => single(M(`Tactical_Frag_Grenade_Explode_var${v}`), 1.2)),
    plasma: V3((v) => B.eq(single(F(`Weapon_Plasma_Blaster_var${v}`), 0.6), [['highpass', 90, 0.7]])),
    rail: V3((v) => single(F(`Weapon_Railgun_Fire_var${v}`), 1.2)),
    thud: [B.trim(B.read('Weapons/harsh_thud.wav')), B.trim(B.read('Weapons/shot_muffled.wav'))],
    foley: {
      bolt: V3((v) => B.trim(B.read(M(`Foley_Bolt_Cock_Pull_var${v}`)), -30)),
      magin: V3((v) => B.trim(B.read(M(`Foley_Mag_Insert_Lock_var${v}`)), -30)),
    },
  };
  return SRC;
}
const pickFrom = (list, r) => list[Math.floor(r() * list.length) % list.length];

// ---------------------------------------------------------------- crack
/** The first milliseconds: the blast wave and the ground's answer, the gas's hiss, the supersonic snap. */
function crack(G, r) {
  const [tPos, snap] = G.crack, n = D.samples(0.12, SR);
  const core = new Float32Array(n), side = new Float32Array(n);
  const tp = jit(r, tPos, 0.12), m = D.samples(tp * 14, SR);
  D.mix(core, D.normalize(D.friedlander(m, tp, 1.4 + r() * 0.5), 1), 1);
  D.mix(core, D.lowpass(D.normalize(D.friedlander(m, tp * 1.3, 1.6), 1), 4200, 0.7, SR), 0.45, jit(r, 0.0032, 0.25), SR);       // the ground, a few ms after
  // The crack you hear: the blast's broadband snap, loudest at 1.5-4 kHz, gone in a few ms.
  const sn = D.mul(D.bandpass(D.noise(n, r), jit(r, 2600 / Math.sqrt(tPos / 0.001), 0.2), 0.7, SR), D.envExp(n, 0.0002, jit(r, 0.004 + tPos * 3, 0.2), SR));
  D.mix(core, D.normalize(sn, 1), 0.9);
  // The hiss of the gas: noise, very short, bright.
  const hiss = D.mul(D.highpass(D.noise(n, r), 4500 + r() * 1500, 0.7, SR), D.envExp(n, 0.0002, jit(r, 0.003 + tPos, 0.2), SR));
  for (const s of [core, side]) D.mix(s, D.normalize(hiss, 1), 0.3);
  // The bullet breaking the sound barrier: a sub-ms N-wave, bright and hard, spread wide.
  if (snap > 0) {
    const up = Math.max(2, Math.round(0.00004 * SR)), dn = Math.round(jit(r, 0.00028, 0.2) * SR), w = new Float32Array(up * 2 + dn + 8);
    for (let i = 0; i < up; i++) w[i] = i / up;
    for (let i = 0; i < dn; i++) w[up + i] = 1 - (2 * i) / dn;
    for (let i = 0; i < up; i++) w[up + dn + i] = -1 + i / up;
    D.highpass(w, 900, 0.7, SR);
    D.mix(side, w, 0.9 * snap, 0.0006 + r() * 0.0006, SR);
    D.mix(core, w, 0.5 * snap, 0.0006, SR);
  }
  if (G.faction === 'sol' && G.kind === 'kinetic') {
    // A Solari coil's electric snap: a short bright zap, falling.
    const z = D.samples(0.025, SR);
    D.mix(side, D.mul(D.fm(z, D.glide(jit(r, 5200), 1400, 0.008), 1.41, 3, 0.01, SR), D.envExp(z, 0.0003, 0.006, SR)), 0.28);
  }
  if (G.kind === 'energy') {
    // The discharge: a hard tick and a spit of crackle.
    D.mix(side, D.highpass(D.crackle(n, r, 900, (t) => Math.exp(-t / 0.012), SR), 2500, 0.7, SR), 0.7);
  }
  D.saturate(core, 1.6);
  const [L, R] = D.stereo(core, side, D.scale(Float32Array.from(side), -1), 0.6);
  return B.fade(B.st(L, R), 0.0002, 0.03);
}

// ---------------------------------------------------------------- body
/** A synthesized body: noise through a closing low-pass, the receiver's resonances, saturated. */
function synthBody(G, r, len) {
  const [lp, tau, res] = G.synth ?? [2000, 0.06, [[400, 3]]], n = D.samples(len, SR);
  const x = D.noise(n, r, 'pink');
  D.mul(x, D.envExp(n, 0.0006, jit(r, tau, 0.15), SR));
  D.lowpass(x, (t) => jit(r, lp, 0.1) * Math.exp(-t / (tau * 1.4)) + 140, 0.7, SR);
  for (const [f, g] of res) D.biquad(x, 'peak', jit(r, f, 0.06), 2.2, g + 3, SR);
  D.highpass(x, 70, 0.7, SR);
  D.saturate(D.normalize(x, 1), 2.2);
  return x;
}

/**
 * The pew: a click through the dispersive chain (the highs out first, the lows last), and copies of
 * it a fifth, an octave and a twelfth up: the partials of a struck wire falling together, the
 * twang of a blaster. Solari hard light bright and glassy; Void plasma slower, darker, growling.
 */
function pew(G, r, len) {
  const [stages, a, bright] = G.pew, n = D.samples(len, SR), sol = G.faction === 'sol';
  const src = new Float32Array(D.samples(0.5, SR));
  src[0] = 1; src[1] = -0.6;
  D.mix(src, D.mul(D.noise(src.length, r), D.envExp(src.length, 0.0001, 0.0008, SR)), 0.3);
  const st = Math.round(jit(r, stages, 0.1)), co = Math.max(-0.95, Math.min(-0.6, a * (1 + (r() * 2 - 1) * 0.008)));
  const base = D.disperse(src, st, co), out = new Float32Array(n);
  D.mix(out, base, 1);
  const harm = sol ? [[1.5, -3], [2, -6], [3, -10]] : [[1.5, -4], [2, -8]];
  for (const [k, db] of harm) if (r() > 0.15) D.mix(out, D.resample(base, k * (1 + (r() * 2 - 1) * 0.01)), 10 ** ((db + (r() * 2 - 1) * 2) / 20));
  // Sometimes a second string beside it, a little slower: the partials beat as they fall.
  if (r() < 0.5) D.mix(out, D.disperse(src, Math.round(st * (1.3 + r() * 0.3)), co * 1.01), 0.4);
  D.highpass(out, 110, 0.7, SR);
  D.biquad(out, 'peak', jit(r, bright, 0.08), 1.0, 5, SR);
  if (!sol) { D.ring(out, jit(r, 70, 0.12), 0.45, SR); D.lowpass(out, 3600, 0.7, SR); }
  else D.biquad(out, 'highshelf', 5000, 0.707, 3, SR);
  D.mul(out, D.envExp(n, 0.0003, len * 0.4, SR));
  D.saturate(D.normalize(out, 1), sol ? 1.5 : 2.2);
  return out;
}

function body(G, r) {
  const S = sources(), len = { light: 0.32, rifle: 0.5, heavy: 0.6, shotgun: 0.8, sniper: 1.0, cannon: 1.4, quiet: 0.3 }[G.cls];
  let out = B.empty(len);
  // Recorded: one take of each source, varispeeded to the gun's size (a few % apart every take).
  for (const [src, w] of G.body) {
    const list = src === 'ar' ? S.ar : S[src], take = pickFrom(list, r);
    let b = B.pitch(B.upto(take, len / G.size, 0.06), G.size * (1 + (r() * 2 - 1) * 0.035));
    if (src === 'thud') b = B.eq(b, [['lowpass', 900, 0.7]]);
    if (src === 'plasma') b = B.eq(b, [['lowpass', 3200, 0.7]]);   // (its body under the pew, not its hiss)
    out = B.mix(out, B.level(b, -14), 0, 20 * Math.log10(w));
  }
  // Synthesized: a kinetic gun's roaring gas, or a blaster's pew (and a plasma gun's whoomp).
  const sy = G.kind === 'energy' ? pew(G, r, len) : synthBody(G, r, len);
  out = B.mix(out, B.level(B.st(sy, D.scale(Float32Array.from(sy), 1)), -14), 0, G.kind === 'energy' ? 1 : -3);
  if (G.whoomp) {
    const n = D.samples(len, SR), w = D.mul(D.lowpass(D.noise(n, r, 'brown'), (t) => 900 * Math.exp(-t / 0.15) + 120, 0.8, SR), D.envSwell(n, 0.03, len, len * 0.7, SR, 1));
    out = B.mix(out, B.level(B.st(w), -14), 0, -2);
  }
  // A kinetic shot's bite: the blast's presence, 2-4 kHz (the big ones, recorded dark, more of it).
  if (G.kind === 'kinetic') out = B.eq(out, [['peak', 2800, G.cls === 'sniper' || G.cls === 'shotgun' || G.cls === 'cannon' ? 5 : 3, 0.7]]);
  // The faction's colour.
  if (G.faction === 'sol') out = B.eq(out, [['peak', 3600, 2.5, 0.8], ['highshelf', 7000, 2], ['peak', 260, -2, 0.9]]);
  else if (G.faction === 'void') {
    out = B.eq(out, [['lowshelf', 160, 3], ['highshelf', 4500, -4], ['peak', 700, 2, 0.8]]);
    const g = B.clone(out); D.ring(g.L, jit(r, 62, 0.1), 0.5, SR); D.ring(g.R, jit(r, 66, 0.1), 0.5, SR);   // the growl
    out = B.mix(B.gain(out, -2), g, 0, -5);
  }
  out = B.sat(B.eq(out, [['highpass', 60, 0.7]]), G.kind === 'energy' ? 1.15 : 1.4);
  return B.fade(B.width(out, 1.3), 0.0005, len * 0.45);
}

// ---------------------------------------------------------------- low
/** The punch you feel: a sine falling an octave and more, its harmonics, a thump of low noise. */
function low(G, r) {
  const [f0, f1, tau, warmth] = G.low, len = Math.min(1.6, tau * 7 + 0.05), n = D.samples(len, SR);
  // The sine holds near its first note for the punch, then sinks: the chest hit, then the weight.
  const x = D.osc(n, D.glide(jit(r, f0, 0.07), jit(r, f1, 0.05), tau * 0.9), 'sine', SR);
  D.mul(x, D.envExp(n, 0.0015, jit(r, tau, 0.12), SR));
  D.warm(x, 2.4 + warmth * 3, 0.15 + warmth * 0.4);
  // The knock: two cycles at twice the note, the punch a small speaker can play.
  const kf = jit(r, f0 * 1.7, 0.08), km = D.samples(2.5 / kf, SR);
  D.mix(x, D.mul(D.osc(km, kf, 'sine', SR), D.envExp(km, 0.0008, 0.6 / kf, SR)), 0.55);
  const th = D.mul(D.lowpass(D.noise(n, r, 'brown'), 190, 0.8, SR), D.envExp(n, 0.002, tau * 0.6, SR));
  D.mix(x, D.normalize(th, 1), 0.3);
  D.lowpass(x, 520, 0.7, SR);
  D.highpass(x, 26, 0.7, SR);
  D.fadeOut(x, len * 0.3, SR);
  return mono(x);
}

// ---------------------------------------------------------------- mech
/** Struck metal: a click and its inharmonic ring (a bolt slamming home, a coil housing). */
function clank(r, f0, decay, a = 1) {
  const n = D.samples(Math.max(0.05, decay * 5), SR), x = new Float32Array(n);
  D.mix(x, D.mul(D.highpass(D.noise(n, r), f0 * 0.8, 0.7, SR), D.envExp(n, 0.0001, 0.0012, SR)), 0.9 * a);
  D.mix(x, D.modes(n, [[jit(r, f0, 0.08), 0.5, decay], [f0 * jit(r, 2.76, 0.03), 0.3, decay * 0.6], [f0 * jit(r, 5.4, 0.03), 0.18, decay * 0.4], [f0 * 0.53, 0.25, decay * 0.8]], SR, r), a);
  return x;
}
function mech(G, r) {
  const S = sources(), len = 0.32, n = D.samples(len, SR), core = new Float32Array(n), side = new Float32Array(n);
  const kind = G.mech;
  if (kind === 'rifle' || kind === 'smg' || kind === 'heavy') {
    // The bolt carrier going back and slamming home.
    const f = kind === 'heavy' ? 1300 : kind === 'smg' ? 2600 : 1900, back = kind === 'smg' ? 0.022 : kind === 'heavy' ? 0.05 : 0.035;
    D.mix(core, clank(r, jit(r, f, 0.1), 0.02), 0.6, 0.002, SR);
    D.mix(side, clank(r, jit(r, f * 1.3, 0.1), 0.014), 0.5, back, SR);
    D.mix(core, D.mul(D.lowpass(D.noise(n, r), 500, 0.8, SR), D.envExp(n, 0.0005, 0.012, SR)), 0.6, back, SR);
    if (kind === 'heavy') D.mix(side, clank(r, jit(r, 3400, 0.1), 0.03), 0.35, back + 0.012, SR);    // the belt's links
  } else if (kind === 'pump' || kind === 'bolt') {
    D.mix(core, clank(r, jit(r, 1500, 0.1), 0.03), 0.6, 0.002, SR);
  } else if (kind === 'breech') {
    D.mix(core, clank(r, jit(r, 700, 0.1), 0.06, 1.2), 0.8, 0.002, SR);
    D.mix(core, D.mul(D.lowpass(D.noise(n, r, 'brown'), 300, 0.8, SR), D.envExp(n, 0.001, 0.04, SR)), 1.2, 0.004, SR);
    D.mix(side, clank(r, jit(r, 1100, 0.1), 0.05), 0.6, 0.12 + r() * 0.03, SR);
  } else if (kind === 'emitter' || kind === 'rail' || kind === 'coil') {
    // The capacitor letting go and the emitter's housing ticking as it heats; a rail's coils ringing.
    D.mix(core, clank(r, jit(r, kind === 'rail' ? 2300 : 3100, 0.1), kind === 'rail' ? 0.08 : 0.012), 0.5, 0.001, SR);
    const hiss = D.mul(D.highpass(D.noise(n, r), 3500, 0.7, SR), D.envSwell(n, 0.03, len, len * 0.8, SR, 1));
    D.mix(side, hiss, kind === 'rail' ? 0.35 : 0.18, 0.02, SR);
    if (kind === 'rail') D.mix(side, D.mul(D.osc(n, D.glide(jit(r, 2600, 0.05), 1700, 0.08), 'sine', SR), D.envExp(n, 0.001, 0.09, SR)), 0.18);
  }
  // Recorded clicks: a sliver of the foley (the bolt's or the magazine's first hit) for grit.
  if (kind !== 'emitter' && kind !== 'rail' && kind !== 'none') {
    const f = pickFrom(r() < 0.5 ? S.foley.bolt : S.foley.magin, r), t = B.onsets(f)[0] ?? 0;
    const sliver = B.fade(B.cut(f, t, t + 0.06), 0.0005, 0.03), m = B.mono(sliver);
    D.mix(side, D.highpass(m.L, 900, 0.7, SR), 0.5, 0.004, SR);
  }
  if (G.faction === 'void') D.ring(core, jit(r, 88, 0.1), 0.4, SR);
  const [L, R] = D.stereo(core, side, D.scale(Float32Array.from(side), -0.7), 1);
  return B.fade(B.st(L, R), 0.0003, 0.08);
}

// ---------------------------------------------------------------- far
/** What's left at 150 m on: the pop (a little crack, mostly body) through 150 m of air, the ground smearing it, a thump. */
function far(G, r) {
  const dry = B.sum([crack(G, r), 0, -10], [body(G, r), 0, 0], [low(G, r), 0, -4]);
  let x = B.mono(dry);
  x = B.eq(x, [['lowpass', 1500, 0.7], ['lowpass', 2200, 0.7], ['highpass', 55, 0.7], ['peak', 320, 3, 0.8]]);
  // The ground and the air between: a smear of short echoes (the room adds the long ones at runtime).
  const taps = [[0.012, 0.45, 900], [0.031, 0.35, 700], [0.058, 0.25, 600]];
  const L = D.echoes(x.L, taps.map(([t, g, f]) => [jit(r, t, 0.2), g, f]), 0, SR);
  x = B.st(L);
  x = B.sat(x, 1.5);
  const len = { light: 0.6, rifle: 0.8, heavy: 0.9, shotgun: 1.0, sniper: 1.2, cannon: 1.6, quiet: 0.4 }[G.cls];
  return B.fade(B.cut(x, 0, len), 0.002, len * 0.5);
}

// ---------------------------------------------------------------- the build
/** Takes per layer, and the punch each layer's takes are levelled to: [dBFS, over how many s]. */
export const TAKES = { crack: 8, body: 10, low: 6, mech: 6, far: 5 };
export const LEVEL = { crack: [-12, 0.008], body: [-12, 0.05], low: [-21, 0.05], mech: [-12, 0.015], far: [-12, 0.08] };
// (The low layer 9 dB under the body: at the same punch a sine's energy would bury the shot. The
// first-person view lifts it back up a little: VIEWS in SoundEngine.js.)
/** Every take of every layer of a gun: { crack: [...], body: [...], low: [...], mech: [...] } (and far by class). */
export function gun(id, seed = 1) {
  const G = GUNS[id], out = {};
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  for (const [layer, fn] of [['crack', crack], ['body', body], ['low', low], ['mech', mech]]) {
    out[layer] = [];
    for (let k = 0; k < TAKES[layer]; k++) out[layer].push(fn(G, D.rng((h ^ (seed * 7919) ^ ((k + 1) * 0x9e3779b9) ^ layer.length * 131) >>> 0)));
  }
  return out;
}
export function farClass(cls, seed = 1) {
  const G = GUNS[FAR[cls]], out = [];
  for (let k = 0; k < TAKES.far; k++) out.push(far(G, D.rng((seed * 104729 + k * 7907 + cls.length * 31) >>> 0)));
  return out;
}
/** (For designing: the layer functions on their own.) */
export const parts = { crack, body, low, mech, far, pew, synthBody };
