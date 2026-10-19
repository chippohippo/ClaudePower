// The Last of Us Part II feel pass (docs/FEEL_TLOU2.md): blows reel a man (doubled over, stumbling,
// helpless) instead of throwing him; the striker's whole body goes into the blow (a step in, the
// hips ahead of the shoulders, the trunk sinking into it) and the blade the sim sweeps is the one
// drawn; hit-stop by the weight of the blow; a heavy's armor covers its swing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { bus } from '../src/core/EventBus.js';
import { AnimationSystem } from '../src/anim/AnimationSystem.js';
import { ProceduralHumanoid } from '../src/anim/ProceduralHumanoid.js';
import { hitSpheres } from '../src/movement/Hitboxes.js';
import { meleeWeapon } from '../src/combat/melee/MeleeWeapons.js';
import { bladeAt, keysFor } from '../src/combat/melee/MeleeSystem.js';
import { makeWorld, v, data, DT } from './harness.mjs';

const M = data.movement.stagger.melee;
const P = (e) => e.movement.state.position;
const dawn = meleeWeapon(data.melee, 'solari_dawnblade');

/** A swordsman facing north and a man `d` m in front of him, with both rigs drawn every tick. */
function duel(d = 1.6, { hp = 5000 } = {}) {
  const w = makeWorld();
  const A = w.fighter(1, 0, v(0, 0, 0), 'dawnblade', { hp: 5000 });
  const B = w.fighter(2, 1, v(0, 0, -d), 'lancer', { hp });
  A.melee.setMoveset(dawn);
  A.mode = 'sword'; B.mode = 'gun';
  for (const g of A.weapons.loadout) { g.mag = 0; g.reserve = 0; }
  w.aim(A, 0, 0); w.aim(B, Math.PI, 0);
  const sys = new AnimationSystem(data.humanoid, { getEntity: (id) => w.world.entity(id) });
  sys.add(A); sys.add(B); sys.focusId = 1;
  const tick = (n = 1) => { for (let i = 0; i < n; i++) { sys.snapshot(); w.step(1); sys.update(DT, 1, null); } };
  tick(30);
  return { w, A, B, sys, tick, rigA: sys.get(1), rigB: sys.get(2) };
}

test('a blow reels a man: doubled over and stumbling, longer for a heavier one; no ragdoll short of a knockdown', () => {
  const reelOf = (attack) => {
    const { B } = duel();
    B.health.damage(attack.damage, attack, { id: 99, movement: { state: { position: v(0, 0, 0) } } });
    return B.movement.state;
  };
  const light = reelOf(dawn.attacks.light1), heavy = reelOf(dawn.attacks.heavy1), riposte = reelOf(dawn.attacks.counter);
  assert.equal(light.mode, 'stagger'); assert.equal(light.stagger.kind, 'reel');
  assert.ok(Math.abs(light.stagger.dur - 0.52) < 0.03, `a light slash: ${light.stagger.dur.toFixed(2)} s`);
  assert.ok(light.stagger.fold >= M.fold[0], 'folded over');
  assert.equal(heavy.mode, 'stagger', 'a heavy blow: on his feet, reeling (not thrown)');
  assert.ok(heavy.stagger.dur > 0.75 && heavy.stagger.dur < 0.9, `${heavy.stagger.dur.toFixed(2)} s (the clip: ~0.9 s)`);
  assert.ok(heavy.stagger.fold > light.stagger.fold, 'and folded further');
  assert.equal(riposte.mode, 'ragdoll', 'a riposte puts him down');
});

