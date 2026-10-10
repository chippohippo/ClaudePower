// Evaluate conditions, apply effects, and describe both in plain language (previews, tooltips, linter).
import type { Condition, Effect } from "./schema";
import type { EventBinding, World } from "../world";
import { LAWS, activeLaw, categoryIndex, enactLaw } from "../laws";
import { IGS, igIndex, igRow, setPrivilege } from "../igs";
import { Role, chronicle, findRole } from "../characters";
import { addModifier } from "../modifiers";
import { Acct, budgetLine, burn, mint } from "../money";
import { buildingIndex } from "../defs";
import { ensureCapacity } from "../world";
import { fromYmd, toYmd } from "../date";
import { IDEOLOGIES } from "../schemas";

export interface Ctx { w: World; c: number; bind?: EventBinding }
const cmp = (a: number, op: string, b: number) => (op === ">" ? a > b : op === "<" ? a < b : op === ">=" ? a >= b : a <= b);
const IDEO_COLS = ["ideoDem", "ideoFas", "ideoCom", "ideoNon"] as const;

export function countryStatValue(w: World, c: number, key: string): number {
  const cc = w.countries.cols;
  switch (key) {
    case "debtRatio": return cc.debt![c]! / Math.max(1, cc.gdpYear![c]!);
    case "gdpPerCapita": return cc.gdpYear![c]! / Math.max(1, cc.population![c]!) / 100;
    case "treasuryMonths": return cc.treasury![c]! / Math.max(1, cc.expense![c]!);
    case "year": return toYmd(w.date).year;
    default: return cc[key]?.[c] ?? 0;
  }
}

export function test(cond: Condition, x: Ctx): boolean {
  const { w, c } = x;
  if ("all" in cond) return cond.all.every((k) => test(k, x));
  if ("any" in cond) return cond.any.some((k) => test(k, x));
  if ("not" in cond) return !test(cond.not, x);
  if ("flag" in cond) return cond.flag in w.flags;
  if ("countryFlag" in cond) return cond.countryFlag in (w.countryFlags[c] ?? {});
  if ("tag" in cond) return w.countryTags[c] === cond.tag;
  if ("government" in cond) return (w.countries.cols.government![c] === 0 ? "democracy" : "autocracy") === cond.government;
  if ("year" in cond) { const y = toYmd(w.date).year; return (cond.year.min === undefined || y >= cond.year.min) && (cond.year.max === undefined || y <= cond.year.max); }
  if ("law" in cond) { const k = categoryIndex(cond.law.category); return k >= 0 && LAWS[k]!.laws[activeLaw(w, c, k)]!.id === cond.law.law; }
  if ("stat" in cond) return cmp(countryStatValue(w, c, cond.stat.key), cond.stat.op, cond.stat.value);
  if ("ig" in cond) { const g = igIndex(cond.ig.id); return g >= 0 && cmp(w.igs.cols[cond.ig.key]![igRow(c, g)]! * (cond.ig.key === "clout" ? 100 : 1), cond.ig.op, cond.ig.value); }
  if ("igBound" in cond) { const g = x.bind?.ig; return g !== undefined && cmp(w.igs.cols[cond.igBound.key]![igRow(c, g)]! * (cond.igBound.key === "clout" ? 100 : 1), cond.igBound.op, cond.igBound.value); }
  if ("focus" in cond) return w.focus[c]?.done.includes(cond.focus) ?? false;
  if ("headIdeology" in cond) { const h = findRole(w, c, Role.Head); return h >= 0 && IDEOLOGIES[w.characters.cols.ideology![h]!] === cond.headIdeology; }
  if ("ideology" in cond) return cmp(100 * w.countries.cols[IDEO_COLS[IDEOLOGIES.indexOf(cond.ideology.id)]!]![c]!, cond.ideology.op, cond.ideology.value);
  if ("atWarFlag" in cond) return `war:${cond.atWarFlag}` in w.flags;
  if ("always" in cond) return cond.always;
  if ("province" in cond) { const p = x.bind?.province; return p !== undefined && cmp(w.provinces.cols[cond.province.key]![p]! * (cond.province.key === "unemployment" ? 100 : 1), cond.province.op, cond.province.value); }
  return false;
}

