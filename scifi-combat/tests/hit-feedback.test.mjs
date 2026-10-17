// Hit feedback, the sim's side of it (docs/GAMEPLAY_PLAN.md §1): a hit knocks the victim's gun
// off its aim (half the camera's flinch) and the ergonomics chase brings it back; hit events say
// what the armor made of the round (the HUD's grey marker, the dull plink); a blast tells its
// victims where it burst (the damage indicator).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { bus } from '../src/core/EventBus.js';
import { makeWorld, v, data } from './harness.mjs';
import { buildWeapon } from '../src/combat/weapons/WeaponDefs.js';

test('a hit knocks the victim\'s gun up off its aim, and the ergonomics chase brings it back', () => {
  const w = makeWorld();
  const A = w.fighter(1, 0, v(0, 0, 0), 'lancer', { hp: 500 });
  const B = w.fighter(2, 1, v(0, 0, -10), 'lancer', { hp: 5000 });
  A.mode = 'gun'; B.mode = 'gun';
  w.step(5);                                   // both guns settled on their aim
  const before = B.weapons.weaponPitch;
  const hits = [];
  const off = bus.on('weapon:hit', (e) => { if (e.victim === B.id) hits.push(e); });
  w.aimAt(A, v(0, 1.2, -10));
  w.press(A, 'light');
  w.step(1);
  off();
  assert.ok(hits.length, 'hit him');
  const kick = B.weapons.weaponPitch - before, want = (Math.min(3, 0.6 * (hits[0].damage / 20)) * 0.5 * Math.PI) / 180;
  assert.ok(kick > want * 0.5 && kick <= want * 1.01, `the gun kicked up (${(kick * 180 / Math.PI).toFixed(2)}° of ${(want * 180 / Math.PI).toFixed(2)}°)`);
  assert.equal(hits[0].armorMul, 1, 'the event says what the armor made of it');
  w.seconds(0.5);
  assert.ok(Math.abs(B.weapons.weaponPitch - before) < want * 0.05, 'and back on aim half a second later');
});

test('a blast tells whoever it hurt where it burst, and flinches their gun', () => {
  const w = makeWorld();
  const A = w.fighter(1, 0, v(0, 0, 0), 'lancer', { hp: 500 });
  const B = w.fighter(2, 1, v(2, 0, -8), 'lancer', { hp: 5000 });
  B.mode = 'gun';
  w.step(5);
  let got = null;
  const prev = B.onHit;
  B.onHit = (res, info, by) => { got = info; prev(res, info, by); };
  const before = B.weapons.weaponPitch;
  const at = new Vector3(0, 0, -8);
  w.world.explode(at, 5, { id: 'test_blast', damage: { base: 80 }, ammoType: 'explosive' }, { ownerId: A.id, team: 0 });
  assert.ok(got, 'hurt');
  assert.deepEqual(got.from, [0, 0, -8], 'with where it burst');
  assert.ok(B.weapons.weaponPitch > before, 'and his gun flinched');
});

test('a suppressor goes on a gun whose sound is a plain id, and quiets it', () => {
  const plain = buildWeapon(data.ballistic, 'sol_ar_halcyon', data.attachments, []);
  const quiet = buildWeapon(data.ballistic, 'sol_ar_halcyon', data.attachments, ['barrel_suppressor']);
  assert.equal(quiet.audio, plain.audio, 'the sound id is left alone');
  assert.ok(quiet.audioRadius < 0.5, 'heard a third as far');
  assert.equal(quiet.minimapOnFire, false, 'and off the minimap');
});
