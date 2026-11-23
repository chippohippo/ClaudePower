# 5.8 Diplomacy Core: War, Peace, Borders, Grievances, Attitude

**Code:** [`DiplomacySystem.cs`](../../src/UnbrokenAges.Sim/Systems/DiplomacySystem.cs) · [`DiplomacyCommands.cs`](../../src/UnbrokenAges.Sim/Commands/DiplomacyCommands.cs) ·
state [`Diplomacy.cs`](../../src/UnbrokenAges.Sim/State/Diplomacy.cs) · tests [`DiplomacyTests.cs`](../../tests/UnbrokenAges.Tests/DiplomacyTests.cs)

## Rules
| Action | Rule | Consequence |
|---|---|---|
| **Denounce** | Anyone except a teammate | Target holds a 5-point grievance; it counts as formal notice of war for 5–30 turns |
| **Declare war** | Not at war, not allied, not a teammate, no peace treaty from the last 10 turns. Option **No surprise wars**: requires a denunciation ≥ 5 turns earlier | **Formal** (denounced 5–30 turns before): 15 grievance to the target, 4 to every witness. **Surprise**: 40 and 10. +10 world Strife. Open borders cancelled |
| **Propose / accept peace** | After ≥ 10 turns of war; the other side must accept | Peace treaty (no new war for 10 turns); **armies inside the other's land walk home**; −8 Strife |
| **Open borders** | One-way grant, revocable, not during war | Grantee's military may cross the grantor's land; revoking evicts them |
| **Teams / alliances** | Teammates can never fight; Free Cities are hostile to everyone | |

**Closed borders:** military units cannot enter foreign land without war, an alliance or open borders (`Movement.EnterCost`).
**Supply:** attrition now applies only on the ground of civs you are **at war** with, so peacetime passage under open borders is safe.

## Grievances (fair, visible, fading)
Each grievance is an entry: holder, against, amount, turn and **reason** ("Surprise war", "Took Abydos through cultural pressure", "The Bloom spreads
into our land", "Warmongering against Venice"). Every entry loses 1 point per turn. Sources so far: war declarations (target and witnesses), denunciation,
**cultural annexation** (loyalty flips, 10), **Bloom encroachment** (2 per tile, against the responsible Symbiont civ).

## Attitude = a visible sum of named lines
```
At war                              −20     Allies +20 · Teammates +30
Denounced us (within 30 turns)       −8
Grievances                          −Σ/5
Ideology (Divergence)            +6 / −8    same future / rival future (doc 08)
Agenda likes (each)                  +6     e.g. Taizu "Civil Over Martial": HighScience, Peaceful
Agenda dislikes (each)               −8     e.g. Warmonger (declared a war in the last 50 turns)
```
Agenda tags the engine evaluates today: `HighScience`, `Peaceful`, `Warmonger`, `HighLoyalty`, `CitiesInRevolt`. Unknown tags (e.g. `TradePartner`, which waits
for the trade system) count as neutral, so data can name them early.

## AI (baseline)
It accepts every peace offer and offers peace as soon as the minimum war length passes. War planning arrives in roadmap item 9.

## Next
Deals (gold, resources, tiles, cities, research agreements), vassals and liberation, World Congress (GDD §8.3–8.4), dynamic turn mode driven by the war graph (roadmap item 8).
