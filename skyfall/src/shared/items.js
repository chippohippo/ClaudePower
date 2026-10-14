// Item catalogue + loot tables. Items live in the world as {id, item, n (count), x, y, z, tier}.

import { WEAPONS, AMMO } from './weapons.js';

export const RARITY = ['#c8c8c8', '#3fa9ff', '#b94dff', '#ffd23f', '#ff3b3b'];
export const RARITY_NAMES = ['Common', 'Rare', 'Epic', 'Legendary', 'Mythic'];

export const CONSUMABLES = {
  syringe: { name: 'Quick Patch', heal: 25, time: 5, stack: 4, rarity: 0 },
  medkit: { name: 'Trauma Kit', heal: 100, time: 8, stack: 2, rarity: 1 },
  cell: { name: 'Aegis Cell', shield: 25, time: 3, stack: 4, rarity: 0 },
  battery: { name: 'Aegis Battery', shield: 100, time: 5, stack: 2, rarity: 1 },
  phoenix: { name: 'Ember Kit', heal: 100, shield: 100, time: 10, stack: 1, rarity: 2 },
};

export const GRENADES = {
  frag: { name: 'Frag Grenade', stack: 2, fuse: 3.0, radius: 7, damage: 100, rarity: 1 },
  arc: { name: 'Spark Disc', stack: 2, fuse: 1.6, radius: 5, damage: 60, sticky: true, slow: true, rarity: 1 },
};

export const ATTACHMENTS = {
  // magazines are ammo-specific, like Apex: a light mag only fits light-ammo guns
  mag_light: { name: 'Extended Light Mag', slot: 'mag', levels: 3, ammo: 'light' },
  mag_heavy: { name: 'Extended Heavy Mag', slot: 'mag', levels: 3, ammo: 'heavy' },
  mag_energy: { name: 'Extended Energy Mag', slot: 'mag', levels: 3, ammo: 'energy' },
  mag_sniper: { name: 'Extended Sniper Mag', slot: 'mag', levels: 3, ammo: 'sniper' },
  barrel: { name: 'Recoil Compensator', slot: 'barrel', levels: 3, recoilMul: [1, 0.88, 0.8, 0.72] },
  stock: { name: 'Tactical Stock', slot: 'stock', levels: 3, handling: [1, 0.85, 0.75, 0.65] },
  optic1: { name: '1x Holo Sight', slot: 'optic', zoom: 1.25 },
  optic2: { name: '2x Holo Sight', slot: 'optic', zoom: 2.0 },
  optic3: { name: '3x Longsight', slot: 'optic', zoom: 3.0 },
};

// Which attachment slots each class accepts.
export const CLASS_SLOTS = {
  AR: ['mag', 'barrel', 'stock', 'optic'],
  SMG: ['mag', 'barrel', 'stock', 'optic'],
  LMG: ['mag', 'barrel', 'stock', 'optic'],
  Shotgun: ['stock', 'optic'],
  Marksman: ['mag', 'barrel', 'stock', 'optic'],
  Sniper: ['mag', 'stock', 'optic'],
  Pistol: ['mag', 'barrel', 'optic'],
};

// Normalised item key format:
//   w:<weaponId>       weapon (tier stored on world item)
//   a:<ammoType>       ammo
//   c:<consumable>
//   g:<grenade>
//   armor              body shield (tier 1-4)
//   helmet             helmet (tier 1-3)
//   pack               backpack (tier 1-3)
//   x:<attachment>     attachment (tier = level for mag/barrel/stock)
export function itemName(key, tier = 0) {
  const [t, id] = key.split(':');
  if (t === 'w') return WEAPONS[id].name;
  if (t === 'a') return AMMO[id].label + ' Ammo';
  if (t === 'c') return CONSUMABLES[id].name;
  if (t === 'g') return GRENADES[id].name;
  if (t === 'x') {
    const a = ATTACHMENTS[id];
    return a.levels ? `${a.name} Lv${tier}` : a.name;
  }
  if (key === 'armor') return `Adapt Armor Lv${tier}`;
  if (key === 'helmet') return `Helmet Lv${tier}`;
  if (key === 'kd') return `Fallback Shield Lv${tier}`;
  if (key === 'pack') return `Backpack Lv${tier}`;
  return key;
}

