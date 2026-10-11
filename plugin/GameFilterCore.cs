using System;
using System.Numerics;

namespace AimForge.Filters
{
    /// <summary>
    /// The shared kernel + per-game policies for the AimForge Game Filters. Pure math, no OTD
    /// dependency - compiled into BOTH the plugin assembly and the AimForge app, so the
    /// selftests drive the exact shipping code (the CoherenceCore pattern).
    ///
    /// Kernel law (session-3 contract):
    ///   - PreTransform, tablet millimetres, deterministic: same reports in, same out.
    ///   - Pen signals only: position, dt, pressure. Game-specificity is policy on those
    ///     signals - never game memory.
    ///   - No interpolation, no follow radius, no prediction. The only stabilizer a game
    ///     filter may add is the coherence-and-speed-gated deadzone (VelocityGuard-shaped),
    ///     which is ZERO the moment motion is committed.
    ///   - Relative output reads only deltas. Motion a per-report policy (rail, brake, glue) withholds is never
    ///     repaid: past 1.0 mm it moves into slack instead of switching the policy off (2026-09-16 review: the old
    ///     clamp silently disabled the CoD rail and the Finals brake after ~1 mm per stroke). The Lab smoothers keep
    ///     the hard 1.0 mm pull - there it is the lag bound.
    ///   - After a lift or a gap the output keeps its offset (the hand's own delta passes); it rebases onto the pen
    ///     only after a gap past RebaseMs, which OTD's relative reset always discards.
    /// </summary>
    public sealed class GameFilterCore
    {
        public enum Game { Cod, Val, Apex, Ow2, Rivals, Finals, Holdfast }
        public enum Member { Master, Lab }

        public Game Which; public Member Kind;

        // ---- settings (all double so the OTD property surface and the plan stay uniform) ----
        public double MaxDzMm, KneeMmS = 8, FlushOnTurnDeg = 60;
        public double TrackGlue, AntiTrailTurnDeg = 25;
        public double RailStrength, RailCeilMmS = 18, SnapDeg = 9, VerticalOnly = 1;
        public double BrakeDropFrac = 0.45, BrakeWindowMs = 40, BrakeGain = 0.55, BrakeHoldReports = 2;
        public double HoldAssistMs, EmaAmount, OrthoCapMm = 0.15;
        public double IgnoreSnap, ContactOnly, ModeHybrid = 1;
        public double FloorUntilMmS = 15, TapUntilMmS = 55, TrackUntilMmS = 150;
        public double ResetMs = 50, MaxBiasMm = 1.0, RebaseMs = 1000, ArmExpireMs = 250;

        // ---- state ----
        Vector2 lastPos, outPos, vecEma, slack; double magEma, lastHeading; bool primed, everPrimed;
        // brake starts DISARMED: only a real swing (> TrackUntilMmS) arms it (2026-09-16 audit: it fired on a
        // 55 mm/s peak and then never re-armed below 150 mm/s)
        int brakeLeft, cohStreak; bool brakeArmed = false; double lastSwingClock = -1e9;
        readonly double[] spdT = new double[32]; readonly double[] spdV = new double[32]; int spdN; double clock;

        public void Reset()
        {
            primed = false; vecEma = Vector2.Zero; magEma = 0; brakeLeft = 0; cohStreak = 0; brakeArmed = false; lastSwingClock = -1e9;
            // slack survives a lift/gap: the bias it encodes (a held deadzone offset, a smoother's owed lag) carries on
            spdN = 0; clock = 0;
        }

