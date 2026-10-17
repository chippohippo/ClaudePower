// Melee on the front (src/combat/melee/MeleeSystem.js, MeleeWeapons.js, ReviveSystem finishers,
// docs/GAMEPLAY_PLAN.md §4): every class its own blade; the blade swept along the rig's swing
// against the hit spheres, so what you see is what hits; a gunner's rifle-butt shove; finishers
// on the downed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bus } from '../src/core/EventBus.js';
import { makeWorld, v, data } from './harness.mjs';
import { meleeWeapon, meleeFor } from '../src/combat/melee/MeleeWeapons.js';
import { BASH } from '../src/combat/melee/MeleeSystem.js';

function events(names) {
  const got = [];
  const offs = names.map((n) => bus.on(n, (e) => got.push({ type: n, ...e })));
  return { got, off: () => offs.forEach((f) => f()) };
}

/** A swordsman facing north and a target `d` m in front of him (or behind, with a negative d). */
function duel(d, { weapon = 'solari_dawnblade', stance = 'stand' } = {}) {
  const w = makeWorld();
  const A = w.fighter(1, 0, v(0, 0, 0), 'dawnblade', { hp: 5000 });
  const B = w.fighter(2, 1, v(0, 0, -d), 'lancer', { hp: 5000 });
  A.melee.setMoveset(meleeWeapon(data.melee, weapon));
  A.mode = 'sword'; B.mode = 'gun';
  for (const g of A.weapons.loadout) { g.mag = 0; g.reserve = 0; }      // (scripted fighters' guns hear the same buttons)
  w.aim(A, 0, 0);
  B.movement.state.stance = stance;
  w.step(3);
  return { w, A, B };
}

const swing = (w, A) => { w.press(A, 'light'); w.seconds(0.5); };

test('every class swings its own blade, built on a base moveset', () => {
  const all = data.classes.flatMap((f) => f.classes.map((c) => [c, f.faction ?? (f.classes === data.classes[1].classes ? 'void' : 'solari')]));
  for (const [c, faction] of all) assert.ok(meleeFor(data.melee, c, faction), `${c.id} has a blade`);
  const spear = meleeWeapon(data.melee, 'solari_sunlance'), daggers = meleeWeapon(data.melee, 'void_twin_embers');
  assert.equal(spear.attacks.light1.range, 3.0, 'the spear\'s own reach');
  assert.equal(spear.guard.parryWindow, data.melee[0].guard.parryWindow, 'the rest from its base');
  assert.ok(daggers.attacks.light1.windup < data.melee[0].attacks.light1.windup, 'daggers are quicker');
  assert.ok(new Set(data.melee.map((x) => x.id)).size >= 10, 'ten blades and more');
});

test('swept hits: the blade lands on a man in front, not on one behind or one lying under the arc', () => {
  let r = duel(1.5); swing(r.w, r.A);
  assert.ok(r.B.health.hp < 5000, 'in front: hit');
  r = duel(-1.5); swing(r.w, r.A);
  assert.equal(r.B.health.hp, 5000, 'behind: untouched');
  r = duel(1.5, { stance: 'prone' }); swing(r.w, r.A);
  assert.equal(r.B.health.hp, 5000, 'prone: the slash goes over him');
});

test('reach is the blade\'s: a spear lands where a knife falls short', () => {
  let r = duel(2.4, { weapon: 'sol_combat_knife' }); swing(r.w, r.A);
  assert.equal(r.B.health.hp, 5000, 'the knife falls short');
  r = duel(2.4, { weapon: 'solari_sunlance' }); swing(r.w, r.A);
  assert.ok(r.B.health.hp < 5000, 'the spear lands');
});

test('the rifle butt: a gunner\'s quick shove, 35 damage, a stagger and a push', () => {
  const w = makeWorld();
  const A = w.fighter(1, 0, v(0, 0, 0), 'lancer', { hp: 5000 });
  const B = w.fighter(2, 1, v(0, 0, -1.3), 'reaver', { hp: 5000 });
  A.mode = 'gun'; B.mode = 'gun';
  w.aim(A, 0, 0); w.step(3);
  const ev = events(['melee:hit', 'melee:stagger']);
  w.press(A, 'bash'); w.seconds(0.3);
  ev.off();
  assert.equal(5000 - B.health.hp, BASH.damage, 'hit for 35');
  assert.ok(ev.got.some((e) => e.type === 'melee:stagger' && e.id === B.id), 'staggered');
  assert.ok(B.movement.state.position.z < -1.5, `shoved back (${B.movement.state.position.z.toFixed(2)})`);
  // Not with a sword out: the sword has its own attacks.
  A.mode = 'sword'; w.seconds(1);
  const hp = B.health.hp;
  w.press(A, 'bash'); w.seconds(0.4);
  assert.equal(B.health.hp, hp);
});

test('a finisher: hold interact over a downed enemy and he dies 1.1 s later, credited to you', () => {
  const w = makeWorld([], { down: true });
  const A = w.fighter(1, 0, v(0, 0, 0), 'lancer', { hp: 5000 });
  const B = w.fighter(2, 1, v(0, 0, -1.2), 'reaver', { hp: 100 });
  B.health.damage(110, { kind: 'gun' }, A);
  for (let i = 0; i < 300 && !B.movement.state.downed; i++) w.step(1);
  A.movement.state.position.set(B.movement.state.position.x, 0, B.movement.state.position.z + 1);
  const ev = events(['finisher:start', 'entity:death']);
  w.hold(A, 'interact');
  w.seconds(0.6);
  assert.ok(B.health.downed && !B.health.dead, 'not yet');
  assert.ok(A.reviveJob?.finish, 'kneeling over him');
  w.seconds(0.65);
  w.release(A, 'interact');
  ev.off();
  assert.ok(B.health.dead, 'finished');
  const death = ev.got.find((e) => e.type === 'entity:death' && e.id === B.id);
  assert.equal(death?.by, A.id); assert.equal(death?.how, 'finished');
});

test('bots: a gunner shoves an enemy in his face', () => {
  const w = makeWorld();
  const A = w.bot(1, 0, v(0, 0, 0), 'lancer');
  for (const k of ['ability1', 'ability2', 'grenade', 'super']) { const s = A.abilities.slots[k]; if (s) { s.cooldown = 999; s.charges = 0; } }
  for (const s of A.stratagems?.slots ?? []) s.cooldown = 999;
  A.mode = 'gun';
  const B = w.fighter(2, 1, v(0, 0, -1.2), 'reaver', { hp: 5000 });
  const ev = events(['melee:windup']);
  w.seconds(3);
  ev.off();
  assert.ok(ev.got.some((e) => e.id === A.id && e.attack === 'bash'), 'the butt');
});
