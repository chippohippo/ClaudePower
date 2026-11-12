# The optimizer overhaul (2026-11-12)

What changed, why, and what each piece needs from you. Everything here is tested headless (301 selftests). **None of it has a field verdict yet.** THE GOAT and BO6 Original are untouched and remain your fallbacks.

## The idea

Until now every card came from a simulated player. The GOAT is the one build proven by your own hands, and the labs could not explain why it works for you or find something better. This overhaul closes that loop three ways:

1. **Record your hand** (Hand Print), so the curve can be fitted to how you actually move.
2. **Fit the curve to that recording** (MY HAND, the optimizer).
3. **Let your verdicts run the search** (the DUEL ladder), because a field verdict outranks any model.

Alongside it, the pen's path through the PC gets two timing protections (the Realtime Lane and a burst-proof drop check) and one pen-only control (Pressure Focus).

## What stays inside the lines

Every feature is a transform of your own pen input inside OpenTabletDriver, the same class of thing as the curve you already run:

- Nothing reads the game, the screen or memory.
- Nothing generates motion your hand did not make. There is no recoil compensation, no aim assist, no macro.
- The Hand Print records pen data only (speed, strokes, report timing).
- The Realtime Lane only changes how Windows schedules the OpenTabletDriver daemon, the setting Task Manager offers.
- Pressure Focus is a sensitivity shift you control with pen pressure, like a mouse's DPI-shift button but analog.

I can't certify any anti-cheat's or tournament's rules. If a ruleset bans sensitivity-shift buttons, leave Pressure Focus off there.

## Plugin 1.4 (needs an install and a daemon restart)

