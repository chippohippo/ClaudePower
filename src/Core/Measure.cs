using System;
using System.Linq;
using System.Numerics;
using AimForge.Filters;

namespace AimForge.Core
{
    /// <summary>
    /// The measurement harness, ported verbatim from the CoherenceStabilizer project so the app
    /// recomputes every preset's numbers on the user's ACTUAL rig instead of quoting stale ones.
    /// Deterministic (seeded), so the self-test can pin results.
    /// </summary>
    public sealed class Measured
    {
        public double HoldPct, Micro3Pct, DeadMs, SkidMm, Turn180Mm;
        public override string ToString()
            => $"hold {HoldPct:0.0}%  micro {Micro3Pct:0.0}%  dead {DeadMs:0.0}ms  skid {SkidMm:0.000}mm  180 {Turn180Mm:0.0}mm";
    }

    public static class Measure
    {
        const double QUANT = 0.01, TREMOR = 0.03;
        static readonly int[] Seeds = { 3, 7, 11, 19 };

        static double Tremor(double t, Random r, double amp)
            => amp * (0.55 * Math.Sin(2 * Math.PI * 8.0 * t + 0.7)
                    + 0.30 * Math.Sin(2 * Math.PI * 10.0 * t)
                    + 0.15 * Math.Sin(2 * Math.PI * 11.5 * t + 2.1))
             + (r.NextDouble() * 2 - 1) * amp * 0.10;

        static Vector2 Q(double x, double y)
            => new Vector2((float)(Math.Round(x / QUANT) * QUANT), (float)(Math.Round(y / QUANT) * QUANT));

        static double S(double e0, double e1, double x)
        {
            if (e1 <= e0) return x >= e1 ? 1 : 0;
            double t = (x - e0) / (e1 - e0);
            if (t <= 0) return 0; if (t >= 1) return 1;
            return t * t * (3 - 2 * t);
        }

        /// RawAccel applied the way the driver does it: gain from instantaneous speed, fractional
        /// remainder carried, whole counts emitted. With a plan chain (2026-09-16) the pen first passes the
        /// card's SHIPPING game filters in tablet mm on the pen clock - what the curve actually receives.
        sealed class Sim
        {
            readonly double[][] lut; readonly double cpmm, hz; readonly GameFilterCore[]? chain;
            Vector2 last, outp, rem; bool primed;
            public Sim(double[][] l, double pxmm, double hz, GameFilterCore[]? chain = null) { lut = l; cpmm = pxmm; this.hz = hz; this.chain = chain; }
            public Vector2 F(Vector2 p)
            {
                if (chain != null) foreach (var g in chain) p = g.Filter(p, 1000.0 / hz);
                if (!primed) { last = p; outp = p; rem = Vector2.Zero; primed = true; return p; }
                var d = p - last; last = p;
                double mms = d.Length() * hz;
                var sc = d * (float)Curve.GainAt(lut, mms) + rem;
                var w = new Vector2((float)(Math.Round(sc.X * cpmm) / cpmm), (float)(Math.Round(sc.Y * cpmm) / cpmm));
                rem = sc - w; outp += w; return outp;
            }
        }

        /// `chain` (optional): a factory of the card's game-filter chain (PlanFilters.Factory) - each probe gets a
        /// fresh instance. Null = the bare curve.
        public static Measured Run(double[][] lut, Rig r, Tablet t, Func<GameFilterCore[]>? chain = null)
        {
            double hz = t.reportHz;
            return new Measured
            {
                HoldPct = Seeds.Average(s => Hold(lut, r, hz, s, chain?.Invoke())),
                Micro3Pct = Seeds.Average(s => Micro(lut, r, hz, s, 3.0, chain?.Invoke())),
                DeadMs = Seeds.Average(s => Dead(lut, r, hz, s, 1.06, chain?.Invoke())),
                SkidMm = Seeds.Average(s => Skid(lut, r, hz, s, chain?.Invoke())),
                Turn180Mm = Curve.Turn180Mm(lut, r)
            };
        }

        static double Hold(double[][] lut, Rig r, double hz, int seed, GameFilterCore[]? chain)
        {
            var f = new Sim(lut, r.PxMm, hz, chain); var rnd = new Random(seed);
            var o0 = new Vector2(50f, 50f); f.F(o0);
            double si = 0, so = 0; int n = (int)(hz * 3.0), k = 0;
            for (int i = 0; i < n; i++)
            {
                var raw = Q(50 + Tremor(i / hz, rnd, TREMOR), 50 + Tremor(i / hz + 1.7, rnd, TREMOR));
                var o = f.F(raw);
                if (i > n / 2) { si += (raw - o0).LengthSquared(); so += (o - o0).LengthSquared(); k++; }
            }
            return (1 - Math.Sqrt(so / k) / Math.Sqrt(si / k)) * 100;
        }

