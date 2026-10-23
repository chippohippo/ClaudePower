# AimForge changelog

What a player notices on the next Desktop deploy. Newest first. Every item is verified by selftests (264 headless). Nothing here has a field verdict yet; those are listed at the end.

## 2026-10-23

### The game families, rebuilt (GAME_FAMILIES.md)
- **Every game card was replaced.** Each of the 8 games now has 6 cards tuned by the new game lab on that game's own fights: Master, Precision, Tracker, Flick, Brawl and one Signature. They run at the game's pro cm/360 range, not the BO6 number.
- **They feel different on purpose.**
  - Precision sits at the slow end with the click pin.
  - Brawl sits at the fast end.
  - Flick turns 180° in 38–54 mm.
  - Tracker keeps a wide 1:1 band before the ramp.
- **Latency first.**
  - Every family card is a classic curve with the floor at 1.00.
  - Onset is two reports (5.6 ms).
  - Tier is T0 or T1.
  - **No smoothing anywhere.**
  - The Tap Anchor, in exact passthrough, ships only where you fire single shots.
- **Retired:**
  - the per-game Baseline/Planted/Turbo/Tapped quads;
  - the LUT Masters;
  - the Low-Latency Breakpoint trios;
  - the seven Lab wildcards, which carried hold smoothing or Lead Sight.
- **Unchanged:** BO6 Original stays your fallback. The Breakpoints, the character cards and the references are also unchanged.
- **Game-side notes on each card:**
  - Apex: EAC may disable RawAccel (issue #304), so use Cadence Lock if the curve vanishes.
  - Deadlock: the sens constant is unverified, so run the 360 calibration.
  - The Finals and Helldivers 2: turn the game's mouse smoothing off.

## 2026-10-11

### Engine research (CADENCE_LOCK.md section 9)
- **Cadence Lock 1.3: drop check.** A report that arrives late is no longer priced at half speed. Measured fix: 1.10° → 0.013° of tracking error at one late report in 40, and never worse anywhere.
  - **Needs the new plugin:** install `AimForge.Filters.dll` 1.3 and restart the OTD daemon.
  - An older plugin still applies, with a note.
- **Engine tab: this card's real-chain tracking error on both engines.** Cadence Lock reads 4–9× steadier on every card tested. That's simulation; your A/B decides.
- **owwx (Guardrail) and hdwx (Cannonade) show CADENCE.** At their 90 px/mm the RawAccel engine misprices fast flicks.
- **Every Nib calibration now records your pen's real report timing as evidence.**

### From the community research (RESEARCH.md)
- **Doctor, Valorant builds:** a new row checks how the pen tip clicks under Vanguard.
  - OpenTabletDriver's built-in mouse and key bindings press through SendInput, which Vanguard blocks, so that is a FAIL with the fix (use the VMulti plugin's button binding).
  - It always states Vanguard's two documented rules: touch the pen before the mouse, and taps can drop while keys are held. If taps vanish while you strafe, add a keyboard Fire bind.
- **Measured and rejected:** RawAccel's speed smoothing on the pen. It doesn't remove the gain spikes you feel and delays a flick's gain; Cadence Lock does the job with no lag. No card changed.
- **Worth a session at the tablet (pending):** the osu! "tapx" style. Aim in hover and fire with a keyboard key; the nib never touches, so there is no click skid.

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
