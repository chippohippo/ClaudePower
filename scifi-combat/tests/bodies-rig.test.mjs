// The rig and what's underfoot (docs/ANIMATION.md, "Bodies and steps"): a foot planted on a kerb
// stands on the kerb (not inside it), the foot stepping up clears the kerb's edge on its way, no
// foot lands on a man lying on the ground (it swings over him), and pushing on into a wall puts a
// hand out flat against it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Vector3, Box3 } from 'three';
import { MovementController, FlatGroundBody } from '../src/movement/MovementController.js';
import { AnimationSystem } from '../src/anim/AnimationSystem.js';
import { BodyContacts, closestSegSeg } from '../src/movement/BodyContacts.js';
import { data, DT } from './harness.mjs';

const anim = JSON.parse(readFileSync(new URL('../data/animation/humanoid.json', import.meta.url)));
const T = data.movement;
const KERB = 0.16;

/** A soldier and his rig among `boxes`, the feet standing on box tops as the game's do (floorAt), optionally with others' bodies. */
function rigged(boxes, { start = new Vector3(0, 0, 4), yaw = 0, bodies = null } = {}) {
  const m = new MovementController(T, new FlatGroundBody(start, boxes), {}, 1);
  m.state.position.copy(start);
  m.state.bodyYaw = m.state.yaw = yaw;
  m.hooks.vital = () => 'alive';
  const e = { id: 1, team: 0, movement: m, mode: 'gun', health: { dead: false, downed: false }, weapons: { aimYaw: 0, aimPitch: 0, weaponPitch: 0, ads: 0, phase: 'ready', phaseTime: 0, phaseDuration: 0, current: { s: { archetype: 'assaultRifle' } } } };
  const floorAt = (x, z, near) => {
    if (near === undefined) return 0;
    let top = 0;
    for (const b of boxes) if (x >= b.min.x && x <= b.max.x && z >= b.min.z && z <= b.max.z && b.max.y <= near + 0.45) top = Math.max(top, b.max.y);
    return top;
  };
  const sys = new AnimationSystem(anim, { getEntity: () => null, groundY: floorAt, bodies });
  sys.add(e); sys.focusId = 1;
  const cmd = { moveX: 0, moveY: 0, yaw, pitch: 0, buttons: {} };
  const step = () => { sys.snapshot(); m.update(cmd, DT); bodies?.step([e], bodies.corpses ?? [], DT, (f, dx, dz) => f.movement.nudge(dx, dz)); sys.update(DT, 1, null); };
  return { m, e, h: sys.get(1), cmd, step, floorAt };
}

test('up a kerb at a jog: feet stand on it, not 16 cm inside it, and the stepping foot clears its edge', () => {
  // The street (z > 0), then a sidewalk slab 16 cm up from z = 0 on.
  const kerb = new Box3(new Vector3(-4, -0.25, -12), new Vector3(4, KERB, 0));
  const R = rigged([kerb]);
  R.cmd.moveY = 1;
  const ankleH = R.h.planter.dims.ankleH;
  let onKerb = 0, sunk = 0, clipped = 0;
  for (let i = 0; i < 150; i++) {
    R.step();
    for (const f of R.h.planter.feet) {
      const sole = f.ankle.y - ankleH;
      if (f.planted && f.plant.z < -0.15) { onKerb++; if (sole < KERB - 0.04) sunk++; }
      // Swinging past the kerb's front edge: the toe's above the slab (a hand's width of edge either side).
      if (!f.planted && f.pos.z < 0.12 && f.pos.z > -0.12 && f.from.z > 0.05) { if (f.pos.y < KERB - 0.02) clipped++; }
    }
  }
  assert.ok(R.m.state.position.z < -4, 'he got up onto it and went on');
  assert.ok(onKerb > 30, `feet planted on the sidewalk (${onKerb} samples)`);
  assert.equal(sunk, 0, 'none of them sunk into it');
  assert.equal(clipped, 0, 'and no stepping foot went through its edge');
});

test('walking across a man lying on the ground: no foot lands on him, and the one that crosses him lifts over him', () => {
  const contacts = new BodyContacts(T.bodies);
  contacts.corpses = [{ id: 7, ax: -0.9, az: 0, bx: 0.8, bz: 0, y: 0 }];   // (lying across the way, head to the left)
  const R = rigged([], { bodies: contacts });
  R.cmd.moveY = 1;
  const ankleH = R.h.planter.dims.ankleH, o = {};
  let onHim = 0, over = 0, low = 0;
  for (let i = 0; i < 160; i++) {
    R.step();
    for (const f of R.h.planter.feet) {
      closestSegSeg(-0.9, 0, 0.8, 0, f.pos.x, f.pos.z, f.pos.x, f.pos.z, o);
      const inside = o.d2 < (T.bodies.lying.radius * 0.9) ** 2;
      if (f.planted && inside) onHim++;
      if (!f.planted && inside) { over++; if (f.ankle.y - ankleH < 0.18) low++; }
    }
  }
  assert.ok(R.m.state.position.z < -3, 'he got across');
  assert.equal(onHim, 0, 'no foot planted on the body');
  assert.ok(over > 2, `a foot swung over him (${over} samples)`);
  assert.ok(low <= 1, `well clear of him (${low} low samples)`);
});

test('pushing on into a wall: a hand goes out flat against it', () => {
  const wall = new Box3(new Vector3(-3, 0, -1.5), new Vector3(3, 2.5, -1));
  const R = rigged([wall], { start: new Vector3(0, 0, 1) });
  R.cmd.moveY = 1;
  let hand = 0;
  for (let i = 0; i < 120; i++) { R.step(); if (i > 60) hand = Math.max(hand, R.h.pose.handW[0]); }
  assert.ok(R.m.state.wallPress.k > 0.6, `pushing into it (${R.m.state.wallPress.k.toFixed(2)})`);
  assert.ok(hand > 0.6, `the hand's out (${hand.toFixed(2)})`);
  const p = R.h.pose.hand[0];
  assert.ok(p.z < -0.5 && p.z > -1.25, `out toward the wall (z ${p.z.toFixed(2)})`);
});
