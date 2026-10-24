using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using AimForge.Filters;

namespace AimForge.Core
{
    /// <summary>
    /// GAME LAB (2026-10-23): the per-game families re-derived the way the character cards were - by HeroLab's selection on
    /// fights - instead of one BO6-shaped ladder (Baseline / Planted / Turbo / Tapped) copied into every game with only the
    /// sens changed. Each game gets the SAME role ladder, so the families stay consistent, but every role is tuned on that
    /// game's own fights, so no two games end up alike:
    ///   Master    - the game's whole fight mix
    ///   Precision - headshot / one-tap / long-range fights weighted 3x, base at the SLOW quartile of the pro range
    ///   Tracker   - held strafe-tracking fights weighted 3x, 1:1 through the tracking band
    ///   Flick     - target switches and the big re-acquire weighted 3x, early-saturating ramp, a short 180
    ///   Brawl     - close-range fights at high relative speed weighted 3x, base at the FAST quartile of the pro range
    ///   Signature - the one job only this game asks for
    /// The Baseline (BO6 verbatim at the game's sens) and the BO6 / Breakpoint cards are untouched.
    ///
    /// Base speeds come from pro play (prosettings.net / senslab.pro medians and quartiles, 2026-10 snapshots seen through
    /// search snippets - ev-20261023-game-families lists them). The lab's human model has no cost for a longer hand motion,
    /// so cm/360 is NOT searched: each role sits at a fixed point of the pro range and the lab picks the ramp (where 1:1
    /// ends, the cap, where it saturates), the angle snap and the game filter. Latency first, by construction: every
    /// candidate is floor 1.00 classic (no smoothing, no prediction), legality demands onset <= two reports and micro
    /// 90-130% through the card's own filter, and the only stabilizer element a card can carry is the pressure-gated Tap
    /// Anchor (exact passthrough off the click) on tap-fire roles.
    ///
    /// 2026-10-24 - THE GOAT is the baseline (Goat.cs, field verdict). Every role now sits at a fixed ratio of the GOAT's
    /// 52.63 cm/360 (Master / Tracker / Flick at it, Precision x1.15, Brawl x0.87, the Signature at its old ratio to the base;
    /// the Finals Fieldwide keeps the sens-8 verdict), every card runs angle snap 0 and Y/X 1.00 (the verdict: snap and Y/X
    /// made aim inconsistent), reset 20 ms and no stabilizer (the GOAT runs none; the Tap Anchor stays one switch away in
    /// Filters). The Master searches the GOAT's own neighbourhood and the GOAT curve itself is a candidate; the 180 limits
    /// scale from the GOAT's own measured 180. The pro ranges stay on record in each card's text.
    /// </summary>
    public static class GameLab
    {
        public enum Tag { Prec, Track, Flick, Brawl, Sig }

        public sealed class G
        {
            public string Id = "", Group = "", Prefix = "", Name = "", FamilyCard = "";
            public double K, Yx = 0.789, CmBase, CmSlow, CmFast, ProLo, ProHi, ProMed;
            public string ProSource = "";
            public GameFilterCore.Game FilterGame = GameFilterCore.Game.Cod;
            public double PinHoldMs = 25, PinBreakMm = 0.45, ReacqDeg = 120, ReacqMs = 190;
            public bool TapFireGame;
            public (PsyLab.Scen s, Tag t)[] Fights = Array.Empty<(PsyLab.Scen, Tag)>();
            public string SigName = "", SigJob = "";
            public double SigCm; public double SigMax180 = 70;
            public string Character = "";   // one line on what the game rewards (from the research)
            public string Setup = "";       // what to check in the game itself (recommended, never edited)
        }

        static PsyLab.Scen S(string n, double d, double lat, double rev, double w, double proj = 0, double vamp = 0, double vhz = 0,
                             double recoil = 0, double step = 0, double stepS = 0, double r = 0)
            => new PsyLab.Scen { Name = n, D = d, Lat = lat, Rev = rev, W = w, Proj = proj, VAmp = vamp, VHz = vhz, RecoilDegS = recoil,
                                 StepDeg = step, StepS = stepS, SettleOnly = stepS > 0, TargetR = r };

