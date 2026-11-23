# 5.1 District Adjacency & Placement

**Code:** [`AdjacencyCalculator.cs`](../../src/UnbrokenAges.Sim/Systems/Districts/AdjacencyCalculator.cs) ·
[`DistrictPlacement.cs`](../../src/UnbrokenAges.Sim/Systems/Districts/DistrictPlacement.cs) ·
[`DistrictPlanner.cs`](../../src/UnbrokenAges.Sim/Systems/Districts/DistrictPlanner.cs) ·
client lens [`PlacementLens.cs`](../../godot/scripts/Map/PlacementLens.cs)

## Goals
1. Keep Civ VI's spatial puzzle: geography and neighbouring districts decide yields.
2. Make it **learnable**: every bonus is listed, "almost there" thresholds are shown, and the effect on neighbours is visible before you commit.
3. Make it **data-only**, so designers and modders add rules without code.
4. Use **one scorer** for the player's lens and the AI's planner.

## Rule model
A district definition carries `adjacency[]` rules and `providesAdjacency[]` grants (schema: [03-data-schemas §3](../03-data-schemas.md#3-districts--adjacency)).

```
for each rule in district.adjacency:
    matches = (rule.scope == Self) ? [tile] if Matches(rule.source, tile, tile, any-edge)
                                   : [n for n in neighbours(tile) if Matches(rule.source, tile, n, edge(tile,n))]
    amount  = rule.amount × floor(|matches| / rule.per)
    total[rule.yield] += amount
    record Contribution(label, yield, amount, increment=rule.amount, matches, per, sourceTiles)

for each neighbour n with district d:
    for each grant in d.providesAdjacency:
        if grant targets this district (by id — unique replacements count as the original — or by tag):
            total[grant.yield ?? this.primaryYield] += grant.amount        # e.g. Civic Plaza +1

total = total × (1 + city.AdjacencyPercent[yield]/100)                      # Archivist "Librarian", policies
```

**Matcher semantics.** All specified conditions must hold: terrain/class/relief, feature/featureTag, resource/class/any, district/tag/any/city
centre, improvement (unpillaged), `riverEdge` (along the *shared* edge; along *any* edge for Self scope), `freshWater`. Unique districts match the
district they replace, so Venice's Arsenal is a Foundry for every rule in the game, including rules mods add later.

**Floor, not fractions.** "+1 per 2 districts" is `per: 2`, so yields stay integers in the UI. The breakdown shows the remainder:
`MatchesToNextBonus = per − matches mod per`, rendered as *"1/2 districts — 1 more for +1"*.

## Placement legality
`DistrictPlacement.Check` returns **every** failure (enum), which the lens shows as a bullet list. Checks cover empire level (tech, civic, civ uniqueness,
replaced-by-unique, `maxPerCity` including queued items, `uniquePerCiv`, the capacity cap), tile level (range 3, ownership or auto-claim, occupancy,
reservations, submerged), and the rules in `placement` (water classes, reliefs, required feature, river edges, adjacent-to or not-adjacent-to city centre,
`requiresAdjacentAny`, canal topology).

**Capacity:** `1 + ⌊(pop−1)/3⌋ + (pop ≥ 20 ? 1 : 0) + CityDistrictCapacity modifiers`. Queued districts count, so you cannot over-plan.

**Canal topology:** a canal tile needs two "connectors" (water, city centre or canal) on **non-adjacent** sides (direction difference 2–4), so it
actually crosses land. This is checked in O(6²).

## Planner (shared by AI and lens)
```
score(tile) = w·adjacency(tile)                       # own yields
            + w·Σ_neighbours Δadjacency(neighbour)    # what this placement adds to or removes from existing districts
            − ½·w·tileYields(tile)                    # yields lost by building over the tile
            + ¼·(adjacent empty land in range)        # room for future clustering
```
`w` is a `YieldSet` of weights: balanced for the lens, personality-derived for the AI (`LeaderDef.personality`). Neighbour deltas use
`DistrictView.With(tile, district)`, an overlay of hypothetical placements with no mutation, so it is safe in multiplayer and cheap
(≤ 37 candidate tiles × 7 adjacency evaluations).

## UI hooks
* Lens tint: green shaded by `score / best`, red for illegal. The top 6 spots get floating yield labels.
* Hover tooltip: the contribution list, almost-there hints, "Neighbouring districts: +1 Science", "Replaces tile yields: 2 Food".
* **Map tacks** (M2) store `(tile, district)` plans per player and team. They feed the same `DistrictView` overrides, so planned districts
  show their future adjacency today.

## Tests
`Academy_CountsMountainsGeothermalAndDistricts`, `Market_GetsRiverBonus_OnlyWhenRiverRunsAlongIt`, `CivicPlaza_ProvidesAdjacency…`,
`UniqueDistrict_CountsAsTheDistrictItReplaces`, `Planner_RanksMountainSpotsFirst`, and seven placement tests (aqueduct sources, garrison,
capacity and reservations, harbor, canal, uniques).

## Tuning knobs and extensions
* Values live in `content/base/data/districts.json`. Policies like "double adjacency for Science" are `CityAdjacencyPercent` modifiers.
* **Planned:** wonder districts (`districtTag: "Wonder"` already used by the Cultural Quarter), the Great Planner's one-shot relocation,
  Vertical Districts at Megalopolis, adjacency from natural wonders, a "minor adjacency" option (all districts +0.5 per adjacent district) for
  players who prefer smoother numbers.
