"""Builds the Earth map (content/base/data/maps/earth.json) from Natural Earth (public domain, naturalearthdata.com).

    git clone --depth 1 --filter=blob:none --sparse https://github.com/nvkelso/natural-earth-vector NE
    (cd NE && git sparse-checkout set --no-cone '/geojson/ne_50m_land.geojson' '/geojson/ne_50m_lakes.geojson' \\
        '/geojson/ne_50m_rivers_lake_centerlines.geojson' '/geojson/ne_50m_geography_regions_polys.geojson' \\
        '/geojson/ne_50m_glaciated_areas.geojson')
    pip install shapely
    python3 tools/maps/earth.py NE/geojson

The hex grid is 128 x 80 (the Huge size), wrapping east-west, in a Miller projection from 80°N, so Europe and the Near East
get room for their many peoples. Each tile is sampled at 9 points: land where most of it is land. Terrain follows the real
climate: glaciers are snow; the far north is tundra; Natural Earth's deserts (Sahara, Arabia, Gobi, the Australian deserts,
Atacama, Kalahari...) are desert; steppes, plains and plateaus are plains; the wet tropics and temperate coasts are grassland.
Mountain ranges (Himalayas, Andes, Alps, Rockies...) raise mountains along their spines and hills around them; plateaus and
foothills are hilly. Forests follow the taiga and the temperate and tropical forest belts; the Amazon, Congo and South-East Asia
are rainforest; deltas and the Pantanal are marsh and floodplain. The great navigable rivers (Nile, Amazon, Mississippi,
Yangtze, Yellow River, Ganges, Indus, Euphrates, Danube, Volga, Rhine, Congo, Niger, Mekong) are traced from their real
courses. Every civilization starts at its historical capital (with alternates where two share a region), every city-state at
its real site, and every natural wonder where it is.
"""
import json, math, os, sys
from shapely.geometry import shape, Point, LineString
from shapely.prepared import prep
from shapely.ops import unary_union

W, H = 128, 80
TOP_LAT = 80.0
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "..", "content", "base", "data", "maps", "earth.json"))


# ----- projection ---------------------------------------------------------------------------------------------------
def miller_y(lat):
    return 1.25 * math.log(math.tan(math.pi / 4 + 0.4 * math.radians(lat)))

def miller_lat(y):
    return math.degrees(2.5 * math.atan(math.exp(0.8 * y)) - 0.625 * math.pi)

COL_DEG = 360.0 / W
ROW_Y = 0.8660254 * math.radians(COL_DEG)   # hex rows are 0.866 of a column apart
Y0 = miller_y(TOP_LAT)

def tile_center(col, row):
    lon = -180.0 + (col + 0.5 + (0.5 if row % 2 else 0.0)) * COL_DEG
    if lon > 180: lon -= 360
    return lon, miller_lat(Y0 - row * ROW_Y)

def tile_of(lon, lat):
    """The tile whose centre is nearest (lon, lat)."""
    row = round((Y0 - miller_y(max(min(lat, 84), -84))) / ROW_Y)
    row = max(0, min(H - 1, row))
    col = round((lon + 180.0) / COL_DEG - 0.5 - (0.5 if row % 2 else 0.0)) % W
    return col, row

def samples(col, row):
    """Nine points spread over the tile."""
    lon, lat = tile_center(col, row)
    lat_top = miller_lat(Y0 - (row - 0.45) * ROW_Y)
    lat_bot = miller_lat(Y0 - (row + 0.45) * ROW_Y)
    for fy in (0.0, 0.5, 1.0):
        for fx in (-0.4, 0.0, 0.4):
            yield ((lon + fx * COL_DEG + 180) % 360) - 180, lat_top + (lat_bot - lat_top) * fy

# hex neighbours (odd rows shifted east)
def neighbours(col, row):
    odd = row % 2
    for dc, dr in ((1, 0), (-1, 0), (0 + odd, -1), (-1 + odd, -1), (0 + odd, 1), (-1 + odd, 1)):
        r = row + dr
        if 0 <= r < H: yield (col + dc) % W, r

def offset_to_cube(col, row):
    q = col - (row - (row & 1)) // 2
    return q, row