        // ---- the games: fights from the research (ev-20261023-game-families), speeds from the pro ranges ----
        public static readonly G[] Games =
        {
            new G { Id = "valorant", Group = "Valorant", Prefix = "val", Name = "Valorant", FamilyCard = "valmp", K = 13062.86, FilterGame = GameFilterCore.Game.Val,
                ProMed = 54, ProLo = 47, ProHi = 71, CmBase = 54, CmSlow = 62, CmFast = 47, ProSource = "prosettings (701 pros, median eDPI 240) / senslab (605 pros, median 58.3 cm)",
                PinHoldMs = 45, PinBreakMm = 0.6, ReacqDeg = 90, ReacqMs = 180, TapFireGame = true,
                Character = "one-tap headshots after a counter-strafe stop, crosshair placement, very short time-to-kill",
                Setup = "Vanguard: VMulti Relative Mode, touch the pen before the mouse after launch; if taps vanish while you strafe, add a keyboard Fire bind (OTD FAQ). Scoped sensitivity 1.0.",
                SigName = "Operator", SigJob = "holding a long angle with the Operator and snapping 20-30 degrees onto the peeker", SigCm = 62, SigMax180 = 110,
                Fights = new[] {
                    (S("V1 hold an angle, peeker at 20m", 20, 5.4, 0.6, 0.30), Tag.Prec),
                    (S("V2 counter-strafe duel 15m", 15, 3, 0.35, 0.25), Tag.Track),
                    (S("V3 off-angle flick 45deg 12m", 12, 3, 0.6, 0.20, step: 45, stepS: 0.8), Tag.Flick),
                    (S("V4 close spray 6m + recoil", 6, 5.4, 0.4, 0.15, recoil: 2.0), Tag.Brawl),
                    (S("V5 Operator peek 40m, 25deg snap", 40, 5.4, 0.8, 0.10, step: 25, stepS: 1.0, r: 0.3), Tag.Sig) } },
            new G { Id = "apex", Group = "Apex Legends", Prefix = "apx", Name = "Apex Legends", FamilyCard = "apxmp", K = 41563.6, FilterGame = GameFilterCore.Game.Apex,
                ProMed = 40, ProLo = 35, ProHi = 43, CmBase = 40, CmSlow = 43, CmFast = 35, ProSource = "senslab (median eDPI 1040 = 40 cm) / prosettings player pages (26-52 cm)",
                PinHoldMs = 25, PinBreakMm = 0.45, ReacqDeg = 120, ReacqMs = 200,
                Character = "long strafe-tracking duels against ADAD, slides and bunny-hops, learnable upward recoil pulled down",
                Setup = "Heads-up: RawAccel issue #304 (open since 2025-10) reports Apex's EAC disabling RawAccel in game - if the curve vanishes in Apex, tick Cadence Lock (the curve then runs in OTD, RawAccel flat). FOV 110, ADS 1.0.",
                SigName = "Longbow", SigJob = "marksman and sniper pokes at 60 m on a strafing target", SigCm = 43, SigMax180 = 90,
                Fights = new[] {
                    (S("A1 close strafe duel 8m + recoil", 8, 7, 0.35, 0.30, recoil: 1.5, r: 0.3), Tag.Brawl),
                    (S("A2 mid-range beam 25m + recoil", 25, 5, 0.6, 0.25, recoil: 1.5, r: 0.3), Tag.Track),
                    (S("A3 slide/jump target 10m", 10, 9, 0.5, 0.20, vamp: 1.0, vhz: 1.0, r: 0.3), Tag.Track),
                    (S("A4 third-party switch 40deg 15m", 15, 4, 0.6, 0.15, step: 40, stepS: 0.8, r: 0.3), Tag.Flick),
                    (S("A5 marksman poke 60m", 60, 5, 0.7, 0.10, r: 0.15), Tag.Sig) } },
            new G { Id = "ow2", Group = "Overwatch 2", Prefix = "ow", Name = "Overwatch 2", FamilyCard = "owmp", K = 138545.5, FilterGame = GameFilterCore.Game.Ow2,
                ProMed = 35, ProLo = 27, ProHi = 41, CmBase = 35, CmSlow = 41, CmFast = 27, ProSource = "senslab (236 pros, median eDPI 4000 = 34.6 cm, 27-41)",
                PinHoldMs = 30, PinBreakMm = 0.5, ReacqDeg = 120, ReacqMs = 180,
                Character = "hitscan tracking of hectic movement and fliers, one-shot flicks for snipers, projectile leading",
                Setup = "FOV 103; zoom sensitivity 38 (the pro habit) or 50 (screen-matched).",
                SigName = "Projectile", SigJob = "leading 35-100 m/s projectiles onto strafers and fliers", SigCm = 35,
                Fights = new[] {
                    (S("O1 hitscan strafe track 15m", 15, 5.5, 0.45, 0.30), Tag.Track),
                    (S("O2 flier 25m", 25, 8, 1.2, 0.20, vamp: 2.0, vhz: 0.5), Tag.Track),
                    (S("O3 sniper head switch 20deg 30m", 30, 3, 0.6, 0.15, step: 20, stepS: 0.7), Tag.Prec),
                    (S("O4 dive brawl 5m", 5, 8, 0.35, 0.20, r: 0.3), Tag.Brawl),
                    (S("O5 projectile lead 15m", 15, 5.5, 0.5, 0.15, proj: 50, r: 0.3), Tag.Sig) } },
            new G { Id = "rivals", Group = "Marvel Rivals", Prefix = "riv", Name = "Marvel Rivals", FamilyCard = "rivmp", K = 52251, FilterGame = GameFilterCore.Game.Rivals, Yx = 0.85,
                ProMed = 38, ProLo = 33, ProHi = 47, CmBase = 38, CmSlow = 45, CmFast = 33, ProSource = "senslab (129 pros, median eDPI 1360 = 38.4 cm, 33-47)",
                PinHoldMs = 25, PinBreakMm = 0.45, ReacqDeg = 135, ReacqMs = 160,
                Character = "hitscan and projectile mix, fliers that need smooth vertical tracking, dive brawls and teleport re-acquires",
                Setup = "Make sure the game's own mouse acceleration and smoothing toggles are OFF (launch builds had them baked in). Third-person match (Modes) applies.",
                SigName = "Skyward", SigJob = "tracking fliers (Iron Man, Storm, Star-Lord) with vertical drift at 15-25 m", SigCm = 38,
                Fights = new[] {
                    (S("R1 strafe track 10m", 10, 6, 0.45, 0.30), Tag.Track),
                    (S("R2 dive brawl 4m", 4, 9, 0.35, 0.25, r: 0.3), Tag.Brawl),
                    (S("R3 projectile poke 12m", 12, 6, 0.5, 0.15, proj: 100, r: 0.3), Tag.Prec),
                    (S("R4 head poke 25m", 25, 6, 0.6, 0.15), Tag.Prec),
                    (S("R5 flier 18m", 18, 12, 1.2, 0.15, vamp: 2.0, vhz: 0.6), Tag.Sig) } },
            new G { Id = "finals", Group = "The Finals", Prefix = "fin", Name = "The Finals", FamilyCard = "finmp", K = 914400, FilterGame = GameFilterCore.Game.Finals,
                ProMed = 36, ProLo = 32, ProHi = 39, CmBase = 36, CmSlow = 39, CmFast = 32, ProSource = "senslab (31 pros, median eDPI 25600 = 35.7 cm, 32-39; small sample)",
                PinHoldMs = 35, PinBreakMm = 0.6, ReacqDeg = 120, ReacqMs = 190,
                Character = "tracking at every range through destruction, Light dashes and grapples, class HP from 150 to 350",
                Setup = "Turn the game's own mouse smoothing off (bEnableMouseSmoothing=False in its config, game closed) - AimForge recommends it, never edits it.",
                SigName = "Fieldwide", SigJob = "your own field-rated 78.95 cm/360 (sens 8, rated good on 2026-09-10) with a lab-tuned ramp", SigCm = 78.95, SigMax180 = 154,
                Fights = new[] {
                    (S("F1 CQB vs a dashing Light 6m", 6, 8, 0.35, 0.25, r: 0.3), Tag.Brawl),
                    (S("F2 mid-range track 20m", 20, 6, 0.5, 0.30, r: 0.3), Tag.Track),
                    (S("F3 long head poke 45m", 45, 5, 0.7, 0.15), Tag.Prec),
                    (S("F4 grapple/jump re-target 10m", 10, 7, 0.6, 0.15, vamp: 1.5, vhz: 0.8, r: 0.3), Tag.Flick),
                    (S("F5 room clear switch 60deg 8m", 8, 5, 0.6, 0.15, step: 60, stepS: 0.9, r: 0.3), Tag.Sig) } },
            new G { Id = "deadlock", Group = "Deadlock", Prefix = "dl", Name = "Deadlock", FamilyCard = "dlmp", K = 41563.6, Yx = 0.85,
                ProMed = 38, ProLo = 32, ProHi = 50, CmBase = 38, CmSlow = 45, CmFast = 32, ProSource = "senslab (35 pros, median eDPI 544 = 38.2 cm at yaw 0.044, 32-50; esportsmice disagrees)",
                PinHoldMs = 25, PinBreakMm = 0.45, ReacqDeg = 150, ReacqMs = 200,
                Character = "third-person tracking with travelling bullets you lead, long time-to-kill, dashes, slides and ziplines",
                Setup = "The in-game number is UNVERIFIED: AimForge assumes the Source yaw 0.022, one stats site says Deadlock uses 0.044 (the number would halve) - run the 360 calibration (Builds) once. Third-person match (Modes) applies.",
                SigName = "Zipline", SigJob = "leading a target riding a zipline or dash-jumping at 20-25 m", SigCm = 38,
                Fights = new[] {
                    (S("D1 mid lane track 15m (lead)", 15, 7, 0.5, 0.30, proj: 400, r: 0.3), Tag.Track),
                    (S("D2 dash/slide brawl 7m", 7, 10, 0.4, 0.25, proj: 400, r: 0.3), Tag.Brawl),
                    (S("D3 head poke 25m (lead)", 25, 5, 0.6, 0.20, proj: 400), Tag.Prec),
                    (S("D4 zipline target 22m", 22, 9, 1.0, 0.10, proj: 400, vamp: 1.0, vhz: 0.5, r: 0.3), Tag.Sig),
                    (S("D5 switch 45deg 10m", 10, 5, 0.6, 0.15, step: 45, stepS: 0.8, r: 0.3), Tag.Flick) } },
            new G { Id = "hd2", Group = "Helldivers 2", Prefix = "hd", Name = "Helldivers 2", FamilyCard = "hdmp", K = 1595.8,
                ProMed = 37.7, ProLo = 33, ProHi = 42, CmBase = 37.7, CmSlow = 42, CmFast = 33, ProSource = "no pro scene - your field-tested 37.7 base, +-12% for the role spread",
                PinHoldMs = 35, PinBreakMm = 0.6, ReacqDeg = 150, ReacqMs = 260,
                Character = "deliberate PvE weak-point shots on slower targets, hordes from every side, heavy weapons with drag and recoil",
                Setup = "The game's own mouse smoothing adds input lag: keep it off. The sens constant is estimated - run the 360 calibration once.",
                SigName = "Heavy", SigJob = "swinging a heavy weapon (recoil, slow traverse) across big targets", SigCm = 37.7,
                Fights = new[] {
                    (S("H1 weak-point shot 25m", 25, 2, 1.0, 0.25, r: 0.25), Tag.Prec),
                    (S("H2 horde sweep 10m", 10, 4, 1.0, 0.25, r: 0.4), Tag.Track),
                    (S("H3 hunter pounce 5m", 5, 7, 0.4, 0.20, r: 0.4), Tag.Brawl),
                    (S("H4 target switch 50deg 15m", 15, 3, 0.8, 0.15, step: 50, stepS: 1.0, r: 0.4), Tag.Flick),
                    (S("H5 heavy weapon on a charger 15m", 15, 3, 0.8, 0.15, recoil: 4.0, r: 0.6), Tag.Sig) } },
            new G { Id = "holdfast", Group = "Holdfast: NAW", Prefix = "hf", Name = "Holdfast", FamilyCard = "hfmp", K = 5715.2, FilterGame = GameFilterCore.Game.Holdfast,
                ProMed = 40, ProLo = 34, ProHi = 46, CmBase = 40, CmSlow = 46, CmFast = 34, ProSource = "no pro data - a 40 cm base for single slow shots, +-15% for the role spread",
                PinHoldMs = 60, PinBreakMm = 0.6, ReacqDeg = 120, ReacqMs = 250, TapFireGame = true,
                Character = "one slow, still musket shot per 12 s reload, heavy drop and random sideways spread, directional melee strokes",
                Setup = "Melee direction comes from the stroke you make as you click - make it big and clear; the Tap Anchor still pins the click itself.",
                SigName = "Sabre", SigJob = "melee: big directional strokes and blocks at 2 m, where the camera must not swing past the opponent", SigCm = 46, SigMax180 = 110,
                Fights = new[] {
                    (S("M1 musket shot at a walking line 50m", 50, 1.5, 1.5, 0.35, r: 0.3), Tag.Prec),
                    (S("M2 skirmisher 20m", 20, 4, 0.6, 0.20, r: 0.3), Tag.Track),
                    (S("M3 flank switch 40deg 25m", 25, 2, 0.8, 0.15, step: 40, stepS: 1.0, r: 0.3), Tag.Flick),
                    (S("M4 close skirmish 6m", 6, 5, 0.4, 0.15, r: 0.4), Tag.Brawl),
                    (S("M5 melee duel 2m", 2, 6, 0.4, 0.15, r: 0.8), Tag.Sig) } },
        };

