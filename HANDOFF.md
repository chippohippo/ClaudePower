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

**Should work, but not yet verified off Windows:** building and running the selftests. The build is `build.ps1` (PowerShell) and compiles a WinForms `winexe` against the Windows Desktop runtime in `C:\Program Files\dotnet\shared\`. On Linux that needs PowerShell, the .NET 8 runtime, and the WinForms reference assemblies (for example from the `Microsoft.WindowsDesktop.App.Ref` NuGet package), with the paths in `build.ps1` adjusted. The selftests are headless and use fixtures, so they should run without a display; the window and `--screenshot` will not. Treat the first cloud build as a task in itself.

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
- Current state: **242 selftests pass**, all stabilizer suites pass, QC passes on all 86 cards.
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

- **2026-10-04 — Deadlock family.** Eight cards (`dlmp`, `dlb6`, `dlpl`, `dltb`, `dltap`, `dllla` Lanetrack, `dlllb` Parryturn, `dlllc` Zipfight). 37.7 cm base, Y/X 0.85, no game filter. The game constant is **assumed** to be the Source yaw (in-game sens 0.761, same as Apex); not verified.
- **2026-09-27 — Apply refusals made visible.** Applies were being refused because Nib Twin was on with no calibration, and only the console said so. Unready experimental modes are now skipped with a note (`Experiments.Soften`), and a result banner shows under the build name.
- **2026-09-27 — Third-person match.** Scales Marvel Rivals and Deadlock cards' output by (D+L)/D so targets at the chosen fight distance move like in a first-person game. Camera arm 2.5 m is an estimate.
- **2026-09-27 — UI redesign.** Dark tactical-shooter look, settings in tabs without scrolling.
- **2026-09-24/25 — Nib Twin, moving-tap fade, Tap Anchor fixes.** Nib Twin cancels the pen tip's click skid by pressure. Four review rounds; two old pin bugs fixed (flick-after-tap drag, break distance).
- Earlier: Cadence Lock engine, mouse mirror, character cards, the 2026-09-16 audit. See `README.md`.

## Open items

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
- A selftest for `SameApply` (the A/B pairing logic lives in the window and is untested).
