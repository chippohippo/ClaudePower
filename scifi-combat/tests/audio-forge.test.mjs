// The forged sounds (audio/manifest.json, built by tools/audio/forge.mjs) and how the engine and the
// atmosphere use them: every file there and a real Ogg; every gun in layers with enough takes of each
// that no two shots are alike; every weapon in the game's data heard through one; blasts in layers
// with debris for each room; each map its own beds and spots; the distance model and the layer
// windows sane (the crack goes first, the far layer takes over); the loudness window's arithmetic;
// and the Ambience playing a map's beds, its spots round you and the war beyond the map.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { layerWeights, distanceShape, loudness, SoundEngine, LAYERS, KINDS } from '../src/audio/SoundEngine.js';
import { Ambience, MAPS } from '../src/audio/Ambience.js';
import { weaponDesign } from '../src/audio/SoundBank.js';
import { rng, fft } from '../src/audio/dsp.js';
import { atmos } from '../tools/audio/atmos.mjs';
import { data as H } from './harness.mjs';

const ROOT = new URL('../audio/', import.meta.url);
const M = JSON.parse(readFileSync(new URL('manifest.json', ROOT))).sounds;
const ONE_TAKE = /^(arrow:\d+|music:|ui:hero|amb:)/;      // a tone per arrow; the stingers; a bed is one long loop
const files = (e) => [...(e.takes ?? []), ...Object.values(e.layers ?? {}).flat()];

test('forge: every file is there and an Ogg; the whole set stays light', () => {
  let n = 0, bytes = 0;
  for (const [id, e] of Object.entries(M)) {
    const list = files(e);
    assert.ok(list.length >= 1, `${id}: has files`);
    for (const f of list) {
      const file = new URL(f, ROOT);
      assert.ok(existsSync(file), `${f} exists`);
      const fd = openSync(file, 'r'), head = Buffer.alloc(4); readSync(fd, head, 0, 4, 0); closeSync(fd);
      assert.equal(head.toString('latin1'), 'OggS', `${f} is an Ogg file`);
      n++; bytes += statSync(file).size;
    }
    if (e.takes && !ONE_TAKE.test(id)) assert.ok(e.takes.length >= 3, `${id}: ${e.takes.length} takes`);
  }
  assert.ok(bytes < 24 * 1048576, `${(bytes / 1048576).toFixed(1)} MB in ${n} files`);
});

test('forge: every gun is a stack of layers, each with its takes, and a far class that exists', () => {
  const guns = Object.entries(M).filter(([, e]) => e.kind === 'gun');
  assert.ok(guns.length >= 20, `${guns.length} guns`);
  for (const [id, e] of guns) {
    for (const [layer, min] of [['crack', 6], ['body', 8], ['low', 5], ['mech', 5]]) assert.ok(e.layers[layer]?.length >= min, `${id}: ${layer} ${e.layers[layer]?.length} takes`);
    assert.ok(M[e.far]?.layers?.far?.length >= 4, `${id}: its far class ${e.far}`);
    assert.ok(Number.isFinite(e.mix.body) && Number.isFinite(e.mix.low), `${id}: a mix`);
    // Combinations: no two shots alike for a long while (each layer dealt from its own deck).
    const combos = ['crack', 'body', 'low', 'mech'].reduce((a, l) => a * e.layers[l].length, 1);
    assert.ok(combos >= 1500, `${id}: ${combos} different shots`);
  }
});

test('forge: every weapon in the game sounds through a forged gun', () => {
  const specs = [...(H.ballistic.weapons ?? []), ...(H.energy.weapons ?? []), ...Object.values(H.vehicles.weapons ?? {}), ...Object.values(H.supers?.weapons ?? {})];
  assert.ok(specs.length > 20, `${specs.length} weapons`);
  const missing = [];
  for (const s of specs) {
    const [kind, profile] = weaponDesign(s);
    if (kind === 'beam') continue;                          // beams are seamless loops, made in code
    if (M[`${kind}:${profile}`]?.kind !== 'gun') missing.push(`${s.id} (${kind}:${profile})`);
  }
  assert.deepEqual(missing, [], 'no weapon left without its layers');
  const sup = M['gun:supp'];
  assert.ok(sup && sup.mix.crack < M['gun:ar_sol'].mix.crack - 6, 'a suppressor takes the crack away');
});

