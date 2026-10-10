// Diplomacy and war commands (player and AI share these).
import { registerCommand, type Validation } from "../commands";
import { addRel, allied, atWar, borders, casusBelli, enemies, guarantees, hasTrade, pair, rel, setAlliance, setTrade, truceWith, warBetween } from "../diplomacy";
import { declareWar, makePeace, termCost, type PeaceTerm } from "../systems/wars";
import { DIVISION, path, recruit } from "../systems/armies";
import { killSoldiers } from "../systems/combat";
import { demand } from "../systems/war-ai";
import { neighborsOf } from "../setup";
import { chronicle } from "../characters";
import type { World } from "../world";

const ok: Validation = { ok: true };
const no = (reason: string): Validation => ({ ok: false, reason });
const validC = (w: World, c: number) => Number.isInteger(c) && c >= 0 && c < w.countries.size && w.countries.cols.capital![c]! >= 0;
const needDip = (w: World, a: number, n: number): Validation => (w.countries.cols.dip![a]! >= n ? ok : no(`Requires ${n} DIP (you have ${Math.floor(w.countries.cols.dip![a]!)})`));
const tag = (w: World, c: number) => w.countryTags[c]!;

registerCommand<{ target: number }>("improve_relations", {
  validate({ actor, payload: { target } }, w) { if (!validC(w, target) || target === actor) return no("Pick another country"); if (rel(w, actor, target) >= 150) return no("Relations are already excellent"); return needDip(w, actor, 40); },
  apply({ actor, payload: { target } }, w) { w.countries.cols.dip![actor]! -= 40; addRel(w, actor, target, 30); return [{ type: "relations_improved" }]; },
  preview({ actor, payload: { target } }, w) { return ["Costs 40 DIP", `Relations with ${tag(w, target)} ${Math.round(rel(w, actor, target))} → ${Math.round(rel(w, actor, target) + 30)} (drift back toward their natural level over time)`]; },
});

registerCommand<{ target: number }>("propose_trade", {
  validate({ actor, payload: { target } }, w) { if (!validC(w, target) || target === actor) return no("Pick another country"); if (hasTrade(w, actor, target)) return no("Already trading"); if (rel(w, actor, target) < 0) return no(`They won't trade with you (relations ${Math.round(rel(w, actor, target))}, need 0+)`); if (warBetween(w, actor, target)) return no("At war"); return needDip(w, actor, 25); },
  apply({ actor, payload: { target } }, w) { w.countries.cols.dip![actor]! -= 25; setTrade(w, actor, target, true); return [{ type: "trade_agreement" }]; },
  preview({ payload: { target } }, w) { return ["Costs 25 DIP", `Trade agreement with ${tag(w, target)}: relations drift +20`, "Each partner adds a little to investment"]; },
});

registerCommand<{ target: number }>("propose_alliance", {
  validate({ actor, payload: { target } }, w) { if (!validC(w, target) || target === actor) return no("Pick another country"); if (allied(w, actor, target)) return no("Already allied"); if (rel(w, actor, target) < 60) return no(`Relations must be 60+ (now ${Math.round(rel(w, actor, target))})`); if (atWar(w, target) || atWar(w, actor)) return no("Not while either side is at war"); return needDip(w, actor, 60); },
  apply({ actor, payload: { target } }, w) { w.countries.cols.dip![actor]! -= 60; setAlliance(w, actor, target, true); chronicle(w, actor, "diplomacy", `${tag(w, actor)} and ${tag(w, target)} sign an alliance.`); return [{ type: "alliance" }]; },
  preview({ payload: { target } }, w) { return ["Costs 60 DIP", `Defensive alliance with ${tag(w, target)}: each joins the other's defensive wars`, "May drag you into their wars"]; },
});

registerCommand<{ target: number }>("break_alliance", {
  validate({ actor, payload: { target } }, w) { return w.diplo.cols.alliance![pair(w, actor, target)] ? ok : no("Not allied"); },
  apply({ actor, payload: { target } }, w) { setAlliance(w, actor, target, false); addRel(w, actor, target, -60); return [{ type: "alliance_broken" }]; },
  preview({ payload: { target } }, w) { return [`Ends the alliance with ${tag(w, target)}`, "Relations −60"]; },
});

