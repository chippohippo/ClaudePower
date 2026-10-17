// Headless test harness: builds a CombatWorld with fighters wired exactly like the game.
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { MovementController, FlatGroundBody } from '../src/movement/MovementController.js';
import { WeaponComponent, WeaponInstance } from '../src/combat/weapons/WeaponSystem.js';
import { buildWeapon } from '../src/combat/weapons/WeaponDefs.js';
import { AbilityComponent } from '../src/combat/AbilitySystem.js';
import { StatusComponent } from '../src/combat/StatusSystem.js';
import { Health } from '../src/combat/Health.js';
import { reactToHit } from '../src/combat/HitReactions.js';
import { CombatWorld } from '../src/combat/CombatWorld.js';
import { emptyCommand } from '../src/input/InputManager.js';
import { MeleeComponent, MeleeSystem } from '../src/combat/melee/MeleeSystem.js';
import { buildFighter } from '../src/game/FighterFactory.js';
import { CombatBotBrain } from '../src/ai/CombatBotBrain.js';
import { routeCommand } from '../src/core/routing.js';
import { StratagemComponent } from '../src/combat/Stratagems.js';
import { BattlePoints } from '../src/game/BattlePoints.js';
import { Barks } from '../src/ai/Barks.js';

const J = (p) => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url)));
export const data = {
  movement: J('movement.json'), ballistic: J('weapons/ballistic.json'), recoil: J('weapons/recoil.json').patterns,
  statuses: J('abilities/statuses.json').statuses, matrix: J('damage-matrix.json').matrix,
  kits: { ...J('abilities/solari.json').kits, ...J('abilities/void.json').kits },
  supers: J('supers.json'), melee: J('weapons/melee.json').weapons, vehicles: J('vehicles.json'),
  energy: J('weapons/energy.json'), attachments: J('weapons/attachments.json').attachments,
  classes: [J('classes/solari.json'), J('classes/void.json')], ai: J('ai/personalities.json'),
  down: J('down.json'), stratagems: J('stratagems.json'), rules: J('rules.json'), battlePoints: J('battle-points.json'),
  passives: J('passives.json'), support: J('support.json'), humanoid: J('animation/humanoid.json'), barks: J('ai/barks.json'),
};
export const DT = 1 / 60;
let lastBp = null, lastBarks = null;
export const v = (x, y, z) => new Vector3(x, y, z);

/**
 * @param {object} o { down: true for the down-but-not-out rules (data/down.json), bp: battle points
 *                    (data/battle-points.json; mode: a FrontlineMode-like { points } for captures) }
 */
