// Blasts and the sky: explosions, the artillery's reports, rounds coming in, rounds going past.
// Layered like the guns (the engine mixes them by distance), with more takes, because they're the
// biggest things you hear and the easiest to notice repeating.
//
//   boom   crack   the blast wave hitting you: a Friedlander pulse as long as the charge is big,
//                  its snap, the supersonic shock of the casing breaking up.
//          body    the fireball's roar: the frag recordings varispeeded to the charge, a roar of
//                  noise closing down as it goes, saturated.
//          low     the pressure you feel in your chest: a sine falling to 20-30 Hz over seconds,
//                  with harmonics and a rumble of low noise.
//          debris  what comes back down (0.3-3 s): in the trenches earth, stones and clods; in the
//                  city concrete, glass and steel.
//          far     by size: from 150 m on, the thud and the rumble (the room rolls it back).
//   report the artillery's guns: a howitzer's boom, an AT gun's crack, a rocket leaving its rail.
//   incoming  a shell falling on you: the air tearing, a whistle dropping as it comes.
//   crack     a supersonic round past your head; whizz: a bolt past (Solari and Void).
//   sky       a drop pod's roar coming down; the strike jet passing low.

import * as D from '../../src/audio/dsp.js';
import * as B from './lib.mjs';

const SR = B.SR;
const M = (n) => `Modern_Firearms_Military_Pack/${n}.wav`;
const F = (n) => `SciFi_Cyberpunk_SFX_Pack/${n}.wav`;
const V3 = (f) => [1, 2, 3].map((i) => f(`0${i}`));
const jit = (r, x, k = 0.06) => x * (1 + (r() * 2 - 1) * k);
const seeded = (id, k) => { let h = 2166136261; for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619); return D.rng((h ^ ((k + 1) * 0x9e3779b9)) >>> 0); };

/** The four sizes: how big the charge is (1 a grenade .. 3 a big bomb). */
export const SIZES = { grenade: 1, vehicle: 1.6, shell: 2.4, bomb: 3 };

let SRC = null;
function sources() {
  if (SRC) return SRC;
  const single = (rel, sec) => { const b = B.read(rel), t = B.onsets(b)[0] ?? 0; return B.upto(B.cut(b, Math.max(0, t - 0.003)), sec, sec * 0.45); };
  SRC = {
    frag: V3((v) => single(M(`Tactical_Frag_Grenade_Explode_var${v}`), 2.6)),
    emp: V3((v) => single(F(`Weapon_EMP_Explosion_var${v}`), 1.6)),
    thud: [B.trim(B.read('Weapons/harsh_thud.wav')), B.trim(B.read('Weapons/shot_muffled.wav'))],
    sniper: V3((v) => B.eq(single(M(`Gun_Sniper_Rifle_Heavy_var${v}`), 1.4), [['highpass', 70, 0.7]])),
    shotgun: V3((v) => single(M(`Gun_Shotgun_Blast_Pump_var${v}`), 0.9)),
    rail: V3((v) => single(F(`Weapon_Railgun_Fire_var${v}`), 1.6)),
  };
  return SRC;
}
const pickFrom = (list, r) => list[Math.floor(r() * list.length) % list.length];

