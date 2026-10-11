# Specific Characters (2026-09-15, renovated 2026-09-16)

Two preset groups sit right after the Breakpoint group: **Specific Characters — Marvel Rivals** (Psylocke, Loki, White Fox, The Punisher, Hela) and **Specific Characters — Overwatch 2** (Soldier: 76, Emre, Illari, Freja). Every card is 57 px/mm with a classic RawAccel curve, and all nine were chosen by one rule in `AimForge --hero-lab <hero|all>` (`src/Core/HeroLab.cs`). Evidence: `evidence/ev-20260916-hero-<hero>.json` per hero, `evidence/ev-20260916-character-cards.json` for the set.

| Hero | id | cm/360 | curve shape | snap | Y/X | game filter | in-game sens | re-acquire spread | click skid (mm) | RawAccel-engine gain noise (aim band, worst report) |
|---|---|---|---|---|---|---|---|---|---|---|
| Psylocke | `rivpsy` | 34 | 1:1 to 150 mm/s, cap 4.0 by 210 mm/s | 9 | 0.85 | none (T0) | **1.06** | 16.4% | 0.323 | 17.1%, 70% → Cadence Lock |
| Loki | `rivloki` | 37.7 | 1:1 to 60 mm/s, cap 3.0 by 120 mm/s | 9 | 0.85 | none (T0) | **0.96** | 6.9% | 0.323 | 5.3%, 22% → Cadence Lock |
| White Fox | `rivwfox` | 34 | 1:1 to 9 mm/s, cap 3.0 by 200 mm/s | 9 | 0.85 | none (T0) | **1.06** | 6.1% | 0.376 | 3.2%, 8% |
| The Punisher | `rivpun` | 37.7 | 1:1 to 9 mm/s, cap 3.0 by 150 mm/s | 5 | 0.85 | none (T0) | **0.96** | 3.9% | 0.398 | 2.6%, 8% |
| Hela | `rivhela` | 37.7 | 1:1 to 9 mm/s, cap 3.0 by 200 mm/s | 9 | 0.85 | none (T0) | **0.96** | 9.5% | 0.376 | 3.2%, 8% |
| Soldier: 76 | `owsol` | 37.7 | 1:1 to 100 mm/s, cap 3.0 by 160 mm/s | 5 | 0.789 | none (T0) | **2.54** | 11.5% | 0.323 | 8.4%, 37% → Cadence Lock |
| Emre | `owemre` | 37.7 | 1:1 to 9 mm/s, cap 3.0 by 200 mm/s | 9 | 0.789 | OW2 Master ON | **2.54** | 9.5% | 0.380 | 3.2%, 8% |
| Illari | `owillari` | 37.7 | 1:1 to 9 mm/s, cap 3.0 by 200 mm/s | 9 | 0.789 | none (T0) | **2.54** | 6.2% | 0.376 | 3.2%, 8% |
| Freja | `owfreja` | 34 | 1:1 to 60 mm/s, cap 3.0 by 120 mm/s | 9 | 0.789 | none (T0) | **2.81** | 3.8% | 0.323 | 5.3%, 22% → Cadence Lock |

