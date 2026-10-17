// Battle points (src/game/BattlePoints.js, data/battle-points.json, docs/GAMEPLAY_PLAN.md §5):
// earned for what helps the team (downs and kills, assists, spots, revives, shared mags, digging
// in, points taken and held, enemy vehicles), lost for hurting your own side and halved when you
// die; spent from the call-in panel on an extra use of a call-in that's cooling down, a vehicle
// drop or the hero.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { bus } from '../src/core/EventBus.js';
import { makeWorld, v, DT, data } from './harness.mjs';
import { ARROW_KEYS } from '../src/combat/Stratagems.js';
import { FortifySystem } from '../src/game/frontline/Fortify.js';

const E = data.battlePoints.earn;
const pts = (f) => f.bp?.points ?? 0;

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

const until = (w, cond, max = 600) => { for (let i = 0; i < max && !cond(); i++) w.step(1); };

test('a down pays the kill, everyone else who hurt him an assist, whoever revealed him a spot; finishing pays a little', () => {
  const w = makeWorld([], { down: true, bp: true });
  const A = w.fighter(1, 0, v(0, 0, 0), 'lancer');
  const C = w.fighter(2, 0, v(3, 0, 0), 'lancer');
  const D = w.fighter(3, 0, v(-3, 0, 0), 'lancer');
  const F = w.fighter(4, 0, v(6, 0, 0), 'lancer');
  const B = w.fighter(10, 1, v(0, 0, -20), 'lancer', { hp: 200 });
  B.status.apply('revealed', { duration: 5, source: D });
  B.health.damage(30, { kind: 'gun' }, C);
  w.step(1);
  B.health.damage(180, { kind: 'gun' }, A);                // 10 past zero: down, not dead
  assert.ok(B.health.downed, 'downed');
  assert.equal(pts(A), E.kill, 'the kill to whoever put him down');
  assert.equal(pts(C), E.assist, 'an assist for the one who hurt him first');
  assert.equal(pts(D), E.spot, 'a spot for the one who revealed him');
  B.health.damage(500, { kind: 'gun' }, F);
  assert.ok(B.health.dead);
  assert.equal(pts(F), E.finish, 'finishing him pays a little');
  assert.equal(pts(A), E.kill, 'and the kill isn\'t paid twice');
});

test('hurting your own side costs you; an enemy vehicle pays more than a soldier', () => {
  const w = makeWorld([], { down: true, bp: true });
  const A = w.fighter(1, 0, v(0, 0, 0), 'lancer');
  A.bp = { points: 500, total: 500 };
  const T = w.fighter(2, 0, v(4, 0, 0), 'lancer', { hp: 100 });
  T.health.damage(110, { kind: 'gun', friendly: true }, A);
  assert.equal(pts(A), 500 + E.teamkill, `a teamkill costs ${-E.teamkill}`);
  const veh = w.world.vehicles.spawn('void_skiff', 1, v(0, 0, -15));
  veh.health.damage(99999, { kind: 'gun' }, A);
  assert.equal(pts(A), 500 + E.teamkill + E.vehicle, 'a vehicle');
});

