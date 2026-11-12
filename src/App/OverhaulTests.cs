using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Numerics;
using AimForge.Core;
using AimForge.Filters;

namespace AimForge.App
{
    /// <summary>
    /// Selftests of the 2026-11-12 overhaul: plugin 1.4 (burst-armed drop check, Pressure Focus, the Hand Print recorder,
    /// the Realtime Lane's plan), the dials, the Hand Print analysis, the optimizer and the duel ladder.
    /// </summary>
    static class OverhaulTests
    {
        public delegate void OkFn(string name, bool pass, string detail = "");
        public static void Run(Catalogue cat, OkFn Ok)
        {
            var goat = cat.Find(Goat.Id)!; var bo = cat.Find("bo6og")!;
            const double DT = 1000.0 / 360.0;

            // ---- Drop Check 1.4: armed through queued bursts ----
            {
                var aim = ChainLab.Scenarios[2];
                double floor = ChainLab.Run(goat, Rig.From(goat), aim, ChainLab.Engine.CadenceDropCheck2, 10, 11, 0, ChainLab.Timing.Burst).AimErrDeg100ms;
                double jit = ChainLab.Run(goat, Rig.From(goat), aim, ChainLab.Engine.CadenceDropCheck2, 10, 11, 0, ChainLab.Timing.Jitter).AimErrDeg100ms;
                double v13 = 0, v14 = 0, plain = 0; int n = 0;
                foreach (var id in new[] { Goat.Id, "bo6og", "breakpoint", "rivpsy" })
                    foreach (int seed in new[] { 1, 2, 3 })
                    {
                        var cp = cat.Find(id)!;
                        plain += ChainLab.Run(cp, Rig.From(cp), aim, ChainLab.Engine.Cadence, 10, seed, 10, ChainLab.Timing.Burst).AimErrDeg100ms;
                        v13 += ChainLab.Run(cp, Rig.From(cp), aim, ChainLab.Engine.CadenceDropCheck, 10, seed, 10, ChainLab.Timing.Burst).AimErrDeg100ms;
                        v14 += ChainLab.Run(cp, Rig.From(cp), aim, ChainLab.Engine.CadenceDropCheck2, 10, seed, 10, ChainLab.Timing.Burst).AimErrDeg100ms; n++;
                    }
                Ok("drop check 1.4: at 10 host stalls a second (reports queued, then released back to back) the burst-armed memory at least halves v1.3's tracking error, and v1.3 still beats no check",
                   v14 <= 0.5 * v13 && v13 < plain && Math.Abs(floor - jit) < 1e-12, $"no check {plain / n:0.0000} / v1.3 {v13 / n:0.0000} / v1.4 {v14 / n:0.0000} deg per 100 ms");
                double worst = 0; string where = "";
                foreach (var id in new[] { Goat.Id, "bo6og", "breakwide", "rivpsy" })
                    foreach (var sc in ChainLab.Scenarios)
                        foreach (var tm in new[] { ChainLab.Timing.Drop, ChainLab.Timing.Late })
                            for (int every = 3; every <= 17; every += 2)
                            {
                                var cp = cat.Find(id)!;
                                double a1 = ChainLab.Run(cp, Rig.From(cp), sc, ChainLab.Engine.CadenceDropCheck, 10, 1, every, tm).AimErrDeg100ms;
                                double a2 = ChainLab.Run(cp, Rig.From(cp), sc, ChainLab.Engine.CadenceDropCheck2, 10, 1, every, tm).AimErrDeg100ms;
                                if (a2 - a1 > worst) { worst = a2 - a1; where = $"{id} {sc.Name} {tm} every {every}"; }
                            }
                Ok("drop check 1.4: on the shipped drop / late grid it gives back at most 0.002 deg anywhere (the cost of a check that is armed more often, at a third of all reports dropped)",
                   worst <= 0.002, worst > 0 ? $"worst +{worst:0.0000} deg ({where})" : "never worse");

                // a late report at stroke start (check not armed) must not teach the memory half the true travel: the real
                // drop that follows is still priced as two reports
                var c = new CadenceCore { NominalHz = 360, DropCheck = 2, ClassicAccel = 0.01689, ClassicOffset = 40, ClassicCap = 3 };
                float x = 1000; const float step = 17;   // ~61 mm/s
                c.Filter(new Vector2(x, 0), DT);                       // the first report rebases onto the pen
                x += step; c.Filter(new Vector2(x, 0), DT);            // plain 1 - the check needs two before it is armed
                x += step; c.Filter(new Vector2(x, 0), 2 * DT);        // LATE single, check not armed: priced by dt, memory cleared
                int lateClass = c.LastGapClass;
                x += step; c.Filter(new Vector2(x, 0), 0.05);          // its queued follower: one report of travel
                int followClass = c.LastGapClass;
                x += step; c.Filter(new Vector2(x, 0), DT);            // plain
                x += 2 * step; c.Filter(new Vector2(x, 0), 2 * DT);    // a REAL drop: two reports of travel
                Ok("drop check 1.4: an unjudged long gap never teaches the memory (a late report at stroke start, its follower, then a real drop: the drop is still priced as two reports)",
                   lateClass == 4 && followClass == 1 && c.LastReports == 2 && c.LastGapClass == 3, $"classes {lateClass}/{followClass}/{c.LastGapClass}, drop priced as {c.LastReports} reports");
                Ok("drop check 1.4 is what an apply writes (DropCheck 2), and a rig with the burst memory off writes the v1.3 value",
                   OtdBridge.CadencePoints(goat, new Rig { Engine = "cadence" })["DropCheck"] == 2 && OtdBridge.CadencePoints(goat, new Rig { Engine = "cadence", DropBurst = false })["DropCheck"] == 1 &&
                   OtdBridge.CadencePoints(goat, new Rig { Engine = "cadence", DropCheck = false })["DropCheck"] == 0);
            }

            // ---- Pressure Focus ----
            {
                CadenceCore Mk(double depth) => new CadenceCore { NominalHz = 360, ClassicAccel = 0.01689, ClassicOffset = 40, ClassicCap = 3, FocusDepth = depth };
                var off = Mk(0); var on = Mk(0.25); var rnd = new Random(3);
                bool sameHover = true, offIgnoresPressure = true; float px = 500, py = 500; var plain = Mk(0);
                off.Filter(new Vector2(px, py), DT); on.Filter(new Vector2(px, py), DT); plain.Filter(new Vector2(px, py), DT);
                for (int i = 0; i < 2000; i++)
                {
                    px += (float)Math.Round(rnd.NextDouble() * 40 - 12); py += (float)Math.Round(rnd.NextDouble() * 10 - 5);
                    var a = off.Filter(new Vector2(px, py), DT, rnd.NextDouble()); var b = on.Filter(new Vector2(px, py), DT, 0); var p0 = plain.Filter(new Vector2(px, py), DT);
                    if (a != p0) offIgnoresPressure = false; if (b != p0) sameHover = false;
                }
                Ok("Pressure Focus off is the curve alone whatever the pressure, and ON it changes nothing while the tip is up (bit-identical positions over 2000 reports)", offIgnoresPressure && sameHover);
                // a steady 20 mm/s track (1:1 band): pressing to full removes exactly the depth, reached within the slew time, no step
                var f = Mk(0.25); float tx = 0; f.Filter(new Vector2(0, 0), DT); double lastOut = 0, maxStep = 0, prevGain = 1; int reached = -1;
                for (int i = 1; i <= 60; i++)
                {
                    tx += 6; var o = f.Filter(new Vector2(tx, 0), DT, 1.0);
                    double g = (o.X - lastOut) / 6.0; lastOut = o.X;
                    if (i > 1) maxStep = Math.Max(maxStep, Math.Abs(g - prevGain)); prevGain = g;
                    if (reached < 0 && Math.Abs(g - 0.75) < 1e-3) reached = i;
                }
                Ok("Pressure Focus: a full press removes exactly the depth (0.25 -> gain 0.75 in the 1:1 band), reached in about 30 ms, never in one step",
                   Math.Abs(prevGain - 0.75) < 1e-3 && reached >= 8 && reached <= 13 && maxStep < 0.04, $"gain {prevGain:0.000}, full after {reached} reports, largest step {maxStep:0.000}");
                f.Reset(); f.Filter(new Vector2(tx + 6, 0), DT, 1.0);
                Ok("Pressure Focus: half pressure is partial, below the start pressure it is off, and a lift clears it",
                   f.LastFocus < 0.2 && new Func<bool>(() => { var h = Mk(0.25); h.Filter(new Vector2(0, 0), DT); float q = 0; for (int i = 0; i < 40; i++) { q += 6; h.Filter(new Vector2(q, 0), DT, 0.3); } double lo = h.LastFocus; for (int i = 0; i < 40; i++) { q += 6; h.Filter(new Vector2(q, 0), DT, 0.6); } return lo == 0 && h.LastFocus > 0.3 && h.LastFocus < 0.7; })());
                var rF = new Rig { Engine = "cadence", FocusDepth = 0.25 }; var rRa = new Rig { FocusDepth = 0.25 }; var rBad = new Rig { Engine = "cadence", FocusDepth = 0.9 };
                var pts = OtdBridge.CadencePoints(goat, rF);
                Ok("Pressure Focus plan: depth, start and full pressure travel from the rig into the Cadence Lock plan and the core; it needs the Cadence Lock engine; a depth outside 5-50% is refused",
                   pts["FocusDepth"] == 0.25 && pts["FocusStart"] == 0.35 && pts["FocusFull"] == 0.85 && OtdBridge.CadenceCoreFor(goat, rF).FocusDepth == 0.25 &&
                   Experiments.Blocker(rF, goat) == null && Experiments.Blocker(rRa, goat) != null && Experiments.Blocker(rBad, goat) != null && OtdBridge.CadencePoints(goat, new Rig { Engine = "cadence" })["FocusDepth"] == 0);
            }

            // ---- plugin 1.4 modes: plan, gate, persistence ----
            {
                var r = new Rig { Engine = "cadence", RealtimeLane = 2, HandPrint = true, FocusDepth = 0.3 };
                var pts = OtdBridge.CadencePoints(goat, r);
                var rOld = r.Clone(); var noteOld = Experiments.Soften(rOld, goat, null, false);
                var rRa = new Rig { RealtimeLane = 1, HandPrint = true, FocusDepth = 0.3 }; var noteRa = Experiments.Soften(rRa, goat);
                var rOk = r.Clone(); var noteOk = Experiments.Soften(rOk, goat, null, true);
                Ok("1.4 modes: the Realtime Lane, the Hand Print and Pressure Focus are written into the Cadence Lock plan; an older installed plugin or the RawAccel engine drops them with a note instead of claiming them",
                   pts["RealtimeLane"] == 2 && pts["HandPrint"] == 1 && pts["FocusDepth"] == 0.3 &&
                   rOld.RealtimeLane == 0 && !rOld.HandPrint && rOld.FocusDepth == 0 && noteOld.Count == 1 && noteOld[0].Contains("older than 1.4") &&
                   rRa.RealtimeLane == 0 && !rRa.HandPrint && rRa.FocusDepth == 0 && noteRa.Count == 3 &&
                   rOk.RealtimeLane == 2 && rOk.HandPrint && rOk.FocusDepth == 0.3 && noteOk.Count == 0, string.Join(" | ", noteOld));
                string xp = Path.Combine(Path.GetTempPath(), "aimforge-selftest-xp14.txt");
                new Experiments.State { Intent = true, CarryMs = 35, Twin = false, Lane = 2, HandPrint = true, FocusDepth = 0.25 }.Save(xp);
                var ld = Experiments.State.Load(xp); File.WriteAllText(xp, "intent;40;twin"); var old = Experiments.State.Load(xp); File.WriteAllText(xp, "off;0;off;lane=9;hand=1;focus=3"); var clamp = Experiments.State.Load(xp); File.Delete(xp);
                var applied = new Rig(); ld.ApplyTo(applied);
                Ok("1.4 modes persist in xp.txt next to the older fields (the three-field file of 2026-09 still loads; out-of-range values are clamped) and reach the rig",
                   ld.Intent && ld.CarryMs == 35 && ld.Lane == 2 && ld.HandPrint && ld.FocusDepth == 0.25 && old.Intent && old.Twin && old.Lane == 0 && !old.HandPrint && old.FocusDepth == 0 &&
                   clamp.Lane == 2 && clamp.FocusDepth == Experiments.MaxFocus && applied.RealtimeLane == 2 && applied.HandPrint && applied.FocusDepth == 0.25);
                Ok("1.4 modes are part of what makes two applies different, and read in the player's words (Realtime Lane, Hand Print, Pressure Focus)",
                   BuildState.Modes(r).Contains("REALTIME LANE 2") && BuildState.Modes(r).Contains("HAND PRINT REC") && BuildState.Modes(r).Contains("FOCUS 30%") &&
                   BuildState.PendingChanges(goat, new Rig { Engine = "cadence" }, default, goat, r, default).SequenceEqual(new[] { "Realtime Lane", "Hand Print", "Pressure Focus" }),
                   string.Join(", ", BuildState.PendingChanges(goat, new Rig { Engine = "cadence" }, default, goat, r, default)));
            }

            // ---- the Doctor's rows for the 1.4 modes ----
            {
                var live = Doctor.LaneRow(2, "High"); var notYet = Doctor.LaneRow(1, "Normal"); var off = Doctor.LaneRow(0, "Normal"); var stale = Doctor.LaneRow(0, "High"); var unknown = Doctor.LaneRow(1, null);
                Ok("doctor, realtime lane: live only when Windows reports the daemon at the priority the lane sets; ON with a Normal-priority daemon is a WARN with the fix; off is OK and says when the daemon is still raised",
                   live.Level == "OK" && live.Detail.Contains("live") && notYet.Level == "WARN" && notYet.Fix.Contains("move the pen once") && off.Level == "OK" && stale.Level == "OK" && stale.Detail.Contains("still runs at High") &&
                   unknown.Level == "WARN" && Doctor.LaneRow(1, "AboveNormal").Level == "OK" && Doctor.LaneRow(2, "AboveNormal").Level == "WARN");
                Ok("doctor, plugin 1.4 and hand print: an older plugin is a WARN that names what is skipped and how to install; recording ON with nothing written yet is a WARN, enough on record says so",
                   Doctor.Plugin14Row(true).Level == "OK" && Doctor.Plugin14Row(false).Level == "WARN" && Doctor.Plugin14Row(false).Fix.Contains("1.4") && Doctor.Plugin14Row(null).Level == "WARN" &&
                   Doctor.HandPrintRow(true, 0, 0, 0).Level == "WARN" && Doctor.HandPrintRow(true, 2, 14.2, 900).Detail.Contains("enough for MY HAND") && Doctor.HandPrintRow(false, 1, 3, 100).Detail.Contains("needs 10 min") &&
                   Doctor.HandPrintRow(false, 0, 0, 0).Level == "OK");
            }

            // ---- the dials ----
            {
                var d = Dials.Of(goat)!.Value; var (a, off, cap) = Dials.Goat.Classic(57);
                var faster = new Dials(40, 3, 190, Goat.Cm / 1.08).ToPreset(goat, "t", "T");
                double K = cat.games.First(g => g.id == "finals").K;
                Ok("dials: THE GOAT reads 1:1 to 40 mm/s, 3.0x by 190 mm/s, 52.63 cm/360, and those dials give back its exact classic numbers (0.2963 / 2.28 / 3.0)",
                   Math.Abs(d.Band - 40) < 1e-9 && d.Cap == 3 && Math.Abs(d.CapAt - 190) < 0.5 && d.Cm == Goat.Cm && a == Goat.Accel && off == Goat.Offset && cap == Goat.Cap, d.ToString());
                Ok("dials: a different base speed is carried by the output multiplier, so the in-game sensitivity the card prints does not change (GOAT base 8% faster still reads Finals 12.00)",
                   Math.Abs(Curve.SensFor(K, Rig.From(faster), Rig.From(faster).Mult) - 12.0) < 0.01 && Math.Abs(faster.cm - Goat.Cm / 1.08) < 1e-9 && Math.Abs((faster.adv.mult ?? 1) - 1.08) < 1e-3 &&
                   faster.snap == 0 && faster.Yx == 1.0 && faster.adv.reset == 20 && RolePolicy.ApplyBlockers(faster).Count == 0,
                   $"sens {Curve.SensFor(K, Rig.From(faster), Rig.From(faster).Mult):0.000}, mult {faster.adv.mult}");
                Ok("dials: every classic card describes itself against the GOAT in the player's words; a LUT card has no dials",
                   Dials.Goat.Versus(Dials.Goat) == "the same build as the GOAT" && new Dials(50, 3.5, 150, Goat.Cm).Versus(Dials.Goat).Contains("1:1 band wider: 50 mm/s (+10)") &&
                   new Dials(50, 3.5, 150, Goat.Cm).Versus(Dials.Goat).Contains("arm power up") && new Dials(50, 3.5, 150, Goat.Cm).Versus(Dials.Goat).Contains("full power sooner") &&
                   Dials.Of(cat.Find("feather")!) == null && cat.presets.Where(p => !p.IsLut).All(p => Dials.Of(p) is Dials x && x.IsValid));
            }

            // ---- the Hand Print recorder ----
            {
                var hp = new HandPrintCore(); double x = 100, y = 80;
                void Rep(double dx, double dy, bool tip = false) { x += dx; y += dy; double v = Math.Sqrt(dx * dx + dy * dy) / DT * 1000; hp.Tick(dx, dy, 1, DT, v, 1.0, tip, x, y, 0); }
                void Rest(int n) { for (int i = 0; i < n; i++) Rep(0, 0); }
                void Flick(double travel, int steps, double sx) { for (int i = 1; i <= steps; i++) { double q0 = (double)(i - 1) / steps, q1 = (double)i / steps; double P(double q) => q * q * q * (10 - 15 * q + 6 * q * q); Rep(sx * travel * (P(q1) - P(q0)), 0); } }
                Rest(20); Flick(40, 54, +1); Rest(30); Flick(40, 54, -1); Rest(30); Flick(20, 36, +1); Rest(30);
                // a strafe that turns around without stopping: two strokes
                for (int i = 0; i < 60; i++) Rep(0.1, 0, true); for (int i = 0; i < 60; i++) Rep(-0.1, 0, true); Rest(10);
                for (int i = 0; i < 30; i++) Rep(0.1, 0); hp.Break(true);
                var e = hp.Ep;
                Ok("hand print recorder: three flicks, a strafe that turns around and a stroke cut by a lift are six strokes, each with its travel, duration and peak (min-jerk peak = 1.875 x mean)",
                   hp.EpTotal == 6 && Math.Abs(e[0].TravelMm - 40) < 0.5 && Math.Abs(e[2].TravelMm - 20) < 0.5 && Math.Abs(e[0].PeakMms - 1.875 * 40 / (54 * DT) * 1000) / e[0].PeakMms < 0.03 &&
                   e[0].End == (byte)'s' && e[3].End == (byte)'r' && e[4].End == (byte)'s' && e[5].End == (byte)'l' && e[3].TipFrac == 1 && e[0].TipFrac == 0 && Math.Abs(e[3].TravelMm - 6) < 0.2 && hp.Lifts == 1,
                   $"{hp.EpTotal} strokes: " + string.Join(" ", Enumerable.Range(0, (int)hp.EpTotal).Select(i => $"{e[i].TravelMm:0.0}mm/{e[i].DurMs:0}ms/{(char)e[i].End}")));
                Ok("hand print recorder: every second of pen time lands in exactly one speed bin (hover or tip), the bins are 4 per octave, and the snapshot is a detached copy",
                   Math.Abs(hp.SecHover.Sum() + hp.SecTip.Sum() - hp.Seconds) < 1e-9 && Math.Abs(hp.Heat.Sum() - hp.Seconds) < 1e-9 && HandPrintCore.BinOf(0.5) == 0 && HandPrintCore.BinOf(1) == 1 && HandPrintCore.BinOf(2) == 5 &&
                   HandPrintCore.BinOf(1e6) == HandPrintCore.Bins - 1 && Math.Abs(HandPrintCore.BinLo(5) - 2) < 1e-12 &&
                   new Func<bool>(() => { var s = hp.Snapshot(); long before = s.Reports; Rep(1, 0); return s.Reports == before && hp.Reports == before + 1; })());
                var parsed = new HandPrint(); parsed.AddFile(hp.Serialize("session t\nnominalHz 360\ncurve classic 0.01689 40 3 2")); parsed.AddFile(hp.Serialize("session t2\nnominalHz 360\ncurve classic 0.01689 40 3 2"));
                bool refused = false; try { new HandPrint().AddFile("something else\n"); } catch (InvalidDataException) { refused = true; }
                Ok("hand print file: what the recorder writes is what the app reads (totals, bins, strokes), two sessions add up, and a file that is not a hand print is refused",
                   parsed.Files == 2 && parsed.Episodes.Count == 2 * hp.EpCount && Math.Abs(parsed.Seconds - 2 * hp.Seconds) < 0.01 && parsed.Lifts == 2 * hp.Lifts &&
                   Math.Abs(parsed.SecTip.Sum() - 2 * hp.SecTip.Sum()) < 0.01 && Math.Abs(parsed.Episodes[0].TravelMm - e[0].TravelMm) < 0.01 && parsed.Curves.Count == 2 && refused);
            }

            // ---- Hand Print analysis + the optimizer ----
            {
                Func<double, double> g = OtdBridge.CadenceCoreFor(goat, new Rig { Engine = "cadence", PxMm = 57 }).GainAt;
                bool inverse = new[] { 5.0, 39, 60, 150, 400, 900 }.All(v => Math.Abs(HandPrint.SpeedForOutRate(g, g(v) * v) - v) < 1e-6 * Math.Max(1, v));
                HandPrint Hand(HandPrint.SynthSpec s, Preset? on = null) { var h = new HandPrint(); h.AddFile(HandPrint.Synthetic(on ?? goat, s)); return h; }
                var fits = Hand(new HandPrint.SynthSpec());                                                       // tracks at 28 mm/s, flicks peak 420
                var rampTracker = Hand(new HandPrint.SynthSpec { TrackMms = 75, Seed = 7 });                       // fires while tracking at 75 mm/s: on the GOAT's ramp
                var slowFlicker = Hand(new HandPrint.SynthSpec { FlickPeakMms = 150, FlickOutMm = 60, Seed = 9 }); // flicks that never reach 190 mm/s
                var zFit = HandPrint.Zones(fits.OutSecTip, g, 40, 190); var zRamp = HandPrint.Zones(rampTracker.OutSecTip, g, 40, 190);
                Ok("hand print analysis: the output-rate view inverts back to hand speed exactly; a hand that fires while tracking at 28 mm/s lives in the GOAT's 1:1 band, one that tracks at 75 mm/s lives on its ramp",
                   inverse && zFit.unity > 0.9 && zRamp.ramp > 0.8 && fits.Sufficient, $"firing time in 1:1 {zFit.unity:0.00} vs on the ramp {zRamp.ramp:0.00}");
                var r0 = Optimizer.Run(new HandPrint());
                var rFit = Optimizer.Run(fits); var rRamp = Optimizer.Run(rampTracker); var rSlow = Optimizer.Run(slowFlicker);
                Ok("optimizer: THE GOAT scores exactly 1.000 on any hand (every term is a ratio to its own), and with no recording at all nothing beats it (no evidence, no change)",
                   Math.Abs(rFit.Goat.Score - 1) < 1e-12 && Math.Abs(rRamp.Goat.Score - 1) < 1e-12 && !r0.Recommend && r0.Best.D.Band == 40 && r0.Best.D.Cap == 3 && r0.Best.D.CapAt == 190,
                   $"empty recording -> {r0.Best.D}");
                Ok("optimizer: a hand that fires while tracking at 75 mm/s gets a wider 1:1 band that takes that speed off the ramp (firing elasticity falls); a hand whose flicks peak near 150 mm/s gets full power sooner so they reach the cap",
                   rRamp.Recommend && rRamp.Best.D.Band >= 70 && rRamp.Best.T.FireE < 0.7 * rRamp.Goat.T.FireE &&
                   rSlow.Recommend && rSlow.Best.D.CapAt < 190 && rSlow.Best.T.StrokeE < rSlow.Goat.T.StrokeE,
                   $"ramp-tracker -> {rRamp.Best.D} (firing elasticity {rRamp.Goat.T.FireE:0.000} -> {rRamp.Best.T.FireE:0.000}); slow flicker -> {rSlow.Best.D}");
                var ch = Optimizer.Challenger(rRamp, goat)!; var few = Hand(new HandPrint.SynthSpec { Minutes = 2, TrackMms = 75 });
                Ok("optimizer: the challenger is an importable build on the GOAT's rig (same base, snap 0, Y/X 1.00, reset 20, no filters, zero apply blockers), and a two-minute recording never produces one",
                   ch.id == "myhand" && ch.cm == goat.cm && ch.snap == 0 && ch.Yx == 1.0 && ch.adv.reset == 20 && ch.cohOv == null && !ch.IsLut && RolePolicy.ApplyBlockers(ch).Count == 0 &&
                   Dials.Of(ch) is Dials cd && Math.Abs(cd.Band - rRamp.Best.D.Band) < 0.1 && !few.Sufficient && !Optimizer.Run(few).Recommend && Optimizer.Challenger(Optimizer.Run(few), goat) == null);
                Ok("optimizer: the style moves the answer the way it says (precision never raises the mean gain while firing above the balanced pick; speed never needs more arm travel)",
                   Optimizer.Run(rampTracker, "precision").Best.T.Precision <= rRamp.Best.T.Precision + 1e-9 && Optimizer.Run(rampTracker, "speed").Best.T.Effort <= rRamp.Best.T.Effort + 1e-9);
                Ok("hand print report: names the recording, the timing health, where the hand lives on the card and its strokes",
                   fits.Report(goat).Contains("HAND PRINT - 12.0 min") && fits.Report(goat).Contains("firing:") && fits.Report(goat).Contains("flicks: peak speed") && fits.Report(goat).Contains("Timing under load") &&
                   Optimizer.Report(rRamp).Contains("CHALLENGER") && Optimizer.Report(r0).Contains("not enough recording"));
            }

            // ---- the duel ladder ----
            {
                var d = new Duel(); var t0 = new DateTime(2026, 11, 12, 20, 0, 0);
                var c1 = d.Challenger()!.Value;
                bool oneDial = c1.Band == 50 && c1.Cap == 3 && c1.CapAt == 190 && c1.Cm == Goat.Cm && d.ChampionIsGoat && ReferenceEquals(d.ChampionPreset(goat), goat);
                d.Answer("champion", "", t0); var c2 = d.Challenger()!.Value;                   // other direction
                d.Answer("champion", "", t0); var c3 = d.Challenger()!.Value;                   // both lost: band step halves, on to the cap speed
                d.Answer("challenger", "", t0); var c4 = d.Challenger()!.Value;                 // new champion, same dial keeps going
                Ok("duel ladder: starts at THE GOAT; a challenger moves exactly one dial; a loss tries the other direction, two losses halve the step and move on; a win makes the challenger champion and keeps the dial moving",
                   oneDial && c2.Band == 30 && c3.Band == 40 && c3.CapAt == 230 && d.State["band"].Step == 5 && d.Champion.CapAt == 230 && c4.CapAt == 270 && !d.ChampionIsGoat && d.Wins == 1,
                   $"{c1} | {c2} | {c3} | {c4}");
                string path = Path.Combine(Path.GetTempPath(), "aimforge-selftest-duel.json"); d.Save(path); var back = Duel.Load(path); File.Delete(path);
                var champP = d.ChampionPreset(goat); var chalP = d.ChallengerPreset(goat)!;
                Ok("duel ladder: the state survives a restart; champion and challenger are separate builds on the GOAT's rig (the GOAT card is never changed) with zero apply blockers",
                   back.Champion.CapAt == 230 && back.History.Count == 3 && back.CurrentDial == d.CurrentDial && back.State["band"].Step == 5 &&
                   champP.id == "duel-champion" && chalP.id == "duel-challenger" && goat.adv.accel == Goat.Accel && RolePolicy.ApplyBlockers(champP).Count == 0 && RolePolicy.ApplyBlockers(chalP).Count == 0 &&
                   Dials.Of(chalP) is Dials cd && Math.Abs(cd.CapAt - 270) < 1);
                d.Answer("same", "", t0);
                var ev = System.Text.Json.Nodes.JsonNode.Parse(d.EvidenceJson())!;
                Ok("duel ladder: 'cannot tell' settles that dial; every answer is kept as a field-verdict evidence record",
                   d.State["onset"].Settled && d.CurrentDial == "power" && ev["evidenceId"]!.GetValue<string>() == "ev-20261112-duel" && ev["rounds"]!.AsArray().Count == 4 && ev["kind"]!.GetValue<string>().StartsWith("field verdicts"));
                int guard = 0; while (!d.Finished && guard++ < 200) d.Answer("champion", "", t0);
                Ok("duel ladder: it always ends (every dial settles once its step is under the smallest worth feeling), and then says so",
                   d.Finished && d.Challenger() == null && guard < 60 && d.Describe().Contains("finished") && d.Answer("champion") == "the ladder is finished", $"{guard} more rounds");
                var seeded = new Duel(); seeded.SeedFrom(new Dials(40, 3, 130, Goat.Cm));
                Ok("duel ladder: seeded by the optimizer it starts with the dial the optimizer moved most, in that direction",
                   seeded.CurrentDial == "onset" && seeded.Challenger()!.Value.CapAt == 150 && new Duel().CurrentDial == "band");
            }
        }
    }
}
