// Apex gunplay rules: pixel-accurate ADS, per-class ADS strafe speed, hipfire cone behaviour,
// projectile speeds, and time-to-kill sanity against a purple-armored target.
import { CollisionWorld } from '../src/shared/physics.js';
import { createMoveState, stepMovement } from '../src/shared/movement.js';
import { BTN, SIM_DT, SHIELD_TIERS } from '../src/shared/constants.js';
import { WEAPONS, currentSpread, fireInterval, ADS_MOVE } from '../src/shared/weapons.js';
import { speedMul } from '../src/shared/mods.js';

let fails = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name, extra); if (!ok) fails++; };
const world = new CollisionWorld(400);
world.finalize();

// ADS precision: zero spread on every bullet weapon, standing, moving and airborne
const still = { vx: 0, vz: 0, onGround: true, mode: 'ground', crouch: 0 };
const moving = { vx: 4, vz: 0, onGround: true, mode: 'ground', crouch: 0 };
const air = { vx: 6, vz: 0, onGround: false, mode: 'air', crouch: 0 };
const bulletGuns = Object.entries(WEAPONS).filter(([, w]) => !w.pellets);
check('ADS is pixel-accurate (even moving, airborne, after bloom)', bulletGuns.every(([, w]) => [still, moving, air].every((s) => currentSpread(w, s, true, 3) === 0)));
check('hipfire still has a cone that grows when moving', bulletGuns.every(([, w]) => currentSpread(w, moving, false, 0) > currentSpread(w, still, false, 0)));

// ADS strafe speed by class (measured through the shared movement code)
const strafe = (id, ads) => {
  const s = createMoveState(0, 0, 0); s.onGround = true; s.mode = 'ground';
  const buttons = ads ? BTN.ADS : 0;
  for (let i = 0; i < 90; i++) { s.speedMul = speedMul({}, null, id, buttons, 'jolt'); stepMovement(s, { mx: 1, mz: 0, yaw: 0, pitch: 0, buttons }, SIM_DT, world); }
  return Math.hypot(s.vx, s.vz);
};
for (const id of ['talon', 'hornet', 'bulwark', 'sentinel', 'p20', 'breacher']) {
  const w = WEAPONS[id], r = strafe(id, true) / strafe(id, false);
  check(`ADS strafe ${w.name} (${w.cls}) ×${ADS_MOVE[w.cls]}`, Math.abs(r - ADS_MOVE[w.cls]) < 0.02, `measured ×${r.toFixed(3)}`);
}

// projectile speeds (Apex UPS × 0.0254)
check('Talon (R-301-like) bullet ~737 m/s', WEAPONS.talon.speed === 737);
check('Marshal faster than SMG rounds', WEAPONS.scout.speed > WEAPONS.hornet.speed);

// TTK sanity vs purple armor (100 shield + 100 hp), body shots, no misses
const ehp = 100 + SHIELD_TIERS[3];
for (const id of ['talon', 'mauler', 'hornet', 'volt', 'bulwark', 'viper']) {
  const w = WEAPONS[id];
  const shots = Math.ceil(ehp / w.damage);
  const ttk = (shots - 1) * fireInterval(w);
  console.log(`  ${w.name.padEnd(15)} ${String(shots).padStart(2)} shots, TTK ${ttk.toFixed(2)} s`);
}
const ttk = (id) => (Math.ceil(ehp / WEAPONS[id].damage) - 1) * fireInterval(WEAPONS[id]);
check('auto weapons kill purple in 0.9–2.0 s (Apex range)', ['talon', 'mauler', 'hornet', 'volt'].every((id) => ttk(id) > 0.9 && ttk(id) < 2.0));
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