        public static readonly string[] Roles = { "Master", "Precision", "Tracker", "Flick", "Brawl", "Signature" };
        static readonly Dictionary<string, string> Slot = new() { ["Master"] = "mp", ["Precision"] = "pl", ["Tracker"] = "lla", ["Flick"] = "tb", ["Brawl"] = "llb", ["Signature"] = "llc" };

        static double Mult(string role, Tag t) => role switch
        {
            "Precision" => t switch { Tag.Prec => 3, Tag.Brawl => 0.3, _ => 1 },
            "Tracker" => t switch { Tag.Track => 3, Tag.Prec => 0.5, Tag.Flick => 0.5, _ => 1 },
            "Flick" => t switch { Tag.Flick => 3, Tag.Track => 0.5, Tag.Brawl => 0.5, _ => 1 },
            "Brawl" => t switch { Tag.Brawl => 3, Tag.Prec => 0.3, _ => 1 },
            "Signature" => t == Tag.Sig ? 4 : 0.5,
            _ => 1,
        };

        /// Role base speed as a ratio of the GOAT's (2026-10-24). The Finals Signature keeps the sens-8 field verdict (78.95).
        public static double CmOf(G g, string role) => role switch
        {
            "Precision" => Math.Round(Goat.Cm * 1.15, 2), "Brawl" => Math.Round(Goat.Cm * 0.87, 2),
            "Signature" => g.Id == "finals" ? g.SigCm : Math.Round(Goat.Cm * g.SigCm / g.CmBase, 2),
            _ => Goat.Cm,
        };

