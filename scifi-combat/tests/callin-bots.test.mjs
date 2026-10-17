// Bots calling in stratagems (src/ai/CallInPlanner.js, docs/GAMEPLAY_PLAN.md §2): a strike on a
// cluster they can see, typed at a quick hand's pace and lobbed onto it; never with a teammate
// near where it comes down; a supply drop when short of ammo, then fetching from it; a side's
// call-ins rationed by its size.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bus } from '../src/core/EventBus.js';
import { makeWorld, v } from './harness.mjs';

const STRIKES = new Set(['precision_strike', 'strafing_run', 'airstrike', 'orbital_barrage']);

function events(names) {
  const got = [];
  const offs = names.map((n) => bus.on(n, (e) => got.push({ type: n, ...e })));
  return { got, off: () => offs.forEach((f) => f()) };
}

/** A bot with nothing but its gun and its call-ins (no abilities to muddy the test). */
function bot(w, id, team, pos, cls = 'lancer') {
  const B = w.bot(id, team, pos, cls);
  for (const k of ['ability1', 'ability2', 'grenade', 'super']) {
    const s = B.abilities.slots[k];
    if (s) { s.cooldown = 999; s.charges = 0; }
  }
  if (B.abilities) B.abilities.superEnergy = 0;
  return B;
}

/** Four tough enemies standing together `d` m north. */
function cluster(w, d, id0 = 20) {
  return [[0, 0], [2, 1], [-1.5, 1.5], [1, -1.8]].map(([x, z], i) => w.fighter(id0 + i, 1, v(x, 0, -d + z), 'monolith', { hp: 20000 }));
}

test('a bot calls a strike on a cluster it can see: typed at a quick hand\'s pace, lobbed onto them', () => {
  const w = makeWorld();
  const B = bot(w, 1, 0, v(0, 0, 0));
  cluster(w, 28);
  const ev = events(['stratagem:thrown', 'stratagem:beacon']);
  let t = 0;
  const arrows = [];
  const stamp = bus.on('stratagem:arrow', (e) => { if (e.id === B.id) arrows.push(t); });
  for (let i = 0; i < 60 * 10 && !ev.got.some((x) => x.type === 'stratagem:beacon' && x.ownerId === B.id); i++) { w.step(1); t += 1 / 60; }
  stamp(); ev.off();
  const thrown = ev.got.find((x) => x.type === 'stratagem:thrown' && x.id === B.id);
  assert.ok(thrown, `called something in (${w.brainOf(B).log.filter((l) => l[1] === 'callin' || l[1] === 'throw').join(' | ')})`);
  assert.ok(STRIKES.has(thrown.stratagem), `a strike (${thrown.stratagem})`);
  assert.ok(arrows.length >= 3, 'typed the code');
  for (let i = 1; i < arrows.length; i++) assert.ok(arrows[i] - arrows[i - 1] > 0.14, `no faster than a quick hand (${(arrows[i] - arrows[i - 1]).toFixed(2)} s)`);
  const planted = ev.got.find((x) => x.type === 'stratagem:beacon' && x.ownerId === B.id);
  assert.ok(planted, 'the beacon planted');
  const [bx, , bz] = planted.at;
  assert.ok(Math.hypot(bx, bz + 28) < 9, `on the cluster (${bx.toFixed(1)}, ${bz.toFixed(1)})`);
});

test('danger close: no strike with a teammate near where it would come down', () => {
  const w = makeWorld();
  const B = bot(w, 1, 0, v(0, 0, 0));
  cluster(w, 28);
  w.fighter(9, 0, v(3, 0, -19), 'lancer', { hp: 5000 });           // a teammate 9 m short of them
  const ev = events(['stratagem:thrown']);
  w.seconds(8);
  ev.off();
  const strikes = ev.got.filter((x) => x.id === B.id && STRIKES.has(x.stratagem));
  assert.equal(strikes.length, 0, `held the strike (${strikes.map((x) => x.stratagem).join(', ')})`);
});

test('short of ammo, a bot drops supplies beside itself, then takes its mags', () => {
  const w = makeWorld();
  const B = bot(w, 1, 0, v(0, 0, 0));
  const gun = B.weapons.current;
  gun.reserve = 0; gun.mag = 8;
  const ev = events(['stratagem:thrown', 'stratagem:land', 'stratagem:grab']);
  w.seconds(16);
  ev.off();
  const thrown = ev.got.find((x) => x.type === 'stratagem:thrown' && x.id === B.id);
  assert.equal(thrown?.stratagem, 'supply_drop', 'called a supply drop');
  const land = ev.got.find((x) => x.type === 'stratagem:land');
  assert.ok(land, 'it landed');
  assert.ok(Math.hypot(land.at[0], land.at[2]) > 4, 'beside the bot, not on it');
  assert.ok(ev.got.some((x) => x.type === 'stratagem:grab' && x.id === B.id), 'walked over and took some');
  assert.ok(gun.reserve > 0, `mags in the reserve (${gun.reserve})`);
  assert.ok(!B.health.dead, 'and not under the pod');
});

test('a side\'s call-ins are rationed: two bots seeing the same cluster call one strike between them', () => {
  const w = makeWorld();
  const A = bot(w, 1, 0, v(-2, 0, 0));
  const B = bot(w, 2, 0, v(2, 0, 0));
  cluster(w, 30);
  const ev = events(['stratagem:thrown']);
  w.seconds(8);
  ev.off();
  const strikes = ev.got.filter((x) => (x.id === A.id || x.id === B.id) && STRIKES.has(x.stratagem));
  assert.equal(strikes.length, 1, `one strike (${strikes.map((x) => `${x.id}:${x.stratagem}`).join(', ')})`);
});
