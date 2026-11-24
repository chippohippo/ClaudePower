"""Generates the wonder models: world wonders (built in cities) and natural wonders (placed by the map generator).
Original low-poly geometry, flat-shaded, CC0 like the rest of the kit.

python3 tools/assets/wonders.py      -> godot/assets/models/wonders/*.glb

Each model stands on y = 0, is centred on x/z, and is about 1 unit wide (the map fits it to a hex).
World wonders: giza, hanging_gardens, oracle, colossus, great_library, terracotta, machu_picchu, hagia_sophia, forbidden_city,
               oxford, big_ben, eiffel, opera_house, launch_complex
Natural wonders: uluru, kilimanjaro, barrier_reef, ha_long, pamukkale, zhangjiajie, torres_del_paine, galapagos, victoria_falls
"""
import math, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from landmarks import Mesh  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "..", "godot", "assets", "models", "wonders"))

SAND, SAND_DARK, GOLD = (0.84, 0.66, 0.4), (0.64, 0.48, 0.3), (0.98, 0.74, 0.18)
MARBLE, MARBLE_DARK = (0.93, 0.91, 0.86), (0.74, 0.72, 0.68)
STONE, STONE_DARK, GRANITE = (0.62, 0.6, 0.56), (0.45, 0.43, 0.4), (0.52, 0.5, 0.5)
GREEN, GREEN_DARK, LEAF = (0.3, 0.55, 0.25), (0.2, 0.4, 0.18), (0.42, 0.68, 0.3)
BRONZE, COPPER, TERRACOTTA = (0.66, 0.46, 0.22), (0.32, 0.6, 0.52), (0.7, 0.4, 0.28)
RED, ROOF_GOLD, BRICK, IRON = (0.68, 0.14, 0.12), (0.92, 0.68, 0.16), (0.62, 0.28, 0.18), (0.36, 0.3, 0.26)
WHITE, BLUE, WATER, FOAM = (0.95, 0.94, 0.9), (0.24, 0.42, 0.68), (0.24, 0.56, 0.7), (0.9, 0.96, 1.0)
OCHRE, OCHRE_DARK, SNOW, ROCK = (0.78, 0.36, 0.18), (0.6, 0.26, 0.14), (0.96, 0.97, 1.0), (0.5, 0.46, 0.42)
CORAL_A, CORAL_B, CORAL_C, TRAVERTINE = (0.95, 0.45, 0.45), (0.98, 0.72, 0.3), (0.6, 0.4, 0.85), (0.96, 0.95, 0.9)


def frustum(m, colour, cx, cz, r0, r1, y0, y1, sides=12, top=None):
    """A tapered cylinder (r0 at the bottom, r1 at the top)."""
    top = top or colour
    ring = [(math.cos(i * 2 * math.pi / sides), math.sin(i * 2 * math.pi / sides)) for i in range(sides)]
    for i in range(sides):
        (ax, az), (bx, bz) = ring[i], ring[(i + 1) % sides]
        a0, b0 = (cx + ax * r0, y0, cz + az * r0), (cx + bx * r0, y0, cz + bz * r0)
        a1, b1 = (cx + ax * r1, y1, cz + az * r1), (cx + bx * r1, y1, cz + bz * r1)
        m.quad(colour, a0, a1, b1, b0)
        if r1 > 0:
            m.tri(top, (cx, y1, cz), b1, a1)


def dome(m, colour, cx, cz, r, y0, rings=5, sides=14):
    prev_r, prev_y = r, y0
    for i in range(1, rings + 1):
        a = i / rings * math.pi / 2
        nr, ny = r * math.cos(a), y0 + r * math.sin(a)
        frustum(m, colour, cx, cz, prev_r, max(nr, 0.0), prev_y, ny, sides)
        prev_r, prev_y = nr, ny


def colonnade(m, colour, x0, x1, z, y0, y1, n, r=0.025):
    for i in range(n):
        x = x0 + (x1 - x0) * i / max(1, n - 1)
        m.cylinder(colour, x, z, r, y0, y1, sides=8)


def gable(m, colour, x0, x1, z0, z1, y0, y1):
    zc = (z0 + z1) / 2
    m.quad(colour, (x0, y0, z0), (x0, y1, zc), (x1, y1, zc), (x1, y0, z0))
    m.quad(colour, (x1, y0, z1), (x1, y1, zc), (x0, y1, zc), (x0, y0, z1))
    m.tri(colour, (x0, y0, z1), (x0, y1, zc), (x0, y0, z0))
    m.tri(colour, (x1, y0, z0), (x1, y1, zc), (x1, y0, z1))


