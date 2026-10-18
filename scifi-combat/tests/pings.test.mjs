// Pings: an enemy marked for the whole side (revealed, in the side's intel, the squad on him); a
// person's squad sent where they ping, onto a point, and back on them; a medic who comes when
// asked; bots' contact callouts as pings; no spamming.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { bus } from '../src/core/EventBus.js';
import { FrontlineSession } from '../src/game/FrontlineSession.js';
import { data as H } from './harness.mjs';

const DATA = {
  movement: H.movement, weaponFiles: [H.ballistic, H.energy], attachments: H.attachments, recoil: H.recoil, statuses: H.statuses,
  meleeWeapons: H.melee, kits: H.kits, classes: H.classes, damageMatrix: H.matrix, supers: H.supers, vehicleDefs: H.vehicles,
  personalities: H.ai.personalities, difficulty: H.ai.difficulty.veteran, down: H.down, barks: H.barks, stratagems: H.stratagems,
  battlePoints: H.battlePoints, rules: H.rules, passives: H.passives, support: H.support,
};
const run = (S, seconds) => { for (let i = 0; i < Math.round(seconds * 60); i++) S.step(1 / 60); };
const session = (o = {}) => new FrontlineSession(DATA, { size: '12v12', seed: 7, map: 'trench', humans: [{ id: 1, team: 0, classId: 'lancer' }], ...o });
const at = (f) => f.movement.state.position;

test('an enemy ping: revealed to the whole side, in its intel, his squad on him; it lasts, then it\'s gone', () => {
  const S = session(), P = S.pings, me = S.fighters.find((f) => f.id === 1);
  const foe = S.fighters.find((f) => f.team === 1 && !f.offField);
  const seen = [];
  const off = bus.on('ping:add', (e) => seen.push(e));
  const p = P.ping(me, 'enemy', { target: foe });
  off();
  assert.ok(p && p.kind === 'enemy' && p.target === foe);
  assert.equal(seen.length, 1); assert.equal(seen[0].team, 0); assert.equal(seen[0].label, foe.name);
  assert.ok(foe.status.has('revealed'), 'revealed: on every HUD of the side');
  assert.equal(foe.status.active.get('revealed')?.source, me, 'the pinger is paid for the spot');
  assert.ok(S.intel[0].sees(foe), 'the side\'s intel has him');
  assert.ok(me.squad.tactics.contacts.has(foe.id), 'his squad has him');
  assert.deepEqual(P.of(0), [p]); assert.deepEqual(P.of(1), [], 'theirs see nothing');
  assert.equal(P.ping(me, 'enemy', { target: S.fighters.find((f) => f.team === 0 && f !== me) }), null, 'a teammate is not an enemy');
  run(S, 8.5);
  assert.ok(!P.of(0).some((q) => q.id === p.id), 'gone after its 8 s');
  S.dispose();
});

test('no spamming: three pings in a second and a half at most', () => {
  const S = session(), P = S.pings, me = S.fighters.find((f) => f.id === 1);
  const spot = at(me).clone().add(new Vector3(10, 0, 0));
  const got = [0, 1, 2, 3].map(() => P.ping(me, 'danger', { at: spot }));
  assert.deepEqual(got.map(Boolean), [true, true, true, false]);
  run(S, 1.6);
  assert.ok(P.ping(me, 'danger', { at: spot }), 'and again after the window');
  S.dispose();
});

test('a person\'s squad goes where they ping, says so, and comes back on regroup', () => {
  const S = session();
  try {
    const P = S.pings, me = S.fighters.find((f) => f.id === 1), sq = me.squad, T = sq.tactics;
    const bots = () => sq.members.filter((m) => m.brain && !m.health.dead && !m.detached && !m.vehicle);
    run(S, 2);
    assert.equal(T.phase, 'follow', 'on the person to begin with');
    // Somewhere 45 m off toward the enemy.
    const spot = at(me).clone().add(new Vector3(45, 0, 8));
    spot.y = S.world.groundHeight(new Vector3(spot.x, 50, spot.z));
    const said = [];
    const off = bus.on('squad:bark', (e) => { if (e.squad === sq.id) said.push(e.kind); });
    assert.ok(P.ping(me, 'move', { at: spot }));
    run(S, 25);
    off();
    assert.equal(T.phase, 'directed');
    assert.ok(said.includes('onmark'), 'acknowledged on the radio');
    const near = bots().filter((m) => Math.hypot(at(m).x - spot.x, at(m).z - spot.z) < 12);
    assert.ok(near.length >= Math.max(1, bots().length - 1), `the squad is there (${near.length} of ${bots().length})`);
    // Regroup: back on the person.
    assert.ok(P.ping(me, 'regroup', {}));
    assert.equal(P.of(0).filter((q) => q.by === me.id && q.kind === 'move' && q.until > P.time).length, 0, 'the new order replaces the last');
    run(S, 2);
    assert.equal(T.phase, 'follow');
  } finally { S.dispose(); }
});

