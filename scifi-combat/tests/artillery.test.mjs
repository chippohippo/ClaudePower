// Field guns: setting up and packing, laying, indirect fire on a mark, AT guns against armor,
// rocket salvos, what shells do where they land (craters, sandbags, ragdolls), and towing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bus } from '../src/core/EventBus.js';
import { Terrain } from '../src/world/Terrain.js';
import { makeWorld, v } from './harness.mjs';

const listen = (type) => { const got = []; const off = bus.on(type, (e) => got.push(e)); return { got, off }; };
const flat = (half = 700) => new Terrain({ minX: -half, minZ: -half, width: half * 2, depth: half * 2, res: 1 });
const DEG = Math.PI / 180;

/** A world with one crewed gun: the commander (and a loader) are in, input settled. */
function crewedGun(type, { at = v(0, 0, 0), yaw = 0, loader = false, terrain = flat(), cover = [] } = {}) {
  const w = makeWorld(cover, { terrain });
  const gun = w.world.vehicles.spawn(type, 0, at, yaw);
  const C = w.fighter(1, 0, at.clone().add(v(0, 0, 3)), 'bastion');
  w.world.vehicles.enter(C, gun, 0);
  let L = null;
  if (loader) { L = w.fighter(2, 0, at.clone().add(v(1, 0, 3)), 'lumen'); w.world.vehicles.enter(L, gun, 1); }
  w.seconds(0.5);
  return { w, gun, C, L };
}
const setUp = (w, C, gun) => { w.press(C, 'dig'); w.seconds(gun.def.gun.deployTime + 0.2); };
/** Hold fire until the gun has fired once more (it may still be laying). */
function fireOnce(w, C, gun, max = 15) {
  const n = gun.gun.shots;
  w.hold(C, 'light');
  for (let t = 0; t < max * 60 && gun.gun.shots === n; t++) w.step(1);
  w.release(C, 'light');
  assert.ok(gun.gun.shots > n, 'fired');
}

test('a field gun sets up before it fires, and packs up before it moves', () => {
  const { w, gun, C } = crewedGun('solari_field_gun');
  const fired = listen('gun:fire');
  w.target(C, 0, -400);
  w.hold(C, 'light'); w.seconds(2);
  assert.equal(fired.got.length, 0, 'packed: no firing');
  w.release(C, 'light');
  // Packed, the crew pushes it at walking pace.
  w.move(C, 0, 1); w.seconds(3); w.move(C, 0, 0);
  const pushed = -gun.movement.state.position.z;
  assert.ok(pushed > 3 && pushed < 3 * gun.def.maxSpeed + 0.5, `pushed ${pushed.toFixed(1)} m`);
  w.seconds(1);
  w.press(C, 'dig'); w.seconds(1);
  assert.equal(gun.gun.state, 'deploying');
  w.seconds(gun.def.gun.deployTime);
  assert.equal(gun.gun.state, 'deployed');
  // Set up, pushing does nothing: the spades are in the ground.
  const p0 = gun.movement.state.position.clone();
  w.move(C, 0, 1); w.seconds(2); w.move(C, 0, 0);
  assert.ok(gun.movement.state.position.distanceTo(p0) < 0.01, 'dug in');
  w.hold(C, 'light'); w.seconds(4); w.release(C, 'light');
  assert.ok(fired.got.length >= 1, 'set up: it fires');
  w.press(C, 'dig'); w.seconds(gun.def.gun.packTime + 0.3);
  assert.equal(gun.gun.state, 'packed');
  fired.off();
});

test('indirect fire lands around the mark, at the predicted time, scattered more at long range', () => {
  const spread = (dist) => {
    const { w, gun, C } = crewedGun('solari_field_gun', { loader: true });
    setUp(w, C, gun);
    gun.gun.ammo = 40;
    const hits = [], fired = listen('gun:fire'), boom = listen('artillery:impact');
    w.target(C, 0, -dist);
    w.hold(C, 'light'); w.seconds(70); w.release(C, 'light');
    w.seconds(16);
    fired.off(); boom.off();
    for (const b of boom.got) hits.push(b.point);
    assert.ok(hits.length >= 12, `${hits.length} rounds landed`);
    // Each round lands where and when the fire-control said it would.
    for (let i = 0; i < Math.min(fired.got.length, boom.got.length); i++) {
      const f = fired.got[i], b = boom.got[i];
      assert.ok(Math.hypot(f.at[0] - b.point[0], f.at[2] - b.point[2]) < 3, `round ${i} landed ${Math.hypot(f.at[0] - b.point[0], f.at[2] - b.point[2]).toFixed(1)} m from its predicted point`);
    }
    const mx = hits.reduce((a, p) => a + p[0], 0) / hits.length, mz = hits.reduce((a, p) => a + p[2], 0) / hits.length;
    const sd = Math.sqrt(hits.reduce((a, p) => a + (p[0] - mx) ** 2 + (p[2] - mz) ** 2, 0) / hits.length);
    assert.ok(Math.hypot(mx, mz + dist) < 8, `mean impact ${Math.hypot(mx, mz + dist).toFixed(1)} m off the mark at ${dist} m`);
    return { sd, eta: fired.got[0].eta };
  };
  const near = spread(250), far = spread(1100);
  assert.ok(far.sd > near.sd * 1.4, `spread grows with range (${near.sd.toFixed(1)} m at 250, ${far.sd.toFixed(1)} m at 1100)`);
  assert.ok(near.eta > 4 && near.eta < 8 && far.eta > 9 && far.eta < 15, `flight times ${near.eta.toFixed(1)} s, ${far.eta.toFixed(1)} s`);
});

