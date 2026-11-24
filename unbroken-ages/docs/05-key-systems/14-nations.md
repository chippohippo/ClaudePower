# 14. Nations: signatures and leaders

There are **36 nations and 72 leaders**: the six below, and the thirty further nations after them.

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

## The thirty further nations

The data comes from `tools/assets/nations_data.py`, which writes the block between the MORE-NATIONS and MORE-LEADERS markers
in `civilizations.json`. The rules are in `Systems/NationSystem.Peoples.cs`.

| Nation | Signature | The rule, and how to play it | Leaders and their augments |
|---|---|---|---|
| **Rome** | **The Cursus Publicus** (`Imperium`) | Every Roman city makes +6% Production for each other Roman city within 6 tiles (up to +30%), and Roman land units have +1 movement inside Roman borders. *Build a dense, interlocking empire: every city you plant beside another makes both stronger, and your legions race along home roads.* | **Augustus**: The neighbourhood bonus applies to Culture as well, and reaches 8 tiles.<br>**Trajan**: Legions move +2 inside Roman borders and the bonus grows by 8% per city (up to 40%). |
| **Greece** | **The League of Cities** (`Polis`) | For every civilization at peace with Greece, every Greek city gains +6% Science and Culture. While Greece is at war, its melee units fight with +4 strength. *Diplomacy is your engine: keep many neighbours at peace and the poleis flourish; when war comes, the phalanx holds.* | **Pericles**: Each peace partner also adds +4% more Culture.<br>**Gorgo**: The phalanx fights with +9 strength at war. |
| **Zulu** | **The Horns of the Buffalo** (`Impi`) | Zulu melee units attack with +4 strength for every other Zulu melee unit next to the defender. Units are raised 25% faster, but Zulu cities make 20% less Science. *Fight in formation: surround the enemy and strike with the horns. A war economy that must keep moving.* | **Shaka**: +6 strength per comrade; units are raised 40% faster.<br>**Cetshwayo**: Units fight with +7 strength defending inside Zulu land; the Science penalty is only 10%. |
| **Norway** | **Sea Kings** (`Raiders`) | Every enemy unit a Norse unit destroys pays Gold worth 150% of its strength. Norse ships have +1 movement and +5 strength. *Raid for your treasury: strike from the sea, kill what you can catch, and spend the plunder at home.* | **Harald Hardrada**: Kills also pay Science worth 100% of the victim's strength.<br>**Cnut the Great**: Ships have +2 movement and +8 strength; raids pay 200%. |
| **Japan** | **The Way of the Warrior** (`Bushido`) | Japanese units fight at full strength however wounded: they never suffer the wounds penalty. *Fight to the last: a damaged Japanese army is as dangerous as a fresh one, so press attacks other nations would break off.* | **Tokugawa Ieyasu**: Units defending next to the coast fight with +6 strength.<br>**Hōjō Tokimune**: Units defending next to the coast fight with +10 strength. |
| **England** | **Workshop of the World** (`Workshop`) | Powered English cities make +25% Production, and every improved strategic resource yields 2 more each turn. *Industrialise first: dig coal, raise power plants and out-produce the world once the furnaces are lit.* | **Victoria**: Cities with a Harbor make +4 Gold; powered cities +35% Production.<br>**Elizabeth I**: Improved strategic resources yield 4 more each turn. |
| **France** | **La Grandeur** (`Grandeur`) | French borders grow twice as fast from Culture, and French cities make +15% Culture. *Out-shine your neighbours: culture claims the land before their settlers can, and the frontier moves your way.* | **Louis XIV**: +20% Production toward buildings; culture +25%.<br>**Catherine de' Medici**: Foreign cities within 6 tiles of a French city lose 2 loyalty a turn. |
| **Russia** | **The Endless Land** (`Winter`) | Every Russian city claims its whole second ring when founded. Tundra and snow yield +1 Food and +1 Production. Enemy units standing in Russian tundra or snow lose 10 HP a turn. *Spread wide into the cold: what others call wasteland feeds you, and invaders freeze in it.* | **Peter the Great**: Tundra and snow also yield +1 Science.<br>**Catherine the Great**: Invaders lose 20 HP a turn; cities claim out to the third ring. |
| **Persia** | **The Satrapies** (`Satrapy`) | Persian governors take 3 turns less to establish. Every governed city gains +3 loyalty a turn, +1 amenity and +15% Gold. *Govern everything: appoint and place governors early and widely, and the empire holds together where others fragment.* | **Cyrus the Great**: At war, Persian land units have +1 movement.<br>**Darius I**: Governed cities make +30% Gold and +5 loyalty a turn. |
| **Aztec** | **The Flower Wars** (`FlowerWar`) | Every enemy unit the Aztecs destroy adds Production worth 150% of its strength to the nearest Aztec city's current build, and +2 loyalty there. Each improved luxury gives an extra amenity. *War builds your cities: send armies out to take captives, and the temples rise at home.* | **Montezuma I**: Each improved luxury gives two extra amenities.<br>**Itzcoatl**: Captives give Production worth 250% of their strength. |
| **Maya** | **The Long Count** (`LongCount`) | Cities within 6 tiles of the Maya capital make +15% Food, Production, Science, Culture and Gold; cities farther away make 15% less. *Build tall and tight around the capital: a ring of great cities, and nothing left on the frontier.* | **K'inich Janaab Pakal**: The capital makes +4 Science; the realm reaches 7 tiles.<br>**Lady Six Sky**: Near cities make +20%, far cities only 5% less. |
| **Ethiopia** | **The Roof of Africa** (`Highland`) | Hills yield +2 Faith. Each turn 40% of Ethiopia's Faith income is also earned as Science and 20% as Culture. *Settle the highlands and keep the faith: devotion becomes learning and art.* | **Menelik II**: Units on hills fight with +6 strength.<br>**Ezana**: Faith becomes Science at 60% and Culture at 30%. |
| **Ottomans** | **Masters of the Siege** (`Siege`) | Ottoman units attack cities with +10 strength. Captured cities keep all their citizens and start at 75 loyalty. *Take cities, not just battles: your armies crack walls, and the cities you win stay whole.* | **Suleiman**: Captured cities start fully loyal.<br>**Mehmed II**: Units attack cities with +18 strength. |
| **Arabia** | **The House of Wisdom** (`Wisdom`) | Each turn a quarter of Arabia's Gold income goes to its scholars, returning 120% of it as Science. *Get rich to get clever: trade, markets and mines pay for the fastest research in the world.* | **Harun al-Rashid**: Gold becomes Science at 150%.<br>**Saladin**: Half the gold sent to the scholars also returns as Faith. |
| **Korea** | **Seowon** (`Seowon`) | Science adjacency bonuses are doubled, and mines yield +1 Science. *Place your academies with care and mine the hills: every district and quarry feeds the scholars.* | **Sejong the Great**: Every city makes +1 Science per 2 citizens.<br>**Seondeok**: Every city makes +1 Culture per 3 citizens; mines +2 Science. |
| **India** | **Stepwells** (`Stepwell`) | Cities by fresh water or the sea gain +3 Housing. Cities of 6 or more citizens give +2 Faith. *Build great cities: India out-grows its neighbours, and its largest cities become centres of faith.* | **Ashoka**: At peace, every city makes +15% Food; great cities give +4 Faith.<br>**Chandragupta Maurya**: At war, land units have +1 movement. |
| **Khmer** | **The Barays** (`Baray`) | Farms yield +1 Food, and farms beside a river also +1 Faith. *Irrigate everything: cover the river plains with farms and the reservoirs feed both bodies and spirits.* | **Jayavarman VII**: Every city gains +2 Housing.<br>**Suryavarman II**: Farms also yield +1 Culture. |
| **Netherlands** | **Polders** (`Polder`) | Coast tiles worked by Dutch cities yield +1 Food and +1 Production. River floods and storms never harm Dutch cities. *Make land from the sea: settle every shore and work the shallows as other nations work fields.* | **William of Orange**: Coastal cities make +3 Gold.<br>**Wilhelmina**: Coast tiles yield +2 Production. |
| **Portugal** | **Casa da Índia** (`Navigators`) | Portuguese cities may only be founded on the coast or a Great River. Ships have +2 movement. Every port city makes +3 Gold and +10% Science. *Live on the shore: a necklace of ports, fast ships and rich trade, never far from the sea.* | **Henry the Navigator**: Port cities make +25% Science.<br>**João III**: Port cities make +6 Gold; ships +3 movement. |
| **Spain** | **The Treasure Fleets** (`Treasure`) | Every city Spain captures pays 80 Gold per citizen. *Conquest pays for everything: take rich cities, and the treasure funds the next campaign.* | **Isabella I**: Captured cities also give 30 Faith per citizen.<br>**Philip II**: Spanish units attack with +5 strength; treasure is 120 Gold per citizen. |
| **Byzantium** | **The Themes** (`Themes`) | Every Byzantine unit fights with +1 strength for each city Byzantium owns (up to +10). Byzantine cities defend with +10 strength. *Every city is a recruiting ground: grow wide, and every soldier grows stronger; the walls almost never fall.* | **Justinian I**: Every city gains +3 loyalty a turn; walls +15.<br>**Basil II**: Mounted units fight with +6 more strength; the theme bonus reaches +14. |
| **Carthage** | **Hired Swords** (`Mercenaries`) | Carthage raises units 30% slower, but buys them 50% cheaper. Every port city makes +2 Gold. *Pay, don't draft: trade fills the treasury and the treasury hires the army, wherever it is needed.* | **Hannibal Barca**: Mounted units have +1 movement; units are bought 60% cheaper.<br>**Dido**: Port cities gain +2 Housing and +4 Gold. |
| **Babylon** | **Enuma Anu Enlil** (`Eureka`) | Babylonian cities make 40% less Science, but every building and district completed yields Science worth 60% of its Production cost. *Build to learn: discovery comes from construction, so keep every city building something.* | **Hammurabi**: Completions also yield Culture worth 30% of their cost.<br>**Nebuchadnezzar II**: +25% Production toward districts; completions yield 80% as Science. |
| **Kongo** | **Children of the Forest** (`Forest`) | Forest and rainforest tiles yield +1 Food, +1 Production and +1 Culture. *Keep the forest standing: settle in the woods and never clear them, for they give everything.* | **Mvemba a Nzinga**: Forest tiles yield +2 Culture.<br>**Nzinga Mbande**: Units in forest or rainforest fight with +7 strength. |
| **Poland** | **The Commonwealth** (`Commonwealth`) | When a Polish unit destroys an enemy within 4 tiles of a Polish city, the tiles around the fight join that city. *Win battles at the border and the border moves: every victory is a land grab.* | **Jadwiga**: Victories claim land two tiles around the fight, up to 6 tiles from a city.<br>**Jan III Sobieski**: Polish units fight with +6 strength inside Polish land. |
| **Scotland** | **The Scottish Enlightenment** (`Enlightenment`) | Each improved luxury near a Scottish city gives it +8% Science and Production (up to +30%). *Keep the people content and they invent and build: hunt down every luxury and improve it.* | **Robert the Bruce**: Units fight with +7 strength inside Scottish land.<br>**Saint Margaret**: Each luxury gives +12% (up to +40%). |
| **Brazil** | **Carnival** (`Carnival`) | Every 10 turns Brazil holds a Carnival for 2 turns: every city gains +3 amenities, and the nation earns Culture worth 6 per citizen. Rainforest tiles yield +1 Science. *Grow big and celebrate: carnivals carry your culture forward in great bursts, and the rainforest is your laboratory.* | **Pedro II**: Carnival comes every 8 turns.<br>**Getúlio Vargas**: During Carnival every city makes +40% Production. |
| **America** | **The Open Frontier** (`Frontier`) | American cities need 25% less Food to grow and have +2 Housing. *Grow fast and settle wide: cities balloon, so plan the amenities and the districts to keep up.* | **Abraham Lincoln**: Every city makes +15% Production.<br>**Theodore Roosevelt**: Every city makes +3 Culture; cities grow 35% faster. |
| **Vietnam** | **The Land Fights Back** (`Guerrilla`) | Vietnamese units standing in forest, rainforest, marsh or hills fight with +5 strength and move +1. *Fight where the land is wild: draw invaders into the jungle and hills, and never fight in the open.* | **Trưng Trắc**: Units in wild land fight with +9 strength.<br>**Lý Thường Kiệt**: Units in wild land move +2. |
| **Haudenosaunee** | **The Great Law of Peace** (`GreatLaw`) | The Confederacy may never declare war. While at peace with every civilization, every city makes +15% of every yield. Units and cities defend with +8 strength. *A league of peace: grow strong in harmony and make any aggressor regret the attempt.* | **Hiawatha**: At peace with all, every city makes +25% of every yield.<br>**Jigonhsasee**: At peace with all, every city gains +4 loyalty a turn; defenders +12. |

