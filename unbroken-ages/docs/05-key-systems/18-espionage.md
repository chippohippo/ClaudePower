# 05/18 — Espionage

Rules: `Systems/EspionageSystem.cs`; AI: `AI/SocietyAi.cs` (`Spies`, `PickMission`); UI: the Espionage screen (key **E**).
Tests: `tests/UnbrokenAges.Tests/EspionageTests.cs` (7). Snapshot version 17.

## Spies

* **Capacity:** one spy each for Recorded History, Urbanization and Environmentalism, plus every `SpyCapacity` modifier (the Spymaster's
  Informant Network). Spies are recruited for free up to capacity and named from a list of codenames (unique within a civilization).
* **Ranks:** Recruit → Agent → Special Agent → Master Spy. Every success promotes the spy.
* **Orders** (`AssignSpyCommand`): a city and a mission, or *None* to recall.
  * Foreign missions travel first: `2 + (distance from your nearest city) / 10` turns. Then they take the mission's own length.
  * You must know where the city is. You cannot spy on the Free Cities, and city-states fall only for scandals.

## Missions

| Mission | Turns | Base odds | Effect |
|---|---|---|---|
| Counterintelligence | – | – | Your own city: +rank+1 defence there, and failed enemy spies are likelier to be caught |
| Steal Technology | 8 | 55% | +40% of the cost of the cheapest tech they know and you do not, toward your research |
| Siphon Funds | 6 | 65% | Takes `25 + 4 × the city's gold yield` from their treasury (never more than they have) |
| Sabotage Production | 6 | 50% | Halves the progress on the city's current build |
| Incite Unrest | 6 | 45% | −30 loyalty |
| Fabricate Scandal | 6 | 50% | City-states only: the suzerain loses two envoys there |

## Odds and consequences

* **Odds:** `base + 10 × rank − 12 × defence`, clamped to 5–95%. A city's defence is its `EspionageDefense` modifiers (the Spymaster gives
  2) plus each counterintelligence spy's rank + 1.
* **On success:** a third of the time the victim learns who did it (+8 grievance).
* **On failure:** the spy is caught with a chance of `40% + 15% per counterintelligence spy` in the city.
  * A caught spy is lost, and the victim gains a +15 grievance.
  * Otherwise the spy escapes home.
* **Rolls:** hashed from the turn, the spy and the step, so every peer agrees without drawing on a shared random stream.

## The AI

* Guards its capital with one spy once it has two, or once it is at war.
* Steals technology from the most advanced rival it can reach, choosing the city with the weakest defences.
* Fabricates scandals where a rival leads a city-state by two envoys or fewer.
* Otherwise siphons funds from the richest rival's largest known city.

## Soak

6 players, 200 turns: 11 spies recruited; 20 missions succeeded, 3 failed and 2 spies were caught.

## Not yet

Spy units that travel the map, recruiting partisans, breaching dams, neutralizing governors, and offensive missions against wonders and
space projects.
