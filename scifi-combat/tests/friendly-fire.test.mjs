// Friendly fire (data/rules.json: Helldivers rules). Everything that hurts an enemy hurts a
// teammate by the rules' share (all of it by default). Bots hold fire rather than shoot through
// their own side: they step aside for a clean line, and they don't throw a blast onto friends.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeWorld, v } from './harness.mjs';
import { lineClearOfFriends } from '../src/ai/FireDiscipline.js';

const rules = JSON.parse(readFileSync(new URL('../data/rules.json', import.meta.url)));

test('rules: friendly fire is on everywhere by default (data/rules.json)', () => {
  const w = makeWorld();
  for (const k of ['gun', 'beam', 'projectile', 'explosion', 'status', 'melee', 'ram', 'deployable', 'zone']) assert.equal(w.world.ff[k], 1, k);
  for (const [k, share] of Object.entries(rules.friendlyFire)) assert.equal(w.world.ff[k], share, `rules.json ${k}`);
});

/** A rifleman with a teammate standing between him and an enemy 20 m out. */
function lineOfFire() {
  const w = makeWorld();
  const A = w.fighter(1, 0, v(0, 0, 0), 'lancer');
  const F = w.fighter(2, 0, v(0, 0, -8), 'lancer', { hp: 1000 });
  const E = w.fighter(3, 1, v(0, 0, -20), 'monolith', { hp: 1000 });
  for (const e of [A, F, E]) e.mode = 'gun';
  return { w, A, F, E };
}

test('a rifle round hits the teammate standing in the line of fire, not the enemy behind him', () => {
  const { w, A, F, E } = lineOfFire();
  const super0 = A.abilities.superEnergy;
  w.aimAt(A, v(0, 1.3, -20));
  w.seconds(0.3);
  w.hold(A, 'light'); w.seconds(0.6); w.release(A, 'light'); w.seconds(0.2);
  assert.ok(F.health.hp < 1000 - 40, `the teammate took the rounds (${1000 - F.health.hp} damage)`);
  assert.equal(E.health.hp, 1000, 'the enemy behind him was shielded');
  assert.ok(A.abilities.superEnergy <= super0 + 0.35 * 1.2, 'shooting your own side earns no super energy');
});

test('with the gun share at 0 a teammate still blocks the rounds but takes no damage', () => {
  const { w, A, F, E } = lineOfFire();
  w.world.ff.gun = 0;
  w.aimAt(A, v(0, 1.3, -20));
  w.seconds(0.3);
  w.hold(A, 'light'); w.seconds(0.6); w.release(A, 'light'); w.seconds(0.2);
  assert.equal(F.health.hp, 1000);
  assert.equal(E.health.hp, 1000);
});

test('a blast hurts everyone in it: enemies fully, teammates by the share, its owner by the self share', () => {
  const w = makeWorld();
  const A = w.fighter(1, 0, v(0, 0, 0), 'lancer', { hp: 1000 });
  const F = w.fighter(2, 0, v(2, 0, -6), 'lancer', { hp: 1000 });
  const E = w.fighter(3, 1, v(-2, 0, -6), 'monolith', { hp: 1000 });
  const shell = { id: 'test_shell', damage: { base: 200, splash: 8 }, ammoType: 'explosive', knockback: 0 };
  w.world.explode(v(0, 0, -6), 8, shell, { ownerId: A.id, team: 0, spec: { damageMul: 1 } });
  const dF = 1000 - F.health.hp, dE = 1000 - E.health.hp, dA = 1000 - A.health.hp;
  assert.ok(dF > 50, `teammate hurt (${dF})`);
  assert.ok(Math.abs(dF - dE) < 1e-6 * 1000 + 25, `as much as the enemy at the same distance (${dF} vs ${dE})`);
  assert.ok(dA > 0 && dA < dF, `the owner took his own blast at the self share (${dA})`);
  w.world.ff.explosion = 0.25;
  const f0 = F.health.hp;
  w.world.explode(v(0, 0, -6), 8, shell, { ownerId: A.id, team: 0, spec: { damageMul: 1 } });
  assert.ok(Math.abs((f0 - F.health.hp) - dF * 0.25) < dF * 0.02 + 0.5, 'a quarter share takes a quarter');
});

test('a sword swing lands on a teammate in its arc', () => {
  const w = makeWorld();
  const A = w.fighter(1, 0, v(0, 0, 0), 'lancer');
  const F = w.fighter(2, 0, v(0, 0, -1.4), 'lancer', { hp: 1000 });
  w.aim(A, 0);
  w.press(A, 'light');
  w.seconds(0.7);
  assert.ok(F.health.hp < 1000, `the swing hit the teammate (${1000 - F.health.hp})`);
});

test('fire discipline: the line check sees a teammate in the way and in the blast, not one off to the side', () => {
  const { w, A, F } = lineOfFire();
  const from = v(0, 1.6, 0), to = v(0, 1.0, -20);
  assert.equal(lineClearOfFriends(w.world, 0, from, to, { exclude: A }), false, 'teammate on the line');
  F.movement.state.position.set(2.5, 0, -8);
  assert.equal(lineClearOfFriends(w.world, 0, from, to, { exclude: A }), true, 'teammate 2.5 m off the line');
  F.movement.state.position.set(3, 0, -19);
  assert.equal(lineClearOfFriends(w.world, 0, from, to, { exclude: A, splash: 4 }), false, 'teammate inside the blast at the far end');
  assert.equal(lineClearOfFriends(w.world, 1, from, v(10, 1, -5)), true, 'the other side has nobody of its own on that line');
});

test('a bot never shoots through a teammate: it steps aside for a clean line, then fires', () => {
  const w = makeWorld();
  const B = w.bot(1, 0, v(0, 0, 0), 'lancer');
  const F = w.fighter(2, 0, v(0, 0, -9), 'lancer', { hp: 1000 });       // stands still, right in the way
  const E = w.fighter(3, 1, v(0, 0, -22), 'monolith', { hp: 3000 });
  B.abilities.slots.grenade.charges = 0; B.abilities.slots.grenade.cooldown = 999;
  for (const k of ['ability1', 'ability2', 'super']) if (B.abilities.slots[k]) B.abilities.slots[k].cooldown = 999;
  w.seconds(6);
  assert.equal(F.health.hp, 1000, 'not a single round into the teammate');
  assert.ok(E.health.hp < 3000 - 100, `and the enemy still got shot (${3000 - E.health.hp} damage) once the line was clear`);
});
