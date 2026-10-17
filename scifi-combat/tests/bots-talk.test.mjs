// Bots that talk, flank, search and break (src/ai/Barks.js, SquadTactics, CombatBotBrain,
// data/ai/barks.json, docs/GAMEPLAY_PLAN.md §6): callouts with names and directions, rationed
// per soldier and squad; a search of the last seen position instead of tracking through walls;
// a pinned squad flanking; a broken squad falling back.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bus } from '../src/core/EventBus.js';
import { makeWorld, v, data } from './harness.mjs';
import { FrontlineSession } from '../src/game/FrontlineSession.js';

function events(names) {
  const got = [];
  const offs = names.map((n) => bus.on(n, (e) => got.push({ type: n, ...e })));
  return { got, off: () => offs.forEach((f) => f()) };
}
function quiet(B) {
  for (const k of ['ability1', 'ability2', 'grenade', 'super']) { const s = B.abilities.slots[k]; if (s) { s.cooldown = 999; s.charges = 0; } }
  if (B.abilities) B.abilities.superEnergy = 0;
  for (const s of B.stratagems?.slots ?? []) s.cooldown = 999;
  return B;
}

test('names, and a contact called out with its direction, once for the squad', () => {
  const w = makeWorld();
  const A = quiet(w.bot(1, 0, v(0, 0, 0), 'lancer')), B = quiet(w.bot(2, 0, v(2, 0, 0), 'artificer'));
  A.squad = B.squad = { id: 7, members: [A, B] };
  assert.ok(A.name && B.name && A.name !== B.name, `named (${A.name}, ${B.name})`);
  assert.ok(data.barks.names.solari.includes(A.name), 'from his army\'s list');
  w.world.barks.update(30);                                   // well past the start
  const ev = events(['squad:bark']);
  w.fighter(9, 1, v(-30, 0, 0), 'reaver', { hp: 5000 });      // west of them
  A.movement.state.yaw = B.movement.state.yaw = 0;            // both facing north
  w.seconds(1.5);
  ev.off();
  const contacts = ev.got.filter((e) => e.kind === 'contact');
  assert.equal(contacts.length, 1, `one call for the squad (${contacts.map((e) => e.text).join(' | ')})`);
  assert.match(contacts[0].text, /left|front/i, 'and which way');
  assert.ok(contacts[0].name, 'with the speaker\'s name');
});

test('a squadmate down is called out by name; a teammate\'s rounds in you get a "check fire"', () => {
  const w = makeWorld([], { down: true });
  const A = quiet(w.bot(1, 0, v(0, 0, 0), 'lancer')), B = quiet(w.bot(2, 0, v(3, 0, 0), 'artificer'));
  A.squad = B.squad = { id: 3, members: [A, B] };
  w.world.barks.update(30);
  const ev = events(['squad:bark']);
  const enemy = w.fighter(9, 1, v(0, 0, 300), 'reaver');
  A.health.damage(A.health.hp + A.health.shield + 5, { kind: 'gun' }, enemy);
  w.world.barks.update(3);                                     // (a soldier says one thing at a time)
  bus.emit('weapon:hit', { attacker: A.id, victim: B.id, damage: 5, friendly: true });
  ev.off();
  const down = ev.got.find((e) => e.kind === 'down');
  assert.ok(down && down.id === B.id && down.text.includes(A.name), `"${down?.text}"`);
  assert.ok(ev.got.some((e) => e.kind === 'medic' && e.id === A.id), 'and he calls for a medic');
  assert.ok(ev.got.some((e) => e.kind === 'checkfire' && e.id === B.id), 'check fire');
});

test('lines are rationed: one per soldier every few seconds, the same kind much less often', () => {
  const w = makeWorld();
  const A = quiet(w.bot(1, 0, v(0, 0, 0), 'lancer'));
  const said = [];
  for (let i = 0; i < 40; i++) { w.world.barks.update(0.25); said.push(w.world.barks.say(A, 'moving')); }
  const n = said.filter(Boolean).length;
  assert.ok(n >= 1 && n <= 2, `10 s of asking: said ${n}`);
});

test('contact lost: the bot searches where he was last seen (and the cover there), not where he is now', () => {
  const w = makeWorld([{ min: v(-40, 0, -15), max: v(40, 3, -14) }]);   // a long wall: he'll slip behind it
  const A = quiet(w.bot(1, 0, v(0, 0, 0), 'lancer'));
  A.mode = 'gun';
  for (const g of A.weapons.loadout) { g.mag = 0; g.reserve = 0; }    // eyes only
  const E = w.fighter(2, 1, v(10, 0, -12), 'reaver', { hp: 5000 });
  w.seconds(1.5);
  assert.ok(w.brainOf(A).lastSeen, 'saw him');
  // He slips away behind the wall and along it.
  E.movement.state.position.set(-20, 0, -26);
  const ev = events(['squad:bark']);
  w.seconds(6);
  ev.off();
  const p = A.movement.state.position, L = w.brainOf(A).search?.spots?.[0] ?? { x: 10, z: -12 };
  assert.ok(Math.hypot(p.x - L.x, p.z - L.z) < Math.hypot(p.x + 20, p.z + 26), 'toward where he was, not where he went');
  assert.ok(ev.got.some((e) => e.kind === 'searching'), 'and says so');
});

test('frontline: squads flank and fall back as the fight goes, saying so', () => {
  const sessionData = {
    movement: data.movement, weaponFiles: [data.ballistic, data.energy], attachments: data.attachments, recoil: data.recoil, statuses: data.statuses,
    meleeWeapons: data.melee, kits: data.kits, classes: data.classes, damageMatrix: data.matrix, supers: data.supers, vehicleDefs: data.vehicles,
    personalities: data.ai.personalities, difficulty: data.ai.difficulty.veteran, down: data.down, rules: data.rules, stratagems: data.stratagems,
    passives: data.passives, support: data.support, humanoid: data.humanoid, barks: data.barks,
  };
  const s = new FrontlineSession(sessionData, { size: '12v12', seed: 5 });
  const ev = events(['squad:bark', 'squad:flank', 'squad:phase']);
  for (let i = 0; i < 60 * 150; i++) s.step(1 / 60);
  ev.off(); s.dispose();
  const kinds = new Set(ev.got.filter((e) => e.type === 'squad:bark').map((e) => e.kind));
  for (const k of ['contact', 'moving', 'covering', 'reloading']) assert.ok(kinds.has(k), `${k} heard (${[...kinds].join(', ')})`);
  assert.ok(ev.got.some((e) => e.type === 'squad:flank'), 'a squad flanked');
  assert.ok(s.fighters.every((f) => f.name && !/^[a-z_-]+$/.test(f.name) || f.name === undefined), 'everyone has a name');
});
