# 03 — Core Data Schemas

All game content is data. The **authoritative definitions** are the C# records in
[`src/UnbrokenAges.Sim/Data/Definitions.cs`](../src/UnbrokenAges.Sim/Data/Definitions.cs). The editor-facing
**JSON Schemas** are [`content/schemas/content.schema.json`](../content/schemas/content.schema.json) and
[`mod.schema.json`](../content/schemas/mod.schema.json). The base game in [`content/base/data`](../content/base/data) validates against both.

## 1. File format & conventions

```jsonc
{
  "$schema": "../../schemas/content.schema.json",   // optional: editor autocomplete
  "districts": [ { "id": "DISTRICT_ACADEMY", ... } ], // any number of categories per file
  "buildings": [ ... ]
}
```

* **Ids** are `UPPER_SNAKE_CASE` with a category prefix (`DISTRICT_`, `UNIT_`…). Every cross-reference is an id, resolved to an int index at load.
* **Numbers** are decimals (`0.5`, `"0.06"`), stored as deterministic fixed-point `Fx`.
* **Yields** are `{ "food": 2, "production": 1, "gold": 0, "science": 0, "culture": 0, "faith": 0 }` (omit zeros).
* **Unknown fields are errors.** Strict deserialization catches typos such as `"costt"`.
* **Operations:** every entry may carry `"$op": "add" | "replace" | "patch" | "delete"` (default `add`); see [07-modding.md](07-modding.md).

**Categories (fixed load and hash order):** `eras, terrains, reliefs, features, resources, improvements, districts, buildings,
projects, units, techs, civics, governors, civilizations, leaders, disasters, climate, mapSizes, divergences, worldAges, worldRules, chronicle`.

Added in [09](09-genre-defining-depth.md): **worldAges** (`priority`, `minEra`, `conditions[{current, min, max}]`, `modifiers`, `disasterChancePercent`, `narration`);
**worldRules** (one entry: `currentDecayPercent`, `pushes[{event, current, amount}]`, `supply{cityRange, militaryDistrictBonus, portRange, ownCost, neutralCost,
foreignCost, roughExtra, channelCost, waterCost, attritionHp, healHp}`, `combat{…}` ([05/09](05-key-systems/09-combat.md)),
`victory{hegemonySharePercent, hegemonyMinLoyalty, scorePer*, tilesPerPoint, scoreForAscension}` ([05/11](05-key-systems/11-victory.md))); **chronicle** (`event`, `text` with `{year} {civ} {leader} {city} {detail} {value}`,
`minValue`, `oncePerPlayer`, `requiresPlayer`); **governorTraits** (`requirements`, `turns` or `event` + `count`, `governors[]`, `modifiers`);
requirement types `CityOnFrontier` (value = radius) and `OwnerAtWar`; unit `foundsOutpost`;
`worldRules.outposts{claimRadius, minDistance, supplyRange, goldPerTurn, bonusGold, luxuryGold, strategicPerTurn, promoteGold, promoteGoldPerCity}`; building `recipe {inputs, outputs, requiresPower}`; resource class `Good`.

Every definition has: `id` (required), `name`, `description`, `tags[]`.

---

## 2. Map content

### terrains
| Field | Type | Notes |
|---|---|---|
| `class` | `Land \| Coast \| Ocean \| Lake \| Channel` | `Channel` = navigable Great River tile |
| `yields` | Yields | |
| `moveCost` | int | |
| `freshWater` | bool | Lake and Channel provide fresh water to neighbours |
| `appeal` | int | Feeds Neighborhood housing, preserves, tourism |
| `fordCost` | int | Land units crossing a channel without a bridge |

### reliefs
`yields`, `moveCost`, `defense`, `impassable`, `appeal`. The base game has `RELIEF_FLAT`, `RELIEF_HILLS` and `RELIEF_MOUNTAIN`.

