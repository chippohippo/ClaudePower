// Squad tactics: cover spots, routes, suppression, and the squad behaviours themselves in real
// matches: going over the top together on the whistle, keeping spacing, bounding overwatch,
// holding a line in front of a point, sweeping and clearing a building, charging only when
// desperate, and following a human leader.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { bus } from '../src/core/EventBus.js';
import { CoverIndex } from '../src/world/CoverIndex.js';
import { NavGrid } from '../src/world/NavGrid.js';
import { TacticalMap } from '../src/ai/tactics/TacticalMap.js';
import { Suppression } from '../src/ai/tactics/Suppression.js';
import { FrontlineSession } from '../src/game/FrontlineSession.js';
import { emptyCommand } from '../src/input/InputManager.js';
import { data as H, makeWorld, v } from './harness.mjs';

const sessionData = {
  movement: H.movement, weaponFiles: [H.ballistic, H.energy], attachments: H.attachments, recoil: H.recoil, statuses: H.statuses,
  meleeWeapons: H.melee, kits: H.kits, classes: H.classes, damageMatrix: H.matrix, supers: H.supers, vehicleDefs: H.vehicles,
  personalities: H.ai.personalities, difficulty: H.ai.difficulty.veteran, down: H.down,
};
const box = (x0, z0, x1, z1, h, kind = 'wall') => ({ min: v(x0, 0, z0), max: v(x1, h, z1), kind, surface: 'concrete' });
const flatMap = (boxes) => ({ bounds: { minX: -50, minZ: -50, maxX: 50, maxZ: 50 }, cover: new CoverIndex(boxes, { cell: 8 }), terrain: null, trenches: [], craters: [], ruins: [] });
const P = (m) => m.movement.state.position;
const up = (sq) => sq.members.filter((m) => !m.health.dead && !m.health.downed && !m.vehicle);
const run = (s, seconds, each) => { for (let i = 0; i < Math.round(seconds * 60); i++) { s.step(1 / 60); each?.(i); } };

test('cover spots: beside every face, covering from the far side only; tall cover hides, corners lean out', () => {
  const low = box(0, 0, 1, 4, 1.2), tall = box(10, 0, 11, 6, 2.6);
  const tm = new TacticalMap(flatMap([low, tall]));
  const spots = [];
  tm.query(0, 2, 6, (s) => spots.push(s));
  assert.ok(spots.length >= 4, 'spots on every face');
  const west = spots.find((s) => s.nx === -1);
  assert.ok(Math.abs(west.x - -0.6) < 1e-6 && west.fire === 'over', 'half cover: fire over it');
  assert.equal(tm.covers(west, 30, 2), 1, 'covered from beyond the box (crouched)');
  assert.equal(tm.covers(west, -30, 2), 0, 'exposed from its own side');
  const tallSpots = []; tm.query(10.5, 3, 6, (s) => { if (s.box === tall) tallSpots.push(s); });
  const tw = tallSpots.filter((s) => s.nx === -1);
  assert.equal(tm.covers(tw[0], 40, 3), 2, 'full cover: covered standing');
  assert.ok(tw.some((s) => s.fire === 'around' && s.peek), 'spots by a corner lean out past it');
  // Reservations: a held spot is skipped by others until it lapses.
  tm.reserve(west, 7, 0, 4);
  assert.ok(!tm.free(west, 8, 1) && tm.free(west, 7, 1) && tm.free(west, 8, 5));
  // Cover blown apart takes its spots with it.
  bus.emit('world:coverDestroyed', { cover: low });
  const left = []; tm.query(0.5, 2, 3, (s) => { if (s.box === low) left.push(s); });
  assert.equal(left.length, 0);
  tm.dispose();
});

test('routes: around walls, straight across open ground, partial when the search is cut short', () => {
  const wall = box(-1, -20, 1, 20, 3);
  const nav = new NavGrid({ minX: -50, minZ: -50, width: 100, depth: 100, cell: 2 }, { cover: new CoverIndex([wall], { cell: 8 }) });
  const open = nav.path(-30, -30, -10, 30);
  assert.ok(open.reached && open.pts.length === 2, 'open ground: one straight leg');
  const around = nav.path(-10, 0, 10, 0);
  assert.ok(around.reached && around.pts.length >= 4, 'turns at the wall\'s end');
  let x = -10, z = 0;
  for (let k = 0; k < around.pts.length; k += 2) { assert.ok(nav.lineClear(x, z, around.pts[k], around.pts[k + 1], 1), 'every leg is walkable'); x = around.pts[k]; z = around.pts[k + 1]; }
  const cut = nav.path(-10, 0, 10, 0, { maxExpand: 30 });
  assert.ok(!cut.reached && cut.pts.length >= 2, 'cut short: walks toward it and asks again');
});

