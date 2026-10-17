// FighterFactory: builds a complete fighter for any class in data/classes/*.json (stats, movement
// mods, weapons, sword, ability kit). Presentation-free; the demo adds its own meshes on top.

import { MovementController, FlatGroundBody } from '../movement/MovementController.js';
import { WeaponComponent, WeaponInstance } from '../combat/weapons/WeaponSystem.js';
import { buildWeapon } from '../combat/weapons/WeaponDefs.js';
import { AbilityComponent } from '../combat/AbilitySystem.js';
import { StatusComponent } from '../combat/StatusSystem.js';
import { MeleeComponent } from '../combat/melee/MeleeSystem.js';
import { meleeFor } from '../combat/melee/MeleeWeapons.js';
import { Health } from '../combat/Health.js';
import { reactToHit } from '../combat/HitReactions.js';
import { silhouetteScale } from '../movement/Hitboxes.js';
import { StratagemComponent } from '../combat/Stratagems.js';

const FALLBACK_GUN = { solari: 'sol_ar_halcyon', void: 'void_ar_gnaw' };

/**
 * data = { movement, weaponFiles: [ballistic, energy, ...], attachments, recoil, statuses,
 *          meleeWeapons, kits: { classId: kit }, classes: [solariFile, voidFile] }
 */
export function findClass(data, classId) {
  for (const file of data.classes) {
    const c = file.classes.find((x) => x.id === classId);
    if (c) return { cls: c, faction: file.faction.id };
  }
  throw new Error(`Unknown class "${classId}"`);
}

/** Every gun the class lists that exists in the weapon files (melee entries skipped), else a faction default. */
export function resolveGuns(data, cls, faction) {
  const ids = [...(cls.loadout?.primary ?? []), ...(cls.loadout?.secondary ?? [])];
  const out = [];
  for (const id of ids) {
    const file = data.weaponFiles.find((f) => f.weapons.some((w) => w.id === id));
    if (file && out.length < 2) out.push(buildWeapon(file, id, data.attachments ?? [], []));
  }
  if (!out.length) {
    const id = FALLBACK_GUN[faction];
    out.push(buildWeapon(data.weaponFiles.find((f) => f.weapons.some((w) => w.id === id)), id, [], []));
  }
  return out;
}

export function buildFighter(world, data, { id, team, classId, pos, cover = world.cover }) {
  const { cls, faction } = findClass(data, classId);
  const movement = new MovementController(data.movement, new FlatGroundBody(pos, cover, { terrain: world.terrain }), cls.movement ?? {}, id);
  movement.state.position.copy(pos);
  const e = { id, team, classId, faction, mode: 'gun', movement };
  e.health = new Health(e, { health: cls.health ?? 100, shield: cls.shield ?? cls.leechArmor ?? 0, armor: cls.armor ?? 'flesh', down: data.down ?? null });
  e.role = cls.role ?? null;
  e.status = new StatusComponent(e, data.statuses, world);
  movement.hooks.fallDamage = (amount) => e.health.damage(amount, { kind: 'fall' }, null);
  movement.hooks.vital = () => (e.health.dead ? 'dead' : e.health.downed ? 'downed' : 'alive');
  movement.hooks.scale = () => silhouetteScale(e);
  e.onHit = (res, info, by) => reactToHit(e, res, info, by);
  // Downed or killed on an exposed seat: you come off the vehicle (and the ragdoll takes over).
  e.onDowned = () => { if (e.vehicle) world.vehicles.exit(e, { eject: true }); };
  e.onDied = () => { if (e.vehicle) world.vehicles.exit(e, { eject: true }); };
  e.onRevived = () => e.movement.getUpFromDown();
  e.melee = new MeleeComponent(meleeFor(data.meleeWeapons, cls, faction), e, world);   // the class's own blade (data/weapons/melee.json)
  e.weapons = new WeaponComponent(e, resolveGuns(data, cls, faction).map((s) => new WeaponInstance(s, data.recoil)), world);
  e.abilities = new AbilityComponent(e, data.kits[classId], world);
  // Call-ins: the common pair and the role's (data/stratagems.json), if the world has any.
  if (world.stratagems?.data) e.stratagems = new StratagemComponent(e, world.stratagems, world.stratagems.loadoutFor(e.role));
  // The class passive (data/passives.json) and the role's support items (data/support.json).
  world.passives?.attach(e, cls.passive?.id);
  if (world.support?.data) world.support.equip(e);
  e.ai = cls.ai;
  world.add(e);
  return e;
}
