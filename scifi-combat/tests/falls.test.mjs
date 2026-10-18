// Going over an edge: a dive off a drop braces for it (a ragdoll reaching for the ground), a slide
// off a ledge comes down into a forward roll (or slides on off a step, or crumples from too high).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Vector3, Box3 } from 'three';
import { MovementController, FlatGroundBody } from '../src/movement/MovementController.js';
import { AnimationSystem } from '../src/anim/AnimationSystem.js';
import { J } from '../src/physics/Ragdoll.js';
import { data, DT } from './harness.mjs';

const anim = JSON.parse(readFileSync(new URL('../data/animation/humanoid.json', import.meta.url)));
const T = data.movement;

/** A soldier on a ledge `h` m high whose edge is 3 m ahead (yaw 0 runs at -z), with his rig. */
function ledge(h) {
  const boxes = h > 0 ? [new Box3(new Vector3(-6, 0, -3), new Vector3(6, h, 30))] : [];
  const pos = new Vector3(0, h, 14);
  const m = new MovementController(T, new FlatGroundBody(pos, boxes), {}, 1);
  m.state.position.copy(pos);
  const hurt = [];
  m.hooks.fallDamage = (a) => hurt.push(a);
  m.hooks.vital = () => 'alive';
  const e = { id: 1, movement: m, mode: 'gun', health: { dead: false }, weapons: { aimYaw: 0, aimPitch: 0, weaponPitch: 0, ads: 0, phase: 'ready', phaseTime: 0, phaseDuration: 0, current: { s: { archetype: 'assaultRifle' } } } };
  const sys = new AnimationSystem(anim, { getEntity: () => null });
  sys.add(e); sys.focusId = 1;
  const held = new Set(['sprint']), taps = new Set();
  let prev = new Set();
  const cmd = { moveX: 0, moveY: 1, yaw: 0, pitch: 0, buttons: {} };
  const step = (onFrame) => {
    const down = new Set([...held, ...taps]);
    for (const k of ['sprint', 'crouch', 'dodge']) cmd.buttons[k] = { down: down.has(k), pressed: down.has(k) && !prev.has(k), released: !down.has(k) && prev.has(k) };
    prev = down; taps.clear();
    sys.snapshot(); m.update(cmd, DT); sys.update(DT, 1, null);
    onFrame?.();
  };
  // Run for the edge, then do it 1.4 m short of it.
  const go = (key) => { while (m.state.position.z > -1.6) step(); taps.add(key); held.clear(); cmd.moveY = 0; };
  return { m, s: m.state, h: sys.get(1), hurt, step, go };
}

test('dives get more air and go farther: about half a metre up and half a second in the air', () => {
  const d = T.dive, air = (2 * d.upVelocity) / d.gravity, apex = (d.upVelocity * d.upVelocity) / (2 * d.gravity);
  assert.ok(air >= 0.48 && apex >= 0.45, `${air.toFixed(2)} s, ${apex.toFixed(2)} m`);
});

test('a dive off a drop braces for it: limp, arms out ahead and down, hands to the ground, up again soon', () => {
  const r = ledge(4);
  r.go('dodge');
  let limpAt = -1, braced = 0, ahead = 0, landed = -1, t = 0;
  const P = new Vector3(), S = new Vector3(), H = new Vector3();
  for (let i = 0; i < 400 && r.s.mode !== 'knockdown'; i++) {
    r.step(); t += DT;
    if (r.s.mode !== 'ragdoll') continue;
    const rd = r.m.ragdoll;
    if (limpAt < 0) { limpAt = t; assert.ok(rd.drive.brace, 'it saw the fall coming'); }
    if (rd.drive.phase === 'air') {
      braced++;
      // Both hands out ahead of the shoulders (the way it's going, -z) and below them.
      for (const [sh, hand] of [[J.SHOULDER_L, J.HAND_L], [J.SHOULDER_R, J.HAND_R]]) {
        rd.get(sh, S); rd.get(hand, H);
        if (H.z < S.z - 0.15 && H.y < S.y) ahead++;
      }
    }
    if (landed < 0 && rd.grounded && rd.get(J.CHEST, P).y < 0.5) landed = t;
  }
  assert.ok(limpAt > 0 && limpAt < 0.4, `went limp over the edge (${limpAt.toFixed(2)} s)`);
  assert.ok(braced > 20, `braced in the air (${braced} ticks)`);
  assert.ok(ahead >= braced * 1.6, `hands out ahead and down (${ahead} of ${braced * 2})`);
  assert.equal(r.s.mode, 'knockdown', 'getting up');
  assert.ok(landed > 0 && t - landed < 1.2, `up within a second or so of landing (${(t - landed).toFixed(2)} s)`);
  assert.equal(r.hurt.length, 0, 'a 4 m drop braced for: no damage');
  for (let i = 0; i < 90 && r.s.mode !== 'ground'; i++) r.step();
  assert.equal(r.s.mode, 'ground');
});