def hip_roof(m, colour, cx, cz, hx, hz, y0, y1, over=0.06):
    """A sweeping Chinese hip roof: a low frustum with flared eaves."""
    x0, x1, z0, z1 = cx - hx - over, cx + hx + over, cz - hz - over, cz + hz + over
    ix0, ix1 = cx - hx * 0.55, cx + hx * 0.55
    m.quad(colour, (x0, y0, z0), (ix0, y1, cz), (ix1, y1, cz), (x1, y0, z0))
    m.quad(colour, (x1, y0, z1), (ix1, y1, cz), (ix0, y1, cz), (x0, y0, z1))
    m.tri(colour, (x0, y0, z1), (ix0, y1, cz), (x0, y0, z0))
    m.tri(colour, (x1, y0, z0), (ix1, y1, cz), (x1, y0, z1))


# ----- World wonders -----------------------------------------------------------------------------------------------

def giza():
    m = Mesh()
    m.box(SAND_DARK, -0.6, 0, -0.6, 0.6, 0.03, 0.6)
    m.pyramid(SAND, -0.12, -0.1, 0.5, 0.03, 0.78)
    m.pyramid(GOLD, -0.12, -0.1, 0.06, 0.72, 0.8)
    m.pyramid(SAND, 0.32, 0.3, 0.32, 0.03, 0.5)
    m.pyramid(SAND, -0.42, 0.38, 0.2, 0.03, 0.32)
    return m


def hanging_gardens():
    m = Mesh()
    for i, (h, y) in enumerate([(0.55, 0.0), (0.42, 0.16), (0.3, 0.32), (0.18, 0.48)]):
        m.box(SAND, -h, y, -h, h, y + 0.16, h, top=GREEN)
        for k in range(6):   # hanging greenery on each terrace's edge
            x = -h + (2 * h) * (k + 0.5) / 6
            m.box(LEAF, x - 0.03, y + 0.06, h, x + 0.03, y + 0.16, h + 0.03)
    for (x, z) in [(-0.3, -0.3), (0.3, -0.3), (0.2, 0.25), (-0.15, 0.1)]:
        m.cylinder(BRONZE, x, z, 0.015, 0.48, 0.6, sides=6)
        frustum(m, GREEN_DARK, x, z, 0.08, 0.0, 0.58, 0.78, sides=7)
    return m


def oracle():
    m = Mesh()
    m.box(STONE, -0.5, 0, -0.32, 0.5, 0.05, 0.32)
    m.box(MARBLE_DARK, -0.42, 0.05, -0.25, 0.42, 0.09, 0.25)
    colonnade(m, MARBLE, -0.38, 0.38, -0.22, 0.09, 0.45, 7)
    colonnade(m, MARBLE, -0.38, 0.38, 0.22, 0.09, 0.45, 7)
    m.box(MARBLE, -0.42, 0.45, -0.26, 0.42, 0.5, 0.26)
    gable(m, MARBLE_DARK, -0.42, 0.42, -0.26, 0.26, 0.5, 0.64)
    m.cylinder(GOLD, 0, 0, 0.05, 0.09, 0.14, sides=10)   # the tripod's brazier
    return m


def colossus():
    m = Mesh()
    m.box(STONE, -0.3, 0, -0.3, 0.3, 0.18, 0.3)
    m.box(STONE_DARK, -0.22, 0.18, -0.22, 0.22, 0.24, 0.22)
    # legs astride, a robed body, a raised torch arm, a radiant crown
    m.box(BRONZE, -0.12, 0.24, -0.05, -0.04, 0.6, 0.05)
    m.box(BRONZE, 0.04, 0.24, -0.05, 0.12, 0.6, 0.05)
    m.box(BRONZE, -0.13, 0.58, -0.07, 0.13, 0.92, 0.07)
    m.box(BRONZE, 0.12, 0.82, -0.03, 0.18, 1.12, 0.03)
    frustum(m, GOLD, 0.15, 0, 0.04, 0.0, 1.12, 1.22, sides=6)
    m.cylinder(BRONZE, 0, 0, 0.07, 0.92, 1.04, sides=10)
    for k in range(7):
        a = k * 2 * math.pi / 7
        m.box(GOLD, math.cos(a) * 0.07 - 0.01, 1.04, math.sin(a) * 0.07 - 0.01, math.cos(a) * 0.07 + 0.01, 1.11, math.sin(a) * 0.07 + 0.01)
    return m


