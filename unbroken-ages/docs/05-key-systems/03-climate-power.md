# 5.3 Climate & Power

**Code:** [`PowerSystem.cs`](../../src/UnbrokenAges.Sim/Systems/PowerSystem.cs) · [`ClimateSystem.cs`](../../src/UnbrokenAges.Sim/Systems/ClimateSystem.cs) ·
data [`buildings.json`](../../content/base/data/buildings.json), [`resources.json`](../../content/base/data/resources.json), [`environment.json`](../../content/base/data/environment.json)

## Power

### Supply, demand and grids
* **Demand:** each building has `powerDemand`; a city's demand is the sum. Powered cities get `poweredYields` (Research Lab +5 Science, Factory +3 Production…).
* **Supply:** buildings and improvements with a `power` spec: `{kind, output, fuel, fuelPerTurn, co2PerTurn, range}`.
* **Grids:** a plant serves every *own* city whose centre is within `range` of the plant's tile. Cities connected through any plant form one grid
  (union-find), and supply is pooled per grid.

### Dispatch (the community fix: clean power that actually displaces dirty power)
```
for each grid:
    order plants by policy
        CleanestFirst: Renewable < Nuclear < Gas < Oil < Coal, then city id
        CheapestFirst: renewables, then plants whose fuel stockpile is largest
    remaining = grid.demand
    for plant in order while remaining > 0:
        if plant needs fuel and stockpile[fuel] < fuelPerTurn: mark unfuelled; continue
        burn fuelPerTurn (whole units — a plant either runs this turn or doesn't)
        use = min(output, remaining);  remaining −= use
        co2 += plant.co2PerTurn × use/output × (1 + city.EmissionsPercent/100)
    allocate dispatched supply to cities: capital, then player priority, then population, then id
        powered = demand == 0 ? grid has capacity : supply ≥ demand (all-or-nothing per city)
```
Unneeded plants burn **no fuel and emit nothing**, so a Hydroelectric Dam or solar farm on the grid directly removes coal emissions (test
`CleanestFirstDispatch_KeepsCoalIdle…`). Brownouts emit `PowerShortage` events with the deficit, and the Power lens shows grids, plants, utilization and unpowered cities.

### Fuel
Improved strategic resources add +2 per turn to a capped stockpile (`stockpileCap`). Plants and fuel-burning units (`upkeep`) draw from it.

## Climate

### Carbon cycle → temperature → phases
```
emissions = Σ dispatched plant CO₂ + building process CO₂ (Factory 0.5) + unit fuel burned + deforestation (woods 2, rainforest 3, marsh 1)
sink      = Σ feature.co2Absorption over all tiles                  (woods 0.0004, rainforest 0.0006 ppm/tile/turn)
ppm       = max(basePpm, ppm + emissions × ppmPerEmission − sink)   (base 280, 0.06 ppm per unit)
Teq       = sensitivity × log2(ppm / basePpm)                       (3 °C per doubling; deterministic fixed-point log2)
T        += (Teq − T) × lagPercent/100                              (4%/turn: cuts take decades to show)
phase     = #thresholds ≤ T                                         ([0.5, 0.9, 1.3, 1.8, 2.4, 3.1, 4.0] → phases 1..7)
```
**Projects:** *Carbon Recapture* removes 8 ppm, and reforestation increases the sink. Per-player `EmissionsLastTurn` and `CumulativeEmissions` feed
**climate accountability** grievances (M4).

### Sea level
Coastal flat land is classified at map generation into **lowland bands 1–3** (lowest 35% of coastal flats by elevation).

| Phase | Band 1 | Band 2 | Band 3 |
|---|---|---|---|
| 2 | Flooded (yields ×½) | | |
| 3 | **Submerged** | Flooded | |
| 4 | | Submerged | Flooded |
| 5+ | | | Submerged |

*Submerged:* the tile becomes Coast; its district, improvement, feature, resource and rivers are removed. City centres never drown (they stay flooded).
A **Flood Barrier** in a city marks all its lowland tiles `FloodProtected` and drains flooded ones. Tiles already lost are lost; *Land Reclamation*
(M4) can rebuild them at great cost.

### Disasters
`chance‰ = base × intensity% × (100 + phase × climateScaling%) / 100`, with intensity Off/Gentle/Standard/Intense/Cataclysmic = 0/50/100/150/250%.
The epicenter is chosen from eligible tiles (river or Great River-adjacent for floods; coast-adjacent for storms; dry inland for droughts; volcanoes);
the area is a radius. Each tile in the area is pillaged with a chance, gains **fertility** (floods and eruptions: +1 food, max +3), and city centres may lose
population. City immunities (Dam, Castellan *Levee Engineers*) skip their tiles. All rolls use the dedicated `DisasterRng` stream.

## Tests
`CoalPlant_PowersCitiesInRange_AndBurnsFuel`, `WithoutFuel_CitiesBrownOut`, `CleanestFirstDispatch_KeepsCoalIdle_WhenRenewablesSuffice`,
`PoweredBuildings_AddTheirBonusYields`, `Emissions_RaiseCo2_AndTemperatureLagsBehind`, `Phases_RaiseSeas_AndFloodBarriersProtect`,
`Forests_AreACarbonSink`, `DisasterChance_ScalesWithIntensityAndPhase`.

## Tuning & extensions
Everything numeric is in data. Planned: transmission lines (rail-linked grids after *Electrification*), surplus-power bonuses, grid sabotage
(espionage), blizzards, dust storms, wildfires and tsunamis, the Cataclysm mode's comets, and climate accords with per-civ caps.
