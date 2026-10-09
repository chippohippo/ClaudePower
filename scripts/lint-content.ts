// Validates every data/ file against its Zod schema.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DATA_SCHEMAS } from "../src/sim/schemas";

export function lintContent(dir = "data"): string[] {
  const errors: string[] = [];
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const schema = DATA_SCHEMAS[f];
    if (!schema) { errors.push(`${f}: no schema`); continue; }
    const r = schema.safeParse(JSON.parse(readFileSync(join(dir, f), "utf8")));
    if (!r.success) errors.push(`${f}: ${r.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  }
  return errors;
}

if (process.argv[1]?.endsWith("lint-content.ts")) {
  const errs = lintContent();
  if (errs.length) { console.error(errs.join("\n")); process.exit(1); }
  console.log("content ok");
}
