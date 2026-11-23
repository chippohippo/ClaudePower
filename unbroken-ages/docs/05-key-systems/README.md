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

Paths are relative to `src/UnbrokenAges.Sim/` unless noted; tests live in `tests/UnbrokenAges.Tests/`.
