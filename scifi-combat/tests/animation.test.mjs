// Animation contract tests: the procedural rig, the clip controller, LOD and the crowd renderer.
// The rules under test are the user-facing ones: no foot sliding at any speed or frame rate,
// cadence that matches ground speed, footstep/impact events on the frame the foot or body
// visibly hits, hit spheres that match the drawn body, and transitions that follow the sim's timers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Vector3, Group, Bone, Scene, AnimationClip, VectorKeyframeTrack, QuaternionKeyframeTrack, Matrix4 } from 'three';
import { bus } from '../src/core/EventBus.js';
import { MovementController, FlatGroundBody } from '../src/movement/MovementController.js';
import { AnimationSystem } from '../src/anim/AnimationSystem.js';
import { ClipAnimationController } from '../src/anim/ClipAnimationController.js';
import { CrowdRenderer } from '../src/render/CrowdRenderer.js';
import { CameraRig, eyeOf, sightOf, cameraSolid } from '../src/camera/CameraRig.js';
import { hitSpheres } from '../src/movement/Hitboxes.js';
import { table, angleDelta } from '../src/anim/ik.js';
import { makeWorld, data, DT, v } from './harness.mjs';

const anim = JSON.parse(readFileSync(new URL('../data/animation/humanoid.json', import.meta.url)));
const KEYS = ['sprint', 'crouch', 'prone', 'dodge', 'jump', 'light', 'guard'];

/** Collects bus events of the given types while `fn` runs. */
function capture(types, fn) {
  const got = [];
  const offs = types.map((t) => bus.on(t, (e) => got.push({ type: t, ...e })));
  try { fn(got); } finally { offs.forEach((f) => f()); }
  return got;
}

/**
 * A fighter driven like the game: fixed 60 Hz sim, render frames at `hz` with interpolation
 * through AnimationSystem (snapshot before each tick, alpha between ticks).
 */
function rig({ hz = 60, mods = {}, id = 1, weapons = null, mode = 'gun' } = {}) {
  const m = new MovementController(data.movement, new FlatGroundBody(new Vector3()), mods, id);
  const e = {
    id, movement: m, mode, health: { dead: false },
    weapons: weapons ?? { aimYaw: 0, aimPitch: 0, weaponPitch: 0, ads: 0, phase: 'ready', phaseTime: 0, phaseDuration: 0, current: { s: { archetype: 'assaultRifle' } } },
  };
  const sys = new AnimationSystem(anim, { getEntity: () => null });
  sys.add(e); sys.focusId = id;
  const h = sys.get(id);
  const held = new Set(); let prev = new Set();
  const cmd = { moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons: {} };
  let simTime = 0, renderTime = 0;
  const r = {
    m, e, h, sys, cmd, held,
    /** Advance `seconds` of render time; onFrame(r) runs after every rendered frame. */
    run(seconds, onFrame) {
      const end = renderTime + seconds;
      while (renderTime < end - 1e-9) {
        renderTime += 1 / hz;
        while (simTime < renderTime - 1e-9) {
          for (const k of KEYS) cmd.buttons[k] = { down: held.has(k), pressed: held.has(k) && !prev.has(k), released: !held.has(k) && prev.has(k) };
          prev = new Set(held);
          sys.snapshot();
          m.update(cmd, DT);
          if (!weapons) { e.weapons.aimYaw = m.state.aimYaw; }
          simTime += DT;
        }
        const alpha = 1 - (simTime - renderTime) / DT;
        sys.update(1 / hz, alpha, null);
        onFrame?.(r);
      }
      return r;
    },
    tap(k, s = 2 / 60) { held.add(k); r.run(s); held.delete(k); return r; },
  };
  return r.run(0.3);
}

/** Heel and toe points of a solved foot (world). */
function footPoints(h, i) {
  const j = h.j, d = h.d, yaw = j.footYaw[i], p = j.footPitch[i];
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw), c = Math.cos(p), s = Math.sin(p);
  const fwd = new Vector3(fx * c, s, fz * c), up = new Vector3(-fx * s, c, -fz * s);
  const heel = j.ankle[i].clone().addScaledVector(fwd, -d.heel).addScaledVector(up, -d.ankleH);
  const toe = j.ankle[i].clone().addScaledVector(fwd, d.toe).addScaledVector(up, -d.ankleH);
  return { heel, toe, pitch: p };
}

for (const hz of [60, 144]) {
  test(`planted feet never slide (render ${hz} Hz): jog, sprint, carve, stop, strafe, backpedal, crouch walk`, () => {
    const r = rig({ hz });
    let worstDrift = 0, worstReach = 0, plantedFrames = 0;
    const last = [null, null];
    const check = () => {
      for (let i = 0; i < 2; i++) {
        const f = r.h.planter.feet[i];
        if (!f.planted || !r.h.planterLive || r.h.w.loco < 0.999) { last[i] = null; continue; }
        plantedFrames++;
        worstReach = Math.max(worstReach, r.h.j.ankle[i].distanceTo(r.h.pose.foot[i]));
        const pts = footPoints(r.h, i);
        // The heel pivots at heel strike, the toe at push-off, and both stay put when flat.
        if (last[i] && last[i].plant.equals(f.plant)) {
          const a = pts.pitch >= 0 ? pts.heel.distanceTo(last[i].heel) : Infinity;
          const b = pts.pitch <= 0 ? pts.toe.distanceTo(last[i].toe) : Infinity;
          worstDrift = Math.max(worstDrift, Math.min(a, b));
        }
        last[i] = { plant: f.plant.clone(), heel: pts.heel, toe: pts.toe };
      }
    };
    r.cmd.moveY = 1; r.run(1, check);
    r.held.add('sprint'); r.run(2, check);
    for (let k = 0; k < 30; k++) { r.cmd.yaw += (Math.PI / 2) / 30; r.run(1 / 60, check); }   // hard carve
    r.run(0.5, check);
    r.held.delete('sprint'); r.cmd.moveY = 0; r.run(1, check);                               // skid and stop
    r.cmd.moveX = -1; r.run(1, check); r.cmd.moveX = 0;                                      // strafe
    r.cmd.moveY = -1; r.run(1, check);                                                       // backpedal
    r.tap('crouch'); r.cmd.moveY = 1; r.run(1.2, check);                                     // crouch walk
    assert.ok(plantedFrames > 200, `checked ${plantedFrames} planted frames`);
    assert.ok(worstReach < 0.002, `IK always reaches a planted foot (worst miss ${(worstReach * 1000).toFixed(2)} mm)`);
    assert.ok(worstDrift < 0.003, `pivot point drift per frame ${(worstDrift * 1000).toFixed(2)} mm`);
  });
}

