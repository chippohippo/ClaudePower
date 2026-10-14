// Loot/armor/respawn rules: empty-handed white-armor drop, no floor body armor, guns spawn with
// ammo, evo points from damage and healing, and respawns that keep guns + armor level with low ammo.
import { Match } from '../src/sim/match.js';
import { makeWeapon } from '../src/sim/inventory.js';
import { SHIELD_TIERS, EVO_THRESHOLDS } from '../src/shared/constants.js';
import { WEAPONS } from '../src/shared/weapons.js';
import { buildMap } from '../src/shared/map.js';

let fails = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name, extra); if (!ok) fails++; };

const m = new Match({ seed: 4321, mode: 'trios' });
m.setupSquads([]);
m.start();
const a = m.list[0], b = m.list[3];
check('drop empty-handed', m.list.every((p) => !p.weapons[0] && !p.weapons[1] && p.inv.length === 0));
check('drop in white armor, full shields', m.list.every((p) => p.armor === 1 && p.shield === SHIELD_TIERS[1]));
const loot = [...m.loot.values()];
check('no body armor on the floor', !loot.some((l) => l.item === 'armor'), `${loot.length} items`);
const guns = loot.filter((l) => l.item.startsWith('w:'));
const withAmmo = guns.filter((g) => loot.some((l) => l.item === 'a:' + WEAPONS[g.item.slice(2)].ammo && Math.hypot(l.x - g.x, l.z - g.z) < 0.7 && Math.abs(l.y - g.y) < 0.1));
check('most guns spawn with their ammo', withAmmo.length / guns.length > 0.5, `${withAmmo.length}/${guns.length}`);
check('raptor magnum on the floor', guns.some((g) => g.item === 'w:viper'));
const map = buildMap(4321);
const highBins = map.bins.filter((bn) => bn.y - map.terrain.height(bn.x, bn.z) > 2);
check('bins on rooftops / landmarks', highBins.length > 0, `${highBins.length} of ${map.bins.length}`);

// evo from damage
a.inShip = false; b.inShip = false;
m.damage(b, EVO_THRESHOLDS[1] * 0.6, a, { part: 'body' });
b.hp = 100; b.shield = 50; b.downed = false; b.alive = true;
m.damage(b, EVO_THRESHOLDS[1] * 0.5, a, { part: 'body' });
check('damage levels armor to blue (shields refilled)', a.armor === 2 && a.shield === SHIELD_TIERS[2], `armor ${a.armor} evo ${a.evoDmg.toFixed(0)}`);
// evo from self healing
a.shield = 0; a.evoDmg = 0;
a.inv.push({ item: 'c:battery', n: 1, tier: 0 });
a.healing = { item: 'c:battery', t: 0 };
m.tick(1 / 30);
check('shield battery restores shields', a.shield === SHIELD_TIERS[a.armor], `shield ${a.shield}`);
check('healing grants evo points', a.evoDmg > 0, `evo ${a.evoDmg}`);

// respawn keeps guns + armor, low ammo
const v = m.list[1];
v.inShip = false;
v.weapons = [makeWeapon('viper', 2), makeWeapon('talon', 1)];
v.armor = 3; v.shield = SHIELD_TIERS[3];
v.inv = [{ item: 'a:sniper', n: 24, tier: 0 }, { item: 'a:light', n: 60, tier: 0 }];
v.downed = true;
m.eliminate(v, b, { weapon: 'test' });
check('eliminated drops kit into a box', !v.weapons[0] && v.armor === 0);
m._respawn(v, map.beacons[0]);
const ammo = v.inv.filter((s) => s.item.startsWith('a:')).reduce((s, x) => s + x.n, 0);
check('respawn keeps weapons', v.weapons[0]?.id === 'viper' && v.weapons[1]?.id === 'talon' && v.weapons[0].tier === 2);
check('respawn keeps armor level', v.armor === 3 && v.shield === SHIELD_TIERS[3]);
check('respawn has little ammo', ammo > 0 && ammo <= 40, `${ammo} rounds in reserve`);
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