def great_library():
    m = Mesh()
    m.box(MARBLE_DARK, -0.55, 0, -0.4, 0.55, 0.06, 0.4)
    m.box(SAND, -0.45, 0.06, -0.3, 0.45, 0.42, 0.3)
    colonnade(m, MARBLE, -0.45, 0.45, 0.34, 0.06, 0.42, 9)
    m.box(MARBLE, -0.5, 0.42, -0.34, 0.5, 0.47, 0.38)
    gable(m, MARBLE_DARK, -0.5, 0.5, -0.34, 0.38, 0.47, 0.6)
    dome(m, COPPER, 0, -0.05, 0.16, 0.6)
    return m


def terracotta():
    m = Mesh()
    m.box(OCHRE_DARK, -0.6, 0, -0.5, 0.6, 0.04, 0.5)
    for row in range(5):
        z = -0.38 + row * 0.19
        m.box(OCHRE, -0.58, 0.04, z + 0.07, 0.58, 0.1, z + 0.1)   # trench walls
        for col in range(7):
            x = -0.45 + col * 0.15
            m.box(TERRACOTTA, x - 0.03, 0.04, z - 0.02, x + 0.03, 0.17, z + 0.02)
            m.cylinder(TERRACOTTA, x, z, 0.022, 0.17, 0.21, sides=6)
    return m


def machu_picchu():
    m = Mesh()
    frustum(m, ROCK, 0, 0, 0.6, 0.35, 0, 0.3, sides=9, top=GREEN)
    frustum(m, ROCK, 0.25, -0.25, 0.2, 0.02, 0.2, 0.95, sides=7)   # the peak behind
    for k, (x, z) in enumerate([(-0.15, 0.1), (0.05, 0.12), (-0.05, -0.1), (0.15, 0.0), (-0.25, -0.05)]):
        m.box(STONE, x - 0.05, 0.3, z - 0.04, x + 0.05, 0.38, z + 0.04)
        gable(m, (0.62, 0.5, 0.26), x - 0.06, x + 0.06, z - 0.05, z + 0.05, 0.38, 0.45)
    for ring in range(3):   # terraces down the slope
        frustum(m, GREEN_DARK, 0, 0, 0.62 - ring * 0.02, 0.6 - ring * 0.02, 0.0 + ring * 0.08, 0.02 + ring * 0.08, sides=9)
    return m


def hagia_sophia():
    m = Mesh()
    m.box(SAND_DARK, -0.55, 0, -0.45, 0.55, 0.04, 0.45)
    m.box((0.82, 0.58, 0.48), -0.38, 0.04, -0.32, 0.38, 0.36, 0.32)
    dome(m, (0.55, 0.58, 0.62), 0, 0, 0.3, 0.36, rings=6, sides=18)
    for x in (-0.32, 0.32):
        dome(m, (0.55, 0.58, 0.62), x, 0, 0.12, 0.36)
    for (x, z) in [(-0.5, -0.4), (0.5, -0.4), (-0.5, 0.4), (0.5, 0.4)]:   # minarets
        m.cylinder(MARBLE, x, z, 0.035, 0.04, 0.85, sides=8)
        frustum(m, (0.55, 0.58, 0.62), x, z, 0.04, 0.0, 0.85, 1.0, sides=8)
    m.cylinder(GOLD, 0, 0, 0.012, 0.66, 0.74, sides=6)
    return m


def forbidden_city():
    m = Mesh()
    m.box(MARBLE, -0.6, 0, -0.45, 0.6, 0.06, 0.45)
    m.box(MARBLE_DARK, -0.45, 0.06, -0.3, 0.45, 0.12, 0.3)
    m.box(RED, -0.38, 0.12, -0.22, 0.38, 0.34, 0.22)
    hip_roof(m, ROOF_GOLD, 0, 0, 0.38, 0.22, 0.34, 0.46, over=0.08)
    m.box(RED, -0.26, 0.46, -0.14, 0.26, 0.56, 0.14)
    hip_roof(m, ROOF_GOLD, 0, 0, 0.26, 0.14, 0.56, 0.7, over=0.07)
    for x in (-0.52, 0.52):   # gate pavilions
        m.box(RED, x - 0.07, 0.06, -0.38, x + 0.07, 0.2, -0.26)
        hip_roof(m, ROOF_GOLD, x, -0.32, 0.07, 0.06, 0.2, 0.27, over=0.04)
    return m


