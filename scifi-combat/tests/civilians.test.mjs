// The city's people (src/game/Neutrals.js, src/ai/CivilianBrain.js, src/combat/Teams.js,
// src/combat/WeaponDrops.js): who fights whom; civilians are never armed but by a gun picked up
// off the field; they run from the fighting to shelter and get down there; a brave one arms
// himself once the fighting has come near and shoots only at whoever comes close; a group holds
// its shelter; the gangs hold their turf against both armies; nobody shoots an unarmed civilian
// on purpose; and a city match runs with all of them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, data, v } from './harness.mjs';
import { bus } from '../src/core/EventBus.js';
import { buildPerson, Neutrals } from '../src/game/Neutrals.js';
import { CivilianBrain } from '../src/ai/CivilianBrain.js';
import { CombatBotBrain } from '../src/ai/CombatBotBrain.js';
import { CIVILIAN, BANDIT, GRUDGE, ENGAGED } from '../src/combat/Teams.js';
import { WeaponDrops } from '../src/combat/WeaponDrops.js';
import { buildWeapon } from '../src/combat/weapons/WeaponDefs.js';
import { FrontlineSession } from '../src/game/FrontlineSession.js';

const PD = { movement: data.movement, statuses: data.statuses, meleeWeapons: data.melee, recoil: data.recoil, down: null };
const gun = (id) => buildWeapon([data.ballistic, data.energy].find((f) => f.weapons.some((w) => w.id === id)), id, data.attachments ?? [], []);

/** What a CivilianBrain asks of its Neutrals: the settings, the shelters, what's been heard (the real `heard`). */
function people(world, shelters) {
  const P = { world, C: data.civilians.civilians, shelters, noise: new Map(), n: 0 };
  P.heard = (p, r, since) => Neutrals.prototype.heard.call(P, p, r, since);
  P.shot = (x, z, loud = 1) => P.noise.set(`s${P.n++}`, { x, z, t: world.time, loud });
  return P;
}

function civilian(W, id, pos, P, { home = P.shelters[0], brave = false, group = null, haunt = null } = {}) {
  const e = buildPerson(W.world, PD, { id, team: CIVILIAN, pos, health: 70, faction: 'civilian' });
  e.civ = { foes: {}, engaged: {}, defend: group ? 18 : 12, brave, group, home, haunt, hitFrom: null };
  e.brain = new CivilianBrain(e, W.world, P, { seed: id });
  return W.adopt(e);
}

test('who fights whom: the armies and the gangs always; a civilian only armed and close or wronged, and only while he fights is he fought', () => {
  const W = makeWorld([]), w = W.world;
  w.drops = new WeaponDrops(w, {}, { recoil: data.recoil });
  const sol = W.fighter(1, 0, v(0, 0, 0), 'lancer'), voi = W.fighter(2, 1, v(40, 0, 0), 'reaver');
  const ban = buildPerson(w, PD, { id: 3, team: BANDIT, pos: v(0, 0, 40), health: 120, guns: [gun('sol_smg_wasp')], faction: 'bandit' });
  const P = people(w, [{ x: 30, z: 30, indoor: true, kind: 'house' }]);
  const civ = civilian(W, 4, v(30, 0, 30), P), civ2 = civilian(W, 5, v(31, 0, 30), P);
  assert.ok(w.hostile(sol, voi) && w.hostile(voi, sol), 'the armies');
  assert.ok(w.hostile(sol, ban) && w.hostile(ban, sol) && w.hostile(ban, voi) && w.hostileTo(1, ban), 'a gang and both armies');
  // Unarmed, nobody's target, and he fights nobody.
  assert.ok(!w.hostile(sol, civ) && !w.hostile(ban, civ) && !w.hostileTo(0, civ) && !w.hostile(civ, sol));
  // Armed with a gun picked up off the ground: still no fight while nobody's close.
  assert.ok(!civ.weapons.current);
  assert.ok(w.drops.take(civ, w.drops.drop(civ.movement.state.position.clone(), gun('sol_smg_wasp'))));
  assert.ok(civ.weapons.current && !w.hostile(civ, sol) && !w.hostile(civ, voi));
  // An armed soldier comes within his reach: he'd shoot; nobody shoots him until he does.
  sol.movement.state.position.set(30, 0, 22);
  assert.ok(w.hostile(civ, sol), 'an armed stranger close');
  assert.ok(!w.hostile(sol, civ) && !w.hostile(voi, civ));
  civ.civ.engaged[0] = w.time + ENGAGED;       // he fires at the Solari
  assert.ok(w.hostile(sol, civ) && w.hostileTo(0, civ), 'the side he shoots at fights him back');
  assert.ok(!w.hostile(voi, civ) && !w.hostileTo(1, civ), 'the other side still leaves him be');
  // Wronged: the Void hurt his people. He fights them wherever they are.
  assert.ok(!w.hostile(civ, voi));
  civ.civ.foes[1] = w.time + GRUDGE;
  assert.ok(w.hostile(civ, voi));
  // Never one civilian on another.
  assert.ok(!w.hostile(civ, civ2) && !w.hostile(civ2, civ));
  // It all wears off.
  w.time += GRUDGE + 1;
  assert.ok(!w.hostile(civ, voi) && !w.hostile(sol, civ));
});