Set the sens on each hero's own sensitivity setting (Rivals: hero-specific; OW2: per-hero). Zoomed sensitivity (OW2): Freja **62.50** (the 1:1 value at FOV 103, 16:9); Emre about **55** (community-measured; confirm by feel). The last column is the per-report gain noise the card's ramp makes from ±10% report-timing jitter on the RawAccel engine, measured across the whole aim band: a track peaking at ~236 mm/s, scored from 55 to 220 mm/s (`CadenceLab.RunAimBand`; `AimForge --noise` prints it). The BO6 base reads 2.9%, worst report 6.5%. When a card's noise is more than twice the base, or its worst report more than three times the base's worst, the card says to run it on the **Cadence Lock** engine, where the noise is 0. (The first column scored only 55–150 mm/s on a 141 mm/s stream, which never reached Psylocke's 150–210 mm/s ramp: she read 0.4%.)

## How a card is chosen
1. **Kit research** sets five fights per hero: weapon type (hitscan, or projectile speed for the lead), fire rhythm, recoil, ranges, the targets it fights (Rivals 6 m/s, flyers 12 m/s; OW2 5.5 m/s, Echo 8 m/s) and the big turn the kit forces (dash, teleport, swap, flanker).
2. **Simulation** — the human model (trained inverse feedforward, 120 ms visual feedback, signal-dependent motor noise + tremor), the shipping curve math at the pen's 360 Hz clock, RawAccel's exact angle snap, integer counts with remainder, and the game family's own shipped filter where it has one. Target switches are ballistic minimum-jerk throws (90 ms + 0.45 ms per degree; the big re-acquire at the hero's own tempo) with human tempo variability, then one corrective submovement; every clock of a switch is warped by that throw's tempo.
3. **Relative score** — each fight scored against the best legal curve in the same stage, the excess weighted by how often the fight happens.
4. **Legal** — onset ≤ two reports and micro 90–130% (through the variant's own filter); a 180 inside 70 mm at a 150 ms throw; no report of any fight, the throw included, above 600 mm/s of pen speed; tap-fire heroes: click skid no worse than the field-rated BO6 base + 15%.
5. **Phase 2** — the best curves × angle snap {0, 3, 5, 9} × the family's game filter (OW2 only; the Rivals Master is retired).
6. **Robustness** — rescored under four other simulated hands; among curves within 5% of the most robust, the most consistent re-acquire wins.

**What the lab does not decide.** Y/X is each game family's field value (Rivals 0.85, OW2 0.789): the model has no vertical-reach cost, so a Y/X search always picks its lowest option. cm/360 is capped at the field-tested 37.7 for the same reason (no cost for longer motions) - the lab may only go faster, and for Psylocke, White Fox and Freja it did. With a 180 inside 70 mm, 3x is the smallest cap that is legal at 37.7 (188.5 mm / 70 mm = 2.69x).

## What changed on 2026-09-16
The full audit found the lab's 600 mm/s gate never read the ballistic throw, legality was certified from the unfiltered curve for every filter variant, the switch clocks ignored the throw's tempo, Y/X was a search artifact, click skid was unmodelled, and Psylocke had been chosen by the retired tracking-only rule. All fixed; every card re-derived:
- **Psylocke** re-derived under the full lab: the old card needed 857 mm/s of hand speed for her own 135°/150 ms dash re-acquire.
- **Hela, Illari, Emre**: the caps moved from 80–110 mm/s to 200 mm/s — the earlier picks broke the click-skid limit. Hela's snap is now 9 (was 5).
- **White Fox**: base 34 cm/360 (sens 1.06), and her ramp now reaches its cap by 200 mm/s (was 150).
- **Freja**: base 34 cm/360 (sens 2.81).
- **Loki, Punisher, Soldier: 76**: same curve shapes.
- **Every OW2 character** (Soldier: 76, Emre, Illari, Freja) now carries OW2's field Y/X 0.789 (was 0.85; Freja 0.90).
- **Final review (same day):** the RawAccel-engine noise column was re-measured across the aim band; Psylocke (17.1%, worst report 70%) now carries the Cadence Lock advice alongside Loki, Soldier: 76 and Freja.

## Limits
Execution error only; reaction time, prediction and netcode are identical for every curve. The Coherence Stabilizer is not simulated. The ranking is a simulation - your field verdict decides, as always.

## Sources
- https://aimbench.com/games/marvel-rivals
- https://aimbench.com/games/overwatch-2
- https://marvelrivals.gg/white-fox/
- https://marvelrivals.wiki.fextralife.com/Adjudication
- https://marvelrivals.wiki.fextralife.com/Deliverance
- https://marvelrivals.wiki.fextralife.com/Mystical_Missile
- https://marvelrivals.wiki.fextralife.com/Nightsword+Thorn
- https://marvelrivals.wiki.fextralife.com/Psi-Blade+Dash
- https://marvelrivals.wiki.fextralife.com/Psionic_Crossbow
- https://mobalytics.gg/marvel-rivals/loki-guide
- https://mobalytics.gg/marvel-rivals/psylocke-guide
- https://overwatch.fandom.com/wiki/October_1,_2020_Patch
- https://overwatch.weirdgloop.org/w/Emre
- https://overwatch.weirdgloop.org/w/Freja
- https://overwatch.weirdgloop.org/w/Illari
- https://overwatch.weirdgloop.org/w/Soldier:_76
- https://rivals-compendium.com/abilities/hela
- https://rivals-compendium.com/abilities/loki
- https://rivals-compendium.com/abilities/the-punisher
- https://rivals-compendium.com/abilities/white-fox
- https://us.forums.blizzard.com/en/overwatch/t/emre-relative-aim-sensitivity/1000383
- https://x.com/Renanthera/status/1903563534036029807
