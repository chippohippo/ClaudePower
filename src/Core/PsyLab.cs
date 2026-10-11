using System;
using System.Collections.Generic;
using System.Linq;
using System.Numerics;
using AimForge.Filters;

namespace AimForge.Core
{
    /// <summary>
    /// Psylocke lab (2026-09-14): scores candidate builds on the fights Psylocke actually takes,
    /// using the SHIPPING curve math (Curve.ClassicGain = RawAccel's own formula, Curve.GainAt for
    /// LUTs), the pen's measured 360 Hz report clock on the 0.01 mm lattice, integer-count output
    /// with remainder carry, RawAccel's exact angle snap (rawaccel.hpp: within the cone the vector
    /// is rotated onto the axis, magnitude preserved), Y/X on the output, and optionally a game
    /// filter built from a card's exported plan (PlanFilters, 2026-09-16).
    ///
    /// Kit facts that set the scenarios (Marvel Rivals wikis, 2026-09): Psionic Crossbow is
    /// HITSCAN, 4 bolts per cast, 0.2 s between shots / 0.6 s between rounds, spread radius
    /// 0.2 m at 10 m, falloff from 15 m to 60 % at 30 m, crit 150 %; Psi-Blade Dash 12 m, 2
    /// charges, passes through targets; Psylocke 6 m/s; targets 6 m/s (Black Panther 7, Iron
    /// Man / Star-Lord up to 12 m/s flying). Rivals FOV is engine-fixed.
    ///
    /// Human model (identical for every candidate, so differences are the curve's):
    ///  - the player tracks an INTENDED path = the target's angle through a critically damped
    ///    follower (natural frequency 2.5 Hz: reversals take ~100 ms, like a real hand);
    ///  - a learned feedforward: the hand speed that the curve maps to the needed output speed
    ///    (a trained player's inverse of the curve), plus visual feedback on the error seen
    ///    120 ms late with gain 3 /s;
    ///  - motor noise in the 2-12 Hz band: signal-dependent (Schmidt / Harris-Wolpert: 10 %
    ///    along the motion, 5 % across it) plus a constant 1.5 mm/s term, plus the project's
    ///    8-11.5 Hz tremor. Every parameter is overridable so the ranking can be stress-tested.
    /// The metric is EXECUTION error: output angle vs intended angle, expressed in head radii
    /// at the scenario's distance (head radius 0.15 m). Reaction lag is identical for every
    /// curve and deliberately excluded.
    /// </summary>
    public static class PsyLab
    {
        public const double HZ = 360.0, DT = 1.0 / HZ, QUANT = 0.01, HEAD_R = 0.15, K_RIVALS = 52251;

        public sealed class Params
        {
            public double KPar = 0.10, KPerp = 0.05, S0 = 1.5, Kp = 3.0, VisDelay = 0.12, FollowHz = 2.5, Tremor = 0.03, Warm = 0.4, Vigor = 0.14;
            public int[] Seeds = { 3, 7, 11 };
        }

        /// Hero-lab extensions (2026-09-15; every one defaults to 0 = the original Psylocke behaviour,
        /// so her pinned numbers are unchanged): Proj = projectile speed m/s (the player aims at the
        /// LEAD point; 0 = hitscan), RecoilDegS = vertical pull-down the weapon demands while firing,
        /// H / Fall = aiming down from H metres while descending at Fall m/s, StepDeg / StepS = target
        /// switching (the aim point jumps StepDeg every StepS seconds), SettleOnly = score only the
        /// landing/hold window (from the landing on - flickT / k after the switch - where the shot is
        /// taken), TargetR = hit radius in metres (0 = a 0.15 m head), FlickMs = the throw's duration.
        public sealed class Scen { public string Name = ""; public double D, Lat, Rev, VAmp, VHz, Dur = 2.4, W, Proj, RecoilDegS, H, Fall, StepDeg, StepS, TargetR, FlickMs; public bool SettleOnly; }
        public static readonly Scen[] Scenarios =
        {
            new Scen { Name = "S1 backline strafe 7m", D = 7, Lat = 6, Rev = 0.45, W = 0.25 },
            new Scen { Name = "S2 point-blank duel 4m", D = 4, Lat = 9, Rev = 0.35, W = 0.30 },
            new Scen { Name = "S3 flyer boost 8m", D = 8, Lat = 12, Rev = 1.2, VAmp = 1.5, VHz = 0.6, W = 0.25 },
            new Scen { Name = "S4 far poke 12m", D = 12, Lat = 6, Rev = 0.6, W = 0.20 },
        };

