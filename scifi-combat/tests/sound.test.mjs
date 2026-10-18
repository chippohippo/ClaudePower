// The sound (src/audio/): every sound in the bank renders clean; every gun has its own voice;
// kinetic guns crack and thump, lasers chirp down, far versions are duller and longer; distance
// does what it does to sound (quieter, later, duller, more echo, the far version taking over);
// the city's room answers; every weapon in the game has a design; and the director turns the
// battle's events into the right sounds (through a stand-in engine: Node has no WebAudio).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { catalogue, render, variantsOf, weaponDesign, abilityId } from '../src/audio/SoundBank.js';
import { distanceShape, impulse, KINDS } from '../src/audio/SoundEngine.js';
import { AudioDirector } from '../src/audio/AudioDirector.js';
import { centroid, rms, peak, lowpass, SR } from '../src/audio/dsp.js';
import { bus } from '../src/core/EventBus.js';

const J = (p) => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url)));
const mono = (o) => o.ch[0];
const dur = (o) => o.ch[0].length / o.sr;

test('every sound in the bank renders clean: finite, audible, never clipping, one or two channels of equal length', () => {
  const ids = [...catalogue(), abilityId({ root: 'E4', timbre: 'brass_stab' }, 'sol', 'cast'), abilityId({ root: 'C3', timbre: 'grav_thrum' }, 'void', 'threat'), abilityId({ root: 'G4', timbre: 'glass_drone' }, 'sol', 'loop')];
  assert.ok(ids.length > 150, `${ids.length} sounds`);
  for (const id of ids) {
    const o = render(id, 0);
    assert.ok(o.ch.length === 1 || o.ch.length === 2, id);
    if (o.ch.length === 2) assert.equal(o.ch[0].length, o.ch[1].length, id);
    let bad = false;
    for (const c of o.ch) for (let i = 0; i < c.length; i += 5) if (!Number.isFinite(c[i])) { bad = true; break; }
    assert.ok(!bad, `${id}: finite`);
    const p = Math.max(...o.ch.map(peak));
    assert.ok(p > 0.05 && p <= 1.0001, `${id}: peak ${p.toFixed(3)}`);
    assert.ok(dur(o) > 0.02 && dur(o) < 9, `${id}: ${dur(o).toFixed(2)} s`);
  }
});

test('variants are siblings, not copies; a loop has one; distant sounds are mono at half rate', () => {
  const a = render('gun:ar_sol:near', 0), b = render('gun:ar_sol:near', 1);
  assert.ok(Math.abs(dur(a) - dur(b)) < 0.05, 'the same length');
  let diff = 0; for (let i = 0; i < a.ch[0].length; i += 3) diff += Math.abs(a.ch[0][i] - b.ch[0][i]);
  assert.ok(diff > 1, 'but not the same samples');
  assert.equal(variantsOf('engine:tracked'), 1);
  assert.ok(variantsOf('impact:metal') >= 3 && variantsOf('gun:ar_sol:near') >= 3);
  const f = render('gun:ar_sol:far', 0);
  assert.equal(f.ch.length, 1); assert.equal(f.sr, SR / 2);
});

test('kinetic guns crack and thump: the peak in the first few ms, real weight under 200 Hz', () => {
  for (const p of ['ar_sol', 'smg_void', 'sg_sol', 'sr_void', 'hmg', 'cannon']) {
    const x = mono(render(`gun:${p}:near`, 0));
    let at = 0, pk = 0; for (let i = 0; i < Math.min(x.length, SR * 0.2); i++) if (Math.abs(x[i]) > pk) { pk = Math.abs(x[i]); at = i; }
    assert.ok(at / SR < 0.04, `${p}: peak at ${(at / SR * 1000).toFixed(1)} ms`);
    const low = lowpass(x.slice(0, SR * 0.15), 200, 0.7);
    assert.ok(rms(low, 0, 0.1) > rms(x, 0, 0.1) * 0.12, `${p}: a thump under it`);
  }
});

test('lasers chirp down (bright at the start, lower after), and Void plasma sits darker than Solari hard light', () => {
  for (const p of ['pulse_sol', 'pulse_void', 'light_sol', 'lance_void']) {
    const x = mono(render(`laser:${p}:near`, 0)), t0 = p.endsWith('void') ? 0.03 : 0;
    const early = centroid(x, t0 + 0.004, 0.02), late = centroid(x, t0 + 0.09, 0.05);
    assert.ok(early > late * 1.15, `${p}: ${early.toFixed(0)} Hz early, ${late.toFixed(0)} Hz later`);
  }
  const sol = centroid(mono(render('laser:pulse_sol:near', 0)), 0.005, 0.08), voidC = centroid(mono(render('laser:pulse_void:near', 0)), 0.035, 0.08);
  assert.ok(voidC < sol, `Void ${voidC.toFixed(0)} Hz under Solari ${sol.toFixed(0)} Hz`);
});

