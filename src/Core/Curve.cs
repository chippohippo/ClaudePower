using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace AimForge.Core
{
    /// <summary>
    /// Everything derivable from a preset and a rig. Pure functions, no I/O, no state - so the
    /// self-test can pin every number and the UI can recompute on every keystroke for free.
    /// </summary>
    public static class Curve
    {
        /// Speed landmarks in mm/s of pen travel, measured on this rig.
        public const double TapSkidMms = 37.0, TrackMms = 120.0, FlickMms = 532.0;
        /// Acceleration must never intrude below this (field-derived RULE 2).
        public const double AccelFloorMms = 55.0;
        /// Gain dips below this speed overlap tremor's velocity sweep and amplify it (Tremor Notch, -279%).
        public const double MicroBandMms = 15.0;

        public static double ToCountsPerMs(double mms, double pxmm) => mms * pxmm / 1000.0;

        /// RawAccel semantics: linear between points, ramping toward the implied (0,0) below the first point, flat past
        /// the last. At mms <= 0 the first point's gain is returned on purpose: it only ever multiplies a zero delta,
        /// and the HUD at rest shows the floor rather than 0.00x.
        public static double GainAt(double[][] lut, double mms)
        {
            if (lut == null || lut.Length == 0) return 1.0;
            if (mms <= 0) return lut[0][1];
            if (mms < lut[0][0]) return lut[0][1] * (mms / lut[0][0]);
            for (int i = 1; i < lut.Length; i++)
                if (mms <= lut[i][0])
                {
                    var a = lut[i - 1]; var b = lut[i];
                    return a[1] + (mms - a[0]) / (b[0] - a[0]) * (b[1] - a[1]);
                }
            return lut[lut.Length - 1][1];
        }

        /// RawAccel LookUpTable text: "x,y;x,y;" in counts/ms. x must be > 0 and strictly increasing. x is the SAME
        /// Math.Round(.., 3) value RawAccelData writes (2026-09-16 review: formatting the unrounded x with '0.###'
        /// rounds half away from zero, the written data rounds half to even - 0.677 vs 0.676 at 55 px/mm - and the
        /// apply's read-back rolled back a correct write).
        public static string RawAccelPoints(double[][] lut, double pxmm)
            => string.Join(";", lut.Select(p =>
                   Math.Round(ToCountsPerMs(p[0], pxmm), 3).ToString("0.###", CultureInfo.InvariantCulture) + "," +
                   p[1].ToString("0.###", CultureInfo.InvariantCulture))) + ";";

        /// Like RawAccelPoints, but drops any point whose 3-dp x does not strictly increase. For the
        /// DISPLAY/COPY of a dense classic sample only (a zero-offset classic curve's first samples
        /// collide at 3 dp and RawAccel's LUT box rejects duplicates). Never used by an apply.
        public static string RawAccelPointsDistinct(double[][] lut, double pxmm)
        {
            var sb = new System.Text.StringBuilder(); double lastX = double.NegativeInfinity;
            foreach (var p in lut)
            {
                double x = Math.Round(ToCountsPerMs(p[0], pxmm), 3);
                if (x <= 0 || x <= lastX) continue;
                lastX = x;
                sb.Append(x.ToString("0.###", CultureInfo.InvariantCulture)).Append(',').Append(p[1].ToString("0.###", CultureInfo.InvariantCulture)).Append(';');
            }
            return sb.ToString();
        }

        public static double[] RawAccelData(double[][] lut, double pxmm)
        {
            var o = new List<double>();
            foreach (var p in lut) { o.Add(Math.Round(ToCountsPerMs(p[0], pxmm), 3)); o.Add(p[1]); }
            return o.ToArray();
        }

        /// In-game sensitivity for a game constant K at a rig: sens = K / (eDPI * cm). The tuner's
        /// eDPI is px/mm expressed as DPI-equivalent (25.4 mm/in) scaled by the RawAccel multiplier.
        public static double SensFor(double K, Rig r, double mult = 1.0)
        {
            double edpi = r.PxMm * 25.4 * mult;
            return K / (edpi * r.Cm360);
        }

        public static double EDpi(Rig r, double mult = 1.0) => r.PxMm * 25.4 * mult;

        /// Pen travel in mm for a 180 degree turn executed in tMs. Bisection: the fixed-point form
        /// oscillates for capped curves (documented failure, Snap Turn work).
        public static double Turn180Mm(double[][] lut, Rig r, double tMs = 150)
        {
            double lo = 1, hi = 1500;
            for (int i = 0; i < 90; i++)
            {
                double L = 0.5 * (lo + hi);
                double v = L / (tMs / 1000.0);
                double deg = GainAt(lut, v) * L / (r.Cm360 * 10.0) * 360.0;
                if (deg < 180) lo = L; else hi = L;
            }
            return 0.5 * (lo + hi);
        }

        /// Field-derived QC rules. Each failure is a human sentence, because this is shown to a person.
        public static List<string> Check(Preset p, Tablet t)
        {
            var out_ = new List<string>();
            if (!p.IsLut) return out_;
            var L = p.lut!;
            for (int i = 0; i < L.Length; i++)
            {
                if (L[i][0] <= 0) out_.Add($"point {i}: x must be > 0 (RawAccel implies (0,0) and rejects x<=0)");
                if (i > 0 && L[i][0] <= L[i - 1][0]) out_.Add($"point {i}: x must strictly increase");
            }
            double unit = t.UnitStepMms;
            // The cards were authored with a 2.66 mm/s first anchor (266Hz era); the pen measures
            // 360Hz (2026-09-07), so the 1-unit step is 3.60. An anchor at or BELOW the unit step
            // is fine - the floor gain still lands on the first expressible step. Above it is not.
            if (L[0][0] > unit + 0.05)
                out_.Add($"first anchor is {L[0][0]:0.00} mm/s, above the 1-unit step ({unit:0.00}) - the floor will not land on it");
            // BO6-era note (2026-08-27): the old LUT-era rules "no gain > 1 at the 37mm/s tap
            // speed" and "no acceleration below 55mm/s" are field-SUPERSEDED - the baseline the
            // user rates most stable accelerates from 8.8mm/s and reads 1.13x at tap speed (driver formula; 1.17x under the retired linear model).
            // What survives: the low end must RAMP (no shelves), stay monotonic in the tremor
            // band, and hold >= 0.80 at the 2-unit step.
            if (GainAt(L, 2 * unit) < 0.80)
                out_.Add($"2-unit-step gain {GainAt(L, 2 * unit):0.00} is below 0.80 - the accepted-build signature (shelf-family feel)");
            // every segment that STARTS inside the tremor band is judged up to 15 mm/s (2026-09-16 review: a dip or a shelf
            // whose end point sat at or past 15 passed)
            for (int i = 1; i < L.Length; i++)
            {
                if (!(L[i - 1][0] < MicroBandMms) || L[i][0] <= L[i - 1][0]) continue;
                double xe = Math.Min(L[i][0], MicroBandMms), ge = GainAt(L, xe);
                if (ge < L[i - 1][1] - 1e-9)
                    out_.Add($"gain dips to {ge:0.00} by {xe:0.0} mm/s, inside the tremor band - amplifies tremor (Tremor Notch: -279%)");
                if (L[i - 1][1] < 0.999 && Math.Abs(L[i][1] - L[i - 1][1]) < 1e-9)
                    out_.Add($"flat shelf at {L[i - 1][1]:0.00} across {L[i - 1][0]:0.0}-{L[i][0]:0.0} mm/s (RULE 1: the low end must ramp; shelves were field-rejected)");
            }
            return out_;
        }

        /// RawAccel's classic (legacy) curve, THE DRIVER'S OWN FORMULA (v1.7.0 common/accel-classic.hpp,
        /// verified 2026-09-14, ev-20260914-classic-formula):
        ///     base_fn(x) = accel^(p-1) * (x - offset)^p / x        (x in counts/ms, p = exponentClassic)
        ///     sens(x)    = x <= offset ? 1 : 1 + min(base_fn(x), cap - 1)     (Cap mode "output")
        /// For p = 2 that is 1 + accel*(x-offset)^2/x - a CURVE between the offset and the cap, not
        /// the straight line 1 + accel*(x-offset) this project assumed until today. The two agree
        /// only when offset = 0. With Breakpoint's 0.246/0.5/5.0 the line over-read the gain by 6%
        /// at 17mm/s and 5% at 88mm/s, and put the cap at 294mm/s where the driver reaches it at
        /// 302.6mm/s. Everything downstream (canvas, measurement, Cadence Lock, the mouse mirror)
        /// now evaluates THIS.
        public static double ClassicGain(double cMs, double accel, double offset, double cap, double exp = 2.0)
        {
            if (cMs <= offset || accel <= 0) return 1.0;
            double baseFn = Math.Pow(accel, exp - 1.0) * Math.Pow(cMs - offset, exp) / cMs;
            return 1.0 + Math.Min(baseFn, cap - 1.0);
        }

        /// The counts/ms at which the classic curve reaches its output cap (bisection - base_fn is
        /// monotone above the offset for any p >= 1). Returns +inf if the cap is never reached.
        public static double ClassicCapSpeedCms(double accel, double offset, double cap, double exp = 2.0)
        {
            if (accel <= 0 || cap <= 1) return double.PositiveInfinity;
            double lo = offset, hi = 1e6;
            if (ClassicGain(hi, accel, offset, cap, exp) < cap - 1e-12) return double.PositiveInfinity;
            for (int i = 0; i < 200; i++)
            {
                double mid = 0.5 * (lo + hi);
                double b = Math.Pow(accel, exp - 1.0) * Math.Pow(Math.Max(mid - offset, 0), exp) / mid;
                if (b < cap - 1.0) lo = mid; else hi = mid;
            }
            return 0.5 * (lo + hi);
        }

        /// Pen speed (mm/s) at which the card's curve first reaches its maximum gain: the classic cap speed, or the
        /// LUT's first point at its top value. Null for a flat curve or a classic cap that is never reached.
        public static double? CapSpeedMms(Preset p)
        {
            if (p.IsLut)
            {
                double top = p.lut!.Max(q => q[1]);
                return top <= 1 + 1e-9 ? null : p.lut!.First(q => q[1] >= top - 1e-9)[0];
            }
            double c = ClassicCapSpeedCms(p.adv.accel ?? 0, p.adv.offset ?? 0, p.adv.cap ?? 1);
            return double.IsInfinity(c) || double.IsNaN(c) ? null : c * 1000 / p.pxmm;
        }

        /// A classic card as a DENSE LUT in (mm/s, gain) - a log-spaced sample of the driver's
        /// formula (48 points inside the ramp; interpolation error below 0.04% on every shipped card), so every
        /// LUT-driven surface (curve canvas, measurement, summary, the mouse mirror's LUT case)
        /// serves classic presets faithfully. Applying still uses true classic mode, and Cadence
        /// Lock evaluates the formula natively (CadenceCore.Classic*), so neither engine runs
        /// this approximation.
        public static double[][] EffectiveLut(Preset p, double pxmm, int samples = 48)
        {
            if (p.IsLut) return p.lut!;
            double a = p.adv.accel ?? 0, cap = p.adv.cap ?? 1, off = p.adv.offset ?? 0;
            double k = pxmm / 1000.0;                                  // counts/ms per mm/s
            double offMms = Math.Max(off / k, 0.02);
            if (a <= 0 || cap <= 1)
                return new[] { new[] { 0.01, 1.0 }, new[] { 1450.0, 1.0 } };
            double capMms = ClassicCapSpeedCms(a, off, cap) / k;
            double hi = Math.Min(capMms, 1450.0);
            var pts = new List<double[]> { new[] { 0.01, 1.0 }, new[] { offMms, 1.0 } };
            double last = offMms;
            for (int i = 1; i < samples; i++)
            {
                double s = offMms * Math.Pow(hi / offMms, (double)i / samples);
                if (s <= last * 1.000001 || s >= hi * 0.999999) continue;
                pts.Add(new[] { s, ClassicGain(s * k, a, off, cap) }); last = s;
            }
            if (capMms < 1450.0) { pts.Add(new[] { capMms, cap }); pts.Add(new[] { 1450.0, cap }); }
            else pts.Add(new[] { 1450.0, ClassicGain(1450.0 * k, a, off, cap) });
            return pts.ToArray();
        }

        /// The four numbers that describe a curve at a glance.
        public static (double floor, double twoUnit, double tap, double track, double cap) Summary(double[][] lut, Tablet t)
            => (GainAt(lut, t.UnitStepMms), GainAt(lut, 2 * t.UnitStepMms), GainAt(lut, TapSkidMms),
                GainAt(lut, TrackMms), lut.Max(p => p[1]));
    }
}
