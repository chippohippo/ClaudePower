# Autonomous Roadmap (continuation queue)

This file is the hand-off point for autonomous work sessions. Each session takes the **first unchecked item**, implements it in
the simulation with tests, updates the docs (GDD traceability, plan, README test count), runs the full verification below,
commits, pushes to the session branch, and checks the item off here with the commit's one-line summary.

**Verification before every commit:** `dotnet build UnbrokenAges.sln` · `dotnet test UnbrokenAges.sln` (all green) ·
content schema check (`content/schemas`) · `ua validate mods/example-river-trade` · `ua simulate --turns 200` (no crash; note ms/turn) ·
`dotnet build godot/UnbrokenAges.Client.csproj` (then delete `godot/.godot`, `godot/bin`, `godot/obj`).

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
- [ ] **9. AI v2**: expansion (settlers), builders, war planning (declare war on weak neighbours, attack with odds > 60%, retreat when out of supply), peace.
- [ ] **10. Client**: combat preview tooltip, diplomacy screen skeleton, victory screen, border and war colours.

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

(see git log for full detail)
