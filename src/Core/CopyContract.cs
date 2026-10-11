using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.RegularExpressions;

namespace AimForge.Core
{
    /// <summary>
    /// The copy contract (2026-09-16 audit): every number a card's description quotes about ITSELF - 180 travel, flick
    /// spread, micro-aim, onset, tracking gain, cap speed - must equal that card's own recomputed math. The audit found
    /// 135 stale claims (266 Hz-era figures, the retired one-sample micro probe, numbers carried over from before a
    /// curve was re-authored). A number whose OWN clause names another card is a comparison and is not checked here
    /// (the clause stops at . , ; : ( ) — or ' and ' - 2026-09-16 review: a 45-character window skipped seven claims
    /// cards make about themselves, e.g. '...than Baseline/Planted/Tapped and committed flick spread 34.2%').
    /// Pure; the selftest pins the whole roster at zero violations.
    /// </summary>
    public static class CopyContract
    {
        sealed record Rule(string Name, Regex Rx, double DecTol, double IntTol);

        const RegexOptions O = RegexOptions.CultureInvariant | RegexOptions.IgnoreCase;
        static readonly Rule[] Rules =
        {
            new("180",      new Regex(@"\b180(?:°| degrees?)?\s+(?:in|at|of|costs|needs|takes)\s+(?:only\s+|just\s+)?(\d+(?:\.\d+)?)\s*mm(?!\s*at full commit)" +
                                      @"|costs\s+(\d+(?:\.\d+)?)\s*mm\s+for\s+a\s+180|\bthe\s+(\d+(?:\.\d+)?)\s*mm\s+180|fastest\s+180\s+of\s+the\s+\w+\s+family\s+\((\d+(?:\.\d+)?)\s*mm\)", O), 0.15, 0.6),
            new("spread",   new Regex(@"(?<!re-acquire )(?:committed\s+)?(?:flick\s+)?spread\s+(?:of\s+|at\s+|to\s+|stays\s+|still(?:\s+holds\s+at)?\s+|drops\s+\S+\s+(?:->|→)\s+)?(\d+(?:\.\d+)?)\s*%" +
                                      @"|within\s+(?:a\s+)?(\d+(?:\.\d+)?)\s*%\s+(?:\(committed flick\s+)?spread", O), 0.15, 0.6),
            new("micro",    new Regex(@"\bmicro(?:-aim)?\s+(\d+(?:\.\d+)?)\s*%", O), 0.15, 1.0),
            new("onset",    new Regex(@"(?:onset\D{0,14}?(\d+(?:\.\d+)?)\s*ms|(\d+(?:\.\d+)?)\s*ms\s*(?:\(two reports\)\s*)?(?:one-report\s+|two-report\s+)?onset|dead\s+time\s+(\d+(?:\.\d+)?)\s*ms)(?![^.]{0,25}creep)", O), 0.15, 0.6),
            new("spreadLazy", new Regex(@"(\d+(?:\.\d+)?)\s*%\s+on\s+lazy/hesitant\s+flicks|lazy/hesitant\s+flicks\s+(\d+(?:\.\d+)?)\s*%", O), 0.15, 0.6),
            new("track120", new Regex(@"\btracking\s+(?:reads\s+|eases to\s+|gain exactly\s+)?(\d\.\d{1,2})\s*[x×]", O), 0.011, 0.011),
            new("track30",  new Regex(@"tracking at 30 mm/s reads (\d\.\d{1,2})\s*[x×]", O), 0.011, 0.011),
            new("capAt",    new Regex(@"(?:cap\b[^.,;]{0,40}?\b(?:by|until)|cap\s+(?:\d+(?:\.\d+)?\s*[x×]\s+)?at|saturat\w*\s+(?:at|by))\s+(\d{2,4})\s*mm/s", O), 2.0, 2.0),
        };

        /// Family words that name OTHER cards in comparisons ("the baseline's 58 mm") besides the roster's own names.
        static readonly string[] FamilyWords = { "BO6", "Breakpoint", "Baseline", "Master", "Feather", "Trackline", "Turbo", "Planted" };

        public sealed record Claim(string Rule, double Quoted, double? Actual, bool Ok, bool Comparative, string Context);