test('the reel as drawn: the trunk doubles over and the knees give, the hit spheres going with it', () => {
  const { B, rigB, tick } = duel(3);
  const hs = () => hitSpheres(B);
  tick(10);
  const stand = rigB.j.head.y - P(B).y;
  B.movement.stagger(0, -1, 2.6, { dur: 1.0, kind: 'reel', fold: 0.95 });   // (a heavy blow from behind him)
  let deepest = 0, worstHead = 0, worstChest = 0, heldHead = 0;
  for (let i = 0; i < 60 && B.movement.state.mode === 'stagger'; i++) {
    tick();
    const g = B.movement.state.stagger; if (!g) break;
    const u = g.t / g.dur, s = hs();
    const dh = rigB.j.head.distanceTo(new Vector3(s[0].x, s[0].y, s[0].z)), dc = rigB.j.chestC.distanceTo(new Vector3(s[1].x, s[1].y, s[1].z));
    worstHead = Math.max(worstHead, dh); worstChest = Math.max(worstChest, dc);
    if (u > 0.4 && u < 0.75) heldHead = Math.max(heldHead, dh);
    deepest = Math.max(deepest, stand - (rigB.j.head.y - P(B).y));
  }
  assert.ok(deepest > 0.3, `the head comes down ${deepest.toFixed(2)} m`);
  assert.ok(heldHead < 0.13, `folded, the head sphere is on the drawn head (${heldHead.toFixed(2)} m)`);
  assert.ok(worstHead < 0.18 && worstChest < 0.15, `and never far off it (head ${worstHead.toFixed(2)}, chest ${worstChest.toFixed(2)} m)`);
  tick(30);
  assert.ok(Math.abs((rigB.j.head.y - P(B).y) - stand) < 0.05, 'back up after');
});

test('the whole body goes into a strike: a step in, the hips ahead of the shoulders, the trunk sinking into the blow', () => {
  const { w, A, rigA, tick } = duel(4);
  const z0 = P(A).z, pelvis0 = rigA.j.pelvis.y - P(A).y;
  w.press(A, 'light');
  let hipAt = null, chestAt = null, drop = 0, t = 0;
  const yaw0 = rigA.F.chest.n.clone();
  for (let i = 0; i < 40; i++) {
    tick(); t += DT;
    const m = A.melee;
    if (m.phase === 'active' || (m.phase === 'recovery' && m.phaseTime < 0.1)) {
      const hip = rigA.hipL?.x ?? 0, F = dawn.attacks.light1;   // (the twist the hips are given, after the rig's smoothing)
      if (hipAt === null && hip >= 0.8 * data.humanoid.sword.attacks.light1.follow.body.hip) hipAt = t;
      if (chestAt === null && rigA.swordLocal.tw >= 0.8 * data.humanoid.sword.attacks.light1.follow.tw) chestAt = t;
      drop = Math.max(drop, pelvis0 - (rigA.j.pelvis.y - P(A).y));
      assert.ok(F);
    }
  }
  assert.ok(hipAt !== null && chestAt !== null && hipAt < chestAt, `the hips get there first (${hipAt?.toFixed(3)} s against the chest's ${chestAt?.toFixed(3)} s)`);
  assert.ok(drop > 0.06, `sinking into it: the hips ${(drop * 100).toFixed(0)} cm down`);
  const stepped = z0 - P(A).z;
  assert.ok(stepped > 0.15 && stepped < 0.35, `a step in: ${stepped.toFixed(2)} m`);
  assert.ok(yaw0);
});

test('the blade the sim sweeps is the one drawn, body and all', () => {
  const { w, A, rigA, tick } = duel(4);
  w.press(A, 'light');
  const base = new Vector3(), tip = new Vector3();
  let worst = 0, n = 0;
  for (let i = 0; i < 40; i++) {
    tick();
    const m = A.melee;
    if (m.phase !== 'active') continue;
    const pr = rigA.prop, len = pr.length;
    bladeAt(m, keysFor(data.humanoid.sword, m.attackId), m.attack, m.phaseTime, len, 1, base, tip);
    const drawnTip = pr.base.clone().addScaledVector(pr.dir, len);
    worst = Math.max(worst, drawnTip.distanceTo(tip)); n++;
  }
  assert.ok(n >= 3, `sampled ${n} active frames`);
  assert.ok(worst < 0.15, `the swept tip within ${worst.toFixed(2)} m of the drawn tip`);
});