        public sealed class Cand
        {
            public string Name = "", Family = ""; public Preset P = null!; public bool Filter; public GameFilterCore.Game FilterGame = GameFilterCore.Game.Rivals;
            /// The shipping plan entry the filter variant runs (2026-09-16). Null with Filter = the historical
            /// hardcoded Rivals Master of the 2026-09-14 Psylocke CLI modes.
            public FilterSpec? FilterSpec;
            public double Gain(double mms) => P.IsLut ? Curve.GainAt(P.lut!, mms)
                : Curve.ClassicGain(mms * P.pxmm / 1000.0, P.adv.accel ?? 0, P.adv.offset ?? 0, P.adv.cap ?? 1);
            double Out(double v) => v * Gain(v);
            /// The hand speed a trained player uses to get output speed o (the curve's inverse).
            public double Inverse(double o)
            {
                if (o <= 1e-12) return 0;
                double lo = 0, hi = Math.Max(o, 1e-6); int guard = 0;
                while (Out(hi) < o && guard++ < 60) hi *= 2;
                for (int i = 0; i < 44; i++) { double m = 0.5 * (lo + hi); if (Out(m) < o) lo = m; else hi = m; }
                return 0.5 * (lo + hi);
            }
        }

        /// PeakHandMms = inside the scored window (the report rows); PeakAllMms = every report after warm-up, the
        /// ballistic throw included - what the 600 mm/s legality gate must read (2026-09-16 audit: it read the former
        /// and could never fire on a switch).
        public sealed class Track { public double ErrDeg, HeadRadii, OnHeadPct, PeakHandMms, PeakAllMms, MeanGain; public int Spikes; }

        public sealed class Result
        {
            public string Name = "", Family = ""; public double Cm, Accel, Cap, OffMms, CapAtMms, Yx, Snap; public bool Filter, IsLut;
            public double RivalsSens, Sens, Worst, Weighted, Turn180Mm, SpreadPct, MicroPct, DeadMs, HoldPct, SkidMm, RawAccelNoisePct;
            public Track[] PerScen = Array.Empty<Track>();
        }

        static double[] Noise(int seed, int n)
        {
            var r = new Random(seed); int k = 8; var f = new double[k]; var ph = new double[k];
            for (int j = 0; j < k; j++) { f[j] = 2 + 10 * r.NextDouble(); ph[j] = 2 * Math.PI * r.NextDouble(); }
            double a = Math.Sqrt(2.0 / k); var o = new double[n];
            for (int i = 0; i < n; i++) { double t = i * DT, s = 0; for (int j = 0; j < k; j++) s += Math.Sin(2 * Math.PI * f[j] * t + ph[j]); o[i] = a * s; }
            return o;
        }

        static double TremorAt(double t, Random r, double amp)
            => amp * (0.55 * Math.Sin(2 * Math.PI * 8.0 * t + 0.7) + 0.30 * Math.Sin(2 * Math.PI * 10.0 * t) + 0.15 * Math.Sin(2 * Math.PI * 11.5 * t + 2.1))
             + (r.NextDouble() * 2 - 1) * amp * 0.10;

        static Vector2 Q(double x, double y) => new Vector2((float)(Math.Round(x / QUANT) * QUANT), (float)(Math.Round(y / QUANT) * QUANT));

        /// Target lateral position for an AD strafe: constant speed, reversal every `rev` seconds.
        static double Tri(double t, double lat, double rev)
        {
            double ph = t % (2 * rev);
            return lat * (ph < rev ? ph - rev / 2 : (2 * rev - ph) - rev / 2);
        }