test('a revive and a teammate\'s mags from your supply pod pay; your own mags don\'t', () => {
  const w = makeWorld([], { down: true, bp: true });
  const enemy = w.fighter(9, 1, v(0, 0, 60), 'lancer');
  const P = w.fighter(1, 0, v(0, 0, 0), 'lancer', { hp: 100 });
  const R = w.fighter(2, 0, v(1, 0, 0), 'lancer', { role: 'medic' });
  P.health.damage(110, { kind: 'gun' }, enemy);
  until(w, () => P.movement.state.downed);
  R.movement.reset(P.movement.state.position.clone().add(v(0.9, 0, 0)), 0);
  w.hold(R, 'interact'); w.seconds(data.down.medicReviveTime + 0.2); w.release(R, 'interact');
  assert.equal(P.health.downed, false, 'up');
  assert.equal(pts(R), E.revive, 'the revive pays');
  // R's supply pod: P takes two mags (R is paid for them), then R takes his own (not paid).
  const ev = events(['stratagem:beacon', 'stratagem:land', 'stratagem:grab']);
  w.seconds(1.5);
  type(w, R, 'DDUR'); w.aim(R, 0, 0.1); w.press(R, 'light');
  w.seconds(1.8);
  const [bx, , bz] = ev.got.find((x) => x.type === 'stratagem:beacon').at;
  w.seconds(5);
  assert.ok(ev.got.some((x) => x.type === 'stratagem:land'), 'landed');
  P.movement.reset(new Vector3(bx + 1.2, 0, bz), 0);
  P.weapons.current.reserve = 0;
  w.press(P, 'interact'); w.step(2);
  const grab = ev.got.find((x) => x.type === 'stratagem:grab' && x.id === P.id);
  assert.ok(grab, 'grabbed');
  assert.equal(pts(R), E.revive + E.resupply * grab.mags, 'paid per mag the teammate took');
  R.movement.reset(new Vector3(bx - 1.2, 0, bz), 0);
  R.weapons.current.reserve = 0;
  w.press(R, 'interact'); w.step(2);
  ev.off();
  assert.ok(ev.got.some((x) => x.type === 'stratagem:grab' && x.id === R.id), 'he took his own');
  assert.equal(pts(R), E.revive + E.resupply * grab.mags, 'which pays nothing');
});

test('digging in pays the digger', () => {
  const w = makeWorld([], { bp: true });
  const A = w.fighter(1, 0, v(0, 0, 0), 'lancer');
  const fort = new FortifySystem(w.world, { terrain: null }, { cap: 4 });
  const cmd = { moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons: { dig: { down: true, pressed: false, released: false } } };
  for (let i = 0; i < 4 / DT; i++) fort.handleInput(A, cmd, DT);
  assert.equal(fort.sitesOf(0)[0]?.stage, 1, 'a foxhole');
  assert.equal(pts(A), E.build);
});

test('a point taken pays everyone standing on it; holding it while contested pays by the second', () => {
  const point = { id: 0, name: 'Alpha', pos: new Vector3(0, 0, 0), radius: 10, owner: -1, contested: false };
  const w = makeWorld([], { bp: true, mode: { points: [point] } });
  const A = w.fighter(1, 0, v(2, 0, 0), 'lancer');
  const B = w.fighter(2, 0, v(-3, 0, 4), 'lancer');
  const far = w.fighter(3, 0, v(40, 0, 0), 'lancer');
  const X = w.fighter(4, 1, v(0, 0, 6), 'lancer');
  point.owner = 0;
  bus.emit('mode:point', { point: 0, name: 'Alpha', owner: 0, from: -1 });
  assert.equal(pts(A), E.capture); assert.equal(pts(B), E.capture);
  assert.equal(pts(far), 0, 'not from 40 m away');
  assert.equal(pts(X), 0, 'nor for the enemy on it');
  point.contested = true;
  w.seconds(3.05);
  assert.equal(pts(A), E.capture + 3 * E.defend, 'three seconds holding it');
  assert.equal(pts(X), 0);
});

test('dying keeps half of what you hadn\'t spent', () => {
  const w = makeWorld([], { bp: true });
  const A = w.fighter(1, 0, v(0, 0, 0), 'lancer', { hp: 100 });
  A.bp = { points: 901, total: 901 };
  const ev = events(['bp:death']);
  A.health.damage(500, { kind: 'gun' }, null);
  ev.off();
  assert.equal(pts(A), 450);
  assert.equal(ev.got[0]?.lost, 451);
});