test('hit-stop by the weight of the blow, more on a staggered man; a heavy\'s armor covers its swing', () => {
  const stops = {};
  for (const id of ['light1', 'heavy1']) {
    const { w, A, B, tick } = duel(1.6);
    const got = []; const off = bus.on('melee:hit', (e) => e.attacker === A.id && got.push(e));
    if (id === 'heavy1') { w.hold(A, 'heavy'); tick(6); w.release(A, 'heavy'); } else w.press(A, 'light');
    tick(60); off();
    assert.ok(got.length >= 1, `${id} landed`);
    stops[id] = Math.round(got[0].hitStop * 60);
    assert.ok(B);
  }
  assert.equal(stops.light1, dawn.attacks.light1.hitStop, 'light: 3 ticks');
  assert.equal(stops.heavy1, dawn.attacks.heavy1.hitStop, 'heavy: 6 ticks');
  // Hyper armor through the active frames: struck mid-swing by a light blow, the heavy carries on.
  const { w, A, B, tick } = duel(1.6);
  B.melee.setMoveset(dawn);
  w.hold(A, 'heavy'); tick(6); w.release(A, 'heavy');
  for (let i = 0; i < 60 && A.melee.phase !== 'active'; i++) tick();
  assert.equal(A.melee.phase, 'active', 'mid-swing');
  A.melee.receiveHit(B.melee, dawn.attacks.light1, new Vector3(0, 0, 1));
  assert.equal(A.melee.attackId, 'heavy1', 'still swinging');
  assert.notEqual(A.melee.phase, 'stagger', 'not flinched out of it');
});

// ---------------------------------------------------------------- guns

test('a shot kicks the gun in the hands: up within a frame or two, back on target in ~0.2 s', () => {
  const w = makeWorld();
  const G = w.fighter(1, 0, v(0, 0, 0), 'lancer', { hp: 5000 });
  G.mode = 'gun'; w.aim(G, 0, 0);
  const sys = new AnimationSystem(data.humanoid, { getEntity: (id) => w.world.entity(id) });
  sys.add(G); sys.focusId = 1;
  const rig = sys.get(1);
  const tick = () => { sys.snapshot(); w.step(1); sys.update(DT, 1, null); };
  for (let i = 0; i < 40; i++) tick();
  const pitch = () => Math.asin(Math.max(-1, Math.min(1, rig.prop.dir.y)));
  const rest = pitch();
  // A rifle shot aimed (the AR's visualKick 0.6, ADS x0.65): the kick the gun system sends.
  rig.onEvent('weapon:recoil', { kick: data.recoil.ar_standard.visualKick * 0.65 });
  let peak = 0, peakAt = 0, t = 0, at200 = 0;
  for (let i = 0; i < 20; i++) {
    tick(); t += DT;
    const d = pitch() - rest;
    if (d > peak) { peak = d; peakAt = t; }
    if (Math.abs(t - 0.2) < DT / 2) at200 = d;
  }
  const deg = (x) => (x * 180 / Math.PI).toFixed(1);
  assert.ok(peak > 2.5 * Math.PI / 180, `the muzzle flips ${deg(peak)}° (was 0.3°)`);
  assert.ok(peakAt <= 0.06, `at once (${(peakAt * 1000).toFixed(0)} ms)`);
  assert.ok(Math.abs(at200) < peak * 0.15, `and it's back by 0.2 s (${deg(at200)}° left)`);
});