test('a hard landing hurts a falling body; bracing for it takes some off', () => {
  // The same 10 m drop, braced (a dive off it) and not (thrown limp the moment it goes over).
  const a = ledge(10);
  a.go('dodge');
  for (let i = 0; i < 400 && a.s.mode !== 'knockdown'; i++) a.step();
  const b = ledge(10);
  b.go('dodge');
  for (let i = 0; i < 120 && b.s.mode !== 'ragdoll'; i++) b.step();
  // (b went limp braced; make it the unbraced fall a blast would throw.)
  b.m.fall.brace = false; b.m.ragdoll.drive.brace = false;
  for (let i = 0; i < 400 && b.s.mode !== 'knockdown'; i++) b.step();
  const A = a.hurt.reduce((x, y) => x + y, 0), B = b.hurt.reduce((x, y) => x + y, 0);
  assert.ok(A > 0 && B > A, `braced ${A.toFixed(0)} < unbraced ${B.toFixed(0)}`);
});

test('a slide off a ledge comes down into a roll: no stumble, no knockdown, up crouched and still going', () => {
  const r = ledge(3);
  r.go('crouch');
  const modes = [];
  let upsideDown = false, speedOut = 0, maxTurn = 0;
  const prevD = new Vector3(), frames = [];
  for (let i = 0; i < 200; i++) {
    r.step();
    if (modes.at(-1) !== r.s.mode) modes.push(r.s.mode);
    if (r.s.mode === 'roll') {
      const d = r.h.F.chest.d;
      if (d.y < -0.4) upsideDown = true;
      if (frames.length) maxTurn = Math.max(maxTurn, prevD.angleTo(d));
      prevD.copy(d); frames.push(d.y);
      speedOut = r.s.speed;
    }
    if (modes.includes('roll') && r.s.mode === 'ground') break;
  }
  assert.deepEqual(modes, ['slide', 'air', 'roll', 'ground'], modes.join(' > '));
  assert.equal(r.hurt.length, 0, 'no fall damage from 3 m');
  assert.equal(r.s.stance, 'crouch');
  assert.ok(speedOut > 2, `still moving coming out of it (${speedOut.toFixed(1)} m/s)`);
  assert.ok(upsideDown, 'the body goes right over');
  assert.ok(maxTurn < 0.75, `turning smoothly, no pop (${maxTurn.toFixed(2)} rad in a frame)`);
  r.step(); r.step();
  assert.ok(r.h.F.chest.d.y > 0.6, 'and comes up the right way up');
});

test('off a step a slide slides on; off too high a drop it can\'t be rolled out of', () => {
  const low = ledge(0.6);
  low.go('crouch');
  const seen = [];
  for (let i = 0; i < 80; i++) { low.step(); if (seen.at(-1) !== low.s.mode) seen.push(low.s.mode); }
  assert.deepEqual(seen.slice(0, 3), ['slide', 'air', 'slide'], seen.join(' > '));
  assert.equal(low.s.slide?.kind ?? 'feet', 'feet');
  const high = ledge(14);
  high.go('crouch');
  for (let i = 0; i < 200 && high.s.mode !== 'ragdoll'; i++) high.step();
  assert.equal(high.s.mode, 'ragdoll', 'crumpled');
  assert.ok(high.hurt.length && high.hurt[0] > 30, `and hurt (${high.hurt[0]?.toFixed(0)})`);
});
