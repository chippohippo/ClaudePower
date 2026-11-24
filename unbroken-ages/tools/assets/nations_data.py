"""The thirty further nations and their sixty leaders (source for content/base/data/civilizations.json).

python3 tools/assets/nations_data.py   -> rewrites the block between the NATIONS-BEGIN/END markers in civilizations.json

Every leader's augment may only override params its nation's signature declares (NationTests checks this too).
"""
import json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
TARGET = os.path.normpath(os.path.join(HERE, "..", "..", "content", "base", "data", "civilizations.json"))


def flat(y, n, **req):
    m = {"effect": "CityYieldFlat", "yield": y, "amount": n}
    if req: m["requirements"] = [req]
    return m


def pct(y, n, **req):
    m = {"effect": "CityYieldPercent", "yield": y, "amount": n}
    if req: m["requirements"] = [req]
    return m


def prod(cat, n, **req):
    m = {"effect": "CityProductionPercent", "category": cat, "amount": n}
    if req: m["requirements"] = [req]
    return m


def eff(e, n, **req):
    m = {"effect": e, "amount": n}
    if req: m["requirements"] = [req]
    return m


CAP = {"type": "CityIsCapital"}
COAST = {"type": "CityIsCoastal"}
RIVER = {"type": "CityOnGreatRiver"}
WAR = {"type": "OwnerAtWar"}
FRONT = {"type": "CityOnFrontier"}


def big(n): return {"type": "CityMinPopulation", "value": n}