test('a point pinged: the squad goes onto it and holds inside its circle', () => {
  const S = session();
  try {
    const P = S.pings, me = S.fighters.find((f) => f.id === 1), sq = me.squad;
    const bots = () => sq.members.filter((m) => m.brain && !m.health.dead && !m.detached && !m.vehicle);
    // One of ours, behind the fighting (the mechanics, not the battle).
    const pt = S.mode.points.filter((p) => p.owner === 0).sort((a, b) => Math.hypot(a.pos.x - at(me).x, a.pos.z - at(me).z) - Math.hypot(b.pos.x - at(me).x, b.pos.z - at(me).z))[0];
    const p = P.ping(me, 'defend', { point: pt });
    assert.ok(p && p.label === `DEFEND ${pt.name}`);
    run(S, 40);
    const onIt = bots().filter((m) => Math.hypot(at(m).x - pt.pos.x, at(m).z - pt.pos.z) < pt.radius);
    assert.ok(onIt.length >= Math.max(1, bots().length - 1), `the squad on ${pt.name}, inside its circle (${onIt.length} of ${bots().length})`);
  } finally { S.dispose(); }
});

test('need a medic: the nearest medic of the side comes over and heals you (his passive, or a stim)', () => {
  const S = session({ size: '32v32', seed: 4 }), P = S.pings, me = S.fighters.find((f) => f.id === 1);
  const medic = S.fighters.find((f) => f.team === 0 && f.brain && f.items?.kind === 'stim' && !f.duty);
  assert.ok(medic, 'a medic on our side');
  // We're hurt, 25 m from him.
  const p = at(medic).clone().add(new Vector3(-25, 0, 0));
  p.y = S.world.groundHeight(new Vector3(p.x, 50, p.z));
  me.movement.reset(p);
  me.health.hp = me.health.max * 0.4;
  assert.ok(P.ping(me, 'medic', {}));
  const helper = S.fighters.find((f) => f.helpFor?.who === me);
  assert.ok(helper, 'someone is coming');
  let came = false, healed = false;
  for (let i = 0; i < 20 * 60 && !(came && healed); i++) {
    S.step(1 / 60);
    came ||= at(helper).distanceTo(at(me)) < 4;
    healed ||= me.status.has('stim') || me.health.hp >= me.health.max * 0.9;
  }
  assert.ok(came, 'he came over');
  assert.ok(healed, 'and you\'re patched up');
  run(S, 2);
  assert.ok(helper.helpFor == null, 'job done');   // (never assert.equal on a soldier: printing one prints the world)
  S.dispose();
});

test('bots ping what they call out: a squad\'s "Contact!" marks that enemy for its side', () => {
  const S = new FrontlineSession(DATA, { size: '12v12', seed: 3, map: 'trench' });
  const got = [];
  // (Who's who as it happens: a vehicle pinged may be a wreck, gone, by the end.)
  const off = bus.on('ping:add', (e) => { if (e.kind === 'enemy') got.push({ ...e, byE: S.world.entity(e.by), tE: S.world.entity(e.target) }); });
  run(S, 90);
  off();
  assert.ok(got.length >= 2, `callouts pinged (${got.length})`);
  for (const e of got) assert.ok(e.byE?.brain && e.tE && e.byE.team === e.team && e.tE.team !== e.team, 'a bot pinging an enemy of his side');
  // Not more than one a squad every 6 s.
  const bySquad = new Map();
  for (const e of got) { const sq = e.byE.squad; (bySquad.get(sq) ?? bySquad.set(sq, []).get(sq)).push(e.until - 8); }
  for (const ts of bySquad.values()) for (let i = 1; i < ts.length; i++) assert.ok(ts[i] - ts[i - 1] >= 5.99, 'spaced');
  S.dispose();
});