        /// Roles whose fire is a click per shot: the Filters tab offers the game's Tap Anchor there. Since 2026-10-24 no card
        /// ships it ON - the GOAT, the field verdict, runs without it.
        public static bool TapFire(G g, string role) => role == "Precision" || (g.TapFireGame && role != "Tracker" && role != "Brawl");

        /// The one role whose card is the GOAT itself, not a lab pick: The Finals Master (the verdict was given there).
        public static bool IsGoatHome(G g, string role) => g.Id == "finals" && role == "Master";

        /// The GOAT's own measured 180 (mm at 150 ms) - every role's 180 limit is a ratio of it.
        public static double Goat180(Tablet t)
        {
            var p = GoatPreset(); var rg = Rig.From(p);
            return Measure.Run(Curve.EffectiveLut(p, rg.PxMm), rg, t).Turn180Mm;
        }

        public static Preset GoatPreset() => new Preset
        {
            id = Goat.Id, name = "The GOAT", group = "The GOAT", pxmm = Goat.PxMm, cm = Goat.Cm, snap = Goat.Snap, hdlMax = Goat.HdlMax, game = "finals",
            adv = new Adv { reset = Goat.ResetMs, yx = Goat.Yx, accel = Goat.Accel, cap = Goat.Cap, offset = Goat.Offset },
        };

