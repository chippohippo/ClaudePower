using System;
using System.Numerics;

namespace AimForge.Filters
{
    /// <summary>
    /// Cadence Lock - the acceleration curve evaluated in TABLET space, on the pen's own clock.
    ///
    /// Why it exists (R&amp;D note, 2026-09-07). A mouse driver has to GUESS speed: it divides a
    /// count delta by the time between two reports as they ARRIVE at the driver, and on a
    /// tablet chain that arrival time is USB delivery + OTD thread + VMulti injection jitter,
    /// not the digitizer's sample clock. RawAccel's own guide admits the failure mode
    /// ("cursor stutters that only occur with acceleration enabled") and offers a fixed
    /// polling-rate assumption as the escape hatch. The pen has something no mouse has: a
    /// fixed hardware sample cadence (360 Hz here, measured) and absolute position. So the TRUE speed of
    /// every report is |delta| * cadence, exactly, with no timing measurement at all. This
    /// filter applies the build's curve (mm/s -> gain, the units presets are authored in)
    /// using that exact speed, and the RawAccel profile is written FLAT (noaccel) so the curve
    /// runs once. Every other RawAccel duty (sens multiplier, Y/X, snapping, rotation) stays
    /// in RawAccel through its official writer.
    ///
    /// Laws:
    ///   - Position in, position out, PreTransform, same report - ZERO temporal cost (T0).
    ///     No smoothing, no interpolation, no prediction: the output delta is the input delta
    ///     times a gain, on the same report it arrived on.
    ///   - Time enters ONLY as an integer report count: dt is rounded to the nearest multiple
    ///     of the cadence, so a dropped/merged USB frame is priced as 2 reports of travel (the
    ///     truth) instead of a 2x speed spike (what a wall-clock divide does).
    ///   - Cadence is auto-estimated as the running mean of single-report gaps (exact in the
    ///     limit whatever the jitter looks like; prior-seeded at 300Hz), or pinned when
    ///     NominalHz &gt; 0.
    ///   - The output is never snapped back onto the pen while OTD could still pass the jump. OTD's relative mode
    ///     clears its last position only when a gap exceeds its own reset delay (a strict >); a lift (OutOfRange)
    ///     does NOT clear it. So after a lift or a gap the first report carries the hand's own delta at unity -
    ///     exactly what OTD would pass with no filter - and the output rebases onto the pen only after a gap past
    ///     RebaseMs, longer than any relative reset AimForge writes (2026-09-16 review: the old 50 ms rebase threw
    ///     the whole gain-built offset, up to ~80 mm, into the cursor on a 50-80 ms stall or a quick lift).
    /// </summary>
    public sealed class CadenceCore
    {
        public const int MaxPoints = 8;   // the widest authored LUT (Holdfast wildcard) has 8
        /// The pen's hardware report rate. AimForge pins it from the catalogue (tablet.reportHz,
        /// MEASURED 360.2 on the DTC-141, 2026-09-07). 0 = auto: running mean of single-report gaps, for use
        /// outside AimForge or to VERIFY the pinned figure.
        public double NominalHz;
        /// Curve in the presets' own units: speed in mm/s of pen travel -> gain. Unused slots
        /// carry speed 0 and are ignored. RawAccel LUT semantics: implied (0,0) below the first
        /// point, linear between points, flat past the last.
        public readonly double[] Vs = new double[MaxPoints];
        public readonly double[] Gs = new double[MaxPoints];
        /// Classic (legacy) curve evaluated NATIVELY - the driver's own formula in mm/s units,
        /// exact, no table (2026-09-14, ev-20260914-classic-formula). With k = pxmm/1000:
        ///   a' = accel * k (per mm/s), off' = offset / k (mm/s), and
        ///   gain(s) = s <= off' ? 1 : 1 + min(a'^(p-1) * (s - off')^p / s, cap - 1)
        /// which is algebraically identical to RawAccel's base_fn = accel^(p-1)*(x-off)^p/x at
        /// x = k*s. Takes precedence over the LUT points whenever ClassicAccel > 0.
        public double ClassicAccel, ClassicOffset, ClassicCap = 1, ClassicExp = 2;
        public bool IsClassic => ClassicAccel > 0;
        /// The shortest cap on a merged gap, in reports. The effective cap is never below the reports that fit in
        /// ResetMs: a gap still inside one stroke priced as FEWER reports than it spans over-reads speed by
        /// k_true/cap (2026-09-16 audit: at 360 Hz a 22-50 ms gap read up to 2.25x fast with a flat cap of 8).
        public double MergeMaxReports = 8;
        /// Tablet units per mm (DTC-141: 100). Set by the wrapper from the digitizer spec.
        public double UnitsPerMm = 100;
        /// A gap longer than this is no longer one stroke: its report is passed at unity instead of being priced as
        /// merged reports (and it bounds the merge cap below).
        public double ResetMs = 50;
        /// A gap longer than this rebases the output onto the true pen position. It must exceed OTD's relative reset
        /// delay (AimForge's GUI allows at most 500 ms) so OTD discards the rebase delta itself - never a cursor jump.
        public double RebaseMs = 1000;

