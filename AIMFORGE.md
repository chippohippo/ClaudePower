# AimForge

> **Audit & renovation 2026-09-16:** a full adversarial audit (22 dimensions, 248 findings, 192 confirmed by independent skeptics) and the fixes it drove. The ones you would feel: applying from the window now writes each card's declared game filter and its own stabilizer overlay (it silently dropped both); the Valorant, Apex and Rivals Master game filters are retired (through the plan their rest deadzone delivered 3-7% of a micro-correction and took 139 ms to register a slow creep); the Rivals/Apex re-anchor no longer repays the withheld offset as a one-report speed spike; all nine character cards were re-derived by a renovated lab. Details: the *Audit & renovation* section of README.md.

> **Correction 2026-09-10 (ev-20260910-finals-k):** The Finals' sensitivity constant is K 914400 (yaw 0.001°/count), not the OW2/CoD copy 138545.5 it had carried (6.6× low). The Finals family was re-authored on your field-rated sens 8 = 78.95 cm/360.

> **Correction 2026-09-14 (ev-20260914-classic-formula):** RawAccel's classic legacy curve is `1 + a(v-off)^2/v` (capped), read verbatim from the driver source, not the straight line `1 + a(v-off)` this project assumed. The two agree only at offset 0. Every classic card's canvas, measurement and Cadence Lock evaluation now use the driver's formula (Cadence Lock runs it natively, exactly). Breakpoint's cap lands at 303 mm/s (was quoted 294), its 180 measures 41.0 mm (was 40.5); the old Cadence Lock table over-read the tap-band gain by up to 6%.

> **Correction 2026-09-07 (ev-20260907-pen-rate):** the pen reports at **360 Hz**, not 266. Measured on the rig with the Cadence Lock probe (360.2 Hz over 16k reports). Consequences: the 1-unit step is **3.60 mm/s** (was quoted 2.66), one report is **2.78 ms** (dead-time figures quoted as 3.8 ms are 2.8 ms), and Cadence Lock pins 360. LUT cards keep their authored 2.66 mm/s first anchor - an anchor below the unit step is harmless and the curves are field-rated as they are.

**A pen-aim control plane for competitive FPS.** One Windows app that makes a drawing tablet a purpose-built aiming device: it authors, verifies, and applies complete aim builds across OpenTabletDriver and RawAccel, with its own measurement science, its own OTD filter plugins, and a rule engine that knows the difference between a measured result and a nice idea.

- **Rig:** Wacom One 14 (DTC-141) → OpenTabletDriver (relative / VMulti) → RawAccel → game. 360 Hz reports, 0.01 mm units.
- **App:** WinForms .NET 8, built SDK-less via portable Roslyn (`build.ps1`). Portable folder on the Desktop, double-click `AimForge.exe`. Idle footprint ~0 CPU, ~60 MB.
- **Anti-cheat posture:** the WHQL-signed drivers (`rawaccel.sys`, `vmulti.sys`) are never opened or modified. RawAccel is driven only through its own `writer.exe`; OTD only through the stock daemon's official `Console.exe` RPC. AimForge replaces the *front-ends*, never the drivers. The doctor verifies both driver signatures (WinVerifyTrust + catalog).

---

## What it does

Pick a game → pick a role card → **Apply to drivers**. One click writes the RawAccel curve (LUT or classic), snap, Y/X, rotation, output DPI, the OTD relative sensitivity (px/mm), reset time, hover policy, and the complete filter plan — then **verifies by reading it back**: RawAccel field by field (a mismatch restores its backup), OTD through the daemon's own `getfilters` (px/mm, the hover window, the stabilizer's key properties, every game-filter and Cadence Lock property). If the daemon does not take the build, or the curve's engine is not where the apply put it, RawAccel is rolled back too, so the curve is never live in both drivers or in neither; any other OTD property mismatch is logged loudly. Nothing is ever assumed applied; the project learned that lesson the hard way (both writers can fail silently).

Around that core:

