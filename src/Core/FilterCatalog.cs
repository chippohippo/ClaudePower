using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;

namespace AimForge.Core
{
    /// <summary>
    /// Discovery + latency classification of every OTD filter actually on this machine.
    /// Replaces the hardcoded two-checkbox whitelist: the catalog is built from (a) the
    /// plugins directory and (b) the live settings.json filter registrations, then classified
    /// into latency tiers so the rule engine can say WHY a filter is on or off for a build.
    ///
    /// Tiers (field-derived, matched to this project's measurements where we have them):
    ///   T0 gate        - zero temporal cost (drops/routes reports; no state on position)
    ///   T1 state       - ~0ms on coherent motion (deadzones, the tap pin, coherence at hold 0)
    ///   T2 corrective  - can REDUCE latency (undo hardware EMA); inert on Wacom (no HW smooth)
    ///   T3 light smooth- 0.5-2 reports of trail (hold smoothing, EMA, pressure-scaled smooth)
    ///   T4 interpolate - follows/trails by design; measured here: Radial Follow inverted gate
    ///                    up to 1.0mm curve lag - death on a 150ms flick
    ///   T5 predict     - extrapolation; artifacts on direction change (Lead Sight is decel-gated
    ///                    and measured, but it is still T5 and ships only on Lab/wildcard builds)
    /// </summary>
    public sealed class FilterInfo
    {
        public string Path = "", Display = "", Tier = "", Stage = "", Note = "";
        /// The tier of what is SAVED in settings.json right now (the stabilizer's depends on its settings). Only the
        /// Doctor's live-chain rows read it; plan validation judges the card's own overlay (2026-09-24 review: a
        /// Lead Sight entry left saved made the gate refuse every strict-role card).
        public string LiveTier { get => liveTier ?? Tier; set => liveTier = value; }
        string? liveTier;
        public bool Installed, Registered, EnabledLive;
        public List<(string prop, string val)> Live = new List<(string, string)>();
    }

