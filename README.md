> **Game families rebuilt 2026-10-23:** every game now has six cards (Master, Precision, Tracker, Flick, Brawl, one Signature), each tuned by the game lab on that game's own fights at its pro cm/360 range. All are latency-first: classic, floor 1.00, a two-report onset, tier ≤T1 and no smoothing. BO6 Original, the Breakpoints and the character cards did not change. See `GAME_FAMILIES.md`.

> **Audit & renovation 2026-09-16:** a full adversarial audit (22 dimensions, 248 findings, 192 confirmed by independent skeptics) and the fixes it drove. The ones you would feel: applying from the window now writes each card's declared game filter and its own stabilizer overlay (it silently dropped both); the Valorant, Apex and Rivals Master game filters are retired (through the plan their rest deadzone delivered 3-7% of a micro-correction and took 139 ms to register a slow creep); the Rivals/Apex re-anchor no longer repays the withheld offset as a one-report speed spike; all nine character cards were re-derived by a renovated lab. Details: the *Audit & renovation* section of README.md.

> **Correction 2026-09-07 (ev-20260907-pen-rate):** the pen reports at **360 Hz**, not 266. Measured on the rig with the Cadence Lock probe (360.2 Hz over 16k reports). Consequences: the 1-unit step is **3.60 mm/s** (was quoted 2.66) and one report is **2.78 ms**; Cadence Lock pins 360. LUT cards keep their authored 2.66 mm/s first anchor, so their slowest expressible step sits on the table's ramp: the 0.70 / 0.85 floors are delivered as about 0.75 / 0.89 at 3.60 mm/s - and that is what was field-rated.

# AimForge

One window that replaces the RawAccel GUI, the OpenTabletDriver GUI, the PowerShell apply
script and the copy-paste between them. Pick a game, pick a role card, press Apply — every
field is verified by read-back from both drivers. The full project story, physics, and
measurement record live in `AIMFORGE.md`; the latest overhaul decisions in `OVERHAUL.md`.

## Architecture — and the anti-cheat contract

```
                 YOU
                  │
             AimForge.exe          ← WinForms, ~0% CPU idle (HUD samples only while focused)
            ┌─────┴──────┐
     writer.exe      OpenTabletDriver.Console.exe     ← the two OFFICIAL command-line clients
          │                  │
     rawaccel.sys     OpenTabletDriver.Daemon.exe     ← untouched stock binaries
     (WHQL-signed)           │
                         vmulti.sys                   ← untouched, WHQL/catalog-signed
```

AimForge **never opens a driver**. The kernel surface an anti-cheat sees is identical to the
stock tools, and the **doctor** verifies both signatures (WinVerifyTrust + OS catalog) plus
daemon health, the elevated-pipe lockout, the live filter chain with latency tiers, filter
conflicts, the engine pairing, both first-party plugins and the pen's RawAccel device config.

## Run

Portable folder on the Desktop: double-click `AimForge.exe`. From source:

```
.\build.ps1 [-Test] [-Shot]        SDK-less build (sibling CoherenceStabilizer\roslyn); also
                                   builds + installs the AimForge.Filters OTD plugin
.\package.ps1                      build + stamp app host + deploy the portable folder
./build.sh [--test]                Linux / cloud: same sources, headless selftests + --qc (HANDOFF.md)
dotnet out\AimForge.exe
  --list | --doctor | --qc | --selftest | --filters
  --apply <id> [--dry-run] [--engine rawaccel|cadence] [--pen-hz <Hz>] [--merge-cap <reports>]
               [--mouse on|off] [--mouse-dpi <dpi>] [--mouse-halflife <ms>] [--mouse-yx <v|pen>] [--mouse-prefixes <a|b>]
  --mouse on|off | --mouse-devices | --hover <min> <max> | --hover off
  --measure (every card) | --compare <a> <b> | --audit [path]   (every card's recomputed numbers as JSON)
  --hero-lab <hero|all> | --psylocke-lab | --psylocke-refine (historical)
  --xp-lab [id] | --xp-evidence | --nib-lab [id] | --nib-evidence | --nib-calibrate [id] | --nib-fit <log> [--save]   (the experimental modes)
  --filter-evidence | --cadence-evidence | --pen-rate | --noise [ids]   (RawAccel-engine gain noise across the aim band)
  --calib360 <game> (--yaw <deg/count> | --card <id> --pen-mm <mm> [--turns n] [--sens s]) [--write]   (measure a game's K)
  --redetect | --daemon-start | --daemon-restart | --screenshot out\x.png [id]
```

