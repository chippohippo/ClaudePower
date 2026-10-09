// Validates every data/ file against its Zod schema.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { DATA_SCHEMAS } from "../src/sim/schemas";

const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));

export function lintContent(dir = "data"): string[] {
  const errors: string[] = [];
  for (const path of walk(dir).filter((f) => f.endsWith(".json"))) {
    const f = relative(dir, path).replaceAll("\\", "/");
    const schema = DATA_SCHEMAS[f];
    if (!schema) { errors.push(`${f}: no schema`); continue; }
    const r = schema.safeParse(JSON.parse(readFileSync(path, "utf8")));
    if (!r.success) errors.push(`${f}: ${r.error.issues.slice(0, 5).map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  }
  return errors;
}

if (process.argv[1]?.endsWith("lint-content.ts")) {
  const errs = lintContent();
  if (errs.length) { console.error(errs.join("\n")); process.exit(1); }
  console.log("content ok");
}
