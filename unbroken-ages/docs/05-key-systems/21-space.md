# 05/21 — The orbital layer and the Exodus victory

Rules: `Systems/SpaceSystem.cs`; content: `content/base/data/space.json`; AI: `AI/SocietyAi.cs` (`WantsSpace`); UI: the Space line in
the Society screen (G), satellite dishes floating over the cities that launched them. Tests: `tests/UnbrokenAges.Tests/SpaceTests.cs` (5).
Snapshot version 21.

## The Spaceport

The Spaceport (Rocketry, 900 base production) is the home of every space project. It was 1,800, which this game's +25%-per-era district
scaling made about 4,500 by the Atomic era; it now comes to about 2,250. Projects gain two rules: `requiresProjects` (a chain), and
one-off projects can be completed only once (`PlayerState.CompletedProjects`).

## Satellites (Beyond Earth's orbital layer)

Repeatable projects launch a satellite over the launching city for 40 turns (scaled by speed):

| Satellite | Tech | Effect |
|---|---|---|
| Survey Satellite | Rocketry | Maps every tile within 9 at launch |
| Orbital Solar Array | Renewable Energy | +2 Production in your cities within 5 tiles |
| Weather Station | Rocketry | +2 Food in your cities within 5 tiles |
| Relay Satellite | Robotics | +2 Science in your cities within 5 tiles |

A city benefits once per kind, however many satellites cover it, and the coverage shows in its yield breakdown. Satellites fall when
their time is up.

## The Exodus victory

| Stage | Project | Tech | Cost |
|---|---|---|---|
| 1 | First Orbit | Rocketry | 800 |
| 2 | Moon Base | Nuclear Fission | 1,200 |
| 3 | Mars Colony | Robotics | 1,600 |
| 4 | The Exodus Ark | Robotics | 2,200 |

* **Order:** each stage requires the one before.
* **Reward:** each stage is a historic moment (+3 era score), announced to the world.
* **Victory:** launching the Ark wins the Exodus victory.
* **Counterplay:** spies can sabotage the work in progress (Sabotage Production halves it), and Great Engineers rush it if the capital
  builds it.

## The AI

Once it knows Rocketry, the most productive city with four or more districts raises a Spaceport. The Spaceport city then works through
the Exodus chain, and keeps two satellites in orbit (Solar Array first).

## Soak

6 players, 450 turns, two seeds: in each, one civilization launched the Ark. In one of them a rival had already won an Ascension
victory: the two science victories race each other.
