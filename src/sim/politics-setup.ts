// Seeds 1936 politics: government types, historical leaders for the majors, procedural cabinets,
// IG leaders, the candidate pool, initial ideology, and IG approval (set to target, no smoothing).
import { Rng } from "./rng";
import { Role, addCharacter, findRole, generateCharacter, syncCharacterModifiers, traitIndex, CABINET_SLOTS, HIGH_COMMAND_SLOTS } from "./characters";
import { IDEOLOGIES, type GovernmentsFile, type StartCharactersFile } from "./schemas";
import { N_IGS, igIndex, igRow } from "./igs";
import { approvalParts, computeClout } from "./systems/igs";
import { GOV_AUTOCRACY, GOV_DEMOCRACY, runIdeologyDrift, runPolitics } from "./systems/politics";
import { fromYmd } from "./date";
import type { World } from "./world";
import type { z } from "zod";

export interface PoliticsStart { governments: z.infer<typeof GovernmentsFile>; characters: z.infer<typeof StartCharactersFile> }

export function seedPolitics(w: World, start: PoliticsStart): void {
  const rng = new Rng(w.rng);
  const cc = w.countries.cols;
  for (let k = 0; k < w.countries.size; k++) {
    const tag = w.countryTags[k]!;
    const gov = start.governments[tag] ?? start.governments._default!;
    cc.government![k] = gov.type === "democracy" ? GOV_DEMOCRACY : GOV_AUTOCRACY;
    cc.nextElection![k] = gov.type === "democracy" ? (1936 + rng.int(0, 3)) * 100 + (gov.electionMonth ?? 11) : 0;
    if (tag === "USA") cc.nextElection![k] = 193611;
    cc.lastCoup![k] = -100000; cc.heir![k] = -1;
    const slots = { cabinet: 0, high: 0 };
    for (const h of start.characters[tag] ?? []) {
      const role = h.role === "head" ? Role.Head : h.role === "cabinet" ? Role.Cabinet : Role.HighCommand;
      const slot = role === Role.Cabinet ? slots.cabinet++ : role === Role.HighCommand ? slots.high++ : -1;
      const i = addCharacter(w, {
        name: h.name, country: k, role, slot, born: fromYmd(h.born, 6, 1) - 0, adm: h.adm, dip: h.dip, mil: h.mil,
        traits: h.traits.map(traitIndex).filter((t) => t >= 0), ideology: IDEOLOGIES.indexOf(h.ideology), ig: igIndex(h.ig),
      }, rng);
      if (role === Role.Head) cc.head![k] = i;
    }
    if (findRole(w, k, Role.Head) < 0) cc.head![k] = generateCharacter(w, k, Role.Head, rng, rng.int(0, N_IGS - 1), "leader");
    for (let s = 0; s < CABINET_SLOTS.length; s++) if (findRole(w, k, Role.Cabinet, s) < 0) { const i = generateCharacter(w, k, Role.Cabinet, rng, rng.int(0, N_IGS - 1)); w.characters.cols.slot![i] = s; }
    for (let s = 0; s < HIGH_COMMAND_SLOTS.length; s++) if (findRole(w, k, Role.HighCommand, s) < 0) { const i = generateCharacter(w, k, Role.HighCommand, rng, igIndex("armed_forces"), "general"); w.characters.cols.slot![i] = s; }
  }
  w.rng = rng.state;
  runPolitics(w); // IG leaders + pool (no deaths matter at day 0 beyond chance; deterministic)
  // Initial ideology: a few drift passes from the 1936 IG make-up.
  computeClout(w);
  for (let n = 0; n < 4; n++) runIdeologyDrift(w);
  const m = computeClout(w);
  for (let k = 0; k < w.countries.size; k++) {
    for (let g = 0; g < N_IGS; g++) {
      const r = igRow(k, g);
      w.igs.cols.approval![r] = Math.max(-100, Math.min(100, approvalParts(w, k, g, m.memberSol[r]!).reduce((s, x) => s + x.value, 0)));
    }
    syncCharacterModifiers(w, k);
  }
}
