# THE GOAT and the roster built on it (2026-10-24)

## The GOAT

Your field verdict on 2026-10-24: *"hands down one of the best feelings I've had on tablet."* You also said it "feels most like a mouse, a lot of arm and hand movements, finger tip and wrist pivot on micro adjustments but it feels very adaptable to changes." Separately, you found that angle snapping and the Y/X ratio made aim inconsistent. Evidence: `evidence/ev-20261024-goat.json`.

The card is the build you had live, taken from your screenshots:

| | |
|---|---|
| Curve | the Apex Legends Brawl curve of 2026-10-23: classic accel 0.2963 / offset 2.28 / cap 3.0. That is 1:1 up to 40 mm/s (the fingertip and wrist band), then one ramp to the 3.0x cap at 190 mm/s (the arm) |
| Rig | 57 px/mm, **angle snap 0**, **Y/X 1.00**, **reset 20 ms**, hover max 87 |
| Speed | **52.63 cm/360 = The Finals sensitivity 12**, which is the value you remember. If the game shows a different number, tell me: `Goat.Cm` changes and the labs re-run |
| Filters | Hover Distance Limiter only. No Tap Anchor, no hold smoothing, no game filter |
| Engine | Cadence Lock, pen rate 360, merge cap 5. Nib Twin, Intent Speed and Reversal Carry are off |
| Measured | 180° in 87.7 mm, committed flick spread 4.3%, micro 99%, onset 5.6 ms (two reports), tracking 1.90x |

It is the first card in the list.

## What changed

**BO6 Original did not change.** Every other card was rebuilt on the GOAT:

- **The GOAT's rig everywhere:**
  - angle snap 0, Y/X 1.00, reset 20 ms, hover max 87;
  - no stabilizer. The Tap Anchor is still one switch away in Filters, preset per game, on single-shot roles;
  - no game filter on the family and character cards. The CoD cards keep the CoD Master filter.
- **Game families** (`--game-lab all`, `evidence/ev-20261024-game-*.json`). The same six roles, each tuned on that game's fights. Each base speed is a ratio of the GOAT's:
  - Master, Tracker and Flick: 52.63 cm/360;
  - Precision: x1.15 (60.52);
  - Brawl: x0.87 (45.79);
  - Signature: its own ratio. The Finals Fieldwide stays on your sens-8 verdict (78.95).
- **The lab's search around the GOAT:**
  - The Master searches the GOAT's neighbourhood: 1:1 to 30–60 mm/s, then a cap of 2.5–4x reached by 150–230 mm/s. The GOAT itself is always a candidate.
  - **The Finals Master is the GOAT itself.** Your verdict came from that game and outranks the lab.
  - The lab independently picked the GOAT's exact curve for the Helldivers 2 Master and the Valorant Brawl.
- **The lab's limits are now relative to the GOAT.** The old limits were set for a 35–40 cm world, and your arm-aim base fails them, so:
  - a role's 180 limit is a ratio of the GOAT's 87.7 mm;
  - the peak hand-speed gate is the larger of 600 mm/s and the GOAT's own peak on the same fights. The GOAT is proven in the field, so any curve that asks no more of your hand is fine.
- **Character cards** (`--hero-lab all`, `evidence/ev-20261024-hero-*.json`):
  - re-derived with the GOAT's 52.63 as the speed ceiling: the lab may go faster, never slower, at x0.8, x0.9 or x1.0;
  - the GOAT's curve is always a candidate;
  - **Hela and Emre came out as the GOAT itself.**
- **Breakpoints:** moved onto the GOAT's rig.
  - **Breakpoint** keeps its curve (0.246 / 0.5 / cap 5.0) at 52.63 cm/360.
  - **Breakpoint Wide** keeps it at 78.95.
  - **Breakpoint Slow Center** is now the GOAT's fingertip band (1:1 to 40 mm/s) with Breakpoint's flick end (cap 5.0 by 303 mm/s).
- **References** (Feather, True Raw) are unchanged on purpose. They are controls for A/B comparisons, not cards to play.

## The family cards

Columns: cm/360, then accel / offset / cap, the speed where the cap is reached (mm/s), the measured 180° (mm) and the in-game sens at 57 px/mm.

