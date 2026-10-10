// Laws: one active law per category; each law is a set of modifiers (source "law:<category>").
import lawsJson from "../../data/laws.json";
import { LawsFile } from "./schemas";
import { addModifier, removeModifiers } from "./modifiers";
import type { World } from "./world";

export const LAWS = LawsFile.parse(lawsJson);
export const lawCol = (cat: number) => `law${cat}`;
export const categoryIndex = (id: string) => LAWS.findIndex((c) => c.id === id);

export function activeLaw(w: World, c: number, cat: number): number { return w.countries.cols[lawCol(cat)]![c]!; }

export function enactLaw(w: World, c: number, cat: number, law: number): void {
  const scope = `c:${c}`, source = `law:${LAWS[cat]!.id}`;
  removeModifiers(w, scope, source);
  w.countries.cols[lawCol(cat)]![c] = law;
  for (const m of LAWS[cat]!.laws[law]!.modifiers) addModifier(w, { target: m.target, scope, source, ...(m.add !== undefined ? { add: m.add } : {}), ...(m.mult !== undefined ? { mult: m.mult } : {}) });
}

/** Display label for a modifier source like "law:economic". */
export function sourceLabel(w: World, c: number, source: string): string {
  if (!source.startsWith("law:")) return source;
  const cat = categoryIndex(source.slice(4));
  return cat < 0 ? source : LAWS[cat]!.laws[activeLaw(w, c, cat)]!.name;
}