test('suppression: near misses, hits and blasts pin soldiers down, then it bleeds off', () => {
  const W = makeWorld([]);
  const shooter = W.fighter(1, 0, v(0, 0, 0), 'lancer'), target = W.fighter(2, 1, v(30, 0, 0), 'lancer');
  const sup = new Suppression(W.world);
  const tracer = (dz) => bus.emit('weapon:tracer', { id: 1, from: [0, 1.6, dz], dir: [1, 0, 0], dist: 120 });
  tracer(6);
  assert.equal(target.suppression ?? 0, 0, '6 m wide: nothing');
  tracer(1);
  const one = target.suppression;
  assert.ok(one > 0.02, `a round cracking past at 1 m: ${one?.toFixed(3)}`);
  for (let i = 0; i < 12; i++) tracer(0.8);
  assert.ok(target.suppression > 0.6, `a burst pins him (${target.suppression.toFixed(2)})`);
  assert.equal(shooter.suppression ?? 0, 0, 'your own rounds never pin you');
  for (let i = 0; i < 360; i++) sup.update(1 / 60, [shooter, target]);
  assert.ok(target.suppression < 0.05, 'gone a few seconds after the fire stops');
  bus.emit('projectile:explode', { point: v(31, 0, 1), radius: 3, ownerId: 1 });
  assert.ok(target.suppression > 0.4, 'a shell landing next to you');
  sup.dispose();
});

test('over the top: both sides man their jump-off trench, the whistle blows, everyone goes at once', () => {
  const s = new FrontlineSession(sessionData, { size: '4v4', seed: 5 });
  const whistles = [];
  const off = bus.on('squad:whistle', (e) => whistles.push({ ...e, t: s.time }));
  const manned = [0, 0];
  run(s, 30, (i) => {
    if (i % 30) return;
    for (const team of [0, 1]) {
      const sq = s.squads[team][0];
      if (sq.tactics.phase === 'jumpoff') manned[team] = Math.max(manned[team], up(sq).filter((m) => m.brain?.order?.kind === 'man' && m.brain.order.spot && P(m).distanceTo(new Vector3(m.brain.order.spot.x, P(m).y, m.brain.order.spot.z)) < 1.6).length);
    }
  });
  off();
  for (const team of [0, 1]) {
    assert.ok(manned[team] >= 3, `team ${team}: ${manned[team]} soldiers manned firing positions`);
    const w = whistles.find((x) => x.team === team);
    assert.ok(w && w.t < 25, `team ${team} went over the top (whistle at ${w?.t.toFixed(1)} s)`);
    const T = s.map.trenches.find((q) => q.id === w.trench), dir = team === 0 ? 1 : -1;
    const out = up(s.squads[team][0]).filter((m) => (P(m).x - T.cx) * dir > 8).length;
    assert.ok(out >= Math.min(3, up(s.squads[team][0]).length), `team ${team}: out in no-man's-land (${out})`);
  }
  s.dispose();
});

test('an advancing squad keeps its spacing: no blob, no straggling conga line', () => {
  const s = new FrontlineSession(sessionData, { size: '12v12', seed: 4 });
  let samples = 0, nnSum = 0, tooClose = 0, far = 0, members = 0;
  run(s, 40, (i) => {
    if (i < 60 * 12 || i % 30) return;
    for (const team of [0, 1]) for (const sq of s.squads[team]) {
      if (sq.tactics.phase !== 'advance' && sq.tactics.phase !== 'contact') continue;
      const u = up(sq);
      if (u.length < 3) continue;
      for (const a of u) {
        let nn = Infinity;
        for (const b of u) if (a !== b) nn = Math.min(nn, P(a).distanceTo(P(b)));
        nnSum += nn; samples++;
        if (nn < 1.5) tooClose++;
        members++;
        if (P(a).distanceTo(P(u[0])) > 40) far++;
      }
    }
  });
  const avg = nnSum / samples;
  assert.ok(samples > 100, 'squads advanced');
  assert.ok(avg > 3 && avg < 16, `average distance to the nearest squadmate ${avg.toFixed(1)} m`);
  assert.ok(tooClose / samples < 0.12, `bunched up ${(100 * tooClose / samples).toFixed(0)}% of the time`);
  assert.ok(far / members < 0.15, `straggling ${(100 * far / members).toFixed(0)}% of the time`);
  s.dispose();
});