New engine hooks for these nations:
* combat lines in the strength breakdown, and city defence;
* empire-level yield conversion (Ethiopia's faith, Arabia's gold);
* growth thresholds (America) and border growth (France);
* founding rules (Portugal founds only on the coast; Russia claims its second ring);
* a nation that can never declare war (the Haudenosaunee);
* completions as discoveries (Babylon);
* extra strategic stockpiles (England);
* winter attrition (Russia) and carnivals (Brazil).

Each capital raises a landmark:
* pyramid: Egypt;
* pagoda: Song, Japan, Korea, Vietnam, Khmer;
* great ger: Mongolia;
* stepped temple (ushnu): Inca, Maya, Aztec, Babylon;
* mosque: Mali, Arabia, Ottomans, Persia;
* longhouse: Norway, Haudenosaunee;
* kraal: Zulu, Kongo;
* stele: Ethiopia, Carthage;
* campanile: everyone else.

Pre-industrial houses take regional building materials.

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

## Unique units

Every nation fields one unique unit, which replaces a generic unit. The nation can no longer build that generic unit (`ProductionSystem`:
"Replaced by your …"). A unique unit copies its generic's class, prerequisites, resources and upgrade path, then differs in one or two
telling ways. For example:
* Rome's Legion and Japan's Samurai: tougher.
* The Zulu Impi and the Kongo's Ngao Mbeba: need no iron.
* Russia's Cossack and Carthage's Numidian Cavalry: faster.
* Greece's Hoplite: strong against cavalry.
* Korea's Hwacha: long range but fragile.
* America's Sherman: fast and cheap.

