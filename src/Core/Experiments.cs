using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;

namespace AimForge.Core
{
    /// <summary>
    /// The experimental Cadence Lock modes (XP_TOGGLES.md). Apply-time MODES like the engine choice and the mouse
    /// mirror: persisted in xp.txt, never authored into presets.json, written into the Cadence Lock plan
    /// (OtdBridge.CadencePoints) and verified by the same getfilters read-back.
    ///   Intent Speed    - T1, allowed on every role: the curve reads the coherent velocity, clamped to within one
    ///                     lattice unit per report of the raw speed (its lag trail is bounded, not zero).
    ///   Reversal Carry  - T1, LAB-ONLY by policy: it raises gain at low speed after a turnaround.
    ///   Nib Twin        - T1, allowed on every role and on either engine: its own filter, FIRST in the chain, removes
    ///                     the calibrated nib swing (click skid) keyed on tip pressure; never changes gain; needs
    ///                     nibtwin.json from --nib-calibrate.
    /// Intent Speed and Reversal Carry need the Cadence Lock engine (RawAccel cannot know those signals). Field
    /// verdicts: pending.
    /// </summary>
    public static class Experiments
    {
        public const double DefaultCarryMs = 40, MinCarryMs = 10, MaxCarryMs = 80;

        public sealed class State
        {
            public bool Intent, Twin; public double CarryMs;
            public static string Path => System.IO.Path.Combine(AppContext.BaseDirectory, "xp.txt");
            /// xp.txt: "intent|off;<carry ms>;twin|off" (the two-field form of 2026-09-24 still parses)
            public static State Load(string? path = null)
            {
                var s = new State();
                try
                {
                    string file = path ?? Path;
                    if (File.Exists(file))
                    {
                        var f = File.ReadAllText(file).Trim().Split(';');
                        s.Intent = f.Length > 0 && f[0] == "intent";
                        if (f.Length > 1 && double.TryParse(f[1], NumberStyles.Float, CultureInfo.InvariantCulture, out var c)) s.CarryMs = c;
                        s.Twin = f.Length > 2 && f[2] == "twin";
                    }
                }
                catch { }
                s.CarryMs = NormalizeCarry(s.CarryMs);
                return s;
            }
            public void Save(string? path = null)
                => File.WriteAllText(path ?? Path, string.Format(CultureInfo.InvariantCulture, "{0};{1};{2}", Intent ? "intent" : "off", CarryMs, Twin ? "twin" : "off"));
            public void ApplyTo(Rig r)
            {
                r.IntentSpeed = Intent; r.ReversalCarryMs = CarryMs; r.NibTwin = Twin;
                if (Twin && NibCal.Load() is NibCal cal) cal.ApplyTo(r);
            }
        }

        /// Carry is off (0) or inside 10-80 ms; anything else (NaN, 5, 9999) snaps to the nearest legal value.
        public static double NormalizeCarry(double ms)
            => !double.IsFinite(ms) || ms <= 0 ? 0 : Math.Clamp(ms, MinCarryMs, MaxCarryMs);

        public static bool Any(Rig r) => r.IntentSpeed || r.ReversalCarryMs > 0 || r.NibTwin;

        /// Apply pre-flight, run by the shared gate before anything is written.
        public static string? Blocker(Rig r, Preset p)
        {
            if (!double.IsFinite(r.ReversalCarryMs)) return $"Reversal Carry {r.ReversalCarryMs} is not a number of ms; nothing was written";
            if (!Any(r)) return null;
            if (!r.CadenceEngine && (r.IntentSpeed || r.ReversalCarryMs > 0))
                return "Intent Speed and Reversal Carry run inside Cadence Lock - tick the Cadence Lock engine or switch them off; nothing was written";
            if (!double.IsFinite(r.ReversalCarryMs) || (r.ReversalCarryMs > 0 && (r.ReversalCarryMs < MinCarryMs || r.ReversalCarryMs > MaxCarryMs)))
                return $"Reversal Carry {r.ReversalCarryMs} ms is outside {MinCarryMs}-{MaxCarryMs} ms; nothing was written";
            if (r.ReversalCarryMs > 0 && RolePolicy.MaxTier(RolePolicy.RoleOf(p)) <= 2)
                return $"Reversal Carry is Lab-only: it raises gain at low speed after a turnaround, which a {RolePolicy.RoleOf(p)} card's contract forbids until a field verdict names an exception - use it on a Planted, Lab or Reference card; nothing was written";
            if (r.NibTwin)
            {
                var cal = new NibCal { SkidXmm = r.SkidXmm, SkidYmm = r.SkidYmm, SkidFullPressure = r.SkidFullPressure, SkidGamma = r.SkidGamma, R2 = 1, Taps = NibCal.MinTaps };
                var saved = NibCal.Load();
                if (saved == null) return "Nib Twin needs a calibration - run 'calibrate nib' (AimForge --nib-calibrate) first; nothing was written";
                if (saved.Invalid() is string why) return "Nib Twin calibration refused: " + why + "; nothing was written";
                if (cal.Invalid() is string why2) return "Nib Twin values refused: " + why2 + "; nothing was written";
            }
            return null;
        }