test('cadence matches ground speed and footfall weight scales with gait and stance', () => {
  const steps = (r, s) => capture(['anim:footstep'], () => r.run(s)).filter((e) => e.id === r.e.id);
  const stride = (k, sp) => table(anim.gait[k].stride, sp);
  let r = rig();
  r.cmd.moveY = 1; r.run(1);
  const jog = steps(r, 3);
  const expectJog = (4.5 / (stride('stand', 4.5) / 2)) * 3;
  assert.ok(Math.abs(jog.length - expectJog) <= expectJog * 0.1 + 1, `jog: ${jog.length} steps in 3 s, expected ~${expectJog.toFixed(1)}`);
  r.held.add('sprint'); r.run(1.5);
  const sprint = steps(r, 3);
  const expectSprint = (7.2 / (stride('stand', 7.2) / 2)) * 3;
  assert.ok(Math.abs(sprint.length - expectSprint) <= expectSprint * 0.1 + 1, `sprint: ${sprint.length} steps in 3 s, expected ~${expectSprint.toFixed(1)}`);
  const mean = (a) => a.reduce((s, e) => s + e.intensity, 0) / a.length;
  assert.ok(sprint.every((e) => e.gait === 'sprint'));
  assert.ok(mean(sprint) > mean(jog) * 1.3, 'sprint footfalls land much heavier than jog footfalls');
  r = rig(); r.tap('crouch'); r.run(0.4); r.cmd.moveY = 1; r.run(0.5);
  const crouch = steps(r, 2);
  assert.ok(crouch.length >= 4 && crouch.every((e) => e.stance === 'crouch'));
  assert.ok(mean(crouch) < mean(jog) * 0.6, 'crouch walking is quiet');
  r = rig(); r.held.add('prone'); r.run(0.05); r.held.delete('prone'); r.run(0.8); r.cmd.moveY = 1; r.run(0.5);
  const crawl = steps(r, 2);
  assert.ok(crawl.length >= 2 && crawl.every((e) => e.gait === 'crawl'), 'crawling has its own soft contacts');
  assert.ok(mean(crawl) < mean(crouch));
  // Heavy armor stomps, light armor treads softer.
  const heavy = rig({ mods: { armor: 'heavy' } }); heavy.cmd.moveY = 1; heavy.run(1);
  assert.ok(mean(steps(heavy, 2)) > mean(jog) * 1.1);
});

test('footstep events fire on the frame the foot plants, at the plant point', () => {
  const r = rig({ hz: 144 });
  r.cmd.moveY = 1; r.held.add('sprint'); r.run(1);
  let checked = 0;
  const pending = [];
  const off = bus.on('anim:footstep', (e) => e.id === r.e.id && pending.push(e));
  r.run(2, () => {
    for (const e of pending) {
      const f = r.h.planter.feet[e.foot];
      assert.ok(f.planted, 'the foot is planted on the event frame');
      assert.ok(Math.hypot(f.plant.x - e.x, f.plant.z - e.z) < 1e-6, 'event position is the plant point');
      assert.ok(r.h.j.ankle[e.foot].distanceTo(r.h.pose.foot[e.foot]) < 0.002, 'and the drawn foot is on it');
      checked++;
    }
    pending.length = 0;
  });
  off();
  assert.ok(checked >= 6, `checked ${checked} footfalls`);
  // The camera's bob is driven by exactly these events.
  const cam = new CameraRig({ aspect: 1 });
  cam.update(1 / 60, { target: r.e, pos: r.e.movement.state.position, yaw: 0, pitch: 0 });
  const before = cam.bobY.v;
  bus.emit('anim:footstep', { id: r.e.id, foot: 0, gait: 'sprint', intensity: 1 });
  assert.ok(cam.bobY.v < before - 0.3, 'a sprint footfall kicks the camera down');
});

test('hit spheres sit on the drawn body in every pose', () => {
  const near = (label, r) => {
    const hs = hitSpheres(r.e);
    const dh = r.h.j.head.distanceTo(new Vector3(hs[0].x, hs[0].y, hs[0].z));
    const dc = r.h.j.chestC.distanceTo(new Vector3(hs[1].x, hs[1].y, hs[1].z));
    assert.ok(dh < 0.12, `${label}: head sphere ${dh.toFixed(2)} m from the drawn head`);
    assert.ok(dc < 0.15, `${label}: chest sphere ${dc.toFixed(2)} m from the drawn chest`);
  };
  let r = rig(); r.run(0.3); near('stand', r);
  r.tap('crouch'); r.run(0.5); near('crouch', r);
  r = rig(); r.tap('prone'); r.run(0.9); near('prone', r);
  r = rig(); r.cmd.moveY = 1; r.held.add('sprint'); r.run(1.3); r.tap('crouch', 1 / 60); r.run(0.22); near('slide', r);
  r = rig(); r.cmd.moveY = 1; r.held.add('sprint'); r.run(1.3); r.tap('dodge'); r.run(0.12); near('dive', r);
  r = rig(); r.cmd.moveY = -1; r.tap('dodge'); r.cmd.moveY = 0; r.run(0.12); near('back dive', r); r.run(1.6); near('supine', r);
});

