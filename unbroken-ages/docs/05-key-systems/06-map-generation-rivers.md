# 5.6 Map Generation with Navigable Rivers

**Code:** [`MapGenerator.cs`](../../src/UnbrokenAges.Sim/Map/MapGenerator.cs) · [`MapGrid.cs`](../../src/UnbrokenAges.Sim/Map/MapGrid.cs) ·
[`Noise.cs`](../../src/UnbrokenAges.Sim/Map/Noise.cs) · movement rules [`Movement.cs`](../../src/UnbrokenAges.Sim/Systems/Movement.cs) · preview `ua mapgen`

## Two-tier rivers: the design decision
| Option considered | Verdict |
|---|---|
| Edge rivers only (Civ VI) | Great adjacency and crossing gameplay, but boats cannot use them, which is the community's #1 map request |
| Boats move *along edges* (vertex graph) | Faithful, but it breaks one-unit-per-tile stacking, pathing, combat and readability |
| Rivers as water tiles only | Navigable, but loses edge adjacency ("river along this Market") and makes every river consume land |
| **Hybrid (ours)**: edge rivers everywhere + **Great River channel tiles** for the largest basins | Keeps edge-river depth; big rivers are navigable water tiles with standard stacking and pathing; channels count as rivers for fresh water and adjacency |

Channel tiles (`TERRAIN_CHANNEL`, class `Channel`) are fresh-water, navigable by any `riverCapable` naval unit from the Ancient era (ocean-going ships
such as the Caravel are too deep-drafted), host the **River Port** district, can be **forded** by land units (`fordCost` 3) or crossed on **bridges**, and drain into the sea or a lake.

## Pipeline (deterministic, fixed-point)
1. **Elevation**: continent mask (distance to K seeds in the 22–78% latitude band) × 0.55 + 5-octave value noise × 0.45 − polar falloff. The noise
   lattice wraps horizontally, so maps tile east–west seamlessly. **Sea level** is a percentile, so land fraction is exact (`LandPercent`).
2. **Relief**: ridged noise blended with elevation ranks land; the top 7% become mountains and the next 16% hills, giving ranges rather than speckle.
3. **Water bodies**: water next to land is Coast, the rest Ocean; small enclosed seas become Lakes.
4. **Climate**: temperature from latitude, noise and altitude. **Moisture** comes from prevailing-wind sweeps per row (easterlies in the tropics and polar band,
   westerlies at mid latitudes, two laps on wrapping maps). Humidity is picked up over water and rained out over land, heavily on mountains, which creates
   **rain shadows**. It is blended with noise and a tropical bias.
5. **Biomes & features**: snow, tundra, desert, plains and grassland by temperature × moisture. Woods, rainforest, marsh, oasis, reef, ice, volcanoes and
   geothermal fissures come from clustered noise and data validity rules (`validTerrains`). **Inland lakes** form in wet basins.
6. **Tile drainage → Great Rivers**:
   * *Priority-flood* from all water tiles. Every land tile gets a downstream neighbour and pits are filled (`filled = max(elev, parent + 1)`).
   * *Flow accumulation* in reverse flood order, weighted by rainfall (+ snowmelt on mountains).
   * Take mouths (land whose downstream is sea or lake), sorted by accumulation, and walk **upstream along the largest tributary** while accumulation is
     ≥ 8% of the mouth's, avoiding mountains and other channels. Keep the river if it has ≥ `MinGreatRiverLength` tiles.
     Because every step follows a downstream link, a channel is **contiguous by construction and always reaches open water**.
7. **Vertex drainage → edge rivers**: run the same flood and accumulate on the **hex-corner graph** (each tile owns its N and S corners; each vertex has
   3 tiles and 3 neighbour vertices). Vertices touching water (including channels) are sinks. Every vertex above the `MinorRiverPercent` accumulation
   percentile draws a river on the edge to its downstream vertex, but only between two land tiles. Edge rivers therefore form trees that **feed Great Rivers, lakes or the sea**.
8. **Floodplains** on flat desert, plains or grassland along major edge rivers (accumulation ≥ 2× threshold) and along channels (60%).
   **Coastal lowlands**: the lowest 35% of flat coastal tiles, split into bands 1–3 m for sea-level rise.
9. **Resources** by data (`validTerrains/Features/Reliefs`, `frequency` per 1000 eligible tiles), with spacing (bonus: no adjacent resources; luxury/strategic: 3 tiles).
10. **Start positions**: a score over radius 2 (food, production, gold, resources) + fresh water 15 + coast 6 + Great River 8 − tundra/desert 8, picked greedily
    with a min distance of √(land/players) that relaxes if needed. Civ `startBias` (e.g. Egypt: Great River, floodplains) applies in M1.

