// The melee arsenal (data/weapons/melee.json): a weapon with `base` is that weapon's moveset with
// its own numbers merged over it, so a spear or a cleaver is a page of differences, not a copy.

import { deepMerge } from '../weapons/WeaponDefs.js';

const cache = new WeakMap();   // weapons list -> Map(id -> resolved weapon)

/** The weapon `id` from a melee.json weapons list, its base merged in (null if there's no such weapon). */
export function meleeWeapon(list, id) {
  let byId = cache.get(list);
  if (!byId) { byId = new Map(); cache.set(list, byId); }
  if (byId.has(id)) return byId.get(id);
  const w = list.find((x) => x.id === id);
  if (!w) return null;
  const { base, ...own } = w;
  const out = base ? deepMerge(structuredClone(meleeWeapon(list, base) ?? {}), own) : w;
  byId.set(id, out);
  return out;
}

/** A class's melee weapon: its loadout's, else its faction's flame sword, else the first. */
export function meleeFor(list, cls, faction) {
  return meleeWeapon(list, cls?.loadout?.melee) ?? meleeWeapon(list, faction === 'void' ? 'void_ashsworn_blade' : 'solari_dawnblade') ?? list[0];
}
