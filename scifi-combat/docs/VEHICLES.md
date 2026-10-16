# Vehicles

Companion to [ARCHITECTURE.md](ARCHITECTURE.md) and [ABILITIES.md](ABILITIES.md).
Code: `src/vehicles/VehicleSystem.js` (sim) · `src/vfx/VehicleViews.js` (graybox views) ·
data: `data/vehicles.json` · tests: `tests/vehicles.test.mjs`.

## Roster

| Vehicle | Faction | Model | HP | Seats | Weapons | Counterplay |
|---|---|---|---|---|---|---|
| Sunrunner Hoverbike | Solari | hover | 450 | driver (exposed) | Twin Blasters (heat) | Shoot the exposed rider; tripwires and snares; it shatters if it crashes at speed |
| Wraith-Skiff | Void | hover | 420 | driver (exposed) | Shard Repeater | Its phase boost ignores ram self-damage but not hitscan |
| Aegis Light Tank | Solari | tracked | 2400 | driver, gunner | Sunfire Cannon (splash) · Coax Repeater | Turret turns at 70°/s, so circle it; rear vent weak spot; ion ammo; Suppress = EMP |
| Monolith Crawler | Void | tracked | 2600 | driver, gunner | Rift Mortar (arcing, pulls) · Leech Beam | Mortar arcs slowly; rear vent weak spot |
| Dawnship Dropship | Solari | flyer | 3000 | pilot, door gunner, 4 passengers | Wing Cannons · Door Gun | Ambush the landing zone; Gravity Flak or Root makes it sink |
| Rift Carrier | Void | flyer | 2800 | pilot, door gunner, 4 passengers | Void Lances · Door Gun | Same as the Dawnship |

## Feel

- **Entry and exit:** press X within range to take the first free seat (driver first). Input
  is locked for only 0.35 s. Press X again to hop out to the first clear side, keeping half the
  vehicle's momentum. You can't enter enemy vehicles, or enter while in a transform super.
- **Hover:** steers toward the camera at its turn rate. Low lateral grip makes it drift. Shift
  boosts (34 m/s) on a cooldown. It floats over low cover such as crates and banks into turns.
- **Tracked:** W/S throttle and A/D turn the hull. The turret follows the camera at its own
  limited rate, which is the counterplay. It can't climb cover taller than 0.5 m.
- **Flyer:** steers toward the camera; Space climbs and C descends (0–35 m). Passengers ride in
  enclosed seats and can drop out at any altitude.
- **Seat aiming:** hull guns fire within ±25° of the nose, turret guns along the turret, and free
  mounts (door guns, coax) anywhere.
- **Camera:** forced third person at the vehicle's own distance and height. It restores first
  person when you get out if you were using it.

## Combat rules

- **Damage:** vehicles use the new `vehicle` armor type in the damage matrix. Kinetic ×0.35,
  ion ×2.0, explosive ×1.4.
- **Weak spots:** the rear 30% of tanks and dropships counts as a headshot, and the views make
  the vent glow.
- **Who can be hit:** occupants of enclosed seats can't be hit by guns, splash, abilities,
  zones or swords. Bike riders are exposed.
- **Ramming:** above `ram.minSpeed`, contact damages and knocks back enemies (speed ×
  damagePerMs). Bikes take 25% back (except while phase-boosting); tanks take none.
  Allies are only nudged.
- **Crashing:** hitting cover faster than `crash.minSpeed` damages bikes. Tanks don't take crash damage.
- **Statuses** (vehicles have a StatusComponent):
  - Suppress / Silence: EMP. Weapons and boost go offline.
  - Slow: lower top speed.
  - Root / Stun: the engine stalls, and a stalled flyer sinks.
  - Scorch, Volatile, Blind, Weaken, Haste, Fortify and Radiant don't apply.
- **Destruction:** a 5 m explosion. Every occupant is ejected upward and takes 40 damage.
- **Pads:** Battlefront pickups respawn their vehicle `respawn` seconds after it's destroyed, or
  after it sits empty and far from its pad for `pads.abandonTime` (40 s).
- **Called vehicles:** Skyrider's Call Hoverbike and Driftcaller's Call Wraith-Skiff drop at the
  marker, and the caster hops straight in if they're still close. Calling again scraps your
  previous called vehicle if it's empty.

## Integration

```js
// every sim tick, per fighter, before its own movement/melee/weapons/abilities:
if (world.vehicles.handleInput(entity, cmd)) entity.movement.update(cmd, dt); // driving or riding
else { /* normal on-foot update */ }
world.update(dt); // runs vehicles, projectiles, zones and deployables
```

`world.fighters()` now returns on-foot fighters, exposed riders and vehicles, which is what
area effects, zones and turrets should affect. `VehicleSystem.serialize(v)` gives the compact
state for netcode snapshots.

## Next
- Bots that drive (a utility action that scores vehicle pickups by distance and threat), plus AI gunners.
- Lock-on launchers (an anti-vehicle class tool) and vehicle-specific abilities (tank smoke, dropship flares).
- Seat switching inside a vehicle (F1–F4), and passengers firing their own weapons from open bays.
