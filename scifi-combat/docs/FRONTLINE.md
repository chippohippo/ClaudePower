# Frontline: 4v4 to 200v200 trench battles

Code: `src/game/frontline/` (MapSizes, FrontlineMap, Trenches, Ruins, City, Fortify, FrontlineMode,
Logistics) · `src/combat/Stratagems.js` · `src/game/BattlePoints.js` · `src/combat/SupportItems.js`, `Passives.js` · `src/game/FrontlineSession.js` · `src/ai/FrontlineCommander.js` · `src/ai/tactics/`
(squads: see [AI.md](AI.md)) · `src/ai/command/` (Intel, Scout, Strategist: the commander) · `src/ai/SupportCommand.js`, `CrewPilot.js` (gun crews and drivers) ·
`src/vehicles/FieldGuns.js` (see [VEHICLES.md](VEHICLES.md)) · `src/world/` (Terrain, CoverIndex,
EntityGrid, NavGrid, WireField) · client: `index.html` → `src/frontline.js`,
`src/render/BattlefieldRenderer.js`, `TerrainChunks.js`, `CoverTextures.js`, `CityRenderer.js`, `CityKit.js`, `StratagemKit.js`, `src/ui/FrontlineHud.js`,
`FireControl.js`, `CommandView.js`, `StratagemPanel.js`, `BattlePointsHud.js`, `src/vfx/BattleFx.js`, `StratagemViews.js` · tests: `tests/maps.test.mjs`, `tests/squads.test.mjs`,
`tests/command.test.mjs`,
`tests/frontline.test.mjs`, `tests/scale.test.mjs`, `tests/down.test.mjs`, `tests/ragdoll.test.mjs`,
`tests/artillery.test.mjs`, `tests/logistics.test.mjs`, `tests/support.test.mjs`,
`tests/warfront.test.mjs`, `tests/stratagems.test.mjs`, `tests/friendly-fire.test.mjs`, `tests/battle-points.test.mjs`,
`tests/support-roles.test.mjs`, `tests/melee-front.test.mjs`, `tests/city-map.test.mjs`, `tests/houses.test.mjs`,
`tests/civilians.test.mjs` · the city's people: `src/game/Neutrals.js`, `src/ai/CivilianBrain.js`,
`src/combat/Teams.js`, `src/combat/WeaponDrops.js`, `src/vfx/DropViews.js`, `data/civilians.json`.

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

Double-click `play.bat` (Windows) or `play.command` (Mac), or run `./play.sh` or `npm start`: a small
server for this folder starts on your computer and the start menu (`start.html`) opens in your browser.
Pick the battlefield, size, side and class there and deploy ([PLAY.md](../PLAY.md)). Or serve the
folder any way you like and open `index.html` with these parameters:

| Param | Default | |
|---|---|---|
| `size` | 32v32 | `4v4`, `12v12`, `32v32`, `64v64` or `200v200`: the match size and the map built for it |
| `players` | (from size) | 8–400 fighters in total; picks the size built for that count if `size` isn't given |
| `seed` | 7 | map and match seed (deterministic map) |
| `map` | trench | `city`: the same front fought through a city at night (below) |
| `planet` | (by map) | the sky and look: `scorched` (trenches), `duskcity` (the city's default), `nightcity` |
| `fx` | (the options) | for one run: `low` (the low preset) or `off` (no post-processing); otherwise the saved options apply |
| `team` | 0 | 0 = Solari (attacks east), 1 = Void (attacks west) |
| `class` | lancer / reaver | any class id from `data/classes/*.json`, or `commander`: the commander's seat (below) |
| `difficulty` | veteran | recruit, veteran or elite bot aim and reactions |
| `voices` | on | `off`: the soldiers' callouts as subtitles only |

The controls are the arena's (WASD, Shift sprint, C crouch/prone/slide, Alt dive, Space climb, LMB/RMB,
R, V first / third person, B swap shoulder, F rifle butt, 1 sword/gun, Q E G Z abilities, X vehicles), plus **H** (hold) to dig in and **X** (hold) beside a
downed teammate to revive. When you're down: crawl, hold **Space** to give up; when dead, **Space** to
deploy. Your squad's bots follow you and take cover around you when you stop. At a gun, **X** takes a
crew seat and **H** sets it up or packs it up; at a howitzer or rocket battery the view goes overhead
and the mouse moves the fire mission's mark (hold LMB to fire). In a supply truck, stop inside the
HQ dump to load and inside the forward depot to unload; **H** hitches the gun behind you.
Stratagems: hold **Tab** (or Ctrl) and type the code with WASD or the arrow keys, **LMB** throws the
beacon, **Tab** again puts it away, **X** beside a supply pod takes two mags (pad: hold LB, the D-pad,
RT). `arena.html` is the 4v4 feel lab and `rig-lab.html` the animation lab.