export function itemRarity(key, tier = 0) {
  const [t, id] = key.split(':');
  if (t === 'c') return CONSUMABLES[id].rarity;
  if (t === 'g') return GRENADES[id].rarity;
  if (t === 'a') return 0;
  if (t === 'w') return tier;
  if (t === 'x') return ATTACHMENTS[id].levels ? tier - 1 : id === 'optic1' ? 0 : id === 'optic2' ? 1 : 2;
  if (key === 'armor') return Math.max(0, tier - 1);
  return Math.max(0, tier - 1);
}

export function stackSize(key) {
  const [t, id] = key.split(':');
  if (t === 'a') return AMMO[id].stack;
  if (t === 'c') return CONSUMABLES[id].stack;
  if (t === 'g') return GRENADES[id].stack;
  return 1;
}

// Loot tables per zone tier (0 = low, 1 = mid, 2 = hot zone). Like Apex since Season 20 there is
// no body armor on the floor: everyone drops in white Adapt Armor and levels it with evo points.
// Weapons usually come with a stack of their ammo beside them (returned in `extra`).
export function rollLoot(rng, zoneTier) {
  const r = rng();
  const tierRoll = () => {
    const x = rng() + zoneTier * 0.18;
    return x > 1.12 ? 3 : x > 0.85 ? 2 : x > 0.5 ? 1 : 0;
  };
  if (r < 0.27) {
    const wid = rng.pick(['talon', 'talon', 'mauler', 'hornet', 'hornet', 'volt', 'bulwark', 'breacher', 'breacher', 'scout', 'sentinel', 'viper', 'viper', 'p20', 'p20']);
    const out = { item: 'w:' + wid, n: 1, tier: Math.min(3, Math.max(WEAPONS[wid].rarityBase, tierRoll())) };
    if (rng() < 0.7) {
      const a = WEAPONS[wid].ammo;
      out.extra = [{ item: 'a:' + a, n: Math.round(AMMO[a].stack * (a === 'shotgun' || a === 'sniper' ? 0.5 : 0.4)), tier: 0 }];
    }
    return out;
  }
  if (r < 0.5) {
    const a = rng.pick(['light', 'light', 'heavy', 'heavy', 'energy', 'shotgun', 'sniper', 'sniper']);
    return { item: 'a:' + a, n: Math.round(AMMO[a].stack * (a === 'shotgun' || a === 'sniper' ? 0.75 : 0.5)), tier: 0 };
  }
  if (r < 0.72) {
    const c = rng.pick(['syringe', 'syringe', 'cell', 'cell', 'cell', 'medkit', 'battery', 'battery', 'phoenix']);
    return { item: 'c:' + c, n: c === 'syringe' || c === 'cell' ? 2 : 1, tier: 0 };
  }
  if (r < 0.79) return { item: 'g:' + rng.pick(['frag', 'frag', 'arc']), n: 1, tier: 0 };
  if (r < 0.83) return { item: 'helmet', n: 1, tier: Math.min(3, 1 + Math.floor(tierRoll() * 0.7)) };
  if (r < 0.86) return { item: 'kd', n: 1, tier: Math.min(3, 1 + Math.floor(tierRoll() * 0.7)) };
  if (r < 0.9) return { item: 'pack', n: 1, tier: Math.min(3, 1 + Math.floor(tierRoll() * 0.7)) };
  const att = rng.pick(['mag_light', 'mag_light', 'mag_heavy', 'mag_heavy', 'mag_energy', 'mag_sniper', 'barrel', 'stock', 'optic1', 'optic2', 'optic3']);
  const lv = ATTACHMENTS[att].levels ? Math.min(3, 1 + Math.floor(tierRoll() * 0.8)) : 0;
  return { item: 'x:' + att, n: 1, tier: lv };
}

// Fallback Shield (Apex knockdown shield): HP of the frontal shield a downed legend can raise.
export const KD_HP = [0, 100, 250, 750, 750];

export const HELMET_HEAD_REDUCTION = [0, 0.2, 0.4, 0.5];
export const BACKPACK_SLOTS = [8, 10, 12, 14];
