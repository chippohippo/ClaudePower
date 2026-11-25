# 05/15 — Society: governments, faith, great people, ages, promotions, barbarians, wonders

The staples of the genre that shape a civilization beyond its cities. Content: `content/base/data/society.json` (governments,
policy cards, beliefs, religions, great people, promotions), world wonders in `districts.json` (category `Wonder`), natural wonders
in `terrain.json` (`naturalWonder: true`), the Missionary in `units.json`. Rules: `Systems/SocietySystem.cs`, `ReligionSystem.cs`,
`GreatPeopleSystem.cs`, `AgeSystem.cs`, `BarbarianSystem.cs`; AI: `AI/SocietyAi.cs`; UI: `godot/scripts/UI/SocietyPanel.cs` (key **G**).
Tests: `tests/UnbrokenAges.Tests/SocietyTests.cs` (28). Snapshot version 14.

## Governments and policy cards

* Every civilization starts in **Chiefdom** (1 military, 1 economic slot). Ten more governments unlock with civics: Autocracy, Oligarchy,
  Classical Republic, Theocracy, Merchant Republic, Monarchy, Democracy, Communism, Fascism, Technocracy. Each has slot counts and a bonus
  (`modifiers`), which apply to every city like any other modifier and show in the tooltip breakdown.
* **24 policy cards** in four kinds (military, economic, diplomatic, wildcard). A card fills a slot of its own kind first; any overflow,
  and every wildcard card, needs a wildcard slot (`SocietySystem.Fits`). World wonders can add wildcard slots (Forbidden City).
* **Free swap window**: after a civic completes (and at the start of the game), government and cards change for free for one turn.
  Otherwise a new government costs `40 × (era + 1)` gold, and each newly slotted card costs `10 × (era + 1)`. Removing a card is always free.
* Changing government drops cards that no longer fit, last-slotted first.
* Commands: `SetGovernmentCommand`, `SetPoliciesCommand` (the full list of cards).

## Faith

* **Pantheon**: 25 faith buys one pantheon belief, which nobody else may take. It applies to all of the founder's cities.
* **Religion**: a recruited **Great Prophet** lets a civilization found a religion. It picks a free name (10), one **founder** belief and one
  **follower** belief. The holy city (the capital) converts at once.
  * **Founder beliefs** pay per follower city anywhere in the world, for example Tithe: +2 gold each.
  * **Follower beliefs** bless every city that follows the religion, whoever owns it.
* **Pressure**: every city that follows a religion presses on every city within 9 tiles.
  * Strength per turn: `(10 − distance) × (2 + population)`. It doubles from the holy city and gains +50% from a city with a Sanctuary.
  * A city's own religion counts against a rival's pressure.
  * Net pressure accumulates, at a tenth per turn. The city converts when the total passes `30 + 5 × population`.
