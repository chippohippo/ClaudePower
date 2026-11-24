"""Leaders of the World Wars: 16 twentieth-century heads of state and government, added to nations already in the game.

python3 tools/assets/wartime_leaders.py   -> rewrites the WARTIME-LEADERS block of content/base/data/civilizations.json

Each leader's doctrine changes how the nation plays, with a large bonus and a real cost:
  * ability modifiers on cities, including penalties;
  * UnitStrength that depends on where a unit stands or whether its people are at war;
  * player-level effects (war weariness, influence, favor);
  * an augment that pushes the nation's signature parameters to extremes.
Every description is neutral and historical. No mechanic rewards atrocities: the doctrines model war economies, strategy and diplomacy.
Germany and Italy are added as nations here. No mechanic rewards or depicts atrocities, and no extremist iconography is used.
"""
import json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
CIVS = os.path.normpath(os.path.join(HERE, "..", "..", "content", "base", "data", "civilizations.json"))


def req(t):
    return [{"type": t}]


def pct(y, n, when=None):
    m = {"effect": "CityYieldPercent", "yield": y, "amount": n}
    if when: m["requirements"] = req(when)
    return m


def flat(y, n, when=None):
    m = {"effect": "CityYieldFlat", "yield": y, "amount": n}
    if when: m["requirements"] = req(when)
    return m


def eff(e, n, when=None):
    m = {"effect": e, "amount": n}
    if when: m["requirements"] = req(when)
    return m


def prod(cat, n, when=None):
    m = {"effect": "CityProductionPercent", "category": cat, "amount": n}
    if when: m["requirements"] = req(when)
    return m


def strength(n, where=None, target=None):
    m = {"effect": "UnitStrength", "amount": n}
    if target: m["target"] = target
    if where: m["requirements"] = req(where)
    return m


HOME, ABROAD, WAR, PEACE = "UnitInOwnTerritory", "UnitInForeignTerritory", "OwnerAtWar", "OwnerAtPeace"

