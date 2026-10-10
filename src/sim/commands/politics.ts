// Political actions: privileges, appointments, heirs, academies, suppress / co-opt IGs.
import { registerCommand, type Validation } from "../commands";
import { CABINET_SLOTS, HIGH_COMMAND_SLOTS, ROLE_NAMES, Role, TRAITS, findRole, syncCharacterModifiers } from "../characters";
import { IGS, N_IGS, hasPrivilege, igRow, setPrivilege } from "../igs";
import { toYmd } from "../date";
import type { World } from "../world";
import { IDEA_COST, IDEAS, ideaBlocker, takeIdea } from "../techs";

const ok: Validation = { ok: true };
const no = (reason: string): Validation => ({ ok: false, reason });
const needPP = (w: World, c: number, n: number): Validation => w.countries.cols.pp![c]! >= n ? ok : no(`Requires ${n} political power (you have ${Math.floor(w.countries.cols.pp![c]!)})`);
const validIg = (ig: number) => Number.isInteger(ig) && ig >= 0 && ig < N_IGS;
export const GRANT_COST = 50, REVOKE_COST = 25, APPOINT_COST = 20, COOPT_COST = 60, HEIR_COST = 30, ACADEMY_COST = 120, ACADEMY_MAX = 5;
/** Suppression gets more expensive (and riskier) as the century goes on. */
export const suppressCost = (w: World) => Math.round(40 * (1 + (toYmd(w.date).year - 1936) / 30));

registerCommand<{ ig: number }>("grant_privilege", {
  validate({ actor, payload: { ig } }, w) {
    if (!validIg(ig)) return no("Unknown interest group");
    if (hasPrivilege(w, actor, ig)) return no("Already granted");
    return needPP(w, actor, GRANT_COST);
  },
  apply({ actor, payload: { ig } }, w) { w.countries.cols.pp![actor]! -= GRANT_COST; setPrivilege(w, actor, ig, true); return [{ type: "privilege_granted" }]; },
  preview({ payload: { ig } }) {
    const p = IGS[ig]!.privileges[0]!;
    return [`Costs ${GRANT_COST} PP`, `${p.name}: ${p.description}`, `${IGS[ig]!.name} approval +30; every other IG −4`, ...p.modifiers.map((m) => `${m.target.replace(/_/g, " ")} ${m.add !== undefined ? (m.add > 0 ? "+" : "") + m.add : ""}${m.mult !== undefined ? `${m.mult > 0 ? "+" : ""}${Math.round(m.mult * 100)}%` : ""}`)];
  },
});

registerCommand<{ ig: number }>("revoke_privilege", {
  validate({ actor, payload: { ig } }, w) {
    if (!validIg(ig) || !hasPrivilege(w, actor, ig)) return no("Not granted");
    return needPP(w, actor, REVOKE_COST);
  },
  apply({ actor, payload: { ig } }, w) {
    w.countries.cols.pp![actor]! -= REVOKE_COST; setPrivilege(w, actor, ig, false);
    w.igs.cols.favour![igRow(actor, ig)]! -= 25;
    return [{ type: "privilege_revoked" }];
  },
  preview({ payload: { ig } }) { return [`Costs ${REVOKE_COST} PP`, `${IGS[ig]!.name}: approval −30 (privilege) and −25 (resentment, fading)`]; },
});

