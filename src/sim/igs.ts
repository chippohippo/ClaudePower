// Interest group definitions, privileges, and law support (the support bar shown before enacting).
import igsJson from "../../data/igs.json";
import { IgsFile, STRATA, IDEOLOGIES } from "./schemas";
import { LAWS, activeLaw } from "./laws";
import { addModifier, removeModifiers } from "./modifiers";
import type { World } from "./world";

export const IGS = IgsFile.parse(igsJson);
export const N_IGS = IGS.length;
export const igIndex = (id: string) => IGS.findIndex((g) => g.id === id);
export const igRow = (country: number, ig: number) => country * N_IGS + ig;
export const IG_IDEOLOGY = IGS.map((g) => IDEOLOGIES.indexOf(g.ideology));
/** Attraction weight of each stratum to each IG: [ig][stratum]. */
export const IG_STRATA: number[][] = IGS.map((g) => STRATA.map((s) => g.strata[s] ?? 0));
export const IG_POWER = IGS.map((g) => g.power);

/** IG preference for a law (−2…+2; 0 if unstated). */
export const lawPref = (ig: number, lawId: string) => IGS[ig]!.prefs[lawId] ?? 0;

/** How much an IG likes the current laws: Σ preferences over active laws. */
export function lawScore(w: World, c: number, ig: number): number {
  let s = 0;
  LAWS.forEach((cat, k) => { s += lawPref(ig, cat.laws[activeLaw(w, c, k)]!.id); });
  return s;
}

/**
 * Clout-weighted support for switching a category to `law`: Σ clout × (pref(new) − pref(current)), −2…+2.
 * Positive means the powerful are for it.
 */
export function lawSupport(w: World, c: number, cat: number, law: number): { total: number; by: { ig: number; clout: number; delta: number }[] } {
  const cur = LAWS[cat]!.laws[activeLaw(w, c, cat)]!.id, next = LAWS[cat]!.laws[law]!.id;
  const by = IGS.map((_, g) => ({ ig: g, clout: w.igs.cols.clout![igRow(c, g)]!, delta: lawPref(g, next) - lawPref(g, cur) }));
  return { total: by.reduce((s, x) => s + x.clout * x.delta, 0), by };
}

export const hasPrivilege = (w: World, c: number, ig: number) => (w.igs.cols.privileges![igRow(c, ig)]! & 1) === 1;

export function setPrivilege(w: World, c: number, ig: number, on: boolean): void {
  const scope = `c:${c}`, source = `privilege:${IGS[ig]!.id}`;
  removeModifiers(w, scope, source);
  w.igs.cols.privileges![igRow(c, ig)] = on ? 1 : 0;
  if (on) for (const m of IGS[ig]!.privileges[0]!.modifiers) addModifier(w, { target: m.target, scope, source, ...(m.add !== undefined ? { add: m.add } : {}), ...(m.mult !== undefined ? { mult: m.mult } : {}) });
}