- **Live curve canvas** — gain vs pen speed with zone landmarks (1-unit / tap / track / flick), classic curves rendered via their exact LUT equivalent, ghost comparison against the baseline.
- **Measurement engine** (`Measure.cs`) — a deterministic simulator of the whole chain (tablet quantisation, report rate, the card's own game filters, RawAccel's fractional accumulator) that recomputes every card's numbers on your actual rig: hold steadiness, micro-aim fidelity (settle-window average), onset (directional creep), click-skid, 180° travel, flick spread. `--audit` dumps all of it.
- **Filter catalog** — discovers every OTD filter on the machine (19 registered, 16 plugin folders, explicit folder→id map) and classifies each into latency tiers T0–T5 with a policy note.
- **Rule engine** (`RolePolicy.cs`) — role-based latency law: Master/Baseline/Turbo/Tapped builds hard-fail above T2; measured overrules exist only as *named exceptions carrying evidence ids*.
- **Evidence system** — every "measure curve" press mints a JSON artifact; every rule exception cites one. Claims without artifacts are marked pending and say so.
- **Doctor** — driver signatures, daemon health (including the elevated-pipe lockout), live filter chain with tiers, conflicts, GUI-stomp detection, tablet response watchdog.
- **First-party OTD plugins** — the Coherence Stabilizer family and the AimForge Game Filters (below).
- **Full tuner** — the companion HTML app (also a claude.ai artifact) where every preset is authored; `presets.json` exported from it is the app's single source of truth.

Hotkeys: `Ctrl+Enter` apply · `Ctrl+D` redetect tablet (restarts the daemon only when the tablet is absent) · `Ctrl+Tab` A/B the last two applied builds · `F5` refresh live readout.

---

## The physics this project established

Everything below was **measured before it was believed**, most of it on a deterministic sim quantised to the tablet's real 0.01 mm lattice, and several results overturned earlier advice — those corrections are part of the record.

