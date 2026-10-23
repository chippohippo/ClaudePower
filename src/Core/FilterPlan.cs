using System;

namespace AimForge.Core
{
    /// <summary>
    /// Filter defaults per preset. A card that ships the Coherence Stabilizer keeps its OWN overlay; every
    /// other card is offered its GAME's Tap Anchor pin (2026-09-16 audit: keyed on the group's game, not a
    /// 2026-08 id list that left every character card and 17 LL cards on the generic pin). The numbers are
    /// not one global default: a musket build wants a long pin because nothing follows the shot, a tracking
    /// build wants a short pin with a small break distance because you fire WHILE moving.
    /// Hold smoothing is offered nowhere by default: it is the "filters feel delayed" culprit.
    /// </summary>
    public sealed class FilterPlan
    {
        public bool TapDefaultOn, HoldOffered;
        public double TapArm = 1.0, TapHold = 45, TapBreak = 0.8, HoldMs = 120;
        public string Rationale = "";

        public static FilterPlan For(Preset p)
        {
            // A preset that already ships a filter keeps its own values as the defaults.
            if (p.cohOv is CohOv c && c.tap > 0)
                return new FilterPlan
                {
                    TapDefaultOn = true, TapArm = c.tapArm, TapHold = c.tapHold, TapBreak = c.tapBreak,
                    HoldOffered = false,
                    Rationale = "ships with Tap Anchor on - the click-skid fix is this preset's point"
                };

            switch (FilterCatalog.GameOfGroup(p.group))
            {
                case "holdfast":
                    return new FilterPlan { TapHold = 60, TapBreak = 0.6,
                        Rationale = "musket taps: the skid is pressure-domain and only the pin addresses it - the tap-fire roles ship this on" };
                case "val":
                    return new FilterPlan { TapHold = 45, TapBreak = 0.6,
                        Rationale = "one-taps: a pin through the counter-strafe click costs nothing; remember fire must be a keyboard key under Vanguard" };
                case "finals":
                    return new FilterPlan { TapHold = 35, TapBreak = 0.6,
                        Rationale = "placed shots between tracks: medium pin - long enough for a deliberate shot, loose enough not to fight a track" };
                case "hd2":
                    return new FilterPlan { TapHold = 35, TapBreak = 0.6,
                        Rationale = "scoped placed shots (AMR/DCS): medium pin around the click" };
                case "ow2":
                    return new FilterPlan { TapHold = 30, TapBreak = 0.5,
                        Rationale = "mixed hitscan + tracking pool: between the tracking pin (25/0.45) and the placed-shot pin (35/0.6)" };
                case "apex":
                case "rivals":
                case "deadlock":
                    return new FilterPlan { TapHold = 25, TapBreak = 0.45,
                        Rationale = "firing while tracking: the pin must release on small travel or it fights the track - short and loose" };
                case "cod":
                    return new FilterPlan { TapHold = 30, TapBreak = 0.9,
                        Rationale = "fast follow-up shots: short pin so the next micro-correction is never held" };
            }

            return new FilterPlan { TapDefaultOn = false, TapHold = 45, TapBreak = 0.8,
                Rationale = "general build: Tap Anchor is the one filter with zero cost off the click; hold smoothing is offered nowhere (it is what felt delayed)" };
        }

        /// The tap-anchor-only configuration for this plan: hold 0 = exact position passthrough.
        public CohOv TapOnly() => new CohOv
        {
            hold = 0, rails = 0, settle = 0, anchor = 0, lead = 0,
            tap = 1.0, tapArm = TapArm, tapHold = TapHold, tapBreak = TapBreak
        };

        /// The full-filter configuration when the user opts into hold smoothing by hand.
        public CohOv WithHold(bool tapOn) => new CohOv
        {
            hold = HoldMs, rails = 0, settle = 0, anchor = 0, lead = 0,
            tap = tapOn ? 1.0 : 0.0, tapArm = TapArm, tapHold = TapHold, tapBreak = TapBreak
        };

        /// The Builds-tab filter toggles as data, so the fold is testable outside WinForms.
        public readonly struct Toggles
        {
            public readonly bool Tap, Hold; public readonly double HoldMs, TapArm, TapHold, TapBreak;
            public Toggles(bool tap, bool hold, double holdMs, double tapArm, double tapHold, double tapBreak)
            { Tap = tap; Hold = hold; HoldMs = holdMs; TapArm = tapArm; TapHold = tapHold; TapBreak = tapBreak; }
        }

        /// The toggles a card is prefilled with: its OWN overlay when it ships one, so an untouched apply
        /// reproduces the card exactly (lead, rails, anchor, settle and the coherence bands included).
        public static Toggles Prefill(Preset p)
        {
            var plan = For(p); var c = p.cohOv;
            return c == null
                ? new Toggles(plan.TapDefaultOn, false, plan.HoldMs, plan.TapArm, plan.TapHold, plan.TapBreak)
                : new Toggles(c.tap > 0, c.hold > 0, c.hold > 0 ? c.hold : plan.HoldMs, c.tapArm, c.tapHold, c.tapBreak);
        }

        /// The preset that actually gets applied: a COPY of the card with the toggles folded onto the card's
        /// own overlay (never a fresh plan object), carrying the declared game-filter plan.
        public static Preset Fold(Preset p, Toggles t)
        {
            var plan = For(p);
            CohOv? co = p.cohOv?.Copy() ?? (t.Hold ? plan.WithHold(t.Tap) : t.Tap ? plan.TapOnly() : null);
            if (co != null)
            {
                co.tap = t.Tap ? (p.cohOv != null && p.cohOv.tap > 0 ? p.cohOv.tap : 1.0) : 0.0;
                co.hold = t.Hold ? t.HoldMs : 0.0;
                co.tapArm = t.TapArm; co.tapHold = t.TapHold; co.tapBreak = t.TapBreak;
                if (co.tap == 0 && co.hold == 0 && co.lead == 0 && co.rails == 0 && co.anchor == 0 && co.settle == 0) co = null;
            }
            return p.WithCohOv(co);
        }
    }
}
