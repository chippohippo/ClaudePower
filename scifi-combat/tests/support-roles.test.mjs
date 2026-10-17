// Support roles (src/combat/SupportItems.js, src/combat/Passives.js, src/ai/ItemPlanner.js,
// data/support.json, data/passives.json, docs/GAMEPLAY_PLAN.md §5): medics' stims, engineers'
// ammo packs and repairs, and the twenty class passives; bots use the items with the same key.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { bus } from '../src/core/EventBus.js';
import { makeWorld, v, DT, data } from './harness.mjs';
import { ARROW_KEYS } from '../src/combat/Stratagems.js';

const S = data.support, P = data.passives.passives;
const until = (w, cond, max = 600) => { for (let i = 0; i < max && !cond(); i++) w.step(1); };
const face = (w, e, at) => w.aimAt(e, at.clone().setY(1.2));
const blast = { id: 'test_blast', damage: { base: 120 }, ammoType: 'explosive', knockback: 22 };
const sword = (dmg = 30) => ({ damage: dmg, poise: 0, guardDmg: 10, parryable: true });

function events(names) {
  const got = [];
  const offs = names.map((n) => bus.on(n, (e) => got.push({ type: n, ...e })));
  return { got, off: () => offs.forEach((f) => f()) };
}

// ---------------------------------------------------------------- items
test('a stim: the teammate you face heals 60 over 2 s; facing away, it\'s yours', () => {
  const w = makeWorld();
  const M = w.fighter(1, 0, v(0, 0, 0), 'mender', { role: 'medic' });     // (no Triage aura to muddy the numbers)
  const T = w.fighter(2, 0, v(0, 0, -1.8), 'lancer', { hp: 200 });
  assert.equal(M.items.kind, 'stim'); assert.equal(M.items.left, S.items.medic.count);
  T.health.hp = 100;
  face(w, M, T.movement.state.position);
  w.step(2);
  w.press(M, 'item'); w.step(1);
  assert.equal(M.items.left, S.items.medic.count - 1, 'one used');
  w.seconds(S.stim.over + 0.1);
  assert.ok(Math.abs(T.health.hp - (100 + S.stim.heal)) < 2, `healed ${S.stim.heal} (${T.health.hp.toFixed(1)})`);
  // Facing away from him and hurt: the stim is the medic's own.
  M.health.hp = 120;
  w.aim(M, Math.PI); w.step(Math.ceil(S.stim.cooldown / DT) + 2);
  w.press(M, 'item'); w.seconds(S.stim.over + 0.1);
  assert.ok(M.health.hp > 175, `his own (${M.health.hp.toFixed(0)})`);
});

test('a stim gets a downed teammate up in a second at 60%, the bleed paused, the medic on his feet', () => {
  const w = makeWorld([], { down: true });
  const enemy = w.fighter(9, 1, v(0, 0, 60), 'lancer');
  const M = w.fighter(1, 0, v(0, 0, 0), 'lumen', { role: 'medic' });
  const T = w.fighter(2, 0, v(0, 0, -2), 'lancer', { hp: 100 });
  T.health.damage(110, { kind: 'gun' }, enemy);
  until(w, () => T.movement.state.downed);
  M.movement.reset(T.movement.state.position.clone().add(v(0, 0, 1.6)), 0);
  face(w, M, T.movement.state.position);
  w.step(2);
  const bleed = T.health.bleed;
  w.press(M, 'item'); w.step(1);
  w.seconds(S.stim.reviveTime * 0.5);
  assert.ok(T.health.downed, 'not instantly');
  assert.ok(Math.abs(T.health.bleed - bleed) < 0.05, 'no bleeding meanwhile');
  assert.notEqual(M.movement.state.stance, 'crouch', 'the medic didn\'t kneel');
  w.seconds(S.stim.reviveTime * 0.5 + 0.1);
  assert.equal(T.health.downed, false, 'up');
  assert.ok(Math.abs(T.health.hp - 100 * S.stim.reviveHp) < 1e-6, `at ${S.stim.reviveHp * 100}%`);
});

