// The Audio Revamp (audio/manifest.json, built by tools/audio/revamp.mjs from the recorded packs):
// every file there and a real Ogg; several takes of every sound so nothing repeats (three at the
// least, more for the guns); the guns and blasts in three distance versions plus your own gun's
// first-person one; every weapon in the game's data heard through a recording; the distance
// crossfade sane; and the engine finding a recording for the ids the game asks for.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { tierWeights, TIERS, SoundEngine } from '../src/audio/SoundEngine.js';
import { weaponDesign } from '../src/audio/SoundBank.js';
import { data as H } from './harness.mjs';

const ROOT = new URL('../audio/', import.meta.url);
const M = JSON.parse(readFileSync(new URL('manifest.json', ROOT))).sounds;
const ONE_TAKE = /^(arrow:\d+|music:|ui:hero)/;           // a rising tone per arrow; the stingers are one each

test('audio revamp: every file is there and an Ogg, every sound has its takes and its distance versions', () => {
  let files = 0, bytes = 0;
  for (const [id, e] of Object.entries(M)) {
    const tiers = Object.keys(e.tiers);
    if (e.kind === 'gun') assert.deepEqual(tiers.sort(), ['1p', 'far', 'mid', 'near'], `${id}: near, mid, far and first person`);
    if (e.kind === 'boom') assert.deepEqual(tiers.sort(), ['far', 'mid', 'near'], `${id}: near, mid and far`);
    for (const [tier, list] of Object.entries(e.tiers)) {
      const min = ONE_TAKE.test(id) ? 1 : tier === 'far' ? 3 : 3;
      assert.ok(list.length >= min, `${id} ${tier}: ${list.length} takes`);
      for (const f of list) {
        const file = new URL(f, ROOT);
        assert.ok(existsSync(file), `${f} exists`);
        const fd = openSync(file, 'r'), head = Buffer.alloc(4); readSync(fd, head, 0, 4, 0); closeSync(fd);
        assert.equal(head.toString('latin1'), 'OggS', `${f} is an Ogg file`);
        files++; bytes += statSync(file).size;
      }
    }
  }
  const guns = Object.entries(M).filter(([, e]) => e.kind === 'gun');
  assert.ok(guns.every(([, e]) => e.tiers.near.length >= 3), 'three takes or more of every gun up close');
  assert.ok(guns.filter(([, e]) => e.tiers.near.length >= 6).length >= 12, 'most guns have six takes or more');
  assert.ok(M['foot:snow'] && M['foot:concrete'] && M['foot:dirt'].tiers.near.length >= 8, 'footsteps by surface, eight takes on dirt');
  assert.ok(bytes < 12 * 1048576, `the whole set is light (${(bytes / 1048576).toFixed(1)} MB in ${files} files)`);
});

test('audio revamp: every weapon in the game sounds through a recording', () => {
  const specs = [...Object.values(H.ballistic.weapons ?? {}), ...(Array.isArray(H.ballistic.weapons) ? H.ballistic.weapons : []), ...(H.energy.weapons ?? []), ...Object.values(H.vehicles.weapons ?? {}), ...Object.values(H.supers?.weapons ?? {})];
  assert.ok(specs.length > 20, `${specs.length} weapons`);
  const missing = [];
  for (const s of specs) {
    const [kind, profile] = weaponDesign(s);
    if (kind === 'beam') continue;                          // beams are seamless loops, still made in code
    if (!M[`${kind}:${profile}`]) missing.push(`${s.id} (${kind}:${profile})`);
  }
  assert.deepEqual(missing, [], 'no weapon left on the synthesized sounds');
});

test('audio revamp: near, mid and far crossfade by distance and always sum to one', () => {
  for (const kind of Object.keys(TIERS)) {
    let lastFar = -1;
    for (let d = 0; d <= 600; d += 5) {
      const w = tierWeights(d, kind);
      assert.ok(Math.abs(w.near + w.mid + w.far - 1) < 1e-9, `${kind} at ${d} m sums to 1`);
      assert.ok(w.far >= lastFar - 1e-12, `${kind}: far only grows`);
      lastFar = w.far;
    }
    assert.equal(tierWeights(0, kind).near, 1, `${kind}: up close, all near`);
    assert.ok(tierWeights(TIERS[kind].mid[1] + 1, kind).mid > 0.99, `${kind}: mid by ${TIERS[kind].mid[1]} m`);
    assert.ok(tierWeights(TIERS[kind].far[1] + 1, kind).far > 0.99, `${kind}: far by ${TIERS[kind].far[1]} m`);
  }
});

test('audio revamp: the engine finds the recording for the ids the game plays', () => {
  const E = { manifest: M }, find = (id) => SoundEngine.prototype.recordedId.call(E, id);
  assert.equal(find('gun:ar_sol:near'), 'gun:ar_sol');
  assert.equal(find('gun:ar_sol:far'), 'gun:ar_sol');
  assert.equal(find('gun:ar_sol:1p'), 'gun:ar_sol');
  assert.equal(find('boom:shell:near'), 'boom:shell');
  assert.equal(find('foot:snow'), 'foot:snow');
  assert.equal(find('ui:hit_kill'), 'ui:hit_kill');
  assert.equal(find('incoming'), null, 'what has no recording stays synthesized');
  assert.equal(find('amb:city'), null);
});
