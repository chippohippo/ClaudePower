// Cars (src/vehicles/CarPhysics.js, VehicleSystem's car model, docs/VEHICLES.md): a rigid body
// on four raycast wheels that drives the way the Helldivers 2 recon car does (soft springs, a
// rear-biased drive that oversteers, a handbrake, about 75 km/h), and crashes the way players
// love: it trips and rolls, and throws whoever is exposed out with the speed it had.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Vector3, Quaternion } from 'three';
import { bus } from '../src/core/EventBus.js';
import { makeWorld, v, data } from './harness.mjs';

const box = (x0, y0, z0, x1, y1, z1) => new Box3(new Vector3(x0, y0, z0), new Vector3(x1, y1, z1));

function events(names) {
  const got = [];
  const offs = names.map((n) => bus.on(n, (e) => got.push({ ...e, type: n })));   // (vehicle events carry a `type` of their own)
  return { got, off: () => offs.forEach((f) => f()) };
}

/** A car facing north (-z) with a driver and a gunner aboard, settled on its springs. */
function crewed(cover = [], { type = 'solari_recon_car', terrain = null } = {}) {
  const w = makeWorld(cover, { terrain });
  const car = w.world.vehicles.spawn(type, 0, v(0, 0, 0), 0);
  const D = w.fighter(1, 0, v(-2, 0, 0), 'lancer', { hp: 5000 });
  const G = w.fighter(2, 0, v(2, 0, 0), 'lancer', { hp: 5000 });
  w.world.vehicles.enter(D, car, 0);
  w.world.vehicles.enter(G, car, 1);
  w.seconds(1);
  return { w, car, C: car.car, D, G };
}

test('it sits on soft springs, pulls to about 75 km/h, squats under power and coasts off the throttle', () => {
  const { w, C, D } = crewed();
  assert.ok(C.base.y > 0 && C.base.y < 0.15, `settled at ${C.base.y.toFixed(3)} m`);
  assert.ok(C.wheels.every((q) => q.contact), 'on all four wheels');
  w.move(D, 0, 1);
  w.seconds(0.5);
  const [fl, , rl] = C.wheels;
  assert.ok(rl.len < fl.len, 'the rear squats under power');
  w.seconds(3);
  const at3 = C.speed;
  assert.ok(at3 > 14 && at3 < 19, `quick off the line (${at3.toFixed(1)} m/s after 3.5 s)`);
  w.seconds(5);
  assert.ok(C.speed > 19.5 && C.speed < 21.5, `top speed ${(C.speed * 3.6).toFixed(0)} km/h`);
  w.move(D, 0, 0);
  w.seconds(2);
  assert.ok(C.speed > 15, `coasts (${C.speed.toFixed(1)} m/s after 2 s off the throttle)`);
  w.move(D, 0, -1);
  let slowest = Infinity;
  for (let i = 0; i < 150; i++) { w.step(1); slowest = Math.min(slowest, C.forwardSpeed); }
  assert.ok(slowest < 1, 'brakes to a stop (and then backs up)');
  assert.ok(C.forwardSpeed < 0, 'reversing');
});

test('steering narrows with speed; the handbrake breaks the rear loose; it never flips on flat ground', () => {
  const turnRate = (speed, handbrake) => {
    const { w, car, C, D } = crewed();
    C.vel.set(0, 0, -speed);
    w.move(D, 1, 1);
    if (handbrake) w.hold(D, 'jump');
    const y0 = C.yaw;
    let minUp = 1;
    for (let i = 0; i < 60; i++) { w.step(1); minUp = Math.min(minUp, C.upright); }
    return { turned: Math.abs(C.yaw - y0), minUp, car };
  };
  const slow = turnRate(8, false), fast = turnRate(20, false), drift = turnRate(20, true);
  assert.ok(slow.turned > fast.turned, `tighter slow (${slow.turned.toFixed(2)} rad) than fast (${fast.turned.toFixed(2)})`);
  assert.ok(drift.turned > fast.turned * 1.8, `the handbrake swings the tail round (${drift.turned.toFixed(2)} vs ${fast.turned.toFixed(2)} rad in 1 s)`);
  for (const r of [slow, fast, drift]) assert.ok(r.minUp > 0.9, `stays on its wheels (${r.minUp.toFixed(2)})`);
  // A full handbrake turn at top speed, all the way round.
  const { w, C, D } = crewed();
  w.move(D, 0, 1); w.seconds(7);
  w.move(D, 1, 1); w.hold(D, 'jump');
  let minUp = 1;
  for (let i = 0; i < 150; i++) { w.step(1); minUp = Math.min(minUp, C.upright); }
  assert.ok(minUp > 0.9, `a J-turn at 75 km/h on the flat: upright ${minUp.toFixed(2)}`);
});