| game | role | cm | accel / off / cap | cap at | 180 mm | sens |
|---|---|---|---|---|---|---|
| Valorant | Master | 52.63 | 0.3655 / 1.71 / 3 | 150 | 87.7 | 0.171 |
|  | Precision | 60.52 | 1.2183 / 2.28 / 3.5 | 100 | 86.5 | 0.149 |
|  | Tracker | 52.63 | 1.6569 / 6.27 / 3 | 170 | 87.7 | 0.171 |
|  | Flick | 52.63 | 0.5105 / 0.5 / 4 | 120 | 65.8 | 0.171 |
|  | Brawl | 45.79 | 0.2963 / 2.28 / 3 | 190 | 76.3 | 0.197 |
|  | Operator | 60.43 | 1.462 / 2.28 / 4 | 100 | 75.5 | 0.149 |
| Apex Legends | Master | 52.63 | 0.3945 / 3.42 / 3 | 190 | 87.7 | 0.545 |
|  | Precision | 60.52 | 1.9493 / 5.7 / 3.5 | 160 | 86.5 | 0.474 |
|  | Tracker | 52.63 | 1.6569 / 6.27 / 3 | 170 | 87.7 | 0.545 |
|  | Flick | 52.63 | 0.7179 / 0.5 / 4 | 90 | 65.8 | 0.545 |
|  | Brawl | 45.79 | 0.3431 / 3.99 / 3 | 220 | 76.3 | 0.627 |
|  | Longbow | 56.58 | 0.2879 / 0.5 / 4 | 200 | 70.7 | 0.507 |
| Overwatch 2 | Master | 52.63 | 0.3655 / 1.71 / 3 | 150 | 87.7 | 1.818 |
|  | Precision | 60.52 | 1.2183 / 2.28 / 3.5 | 100 | 86.5 | 1.581 |
|  | Tracker | 52.63 | 2.2417 / 9.69 / 3 | 230 | 87.7 | 1.818 |
|  | Flick | 52.63 | 0.7179 / 0.5 / 4 | 90 | 65.8 | 1.818 |
|  | Brawl | 45.79 | 0.1919 / 0.5 / 3 | 200 | 76.3 | 2.090 |
|  | Projectile | 52.63 | 0.3158 / 9.12 / 3 | 360 | 87.7 | 1.818 |
| Marvel Rivals | Master | 52.63 | 0.2491 / 2.85 / 3 | 230 | 87.7 | 0.686 |
|  | Precision | 60.52 | 0.3289 / 5.7 / 3.5 | 300 | 86.5 | 0.596 |
|  | Tracker | 52.63 | 0.8989 / 11.4 / 3 | 310 | 87.7 | 0.686 |
|  | Flick | 52.63 | 0.3682 / 0.5 / 4 | 160 | 65.8 | 0.686 |
|  | Brawl | 45.79 | 0.1919 / 0.5 / 3 | 200 | 76.3 | 0.788 |
|  | Skyward | 52.63 | 2.5341 / 11.4 / 3 | 260 | 87.7 | 0.686 |
| The Finals | Master (= the GOAT) | 52.63 | 0.2963 / 2.28 / 3 | 190 | 87.7 | 12.000 |
|  | Precision | 60.52 | 0.7612 / 5.7 / 3.5 | 210 | 86.5 | 10.436 |
|  | Tracker | 52.63 | 0.638 / 6.27 / 3 | 220 | 87.7 | 12.000 |
|  | Flick | 52.63 | 0.3682 / 0.5 / 4 | 160 | 65.8 | 12.000 |
|  | Brawl | 45.79 | 0.2639 / 0.5 / 3 | 150 | 76.3 | 13.793 |
|  | Fieldwide | 78.95 | 0.5278 / 0.5 / 5 | 150 | 79.0 | 8.000 |
| Deadlock | Master | 52.63 | 0.2236 / 2.28 / 3 | 230 | 87.7 | 0.545 |
|  | Precision | 60.52 | 0.6525 / 3.99 / 3.5 | 180 | 86.5 | 0.474 |
|  | Tracker | 52.63 | 1.9493 / 7.98 / 3 | 200 | 87.7 | 0.545 |
|  | Flick | 52.63 | 0.5105 / 0.5 / 4 | 120 | 65.8 | 0.545 |
|  | Brawl | 45.79 | 0.2639 / 0.5 / 3 | 150 | 76.3 | 0.627 |
|  | Zipline | 52.63 | 0.667 / 6.84 / 3 | 230 | 87.7 | 0.545 |
| Helldivers 2 | Master | 52.63 | 0.2963 / 2.28 / 3 | 190 | 87.7 | 0.021 |
|  | Precision | 60.52 | 0.435 / 2.28 / 3 | 150 | 100.9 | 0.018 |
|  | Tracker | 52.63 | 1.9493 / 7.98 / 3 | 200 | 87.7 | 0.021 |
|  | Flick | 52.63 | 0.5105 / 0.5 / 4 | 120 | 65.8 | 0.021 |
|  | Brawl | 45.79 | 0.2639 / 0.5 / 3 | 150 | 76.3 | 0.024 |
|  | Heavy | 52.63 | 0.3655 / 1.71 / 3 | 150 | 87.7 | 0.021 |
| Holdfast | Master | 52.63 | 0.3655 / 1.71 / 3 | 150 | 87.7 | 0.075 |
|  | Precision | 60.52 | 0.9747 / 2.28 / 3 | 100 | 100.9 | 0.065 |
|  | Tracker | 52.63 | 0.638 / 6.27 / 3 | 220 | 87.7 | 0.075 |
|  | Flick | 52.63 | 0.9828 / 0.5 / 4 | 70 | 65.8 | 0.075 |
|  | Brawl | 45.79 | 0.1979 / 0.5 / 2.5 | 150 | 91.6 | 0.086 |
|  | Sabre | 60.52 | 0.565 / 0.5 / 4 | 110 | 75.7 | 0.065 |

