import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bus } from '../src/core/EventBus.js';
import { makeWorld, v } from './harness.mjs';

const listen = (type) => { const got = []; const off = bus.on(type, (e) => got.push(e)); return { got, off }; };
const speed = (veh) => Math.hypot(veh.movement.state.velocity.x, veh.movement.state.velocity.z);

test('enter within range, enter lock, exit to a clear side; team-locked', () => {
  const w = makeWorld();
  const A = w.fighter(1, 0, v(0, 0, 0), 'skyrider');
  const E = w.fighter(2, 1, v(30, 0, 0), 'reaver');
  const bike = w.world.vehicles.spawn('solari_hoverbike', 0, v(2, 0, 0));
  w.press(E, 'interact'); w.step(1);
  assert.equal(E.vehicle ?? null, null);
  w.press(A, 'interact'); w.step(1);
  assert.equal(A.vehicle?.veh, bike);
  assert.equal(A.movement.state.mode, 'vehicle');
  E.movement.state.position.set(2, 0, 2); w.press(E, 'interact'); w.step(1);
  assert.equal(E.vehicle ?? null, null, 'enemies cannot take your vehicle');
  w.seconds(0.5);
  w.press(A, 'interact'); w.step(1);
  assert.equal(A.vehicle, null);
  assert.ok(A.movement.state.position.distanceTo(bike.movement.state.position) > bike.def.radius, 'exited beside the bike');
});

