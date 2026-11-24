# 14. Nations: signatures and leaders

Every major nation plays **one rule of the game differently**: its *signature*. A signature is not a percentage bonus. It
changes what you do every turn. Each nation has two historical leaders, and each leader's *augment* bends the signature
further, so Egypt under Thutmose III plays differently from Egypt under Hatshepsut.

**Implemented:** `src/UnbrokenAges.Sim/Systems/NationSystem.cs`. Data lives in `content/base/data/civilizations.json`:
`signature.kind` plus tunable `params`, and `leader.augment.params`, which override or add to them. AI play is in
`NationAi` (`AI/AiPlanners.cs`). The lobby picker is `godot/scripts/UI/NationPicker.cs`, and the top-bar badge is
`Hud/TopBar.cs`. Tests are in `tests/UnbrokenAges.Tests/NationTests.cs`.

## The six nations

| Nation | Signature | How it changes play | Leaders and their augments |
|---|---|---|---|
| **Egypt** | **The Royal Granary** (`Inundation`) | Cities do not grow from their own food. All surplus goes to a royal granary that earns 20% interest. Every 8 turns the river floods: the granary pours into the cities, weighted toward river and floodplain land, and can lift a city several sizes at once. 40% of the flood also becomes production. River floods never harm Egyptian cities. **Growth comes in pulses:** time wonders and districts to land on flood turns. | **Thutmose III**, *The Warrior Pharaoh*: every flood also musters his best melee unit. **Hatshepsut**, *Foremost of Noble Women*: floods every 6 turns, and each flood pays half the granary's worth in gold. |
| **Venice** | **The Ledger Republic** (`Ledger`) | Never trains Settlers. Waymakers are available from the start; they plant trading outposts, which Venice buys up into cities at half price. Venice also buys Free Cities, and foreign cities with loyalty below 60, within 8 tiles. Each city earns +1 gold per foreign city within 8 tiles. **Gold is expansion.** | **Enrico Dandolo**, *The Blind Doge*: can buy enemy cities in wartime (loyalty below 85); purchases cost 15% less. **Pietro II Orseolo**, *Lord of Dalmatia*: coastal cities cost 35% less; bought cities arrive fully loyal with +1 citizen. |
| **Song China** | **The Mandate of Heaven** (`Mandate`) | A Mandate meter gains 3 per turn for every city with loyalty 75 or more. It loses 6 for every city below 50, and 4 a turn while at war. At 100 a **Golden Dynasty** begins: +25% science, production and culture everywhere for 10 turns. Losing a city during a dynasty ends it, and every city loses 20 loyalty. **Order is power.** | **Emperor Taizu**, *Founder of the Song*: dynasties last 14 turns. **Emperor Huizong**, *Emperor of Brush and Silk*: the Mandate gains 4 per loyal city and dynasties give +60% culture, but war drains the Mandate twice as fast. |
| **Mongolia** | **The Endless Steppe** (`Horde`) | Cities make 40% less science and 25% less culture. Each enemy unit destroyed yields science equal to twice its strength, and culture equal to its strength. A captured city yields 40 science per citizen and one technology its owner knew. Mounted units get +1 movement and heal 15 HP after a kill. **You learn by conquering.** | **Genghis Khan**, *Khan of the Steppe*: kills also pay gold, and enemy cities next to a Mongol unit lose 5 loyalty a turn. **Kublai Khan**, *Emperor of the Yuan*: the science penalty is only 20%; captured cities keep their citizens and start at 80 loyalty. |
| **Inca** | **Roads in the Sky** (`SkyRoads`) | Units cross mountains at a cost of 2 movement. Citizens farm mountains in terraces (+2 food, +1 production) and hills (+1 food). Cities with a hill or mountain next to the centre get +1 production. **Where others see walls, you see farmland**, and passes no one else can use. | **Pachacuti**, *Earth-Shaker*: mountains cost 1 movement, and terraced mountains give +2 production. **Topa Inca Yupanqui**, *The Resettler*: cities with two or more mountains in reach get +2 housing and +1 amenity; terraces also give +1 science. |
| **Mali** | **The Golden Road** (`GoldenRoad`) | Cities make 30% less production. Desert tiles yield +1 gold and mines +2 gold. Purchases cost 35% less, and the treasury earns 2% interest a turn (up to 25). **You do not build, you buy.** | **Mansa Musa**, *Lord of the Mines of Wangara*: 3% interest (up to 40), and every purchase also grants science and faith worth 10% of its price. **Sundiata Keita**, *The Lion of Manden*: the production penalty is only 15%, and units cost 20% less to buy. |

New unique units: **Keshig** (Mongolia, replaces Horseman: cheap, 5 moves before the Horde's bonus), **Warak'aq** (Inca,
replaces Slinger), and **Mandekalu Cavalry** (Mali, replaces Horseman). Egypt keeps the Medjay, Venice the Great Galley and
Song the Fire Lance Corps.

## Design rules

* **A signature changes a decision you make every turn.** Each is tied to one engine hook:
  * growth (Egypt);
  * expansion (Venice);
  * loyalty and war (Song);
  * research (Mongolia);
  * movement and tiles (Inca);
  * production against purchase (Mali).
* **Leaders bend, never replace.** An augment only overrides the signature's own params. A test checks that every
  augment key exists in its nation's params.
* **Visible and explained.** The lobby's nation card and dossier say how the nation plays in one sentence. In game, a
  badge in the top bar shows the signature's live state: the granary and the next flood, the Mandate or the dynasty's
  turns left, cities for sale, victories plundered, interest per turn. Its tooltip gives the full rule and the leader's
  augment. Venice gets a **Buy** button under every city it could purchase, greyed out until it can afford it.
* **On the map:**
  * Every capital raises its nation's landmark: Egypt's pyramid, Venice's campanile, a Song pagoda, the Khan's great
    ger, an Inca ushnu and Mali's mud mosque. They are original models generated by `tools/assets/landmarks.py`.
  * Mongol towns are tent cities of yurts until the industrial age.
  * Pre-industrial houses are built in each nation's material: sandstone, terracotta, fieldstone, adobe.
  * Inca-held hills and mountains are cut into green terraces.

## AI

`NationAi` plays the signatures:
* Venice plants outposts, buys them up and buys cities on the market.
* Mali buys its cities' production.
* The Horde keeps a standing army and fights earlier.

Each leader's `war` personality scales when the AI starts a war and how large an edge it needs.

Several rules keep games alive (`ua simulate --players 6 --nations` seats every nation):
* No AI war before turn 35.
* Until turn 150 the AI spares a rival's last city and makes peace.
* Armies are capped and never built into debt.
* A bankrupt empire loses its costliest unit each turn.