test('the gun comes up exactly on the sim sprint-to-fire timer', () => {
  const H = makeWorld();
  const f = H.fighter(1, 0, v(0, 0, 0), 'dawnblade');
  f.mode = 'gun';
  const sys = new AnimationSystem(anim);
  const h = sys.add(f); sys.focusId = 1;
  const frame = () => { sys.snapshot(); H.step(1); sys.update(DT, 1, null); };
  H.move(f, 0, 1); H.hold(f, 'sprint');
  for (let i = 0; i < 60; i++) frame();
  assert.ok(f.movement.state.sprinting && h.raise < 0.1, 'port arms while sprinting');
  H.release(f, 'sprint');
  let readyAt = null;
  for (let i = 0; i < 40 && readyAt === null; i++) { frame(); if (f.weapons.phase === 'ready') readyAt = h.raise; }
  assert.ok(readyAt !== null, 'weapon became ready');
  assert.ok(readyAt > 0.85, `gun is up (${readyAt.toFixed(2)}) on the tick it can fire`);
  // The muzzle points where the weapon aims (ergonomics drag included), not where the camera looks.
  H.aim(f, 1.0, 0);
  frame(); frame();
  const gunYaw = Math.atan2(-h.prop.dir.x, -h.prop.dir.z);
  assert.ok(Math.abs(gunYaw - f.weapons.aimYaw) < 0.12, 'gun follows the weapon aim');
  assert.ok(Math.abs(gunYaw - 1.0) > 0.05, 'and trails the look during a fast turn');
});

test('stance transitions follow stanceT: prone drop impact on cue, chest rises before the hips', () => {
  const r = rig({ hz: 144 });
  let u = null;
  const drops = capture(['anim:impact'], (got) => {
    r.held.add('prone'); r.run(1 / 60); r.held.delete('prone');
    r.run(0.8, () => { if (got.length && u === null) { const t = r.m.state.stanceT; u = t ? t.t / t.dur : 1; } });
  }).filter((e) => e.kind === 'proneDrop');
  assert.equal(drops.length, 1);
  assert.ok(u >= anim.transitions.standToProne.impact && u < anim.transitions.standToProne.impact + 0.06, `drop fired at progress ${u?.toFixed(3)}`);
  // Get up: compare chest and pelvis heights at the push-up key.
  const chest0 = r.h.j.chestC.y, pelvis0 = r.h.j.pelvis.y;
  r.tap('jump');
  let sampled = false;
  r.run(0.7, () => {
    const t = r.m.state.stanceT;
    if (!sampled && t && t.t / t.dur >= anim.transitions.proneToStand.keys[1][0]) {
      sampled = true;
      assert.ok(r.h.j.chestC.y - chest0 > r.h.j.pelvis.y - pelvis0 + 0.05, 'the chest leads the get-up');
    }
  });
  assert.ok(sampled && r.m.state.stance === 'stand');
});

test('dives in every direction: forward lands face down, back lands face up, side leans into the dive', () => {
  let r = rig(); r.cmd.moveY = 1; r.held.add('sprint'); r.run(1.2); r.held.delete('sprint'); r.tap('dodge'); r.cmd.moveY = 0; r.run(1.4);
  assert.equal(r.m.state.stance, 'prone');
  assert.ok(r.h.F.chest.n.y < -0.5, 'forward dive ends face down');
  r = rig(); r.cmd.moveY = -1; r.tap('dodge'); r.cmd.moveY = 0; r.run(1.4);
  assert.ok(r.m.state.supine && r.h.F.chest.n.y > 0.4, 'back dive ends on the back, facing up');
  assert.ok(Math.abs(r.h.prop.dir.z + 1) < 0.3, 'still aiming forward, between the feet');
  r = rig(); r.cmd.moveX = -1; r.tap('dodge'); r.run(0.1);
  assert.equal(r.m.state.dive?.kind, 'left');
  assert.ok(r.h.F.chest.d.x < -0.6, 'side dive: the spine leans toward the dive');
  assert.ok(Math.abs(r.m.state.bodyYaw) < 0.2, 'the body keeps facing the aim');
});

test('additive layers (recoil, hit flinch) never move the legs', () => {
  const a = rig(), b = rig({ id: 2 });
  for (const r of [a, b]) { r.cmd.moveY = 1; }
  let maxLeg = 0, maxHand = 0;
  for (let i = 0; i < 90; i++) {
    a.run(1 / 60); b.run(1 / 60);
    b.h.onEvent('weapon:recoil', { kick: 1 });
    if (i % 10 === 0) b.h.onEvent('hit', { dir: new Vector3(1, 0, 0), damage: 40 });
    for (let k = 0; k < 2; k++) maxLeg = Math.max(maxLeg, a.h.j.ankle[k].distanceTo(b.h.j.ankle[k]), a.h.j.knee[k].distanceTo(b.h.j.knee[k]));
    maxHand = Math.max(maxHand, a.h.j.hand[1].distanceTo(b.h.j.hand[1]));
  }
  assert.ok(maxLeg < 1e-9, `legs identical (max diff ${maxLeg})`);
  assert.ok(maxHand > 0.02, 'the upper body does react');
});