// ---------------------------------------------------------------- explosions
function boomCrack(size, r) {
  const n = D.samples(0.25, SR), core = new Float32Array(n), side = new Float32Array(n);
  const tp = jit(r, 0.003 * size ** 1.3, 0.15), m = D.samples(tp * 12, SR);
  D.mix(core, D.normalize(D.friedlander(m, tp, 1.2 + r() * 0.6), 1), 1);
  D.mix(core, D.lowpass(D.normalize(D.friedlander(m, tp * 1.4, 1.5), 1), 2500, 0.7, SR), 0.5, jit(r, 0.006, 0.3), SR);
  const sn = D.mul(D.bandpass(D.noise(n, r), jit(r, 1800 / Math.sqrt(size), 0.2), 0.6, SR), D.envExp(n, 0.0003, jit(r, 0.01 * size, 0.2), SR));
  D.mix(core, D.normalize(sn, 1), 0.8);
  for (const s of [core, side]) D.mix(s, D.normalize(D.mul(D.highpass(D.noise(n, r), 3000, 0.7, SR), D.envExp(n, 0.0002, 0.006 * size, SR)), 1), 0.4);
  D.saturate(core, 2);
  const [L, R] = D.stereo(core, side, D.scale(Float32Array.from(side), -1), 0.7);
  return B.fade(B.st(L, R), 0.0002, 0.08);
}
function boomBody(size, r, element) {
  const S = sources(), len = 0.9 + size * 0.35;
  let out = B.empty(len);
  const take = pickFrom(S.frag, r), k = jit(r, 1.08 - size * 0.14, 0.04);
  out = B.mix(out, B.level(B.pitch(B.upto(take, len * k, len * k * 0.5), k), -14), 0, 0);
  if (size > 1.3) out = B.mix(out, B.level(B.pitch(pickFrom(S.thud, r), jit(r, 0.9 - size * 0.1, 0.05)), -14), 0, -4);
  // The fireball: noise roaring out, its brightness closing down fast, then the roll of it.
  const n = D.samples(len, SR), roar = D.noise(n, r, 'pink');
  D.mul(roar, D.envExp(n, 0.002, jit(r, 0.18 * size, 0.15), SR));
  D.lowpass(roar, (t) => jit(r, 5000, 0.1) * Math.exp(-t / (0.06 * size)) + 160 + 90 / size, 0.6, SR);
  D.saturate(D.normalize(roar, 1), 2.4);
  out = B.mix(out, B.level(B.st(roar, D.scale(Float32Array.from(roar), 1)), -14), 0, -2);
  if (element === 'emp') out = B.mix(out, B.level(B.eq(pickFrom(S.emp, r), [['highpass', 90, 0.7]]), -14), 0, -2);
  out = B.eq(out, [['highpass', 45, 0.7], ['peak', 220, 2, 0.8], ['peak', 2500, -2, 0.8]]);
  return B.fade(B.width(B.sat(B.shape(out, 0.9), 1.3), 1.25), 0.001, len * 0.5);   // (its first ms pushed up: it hits, then it roars)
}
function boomLow(size, r) {
  const len = 0.9 + size * 0.45, n = D.samples(len, SR), tau = jit(r, 0.18 * size, 0.15);
  const x = D.osc(n, D.glide(jit(r, 62 - size * 6, 0.08), jit(r, 26 - size * 2, 0.08), tau * 0.6), 'sine', SR);
  D.mul(x, D.envExp(n, 0.004, tau, SR));
  D.warm(x, 2.6 + size * 0.4, 0.25);
  const knock = D.samples(0.06, SR);
  D.mix(x, D.mul(D.osc(knock, jit(r, 120 - size * 15, 0.1), 'sine', SR), D.envExp(knock, 0.001, 0.012, SR)), 0.5);
  const rum = D.mul(D.lowpass(D.noise(n, r, 'brown'), 110, 0.7, SR), D.envExp(n, 0.01, tau * 1.6, SR));
  D.mix(x, D.normalize(rum, 1), 0.45);
  D.lowpass(x, 300, 0.7, SR); D.highpass(x, 20, 0.7, SR);
  D.fadeOut(x, len * 0.35, SR);
  return B.st(x);
}
/** What comes back down: the trench's earth, stones and clods; the city's concrete, glass and steel. */
function debris(size, r, room) {
  const len = 0.9 + size * 0.5, n = D.samples(len, SR), L = new Float32Array(n), R = new Float32Array(n);
  const count = Math.round(jit(r, 26 * size, 0.2)), city = room !== 'open';
  for (let k = 0; k < count; k++) {
    // Most of it comes down 0.3-1.5 s after (thrown up, falling back), thinning out.
    const t = 0.15 + (r() ** 1.6) * (len - 0.35), side = r() < 0.5 ? L : R, other = side === L ? R : L, a = (0.25 + r() ** 2) * (1 - 0.5 * t / len);
    const m = D.samples(0.08, SR);
    let hit;
    if (!city || r() < 0.45) {
      // Earth and stones: a thud with a little grit.
      hit = D.mul(D.lowpass(D.noise(m, r), jit(r, city ? 1400 : 700, 0.3), 0.8, SR), D.envExp(m, 0.0005, jit(r, 0.008, 0.4), SR));
      D.mix(hit, D.mul(D.bandpass(D.noise(m, r), 2600, 0.8, SR), D.envExp(m, 0.0002, 0.002, SR)), 0.3);
    } else if (r() < 0.55) {
      // Concrete: a knock with a short ring.
      hit = D.modes(m, [[jit(r, 900, 0.3), 0.4, 0.012], [jit(r, 2300, 0.2), 0.25, 0.006]], SR, r);
      D.mix(hit, D.mul(D.highpass(D.noise(m, r), 1500, 0.7, SR), D.envExp(m, 0.0002, 0.003, SR)), 0.6);
    } else {
      // Glass and steel: bright little rings.
      const f0 = jit(r, r() < 0.5 ? 3200 : 1700, 0.25);
      hit = D.modes(m, [[f0, 0.3, 0.03], [f0 * 2.4, 0.2, 0.02], [f0 * 3.9, 0.12, 0.012]], SR, r);
    }
    D.mix(side, hit, a, t, SR);
    D.mix(other, hit, a * 0.35, t + 0.0007, SR);
  }
  // Under it, the dust and grit settling: a hiss falling away.
  const grit = D.mul(D.bandpass(D.noise(n, r), city ? 2400 : 1400, 0.5, SR), D.envSwell(n, 0.25, len, len * 0.7, SR, 1));
  D.mix(L, grit, 0.06); D.mix(R, grit, 0.05);
  return B.fade(B.st(L, R), 0.002, 0.3);
}
function boomFar(size, r) {
  const len = 1.6 + size * 0.4, n = D.samples(len, SR);
  let x = B.mono(B.sum([boomCrack(size, r), 0, -14], [boomBody(size, r, null), 0, 0], [boomLow(size, r), 0, 0]));
  x = B.eq(x, [['lowpass', 900 / Math.sqrt(size), 0.7], ['lowpass', 1300 / Math.sqrt(size), 0.7], ['highpass', 30, 0.7], ['peak', 90, 3, 0.8]]);
  // The ground and the air: a smear of short echoes and a slower swell of rumble (the room adds the rest).
  const taps = [[0.03, 0.5, 600], [0.09, 0.4, 450], [0.21, 0.32, 380], [0.42, 0.22, 300]].map(([t, g, f]) => [jit(r, t, 0.25), g, f]);
  const L = D.echoes(x.L, taps, 0, SR);
  x = B.sat(B.st(L), 1.6);
  return B.fade(B.cut(x, 0, Math.min(len, B.len(x))), 0.003, len * 0.5);
}

