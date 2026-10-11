using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace AimForge.Core
{
    /// <summary>
    /// PEN TIMING (2026-10-11): how reports really reach the filter, read from the Nib Twin press log - every row is
    /// "dtMs pressure x y" with dt the plugin's own HPET interval between reports, the same clock Cadence Lock sees.
    /// ChainLab showed the engines differ only in how they handle three arrival patterns, so this counts them:
    ///  - plain: one interval (0.5-1.5x nominal);
    ///  - LATE:  a long interval (>1.5x) whose report carries ~one report of travel and is followed by a short one -
    ///           Cadence without the drop check prices it at half speed;
    ///  - DROP:  a long interval whose report carries ~two reports of travel - a report never arrived;
    ///  - short: an interval under 0.5x (the catch-up after a late report).
    /// Travel is judged against the trend of the two plain reports before (the drop check's own rule); slow rows (< 3 units
    /// a report) cannot be judged and count as 'unjudged'.
    /// </summary>
    public static class PenTiming
    {
        public sealed class Stats
        {
            public int Intervals, Plain, Short, Late, Drop, LongUnjudged;
            public double NominalMs, P50Ms, P99Ms;
            public string Summary => string.Format(CultureInfo.InvariantCulture,
                "{0} intervals at {1:0.000} ms nominal (median {2:0.000}, p99 {3:0.000}): plain {4:0.0}%, short {5:0.00}%, LATE {6} ({7:0.00} per 1000), DROPPED {8} ({9:0.00} per 1000), long+slow unjudged {10}",
                Intervals, NominalMs, P50Ms, P99Ms, Pct(Plain), Pct(Short), Late, Per1000(Late), Drop, Per1000(Drop), LongUnjudged);
            double Pct(int n) => Intervals > 0 ? 100.0 * n / Intervals : 0;
            double Per1000(int n) => Intervals > 0 ? 1000.0 * n / Intervals : 0;
        }

        public static Stats FromNibLog(IEnumerable<string> lines, double nominalMs = 1000.0 / 360.2)
        {
            var st = new Stats { NominalMs = nominalMs }; var dts = new List<double>();
            double px = 0, py = 0, d0 = 0, d1 = 0; int hist = 0; bool have = false;
            foreach (var raw in lines)
            {
                var l = raw.Trim();
                if (l.Length == 0 || l.StartsWith("#")) { have = false; hist = 0; continue; }   // a press block boundary breaks continuity
                var f = l.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                if (f.Length < 4 || !double.TryParse(f[0], NumberStyles.Float, CultureInfo.InvariantCulture, out var dt) ||
                    !double.TryParse(f[2], NumberStyles.Float, CultureInfo.InvariantCulture, out var x) ||
                    !double.TryParse(f[3], NumberStyles.Float, CultureInfo.InvariantCulture, out var y)) continue;
                if (!have) { have = true; px = x; py = y; continue; }
                if (dt > 50) { px = x; py = y; hist = 0; continue; }                            // a lift: not an interval
                double d = Math.Sqrt((x - px) * (x - px) + (y - py) * (y - py)); px = x; py = y;
                st.Intervals++; dts.Add(dt);
                double r = dt / nominalMs;
                if (r < 0.5) st.Short++;
                else if (r <= 1.5) { st.Plain++; d0 = hist == 0 ? d : d1; d1 = d; hist++; continue; }
                else
                {
                    double pred = d1 + (d1 - d0);
                    if (hist >= 2 && pred >= 3) { if (d / pred < 1.35) st.Late++; else st.Drop++; }
                    else st.LongUnjudged++;
                }
                hist = 0;
            }
            if (dts.Count > 0) { dts.Sort(); st.P50Ms = dts[dts.Count / 2]; st.P99Ms = dts[Math.Min(dts.Count - 1, (int)(0.99 * dts.Count))]; }
            return st;
        }
    }
}
