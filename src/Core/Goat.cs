using System;

namespace AimForge.Core
{
    /// <summary>
    /// THE GOAT (field verdict 2026-10-24, ev-20261024-goat): "hands down one of the best feelings I've had on tablet".
    /// The live build was the Apex Legends Brawl curve (apxllb, 2026-10-23) on the user's own rig: 57 px/mm, angle snap 0,
    /// Y/X 1.00, reset 20 ms, HDL 87, no stabilizer, no game filter, Cadence Lock engine (360 Hz, merge cap 5), Nib Twin /
    /// Intent Speed / Reversal Carry off, played in The Finals at Mouse Look Sensitivity 12 (the user's recollection) =
    /// 52.63 cm/360. The user's read: it feels most like a mouse - arm and hand for the big moves, fingertip and wrist
    /// pivot on micro adjustments - and adapts to changes; angle snapping and the Y/X ratio made aim inconsistent.
    /// Every card except BO6 Original is now built on this baseline (GameLab, HeroLab, the Breakpoints). The tuner's
    /// 'goat' entry is the card; these constants are what the labs derive from, and a selftest pins the two equal.
    /// </summary>
    public static class Goat
    {
        public const string Id = "goat";
        public const double FinalsSens = 12.0;
        /// The Finals: sens = K / (eDPI x cm), eDPI = 57 px/mm x 25.4 = 1447.8 -> cm = 914400 / (1447.8 x 12) = 52.63.
        public const double Cm = 52.63;
        public const double PxMm = 57, Snap = 0, Yx = 1.0, ResetMs = 20, HdlMax = 87;
        /// apxllb's classic curve: 1:1 to 40 mm/s (offset 2.28 counts/ms at 57 px/mm), one ramp to the 3.0x cap at 190 mm/s.
        public const double Accel = 0.2963, Offset = 2.28, Cap = 3.0;
        public const double UnityMms = 40, CapAtMms = 190;
        public const string EvidenceId = "ev-20261024-goat";
    }
}