registerCommand<{ target: number }>("guarantee", {
  validate({ actor, payload: { target } }, w) { if (!validC(w, target) || target === actor) return no("Pick another country"); if (guarantees(w, actor, target)) return no("Already guaranteed"); return needDip(w, actor, 50); },
  apply({ actor, payload: { target } }, w) { w.countries.cols.dip![actor]! -= 50; w.diplo.cols.guarantee![pair(w, actor, target)] = 1; addRel(w, actor, target, 40); return [{ type: "guarantee" }]; },
  preview({ payload: { target } }, w) { return ["Costs 50 DIP", `You will join any war declared on ${tag(w, target)}`, "Relations +40"]; },
});

registerCommand<{ province: number }>("fabricate_claim", {
  validate({ actor, payload: { province } }, w) {
    const o = w.provinces.cols.owner![province];
    if (o === undefined || o === actor) return no("Pick a foreign province");
    if (!neighborsOf(w, province).some((q) => w.provinces.cols.owner![q] === actor)) return no("Must border one of your provinces");
    if (w.claims[actor]!.includes(province)) return no("Already claimed");
    return needDip(w, actor, 80);
  },
  apply({ actor, payload: { province } }, w) { w.countries.cols.dip![actor]! -= 80; w.claims[actor]!.push(province); addRel(w, actor, w.provinces.cols.owner![province]!, -40); return [{ type: "claim_fabricated" }]; },
  preview({ payload: { province } }, w) { return ["Costs 80 DIP", `Claim on ${w.provinceNames[province]}: a casus belli against ${tag(w, w.provinces.cols.owner![province]!)}`, "Their relations −40; world tension rises"]; },
});

registerCommand<{ target: number }>("declare_war", {
  validate({ actor, payload: { target } }, w) {
    if (!validC(w, target) || target === actor) return no("Pick another country");
    if (warBetween(w, actor, target)) return no("Already at war");
    if (truceWith(w, actor, target)) return no("A truce is in force");
    if (allied(w, actor, target)) return no("Break the alliance first");
    if (!casusBelli(w, actor, target)) return no("No casus belli — fabricate a claim on one of their provinces");
    return ok;
  },
  apply({ actor, payload: { target } }, w) { declareWar(w, actor, target); return [{ type: "war_declared" }]; },
  preview({ actor, payload: { target } }, w) {
    const cb = casusBelli(w, actor, target);
    const def = [target]; for (let k = 0; k < w.countries.size; k++) if (k !== target && (allied(w, k, target) || guarantees(w, k, target) || w.countries.cols.overlord![target] === k)) def.push(k);
    return [`Casus belli: ${cb?.type ?? "none"}${cb ? ` (${w.provinceNames[cb.province]})` : ""}`, `Defenders: ${def.map((c) => tag(w, c)).join(", ")}`, "Relations with them −100; war exhaustion builds over time"];
  },
});

registerCommand<{ war: number; terms: PeaceTerm[] }>("offer_peace", {
  validate({ actor, payload: { war: id, terms } }, w) {
    const war = w.wars.find((x) => x.id === id && x.end < 0);
    if (!war) return no("No such war");
    const isA = war.attackers.includes(actor), isD = war.defenders.includes(actor);
    if (!isA && !isD) return no("You are not in this war");
    const enemy = isA ? war.defenders[0]! : war.attackers[0]!;
    if (terms.length === 1 && terms[0]!.type === "white_peace") {
      return Math.abs(war.score) < 15 || w.countries.cols.warExhaustion![enemy]! > 30 ? ok : no("They won't accept a white peace while winning");
    }
    const score = isA ? war.score : -war.score;
    const cost = terms.reduce((s, t) => s + termCost(w, enemy, t), 0);
    if (score < cost) return no(`Needs ${Math.ceil(cost)} war score (you have ${Math.floor(score)})`);
    return ok;
  },
  apply({ actor, payload: { war: id, terms } }, w) {
    const war = w.wars.find((x) => x.id === id)!;
    const enemy = war.attackers.includes(actor) ? war.defenders[0]! : war.attackers[0]!;
    makePeace(w, war, actor, enemy, terms);
    return [{ type: "peace" }];
  },
  preview({ actor, payload: { war: id, terms } }, w) {
    const war = w.wars.find((x) => x.id === id);
    if (!war) return [];
    const enemy = war.attackers.includes(actor) ? war.defenders[0]! : war.attackers[0]!;
    return terms.map((t) => `${t.type === "annex" ? `Annex ${w.provinceNames[t.province]}` : t.type.replace(/_/g, " ")}: ${Math.ceil(termCost(w, enemy, t))} war score`).concat(["Sets a revenge memory for the loser; 5-year truce"]);
  },
});