/** Every layer's takes for an explosion of `name` (a size, or 'emp': the void and plasma crackle on top). */
export function boom(name) {
  const size = SIZES[name] ?? 1.3, element = name === 'emp' ? 'emp' : null, T = 6, out = { crack: [], body: [], low: [], 'debris@open': [], 'debris@city': [] };
  for (let k = 0; k < T; k++) {
    const r = seeded(`boom:${name}`, k);
    out.crack.push(boomCrack(size, r));
    out.body.push(boomBody(size, r, element));
    if (k < 5) out.low.push(boomLow(size, r));
    if (k < 4) { out['debris@open'].push(debris(size, r, 'open')); out['debris@city'].push(debris(size, r, 'city')); }
  }
  if (element) { delete out['debris@open']; delete out['debris@city']; }
  return out;
}
export function boomFarTakes(name) { const size = SIZES[name] ?? 1.3; return [0, 1, 2, 3].map((k) => boomFar(size, seeded(`far:boom:${name}`, k))); }

// ---------------------------------------------------------------- the artillery's reports
/** A field gun firing: crack, body, low (and a rocket's roar off its rail), mostly heard from far off. */
export function report(kind) {
  const S = sources(), out = { crack: [], body: [], low: [] };
  for (let k = 0; k < 5; k++) {
    const r = seeded(`report:${kind}`, k);
    if (kind === 'rocket') {
      // A rocket leaving its rail: a hard kick, then the motor's tearing roar, rising, going away.
      const len = 2.2, n = D.samples(len, SR);
      const kick = boomCrack(0.7, r);
      const roar = D.mul(D.bandpass(D.noise(n, r), D.sweep(jit(r, 600, 0.15), jit(r, 2600, 0.15), 1.4), 0.9, SR), D.envSwell(n, 0.05, len, 1.6, SR, 1));
      D.mix(roar, D.mul(D.lowpass(D.noise(n, r, 'brown'), 500, 0.7, SR), D.envExp(n, 0.03, 0.6, SR)), 2);
      D.mix(roar, D.mul(D.highpass(D.crackle(n, r, 400, (t) => Math.exp(-t / 0.8), SR), 1500, 0.7, SR), D.envSwell(n, 0.05, len, 1.2, SR, 1)), 0.25);
      D.saturate(D.normalize(roar, 1), 1.8);
      out.crack.push(kick); out.body.push(B.fade(B.st(roar, D.scale(Float32Array.from(roar), 1)), 0.003, 0.6)); out.low.push(boomLow(0.9, r));
      continue;
    }
    const size = kind === 'howitzer' ? 2.6 : 1.6;
    out.crack.push(boomCrack(size * 0.8, r));
    let b = B.level(B.pitch(B.upto(pickFrom(S.sniper, r), 1.6, 0.6), jit(r, kind === 'howitzer' ? 0.55 : 0.75, 0.05)), -14);
    if (kind === 'howitzer') b = B.mix(b, B.level(B.pitch(pickFrom(S.frag, r), jit(r, 0.6, 0.05)), -14), 0, -3);
    else b = B.mix(b, B.level(B.pitch(B.upto(pickFrom(S.shotgun, r), 0.9), jit(r, 0.8, 0.05)), -14), 0, -3);
    out.body.push(B.fade(B.sat(B.eq(b, [['highpass', 40, 0.7], ['peak', 180, 3, 0.8]]), 1.4), 0.001, 0.6));
    out.low.push(boomLow(size, r));
  }
  return out;
}