test('aiming: the camera pushes in with the arms, not after them', async () => {
  const { CameraRig } = await import('../src/camera/CameraRig.js');
  const target = { id: 7, movement: { state: { mode: 'ground', stance: 'stand', speed: 0, bodyTurnRate: 0 } } };
  const cam = new CameraRig({ aspect: 16 / 9 });
  const run = (ads, n) => { for (let i = 0; i < n; i++) cam.update(DT, { target, pos: new Vector3(0, 0, 0), yaw: 0, pitch: 0, ads: ads(i), adsFov: 54 }); };
  run(() => 0, 60);
  const far = cam.camera.position.length(), fov0 = cam.camera.fov;
  // The gun's ADS blend: linear over 0.24 s (the AR's ads.time), then held.
  let t = 0;
  run((i) => Math.min(1, (t = (i + 1) * DT) / 0.24), Math.round(0.3 / DT));
  const near = cam.camera.position.length();
  run(() => 1, 120);
  const full = cam.camera.position.length();
  assert.ok(Math.abs(near - full) < 0.05 * (far - full), `in by 0.3 s (${near.toFixed(2)} m against ${full.toFixed(2)})`);
  assert.ok(Math.abs(cam.camera.fov - 54) < 0.5, `the FOV too (${cam.camera.fov.toFixed(1)}°)`);
  assert.ok(fov0 > 60);
});

test('aim sway: a scope wanders; hold your breath and it stills, let go and it comes back harder', () => {
  const w = makeWorld();
  const S = w.fighter(1, 0, v(0, 0, 0), 'seraph', { hp: 5000, gun: 'sol_sr_longwatch' });   // (a scoped rifle)
  S.mode = 'gun'; w.aim(S, 0, 0);
  const W = S.weapons;
  const swayOver = (secs) => { let lo = Infinity, hi = -Infinity; for (let i = 0; i < Math.round(secs / DT); i++) { w.step(1); lo = Math.min(lo, W.swayYaw); hi = Math.max(hi, W.swayYaw); } return hi - lo; };
  assert.ok(W.current.s.ads?.sway > 0, `${W.current.s.id}: a scoped rifle`);
  w.hold(S, 'guard'); w.seconds(0.8);
  const free = swayOver(4);
  assert.ok(free > 0.008, `aimed, it wanders ${(free * 1000).toFixed(1)} mrad`);
  w.hold(S, 'sprint');
  w.seconds(0.4);
  const held = swayOver(1.5);
  assert.ok(held < free * 0.3, `breath held: ${(held * 1000).toFixed(1)} mrad`);
  w.release(S, 'sprint');
  const after = swayOver(1);
  assert.ok(after > free * 0.6, `let go: back (${(after * 1000).toFixed(1)} mrad)`);
  assert.equal(S.movement.state.sprinting, false, 'and never sprinting');
});

// ---------------------------------------------------------------- the dodge, hits