        public static Track RunTrack(Cand c, Scen s, int seed, Params prm)
        {
            var rnd = new Random(seed);
            int n = (int)(s.Dur * HZ), delayN = (int)Math.Round(prm.VisDelay * HZ);
            var n1 = Noise(seed * 31 + 1, n); var n2 = Noise(seed * 31 + 2, n); var n3 = Noise(seed * 31 + 3, n); var n4 = Noise(seed * 31 + 4, n);
            double C = c.P.cm, px = c.P.pxmm, yx = c.P.Yx, snap = c.P.snap, degPerMm = 360.0 / (C * 10.0), wn = 2 * Math.PI * prm.FollowHz;
            var gf = !c.Filter ? null : c.FilterSpec != null ? BuildSpecFilter(c.FilterSpec, snap) : c.FilterGame == GameFilterCore.Game.Ow2
                ? new GameFilterCore   // the exporter's Ow2Master: hybrid rail under 18 mm/s, never inside the snap cone
                {
                    Which = GameFilterCore.Game.Ow2, Kind = GameFilterCore.Member.Master,
                    ModeHybrid = 1, RailStrength = 0.25, RailCeilMmS = 18, SnapDeg = snap,
                    FloorUntilMmS = 15, TapUntilMmS = 55, TrackUntilMmS = 150
                }
                : new GameFilterCore
                {
                    Which = GameFilterCore.Game.Rivals, Kind = GameFilterCore.Member.Master,
                    MaxDzMm = 0.4, KneeMmS = 10, TrackGlue = 0.12, AntiTrailTurnDeg = 20, IgnoreSnap = 1,
                    FloorUntilMmS = 15, TapUntilMmS = 55, TrackUntilMmS = 150
                };
            double tof = s.Proj > 0 ? s.D / s.Proj : 0;   // projectile flight time: aim where the target WILL be
            double TX(double t)
            {
                double ph = t % (2 * s.Rev), v = ph < s.Rev ? s.Lat : -s.Lat;
                return Math.Atan2(Tri(t, s.Lat, s.Rev) + v * tof, s.D) * 180 / Math.PI;
            }
            // Target switching with VIGOR variability: switch j is thrown at tempo x kSw[j] (a log-symmetric
            // cycle exp(-Vigor), exp(+Vigor), 1 - about a 12 % movement-time CV, Schmidt's impulse
            // variability). The intended step is time-warped by k, and during the throw (flickT / k) the hand runs
            // the plan it learned at the NOMINAL tempo, sped up by k: hand = k * Inverse(output / k). A linear
            // curve delivers the same angle at any tempo; a curve whose gain moves with speed lands long or short.
            int nSw = s.StepS > 0 ? (int)Math.Ceiling(s.Dur / s.StepS) + 1 : 0;
            var kSw = new double[nSw]; var cyc = new[] { -1.0, 1.0, 0.0 };
            for (int q = 0; q < nSw; q++) kSw[q] = Math.Exp(prm.Vigor * cyc[(q + seed) % 3]);
            // The throw is a minimum-jerk movement (Flash & Hogan 1985) lasting FlickMs - default 90 ms + 0.45 ms
            // per degree, the project's own 135 degrees in 150 ms - scaled by 2.5 / FollowHz so the "snappy" hand
            // model throws faster too; vigor k compresses it to T / k.
            double flickT = (s.FlickMs > 0 ? s.FlickMs : 90 + 0.45 * s.StepDeg) / 1000.0 * 2.5 / prm.FollowHz;
            double StepAt(double t, out double vel, out double kNow)
            {
                vel = 0; kNow = 1; if (nSw == 0) return 0;
                double pos = 0; int upto = Math.Min((int)(t / s.StepS), nSw - 1);
                for (int q = 1; q <= upto; q++)
                {
                    double amp = (q % 2 == 1 ? 1 : -1) * s.StepDeg, tauS = t - q * s.StepS, u = Math.Min(1, kSw[q] * tauS / flickT);
                    pos += amp * u * u * u * (10 - 15 * u + 6 * u * u);
                    if (u < 1) { vel += amp * kSw[q] / flickT * 30 * u * u * (1 - u) * (1 - u); kNow = kSw[q]; }
                }
                return pos;
            }
            // Two-component aimed movement (Woodworth 1899; Meyer et al. 1988): a switch is a BALLISTIC
            // primary with no visual guidance; the player sees where it landed 50 ms after the throw ends,
            // and after the visual delay ONE corrective submovement removes the seen error over 150 ms; the
            // continuous tracking loop resumes once that correction has itself been seen. A new switch
            // before the correction finishes abandons it (rapid volley switching).
            // every clock of a switch (observation, correction, resume, the scored window) is warped with THAT throw's
            // tempo k (2026-09-16 audit: fixed clocks let the three seeds score different parts of the movement)
            const double TCorr = 0.15;
            var corrX = new double[nSw]; var corrY = new double[nSw]; var seen = new bool[nSw];
            double TY(double t)
            {
                double w = 2 * Math.PI * s.VHz;
                double y = s.VAmp > 0 ? s.VAmp * Math.Sin(w * t) + s.VAmp * w * Math.Cos(w * t) * tof : 0;
                double h = s.H > 0 ? Math.Max(0, s.H - s.Fall * t) : 0;
                return (y != 0 || h != 0 ? Math.Atan2(y - h, s.D) * 180 / Math.PI : 0) + s.RecoilDegS * t;
            }

            double ix = TX(0), iy = TY(0), ivx = (TX(DT) - TX(0)) / DT, ivy = (TY(DT) - TY(0)) / DT, ox = ix, oy = iy;
            var hIx = new double[n]; var hIy = new double[n]; var hOx = new double[n]; var hOy = new double[n];
            double hx = 100, hy = 100, remX = 0, remY = 0, rem2X = 0, rem2Y = 0; Vector2 last = default, rawLast = default; bool primed = false; int spikes = 0;
            double se = 0, peak = 0, peakAll = 0, gsum = 0; int cnt = 0, onHead = 0, gcnt = 0;
            double headDeg = Math.Atan2(s.TargetR > 0 ? s.TargetR : HEAD_R, s.D) * 180 / Math.PI;

            for (int i = 0; i < n; i++)
            {
                double t = i * DT, tx = TX(t), ty = TY(t);
                ivx += (wn * wn * (tx - ix) - 2 * wn * ivx) * DT; ix += ivx * DT;
                ivy += (wn * wn * (ty - iy) - 2 * wn * ivy) * DT; iy += ivy * DT;
                double stepV, kv, itx = ix + StepAt(t, out stepV, out kv);
                hIx[i] = itx; hIy[i] = iy; hOx[i] = ox; hOy[i] = oy;
                int j = i - delayN; double ex = j >= 0 ? hIx[j] - hOx[j] : 0, ey = j >= 0 ? hIy[j] - hOy[j] : 0;
                double fb = prm.Kp, vcx = 0, vcy = 0;
                int sw = nSw > 0 ? Math.Min((int)(t / s.StepS), nSw - 1) : 0;
                double kCur = sw >= 1 ? kSw[sw] : 1.0;
                if (sw >= 1)
                {
                    double since = t - sw * s.StepS;
                    double tObs = flickT / kCur + 0.05, tCorr = tObs + prm.VisDelay, tResume = tCorr + TCorr + prm.VisDelay;
                    if (since < tResume) fb = 0;
                    if (since >= tObs && !seen[sw]) { seen[sw] = true; corrX[sw] = itx - ox; corrY[sw] = iy - oy; }
                    if (seen[sw] && since >= tCorr && since < tCorr + TCorr)
                    {
                        double sh = Math.PI / (2 * TCorr) * Math.Sin(Math.PI * (since - tCorr) / TCorr);
                        vcx = corrX[sw] * sh; vcy = corrY[sw] * sh;
                    }
                }
                double cx = ivx + stepV + fb * ex + vcx, cy = ivy + fb * ey + vcy;      // commanded deg/s
                double oxm = cx / degPerMm, oym = cy / degPerMm / yx, om = Math.Sqrt(oxm * oxm + oym * oym);
                double hvx = 0, hvy = 0;
                if (om > 1e-9) { double v = kv * c.Inverse(om / kv); hvx = oxm * v / om; hvy = oym * v / om; }
                double vm = Math.Sqrt(hvx * hvx + hvy * hvy), ux = vm > 1e-9 ? hvx / vm : 1, uy = vm > 1e-9 ? hvy / vm : 0;
                double par = prm.KPar * vm * n1[i] + prm.S0 * n3[i], perp = prm.KPerp * vm * n2[i] + prm.S0 * n4[i];
                hvx += ux * par - uy * perp; hvy += uy * par + ux * perp;
                hx += hvx * DT; hy += hvy * DT;
                var raw = Q(hx + TremorAt(t, rnd, prm.Tremor), hy + TremorAt(t + 1.7, rnd, prm.Tremor));
                var pen = gf != null ? gf.Filter(raw, DT * 1000.0) : raw;
                if (!primed) { last = pen; rawLast = raw; primed = true; continue; }
                var d = pen - last; last = pen;
                double sp = d.Length() * HZ, g = c.Gain(sp), rawSp = (raw - rawLast).Length() * HZ; rawLast = raw;
                if (gf != null && t > prm.Warm && sp > 200 && sp > 1.5 * rawSp) spikes++;   // a speed the HAND never made
                if (t > prm.Warm) peakAll = Math.Max(peakAll, sp);
                double ccx = d.X * g * px + remX, ccy = d.Y * g * px + remY, icx = Math.Round(ccx), icy = Math.Round(ccy);
                remX = ccx - icx; remY = ccy - icy;
                double sx = icx, sy = icy;
                if (snap > 0 && (icx != 0 || icy != 0))
                {
                    double ang = Math.Atan2(Math.Abs(icy), Math.Abs(icx)), sr = snap * Math.PI / 180, mag = Math.Sqrt(icx * icx + icy * icy);
                    if (ang > Math.PI / 2 - sr) { sx = 0; sy = Math.CopySign(mag, icy); }
                    else if (ang < sr) { sx = Math.CopySign(mag, icx); sy = 0; }
                }
                double fx = sx + rem2X, fy = sy * yx + rem2Y, emx = Math.Round(fx), emy = Math.Round(fy);
                rem2X = fx - emx; rem2Y = fy - emy;
                ox += emx / px * degPerMm; oy += emy / px * degPerMm;
                if (t > prm.Warm && (!s.SettleOnly || s.StepS <= 0 || t % s.StepS > flickT / kCur))   // shots are taken from the landing on
                {
                    double e = Math.Sqrt((itx - ox) * (itx - ox) + (iy - oy) * (iy - oy));
                    se += e * e; cnt++; if (e < headDeg) onHead++;
                    peak = Math.Max(peak, sp); gsum += g; gcnt++;
                }
            }
            double rms = Math.Sqrt(se / Math.Max(1, cnt));
            return new Track { ErrDeg = rms, HeadRadii = rms / headDeg, OnHeadPct = 100.0 * onHead / Math.Max(1, cnt), PeakHandMms = peak, PeakAllMms = peakAll, MeanGain = gsum / Math.Max(1, gcnt), Spikes = spikes };
        }