test('shots close by: a civilian out in the open runs for a shelter away from them and gets down there, hands over his head', () => {
  const W = makeWorld([]);
  const P = people(W.world, [
    { x: 0, z: 0, indoor: false, kind: 'market' },        // where he is (out in the open)
    { x: -26, z: 0, indoor: true, kind: 'house' },        // past the shooting
    { x: 30, z: 4, indoor: true, kind: 'house' },         // away from it
  ]);
  const c = civilian(W, 4, v(0, 0, 0), P);
  W.seconds(1.5);
  assert.equal(c.brain.state, 'calm');
  assert.equal(c.movement.state.stance, 'stand');
  // A burst of fire 7 m away (soldiers shooting at each other, not at him).
  for (let i = 0; i < 6; i++) { P.shot(-7, 0); W.seconds(0.15); }
  assert.equal(c.brain.state, 'flee');
  assert.equal(c.brain.shelter, P.shelters[2], 'the shelter away from the shooting');
  for (let i = 0; i < 9 * 60 && c.brain.state === 'flee'; i++) W.step();
  const p = c.movement.state.position;
  assert.ok(Math.hypot(p.x - 30, p.z - 4) < 2.5, `got there (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`);
  W.seconds(1);
  assert.equal(c.brain.state, 'hide');
  assert.notEqual(c.movement.state.stance, 'stand', 'down');
  assert.ok(c.cower, 'hands over his head');
  assert.ok(!c.weapons.current, 'and still unarmed');
});

test('fighting heard further off: a civilian already indoors gets down where he is; once it has been quiet a while he stands', () => {
  const W = makeWorld([]);
  const P = people(W.world, [{ x: 0, z: 0, indoor: true, kind: 'house' }, { x: 40, z: 0, indoor: true, kind: 'house' }]);
  const c = civilian(W, 4, v(0, 0, 0), P);
  W.seconds(1);
  P.shot(-35, 5);
  W.seconds(1.5);
  assert.equal(c.brain.state, 'hide');
  assert.equal(c.brain.shelter, P.shelters[0], 'stayed in his shelter');
  const p = c.movement.state.position;
  assert.ok(Math.hypot(p.x, p.z) < 1, 'did not run');
  W.seconds(3);
  assert.notEqual(c.movement.state.stance, 'stand');
  W.seconds(45);
  assert.equal(c.brain.state, 'calm', 'quiet for a long while');
  W.seconds(2);
  assert.equal(c.movement.state.stance, 'stand');
  assert.ok(!c.cower);
});

test('a brave civilian arms himself only once the fighting has come near, and shoots only at whoever comes close', () => {
  const W = makeWorld([]), w = W.world;
  w.drops = new WeaponDrops(w, {}, { recoil: data.recoil });
  const P = people(w, [{ x: 0, z: 0, indoor: true, kind: 'house' }]);
  const c = civilian(W, 4, v(0, 0, 0), P, { brave: true });
  const timid = civilian(W, 5, v(0, 0, -3), P, { brave: false });
  w.drops.drop(v(5, 0, 2), gun('sol_smg_wasp'), { cache: true });
  W.seconds(4);
  assert.ok(!c.weapons.current, 'no call to arm himself while it is quiet');
  P.shot(42, 0);                  // the fighting, heard 40 m off
  W.seconds(5);
  assert.ok(c.weapons.current, 'went for the gun and took it');
  assert.ok(!timid.weapons.current, 'the timid one never does');
  assert.equal(w.drops.list.length, 0);
  const engaged = () => Object.values(c.civ.engaged).some((t) => t > w.time);
  // A soldier holding still 30 m off: he holds his fire.
  const sol = W.fighter(1, 0, v(30, 0, 1), 'lancer');
  W.seconds(2);
  assert.ok(!engaged(), 'held his fire');
  assert.ok(!w.hostile(sol, c));
  // The soldier comes close: he opens up on him, and the Solari may now fight him.
  let shots = 0;
  const off = bus.on('weapon:fire', (e) => { if (e.id === c.id) shots++; });
  sol.movement.state.position.set(8, 0, 1);
  W.seconds(2);
  off();
  assert.ok(shots > 0 && engaged(), `fired on him (${shots} rounds)`);
  assert.ok(w.hostile(sol, c) && !w.hostileTo(1, c));
});