        // ---- experimental toggles (XP_TOGGLES.md). All default OFF = bit-identical to plain Cadence Lock. ----
        /// INTENT SPEED (T1): the curve reads the COHERENT velocity |EMA(delta/dt)| instead of this report's |delta|/dt.
        /// The position still moves by this report's delta x gain on the same report; only the speed that SELECTS the gain
        /// is filtered. It cancels lattice alternation (a 20 mm/s track is 5 then 6 units a report = +/-9% speed) and
        /// orthogonal tremor. Blended out as coherence falls, and CLAMPED to within one lattice unit per report of the raw
        /// speed (2026-09-24 review: unclamped, the EMA lag trailed a track by up to 1.2 mm and over-delivered every stop).
        public double IntentSpeed;            // 0 = off, 1 = on
        public double IntentTauMs = 6;        // velocity EMA time constant (~2 reports)
        /// REVERSAL CARRY (T1, Lab-only by policy): at a strafe turnaround the hand passes through zero speed and the curve
        /// drops to unity, then re-ramps - the new leg starts "sticky". Carry holds the previous leg's gain as a floor that
        /// fades over ReversalCarryMs. 2026-09-24 review fixes: it arms only on a strafe RHYTHM (a previous reversal
        /// 60-600 ms earlier - a flick from rest and its overshoot correction never qualify); the floor scales with the new
        /// leg's own speed (unity at 10 mm/s, full by 25 mm/s - a settle-back or rest tremor gets ~nothing, and there is no
        /// one-report step); the tracking band tapers at both edges instead of cutting off.
        public double ReversalCarryMs;        // 0 = off
        public double CarryArmMms = 55, CarryMaxMms = 250;
        // ---- state ----
        double vex, vey, cohNum, cohDen;                // velocity EMA (mm/s) and coherence EMAs
        double gEma = 1, carryGain = 1, carryAge = -1;  // carry: -1 = idle
        readonly double[] pkT = new double[64], pkV = new double[64]; int pkN; double clock, lastRevClock = -1e9;
        public double LastCurveSpeedMms { get; private set; }
        // cadence estimator: prior-seeded running mean. Total elapsed time over N single-report
        // gaps IS the hardware interval whatever shape the jitter has, so the mean is exact in
        // the limit; the prior (300Hz, weight 8 - deliberately between the two claimed rates) washes out
        // within ~1s if the hardware runs a different rate. Gaps outside 0.5-1.5x the current
        // estimate (merged/dropped frames) never train it.
        const double PriorDt = 1000.0 / 300.0, PriorWeight = 8, WindowMax = 4096;
        double sumDt = PriorDt * PriorWeight, sumW = PriorWeight; double nomDt = PriorDt;
        bool primed, everPrimed; Vector2 lastPos; double outX, outY;   // output kept in double: no float drift
        public double LastSpeedMms { get; private set; }
        public double LastGain { get; private set; } = 1.0;
        public double LastReports { get; private set; } = 1;
        public double LiveHz => nomDt > 0 ? 1000.0 / nomDt : 0;
        public long Trained { get; private set; }