        /// A game filter from its exported plan entry; a plan that snaps (OW2) follows the candidate's snap.
        public static GameFilterCore BuildSpecFilter(FilterSpec spec, double snap)
        {
            var g = PlanFilters.Build(spec);
            if (spec.settings.ContainsKey("SnapDeg")) g.SnapDeg = snap;
            return g;
        }

        public static Result Score(Cand c, Tablet tab, Params prm) => Score(c, tab, prm, Scenarios, K_RIVALS);

        public static Result Score(Cand c, Tablet tab, Params prm, Scen[] scens, double K)
        {
            var per = scens.Select(s =>
            {
                var runs = prm.Seeds.Select(sd => RunTrack(c, s, sd, prm)).ToArray();
                return new Track
                {
                    ErrDeg = runs.Average(r => r.ErrDeg), HeadRadii = runs.Average(r => r.HeadRadii), OnHeadPct = runs.Average(r => r.OnHeadPct),
                    PeakHandMms = runs.Max(r => r.PeakHandMms), PeakAllMms = runs.Max(r => r.PeakAllMms), MeanGain = runs.Average(r => r.MeanGain), Spikes = runs.Sum(r => r.Spikes)
                };
            }).ToArray();
            var rig = Rig.From(c.P); var lut = Curve.EffectiveLut(c.P, rig.PxMm);
            // hold / micro / onset / skid THROUGH the variant's own filter (2026-09-16 audit: legality was certified from
            // the unfiltered curve for every filter variant)
            var spec = c.Filter ? c.FilterSpec : null;
            var m = Measure.Run(lut, rig, tab, spec == null ? null : () => new[] { BuildSpecFilter(spec, c.P.snap) });
            double a = c.P.adv.accel ?? 0, off = c.P.adv.offset ?? 0, cap = c.P.adv.cap ?? 1;
            return new Result
            {
                Name = c.Name, Family = c.Family, Cm = c.P.cm, Accel = a, Cap = cap, OffMms = off * 1000 / c.P.pxmm, IsLut = c.P.IsLut,
                CapAtMms = c.P.IsLut ? double.NaN : Curve.ClassicCapSpeedCms(a, off, cap) * 1000 / c.P.pxmm,
                Yx = c.P.Yx, Snap = c.P.snap, Filter = c.Filter,
                RivalsSens = K_RIVALS / (c.P.pxmm * 25.4 * c.P.cm), Sens = K / (c.P.pxmm * 25.4 * c.P.cm),
                Worst = per.Max(p => p.HeadRadii), Weighted = per.Zip(scens, (p, s) => p.HeadRadii * s.W).Sum(),
                Turn180Mm = Curve.Turn180Mm(lut, rig, 150), SpreadPct = Measure.FlickSpreadPct(lut, rig, tab, 90, 120, 150),
                MicroPct = m.Micro3Pct, DeadMs = m.DeadMs, HoldPct = m.HoldPct, SkidMm = m.SkidMm, PerScen = per,
                // how much this curve's gain wobbles on the RawAccel (arrival-clock) engine at +/-10% report-timing jitter
                RawAccelNoisePct = CadenceLab.RunAimBand(c.P, rig, 10).WallGainNoisePct
            };
        }

