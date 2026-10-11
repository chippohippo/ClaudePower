using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace AimForge.Core
{
    /// <summary>
    /// Role policy as CODE, with the field overrules encoded as NAMED EXCEPTIONS carrying
    /// evidence ids - never as "ignore the rule engine". The supremacy clause this session
    /// runs under: reproducible measurements outrank remembered lore, and lore outranks
    /// generic theory. So the seven Masters keep their measured 0.90@15 floor, but only
    /// because each carries an exception pointing at the measurement that earned it -
    /// copy that floor onto a build without the exception and QC fails.
    /// </summary>
    public static class RolePolicy
    {
        public sealed class FloorException
        {
            public string EvidenceId = "", Reason = "";
            public double FloorGain, FloorUntilMmS;
        }

        // Roles and their maximum latency tier. Wildcards are Lab: QC is informational.
        static readonly string[] LabNames = { "Slipstream", "Stillframe", "Flatline", "Guardrail", "Surgeon", "Protocol", "Cannonade" };

        /// The card id a derived build came from: an Advanced-tab edit of 'feather' is 'feather~adv' and keeps
        /// feather's role and named exceptions (2026-09-16 review: every edit was judged as an unknown 'Master').
        public static string BaseId(Preset p) => (p.id ?? "").Split('~')[0];

        public static string RoleOf(Preset p)
        {
            string id = BaseId(p);
            if (LabNames.Any(n => p.name.Contains(n))) return "Lab";
            if (p.name.Contains("Master")) return "Master";
            if (p.name.Contains("Baseline") || id == "bo6og") return "Baseline";
            if (p.name.Contains("Planted") || id == "breakslow") return "Planted";
            if (p.name.Contains("Turbo") || id == "breakpoint") return "Turbo";
            if (p.name.Contains("Tapped")) return "Tapped";
            if (id == "feather" || id == "trueraw") return "Reference";
            return "Master"; // unknown names get the strictest treatment
        }

        public static int MaxTier(string role) => role switch
        {
            "Master" or "Baseline" or "Turbo" or "Tapped" => 2,
            "Planted" => 3,
            _ => 5, // Lab / Reference: anything, informational
        };

        /// The measured overrules, one entry per build id. Evidence ids resolve to JSON
        /// artifacts in the evidence directory (see EvidencePath).
        ///
        /// EMPTY as of 2026-08-29: the 0.90@15 slow-center floor (ev-20260827-slowcenter-floor,
        /// hold -17.5 -> -2.6% at no measured cost) was RETIRED by field verdict - it FELT like
        /// added latency (ev-20260829-floor-feel-verdict). No STRICT-role build (Master/Baseline/
        /// Planted/Turbo/Tapped) runs a sub-unity floor; the Lab wildcards and Reference cards keep
        /// their authored 0.70/0.85 floors and QC warns about them. The mechanism stays so a future
        /// measured exception can be declared, and a strict role without one FAILS QC.
        public static readonly Dictionary<string, FloorException> FloorExceptions = new();

        /// The field verdict that retired the floor - cited by QC copy, kept as a first-class id.
        public const string FloorFeelEvidenceId = "ev-20260829-floor-feel-verdict";

        /// Snap overrule: the field validated 9-12 degrees (2026-08-19 field result + src/snap.cs:
        /// on an axis turn snapping removes 100% of perpendicular wander at zero lag; the cone is
        /// sized by the SLOWEST turn). Builds citing it may exceed the generic 6-degree caution.
        public const string SnapEvidenceId = "ev-20260819-snap-field";

        public static double FloorOf(Preset p)
            => p.IsLut ? p.lut![0][1] : 1.0; // classic legacy is exactly 1.0 below the offset

        /// QC-level findings. Entries prefixed "warn:" are warnings; the rest are violations.
        /// DTC-141 active area width (D:/Pen/userdata DTC-141.json: Width 309 mm).
        public const double TabletActiveWidthMm = 309;

        /// `rig` = the rig being APPLIED (the user's cm/360, px/mm and reset); null = the card's own.
        public static List<string> Check(Preset p, Rig? rig = null)
        {
            var o = new List<string>();
            string role = RoleOf(p);
            string tier = PlanTier(p);   // cohOv tier + the plan's game filters
            int n = tier[1] - '0';
            var rg = rig ?? Rig.From(p);
            double resetMs = rig?.ResetMs ?? p.ResetMs;

            // reach (2026-09-16 audit gap): a 180 that needs more than half the DTC-141's 309 mm active width cannot be
            // thrown from the centre of the tablet in one stroke - warn on every role
            double t180 = Curve.Turn180Mm(Curve.EffectiveLut(p, rg.PxMm), rg);
            if (t180 > TabletActiveWidthMm / 2)
                o.Add($"warn: a 180 needs {t180:0} mm of pen travel - more than half the tablet's {TabletActiveWidthMm:0} mm width; turns take a lift-and-reset");
            if (role == "Lab" || role == "Reference")
            {
                if (n >= 4) o.Add($"warn: lab-class {tier} build - measured and deliberate, never a daily default");
                if (FloorOf(p) < 0.999)
                    o.Add($"warn: floor {FloorOf(p):0.00} below unity - retired for strict roles by [{FloorFeelEvidenceId}]; kept on this {role} card by design");
                if (resetMs <= 0) o.Add("reset ms is 0 - relative mode cannot re-origin after a lift; this is broken, not fast");
                return o;
            }

            if (n > MaxTier(role))
                o.Add($"{role} runs {tier} but its role allows at most T{MaxTier(role)} - hold smoothing/prediction is not allowed here");

            double floor = FloorOf(p);
            if (floor < 0.999)
            {
                // every strict role, Planted included, needs a named exception (2026-09-16 review: Planted passed with
                // a warning, contradicting this class's contract and the retired 0.90 floor verdict)
                if (FloorExceptions.TryGetValue(BaseId(p), out var ex) && Math.Abs(floor - ex.FloorGain) < 0.005)
                    o.Add($"warn: floor {floor:0.00} below unity - allowed by named exception [{ex.EvidenceId}]: {ex.Reason}");
                else
                    o.Add($"{role} has floor {floor:0.00} without a named exception - unity at the 1-unit step is the role contract");
            }

            if (p.snap > 6 && role == "Turbo" && FilterCatalog.GameOfGroup(p.group) is "ow2" or "rivals")
                o.Add($"warn: snap {p.snap} deg on a projectile-heavy role - the 9-12 field evidence [{SnapEvidenceId}] was measured on hitscan turns");

            if (resetMs <= 0)
                o.Add("reset ms is 0 - relative mode cannot re-origin after a lift; this is broken, not fast");
            return o;
        }

        /// The build's tier including its PLAN's game filters (cohOv tier alone is BuildTier).
        public static string PlanTier(Preset p)
        {
            int n = FilterCatalog.BuildTier(p)[1] - '0';
            foreach (var f in p.filters ?? new List<FilterSpec>())
                if (f.on)
                    foreach (var g in FilterCatalog.GameFilters)
                        if (f.id.Contains(g.id) || g.id.EndsWith(f.id))
                            n = Math.Max(n, g.tier[1] - '0');
            return "T" + n;
        }

        /// Hard blockers for Apply on strict roles (violations only, never warnings).
        public static List<string> ApplyBlockers(Preset p, Rig? rig = null)
            => Check(p, rig).Where(c => !c.StartsWith("warn:")).ToList();

        /// THE apply gate, shared by the GUI and `--apply` (2026-09-16 audit: the CLI ran a strictly weaker gate
        /// and the GUI validated the catalogue's plan, not the one it wrote). Curve QC (LUT cards; classic cards
        /// meet the point-shape rules by construction), role policy, the plan of THIS preset, and the caller's
        /// pre-flight blockers (Cadence plugin present, pen device config sane). A plan that cannot be validated
        /// is a loud warning, never a silent pass.
        public static (List<string> blockers, List<string> warnings) GateForApply(Preset p, Tablet t, Func<List<FilterInfo>> discover, Rig? rig, params string?[] preflight)
        {
            var blockers = new List<string>(); var warnings = new List<string>();
            if (p.IsLut) blockers.AddRange(Curve.Check(p, t));
            var pol = Check(p, rig);
            blockers.AddRange(pol.Where(c => !c.StartsWith("warn:")));
            warnings.AddRange(pol.Where(c => c.StartsWith("warn:")).Select(c => c.Substring(5).Trim()));
            try { var (pb, pw) = ValidatePlan(p, p.filters, discover()); blockers.AddRange(pb); warnings.AddRange(pw); }
            catch (Exception ex) { warnings.Add("plan validation could NOT run (" + ex.Message + ") - applying without the plan checks"); }
            foreach (var s in preflight) if (!string.IsNullOrEmpty(s)) blockers.Add(s!);
            return (blockers, warnings);
        }

        /// Validate a declared filter plan against the discovered catalog: unknown ids are
        /// warnings (never written), not-installed ids are skipped with a note; two antichatter
        /// entries or any T4/T5 plan entry on a strict role is a blocker. Session 3 adds the
        /// game-filter rules: *.Lab on a strict role is a blocker, two game Masters at once is
        /// a blocker, a cross-game filter is a warning.
        public static (List<string> blockers, List<string> warnings) ValidatePlan(Preset p, List<FilterSpec>? plan, List<FilterInfo> catalog)
        {
            var blockers = new List<string>(); var warnings = new List<string>();
            if (plan == null || plan.Count == 0) return (blockers, warnings);
            string role = RoleOf(p);
            bool strict = MaxTier(role) <= 2;

            var gameOn = plan.Where(f => f.on)
                .Select(f => FilterCatalog.GameFilters.FirstOrDefault(g => f.id.Contains(g.id) || g.id.EndsWith(f.id)))
                .Where(g => g.id != null).ToList();
            if (gameOn.Count(g => g.member == "Master") > 1)
                blockers.Add("plan enables two game-Master personalities at once (" +
                    string.Join(" + ", gameOn.Where(g => g.member == "Master").Select(g => g.game)) + ") - one game filter at a time");
            foreach (var g in gameOn.Where(g => g.member == "Lab"))
                if (strict) blockers.Add($"plan enables the {g.game} LAB filter [{g.tier}] on a {role} build - Lab members are Planted/Guardrail/Lab-card territory");
            string? myGame = FilterCatalog.GameOfGroup(p.group);
            foreach (var g in gameOn)
                if (myGame != null && g.game != myGame)
                    warnings.Add($"cross-game filter: {g.game} personality on a {myGame} card - it will apply, but the policy was tuned for {g.game}");
            var on = new List<FilterInfo>();
            // the game-filter plugin: OtdBridge.Apply writes ANY of its members whenever the DLL is installed, registered
            // in settings.json or not (2026-09-16 review: HoldfastMaster/ValLab drew a false 'will NOT be written')
            bool gamePlugin = catalog.Any(c => c.Installed && (c.Path.StartsWith("AimForge.Filters.", StringComparison.OrdinalIgnoreCase)
                                                             || c.Path.Contains("AimForge Game Filters", StringComparison.OrdinalIgnoreCase)
                                                             || c.Display.Contains("AimForge Game Filters", StringComparison.OrdinalIgnoreCase)));
            foreach (var f in plan.Where(f => f.on))
            {
                var hit = catalog.FirstOrDefault(c => c.Path.Contains(f.id, StringComparison.OrdinalIgnoreCase));
                if (hit == null && gamePlugin && FilterCatalog.GameFilters.Any(g => g.id == f.id)) continue;   // tier rules above already cover it
                if (hit == null) { warnings.Add($"plan filter '{f.id}' is not in the catalog - it will NOT be written"); continue; }
                if (!hit.Installed) { warnings.Add($"plan filter '{f.id}' is not installed - skipped; the rest of the plan still applies"); continue; }
                on.Add(hit);
            }
            int anti = on.Count(f => f.Path.Contains("CHATTER", StringComparison.OrdinalIgnoreCase)
                                   || f.Path.Contains("CoherenceStabilizerTabletSpace"));
            if (anti > 1) blockers.Add("plan stacks two antichatter filters - they fight; keep one");
            foreach (var f in on.Where(f => f.Tier == "T4" || f.Tier == "T5"))
                if (strict) blockers.Add($"plan enables {f.Display} [{f.Tier}] on a {role} build - refused (interpolation/prediction is lab-only)");
                else warnings.Add($"plan enables {f.Display} [{f.Tier}] - accepted on {role}, budget stated");
            if (on.Any(f => f.Path.Contains("Reconstructor")))
                (strict ? blockers : warnings).Add("Reconstructor on a Wacom EMR tablet: no hardware EMA exists to undo - it can only add error");
            return (blockers, warnings);
        }

        public static string EvidenceDir
        {
            get
            {
                string local = Path.Combine(AppContext.BaseDirectory, "evidence");
                if (Directory.Exists(local)) return local;
                string repo = Path.Combine(AppContext.BaseDirectory, "..", "evidence"); // dev tree: out\..\evidence
                return Directory.Exists(repo) ? Path.GetFullPath(repo) : local;
            }
        }
    }
}