test('out of range or too close: the gun lays but holds fire', () => {
  const { w, gun, C } = crewedGun('solari_field_gun');
  setUp(w, C, gun);
  const [lo, hi] = w.world.vehicles.guns.range(gun.def.gun);
  assert.ok(lo < 60 && hi > 1550, `reach ${lo.toFixed(0)}-${hi.toFixed(0)} m`);
  const fired = listen('gun:fire');
  w.hold(C, 'light');
  w.target(C, 0, -(hi + 200)); w.seconds(4);
  w.target(C, 0, -lo * 0.5); w.seconds(4);
  w.release(C, 'light');
  assert.equal(fired.got.length, 0);
  fired.off();
});

test('laying: the barrel turns at the laying rate within the traverse; past it the crew swings the carriage', () => {
  const { w, gun, C } = crewedGun('solari_at_gun');
  setUp(w, C, gun);
  const d = gun.def.gun;
  w.aim(C, 20 * DEG, 0); w.seconds(0.25);
  assert.ok(gun.gun.yaw > 0 && gun.gun.yaw <= d.layRate[0] * DEG * 0.26, 'laying rate');
  w.seconds(1);
  assert.ok(Math.abs(gun.gun.yaw - 20 * DEG) < 0.01 && gun.yaw === 0, 'inside the traverse the carriage stays put');
  w.aim(C, 80 * DEG, 0); w.seconds(1);
  assert.ok(gun.yaw > 0 && gun.yaw <= d.shiftRate * DEG * 1.05, `carriage swings at ${d.shiftRate}°/s (${(gun.yaw / DEG).toFixed(1)}°)`);
  assert.ok(gun.gun.outOfArc, 'still out of arc');
  w.seconds(6);
  assert.ok(!gun.gun.outOfArc && Math.abs(gun.gun.yaw - 80 * DEG) < 0.02, 'got there');
});

test('AT gun: three hits kill a tank from the front, two from the rear; small arms barely scratch it', () => {
  const run = (rear) => {
    const { w, gun, C } = crewedGun('solari_at_gun', { loader: true });
    setUp(w, C, gun);
    // Yaw 0 faces -z, away from the gun: its rear (and the weak spot) toward it.
    const tank = w.world.vehicles.spawn('void_crawler_tank', 1, v(0, 0, -120), rear ? 0 : Math.PI);
    w.aimAt(C, tank.movement.state.position.clone().setY(1));
    let shots = 0;
    const off = bus.on('gun:fire', () => shots++);
    for (let i = 0; i < 40 && !tank.removed; i++) { w.hold(C, 'light'); w.seconds(0.5); }
    off();
    return { shots, dead: tank.removed };
  };
  const front = run(false), rear = run(true);
  assert.ok(front.dead && front.shots <= 3, `front: ${front.shots} shots`);
  assert.ok(rear.dead && rear.shots <= 2, `rear: ${rear.shots} shots`);
});

test('rocket battery: one salvo ripples out, then a long reload', () => {
  const { w, gun, C } = crewedGun('solari_rocket_battery');
  setUp(w, C, gun);
  const d = gun.def.gun, a0 = gun.gun.ammo;
  const fired = listen('gun:fire');
  w.target(C, 0, -600);
  w.hold(C, 'light');
  for (let t = 0; t < 600 && !fired.got.length; t++) w.step(1);   // laying the rack
  w.seconds(0.5);
  const start = fired.got.length;
  w.seconds(d.salvo * d.salvoInterval);
  assert.equal(fired.got.length, d.salvo, 'a full salvo');
  assert.ok(start > 0 && start < d.salvo, 'rippled, not all at once');
  w.seconds(d.reload * 0.8);
  assert.equal(fired.got.length, d.salvo, 'reloading');
  w.seconds(d.reload * 0.4 + 2);
  assert.ok(fired.got.length > d.salvo, 'second salvo');
  w.release(C, 'light');
  assert.ok(a0 - gun.gun.ammo >= d.salvo + 1);
  // Set up, the battery can't drive.
  const p0 = gun.movement.state.position.clone();
  w.move(C, 0, 1); w.seconds(2); w.move(C, 0, 0);
  assert.ok(gun.movement.state.position.distanceTo(p0) < 0.05, 'stabilizers down');
  fired.off();
});