const target = (x: Ctx, where: "capital" | "largest" | "bound" | "all"): number[] => {
  const { w, c } = x;
  if (where === "bound" && x.bind?.province !== undefined) return [x.bind.province];
  if (where === "all") { const out = []; for (let p = 0; p < w.provinces.size; p++) if (w.provinces.cols.owner![p] === c) out.push(p); return out; }
  if (where === "largest") { let best = -1; for (let p = 0; p < w.provinces.size; p++) if (w.provinces.cols.owner![p] === c && (best < 0 || w.provinces.cols.population![p]! > w.provinces.cols.population![best]!)) best = p; return best < 0 ? [] : [best]; }
  return [w.countries.cols.capital![c]!];
};

export function apply(effects: Effect[], x: Ctx, source: string): void {
  const { w, c } = x, cc = w.countries.cols;
  for (const e of effects) {
    if ("pp" in e) cc.pp![c] = Math.max(0, cc.pp![c]! + e.pp);
    else if ("points" in e) for (const k of ["adm", "dip", "mil"] as const) { if (e.points[k]) cc[k]![c] = Math.max(0, Math.min(999, cc[k]![c]! + e.points[k]!)); }
    else if ("treasuryMonths" in e) {
      const cents = Math.floor((e.treasuryMonths * Math.max(cc.gdpYear![c]!, 1)) / 12 * 0.1);
      budgetLine("other");
      if (cents > 0) mint(w, Acct.Treasury, c, cents, true);
      else if (cents < 0) burn(w, Acct.Treasury, c, Math.min(-cents, Math.max(0, Math.floor(cc.treasury![c]!))), true); // spend; never below zero
    }
    else if ("setFlag" in e) w.flags[e.setFlag] = w.date;
    else if ("clearFlag" in e) delete w.flags[e.clearFlag];
    else if ("setCountryFlag" in e) w.countryFlags[c]![e.setCountryFlag] = w.date;
    else if ("clearCountryFlag" in e) delete w.countryFlags[c]![e.clearCountryFlag];
    else if ("modifier" in e) {
      const m = e.modifier;
      addModifier(w, { target: m.target, scope: `c:${c}`, source: m.name, ...(m.add !== undefined ? { add: m.add } : {}), ...(m.mult !== undefined ? { mult: m.mult } : {}), ...(m.months ? { expires: w.date + Math.round(m.months * 30.44) } : {}) });
    }
    else if ("law" in e) { const k = categoryIndex(e.law.category), l = LAWS[k]?.laws.findIndex((x2) => x2.id === e.law.law) ?? -1; if (k >= 0 && l >= 0) enactLaw(w, c, k, l); }
    else if ("stability" in e) cc.stability![c] = Math.max(-3, Math.min(3, cc.stability![c]! + e.stability));
    else if ("igFavour" in e) { const g = igIndex(e.igFavour.id); if (g >= 0) w.igs.cols.favour![igRow(c, g)]! += e.igFavour.value; }
    else if ("igRadicalism" in e) { const g = igIndex(e.igRadicalism.id); if (g >= 0) { const r = igRow(c, g); w.igs.cols.radicalism![r] = Math.max(0, Math.min(100, w.igs.cols.radicalism![r]! + e.igRadicalism.value)); } }
    else if ("boundIgFavour" in e) { if (x.bind?.ig !== undefined) w.igs.cols.favour![igRow(c, x.bind.ig)]! += e.boundIgFavour; }
    else if ("boundIgRadicalism" in e) { if (x.bind?.ig !== undefined) { const r = igRow(c, x.bind.ig); w.igs.cols.radicalism![r] = Math.max(0, Math.min(100, w.igs.cols.radicalism![r]! + e.boundIgRadicalism)); } }
    else if ("build" in e) for (const p of target(x, e.build.where)) addBuilding(w, p, buildingIndex(e.build.building), e.build.levels);
    else if ("develop" in e) { const col = ({ tax: "devTax", production: "devProd", manpower: "devMan" } as const)[e.develop.kind]; for (const p of target(x, e.develop.where)) { w.provinces.cols[col]![p]! += e.develop.amount; w.provinces.cols.development![p]! += e.develop.amount; } }
    else if ("provinceUnrest" in e) { const p = x.bind?.province; if (p !== undefined) w.provinces.cols.unrest![p] = Math.max(0, Math.min(10, w.provinces.cols.unrest![p]! + e.provinceUnrest)); }
    else if ("government" in e) cc.government![c] = e.government === "democracy" ? 0 : 1;
    else if ("ideologyShift" in e) {
      const k = IDEOLOGIES.indexOf(e.ideologyShift.id), p = w.pops.cols;
      for (let i = 0; i < w.pops.size; i++) {
        if (w.provinces.cols.owner![p.prov![i]!] !== c) continue;
        const col = p[IDEO_COLS[k]!]!;
        col[i] = Math.max(0, Math.min(1, col[i]! + e.ideologyShift.amount));
      }
      cc[IDEO_COLS[k]!]![c] = Math.max(0, Math.min(1, cc[IDEO_COLS[k]!]![c]! + e.ideologyShift.amount));
    }
    else if ("privilege" in e) { const g = igIndex(e.privilege.id); if (g >= 0) setPrivilege(w, c, g, e.privilege.granted); }
    else if ("chronicle" in e) chronicle(w, c, "story", fill(e.chronicle, x));
    else if ("triggerEvent" in e) queueEvent?.(w, c, e.triggerEvent, x.bind ?? {});
  }
  void source;
}

