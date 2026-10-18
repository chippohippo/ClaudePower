// Bots and bodies (docs/AI.md, "Bodies"): a bot on its way goes round a teammate standing in it and
// round someone lying on the ground instead of into them; a bot holding still steps aside for a
// teammate pushing past; two pairs going opposite ways down a trench pass each other.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CoverIndex } from '../src/world/CoverIndex.js';
import { NavGrid } from '../src/world/NavGrid.js';
import { bus } from '../src/core/EventBus.js';
import { makeWorld, v, data } from './harness.mjs';

const B = data.movement.bodies;
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
function open(cover = new CoverIndex([], { cell: 8 })) {
  const W = makeWorld(cover, { bodies: true });
  W.world.nav = new NavGrid({ minX: -60, minZ: -60, width: 120, depth: 120, cell: 2 }, { cover });
  return W;
}

test('a bot on its way goes round a teammate standing in it, not into him', () => {
  const W = open();
  const b = W.bot(1, 0, v(0, 0, 20), 'lancer');
  const mate = W.fighter(2, 0, v(0.1, 0, 0), 'lancer');
  W.brainOf(b).order = { kind: 'move', pos: v(0, 0, -20), arrive: 1.5 };
  const p = b.movement.state.position, q = mate.movement.state.position;
  let closest = 9, touching = 0;
  for (let i = 0; i < 60 * 14 && flat(p, v(0, 0, -20)) > 2; i++) {
    W.step();
    const d = flat(p, q);
    closest = Math.min(closest, d);
    if (d < 2 * B.radius.medium + 0.02) touching++;
  }
  assert.ok(flat(p, v(0, 0, -20)) <= 2.5, `got there (${p.z.toFixed(1)})`);
  assert.ok(closest > 2 * B.radius.medium - 0.04, `never into him (${closest.toFixed(2)} m)`);
  assert.ok(touching < 12, `hardly brushing him (${touching} ticks)`);
  assert.ok(flat(q, v(0.1, 0, 0)) < 0.15, 'he wasn\'t shoved aside');
});

test('steering: round a teammate standing in the way; not round the enemy you\'re closing on', () => {
  const W = open();
  const me = W.fighter(1, 0, v(0, 0, 0), 'lancer');
  const mate = W.fighter(2, 0, v(0, 0, -1), 'lancer');
  W.step();   // (the bodies as they stand)
  const o = {};
  W.world.bodies.steer(me, 0, -1, o);
  assert.ok(Math.abs(o.x) > 0.3 && o.slow < 0.9, `turned off and easing up for the teammate (${o.x.toFixed(2)}, slow ${o.slow.toFixed(2)})`);
  // The same man, but one of theirs: straight on, at a blade's reach and into him.
  mate.team = 1;
  W.step();
  W.world.bodies.steer(me, 0, -1, o);
  assert.ok(o.x === 0 && o.z === -1 && o.slow === 1, `straight at him (${o.x.toFixed(2)}, ${o.z.toFixed(2)}, slow ${o.slow.toFixed(2)})`);
});

test('a bot goes round a body lying across its way rather than over it', () => {
  const W = open();
  const b = W.bot(1, 0, v(0, 0, 20), 'lancer');
  W.world.corpses.push({ id: 9, ax: -0.9, az: 0, bx: 0.8, bz: 0, y: 0 });
  W.brainOf(b).order = { kind: 'move', pos: v(0, 0, -20), arrive: 1.5 };
  const p = b.movement.state.position;
  let over = 0;
  for (let i = 0; i < 60 * 14 && flat(p, v(0, 0, -20)) > 2; i++) { W.step(); if (b.movement.state.overBody > 0) over++; }
  assert.ok(flat(p, v(0, 0, -20)) <= 2.5, 'got there');
  assert.ok(over < 8, `round the body, not across it (${over} ticks over it)`);
});

test('a bot holding still steps aside for a teammate pushing past', () => {
  const W = open();
  const b = W.bot(1, 0, v(0, 0, 0), 'lancer');
  const brain = W.brainOf(b);
  brain.order = { kind: 'move', pos: v(0, 0, 0), arrive: 1.5 };   // (there already: holding)
  W.seconds(0.5);
  const me = W.fighter(2, 0, v(0, 0, 3), 'lancer');   // (a scripted soldier: the player, walking straight through)
  W.move(me, 0, 1); W.aim(me, 0);
  const p = b.movement.state.position, start = p.clone();
  let side = 0;
  for (let i = 0; i < 60 * 4 && me.movement.state.position.z > -3; i++) { W.step(); side = Math.max(side, Math.abs(p.x - start.x)); }
  assert.ok(me.movement.state.position.z <= -3, `the teammate got by (${me.movement.state.position.z.toFixed(1)})`);
  assert.ok(side > 0.3, `the bot stepped aside for him (${side.toFixed(2)} m)`);
});

test('two pairs going opposite ways down a trench pass each other, nobody stuck', () => {
  // A 1.8 m trench between two walls, 40 m long.
  const wall = (x0, x1) => ({ min: v(x0, 0, -22), max: v(x1, 2.2, 22), kind: 'wall', surface: 'dirt' });
  const cover = new CoverIndex([wall(-4, -0.9), wall(0.9, 4)], { cell: 8 });
  const W = open(cover);
  const squeezes = [];
  const off = bus.on('body:squeeze', (e) => squeezes.push(e));
  try {
    const north = [W.bot(1, 0, v(-0.2, 0, 18), 'lancer'), W.bot(2, 0, v(0.2, 0, 20), 'lumen')];
    const south = [W.bot(3, 0, v(0.1, 0, -18), 'lancer'), W.bot(4, 0, v(-0.1, 0, -20), 'bastion')];
    for (const b of north) W.brainOf(b).order = { kind: 'move', pos: v(0, 0, -17), arrive: 1.5 };
    for (const b of south) W.brainOf(b).order = { kind: 'move', pos: v(0, 0, 17), arrive: 1.5 };
    const there = () => north.every((b) => b.movement.state.position.z < -14) && south.every((b) => b.movement.state.position.z > 14);
    let t = 0;
    while (!there() && t < 30) { W.step(); t += 1 / 60; }
    assert.ok(there(), `all four through in ${t.toFixed(1)} s (${[...north, ...south].map((b) => b.movement.state.position.z.toFixed(1)).join(', ')})`);
    assert.ok(t < 22, `without a long jam (${t.toFixed(1)} s for 35 m)`);
  } finally { off(); }
});
