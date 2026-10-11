using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace AimForge.Core
{
    /// <summary>
    /// What the window says about the build (2026-10-11): what is live, what would change on the next apply, and the advice
    /// a card carries. Pure functions of the applied snapshot and the composed next apply - no driver is read - so the window
    /// can refresh them on every edit and the selftests can pin them.
    /// </summary>
    public static class BuildState
    {
        /// Rig field -> what the user calls it. Fields that move together (the calibration's five, the mouse's four) share a
        /// label, so one change reads as one item.
        static readonly Dictionary<string, string> Labels = new()
        {
            ["PxMm"] = "px/mm", ["Cm360"] = "cm/360", ["SnapDeg"] = "angle snap", ["Yx"] = "Y/X", ["HdlMax"] = "hover max", ["HdlMin"] = "hover min",
            ["HdlEnabled"] = "hover limiter", ["ResetMs"] = "reset", ["MonitorIndex"] = "monitor", ["Mult"] = "output multiplier", ["RotationDeg"] = "rotation",
            ["TpsGain"] = "third-person match", ["TipThresholdPct"] = "tip threshold", ["Engine"] = "engine", ["ReportHz"] = "pen rate", ["MergeMax"] = "merge cap",
            ["MirrorMouse"] = "mouse mirror", ["MouseDpi"] = "mouse settings", ["MouseSpeedHalfLifeMs"] = "mouse settings", ["MouseYx"] = "mouse settings",
            ["MouseIdPrefixes"] = "mouse devices", ["IntentSpeed"] = "Intent Speed", ["ReversalCarryMs"] = "Reversal Carry", ["NibTwin"] = "Nib Twin",
            ["NibProbe"] = "nib press log", ["SkidXmm"] = "Nib calibration", ["SkidYmm"] = "Nib calibration", ["SkidFullPressure"] = "Nib calibration",
            ["SkidGamma"] = "Nib calibration", ["SkidLagReports"] = "Nib calibration",
        };

        /// What the next apply would change against the last one, in the user's words (empty = nothing; the build is live).
        /// The mouse device list is discovered at apply time, so an empty list in the composed build is not a change.
        public static List<string> PendingChanges(Preset lastP, Rig lastRg, FilterPlan.Toggles lastT, Preset p, Rig next, FilterPlan.Toggles t)
        {
            var d = ApplyIdentity.Differences(lastP, lastRg, lastT, p, next, t);
            if (next.MouseIdPrefixes.Length == 0) d.Remove("MouseIdPrefixes");
            // the third-person factor is folded into the multiplier: one change, named once
            if (d.Contains("TpsGain")) d.Remove("Mult");
            return d.Select(x => x.StartsWith("card ") ? x : Labels.TryGetValue(x, out var l) ? l : x).Distinct().ToList();
        }

        /// One line of what a build runs: engine, then every mode that is on (the EFFECTIVE state of an apply, not switches).
        public static string Modes(Rig r)
        {
            var m = new List<string> { r.CadenceEngine ? "CADENCE LOCK" : "RAWACCEL" };
            if (r.NibTwin) m.Add("NIB TWIN");
            if (r.IntentSpeed) m.Add("INTENT SPEED");
            if (r.ReversalCarryMs > 0) m.Add($"CARRY {r.ReversalCarryMs:0} MS");
            if (Math.Abs(r.TpsGain - 1) > 1e-9) m.Add(string.Format(CultureInfo.InvariantCulture, "3RD-PERSON x{0:0.00}", r.TpsGain));
            if (r.MirrorMouse) m.Add("MOUSE MIRROR");
            if (!r.HdlEnabled) m.Add("HOVER LIMITER OFF");
            return string.Join("  ·  ", m);
        }

        /// VMulti writes at most 127 counts a packet and splits a bigger report (VoiDPlugins a69fe34); RawAccel then reads the
        /// first packet at exactly the split speed and the rest at a near-zero interval (ev-20261011-chain-lab). Harmless when
        /// the curve is flat (capped) above that speed; a curve that still CHANGES above it misprices every faster flick on the
        /// RawAccel engine. Returns the split speed in mm/s when that is so, else null. Cadence Lock is immune (the curve runs
        /// before VMulti, and RawAccel is flat).
        public static double? SplitHazardMmS(Preset p, double pxmm, double reportHz = 360)
        {
            double split = 127.0 * reportHz / pxmm;
            double lastChange;
            if (p.IsLut)
            {
                var l = p.lut!; lastChange = 0;
                for (int i = 1; i < l.Length; i++) if (Math.Abs(l[i][1] - l[i - 1][1]) > 1e-9) lastChange = l[i][0];
            }
            else
            {
                // legacy classic in mm/s: gain reaches the cap where accel'*(v-off)^2/v = cap-1 (accel' = accel*k, off = offset/k)
                double k = pxmm / 1000.0, a = (p.adv.accel ?? 0) * k, off = (p.adv.offset ?? 0) / k, c = (p.adv.cap ?? 1) - 1;
                if (a <= 0 || c <= 0) return null;
                // a v^2 - (2 a off + c) v + a off^2 = 0, the larger root
                double B = 2 * a * off + c, disc = B * B - 4 * a * a * off * off;
                lastChange = (B + Math.Sqrt(Math.Max(0, disc))) / (2 * a);
            }
            return lastChange > split + 1e-6 ? split : null;
        }

        /// The card's own advice to run on Cadence Lock (character cards whose RawAccel-engine gain noise is high). The copy
        /// contract's selftest pins that this sentence appears exactly where the measured noise calls for it.
        public const string CadenceAdvice = "Run it on the Cadence Lock engine";
        public static bool CadenceRecommended(Preset p) => (p.desc ?? "").Contains(CadenceAdvice);

        /// Why this card should run on Cadence Lock at this px/mm, or null: its own measured advice, or the split hazard.
        public static string? CadenceReason(Preset p, double pxmm)
        {
            if (CadenceRecommended(p)) return "this card's own measurement: on the RawAccel engine its steep ramp turns report-timing jitter into gain noise";
            if (SplitHazardMmS(p, pxmm) is double sp)
                return $"at {pxmm:0} px/mm VMulti splits every report above {sp:0} mm/s and this curve still changes above that, so the RawAccel engine misprices fast flicks (ev-20261011-chain-lab)";
            return null;
        }
    }
}
