// Spent brass (GunFx's BrassField): a casing comes down on whatever is under it as it falls (the
// ground, a crate, the street below a roof's edge), bounces at most three times, rings once, and
// lies on its side; a full field drops its oldest. And the tink it makes is a sound in the bank.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { BrassField } from '../src/vfx/GunFx.js';
import { render, catalogue } from '../src/audio/SoundBank.js';

const seeded = (seed = 9) => { let s = seed; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };
const RIFLE = [0.03, 0.0075];
const run = (F, seconds) => { for (let t = 0; t < seconds; t += 1 / 60) F.step(1 / 60); };
const axisY = (q) => new Vector3(1, 0, 0).applyQuaternion(q).y;

test('brass: thrown right and up from the gun, it lands beside you, bounces, rings once and lies on its side', () => {
  let rings = 0;
  const F = new BrassField(8, { floor: () => 0, onRing: () => rings++, rand: seeded() });
  const i = F.throw(new Vector3(0, 1.4, 0), new Vector3(2.4, 2.2, 0.3), new Vector3(0, 0, -1), RIFLE);
  run(F, 0.3);
  assert.ok(F.rest[i] < 0 && F.p[i * 3 + 1] > 1.4, 'still climbing out of the port');
  run(F, 2.7);
  assert.ok(F.rest[i] >= 0, 'at rest within 3 s');
  assert.ok(Math.abs(F.p[i * 3 + 1] - RIFLE[1]) < 1e-6, `lying on the ground (${F.p[i * 3 + 1]})`);
  assert.ok(F.bounces[i] >= 1 && F.bounces[i] <= 3, `${F.bounces[i]} bounces`);
  assert.equal(rings, 1, 'it rings on the first bounce only');
  assert.ok(Math.abs(axisY(F.q[i])) < 1e-6, 'on its side');
  const x = F.p[i * 3];
  assert.ok(x > 1 && x < 4, `to the right of the gun, a metre or few away (${x.toFixed(2)} m)`);
  run(F, 1);
  assert.equal(F.p[i * 3], x, 'and it stays put');
});

test('brass: it comes down on a crate in its way, off a roof it falls to the street, and it fades after lying a while', () => {
  // A crate 0.9 m high from x = 0.8 to 3 m; a roof at 5 m for x < 0.5 with the street below.
  const crate = (x, y, z) => (x > 0.8 && x < 3 && Math.abs(z) < 1 && y >= 0.9 ? 0.9 : 0);
  const F = new BrassField(8, { floor: crate, rand: seeded(3) });
  const a = F.throw(new Vector3(0, 1.4, 0), new Vector3(2.4, 2.2, 0), new Vector3(0, 0, -1), RIFLE);
  run(F, 3);
  assert.ok(Math.abs(F.p[a * 3 + 1] - (0.9 + RIFLE[1])) < 1e-6, `on the crate's top (${F.p[a * 3 + 1].toFixed(3)})`);
  const roof = (x, y) => (x < 0.5 && y >= 5 ? 5 : 0);
  const G = new BrassField(8, { floor: roof, rand: seeded(4) });
  const b = G.throw(new Vector3(0.3, 6.4, 0), new Vector3(2.4, 2.2, 0), new Vector3(0, 0, -1), RIFLE);
  run(G, 4);
  assert.ok(G.rest[b] >= 0 && Math.abs(G.p[b * 3 + 1] - RIFLE[1]) < 1e-6, `down in the street (${G.p[b * 3 + 1].toFixed(3)})`);
  // Thrown back over the roof (a shooter at its edge facing out), it stays up there.
  const c = G.throw(new Vector3(0.45, 6.4, 0), new Vector3(-1.2, 2, 0), new Vector3(0, 0, -1), RIFLE);
  run(G, 3);
  assert.ok(Math.abs(G.p[c * 3 + 1] - (5 + RIFLE[1])) < 1e-6, `on the roof (${G.p[c * 3 + 1].toFixed(3)})`);
  assert.equal(G.left(c), 1);
  run(G, 26);
  assert.equal(G.left(c), 0, 'gone after lying 25 s');
});

test('brass: a full field throws out its oldest; the tink renders for hard ground, dirt and snow', () => {
  const F = new BrassField(4, { floor: () => 0, rand: seeded(5) });
  const slots = [];
  for (let k = 0; k < 6; k++) slots.push(F.throw(new Vector3(k, 1.4, 0), new Vector3(2, 2, 0), new Vector3(0, 0, -1), RIFLE));
  assert.equal(F.n, 4);
  assert.deepEqual(slots, [0, 1, 2, 3, 0, 1], 'the oldest slots are reused first');
  for (const s of ['hard', 'dirt', 'snow']) {
    assert.ok(catalogue().includes(`brass:${s}`));
    const { ch } = render(`brass:${s}`, 0);
    let peak = 0; for (const v of ch[0]) peak = Math.max(peak, Math.abs(v));
    assert.ok(peak > 0.3 && peak <= 1, `brass:${s} is a sound (${peak.toFixed(2)})`);
  }
});
