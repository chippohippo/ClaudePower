using System;
using System.Collections.Generic;
using System.Linq;
using System.Numerics;
using AimForge.Filters;

namespace AimForge.Core
{
    /// <summary>
    /// The measurement behind the two experimental Cadence Lock modes (XP_TOGGLES.md). Drives the SHIPPING CadenceCore
    /// on the 0.01 mm lattice at the pen's 360 Hz clock, the same core the plugin runs. Hypotheses and safety checks:
    ///   Intent Speed   - lower per-report gain noise on slow-to-medium ramp tracking (lattice alternation + orthogonal
    ///                    tremor); micro-aim and onset untouched (below the offset the gain is 1 either way); flick travel
    ///                    within a few % (the velocity EMA lags ~2 reports on the ramp); no gain flip on a turn.
    ///   Reversal Carry - more gain in the first 40 ms of a new strafe leg. Its safety cases (stop-and-settle, rest tremor,
    ///                    a gapped stroke, 10-20 mm flicks from rest and their correction) are pinned in the selftest; F here
    ///                    only covers a fast flick. (2026-09-24 review: the first version armed on all of those.)
    /// </summary>
    public static class XpLab
    {
        const double HZ = 360, DT = 1000.0 / HZ, UPM = 100;

        public sealed class Result
        {
            public double[] TrackMms = Array.Empty<double>();
            public double[] GainNoiseOffPct = Array.Empty<double>(), GainNoiseIntentPct = Array.Empty<double>();
            public double MicroOffMm, MicroIntentMm, MicroCarryMm, MicroHandMm;
            public double[] FlickMs = Array.Empty<double>(), FlickOffMm = Array.Empty<double>(), FlickIntentMm = Array.Empty<double>();
            public double TurnMaxGainStepOff, TurnMaxGainStepIntent;
            public double ReversalGainOff, ReversalGainCarry;       // mean gain over the first 40 ms of each new strafe leg
            public double ReversalTravelOffMm, ReversalTravelCarryMm;
            public double OvershootCorrOffMm, OvershootCorrCarryMm; // flick then a slow correction back
        }

        static CadenceCore Core(Preset p, Rig rig, bool intent, double carryMs)
        {
            var r = rig.Clone(); r.Engine = "cadence"; r.ReportHz = HZ; r.IntentSpeed = intent; r.ReversalCarryMs = carryMs;
            return OtdBridge.CadenceCoreFor(p, r);
        }

        /// Runs a path (mm, per report) through a core; returns output positions in mm and per-report gains.
        static (List<Vector2> outMm, List<double> gains) Drive(CadenceCore c, IList<Vector2> pathMm)
        {
            var o = new List<Vector2>(); var g = new List<double>();
            foreach (var pm in pathMm)
            {
                var q = new Vector2((float)Math.Round(pm.X * UPM), (float)Math.Round(pm.Y * UPM));   // tablet lattice
                var r = c.Filter(q, DT);
                o.Add(r / (float)UPM); g.Add(c.LastGain);
            }
            return (o, g);
        }

