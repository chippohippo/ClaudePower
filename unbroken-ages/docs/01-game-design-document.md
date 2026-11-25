# 01 — Game Design Document

**Project:** Unbroken Ages (working title) · **Genre:** turn-based historical 4X · **Platforms:** Windows, macOS, Linux, Steam Deck (consoles later)
**Players:** 1–12 (16 on dedicated servers) · **Modes:** single player, hotseat, LAN, Direct IP, relay or matchmaking, async/PBEM
**Reference point:** the systems of *Civilization VI* with *Gathering Storm* and the *New Frontier Pass*. It is **not** built on *Civilization VII*.

---

## 1. Vision

> Build one civilization across six thousand years on a map you shape tile by tile. Every city is a
> puzzle of terrain, rivers and districts. History accumulates rather than resetting.

Unbroken Ages is the game many long-time Civ VI players say they want: VI's city-planning depth and
continuous single-civilization fantasy, plus fixes for the issues that drove them to mods.
The game has no age reset, no civ swapping, no "legacy path" checklists and no simplified districts.
It adds the requested systems that never arrived: a real production queue, navigable rivers, Direct IP
multiplayer, puppets and vassals, interesting espionage from the early game on, a World Congress that
plays well, AI that can use a navy, and a timelapse replay at the end.

### 1.1 Design pillars

| # | Pillar | What it means in practice | What it rules out |
|---|---|---|---|
| P1 | **The map is the puzzle** | Districts, adjacency, rivers, terrain changes and disasters make every city site unique. | Abstract "slots" that ignore geography; one-size-fits-all city layouts |
| P2 | **One civilization, unbroken** | One civilization and one leader from the Ancient era to the Future era. Eras add identity on top instead of replacing it. | Age transitions that swap your civ, reset your progress or delete units |
| P3 | **Depth with clarity** | Every number has a tooltip breakdown. Every rule is visible in-game. Projections show turns to flip, turns to build and adjacency left to unlock. | Hidden math, rules you can only learn from a wiki |
| P4 | **Systems that talk** | Rivers feed adjacency, flood risk, trade and naval reach. Power feeds climate, which feeds diplomacy. Loyalty links culture, religion, governors and war. | Isolated minigames |
| P5 | **Your game, your rules** | Deep setup options, toggleable modes and victories, first-class modding, Direct IP and LAN with no account required | Mandatory launchers and online services for private games |

### 1.2 Keep / fix / refuse

| Keep from Civ VI | Fix (top community requests) | Refuse (Civ VII directions) |
|---|---|---|
| Districts with adjacency, specialization and placement trade-offs | Production queue and placement lens built in (no CQUI or map-tack mods needed) | Ages that force a civ change or reset parts of the game |
| Builders with charges | Late-game micromanagement: provinces, queue templates, puppets | "One leader, many civs" identity drift |
| Separate tech and civic trees with boosts | Navigable rivers | Simplified "urban district" building quarters without adjacency depth |
| Loyalty and governors | Religious unit spam; meaningless late-game faith | Legacy-path checklists that replace emergent play |
| Gathering Storm climate, power and disasters | Spammy World Congress and opaque grievances | Forced "distant lands" colonial phase |
| Great People, eras, Golden and Dark Ages | Espionage that only matters late | Removing builders, policy cards or great-people depth |
| Game modes (monopolies, heroes, apocalypse, secret societies) | Weak AI (naval, air, districts, war planning) | Cutting late-game content |
| Hotseat, LAN, mods | Desyncs, no Direct IP, no reconnect, no spectators | |
| | Vassals, puppets, liberation, city and tile trades | |
| | Timelapse replay and end-game statistics | |

---

## 2. Player fantasy & core loops

**Fantasy:** you are the guiding spirit of one people. Their capital sits by a river delta they settled in 4000 BC,
the river they canalled in the Medieval era and dammed in the Industrial era. By 2050 they are protecting that same coast from rising seas.

| Loop | Cadence | Content |
|---|---|---|
| **Moment** | seconds | Read the map, plan a district with the placement lens, move units, queue production, answer one notification |
| **Turn** | 30–120 s | Yields resolve; cities grow and finish items; loyalty and climate tick; diplomats and spies report |
| **Era** | 30–60 turns | Pursue a dedication or golden age, plan new districts, take on a governor promotion, unlock a new unit line |
| **Game** | 250–500 turns | Progress toward a victory while the map changes under you: coasts flood, rivers dam, borders flip, alliances shift |
| **Meta** | across games | Unlockable leader variants (cosmetic only), map seeds shared with friends, mods, community challenges |

The **turn summary panel** (a one-click "what changed" list) and the **notification triage stack** keep the turn
loop fast even in the late game. Every notification can be acted on, snoozed or dismissed with a key.

