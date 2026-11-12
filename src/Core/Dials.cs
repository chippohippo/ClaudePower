using System;
using System.Globalization;

namespace AimForge.Core
{
    /// <summary>
    /// A classic card as four dials a player can reason about (2026-11-12). Every lab card is "one ramp between a 1:1
    /// band and a cap"; the driver's accel/offset/cap numbers hide that. The dials:
    ///   Band   - the hand speed (mm/s) up to which the pen is 1:1: the fingertip and wrist zone
    ///   Cap    - the gain the arm gets once the ramp is finished (the driver's cap)
    ///   CapAt  - the hand speed (mm/s) where that cap is reached
    ///   Cm     - the base speed: cm of pen travel for a 360 at 1:1 (the card's cm/360)
    /// The optimizer and the duel ladder search in this space, and every card is described as a move away from THE GOAT.
    /// </summary>
    public readonly struct Dials
    {
        public readonly double Band, Cap, CapAt, Cm;
        public Dials(double band, double cap, double capAt, double cm) { Band = band; Cap = cap; CapAt = capAt; Cm = cm; }

        public static readonly Dials Goat = new Dials(Core.Goat.UnityMms, Core.Goat.Cap, Core.Goat.CapAtMms, Core.Goat.Cm);

        /// The dials of a classic card (null for a LUT card or a flat one).
        public static Dials? Of(Preset p)
        {
            if (p.IsLut || !(p.adv.accel > 0) || !(p.adv.cap > 1)) return null;
            double k = p.pxmm / 1000.0;
            double capAt = Curve.ClassicCapSpeedCms(p.adv.accel ?? 0, p.adv.offset ?? 0, p.adv.cap ?? 1) / k;
            if (double.IsInfinity(capAt)) return null;
            return new Dials((p.adv.offset ?? 0) / k, p.adv.cap ?? 1, capAt, p.cm);
        }

        /// The classic numbers that realise these dials at a px/mm: the driver formula solved for accel (the same algebra as
        /// PsyLab.TracklineSat), rounded like every authored card (accel and offset to 4 places).
        public (double accel, double offset, double cap) Classic(double pxmm)
        {
            double k = pxmm / 1000.0, off = Math.Round(Band * k, 4), xc = CapAt * k;
            return (Math.Round((Cap - 1) * xc / ((xc - off) * (xc - off)), 4), off, Cap);
        }

        /// A card with these dials on a template's rig (px/mm, snap, Y/X, reset, hover, filter plan). A different base
        /// speed is carried by the output multiplier (mult = template cm / new cm), so the in-game sensitivity number the
        /// card prints is the template's: nothing has to change in the game.
        public Preset ToPreset(Preset template, string id, string name, string desc = "")
        {
            var p = template.WithCohOv(template.cohOv?.Copy());
            var (a, off, cap) = Classic(template.pxmm);
            p.id = id; p.name = name; p.group = "Custom"; p.tag = "theory"; p.field = null; p.desc = desc; p.lut = null; p.game = template.game;
            p.adv.accel = a; p.adv.offset = off; p.adv.cap = cap;
            p.cm = Cm;
            double mult = (template.adv.mult ?? 1.0) * template.cm / Cm;
            p.adv.mult = Math.Abs(Cm - template.cm) < 1e-9 ? template.adv.mult : Math.Round(mult, 4);
            return p;
        }

        public bool IsValid => Band >= 0 && Cap > 1 && CapAt > Band + 5 && Cm > 0;

        static string F(double v, string fmt = "0.#") => v.ToString(fmt, CultureInfo.InvariantCulture);

        public override string ToString() => $"1:1 to {F(Band)} mm/s · {F(Cap, "0.0#")}x by {F(CapAt, "0")} mm/s · {F(Cm, "0.0#")} cm/360";

        /// What moved against a reference, in the player's words; "the same build" when nothing did.
        public string Versus(Dials r, string refName = "the GOAT")
        {
            var o = new System.Collections.Generic.List<string>();
            if (Math.Abs(Band - r.Band) >= 0.5) o.Add($"1:1 band {(Band > r.Band ? "wider" : "narrower")}: {F(Band)} mm/s ({Sg(Band - r.Band)})");
            if (Math.Abs(Cap - r.Cap) >= 0.01) o.Add($"arm power {(Cap > r.Cap ? "up" : "down")}: {F(Cap, "0.0#")}x ({Sg(Cap - r.Cap, "0.0#")})");
            if (Math.Abs(CapAt - r.CapAt) >= 1) o.Add($"full power {(CapAt < r.CapAt ? "sooner" : "later")}: at {F(CapAt, "0")} mm/s ({Sg(CapAt - r.CapAt, "0")})");
            if (Math.Abs(Cm / r.Cm - 1) >= 0.002) o.Add($"base {(Cm < r.Cm ? "faster" : "slower")}: {F(Cm, "0.0#")} cm/360 ({Sg((r.Cm / Cm - 1) * 100, "0")}% speed)");
            return o.Count == 0 ? "the same build as " + refName : string.Join(" · ", o) + " vs " + refName;
        }
        static string Sg(double d, string fmt = "0.#") => (d >= 0 ? "+" : "−") + Math.Abs(d).ToString(fmt, CultureInfo.InvariantCulture);
    }
}
