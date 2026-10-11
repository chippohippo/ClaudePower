using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Numerics;
using System.Text.Json;
using AimForge.Filters;
using CoherenceStabilizer;

namespace AimForge.Core
{
    /// <summary>
    /// NIB TWIN (2026-09-24, XP_TOGGLES.md; chosen by a designer panel + judge, ev-20260924-nib-twin).
    ///
    /// Pressing the tip to fire moves the reported position: the tilted nib compresses and the coil swings ~0.3 mm
    /// (the Tap Anchor's measured skid). The Tap Anchor pins it only while the pen is still - by design it lets go the
    /// moment the hand travels - so every shot fired while MOVING (a strafing spray, a flick-shot, a tracking tap)
    /// carries the swing into the camera. The swing is mechanically locked to the pressure ramp, and pressure is the one
    /// signal the project's physics says separates click-caused motion from intent. So a calibrated feed-forward model
    /// removes it on the same report, moving or still, and never touches gain: CadenceCore.NibTwin.
    ///
    /// This file holds the calibration record (nibtwin.json), the fit from the plugin's press log, and the lab that
    /// drives the SHIPPING stabilizer pin (CoherenceCore) into the SHIPPING CadenceCore to measure it.
    /// </summary>
    public sealed class NibCal
    {
        public double SkidXmm { get; set; }
        public double SkidYmm { get; set; }
        public double SkidFullPressure { get; set; } = 0.35;
        public double SkidGamma { get; set; } = 1.0;
        public double SkidLagReports { get; set; }
        public double R2 { get; set; }
        public int Taps { get; set; }
        public double TapPeakMedian { get; set; }
        public double TapPeakP90 { get; set; }
        public double PerTapMagSpreadPct { get; set; }
        public double PerTapAngleSpreadDeg { get; set; }
        public string CalibratedAt { get; set; } = "";
        public string Source { get; set; } = "";

        public double MagMm => Math.Sqrt(SkidXmm * SkidXmm + SkidYmm * SkidYmm);
        public double AngleDeg => Math.Atan2(SkidYmm, SkidXmm) * 180 / Math.PI;

        public const double MinR2 = 0.8, MinMagMm = 0.1, MaxMagMm = 0.6; public const int MinTaps = 12;

        /// Null when the calibration may be applied; otherwise the reason it may not.
        public string? Invalid()
        {
            if (!(double.IsFinite(SkidXmm) && double.IsFinite(SkidYmm) && double.IsFinite(SkidFullPressure) && double.IsFinite(SkidGamma))) return "calibration has non-finite values";
            if (Taps < MinTaps) return $"calibration used {Taps} settled taps (needs {MinTaps})";
            if (R2 < MinR2) return $"calibration fit R2 {R2:0.00} is below {MinR2} (the swing does not follow pressure for this grip)";
            if (MagMm < MinMagMm) return $"calibrated swing {MagMm:0.000} mm is below {MinMagMm} mm - an upright grip has no skid, and the twin would only inject one";
            if (MagMm > MaxMagMm) return $"calibrated swing {MagMm:0.000} mm is above {MaxMagMm} mm - not a nib swing; recalibrate with the pen settled";
            if (!(SkidFullPressure > 0.01 && SkidFullPressure <= 1)) return "calibration full-press pressure out of range";
            return null;
        }