test('an ammo pack: teammates short of a mag take two each as they pass; it pays its engineer', () => {
  const w = makeWorld([], { bp: true });
  const E = w.fighter(1, 0, v(0, 0, 0), 'artificer', { role: 'engineer' });
  assert.equal(E.items.kind, 'ammo');
  w.press(E, 'item'); w.step(1);
  assert.equal(w.world.support.packs.length, 1, 'down at his feet');
  E.movement.state.position.set(10, 0, 0);
  const T = w.fighter(2, 0, v(6, 0, 0), 'lancer');
  const gun = T.weapons.current;
  gun.reserve = 0;
  T.movement.state.position.set(0.8, 0, 0); w.step(2);
  assert.ok(gun.reserve >= (gun.s.mag ?? 30) * S.ammo.mags - 1, `two mags (${gun.reserve})`);
  assert.equal(E.bp?.points, data.battlePoints.earn.resupply * S.ammo.mags, 'and the engineer is paid');
  const before = gun.reserve; w.step(5);
  assert.equal(gun.reserve, before, 'once each');
});

test('repairs: an engineer holding the dig key at a damaged friendly vehicle mends it, 50 a second', () => {
  const w = makeWorld();
  const E = w.fighter(1, 0, v(0, 0, 0), 'artificer', { role: 'engineer' });
  const tank = w.world.vehicles.spawn('solari_lancer_tank', 0, v(0, 0, -6));
  const foe = w.world.vehicles.spawn('void_crawler_tank', 1, v(0, 0, 9));
  tank.health.hp = 1000; foe.health.hp = 1000;
  E.movement.state.position.set(0, 0, -6 + (tank.def.radius ?? 2) + 1.2);              // at its hull
  w.hold(E, 'dig'); w.seconds(2);
  w.release(E, 'dig'); w.step(1);
  assert.ok(Math.abs(tank.health.hp - (1000 + 2 * S.repair.rate)) < 3, `mended (${tank.health.hp.toFixed(0)})`);
  assert.equal(foe.health.hp, 1000, 'the enemy\'s is left alone');
  const L = w.fighter(2, 0, tank.movement.state.position.clone().add(v(0, 0, (tank.def.radius ?? 2) + 1.2)), 'lancer', { role: 'assault' });
  w.hold(L, 'dig'); w.seconds(1); w.release(L, 'dig');
  assert.ok(tank.health.hp < 1000 + 2 * S.repair.rate + 5, 'only engineers repair');
});

test('a supply pod refills the items', () => {
  const w = makeWorld();
  const M = w.fighter(1, 0, v(0, 0, 0), 'lumen', { role: 'medic' });
  M.items.left = 0;
  const ev = events(['stratagem:beacon', 'stratagem:land']);
  w.hold(M, 'stratagem'); for (const ch of 'DDUR') { w.press(M, ARROW_KEYS[ch]); w.step(4); } w.release(M, 'stratagem'); w.step(1);
  w.aim(M, 0, -0.1); w.press(M, 'light');
  w.seconds(7);
  ev.off();
  const [x, , z] = ev.got.find((e) => e.type === 'stratagem:beacon').at;
  M.movement.state.position.set(x + 1.2, 0, z);
  w.press(M, 'interact'); w.step(2);
  assert.equal(M.items.left, M.items.max);
});

// ---------------------------------------------------------------- passives
test('every class has a passive with its numbers', () => {
  for (const f of data.classes) for (const c of f.classes) assert.ok(P[c.passive.id], `${c.id}: ${c.passive.id}`);
});

test('momentum: a takedown tops up stamina and quickens you; triage: the squad heals and revives come faster', () => {
  const w = makeWorld([], { down: true });
  const A = w.fighter(1, 0, v(0, 0, 0), 'lancer');
  const B = w.fighter(2, 1, v(0, 0, -20), 'lancer', { hp: 100 });
  A.movement.state.stamina = 10;
  B.health.damage(110, { kind: 'gun' }, A);
  assert.ok(A.movement.state.stamina >= 10 + P.momentum.takedown.stamina - 0.01, 'stamina back');
  assert.ok(A.status.has('momentum') && A.status.speedMul > 1.05, 'and a burst of speed');
  // Triage.
  const M = w.fighter(3, 0, v(5, 0, 5), 'lumen', { role: 'medic' });
  const T = w.fighter(4, 0, v(7, 0, 5), 'lancer', { hp: 200 });
  T.health.hp = 100;
  w.seconds(2.05);
  assert.ok(T.health.hp >= 100 + 2 * P.triage.aura.hps - 0.01, `the aura (${T.health.hp})`);
  const R = w.fighter(5, 0, v(20, 0, 0), 'lancer', { hp: 100 });
  R.health.damage(110, { kind: 'gun' }, B);
  until(w, () => R.movement.state.downed);
  M.movement.reset(R.movement.state.position.clone().add(v(0.9, 0, 0)), 0);
  w.hold(M, 'interact');
  w.seconds(data.down.medicReviveTime / P.triage.mods.reviveRate + 0.1);
  assert.equal(R.health.downed, false, 'a medic with Triage revives faster still');
});