---

## 3. The map

### 3.1 Terrain model
Tiles are **terrain** (grassland, plains, desert, tundra, snow, coast, ocean, lake, *Great River*) plus a **relief**
layer (flat, hills, mountain) plus an optional **feature** (woods, rainforest, marsh, floodplains, oasis, reef, ice,
volcano, geothermal fissure) and optional **resource** and **improvement**. Separating relief from terrain gives
"plains hills" and "tundra mountains" without a combinatorial list of terrain types, and adjacency rules can target
any layer ("+1 per adjacent Mountain", "+1 per 2 #Woods").

### 3.2 Rivers: two tiers (top community request)
1. **Edge rivers** run along hex edges, as in Civ VI. They give fresh water and adjacency ("river runs along this
   Market: +2 Gold"), add a crossing penalty, form floodplains, and can flood.
2. **Great Rivers** are chains of navigable fresh-water *channel tiles* carved from the largest drainage basins, and
   they always reach the sea or a lake:
   * Galleys, river barges and later river monitors sail them from the Ancient era, so inland cities can build navies and trade by river.
   * Land units ford them at heavy movement cost, or cross freely on **bridges** (built by engineers or automatically with roads after Engineering).
   * They count as rivers for fresh water and adjacency, and as water for the **River Port** district.
   * Great River deltas tend to be **coastal lowlands**, which gives sea-level rise a real cost.

See [05-key-systems/06-map-generation-rivers.md](05-key-systems/06-map-generation-rivers.md) for the generator.

### 3.3 Map types and TSL
Continents, Pangaea, Archipelago, Fractal, Inland Sea, Highlands, River Lands (more and larger Great Rivers),
and **True Start Location Earth** maps (Huge and Giant) with real rivers such as the Nile, Yangtze, Danube and
Mississippi baked in as Great Rivers. The World Builder (see §17) authors these maps.

---

## 4. Cities & empire

### 4.1 Cities
* **Founding:** a settler founds a city at least 4 tiles from any other city. The city claims radius 1, and borders grow with culture
  (the most valuable adjacent tile, up to 5 tiles out) or by gold purchase (up to 3 tiles out); the city panel always names the next tile.
  See [05/10-borders](05-key-systems/10-borders.md).
* **Citizens:** each works a tile (auto-assigned with focus presets, or locked manually) or a district specialist slot.
  Each citizen also produces 0.5 Science and 0.3 Culture, so every city contributes to progress.
* **Housing and amenities** work as in Civ VI: housing slows and caps growth, and amenities modify yields and feed loyalty.
  Every number has a breakdown tooltip.
* **City tiers** (the tall-play reward): Settlement → Town (5) → City (10) → **Metropolis (20)**, which grants an extra
  district slot → **Megalopolis (30)**, which unlocks Arcology buildings and the "Vertical District" project (a second building row per district).

### 4.2 Districts (the heart of the game)
Specialty districts come from a capped pool: **1 + 1 per 3 population above 1**, +1 at Metropolis, plus governor and policy bonuses.
Infrastructure districts (Aqueduct, Dam, Canal, Neighborhood, Spaceport) do not count toward the cap.

| District | Primary | Adjacency highlights (base data in `content/base/data/districts.json`) |
|---|---|---|
| Academy | Science | +1 per Mountain, +2 per Geothermal, +1 per Reef, +1 per 2 Rainforest, +1 per 2 districts |
| Sanctuary | Faith | +1 per Mountain, **+1 per adjacent Great River**, +1 per 2 Woods, +1 per 2 districts |
| Market Quarter | Gold | **+2 if a river runs along it**, +2 per Port district, +1 per Great River tile, +1 per 2 districts |
| Harbor | Gold | +2 next to the City Center, +1 per sea resource, +1 per 2 districts |
| **River Port** (new) | Gold, Production | +2 per Market, +1 per 2 Great River tiles, +1 Production per Foundry, +1 per 2 districts |
| Cultural Quarter | Culture | +2 per Wonder, +1 per Arena, +1 per 2 fresh-water tiles, +1 per 2 districts |
| Foundry | Production | +1 per Mine, +2 per Aqueduct, Dam or Canal, +1 per River Port, +1 per 2 districts |
| Garrison | Military | Cannot be adjacent to the City Center; it is a defensive outpost |
| Arena Quarter | Amenities | Entertainment |
| Civic Plaza | Government | One per empire; **gives +1 adjacency to every adjacent specialty district**; +4 loyalty |
| Aqueduct, Dam, Canal | Infrastructure | Real terrain changes with real placement rules |
| Neighborhood | Housing | Housing 3–6 depending on Appeal |

Unique districts **inherit the identity of the district they replace**. Venice's *Arsenal* counts as a Foundry for every adjacency rule.
Adjacency rules are **pure data**, so mods can add rules without code ([07-modding.md](07-modding.md)).

**Placement lens:** choosing a district tints every tile in range. Green shading shows planner score and red shows illegal
tiles, with *all* reasons listed. The tooltip itemizes each contribution, shows "1 more woods → +1", and shows how this placement
**changes neighbouring districts**. Map tacks reserve tiles and are shared with teammates. Details:
[05-key-systems/01-district-adjacency.md](05-key-systems/01-district-adjacency.md).

### 4.3 Builders, terrain modification & infrastructure
* **Builders have charges** (3 base; +1 from the Steward's *Public Works*, policies and wonders). They do not automate; the
  *builder planner* suggests jobs and lets you queue them.
* Chopping, harvesting and clearing woods have a climate cost (deforestation CO₂). **Reforestation** projects plant woods back.
* **Canals** must join two bodies of water across land on non-adjacent sides. **Dams** require floodplains with river on 2 or more edges and stop river floods.
  **Aqueducts** need a fresh-water or mountain source. Late game adds **Flood Barriers**, **Mountain Tunnels**, **Land Reclamation** (rebuild a
  submerged tile at great cost) and **River Straightening** (turn edge-river segments into a channel; a requested terraforming tool).

### 4.4 Production queue (first-class)
Up to 8 items per city with drag reorder, front insert, a repeat toggle, ETAs per item, **progress kept when switching**,
reserved tiles for queued districts, and invalid items skipped with a notification instead of silently blocking the queue.
**Queue templates** ("New coastal city", "Science core") can be applied to many cities from the Empire Overview.
See [05-key-systems/05-production-queue.md](05-key-systems/05-production-queue.md).

### 4.5 Managing a large empire (tall *and* wide)
* **Provinces:** group 3–8 cities. A province has a shared queue template, a focus (growth, production, science…), and an optional
  *provincial governor* whose aura applies at half strength to every city in it. Wide play scales without 40 city screens.
* **Puppets:** captured or flipped cities can be puppeted. They choose their own production, do not raise your district
  or policy costs, and contribute reduced yields. You can annex them later.
* **Vassals** (diplomatic, §8.3): a whole civilization subordinate to you.
* **Administrative strain:** each city beyond your *administrative capacity* (grown by civics and government buildings)
  costs 1 amenity empire-wide. It is a soft limit, visible in the UI and never a hidden penalty.
* **Tall rewards:** Metropolis and Megalopolis tiers, Vertical Districts, the Steward's *Urban Planner* (+1 district slot), and
  wonders that scale with population.

---

## 5. Loyalty, governors, identity

### 5.1 Loyalty
Each city's population exerts pressure on every city within 9 tiles, decaying by 10% per tile. The result is compared
against foreign pressure and normalized, so a dense heartland is stable while a contested frontier can swing. Add governor
+8, amenities (−5…+2), garrison (+2), occupation (−4), capital (+8), starvation (−5), a **settling-in grace period**
(+10 decaying over 5 turns, which prevents ping-pong flips), and modifiers. At 0 a city becomes a Free City, and a Free
City at 0 joins whichever civilization exerts the most pressure. The UI always shows **turns until flip** and a
per-source breakdown. Full formula: [05-key-systems/02-loyalty-governors.md](05-key-systems/02-loyalty-governors.md).

### 5.2 Governors (8 originals)
| Governor | Title | Role | Signature promotion |
|---|---|---|---|
| The Steward | Steward of the Granaries | Growth, housing, tall play | *Urban Planner*: +1 district slot |
| The Castellan | Warden of the Marches | Frontier loyalty, defence | *Frontier Doctrine*: +50% loyalty pressure |
| The Treasurer | Master of Coin | Gold, purchasing | *River Tolls*: Gold and Production on Great Rivers |
| The Archivist | Keeper of the Archive | Science and culture | *Librarian*: +50% Science adjacency |
| The Prelate | Voice of the Faithful | Faith, religious stability | *Sacred Rivers*: +50% Faith adjacency |
| The Engineer | Chief of Works | Industry, power, clean growth | *Grid Master*, *Clean Industry* (−50% CO₂) |
| The Envoy | High Envoy | Diplomacy, minor nations, favor | *Congress Delegate* |
| The Spymaster | Master of Whispers | Counter-intelligence from the Classical era | *Shadow Council* |

Titles come from civics, wonders and era dedications. Governors take 5 turns to establish (fewer with promotions),
and reassigning one resets the timer. Late game adds **Councils**: a governor can be posted to a province instead of a city.

---

## 6. Progression

* **Technology and Civic trees** are separate, each with boosts worth 40% of cost; boost text is shown on the node.
  Nine eras run from Ancient to Future.
* **Pacing to the calendar:** costs rise more steeply through the middle eras (×1.6 Medieval to ×1.9 Industrial, easing to ×1.25 in
  the Future) than at either end. On twelve-people Earth games the median people reaches the Industrial era at turns 150–175, the
  Information era at 225–275 (the calendar reaches AD 2000 at turn 295) and the Future era at 300–350, leaving its Divergence for the
  last stretch. The middle still runs a little ahead of the calendar.
* **Diffusion:** a technology or civic is up to 40% cheaper as more of the other living great powers know it. A people that falls
  behind catches up; the leader pays full price. (The Divergence's own branches never diffuse.)
* **Era pacing (Extended Eras):** a setup slider (100 / 150 / 200%) stretches costs per era, so unique units and era
  mechanics stay relevant longer without changing game speed.
* **Ages:** Golden, Dark and Heroic ages with era score and **dedications**, kept from Civ VI with three changes:
  (1) era score sources are listed up front with progress bars; (2) Dark Ages offer stronger, more interesting policies
  instead of a feeling of punishment; (3) catch-up is visible and opt-in ("Turbulent Ages" mode makes ages swingier).
* **The Divergence (Future era):** after the shared *Threshold* tech the tree forks into three mutually exclusive futures:
  **Sovereign** (humanity unchanged, the planet engineered), **Symbiont** (humanity spliced into the biosphere) and **Discarnate** (humanity leaves the body).
  Researching a doctrine locks the other two branches forever. Your history (flood barriers, forests kept, research labs, emissions) makes one doctrine cheaper.
  Each future is rational and dystopian, and each **remakes the Earth** (Engineered Ground, the Bloom, Substrate), so late-game maps look alien.
  Full design: [08-divergence-tech-tree.md](08-divergence-tech-tree.md).
* **Great People:** points accrue per class. Every patronage option (gold, faith) is visible, and you can pass on a
  candidate to bank 50% of the points. New classes: **Great Navigator** (river and sea exploration bonuses) and
  **Great Planner** (one-shot district relocation, or "a free +2 adjacency to a district").
* **Policies and governments:** the card system is kept (military, economic, diplomatic and wildcard slots) with
  government legacy bonuses. Late game adds Dark Age and Golden Age card variants and **Constitution amendments**
  (three permanent picks per game that define your civ's political identity).

---

## 7. Religion (fixing the spam)

| Problem in Civ VI | Fix |
|---|---|
| Missionary and apostle spam and theological-combat whack-a-mole | Religious units have **charges and an upkeep in Faith**; the per-civ religious unit cap scales with Holy Sites/Sanctuaries |
| Religion feels like a minigame detached from the rest | **State religion**: adopting any religion (even a foreign one) as state religion grants a belief tier and loyalty, and gives the founder leverage over you |
| Pressure is opaque | A pressure map lens with per-source breakdown, as for loyalty |
| Faith is useless late | Faith buys Great People, late units, *Monumental* buildings, and **faith projects** (relief efforts after disasters, conversion of Free Cities, "Pilgrimage" tourism) |
| No reform or schism | **Schisms**: a civ whose cities mostly follow a foreign religion can declare a reformed branch (keep 2 beliefs, swap 1, become founder). **Reformation beliefs** unlock in the Renaissance. |
| Religious victory is all-or-nothing | **Spiritual Victory**: your religion is the majority in >50% of cities of *every* major civ, you hold your Holy City, and no schism of your religion holds more cities than you |

Inquisitors and the *Prelate* governor provide defence. **Religious Councils** (a World Congress sub-session) can sanction aggressive proselytizers.

---

## 8. Diplomacy, World Congress, vassals

### 8.1 Leaders and agendas
Each leader has a public agenda and 1–2 hidden agendas drawn from a pool. Hidden agendas are revealed by **embassies, spies or 30 turns of
contact**. Friendship has levels (Acquainted → Friendly → Declared Friend → Allied with five alliance types). The AI explains every
attitude modifier with a number and a decay timer.

### 8.2 Grievances that feel fair
Grievances are **itemized** (what, when, how much, decay per turn) and **witnessed**: third parties only count grievances they have
visibility of. Liberating cities and returning captured settlers *removes* grievances. **Climate accountability**: once the World
Congress passes a climate accord, civilizations above their emissions share accrue small grievances with signatories. This uses the
per-player emission tracking in `ClimateState` and `PlayerState.CumulativeEmissions`.

### 8.3 Trade & deals
Gold, per-turn gold, resources, **monopolies** (in the Trade Empires mode), **tiles** (border swaps), **cities**, open borders,
**research agreements** (pooled science grants a random tech both lack), defensive pacts, joint wars, **vassalage**, and **liberation**.
A "what would make this work" button asks the AI for a counter-offer that it actually accepts.

**Vassals:** a civilization can become a vassal through a peace deal or voluntarily (when threatened). Vassals pay 10–25% tribute, join their overlord's
wars, cannot sign separate peace, and keep their own victory paths only if they win independence. **Independence** triggers when vassal satisfaction
(trade, defence and respect versus tribute) stays low, or when the vassal's military and score overtake the overlord's.

### 8.4 World Congress, redesigned
* **Fewer, better sessions:** every 40 turns at standard speed, plus *emergency sessions* only for real crises (nuclear use, a climate phase change, a city-state capture).
* **Players propose resolutions.** Each civ can table one proposal per session from a menu unlocked by civics. Proposals are announced one session ahead.
* Voting uses Diplomatic Favor with **visible tallies before the vote locks**, so you can lobby and trade votes in the deal screen.
* **Diplomatic Victory ("Concord")**: 16 victory points earned from *your* proposals passing, aid during emergencies, liberations and peace treaties brokered.
  Random competitions are removed. Congress can be set to *Off / Light / Standard* at setup.

---

## 9. Espionage (all game long)

| Era | Spies | Operations |
|---|---|---|
| Classical | **Informants** (1, +1 Spymaster promotion) | Gather intel (agendas, war plans), counter-intel, *Spread Rumour* (−loyalty) |
| Medieval | Agents | Steal tech or civic boost, fabricate claims (a casus belli), incite revolt in a Free City |
| Industrial | Spies | Sabotage production, disrupt power grid, steal great work, siphon funds |
| Modern+ | Operatives | Cyber operations (blind a city's sensors, hijack drones), rig elections in city-states, recruit partisans |

The intelligence screen lists everything you know about every rival with its source and age. Spy outcomes show odds before you commit.
The **Spymaster** governor lowers the level of enemy operations in her city.

---

## 10. Trade, monopolies & corporations

Trade routes are kept, with **auto-renew** and route **templates** (QoL). **River trade:** barges on Great Rivers count as domestic sea
routes with +1 range per River Port. The **Trade Empires** mode (our monopolies-and-corporations variant) gives luxury monopolies
and corporations whose products are *goods* sold as tradeable modifiers. **Trade Overview** lists every route with yields and
expiry, plus a "best available routes" finder.

---

## 11. Combat & military

* **Land:** one military plus one civilian unit per tile, with **corps and armies** (formations), zone of control, flanking and support.
  **Combined arms:** support units (siege towers, medics, AA, EW) give adjacent bonuses, and the UI shows the full combat preview with every modifier.
* **Fortifications:** walls by era, **forts and trenches** (improvements with ZOC and defence), **bunkers**, and city ranged strikes that scale with walls.
  Pillage and repair are explicit.
* **Naval depth:** classes are melee, ranged, raider, carrier and **river monitor**. **Coastal bombardment arcs**, **naval supply**
  (ships away from friendly ports lose HP slowly; Harbors and River Ports resupply), blockades that cut trade and loyalty, and **fleets** (naval corps).
* **Air:** units are based in cities, Airfields and carriers. Mission types are *patrol (intercept), strike, recon, air superiority*. A visible air-superiority
  overlay shows who controls each tile; anti-air and fighters contest it.
* **Upgrade paths with branches:** e.g. Horseman → (Knight | Cuirassier); Galley → River Monitor. Upgrading costs gold and strategic resources and
  keeps promotions. Obsolete units remain buildable with a warning.
* **Late-game variety instead of a single super unit:** the *Siege Exoframe* (our giant-robot analogue) is expensive, consumes uranium every turn,
  and is **hard-countered by Electronic Warfare platoons**, which also jam drone swarms. Drones beat armour, EW beats drones and exoframes, and infantry with AA
  beats air. The unit data (`strongAgainst` and `weakAgainst` tags) drives both combat and the AI.

---

## 12. Environment & events

### 12.1 Climate & power (core, not a mode)
* Buildings and improvements **demand power**. Plants serve every own city within range, and grids merge. Dispatch is **merit order**: renewables
  first, then nuclear, gas, oil and coal. Idle coal plants burn nothing, so clean capacity measurably reduces emissions.
* CO₂ comes from plants, fuel-burning units, deforestation and heavy industry. It drives temperature through thermal lag, then **7 climate phases**,
  then sea-level bands (lowlands at 1/2/3 m flood and then submerge), plus disaster frequency.
* Counterplay: renewables, Clean Industry promotions, **Carbon Recapture** projects, reforestation, flood barriers, climate accords in Congress, and
  "accountability" grievances.

### 12.2 Disasters
Every disaster type has a damage table **and** a benefit: river floods and volcanic eruptions add permanent fertility. Disasters include river floods,
coastal storms, droughts, eruptions, blizzards, dust storms, wildfires and tsunamis. The intensity setting runs Off, Gentle, Standard, Intense and
Cataclysmic (the *Cataclysm* mode adds comets and solar flares).

### 12.3 Plague (optional *Contagion* mode)
Diseases spread along trade routes and through dense cities. Counterplay: Herbalists, Hospitals, **quarantine policies**, sanitation projects and a
Medicine tech line. Plague can trigger Dark Age dedications and migrations. It never randomly deletes your capital.

### 12.4 Society
* **Migration:** citizens move between cities (yours or a neighbour's) toward high amenities, housing and safety. Disasters and wars create refugees,
  and accepting them is a diplomatic and loyalty choice.
* **City demands:** cities raise one-turn-notice demands ("We want a Harbor", "Lower taxes"). Meeting them grants amenities, and ignoring them creates unrest.
* **Historic events:** era-appropriate narrative choices with mechanical stakes, data-driven so modders can add their own.

---

## 13. Optional game modes

| Mode (our name) | Inspired by | Summary |
|---|---|---|
| Trade Empires | Monopolies & Corporations | Luxury monopolies, corporations, products as tradeable modifiers |
| Legends | Heroes & Legends | Legendary heroes with limited lifespans, discovered via the civics tree |
| Hidden Orders | Secret Societies | Four orders, each with a governor-like leader and unique promotions |
| Cataclysm | Apocalypse | Higher disaster cap, comets, Soothsayers, an end-of-world timer |
| Contagion | (new) | Plague and medicine as above |
| Turbulent Ages | Dramatic Ages | Swingier Golden and Dark Ages, rebellions |
| Tribal Clans | Barbarian Clans | Barbarian camps that trade, can be hired, or become minor nations |

---

## 14. Victory, scoring & after the game

| Victory | Condition (our version) | Fixes |
|---|---|---|
| **Exodus** (science) | Launch satellite → moon base → Mars colony → interstellar ark | Rivals can **sabotage** spaceports with spies; projects can be rushed with Great Engineers but not bought |
| **Cultural Hegemony** | Your visiting tourists exceed every rival's domestic tourists | Tourism sources itemized; "turns to victory at current rates" shown for every rival |
| **Hegemony** (domination) | Hold every original capital **or** control 60% of world population and land with loyalty above 50 | No last-city-standing grind; loyalty matters |
| **Spiritual** | §7 | Schisms create counterplay |
| **Concord** (diplomatic) | 16 victory points from proposals, aid, liberations and peace | No random competitions |
| **Ascension** (Divergence) | Complete your future's final project after remaking ≥ 10% of the world's land | The race is to remake the planet; rival futures' ground acts as a firebreak ([08](08-divergence-tech-tree.md#5-ascension-the-sixth-victory)) |
| **Score** | Highest score at the turn limit | Score sources visible all game; tie-breakers documented |

*Built:* Ascension, Hegemony and Score, the victory toggles, elimination, the game-over pause and One More Turn
([05/11-victory](05-key-systems/11-victory.md)). Exodus, Cultural Hegemony, Spiritual and Concord follow their systems.

**Victory Dashboard:** one screen with every rival's progress toward every victory, with confidence ("based on what you know").

**After the game:** "One More Turn" continues play; the game never forces an exit. You also get:
* **Timelapse replay**: territory, cities and wars animated over the whole game, recorded as per-turn owner snapshots (about 100 KB per 500 turns, delta-compressed).
* **Statistics**: graphs for every yield, military strength, emissions, religion share, tourism and wonders, comparable across players.
* **Event-sourced replay**: the command log lets you rewatch the full game, and in multiplayer it serves as the anti-cheat audit trail.

---

## 15. Multiplayer (design side)

* **Turn modes:** Simultaneous; **Dynamic** (simultaneous in peace, sequential between players at war; built, [05/04](05-key-systems/04-multiplayer-networking.md#turn-modes-simultaneous-dynamic-and-sequential-are-implemented)); Sequential; and **Hybrid with a turn timer**
  (dynamic timer: base plus per-city and per-unit allowance).
* **Teams** share vision, map tacks, research boosts and victory. Team chat and pings are on the map.
* **Hotseat** with a privacy screen. **Async** play-by-cloud or play-by-email using the same command log.
* **Direct IP / LAN / relay / matchmaking**, plus **spectators** (optionally on a delay), **pause** voting, **reconnect** to your slot, and **AI takeover**
  of disconnected players (optional). Technical design: [05-key-systems/04-multiplayer-networking.md](05-key-systems/04-multiplayer-networking.md).

---

## 16. Setup options & accessibility

Setup options: map type, size and seed; sea level; rainfall; temperature; world age; Great River count; resource density; game speed (Online,
Quick, Standard, Epic, Marathon); era pacing; disaster intensity; climate on or off; loyalty on or off; each victory toggled; turn limit;
AI difficulty and **AI aggression** set separately; barbarians; modes; starting era; city-state count; Congress frequency; tech/civic
shuffle; **"No surprise wars"** (requires formal denouncement first).

**Accessibility:** UI scale (75–200%), text size, three colourblind palettes plus *pattern overlays* on lenses, full keyboard play, rebindable everything,
reduced motion, audio cues for notifications, screen-reader-friendly UI (Godot AccessKit), and a **high-information-density** toggle (CQUI-style compact panels) versus a "comfortable" layout.

---

## 17. Tools for players

**World Builder** (in-game, using the same simulation commands): terrain painting, river drawing (edges and channels), TSL placement, scenario
scripting with the event editor, and export to mods. **Map Tacks** with notes and sharing. **Report screens:** Empire Overview, City List,
Unit List (with upgrade-all), Trade Overview, Great Works Manager (with theming hints), Religion, Climate and Power, Espionage, Victory Dashboard.

---

## 18. AI (design goals)

* Plays the same rules as humans and uses the **same planners** (for example `DistrictPlanner` for district placement), so it understands adjacency.
* **No yield cheats at "Deity-equivalent"**: higher difficulties raise planning depth, starting units and coordination, not yields. An optional
  "Classic bonuses" toggle exists for players who want them.
* Long-horizon strategy (victory pursuit, war planning with staging and naval transport), competent naval and air use, and war-weariness awareness.
* **Adaptive difficulty** (opt-in): AI aggression and coordination adjust within a band toward a target win probability, and the adjustment is
  **always shown** in the game log.

Architecture: [02-technical-architecture.md §8](02-technical-architecture.md#8-ai-architecture).

---

## 19. Art & audio direction

* **Readable first:** a colourful, slightly stylized look in the Civ VI spirit (not photoreal). Clear silhouettes for districts, distinct civ
  palettes, and terrain that stays legible from max zoom. The **strategic view** (a painted-map look) is a first-class, fully playable view.
* Districts change visibly with each building. Great Rivers get animated flow and boats. Flooded lowlands show water at the edges, then
  submerged ruins. Climate phases tint the world subtly.
* Per-civ music themes evolve through four era arrangements of **the same theme**, which fits the "unbroken" fantasy.
* Two quality tiers: *Stylized* (low-spec, Steam Deck) and *Rich* (higher-fidelity lighting, more particles); both share the same assets.

---

## 20. Depth from Millennia & Shadow Empire, with Civ's ease

The game borrows the *stories* those games create (alternate-history ages, logistics that decide wars, production chains, leaders who are people,
an auto-written history) through an **Ease Charter**: automatic by default, surfaces instead of screens, shortages stall and never delete, and the AI plays it
or it ships off. A **Depth Dial** (Classic / Enhanced / Grand Strategy) sets granularity. Built now: **World Currents & Ages**, **Supply lens**, **Industries**,
**the Chronicle**, **Living Governors** (experience and traits from service), **Outposts** and **Unit Variants**. Planned: National Character, Private Enterprise, Battle Reports, Fog of Strength, World Genesis.
Full design: [09-genre-defining-depth.md](09-genre-defining-depth.md).

## Appendix A — Community request traceability

Status legend: **Built** = implemented and tested in this repository; **Designed** = specified in these documents, scheduled in [04-implementation-plan.md](04-implementation-plan.md).

| # | Request (forums, r/civ, CivFanatics) | Our answer | Status / milestone |
|---|---|---|---|
| 1 | Production queue (CQUI) | §4.4, `ProductionSystem`, queue UI | **Built** (sim + Godot panel) |
| 2 | Adjacency preview and map tacks (Detailed Map Tacks) | Placement lens + planner | **Built** (sim + lens) / tacks M2 |
| 3 | Navigable rivers | §3.2 Great Rivers | **Built** (mapgen, movement, River Port) |
| 4 | Direct IP multiplayer without online services | `HostSession`/`ClientSession`/TCP | **Built** |
| 5 | Fewer desyncs / recover instead of ending the game | State hashes + snapshot resync | **Built** |
| 6 | Reconnect to the same slot | Reconnect tokens | **Built** |
| 7 | Spectators | Spectator slots | **Built** |
| 8 | Mod mismatch errors that explain themselves | Content hash at Hello | **Built** |
| 9 | Data-driven modding with patches, not file overrides | `$op` patch / `$append` | **Built** |
| 10 | Loyalty transparency | Breakdown + turns-to-flip | **Built** |
| 11 | Ping-pong loyalty flips | Settling-in grace period | **Built** |
| 12 | More governor depth / tall play | Urban Planner, provinces, Metropolis tier | **Built** (governors) / M3 provinces |
| 13 | Power that matters, clean energy that reduces emissions | Grids + merit-order dispatch | **Built** |
| 14 | Climate you can fight | Recapture, reforestation, accords, barriers | **Built** (core) / M4 accords |
| 15 | Better report screens (Better Report Screen) | §17 overview screens | Designed — M2/M3 |
| 16 | Less religious spam | §7 charges, upkeep, cap | Designed — M4 |
| 17 | Engaging World Congress | §8.4 | Designed — M4 |
| 18 | Vassals, puppets, liberation | §4.5, §8.3 | Designed — M4 |
| 18b | Fair, itemized grievances; transparent attitudes; no surprise-war option | §8.1–8.2, [05/08-diplomacy](05-key-systems/08-diplomacy.md) | **Built** (war, peace, borders, grievances, attitude) |
| 19 | City and tile trading, research agreements | §8.3 | Designed — M4 |
| 20 | Espionage before the Renaissance | §9 Informants from the Classical era | Designed — M4 |
| 21 | Naval and air depth | §11 | Designed — M3/M4 |
| 22 | No dominant late-game super unit | Counter-tags, EW platoons | **Built** (counters applied in combat v1) |
| 22b | Combat preview that shows every modifier | [05/09-combat](05-key-systems/09-combat.md) | **Built** (v1: melee, ranged, cities, capture) |
| 23 | Timelapse replay and statistics | §14 | Designed — M5 |
| 24 | One More Turn after victory | §14, [05/11-victory](05-key-systems/11-victory.md) | **Built** (sim; victory screen in the client queue) |
| 25 | Smarter AI districts, navy, air, war | §18 + shared planners, [05/13](05-key-systems/13-ai.md) | Planner and AI v2 (expansion, builders, war odds, retreat, peace) **built** / navy and air M3–M5 |
| 26 | Late-game micromanagement relief | Provinces, queue templates, puppets | Designed — M3 |
| 27 | Era pacing so UUs matter (Extended Eras) | `EraPacingPercent` | **Built** |
| 28 | Colourblind modes, UI scaling, keyboard play | §16 | Designed — M2 |
| 29 | World Builder, TSL Earth | §3.3, §17 | Designed — M4/M5 |
| 30 | Faith useful late game | §7 faith projects | Designed — M4 |
| 31 | Plague mode | §12.3 | Designed — post-launch mode |
| 32 | Hotseat and async play | §15 | Hotseat M2 / async M5 |
| 33 | A late game that feels like the future (*Beyond Earth*-style affinities, but on Earth) | §6 The Divergence, [08](08-divergence-tech-tree.md) | **Built** (sim, data, AI, client screen); art M4 |
| 34 | Late-game worlds that look different, not just bigger numbers | Divergence terraforming, biome spread, sea reclamation | **Built** |
| 35 | Every game tells a different history (Millennia-style ages) | §20 World Currents & Ages | **Built** |
| 36 | Logistics that matter without micromanagement (Shadow Empire) | §20 Supply lens, attrition, river highways | **Built** |
| 37 | Economic depth beyond raw yields | §20 Industries (Steel, Plastics, Electronics) | **Built** |
| 38 | Remember the story of my civilization | §20 The Chronicle | **Built** |
| 39 | Leaders and governors with personality and history | §20 Living Governors, [05/02](05-key-systems/02-loyalty-governors.md#living-governors-experience-and-traits) | **Built** (experience, ranks, traits) / ageing M3 |
| 40 | Less late-game busywork for wide empires | Outposts ([05/12](05-key-systems/12-outposts.md)), Private Enterprise, provinces | Outposts **built** / rest M3 |

## Appendix B — Naming & IP hygiene

* The design discusses Civ VI mechanics by name for clarity: districts, adjacency, loyalty, governors, game modes. **Shipped content uses original
  names**: Academy (rather than "Campus"), Sanctuary, Market Quarter, Cultural Quarter, Foundry, Garrison, Arena Quarter, Civic Plaza, River Port; the governors
  The Steward, The Castellan and the others; and modes Trade Empires, Legends, Hidden Orders, Cataclysm, Contagion, Turbulent Ages and Tribal Clans.
* Civilizations and leaders are historical. Their abilities, agendas, unique units and unique districts are written fresh. No text, art, audio,
  UI layouts or data tables are copied from any commercial game.
* Generic genre terms (district, adjacency, loyalty, governor, builder, great people) are mechanics, not marks.
