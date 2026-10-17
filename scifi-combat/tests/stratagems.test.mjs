// Stratagems (src/combat/Stratagems.js, data/stratagems.json, docs/GAMEPLAY_PLAN.md §2): codes
// typed with the call-in held, a beacon thrown, the payload after its delay. The contract: codes
// type, mismatch and reset; the hands are busy while typing; the beacon flies and sticks; strikes
// land where it is, hurt everyone in the blast and warn the bots in time; cooldowns and uses hold;
// pods crush and supply; smoke blocks sight.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bus } from '../src/core/EventBus.js';
import { makeWorld, v, DT } from './harness.mjs';
import { ARROW_KEYS } from '../src/combat/Stratagems.js';

/** Type a code: call-in held, one arrow press every few ticks (like a quick hand). */
function type(w, e, code) {
  w.hold(e, 'stratagem');
  for (const ch of code) { w.press(e, ARROW_KEYS[ch]); w.step(4); }
  w.release(e, 'stratagem');
  w.step(1);
}

function events(names) {
  const got = [];
  const offs = names.map((n) => bus.on(n, (e) => got.push({ type: n, ...e })));
  return { got, off: () => offs.forEach((f) => f()) };
}

test('codes: a full code arms the beacon, a wrong arrow buzzes and clears, a spent one types nothing', () => {
  const w = makeWorld();
  const A = w.fighter(1, 0, v(0, 0, 0), 'lancer', { role: 'assault' });
  const S = A.stratagems;
  assert.deepEqual(S.slots.map((s) => s.id), ['supply_drop', 'smoke_screen', 'precision_strike', 'strafing_run'], 'common pair + the role\'s');
  const ev = events(['stratagem:arrow', 'stratagem:error', 'stratagem:armed']);
  type(w, A, 'RRL');                       // R R is precision's start; L matches nothing
  assert.equal(ev.got.filter((x) => x.type === 'stratagem:error').length, 1, 'the wrong arrow buzzed');
  assert.equal(S.state, 'idle');
  type(w, A, 'RRU');
  assert.equal(S.state, 'armed');
  assert.equal(S.armed.id, 'precision_strike');
  ev.off();
  // Putting it away: the call-in again, without typing.
  w.press(A, 'stratagem'); w.step(2);
  assert.equal(S.state, 'idle');
  assert.equal(S.slot('precision_strike').cooldown, 0, 'stowing costs nothing');
});

test('hands are busy: no shots while typing a code or holding a beacon', () => {
  const w = makeWorld();
  const A = w.fighter(1, 0, v(0, 0, 0), 'lancer');
  A.mode = 'gun';
  const shots0 = A.weapons.shotIndex;
  w.hold(A, 'stratagem', 'light');
  for (const ch of 'RRU') { w.press(A, ARROW_KEYS[ch]); w.step(4); }
  w.release(A, 'stratagem', 'light');
  w.step(2);
  assert.equal(A.weapons.shotIndex, shots0, 'the gun stayed quiet');
  assert.equal(A.stratagems.state, 'armed');
});

test('a precision strike: the beacon flies and sticks, the shell lands on it after the delay, hurting friend and foe alike', () => {
  const w = makeWorld();
  const A = w.fighter(1, 0, v(0, 0, 0), 'lancer', { hp: 1000 });
  const ev = events(['stratagem:beacon', 'projectile:explode']);
  type(w, A, 'RRU');
  w.aim(A, 0, 0.1);                        // throw north, a little up
  w.press(A, 'light');
  w.seconds(1.5);
  const planted = ev.got.find((x) => x.type === 'stratagem:beacon');
  assert.ok(planted, 'the beacon stuck');
  const [bx, , bz] = planted.at;
  assert.ok(bz < -5 && bz > -25 && Math.abs(bx) < 1.5, `it flew forward and landed (${bx.toFixed(1)}, ${bz.toFixed(1)})`);
  assert.equal(A.stratagems.slot('precision_strike').cooldown > 80, true, 'the cooldown runs from the throw');
  // People near the beacon: an enemy and a teammate.
  const E = w.fighter(2, 1, v(bx + 2, 0, bz), 'monolith', { hp: 2000 });
  const F = w.fighter(3, 0, v(bx - 2, 0, bz), 'lancer', { hp: 2000 });
  // The incoming list warned of it at the throw (bots dive in time).
  const warned = w.world.vehicles.guns.incoming.some((r) => r.kind === 'strike' && Math.hypot(r.x - bx, r.z - bz) < 2);
  assert.ok(warned, 'on the incoming list where it lands');
  w.seconds(3.5);
  const boom = ev.got.find((x) => x.type === 'projectile:explode');
  ev.off();
  assert.ok(boom, 'the shell came down');
  const p = boom.point;
  assert.ok(Math.hypot(p.x - bx, p.z - bz) < 2.5, 'on the beacon');
  assert.ok(E.health.hp < 2000 - 200, `the enemy in the blast (${2000 - E.health.hp})`);
  assert.ok(F.health.hp < 2000 - 200, `and the teammate: friendly fire (${2000 - F.health.hp})`);
});