test('a group holds its shelter together: gunfire right outside gets them down, not running; only the hurt one runs', () => {
  const W = makeWorld([]);
  const P = people(W.world, [{ x: 0, z: 0, indoor: true, kind: 'house' }, { x: 35, z: 0, indoor: true, kind: 'house' }]);
  const group = { id: 0, home: P.shelters[0], members: [] };
  for (let k = 0; k < 3; k++) group.members.push(civilian(W, 4 + k, v(k * 0.8 - 0.8, 0, 0.5), P, { brave: true, group }));
  W.seconds(1);
  for (let i = 0; i < 6; i++) { P.shot(-6, 0); W.seconds(0.15); }
  W.seconds(1);
  for (const m of group.members) {
    assert.equal(m.brain.state, 'hide', `member ${m.id} holds`);
    assert.ok(Math.hypot(m.movement.state.position.x, m.movement.state.position.z) < 2.5);
  }
  // A stray round hurts one: he runs (from where it came), the rest stay.
  const shooter = W.fighter(1, 1, v(-10, 0, 0), 'reaver');
  const hurt = group.members[1];
  hurt.health.damage(12, { kind: 'gun' }, shooter);
  hurt.onHit({ hp: 12 }, { kind: 'gun' }, shooter);
  W.seconds(1);
  assert.equal(hurt.brain.state, 'flee');
  assert.equal(hurt.brain.shelter, P.shelters[1]);
  assert.ok(group.members.filter((m) => m !== hurt).every((m) => m.brain.state === 'hide'));
});

test('a gang holds its turf: it opens up on a soldier who walks in, lets one far off pass, and does not chase', () => {
  const W = makeWorld([]), w = W.world;
  w.spatial = true;               // fighters found through the grid, as on a real map: sight has a range
  const B = data.civilians.bandits, persona = data.ai.personalities[B.persona];
  const diff = { ...data.ai.difficulty.veteran, perceptionRange: B.sight ?? 60 };
  const gang = { id: 0, name: 'Rust Saints', x: 0, z: 0, r: B.turf, members: [] };
  for (let k = 0; k < 3; k++) {
    const e = buildPerson(w, PD, { id: 10 + k, team: BANDIT, pos: v(k * 2 - 2, 0, 0), health: B.health, guns: [gun('void_ar_gnaw')], faction: 'bandit' });
    e.gang = gang; e.name = `Raider ${k + 1}`;
    e.brain = new CombatBotBrain(e, w, persona, diff, { seed: 31 + k });
    e.brain.objective = { id: 1000, pos: v(0, 0, 0), radius: Math.max(6, gang.r * 0.35), role: 'defend', slot: k, of: 3, field: 'turf:0' };
    gang.members.push(W.adopt(e));
  }
  let fired = 0;
  const off = bus.on('weapon:fire', (e) => { if (gang.members.some((m) => m.id === e.id)) fired++; });
  // A soldier standing well off (80 m): out of their sight, no fight.
  const sol = W.fighter(1, 0, v(80, 0, 0), 'lancer');
  W.seconds(3);
  assert.equal(fired, 0, 'let him be');
  // He walks into their streets (20 m): they open up.
  sol.movement.state.position.set(20, 0, 0);
  W.seconds(2.5);
  assert.ok(fired > 0, `opened up (${fired} rounds)`);
  // He gets out (80 m again): they don't follow him out of their turf.
  sol.movement.state.position.set(85, 0, 0);
  W.seconds(8);
  off();
  for (const m of gang.members) {
    const q = m.movement.state.position;
    assert.ok(Math.hypot(q.x, q.z) < gang.r + 10, `stayed on the turf (${Math.hypot(q.x, q.z).toFixed(0)} m)`);
  }
});

