// Frontline mode: capture rules, the moving front, victory conditions, spawns, the commander,
// and a short headless battle with 64 bots.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { bus } from '../src/core/EventBus.js';
import { generateFrontlineMap } from '../src/game/frontline/FrontlineMap.js';
import { FrontlineMode } from '../src/game/frontline/FrontlineMode.js';
import { FrontlineCommander, Squad } from '../src/ai/FrontlineCommander.js';
import { FrontlineSession } from '../src/game/FrontlineSession.js';
import { data as H } from './harness.mjs';

const map = generateFrontlineMap({ seed: 21 });
const soldier = (team, p) => ({ team, movement: { state: { position: p.clone() } }, health: { dead: false } });
const run = (mode, fighters, seconds) => { for (let i = 0; i < Math.round(seconds * 60); i++) mode.update(1 / 60, fighters); };
const middle = (mode) => mode.points.filter((p) => p.sector === 3);

test('only the attacked sectors can be captured; everything behind the lines is locked', () => {
  const mode = new FrontlineMode(map);
  assert.deepEqual(mode.front, [2, 4]);
  assert.equal(mode.attackSector(0), 3); assert.equal(mode.attackSector(1), 3);
  for (const p of mode.points) assert.equal(mode.capturable(p), p.sector === 3, p.name);
  // A Void soldier standing on a Solari point behind the line does nothing.
  const locked = mode.points.find((p) => p.sector === 2);
  run(mode, [soldier(1, locked.pos)], 30);
  assert.equal(locked.owner, 0); assert.equal(locked.progress, 1);
});

test('capture timing: one soldier takes a neutral point in captureTime, numbers help, defenders cancel', () => {
  const mode = new FrontlineMode(map, { captureTime: 10 });
  const [a, b] = middle(mode);
  run(mode, [soldier(0, a.pos)], 9.8);
  assert.equal(a.owner, -1, 'not yet');
  run(mode, [soldier(0, a.pos)], 0.3);
  assert.equal(a.owner, 0, 'taken in ~10 s');
  // Three attackers on the enemy's point: neutralize then capture in 2/3 of 10 s.
  run(mode, [soldier(1, b.pos), soldier(1, b.pos), soldier(1, b.pos)], 3.4);
  assert.equal(b.owner, 1, 'three soldiers: 3.3 s');
  // Equal numbers: contested, frozen.
  const before = b.progress;
  run(mode, [soldier(0, b.pos), soldier(1, b.pos)], 5);
  assert.ok(b.contested && b.progress === before, 'contested points freeze');
  // An enemy point must be neutralized first: one soldier needs twice as long.
  run(mode, [soldier(0, b.pos)], 10.2);
  assert.equal(b.owner, -1, 'neutralized after 10 s');
  run(mode, [soldier(0, b.pos)], 10.2);
  assert.equal(b.owner, 0, 'captured after 20 s');
});

test('owning every point of the attacked sector moves the front; points behind it lock', () => {
  const mode = new FrontlineMode(map, { captureTime: 2, secureTime: 3, sectorBonus: 30 });
  const events = [];
  const off = bus.on('mode:sector', (e) => events.push(e));
  const squad = middle(mode).map((p) => soldier(0, p.pos));
  run(mode, squad, 2.1);
  assert.ok(middle(mode).every((p) => p.owner === 0));
  assert.deepEqual(mode.front, [2, 4], 'not until it has been held for secureTime');
  run(mode, squad, 3.1);
  off();
  assert.deepEqual(mode.front, [3, 4], 'Solari line moves into the middle sector');
  assert.equal(events.length, 1);
  assert.equal(mode.tickets[0], mode.cfg.tickets + 30, 'reinforcements for taking a sector');
  assert.equal(mode.attackSector(0), 4, 'now attacking the Void front');
  assert.equal(mode.attackSector(1), 3, 'Void attacks the sector it just lost');
  // A half-captured point behind the new line snaps back to its sector's owner.
  const m2 = new FrontlineMode(map, { captureTime: 2, secureTime: 1 });
  const solariFront = m2.points.find((p) => p.sector === 2);
  m2.front[1] = 3; m2.sectors[3].owner = 1; // Void holds the middle: Void attacks sector 2
  run(m2, [soldier(1, solariFront.pos)], 1.2);
  assert.ok(solariFront.progress < 1 && solariFront.progress > -1);
  // Solari now takes the middle back: sector 2 is no longer attacked, its point locks to Solari.
  for (const p of m2.points.filter((q) => q.sector === 3)) { p.owner = 0; p.progress = 1; }
  run(m2, [], 1.1);
  assert.equal(m2.front[0], 3);
  assert.equal(solariFront.owner, 0); assert.equal(solariFront.progress, 1);
});

