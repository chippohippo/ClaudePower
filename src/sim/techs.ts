// Technology (§10): each country has an effective year per tree. Research speed comes from literacy,
// universities and scientists (research_speed); diffusion gives laggards a catch-up bonus; running ahead
// of the calendar slows research. A tech unlocks when its tree's effective year passes the tech's year.
// Ideas: groups bought with monarch points into a limited number of slots, plus fixed national ideas.
import techsJson from "../../data/techs.json";
import ideasJson from "../../data/ideas.json";
import { IdeasFile, TechsFile } from "./schemas";
import type { World } from "./world";
import { toYmd } from "./date";
import { addModifier, countryStat } from "./modifiers";
import { chronicle } from "./characters";

export const TREES = TechsFile.parse(techsJson);
export const IDEAS = IdeasFile.parse(ideasJson);
export const N_TREES = TREES.length;
export const treeIndex = (id: string) => TREES.findIndex((t) => t.id === id);
export const TREE_INDUSTRY = treeIndex("industry"), TREE_BIOMED = treeIndex("biomedicine"), TREE_SOCIETY = treeIndex("society");

/** Years of lag at 1936 for a fully illiterate country. */
export const START_LAG = 22;
/** Catch-up: +1 year/year of speed per DIFFUSION years behind the world frontier. */
export const DIFFUSION = 30;
/** Ahead of the calendar: speed halves every AHEAD_HALF years. */
export const AHEAD_HALF = 1.5;
export const IDEA_COST = 200;
export const MAX_IDEA_SLOTS = 8;

const techCol = (k: number) => `tech${k}`;
/** Effective year of a tree, normalised so every country starts at 1936 for its 1936 level (techLag removed). */
export const techYear = (w: World, c: number, tree: number) => w.countries.cols[techCol(tree)]![c]!;

/** Seed tech years from literacy (laggards start behind) and apply 1936 techs and national ideas. */
export function seedTechs(w: World): void {
  const cc = w.countries.cols, n = w.countries.size, p = w.pops.cols;
  const lit = new Float64Array(n), size = new Float64Array(n);
  for (let i = 0; i < w.pops.size; i++) {
    const c = w.provinces.cols.owner![p.prov![i]!]!, s = p.a0![i]! + p.a1![i]! + p.a2![i]!;
    lit[c] = lit[c]! + p.literacy![i]! * s; size[c] = size[c]! + s;
  }
  for (let c = 0; c < n; c++) {
    const l = size[c]! > 0 ? lit[c]! / size[c]! : 0.3;
    cc.techLag![c] = Math.round(START_LAG * Math.max(0, 0.9 - l) / 0.9);
    for (let k = 0; k < N_TREES; k++) cc[techCol(k)]![c] = 1936 - cc.techLag![c]!;
    for (let k = 0; k < N_TREES; k++) unlockUpTo(w, c, k, -Infinity, false);
    const nat = IDEAS.national[w.countryTags[c]!];
    if (nat) nat.forEach((idea, i) => applyMods(w, c, `idea:national:${i}`, idea.modifiers));
  }
}

function applyMods(w: World, c: number, source: string, mods: { target: string; add?: number; mult?: number }[]) {
  for (const m of mods) addModifier(w, { target: m.target, scope: `c:${c}`, source, ...(m.add !== undefined ? { add: m.add } : {}), ...(m.mult !== undefined ? { mult: m.mult } : {}) });
}

function unlockUpTo(w: World, c: number, tree: number, from: number, announce: boolean) {
  const to = techYear(w, c, tree);
  for (const t of TREES[tree]!.techs) {
    if (t.year > to || t.year <= from) continue;
    applyMods(w, c, `tech:${t.id}`, t.modifiers);
    w.countryFlags[c]![`tech_${t.id}`] = w.date;
    for (const f of t.flags) w.countryFlags[c]![f] = w.date;
    if (announce && t.year >= 1940 && (t.flags.length > 0 || !w.flags[`first_${t.id}`])) {
      if (!w.flags[`first_${t.id}`]) { w.flags[`first_${t.id}`] = w.date; chronicle(w, c, "tech", `${w.countryTags[c]} is first to research ${t.name}`); }
    }
  }
}