The original six (Medjay, Great Galley, Fire Lance Corps, Keshig, Warak'aq, Mandekalu) are joined by 30 more, listed in `units.json`.
`RosterTests` checks that every nation has one, and that each betters what it replaces.



## Leaders of the World Wars

Twenty-four twentieth-century heads of state and government, famous and infamous, lead their nations. They carry the `WorldWars` tag.
They are generated by `tools/assets/wartime_leaders.py`, which:
* adds **Germany** and **Italy** as nations;
* renames *Song China* to **China** (its id and Mandate are unchanged);
* upgrades the milder Vargas and Wilhelmina that existed before.

Each leader's **doctrine** changes how the nation plays: a large bonus paired with a real cost.

**How they are presented:**
* Leaders appear as the historical heads of state they were, as in grand-strategy games.
* Titles are neutral and factual (for example "Chancellor of Germany", "Prime Minister of Italy", "General Secretary").
* The doctrines model each regime's military, economic and diplomatic strategy, with its historical costs (diplomatic isolation,
  rationing, upheaval).
* No mechanic rewards or depicts genocide or atrocities.
* No extremist iconography: Germany wears field grey and gold, Italy green and white.

### Germany and Italy

| Nation | Signature | Unique unit | Leaders |
|---|---|---|---|
| Germany | **The Engine of Europe** (`Ruhr`): +1 district slot in every city; +15% Production in cities with a Foundry; leaders tune its armour and fleet | Panzer (Tank: 84 strength, 5 moves) | Wilhelm II, Adolf Hitler |
| Italy | **Cities of Art** (`Rinascimento`): every wonder and great work in a city pays +2 Culture and +2 Gold; districts and wonders 15% faster | Condottieri (Horseman: tougher, cheaper) | Vittorio Emanuele Orlando, Benito Mussolini |