test('forge: blasts in layers, with debris for the trench and for the city, far versions by size; the air past you', () => {
  for (const size of ['grenade', 'vehicle', 'shell', 'bomb']) {
    const e = M[`boom:${size}`];
    for (const [layer, min] of [['crack', 5], ['body', 5], ['low', 4], ['debris@open', 3], ['debris@city', 3]]) assert.ok(e.layers[layer]?.length >= min, `boom:${size} ${layer}`);
    assert.ok(M[e.far]?.layers.far.length >= 3, `boom:${size}: far`);
  }
  for (const k of ['howitzer', 'at', 'rocket']) assert.ok(M[`report:${k}`]?.layers.body.length >= 4, `report:${k}`);
  for (const id of ['incoming', 'crack', 'whizz:sol', 'whizz:void']) assert.ok(M[id]?.takes.length >= 6, `${id}: six takes or more`);
});

test('forge: each map has its own atmosphere: beds that exist, spots of its own', () => {
  const seen = new Set();
  for (const [map, A] of Object.entries(MAPS)) {
    for (const [id] of A.beds) { assert.equal(M[id]?.kind, 'amb', `${map}: bed ${id}`); assert.ok(!seen.has(id), `${id} belongs to one map`); seen.add(id); }
    const spots = Object.entries(M).filter(([, e]) => e.kind === 'spot' && e.spot.maps.includes(map));
    assert.ok(spots.length >= 4, `${map}: ${spots.length} kinds of spot`);
    for (const [id, e] of spots) assert.ok(e.spot.every[0] >= 5 && e.spot.every[1] > e.spot.every[0] && e.takes.length >= 2, `${id}: comes now and then, a few takes`);
  }
  const only = (map) => new Set(Object.entries(M).filter(([, e]) => e.kind === 'spot' && e.spot.maps.length === 1 && e.spot.maps[0] === map).map(([id]) => id));
  assert.ok(only('trench').size >= 3 && only('city').size >= 2 && only('night').size >= 3, 'every map has things only it has');
});

/**
 * The strongest held line in a sound (dB): its long-term spectrum's highest peak between 300 Hz and
 * 8 kHz (and not 40 dB under its loudest, where it'd go unheard) over the median of the third of an
 * octave round it. Noise, crackle and rumble come out at 2 to 4 dB; a pure tone at 30 or more.
 */
function held(x, sr) {
  const n = 4096, P = new Float64Array(n / 2), re = new Float64Array(n), im = new Float64Array(n);
  for (let a = 0; a + n <= x.length; a += n / 2) {
    for (let i = 0; i < n; i++) { re[i] = x[a + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n)); im[i] = 0; }
    fft(re, im);
    for (let k = 0; k < n / 2; k++) P[k] += re[k] * re[k] + im[k] * im[k];
  }
  const lo = Math.ceil((300 * n) / sr), hi = Math.floor((8000 * n) / sr);
  let top = 0, best = 0;
  for (let k = lo; k <= hi; k++) top = Math.max(top, P[k]);
  for (let k = lo; k <= hi; k++) {
    if (P[k] < P[k - 1] || P[k] < P[k + 1] || P[k] < top * 1e-4) continue;
    const round = Array.from(P.subarray(Math.floor(k / 1.26), Math.ceil(k * 1.26) + 1)).sort((a, b) => a - b);
    best = Math.max(best, 10 * Math.log10(P[k] / round[round.length >> 1]));
  }
  return best;
}

test('forge: nothing in the atmosphere whines: no held tone in a spot or in the singing wind; the alarms are horns, not beeps', () => {
  // (Every spot comes back again and again through a match, and the night's singing wind never stops:
  // a tone held in any of them is the one sound you'd want gone. The sirens and the klaxon are meant
  // to be heard as notes, far off, but rough ones: the old klaxon, a pure beep, held a line 60 dB up.)
  const R = atmos((id) => id.startsWith('spot:') || id === 'amb:night:sing');
  assert.ok(Object.keys(R).length >= 15, 'every spot');
  for (const [id, e] of Object.entries(R)) {
    const max = /siren|raid|klaxon/.test(id) ? 36 : 12;
    for (const [i, b] of e.takes.entries()) {
      const db = held(b.L, 48000);
      assert.ok(db < max, `${id} take ${i + 1}: a line held ${db.toFixed(1)} dB over what's round it`);
    }
  }
});

