using System;
using System.Collections.Generic;
using System.Linq;

namespace AimForge.Core
{
    /// <summary>
    /// RAWACCEL INPUT-SPEED EMA LAB (2026-10-11). RawAccel 1.7 can smooth the SPEED its curve reads ("Time in ms after which an
    /// input is weighted at half its original value") without smoothing the output: the camera still moves on the same report
    /// by the hand's own delta, only the gain multiplying it is taken from a smoothed speed. The 2026-09-16 audit pinned it to
    /// 0 on the pen ("would time-smear the speed the curve reads") without a measurement; this lab is that measurement.
    ///
    /// The smoother is a line-for-line port of RawAccel's `linear_ema_smoother` (common/rawaccel.hpp, master 53a7213,
    /// 2025-07-27): a trend-following EMA plus a sqrt-faster "cutoff" EMA, returning the smaller of the two, with the fixed
    /// input trend half-life 1.25 ms and trend dampening 0.75. It is fed the per-report speed RawAccel computes from the
    /// arrival-time dt, exactly as the driver does.
    ///
    /// Two numbers per half-life, on the same jittered 360 Hz stream CadenceLab uses:
    ///  - aim-band gain noise (std of gain / true gain - 1 while tracking 55-220 mm/s) - what the EMA buys;
    ///  - flick gain lag: from rest to a 300 mm/s flick, the ms until the applied gain is within 5% of the true gain, and the
    ///    travel lost in the first 30 ms (mm of hand motion delivered at the wrong gain) - what it costs.
    /// </summary>
    public static class SpeedEmaLab
    {
        /// RawAccel's linear_ema_smoother, ported verbatim (time in ms).
        public sealed class LinearEma
        {
            const double TrendDampening = 0.75;
            double wc, cc, wtc, ctc, wTot, cTot, wTr, cTr;
            public LinearEma(double halfLife, double trendHalfLife = 1.25)
            {
                wc = halfLife > 0 ? Math.Pow(0.5, 1 / halfLife) : 0;
                wtc = trendHalfLife > 0 ? Math.Pow(0.5, 1 / trendHalfLife) : 0;
                cc = 1.0 - Math.Sqrt(1.0 - wc);
                ctc = 1.0 - Math.Sqrt(1.0 - wtc);
            }
            public double Smooth(double speed, double time)
            {
                double aw = 1 - Math.Pow(wc, time), ac = 1 - Math.Pow(cc, time);
                double awt = 1 - Math.Pow(wtc, time), act = 1 - Math.Pow(ctc, time);
                double ow = wTot, oc = cTot;
                wTr *= TrendDampening; cTr *= TrendDampening;
                wTot += wTr * time; cTot += cTr * time;
                wTot += aw * (speed - wTot); cTot += ac * (speed - cTot);
                wTot = Math.Max(wTot, 0); cTot = Math.Max(cTot, 0);
                double nw = time > 0 ? (wTot - ow) / time : 0, nc = time > 0 ? (cTot - oc) / time : 0;
                wTr += awt * (nw - wTr); cTr += act * (nc - cTr);
                return Math.Min(wTot, cTot);
            }
        }

        public sealed class Row
        {
            public double HalfLifeMs, AimNoisePct, AimWorstPct, FlickSettleMs, FlickLostMm, TapOvershootPct;
        }

        const double HZ = 360.0, DT = 1000.0 / HZ, UPM = 100.0;

        static Func<double, double> Truth(Preset p, Rig rig)
        {
            var lut = Curve.EffectiveLut(p, rig.PxMm);
            return p.IsLut ? v => Curve.GainAt(lut, v)
                : v => Curve.ClassicGain(v * rig.PxMm / 1000.0, p.adv.accel ?? 0, p.adv.offset ?? 0, p.adv.cap ?? 1);
        }

        /// One half-life on one card. halfLife 0 = RawAccel's raw per-report speed (today's pen profile).
        public static Row Run(Preset p, Rig rig, double halfLifeMs, double jitterPct = 10, int seed = 7)
        {
            var truth = Truth(p, rig);
            var row = new Row { HalfLifeMs = halfLifeMs };
            // ---- aim band: CadenceLab's stream (25 mm amplitude, 1.5 Hz, 6 s, 0.01 mm lattice, +/-jitter arrival time) ----
            {
                var rnd = new Random(seed); var ema = halfLifeMs > 0 ? new LinearEma(halfLifeMs) : null;
                int n = (int)(6 * HZ); double lastX = 0, s = 0, s2 = 0; int cnt = 0; bool first = true;
                for (int i = 0; i < n; i++)
                {
                    double t = i / HZ, xu = Math.Round(25.0 * Math.Sin(2 * Math.PI * 1.5 * t) * UPM);
                    double dtObs = DT * (1.0 + (rnd.NextDouble() * 2 - 1) * jitterPct / 100.0);
                    if (first) { first = false; lastX = xu; continue; }
                    double d = Math.Abs(xu - lastX); lastX = xu;
                    double vWall = d / UPM / dtObs * 1000.0, vTrue = d / UPM / DT * 1000.0;
                    double vSeen = ema != null ? ema.Smooth(vWall, dtObs) : vWall;
                    if (d == 0 || vTrue < 55 || vTrue > 220) continue;
                    double e = truth(vSeen) / truth(vTrue) - 1;
                    s += e; s2 += e * e; cnt++; row.AimWorstPct = Math.Max(row.AimWorstPct, Math.Abs(e) * 100);
                }
                double m = cnt > 0 ? s / cnt : 0; row.AimNoisePct = cnt > 1 ? Math.Sqrt(Math.Max(0, s2 / cnt - m * m)) * 100 : 0;
            }
            // ---- flick from rest: 200 ms still, then a step to 300 mm/s (no jitter: the lag itself) ----
            {
                var ema = halfLifeMs > 0 ? new LinearEma(halfLifeMs) : null;
                double settle = 0, lost = 0; bool settled = false;
                for (int i = 0; i < (int)(0.2 * HZ); i++) ema?.Smooth(0, DT);
                for (int i = 1; i <= (int)(0.1 * HZ); i++)
                {
                    double v = 300, vSeen = ema != null ? ema.Smooth(v, DT) : v, g = truth(vSeen), gt = truth(v);
                    if (i * DT <= 30) lost += Math.Abs(1 - g / gt) * v / 1000.0 * DT;   // hand mm delivered at the wrong gain
                    if (!settled && Math.Abs(g / gt - 1) <= 0.05) { settled = true; settle = (i - 1) * DT; }
                }
                row.FlickSettleMs = settled ? settle : 100; row.FlickLostMm = lost;
            }
            // ---- a tap-speed correction (40 mm/s for 60 ms, then stop): does the trend term overshoot the gain? ----
            {
                var ema = halfLifeMs > 0 ? new LinearEma(halfLifeMs) : null; double worst = 0;
                for (int i = 0; i < (int)(0.2 * HZ); i++) ema?.Smooth(0, DT);
                for (int i = 0; i < (int)(0.06 * HZ); i++)
                {
                    double vSeen = ema != null ? ema.Smooth(40, DT) : 40;
                    worst = Math.Max(worst, truth(vSeen) / truth(40) - 1);
                }
                row.TapOvershootPct = worst * 100;
            }
            return row;
        }

        public static readonly double[] Sweep = { 0, 0.5, 1, 1.5, 2, 3, 5 };
    }
}