    public static class FilterCatalog
    {
        // Classification keyed on settings.json Path substrings. Unknown filters land at "T3+?"
        // so the rule engine treats them as costing latency until proven otherwise.
        static readonly (string key, string name, string tier, string stage, string note)[] Table =
        {
            ("Hover_Distance_Limiter",                 "Hover Distance Limiter",     "T0", "pre",  "gate: drops hover noise before it exists; the one filter every build keeps"),
            ("CoherenceStabilizerTabletSpace",         "Coherence Stabilizer",       "T1", "pre",  "first-party; tier depends on settings - hold 0 + tap = T1 state (exact passthrough), hold>0 = T3, lead>0 = T5"),
            ("MicroPreserveTabletSpace",               "Micro-Adjust Preserver",     "T3", "pre",  "stroke-extent smoothing of sustained tracking; user-retired (felt smoothed)"),
            ("CHATTER_EXTERMINATOR_RAW",               "Chatter Exterminator RAW",   "T1", "pre",  "deadzone antichatter; overlaps the Coherence Stabilizer - never both"),
            ("CHATTER_EXTERMINATOR_SMOOTH",            "Chatter Exterminator SMOOTH","T3", "pre",  "smoothing variant - Planted-class only"),
            ("PrecisionControl",                       "Precision Control",          "T0", "pre",  "gain switch (hip/ADS dual-gain candidate); no temporal cost"),
            ("Reconstructor",                          "Reconstructor",              "T2", "pre",  "undoes HARDWARE EMA; this rig is Wacom EMR (no HW smoothing) so it has nothing to undo"),
            ("RadialFollowSmoothingTabletSpace",       "Radial Follow (tablet)",     "T4", "pre",  "trails on purpose - measured up to 1.0mm curve lag on this rig; death on a 150ms flick"),
            ("RadialFollowSmoothingScreenSpace",       "Radial Follow (screen)",     "T4", "post", "screen-space variant of the same trailing gate"),
            ("NoiseReduction",                         "OTD Noise Reduction",        "T3", "pre",  "built-in EMA-class smoothing"),
            ("UnterpTabletDriverFilters.Hawku",        "Unterp Hawku",               "T3", "pre",  "de-interpolated Hawku port; light smoothing only"),
            ("UnterpTabletDriverFilters.Devocub",      "Unterp Devocub Antichatter", "T3", "pre",  "de-interpolated Devocub port"),
            ("TabletDriverFilters.Hawku",              "Hawku Smoothing",            "T3", "pre",  "EMA smoothing; low strength or not at all"),
            ("PSSA",                                   "PSSA",                       "T3", "pre",  "pressure-scaled smoothing amount; Planted-class only, tiny amounts"),
            ("PenHoverStabilizer",                     "Pen Hover Stabilizer",       "T3", "pre",  "hover-band smoothing; HDL makes it redundant here"),
            ("TemporalResampler",                      "Temporal Resampler",         "T4", "pre",  "frame interpolation; field-retired after two glitch reports (fly-off)"),
            ("SpringInterpolator",                     "Spring Interpolator",        "T4", "pre",  "mass-spring trail by design"),
            ("BezierInterp",                           "Bezier Interpolator",        "T4", "pre",  "curve-fit trail by design"),
            ("HawkuScrollFilter",                      "Hawku Scroll",               "T0", "post", "scroll tool - not an aim filter"),
            // ---- AimForge Game Filters (session 3, first-party) ----
            ("AimForge.Filters.CodMaster",             "AimForge CoD Master",        "T1", "pre",  "vertical recoil rail: orthogonal damping on this report only, track zone, near-vertical - a heading bias, never a trail"),
            ("AimForge.Filters.CodLab",                "AimForge CoD Lab",           "T3", "pre",  "HoldAssist IS light hold smoothing - Planted/Slow Center only, never Master"),
            ("AimForge.Filters.ValMaster",             "AimForge Valorant Master",   "T1", "pre",  "coherence-gated rest deadzone with same-report flush on a peek jig; no rail, no snap bias, zero cost on a committed swipe - RETIRED 2026-09-16 (OFF in every plan): measured through the plan, the rest deadzone erased micro-aim"),
            ("AimForge.Filters.ValLab",                "AimForge Valorant Lab",      "T3", "pre",  "tiny EMA (<=0.06) - Planted only"),
            ("AimForge.Filters.ApexMaster",            "AimForge Apex Master",       "T1", "pre",  "coherence-gated rest deadzone + the anti-trail law: a flick or real turn passes the hand's own delta this report (the rest offset is kept, never repaid as a spike) - RETIRED 2026-09-16 (OFF in every plan): measured through the plan, the rest deadzone erased micro-aim"),
            ("AimForge.Filters.Ow2Master",             "AimForge OW2 Master",        "T1", "pre",  "hybrid rail: micro/tap under 18mm/s only, never inside the snap cone (no stacking), free above for projectile lead"),
            ("AimForge.Filters.Ow2Lab",                "AimForge OW2 Lab",           "T3", "pre",  "Guardrail personality: heavy rail + hard orthogonal cap - Guardrail card only"),
            ("AimForge.Filters.RivalsMaster",          "AimForge Rivals Master",     "T1", "pre",  "coherence-gated rest deadzone + anti-trail at 20 degrees: a turn passes the hand's own delta (the rest offset is kept, never repaid as a spike) - RETIRED 2026-09-16 (OFF in every plan): measured through the plan, the rest deadzone erased micro-aim"),
            ("AimForge.Filters.FinalsMaster",          "AimForge Finals Master",     "T1", "pre",  "decel brake: a one-two-report event on a hard stop out of a swing - an event, not a smoother"),
            ("AimForge.Filters.HoldfastMaster",        "AimForge Holdfast Master",   "T0", "pre",  "identity: exists so the family policy (one game personality at a time) stays uniform"),
            ("AimForge.Filters.NibTwin",               "AimForge Nib Twin",          "T1", "pre",  "EXPERIMENTAL: removes the calibrated nib swing (click skid) keyed on tip pressure, on the same report; FIRST in the chain; never changes gain; exact passthrough in hover"),
            ("AimForge.Filters.CadenceLock",           "AimForge Cadence Lock",      "T0", "pre",  "ENGINE: the build's curve evaluated in tablet space on the pen's fixed report clock (dt rounded to whole reports, never wall-clock). RawAccel must be flat while it is on"),
        };

        /// Game-filter registry for the rule engine: id fragment -> (game key, member, tier).
        public static readonly (string id, string game, string member, string tier)[] GameFilters =
        {
            ("AimForge.Filters.CodMaster",   "cod",      "Master", "T1"),
            ("AimForge.Filters.CodLab",      "cod",      "Lab",    "T3"),
            ("AimForge.Filters.ValMaster",   "val",      "Master", "T1"),
            ("AimForge.Filters.ValLab",      "val",      "Lab",    "T3"),
            ("AimForge.Filters.ApexMaster",  "apex",     "Master", "T1"),
            ("AimForge.Filters.Ow2Master",   "ow2",      "Master", "T1"),
            ("AimForge.Filters.Ow2Lab",      "ow2",      "Lab",    "T3"),
            ("AimForge.Filters.RivalsMaster","rivals",   "Master", "T1"),
            ("AimForge.Filters.FinalsMaster","finals",   "Master", "T1"),
            ("AimForge.Filters.HoldfastMaster","holdfast","Master","T0"),
        };