test('the dodge: near a man swinging at you it\'s a quarter-second duck out of the way, leaning 40-50 deg; elsewhere a gunner still dives', () => {
  const E = data.movement.evade.sidestep;
  for (const [mx, label] of [[0, 'back'], [-1, 'left']]) {
    const { w, A, B, rigB, tick } = duel(1.8);
    // He winds up at B: B's dodge (a gunner's: the dive) is a sidestep now, out of the blow's way.
    w.press(A, 'light');
    tick(2);
    assert.equal(A.melee.phase, 'windup');
    if (mx) w.move(B, mx, 0);
    w.press(B, 'dodge');
    tick(1);
    const s = B.movement.state;
    assert.equal(s.mode, 'dodge', 'a ground evade, not a dive');
    assert.equal(s.dodgeStyle, 'sidestep');
    let peak = 0, peakAt = 0, worstHead = 0, worstChest = 0, slid = 0, knee = 0, gunUp = 0;
    const was = [rigB.j.ankle[0].clone(), rigB.j.ankle[1].clone()];
    while (B.movement.state.mode === 'dodge') {
      tick();
      const t = s.modeTime, h = rigB.j.head, p = rigB.j.pelvis, hs = hitSpheres(B);
      const lean = Math.atan2(Math.hypot(h.x - p.x, h.z - p.z), h.y - p.y) * 180 / Math.PI;
      if (lean > peak) { peak = lean; peakAt = t; }
      worstHead = Math.max(worstHead, h.distanceTo(new Vector3(hs[0].x, hs[0].y, hs[0].z)));
      worstChest = Math.max(worstChest, rigB.j.chestC.distanceTo(new Vector3(hs[1].x, hs[1].y, hs[1].z)));
      for (let f = 0; f < 2; f++) knee = Math.max(knee, 180 - rigB.j.hip[f].clone().sub(rigB.j.knee[f]).angleTo(rigB.j.ankle[f].clone().sub(rigB.j.knee[f])) * 180 / Math.PI);
      gunUp = Math.max(gunUp, Math.asin(rigB.prop.dir.y) * 180 / Math.PI);
      // A foot down on the ground stays where it is (it moves only while it swings).
      for (let f = 0; f < 2; f++) {
        const a = rigB.j.ankle[f], down = a.y - P(B).y < 0.085 && was[f].y - P(B).y < 0.085;
        if (down) slid = Math.max(slid, Math.hypot(a.x - was[f].x, a.z - was[f].z));
        was[f].copy(a);
      }
    }
    assert.ok(peak > 40 && peak < 50, `${label}: the trunk leans ${peak.toFixed(0)} deg out of the way (the clip: 40-50)`);
    assert.ok(peakAt > 0.08 && peakAt < 0.17, `${label}: all the way out by ${peakAt.toFixed(2)} s (the clip: 0.13)`);
    assert.ok(worstHead < 0.12 && worstChest < 0.12, `${label}: the spheres lean with him (head ${worstHead.toFixed(2)}, chest ${worstChest.toFixed(2)} m)`);
    assert.ok(slid < 0.015, `${label}: no foot slides (${slid.toFixed(3)} m in a frame)`);
    // A duck, not a squat (standing, the knees are already bent 45 deg); the gun stays near the aim.
    assert.ok(knee > 55 && knee < 90, `${label}: the knees dip to ${knee.toFixed(0)} deg`);
    assert.ok(gunUp < 20, `${label}: the muzzle rises ${gunUp.toFixed(0)} deg at most`);
    const h = rigB.j.head, p = rigB.j.pelvis;
    assert.ok(Math.atan2(Math.hypot(h.x - p.x, h.z - p.z), h.y - p.y) * 180 / Math.PI < 12, `${label}: back up by the end (${E.duration} s)`);
  }
  // Nobody swinging: the dodge is the dive again.
  const W = makeWorld();
  const G = W.fighter(5, 0, v(0, 0, 0), 'lancer', { hp: 5000 });
  W.aim(G, 0, 0); W.step(10);
  W.press(G, 'dodge'); W.step(1);
  assert.equal(G.movement.state.mode, 'dive');
});

test('a blast nearby flinches the body away from it, like a hit', () => {
  const { B, rigB, tick } = duel(4);
  tick(5);
  const p = B.movement.state.position;
  bus.emit('projectile:explode', { point: { x: p.x + 2, y: p.y, z: p.z }, radius: 3 });
  let moved = 0;
  for (let i = 0; i < 6; i++) { tick(); moved = Math.max(moved, Math.abs(rigB.flX.x) + Math.abs(rigB.flZ.x)); }
  assert.ok(moved > 0.05, `flinched (${moved.toFixed(2)})`);
});

// ---------------------------------------------------------------- the body

