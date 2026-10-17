// Extreme Warfront: 200v200 on the 2.6 km map, the whole battle running (squads, crews, convoys,
// artillery, nav repairs, LOD) the way the browser runs it: one player's camera as the focus.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bus } from '../src/core/EventBus.js';
import { FrontlineSession } from '../src/game/FrontlineSession.js';
import { data as H } from './harness.mjs';

const sessionData = {
  movement: H.movement, weaponFiles: [H.ballistic, H.energy], attachments: H.attachments, recoil: H.recoil, statuses: H.statuses,
  meleeWeapons: H.melee, kits: H.kits, classes: H.classes, damageMatrix: H.matrix, supers: H.supers, vehicleDefs: H.vehicles,
  personalities: H.ai.personalities, difficulty: H.ai.difficulty.veteran, down: H.down,
};

test('Extreme Warfront: 400 soldiers, crewed batteries and convoys fight a 200v200 battle within a tick budget', () => {
  const t0 = performance.now();
  const s = new FrontlineSession(sessionData, { players: 400, seed: 7, humans: [{ id: 1, team: 0, classId: 'lancer' }] });
  const build = performance.now() - t0;
  assert.equal(s.size, '200v200');
  assert.equal(s.fighters.length, 400);
  assert.ok(s.map.nav.big, 'a big nav grid (fields built in the background)');
  const me = s.fighters.find((f) => f.id === 1);
  const crews = s.fighters.filter((f) => f.duty);
  assert.ok(crews.length >= 60, `${crews.length} gun crews and drivers`);
  const ev = { death: 0, hit: 0, fire: 0, whistle: 0, mission: 0 };
  const offs = [
    bus.on('entity:death', () => ev.death++), bus.on('weapon:hit', () => ev.hit++), bus.on('gun:fire', () => ev.fire++),
    bus.on('squad:whistle', () => ev.whistle++), bus.on('support:mission', () => ev.mission++),
  ];
  let total = 0, n = 0, thinks0 = 0;
  const secs = 45;
  for (let i = 0; i < secs * 60; i++) {
    s.focus[0] = me.movement.state.position;
    s.step(1 / 60);
    if (i === 120) thinks0 = s.stats.thinks;
    if (i > 120) { total += s.stats.simMs; n++; }
  }
  offs.forEach((f) => f());
  const avg = total / n, thinksPerTick = (s.stats.thinks - thinks0) / n;
  assert.ok(ev.death >= 10 && ev.hit >= 200, `a battle: ${ev.death} deaths, ${ev.hit} hits`);
  assert.ok(ev.fire >= 20 && ev.mission >= 4, `the batteries fire (${ev.fire} rounds, ${ev.mission} missions)`);
  assert.ok(ev.whistle >= 1, 'someone went over the top');
  // LOD: far from the camera bots think every 4th or 6th tick and move at 30 Hz.
  assert.ok(thinksPerTick < 150, `${thinksPerTick.toFixed(0)} thinks per tick`);
  // Every field anyone asked for got built (nothing left waiting in the queue).
  assert.ok(s.map.nav.pending.size <= 2, `${s.map.nav.pending.size} fields still queued`);
  // ~6 ms a tick on a desktop; generous here (CI machines, tests in parallel).
  assert.ok(avg < 25, `${avg.toFixed(2)} ms per tick`);
  assert.ok(build < 8000, `built in ${build.toFixed(0)} ms`);
  s.dispose();
});
