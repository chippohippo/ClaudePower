using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Numerics;
using System.Text;
using AimForge.Filters;

namespace AimForge.Core
{
    /// <summary>
    /// HAND PRINT, the app side (2026-11-12): reads what the Cadence Lock recorder wrote (plugin/HandPrintCore.cs), merges
    /// sessions, and turns it into what a curve needs to know about ONE hand:
    ///   - where the hand lives in speed, hover vs tip down, re-expressed as OUTPUT rate (gain x speed) so recordings made
    ///     on different curves add up: the output is what the hand asked the game for, whatever curve delivered it;
    ///   - its strokes (duration, delivered travel, velocity shape), the input of the optimizer;
    ///   - the rig's timing health under real game load (queued bursts, late singles, drops);
    ///   - how it uses the tablet (occupancy, edge hits, lifts).
    /// Pen kinematics only. Nothing here knows a game.
    /// </summary>
    public sealed class HandPrint
    {
        public const int Bins = HandPrintCore.Bins;
        public sealed class Ep { public double DurMs, TravelMm, NetMm, OutMm, PeakMms, TPeakMs, TipFrac; public char End; }

        public int Files; public readonly List<string> Sessions = new(), Curves = new();
        public double Seconds, HandMm, OutMm, NominalHz = 360, WidthMm = 309, HeightMm = 174;
        public long Reports, Lifts, EdgeEnds, EpTotal;
        public readonly double[] SecHover = new double[Bins], SecTip = new double[Bins], MmHover = new double[Bins], MmTip = new double[Bins];
        public readonly double[] OutSecHover = new double[Bins], OutSecTip = new double[Bins];
        public readonly double[] Heat = new double[HandPrintCore.HeatW * HandPrintCore.HeatH];
        public readonly long[] Gap = new long[5];
        public readonly List<Ep> Episodes = new();

        /// The pen's path through this PC as the recorder measured it inside the daemon, kept apart by whether the session
        /// ran the Realtime Lane: [0] lane off, [1] lane on. EmitUs = the daemon's output stage after the curve (OTD's
        /// transform, the output mode, the VMulti write); JitterUs = how far plain reports arrived from the pen's clock.
        public sealed class PathStats
        {
            public readonly long[] EmitUs = new long[HandPrintCore.LatBins], JitterUs = new long[HandPrintCore.LatBins], Gap = new long[5];
            public double EmitMaxUs, Seconds; public int Files, MaxLane, Mmcss;
            public long EmitN => EmitUs.Sum();
            public double DisturbedPerMin => Seconds > 0 ? (Gap[1] + Gap[2] + Gap[3] + Gap[4]) / (Seconds / 60.0) : 0;
            public bool Enough => Seconds >= 120 && EmitN >= 20000;
        }
        public readonly PathStats[] Path = { new PathStats(), new PathStats() };

        /// The upper edge (microseconds) of the bin holding quantile q of a latency histogram; 0 when it is empty.
        public static double LatQuantile(long[] h, double q)
        {
            long tot = h.Sum(); if (tot == 0) return 0; long acc = 0;
            for (int i = 0; i < h.Length; i++) { acc += h[i]; if (acc >= q * tot) return HandPrintCore.LatHi(i); }
            return HandPrintCore.LatHi(h.Length - 1);
        }
        static string Us(double us) => us >= 1000 ? (us / 1000).ToString("0.##", CultureInfo.InvariantCulture) + " ms" : us.ToString("0", CultureInfo.InvariantCulture) + " µs";

        /// What the Realtime Lane changed on this PC, from sessions recorded with it off and on; null until both exist.
        /// +1 it helps, -1 it hurts, 0 no measurable difference.
        public (int verdict, string text)? LaneVerdict()
        {
            var off = Path[0]; var on = Path[1];
            if (!off.Enough || !on.Enough) return null;
            double pOff = LatQuantile(off.EmitUs, 0.999), pOn = LatQuantile(on.EmitUs, 0.999), jOff = LatQuantile(off.JitterUs, 0.99), jOn = LatQuantile(on.JitterUs, 0.99);
            double dOff = off.DisturbedPerMin, dOn = on.DisturbedPerMin;
            string facts = $"99.9% of reports left the daemon in under {Us(pOff)} with the lane off and under {Us(pOn)} with it on; 99% arrived within {Us(jOff)} / {Us(jOn)} of the pen's clock; " +
                           $"disturbed reports {dOff.ToString("0.0", CultureInfo.InvariantCulture)} / {dOn.ToString("0.0", CultureInfo.InvariantCulture)} a minute";
            bool better = pOn < pOff || jOn < jOff || (dOff > 1 && dOn < 0.5 * dOff), worse = pOn > pOff || jOn > jOff || (dOn > 1 && dOn > 2 * dOff);
            if (better && !worse) return (1, "the Realtime Lane HELPS on this PC: " + facts + ". Keep it on.");
            if (worse && !better) return (-1, "the Realtime Lane does NOT help on this PC: " + facts + ". Leave it off.");
            return (0, "no measurable difference from the Realtime Lane on this PC: " + facts + ". It is harmless here and not needed.");
        }