test('every gun has its own voice: no two near versions alike in brightness and length', () => {
  const ids = catalogue().filter((id) => /^(gun|laser):.*:near$/.test(id));
  const feat = ids.map((id) => { const o = render(id, 0), x = mono(o); let tail = x.length; for (let i = x.length - 1; i > 0; i--) if (Math.abs(x[i]) > 0.05) { tail = i; break; } return { id, c: centroid(x, 0, 0.06), len: tail / o.sr, lo: rms(lowpass(x.slice(0, Math.floor(o.sr * 0.15)), 250, 0.7), 0, 0.12) }; });
  for (let i = 0; i < feat.length; i++) for (let j = i + 1; j < feat.length; j++) {
    const a = feat[i], b = feat[j];
    const d = Math.abs(Math.log(a.c / b.c)) + Math.abs(Math.log(a.len / b.len)) + Math.abs(Math.log((a.lo + 1e-4) / (b.lo + 1e-4))) * 0.5;
    assert.ok(d > 0.08, `${a.id} and ${b.id} too alike (${d.toFixed(3)})`);
  }
});

test('far away: duller, longer (the city rolling it back), and from much further it takes longer to arrive', () => {
  for (const id of ['gun:ar_sol', 'laser:pulse_void', 'boom:shell']) {
    const n = render(`${id}:near`, 0), f = render(`${id}:far`, 0);
    assert.ok(centroid(mono(f), 0.01, 0.1, f.sr) < centroid(mono(n), 0.01, 0.1, n.sr), `${id}: duller far off`);
    assert.ok(dur(f) > dur(n), `${id}: longer far off`);
  }
  const a = distanceShape(10, 'gun'), b = distanceShape(150, 'gun'), c = distanceShape(600, 'gun');
  assert.ok(a.gain > b.gain && b.gain > c.gain, 'quieter');
  assert.ok(a.cutoff > b.cutoff && b.cutoff > c.cutoff, 'duller (the air takes the highs)');
  assert.ok(Math.abs(c.delay - 600 / 343) < 1e-9, 'late by the speed of sound');
  assert.ok(a.wet < b.wet && b.wet <= c.wet, 'more of the city answering');
  assert.ok(a.far === 0 && c.far === 1 && b.far > 0.5, 'the far version takes over');
  assert.equal(distanceShape(KINDS.foley.max + 1, 'foley').gain, 0, 'footsteps past earshot are silent');
  assert.ok(distanceShape(900, 'boom').gain > distanceShape(900, 'gun').gain, 'a shell carries further than a rifle');
});

test("the city's room: walls close by answer early, the facades across the street slap back, then a tail that dies away", () => {
  const [L] = impulse('city'), [O] = impulse('open');
  assert.ok(rms(L, 0, 0.1) > rms(L, 1.5, 0.5) * 4, 'loud early, quiet late');
  assert.ok(rms(L, 0.13, 0.04) > rms(L, 0.5, 0.04), 'the slap back off the facades');
  assert.ok(centroid(L, 1.2, 0.3) < centroid(L, 0.02, 0.1), 'the tail darkens');
  assert.ok(L.length > O.length, 'the city rings longer than the open front');
});

test('every weapon in the game has a design in the bank', () => {
  const ids = new Set(catalogue());
  const specs = [...J('weapons/ballistic.json').weapons, ...J('weapons/energy.json').weapons, ...Object.entries(J('vehicles.json').weapons).map(([id, w]) => ({ id, ...w })), ...Object.values(J('supers.json').weapons)];
  for (const s of specs) {
    const [kind, p] = weaponDesign(s);
    if (kind === 'beam') { assert.ok(ids.has(`beam:${p}`), `${s.id}: beam ${p}`); continue; }
    for (const v of ['near', 'far', '1p']) assert.ok(ids.has(`${kind}:${p}:${v}`), `${s.id} -> ${kind}:${p}:${v}`);
  }
  assert.deepEqual(weaponDesign({ id: 'void_pr_umbra', archetype: 'pulseRifle' }), ['laser', 'pulse_void']);
  assert.deepEqual(weaponDesign({ id: 'sol_sg_lantern', archetype: 'shotgun' }), ['gun', 'sg_sol']);
});