        /// The role as a HeroLab hero: the game's fights re-weighted for the role, the role's own re-acquire, 180 limit and
        /// candidate identity.
        public static HeroLab.Hero RoleHero(G g, string role)
        {
            var sc = g.Fights.Select(f => new PsyLab.Scen
            {
                Name = f.s.Name, D = f.s.D, Lat = f.s.Lat, Rev = f.s.Rev, VAmp = f.s.VAmp, VHz = f.s.VHz, Dur = f.s.Dur, W = f.s.W * Mult(role, f.t),
                Proj = f.s.Proj, RecoilDegS = f.s.RecoilDegS, H = f.s.H, Fall = f.s.Fall, StepDeg = f.s.StepDeg, StepS = f.s.StepS, TargetR = f.s.TargetR,
                FlickMs = f.s.FlickMs, SettleOnly = f.s.SettleOnly
            }).ToArray();
            double tot = sc.Sum(x => x.W); foreach (var x in sc) x.W /= tot;
            double rqMs = role == "Flick" ? g.ReacqMs * 0.85 : role == "Precision" ? g.ReacqMs * 1.15 : g.ReacqMs;
            var h = new HeroLab.Hero
            {
                Id = g.Prefix + Slot[role], Name = $"{g.Name} {role}", Game = g.Id, K = g.K, FilterGame = g.FilterGame,
                // the click-skid gate (BO6 base + 15%, measured WITHOUT the stabilizer) is not applied: every tap-fire role ships the
                // Tap Anchor, which holds the click position exactly (measured bit-exact) - the pin is the answer to click skid
                Archetype = role, Kit = g.Character, TapFire = false, ReacqDeg = g.ReacqDeg, ReacqMs = rqMs, Scens = sc,
                FamilyCardOverride = g.FamilyCard, YxDefault = Goat.Yx, YxOverride = Goat.Yx, SnapSet = new[] { Goat.Snap },
                Max180Mm = Max180(g, role, Goat180Cache ??= Goat180(new Tablet())),
            };
            h.CandidateSet = (hh, cat, yx) => Candidates(g, role, yx);
            // the re-acquire every role fights (HeroLab.WithReacquire's rule: 15% weight, the rest scaled to 85%)
            foreach (var s in h.Scens) s.W *= 0.85;
            var f0 = h.Scens[0];
            var rs = new PsyLab.Scen { Name = $"R re-acquire {h.ReacqDeg:0}deg/{h.ReacqMs:0}ms 8m", D = 8, Lat = 6, Rev = 0.5, W = 0.15, Proj = f0.Proj, StepDeg = h.ReacqDeg, StepS = 1.2, SettleOnly = true, TargetR = f0.TargetR, FlickMs = h.ReacqMs };
            h.Scens = h.Scens.Append(rs).ToArray();
            return h;
        }

        static double? Goat180Cache;
        public static (double, double?, double?, double?) Key(Preset p) => (p.cm, p.adv.accel, p.adv.cap, p.adv.offset);
        /// The role's 180 limit, scaled from the GOAT's own 180 (the old fixed limits were set for a 35-40 cm world).
        public static double Max180(G g, string role, double goat180) => Math.Round(role switch
        {
            "Precision" => goat180 * 1.6, "Flick" => goat180 * 0.85,
            "Signature" => goat180 * 1.15 * g.SigMax180 / 70.0,
            _ => goat180 * 1.15,
        }, 1);