/** Set by the event engine (avoids an import cycle). */
export let queueEvent: ((w: World, c: number, id: string, bind: EventBinding) => void) | null = null;
export const setQueueEvent = (f: typeof queueEvent) => { queueEvent = f; };

function addBuilding(w: World, prov: number, type: number, levels: number): void {
  if (type < 0) return;
  const b = w.buildings.cols;
  for (let i = 0; i < w.buildings.size; i++) if (b.prov![i] === prov && b.type![i] === type) { b.level![i]! += levels; return; }
  ensureCapacity(w.buildings, w.buildings.size + 1);
  const i = w.buildings.size++, nb = w.buildings.cols;
  for (const a of Object.values(nb)) a[i] = 0;
  nb.prov![i] = prov; nb.type![i] = type; nb.level![i] = levels; nb.inputSat![i] = 1;
}

/** Template variables: {country} {province} {ig} {leader} {other}. */
export function fill(text: string, x: Ctx, names?: string[]): string {
  const { w, c, bind } = x;
  const head = findRole(w, c, Role.Head);
  return text
    .replaceAll("{country}", names?.[c] ?? w.countryTags[c]!)
    .replaceAll("{province}", bind?.province !== undefined ? w.provinceNames[bind.province]! : "the provinces")
    .replaceAll("{ig}", bind?.ig !== undefined ? IGS[bind.ig]!.name : "the interest groups")
    .replaceAll("{leader}", head >= 0 ? w.characterNames[head]! : "the government")
    .replaceAll("{other}", bind?.other !== undefined ? (names?.[bind.other] ?? w.countryTags[bind.other]!) : "a neighbour");
}

// ---- Descriptions (previews; no hidden gotchas) -------------------------------------------------
const opText = (op: string) => ({ ">": "above", "<": "below", ">=": "at least", "<=": "at most" })[op] ?? op;
export function describeCondition(cond: Condition): string {
  if ("all" in cond) return cond.all.map(describeCondition).join(" and ");
  if ("any" in cond) return `(${cond.any.map(describeCondition).join(" or ")})`;
  if ("not" in cond) return `not ${describeCondition(cond.not)}`;
  if ("flag" in cond) return `world: ${cond.flag.replace(/_/g, " ")}`;
  if ("countryFlag" in cond) return `${cond.countryFlag.replace(/_/g, " ")}`;
  if ("tag" in cond) return `country is ${cond.tag}`;
  if ("government" in cond) return `a ${cond.government}`;
  if ("year" in cond) return [cond.year.min ? `from ${cond.year.min}` : "", cond.year.max ? `until ${cond.year.max}` : ""].filter(Boolean).join(" ");
  if ("law" in cond) { const k = categoryIndex(cond.law.category); return `law: ${LAWS[k]?.laws.find((l) => l.id === cond.law.law)?.name ?? cond.law.law}`; }
  if ("stat" in cond) return `${cond.stat.key} ${opText(cond.stat.op)} ${cond.stat.value}`;
  if ("ig" in cond) return `${IGS[igIndex(cond.ig.id)]?.name ?? cond.ig.id} ${cond.ig.key} ${opText(cond.ig.op)} ${cond.ig.value}`;
  if ("igBound" in cond) return `the group's ${cond.igBound.key} ${opText(cond.igBound.op)} ${cond.igBound.value}`;
  if ("focus" in cond) return `focus done: ${cond.focus.replace(/_/g, " ")}`;
  if ("headIdeology" in cond) return `leader is ${cond.headIdeology}`;
  if ("ideology" in cond) return `${cond.ideology.id} support ${opText(cond.ideology.op)} ${cond.ideology.value}%`;
  if ("atWarFlag" in cond) return `at war (${cond.atWarFlag})`;
  if ("always" in cond) return cond.always ? "always" : "never";
  if ("province" in cond) return `province ${cond.province.key} ${opText(cond.province.op)} ${cond.province.value}`;
  return "?";
}

