# Frontline: 4v4 to 200v200 trench battles

Code: `src/game/frontline/` (MapSizes, FrontlineMap, Trenches, Ruins, City, Fortify, FrontlineMode,
Logistics) · `src/combat/Stratagems.js` · `src/game/BattlePoints.js` · `src/combat/SupportItems.js`, `Passives.js` · `src/game/FrontlineSession.js` · `src/ai/FrontlineCommander.js` · `src/ai/tactics/`
(squads: see [AI.md](AI.md)) · `src/ai/SupportCommand.js`, `CrewPilot.js` (gun crews and drivers) ·
`src/vehicles/FieldGuns.js` (see [VEHICLES.md](VEHICLES.md)) · `src/world/` (Terrain, CoverIndex,
EntityGrid, NavGrid, WireField) · client: `index.html` → `src/frontline.js`,
`src/render/BattlefieldRenderer.js`, `TerrainChunks.js`, `CoverTextures.js`, `CityRenderer.js`, `CityKit.js`, `StratagemKit.js`, `src/ui/FrontlineHud.js`,
`FireControl.js`, `StratagemPanel.js`, `BattlePointsHud.js`, `src/vfx/BattleFx.js`, `StratagemViews.js` · tests: `tests/maps.test.mjs`, `tests/squads.test.mjs`,
`tests/frontline.test.mjs`, `tests/scale.test.mjs`, `tests/down.test.mjs`, `tests/ragdoll.test.mjs`,
`tests/artillery.test.mjs`, `tests/logistics.test.mjs`, `tests/support.test.mjs`,
`tests/warfront.test.mjs`, `tests/stratagems.test.mjs`, `tests/friendly-fire.test.mjs`, `tests/battle-points.test.mjs`,
`tests/support-roles.test.mjs`, `tests/melee-front.test.mjs`, `tests/city-map.test.mjs`.

Battlefront Supremacy crossed with the Western Front. Two armies fight over a line of sectors
separated by WW1 trench lines. Taking every point of the sector in front of your line moves the
front forward, and the fight follows it until one side breaks through to the enemy HQ. Bots fill
every slot and fight in squads: they man the trench, go over the top together on the whistle,
bound from cover to cover, clear buildings room by room, hold the line, and dig in. They use the
same `Command` struct, movement, kits, guns, swords and vehicles as a player.

Behind the line, each army has artillery and a supply chain (12v12 and up). Howitzers and rocket
batteries shell the points ahead of a wave before its whistle and the enemy's trench when they
come over. They also hunt each other's guns. AT guns wait for armor behind the line. Every shell,
magazine, sandbag and replacement tank is hauled from the HQ dump to the forward depot by truck.
The biggest size, **Extreme Warfront**, puts 400 soldiers on a 2.6 km front.

## Play it

Serve the folder statically and open `index.html`:

| Param | Default | |
|---|---|---|
| `size` | 32v32 | `4v4`, `12v12`, `32v32`, `64v64` or `200v200`: the match size and the map built for it |
| `players` | (from size) | 8–400 fighters in total; picks the size built for that count if `size` isn't given |
| `seed` | 7 | map and match seed (deterministic map) |
| `map` | trench | `city`: the same front fought through a city at night (below) |
| `team` | 0 | 0 = Solari (attacks east), 1 = Void (attacks west) |
| `class` | lancer / reaver | any class id from `data/classes/*.json` |
| `difficulty` | veteran | recruit, veteran or elite bot aim and reactions |
| `voices` | on | `off`: the soldiers' callouts as subtitles only |

The controls are the arena's (WASD, Shift sprint, C crouch/prone/slide, Alt dive, Space climb, LMB/RMB,
R, 1 sword/gun, Q E G Z abilities, X vehicles), plus **H** (hold) to dig in and **X** (hold) beside a
downed teammate to revive. When you're down: crawl, hold **Space** to give up; when dead, **Space** to
deploy. Your squad's bots follow you and take cover around you when you stop. At a gun, **X** takes a
crew seat and **H** sets it up or packs it up; at a howitzer or rocket battery the view goes overhead
and the mouse moves the fire mission's mark (hold LMB to fire). In a supply truck, stop inside the
HQ dump to load and inside the forward depot to unload; **H** hitches the gun behind you.
Stratagems: hold **Tab** (or Ctrl) and type the code with WASD or the arrow keys, **LMB** throws the
beacon, **Tab** again puts it away, **X** beside a supply pod takes two mags (pad: hold LB, the D-pad,
RT). `arena.html` is the 4v4 feel lab and `rig-lab.html` the animation lab.

## A map per match size (`MapSizes`, `FrontlineMap`)

| Size | Map | Players | Area | Sectors × lanes | Points | Trench lines | Vehicles per team | Guns and trucks per team |
|---|---|---|---|---|---|---|---|---|
| 4v4 | Outpost | 8 | 260 × 120 m | 3 × 1 | 3 | 2 | — | — |
| 12v12 | Ridgeline | 24 | 520 × 220 m | 3 × 2 | 6 | 2 | 1 hoverbike | 1 howitzer, 1 AT gun · 1 truck |
| 32v32 | Valley | 64 | 900 × 360 m | 5 × 2–3 | 13 | 4 | 1 tank, 2 hoverbikes | 2 howitzers, 1 rocket battery, 2 AT guns · 2 trucks |
| 64v64 | Frontline | 128 | 1400 × 520 m | 7 × 2–3 | 19 | 6 | 2 tanks, 3 hoverbikes | 4 howitzers, 2 rocket batteries, 3 AT guns · 3 trucks |
| 200v200 | Extreme Warfront | 400 | 2600 × 880 m | 11 × 3–4 | 42 | 10 | 4 tanks, 5 hoverbikes | 8 howitzers, 4 rocket batteries, 6 AT guns · 10 trucks |

