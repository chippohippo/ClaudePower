// Versioned MessagePack + gzip saves with migrations.
import { encode, decode } from "@msgpack/msgpack";
import { gzipSync, gunzipSync } from "fflate";
import { WORLD_VERSION, type Table, type World } from "./world";

type Packed = Omit<World, "countries" | "provinces"> & { countries: PackedTable; provinces: PackedTable };
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
const MIGRATIONS: ((w: Record<string, unknown>) => void)[] = [];

export function saveWorld(w: World): Uint8Array {
  const packed: Packed = { ...w, countries: packTable(w.countries), provinces: packTable(w.provinces) };
  return gzipSync(encode(packed, { ignoreUndefined: true }));
}

export function loadWorld(bytes: Uint8Array): World {
  const raw = decode(gunzipSync(bytes)) as Record<string, unknown>;
  let v = raw.version as number;
  if (v > WORLD_VERSION) throw new Error(`Save version ${v} is newer than game (${WORLD_VERSION})`);
  while (v < WORLD_VERSION) { MIGRATIONS[v]!(raw); v++; raw.version = v; }
  const p = raw as unknown as Packed;
  return { ...p, countries: unpackTable(p.countries), provinces: unpackTable(p.provinces) };
}