test('a hard slide sideways into a kerb trips it over, and the gunner is flung out with the speed it had', () => {
  const { w, car, C, G } = crewed([box(3, 0, -50, 40, 0.2, 50)]);
  const ev = events(['vehicle:exit', 'vehicle:crash']);
  let thrownVel = null;
  const off = bus.on('vehicle:exit', (e) => { if (e.entity === G.id && e.thrown) thrownVel = G.movement.state.velocity.clone(); });
  C.vel.set(12, 0, 0);
  let minUp = 1;
  for (let i = 0; i < 240; i++) { w.step(1); minUp = Math.min(minUp, C.upright); }
  ev.off(); off();
  assert.ok(minUp < 0, `rolled (${minUp.toFixed(2)})`);
  assert.ok(!G.vehicle && thrownVel, 'the gunner is thrown out');
  assert.ok(Math.hypot(thrownVel.x, thrownVel.z) > 3 && thrownVel.y > 2, `on, and up (${thrownVel.toArray().map((x) => x.toFixed(1)).join(', ')})`);
  assert.ok(G.health.hp < 5000, 'and hurt');
  // A gentle bump into the same kerb does nothing.
  const r = crewed([box(3, 0, -50, 40, 0.2, 50)]);
  r.C.vel.set(5, 0, 0);
  let up2 = 1;
  for (let i = 0; i < 180; i++) { r.w.step(1); up2 = Math.min(up2, r.C.upright); }
  assert.ok(up2 > 0.9 && r.G.vehicle, 'parking against a kerb: nothing');
});

test('a head-on crash at speed: the car takes it, the gunner goes over the front, the driver is hurt', () => {
  const { w, car, C, D, G } = crewed([box(-10, 0, -60, 10, 2.5, -58)]);
  const ev = events(['vehicle:crash']);
  w.move(D, 0, 1);
  w.seconds(6);
  ev.off();
  const crash = ev.got.find((e) => e.id === car.id);
  assert.ok(crash && crash.impact > 10, `a crash (${crash?.impact.toFixed(1)} m/s)`);
  assert.ok(car.health.hp < car.health.max - 300, `damaged (${car.health.hp.toFixed(0)} HP)`);
  assert.ok(!G.vehicle && G.movement.state.mode === 'ragdoll', 'the gunner is thrown');
  assert.ok(D.vehicle && D.health.hp < 5000, 'the driver, strapped in, is hurt');
});

test('on its roof: everyone climbs out, and a soldier pushes it back over by holding interact', () => {
  const { w, car, C, D, G } = crewed();
  // Turn it over where it stands.
  C.q.premultiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI)).normalize();
  C.c.y += 1.8;
  w.seconds(3);
  assert.ok(C.upright < -0.5, 'on its roof');
  assert.ok(!D.vehicle && !G.vehicle, 'they climb out');
  assert.equal(w.world.vehicles.nearestEnterable(D), null, 'nobody gets into a car on its roof');
  w.seconds(2);
  const p = car.movement.state.position;
  D.movement.state.position.set(p.x - 2.6, 0, p.z);
  w.seconds(0.5);
  assert.equal(w.world.vehicles.flippedNear(D), car, 'the prompt: push it over');
  const ev = events(['vehicle:righted']);
  w.hold(D, 'interact');
  w.seconds(1.0);
  assert.ok(C.upright < 0, 'not yet');
  w.seconds(0.7);
  w.release(D, 'interact');
  w.seconds(1.5);
  ev.off();
  assert.ok(ev.got.some((e) => e.id === car.id && e.by === D.id), 'righted');
  assert.ok(C.upright > 0.95, `back on its wheels (${C.upright.toFixed(2)})`);
});

test('blasts: a grenade rocks it, a shell beside it or a strike turns it over', () => {
  const blast = (knock, radius, dmg, at) => {
    const w = makeWorld();
    const car = w.world.vehicles.spawn('solari_recon_car', 0, v(0, 0, 0), 0);
    w.seconds(1);
    w.world.explode(at, radius, { id: 'test', ammoType: 'explosive', damage: { base: dmg }, knockback: knock }, { ownerId: 999, team: 1 });
    let minUp = 1;
    for (let i = 0; i < 240; i++) { w.step(1); minUp = Math.min(minUp, car.car.upright); }
    return minUp;
  };
  const grenade = blast(10, 5, 100, v(1.6, 0, 0));
  assert.ok(grenade > 0.8, `a grenade rocks it (${grenade.toFixed(2)})`);
  const strike = blast(24, 7, 900, v(2.5, 0, 0));
  assert.ok(strike < 0, `a strike turns it over (${strike.toFixed(2)})`);
});

