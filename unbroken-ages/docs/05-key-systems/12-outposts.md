# 5.12 Outposts

**Code:** [`OutpostSystem.cs`](../../src/UnbrokenAges.Sim/Systems/OutpostSystem.cs) · `FoundOutpostCommand`, `PromoteOutpostCommand` in
[`Commands.cs`](../../src/UnbrokenAges.Sim/Commands/Commands.cs) · tuning in `world.json` → `worldRules.outposts` · unit `UNIT_WAYMAKERS` ·
tests [`OutpostTests.cs`](../../tests/UnbrokenAges.Tests/OutpostTests.cs)

Taken from Shadow Empire's regions and held to the Ease Charter ([09 §3](../09-genre-defining-depth.md)): an outpost is a **claim, not a
second kind of city**. It has no screen, no queue, no citizens and nothing to manage.

## Rules
| | |
|---|---|
| **Founding** | **Waymakers** (40 Production, Foreign Trade civic, 3 moves) plant one where they stand: unclaimed land, not a mountain, at least **3** tiles from any city or outpost |
| **Land** | Claims the unclaimed tiles within radius **1** (`OwnerPlayer` = owner, `OwnerCity` = −1, so no city works them and city borders cannot take them) |
| **Supply** | Seeds a land supply budget of **6** ([09 §4.2](../09-genre-defining-depth.md)), so armies can operate beyond the cities |
| **Harvest** | +1 Gold per turn, plus the best resource in its claim (strategic, then luxury, then bonus; ties go to the lowest tile): a revealed strategic resource adds **+2** to the stockpile, a luxury **+3** Gold, a bonus **+2** Gold. It is named after what it harvests ("Iron Outpost") |
| **Raids** | An enemy **military** unit (at war) standing on it at the end of a turn burns it and the land is released. At peace a foreign unit is only a visitor |
| **Promotion** | Buy it up into a city for **150 + 25 × cities you own** Gold, if it is at least 4 tiles from every city (the normal founding rule). The new city keeps the outpost's land |
| **Elimination** | Outposts do not keep a civilization alive; an eliminated civilization's outposts are released |

All numbers are in `worldRules.outposts`.

## Why it is here
Wide empires in Civ-style games either spam marginal cities (more screens to manage) or leave gaps rivals settle into. An outpost claims the iron
hill or the river crossing **without** adding a city screen, and later becomes a city when the land is worth it.

## Presentation
The map shows a slim post in the owner's colour; the land shows ordinary borders. Planned: a tooltip line "Iron Outpost: +1 Gold, +2 Iron per turn ·
Promote: 175 Gold".

## Snapshot
v9 adds the outpost list (id, owner, tile, name, founded turn, harvest tile, claimed tiles).