export function describeEffect(e: Effect): string {
  const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`);
  if ("pp" in e) return `${sign(e.pp)} political power`;
  if ("points" in e) return Object.entries(e.points).map(([k, v]) => `${sign(v!)} ${k.toUpperCase()}`).join(", ");
  if ("treasuryMonths" in e) return e.treasuryMonths >= 0 ? `Treasury +${e.treasuryMonths} months of 10% of GDP` : `Costs ${-e.treasuryMonths} months of 10% of GDP`;
  if ("setFlag" in e) return `World remembers: ${e.setFlag.replace(/_/g, " ")}`;
  if ("clearFlag" in e) return `Clears: ${e.clearFlag.replace(/_/g, " ")}`;
  if ("setCountryFlag" in e) return `Unlocks: ${e.setCountryFlag.replace(/_/g, " ")}`;
  if ("clearCountryFlag" in e) return `Removes: ${e.clearCountryFlag.replace(/_/g, " ")}`;
  if ("modifier" in e) { const m = e.modifier; return `${m.name}: ${m.target.replace(/_/g, " ")} ${m.add !== undefined ? sign(m.add) : ""}${m.mult !== undefined ? `${m.mult > 0 ? "+" : ""}${Math.round(100 * m.mult)}%` : ""}${m.months ? ` for ${m.months} months` : ""}`; }
  if ("law" in e) { const k = categoryIndex(e.law.category); return `Enacts ${LAWS[k]?.laws.find((l) => l.id === e.law.law)?.name ?? e.law.law}`; }
  if ("stability" in e) return `Stability ${sign(e.stability)}`;
  if ("igFavour" in e) return `${IGS[igIndex(e.igFavour.id)]?.name} approval ${sign(e.igFavour.value)} (fading)`;
  if ("igRadicalism" in e) return `${IGS[igIndex(e.igRadicalism.id)]?.name} radicalism ${sign(e.igRadicalism.value)}`;
  if ("boundIgFavour" in e) return `Their approval ${sign(e.boundIgFavour)} (fading)`;
  if ("boundIgRadicalism" in e) return `Their radicalism ${sign(e.boundIgRadicalism)}`;
  if ("build" in e) return `Builds ${e.build.levels} levels of ${e.build.building.replace(/_/g, " ")} (${e.build.where})`;
  if ("develop" in e) return `+${e.develop.amount} ${e.develop.kind} development (${e.develop.where})`;
  if ("provinceUnrest" in e) return `Unrest in the province ${sign(e.provinceUnrest)}`;
  if ("government" in e) return `Government becomes a ${e.government}`;
  if ("ideologyShift" in e) return `${e.ideologyShift.id} support ${sign(Math.round(e.ideologyShift.amount * 100))}%`;
  if ("privilege" in e) return `${e.privilege.granted ? "Grants" : "Revokes"} the ${IGS[igIndex(e.privilege.id)]?.name} privilege`;
  if ("chronicle" in e) return "";
  if ("triggerEvent" in e) return `Leads to: ${e.triggerEvent.replace(/_/g, " ")}`;
  return "?";
}

void fromYmd;
