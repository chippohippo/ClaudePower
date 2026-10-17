# Vehicles

Companion to [ARCHITECTURE.md](ARCHITECTURE.md) and [ABILITIES.md](ABILITIES.md).
Code: `src/vehicles/VehicleSystem.js` (sim) · `src/vehicles/CarPhysics.js` (the cars' rigid body) ·
`src/vehicles/FieldGuns.js` (crew-served guns) · `src/vfx/VehicleViews.js` (views) · models:
`src/render/VehicleKit.js` · bot drivers: `src/ai/VehiclePilot.js`, gun crews and truck drivers:
`src/ai/CrewPilot.js` · fire control: `src/ui/FireControl.js` · data: `data/vehicles.json` · tests:
`tests/vehicles.test.mjs`, `tests/vehicles-car.test.mjs`, `tests/artillery.test.mjs` (and
`tests/squads.test.mjs` for armor in the trench war) · art lab: `?station=cars`.

## Roster

| Vehicle | Faction | Model | HP | Seats | Weapons | Counterplay |
|---|---|---|---|---|---|---|
| Sunrunner Hoverbike | Solari | hover | 450 | driver (exposed) | Twin Blasters (heat) | Shoot the exposed rider; tripwires and snares; it shatters if it crashes at speed |
| Wraith-Skiff | Void | hover | 420 | driver (exposed) | Shard Repeater | Its phase boost ignores ram self-damage but not hitscan |
| Aegis Light Tank | Solari | tracked | 2400 | driver, gunner | Sunfire Cannon (splash) · Coax Repeater | Turret turns at 70°/s, so circle it; rear vent weak spot; ion ammo; Suppress = EMP |
| Monolith Crawler | Void | tracked | 2600 | driver, gunner | Rift Mortar (arcing, pulls) · Leech Beam | Mortar arcs slowly; rear vent weak spot |
| Dawnship Dropship | Solari | flyer | 3000 | pilot, door gunner, 4 passengers | Wing Cannons · Door Gun | Ambush the landing zone; Gravity Flak or Root makes it sink |
| Rift Carrier | Void | flyer | 2800 | pilot, door gunner, 4 passengers | Void Lances · Door Gun | Same as the Dawnship |
| Sunhammer Field Gun / Rift Bombard | Solari / Void | towed howitzer | 1100 / 1000 | commander, loader | 320 / 300 shell, 9 / 10.5 m burst, 16 rounds | Counter-battery fire (it gives itself away firing); it can't move once set up; crews out in the open |
| Starfall / Swarm Rocket Battery | Solari / Void | self-propelled | 1500 | commander, loader | 16-rocket salvo (170 / 160, 6.5 / 7 m), 48 rockets | 28 s reload between salvos; wide scatter; anchored while set up |
| Lance AT Gun / Spike Cannon | Solari / Void | towed AT gun | 700 / 650 | commander, loader | 460 antitank slug (×2.2 on armor), 20 rounds | Low and slow to swing (14°/s past its 30° arc); shell it or flank it |
| Hauler / Crawler Supply Truck | Solari / Void | truck | 1000 | driver, 2 passengers | 150 supplies | Its cargo burns with it: interdict the road |
| Kestrel Recon Car / Jackal Raider | Solari / Void | car | 1600 / 1400 | driver, ring gunner (exposed), 3 passengers (exposed, own guns) | Ring-Mount HMG (heat) | The gunner and passengers are in the open; trip it on a kerb or rubble at speed, or put a blast beside it, and it rolls and throws them all out |

## Recon cars (`CarPhysics`)

The cars are built to drive the way players describe the Helldivers 2 recon car, and to crash the
way they love it crashing: "it's really fun when your characters get into a car accident and the
car flips and you get flung out".

**What the research said.** The HD2 FRV is light and floaty on soft, bouncy suspension. It has a
rear-biased drive that oversteers and a handbrake that locks the rears for slides. There is no air
control, and top speed is about 75 km/h. It rolls on kerbs and bad landings. Hard hits and
rollovers throw out the gunner and anyone leaning out, while seated occupants stay in but get
hurt. Bailing out at speed keeps the car's speed. There is no ram damage below about 30 km/h. A
killed car burns for several seconds and then explodes. Players' complaints were that it flips on
flat ground and can't be righted, so we fixed both (sources: helldivers.wiki.gg M-102 FRV and
patch 01.002.101, helldivers.fandom.com, Steam community threads, MP1st patch notes).