test('where a shell lands: a crater, sandbags blown away, soldiers thrown; no crater on hard cover', () => {
  const terrain = flat();
  const sandbags = { min: v(-1, 0, -300.5), max: v(1, 1.2, -299.5), surface: 'sandbag', kind: 'fort', destructible: true };
  const blockhouse = { min: v(48, 0, -302), max: v(52, 3, -298), surface: 'concrete' };
  const { w, gun, C } = crewedGun('solari_field_gun', { terrain, cover: [sandbags, blockhouse] });
  const E = w.fighter(9, 1, v(4, 0, -300), 'reaver', { hp: 2000 });
  setUp(w, C, gun);
  gun.gun.rand = () => 1;                   // no scatter (zero Box-Muller radius): every round on the mark
  const boom = listen('artillery:impact'), thrown = listen('move:ragdoll');
  w.target(C, 0, -300); fireOnce(w, C, gun);
  w.seconds(10);
  assert.equal(boom.got.length, 1);
  assert.ok(boom.got[0].crater > 0, 'crater');
  assert.ok(terrain.height(0, -300) < -0.6, `ground dug out (${terrain.height(0, -300).toFixed(2)} m)`);
  assert.ok(!w.world.cover.includes(sandbags), 'sandbags blown away');
  assert.ok(thrown.got.some((e) => e.id === E.id), 'the soldier beside it was thrown');
  // On the blockhouse: no crater (and its walls don't float).
  w.target(C, 50, -300); w.seconds(2); fireOnce(w, C, gun);
  w.seconds(10);
  const onRoof = boom.got.slice(1).find((b) => Math.abs(b.point[0] - 50) < 3);
  assert.ok(onRoof, 'a round landed on the blockhouse');
  assert.equal(onRoof.crater, 0);
  assert.ok(w.world.cover.includes(blockhouse), 'concrete stands');
  boom.off(); thrown.off();
});

test('incoming rounds are known while they fly (whistles, hitting the dirt)', () => {
  const { w, gun, C } = crewedGun('solari_field_gun');
  setUp(w, C, gun);
  w.target(C, 0, -500); fireOnce(w, C, gun);
  const G = w.world.vehicles.guns;
  assert.equal(G.incoming.length, 1);
  const r = G.incoming[0];
  assert.ok(Math.hypot(r.x, r.z + 500) < 30);
  assert.equal(G.incomingNear(r.x, r.z, 10, 30)?.gun, gun.id);
  assert.equal(G.incomingNear(r.x + 200, r.z, 10, 30), null);
  w.seconds(r.at - G.time + 1);
  assert.equal(G.incoming.length, 0, 'gone once it has landed');
});

test('towing: a truck hitches a packed gun by its trail, tows it barrel-first behind, and unhitches', () => {
  const w = makeWorld([], { terrain: flat() });
  const truck = w.world.vehicles.spawn('solari_supply_truck', 0, v(0, 0, 0), 0);
  // The gun behind the truck, its trail toward the hitch.
  const gun = w.world.vehicles.spawn('solari_field_gun', 0, v(0, 0, 3.4 + 0.3 + 2.2 + 1), Math.PI);
  const D = w.fighter(1, 0, v(2, 0, -3), 'bastion');
  w.world.vehicles.enter(D, truck, 0); w.seconds(0.5);
  const hitched = listen('gun:hitch');
  w.press(D, 'dig'); w.step(2);
  assert.equal(hitched.got.length, 1);
  assert.equal(truck.towing, gun);
  w.move(D, 0, 1); w.seconds(6); w.move(D, 0, 0); w.seconds(2);
  const tp = truck.movement.state.position, gp = gun.movement.state.position;
  assert.ok(-tp.z > 25, `truck drove ${(-tp.z).toFixed(1)} m`);
  assert.ok(gp.z > tp.z + 3 && gp.distanceTo(tp) < 9, 'the gun trails behind');
  assert.ok(Math.abs(Math.sin(gun.yaw)) < 0.05 && Math.cos(gun.yaw) < -0.99, 'barrel pointing back');
  // Nobody can man or set up a gun on the hook; the driver drops it with H.
  const G = w.fighter(2, 0, gp.clone().add(v(2.5, 0, 0)), 'lumen');
  w.press(G, 'interact'); w.step(2);
  assert.equal(G.vehicle ?? null, null, 'no boarding a towed gun');
  w.press(D, 'dig'); w.step(2);
  assert.equal(truck.towing, null);
  assert.equal(gun.gun.towedBy, null);
  // A manned or set-up gun can't be hooked.
  w.press(G, 'interact'); w.step(2);
  assert.equal(G.vehicle?.veh, gun);
  w.press(D, 'dig'); w.step(2);
  assert.equal(truck.towing, null, 'manned');
  hitched.off();
});

test('EMP: a silenced gun can neither fire nor set up', () => {
  const { w, gun, C } = crewedGun('solari_field_gun');
  gun.status.apply('suppress', { duration: 10 });
  w.press(C, 'dig'); w.seconds(6);
  assert.equal(gun.gun.state, 'packed');
});