        // ---------------- candidate builders ----------------
        public static Preset Classic(double cm, double accel, double cap, double offsetCms, double yx = 0.90, double snap = 9)
            => new Preset { id = "cand", group = "Marvel Rivals", pxmm = 57, cm = cm, snap = snap, hdlMax = 87, adv = new Adv { reset = 80, yx = yx, accel = accel, cap = cap, offset = offsetCms } };

        /// Classic curve that reaches cap G at hand speed capMms (driver formula solved for accel).
        public static Preset EarlySat(double cm, double G, double capMms, double offsetCms = 0.5, double yx = 0.90, double snap = 9)
        {
            double xc = capMms * 57 / 1000.0; double a = (G - 1) * xc / ((xc - offsetCms) * (xc - offsetCms));
            return Classic(cm, Math.Round(a, 4), G, offsetCms, yx, snap);
        }

        public static Preset Flat(double cm, double yx = 0.90, double snap = 9) => Classic(cm, 0.001, 1.0, 0, yx, snap);

        /// Unity through the tracking band (offset offMms), then a ramp that reaches cap G by capMms
        /// (driver formula solved for accel) - so committed flicks ride the flat cap.
        public static Preset TracklineSat(double cm, double offMms, double G, double capMms, double yx = 0.90, double snap = 5)
        {
            double off = offMms * 57 / 1000.0, xc = capMms * 57 / 1000.0;
            return Classic(cm, Math.Round((G - 1) * xc / ((xc - off) * (xc - off)), 4), G, Math.Round(off, 4), yx, snap);
        }

