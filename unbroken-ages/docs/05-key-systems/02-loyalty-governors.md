# 5.2 Loyalty & Governors

**Code:** [`LoyaltySystem.cs`](../../src/UnbrokenAges.Sim/Systems/LoyaltySystem.cs) ·
[`GovernorSystem.cs`](../../src/UnbrokenAges.Sim/Systems/GovernorSystem.cs) ·
[`CityEffects.cs`](../../src/UnbrokenAges.Sim/Systems/CityEffects.cs) · data [`governors.json`](../../content/base/data/governors.json)

## Loyalty

### Formula (exactly what the code computes)
```
pressure(src → dst) = pop(src) × (10 − dist)/10              for dist ≤ 9
                    × ageMult(owner(src))                     Normal 1.00 · Golden 1.15 · Heroic 1.25 · Dark 0.85
                    × (1 + pressurePercent(src)/100)          Castellan base +50%, Frontier Doctrine +50%, Envoy Embassy +25%
                    × 1.25 if src is a capital,  × 0.5 if src is a Free City

D = Σ pressure from same-owner cities (including the city itself)
F = Σ pressure from all other owners (reported per player for the tooltip)

pressureTerm = clamp( 10 × (D − F) / (min(D, F) + 1), −20, +20 )

Δloyalty = pressureTerm
         + 8   if an established governor is present
         + amenities   (Ecstatic +2, Happy +1, Content 0, Displeased −1, Unrest −3, Revolt −5)
         + 2   if garrisoned by an own military unit,  else −4 if occupied (owner ≠ original owner)
         + 8   if capital
         − 5   if starving
         + 2 × (5 − turnsSinceOwnerChange)   for the first 5 turns after a flip ("settling in")
         + Σ CityLoyaltyPerTurn modifiers (Monument +1, Civic Plaza +4, Taizu +2, Prelate…)

loyalty = clamp(loyalty + Δ, 0, 100);   turnsUntilFlip = ceil(loyalty / −Δ) when Δ < 0
```
Pressure is computed in tenths and divided once, so fixed-point results are exact (e.g. 12 pop at distance 3 from a capital = exactly 10.5).

### Why this shape
* **Normalization by min(D, F)**: two big empires pressing on each other produce a moderate swing, while a lone outpost next to a giant
  collapses. That keeps the "cultural annexation" fantasy without making every border city a coin flip.
* **Settling-in grace** prevents the ping-pong flipping players complained about.
* **Snapshot-based**: all pressures are computed from a population snapshot taken at the start of the loyalty phase, so results do not depend on city order.

### Consequences
| Loyalty | Yield modifier | Notes |
|---|---|---|
| 70–100 Loyal | 0% | |
| 40–69 Wavering | −15% | |
| 15–39 Disloyal | −35% | Warning notifications start at ≤ 5 turns to flip |
| 1–14 Unrest | −60% | |
| 0 | — | **Declares independence** → Free City (loyalty reset to 50). A Free City at 0 joins the civ with the highest pressure. Capitals never flip. |

Flipping goes through `CitySystem.ChangeOwner`: the queue and reservations are cleared, the governor returns to the pool, tiles are re-owned,
and an event is emitted for notifications and diplomacy (planned: *Cultural Annexation* grievance, reduced when the flip was a liberation).

### UI
The loyalty line shows `Loyalty 62/100 (−7/turn, flips in 9!)`, with a breakdown (`LoyaltyBreakdown.Lines()`) and a **pressure lens**
(arrows from each pressuring city, thickness ∝ pressure). See [06-ui-ux-wireframes §1](../06-ui-ux-wireframes.md#1-city-view).

## Governors

### Lifecycle
```
titles  ← civics (governorTitles), wonders, dedications
Appoint(def)          cost 1 title          → GovernorState{CityId=-1}
Promote(def, promo)   cost 1 title          requires prerequisite promotions (tree), no duplicates
Assign(def, city)     free                  previous city loses it; an incumbent in the target returns to the pool (swap, not refusal)
                                            establishment resets: Established=false, progress=0
each turn: progress++ while assigned; Established when progress ≥ EstablishTurns(def, promotions)   (base 5; Swift Hand −2; min 1)
effects: CityEffects includes baseModifiers + promotion modifiers ONLY when established
```

### The eight governors
See [GDD §5.2](../01-game-design-document.md#52-governors-8-originals) and `governors.json`. Each has one base effect and five promotions on two
branches (tier 1 → 2 → 3). All effects use the shared modifier vocabulary, for example:

| Promotion | Modifier |
|---|---|
| Steward · Urban Planner | `CityDistrictCapacity +1` (the tall-city lever) |
| Castellan · Levee Engineers | `CityDisasterImmunity RiverFlood`, `Storm` |
| Treasurer · River Tolls | `CityYieldFlat Gold +4`, `Production +2` with requirement `CityOnGreatRiver` |
| Archivist · Librarian | `CityAdjacencyPercent Science +50` |
| Engineer · Grid Master | `CityPowerOutput +2`, `PowerRangeBonus +3` |
| Engineer · Clean Industry | `CityEmissionsPercent −50` |
| Spymaster · base | `EspionageDefense +2` |

### Planned: provinces and councils (M3)
A governor can be posted to a **province** instead of a city. Their modifiers apply to every member city at 50% (rounded down), and establishment
takes 8 turns. This is the main late-game micromanagement relief for wide empires.

## Tests
`Breakdown_MatchesTheDocumentedFormula` (checks every term of the formula), `City_DeclaresIndependence_ThenJoinsTheDominantNeighbour`,
`EstablishedGovernor_AddsEight`, `Establishment_TakesConfiguredTurns_AndAppliesEffects`, `Promotions_RespectPrerequisites_AndCanChangeCapacity`,
`Moving_ResetsEstablishment_AndSwapsIncumbent`, `SwiftHand_ShortensEstablishment`.
