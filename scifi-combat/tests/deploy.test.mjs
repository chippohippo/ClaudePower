// The deploy screen's sim: where a dead soldier can deploy (the HQ, his side's quiet points, his
// squadmates who aren't in trouble), deploying where he chose (or the HQ if that's closed now), and
// coming back as another class of his army.

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
const session = () => new FrontlineSession(DATA, { size: '12v12', seed: 7, map: 'trench', humans: [{ id: 1, team: 0, classId: 'lancer' }] });
const at = (f) => f.movement.state.position;
const flat = (p, q) => Math.hypot(p.x - q.x, p.z - q.z);
/** Dead (through the down, if there is one), and his wait over. */
function kill(S, f) {
  for (let i = 0; i < 4 && !f.health.dead; i++) { f.health.damage(9999, { kind: 'gun' }, null); if (f.health.downed) f.health.giveUp(); }
  f.respawnAt = S.time;
}

test('where a dead soldier can deploy: the HQ, his side\'s quiet points, squadmates not in trouble', () => {
  const S = session();
  try {
    run(S, 3);
    const me = S.fighters.find((f) => f.id === 1);
    kill(S, me);
    const O = S.spawnOptions(1);
    assert.equal(O[0].id, 'hq'); assert.ok(O[0].ok, 'the HQ is always open');
    const ours = S.mode.points.filter((p) => p.owner === 0);
    assert.equal(O.filter((o) => o.kind === 'point').length, ours.length, 'every point we hold');
    assert.ok(O.some((o) => o.kind === 'squad' && o.leader), 'the squad leader');
    for (const o of O) assert.ok(o.ok === !o.why, 'closed ones say why');
    // An enemy on one of our points closes it.
    const pt = ours[0], foe = S.fighters.find((f) => f.team === 1 && !f.offField && !f.health.dead);
    foe.movement.reset(new Vector3(pt.pos.x + 5, S.world.groundHeight(new Vector3(pt.pos.x + 5, 50, pt.pos.z)), pt.pos.z));
    S.step(1 / 60);   // (the world's grid has him there from the next tick)
    const P2 = S.spawnOptions(1).find((o) => o.id === `point:${pt.id}`);
    assert.ok(!P2.ok && P2.why === 'ENEMIES NEAR');
    assert.deepEqual(new FrontlineSession(DATA, { size: '4v4', seed: 2, map: 'trench' }).spawnOptions(99), [], 'nobody by that id: nothing');
  } finally { S.dispose(); }
});

test('deploying where you chose: on a point, on a squadmate; a closed choice goes to the HQ; not before the wave', () => {
  const S = session();
  try {
    run(S, 3);
    const me = S.fighters.find((f) => f.id === 1);
    kill(S, me);
    me.respawnAt = S.time + 5;
    assert.equal(S.respawn(1, { spawn: 'hq' }), false, 'reinforcements aren\'t in yet');
    me.respawnAt = S.time;
    const pt = S.mode.points.find((p) => p.owner === 0);
    assert.ok(S.respawn(1, { spawn: `point:${pt.id}` }));
    assert.ok(!me.health.dead && flat(at(me), pt.pos) < 8, `on ${pt.name} (${flat(at(me), pt.pos).toFixed(1)} m)`);
    // On a squadmate.
    kill(S, me);
    const mate = S.spawnOptions(1).find((o) => o.kind === 'squad' && o.ok);
    assert.ok(mate, 'a squadmate to deploy on');
    assert.ok(S.respawn(1, { spawn: mate.id }));
    assert.ok(flat(at(me), S.world.entity(+mate.id.split(':')[1]).movement.state.position) < 8, 'beside him');
    // A point that's closed by the time you deploy: the HQ instead.
    kill(S, me);
    const foe = S.fighters.find((f) => f.team === 1 && !f.offField && !f.health.dead);
    foe.movement.reset(new Vector3(pt.pos.x + 5, S.world.groundHeight(new Vector3(pt.pos.x + 5, 50, pt.pos.z)), pt.pos.z));
    S.step(1 / 60);
    me.respawnAt = S.time;
    assert.ok(S.respawn(1, { spawn: `point:${pt.id}` }));
    assert.ok(flat(at(me), pt.pos) > 25, 'not onto the enemy');
  } finally { S.dispose(); }
});

test('coming back as another class of your army: its body, guns, kit, item and passive; not one of theirs', () => {
  const S = session();
  try {
    run(S, 2);
    const me = S.fighters.find((f) => f.id === 1);
    const lancer = { gun: me.weapons.current.s.id, item: me.items?.kind ?? null, passive: me.passive, blade: me.melee };
    kill(S, me);
    const told = [];
    const off = bus.on('fighter:class', (e) => told.push(e));
    assert.ok(S.respawn(1, { spawn: 'hq', classId: 'lumen' }));
    off();
    const cls = H.classes[0].classes.find((c) => c.id === 'lumen');
    assert.equal(me.classId, 'lumen'); assert.equal(me.role, 'medic');
    assert.equal(me.health.max, cls.health); assert.ok(!me.health.dead && me.health.hp > 0);
    assert.notEqual(me.weapons.current.s.id, lancer.gun, 'the medic\'s gun');
    assert.equal(me.items?.kind, 'stim', 'the medic\'s stims');
    assert.equal(me.passive, cls.passive?.id ?? null);
    assert.ok(!S.melee.components.includes(lancer.blade) && S.melee.components.includes(me.melee), 'the blade swapped in the melee system');
    assert.deepEqual(told.map((e) => e.classId), ['lumen']);
    // A Void class: no.
    kill(S, me);
    assert.ok(S.respawn(1, { spawn: 'hq', classId: 'reaver' }));
    assert.equal(me.classId, 'lumen', 'still a medic');
    // He fights as one: a few seconds of the battle with the new kit.
    run(S, 5);
    assert.ok(!Number.isNaN(at(me).x));
  } finally { S.dispose(); }
});