test('unshakable: no flinch behind a shield over half; blast-proof and mass shrug off their own blasts and the throw', () => {
  const w = makeWorld();
  const U = w.fighter(1, 0, v(0, 0, 0), 'bastion', { hp: 5000 });
  const N = w.fighter(2, 0, v(10, 0, 0), 'lancer', { hp: 5000 });
  for (const f of [U, N]) { f.mode = 'gun'; f.health.maxShield = f.health.shield = 100; }
  w.step(5);
  const p0 = U.weapons.weaponPitch, q0 = N.weapons.weaponPitch;
  U.weapons.flinch(60); N.weapons.flinch(60);
  assert.equal(U.weapons.weaponPitch, p0, 'unshaken');
  assert.ok(N.weapons.weaponPitch > q0, 'the other flinched');
  U.health.shield = 20; U.weapons.flinch(60);
  assert.ok(U.weapons.weaponPitch > p0, 'shield down: he flinches too');
  // Blast-proof: half the self damage of anyone else's own blast.
  const B = w.fighter(3, 0, v(30, 0, 0), 'breacher', { hp: 5000 });
  const C = w.fighter(4, 0, v(60, 0, 0), 'lancer', { hp: 5000 });
  for (const f of [B, C]) w.world.explode(f.movement.state.position.clone().add(v(1, 0, 0)), 5, blast, { ownerId: f.id, team: f.team });
  assert.ok(Math.abs((5000 - B.health.hp) - (5000 - C.health.hp) * P.blast_proof.mods.selfBlast) < 1, `half (${5000 - B.health.hp} vs ${5000 - C.health.hp})`);
  // Mass: a blast doesn't throw him.
  const Mo = w.fighter(5, 1, v(90, 0, 0), 'monolith', { hp: 5000 });
  const O = w.fighter(6, 1, v(120, 0, 0), 'reaver', { hp: 5000 });
  for (const f of [Mo, O]) w.world.explode(f.movement.state.position.clone().add(v(1.5, 0, 0)), 5, blast, { ownerId: 99, team: 0 });
  const sp = (f) => Math.hypot(f.movement.state.velocity.x, f.movement.state.velocity.z);
  assert.ok(sp(Mo) < 0.01 && Mo.movement.state.mode !== 'ragdoll', 'he stands his ground');
  assert.ok(sp(O) > 1 || O.movement.state.mode === 'ragdoll', 'the other is thrown');
});

test('backstabs: Ghoststep doubles a sword from behind, From Nowhere suppresses', () => {
  const w = makeWorld();
  const G = w.fighter(1, 0, v(0, 0, 0), 'veil', { hp: 5000 });
  const N = w.fighter(2, 0, v(10, 0, 0), 'lancer', { hp: 5000 });
  const V1 = w.fighter(3, 1, v(0, 0, -1.5), 'lancer', { hp: 5000 });
  const V2 = w.fighter(4, 1, v(10, 0, -1.5), 'lancer', { hp: 5000 });
  for (const t of [V1, V2]) t.movement.state.yaw = 0;          // both facing away (north), the attackers behind them
  const dir = new Vector3(0, 0, -1);                              // the blow travels north
  V1.melee.receiveHit(G.melee, sword(30), dir); V2.melee.receiveHit(N.melee, sword(30), dir);
  assert.equal(5000 - V1.health.hp, 60, 'doubled');
  assert.equal(5000 - V2.health.hp, 30, 'plain');
  V1.movement.state.yaw = Math.PI;                                // facing him: no backstab
  V1.melee.receiveHit(G.melee, sword(30), dir);
  assert.equal(5000 - V1.health.hp, 90, 'from the front, plain');
  const W = w.fighter(5, 1, v(20, 0, 0), 'wraith', { hp: 5000 });
  const V3 = w.fighter(6, 0, v(20, 0, -1.5), 'lancer', { hp: 5000 });
  V3.movement.state.yaw = 0;
  V3.melee.receiveHit(W.melee, sword(30), dir);
  assert.ok(V3.status.has('suppress'), 'suppressed');
});

