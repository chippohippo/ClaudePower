# 07 — Modding

## 1. Philosophy
1. **The base game is a mod.** `content/base` loads through exactly the same `ModLoader` as community content. Anything the base game does, a mod can
   do, and anything it defines, a mod can patch.
2. **Patch, don't overwrite.** Mods change individual fields and list entries (`$op: patch`, `$append`, `$removeWhere`) instead of replacing whole files.
   Two mods that touch different parts of the Academy both work.
3. **Fail loudly, early and precisely.** Unknown fields, dangling references, prerequisite cycles and duplicate ids are load errors that name the
   mod, file, entry and field. `ua validate` runs the same checks in CI and before workshop upload.
4. **Multiplayer-safe by design.** All gameplay data feeds one **content hash**. Peers with different gameplay mods are refused with a clear message,
   and UI-only mods (`"affectsGameplay": false`) never block a game.
5. **Data first, scripts second, code never required.** Most mods are JSON. Sandboxed Lua handles custom logic. UI mods are Godot scenes and scripts
   that can read state and send commands, but cannot mutate the simulation.
6. **Hot reload** in single player for balance tweaks; ids are stable across versions; deprecations warn for one release before removal.

## 2. Mod layout
```
mods/example-river-trade/
├── mod.json                     manifest (schema: content/schemas/mod.schema.json)
├── data/                        *.json content files (all loaded, ordinal order), or list them in "data"
│   └── river_trade.json
├── localization/
│   └── en.json                  LOC_* string tables
├── ui/                          (optional) Godot scenes/scripts, loaded as a .pck in packaged mods
├── scripts/                     (optional, M4) sandboxed Lua
└── art/                         (optional) models, icons, textures referenced by logical keys
```

### mod.json
```jsonc
{
  "id": "example-river-trade",              // lowercase-kebab, unique
  "name": "River Trade Expanded (example mod)",
  "version": "1.0.0",
  "dependsOn": [ { "id": "base", "minVersion": "0.1.0" } ],   // hard dependencies (load before, must exist)
  "loadAfter": [ "some-optional-mod" ],     // soft ordering, ignored if absent
  "affectsGameplay": true,                  // false for pure UI/cosmetic mods
  "data": [],                               // empty = every data/*.json
  "localization": ["localization/en.json"]
}
```
**Load order:** topological sort on `dependsOn` plus `loadAfter`, ties broken by mod id, so every machine produces the same order. Cycles and missing dependencies are errors.

## 3. Operations
Every entry in a category array is an operation:

| `$op` | Meaning | Errors if |
|---|---|---|
| *(omitted)* / `add` | New definition | id already exists ("use replace or patch") |
| `replace` | Swap the whole definition, keeping its position (index) | id missing |
| `patch` | Deep-merge fields into the existing definition | id missing |
| `delete` | Remove the definition | id missing |

**Patch semantics:** objects merge recursively; scalars and plain arrays replace; `null` removes a field. Array operators:

| Operator | Example |
|---|---|
| `{"$append": [...]}` | add adjacency rules or promotions at the end |
| `{"$prepend": [...]}` | add at the front |
| `{"$removeWhere": {"field": value}}` | remove object elements whose fields deep-equal the values, e.g. `{"source": {"feature": "FEATURE_GEOTHERMAL"}}` |
| `{"$remove": [scalar, ...]}` | remove scalar elements, e.g. a tag |

## 4. Walkthrough: the example mod
[`mods/example-river-trade/data/river_trade.json`](../mods/example-river-trade/data/river_trade.json) does four things:

```jsonc
// 1) ADD a building (requires the base River Docks; +2 Gold more on Great Rivers via a requirement)
"buildings": [ { "id": "BUILDING_TOLL_HOUSE", "district": "DISTRICT_RIVER_PORT", "cost": 150, "yields": { "gold": 3 },
                 "requiresBuildings": ["BUILDING_RIVER_DOCKS"],
                 "modifiers": [ { "effect": "CityYieldFlat", "yield": "Gold", "amount": 2,
                                  "requirements": [ { "type": "CityOnGreatRiver" } ] } ] } ],
// 2) PATCH a district: append one adjacency rule; every other Sanctuary rule is untouched
"districts": [ { "$op": "patch", "id": "DISTRICT_SANCTUARY",
                 "adjacency": { "$append": [ { "yield": "Faith", "amount": 1, "source": { "district": "DISTRICT_RIVER_PORT" } } ] } } ],
// 3) PATCH a scalar
"units": [ { "$op": "patch", "id": "UNIT_RIVER_BARGE", "moves": 5 } ],
// 4) PATCH a nested list inside a governor: a new tier-3 promotion
"governors": [ { "$op": "patch", "id": "GOVERNOR_TREASURER", "promotions": { "$append": [ { "id": "TREASURER_RIVER_GUILD", ... } ] } } ]
```

