using System;
using System.Collections.Generic;
using System.Linq;
using System.Globalization;
using System.Text;
using AimForge.Filters;

namespace AimForge.Core
{
    /// <summary>
    /// Hero lab (2026-09-15; renovated 2026-09-16 after a full audit): one method for every character card. Each hero
    /// is a set of engagements built from the kit facts (weapon type, projectile speed, fire rhythm, recoil, ranges, the
    /// targets it fights, the big turn the kit forces), scored with the SAME human model, the SAME shipping curve math at
    /// the pen's 360 Hz clock, RawAccel's exact angle snap and - where the game family ships one - that family's own game
    /// filter, built from its exported plan. Psylocke runs here too; the old tracking-only PsyLab rule is history.
    ///
    /// Target switches are two-component aimed movements: a ballistic minimum-jerk throw (90 ms + 0.45 ms per degree; the
    /// big re-acquire at the hero's own tempo) with human tempo variability (PsyLab Params.Vigor), then one corrective
    /// submovement once the landing is seen. Every clock of a switch is warped with that throw's tempo.
    ///
    /// RELATIVE scoring: engagements have very different natural error sizes (a 45-degree switch vs a held strafe), so each
    /// one is scored against the best that any legal curve in the SAME stage achieves in that engagement, and the excess is
    /// scaled by how often the fight happens (weight / largest weight). Each stage has its own baseline set (phase-1 grid,
    /// phase-2 pool variants, per-hand-model best variants) and the evidence labels which.
    ///
    /// Selection is automatic and identical for every hero, so no card is hand-picked:
    ///  1. phase 1 - a curve grid (unity tracking band + saturating flick ramp, early-sat, flats) at snap 5 and the game
    ///     family's Y/X, no filter; the shipping cards are scored as references only;
    ///  2. legal = onset <= two reports and micro 90-130% (both THROUGH the variant's own filter), a 180 inside 70 mm at a
    ///     150 ms throw, no report of any scenario - the ballistic throw included - above 600 mm/s of pen speed, and for a
    ///     tap-fire hero a click skid no worse than the field-rated BO6 base + 15%;
    ///  3. pool = the 8 best legal curves by relative score + the 4 most consistent re-acquires within 10% of the best;
    ///  4. phase 2 - pool x angle snap {0,3,5,9} x the family's game filter {off,on} (only where the family ships one);
    ///     each curve keeps its best legal variant;
    ///  5. robustness - those variants rescored under four other human models; regret = the worst relative score in any
    ///     model; among curves within 5% of the most robust one, the most consistent re-acquire wins (then lower weighted).
    /// Y/X is the game family's field value, not a search dimension: the model has no vertical-reach cost, so any Y/X grid
    /// picks its lowest value. For the same reason cm/360 is capped at the field-tested 37.7 and a 180 must fit in 70 mm -
    /// which together make 3x the smallest cap that is legal at 37.7 (188.5 mm / 70 mm = 2.69x). What the lab decides per
    /// hero is the ramp's position, the snap and the filter.
    /// </summary>
    public static class HeroLab
    {
        public const double K_OW2 = 138545.5, TOL = 0.05;

        public sealed class Hero
        {
            public string Id = "", Name = "", Game = "", Archetype = "", Kit = "";
            public double K, ReacqDeg = 135, ReacqMs = 150;
            /// The primary fire is a click per shot (a skid lands on every shot), not a held spray.
            public bool TapFire;
            public GameFilterCore.Game FilterGame;
            public PsyLab.Scen[] Scens = Array.Empty<PsyLab.Scen>();
            /// The family card whose Y/X and game-filter plan this hero inherits.
            public string FamilyCard => FamilyCardOverride ?? (Game == "rivals" ? "rivmp" : "owmp");
            /// 2026-10-23 (GameLab): a game-family role names its own family card, 180 limit and candidate set.
            public string? FamilyCardOverride;
            public double Max180Mm = 70;
            public Func<Hero, Catalogue, double, List<PsyLab.Cand>>? CandidateSet;
            /// Y/X when the family card cannot be read (a role whose family card is being re-authored).
            public double YxDefault = 0.85;
            /// 2026-10-24 (the GOAT field verdict: angle snap and the Y/X ratio made aim inconsistent): every hero and role
            /// is searched at snap 0 and Y/X 1.00. Null restores the family card's Y/X; the snap set restores {0,3,5,9}.
            public double? YxOverride = Goat.Yx;
            public double[] SnapSet = { Goat.Snap };
            /// The peak hand-speed gate (mm/s). 600 in the 37.7 cm world; since 2026-10-24 it is the larger of 600 and the
            /// GOAT's own peak on the same fights (PeakCap) - the GOAT is field-proven, so a curve asking no more of the hand
            /// than the GOAT does is playable. Null = 600.
            public double? PeakCapMms;
        }

        /// The hero's peak-speed gate: max(600, the GOAT's own peak on the hero's fights), cached on the hero.
        public static double PeakCap(Hero h, Catalogue cat)
        {
            if (h.PeakCapMms is double v) return v;
            double cap = 600;
            if (cat.Find(Goat.Id) is Preset g)
            {
                var q = PsyLab.WithSnap(g, h.SnapSet[0]); q.adv.yx = h.YxOverride ?? g.Yx;
                var r = PsyLab.Score(new PsyLab.Cand { Name = "goat", Family = "reference", P = q, FilterGame = h.FilterGame }, cat.tablet, new PsyLab.Params(), h.Scens, h.K);
                cap = Math.Max(cap, Math.Ceiling(r.PerScen.Max(x => x.PeakAllMms)));
            }
            h.PeakCapMms = cap;
            return cap;
        }

