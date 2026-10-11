using System;
using System.Globalization;
using System.IO;

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
    /// third-person cards; off = exactly the card.
    /// </summary>
    public static class ThirdPerson
    {
        public const double DefaultCameraM = 2.5, DefaultFightM = 12, MinK = 1.0, MaxK = 1.6;

        public sealed class State
        {
            public bool On; public double CameraM = DefaultCameraM, FightM = DefaultFightM;
            public static string DefaultPath => Path.Combine(AppContext.BaseDirectory, "tps.txt");
            /// tps.txt: "on|off;<camera arm m>;<fight distance m>"
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
                        if (p.Length > 1 && double.TryParse(p[1], NumberStyles.Float, CultureInfo.InvariantCulture, out var c)) s.CameraM = c;
                        if (p.Length > 2 && double.TryParse(p[2], NumberStyles.Float, CultureInfo.InvariantCulture, out var d)) s.FightM = d;
                    }
                }
                catch { }
                if (!double.IsFinite(s.CameraM) || s.CameraM < 0.5 || s.CameraM > 8) s.CameraM = DefaultCameraM;
                if (!double.IsFinite(s.FightM) || s.FightM < 2 || s.FightM > 60) s.FightM = DefaultFightM;
                return s;
            }
            public void Save(string? path = null)
                => File.WriteAllText(path ?? DefaultPath, string.Format(CultureInfo.InvariantCulture, "{0};{1};{2}", On ? "on" : "off", CameraM, FightM));
            public double K => Factor(CameraM, FightM);
        }

        /// k = (D_ref + L) / D_ref, clamped to 1.0-1.6.
        public static double Factor(double cameraM, double fightM)
            => !(fightM > 0) || !double.IsFinite(cameraM) ? 1 : Math.Clamp((fightM + Math.Max(0, cameraM)) / fightM, MinK, MaxK);

        /// Hand motion per on-screen offset for a target at distance d, relative to a first-person game (1 = FPS feel).
        public static double FeelVsFps(double k, double cameraM, double d) => (d + cameraM) / d / k;

        /// The third-person games in the roster: Marvel Rivals and Deadlock (every other game here is first person).
        public static bool IsThirdPerson(Preset p)
            => (p.id ?? "").StartsWith("riv", StringComparison.Ordinal) || (p.id ?? "").StartsWith("dl", StringComparison.Ordinal)
               || (p.group ?? "").Contains("Marvel Rivals", StringComparison.OrdinalIgnoreCase) || (p.group ?? "") == "Deadlock";

        /// Scales a rig's output multiplier for this card. Idempotent: the base multiplier is recovered from TpsGain first, so
        /// applying twice, or to a rig replayed from an earlier apply, never compounds.
        public static void ApplyTo(Rig rg, Preset p, State s)
        {
            double k = s.On && IsThirdPerson(p) ? s.K : 1.0;
            double g = rg.TpsGain > 0 ? rg.TpsGain : 1.0;
            rg.Mult = rg.Mult / g * k; rg.TpsGain = k;
        }

        /// The rig as the card wrote it, without the match (for the window, the in-game sensitivity and exports).
        public static void Strip(Rig rg) { double g = rg.TpsGain > 0 ? rg.TpsGain : 1.0; rg.Mult /= g; rg.TpsGain = 1.0; }

        public static string Describe(State s, Preset? p)
        {
            if (!s.On) return "off";
            if (p != null && !IsThirdPerson(p)) return "on, but this card is a first-person game: no change";
            double k = s.K;
            return string.Format(CultureInfo.InvariantCulture, "x{0:0.00} (camera {1:0.0} m, matched at {2:0} m): feel vs FPS 5 m {3:0.00}x, {2:0} m 1.00x, 25 m {4:0.00}x",
                k, s.CameraM, s.FightM, FeelVsFps(k, s.CameraM, 5), FeelVsFps(k, s.CameraM, 25));
        }
    }
}
