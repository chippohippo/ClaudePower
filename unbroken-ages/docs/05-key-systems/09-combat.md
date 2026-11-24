# 5.9 Combat v1

**Code:** [`CombatSystem.cs`](../../src/UnbrokenAges.Sim/Systems/CombatSystem.cs) · [`CombatCommands.cs`](../../src/UnbrokenAges.Sim/Commands/CombatCommands.cs) ·
tuning in `world.json` → `worldRules.combat` · tests [`CombatTests.cs`](../../tests/UnbrokenAges.Tests/CombatTests.cs)

## Damage
```
damage = baseDamage(30) × 2^((attacker − defender) / 17) × random(80–120%)      (deterministic Fx.Pow2, dedicated `combat` RNG stream)
```
An even fight deals 24–36. Every 17 points of advantage doubles damage and halves what you take.
**Melee:** both sides are damaged (the defender's counter uses −Δ); if the defender dies and the tile is clear, the attacker advances.
**Ranged:** only the target is damaged, within `range`. Attacking ends the unit's turn; one attack per turn.

## Strength lines (all shown in the preview)
| Line | Value |
|---|---|
| Strength / Ranged strength | from unit data |
| Wounds | −1 per 10 HP lost |
| Terrain (defender) | relief + feature defence (hills +3, woods +3) |
| Fortified (defender) | +4; lost when the unit moves |
| Attacking across a river (melee) | −5 unless bridged |
| Flanking (attacker) / Support (defender) | +2 per other friendly military unit next to the defender |
| Strong / weak against | ±10 from `strongAgainst` / `weakAgainst` vs the opponent's tags and class (Drone > Armor, EW > Drone/Exoframe, Augmented > Machine > Living > Augmented) |
| Out of supply | −5 (Grand Strategy dial only: `GameOptions.SupplyCombatPenalty`) |
| Siege weapons (attacker with the `Siege` tag) | +12 against a city's walls, −8 against troops in the field (`siegeVsCityBonus`, `siegeVsUnitsPenalty`) |
| Anti-air (defender) | a defender whose `antiAirStrength` beats its strength meets aircraft with it |

## Cities
City strength = 15 + 7 × owner's era + walls 10 + garrison strength / 5 − damage / 20. HP = 100 (+100 with walls); heals 20 per turn.
Units cannot walk into foreign cities: they are **besieged** (ranged and melee damage) and **captured by melee at 0 HP**. Capture: defending units are destroyed,
the city changes hands (queue cleared, governor recalled), HP is reset to a quarter, loyalty 50, −1 population, and the victim gains a 20-point grievance
("Captured Abydos"). Walled cities **bombard** one enemy military unit within 2 tiles per turn.

## The line through the ages
The generic roster has a unit for every era, so armies and walls rise together (7 strength per era for cities; the line gains 7–13 per era).

| Line | Ancient | Classical | Medieval | Renaissance | Industrial | Modern | Atomic |
|---|---|---|---|---|---|---|---|
| Melee | Warrior 20 | Swordsman 35 | | Musketman 55 | Line Infantry 65 | Infantry 75 | Mechanized Infantry 88 |
| Anti-cavalry | Spearman 25 | | Pikeman 41 | | | | Anti-Tank Crew 72 (strong against Armor) |
| Ranged | Slinger, Archer 25 | | Crossbowman 40 | | | | |
| Mounted | | Horseman 36 | Knight 48 | | Cavalry 62 | Tank 80 | Modern Armor 98 |
| Siege | | Catapult 34 | | Field Cannon 55 | Artillery 75 (range 3) | | Bomber 90 (air, range 4) |
| Naval | Galley | Caravel | | | River Monitor, Battleship (range 3) | Destroyer | Submarine |
| Air | | | | | | Fighter (hunts aircraft) | Bomber |

Mounted units are weak against anti-cavalry (`weakAgainst: AntiCavalry`). Aircraft fly over any tile, water and mountains included.
Upgrades follow the chains (Warrior → Swordsman → Musketman → Line Infantry → Infantry → Mechanized Infantry; Spearman → Pikeman → Anti-Tank
Crew; Catapult → Field Cannon → Artillery; Horseman → Cavalry; Knight → Tank → Modern Armor; Galley → River Monitor → Battleship; Caravel →
Destroyer). A unique unit with no upgrade path of its own follows the unit it replaces (a Samurai becomes a Musketman). At war the AI brings one
siege engine for every four soldiers.

## Civilians
A melee unit moving onto an enemy civilian captures it (settlers and builders change owner). Ranged units cannot capture.

## Preview (the UI's tooltip)
`CombatSystem.Preview` returns legality with a reason ("You are not at war with them.", "Out of range."), both strength breakdowns, damage ranges both ways,
`CertainKill` and `PossibleDeath`. The `AttackCommand` uses the same function for validation, so the preview can never disagree with the result.

## Consequences elsewhere
Battles emit `BattleFought` (a one-line battle report); deaths emit `UnitDestroyed` (+1 Strife; "first army lost" in the Chronicle); captures emit
`CityCaptured` (+8 Strife; "Egypt captures Abydos." in the Chronicle). Captured original capitals are tracked (`WasOriginalCapital`) for the Hegemony victory.

## Next (Combat v2, M3)
Naval blockades, air missions and air superiority (aircraft are currently mobile ranged units), support units, Fog of Strength, battle replay.
(Corps and armies, promotions, siege engines and aircraft have shipped.)

## Unit variants and upgrades
**Code:** [`UpgradeSystem.cs`](../../src/UnbrokenAges.Sim/Systems/UpgradeSystem.cs), [`UnitStats.cs`](../../src/UnbrokenAges.Sim/Systems/UnitStats.cs) ·
`UpgradeUnitCommand` · tests [`UnitVariantTests.cs`](../../tests/UnbrokenAges.Tests/UnitVariantTests.cs)

Taken from Shadow Empire's model designer and kept to one click ([09 §3](../09-genre-defining-depth.md)): when a unit upgrades, the player picks
**one of 2–3 variants**, each an honest trade-off. Units built in a city take the first (standard) variant, and the AI uses that preset.

| Unit | Variants |
|---|---|
| Swordsman | **Line** (standard) · **Heavy**: +15% strength, −1 move, +20% upgrade cost · **Fordsmen**: no river-crossing penalty, −10% strength |
| Archer | **Bowmen** (standard) · **Longbow**: +1 range, −15% ranged strength, +25% upgrade cost · **Skirmishers**: +1 move, −10% ranged strength |
| River Monitor | **Gun Monitor** (standard) · **Ram**: +20% strength, no bombardment (fights in melee) |

A civilization's unique unit inherits the variants of the unit it replaces (Song's Fire Lance Corps offers Line, Heavy and Fordsmen).
Variant fields (`unitVariant` schema): `strengthPercent`, `rangedStrengthPercent` (−100 removes the ranged attack), `movesDelta`, `rangeDelta`,
`ignoresRiverCrossing`, `upgradeCostPercent`. `UnitStats` applies them everywhere a unit fights or moves. The combat preview shows a
"Heavy variant +5" line, and "Across a river (fords it) 0" for Fordsmen, so the trade-off is visible at the moment it matters.

**Upgrading** (`UpgradeUnitCommand {unit, target, variant}`):
* Targets are the unit's `upgradesTo`. A civilization with a unique replacement gets that instead (Song: Warrior → Fire Lance Corps).
* Needs the target's tech or civic, its strategic resource (Swordsman: 10 Iron), and gold = max(20, 2 × (target cost − current cost)) × the
  variant's percent (`worldRules.combat.upgradeGoldPerProduction`, `minUpgradeGold`).
* The unit must be in its own territory and have moves left. It keeps its health, and the upgrade ends its turn.
* Every refusal says what is missing ("Needs 10 Iron.", "Choose a variant: Line, Heavy, Fordsmen.").