        /// Post-dash re-acquire: the hand travel that turns 135 degrees in 150 ms, executed at
        /// 110 / 150 / 200 ms (sine velocity profile, 360 Hz reports). Spread of the degrees
        /// delivered = how much the landing depends on tempo instead of travel.
        public static (double spreadPct, double travelMm) ReacquireSpread(Cand c) => ReacquireSpread(c, 135, 150);

        /// Same measurement for any hero: the travel that turns turnDeg in ms, executed at
        /// ms x 110/150, ms, ms x 200/150 (the Psylocke tempos when ms = 150).
        public static (double spreadPct, double travelMm) ReacquireSpread(Cand c, double turnDeg, double ms)
        {
            double Deg(double L, double tMs)
            {
                double T = tMs / 1000.0, deg = 0, prev = 0, degPerMm = 360.0 / (c.P.cm * 10.0);
                int steps = (int)Math.Ceiling(T * HZ);
                for (int i = 1; i <= steps; i++)
                {
                    double tt = Math.Min(i / HZ, T), x = L * 0.5 * (1 - Math.Cos(Math.PI * tt / T)), dx = x - prev; prev = x;
                    deg += dx * c.Gain(Math.Abs(dx) * HZ) * degPerMm;
                }
                return deg;
            }
            double lo = 1, hi = 600;
            for (int i = 0; i < 60; i++) { double m = 0.5 * (lo + hi); if (Deg(m, ms) < turnDeg) lo = m; else hi = m; }
            double Lr = 0.5 * (lo + hi); var d = new[] { Deg(Lr, ms * 110 / 150), Deg(Lr, ms), Deg(Lr, ms * 200 / 150) };
            return ((d.Max() - d.Min()) / d.Average() * 100.0, Lr);
        }

