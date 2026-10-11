using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;

namespace AimForge.Core
{
    /// <summary>
    /// THIRD-PERSON MATCH (2026-09-27, THIRD_PERSON.md). Make an over-the-shoulder game feel like a first-person one under the pen.
    ///
    /// First person: the camera turns about your eye, so a turn of θ moves EVERY target on screen by θ, near or far. The
    /// hand-to-screen mapping is one constant, and a pen - which aims by pointing - learns it.
    /// Third person: the camera sits on an arm of length L behind the hero and ORBITS the hero. The aim ray always passes
    /// through the pivot, so the turn a shot needs is the FPS turn seen from the pivot, but what you SEE is from the camera:
    /// a target at distance D (from the hero) moves on screen by only θ·D/(D+L). So the hand motion per on-screen offset is
    /// (D+L)/D times the FPS one, and it changes with every target's distance (derivation in THIRD_PERSON.md).
    ///
    /// No input filter can know the target's distance. The match picks the distance you fight at, D_ref, and scales the
    /// output by k = (D_ref+L)/D_ref: targets at D_ref then move under the pen exactly as in an FPS, and the mismatch at
    /// other distances shrinks from (D+L)/D to (D+L)/D ÷ k. It is a pure output scale (RawAccel's output multiplier), so
    /// the curve's shape in hand speed, the in-game sensitivity and every other game are untouched. Applied only to
    /// third-person games; off = exactly the card.
    ///
    /// 2026-10-11: which games are third person, and each one's camera-arm estimate, come from the tuner's GAMES table
    /// (presets.json), not from card-id prefixes. The arm is per game (an override per game in tps.txt), and the fight
    /// distance has three named starting points.
    /// </summary>
    public static class ThirdPerson
    {
        public const double DefaultCameraM = 2.5, DefaultFightM = 12, MinK = 1.0, MaxK = 1.6;

        /// Named fight distances. STARTING POINTS from THIRD_PERSON.md's guidance (divers 8-10 m, pokes 15-20 m), not
        /// measurements - tune by feel; field verdict pending.
        public static readonly (string name, double m, string who)[] DistancePresets =
        {
            ("dive", 9, "divers and brawlers"), ("mid", 12, "most fights (default)"), ("poke", 18, "pokes and hitscan"),
        };

        // ---- the roster's games (registered when presets.json loads) ----
        static Dictionary<string, Game> games = new();
        public static void Register(IEnumerable<Game> gs) => games = gs.ToDictionary(g => g.id, g => g);

        static Game? GameOf(Preset p) => p.game != null && games.TryGetValue(p.game, out var g) ? g : null;

        /// The third-person games: the GAMES table's thirdPerson flag. A build that names no known game (an old export,
        /// a fixture) falls back to the pre-2026-10-11 rule - the Marvel Rivals and Deadlock groups.
        public static bool IsThirdPerson(Preset p)
            => GameOf(p) is Game g ? g.thirdPerson
               : (p.group ?? "").Contains("Marvel Rivals", StringComparison.OrdinalIgnoreCase) || (p.group ?? "") == "Deadlock";

        /// The game key the per-game camera arm is stored under (the GAMES id; the group for an unknown game).
        public static string GameKey(Preset p) => GameOf(p)?.id ?? p.game ?? ((p.group ?? "").Contains("Deadlock") ? "deadlock" : "rivals");

        /// The roster's camera-arm estimate for a card's game (DefaultCameraM when the table has none).
        public static double RosterArm(Preset p) => GameOf(p)?.cameraArmM ?? DefaultCameraM;

        public sealed class State
        {
            public bool On; public double FightM = DefaultFightM;
            /// Per-game camera arm the user set (game id -> m). A game without an entry uses the roster's estimate.
            public Dictionary<string, double> ArmByGame = new();
            public static string DefaultPath => Path.Combine(AppContext.BaseDirectory, "tps.txt");

            public double ArmFor(Preset p) => ArmByGame.TryGetValue(GameKey(p), out var a) ? a : RosterArm(p);
            public void SetArm(Preset p, double m) => ArmByGame[GameKey(p)] = ClampArm(m);
            public double KFor(Preset p) => Factor(ArmFor(p), FightM);
            /// The named preset the fight distance sits on, or null for a custom distance.
            public string? PresetName => DistancePresets.FirstOrDefault(d => d.m == FightM).name;