LEADERS = [
    ("LEADER_CHURCHILL", "Winston Churchill", "The British Bulldog", "CIV_ENGLAND",
     "We Shall Never Surrender",
     "Units +8 strength inside English borders. War weariness −60%. At war: +3 Loyalty and +15% Production in every city. "
     "But the war chest runs dry: −20% Gold always, and −10% Science in peacetime.",
     [strength(8, HOME), eff("WarWearinessPercent", -60), eff("CityLoyaltyPerTurn", 3, WAR), pct("Production", 15, WAR),
      pct("Gold", -20), pct("Science", -10, PEACE)],
     "Their Finest Hour", "Powered cities +40% Production; strategic resources yield 4 more.", {"poweredProduction": 40, "strategicBonus": 4},
     ("The Last Lion", "Admires those who stand firm; despises aggressors.", ["Peaceful"], ["Warmonger"]),
     {"war": 1.0, "naval": 1.4}),
    ("LEADER_CLEMENCEAU", "Georges Clemenceau", "Le Tigre", "CIV_FRANCE",
     "Total War",
     "At war: +40% Production toward units, units +6 strength, war weariness −40%. "
     "The cost: −15% Culture always, and −1 Amenity in every city while at war.",
     [prod("Unit", 40, WAR), strength(6, WAR), eff("WarWearinessPercent", -40), pct("Culture", -15), eff("CityAmenities", -1, WAR)],
     "Guerre Jusqu'au Bout", "France's Culture bonus is spent on the war (no +15%); borders still grow 60% faster.", {"culturePercent": 0, "borderPercent": 60},
     ("Père la Victoire", "Respects strength; scorns the weak.", ["Warmonger"], ["Peaceful"]),
     {"war": 1.3}),
    ("LEADER_DE_GAULLE", "Charles de Gaulle", "Leader of Free France", "CIV_FRANCE",
     "A Certain Idea of France",
     "+25% Culture, +10% Science, +2 Loyalty in every city; +2 influence and +2 Diplomatic Favor a turn. "
     "But a small army: −20% Production toward units, and units −3 strength outside French borders.",
     [pct("Culture", 25), pct("Science", 10), eff("CityLoyaltyPerTurn", 2), eff("InfluencePerTurn", 2), eff("FavorPerTurn", 2),
      prod("Unit", -20), strength(-3, ABROAD)],
     "Grandeur", "French cities +30% Culture; borders grow 150% faster.", {"culturePercent": 30, "borderPercent": 150},
     ("Grandeur", "Likes loyal, cultured realms; dislikes those whose cities rebel.", ["HighLoyalty"], ["CitiesInRevolt"]),
     {"war": 0.6}),
    ("LEADER_STALIN", "Joseph Stalin", "General Secretary", "CIV_RUSSIA",
     "Five-Year Plans",
     "Forced industrialization: +25% Production in every city, +20% toward units, units +5 strength inside Russian borders. "
     "Its toll: −2 Amenities in every city, −30% Culture, −20% Gold, and +50% emissions.",
     [pct("Production", 25), prod("Unit", 20), strength(5, HOME), eff("CityAmenities", -2), pct("Gold", -20),
      pct("Culture", -30), eff("CityEmissionsPercent", 50)],
     "Scorched Earth", "Invaders in Russian tundra and snow lose 25 HP a turn.", {"winterDamage": 25},
     ("Socialism in One Country", "Distrusts everyone, warmongers above all.", ["HighScience"], ["Warmonger", "TradePartner"]),
     {"war": 1.3, "expansion": 1.1}),
    ("LEADER_TOJO", "Hideki Tojo", "Prime Minister of Japan", "CIV_JAPAN",
     "Total War Cabinet",
     "Units +8 strength outside Japanese borders; +40% Production toward units. "
     "The home front pays: −1 Amenity in every city at war, −20% Gold and −15% Culture, and war weariness +25%.",
     [strength(8, ABROAD), prod("Unit", 40), eff("CityAmenities", -1, WAR), pct("Gold", -20), pct("Culture", -15), eff("WarWearinessPercent", 25)],
     "Island Fortress", "Japanese coastal cities fight +10 stronger.", {"coastDefense": 10},
     ("Co-Prosperity", "Respects military power; despises the peaceful.", ["Warmonger"], ["Peaceful"]),
     {"war": 1.4, "naval": 1.5}),
    ("LEADER_ROOSEVELT", "Franklin D. Roosevelt", "32nd President", "CIV_AMERICA",
     "Arsenal of Democracy",
     "Once at war: +25% Production in every city and +50% toward units. The New Deal: +1 Amenity and +1 Housing everywhere. "
     "But isolation in peacetime: −30% Production toward units while at peace.",
     [pct("Production", 25, WAR), prod("Unit", 50, WAR), eff("CityAmenities", 1), eff("CityHousing", 1), prod("Unit", -30, PEACE)],
     "The New Deal", "American cities +15% Production and +3 Housing.", {"productionPercent": 15, "housing": 3},
     ("Four Freedoms", "Likes peaceful traders; hates aggressors.", ["Peaceful", "TradePartner"], ["Warmonger"]),
     {"war": 0.5, "expansion": 1.2}),
    ("LEADER_WILSON", "Woodrow Wilson", "28th President", "CIV_AMERICA",
     "Fourteen Points",
     "+4 Diplomatic Favor and +3 influence a turn; +2 Loyalty in every city. "
     "But no appetite for armies: −20% Production toward units.",
     [eff("FavorPerTurn", 4), eff("InfluencePerTurn", 3), eff("CityLoyaltyPerTurn", 2), prod("Unit", -20)],
     "Self-Determination", "American cities need 30% less Food to grow.", {"growthPercent": 30},
     ("League of Nations", "Likes peace; despises warmongers.", ["Peaceful"], ["Warmonger"]),
     {"war": 0.4}),
    ("LEADER_ATATURK", "Mustafa Kemal Atatürk", "Father of the Turks", "CIV_OTTOMAN",
     "Gallipoli",
     "Units +10 strength inside Ottoman borders; reforms bring +20% Science and +3 Loyalty in every city. "
     "But −50% Faith, and −15% Production toward units.",
     [strength(10, HOME), pct("Science", 20), eff("CityLoyaltyPerTurn", 3), pct("Faith", -50), prod("Unit", -15)],
     "The Republic", "Captured cities start fully loyal; attacks on cities +5 (not +10).", {"capturedLoyalty": 100, "vsCity": 5},
     ("Peace at Home", "Respects learning and loyalty; dislikes warmongers.", ["HighScience", "HighLoyalty"], ["Warmonger"]),
     {"war": 0.8}),
    ("LEADER_PILSUDSKI", "Józef Piłsudski", "First Marshal of Poland", "CIV_POLAND",
     "Miracle on the Vistula",
     "Units +8 strength inside Polish borders; cavalry +4 more anywhere. But −15% Science and −10% Gold.",
     [strength(8, HOME), strength(4, None, "LightCavalry"), strength(4, None, "HeavyCavalry"), pct("Science", -15), pct("Gold", -10)],
     "Intermarium", "Victories claim land up to 8 tiles from Polish cities, two rings at a time.", {"range": 8, "radius": 2},
     ("Between Two Empires", "Dislikes warmongers on every side.", ["HighLoyalty"], ["Warmonger"]),
     {"war": 1.1}),
    ("LEADER_VARGAS", "Getúlio Vargas", "Father of the Poor", "CIV_BRAZIL",
     "Estado Novo",
     "State-led growth: +15% Production, +10% Gold and +2 Housing in every city. But −1 Loyalty a turn and −20% Culture everywhere.",
     [pct("Production", 15), pct("Gold", 10), eff("CityHousing", 2), eff("CityLoyaltyPerTurn", -1), pct("Culture", -20)],
     "Fewer Festivals", "Carnival only every 20 turns, but cities make +50% Production during it.", {"interval": 20, "carnivalProduction": 50},
     ("Progress", "Likes trade partners; dislikes cities in revolt.", ["TradePartner"], ["CitiesInRevolt"]),
     {"war": 0.8, "expansion": 1.2}),
    ("LEADER_HO_CHI_MINH", "Ho Chi Minh", "Uncle Ho", "CIV_VIETNAM",
     "People's War",
     "Units +5 strength inside Vietnamese borders; war weariness −70%; +3 Loyalty in every city at war. But −15% Gold and −10% Science.",
     [strength(5, HOME), eff("WarWearinessPercent", -70), eff("CityLoyaltyPerTurn", 3, WAR), pct("Gold", -15), pct("Science", -10)],
     "The Long Resistance", "Units in forest, rainforest, marsh or hills fight +10 stronger and move +2.", {"terrainStrength": 10, "terrainMoves": 2},
     ("Independence", "Respects the loyal; hates aggressors.", ["HighLoyalty"], ["Warmonger"]),
     {"war": 0.9}),
    ("LEADER_HAILE_SELASSIE", "Haile Selassie", "Emperor of Ethiopia", "CIV_ETHIOPIA",
     "Appeal to the League",
     "+4 Diplomatic Favor and +2 influence a turn; units +6 strength inside Ethiopian borders. But −15% Production.",
     [eff("FavorPerTurn", 4), eff("InfluencePerTurn", 2), strength(6, HOME), pct("Production", -15)],
     "Highland Fortress", "Units on hills fight +8 stronger; 60% of Faith income becomes Science.", {"hillStrength": 8, "faithToScience": 60},
     ("Collective Security", "Likes the peaceful; despises warmongers.", ["Peaceful"], ["Warmonger"]),
     {"war": 0.6}),
    ("LEADER_WILHELMINA", "Wilhelmina", "Queen of the Netherlands", "CIV_NETHERLANDS",
     "Radio Oranje",
     "+4 Loyalty a turn and +20% Gold in every city; war weariness −50%. But −25% Production toward units.",
     [eff("CityLoyaltyPerTurn", 4), pct("Gold", 20), eff("WarWearinessPercent", -50), prod("Unit", -25)],
     "Trade from Exile", "Coastal cities +3 Gold; coast tiles +2 Production.", {"coastalGold": 3, "seaProduction": 2},
     ("Resistance", "Likes trade partners and the loyal; dislikes warmongers.", ["TradePartner", "HighLoyalty"], ["Warmonger"]),
     {"war": 0.6, "naval": 1.3}),
    ("LEADER_METAXAS", "Ioannis Metaxas", "Prime Minister of Greece", "CIV_GREECE",
     "The Day of No",
     "Units +10 strength inside Greek borders; +3 Loyalty a turn and +20% Production toward units in every city. "
     "But −20% Culture everywhere, and −1 Amenity while at war.",
     [strength(10, HOME), eff("CityLoyaltyPerTurn", 3), prod("Unit", 20), pct("Culture", -20), eff("CityAmenities", -1, WAR)],
     "The Metaxas Line", "Melee units fight +10 at war; the bonus for peaceful neighbours is lost.", {"phalanx": 10, "percentPerPeace": 0},
     ("Ochi", "Respects the loyal; despises warmongers.", ["HighLoyalty"], ["Warmonger"]),
     {"war": 0.9}),
    ("LEADER_HAAKON", "Haakon VII", "King of Norway", "CIV_NORWAY",
     "The Home Front",
     "Units +6 strength inside Norwegian borders; war weariness −50%; +2 Loyalty in every city. But −5% Production.",
     [strength(6, HOME), eff("WarWearinessPercent", -50), eff("CityLoyaltyPerTurn", 2), pct("Production", -5)],
     "The Merchant Fleet", "Norse ships +12 strength and +2 movement; plunder pays 100%.", {"navalStrength": 12, "navalMoves": 2, "goldPercent": 100},
     ("Alt for Norge", "Likes the loyal; dislikes warmongers.", ["HighLoyalty"], ["Warmonger"]),
     {"war": 0.7, "naval": 1.5}),
    ("LEADER_FAISAL", "Faisal I", "Leader of the Arab Revolt", "CIV_ARABIA",
     "The Arab Revolt",
     "Units +6 strength outside Arab borders; cavalry +4 more; +3 influence a turn and +10% Gold. But −15% Production toward buildings.",
     [strength(6, ABROAD), strength(4, None, "LightCavalry"), eff("InfluencePerTurn", 3), pct("Gold", 10), prod("Building", -15)],
     "Desert Scholars", "35% of Gold income becomes Science at 140%.", {"goldToScience": 35, "conversionPercent": 140},
     ("Arab Unity", "Likes trade partners; dislikes warmongers.", ["TradePartner"], ["Warmonger"]),
     {"war": 1.1}),
]