// ---------------------------------------------------------------- clip controller (synthetic skeleton and clips)
function synthModel() {
  const root = new Group();
  const hips = new Bone(); hips.name = 'mixamorigHips'; root.add(hips);
  const spine = new Bone(); spine.name = 'mixamorigSpine'; hips.add(spine);
  const head = new Bone(); head.name = 'mixamorigHead'; spine.add(head);
  const feet = ['Left', 'Right'].map((s) => { const b = new Bone(); b.name = `mixamorig${s}Foot`; root.add(b); return b; });
  return { root, spine, feet };
}

/** In-place locomotion clip whose feet move backward at exactly `speed` during stance. */
function locoClip(name, speed, duration) {
  const S = speed * duration, t = [0, duration * 0.5, duration];
  const z = (o) => (o === 0 ? [0, 0, -S / 4, 0, 0, S / 4, 0, 0, -S / 4] : [0, 0, S / 4, 0, 0, -S / 4, 0, 0, S / 4]);
  return new AnimationClip(name, duration, [
    new VectorKeyframeTrack('mixamorigLeftFoot.position', t, z(0)),
    new VectorKeyframeTrack('mixamorigRightFoot.position', t, z(1)),
    new QuaternionKeyframeTrack('mixamorigSpine.quaternion', [0, duration], [0, 0, 0, 1, 0, 0.1, 0, 0.995]),
  ]);
}
const pose = (name, qy = 0) => new AnimationClip(name, 1, [new QuaternionKeyframeTrack('mixamorigSpine.quaternion', [0, 1], [0, qy, 0, Math.sqrt(1 - qy * qy), 0, qy, 0, Math.sqrt(1 - qy * qy)])]);

function clipRig(speed) {
  const { root, feet } = synthModel();
  const clips = [pose('Rifle_Idle'), locoClip('Rifle_Walk', 1.9, 1.0), locoClip('Rifle_Jog', 4.5, 0.64), locoClip('Rifle_Sprint', 7.2, 0.58), pose('Dive_Forward', 0.3), pose('Rifle_Aim', 0.2)];
  const s = { mode: 'ground', stance: 'stand', stanceT: null, speed, velocity: new Vector3(0, 0, -speed), sprinting: false, weaponReady: true, gait: 'jog', bodyYaw: 0, position: new Vector3(), modeTime: 0 };
  const e = { id: 77, movement: { state: s, armor: 'medium', t: data.movement }, health: { dead: false }, mode: 'gun', weapons: { phase: 'ready', phaseTime: 0, phaseDuration: 0, ads: 0, weaponPitch: 0 } };
  const ctl = new ClipAnimationController(e, root, clips, anim);
  return { ctl, s, e, root, feet };
}

test('clip controller: speed blend is phase-synced, so blended clips never foot-slide', () => {
  for (const speed of [1.9, 3.0, 4.5, 6.0]) {
    const { ctl, s, root, feet } = clipRig(speed);
    const p = new Vector3(), prev = new Vector3();
    let drift = 0, stanceFrames = 0;
    for (let i = 0; i < 240; i++) {
      s.position.z -= speed / 60;
      ctl.update(1 / 60, s.position.clone(), { yaw: 0 });
      root.updateMatrixWorld(true);
      feet[0].getWorldPosition(p);
      const ph = ctl.phase - Math.floor(ctl.phase);
      if (i > 120 && ph > 0.03 && ph < 0.47) { if (stanceFrames++) drift = Math.max(drift, Math.abs(p.z - prev.z)); }
      prev.copy(p);
    }
    assert.ok(stanceFrames > 20);
    assert.ok(drift < 0.002, `${speed} m/s: planted foot moves ${(drift * 1000).toFixed(2)} mm/frame`);
    if (speed === 3.0) {
      const w = ctl.weights();
      assert.ok(Math.abs(w['loco:stand:1'] - (4.5 - 3) / (4.5 - 1.9)) < 0.02 && Math.abs(w['loco:stand:2'] - (3 - 1.9) / (4.5 - 1.9)) < 0.02, JSON.stringify(w));
    }
  }
});

test('clip controller: footsteps on heel-strike markers, crossfades without pops', () => {
  const { ctl, s } = clipRig(4.5);
  const steps = capture(['anim:footstep'], () => {
    for (let i = 0; i < 300; i++) { s.position.z -= 4.5 / 60; ctl.update(1 / 60, s.position.clone(), { yaw: 0 }); }
  }).filter((e) => e.id === 77);
  const expected = (4.5 * 5) / (4.5 * 0.64) * 2;
  assert.ok(Math.abs(steps.length - expected) <= 2, `${steps.length} footsteps, expected ~${expected.toFixed(1)}`);
  assert.ok(steps.some((e) => e.foot === 0) && steps.some((e) => e.foot === 1));
  // Into a dive and back: base weights always sum to one and never jump.
  const base = () => ctl.entries.filter((e) => !e.key.startsWith('upper:') && !e.key.startsWith('add:'));
  let maxSumErr = 0;
  const diveW = [];
  for (let i = 0; i < 60; i++) {
    if (i === 5) { s.mode = 'dive'; s.dive = { t: 0, kind: 'forward' }; }
    if (s.dive) s.dive.t += 1 / 60;
    if (i === 35) { s.mode = 'ground'; s.dive = null; }
    ctl.update(1 / 60, s.position.clone(), { yaw: 0 });
    let sum = 0;
    for (const e of base()) sum += e.w;
    maxSumErr = Math.max(maxSumErr, Math.abs(sum - 1));
    diveW.push(ctl.byKey.get('state:dive.forward').w);
  }
  assert.ok(maxSumErr < 1e-3, `base weights sum to 1 through every crossfade (max error ${maxSumErr})`);
  // The dive commits fast (data fade 0.05 s) but still spans frames: no single-frame snap.
  assert.ok(diveW[5] > 0.3 && diveW[5] < 0.75, `first dive frame weight ${diveW[5].toFixed(2)}`);
  assert.ok(diveW[8] > 0.95, 'dive owns the pose within 4 frames');
  assert.ok(diveW[36] < diveW[35] && diveW[36] > 0.4, 'and hands back to locomotion over several frames');
});