### features
| Field | Type | Notes |
|---|---|---|
| `yields`, `moveCost`, `defense`, `appeal` | | |
| `removable` | bool | Districts and improvements clear removable features |
| `impassable`, `freshWater` | bool | Oasis = fresh water; Ice = impassable |
| `co2Absorption` | decimal | ppm per tile per turn (woods are carbon sinks) |
| `co2OnRemoval` | decimal | One-time emission when cleared |
| `validTerrains` | id[] | Where the generator may place it |

### resources
`class` (`Bonus | Luxury | Strategic`), `yields`, `frequency` (placements per 1000 eligible tiles), `validTerrains`,
`validFeatures`, `validReliefs`, `revealTech`, `stockpileCap` (strategic stockpiles, which fuel power plants and units).

### improvements
```jsonc
{ "id": "IMPROVEMENT_SOLAR_FARM", "name": "Solar Farm", "prereqTech": "TECH_RENEWABLE_ENERGY",
  "validTerrains": ["TERRAIN_DESERT", "TERRAIN_PLAINS", "TERRAIN_TUNDRA"], "validReliefs": ["RELIEF_FLAT"],
  "power": { "kind": "Renewable", "output": 2, "range": 6 } }
```
Fields: `yields`, `validTerrains/Reliefs/Features/Resources`, `requiresResource`, `requiresFeatureOnTile`, `removesFeature`, `onWater`,
`prereqTech`, `power` (see PowerPlantSpec), `appeal`.

### mapSizes
`width`, `height` (even), `defaultPlayers`, `greatRivers`.

---

## 3. Districts & adjacency

```jsonc
{
  "id": "DISTRICT_MARKET", "name": "Market Quarter", "category": "Specialty", "primaryYield": "Gold", "cost": 54,
  "prereqTech": "TECH_CURRENCY", "tags": ["Specialty", "Gold"],
  "adjacency": [
    { "yield": "Gold", "amount": 2, "scope": "Self", "source": { "riverEdge": true }, "label": "+2 Gold: a river runs along this district" },
    { "yield": "Gold", "amount": 2, "source": { "districtTag": "Port" } },
    { "yield": "Gold", "amount": 1, "source": { "terrainClass": "Channel" } },
    { "yield": "Gold", "amount": 1, "per": 2, "source": { "anyDistrict": true } }
  ]
}
```

| Field | Type | Notes |
|---|---|---|
| `category` | `CityCenter \| Specialty \| Infrastructure \| Wonder` | |
| `primaryYield` | Yield? | Target of `providesAdjacency` without an explicit yield; UI colour |
| `cost` | decimal | Scaled by game speed and +25% per era the player has reached |
| `countsTowardLimit` | bool (true) | Specialty district cap: 1 + ⌊(pop−1)/3⌋ (+1 Metropolis, + modifiers) |
| `maxPerCity` | int (1) | Neighborhood 10, Canal 3 |
| `uniquePerCiv` | bool | Civic Plaza |
| `prereqTech` / `prereqCivic` | id | |
| `civilization` / `replaces` | id | Unique districts; a replacement **counts as** the original for adjacency, buildings and projects |
| `placement` | PlacementRules | below |
| `adjacency` | AdjacencyRule[] | below |
| `providesAdjacency` | ProvidedAdjacency[] | Adjacency granted **to neighbours** (`toTag`/`toDistrict`, `yield?`, `amount`) |
| `yields`, `housing`, `amenities`, `appeal` | | Flat district contributions |
| `modifiers` | Modifier[] | e.g. Dam: immunity to `RiverFlood` |

**AdjacencyRule:** `yield`, `amount` (default 1), `per` (grant `amount` per *N* matches, floor), `scope` (`Adjacent` | `Self`), `source` (SourceMatcher), `label`.

**SourceMatcher** — all specified conditions must hold for a neighbour tile (or the tile itself for `Self`):

