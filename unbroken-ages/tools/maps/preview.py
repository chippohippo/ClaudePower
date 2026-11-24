"""Draws a scripted map (content/base/data/maps/*.json) as a PNG: hexes coloured by terrain, relief and feature, Great Rivers
in blue, and every true start location labelled (civilizations in white, city-states in gold, natural wonders in green).

python3 tools/maps/preview.py [map.json] [out.png]
"""
import json, math, os, re, sys
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "..", "..", "content", "base", "data", "maps", "earth.json")
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, "..", "..", "docs", "screenshots", "earth-map.png")
S = 13   # hex radius in pixels

TERRAIN = {"o": (28, 64, 110), "c": (58, 118, 160), "l": (70, 140, 180), "G": (104, 160, 72), "P": (176, 168, 96),
           "D": (226, 202, 140), "T": (150, 160, 150), "S": (236, 240, 244)}
FEATURE = {"f": (46, 110, 52), "j": (24, 90, 40), "m": (90, 130, 110), "p": (150, 170, 80), "i": (220, 232, 240)}

def main():
    text = open(SRC, encoding="utf-8").read()
    m = json.loads(re.sub(r"^\s*//.*$", "", text, flags=re.M))["maps"][0]
    W, H = m["width"], m["height"]
    dx, dy = math.sqrt(3) * S, 1.5 * S
    img = Image.new("RGB", (int(dx * (W + 0.5)) + 4, int(dy * H + S) + 4), (20, 40, 70))
    d = ImageDraw.Draw(img)
    def centre(c, r): return (dx * (c + 0.5 + 0.5 * (r % 2)) + 2, dy * r + S + 2)
    def hexagon(c, r, colour, outline=None):
        x, y = centre(c, r)
        pts = [(x + S * math.cos(math.radians(60 * k - 30)), y + S * math.sin(math.radians(60 * k - 30))) for k in range(6)]
        d.polygon(pts, fill=colour, outline=outline)
    for r in range(H):
        for c in range(W):
            t, rel, f = m["terrain"][r][c], m["relief"][r][c], m["features"][r][c]
            col = FEATURE.get(f, TERRAIN[t]) if t not in "ocl" or f == "i" else TERRAIN[t]
            if rel == "h": col = tuple(int(v * 0.82) for v in col)
            if rel == "m": col = (120, 104, 90)
            hexagon(c, r, col)
            if rel == "m":
                x, y = centre(c, r)
                d.polygon([(x - 6, y + 5), (x, y - 7), (x + 6, y + 5)], fill=(235, 235, 235))
    for river in m["greatRivers"]:
        pts = [centre(c, r) for c, r in river["tiles"]]
        d.line(pts, fill=(80, 170, 255), width=5)
    try: font = ImageFont.truetype("DejaVuSans-Bold.ttf", 11)
    except OSError: font = ImageFont.load_default()
    def label(c, r, name, colour, dot):
        x, y = centre(c, r)
        d.ellipse((x - 4, y - 4, x + 4, y + 4), fill=dot, outline=(0, 0, 0))
        d.text((x + 6, y - 7), name, fill=colour, font=font, stroke_width=2, stroke_fill=(0, 0, 0))
    for wonder, (c, r) in m["naturalWonders"].items():
        label(c, r, wonder.replace("FEATURE_", "").replace("_", " ").title(), (150, 255, 150), (60, 220, 60))
    for cs, (c, r) in m["cityStates"].items():
        label(c, r, cs.replace("CITYSTATE_", "").replace("_", " ").title(), (255, 215, 120), (240, 190, 60))
    for civ, spots in m["starts"].items():
        c, r = spots[0]
        label(c, r, civ.replace("CIV_", "").replace("_", " ").title(), (255, 255, 255), (230, 60, 60))
    img.save(OUT)
    print("wrote", OUT, img.size)

if __name__ == "__main__":
    main()
