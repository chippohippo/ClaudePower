using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using AimForge.Filters;

namespace AimForge.Core
{
    /// <summary>
    /// THE OPTIMIZER (2026-11-12): fits the curve's dials to one hand's own recorded motion (HandPrint) instead of to a
    /// simulated player.
    ///
    /// The idea, in one line: a stroke lands the same whatever its tempo exactly when the gain is FLAT along it. For a
    /// stroke with speed v(t) the delivered travel is O = integral g(v) v dt; if the hand runs it x% fast or slow, or x% long
    /// or short, the landing moves by x% times the output-weighted mean ELASTICITY of the gain, e(v) = v g'(v) / g(v), along
    /// the stroke (0 in the 1:1 band and on the cap, largest mid-ramp). So the ramp belongs where this hand spends the
    /// least aiming time and output, and the flat zones where it spends the most. Four terms, each read off the recording:
    ///   StrokeE   - RMS of that mean elasticity over the hand's own strokes, each re-targeted to deliver the SAME output
    ///               on the candidate curve (same duration and velocity shape, the travel the candidate then needs);
    ///   FireE     - RMS elasticity over the time the tip is down (tracking while firing): lattice and tremor speed noise
    ///               becomes gain noise in proportion to it;
    ///   Precision - the mean gain while the tip is down (hand noise reaches the game multiplied by it);
    ///   Effort    - the hand travel the big moves (20 mm of output and up) need, per mm delivered;
    /// plus a hard cost for strokes that would need more peak hand speed than this hand has ever shown, and a small pull
    /// toward THE GOAT (a field verdict is a prior no simulation outranks). Every term is scored as a ratio to the GOAT's
    /// own value on the same recording, so the GOAT is 1.000 by construction and a candidate must beat it by 3% to be
    /// offered. The result is a CANDIDATE: the duel ladder (Duel.cs) and the player's verdict decide.
    ///
    /// What it assumes (stated, not hidden): on a new curve the hand keeps each stroke's duration and shape and adapts
    /// its travel. That is first-order; it is why the output is a challenger, never a replacement.
    /// </summary>
    public static class Optimizer
    {
        public sealed class Terms { public double StrokeE, FireE, Precision, Effort, Over; }
        public sealed class Cand { public Dials D; public Terms T = new(); public double Score; }
        public sealed class Result
        {
            public HandPrint Hp = null!; public Cand Goat = null!, Best = null!; public List<Cand> Top = new();
            public string Style = "balanced"; public double PeakCeilMms; public int Cells, Candidates;
            /// The best candidate beats the GOAT by the margin AND the recording is long enough.
            public bool Recommend => Hp.Sufficient && Best.Score <= Goat.Score * (1 - Margin);
        }
        public const double Margin = 0.03, Eps = 0.02, PriorWeight = 0.10;

        public static (double c, double p, double e) Weights(string style) => style switch
        {
            "consistency" => (2.0, 0.5, 0.5), "precision" => (0.5, 2.0, 0.5), "speed" => (0.5, 0.5, 2.0), _ => (1.0, 1.0, 1.0),
        };

        // ---- gain as a table over ln(speed): 5 ns a look-up, exact enough (512 points from 0.5 to 6000 mm/s) ----
        const int TN = 512; const double LnLo = -0.6931471805599453, LnHi = 8.699514748210191;   // ln 0.5 .. ln 6000
        static double[] Table(Func<double, double> g) { var t = new double[TN]; for (int i = 0; i < TN; i++) t[i] = g(Math.Exp(LnLo + (LnHi - LnLo) * i / (TN - 1))); return t; }
        static double At(double[] t, double v)
        {
            if (v <= 0.5) return t[0];
            double x = (Math.Log(v) - LnLo) / (LnHi - LnLo) * (TN - 1); if (x >= TN - 1) return t[TN - 1];
            int i = (int)x; return t[i] + (t[i + 1] - t[i]) * (x - i);
        }
        /// d ln g / d ln v at v (the elasticity), from the table
        static double Elast(double[] t, double v)
        {
            double a = At(t, v / 1.03), b = At(t, v * 1.03);
            return a <= 0 || b <= 0 ? 0 : Math.Log(b / a) / (2 * Math.Log(1.03));
        }

        // ---- velocity shapes: s_p(tau) = (tau (1 - tau))^p scaled to mean 1; peak/mean ratio 1 (flat) .. 3 (spiky) ----
        const int SN = 16;
        static readonly double[] ShapePs = Enumerable.Range(0, 41).Select(i => 0.05 + i * 0.2).ToArray();
        static readonly double[][] Shapes = ShapePs.Select(Shape).ToArray();
        static readonly double[] ShapeRatios = Shapes.Select(s => s.Max()).ToArray();
        static double[] Shape(double p)
        {
            var s = new double[SN]; double m = 0;
            for (int j = 0; j < SN; j++) { double tau = (j + 0.5) / SN; s[j] = Math.Pow(tau * (1 - tau), p); m += s[j]; }
            m /= SN; for (int j = 0; j < SN; j++) s[j] /= m; return s;
        }
        static double[] ShapeFor(double ratio)
        {
            int best = 0; for (int i = 1; i < ShapeRatios.Length; i++) if (Math.Abs(ShapeRatios[i] - ratio) < Math.Abs(ShapeRatios[best] - ratio)) best = i;
            return Shapes[best];
        }