        public static string DefaultPath => Path.Combine(AppContext.BaseDirectory, "nibtwin.json");
        public static NibCal? Load(string? path = null)
        {
            try { var f = path ?? DefaultPath; return File.Exists(f) ? JsonSerializer.Deserialize<NibCal>(File.ReadAllText(f)) : null; }
            catch { return null; }
        }
        public void Save(string? path = null)
            => File.WriteAllText(path ?? DefaultPath, JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true }));

        public void ApplyTo(Rig r) { r.SkidXmm = SkidXmm; r.SkidYmm = SkidYmm; r.SkidFullPressure = SkidFullPressure; r.SkidGamma = SkidGamma; r.SkidLagReports = SkidLagReports; }
    }

    /// <summary>
    /// Fits the nib swing from the plugin's press log (Nib Twin Probe 1: "#press" blocks of "dtMs pressure01 x y"
    /// lines, tablet units). Only SETTLED taps are used (lead-in speed and drift small, no gap), so hand motion cannot
    /// pose as swing. Least squares of the per-report position change against the change of h(p) = min(1, (p/knee)^gamma),
    /// over a knee x gamma x lag grid (the nib saturates: a harder tap swings no further). The guard R2 is taken over
    /// the rows where the model predicts swing.
    /// </summary>
    public static class NibFit
    {
        public sealed class Result { public NibCal? Cal; public string? Refused; public int Presses, Settled; public string Report = ""; public Rig? Restored; }

        sealed class Press { public List<double> Dt = new(), P = new(), X = new(), Y = new(); }

        static List<Press> Parse(IEnumerable<string> lines)
        {
            var o = new List<Press>(); Press? cur = null;
            foreach (var raw in lines)
            {
                var l = raw.Trim();
                if (l.Length == 0) continue;
                if (l.StartsWith("#press")) { cur = new Press(); o.Add(cur); continue; }
                if (cur == null) continue;
                var f = l.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                if (f.Length < 4) continue;
                if (!double.TryParse(f[0], NumberStyles.Float, CultureInfo.InvariantCulture, out var dt) ||
                    !double.TryParse(f[1], NumberStyles.Float, CultureInfo.InvariantCulture, out var p) ||
                    !double.TryParse(f[2], NumberStyles.Float, CultureInfo.InvariantCulture, out var x) ||
                    !double.TryParse(f[3], NumberStyles.Float, CultureInfo.InvariantCulture, out var y)) continue;
                cur.Dt.Add(dt); cur.P.Add(p); cur.X.Add(x); cur.Y.Add(y);
            }
            return o;
        }

        /// A row across a longer gap is not pen motion (OTD's relative mode drops it; a lift re-enters anywhere).
        public const double GapMs = 50;

        public static Result Fit(IEnumerable<string> lines, double unitsPerMm = 100, string source = "")
        {
            var res = new Result();
            var presses = Parse(lines); res.Presses = presses.Count;
            // settled: the 20-report lead-in (pressure 0) moved less than 0.3 mm and its median speed is under 10 mm/s, and
            // no gap/lift in the lead-in or the first reports of the press
            var ok = new List<Press>();
            foreach (var pr in presses)
            {
                int first = pr.P.FindIndex(v => v > 0);
                if (first < 5 || pr.P.Count < first + 10) continue;
                bool gap = false;
                for (int i = 1; i <= Math.Min(pr.Dt.Count - 1, first + 5); i++) if (pr.Dt[i] > GapMs) { gap = true; break; }
                if (gap) continue;
                var sp = new List<double>();
                for (int i = 1; i < first; i++) sp.Add(Math.Sqrt(Math.Pow(pr.X[i] - pr.X[i - 1], 2) + Math.Pow(pr.Y[i] - pr.Y[i - 1], 2)) / unitsPerMm / Math.Max(0.1, pr.Dt[i]) * 1000);
                double drift = Math.Sqrt(Math.Pow(pr.X[first - 1] - pr.X[0], 2) + Math.Pow(pr.Y[first - 1] - pr.Y[0], 2)) / unitsPerMm;
                sp.Sort(); double med = sp.Count > 0 ? sp[sp.Count / 2] : 0;
                if (med < 10 && drift < 0.3) ok.Add(pr);
            }
            res.Settled = ok.Count;
            if (ok.Count < NibCal.MinTaps) { res.Refused = $"only {ok.Count} settled taps in {presses.Count} presses (needs {NibCal.MinTaps}): tap with the pen still, one tap a second"; return res; }
            var peaks = ok.Select(pr => pr.P.Max()).OrderBy(v => v).ToList();
            double pMed = peaks[peaks.Count / 2], p90 = peaks[(int)Math.Min(peaks.Count - 1, Math.Round(0.9 * (peaks.Count - 1)))];

            // each press's rows: from 2 reports before the first pressure to 25 after the last, cut at the first gap
            var win = new List<(Press pr, int a, int b)>();
            foreach (var pr in ok)
            {
                int first = pr.P.FindIndex(v => v > 0), last = pr.P.FindLastIndex(v => v > 0);
                int a = Math.Max(1, first - 2), b = Math.Min(pr.P.Count - 1, last + 25);
                for (int i = a; i <= b; i++) if (pr.Dt[i] > GapMs) { b = i - 1; break; }
                if (b > a) win.Add((pr, a, b));
            }

            // the knee is FITTED (2026-09-24 review: pinned at the median tap peak, a firm tapper on a nib that saturates
            // early could never calibrate): candidates from 0.10 up to the p90 peak, with gamma and lag
            var knees = new List<double>();
            for (double k = 0.10; k <= p90 + 1e-9; k += 0.05) knees.Add(Math.Round(k, 3));
            knees.Add(pMed); knees.Add(p90);
            knees = knees.Where(k => k > 0.02 && k <= 1).Distinct().OrderBy(k => k).ToList();

            double H(Press pr, int i, int lag, double knee, double gm) { int j = i - lag; if (j < 0) return 0; return Math.Min(1.0, Math.Pow(Math.Min(1.0, Math.Max(0, pr.P[j])) / knee, gm)); }
            double bestRss = double.PositiveInfinity, bestSx = 0, bestSy = 0, bestG = 1, bestK = pMed; int bestLag = 0;
            foreach (double knee in knees)
                for (double gm = 0.5; gm <= 1.601; gm += 0.1)
                    for (int lag = 0; lag <= 2; lag++)
                    {
                        double shh = 0, sxh = 0, syh = 0, sxx = 0;
                        foreach (var (pr, a, b) in win)
                            for (int i = a; i <= b; i++)
                            {
                                double dh = H(pr, i, lag, knee, gm) - H(pr, i - 1, lag, knee, gm), dx = pr.X[i] - pr.X[i - 1], dy = pr.Y[i] - pr.Y[i - 1];
                                shh += dh * dh; sxh += dh * dx; syh += dh * dy; sxx += dx * dx + dy * dy;
                            }
                        if (shh <= 1e-12) continue;
                        double sx = sxh / shh, sy = syh / shh;
                        // residual of the least-squares fit, in closed form (the window rows are the same for every model)
                        double rss = sxx - (sxh * sxh + syh * syh) / shh;
                        if (rss < bestRss - 1e-9) { bestRss = rss; bestSx = sx; bestSy = sy; bestG = gm; bestLag = lag; bestK = knee; }
                    }
            if (double.IsInfinity(bestRss)) { res.Refused = "no pressure change in the logged presses"; return res; }

            // the guard: how much of the motion WHILE the model predicts swing it explains (2026-09-24 review: R2 over every
            // window row measured the hold and post-release tremor share, and one lift refused an exact calibration)
            // Only rows whose predicted swing is at least half a lattice step count: hold rows where the pressure reading
            // wobbles below the knee predict a sub-lattice swing and would enter with their whole tremor (2026-09-24 review:
            // long holds of light taps were refused although the fit was right).
            double rssA = 0, totA = 0, sMag = Math.Sqrt(bestSx * bestSx + bestSy * bestSy);
            foreach (var (pr, a, b) in win)
                for (int i = a; i <= b; i++)
                {
                    double dh = H(pr, i, bestLag, bestK, bestG) - H(pr, i - 1, bestLag, bestK, bestG);
                    if (Math.Abs(dh) * sMag < 0.5) continue;
                    double dx = pr.X[i] - pr.X[i - 1], dy = pr.Y[i] - pr.Y[i - 1];
                    rssA += Math.Pow(dx - bestSx * dh, 2) + Math.Pow(dy - bestSy * dh, 2); totA += dx * dx + dy * dy;
                }
            double r2 = totA > 1e-12 ? 1 - rssA / totA : 0;

            // per-tap consistency of the swing at the chosen model; the angle spread is circular (+/-180 deg wraps)
            var mags = new List<double>(); var angs = new List<double>();
            foreach (var pr in ok)
            {
                int first = pr.P.FindIndex(v => v > 0), pk = pr.P.IndexOf(pr.P.Max());
                double hx = pr.X[Math.Min(pr.X.Count - 1, pk + bestLag)] - pr.X[Math.Max(0, first - 1)], hy = pr.Y[Math.Min(pr.Y.Count - 1, pk + bestLag)] - pr.Y[Math.Max(0, first - 1)];
                double hp = Math.Min(1.0, Math.Pow(pr.P[pk] / bestK, bestG));
                if (hp > 0.2) { mags.Add(Math.Sqrt(hx * hx + hy * hy) / hp / unitsPerMm); angs.Add(Math.Atan2(hy, hx)); }
            }
            double mMean = mags.Count > 0 ? mags.Average() : 0;
            double aMean = angs.Count > 0 ? Math.Atan2(angs.Sum(Math.Sin), angs.Sum(Math.Cos)) : 0;
            double Wrap(double d) { while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }
            var cal = new NibCal
            {
                SkidXmm = bestSx / unitsPerMm, SkidYmm = bestSy / unitsPerMm, SkidFullPressure = bestK, SkidGamma = Math.Round(bestG, 2), SkidLagReports = bestLag,
                R2 = Math.Round(r2, 4), Taps = ok.Count, TapPeakMedian = pMed, TapPeakP90 = p90,
                PerTapMagSpreadPct = mMean > 0 ? Math.Sqrt(mags.Average(m => (m - mMean) * (m - mMean))) / mMean * 100 : 0,
                PerTapAngleSpreadDeg = angs.Count > 0 ? Math.Sqrt(angs.Average(a => Wrap(a - aMean) * Wrap(a - aMean))) * 180 / Math.PI : 0,
                CalibratedAt = DateTime.Now.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture), Source = source
            };
            res.Cal = cal;
            res.Refused = cal.Invalid();
            res.Report = string.Format(CultureInfo.InvariantCulture,
                "{0} presses, {1} settled taps; swing {2:0.000} mm at {3:0.0} deg; knee {4:0.000} (tap peaks median {5:0.000}, p90 {6:0.000}); gamma {7:0.0}, lag {8}; R2 {9:0.000} over the swing rows; per-tap spread {10:0}% / {11:0} deg",
                presses.Count, ok.Count, cal.MagMm, cal.AngleDeg, bestK, pMed, p90, cal.SkidGamma, bestLag, cal.R2, cal.PerTapMagSpreadPct, cal.PerTapAngleSpreadDeg);
            return res;
        }
    }

    /// <summary>
    /// The measurement: hand + modelled nib swing on the 0.01 mm lattice at 360 Hz -> the SHIPPING stabilizer pin
    /// (CoherenceCore, mm) -> the SHIPPING CadenceCore (curve + twin, tablet units). Error is the camera against the
    /// hand's own aim through the same curve with no swing and no pin, in degrees at the card's cm/360.
    /// Skid model (the project's tapdiag): 0.30 mm toward (-0.8, 0.6), saturating at 30% pressure, 12 ms press ramp,
    /// 18 ms release, 15% hand-flexion residual that does not spring back, click at 2% pressure, 0.03 mm tremor.
    /// Every number here is MODEL-based until a --nib-calibrate log from the real pen replaces the skid model.
    /// </summary>
    public static class NibLab
    {
        const double HZ = 360, DT = 1000.0 / HZ, UPM = 100, TIP = 0.02;
        public static readonly Vector2 SkidDir = Vector2.Normalize(new Vector2(-0.8f, 0.6f));
        public const double SkidMm = 0.30, SkidSatP = 0.30, PeakP = 0.35, Resid = 0.15;

        public sealed class Config
        {
            public string Name = ""; public bool Pin = true; public double PinFade; public bool Twin; public double TapHold = 30, TapBreak = 0.9;
            public double CalScale = 1, CalRotDeg = 0; public double TrueSkidMm = SkidMm;
            /// Physics: the swing trails the pressure by this many reports (2026-09-24 review: no lag was ever exercised).
            public int SwingLag;
            /// The twin's calibration (e.g. a NibFit result); null = the ideal one for the model physics.
            public NibCal? Cal;
            /// Physics: the hand flexion of the press without the nib swing itself (the reference of the skid-only metric).
            public bool FlexOnly;
            public Config Clone() => (Config)MemberwiseClone();
        }

        public static NibCal ModelCal() => new NibCal { SkidXmm = SkidDir.X * SkidMm, SkidYmm = SkidDir.Y * SkidMm, SkidFullPressure = SkidSatP, SkidGamma = 1, R2 = 0.95, Taps = 20 };

        static CoherenceCore Pin(Config c)
        {
            var s = new CoherenceCore { TremorWindowMs = 70, HoldTimeMs = 0, FullPassSpeed = 8, EngageSpeed = 3, CoherenceFloor = 0.3, CoherenceCeiling = 0.55, MaxLag = 1.0, ResetMs = 50 };
            if (c.Pin) { s.TapAnchor = 1; s.TapArmPressure = 0.01; s.TapHoldMs = c.TapHold; s.TapBreakMm = c.TapBreak; s.TapMoveFade = c.PinFade; }
            return s;
        }

        static CadenceCore Curve(Preset p)
        {
            var r = Rig.From(p); r.Engine = "cadence"; r.ReportHz = HZ;
            return OtdBridge.CadenceCoreFor(p, r);
        }

        /// The twin as the calibration would configure it (scaled/rotated for the mismatch sweep); null when off.
        public static NibTwinCore? Twin(Config c)
        {
            if (!c.Twin) return null;
            double bx = c.Cal?.SkidXmm ?? SkidDir.X * SkidMm, by = c.Cal?.SkidYmm ?? SkidDir.Y * SkidMm;
            double ang = c.CalRotDeg * Math.PI / 180, x = bx * c.CalScale, y = by * c.CalScale;
            return new NibTwinCore { Twin = 1, SkidXmm = x * Math.Cos(ang) - y * Math.Sin(ang), SkidYmm = x * Math.Sin(ang) + y * Math.Cos(ang),
                                     SkidFullPressure = c.Cal?.SkidFullPressure ?? SkidSatP, SkidGamma = c.Cal?.SkidGamma ?? 1, SkidLagReports = c.Cal?.SkidLagReports ?? 0 };
        }

        /// One report through the chain the apply builds: pen (mm) -> Nib Twin -> stabilizer pin -> curve (units).
        static Vector2 Chain(NibTwinCore? twin, CoherenceCore pin, CadenceCore cur, Vector2 penMm, double pr)
        {
            var t = twin != null ? twin.Filter(penMm, DT, pr) : penMm;
            return cur.Filter(pin.Filter(t, DT, pr) * (float)UPM, DT);
        }

        /// One run: hand path (mm) and pressure per report; returns error (deg) per report and the click index.
        public static (double[] errDeg, int click) Run(Preset p, Config c, Func<int, Vector2> hand, Func<int, double> pressure, int n, int seed, double forceScale = 1.0)
        {
            var (v, click) = RunVec(p, c, hand, pressure, n, seed, forceScale);
            return (v.Select(x => (double)x.Length()).ToArray(), click);
        }

        /// The error as a vector (deg) per report, so two runs on the same seed can be subtracted (the skid-only metric).
        public static (Vector2[] errDeg, int click) RunVec(Preset p, Config c, Func<int, Vector2> hand, Func<int, double> pressure, int n, int seed, double forceScale = 1.0)
        {
            var rnd = new Random(seed);
            var pin = Pin(c); var cur = Curve(p); var twin = Twin(c);
            var refCurve = Curve(p);
            double degPerOutMm = 360.0 / (p.cm * 10);
            var err = new Vector2[n]; int click = -1; double flex = 0;
            Vector2 o0 = default, r0 = default;
            for (int i = 0; i < n; i++)
            {
                double pr = pressure(i) * forceScale;
                double swFull = c.TrueSkidMm * Math.Min(1.0, pressure(i - c.SwingLag) * forceScale / SkidSatP);
                flex = Math.Max(flex, Resid * swFull);   // hand flexion: rises with the press, stays
                double sw = c.FlexOnly ? 0 : swFull;
                double t = i / HZ;
                double tx = 0.03 * (0.55 * Math.Sin(2 * Math.PI * 8 * t + 0.7) + 0.30 * Math.Sin(2 * Math.PI * 10 * t)) + (rnd.NextDouble() - 0.5) * 0.004;
                double ty = 0.03 * (0.55 * Math.Sin(2 * Math.PI * 8 * t + 2.4) + 0.30 * Math.Sin(2 * Math.PI * 10 * t + 1.1)) + (rnd.NextDouble() - 0.5) * 0.004;
                var h = hand(i);
                var aimMm = new Vector2((float)(h.X + tx), (float)(h.Y + ty));
                var penMm = aimMm + SkidDir * (float)(sw + flex);
                var q = new Vector2((float)Math.Round(penMm.X * UPM), (float)Math.Round(penMm.Y * UPM));
                var qa = new Vector2((float)Math.Round(aimMm.X * UPM), (float)Math.Round(aimMm.Y * UPM));
                var o = Chain(twin, pin, cur, q / (float)UPM, Math.Min(1, pr));
                var r = refCurve.Filter(qa, DT);
                if (i == 0) { o0 = o; r0 = r; }
                err[i] = ((o - o0) - (r - r0)) / (float)UPM * (float)degPerOutMm;
                if (click < 0 && pr >= TIP) click = i;
            }
            return (err, click);
        }

        /// Diagnostic trace of the rest one-tap: per report pressure, pin output, final output and error.
        public static List<string> TraceRest(Preset p, Config c, int seed = 11)
        {
            var o = new List<string>(); int start = 200, n = 300;
            var rnd = new Random(seed);
            var pin = Pin(c); var cur = Curve(p); var twin = Twin(c); var refCurve = Curve(p);
            double degPerOutMm = 360.0 / (p.cm * 10), flex = 0; Vector2 o0 = default, r0 = default, s0 = default;
            var pp = TapPressure(start, 40);
            for (int i = 0; i < n; i++)
            {
                double pr = pp(i), sw = c.TrueSkidMm * Math.Min(1.0, pr / SkidSatP);
                flex = Math.Max(flex, Resid * c.TrueSkidMm * Math.Min(1.0, pr / SkidSatP));
                double t = i / HZ;
                double tx = 0.03 * (0.55 * Math.Sin(2 * Math.PI * 8 * t + 0.7) + 0.30 * Math.Sin(2 * Math.PI * 10 * t)) + (rnd.NextDouble() - 0.5) * 0.004;
                double ty = 0.03 * (0.55 * Math.Sin(2 * Math.PI * 8 * t + 2.4) + 0.30 * Math.Sin(2 * Math.PI * 10 * t + 1.1)) + (rnd.NextDouble() - 0.5) * 0.004;
                var aimMm = new Vector2((float)(50 + 0.12 * Math.Clamp((i - (start - 11)) / 11.0, 0, 1) * -0.8 + tx), (float)(50 + ty));
                var penMm = aimMm + SkidDir * (float)(sw + flex);
                var q = new Vector2((float)Math.Round(penMm.X * UPM), (float)Math.Round(penMm.Y * UPM));
                var qa = new Vector2((float)Math.Round(aimMm.X * UPM), (float)Math.Round(aimMm.Y * UPM));
                var tOut = twin != null ? twin.Filter(q / (float)UPM, DT, Math.Min(1, pr)) : q / (float)UPM;
                var sOut = pin.Filter(tOut, DT, Math.Min(1, pr));
                var oo = cur.Filter(sOut * (float)UPM, DT);
                var r = refCurve.Filter(qa, DT);
                if (i == 0) { o0 = oo; r0 = r; s0 = sOut; }
                if (i >= start - 14 && i < start + 60)
                    o.Add(string.Format(CultureInfo.InvariantCulture, "{0,4} p {1:0.000} pen {2,7:0.0},{3,7:0.0}  pin {4,7:0.0},{5,7:0.0}  out {6,8:0.0},{7,8:0.0}  ref {8,8:0.0},{9,8:0.0}  err {10:0.000}  led {11:0.0} rem {12:0.0} g {13:0.000}",
                        i - start, pr, q.X - 5000, q.Y - 5000, (sOut.X - s0.X) * UPM, (sOut.Y - s0.Y) * UPM, oo.X - o0.X, oo.Y - o0.Y, r.X - r0.X, r.Y - r0.Y,
                        ((oo - o0) - (r - r0)).Length() / UPM * degPerOutMm, (twin?.LedgerMm ?? 0) * UPM, (twin?.LastRemovedMm ?? 0) * UPM, cur.LastGain));
            }
            return o;
        }

        /// A tap's pressure: 12 ms smoothstep press to PeakP, hold, 18 ms release.
        public static Func<int, double> TapPressure(int start, double holdMs, double peak = PeakP)
            => i =>
            {
                double e = (i - start) * DT; if (e < 0) return 0;
                double S(double a, double b, double x) { if (x <= a) return 0; if (x >= b) return 1; double tt = (x - a) / (b - a); return tt * tt * (3 - 2 * tt); }
                if (e < 12) return peak * S(0, 12, e);
                if (e < 12 + holdMs) return peak;
                if (e < 30 + holdMs) return peak * (1 - S(12 + holdMs, 30 + holdMs, e));
                return 0;
            };

        public sealed class Scores
        {
            public double RestAtClick, RestPeak, RestResidual;
            /// Rest one-tap, the SWING ALONE: out(swing + flexion) - out(flexion only, no twin) on the same seed, peak and
            /// end (deg). The rest metrics above count the pre-press approach as aim, which charges the pin for its designed
            /// rewind (2026-09-24 review: a weaker pin scored better there); the reference keeps the flexion so the metric is
            /// not floored by it (second review).
            public double RestSkidPeak, RestSkidEnd;
            /// Taps while moving, WITH the swing: the worse of the two travel directions (the average can hide one).
            public double[] MovePermanentWorstDir = Array.Empty<double>();
            public double SprayFirst150, SprayAfterRelease;
            public double FlickShotAtClick, FlickShotFollow;
            public double[] MovePinCost = Array.Empty<double>();     // taps while moving at 30/60/100/141 mm/s, NO swing: the pin's own cost
            public double[] MovePermanent = Array.Empty<double>();   // the same taps WITH the modelled swing: what the hand actually gets
        }

        public static readonly double[] MoveSpeeds = { 30, 60, 100, 141 };

        public static Scores Score(Preset p, Config c, double forceScale = 1.0, int seeds = 6, double approachMm = 0.12)
        {
            var s = new Scores(); s.MovePermanent = new double[MoveSpeeds.Length]; s.MovePinCost = new double[MoveSpeeds.Length]; s.MovePermanentWorstDir = new double[MoveSpeeds.Length];
            var noSkid = c.Clone(); noSkid.FlexOnly = true; noSkid.Twin = false;
            var dirSum = new double[MoveSpeeds.Length, 2];
            for (int k = 0; k < seeds; k++)
            {
                // rest one-tap: still hand, an approach drift (0.12 mm by default) in the 30 ms before the press
                {
                    int start = 200, n = 420;
                    Func<int, Vector2> hand = i => new Vector2((float)(50 + approachMm * Math.Clamp((i - (start - 11)) / 11.0, 0, 1) * -0.8), 50);
                    var (ev, ck) = RunVec(p, c, hand, TapPressure(start, 40), n, 11 + k, forceScale);
                    var e = ev.Select(x => (double)x.Length()).ToArray();
                    s.RestAtClick += ck >= 0 ? e[ck] : 0; s.RestPeak += e.Skip(start).Take(60).Max(); s.RestResidual += e[n - 1];
                    var (ev0, _) = RunVec(p, noSkid, hand, TapPressure(start, 40), n, 11 + k, forceScale);
                    double leak = 0; for (int i = start - 5; i < Math.Min(n, start + 100); i++) leak = Math.Max(leak, (ev[i] - ev0[i]).Length());
                    s.RestSkidPeak += leak; s.RestSkidEnd += (ev[n - 1] - ev0[n - 1]).Length();
                }
                // strafing spray: 30 mm p-p at 1.5 Hz, tip held 400 ms from a phase that varies with the seed
                {
                    int start = 180 + 17 * k, n = start + 330;
                    var (e, ck) = Run(p, c, i => new Vector2((float)(150 + 15 * Math.Sin(2 * Math.PI * 1.5 * i / HZ)), 50), TapPressure(start, 400), n, 21 + k, forceScale);
                    s.SprayFirst150 += e.Skip(Math.Max(0, ck)).Take(54).Average(); s.SprayAfterRelease += e[n - 1];
                }
                // flick-shot: a 40 mm / 150 ms throw, a tap at the landing, a follow-up tap 250 ms later
                {
                    int f0 = 150, fn = 54, n = f0 + fn + 260;
                    Func<int, Vector2> hand = i => { double tt = Math.Clamp((i - f0) / (double)fn, 0, 1); return new Vector2((float)(100 + 40 * (10 * Math.Pow(tt, 3) - 15 * Math.Pow(tt, 4) + 6 * Math.Pow(tt, 5))), 50); };
                    var t1 = TapPressure(f0 + fn - 3, 20); var t2 = TapPressure(f0 + fn + 90, 20);
                    var (e, ck) = Run(p, c, hand, i => Math.Max(t1(i), t2(i)), n, 31 + k, forceScale);
                    s.FlickShotAtClick += ck >= 0 ? e[ck] : 0; s.FlickShotFollow += e[f0 + fn + 90 + 2];
                }
                // P1: taps while moving at constant speed, NO swing - the pin's own cost, permanent after release; and the
                // same taps WITH the swing. Averaged over both travel directions: the swing's direction against the travel
                // decides whether the curve's pricing of it adds to or cancels the flexion, so one direction flatters.
                for (int m = 0; m < MoveSpeeds.Length; m++)
                {
                    double v = MoveSpeeds[m]; int start = 200, n = 420;
                    var cm = c.Clone(); cm.TrueSkidMm = 0;
                    foreach (int dir in new[] { 1, -1 })
                    {
                        var (e, _) = Run(p, cm, i => new Vector2((float)(50 + dir * v * i / HZ), 50), TapPressure(start, 20), n, 41 + k, 1.0);
                        s.MovePinCost[m] += e[n - 1] / 2;
                        var (e2, _) = Run(p, c, i => new Vector2((float)(50 + dir * v * i / HZ), 50), TapPressure(start, 20), n, 41 + k, 1.0);
                        s.MovePermanent[m] += e2[n - 1] / 2;
                        dirSum[m, dir > 0 ? 0 : 1] += e2[n - 1];
                    }
                }
            }
            s.RestAtClick /= seeds; s.RestPeak /= seeds; s.RestResidual /= seeds; s.SprayFirst150 /= seeds; s.SprayAfterRelease /= seeds;
            s.RestSkidPeak /= seeds; s.RestSkidEnd /= seeds;
            s.FlickShotAtClick /= seeds; s.FlickShotFollow /= seeds;
            for (int m = 0; m < s.MovePermanent.Length; m++) { s.MovePermanent[m] /= seeds; s.MovePinCost[m] /= seeds; s.MovePermanentWorstDir[m] = Math.Max(dirSum[m, 0], dirSum[m, 1]) / seeds; }
            return s;
        }

        /// Probe-format lines for N settled model taps (for the fit selftests): what the Nib Twin press log (Probe 1) would
        /// write. `lag` = the swing trails the pressure by that many reports; tap peaks are drawn from [peakLo, peakHi]
        /// (default: 0.8-1.2 x PeakP); `satP` = where the swing saturates.
        public static List<string> ModelLog(int taps, double skidMm, double angleDeg, int seed, bool moving = false, int lag = 0,
                                            double peakLo = PeakP * 0.8, double peakHi = PeakP * 1.2, double satP = SkidSatP,
                                            double holdLo = 30, double holdHi = 50, double wobble = 0)
        {
            var o = new List<string>(); var rnd = new Random(seed);
            double ang = angleDeg * Math.PI / 180; var dir = new Vector2((float)Math.Cos(ang), (float)Math.Sin(ang));
            double baseX = 100, baseY = 80;
            for (int t = 0; t < taps; t++)
            {
                o.Add("#press"); double peak = peakLo + (peakHi - peakLo) * rnd.NextDouble(); double flex = 0;
                double hold = holdLo + (holdHi - holdLo) * rnd.NextDouble();
                var p0 = TapPressure(20, hold, peak);
                // the pressure reading wobbles by a few levels while held (a real pen never reads a flat plateau)
                var wob = new double[wobble > 0 ? 2000 : 0]; for (int k = 0; k < wob.Length; k++) wob[k] = 1 + wobble * (2 * rnd.NextDouble() - 1);
                Func<int, double> pp = i => { double v = p0(i); return wob.Length > 0 && i >= 0 && v > 0 ? Math.Min(1.0, v * wob[i % wob.Length]) : v; };
                int n = Math.Max(20 + 24 + 50 + 90, 20 + (int)Math.Ceiling((30 + hold) / DT) + 90);
                for (int i = 0; i < n; i++)
                {
                    double pr = pp(i);
                    double sw = skidMm * Math.Min(1.0, pp(i - lag) / satP); flex = Math.Max(flex, Resid * sw);
                    double mv = moving ? 0.1 * i : 0;
                    double x = baseX + mv + (sw + flex) * dir.X + (rnd.NextDouble() - 0.5) * 0.02, y = baseY + (sw + flex) * dir.Y + (rnd.NextDouble() - 0.5) * 0.02;
                    if (i >= 20 + 24 + 50 && pr <= 0) { }   // trailing post-release reports
                    o.Add(string.Format(CultureInfo.InvariantCulture, "{0:0.###} {1:0.#####} {2:0.##} {3:0.##}", DT, pr, Math.Round(x * UPM), Math.Round(y * UPM)));
                }
                baseX += 0.5; baseY += 0.2;
            }
            return o;
        }
    }
}
