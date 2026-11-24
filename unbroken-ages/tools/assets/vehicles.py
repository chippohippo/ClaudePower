"""Generates the war machines no CC0 pack provides: tanks of three eras and warships from the trireme to the destroyer.
Original low-poly geometry, flat-shaded, CC0 like the rest of the kit.

python3 tools/assets/vehicles.py      -> godot/assets/models/units/{tank_ww1,tank_ww2,tank_modern,trireme,ironclad,battleship,destroyer,submarine}.glb

Every model faces +Z (the camera-facing convention of the unit layer), stands on y = 0 and is about one unit long.
Team colour: parts painted in TEAM (a saturated blue) are recoloured to the owner's primary by the model shader.
"""
import math, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from landmarks import Mesh  # noqa: E402
from wonders import frustum, dome  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "..", "godot", "assets", "models", "units"))

TEAM = (0.18, 0.42, 0.85)          # recoloured to the nation's primary (hue 0.5-0.68, saturated)
OLIVE, OLIVE_DARK, KHAKI = (0.42, 0.45, 0.28), (0.3, 0.32, 0.2), (0.62, 0.58, 0.4)
STEEL, STEEL_DARK, GUN = (0.55, 0.57, 0.6), (0.38, 0.4, 0.43), (0.22, 0.22, 0.24)
TRACK, WOOD, WOOD_DARK, SAIL, HULL_RED = (0.16, 0.15, 0.14), (0.55, 0.38, 0.22), (0.4, 0.27, 0.15), (0.93, 0.9, 0.8), (0.55, 0.18, 0.14)
NAVY_GREY, DECK, WHITE, BLACK = (0.5, 0.53, 0.57), (0.6, 0.52, 0.4), (0.92, 0.92, 0.9), (0.12, 0.12, 0.13)


def cyl_x(m, colour, cx, cy, cz, r, x0, x1, sides=10):
    """A cylinder lying along X (barrels across)."""
    ring = [(math.cos(i * 2 * math.pi / sides) * r, math.sin(i * 2 * math.pi / sides) * r) for i in range(sides)]
    for i in range(sides):
        (ay, az), (by, bz) = ring[i], ring[(i + 1) % sides]
        m.quad(colour, (x0, cy + ay, cz + az), (x1, cy + ay, cz + az), (x1, cy + by, cz + bz), (x0, cy + by, cz + bz))


def cyl_z(m, colour, cx, cy, z0, z1, r, sides=10):
    """A cylinder lying along Z (barrels forward)."""
    ring = [(math.cos(i * 2 * math.pi / sides) * r, math.sin(i * 2 * math.pi / sides) * r) for i in range(sides)]
    for i in range(sides):
        (ax, ay), (bx, by) = ring[i], ring[(i + 1) % sides]
        m.quad(colour, (cx + ax, cy + ay, z0), (cx + bx, cy + by, z0), (cx + bx, cy + by, z1), (cx + ax, cy + ay, z1))
    m.tri(colour, (cx, cy, z1), *[(cx + ring[i][0], cy + ring[i][1], z1) for i in (0, 1)])


def tracks(m, half_w, length, h, colour=TRACK, wheel=STEEL_DARK):
    for side in (-1, 1):
        x0, x1 = side * half_w - 0.07, side * half_w + 0.07
        if side < 0: x0, x1 = x0, x1
        m.box(colour, min(x0, x1), 0, -length / 2, max(x0, x1), h, length / 2)
        for k in range(5):
            z = -length / 2 + 0.08 + k * (length - 0.16) / 4
            cyl_x(m, wheel, 0, h * 0.5, z, h * 0.38, side * half_w + side * 0.071, side * half_w + side * 0.08)


def hull_shape(m, colour, w, l, y0, y1, bow=0.25, deck=None):
    """A ship hull: a box with a pointed bow toward +Z and a flat stern."""
    deck = deck or colour
    hw, hl = w / 2, l / 2
    pts_top = [(-hw, y1, -hl), (hw, y1, -hl), (hw, y1, hl - bow), (0, y1, hl), (-hw, y1, hl - bow)]
    pts_bot = [(-hw * 0.7, y0, -hl + 0.03), (hw * 0.7, y0, -hl + 0.03), (hw * 0.7, y0, hl - bow), (0, y0, hl - 0.05), (-hw * 0.7, y0, hl - bow)]
    n = len(pts_top)
    for i in range(n):
        a, b = pts_top[i], pts_top[(i + 1) % n]
        c, d = pts_bot[(i + 1) % n], pts_bot[i]
        m.quad(colour, d, c, b, a)
    # deck (fan)
    for i in range(1, n - 1):
        m.tri(deck, pts_top[0], pts_top[i + 1], pts_top[i])


