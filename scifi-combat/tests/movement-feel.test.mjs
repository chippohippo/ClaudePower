// Feel contract: Helldivers 2 movement timings locked into tolerance bands. If a change makes
// movement lighter, floatier or laggier than these bands, CI fails. Numbers and how to
// re-measure them against HD2 captures: docs/MOVEMENT.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { MovementController, FlatGroundBody, angleDelta } from '../src/movement/MovementController.js';
import { hitSpheres } from '../src/movement/Hitboxes.js';

const T = JSON.parse(readFileSync(new URL('../data/movement.json', import.meta.url)));
const DT = 1 / 60;
const v = (x, y, z) => new Vector3(x, y, z);

/** A movement controller plus an input driver that produces clean button edges. */
function rig({ boxes = [], pos = v(0, 0, 0), mods = {} } = {}) {
  const body = new FlatGroundBody(pos, boxes);
  const m = new MovementController(T, body, mods, 1);
  m.state.position.copy(pos);
  const input = { moveX: 0, moveY: 0, yaw: 0, pitch: 0, held: new Set(), taps: new Set(), prev: new Set() };
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      const down = new Set([...input.held, ...input.taps]);
      const buttons = {};
      for (const k of new Set([...down, ...input.prev])) buttons[k] = { down: down.has(k), pressed: down.has(k) && !input.prev.has(k), released: !down.has(k) && input.prev.has(k) };
      input.prev = down; input.taps.clear();
      m.update({ moveX: input.moveX, moveY: input.moveY, yaw: input.yaw, pitch: 0, buttons }, DT);
    }
  };
  const seconds = (s) => step(Math.round(s / DT));
  const until = (pred, max = 10) => { for (let i = 0; i < max / DT; i++) { if (pred()) return i * DT; step(1); } return Infinity; };
  return { m, s: m.state, input, step, seconds, until, tap: (k) => input.taps.add(k), hold: (k) => input.held.add(k), release: (k) => input.held.delete(k) };
}
const speed = (s) => Math.hypot(s.velocity.x, s.velocity.z);

test('jog: near-zero latency start (90% jog <= 0.15 s) and a crisp stop (<= 0.15 s)', () => {
  const r = rig();
  r.input.moveY = 1;
  r.step(1);
  assert.ok(speed(r.s) > 0.4, 'motion starts on the very first tick');
  const t90 = r.until(() => speed(r.s) >= T.speeds.jog * 0.9) + DT;
  assert.ok(t90 <= 0.15, `0 to 90% jog took ${t90.toFixed(3)} s`);
  r.seconds(0.3);
  r.input.moveY = 0;
  const tStop = r.until(() => speed(r.s) < 0.05);
  assert.ok(tStop <= 0.15, `stop took ${tStop.toFixed(3)} s`);
});

test('sprint: the long, heavy ramp (jog to 95% sprint in 0.45-0.75 s)', () => {
  const r = rig();
  r.input.moveY = 1; r.hold('sprint');
  const t = r.until(() => speed(r.s) >= T.speeds.sprint * 0.95);
  assert.ok(t >= 0.45 && t <= 0.75, `ramp took ${t.toFixed(3)} s`);
  assert.equal(r.s.sprinting, true);
});

test('sprint release: a heavy skid of 0.8-1.6 m, never an instant stop', () => {
  const r = rig();
  r.input.moveY = 1; r.hold('sprint'); r.seconds(1.5);
  const z0 = r.s.position.z;
  r.input.moveY = 0; r.release('sprint');
  r.until(() => speed(r.s) < 0.05);
  const skid = Math.abs(r.s.position.z - z0);
  assert.ok(skid >= 0.8 && skid <= 1.6, `skid ${skid.toFixed(2)} m`);
});

test('sprint carve: the body turns at the sprint rate, velocity follows the body, speed mostly kept', () => {
  const r = rig();
  r.input.moveY = 1; r.hold('sprint'); r.seconds(1.5);
  r.input.yaw = Math.PI / 2; // swing the camera 90 degrees
  const t = r.until(() => Math.abs(angleDelta(r.s.bodyYaw, Math.PI / 2)) < 0.02);
  assert.ok(t >= 0.28 && t <= 0.45, `carve took ${t.toFixed(3)} s`);
  const velYaw = Math.atan2(-r.s.velocity.x, -r.s.velocity.z);
  assert.ok(Math.abs(angleDelta(velYaw, r.s.bodyYaw)) < 0.05, 'velocity follows the body (no strafe while sprinting)');
  assert.ok(speed(r.s) >= T.speeds.sprint * 0.72, `kept ${(speed(r.s) / T.speeds.sprint * 100).toFixed(0)}% of sprint speed`);
});