        public void Reset() { primed = false; ResetXp(); }   // lift: the next report passes at unity (never a snap)
        public void ResetCadence() { sumDt = PriorDt * PriorWeight; sumW = PriorWeight; nomDt = PriorDt; }
        /// Stroke state of the XP modes. Cleared on a lift AND on every gap/rebase path (2026-09-24 review: the HDL drops
        /// hover-lift reports without an OutOfRange, so a gap carried the last stroke's velocity, peak and carry state
        /// into the next stroke).
        void ResetXp() { vex = vey = cohNum = cohDen = 0; gEma = 1; carryAge = -1; pkN = 0; lastRevClock = -1e9; }

        public int PointCount { get { int n = 0; for (int i = 0; i < MaxPoints; i++) if (Vs[i] > 0) n++; return n; } }

        public double GainAt(double mms)
        {
            if (IsClassic)
            {
                if (mms <= ClassicOffset) return 1.0;
                double b = Math.Pow(ClassicAccel, ClassicExp - 1.0) * Math.Pow(mms - ClassicOffset, ClassicExp) / mms;
                return 1.0 + Math.Min(b, ClassicCap - 1.0);
            }
            int n = 0; for (int i = 0; i < MaxPoints; i++) { if (Vs[i] > 0) n = i + 1; else break; }
            if (n == 0) return 1.0;
            if (mms <= 0) return Gs[0];
            if (mms < Vs[0]) return Gs[0] * (mms / Vs[0]);
            for (int i = 1; i < n; i++)
                if (mms <= Vs[i])
                    return Gs[i - 1] + (mms - Vs[i - 1]) / (Vs[i] - Vs[i - 1]) * (Gs[i] - Gs[i - 1]);
            return Gs[n - 1];
        }

        void Train(double dtMs)
        {
            if (dtMs < 0.5 * nomDt || dtMs > 1.5 * nomDt) return;   // merged/dropped frame: not a single gap
            if (sumW >= WindowMax) { double f = (WindowMax - 1) / sumW; sumDt *= f; sumW *= f; }
            sumDt += dtMs; sumW += 1; nomDt = sumDt / sumW; Trained++;
        }

        static double Smooth(double a, double b, double x) { if (x <= a) return 0; if (x >= b) return 1; double t = (x - a) / (b - a); return t * t * (3 - 2 * t); }