            /// tps.txt: "on|off;<legacy global arm m>;<fight distance m>[;game=arm,game=arm]". A legacy global arm that is not
            /// the default (a user setting from before 2026-10-11) becomes the arm for both third-person games.
            public static State Load(string? path = null)
            {
                var s = new State();
                try
                {
                    string f = path ?? DefaultPath;
                    if (File.Exists(f))
                    {
                        var p = File.ReadAllText(f).Trim().Split(';');
                        s.On = p.Length > 0 && p[0] == "on";
                        if (p.Length > 1 && double.TryParse(p[1], NumberStyles.Float, CultureInfo.InvariantCulture, out var c) && double.IsFinite(c) && c != DefaultCameraM && c >= 0.5 && c <= 8)
                        { s.ArmByGame["rivals"] = c; s.ArmByGame["deadlock"] = c; }
                        if (p.Length > 2 && double.TryParse(p[2], NumberStyles.Float, CultureInfo.InvariantCulture, out var d)) s.FightM = d;
                        if (p.Length > 3)
                            foreach (var kv in p[3].Split(',', StringSplitOptions.RemoveEmptyEntries))
                            {
                                var e = kv.Split('=');
                                if (e.Length == 2 && e[0].Length > 0 && double.TryParse(e[1], NumberStyles.Float, CultureInfo.InvariantCulture, out var a) && double.IsFinite(a) && a >= 0.5 && a <= 8)
                                    s.ArmByGame[e[0]] = a;
                            }
                    }
                }
                catch { }
                if (!double.IsFinite(s.FightM) || s.FightM < 2 || s.FightM > 60) s.FightM = DefaultFightM;
                return s;
            }
            public void Save(string? path = null)
                => File.WriteAllText(path ?? DefaultPath, string.Format(CultureInfo.InvariantCulture, "{0};{1};{2};{3}", On ? "on" : "off", DefaultCameraM, FightM,
                       string.Join(",", ArmByGame.OrderBy(k => k.Key).Select(k => k.Key + "=" + k.Value.ToString(CultureInfo.InvariantCulture)))));
        }

        static double ClampArm(double m) => !double.IsFinite(m) ? DefaultCameraM : Math.Clamp(m, 0.5, 8);

        /// k = (D_ref + L) / D_ref, clamped to 1.0-1.6.
        public static double Factor(double cameraM, double fightM)
            => !(fightM > 0) || !double.IsFinite(cameraM) ? 1 : Math.Clamp((fightM + Math.Max(0, cameraM)) / fightM, MinK, MaxK);

        /// Hand motion per on-screen offset for a target at distance d, relative to a first-person game (1 = FPS feel).
        public static double FeelVsFps(double k, double cameraM, double d) => (d + cameraM) / d / k;

        /// Scales a rig's output multiplier for this card. Idempotent: the base multiplier is recovered from TpsGain first, so
        /// applying twice, or to a rig replayed from an earlier apply, never compounds.
        public static void ApplyTo(Rig rg, Preset p, State s)
        {
            double k = s.On && IsThirdPerson(p) ? s.KFor(p) : 1.0;
            double g = rg.TpsGain > 0 ? rg.TpsGain : 1.0;
            rg.Mult = rg.Mult / g * k; rg.TpsGain = k;
        }

        /// The rig as the card wrote it, without the match (for the window, the in-game sensitivity and exports).
        public static void Strip(Rig rg) { double g = rg.TpsGain > 0 ? rg.TpsGain : 1.0; rg.Mult /= g; rg.TpsGain = 1.0; }

        public static string Describe(State s, Preset? p)
        {
            if (!s.On) return "off";
            if (p == null) return "on";
            if (!IsThirdPerson(p)) return "on, but this card is a first-person game: no change";
            double k = s.KFor(p), arm = s.ArmFor(p);
            return string.Format(CultureInfo.InvariantCulture, "x{0:0.00} (camera {1:0.0} m{5}, matched at {2:0} m{6}): feel vs FPS 5 m {3:0.00}x, {2:0} m 1.00x, 25 m {4:0.00}x",
                k, arm, s.FightM, FeelVsFps(k, arm, 5), FeelVsFps(k, arm, 25),
                GameOf(p)?.cameraArmEstimated == true && !s.ArmByGame.ContainsKey(GameKey(p)) ? " est." : "",
                s.PresetName is string n ? " - " + n : "");
        }
    }
}
