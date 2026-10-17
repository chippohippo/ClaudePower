# Frontline: 4v4 to 64v64 trench battles

Code: `src/game/frontline/` (MapSizes, FrontlineMap, Trenches, Ruins, Fortify, FrontlineMode) ·
`src/game/FrontlineSession.js` · `src/ai/FrontlineCommander.js` · `src/ai/tactics/` (squads: see
[AI.md](AI.md)) · `src/world/` (Terrain, CoverIndex, EntityGrid, NavGrid, WireField) · client:
`index.html` → `src/frontline.js`, `src/render/BattlefieldRenderer.js`, `TerrainChunks.js`,
`CoverTextures.js`, `src/ui/FrontlineHud.js` · tests: `tests/maps.test.mjs`, `tests/squads.test.mjs`,
`tests/frontline.test.mjs`, `tests/scale.test.mjs`, `tests/down.test.mjs`, `tests/ragdoll.test.mjs`.

Battlefront Supremacy crossed with the Western Front. Two armies fight over a line of sectors
separated by WW1 trench lines. Taking every point of the sector in front of your line moves the
front forward, and the fight follows it until one side breaks through to the enemy HQ. Bots fill
every slot and fight in squads: they man the trench, go over the top together on the whistle,
bound from cover to cover, clear buildings room by room, hold the line, and dig in. They use the
same `Command` struct, movement, kits, guns, swords and vehicles as a player.

## Play it

Serve the folder statically and open `index.html`:

| Param | Default | |
|---|---|---|
| `size` | 32v32 | `4v4`, `12v12`, `32v32` or `64v64`: the match size and the map built for it |
| `players` | (from size) | 8–128 fighters in total; picks the size built for that count if `size` isn't given |
| `seed` | 7 | map and match seed (deterministic map) |
| `team` | 0 | 0 = Solari (attacks east), 1 = Void (attacks west) |
| `class` | lancer / reaver | any class id from `data/classes/*.json` |
| `difficulty` | veteran | recruit, veteran or elite bot aim and reactions |

The controls are the arena's (WASD, Shift sprint, C crouch/prone/slide, Alt dive, Space climb, LMB/RMB,
R, 1 sword/gun, Q E G Z abilities, X vehicles), plus **H** (hold) to dig in and **X** (hold) beside a
downed teammate to revive. When you're down: crawl, hold **Space** to give up; when dead, **Space** to
deploy. Your squad's bots follow you and take cover around you when you stop. `arena.html` is the
4v4 feel lab and `rig-lab.html` the animation lab.

## A map per match size (`MapSizes`, `FrontlineMap`)

| Size | Map | Players | Area | Sectors × lanes | Points | Trench lines | Vehicles per team |
|---|---|---|---|---|---|---|---|
| 4v4 | Outpost | 8 | 260 × 120 m | 3 × 1 | 3 | 2 | — |
| 12v12 | Ridgeline | 24 | 520 × 220 m | 3 × 2 | 6 | 2 | 1 hoverbike |
| 32v32 | Valley | 64 | 900 × 360 m | 5 × 2–3 | 13 | 4 | 1 tank, 2 hoverbikes |
| 64v64 | Frontline | 128 | 1400 × 520 m | 7 × 2–3 | 19 | 6 | 2 tanks, 3 hoverbikes |

