# The game families (2026-10-23)

Every game card was re-derived by the **game lab** (`src/Core/GameLab.cs`, `--game-lab <game|all> [role]`). The lab reuses HeroLab's selection rule on each game's own fights. Evidence: `evidence/ev-20261023-game-<game>.json`, with every row in `evidence/ev-20261023-game-summary.txt`.

BO6 Original, the three Breakpoints, the nine character cards and the two references did not change.

## What changed and why

- **The old ladder is gone.** Every game used to carry the same nine cards: a LUT Master, BO6 verbatim, Planted, Turbo, Tapped, three Low-Latency Breakpoints and a Lab wildcard.
  - Most of those were the BO6 physics at a different in-game number, so they did not feel different from game to game.
  - The wildcards ran hold smoothing (T3) or Lead Sight (T5). Smoothing is the delayed feel the latency investigation chased.
- **Six roles per game, each tuned on that game's own fights.** Cards follow the pro range for that game, not BO6.
  - **Master:** the all-round daily card, at the median of the pro cm/360 range.
  - **Precision:** the slow end of the range, with a gentle ramp and the Tap Anchor pinning the click.
  - **Tracker:** a wide 1:1 band (offset up to ~8 mm/s) so slow tracking never wobbles, then a ramp.
  - **Flick:** a short, high cap for fast 180s, with 180° in 38–54 mm.
  - **Brawl:** the fast end of the range for close fights.
  - **Signature:** one card for the game's own special job, such as the Operator, the Longbow or the Projectile.
- **Latency first, on every card.**
  - Classic curves only, with the floor at exactly 1.00.
  - Onset in two reports (5.6 ms).
  - Micro-aim fidelity between 90 and 130%.
  - Latency tier T0 or T1, with no smoothing anywhere.
  - The only filter that can ship is the Tap Anchor, in exact passthrough (hold 0). It ships only on tap-fire roles: Precision everywhere, plus the Valorant and Holdfast Master, Flick and Signature.
  - A game filter is ON only where the lab measured it winning that role's fights: OW2 Projectile and the Finals Tracker, Flick and Brawl.
- **Selftests pin all of this**, together with the rule that no two cards in a game share a build and no two games share a Master.

## The cards

Values: cm/360, accel / offset / cap, the speed where the cap is reached (mm/s), angle snap, the measured 180, and the in-game sens at 57 px/mm.

