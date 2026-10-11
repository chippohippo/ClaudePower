using System;
using System.Numerics;

namespace AimForge.Filters
{
    /// <summary>
    /// NIB TWIN (2026-09-24, XP_TOGGLES.md) - the click skid removed at the source, keyed on tip pressure.
    ///
    /// Pressing the tip to fire moves the reported position: the tilted nib compresses and the coil swings ~0.3 mm (the
    /// Tap Anchor's measured skid, CoherenceStabilizer src/tapdiag.cs). The Tap Anchor pins it only while the pen is
    /// still - by design it lets go the moment the hand travels - so a shot fired while MOVING carries the swing into
    /// the camera. The swing is mechanically locked to the pressure ramp, and pressure is the one signal the project's
    /// physics says separates click-caused motion from intent. So a calibrated feed-forward model removes it on the SAME
    /// report, moving or still, before anything else in the chain reads the position:
    ///     swing(p) = Skid * h(p),  h = min(1, (p / SkidFullPressure)^SkidGamma), taken SkidLagReports reports back.
    ///
    /// Placement: FIRST aim filter (before the stabilizer, the game filters and Cadence Lock), so every downstream stage
    /// sees the hand without the swing - it composes with the Tap Anchor (which then only has hand flexion and approach
    /// drift left to hold) and works on either curve engine. (Placed after the pin, it double-removed the skid the pin
    /// had already held back: measured +0.05 deg on rest one-taps - the reason it is its own filter.)
    ///
    /// Laws: a ledger spends the correction only against the pen's own reported motion (never more per report than the
    /// pen moved, never on a still report); capped at 1.1 |Skid|; nets to zero over a press-release cycle; dropped after
    /// SkidDropMs at zero pressure. Never touches gain. Twin 0 or pressure 0 (hover, where all aiming happens) =
    /// bit-identical passthrough. Lift/gap law as Cadence Lock: never snaps onto the pen while OTD could pass the jump.
    /// Millimetres in, millimetres out.
    /// </summary>
    public sealed class NibTwinCore
    {
        public double Twin;                       // 0 = off (exact passthrough), 1 = on
        public double SkidXmm, SkidYmm;           // calibrated swing at full press, mm, tablet axes
        public double SkidFullPressure = 0.35;    // pressure fraction where the swing is complete (calibration median tap peak)
        public double SkidGamma = 1.0;
        public double SkidLagReports;             // 0..2
        public double SkidDropMs = 150;
        /// A report later than ResetMs is a gap (the pen stalled, lifted or re-entered). 50 ms sits below OTD's shortest
        /// relative reset delay on the cards, so a gap the daemon still passes is handled here too: the swing that changed
        /// across it is removed from the passed delta (the gap is far longer than the lag, so it is complete).
        public double ResetMs = 50, RebaseMs = 1000;
        /// The pen's report rate, pinned by AimForge (the build's pen Hz, 360 measured). 0 = learn it, from plausible
        /// single-report intervals only. It tells a merged USB frame from a normal report.
        public double NominalHz;

        bool primed, everPrimed; Vector2 lastPos; double outX, outY;
        double ledX, ledY, idleMs, dtNominal; readonly double[] hb = new double[3];
        public double LastRemovedMm { get; private set; }
        public double LedgerMm => Math.Sqrt(ledX * ledX + ledY * ledY);

        /// A lift (OutOfRange). The pressure history and any correction still owed are KEPT: the next report is a gap, and
        /// the gap path removes exactly the swing that changed across it (a tip still down at re-entry changed nothing).
        public void Reset() { primed = false; }
        void ResetTwin(double p01) { double h = H(p01); hb[0] = hb[1] = hb[2] = h; ledX = ledY = 0; idleMs = 0; }

        /// The modelled swing at this pressure as a fraction of the calibrated swing (saturates at 1: a harder tap swings
        /// no further once the nib bottoms out).
        public double H(double p01)
            => !(p01 > 0) || !(SkidFullPressure > 0) ? 0 : Math.Min(1.0, Math.Pow(Math.Min(1.0, p01) / SkidFullPressure, Math.Max(0.1, SkidGamma)));

