// Speeder bikes (docs/VEHICLES.md): the rider sits the bike's seat, hands on its grips and feet on
// its pegs, and goes with the hull, which banks into its turns and pitches with the throttle; the
// model is built at the same points, and the hit spheres sit on the drawn rider.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3, Object3D } from 'three';
import { AnimationSystem } from '../src/anim/AnimationSystem.js';
import { hitSpheres } from '../src/movement/Hitboxes.js';
import { vehicleModel } from '../src/render/VehicleKit.js';
import { seatOnTilted } from '../src/vehicles/VehicleSystem.js';
import { makeWorld, v, data, DT } from './harness.mjs';

const BIKES = [['solari_hoverbike', 'skyrider'], ['void_skiff', 'wraith']];
const DEFS = data.vehicles.vehicles;

/** A rider on a bike of `type` at the origin, with his rig drawn every tick. */
function ride(type, cls) {
  const w = makeWorld();
  const R = w.fighter(1, 0, v(2, 0, 0), cls, { hp: 5000 });
  const bike = w.world.vehicles.spawn(type, 0, v(0, 0, 0), 0.3);
  w.world.vehicles.enter(R, bike, 0);
  const sys = new AnimationSystem(data.humanoid, { getEntity: (id) => w.world.entity(id) });
  sys.add(R); sys.focusId = 1;
  const tick = (n = 1, drive = null) => { for (let i = 0; i < n; i++) { sys.snapshot(); drive?.(); w.step(1); sys.update(DT, 1, null); } };
  // Throttle `y` and steering `rate` rad/s (the bike turns toward where its rider looks).
  const drive = (y, rate = 0) => () => { w.move(R, 0, y); w.aim(R, bike.yaw + rate * DT * 4, 0); };
  tick(60);
  return { w, R, bike, rig: sys.get(1), tick, drive };
}

/** A point on the bike from its seat: [x right, up, forward], unbanked (for comparing with the rig's joints). */
function onBike(bike, seat, [x, u, f]) {
  const c = Math.cos(bike.yaw), s = Math.sin(bike.yaw);
  return new Vector3(seat.x + x * c - f * s, seat.y + u, seat.z - x * s - f * c);
}

test('the model is built at the rider\'s points: the saddle\'s top at the seat point, the grips and the pegs where the seat says', () => {
  for (const [type] of BIKES) {
    const def = DEFS[type], sd = def.seats[0], hh = def.hoverHeight, [, oy, oz] = sd.offset, sy = oy + hh;
    const P = vehicleModel(def, type).body.attributes.position.array;
    let top = -Infinity;
    for (let i = 0; i < P.length; i += 3) if (Math.abs(P[i]) < 0.08 && Math.abs(P[i + 2] - (oz + 0.1)) < 0.12) top = Math.max(top, P[i + 1]);
    assert.ok(Math.abs(top - sy) < 0.015, `${type}: the saddle's top ${top.toFixed(3)} m, the seat point ${sy.toFixed(3)} m above the ground`);
    const nearest = (x, y, z) => { let d = Infinity; for (let i = 0; i < P.length; i += 3) d = Math.min(d, Math.hypot(P[i] - x, P[i + 1] - y, P[i + 2] - z)); return d; };
    for (const side of [-1, 1]) {
      const g = nearest(side * sd.grips[0], sy + sd.grips[1], oz - sd.grips[2]);
      assert.ok(g < 0.035, `${type}: a grip at the hand (${(g * 100).toFixed(1)} cm)`);
      const p = nearest(side * sd.pegs[0], sy + sd.pegs[1] - 0.08, oz - sd.pegs[2]);
      assert.ok(p < 0.07, `${type}: a peg under the foot (${(p * 100).toFixed(1)} cm)`);
    }
  }
});

test('the rider sits the seat: on it (not floating over it), hands on the grips, feet on the pegs', () => {
  for (const [type, cls] of BIKES) {
    const { R, bike, rig } = ride(type, cls);
    const def = DEFS[type], sd = def.seats[0], k = data.humanoid.poses.ride, seat = R.movement.state.position;
    assert.ok(Math.abs(seat.y - (sd.offset[1] + def.hoverHeight)) < 0.01, `${type}: the seat point ${seat.y.toFixed(2)} m up, on the saddle`);
    assert.ok(rig.j.pelvis.distanceTo(onBike(bike, seat, [0, k.pelvisH, k.pelvisF])) < 0.01, `${type}: the hips on the saddle`);
    for (const [i, side] of [[0, -1], [1, 1]]) {
      const hand = rig.j.hand[i].distanceTo(onBike(bike, seat, [side * sd.grips[0], sd.grips[1], sd.grips[2]]));
      const foot = rig.j.ankle[i].distanceTo(onBike(bike, seat, [side * sd.pegs[0], sd.pegs[1], sd.pegs[2]]));
      assert.ok(hand < 0.01 && foot < 0.01, `${type}: hand ${(hand * 100).toFixed(1)} cm off its grip, foot ${(foot * 100).toFixed(1)} cm off its peg`);
    }
    const hs = hitSpheres(R);
    assert.ok(rig.j.head.distanceTo(new Vector3(hs[0].x, hs[0].y, hs[0].z)) < 0.05 && rig.j.chestC.distanceTo(new Vector3(hs[1].x, hs[1].y, hs[1].z)) < 0.05, `${type}: the hit spheres on the rider`);
  }
});