| game | role | cm | accel / off / cap | cap at | snap | 180 mm | sens |
|---|---|---|---|---|---|---|---|
| Valorant | Master | 54 | 0.653 / 2.28 / 4.0 | 150 | 3 | 67.5 | 0.167 |
| | Precision | 62 | 1.218 / 2.28 / 3.5 | 100 | 5 | 88.6 | 0.146 |
| | Tracker | 54 | 2.485 / 6.27 / 4.0 | 170 | 5 | 67.5 | 0.167 |
| | Flick | 54 | 0.681 / 0.5 / 5.0 | 120 | 9 | 54.0 | 0.167 |
| | Brawl | 47 | 0.330 / 0.5 / 3.5 | 150 | 5 | 67.1 | 0.192 |
| | Operator | 62 | 0.565 / 0.5 / 4.0 | 110 | 9 | 77.5 | 0.146 |
| Apex | Master | 40 | 1.365 / 4.56 / 3.0 | 140 | 5 | 66.7 | 0.718 |
| | Precision | 43 | 1.267 / 3.99 / 3.0 | 130 | 5 | 71.7 | 0.668 |
| | Tracker | 40 | 1.657 / 6.27 / 3.0 | 170 | 5 | 66.7 | 0.718 |
| | Flick | 40 | 0.718 / 0.5 / 4.0 | 90 | 9 | 50.0 | 0.718 |
| | Brawl | 35 | 0.296 / 2.28 / 3.0 | 190 | 5 | 58.3 | 0.820 |
| | Longbow | 43 | 0.396 / 0.5 / 4.0 | 150 | 5 | 53.8 | 0.668 |
| Overwatch 2 | Master | 35 | 0.192 / 0.5 / 3.0 | 200 | 9 | 58.3 | 2.734 |
| | Precision | 41 | 0.975 / 2.28 / 3.0 | 100 | 9 | 68.3 | 2.334 |
| | Tracker | 35 | 1.657 / 6.27 / 3.0 | 170 | 3 | 58.3 | 2.734 |
| | Flick | 35 | 0.983 / 0.5 / 4.0 | 70 | 5 | 43.8 | 2.734 |
| | Brawl | 27 | 0.108 / 0.5 / 2.5 | 260 | 9 | 54.0 | 3.544 |
| | Projectile (OW2 Master filter ON) | 35 | 0.667 / 6.84 / 3.0 | 230 | 9 | 58.3 | 2.734 |
| Marvel Rivals | Master | 38 | 0.384 / 0.5 / 5.0 | 200 | 9 | 38.0 | 0.950 |
| | Precision | 45 | 1.044 / 3.99 / 5.0 | 180 | 9 | 45.0 | 0.802 |
| | Tracker | 38 | 1.450 / 7.98 / 5.0 | 250 | 9 | 38.0 | 0.950 |
| | Flick | 38 | 0.491 / 0.5 / 5.0 | 160 | 9 | 38.0 | 0.950 |
| | Brawl | 33 | 0.396 / 0.5 / 4.0 | 150 | 5 | 41.3 | 1.094 |
| | Skyward | 38 | 0.491 / 4.56 / 5.0 | 280 | 9 | 40.3 | 0.950 |
| The Finals | Master | 36 | 1.365 / 4.56 / 3.0 | 140 | 9 | 60.0 | 17.54 |
| | Precision | 39 | 1.267 / 3.99 / 3.0 | 130 | 9 | 65.0 | 16.19 |
| | Tracker (Finals filter ON) | 36 | 1.657 / 6.27 / 3.0 | 170 | 5 | 60.0 | 17.54 |
| | Flick (Finals filter ON) | 36 | 0.511 / 0.5 / 4.0 | 120 | 9 | 45.0 | 17.54 |
| | Brawl (Finals filter ON) | 32 | 0.343 / 3.99 / 3.0 | 220 | 9 | 53.3 | 19.74 |
| | Fieldwide | 78.95 | 0.792 / 0.5 / 7.0 | 150 | 9 | 56.4 | 8.00 |
| Deadlock | Master | 38 | 0.396 / 0.5 / 4.0 | 150 | 9 | 47.5 | 0.755 |
| | Precision | 45 | 0.544 / 2.28 / 3.5 | 150 | 9 | 64.3 | 0.638 |
| | Tracker | 38 | 2.485 / 6.27 / 4.0 | 170 | 9 | 47.5 | 0.755 |
| | Flick | 38 | 0.957 / 0.5 / 5.0 | 90 | 9 | 38.0 | 0.755 |
| | Brawl | 32 | 0.145 / 0.5 / 3.0 | 260 | 9 | 53.3 | 0.897 |
| | Zipline | 38 | 0.316 / 2.28 / 4.0 | 240 | 9 | 47.5 | 0.755 |
| Helldivers 2 | Master | 37.7 | 0.264 / 0.5 / 3.0 | 150 | 9 | 62.8 | 0.029 |
| | Precision | 42 | 0.731 / 2.28 / 2.5 | 100 | 5 | 84.0 | 0.026 |
| | Tracker | 37.7 | 1.657 / 6.27 / 3.0 | 170 | 9 | 62.8 | 0.029 |
| | Flick | 37.7 | 0.718 / 0.5 / 4.0 | 90 | 9 | 47.1 | 0.029 |
| | Brawl | 33 | 0.144 / 0.5 / 2.5 | 200 | 9 | 66.0 | 0.033 |
| | Heavy | 37.7 | 0.435 / 2.28 / 3.0 | 150 | 9 | 62.8 | 0.029 |
| Holdfast | Master | 40 | 0.377 / 0.5 / 3.0 | 110 | 9 | 66.7 | 0.099 |
| | Precision | 46 | 0.731 / 2.28 / 2.5 | 100 | 9 | 92.0 | 0.086 |
| | Tracker | 40 | 0.272 / 6.27 / 3.0 | 310 | 9 | 66.7 | 0.099 |
| | Flick | 40 | 0.983 / 0.5 / 4.0 | 70 | 9 | 50.0 | 0.099 |
| | Brawl | 34 | 0.283 / 0.5 / 2.5 | 110 | 9 | 68.0 | 0.116 |
| | Sabre | 46 | 0.377 / 0.5 / 3.0 | 110 | 9 | 76.7 | 0.086 |

Each card's own text in the window says the same things, generated from these measured values; the copy contract checks it.

## Pro ranges and sources

The ranges come from senslab and prosettings, plus the OTD and RawAccel communities and r/OsuTablet tablet-FPS threads. The table gives each game's pro cm/360 range and median.

| game | pro cm/360 (median) | source |
|---|---|---|
| Valorant | 47–71 (54) | prosettings, 701 pros, median eDPI 240; senslab, 605 pros |
| Apex | 35–43 (40) | senslab median eDPI 1040; prosettings player pages |
| Overwatch 2 | 27–41 (35) | senslab, 236 pros |
| Marvel Rivals | 33–47 (38) | senslab, 129 pros |
| The Finals | 32–39 (36) | senslab, 31 pros (small sample) |
| Deadlock | 32–50 (38) | senslab, 35 pros (assumes yaw 0.044; esportsmice disagrees) |
| Helldivers 2 | no pro scene | your 37.7 base, ±12% |
| Holdfast | no pro data | a 40 cm base for single slow shots, ±15% |

## Set these up in the game (AimForge never edits a game)

- **Apex:** RawAccel issue #304 reports EAC disabling RawAccel in game. If the curve vanishes in Apex, tick Cadence Lock; the curve then runs in OTD and RawAccel stays flat.
- **Deadlock:** the in-game number is unverified. AimForge assumes the Source yaw 0.022, but one stats site says 0.044, which would halve it. Run the 360 calibration once.
- **The Finals:** turn the game's mouse smoothing off (`bEnableMouseSmoothing=False`, with the game closed).
- **Helldivers 2:** keep the game's mouse smoothing off; the sens constant is estimated, so run the 360 calibration once.
- **Marvel Rivals:** the game's own acceleration and smoothing toggles must be off.
- **Valorant:** use the VMulti relative mode and touch the pen before the mouse. If taps vanish while strafing, add a keyboard Fire bind.

## Field verdicts pending

None of these cards has a field verdict yet. Theory and lab results rank below your hands. BO6 Original stays the fallback.

One lab note: the re-derived Rivals Master re-acquires Psylocke's 135° turn more consistently than the Psylocke card does (9% against 16% spread), even though the Psylocke card still scores better on her fights overall.