Hotkeys: `Ctrl+Enter` apply · `Ctrl+D` redetect (restarts the daemon only when the tablet is absent; tray > Restart OTD daemon loads a new plugin build) ·
`Ctrl+Tab` A/B the last two applied builds (replays the exact applied rig: engine, modes, third-person gain, mirror, Nib calibration) · `F5` refresh live readout.

## Presets are data

`presets.json` — exported from the Aim Config Tuner by `export-presets.js` — is the single
source of truth. Every number shown is **recomputed at load**, never cached as authority.
Curves are authored in **mm/s of pen speed** and converted to counts/ms at the rig's px/mm at
apply time (a 145-calibrated table once drifted silently when px/mm changed; never again).
Each build also declares an explicit `filters:[]` plan, derived by the exporter, written by
the apply, and read back through the daemon's `getfilters` (see the audit section for exactly what is
checked and what is rolled back). An apply from the
window writes exactly that plan with the Builds-tab toggles folded onto the card's own
stabilizer overlay (`FilterPlan.Fold`, selftest-pinned for every card).

`export build json` / `import build json` move single builds in and out **without touching
presets.json** — an import is a transient custom build that still passes QC before applying.

## QC — the era-current law

One gate for the window and `--apply` (`RolePolicy.GateForApply`), run before anything is
written; a dry run prints what would be refused.

* **Curve shape (LUT cards)** — RULE 1: no sub-unity shelf below 15 mm/s (a flat unity pocket,
  as the Masters ship, is allowed) and a 2-unit-step gain ≥ 0.80 at 7.20 mm/s (accepted-build
  signature 0.94 at 360 Hz; the 266 Hz-era figures were 0.84 accepted / ≤0.69 rejected at
  5.32 mm/s); no gain dip below 15 mm/s — inside the tremor band a dip *amplifies* shake (Tremor
  Notch, −279%); x > 0, strictly increasing; first anchor at or below the 1-unit step. Classic
  cards meet the point-shape rules by construction.
* **Role policy** — Master/Baseline/Turbo/Tapped at latency tier ≤T2, Planted ≤T3; a sub-unity
  floor on a strict role needs a *named exception with an evidence artifact*; Lab filters on
  strict roles, two game personalities, stacked antichatter, T4/T5 on strict roles and
  Reconstructor-on-Wacom are blockers.
* **Pre-flight** — the Cadence Lock engine needs the AimForge Game Filters plugin, and RawAccel's
  `defaultDeviceConfig` (which governs the VMulti pen) must be enabled with no device DPI,
  constant-time or polling override — both checked before RawAccel is touched.
* **Warnings** — a 180 that needs more than half the tablet's 309 mm width; the Lab and
  Reference cards' sub-unity floors; a snap cone above 6° on a Rivals/OW2 Turbo.
* **Selftest-pinned roster laws** — every strict card's *shipped* plan keeps micro-aim ≥ 90% and
  a two-report onset measured through its game filters; every 180 / spread / micro / onset /
  tracking / cap-speed number a card quotes equals its own math (the copy contract).