        /// Which game a preset belongs to, from its group (the exporter uses the same map).
        public static string? GameOfGroup(string? group) => group switch
        {
            null or "" => null,
            "The Baseline" => "cod",
            "The GOAT" => "finals",
            var g when g.StartsWith("Breakpoint") => "cod",
            "Marvel Rivals" => "rivals",
            "Specific Characters — Marvel Rivals" => "rivals",
            "The Finals" => "finals",
            "Apex Legends" => "apex",
            "Overwatch 2" => "ow2",
            "Specific Characters — Overwatch 2" => "ow2",
            "Holdfast: NAW" => "holdfast",
            "Valorant" => "val",
            "Helldivers 2" => "hd2",
            "Deadlock" => "deadlock",
            _ => null,
        };

        /// Game keys that deliberately ship NO game-personality filter (Helldivers 2 has no designed policy).
        public static readonly HashSet<string> NoPersonalityGames = new() { "hd2", "deadlock" };

        /// The catalogue's games[].id for a group - the filter key differs for Valorant ("val" vs "valorant").
        public static string? GameIdOf(string? group) => GameOfGroup(group) switch { "val" => "valorant", var g => g };

        /// pluginFolder -> settings.json Path prefixes it provides. The four name mismatches
        /// that used to need heuristics are now explicit rows.
        public static readonly Dictionary<string, string[]> FolderMap = new(StringComparer.OrdinalIgnoreCase)
        {
            ["AbstractQbit's Radial Follow Smoothing"] = new[] { "RadialFollow." },
            ["Coherence Stabilizer"] = new[] { "CoherenceStabilizer." },
            ["HawkuFilters"] = new[] { "TabletDriverFilters.Hawku" },
            ["HawkuScroll"] = new[] { "OpenTabletDriver.HawkuScroll" },
            ["Hover Distance Limiter"] = new[] { "Hover_Distance_Limiter" },
            ["Kuuube's CHATTER EXTERMINATOR"] = new[] { "Kuuube_s_Chatter_Exterminator" },
            ["PSSA"] = new[] { "PSSA" },
            ["Pen Hover Stabilizer"] = new[] { "PenHoverStabilizer" },
            ["Precision Control"] = new[] { "VoiDPlugins.Filter.PrecisionControl" },
            ["Reconstructor"] = new[] { "VoiDPlugins.Filter.Reconstructor" },
            ["Temporal Resampler"] = new[] { "TemporalResampler" },
            ["UnterpBezierInterpolator"] = new[] { "UnterpBezierInterpolator" },
            ["UnterpDevocubFilters"] = new[] { "UnterpTabletDriverFilters.Devocub" },
            ["UnterpHawkuFilters"] = new[] { "UnterpTabletDriverFilters.Hawku" },
            ["UnterpSpringInterpolator"] = new[] { "UnterpSpringInterpolator" },
            ["AimForge Game Filters"] = new[] { "AimForge.Filters." },
        };

        /// Folders that are deliberately not in the filter catalog, with the reason on record.
        public static readonly Dictionary<string, string> FolderExcluded = new(StringComparer.OrdinalIgnoreCase)
        {
            ["VMultiMode"] = "output mode (VMulti relative), not a filter - managed by the output-mode settings",
        };

        /// Registered paths with no plugin folder, with the reason on record (selftest: no
        /// orphan without a reason string).
        public static readonly Dictionary<string, string> BuiltinRegistrations = new(StringComparer.OrdinalIgnoreCase)
        {
            ["OpenTabletDriver.Plugin.NoiseReduction"] = "OTD built-in filter - ships with the driver, no plugin folder",
        };

