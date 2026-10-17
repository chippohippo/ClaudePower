// Logistics: supplies made at the HQ, hauled by truck to the forward depot, spent at the front
// (ammo, shells, sandbags, vehicles), moved with the front, and lost to interdiction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { bus } from '../src/core/EventBus.js';
import { FrontlineSession } from '../src/game/FrontlineSession.js';
import { COST } from '../src/game/frontline/Logistics.js';
import { data as H } from './harness.mjs';

const sessionData = {
  movement: H.movement, weaponFiles: [H.ballistic, H.energy], attachments: H.attachments, recoil: H.recoil, statuses: H.statuses,
  meleeWeapons: H.melee, kits: H.kits, classes: H.classes, damageMatrix: H.matrix, supers: H.supers, vehicleDefs: H.vehicles,
  personalities: H.ai.personalities, difficulty: H.ai.difficulty.veteran, down: H.down,
};
const listen = (type) => { const got = []; const off = bus.on(type, (e) => got.push(e)); return { got, off }; };
const session = (o = {}) => new FrontlineSession(sessionData, { size: '12v12', seed: 7, ...o });
/** Run only the logistics for `secs` (nobody moves). */
const runL = (s, secs, fighters = []) => { for (let i = 0; i < Math.round(secs * 60); i++) s.logistics.update(1 / 60, fighters); };
const park = (v, at) => { v.movement.state.position.set(at.x, at.y, at.z); v.movement.state.velocity.set(0, 0, 0); };
const magWeapon = (f) => f.weapons.loadout.find((w) => !w.usesHeat && !w.usesBattery && (w.s.reserve ?? 0) > 0);

test('logistics only where there is artillery: none at 4v4', () => {
  const s = session({ size: '4v4' });
  assert.equal(s.logistics, null);
  assert.equal(s.world.vehicles.list.filter((v) => v.def.gun || v.def.cargo).length, 0);
  s.dispose();
});

test('the HQ makes supplies; a truck loads at the dump and unloads at the forward depot', () => {
  const s = session(), L = s.logistics;
  const truck = s.world.vehicles.list.find((v) => v.def.cargo && v.team === 0);
  assert.ok(truck, 'a supply truck at the HQ');
  const h0 = L.hq(0).stock;
  runL(s, 6);
  assert.ok(Math.abs(L.hq(0).stock - (h0 + L.cfg.production / 10)) < 0.5, 'production');
  const loaded = listen('logistics:load'), unloaded = listen('logistics:unload');
  park(truck, L.hq(0).pos);
  runL(s, 8);
  assert.equal(truck.cargo, truck.def.cargo, 'full');
  assert.equal(loaded.got.length, 1);
  assert.equal(loaded.got[0].amount, truck.def.cargo);
  L.front(0).stock = 100;
  park(truck, L.front(0).pos);
  runL(s, 8);
  assert.equal(truck.cargo, 0);
  assert.equal(Math.round(L.front(0).stock), 100 + truck.def.cargo);
  assert.equal(unloaded.got[0]?.amount, truck.def.cargo);
  // Driving through a depot doesn't count: it has to stop.
  truck.cargo = 50;
  park(truck, L.front(0).pos); truck.movement.state.velocity.set(6, 0, 0);
  runL(s, 2);
  assert.equal(truck.cargo, 50);
  loaded.off(); unloaded.off(); s.dispose();
});

test('a destroyed truck loses its cargo', () => {
  const s = session();
  const truck = s.world.vehicles.list.find((v) => v.def.cargo && v.team === 1);
  truck.cargo = 120;
  const lost = listen('logistics:lost');
  truck.health.damage(1e6, { kind: 'explosion' }, null);
  s.world.vehicles.update(1 / 60);
  assert.equal(lost.got.length, 1);
  assert.equal(lost.got[0].amount, 120);
  lost.off(); s.dispose();
});

test('the forward depot moves with the front: most of the stock goes along, an overrun one is mostly lost', () => {
  const s = session(), L = s.logistics;
  const f0 = s.mode.front[0], d0 = L.front(0).pos.clone();
  L.front(0).stock = 400; L.front(1).stock = 400;
  s.mode.front[0] = f0 + 1;                 // team 0 advances
  s.mode.front[1] = s.mode.front[1] + 1;    // team 1 falls back
  bus.emit('mode:front', {});
  assert.ok(L.front(0).pos.distanceTo(d0) > 40, 'moved up');
  assert.equal(L.front(0).sector, f0 + 1);
  assert.ok(Math.abs(L.front(0).stock - 300) < 1, `advance keeps 75% (${L.front(0).stock})`);
  assert.ok(Math.abs(L.front(1).stock - 120) < 1, `overrun keeps 30% (${L.front(1).stock})`);
  s.dispose();
});