Validate it:
```bash
$ dotnet run --project tools/UnbrokenAges.Tools -- validate mods/example-river-trade
OK — base@0.1.0, example-river-trade@1.0.0
content hash DC197DC74B050B5D
19 districts, 38 buildings, 28 units, 42 techs, 15 civics, 8 governors, 3 civilizations
```
The test `ModLoaderTests.ExampleMod_LoadsOnTopOfBase` keeps it working.

A mistake looks like this:
```
Mod loading failed:
  [testmod] Building 'BUILDING_X': 'district' references unknown districts id 'DISTRICT_NOPE'.
  [testmod] units 'UNIT_X': The JSON property 'costt' could not be mapped to any .NET member contained in type 'UnitDef'.
```

## 5. What can be modded today (data only)
Terrains, reliefs, features, resources, improvements (including power plants), **districts and every adjacency and placement rule**, buildings, projects,
units (counters, upgrades, river capability), techs, civics, eras, governors and promotions, civilizations, leaders (abilities, agendas, AI personality),
disasters, the climate model, map sizes, and **entire Divergence futures** (creed, leanings, terraforming spread, Ascension; see [08](08-divergence-tech-tree.md)). Behaviour comes from the **modifier vocabulary** ([03-data-schemas §10](03-data-schemas.md#10-modifiers--requirements-the-effect-vocabulary)).
Adding a *new kind* of effect currently needs a C# change (one `case`). Scripting removes that limit.

## 6. Scripting: sandboxed Lua (M4)
* **Runtime:** MoonSharp (pure C#, deterministic configuration): no `os`, `io` or `debug`; an instruction budget per call; fixed-point numbers exposed as `fx(...)`
  userdata so scripts can't introduce float nondeterminism into gameplay.
* **Hooks** are declared in data, so the engine knows which scripts affect gameplay (and the content hash includes script bytes):
  ```jsonc
  "modifiers": [ { "effect": "Script", "script": "scripts/tolls.lua", "function": "tollYield", "requirements": [...] } ]
  ```
* **API:** read-only views (`city.population`, `map:tile(i).terrain`, …) plus **command emitters** for event scripts (`game:enqueue(...)`).
  Scripts never write state directly, so they work in multiplayer and replays.
* **Events:** `onTurnStart`, `onCityFounded`, `onDistrictCompleted`, `onDisaster`, scenario triggers. Narrative events are pure data with optional script conditions.

## 7. UI mods
Godot scenes and C#/GDScript loaded from the mod's `ui/` folder (as a `.pck` when packaged). They get the **read-only state view** and the **command API**
that `GameRoot.Submit` uses, plus extension points: panel slots in the city view, new lenses, report-screen tabs, tooltip sections. Marked
`affectsGameplay: false`, they can differ between multiplayer peers.

## 8. Art & audio
Assets are referenced by logical keys in data (`"art": "district.river_port"`). Mods ship models and textures in their `art/` folder or `.pck`, override keys
by layering, and fall back to base placeholders when a key is missing, so a data-only mod never shows pink boxes.

## 9. Distribution
* **Workshop** (Steam) and a **plain-folder** path (`<user data>/mods/<id>`, e.g. GOG and itch). Enabled mods are listed in `enabled_mods.txt` (see `ContentLocator`).
* Multiplayer lobbies list required mods with versions and offer one-click subscribe.
* **Versioning:** semantic versions; `minVersion` dependencies; the game's own `base` version bumps on content changes.

## 10. Best practices for modders
* Prefer `patch` plus array operators to `replace`. Never copy base files.
* Prefix new ids with your mod tag (`BUILDING_RT_TOLL_HOUSE`) for large mods.
* Keep balance numbers in data, not scripts, so others can patch them.
* Run `ua validate` and keep a `$schema` line in every file for editor checks.
* Mark cosmetic mods `affectsGameplay: false`.
