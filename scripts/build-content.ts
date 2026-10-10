// Compiles content (data/focuses/*.json, data/events/*.json, data/flags.json, data/ambitions.json,
// data/headlines.json) into data/generated/content.json with auto-computed focus tree layout.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { AmbitionsFile, EventsFile, FlagsFile, FocusTreeSchema, HeadlinesFile, type FocusTree } from "../src/sim/script/content";

const read = (f: string) => JSON.parse(readFileSync(f, "utf8"));
const dir = (d: string) => readdirSync(d).filter((f) => f.endsWith(".json")).sort().map((f) => `${d}/${f}`);

/** Layered layout: y = depth (longest prerequisite chain), x = branch order then within-layer order. */
export function layoutTree(t: FocusTree): Record<string, [number, number]> {
  const byId = new Map(t.focuses.map((f) => [f.id, f]));
  const depth = new Map<string, number>();
  const d = (id: string, seen = new Set<string>()): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (seen.has(id)) throw new Error(`prerequisite cycle at ${t.id}/${id}`);
    seen.add(id);
    const f = byId.get(id);
    const parents = f ? [...f.prerequisites, ...f.anyOf].filter((p) => byId.has(p)) : [];
    const v = parents.length ? 1 + Math.max(...parents.map((p) => d(p, seen))) : 0;
    depth.set(id, v);
    return v;
  };
  t.focuses.forEach((f) => d(f.id));
  const branches = [...new Set(t.focuses.map((f) => f.branch ?? "main"))];
  const out: Record<string, [number, number]> = {};
  let x0 = 0;
  for (const br of branches) {
    const fs = t.focuses.filter((f) => (f.branch ?? "main") === br);
    const layers = new Map<number, string[]>();
    for (const f of fs) { const k = depth.get(f.id)!; (layers.get(k) ?? layers.set(k, []).get(k)!).push(f.id); }
    const width = Math.max(...[...layers.values()].map((l) => l.length));
    for (const [k, ids] of layers) ids.forEach((id, i) => { out[id] = [x0 + i + (width - ids.length) / 2, k]; });
    x0 += width + 0.5;
  }
  return out;
}

export function buildContent() {
  const parsed = dir("data/focuses").map((f) => FocusTreeSchema.parse(read(f)));
  // Generic modules combine into one "National Development" tree for every nation without its own.
  const generic = parsed.filter((t) => t.countries === "generic");
  const combined: FocusTree = { id: "generic", name: "National Development", countries: "generic", focuses: generic.flatMap((t) => t.focuses) };
  const trees = [...parsed.filter((t) => t.countries !== "generic"), combined].map((t) => ({ ...t, layout: layoutTree(t) }));
  const events = dir("data/events").flatMap((f) => EventsFile.parse(read(f)));
  return {
    trees, events,
    flags: FlagsFile.parse(read("data/flags.json")),
    ambitions: AmbitionsFile.parse(read("data/ambitions.json")),
    headlines: HeadlinesFile.parse(read("data/headlines.json")),
  };
}

if (process.argv[1]?.endsWith("build-content.ts")) {
  const b = buildContent();
  writeFileSync("data/generated/content.json", JSON.stringify(b));
  console.log(`${b.trees.length} trees (${b.trees.reduce((s, t) => s + t.focuses.length, 0)} focuses), ${b.events.length} events, ${b.ambitions.length} ambitions, ${b.flags.length} flags`);
}
