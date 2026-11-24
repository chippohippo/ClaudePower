"""Generates the nations' landmark models (original low-poly geometry, flat-shaded, CC0 like the rest of the kit).

python3 tools/assets/landmarks.py      -> godot/assets/models/landmarks/*.glb

Each landmark stands on y = 0, is centred on x/z, and is about 1 unit tall/wide (the map fits it to a size).
  pyramid     Egypt     a true pyramid of dressed limestone with a gilded capstone
  pagoda      Song      a five-storey timber pagoda with green-tiled eaves and a spire
  yurt        Mongolia  a felt ger with a red door band and a smoke ring
  ushnu       Inca      a terraced stone platform with a shrine on top
  mosque      Mali      a Djenné-style mud mosque: a long hall, three towers bristling with toron beams
  campanile   Venice    a brick bell tower with a white belfry and a green pyramid spire
"""
import json, math, os, struct

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "..", "godot", "assets", "models", "landmarks"))


class Mesh:
    def __init__(self):
        self.parts = {}   # colour -> (positions, normals)

    def tri(self, colour, a, b, c):
        ux, uy, uz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
        vx, vy, vz = c[0] - a[0], c[1] - a[1], c[2] - a[2]
        n = (uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx)
        l = math.sqrt(sum(x * x for x in n)) or 1.0
        n = tuple(x / l for x in n)
        pos, nor = self.parts.setdefault(colour, ([], []))
        for p in (a, b, c):
            pos.append(p)
            nor.append(n)

    def quad(self, colour, a, b, c, d):
        self.tri(colour, a, b, c)
        self.tri(colour, a, c, d)

    def box(self, colour, x0, y0, z0, x1, y1, z1, top=None):
        top = top or colour
        p = [(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1), (x0, y1, z0), (x1, y1, z0), (x1, y1, z1), (x0, y1, z1)]
        self.quad(top, p[4], p[7], p[6], p[5])          # top
        self.quad(colour, p[0], p[1], p[2], p[3])       # bottom
        self.quad(colour, p[0], p[4], p[5], p[1])       # -z
        self.quad(colour, p[2], p[6], p[7], p[3])       # +z
        self.quad(colour, p[1], p[5], p[6], p[2])       # +x
        self.quad(colour, p[3], p[7], p[4], p[0])       # -x

    def pyramid(self, colour, cx, cz, half, y0, y1, sides=4, rot=math.pi / 4):
        apex = (cx, y1, cz)
        ring = [(cx + half * math.cos(rot + i * 2 * math.pi / sides), y0, cz + half * math.sin(rot + i * 2 * math.pi / sides)) for i in range(sides)]
        for i in range(sides):
            a, b = ring[i], ring[(i + 1) % sides]
            self.tri(colour, a, apex, b)
            self.tri(colour, (cx, y0, cz), a, b)

    def cylinder(self, colour, cx, cz, r, y0, y1, sides=14, top=None):
        top = top or colour
        ring = [(math.cos(i * 2 * math.pi / sides), math.sin(i * 2 * math.pi / sides)) for i in range(sides)]
        for i in range(sides):
            (ax, az), (bx, bz) = ring[i], ring[(i + 1) % sides]
            a0, b0 = (cx + ax * r, y0, cz + az * r), (cx + bx * r, y0, cz + bz * r)
            a1, b1 = (cx + ax * r, y1, cz + az * r), (cx + bx * r, y1, cz + bz * r)
            self.quad(colour, a0, a1, b1, b0)
            self.tri(top, (cx, y1, cz), b1, a1)

    def write(self, path):
        materials, meshes_prims, buffer, views, accessors = [], [], bytearray(), [], []
        for colour, (pos, nor) in self.parts.items():
            materials.append({"pbrMetallicRoughness": {"baseColorFactor": list(colour) + [1.0], "metallicFactor": 0.0, "roughnessFactor": 0.85}})
            prim = {"attributes": {}, "material": len(materials) - 1}
            for name, data in (("POSITION", pos), ("NORMAL", nor)):
                off = len(buffer)
                for v in data:
                    buffer += struct.pack("<3f", *v)
                views.append({"buffer": 0, "byteOffset": off, "byteLength": len(data) * 12, "target": 34962})
                acc = {"bufferView": len(views) - 1, "componentType": 5126, "count": len(data), "type": "VEC3"}
                if name == "POSITION":
                    acc["min"] = [min(v[i] for v in data) for i in range(3)]
                    acc["max"] = [max(v[i] for v in data) for i in range(3)]
                accessors.append(acc)
                prim["attributes"][name] = len(accessors) - 1
            meshes_prims.append(prim)
        gltf = {
            "asset": {"version": "2.0", "generator": "unbroken-ages landmarks.py", "copyright": "CC0 1.0, Unbroken Ages"},
            "scene": 0, "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0, "name": os.path.splitext(os.path.basename(path))[0]}],
            "meshes": [{"primitives": meshes_prims}], "materials": materials,
            "buffers": [{"byteLength": len(buffer)}], "bufferViews": views, "accessors": accessors,
        }
        js = json.dumps(gltf, separators=(",", ":")).encode()
        js += b" " * (-len(js) % 4)
        buffer += b"\0" * (-len(buffer) % 4)
        with open(path, "wb") as f:
            f.write(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(buffer)))
            f.write(struct.pack("<II", len(js), 0x4E4F534A)); f.write(js)
            f.write(struct.pack("<II", len(buffer), 0x004E4942)); f.write(buffer)


