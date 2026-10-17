# Vehicles

Companion to [ARCHITECTURE.md](ARCHITECTURE.md) and [ABILITIES.md](ABILITIES.md).
Code: `src/vehicles/VehicleSystem.js` (sim) · `src/vfx/VehicleViews.js` (graybox views) ·
bot drivers: `src/ai/VehiclePilot.js` · data: `data/vehicles.json` · tests: `tests/vehicles.test.mjs`
(and `tests/squads.test.mjs` for armor in the trench war).

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
  It rides on the highest ground under its hull, so it lifts over a trench parapet instead of
  dropping into the trench.
- **Tracked:** W/S throttle and A/D turn the hull. The turret follows the camera at its own
  limited rate, which is the counterplay. It climbs cover up to 0.5 m and crushes destructible
  cover up to 2 m tall (below). Anything else taller stops it.
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

## The trench war (Frontline)

Armor is what breaks a trench line, so tanks are built to cross one:

- **Bridging:** a hull rests on the highest ground under its footprint, sampled at the centre,
  nose, tail and both sides (`#support`). A tank spans a 2 m fire trench on its edges instead of
  nosing into it, and settles smoothly once it's across. A hover vehicle uses the same support,
  plus its hover height.
- **Crushing:** above 0.8 m/s, a tracked vehicle crushes destructible cover under its tracks
  (`world.removeCover`). That means sandbag parapets, crates, broken walls and dug-in positions up to
  2 m tall, and each one costs it 7% of its speed.
  - A tank crossing a trench line leaves a gap in the parapet behind it.
  - The gap is real everywhere: `world:coverDestroyed` (`crushed: true`) updates the nav grid,
    the tactical map's cover spots and the renderer.
  - Each crush is credited to the driver.
- **Wire:** above 1 m/s, the tracks flatten barbed wire under the hull (`world.cutWire`, the same
  call explosions use). The nav grid drops the wire's cost there, so infantry routes run through
  the lane it leaves.
- **Motor pools:** each line sector has a cleared, flattened pool per team, on that team's side
  of the sector (`sector.pool[team]`), with the pads in a row 9 m apart. Nothing else is built on
  it. The pads start in the pool of the team's starting front sector.
  - When the front moves (`mode:front`), every pad moves up to the new pool
    (`VehicleSystem.movePad`). An empty vehicle more than 15 m from its new pad is taken away and
    turns up there 5 s later. An occupied one stays with its crew.
- **Deploying in a vehicle:** a reinforcing bot can deploy straight into the driver's seat of an
  empty pad vehicle in its motor pool. The vehicle has to be at its pad and above half health.
  Bots with `usesVehicles: 'always'` always take it; `opportunistic` bots take it 30% of the time.
- **Bot drivers** (`VehiclePilot`):
  - **Nothing in sight:** the driver advances on its squad's objective along the shared flow field.
    Tanks stop 30 m short and cover the point; other vehicles stop at 10 m.
  - **Stuck** on a wall, a wreck or a building: the driver reverses and turns away for a moment.
  - **Target in sight:** tanks hold an 18–35 m standoff facing the target, so the thick front
    armor takes the hits.
- **Crew:** squad tactics leave anyone in a vehicle out of the squad's formation and orders.
  A crew fights for its own squad's objective.

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
- Infantry riding along on a tank's hull, and crews coordinating with their squad's assault (smoke, holding at the wire).
- Lock-on launchers (an anti-vehicle class tool) and vehicle-specific abilities (tank smoke, dropship flares).
- Seat switching inside a vehicle (F1–F4), and passengers firing their own weapons from open bays.
