# AimForge changelog

What a player notices on the next Desktop deploy. Newest first. Every item is verified by selftests (261 headless). Nothing here has a field verdict yet; those are listed at the end.

## 2026-10-11

### Applies you can trust
- **An apply now either verifies completely or rolls back both drivers.**
  - Before, an apply whose filter chain could not be read back was reported as verified and saved as the OTD default.
  - Before, a stabilizer or game-filter property that did not match was saved as a half-applied build.
  - Both now roll back, and the banner names the check that failed, for example "filter chain read-back mismatch: TapAnchor 1".
  - **You may see new refusals where you used to see a quiet success.** The banner text is the evidence.
- **The stabilizer read-back checks every property it writes.** TapAnchor, the tremor window, and the coherence and rail settings were written but never checked.
- **A rollback with no earlier AimForge preset** reloads the OTD daemon's saved default instead of leaving the failed build live.

### Less guessing in the window
- Under the build name:
  - **LIVE:** the engine and modes the drivers actually run.
  - **NEXT APPLY CHANGES:** what Ctrl+Enter would change, for example "engine, Nib Twin".
- **The Apply button** says APPLY CHANGES, RE-APPLY (NO CHANGES) or APPLYING.
- **Ctrl+Tab A/B** replays exactly what was applied: third-person gain, mouse mirror and Nib calibration included. A recalibration or a mirror toggle now counts as a new A/B pair.
- **Character cards that recommend Cadence Lock** (Psylocke, Loki, Soldier: 76, Freja) show a CADENCE chip and an *Apply this on Cadence Lock* button.
- **A stale OTD daemon** (a plugin built after the daemon started) shows a warning banner and a *Restart OTD daemon…* button. You confirm first.
- **Doctor** opens a panel:
  - Rows are red, amber or green, each with the fix.
  - Copy report puts the whole thing on the clipboard.
  - A new row catches a plugin that is installed but not loaded by the daemon.
  - The Nib calibration's age is shown.
- **A crash** writes `crash.log` and says so, instead of vanishing.

### Nib Twin calibration without guesswork
- **One dialog with a live counter** of usable taps (pen still before the tap). It finishes by itself at 20.
- **Results are explained:** swing, R², lag and per-tap spread, each with what it means for aim.
- **Optional:** turn the Nib Twin on when the fit succeeds. It re-applies through the normal verified apply, and Ctrl+Tab compares with/without.

### Third-person (Marvel Rivals, Deadlock)
- **The camera arm is per game.**
- **Fight distance chips:** DIVE 9 m, MID 12 m, POKE 18 m. These are starting points, not measurements.
- **A drawn diagram** of camera, hero and target, with k = (D+L)/D, and a "MATCHED AT X M" readout.
- **Which games are third person** now comes from the tuner's game table, not from card-id prefixes.

### Deadlock sensitivity
- **360° calibration (window button or `--calib360`)** measures the game's constant:
  - from the game's yaw;
  - or from one slow marked turn, inside the card's 1:1 band.
- **It writes the result to the tuner** with an evidence record. After `node export-presets.js tuner.html` every Deadlock card prints the measured sens.

### For development
- `./build.sh --test` builds and runs the selftests on Linux (cloud sessions), using a stabilizer core recovered from the deployed DLL when `CoherenceStabilizer\` is absent.

## Pending field verdicts
- **The stricter apply:** watch for new refusals.
- **The window** has not been rendered yet; run `.\build.ps1 -Shot` first.
- **Nib Twin:** never calibrated on the real tablet.
- **Third-person:**
  - the camera arms are estimates;
  - the distance chips are starting points.
- **Deadlock:** the sensitivity constant is still assumed until the 360 is done.
- **Earlier work, still unverified in play:** Cadence Lock, mouse mirror, the moving-tap fade, Intent Speed, Reversal Carry, the character cards and every Deadlock card (HANDOFF.md).
