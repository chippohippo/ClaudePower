# 05/17 — Trade routes

Rules: `Systems/TradeSystem.cs`; the Trader is in `units.json` (`UNIT_TRADER`, Foreign Trade, 60 production); AI: `AI/SocietyAi.cs`
(`WantsTrader`, trader orders); UI: route buttons on the selected Trader, the routes list on the Society screen (G), caravans and
merchantmen on the map (`LifeLayer`). Tests: `tests/UnbrokenAges.Tests/TradeTests.cs` (8). Snapshot version 16.

## Opening a route

* **Where:** a Trader standing in one of your cities opens a route (`EstablishTradeRouteCommand`) to any other city in reach, except the
  Free Cities and civilizations you are at war with.
* **Reach:**
  * The search is breadth-first: deterministic, ties broken by tile order.
  * Up to 15 tiles over land (mountains and impassable terrain block it; Great Rivers can be crossed).
  * Up to 20 tiles by sea, between two cities that both touch the sea.
  * The shorter path wins, and it is stored with the route.
* **Capacity:** one route per city with a Market or Harbor (unique replacements count), plus one with Foreign Trade.
* **Lifetime:** the trader becomes the route for 30 turns (scaled by game speed). Then it comes home to its city as a Trader, ready
  to be sent again.

## What routes pay (each turn, shown in the city's yield breakdown)

| Route | Origin gets | Others |
|---|---|---|
| Domestic | Food `2 + districts/2`, Production `1 + (districts+1)/2` | |
| International | Gold `3 + districts + 2 (Market) + path/5`; +1 Science from a partner with more techs; +1 Culture from a Cultural Quarter | the destination's owner: +1 Gold |
| City-state | Gold `4 + path/6` | the owner: +2 influence a turn toward envoys |

"Districts" means the destination's specialty districts that are not pillaged.

## Danger

* **War:** a war between the partners ends an international route. The trader comes home.
* **Plunder:** an enemy military unit standing on any tile of a route plunders it. This includes barbarian raiders, who are at war with
  everyone.
  * The trader is lost.
  * A civilization that plunders takes 30 gold.
* **Lost cities:** losing the origin city ends the route, and nobody comes home.

## The AI

Builds Traders while route slots outnumber its routes, traders and queued traders. A trader picks the best route by value (gold 1,
food 1.3, production 1.5, science 3, culture 2, influence 2). A trader with nowhere to go walks to the capital.

## Soak

6 players, 200 turns: 16 routes running at the end, 47 completed and 14 plundered.

## Not yet

Roads that speed movement along routes, sea-trade techs extending range, trade-route religious pressure, and tourism from trade.