| Condition | Matches |
|---|---|
| `terrain`, `terrainClass`, `relief` | Terrain id, class (`Channel` = Great River) or relief |
| `feature`, `featureTag` | Feature id or a feature carrying the tag (e.g. `Woods`) |
| `resource`, `resourceClass`, `hasResource` | Resource id, class, or any resource |
| `district`, `districtTag`, `anyDistrict`, `cityCenter` | District id (unique replacements match their original), tag, any district, or the city centre |
| `improvement` | Unpillaged improvement |
| `riverEdge` | A river runs along the shared edge (`Self` scope: along any edge) |
| `freshWater` | Lake, Great River or oasis tile |

**PlacementRules:** `onWater` + `allowedTerrainClasses`, `allowedReliefs` (default flat and hills), `requiresAdjacentCityCenter`,
`forbidAdjacentCityCenter`, `requiresAdjacentAny` (SourceMatcher[]), `minRiverEdges`, `requiresFeature`, `special` (`Canal`).
Tile rules always applied: within 3 tiles, owned by this city or unowned (auto-claimed), not occupied or reserved, not submerged,
no luxury or strategic resource, no non-removable feature. Every violated rule is returned, not just the first.

---

## 4. Buildings, power & projects

```jsonc
{ "id": "BUILDING_COAL_PLANT", "name": "Coal Power Plant", "district": "DISTRICT_FOUNDRY", "cost": 300, "maintenance": 3,
  "yields": { "production": 1 }, "prereqTech": "TECH_ELECTRICITY", "requiresBuildings": ["BUILDING_FACTORY"],
  "power": { "kind": "Coal", "output": 4, "fuel": "RESOURCE_COAL", "fuelPerTurn": 1, "co2PerTurn": 4, "range": 6 } }
```

| Field | Notes |
|---|---|
| `district` | Host district (unique replacements qualify) |
| `cost`, `maintenance` | Production; gold per turn |
| `yields`, `poweredYields` | `poweredYields` apply only while the city is powered |
| `powerDemand` | Power units consumed |
| `power` | **PowerPlantSpec**: `kind` (`Renewable, Nuclear, Gas, Oil, Coal`; also the dispatch merit order), `output`, `fuel`, `fuelPerTurn`, `co2PerTurn`, `range` |
| `co2PerTurn` | Process emissions (factories) |
| `housing`, `amenities`, `protectsFromFlood` | Flood Barrier |
| `requiresBuildings`, `prereqTech`, `prereqCivic`, `civilization`, `replaces`, `modifiers` | |

**projects:** `district`, `cost`, `repeatable`, `prereqTech`, `onComplete` (modifiers; e.g. `ClimateCo2Reduction`).

---

## 5. Units

```jsonc
{ "id": "UNIT_EXOFRAME", "name": "Siege Exoframe", "domain": "Land", "unitClass": "HeavyCavalry", "era": "ERA_INFORMATION",
  "cost": 1600, "maintenance": 12, "strength": 110, "moves": 3, "prereqTech": "TECH_ROBOTICS",
  "upkeep": { "resource": "RESOURCE_URANIUM", "amount": 1 }, "weakAgainst": ["ElectronicWarfare"], "tags": ["Exoframe", "Armor"] }
```

| Field | Notes |
|---|---|
| `domain` | `Land \| Naval \| Air \| Civilian` |
| `unitClass` | Promotion tree and combat class |
| `strength`, `rangedStrength`, `range`, `antiAirStrength`, `moves`, `sight` | |
| `charges` | Builders and religious units |
| `foundsCity`, `oceanGoing` | |
| `riverCapable` | Naval: may sail Great Rivers (Caravel: false). Land: may ford them |
| `resourceCost` | One-time strategic cost |
| `upkeep` | Per-turn fuel, which also counts toward emissions |
| `upgradesTo[]` | Branching upgrade lines |
| `strongAgainst[]` / `weakAgainst[]` | Tag-based counters used by combat and the AI |
| `civilization`, `replaces`, `era`, `prereqTech/Civic`, `maintenance` | |

---

## 6. Progression