**Design law, not machine-checked:** continuity — knees and gear boundaries caused every
measured jitter complaint; drift is trainable, flips are not. Dips and flips above 15 mm/s pass
QC by design (the Holdfast skid damper, Guardrail's step-down).

**Historical note:** two LUT-era rules ("no accel below 55 mm/s", "tap-speed gain ≤ 1.00")
were retired on 2026-08-27 — the field-best BO6 baseline violates both and is the most stable
config the user has run. Old docs quoting them are stale; the measured record wins.

## The filter stack

Latency tiers: **T0** gates (Hover Distance Limiter — min/max exposed) · **T1** state
(Tap Anchor pin, the game filters' rails and brake — ~0 ms on coherent motion) ·
**T2** corrective · **T3** light smoothing (Planted/Lab territory) · **T4** interpolators
(never on a shipped build) · **T5** prediction (Lead Sight, decel-gated; no shipped card since 2026-10-23).
The Filters tab shows every filter discovered on the machine with tier, stage, live settings,
and conflicts; presets enable exactly what their plan declares — the apply force-disables
everything else first. The CoD Master personality ships on the CoD cards; the OW2 and Finals
ones ship only on the family roles where the game lab measured them winning (OW2 Projectile,
Finals Tracker/Flick/Brawl); the **Valorant, Apex and Rivals Masters are retired** (OFF in every plan since
2026-09-16 — see below).

## Adding a preset

Author it in the tuner (mm/s points, rig fields, cohOv if it needs the pin), run
`node export-presets.js tuner.html`, then `.\build.ps1 -Test` — the selftest will refuse a
curve that breaks a rule or copy that quotes a number the curve does not produce, and the
exporter derives its filter plan automatically. For a one-off experiment, `import build json`
in the app skips the roster entirely.

## Layout

`src/Core` — I/O-free math (`Curve`, `Measure` — the harness-ported sim, run through each card's
own game filters via `PlanFilters`), the two bridges, `Doctor`, `FilterCatalog`, `RolePolicy`,
`FilterPlan`, the labs (`PsyLab`, `HeroLab`, `CadenceLab`), `MouseMirror`.
`src/App` — the one form + CLI. `plugin/` — the AimForge.Filters OTD plugin (core math is
compiled into the app too, so selftests drive the shipping filter code). `evidence/` —
measurement artifacts cited by rule exceptions and card copy.

## Cadence Lock engine (2026-09-07)

Builds tab → **Cadence Lock engine [T0]** (or `--apply <id> --engine cadence`): the build's curve runs in tablet space on the pen's own 360 Hz clock instead of RawAccel's arrival-time speed estimate; RawAccel is written flat and both sides are read back. Same curve, same rig — only *where speed is measured* changes. See `CADENCE_LOCK.md`. Four character cards (Psylocke, Loki, Soldier: 76, Freja) say to run them on this engine: across the aim band (55–220 mm/s) their ramps turn report-timing jitter into 5.3–17.1% gain noise on the RawAccel engine, up to 70% on a single report (the BO6 base: 2.9%, worst 6.5%). `AimForge --noise [ids]` measures any card.

## Experimental modes and the moving-tap fix (2026-09-24)

Builds tab, under the Cadence Lock rows. All are off by default and remembered in `xp.txt`. Details, numbers and the field test are in `XP_TOGGLES.md`.
- **Nib twin [T1, XP] + calibrate nib (20 taps).** Removes the pen tip's click skid, keyed on tip pressure, on the same report, moving or still. It is its own filter, first in the chain, and works on either engine and every role. Model lab (BO6): strafing-spray error 0.54° → 0.12° and flick-shot 0.051° → 0.022°; rest one-taps unchanged. It needs a calibration, which runs on your live build (apply once first; `--nib-calibrate`).
- **Intent speed [T1, XP]** (Cadence Lock): the gain is taken from your coherent velocity, clamped to one lattice unit; ramp-tracking gain noise is cut about 3.4×.
- **Reversal carry [T1, XP, Lab-only]** (Cadence Lock): strafe turnarounds keep part of the previous leg's gain; it arms only on a strafe rhythm.
- **Moving-tap fade (every card, a fix, not a toggle):** the Tap Anchor no longer holds a tap made while the hand moves (judged by the hand's speed before the press: full pin below 12 mm/s, none above 30). Its hand-back burst was over-priced by the accel curves: a +0.12–1.77° permanent overshoot per moving shot, now 0.000°. Rest one-taps keep the pin. It needs the updated Coherence Stabilizer installed; the Doctor checks the installed build.
- **Two Tap Anchor fixes (2026-09-25, every stabilizer card):** a flick fired right after a tap is no longer dragged back toward the tap's anchor (up to 5.6–8.0° of permanent camera error on the tap cards, now under 0.2°), and the pin now lets go after the card's own break distance in every direction while a rest tap with an ordinary settle no longer breaks it. Details in the Coherence Stabilizer README.

CLI:
- `--apply <id> [--engine cadence] --twin on|off --intent on|off --carry off|10-80`
- `--nib-calibrate` (runs on the live build from `lastapply.json`; Ctrl+C cancels safely), `--nib-fit <log> [--save]`
- `--nib-lab [id]`, `--xp-lab [id]` (`--nib-evidence`, `--xp-evidence` mint the evidence files)

## Hover distance (2026-09-09)

The Hover Distance Limiter passes a report only while `Hover_min <= HoverDistance <= Hover_max`.
HoverDistance grows with height, so a **lower max** means the pen must be nearer the surface
before it moves the camera; `max 1` is contact-only. Both dials are in the Builds tab: **hover
max** in the rig row, **hover min** in the filters panel.

Hover is dialled by feel, so it has its own live path. The chips (`contact / 40 / 87 / 100`) and
the **set hover live** button push ONLY the Hover Distance Limiter to the daemon and verify it by
read-back - no curve, no RawAccel, and never a `detect` (a re-scan against a live device churns
the device stream). Same thing headless: `AimForge --hover <min> <max>`, or `--hover off`. It is
refused while an apply or redetect is in flight.

## Mouse mirror (2026-09-14)

Builds tab -> **mirror to mouse via RawAccel**: every apply also writes a second RawAccel profile, `AimForge Mouse`, built from the card, and binds the Pulsar to it - same curve vs sensor speed, same cm/360 at the same in-game sens (57.00 counts/mm on both devices at 1600 DPI), same snap and Y/X. Off returns the mouse to raw, verified. `--apply <id> --mouse on|off`, `--mouse-devices`. Matched, not 1:1 - see `MOUSE_MIRROR.md` for the exact limits (8 kHz speed quantisation, snapping fidelity, sensor DPI is your word).

## Specific Characters (2026-09-15, renovated 2026-09-16)

Right after the Breakpoint group: **Specific Characters — Marvel Rivals** (Psylocke, Loki, White Fox, The Punisher, Hela) and **Specific Characters — Overwatch 2** (Soldier: 76, Emre, Illari, Freja). All nine come from one rule in `AimForge --hero-lab <hero|all>`, which simulates each hero's own fights (hitscan or projectile lead, recoil, target switches thrown at human tempo, flyers, the big turn the kit forces) with the shipping curve math and picks the most robust legal curve. The set sens is on each card (Rivals 0.96 or 1.06, OW2 2.54 or 2.81, per hero); numbers, gates and sources in `CHARACTER_CARDS.md`. Evidence: `ev-20260916-hero-*`, `ev-20260916-character-cards`.

## Audit & renovation (2026-09-16)

A 22-dimension adversarial audit (every card's copy against recomputed numbers, family design invariants, game constants, all code, the exporter, the selftests and the docs; 248 findings, 192 confirmed by independent skeptics). What changed:

- **Apply path.** The window's apply dropped each card's declared filter plan and rebuilt its stabilizer overlay from a generic plan, so every Master applied from the GUI ran without its game personality and the wildcards lost Lead Sight/hold. Now a copy of the card with the toggles folded onto its own overlay (pinned for all 78 cards). Export no longer writes the rig into the loaded roster. One gate for the window and `--apply`, including the Cadence plugin and pen-device pre-flights. Hover-live, redetect and restore-backup cannot run during an apply.
- **RawAccel.** Classic writes pin `Gain / Velocity` to the legacy form the app models, and the read-back verifies it with the exponent, cap mode, Output DPI, rotation and the pen's speed EMAs (0). The mouse mirror verifies the same plus Input Speed Cap and refuses a polling-rate override.
- **Game filters.** The Valorant, Apex and Rivals Masters are retired: measured through the shipping filter code their rest deadzone delivered 3–7% of a 0.12 mm correction and took 139 ms to register a slow creep, and relative output cannot tell a slow intentional correction from tremor inside a 0.4 mm gate. Their anti-trail re-anchor now passes the hand's own delta and keeps the rest offset instead of repaying it inside one report. The Finals brake arms only on a real swing (> 150 mm/s) and re-arms on every one. Filter selftests and evidence run at 360 Hz (`ev-20260828-cod-master`, `-val-master` re-minted).
- **Cadence Lock.** A gap still inside one stroke is priced over the reports it spans (the old cap of 8 read 22–50 ms gaps up to 2.25× fast); `ev-20260907-cadence-lock` now actually contains its numbers.
- **Doctor.** Engine pairing no longer reports OK when RawAccel could not be read; new rows for the Game Filters plugin and the pen device config; the stabilizer row counts the roster instead of quoting a stale "7 cards".
- **Measurement.** Micro-aim is a settle-window average (the one-sample probe read 109.6% for every unity card); onset is a directional creep probe (two reports, 5.6 ms, for unity cards); every card is also measured through its game filters (`--audit` → `measuredPlan`); `--measure` covers every card; `--audit [path]` dumps every recomputed number.
- **Roster.** Tap-pin defaults by game (the old id list skipped every character and most LL cards); Helldivers 2 mapped (it ships no personality); Stillframe restored to cm/360 34.0 (at 71.2 its flat 180 needed 356 mm on a 309 mm tablet); card copy re-derived from the recomputed numbers and pinned by the copy contract.
- **Tuner / legacy path.** The tuner exports multiplier 1.0 (1.10 made every card exported to `apply-aim-config.ps1` run 10% fast); that script now switches AimForge's filters off so it can never double-accelerate on top of Cadence Lock; The Finals note carries the real constant; Helldivers 2's FOV slider is vertical 45–90.
- **HeroLab.** Legality is measured through each variant's own filter; the 600 mm/s gate reads the ballistic throw; every switch clock is warped by that throw's tempo; Y/X is the game family's field value; tap-fire heroes get a click-skid limit; a RawAccel-engine noise column. All nine character cards re-derived by one rule, Psylocke included.

**Final review (same day).** A second adversarial pass over the renovated code (5 reviewers, every finding re-checked by a skeptic; 44 of 47 survived) and what it fixed:

- **Tablet plugin (reload the OTD daemon).** Cadence Lock and the game filters never snap their output back onto the pen while OTD could still pass the jump: OTD's relative mode discards a delta only after its own reset delay, and a pen lift does not clear it, so a 50–80 ms stall or a quick lift threw the whole gain-built offset (tens of mm) into the cursor. The first report after a lift or gap now carries the hand's own delta; only a gap past 1 s rebases. Motion a rail or the Finals brake withholds is no longer capped at 1 mm per stroke (after that the CoD rail and the brake silently switched off); the Finals brake's arm expires with the swing (a later tap stop braked); the Valorant flush passes the hand's delta like the Apex/Rivals re-anchor.
- **Apply transaction.** The OTD half returns failure when the daemon does not take the build or the curve's engine is wrong, and RawAccel is then rolled back to the pre-apply backup (the curve was left in both drivers or neither). A custom LUT with more than 8 points is refused before anything is written on the Cadence engine and no longer throws after RawAccel on the RawAccel engine. The pen LUT read-back compares the same rounded numbers the apply writes (at 55 px/mm and many others a correct write rolled back). Every OTD read-back parses whole numbers (Hover_max 87 used to verify a wanted 8) and names each game filter by its own plugin name. A new tray action restarts the OTD daemon to load a plugin build (Ctrl+D restarts it only when the tablet is absent).
- **Window.** The Advanced tab's "apply this build" no longer applies an unfinished (flat) build, starts from the loaded card (its role, game filter and whole overlay) and from the current Builds-tab rig; imports are validated before they are selected and get their own toggles; Ctrl+Tab and compare replay exactly what was applied (build, rig, toggles), not the catalogue card of the same id; Ctrl+Enter reads typed-but-uncommitted fields; the hover-min dial survives card selection; an empty hover window (min > max) is refused; the window will not close mid-apply; the QC panel judges the folded build on the rig being applied; the Cadence pen rate defaults to the measured 360 Hz.
- **Policy.** A Planted card with a sub-unity floor needs a named exception like every strict role; a dip or shelf in the tremor band is caught when its segment ends past 15 mm/s; the reach warning uses the rig being applied; game filters the plugin carries are no longer reported as "will NOT be written".
- **Copy contract.** A claim is a comparison only when its own clause names another card (seven self-claims were skipped), matching is case-insensitive, and the wordings the cards use ("costs 38.8mm for a 180", "dead time", "spread still 12.8%", "cap at 452mm/s") are read: 243 claims checked.
- **Psylocke.** Her RawAccel-engine noise was measured on a stream that never reached her 150–210 mm/s ramp (0.4%). Re-measured for all nine cards across the aim band (`CadenceLab.RunAimBand`, `--noise`): Psylocke 17.1% (worst report 70%), so her card now says to run her on the Cadence Lock engine, as Loki, Soldier: 76 and Freja do.
- **Legacy script.** `apply-aim-config.ps1` refuses before writing RawAccel when AimForge filters are live and it cannot switch them off, confirms Cadence Lock is gone with `getfilters`, saves the daemon default and switches the AimForge preset's filters off so a daemon restart cannot bring Cadence Lock back over its curve; its classic branch pins `Gain / Velocity`.
- **Doctor.** Unreadable RawAccel or OTD settings report UNVERIFIED instead of OK; the mouse-mirror consistency row compares each profile with what its own build writes.
- **The fixes, re-reviewed.** A third adversarial pass over the fixes themselves found and closed: a rollback that left OTD's saved AimForge preset holding the failed build (a daemon restart would re-apply it) - the previous preset is now restored and re-applied, and the daemon default is saved only after the engine verifies; exceptions in the OTD half now roll RawAccel back too; the Cadence engine is refused while the Game Filters plugin on disk is newer than the running daemon (the daemon's settings echo cannot tell whether it loaded the filter); console calls now honour their timeout, and a second close within 10 s always exits; the Finals arm now expires 250 ms after the last swing (the first fix stopped slow swings from braking at their own stop); a lift keeps the filter's bias, so the Lab smoothers still deliver the lag they owe; clause-boundary and wording edges in the copy contract; imports with out-of-range overlay values apply exactly when untouched; the legacy script probes the daemon before writing RawAccel and caps the reset delay at 500 ms.

## Third-person match (2026-09-27)

Builds tab → Modes → **Feel like a first-person game** (`--apply <id> --tps on|off`). An over-the-shoulder camera orbits the hero, so a target at distance D moves on screen by only D/(D+L) of the turn; near targets feel heavy under a pen. The match scales third-person games' cards (Marvel Rivals and Deadlock - the tuner's GAMES table says which) by (D+L)/D at your fight distance, so targets there move like in a first-person game; in-game sensitivity and first-person cards are unchanged. See `THIRD_PERSON.md`.

## The window, 2026-10-11

- **LIVE / NEXT APPLY line** under the build name. LIVE is what the last verified apply put in the drivers (engine and every mode on). NEXT APPLY names what Ctrl+Enter would change, including modes the apply would skip. The Apply button says APPLY CHANGES, RE-APPLY (NO CHANGES) or APPLYING.
- **One-click actions** appear only when they apply:
  - *Apply this on Cadence Lock*, on cards whose own measurement recommends it.
  - *Restart OTD daemon…*, when a plugin on disk is newer than the running daemon. You confirm first; AimForge never restarts it by itself.
  - *360° calibration…*, for games whose sensitivity constant is estimated.
- **Doctor panel.** Rows are sorted FAIL / WARN / OK, each with what it found and the one fix that clears it, plus Copy report. No terminal needed.
- **Calibrate nib** runs in one dialog:
  - It shows a live count of the taps the fit will use and finishes by itself at 20.
  - It shows the fit's swing, R², lag and spread, each with a tooltip saying what it means for aim.
  - It can turn the Nib Twin on when the fit succeeds (opt-in).
- **Applies fail closed.** An unreadable filter chain, or any filter that reads back different from what was written, rolls back both drivers, and the banner names the failed check. Unhandled errors go to `crash.log`.

## 360° calibration (2026-10-11)

A game whose sensitivity constant K is assumed (Deadlock: the Source/Apex yaw) can be measured once. Use the window's *360° calibration…* or `--calib360`. Two methods:
- **Yaw:** enter the game's yaw (degrees per count at sens 1; Source 2 console `m_yaw`). Then K = 360 × 2.54 / yaw.
- **Marked turn:** sweep slowly through whole turns, staying under the card's 1:1 speed (the tool prints the bound). Measure the pen travel on the glass. Then K = eDPI × cm/360 × sens.

The result patches the game's row in `tuner.html` (`K`, `kMeasured`, `kEvidence`) and writes `evidence\ev-<date>-<game>-k.json`. Then run `node export-presets.js tuner.html`. Cards print their sens through `{SENS}`, computed from K, so no stale number survives.

**After calibrating Deadlock:**
- The Deadlock card texts still say the constant is "assumed"; edit that wording in the tuner.
- Update the selftest that pins the estimated `0.761`.