// ---------------------------------------------------------------- scale: LOD and instancing
test('128 fighters: LOD by distance, far fighters cost nothing, only near rigs emit events', () => {
  const sys = new AnimationSystem(anim);
  const ms = [];
  for (let i = 0; i < 128; i++) {
    const m = new MovementController(data.movement, new FlatGroundBody(new Vector3(i * 10, 0, 0)), {}, 100 + i);
    m.state.position.set(i * 10, 0, 0);
    const e = { id: 100 + i, movement: m, mode: 'gun', health: { dead: false }, weapons: { aimYaw: 0, aimPitch: 0, weaponPitch: 0, ads: 0, phase: 'ready', phaseTime: 0, phaseDuration: 0, current: { s: { archetype: 'smg' } } } };
    sys.add(e); ms.push(m);
  }
  sys.focusId = 227; // far away, but followed by the camera: always full detail
  const cam = new Vector3(0, 2, 0);
  const cmd = { moveX: 0, moveY: 1, yaw: 0, pitch: 0, buttons: {} };
  const ids = new Set();
  const off = bus.on('anim:footstep', (e) => ids.add(e.id));
  const t0 = performance.now();
  for (let f = 0; f < 120; f++) { sys.snapshot(); for (const m of ms) m.update(cmd, DT); sys.update(DT, 1, cam); }
  const ms128 = (performance.now() - t0) / 120;
  off();
  const L = anim.lod;
  const near = ms.filter((m) => m.state.position.distanceTo(cam) < L.near).length;
  assert.equal(sys.stats.near, near + 1, 'near rigs (+ the followed one)');
  assert.ok(sys.stats.far > 90, `${sys.stats.far} far impostors`);
  assert.ok(sys.stats.solved <= sys.stats.near + Math.ceil(sys.stats.mid / L.midInterval) + 1, 'mid rigs solve at a reduced rate');
  for (const id of ids) assert.ok(id === 227 || ms[id - 100].state.position.distanceTo(cam) < L.near + 8, `footstep from fighter ${id}`);
  assert.ok(ids.has(227), 'the followed fighter emits events even far away');
  assert.ok(ms128 < 25, `128 fighters: ${ms128.toFixed(2)} ms per frame for sim + animation`);
});

test('crowd renderer: the kit by LOD, one slot per fighter, finite right-handed bones, armor that sits on the rig', () => {
  const scene = new Scene();
  const crowd = new CrowdRenderer(scene, { max: 8 });
  const sys = new AnimationSystem(anim);
  const rs = [rig({ id: 1 }), rig({ id: 2, mode: 'sword' })];
  rs[1].e.melee = { phase: 'idle', phaseTime: 0, attackId: null, attack: null, heat: 30, guarding: false, w: { visual: { scale: 1 } } };
  rs[1].run(0.1);
  rs[0].cmd.moveY = 1; rs[0].held.add('sprint'); rs[0].run(1);
  const heavy = { body: 'heavy', helmet: 'crest', gear: 'bandolier', cape: true };
  crowd.begin(null);
  crowd.drawRig(rs[0].h, { team: 0, number: 7 }, 0);
  crowd.drawRig(rs[1].h, { team: 1, kit: heavy }, 1);
  crowd.drawImpostor(new Vector3(300, 0, 0), { yaw: 0.4, height: 1.8 }, { team: 1 });
  crowd.drawImpostor(new Vector3(310, 0, 0), { yaw: 1.2, height: 0.5, lying: true }, { team: 0 });
  const P = crowd.parts;
  // Read counts before end() resets them.
  const counts = {
    slots: crowd.slots, nearBody: P.body.medium[1].count, midBody: P.body.heavy[0].count, nearHelmet: P.helmet.medium[1].count,
    midHelmet: P.helmet.crest[0].count, gear: P.gear.standard[1].count + P.gear.bandolier[0].count, guns: Object.values(P.weapon).reduce((n, l) => n + l[0].count + l[1].count, 0),
    glow: crowd.glow.count, impostor: crowd.impostor.count,
  };
  crowd.end();
  assert.deepEqual(counts, { slots: 4, nearBody: 1, midBody: 1, nearHelmet: 1, midHelmet: 1, gear: 2, guns: 1, glow: 2, impostor: 2 });
  assert.equal(P.body.medium[1].mesh.geometry.instanceCount, 1, 'the near medium body draws once');
  assert.equal(P.body.light[1].mesh.visible, false, 'unused kit meshes are skipped');
  const D = crowd.bones.image.data, m = new Matrix4();
  const boneOf = (slot, b) => m.fromArray(D, (slot * 18 + b) * 16);
  for (let slot = 0; slot < 4; slot++) {
    for (let b = 0; b < (slot < 2 ? 18 : 1); b++) {
      if (slot === 1 && b === 14) continue;   // the sword arm holds no gun bone
      boneOf(slot, b);
      assert.ok(m.elements.every(Number.isFinite), `slot ${slot} bone ${b} finite`);
      assert.ok(m.determinant() > 0, `slot ${slot} bone ${b} right-handed (nothing drawn inside-out)`);
    }
  }
  // The near medium body, posed by slot 0's bones: every vertex within reach of the rig, the
  // boots at the ankles, the helmet round the head.
  const h = rs[0].h, geo = P.body.medium[1].mesh.geometry, pos = geo.attributes.position.array, mat = geo.attributes.aMat.array, p = new Vector3();
  let far = 0, foot = 0;
  for (let i = 0; i < pos.length / 3; i++) {
    p.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).applyMatrix4(boneOf(0, mat[i * 4 + 3]));
    if (p.distanceTo(h.j.pelvis) > 1.25) far++;
    const bone = mat[i * 4 + 3];
    if (bone === 12 || bone === 13) foot = Math.max(foot, p.distanceTo(h.j.ankle[bone - 12]));
  }
  assert.equal(far, 0, 'no armor flies off the body');
  assert.ok(foot < 0.3, `boots stay on the feet (${foot.toFixed(2)} m from the ankle at most)`);
  const hg = P.helmet.medium[1].mesh.geometry.attributes.position.array;
  let head = 0;
  for (let i = 0; i < hg.length / 3; i++) head = Math.max(head, p.set(hg[i * 3], hg[i * 3 + 1], hg[i * 3 + 2]).applyMatrix4(boneOf(0, 3)).distanceTo(h.j.head));
  assert.ok(head < 0.3, `the helmet sits on the head (${head.toFixed(2)} m)`);
  sys.dispose();
});