export function makeWorld(cover = [], { down = false, terrain = null, bp = false, mode = null } = {}) {
  const melee = new MeleeSystem({ blades: data.humanoid.sword });
  const downCfg = down ? data.down : null;
  const world = new CombatWorld({ damageMatrix: data.matrix, cover, terrain, supers: data.supers, meleeWeapons: data.melee, recoilDefs: data.recoil, vehicleDefs: data.vehicles, statusDefs: data.statuses, down: downCfg, rules: data.rules, stratagems: data.stratagems, passives: data.passives, support: data.support });
  if (bp) { lastBp?.dispose(); lastBp = world.bp = new BattlePoints(world, data.battlePoints, { mode }); }   // one listening at a time (fighter ids repeat between tests)
  lastBarks?.dispose(); lastBarks = world.barks = new Barks(world, data.barks);
  const fighters = new Map(); // entity -> scripted command source

  function fighter(id, team, pos, kitId, { gun = 'sol_ar_halcyon', hp = 200, role = null } = {}) {
    const movement = new MovementController(data.movement, new FlatGroundBody(pos, cover, { terrain }), {}, id);
    movement.state.position.copy(pos);
    const e = { id, team, movement };
    e.health = new Health(e, { health: hp, down: downCfg });
    e.role = role;
    e.onRevived = () => e.movement.getUpFromDown();
    e.status = new StatusComponent(e, data.statuses, world);
    movement.hooks.fallDamage = (amount) => e.health.damage(amount, { kind: 'fall' }, null);
    movement.hooks.vital = () => (e.health.dead ? 'dead' : e.health.downed ? 'downed' : 'alive');
    e.onHit = (res, info, by) => reactToHit(e, res, info, by);
    e.weapons = new WeaponComponent(e, [new WeaponInstance(buildWeapon(data.ballistic, gun, [], []), data.recoil)], world);
    e.abilities = new AbilityComponent(e, data.kits[kitId], world);
    e.stratagems = new StratagemComponent(e, world.stratagems, world.stratagems.loadoutFor(role ?? 'assault'));
    e.melee = new MeleeComponent(data.melee[0], e, world);
    e.mode = 'sword';
    // The kit's class passive (a kit id is a class id), and the role's items.
    world.passives.attach(e, data.classes.flatMap((f) => f.classes).find((c) => c.id === kitId)?.passive?.id);
    world.support.equip(e);
    melee.add(e.melee);
    fighters.set(e, { yaw: 0, pitch: 0, moveX: 0, moveY: 0, press: new Set(), hold: new Set(), prev: new Set() });
    return world.add(e);
  }

  /** Queue a one-tick press for an entity's next tick. */
  const press = (e, ...keys) => keys.forEach((k) => fighters.get(e).press.add(k));
  const aim = (e, yaw, pitch = 0) => Object.assign(fighters.get(e), { yaw, pitch });
  const aimAt = (e, p) => { const o = e.movement.state.position; aim(e, Math.atan2(-(p.x - o.x), -(p.z - o.z)), Math.atan2(p.y - (o.y + 1.6), Math.hypot(p.x - o.x, p.z - o.z))); };

  /** A full-kit bot of any class, driven by CombatBotBrain. */
  const factoryData = {
    movement: data.movement, weaponFiles: [data.ballistic, data.energy], attachments: data.attachments, recoil: data.recoil,
    statuses: data.statuses, meleeWeapons: data.melee, kits: data.kits, classes: data.classes, down: downCfg,
  };
  function bot(id, team, pos, classId, { difficulty = 'veteran', seed = 7, persona = null } = {}) {
    const e = buildFighter(world, factoryData, { id, team, classId, pos, cover });
    e.name = world.barks.name(e);
    melee.add(e.melee);
    const diff = typeof difficulty === 'string' ? data.ai.difficulty[difficulty] : { ...data.ai.difficulty.veteran, ...difficulty };
    const brain = new CombatBotBrain(e, world, persona ?? data.ai.personalities[e.ai], diff, { seed });
    e.brain = brain;                       // as in FrontlineSession (the sim asks: supply pods hand bots their mags)
    fighters.set(e, { brain, prev: new Set(), press: new Set(), hold: new Set() });
    return e;
  }

  let tick = 0;
  function step(n = 1) {
    for (let i = 0; i < n; i++) {
      tick++;
      for (const [e, s] of fighters) {
        let c;
        if (s.brain) c = s.brain.think(DT, tick);
        else {
          c = emptyCommand();
          c.yaw = s.yaw; c.pitch = s.pitch; c.moveX = s.moveX; c.moveY = s.moveY;
          if (s.target) c.target = s.target;
          const down = new Set([...s.press, ...s.hold]);
          for (const k of new Set([...down, ...s.prev])) c.buttons[k] = { down: down.has(k), pressed: down.has(k) && !s.prev.has(k), released: !down.has(k) && s.prev.has(k) };
          s.prev = down; s.press.clear();
        }
        e.status.update(DT); e.health.update(DT);
        if (world.revives.handleInput(e, c, DT)) { e.movement.kneel(); c = { ...c, moveX: 0, moveY: 0, buttons: { interact: c.buttons.interact } }; }
        else if (world.support.repairInput(e, c, DT)) { e.movement.kneel(); c = { ...c, moveX: 0, moveY: 0, buttons: { dig: c.buttons.dig } }; }
        if (world.vehicles.handleInput(e, c, DT)) { e.movement.update(c, DT); continue; } // driving or riding
        if (e.stratagems) c = e.stratagems.handleInput(c, DT);
        world.support.itemInput(e, c);
        e.movement.update(c, DT);
        e.movement.state.speedScale = e.status.speedMul;
        if (s.brain) { const r = routeCommand(e, c); e.abilities.update(c, DT); e.melee.update(r.meleeCmd, DT); e.weapons.update(r.gunCmd, DT); }
        else { e.abilities.update(c, DT); e.melee.update(c, DT); e.weapons.update(c, DT); }
      }
      world.update(DT);
      melee.resolve();
      world.bp?.update(DT);
      world.barks.update(DT);
    }
  }
  const seconds = (s) => step(Math.round(s / DT));
  const hold = (e, ...keys) => keys.forEach((k) => fighters.get(e).hold.add(k));
  const release = (e, ...keys) => keys.forEach((k) => fighters.get(e).hold.delete(k));
  const move = (e, x, y) => Object.assign(fighters.get(e), { moveX: x, moveY: y });
  /** Mark a point for indirect fire (what the fire-control view or a fire mission sends). */
  const target = (e, x, z) => Object.assign(fighters.get(e), { target: x == null ? null : [x, z] });
  const brainOf = (e) => fighters.get(e)?.brain;
  return { world, fighter, bot, brainOf, press, hold, release, aim, aimAt, move, target, step, seconds };
}