def tank_ww1():
    m = Mesh()
    # rhomboid hull with tracks running all the way round
    for side in (-1, 1):
        x0, x1 = (side * 0.22, side * 0.36) if side > 0 else (-0.36, -0.22)
        prof = [(-0.5, 0.05), (-0.42, 0.34), (0.3, 0.34), (0.52, 0.12), (0.4, 0.0), (-0.35, 0.0)]
        for i in range(len(prof)):
            (za, ya), (zb, yb) = prof[i], prof[(i + 1) % len(prof)]
            m.quad(TRACK, (x0, ya, za), (x0, yb, zb), (x1, yb, zb), (x1, ya, za))
        for (x,) in ((x0,), (x1,)):
            for i in range(1, len(prof) - 1):
                m.tri(OLIVE_DARK, (x, prof[0][1], prof[0][0]), (x, prof[i][1], prof[i][0]), (x, prof[i + 1][1], prof[i + 1][0]))
    m.box(OLIVE, -0.22, 0.06, -0.4, 0.22, 0.3, 0.38, top=OLIVE_DARK)
    for side in (-1, 1):   # sponsons with guns
        m.box(OLIVE, side * 0.36 - (0.06 if side > 0 else 0.06), 0.1, -0.05, side * 0.36 + 0.06, 0.24, 0.15)
        cyl_x(m, GUN, 0, 0.17, 0.05, 0.025, side * 0.42, side * 0.56)
    m.box(TEAM, -0.12, 0.3, -0.25, 0.12, 0.36, -0.1)   # cab roof marking
    return m


def tank_ww2():
    m = Mesh()
    tracks(m, 0.26, 0.9, 0.16)
    m.box(OLIVE, -0.24, 0.12, -0.42, 0.24, 0.28, 0.42, top=OLIVE)
    m.quad(OLIVE_DARK, (-0.24, 0.28, 0.42), (0.24, 0.28, 0.42), (0.24, 0.16, 0.5), (-0.24, 0.16, 0.5))   # sloped glacis
    frustum(m, OLIVE, 0, -0.05, 0.17, 0.14, 0.28, 0.42, sides=8, top=OLIVE_DARK)                      # cast turret
    cyl_z(m, GUN, 0, 0.36, 0.08, 0.62, 0.03)
    m.box(TEAM, -0.1, 0.42, -0.14, 0.1, 0.44, 0.02)   # turret roof marking
    m.box(STEEL_DARK, 0.04, 0.42, -0.12, 0.09, 0.47, -0.07)  # hatch
    return m


def tank_modern():
    m = Mesh()
    tracks(m, 0.28, 1.0, 0.15)
    m.box(KHAKI, -0.27, 0.12, -0.48, 0.27, 0.26, 0.45)
    m.quad(KHAKI, (-0.27, 0.26, 0.45), (0.27, 0.26, 0.45), (0.27, 0.15, 0.53), (-0.27, 0.15, 0.53))
    m.box(KHAKI, -0.2, 0.26, -0.3, 0.2, 0.38, 0.12, top=(0.55, 0.52, 0.36))   # flat angular turret
    m.quad(KHAKI, (-0.2, 0.38, 0.12), (0.2, 0.38, 0.12), (0.17, 0.27, 0.22), (-0.17, 0.27, 0.22))
    cyl_z(m, GUN, 0, 0.32, 0.2, 0.75, 0.025)
    m.box(TEAM, -0.19, 0.3, -0.31, 0.19, 0.36, -0.29)
    m.box(STEEL_DARK, 0.08, 0.38, -0.2, 0.14, 0.43, -0.12)
    return m


def trireme():
    m = Mesh()
    hull_shape(m, WOOD, 0.24, 1.0, 0.0, 0.12, bow=0.18, deck=WOOD_DARK)
    m.box(WOOD_DARK, -0.02, 0.0, 0.48, 0.02, 0.05, 0.6)          # the ram
    for k in range(8):                                             # oars
        z = -0.32 + k * 0.08
        for side in (-1, 1):
            m.quad(WOOD_DARK, (side * 0.12, 0.08, z), (side * 0.36, 0.0, z - 0.02), (side * 0.36, 0.0, z + 0.0), (side * 0.12, 0.08, z + 0.02))
    m.box(WOOD_DARK, -0.015, 0.12, -0.02, 0.015, 0.62, 0.02)       # mast
    m.quad(TEAM, (-0.22, 0.58, 0.0), (0.22, 0.58, 0.0), (0.2, 0.24, 0.0), (-0.2, 0.24, 0.0))   # square sail in team colour
    m.quad(TEAM, (-0.2, 0.24, 0.0), (0.2, 0.24, 0.0), (0.22, 0.58, 0.0), (-0.22, 0.58, 0.0))
    m.box(WOOD, -0.08, 0.12, -0.5, 0.08, 0.2, -0.38)               # stern castle
    return m