test('hover bike: steers toward camera, boost exceeds top speed, then cools down', () => {
  const w = makeWorld();
  const A = w.fighter(1, 0, v(0, 0, 0), 'skyrider');
  const bike = w.world.vehicles.spawn('solari_hoverbike', 0, v(0, 0, -2));
  w.press(A, 'interact'); w.step(1); w.seconds(0.4);
  w.move(A, 0, 1); w.seconds(2);
  assert.ok(speed(bike) > 18 && speed(bike) <= 22.01, `top speed ~22, got ${speed(bike)}`);
  w.press(A, 'sprint'); w.seconds(0.7);
  assert.ok(speed(bike) > 25, `boosting, got ${speed(bike)}`);
  w.seconds(1.5);
  assert.ok(speed(bike) <= 22.5, 'boost ended');
  w.aim(A, Math.PI / 2); w.seconds(1);
  assert.ok(Math.abs(((bike.yaw - Math.PI / 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI) < 0.1, 'turned toward camera');
});

test('tank: hull turns with A/D, turret tracks the camera independently at its turn rate', () => {
  const w = makeWorld();
  const A = w.fighter(1, 0, v(0, 0, 0), 'bastion');
  const tank = w.world.vehicles.spawn('solari_lancer_tank', 0, v(0, 0, -4));
  w.press(A, 'interact'); w.step(1); w.seconds(0.4);
  w.aim(A, Math.PI / 2); w.seconds(0.5);
  assert.equal(tank.yaw, 0, 'hull did not follow the camera');
  assert.ok(tank.turretYaw > 0.5 && tank.turretYaw < 0.7, `turret ~35° after 0.5 s at 70°/s, got ${(tank.turretYaw * 57.3).toFixed(1)}°`);
});

test('tank cannon splash hurts infantry; small arms barely scratch armor; rear weak spot counts as headshot', () => {
  const w = makeWorld();
  const A = w.fighter(1, 0, v(0, 0, 0), 'bastion');
  const T = w.fighter(2, 1, v(0, 0, -25), 'reaver', { hp: 1000 });
  const tank = w.world.vehicles.spawn('solari_lancer_tank', 0, v(0, 0, -4));
  w.press(A, 'interact'); w.step(1); w.seconds(0.5);
  w.aimAt(A, T.movement.state.position.clone().setY(1.0));
  w.seconds(1.2);
  w.press(A, 'light'); w.seconds(1);
  assert.ok(T.health.hp < 1000, `shell splash hit infantry (hp ${T.health.hp})`);

  const front = w.world.raycast(v(0, 1, -20), v(0, 0, 1), 40, 2);
  assert.equal(front.entity, tank); assert.equal(front.zone, 'body');
  const rear = w.world.raycast(v(0, 1, 20), v(0, 0, -1), 40, 2);
  assert.equal(rear.entity, tank); assert.equal(rear.zone, 'head', 'rear vent is the weak spot');
  assert.equal(w.world.damageMatrix.kinetic.vehicle < 0.5 && w.world.damageMatrix.ion.vehicle >= 2, true);
});

test('occupants of enclosed seats cannot be hit; exposed bike riders can', () => {
  const w = makeWorld();
  const A = w.fighter(1, 0, v(0, 0, 0), 'bastion');
  const R = w.fighter(3, 0, v(10, 0, 0), 'skyrider');
  const tank = w.world.vehicles.spawn('solari_lancer_tank', 0, v(0, 0, -4));
  const bike = w.world.vehicles.spawn('solari_hoverbike', 0, v(10, 0, -2));
  w.press(A, 'interact'); w.press(R, 'interact'); w.step(1); w.seconds(0.2);
  const shotAtTank = w.world.raycast(v(0, 1.5, -30), v(0, 0, 1), 60, 99);
  assert.equal(shotAtTank.entity, tank, 'the hull, not the driver');
  assert.ok(!w.world.fighters().includes(A));
  const rider = R.movement.state.position;
  // Riders use the seated hitbox layout (chest ~0.5 m above the seat).
  const shotAtRider = w.world.raycast(v(rider.x, rider.y + 0.5, rider.z - 20), v(0, 0, 1), 40, 99);
  assert.equal(shotAtRider.entity, R, 'bike rider is exposed');
  assert.ok(bike);
});

test('destroyed vehicles eject and hurt occupants; the pad respawns the vehicle', () => {
  const w = makeWorld();
  const A = w.fighter(1, 0, v(0, 0, 0), 'bastion', { hp: 200 });
  const pad = w.world.vehicles.addPad({ vehicle: 'solari_lancer_tank', team: 0, at: v(0, 0, -4), respawn: 2 });
  w.press(A, 'interact'); w.step(1);
  const { got, off } = listen('vehicle:destroyed');
  pad.current.health.damage(99999, {}, null); w.step(2);
  off();
  assert.equal(got.length, 1);
  assert.equal(A.vehicle, null);
  assert.ok(A.health.hp < 200, 'ejected occupant took damage');
  assert.ok(A.movement.state.velocity.y > 0 || A.movement.state.mode === 'air', 'ejected upward');
  w.seconds(2.2);
  assert.ok(pad.current && !pad.current.removed && pad.current.health.hp === pad.current.def.hp, 'respawned at full health');
});

test('ramming: fast bike damages enemies and itself; slow contact only nudges', () => {
  const w = makeWorld();
  const A = w.fighter(1, 0, v(0, 0, 10), 'skyrider');
  const E = w.fighter(2, 1, v(0, 0, -15), 'reaver', { hp: 500 });
  const bike = w.world.vehicles.spawn('solari_hoverbike', 0, v(0, 0, 8));
  w.press(A, 'interact'); w.step(1); w.seconds(0.4);
  const { got, off } = listen('vehicle:ram');
  w.move(A, 0, 1);
  for (let i = 0; i < 180 && !got.length; i++) w.step(1);
  off();
  assert.equal(got.length, 1);
  assert.ok(E.health.hp < 500 && bike.health.hp < bike.def.hp);
});

test('crashing into cover at speed damages a bike; tanks do not take crash damage', () => {
  const cover = [{ min: v(-5, 0, -20), max: v(5, 3, -19) }];
  const w = makeWorld(cover);
  const A = w.fighter(1, 0, v(0, 0, 4), 'skyrider');
  const bike = w.world.vehicles.spawn('solari_hoverbike', 0, v(0, 0, 2));
  w.press(A, 'interact'); w.step(1); w.seconds(0.4);
  const { got, off } = listen('vehicle:crash');
  w.move(A, 0, 1); w.seconds(2.5);
  off();
  assert.ok(got.length >= 1);
  assert.ok(bike.health.hp < bike.def.hp);
  assert.ok(bike.movement.state.position.z > -20, 'did not pass through the wall');
});

test('EMP: Suppress silences vehicle weapons and boost; Root stalls the engine; Scorch does not apply', () => {
  const w = makeWorld();
  const A = w.fighter(1, 0, v(0, 0, 0), 'skyrider');
  const bike = w.world.vehicles.spawn('solari_hoverbike', 0, v(0, 0, -2));
  w.press(A, 'interact'); w.step(1); w.seconds(0.4);
  bike.status.apply('suppress', {});
  const { got, off } = listen('weapon:fire');
  w.hold(A, 'light'); w.press(A, 'sprint'); w.seconds(0.5); w.release(A, 'light');
  off();
  assert.equal(got.filter((e) => e.id === bike.id).length, 0, 'no shots while suppressed');
  assert.equal(bike.boostTime, 0, 'no boost while suppressed');
  bike.status.apply('scorch', { stacks: 100 });
  assert.equal(bike.status.has('scorch'), false);
});

test('dropship: climbs with jump, carries passengers in enclosed seats, passengers drop out at altitude', () => {
  const w = makeWorld();
  const P = w.fighter(1, 0, v(0, 0, 0), 'skyrider');
  const Q = w.fighter(3, 0, v(1, 0, 0), 'lancer');
  const ship = w.world.vehicles.spawn('solari_dawnship', 0, v(0, 0, -5));
  w.press(P, 'interact'); w.press(Q, 'interact'); w.step(1);
  assert.equal(ship.seats[0].occupant, P); assert.equal(ship.seats[1].occupant, Q);
  w.hold(P, 'jump'); w.seconds(3); w.release(P, 'jump');
  assert.ok(ship.altitude > 15, `altitude ${ship.altitude}`);
  w.press(Q, 'interact'); w.step(1);
  assert.equal(Q.vehicle, null);
  assert.ok(Q.movement.state.position.y > 10, 'dropped from altitude');
  w.seconds(4);
  assert.ok(Q.movement.state.position.y < 0.5, 'fell to the ground');
});

test('Call Hoverbike drops a bike at the marker and seats the caster', () => {
  const w = makeWorld();
  const A = w.fighter(1, 0, v(0, 0, 0), 'skyrider');
  w.aim(A, 0, -0.7);
  w.press(A, 'ability2'); w.seconds(3);
  assert.ok(A.vehicle?.veh?.type === 'solari_hoverbike', 'caster riding the called bike');
});