test('contact: bounding overwatch, one fire team covering while the other moves', () => {
  const s = new FrontlineSession(sessionData, { size: '12v12', seed: 4 });
  let samples = 0, allMoving = 0, flips = 0, covering = 0;
  const last = new Map();
  run(s, 75, (i) => {
    if (i % 15) return;
    for (const team of [0, 1]) for (const sq of s.squads[team]) {
      const T = sq.tactics;
      if (T.phase !== 'contact' || !T.bound) continue;
      if (last.has(sq) && last.get(sq) !== T.bound.moving) flips++;
      last.set(sq, T.bound.moving);
      const u = up(sq).filter((m) => m.brain);
      if (u.length < 3) continue;
      samples++;
      const moving = u.filter((m) => Math.hypot(m.movement.state.velocity.x, m.movement.state.velocity.z) > 2.2);
      if (moving.length === u.length) allMoving++;
      if (u.some((m) => m.brain.order?.kind === 'overwatch')) covering++;
    }
  });
  assert.ok(samples > 40, `squads were in contact (${samples} samples)`);
  assert.ok(flips >= 4, `fire teams took turns bounding (${flips} swaps)`);
  assert.ok(covering / samples > 0.85, `someone was always covering (${(100 * covering / samples).toFixed(0)}%)`);
  assert.ok(allMoving / samples < 0.2, `the whole squad was rarely moving at once (${(100 * allMoving / samples).toFixed(0)}%)`);
  s.dispose();
});

test('hold: anchors stay on the point, the rest hold a line in cover toward the enemy', () => {
  const s = new FrontlineSession(sessionData, { size: '12v12', seed: 6 });
  for (const c of s.commanders) c.update = () => {};
  const sq = s.squads[0][1];
  const point = s.mode.points.find((p) => p.owner === 0 && s.map.sectors[p.sector].kind === 'line');
  sq.objective = point.id; sq.role = 'defend';
  run(s, 25);
  const u = up(sq).filter((m) => m.brain);
  assert.equal(sq.tactics.phase, 'hold');
  const onPoint = u.filter((m) => Math.hypot(P(m).x - point.pos.x, P(m).z - point.pos.z) < point.radius);
  assert.ok(onPoint.length >= 1, `${onPoint.length} on the point`);
  const line = u.filter((m) => (P(m).x - point.pos.x) > 5 && m.brain.order?.kind === 'hold' && !m.brain.order.anchor);
  assert.ok(line.length >= 1, `${line.length} holding the line out front`);
  assert.ok(line.every((m) => m.brain.order.spot || m.brain.order.dig), 'in cover (or digging in where there is none)');
  s.dispose();
});