// ---------------------------------------------------------------- every move in the rig lab
import { buildFighter } from '../src/game/FighterFactory.js';
import { CombatWorld } from '../src/combat/CombatWorld.js';
import { MeleeSystem } from '../src/combat/melee/MeleeSystem.js';
import { routeCommand } from '../src/core/routing.js';
import { STATIONS, StationDriver, buddyDriver, floorOf } from '../src/tools/rigLabStations.js';
import { BodyContacts } from '../src/movement/BodyContacts.js';

const stationFactory = {
  movement: data.movement, weaponFiles: [data.ballistic, data.energy], attachments: data.attachments, recoil: data.recoil,
  statuses: data.statuses, meleeWeapons: data.melee, kits: data.kits, classes: data.classes,
};

/** Drives a rig-lab station like the game (60 Hz); onFrame(h, e, rec) after every rendered frame. */
function runStation(st, onFrame) {
  const cover = (st.boxes ?? []).map((b) => ({ min: new Vector3(...b.min), max: new Vector3(...b.max), surface: 'metal' }));
  const world = new CombatWorld({ damageMatrix: data.matrix, cover, supers: data.supers, meleeWeapons: data.melee, recoilDefs: data.recoil, vehicleDefs: data.vehicles, statusDefs: data.statuses });
  const e = buildFighter(world, stationFactory, { id: 1, team: 0, classId: st.classId ?? 'lancer', pos: new Vector3(...(st.start ?? [0, 0, 0])), cover });
  e.mode = st.mode ?? 'gun';
  e.health.damage = () => ({});
  const meleeSys = new MeleeSystem(); meleeSys.add(e.melee);
  const bodies = new BodyContacts(data.movement.bodies);   // (as in the game: solid to each other, feet on what's underfoot)
  const sys = new AnimationSystem(anim, { getEntity: (id) => world.entity(id), groundY: floorOf(cover), bodies });
  const h = sys.add(e); sys.focusId = 1;
  const drv = new StationDriver(st);
  const buddy = st.buddy ? buildFighter(world, stationFactory, { id: 2, team: 0, classId: st.buddy.classId ?? 'lancer', pos: new Vector3(...(st.buddy.start ?? [0, 0, 0])), cover }) : null;
  if (buddy) { buddy.mode = 'gun'; buddy.health.damage = () => ({}); sys.add(buddy); }
  const bdrv = buddyDriver(st);
  const rec = sys.record(1);
  while (!drv.done) {
    sys.snapshot();
    const cmd = drv.command(e, DT, buddy);
    if (buddy) { const bc = bdrv.command(buddy, DT, e); buddy.health.update(DT); buddy.movement.update(bc, DT); }
    e.status.update(DT); e.health.update(DT);
    e.movement.update(cmd, DT);
    e.movement.state.speedScale = e.status.speedMul;
    const r = routeCommand(e, cmd);
    e.abilities.update(cmd, DT); e.melee.update(r.meleeCmd, DT); e.weapons.update(r.gunCmd, DT);
    bodies.step(buddy ? [e, buddy] : [e], [], DT, (f, dx, dz) => f.movement.nudge(dx, dz));
    world.update(DT); meleeSys.resolve();
    sys.update(DT, 1, null);
    onFrame(h, e, rec);
  }
  sys.dispose();
}