All cards run angle snap 0, Y/X 1.00, reset 20 ms, no stabilizer and no game filter. No two cards in a game share a build.

## The character cards

| hero | cm | accel / off / cap | 180 mm | hero sens |
|---|---|---|---|---|
| Psylocke | 42.1 | 2.2417 / 9.69 / 3 | 70.2 | 0.857. |
| Loki | 42.1 | 0.493 / 3.42 / 3 | 70.2 | 0.857. |
| White Fox | 52.63 | 0.2105 / 2.28 / 3 | 87.7 | 0.686. |
| The Punisher | 47.37 | 1.1696 / 3.42 / 3 | 79.0 | 0.762. |
| Hela | 52.63 | 0.2963 / 2.28 / 3 | 87.7 | 0.686. |
| Soldier: 76 | 47.37 | 1.8519 / 7.41 / 3 | 79.0 | 2.020. |
| Emre | 52.63 | 0.2963 / 2.28 / 3 | 87.7 | 1.818. |
| Illari | 52.63 | 0.435 / 2.28 / 3 | 87.7 | 1.818. |
| Freja | 47.37 | 1.1696 / 3.42 / 3 | 79.0 | 2.020. |

## Lab notes worth knowing

- **Emre and Hela** are the GOAT. On the lab's base hand model, the OW2 Master scores about 11% better than the GOAT on Emre's fights, and the Rivals Master about 3% better on Hela's. The robustness pass across five hand models still chose the field-proven GOAT. Try the game Master if those heroes feel off.
- **Psylocke and Soldier: 76** carry the Cadence Lock advice. You already run Cadence Lock, so nothing changes for you.
- **Pro ranges:** your 52.63 base is slower than most pros play in OW2, Rivals, Apex and The Finals. Each card's text still lists that game's pro range. Your verdict outranks it.

## Set these up in the game (unchanged)

- **Apex:** if the curve vanishes, anti-cheat may have switched RawAccel off (issue #304); keep Cadence Lock on.
- **Deadlock:** the sens constant is unverified, so run the 360 calibration.
- **The Finals and Helldivers 2:** turn the game's mouse smoothing off.

None of the reworked cards has a field verdict yet. The GOAT and BO6 Original are your two proven fallbacks.