        public double Minutes => Seconds / 60.0;
        public double TipSeconds => SecTip.Sum();
        /// Enough to fit a curve to: 10 minutes of pen time and 400 strokes.
        public bool Sufficient => Seconds >= 600 && Episodes.Count >= 400;

        public static string[] FilesIn(string dir)
            => Directory.Exists(dir) ? Directory.GetFiles(dir, "handprint-*.txt").OrderBy(x => x, StringComparer.Ordinal).ToArray() : Array.Empty<string>();

        public static HandPrint? LoadDir(string dir)
        {
            var files = FilesIn(dir); if (files.Length == 0) return null;
            var hp = new HandPrint();
            foreach (var f in files) { try { hp.AddFile(File.ReadAllText(f)); } catch (IOException) { } }
            return hp.Files == 0 ? null : hp;
        }

        /// The gain function a "curve ..." header line describes (the plugin's own evaluation).
        public static Func<double, double> GainOf(string curveLine)
        {
            var inv = CultureInfo.InvariantCulture; var c = new CadenceCore(); var f = curveLine.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            if (f.Length >= 6 && f[1] == "classic")
            { c.ClassicAccel = double.Parse(f[2], inv); c.ClassicOffset = double.Parse(f[3], inv); c.ClassicCap = double.Parse(f[4], inv); c.ClassicExp = double.Parse(f[5], inv); }
            else if (f.Length >= 3 && f[1] == "lut")
                for (int i = 2; i < f.Length && i - 2 < CadenceCore.MaxPoints; i++) { var q = f[i].Split(':'); c.Vs[i - 2] = double.Parse(q[0], inv); c.Gs[i - 2] = double.Parse(q[1], inv); }
            else return _ => 1.0;
            return c.GainAt;
        }