// ---------------------------------------------------------------- rounds in the air
/** A shell falling on you (3 s, its end at the impact: the engine plays its last seconds): the air tearing, a whistle dropping. */
export function incoming(k) {
  const r = seeded('incoming', k), len = 3, n = D.samples(len, SR);
  const f0 = jit(r, 1500, 0.15), f1 = jit(r, 420, 0.15), wob = jit(r, 38, 0.3);
  const f = (t) => f0 * (f1 / f0) ** (t / len) * (1 + 0.01 * Math.sin(t * wob));
  // The whistle: soft, more air than tone (a pure whistle is the cartoon one).
  const tone = D.osc(n, f, 'sine', SR);
  D.mix(tone, D.bandpass(D.noise(n, r), f, 9, SR), 2.5);
  // The tear: broadband rushing, growing much faster than the whistle at the end.
  const tear = D.mul(D.bandpass(D.noise(n, r), (t) => 700 + 2600 * (t / len) ** 2, 0.5, SR), D.envSwell(n, len * 0.95, len, 0.03, SR, 4));
  const x = new Float32Array(n);
  D.mix(x, tone, 0.35); D.mix(x, D.normalize(tear, 1), 0.9);
  for (let i = 0; i < n; i++) { const t = i / SR; x[i] *= (t / len) ** 2.2 * (t > len - 0.02 ? (len - t) / 0.02 : 1); }
  const [L, R] = D.haas(x, 0.4 + r() * 0.6, SR);
  return B.st(L.subarray(0, n), R.subarray(0, n));
}

/** A supersonic round past your head: the N-wave's crack, a zip of air, a little tail. */
export function crackPast(k) {
  const r = seeded('crack', k), n = D.samples(0.28, SR), x = new Float32Array(n), side = new Float32Array(n);
  const up = Math.round(jit(r, 0.00025, 0.3) * SR), dn = Math.round(jit(r, 0.00075, 0.25) * SR);
  for (let i = 0; i < up; i++) x[i] = i / up;
  for (let i = 0; i < dn; i++) x[up + i] = 1 - (2 * i) / dn;
  for (let i = 0; i < up; i++) x[up + dn + i] = -1 + i / up;
  D.highpass(x, 600, 0.7, SR);
  // The zip: the air the round tore, a short falling band of noise.
  const zip = D.mul(D.bandpass(D.noise(n, r), D.glide(jit(r, 5200, 0.2), jit(r, 2200, 0.2), 0.04), 2.2, SR), D.envExp(n, 0.0008, jit(r, 0.025, 0.3), SR));
  D.mix(side, D.normalize(zip, 1), 0.35);
  // The snap rattling off what's near: a few tiny echoes.
  const L = D.echoes(x, [[jit(r, 0.006, 0.4), 0.25, 5000], [jit(r, 0.014, 0.4), 0.15, 3500]], 0, SR);
  const [a, b] = D.stereo(L.subarray(0, n), side, D.scale(Float32Array.from(side), -1), 1);
  return B.fade(B.st(a, b), 0.0001, 0.08);
}
/** A bolt past you: its hum dropping as it goes by (Doppler), loudest at the pass; Solari a bright sizzle, Void a dark throb. */
export function boltPast(faction, k) {
  const r = seeded(`whizz:${faction}`, k), len = 0.45, n = D.samples(len, SR), tp = jit(r, 0.14, 0.15), sol = faction === 'sol';
  const fc = jit(r, sol ? 900 : 300, 0.12), w = jit(r, 0.03, 0.2);
  const f = (t) => fc * (1 + 0.35 * Math.tanh((tp - t) / w));
  const body = D.osc(n, f, 'saw', SR);
  D.lowpass(body, (t) => f(t) * (sol ? 4 : 2.2), 0.9, SR);
  if (!sol) D.ring(body, jit(r, 60, 0.15), 0.6, SR);
  const air = D.bandpass(D.noise(n, r), (t) => f(t) * 3, 1.2, SR);
  const x = new Float32Array(n);
  D.mix(x, D.normalize(body, 1), 0.7); D.mix(x, D.normalize(air, 1), 0.5);
  D.mix(x, D.highpass(D.crackle(n, r, sol ? 900 : 500, (t) => Math.exp(-(((t - tp) / 0.05) ** 2)), SR), 3000, 0.7, SR), 0.5);
  for (let i = 0; i < n; i++) { const t = i / SR; x[i] *= Math.exp(-(((t - tp) / jit(r, 0.05, 0.2)) ** 2)); }
  // It passes from one side to the other.
  const L = new Float32Array(n), R = new Float32Array(n), dir = r() < 0.5 ? 1 : -1;
  for (let i = 0; i < n; i++) { const p = 0.5 + 0.45 * dir * Math.tanh((i / SR - tp) / 0.04); L[i] = x[i] * Math.sqrt(1 - p); R[i] = x[i] * Math.sqrt(p); }
  return B.fade(B.st(L, R), 0.002, 0.05);
}