test('killed, it burns a few seconds before it blows: time to get out', () => {
  const { w, car, D, G } = crewed();
  const ev = events(['vehicle:burning', 'vehicle:destroyed']);
  car.health.damage(5000, { kind: 'test' }, null);
  w.seconds(1);
  assert.ok(ev.got.some((e) => e.type === 'vehicle:burning' && e.id === car.id), 'on fire');
  assert.ok(!ev.got.some((e) => e.type === 'vehicle:destroyed'), 'not yet');
  w.press(D, 'interact'); w.seconds(0.3);
  assert.ok(!D.vehicle, 'the driver bails');
  w.seconds(data.vehicles.vehicles.solari_recon_car.car.burn);
  ev.off();
  assert.ok(ev.got.some((e) => e.type === 'vehicle:destroyed' && e.id === car.id), 'then it blows');
  assert.ok(!G.vehicle && G.health.hp < 5000, 'whoever stayed is thrown out of the blast, hurt');
});

test('running people down takes speed: a nudge at a walk, a hit at 30 km/h and up', () => {
  const runDown = (speed) => {
    const w = makeWorld();
    const car = w.world.vehicles.spawn('solari_recon_car', 0, v(0, 0, 0), 0);
    const D = w.fighter(1, 0, v(-2, 0, 0), 'lancer', { hp: 5000 });
    w.world.vehicles.enter(D, car, 0);
    const E = w.fighter(2, 1, v(0, 0, -12), 'reaver', { hp: 5000 });
    w.seconds(0.5);
    for (let i = 0; i < 150; i++) { if (car.car.forwardSpeed < speed) car.car.vel.set(0, 0, -speed); w.step(1); }
    return 5000 - E.health.hp;
  };
  assert.equal(runDown(6), 0, 'at 22 km/h: shoved aside');
  assert.ok(runDown(14) > 100, 'at 50 km/h: run over');
});

test('passengers lean out and shoot with their own guns; the driver can\'t', () => {
  const w = makeWorld();
  const car = w.world.vehicles.spawn('solari_recon_car', 0, v(0, 0, 0), 0);
  const D = w.fighter(1, 0, v(-2, 0, 0), 'lancer', { hp: 5000 });
  const P = w.fighter(3, 0, v(2, 0, 0), 'lancer', { hp: 5000 });
  w.world.vehicles.enter(D, car, 0);
  w.world.vehicles.enter(P, car, 2);
  const E = w.fighter(9, 1, v(0, 0, -25), 'reaver', { hp: 5000 });
  w.seconds(1);
  const ev = events(['weapon:fire']);
  for (const f of [D, P]) { w.aimAt(f, E.movement.state.position.clone().setY(1.2)); w.hold(f, 'light'); }
  w.seconds(2);
  ev.off();
  assert.ok(ev.got.some((e) => e.id === P.id), 'the passenger fires');
  assert.ok(!ev.got.some((e) => e.id === D.id), 'the driver drives');
  assert.ok(E.health.hp < 5000, 'and hits');
});

test('deterministic: the same slide gives the same rollover', () => {
  const once = () => {
    const { w, C } = crewed([box(3, 0, -50, 40, 0.2, 50)]);
    C.vel.set(12, 0, -3);
    w.seconds(4);
    return [...C.base.toArray(), ...C.q.toArray()].map((x) => x.toFixed(9)).join(',');
  };
  assert.equal(once(), once());
});

test('bots drive it: board, roll toward the objective, the gunner fights from the ring mount', () => {
  const w = makeWorld();
  const car = w.world.vehicles.spawn('solari_recon_car', 0, v(0, 0, 0), 0);
  const always = { ...data.ai.personalities[Object.keys(data.ai.personalities)[0]], usesVehicles: 'always', aggression: 0.3 };
  const A = w.bot(1, 0, v(-4, 0, 3), 'lancer', { persona: always });
  const B = w.bot(2, 0, v(4, 0, 3), 'lancer', { persona: always });
  for (const b of [A, B]) w.brainOf(b).objective = { pos: v(0, 0, -160), radius: 10, field: null };
  w.fighter(9, 1, v(30, 0, -90), 'reaver', { hp: 600 });
  const ev = events(['weapon:fire']);
  w.seconds(4);
  assert.ok(A.vehicle?.veh === car && B.vehicle?.veh === car, 'both aboard');
  w.seconds(16);
  ev.off();
  assert.ok(car.movement.state.position.distanceTo(v(0, 0, 0)) > 60, `driven (${car.movement.state.position.distanceTo(v(0, 0, 0)).toFixed(0)} m)`);
  assert.ok(ev.got.filter((e) => e.id === car.id).length > 30, 'the ring mount in action');
  assert.ok(car.car.upright > 0.9, 'and still on its wheels');
});