def distance(a, b):
    best = 10 ** 9
    for wrap in (-W, 0, W):
        q1, r1 = offset_to_cube(a[0], a[1]); q2, r2 = offset_to_cube(b[0] + wrap, b[1])
        dq, dr = q1 - q2, r1 - r2
        best = min(best, (abs(dq) + abs(dr) + abs(dq + dr)) // 2)
    return best

def stable(col, row, salt):
    """A deterministic 0..1 value per tile (no RNG state)."""
    h = (col * 73856093) ^ (row * 19349663) ^ (salt * 83492791)
    h = (h ^ (h >> 13)) * 1274126177 & 0xFFFFFFFF
    return (h & 0xFFFF) / 65535.0


# ----- the real world -------------------------------------------------------------------------------------------------
# Historical capitals (lat, lon), with alternates for peoples that share a region.
STARTS = {
    "CIV_EGYPT": [(25.70, 32.64), (30.04, 31.24)],          # Thebes, Memphis
    "CIV_VENICE": [(45.44, 12.32)],
    "CIV_SONG": [(34.75, 114.30), (30.27, 120.16)],         # Kaifeng, Lin'an
    "CIV_MONGOLIA": [(47.20, 102.80), (47.92, 106.92)],     # Karakorum, Urga
    "CIV_INCA": [(-13.53, -71.97)],                          # Cusco
    "CIV_MALI": [(13.90, -4.55), (16.77, -3.01)],           # Niani region / Djenné, Timbuktu
    "CIV_ROME": [(41.90, 12.50)],
    "CIV_GREECE": [(37.98, 23.73)],
    "CIV_ZULU": [(-28.30, 31.40)],                           # Ulundi
    "CIV_NORWAY": [(59.91, 10.75), (63.43, 10.40)],         # Oslo, Trondheim
    "CIV_JAPAN": [(35.01, 135.77), (35.68, 139.69)],        # Kyoto, Edo
    "CIV_ENGLAND": [(51.51, -0.13)],
    "CIV_FRANCE": [(48.86, 2.35)],
    "CIV_RUSSIA": [(55.76, 37.62), (59.94, 30.31)],         # Moscow, St Petersburg
    "CIV_PERSIA": [(29.94, 52.89), (35.69, 51.39)],         # Persepolis, Tehran
    "CIV_AZTEC": [(19.43, -99.13)],                          # Tenochtitlan
    "CIV_MAYA": [(17.22, -89.62), (20.68, -88.57)],         # Tikal, Chichen Itza
    "CIV_ETHIOPIA": [(14.13, 38.72), (9.03, 38.74)],        # Aksum, Addis Ababa
    "CIV_OTTOMAN": [(41.01, 28.98), (39.93, 32.86), (40.18, 29.06)],   # Istanbul, Ankara, Bursa
    "CIV_ARABIA": [(21.42, 39.83), (24.47, 39.61), (33.31, 44.36)],    # Mecca, Medina, Baghdad
    "CIV_KOREA": [(37.57, 126.98), (35.84, 129.21)],        # Seoul, Gyeongju
    "CIV_INDIA": [(25.61, 85.14), (28.61, 77.21)],          # Pataliputra, Delhi
    "CIV_KHMER": [(13.41, 103.87)],                          # Angkor
    "CIV_NETHERLANDS": [(52.37, 4.90)],
    "CIV_PORTUGAL": [(38.72, -9.14)],
    "CIV_SPAIN": [(40.42, -3.70), (37.39, -5.98)],           # Madrid, Seville
    "CIV_BYZANTIUM": [(41.01, 28.98), (37.98, 23.73)],       # Constantinople, (Athens)
    "CIV_CARTHAGE": [(36.85, 10.32)],
    "CIV_BABYLON": [(32.54, 44.42)],
    "CIV_KONGO": [(-6.27, 14.25)],                           # Mbanza Kongo
    "CIV_POLAND": [(50.06, 19.94), (52.23, 21.01)],         # Kraków, Warsaw
    "CIV_SCOTLAND": [(55.95, -3.19)],
    "CIV_BRAZIL": [(-22.91, -43.17), (-12.97, -38.50)],     # Rio, Salvador
    "CIV_AMERICA": [(38.91, -77.04), (40.71, -74.01)],      # Washington, New York
    "CIV_VIETNAM": [(21.03, 105.85)],
    "CIV_HAUDENOSAUNEE": [(43.05, -76.15)],                  # Onondaga
    "CIV_GERMANY": [(52.52, 13.40), (48.14, 11.58)],        # Berlin, Munich
    "CIV_ITALY": [(43.77, 11.26), (45.46, 9.19)],           # Florence, Milan
}
CITY_STATES = {
    "CITYSTATE_UGARIT": (35.60, 35.78), "CITYSTATE_PERGAMON": (39.13, 27.18), "CITYSTATE_NALANDA": (25.14, 85.44),
    "CITYSTATE_KYRENE": (32.82, 21.86), "CITYSTATE_MITLA": (16.92, -96.36), "CITYSTATE_RAGUSA": (42.65, 18.09),
    "CITYSTATE_KILWA": (-8.96, 39.51), "CITYSTATE_PALMYRA": (34.55, 38.27), "CITYSTATE_MALACCA": (2.19, 102.25),
    "CITYSTATE_LHASA": (29.65, 91.10), "CITYSTATE_CAHOKIA": (38.66, -90.06), "CITYSTATE_BYBLOS": (34.12, 35.65),
    "CITYSTATE_HATTUSA": (40.02, 34.62), "CITYSTATE_DILMUN": (26.20, 50.50), "CITYSTATE_NAN_MADOL": (6.84, 158.33),
    "CITYSTATE_MONEMVASIA": (36.69, 23.04), "CITYSTATE_VALLETTA": (35.90, 14.50), "CITYSTATE_NGAZARGAMU": (13.00, 12.00),
}
# Islands too small for a 2.8° grid that the game needs: one land tile each.
FORCE_LAND = [(6.84, 158.33), (35.90, 14.50), (26.20, 50.50), (-0.6, -90.5)]
NATURAL_WONDERS = {
    "FEATURE_ULURU": (-25.34, 131.04), "FEATURE_KILIMANJARO": (-3.07, 37.35), "FEATURE_BARRIER_REEF": (-18.0, 147.5),
    "FEATURE_HA_LONG_BAY": (20.0, 107.5), "FEATURE_PAMUKKALE": (37.92, 29.12), "FEATURE_ZHANGJIAJIE": (29.32, 110.43),
    "FEATURE_TORRES_DEL_PAINE": (-50.94, -73.41), "FEATURE_GALAPAGOS": (-0.6, -91.5), "FEATURE_VICTORIA_FALLS": (-17.92, 25.86),
}
# The navigable Great Rivers (Natural Earth names, joined), and where each ends (the sea or a lake).
GREAT_RIVERS = {
    "Nile": ["Nile", "Rosetta Branch", "Damietta Branch"],
    "Amazon": ["Amazonas", "Amazon", "Solimões", "Ucayali"],
    "Mississippi": ["Mississippi"],
    "Yangtze": ["Chang Jiang", "Yangtze"],
    "Yellow River": ["Huang", "Huang He"],
    "Ganges": ["Ganges", "Ganga", "Padma"],
    "Indus": ["Indus"],
    "Euphrates": ["Euphrates", "Shatt al Arab", "Al Furat", "Tigris"],
    "Danube": ["Danube", "Donau", "Duna", "Dunav", "Dunărea"],
    "Volga": ["Volga"],
    "Rhine": ["Rhine", "Rhein", "Rijn"],
    "Congo": ["Congo"],
    "Niger": ["Niger"],
    "Mekong": ["Mekong"],
}
MAX_RIVER_TILES = 16
ISLAND_SCALE = 1.4
NARROW_SEAS = [((29.5, 32.6), (12.6, 43.4)), ((35.95, -6.2), (36.05, -5.2))]   # Red Sea (Suez to Bab-el-Mandeb), Gibraltar


def load(path):
    return json.load(open(path, encoding="utf-8"))["features"]

def main(ne):
    land_geoms = [shape(f["geometry"]) for f in load(os.path.join(ne, "ne_50m_land.geojson"))]
    land = prep(unary_union(land_geoms))
    islands = [part for g in land_geoms for part in (g.geoms if g.geom_type == "MultiPolygon" else [g]) if 0.4 <= part.area <= 400]
    lakes_all = [f for f in load(os.path.join(ne, "ne_50m_lakes.geojson")) if (f["properties"].get("scalerank") or 9) <= 2]
    lakes = prep(unary_union([shape(f["geometry"]) for f in lakes_all]))
    glaciers = prep(unary_union([shape(f["geometry"]) for f in load(os.path.join(ne, "ne_50m_glaciated_areas.geojson"))]))
    regions = {}
    for f in load(os.path.join(ne, "ne_50m_geography_regions_polys.geojson")):
        cls = f["properties"].get("FEATURECLA")
        regions.setdefault(cls, []).append((f["properties"].get("NAME") or "", shape(f["geometry"])))
    def region(cls, names=None):
        geoms = [g for n, g in regions.get(cls, []) if names is None or n.upper() in names]
        return prep(unary_union(geoms)) if geoms else None
    mountains = region("Range/mtn")
    deserts = region("Desert")
    plateaus = region("Plateau")
    plains = region("Plain")
    lowlands = region("Lowland")
    tundra = region("Tundra")
    foothills = region("Foothills")
    wet = region("Wetlands")
    deltas = region("Delta")
    basins_rain = region("Basin", {"CONGO BASIN", "AMAZON BASIN"})
    basins_dry = region("Basin", {"GREAT BASIN", "TARIM BASIN", "JUNGGAR BASIN", "QAIDAM BASIN", "GREAT ARTESIAN BASIN"})
    steppe = region("Plain", {"KAZAKH STEPPE", "PONTIC STEPPE", "GREAT PLAINS", "SAHEL", "PAMPAS", "GRAN CHACO", "CHACO BOREAL", "CHACO AUSTRAL",
                              "TURAN LOWLAND", "NULLARBOR PLAIN", "LLANOS", "IWEMBERE STEPPE"})
    selvas = region("Foothills", {"SELVAS", "YUNGAS"})

    def frac(pred, col, row):
        pts = list(samples(col, row))
        return sum(1 for lon, lat in pts if pred.contains(Point(lon, lat))) / len(pts) if pred else 0.0

    # ----- land, lakes, ice ------------------------------------------------------------------------------------------
    T = [["o"] * W for _ in range(H)]
    R = [["."] * W for _ in range(H)]
    F = [["."] * W for _ in range(H)]
    for row in range(H):
        for col in range(W):
            if frac(land, col, row) >= 0.34: T[row][col] = "L"
    # Islands keep their true size: a thin or diagonal island (Japan, Britain, Ireland, the Philippines...) gets as many tiles
    # as its area covers, its best-covered tiles first, instead of losing every tile that is less than a third land.
    added = 0
    for isle in islands:
        minx, miny, maxx, maxy = isle.bounds
        pisle = prep(isle)
        cover = {}
        c0, r0 = tile_of(minx, maxy); c1, r1 = tile_of(maxx, miny)
        for row in range(max(0, r0 - 1), min(H, r1 + 2)):
            cols = range(c0 - 1, c1 + 2) if c1 >= c0 else list(range(c0 - 1, W)) + list(range(0, c1 + 2))
            for col in cols:
                col %= W
                pts = list(samples(col, row))
                k = sum(1 for lon, lat in pts if pisle.contains(Point(lon, lat))) / len(pts)
                if k > 0: cover[(col, row)] = k
        expected = max(1, round(sum(cover.values())))
        have = sum(1 for (c, r) in cover if T[r][c] == "L")
        # Medium islands that host peoples (Japan, Britain, Ireland, Sri Lanka, Taiwan, New Zealand, Cuba...) are drawn 1.4x
        # their true size, as maps of the world for play usually do, so an island people has room for a few cities.
        if 2 <= isle.area <= 60: expected = round(expected * ISLAND_SCALE)
        for (c, r), k in sorted(cover.items(), key=lambda kv: -kv[1]):
            if have >= expected: break
            if T[r][c] != "L": T[r][c] = "L"; have += 1; added += 1
        cx, cy = isle.centroid.x, isle.centroid.y
        while have < expected:
            mine = [t for t in cover if T[t[1]][t[0]] == "L"]
            ring = {nb for t in mine for nb in neighbours(*t) if T[nb[1]][nb[0]] != "L"}
            # Grow into open water only (never fuse with another coast) toward the island's own centre.
            ring = [t for t in ring if all(T[r][c] != "L" or (c, r) in cover for c, r in neighbours(*t))]
            if not ring: break
            pick = min(ring, key=lambda t: (abs(tile_center(*t)[0] - cx) + abs(tile_center(*t)[1] - cy), t))
            T[pick[1]][pick[0]] = "L"; cover[pick] = 0.01; have += 1; added += 1
    print(f"islands: {added} tiles restored")
    for lat, lon in FORCE_LAND + [(la, lo) for la, lo in (c for c in CITY_STATES.values())]:
        c, r = tile_of(lon, lat)
        T[r][c] = "L"
    for (lat, lon) in [v[0] for v in STARTS.values()]:
        c, r = tile_of(lon, lat)
        T[r][c] = "L"
    for row in range(H):
        for col in range(W):
            if T[row][col] == "L" and frac(lakes, col, row) >= 0.5: T[row][col] = "l"
    # Narrow seas the grid would close: the Red Sea and the Strait of Gibraltar stay open.
    for (lat0, lon0), (lat1, lon1) in NARROW_SEAS:
        for k in range(41):
            c, r = tile_of(lon0 + (lon1 - lon0) * k / 40, lat0 + (lat1 - lat0) * k / 40)
            T[r][c] = "o"
    # Coasts: water next to land.
    for row in range(H):
        for col in range(W):
            if T[row][col] == "o" and any(T[r][c] == "L" for c, r in neighbours(col, row)): T[row][col] = "c"

    # ----- relief -----------------------------------------------------------------------------------------------------
    for row in range(H):
        for col in range(W):
            if T[row][col] != "L": continue
            m, p, fh = frac(mountains, col, row), frac(plateaus, col, row), frac(foothills, col, row)
            noise = stable(col, row, 1)
            if m >= 0.55 and noise < 0.7: R[row][col] = "m"
            elif m >= 0.2 or p >= 0.5 and noise < 0.45 or fh >= 0.5 and noise < 0.6: R[row][col] = "h"
            elif noise < 0.06: R[row][col] = "h"
    # Mountain ranges need passes: never a solid wall more than two tiles thick across.
    for row in range(H):
        for col in range(W):
            if R[row][col] == "m" and sum(1 for c, r in neighbours(col, row) if R[r][c] == "m") >= 5 and stable(col, row, 2) < 0.35:
                R[row][col] = "h"

    # ----- climate and terrain ----------------------------------------------------------------------------------------
    TER = [[None] * W for _ in range(H)]
    for row in range(H):
        for col in range(W):
            t = T[row][col]
            if t != "L":
                TER[row][col] = {"o": "o", "c": "c", "l": "l"}[t]
                continue
            lon, lat = tile_center(col, row)
            a = abs(lat)
            n = stable(col, row, 3)
            if frac(glaciers, col, row) >= 0.5 or a >= 72 or lat <= -60: ter = "S"
            elif a >= 64 or frac(tundra, col, row) >= 0.5 and a >= 56 or R[row][col] == "m" and a >= 50: ter = "T"
            elif frac(deserts, col, row) >= 0.4: ter = "D"
            elif frac(basins_dry, col, row) >= 0.5: ter = "D" if n < 0.5 else "P"
            elif frac(steppe, col, row) >= 0.4 or frac(plateaus, col, row) >= 0.5: ter = "P"
            elif a < 12: ter = "G"
            elif a < 24: ter = "P" if n < 0.55 else "G"          # savanna
            elif a < 38:
                # Mediterranean, Middle East and southern US: plains; monsoon Asia and the eastern seaboards: grassland.
                ter = "G" if (100 <= lon <= 145 and lat > 0) or (-90 <= lon <= -75 and lat > 0) or (-60 <= lon <= -40 and lat < 0) or (lon >= 145 and lat < 0) else ("P" if n < 0.7 else "G")
            elif a < 56:
                ter = "G" if (-12 <= lon <= 40) or lon >= 120 or (-100 <= lon <= -60) or (lon <= -115 and lat > 0) else "P"
            else: ter = "P" if n < 0.6 else "G"   # boreal
            TER[row][col] = ter

    # ----- features ---------------------------------------------------------------------------------------------------
    for row in range(H):
        for col in range(W):
            if TER[row][col] in ("o", "c", "l"):
                lon, lat = tile_center(col, row)
                if abs(lat) >= 74 and TER[row][col] != "l" and stable(col, row, 4) < 0.75: F[row][col] = "i"
                continue
            if R[row][col] == "m": continue
            lon, lat = tile_center(col, row)
            a = abs(lat)
            ter = TER[row][col]
            n = stable(col, row, 5)
            if ter in ("S", "D"): continue
            if frac(deltas, col, row) >= 0.3 or frac(wet, col, row) >= 0.4: F[row][col] = "m" if n < 0.5 else "p"; continue
            rainforest = frac(basins_rain, col, row) >= 0.3 or frac(selvas, col, row) >= 0.3 or \
                         (a < 12 and (95 <= lon <= 155 or -85 <= lon <= -35 or -15 <= lon <= 30) and ter == "G") or \
                         (8 <= lat <= 24 and 92 <= lon <= 110 and ter == "G")
            if rainforest and n < 0.62: F[row][col] = "j"; continue
            if 52 <= a < 66 and ter in ("P", "G", "T") and n < (0.55 if ter != "T" else 0.3): F[row][col] = "f"; continue   # taiga
            if 30 <= a < 52 and ter == "G" and n < 0.32: F[row][col] = "f"; continue
            if a < 30 and ter in ("G", "P") and n < 0.14: F[row][col] = "f"; continue
            if frac(lowlands, col, row) >= 0.5 and n > 0.85: F[row][col] = "m"

    # ----- the great rivers -------------------------------------------------------------------------------------------
    rivers_ne = load(os.path.join(ne, "ne_50m_rivers_lake_centerlines.geojson"))
    rivers = []
    taken_starts = {tile_of(lon, lat) for v in STARTS.values() for lat, lon in v}
    for river, names in GREAT_RIVERS.items():
        lines = []
        for f in rivers_ne:
            nm = f["properties"].get("name") or ""
            if nm in names or (f["properties"].get("name_en") or "") in names:
                g = shape(f["geometry"])
                lines.extend(g.geoms if g.geom_type == "MultiLineString" else [g])
        if not lines: print("no river", river); continue
        # Every tile the river passes through, then the longest chain that starts at the sea.
        tiles = set()
        for line in lines:
            length = line.length
            steps = max(2, int(length / (COL_DEG / 4)))
            for k in range(steps + 1):
                p = line.interpolate(k / steps, normalized=True)
                c, r = tile_of(p.x, p.y)
                if TER[r][c] not in ("o", "c", "l") and R[r][c] != "m": tiles.add((c, r))
        mouths = [t for t in tiles if any(TER[r][c] in ("c", "o") for c, r in neighbours(*t))]
        if not mouths:
            # The traced course stops short of the sea: carry it on over land to the nearest coast (up to three tiles).
            prev = {t: None for t in tiles}; queue = list(tiles); found = None
            while queue and found is None:
                cur = queue.pop(0)
                for nb in neighbours(*cur):
                    if nb in prev or TER[nb[1]][nb[0]] in ("o", "c", "l") or R[nb[1]][nb[0]] == "m": continue
                    prev[nb] = cur; queue.append(nb)
                    if any(TER[r][c] in ("c", "o") for c, r in neighbours(*nb)): found = nb; break
            hops = []
            node = found
            while node is not None and node not in tiles: hops.append(node); node = prev[node]
            if found is None or len(hops) > 3: print("no mouth", river); continue
            tiles.update(hops)
            mouths = [found]
        # BFS from the mouth through river tiles; take the farthest path.
        best_path = []
        def land_tile(t): return TER[t[1]][t[0]] not in ("o", "c", "l") and R[t[1]][t[0]] != "m"
        for mouth in mouths:
            prev = {mouth: None}; queue = [mouth]; far = mouth
            while queue:
                cur = queue.pop(0); far = cur
                # Next tiles of the course: neighbours, or one tile further when the course skips a tile (bridged below).
                for nb in sorted(tiles, key=lambda t: (t[1], t[0])):
                    if nb not in prev and distance(cur, nb) in (1, 2):
                        prev[nb] = cur; queue.append(nb)
            path = []
            node = far
            while node is not None: path.append(node); node = prev[node]
            path.reverse()
            # Bridge two-tile steps with a shared land neighbour so the channel is contiguous.
            bridged = [path[0]]
            for t in path[1:]:
                if distance(bridged[-1], t) == 2:
                    mid = next((m for m in neighbours(*bridged[-1]) if distance(m, t) == 1 and land_tile(m)), None)
                    if mid is None: break
                    bridged.append(mid)
                bridged.append(t)
            if len(bridged) > len(best_path): best_path = bridged
        clean = best_path[:MAX_RIVER_TILES]   # starts on a channel step onto the bank when the game begins
        if len(clean) >= 3:
            rivers.append({"name": river, "tiles": [[c, r] for c, r in clean]})
            print(f"{river}: {len(clean)} tiles")
        else: print(f"{river}: too short ({len(tiles)} tiles touched, {len(mouths)} mouths, path {len(best_path)})")

    # ----- elevation (for drainage, minor rivers and sea-level bands) --------------------------------------------------
    dist = [[0 if TER[r][c] in ("o", "c", "l") else 99 for c in range(W)] for r in range(H)]
    frontier = [(c, r) for r in range(H) for c in range(W) if dist[r][c] == 0]
    while frontier:
        nxt = []
        for c, r in frontier:
            for nc, nr in neighbours(c, r):
                if dist[nr][nc] > dist[r][c] + 1: dist[nr][nc] = dist[r][c] + 1; nxt.append((nc, nr))
        frontier = nxt
    E = []
    for r in range(H):
        line = ""
        for c in range(W):
            if TER[r][c] in ("o", "c", "l"): line += "0"; continue
            e = 1 + min(4, dist[r][c] // 2) + (2 if R[r][c] == "h" else 4 if R[r][c] == "m" else 0)
            line += str(min(9, e))
        E.append(line)

    # ----- places -----------------------------------------------------------------------------------------------------
    def snap(lat, lon, water_ok=False):
        c, r = tile_of(lon, lat)
        if water_ok or TER[r][c] not in ("o", "c", "l"): return [c, r]
        for nc, nr in neighbours(c, r):
            if TER[nr][nc] not in ("o", "c", "l"): return [nc, nr]
        return [c, r]
    starts = {civ: [snap(lat, lon) for lat, lon in spots] for civ, spots in STARTS.items()}
    city_states = {cs: snap(lat, lon) for cs, (lat, lon) in CITY_STATES.items()}
    wonders = {}
    for fid, (lat, lon) in NATURAL_WONDERS.items():
        water = fid in ("FEATURE_BARRIER_REEF", "FEATURE_HA_LONG_BAY", "FEATURE_GALAPAGOS")
        c, r = tile_of(lon, lat)
        if water:
            cands = [(c, r)] + list(neighbours(c, r))
            pick = next((t for t in cands if TER[t[1]][t[0]] == "c"), None) or next((t for t in cands if TER[t[1]][t[0]] in ("o", "c")), (c, r))
            if TER[pick[1]][pick[0]] == "o": TER[pick[1]][pick[0]] = "c"
            wonders[fid] = list(pick)
        else:
            wonders[fid] = snap(lat, lon)
            wc, wr = wonders[fid]
            if TER[wr][wc] in ("S", "T") and fid != "FEATURE_TORRES_DEL_PAINE": TER[wr][wc] = "P"
            if fid == "FEATURE_ULURU": TER[wr][wc] = "D"
            R[wr][wc] = "."; F[wr][wc] = "."

    out = {
        "maps": [{
            "id": "MAP_EARTH", "name": "Earth",
            "description": "The real world on a 128 × 80 hex grid (Natural Earth data, Miller projection from 80°N): true coastlines, "
                           "mountain ranges, deserts, forests and great rivers, with every civilization at its historical capital and every "
                           "city-state and natural wonder at its real site.",
            "width": W, "height": H, "wrapX": True,
            "terrain": ["".join(TER[r]) for r in range(H)],
            "relief": ["".join(R[r]) for r in range(H)],
            "features": ["".join(F[r]) for r in range(H)],
            "elevation": E,
            "greatRivers": rivers,
            "starts": starts, "cityStates": city_states, "naturalWonders": wonders,
        }]
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("// Generated by tools/maps/earth.py from Natural Earth (public domain). Do not edit by hand.\n")
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    land_tiles = sum(1 for r in range(H) for c in range(W) if TER[r][c] not in ("o", "c", "l"))
    print(f"wrote {OUT}: {land_tiles} land tiles of {W * H}, {len(rivers)} great rivers")
    # A quick look in the terminal.
    glyph = {"o": " ", "c": "·", "l": "~", "G": "g", "P": "p", "D": "d", "T": "t", "S": "*"}
    for r in range(H):
        print("".join("^" if R[r][c] == "m" else glyph[TER[r][c]] for c in range(W)))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "NE/geojson")
