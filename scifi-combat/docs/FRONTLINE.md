# Frontline: 64–128 fighter battles

Code: `src/game/frontline/FrontlineMap.js` · `src/game/frontline/FrontlineMode.js` ·
`src/game/FrontlineSession.js` · `src/ai/FrontlineCommander.js` · `src/world/` (CoverIndex, EntityGrid,
Terrain, NavGrid) · client: `index.html` → `src/frontline.js`, `src/render/BattlefieldRenderer.js`,
`src/render/TracerPool.js`, `src/ui/FrontlineHud.js` · tests: `tests/frontline.test.mjs`, `tests/scale.test.mjs`.

Battlefront Supremacy crossed with Battlefield Frontlines. Two armies fight over a line of sectors.
Taking every point of the sector in front of your line moves the front forward, and the fight
follows it until one side breaks through to the enemy HQ. Bots fill every slot. They use the same
`Command` struct, movement, kits, guns, swords and vehicles as a player.

## Play it

Serve the folder statically and open `index.html`:

| Param | Default | |
|---|---|---|
| `players` | 64 | 8–128 fighters in total (you plus bots, split evenly) |
| `seed` | 7 | map and match seed (deterministic map) |
| `team` | 0 | 0 = Solari (attacks east), 1 = Void (attacks west) |
| `class` | lancer / reaver | any class id from `data/classes/*.json` |
| `difficulty` | veteran | recruit, veteran or elite bot aim and reactions |

The controls are the arena's (WASD, Shift sprint, C crouch/prone/slide, Alt dive, Space climb, LMB/RMB,
R, 1 sword/gun, Q E G Z abilities, X vehicles). When you're down, wait for the countdown, then press
**Space** to deploy. `arena.html` is the 4v4 feel lab and `rig-lab.html` is the animation lab.

## The map (`FrontlineMap`)

A seeded 1000 × 400 m map. Server and clients build the same one from the seed.

```
 x: -500    -400      -240       -80        80        240       400    500
    | HQ 0 |    A     |    B     |    C     |    D     |    E     | HQ 1 |
    |      |  A1  A2  | B1 B2 B3 | C1 C2 C3 | D1 D2 D3 |  E1  E2  |      |
       Solari owns A–B        neutral          Void owns D–E
```

- **13 points.** The sectors next to the HQs have 2 lanes; the middle three have 3 (z ≈ −110, 0, +110).
  Points have a 9 m radius.
- **Every point is a fortified position.** A strongpoint sits in the middle, inside a broken ring of
  vaultable low walls and high walls, with crates. Fighting at a point means taking the position.
- **Lines of battle.** Staggered trench walls cross the map at every sector boundary, so the front has a
  physical line to push across, with deadly open ground between the lines. Some sectors also get large
  structures that break sightlines and open flank routes.
- **Terrain.** Rolling value-noise hills (2 m samples, 7 m amplitude), flattened under points and
  spawns.
- **Spawns.** Each sector has a *forward* group per team near its edge toward the enemy, for a
  short run to the line, and a *rear* group.
- **Nav.** A 2 m grid (500 × 200 cells). Slopes over 38° and cover taller than 1.1 m are blocked;
  vaultable cover costs 4× (bots vault it with hold-to-climb).

## Rules (`FrontlineMode`, simulation only)

| Setting | Default | |
|---|---|---|
| tickets | 6 per fighter (384 at 64, 768 at 128) | one per death |
| `captureTime` | 10 s | one soldier taking a neutral point; an enemy point is neutralized first (2×) |
| `secureTime` | 3 s | holding every point of the attacked sector captures it |
| `sectorBonus` | +30 tickets | for the team that takes a sector |
| `timeLimit` | 25 min | then the team holding more line sectors wins |
| `regen` | 0.04 / s | unattended owned points recover; neutral progress ebbs away |

- **Start.** A and B are Solari, D and E are Void, and C is neutral. Each team's *front* is its forward
  sector (B and D).
- **Attack.** Each team attacks the sector in front of its front. Both race for the neutral middle.
  After that, each attacks the other's front sector while defending its own. Only points in attacked
  sectors can change hands; everything behind the lines is locked.
- **Capture.** Progress moves by the headcount difference inside the radius (capped at 3), so
  defenders cancel attackers one for one and an even fight freezes the point.
- **Sector capture.** Owning every point of the attacked sector for `secureTime` (a separate timer per
  team) captures the sector. The front moves up, the loser falls back, points behind the new line lock
  to their owner, and the attacker gets reinforcements.
- **Victory.** Breaking through the last line sector in front of an HQ, the enemy running out of
  tickets, or leading at the time limit.
- **Events:** `mode:point`, `mode:contested`, `mode:sector`, `mode:front`, `mode:tickets` and `mode:victory`.
  The HUD banners and audio use them. `mode.snapshot()` is the compact state for HUDs and network
  snapshots.

## Spawning and reinforcements (`FrontlineSession`)

- **Waves.** The dead come back in waves (every 6 s per team) after at least 4 s down. Each death
  costs a ticket.
- **On the squad leader.** Where possible a fighter deploys next to its squad leader: the leader must
  be alive, on foot, not hit in the last 3 s, and have no enemy within 25 m.
- **Otherwise at a spawn group.** The fighter deploys at the safe spawn group closest to the front: the
  front sector's forward group, then its rear group, then sectors further back toward the HQ.
  `spawnPosition` walks back sector by sector.
- **You.** After the countdown the HUD shows *PRESS SPACE TO DEPLOY*, and you deploy with the same
  rules.

## Squads and the commander (`FrontlineCommander`)

