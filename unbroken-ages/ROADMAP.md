# Autonomous Roadmap (continuation queue)

This file is the hand-off point for autonomous work sessions. Each session takes the **first unchecked item**, implements it in
the simulation with tests, updates the docs (GDD traceability, plan, README test count), runs the full verification below,
commits, pushes to the session branch, and checks the item off here with the commit's one-line summary.

**Verification before every commit:** `dotnet build UnbrokenAges.sln` · `dotnet test UnbrokenAges.sln` (all green) ·
content schema check (`content/schemas`) · `ua validate mods/example-river-trade` · `ua simulate --turns 200` (no crash; note ms/turn) ·
`dotnet build godot/UnbrokenAges.Client.csproj` · `GODOT=<godot 4.3 .NET binary> tools/client-smoke.sh` (plays the real client 45 turns; check the screenshots)
(then delete `godot/.godot`, `godot/bin`, `godot/obj`).

Rules: keep the Ease Charter (docs/09 §1); no Civ VII-style resets; original names only; deterministic sim (Fx, seeded RNG streams, id-ordered iteration).

## Queue

- [x] **1. Diplomacy core**: war / peace / alliance states, denounce, declare war (with "no surprise wars" option), peace after a minimum war length,
      open borders, itemized decaying grievances, attitude (agenda placeholder + Divergence ideology + grievances + war), Strife pushes from war and peace,
      closed borders for military units at peace, supply attrition only on enemy ground.
- [x] **2. Combat v1**: melee and ranged attacks, deterministic damage with a `combat` RNG stream, terrain and river modifiers, fortify, flanking and support,
      counters (`strongAgainst`/`weakAgainst`), the out-of-supply penalty, cities with HP and ranged strike, capture → `ChangeOwner`; a combat preview with a full
      breakdown; battle reports in events and the Chronicle.
- [x] **3. Border growth**: culture-driven tile claims (best adjacent tile up to radius 5) and gold tile purchase.
- [x] **4. Victory system**: Ascension, Hegemony (all original capitals), Score at the turn limit; victory toggles; game-over event; One More Turn.
- [x] **5. Living Governors**: experience and data-driven traits earned from where they serve.
- [x] **6. Outposts**: cheap claims (radius 1, supply source, one resource), with no city screen; promotable to a city.
- [x] **7. Unit variants**: choose 1 of 2–3 variants at upgrade; `UpgradeUnitCommand` with gold and resource costs.
- [x] **8. Dynamic turn mode**: phase ordering by war graph in `HostSession`, with tests over sockets.
- [x] **9. AI v2**: expansion (settlers), builders, war planning (declare war on weak neighbours, attack with odds > 60%, retreat when out of supply), peace.
- [x] **10. Client**: combat preview tooltip, diplomacy screen skeleton, victory screen, border and war colours.

- [x] **11. Society staples**: governments and policy cards, pantheons and religions (spread, missionaries, Spiritual victory), great people,
      era score and Golden/Dark/Heroic ages, unit promotions, barbarian camps, world and natural wonders, war weariness.
- [ ] **12. City-states**: envoys, suzerain bonuses, quests (Free Cities as the seed).
- [ ] **13. Trade routes**: traders, roads along routes, gold and yields between cities, plunder at war.
- [ ] **14. Espionage**: spies, offensive operations, counter-intelligence (the modifier hooks exist).
- [ ] **15. Culture victory**: great works, tourism, theming.
- [ ] **16. World Congress**: resolutions, diplomatic favour, a Diplomatic victory.
- [ ] **17. Corps and armies**; unique units for the 30 later nations; the orbital layer.

## Done
- 1. Diplomacy core: `DiplomacySystem`, 5 commands, snapshot v4, closed borders, war-only attrition, 9 tests (120 total).
- 2. Combat v1: `CombatSystem` (Fx.Pow2 damage curve, combat RNG stream), Attack/Fortify/CityStrike commands, city HP and capture, snapshot v5, 15 tests (135 total).
- 3. Border growth: `BorderSystem` (culture threshold 15 + 8n, best-tile score, radius 5), `PurchaseTileCommand` (radius 3), snapshot v6, 4 tests (139 total).
- 4. Victory system: `VictorySystem` (Ascension, Hegemony by capitals or world share, itemized Score at the turn limit), `VictoryKind` toggles,
  game-over gate + `OneMoreTurnCommand`, elimination, `worldRules.victory`, snapshot v7, CLI continues after victory, 8 tests (147 total).
- 5. Living Governors: experience + ranks (faster re-establishing), `governorTraits` category (turns-in-situation or events-in-city), 9 traits,
  `CityOnFrontier`/`OwnerAtWar` requirements, city panel line, Chronicle entries, snapshot v8, 8 tests (155 total).