* **Missionaries** (Classical, Astrology): a civilian that needs a founded religion to build, or to **buy with faith** for twice its
  production cost (`FaithPurchaseCommand`; the city screen's Missionary button).
  * Spreading uses up the missionary. It adds 60 progress toward the city's conversion.
  * Cities of 3 or fewer people, and cities with no religion, convert at once.
  * Bought with faith: twice the production cost, +25% for each missionary of yours already in the field.
* **Spiritual victory**: your religion is the majority faith in every other living civilization that has cities, and there are at least two
  of them. Checked at the end of each turn.

## Great people

* Specialty districts earn **points** per turn: 1 per district, +1 per building in it.
  * Academy → Scientist, Foundry → Engineer, Market → Merchant, Cultural Quarter → Artist, Sanctuary → Prophet.
  * Garrison → General. Harbor → Admiral (and +1 Merchant).
* Each class offers **one named person at a time**: the earliest whose era the world has reached (30 historical people across 7 classes).
* Whoever has gathered at least the cost recruits them; on a tie, the most points wins, then the lowest id. The cost is
  `30 + 30 × (people of that class already recruited by anyone)`.
* Their deed is immediate:

  | Class | Deed |
  |---|---|
  | Scientist | Science toward research |
  | Engineer | Production in the capital's current build |
  | Merchant | Gold |
  | Artist | Culture toward civics |
  | Prophet | Faith, and the right to found a religion |
  | General | Every military unit healed, +10 experience |
  | Admiral | +Loyalty in every city, fleets healed |

### Patronage (gold and faith buy great people)
`PatronizeCommand` recruits the class's person **now**, paying the points still missing: **3 gold or 2 faith a point**, 15% dearer for
every great person this civilization has already bought (`GreatPeopleSystem.PatronagePrice`). Prophets answer only to faith. The
race stays a race: patronage is how a rich or devout people snatches a person its rival was about to recruit. The AI buys a prophet
with faith while religions remain to be founded, and spends gold above a reserve (250 + 50 per city) on the class its road to victory
wants (Artists for Culture, Engineers and Scientists for Exodus, Merchants for the Concord, otherwise Engineers and Artists), and faith
above 500 (1,500 on the Spiritual road) on Artists.

## Historic dilemmas
**Code:** [`DilemmaSystem.cs`](../../src/UnbrokenAges.Sim/Systems/DilemmaSystem.cs) · data [`dilemmas.json`](../../content/base/data/dilemmas.json) ·
`ResolveDilemmaCommand` · tests [`DilemmaTests.cs`](../../tests/UnbrokenAges.Tests/DilemmaTests.cs)

GDD §12.4's historic events and city demands, as one system. From turn 25, about once every 24 turns, a civilization faces a
**dilemma drawn from its circumstances**: the river at a flood-prone town, hoarders in a big city, refugees from a neighbour, veterans
of a war, a treasure fleet, a restless conquest, a full treasury, a factory strike, the smog of an industrial city. Each has two or
three answers with a **price and a consequence**: gold, faith, favor, science, culture, era score, loyalty, citizens, a neighbour's
goodwill or grievance, a push to the world's currents, and modifiers that last a number of turns in the city (or the whole realm).
The first answer never costs anything: if no one answers within five turns, the council takes it. Each dilemma comes to a
civilization at most once per game, and the answer is written into the Chronicle.

| Trigger | Where / whom |
|---|---|
| `Empire`, `HasReligion`, `Wealthy` (300+ gold), `GoldenAge`, `DarkAge` | the capital |
| `RiverCity`, `CoastalCity`, `LargeCity` (8+), `RestlessCity` (loyalty < 80), `NewlyTakenCity` (changed hands in the last 30 turns) | that city |
| `AtWar`, `Neighbour` (a great power within 10 tiles, at peace) | the capital or the nearest city, and that people |

Twenty dilemmas ship, from the Ancient era (*The River's Temper*) to the Information era (*The Machines*); modders add more in JSON.
The AI scores each answer (gold and faith at face value, a thin treasury makes coins dearer, loyalty counts heavily only where it
is low, modifiers by their turns) and takes the best it can afford (`DiplomacyAi.PreferredAnswer`).

## Era score and ages

* **Historic moments** earn era score:

  | Moment | Era score |
  |---|---|
  | A city founded | +1 |
  | A district raised | +1 |
  | A wonder | +4 |
  | A great person | +2 |
  | A pantheon | +2 |
  | A religion | +3 |
  | A natural wonder discovered | +2 |
  | A barbarian camp scattered | +1 |
  | A city taken | +2 |
  | A unit's third promotion | +1 |
* On entering a new era, the score of the era just ended decides the **age**:
  * **Dark** below `4 + era + cities/2`.
  * **Golden** from `12 + 2 × era + cities`.
  * **Heroic** is Golden straight out of a Dark Age.
  * Thresholds grow with the empire, so great powers must do great things to shine.
* Effects:
  * **Golden**: +1 Amenity, +10% Culture, loyalty pressure ×1.15.
  * **Heroic**: +2 Amenities, +15% Culture, +10% Production, ×1.25.
  * **Dark**: −1 Amenity, +1 Faith, ×0.85.

## Promotions and experience

* Military units earn **experience** in combat:
  * Attacking: +4. Defending: +3.
  * Against a city: +3 more. Killing the enemy: +6 more.
* Promotions at **15 / 45 / 90 / 150** experience. Each takes the unit's turn and heals it by 50.
* **16 promotions**, tiered and by unit class: strength, defence, attacking cities, rugged terrain (woods, marsh, hills), +1 move, field
  medics (+10 HP every turn). Tier *n* opens with the *n*th promotion.
* Promotions show as lines in the combat preview.

## Corps and armies

* **Corps:** two units of the same type, on the same or adjacent tiles and both with moves left, merge into a **Corps** (`FormCorpsCommand`).
  It needs Urbanization and gives +10 strength.
* **Armies:** a corps and one more unit of its type form an **Army**. It needs Environmentalism and gives +17 strength.
* **What the formation keeps:** the better veteran's experience and promotions, and the higher health. Forming ends the turn.
* **Combat:** the formation's bonus shows as its own line in the preview, outside the +6 society cap.
* **On the map:** corps and armies march in deeper squads (two and three ranks).
* **The AI** forms one corps a turn once its army is larger than twice its city count plus two.

## War weariness

* Rises with every attack outside your own borders (+1), every unit you lose to a civilization (+1), and every city you take (+6). Fighting
  barbarians or free cities costs nothing.
* Every 8 points cost −1 Amenity in every city, up to −4. Weariness fades by 1 a turn while at war and by 3 in peace.
* The AI declares no new war while weariness costs 2 or more amenities, and it sues for peace at 3.

### Society strength cap

Government, cards, pantheon and wonders add at most **+6 strength** to a unit between them. Promotions and everything else stack on top.
Without the cap and weariness, the 300-turn soaks showed the leader snowballing: with 8 players, only 1.8 nations had cities at the end on
average, against 3.4 before this system existed. With both, it is back to 3.4, with more cities overall.

## Barbarians

* From turn 15, every 10 turns, a **camp** rises (up to half the number of civilizations). Camps stand on unclaimed land, at least 6 tiles
  from any city, 4 from any unit and 8 from another camp. The site is chosen by a hash of the turn, not the shared random streams.
* A camp sends a **raider** every 8 turns while fewer than two are near: the strongest generic melee unit that most civilizations can field.
  Raiders fly the Free Cities' banner.
* Raiders strike adjacent units at 45%+ odds and capture civilians. They pillage improvements and walk toward prey within 6 tiles.
  **They never attack cities.**
* A civilization's military unit that steps onto a camp scatters it: +50 gold and +1 era score.

## Wonders

* **14 world wonders** are districts of category `Wonder`:
  * Great Pyramids, Hanging Gardens, Oracle, Colossus, Great Library, Terracotta Army, Machu Picchu, Hagia Sophia.
  * Forbidden City, Oxford University, Big Ben, Eiffel Tower, Harbour Opera House, Cosmodrome.
* Each is one in the world: once built, others fail with `WonderBuiltElsewhere`, and rival queue entries are dropped.
* Wonders need no district slot. Many have placement rules: on a river, on hills, in the coastal waters, beside a mountain or the coast.
* `modifiers` apply to the wonder's city; `empireModifiers` apply to every city of the owner (UnitStrength reaches its units); `wildcardSlots` adds slots.
* **9 natural wonders** are features placed by the map generator on their own random stream, so the rest of the world is unchanged:
  * Uluru, Kilimanjaro, Great Barrier Reef, Ha Long Bay, Pamukkale, Zhangjiajie, Torres del Paine, Galápagos, Victoria Falls.
  * Between 2 and all 9 per map, at least 4 tiles from any start and 8 from each other.
  * They have rich yields and Appeal 4, and are never cleared. Each civilization's first sight of one is a historic moment.
* Every wonder has an original low-poly model (`tools/assets/wonders.py`, CC0) that keeps its form in every era.

## The AI

`SocietyAi`:
* Adopts the best government it has unlocked on free turns: Technocracy > Democracy > Communism > Monarchy > …, and Fascism while at war.
* Values each card by what it would do for its own cities now, checking the requirements, and fills slots best-first.
* Takes the first free pantheon and founds a religion as soon as a prophet arrives.
* Trains one missionary at a time and sends it to the nearest unconverted city (its own first); on the spiritual road it buys up to four
  with faith and sends them to the people closest to tipping ([05/13](13-ai.md#victory-focus-victoryai)).
* Promotes by a strength-weighted score.
* Raises wonders in its most productive city once that city has a few districts.

## Civ VI and Beyond Earth staples: what this game has

| Staple | Status |
|---|---|
| Districts, adjacency, unique districts | ✓ (05/01) |
| Governors with promotions | ✓ (05/02) |
| Loyalty, free cities | ✓ (05/02) |
| Climate, disasters, power | ✓ (05/03) |
| Amenities, housing, luxuries | ✓ |
| Builders, improvements, strategic stockpiles | ✓ |
| Unit upgrades, unique units | ✓ (every nation has a unique unit: 36) |
| Diplomacy: war, peace, denounce, open borders, grievances | ✓ (05/08) |
| Combat, flanking, support, city sieges | ✓ (05/09) |
| Border growth, tile purchase | ✓ (05/10) |
| Score / domination / science-style victories | ✓ (05/11) |
| Governments and policy cards | ✓ new |
| Pantheons, religions, beliefs, spread, missionaries, religious victory | ✓ new (no apostles, theological combat or inquisitors) |
| Great people | ✓ (recruited automatically, or bought with gold or faith) |
| Era score; Golden, Dark and Heroic ages | ✓ new (no dedications) |
| Unit experience and promotions | ✓ new |
| Barbarians | ✓ new (no scouts that report a camp's location) |
| World wonders, natural wonders | ✓ new |
| War weariness | ✓ new |
| BE affinities | ✓ as the Divergence (Engineered / Bloom / Substrate) |
| BE outposts | ✓ (05/12) |
| BE virtues | ≈ policy cards |
| BE alien biome | ≈ the Bloom |
| BE affinity-driven unit looks | ✓ (tech-driven visuals) |
| City-states: envoys, suzerains | ✓ (05/16) |
| Trade routes and traders | ✓ (05/17) |
| Espionage | ✓ (05/18) |
| Tourism, great works, Culture victory | ✓ (05/19) |
| World Congress, Diplomatic victory | ✓ (05/20) |
| Corps and armies | ✓ |
| BE orbital layer, stations, quests | ✗ not yet |
| Unique units for the other 30 nations | ✓ |

## Tuning knobs

* **Society** (`SocietySystem`): `MaxSocietyStrength` (6), `WearinessPerAmenity` (8), `MaxWearinessPenalty` (4).
* **Faith** (`ReligionSystem`): `PantheonCost` (25), `Radius` (9), `MissionaryProgress` (60).
* **Great people** (`GreatPeopleSystem`): base cost 30 and step 30.
* **Ages** (`AgeSystem`): the thresholds `DarkBelow` and `GoldenFrom`.
* **Barbarians** (`BarbarianSystem`): `FirstTurn`, `SpawnEvery`, `RaiderEvery`, `ClearGold`.
* **Content**: every number in `society.json` and the wonder entries.
