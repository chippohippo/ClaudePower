// The commander: team intel, orders and how squads take them, scouts, fire missions, the
// commander's seat for a person, and the AI strategist.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { bus } from '../src/core/EventBus.js';
import { Intel } from '../src/ai/command/Intel.js';
import { FrontlineSession } from '../src/game/FrontlineSession.js';
import { data as H } from './harness.mjs';

const DATA = {
  movement: H.movement, weaponFiles: [H.ballistic, H.energy], attachments: H.attachments, recoil: H.recoil, statuses: H.statuses,
  meleeWeapons: H.melee, kits: H.kits, classes: H.classes, damageMatrix: H.matrix, supers: H.supers, vehicleDefs: H.vehicles,
  personalities: H.ai.personalities, difficulty: H.ai.difficulty.veteran, down: H.down, barks: H.barks, stratagems: H.stratagems,
};
const session = (o = {}) => new FrontlineSession(DATA, { size: '12v12', seed: 7, map: 'trench', ...o });
const run = (S, seconds) => { for (let i = 0; i < Math.round(seconds * 60); i++) S.step(1 / 60); };
const body = (id, team, x, z) => ({ id, team, movement: { state: { position: new Vector3(x, 0, z) } }, health: { dead: false } });

test('intel: what one soldier sees the team knows; the unseen go stale, then are forgotten; ground watched', () => {
  const I = new Intel(0, { bounds: { minX: -200, maxX: 200, minZ: -100, maxZ: 100 }, memory: 20, sight: 50 });
  const me = body(1, 0, 0, 0), e = body(7, 1, 40, 0);
  I.spot(e, me.id);
  assert.ok(I.sees(e), 'in sight');
  assert.equal(I.near(40, 0, 10), 1);
  for (let i = 0; i < 5; i++) I.update(0.5, [me]);
  assert.ok(!I.sees(e), 'not seen for 2.5 s: a last known position');
  assert.equal(I.near(40, 0, 10), 1, 'still remembered');
  assert.equal(I.near(40, 0, 10, 2), 0, 'not among the fresh ones');
  // Our soldier watches the ground round him; ground nobody has been near was never watched.
  assert.ok(I.staleness(0, 0, 20) < 1, 'watched');
  assert.equal(I.staleness(180, 80, 10), Infinity, 'never watched');
  // Forgotten after `memory` s; the dead at once.
  for (let i = 0; i < 40; i++) I.update(0.5, [me]);
  assert.equal(I.contacts.size, 0, 'forgotten');
  const d = body(8, 1, 10, 0);
  I.spot(d); d.health.dead = true; I.update(0.5, [me]);
  assert.equal(I.contacts.size, 0, 'the dead are dropped');
  // Groups standing together, for the guns.
  for (let k = 0; k < 4; k++) I.spot(body(20 + k, 1, 100 + k * 2, 50));
  I.spot(body(30, 1, -150, -80));
  const cl = I.clusters(4, 18, 2);
  assert.equal(cl.length, 1); assert.equal(cl[0].n, 4);
});

test('the commander\'s seat: a person commands his side from off the field; the AI commands the other', () => {
  const S = session({ humans: [{ id: 1, team: 0, classId: 'commander' }] });
  const me = S.fighters.find((f) => f.id === 1), C = S.commanders[0];
  assert.ok(me.commander && me.offField, 'off the field');
  assert.ok(!S.squads[0].some((s) => s.members.includes(me)), 'in no squad');
  assert.ok(!S.world.entity(1), 'not in the world: nobody can shoot him');
  assert.ok(C.human && !C.mind, 'his side: his orders, no AI plan');
  assert.ok(S.commanders[1].mind, 'the other side: the AI (veteran)');
  // His side still fields all its soldiers.
  const other = session();
  assert.equal(S.fighters.filter((f) => f.team === 0 && !f.offField).length, other.fighters.filter((f) => f.team === 0).length);
  run(S, 3);
  assert.ok(C.squads.every((s) => s.objective !== null), 'squads under no order follow standing orders');
  S.dispose(); other.dispose();
});

test('orders: a squad out of contact goes at once and says so; one pinned down says why, and goes when it can', () => {
  const S = session({ humans: [{ id: 1, team: 0, classId: 'commander' }] });
  const C = S.commanders[0], atk = S.mode.objectives(0).attack;
  // Take a point: an attack on it, every member told.
  const a = C.squads[0];
  assert.ok(C.give(a, { kind: 'take', point: atk[0].id, by: 'human' }).ok);
  assert.equal(a.objective, atk[0].id); assert.equal(a.role, 'attack');
  assert.ok(a.members.every((m) => m.brain.objective.id === atk[0].id), 'every member has it');
  assert.equal(C.log.at(-1).kind, 'order');
  // Hold a spot anywhere: a place, held (the same spot again is the same place).
  const b = C.squads[1], spot = { x: atk[0].pos.x - 60, z: atk[0].pos.z + 30 };
  assert.ok(C.give(b, { kind: 'hold', at: spot, by: 'human' }).ok);
  const place = C.target(b.objective);
  assert.ok(place.place, 'a place'); assert.equal(b.role, 'line');
  assert.equal(C.place(spot.x + 3, spot.z - 2), place, 'the same place');
  // Pinned down, with a commander they never obey at once: they say why, and go within three tries.
  C.cfg.obey = 0;
  const c = C.squads[2], to = atk.find((p) => p.id !== c.objective);
  c.tactics.pinnedT = 5;
  const r = C.give(c, { kind: 'take', point: to.id, by: 'human' });
  assert.ok(!r.ok && r.why === 'pinned down', 'refused: pinned down');
  assert.equal(C.log.at(-1).kind, 'refuse');
  assert.ok(c.pending && c.objective !== to.id, 'not gone yet');
  for (let i = 0; i < 60 && c.pending; i++) C.update(1);
  assert.ok(!c.pending && c.objective === to.id, 'gone when it could');
  // Back to standing orders.
  assert.ok(C.give(a, { kind: 'auto', by: 'human' }).ok);
  assert.equal(a.order, null);
  S.dispose();
});

