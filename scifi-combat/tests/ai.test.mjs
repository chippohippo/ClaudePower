import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bus } from '../src/core/EventBus.js';
import { profileAbility, ballisticPitch } from '../src/ai/AbilityPlanner.js';
import { makeWorld, v, data } from './harness.mjs';

const ability = (id) => Object.values(data.kits).flatMap((k) => Object.values(k)).find((a) => a.id === id);
const tags = (id) => [...profileAbility(ability(id), 'x').tags];
const listen = (types) => { const got = []; const off = bus.on('*', (t, e) => types.includes(t) && got.push({ t, ...e })); return { got, off }; };

test('planner infers intent from ability data alone', () => {
  assert.ok(tags('solar_charge').includes('gapCloser'));
  assert.ok(tags('aegis_wall').includes('cover'));
  assert.ok(tags('sunwell').includes('heal'));
  assert.ok(tags('mind_lance').includes('interrupt'));
  assert.ok(tags('vortex_grenade').includes('grenade'));
  assert.ok(tags('siphon_tether').includes('tetherEnemy'));
  assert.ok(tags('glare_mine').includes('trap'));
  assert.ok(tags('breach_charge').includes('charge'));
  assert.ok(tags('call_hoverbike').includes('callVehicle'));
  assert.ok(tags('phase_thruster').includes('escape'));
  assert.ok(tags('citadel').includes('dome'));
  assert.ok(tags('daybreak').includes('superMelee'));
  assert.ok(tags('judgment').includes('superGun'));
  assert.ok(tags('siege_frame').includes('superTank'));
  // Every one of the 80 abilities gets at least one usable tag.
  const untagged = Object.values(data.kits).flatMap((k) => Object.entries(k)).filter(([slot, a]) => profileAbility(a, slot).tags.size === 0).map(([, a]) => a.id);
  assert.deepEqual(untagged, []);
});

test('ballistic pitch lands a lobbed grenade on target', () => {
  const v0 = 18, g = 9.8, dx = 15, dy = -0.9;
  const a = ballisticPitch(dx, dy, v0, g);
  const t = dx / (v0 * Math.cos(a));
  const y = v0 * Math.sin(a) * t - 0.5 * g * t * t;
  assert.ok(Math.abs(y - dy) < 0.05);
});

test('a bot acquires, aims (with recoil comp) and damages a target at range', () => {
  const w = makeWorld();
  const A = w.bot(1, 0, v(0, 0, 0), 'lancer');
  const T = w.fighter(2, 1, v(3, 0, -20), 'monolith', { hp: 5000 });
  A.abilities.slots.grenade.charges = 0; A.abilities.slots.grenade.cooldown = 999; // guns only
  w.seconds(5);
  assert.ok(T.health.hp < 5000 - 150, `dealt ${5000 - T.health.hp}`);
});

test('all 20 class kits get used by bots (super charged, mirrored 1v1s)', () => {
  const sol = data.classes[0].classes.map((c) => c.id), vd = data.classes[1].classes.map((c) => c.id);
  const usedBy = new Map();
  for (let i = 0; i < sol.length; i++) {
    const w = makeWorld([{ min: v(-3, 0, -14), max: v(3, 1.8, -13) }]);
    const A = w.bot(1, 0, v(0, 0, 0), sol[i]), B = w.bot(2, 1, v(2, 0, -28), vd[i]);
    A.abilities.superEnergy = 100; B.abilities.superEnergy = 100;
    const off = bus.on('ability:cast', (e) => { const cls = e.id === 1 ? sol[i] : e.id === 2 ? vd[i] : null; if (cls) { if (!usedBy.has(cls)) usedBy.set(cls, new Set()); usedBy.get(cls).add(e.ability); } });
    const off2 = bus.on('entity:death', (e) => { const x = w.world.entity(e.id); if (x && !x.isVehicle && !x.isDeployable) x.health.revive(1); });
    w.seconds(40);
    off(); off2();
  }
  const total = [...usedBy.values()].reduce((n, s) => n + s.size, 0);
  const weak = [...sol, ...vd].filter((c) => (usedBy.get(c)?.size ?? 0) < 2);
  assert.deepEqual(weak, [], 'every class uses at least 2 of its 4 abilities');
  assert.ok(total >= 64, `abilities used: ${total}/80`);
});

test('bots interrupt an enemy cast with crowd control (Psion Mind Lance vs Sunwell)', () => {
  const w = makeWorld();
  const P = w.bot(1, 1, v(0, 0, 0), 'psion', { difficulty: { interruptChance: 1, reactionTime: 0.15 } });
  const L = w.fighter(2, 0, v(0, 0, -7), 'lumen', { hp: 5000 });
  w.aim(L, Math.PI);
  P.abilities.slots.grenade.charges = 0; P.abilities.slots.grenade.cooldown = 999; // the lance is the only CC
  w.seconds(1.5);
  const { got, off } = listen(['ability:interrupted']);
  L.abilities.gainSuper(100); w.press(L, 'super'); w.seconds(1.2);
  off();
  assert.ok(got.some((e) => e.id === 2), 'Sunwell interrupted');
});

test('bots sidestep a telegraphed line (Bulwark Charge) instead of eating the stun', () => {
  let stunned = 0;
  for (let i = 0; i < 3; i++) {
    const w = makeWorld();
    const B = w.fighter(1, 0, v(0, 0, 0), 'bastion');
    const R = w.bot(2, 1, v(0, 0, -7), 'reaver', { difficulty: 'elite', seed: 11 + i });
    w.step(10);
    R.movement.state.position.set(0, 0, -7);
    w.aim(B, 0); w.press(B, 'ability2'); w.seconds(1.2);
    if (R.status.has('stun')) stunned++;
  }
  assert.ok(stunned <= 1, `stunned ${stunned}/3`);
});

