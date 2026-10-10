// Consistency linter (§10.2): unknown references, flags read but never set (or set but undeclared),
// focus graph errors and unreachable focuses, major outcomes without reaction content.
import { LAWS } from "../src/sim/laws";
import { IGS } from "../src/sim/igs";
import { BUILDINGS } from "../src/sim/defs";
import type { Condition, Effect } from "../src/sim/script/schema";
import { buildContent } from "./build-content";

export function lintConsistency(): string[] {
  const b = buildContent(), errors: string[] = [];
  const declared = new Map(b.flags.map((f) => [f.id, f]));
  const flagsSet = new Set<string>(["era_crisis", "era_reconstruction", "era_cold_war", "era_globalisation", "era_information"]);
  const cflagsSet = new Set<string>(), flagsRead = new Map<string, string>(), cflagsRead = new Map<string, string>();
  const allFocusIds = new Set(b.trees.flatMap((t) => t.focuses.map((f) => f.id)));
  const eventIds = new Set(b.events.map((e) => e.id));
  const law = (where: string, cat: string, id: string) => { const c = LAWS.find((x) => x.id === cat); if (!c || !c.laws.some((l) => l.id === id)) errors.push(`${where}: unknown law ${cat}/${id}`); };
  const ig = (where: string, id: string) => { if (!IGS.some((g) => g.id === id)) errors.push(`${where}: unknown IG ${id}`); };

  const walkC = (c: Condition | undefined, where: string): void => {
    if (!c) return;
    if ("all" in c) c.all.forEach((k) => walkC(k, where));
    else if ("any" in c) c.any.forEach((k) => walkC(k, where));
    else if ("not" in c) walkC(c.not, where);
    else if ("flag" in c) flagsRead.set(c.flag, where);
    else if ("countryFlag" in c) cflagsRead.set(c.countryFlag, where);
    else if ("law" in c) law(where, c.law.category, c.law.law);
    else if ("ig" in c) ig(where, c.ig.id);
    else if ("focus" in c && !allFocusIds.has(c.focus)) errors.push(`${where}: unknown focus ${c.focus}`);
  };
  const walkE = (es: Effect[], where: string): void => es.forEach((e) => {
    if ("setFlag" in e) { flagsSet.add(e.setFlag); if (!declared.has(e.setFlag)) errors.push(`${where}: flag ${e.setFlag} is set but not declared in data/flags.json`); }
    else if ("setCountryFlag" in e) cflagsSet.add(e.setCountryFlag);
    else if ("law" in e) law(where, e.law.category, e.law.law);
    else if ("igFavour" in e) ig(where, e.igFavour.id);
    else if ("igRadicalism" in e) ig(where, e.igRadicalism.id);
    else if ("privilege" in e) ig(where, e.privilege.id);
    else if ("build" in e && !BUILDINGS.some((x) => x.id === e.build.building)) errors.push(`${where}: unknown building ${e.build.building}`);
    else if ("triggerEvent" in e && !eventIds.has(e.triggerEvent)) errors.push(`${where}: unknown event ${e.triggerEvent}`);
  });

  for (const t of b.trees) {
    const ids = new Set(t.focuses.map((f) => f.id));
    if (ids.size !== t.focuses.length) errors.push(`tree ${t.id}: duplicate focus ids`);
    walkC(t.eligible, `tree ${t.id}`);
    for (const f of t.focuses) {
      const where = `focus ${t.id}/${f.id}`;
      for (const p of [...f.prerequisites, ...f.anyOf, ...f.exclusive]) if (!ids.has(p)) errors.push(`${where}: references missing focus ${p}`);
      for (const x of f.exclusive) { const o = t.focuses.find((g) => g.id === x); if (o && !o.exclusive.includes(f.id)) errors.push(`${where}: exclusive with ${x} but not vice versa`); }
      if (f.prerequisites.some((p) => f.exclusive.includes(p))) errors.push(`${where}: requires a focus it excludes (unreachable)`);
      walkC(f.available, where); walkE(f.effects, where);
    }
    // Unreachable: a prerequisite chain that is itself unreachable.
    const reach = new Map<string, boolean>();
    const ok = (id: string, seen = new Set<string>()): boolean => {
      if (reach.has(id)) return reach.get(id)!;
      if (seen.has(id)) return false;
      seen.add(id);
      const f = t.focuses.find((g) => g.id === id)!;
      const r = f.prerequisites.every((p) => ids.has(p) && ok(p, seen)) && (!f.anyOf.length || f.anyOf.some((p) => ids.has(p) && ok(p, seen)))
        && !f.prerequisites.some((p) => f.exclusive.includes(p));
      reach.set(id, r);
      return r;
    };
    for (const f of t.focuses) if (!ok(f.id)) errors.push(`focus ${t.id}/${f.id}: unreachable`);
  }
  for (const e of b.events) {
    const where = `event ${e.id}`;
    walkC(e.trigger, where); walkC(e.bindIf, where);
    e.choices.forEach((c, i) => walkE(c.effects, `${where} choice ${i}`));
    if (e.scope === "province" && !e.bindIf) errors.push(`${where}: province event without bindIf`);
  }
  for (const a of b.ambitions) { walkC(a.eligible, `ambition ${a.id}`); walkC(a.goal, `ambition ${a.id}`); walkE(a.reward, `ambition ${a.id}`); }
  for (const [f, where] of flagsRead) if (!flagsSet.has(f)) errors.push(`${where}: reads flag ${f}, which nothing sets`);
  for (const [f, where] of cflagsRead) if (!cflagsSet.has(f)) errors.push(`${where}: reads country flag ${f}, which nothing sets`);
  for (const f of b.flags) if (f.major && !b.events.some((e) => e.reactsTo.includes(f.id))) errors.push(`flag ${f.id}: major outcome with no reaction content`);
  for (const f of b.flags) if (!flagsSet.has(f.id)) errors.push(`flag ${f.id}: declared but never set`);
  return errors;
}

if (process.argv[1]?.endsWith("lint-consistency.ts")) {
  const errs = lintConsistency();
  if (errs.length) { console.error(errs.join("\n")); process.exit(1); }
  console.log("consistency ok");
}