test("the shoulder camera passes lamp posts and tree trunks; walls, and a building's narrow piers, still pull it in", async () => {
  const { CoverIndex } = await import('../src/world/CoverIndex.js');
  // Standing at the origin facing -Z: the camera sits behind (+Z) over the right shoulder (+X),
  // and its ray from the head crosses x 0.25 at z 1.05.
  const target = { id: 7, movement: { state: { mode: 'ground', stance: 'stand', speed: 0, bodyTurnRate: 0 } } };
  const dist = (box) => {
    const cover = new CoverIndex(box ? [box] : [], { cell: 8 });
    const cam = new CameraRig({ aspect: 16 / 9, raycast: (o, d, max) => cover.raycast(o, d, max, cameraSolid) });
    for (let i = 0; i < 60; i++) cam.update(1 / 60, { target, pos: new Vector3(0, 0, 0), yaw: 0, pitch: 0 });
    return cam.collisionDist;
  };
  const open = dist(null);
  assert.ok(open > 1.9, `nothing behind: the full ${open.toFixed(2)} m`);
  assert.ok(Math.abs(dist({ min: new Vector3(0.1, 0, 0.9), max: new Vector3(0.4, 6, 1.2), kind: 'pole' }) - open) < 1e-6, 'a lamp post: passed');
  assert.ok(Math.abs(dist({ min: new Vector3(0, 0, 0.8), max: new Vector3(0.55, 4, 1.35), kind: 'tree' }) - open) < 1e-6, 'a tree trunk: passed');
  assert.ok(dist({ min: new Vector3(-2, 0, 0.9), max: new Vector3(2, 3, 1.2), kind: 'wall' }) < 1, 'a wall pulls it in');
  assert.ok(dist({ min: new Vector3(0.1, 0, 0.9), max: new Vector3(0.4, 3, 1.2), kind: 'hwall', group: { house: 1 } }) < 1, "a house's pier between two windows is still the wall");
});

test('first person [V]: the camera sits at the eyes and on the sight line when aiming; your head is hidden; ragdolls go third person', () => {
  const r = rig();
  const cam = new CameraRig({ aspect: 16 / 9 });
  const eye = new Vector3(), sight = new Vector3();
  const frame = (o = {}) => {
    r.run(1 / 60);
    const s = r.m.state, rec = r.sys.record(1);
    cam.update(1 / 60, { target: r.e, pos: rec.root, yaw: s.yaw, pitch: 0, ads: r.e.weapons.ads, eye: eyeOf(r.h, eye), sight: sightOf(r.h, sight), ...o });
  };
  for (let i = 0; i < 30; i++) frame();
  assert.ok(!cam.firstPerson && cam.camera.position.distanceTo(eye) > 1.5, 'third person: behind the shoulder');
  cam.togglePOV();
  for (let i = 0; i < 40; i++) frame();
  assert.ok(cam.firstPerson, 'first person after the toggle');
  assert.ok(cam.camera.position.distanceTo(eye) < 0.03, `at the eyes (${cam.camera.position.distanceTo(eye).toFixed(3)} m off)`);
  // Walking: still at the eyes (the springs keep up with the body).
  r.cmd.moveY = 1;
  let worst = 0;
  for (let i = 0; i < 60; i++) { frame(); if (i > 20) worst = Math.max(worst, cam.camera.position.distanceTo(eye)); }
  assert.ok(worst < 0.12, `follows the eyes while moving (${worst.toFixed(3)} m)`);
  r.cmd.moveY = 0;
  // Aiming down sights: the eye goes onto the sight line, just behind the optic.
  r.e.weapons.ads = 1;
  for (let i = 0; i < 40; i++) frame();
  assert.ok(cam.camera.position.distanceTo(sight) < 0.03, `on the sight line (${cam.camera.position.distanceTo(sight).toFixed(3)} m off)`);
  r.e.weapons.ads = 0;
  // A ragdoll is seen from outside.
  for (let i = 0; i < 40; i++) frame({ thirdPerson: true });
  assert.ok(!cam.firstPerson && cam.camera.position.distanceTo(eye) > 1, 'third person while thrown');
  // Your own head collapses (nothing skinned to it can block the view); others' don't.
  const crowd = new CrowdRenderer(new Scene(), { max: 4 });
  crowd.begin(null);
  crowd.drawRig(r.h, { team: 0 }, 0, { head: true, cape: true });
  crowd.drawRig(r.h, { team: 0 }, 0);
  const helmets = crowd.parts.helmet.medium[1].count, capes = crowd.parts.cape[1].count;
  crowd.end();
  const D = crowd.bones.image.data, m = new Matrix4();
  const headScale = (slot) => m.fromArray(D, (slot * 18 + 3) * 16).getMaxScaleOnAxis();
  assert.ok(headScale(0) < 1e-3 && headScale(1) > 0.5, 'the head bone collapses only for the hidden one');
  assert.equal(helmets, 1, 'one helmet drawn (not yours)');
  assert.equal(capes, 1, 'one cape drawn (not yours)');
});