Copy `AimForge.Filters.dll` and `metadata.json` into `<OTD data>\Plugins\AimForge Game Filters\`, restart the OpenTabletDriver daemon yourself, then apply. AimForge refuses Cadence Lock applies until the daemon has loaded the new file. With an older plugin every card still applies; the new modes are skipped with a note.

### Burst-proof drop check (on by default)

- **Problem:** when the PC stalls for a few milliseconds under game load, pen reports queue up and arrive in a burst: one late report, then the rest back to back. The 1.3 drop check forgot what one report of travel looks like after every burst, so a second stall right after was priced at the wrong speed.
- **Fix:** the memory now keeps learning through the burst. A long gap it could not judge still clears it.
- **Measured** (`evidence/ev-20261112-burst-lab.json`, simulation): tracking error per 100 ms, mean over 8 cards.

| host stalls per second | no check | 1.3 | 1.4 |
|---|---|---|---|
| 0 | 0.0073° | 0.0073° | 0.0073° |
| 10 | 0.2160° | 0.0355° | 0.0073° |
| 60 | 0.6657° | 0.2547° | 0.0073° |

- **Cost:** on the old drop/late test grid it is the same or better on 2862 of 2880 rows. The other 18 lose about a thousandth of a degree, all with one report in three dropped.
- **Unknown:** how often your PC really stalls. The Hand Print counts it.

### Realtime Lane (Engine tab, off by default)

- Raises the pen's report thread to Highest priority and the daemon to Above Normal (level 2: High; level 3: the report thread also joins the scheduling class Windows gives pro-audio threads).
- Tells Windows never to power-throttle the daemon, and asks the runtime not to pause for full garbage collections.
- Aimed at latency spikes when a game loads every core. It does not make the average faster.
- Reverts when you switch it off and apply; gone when the daemon restarts.
- **Proof:** the Doctor's "realtime lane" row shows the daemon's priority as Windows reports it.
- **Measured on your PC:** record a few minutes with the lane off and on (Hand Print on), and MY HAND says what it changed. See `LATENCY.md`.

### Hand Print (Engine tab, off by default)

- While on, Cadence Lock counts pen speeds (hover and tip down), strokes, report-timing classes and where on the tablet you play.
- It writes `handprint-*.txt` beside the daemon when the pen lifts or rests, at most every 30 s, from a background thread. Each report leaves for the game before any bookkeeping.
- Ten minutes and 400 strokes make a fit. Record in the game you care about, on one card.
- It also times the pen's path through your PC: how long each report takes to leave the daemon, and how far it arrived from the pen's own clock (plugin 1.4.1).

### Pressure Focus (Engine tab, experimental, off by default)

- Pressing the tip past about a third of its range lowers sensitivity smoothly, down to (100 − depth)% at a hard press. Depth is 5–50%, default 25%.
- Light taps are untouched. In hover nothing changes.
- It scales the same report (no delay, never a jump) and changes at most a full swing in 30 ms, so pressure noise can't chatter it.
- Needs the Cadence Lock engine.
- Open question: an earlier verdict found gains below 1.0 at low speed felt "high latency". This is different (you choose it by pressing), but it may feel similar. Your call.

## MY HAND: the optimizer

Press **MY HAND** in the window (or `AimForge --optimize`).

- **What it shows:** your recording in plain terms. How much of your firing time sits in the card's 1:1 band, on its ramp and on its cap; your flick speeds and sizes; timing health; tablet use.
- **What it optimizes:** a stroke lands the same whatever its tempo exactly when the gain is flat along it. So the ramp belongs where your hand spends the least aiming time, and the flat zones where it spends the most. It scores 1085 curves on four things read from your recording:
  - consistency of your own strokes (re-targeted to deliver the same turn on each candidate);
  - gain steadiness while the tip is down;
  - mean gain while the tip is down (precision);
  - arm travel for big moves.
- **Guard rails:**
  - The GOAT scores exactly 1.000; a challenger must beat it by 3%.
  - No curve may need more peak hand speed than you have ever shown.
  - With too little recording it recommends nothing.
- **What it assumes:** on a new curve you keep each stroke's duration and shape and adapt the travel. That is a first approximation, which is why the result is only a challenger.
- **Output:** the challenger is selected in the window, never applied for you. Ctrl+Enter applies it.
- **Try it without a tablet:** `AimForge --optimize --demo` plays a synthetic hand through the real recorder.

## DUEL: the ladder

Press **DUEL**. The champion (the GOAT at the start) meets a challenger that differs in one dial:

| dial | meaning | first step |
|---|---|---|
| 1:1 band | hand speed up to which the pen is 1:1 (fingertip and wrist) | 10 mm/s |
| full-power speed | where the arm gets the cap | 40 mm/s |
| arm power | the cap | 0.5× |
| base speed | cm/360, carried by the output multiplier so the in-game number never changes | 8% |

- Apply each (the window uses the normal verified apply), play a few fights on both, and answer. Ctrl+Tab in the main window swaps the last two applied builds.
- **Challenger better:** it becomes champion and the dial keeps moving the same way.
- **Champion better:** the other direction is tried; after both lose, the step halves and the ladder moves on.
- **Can't tell:** that dial is settled.
- It ends when every dial is settled. Each answer is saved in `duel.json` and as a field-verdict record under `evidence/`.
- If MY HAND found a challenger first, the ladder starts with the dial it moved most.
- The base-speed dial is also the practical answer to the open Finals-sensitivity question: it tests faster and slower bases directly.

## Smaller things

- Every classic card now shows its **dials against the GOAT** in the build checks ("1:1 band wider: 50 mm/s (+10)…").
- The build checks show **reach from the tablet centre** at 1:1 and at full power.
- The Doctor has rows for plugin 1.4, the Realtime Lane and the Hand Print.

## Commands

| command | what it does |
|---|---|
| `--handprint [dir\|file] [--card id] [--demo]` | the recording's report |
| `--optimize [dir\|file] [--style balanced\|consistency\|precision\|speed] [--save] [--demo]` | report + optimizer; `--save` writes `myhand-build.json` |
| `--duel [status\|answer challenger\|champion\|same\|seed\|reset\|export]` | the ladder, headless |
| `--burst-lab` | the drop-check comparison above |
| `--path-cost` | what the curve costs on the report path (nanoseconds, bytes) |

## Lost along the way

A broader multi-analyst review ran before this work and was cut off by a usage limit; a container reset then lost its output. Only one of its findings survived with independent verification (the burst-proof drop check, built here with the reviewer's correction). Its unverified performance and correctness findings were not recovered.