        /// Positions in tablet UNITS (as OTD hands them to a PreTransform filter).
        public Vector2 Filter(Vector2 pos, double dtMs)
        {
            if (!everPrimed || dtMs > RebaseMs)
            {
                // the very first report, or a gap OTD's relative reset discards: rebase onto the pen
                everPrimed = primed = true; lastPos = pos; outX = pos.X; outY = pos.Y;
                ResetXp();
                LastSpeedMms = 0; LastGain = 1; LastReports = 1;
                return pos;
            }
            var d = pos - lastPos; lastPos = pos;
            if (!primed || !(dtMs > 0) || dtMs > ResetMs)
            {
                // after a lift or a gap: the hand's own delta at unity, the offset kept; a new stroke for the XP modes
                primed = true; outX += d.X; outY += d.Y;
                ResetXp();
                LastSpeedMms = 0; LastGain = 1; LastReports = 1;
                return new Vector2((float)outX, (float)outY);
            }

            double nominal;
            if (NominalHz > 0) nominal = 1000.0 / NominalHz;
            else
            {
                Train(dtMs);
                nominal = nomDt;
            }
            double k = Math.Round(dtMs / nominal);
            double maxK = Math.Max(MergeMaxReports, Math.Ceiling(ResetMs / nominal));
            if (k < 1) k = 1; if (k > maxK) k = maxK;
            double dtp = k * nominal;                                        // ms on the pen's clock
            double v = d.Length() / UnitsPerMm / dtp * 1000.0;              // mm/s, on the pen's clock
            double vx = d.X / UnitsPerMm / dtp * 1000.0, vy = d.Y / UnitsPerMm / dtp * 1000.0;
            double prevVe = Math.Sqrt(vex * vex + vey * vey);
            bool xp = IntentSpeed >= 0.5 || ReversalCarryMs > 0;
            double vCurve = v, cosT = 1, coh = 0;
            if (xp)
            {
                // heading of this report against the coherent direction BEFORE it (reversal detection)
                if (prevVe > 1e-9 && v > 1e-9) cosT = (vx * vex + vy * vey) / (v * prevVe);
                double a = 1.0 - Math.Exp(-dtp / Math.Max(0.1, IntentTauMs));
                vex += (vx - vex) * a; vey += (vy - vey) * a;
                cohNum += (Math.Sqrt(vex * vex + vey * vey) - cohNum) * a; cohDen += (v - cohDen) * a;
                coh = cohDen > 1e-9 ? Math.Min(1.0, cohNum / cohDen) : 0;
                if (IntentSpeed >= 0.5)
                {
                    // weight: full intent speed only on coherent, straight-ahead motion; raw speed on turns and at rest
                    double w = Math.Clamp((coh - 0.5) / 0.3, 0, 1) * Math.Clamp((cosT - 0.5) / 0.4, 0, 1);
                    vCurve = v + (Math.Sqrt(vex * vex + vey * vey) - v) * w;
                    double u = 1.0 / UnitsPerMm / dtp * 1000.0;               // one lattice unit per report, in mm/s
                    vCurve = Math.Clamp(vCurve, Math.Max(0, v - u), v + u);
                }
            }
            double g = GainAt(vCurve);
            if (ReversalCarryMs > 0)
            {
                clock += dtp;
                pkT[pkN & 63] = clock; pkV[pkN & 63] = v; pkN++;
                double peak = 0; for (int i = Math.Max(0, pkN - 64); i < pkN - 1; i++) if (clock - pkT[i & 63] <= 150) peak = Math.Max(peak, pkV[i & 63]);
                double band = Smooth(CarryArmMms - 20, CarryArmMms + 20, peak) * (1.0 - Smooth(CarryMaxMms - 50, CarryMaxMms + 50, peak));
                if (cosT < -0.5 && band > 0 && clock - lastRevClock > 40)
                {
                    // a turnaround OUT OF A TRACKING-BAND LEG (rest-tremor heading flips never count). Arm only on a strafe
                    // rhythm: the previous leg itself began at such a turnaround 60-600 ms ago - a flick from rest and its
                    // overshoot correction never qualify.
                    double since = clock - lastRevClock; lastRevClock = clock;
                    if (since >= 60 && since <= 600 && gEma > 1.0) { carryGain = 1.0 + (gEma - 1.0) * band; carryAge = 0; }
                    else carryAge = -1;
                }
                else if (carryAge >= 0) carryAge += dtp;
                if (carryAge >= ReversalCarryMs) carryAge = -1;
                if (carryAge >= 0)
                {
                    // the floor scales with the NEW leg's own speed: unity at 10 mm/s, full by 25 mm/s
                    double floor = 1.0 + (carryGain - 1.0) * (1.0 - carryAge / ReversalCarryMs) * Math.Clamp((v - 10) / 15, 0, 1);
                    g = Math.Max(g, floor);
                }
                gEma += (GainAt(vCurve) - gEma) * (1.0 - Math.Exp(-dtp / 60.0));   // the last leg's gain, remembered over ~60 ms
            }
            LastSpeedMms = v; LastCurveSpeedMms = vCurve; LastGain = g; LastReports = k;
            outX += d.X * g; outY += d.Y * g;
            return new Vector2((float)outX, (float)outY);
        }
    }
}
