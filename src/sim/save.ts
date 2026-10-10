// Versioned MessagePack + gzip saves with migrations.
import { encode, decode } from "@msgpack/msgpack";
import { gzipSync, gunzipSync } from "fflate";
import { BUDGET_COLS, BUILDING_COLS, CHARACTER_COLS, IG_COLS, COUNTRY_COLS, MARKET_COLS, POP_COLS, PROJECT_COLS, PROVINCE_COLS, TABLE_KEYS, WORLD_VERSION, makeTable, type Table, type World } from "./world";

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
  (w) => { // v2 → v3: population & economy (M2). Old saves had no pops; start them with empty tables.
    const ct = w.countries as PackedTable, pt = w.provinces as PackedTable;
    const fill = (t: PackedTable, spec: Record<string, "f64" | "i32">) => {
      for (const [k, kind] of Object.entries(spec)) if (!t.cols[k]) t.cols[k] = packTable(makeTable(t.size, { [k]: kind })).cols[k]!;
    };
    fill(ct, COUNTRY_COLS); fill(pt, PROVINCE_COLS);
    for (const [k, spec] of [["pops", POP_COLS], ["buildings", BUILDING_COLS], ["markets", MARKET_COLS], ["worldMarket", MARKET_COLS], ["projects", PROJECT_COLS]] as const)
      w[k] = packTable(makeTable(0, spec));
    w.budget = packTable(makeTable(ct.size, BUDGET_COLS));
    w.cultures = []; w.religions = [];
    w.ledger = { minted: 0, destroyed: 0, born: 0, died: 0, migratedOut: 0, migratedIn: 0 };
    w.history = { year: [], series: {} };
  },
  (w) => { // v3 → v4: points, laws, automation, development split, unrest (M3).
    const ct = w.countries as PackedTable, pt = w.provinces as PackedTable;
    const fill = (t: PackedTable, spec: Record<string, "f64" | "i32">) => {
      for (const [k, kind] of Object.entries(spec)) if (!t.cols[k]) t.cols[k] = packTable(makeTable(t.size, { [k]: kind })).cols[k]!;
    };
    fill(ct, COUNTRY_COLS); fill(pt, PROVINCE_COLS);
  },
  (w) => { // v4 → v5: characters and interest groups (M4). Old saves start with none; setup systems seed them lazily.
    const ct = w.countries as PackedTable;
    for (const [k, kind] of Object.entries(COUNTRY_COLS)) if (!ct.cols[k]) ct.cols[k] = packTable(makeTable(ct.size, { [k]: kind })).cols[k]!;
    w.characters = packTable(makeTable(0, CHARACTER_COLS));
    w.igs = packTable(makeTable(ct.size * 8, IG_COLS));
    w.characterNames = []; w.chronicle = [];
  },
];

export function saveWorld(w: World): Uint8Array {
  const packed = { ...w } as unknown as Packed;
  for (const k of TABLE_KEYS) packed[k] = packTable(w[k]);
  return gzipSync(encode(packed, { ignoreUndefined: true }), { mtime: 0 });
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
