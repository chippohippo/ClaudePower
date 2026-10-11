using System;
using System.Collections.Generic;
using System.Linq;
using System.Numerics;

namespace AimForge.Core
{
    /// <summary>
    /// CHAIN LAB (2026-10-11): the RawAccel engine as the bytes actually flow, from the three sources read line by line -
    ///  1. OpenTabletDriver v0.6.4.0 RelativeOutputMode: tablet position (0.01 mm lattice) x sensitivity -> a float px delta
    ///     per report (no rounding there).
    ///  2. VoiDPlugins VMultiRelativePointer (a69fe34): delta + carried error, split into extra packets while |remaining| > 127,
    ///     each packet the TRUNCATED integer, the fraction carried. A sub-count remainder still writes a 0,0 packet.
    ///  3. RawAccel driver.cpp (53a7213): per packet, time = the wall-clock interval since the previous packet clamped to
    ///     [1/16 ms, 100 ms] - or the fixed 1000/polling-rate when "constant time interval" is on; a 0,0 packet only advances
    ///     the clock; speed = |counts| / time; the legacy classic (or LUT) gain; output truncated, fraction carried.
    /// CadenceLab and Measure modelled the RawAccel engine's speed from the TABLET lattice; RawAccel reads the COUNT lattice
    /// after OTD and VMulti (1 count = 1/57 mm at 57 px/mm, 1.75x coarser) and divides by its own packet clock. This lab
    /// measures what that does to the gain, and compares three engines on the same hand:
    ///  - Wall:      RawAccel as configured today (wall clock);
    ///  - Constant:  RawAccel with "constant time interval" at the pen's measured 360 Hz (every packet priced as one report);
    ///  - Cadence:   Cadence Lock (the curve in tablet space on the pen clock, RawAccel flat).
    /// Score: the per-packet gain against the gain the HAND's true speed calls for, by band, and the aim error in degrees
    /// (delivered minus ideal output, over 100 ms windows) at the card's cm/360.
    /// </summary>
    public static class ChainLab
    {
        /// debug: per-report (i, dtObs, du, reports priced) for the cadence engines
        public static List<(int i, double dt, double du, double k, double g)>? Trace;
        public enum Engine { Wall, Constant, Cadence, CadenceDropCheck }
        /// how reports reach the host: plain USB jitter; every Nth report LATE by ~an interval (it lands just before the next
        /// one - one report of travel over a ~2-interval gap, then a ~0 gap); every Nth report DROPPED (the next one carries
        /// two reports of travel over a 2-interval gap).
        public enum Timing { Jitter, Late, Drop }

        public sealed class Band { public double NoisePct, BiasPct, WorstPct; public int N; }
        public sealed class Result
        {
            public Engine Engine; public string Scenario = "";
            public Band Slow = new(), Tap = new(), Track = new(), Fast = new();
            public double AimErrDeg100ms;      // std of the 100 ms change of (delivered - ideal), degrees
            public double EndErrDeg;           // delivered - ideal at the end of the scenario, degrees
            public int SplitPackets, ZeroPackets;
        }

        public const double HZ = 360.0, DT = 1000.0 / HZ, UPM = 100.0;

        /// a scenario: hand x(t) in mm over `seconds`
        public sealed record Scenario(string Name, double Seconds, Func<double, double> X);

        public static Scenario[] Scenarios => new[]
        {
            // micro: a 4 mm 1 Hz sway (peak 12.6 mm/s) - the unity pocket and the first ramp
            new Scenario("micro sway 4mm 1Hz", 4, t => 2.0 * Math.Sin(2 * Math.PI * 1.0 * t)),
            // tap band: 12 mm 1.2 Hz (peak 45 mm/s) - small corrections and slow tracking
            new Scenario("tap band 12mm 1.2Hz", 4, t => 6.0 * Math.Sin(2 * Math.PI * 1.2 * t)),
            // aim band: CadenceLab's stream, 50 mm p-p 1.5 Hz (peak 236 mm/s)
            new Scenario("aim band 50mm 1.5Hz", 4, t => 25.0 * Math.Sin(2 * Math.PI * 1.5 * t)),
            // flicks: 60 mm minimum-jerk in 110 ms (peak ~1020 mm/s), held, and back
            new Scenario("flick 60mm/110ms", 1.2, t => MinJerk(t - 0.1, 0.11, 60) - MinJerk(t - 0.7, 0.11, 60)),
        };

