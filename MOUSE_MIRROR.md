# Mouse Mirror — the pen build on your mouse

*Feature record, 2026-09-14. Design adversarially verified (four lenses) against RawAccel v1.7.0 source before implementation; field verdict: pending (yours).*

## What it does

With **mirror to mouse via RawAccel** ticked in the Builds tab, every apply also writes a second
RawAccel profile, `AimForge Mouse`, built from the card being applied, and binds your Pulsar
(all three of its RawAccel device entries: the 8K dongle's mouse collection, the wired
interface, and the dongle's boot-mouse interface, which are one physical mouse) to it. The
mouse then gets, through RawAccel:

- **the same curve against sensor speed** (the driver's classic formula, or the card's LUT),
- **the same cm/360 at the same in-game sensitivity number** (57.00 counts per mm of travel on both devices at 1600 DPI, so you never change a game setting when you swap devices),
- **the same angle snapping** and **the same Y/X ratio**.

Untick and apply (or `--mouse off`) and the mouse goes back to raw: the three entries are
disabled again exactly as they were, the profile is removed, and the removal is verified.

Nothing in `presets.json` changes. The mirror is an apply-time mode like the engine choice,
persisted in `mouse.txt` beside the app, and rebuilt on **every** apply while it is on so the
mouse can never be left on a previous card's curve.

## The transform

```
cpm_pen   = px/mm (OTD)                    57
cpm_mouse = DPI / 25.4                     62.992  (1600 DPI)
r         = cpm_mouse / cpm_pen            1.1051
mult_m    = mult_pen / r                   0.9049  → RawAccel "Output DPI" 904.875
classic:  offset × r, accel ÷ r, cap unchanged      (exact: the driver's a^(p−1)(x−off)^p / x is
                                                     invariant under x→rx, off→r·off, a→a/r)
LUT:      x × r (written at 6 decimals), gain unchanged
every other counts/ms field × r; 1/speed fields ÷ r; degrees and ratios unchanged
```

Worked for Breakpoint (0.246 / 0.5 / cap 5): mouse offset 0.5526, accel 0.2226, cap 5. Gain at
87.7 mm/s is 1.9963 on both devices, to 1e-12.

The mouse profile is built from the **card**, never from the live pen profile, so it always
carries the curve even when the pen runs Cadence Lock (where RawAccel's pen profile is flat).

## The one deliberate difference: a 1 ms speed estimate

At 1600 DPI and 8000 Hz a packet carries 0–2 counts, and RawAccel estimates speed per packet
as counts ÷ measured time. That estimate is quantised to multiples of 8 counts/ms and swings
about ±30% around the knees of the curve, where the pen (57 counts/mm, 360 Hz, 8–16 counts per
report) sits within ±5%. RawAccel 1.7's **input-speed half-life** exists for exactly this: it is a
linear EMA on the *speed handed to the curve only*; the output vector is never averaged, so it
adds no cursor latency (the Guide says the same). The mouse profile gets **1.0 ms**, derived from
the pen: an EMA whose mean information age equals half a pen report interval. It averages
about eight 8 kHz packets and is editable in the Builds tab (`speed EMA ms`; 0 = raw packets).
The pen profile keeps 0.

## Where "matched" stops being exact

1. **Per-packet noise.** The mean output per mm of sensor travel is identical; the per-packet realisation on the mouse is noisier (about ±10% with the 1 ms EMA at 100 mm/s, ±30% without). Knees are slightly rounded on the mouse.
2. **Angle snapping at 8 kHz.** Snapping acts on each packet's integer vector; a 1–2 count packet can only point at 0°, 26.6°, 45°, 63.4° or 90°, so a 9° snap does nothing below ~3 counts per packet (~380 mm/s at 8 kHz, ~48 mm/s at 1 kHz). The pen's snap is active from ~20 mm/s. **Running the dongle at 1000–2000 Hz gives the closest match**; AimForge cannot set that.
3. **Sensor DPI is your word.** AimForge reads the pen's px/mm from OTD but cannot read the Pulsar's sensor step. If the mouse is not actually at the typed DPI, everything is off by that ratio and no read-back can see it. Check: RawAccel GUI → Last Mouse Move, a 10 cm swipe should show ~630 counts at 1600.
4. **Hand vs sensor.** The identity is per mm of *sensor* travel. The pen's sensor is the tip under your fingers; the mouse's is under your palm. The same arm motion produces different sensor speeds. This is the largest feel difference and no transform removes it.
5. **OTD-only features stay pen-only:** Lead Sight, hold smoothing, the Coherence Stabilizer's tap anchor, and Cadence Lock's fixed-clock evaluation. The mouse always runs in RawAccel from arrival-time dt. The readout says `OTD-only extras not mirrored` on such cards.
6. **Unverified in the field:** whether the X2 CL streams null-motion reports at 8 kHz (which would pin slow-speed estimates at 8 counts/ms and no smoothing could fix). Watch the RawAccel GUI's Last Mouse Move dots at a slow, steady speed; they should spread across the low-speed region, not pile up.

## Safety

- Only entries whose id starts with an allowlisted VID&PID prefix are bound (seeded from RawAccel's own device list: `HID\VID_3710&PID_5406`, `HID\VID_3710&PID_3414`). Anything Wacom (VID_056A), anything named VMulti/Pentablet/Wacom/ugee/hanvon, and anything with the VMulti id shape `HID\hid&…` is refused as a pen. A ugee tablet once registered on this machine with a generic name, which is why it is an allowlist and not a name check.
- If profiles[0] is named `AimForge Mouse`, the WHOLE apply (pen and OTD included) is refused before anything is written; reorder the profiles in the RawAccel GUI.
- Pre-flight refuses the mirror (pen apply still proceeds, mouse goes raw) if: RawAccel is not 1.7; more than one profile carries that name; a bound entry has RawAccel's own DPI normalisation set or "constant time interval" on; the mouse multiplier leaves 0.05–10; DPI leaves 100–30000; a LUT x would not increase after rounding; or RawAccel gained an accel-block field AimForge cannot classify by dimension.
- **Write transaction (new, applies to the pen too):** backup → write → writer.exe → read-back of every owned field on both profiles and all bindings. Since 2026-09-16 that read-back also covers `Gain / Velocity` (pinned to the legacy form on both profiles), exponent, cap mode, Output DPI, rotation, the pen's speed EMAs and the mouse's Input Speed Cap; a polling-rate override on a bound mouse is refused. On *any* failure the backup is restored **and writer.exe is re-run on it**, so the driver and the file agree again. The old code left rejected values on disk after a timeout or non-zero exit.
- Tray menu → **Restore last RawAccel backup** is the keyboard-reachable panic path.
- Doctor rows: `mouse mirror pairing`, `mouse mirror consistency`, `no dangling RawAccel profile refs`, `RawAccel GUI not running`.

## Controls

Builds tab, under the engine dials: the toggle, `mouse DPI` (sensor step as set on the mouse),
`speed EMA ms`, `mouse Y/X` (0 = mirror the pen's). A readout line states what the mouse gets:

```
Mouse: matched · assumes 1600 DPI · 3 devices · sens 0.905 → 57.0 counts/mm = pen · curve ×1.105 on the speed axis · snap 9° · Y/X 0.789 · speed EMA 1 ms
```

Command line: `--apply <id> [--mouse on|off] [--mouse-dpi n] [--mouse-halflife ms] [--mouse-yx r|pen] [--mouse-prefixes a|b]`,
`--mouse on|off` (mouse only: rebuilds the mouse profile from the last applied card against the pen as it is live, never touches the pen profile or OTD, verified), `--mouse-devices` (classification and live state).

## How to test

1. It is live now on Breakpoint. Move the mouse on the desktop: 57 counts/mm, 9° snap, Y/X 0.789 — it will feel like the pen's base with the pen's flick ramp.
2. In a game, keep the same in-game sens you use for the pen. Hipfire flick distance should match the pen's per mm of travel.
3. If the accel band feels grainy, try `speed EMA ms` 1.5–2.0, or set the dongle to 1000 Hz for the session.
4. Untick and apply to go back to raw. The Doctor tells you if the two ever disagree.

## Post-ship review (2026-09-14)

A four-lens code review of the shipped feature found and this build fixes:

- **Blocker:** `--mouse on|off` re-applied the pen profile with the default engine, which would double-accelerate a Cadence Lock rig. It is now mouse-only (`MirrorOn`/`MirrorOff`), and the pen profile is verified byte-identical afterwards.
- A mouse.txt value outside the control ranges crashed the GUI at launch. Values are clamped on load and in the controls; CLI flags are range-checked before anything is saved.
- `--mouse on` could rebuild from a stale card. The last applied card is now recorded on every apply, mirrored or not.
- State is saved only after a successful, non-dry apply.
- The readout reads RawAccel's live file, so it says when the mode and RawAccel disagree instead of claiming "matched".
- Read-back now covers the vertical accel block; an unrelated stale device entry no longer rolls back a pen apply.
- Applies cannot overlap (re-entrancy guard + a commit lock), and backups never overwrite each other.
- An older plugin still loaded in the daemon falls back to an 8-point table of the driver formula (within 3%) instead of running flat, and the apply log says to restart the daemon.
- Restore treats a rejected writer run as a failure and reports what is live; the pen profile must be first or the apply refuses with instructions; stale disabled bindings are cleaned.

Deliberately not changed: old RawAccel backups are never pruned automatically, and the DPI safety band stays 0.05-10 (no band can catch a mistyped DPI, because the mouse's effective desktop DPI always equals the pen's).