        static PsyLab.Scen S(string n, double d, double lat, double rev, double w, double proj = 0, double vamp = 0, double vhz = 0,
                             double recoil = 0, double h = 0, double fall = 0, double step = 0, double stepS = 0, double r = 0)
            => new PsyLab.Scen { Name = n, D = d, Lat = lat, Rev = rev, W = w, Proj = proj, VAmp = vamp, VHz = vhz, RecoilDegS = recoil,
                                 H = h, Fall = fall, StepDeg = step, StepS = stepS, SettleOnly = stepS > 0, TargetR = r };

        /// 2026-10-24: the heroes' 180 limit = the GOAT's own measured 180 (87.7 mm at 52.63 cm/360) x1.15; the old 70 mm was set
        /// for the 37.7 cm world.
        public const double HeroMax180Mm = 101;

        static Hero Rivals(string id, string name, string arch, string kit, bool tap, double rqDeg, double rqMs, params PsyLab.Scen[] sc)
            => WithReacquire(new Hero { Id = id, Name = name, Game = "rivals", K = PsyLab.K_RIVALS, FilterGame = GameFilterCore.Game.Rivals, Archetype = arch, Kit = kit, TapFire = tap, ReacqDeg = rqDeg, ReacqMs = rqMs, Scens = sc, Max180Mm = HeroMax180Mm }, 6);
        static Hero Ow2(string id, string name, string arch, string kit, bool tap, double rqDeg, double rqMs, params PsyLab.Scen[] sc)
            => WithReacquire(new Hero { Id = id, Name = name, Game = "ow2", K = K_OW2, FilterGame = GameFilterCore.Game.Ow2, Archetype = arch, Kit = kit, TapFire = tap, ReacqDeg = rqDeg, ReacqMs = rqMs, Scens = sc, Max180Mm = HeroMax180Mm }, 5.5);

        /// Every hero also fights the big turn its kit forces (dash / teleport / swap / a flanker behind): one switch of
        /// ReacqDeg at 8 m thrown at the hero's own re-acquire tempo, weight 15% (the kit scenarios keep 85%). Projectile
        /// speed and hit radius follow the hero's first scenario.
        static Hero WithReacquire(Hero h, double lat)
        {
            foreach (var s in h.Scens) s.W *= 0.85;
            var f = h.Scens[0];
            var rs = S($"R re-acquire {h.ReacqDeg:0}deg/{h.ReacqMs:0}ms 8m", 8, lat, 0.5, 0.15, proj: f.Proj, step: h.ReacqDeg, stepS: 1.2, r: f.TargetR);
            rs.FlickMs = h.ReacqMs;
            h.Scens = h.Scens.Append(rs).ToArray();
            return h;
        }

