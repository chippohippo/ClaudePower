# Experimental modes: Nib Twin, Intent Speed, Reversal Carry

Three apply-time modes, like the engine choice and the mouse mirror. You set them in the Builds tab, they are remembered in `xp.txt`, and they are never written into `presets.json`. All are off by default, and switched off they are bit-identical to the plain chain (selftest-pinned). **Field verdicts are pending on all three.**

This page also covers a fix to the shipped Tap Anchor that applies to every card, whatever the modes: the **moving-tap fade**.

Evidence and tools:
- `evidence/ev-20260924-nib-twin.json` (`AimForge --nib-evidence`; `--nib-lab [card]` measures any card)
- `evidence/ev-20260924-xp-toggles.json` (`--xp-evidence`; `--xp-lab [card]`)

---

## 1. Nib Twin — "Nib twin [T1, XP]" + "calibrate nib (20 taps)"

**The duel it wins.** You fire by tapping the tip. Pressing the nib moves the reported position: the tilted nib compresses and the coil swings about 0.3 mm (the Tap Anchor's measured skid). The Tap Anchor pins that swing only while the pen is still; by design it lets go the moment your hand travels. So every shot fired while you are moving carries the swing into the camera, right at the trigger. That covers a strafing spray, a flick-shot and a tracking tap.

A mouse click has no aim skid, so a mouse user never pays this and a pen user always did. Nib Twin brings the pen to mouse parity at the trigger, moving or still, while keeping what the pen already has (fine finger control, hover aiming).

**Mechanism.** The swing is mechanically locked to the pressure ramp, and pressure is the one signal the project's physics says separates click-caused motion from intent. So a calibrated feed-forward model removes it on the same report:
- It computes `swing(p) = S · min(1, (p / p_full)^γ)`.
- It subtracts the swing's change from each report's motion, through a ledger that:
  - is spent only against the pen's own reported motion, so a still report never moves the camera and no report moves more than twice what the pen did;
  - is capped at 1.1 × |S|;
  - nets to zero over a press-and-release;
  - is dropped 150 ms after the pressure is gone.
- It never touches gain. In hover (pressure 0, where all your aiming happens) it is exact passthrough.

**It is its own filter, first in the chain**, ahead of the Coherence Stabilizer, the game filters and Cadence Lock. Everything downstream sees your hand without the swing, so it works on **either engine** (RawAccel or Cadence Lock). The first prototype ran inside Cadence Lock, after the Tap Anchor. It then subtracted skid the pin had already held back, which made rest one-taps 0.05° worse (measured). That is why it moved.

**Tier and roles.** T1: state only, no temporal cost. It is **allowed on every role**, because it never changes gain and never moves the camera without pen motion.

**Calibration** (required; the apply refuses the twin without a valid one):
1. Apply your build once with this version, so `lastapply.json` records the whole build. The calibration always runs on that LIVE build, never on the card you are browsing.
2. Builds tab → **calibrate nib (20 taps)** (or `AimForge --nib-calibrate`). AimForge re-applies your live build with the twin's press log on, through the same gate as every apply. The log records the raw pen before any other filter.
3. Hold the pen still in hover and tap the tip about 20 times, about one tap a second, the way you fire.
4. The fit keeps only settled taps with no lift or gap. It finds S, the knee `p_full` (the pressure where the swing completes, fitted from 0.10 up to your hardest taps), γ and a 0–2 report lag by least squares. Then it re-applies your live build without the log. If the twin was already on, the new calibration goes live with it.

It refuses a calibration with:
- R² below 0.8, taken over the reports where the model predicts swing (not the whole hold);
- |S| below 0.1 mm (an upright grip has no skid, and the twin would only inject one);
- |S| above 0.6 mm;
- fewer than 12 settled taps.

The result is saved in `nibtwin.json`. `--nib-fit <log> [--save]` refits a log offline.

The press log can never stay on quietly. A failed restore falls back to a log-off step, Ctrl+C in the CLI cancels the wait instead of killing the process, and a forced exit from the window switches it off first. The Doctor fails a "nib press log off" row if it is still on.

**Measured.** These numbers come from a model of the skid (the project's tapdiag model, not your pen yet): 0.30 mm toward (−0.8, 0.6), saturating at 30% pressure, 15% hand flexion. They run through the shipping twin, stabilizer and Cadence cores on the BO6 curve, in degrees of error against your hand's own aim (re-measured 2026-09-24 after the second review):

| | pin without the fade | pin with the moving-tap fade | **fade + Nib Twin** |
|---|---|---|---|
| strafing spray, first 150 ms | 0.43 | 0.54 | **0.12** |
| after the spray | 0.62 | 0.24 | **0.13** |
| flick-shot, at the click | 0.051 | 0.051 | **0.022** |
| rest one-tap (at the click / peak) | 0.106 / 0.118 | 0.106 / 0.118 | **0.106 / 0.118** |
| rest one-tap, the swing alone (peak / left) | 0.000 / 0.000 | 0.000 / 0.000 | 0.000 / 0.000 (no pin: 0.34 / 0.03) |
| taps while moving at 30–141 mm/s, left afterwards (both directions) | 0.22–0.75 | 0.10–0.12 | **0.05–0.09** |

On Breakpoint, the strafing spray goes from 0.90° to 0.24°. Robustness checks, all still never worse than no twin (spray 0.54°):
- a calibration 40% off in size: 0.21–0.27°;
- a calibration 25° off in angle: 0.26–0.27°;
- taps at 0.5×–2× the calibrated force: 0.14–0.15°;
- a swing that trails the pressure by 2 reports, calibrated by the shipping fit: 0.14° (no twin 0.44°).

"The swing alone" subtracts a run with the same hand flexion but no swing, on the same seed. The plain rest columns count the hand's approach drift as aim, which charges the pin for rewinding it by design. The 0.05–0.09° left after moving taps is the modelled hand flexion priced by the curve. That is real hand motion that does not spring back, so no pressure model can remove it. Per travel direction the twin can read higher than no twin, up to 0.10° at 141 mm/s on BO6, because without it the curve's pricing of the swing's return happens to cancel the flexion in one direction; a selftest pins it to the flexion bound.

The twin also handles a report stall of 50–80 ms on the press or release (the swing that crossed it leaves with the passed delta), a merged USB frame, a queued burst of back-to-back reports, and a lift with the tip still down. Each was measured leaving part or all of a swing in the camera before the second and third reviews. AimForge pins the pen's report rate into the twin (`NominalHz`, the build's pen Hz), so it can tell a merged frame from a normal report.

**Fixed on 2026-09-24 after the second review.** With a 2-report lag the twin took a two-report difference and removed the swing twice (spray 0.68° against 0.54° with no twin). The fit pinned the knee at the median tap peak, so firm tappers could not calibrate, and one lift refused a whole session. The calibration re-applied the card you were browsing, skipped the apply gate, and could leave the press log on.

**Limits.** Every number above is model-based until your calibration log replaces the skid model. If you change your grip, recalibrate: a stale calibration on an upright grip injects the swing it expected. The Doctor's "nib twin calibration" row shows the calibration's age and its per-tap spread.

---

## 2. The moving-tap fade (Tap Anchor fix, every stabilizer card, not a toggle)

The Tap Anchor pins the cursor from the moment you press. If your hand is moving, it withholds your own travel and hands it back in a short burst once you have moved past Tap Break Distance. At 100 mm/s that is about 4 ms of holding. Any acceleration curve prices that burst at burst speed and leaves a **permanent overshoot** versus your hand. The shipped pin measured +0.12 to +0.76° on BO6 and up to +1.77° on Breakpoint, for taps at 30–141 mm/s; a flat curve showed 0.000°. An independent judge probe reproduced it. For a moving tap, the pin was pure cost.

The fix is a new stabilizer property, `TapMoveFade`, which AimForge writes as 1 on every card. The pin's strength now fades with your hand's smoothed speed **before the press**, read on the last report with no pressure: full below 12 mm/s, none above 30 mm/s. So:
- **Rest one-taps keep the pin.** This is the case it was built and field-rated for. The stabilizer's own tests pin it for 6–12 ms presses and 0.30–0.50 mm skids, and so does NibLab at 2× tap force and with a 0.35 mm approach.
- **Moving taps are no longer held.** The overshoot drops to 0.000° at 30–141 mm/s.

**Changed on 2026-09-24 after review.** The first version read the speed of the arm report itself, which already carries the click's swing, with a knee at 8 mm/s. A crisp 6–8 ms press then counted as moving and lost most of the pin. The 12–30 mm/s band was chosen by a sweep against 8–25, 10–25, 12–25 and 14–30. Its costs:
- a 0.45 mm settling approach, the far edge of "rest", keeps 84% of the pin (+0.029 mm post-click);
- taps made while moving at 20–25 mm/s keep a little pin (0.056° / 0.021° on BO6, against the legacy pin's 0.043° / 0.082°);
- a flick-shot's follow-up tap reads 0.058° instead of 0.036° without the twin, because the first tap's skid now passes through. With the twin it is 0.035°;
- a tap fired within about 15 ms of STARTING a move still reads as rest, because the hand has no speed yet, and gets the full pin.

Two more Tap Anchor fixes landed on 2026-09-25 (second and third reviews), for every stabilizer card: a flick fired right after a tap is no longer dragged back toward the tap's anchor (5.6–8.0° of permanent camera error on the tap cards before), and the break releases at the card's own distance in every direction while the rewind no longer uses it up (on the 25 ms / 0.45 mm cards a rest tap with a 0.15–0.35 mm settle used to break the pin). The Coherence Stabilizer README has the details.

The installed Coherence Stabilizer must carry the property. getfilters echoes a setting the plugin ignores, so AimForge reads the installed DLL's metadata instead: the Doctor's "stabilizer has the moving-tap fade" row, and the apply's note. Install with `CoherenceStabilizer\build.ps1 -Install`, then restart the OTD daemon.

---

## 3. Intent Speed — "Intent speed [T1, XP]" (needs Cadence Lock)

The curve takes its gain from your coherent velocity |EMA(Δ⃗/dt)| (τ 6 ms) instead of this report's speed. That cancels lattice alternation (at 20 mm/s the reports alternate 5 and 6 units, a ±9% speed swing) and sideways tremor. The position still moves on the same report.

**Changed on 2026-09-24 after review.** The chosen speed is now clamped to within one lattice unit per report of the raw speed. Unclamped, the lag of the smoothing trailed a 250 mm/s track by up to 1.2 mm and over-delivered every stop, and the old "it never adds motion" claim was false. It is allowed on every role.

**Measured:**
- Ramp-tracking gain noise: 0.56–0.75% → 0.17–0.22% on BO6, and 1.3–1.6% → 0.36–0.46% on Breakpoint.
- A 90° turn's largest one-report gain step is at most 1.12× plain (pinned at 1.25×).
- A 250 mm/s track trails plain by at most 0.34 mm.
- Micro-aim is identical; flicks land within 0.05%.

## 4. Reversal Carry — "Reversal carry [T1, XP, Lab-only]" + carry ms (10–80; needs Cadence Lock)

At a strafe turnaround the curve drops to unity, so the new leg starts sticky. Carry holds the previous leg's gain (remembered over about 60 ms) as a floor that fades over the carry window.

**Changed on 2026-09-24 after review.** The first version also armed on the settle after a tracking stop, on rest tremor, on the corrections after 10–20 mm flicks and across gaps (+20% to +120% on those). It also stepped the gain up in one report. Now:
- It arms only on a **strafe rhythm**: a turnaround out of a tracking-band leg, at most 600 ms after the previous one.
- The floor scales with the new leg's own speed (unity at 10 mm/s, full by 25 mm/s).
- The band tapers instead of cutting off.
- Its state is cleared on every gap.

It is Lab-only (Planted, Lab and Reference cards), because it still raises gain at low speed after a turnaround.

**Measured on breakslow:** the new leg's first 40 ms gain 1.137 → 1.202, travel +5%. A stop-and-settle, a gapped stroke and flicks from rest are unchanged (selftest-pinned).

---

## Apply and verify
- **Nib Twin:** the filter goes first in the chain with `Twin`, `SkidXmm/Ymm`, `SkidFullPressure`, `SkidGamma`, `SkidLagReports` and `Probe`, all read back through `getfilters`. The apply refuses it without a valid calibration, or while the running daemon has not loaded the plugin build.
- **Intent Speed / Reversal Carry:** written into the Cadence Lock plan and read back. An engine mismatch rolls both drivers back.
- **The Doctor:**
  - "plugins loaded by the daemon" flags a plugin installed after the daemon started;
  - "stabilizer has the moving-tap fade" reads the installed stabilizer's metadata;
  - "tablet connected" asks Windows whether the tablet's USB device is present;
  - "nib twin calibration" shows the calibration's age and spread;
  - the XP row fails when the live twin runs an older calibration than `nibtwin.json`;
  - "nib press log off" asks the daemon, the AimForge preset and the saved settings, and fails when a calibration left the log on anywhere. A daemon restart never re-applies a preset with the log on;
  - "live = last apply" compares the drivers with what the last apply wrote. A live hover push updates the record.
- **The apply gate** judges the stabilizer by the card being written. A Lead Sight entry left saved shows as T5 in the live chain but no longer refuses Master cards.
- **Ctrl+Tab** replays the applied build together with its engine and modes. Applying the same card with a mode off and then on is now an A/B pair.

## Field test
1. Plug the tablet in. Restart the OTD daemon (tray → Restart OTD daemon), which loads both rebuilt plugins.
2. Apply your usual card. This also records the whole build for the calibration.
3. Run **calibrate nib** and read the result line (swing, angle, knee, lag, R²).
4. Tick **Nib twin** and apply. Test a strafe bot with an automatic weapon held through AD reversals: do the first bullets stay on the head? Then test a flick-shot plus follow-up, and rest one-taps (these must feel no worse).
5. Ctrl+Tab against the same card with the twin off, and report a verdict.
