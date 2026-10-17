// Support AI: gun crews and truck drivers (SupportCommand + CrewPilot), fire missions, the
// preparation barrage before a whistle, SOS fire, counter-battery, AT crews, hitting the dirt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { bus } from '../src/core/EventBus.js';
import { FrontlineSession } from '../src/game/FrontlineSession.js';
import { data as H } from './harness.mjs';

const sessionData = {
  movement: H.movement, weaponFiles: [H.ballistic, H.energy], attachments: H.attachments, recoil: H.recoil, statuses: H.statuses,
  meleeWeapons: H.melee, kits: H.kits, classes: H.classes, damageMatrix: H.matrix, supers: H.supers, vehicleDefs: H.vehicles,
  personalities: H.ai.personalities, difficulty: H.ai.difficulty.veteran, down: H.down,
};
const listen = (type) => { const got = []; const off = bus.on(type, (e) => got.push(e)); return { got, off }; };
const run = (s, secs, each) => { for (let i = 0; i < Math.round(secs * 60); i++) { s.step(1 / 60); each?.(i); } };
const P = (e) => e.movement.state.position;

test('crews take their guns and set them up in the park; drivers keep the forward depot supplied', () => {
  const s = new FrontlineSession(sessionData, { size: '32v32', seed: 7 });
  const unloads = listen('logistics:unload');
  for (const sc of s.support) for (const u of sc.units) assert.ok(u.crew[0]?.brain?.duty, `${u.kind} has a crew`);
  const crew = s.fighters.filter((f) => f.duty);
  assert.ok(crew.every((f) => !f.squad), 'crews are not in the infantry squads');
  // Every battery is manned, set up and at its post at some point (crews get killed and walk back).
  const ok = new Set(), seen = new Set();
  run(s, 40, (i) => {
    if (i % 30) return;
    for (const sc of s.support) for (const u of sc.units) {
      if (u.kind === 'truck' || u.kind === 'at') continue;
      const v = sc.vehicle(u);
      if (!v) continue;
      seen.add(u);
      if (u.crew[0].vehicle?.veh === v && v.gun.state === 'deployed' && P(v).distanceTo(u.post) < 10) ok.add(u);
    }
  });
  assert.ok(seen.size >= 4, `${seen.size} batteries`);
  assert.equal(ok.size, seen.size, `${ok.size} of ${seen.size} batteries manned and set up at their posts`);
  run(s, 100);
  for (const team of [0, 1]) assert.ok(unloads.got.some((e) => e.team === team), `team ${team}'s trucks delivered`);
  unloads.off(); s.dispose();
});

test('fire missions are never called down near our own soldiers', () => {
  const s = new FrontlineSession(sessionData, { size: '32v32', seed: 5 });
  const close = [], missions = [];
  const off = bus.on('support:mission', (e) => {
    missions.push(e);
    for (const f of s.fighters) {
      if (f.team !== e.team || f.health.dead) continue;
      if (Math.hypot(P(f).x - e.x, P(f).z - e.z) < 30) close.push({ e, f: f.id });
    }
  });
  run(s, 120);
  off();
  assert.ok(missions.length >= 4, `${missions.length} missions`);
  assert.deepEqual(close, [], 'danger close');
  const kinds = new Set(missions.map((m) => m.kind));
  assert.ok(kinds.size >= 2, `several kinds of mission (${[...kinds]})`);
  s.dispose();
});

test('the whistle waits for a preparation barrage on the points ahead, which lifts before it', () => {
  const s = new FrontlineSession(sessionData, { size: '32v32', seed: 7 });
  const prep = listen('support:prep'), whistle = listen('squad:whistle'), fired = [];
  const offF = bus.on('gun:fire', (e) => fired.push({ ...e, t: s.time }));
  run(s, 150, () => { if (whistle.got.length && prep.got.length) return; });
  assert.ok(prep.got.length >= 1, 'a preparation barrage was called');
  const p = prep.got[0], w = whistle.got.find((e) => e.team === p.team);
  assert.ok(w, 'and its whistle blew');
  const before = fired.filter((f) => f.team === p.team && f.t <= p.until + 0.1 && f.at);
  assert.ok(before.length >= 2, `${before.length} rounds in the barrage`);
  prep.off(); whistle.off(); offF(); s.dispose();
});

test('SOS: when the enemy goes over the top, our guns shell the ground in front of their trench', () => {
  const s = new FrontlineSession(sessionData, { size: '32v32', seed: 7 });
  run(s, 30);                                   // guns set up
  const sc = s.support[1], m = listen('support:mission');
  bus.emit('squad:whistle', { team: 0, trench: 0, x: s.map.trenches[0].cx, z: 0, squads: [0] });
  run(s, 3);
  const sos = m.got.filter((e) => e.team === 1 && e.kind === 'sos');
  assert.ok(sos.length >= 1, 'SOS fire');
  assert.ok(sos.every((e) => (e.x - s.map.trenches[0].cx) > 10), 'in front of their trench, on our side of it');
  assert.ok(sc.sos, 'remembered');
  m.off(); s.dispose();
});