        public static Preset WithSnap(Preset p, double snap) => new Preset
        {
            id = p.id, group = p.group, name = p.name, pxmm = p.pxmm, cm = p.cm, snap = snap, hdlMax = p.hdlMax, lut = p.lut,
            adv = new Adv { reset = p.adv.reset, yx = p.adv.yx, accel = p.adv.accel, cap = p.adv.cap, offset = p.adv.offset, mult = p.adv.mult }
        };

        public static List<Cand> Candidates(Catalogue cat)
        {
            var o = new List<Cand>();
            foreach (var id in new[] { "breakpoint", "breakwide", "rivb6", "rivmp", "rivlla", "rivllb", "rivllc" })
                if (cat.Find(id) is Preset p) o.Add(new Cand { Name = "ref " + id, Family = "reference", P = p });
            foreach (var cm in new[] { 37.7, 55.0, 78.95 })
                foreach (var G in new[] { 2.5, 3.5, 5.0 })
                    foreach (var sc in new[] { 40.0, 80.0, 150.0 })
                        o.Add(new Cand { Name = $"early-sat cm{cm} G{G} @{sc}", Family = "early-sat", P = EarlySat(cm, G, sc) });
            foreach (var cm in new[] { 26.0, 32.0, 37.7 })
                foreach (var so in new[] { 150.0, 250.0 })
                    o.Add(new Cand { Name = $"trackline cm{cm} off{so}", Family = "trackline", P = Classic(cm, 0.316, 4.0, Math.Round(so * 57 / 1000.0, 3)) });
            foreach (var cm in new[] { 16.0, 20.0, 24.0, 28.0, 32.0 })
                o.Add(new Cand { Name = $"flat cm{cm}", Family = "flat", P = Flat(cm) });
            return o;
        }

        public static string Row(Result r)
            => $"{r.Name,-34} sens {r.Sens,5:0.00}  worst {r.Worst,5:0.00}  wtd {r.Weighted,5:0.00}  " +
               string.Join(" ", r.PerScen.Select(p => $"{p.HeadRadii,4:0.00}/{p.OnHeadPct,3:0}%")) +
               $"  effCm@S2 {r.Cm / Math.Max(1e-9, r.PerScen[1].MeanGain),5:0.0}  peak {r.PerScen.Max(p => p.PeakHandMms),4:0}  180 {r.Turn180Mm,5:0.0}  spr {r.SpreadPct,4:0.0}%  micro {r.MicroPct,5:0.0}%  dead {r.DeadMs,3:0.0}";
    }
}