test('sweep and clear: stack on the doorway, enter, clear the room', () => {
  const s = new FrontlineSession(sessionData, { size: '4v4', seed: 5 });
  for (const c of s.commanders) c.update = () => {};
  const point = s.mode.points.find((p) => p.sector === 2);
  // A ruin room near the middle point with an exterior doorway.
  const R = s.tactical.rooms.find((r) => r.room.doors.some((d) => r.ruin.doors.includes(d)) && Math.hypot((r.room.min.x + r.room.max.x) / 2 - point.pos.x, (r.room.min.z + r.room.max.z) / 2 - point.pos.z) < 60);
  assert.ok(R, 'a room to clear');
  const door = R.room.doors.find((d) => R.ruin.doors.includes(d));
  const sq = s.squads[0][0];
  sq.objective = point.id; sq.role = 'attack';
  // A Void soldier hiding in the room (no brain: he just stands there).
  const foe = s.fighters.find((f) => f.team === 1);
  foe.brain = null; s.bots.splice(s.bots.indexOf(foe), 1);
  const c = { x: (R.room.min.x + R.room.max.x) / 2, z: (R.room.min.z + R.room.max.z) / 2 };
  foe.movement.reset(new Vector3(c.x, s.map.terrain.height(c.x, c.z), c.z), 0);
  for (const f of s.fighters) if (f.team === 1 && f !== foe) f.movement.reset(new Vector3(s.map.hq[1].x, s.map.hq[1].y, s.map.hq[1].z), 0);
  // Our squad outside that doorway, 14 m out.
  up(sq).forEach((m, k) => { const x = door.x + door.nx * 14 + k, z = door.z + door.nz * 14 + k; m.movement.reset(new Vector3(x, s.map.terrain.height(x, z), z), 0); });
  sq.tactics.contacts.set(foe.id, { e: foe, pos: P(foe).clone(), t: 0 });   // someone saw him go in
  const seen = { clear: false, stacked: false, entered: false, cleared: false };
  const off = bus.on('squad:roomCleared', (e) => { if (e.team === 0) seen.cleared = true; });
  run(s, 45, (i) => {
    if (i % 10) return;
    const T = sq.tactics;
    if (T.phase === 'clear') seen.clear = true;
    for (const m of up(sq)) {
      const o = m.brain?.order;
      if (o?.kind === 'stack' && o.pos && Math.hypot(P(m).x - o.pos.x, P(m).z - o.pos.z) < 1.3) seen.stacked = true;
      const p = P(m);
      if (o?.kind === 'enter' && p.x > R.room.min.x && p.x < R.room.max.x && p.z > R.room.min.z && p.z < R.room.max.z) seen.entered = true;
    }
  });
  off();
  assert.ok(seen.clear, 'the squad decided to clear the building');
  assert.ok(seen.stacked, 'stacked up beside a doorway');
  assert.ok(seen.entered, 'went in');
  assert.ok(seen.cleared || foe.health.dead || foe.health.downed, 'room cleared (or the man in it put down)');
  s.dispose();
});

test('charges only when desperate: never in a normal fight, the final push when tickets run out', () => {
  const s = new FrontlineSession(sessionData, { size: '12v12', seed: 8 });
  const charges = [];
  const off = bus.on('squad:phase', (e) => { if (e.phase === 'charge') charges.push(e.why); });
  run(s, 50);
  const allowed = new Set(['the point is falling', 'last stand', 'out of tickets', 'out of time']);
  assert.ok(charges.every((w) => allowed.has(w)), `charges had a reason: ${charges.join(', ')}`);
  // Team 0 down to its last tickets: its attacking squads near their objective make the final push.
  s.mode.tickets[0] = 3;
  charges.length = 0;
  run(s, 3);
  off();
  const near = s.squads[0].filter((sq) => sq.role === 'attack' && up(sq).length && s.mode.points[sq.objective] && up(sq)[0].movement.state.position.distanceTo(s.mode.points[sq.objective].pos) < 85);
  if (near.length) assert.ok(charges.includes('out of tickets'), 'final push');
  s.dispose();
});

test('a human leads the squad: the bots form on you, and take cover around you when you stop', () => {
  const s = new FrontlineSession(sessionData, { size: '4v4', seed: 3, humans: [{ id: 1, team: 0, classId: 'lancer' }] });
  const me = s.fighters.find((f) => f.id === 1), sq = me.squad;
  const cmd = emptyCommand();
  cmd.moveY = 1; cmd.yaw = -Math.PI / 2;    // walk toward +X
  const near = [];
  run(s, 8, (i) => { s.setCommand(1, cmd); if (i > 240 && i % 30 === 0) for (const m of up(sq)) if (m !== me) near.push(P(m).distanceTo(P(me))); });
  assert.ok(near.length && near.filter((d) => d < 16).length / near.length > 0.8, 'with you on the move');
  cmd.moveY = 0;
  run(s, 4, () => s.setCommand(1, cmd));
  const bots = up(sq).filter((m) => m !== me);
  assert.equal(sq.tactics.phase, 'follow');
  assert.ok(bots.every((m) => m.brain.order?.kind === 'overwatch'), 'covering you when you stop');
  assert.ok(bots.every((m) => P(m).distanceTo(P(me)) < 14), 'close by');
  s.dispose();
});