        /// One recorder file. Unknown lines are ignored (a newer recorder may add some); a wrong magic is refused.
        public void AddFile(string text)
        {
            var inv = CultureInfo.InvariantCulture;
            var lines = text.Split('\n'); if (lines.Length == 0 || !lines[0].StartsWith("aimforge-handprint")) throw new InvalidDataException("not a hand print file");
            Func<double, double> g0 = _ => 1.0; double[]? sh = null, st = null; int epLeft = 0, lane = 0;
            PathStats ps() => Path[lane > 0 ? 1 : 0];
            double[] Row(string[] f, int n) { var a = new double[n]; for (int i = 0; i < n && i + 1 < f.Length; i++) a[i] = double.Parse(f[i + 1], inv); return a; }
            foreach (var raw in lines.Skip(1))
            {
                var line = raw.Trim(); if (line.Length == 0) continue;
                var f = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                if (epLeft > 0)
                {
                    epLeft--;
                    if (f.Length < 8) continue;
                    Episodes.Add(new Ep { DurMs = double.Parse(f[0], inv), TravelMm = double.Parse(f[1], inv), NetMm = double.Parse(f[2], inv), OutMm = double.Parse(f[3], inv),
                                          PeakMms = double.Parse(f[4], inv), TPeakMs = double.Parse(f[5], inv), TipFrac = double.Parse(f[6], inv), End = f[7][0] });
                    continue;
                }
                switch (f[0])
                {
                    case "session": Sessions.Add(f.Length > 1 ? f[1] : "?"); break;
                    case "nominalHz": if (f.Length > 1 && double.Parse(f[1], inv) > 0) NominalHz = double.Parse(f[1], inv); break;
                    case "curve": Curves.Add(line); g0 = GainOf(line); break;
                    case "lane": if (f.Length > 1) { lane = (int)double.Parse(f[1], inv); ps().MaxLane = Math.Max(ps().MaxLane, lane); } break;
                    case "mmcss": if (f.Length > 1 && f[1] == "1") ps().Mmcss++; break;
                    case "emitUs": for (int i = 0; i < HandPrintCore.LatBins && i + 1 < f.Length; i++) ps().EmitUs[i] += long.Parse(f[i + 1], inv); break;
                    case "jitterUs": for (int i = 0; i < HandPrintCore.LatBins && i + 1 < f.Length; i++) ps().JitterUs[i] += long.Parse(f[i + 1], inv); break;
                    case "emitMaxUs": if (f.Length > 1) ps().EmitMaxUs = Math.Max(ps().EmitMaxUs, double.Parse(f[1], inv)); break;
                    case "tablet": if (f.Length > 2) { WidthMm = double.Parse(f[1], inv); HeightMm = double.Parse(f[2], inv); } break;
                    case "totals":
                        for (int i = 1; i + 1 < f.Length; i += 2)
                        {
                            double v = double.Parse(f[i + 1], inv);
                            switch (f[i]) { case "seconds": Seconds += v; ps().Seconds += v; break; case "reports": Reports += (long)v; break; case "lifts": Lifts += (long)v; break;
                                            case "handMm": HandMm += v; break; case "outMm": OutMm += v; break; case "edgeEnds": EdgeEnds += (long)v; break; case "episodes": EpTotal += (long)v; break; }
                        }
                        break;
                    case "gapclass": for (int i = 0; i < 5 && i + 1 < f.Length; i++) { long n = long.Parse(f[i + 1], inv); Gap[i] += n; ps().Gap[i] += n; } break;
                    case "secHover": sh = Row(f, Bins); for (int i = 0; i < Bins; i++) SecHover[i] += sh[i]; break;
                    case "secTip": st = Row(f, Bins); for (int i = 0; i < Bins; i++) SecTip[i] += st[i]; break;
                    case "mmHover": { var a = Row(f, Bins); for (int i = 0; i < Bins; i++) MmHover[i] += a[i]; break; }
                    case "mmTip": { var a = Row(f, Bins); for (int i = 0; i < Bins; i++) MmTip[i] += a[i]; break; }
                    case "heat": { var a = Row(f, Heat.Length); for (int i = 0; i < Heat.Length; i++) Heat[i] += a[i]; break; }
                    case "episodes": epLeft = f.Length > 1 ? int.Parse(f[1], inv) : 0; break;
                }
            }
            // time by OUTPUT rate: each speed bin moved to where this file's curve delivered it
            for (int i = 0; i < Bins; i++)
            {
                double v = HandPrintCore.BinMid(i); int ob = HandPrintCore.BinOf(g0(v) * v);
                if (sh != null) OutSecHover[ob] += sh[i];
                if (st != null) OutSecTip[ob] += st[i];
            }
            Files++; ps().Files++;
        }

        public static string Kind(Ep e) => e.OutMm < 3 && e.TravelMm < 3 ? "micro" : e.PeakMms >= 150 && e.DurMs <= 300 ? "flick" : e.DurMs >= 300 ? "track" : "move";

        /// The hand speed at which a curve delivers a given output rate (gain x speed is monotonic for every legal curve).
        public static double SpeedForOutRate(Func<double, double> g, double outRate)
        {
            if (outRate <= 0) return 0;
            double lo = 0, hi = outRate * 4;
            for (int i = 0; i < 48; i++) { double mid = 0.5 * (lo + hi); if (g(mid) * mid < outRate) lo = mid; else hi = mid; }
            return 0.5 * (lo + hi);
        }

        /// Share of a time histogram (by output rate) that a curve places in its 1:1 band, on its ramp and on its cap.
        public static (double unity, double ramp, double cap) Zones(double[] outSec, Func<double, double> g, double bandMms, double capAtMms)
        {
            double u = 0, r = 0, c = 0;
            for (int i = 1; i < Bins; i++)   // bin 0 (under 1 mm/s) is rest, not aiming
            {
                if (outSec[i] <= 0) continue;
                double v = SpeedForOutRate(g, HandPrintCore.BinMid(i));
                if (v <= bandMms) u += outSec[i]; else if (v >= capAtMms) c += outSec[i]; else r += outSec[i];
            }
            double t = u + r + c; return t <= 0 ? (0, 0, 0) : (u / t, r / t, c / t);
        }