def ironclad():
    m = Mesh()
    hull_shape(m, BLACK, 0.3, 1.0, 0.0, 0.1, bow=0.22, deck=DECK)
    m.box(STEEL_DARK, -0.12, 0.1, -0.22, 0.12, 0.2, 0.18)          # casemate
    m.quad(STEEL_DARK, (-0.12, 0.2, 0.18), (0.12, 0.2, 0.18), (0.14, 0.1, 0.24), (-0.14, 0.1, 0.24))
    cyl_z(m, BLACK, 0, 0.15, 0.24, 0.34, 0.02)
    frustum(m, BLACK, 0, -0.02, 0.05, 0.045, 0.2, 0.46, sides=10)  # funnel
    m.box(TEAM, -0.05, 0.46, -0.03, 0.05, 0.5, -0.01)
    m.box(WOOD_DARK, -0.012, 0.1, -0.38, 0.012, 0.52, -0.36)       # mast
    return m


def battleship():
    m = Mesh()
    hull_shape(m, NAVY_GREY, 0.3, 1.1, 0.0, 0.1, bow=0.28, deck=DECK)
    for z, h in ((0.28, 0.1), (0.14, 0.12), (-0.32, 0.1)):         # main turrets with twin guns
        m.box(NAVY_GREY, -0.07, 0.1, z - 0.06, 0.07, 0.1 + h * 0.6, z + 0.05)
        for dx in (-0.025, 0.025):
            cyl_z(m, GUN, dx, 0.13, z + 0.05, z + 0.2 if z > 0 else z - 0.2, 0.012)
    m.box(NAVY_GREY, -0.08, 0.1, -0.16, 0.08, 0.32, 0.02)          # superstructure
    m.box(STEEL_DARK, -0.05, 0.32, -0.12, 0.05, 0.42, -0.02)
    frustum(m, STEEL_DARK, 0, -0.08, 0.035, 0.03, 0.32, 0.48, sides=8)
    m.box(TEAM, -0.06, 0.42, -0.1, 0.06, 0.44, -0.04)
    return m


def destroyer():
    m = Mesh()
    hull_shape(m, (0.58, 0.6, 0.64), 0.22, 1.0, 0.0, 0.09, bow=0.3, deck=(0.45, 0.47, 0.5))
    m.box(NAVY_GREY, -0.06, 0.09, -0.12, 0.06, 0.22, 0.06)
    m.box(WHITE, -0.04, 0.22, -0.1, 0.04, 0.3, 0.02)               # bridge
    m.box(STEEL_DARK, -0.006, 0.3, -0.05, 0.006, 0.45, -0.04)      # radar mast
    m.box(STEEL_DARK, -0.04, 0.42, -0.05, 0.04, 0.44, -0.04)
    m.box(NAVY_GREY, -0.04, 0.09, 0.2, 0.04, 0.15, 0.27)           # gun
    cyl_z(m, GUN, 0, 0.12, 0.27, 0.4, 0.01)
    m.box(TEAM, -0.07, 0.09, -0.42, 0.07, 0.1, -0.3)               # helipad marking
    return m


def submarine():
    m = Mesh()
    # a long cigar, mostly awash
    for k in range(10):
        z0 = -0.5 + k * 0.1; z1 = z0 + 0.1
        r0 = 0.08 * math.sin(math.pi * (k / 10) ** 0.8) + 0.02
        r1 = 0.08 * math.sin(math.pi * ((k + 1) / 10) ** 0.8) + 0.02
        ring = [(math.cos(i * 2 * math.pi / 10), math.sin(i * 2 * math.pi / 10)) for i in range(10)]
        for i in range(10):
            (ax, ay), (bx, by) = ring[i], ring[(i + 1) % 10]
            m.quad(BLACK, (ax * r0, 0.06 + ay * r0, z0), (bx * r0, 0.06 + by * r0, z0), (bx * r1, 0.06 + by * r1, z1), (ax * r1, 0.06 + ay * r1, z1))
    m.box(BLACK, -0.03, 0.1, -0.02, 0.03, 0.26, 0.14)              # sail (conning tower)
    m.box(TEAM, -0.031, 0.2, 0.0, 0.031, 0.23, 0.12)
    m.box(STEEL_DARK, -0.004, 0.26, 0.03, 0.004, 0.34, 0.04)       # periscope
    return m


ALL = [("tank_ww1", tank_ww1), ("tank_ww2", tank_ww2), ("tank_modern", tank_modern), ("trireme", trireme),
       ("ironclad", ironclad), ("battleship", battleship), ("destroyer", destroyer), ("submarine", submarine)]

if __name__ == "__main__":
    for name, make in ALL:
        make().write(os.path.join(OUT, f"{name}.glb"))
        print("wrote", os.path.join("models", "units", f"{name}.glb"))