        public Vector2 Filter(Vector2 pos, double dtMs)
        {
            if (dtMs > ResetMs || dtMs <= 0) Reset();
            if (!primed)
            {
                primed = true; lastHeading = 0;
                if (!everPrimed || dtMs > RebaseMs) { everPrimed = true; outPos = pos; slack = Vector2.Zero; }   // OTD discards this delta
                else { outPos += pos - lastPos; }                                                              // lift/gap: pass the hand; bias and owed lag unchanged
                lastPos = pos; return outPos;
            }

            clock += dtMs;
            var d = pos - lastPos; lastPos = pos;
            // The pen as this filter sees it: an offset ACCEPTED at an anti-trail re-anchor is never repaid.
            var pe = pos - slack;
            double dist = d.Length();
            double v = dist / dtMs * 1000.0;

            double heading = dist > 1e-6 ? Math.Atan2(d.Y, d.X) * 180.0 / Math.PI : lastHeading;
            double hdgDelta = Math.Abs(((heading - lastHeading + 540.0) % 360.0) - 180.0);
            if (dist > 1e-6) lastHeading = heading;

            double a = 1.0 - Math.Exp(-dtMs / 70.0);          // coherence EMA, stabilizer definition
            vecEma += ((d / (float)Math.Max(dtMs, 1e-6)) - vecEma) * (float)a;
            magEma += (dist / Math.Max(dtMs, 1e-6) - magEma) * a;
            double coh = magEma > 1e-9 ? vecEma.Length() / magEma : 0.0;
            // The deadzone bypass demands SUSTAINED coherence: a single coherent-looking report
            // (which every first report of anything is, on an empty EMA) never opens the gate;
            // tremor alternation never sustains it; a deliberate creep earns it in ~4 reports.
            cohStreak = coh > 0.75 ? cohStreak + 1 : 0;

            int zone = v < FloorUntilMmS ? 0 : v < TapUntilMmS ? 1 : v < TrackUntilMmS ? 2 : 3; // micro/tap/track/flick

            // brake speed history (Finals)
            spdT[spdN & 31] = clock; spdV[spdN & 31] = v; spdN++;

            Vector2 dOut = d;

            switch (Which)
            {
                case Game.Cod when Kind == Member.Master:
                    // vertical recoil rail: track zone only, heading near vertical, orthogonal
                    // component scaled - a heading bias on THIS report, never a position trail
                    if (zone == 2 && VerticalOnly >= 0.5 && dist > 1e-6)
                    {
                        double offVert = Math.Abs(Math.Atan2(Math.Abs(d.X), Math.Abs(d.Y)) * 180.0 / Math.PI);
                        if (offVert <= SnapDeg)
                            dOut = new Vector2(d.X * (float)(1.0 - RailStrength), d.Y);
                    }
                    break;

                case Game.Cod: // Lab: HoldAssist IS light smoothing (T3), Planted/Slow Center only
                    if (HoldAssistMs > 0)
                    {
                        double al = 1.0 - Math.Exp(-dtMs / HoldAssistMs);
                        outPos += (pe - outPos) * (float)al;
                        return ClampLag(pe);
                    }
                    break;

                case Game.Val when Kind == Member.Master:
                {
                    // no rail, no snap bias - coherence-weighted deadzone only.
                    // The flush is for a FAST deliberate jig: tremor also reverses heading 180
                    // degrees, but at sub-knee speed - a speed gate separates the two.
                    // the flush passes the hand's own delta and accepts the held offset (the Apex/Rivals law below)
                    if (hdgDelta > FlushOnTurnDeg && v > KneeMmS) { outPos += d; slack = pos - outPos; return outPos; }
                    double dz = cohStreak >= 4 ? 0 : MaxDzMm * Math.Max(0, 1.0 - v / KneeMmS);
                    if (dz > 0 && (pe - outPos).Length() <= dz) return outPos;  // held - zero motion
                    break;
                }

                case Game.Val: // Lab: tiny EMA, Planted only
                    if (EmaAmount > 0)
                    {
                        outPos = pe + (outPos - pe) * (float)Math.Min(EmaAmount, 0.10);
                        return ClampLag(pe);
                    }
                    break;

                case Game.Apex:
                case Game.Rivals:
                {
                    // anti-trail law first: flick or a real turn = raw THIS report, no residual.
                    // Speed-gated like the Val flush - tremor reversals are turns too, but slow.
                    // Relative output reads only DELTAS, so a constant offset between the output and the pen never reaches
                    // the cursor. The old law snapped outPos = pos here and repaid the whole withheld rest offset (up to
                    // MaxDzMm) inside ONE report - a speed the hand never made, which the curve then accelerated (the flyer
                    // spike, 2026-09-16 audit). Now: pass the hand's own delta this report and ACCEPT the offset.
                    if (zone == 3 || (hdgDelta > AntiTrailTurnDeg && v > KneeMmS)) { outPos += d; slack = pos - outPos; return outPos; }
                    double dz = cohStreak >= 4 ? 0 : MaxDzMm * Math.Max(0, 1.0 - v / KneeMmS);
                    if (dz > 0 && (pe - outPos).Length() <= dz) return outPos;
                    if (TrackGlue > 0 && zone == 2 && coh > 0.8 && hdgDelta < 12 && vecEma.LengthSquared() > 1e-12)
                    {
                        var dir = Vector2.Normalize(vecEma);
                        var along = dir * Vector2.Dot(d, dir);
                        dOut = along + (d - along) * (float)(1.0 - TrackGlue);   // orthogonal jitter only
                    }
                    break;
                }

                case Game.Ow2 when Kind == Member.Master:
                    // hybrid: rail only in micro/tap under the ceiling, and NEVER inside the snap
                    // cone (RawAccel snapping already owns that band - min(snap, rail), no stacking)
                    if (ModeHybrid >= 0.5 && zone <= 1 && v < RailCeilMmS && dist > 1e-6 && vecEma.LengthSquared() > 1e-12)
                    {
                        double offAxis = Math.Min(
                            Math.Abs(Math.Atan2(Math.Abs(d.Y), Math.Abs(d.X)) * 180.0 / Math.PI),
                            Math.Abs(Math.Atan2(Math.Abs(d.X), Math.Abs(d.Y)) * 180.0 / Math.PI));
                        if (!(SnapDeg > 0 && offAxis <= SnapDeg))
                        {
                            var dir = Vector2.Normalize(vecEma);
                            var along = dir * Vector2.Dot(d, dir);
                            dOut = along + (d - along) * (float)(1.0 - RailStrength);
                        }
                    }
                    break;

                case Game.Ow2: // Lab: Guardrail - heavy rail + hard orthogonal cap (T3)
                    if (dist > 1e-6 && vecEma.LengthSquared() > 1e-12 && zone >= 1)
                    {
                        var dir = Vector2.Normalize(vecEma);
                        var along = dir * Vector2.Dot(d, dir);
                        var ortho = d - along;
                        double om = ortho.Length();
                        if (om > OrthoCapMm) ortho *= (float)(OrthoCapMm / om);
                        dOut = along + ortho * (float)(1.0 - RailStrength);
                    }
                    break;

                case Game.Finals:
                {
                    if (brakeLeft > 0) { dOut = d * (float)BrakeGain; brakeLeft--; break; }
                    double peak = 0;
                    for (int i = Math.Max(0, spdN - 32); i < spdN - 1; i++)
                        if (clock - spdT[i & 31] <= BrakeWindowMs) peak = Math.Max(peak, spdV[i & 31]);
                    // the arm expires with the swing: ArmExpireMs after the last swing-speed report, or once the pen is at rest
                    // (2026-09-16 review: a sticky arm braked a tap stop seconds later; expiring with the 40 ms window was too
                    // eager and a slow swing never braked at its own stop)
                    if (v > TrackUntilMmS) lastSwingClock = clock;
                    if (clock - lastSwingClock > ArmExpireMs || (v < FloorUntilMmS && peak < FloorUntilMmS)) brakeArmed = false;
                    if (brakeArmed && peak > TapUntilMmS && v <= peak * (1.0 - BrakeDropFrac))
                    { brakeLeft = (int)BrakeHoldReports - 1; dOut = d * (float)BrakeGain; brakeArmed = false; }
                    else if (v > TrackUntilMmS) brakeArmed = true;   // re-arm on the next real swing
                    break;
                }

                case Game.Holdfast:
                    break; // identity: the filter exists so the family policy stays uniform
            }

            outPos += dOut;
            return Absorb(pe);
        }

        /// Per-report policies: withheld motion past MaxBiasMm moves into slack (the filter's pen follows); the output
        /// keeps this report's delta, so the policy stays in force for the whole stroke.
        Vector2 Absorb(Vector2 pe)
        {
            var bias = outPos - pe;
            double b = bias.Length();
            if (b > MaxBiasMm) slack -= bias * (float)(1.0 - MaxBiasMm / b);
            return outPos;
        }

        /// Lab smoothers: the output may lag the pen by at most MaxBiasMm (the latency bound of a T3 smoother).
        Vector2 ClampLag(Vector2 pe)
        {
            var bias = outPos - pe;
            double b = bias.Length();
            if (b > MaxBiasMm) outPos = pe + bias * (float)(MaxBiasMm / b);
            return outPos;
        }
    }
}
