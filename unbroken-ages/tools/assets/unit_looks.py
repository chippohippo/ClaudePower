"""Writes each unit's "look" (how the client draws it) into content/base/data/units.json.

python3 tools/assets/unit_looks.py

The table below is the single place the roster is matched to models: period soldiers for the line, mounts for cavalry,
siege engines, tanks of their war, ships of their age. Re-running replaces any look already written.
"""
import json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
UNITS = os.path.normpath(os.path.join(HERE, "..", "..", "content", "base", "data", "units.json"))

STEEL, BRONZE, OLIVE, KHAKI, GREY = "#c8ccd4", "#e0b880", "#9aa070", "#d4c49a", "#a8acb4"
CHESTNUT, DARK, WHITE_HORSE, RED, GOLD = "#a89a9e", "#6e625e", "#f0ece4", "#e09080", "#f0d070"


def look(model, count=4, size=0.72, by_length=False, tint=None, hover=0, addon=None, rider=None):
    d = {"model": model, "count": count, "size": size}
    if by_length: d["byLength"] = True
    if tint: d["tint"] = tint
    if hover: d["hover"] = hover
    if addon: d["addon"] = addon
    if rider: d["rider"] = rider
    return d


MINI = {"archer_mini", "soldier_arena"}   # Kenney's big-headed minis read larger than their height: fit them smaller


def foot(model, tint=None, count=4, size=0.72):
    return look("units/" + model, count, round(size * 0.82, 2) if model in MINI else size, tint=tint)
def horse(model="horse_saddled", tint=None, rider="Rogue", count=3):
    return look("units/" + model, count, 0.82, True, tint, rider=rider if "/" in rider else "units/" + rider)


def elephant(tint=None, rider="Barbarian"): return look("units/elephant", 2, 0.85, True, tint, rider="units/" + rider)
def engine(model, count=1, size=0.6, tint=None): return look("units/" + model, count, size, True, tint)
def ship(model, size=1.3, count=1, tint=None): return look("units/" + model, count, size, True, tint)
def air(model, count=2, size=0.45, hover=0.5): return look("units/" + model, count, size, True, hover=hover)


