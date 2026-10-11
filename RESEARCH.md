# Community research → AimForge (2026-10-11)

Three tracks:
- the osu! tablet community;
- people who play shooters with a pen (Kariyu, Star_Rain);
- the RawAccel and OpenTabletDriver communities.

Each finding is labelled:
- **[D]** documented by a tool's author or source code;
- **[C]** community consensus;
- **[A]** a single anecdote or press report.

**Field beats sim, artifacts beat memory:** nothing here changes a card without a measurement. Every idea below is adopted with evidence, refused with evidence, or marked pending.

**Limits of this pass:** opentabletdriver.net, osu.ppy.sh and the players' own channels did not resolve from the research sandbox. Two primary sources were read directly: RawAccel's source (master 53a7213) and OpenTabletDriver's source (v0.6.4.0). Everything else came through search summaries.

## What the shooter-tablet players did
- **Kariyu** [A]
  - Artist, osu! player and YouTuber. His challenge was "Pen to Immortal": Valorant Immortal after about 6 months on a pen tablet (TalkEsport). An earlier Dexerto piece put him at Diamond.
  - He rebound alt-fire / scope to **Alt**, because a pen has no right button.
  - Not found: hardware, driver, area/sensitivity, filters.
- **Star_Rain** [A]
  - Valorant on a pen and tablet, with the left hand on the keyboard. An ace / 1v4 clip went round Reddit (AFK Gaming).
  - Not found: settings or a handle.
- **WarOwl** [A] reportedly called a tablet "the next best thing" for CS:GO. No details.
- Nobody published curves, filters or Kovaak's scores. **AimForge's measured roster is already more detailed than anything public.**

## What carries over from osu!
- **Fire off the nib: "tapx"** [D wiki / C]
  - Most osu! players aim in hover and click with a keyboard key, precisely so the click never moves the cursor.
  - **For AimForge:** this is the zero-skid play style. With fire on a key and aim in hover, the Tap Anchor and Nib Twin have nothing to correct.
  - **Field test (pending):** add a keyboard Fire bind in game, play one session hover-aiming, and compare with tap-to-fire.
- **Speed-scheduled smoothing (Devocub antichatter)** [D]
  - Smooths slow motion more, adds 5–50 ms of latency, and needs prediction to hide it. Prediction "makes the cursor inaccurate and erratic" when over-tuned (VoiD ExperimentalASFilter README).
  - **Refused:** prediction is synthesized motion, which breaks law 5. Latency-for-stillness smoothing is already in the graveyard (the 0.90 floor and the CoD Lab EMA felt like latency in the field).
- **Radial Follow (AbstractQbit)** [D]
  - Lag is bounded by distance, not time, and the inner radius is a deadzone.
  - **Refused as a deadzone:** measured on 2026-09-16, a rest deadzone erased micro-aim (the Valorant / Apex / Rivals Masters were retired for it).
  - The distance-bounded idea is what the Coherence Stabilizer's MaxLagMm (1 mm) already does.
- **Pressure-scheduled smoothing (PSSA, reverse mode)** [D]
  - The closest public analogue of the Tap Anchor pin, which is pressure-gated and exact-passthrough off the click.
  - AimForge's version is stricter: zero added latency outside a press, measured.
- **Wacom's own patents** [D] (US 8,253,697, height-dependent jitter filtering): jitter grows with hover height. This backs the Hover Distance Limiter that every AimForge build keeps.

## RawAccel
- **Speed-only smoothing** [D guide; C "matters more for tablets"]
  - RawAccel 1.7 can smooth the speed its curve reads without smoothing the output.
  - **Measured and refused:** `ev-20261011-pen-speed-ema`, `--ema-lab`, built on a line-for-line port of RawAccel's `linear_ema_smoother`.
  - On the steep-ramp cards it trims average gain noise by at most about 30%. The worst single-report spike does not move (Psylocke about 65–70% either way), and a flick from rest loses up to 0.8 mm at the wrong gain.
  - Cadence Lock removes the noise completely with no lag. **Cadence Lock remains the answer**, and the pen's speed EMAs stay 0 (selftest-pinned).
- **Gain vs legacy** [D]: legacy offsets and caps make gain discontinuities. AimForge already pins classic to the legacy form it models and requires LUTs to be continuous (QC RULE 1 and the monotonic tremor band).
- **Curve families** [C]: classic exp 2 or natural with a low offset; synchronous for tracking. AimForge's roster is the classic / LUT form of the same idea, measured per card (the unity pocket, then one ramp).
- **Angle snapping** [C "leave it off"]: the field-proven BO6 build uses 9–12° and the user rated it best. **Field beats community consensus; unchanged.**
- **Anti-cheat** [A/C]: RawAccel is a signed driver, used with Vanguard and EAC without reports of bans.

## OpenTabletDriver and Vanguard
- **Documented** [D, OTD FAQ]:
  - Vanguard blocks SendInput.
  - It accepts only the *first* mouse-type device it sees.
  - It can drop left clicks while keyboard keys are held.
- **OTD's built-in bindings use SendInput** [D, source]: OTD's built-in "Mouse Button Binding" and "Key Binding" both press through SendInput (v0.6.4.0 source).
- **Adopted (Doctor row):** for a live Valorant build, the Doctor reads the pen tip's binding (read-only).
  - A built-in OTD binding FAILs, with the fix: use the VMulti plugin's button binding.
  - A VMulti binding passes with a WARN listing the two Vanguard rules: touch the pen before the mouse, and add a keyboard Fire bind if taps vanish while strafing.
- **Not adopted:** having AimForge rewrite bindings. That is a new driver-surface write, and the binding AimForge would write (Key Binding) is itself blocked by Vanguard.

## Ideas left for the field (pending, not built)
- **The keyboard-fire play style:** see "Fire off the nib" above.
- **A pen-button "precision" sensitivity** (VoiD PrecisionControl): redundant with in-game scoped/ADS sensitivity; no card needs it yet.
- **Grip-rotation auto-calibration from straight swipes:** needs a raw report stream AimForge does not have outside the nib press log.
