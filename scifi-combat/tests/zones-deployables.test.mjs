import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bus } from '../src/core/EventBus.js';
import { makeWorld, v } from './harness.mjs';

const events = (types) => { const got = []; const off = bus.on('*', (t, e) => types.includes(t) && got.push({ t, e })); return { got, off }; };

test('turret tracks at its turn rate, damages enemies, and enemies can destroy it', () => {
  const { world, fighter, press, step, seconds, aimAt } = makeWorld();
  const A = fighter(1, 0, v(0, 0, 0), 'artificer');
  const B = fighter(2, 1, v(10, 0, -10), 'monolith');
  press(A, 'ability1'); seconds(1);
  const tur = world.deployables.list.find((d) => d.kind === 'turret');
  assert.ok(tur, 'turret placed');
  seconds(2);
  assert.ok(B.health.hp < 200, 'turret damaged the enemy');
  // Enemy tap-fires at the turret core (as a player would, letting recoil reset) until it breaks.
  aimAt(B, tur.movement.state.position.clone().setY(1.0));
  for (let i = 0; i < 1200 && !tur.removed; i++) { if (B.weapons.current.mag === 0) press(B, 'reload'); else if (i % 12 === 0) press(B, 'light'); step(); }
  assert.ok(tur.removed, 'turret destroyed by gunfire');
});

test('Aegis Wall blocks hitscan both ways and its emitter strip counts as a headshot', () => {
  const { world, fighter, press, seconds } = makeWorld();
  fighter(1, 0, v(0, 0, 0), 'bastion');
  fighter(2, 1, v(0, 0, -12), 'monolith');
  press(world.entity(1), 'ability1'); seconds(1);
  assert.equal(world.raycast(v(0, 1.6, 0), v(0, 0, -1), 50, 1).entity.kind, 'wall');
  assert.equal(world.raycast(v(0, 1.6, -12), v(0, 0, 1), 50, 2).entity.kind, 'wall');
  assert.equal(world.raycast(v(0, 0.2, 0), v(0, 0, -1), 50, 1).zone, 'head');
});

test('Citadel dome blocks enemy rays from outside but not allied rays', () => {
  const { world, fighter, press, seconds } = makeWorld();
  const A = fighter(1, 0, v(0, 0, 0), 'bastion');
  fighter(2, 1, v(0, 0, -20), 'monolith');
  A.abilities.gainSuper(100); press(A, 'super'); seconds(1.5);
  assert.equal(world.raycast(v(0, 1.6, -20), v(0, 0, 1), 40, 2).surface, 'dome');
  assert.equal(world.raycast(v(0, 1.6, 0), v(0, 0, -1), 40, 1).entity?.id, 2);
});

test('Gravity Anchor stacks Slow into Stun; Singularity pulls toward its centre', () => {
  const { world, fighter, press, aim, seconds } = makeWorld();
  const M = fighter(2, 1, v(0, 0, -10), 'monolith');
  const A = fighter(1, 0, v(0, 0, -4), 'lancer');
  aim(M, Math.PI, -0.35); press(M, 'ability1'); seconds(3.6);
  assert.ok(A.status.has('stun'), `expected stun, got ${[...A.status.active.keys()]}`);
  const d0 = A.movement.state.position.distanceTo(M.movement.state.position);
  M.abilities.gainSuper(100); press(M, 'super'); seconds(2.5);
  assert.ok(A.movement.state.position.distanceTo(M.movement.state.position) < d0 - 1, 'pulled at least 1 m');
});

test('Breach Charge recast damages, destroys cover, and a defused charge fizzles', () => {
  const cover = [{ min: v(-1, 0, -6), max: v(1, 1.5, -5), destructible: true }];
  const { world, fighter, press, seconds } = makeWorld(cover);
  const A = fighter(1, 0, v(0, 0, 0), 'breacher');
  const B = fighter(2, 1, v(0, 0, -7), 'monolith');
  press(A, 'ability1'); seconds(0.6);
  const ch = world.deployables.list.find((d) => d.kind === 'charge');
  assert.ok(ch && ch.movement.state.position.y < 1.6, 'charge stuck to cover or floor');
  press(A, 'ability1'); seconds(0.2);
  assert.equal(cover.length, 0, 'cover destroyed');
  assert.ok(B.health.hp < 200);

  const { got, off } = events(['ability:fizzle']);
  A.abilities.slots.ability1.charges = 1; A.abilities.slots.ability1.cooldown = 0;
  press(A, 'ability1'); seconds(0.6);
  world.deployables.list.find((d) => d.kind === 'charge').health.damage(5, {}, B); seconds(0.1);
  press(A, 'ability1'); seconds(0.1);
  off();
  assert.equal(got.length, 1, 'recast on a defused charge fizzles');
});

