# Cadence Lock — the curve on the pen's own clock

> **Update 2026-09-16 (audit):** a merged gap is now priced over every report it spans up to 50 ms (the old flat cap of 8 reports read 22–50 ms gaps up to 2.25× fast); the pre-flight refuses the engine BEFORE RawAccel is flattened when the plugin is missing; the evidence artifact is re-minted with the driver formula as the reference gain (the old file serialized empty results). Numbers in §5 are the re-minted ones.

> **Correction 2026-09-14 (ev-20260914-classic-formula):** classic cards no longer go through the 4-point 'exact LUT equivalent' - that table was built on a linear model of RawAccel's classic mode, and the driver's formula is `1 + a(v-off)^2/v`. The plugin (v1.2) evaluates classic cards natively with the driver's own formula, exact to 1e-7, so the curve is identical on both engines and only the time base differs, as the design intended.

> **Correction 2026-09-07 (ev-20260907-pen-rate):** the pen reports at **360 Hz**, not 266. Measured on the rig with the Cadence Lock probe (360.2 Hz over 16k reports). Consequences: the 1-unit step is **3.60 mm/s** (was quoted 2.66), one report is **2.78 ms** (dead-time figures quoted as 3.8 ms are 2.8 ms), and Cadence Lock pins 360. LUT cards keep their authored 2.66 mm/s first anchor - an anchor below the unit step is harmless and the curves are field-rated as they are.

*R&D note and feature record, 2026-09-07. Field verdict: pending (yours).*

## 1. What was asked

Make the pen feel great at the lowest possible latency, with long left-right-and-back
tracking as the reference scenario, by looking at what actually moved mouse aim forward and
building the one thing that transfers best to a drawing tablet.

## 2. What moved mice forward (and what each one really fixed)

| Mouse breakthrough | The thing it actually fixed | Transfers to the pen? |
|---|---|---|
| Optical sensors, then flawless sensors (no accel/prediction in firmware) | The *input* stopped lying: 1 count = 1 unit of hand travel, always | Already true here: 0.01 mm units, absolute position |
| Angle snapping / sensor smoothing **off** | Removed firmware filtering that added delay and altered intent | Already true: Wacom EMR has no firmware EMA (Reconstructor has nothing to undo) |
| 1000 Hz, then 4/8 kHz polling | Less time between the hand moving and the OS knowing | **No** — the digitizer samples at a fixed 360 Hz. Nothing downstream can add samples honestly |
| Motion Sync (Razer) | Aligned the sensor read to the USB poll so every report carried one *equal* slice of time | **Yes, and better** — the pen's sample clock *is* the slice; see §3 |
| Low-latency USB / MCU paths | Shaved sub-ms off delivery | Delivery jitter is exactly what §3 makes irrelevant |
| RawAccel in the kernel | Speed-keyed gain with fractional carry, no cursor-level hack | Used here, through its official writer; but see §3 for what it cannot know |

The pattern: every real advance either **stopped the input from lying** or **made the time
base honest**. Nothing that *added* processing between hand and game ever survived a field
test — this project re-proved that four separate times (Temporal Resampler, Radial Follow,
the 0.90 floor, the CoD Lab EMA).

## 3. The thing a mouse driver cannot know, and a pen does

A gain curve needs the hand's **speed**. A mouse driver has no clock in the sensor, so it
divides a count delta by **the time between reports as they arrive at the driver**. On this
chain that arrival time is:

```
digitizer sample clock (fixed, 360 Hz)
  → USB delivery      (jitter)
  → OTD input thread  (jitter)
  → VMulti injection  (jitter)
  → rawaccel.sys timestamps the arrival   ← speed = counts / THIS dt
```

Every millisecond of jitter in that path becomes a **speed error**, and the curve turns a speed
error into a **gain error on that single report**. RawAccel's own guide names the symptom:
*"cursor stutters that only occur with acceleration enabled"* and offers a fixed polling-rate
assumption as the workaround. During a long track at 140 mm/s on a Rivals/Breakpoint curve the
hand is sitting **on the ramp** of the curve, where gain is most sensitive to speed — so this is
felt precisely in the scenario you named, and it feels like *texture* or *lag* because
successive reports are scaled by slightly different amounts for the same hand motion.

The pen has what no mouse has: **the sample clock is fixed and the position is absolute.** The
true speed of any report is simply `|delta| × 360`, with no time measurement at all. That is
the whole idea:

> **Evaluate the curve in tablet space, on the pen's clock, before the relative conversion.
> Write RawAccel flat.**

## 4. What shipped

**`AimForge.Filters.CadenceLock`** — an OTD PreTransform filter in the AimForge Game Filters
plugin (v1.1 on 2026-09-07; v1.2 since 2026-09-14), last in the chain:

- Applies the build's curve (the *same* curve — classic cards natively with the driver's own
  formula, exact to 1e-7; LUT cards verbatim; authored mm/s → gain) to each report's
  delta. Output delta = input delta × gain(true speed), **on the same report**. Zero temporal
  cost; nothing is smoothed, held, interpolated or predicted (T0).