        static double Pct(IEnumerable<double> xs, double q)
        {
            var a = xs.OrderBy(x => x).ToArray(); if (a.Length == 0) return 0;
            double i = q * (a.Length - 1); int lo = (int)Math.Floor(i), hi = Math.Min(a.Length - 1, lo + 1);
            return a[lo] + (a[hi] - a[lo]) * (i - lo);
        }
        public double PeakPercentile(double q) => Pct(Episodes.Select(e => e.PeakMms), q);

        /// What the recording says, in the player's words, against the card it will be compared with.
        public string Report(Preset card)
        {
            var inv = CultureInfo.InvariantCulture; var sb = new StringBuilder();
            string P(double x) => (x * 100).ToString("0", inv) + "%";
            var rg = Rig.From(card); var core = OtdBridge.CadenceCoreFor(card, rg); Func<double, double> g = core.GainAt;
            var dials = Dials.Of(card);
            sb.AppendLine($"HAND PRINT - {Minutes.ToString("0.0", inv)} min of pen time, {Episodes.Count} strokes, {Files} session file{(Files == 1 ? "" : "s")}" + (Sufficient ? "" : "   [NOT ENOUGH YET: 10 min and 400 strokes make a fit]"));
            if (Seconds <= 0) return sb.ToString();

            long total = Gap.Sum();
            if (total > 0)
            {
                double perMin(long n) => n / Math.Max(1e-9, Minutes);
                sb.AppendLine($"Timing under load: {(100.0 * Gap[0] / total).ToString("0.00", inv)}% plain reports · queued bursts {perMin(Gap[1]).ToString("0.0", inv)}/min · late singles {perMin(Gap[2]).ToString("0.0", inv)}/min · " +
                              $"drops {perMin(Gap[3]).ToString("0.0", inv)}/min · unjudged long gaps {perMin(Gap[4]).ToString("0.0", inv)}/min");
                double stalls = perMin(Gap[1] + Gap[2] + Gap[4]);
                sb.AppendLine(stalls > 30 ? "  -> the host stalls often while you play: turn the Realtime Lane on (Engine tab) and keep the burst-armed drop check (plugin 1.4)"
                            : stalls > 3 ? "  -> some host stalls: the burst-armed drop check prices them right; the Realtime Lane should thin them out"
                                         : "  -> clean: the rig delivers the pen's clock");
            }

            // the pen's path through this PC, measured inside the daemon
            if (Path[0].EmitN + Path[1].EmitN > 0)
            {
                sb.AppendLine("Pen path on this PC (measured inside the daemon; the curve itself costs about 0.0001 ms a report):");
                for (int li = 0; li < 2; li++)
                {
                    var q = Path[li]; if (q.EmitN == 0) continue;
                    sb.AppendLine($"  lane {(li == 0 ? "off" : "ON" + (q.MaxLane > 1 ? " (level " + q.MaxLane + (q.Mmcss > 0 ? ", pro-audio class live" : "") + ")" : ""))}, {(q.Seconds / 60).ToString("0.0", inv)} min: " +
                                  $"output stage (to the VMulti write) half under {Us(LatQuantile(q.EmitUs, 0.5))} · 99% under {Us(LatQuantile(q.EmitUs, 0.99))} · 99.9% under {Us(LatQuantile(q.EmitUs, 0.999))} · worst {Us(q.EmitMaxUs)}" +
                                  $" | arrival off the pen's clock: half within {Us(LatQuantile(q.JitterUs, 0.5))} · 99% within {Us(LatQuantile(q.JitterUs, 0.99))}");
                }
                if (LaneVerdict() is var (_, txt)) sb.AppendLine("  -> " + txt);
                else sb.AppendLine(Path[1].EmitN == 0 ? "  -> record a few minutes with the Realtime Lane ON to see what it changes on this PC" : Path[0].EmitN == 0 ? "  -> record a few minutes with the Realtime Lane OFF to compare" : "  -> two minutes of each (lane off, lane on) make the comparison");
            }

            double tip = TipSeconds, all = tip + SecHover.Sum();
            sb.AppendLine($"Tip down {P(all > 0 ? tip / all : 0)} of the time" + (tip < 0.05 * all ? "  (little tip time: fire is probably on a key - the firing figures below use ALL motion)" : ""));
            var fireHist = tip >= 0.05 * all ? OutSecTip : OutSecTip.Zip(OutSecHover, (a, b) => a + b).ToArray();
            if (dials is Dials d)
            {
                var zf = Zones(fireHist, g, d.Band, d.CapAt); var zh = Zones(OutSecHover, g, d.Band, d.CapAt);
                sb.AppendLine($"On {card.name} ({d}):");
                sb.AppendLine($"  firing:  {P(zf.unity)} of moving time in the 1:1 band · {P(zf.ramp)} on the ramp · {P(zf.cap)} on the cap");
                sb.AppendLine($"  aiming:  {P(zh.unity)} in the 1:1 band · {P(zh.ramp)} on the ramp · {P(zh.cap)} on the cap   (hover)");
            }

            var kinds = Episodes.GroupBy(Kind).ToDictionary(k => k.Key, k => k.ToList());
            int n = Math.Max(1, Episodes.Count);
            int Cnt(string k) => kinds.TryGetValue(k, out var l) ? l.Count : 0;
            sb.AppendLine($"Strokes: micro {P((double)Cnt("micro") / n)} · flicks {P((double)Cnt("flick") / n)} · tracking {P((double)Cnt("track") / n)} · other moves {P((double)Cnt("move") / n)}");
            if (kinds.TryGetValue("flick", out var fl) && fl.Count >= 5)
                sb.AppendLine($"  flicks: peak speed {Pct(fl.Select(e => e.PeakMms), 0.1).ToString("0", inv)} / {Pct(fl.Select(e => e.PeakMms), 0.5).ToString("0", inv)} / {Pct(fl.Select(e => e.PeakMms), 0.9).ToString("0", inv)} mm/s (10th / median / 90th) · " +
                              $"hand travel {Pct(fl.Select(e => e.TravelMm), 0.5).ToString("0.0", inv)} mm · {Pct(fl.Select(e => e.DurMs), 0.5).ToString("0", inv)} ms" +
                              (dials is Dials d2 ? $" · {P(fl.Count(e => e.PeakMms >= d2.CapAt) / (double)fl.Count)} reach the cap" : ""));
            if (kinds.TryGetValue("track", out var tr) && tr.Count >= 5)
                sb.AppendLine($"  tracking: {Pct(tr.Select(e => e.DurMs), 0.5).ToString("0", inv)} ms long, mean speed {Pct(tr.Select(e => e.TravelMm / Math.Max(1, e.DurMs) * 1000), 0.5).ToString("0", inv)} mm/s, peak {Pct(tr.Select(e => e.PeakMms), 0.5).ToString("0", inv)} mm/s (medians)");

            double heatT = Heat.Sum();
            if (heatT > 0)
            {
                double centre = 0; for (int y = 1; y <= 2; y++) for (int x = 2; x <= 5; x++) centre += Heat[y * HandPrintCore.HeatW + x];
                sb.AppendLine($"Tablet: {P(centre / heatT)} of the time in the centre half · {P(EdgeEnds / (double)Math.Max(1, EpTotal))} of strokes end within {HandPrintCore.EdgeMm:0} mm of an edge · {(Lifts / Math.Max(1e-9, Minutes)).ToString("0.0", inv)} lifts/min");
            }
            return sb.ToString();
        }