registerCommand<{ character: number; role: number; slot: number }>("appoint", {
  validate({ actor, payload: { character, role, slot } }, w) {
    const c = w.characters.cols;
    if (!(character >= 0 && character < w.characters.size) || !c.alive![character] || c.country![character] !== actor) return no("Not one of your people");
    if (role !== Role.Cabinet && role !== Role.HighCommand) return no("Can only appoint ministers or high command");
    const slots = role === Role.Cabinet ? CABINET_SLOTS.length : HIGH_COMMAND_SLOTS.length;
    if (!(slot >= 0 && slot < slots)) return no("No such seat");
    if (c.role![character] !== Role.Pool && c.role![character] !== Role.IgLeader) return no(`Already serving as ${ROLE_NAMES[c.role![character]!]}`);
    return needPP(w, actor, APPOINT_COST);
  },
  apply({ actor, payload: { character, role, slot } }, w) {
    const c = w.characters.cols;
    w.countries.cols.pp![actor]! -= APPOINT_COST;
    const prev = findRole(w, actor, role, slot);
    if (prev >= 0) { c.role![prev] = Role.Pool; c.slot![prev] = -1; }
    c.role![character] = role; c.slot![character] = slot;
    syncCharacterModifiers(w, actor);
    return [{ type: "appointed" }];
  },
  preview({ actor, payload: { character, role, slot } }, w) {
    const c = w.characters.cols, seat = role === Role.Cabinet ? CABINET_SLOTS[slot] : HIGH_COMMAND_SLOTS[slot];
    const traits = ["trait0", "trait1", "trait2"].map((k) => c[k]![character]!).filter((t) => t >= 0).map((t) => TRAITS[t]!.name);
    const prev = findRole(w, actor, role, slot);
    return [`Costs ${APPOINT_COST} PP`, `${w.characterNames[character]} → ${seat}`,
      role === Role.Cabinet ? `Adds ADM ${(c.adm![character]! / 4).toFixed(2)} / DIP ${(c.dip![character]! / 4).toFixed(2)} / MIL ${(c.mil![character]! / 4).toFixed(2)} per month` : `Adds MIL ${(c.mil![character]! / 3).toFixed(2)} per month`,
      traits.length ? `Traits: ${traits.join(", ")}` : "No traits",
      c.ig![character]! >= 0 ? `${IGS[c.ig![character]!]!.name} feel represented (approval +12)` : "",
      prev >= 0 ? `Replaces ${w.characterNames[prev]}` : "Fills an empty seat"].filter(Boolean);
  },
});

registerCommand<{ character: number }>("designate_heir", {
  validate({ actor, payload: { character } }, w) {
    const c = w.characters.cols;
    if (!(character >= 0 && character < w.characters.size) || !c.alive![character] || c.country![character] !== actor) return no("Not one of your people");
    if (c.role![character] === Role.Head) return no("Already in power");
    if (w.countries.cols.heir![actor] === character) return no("Already the heir");
    return needPP(w, actor, HEIR_COST);
  },
  apply({ actor, payload: { character } }, w) { w.countries.cols.pp![actor]! -= HEIR_COST; w.countries.cols.heir![actor] = character; return [{ type: "heir_designated" }]; },
  preview({ payload: { character } }, w) { return [`Costs ${HEIR_COST} PP`, `${w.characterNames[character]} will succeed the current leader`, "Educate the heir to raise their stats"]; },
});

const EDU = 60;
registerCommand<{ stat: number }>("educate_heir", {
  validate({ actor, payload: { stat } }, w) {
    const h = w.countries.cols.heir![actor]!, c = w.characters.cols;
    if (h < 0 || !c.alive![h]) return no("Designate an heir first");
    if (!(stat >= 0 && stat < 3)) return no("Unknown skill");
    const col = (["adm", "dip", "mil"] as const)[stat]!;
    if (c[col]![h]! >= 6) return no("Already at the maximum (6)");
    if (w.countries.cols[col]![actor]! < EDU) return no(`Requires ${EDU} ${col.toUpperCase()}`);
    return needPP(w, actor, 15);
  },
  apply({ actor, payload: { stat } }, w) {
    const col = (["adm", "dip", "mil"] as const)[stat]!;
    w.countries.cols[col]![actor]! -= EDU; w.countries.cols.pp![actor]! -= 15;
    w.characters.cols[col]![w.countries.cols.heir![actor]!]! += 1;
    return [{ type: "heir_educated" }];
  },
  preview({ payload: { stat } }) { return [`Costs ${EDU} ${["ADM", "DIP", "MIL"][stat]} + 15 PP`, `Heir ${["administration", "diplomacy", "military"][stat]} +1 (max 6)`, "Pays off when they take power: the leader adds their stats to monthly points"]; },
});