        public static Result Run(Preset p, Rig rig, double carryMs = Experiments.DefaultCarryMs, int seed = 5)
        {
            var res = new Result();
            var truthLut = Curve.EffectiveLut(p, rig.PxMm);

            // A. ramp tracking: 45-degree track at constant speed + one-unit orthogonal tremor, 2 s
            var speeds = new[] { 15.0, 20, 30, 45, 60 };
            res.TrackMms = speeds;
            res.GainNoiseOffPct = new double[speeds.Length]; res.GainNoiseIntentPct = new double[speeds.Length];
            for (int si = 0; si < speeds.Length; si++)
            {
                var rnd = new Random(seed + si); var path = new List<Vector2>();
                double s = speeds[si] * DT / 1000 / Math.Sqrt(2);
                for (int i = 0; i < 720; i++)
                {
                    double tr = (rnd.NextDouble() - 0.5) * 0.02;                                     // +/-0.01 mm orthogonal
                    path.Add(new Vector2((float)(100 + i * s + tr / Math.Sqrt(2)), (float)(100 + i * s - tr / Math.Sqrt(2))));
                }
                double gt = Curve.GainAt(truthLut, speeds[si]);
                double Noise(bool intent)
                {
                    var (_, gs) = Drive(Core(p, rig, intent, 0), path);
                    var e = gs.Skip(60).Select(x => x / gt - 1).ToArray();
                    double m = e.Average(); return Math.Sqrt(e.Select(x => (x - m) * (x - m)).Average()) * 100;
                }
                res.GainNoiseOffPct[si] = Noise(false); res.GainNoiseIntentPct[si] = Noise(true);
            }

            // B. micro-aim: one-unit tremor at rest + a 1.1 mm/s creep, 3 s; output travel vs hand travel
            {
                var rnd = new Random(seed); var path = new List<Vector2>();
                for (int i = 0; i < 1080; i++) path.Add(new Vector2((float)(100 + i * 1.1 * DT / 1000 + (rnd.Next(3) - 1) * 0.01), 100));
                double Travel(bool intent, double carry) { var (o, _) = Drive(Core(p, rig, intent, carry), path); return o[^1].X - o[0].X; }
                res.MicroHandMm = Math.Round(path[^1].X * UPM) / UPM - Math.Round(path[0].X * UPM) / UPM;
                res.MicroOffMm = Travel(false, 0); res.MicroIntentMm = Travel(true, 0); res.MicroCarryMm = Travel(false, carryMs);
            }

            // C. flicks: 40 mm minimum-jerk throws at three tempos; output travel
            res.FlickMs = new[] { 100.0, 150, 200 };
            res.FlickOffMm = new double[3]; res.FlickIntentMm = new double[3];
            for (int fi = 0; fi < 3; fi++)
            {
                int n = (int)Math.Round(res.FlickMs[fi] / DT); var path = new List<Vector2>();
                for (int i = 0; i < 20; i++) path.Add(new Vector2(100, 100));
                for (int i = 1; i <= n; i++) { double t = (double)i / n; path.Add(new Vector2((float)(100 + 40 * (10 * Math.Pow(t, 3) - 15 * Math.Pow(t, 4) + 6 * Math.Pow(t, 5))), 100)); }
                for (int i = 0; i < 20; i++) path.Add(path[^1]);
                double Out(bool intent) { var (o, _) = Drive(Core(p, rig, intent, 0), path); return o[^1].X - o[0].X; }
                res.FlickOffMm[fi] = Out(false); res.FlickIntentMm[fi] = Out(true);
            }

            // D. a 90-degree turn in a 60 mm/s track: largest report-to-report gain change
            {
                var path = new List<Vector2>(); var pos = new Vector2(100, 100); double st = 60 * DT / 1000;
                for (int i = 0; i < 200; i++) { pos += i < 100 ? new Vector2((float)st, 0) : new Vector2(0, (float)st); path.Add(pos); }
                double MaxStep(bool intent) { var (_, g) = Drive(Core(p, rig, intent, 0), path); double m = 0; for (int i = 30; i < g.Count; i++) m = Math.Max(m, Math.Abs(g[i] - g[i - 1])); return m; }
                res.TurnMaxGainStepOff = MaxStep(false); res.TurnMaxGainStepIntent = MaxStep(true);
            }

            // E. strafe tracking: 30 mm peak-to-peak at 1.5 Hz (peak ~141 mm/s), 4 s; the first 40 ms of each new leg
            {
                var path = new List<Vector2>(); int n = (int)(4 * HZ);
                for (int i = 0; i < n; i++) path.Add(new Vector2((float)(150 + 15 * Math.Sin(2 * Math.PI * 1.5 * i / HZ)), 100));
                var legStarts = new List<int>();
                for (int i = 2; i < n; i++) if (Math.Sign(path[i].X - path[i - 1].X) != Math.Sign(path[i - 1].X - path[i - 2].X) && i > 60) legStarts.Add(i);
                (double g, double mm) Rev(double carry)
                {
                    var (o, g) = Drive(Core(p, rig, false, carry), path);
                    int w = (int)Math.Round(40 / DT); double sg = 0, mm = 0; int c = 0;
                    foreach (var s in legStarts) for (int i = s; i < Math.Min(n, s + w); i++) { sg += g[i]; c++; mm += Math.Abs(o[i].X - o[i - 1].X); }
                    return (sg / Math.Max(1, c), mm / Math.Max(1, legStarts.Count));
                }
                (res.ReversalGainOff, res.ReversalTravelOffMm) = Rev(0);
                (res.ReversalGainCarry, res.ReversalTravelCarryMm) = Rev(carryMs);
            }

            // F. a 40 mm / 100 ms flick (peak ~750 mm/s) then a 1.5 mm correction back at 20 mm/s: carry must not arm
            {
                var path = new List<Vector2>(); int n = (int)Math.Round(100 / DT);
                for (int i = 0; i < 20; i++) path.Add(new Vector2(100, 100));
                for (int i = 1; i <= n; i++) { double t = (double)i / n; path.Add(new Vector2((float)(100 + 40 * (10 * Math.Pow(t, 3) - 15 * Math.Pow(t, 4) + 6 * Math.Pow(t, 5))), 100)); }
                var end = path[^1]; double cs = 20 * DT / 1000;
                for (int i = 1; i <= (int)(1.5 / cs); i++) path.Add(new Vector2((float)(end.X - i * cs), 100));
                double Corr(double carry) { var (o, _) = Drive(Core(p, rig, false, carry), path); return o[20 + n].X - o[^1].X; }
                res.OvershootCorrOffMm = Corr(0); res.OvershootCorrCarryMm = Corr(carryMs);
            }
            return res;
        }
    }
}
