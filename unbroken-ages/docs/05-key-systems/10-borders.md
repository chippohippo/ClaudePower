# 5.10 Border Growth and Tile Purchase

**Code:** [`BorderSystem.cs`](../../src/UnbrokenAges.Sim/Systems/BorderSystem.cs) · `PurchaseTileCommand` in
[`CombatCommands.cs`](../../src/UnbrokenAges.Sim/Commands/CombatCommands.cs) · tests [`BorderTests.cs`](../../tests/UnbrokenAges.Tests/BorderTests.cs)

## Rules
A new city owns radius 1. After that its borders grow in two ways, and both always show the player what comes next.

**Culture.** Each turn the city banks its Culture yield in `BorderProgress`. When the bank reaches the threshold, it claims one tile:
```
threshold = 15 + 8 × tilesClaimed
```
Leftover culture carries over. If no tile is claimable, the city keeps banking and claims the moment one frees up (e.g. after a rival city is razed).

**Which tile.** The candidate must be unclaimed, touch the city's own territory, and lie within **5** tiles of the city. The best score wins, and ties
go to the lowest tile index, so every peer picks the same tile:
```
score = 3·Food + 2·Production + Gold + 2·(Science + Culture + Faith) − 2·distance
        + 8 luxury/strategic resource (+4 bonus resource) + 1 fresh water
```
The same function (`BorderSystem.BestCandidate`) feeds the city panel line "Next tile in N turns: Wine (Plains)", so growth is never a mystery.

**Gold.** `PurchaseTileCommand` buys any claimable tile within **3** tiles:
```
cost = 20 × distance + 5 × tilesClaimed
```
Purchases count toward `tilesClaimed`, so buying raises the next culture threshold slightly, as players expect.

## Guarantees (tested)
* Borders never take another player's tile and never pass radius 5.
* The threshold, the chosen tile and the purchase cost are all integers or Fx, so they are deterministic.
* `BorderProgress` and `TilesClaimed` are in snapshot v6.
* Every claim emits `TileClaimed` (owner, city, tile) for the client's border animation. It is not chronicled, to avoid spam.

## Tuning and extensions
* Base 15 / step 8 / radii 5 and 3 are constants for now. They move to `worldRules.borders` when a mod needs them.
* Planned: governor and policy discounts on purchase, culture-bomb effects (claiming a ring on a district's completion), and border swaps in the
  diplomacy deal screen (§8.3).
