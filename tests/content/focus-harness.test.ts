// M5 exit test: every branch of every tree is reachable when a harness forces choices. For each tree
// we replay runs on a cloned world: pick the next startable focus (respecting prerequisites and
// exclusivity), force its `available` condition true (set flags, stats, laws…), start and complete it.
// Exclusive branches are covered by further runs until every focus has been completed in some run.
import { expect, test } from "vitest";
import { loadContent } from "../../src/sim/content";
import { createWorld } from "../../src/sim/setup";
import { loadWorld, saveWorld } from "../../src/sim/save";
import { TREES } from "../../src/sim/script/bundle";
import type { Condition } from "../../src/sim/script/schema";
import { applyCommand, validateCommand } from "../../src/sim/commands";
import { completeFocus } from "../../src/sim/systems/focus";
import { categoryIndex, enactLaw, LAWS } from "../../src/sim/laws";
import { igIndex, igRow } from "../../src/sim/igs";
import { fromYmd } from "../../src/sim/date";
import { lintConsistency } from "../../scripts/lint-consistency";
import { buildContent } from "../../scripts/build-content";
import bundle from "../../data/generated/content.json";
import type { World } from "../../src/sim/world";
import "../../src/sim/commands/content";

const IDEO = { dem: "ideoDem", fas: "ideoFas", com: "ideoCom", non: "ideoNon" } as const;
function force(w: World, c: number, cond: Condition): void {
  const cc = w.countries.cols;
  const nudge = (op: string, v: number) => (op === ">" || op === ">=" ? v + 1 : v - 1);
  if ("all" in cond) cond.all.forEach((k) => force(w, c, k));
  else if ("any" in cond) force(w, c, cond.any[0]!);
  else if ("not" in cond) { if ("flag" in cond.not) delete w.flags[cond.not.flag]; }
  else if ("flag" in cond) w.flags[cond.flag] = w.date;
  else if ("countryFlag" in cond) w.countryFlags[c]![cond.countryFlag] = w.date;
  else if ("year" in cond && cond.year.min) w.date = Math.max(w.date, fromYmd(cond.year.min, 1, 1));
  else if ("government" in cond) cc.government![c] = cond.government === "democracy" ? 0 : 1;
  else if ("law" in cond) { const k = categoryIndex(cond.law.category); enactLaw(w, c, k, LAWS[k]!.laws.findIndex((l) => l.id === cond.law.law)); }
  else if ("stat" in cond) { const v = nudge(cond.stat.op, cond.stat.value); if (cond.stat.key === "stability") cc.stability![c] = Math.max(-3, Math.min(3, v)); else if (cc[cond.stat.key]) cc[cond.stat.key]![c] = v; }
  else if ("ig" in cond) { const g = igIndex(cond.ig.id), v = nudge(cond.ig.op, cond.ig.value); w.igs.cols[cond.ig.key]![igRow(c, g)] = cond.ig.key === "clout" ? v / 100 : v; }
  else if ("ideology" in cond) cc[IDEO[cond.ideology.id]]![c] = nudge(cond.ideology.op, cond.ideology.value) / 100;
}

test("content linter is clean and the compiled bundle is up to date", () => {
  expect(lintConsistency()).toEqual([]);
  expect(JSON.parse(JSON.stringify(buildContent()))).toEqual(bundle);
});

test("every focus in every tree is reachable by forcing choices", () => {
  const data = loadContent();
  const base = createWorld(5, data).world;
  const bytes = saveWorld(base);
  const unreached: string[] = [];
  for (const t of TREES) {
    const tag = t.countries === "generic" ? "ARG" : t.countries[0]!;
    const byId = new Map(t.focuses.map((f) => [f.id, f]));
    // Path to a target: its prerequisite closure (first option of each anyOf), in dependency order.
    const path = (id: string, out: string[] = []): string[] => {
      const f = byId.get(id)!;
      for (const p of [...f.prerequisites, ...(f.anyOf.length ? [f.anyOf[0]!] : [])]) if (!out.includes(p)) path(p, out);
      if (!out.includes(id)) out.push(id);
      return out;
    };
    for (const target of t.focuses) {
      const w = loadWorld(bytes), c = w.countryTags.indexOf(tag);
      w.focus[c] = { tree: t.id, current: null, progress: 0, done: [] };
      let ok = true;
      for (const id of path(target.id)) {
        const f = byId.get(id)!;
        if (f.available) force(w, c, f.available);
        w.countries.cols.pp![c] = 5000; for (const k of ["adm", "dip", "mil"]) w.countries.cols[k]![c] = 999;
        const cmd = { type: "start_focus", actor: c, payload: { focus: id }, issuedOn: w.date };
        const v = validateCommand(cmd, w);
        if (!v.ok) { ok = false; unreached.push(`${t.id}/${target.id} (blocked at ${id}: ${v.reason})`); break; }
        applyCommand(cmd, w);
        completeFocus(w, c, f);
      }
      if (ok && !w.focus[c]!.done.includes(target.id)) unreached.push(`${t.id}/${target.id}`);
    }
  }
  expect(unreached).toEqual([]);
}, 300_000);