        // Targets: Rivals heroes 6 m/s (Black Panther 7, Iron Man / Star-Lord up to 12 flying); OW2 5.5 m/s (Lucio / Genji
        // burst faster, Echo flight 8). Lat = relative lateral speed incl. your own strafe.
        public static readonly Hero[] Heroes =
        {
            Rivals("psylocke", "Psylocke", "hitscan dive duelist: crossbow tracking at 4-12 m + the dash re-acquire",
                "Psionic Crossbow: hitscan, 4 bolts per cast, 12 damage per bolt, crit 150%, 0.2 s between shots and 0.6 s between rounds, spread radius 0.2 m at 10 m, falloff from 15 m to 60% at 30 m, 16 ammo; Psi-Blade Dash 12 m, 2 charges, passes through the target; 150 HP + 100 shield, 6 m/s",
                true, 135, 150,
                S("S1 backline strafe 7m", 7, 6, 0.45, 0.25),
                S("S2 point-blank duel 4m", 4, 9, 0.35, 0.30),
                S("S3 flyer boost 8m", 8, 12, 1.2, 0.25, vamp: 1.5, vhz: 0.6),
                S("S4 far poke 12m", 12, 6, 0.6, 0.20)),
            Rivals("loki", "Loki", "projectile healer: lead + ally/enemy switching",
                "Mystical Missile: projectile ~100 m/s, 25-30 damage / 40 heal per cast, 3 m explosion (full inside 0.5 m, 50% at 2.5 m), no crits, 1.75 casts/s, 10 ammo; the same missile heals allies; Devious Exchange swap; Doppelganger clones mirror casts; 275 HP, 6 m/s",
                true, 90, 200,
                S("L1 heal-track ally 12m", 12, 6, 0.8, 0.25, proj: 100, r: 0.5),
                S("L2 poke a diver 10m", 10, 8, 0.45, 0.25, proj: 100, r: 0.5),
                S("L3 flyer 15m", 15, 12, 1.2, 0.20, proj: 100, vamp: 1.5, vhz: 0.6, r: 0.5),
                S("L4 ally-enemy switch 40deg", 10, 3, 0.8, 0.30, proj: 100, step: 40, stepS: 0.8, r: 0.5)),
            Rivals("whitefox", "White Fox", "projectile healer: bouncing marbles + teleport re-target + melee form",
                "Yeowoo Guseul (Fox Marbles): projectile 120 m/s (80 m/s after a bounce), 35 m range, 40 damage / 55 heal direct, 25 / 40 on a bounce, 0.45 s per round, bounces off terrain then homes once onto an ally or enemy; Spectral Surge 65 damage/heal + 0.4 s charm; Spirit Sanctuary teleports to an ally; Awakened Fox Form: 35-damage claw strikes at melee range; 275 HP, 6 m/s",
                true, 120, 180,
                S("W1 heal-track ally 15m", 15, 6, 0.8, 0.30, proj: 120, r: 0.4),
                S("W2 poke a strafer 12m", 12, 6, 0.45, 0.25, proj: 120, r: 0.4),
                S("W3 Sanctuary re-target 60deg", 8, 4, 0.6, 0.25, proj: 120, step: 60, stepS: 0.9, r: 0.4),
                S("W4 Awakened claw brawl 3m", 3, 7, 0.35, 0.20, r: 0.7)),
            Rivals("punisher", "The Punisher", "hitscan tracker: rifle spray + shotgun point-blank",
                "Adjudication: hitscan rifle 19-20 damage, 10 rounds/s, crits, falloff from 20 m to 70% at 40 m, spread 0.2 m tightening to 0.05 m after 20 shots; Deliverance shotgun 14 pellets x 10, falloff 8 m to 40% at 15 m; Culling Turret 12.5 rounds/s; Vantage Connection zipline; 300 HP, 6 m/s",
                false, 90, 160,
                S("P1 rifle strafe 15m", 15, 6, 0.45, 0.30),
                S("P2 rifle lane 25m", 25, 6, 0.6, 0.20),
                S("P3 flyer 18m", 18, 12, 1.2, 0.25, vamp: 1.5, vhz: 0.6),
                S("P4 shotgun point-blank switch 5m", 5, 7, 0.4, 0.25, step: 25, stepS: 0.7, r: 0.3)),
            Rivals("hela", "Hela", "hitscan precision tapper: crits at range + flyers",
                "Nightsword Thorn: hitscan 70 damage, crits, 2 rounds/s, 10 ammo, falloff from 18 m to 70% at 30 m; Piercing Night 3 m field + stun; Soul Drainer 3 m field; Astral Flock flight escape; 250 HP, 6 m/s",
                true, 90, 180,
                S("H1 head poke 25m", 25, 6, 0.6, 0.25),
                S("H2 flyer snipe 22m", 22, 12, 1.2, 0.30, vamp: 2.0, vhz: 0.5),
                S("H3 head-to-head switch 15m", 15, 5, 0.6, 0.25, step: 15, stepS: 0.5),
                S("H4 stun brawl 6m", 6, 9, 0.35, 0.20)),
            Ow2("soldier76", "Soldier: 76", "hitscan tracker with vertical recoil",
                "Heavy Pulse Rifle: hitscan 19 damage (5.7 at 50 m, falloff from 30 m), 9 rounds/s, 30 ammo, headshot x2, no spread (spread was replaced by vertical recoil in 2020), ~0.1 deg of climb per shot (~0.9 deg/s of pull-down while firing); Helix Rockets 50 m/s; Sprint +50%; Tactical Visor; 250 HP",
                false, 90, 180,
                S("S1 rifle strafe 15m + recoil", 15, 5.5, 0.45, 0.30, recoil: 0.88),
                S("S2 rifle lane 30m + recoil", 30, 5.5, 0.6, 0.20, recoil: 0.88),
                S("S3 Pharah/Echo flyer 25m", 25, 8, 1.2, 0.20, vamp: 2.0, vhz: 0.5, recoil: 0.88),
                S("S4 Genji/Lucio dive 6m", 6, 9, 0.35, 0.30, recoil: 0.88)),
            Ow2("emre", "Emre", "hitscan burst: mid-range volleys + zoom lane + projectile brawl",
                "Synthetic Burst Rifle: hitscan 3-round volley, 22 per round (6.67 at max falloff, 25-40 m), 2.08 volleys/s, hip-fire spread up to 0.45 deg; Take Aim: zoomed, no spread, falloff 35-50 m, 0.192 s scope-in; Siphon Blaster: projectile 100 m/s, 10 direct + 15-5 splash, 4.8 shots/s, +35% move speed for 5 s; Cyber Frag 35 m/s; 250 HP",
                true, 90, 180,
                S("E1 volley mid-range 20m", 20, 5.5, 0.5, 0.30),
                S("E2 Take Aim lane 35m", 35, 5.5, 0.6, 0.20),
                S("E3 Siphon Blaster brawl 7m", 7, 8, 0.4, 0.25, proj: 100),
                S("E4 volley-to-volley switch 12m", 12, 4, 0.6, 0.25, step: 25, stepS: 0.48)),
            Ow2("illari", "Illari", "hitscan charged precision: long pokes, flyers, self-peel",
                "Solar Rifle: hitscan charged shot 25-75 damage (0.65 s to full charge, 0.25 s recovery), headshot x1.5, falloff 30-50 m, 14 ammo; heal beam 20 m; Outburst 18.4 m/s; Healing Pylon; Captive Sun 30 m/s; 250 HP",
                true, 120, 200,
                S("I1 charged poke 30m", 30, 5.5, 0.6, 0.25),
                S("I2 flyer 25m", 25, 8, 1.2, 0.25, vamp: 2.0, vhz: 0.5),
                S("I3 diver peel 6m", 6, 9, 0.35, 0.25),
                S("I4 shot-to-shot switch 20m", 20, 4, 0.6, 0.25, step: 20, stepS: 0.9)),
            Ow2("freja", "Freja", "projectile precision: fast bolts, aerial dive-bombs, dash re-aim",
                "Revdraw Crossbow Quick Shot: projectile 125 m/s, 28 damage, headshot x2, 5.5 shots/s, spread up to 1.5 deg horizontal, 15 ammo; Take Aim: charged explosive bolt 125 m/s, 35 direct + 75-30 explosion (0.6-2.5 m), movement -80% ground / -85% air, 0.192 s scope-in; Quick Dash 20 m/s, 2 charges; Updraft 8.4 m up; Bola Shot 70 m/s; 225 HP",
                true, 120, 180,
                S("F1 Quick Shot strafe 12m", 12, 5.5, 0.45, 0.25, proj: 125),
                S("F2 Updraft dive-bomb 15m", 15, 5.5, 0.6, 0.25, proj: 125, h: 8.4, fall: 3.5),
                S("F3 Take Aim bolt 30m", 30, 5.5, 0.6, 0.20, proj: 125),
                S("F4 Quick Dash re-aim 45deg", 10, 5, 0.5, 0.30, proj: 125, step: 45, stepS: 0.8)),
        };