- **Squads.** Squads have 4 members. The leader heads for the objective and members hold slots around
  it. Everyone respawns on the leader.
- **Orders.** One commander per team re-plans every 4 s, and immediately when a sector falls. It splits
  its squads between:
  - *attacking* the points of the attacked sector, weighted up for neutral points and for points
    already partly taken;
  - *defending* its own points that are being taken, weighted by the enemies on the point and by
    how far it has slipped.
- **Allocation.** Squads are allocated in proportion to need, with at least one squad per attack point.
  Squads keep their orders unless the plan changed, so they don't thrash.
- **Execution.** Orders are plain data on each brain (`brain.objective = { id, pos, radius, field,
  role, slot, of, squad }`). `CombatBotBrain` follows the objective's flow field (`pt:<id>`) and
  shoots on the move. It only stops for a proper fight (range band, strafing, sword duels) in three
  cases:
  - an enemy is within 18 m;
  - it's being shot from within 30 m;
  - the enemy is holding the point it needs.

  On the point it keeps its slot and fights from there. (The old rule stopped for anything within
  40 m or any damage, and on a crowded front that stalled the push.)

## Scale: 128 fighters in a frame

**Simulation (the same code headless, in tests and in the browser):**

| Piece | What it buys |
|---|---|
| `CoverIndex` (8 m XZ grid, DDA raycasts) | Bullet and line-of-sight raycasts against thousands of boxes |
| `EntityGrid` (rebuilt per tick) | "Fighters near here" and ray-vs-fighters without scanning all 128 |
| Cached `world.fighters()` (keyed by `world.version`) | No per-query array building |
| Flow fields per objective (`NavGrid`) | One Dijkstra per point shared by every bot. Prewarmed at load. When cover breaks, the stale field keeps serving while a resumable rebuild runs at 4000 cells per tick (~0.7 ms). A full field is 100k cells, ~20 ms done at once, which used to be a hitch. The budget counts work, not time, so the sim stays deterministic |
| Bot think LOD | Bots within 60 m of a human think every tick, within 160 m every 2nd tick, otherwise every 3rd. The last command is held in between |
| Determinism | Bots and duelists draw from per-bot seeded streams, and spawns from the mode's, so a seed replays the same battle in a fresh process. Tests rely on it; replays and debugging can too |

**Presentation:**

| Piece | What it buys |
|---|---|
| `AnimationSystem` LOD | Full rig with events under 70 m, half-rate rig under 220 m, impostor beyond |
| `CrowdRenderer` | The whole crowd in 5 instanced draw calls, with CPU frustum culling |
| `BattlefieldRenderer` | Terrain at 4 m (~50k triangles) with a tiling detail texture so speed reads off the ground; cover as one InstancedMesh per material (destroyed boxes are zero-scaled); point rings, progress arcs and team-colored beacons; a curtain on each team's front line |
| `TracerPool` | Every tracer and live projectile in 2 instanced draw calls, with no allocation per shot |
| Shadows | One 2048² sun shadow map over ±45 m that follows the player |

**Measured** on this container (Node, single thread, seed 5, 90 s battles):

| | 64 fighters | 128 fighters |
|---|---|---|
| Sim, average per 60 Hz tick | 1.1 ms | 2.3 ms |
| Bot thinks per tick | 28 | 56 |
| Map and match build | 0.3 s | 0.4 s |

The browser client at 64 fighters, mid-battle at the middle point (swiftshader), used about 70 draw
calls, about 77k triangles, and about 1 ms of sim per tick.

**Known gaps and next steps:**
- **Per-mesh deployable, zone and vehicle views** make up most of the remaining draw calls. Instance
  them like the crowd.
- **Rare tick outliers (15–30 ms, about one per 90 s at 128).** Neither nav nor GC accounts for them
  (mark-compact pauses are 2–3 ms). Profile them in the browser.
- **Netcode.** Use sector-based interest management and send the animation LOD tiers at snapshot rates.

## HUD (`FrontlineHud`)

| Element | What it shows |
|---|---|
| Top bar | Tickets, plus a sector strip in owner colors with ◆ on each team's front and a fill bar while a sector is being secured |
| Orders | Your squad's order and distance, e.g. `ATTACK C2 · 30 m` |
| Point markers | Edge-clamped, with the owner color, a conic capture-progress ring, a pulse while contested, and distance |
| Minimap | Sectors, points, allies, and enemies who fired in the last 2 s |
| Gun reticle | HD2-style: where the gun actually points (projected at 60 m), apart from the camera dot. Weapon ergonomics drag shows here |
| Also | Status bars, ammo, killfeed, capture and sector banners, victory or defeat, and the reinforcement countdown |

## Tests

- `tests/frontline.test.mjs` covers:
  - only attacked sectors being capturable;
  - capture timing (numbers help, defenders cancel);
  - sector capture moving the front and locking the points behind it;
  - both victory conditions;
  - spawns following the front and avoiding hot spawns;
  - commander allocation;
  - a 64-bot headless battle. Bots en route must close on their objective at over 2 m/s (it's
    3.7–4.3 across seeds) and at least 30% must reach it. Points must change hands, there must be
    hits and redeploys, tickets must fall, and the average sim must stay under 8 ms per tick. The run
    prints these numbers as a test diagnostic, and the sim is deterministic, so they repeat.
- `tests/scale.test.mjs` checks that the spatial indexes give exactly the brute-force answers, that
  terrain carries movement and bullets, and that flow fields route around walls, reopen when cover
  breaks, and rebuild in slices that match an uninterrupted solve.