### All the leaders of the World Wars

| Nation | Leader | Doctrine (ability) | Augment |
|---|---|---|---|
| England | Winston Churchill, *The British Bulldog* | **We Shall Never Surrender**: Units +8 strength inside English borders. War weariness −60%. At war: +3 Loyalty and +15% Production in every city. But the war chest runs dry: −20% Gold always, and −10% Science in peacetime. | **Their Finest Hour**: Powered cities +40% Production; strategic resources yield 4 more. |
| France | Georges Clemenceau, *Le Tigre* | **Total War**: At war: +40% Production toward units, units +6 strength, war weariness −40%. The cost: −15% Culture always, and −1 Amenity in every city while at war. | **Guerre Jusqu'au Bout**: France's Culture bonus is spent on the war (no +15%); borders still grow 60% faster. |
| France | Charles de Gaulle, *Leader of Free France* | **A Certain Idea of France**: +25% Culture, +10% Science, +2 Loyalty in every city; +2 influence and +2 Diplomatic Favor a turn. But a small army: −20% Production toward units, and units −3 strength outside French borders. | **Grandeur**: French cities +30% Culture; borders grow 150% faster. |
| Russia | Joseph Stalin, *General Secretary* | **Five-Year Plans**: Forced industrialization: +25% Production in every city, +20% toward units, units +5 strength inside Russian borders. Its toll: −2 Amenities in every city, −30% Culture, −20% Gold, and +50% emissions. | **Scorched Earth**: Invaders in Russian tundra and snow lose 25 HP a turn. |
| Japan | Hideki Tojo, *Prime Minister of Japan* | **Total War Cabinet**: Units +8 strength outside Japanese borders; +40% Production toward units. The home front pays: −1 Amenity in every city at war, −20% Gold and −15% Culture, and war weariness +25%. | **Island Fortress**: Japanese coastal cities fight +10 stronger. |
| America | Franklin D. Roosevelt, *32nd President* | **Arsenal of Democracy**: Once at war: +25% Production in every city and +50% toward units. The New Deal: +1 Amenity and +1 Housing everywhere. But isolation in peacetime: −30% Production toward units while at peace. | **The New Deal**: American cities +15% Production and +3 Housing. |
| America | Woodrow Wilson, *28th President* | **Fourteen Points**: +4 Diplomatic Favor and +3 influence a turn; +2 Loyalty in every city. But no appetite for armies: −20% Production toward units. | **Self-Determination**: American cities need 30% less Food to grow. |
| Ottomans | Mustafa Kemal Atatürk, *Father of the Turks* | **Gallipoli**: Units +10 strength inside Ottoman borders; reforms bring +20% Science and +3 Loyalty in every city. But −50% Faith, and −15% Production toward units. | **The Republic**: Captured cities start fully loyal; attacks on cities +5 (not +10). |
| Poland | Józef Piłsudski, *First Marshal of Poland* | **Miracle on the Vistula**: Units +8 strength inside Polish borders; cavalry +4 more anywhere. But −15% Science and −10% Gold. | **Intermarium**: Victories claim land up to 8 tiles from Polish cities, two rings at a time. |
| Brazil | Getúlio Vargas, *Father of the Poor* | **Estado Novo**: State-led growth: +15% Production, +10% Gold and +2 Housing in every city. But −1 Loyalty a turn and −20% Culture everywhere. | **Fewer Festivals**: Carnival only every 20 turns, but cities make +50% Production during it. |
| Vietnam | Ho Chi Minh, *Uncle Ho* | **People's War**: Units +5 strength inside Vietnamese borders; war weariness −70%; +3 Loyalty in every city at war. But −15% Gold and −10% Science. | **The Long Resistance**: Units in forest, rainforest, marsh or hills fight +10 stronger and move +2. |
| Ethiopia | Haile Selassie, *Emperor of Ethiopia* | **Appeal to the League**: +4 Diplomatic Favor and +2 influence a turn; units +6 strength inside Ethiopian borders. But −15% Production. | **Highland Fortress**: Units on hills fight +8 stronger; 60% of Faith income becomes Science. |
| Netherlands | Wilhelmina, *Queen of the Netherlands* | **Radio Oranje**: +4 Loyalty a turn and +20% Gold in every city; war weariness −50%. But −25% Production toward units. | **Trade from Exile**: Coastal cities +3 Gold; coast tiles +2 Production. |
| Greece | Ioannis Metaxas, *Prime Minister of Greece* | **The Day of No**: Units +10 strength inside Greek borders; +3 Loyalty a turn and +20% Production toward units in every city. But −20% Culture everywhere, and −1 Amenity while at war. | **The Metaxas Line**: Melee units fight +10 at war; the bonus for peaceful neighbours is lost. |
| Norway | Haakon VII, *King of Norway* | **The Home Front**: Units +6 strength inside Norwegian borders; war weariness −50%; +2 Loyalty in every city. But −5% Production. | **The Merchant Fleet**: Norse ships +12 strength and +2 movement; plunder pays 100%. |
| Arabia | Faisal I, *Leader of the Arab Revolt* | **The Arab Revolt**: Units +6 strength outside Arab borders; cavalry +4 more; +3 influence a turn and +10% Gold. But −15% Production toward buildings. | **Desert Scholars**: 35% of Gold income becomes Science at 140%. |