Each profile also sets terrain relief, point radius, village placement, crater density, scatter,
blockhouses, tickets per player, wave timing, capture and time limits, how many positions each
team may dig, and its supply economy (below). Everything is seeded: the server and every client
build the same map.

```
 32v32 Valley (x →)
    | HQ 0 |    A    ║    B     ║    C     ║    D     ║    E    | HQ 1 |
    |      | A1  A2  ║ B1 B2 B3 ║ C1 C2 C3 ║ D1 D2 D3 ║ E1  E2  |      |
                     ║ trench lines (wire in front of both sides)  ║
       Solari owns A–B         no-man's-land          Void owns D–E
```

- **Terrain** (`Terrain`, 1 m samples): rolling hills at the size's amplitude, berms along the edges,
  flattened under points, spawns, HQs and motor pools. Digging is first-class: `carveRect`,
  `carveDisc` (craters, foxholes), `carveLevel` (a corridor level from wall to wall, following the
  ground along its length) and `digTo`; every change lands in `dirty` so the renderer and nav redo
  just that region, and dug ground renders as mud.
- **Points** are fortified positions: a strongpoint in the middle inside a broken ring of walls,
  low sandbag walls and crates.
- **Trench lines** (`Trenches.js`) cross the map at every boundary between line sectors:
  - a zigzag fire trench (bays 8–12 m, traverses between them), 2 m wide, dug 0.75 m with a level
    floor and sandbag parapets standing 1.25 m over the floor: fire over them standing (muzzle
    1.6 m), hidden crouched (1.15 m), climb out to go over the top. Parapet tops step with the
    ground so that height holds on hillsides;
  - communication trenches back to both sides' rear, roofed dugouts, and exits with dug ramps;
  - corridors sit on the 1 m terrain grid and the 2 m nav grid, so the floor is flat to the wall and
    is its own open lane of nav cells;
  - firing positions every 2.5 m along both sides of every bay (only where the parapet really
    is between 1.16 and 1.46 m), and duckboards along the floors.
- **Barbed wire** (`WireField`): belts 11–14 m in front of both sides of every line, with gaps.
  Pickets, aprons and a concertina coil. Wire slows soldiers to 45% (no sprint), costs the nav 8×
  (routes go through the gaps), and is cut by blasts and by tank tracks.
- **No-man's-land:** shell craters across the line sectors, twice as dense in the neutral middle
  (prone cover, and places to dig in).
- **Villages** (`Ruins.js`): ruined buildings around chosen sectors' points, 0.4 m walls with broken
  stretches, 2–3 rooms each with doorways between them and at least two ways in. Squads clear them
  room by room.
- **Motor pools:** a cleared patch per line sector and team; a team's vehicle pads stand in its
  front sector's pool and move up when the front does.
- **Artillery parks, depots and the HQ dump** (12v12 and up): each line sector has a park per team
  (howitzers and rocket batteries in the front row, AT guns behind) and a forward depot site; each
  HQ has a supply dump with the trucks lined up beside it. The team's park and depot are the ones
  in its front sector, and they move up with it.