        /// The role's identity: which curve shapes it may pick from (all floor 1.00 classic, no smoothing).
        public static List<PsyLab.Cand> Candidates(G g, string role, double yx)
        {
            double cm = CmOf(g, role); var o = new List<PsyLab.Cand>();
            bool goatHome = IsGoatHome(g, role);
            void TL(double off, double G, double span) => o.Add(new PsyLab.Cand { Name = $"tl-sat cm{cm} off{off} G{G} @{off + span}", Family = "trackline-sat", P = PsyLab.TracklineSat(cm, off, G, off + span, yx, Goat.Snap), FilterGame = g.FilterGame });
            void ES(double G, double sat) => o.Add(new PsyLab.Cand { Name = $"early-sat cm{cm} G{G} @{sat}", Family = "early-sat", P = PsyLab.EarlySat(cm, G, sat, 0.5, yx, Goat.Snap), FilterGame = g.FilterGame });
            // the GOAT's neighbourhood: 1:1 to 30-60 mm/s (fingertip and wrist), one ramp to a 2.5-4x cap by 150-230 mm/s (the arm)
            void Near() { foreach (var off in new[] { 30.0, 40.0, 50.0, 60.0 }) foreach (var G in new[] { 2.5, 3.0, 3.5, 4.0 }) foreach (var at in new[] { 150.0, 190.0, 230.0 }) TL(off, G, at - off); }
            // the cap must at least bring a 180 inside the role's limit at this base (ceil to 0.1)
            switch (role)
            {
                case "Precision":
                    // a wide 1:1 pocket is the identity; the cap may still be high where the game's big turn needs it (Rivals' 135 deg at a slow base)
                    foreach (var off in new[] { 40.0, 70.0, 100.0, 140.0 }) foreach (var G in new[] { 2.0, 2.5, 3.0, 3.5, 4.0, 5.0 }) foreach (var span in new[] { 60.0, 110.0, 200.0, 300.0 }) TL(off, G, span);
                    break;
                case "Tracker":
                    foreach (var off in new[] { 110.0, 140.0, 170.0, 200.0, 240.0 }) foreach (var G in new[] { 2.5, 3.0, 4.0, 5.0 }) foreach (var span in new[] { 60.0, 110.0, 200.0 }) TL(off, G, span);
                    break;
                case "Flick":
                    foreach (var G in new[] { 4.0, 5.0, 6.0, 7.0 }) foreach (var sat in new[] { 70.0, 90.0, 120.0, 160.0 }) ES(G, sat);
                    break;
                case "Brawl":
                    foreach (var G in new[] { 2.5, 3.0, 3.5, 4.0 }) foreach (var sat in new[] { 110.0, 150.0, 200.0, 260.0 }) ES(G, sat);
                    foreach (var off in new[] { 40.0, 70.0 }) foreach (var G in new[] { 3.0, 4.0 }) TL(off, G, 150);
                    break;
                case "Master":
                    // The Finals Master IS the GOAT: the field verdict was given in this game and outranks the lab
                    if (goatHome) { TL(Goat.UnityMms, Goat.Cap, Goat.CapAtMms - Goat.UnityMms); break; }
                    Near();
                    break;
                default:   // Signature: the whole space and the GOAT's neighbourhood
                    Near();
                    foreach (var off in new[] { 40.0, 80.0, 120.0, 160.0, 200.0 }) foreach (var G in new[] { 2.5, 3.0, 4.0, 5.0 }) foreach (var span in new[] { 60.0, 110.0, 200.0 }) TL(off, G, span);
                    foreach (var G in new[] { 3.0, 4.0, 5.0, 6.0 }) foreach (var sat in new[] { 80.0, 110.0, 150.0, 200.0 }) ES(G, sat);
                    if (cm > 60) foreach (var G in new[] { 7.0, 8.0, 9.0 }) foreach (var sat in new[] { 150.0, 250.0 }) ES(G, sat);
                    break;
            }
            return o;
        }

        public sealed class Pick { public G Game = null!; public string Role = ""; public HeroLab.Outcome O = null!; public Preset Card = null!; }

        /// taken: builds earlier roles of this game already ship (cm, accel, cap, offset) - a role may not repeat one, so no
        /// two cards in a game are the same.
        public static Pick Run(G g, string role, Catalogue cat, Action<string> log, ICollection<(double, double?, double?, double?)>? taken = null)
        {
            Goat180Cache ??= Goat180(cat.tablet);
            var h = RoleHero(g, role);
            if (taken != null && taken.Count > 0)
            {
                var inner = h.CandidateSet!;
                h.CandidateSet = (hh, c, yx) => inner(hh, c, yx).Where(x => !taken.Contains(Key(x.P))).ToList();
            }
            var o = HeroLab.Run(h, cat, log);
            return new Pick { Game = g, Role = role, O = o, Card = CardOf(g, role, o, cat) };
        }

        static string RoleTag(G g, string role) => role switch
        {
            "Master" => $"the whole {g.Name} fight mix in one card",
            "Precision" => "the headshot and one-tap card",
            "Tracker" => "1:1 while you track, power only past it",
            "Flick" => "switches and turns land on a flat cap",
            "Brawl" => "close range at full speed",
            _ => g.SigJob,
        };

        static string CardName(G g, string role) => role switch { "Master" => "Master Preset", "Signature" => g.SigName, _ => role };