test('spotter and mindread: hold your sights on an enemy and he\'s marked, or read', () => {
  const w = makeWorld();
  const Sp = w.fighter(1, 0, v(0, 0, 0), 'seraph', { hp: 5000 });
  const Ps = w.fighter(2, 1, v(40, 0, 0), 'psion', { hp: 5000 });
  const E = w.fighter(3, 1, v(0, 0, -30), 'reaver', { hp: 5000 });
  const F = w.fighter(4, 0, v(40, 0, -30), 'lancer', { hp: 5000 });
  for (const f of [Sp, Ps]) f.mode = 'gun';
  w.aimAt(Sp, v(0, 1.2, -30)); w.aimAt(Ps, v(40, 1.2, -30));
  w.step(10);
  w.hold(Sp, 'guard'); w.hold(Ps, 'guard');
  w.seconds(0.35);
  assert.ok(!E.status.has('revealed'), 'not at once');
  w.seconds(0.6);
  assert.ok(E.status.has('revealed'), 'marked');
  assert.equal(E.status.active.get('revealed').source, Sp, 'by the spotter');
  assert.equal(Ps.mindread?.id, F.id, 'the psion reads him');
});

test('hunger, leech link and black flame answer hits; patient eye builds while the sights stay on', () => {
  const w = makeWorld();
  const H = w.fighter(1, 1, v(0, 0, 0), 'reaver', { hp: 5000 });
  H.health.maxShield = 100; H.health.shield = 50;
  const T = w.fighter(2, 0, v(0, 0, -10), 'lancer', { hp: 5000 });
  T.status.apply('weaken', { source: H });
  bus.emit('weapon:hit', { attacker: H.id, victim: T.id, damage: 30 });
  assert.equal(H.health.shield, 50 + P.hunger.weakened.armor, 'hunger: armor back off a weakened enemy');
  const L = w.fighter(3, 1, v(5, 0, 0), 'mender', { hp: 5000 });
  const hurt = w.fighter(4, 1, v(8, 0, 0), 'reaver', { hp: 200 }); hurt.health.hp = 50;
  const fine = w.fighter(5, 1, v(3, 0, 0), 'reaver', { hp: 200 }); fine.health.hp = 150;
  bus.emit('weapon:hit', { attacker: L.id, victim: T.id, damage: 100 });
  assert.equal(hurt.health.hp, 50 + 100 * P.leech_link.link.share, 'leech link: the most hurt teammate');
  assert.equal(fine.health.hp, 150);
  const K = w.fighter(6, 1, v(0, 0, -11.5), 'ashsworn', { hp: 5000 });
  for (let i = 0; i < 3; i++) T.melee.receiveHit(K.melee, sword(20), new Vector3(0, 0, 1));
  assert.ok(T.status.has('volatile'), 'black flame: three sword hits set Volatile');
  // Patient eye.
  const Y = w.fighter(7, 1, v(30, 0, 0), 'hollow_eye', { hp: 5000 });
  Y.mode = 'gun'; w.aimAt(Y, v(30, 1.2, -40)); w.step(5);
  w.hold(Y, 'guard'); w.seconds(2.4);
  assert.ok(Math.abs(Y.weapons.passiveMul - (1 + 2 * P.patient_eye.eye.per)) < 1e-9, `+20% after two seconds (${Y.weapons.passiveMul})`);
  w.press(Y, 'light'); w.step(2);
  assert.equal(Y.weapons.passiveMul, 1, 'the shot spends it');
});

test('vehicles and tech: ace boards in half the time, drift phases out, salvage and scavenger profit from wrecks', () => {
  const w = makeWorld();
  const A = w.fighter(1, 0, v(0, 0, 0), 'skyrider');
  const N = w.fighter(2, 0, v(20, 0, 0), 'lancer');
  const b1 = w.world.vehicles.spawn('solari_hoverbike', 0, v(1.5, 0, 0)), b2 = w.world.vehicles.spawn('solari_hoverbike', 0, v(21.5, 0, 0));
  w.world.vehicles.enter(A, b1); w.world.vehicles.enter(N, b2);
  assert.ok(Math.abs(A.vehicle.lock - N.vehicle.lock * P.ace.mods.enterTime) < 1e-9, 'ace: half the lock');
  const D = w.fighter(3, 1, v(40, 0, 0), 'driftcaller');
  const sk = w.world.vehicles.spawn('void_skiff', 1, v(41.5, 0, 0));
  w.world.vehicles.enter(D, sk); w.step(40);
  w.world.vehicles.exit(D);
  assert.ok(D.status.has('phased'), 'drift: phased on the way out');
  // Salvage: a wreck within reach is a mag.
  const Sv = w.fighter(4, 0, v(60, 0, 0), 'artificer', { role: 'engineer' });
  const gun = Sv.weapons.current; gun.reserve = 0;
  const wreck = w.world.vehicles.spawn('void_skiff', 1, v(66, 0, 0));
  wreck.health.damage(1e6, { kind: 'gun' }, N);
  assert.ok(gun.reserve > 0, `salvage: a mag (${gun.reserve})`);
  // Scavenger: an enemy turret destroyed refunds cooldowns.
  const R = w.fighter(5, 1, v(80, 0, 0), 'rigger', { role: 'engineer' });
  const slot = Object.values(R.abilities.slots)[0];
  slot.cooldown = 20;
  const tur = w.world.spawnDeployable({ kind: 'turret', ability: 'test', ownerId: N.id, team: 0, at: v(85, 0, 0), yaw: 0, hp: 100, dps: 0, range: 1, turnRate: 1, lifetime: 60 });
  tur.health.damage(1e6, { kind: 'gun' }, R);
  assert.ok(slot.cooldown < 20 - P.scavenger.refund.share * (slot.stats.cooldown ?? 20) + 0.01, `refunded (${slot.cooldown.toFixed(1)} s)`);
});