        public static Hero? Find(string id) => Heroes.FirstOrDefault(h => h.Id.Equals(id, StringComparison.OrdinalIgnoreCase));

        public static List<PsyLab.Cand> Candidates(Hero h, Catalogue cat, double yx)
        {
            var o = new List<PsyLab.Cand>();
            var refs = h.Game == "rivals" ? new[] { "rivpsy", "rivmp", "rivlla", "rivllb", "rivllc", "breakpoint" } : new[] { "owmp", "owlla", "owllb", "owllc", "breakpoint" };
            foreach (var id in refs)
                if (cat.Find(id) is Preset p) { var q = PsyLab.WithSnap(p, h.SnapSet[0]); q.adv.yx = yx; o.Add(new PsyLab.Cand { Name = "ref " + id, Family = "reference", P = q }); }
            // cm/360 ceiling = the field-tested base (the GOAT's 52.63 since 2026-10-24; 37.7 before): the human model has no
            // cost for a LONGER hand motion, so left open it always prefers less gain. The lab may only go FASTER than the base.
            double C = Goat.Cm, sn = h.SnapSet[0];
            var cms = new[] { Math.Round(C * 0.8, 2), Math.Round(C * 0.9, 2), C };
            // the GOAT's own curve is always a candidate: 1:1 to 40 mm/s, cap 3.0 at 190 mm/s
            o.Add(new PsyLab.Cand { Name = $"goat cm{C}", Family = "trackline-sat", P = PsyLab.TracklineSat(C, Goat.UnityMms, Goat.Cap, Goat.CapAtMms, yx, sn) });
            foreach (var cm in cms)
                foreach (var off in new[] { 40.0, 60.0, 100.0, 130.0, 150.0, 170.0, 200.0 })
                    foreach (var G in new[] { 2.0, 3.0, 4.0 })
                        foreach (var span in new[] { 60.0, 110.0, 200.0 })
                            o.Add(new PsyLab.Cand { Name = $"tl-sat cm{cm} off{off} G{G} @{off + span}", Family = "trackline-sat", P = PsyLab.TracklineSat(cm, off, G, off + span, yx, sn) });
            foreach (var cm in cms)
                foreach (var G in new[] { 3.0, 4.0, 5.0 })
                    foreach (var sc in new[] { 80.0, 110.0, 150.0, 200.0 })
                        o.Add(new PsyLab.Cand { Name = $"early-sat cm{cm} G{G} @{sc}", Family = "early-sat", P = PsyLab.EarlySat(cm, G, sc, 0.5, yx, sn) });
            foreach (var f in new[] { 0.7, 0.8, 0.9, 1.0 })
                o.Add(new PsyLab.Cand { Name = $"flat cm{Math.Round(C * f, 2)}", Family = "flat", P = PsyLab.Flat(Math.Round(C * f, 2), yx, sn) });
            foreach (var c in o) c.FilterGame = h.FilterGame;
            return o;
        }

        public sealed class Scored
        {
            public PsyLab.Cand C = null!; public PsyLab.Result R = null!; public string Base = "", WhyIllegal = "";
            public double Rq, RqMm, Rel = double.NaN, Regret = double.NaN; public bool Legal;
        }

        public static readonly (string label, PsyLab.Params prm)[] StressModels =
        {
            ("steadier hand (KPar .06, S0 .8)", new PsyLab.Params { KPar = 0.06, S0 = 0.8 }),
            ("shakier hand (KPar .14, S0 2.5)", new PsyLab.Params { KPar = 0.14, S0 = 2.5 }),
            ("slow visual loop (Kp 2, delay 180ms)", new PsyLab.Params { Kp = 2.0, VisDelay = 0.18 }),
            ("snappy reversals (follow 4 Hz)", new PsyLab.Params { FollowHz = 4.0 }),
        };

        /// The legality gates, with the reason each one failed (2026-09-16: recorded in the evidence per candidate).
        public static (bool ok, string why) LegalOf(PsyLab.Result r, Hero h, double skidCapMm)
        {
            var why = new List<string>();
            if (r.DeadMs > 2000.0 / PsyLab.HZ + 0.3) why.Add($"onset {r.DeadMs:0.0} ms");
            if (r.MicroPct < 90 || r.MicroPct > 130) why.Add($"micro {r.MicroPct:0}%");
            if (r.Turn180Mm > h.Max180Mm) why.Add($"180 {r.Turn180Mm:0} mm");
            double pk = r.PerScen.Max(q => q.PeakAllMms); if (pk > (h.PeakCapMms ?? 600)) why.Add($"peak {pk:0} mm/s");
            if (h.TapFire && r.SkidMm > skidCapMm) why.Add($"click skid {r.SkidMm:0.000} mm");
            return (why.Count == 0, string.Join(", ", why));
        }

        /// The click-skid ceiling for tap-fire heroes: the field-rated base's measured skid + 15% (the GOAT since 2026-10-24,
        /// BO6 Original before it existed).
        public static double SkidCap(Catalogue cat)
        {
            var bo = cat.Find(Goat.Id) ?? cat.Find("bo6og")!;
            return Measure.Run(Curve.EffectiveLut(bo, bo.pxmm), Rig.From(bo), cat.tablet).SkidMm * 1.15;
        }