        static double MinJerk(double t, double T, double A)
        {
            if (t <= 0) return 0; if (t >= T) return A;
            double s = t / T; return A * (10 * s * s * s - 15 * s * s * s * s + 6 * s * s * s * s * s);
        }

        public static Result Run(Preset p, Rig rig, Scenario sc, Engine eng, double jitterPct = 10, int seed = 11, int mergeEvery = 0, Timing timing = Timing.Late)
        {
            var rnd = new Random(seed);
            double pxmm = rig.PxMm, mult = rig.Mult;
            var lut = Curve.EffectiveLut(p, pxmm);
            // the curve in the driver's units: counts/ms in, gain out (the same formulas the apply writes)
            Func<double, double> gainMmS = p.IsLut ? v => Curve.GainAt(lut, v)
                : v => Curve.ClassicGain(v * pxmm / 1000.0, p.adv.accel ?? 0, p.adv.offset ?? 0, p.adv.cap ?? 1);
            var res = new Result { Engine = eng, Scenario = sc.Name };
            var bands = new (double lo, double hi, Band b)[] { (0.5, 15.0, res.Slow), (15.0, 55.0, res.Tap), (55.0, 220.0, res.Track), (220.0, 5000.0, res.Fast) };
            var acc = bands.Select(_ => new List<(double e, double w)>()).ToArray();

            var cad = eng is Engine.Cadence or Engine.CadenceDropCheck ? OtdBridge.CadenceCoreFor(p, CadRig(rig)) : null;
            if (cad != null) cad.DropCheck = eng == Engine.CadenceDropCheck ? 1 : 0;   // 'Cadence' is the v1.2 core, whatever the rig default
            if (cad != null) cad.NominalHz = HZ;
            Vector2 cadPrev = default; bool cadPrimed = false;
            if (cad != null) { cadPrev = cad.Filter(new Vector2((float)Math.Round(sc.X(0) * UPM), 0), DT); cadPrimed = true; }   // the stroke is already under way

            int n = (int)(sc.Seconds * HZ);
            double prevU = Math.Round(sc.X(0) * UPM), trueU = prevU, prevArr = 0, vmErr = 0, raCarry = 0, lastPacketArr = 0;
            double delivered = 0, ideal = 0; var errHist = new List<double>();
            double degPerCount = 360.0 / (rig.Cm360 * 10 * pxmm * mult);
            // arrival offsets: a fixed 360 Hz clock seen through bounded USB jitter (+/-jitter% of one interval)
            double Arr(int i) => i * DT + (rnd.NextDouble() * 2 - 1) * jitterPct / 100.0 * DT * 0.5;
            for (int i = 1; i < n; i++)
            {
                double t = i / HZ, u = Math.Round(sc.X(t) * UPM);
                // the ideal: every TRUE report's delta at the gain its true speed calls for, in output counts
                // (CadenceLab's reference: the driver formula for classic, the table for LUT)
                double duTrue = u - trueU; trueU = u;
                double vTrue = Math.Abs(duTrue) / UPM / DT * 1000.0;                   // mm/s of the hand on the pen clock
                double gTrue = duTrue == 0 ? 1 : gainMmS(vTrue);
                ideal += duTrue / UPM * pxmm * mult * gTrue;
                bool marked = mergeEvery > 0 && i % mergeEvery == 0;
                if (marked && timing == Timing.Drop) { errHist.Add((delivered - ideal) * degPerCount); continue; }   // never reaches the host
                double arr = Arr(i);
                if (marked && timing == Timing.Late) arr = (i + 1) * DT - 0.05;          // held back until just before the next report
                if (arr <= prevArr) arr = prevArr + 0.02;
                double dtObs = arr - prevArr; prevArr = arr;
                double du = u - prevU; prevU = u;                                         // what the host sees (a drop folds two reports in)

                if (cad != null)
                {
                    // Cadence Lock evaluates in tablet space on the pen clock; its output is then a plain px delta, and RawAccel is flat
                    var q = new Vector2((float)u, 0);
                    var o = cad!.Filter(q, dtObs);
                    Trace?.Add((i, dtObs, du, cad.LastReports, cad.LastGain));
                    if (!cadPrimed) { cadPrimed = true; cadPrev = o; }
                    else
                    {
                        double dpx = (o.X - cadPrev.X) / UPM * pxmm * mult; cadPrev = o;
                        double rem = dpx + vmErr; int c = (int)rem; vmErr = rem - c; delivered += c;
                        if (du != 0) Score(vTrue, cad.LastGain / gTrue - 1);
                    }
                }
                else
                {
                    // OTD: float px delta; VMulti: carry, split at 127, truncate
                    double remaining = du / UPM * pxmm + vmErr;
                    var packets = new List<int>();
                    while (Math.Abs(remaining) > 127) { int part = Math.Sign(remaining) * 127; packets.Add(part); remaining -= part; }
                    vmErr = remaining % 1; packets.Add((int)remaining);
                    if (packets.Count > 1) res.SplitPackets += packets.Count - 1;
                    if (du == 0 && vmErr == 0) continue;                                // OTD sends nothing for an unchanged position (SetPosition returns)
                    for (int k = 0; k < packets.Count; k++)
                    {
                        double pa = arr + k * 0.01;                                      // split packets are written back to back
                        double time = eng == Engine.Constant ? 1000.0 / 360.0 : Math.Clamp(pa - lastPacketArr, 1000.0 / 8000 / 2, 100);
                        lastPacketArr = pa;
                        int c = packets[k];
                        if (c == 0) { res.ZeroPackets++; continue; }
                        double vSeen = Math.Abs(c) / time * 1000.0 / pxmm;               // what RawAccel reads, in mm/s
                        double g = gainMmS(vSeen);
                        double outv = c * g * mult + raCarry; int oc = (int)outv; raCarry = outv - oc; delivered += oc;
                        if (k == 0 && du != 0) Score(vTrue, g / gTrue - 1);
                    }
                }
                errHist.Add((delivered - ideal) * degPerCount);
            }
            void Score(double v, double e)
            {
                for (int b = 0; b < bands.Length; b++) if (v >= bands[b].lo && v < bands[b].hi) { acc[b].Add((e, 1)); break; }
            }
            for (int b = 0; b < bands.Length; b++)
            {
                var l = acc[b]; var bd = bands[b].b; bd.N = l.Count; if (l.Count < 2) continue;
                double m = l.Average(x => x.e); bd.BiasPct = m * 100;
                bd.NoisePct = Math.Sqrt(l.Average(x => (x.e - m) * (x.e - m))) * 100; bd.WorstPct = l.Max(x => Math.Abs(x.e)) * 100;
            }
            int w = (int)(0.1 * HZ);
            var d100 = Enumerable.Range(w, Math.Max(0, errHist.Count - w)).Select(i => errHist[i] - errHist[i - w]).ToList();
            if (d100.Count > 1) { double m = d100.Average(); res.AimErrDeg100ms = Math.Sqrt(d100.Average(x => (x - m) * (x - m))); }
            res.EndErrDeg = errHist.Count > 0 ? errHist[^1] : 0;
            return res;
        }

        static Rig CadRig(Rig r) { var c = r.Clone(); c.Engine = "cadence"; c.ReportHz = HZ; return c; }
    }
}