### The engine behind the doctrines (`Systems/LeaderSystem.cs`)

* **Unit strength by situation.** `UnitStrength` modifiers on civilization and leader abilities now reach units. They can depend on:
  * `UnitInOwnTerritory` or `UnitInForeignTerritory` (fortress or expeditionary doctrines);
  * `OwnerAtWar` or `OwnerAtPeace`.

  They show as their own line in the combat preview, outside the +6 society cap.
* **War and peace for cities.** `OwnerAtPeace` joins `OwnerAtWar`: Roosevelt's isolation in peace and his arsenal in war are two
  modifiers.
* **Player-level effects:**
  * `WarWearinessPercent` scales the weariness the people *feel* (the amenity penalty and the AI's appetite for war), not the record of
    battles.
  * `InfluencePerTurn` adds influence toward city-state envoys.
  * `FavorPerTurn` adds Diplomatic Favor in the World Congress.

### Balance

Doctrines were tuned with a **paired soak**: 6 players, 250 turns, five seeds. Each nation played every seed twice, once under its
classic leader and once under the wartime one, against the same five opponents (Thutmose, Dandolo, Taizu, Genghis, Pachacuti), and
the two runs' scores were compared (`simulate --leaders`).

* **Noise:** the game's snowball makes single seeds swing by hundreds of points either way, so only consistent directions were acted on.
* **Changes made:**
  * Stalin lost his loyalty cost, which made his cities rebel until Russia vanished, and his bonuses were trimmed to +25% Production.
  * Tojo's home-front costs were softened, and his AI is less hawkish.
  * Metaxas's amenity cost now applies only at war; he was negative in four of five seeds.
  * Vargas's bonuses were trimmed, and Faisal's building cost was lightened.
* **Where they ended up:**
  * Most wartime leaders score between 0.7× and 1.2× their classic counterpart.
  * Stalin's ratio stays high (Peter, Russia's classic leader, is the weakest baseline), but his absolute score is mid-pack.
  * The AI plays the defensive doctrines passively. A human Churchill or Atatürk will get more from them.