def oxford():
    m = Mesh()
    m.box(STONE_DARK, -0.55, 0, -0.45, 0.55, 0.03, 0.45)
    m.box((0.82, 0.74, 0.56), -0.45, 0.03, -0.12, 0.45, 0.36, 0.12)
    gable(m, STONE_DARK, -0.45, 0.45, -0.12, 0.12, 0.36, 0.5)
    m.box((0.82, 0.74, 0.56), -0.12, 0.03, 0.12, 0.12, 0.3, 0.42)
    dome(m, (0.4, 0.42, 0.44), 0, 0.27, 0.12, 0.3)   # the round reading room
    for x in (-0.45, -0.15, 0.15, 0.45):   # pinnacles and spires
        frustum(m, (0.82, 0.74, 0.56), x, -0.12, 0.035, 0.0, 0.36, 0.62, sides=6)
    m.box((0.82, 0.74, 0.56), -0.06, 0.36, -0.06, 0.06, 0.7, 0.06)
    frustum(m, STONE_DARK, 0, 0, 0.07, 0.0, 0.7, 0.95, sides=8)
    return m


def big_ben():
    m = Mesh()
    m.box(STONE_DARK, -0.5, 0, -0.3, 0.5, 0.03, 0.3)
    m.box((0.8, 0.7, 0.48), -0.48, 0.03, -0.12, 0.2, 0.3, 0.12)   # the palace wing
    gable(m, (0.35, 0.4, 0.42), -0.48, 0.2, -0.12, 0.12, 0.3, 0.38)
    m.box((0.8, 0.7, 0.48), 0.2, 0.03, -0.1, 0.4, 0.85, 0.1)
    m.box(GOLD, 0.18, 0.7, -0.12, 0.42, 0.85, 0.12)
    for side in (-1, 1):   # clock faces
        m.box(WHITE, 0.24, 0.73, side * 0.121 - 0.001, 0.36, 0.83, side * 0.121 + 0.001)
    m.box((0.8, 0.7, 0.48), 0.22, 0.85, -0.08, 0.38, 0.95, 0.08)
    frustum(m, (0.3, 0.32, 0.38), 0.3, 0, 0.11, 0.0, 0.95, 1.2, sides=4)
    return m


def eiffel():
    m = Mesh()
    m.box((0.5, 0.6, 0.38), -0.55, 0, -0.55, 0.55, 0.02, 0.55)
    legs = [(-0.38, -0.38), (0.38, -0.38), (0.38, 0.38), (-0.38, 0.38)]
    for (x, z) in legs:   # four splayed legs leaning in
        for (a, b, c, d) in [((x, 0.02, z), (x * 0.55, 0.32, z * 0.55), (x * 0.5, 0.32, z * 0.5), (x * 0.85, 0.02, z * 0.85))]:
            m.quad(IRON, a, b, c, d)
            m.quad(IRON, d, c, b, a)
    m.box(IRON, -0.24, 0.3, -0.24, 0.24, 0.34, 0.24)   # first platform
    for (x, z) in legs:
        m.quad(IRON, (x * 0.55, 0.34, z * 0.55), (x * 0.25, 0.65, z * 0.25), (x * 0.2, 0.65, z * 0.2), (x * 0.45, 0.34, z * 0.45))
        m.quad(IRON, (x * 0.45, 0.34, z * 0.45), (x * 0.2, 0.65, z * 0.2), (x * 0.25, 0.65, z * 0.25), (x * 0.55, 0.34, z * 0.55))
    m.box(IRON, -0.1, 0.63, -0.1, 0.1, 0.66, 0.1)
    frustum(m, IRON, 0, 0, 0.08, 0.015, 0.66, 1.25, sides=4)
    m.cylinder(GOLD, 0, 0, 0.012, 1.25, 1.32, sides=6)
    return m