LOOKS = {
    # --- the generic line, era by era ---
    "UNIT_SCOUT": foot("Rogue_Hooded", count=2, size=0.7),
    "UNIT_WARRIOR": foot("Barbarian"),
    "UNIT_SLINGER": foot("Rogue", size=0.7),
    "UNIT_SPEARMAN": foot("guard", BRONZE),
    "UNIT_ARCHER": look("life/Ranger", 4, 0.72),
    "UNIT_SWORDSMAN": foot("Knight", BRONZE, size=0.74),
    "UNIT_HORSEMAN": horse(tint=CHESTNUT),
    "UNIT_CATAPULT": engine("catapult", 1, 0.62),
    "UNIT_CROSSBOWMAN": foot("archer_mini"),
    "UNIT_PIKEMAN": foot("guard", STEEL),
    "UNIT_KNIGHT": horse("horse_saddled", WHITE_HORSE, "Knight"),
    "UNIT_MUSKETMAN": foot("rifleman", RED),
    "UNIT_FIELD_CANNON": engine("cannon", 2, 0.5),
    "UNIT_RIFLEMAN": foot("rifleman"),
    "UNIT_CAVALRY": horse("horse_saddled", DARK, "Rogue_Hooded"),
    "UNIT_ARTILLERY": engine("howitzer", 2, 0.55),
    "UNIT_INFANTRY": foot("modern_soldier", OLIVE),
    "UNIT_AT_CREW": foot("modern_soldier", KHAKI, count=3),
    "UNIT_MECH_INFANTRY": engine("half_track", 2, 0.55),
    "UNIT_TANK": engine("tank_ww2", 2, 0.55),
    "UNIT_MODERN_ARMOR": engine("tank_modern", 2, 0.6),
    "UNIT_EW_PLATOON": foot("pilot", "#b0c8e0", count=3, size=0.7),
    "UNIT_EXOFRAME": foot("mech", count=2, size=0.85),
    "UNIT_FIGHTER": air("fighter", 2, 0.42),
    "UNIT_BOMBER": air("bomber", 1, 0.62, 0.6),
    "UNIT_DRONE_SWARM": air("drone", 3, 0.36, 0.35),
    "UNIT_RIVER_BARGE": ship("boat_sail_a", 0.95),
    "UNIT_GALLEY": ship("trireme", 1.25),
    "UNIT_CARAVEL": ship("galleon", 1.4),
    "UNIT_IRONCLAD": ship("ironclad", 1.35),
    "UNIT_BATTLESHIP": ship("battleship", 1.6),
    "UNIT_DESTROYER": ship("destroyer", 1.4),
    "UNIT_SUBMARINE": ship("submarine", 1.3),
    # --- unique units: each in its people's own form ---
    "UNIT_MEDJAY": foot("soldier_arena", GOLD),
    "UNIT_GREAT_GALLEY": ship("trireme", 1.4, tint=GOLD),
    "UNIT_FIRE_LANCE_CORPS": foot("ashigaru", GOLD),
    "UNIT_KESHIG": horse("horse_saddled", DARK, "life/Ranger"),
    "UNIT_WARAKAQ": foot("Rogue", GOLD, size=0.7),
    "UNIT_MANDEKALU": horse("horse_saddled", GOLD, "Knight"),
    "UNIT_LEGION": foot("soldier_arena", RED),
    "UNIT_HOPLITE": foot("guard", GOLD),
    "UNIT_IMPI": foot("Barbarian", "#c8a888"),
    "UNIT_BERSERKER": foot("Barbarian", "#b8c0d0", size=0.78),
    "UNIT_SAMURAI": foot("samurai"),
    "UNIT_SEA_DOG": ship("boat_sail_b", 1.35),
    "UNIT_GENDARME": horse("horse_saddled", STEEL, "Knight"),
    "UNIT_COSSACK": horse("horse_saddled", DARK, "Barbarian"),
    "UNIT_IMMORTAL": foot("archer_mini", GOLD),
    "UNIT_EAGLE_WARRIOR": foot("Barbarian", "#f0c870"),
    "UNIT_HULCHE": foot("archer_mini", "#b0d090"),
    "UNIT_SHOTELAI": foot("soldier_arena", "#d0b090"),
    "UNIT_JANISSARY": foot("rifleman", "#fff0d0"),
    "UNIT_MAMLUK": horse("horse_saddled", "#e0d0b0", "Knight"),
    "UNIT_HWACHA": engine("catapult", 1, 0.58, RED),
    "UNIT_VARU": elephant(),
    "UNIT_DOMREY": elephant(GOLD, "Rogue"),
    "UNIT_ZEVEN_PROVINCIEN": ship("ironclad", 1.45, tint="#f0b070"),
    "UNIT_NAU": ship("galleon", 1.35, tint=GOLD),
    "UNIT_CONQUISTADOR": foot("Knight", STEEL, size=0.76),
    "UNIT_DROMON": ship("trireme", 1.3, tint=RED),
    "UNIT_NUMIDIAN_CAVALRY": horse("camel", None, "Rogue_Hooded"),
    "UNIT_SABUM_KIBITTUM": foot("Barbarian", GOLD),
    "UNIT_NGAO_MBEBA": foot("soldier_arena", "#c09070"),
    "UNIT_WINGED_HUSSAR": horse("horse_saddled", RED, "Knight"),
    "UNIT_HIGHLANDER": foot("Rogue_Hooded", "#a0c0a0", count=3, size=0.72),
    "UNIT_MINAS_GERAES": ship("battleship", 1.5, tint="#b0d0a0"),
    "UNIT_SHERMAN": engine("tank_ww2", 2, 0.56, OLIVE),
    "UNIT_VOI_CHIEN": elephant("#d0c0b0"),
    "UNIT_PATHFINDER": foot("Rogue_Hooded", "#c0a080", count=2, size=0.7),
    "UNIT_PANZER": engine("tank_ww2", 2, 0.56, GREY),
    "UNIT_CONDOTTIERI": horse("horse_saddled", GOLD, "Rogue"),
}


def unit_spans(src):
    """(id, start, end) of every unit object: from its opening brace to its matching closing brace (strings skipped)."""
    for m in re.finditer(r'\{\s*"id":\s*"(UNIT_[A-Z0-9_]+)"', src):
        depth, i, in_str = 0, m.start(), False
        while True:
            c = src[i]
            if in_str:
                if c == "\\": i += 1
                elif c == '"': in_str = False
            elif c == '"': in_str = True
            elif c == "{": depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0: break
            i += 1
        yield m.group(1), m.start(), i


def main():
    src = open(UNITS, encoding="utf-8").read()
    done = set()
    for uid, a, b in reversed(list(unit_spans(src))):
        if uid not in LOOKS: continue
        body = re.sub(r',\s*"look":\s*\{[^{}]*\}\s*$', "", src[a:b].rstrip())   # replace an earlier look
        src = src[:a] + body + ', "look": ' + json.dumps(LOOKS[uid]) + " " + src[b:]
        done.add(uid)
    missing = set(LOOKS) - done
    if missing: raise SystemExit(f"units not found: {sorted(missing)}")
    open(UNITS, "w", encoding="utf-8").write(src)
    print(f"looks written for {len(done)} units")


if __name__ == "__main__":
    main()