# ----- The leaders of the new nations, and more of the century's controversial heads of state -----
LEADERS += [
    ("LEADER_WILHELM_II", "Wilhelm II", "German Emperor", "CIV_GERMANY",
     "Weltpolitik",
     "A world policy: +25% Production toward units and +15% Science in every city. "
     "Its price: war weariness +40%, −15% Gold, and −1 Amenity in every city while at war.",
     [prod("Unit", 25), pct("Science", 15), eff("WarWearinessPercent", 40), pct("Gold", -15), eff("CityAmenities", -1, WAR)],
     "The High Seas Fleet", "German ships fight +10 stronger and move +1; every city keeps its extra district slot.",
     {"navalStrength": 10, "navalMoves": 1, "extraDistricts": 1},
     ("Place in the Sun", "Respects power; resents trading empires.", ["Warmonger"], ["TradePartner"]),
     {"war": 1.3, "naval": 1.6}),
    ("LEADER_HITLER", "Adolf Hitler", "Chancellor of Germany", "CIV_GERMANY",
     "Blitzkrieg",
     "Rearmament and mobile war: +40% Production toward units, units +6 strength outside German borders. "
     "The costs: diplomatic isolation (−3 Diplomatic Favor and −2 influence a turn), −25% Gold, −20% Culture, war weariness +30%.",
     [prod("Unit", 40), strength(6, ABROAD), eff("FavorPerTurn", -3), eff("InfluencePerTurn", -2), pct("Gold", -25), pct("Culture", -20),
      eff("WarWearinessPercent", 30)],
     "Combined-Arms Doctrine", "Armour (heavy cavalry) fights +5 stronger and moves +1.", {"armorStrength": 5, "armorMoves": 1},
     ("Expansionist", "Despises the peaceful and the loyal alike.", ["Warmonger"], ["Peaceful", "HighLoyalty"]),
     {"war": 1.9, "expansion": 1.3}),
    ("LEADER_ORLANDO", "Vittorio Emanuele Orlando", "Premier of Victory", "CIV_ITALY",
     "The Piave Line",
     "Units +6 strength inside Italian borders; +3 Diplomatic Favor a turn; +2 Loyalty in every city at war. But −10% Production and −10% Gold.",
     [strength(6, HOME), eff("FavorPerTurn", 3), eff("CityLoyaltyPerTurn", 2, WAR), pct("Production", -10), pct("Gold", -10)],
     "Vittorio Veneto", "Every wonder and great work pays +3 Culture and +3 Gold.", {"workCulture": 3, "workGold": 3},
     ("The Big Four", "Likes the peaceful; dislikes warmongers.", ["Peaceful"], ["Warmonger"]),
     {"war": 0.8}),
    ("LEADER_MUSSOLINI", "Benito Mussolini", "Prime Minister of Italy", "CIV_ITALY",
     "Mare Nostrum",
     "Public works and a navy: +25% Production toward districts and wonders, +3 Loyalty a turn in every city. "
     "But an overstretched army: units −4 strength outside Italian borders, −15% Science, −2 Diplomatic Favor a turn.",
     [prod("District", 25), eff("CityLoyaltyPerTurn", 3), strength(-4, ABROAD), pct("Science", -15), eff("FavorPerTurn", -2)],
     "The Regia Marina", "Italian ships fight +8 stronger and move +1.", {"navalStrength": 8, "navalMoves": 1},
     ("Imperial Ambition", "Respects warmongers; scorns the peaceful.", ["Warmonger"], ["Peaceful"]),
     {"war": 1.4, "naval": 1.3}),
    ("LEADER_MAO", "Mao Zedong", "Chairman of the Communist Party", "CIV_SONG",
     "People's Republic",
     "Land reform and a people's army: +20% Food and +15% Production, +3 Housing in every city, units +5 strength inside Chinese borders, "
     "war weariness −40%. The upheavals: −30% Culture, −20% Science, −1 Amenity everywhere.",
     [pct("Food", 20), pct("Production", 15), eff("CityHousing", 3), strength(5, HOME), eff("WarWearinessPercent", -40),
      pct("Culture", -30), pct("Science", -20), eff("CityAmenities", -1)],
     "No More Dynasties", "The Mandate rises faster (+5 per loyal city) but its Golden Dynasties are shorter (6 turns).", {"gainPerLoyalCity": 5, "dynastyTurns": 6},
     ("Revolution", "Dislikes trading empires and warmongers.", ["HighLoyalty"], ["TradePartner", "Warmonger"]),
     {"war": 1.1, "expansion": 1.3}),
    ("LEADER_CHIANG", "Chiang Kai-shek", "Generalissimo", "CIV_SONG",
     "National Revolution",
     "+20% Gold and +10% Science in every city, +2 influence a turn, units +4 strength inside Chinese borders. "
     "But a divided country: −1 Loyalty a turn and −10% Production everywhere.",
     [pct("Gold", 20), pct("Science", 10), eff("InfluencePerTurn", 2), strength(4, HOME), eff("CityLoyaltyPerTurn", -1), pct("Production", -10)],
     "The Northern Expedition", "War drains the Mandate less (2 a turn instead of 4).", {"warDrain": 2},
     ("Allied Cause", "Likes trading partners; despises warmongers.", ["TradePartner"], ["Warmonger"]),
     {"war": 1.0}),
    ("LEADER_LENIN", "Vladimir Lenin", "Chairman of the People's Commissars", "CIV_RUSSIA",
     "Peace, Land and Bread",
     "+2 Food and +2 Housing in every city, +15% Production. The cost: −30% Gold, war weariness +50%, and −1 Amenity in every city while at war.",
     [flat("Food", 2), eff("CityHousing", 2), pct("Production", 15), pct("Gold", -30), eff("WarWearinessPercent", 50), eff("CityAmenities", -1, WAR)],
     "All Power to the Soviets", "Every Russian city claims its third ring when founded.", {"claimRadius": 3},
     ("World Revolution", "Dislikes trading empires.", ["Peaceful"], ["TradePartner"]),
     {"war": 0.7, "expansion": 1.2}),
    ("LEADER_FRANCO", "Francisco Franco", "Head of State of Spain", "CIV_SPAIN",
     "Non-Belligerence",
     "+20% Production in peacetime, +3 Loyalty a turn in every city, units +6 strength inside Spanish borders. "
     "But isolation: −25% Culture, −15% Science, −1 influence a turn.",
     [pct("Production", 20, PEACE), eff("CityLoyaltyPerTurn", 3), strength(6, HOME), pct("Culture", -25), pct("Science", -15), eff("InfluencePerTurn", -1)],
     "The Fortress of Spain", "Captured cities pay 120 Gold per citizen.", {"goldPerPop": 120},
     ("Neutrality", "Respects the loyal; dislikes cities in revolt.", ["HighLoyalty"], ["CitiesInRevolt"]),
     {"war": 0.7}),
]