Generation takes about 50–160 ms for Duel to Standard sizes.

## Sample output (`ua mapgen --seed 12 --size MAPSIZE_DUEL`)
```
Duel 44x26, seed 12: generated in 49 ms
land=379 mountains=27 hills=61 lakeTiles=2 greatRiverTiles=7 riverEdges=57 floodplains=24 lowlands=35 resources=27
great rivers: 7 tiles


HYDROLOGY  ~ sea  o lake  = navigable GREAT RIVER (channel tiles)  + tile bordered by an edge river  ^ mountain  . dry land
~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ 
 ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ 
~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ 
 ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ . . . . . . + + + ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ 
. ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ . . . . . . . + + . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ 
 . . . + + ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ . . . . . . . . + . . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ . 
. . . + + . . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ . . . . . . . . . . . . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ . 
 . . + + . . . ~ ~ ~ ~ ~ ~ ~ ~ ~ + . . . . . . . ^ . . . . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ . . 
. . . . . . + + ~ ~ ~ ~ ~ ~ ~ ~ ~ + . . . . . . . . . . . + ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ . 
 . . . . . . + + ~ ~ ~ ~ ~ ~ ~ ~ + . . . . . . . ^ . . + + + ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ + . 
. . . . . . . . + ~ ~ ~ ~ ~ ~ ~ + + . . . . . . ^ . . . + + . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ + + 
 . ^ . . . ^ . . . ~ ~ ~ ~ ~ ~ ~ . . . . . . . ^ . . . . . . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ . . + . 
. ^ ^ ^ ^ ^ ^ . . = ~ ~ ~ ~ ~ ~ ~ . . . . . . . . . . o . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ . . . . 
 . . ^ ^ ^ ^ ^ . = . + ~ ~ ~ ~ ~ ~ . + + . . ^ . . + o . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ . . . + 
+ . ^ ^ ^ . . = = . . + ~ ~ ~ ~ ~ ~ ~ + + . . . . . + . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ . . + 
 . ^ . ^ . + = . . . . . ~ ~ ~ ~ ~ ~ ~ . + + . + . . . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ . + + 
. . + + . + = . . . . . . ~ ~ ~ ~ ~ ~ ~ + + . + + + . . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ + 
 . + + + . = . . . . . + + ~ ~ ~ ~ ~ ~ ~ + . . ~ ~ ~ . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ . 
+ + + . . . . . . . ^ . + + ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ 
 + + . ^ . . . . . . . . . . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ 
~ . . . . . . . . . . . . . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ 
 ~ . . . ^ . . . . . . . . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ 
~ ~ ~ . . . . . ^ . . . . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ 
 ~ ~ ~ ~ . . . . . . . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ 
~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ 
 ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ 

```
The `=` column on the left is a 7-tile Great River draining a mountain range into the western sea. `+` tiles are bordered by edge rivers, which form
dendritic networks toward the coasts.

## Movement on rivers (`Movement.EnterCost`)
| Unit | Coast / Lake | Ocean | Channel (Great River) | Land | Crossing an edge river |
|---|---|---|---|---|---|
| Naval, `riverCapable` (Galley, Barge, River Monitor) | 1 | only if `oceanGoing` | **1** | own city only | — |
| Naval, not `riverCapable` (Caravel) | 1 | 1 | impassable | own city only | — |
| Land | impassable (embarkation in M1) | — | **ford: 3** (bridge: 1) | terrain/relief/feature max | +2 unless bridged |

The test `GreatRivers_AreNavigableFromTheSea` sails a galley from the sea tile at each river's mouth to its source tile using A* and asserts every path tile is water.

## Invariants under test
* Determinism (same seed gives identical arrays and starts; a different seed gives a different map).
* Every Great River: ≥ 5 tiles, consecutive tiles adjacent, all `Channel`, mouth adjacent to open water.
* Every edge river separates two **land** tiles, and both sides store the bit.
* Start positions: requested count, habitable land, not mountains, ≥ 4 apart.
* Hex/vertex topology: neighbour symmetry under wrap, vertex-graph symmetry, `EdgeTiles` returns two adjacent tiles, corners match tiles.

## Planned
Map scripts as data and mods (Continents, Pangaea, Archipelago, Highlands, **River Lands**); TSL Earth with hand-authored rivers; natural wonders
(waterfalls on Great Rivers); deltas (marsh fans at mouths); seasonal flood forecasting (the Egyptian Nilometer flavour).