        sealed class Cell { public double W, T, Out, Ratio; public double[] S = Array.Empty<double>(); }

        /// The strokes as weighted cells: (duration, delivered travel, peak/mean shape) on a log grid.
        static List<Cell> Cells(HandPrint hp)
        {
            var map = new Dictionary<(int, int, int), Cell>();
            foreach (var e in hp.Episodes)
            {
                if (e.OutMm < 1 || e.DurMs < 8 || e.TravelMm <= 0) continue;
                double ratio = Math.Clamp(e.PeakMms * e.DurMs / 1000.0 / e.TravelMm, 1.05, 3.0);
                var key = ((int)Math.Floor(Math.Log(e.DurMs) * 4), (int)Math.Floor(Math.Log(e.OutMm) * 4), (int)Math.Floor(ratio * 4));
                if (!map.TryGetValue(key, out var c)) map[key] = c = new Cell();
                c.W += 1; c.T += e.DurMs / 1000.0; c.Out += e.OutMm; c.Ratio += ratio;
            }
            foreach (var c in map.Values) { c.T /= c.W; c.Out /= c.W; c.Ratio /= c.W; c.S = ShapeFor(c.Ratio); }
            return map.Values.ToList();
        }

        static Terms Evaluate(double[] gt, List<Cell> cells, double[] fire, double peakCeil)
        {
            var t = new Terms(); double w = 0, effL = 0, effO = 0;
            foreach (var c in cells)
            {
                // the hand travel L that delivers c.Out on this curve: out(L) = L x mean_j( g(L/T s_j) s_j ), monotonic in L
                double lo = c.Out / 8.0, hi = c.Out * 1.6, L = c.Out;
                for (int it = 0; it < 22; it++)
                {
                    L = 0.5 * (lo + hi); double sum = 0;
                    for (int j = 0; j < SN; j++) sum += At(gt, L / c.T * c.S[j]) * c.S[j];
                    if (L * sum / SN < c.Out) lo = L; else hi = L;
                }
                double num = 0, den = 0;
                for (int j = 0; j < SN; j++) { double v = L / c.T * c.S[j], gv = At(gt, v) * v; num += Elast(gt, v) * gv; den += gv; }
                double eb = den > 0 ? num / den : 0;
                t.StrokeE += c.W * eb * eb; w += c.W;
                if (c.Out >= 20) { effL += c.W * L; effO += c.W * c.Out; }
                if (c.Ratio * L / c.T > peakCeil) t.Over += c.W;
            }
            t.StrokeE = w > 0 ? Math.Sqrt(t.StrokeE / w) : 0; t.Over = w > 0 ? t.Over / w : 0;
            t.Effort = effO > 0 ? effL / effO : 1;
            double ft = 0, fe = 0, fg = 0;
            for (int b = 1; b < HandPrint.Bins; b++)
            {
                if (fire[b] <= 0) continue;
                double R = HandPrintCore.BinMid(b), lo = 0, hi = R * 2;
                for (int it = 0; it < 30; it++) { double mid = 0.5 * (lo + hi); if (At(gt, mid) * mid < R) lo = mid; else hi = mid; }
                double v = 0.5 * (lo + hi), e = Elast(gt, v);
                ft += fire[b]; fe += fire[b] * e * e; fg += fire[b] * At(gt, v);
            }
            t.FireE = ft > 0 ? Math.Sqrt(fe / ft) : 0; t.Precision = ft > 0 ? fg / ft : 1;
            return t;
        }

        public static Func<double, double> GainOf(Dials d, double pxmm)
        {
            var (a, off, cap) = d.Classic(pxmm); double k = pxmm / 1000.0;
            return v => Curve.ClassicGain(v * k, a, off, cap);
        }

        /// The candidate space: the GOAT's base speed, every 1:1 band / cap / cap speed a pen hand could want.
        public static List<Dials> Grid(double cm)
        {
            var o = new List<Dials>();
            foreach (var band in new[] { 15.0, 20, 25, 30, 35, 40, 45, 50, 55, 60, 70, 80, 95, 110 })
                foreach (var cap in new[] { 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0 })
                    foreach (var at in new[] { 100.0, 115, 130, 150, 170, 190, 210, 230, 260, 300, 350, 400 })
                        if (at >= band + 50) o.Add(new Dials(band, cap, at, cm));
            return o;
        }