**techs / civics:** `era`, `cost`, `prereqs[]`, `boost` (text), `boostPercent` (default 40), `quote` (flavour), `modifiers[]`
(empire-wide once completed), `divergence` (branch id) and `doctrine` (researching it commits to the branch). Civics also have `governorTitles`.
Prerequisite cycles are load errors. **eras:** `order`.

### divergences (the Future-era fork — see [08](08-divergence-tech-tree.md))
```jsonc
{ "id": "DIVERGENCE_DISCARNATE", "name": "Discarnate Path", "people": "the Discarnate", "creed": "The body was a first draft.",
  "promise": "...", "price": "...", "doctrineTech": "TECH_DISCARNATION_EDICT", "ascensionProject": "PROJECT_LAST_UPLOAD",
  "colors": { "primary": "#1B1D2A", "secondary": "#8C6CFF" }, "aiPersonality": "science",
  "modifiers": [ { "effect": "CitizenFoodUpkeepPercent", "amount": -100 }, { "effect": "CityFabricationPercent", "amount": 25 } ],
  "leanings": [ { "kind": "Building", "id": "BUILDING_RESEARCH_LAB", "weight": 4, "label": "Research Labs" },
                { "kind": "PowerKind", "id": "Nuclear", "weight": 5 }, { "kind": "CumulativeEmissions", "weight": 1 } ],
  "spread": { "kind": "Terrain", "id": "TERRAIN_SUBSTRATE", "sourceBuilding": "BUILDING_SUBSTRATE_CORE",
              "requiresTech": "TECH_SUBSTRATE_COMPUTING", "perCityPerTurn": 2, "radius": 3, "organicChancePermille": 25 },
  "attitudeTowardSame": 6, "attitudeTowardOthers": -8 }
```
Leaning kinds: `Building, District, DistrictTag, FeatureTagInBorders, PowerKind, Population, CumulativeEmissions`. Spread: `kind` (`Terrain | Feature`),
`id`, `sourceBuilding`, `requiresTech`, `perCityPerTurn`, `radius`, `organicChancePermille`, `crossesBorders`, `reclaimSubmerged`.
Related fields: improvements `transformsTerrain` / `addsFeature`; projects `divergence` / `requiresWorldTransformedPercent`.

---

## 7. Governors

```jsonc
{ "id": "GOVERNOR_STEWARD", "name": "The Steward", "title": "Steward of the Granaries", "establishTurns": 5,
  "baseModifiers": [ { "effect": "CityYieldPercent", "yield": "Food", "amount": 15 }, { "effect": "CityHousing", "amount": 2 } ],
  "promotions": [
    { "id": "STEWARD_PUBLIC_WORKS", "name": "Public Works", "tier": 1, "modifiers": [ { "effect": "BuilderCharges", "amount": 1 } ] },
    { "id": "STEWARD_URBAN_PLANNER", "name": "Urban Planner", "tier": 2, "requires": ["STEWARD_PUBLIC_WORKS"],
      "modifiers": [ { "effect": "CityDistrictCapacity", "amount": 1 } ] } ] }
```

---

## 8. Civilizations & leaders

```jsonc
{ "id": "CIV_EGYPT", "name": "Egypt", "adjective": "Egyptian", "startBias": ["TERRAIN_CHANNEL", "FEATURE_FLOODPLAINS"],
  "ability": { "name": "Gift of the Great River", "description": "...",
    "modifiers": [ { "effect": "CityProductionPercent", "category": "District", "amount": 15,
                     "requirements": [ { "type": "CityOnGreatRiver" } ] } ] },
  "cityNames": ["Waset", "Men-nefer", "..."], "colors": { "primary": "#E3C16F", "secondary": "#1F4E79" } }

{ "id": "LEADER_TAIZU_SONG", "name": "Emperor Taizu", "civilization": "CIV_SONG",
  "ability": { "name": "A Cup of Wine", "modifiers": [ { "effect": "CityLoyaltyPerTurn", "amount": 2 } ] },
  "agenda": { "name": "Civil Over Martial", "likes": ["HighScience", "Peaceful"], "dislikes": ["Warmonger"] },
  "personality": { "science": 1.3, "war": 0.7 } }
```