**The model** (`src/vehicles/CarPhysics.js`, the `car` block in vehicles.json): one rigid body
(mass, box inertia, quaternion), integrated in two substeps a tick and deterministic.
- **Four raycast wheels** on spring-and-damper struts (k 42 kN/m, c 2.6 kN·s/m, 0.46 m travel):
  it squats under power, dives under braking and leans into turns. The struts read the terrain
  and anything low enough to drive onto (a kerb, rubble, a sandbag top). The damper force is
  capped, so a kerb is a jolt, not a launch.
- **Tyres:** lateral grip is what it takes to stop the sideways slide, capped by a slip curve
  that falls to 72% past the peak slip angle (that's a drift). Drive, brakes and rolling
  resistance act along the wheel, inside a friction circle.
- **Engine and controls:** the drive fades toward top speed, 72% of it to the rear (Void 82%).
  Brakes act on all four wheels, and the handbrake locks the rears (Space). Steering ramps in
  and narrows from 0.58 rad slow to 0.17 rad at top speed. Back on the stick brakes, then
  reverses. In the air, nothing.
- **Hull collision:** 30 points (a floor grid, the bumpers, the sides, the cage roof) against the
  terrain and the cover boxes. Each point leaves a box by the face it came in through. Boxes
  poking in between the points (posts, bollards) are caught by their own corners. A lip under
  0.12 m is ridden over. A wall hit at an angle spins the car, and a car on its roof slides to a
  stop on it.
- **Kerb trips:** a step under a wheel that is sliding across it (from 4 cm, fully at 16 cm)
  stops the slide at the tyre's contact, low under the centre of mass. That is what rolls a car
  over. On the flat it never rolls: its tipping threshold (track/2 ÷ CoM height ≈ 1.33) is above
  the tyres' grip (1.1).
- **Measured** (tests/vehicles-car.test.mjs, `.scratch` probes):
  - 0–60 km/h in about 3 s; top speed 74 km/h (Void 81); coasts long; brakes from top speed in
    about 2 s.
  - A full-lock handbrake J-turn at top speed stays on its wheels.
  - Sliding sideways into a 20 cm kerb: tips at 9 m/s, rolls over at 12 m/s, lands on its roof
    at 15 m/s.
  - Off a 1.6 m ramp at 19 m/s: 0.9 s in the air, 20 m long.

**What happens to the people in it** (VehicleSystem `#crash`):
- **Hard hits:** a hit's speed change (m/s) damages the car past 5 m/s.
- **Thrown out:** past 6.5 m/s every exposed rider is thrown on with the speed the car had (a
  ragdoll, shoved at head height so he goes head over heels).
- **Rollovers:** once the car is past its tipping point (53°), the open seats empty. Riders go
  out of the hatch the way the roof is going over, at least 4 m/s, with the speed their seat
  had.
- **Strapped in:** the driver stays in, hurt by hits past 9 m/s, and climbs out once the car
  lies still on its side or roof.
- **Bailing out:** you keep the car's speed, and past 7 m/s you tumble.
- **No run-overs by your own ride:** a vehicle never runs over the person who just left it.

**Righting it:** beside one of your cars on its side or roof, hold X for 1.5 s and you push it
back onto its wheels (the HUD prompts with a bar). Bots do it for a car of theirs lying within
18 m. Blasts can turn a car either way.

**Blasts:** any explosion shoves cars at the hull point nearest the burst, upward and outward,
in proportion to (knockback − 4). A grenade rocks a car. A shell beside it or an orbital strike
turns it over.

**Running people over:** from 30 km/h (8.3 m/s), 9 damage per m/s. Each hit costs the car 10%
of its speed.

**Killed:** the car burns for 6 s (flames, a flickering light, black smoke; `vehicle:burning`),
then blows. Bots bail out of a burning car at once. Whoever stays aboard is thrown out of the
blast, hurt.

**Seats:**
- **Driver:** `shown`, protected but drawn while the car is upright.
- **Ring gunner:** stands at the HMG (pose `stand`, standing hit spheres), exposed.
- **Three passengers:** exposed and `ownWeapon`. They lean out and fire their own guns from the
  seat at chest height (a hit on the move spreads more).

**Bots** (`VehiclePilot`):
- **Driving:** they steer the wheels toward the objective, lifting off for wide corners and
  braking for hairpins. When stuck they back off.
- **In a fight:** with guns aboard they circle the target at 20–40 m (in from far, round, out
  when close). An aggressive driver, or one alone, runs infantry down instead.
- **Gunners:** fire in heat bursts and let the gun cool right down, holding the chest and
  pulling down against the recoil.
- **Passengers:** ride along when a teammate drives past and shoot from the seats. They get out
  where it pulls up near the fight or the objective, and don't hop back in for 40 s.

**Where they come from:** a Recon Vehicle call-in (LDRU, 800 BP), and a recon pad in the motor
pool from 12v12 up (respawn 30 s, 35 supplies).

## Field guns (`FieldGuns`)

Crew-served guns are vehicles with a `gun` block. Towed guns move at a walk (2.4 m/s for a
howitzer, 3.2 for an AT gun) while the commander pushes them with tank controls, or they follow a
truck: **H** in a truck hitches the gun behind it. Rocket batteries drive themselves (11 m/s).

| | Howitzer | Rocket battery | AT gun |
|---|---|---|---|
| Set up / pack up (H) | 4.5–5 s / 3.5 s | 3 s / 2.5 s | 1.6 s / 1.4 s |
| Traverse, then swinging the carriage | ±30°, then 6°/s | ±40° | ±30°, then 14°/s |
| Fire | indirect, at a marked point; every round comes down at 52° | indirect, 45°, a 16-rocket ripple | direct, along the commander's aim (330 m/s, slight drop) |
| Range | ~55 m – 1.6 km | ~170 m – 1.5 km | as far as you can see |
| Scatter (1σ) | 4 m + 0.8% of the range | 9 m + 2% of the range | 0.07° |
| Reload | 5.5–6 s (faster with a loader) | 28 s per salvo | 3.2 s |

- **Indirect fire:** the fire-control computer solves the charge (muzzle speed) that puts the round
  on the mark at the gun's fixed arc: `v² = gR² / (2 cos²θ (R tanθ − Δh))`. The gun fires once the
  barrel is laid and a round is loaded, as long as fire is held.
- **Shells** fly as real projectiles with gravity. On impact they crater the ground (no deeper than
  a soldier can climb out of), destroy cover within the burst, cut wire, and update the nav grid.
  A round that bursts on hard cover doesn't crater. Every round in the air is listed in
  `incoming` with where and when it lands: the audio plays its whistle, and soldiers under it go
  prone.
- **Ammo:** rounds carried up to `ammoMax`; Logistics refills them from a depot within 320 m.
- **Supply trucks** carry 150 supplies. Standing still in a depot they load or unload by themselves.
  The cargo is shown as crates in the bed, and a destroyed truck loses it.

**Fire control** (`FireControl`, presentation only: the sim gets the same `Command` a bot sends):

- **Howitzer or rocket battery** (set up, commander's seat): the view goes overhead over the mark.
  The mouse moves the mark (faster the further out it is). On screen are the predicted arc, the
  2σ scatter ring, range, flight time, spread, rounds left and the loading bar. The gun's state
  reads laying, ready, loading, out of range, too close, or swinging the trail. Hold fire to keep
  shooting.
- **AT gun:** the normal camera plus a second reticle where the barrel really points (it lays at its
  own rate).
- **Any gun:** setting-up and packing-up progress, and what H does next.
- **Trucks:** cargo, what's being loaded or unloaded, and the gun on the hook.

## Feel

- **Entry and exit:** press X within range to take the first free seat (driver first). Input
  is locked for only 0.35 s. Press X again to hop out to the first clear side, keeping half the
  vehicle's momentum. You can't enter enemy vehicles, or enter while in a transform super.
- **Hover:** steers toward the camera at its turn rate. Low lateral grip makes it drift. Shift
  boosts (34 m/s) on a cooldown, and S cuts a boost short. It floats over low cover such as
  crates and banks into turns. It rides on the highest ground under its hull, so it lifts over a
  trench parapet instead of dropping into the trench. Hit something at more than 17 m/s and the
  rider goes over the bars: thrown up and on, a ragdoll. Bot riders look down their lane (its
  middle and both edges) before they boost, and brake and swing wide of a wall coming up.
- **Car:** see "Recon cars" above.
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
  marker, and the caster hops straight in if they're still close. An enemy standing on the
  marker denies the drop. If a teammate or another vehicle is standing there, it lands at the
  nearest clear spot beside them, on the caster's side. Calling again scraps your previous
  called vehicle if it's empty.

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
- Aircraft on the Western Front (the dropships fly in the arena; spotter planes calling in fire would suit the artillery war).
- Infantry riding along on a tank's hull, and crews coordinating with their squad's assault (smoke, holding at the wire).
- Lock-on launchers (an anti-vehicle class tool) and vehicle-specific abilities (tank smoke, dropship flares).
- Seat switching inside a vehicle (F1–F4).
- Cars: tyres you can shoot out (a swerve, understeer, a flip under braking), surfaces (ice, mud),
  a burned-out husk left where a car blew, and occupants that tilt with the car as it rolls.