        /// The winner as a roster card: classic curve, the role's base, the lab's snap and filter, the Tap Anchor on tap-fire
        /// roles, and copy that quotes only the card's own recomputed numbers (the copy contract checks every one).
        public static Preset CardOf(G g, string role, HeroLab.Outcome o, Catalogue cat)
        {
            var w = o.Winner.C.P;
            var card = new Preset
            {
                id = g.Prefix + Slot[role], group = g.Group, name = CardName(g, role), tag = "theory", pxmm = Goat.PxMm, cm = w.cm, snap = w.snap, hdlMax = Goat.HdlMax,
                adv = new Adv { reset = Goat.ResetMs, yx = Goat.Yx, accel = w.adv.accel, cap = w.adv.cap, offset = w.adv.offset }, game = g.Id,
            };
            card.gameFilterOn = o.Winner.C.Filter;
            card.desc = Copy(g, role, card, o, cat);
            return card;
        }

        static string F1(double v) => v.ToString("0.0", CultureInfo.InvariantCulture);
        static string F2(double v) => v.ToString("0.00", CultureInfo.InvariantCulture);

        static string Copy(G g, string role, Preset c, HeroLab.Outcome o, Catalogue cat)
        {
            var t = cat.tablet; var rg = Rig.From(c); var lut = Curve.EffectiveLut(c, rg.PxMm);
            var m = Measure.Run(lut, rg, t);
            double spread = Measure.FlickSpreadPct(lut, rg, t, 90, 120, 150), track = Curve.Summary(lut, t).track, capAt = Curve.CapSpeedMms(c) ?? 0;
            double unity = (c.adv.offset ?? 0) * 1000 / rg.PxMm;
            var w = o.Winner;
            string rel = role == "Precision" ? "the GOAT's 52.63 x1.15, slower for placed shots" : role == "Brawl" ? "the GOAT's 52.63 x0.87, faster for close fights"
                       : role == "Signature" && g.Id == "finals" ? "your sens-8 field verdict, 1.5x the GOAT's base"
                       : Math.Abs(c.cm - Goat.Cm) < 1e-9 ? "the GOAT's own base" : $"the GOAT's 52.63 x{c.cm / Goat.Cm:0.00}";
            bool isGoat = c.adv.accel == Goat.Accel && c.adv.cap == Goat.Cap && c.adv.offset == Goat.Offset && Math.Abs(c.cm - Goat.Cm) < 1e-9;
            var sb = new StringBuilder();
            sb.Append($"<b>{g.Name.ToUpperInvariant()} {CardName(g, role).ToUpperInvariant()} — {RoleTag(g, role)}.</b> ");
            sb.Append($"{g.Name} rewards {g.Character}. ");
            sb.Append($"Base <b>{F2(c.cm)} cm/360</b> — {rel} (pros in {g.Name} play {F1(g.ProLo)}–{F1(g.ProHi)} cm, median {F1(g.ProMed)}; {g.ProSource}; your arm-aim base is a field verdict and outranks them). ");
            if (IsGoatHome(g, role)) sb.Append("<b>This IS the GOAT</b> — your field verdict was given in The Finals, and a verdict outranks the lab: same curve, same rig, same sens. ");
            else if (isGoat) sb.Append("<b>The lab picked the GOAT's own curve for this role.</b> ");
            sb.Append(unity > 15 ? $"1:1 up to <b>{unity:0} mm/s</b>, then one ramp to the {F1(c.adv.cap ?? 1)}x cap at {capAt:0} mm/s" : $"1:1 in the micro pocket, then one ramp to the {F1(c.adv.cap ?? 1)}x cap at {capAt:0} mm/s");
            sb.Append($" (tracking {F2(track)}x). 180° in {F1(m.Turn180Mm)} mm; committed flick spread {F1(spread)}%; micro {m.Micro3Pct:0}% and onset {F1(m.DeadMs)} ms (two reports). ");
            sb.Append(IsGoatHome(g, role) ? $"<b>Scored by the game lab</b> on {g.Name}'s own fights: "
                      : $"<b>Chosen by the game lab</b> from {o.Phase1.Count(x => x.C.Family != "reference")} curves on {g.Name}'s own fights, weighted for this role: ");
            sb.Append(string.Join(" / ", o.Hero.Scens.Zip(w.R.PerScen, (s, q) => $"{s.Name.Split(' ')[0]} {q.HeadRadii:0.00}")));
            sb.Append($" target radii (relative {w.Rel:0.00}, robust across five hand models). ");
            sb.Append($"Angle snap {c.snap:0}° and Y/X {F2(c.adv.yx ?? 1)} like the GOAT (snap and Y/X made aim inconsistent), reset {c.adv.reset:0} ms, ");
            sb.Append(o.FamilyFilter == null ? "no game filter" : c.gameFilterOn ? "the game's Master filter ON (the lab scored it better)" : "the game's Master filter OFF (the lab scored it no better)");
            sb.Append(c.cohOv != null ? $", Tap Anchor {c.cohOv.tapHold:0} ms / {F2(c.cohOv.tapBreak)} mm (exact passthrough off the click)"
                      : TapFire(g, role) ? $", no stabilizer (like the GOAT; this is a single-shot role, so the Tap Anchor {g.PinHoldMs:0} ms / {F2(g.PinBreakMm)} mm is one switch away in Filters)" : ", no stabilizer at all");
            sb.Append($", latency tier {RolePolicy.PlanTier(c)}. In game: sensitivity <b>{{SENS}}</b>. {g.Setup}");
            return sb.ToString();
        }

