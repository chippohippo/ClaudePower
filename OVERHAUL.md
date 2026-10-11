# OVERHAUL.md — the "next-generation control plane" pass (2026-08-28)

The overhaul brief arrived written partly against a **stale model of this repo** — its QC section
is a copy of the v1 README, predating three shipped sessions of measured work. Standing project
law (encoded in `RolePolicy.cs` and honored by every prior session prompt): **reproducible
measurements outrank remembered lore, and lore outranks generic theory.** This file maps current
vs target, lists risks, and records exactly what was enacted vs refused, with evidence.

## Current state (already shipped before this pass)

Architecture unchanged and intact: one WinForms window → `writer.exe` + `OpenTabletDriver.Console.exe`
→ untouched WHQL drivers. `presets.json` single source of truth, LUTs authored in mm/s, counts/ms
derived at apply. `src/Core` = pure math + bridges; `Measure.cs` = the harness-ported sim.

Already built (the brief asked for much of this as if new):
- Filter discovery catalog (19 registrations ∪ 16 plugin folders, explicit FolderMap, T0–T5 tiers)
- Role policy + latency law enforced at Apply, named exceptions carrying evidence ids
- Per-build declared filter plans, written and **read back field-by-field** from both drivers
- Apply transactions with backup restore; doctor v2 (chain, conflicts, signatures, lockout)
- First-party plugins: Coherence Stabilizer (Tap Anchor = the tap-jiggle suppressor; Lead Sight =
  gated prediction) and AimForge Game Filters (stop brake = Finals decel brake; tracking helper =
  TrackGlue with the anti-trail law; soft heading assist = the CoD/OW rails, off by default
  everywhere except the game's own strict cards; kernel deadzone = sustained-coherence-gated)
- A/B via Ctrl+Tab; measure-curve → evidence artifacts; contact-only hover toggle; reset chips
- 47-card roster: BO6 baseline family + per-game Master/Baseline/Planted/Turbo/Tapped/Wildcard

## Enacted in this pass

1. **Idle contract fix (real catch by the brief):** the session-2 HUD ran an always-on 100ms GUI
   timer. It now starts on window activation and stops on deactivate/minimize — idle is ~0% again.
2. **A/B compare in the window** (`compare A/B` button): selection vs last-applied, measured on
   the same rig — hold / micro / dead / skid / 180 / tier / QC verdict. Plus `--compare a b` CLI.
3. **`--qc` CLI:** every card's role, plan tier, verdict, and any named-exception warnings;
   exit code 0 when clean, 1 on any violation (the count is printed). Selftest pins the roster at zero violations.
4. **Build export/import JSON** (buttons): exports the *effective* build (preset + rig folded in)
   to a standalone file; import loads it as a transient custom build — QC runs, Ctrl+Enter
   applies, and `presets.json` is never silently mutated (the tuner stays the roster's write path).
5. **Hover hygiene fields:** `Hover_min` exposed (rig + filters panel), written and read back.
   Note: HDL's Pen/Eraser/NearProximity are report-TYPE filters, not hover dials (verified from
   the plugin README long ago) — the brief's "proximity cutoff" maps to Hover_min/Hover_max.
6. **cm/360 chips** for the FIELD tiers this project actually established: 27 / 34 / 37.7 / 42.
7. **Curve canvas QC band:** the <15 mm/s tremor band is now shaded on the graph.
8. **1728×1080 @540Hz** added to the monitor list.
9. **README.md rewritten** to the current era (the stale copy was the source of the brief's
   outdated rules). `AIMFORGE.md` carries the full project story.

## Refused, with evidence

- **Re-hardening "no accel below 55 mm/s" and "gain ≤1.00 at 37 mm/s" as apply refusals.**
  These were LUT-era rules, deliberately modernized on 2026-08-27: the user's own field-best
  baseline (BO6: accel from 8.8 mm/s, 1.17× at tap speed) violates both and is rated "the most
  stable I've had". Re-imposing them would refuse **every one of the 30 classic-family cards
  including the baseline itself.** What survives as hard law: RULE 1 (no shelves, 2-unit ≥0.80),
  no dips <15 mm/s, first anchor on the unit step, monotonic tremor band — all still enforced,
  all still selftest-pinned, plus the newer laws (role tiers, floor exceptions; continuity stays a
  design law, not a machine check — corrected 2026-09-16).
- **The brief's rig numbers** (PTH-860, px/mm 47–63, cm tiers 38/54/82): template values. The
  real rig is a DTC-141 at 57 px/mm; the real measured tiers are 27/34/37.7/42 and those are
  what the chips offer. Nothing was genericized.
- **"Default stack = Hover Limiter only":** the Masters ship HDL + Tap Anchor in exact-passthrough
  (bit-exact off the click, measured) + a T1 game personality. That default is measured and
  field-derived; stripping it to HDL-only would undo the musket fix among other things.
  *(Corrected 2026-09-16: the Baseline cards are BO6 verbatim + HDL + their game's T1 Master where
  one ships - not HDL-only. The HDL-only builds are the Baseline, Turbo and most Planted and Low-Latency
  cards of the Helldivers 2, Valorant, Apex and Rivals families (valpl adds the Valorant Lab filter; every
  Master, Tapped and wildcard card, plus rivllc/valllc/apxllb, also ships the Coherence Stabilizer),
  8 of the 9 character cards (owemre runs the OW2 Master) and the two references.)*
- **New 38/54/82 preset families:** would duplicate the roster with unmeasured template numbers.
  The rig panel + cm chips + export/import give the same flexibility without forking the roster.
- **Independent X/Y px/mm in OTD:** Y/X 0.789 in RawAccel already implements "damp Y without
  touching X"; doubling it in OTD would stack asymmetries. Refused as designed-in redundancy.
- **Natural/Power curve authoring:** deferred, not refused — the write-side fields exist in
  RawAccel's settings.json, but rendering/measuring them honestly requires implementing RawAccel's
  exact formulas, and a graph that guesses is a graph that lies. No shipped build uses them.

## Risk list

- The OTD plugin (AimForge.Filters) loads on daemon restart only; an apply before Ctrl+D skips
  game filters with a logged notice (by design, but easy to miss).
- getfilters read-back matches formatted values; a plugin changing its property print format
  would false-alarm (loud, not destructive).
- Import accepts any well-formed build JSON; QC + role policy still gate the apply, but an
  imported id colliding with a roster id relabels A/B history for that session.
- The HUD estimate is screen-side by necessity (the daemon exposes no report stream) — labelled.
