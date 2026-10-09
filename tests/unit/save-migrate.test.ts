import { expect, test } from "vitest";
import { encode } from "@msgpack/msgpack";
import { gzipSync } from "fflate";
import { loadWorld } from "../../src/sim/save";
import { WORLD_VERSION } from "../../src/sim/world";

test("a v1 save migrates to the current version", () => {
  const bin = (a: Int32Array | Float64Array) => new Uint8Array(a.buffer);
  const v1 = {
    version: 1, seed: 1, date: 10, rng: [1, 2, 3, 4], countryTags: ["AAA"],
    countries: { size: 1, cols: { treasury: { t: "i32", b: bin(new Int32Array([5])) }, stability: { t: "f64", b: bin(new Float64Array([0])) } } },
    provinces: { size: 2, cols: { owner: { t: "i32", b: bin(new Int32Array([0, 0])) }, population: { t: "f64", b: bin(new Float64Array(2)) }, development: { t: "f64", b: bin(new Float64Array(2)) } } },
    modifiers: [], base: {},
  };
  const w = loadWorld(gzipSync(encode(v1)));
  expect(w.version).toBe(WORLD_VERSION);
  expect(w.pops.size).toBe(0);
  expect(w.provinces.cols.terrain!.length).toBe(2);
  expect(w.countries.cols.debt!.length).toBe(1);
});