# (id, name, adjective, primary, secondary, cities, ability, signature, leaders)
# ability = (name, description, [modifiers]); signature = (kind, name, description, playstyle, params)
# leader = (id, name, epithet, ability, augment(name, description, params), agenda(name, desc, likes, dislikes), personality)
NATIONS = [
    ("CIV_ROME", "Rome", "Roman", "#8E1B1B", "#E8C15A",
     ["Roma", "Ostia", "Antium", "Cumae", "Aquileia", "Ravenna", "Puteoli", "Arretium", "Mediolanum", "Lugdunum"],
     ("Senatus Populusque", "+1 Production in every city.", [flat("Production", 1)]),
     ("Imperium", "The Cursus Publicus",
      "Every Roman city makes +6% Production for each other Roman city within 6 tiles (up to +30%), and Roman land units have +1 movement inside Roman borders.",
      "Build a dense, interlocking empire: every city you plant beside another makes both stronger, and your legions race along home roads.",
      {"percentPerCity": 6, "maxPercent": 30, "linkRange": 6, "homeMoves": 1, "cultureToo": 0}),
     [("LEADER_AUGUSTUS", "Augustus", "First Citizen", ("Found in Brick, Left in Marble", "+15% Production toward buildings.", [prod("Building", 15)]),
       ("The Golden Age of Letters", "The neighbourhood bonus applies to Culture as well, and reaches 8 tiles.", {"cultureToo": 1, "linkRange": 8}),
       ("Pax Augusta", "Likes peaceful, loyal neighbours; dislikes warmongers.", ["Peaceful", "HighLoyalty"], ["Warmonger"]), {"war": 0.8, "expansion": 1.3}),
      ("LEADER_TRAJAN", "Trajan", "Optimus Princeps", ("Column of Victory", "+10% Production toward units.", [prod("Unit", 10)]),
       ("The Dacian Roads", "Legions move +2 inside Roman borders and the bonus grows by 8% per city (up to 40%).", {"homeMoves": 2, "percentPerCity": 8, "maxPercent": 40}),
       ("Builder of the Empire", "Respects loyal realms; scorns cities in revolt.", ["HighLoyalty"], ["CitiesInRevolt"]), {"war": 1.3, "expansion": 1.4})]),

    ("CIV_GREECE", "Greece", "Greek", "#2B5FA8", "#F2F2F2",
     ["Athenai", "Sparta", "Korinthos", "Argos", "Thebai", "Delphoi", "Miletos", "Ephesos", "Syrakousai", "Rhodos"],
     ("Agora", "+1 Culture in every city.", [flat("Culture", 1)]),
     ("Polis", "The League of Cities",
      "For every civilization at peace with Greece, every Greek city gains +6% Science and Culture. While Greece is at war, its melee units fight with +4 strength.",
      "Diplomacy is your engine: keep many neighbours at peace and the poleis flourish; when war comes, the phalanx holds.",
      {"percentPerPeace": 6, "extraCulturePercent": 0, "phalanx": 4}),
     [("LEADER_PERICLES", "Pericles", "First Citizen of Athens", ("The Funeral Oration", "+2 Culture in the capital.", [flat("Culture", 2, **CAP)]),
       ("Golden Age of Athens", "Each peace partner also adds +4% more Culture.", {"extraCulturePercent": 4}),
       ("Delian Treasurer", "Likes trading partners; dislikes warmongers.", ["TradePartner"], ["Warmonger"]), {"war": 0.7, "science": 1.2}),
      ("LEADER_GORGO", "Gorgo", "Queen of Sparta", ("With Your Shield", "+10% Production toward units.", [prod("Unit", 10)]),
       ("The Agoge", "The phalanx fights with +9 strength at war.", {"phalanx": 9}),
       ("Laconic", "Respects the strong; scorns the peaceful.", ["HighLoyalty"], ["Peaceful"]), {"war": 1.5})]),

    ("CIV_ZULU", "Zulu", "Zulu", "#1E1E1E", "#E2B33C",
     ["Ulundi", "KwaBulawayo", "Nobamba", "Dukuza", "Esikhawini", "Mlambongwenya", "Nodwengu", "Ondini", "Emahlabathini", "Esiklebheni"],
     ("Amabutho", "+1 Loyalty per turn in all cities.", [eff("CityLoyaltyPerTurn", 1)]),
     ("Impi", "The Horns of the Buffalo",
      "Zulu melee units attack with +4 strength for every other Zulu melee unit next to the defender. Units are raised 25% faster, but Zulu cities make 20% less Science.",
      "Fight in formation: surround the enemy and strike with the horns. A war economy that must keep moving.",
      {"hornsPerComrade": 4, "unitProduction": 25, "sciencePenalty": 20, "homeDefense": 0}),
     [("LEADER_SHAKA", "Shaka", "Founder of the Zulu Kingdom", ("The Iklwa", "+10% Production toward units.", [prod("Unit", 10)]),
       ("The Bull's Chest", "+6 strength per comrade; units are raised 40% faster.", {"hornsPerComrade": 6, "unitProduction": 40}),
       ("Builder of Impis", "Respects strength; scorns the peaceful.", ["HighLoyalty"], ["Peaceful"]), {"war": 1.8, "expansion": 1.1}),
      ("LEADER_CETSHWAYO", "Cetshwayo", "Victor of Isandlwana", ("Royal Kraal", "+2 Production in the capital.", [flat("Production", 2, **CAP)]),
       ("Defence of the Kingdom", "Units fight with +7 strength defending inside Zulu land; the Science penalty is only 10%.", {"homeDefense": 7, "sciencePenalty": 10}),
       ("Defender of the Kingdom", "Dislikes warmongers.", ["Peaceful"], ["Warmonger"]), {"war": 1.1})]),

    ("CIV_NORWAY", "Norway", "Norse", "#24476B", "#D9D2BF",
     ["Nidaros", "Bjørgvin", "Hamar", "Kaupangen", "Stavanger", "Tønsberg", "Borg", "Oslo", "Ålesund", "Lade"],
     ("Fjord Harbours", "+2 Production in coastal cities.", [flat("Production", 2, **COAST)]),
     ("Raiders", "Sea Kings",
      "Every enemy unit a Norse unit destroys pays Gold worth 150% of its strength. Norse ships have +1 movement and +5 strength.",
      "Raid for your treasury: strike from the sea, kill what you can catch, and spend the plunder at home.",
      {"goldPercent": 150, "sciencePercent": 0, "navalMoves": 1, "navalStrength": 5}),
     [("LEADER_HARALD", "Harald Hardrada", "The Last Viking", ("Varangian Gold", "+1 Gold in every city.", [flat("Gold", 1)]),
       ("Thunderbolt of the North", "Kills also pay Science worth 100% of the victim's strength.", {"sciencePercent": 100}),
       ("Last of the Vikings", "Respects strength; scorns the peaceful.", ["HighLoyalty"], ["Peaceful"]), {"war": 1.6, "naval": 1.6}),
      ("LEADER_CNUT", "Cnut the Great", "King of the North Sea Empire", ("North Sea Empire", "+25% Production toward units in coastal cities.", [prod("Unit", 25, **COAST)]),
       ("Lord of Three Crowns", "Ships have +2 movement and +8 strength; raids pay 200%.", {"navalMoves": 2, "navalStrength": 8, "goldPercent": 200}),
       ("Lord of Many Lands", "Likes trading partners; dislikes those in revolt.", ["TradePartner"], ["CitiesInRevolt"]), {"war": 1.2, "naval": 1.8})]),

    ("CIV_JAPAN", "Japan", "Japanese", "#C8102E", "#FFFFFF",
     ["Kyōto", "Kamakura", "Nara", "Ōsaka", "Edo", "Sakai", "Nagasaki", "Hakata", "Sendai", "Kanazawa"],
     ("Shrines of the Islands", "+1 Faith and +1 Culture in coastal cities.", [flat("Faith", 1, **COAST), flat("Culture", 1, **COAST)]),
     ("Bushido", "The Way of the Warrior",
      "Japanese units fight at full strength however wounded: they never suffer the wounds penalty.",
      "Fight to the last: a damaged Japanese army is as dangerous as a fresh one, so press attacks other nations would break off.",
      {"coastDefense": 0}),
     [("LEADER_TOKUGAWA", "Tokugawa Ieyasu", "Founder of the Shogunate", ("Sankin-kōtai", "+3 Loyalty per turn in all cities.", [eff("CityLoyaltyPerTurn", 3)]),
       ("The Great Peace", "Units defending next to the coast fight with +6 strength.", {"coastDefense": 6}),
       ("Unifier", "Respects loyal realms; scorns cities in revolt.", ["HighLoyalty"], ["CitiesInRevolt"]), {"war": 1.0, "expansion": 1.1}),
      ("LEADER_HOJO", "Hōjō Tokimune", "Regent of Kamakura", ("Zen Discipline", "+1 Faith in every city.", [flat("Faith", 1)]),
       ("Divine Wind", "Units defending next to the coast fight with +10 strength.", {"coastDefense": 10}),
       ("Guardian of the Islands", "Dislikes warmongers.", ["Peaceful"], ["Warmonger"]), {"war": 1.2})]),

    ("CIV_ENGLAND", "England", "English", "#B22234", "#1C2E5C",
     ["London", "York", "Nottingham", "Bristol", "Manchester", "Liverpool", "Newcastle", "Birmingham", "Leeds", "Plymouth"],
     ("Royal Navy Dockyards", "+20% Production toward units in coastal cities.", [prod("Unit", 20, **COAST)]),
     ("Workshop", "Workshop of the World",
      "Powered English cities make +25% Production, and every improved strategic resource yields 2 more each turn.",
      "Industrialise first: dig coal, raise power plants and out-produce the world once the furnaces are lit.",
      {"poweredProduction": 25, "strategicBonus": 2, "harborGold": 0}),
     [("LEADER_VICTORIA", "Victoria", "Empress of India", ("The Empire on Which the Sun Never Sets", "+2 Gold in coastal cities.", [flat("Gold", 2, **COAST)]),
       ("Pax Britannica", "Cities with a Harbor make +4 Gold; powered cities +35% Production.", {"harborGold": 4, "poweredProduction": 35}),
       ("Empire Builder", "Likes trading partners; dislikes blockades.", ["TradePartner"], ["Blockade"]), {"war": 1.1, "naval": 1.5, "gold": 1.2}),
      ("LEADER_ELIZABETH", "Elizabeth I", "Gloriana", ("Sea Dogs", "+1 Gold in every city.", [flat("Gold", 1)]),
       ("Drake's Legacy", "Improved strategic resources yield 4 more each turn.", {"strategicBonus": 4}),
       ("Virgin Queen", "Likes trading partners; dislikes warmongers.", ["TradePartner"], ["Warmonger"]), {"naval": 1.6, "gold": 1.3})]),

    ("CIV_FRANCE", "France", "French", "#1F3F8C", "#F4E9C8",
     ["Paris", "Orléans", "Lyon", "Reims", "Tours", "Marseille", "Bordeaux", "Rouen", "Toulouse", "Chartres"],
     ("Salons", "+1 Culture in cities of population 3 or more.", [flat("Culture", 1, type="CityMinPopulation", value=3)]),
     ("Grandeur", "La Grandeur",
      "French borders grow twice as fast from Culture, and French cities make +15% Culture.",
      "Out-shine your neighbours: culture claims the land before their settlers can, and the frontier moves your way.",
      {"borderPercent": 100, "culturePercent": 15, "buildingProduction": 0, "foreignPressure": 0}),
     [("LEADER_LOUIS_XIV", "Louis XIV", "The Sun King", ("Versailles", "+3 Culture in the capital.", [flat("Culture", 3, **CAP)]),
       ("L'État, c'est moi", "+20% Production toward buildings; culture +25%.", {"buildingProduction": 20, "culturePercent": 25}),
       ("Le Roi Soleil", "Likes loyal, splendid realms; scorns cities in revolt.", ["HighLoyalty"], ["CitiesInRevolt"]), {"war": 1.0, "gold": 1.2}),
      ("LEADER_CATHERINE_MEDICI", "Catherine de' Medici", "Queen Mother", ("Flying Squadron", "+1 Gold in every city.", [flat("Gold", 1)]),
       ("The Black Queen's Court", "Foreign cities within 6 tiles of a French city lose 2 loyalty a turn.", {"foreignPressure": 2}),
       ("Schemer", "Likes trading partners; dislikes the peaceful.", ["TradePartner"], ["Peaceful"]), {"war": 0.9, "science": 1.1})]),

    ("CIV_RUSSIA", "Russia", "Russian", "#2A6E3F", "#E9D9A6",
     ["Moskva", "Novgorod", "Kiev", "Vladimir", "Tver", "Smolensk", "Pskov", "Kazan", "Sankt-Peterburg", "Arkhangelsk"],
     ("Mother Russia", "+1 Production in every city.", [flat("Production", 1)]),
     ("Winter", "The Endless Land",
      "Every Russian city claims its whole second ring when founded. Tundra and snow yield +1 Food and +1 Production. Enemy units standing in Russian tundra or snow lose 10 HP a turn.",
      "Spread wide into the cold: what others call wasteland feeds you, and invaders freeze in it.",
      {"claimRadius": 2, "tundraFood": 1, "tundraProduction": 1, "tundraScience": 0, "winterDamage": 10}),
     [("LEADER_PETER", "Peter the Great", "Tsar of All the Russias", ("Window on the West", "+10% Science.", [pct("Science", 10)]),
       ("Grand Embassy", "Tundra and snow also yield +1 Science.", {"tundraScience": 1}),
       ("Westerniser", "Likes scholars; dislikes the backward and warlike.", ["HighScience"], ["Warmonger"]), {"science": 1.3, "expansion": 1.3}),
      ("LEADER_CATHERINE_GREAT", "Catherine the Great", "Empress of Russia", ("Hermitage", "+2 Culture in the capital.", [flat("Culture", 2, **CAP)]),
       ("General Winter", "Invaders lose 20 HP a turn; cities claim out to the third ring.", {"winterDamage": 20, "claimRadius": 3}),
       ("Enlightened Despot", "Respects loyal realms; scorns warmongers.", ["HighLoyalty"], ["Warmonger"]), {"war": 1.2, "expansion": 1.5})]),

    ("CIV_PERSIA", "Persia", "Persian", "#5B2A86", "#E6C46A",
     ["Pasargadae", "Persepolis", "Susa", "Ekbatana", "Babylon", "Sardis", "Bactra", "Hamadan", "Tarsus", "Gordion"],
     ("Royal Road", "+1 Gold in every city.", [flat("Gold", 1)]),
     ("Satrapy", "The Satrapies",
      "Persian governors take 3 turns less to establish. Every governed city gains +3 loyalty a turn, +1 amenity and +15% Gold.",
      "Govern everything: appoint and place governors early and widely, and the empire holds together where others fragment.",
      {"establishFaster": 3, "governedLoyalty": 3, "governedGold": 15, "warMoves": 0}),
     [("LEADER_CYRUS", "Cyrus the Great", "King of the Four Corners", ("Liberator of Babylon", "+2 Loyalty per turn in all cities.", [eff("CityLoyaltyPerTurn", 2)]),
       ("Fall of Babylon", "At war, Persian land units have +1 movement.", {"warMoves": 1}),
       ("Liberator", "Respects loyal realms; scorns cities in revolt.", ["HighLoyalty"], ["CitiesInRevolt"]), {"war": 1.3, "expansion": 1.2}),
      ("LEADER_DARIUS", "Darius I", "King of Kings", ("The Daric", "+10% Gold.", [pct("Gold", 10)]),
       ("Twenty Satrapies", "Governed cities make +30% Gold and +5 loyalty a turn.", {"governedGold": 30, "governedLoyalty": 5}),
       ("Administrator", "Likes trading partners; dislikes blockades.", ["TradePartner"], ["Blockade"]), {"gold": 1.4})]),

    ("CIV_AZTEC", "Aztec", "Aztec", "#0E7C7B", "#D9A400",
     ["Tenochtitlan", "Texcoco", "Tlacopan", "Tlatelolco", "Xochimilco", "Chalco", "Coyoacán", "Iztapalapa", "Culhuacan", "Tlaxcala"],
     ("Chinampas", "+1 Food in cities on a Great River.", [flat("Food", 1, **RIVER)]),
     ("FlowerWar", "The Flower Wars",
      "Every enemy unit the Aztecs destroy adds Production worth 150% of its strength to the nearest Aztec city's current build, and +2 loyalty there. Each improved luxury gives an extra amenity.",
      "War builds your cities: send armies out to take captives, and the temples rise at home.",
      {"productionPercent": 150, "loyaltyPerCaptive": 2, "amenityPerLuxury": 1}),
     [("LEADER_MONTEZUMA", "Montezuma I", "The Angry Lord", ("Tribute Lists", "+1 Gold in every city.", [flat("Gold", 1)]),
       ("Lord of Luxuries", "Each improved luxury gives two extra amenities.", {"amenityPerLuxury": 2}),
       ("Tlatoani", "Respects strength; scorns the peaceful.", ["HighLoyalty"], ["Peaceful"]), {"war": 1.6}),
      ("LEADER_ITZCOATL", "Itzcoatl", "Obsidian Serpent", ("Triple Alliance", "+15% Production toward districts.", [prod("District", 15)]),
       ("Burning of the Books", "Captives give Production worth 250% of their strength.", {"productionPercent": 250}),
       ("Founder of the Alliance", "Likes loyal realms; dislikes those in revolt.", ["HighLoyalty"], ["CitiesInRevolt"]), {"war": 1.4, "expansion": 1.2})]),

    ("CIV_MAYA", "Maya", "Maya", "#1F6E5A", "#F0C987",
     ["Mutal", "Kaanul", "Lakamha'", "Uxwitza'", "Oxwitik", "Yaxchilan", "Calakmul", "Chichén Itzá", "Copán", "Uxmal"],
     ("Observatories", "+1 Science in every city.", [flat("Science", 1)]),
     ("LongCount", "The Long Count",
      "Cities within 6 tiles of the Maya capital make +15% Food, Production, Science, Culture and Gold; cities farther away make 15% less.",
      "Build tall and tight around the capital: a ring of great cities, and nothing left on the frontier.",
      {"radius": 6, "nearPercent": 15, "farPenalty": 15, "capitalScience": 0}),
     [("LEADER_PAKAL", "K'inich Janaab Pakal", "Lord of Palenque", ("Temple of the Inscriptions", "+3 Culture in the capital.", [flat("Culture", 3, **CAP)]),
       ("Return of the Sun", "The capital makes +4 Science; the realm reaches 7 tiles.", {"capitalScience": 4, "radius": 7}),
       ("Astronomer King", "Likes scholars; dislikes warmongers.", ["HighScience"], ["Warmonger"]), {"science": 1.3, "war": 0.8}),
      ("LEADER_SIX_SKY", "Lady Six Sky", "Queen of Naranjo", ("Warrior Queen", "+10% Production toward units.", [prod("Unit", 10)]),
       ("Star Wars of Naranjo", "Near cities make +20%, far cities only 5% less.", {"nearPercent": 20, "farPenalty": 5}),
       ("Restorer of Naranjo", "Respects strength; scorns the peaceful.", ["HighLoyalty"], ["Peaceful"]), {"war": 1.4})]),

    ("CIV_ETHIOPIA", "Ethiopia", "Ethiopian", "#1E7A3C", "#F2C230",
     ["Aksum", "Adulis", "Lalibela", "Gondar", "Harar", "Debre Berhan", "Yeha", "Matara", "Qohaito", "Addis Ababa"],
     ("Highland Churches", "+1 Faith in every city.", [flat("Faith", 1)]),
     ("Highland", "The Roof of Africa",
      "Hills yield +2 Faith. Each turn 40% of Ethiopia's Faith income is also earned as Science and 20% as Culture.",
      "Settle the highlands and keep the faith: devotion becomes learning and art.",
      {"hillFaith": 2, "faithToScience": 40, "faithToCulture": 20, "hillStrength": 0}),
     [("LEADER_MENELIK", "Menelik II", "Victor of Adwa", ("Adwa", "+2 Loyalty per turn in all cities.", [eff("CityLoyaltyPerTurn", 2)]),
       ("Defence of the Highlands", "Units on hills fight with +6 strength.", {"hillStrength": 6}),
       ("Modernizer", "Likes scholars; dislikes warmongers.", ["HighScience"], ["Warmonger"]), {"war": 1.1, "science": 1.1}),
      ("LEADER_EZANA", "Ezana", "King of Aksum", ("Obelisks of Aksum", "+2 Culture in the capital.", [flat("Culture", 2, **CAP)]),
       ("Conversion of Aksum", "Faith becomes Science at 60% and Culture at 30%.", {"faithToScience": 60, "faithToCulture": 30}),
       ("Trader of the Red Sea", "Likes trading partners.", ["TradePartner"], ["Blockade"]), {"gold": 1.2, "science": 1.2})]),

    ("CIV_OTTOMAN", "Ottomans", "Ottoman", "#9E1B32", "#F5F0E1",
     ["İstanbul", "Bursa", "Edirne", "Konya", "Bağdat", "Halep", "Şam", "Kahire", "Selanik", "Trabzon"],
     ("Janissary Corps", "+10% Production toward units.", [prod("Unit", 10)]),
     ("Siege", "Masters of the Siege",
      "Ottoman units attack cities with +10 strength. Captured cities keep all their citizens and start at 75 loyalty.",
      "Take cities, not just battles: your armies crack walls, and the cities you win stay whole.",
      {"vsCity": 10, "capturedLoyalty": 75}),
     [("LEADER_SULEIMAN", "Suleiman", "The Lawgiver", ("Kanun", "+2 Loyalty per turn in all cities.", [eff("CityLoyaltyPerTurn", 2)]),
       ("The Magnificent", "Captured cities start fully loyal.", {"capturedLoyalty": 100}),
       ("Lawgiver", "Respects loyal realms; scorns cities in revolt.", ["HighLoyalty"], ["CitiesInRevolt"]), {"war": 1.3, "gold": 1.2}),
      ("LEADER_MEHMED", "Mehmed II", "The Conqueror", ("Great Bombards", "+15% Production toward units.", [prod("Unit", 15)]),
       ("Fall of Constantinople", "Units attack cities with +18 strength.", {"vsCity": 18}),
       ("Conqueror", "Respects strength; scorns the peaceful.", ["HighLoyalty"], ["Peaceful"]), {"war": 1.7})]),

    ("CIV_ARABIA", "Arabia", "Arabian", "#0B6E3C", "#F2F2E6",
     ["Baghdad", "Dimashq", "Al-Qahira", "Makkah", "Al-Madina", "Al-Basra", "Al-Kufa", "Halab", "Qurtuba", "Fas"],
     ("Caravanserais", "+1 Gold in every city.", [flat("Gold", 1)]),
     ("Wisdom", "The House of Wisdom",
      "Each turn a quarter of Arabia's Gold income goes to its scholars, returning 120% of it as Science.",
      "Get rich to get clever: trade, markets and mines pay for the fastest research in the world.",
      {"goldToScience": 25, "conversionPercent": 120, "goldToFaith": 0}),
     [("LEADER_HARUN", "Harun al-Rashid", "The Rightly Guided", ("A Thousand and One Nights", "+2 Culture in the capital.", [flat("Culture", 2, **CAP)]),
       ("Bayt al-Hikma", "Gold becomes Science at 150%.", {"conversionPercent": 150}),
       ("Patron of Scholars", "Likes scholars; dislikes warmongers.", ["HighScience"], ["Warmonger"]), {"science": 1.4, "gold": 1.2}),
      ("LEADER_SALADIN", "Saladin", "Sultan of Egypt and Syria", ("Chivalry", "+2 Loyalty per turn in all cities.", [eff("CityLoyaltyPerTurn", 2)]),
       ("Righteousness of the Faith", "Half the gold sent to the scholars also returns as Faith.", {"goldToFaith": 50}),
       ("Chivalrous", "Respects loyal realms; scorns the treacherous.", ["HighLoyalty"], ["Warmonger"]), {"war": 1.2, "science": 1.1})]),

    ("CIV_KOREA", "Korea", "Korean", "#1F4E9E", "#E63946",
     ["Hanseong", "Gyeongju", "Pyongyang", "Gaegyeong", "Jeonju", "Gwangju", "Daegu", "Busan", "Suwon", "Cheongju"],
     ("Hwacha Arsenals", "+1 Production in every city.", [flat("Production", 1)]),
     ("Seowon", "Seowon",
      "Science adjacency bonuses are doubled, and mines yield +1 Science.",
      "Place your academies with care and mine the hills: every district and quarry feeds the scholars.",
      {"scienceAdjacency": 100, "mineScience": 1, "sciencePerPop": 0, "culturePerPop": 0}),
     [("LEADER_SEJONG", "Sejong the Great", "Creator of Hangul", ("Hall of Worthies", "+10% Science.", [pct("Science", 10)]),
       ("Hangul", "Every city makes +1 Science per 2 citizens.", {"sciencePerPop": 2}),
       ("Scholar King", "Likes scholars; dislikes warmongers.", ["HighScience"], ["Warmonger"]), {"science": 1.5, "war": 0.7}),
      ("LEADER_SEONDEOK", "Seondeok", "Queen of Silla", ("Cheomseongdae", "+2 Science in the capital.", [flat("Science", 2, **CAP)]),
       ("Hwarang", "Every city makes +1 Culture per 3 citizens; mines +2 Science.", {"culturePerPop": 3, "mineScience": 2}),
       ("Patron of the Arts", "Likes loyal, peaceful realms.", ["Peaceful", "HighLoyalty"], ["Warmonger"]), {"science": 1.3, "growth": 1.1})]),

    ("CIV_INDIA", "India", "Indian", "#E87722", "#0F6E46",
     ["Pataliputra", "Varanasi", "Ujjain", "Taxila", "Mathura", "Kannauj", "Delhi", "Madurai", "Kanchipuram", "Vijayanagara"],
     ("Monsoon Harvest", "+1 Food in cities on a Great River.", [flat("Food", 1, **RIVER)]),
     ("Stepwell", "Stepwells",
      "Cities by fresh water or the sea gain +3 Housing. Cities of 6 or more citizens give +2 Faith.",
      "Build great cities: India out-grows its neighbours, and its largest cities become centres of faith.",
      {"waterHousing": 3, "faithPopulation": 6, "bigCityFaith": 2, "peaceFood": 0, "warMoves": 0}),
     [("LEADER_ASHOKA", "Ashoka", "The Beloved of the Gods", ("Edicts of Dhamma", "+2 Loyalty per turn in all cities.", [eff("CityLoyaltyPerTurn", 2)]),
       ("Dhamma", "At peace, every city makes +15% Food; great cities give +4 Faith.", {"peaceFood": 15, "bigCityFaith": 4}),
       ("Renouncer of War", "Likes the peaceful; scorns warmongers.", ["Peaceful"], ["Warmonger"]), {"war": 0.5, "growth": 1.4}),
      ("LEADER_CHANDRAGUPTA", "Chandragupta Maurya", "Founder of the Maurya", ("Arthashastra", "+10% Production toward units.", [prod("Unit", 10)]),
       ("Conquest of the Nanda", "At war, land units have +1 movement.", {"warMoves": 1}),
       ("Imperial Ambition", "Respects strength; scorns the peaceful.", ["HighLoyalty"], ["Peaceful"]), {"war": 1.5, "expansion": 1.3})]),

    ("CIV_KHMER", "Khmer", "Khmer", "#7A3E9D", "#E8C766",
     ["Yasodharapura", "Hariharalaya", "Koh Ker", "Banteay Srei", "Phimai", "Preah Khan", "Sambor Prei Kuk", "Angkor Borei", "Lopburi", "Wat Phu"],
     ("Temple Cities", "+1 Faith in every city.", [flat("Faith", 1)]),
     ("Baray", "The Barays",
      "Farms yield +1 Food, and farms beside a river also +1 Faith.",
      "Irrigate everything: cover the river plains with farms and the reservoirs feed both bodies and spirits.",
      {"farmFood": 1, "riverFarmFaith": 1, "farmCulture": 0, "housing": 0}),
     [("LEADER_JAYAVARMAN", "Jayavarman VII", "Builder of Hospitals", ("102 Hospitals", "+1 Amenity in every city.", [eff("CityAmenities", 1)]),
       ("Bayon", "Every city gains +2 Housing.", {"housing": 2}),
       ("Compassionate King", "Likes the peaceful; scorns warmongers.", ["Peaceful"], ["Warmonger"]), {"growth": 1.4, "war": 0.7}),
      ("LEADER_SURYAVARMAN", "Suryavarman II", "Builder of Angkor Wat", ("Angkor Wat", "+3 Faith in the capital.", [flat("Faith", 3, **CAP)]),
       ("Churning of the Ocean", "Farms also yield +1 Culture.", {"farmCulture": 1}),
       ("God-King", "Respects loyal realms; scorns cities in revolt.", ["HighLoyalty"], ["CitiesInRevolt"]), {"war": 1.1})]),

    ("CIV_NETHERLANDS", "Netherlands", "Dutch", "#E36C0A", "#1F3A93",
     ["Amsterdam", "Rotterdam", "Utrecht", "Leiden", "Haarlem", "Delft", "Groningen", "Middelburg", "Den Haag", "Dordrecht"],
     ("Grachten", "+1 Gold in coastal cities.", [flat("Gold", 1, **COAST)]),
     ("Polder", "Polders",
      "Coast tiles worked by Dutch cities yield +1 Food and +1 Production. River floods and storms never harm Dutch cities.",
      "Make land from the sea: settle every shore and work the shallows as other nations work fields.",
      {"seaFood": 1, "seaProduction": 1, "coastalGold": 0}),
     [("LEADER_WILLIAM", "William of Orange", "Father of the Fatherland", ("Je Maintiendrai", "+2 Loyalty per turn in all cities.", [eff("CityLoyaltyPerTurn", 2)]),
       ("Sea Beggars", "Coastal cities make +3 Gold.", {"coastalGold": 3}),
       ("Stadtholder", "Likes trading partners; dislikes blockades.", ["TradePartner"], ["Blockade"]), {"gold": 1.3, "naval": 1.4}),
      ("LEADER_WILHELMINA", "Wilhelmina", "Queen of the Netherlands", ("Radio Oranje", "+1 Culture in every city.", [flat("Culture", 1)]),
       ("The Great Dikes", "Coast tiles yield +2 Production.", {"seaProduction": 2}),
       ("Steadfast", "Likes the peaceful; scorns warmongers.", ["Peaceful"], ["Warmonger"]), {"growth": 1.2, "war": 0.8})]),

    ("CIV_PORTUGAL", "Portugal", "Portuguese", "#006A4E", "#D21034",
     ["Lisboa", "Porto", "Coimbra", "Braga", "Évora", "Lagos", "Faro", "Sagres", "Funchal", "Angra"],
     ("Caravels", "+25% Production toward units in coastal cities.", [prod("Unit", 25, **COAST)]),
     ("Navigators", "Casa da Índia",
      "Portuguese cities may only be founded on the coast or a Great River. Ships have +2 movement. Every port city makes +3 Gold and +10% Science.",
      "Live on the shore: a necklace of ports, fast ships and rich trade, never far from the sea.",
      {"navalMoves": 2, "portGold": 3, "portScience": 10}),
     [("LEADER_HENRY", "Henry the Navigator", "Infante of Sagres", ("School of Sagres", "+2 Science in coastal cities.", [flat("Science", 2, **COAST)]),
       ("Cartographers", "Port cities make +25% Science.", {"portScience": 25}),
       ("Explorer", "Likes scholars and trading partners.", ["HighScience", "TradePartner"], ["Blockade"]), {"science": 1.3, "naval": 1.5}),
      ("LEADER_JOAO", "João III", "The Pious", ("Carreira da Índia", "+1 Gold in every city.", [flat("Gold", 1)]),
       ("The Spice Monopoly", "Port cities make +6 Gold; ships +3 movement.", {"portGold": 6, "navalMoves": 3}),
       ("Merchant King", "Likes trading partners; dislikes blockades.", ["TradePartner"], ["Blockade"]), {"gold": 1.5, "naval": 1.4})]),

    ("CIV_SPAIN", "Spain", "Spanish", "#AA151B", "#F1BF00",
     ["Toledo", "Madrid", "Sevilla", "Córdoba", "Salamanca", "Valladolid", "Burgos", "Zaragoza", "Granada", "Valencia"],
     ("Tercios", "+10% Production toward units.", [prod("Unit", 10)]),
     ("Treasure", "The Treasure Fleets",
      "Every city Spain captures pays 80 Gold per citizen.",
      "Conquest pays for everything: take rich cities, and the treasure funds the next campaign.",
      {"goldPerPop": 80, "faithPerPop": 0, "attackStrength": 0}),
     [("LEADER_ISABELLA", "Isabella I", "The Catholic", ("Reconquista", "+1 Faith in every city.", [flat("Faith", 1)]),
       ("The Catholic Monarchs", "Captured cities also give 30 Faith per citizen.", {"faithPerPop": 30}),
       ("Most Catholic", "Respects loyal realms; scorns cities in revolt.", ["HighLoyalty"], ["CitiesInRevolt"]), {"war": 1.3, "expansion": 1.3}),
      ("LEADER_PHILIP", "Philip II", "King of Spain and Portugal", ("El Escorial", "+2 Gold in the capital.", [flat("Gold", 2, **CAP)]),
       ("Invincible Armada", "Spanish units attack with +5 strength; treasure is 120 Gold per citizen.", {"attackStrength": 5, "goldPerPop": 120}),
       ("Counter-Reformer", "Respects strength; scorns the peaceful.", ["HighLoyalty"], ["Peaceful"]), {"war": 1.6})]),

    ("CIV_BYZANTIUM", "Byzantium", "Byzantine", "#6A1B9A", "#D4AF37",
     ["Konstantinoupolis", "Thessalonike", "Nikaia", "Trapezous", "Antiocheia", "Smyrna", "Ankyra", "Nikomedeia", "Ravenna", "Mystras"],
     ("Hippodrome", "+1 Amenity in the capital.", [eff("CityAmenities", 1, **CAP)]),
     ("Themes", "The Themes",
      "Every Byzantine unit fights with +1 strength for each city Byzantium owns (up to +10). Byzantine cities defend with +10 strength.",
      "Every city is a recruiting ground: grow wide, and every soldier grows stronger; the walls almost never fall.",
      {"strengthPerCity": 1, "maxStrength": 10, "cityDefense": 10, "mountedStrength": 0, "loyalty": 0}),
     [("LEADER_JUSTINIAN", "Justinian I", "The Lawgiver", ("Hagia Sophia", "+3 Faith in the capital.", [flat("Faith", 3, **CAP)]),
       ("Corpus Juris Civilis", "Every city gains +3 loyalty a turn; walls +15.", {"loyalty": 3, "cityDefense": 15}),
       ("Restorer of Rome", "Respects loyal realms; scorns cities in revolt.", ["HighLoyalty"], ["CitiesInRevolt"]), {"war": 1.2, "expansion": 1.2}),
      ("LEADER_BASIL", "Basil II", "The Bulgar-Slayer", ("Varangian Guard", "+15% Production toward units.", [prod("Unit", 15)]),
       ("Cataphracts", "Mounted units fight with +6 more strength; the theme bonus reaches +14.", {"mountedStrength": 6, "maxStrength": 14}),
       ("Bulgar-Slayer", "Respects strength; scorns the peaceful.", ["HighLoyalty"], ["Peaceful"]), {"war": 1.6})]),

    ("CIV_CARTHAGE", "Carthage", "Carthaginian", "#5D1F75", "#F0D9A0",
     ["Qart-Hadasht", "Utica", "Hadrumetum", "Leptis", "Gades", "Motya", "Panormus", "Lilybaeum", "Hippo", "Carthago Nova"],
     ("Cothon", "+25% Production toward units in coastal cities.", [prod("Unit", 25, **COAST)]),
     ("Mercenaries", "Hired Swords",
      "Carthage raises units 30% slower, but buys them 50% cheaper. Every port city makes +2 Gold.",
      "Pay, don't draft: trade fills the treasury and the treasury hires the army, wherever it is needed.",
      {"unitProductionPenalty": 30, "portGold": 2, "unitDiscount": 50, "mountedMoves": 0, "portHousing": 0}),
     [("LEADER_HANNIBAL", "Hannibal Barca", "Father of Strategy", ("Crossing the Alps", "+10% Production toward units.", [prod("Unit", 10)]),
       ("War Elephants", "Mounted units have +1 movement; units are bought 60% cheaper.", {"mountedMoves": 1, "unitDiscount": 60}),
       ("Oath of Enmity", "Respects strength; scorns the peaceful.", ["HighLoyalty"], ["Peaceful"]), {"war": 1.6}),
      ("LEADER_DIDO", "Dido", "Founder of Carthage", ("The Ox-Hide", "+2 Gold in the capital.", [flat("Gold", 2, **CAP)]),
       ("Queen of the Byrsa", "Port cities gain +2 Housing and +4 Gold.", {"portHousing": 2, "portGold": 4}),
       ("Founder Queen", "Likes trading partners; dislikes blockades.", ["TradePartner"], ["Blockade"]), {"gold": 1.4, "naval": 1.4})]),

    ("CIV_BABYLON", "Babylon", "Babylonian", "#1D3F8F", "#E0B84A",
     ["Babilim", "Kish", "Borsippa", "Sippar", "Nippur", "Uruk", "Ur", "Larsa", "Isin", "Dilbat"],
     ("Hanging Gardens", "+1 Food in every city.", [flat("Food", 1)]),
     ("Eureka", "Enuma Anu Enlil",
      "Babylonian cities make 40% less Science, but every building and district completed yields Science worth 60% of its Production cost.",
      "Build to learn: discovery comes from construction, so keep every city building something.",
      {"sciencePenalty": 40, "sciencePercent": 60, "culturePercent": 0, "districtProduction": 0}),
     [("LEADER_HAMMURABI", "Hammurabi", "Lawgiver of Babylon", ("The Code", "+2 Loyalty per turn in all cities.", [eff("CityLoyaltyPerTurn", 2)]),
       ("Ninety-Nine Tablets", "Completions also yield Culture worth 30% of their cost.", {"culturePercent": 30}),
       ("Shepherd of the People", "Respects loyal realms; scorns cities in revolt.", ["HighLoyalty"], ["CitiesInRevolt"]), {"science": 1.3, "war": 0.9}),
      ("LEADER_NEBUCHADNEZZAR", "Nebuchadnezzar II", "Builder of the Ishtar Gate", ("Ishtar Gate", "+2 Culture in the capital.", [flat("Culture", 2, **CAP)]),
       ("Etemenanki", "+25% Production toward districts; completions yield 80% as Science.", {"districtProduction": 25, "sciencePercent": 80}),
       ("Great Builder", "Respects strength; scorns the peaceful.", ["HighLoyalty"], ["Peaceful"]), {"war": 1.3, "expansion": 1.2})]),

    ("CIV_KONGO", "Kongo", "Kongolese", "#C0392B", "#F4D03F",
     ["Mbanza Kongo", "Mbanza Nsundi", "Mbanza Mbata", "Mbanza Mpangu", "Mbanza Mbamba", "Loango", "Kakongo", "Ngoyo", "Soyo", "Mpemba"],
     ("Kingdom of Raffia", "+1 Culture in every city.", [flat("Culture", 1)]),
     ("Forest", "Children of the Forest",
      "Forest and rainforest tiles yield +1 Food, +1 Production and +1 Culture.",
      "Keep the forest standing: settle in the woods and never clear them, for they give everything.",
      {"forestFood": 1, "forestProduction": 1, "forestCulture": 1, "forestStrength": 0}),
     [("LEADER_MVEMBA", "Mvemba a Nzinga", "Afonso I", ("Letters to Lisbon", "+1 Faith in every city.", [flat("Faith", 1)]),
       ("Sacred Groves", "Forest tiles yield +2 Culture.", {"forestCulture": 2}),
       ("Correspondent of Kings", "Likes trading partners; dislikes warmongers.", ["TradePartner"], ["Warmonger"]), {"growth": 1.2, "war": 0.8}),
      ("LEADER_NZINGA", "Nzinga Mbande", "Queen of Ndongo and Matamba", ("Diplomat Queen", "+2 Loyalty per turn in all cities.", [eff("CityLoyaltyPerTurn", 2)]),
       ("War in the Forest", "Units in forest or rainforest fight with +7 strength.", {"forestStrength": 7}),
       ("Unbowed", "Respects strength; scorns the peaceful.", ["HighLoyalty"], ["Peaceful"]), {"war": 1.4})]),

    ("CIV_POLAND", "Poland", "Polish", "#DC143C", "#F5F5F5",
     ["Kraków", "Warszawa", "Poznań", "Gniezno", "Wrocław", "Lublin", "Toruń", "Gdańsk", "Płock", "Sandomierz"],
     ("Golden Liberty", "+1 Loyalty per turn in all cities.", [eff("CityLoyaltyPerTurn", 1)]),
     ("Commonwealth", "The Commonwealth",
      "When a Polish unit destroys an enemy within 4 tiles of a Polish city, the tiles around the fight join that city.",
      "Win battles at the border and the border moves: every victory is a land grab.",
      {"range": 4, "radius": 1, "homeStrength": 0}),
     [("LEADER_JADWIGA", "Jadwiga", "King of Poland", ("Jagiellonian Union", "+1 Faith in every city.", [flat("Faith", 1)]),
       ("Union of Krewo", "Victories claim land two tiles around the fight, up to 6 tiles from a city.", {"radius": 2, "range": 6}),
       ("Uniter", "Likes loyal, peaceful realms.", ["HighLoyalty", "Peaceful"], ["Warmonger"]), {"war": 1.0, "expansion": 1.2}),
      ("LEADER_SOBIESKI", "Jan III Sobieski", "Lion of Lechistan", ("Relief of Vienna", "+10% Production toward units.", [prod("Unit", 10)]),
       ("Winged Hussars", "Polish units fight with +6 strength inside Polish land.", {"homeStrength": 6}),
       ("Defender of Christendom", "Respects strength; scorns the peaceful.", ["HighLoyalty"], ["Peaceful"]), {"war": 1.5})]),

    ("CIV_SCOTLAND", "Scotland", "Scottish", "#005EB8", "#FFFFFF",
     ["Edinburgh", "Glasgow", "Aberdeen", "Dundee", "Perth", "Stirling", "Inverness", "St Andrews", "Dunfermline", "Scone"],
     ("Clan Lands", "+1 Production in every city.", [flat("Production", 1)]),
     ("Enlightenment", "The Scottish Enlightenment",
      "Each improved luxury near a Scottish city gives it +8% Science and Production (up to +30%).",
      "Keep the people content and they invent and build: hunt down every luxury and improve it.",
      {"percentPerLuxury": 8, "maxPercent": 30, "homeStrength": 0}),
     [("LEADER_ROBERT_BRUCE", "Robert the Bruce", "King of Scots", ("Declaration of Arbroath", "+2 Loyalty per turn in all cities.", [eff("CityLoyaltyPerTurn", 2)]),
       ("Bannockburn", "Units fight with +7 strength inside Scottish land.", {"homeStrength": 7}),
       ("Freedom", "Respects loyal realms; scorns warmongers.", ["HighLoyalty"], ["Warmonger"]), {"war": 1.2}),
      ("LEADER_MARGARET", "Saint Margaret", "Queen of Scotland", ("Queen's Ferry", "+1 Faith and +1 Culture in every city.", [flat("Faith", 1), flat("Culture", 1)]),
       ("Pearl of Scotland", "Each luxury gives +12% (up to +40%).", {"percentPerLuxury": 12, "maxPercent": 40}),
       ("Pious Reformer", "Likes the peaceful; scorns warmongers.", ["Peaceful"], ["Warmonger"]), {"science": 1.2, "war": 0.7})]),

    ("CIV_BRAZIL", "Brazil", "Brazilian", "#009C3B", "#FFDF00",
     ["Rio de Janeiro", "Salvador", "São Paulo", "Recife", "Belém", "Manaus", "Ouro Preto", "São Luís", "Porto Alegre", "Fortaleza"],
     ("Amazon", "+1 Food in every city.", [flat("Food", 1)]),
     ("Carnival", "Carnival",
      "Every 10 turns Brazil holds a Carnival for 2 turns: every city gains +3 amenities, and the nation earns Culture worth 6 per citizen. Rainforest tiles yield +1 Science.",
      "Grow big and celebrate: carnivals carry your culture forward in great bursts, and the rainforest is your laboratory.",
      {"interval": 10, "carnivalTurns": 2, "carnivalAmenities": 3, "culturePerPop": 6, "rainforestScience": 1, "carnivalProduction": 0}),
     [("LEADER_PEDRO", "Pedro II", "The Magnanimous", ("Patron of Science", "+10% Science.", [pct("Science", 10)]),
       ("The Magnanimous", "Carnival comes every 8 turns.", {"interval": 8}),
       ("Enlightened Emperor", "Likes scholars; dislikes warmongers.", ["HighScience"], ["Warmonger"]), {"science": 1.3, "war": 0.7}),
      ("LEADER_VARGAS", "Getúlio Vargas", "Father of the Poor", ("Estado Novo", "+10% Production.", [pct("Production", 10)]),
       ("The New State", "During Carnival every city makes +40% Production.", {"carnivalProduction": 40}),
       ("Industrializer", "Likes loyal realms; dislikes those in revolt.", ["HighLoyalty"], ["CitiesInRevolt"]), {"growth": 1.2, "war": 0.9})]),

    ("CIV_AMERICA", "America", "American", "#3C3B6E", "#B22234",
     ["Washington", "Philadelphia", "Boston", "New York", "Charleston", "Baltimore", "Richmond", "Chicago", "St. Louis", "San Francisco"],
     ("Founding Fathers", "+1 Culture in every city.", [flat("Culture", 1)]),
     ("Frontier", "The Open Frontier",
      "American cities need 25% less Food to grow and have +2 Housing.",
      "Grow fast and settle wide: cities balloon, so plan the amenities and the districts to keep up.",
      {"growthPercent": 25, "housing": 2, "productionPercent": 0, "parkCulture": 0}),
     [("LEADER_LINCOLN", "Abraham Lincoln", "The Great Emancipator", ("Emancipation", "+2 Loyalty per turn in all cities.", [eff("CityLoyaltyPerTurn", 2)]),
       ("Arsenal of the Union", "Every city makes +15% Production.", {"productionPercent": 15}),
       ("Preserver of the Union", "Respects loyal realms; scorns cities in revolt.", ["HighLoyalty"], ["CitiesInRevolt"]), {"war": 1.1, "expansion": 1.2}),
      ("LEADER_TEDDY", "Theodore Roosevelt", "The Bull Moose", ("Rough Riders", "+10% Production toward units.", [prod("Unit", 10)]),
       ("National Parks", "Every city makes +3 Culture; cities grow 35% faster.", {"parkCulture": 3, "growthPercent": 35}),
       ("Conservationist", "Likes peaceful realms; dislikes warmongers.", ["Peaceful"], ["Warmonger"]), {"war": 1.2, "growth": 1.3})]),

    ("CIV_VIETNAM", "Vietnam", "Vietnamese", "#DA251D", "#FFCD00",
     ["Thăng Long", "Hoa Lư", "Cổ Loa", "Huế", "Phú Xuân", "Gia Định", "Hội An", "Thanh Hóa", "Nam Định", "Hải Phòng"],
     ("Rice Paddies", "+1 Food in cities on a Great River.", [flat("Food", 1, **RIVER)]),
     ("Guerrilla", "The Land Fights Back",
      "Vietnamese units standing in forest, rainforest, marsh or hills fight with +5 strength and move +1.",
      "Fight where the land is wild: draw invaders into the jungle and hills, and never fight in the open.",
      {"terrainStrength": 5, "terrainMoves": 1}),
     [("LEADER_TRUNG_TRAC", "Trưng Trắc", "Queen of the Lạc Việt", ("The Trưng Sisters", "+2 Loyalty per turn in all cities.", [eff("CityLoyaltyPerTurn", 2)]),
       ("Uprising of the Sisters", "Units in wild land fight with +9 strength.", {"terrainStrength": 9}),
       ("Liberator", "Respects loyal realms; scorns warmongers.", ["HighLoyalty"], ["Warmonger"]), {"war": 1.2}),
      ("LEADER_LY_THUONG_KIET", "Lý Thường Kiệt", "Defender of the South", ("Mountains and Rivers of the South", "+10% Production toward units.", [prod("Unit", 10)]),
       ("Strike First", "Units in wild land move +2.", {"terrainMoves": 2}),
       ("Defender", "Respects strength; scorns the peaceful.", ["HighLoyalty"], ["Peaceful"]), {"war": 1.4})]),

    ("CIV_HAUDENOSAUNEE", "Haudenosaunee", "Haudenosaunee", "#4B2E83", "#F2F2F2",
     ["Onondaga", "Kanienke", "Oneida", "Cayuga", "Seneca", "Tuscarora", "Ganondagan", "Kanatsiohareke", "Akwesasne", "Ohswé:ken"],
     ("Three Sisters", "+1 Food in every city.", [flat("Food", 1)]),
     ("GreatLaw", "The Great Law of Peace",
      "The Confederacy may never declare war. While at peace with every civilization, every city makes +15% of every yield. Units and cities defend with +8 strength.",
      "A league of peace: grow strong in harmony and make any aggressor regret the attempt.",
      {"peacePercent": 15, "defense": 8, "peaceLoyalty": 0}),
     [("LEADER_HIAWATHA", "Hiawatha", "Co-founder of the Confederacy", ("Condolence Ceremony", "+2 Loyalty per turn in all cities.", [eff("CityLoyaltyPerTurn", 2)]),
       ("Wampum of Peace", "At peace with all, every city makes +25% of every yield.", {"peacePercent": 25}),
       ("Peacemaker", "Likes the peaceful; scorns warmongers.", ["Peaceful"], ["Warmonger"]), {"war": 0.3, "growth": 1.3}),
      ("LEADER_JIGONHSASEE", "Jigonhsasee", "Mother of Nations", ("Clan Mothers", "+1 Amenity in every city.", [eff("CityAmenities", 1)]),
       ("Mother of Nations", "At peace with all, every city gains +4 loyalty a turn; defenders +12.", {"peaceLoyalty": 4, "defense": 12}),
       ("Keeper of the Peace", "Likes loyal, peaceful realms.", ["Peaceful", "HighLoyalty"], ["Warmonger"]), {"war": 0.3, "growth": 1.2})]),
]