/** A stand-in engine: what the director asked for. */
function fakeEngine() {
  return {
    running: true, plays: [], loops: new Map(), shocks: [], prefetched: [], listener: { x: 0, y: 0, z: 0 },
    play(id, o = {}) { this.plays.push({ id, ...o }); return { id }; },
    stop() {}, loop(key, id, o) { this.loops.set(key, { id, ...o }); }, updateLoop() {}, stopLoop(key) { this.loops.delete(key); },
    hasLoop(key) { return this.loops.has(key); }, shock(k) { this.shocks.push(k); }, setMuffle() {}, setListener() {}, prefetch(ids) { this.prefetched.push(...ids); },
  };
}

test('the director: your gun in your ears, theirs near and far, rounds past you crack, a blast close shocks you, snow underfoot', () => {
  const E = fakeEngine();
  const ents = {
    1: { team: 0, position: { x: 0, y: 0, z: 0 }, weapon: { id: 'sol_ar_halcyon', archetype: 'assaultRifle' }, loadout: [{ id: 'sol_ar_halcyon', archetype: 'assaultRifle' }], hpFrac: 1 },
    2: { team: 1, position: { x: 0, y: 0, z: -40 }, weapon: { id: 'void_pr_umbra', archetype: 'pulseRifle' } },
    3: { team: 1, position: { x: 0, y: 0, z: -30 }, weapon: { id: 'void_sr_needle', archetype: 'sniper' } },
  };
  const A = new AudioDirector(E, { listenerId: 1, getEntity: (id) => ents[id] ?? null, snow: true });
  assert.ok(E.prefetched[0] === 'gun:ar_sol:1p', 'your own gun first');
  A.update(1 / 60, ents[1].position, 0);
  bus.emit('weapon:fire', { id: 1, weaponId: 'sol_ar_halcyon' });
  assert.equal(E.plays.at(-1).id, 'gun:ar_sol:1p');
  assert.ok(!E.plays.at(-1).pos, 'in your ears, not out in the world');
  bus.emit('weapon:fire', { id: 2, weaponId: 'void_pr_umbra' });
  const theirs = E.plays.at(-1);
  assert.equal(theirs.id, 'laser:pulse_void:near'); assert.equal(theirs.far, 'laser:pulse_void:far'); assert.ok(theirs.pos && theirs.kind === 'gun');
  // A sniper round passing a metre from your head: a crack. One passing 6 m off: nothing.
  bus.emit('weapon:tracer', { id: 3, from: [1, 1.6, -30], dir: [0, 0, 1], dist: 80 });
  assert.equal(E.plays.at(-1).id, 'crack');
  const n = E.plays.length;
  bus.emit('weapon:tracer', { id: 3, from: [6, 1.6, -30], dir: [0, 0, 1], dist: 80 });
  assert.equal(E.plays.length, n);
  // A Void bolt past you buzzes (their army's bolt).
  bus.emit('weapon:tracer', { id: 2, from: [0.8, 1.6, -40], dir: [0, 0, 1], dist: 90 });
  assert.equal(E.plays.at(-1).id, 'whizz:void');
  // A grenade 4 m off: the boom near and far, and shell shock; one 200 m off doesn't shock you.
  bus.emit('projectile:explode', { point: [4, 0, 0], radius: 3.5, ownerId: 2 });
  assert.equal(E.plays.at(-1).id, 'boom:vehicle:near'); assert.equal(E.plays.at(-1).far, 'boom:vehicle:far');
  assert.equal(E.shocks.length, 1);
  bus.emit('projectile:explode', { point: [200, 0, 0], radius: 3.5, ownerId: 2 });
  assert.equal(E.shocks.length, 1);
  // Snow underfoot in the dusk city, metal stays metal.
  bus.emit('anim:footstep', { id: 2, gait: 'jog', intensity: 1, surface: 'dirt', x: 0, y: 0, z: -3 });
  assert.equal(E.plays.at(-1).id, 'foot:snow');
  bus.emit('anim:footstep', { id: 2, gait: 'jog', intensity: 1, surface: 'metal', x: 0, y: 0, z: -3 });
  assert.equal(E.plays.at(-1).id, 'foot:metal');
  // A tank arriving: its engine loop. Gone: the loop stops.
  bus.emit('vehicle:spawn', { id: 50, model: 'tracked', at: [0, 0, -20] });
  assert.equal(E.loops.get('veh:50')?.id, 'engine:tracked');
  bus.emit('vehicle:removed', { id: 50 });
  assert.ok(!E.loops.has('veh:50'));
  // Hit: your marker; hit on you: your armor.
  bus.emit('weapon:hit', { attacker: 1, victim: 2, zone: 'head' });
  assert.equal(E.plays.at(-1).id, 'ui:hit_head');
  bus.emit('weapon:hit', { attacker: 2, victim: 1, zone: 'body' });
  assert.equal(E.plays.at(-1).id, 'hit:armor');
  A.dispose();
});
