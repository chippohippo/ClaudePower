using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using AimForge.Core;

namespace AimForge.App
{
    /// <summary>
    /// Headless commands of the 2026-11-12 overhaul (the optimizer, the Hand Print, the duel ladder, the burst lab).
    /// Program.Main asks this first; null = not one of ours.
    /// </summary>
    /// What the first-party report-path code costs (2026-11-12): measured, not argued.
    static class PathCost
    {
        /// Nanoseconds and allocated bytes per report for the Cadence Lock core on a realistic stream (strokes, tracking,
        /// rests, late and queued reports), optionally with the Hand Print recorder ticking after it.
        public static (double ns, long bytes) Core(Preset card, bool handPrint, int reports = 1_000_000)
        {
            var rg = Rig.From(card); rg.Engine = "cadence"; rg.ReportHz = 360;
            var core = OtdBridge.CadenceCoreFor(card, rg); var hp = new AimForge.Filters.HandPrintCore();
            const double DT = 1000.0 / 360.0;
            // a fixed pseudo-random stream, generated BEFORE the clock starts
            var rnd = new Random(42); var xs = new float[4096]; var ys = new float[4096]; var dts = new double[4096]; var ps = new double[4096];
            double x = 15000, y = 8000, v = 0;
            for (int i = 0; i < xs.Length; i++)
            {
                if (i % 180 == 0) v = rnd.NextDouble() < 0.3 ? 0 : Math.Exp(rnd.NextDouble() * 6.5);   // 0 or 1-665 mm/s
                double a = i * 0.01; x += Math.Cos(a) * v * DT / 10.0; y += Math.Sin(a) * v * DT / 10.0;
                xs[i] = (float)Math.Round(x); ys[i] = (float)Math.Round(y);
                dts[i] = i % 97 == 0 ? 2 * DT : i % 97 == 1 ? 0.05 : DT * (0.95 + 0.1 * rnd.NextDouble()); ps[i] = i % 360 < 120 ? 0.6 : 0;
            }
            double sink = 0;
            void Loop(int n)
            {
                var prev = new System.Numerics.Vector2(xs[0], ys[0]);
                for (int i = 0; i < n; i++)
                {
                    int k = i & 4095; var pos = new System.Numerics.Vector2(xs[k], ys[k]);
                    var o = core.Filter(pos, dts[k], ps[k]); sink += o.X;
                    if (handPrint) hp.Tick((pos.X - prev.X) * 0.01, (pos.Y - prev.Y) * 0.01, core.LastReports, DT, core.LastSpeedMms, core.LastGain, ps[k] > 0, pos.X * 0.01, pos.Y * 0.01, core.LastGapClass);
                    prev = pos;
                }
            }
            Loop(50_000);   // JIT and caches
            var sw = System.Diagnostics.Stopwatch.StartNew(); long b0 = GC.GetAllocatedBytesForCurrentThread();
            Loop(reports);
            sw.Stop(); long bytes = GC.GetAllocatedBytesForCurrentThread() - b0;
            GC.KeepAlive(sink);
            return (sw.Elapsed.TotalMilliseconds * 1e6 / reports, bytes);
        }
    }