test('Glare Mine arms, leaks a proximity cue, then blinds and reveals', () => {
  const { world, fighter, press, seconds } = makeWorld();
  const A = fighter(1, 0, v(0, 0, 0), 'veil');
  const B = fighter(2, 1, v(0, 0, -40), 'monolith');
  press(A, 'grenade'); seconds(1.5);
  const mine = world.deployables.list.find((d) => d.kind === 'mine');
  assert.ok(mine.armed);
  const { got, off } = events(['deployable:proximity']);
  B.movement.state.position.copy(mine.movement.state.position).add(v(5, 0, 0)); seconds(1);
  assert.ok(got.length > 0, 'enemies nearby hear the mine');
  B.movement.state.position.copy(mine.movement.state.position).add(v(2, 0, 0)); seconds(0.1);
  off();
  assert.ok(B.status.has('blind') && B.status.has('revealed'));
});

test('Orbital Lance arms with a readable delay, reports a threat vector, then hits', () => {
  const { world, fighter, press, aim, seconds } = makeWorld();
  const A = fighter(1, 0, v(0, 0, 0), 'breacher');
  const B = fighter(2, 1, v(1, 0, -20), 'monolith');
  A.abilities.gainSuper(100); aim(A, 0, -0.08); press(A, 'super'); seconds(1);
  const orb = world.zones.zones.find((z) => z.burst);
  assert.equal(orb.phase, 'arming');
  B.movement.state.position.copy(orb.center).add(v(1, 0, 0));
  assert.ok(world.zones.threatAt(B.movement.state.position, 1).length() > 0, 'AI can see it must move');
  seconds(3);
  assert.ok(B.health.hp < 200 || B.health.dead);
});

test('Siphon Tether drains an enemy, heals the caster, and breaks behind cover', () => {
  const cover = [];
  const { world, fighter, press, seconds } = makeWorld(cover);
  const A = fighter(1, 0, v(0, 0, 0), 'mender');
  const B = fighter(2, 1, v(0, 0, -8), 'monolith');
  A.health.hp = 100;
  press(A, 'ability1'); seconds(1.5);
  assert.ok(A.health.hp > 100 && B.health.hp < 200);
  const { got, off } = events(['zone:tetherBreak']);
  cover.push({ min: v(-2, 0, -5), max: v(2, 3, -4) }); seconds(0.3);
  off();
  assert.equal(got.length, 1);
});

test('Grav Lift launches allies; Rally Beacon hastes allies in its aura', () => {
  const { world, fighter, press, seconds } = makeWorld();
  const R = fighter(1, 0, v(0, 0, 0), 'rigger');
  press(R, 'ability2'); seconds(0.8);
  const pad = world.deployables.list.find((d) => d.kind === 'launchpad');
  R.movement.state.position.copy(pad.movement.state.position); seconds(0.05);
  assert.equal(R.movement.state.mode, 'air');
  assert.ok(R.movement.state.velocity.y > 8);

  const L = fighter(3, 0, v(10, 0, 0), 'lumen');
  press(L, 'ability2'); seconds(0.8);
  assert.ok(L.status.has('haste'));
});

test('Vortex Grenade spawns its pull zone on impact; Cluster Charge splits into bomblets', () => {
  const { world, fighter, press, aim, seconds } = makeWorld();
  const A = fighter(1, 0, v(0, 0, 0), 'reaver');
  const { got, off } = events(['zone:start', 'projectile:cluster']);
  aim(A, 0, -0.2); press(A, 'grenade'); seconds(2);
  const C = fighter(3, 0, v(20, 0, 0), 'breacher');
  aim(C, 0, -0.2); press(C, 'grenade'); seconds(2);
  off();
  assert.ok(got.some((g) => g.t === 'zone:start' && g.e.ability === 'vortex_grenade'));
  assert.ok(got.some((g) => g.t === 'projectile:cluster'));
});

test('per-owner limits replace the oldest deployable', () => {
  const { world, fighter } = makeWorld();
  fighter(1, 0, v(0, 0, 0), 'bastion');
  world.spawnDeployable({ ownerId: 1, team: 0, kind: 'wall', width: 4, height: 2, hp: 100, lifetime: 30, at: v(0, 0, -3), yaw: 0 });
  world.spawnDeployable({ ownerId: 1, team: 0, kind: 'wall', width: 4, height: 2, hp: 100, lifetime: 30, at: v(5, 0, -3), yaw: 0 });
  assert.equal(world.deployables.list.filter((d) => !d.removed).length, 1);
});