        /// The GOAT card's copy, every number recomputed from the card (the copy contract checks them).
        public static string GoatCopy(Tablet t)
        {
            var c = GoatPreset(); var rg = Rig.From(c); var lut = Curve.EffectiveLut(c, rg.PxMm);
            var m = Measure.Run(lut, rg, t);
            double spread = Measure.FlickSpreadPct(lut, rg, t, 90, 120, 150), track = Curve.Summary(lut, t).track, capAt = Curve.CapSpeedMms(c) ?? 0;
            var sb = new StringBuilder();
            sb.Append("<b>THE GOAT — field verdict 2026-10-24: &ldquo;hands down one of the best feelings I&rsquo;ve had on tablet.&rdquo;</b> ");
            sb.Append("In your words it feels most like a mouse: arm and hand for the big moves, fingertip and wrist pivot on the micro adjustments, and it adapts to changes. ");
            sb.Append("<b>Every card except BO6 Original is now built on this one.</b> ");
            sb.Append($"The build exactly as you played it: the Apex Legends Brawl curve of 2026-10-23 (classic accel {Goat.Accel} / offset {Goat.Offset} / cap {F1(Goat.Cap)}), ");
            sb.Append($"1:1 up to <b>{Goat.UnityMms:0} mm/s</b> (the fingertip and wrist band), then one ramp to the {F1(Goat.Cap)}x cap at {capAt:0} mm/s (the arm; tracking {F2(track)}x). ");
            sb.Append($"57 px/mm, <b>{F2(Goat.Cm)} cm/360</b> = The Finals sensitivity <b>{{SENS}}</b> (you remember 12; if the game reads something else, say so and the whole roster moves with it), ");
            sb.Append($"<b>angle snap 0&deg; and Y/X 1.00</b> (snap and the Y/X ratio made aim inconsistent), reset {Goat.ResetMs:0} ms, hover max {Goat.HdlMax:0}, no stabilizer, no game filter. ");
            sb.Append($"Measured: 180&deg; in {F1(m.Turn180Mm)} mm; committed flick spread {F1(spread)}%; micro {m.Micro3Pct:0}% and onset {F1(m.DeadMs)} ms (two reports). ");
            sb.Append("Engine as you ran it: Cadence Lock (pen rate 360, merge cap 5), with Nib Twin, Intent Speed and Reversal Carry off. ");
            sb.Append($"The in-game number for every other game is in the panel. Evidence: {Goat.EvidenceId}.");
            return sb.ToString();
        }

        public static string GoatTunerEntry(Tablet t)
        {
            string J(string s) => s.Replace("\\", "\\\\").Replace("'", "\\'");
            var inv = CultureInfo.InvariantCulture;
            return $"  {{id:'{Goat.Id}', group:'The GOAT', tag:'real', name:'The GOAT', field:'good',\n   desc:'{J(GoatCopy(t))}',\n" +
                   string.Format(inv, "   device:'wacom', res:0, pxmm:{0}, cm:{1}, slider:0, hdlMax:{2}, snap:{3}, gameFilter:false, adv:{{reset:{4}, yx:{5}, accel:{6}, cap:{7}, offset:{8}}}}},",
                       Goat.PxMm, Goat.Cm, Goat.HdlMax, Goat.Snap, Goat.ResetMs, "1.0", Goat.Accel, Goat.Cap, Goat.Offset);
        }

        /// The card as a tuner.html entry (the roster's only write path).
        public static string TunerEntry(Preset c)
        {
            string J(string s) => s.Replace("\\", "\\\\").Replace("'", "\\'");
            var inv = CultureInfo.InvariantCulture;
            var sb = new StringBuilder();
            sb.Append($"  {{id:'{c.id}', group:'{J(c.group)}', tag:'theory', name:'{J(c.name)}',\n   desc:'{J(c.desc)}',\n");
            sb.Append(string.Format(inv, "   device:'wacom', res:0, pxmm:{0}, cm:{1}, slider:0, hdlMax:{8}, snap:{2}, gameFilter:{3}, adv:{{reset:{9}, yx:{4}, accel:{5}, cap:{6}, offset:{7}}}",
                c.pxmm, c.cm, c.snap, c.gameFilterOn ? "true" : "false", c.adv.yx, c.adv.accel, c.adv.cap, c.adv.offset, c.hdlMax, c.adv.reset));
            if (c.cohOv is CohOv h)
                sb.Append(string.Format(inv, ",\n   cohOv:{{window:70, hold:0, fullPass:8, engage:3, floor:0.30, ceiling:0.55, rails:0, anchor:0, anchorMs:350, settle:0, settleSpeed:80, tap:1.0, tapArm:1.0, tapHold:{0}, tapBreak:{1}, lead:0}}", h.tapHold, h.tapBreak));
            sb.Append("},");
            return sb.ToString();
        }
    }
}