### Options (`Settings`, `OptionsMenu`)

**Esc** in a match frees the mouse and opens the options; the battle (and its sound) waits while
they're open, and every change applies at once (turning shadows on or off recompiles the shaders
there and then, behind a "Compiling shaders" card, so play never hitches on it). Resume locks the
mouse again; Quit to menu goes back to the start menu. The start menu has the same panel
(**Settings…**) and the four presets. Everything is saved in the browser for the next match.

| Group | Options |
|---|---|
| Graphics | Preset (Low, Medium, High, Ultra; tuning anything reads CUSTOM); render scale 50–100% (the 3D image, rays and bloom drawn smaller, then scaled up in the final pass with contrast-adaptive sharpening, AMD CAS, the sharpening half of FSR 1; the sharper the smaller); anti-aliasing (off, MSAA 2×, 4×); shadows, bloom, god rays, ink outlines, letterbox, film grain (and the chromatic edges), snow and ash, High DPI (the canvas at the display's full pixel density) |
| Camera | Field of view 55–100°, camera shake, step bob, reduced motion |
| Audio | Volume; the soldiers' voices (the radio chatter stays written up) |
| Controls | Mouse sensitivity |

| Preset | Render scale | AA | Shadows | Bloom | God rays | Snow | High DPI |
|---|---|---|---|---|---|---|---|
| Low | 67% | off | off | off | off | off | off |
| Medium | 85% | off | on | on | off | on | off |
| High | 100% | 4× | on | on | on | on | off |
| Ultra | 100% | 4× | on | on | on | on | on |

Whatever the options, the 3D image never exceeds ~3.7 million pixels a frame (a 4K screen gets
a lower render scale rather than melting the GPU).

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
trench country. `index.html?map=city` (any size) picks the **Snowfall at Dusk** sky by default (the
stylized look: snow, lavender light, ink outlines, faceted smoke, laser bolts; `&planet=nightcity` for the
**Neon Night** under the aurora; [ART_DIRECTION.md](ART_DIRECTION.md)).

| Size | City | | Size | City |
|---|---|---|---|---|
| 4v4 | Overpass | | 64v64 | Aurora City |
| 12v12 | Midtown | | 200v200 | The Sprawl |
| 32v32 | Neon District | | | |

- **Streets** run with the front: avenues 14 m wide along X (one down the middle of the map, then
  every 40–72 m across the depth), cross streets 11 m wide every 42–58 m. The ground is graded
  (`Terrain.grade`): each block flat at its own level, each street running straight across from one
  block's level to the next, the park left rolling.
- **Blocks** stand between the streets on a sidewalk slab 0.16 m high, a kerb soldiers step up and
  a sliding car trips on, the same height all the way round (on the rolling ground under them, a
  quarter of the kerbs used to stand up to 1.7 m proud of the street: walls you ran into). Lots along their faces hold one of five things:
  - a building: a solid box (cover nobody gets through), 3–8 storeys, a few towers of 12–22; the
    map's edge is a wall of them;
  - a house you can go into (`Houses.js`, about four in ten of the lots that fit one): two to five
    storeys of rooms behind real doors and windows (you see, shoot and vault through them), floor
    slabs you walk on and under, stairs switching back from floor to floor (0.3 m steps) up through
    a hatch onto the roof behind a 1 m parapet, balconies on the street side. Its ground floor's
    rooms and doorways are in the ruins' shape, so squads clear them and the nav grid threads the
    doorways;
  - a shelled shell with rooms and doorways (`Ruins.js`), which squads clear;
  - a collapsed lot: a rubble heap with slabs lying about;
  - an empty lot: a night market (stalls in rows either side of an aisle: counter, shelf, canopy,
    crates).
- **Up off the street** (`CityExtras.js`), all of it walked or climbed with the movement rules
  (step up 0.35 m, climb a 2.3 m ledge with a face to climb, stand on any top, walk under anything
  above your head):
  - **skybridges** between houses facing each other across a street, into doorways planned at a
    floor both have (in steps where the floors aren't level). Some are broken: the far half fell
    into the street and its end is a ramp of rubble steps down to the far sidewalk, so you walk
    up into the near house. Never over a barricade line;
  - **scaffolding** up the fronts of some towers, over the sidewalk: a deck every 2.4 m, flights
    of stairs climbing along it from one deck to the next;
  - **debris** in the streets: chunks of concrete to crouch behind or vault, and piles of three
    blocks a climb apart (hold to climb, up onto the top);
  - the market's counters (climb onto them) under canopies (and from them onto the canopies).

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
- **The look** (`CityRenderer`, `CityFuture`, [ART_DIRECTION.md](ART_DIRECTION.md)): window grids
  lit warm and cool, neon signs, lamp pools and a few real lights near the action (and in the
  rooms nearest it), red roof beacons, searchlights behind both lines, a skyline of megatowers in
  neon trim with giant ad screens beyond the edges, flying traffic, cables over the streets.
- **The cover index** holds a house's (a scaffold's, a bridge's) hundred-odd boxes as one group
  under its bounds (`CoverIndex`): a ray or a query that misses the bounds skips every box in it.

### Buildings that come apart (`Structures`, `RigidWorld`, `CollapseViews`)

Every house, scaffold and skybridge is a structure, and its boxes are its members. They stand on
what holds them up. When that's shot away they come apart the way The Finals' buildings do: what's
left sags and hangs on, tears loose where it's pulled hardest, and comes down in chunks that
smash, tumble and pile up as rubble you can climb.
- **Damage:** every blast (`CombatWorld.explode`; a breach charge) hits the members it reaches for
  P (1 − d/R)^1.5, where P is the weapon's structural power and R is 90% of its splash. P is the
  weapon's damage ×2.5 for explosives, ×4 for artillery and ×6 for a charge against the wall: a
  grenade 275, a tank shell 550, a breach charge 900, a howitzer round 1280, a precision strike
  3600. Where that beats what a wall or a slab takes per m² (concrete 400 for a 0.3 m wall, scaled
  by thickness), it breaks through: the member is split into what's left round a hole, and the
  blast throws chunks of it (ten at most a blast: small bodies that bounce, roll and lie where
  they stop, too small to be cover). A grenade only chips walls, a tank shell punches a hole
  about a metre and a half across, and a howitzer round tears out eight metres of a ground floor.
  Smaller hits wear a member down (hit points: 400 per m³ of concrete), and small things like
  rails go at once. A member that's been hit darkens with its damage, so you see what's about to go.
- **What holds what** (the strain): a member stands on the ground, bears on a standing member
  under it, or hangs from members beside it that stand or bear. Nothing hangs from something that
  is itself hanging off another hanging member, and a hang must grip the member at or below its
  middle (a slab across the top of a pier doesn't hold the pier up). Walls are frames:
  - a pier is carried only by the band (lintel) under it;
  - a band is carried by the piers at its ends;
  - floors, stairs, rails and decks hang from whatever they're fixed to.
  A hanging member holds out as far as its material reaches past its supports (concrete 2.2 m), and
  a beam bridges a gap only as wide as its material spans (6 m). So a lintel carries the wall over
  one blown-out pier, but over an eight-metre hole it breaks. Interior walls carry what meets them.
  A skybridge is a welded frame: it stands while both its houses hold its ends (or it stands on its
  ramp), and goes down whole when one gives way.
- **Coming away** (the Dynamism): what's left unheld creaks for a moment (0.15-0.35 s), then comes
  away as rigid bodies (`physics/RigidWorld.js`). It's split into chunks of up to four members
  that sit together, each chunk one body, and the bodies are joined to one another and to what
  still stands by elastic joints at the corners of every face they touched by.
  - The joints to what stands hold as much as *c* times the chunk's weight. *c* is drawn for each
    piece, 0.5 to 2.5, so some pieces tear straight off and some hang on. That strength is shared
    out by the faces' areas.
  - The joints between chunks hold as much as *k* times the lighter one's weight (*k* 0.6-1.6).
  - A joint stretches 1.5 cm before it tears, so a piece sags visibly first. It tears pulled
    apart or sheared, never pressed together. While it holds up a piece that hangs from its
    joints (the joints carry more than 65% of its weight), it tires once its load passes 10% of
    its strength.
  So a piece tears along its top first (bending pulls the top apart) and hinges on its bottom
  edge. A floor let go on three sides swings down into a ramp onto the floor below, or tears
  loose and lands flat. A facade over a blown-out ground floor hangs off the floors for a few
  seconds, its chunks sagging over the gap and tearing off one by one, then crumbles into the
  street. What hung from a member that comes away hangs from its body. When a member is shot
  away, what hung from it is let go.
- **Smashing:** a body that hits something hard breaks up, a wall into slabs and a slab into
  chunks (2-3 pieces at random places). Each piece carries on as it was going (a piece that
  wasn't in the impact keeps its speed from before it), with a little spin of its own.
  - It crushes whoever it hits by how fast it comes at them: 0.5 m v² × 6 damage per kJ, mass
    counted up to 20 t, outright with no downed state past 200. Riding a floor down does no harm.
  - It hammers the member it lands on (2.5 damage per kJ it loses), so a floor coming down can
    hole the one below or take it with it.
  - Blasts throw bodies, and wake the rubble they throw.
- **At rest it's rubble:** a body that's still (or has hardly moved in 1.5 s, or has been moving
  15 s) sleeps. It's then cover: boxes stepped to the lie of each piece, so a slab leaning on a
  wall is a stair you can walk up (if it isn't too steep), and you can climb over the rest and
  hide behind it. Pieces under 0.12 m³ are only seen. Past 480 bodies, the smallest at rest go to
  dust.
- **Riding it down:** a piece on the move is a floor for whoever stands on it. The movement
  bodies ask the cover for the top of anything moving under them (`Structures.topAt`), so a
  soldier on a floor that gives way is carried down on it.
- **The rest of the game:** every piece that goes or arrives is `world:coverDestroyed` /
  `world:coverAdded` with `structural: true`, so the bots' cover spots change
  (`TacticalMap`), the routes round it are redone once a tick (`NavGrid.updateRegion`), and the
  renderers update.
- **The physics** (`RigidWorld`, XPBD after Müller et al. 2020):
  - Bodies are boxes or compounds of boxes with full inertia.
  - Each tick is 6 substeps (fewer, down to 4, when more than 80 bodies are moving), each with
    one pass of position corrections; velocities come from them, then a velocity pass adds
    friction and a little bounce.
  - Contacts are box against box by separating axes (the incident face clipped to the reference
    face, or edge against edge), against each other and the static cover, plus corners and edge
    points against the terrain. They're found once a tick, a little ahead of where the bodies are
    going, and re-measured every substep.
  - Contacts are solved there and back each substep, so a slab landing flat stays flat.
  - Resting pieces lose spin, so a chunk balanced on a kerb settles.
  - Deterministic: the same blasts bring down the same pieces to the same places.
- **Seen and heard:**
  - `CityRenderer` knows each piece's instance: a piece that goes disappears from its mesh, and
    the pieces left round a hole take spare instances in the same mesh.
  - `CollapseViews` draws every body box by box, at its pose blended between the sim's last two
    ticks, moving or at rest, in the colour of the piece it came from.
  - Dust and debris (`BattleFx`): chips off a wall that held, chunks thrown out of a hole, dust
    sifting down where a building creaks or a joint tears, a cloud rolling out where a piece
    lands. The big clouds are rationed so a collapse doesn't hide every piece in it.
  - Sound: a groan before it goes, a crumble as a wall breaks, a snap as a piece tears loose (the
    rebar pinging), a crash as each piece lands (a rumble for the big ones). The ground shakes
    under you within 35 m.
- **Cost:**
  - A shell on a house costs 4-11 ms (the contacts between its members are worked out the first
    time it's hit).
  - At load, a small collapse is rehearsed off stage (the bus hushed), so the first one of the
    match doesn't stall the game compiling it.
  - A collapse in progress costs about 40 µs a tick per moving body. A barrage of 24 howitzer
    shells on four houses averages 2.4 ms a tick for the buildings (99th percentile 7 ms).
  - Pieces stop breaking up further past 160 bodies moving at once, and blasts stop throwing
    chunks past 90.

### The city's people (`Neutrals`, `CivilianBrain`, `Teams`, `data/civilians.json`)

The city is still lived in. Besides the two armies there are its **civilians** (team 2) and its
**bandit gangs** (team 3). Neither respawns, costs a ticket or counts on a point.

- **Who fights whom** (`Teams.js`, `CombatWorld.hostile`): the armies fight each other and the gangs
  always. A civilian never starts a fight: armed (only with a gun picked up off the field), he shoots
  at an armed stranger who comes within his reach (12 m, 18 m for a group at its shelter) or at a
  side that hurt him or his people (for 25 s). Whoever he's shooting at fights him back while he does
  (8 s after his last shot), nobody else. Unarmed, nobody targets him; stray rounds and blasts still
  kill him. Bots don't fire through civilians any more than through their own (`FireDiscipline`),
  nor call strikes on them. Killing one who wasn't fighting you costs battle points (`civilian`,
  -150) and shows CIVILIAN in the killfeed.
- **Where they are:** about one per two soldiers (`perPlayers`), spread over the line sectors (more
  toward the middle, where the fighting starts), clear of the points and spawns: in a house's
  rooms, a ruin's, behind a market's counters, some out in the street near their shelter when the
  battle starts (they walk about between a few spots there until it reaches them). Some shelter
  together in a house (`groups`), all brave, now and then with guns hidden there (`cache`).
- **What they do** (`CivilianBrain`, the same Command a player sends):
  - fighting heard (shots within 45 m, blasts further): get down where they are if they're
    indoors; out in the open, run for the safest shelter they know (away from it, near, indoors
    best) and get down there;
  - danger (hurt, an armed stranger in sight within 10 m, rounds or a blast right by them): run, at
    a sprint along a nav route, to a shelter away from it; not twice in a few seconds. A group
    holds its shelter together; only the hurt one runs;
  - hiding: crouched (flat under fire), hands over the head (the rig's cower pose); standing again
    when it has been quiet for 40 s;
  - brave ones (40%), once the fighting has come near and nothing is close: fetch a gun lying near
    (`WeaponDrops`: a fallen soldier drops his 60% of the time; caches) and take it, then defend
    themselves with it, in bursts, badly;
  - downed: crawl away from the trouble.
- **The gangs** (one per 12v12 match, two at 32v32, three at 64v64, five at 200v200): four to six
  raiders each, armed, holding a turf (30 m round a house or a market off the main fight) with the
  soldiers' own brain and the turf as the point they defend, so they fight whoever walks in, see no
  further than their own streets (60 m) and drift back rather than chase. A banner warns you as you
  walk into one's turf.
- **Their look:** street clothes for the civilians (coats, jackets, hoods, caps, bare hair, lit
  glasses, bags; their colours and faces vary person to person) with a neutral rim light that turns
  red while one fights your side; raiders in scavenged plates with a spiked pauldron, crest and
  goggles in their gang's colour, rimmed red. Civilians' bolts are pale gold, the gangs' the
  enemy's red. Guns lying in the street glint. On the minimap: civilians near you grey, raiders who
  give themselves away orange.

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
- **The rifle butt (F, pad R3)** for anyone with a gun out (F is the sword's heavy attack when it's out): 0.12 s up, 35 damage, a 0.4 s stagger
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
  - **Mangled:** overkill by a blast, or a hit going your whole max HP past zero, is mangling. The
    body goes limp at once and the death reads `mangled`. Nobody gets up from that.
  - **Downed** soldiers crawl on their bellies toward help, or roll onto their backs and scoot away
    from a threat while facing it (bots do both). They bleed out over 25 s (paused while being
    revived) and die after 60 more damage.
  - **Revives:** a teammate holding interact for 3 s (medics 1.5 s) gets you up with 30% HP
    (medics 60%), but **injured** on the wound that put you down. Injured, you limp at 75% speed,
    can't sprint, and your aim sways 1.5× until a stim treats it. A medic's stim that gets you up
    treats it on the spot.
  - Hold jump to give up. The soldier who downed you gets the kill if you bleed out.
- **Hit reactions** (`HitReactions`, see [ANIMATION.md](ANIMATION.md)): each hit is booked to where it
  landed, and a big one rocks you even when it doesn't put you down:
  - a fifth of your pool in one hit stumbles you along it, with the gun off target;
  - a leg hit drops you onto that knee;
  - a second big hit before you've found your feet knocks you over;
  - a hit that kills or downs you without a throw stumbles you a step or two before the knees go.
- **Ragdolls** (`src/physics/Ragdoll.js`, `RagdollDrive.js`, see [ANIMATION.md](ANIMATION.md)): a
  blast within 75% of its radius, a critical hit (one hit taking 45% of your health pool, or a
  headshot taking 40%), a heavy melee blow, a vehicle ram, and every down or death throw the body
  as a full physics ragdoll. It has muscles:
  - a dying body folds at the knees and drops;
  - a living one flails in the air, breaks its fall with its hands and clutches the wound.

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

## Command

Each side has one commander. A person can take the seat (start menu: **Commander**, or
`class=commander`); when nobody does, the AI commands (`Strategist`, veteran and elite). Either way the
squads take the commander's orders the same way, and squads given none follow standing orders.

- **The commander's seat** (`CommandView`): the front from above at 60°, your side at the bottom of the
  screen. WASD or the arrows pan, the wheel zooms (from 60 m out to the whole map), the middle button drags the map, Home goes
  back to the front. On the map: the capture points (owner's colour, capture ring, CONTESTED), both
  front lines, your soldiers, each squad's marker (its number and men up; amber while it hasn't gone
  yet, grey while it falls back) with a line to where it was sent (white: your order), your scouts and
  the ground they watch, fire missions and shells landing. Ground nobody has watched lately is darkened
  (the fog of war), and enemies show only where the team sees them now, with rings where they were
  last seen, fading over 30 s. The 3D view keeps the same fog of war: an enemy soldier is drawn only
  while the team sees him. The squad cards on the left say what each squad is doing and under whose
  orders. The radio on the right logs every order, refusal, report and fire mission. The person in
  the seat is off the field: he isn't one of his side's soldiers, and nobody can shoot him.
- **Orders** (`FrontlineCommander.give`): select squads (click a marker or card, Shift for several,
  **1**–**9**, Ctrl+A for all) and right-click the map: take the point there (hold it, if it's ours), or
  hold that ground. Or arm one and left-click: **T** take, **H** hold, **R** scout. **B** falls back to
  our line and **X** hands the squad back to standing orders, both at once. **F** arms a fire mission
  (no squad needed). A place can be anywhere: a crossroads, a building, a hill. It becomes a point the
  squad gets to and holds, clearing what's in the way, and the radio names it from the nearest point
  ("40 m past B2").
- **Obedience** (`command.obey` per difficulty): out of contact a squad nearly always goes at once and
  acknowledges. In a firefight it may finish it first; pinned down it mostly can't move yet; falling
  back, it regroups first. A squad that can't go says why ("Negative, pinned down. Will comply when we
  can."), tries again a few seconds later, and goes by the third try. Holding where it already is,
  it always obeys.
- **Intel** (`Intel`, one per side, `world.intel[team]`): whatever any soldier of ours sees, the team
  knows. Bots report what their sight finds as they pick targets, a squad under fire reports who shot
  it, and a scout on watch sweeps a wider circle. A contact unseen for a moment is a last known
  position, and it's forgotten after 45 s or when he dies. The map is also kept in 24 m cells marked
  with when one of ours last watched them: where we've looked lately and seen nobody, there's nobody.
  The guns fire on groups our soldiers can see (observed fire), and the commander's view, the AI's
  reading of the enemy and fire missions all read the same intel.
- **Scouts** (`ScoutTask`): the squad's marksman (or its infiltrator, or whoever isn't leading) goes
  ahead to a vantage point 60–110 m short of the place, on our side of it, with a clear line of sight
  to it and away from enemies we know of (in cover, if there's any). He runs there and fires only at an
  enemy right on top of him. Then he goes low facing the place and keeps watch for 75 s: everything he
  can see within 130 m goes into the team's intel twice a second, and his ground counts as watched. He
  reports what he sees on the radio ("Eyes on B2: 4 hostiles!"), and comes back when his watch is over,
  when he's hit or an enemy gets within 20 m.
- **Fire missions** (`commander.fire`, `SupportCommand.request`): every gun in range shells the spot.
  Where we have eyes on it (fresh contacts, or ground watched in the last 10 s) the rounds land on the
  mark; fired blind, the aim is off by 10–25 m and the rounds scatter twice as wide. A person's call
  outranks everything the guns do on their own, even danger close. The AI's own fire only prepares an
  attack as it goes in, below counter-battery fire: guns that fire too much get found and shelled
  (measured: when the AI ordered a mission every 12 s, the enemy's counter-battery killed 25 of its
  gun crews in five minutes, against 7).

## Squads and the commander

- **Commander** (`FrontlineCommander`): one per team, re-plans every 4 s and when a sector falls. It
  splits its squads between attacking the points of the attacked sector (weighted toward neutral and
  half-taken points, at least one squad per point) and defending its own points under attack
  (weighted by enemies on the point and how far it has slipped; two squads for a point being taken
  from us). Squads keep orders that still fit.
- **The line:** points alone drew every squad onto two or three spots and left the ground between
  them and the flanks empty. With four squads or more, about four in ten (a quarter while one of our
  points is being taken, and never the squads the points need) hold the front instead. It's cut into
  lanes across the map: the city's avenues, or evenly across the ground the trenches span (clear of
  the berms), every lane's spot snapped to open ground. They're manned the furthest from any point
  first: the gaps, then the flanks. While our attack on the sector ahead is going (a point of it ours,
  or none of it theirs yet) the line stands a third of the way into it, going over the top with the
  wave; when the enemy holds all of it, the line pulls back just behind our own (into our trench where
  there is one). A lane is an objective like a point (role `line`, ids from 1000, `commander.target(id)`);
  on big maps the lanes share one flow field to the whole line (a field there is 1–3 MB and they're
  capped at 24). Measured at 64v64 (living bots binned into eighths of the map's depth over two
  minutes): before, two eighths held 65% of them; with the line, every eighth between the berms holds
  12–18%.
- **The whistle:** squads attacking across their own trench man it and report ready. The commander
  blows one whistle per trench line (waiting 6 s for other squads to get in, at most one wave every
  18 s) and every ready squad goes over the top together. Event `squad:whistle`.
- **Squad tactics** (`SquadTactics`, per squad, twice a second): advance in a wedge, bounding
  overwatch under contact, sweep and clear, assault, hold the line with anchors on the point, hold a
  lane of the front strung out across it, dig in, charge only when desperate, follow a human leader.
  See [AI.md](AI.md).

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

Laid out like the reference clips. Colours are relative to you: your side blue, theirs red, the
city's civilians grey and its gangs orange. Numbers and labels are in a squared display face
(Orbitron), names and speech in a condensed one (Rajdhani); both ship in `vendor/fonts` (SIL Open
Font License) so the game looks the same offline. On a planet with letterbox bars everything sits
inside them.

| Where | What it shows |
|---|---|
| Top | Your side's name, tickets and bar on the left; the sectors as circles from your HQ to theirs (owner's colour, pulsing while fought over, a ring filling as one falls, ◆ on each front); the match clock counting down; theirs mirrored on the right |
| Under it | A compass strip: headings (N, NE, E...) and degrees every 15°, the live capture points at their bearings, your squad's objective ringed |
| Top left | Your squad: its callsign (ANVIL, RIVET...; the Void's WRAITH, HOLLOW...) and morale (CONFIDENT, SHAKEN after losses, BROKEN while falling back), what it's doing (ADVANCING B1, IN CONTACT · BOUNDING, HOLDING C2...), the order (`ORDER: TAKE B1 · 61 M`), then each member with a role tag (TRP, HVY, RCN, ENG, MED, MKS, BLD, PLT, TCH, DEM), what they're up to and a health line; the leader starred, you last |
| Top right | The killfeed: ▸ a kill, ◆ a down; TEAMKILL and CIVILIAN flagged |
| Bottom left | Radio chatter (`BarkVoices`), then the armour readout: a trooper doll in outline, ARMOUR and your health as a large percentage, a bar of ten segments; your side's colour when healthy, amber under 60%, red and pulsing under 30% (and while downed). Under it your stance (STAND, SPRINT, PRONE, SLIDE, DOWNED...), shield and stamina lines, your passive and items, battle points |
| Bottom right | A round minimap, heading up, about 110 m to the rim: building and wall footprints, sectors tinted by owner, points (pinned to the rim when far), allies, downed teammates, enemies that fired or a spotter revealed, nearby civilians, our depots, guns and trucks, enemy guns we've located, shells landing; north on the rim. Under it the weapon panel: the weapon's name and fire mode (AUTO, SEMI, PUMP, BOLT...), its silhouette in outline, the magazine large with the reserve beside it and a bar for what's left in the mag (heat or charge for energy weapons; red when low), RELOADING with its progress, the view (`3RD PERSON [V]`), and your grenades as pips (GRENADES READY) |
| In the world | Capture points (owner's colour, capture progress round them, distance; your squad's one labelled ATTACK or DEFEND), red crosses over downed teammates within 60 m (distance and bleed-out), the crosshair and HD2's second reticle where the gun really points |
| Centre | Banners (captures, sectors, victory, `WHISTLES · OVER THE TOP!` and the enemy's, shortages, friendly fire, gang turf); over the crosshair `ELIMINATED <NAME>` for each of your kills (`DOWNED <NAME>` for a down, dimmer); when you die, the red `ELIMINATED` banner with hatched bars either side and who killed you (KILLED BY, TEAMKILLED BY, BY YOUR OWN FIRE) until you deploy again; the downed and reinforcement states, prompts (revive, finish, dig, repair, stim, crew, push a car back over, driving controls), Mindread's line over the enemy in your sights |
| Controls card | Up for the first 25 s of a match; F1 hides it or brings it back |
| Call-in (`StratagemPanel`) | While the call-in key is held: your stratagems with their codes, typed arrows lit on the codes that still match, cooldowns, uses and rearms, your battle points and every price (BUY 400 on one that's cooling down, lit when you can pay); with a beacon in hand, which one, how to throw it and what it will cost; a red flash on a wrong arrow. Markers over your side's live beacons (name, countdown, DANGER CLOSE), and the supply prompt beside a pod |
| Battle points (`BattlePointsHud`) | The total on the status panel; a line under the crosshair per thing you did, repeats adding up on one line, and what you spend or lose on death |
| Radio chatter (`BarkVoices`) | Your squad's lines, and anyone's within 40 m, spoken and written up bottom left: your squad's on an amber rule with rank and name (your squad leader is the sergeant), anyone else's dimmer in his side's colour; `?voices=off` keeps only the text |
| Melee (`MeleeTells`) | Chevrons round the crosshair for swings coming at you (amber blockable, red not, white: now); HOLD X TO FINISH over a downed enemy, FINISHING with its progress |
| Support | Your passive and items on the status panel; **3 STIM** facing a hurt or downed teammate, **HOLD H TO REPAIR** beside a damaged vehicle of ours, REPAIRING with the hull's health; enemies a spotter revealed glow red and show on the minimap |
| Guns | Crew and drive prompts; at a gun, FireControl's panel (overhead fire-control view with the predicted arc, the scatter ring, range, flight time, rounds and loading; for an AT gun a second reticle where the barrel points). See [VEHICLES.md](VEHICLES.md) |
| Supply | The forward depot's stock and the HQ dump's above the minimap, trucks on the road; banners for shortages, depot moves and the preparation barrage |
| Suppression | The screen edges darken while rounds crack past you |
| Hit markers (`HitFeedback`) | At the gun's reticle, on each hit of yours: four white ticks (90 ms); a kill: bigger and red (180 ms); a headshot: gold; a round the armor shrugs off: small and grey, with a dull plink (switch weapons or aim elsewhere); a teammate: a blue X. Each kind has its own confirm sound |
| Damage direction | A red wedge on a ring round the crosshair pointing at whoever hit you (a blast: where it burst), as strong as the hit, fading over 1.2 s and turning with you. The hit also kicks your view up and toward it (0.6° per 20 damage, at most 3°, back in 120 ms) and knocks your gun's aim by half that |
| Hurt (`VisorDamage`) | The screen's edges run red from 60% health down and pulse with the heartbeat under 30%; every hit flashes them. The visor cracks under 60%, 40% and 20% (a fine starburst with spider-web rings, out from the middle on the side the hit came from). Under 35% red streaks cut across the corners and blood creeps in round the border, thickest at 10%; heavy hits spatter blood at the edges, which dries off. Healing 15% past a crack's threshold clears it, a new life starts clean, and Reduced motion stops the pulsing |

## Tests

- `tests/maps.test.mjs`: every size builds a valid map (bigger matches, bigger maps, a point per
  lane, a trench line between line sectors), every point is reachable from both HQs, spawns are
  walkable, the same seed builds the same map, trench floors are flat with parapets you fire over
  standing and hide behind crouched, trenches sit on the nav grid with walkable exit ramps, ruin
  doorways are open, wire slows and is cut by blasts, digging keeps the deepest cut, a soldier pushed
  into a wall gets out, and a soldier on a trench floor can climb out. (`MAP_SEED=n` re-runs them on
  another seed.)
- `tests/squads.test.mjs`: cover spots, routes, suppression, over the top on the whistle, wedge
  spacing, bounding overwatch, hold the line, holding a lane of the front, sweep and clear, charges only when desperate, a human
  leader, digging in, and armor crossing trenches and wire with the motor pool following the front.
- `tests/structures.test.mjs`: buildings that come apart:
  - a grenade chips a wall and a tank shell holes it;
  - a howitzer round brings the wall over its hole down: it creaks, hangs on, tears loose, comes
    down in pieces and lies as rubble in front of the house;
  - a floor let go on three sides comes down flat or leans on the wall left as a ramp of steps;
  - a lintel carries the wall over one missing pier, but not over a gap wider than it spans;
  - a floor held on one side goes;
  - falling floors crush and pound, and you can climb onto the rubble;
  - a soldier is carried down on a floor that gives way;
  - a skybridge goes with its house;
  - the same blasts bring down the same pieces;
  - every body is drawn as it moves and where it lies.
- `tests/rigid.test.mjs`: the physics under it:
  - a box lands flat and sleeps;
  - stacks stay stacked;
  - a slab tears along its top and swings down into a ramp;
  - joints tear pulled apart but not pressed together, and tire;
  - a wall breaks into pieces that carry on as it was going;
  - the same fall comes out the same every time, a hundred falling costing about a millisecond
    a tick.
- `tests/command.test.mjs`: intel (what one soldier sees the team knows, stale contacts forgotten,
  watched ground, groups for the guns); the commander's seat (off the field, in no squad, his side's
  orders his, the other side's the AI's); orders (taken at once out of contact and acknowledged; a
  pinned squad says why and goes within three tries; places anywhere; back to standing orders); a
  scout (a vantage on our side with the place in reach, on watch, the place watched for the team,
  called back); fire missions (a battery takes the commander's, blind ones aimed off and twice as
  wide, the AI's below counter-battery); the AI strategist (a task for every squad within its search
  budget, its orders reaching every man, a plan in a few milliseconds).
- `tests/frontline.test.mjs`: capture rules, the moving front, victory, spawns, the commander (every
  attack point covered, two squads for a point being taken, four squads in ten on lanes spread across
  the map, flanks and gaps first, pushed forward with the attack and back behind our line), and a
  64-bot headless battle (bots close on their objectives at over 2 m/s en route, points change hands,
  under 8 ms per tick).
- `tests/scale.test.mjs`, `tests/down.test.mjs`, `tests/ragdoll.test.mjs`: the spatial indexes,
  terrain and flow fields (repairs match a fresh solve through 40 rounds of random walls built and
  blown, big-map fields build in the background and reach REACH metres, a field with several goals
  routes to the nearest and repairs exactly); downs, revives and
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
- `tests/civilians.test.mjs`: who fights whom (the armies and gangs always; a civilian only armed and
  close or wronged, fought only while he fights); a civilian out in the open runs from shots to a
  shelter away from them and gets down, hands over his head; one indoors gets down where he is and
  stands once it's quiet; a brave one arms himself only once the fighting has come near and shoots
  only at whoever comes close; a group holds its shelter and only the hurt one runs; a gang opens up
  on a soldier who walks into its turf, lets one far off pass and doesn't chase; bots never target an
  unarmed civilian; a city match with its people (unarmed and spread out, gangs on their turf, none
  counted on the tickets or the points).