test('bots walk out of an arming orbital strike', () => {
  const w = makeWorld();
  const R = w.bot(2, 1, v(0, 0, -20), 'monolith');
  w.fighter(1, 0, v(0, 0, 40), 'breacher');
  w.world.spawnZone({ ownerId: 1, team: 0, ability: 'orbital_lance', center: v(0, 0, -20), radius: 6, delay: 3, lifetime: 1, burst: 600 });
  w.seconds(3);
  const d = Math.hypot(R.movement.state.position.x, R.movement.state.position.z + 20);
  assert.ok(d > 6, `left the zone (distance from centre ${d.toFixed(1)})`);
});

test('hurt support bots heal; shot anchors raise cover', () => {
  const w = makeWorld();
  const L = w.bot(1, 0, v(0, 0, 0), 'lumen');
  w.fighter(9, 1, v(0, 0, -60), 'monolith');
  L.health.hp = 40; L.health.shield = 0;
  w.seconds(3);
  assert.ok(L.health.hp > 60, `healed to ${L.health.hp}`);

  const w2 = makeWorld();
  const B = w2.bot(1, 0, v(0, 0, 0), 'bastion');
  const G = w2.fighter(2, 1, v(0, 0, -25), 'reaver', { hp: 5000 });
  const { got, off } = listen(['deployable:spawn']);
  w2.aimAt(G, v(0, 1.2, 0)); w2.hold(G, 'light');
  for (let i = 0; i < 240; i++) { if (G.weapons.current.mag === 0) w2.press(G, 'reload'); w2.step(1); }
  off();
  assert.ok(got.some((e) => e.kind === 'wall' && e.owner === 1), 'Aegis Wall raised under fire');
  assert.ok(B);
});

test('Breacher bot plants a charge and detonates it when an enemy is in range', () => {
  const w = makeWorld();
  const A = w.bot(1, 0, v(0, 0, 0), 'breacher');
  const E = w.fighter(2, 1, v(0, 0, -8), 'monolith', { hp: 5000 });
  for (const k of ['ability2', 'grenade']) { A.abilities.slots[k].charges = 0; A.abilities.slots[k].cooldown = 999; }
  const { got, off } = listen(['ability:recast']);
  w.seconds(6);
  off();
  assert.ok(got.some((e) => e.id === 1 && e.ability === 'breach_charge'));
  assert.ok(E.health.hp < 5000);
});

test('vehicle bots board a tank, hold standoff range and shell the target', () => {
  const w = makeWorld();
  const A = w.bot(1, 0, v(0, 0, 0), 'skyrider');
  A.abilities.slots.ability2.charges = 0; A.abilities.slots.ability2.cooldown = 999;
  const T = w.fighter(2, 1, v(0, 0, -70), 'monolith', { hp: 99999 });
  w.world.vehicles.spawn('solari_lancer_tank', 0, v(10, 0, 8));
  w.seconds(30);
  assert.equal(A.vehicle?.veh.type, 'solari_lancer_tank');
  assert.ok(99999 - T.health.hp > 500, `tank dealt ${99999 - T.health.hp}`);
  const d = A.movement.state.position.distanceTo(T.movement.state.position);
  assert.ok(d > 12 && d < 45, `standoff ${d.toFixed(1)} m`);
});

test('support bots take the gunner seat of a friendly-driven tank and fire', () => {
  const w = makeWorld();
  const D = w.fighter(1, 0, v(0, 0, 0), 'bastion');
  const tank = w.world.vehicles.spawn('solari_lancer_tank', 0, v(0, 0, -3));
  w.press(D, 'interact'); w.step(1);
  const S = w.bot(3, 0, v(6, 0, 4), 'lumen');
  const T = w.fighter(2, 1, v(0, 0, -40), 'monolith', { hp: 99999 });
  w.seconds(12);
  assert.equal(S.vehicle?.veh, tank);
  assert.equal(tank.seats[S.vehicle.seat].def.role, 'gunner');
  assert.ok(T.health.hp < 99999, 'gunner fired at the target');
});

test('bots bail out of a burning vehicle', () => {
  const w = makeWorld();
  const A = w.bot(1, 0, v(0, 0, 0), 'skyrider');
  const tank = w.world.vehicles.spawn('solari_lancer_tank', 0, v(0, 0, -3));
  const G = w.fighter(2, 1, v(0, 0, -30), 'reaver', { hp: 99999 });
  w.seconds(3);
  assert.equal(A.vehicle?.veh, tank);
  tank.health.hp = tank.health.max * 0.15;
  w.aimAt(G, tank.movement.state.position.clone().setY(1)); w.hold(G, 'light');
  for (let i = 0; i < 180 && A.vehicle; i++) { if (G.weapons.current.mag === 0) w.press(G, 'reload'); w.step(1); }
  assert.equal(A.vehicle, null, 'bailed');
});

test('opportunistic bots do not leave a close fight to fetch a vehicle', () => {
  const w = makeWorld();
  const A = w.bot(1, 0, v(0, 0, 0), 'lancer');
  w.fighter(2, 1, v(0, 0, -6), 'monolith', { hp: 99999 });
  w.world.vehicles.spawn('solari_hoverbike', 0, v(15, 0, 10));
  w.seconds(4);
  assert.equal(A.vehicle ?? null, null);
});
