// Politics (monthly): character ageing/death/succession, cabinet refills, elections (democracies),
// coups (angry Armed Forces), and yearly ideology drift. Uses the world RNG (sfc32) — deterministic per seed.
import { Rng } from "../rng";
import { CABINET_SLOTS, HIGH_COMMAND_SLOTS, POOL_SIZE, ROLE_NAMES, Role, annualMortality, ageOf, charactersOf, chronicle, findRole, generateCharacter, kill, syncCharacterModifiers } from "../characters";
import { IGS, IG_IDEOLOGY, IG_STRATA, N_IGS, igIndex, igRow } from "../igs";
import { toYmd } from "../date";
import { popSize } from "../pops";
import type { World } from "../world";

export const ELECTION_YEARS = 4, COUP_RADICALISM = 60, COUP_CLOUT = 0.1, COUP_COOLDOWN_DAYS = 5 * 365;
import { AUTO_ADVISORS } from "../setup";
export const GOV_DEMOCRACY = 0, GOV_AUTOCRACY = 1;
const AF = igIndex("armed_forces");

export function runPolitics(w: World): void {
  const rng = new Rng(w.rng);
  const c = w.characters.cols, nC = w.countries.size;
  const dirty = new Set<number>();
  // Deaths and retirements.
  for (let i = 0; i < w.characters.size; i++) {
    if (!c.alive![i]) continue;
    if (rng.chance(annualMortality(w, i) / 12)) { kill(w, i, "died"); dirty.add(c.country![i]!); continue; }
    if (c.role![i] === Role.Cabinet && ageOf(w, i) > 74 && rng.chance(0.1 / 12)) { c.role![i] = Role.Retired; dirty.add(c.country![i]!); }
  }
  for (let k = 0; k < nC; k++) {
    if (findRole(w, k, Role.Head) < 0) { succeed(w, k, rng); dirty.add(k); }
    if (fillVacancies(w, k, rng)) dirty.add(k);
  }
  const { year, month } = toYmd(w.date);
  for (let k = 0; k < nC; k++) {
    const cc = w.countries.cols;
    if (cc.government![k] === GOV_DEMOCRACY && month === electionMonth(w, k) && year >= Math.floor(cc.nextElection![k]! / 100)) { election(w, k, rng); dirty.add(k); }
    const r = igRow(k, AF);
    const rad = w.igs.cols.radicalism![r]!, clout = w.igs.cols.clout![r]!;
    const threshold = cc.government![k] === GOV_DEMOCRACY ? COUP_RADICALISM + 15 : COUP_RADICALISM;
    if (rad > threshold && clout > COUP_CLOUT && w.date - cc.lastCoup![k]! > COUP_COOLDOWN_DAYS && rng.chance((0.04 * (rad - threshold)) / 40)) { coup(w, k, rng); dirty.add(k); }
  }
  for (const k of dirty) syncCharacterModifiers(w, k);
  w.rng = rng.state;
}

const electionMonth = (w: World, k: number) => (w.countries.cols.nextElection![k]! % 100) || 11;

function succeed(w: World, k: number, rng: Rng): void {
  const cc = w.countries.cols, c = w.characters.cols;
  let next = cc.heir![k]!;
  if (next < 0 || !c.alive![next] || c.country![next] !== k) {
    const ministers = charactersOf(w, k, Role.Cabinet);
    next = ministers.sort((a, b) => (c.adm![b]! + c.dip![b]!) - (c.adm![a]! + c.dip![a]!))[0] ?? -1;
  }
  if (next < 0) next = generateCharacter(w, k, Role.Head, rng, -1, "leader");
  c.role![next] = Role.Head; c.slot![next] = -1;
  cc.head![k] = next; cc.heir![k] = -1;
  chronicle(w, k, "succession", `${w.characterNames[next]} becomes Head of Government.`);
}

/** Refill empty cabinet/high-command seats from the pool (AI, or players with auto-advisors), top up the pool and IG leaders. */
function fillVacancies(w: World, k: number, rng: Rng): boolean {
  let changed = false;
  const c = w.characters.cols, auto = (w.countries.cols.automation![k]! & AUTO_ADVISORS) !== 0;
  for (let g = 0; g < N_IGS; g++) {
    if (!charactersOf(w, k, Role.IgLeader).some((i) => c.ig![i] === g)) generateCharacter(w, k, Role.IgLeader, rng, g, "leader");
  }
  const pool = () => charactersOf(w, k, Role.Pool);
  while (pool().length < POOL_SIZE) generateCharacter(w, k, Role.Pool, rng, rng.int(0, N_IGS - 1), rng.chance(0.4) ? "general" : "minister");
  if (!auto) return changed;
  for (const [role, slots] of [[Role.Cabinet, CABINET_SLOTS.length], [Role.HighCommand, HIGH_COMMAND_SLOTS.length]] as const) {
    for (let s = 0; s < slots; s++) {
      if (findRole(w, k, role, s) >= 0) continue;
      const stat = role === Role.HighCommand ? "mil" : "adm";
      const best = pool().sort((a, b) => c[stat]![b]! - c[stat]![a]!)[0]!;
      c.role![best] = role; c.slot![best] = s; changed = true;
    }
  }
  return changed;
}