- 6. Outposts: `OutpostSystem`, Waymakers unit, Found/PromoteOutpost commands, supply seeding, harvest (stockpile or gold), raids at war,
  release on elimination, `worldRules.outposts`, map marker, snapshot v9, 8 tests (163 total).
- 7. Unit variants: `unitVariant` data (Swordsman, Archer, River Monitor), `UnitStats` (variant-aware strength, range, moves, river fording),
  `UpgradeSystem` + `UpgradeUnitCommand` (unique-unit substitution, gold × variant %, resource cost), AI preset upgrades, snapshot v10, 7 tests (170 total).
- 8. Dynamic turn mode: `TurnPhases` (dynamic war-graph colouring, sequential, simultaneous) stored in the state at each turn start, host-side phase
  gate and phase-by-phase AI/turn driver in `HostSession`, HUD phase line, snapshot v11, 4 tests including a real-socket game (174 total).
- 9. AI v2: `ExpansionAi` (site score, settler walking), `BuilderAi` (resource-first jobs), `MilitaryAi` (war on weaker neighbours, odds > 60%,
  wounded fall back, march on cities, peace terms), production priorities; fixed a slot-order race in the dynamic-turn socket test; 8 tests (182 total).
- 10. Client: `CombatTooltip` (verdict, damage, every modifier; right-click attacks or moves), `DiplomacyPanel` (P; status, attitude lines,
  grievances, actions with validation tooltips), `VictoryPanel` (headline, itemized scores, One More Turn, defeat), red double borders for
  enemies at war; sim-side text (`CombatSystem.Describe/Verdict/OddsPercent`, `DiplomacySystem.StatusName`, `VictorySystem.Headline`); wireframes
  §4, §7c–7e; 7 tests (189 total).

**First playable (done):** units drawn on the map, selection ring, fog of war (`VisibilitySystem`, revealed tiles in the state), unit panel
(found city, outpost, improvements, fortify, upgrades with variants), research and civics picker, notification feed (`EventText`), end-turn bar
with to-dos, save/load (`SaveGame`), exclusive overlays with an opaque theme, city-first clicks, and `tools/client-smoke.sh` with the `--autostart/--do/--shots`
automation hook. 6 tests (195 total).

**Visual, audio and UI pass (done):** patch.gg asset pipeline (`tools/assets`, CC0/CC-BY only, generated credits), painted
terrain on a paper-map fog (data-texture shaders), Civ-style water, KayKit scenery and cities, animated unit squads, HDRI
lighting and grade, Civ V/VI HUD (top bar, trackers, banners, flags, minimap, turn button, pause menu), music, effects and
procedural ambience, living title backdrop. See docs/06 §9.

**Living world pass (done):** squads of four, resources modelled on their tiles, a resource lens (R), painted farm fields,
client-side road networks with era-appropriate traffic (wagons → cars and lorries), boats, grazing animals, bird flocks,
chimney smoke and tree sway (`Visuals/LifeLayer.cs`). Debug automation steps `era:N`, `reveal`, `focus-*` for screenshots.

**Technology-driven look (done):** buildings, roads, traffic, ships, farms and units follow researched techs only
(`Visuals/TechLook.cs`, `Visuals/CityLayout.cs`), through nine looks: Tribal, Classical, Medieval, Industrial, Modern, Atomic,
Information, and the three Divergence futures (Sovereign destructive, Symbiont harmonized, Discarnate syncretic), each with
its own architecture, roads, traffic, aircraft, plumes, townsfolk and units. Debug steps `tech:A+B`, `path:N`, `paths`, `spawn:A+B`.

**Nations (done):** six major nations with rule-changing signatures (NationSystem) and two leaders each whose augments
bend them; new unique units; nation picker and dossier in the lobby, a live signature badge, Venice's Buy buttons;
capitals' landmarks, Mongol yurts, national building materials and Inca terraces on the map; NationAi; bankruptcy, early-war
restraint and AI production fixes from 6-nation soak tests. Then thirty more nations and sixty more leaders (36 and 72 in
all), each with its own rule, nine new engine hooks, a scrollable picker and three more landmarks. See
docs/05-key-systems/14-nations.md.

**Queue complete.** Next candidates (not scheduled): naval and air AI, the deal table and World Congress, religion v0, great people,
policy cards and governments, the turn timer, and Grand-dial governor ageing.

(see git log for full detail)
- 11. Society staples: `SocietySystem`, `ReligionSystem`, `GreatPeopleSystem`, `AgeSystem`, `BarbarianSystem`, `SocietyAi`, `society.json`,
  14 wonders + 9 natural wonders with models, 6 commands, Society screen (G), snapshot v14, 28 tests (245 total).