def opera_house():
    m = Mesh()
    m.box((0.78, 0.6, 0.48), -0.55, 0, -0.35, 0.55, 0.1, 0.35)
    for k, (x, h, w) in enumerate([(-0.35, 0.42, 0.16), (-0.12, 0.55, 0.19), (0.12, 0.48, 0.17), (0.33, 0.36, 0.14)]):
        for z in (-0.12, 0.12):   # paired white shells, leaning seaward
            m.quad(WHITE, (x - w, 0.1, z - 0.1), (x, 0.1 + h, z), (x + w * 0.3, 0.1, z + 0.12), (x - w, 0.1, z - 0.1))
            m.tri(WHITE, (x - w, 0.1, z - 0.1), (x + w * 0.3, 0.1, z + 0.12), (x, 0.1 + h, z))
            m.tri(MARBLE_DARK, (x - w, 0.1, z + 0.12), (x, 0.1 + h, z), (x + w * 0.3, 0.1, z - 0.1))
            m.tri(MARBLE_DARK, (x + w * 0.3, 0.1, z - 0.1), (x, 0.1 + h, z), (x - w, 0.1, z + 0.12))
    return m


def launch_complex():
    m = Mesh()
    m.box((0.55, 0.55, 0.55), -0.55, 0, -0.55, 0.55, 0.04, 0.55)
    m.box(RED, 0.12, 0.04, -0.06, 0.24, 1.05, 0.06)   # service tower
    for y in (0.3, 0.55, 0.8):
        m.box(RED, 0.0, y, -0.03, 0.12, y + 0.03, 0.03)
    m.cylinder(WHITE, -0.07, 0, 0.07, 0.04, 0.95, sides=12)   # the rocket
    frustum(m, WHITE, -0.07, 0, 0.07, 0.0, 0.95, 1.15, sides=12)
    m.box((0.2, 0.2, 0.22), -0.16, 0.6, -0.075, 0.02, 0.62, 0.075)
    for (x, z) in [(-0.2, -0.1), (0.06, -0.1), (-0.2, 0.1), (0.06, 0.1)]:
        m.box((0.25, 0.25, 0.25), x - 0.02, 0.04, z - 0.02, x + 0.02, 0.18, z + 0.02)
    dome(m, WHITE, -0.38, 0.32, 0.12, 0.04)   # tracking dome
    return m


# ----- Natural wonders ---------------------------------------------------------------------------------------------

def uluru():
    m = Mesh()
    frustum(m, OCHRE, 0, 0, 0.6, 0.45, 0, 0.32, sides=11, top=OCHRE_DARK)
    for (x, z, r) in [(-0.2, 0.05, 0.22), (0.18, -0.08, 0.25)]:
        dome(m, OCHRE, x, z, r, 0.25, rings=3, sides=10)
    return m


def kilimanjaro():
    m = Mesh()
    frustum(m, (0.42, 0.5, 0.32), 0, 0, 0.62, 0.28, 0, 0.45, sides=12)
    frustum(m, ROCK, 0, 0, 0.28, 0.16, 0.45, 0.72, sides=12)
    frustum(m, SNOW, 0, 0, 0.16, 0.1, 0.72, 0.8, sides=12)
    return m


def barrier_reef():
    m = Mesh()
    for k in range(14):
        a = k * 2.4
        r = 0.12 + 0.36 * ((k * 37) % 11) / 11
        x, z = math.cos(a) * r, math.sin(a) * r
        c = (CORAL_A, CORAL_B, CORAL_C)[k % 3]
        h = 0.06 + 0.06 * ((k * 13) % 5) / 5
        frustum(m, c, x, z, 0.09, 0.04, 0, h, sides=7)
        if k % 2 == 0:
            for j in range(3):
                b = j * 2.1 + k
                m.box(c, x + math.cos(b) * 0.04 - 0.01, h, z + math.sin(b) * 0.04 - 0.01, x + math.cos(b) * 0.04 + 0.01, h + 0.07, z + math.sin(b) * 0.04 + 0.01)
    return m


def ha_long():
    m = Mesh()
    for k, (x, z, r, h) in enumerate([(-0.3, -0.2, 0.14, 0.62), (0.05, -0.32, 0.11, 0.48), (0.3, 0.05, 0.15, 0.7), (-0.1, 0.25, 0.12, 0.52), (-0.4, 0.3, 0.08, 0.35)]):
        frustum(m, (0.42, 0.44, 0.4), x, z, r, r * 0.7, 0, h * 0.8, sides=8)
        dome(m, GREEN_DARK, x, z, r * 0.7, h * 0.8, rings=3, sides=8)
    return m


def pamukkale():
    m = Mesh()
    for i, (r, y) in enumerate([(0.6, 0.0), (0.48, 0.1), (0.36, 0.2), (0.24, 0.3)]):
        frustum(m, TRAVERTINE, 0, 0, r, r - 0.02, y, y + 0.1, sides=12, top=(0.5, 0.82, 0.9))
        for k in range(8):   # scalloped pool lips
            a = k * 2 * math.pi / 8 + i * 0.3
            m.box(TRAVERTINE, math.cos(a) * r - 0.04, y + 0.06, math.sin(a) * r - 0.04, math.cos(a) * r + 0.04, y + 0.12, math.sin(a) * r + 0.04)
    return m


