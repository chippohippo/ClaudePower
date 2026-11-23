# 05 — Key Systems

Each document covers rules, formulas, pseudocode, the **real implementation** (file links), its tests, tuning knobs and planned extensions.

| # | System | Code | Tests |
|---|---|---|---|
| 1 | [District adjacency & placement](01-district-adjacency.md) | `Systems/Districts/*` | `DistrictTests.cs` |
| 2 | [Loyalty & governors](02-loyalty-governors.md) | `Systems/LoyaltySystem.cs`, `Systems/GovernorSystem.cs` | `LoyaltyGovernorTests.cs` |
| 3 | [Climate & power](03-climate-power.md) | `Systems/PowerSystem.cs`, `Systems/ClimateSystem.cs` | `PowerClimateTests.cs` |
| 4 | [Direct IP multiplayer networking](04-multiplayer-networking.md) | `src/UnbrokenAges.Net/*` | `NetworkTests.cs`, `SimulationTests.cs` |
| 5 | [Production queue + UI](05-production-queue.md) | `Systems/ProductionSystem.cs`, `godot/scripts/UI/CityPanel.cs` | `ProductionTests.cs` |
| 6 | [Map generation with navigable rivers](06-map-generation-rivers.md) | `Map/MapGenerator.cs`, `Map/MapGrid.cs` | `SimulationTests.cs` (`MapGenerationTests`), `CoreTests.cs` |
| 7 | [The Divergence — Future-era tech fork](../08-divergence-tech-tree.md) | `Systems/DivergenceSystem.cs` | `DivergenceTests.cs` |
| 9 | [Diplomacy core: war, peace, borders, grievances, attitude](08-diplomacy.md) | `Systems/DiplomacySystem.cs` | `DiplomacyTests.cs` |
| 10 | [Combat v1: melee, ranged, cities, capture, preview](09-combat.md) | `Systems/CombatSystem.cs` | `CombatTests.cs` |
| 11 | [Border growth and tile purchase](10-borders.md) | `Systems/BorderSystem.cs` | `BorderTests.cs` |
| 12 | [Victory, elimination and One More Turn](11-victory.md) | `Systems/VictorySystem.cs` | `VictoryTests.cs` |
| 13 | [Outposts](12-outposts.md) | `Systems/OutpostSystem.cs` | `OutpostTests.cs` |
| 8 | [World Ages, Supply, Industries, Chronicle](../09-genre-defining-depth.md#4-what-we-built-in-this-iteration) | `Systems/WorldSystem.cs`, `SupplySystem.cs`, `IndustrySystem.cs`, `ChronicleSystem.cs` | `DepthTests.cs` |

Paths are relative to `src/UnbrokenAges.Sim/` unless noted; tests live in `tests/UnbrokenAges.Tests/`.
