# 05/19 — Great works, tourism and the Culture victory

Rules: `Systems/CultureSystem.cs`. Content: the `works` lists on artists in `society.json` (10 Great Artists, 20 named works),
`greatWorkSlots` on buildings in `buildings.json`. UI: the CULTURE column of the Society screen (G). Tests:
`tests/UnbrokenAges.Tests/CultureTests.cs` (7). Snapshot version 18.

## Great works

* **Who makes them:** a recruited Great Artist creates their works (Homer: *The Iliad* and *The Odyssey*; Hokusai: *The Great Wave off
  Kanagawa*; …). A Great Prophet leaves a relic. Other classes create nothing.
* **Slots:** the capital's palace 1, Amphitheater 2, Museum 3, Temple 1. Works hang automatically in the largest cities first. Works
  with no free slot wait in storage until a slot opens.
* **Yield:** each work on display gives its city +2 Culture, which shows in the yield breakdown.
* **Ownership:** works belong to their city. A captured city's works change hands with it; a razed city's works go to storage.
* **Score:** each work is worth 5 points.

## Tourism and tourists

* **Tourism per turn:** 2 per displayed work, 3 per world wonder, and 2 per natural wonder in your territory.
  * +35% per era from the Industrial on (`TourismPerEraPercent`), so tourism keeps pace with late-era culture.
  * +15% in a Golden or Heroic Age.
* **Where it goes:** every turn your tourism flows toward each other living civilization. It gets +25% each where:
  * a trade route of yours runs to them;
  * they grant you open borders;
  * their capital follows your religion.
* **Visiting tourists:** one per 150 tourism sent to that civilization.
* **Domestic tourists:** a civilization's lifetime culture / 100.

## Culture victory

Your visiting tourists outnumber the domestic tourists of every other living civilization that has cities, and there must be at least two
of them. A civilization whose tourists come to outnumber a rival's own gets a notification of cultural dominance.

## Soak

8 players, 400 turns, two seeds: the leading cultural civilization reached 175–220 tourism a turn with about 20 great works. It
dominated one rival but not all, so no Culture victory in those games. This is meant to be a rare, late win.

## Not yet

Theming bonuses, archaeology and artifacts, national parks, rock bands, and buying or swapping works.