Unique units, districts and buildings point at their civilization (`"civilization": "CIV_VENICE"`) and the item they replace.

---

## 9. Environment

**disasters:** `kind` (`RiverFlood, Storm, Drought, Volcano`), `baseChancePermille`, `climateScalingPercent` (per phase),
`radius`, `pillageChancePercent`, `populationLossChancePercent`, `fertilityFood`.

**climate** (one entry): `basePpm` (280), `ppmPerEmission`, `sensitivity` (°C per CO₂ doubling), `lagPercent` (thermal inertia),
`phaseThresholds[]` (°C at which phases 1..7 begin).

---

## 10. Modifiers & requirements (the effect vocabulary)

A **Modifier** = `effect` + parameters + `requirements[]` (all must hold). Modifiers are attached to abilities, governors, promotions,
districts, buildings and projects, and later to policies, beliefs, great people and wonders. Each turn they are aggregated per city into
`CityEffects`, which records the **source** of every applied modifier for tooltips.

| Effect | Params | Effect |
|---|---|---|
| `CityYieldFlat` / `CityYieldPercent` | `yield`, `amount` | Flat or % yield |
| `CityAdjacencyPercent` | `yield`, `amount` | % bonus to district adjacency of that yield |
| `CityLoyaltyPerTurn` / `CityPressurePercent` | `amount` | Loyalty per turn; % pressure this city exerts |
| `CityAmenities` / `CityHousing` | `amount` | |
| `CityProductionPercent` | `category` (`Unit, Building, District, Project, Wonder, Any`), `amount` | |
| `CityDistrictCapacity` | `amount` | Extra specialty district slots |
| `CityPowerOutput` / `PowerRangeBonus` / `CityEmissionsPercent` | `amount` | |
| `CityDisasterImmunity` | `disaster` | |
| `CityPurchaseDiscountPercent`, `GovernorEstablishTurns`, `BuilderCharges` | `amount` | |
| `ClimateCo2Reduction` | `amount` | Project one-shot |
| `EspionageDefense`, `SpyCapacity` | `amount` | Read by the espionage system (M4) |
| `CitizenFoodUpkeepPercent` | `amount` | Change to the food citizens eat (−100 = they don't eat) |
| `CityFabricationPercent` | `amount` | % of Production diverted into growth while powered |
| `CitizenPowerDemandTenths` | `amount` | Power drawn per citizen, in tenths |
| `ClimateCooling`, `CompleteAscension` | `amount` | Project one-shots: lower global temperature; complete the Divergence |

| Requirement `type` | Params |
|---|---|
| `CityHasDistrict`, `CityHasBuilding`, `PlayerHasTech`, `PlayerHasCivic` | `id` |
| `CityMinPopulation` | `value` |
| `CityIsPowered`, `CityIsCoastal`, `CityOnGreatRiver`, `CityIsCapital` | — |

New effects are added in C# (one `case` in `CityEffects.Apply`). Scripted effects arrive with the Lua sandbox ([07-modding.md §6](07-modding.md#6-scripting-sandboxed-lua-m4)).

---

## 11. Runtime state (simulation schema)

| Object | Key fields (see `State/GameState.cs`) |
|---|---|
| `GameState` | `Turn`, `NextId`, `Players[]`, `Cities[]`, `Units[]`, `Climate`, RNG streams, `Options`, `Map` |
| `MapGrid` (SoA) | `Terrain, Relief, Feature, Resource, Improvement, District, Elevation, RiverEdges(bitmask per tile), Lowland, Flags, Fertility, OwnerPlayer, OwnerCity, Reservation` |
| `PlayerState` | divergence (+ commit turn, ascended), civ/leader, team, gold, faith, current tech and civic with progress, `Techs[]/Civics[]` bitsets, strategic `Stockpile[]`, age, governor titles, `Governors[]`, dispatch policy, emissions (last turn, cumulative), capital |
| `CityState` | owner and original owner, tile, population, food, **loyalty** (+ last delta), districts (each with buildings and pillaged flag), **production queue** (+ progress ledger, overflow), power status and priority, governor |
| `UnitState` | owner, def, tile, moves (Fx), hp, charges, destination |
| `ClimateState` | CO₂ ppm, temperature anomaly, phase, emissions, pending deforestation |

**Snapshot format** (`GameStateSerializer`): magic `UASV`, version, content hash, then the sections above in a fixed order,
little-endian. The snapshot is also the input to the FNV-1a state hash used for desync detection.

---

## 12. Planned schemas (M3–M5)

These follow the same conventions. They are shown here so systems can be built data-first.

```jsonc
"beliefs": [ { "id": "BELIEF_RIVER_PILGRIMAGE", "name": "River Pilgrimage", "class": "Follower",       // Founder|Follower|Worship|Enhancer|Reformation
  "modifiers": [ { "effect": "CityYieldFlat", "yield": "Faith", "amount": 2, "requirements": [ { "type": "CityOnGreatRiver" } ] } ] } ],

"policies": [ { "id": "POLICY_NATURAL_SCIENCES", "slot": "Economic", "era": "ERA_CLASSICAL", "prereqCivic": "CIVIC_RECORDED_HISTORY",
  "obsoleteCivic": "CIVIC_CIVIL_ENGINEERING", "modifiers": [ { "effect": "CityAdjacencyPercent", "yield": "Science", "amount": 100 } ] } ],

"governments": [ { "id": "GOVERNMENT_REPUBLIC", "slots": { "Military": 1, "Economic": 2, "Diplomatic": 1, "Wildcard": 1 },
  "inherentModifiers": [ ... ], "legacyModifiers": [ ... ] } ],

"greatPeople": [ { "id": "GP_GREAT_PLANNER_IMHOTEP", "class": "GREAT_PLANNER", "era": "ERA_ANCIENT",
  "action": { "type": "RelocateDistrict" }, "modifiers": [] } ],

"wonders": [ { "id": "WONDER_GRAND_CANAL", "district": "DISTRICT_WONDER", "cost": 920,
  "placement": { "requiresAdjacentAny": [ { "terrainClass": "Channel" } ] }, "modifiers": [ ... ] } ],

"naturalWonders": [ { "id": "NW_GREAT_FALLS", "tiles": 2, "placement": { "onGreatRiver": true }, "yields": { "science": 2 }, "appeal": 4 } ],

"minorNations": [ { "id": "MINOR_SIDON", "type": "Trade", "suzerainBonus": { "modifiers": [ ... ] } } ],

"resolutions": [ { "id": "RES_CLIMATE_ACCORD", "proposableBy": "CIVIC_ENVIRONMENTALISM",
  "options": [ { "id": "A", "effect": "EmissionsCapPercent", "amount": 80 }, { "id": "B", "effect": "Rejected" } ],
  "victoryPointsForProposer": 1 } ],

"spyOperations": [ { "id": "OP_SPREAD_RUMOUR", "era": "ERA_CLASSICAL", "targetDistrict": "DISTRICT_CITY_CENTER", "turns": 4,
  "baseSuccessPercent": 70, "effects": [ { "effect": "CityLoyaltyPerTurn", "amount": -6, "durationTurns": 10 } ] } ],

"events": [ { "id": "EVENT_RIVER_SILTING", "era": ["ERA_MEDIEVAL"], "trigger": { "type": "CityOnGreatRiver" },
  "choices": [ { "text": "Dredge", "cost": { "gold": 120 } }, { "text": "Let it be", "effects": [ ... ] } ] } ],

"gameModes": [ { "id": "MODE_CONTAGION", "name": "Contagion", "enables": ["diseases", "hospitals"], "data": ["modes/contagion/*.json"] } ]
```