test('carving, the bike banks into the turn and its rider with it; level on the straight', () => {
  const { R, bike, rig, tick, drive } = ride('solari_hoverbike', 'skyrider');
  tick(120, drive(1));
  assert.ok(bike.movement.state.velocity.length() > 15 && Math.abs(bike.bank) < 0.03, `straight at speed: level (${bike.bank.toFixed(3)})`);
  const L = DEFS.solari_hoverbike.lean, sd = bike.seats[0].def;
  for (const [rate, sign, label] of [[1.1, -1, 'left'], [-1.1, 1, 'right']]) {
    tick(45, drive(1, rate));
    assert.ok(bike.bank * sign > 0.4 && Math.abs(bike.bank) <= L.max + 1e-9, `a hard ${label}-hander: banked ${(bike.bank * 180 / Math.PI).toFixed(0)} deg into it`);
    // The rider goes with it: his head over the inside of the turn, hands and feet still on the bike.
    const seat = R.movement.state.position, rt = new Vector3(Math.cos(bike.yaw), 0, -Math.sin(bike.yaw));
    const lean = rig.j.head.clone().sub(seat).dot(rt);
    assert.ok(lean * sign > 0.25, `${label}: the head ${Math.abs(lean).toFixed(2)} m over the inside`);
    // The seat he sits is the drawn bike's seat (the model's transform: yaw, then nose-up, then the bank).
    const o = new Object3D(); o.rotation.order = 'YXZ'; o.rotation.set(bike.pitch, bike.yaw, -bike.bank);
    o.position.copy(bike.movement.state.position); o.position.y -= bike.def.hoverHeight; o.updateMatrixWorld();
    const drawnSeat = new Vector3(sd.offset[0], sd.offset[1] + bike.def.hoverHeight, sd.offset[2]).applyMatrix4(o.matrixWorld);
    assert.ok(drawnSeat.distanceTo(seatOnTilted(new Vector3(), bike, sd.offset)) < 1e-6 && drawnSeat.distanceTo(seat) < 1e-6, `${label}: on the drawn seat`);
    const hs = hitSpheres(R);
    const dh = rig.j.head.distanceTo(new Vector3(hs[0].x, hs[0].y, hs[0].z)), dc = rig.j.chestC.distanceTo(new Vector3(hs[1].x, hs[1].y, hs[1].z));
    assert.ok(dh < 0.06 && dc < 0.06, `${label}: the hit spheres lean with him (head ${(dh * 100).toFixed(0)} cm, chest ${(dc * 100).toFixed(0)} cm)`);
  }
  tick(90, drive(1));
  assert.ok(Math.abs(bike.bank) < 0.03, 'straight again: level');
});

test('the nose comes up on the throttle and dips on the brake; a steady carve holds it level', () => {
  const { bike, tick, drive } = ride('solari_hoverbike', 'skyrider');
  const L = DEFS.solari_hoverbike.lean;
  let up = 0;
  for (let i = 0; i < 30; i++) { tick(1, drive(1)); up = Math.max(up, bike.pitch); }
  assert.ok(up > 0.03 && up <= L.pitchMax + 1e-9, `pulling away: nose up ${(up * 180 / Math.PI).toFixed(1)} deg`);
  tick(150, drive(1));
  assert.ok(Math.abs(bike.pitch) < 0.01, `at top speed: level (${bike.pitch.toFixed(3)})`);
  tick(60, drive(1, 1.1));
  assert.ok(Math.abs(bike.pitch) < 0.02, `a steady carve: level (${bike.pitch.toFixed(3)})`);
  tick(60, drive(1));
  let down = 0;
  for (let i = 0; i < 30; i++) { tick(1, drive(-1)); down = Math.min(down, bike.pitch); }
  assert.ok(down < -0.03, `braking: nose down ${(down * 180 / Math.PI).toFixed(1)} deg`);
});