test('a scout goes ahead to a vantage point, keeps watch on the place for the team, and comes back', () => {
  const S = session({ humans: [{ id: 1, team: 0, classId: 'commander' }] });
  const C = S.commanders[0], I = S.world.intel[0], atk = S.mode.objectives(0).attack;
  const target = atk[atk.length - 1];
  run(S, 2);
  const r = C.give(C.squads[1], { kind: 'scout', at: { x: target.pos.x, z: target.pos.z }, name: target.name, by: 'human' });
  assert.ok(r.ok && r.scout, 'one man sent');
  const task = C.scouts.get(C.squads[1]), m = task.member;
  assert.equal(m.detached, task, 'detached from his squad');
  assert.ok(C.log.some((e) => e.kind === 'scout'), 'said on the radio');
  // The vantage: on our side of the place, within reach, with the place in sight.
  const V = task.vantage, hq = S.map.hq[0];
  assert.ok(Math.hypot(V.x - target.pos.x, V.z - target.pos.z) < 125, 'near enough to watch it');
  assert.ok(Math.hypot(V.x - hq.x, V.z - hq.z) < Math.hypot(target.pos.x - hq.x, target.pos.z - hq.z), 'on our side of it');
  let watched = false;
  for (let i = 0; i < 70 && !task.done; i++) { run(S, 1); if (task.state === 'watching') { watched = true; break; } }
  assert.ok(watched, `on watch (state ${task.state})`);
  assert.ok(I.watchers.has(m), 'his watch counts as the team\'s');
  run(S, 1);
  assert.ok(I.staleness(target.pos.x, target.pos.z, 10) < 2, 'the place is watched');
  // Called off: back to his squad.
  task.end();
  assert.ok(!m.detached && !I.watchers.has(m));
  S.dispose();
});

test('fire missions: the guns fire the commander\'s; blind ones scatter wide; the AI\'s never outrank counter-battery', () => {
  const S = session({ humans: [{ id: 1, team: 0, classId: 'commander' }] });
  const C = S.commanders[0], sup = S.support[0], atk = S.mode.objectives(0).attack;
  const missions = [];
  const off = bus.on('support:mission', (e) => { if (e.team === 0) missions.push(e); });
  run(S, 1);
  const p = atk[0].pos;
  const r = C.fire({ x: p.x, z: p.z, r: 16, rounds: 3, by: 'human' });
  assert.ok(r.ok && r.observed === false, 'nobody has eyes on it yet: fired blind');
  const o = sup.orders.at(-1);
  assert.equal(o.pri, 7, 'a person\'s call: top priority');
  assert.equal(o.r, 32, 'blind: twice as wide');
  assert.ok(Math.hypot(o.x - p.x, o.z - p.z) >= 10, 'and off the mark');
  assert.ok(C.log.some((e) => e.kind === 'fire'), 'on the radio');
  run(S, 15);
  assert.ok(missions.some((e) => e.kind === 'ordered'), 'a battery took it');
  // The AI's own (an attack's preparation) sits below counter-battery fire (4) and SOS (6).
  C.fire({ x: p.x, z: p.z, r: 16, by: 'ai', pri: 5 });
  assert.equal(sup.orders.at(-1).pri, 5);
  off();
  S.dispose();
});

test('the AI strategist plans every squad, within its budget, and its orders reach them', () => {
  const S = session({ command: [H.ai.difficulty.elite.command, H.ai.difficulty.recruit.command] });
  const C = S.commanders[0], M = C.mind;
  assert.ok(M, 'elite: the strategist commands');
  assert.ok(!S.commanders[1].mind, 'recruit: standing orders only');
  const orders = [];
  const off = bus.on('command:order', (e) => { if (e.team === 0) orders.push(e); });
  const ms = [];
  let last = null;
  for (let i = 0; i < 40 * 60; i++) { S.step(1 / 60); if (M.last && M.last !== last) { last = M.last; ms.push(last.ms); } }
  off();
  assert.ok(ms.length >= 12, `it thinks every few seconds (${ms.length} plans)`);
  assert.equal(M.last.assign.length, C.squads.length, 'a task for every squad');
  assert.ok(M.last.evals <= M.cfg.search + 8, `within its search budget (${M.last.evals})`);
  assert.ok(orders.every((e) => e.by === 'ai'), 'its orders are the AI\'s');
  assert.ok(C.squads.some((s) => s.order?.by === 'ai') && C.log.some((e) => e.kind === 'order'), 'it gives orders (the first, at load), and they go out on the radio');
  assert.ok(C.squads.every((s) => s.objective !== null && s.members.every((m) => m.health.dead || m.detached || m.brain?.objective?.id === s.objective)), 'every squad, and every man, has his task');
  const sorted = ms.slice(2).sort((a, b) => a - b);
  assert.ok(sorted[Math.floor(sorted.length / 2)] < 15, `a plan takes a few ms (median ${sorted[Math.floor(sorted.length / 2)].toFixed(1)})`);
  // How it reads the board, for tuning and the tests: the forward model against each of the enemy's answers.
  const ex = M.explain(C);
  assert.equal(ex.runs.length, M.cfg.responses);
  assert.ok(Number.isFinite(ex.score));
  S.dispose();
});