/** Elections: IG clout × approval × match with the population's ideology; the winner's leader governs. */
export function electionScores(w: World, k: number): number[] {
  const ic = w.igs.cols, cc = w.countries.cols;
  const ideo = [cc.ideoDem![k]!, cc.ideoFas![k]!, cc.ideoCom![k]!, cc.ideoNon![k]!];
  return IGS.map((_, g) => {
    const r = igRow(k, g);
    return ic.clout![r]! * (1 + ic.approval![r]! / 200) * (0.5 + 2 * ideo[IG_IDEOLOGY[g]!]!) * (1 + 0.5 * (1 - ic.radicalism![r]! / 100));
  });
}

function election(w: World, k: number, rng: Rng): void {
  const cc = w.countries.cols, c = w.characters.cols;
  const scores = electionScores(w, k), total = scores.reduce((a, b) => a + b, 0) || 1;
  const head = findRole(w, k, Role.Head);
  if (head >= 0 && c.ig![head]! >= 0) scores[c.ig![head]!]! *= 1.15; // incumbency
  let win = 0;
  scores.forEach((s, g) => { if (s > scores[win]!) win = g; });
  cc.nextElection![k] = (toYmd(w.date).year + ELECTION_YEARS) * 100 + electionMonth(w, k);
  const share = (100 * scores[win]!) / total;
  if (head >= 0 && c.ig![head] === win) { chronicle(w, k, "election", `${IGS[win]!.name} hold power with ${share.toFixed(0)}% — ${w.characterNames[head]} re-elected.`); return; }
  let leader = charactersOf(w, k, Role.IgLeader).find((i) => c.ig![i] === win) ?? generateCharacter(w, k, Role.IgLeader, rng, win, "leader");
  if (head >= 0) c.role![head] = Role.Retired;
  c.role![leader] = Role.Head; cc.head![k] = leader;
  chronicle(w, k, "election", `Election: ${IGS[win]!.name} win with ${share.toFixed(0)}%. ${w.characterNames[leader]} forms a government.`);
}

function coup(w: World, k: number, rng: Rng): void {
  const cc = w.countries.cols, c = w.characters.cols;
  const head = findRole(w, k, Role.Head);
  const plotter = findRole(w, k, Role.HighCommand, 0) >= 0 ? findRole(w, k, Role.HighCommand, 0) : generateCharacter(w, k, Role.HighCommand, rng, AF, "general");
  if (head >= 0) { c.role![head] = Role.Retired; chronicle(w, k, "coup", `Coup! The Armed Forces depose ${w.characterNames[head]}. ${w.characterNames[plotter]} seizes power.`); }
  c.role![plotter] = Role.Head; c.ig![plotter] = AF; c.slot![plotter] = -1; cc.head![k] = plotter;
  cc.government![k] = GOV_AUTOCRACY; cc.lastCoup![k] = w.date;
  cc.stability![k] = Math.max(-3, cc.stability![k]! - 1);
  const r = igRow(k, AF);
  w.igs.cols.radicalism![r] = 10; w.igs.cols.favour![r] = 40;
}

/**
 * Yearly ideology drift: pops lean toward the ideology of the IGs they back, more so when those IGs
 * are radical; misery pushes the ideology of radical IGs harder. Country shares are refreshed.
 */
export function runIdeologyDrift(w: World): void {
  const p = w.pops.cols, ic = w.igs.cols, nC = w.countries.size;
  const keys = ["ideoDem", "ideoFas", "ideoCom", "ideoNon"] as const;
  const tot = new Float64Array(nC * 4), size = new Float64Array(nC);
  for (let i = 0; i < w.pops.size; i++) {
    const c = w.provinces.cols.owner![p.prov![i]!]!, st = p.stratum![i]!;
    const target = [0.05, 0.05, 0.05, 0.05];
    let sum = 0.2;
    for (let g = 0; g < N_IGS; g++) {
      const a = IG_STRATA[g]![st]!;
      if (!a) continue;
      const rad = ic.radicalism![igRow(c, g)]! / 100;
      const pull = a * (0.3 + rad * (1.5 - p.sol![i]! / 100));
      target[IG_IDEOLOGY[g]!]! += pull; sum += pull;
      // Contented members drift to the moderate centre (democracy/non-aligned).
      target[0]! += a * (1 - rad) * 0.2; sum += a * (1 - rad) * 0.2;
    }
    for (let k = 0; k < 4; k++) { const col = p[keys[k]!]!; col[i] = col[i]! + (target[k]! / sum - col[i]!) * 0.15; }
    const s = popSize(w, i);
    size[c]! += s;
    for (let k = 0; k < 4; k++) tot[c * 4 + k]! += p[keys[k]!]![i]! * s;
  }
  for (let c = 0; c < nC; c++) for (let k = 0; k < 4; k++) w.countries.cols[keys[k]!]![c] = size[c]! > 0 ? tot[c * 4 + k]! / size[c]! : 0.25;
}

export { ROLE_NAMES };