def build():
    civs, leaders = [], []
    for (cid, name, adj, primary, secondary, cities, ability, sig, ls) in NATIONS:
        kind, sname, sdesc, play, params = sig
        civs.append({"id": cid, "name": name, "adjective": adj, "startBias": [],
                     "ability": {"name": ability[0], "description": ability[1], "modifiers": ability[2]},
                     "signature": {"kind": kind, "name": sname, "description": sdesc, "playstyle": play, "params": params},
                     "cityNames": cities, "colors": {"primary": primary, "secondary": secondary}})
        for (lid, lname, epithet, lab, aug, agenda, personality) in ls:
            for key in aug[2]:
                assert key in params, f"{lid} augments unknown param {key} of {cid}"
            leaders.append({"id": lid, "name": lname, "epithet": epithet, "civilization": cid,
                            "ability": {"name": lab[0], "description": lab[1], "modifiers": lab[2]},
                            "augment": {"name": aug[0], "description": aug[1], "params": aug[2]},
                            "agenda": {"name": agenda[0], "description": agenda[1], "likes": agenda[2], "dislikes": agenda[3]},
                            "personality": personality})
    return civs, leaders


def splice(text, marker, items):
    begin, end = f"// {marker}-BEGIN", f"// {marker}-END"
    body = ",\n".join("    " + json.dumps(i, ensure_ascii=False) for i in items)
    block = f"{begin} (generated by tools/assets/nations_data.py)\n{body}\n    {end}"
    pattern = re.compile(re.escape(begin) + r".*?" + re.escape(end), re.S)
    if not pattern.search(text):
        raise SystemExit(f"marker {marker} missing in civilizations.json")
    return pattern.sub(lambda _: block, text)


if __name__ == "__main__":
    civs, leaders = build()
    text = open(TARGET, encoding="utf-8").read()
    text = splice(text, "MORE-NATIONS", civs)
    text = splice(text, "MORE-LEADERS", leaders)
    open(TARGET, "w", encoding="utf-8").write(text)
    print(f"{len(civs)} nations, {len(leaders)} leaders written")