test('victory: breaking through to the HQ, or running the enemy out of tickets', () => {
  const mode = new FrontlineMode(map, { captureTime: 1, secureTime: 0.5 });
  const won = [];
  const off = bus.on('mode:victory', (e) => won.push(e));
  for (let sector = 3; sector <= 5 && mode.winner < 0; sector++) {
    const pts = mode.points.filter((p) => p.sector === sector);
    run(mode, pts.flatMap((p) => [soldier(0, p.pos), soldier(0, p.pos), soldier(0, p.pos)]), 3);
  }
  off();
  assert.equal(mode.winner, 0);
  assert.equal(mode.reason, 'breakthrough');
  assert.deepEqual(won.map((e) => e.reason), ['breakthrough']);
  const m2 = new FrontlineMode(map, { tickets: 3 });
  m2.onDeath(1); m2.onDeath(1);
  assert.equal(m2.winner, -1);
  m2.onDeath(1);
  assert.equal(m2.winner, 0); assert.equal(m2.reason, 'tickets');
});

test('spawns follow the front and avoid hot spawns', () => {
  const mode = new FrontlineMode(map);
  const front = map.sectors[mode.front[0]];
  const p = mode.spawnPosition(0, () => false);
  assert.ok(front.spawns[0].some((s) => s.distanceTo(p) < 6), 'forward group of the front sector');
  const hotFwd = (q) => front.spawns[0].some((s) => s.distanceTo(q) < 1);
  const q = mode.spawnPosition(0, hotFwd);
  assert.ok(front.rearSpawns[0].some((s) => s.distanceTo(q) < 6), 'rear group when the forward one is hot');
  const hotSector = (r) => [...front.spawns[0], ...front.rearSpawns[0]].some((s) => s.distanceTo(r) < 1);
  const r = mode.spawnPosition(0, hotSector);
  assert.ok(r.x < front.x0, 'falls back a sector when the whole front sector is hot');
});

test('the commander covers every attack point and reinforces a point being taken', () => {
  const mode = new FrontlineMode(map);
  const mk = (n) => Array.from({ length: n }, (_, i) => ({ id: i, brain: {}, health: { dead: false }, movement: { state: { position: map.hq[0].clone() } } }));
  const squads = Array.from({ length: 6 }, (_, i) => new Squad(0, i, mk(4)));
  const cmd = new FrontlineCommander(0, mode, { nav: map.nav });
  cmd.squads = squads;
  cmd.update(0);
  const targets = new Set(squads.map((s) => s.objective));
  for (const p of middle(mode)) assert.ok(targets.has(p.id), `attack point ${p.name} has a squad`);
  assert.ok(squads.every((s) => s.members.every((m) => m.brain.objective?.id === s.objective)), 'orders reach every member');
  // Void takes the middle; then Void soldiers start taking a Solari front point: it gets defenders.
  mode.front[1] = 3; mode.sectors[3].owner = 1;
  for (const p of middle(mode)) { p.owner = 1; p.progress = -1; }
  const target = mode.points.find((p) => p.sector === 2);
  target.counts[1] = 3; target.progress = 0.2;
  cmd.update(5);
  assert.ok(squads.filter((s) => s.objective === target.id && s.role === 'defend').length >= 2, 'point under attack gets at least two squads');
  cmd.dispose();
});