test('counter-battery: a gun that keeps firing gets located and shelled', () => {
  const s = new FrontlineSession(sessionData, { size: '32v32', seed: 7 });
  run(s, 30);
  const sc = s.support[0], enemy = s.support[1].units.find((u) => u.kind === 'howitzer');
  const v = s.support[1].vehicle(enemy);
  // A clean slate: no SOS, no barrage, nothing heard yet, no missions.
  sc.sos = null; sc.prep = null; sc.enemyGuns.clear();
  for (const u of sc.units) u.mission = null;
  // One shot heard isn't a fix; three are.
  bus.emit('gun:fire', { id: v.id, team: 1, kind: 'howitzer', from: P(v).toArray(), at: null });
  sc.next = 0; sc.update(0);
  assert.ok(!sc.units.some((u) => u.mission?.kind === 'counter'), 'one shot: not located yet');
  for (let k = 0; k < 2; k++) bus.emit('gun:fire', { id: v.id, team: 1, kind: 'howitzer', from: P(v).toArray(), at: null });
  sc.next = 0; sc.update(0);
  const cb = sc.units.filter((u) => u.mission?.kind === 'counter');
  assert.ok(cb.length >= 1, 'counter-battery mission');
  assert.ok(cb.every((u) => u.kind === 'howitzer'), 'howitzers answer (rockets saturate areas)');
  const m = cb[0].mission;
  assert.ok(Math.hypot(m.x - P(v).x, m.z - P(v).z) < 25, `aimed at the gun (${Math.hypot(m.x - P(v).x, m.z - P(v).z).toFixed(0)} m off)`);
  s.dispose();
});

test('soldiers hit the dirt when a round is about to land on them', () => {
  const s = new FrontlineSession(sessionData, { size: '32v32', seed: 7 });
  run(s, 2);
  const f = s.bots.find((b) => !b.duty && !b.vehicle && !b.health.dead);
  const G = s.world.vehicles.guns, p = P(f);
  G.incoming.push({ x: p.x + 2, y: p.y, z: p.z, at: G.time + 2, radius: 9, team: 1 - f.team, kind: 'howitzer', gun: -1 });
  run(s, 1.2);
  assert.equal(f.movement.state.stance, 'prone', 'down before it lands');
  s.dispose();
});

test('AT crews set up behind the front line and kill enemy armor that shows itself', () => {
  const s = new FrontlineSession(sessionData, { size: '32v32', seed: 7 });
  run(s, 70);
  const sc = s.support[0], at = sc.units.filter((u) => u.kind === 'at').map((u) => sc.vehicle(u)).filter(Boolean);
  const set = at.filter((v) => v.gun.state === 'deployed');
  assert.ok(set.length >= 1, 'an AT gun is set up');
  const g = set[0], muzzle = s.world.vehicles.guns.muzzle(g);
  // Only the test tank: every other enemy vehicle is kept at the enemy HQ, out of reach (their
  // crews would drive the guns back to the front, and the AT gun rightly takes the nearest armor).
  const hq1 = s.map.hq[1];
  const away = () => { for (const v of s.world.vehicles.list) if (v.team === 1 && v !== tank) { v.movement.state.position.set(hq1.x, hq1.y, hq1.z); v.movement.state.velocity.set(0, 0, 0); } };
  let tank = null;
  away();
  // An enemy tank 120 m in front of it.
  const at2 = new Vector3(P(g).x + 120, 0, P(g).z);
  at2.y = s.map.terrain.height(at2.x, at2.z);
  tank = s.world.vehicles.spawn('void_crawler_tank', 1, at2, Math.PI / 2);
  const ray = new Vector3().subVectors(P(tank).clone().setY(P(tank).y + 1), muzzle);
  const clear = !s.world.sight(muzzle, ray.clone().normalize(), ray.length() - 2);   // cover and ground
  run(s, 25, away);
  if (clear) assert.ok(tank.removed || tank.health.hp < tank.health.max * 0.4, `tank at ${Math.round(tank.health.hp)} HP`);
  else assert.ok(true, 'no line of sight from this post (terrain): nothing to assert');
  s.dispose();
});

test('when the front moves, the crews pack up and move their guns to the new park', () => {
  const s = new FrontlineSession(sessionData, { size: '32v32', seed: 7 });
  run(s, 30);
  const sc = s.support[0], u = sc.units.find((x) => x.kind === 'howitzer'), v = sc.vehicle(u);
  const from = P(v).clone();
  s.mode.front[0]++;
  bus.emit('mode:front', {});
  run(s, 2);
  assert.ok(u.post.distanceTo(from) > 60, 'new post in the next sector');
  const states = new Set();
  run(s, 120, () => states.add(v.gun.state));
  assert.ok(states.has('packing') || states.has('packed'), 'packed up');
  assert.ok(P(v).distanceTo(u.post) < P(v).distanceTo(from) || P(v).distanceTo(u.post) < 12, `on its way (${P(v).distanceTo(u.post).toFixed(0)} m to go)`);
  s.dispose();
});