def zhangjiajie():
    m = Mesh()
    pillars = [(-0.35, -0.25, 0.08, 1.0), (-0.1, -0.35, 0.07, 0.8), (0.2, -0.2, 0.09, 1.15), (0.38, 0.12, 0.07, 0.75),
               (0.05, 0.1, 0.1, 0.95), (-0.3, 0.25, 0.08, 0.7), (0.15, 0.4, 0.06, 0.6)]
    for (x, z, r, h) in pillars:
        frustum(m, (0.55, 0.52, 0.48), x, z, r, r * 0.85, 0, h, sides=7)
        dome(m, GREEN, x, z, r * 0.95, h, rings=2, sides=7)
    return m


def torres_del_paine():
    m = Mesh()
    frustum(m, (0.35, 0.42, 0.32), 0, 0, 0.62, 0.42, 0, 0.18, sides=10)
    for (x, z, h) in [(-0.22, -0.05, 0.95), (0.0, 0.0, 1.1), (0.22, 0.04, 0.9)]:   # the three granite horns
        frustum(m, GRANITE, x, z, 0.12, 0.03, 0.18, h, sides=6)
        frustum(m, SNOW, x, z, 0.035, 0.0, h, h + 0.06, sides=6)
    return m


def galapagos():
    m = Mesh()
    for (x, z, r, h) in [(-0.2, -0.1, 0.3, 0.32), (0.3, 0.2, 0.18, 0.2), (0.1, -0.35, 0.12, 0.12)]:
        frustum(m, (0.36, 0.3, 0.26), x, z, r, r * 0.35, 0, h, sides=9, top=(0.25, 0.2, 0.18))
        frustum(m, (0.4, 0.55, 0.3), x, z, r * 1.05, r * 0.9, 0, 0.04, sides=9)
    for (x, z) in [(0.25, -0.05), (-0.42, 0.25)]:   # giant tortoises on the shore
        dome(m, (0.35, 0.33, 0.22), x, z, 0.05, 0.02, rings=2, sides=8)
    return m


def victoria_falls():
    m = Mesh()
    m.box((0.36, 0.5, 0.28), -0.6, 0, -0.6, 0.6, 0.5, -0.05, top=GREEN)   # the plateau
    m.box(WATER, -0.45, 0.5, -0.6, 0.45, 0.52, -0.05)                     # the river above
    m.quad(FOAM, (-0.45, 0.52, -0.05), (0.45, 0.52, -0.05), (0.45, 0.02, 0.02), (-0.45, 0.02, 0.02))   # the curtain of water
    m.quad(FOAM, (-0.45, 0.02, 0.02), (0.45, 0.02, 0.02), (0.45, 0.52, -0.05), (-0.45, 0.52, -0.05))
    m.box((0.3, 0.42, 0.24), -0.6, 0, 0.02, 0.6, 0.1, 0.6, top=GREEN_DARK)   # the gorge floor
    m.box(WATER, -0.45, 0.0, 0.02, 0.45, 0.04, 0.35)
    for x in (-0.3, 0.0, 0.3):   # mist
        dome(m, FOAM, x, 0.08, 0.1, 0.04, rings=3, sides=8)
    return m


ALL = [("giza", giza), ("hanging_gardens", hanging_gardens), ("oracle", oracle), ("colossus", colossus),
       ("great_library", great_library), ("terracotta", terracotta), ("machu_picchu", machu_picchu), ("hagia_sophia", hagia_sophia),
       ("forbidden_city", forbidden_city), ("oxford", oxford), ("big_ben", big_ben), ("eiffel", eiffel), ("opera_house", opera_house),
       ("launch_complex", launch_complex),
       ("uluru", uluru), ("kilimanjaro", kilimanjaro), ("barrier_reef", barrier_reef), ("ha_long", ha_long), ("pamukkale", pamukkale),
       ("zhangjiajie", zhangjiajie), ("torres_del_paine", torres_del_paine), ("galapagos", galapagos), ("victoria_falls", victoria_falls)]

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for name, make in ALL:
        make().write(os.path.join(OUT, f"{name}.glb"))
        print("wrote", os.path.join("models", "wonders", f"{name}.glb"))