        public Vector2 Filter(Vector2 posMm, double dtMs, double p01)
        {
            if (Twin < 0.5) { primed = false; return posMm; }
            // a non-finite sample is never stored (2026-09-24 review: it used to latch the output at NaN until a 1 s gap)
            if (!IsFinite(posMm)) return everPrimed ? new Vector2((float)outX, (float)outY) : posMm;
            if (!everPrimed || dtMs > RebaseMs)
            {
                everPrimed = primed = true; lastPos = posMm; outX = posMm.X; outY = posMm.Y; ResetTwin(p01);
                return posMm;
            }
            var d = posMm - lastPos; lastPos = posMm;
            double hNow = H(p01);
            int lag = (int)Math.Clamp(Math.Round(SkidLagReports), 0, 2);
            if (!primed || !(dtMs > 0) || dtMs > ResetMs)
            {
                // the hand's own delta: the swing that changed across the gap (a stall mid-press or mid-release, or a
                // re-entry with the tip down) leaves with it, and so does any correction still owed. 2026-09-24 review: the
                // gap passed the swing and then ResetTwin forgot it, so a 50-80 ms stall on a ramp left a full swing in the
                // camera. OTD passes or discards this delta whole, so removing the swing is right either way.
                double cross = hNow - hb[lag];
                double gx = cross * SkidXmm + ledX, gy = cross * SkidYmm + ledY;
                primed = true; ResetTwin(p01);
                if (d.Length() > 0) { outX += d.X - gx; outY += d.Y - gy; }
                else { outX += d.X; outY += d.Y; ledX = gx; ledY = gy; }   // never move on a still report: owe it instead
                return new Vector2((float)outX, (float)outY);
            }
            // a merged USB frame (dt well above the report interval) carries several reports of pressure change at once: the
            // report-counted lag would credit it late, after the pen moved, and part of it would be dropped (2026-09-24
            // review). Credit the whole change now and restart the history from here. The interval is pinned from the build,
            // or learned ONLY from plausible single-report gaps (third review: back-to-back reports after a queued stall
            // trained it down until every report read as merged and the lag was lost for the session). 1.8x keeps a late
            // single report (~1.65x) from reading as a 2-report merge.
            double nom = NominalHz > 0 ? 1000.0 / NominalHz : dtNominal;
            bool merged = nom > 0 && dtMs > 1.8 * nom;
            if (!(NominalHz > 0))
            {
                if (dtNominal <= 0) { if (dtMs >= 1 && dtMs <= 20) dtNominal = dtMs; }
                else if (dtMs >= 0.5 * dtNominal && dtMs <= 1.5 * dtNominal) dtNominal += 0.05 * (dtMs - dtNominal);
            }
            double dh;
            if (merged && lag > 0)
            {
                dh = hNow - hb[lag];
                hb[0] = hb[1] = hb[2] = hNow;
            }
            else
            {
                // h(t-lag) - h(t-lag-1). `oldest` is h(t-3) from before the shift (2026-09-24 review: lag 2 read h(t-4), a
                // two-report difference that removed the swing twice while moving and left ~0.27 mm at rest).
                double oldest = hb[2];
                hb[2] = hb[1]; hb[1] = hb[0]; hb[0] = hNow;
                double h = hb[lag], hPrev = lag < 2 ? hb[lag + 1] : oldest;
                dh = h - hPrev;
            }
            ledX += dh * SkidXmm; ledY += dh * SkidYmm;
            double cap = 1.1 * Math.Sqrt(SkidXmm * SkidXmm + SkidYmm * SkidYmm), ll = Math.Sqrt(ledX * ledX + ledY * ledY);
            if (ll > cap && ll > 0) { ledX *= cap / ll; ledY *= cap / ll; ll = cap; }
            LastRemovedMm = 0;
            double dl = d.Length();
            double rx = 0, ry = 0;
            if (ll > 1e-12 && dl > 0)
            {
                double f = Math.Min(1.0, dl / ll);
                rx = ledX * f; ry = ledY * f; ledX -= rx; ledY -= ry; LastRemovedMm = ll * f;
            }
            if (hNow <= 0) { idleMs += dtMs; if (idleMs >= SkidDropMs) ledX = ledY = 0; } else idleMs = 0;
            outX += d.X - rx; outY += d.Y - ry;
            return new Vector2((float)outX, (float)outY);
        }

        static bool IsFinite(Vector2 v) => float.IsFinite(v.X) && float.IsFinite(v.Y);
    }
}