        public static Result Run(HandPrint hp, string style = "balanced", double pxmm = 57)
        {
            var (wc, wp, we) = Weights(style);
            var cells = Cells(hp);
            double tip = hp.TipSeconds, all = tip + hp.SecHover.Sum();
            // the tip is the fire button for a tap-fire player; with fire on a key (tapx) there is no tip time and every motion counts
            var fire = tip >= 0.05 * all ? hp.OutSecTip : hp.OutSecTip.Zip(hp.OutSecHover, (a, b) => a + b).ToArray();
            double peakCeil = Math.Max(300, hp.PeakPercentile(0.995) * 1.05);
            var goatD = Dials.Goat;
            var goatT = Evaluate(Table(GainOf(goatD, pxmm)), cells, fire, peakCeil);
            double Ratio(double x, double g) => (x + Eps) / (g + Eps);
            double Score(Dials d, Terms t)
            {
                double prior = Sq(Math.Log(Math.Max(1, d.Band) / goatD.Band)) + Sq(Math.Log(d.Cap / goatD.Cap)) + Sq(Math.Log(d.CapAt / goatD.CapAt));
                double s = wc * (0.5 * Ratio(t.StrokeE, goatT.StrokeE) + 0.5 * Ratio(t.FireE, goatT.FireE))
                         + wp * (t.Precision - 1 + Eps) / (goatT.Precision - 1 + Eps)
                         + we * t.Effort / goatT.Effort;
                return s / (wc + wp + we) + 10 * Math.Max(0, t.Over - goatT.Over) + PriorWeight * prior;
            }
            var grid = Grid(goatD.Cm); var cands = new Cand[grid.Count];
            Parallel.For(0, grid.Count, i =>
            {
                var t = Evaluate(Table(GainOf(grid[i], pxmm)), cells, fire, peakCeil);
                cands[i] = new Cand { D = grid[i], T = t, Score = Score(grid[i], t) };
            });
            var goat = new Cand { D = goatD, T = goatT, Score = Score(goatD, goatT) };
            var top = cands.OrderBy(c => c.Score).Take(5).ToList();
            return new Result { Hp = hp, Goat = goat, Best = top[0], Top = top, Style = style, PeakCeilMms = peakCeil, Cells = cells.Count, Candidates = cands.Length };
        }
        static double Sq(double x) => x * x;

        static string Pc(double ratio) { double p = (1 - ratio) * 100; return (p >= 0 ? "+" : "−") + Math.Abs(p).ToString("0", CultureInfo.InvariantCulture) + "%"; }

        /// What one candidate changes against the GOAT on this hand ("+" = better for the player).
        public static string Explain(Cand c, Cand goat)
            => $"consistency {Pc(0.5 * (c.T.StrokeE + Eps) / (goat.T.StrokeE + Eps) + 0.5 * (c.T.FireE + Eps) / (goat.T.FireE + Eps))} · " +
               $"firing precision {Pc((c.T.Precision - 1 + Eps) / (goat.T.Precision - 1 + Eps))} · arm travel {Pc(c.T.Effort / goat.T.Effort)}";

        public static string Report(Result r)
        {
            var inv = CultureInfo.InvariantCulture; var sb = new StringBuilder();
            sb.AppendLine($"OPTIMIZER ({r.Style}) - {r.Candidates} curves scored on {r.Hp.Episodes.Count} of your strokes ({r.Cells} stroke types) and {r.Hp.Minutes.ToString("0.0", inv)} min of motion");
            sb.AppendLine($"  THE GOAT on your hand: stroke elasticity {r.Goat.T.StrokeE.ToString("0.000", inv)} · firing elasticity {r.Goat.T.FireE.ToString("0.000", inv)} · mean gain while firing {r.Goat.T.Precision.ToString("0.00", inv)}x · " +
                          $"arm travel {r.Goat.T.Effort.ToString("0.00", inv)} mm per mm delivered   (score {r.Goat.Score.ToString("0.000", inv)})");
            foreach (var c in r.Top)
                sb.AppendLine($"  {c.Score.ToString("0.000", inv)}  {c.D}   {Explain(c, r.Goat)}");
            if (!r.Hp.Sufficient)
                sb.AppendLine("  -> not enough recording yet for a recommendation (10 min of pen time and 400 strokes): keep the Hand Print on and play.");
            else if (r.Recommend)
                sb.AppendLine($"  -> CHALLENGER: {r.Best.D.Versus(r.Goat.D)}. It scores {((1 - r.Best.Score / r.Goat.Score) * 100).ToString("0.0", inv)}% better than the GOAT on your own motion. Theory until you rate it: duel it against the GOAT.");
            else
                sb.AppendLine($"  -> THE GOAT already fits this hand: the best other curve is within {(Margin * 100).ToString("0", inv)}% of it. Nothing to change (which is also an answer to why it feels right).");
            return sb.ToString();
        }

        /// The recommended challenger as an importable build on the GOAT's rig, or null when the GOAT stays.
        public static Preset? Challenger(Result r, Preset goatCard)
        {
            if (!r.Recommend) return null;
            string desc = $"MY HAND - fitted by the optimizer to {r.Hp.Minutes.ToString("0", CultureInfo.InvariantCulture)} min of your own recorded motion ({r.Style}). {r.Best.D}. " +
                          $"Against THE GOAT: {r.Best.D.Versus(r.Goat.D)}; predicted {Explain(r.Best, r.Goat)}. The GOAT's rig otherwise (snap 0, Y/X 1.00, reset 20 ms, no filters). " +
                          "A candidate, not a verdict: duel it against the GOAT.";
            return r.Best.D.ToPreset(goatCard, "myhand", "My Hand", desc);
        }
    }
}