test('distance: quieter, later, duller and more room the further off; the far layer takes over as the crack goes first', () => {
  let last = distanceShape(1, 'gun');
  for (const d of [10, 40, 120, 400, 1000]) {
    const s = distanceShape(d, 'gun');
    assert.ok(s.gain < last.gain && s.cutoff <= last.cutoff && s.wet >= last.wet, `at ${d} m`);
    last = s;
  }
  // Past 60 m the ground takes more: 3 dB more for every doubling on top of the spreading.
  const k = KINDS.gun, g = (d) => distanceShape(d, 'gun').gain;
  assert.ok(Math.abs(20 * Math.log10(g(240) / g(120)) - (-6 * k.rolloff - 3)) < 0.5, 'spreading and the ground past 60 m');
  for (const kind of Object.keys(LAYERS)) {
    const W = LAYERS[kind];
    for (const [name, [a, b]] of Object.entries(W)) assert.ok(a < b, `${kind}.${name}: a window`);
    const w0 = layerWeights(0, kind), w9 = layerWeights(5000, kind);
    for (const name of Object.keys(W)) {
      if (name === 'far') { assert.equal(w0.far, 0); assert.ok(w9.far > 0.999); }
      else { assert.equal(w0[name], 1, `${kind}.${name} whole up close`); assert.ok(w9[name] < 0.001, `${kind}.${name} gone far off`); }
    }
  }
  const G = LAYERS.gun;
  assert.ok(G.mech[1] <= G.crack[1] && G.crack[1] <= G.low[1] && G.low[1] <= G.body[1], 'the mechanism goes first, then the crack, the low end, the body last');
  assert.ok(loudness(1, 'boom') > loudness(1, 'gun') && loudness(1, 'gun') > loudness(1, 'foley'), 'a blast louder than a shot louder than a step');
  assert.ok(distanceShape(900, 'boom').gain > distanceShape(900, 'gun').gain, 'a shell carries further than a rifle');
});

test('the engine finds the forged sound for the ids the game plays', () => {
  const E = { manifest: M }, find = (id) => SoundEngine.prototype.recordedId.call(E, id);
  assert.equal(find('gun:ar_sol:near'), 'gun:ar_sol');
  assert.equal(find('gun:ar_sol:1p'), 'gun:ar_sol');
  assert.equal(find('laser:pulse_void:near'), 'laser:pulse_void');
  assert.equal(find('boom:shell:near'), 'boom:shell');
  assert.equal(find('foot:snow'), 'foot:snow');
  assert.equal(find('incoming'), 'incoming');
  assert.equal(find('amb:night:air'), 'amb:night:air');
  assert.equal(find('engine:tracked'), null, 'what has no forged version stays synthesized');
});

/** A stand-in engine for the Ambience: loops kept, plays recorded, time advancing with update(). */
function fakeEngine() {
  return {
    running: true, manifest: M, listener: { x: 0, y: 1.6, z: 0, yaw: 0 }, loops: new Map(), plays: [],
    loop(key, id, o) { this.loops.set(key, { id, ...o }); }, updateLoop(key, o) { Object.assign(this.loops.get(key) ?? {}, o); },
    stopLoop(key) { this.loops.delete(key); }, hasLoop(key) { return this.loops.has(key); },
    play(id, o) { this.plays.push({ id, ...o }); return {}; },
  };
}

test('the atmosphere: a map\'s beds playing, its spots round you on their own clocks, the war going on far off', () => {
  for (const map of ['trench', 'city', 'night']) {
    const E = fakeEngine(), A = new Ambience(E, map, { rand: rng(7) });
    for (let i = 0; i < 300 * 20; i++) A.update(0.05);                 // five minutes
    assert.deepEqual([...E.loops.values()].map((l) => l.id).sort(), MAPS[map].beds.map(([id]) => id).sort(), `${map}: its beds`);
    assert.ok([...E.loops.values()].every((l) => l.amb), `${map}: on the atmosphere's bus`);
    const spots = E.plays.filter((p) => p.kind === 'spot'), war = E.plays.filter((p) => p.kind === 'war');
    const kinds = new Set(spots.map((p) => p.id));
    assert.ok(kinds.size >= 4, `${map}: ${kinds.size} kinds of spot in five minutes`);
    for (const p of spots) assert.ok(M[p.id].spot.maps.includes(map), `${p.id} belongs on ${map}`);
    for (const p of spots) {
      const d = Math.hypot(p.pos.x, p.pos.z), [a, b] = M[p.id].spot.dist;
      assert.ok(d >= a - 1e-6 && d <= b + 1e-6, `${p.id} at ${d.toFixed(0)} m`);
    }
    assert.ok(war.length > 40, `${map}: the war beyond the map (${war.length} sounds)`);
    assert.ok(war.every((p) => Math.hypot(p.pos.x, p.pos.z) > 400), `${map}: and far off`);
    // Nothing comes back on a beat: the gaps between one kind of spot all differ.
    const t = spots.filter((p) => p.id === [...kinds][0]).length;
    assert.ok(t >= 2, `${map}: a spot comes back`);
  }
});
