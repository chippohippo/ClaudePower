// Focus engine: one focus at a time per country; progress daily (applied monthly); AI and auto-focus
// pick by weight. Trees are assigned at start: national tree if one exists, else the best generic tree.
import { TREES, focusById, treeById } from "../script/bundle";
import type { FocusDef } from "../script/content";
import { apply, test } from "../script/eval";
void 0;
import { chronicle } from "../characters";
import type { World } from "../world";

import { AUTO_FOCUS } from "../setup";

export function assignTrees(w: World): void {
  for (let c = 0; c < w.countries.size; c++) {
    const tag = w.countryTags[c]!;
    const own = TREES.find((t) => t.countries !== "generic" && t.countries.includes(tag));
    const generic = TREES.find((t) => t.id === "generic");
    w.focus[c] = { tree: (own ?? generic)?.id ?? "", current: null, progress: 0, done: [] };
  }
}

/** Why a focus can't be started (or null if it can). Cost is checked separately for greyed-out reasons. */
export function focusBlocker(w: World, c: number, f: FocusDef): string | null {
  const st = w.focus[c]!;
  if (st.done.includes(f.id)) return "Already completed";
  if (st.current === f.id) return "In progress";
  const missing = f.prerequisites.filter((p) => !st.done.includes(p));
  if (missing.length) return `Requires ${missing.map(nameOf(st.tree)).join(", ")}`;
  if (f.anyOf.length && !f.anyOf.some((p) => st.done.includes(p))) return `Requires one of ${f.anyOf.map(nameOf(st.tree)).join(" / ")}`;
  const ex = f.exclusive.find((x) => st.done.includes(x) || st.current === x);
  if (ex) return `Mutually exclusive with ${nameOf(st.tree)(ex)}`;
  if (f.available && !test(f.available, { w, c })) return "Conditions not met";
  return null;
}
const nameOf = (tree: string) => (id: string) => focusById(tree, id)?.name ?? id;

export function availableFocuses(w: World, c: number): FocusDef[] {
  const t = treeById(w.focus[c]!.tree);
  return t ? t.focuses.filter((f) => !focusBlocker(w, c, f)) : [];
}

export function completeFocus(w: World, c: number, f: FocusDef): void {
  const st = w.focus[c]!;
  st.done.push(f.id); st.current = null; st.progress = 0;
  apply(f.effects, { w, c }, `focus:${f.id}`);
  chronicle(w, c, "focus", `${w.countryTags[c]} completes the focus “${f.name}”.`);
}

/** Monthly: advance progress (30 days); AI / auto-focus choose the next focus by weight. */
export function runFocus(w: World): void {
  const cc = w.countries.cols;
  for (let c = 0; c < w.countries.size; c++) {
    const st = w.focus[c]!;
    if (!st.tree) continue;
    if (st.current) {
      const f = focusById(st.tree, st.current);
      if (!f) { st.current = null; continue; }
      st.progress += 30.44;
      if (st.progress >= f.days) completeFocus(w, c, f);
      continue;
    }
    if (!(cc.automation![c]! & AUTO_FOCUS)) continue;
    const options = availableFocuses(w, c).filter((f) => cc.pp![c]! >= f.cost);
    if (!options.length) continue;
    const pick = options.reduce((a, b) => (b.ai > a.ai ? b : a));
    cc.pp![c]! -= pick.cost;
    st.current = pick.id; st.progress = 0;
  }
}