# ----- New nations: Germany and Italy (no extremist iconography: field grey and gold; Italian green and white) -----
NATIONS = [
    {"id": "CIV_GERMANY", "name": "Germany", "adjective": "German", "startBias": ["RELIEF_HILLS"],
     "ability": {"name": "Ingenieurskunst", "description": "+1 Production in every city of 3 or more citizens.",
                 "modifiers": [{"effect": "CityYieldFlat", "yield": "Production", "amount": 1, "requirements": [{"type": "CityMinPopulation", "value": 3}]}]},
     "signature": {"kind": "Ruhr", "name": "The Engine of Europe",
                   "description": "Every German city has one more district slot, and cities with a Foundry make +15% Production. Germany's leaders shape its armour and its fleet.",
                   "playstyle": "Build tall and industrial: more districts per city than anyone, Foundries everywhere, then turn the industry to whatever your leader demands — a fleet or armoured columns.",
                   "params": {"extraDistricts": 1, "foundryProduction": 15, "armorStrength": 0, "armorMoves": 0, "navalStrength": 0, "navalMoves": 0, "homeStrength": 0}},
     "cityNames": ["Berlin", "Hamburg", "München", "Köln", "Frankfurt", "Leipzig", "Dresden", "Nürnberg", "Bremen", "Aachen"],
     "colors": {"primary": "#5B6770", "secondary": "#D9B24C"}},
    {"id": "CIV_ITALY", "name": "Italy", "adjective": "Italian", "startBias": ["TERRAIN_COAST"],
     "ability": {"name": "Il Bel Paese", "description": "+1 Culture in coastal cities.",
                 "modifiers": [{"effect": "CityYieldFlat", "yield": "Culture", "amount": 1, "requirements": [{"type": "CityIsCoastal"}]}]},
     "signature": {"kind": "Rinascimento", "name": "Cities of Art",
                   "description": "Every wonder and great work in an Italian city pays +2 Culture and +2 Gold, and Italian cities build districts and wonders 15% faster.",
                   "playstyle": "Fill your cities with wonders and masterpieces; every one pays twice. A natural road to the Culture victory.",
                   "params": {"workCulture": 2, "workGold": 2, "districtProduction": 15, "navalStrength": 0, "navalMoves": 0, "homeStrength": 0}},
     "cityNames": ["Firenze", "Milano", "Napoli", "Torino", "Bologna", "Palermo", "Trieste", "Verona", "Pisa", "Siena"],
     "colors": {"primary": "#1E7B3A", "secondary": "#F4F1EA"}},
]