registerCommand<{ war: number }>("concede", {
  validate({ actor, payload: { war: id } }, w) { const war = w.wars.find((x) => x.id === id && x.end < 0); return war && (war.attackers.includes(actor) || war.defenders.includes(actor)) ? ok : no("No such war"); },
  apply({ actor, payload: { war: id } }, w) {
    const war = w.wars.find((x) => x.id === id)!;
    const isA = war.attackers.includes(actor), enemy = isA ? war.defenders[0]! : war.attackers[0]!;
    makePeace(w, war, enemy, actor, demand(w, war, enemy, actor, Math.max(10, isA ? -war.score : war.score)));
    return [{ type: "conceded" }];
  },
  preview() { return ["Accept the enemy's terms (what their war score buys)", "Ends your part in the war"]; },
});

registerCommand<{ province: number; divisions: number }>("recruit", {
  validate({ actor, payload: { province, divisions } }, w) {
    if (w.provinces.cols.owner![province] !== actor) return no("Recruit in your own provinces");
    if (!(divisions >= 1 && divisions <= 50)) return no("1–50 divisions");
    const cost = divisions * RECRUIT_COST;
    if (w.countries.cols.treasury![actor]! < cost) return no(`Requires $${Math.round(cost / 1e8) / 10}M in the treasury`);
    let fielded = 0;
    for (let i = 0; i < w.armies.size; i++) if (w.armies.cols.alive![i] && w.armies.cols.country![i] === actor) fielded += w.armies.cols.strength![i]!;
    if (w.countries.cols.manpower![actor]! - fielded < DIVISION / 2) return no("No manpower left — raise mobilisation (F1 laws)");
    return ok;
  },
  apply({ actor, payload: { province, divisions } }, w) {
    // Recruitment cost is spent on arms from the market by the budget system over time; here it is a one-off outlay to the treasury's arms stock.
    const id = recruit(w, actor, province, divisions);
    return [{ type: id >= 0 ? "recruited" : "recruit_failed" }];
  },
  preview({ payload: { divisions } }) { return [`${divisions} divisions (${(divisions * DIVISION).toLocaleString("en-US")} men) from workers and peasants`, "Soldiers draw state pay and need arms each month (equipment level)", "Fewer workers for the economy"]; },
});
export const RECRUIT_COST = 0;

registerCommand<{ army: number }>("disband", {
  validate({ actor, payload: { army } }, w) { return w.armies.cols.alive![army] && w.armies.cols.country![army] === actor ? ok : no("Not your army"); },
  apply({ payload: { army } }, w) { w.armies.cols.alive![army] = 0; return [{ type: "disbanded" }]; },
  preview() { return ["The soldiers return home (they stay in the military stratum until mobilisation changes)"]; },
});