        public static List<Claim> Claims(Preset p, IEnumerable<string> rosterNames, Tablet t)
        {
            var d = p.desc ?? ""; var claims = new List<Claim>();
            if (d.Length == 0) return claims;
            var names = rosterNames.Concat(FamilyWords).Distinct().OrderByDescending(n => n.Length).ToArray();
            var rg = Rig.From(p); var lut = Curve.EffectiveLut(p, rg.PxMm);
            Measured? m = null; double? spDefault = null, spCommitted = null;
            Measured M() => m ??= Measure.Run(lut, rg, t);

            foreach (var rule in Rules)
                foreach (Match x in rule.Rx.Matches(d))
                {
                    var g = x.Groups.Cast<Group>().Skip(1).First(gr => gr.Success);
                    double quoted = double.Parse(g.Value, CultureInfo.InvariantCulture);
                    if (rule.Name == "track120" && x.Value.Contains("at 30")) continue;
                    int from = Math.Max(0, x.Index - 45);
                    string pre = d.Substring(from, x.Index - from);
                    // only this claim's own clause can make it a comparison
                    pre = pre.Substring(ClauseStart(pre));
                    // 'the 58.4 mm 180 of the BO6 Original' names its subject AFTER the number: read the rest of the clause too
                    if (x.Groups[3].Success)
                    {
                        string post = d.Substring(x.Index + x.Length, Math.Min(45, d.Length - x.Index - x.Length));
                        int end = post.IndexOfAny(new[] { '.', ',', ';', ':', '(', ')', '—' }); if (end >= 0) post = post.Substring(0, end);
                        pre += " " + post;
                    }
                    string ctx = d.Substring(Math.Max(0, x.Index - 50), Math.Min(d.Length, x.Index + x.Length + 10) - Math.Max(0, x.Index - 50));
                    if (names.Any(n => n != p.name && pre.Contains(n) && !p.name.Contains(n)))
                    { claims.Add(new(rule.Name, quoted, null, true, true, ctx)); continue; }
                    double? actual = rule.Name switch
                    {
                        "180" => M().Turn180Mm,
                        "micro" => M().Micro3Pct,
                        "onset" => M().DeadMs,
                        "track120" => Curve.Summary(lut, t).track,
                        "track30" => Curve.GainAt(lut, 30),
                        "capAt" => Curve.CapSpeedMms(p),
                        "spreadLazy" => spDefault ??= Measure.FlickSpreadPct(lut, rg, t),
                        _ => Tempo(d, x) ? spDefault ??= Measure.FlickSpreadPct(lut, rg, t)
                                         : spCommitted ??= Measure.FlickSpreadPct(lut, rg, t, 90, 120, 150),
                    };
                    double tol = g.Value.Contains('.') ? rule.DecTol : rule.IntTol;
                    claims.Add(new(rule.Name, quoted, actual, actual is double a && Math.Abs(quoted - a) <= tol, false, ctx));
                }
            return claims;
        }

        /// A spread quoted for lazy/hesitant flicks is the default-tempo spread; otherwise the committed one. An explicit
        /// "committed" in the claim itself wins over a lazy label nearby ("committed flick spread 59.8% (99.2% on lazy...)").
        static bool Tempo(string d, Match x)
        {
            int from0 = Math.Max(0, x.Index - 25);
            string lead = d.Substring(from0, x.Index - from0);
            if ((lead.Substring(ClauseStart(lead)) + x.Value).Contains("committed", StringComparison.OrdinalIgnoreCase)) return false;
            int from = Math.Max(0, x.Index - 40), to = Math.Min(d.Length, x.Index + x.Length + 40);
            var around = d.Substring(from, to - from).ToLowerInvariant();
            return around.Contains("lazy") || around.Contains("hesitant") || around.Contains("default tempo");
        }

        /// Index just past the last clause boundary (. , ; : ( ) — or ' and ') in a look-behind window; 0 when there is none.
        static int ClauseStart(string pre)
        {
            int punct = pre.LastIndexOfAny(new[] { '.', ',', ';', ':', '(', ')', '—' });
            int and = pre.LastIndexOf(" and ", StringComparison.Ordinal);
            return Math.Max(punct >= 0 ? punct + 1 : 0, and >= 0 ? and + 5 : 0);
        }

        public static List<string> Violations(Preset p, IEnumerable<string> rosterNames, Tablet t)
            => Claims(p, rosterNames, t).Where(c => !c.Ok)
                .Select(c => $"{c.Rule}: copy {c.Quoted.ToString(CultureInfo.InvariantCulture)} vs {(c.Actual is double a ? a.ToString("0.###", CultureInfo.InvariantCulture) : "no value")}").ToList();
    }
}