        /// Micro-aim fidelity: a 0.12 mm correction at `mms`, then 150 reports of settled tremor. The delivered move is
        /// AVERAGED over the settle window against the pen's own average there (2026-09-16 audit: one final sample had
        /// one-count granularity - 14.6 points at 57 px/mm - and read 109.6% for every unity card alike).
        static double Micro(double[][] lut, Rig r, double hz, int seed, double mms, GameFilterCore[]? chain)
        {
            var f = new Sim(lut, r.PxMm, hz, chain); var rnd = new Random(seed);
            f.F(new Vector2(50f, 50f));
            for (int i = 0; i < 60; i++) f.F(Q(50 + Tremor(i / hz, rnd, TREMOR), 50));
            var st = f.F(Q(50, 50));
            double tot = 0.12; int rep = Math.Max(2, (int)Math.Round(tot / mms * hz));
            for (int i = 0; i < rep; i++) f.F(Q(50 + tot * (i + 1) / rep + Tremor((60 + i) / hz, rnd, TREMOR), 50));
            double so = 0, sr = 0;
            for (int i = 0; i < 150; i++)
            {
                var raw = Q(50 + tot + Tremor((60 + rep + i) / hz, rnd, TREMOR), 50);
                var o = f.F(raw);
                so += o.X - st.X; sr += raw.X - 50;
            }
            return sr == 0 ? 0 : so / sr * 100;
        }

        /// Onset: after a tremor pre-roll (which only sets the carry state), a pure `mms` creep; the time until the
        /// output has moved one whole count IN THE DIRECTION OF TRAVEL (2026-09-16 audit: the old probe kept a tremor
        /// ten times the creep and stopped the clock on a count in either direction). At 360 Hz a unity card reads two
        /// reports: the pen lattice needs two to move one 0.01 mm unit at this creep.
        static double Dead(double[][] lut, Rig r, double hz, int seed, double mms, GameFilterCore[]? chain)
        {
            var f = new Sim(lut, r.PxMm, hz, chain); var rnd = new Random(seed);
            f.F(new Vector2(50f, 50f));
            for (int i = 0; i < 200; i++) f.F(Q(50 + Tremor(i / hz, rnd, TREMOR), 50));
            var st = f.F(Q(50, 50)); double x = 50, one = 1.0 / r.PxMm, dt = 1000.0 / hz;
            for (int i = 0; i < 1000; i++)
            {
                x += mms / hz;
                var o = f.F(Q(x, 50));
                if (o.X - st.X >= one * 0.999) return (i + 1) * dt;
            }
            return 999;
        }

        /// The overhaul metric: one intended 30mm flick executed at several tempos (sine velocity
        /// profile) should deliver the same degrees. Divergence % IS the "massive jumps" feel.
        /// Default tempos 100/150/220ms; the flick profiles are scored on committed tempos
        /// (90/120/150) as well, since their contract is "commit to the flick".
        public static double FlickSpreadPct(double[][] lut, Rig r, Tablet t, params double[] tempos)
        {
            double hz = t.reportHz;
            double One(double tMs)
            {
                var f = new Sim(lut, r.PxMm, hz);
                f.F(new Vector2(50f, 50f));
                for (int i = 0; i < 30; i++) f.F(Q(50, 50));
                var start = f.F(Q(50, 50));
                double T = tMs / 1000.0, x = 50;
                int steps = (int)(T * hz) + 1;
                Vector2 o = start;
                for (int i = 0; i < steps; i++)
                {
                    double tt = (i + 1.0) / steps * T;
                    x = 50 + 30.0 * 0.5 * (1 - Math.Cos(Math.PI * tt / T));
                    o = f.F(Q(x, 50));
                }
                for (int i = 0; i < 30; i++) o = f.F(Q(x, 50));
                return (o.X - start.X) / (r.Cm360 * 10.0) * 360.0;
            }
            var use = tempos.Length > 0 ? tempos : new[] { 100.0, 150.0, 220.0 };
            var d = use.Select(One).ToArray();
            return (d.Max() - d.Min()) / d.Average() * 100.0;
        }

        /// The musket moment: settle, press. 0.30mm skid over 12ms with spring-back to 15%.
        static double Skid(double[][] lut, Rig r, double hz, int seed, GameFilterCore[]? chain)
        {
            var f = new Sim(lut, r.PxMm, hz, chain); var rnd = new Random(seed);
            var dir = Vector2.Normalize(new Vector2(-0.80f, 0.60f));
            double dt = 1000.0 / hz, tt = 0;
            for (int i = 0; i < (int)(hz * 0.8); i++, tt += dt)
                f.F(Q(50 + Tremor(tt / 1000, rnd, TREMOR), 50 + Tremor(tt / 1000 + 1.7, rnd, TREMOR)));
            var aim = f.F(Q(50, 50));
            double ramp = 12, contact = 55, rel = 18, resid = 0.15, skid = 0.30, total = ramp + contact + rel, peak = 0;
            for (double e = 0; e < total + 150; e += dt, tt += dt)
            {
                double off = e < ramp ? S(0, ramp, e) : e < ramp + contact ? 1 : e < total ? 1 - S(ramp + contact, total, e) * (1 - resid) : resid;
                var o = f.F(Q(50 + dir.X * skid * off + Tremor(tt / 1000, rnd, TREMOR), 50 + dir.Y * skid * off + Tremor(tt / 1000 + 1.7, rnd, TREMOR)));
                peak = Math.Max(peak, (o - aim).Length());
            }
            return peak;
        }
    }
}