registerCommand<{ army: number; province: number }>("move_army", {
  validate({ actor, payload: { army, province } }, w) {
    if (!w.armies.cols.alive![army] || w.armies.cols.country![army] !== actor) return no("Not your army");
    if (w.armies.cols.battle![army]! >= 0) return no("In battle");
    if (!path(w, actor, w.armies.cols.prov![army]!, province).length && w.armies.cols.prov![army] !== province) return no("No land route (need access through allies or enemies)");
    return ok;
  },
  apply({ payload: { army, province } }, w) { const a = w.armies.cols; a.target![army] = province; a.next![army] = -1; a.auto![army] = 0; return [{ type: "army_moved" }]; },
  preview({ actor, payload: { army, province } }, w) { const r = path(w, actor, w.armies.cols.prov![army]!, province); return [`${r.length} provinces, about ${r.length * 8}–${r.length * 16} days`, "Manual orders turn off auto-command for this army"]; },
});

registerCommand<{ army: number; auto: boolean }>("set_army_auto", {
  validate({ actor, payload: { army } }, w) { return w.armies.cols.alive![army] && w.armies.cols.country![army] === actor ? ok : no("Not your army"); },
  apply({ payload: { army, auto } }, w) { w.armies.cols.auto![army] = auto ? 1 : 0; w.armies.cols.target![army] = -1; return [{ type: "army_auto" }]; },
  preview({ payload: { auto } }) { return [auto ? "Auto-command: attacks the nearest weakly held enemy province, liberates your occupied land, avoids hopeless fights" : "Manual control"]; },
});

export const NUKE_COST_MONTHS = 1;
registerCommand<Record<string, never>>("build_nuke", {
  validate({ actor }, w) { if (!("nuclear_weapons" in w.countryFlags[actor]!)) return no("Requires the Nuclear Weapons technology"); return w.countries.cols.treasury![actor]! > (w.countries.cols.gdpYear![actor]! / 12) * 0.1 ? ok : no("Requires a month of 10% of GDP in the treasury"); },
  apply({ actor }, w) { w.countries.cols.nukes![actor]! += 1; w.flags[`nuclear_power_${tag(w, actor)}`] = w.date; return [{ type: "nuke_built" }]; },
  preview() { return ["Adds a warhead to your stockpile", "Deterrence: AI will not start wars against nuclear powers"]; },
});

registerCommand<{ province: number }>("launch_nuke", {
  validate({ actor, payload: { province } }, w) {
    if (w.countries.cols.nukes![actor]! < 1) return no("No warheads");
    const o = w.provinces.cols.owner![province];
    if (o === undefined || !enemies(w, actor).includes(o)) return no("Target must belong to an enemy at war with you");
    return ok;
  },
  apply({ actor, payload: { province } }, w) {
    const pc = w.provinces.cols, p = w.pops.cols, owner = pc.owner![province]!;
    w.countries.cols.nukes![actor]! -= 1;
    for (let i = 0; i < w.pops.size; i++) if (p.prov![i] === province) for (const k of ["a0", "a1", "a2"]) { const d = p[k]![i]! * 0.15; p[k]![i]! -= d; w.ledger.died += d; }
    for (let i = 0; i < w.armies.size; i++) if (w.armies.cols.alive![i] && w.armies.cols.prov![i] === province) { killSoldiers(w, w.armies.cols.country![i]!, w.armies.cols.strength![i]! * 0.6); w.armies.cols.strength![i]! *= 0.4; w.armies.cols.org![i] = 0; }
    pc.unrest![province] = 10; pc.development![province] = Math.max(1, pc.development![province]! * 0.6);
    for (let k = 0; k < w.countries.size; k++) if (k !== actor) addRel(w, actor, k, -100);
    w.countries.cols.stability![actor] = Math.max(-3, w.countries.cols.stability![actor]! - 2);
    w.flags.nuclear_war = w.date;
    chronicle(w, actor, "nuke", `${tag(w, actor)} detonates a nuclear weapon over ${w.provinceNames[province]} (${tag(w, owner)}).`);
    return [{ type: "nuke_launched" }];
  },
  preview({ payload: { province } }, w) { return [`Kills ~15% of ${w.provinceNames[province]}'s people and 60% of armies there`, "Development −40%, unrest 10", "Every nation's opinion of you −100; your stability −2", "The world will remember (flag: nuclear war)"]; },
});
void borders;
