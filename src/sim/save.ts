// Versioned MessagePack + gzip saves with migrations.
import { encode, decode } from "@msgpack/msgpack";
import { gzipSync, gunzipSync } from "fflate";
import { TABLE_KEYS, WORLD_VERSION, makeTable, type Table, type World } from "./world";

type TableKey = (typeof TABLE_KEYS)[number];
type Packed = Omit<World, TableKey> & Record<TableKey, PackedTable>;
type PackedTable = { size: number; cols: Record<string, { t: "f64" | "i32"; b: Uint8Array }> };

const packTable = (t: Table): PackedTable => ({
  size: t.size,
  cols: Object.fromEntries(Object.entries(t.cols).map(([k, a]) => [k, {
    t: a instanceof Float64Array ? "f64" : "i32",
    b: new Uint8Array(a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength)),
  }])),
});
const unpackTable = (p: PackedTable): Table => ({
  size: p.size,
  cols: Object.fromEntries(Object.entries(p.cols).map(([k, { t, b }]) => {
    const buf = b.slice().buffer;
    return [k, t === "f64" ? new Float64Array(buf) : new Int32Array(buf)];
  })),
});

/** Migrations: index n upgrades a save from version n to n+1. */
const MIGRATIONS: ((w: Record<string, unknown>) => void)[] = [
  () => { throw new Error("no v0 saves"); },
  (w) => { // v1 → v2: map data (names, adjacency, terrain, capitals)
    const n = (w.provinces as PackedTable).size;
    w.provinceNames = Array.from({ length: n }, (_, i) => `P${i}`);
    w.adjacency = packTable({ size: n, cols: { offset: new Int32Array(n + 1), list: new Int32Array(0) } });
    const addCol = (t: PackedTable, k: string) => { t.cols[k] = packTable(makeTable(t.size, { [k]: "i32" })).cols[k]!; };
    addCol(w.provinces as PackedTable, "terrain");
    addCol(w.countries as PackedTable, "capital");
  },
];

export function saveWorld(w: World): Uint8Array {
  const packed = { ...w } as unknown as Packed;
  for (const k of TABLE_KEYS) packed[k] = packTable(w[k]);
  return gzipSync(encode(packed, { ignoreUndefined: true }));
}

export function loadWorld(bytes: Uint8Array): World {
  const raw = decode(gunzipSync(bytes)) as Record<string, unknown>;
  let v = raw.version as number;
  if (v > WORLD_VERSION) throw new Error(`Save version ${v} is newer than game (${WORLD_VERSION})`);
  while (v < WORLD_VERSION) { MIGRATIONS[v]!(raw); v++; raw.version = v; }
  const p = raw as unknown as Packed;
  const out = { ...p } as unknown as World;
  for (const k of TABLE_KEYS) out[k] = unpackTable(p[k]);
  return out;
}