test('an extra use of a call-in that\'s cooling down: paid when it\'s thrown, the cooldown left running', () => {
  const w = makeWorld([], { bp: true });
  const A = w.fighter(1, 0, v(0, 0, 0), 'lancer', { hp: 5000 });
  const price = data.stratagems.bp.extraUse;
  A.bp = { points: price + 100, total: 0 };
  type(w, A, 'RRU'); w.aim(A, 0, 0.1); w.press(A, 'light'); w.step(2);
  assert.equal(pts(A), price + 100, 'the first one is free');
  const slot = A.stratagems.slot('precision_strike'), cd = slot.cooldown;
  assert.ok(cd > 80, 'cooling down');
  type(w, A, 'RRU');
  assert.equal(A.stratagems.state, 'armed', 'typed anyway: there are points for it');
  assert.equal(A.stratagems.price(slot), price);
  assert.equal(pts(A), price + 100, 'not paid yet');
  w.press(A, 'stratagem'); w.step(2);
  assert.equal(pts(A), price + 100, 'putting it away costs nothing');
  type(w, A, 'RRU'); w.aim(A, 0, 0.1); w.press(A, 'light'); w.step(2);
  assert.equal(pts(A), 100, 'paid on the throw');
  assert.ok(Math.abs(slot.cooldown - (cd - 26 * DT)) < 0.1, `the cooldown kept running (${slot.cooldown.toFixed(1)} s)`);
  type(w, A, 'RRU');
  assert.equal(A.stratagems.state, 'idle', 'no points, no extra use');
});

test('a vehicle drop: bought at its price, it comes down in its cradle on the beacon, crushing, and it\'s yours', () => {
  const w = makeWorld([], { bp: true });
  const A = w.fighter(1, 0, v(0, 0, 0), 'lancer', { hp: 5000 });
  const def = data.stratagems.stratagems.recon_drop;
  type(w, A, def.code);
  assert.equal(A.stratagems.state, 'idle', 'nothing without the points');
  A.bp = { points: def.bp + 50, total: 0 };
  const ev = events(['stratagem:beacon', 'stratagem:land']);
  type(w, A, def.code); w.aim(A, 0, -0.1); w.press(A, 'light');
  w.seconds(1.5);
  assert.equal(pts(A), 50, 'paid');
  const [bx, , bz] = ev.got.find((x) => x.type === 'stratagem:beacon').at;
  const U = w.fighter(2, 1, v(bx, 0, bz), 'monolith', { hp: 900 });
  w.seconds(def.delay + 0.5);
  ev.off();
  const land = ev.got.find((x) => x.type === 'stratagem:land');
  assert.equal(land?.contents, 'vehicle', 'it came down');
  const veh = w.world.vehicles.list.find((x) => x.id === land.vehicle);
  assert.ok(veh, 'a vehicle');
  assert.equal(veh.type, def.payload.vehicle[0], 'our side\'s');
  assert.equal(veh.calledBy, A.id, 'called by him');
  assert.ok(Math.hypot(veh.movement.state.position.x - bx, veh.movement.state.position.z - bz) < 1, 'on the beacon');
  assert.ok(U.health.dead, 'crushing whoever stood there');
  assert.ok(A.stratagems.slot('recon_drop').cooldown > 0, 'and a cooldown before the next');
});

test('the hero: the class super charged on the spot, never when it already is', () => {
  const w = makeWorld([], { bp: true });
  const A = w.fighter(1, 0, v(0, 0, 0), 'lancer');
  const def = data.stratagems.stratagems.hero;
  A.bp = { points: def.bp * 2, total: 0 };
  A.abilities.superEnergy = 0;
  type(w, A, def.code);
  assert.equal(A.abilities.superEnergy, A.abilities.superCost, 'charged');
  assert.equal(pts(A), def.bp, 'paid');
  assert.equal(A.stratagems.state, 'idle', 'no beacon');
  A.stratagems.slot('hero').cooldown = 0;
  type(w, A, def.code);
  assert.equal(pts(A), def.bp, 'not again while it\'s charged');
});