- Time enters **only as a whole number of reports**: `dt` is rounded to the nearest multiple
  of the cadence. A merged USB frame (two samples arriving as one) is priced as two reports of
  travel — which is what it is — instead of a 2× speed spike, over every report the gap spans up
  to 50 ms (a longer gap passes at unity).
- Cadence is **pinned from the catalogue** (`tablet.reportHz`, MEASURED 360.2 on the DTC-141) at
  apply. `NominalHz 0` switches to a running-mean estimator (the fallback, and the way to
  *verify* the pinned figure): `AimForge --apply <id> --engine cadence --pen-hz 0`, move the pen for
  ~10 s, run `AimForge --pen-rate`, then re-apply without `--pen-hz` to pin 360 again.
- Never snaps the output back onto the pen while OTD could still pass the jump (corrected 2026-09-16
  final review). OTD's relative mode discards a delta only when the gap exceeds its own reset delay, and
  a pen lift does not clear its last position, so the old 50 ms rebase threw the whole gain-built
  offset into the cursor on a 50–80 ms stall or a quick lift. Now the first report after a lift or a gap
  past 50 ms carries the hand's own delta at unity (exactly what OTD passes with no filter) and the
  output rebases onto the pen only after a gap past 1 s, longer than any reset AimForge writes.
- Accumulates in double precision; no float drift over a long session.

**AimForge**: a Builds-tab toggle **"Cadence Lock engine [T0]"** (remembered in `engine.txt`)
and `--apply <id> --engine cadence`. With it on, an apply writes RawAccel `noaccel` (sens
multiplier, Y/X, snapping and rotation stay in RawAccel, through writer.exe as always), enables
Cadence Lock with the curve, and **verifies both by read-back**. The live readout shows the
engine; the Doctor's new **engine pairing** row fails loudly if the curve is ever live in both
places (double acceleration) or in neither.

Nothing in `presets.json` changed. The engine is an apply-time choice, like px/mm.

## 5. Measured (evidence `ev-20260907-cadence-lock`, minted by `--cadence-evidence`)

30 mm peak-to-peak left-right track at 1.5 Hz (peak ≈140 mm/s, the Rivals tracking band),
6 s at 360 Hz on the 0.01 mm lattice, arrival timestamps jittered uniformly. Score: per-report
gain against the true pen-clock gain, in the 55–150 mm/s band.

| Stream | Wall-clock engine (RawAccel model) | Cadence Lock |
|---|---|---|
| BO6 curve, ±25 % jitter | gain noise **6.40 %**, worst single report **15.8 %** | **0.000 %** |
| Rivals Master, ±25 % jitter | 6.32 %, worst 15.6 % | 0.000 % |
| BO6 curve, ±10 % jitter | 2.45 %, worst 5.3 % | 0.000 % |
| Merged USB frame at 120 mm/s | **+26.6 %** gain spike on that report | 0.0 % |
| Output vs an ideal-clock run | — | identical to 0.00000 units |
| Auto-cadence fallback, ±25 % jitter (360 Hz stream) | — | 361.4 Hz estimate, 0.65 % noise incl. warm-up |

What is **not** measured: how much jitter your chain really has. The synthetic ±10–25 % brackets
the plausible range for a user-mode driver stack on a 2.78 ms interval; the field test is the
measurement.

## 6. How to test it

1. Restart AimForge (the Desktop copy is updated). The OTD daemon has been restarted so the
   v1.2 plugin is loaded.
2. Builds tab → tick **Cadence Lock engine [T0]** → apply your reference card (Breakpoint).
   The log must say `RawAccel: ... VERIFIED by read-back (noaccel/flat ...)` **and**
   `OTD: filter plan VERIFIED by read-back`. If read-back reports `Cadence Lock enabled`
   missing, the daemon has not loaded the plugin: tray > Restart OTD daemon (or `AimForge --daemon-restart`), then apply again - the failed apply has already rolled RawAccel back.
3. Same card, same session, A/B against the toggle off. The comparison is fair by construction:
   identical curve, identical rig; only *where* speed is measured differs.
4. Judge the one thing this changes: **texture during sustained tracking and reversals**.
   Flick distance, onset, micro-aim are mathematically identical (the selftest pins output
   delta = input delta × gain of the same curve).
5. If it feels wrong in *any* way, untick and apply — RawAccel gets its curve back and Cadence
   Lock is disabled, verified by read-back. The Doctor will tell you if the two ever disagree.

## 7. What this is not

- Not more samples. 360 Hz is the digitizer's truth; interpolating past it was field-rejected
  twice and stays rejected.
- Not prediction. Lead Sight remains Lab-only.
- Not a curve change. Every number on every card is untouched.
- Not a driver change. rawaccel.sys and vmulti.sys are the stock signed binaries; RawAccel is
  still driven only through its writer; OTD only through its Console RPC and a first-party
  plugin. No game process is read.

## 8. If the field says yes

The RawAccel engine stays as the default until you say otherwise; then the toggle default
flips, and the tuner's "exact LUT equivalent" readout becomes the primary view, because with
Cadence Lock every card *is* an mm/s LUT. The next candidate on the same principle: since
speed is now exact, the game filters' zone gates (Floor/Tap/Track landmarks) can be driven
from the engine's speed instead of re-deriving it from `dt`.