Each profile also sets terrain relief, point radius, village placement, crater density, scatter,
blockhouses, tickets per player, wave timing, capture and time limits, and how many positions each
team may dig. Everything is seeded: the server and every client build the same map.

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
- **Nav** (`NavGrid`, 2 m cells): slopes over 38° and cover taller than 1.1 m block; vaultable
  cover costs 4×; trench parapets 10× (climbable, but routes inside a trench network use the floor);
  wire 8×. Doorways are portals (routes thread through the door's centre). Flow fields per
  objective, A* with string pulling for squad moves.

## Rules (`FrontlineMode`, simulation only)

| Setting | 4v4 | 12v12 | 32v32 | 64v64 | |
|---|---|---|---|---|---|
| tickets | 80 | 168 | 384 | 640 | one per death (downs cost nothing; a revive saves one) |
| `captureTime` | 8 s | 10 s | 10 s | 10 s | one soldier taking a neutral point; an enemy point is neutralized first (2×) |
| `secureTime` | 3 s | 3 s | 3 s | 3 s | holding every point of the attacked sector captures it |
| `timeLimit` | 10 min | 15 min | 25 min | 35 min | then the team holding more line sectors wins |
| waves | 5 s | 6 s | 6 s | 7 s | reinforcement waves |

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
map and the renderer, and blasts and tanks knock the sandbags down. Each team may dig 8 / 16 / 30 / 50
positions (4v4 → 64v64). Engineers dig 1.5× faster. Events: `fort:dig`, `fort:built`.

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

## Scale

**Simulation** (the same code headless, in tests and in the browser):

| Piece | What it buys |
|---|---|
| `CoverIndex` (8 m grid, DDA raycasts) | Bullet and sight raycasts against thousands of boxes; refuses corrupt (non-finite) queries |
| `EntityGrid` (rebuilt per tick) | "Fighters near here" and ray-vs-fighters without scanning all 128 |
| Flow fields per objective (`NavGrid`) | One Dijkstra per point shared by every bot; stale fields keep serving while a resumable rebuild runs on a work budget (deterministic) |
| A* (`NavGrid.path`) | Squad moves between cover: ~0.07 ms for a 30 m route, bounded search, string-pulled, doorway portals |
| `TacticalMap` | ~10k cover spots, trench positions, craters and rooms in a 16 m grid, with reservations |
| Squad plans at 2 Hz, staggered | 32 squads cost a few planning passes per tick |
| Bot think LOD | Bots within 60 m of a human think every tick, within 160 m every 2nd tick, otherwise every 3rd |
| Determinism | Per-bot and per-squad seeded streams; a seed replays the same battle. Commands are sanitized (a NaN can never reach the sim) |

**Presentation:**

| Piece | What it buys |
|---|---|
| `TerrainChunks` | 128 m chunks with distance LOD (every sample near, every 2nd mid, every 8th far), skirts, at most 2 rebuilds per frame; runtime digging rebuilds just the touched chunks |
| `BattlefieldRenderer` | Cover as one InstancedMesh per material with world-space textures (`CoverTextures`: stuffed sandbag courses, cast concrete, planks, rock, riveted steel), duckboards, wire as instanced pickets plus one line set, point rings and beacons, front-line curtains |
| `CrowdRenderer`, `AnimationSystem` | The crowd in 5 instanced draw calls; full rig under 70 m, half-rate under 220 m, impostors beyond; corpses stay where they fell |
| `TracerPool` | Every tracer and live projectile in 2 instanced draw calls |

**Measured** on this container (Node, single thread, seed 5, 90 s battles with squads, digging,
vehicles, downs and ragdolls):

| | 4v4 | 12v12 | 32v32 | 64v64 |
|---|---|---|---|---|
| Fighters | 8 | 24 | 64 | 128 |
| Map and match build | 0.08 s | 0.18 s | 0.58 s | 0.94 s |
| Sim, average per 60 Hz tick | 0.25 ms | 0.53 ms | 1.55 ms | 3.43 ms |
| Worst tick | 3.5 ms | 6.1 ms | 7.8 ms | 10.7 ms |

The browser client (swiftshader) runs the 64-fighter Valley at about 77 draw calls and 240k
triangles, and 128 fighters at about 122 draw calls and 367k triangles (mostly the near terrain).

**Known gaps:** per-mesh deployable, zone and vehicle views make up most of the remaining draw calls;
the nav grid is 2 m, so trench corners and doorways need the special handling above; netcode needs
sector-based interest management.

## HUD (`FrontlineHud`)

| Element | What it shows |
|---|---|
| Top bar | Tickets, plus a sector strip in owner colors with ◆ on each team's front and a fill bar while a sector is being secured |
| Orders | Your squad's order and distance, e.g. `ATTACK C2 · 30 m` |
| Squad panel | Your squad's phase (ON YOU, BOUNDING · IN CONTACT, IN THE TRENCH · WAITING FOR THE WHISTLE, CLEARING A BUILDING, HOLDING THE LINE...) and what each squadmate is doing, or that they're down |
| Banners | Captures, sectors, victory, `WHISTLES · OVER THE TOP!` and the enemy's whistles |
| Downs | Your bleed-out, give-up hold and revive progress; a revive prompt beside a downed teammate; red crosses over downed teammates |
| Digging | Progress through foxhole, sandbags and trench |
| Suppression | The screen edges darken while rounds crack past you |
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
  terrain and flow fields; downs, revives and give-ups; the ragdoll.
