// Headless test harness: builds a CombatWorld with fighters wired exactly like the game.
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { MovementController, FlatGroundBody } from '../src/movement/MovementController.js';
import { WeaponComponent, WeaponInstance } from '../src/combat/weapons/WeaponSystem.js';
import { buildWeapon } from '../src/combat/weapons/WeaponDefs.js';
import { AbilityComponent } from '../src/combat/AbilitySystem.js';
import { StatusComponent } from '../src/combat/StatusSystem.js';
import { Health } from '../src/combat/Health.js';
import { CombatWorld } from '../src/combat/CombatWorld.js';
import { emptyCommand } from '../src/input/InputManager.js';

const J = (p) => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url)));
export const data = {
  movement: J('movement.json'), ballistic: J('weapons/ballistic.json'), recoil: J('weapons/recoil.json').patterns,
  statuses: J('abilities/statuses.json').statuses, matrix: J('damage-matrix.json').matrix,
  kits: { ...J('abilities/solari.json').kits, ...J('abilities/void.json').kits },
};
export const DT = 1 / 60;
export const v = (x, y, z) => new Vector3(x, y, z);

export function makeWorld(cover = []) {
  const world = new CombatWorld({ damageMatrix: data.matrix, cover });
  const fighters = new Map(); // entity -> scripted command source

  function fighter(id, team, pos, kitId, { gun = 'sol_ar_halcyon', hp = 200 } = {}) {
    const movement = new MovementController(data.movement, new FlatGroundBody(pos, cover), {}, id);
    movement.state.position.copy(pos);
    const e = { id, team, movement };
    e.health = new Health(e, { health: hp });
    e.status = new StatusComponent(e, data.statuses, world);
    e.weapons = new WeaponComponent(e, [new WeaponInstance(buildWeapon(data.ballistic, gun, [], []), data.recoil)], world);
    e.abilities = new AbilityComponent(e, data.kits[kitId], world);
    fighters.set(e, { yaw: 0, pitch: 0, press: new Set(), hold: new Set(), prev: new Set() });
    return world.add(e);
  }

  /** Queue a one-tick press for an entity's next tick. */
  const press = (e, ...keys) => keys.forEach((k) => fighters.get(e).press.add(k));
  const aim = (e, yaw, pitch = 0) => Object.assign(fighters.get(e), { yaw, pitch });
  const aimAt = (e, p) => { const o = e.movement.state.position; aim(e, Math.atan2(-(p.x - o.x), -(p.z - o.z)), Math.atan2(p.y - (o.y + 1.6), Math.hypot(p.x - o.x, p.z - o.z))); };

  function step(n = 1) {
    for (let i = 0; i < n; i++) {
      for (const [e, s] of fighters) {
        const c = emptyCommand();
        c.yaw = s.yaw; c.pitch = s.pitch;
        const down = new Set([...s.press, ...s.hold]);
        for (const k of new Set([...down, ...s.prev])) c.buttons[k] = { down: down.has(k), pressed: down.has(k) && !s.prev.has(k), released: !down.has(k) && s.prev.has(k) };
        s.prev = down; s.press.clear();
        e.status.update(DT); e.health.update(DT);
        e.movement.update(c, DT);
        e.movement.state.speedScale = e.status.speedMul;
        e.abilities.update(c, DT); e.weapons.update(c, DT);
      }
      world.update(DT);
    }
  }
  const seconds = (s) => step(Math.round(s / DT));
  const hold = (e, ...keys) => keys.forEach((k) => fighters.get(e).hold.add(k));
  const release = (e, ...keys) => keys.forEach((k) => fighters.get(e).hold.delete(k));
  return { world, fighter, press, hold, release, aim, aimAt, step, seconds };
}