test('a high or low aim bends the upper back: the shoulders and head go with the gun', () => {
  const B = data.humanoid.body;
  const chestAt = (pitch) => {
    const w = makeWorld();
    const G = w.fighter(2, 1, v(0, 0, 0), 'lancer', { hp: 5000 });
    G.mode = 'gun'; w.aim(G, Math.PI, pitch);
    const sys = new AnimationSystem(data.humanoid, { getEntity: (id) => w.world.entity(id) });
    sys.add(G); sys.focusId = 2;
    for (let i = 0; i < 60; i++) { sys.snapshot(); w.step(1); sys.update(DT, 1, null); }
    const r = sys.get(2), d = r.F.chest.d, h = r.F.head.d;   // (he faces +z: forward is +z)
    return { chest: Math.atan2(d.z, d.y), head: Math.atan2(h.z, h.y) };
  };
  const level = chestAt(0), low = chestAt(-0.6), high = chestAt(0.6);
  assert.ok(Math.abs(low.chest - level.chest - 0.6 * B.aimBend) < 0.03, `aiming 0.6 rad down, the chest bends ${(low.chest - level.chest).toFixed(2)} rad forward`);
  assert.ok(Math.abs(level.chest - high.chest - 0.6 * B.aimBend) < 0.03, `aiming 0.6 rad up, ${(level.chest - high.chest).toFixed(2)} rad back`);
  assert.ok(Math.abs(low.head - 0.51) < 0.03 && Math.abs(high.head + 0.51) < 0.03, 'and the head stays on the look');
});

test('aiming up or down, the hit spheres go with the head and the bent back', () => {
  for (const [cls, mode, crouch] of [['lancer', 'gun', false], ['lancer', 'gun', true], ['dawnblade', 'sword', false]]) {
    let head = 0, chest = 0;
    for (const pitch of [-0.8, -0.4, 0.4, 0.8]) {
      const w = makeWorld();
      const G = w.fighter(2, 1, v(0, 0, 0), cls, { hp: 5000 });
      G.mode = mode; w.aim(G, Math.PI + 0.4, pitch);
      if (crouch) w.press(G, 'crouch');
      const sys = new AnimationSystem(data.humanoid, { getEntity: (id) => w.world.entity(id) });
      sys.add(G); sys.focusId = 2;
      for (let i = 0; i < 90; i++) { sys.snapshot(); w.step(1); sys.update(DT, 1, null); }
      const r = sys.get(2), hs = hitSpheres(G);
      head = Math.max(head, r.j.head.distanceTo(new Vector3(hs[0].x, hs[0].y, hs[0].z)));
      chest = Math.max(chest, r.j.chestC.distanceTo(new Vector3(hs[1].x, hs[1].y, hs[1].z)));
    }
    const label = `${mode}${crouch ? ', crouched' : ''}`;
    assert.ok(head < 0.06 && chest < 0.06, `${label}: head sphere within ${(head * 100).toFixed(0)} cm, chest ${(chest * 100).toFixed(0)} cm of the drawn body`);
  }
});

test('the cape swings the same at 144 Hz as at 60', () => {
  const tipPath = (hz) => {
    const { fighter } = makeWorld();
    const f = fighter(1, 0, v(0, 0, 0), 'lancer');
    Object.assign(f.movement.state, { stance: 'stand', bodyYaw: 0, yaw: 0, mode: 'ground' });
    f.mode = 'gun';
    const h = new ProceduralHumanoid(f, data.humanoid, {}), out = new Map();
    for (let i = 0; i < hz * 4; i++) {
      // Settle, then turn at the body's turn rate and stop.
      const t = i / hz, yaw = Math.min(1.2, Math.max(0, (t - 2.5) * 12));
      f.movement.state.bodyYaw = f.movement.state.yaw = yaw;
      h.update(1 / hz, f.movement.state.position, { yaw, aimYaw: yaw, aimPitch: 0, lod: 0, emit: false });
      const k = Math.round(t * 20);
      if (t >= 2.4 && Math.abs(t * 20 - k) < 10 / hz) { const p = h.cape[h.cape.length - 1]; out.set(k, [p.x - h.j.neck.x, p.z - h.j.neck.z]); }
    }
    return out;
  };
  const a = tipPath(60), b = tipPath(144);
  let worst = 0;
  for (const [k, p] of a) if (b.has(k)) worst = Math.max(worst, Math.hypot(b.get(k)[0] - p[0], b.get(k)[1] - p[1]));
  assert.ok(a.size > 20 && worst < 0.1, `the tip's path through a turn: ${(worst * 100).toFixed(0)} cm apart`);
});
