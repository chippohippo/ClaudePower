# 05/16 — City-states

Minor powers of one city each, placed at the start of the game. Content: `content/base/data/citystates.json` (18 city-states, three of each
type). Rules: `Systems/CityStateSystem.cs`; AI: `AI/SocietyAi.cs` (`BestEnvoyTarget`); UI: the city-state section of the Diplomacy screen
(P); option: `GameOptions.CityStates` (−1 means one per civilization; set in the lobby). Tests: `tests/UnbrokenAges.Tests/CityStateTests.cs` (10).
Snapshot version 15.

## Who they are

* **Players:** each city-state is its own player (`PlayerState.CityStateIndex`), so war with one is not war with all.
  * They are not majors (`PlayerState.IsMajor`). They take no turns, earn no score, recruit no great people, have no ages, and do not
    count toward any victory.
  * They are never for sale, and their single city is a capital, so loyalty cannot flip it.
* **Placement** (`CityStateSystem.Place`, on the seed's own `city-states` stream):
  * Good land: open neighbours, fresh water and coast score well.
  * At least 6 tiles from every civilization's start and from each other.
  * Each starts with a city named for it and a fortified warrior.
* **Self-running**, every turn:
  * A city-state knows every technology and civic that half the living civilizations know.
  * It keeps two defenders (three when an enemy is within 5 tiles), and otherwise builds its cheapest building.
  * It strikes adjacent enemies at 55%+ odds and calls stray guards home.
  * It accepts any lawful peace offer.

## Envoys

* **Influence:** every civilization earns `1 + the government's diplomatic slots + diplomatic cards slotted` influence a turn.
* **Envoys:** an envoy costs `25 + 5 × envoys earned so far` influence, capped at +40 (so at most 65).
* **First contact:** the first civilization to see a city-state's city leaves a free envoy there. Ties go to the lowest player id.
  Later meetings are only introductions.
* **Sending** (`SendEnvoyCommand`) needs a meeting, an envoy in hand, and peace with the city-state.

## What envoys pay

| Type | Yield | District |
|---|---|---|
| Scientific | Science | Academy |
| Cultural | Culture | Cultural Quarter |
| Trade | Gold | Market |
| Religious | Faith | Sanctuary |
| Industrial | Production | Foundry |
| Militaristic | Production | Garrison |

* **1 envoy:** +2 of the type's yield in your capital.
* **3 envoys:** +2 in every city with the type's district (unique replacements count).
* **6 envoys:** +2 more there.
* **Suzerain:**
  * Who: the most envoys, at least 3.
  * Ties: an incumbent keeps a tie; a tie with no incumbent means no suzerain.
  * Wars: envoys of a civilization at war with the city-state do not count, and pay nothing.
  * Reward: the suzerain gets the city-state's unique bonus (for example Monemvasia's +3 strength, Malacca's +10% Gold, or Lhasa's Faith and
    Amenities in Sanctuary cities). It applies to every city, and to units for strength bonuses, under the same +6 society cap as cards and
    wonders.

## The AI

Sends each envoy where it wins or defends a suzerainty first, then where it reaches the next tier, and prefers nearer city-states. The AI
never declares war on city-states.

## Soak (8 players, 300 turns, five seeds)

On average 4.0 civilizations still hold cities at the end, against 3.4 without city-states. The city-states take up space the snowballing
leader would otherwise conquer.

## Not yet

Levies, quests, city-state unique improvements, envoys from civics and great people, and capturing a city-state to become its master.