// ---------------------------------------------------------------- the sky
/** A drop pod coming down (4 s, the end at the landing: the engine plays its last seconds), or the strike jet passing. */
export function sky(kind, k) {
  const r = seeded(`sky:${kind}`, k), len = kind === 'pod' ? 4 : 4.5, n = D.samples(len, SR);
  const L = new Float32Array(n), R = new Float32Array(n);
  if (kind === 'pod') {
    const roar = D.lowpass(D.noise(n, r, 'brown'), (t) => 220 + (t / len) ** 2 * 2600, 0.8, SR);
    D.mix(roar, D.mul(D.bandpass(D.noise(n, r), (t) => 900 + (t / len) ** 2 * 3000, 0.6, SR), D.envSwell(n, len * 0.9, len, 0.02, SR, 3)), 0.4);
    D.mix(roar, D.osc(n, (t) => jit(r, 48, 0.1) + (t / len) * 30, 'tri', SR), 0.25);
    for (let i = 0; i < n; i++) { const t = i / SR; roar[i] *= (0.03 + (t / len) ** 2.6) * (t > len - 0.015 ? (len - t) / 0.015 : 1); }
    D.saturate(D.normalize(roar, 1), 1.6);
    const [a, b] = D.haas(roar, 6, SR);
    L.set(a.subarray(0, n)); R.set(b.subarray(0, n));
  } else {
    // A jet passing low: the roar swelling and falling, its whine dropping as it goes over (Doppler), left to right.
    const tp = len * jit(r, 0.45, 0.1), dir = r() < 0.5 ? 1 : -1;
    const roar = D.mul(D.lowpass(D.noise(n, r, 'pink'), (t) => 1800 + 2500 * Math.exp(-(((t - tp) / 0.6) ** 2)), 0.7, SR), D.envSwell(n, tp, len, len - tp - 0.1, SR, 2));
    const whine = D.mul(D.osc(n, (t) => jit(r, 1900, 0.1) * (1 + 0.18 * Math.tanh((tp - t) / 0.35)), 'saw', SR), D.envSwell(n, tp, len, len - tp, SR, 3));
    D.lowpass(whine, 3500, 0.7, SR);
    const x = new Float32Array(n);
    D.mix(x, D.normalize(roar, 1), 1); D.mix(x, D.normalize(whine, 1), 0.08);
    D.mix(x, D.mul(D.lowpass(D.noise(n, r, 'brown'), 160, 0.7, SR), D.envSwell(n, tp, len, len - tp, SR, 2)), 1.5);
    D.saturate(D.normalize(x, 1), 1.4);
    for (let i = 0; i < n; i++) { const p = 0.5 + 0.45 * dir * Math.tanh((i / SR - tp) / 0.6); L[i] = x[i] * Math.sqrt(1 - p); R[i] = x[i] * Math.sqrt(p); }
  }
  return B.fade(B.st(L, R), 0.01, 0.1);
}