        /// An experimental mode that cannot run on THIS apply is dropped from it with a note, instead of refusing the whole
        /// apply (2026-09-27: Nib Twin ticked before calibrating silently blocked every apply). Returns what was dropped.
        public static List<string> Soften(Rig r, Preset p, string? nibBlocker = null)
        {
            var o = new List<string>();
            if (!double.IsFinite(r.ReversalCarryMs)) r.ReversalCarryMs = 0;
            if (!r.CadenceEngine && r.IntentSpeed) { r.IntentSpeed = false; o.Add("Intent Speed skipped: it runs inside Cadence Lock (tick the Cadence Lock engine to use it)"); }
            if (!r.CadenceEngine && r.ReversalCarryMs > 0) { r.ReversalCarryMs = 0; o.Add("Reversal Carry skipped: it runs inside Cadence Lock"); }
            if (r.ReversalCarryMs > 0 && RolePolicy.MaxTier(RolePolicy.RoleOf(p)) <= 2) { r.ReversalCarryMs = 0; o.Add($"Reversal Carry skipped: Lab-only, and this is a {RolePolicy.RoleOf(p)} card"); }
            if (r.ReversalCarryMs > 0) r.ReversalCarryMs = NormalizeCarry(r.ReversalCarryMs);
            if (r.NibTwin)
            {
                var saved = NibCal.Load();
                var cal = new NibCal { SkidXmm = r.SkidXmm, SkidYmm = r.SkidYmm, SkidFullPressure = r.SkidFullPressure, SkidGamma = r.SkidGamma, R2 = 1, Taps = NibCal.MinTaps };
                string? why = saved == null ? "no calibration yet (press 'calibrate nib')" : saved.Invalid() ?? cal.Invalid() ?? nibBlocker;
                if (why != null) { r.NibTwin = false; o.Add("Nib Twin skipped: " + why); }
            }
            return o;
        }

        public static string Describe(Rig r)
            => !Any(r) ? "off" : string.Join(" + ", new[] { r.IntentSpeed ? "Intent Speed" : null, r.ReversalCarryMs > 0 ? $"Reversal Carry {r.ReversalCarryMs:0} ms" : null,
                                                            r.NibTwin ? $"Nib Twin {Math.Sqrt(r.SkidXmm * r.SkidXmm + r.SkidYmm * r.SkidYmm):0.00} mm" : null }.Where(x => x != null));

        /// Doctor: what the last apply SAVED in the Cadence Lock entry vs the Builds-tab setting (xp.txt).
        public static (bool ok, string detail) LiveCheck(string otdSettingsPath, State want, string? calPath = null)
        {
            try
            {
                var root = JsonNode.Parse(File.ReadAllText(otdSettingsPath))!.AsObject();
                var filters = root["Profiles"]![0]!["Filters"]!.AsArray();
                var cl = filters.FirstOrDefault(f => f!["Path"]!.GetValue<string>().Contains(OtdBridge.CadenceId));
                var nt = filters.FirstOrDefault(f => f!["Path"]!.GetValue<string>().Contains(OtdBridge.NibTwinId));
                double? Get(JsonNode? f, string k) => f?["Settings"]?.AsArray().FirstOrDefault(x => x!["Property"]!.GetValue<string>() == k)?["Value"]?.GetValue<double>();
                bool lt = nt?["Enable"]?.GetValue<bool>() == true && Get(nt, "Twin") >= 0.5;
                bool cadOn = cl?["Enable"]?.GetValue<bool>() == true;
                bool li = cadOn && Get(cl, "IntentSpeed") >= 0.5; double lc = cadOn ? Get(cl, "ReversalCarryMs") ?? 0 : 0;
                if (!cadOn && (want.Intent || want.CarryMs > 0))
                    return (false, "the Builds tab turns Intent Speed / Reversal Carry ON but Cadence Lock is not live - apply a build on the Cadence Lock engine");
                bool ok = li == want.Intent && Math.Abs(lc - want.CarryMs) < 1e-9 && lt == want.Twin;
                // a live twin must carry the SAVED calibration (2026-09-24 review: a recalibration could stay un-applied, green)
                string stale = "";
                if (lt && NibCal.Load(calPath) is NibCal cal)
                {
                    var probe = new Rig { NibTwin = true }; cal.ApplyTo(probe);
                    var off = OtdBridge.NibPoints(probe).Where(kv => kv.Key != "Probe" && kv.Key != "Twin" && kv.Key != "NominalHz" && Get(nt, kv.Key) is double v && Math.Abs(v - kv.Value) > Math.Max(1e-6, 1e-6 * Math.Abs(kv.Value)))
                                                        .Select(kv => kv.Key).ToList();
                    if (off.Count > 0) { ok = false; stale = " - the live twin runs an OLDER calibration (" + string.Join(", ", off) + " differ from nibtwin.json); apply again"; }
                }
                return (ok, $"saved by the last apply: Intent Speed {(li ? "ON" : "off")}, Reversal Carry {(lc > 0 ? lc.ToString("0", CultureInfo.InvariantCulture) + " ms" : "off")}, Nib Twin {(lt ? "ON" : "off")}" +
                            (stale.Length > 0 ? stale : ok ? "" : " - the Builds tab now says otherwise; apply to use it"));
            }
            catch (Exception e) { return (false, "could not read OTD settings.json (" + e.Message + ") - UNVERIFIED"); }
        }
    }
}