test('sprint reversal: plant-and-pivot skid (speed dips below half) before going the other way', () => {
  const r = rig();
  r.input.moveY = 1; r.hold('sprint'); r.seconds(1.5);
  r.input.moveY = -1;
  let minSpeed = Infinity;
  for (let i = 0; i < 60; i++) { r.step(1); minSpeed = Math.min(minSpeed, speed(r.s)); }
  assert.ok(minSpeed < T.speeds.sprint * 0.5, `min speed during the pivot ${minSpeed.toFixed(2)}`);
  r.seconds(1);
  assert.ok(r.s.velocity.z > 3, 'now sprinting the other way');
});

test('jog strafe: lateral input reaches 90% lateral speed within 0.2 s (third-person shooter response)', () => {
  const r = rig();
  r.input.moveY = 1; r.seconds(0.5);
  r.input.moveY = 0; r.input.moveX = 1;
  const t = r.until(() => r.s.velocity.x >= T.speeds.jog * 0.9);
  assert.ok(t <= 0.2, `strafe switch took ${t.toFixed(3)} s`);
  assert.ok(Math.abs(angleDelta(r.s.bodyYaw, 0)) < 0.01, 'body stays on the aim while strafing');
});

test('dive: low committed leap with i-frames, belly landing, belly slide, ends prone', () => {
  const r = rig();
  r.input.moveY = 1; r.hold('sprint'); r.seconds(1.5);
  const z0 = r.s.position.z;
  r.tap('dodge'); r.step(1);
  assert.equal(r.s.mode, 'dive');
  assert.equal(r.s.diveStarted, true);
  let iframeTicks = 0, air = 0;
  while (r.s.mode === 'dive' && air < 2) { r.step(1); air += DT; if (r.s.invulnerable) iframeTicks++; }
  assert.ok(air >= 0.3 && air <= 0.55, `airtime ${air.toFixed(3)} s`);
  assert.ok(iframeTicks * DT >= 0.2, `i-frames ${(iframeTicks * DT).toFixed(3)} s`);
  assert.equal(r.s.mode, 'slide');
  assert.equal(r.s.slide.kind, 'belly');
  r.input.moveY = 0; r.release('sprint');
  r.until(() => r.s.mode === 'ground');
  assert.equal(r.s.stance, 'prone');
  const dist = Math.abs(r.s.position.z - z0);
  assert.ok(dist >= 4 && dist <= 6.5, `dive travel ${dist.toFixed(2)} m`);
});

test('dive from a standstill goes forward; diving is impossible while prone', () => {
  const r = rig();
  r.tap('dodge'); r.step(1);
  assert.equal(r.s.mode, 'dive');
  assert.ok(r.s.velocity.z < -4, 'forward dive from standing still');
  r.until(() => r.s.mode === 'ground');
  r.tap('dodge'); r.step(1);
  assert.notEqual(r.s.mode, 'dive');
});

test('fast combat get-up after a dive beats the normal prone get-up', () => {
  const r = rig();
  r.tap('dodge'); r.step(1);
  r.until(() => r.s.mode === 'ground');
  r.tap('jump'); r.step(1);
  const fast = r.s.stanceT.dur;
  const r2 = rig();
  r2.tap('prone'); r2.step(1); r2.until(() => !r2.s.stanceT);
  r2.seconds(2);
  r2.tap('jump'); r2.step(1);
  assert.ok(fast < r2.s.stanceT.dur, `fast ${fast} vs normal ${r2.s.stanceT.dur}`);
});