        /// Per-engagement best error across a set of results.
        static double[] Minima(IEnumerable<PsyLab.Result> set, int n)
        {
            var arr = set.ToList();
            return Enumerable.Range(0, n).Select(k => arr.Min(r => r.PerScen[k].HeadRadii)).ToArray();
        }

        /// Relative score: max over engagements of 1 + (error / best error - 1) x weight / largest weight.
        public static double RelScore(PsyLab.Result r, double[] min, Hero h)
        {
            double wmax = h.Scens.Max(s => s.W), worst = 1;
            for (int k = 0; k < min.Length; k++)
                worst = Math.Max(worst, 1 + (r.PerScen[k].HeadRadii / Math.Max(1e-9, min[k]) - 1) * h.Scens[k].W / wmax);
            return worst;
        }

        static PsyLab.Cand Variant(PsyLab.Cand c, double snap, double yx, FilterSpec? spec)
        {
            var p = PsyLab.WithSnap(c.P, snap); p.adv.yx = yx;
            return new PsyLab.Cand { Name = $"{c.Name} s{snap}{(spec != null ? " +Master" : "")}", Family = c.Family, P = p, Filter = spec != null, FilterSpec = spec, FilterGame = c.FilterGame };
        }

        public static string Line(Scored x)
            => PsyLab.Row(x.R) + $"  reacq {x.Rq,5:0.0}%  skid {x.R.SkidMm:0.000}  peakAll {x.R.PerScen.Max(q => q.PeakAllMms),4:0}  raNoise {x.R.RawAccelNoisePct,4:0.0}%  rel {x.Rel:0.000}"
               + (x.Legal ? "" : "  ILLEGAL(" + x.WhyIllegal + ")") + (double.IsNaN(x.Regret) ? "" : $"  regret {x.Regret:0.000}");

        public sealed class Outcome
        {
            public Hero Hero = null!; public Scored Winner = null!; public List<Scored> Phase1 = new(), Phase2 = new(), Top = new();
            public List<object> Robust = new(); public PsyLab.Result? WinnerFlipped; public double[] Min1 = Array.Empty<double>(), Min2 = Array.Empty<double>();
            public double Yx, SkidCapMm; public string? FamilyFilter;
        }

