using System;
using System.Numerics;
using AimForge.Filters;

namespace AimForge.Core
{
    /// <summary>
    /// The measurement behind Cadence Lock. Drives the SHIPPING CadenceCore and a faithful
    /// model of a wall-clock engine (RawAccel: gain from |delta| / arrival dt) with the same
    /// quantised pen stream under report-timing jitter, and scores the per-report gain noise
    /// each one hands the game. Ground truth is the pen's own clock: the hand moved what it
    /// moved in one report interval, whatever the USB/thread stack did to the timestamp.
    /// </summary>
    public static class CadenceLab
    {
        /// The RawAccel-engine gain noise a card's ramp makes across the whole AIM band (2026-09-16 review): a 50 mm
        /// peak-to-peak track at 1.5 Hz (peak ~236 mm/s) scored from 55 to 220 mm/s, which covers tracking in every
        /// family (Rivals dives run 140-200). The original 55-150 band never reached a ramp that starts at 150 mm/s
        /// (Psylocke read 0.4% while her 150-210 ramp is the steepest in the roster). One stream and one band for every
        /// card, so the column compares like with like; the BO6 base is measured the same way.
        public static Result RunAimBand(Preset p, Rig rig, double jitterPct = 10, int seed = 7)
            => Run(p, rig, jitterPct, seed, false, 25.0, 55, 220);

        public sealed class Result
        {
            public double JitterPct;                 // +/- uniform arrival jitter applied
            public double WallGainNoisePct;          // std of (gain_wall / gain_true - 1), track band
            public double CadenceGainNoisePct;       // same for Cadence Lock
            public double WallWorstGainErrPct;       // worst single-report gain error, wall clock
            public double CadenceWorstGainErrPct;
            public double CadenceVsIdealMaxUnits;    // max |cadence output - ideal output| in tablet units
            public double MergedFrameWallSpikePct;   // gain error on a merged (2-report) frame, wall clock
            public double MergedFrameCadenceErrPct;
            public double LiveHz;                    // auto cadence estimate under jitter
            public int Reports;
        }

        /// Long left-right track: 30mm peak-to-peak at 1.5 Hz (peak ~140 mm/s - the Rivals
        /// tracking band) for 6 s at 360 Hz (measured), on the 0.01mm lattice. `ampMm` and the scored band are
        /// parameters so a card whose ramp sits above 150 mm/s can be measured ON its ramp (RunAimBand).
        public static Result Run(Preset p, Rig rig, double jitterPct = 25, int seed = 7, bool autoCadence = false,
                                 double ampMm = 15.0, double bandLoMms = 55, double bandHiMms = 150)
        {
            const double HZ = 360.0, DT = 1000.0 / HZ, UPM = 100.0;
            var lut = Curve.EffectiveLut(p, rig.PxMm);
            // ONE reference gain for both arms (2026-09-16 audit): the driver formula for classic cards (RawAccel runs
            // classic natively, and so does Cadence Lock), the table for LUT cards - so the cadence arm's "noise" is no
            // longer the dense-LUT interpolation residual.
            Func<double, double> truth = p.IsLut ? v => Curve.GainAt(lut, v)
                : v => Curve.ClassicGain(v * rig.PxMm / 1000.0, p.adv.accel ?? 0, p.adv.offset ?? 0, p.adv.cap ?? 1);
            var core = OtdBridge.CadenceCoreFor(p, rig);
            var ideal = OtdBridge.CadenceCoreFor(p, rig);
            core.NominalHz = autoCadence ? 0 : HZ;   // pinned case vs the fallback estimator
            ideal.NominalHz = HZ;
            var rnd = new Random(seed);
            int n = (int)(6 * HZ);
            double x(double t) => ampMm * Math.Sin(2 * Math.PI * 1.5 * t);   // mm

            var r = new Result { JitterPct = jitterPct, Reports = n };
            double sumW = 0, sumW2 = 0, sumC = 0, sumC2 = 0; int cnt = 0;
            Vector2 lastQ = default; bool first = true; double dtAccum = 0;
            for (int i = 0; i < n; i++)
            {
                double t = i / HZ;
                // quantise to the tablet lattice (units)
                var q = new Vector2((float)Math.Round(x(t) * UPM) + 15000f, 15000f);
                double jit = 1.0 + (rnd.NextDouble() * 2 - 1) * jitterPct / 100.0;
                double dtObs = DT * jit;
                var outC = core.Filter(q, dtObs);
                var outI = ideal.Filter(q, DT);
                if (first) { first = false; lastQ = q; continue; }
                double dUnits = Math.Abs(q.X - lastQ.X); lastQ = q;
                if (dUnits == 0) continue;
                double vTrue = dUnits / UPM / DT * 1000.0;                 // mm/s on the pen clock
                double vWall = dUnits / UPM / dtObs * 1000.0;              // what a driver divide sees
                double gTrue = truth(vTrue), gWall = truth(vWall), gCad = core.LastGain;
                r.CadenceVsIdealMaxUnits = Math.Max(r.CadenceVsIdealMaxUnits, Math.Abs(outC.X - outI.X));
                if (vTrue < bandLoMms || vTrue > bandHiMms) continue;      // score the TRACK band
                double ew = gWall / gTrue - 1, ec = gCad / gTrue - 1;
                sumW += ew; sumW2 += ew * ew; sumC += ec; sumC2 += ec * ec; cnt++;
                r.WallWorstGainErrPct = Math.Max(r.WallWorstGainErrPct, Math.Abs(ew) * 100);
                r.CadenceWorstGainErrPct = Math.Max(r.CadenceWorstGainErrPct, Math.Abs(ec) * 100);
                dtAccum += dtObs;
            }
            if (cnt > 1)
            {
                double mw = sumW / cnt, mc = sumC / cnt;
                r.WallGainNoisePct = Math.Sqrt(Math.Max(0, sumW2 / cnt - mw * mw)) * 100;
                r.CadenceGainNoisePct = Math.Sqrt(Math.Max(0, sumC2 / cnt - mc * mc)) * 100;
            }
            r.LiveHz = autoCadence ? core.LiveHz : core.NominalHz;

            // merged USB frame at 120 mm/s: two reports of travel arrive as one report
            double vm = 120, step = vm / 1000.0 * DT * UPM;
            var c2 = OtdBridge.CadenceCoreFor(p, rig); c2.NominalHz = HZ;
            var pos = new Vector2(15000, 15000); c2.Filter(pos, DT);
            for (int i = 0; i < 10; i++) { pos.X += (float)step; c2.Filter(pos, DT); }
            pos.X += (float)(2 * step); c2.Filter(pos, 2 * DT);
            double gT = truth(vm);
            r.MergedFrameCadenceErrPct = Math.Abs(c2.LastGain / gT - 1) * 100;
            // a wall-clock divide on a merged frame that arrives EARLY (the common USB pattern:
            // the late frame is followed by the on-time one) sees 2x travel over ~1x time
            r.MergedFrameWallSpikePct = Math.Abs(truth(2 * vm / 1.25) / gT - 1) * 100;
            return r;
        }
    }
}