test('headless battle: 64 bots fight over the line, capture points, die and reinforce', (t) => {
  const data = {
    movement: H.movement, weaponFiles: [H.ballistic, H.energy], attachments: H.attachments, recoil: H.recoil, statuses: H.statuses,
    meleeWeapons: H.melee, kits: H.kits, classes: H.classes, damageMatrix: H.matrix, supers: H.supers, vehicleDefs: H.vehicles,
    personalities: H.ai.personalities, difficulty: H.ai.difficulty.veteran, down: H.down,
  };
  const s = new FrontlineSession(data, { players: 64, seed: 3 });
  const ev = { point: 0, deploy: 0, hit: 0 };
  const offs = [bus.on('mode:point', () => ev.point++), bus.on('fighter:deploy', () => ev.deploy++), bus.on('weapon:hit', () => ev.hit++)];
  // Navigation: how fast bots close the route distance to their objective while en route (orders
  // change as sectors fall, and many die on the way, so "who got there" alone is noisy), plus how
  // many reached their current objective at some point.
  const nav = s.map.nav, last = new Map(), reached = new Set();
  let total = 0, gained = 0, enRoute = 0;
  const steps = 60 * 65;   // the opening barrage holds the first wave back ~12 s
  for (let i = 0; i < steps; i++) {
    s.step(1 / 60); if (i > 0) total += s.stats.simMs;
    if (i % 30 !== 0) continue;
    for (const f of s.bots) {
      const o = f.brain.objective, p = f.movement.state.position;
      if (!o || f.health.dead) { last.delete(f.id); continue; }
      if (p.distanceTo(o.pos) < o.radius + 8) reached.add(f.id);
      // Waiting in the jump-off trench for the whistle (and its barrage) is an order, not a route.
      if (f.squad?.tactics?.phase === 'jumpoff') { last.delete(f.id); continue; }
      const route = nav.distance(nav.fields.get(o.field), p.x, p.z), prev = last.get(f.id);
      if (prev && prev.id === o.id && prev.route > o.radius * 1.8 && Number.isFinite(route + prev.route)) { gained += prev.route - route; enRoute += 0.5; }
      last.set(f.id, { id: o.id, route });
    }
  }
  const closing = gained / enRoute;
  offs.forEach((f) => f());
  const avg = total / (steps - 1);
  // The sim is deterministic per seed (seeded bot RNGs, work-budgeted nav), so these numbers repeat.
  t.diagnostic(`closing on objectives at ${closing.toFixed(2)} m/s en route, ${reached.size}/${s.bots.length} reached one, ${ev.point} point flips, ${ev.hit} hits, ${ev.deploy} redeploys, ${avg.toFixed(2)} ms/tick`);
  for (const f of s.fighters) { const p = f.movement.state.position; assert.ok(Number.isFinite(p.x + p.y + p.z), 'finite positions'); }
  assert.ok(closing > 2, `bots close on their objectives at ${closing.toFixed(2)} m/s en route (jog is 4.5)`);
  assert.ok(reached.size >= s.bots.length * 0.3, `${reached.size}/${s.bots.length} bots reached their objective point`);
  assert.ok(ev.point >= 1, 'points change hands');
  assert.ok(ev.hit > 50, `a real fight (${ev.hit} hits)`);
  assert.ok(ev.deploy >= 5, `the dead come back as reinforcements (${ev.deploy} redeploys)`);
  assert.ok(s.mode.tickets[0] < s.mode.cfg.tickets + 30 || s.mode.tickets[1] < s.mode.cfg.tickets + 30, 'deaths cost tickets');
  assert.ok(avg < 8, `${avg.toFixed(2)} ms per tick for 64 fighters`);
  s.dispose();
});
