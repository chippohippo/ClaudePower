import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, v } from './harness.mjs';

test('720 rpm fires 18 rounds in 1.5 s at a 60 Hz tick', () => {
  const { fighter, hold, seconds } = makeWorld();
  const A = fighter(1, 0, v(0, 0, 0), 'lancer');
  const start = A.weapons.current.mag;
  hold(A, 'light'); seconds(1.5);
  assert.ok(Math.abs(start - A.weapons.current.mag - 18) <= 1);
});

test('Scorch at 100 stacks Ignites and bursts', () => {
  const { fighter } = makeWorld();
  const A = fighter(1, 0, v(0, 0, 0), 'lancer');
  const B = fighter(2, 1, v(0, 0, -2), 'monolith');
  B.status.apply('scorch', { stacks: 100, source: A });
  assert.ok(B.status.has('ignite'));
  assert.ok(B.health.hp < 200);
});

test('Suppress interrupts a cast and refunds half the cooldown', () => {
  const { fighter, press, step } = makeWorld();
  const A = fighter(1, 0, v(0, 0, 0), 'bastion');
  press(A, 'ability1'); step(5);
  assert.equal(A.abilities.casting?.key, 'ability1');
  A.status.apply('suppress', {});
  assert.equal(A.abilities.casting, null);
  assert.ok(A.abilities.slots.ability1.cooldown <= 15.1);
});
