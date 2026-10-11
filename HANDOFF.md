# AimForge handoff

Written 2026-10-11 for a fresh session, including a cloud one. Read this first, then `README.md` and the feature notes listed below.

## What this is

AimForge is a Windows app that tunes pen aim for shooters. The rig is a Wacom One 14 (DTC-141) pen display used as a mouse:

```
pen (360 Hz, 0.01 mm) -> OpenTabletDriver, relative mode (D:\Pen) -> VMulti -> RawAccel (D:\RawAccel) -> game
```

The user aims in hover and fires by tapping the tip. AimForge applies a "card" (a build: accel curve, px/mm, snap, Y/X, filters) to both drivers, reads everything back, and rolls back on any mismatch.

Two projects, side by side in `C:\Users\Chippo\Organized\Folders\GamingOptimizerPro\`:

| Folder | What |
|---|---|
| `AimForge\` | The app (C#, WinForms, .NET 8), its OTD filter plugin, the tuner, docs, evidence |
| `CoherenceStabilizer\` | A second OTD filter plugin (the Tap Anchor pin), its tests, and the shared toolchain |

Deployed copy the user runs: `C:\Users\Chippo\Desktop\AimForge\AimForge.exe`. Previous builds are kept there as `AimForge.dll.old`, `.old2` … `.old19`.

## Getting it into the cloud

There is **no git repository**. Nothing is version-controlled or pushed anywhere. Before a cloud session can work on it:

1. `git init` in `GamingOptimizerPro\` (or a new folder holding only the two project folders) and push to a private remote. The parent folder holds unrelated projects, so do not commit it wholesale.
2. Include both `AimForge\` and `CoherenceStabilizer\`. AimForge's build compiles `..\CoherenceStabilizer\src\CoherenceCore.cs` into the app and uses `..\CoherenceStabilizer\roslyn\` (the compiler, 61 MB) and `..\CoherenceStabilizer\otd\` (the OTD plugin reference assembly).
3. Leave out `AimForge\out\`, `CoherenceStabilizer\out\`, and per-install state files (`engine.txt`, `mouse.txt`, `xp.txt`, `tps.txt`, `nibtwin.json`, `lastapply.json`).

Sizes: AimForge 24 MB (18 MB is `apphost\`, the launcher stub used by packaging), CoherenceStabilizer 63 MB (61 MB is `roslyn\`).

## What a cloud session can and cannot do

**Cannot:** touch the real drivers, the tablet, the OTD daemon, or the user's Desktop copy. Applies, calibration, `--doctor` against the live machine, plugin install, and any field test are local-only.

**Works in the cloud (2026-10-11):** `./build.sh --test` builds the app and the plugin and runs `--selftest` and `--qc` on Linux. It needs the .NET 8 SDK (`apt-get install dotnet-sdk-8.0`; the Microsoft download host is blocked by the cloud network policy, Ubuntu's package works) and fetches the WinForms reference assemblies and the OTD plugin reference from NuGet into `.cache/`. `CoherenceStabilizer\` is not in the repo, so `build.sh` falls back to `vendor/CoherenceCore.recovered.cs`, decompiled from the deployed `AimForge.dll`. Never edit it; if the stabilizer changes, re-extract it. The window, `--screenshot` and the live-machine selftest block (about 9 tests) cannot run off Windows.

**Good cloud work:** anything in `src\Core\` and `plugin\` (curves, labs, filters, policy, selftests), the tuner (`tuner.html`, plain JS, exported with Node), docs, and reviews.

## Build, test, package (Windows)

```powershell
cd AimForge
.\build.ps1 -Test        # build app + plugin, run selftests, --list, --doctor, a dry-run apply
.\build.ps1 -Shot        # build + render the window to out\screenshot.png
.\package.ps1            # build and copy to Desktop\AimForge (rename AimForge.dll to .oldN first)
cd ..\CoherenceStabilizer
.\build.ps1 -Tests       # stabilizer plugin + its five test suites
.\build.ps1 -Install     # copy the plugin into D:\Pen\userdata\Plugins
```

- `build.ps1` also installs the AimForge filter plugin into `D:\Pen\userdata\Plugins\AimForge Game Filters` when it changed. The OTD daemon must be restarted to load a new plugin (tray → Restart OTD daemon).
- Current state: **261 headless selftests pass (cloud, 2026-10-11); not yet re-run on Windows with the live-machine block**, all stabilizer suites pass, QC passes on all 86 cards.
- Useful read-only CLI: `--selftest`, `--qc`, `--list`, `--doctor`, `--apply <id> --dry-run`, `--nib-lab [id]`, `--xp-lab [id]`, `--hero-lab <id|all>`, `--noise [ids]`, `--screenshot <png> [card|advanced|filters] [sideTab 0-4]`.

## Rules that must not be broken

- AimForge never opens or patches drivers. RawAccel only through `settings.json` + `writer.exe`; OTD only through `OpenTabletDriver.Console.exe` and first-party plugins.
- Never issue OTD `detect` automatically. Never restart the user's OTD daemon automatically; tell the user.
- **`presets.json` is generated.** Edit cards in `tuner.html`, then run `node export-presets.js tuner.html`. Never hand-edit `presets.json`.
- An apply must never leave the curve in both drivers or in neither. Every apply is verified by read-back.
- The camera may only move because the hand moved. No macros, no synthesized motion.
- Field verdicts from the user outrank theory. Game config files are recommended, never edited.
- Card descriptions are checked: every number a card quotes about itself must equal its recomputed math (`CopyContract.cs`, a selftest).
- Plugin filters keep continuity across lifts and gaps (no snap onto the pen; rebase only after 1 s).

## Where things are

| Path | Contents |
|---|---|
| `src\App\MainForm.cs`, `Theme.cs` | The window (redesigned 2026-09-27) and its theme controls |
| `src\App\Program.cs` | CLI and all selftests |
| `src\Core\OtdBridge.cs`, `RawAccelBridge.cs` | The two driver bridges, apply + read-back + rollback |
| `src\Core\RolePolicy.cs`, `FilterPlan.cs`, `FilterCatalog.cs` | Card roles, the shared apply gate, filter plans |
| `src\Core\LastApply.cs` | Record of the last apply (`lastapply.json`), drift check, nib calibration transaction |
| `src\Core\Experiments.cs`, `NibTwin.cs`, `ThirdPerson.cs`, `MouseMirror.cs` | Apply-time modes |
| `src\Core\Curve.cs`, `Measure.cs`, `*Lab.cs` | Curve math and the measurement labs |
| `plugin\` | OTD filters: game filters, Cadence Lock, Nib Twin |
| `tuner.html`, `export-presets.js`, `presets.json` | Card source, exporter, generated roster |
| `evidence\` | Measurement records cited by cards and docs |

Feature notes: `AIMFORGE.md`, `CADENCE_LOCK.md`, `MOUSE_MIRROR.md`, `CHARACTER_CARDS.md`, `XP_TOGGLES.md`, `THIRD_PERSON.md`, `OVERHAUL.md`. The Coherence Stabilizer has its own `README.md`.

## Recent work (newest first)

- **2026-10-11 (second pass) — steps 4-8 of the overhaul.** See `CHANGELOG.md` for the player-facing list.
  - **Third-person:** it is a GAMES property in the tuner, with a per-game camera arm in `tps.txt` and dive/mid/poke distances.
  - **360 calibration** (`Calib360`, `--calib360`, window dialog). Cards may write `{SENS}` in the tuner. Every card's exported text was byte-identical at the switch.
  - **Nib Twin calibration dialog** (`NibCalibrateForm`): live tap count via `NibFit.Progress`, and an opt-in `enableTwin`.
  - **Window:**
    - the LIVE / NEXT APPLY line (`BuildState`);
    - one-click Cadence / daemon restart / 360;
    - `DoctorForm`;
    - `crash.log`.
  - **New App files:** `NibCalibrateForm.cs`, `DoctorForm.cs`, `Calib360Form.cs`.
  - **The window code compiles but has never been rendered:** run `.\build.ps1 -Shot` and look before trusting the layout. The hero row is now 168 px tall.

- **2026-10-11 — Cloud build, apply holes closed, A/B identity, Doctor as data.**
  - `build.sh` runs the selftests on Linux.
  - Every OTD failure now rolls back both drivers. That covers an unreadable chain, which used to pass with the engine unverified, and stabilizer or game-filter mismatches, which used to be saved as a partial apply. With no previous preset, the rollback reloads the daemon's saved default.
  - The stabilizer read-back covers every written key.
  - A/B pairs use `ApplyIdentity`, which covers every `Rig` field, and Ctrl+Tab replays the exact applied rig.
  - Doctor rows have OK / WARN / FAIL plus a fix line, check that plugins are actually loaded, and show the Nib Twin calibration age.
  - Field effect: an apply that used to be saved half-verified is now refused and rolled back, with the reason in the banner.

- **2026-10-04 — Deadlock family.** Eight cards (`dlmp`, `dlb6`, `dlpl`, `dltb`, `dltap`, `dllla` Lanetrack, `dlllb` Parryturn, `dlllc` Zipfight). 37.7 cm base, Y/X 0.85, no game filter. The game constant is **assumed** to be the Source yaw (in-game sens 0.761, same as Apex); not verified.
- **2026-09-27 — Apply refusals made visible.** Applies were being refused because Nib Twin was on with no calibration, and only the console said so. Unready experimental modes are now skipped with a note (`Experiments.Soften`), and a result banner shows under the build name.
- **2026-09-27 — Third-person match.** Scales Marvel Rivals and Deadlock cards' output by (D+L)/D so targets at the chosen fight distance move like in a first-person game. Camera arm 2.5 m is an estimate.
- **2026-09-27 — UI redesign.** Dark tactical-shooter look, settings in tabs without scrolling.
- **2026-09-24/25 — Nib Twin, moving-tap fade, Tap Anchor fixes.** Nib Twin cancels the pen tip's click skid by pressure. Four review rounds; two old pin bugs fixed (flick-after-tap drag, break distance).
- Earlier: Cadence Lock engine, mouse mirror, character cards, the 2026-09-16 audit. See `README.md`.

## Open items

- **First Windows run after 2026-10-11:**
  - `.\build.ps1 -Test`, then `-Shot`.
  - Check the hero area layout.
  - Check that the LIVE / NEXT APPLY line says "no changes" right after an untouched start-up. If it names a change there, the start-up baseline (`lastApplied` seeded from `lastapply.json`) and `EffectivePreset()` disagree; investigate before trusting the line.
- **After the Deadlock 360:**
  - edit the Deadlock card texts that say the constant is "assumed";
  - update the selftest that pins the estimated 0.761.
- **Helldivers 2** is also over-the-shoulder but not marked `thirdPerson`. Marking it is a tuner decision for the user (its first-person ADS changes the geometry).
- **Intent Speed and Reversal Carry** still lack their own Lab-only tooltips and a dedicated one-click A/B. Plain Ctrl+Tab already pairs any mode change.

Everything below needs the user at the tablet; none of it can be closed from the cloud.

- **Field verdicts pending** on: Nib Twin, the moving-tap fade and pin fixes, Intent Speed, Reversal Carry, third-person match, Cadence Lock, mouse mirror, the character cards, and every Deadlock card.
- **Nib Twin has never been calibrated.** All its numbers come from a model of the skid. The user needs to apply once, run "calibrate nib (20 taps)", then A/B with Ctrl+Tab.
- **Deadlock sensitivity** needs one 360° turn test in game.
- **Marvel Rivals camera arm** (third-person match) is an estimate.
- The last round of Nib Twin and pin fixes was verified by selftests and reviewer probes, not by a fresh full review.
- No git history exists; the only backups are the `.oldN` DLLs on the Desktop.

## Ideas not started

- Make `--apply` read the saved engine from `engine.txt` (the window does; the CLI defaults to RawAccel unless `--engine cadence` is passed).
- A Lab (wildcard) card for Deadlock, for parity with the other families.
- Per-game camera arm for the third-person match (one global value today).
