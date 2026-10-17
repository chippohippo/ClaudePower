// What keeps the game from freezing mid-battle: the scene's lights never change in number while you
// play (a light appearing or vanishing changes the light count every lit shader is built for, and
// the driver rebuilds them all at once: on Windows, a stall of many seconds); the fixed loop never
// owes itself more ticks than it can run (a slow computer plays in slow motion, never locks up).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene, Vector3 } from 'three';
import { makeWorld, v } from './harness.mjs';
import { VehicleViews } from '../src/vfx/VehicleViews.js';
import { FixedLoop } from '../src/core/FixedLoop.js';

const lightsIn = (scene) => { let n = 0; scene.traverseVisible((o) => { if (o.isLight) n++; }); return n; };

test('a car burning to a wreck lights its fire without adding a light to the scene', () => {
  const w = makeWorld([]);
  const car = w.world.vehicles.spawn('solari_recon_car', 0, v(0, 0, 0), 0);
  const far = w.world.vehicles.spawn('solari_recon_car', 0, v(400, 0, 0), 0);
  const scene = new Scene(), views = new VehicleViews(scene, w.world, {});
  const cam = { position: new Vector3(8, 3, 8), quaternion: { x: 0, y: 0, z: 0, w: 1 } };
  for (let i = 0; i < 10; i++) { w.step(); views.update(1 / 60, cam); }
  const before = lightsIn(scene);
  assert.ok(views.fireLights.every((l) => l.intensity === 0), 'no fire yet: the fire lights are dark');
  car.health.damage(car.health.hp + 50, { kind: 'explosion' }, null);
  far.health.damage(far.health.hp + 50, { kind: 'explosion' }, null);
  for (let i = 0; i < 90; i++) { w.step(); views.update(1 / 60, cam); }
  assert.ok(car.wreck && far.wreck, 'both burning wrecks');
  assert.equal(lightsIn(scene), before, 'the same lights in the scene');
  const lit = views.fireLights.filter((l) => l.intensity > 0);
  assert.ok(lit.length >= 1, 'a fire light on the burning car');
  assert.ok(Math.hypot(lit[0].position.x - car.movement.state.position.x, lit[0].position.z - car.movement.state.position.z) < 4, 'the nearest fire gets it');
  // Driving off into the fog and back: still the same lights.
  cam.position.set(2000, 3, 0);
  for (let i = 0; i < 5; i++) views.update(1 / 60, cam);
  assert.equal(lightsIn(scene), before);
});

test('a frame that falls behind runs a few ticks and drops the rest: slow motion, never a spiral', () => {
  let now = 0, ticks = 0;
  const rafs = [];
  globalThis.requestAnimationFrame = (f) => rafs.push(f);
  const realNow = performance.now.bind(performance);
  performance.now = () => now;
  try {
    const loop = new FixedLoop({ hz: 60, sim: () => { ticks++; now += 40; }, render: () => {} });   // each tick costs 40 ms (a computer far too slow)
    loop.start();
    for (let f = 0; f < 30; f++) { now += 16; rafs.shift()(); }
    assert.ok(ticks <= 30 * loop.maxSteps, `at most ${loop.maxSteps} ticks a frame (${ticks} in 30 frames)`);
    assert.ok(loop.acc < loop.dt, 'nothing owed past the cap');
    assert.ok(loop.behind > 0, 'and it knows it is behind');
    loop.stop();
  } finally {
    performance.now = realNow;
    delete globalThis.requestAnimationFrame;
  }
});