test('slide: committed, carries 3.5-7 m on a friction curve, steerable, ends crouched when held', () => {
  const r = rig();
  r.input.moveY = 1; r.hold('sprint'); r.seconds(1.5);
  const z0 = r.s.position.z, x0 = r.s.position.x;
  r.hold('crouch'); r.step(1);
  assert.equal(r.s.mode, 'slide');
  r.input.moveX = 1; // steer right mid-slide
  const dur = r.until(() => r.s.mode !== 'slide') + DT;
  assert.ok(dur >= T.slide.minDuration && dur <= T.slide.maxDuration + 0.02, `slide lasted ${dur.toFixed(3)} s`);
  const dist = Math.hypot(r.s.position.z - z0, r.s.position.x - x0);
  assert.ok(dist >= 3.5 && dist <= 7, `slide distance ${dist.toFixed(2)} m`);
  assert.ok(r.s.position.x - x0 > 0.4, 'steered right');
  assert.equal(r.s.stance, 'crouch');
});

test('stance transitions take real time; crawling is slow; getting up is a commitment', () => {
  const r = rig();
  r.tap('prone'); r.step(1);
  assert.equal(r.s.stanceT?.to, 'prone');
  const t = r.until(() => !r.s.stanceT) + DT;
  assert.ok(Math.abs(t - T.stance.standToProne) < 0.05, `drop to prone ${t.toFixed(3)} s`);
  r.input.moveY = 1; r.seconds(1);
  assert.ok(Math.abs(speed(r.s) - T.speeds.prone) < 0.1, `crawl ${speed(r.s).toFixed(2)} m/s`);
  r.tap('jump'); r.step(1);
  assert.equal(r.s.stanceT?.to, 'stand');
  r.seconds(T.stance.proneToStand * T.stance.proneGetUpLockFrac * 0.8);
  assert.ok(speed(r.s) < 0.2, 'no movement during the first half of the get-up');
  r.until(() => !r.s.stanceT);
  assert.equal(r.s.stance, 'stand');
});

test('crouch: tap toggles, hold goes prone; firing is blocked while getting up from prone', () => {
  const r = rig();
  r.tap('crouch'); r.step(1); r.until(() => !r.s.stanceT);
  assert.equal(r.s.stance, 'crouch');
  r.tap('crouch'); r.step(2); r.until(() => !r.s.stanceT);
  assert.equal(r.s.stance, 'stand');
  r.hold('crouch'); r.seconds(1.2); r.release('crouch'); r.step(1);
  r.until(() => !r.s.stanceT);
  assert.equal(r.s.stance, 'prone');
  r.tap('jump'); r.step(1);
  assert.equal(r.s.weaponReady, false);
});

test('no coyote time and no jump buffer (HD2 has no such leniency)', () => {
  const ledge = [{ min: v(-5, 0, -5), max: v(5, 2, 0.2) }];
  const r = rig({ boxes: ledge, pos: v(0, 2, -1) });
  r.step(5);
  assert.equal(r.s.grounded, true);
  r.input.moveY = -1; // walk backwards off the edge (+z)
  r.until(() => !r.s.grounded);
  r.tap('jump'); r.step(1);
  assert.ok(r.s.velocity.y <= 0, 'no jump after leaving the ground');
  const r2 = rig();
  r2.tap('jump'); r2.step(1);
  assert.ok(r2.s.velocity.y > 3, 'hop from the ground works');
  r2.until(() => r2.s.velocity.y < 0);
  r2.tap('jump'); r2.step(1);
  r2.until(() => r2.s.grounded);
  r2.step(1);
  assert.ok(r2.s.velocity.y <= 0.01, 'a press in the air was not buffered into a landing jump');
});

test('landings: about 3 m stumbles, about 6 m knocks you down with fall damage', () => {
  const r = rig({ pos: v(0, 3, 0) });
  r.step(2); // spawned in mid-air: the first tick discovers there's no ground
  r.until(() => r.s.grounded);
  assert.equal(r.s.mode, 'land');
  let dmg = 0;
  const r2 = rig({ pos: v(0, 6, 0) });
  r2.m.hooks.fallDamage = (a) => (dmg += a);
  r2.step(2);
  r2.until(() => r2.s.grounded);
  assert.equal(r2.s.mode, 'knockdown');
  assert.ok(dmg > 0, 'fall damage applied');
  const getUp = r2.until(() => r2.s.mode === 'ground');
  assert.ok(getUp > 0.8 && getUp < 2, `recovered after ${getUp.toFixed(2)} s`);
});