### The information limits
- The smallest speed the tablet can express is **1 unit/report = 3.60 mm/s**. Tremor (peak ~1.9 mm/s) and deliberate micro-aim (~1.1 mm/s) both live *below* it — at the report level they are the same event, so **no speed-keyed curve can separate them**. Separating them takes a different signal (direction → the Coherence Stabilizer) .
- The musket **click-skid** (pressing the nib swings the pen's coil ~0.33 mm at ~37 mm/s) is straight, fast, and large — indistinguishable from a deliberate micro-adjust in the position stream. Only **pressure** separates them → the Tap Anchor (pressure-gated pin, measured 0.265 → 0.000 mm, bit-exact off the click).
- **Flick spread**: the same intended 30 mm flick executed at different tempos lands different angles when flick speeds sit on an accel ramp. This metric (divergence % across 100/150/220 ms) is what "massive jumps in flicks" turned out to be.

### The field laws (each one overturned a plausible theory)
1. **Stability lives in the base, speed lives in the accel.** The user's own BO6 config — 57 px/mm, 37.70 cm/360, classic accel 0.105 / cap 3.6 / offset 0.5 — was field-rated "the most stable I've had" while the sim scored its hold at −17.5% (266 Hz; −18.5% at the measured 360 Hz). The slow base makes the same tremor 40% fewer degrees; the ramp restores fast movement.
2. **Gain continuity beats gain unity.** Accel *drift* is predictable and trainable; gain *flips* at knees and gear boundaries never are (measured: 0.044 mm track wobble on the continuous curve vs 0.142 on a gear-shift curve — the source of a real field jitter complaint in Rivals).
3. **Unity below the offset.** Input offset 0.5 counts/ms = 8.8 mm/s of pen: micro-adjustments pass at exactly 1.00× (measured 102% at 266 Hz; the corrected settle-window probe reads 99% at 360 Hz).
4. **Sub-unity floors are felt as latency — even when they measure free.** A 0.90 floor recovering by 15 mm/s measured hold −17.5 → −2.6% with micro and onset unchanged, shipped, and was field-rated "kinda high latency feeling" — the second time a floor produced that feeling despite clean numbers (Feather Deep era was the first). Retired 2026-08-29. The floor attenuates the *gain* of every correction's first movement; dead-time metrics cannot see it. To widen the protected center, raise the **offset** (measured latency-free) — never lower the floor.
5. **Early saturation makes flicks consistent.** A steep continuous ramp whose cap lands *below* committed flick speed (Breakpoint's at 303 mm/s) puts every real flick on the flat cap — snap and consistency rise together (Breakpoint: 180 in 41.0 mm at 13.3% committed flick spread vs the baseline's 58.4 mm at 30.7%).
6. **Angle snapping 9–12° is right for a pen** (memoryless, zero lag, cone sized by the *slowest* turn) — a correction of earlier "set it to 0" advice, forced by a field result and confirmed by measurement.
7. **In dive games, tracking and flick speeds overlap** (Rivals tracking runs 140–200 mm/s) — no speed-keyed curve serves both; the resolution is card choice per playstyle, not a cleverer knee.
8. **Onset dead time is a quantisation problem already at its floor** once the low end is unity (two reports, 5.6 ms, on the corrected creep probe at 360 Hz) — the fine 90 px/mm grid buys nothing further and slightly hurts micro.

### The graveyard (negative results, kept on purpose)
- **RawAccel input-speed EMA on the pen (2026-10-11, `ev-20261011-pen-speed-ema`):** at most about 30% less average gain noise, no change to the worst-report spike, and a flick that starts at the wrong gain. Cadence Lock does the job at zero lag. See `RESEARCH.md`.
Rejected by measurement and documented so they are never rebuilt: the 2-unit-step discriminator (amplified tremor), Micro-Boost (125% overshoot), Tremor Notch (−279% hold), Track Rails on curves (up to 1.0 mm lag), the escape detector (twice), subtractive tremor cancellation (WFLC), the lead turn-gate, gear-shift curves in tracking games, a flick state machine (flick onset ≡ track-acquisition onset, causally), Temporal Resampler and the interpolator class generally (every field glitch traced there), and **rest deadzones in relative mode** (2026-09-16: the Valorant/Apex/Rivals Masters delivered 3–7% of a micro-correction and a 139 ms onset through the plan — retired).

---

## The preset roster (63 cards)

BO6 Original, the Breakpoints and the character cards share the **BO6 baseline** physics: 57 px/mm, 37.70 cm/360, snap 9°, Y/X 0.789, reset 80 ms, HDL 87. Breakpoint Wide is the exception, at your field-rated 78.95 cm/360. Since 2026-10-23 the game families no longer copy that physics; each game sits in its own pro range (see `GAME_FAMILIES.md`). Every card prints its in-game sens from the game's K.

- **BO6 Original** — the baseline itself, byte-for-byte (classic 0.105 / 3.6 / 0.5). The field verdict card.
- **Breakpoint** — the flick flagship: eff-14 ramp to cap 5.0, saturating below flick speed. **Breakpoint Wide** — the same curve at 78.95 cm/360 (the Finals field verdict). **Breakpoint Slow Center** — the same with the unity pocket widened to 12.3 mm/s by offset (v2; the v1 floor was retired by field verdict).
- **Specific Characters** — nine hero cards (Rivals: Psylocke, Loki, White Fox, The Punisher, Hela; OW2: Soldier: 76, Emre, Illari, Freja), each chosen by the same rule in HeroLab on that hero's own fights. See `CHARACTER_CARDS.md`.
- **Per game, 6 lab-derived roles (8 games, 2026-10-23):** **Master** (pro median), **Precision** (slow end + Tap Anchor), **Tracker** (wide 1:1 band), **Flick** (short high cap), **Brawl** (fast end), plus one **Signature** for the game's own job (Operator, Longbow, Projectile, Skyward, Fieldwide, Zipline, Heavy, Sabre). All are classic curves with the floor at 1.00, onset in two reports and tier ≤T1, with no smoothing. The full table, sources and in-game notes are in `GAME_FAMILIES.md`. The old Baseline/Planted/Turbo/Tapped quads, the LUT Masters, the Low-Latency Breakpoint trios and the Lab wildcards were retired.
- **Reference:** Feather (the previous field-best era, preserved exactly) and True Raw (the honest flat control).

Standout measured numbers: the Rivals Master and Flick turn 180° in 38 mm; the Valorant Precision caps at 100 mm/s for a steady 88.6 mm 180; every family card reads micro 90–130% and a two-report (5.6 ms) onset.

---

## The filters

### Coherence Stabilizer (first-party plugin, 19 settings)
Separates tremor from intent by **directional coherence** (|EMA(Δ⃗)|/EMA(|Δ⃗|)) instead of displacement — no dead zone anywhere. Measured: up to 94.6% tremor removed on a hold, deliberate movement passed at 0.0000 mm lag, flicks bit-exact, ~20 ns/report. Carries:
- **Tap Anchor** — the pressure-gated click pin (the only feature in the project that adds a new *input*). Ships on the tap-fire roles (every Precision; Valorant and Holdfast Master, Flick and Signature) in exact-passthrough mode (hold 0): zero latency ever, only the pin runs.
- **Lead Sight** — decel-gated extrapolation attacking the ~9 ms downstream pipeline (display-time error 0.960 → 0.257 mm). No shipped card since 2026-10-23.
- Hold smoothing / Anchor / Settle Assist — the T3 stillness stack. No shipped card runs it since the wildcards were retired on 2026-10-23.

### AimForge Game Filters (first-party plugin, session 3)
One assembly, one personality per game, **pen signals only** — position, Δt, coherence; game-specificity is policy on those signals, never game memory. Master members are T0–T1 (a heading bias, a two-report brake — never a trail, never a smoother); Lab members are T3 and hard-blocked from strict roles. CoD's rail preserves 100.0% of along-axis travel while cutting orthogonal chatter to 0.65×, flicks bit-exact (re-minted at 360 Hz). Valorant's rest gate froze tremor-scale jitter to 0.000 mm with a same-report flush on peek jigs — but measured through the whole plan it also ate micro-aim, so the **Valorant, Apex and Rivals Masters were retired on 2026-09-16** (OFF in every plan). The kernel's two hard-won rules: the deadzone bypass demands *sustained* coherence (a single report always looks coherent), and turn-flushes are speed-gated (tremor is 180° reversals too).

### The latency tier law
T0 gates (HDL) → T1 state (pins, deadzones-at-rest) → T2 corrective (Reconstructor — inert on Wacom EMR) → T3 light smoothing → T4 interpolators → T5 prediction. **Strict roles live at ≤T2, enforced at Apply**, not in prose. Two antichatter filters, dual game personalities, T4 on a Master, Reconstructor-on-Wacom: all hard refusals.

---

## The engine (2026-09-07): Cadence Lock

Where the curve runs is now an apply-time choice. **RawAccel engine** (default): the curve is
written into RawAccel, which keys gain on `counts / arrival-time dt`. **Cadence Lock engine**:
the same curve (the driver's own classic formula natively, or the LUT, in mm/s) runs in the `AimForge.Filters.CadenceLock` OTD
filter on the pen's fixed 360 Hz clock — speed is `|delta| x cadence`, dt only ever rounds to a
whole number of reports — and RawAccel is written flat (`noaccel`; sens/Y/X/snap/rotation stay
there). T0, same-report output, nothing smoothed. Measured: a wall-clock engine hands the game
6 % per-report gain noise (worst 15 %) under +/-25 % arrival jitter and a 26 % spike on a
merged USB frame; Cadence Lock hands it 0.000 %. Both engines are verified by read-back on
apply and the Doctor's "engine pairing" row fails if the curve is ever live in both places or
neither. Full R&D note: `CADENCE_LOCK.md`. Field verdict pending.

## How trust is maintained

- `presets.json` (exported from the tuner) is the **single write path**; every derived number is recomputed, never stored.
- Applies are **transactions**: timestamped backups, real exit codes, RawAccel read back field by field with restore on mismatch, OTD read back through `getfilters` (hover window, every stabilizer property written, every game-filter, Nib Twin and Cadence Lock property), a cross-driver rollback of both drivers on ANY OTD mismatch or an unreadable chain (2026-10-11; the daemon goes back to the previous preset or its saved default), the window refusing to close mid-apply, and a tablet-response watchdog with one self-heal.
- Selftests (261 headless as of 2026-10-11; `./build.sh --test` runs them off Windows) pin every established number, every policy rule, every card's quoted numbers (the copy contract) and each strict card's micro-aim through its shipped plan, and drive the *shipping* filter math (the plugin core compiles into the app). The tuner has its own ~300-check harness including an independent JS port of the flick simulator.
- Known failure modes are handled by design: OTD's silent `applypreset`, the elevated-daemon pipe lockout (one-UAC fix), the stock GUI stomping applies (replaced by a shim; daemon autostarts at login), writer.exe's silent rejection.
- **Field beats sim, artifacts beat memory.** When a user report contradicted the test suite, the suite was missing a test case — that sentence is now project law, and it has been true every time.

---

## Files that matter

| Path | What |
|---|---|
| `C:\Users\Chippo\Desktop\AimForge\` | the deployed portable app (+ `evidence\`) |
| `...\GamingOptimizerPro\AimForge\` | source: `src\Core\*` (Curve, Measure, bridges, Doctor, FilterCatalog, RolePolicy, FilterPlan), `src\App\*`, `plugin\*` (game filters), `export-presets.js`, `build.ps1`, `package.ps1` |
| `...\GamingOptimizerPro\CoherenceStabilizer\` | the stabilizer plugin + every measurement harness this project ever ran |
| `D:\Pen`, `D:\RawAccel` | OTD portable (plugins in `userdata\Plugins`) and RawAccel |
| Tuner artifact | https://claude.ai/code/artifact/1dad1027-49ec-44df-a2d5-3ea455a63538 |

*Generated 2026-08-28 from the project record; revised 2026-09-16 after the full audit. Every number in this document has a measurement behind it; the ones that don't say "pending".*
