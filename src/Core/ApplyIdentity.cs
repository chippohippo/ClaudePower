using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Text.Json;

namespace AimForge.Core
{
    /// When are two applies the same build? A/B (Ctrl+Tab) pairs the last two DIFFERENT applies, so this decides what a
    /// pair is. 2026-10-11: moved out of the window (it was private and untested) and made complete by construction -
    /// every public Rig field is compared by reflection, so a new mode can never be silently left out again (the old
    /// list missed the third-person gain, the mouse mirror and the Nib Twin calibration, so a recalibration or a mirror
    /// toggle never became an A/B pair).
    public static class ApplyIdentity
    {
        /// Doubles that differ by less than this (relative) are the same value: an apply round-trips numbers through
        /// JSON and the numeric controls, and a 1e-15 drift must not make a new A/B partner.
        const double RelTol = 1e-9;

        static readonly FieldInfo[] RigFields = typeof(Rig).GetFields(BindingFlags.Public | BindingFlags.Instance);

        /// Names of everything that differs between two applies; empty = the same build.
        public static List<string> Differences(Preset a, Rig ra, FilterPlan.Toggles ta, Preset b, Rig rb, FilterPlan.Toggles tb)
        {
            var d = new List<string>();
            if (a.id != b.id) d.Add($"card {a.id} -> {b.id}");
            foreach (var f in RigFields)
                if (!Equal(f.GetValue(ra), f.GetValue(rb))) d.Add(f.Name);
            if (ta.Tap != tb.Tap) d.Add("Tap Anchor");
            if (ta.Hold != tb.Hold) d.Add("hold");
            if (!Near(ta.HoldMs, tb.HoldMs)) d.Add("hold ms");
            if (!Near(ta.TapArm, tb.TapArm)) d.Add("tap arm");
            if (!Near(ta.TapHold, tb.TapHold)) d.Add("tap hold");
            if (!Near(ta.TapBreak, tb.TapBreak)) d.Add("tap break");
            // the curve and the overlays (Advanced-tab edits share the card id - 2026-09-24 review)
            if (Json(a.lut) != Json(b.lut)) d.Add("curve table");
            if (Json(a.adv) != Json(b.adv)) d.Add("curve parameters");
            if (Json(a.cohOv) != Json(b.cohOv)) d.Add("stabilizer overlay");
            if (Json(a.filters) != Json(b.filters)) d.Add("filter plan");
            return d;
        }

        public static bool Same(Preset a, Rig ra, FilterPlan.Toggles ta, Preset b, Rig rb, FilterPlan.Toggles tb)
            => Differences(a, ra, ta, b, rb, tb).Count == 0;

        static string Json(object? o) => JsonSerializer.Serialize(o);

        static bool Near(double x, double y) => x == y || Math.Abs(x - y) <= RelTol * Math.Max(Math.Abs(x), Math.Abs(y));

        static bool Equal(object? x, object? y)
        {
            if (x is double dx && y is double dy) return Near(dx, dy);
            if (x is string[] sx && y is string[] sy) return sx.SequenceEqual(sy);
            return Equals(x, y);   // bool, int, string, double? (boxed Nullable compares by value)
        }
    }
}