/** Monthly research. */
export function runResearch(w: World): void {
  const cc = w.countries.cols, n = w.countries.size, cal = toYmd(w.date).year + (toYmd(w.date).month - 1) / 12;
  const speedStat = countryStat(w, "research_speed");
  const frontier = new Float64Array(N_TREES).fill(-Infinity);
  for (let c = 0; c < n; c++) {
    if (cc.population![c]! <= 0) continue;
    for (let k = 0; k < N_TREES; k++) frontier[k] = Math.max(frontier[k]!, cc[techCol(k)]![c]!);
  }
  for (let c = 0; c < n; c++) {
    if (cc.population![c]! <= 0) continue;
    // Literacy and universities (development of the society tree) drive base speed.
    const base = (0.45 + 0.6 * cc.literacy![c]!) * speedStat[c]!;
    for (let k = 0; k < N_TREES; k++) {
      const col = cc[techCol(k)]!, y = col[c]!;
      let speed = base + Math.max(0, frontier[k]! - y) / DIFFUSION;
      if (y > cal) speed *= 0.5 ** ((y - cal) / AHEAD_HALF);
      col[c] = y + speed / 12;
      if (Math.floor(col[c]!) !== Math.floor(y)) unlockUpTo(w, c, k, y, true);
    }
  }
}

/** Productivity / medicine / schooling use growth since 1936 (lag credited back), never beyond the calendar or own tech year. */
export function relYear(w: World, c: number, tree: number): number {
  const y = techYear(w, c, tree);
  return Math.min(y + w.countries.cols.techLag![c]!, Math.max(y, toYmd(w.date).year));
}

export function ideaSlots(w: World, c: number): number {
  let s = 0;
  for (let k = 0; k < N_TREES; k++) s += techYear(w, c, k);
  return Math.max(1, Math.min(MAX_IDEA_SLOTS, 1 + Math.floor((s / N_TREES - 1936) / 8)));
}

const KIND_COL = { adm: "adm", dip: "dip", mil: "mil" } as const;

/** Why the next idea of group g can't be taken, or null. */
export function ideaBlocker(w: World, c: number, g: number): string | null {
  const grp = IDEAS.groups[g];
  if (!grp) return "Unknown idea group";
  const have = w.ideas[c]!.find((x) => x.g === g);
  if (have && have.n >= grp.ideas.length) return "Group complete";
  if (!have && w.ideas[c]!.length >= ideaSlots(w, c)) return "No free idea slot (more come with technology)";
  if (w.countries.cols[KIND_COL[grp.kind]]![c]! < IDEA_COST) return `Needs ${IDEA_COST} ${grp.kind.toUpperCase()}`;
  return null;
}

export function takeIdea(w: World, c: number, g: number): void {
  const grp = IDEAS.groups[g]!;
  let have = w.ideas[c]!.find((x) => x.g === g);
  if (!have) { have = { g, n: 0 }; w.ideas[c]!.push(have); }
  w.countries.cols[KIND_COL[grp.kind]]![c]! -= IDEA_COST;
  applyMods(w, c, `idea:${grp.id}:${have.n}`, grp.ideas[have.n]!.modifiers);
  have.n++;
}

/** AI: finish started groups first, otherwise open the group with the most points available. */
export function aiIdeas(w: World, c: number): void {
  for (const have of w.ideas[c]!) if (!ideaBlocker(w, c, have.g)) { takeIdea(w, c, have.g); return; }
  let best = -1, bestPts = -1;
  for (let g = 0; g < IDEAS.groups.length; g++) {
    if (w.ideas[c]!.some((x) => x.g === g) || ideaBlocker(w, c, g)) continue;
    const pts = w.countries.cols[KIND_COL[IDEAS.groups[g]!.kind]]![c]! + ((g * 7919 + c * 31) % 13); // stable variety
    if (pts > bestPts) { bestPts = pts; best = g; }
  }
  if (best >= 0) takeIdea(w, c, best);
}