        // ---- a synthetic hand, through the REAL recorder (selftests and --handprint --demo) ----
        public sealed class SynthSpec
        {
            public double Minutes = 12, FlickPeakMms = 420, FlickOutMm = 120, TrackMms = 28, TrackSeconds = 1.2, MicroMm = 0.8;
            public double FlickShare = 0.25, TrackShare = 0.35;   // the rest: micro corrections
            public bool TipOnTrack = true; public int Seed = 5;
        }

        /// A hand with the given habits, played through a Cadence core running `card` and recorded by HandPrintCore -
        /// returned as the recorder's own file text.
        public static string Synthetic(Preset card, SynthSpec s)
        {
            var rg = Rig.From(card); rg.Engine = "cadence"; rg.ReportHz = 360;
            var core = OtdBridge.CadenceCoreFor(card, rg); var hp = new HandPrintCore(); var rnd = new Random(s.Seed);
            const double DT = 1000.0 / 360.0, UPM = 100.0;
            double x = 150, y = 85, t = 0, endMs = s.Minutes * 60000.0; var prev = new Vector2((float)(x * UPM), (float)(y * UPM)); core.Filter(prev, DT);
            double dir = 0;
            void Step(double nx, double ny, bool tip)
            {
                // the pen reports the 0.01 mm lattice; keep the hand inside the tablet
                nx = Math.Clamp(nx, 5, 304); ny = Math.Clamp(ny, 5, 169);
                var pos = new Vector2((float)Math.Round(nx * UPM), (float)Math.Round(ny * UPM));
                core.Filter(pos, DT);
                hp.Tick((pos.X - prev.X) / UPM, (pos.Y - prev.Y) / UPM, core.LastReports, DT, core.LastSpeedMms, core.LastGain, tip, pos.X / UPM, pos.Y / UPM, core.LastGapClass);
                prev = pos; x = pos.X / UPM; y = pos.Y / UPM; t += DT;
            }
            void Rest(double ms) { for (double e = 0; e < ms; e += DT) Step(x, y, false); }
            // a minimum-jerk stroke of `travel` mm in `ms`, along heading `ang`
            void Stroke(double travel, double ms, double ang, bool tip)
            {
                double x0 = x, y0 = y; int steps = Math.Max(2, (int)Math.Round(ms / DT));
                for (int i = 1; i <= steps; i++)
                {
                    double q = (double)i / steps, sPos = q * q * q * (10 - 15 * q + 6 * q * q);
                    Step(x0 + Math.Cos(ang) * travel * sPos, y0 + Math.Sin(ang) * travel * sPos, tip);
                }
            }
            Func<double, double> g = core.GainAt;
            while (t < endMs)
            {
                double u = rnd.NextDouble(); dir += Math.PI * (0.6 + 0.8 * rnd.NextDouble());   // alternate roughly back and forth: stay on the tablet
                if (u < s.FlickShare)
                {
                    // a flick: the travel that delivers FlickOutMm of output at this peak speed (min-jerk peak = 1.875 x mean)
                    double peak = s.FlickPeakMms * Math.Exp(0.18 * (rnd.NextDouble() * 2 - 1)), outMm = s.FlickOutMm * Math.Exp(0.35 * (rnd.NextDouble() * 2 - 1));
                    double travel = outMm / Math.Max(1.0, g(peak * 0.75)), ms = Math.Max(40, 1.875 * travel / peak * 1000.0);
                    Stroke(travel, ms, dir, false); Rest(60 + 120 * rnd.NextDouble());
                    Stroke(s.MicroMm * (0.5 + rnd.NextDouble()), 45, dir + Math.PI, false); Rest(80);
                }
                else if (u < s.FlickShare + s.TrackShare)
                {
                    // a track: steady speed with a slow wobble, tip down (firing)
                    double v = s.TrackMms * Math.Exp(0.25 * (rnd.NextDouble() * 2 - 1)), secs = s.TrackSeconds * (0.6 + 0.8 * rnd.NextDouble());
                    int steps = (int)(secs * 360); double ph = rnd.NextDouble() * 6.28;
                    for (int i = 0; i < steps; i++)
                    {
                        double vv = v * (1 + 0.15 * Math.Sin(ph + i * 0.05)) * Math.Min(1.0, Math.Min(i, steps - i) / 12.0);
                        Step(x + Math.Cos(dir) * vv * DT / 1000.0, y + Math.Sin(dir) * vv * DT / 1000.0, s.TipOnTrack);
                    }
                    Rest(120 + 200 * rnd.NextDouble());
                }
                else { Stroke(s.MicroMm * (0.5 + rnd.NextDouble()), 50 + 40 * rnd.NextDouble(), dir, rnd.NextDouble() < 0.4); Rest(100 + 250 * rnd.NextDouble()); }
                if (rnd.NextDouble() < 0.03) { hp.Break(true); core.Reset(); x = 150; y = 85; prev = new Vector2((float)(x * UPM), (float)(y * UPM)); core.Filter(prev, DT); }
            }
            hp.Break(true);
            var inv = CultureInfo.InvariantCulture;
            string curve = core.IsClassic ? string.Format(inv, "curve classic {0:0.#########} {1:0.######} {2:0.####} {3:0.####}", core.ClassicAccel, core.ClassicOffset, core.ClassicCap, core.ClassicExp)
                                          : "curve lut " + string.Join(" ", Enumerable.Range(0, CadenceCore.MaxPoints).Where(i => core.Vs[i] > 0).Select(i => string.Format(inv, "{0:0.###}:{1:0.####}", core.Vs[i], core.Gs[i])));
            return hp.Serialize("session synthetic-" + s.Seed + "\nnominalHz 360\n" + curve);
        }
    }
}