    static class OverhaulCli
    {
        public static int? Handle(string cmd, string[] args, Catalogue cat, string home, OtdBridge otd)
        {
            switch (cmd)
            {
                case "--burst-lab":
                {
                    // Drop Check v1.3 (memory wiped by every non-plain gap) against v1.4 (armed through queued bursts):
                    //   1. the shipped Drop / Late grid - v1.4 must not give back what v1.3 won;
                    //   2. host stalls that queue reports (Timing.Burst) at 2-60 stalls a second.
                    var ids = new[] { "goat", "bo6og", "breakpoint", "breakwide", "rivpsy", "owsol", "valmp", "apxmp" }.Where(id => cat.Find(id) != null).ToArray();
                    int better = 0, same = 0, worse = 0; double worstUp = 0; string worstWhere = "";
                    foreach (var id in ids)
                    {
                        var cp = cat.Find(id)!;
                        foreach (var sc in ChainLab.Scenarios)
                            foreach (var tm in new[] { ChainLab.Timing.Drop, ChainLab.Timing.Late })
                                for (int every = 3; every <= 17; every++)
                                    foreach (int seed in new[] { 1, 2, 3 })
                                    {
                                        double a1 = ChainLab.Run(cp, Rig.From(cp), sc, ChainLab.Engine.CadenceDropCheck, 10, seed, every, tm).AimErrDeg100ms;
                                        double a2 = ChainLab.Run(cp, Rig.From(cp), sc, ChainLab.Engine.CadenceDropCheck2, 10, seed, every, tm).AimErrDeg100ms;
                                        if (Math.Abs(a2 - a1) < 1e-9) same++; else if (a2 < a1) better++; else { worse++; if (a2 - a1 > worstUp) { worstUp = a2 - a1; worstWhere = $"{id} {sc.Name} {tm} every {every} seed {seed}: {a1:0.0000} -> {a2:0.0000}"; } }
                                    }
                    }
                    Console.WriteLine($"Drop/Late grid, v1.4 vs v1.3: {better} better, {same} same, {worse} worse" + (worse > 0 ? $"; worst regression +{worstUp:0.0000} deg ({worstWhere})" : ""));
                    Console.WriteLine("host stalls that queue reports (aim error per 100 ms, degrees; mean over cards x scenarios x 3 seeds):");
                    Console.WriteLine($"  {"stalls/s",8} {"no check",9} {"v1.3",8} {"v1.4",8}   v1.4 worse-than-v1.3 rows");
                    foreach (int rate in new[] { 0, 2, 5, 10, 20, 30, 60 })
                    {
                        double s0 = 0, s1 = 0, s2 = 0; int nrow = 0, w = 0;
                        foreach (var id in ids)
                        {
                            var cp = cat.Find(id)!;
                            foreach (var sc in ChainLab.Scenarios)
                                foreach (int seed in new[] { 1, 2, 3 })
                                {
                                    double a0 = ChainLab.Run(cp, Rig.From(cp), sc, ChainLab.Engine.Cadence, 10, seed, rate, ChainLab.Timing.Burst).AimErrDeg100ms;
                                    double a1 = ChainLab.Run(cp, Rig.From(cp), sc, ChainLab.Engine.CadenceDropCheck, 10, seed, rate, ChainLab.Timing.Burst).AimErrDeg100ms;
                                    double a2 = ChainLab.Run(cp, Rig.From(cp), sc, ChainLab.Engine.CadenceDropCheck2, 10, seed, rate, ChainLab.Timing.Burst).AimErrDeg100ms;
                                    s0 += a0; s1 += a1; s2 += a2; nrow++; if (a2 > a1 + 1e-9) w++;
                                }
                        }
                        Console.WriteLine(FormattableString.Invariant($"  {rate,8} {s0 / nrow,9:0.0000} {s1 / nrow,8:0.0000} {s2 / nrow,8:0.0000}   {w} of {nrow}"));
                    }
                    return 0;
                }
                case "--path-cost":
                {
                    // What the code AimForge owns costs on the pen's report path: nanoseconds a report and bytes allocated,
                    // for the Cadence Lock core alone and with the Hand Print recorder ticking.
                    var (ns, bytes) = PathCost.Core(cat.Find(Goat.Id)!, false); var (nsH, bytesH) = PathCost.Core(cat.Find(Goat.Id)!, true);
                    double interval = 1e9 / 360.0;
                    Console.WriteLine(FormattableString.Invariant($"Cadence Lock core (THE GOAT, drop check 2): {ns:0} ns a report, {bytes} bytes allocated  = {ns / interval * 100:0.0000}% of the pen's 2.78 ms report interval"));
                    Console.WriteLine(FormattableString.Invariant($"  with the Hand Print recorder:           {nsH:0} ns a report, {bytesH} bytes allocated  = {nsH / interval * 100:0.0000}% of the interval"));
                    Console.WriteLine("The app itself (this program) is not on the report path: it writes the settings and exits the picture.");
                    return 0;
                }
                case "--handprint":
                case "--optimize":
                {
                    // --handprint [dir|file] [--demo] [--card id]     what the recorder saw, against a card (default: goat)
                    // --optimize  [dir|file] [--demo] [--style balanced|consistency|precision|speed] [--save]
                    //   --demo plays a synthetic hand through the real recorder (no tablet needed); --save writes myhand-build.json
                    var pos = args.Skip(1).Where(a => !a.StartsWith("--")).ToList();
                    string Opt(string name, string dflt) { int i = Array.IndexOf(args, name); return i >= 0 && i + 1 < args.Length ? args[i + 1] : dflt; }
                    var card = cat.Find(Opt("--card", Goat.Id)) ?? cat.Find(Goat.Id)!;
                    if (pos.Contains(card.id)) pos.Remove(card.id);
                    string style = Opt("--style", "balanced"); if (pos.Contains(style)) pos.Remove(style);
                    HandPrint? hp;
                    if (args.Contains("--demo")) { hp = new HandPrint(); hp.AddFile(HandPrint.Synthetic(card, new HandPrint.SynthSpec())); }
                    else
                    {
                        string where = pos.Count > 0 ? pos[0] : otd.Dir;
                        if (File.Exists(where)) { hp = new HandPrint(); hp.AddFile(File.ReadAllText(where)); }
                        else hp = HandPrint.LoadDir(where);
                        if (hp == null)
                        {
                            Console.WriteLine($"no hand print yet in {where}: tick 'Hand Print' on the Engine tab (Cadence Lock engine, plugin 1.4), apply, and play. The recorder writes handprint-*.txt there on a lift, at most every 30 s.");
                            return 2;
                        }
                    }
                    Console.Write(hp.Report(card));
                    if (cmd == "--optimize")
                    {
                        var r = Optimizer.Run(hp, style);
                        Console.Write(Optimizer.Report(r));
                        var goatCard = cat.Find(Goat.Id)!;
                        if (Optimizer.Challenger(r, goatCard) is Preset ch && args.Contains("--save"))
                        {
                            string path = Path.Combine(home, "myhand-build.json");
                            File.WriteAllText(path, System.Text.Json.JsonSerializer.Serialize(ch, new System.Text.Json.JsonSerializerOptions { WriteIndented = true }));
                            Console.WriteLine("challenger written: " + path + "  (IMPORT it in the window, or run --duel seed to start the ladder from it)");
                        }
                    }
                    return 0;
                }
                case "--duel":
                {
                    // --duel [status] | answer challenger|champion|same [note] | seed (from the optimizer) | reset | export
                    string sub = args.Length > 1 ? args[1].ToLowerInvariant() : "status";
                    var goatCard = cat.Find(Goat.Id)!;
                    var d = Duel.Load();
                    switch (sub)
                    {
                        case "reset": d = new Duel(); d.Save(); Console.WriteLine("duel ladder reset: the champion is THE GOAT again"); break;
                        case "seed":
                        {
                            var hp = HandPrint.LoadDir(otd.Dir);
                            if (hp == null || !hp.Sufficient) { Console.WriteLine("no sufficient hand print to seed from (10 min, 400 strokes) - the ladder keeps its default order"); break; }
                            var r = Optimizer.Run(hp);
                            if (!r.Recommend) { Console.WriteLine("the optimizer finds nothing clearly better than the GOAT on your hand - the ladder keeps its default order"); break; }
                            d.SeedFrom(r.Best.D); d.Save(); Console.WriteLine("ladder seeded from the optimizer: " + r.Best.D.Versus(Dials.Goat));
                            break;
                        }
                        case "answer":
                        {
                            if (args.Length < 3) { Console.WriteLine("--duel answer challenger|champion|same [note]"); return 2; }
                            Console.WriteLine(d.Answer(args[2].ToLowerInvariant(), args.Length > 3 ? string.Join(" ", args.Skip(3)) : ""));
                            d.Save();
                            if (d.History.Count > 0) { Directory.CreateDirectory(RolePolicy.EvidenceDir); File.WriteAllText(Path.Combine(RolePolicy.EvidenceDir, d.EvidenceId + ".json"), d.EvidenceJson()); }
                            break;
                        }
                        case "export":
                        {
                            var opts = new System.Text.Json.JsonSerializerOptions { WriteIndented = true };
                            File.WriteAllText(Path.Combine(home, "duel-champion-build.json"), System.Text.Json.JsonSerializer.Serialize(d.ChampionPreset(goatCard), opts));
                            if (d.ChallengerPreset(goatCard) is Preset c) File.WriteAllText(Path.Combine(home, "duel-challenger-build.json"), System.Text.Json.JsonSerializer.Serialize(c, opts));
                            Console.WriteLine("written: duel-champion-build.json, duel-challenger-build.json (IMPORT them in the window)");
                            break;
                        }
                    }
                    Console.WriteLine(d.Describe());
                    return 0;
                }
            }
            return null;
        }
    }
}