SAND, SAND_DARK, GOLD = (0.82, 0.62, 0.36), (0.62, 0.46, 0.28), (0.98, 0.72, 0.15)
TIMBER, JADE, STONE, STONE_DARK = (0.62, 0.22, 0.16), (0.22, 0.45, 0.4), (0.62, 0.6, 0.56), (0.45, 0.43, 0.4)
FELT, RED, MUD_, MUD_DARK_, BRICK, WHITE, COPPER = (0.93, 0.9, 0.82), (0.72, 0.16, 0.14), (0.72, 0.5, 0.32), (0.58, 0.38, 0.24), (0.62, 0.24, 0.16), (0.94, 0.92, 0.88), (0.3, 0.58, 0.5)

MUD, MUD_DARK = (0.64, 0.4, 0.22), (0.46, 0.28, 0.16)


def pyramid():
    m = Mesh()
    m.box(SAND_DARK, -0.55, 0, -0.55, 0.55, 0.04, 0.55)
    m.pyramid(SAND, 0, 0, 0.7, 0.04, 0.92)
    m.pyramid(GOLD, 0, 0, 0.09, 0.84, 0.95)
    return m


def pagoda():
    m = Mesh()
    m.box(STONE, -0.42, 0, -0.42, 0.42, 0.08, 0.42)
    y, w = 0.08, 0.3
    for floor in range(5):
        h = 0.13
        m.box(TIMBER, -w, y, -w, w, y + h, w)
        m.box(JADE, -w - 0.09, y + h, -w - 0.09, w + 0.09, y + h + 0.03, w + 0.09)
        m.pyramid(JADE, 0, 0, (w + 0.09) * 1.41, y + h + 0.03, y + h + 0.08)
        y += h + 0.06
        w *= 0.84
    m.cylinder(GOLD, 0, 0, 0.02, y, y + 0.18, sides=6)
    return m


def yurt():
    m = Mesh()
    m.cylinder(FELT, 0, 0, 0.45, 0, 0.32, sides=16)
    m.cylinder(RED, 0, 0, 0.455, 0.12, 0.17, sides=16)
    m.pyramid(FELT, 0, 0, 0.5, 0.32, 0.62, sides=16, rot=0)
    m.cylinder(STONE_DARK, 0, 0, 0.07, 0.58, 0.64, sides=8)
    m.box(RED, -0.08, 0, 0.43, 0.08, 0.22, 0.47)
    return m


def ushnu():
    m = Mesh()
    w = 0.6
    for step in range(4):
        m.box(STONE if step % 2 == 0 else STONE_DARK, -w, step * 0.12, -w, w, (step + 1) * 0.12, w)
        w -= 0.12
    m.box(STONE, -0.14, 0.48, -0.14, 0.14, 0.68, 0.14)
    m.pyramid((0.55, 0.42, 0.22), 0, 0, 0.24, 0.68, 0.82)
    m.box(STONE_DARK, -0.06, 0, 0.6, 0.06, 0.5, 0.62)   # the stair up the front
    return m


def mosque():
    m = Mesh()
    m.box(MUD, -0.6, 0, -0.32, 0.6, 0.34, 0.32, top=MUD_DARK)
    for x in (-0.38, 0.0, 0.38):
        top = 0.78 if x == 0 else 0.62
        m.box(MUD, x - 0.1, 0, -0.42, x + 0.1, top, -0.22)
        m.pyramid(MUD_DARK, x, -0.32, 0.12, top, top + 0.12)
        for y in (0.2, 0.4, top - 0.1):   # toron: palm beams bristling from the walls
            m.box(MUD_DARK, x - 0.16, y, -0.34, x + 0.16, y + 0.02, -0.3)
    for x in (-0.55, -0.2, 0.2, 0.55):
        m.pyramid(MUD_DARK, x, 0.3, 0.05, 0.34, 0.44)
    return m


def campanile():
    m = Mesh()
    m.box(STONE, -0.2, 0, -0.2, 0.2, 0.08, 0.2)
    m.box(BRICK, -0.15, 0.08, -0.15, 0.15, 0.8, 0.15)
    m.box(WHITE, -0.17, 0.8, -0.17, 0.17, 0.96, 0.17)
    m.box(BRICK, -0.15, 0.96, -0.15, 0.15, 1.04, 0.15)
    m.pyramid(COPPER, 0, 0, 0.21, 1.04, 1.42)
    m.cylinder(GOLD, 0, 0, 0.02, 1.42, 1.5, sides=6)
    return m


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for name, make in [("pyramid", pyramid), ("pagoda", pagoda), ("yurt", yurt), ("ushnu", ushnu), ("mosque", mosque), ("campanile", campanile)]:
        make().write(os.path.join(OUT, f"{name}.glb"))
        print("wrote", os.path.join("models", "landmarks", f"{name}.glb"))
