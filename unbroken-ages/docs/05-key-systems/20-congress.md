# 05/20 — The World Congress and the Concord victory

Rules: `Systems/CongressSystem.cs`; AI: `AI/SocietyAi.cs` (`Votes`); UI: the World Congress section at the top of the Diplomacy screen (P).
Tests: `tests/UnbrokenAges.Tests/CongressTests.cs` (5). Snapshot version 19. Design: GDD §8.4 (fewer, better sessions; visible tallies).

## Sessions

* **When:** the first session meets on turn 90, then every 30 turns (both scaled by game speed).
* **Notice:** ten turns before a session, two resolutions are announced. They are chosen by a hash of the session number, and last session's
  are avoided where possible.
* **Votes:** civilizations cast and change votes until the session meets (`VoteCommand`). The tallies are public all along.
* **Diplomatic Favor:** from ten turns before the first session, every civilization earns 1 a turn, plus:
  * 1 per suzerainty;
  * 1 under a government with two or more diplomatic slots;
  * 1 in a Golden or Heroic Age.
* **Voting cost:** one vote per resolution is free; the k-th extra vote costs `10 × k` favor (10, 30, 60…). Favor is spent only when the
  session resolves.

## Resolutions

| Resolution | A | B |
|---|---|---|
| World's Fair *(names a civ)* | +20% Culture | −15% Culture |
| Trade Charter *(names a civ)* | +15% Gold | −15% Gold |
| Sovereignty Pact *(names a civ)* | +3 Loyalty a turn in its cities | −3 Loyalty |
| Patronage of Science *(names a civ)* | +15% Science | −10% Science |
| Arms Control *(everyone)* | −25% Production toward units | +15% |
| Climate Accord *(everyone)* | −25% emissions, −5% Production | +25% emissions, +10% Production |

* **The outcome:** the option with more votes wins; A wins a tie.
* **Targets:** for resolutions that name a civilization, the target is the civilization most named by the winning side's voters (ties go to the
  lower id). If nobody named anyone, nothing passes.
* **Duration:** passed resolutions apply until the next session, and show in each city's yield breakdown.

## Diplomatic victory points and the Concord victory

* **Carrying a vote:** +1 to the civilization that put the most votes behind each winning option, if no one ties it.
* **Suzerainties:** +1 at every session to each suzerain of three or more city-states.
* **Victory:** 20 points win the **Concord** victory.

## The AI

* A civilization near the top (at least 80% of the leader's score) names itself for option A.
* Everyone else names the leader for option B, so a coalition forms against a runaway.
* Arms control: A in peace, B at war.
* Climate Accord: A once the climate has started to change.
* The AI spends up to half its favor, shared between the resolutions.

## Soak

8 players, 400 turns, two seeds: 11 sessions each. The coalition repeatedly passed B against the leader. The best diplomat reached 8–12
victory points: the Concord is a long game.

## Not yet

Player-proposed resolutions, emergency sessions, aid requests, trading votes in deals, and climate grievances.