UNITS = [
    {"id": "UNIT_PANZER", "name": "Panzer", "replaces": "UNIT_TANK", "civilization": "CIV_GERMANY", "over": {"strength": 84, "moves": 5},
     "description": "Fast armour built for breakthroughs."},
    {"id": "UNIT_CONDOTTIERI", "name": "Condottieri", "replaces": "UNIT_HORSEMAN", "civilization": "CIV_ITALY", "over": {"strength": 38, "cost": 70},
     "description": "Hired captains of the city-states: tougher and cheaper."},
]


def main():
    text = open(CIVS, encoding="utf-8").read()
    ids = {l[0] for l in LEADERS}
    lines = []
    for lid, name, epithet, civ, ab, desc, mods, aug, augdesc, params, agenda, personality in LEADERS:
        a_name, a_desc, likes, dislikes = agenda
        entry = {"id": lid, "name": name, "epithet": epithet, "civilization": civ, "tags": ["WorldWars"],
                 "ability": {"name": ab, "description": desc, "modifiers": mods},
                 "augment": {"name": aug, "description": augdesc, "params": params},
                 "agenda": {"name": a_name, "description": a_desc, "likes": likes, "dislikes": dislikes},
                 "personality": personality}
        lines.append("    " + json.dumps(entry, ensure_ascii=False))
    # The block opens with its own comma, so the block before it (nations_data.py's) needs none.
    block = "    // WARTIME-LEADERS-BEGIN (generated by tools/assets/wartime_leaders.py; supersedes same-id leaders elsewhere)\n    ,\n" + \
            ",\n".join(lines) + "\n    // WARTIME-LEADERS-END\n"
    # Leaders this file supersedes (Wilhelmina, Vargas) are removed from the generated nations block.
    out = []
    for line in text.split("\n"):
        m = re.match(r'\s*\{"id": "(LEADER_[A-Z_]+)"', line)
        if m and m.group(1) in ids and '"WorldWars"' not in line:
            continue
        out.append(line)
    text = "\n".join(out)
    text = re.sub(r"\},\n    // MORE-LEADERS-END", "}\n    // MORE-LEADERS-END", text)
    if "WARTIME-LEADERS-BEGIN" in text:
        text = re.sub(r"    // WARTIME-LEADERS-BEGIN.*?// WARTIME-LEADERS-END\n", lambda _: block, text, flags=re.S)
    else:
        text = text.replace("    // MORE-LEADERS-END\n", "    // MORE-LEADERS-END\n" + block, 1)
    # New nations, after the generated ones (the block opens with its own comma).
    nblock = "    // WARTIME-NATIONS-BEGIN (generated by tools/assets/wartime_leaders.py)\n    ,\n" + \
             ",\n".join("    " + json.dumps(n, ensure_ascii=False) for n in NATIONS) + "\n    // WARTIME-NATIONS-END\n"
    if "WARTIME-NATIONS-BEGIN" in text:
        text = re.sub(r"    // WARTIME-NATIONS-BEGIN.*?// WARTIME-NATIONS-END\n", lambda _: nblock, text, flags=re.S)
    else:
        text = text.replace("    // MORE-NATIONS-END\n", "    // MORE-NATIONS-END\n" + nblock, 1)
    # China: with modern leaders, the nation is China (its id and its Mandate are unchanged).
    text = text.replace('"name": "Song China", "adjective": "Song"', '"name": "China", "adjective": "Chinese"')
    open(CIVS, "w", encoding="utf-8").write(text)

    # Unique units of the new nations, copied from the generic they replace.
    units_path = os.path.join(os.path.dirname(CIVS), "units.json")
    raw = open(units_path, encoding="utf-8").read()
    data = json.loads(re.sub(r"^\s*//.*$", "", raw, flags=re.M))
    generic = {u["id"]: u for u in data["units"] if not u.get("civilization")}
    lines = []
    for spec in UNITS:
        g = {k: v for k, v in generic[spec["replaces"]].items() if k not in ("id", "name", "variants", "description")}
        u = {"id": spec["id"], "name": spec["name"], **g, **spec["over"], "civilization": spec["civilization"], "replaces": spec["replaces"],
             "description": spec["description"]}
        lines.append("    " + json.dumps(u, ensure_ascii=False))
    ublock = "    // WARTIME-UNITS-BEGIN (generated by tools/assets/wartime_leaders.py)\n    ,\n" + ",\n".join(lines) + "\n    // WARTIME-UNITS-END\n"
    if "WARTIME-UNITS-BEGIN" in raw:
        raw = re.sub(r"    // WARTIME-UNITS-BEGIN.*?// WARTIME-UNITS-END\n", lambda _: ublock, raw, flags=re.S)
    else:
        last = raw.rindex("]")
        raw = raw[:last].rstrip() + "\n" + ublock + "  " + raw[last:]
    open(units_path, "w", encoding="utf-8").write(raw)
    print(f"wrote {len(LEADERS)} wartime leaders, {len(NATIONS)} nations, {len(UNITS)} units")


if __name__ == "__main__":
    main()