test('uses: a strafing run calls twice, then rearms', () => {
  const w = makeWorld();
  const A = w.fighter(1, 0, v(0, 0, 0), 'lancer');
  const slot = A.stratagems.slot('strafing_run');
  for (let k = 0; k < 2; k++) {
    type(w, A, 'URR'); w.aim(A, 0, 0.1); w.press(A, 'light'); w.seconds(3);
  }
  assert.equal(slot.uses, 0);
  assert.ok(slot.rearm > 90, 'rearming');
  type(w, A, 'URR');
  assert.equal(A.stratagems.state, 'idle', 'nothing to call while it rearms');
  w.seconds(slot.rearm + 0.2);
  assert.equal(slot.uses, 2, 'rearmed');
});

test('a supply drop: the pod crushes whoever is under it, then hands out mags', () => {
  const w = makeWorld();
  const A = w.fighter(1, 0, v(0, 0, 0), 'lancer');
  const ev = events(['stratagem:beacon', 'stratagem:land', 'stratagem:grab']);
  type(w, A, 'DDUR'); w.aim(A, 0, 0.1); w.press(A, 'light');
  w.seconds(1.2);
  const [bx, , bz] = ev.got.find((x) => x.type === 'stratagem:beacon').at;
  const U = w.fighter(2, 1, v(bx, 0, bz), 'monolith', { hp: 900 });    // standing on the beacon
  w.seconds(5);
  assert.ok(ev.got.some((x) => x.type === 'stratagem:land'), 'the pod landed');
  assert.ok(U.health.dead, 'crushed under it');
  // A soldier low on ammo takes two mags.
  A.movement.state.position.set(bx + 1.2, 0, bz);
  const gun = A.weapons.current;
  gun.reserve = 0;
  w.press(A, 'interact'); w.step(2);
  ev.off();
  assert.ok(ev.got.some((x) => x.type === 'stratagem:grab' && x.id === A.id), 'grabbed');
  assert.ok(gun.reserve >= (gun.s.mag ?? 30) * 2 - 1, `two mags in the reserve (${gun.reserve})`);
});

test('a sentry pod lands and becomes a turret on our side', () => {
  const w = makeWorld();
  const A = w.fighter(1, 0, v(0, 0, 0), 'lancer', { role: 'engineer' });
  type(w, A, 'DURRU'); w.aim(A, 0, 0.1); w.press(A, 'light');
  w.seconds(6.5);
  const t = w.world.deployables.list.find((d) => d.kind === 'turret');
  assert.ok(t, 'a turret');
  assert.equal(t.team, 0);
  assert.ok(t.dps > 0 && t.range > 30);
});

test('a smoke screen blocks sight through it', () => {
  const w = makeWorld();
  const A = w.fighter(1, 0, v(0, 0, 0), 'lancer');
  const eye = v(0, 1.6, 0), far = v(0, 1.6, -40);
  assert.equal(w.world.zones.blocksVisionBetween(eye, far), false, 'clear before');
  type(w, A, 'RUUD'); w.aim(A, 0, 0.15); w.press(A, 'light');
  w.seconds(4);
  assert.equal(w.world.zones.blocksVisionBetween(eye, far), true, 'the screen is between us and 40 m out');
  assert.equal(w.world.zones.blocksVisionBetween(eye, v(30, 1.6, 0)), false, 'not off to the side');
});

test('nobody types while down, dead or riding', () => {
  const w = makeWorld([], { down: true });
  const A = w.fighter(1, 0, v(0, 0, 0), 'lancer');
  A.health.damage(A.health.hp + A.health.shield + 1, { kind: 'test' }, null);
  assert.ok(A.health.downed || A.health.dead);
  type(w, A, 'RRU');
  assert.equal(A.stratagems.state, 'idle');
  void DT;
});