test('soldiers leave unarmed civilians be: no bot shoots at one standing in the open', () => {
  const W = makeWorld([]), w = W.world;
  const P = people(w, [{ x: 0, z: 0, indoor: false, kind: 'market' }]);
  const c = civilian(W, 4, v(0, 0, -12), P);
  const a = W.bot(1, 0, v(0, 0, 0), 'lancer'), b = W.bot(2, 1, v(14, 0, 30), 'reaver');
  let atHim = 0, aimed = 0;
  const off = bus.on('weapon:hit', (e) => { if (e.victim === c.id) atHim++; });
  for (let i = 0; i < 8 * 60; i++) { W.step(); if (W.brainOf(a).target === c || W.brainOf(b).target === c) aimed++; }
  off();
  assert.equal(aimed, 0, 'never their target');
  assert.ok(!c.health.dead, 'alive');
  assert.ok(atHim <= 2, `at most a stray round or two (${atHim})`);
});

test('a city match with its people: civilians unarmed and spread out, gangs armed on their turf, none of them counted', () => {
  const SD = {
    movement: data.movement, weaponFiles: [data.ballistic, data.energy], attachments: data.attachments, recoil: data.recoil, statuses: data.statuses,
    meleeWeapons: data.melee, kits: data.kits, classes: data.classes, damageMatrix: data.matrix, supers: data.supers, vehicleDefs: data.vehicles,
    personalities: data.ai.personalities, difficulty: data.ai.difficulty.veteran, down: data.down, barks: data.barks, civilians: data.civilians, battlePoints: data.battlePoints,
  };
  const s = new FrontlineSession(SD, { size: '12v12', seed: 3, map: 'city' });
  const N = s.neutrals, M = s.map;
  assert.ok(N, 'a city has its people');
  assert.ok(N.civilians.length >= data.civilians.civilians.min, `${N.civilians.length} civilians`);
  for (const c of N.civilians) {
    assert.equal(c.team, CIVILIAN);
    assert.ok(!c.weapons.current, 'never armed at the start');
    assert.equal(c.weapons.loadout.length, 0);
    const p = c.movement.state.position;
    for (const pt of M.points) assert.ok(Math.hypot(p.x - pt.pos.x, p.z - pt.pos.z) > pt.radius + 5, 'not on a point');
  }
  assert.ok(new Set(N.civilians.map((c) => M.sectors.find((x) => c.movement.state.position.x >= x.x0 && c.movement.state.position.x < x.x1)?.index)).size >= 2, 'spread over the sectors');
  assert.ok(N.gangs.length >= 1 && N.bandits.length >= 4, `${N.gangs.length} gangs, ${N.bandits.length} raiders`);
  for (const b of N.bandits) assert.ok(b.team === BANDIT && b.weapons.current && b.brain.objective?.role === 'defend', 'armed, holding their turf');
  // In nobody's squad; the tickets only count soldiers.
  for (const f of N.all) assert.ok(!f.squad && !s.squads.flat().some((q) => q.members?.includes(f)));
  const tickets = [...s.mode.tickets];
  let armyDeaths = 0;
  const off = bus.on('entity:death', (e) => { const f = s.world.entity(e.id); if (f && !f.isVehicle && !f.isDeployable && f.team < 2) armyDeaths++; });
  for (let i = 0; i < 25 * 60; i++) s.step(1 / 60);
  off();
  assert.ok(tickets[0] + tickets[1] - s.mode.tickets[0] - s.mode.tickets[1] <= armyDeaths, 'tickets: soldiers only');
  // The gangs stay on their turf.
  for (const b of N.bandits) {
    if (b.health.dead) continue;
    const q = b.movement.state.position;
    assert.ok(Math.hypot(q.x - b.gang.x, q.z - b.gang.z) < b.gang.r + 15, `a raider ${Math.hypot(q.x - b.gang.x, q.z - b.gang.z).toFixed(0)} m from his turf`);
  }
  // Nobody of theirs came back: the dead stay dead.
  for (const f of N.all) if (f.health.dead) assert.equal(f.respawnAt, Infinity);
  // A civilian and a raider standing on a point hold nothing.
  const pt = s.mode.points.find((p) => s.mode.capturable(p)) ?? s.mode.points[0];
  const civ = N.civilians.find((c) => !c.health.dead), ban = N.bandits.find((b) => !b.health.dead);
  for (const f of [civ, ban].filter(Boolean)) f.movement.state.position.set(pt.pos.x + 1, pt.pos.y, pt.pos.z);
  s.step(1 / 60);
  const soldiersOn = [0, 1].map((t) => s.fighters.filter((f) => f.team === t && !f.health.dead && !f.health.downed && !f.isVehicle && Math.hypot(f.movement.state.position.x - pt.pos.x, f.movement.state.position.z - pt.pos.z) <= pt.radius && Math.abs(f.movement.state.position.y - pt.pos.y) <= 4).length);
  assert.deepEqual([pt.counts[0], pt.counts[1]], soldiersOn, 'only soldiers count on a point');
  s.dispose();
});