        public static Outcome Run(Hero h, Catalogue cat, Action<string> log)
        {
            var tab = cat.tablet; var prm = new PsyLab.Params(); int ns = h.Scens.Length;
            var fam = cat.Find(h.FamilyCard);
            double yx = h.YxOverride ?? fam?.Yx ?? h.YxDefault;
            var famSpec = fam?.filters?.FirstOrDefault(f => f.on && PlanFilters.IsGameFilter(f.id));
            double skidCap = SkidCap(cat);
            PeakCap(h, cat);
            Scored Sc(PsyLab.Cand c, PsyLab.Params p, string baseName)
            {
                var rq = PsyLab.ReacquireSpread(c, h.ReacqDeg, h.ReacqMs);
                var r = PsyLab.Score(c, tab, p, h.Scens, h.K);
                var (ok, why) = LegalOf(r, h, skidCap);
                return new Scored { C = c, R = r, Rq = rq.spreadPct, RqMm = rq.travelMm, Base = baseName, Legal = ok, WhyIllegal = why };
            }
            var o = new Outcome { Hero = h, Yx = yx, SkidCapMm = skidCap, FamilyFilter = famSpec?.id };
            log($"##### {h.Name} ({h.Game}) - {h.Archetype}");
            log($"peak hand-speed gate {h.PeakCapMms:0} mm/s (max of 600 and the GOAT's own peak on these fights) | 180 limit {h.Max180Mm:0.0} mm");
            log($"Y/X {yx} (the {h.FamilyCard} family's field value) | game-filter dimension: {(famSpec == null ? "none - the family ships no Master filter" : famSpec.id)} | click-skid cap: {(h.TapFire ? $"{skidCap:0.000} mm (tap fire)" : "none (hold-to-fire)")}");
            log("cells = RMS execution error in target radii / % of samples on target, for " + string.Join(" | ", h.Scens.Select(s => s.Name)));

            var cands = h.CandidateSet != null ? h.CandidateSet(h, cat, yx) : Candidates(h, cat, yx);
            var p1 = cands.AsParallel().AsOrdered().Select(c => Sc(c, prm, c.Name)).ToList();
            var legal = p1.Where(x => x.Legal && x.C.Family != "reference").ToList();
            if (legal.Count == 0) { log("!! no legal curve - relaxing to every non-reference curve"); legal = p1.Where(x => x.C.Family != "reference").ToList(); }
            o.Min1 = Minima(legal.Select(x => x.R), ns);
            foreach (var x in p1) x.Rel = RelScore(x.R, o.Min1, h);
            o.Phase1 = p1.OrderBy(x => x.Rel).ThenBy(x => x.R.Weighted).ToList();
            log($"=== phase 1: {cands.Count} curves @ snap {h.SnapSet[0]:0}, no filter - best legal per engagement: " + string.Join(" / ", o.Min1.Select(v => v.ToString("0.000"))) + " ===");
            foreach (var x in o.Phase1) log(Line(x) + (x.C.Family == "reference" ? "  (reference)" : ""));

            legal = legal.OrderBy(x => x.Rel).ThenBy(x => x.R.Weighted).ToList();
            double best = legal[0].Rel;
            var pool = legal.Take(8).Concat(legal.Where(x => x.Rel <= best * 1.10).OrderBy(x => x.Rq).ThenBy(x => x.R.Weighted).Take(4)).Distinct().ToList();
            log($"=== pool (8 best + 4 most consistent within 10% of rel {best:0.000}): " + string.Join(" | ", pool.Select(x => x.C.Name)));

            var variants = new List<(PsyLab.Cand v, string b)>();
            var specs = famSpec == null ? new FilterSpec?[] { null } : new FilterSpec?[] { null, famSpec };
            foreach (var x in pool) foreach (var sv in h.SnapSet) foreach (var spec in specs)
                variants.Add((Variant(x.C, sv, yx, spec), x.C.Name));
            var p2 = variants.AsParallel().AsOrdered().Select(q => Sc(q.v, prm, q.b)).ToList();
            o.Min2 = Minima(p2.Where(x => x.Legal).Select(x => x.R).DefaultIfEmpty(p2[0].R), ns);
            foreach (var x in p2) x.Rel = RelScore(x.R, o.Min2, h);
            o.Phase2 = p2.OrderBy(x => x.Rel).ThenBy(x => x.R.Weighted).ToList();
            log($"=== phase 2: {pool.Count} curves x snap {{{string.Join(",", h.SnapSet)}}} x filter {(famSpec == null ? "{off}" : "{off,on}")} (top 30) ===");
            foreach (var x in o.Phase2.Take(30)) log(Line(x));

            o.Top = o.Phase2.GroupBy(x => x.Base).Select(g => g.Where(x => x.Legal).OrderBy(x => x.Rel).ThenBy(x => x.R.Weighted).FirstOrDefault())
                            .Where(x => x != null).Select(x => x!).OrderBy(x => x.Rel).ToList();
            if (o.Top.Count == 0) o.Top = o.Phase2.GroupBy(x => x.Base).Select(g => g.First()).ToList();
            var perModel = new List<Dictionary<Scored, PsyLab.Result>> { o.Top.ToDictionary(x => x, x => x.R) };
            foreach (var (label, sp) in StressModels)
                perModel.Add(o.Top.AsParallel().Select(x => (x, r: PsyLab.Score(x.C, tab, sp, h.Scens, h.K))).ToList().ToDictionary(q => q.x, q => q.r));
            for (int m = 0; m < perModel.Count; m++)
            {
                var mm = Minima(perModel[m].Values, ns);
                var rels = o.Top.ToDictionary(x => x, x => RelScore(perModel[m][x], mm, h));
                foreach (var x in o.Top) x.Regret = double.IsNaN(x.Regret) ? rels[x] : Math.Max(x.Regret, rels[x]);
                string label = m == 0 ? "base model" : StressModels[m - 1].label;
                log($"  {label}: " + string.Join("  >  ", o.Top.OrderBy(x => rels[x]).Take(4).Select(x => $"{x.C.Name} (rel {rels[x]:0.000})")));
                o.Robust.Add(new { model = label, minima = mm, order = o.Top.OrderBy(x => rels[x]).Select(x => new { x.C.Name, relVsBestVariantsInThisModel = rels[x], perScen = perModel[m][x].PerScen.Select(q => Math.Round(q.HeadRadii, 3)).ToArray() }).ToArray() });
            }
            double minRegret = o.Top.Min(x => x.Regret);
            o.Winner = o.Top.Where(x => x.Regret <= minRegret * (1 + TOL)).OrderBy(x => x.Rq).ThenBy(x => x.R.Weighted).First();
            log("=== each curve's best legal variant, robustness (regret = worst relative score under any of 5 hand models) ===");
            foreach (var x in o.Top.OrderBy(x => x.Regret)) log(Line(x));

            var w = o.Winner;
            if (famSpec != null)
            {
                var wf = new PsyLab.Cand { Name = w.C.Name + " [filter flipped]", Family = w.C.Family, P = w.C.P, Filter = !w.C.Filter, FilterSpec = w.C.Filter ? null : famSpec, FilterGame = w.C.FilterGame };
                o.WinnerFlipped = PsyLab.Score(wf, tab, prm, h.Scens, h.K);
            }
            log($"WINNER {h.Name}: {w.C.Name}  rel {w.Rel:0.000}  regret {w.Regret:0.000}  worst {w.R.Worst:0.000}  reacq {h.ReacqDeg}deg/{h.ReacqMs}ms {w.Rq:0.0}%  180 {w.R.Turn180Mm:0.0}mm  skid {w.R.SkidMm:0.000}  raNoise {w.R.RawAccelNoisePct:0.0}%  " +
                $"cm {w.C.P.cm}  accel {w.C.P.adv.accel}  cap {w.C.P.adv.cap}  offC {w.C.P.adv.offset}  capAt {w.R.CapAtMms:0}  snap {w.C.P.snap}  yx {w.C.P.Yx}  filter {(w.C.Filter ? "ON" : "off")}  sens {w.R.Sens:0.000}");
            log($"  per scenario: " + string.Join(" | ", h.Scens.Zip(w.R.PerScen, (s, q) => $"{s.Name} {q.HeadRadii:0.00} ({q.OnHeadPct:0}% on)")));
            if (o.WinnerFlipped != null)
                log($"  filter flipped ({(!w.C.Filter ? "ON" : "off")}): worst {o.WinnerFlipped.Worst:0.000}  per scenario {string.Join(" / ", o.WinnerFlipped.PerScen.Select(q => q.HeadRadii.ToString("0.00")))}  micro {o.WinnerFlipped.MicroPct:0}%  onset {o.WinnerFlipped.DeadMs:0.0}ms");
            return o;
        }

        /// The character card id each hero ships as.
        public static readonly Dictionary<string, string> CardIds = new()
        {
            ["psylocke"] = "rivpsy", ["loki"] = "rivloki", ["whitefox"] = "rivwfox", ["punisher"] = "rivpun", ["hela"] = "rivhela",
            ["soldier76"] = "owsol", ["emre"] = "owemre", ["illari"] = "owillari", ["freja"] = "owfreja",
        };