- **Nav** (`NavGrid`, 2 m cells): slopes over 38° and cover taller than 1.1 m block; vaultable
  cover costs 4×; trench parapets 10× (climbable, but routes inside a trench network use the floor);
  wire 8×. Doorways are portals (routes thread through the door's centre). Flow fields per
  objective, A* with string pulling for squad moves.

## The night city (`map=city`, `City.js`, `CityRenderer`)

The second warfront: the same front (sectors, points, spawns, motor pools, depots, guns, HQs, the
same rules) fought through a futuristic city at night under a purple aurora instead of across
trench country. `index.html?map=city` (any size) picks the **Neon Night** sky by default.

| Size | City | | Size | City |
|---|---|---|---|---|
| 4v4 | Overpass | | 64v64 | Aurora City |
| 12v12 | Midtown | | 200v200 | The Sprawl |
| 32v32 | Neon District | | | |

- **Streets** run with the front: avenues 14 m wide along X (one down the middle of the map, then
  every 40–72 m across the depth), cross streets 11 m wide every 42–58 m. The ground is flat.
- **Blocks** stand between the streets on a sidewalk slab 0.16 m high, a kerb soldiers step up and
  a sliding car trips on. Lots along their faces hold one of four things:
  - a building: a solid box (cover nobody gets through), 3–8 storeys, a few towers of 12–22; the
    map's edge is a wall of them;
  - a shelled shell with rooms and doorways (`Ruins.js`), which squads clear;
  - a collapsed lot: a rubble heap with slabs lying about;
  - an empty lot.

  Points, spawns, motor pools, depots and HQs stay open as plazas.
- **The park** covers the middle sector's blocks, out to the cross streets nearest its edges and
  the avenues nearest 60% of the depth, so streets run round it. The streets that crossed it
  become its paths; two more cut across it diagonally. It also has:
  - grass, trees and hedges, benches along the paths, and lamps;
  - low walls round it, with gates where the paths come in;
  - the fountain and statue on its point.
- **What the war left:**
  - damaged vehicles in every street (sedans, hover cars, vans, trucks, buses). Some are burned
    out, a few still burning, some on their roofs. A few lie slewed across the lanes, but never
    so as to close a street;
  - shell craters in the asphalt, rubble and debris, dumpsters, planters and crates.
- **Barricade lines** stand where the trench lines would be (every boundary between line sectors)
  and cross every avenue. Each line sits at the boundary, or as near it as the stretch between two
  intersections allows. A line is made of:
  - jersey barriers with gaps, or now and then a container roadblock;
  - sandbag nests either side;
  - tank traps;
  - concertina wire 8–11 m out on both sides.
- **Street lights** stand every 24–30 m along every street on alternating sidewalks. Poles are
  cover. About one in seven is out and one in sixteen flickers.
- **The look** (`CityRenderer`, [ART_DIRECTION.md](ART_DIRECTION.md)): window grids lit warm and
  cool, neon signs, lamp pools and a few real lights near the action, red roof beacons, searchlights
  behind both lines, a skyline beyond the edges, and the aurora.

## Rules (`FrontlineMode`, simulation only)

| Setting | 4v4 | 12v12 | 32v32 | 64v64 | 200v200 | |
|---|---|---|---|---|---|---|
| tickets | 80 | 168 | 384 | 640 | 1600 | one per death (downs cost nothing; a revive saves one) |
| `captureTime` | 8 s | 10 s | 10 s | 10 s | 12 s | one soldier taking a neutral point; an enemy point is neutralized first (2×) |
| `secureTime` | 3 s | 3 s | 3 s | 3 s | 4 s | holding every point of the attacked sector captures it |
| `timeLimit` | 10 min | 15 min | 25 min | 35 min | 60 min | then the team holding more line sectors wins |
| waves | 5 s | 6 s | 6 s | 7 s | 8 s | reinforcement waves |

- **Start.** Everything left of the middle is Solari's, right is Void's, the middle is neutral. Each
  team's *front* is its forward sector, and its jump-off trench is the line in front of it.
- **Attack.** Each team attacks the sector in front of its front. Both race for the neutral middle.
  After that, each attacks the other's front sector while defending its own. Only points in attacked
  sectors can change hands; everything behind the lines is locked.
- **Capture.** Progress moves by the headcount difference inside the radius (capped at 3), so
  defenders cancel attackers one for one and an even fight freezes the point. Downed soldiers don't
  count.
- **Sector capture.** Owning every point of the attacked sector for `secureTime` captures it: the
  front moves up, the loser falls back, points behind the new line lock, the attacker gets +30
  tickets, and both teams' motor pools follow the new fronts.
- **Victory.** Breaking through the last line sector before an HQ, the enemy running out of tickets,
  or leading at the time limit.
- **Events:** `mode:point`, `mode:contested`, `mode:sector`, `mode:front`, `mode:tickets`,
  `mode:victory`. `mode.snapshot()` is the compact state for HUDs and network snapshots.

**Friendly fire** is on, as in Helldivers 2 (`data/rules.json`, read by `CombatWorld.harm`): a rifle
round hits the teammate who steps in front of you, a shell or grenade takes everyone in its blast,
a sword lands on whoever is in its arc, a vehicle at speed runs down whoever is in its way, a
sentry shoots through the soldier who walks into its line, and burning ground burns friends. Each
kind of harm has a share (1 = all of it; `self` is your own blasts, 0.5). Friendly damage earns no
super energy, teamkills are marked in the kill feed, and the HUD tells you when you hit a teammate
or one hits you. Bots keep their fire discipline (docs/AI.md: Fire discipline).

## Stratagems (`Stratagems`)

Call-ins from the sky. Every soldier carries four: Supply Drop and Smoke Screen, and two more by
role (`data/stratagems.json` `loadouts`). Hold the call-in key and type the code. A wrong arrow
buzzes and clears it; a full code puts the beacon in your hand. Throw it (it flies in a lob and
sticks to whatever it hits) and the payload comes after its delay. Your hands are busy while you
type or hold a beacon: no gun, no sword, no abilities. That moment of exposure is the price.

| Stratagem | Code | Arrives | Payload | Limit |
|---|---|---|---|---|
| Supply Drop | ▼▼▲▶ | 5 s | a pod that crushes whoever's under it and opens on four crates (**X**: two mags each) | 120 s |
| Smoke Screen | ▶▲▲▼ | 2 s | six clouds across the throw that block sight for 20 s | 70 s |
| Precision Strike | ▶▶▲ | 3 s | one heavy round on the beacon (900 damage, 7 m blast) | 90 s |
| Orbital Barrage | ▶▼◀▲▲ | 5 s | 12 rounds over 8 s within 22 m | 180 s |
| Strafing Run | ▲▶▶ | 1.5 s | a jet walks 14 rounds 32 m on from the beacon, along the throw | 2 uses, 100 s rearm |
| Airstrike | ▲▶▼▶ | 2.5 s | a stick of five bombs, 26 m across the throw | 2 uses, 120 s rearm |
| Sentry | ▼▲▶▶▲ | 4 s | a pod that opens into a turret (42 dps, 45 m, 400 hp, 60 s) firing from 2.15 m up; it misses more at range and against a running target | 150 s |

The rules that make them honest:
- **Everything hurts everyone.** Strikes, pods, bombs and the sentry's rounds hit friends as hard
  as foes (`data/rules.json`, see Rules). The danger is shown, not hidden. Each beacon stands as
  a pillar of light in its payload's color (strike red, supply blue, sentry green, smoke white).
  Each strike draws its danger outline on the ground: a circle round a barrage, a capsule round a
  run. The HUD marks your side's beacons with a countdown and **DANGER CLOSE** when you're inside one.
- **Strikes go on the incoming list when the beacon plants.** Bots of both sides dive for cover in
  time, and the audio whistles the rounds in.
- **A beacon stuck on a soldier or a vehicle rides it.** The payload follows it until each part
  leaves the sky.
- **A beacon in hand glows in the thrower's right hand.** Everyone near can see what's coming. A
  soldier typing has the wrist pad lit, and the rig poses both.
- **Bots call in too, carefully** (`CallInPlanner`, see [AI.md](AI.md)). They strike clusters they
  can see with none of theirs near the footprint, drop supplies when short of ammo, smoke a
  crossing under fire, and put sentries down when holding. They get out from under a pod coming
  down and shoot enemy sentries. Each side's call-ins are rationed by its size.
- **Sentries shoot soldiers on their feet.** A downed enemy is left to be revived or finished by
  hand, so a sentry suppresses and downs, and the revive game survives it.

## Battle points (`BattlePoints`)

Battlefront's arc, on the call-in panel: everyone earns points for what helps the team and
spends them mid-match on bigger toys. Each soldier's points are his own; bots earn and spend
them by the same rules (`data/battle-points.json`).

| Earned for | Points | |
|---|---|---|
| Takedown | 100 | downing an enemy (or killing him outright: no down) |
| Finish | 25 | killing an enemy who's down |
| Assist | 50 | damage on him in the 10 s before someone else took him down |
| Spot assist | 30 | he was revealed by you and someone else took him down |
| Vehicle / deployable destroyed | 250 / 40 | |
| Revive | 150 | more than a takedown: getting a teammate up is the best thing you can do |
| Resupply | 40 a mag | a teammate's mags from your supply pod (yours from your own pod pay nothing) |
| Dug in | 60 | a foxhole, sandbags, a trench link |
| Point captured / neutralized | 200 / 100 | to everyone of the side standing on it when it flips |
| Defending | 10 a second | on your side's point while the enemy contests it |
| Supplies delivered | 80 a truckload | to the driver |
| Teamkill | −150 | downing or killing a teammate |

Kills made with something you own are yours: your sentry's, your vehicle's, a shell you called
in. **Dying keeps half** of what you hadn't spent, so staying alive with your squad compounds.

Spent from the call-in panel (it shows your points and every price):

| Buy | Price | |
|---|---|---|
| An extra use | 400 | type a call-in that's cooling down or out of uses anyway; paid when the beacon leaves your hand (putting it away costs nothing), and its cooldown keeps running |
| Recon Vehicle ◀▼▶▲ | 800 | a fast vehicle dropped on the beacon in its cradle (crushing whoever's under it), 60 s cooldown |
| Tank Drop ◀▼◀▶▼ | 1200 | a tank, the same way, 150 s cooldown |
| Hero ▲▲◀▼▶ | 2000 | your class super charged on the spot (not while it's charged or you're in your form) |

A vehicle comes down in a drop cradle, four retro thrusters burning, facing the way you threw.
On the ground the cradle lets go and lifts away; the vehicle is yours (one called vehicle each:
an empty older one is scrapped). The HUD shows the total on the status panel and a line under the
crosshair for each thing you did ("+100 TAKEDOWN", "+150 ASSIST ×3", a ticking DEFENDING), what you
spent and what dying cost you; each comes with a small chime. In a six-minute 32v32 the best bots
reach 3,000 points earned and spend some on extra strikes, a vehicle and the hero; most spend
nothing before they die.

## Support roles and passives (`SupportItems`, `Passives`)

Medics and engineers carry items (`data/support.json`), used with **3**; supply pods, depots and
redeploying refill them. Bots use them with the same key (`ItemPlanner`, see [AI.md](AI.md)).

| Item | Who | What |
|---|---|---|
| Stim ×3 | medics | The teammate you face within 2.5 m (else yourself, if hurt) heals 60 HP over 2 s. A downed one is up a second later with 60% of his health, his bleeding stopped meanwhile, and you don't kneel: you keep shooting |
| Ammo pack ×2 | engineers | Dropped at your feet: teammates short of at least a mag take two each as they pass, four of them, for a minute (40 battle points a mag, to you) |
| Repairs | engineers | Hold **H** beside a damaged vehicle or turret of ours: 50 HP a second, kneeling at it (2 battle points per HP) |

Every class has a passive (`data/classes/*.json` `passive`, the numbers in `data/passives.json`),
shown on your status panel. Bots carry theirs too.

| Class | Passive | |
|---|---|---|
| Lancer | Momentum | a takedown gives back 25 stamina and +10% speed for 3 s |
| Bastion | Unshakable | no hit flinch (camera or aim) while your shield is over half |
| Veil | Ghoststep | silent footsteps crouched; sword backstabs do double damage |
| Artificer | Salvage | a vehicle or deployable destroyed within 12 m is a mag for you |
| Lumen | Triage | revives 50% faster; 3 HP a second to your squad within 10 m |
| Seraph | Spotter | hold your sights on an enemy for 0.4 s: revealed for 5 s, glowing red to your side and on its minimap (a spot assist if someone else downs him) |
| Dawnblade | Radiant Guard | a perfect parry heals you 10 |
| Skyrider | Ace | boards vehicles in half the time; handles them better |
| Prism Adept | Overcharge | energy guns vent and cool 30% faster |
| Breacher | Blast-Proof | half the damage from your own blasts |
| Reaver | Hunger | your hits on Weakened enemies give back 5 leech armor |
| Monolith | Mass | no knockback from blasts or abilities while up; Slow wears off twice as fast |
| Wraith | From Nowhere | silent at a sprint; sword backstabs Suppress for 1 s |
| Rigger | Scavenger | an enemy deployable you destroy takes 30% off your ability cooldowns |
| Mender | Leech Link | 20% of your damage heals the most hurt teammate within 20 m |
| Hollow-Eye | Patient Eye | each second down your sights without firing: +10% gun damage (up to 30%), spent on the next shot |
| Ashsworn | Black Flame | sword hits build Volatile (three set it); perfect blocks give back 10 leech armor |
| Driftcaller | Drift | boards in half the time; Phased for a second when you get out |
| Psion | Mindread | hold your sights on an enemy for 0.5 s and see his ability cooldowns and super over his head |
| Riftbreaker | Rift-Proof | half the damage from your own blasts; pulls don't move you |

## Melee on the front (`MeleeSystem`, `MeleeWeapons`, `MeleeTells`)

Every class carries its own blade (`data/weapons/melee.json`, by the class's `loadout.melee`; the
flame knights carry their army's flame sword). A blade with a `base` is that moveset with its own
numbers: reach, speed, guard, and extras like a status on a clean hit, double damage to a raised
shield, a hook's pull.

| Blade | Who | Its character |
|---|---|---|
| Dawnblade, Ashsworn Blade | flame knights | the balanced flame swords; the Ashsworn's cuts scorch, its parry is narrow |
| Sunlance | no class by default | an energy spear: long thrusts, a narrow arc |
| Aegis Saber | no class by default | the widest parry window and the best block, low damage |
| Rift Cleaver | Monolith | two hands, slow, hyper armor through its big swings |
| Twin Embers | Wraith | two flame daggers: the fastest chains, short reach |
| Vibroblade | Veil | no heat at all, quick, a weak guard |
| Power Fist | Bastion, Breacher, Riftbreaker | breaks guards, can't parry; an unblockable slam |
| Ion Halberd | Prism Adept, Psion | reach, and double damage to a raised shield |
| Combat Knife / Combat Hook | the Solari / Void gunners | quick and short; the hook drags its victim in |
| Cinder Edge | no class by default | runs hot, and hot it burns hard |

- **Swept hits.** The sim sweeps the blade along the rig's own keyframes (hand and blade in the
  chest frame, the chest turned by the swing's twist, the strike accelerating through its arc),
  four steps a tick, against the hit spheres: a slash passes over a man lying prone, misses one
  behind you, and reaches as far as the blade you see (a knife about 1.3 m, a sword 1.9 m, a
  spear 2.5 m). Bots close to their blade's reach before they swing.
- **The rifle butt (V, pad R3)** for anyone with a gun out: 0.12 s up, 35 damage, a 0.4 s stagger
  and a shove that can put a man off a parapet or back out of a doorway. Bots use it on an enemy
  in their face.
- **Finishers.** Hold **X** over a downed enemy (none of yours to revive there): you kneel over
  him and he dies 1.1 s later (the finish's battle points are yours); the camera pulls out to
  frame you both. Bots finish the downed close by when nothing else is standing.
- **Windup chevrons.** Every enemy within 6 m winding up a swing at you shows as a chevron on a
  ring round the crosshair, pointing at him: amber if you can block it, red if you can't,
  flashing white in the last tenth of the windup.

## Downs, ragdolls and reinforcements

- **Down but not out** (`data/down.json`, `Health`, `ReviveSystem`): at 0 HP you're downed, not dead,
  unless the hit was overkill (60% of max HP past zero, or a headshot dealing half your max HP).
  Downed soldiers crawl, bleed out over 25 s (paused while being revived), and die after 60 more
  damage. A teammate holding interact for 3 s (medics 1.5 s) gets you up with 30% HP (medics 60%).
  Hold jump to give up. The soldier who downed you gets the kill if you bleed out.
- **Ragdolls** (`src/physics/Ragdoll.js`, see [ANIMATION.md](ANIMATION.md)): a blast within 75% of
  its radius, a critical hit (one hit taking 45% of your health pool, or a headshot taking 40%), a
  heavy melee blow, a vehicle ram, and every down or death throw the body as a full physics ragdoll.
  Where it lands is where you are, and a soldier who survived the blast at 0 HP lies there downed,
  body intact (no dismemberment).
- **Reinforcements** come in waves after at least 4 s down. A soldier deploys next to the squad
  leader if the leader is alive, up, on foot, unhurt for 3 s and has no enemy within 25 m;
  otherwise at the safe spawn nearest the rest of the squad; otherwise at the front's spawn group.
  At the start each squad deploys together. Reinforcements who like vehicles may deploy straight
  into an empty one waiting in the motor pool.

## Digging in (`Fortify`)

Hold **H** crouched and still to dig where you stand (bots holding a line with no cover do it too):

1. **Foxhole** (3.5 s): a pit 0.65 m deep with a thrown-up lip: prone in it is covered from everything.
2. **Sandbags** (4 s): a 2.4 m wall on the lip toward the enemy, standing 1.45 m over the pit floor:
   fire over it standing, hidden crouched.
3. **Trench** (6 s): keep digging at a finished position and a trench is cut to the nearest friendly
   position within 11 m. Positions dug along a line join into a trench line over a match.

Everything built is real: carved terrain (mud), cover boxes for bullets, movement, nav, the tactical
map and the renderer, and blasts and tanks knock the sandbags down. Each team may dig 8 / 16 / 30 / 50 /
120 positions (4v4 → 200v200), and with logistics every sandbag wall costs supplies from the forward
depot. Engineers dig 1.5× faster. Events: `fort:dig`, `fort:built`.

## Squads and the commander

- **Commander** (`FrontlineCommander`): one per team, re-plans every 4 s and when a sector falls. It
  splits its squads between attacking the points of the attacked sector (weighted toward neutral and
  half-taken points, at least one squad per point) and defending its own points under attack
  (weighted by enemies on the point and how far it has slipped). Squads keep orders that still fit.
- **The whistle:** squads attacking across their own trench man it and report ready. The commander
  blows one whistle per trench line (waiting 6 s for other squads to get in, at most one wave every
  18 s) and every ready squad goes over the top together. Event `squad:whistle`.
- **Squad tactics** (`SquadTactics`, per squad, twice a second): advance in a wedge, bounding
  overwatch under contact, sweep and clear, assault, hold the line with anchors on the point, dig in,
  charge only when desperate, follow a human leader. See [AI.md](AI.md).

## Vehicles on the Western Front

Tanks crush the sandbags and crates they roll over and flatten wire; tanks and hover vehicles rest on
the highest ground under the hull, so they bridge trenches. Bot drivers with nothing in sight roll up
to their squad's objective (tanks stop 30 m short to cover it) and back out of what they get stuck on.
See [VEHICLES.md](VEHICLES.md).

## Artillery and the supply war (12v12 and up)

**The guns** (`FieldGuns`, stats in [VEHICLES.md](VEHICLES.md)) are vehicles a crew moves and sets up:

- **Howitzers** are towed: pushed at a walk or hitched to a truck. Set up, they plunge shells into
  trenches from about 55 m out to 1.6 km.
- **Rocket batteries** are self-propelled, and ripple a 16-rocket salvo across an area.
- **AT guns** are towed and fire flat. Each slug takes 40% of a tank's health (60% through the
  rear vent), so three hits from the front kill one.

A set-up gun can't move, and the trail takes seconds to dig in and to pack up. So does
swinging the carriage to reach past its traverse. Indirect rounds scatter more the further they
fly, and every one whistles in before it lands. Shells crater the ground, knock sandbags and walls
down, cut wire, and open gaps that routes and cover spots pick up at once.

**The support AI** (`SupportCommand`, one per team; crews are bots taken out of the infantry, and
they redeploy beside their unit) re-plans every second. Highest priority first:

| Priority | Mission | When |
|---|---|---|
| 6 | SOS | the enemy blew its whistles: shell the ground in front of the trench they're leaving |
| 5 | Preparation | our commander is about to send a wave: shell the enemy-held points ahead of it. The whistle waits (up to 12 s) and the guns lift 5 s before it blows |
| 4 | Counter-battery | an enemy gun has given itself away by firing (three shots make a fix): howitzers answer |
| 2+ | Observed fire | groups of enemies our soldiers can see |
| 1 | Interdiction | the enemy's forward depot (howitzers only, a few rounds every 50 s) |

No mission is ever fired within 32 m of our own soldiers. A battery low on ammo answers only
priority 4 and up. AT guns set up 30 m behind the front-line trench, spread across the attacked
sector's lanes, and kill the nearest enemy armor they can see (enemy infantry in the open when no
armor is about). When the front moves, crews pack up and move their guns to the new park.
Soldiers hit the dirt when a round is about to land within a few metres of them.

**The supply war** (`Logistics`):

- Supplies are produced at the HQ dump and have to be hauled to the forward depot by truck. The
  trucks run dump → depot → dump on their own, and a truck standing in a depot loads or unloads
  25 a second. At 200v200 ten trucks a side leave the dump 14 s apart: a stream of deliveries over
  the kilometre-long haul, not one convoy every few minutes.
- The front lives off the forward depot:
  - soldiers refill their guns at a depot (fast) and in their own trenches (slowly);
  - batteries within 320 m of a depot reload from it;
  - sandbags and every vehicle or gun that comes back from the motor pool or the park cost
    supplies.

  An empty depot means the guns go quiet, rifles run dry and tanks stop coming. A soldier who
  redeploys always brings a full loadout (that comes from the HQ).
- The depot moves with the front. It keeps 75% of its stock when the front moves up, and 30% when
  it is overrun.
- Interdiction: a destroyed truck loses its cargo, and every shell that lands in a depot burns
  stock.

| Costs | | Economy | 12v12 | 32v32 | 64v64 | 200v200 |
|---|---|---|---|---|---|---|
| tank | 120 | HQ production / min | 70 | 130 | 200 | 560 |
| rocket battery | 90 | HQ start / cap | 300 / 1200 | 450 / 2000 | 600 / 3000 | 1500 / 6000 |
| howitzer | 70 | forward depot start / cap | 180 / 400 | 260 / 600 | 320 / 800 | 1200 / 2400 |
| AT gun | 40 | trucks per team | 1 | 2 | 3 | 10 |
| hoverbike | 25 | | | | | |
| sandbag wall | 6 | | | | | |
| magazine · rocket | 1 | | | | | |
| howitzer or AT round | 2 | | | | | |

Events: `gun:state`, `gun:fire`, `gun:empty`, `gun:hitch`, `artillery:impact`, `support:mission`,
`support:prep`, `logistics:load`, `logistics:unload`, `logistics:moved`, `logistics:lost`,
`logistics:short`.

## Scale

**Simulation** (the same code headless, in tests and in the browser):

| Piece | What it buys |
|---|---|
| `CoverIndex` (8 m grid, DDA raycasts) | Bullet and sight raycasts against thousands of boxes, with an allocation-free slab test; refuses corrupt (non-finite) queries |
| `EntityGrid` (rebuilt per tick) | "Fighters near here" and ray-vs-fighters without scanning all 400. A flat array over the map's bounds (no hashing); ray queries walk the corridor cell by cell |
| Combat rays, static first | Cover, ground and domes are tested first, so the search for soldiers along a bullet's path stops at the first sandbag; a bounding sphere comes before each soldier's stance-aware hit spheres |
| Line of sight (`world.sight`) | Cover, walls and the terrain: nobody sees, or shoots at, an enemy behind a ridge |
| Flow fields per objective (`NavGrid`) | One Dijkstra per point shared by every bot. When cover is built or blown, each field repairs itself in place: only the cells whose route ran through the change are solved again, sliced on a work budget (deterministic). On big maps fields are built in the background, reach 900 m of route around their goal, and a gun move or supply run asks for a field that covers just its trip |
| A* (`NavGrid.path`) | Squad moves between cover: ~0.07 ms for a 30 m route, bounded search, string-pulled, doorway portals; also the fallback beyond a field's reach |
| `TacticalMap` | ~10k cover spots, trench positions, craters and rooms in a 16 m grid, with reservations |
| Squad plans at 2 Hz, staggered | The ~80 squads of a 200v200 battle cost a few planning passes per tick |
| Bot think LOD | Within 60 m of a human camera every tick; within 160 m every 2nd; within 400 m every 4th; beyond, every 6th. Headless: every 2nd (every 3rd past 128 players). Bots rescan their surroundings every 0.2 s |
| Pipeline LOD | Soldiers 160 m or more from every camera move, shoot and cast at 30 Hz with a double step (limp bodies and vehicle crews stay at 60 Hz) |
| Determinism | Per-bot and per-squad seeded streams; a seed replays the same battle. Commands are sanitized (a NaN can never reach the sim) |

**Presentation:**

| Piece | What it buys |
|---|---|
| `TerrainChunks` | 128 m chunks with distance LOD (every sample near, every 2nd mid, every 8th far), skirts, at most 2 rebuilds per frame; runtime digging rebuilds just the touched chunks |
| `BattlefieldRenderer` | Cover as one InstancedMesh per material with world-space textures (`CoverTextures`: stuffed sandbag courses, cast concrete, planks, rock, riveted steel), duckboards, wire as instanced pickets plus one line set, point rings and beacons, front-line curtains |
| `CrowdRenderer`, `AnimationSystem` | The crowd in 5 instanced draw calls; full rig under 70 m, half-rate under 220 m, impostors beyond; corpses stay where they fell |
| `TracerPool` | Every tracer and live projectile in 2 instanced draw calls |

**Measured** on this container (Node, single thread, seed 5, 90 s battles with squads, digging,
vehicles, artillery, supply runs, downs and ragdolls, one player's camera as the LOD focus):

| | 4v4 | 12v12 | 32v32 | 64v64 | 200v200 |
|---|---|---|---|---|---|
| Fighters | 8 | 24 | 64 | 128 | 400 |
| Map and match build | 0.10 s | 0.20 s | 0.49 s | 0.78 s | 1.97 s |
| Sim, average per 60 Hz tick | 0.32 ms | 0.59 ms | 1.37 ms | 2.93 ms | 6.71 ms |
| Worst tick (garbage collection, JIT) | 4.7 ms | 7.7 ms | 16.0 ms | 27.8 ms | 43.2 ms |

At 200v200 about one tick in 250 runs past 16.7 ms. The browser client (swiftshader) draws the
64-fighter Valley in about 77 draw calls and 240k triangles. At 128 fighters it's about 100 draw calls
and 360k triangles, and the 400-fighter Extreme Warfront takes 160–180 draw calls and 710k
triangles. Most of that is the near terrain. Vehicles past 160 m are drawn as one block, and nothing
is drawn past the fog.

Your melee hits, parries and blocks, and your kills with a shotgun or a sniper rifle, hold the battle
for a few ticks (hit-stop, offline only). Nobody else's hits stop your game.

**Known gaps:** the nav grid is 2 m, so trench corners and doorways need the special handling above;
netcode needs sector-based interest management; there are no aircraft on the Western Front yet (the
dropships are arena-only).

## HUD (`FrontlineHud`)

| Element | What it shows |
|---|---|
| Top bar | Tickets, plus a sector strip in owner colors with ◆ on each team's front and a fill bar while a sector is being secured |
| Orders | Your squad's order and distance, e.g. `ATTACK C2 · 30 m` |
| Squad panel | Your squad's phase (ON YOU, BOUNDING · IN CONTACT, IN THE TRENCH · WAITING FOR THE WHISTLE, CLEARING A BUILDING, HOLDING THE LINE...) and what each squadmate is doing, or that they're down |
| Banners | Captures, sectors, victory, `WHISTLES · OVER THE TOP!` and the enemy's whistles |
| Downs | Your bleed-out, give-up hold and revive progress; a revive prompt beside a downed teammate; red crosses over downed teammates |
| Digging | Progress through foxhole, sandbags and trench |
| Supply | The forward depot's stock and the HQ dump's, trucks on the road; banners for shortages, depot moves and the preparation barrage |
| Call-in (`StratagemPanel`) | While the call-in key is held: your stratagems with their codes, typed arrows lit on the codes that still match, cooldowns, uses and rearms, your battle points and every price (BUY 400 on one that's cooling down, lit when you can pay); with a beacon in hand, which one, how to throw it and what it will cost; a red flash on a wrong arrow. Markers over your side's live beacons (name, countdown, DANGER CLOSE), and the supply prompt beside a pod |
| Battle points (`BattlePointsHud`) | The total on the status panel; a line under the crosshair per thing you did, repeats adding up on one line, and what you spend or lose on death |
| Callouts (`BarkVoices`) | Your squad's lines, and anyone's within 40 m, spoken and subtitled at the bottom of the screen with the speaker's name in his army's colour; `?voices=off` keeps only the subtitles |
| Melee (`MeleeTells`) | Chevrons round the crosshair for swings coming at you (amber blockable, red not, white: now); HOLD X TO FINISH over a downed enemy, FINISHING with its progress |
| Support | Your passive and items on the status panel; **3 STIM** facing a hurt or downed teammate, **HOLD H TO REPAIR** beside a damaged vehicle of ours, REPAIRING with the hull's health; enemies a spotter revealed glow red and show on the minimap; Mindread's line over the enemy in your sights |
| Guns | Crew and drive prompts; at a gun, FireControl's panel (overhead fire-control view with the predicted arc, the scatter ring, range, flight time, rounds and loading; for an AT gun a second reticle where the barrel points). See [VEHICLES.md](VEHICLES.md) |
| Minimap | Also our depots, guns and trucks, enemy guns we've located, and where shells land |
| Suppression | The screen edges darken while rounds crack past you |
| Hit markers (`HitFeedback`) | At the gun's reticle, on each hit of yours: four white ticks (90 ms); a kill: bigger and red (180 ms); a headshot: gold; a round the armor shrugs off: small and grey, with a dull plink (switch weapons or aim elsewhere); a teammate: a blue X. Each kind has its own confirm sound |
| Damage direction | A red wedge on a ring round the crosshair pointing at whoever hit you (a blast: where it burst), as strong as the hit, fading over 1.2 s and turning with you. The hit also kicks your view up and toward it (0.6° per 20 damage, at most 3°, back in 120 ms) and knocks your gun's aim by half that |
| Also | Point markers, minimap with spotted enemies, HD2 gun reticle, status, ammo, killfeed, reinforcement countdown |

## Tests

- `tests/maps.test.mjs`: every size builds a valid map (bigger matches, bigger maps, a point per
  lane, a trench line between line sectors), every point is reachable from both HQs, spawns are
  walkable, the same seed builds the same map, trench floors are flat with parapets you fire over
  standing and hide behind crouched, trenches sit on the nav grid with walkable exit ramps, ruin
  doorways are open, wire slows and is cut by blasts, digging keeps the deepest cut, a soldier pushed
  into a wall gets out, and a soldier on a trench floor can climb out. (`MAP_SEED=n` re-runs them on
  another seed.)
- `tests/squads.test.mjs`: cover spots, routes, suppression, over the top on the whistle, wedge
  spacing, bounding overwatch, hold the line, sweep and clear, charges only when desperate, a human
  leader, digging in, and armor crossing trenches and wire with the motor pool following the front.
- `tests/frontline.test.mjs`: capture rules, the moving front, victory, spawns, the commander, and a
  64-bot headless battle (bots close on their objectives at over 2 m/s en route, points change hands,
  under 8 ms per tick).
- `tests/scale.test.mjs`, `tests/down.test.mjs`, `tests/ragdoll.test.mjs`: the spatial indexes,
  terrain and flow fields (repairs match a fresh solve through 40 rounds of random walls built and
  blown, big-map fields build in the background and reach REACH metres); downs, revives and
  give-ups; the ragdoll.
- `tests/artillery.test.mjs`, `tests/logistics.test.mjs`, `tests/support.test.mjs`: setting up and
  packing up, laying, indirect fire landing on the mark with range-scaled scatter, rocket salvos, AT
  guns against armor, towing, craters and blown sandbags; supplies, trucks, depots, resupply,
  costs and interdiction; crews manning their guns, missions never danger close, the preparation
  barrage before a whistle, SOS fire, counter-battery, AT crews, hitting the dirt, and the guns
  moving up with the front.
- `tests/warfront.test.mjs`: a 200v200 battle (400 soldiers, crewed batteries and convoys) within a
  tick budget.
- `tests/city-map.test.mjs`: a city per size, with more of it the bigger the match and the same
  seed building the same city. Plazas stay open: no building on a point, a spawn or an HQ. Streets
  stay open: every point and street is reachable from both HQs, and the way across is never a
  maze. Lamps stand on the sidewalks and wrecks in the streets. The park sits in the middle with
  no block or street in it and the fountain on its point. Barricade lines cross every avenue,
  never in an intersection. The renderer dresses it all, with real lights on the lamps and fires
  nearest the action. A city match runs with nobody ending up inside a building.