test('soldiers refill at a depot (fast), in their own trenches (slowly), never on the enemy side', () => {
  const s = session(), L = s.logistics;
  const f = s.fighters.find((x) => x.team === 0 && magWeapon(x));
  const w = magWeapon(f);
  const P = f.movement.state.position;
  // At the forward depot: a magazine every half second.
  w.reserve = 0; P.copy(L.front(0).pos);
  const stock0 = L.front(0).stock;
  runL(s, 2, [f]);
  assert.ok(w.reserve >= w.s.mag * 3, `refilled ${w.reserve}`);
  assert.ok(L.front(0).stock < stock0, 'paid for');
  // In a trench on our side of the line: a magazine every 4 seconds.
  const own = (x, z) => L.ownSide(0, x) && L.inTrench(x, z);
  const T = s.map.trenches.flatMap((t) => t.corridors.filter((c) => c[4] === 'bay')).find((c) => own((c[0] + c[2]) / 2, (c[1] + c[3]) / 2));
  assert.ok(T, 'a friendly fire bay');
  w.reserve = 0; P.set((T[0] + T[2]) / 2, 0, (T[1] + T[3]) / 2);
  runL(s, 8.1, [f]);
  assert.equal(w.reserve, w.s.mag * 2, 'two magazines in 8 s');
  // Across the line: nothing.
  const E = s.map.trenches.flatMap((t) => t.corridors.filter((c) => c[4] === 'bay')).find((c) => !L.ownSide(0, (c[0] + c[2]) / 2));
  w.reserve = 0; P.set((E[0] + E[2]) / 2, 0, (E[1] + E[3]) / 2);
  runL(s, 8, [f]);
  assert.equal(w.reserve, 0);
  // Out of supplies, the depot hands out nothing.
  L.front(0).stock = 0; P.copy(L.front(0).pos);
  runL(s, 2, [f]);
  assert.equal(w.reserve, 0, 'empty depot');
  s.dispose();
});

test('batteries reload from a depot within reach, and pay for every round', () => {
  const s = session(), L = s.logistics;
  const gun = s.world.vehicles.list.find((v) => v.gun && v.def.gun.kind === 'howitzer' && v.team === 0);
  assert.ok(gun.movement.state.position.distanceTo(L.front(0).pos) < 150, 'the park is in reach of the depot');
  for (const v of s.world.vehicles.list) if (v.gun) v.gun.ammo = v.def.gun.ammoMax;   // only this one is short
  gun.gun.ammo = 0;
  const stock0 = L.front(0).stock;
  runL(s, 5.05);
  assert.equal(gun.gun.ammo, 5, 'a round a second');
  assert.ok(Math.abs(stock0 - L.front(0).stock - 5 * COST.howitzerRound) < 1.01, 'paid');
  // Far from every depot: no reload.
  park(gun, new Vector3(0, 0, 0));
  gun.gun.ammo = 0;
  runL(s, 3);
  assert.equal(gun.gun.ammo, 0);
  s.dispose();
});

test('vehicles and guns only come back when the depot can pay for them', () => {
  const s = session(), L = s.logistics, VS = s.world.vehicles;
  const pad = VS.pads.find((p) => p.team === 0 && p.kind === 'hoverbike');
  const bike = pad.current;
  bike.health.damage(1e6, { kind: 'explosion' }, null);
  L.front(0).stock = 0;
  for (let i = 0; i < (pad.respawn + 2) * 60; i++) VS.update(1 / 60);
  assert.ok(!pad.current || pad.current.removed, 'no supplies, no bike');
  L.front(0).stock = 100;
  VS.update(1 / 60);
  assert.ok(pad.current && !pad.current.removed, 'paid and back');
  assert.equal(L.front(0).stock, 100 - COST.hoverbike);
  s.dispose();
});

test('sandbags need supplies; the hole is free', () => {
  const s = session(), L = s.logistics, F = s.fortify;
  const f = s.fighters.find((x) => x.team === 0);
  const st = f.movement.state;
  // Somewhere level and open on team 0's side.
  const p = s.map.sectors[s.mode.front[0]].pool[0].clone().add(new Vector3(0, 0, 30));
  st.position.set(p.x, s.map.terrain.height(p.x, p.z), p.z); st.velocity.set(0, 0, 0); st.grounded = true; st.mode = 'ground';
  L.front(0).stock = 0;
  const short = listen('fort:short'), built = listen('fort:built');
  const dig = { buttons: { dig: { down: true, pressed: false, released: false } } };
  for (let i = 0; i < 9 * 60; i++) F.handleInput(f, dig, 1 / 60);
  assert.deepEqual(built.got.map((b) => b.kind), ['foxhole'], 'the foxhole, but no sandbags');
  assert.ok(short.got.length >= 1);
  L.front(0).stock = 50;
  for (let i = 0; i < 60; i++) F.handleInput(f, dig, 1 / 60);
  assert.deepEqual(built.got.map((b) => b.kind), ['foxhole', 'sandbags']);
  assert.equal(L.front(0).stock, 50 - COST.sandbags);
  short.off(); built.off(); s.dispose();
});

test('a shell landing in a depot burns some of its stock', () => {
  const s = session(), L = s.logistics, d = L.front(1);
  d.stock = 200;
  const lost = listen('logistics:lost');
  bus.emit('artillery:impact', { point: [d.pos.x + 3, d.pos.y, d.pos.z], radius: 9, crater: 2 });
  assert.ok(d.stock < 200 && d.stock > 150, `${d.stock}`);
  assert.equal(lost.got[0]?.what, 'shelled');
  lost.off(); s.dispose();
});

test('redeploying brings a full loadout', () => {
  const s = session({ humans: [{ id: 1, team: 0, classId: 'lancer' }] });
  const me = s.fighters.find((f) => f.id === 1), w = magWeapon(me) ?? me.weapons.loadout[0];
  w.reserve = 0; w.mag = 0; w.battery = 0;
  me.health.damage(1e6, { kind: 'explosion' }, null);
  for (let i = 0; i < 5 * 60; i++) s.step(1 / 60);
  s.respawn(1);
  assert.ok(!me.health.dead);
  assert.equal(w.mag, w.s.mag ?? 0);
  assert.equal(w.reserve, w.s.reserve ?? 0);
  s.dispose();
});