        /// Cadence Lock advice rule: the card's RawAccel-engine aim-band gain noise exceeds 2x the GOAT's, or its worst report 3x.
        public static bool NeedsCadence(Preset p, Preset goat)
        {
            var n = CadenceLab.RunAimBand(p, Rig.From(p)); var g = CadenceLab.RunAimBand(goat, Rig.From(goat));
            return n.WallGainNoisePct > 2 * g.WallGainNoisePct || n.WallWorstGainErrPct > 3 * g.WallWorstGainErrPct;
        }

        /// 2026-10-24: the winner as a character card on the GOAT's rig (snap 0, Y/X 1.00, reset 20, no stabilizer), with copy
        /// that quotes only its own recomputed numbers.
        public static Preset CharacterCard(Outcome o, Catalogue cat)
        {
            var h = o.Hero; var w = o.Winner.C.P; var inv = CultureInfo.InvariantCulture;
            var c = new Preset
            {
                id = CardIds[h.Id], name = h.Name, group = h.Game == "rivals" ? "Specific Characters — Marvel Rivals" : "Specific Characters — Overwatch 2",
                tag = "theory", pxmm = Goat.PxMm, cm = w.cm, snap = w.snap, hdlMax = Goat.HdlMax, game = h.Game,
                adv = new Adv { reset = Goat.ResetMs, yx = w.Yx, accel = w.adv.accel, cap = w.adv.cap, offset = w.adv.offset },
            };
            var t = cat.tablet; var rg = Rig.From(c); var lut = Curve.EffectiveLut(c, rg.PxMm); var m = Measure.Run(lut, rg, t);
            double spread = Measure.FlickSpreadPct(lut, rg, t, 90, 120, 150), track = Curve.Summary(lut, t).track, capAt = Curve.CapSpeedMms(c) ?? 0;
            double unity = (c.adv.offset ?? 0) * 1000 / rg.PxMm;
            bool isGoat = c.adv.accel == Goat.Accel && c.adv.cap == Goat.Cap && c.adv.offset == Goat.Offset && Math.Abs(c.cm - Goat.Cm) < 1e-9;
            string F1(double v) => v.ToString("0.0", inv); string F2(double v) => v.ToString("0.00", inv);
            var sb = new StringBuilder();
            sb.Append($"<b>{h.Name.ToUpperInvariant()} — built on {h.Name}&rsquo;s own fights, on THE GOAT&rsquo;s rig (2026-10-24).</b> {h.Archetype}. ");
            sb.Append("<b>The lab fought:</b> " + string.Join(", ", h.Scens.Select(x => x.Name.Substring(x.Name.IndexOf(' ') + 1))) + ". ");
            if (isGoat) sb.Append($"<b>The lab picked the GOAT itself for {h.Name}</b>: nothing it tried beat your field verdict on these fights. ");
            sb.Append(unity > 15 ? $"1:1 up to <b>{unity:0} mm/s</b>, then one ramp to the {F1(c.adv.cap ?? 1)}x cap at {capAt:0} mm/s" : $"1:1 in the micro pocket, then one ramp to the {F1(c.adv.cap ?? 1)}x cap at {capAt:0} mm/s");
            sb.Append($" (tracking {F2(track)}x). Base <b>{F2(c.cm)} cm/360</b>" + (Math.Abs(c.cm - Goat.Cm) < 1e-9 ? " (the GOAT&rsquo;s)" : $" (the GOAT&rsquo;s 52.63 x{c.cm / Goat.Cm:0.00}: the lab may only go faster than your base, and here it did)") + ". ");
            var goatRow = o.Phase1.FirstOrDefault(x => x.C.Name.StartsWith("goat"));
            sb.Append($"<b>Lab (ev-20261024-hero-{h.Id}):</b> {o.Phase1.Count(x => x.C.Family != "reference")} curves, execution error in target radii: ");
            sb.Append(string.Join(" / ", h.Scens.Zip(o.Winner.R.PerScen, (x, q) => $"{x.Name.Split(' ')[0]} {q.HeadRadii:0.00}")));
            sb.Append($"; relative score {o.Winner.Rel:0.00}" + (goatRow != null && !isGoat ? $" against the GOAT&rsquo;s {goatRow.Rel:0.00}" : "") + ", robust across five simulated hands. ");
            sb.Append($"180&deg; in {F1(m.Turn180Mm)} mm; committed flick spread {F1(spread)}%; micro {m.Micro3Pct:0}% and onset {F1(m.DeadMs)} ms (two reports); the {h.ReacqDeg:0}&deg; re-acquire lands within {o.Winner.Rq:0.0}% across three tempos. ");
            if (cat.Find(Goat.Id) is Preset gp && NeedsCadence(c, gp))
                sb.Append($"{BuildState.CadenceAdvice}: on the RawAccel engine this ramp turns report-timing jitter into gain noise (you already run Cadence Lock). ");
            sb.Append($"Angle snap {c.snap:0}&deg; and Y/X {F2(c.adv.yx ?? 1)} like the GOAT, no game filter, no stabilizer, latency tier T0. ");
            sb.Append($"In game: set the {h.Name} hero-specific sensitivity to <b>{{SENS}}</b>.");
            c.desc = sb.ToString();
            return c;
        }

        public static string CharacterTunerEntry(Preset c)
        {
            string J(string x) => x.Replace("\\", "\\\\").Replace("'", "\\'");
            return $"  {{id:'{c.id}', group:'{c.group}', tag:'theory', name:'{J(c.name)}',\n   desc:'{J(c.desc)}',\n" +
                   string.Format(CultureInfo.InvariantCulture, "   device:'wacom', res:0, pxmm:{0}, cm:{1}, slider:0, hdlMax:{2}, snap:{3}, gameFilter:false, adv:{{reset:{4}, yx:{5}, accel:{6}, cap:{7}, offset:{8}}}}},",
                       c.pxmm, c.cm, c.hdlMax, c.snap, c.adv.reset, (c.adv.yx ?? 1).ToString("0.0##", CultureInfo.InvariantCulture), c.adv.accel, c.adv.cap, c.adv.offset);
        }

