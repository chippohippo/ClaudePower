# AimForge changelog

What a player notices on the next Desktop deploy. Newest first. Every item is verified by selftests (301 headless). Nothing here has a field verdict yet; those are listed at the end.

## 2026-11-12

### The optimizer overhaul (OPTIMIZER.md)
**Needs the new plugin:** install `AimForge.Filters.dll` 1.4 and restart the OTD daemon. With the old plugin every card still applies and the new modes are skipped with a note.

- **MY HAND (new button).** Turn on **Hand Print** (Engine tab), play ten minutes, press MY HAND.
  - It shows what your hand really does: where your firing time sits on the curve, your flick speeds, timing health, tablet use.
  - It fits the curve's dials to that recording. A challenger must beat the GOAT by 3% on your own motion, and it is selected, never applied for you.
  - The recorder keeps pen data only, never the game.
- **DUEL (new button).** An eye test for aim: the GOAT against a challenger that moves one dial. You play both and answer; your answers run the search. Every answer is saved as a field verdict.
- **Burst-proof drop check (on by default).** When the PC stalls and pen reports arrive in a burst, speed is now priced right. Simulated tracking error at 10 stalls a second: 0.036° → 0.007°.
- **Realtime Lane (Engine tab).** Puts the pen's report thread and the OTD daemon at the front of the CPU queue, to cut latency spikes under game load. The Doctor shows the daemon's priority as proof.
- **Pressure Focus (Engine tab, experimental).** Press harder and the sensitivity drops smoothly, up to the depth you set: an analog sniper button under the firing finger.
- **Every card shows its dials against the GOAT** ("1:1 band wider: 50 mm/s (+10)…") and its reach from the tablet centre.
- **Unchanged:** every card's curve, the GOAT and BO6 Original included.

### Latency: measured, not rebuilt (LATENCY.md)
- **No ground-up rewrite.** The app is not on the pen's path, and the curve that is costs about 90 nanoseconds a report (0.003% of the pen's interval) with zero memory allocated. `AimForge --path-cost` prints it.
- **MY HAND now shows the pen's path on your PC.** With Hand Print on, the recorder times how long each report takes to leave the daemon and how far it arrived from the pen's own clock.
- **The Realtime Lane gets a verdict from your own PC.** Record a few minutes with it off and on; MY HAND then says whether it helps, does not help, or makes no measurable difference.
- **Realtime Lane level 3.** The pen's report thread joins the scheduling class Windows gives pro-audio threads.
- **Plugin 1.4.1** carries the probe and level 3. The app works with 1.4.0 too; those two features are then absent.

## 2026-10-24

### THE GOAT (GAME_FAMILIES.md)
- **New first card: The GOAT.** It is the build you rated "hands down one of the best feelings I've had on tablet":
  - the Apex Brawl curve (1:1 to 40 mm/s, then cap 3.0 at 190 mm/s);
  - 57 px/mm and 52.63 cm/360, which is The Finals sensitivity 12;
  - **angle snap 0, Y/X 1.00**, reset 20 ms, no filters, on Cadence Lock.
- **Everything except BO6 Original is rebuilt on it:**
  - snap 0 and Y/X 1.00 everywhere (you found snap and Y/X made aim inconsistent);
  - reset 20 ms and no stabilizer everywhere;
  - base speeds are ratios of the GOAT's;
  - the game families and character cards were re-derived by the labs around the GOAT;
  - the Breakpoints moved onto its rig.
- **The Finals Master is the GOAT.** The lab picked the GOAT's exact curve on its own for the Helldivers 2 Master and the Valorant Brawl. Hela and Emre are the GOAT too.
- **The Tap Anchor no longer ships on any card.** The GOAT runs without it. It is still one switch in Filters, preset per game.
- **If your Finals sensitivity is not 12:** every speed derives from that one number, so tell me the real value and the roster re-derives.

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