registerCommand<Record<string, never>>("found_academy", {
  validate({ actor }, w) {
    if (w.countries.cols.academy![actor]! >= ACADEMY_MAX) return no("Academies are at their maximum");
    return needPP(w, actor, ACADEMY_COST);
  },
  apply({ actor }, w) { w.countries.cols.pp![actor]! -= ACADEMY_COST; w.countries.cols.academy![actor]! += 1; return [{ type: "academy_founded" }]; },
  preview({ actor }, w) { return [`Costs ${ACADEMY_COST} PP`, `Leadership academy ${w.countries.cols.academy![actor]!} → ${w.countries.cols.academy![actor]! + 1}`, "Future ministers, generals and leaders are more often skilled (+10% chance of +1 per stat per level)"]; },
});

registerCommand<{ ig: number }>("suppress_ig", {
  validate({ actor, payload: { ig } }, w) {
    if (!validIg(ig)) return no("Unknown interest group");
    if (w.igs.cols.radicalism![igRow(actor, ig)]! < 10) return no("Not radical enough to bother");
    const cost = suppressCost(w);
    if (w.countries.cols.mil![actor]! < cost) return no(`Requires ${cost} MIL`);
    return needPP(w, actor, 20);
  },
  apply({ actor, payload: { ig } }, w) {
    const r = igRow(actor, ig);
    w.countries.cols.mil![actor]! -= suppressCost(w); w.countries.cols.pp![actor]! -= 20;
    w.igs.cols.radicalism![r] = Math.max(0, w.igs.cols.radicalism![r]! - 30);
    w.igs.cols.favour![r]! -= 30;
    w.countries.cols.stability![actor] = Math.max(-3, w.countries.cols.stability![actor]! - 0.15);
    return [{ type: "ig_suppressed" }];
  },
  preview({ payload: { ig } }, w) { return [`Costs ${suppressCost(w)} MIL + 20 PP (rises over the century)`, `${IGS[ig]!.name}: radicalism −30 now, approval −30 (fading) — anger returns if the cause remains`, "Stability −0.15"]; },
});

registerCommand<{ ig: number }>("co_opt_ig", {
  validate({ actor, payload: { ig } }, w) { return validIg(ig) ? needPP(w, actor, COOPT_COST) : no("Unknown interest group"); },
  apply({ actor, payload: { ig } }, w) {
    const r = igRow(actor, ig);
    w.countries.cols.pp![actor]! -= COOPT_COST;
    w.igs.cols.radicalism![r] = Math.max(0, w.igs.cols.radicalism![r]! - 15);
    w.igs.cols.favour![r]! += 20;
    return [{ type: "ig_coopted" }];
  },
  preview({ payload: { ig } }) { return [`Costs ${COOPT_COST} PP`, `${IGS[ig]!.name}: radicalism −15, approval +20 (fading over a year)`, "Buys time; fix the cause (laws, privileges, SoL) to keep them calm"]; },
});

registerCommand<{ group: number }>("take_idea", {
  validate({ actor, payload: { group } }, w) { const b = ideaBlocker(w, actor, group); return b ? no(b) : ok; },
  apply({ actor, payload: { group } }, w) { takeIdea(w, actor, group); return [{ type: "idea_taken" }]; },
  preview({ actor, payload: { group } }, w) {
    const grp = IDEAS.groups[group]!, n = w.ideas[actor]!.find((x) => x.g === group)?.n ?? 0, idea = grp.ideas[n];
    return idea ? [`Costs ${IDEA_COST} ${grp.kind.toUpperCase()}`, `${grp.name}: ${idea.name}`, ...idea.modifiers.map((m) => `${m.target.replace(/_/g, " ")} ${m.add !== undefined ? (m.add > 0 ? "+" : "") + m.add : ""}${m.mult !== undefined ? `${m.mult > 0 ? "+" : ""}${Math.round(m.mult * 100)}%` : ""}`)] : ["Group complete"];
  },
});