        public static object Evidence(Outcome o)
        {
            var h = o.Hero; var w = o.Winner;
            object Brief(Scored x, string relKey) => new Dictionary<string, object?>
            {
                ["Name"] = x.C.Name, ["Family"] = x.C.Family, [relKey] = x.Rel, ["Worst"] = x.R.Worst, ["Weighted"] = x.R.Weighted,
                ["reacqPct"] = x.Rq, ["Turn180Mm"] = x.R.Turn180Mm, ["MicroPct"] = x.R.MicroPct, ["DeadMs"] = x.R.DeadMs, ["SkidMm"] = x.R.SkidMm,
                ["PeakAllMms"] = x.R.PerScen.Max(q => q.PeakAllMms), ["RawAccelNoisePct"] = x.R.RawAccelNoisePct, ["Sens"] = x.R.Sens,
                ["Legal"] = x.Legal, ["whyIllegal"] = x.WhyIllegal.Length > 0 ? x.WhyIllegal : null,
                ["regret"] = double.IsNaN(x.Regret) ? (double?)null : x.Regret, ["perScen"] = x.R.PerScen.Select(q => Math.Round(q.HeadRadii, 3)).ToArray()
            };
            return new
            {
                evidenceId = $"ev-20260916-hero-{h.Id}", date = "2026-09-16", supersedes = h.Id == "psylocke" ? "ev-20260914-psylocke-lab, ev-20260914-psylocke-refine" : $"ev-20260915-hero-{h.Id}",
                hero = h.Name, game = h.Game, archetype = h.Archetype, kit = h.Kit, tapFire = h.TapFire,
                method = "HeroLab (renovated 2026-09-16): trained-inverse feedforward + 120 ms visual feedback, signal-dependent motor noise 2-12 Hz + tremor; projectile lead / recoil pull-down / descending aim; target switches as a ballistic minimum-jerk throw (90 ms + 0.45 ms/deg; the re-acquire at the hero's tempo) with +-14% log tempo variability and one corrective submovement, every clock warped by that throw's tempo; shipping curve math at 360 Hz, RawAccel exact angle snap, integer counts with remainder; the family's shipped game filter built from its exported plan; error vs intended path in target radii; relative scoring per engagement within each stage",
                rule = "legal (onset <= 2 reports and micro 90-130% through the variant's own filter; 180 <= 70 mm at 150 ms; no report above 600 mm/s incl. the throw; tap-fire heroes: click skid <= BO6 base + 15%; not a reference) -> pool = 8 best relative score + 4 most consistent within 10% -> snap x the family's game filter (where it ships one), best legal variant per curve -> rescored under 5 hand models -> regret within 5% of the most robust -> most consistent re-acquire, then weighted error",
                yx = o.Yx, yxSource = h.FamilyCard, gameFilterDimension = o.FamilyFilter, skidCapMm = h.TapFire ? o.SkidCapMm : (double?)null,
                humanModel = new PsyLab.Params(), scenarios = h.Scens, reacquire = new { turnDeg = h.ReacqDeg, ms = h.ReacqMs },
                bestLegalPerEngagementPhase1 = o.Min1, bestLegalPerEngagementPhase2 = o.Min2,
                winner = new
                {
                    name = w.C.Name, family = w.C.Family,
                    preset = new { w.C.P.pxmm, w.C.P.cm, w.C.P.snap, w.C.P.adv.accel, w.C.P.adv.cap, w.C.P.adv.offset, yx = w.C.P.Yx, gameFilter = w.C.Filter },
                    sens = w.R.Sens, relVsPhase2Pool = w.Rel, w.R.Worst, w.R.Weighted, w.Regret, reacqPct = w.Rq, reacqTravelMm = w.RqMm, w.R.Turn180Mm, w.R.SpreadPct,
                    w.R.MicroPct, w.R.DeadMs, w.R.SkidMm, w.R.RawAccelNoisePct, w.R.CapAtMms,
                    perScenario = h.Scens.Zip(w.R.PerScen, (s, q) => new { s.Name, targetRadii = q.HeadRadii, onTargetPct = q.OnHeadPct, peakPenMms = q.PeakHandMms, peakAllMms = q.PeakAllMms }).ToArray(),
                    filterFlipped = o.WinnerFlipped == null ? null : new { on = !w.C.Filter, o.WinnerFlipped.Worst, o.WinnerFlipped.MicroPct, o.WinnerFlipped.DeadMs, perScen = o.WinnerFlipped.PerScen.Select(q => q.HeadRadii).ToArray() }
                },
                phase1 = o.Phase1.Select(x => Brief(x, "relVsPhase1Legal")).ToArray(),
                phase2Top40 = o.Phase2.Take(40).Select(x => Brief(x, "relVsPhase2Pool")).ToArray(),
                bestVariantPerCurve = o.Top.Select(x => Brief(x, "relVsPhase2Pool")).ToArray(),
                robustness = o.Robust,
                limits = "Execution error only: reaction time, prediction and netcode are identical for every curve and excluded. Parameterised human model with no cost for longer hand or vertical motions (hence the 37.7 cm/360 ceiling, the 70 mm 180 rule and the family Y/X); the pick is the most robust across five variants, but the field verdict decides. The Coherence Stabilizer is not simulated.",
                fieldVerdict = "pending"
            };
        }
    }
}
