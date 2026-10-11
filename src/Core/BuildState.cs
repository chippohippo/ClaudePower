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

        /// The card's own advice to run on Cadence Lock (character cards whose RawAccel-engine gain noise is high). The copy
        /// contract's selftest pins that this sentence appears exactly where the measured noise calls for it.
        public const string CadenceAdvice = "Run it on the Cadence Lock engine";
        public static bool CadenceRecommended(Preset p) => (p.desc ?? "").Contains(CadenceAdvice);
    }
}
