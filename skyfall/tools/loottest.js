// Loot/armor/respawn rules: empty-handed white-armor drop, no floor body armor, guns spawn with
// ammo, evo points from damage and healing, and respawns that keep guns + armor level with low ammo.
import { Match } from '../src/sim/match.js';
import { makeWeapon, pickup } from '../src/sim/inventory.js';
import { SHIELD_TIERS, EVO_THRESHOLDS, BTN, REVIVE_HP } from '../src/shared/constants.js';
import { KD_HP } from '../src/shared/items.js';
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
// ammo-specific mags
const t = m.list[2];
t.weapons = [makeWeapon('viper', 0), null]; t.inv = []; t.active = 0;
pickup(t, { item: 'x:mag_light', n: 1, tier: 2 });
check('light mag does not fit the Raptor (sniper ammo)', t.weapons[0].att.mag === 0);
pickup(t, { item: 'x:mag_sniper', n: 1, tier: 2 });
check('sniper mag fits the Raptor (8 rounds)', t.weapons[0].att.mag === 2);
// Fallback Shield (knockdown shield) + Apex bleed-out / revive rules
const m2 = new Match({ seed: 99, mode: 'trios' });
m2.setupSquads([]);
m2.start();
const [d, mate] = [m2.list[0], m2.list[1]], shooter = m2.list[3];
for (const q of [d, mate, shooter]) { q.inShip = false; q.ms.mode = 'ground'; q.ms.y = 0; }
d.ms.x = 0; d.ms.z = 0; d.ms.yaw = 0; // facing -z
mate.ms.x = 50; mate.ms.z = 50;
shooter.ms.x = 0; shooter.ms.z = -20; // in front
d.kd = 2; d.shield = 0; d.hp = 10;
m2.damage(d, 20, shooter, { part: 'body' });
check('knock sets 90 s bleed-out on first down', d.downed && d.bleed === 90, `bleed ${d.bleed}`);
check('Fallback Shield charged on knock', d.kdHp === KD_HP[2], `kdHp ${d.kdHp}`);
m2._applyMods(d, { buttons: BTN.ADS });
check('aim while downed raises the shield', d.kdUp === true);
const hp0 = d.hp;
m2.damage(d, 30, shooter, { part: 'body' });
check('shield blocks shots from the front', d.hp === hp0 && d.kdHp === KD_HP[2] - 30, `hp ${d.hp} kdHp ${d.kdHp}`);
shooter.ms.z = 20; // behind
m2.damage(d, 30, shooter, { part: 'body' });
check('shots from behind still hurt', d.hp === hp0 - 30, `hp ${d.hp}`);
// revive, then second knock bleeds faster
d.downed = false; d.ms.downed = 0; d.hp = REVIVE_HP;
check('revive HP is 20 (Apex)', REVIVE_HP === 20);
m2.damage(d, 100, shooter, { part: 'body' });
check('second knock bleeds out in 60 s', d.downed && d.bleed === 60, `bleed ${d.bleed}`);
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