test('every rig-lab move: finite pose, planted feet always reached, no body pops in crossfades', () => {
  const finite = (p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
  for (const st of STATIONS) {
    let worstReach = 0, worstPop = 0, wasLimp = false;
    const lastPelvis = new Vector3(), lastRoot = new Vector3();
    let frames = 0;
    runStation(st, (h, e, rec) => {
      // (A ragdoll's frames are its physics' own: its root, the lowest point of the body, lands
      // before its pelvis does. Going limp and getting up again are still checked.)
      const limp = e.movement.state.mode === 'ragdoll', skip = limp && wasLimp;
      wasLimp = limp;
      const j = h.j;
      for (const p of [j.pelvis, j.neck, j.head, ...j.hip, ...j.knee, ...j.ankle, ...j.shoulder, ...j.elbow, ...j.hand, h.prop.base]) assert.ok(finite(p), `${st.id}: finite joints`);
      assert.ok(Math.abs(h.prop.dir.length() - 1) < 1e-3, `${st.id}: unit weapon direction`);
      if (h.planterLive && h.w.loco > 0.999) for (let i = 0; i < 2; i++) if (h.planter.feet[i].planted) worstReach = Math.max(worstReach, j.ankle[i].distanceTo(h.pose.foot[i]));
      // The body never teleports relative to the root: pose changes are crossfades, not cuts.
      if (frames++ > 0 && !skip) worstPop = Math.max(worstPop, new Vector3().subVectors(j.pelvis, lastPelvis).sub(new Vector3().subVectors(rec.root, lastRoot)).length());
      lastPelvis.copy(j.pelvis); lastRoot.copy(rec.root);
    });
    assert.ok(worstReach < 0.002, `${st.id}: planted foot missed by ${(worstReach * 1000).toFixed(1)} mm`);
    assert.ok(worstPop < 0.13, `${st.id}: pelvis jumped ${worstPop.toFixed(3)} m in one frame relative to the body`);
  }
});

/**
 * Smoothness: the second difference of a channel (how much its per-frame motion changes in one
 * frame) is what a pop is. A fast move is fine; a sudden change of speed is not. Ragdoll frames
 * are the physics' own and are skipped.
 */
function smoothness() {
  const hist = [], worst = {};
  const d2 = (a, b, c) => (typeof c === 'number' ? Math.abs(c - 2 * b + a) : new Vector3().copy(c).addScaledVector(b, -2).add(a).length());
  return {
    worst,
    add(limp, ch) {
      hist.push({ limp, ch });
      if (hist.length > 3) hist.shift();
      if (hist.length < 3 || hist.some((x) => x.limp)) return;
      const [a, b, c] = hist.map((x) => x.ch);
      // (Yaws and pitches are angles: a forward roll's pitch goes right round.)
      for (const k of Object.keys(c)) worst[k] = Math.max(worst[k] ?? 0, k.startsWith('yaw') || k.startsWith('pitch') ? Math.abs(angleDelta(b[k], c[k]) - angleDelta(a[k], b[k])) : d2(a[k], b[k], c[k]));
    },
  };
}
const bodyChannels = (h, rec) => {
  const P = h.pose, j = h.j, root = rec.root;
  return {
    yawHips: angleDelta(h.yaw, P.yawP), pitchChest: P.pitchC, leanChest: P.leanC, pitchHips: P.pitchP,
    pelvis: j.pelvis.clone().sub(root), hand0: j.hand[0].clone().sub(root), hand1: j.hand[1].clone().sub(root),
    knee0: j.knee[0].clone().sub(root), knee1: j.knee[1].clone().sub(root), foot0: j.ankle[0].clone(), foot1: j.ankle[1].clone(),
  };
};

test('every rig-lab move blends without pops: hips, chest, pelvis, hands, knees and feet change speed smoothly', () => {
  // Limits are per 60 Hz frame. The fast commits (dive, slide, vault) pass well inside them.
  const LIM = { yawHips: 0.1, pitchChest: 0.22, leanChest: 0.22, pitchHips: 0.22, pelvis: 0.07, hand0: 0.26, hand1: 0.26, knee0: 0.3, knee1: 0.3, foot0: 0.3, foot1: 0.3 };
  for (const st of STATIONS) {
    const sm = smoothness();
    runStation(st, (h, e, rec) => {
      const s = e.movement.state;
      sm.add(s.mode === 'ragdoll' || h.limp || h.unlimpT < anim.blend.ragdollOut || h.active === 'dead', bodyChannels(h, rec));
    });
    // The flame sword's strikes are meant to whip (the blade's speed is the point); its hands are left out.
    for (const [k, lim] of Object.entries(LIM)) if (!(st.mode === 'sword' && k.startsWith('hand'))) assert.ok((sm.worst[k] ?? 0) < lim, `${st.id}: ${k} changed speed by ${(sm.worst[k] ?? 0).toFixed(3)} in one frame (limit ${lim})`);
  }
});

test('strafing: the hips swivel between facing a strafe and backpedalling it, never flip; the lean follows on a spring', () => {
  const r = rig();
  const sm = smoothness();
  let worstYawStep = 0, lastYaw = null;
  const frame = (rr) => {
    const ch = bodyChannels(rr.h, rr.sys.record(1));
    sm.add(false, ch);
    if (lastYaw !== null) worstYawStep = Math.max(worstYawStep, Math.abs(angleDelta(lastYaw, ch.yawHips)));
    lastYaw = ch.yawHips;
  };
  // Every 8-way direction, both ways round (through the sideways strafes, where the hips change sides),
  // then quick reversals, a crouch-walk sweep and a stop.
  const dirs = [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1]];
  for (const [x, y] of dirs) { r.cmd.moveX = x; r.cmd.moveY = y; r.run(0.45, frame); }
  for (const [x, y] of [[1, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) { r.cmd.moveX = x; r.cmd.moveY = y; r.run(0.25, frame); }
  r.held.add('crouch'); r.run(2 / 60, frame); r.held.delete('crouch'); r.run(0.3, frame);
  for (const [x, y] of [[1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [0, 1]]) { r.cmd.moveX = x; r.cmd.moveY = y; r.run(0.4, frame); }
  r.cmd.moveX = 0; r.cmd.moveY = 0; r.run(0.6, frame);
  assert.ok(worstYawStep < 0.12, `hips turned ${worstYawStep.toFixed(3)} rad in one frame`);
  assert.ok(sm.worst.yawHips < 0.08, `hip swivel changed speed by ${sm.worst.yawHips.toFixed(3)} in one frame`);
  assert.ok(sm.worst.leanChest < 0.05 && sm.worst.pitchChest < 0.05, `the lean snapped (${sm.worst.leanChest.toFixed(3)}, ${sm.worst.pitchChest.toFixed(3)})`);
  for (const k of ['foot0', 'foot1', 'knee0', 'knee1']) assert.ok(sm.worst[k] < 0.3, `${k} changed speed by ${sm.worst[k].toFixed(3)} in one frame`);
});
