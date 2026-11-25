# 5.11 Victory, Elimination and One More Turn

**Code:** [`VictorySystem.cs`](../../src/UnbrokenAges.Sim/Systems/VictorySystem.cs) · `OneMoreTurnCommand` in
[`Commands.cs`](../../src/UnbrokenAges.Sim/Commands/Commands.cs) · tuning in `world.json` → `worldRules.victory` ·
tests [`VictoryTests.cs`](../../tests/UnbrokenAges.Tests/VictoryTests.cs)

## Victories built so far
| Victory | Condition | Checked |
|---|---|---|
| **Ascension** (the affinity victories) | First civilization to complete its primary affinity's final project: **Emancipation** (Purity), **Transcendence** (Harmony), **the Digital Singularity** (Supremacy). Each needs the first stage (the branch's old Ascension project, after 10% of the land is remade), the Singularity-era capstone and affinity level 10 ([08](../08-divergence-tech-tree.md#the-affinity-victories)). The headline names it ("Egypt wins the Transcendence victory (Harmony) on turn 452.") | after every command and at turn end |
| **Hegemony** | One **team** holds every original capital (at least two exist, and every living civilization has founded one), **or** holds ≥ 60% of the world's population, counting only its cities above 50 loyalty, **and** ≥ 60% of all land | after every command (a capture ends the game at once) and at turn end |
| **Score** | Highest score when the turn limit (`GameOptions.TurnLimit`, default 500, 0 = none) ends. Ties go to more technologies, then to the lower player id | at turn end |

Exodus, Cultural Hegemony, Spiritual and Concord are designed (GDD §14) and already have toggle bits in `VictoryKind`, so setup
screens and saves will not change when they arrive.

**Toggles.** `GameOptions.Victories` is a flag set. It is part of the game setup and the snapshot, so every peer agrees on it.

## Score (visible all game)
| Line | Points |
|---|---|
| Citizens | 1 each |
| Cities | 5 each |
| Districts (not the city centre) | 2 each |
| Buildings | 1 each |
| Wonders | 15 each |
| Technologies / Civics | 2 each |
| Territory | 1 per 5 tiles |
| Ascension | 100 |

`VictorySystem.ScoreLines` returns these as labelled lines, so the score screen and the victory dashboard show the same breakdown.
All weights are in `worldRules.victory`.

## Game over and One More Turn
When a victory is declared, `GameState.Victory` records the winner, team, kind and turn, and a `VictoryAchieved` event and Chronicle line are emitted.
The command pipeline then accepts **only** `OneMoreTurnCommand`, so the victory screen is never skipped by a stray end-turn. Any living civilization,
or the host, may choose it. Play then continues normally, and **no second victory is awarded**: the Chronicle keeps the first. The headless tools
(`ua simulate`, `ua future`) print the victory and continue automatically, so soak runs keep their full length.

## Elimination
At turn end, a civilization that has founded a city and since lost every city **and** every unit is eliminated (`PlayerEliminated`, Chronicle:
"Its people live on in other nations' cities."). A civilization still travelling with its first settler is never eliminated, and it blocks
the capitals form of Hegemony until it founds its capital.

## Snapshot
v7 adds `TurnLimit`, `Victories` and the victory state. The game setup codec carries the two options, so a lobby's choices reach every peer.