test('stamina: about 14 s of sprint, then a jog until it refills enough to sprint again', () => {
  const r = rig();
  r.input.moveY = 1; r.hold('sprint');
  r.seconds(13);
  assert.equal(r.s.sprinting, true);
  const t = r.until(() => !r.s.sprinting, 3);
  assert.ok(13 + t <= 15, `sprint lasted ${(13 + t).toFixed(1)} s`);
  r.step(10);
  assert.equal(r.s.sprinting, false, 'exhausted');
  const back = r.until(() => r.s.sprinting, 5);
  assert.ok(back > 1 && back < 2.5, `sprint back after ${back.toFixed(2)} s`);
});

test('knockdown: explosions throw you (ragdoll-lite) and you get up; prone soldiers resist', () => {
  const r = rig();
  r.m.impulse(8, 3, 0, { cause: 'explosion' });
  r.step(1);
  assert.equal(r.s.mode, 'knockdown');
  const t = r.until(() => r.s.mode === 'ground', 5);
  assert.ok(t > 1 && t < 3.5, `down for ${t.toFixed(2)} s`);
  const p = rig();
  p.tap('prone'); p.step(1); p.until(() => !p.s.stanceT);
  p.m.impulse(8, 3, 0);
  p.step(1);
  assert.notEqual(p.s.mode, 'knockdown');
});

test('vault keeps momentum over a thin wall; climbing a 2 m block takes the climb time', () => {
  const wall = [{ min: v(-3, 0, -4.2), max: v(3, 1.0, -4.0) }];
  const r = rig({ boxes: wall });
  r.input.moveY = 1; r.hold('sprint'); r.seconds(0.5);
  r.hold('jump');
  r.until(() => r.s.mode === 'mantle', 2);
  const before = speed(r.s) || T.speeds.sprint;
  r.release('jump');
  r.until(() => r.s.mode !== 'mantle');
  assert.ok(r.s.position.z < -4.2, 'over the wall');
  assert.ok(speed(r.s) >= Math.min(before, T.speeds.sprint) * 0.75, `exit speed ${speed(r.s).toFixed(2)}`);

  const block = [{ min: v(-3, 0, -3), max: v(3, 2.0, 3) }];
  const c = rig({ boxes: block, pos: v(0, 0, 3.6) });
  c.input.moveY = 1; c.hold('jump');
  c.until(() => c.s.mode === 'mantle', 2);
  assert.equal(c.s.mantle.kind, 'climb');
  const t = c.until(() => c.s.mode !== 'mantle') + DT;
  assert.ok(Math.abs(t - T.mantle.climbDuration) < 0.05, `climb ${t.toFixed(3)} s`);
  assert.ok(Math.abs(c.s.position.y - 2) < 0.05, 'standing on top');
});

test('prone: the gun is clamped to an arc around the body, and the body turns slowly', () => {
  const r = rig();
  r.tap('prone'); r.step(1); r.until(() => !r.s.stanceT);
  r.input.yaw = Math.PI / 2;
  r.step(1);
  assert.ok(Math.abs(angleDelta(r.s.bodyYaw, r.s.aimYaw)) <= (T.stance.proneAimArc + 1) * Math.PI / 180, 'aim clamped to the arc');
  const t = r.until(() => Math.abs(angleDelta(r.s.bodyYaw, Math.PI / 2)) < 0.02);
  assert.ok(t > 0.7 && t < 1, `prone 90 degree turn took ${t.toFixed(2)} s`);
});

test('hitboxes follow the stance: prone and diving soldiers present a low profile', () => {
  const mk = () => rig();
  const head = (r) => hitSpheres({ movement: r.m }).find((h) => h.zone === 'head').y;
  const st = mk(); st.step(1);
  assert.ok(Math.abs(head(st) - 1.65) < 0.01);
  const cr = mk(); cr.tap('crouch'); cr.step(1); cr.until(() => !cr.s.stanceT);
  assert.ok(head(cr) < 1.2);
  const pr = mk(); pr.tap('prone'); pr.step(1); pr.until(() => !pr.s.stanceT);
  assert.ok(head(pr) < 0.5);
  const dv = mk(); dv.tap('dodge'); dv.step(3);
  assert.ok(head(dv) < 1.2, 'diving body is horizontal');
});