test('overcharge vents faster; rift-proof isn\'t pulled; radiant guard heals on a parry', () => {
  const w = makeWorld();
  const Pr = w.fighter(1, 0, v(0, 0, 0), 'prism_adept');
  assert.equal(Pr.perks.ventRate, P.overcharge.mods.ventRate);
  const Rb = w.fighter(2, 1, v(10, 0, 0), 'riftbreaker', { hp: 5000 });
  const Rv = w.fighter(3, 1, v(10, 0, 4), 'reaver', { hp: 5000 });
  w.world.spawnZone({ kind: 'pull', ability: 'test', ownerId: 1, team: 0, center: v(10, 0, 2), radius: 6, lifetime: 3, pull: 6 });
  const a0 = Rb.movement.state.position.clone(), b0 = Rv.movement.state.position.clone();
  w.seconds(0.5);
  assert.ok(Rb.movement.state.position.distanceTo(a0) < 0.05, 'not dragged');
  assert.ok(Rv.movement.state.position.distanceTo(b0) > 0.5, 'the other is');
  const Dw = w.fighter(4, 0, v(30, 0, 0), 'dawnblade', { hp: 200 });
  Dw.health.hp = 100;
  bus.emit('melee:parry', { defender: Dw.id, attacker: Rv.id });
  assert.equal(Dw.health.hp, 100 + P.radiant_guard.parry.heal);
});

// ---------------------------------------------------------------- bots
function bot(w, id, team, pos, cls) {
  const B = w.bot(id, team, pos, cls);
  for (const k of ['ability1', 'ability2', 'grenade', 'super']) { const s = B.abilities.slots[k]; if (s) { s.cooldown = 999; s.charges = 0; } }
  if (B.abilities) B.abilities.superEnergy = 0;
  for (const s of B.stratagems?.slots ?? []) s.cooldown = 999;
  return B;
}

test('bots: a medic stims a downed teammate up, an engineer drops a pack for a squadmate short of ammo, and mends a tank', () => {
  const w = makeWorld([], { down: true });
  const enemy = w.fighter(90, 1, v(0, 0, 200), 'lancer');
  const M = bot(w, 1, 0, v(0, 0, 0), 'lumen');
  const T = w.fighter(2, 0, v(4, 0, 0), 'lancer', { hp: 100 });
  T.health.damage(110, { kind: 'gun' }, enemy);
  const ev = events(['support:stim', 'support:pack', 'support:repair']);
  w.seconds(5);
  assert.ok(ev.got.some((e) => e.type === 'support:stim' && e.id === M.id && e.revive), 'stimmed him');
  assert.equal(T.health.downed, false, 'he\'s up');
  // An engineer whose squadmate is out of ammo.
  const E = bot(w, 3, 0, v(40, 0, 0), 'artificer');
  const S2 = w.fighter(4, 0, v(43, 0, 0), 'lancer');
  E.squad = S2.squad = { id: 'q' };
  S2.weapons.current.reserve = 0; S2.weapons.current.mag = 2;
  w.seconds(3);
  assert.ok(ev.got.some((e) => e.type === 'support:pack' && e.owner === E.id), 'a pack for him');
  // And a damaged tank of ours close by.
  const tank = w.world.vehicles.spawn('solari_lancer_tank', 0, v(52, 0, 6));
  tank.health.hp = tank.health.max * 0.4;
  w.seconds(8);
  ev.off();
  assert.ok(ev.got.some((e) => e.type === 'support:repair' && e.id === E.id), 'repairing it');
  assert.ok(tank.health.hp > tank.health.max * 0.45, `mended (${(tank.health.hp / tank.health.max * 100).toFixed(0)}%)`);
});