        public static List<FilterInfo> Discover(OtdBridge otd)
        {
            var infos = new Dictionary<string, FilterInfo>(StringComparer.OrdinalIgnoreCase);

            FilterInfo Classify(string path)
            {
                var hit = Table.FirstOrDefault(t => path.Contains(t.key, StringComparison.OrdinalIgnoreCase));
                return new FilterInfo
                {
                    Path = path,
                    Display = hit.name ?? path.Split('.').Last(),
                    Tier = hit.tier ?? "T3+?",
                    Stage = hit.stage ?? "pre",
                    Note = hit.note ?? "unclassified - treated as latency-costing until measured",
                };
            }

            // (a) live registrations carry the truth about what is enabled and its settings
            try
            {
                var root = JsonNode.Parse(File.ReadAllText(otd.SettingsPath))!.AsObject();
                foreach (var f in root["Profiles"]![0]!["Filters"]!.AsArray())
                {
                    string path = f!["Path"]!.GetValue<string>();
                    var fi = Classify(path);
                    fi.Registered = true;
                    fi.Installed = true;
                    fi.EnabledLive = f["Enable"]?.GetValue<bool>() == true;
                    if (f["Settings"] is JsonArray st)
                        foreach (var s in st)
                            fi.Live.Add((s!["Property"]!.GetValue<string>(), s["Value"]?.ToJsonString() ?? ""));
                    // the stabilizer's tier is its SETTINGS (2026-09-24 review: a live 6 ms Lead Sight read as T1)
                    if (path.Contains("CoherenceStabilizerTabletSpace"))
                    {
                        double LiveNum(string k) => double.TryParse(fi.Live.FirstOrDefault(x => x.prop == k).val, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var v) ? v : 0;
                        fi.LiveTier = LiveNum("LeadMs") > 0 ? "T5" : LiveNum("HoldTimeMs") > 0 ? "T3" : "T1";
                    }
                    infos[path] = fi;
                }
            }
            catch { /* settings unreadable: fall through to directory scan */ }

            // (b) plugin folders vs registrations: an EXPLICIT map, not substring soup (3.4).
            // Every folder on this machine is either mapped to the settings.json Path prefixes
            // it provides, or excluded with a reason. An unmapped folder shows up as a catalog
            // row telling the maintainer to extend the map - never silently hidden.
            try
            {
                var plugDir = Path.Combine(otd.DataDir, "Plugins");
                if (Directory.Exists(plugDir))
                    foreach (var d in Directory.GetDirectories(plugDir))
                    {
                        string name = Path.GetFileName(d);
                        if (FolderExcluded.TryGetValue(name, out _)) continue;
                        if (FolderMap.TryGetValue(name, out var prefixes))
                        {
                            bool covered = prefixes.Any(pref => infos.Keys.Any(k => k.StartsWith(pref, StringComparison.OrdinalIgnoreCase)));
                            if (covered) continue;
                            var fi = Classify(prefixes[0]);
                            fi.Display = name; fi.Installed = true; fi.Registered = false;
                            fi.Note = "installed but never registered - open OTD once and Save, or apply a build using it";
                            infos["dir:" + name] = fi;
                        }
                        else
                        {
                            infos["dir:" + name] = new FilterInfo
                            {
                                Path = "dir:" + name, Display = name, Tier = "T3+?", Stage = "pre",
                                Installed = true, Registered = false,
                                Note = "UNMAPPED plugin folder - add it to FilterCatalog.FolderMap so policy can classify it",
                            };
                        }
                    }
            }
            catch { }

            return infos.Values
                .OrderBy(f => f.EnabledLive ? 0 : 1).ThenBy(f => f.Tier).ThenBy(f => f.Display)
                .ToList();
        }

        /// Conflict rules the doctor and the Filters tab both report.
        public static List<string> Conflicts(List<FilterInfo> cat)
        {
            var on = cat.Where(f => f.EnabledLive).ToList();
            var o = new List<string>();
            var antichatter = on.Where(f => f.Path.Contains("CHATTER", StringComparison.OrdinalIgnoreCase)
                                         || f.Path.Contains("CoherenceStabilizerTabletSpace")).ToList();
            if (antichatter.Count > 1)
                o.Add("two antichatter filters stacked (" + string.Join(" + ", antichatter.Select(a => a.Display)) + ") - they fight; keep one");
            foreach (var f in on.Where(f => f.Tier == "T4"))
                o.Add(f.Display + " is enabled live - T4 interpolator; every field glitch in this project traced to this class");
            if (on.Any(f => f.Path.Contains("Reconstructor")) && on.Any(f => f.Tier == "T4"))
                o.Add("Reconstructor + an interpolator: one removes smoothing the other adds");
            if (on.Any(f => f.Path.Contains("RadialFollow")) && on.Any(f => f.Path.Contains("CoherenceStabilizer")))
                o.Add("Radial Follow + Coherence Stabilizer together: a deadzone in front of a filter built to have none (historical drift bug)");
            var masters = on.Where(f => GameFilters.Any(g => g.member == "Master" && f.Path.Contains(g.id))).ToList();
            if (masters.Count > 1)
                o.Add("two game personalities live at once (" + string.Join(" + ", masters.Select(m => m.Display)) + ") - stacked personality; one game filter at a time");
            return o;
        }

        /// The latency tier a BUILD runs at, from its filter config (cohOv is the only filter
        /// presets author today; HDL is T0 and always on).
        public static string BuildTier(Preset p)
        {
            if (p.cohOv == null) return "T0";
            if (p.cohOv.lead > 0) return "T5";
            if (p.cohOv.hold > 0) return "T3";
            return "T1";
        }

        // Role policy moved to RolePolicy.cs (3.2): named roles, max tiers, and the measured
        // overrules as evidence-carrying exceptions. BuildTier stays here (it is catalog math).
    }
}
