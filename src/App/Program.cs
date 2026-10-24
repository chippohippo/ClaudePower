using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Windows.Forms;
using AimForge.Core;

namespace AimForge.App
{
    static class Program
    {
        sealed class Config
        {
            public string rawAccelDir { get; set; } = @"D:\RawAccel";
            public string otdDir { get; set; } = @"D:\Pen";
            public string otdDataDir { get; set; } = @"D:\Pen\userdata";
        }

        [STAThread]
        static int Main(string[] args)
        {
            string home = AppContext.BaseDirectory;
            var cfgPath = Path.Combine(home, "aimforge.config.json");
            var cfg = File.Exists(cfgPath) ? JsonSerializer.Deserialize<Config>(File.ReadAllText(cfgPath)) ?? new Config() : new Config();
            var cat = Catalogue.Load(Path.Combine(home, "presets.json"));
            var ra = new RawAccelBridge(cfg.rawAccelDir);
            var otd = new OtdBridge(cfg.otdDir, cfg.otdDataDir);
            string tuner = Path.Combine(home, "tuner.html");

            // ---- headless modes, so the whole pipeline is scriptable and testable ----
            if (args.Length > 0)
            {
                string cmd = args[0].ToLowerInvariant();
                bool dry = args.Contains("--dry-run");
                Action<string> log = s => Console.WriteLine(s);
                switch (cmd)
                {
                    case "--list":
                        foreach (var p in cat.presets)
                        {
                            var rig = Rig.From(p);
                            string lut = p.IsLut ? Curve.RawAccelPoints(p.lut!, rig.PxMm) : "(classic)";
                            Console.WriteLine($"{p.id,-14} {p.name,-18} {p.group,-36} {(p.RunsFilter ? "[filter]" : "[pure]  ")} {lut}");
                        }
                        return 0;
                    case "--doctor":
                        int bad = 0; foreach (var i in Doctor.Run(ra, otd, cat)) { Console.WriteLine(i); if (!i.Ok) bad++; }
                        return bad;
                    case "--apply":
                        {
                            var p = cat.Find(args.Length > 1 ? args[1] : "") ?? throw new ArgumentException("unknown preset id");
                            var rig = Rig.From(p);
                            int ei = Array.IndexOf(args, "--engine");
                            if (ei >= 0 && ei + 1 < args.Length) rig.Engine = args[ei + 1].ToLowerInvariant();
                            if (rig.Engine != "rawaccel" && rig.Engine != "cadence") throw new ArgumentException("--engine rawaccel|cadence");
                            int hi = Array.IndexOf(args, "--pen-hz"); if (hi >= 0 && hi + 1 < args.Length) rig.ReportHz = double.Parse(args[hi + 1], System.Globalization.CultureInfo.InvariantCulture);
                            int mi = Array.IndexOf(args, "--merge-cap"); if (mi >= 0 && mi + 1 < args.Length) rig.MergeMax = double.Parse(args[mi + 1], System.Globalization.CultureInfo.InvariantCulture);
                            int dci = Array.IndexOf(args, "--drop-check"); if (dci >= 0 && dci + 1 < args.Length) rig.DropCheck = args[dci + 1] != "off";
                            // mouse mirror: a persisted MODE (mouse.txt). Flags change it for THIS apply and are
                            // saved only after a successful non-dry apply (review 2026-09-14).
                            var mst = Core.MouseMirror.State.Load(); var ci = System.Globalization.CultureInfo.InvariantCulture;
                            int mo = Array.IndexOf(args, "--mouse"); if (mo >= 0 && mo + 1 < args.Length) mst.On = args[mo + 1].Equals("on", StringComparison.OrdinalIgnoreCase);
                            int md = Array.IndexOf(args, "--mouse-dpi"); if (md >= 0 && md + 1 < args.Length) mst.Dpi = double.Parse(args[md + 1], ci);
                            int mh = Array.IndexOf(args, "--mouse-halflife"); if (mh >= 0 && mh + 1 < args.Length) mst.HalfLifeMs = double.Parse(args[mh + 1], ci);
                            int my = Array.IndexOf(args, "--mouse-yx"); if (my >= 0 && my + 1 < args.Length) mst.Yx = args[my + 1].Equals("pen", StringComparison.OrdinalIgnoreCase) ? (double?)null : double.Parse(args[my + 1], ci);
                            int mpx = Array.IndexOf(args, "--mouse-prefixes"); if (mpx >= 0 && mpx + 1 < args.Length) mst.Prefixes = args[mpx + 1].Split('|');
                            if (!(mst.Dpi >= 100 && mst.Dpi <= 30000)) { Console.WriteLine($"--mouse-dpi {mst.Dpi} is outside 100-30000"); return 2; }
                            if (!(mst.HalfLifeMs >= 0 && mst.HalfLifeMs <= 10)) { Console.WriteLine($"--mouse-halflife {mst.HalfLifeMs} is outside 0-10 ms"); return 2; }
                            if (mst.Yx is double yxv && !(yxv > 0 && yxv <= 1.5)) { Console.WriteLine($"--mouse-yx {yxv} is outside (0, 1.5]"); return 2; }
                            if (mst.On && mst.Prefixes.Length == 0) { mst.Prefixes = Core.MouseMirror.DiscoverPrefixes(ra.ReadRoot()); Console.WriteLine("mouse: allowlist discovered from RawAccel's device list: " + string.Join(", ", mst.Prefixes) + (dry ? " (dry run - not saved)" : "")); }
                            mst.ApplyTo(rig);
                            // experimental Cadence Lock modes (xp.txt): flags change them for THIS apply, saved after a real apply
                            var xps = Core.Experiments.State.Load();
                            bool? OnOff(string flag)
                            {
                                int i = Array.IndexOf(args, flag); if (i < 0) return null;
                                if (i + 1 >= args.Length || !(args[i + 1] is "on" or "off")) throw new ArgumentException($"{flag} takes on|off");
                                return args[i + 1] == "on";
                            }
                            try
                            {
                                if (OnOff("--intent") is bool iv) xps.Intent = iv;
                                if (OnOff("--twin") is bool tv) xps.Twin = tv;
                                int xc = Array.IndexOf(args, "--carry");
                                if (xc >= 0)
                                {
                                    if (xc + 1 >= args.Length) throw new ArgumentException("--carry takes off or 10-80 (ms)");
                                    if (args[xc + 1] == "off") xps.CarryMs = 0;
                                    else if (double.TryParse(args[xc + 1], System.Globalization.NumberStyles.Float, ci, out var cv) && double.IsFinite(cv) && cv >= Core.Experiments.MinCarryMs && cv <= Core.Experiments.MaxCarryMs) xps.CarryMs = cv;
                                    else throw new ArgumentException($"--carry {args[xc + 1]}: use off or {Core.Experiments.MinCarryMs}-{Core.Experiments.MaxCarryMs} (ms)");
                                }
                            }
                            catch (ArgumentException ae) { Console.WriteLine(ae.Message); return 2; }
                            xps.ApplyTo(rig);
                            // third-person match (tps.txt; --tps on|off overrides it for this apply and is saved on success)
                            var tpsS = Core.ThirdPerson.State.Load();
                            try { if (OnOff("--tps") is bool tpv) tpsS.On = tpv; } catch (ArgumentException ae) { Console.WriteLine(ae.Message); return 2; }
                            Core.ThirdPerson.ApplyTo(rig, p, tpsS);
                            foreach (var sk in Core.Experiments.Soften(rig, p, otd.NibBlocker(rig))) Console.WriteLine("note: " + sk);
                            if (rig.TpsGain != 1.0) log("third-person match: " + Core.ThirdPerson.Describe(tpsS, p));
                            if (Core.Experiments.Any(rig)) log("experimental: " + Core.Experiments.Describe(rig) + " (Cadence Lock modes; field verdicts pending)");
                            // the SAME gate as the GUI (2026-09-16 audit), before anything is written
                            var (gBlock, gWarn) = Core.RolePolicy.GateForApply(p, cat.tablet, () => Core.FilterCatalog.Discover(otd), rig, otd.CadenceBlocker(rig, p), Core.OtdBridge.HoverBlocker(rig), Core.Experiments.Blocker(rig, p), otd.NibBlocker(rig), ra.PenDeviceBlocker());
                            foreach (var w in gWarn) Console.WriteLine("plan: " + w);
                            foreach (var b in gBlock) Console.WriteLine((dry ? "would refuse: " : "refused: ") + b);
                            if (gBlock.Count > 0 && !dry) return 2;
                            string bak = ra.Apply(p, rig, dry, log);
                            bool otdOk;
                            try { otdOk = otd.Apply(p, rig, dry, log); }
                            catch { if (!dry && bak.Length > 0) { log("OTD half threw - rolling RawAccel back"); ra.RestoreBackup(bak, log); } throw; }
                            if (!otdOk && !dry)
                            {
                                // cross-driver rollback (2026-09-16 review): never the curve in both places or in neither
                                if (bak.Length > 0) ra.RestoreBackup(bak, log);
                                Console.WriteLine("the OTD half did not take" + (otd.LastFailure != null ? " (" + otd.LastFailure + ")" : "") + " - RawAccel was rolled back to the build before this apply");
                                return 1;
                            }
                            if (!dry) { try { xps.Save(); tpsS.Save(); } catch { } Core.LastApply.From(p, rig).Save(); }
                            if (!dry) { mst.LastCardId = p.id; mst.LastPxMm = rig.PxMm; mst.LastMult = rig.Mult; mst.Save(); }
                            return 0;
                        }
                    case "--mouse":
                    {
                        // --mouse on | off: MOUSE ONLY. Never touches the pen profile or OTD (review 2026-09-14:
                        // the old path re-applied the pen with the default engine and double-accelerated
                        // a Cadence Lock rig). The mode is saved only after the change is verified.
                        var mst = Core.MouseMirror.State.Load();
                        string sw = args.Length > 1 ? args[1].ToLowerInvariant() : "";
                        if (sw == "off") { ra.MirrorOff(log); mst.On = false; mst.Save(); Core.LastApply.NoteMouse(mst); return 0; }
                        if (sw != "on") { Console.WriteLine("usage: --mouse on|off"); return 2; }
                        var lastCard = mst.LastCardId.Length > 0 ? cat.Find(mst.LastCardId) : null;
                        if (lastCard == null) { Console.WriteLine("mouse mirror: no applied card on record - run --apply <id> --mouse on once"); return 2; }
                        // mirror the pen AS IT IS LIVE (px/mm from OTD; multiplier, Y/X and snap from RawAccel), curve from the last applied card
                        var mr = Rig.From(lastCard);
                        var penNow = ra.ReadLive(); mr.Mult = penNow.OutputDpi / 1000.0; mr.Yx = penNow.Yx; mr.SnapDeg = penNow.SnapDeg;
                        try { var ol = otd.ReadLive(); if (ol.PxMm > 0) mr.PxMm = ol.PxMm; } catch { }
                        var want = new Core.MouseMirror.State { On = true, Dpi = mst.Dpi, HalfLifeMs = mst.HalfLifeMs, Yx = mst.Yx, LastCardId = mst.LastCardId,
                            Prefixes = mst.Prefixes.Length > 0 ? mst.Prefixes : Core.MouseMirror.DiscoverPrefixes(ra.ReadRoot()) };
                        want.ApplyTo(mr);
                        ra.MirrorOn(lastCard, mr, log);
                        if (!ra.LastMirrorApplied) { Console.WriteLine("mouse mirror refused - mode unchanged"); return 1; }
                        want.LastPxMm = mr.PxMm; want.LastMult = mr.Mult; want.Save(); Core.LastApply.NoteMouse(want);
                        return 0;
                    }
                    case "--mouse-devices":
                    {
                        // diagnostic: how every RawAccel device entry is classified, and what is live
                        var root = ra.ReadRoot(); var mst = Core.MouseMirror.State.Load();
                        var pref = mst.Prefixes.Length > 0 ? mst.Prefixes : Core.MouseMirror.DiscoverPrefixes(root);
                        Console.WriteLine("allowlist: " + (pref.Length == 0 ? "(empty)" : string.Join(" | ", pref)) + (mst.Prefixes.Length == 0 ? "   (discovered, not yet saved)" : ""));
                        foreach (var c in Core.MouseMirror.Classify(root, pref))
                            Console.WriteLine($"  {c.Status,-9} {c.Name,-24} {c.Id}   profile '{c.Entry!["profile"]?.ToString() ?? ""}'  disable {c.Entry["config"]?["disable"]?.ToString() ?? "(no config)"}");
                        var ml = Core.MouseMirror.Read(root);
                        Console.WriteLine(ml.Exists ? $"live: '{Core.MouseMirror.Reserved}' {ml.Mode}, Output DPI {ml.OutputDpi}, Y/X {ml.Yx}, snap {ml.SnapDeg}, speed EMA {ml.HalfIn} ms, bound {ml.Bound.Count}, last={ml.IsLast}" : "live: no mouse profile (mouse raw)");
                        if (ml.Dangling.Count > 0) Console.WriteLine("DANGLING: " + string.Join("; ", ml.Dangling));
                        Console.WriteLine($"mode: {(mst.On ? "on" : "off")}  dpi {mst.Dpi}  EMA {mst.HalfLifeMs}  last card {mst.LastCardId}");
                        return 0;
                    }
                    case "--audit":
                    {
                        // 2026-09-16: machine-readable dump of every card's RECOMPUTED numbers - the
                        // cross-check surface for card copy, role policy and QC. Read-only; writes one
                        // JSON file and nothing else. `--audit [path]` (default <home>\audit.json).
                        var aTab = cat.tablet;
                        var aRows = cat.presets.Select(p =>
                        {
                            var rg = Rig.From(p);
                            var lut = Curve.EffectiveLut(p, rg.PxMm);
                            var m = Measure.Run(lut, rg, aTab);
                            var sum = Curve.Summary(lut, aTab);
                            double a = p.adv.accel ?? 0, off = p.adv.offset ?? 0, cp = p.adv.cap ?? 1;
                            return new
                            {
                                p.id, p.name, p.group, p.tag, p.field,
                                role = Core.RolePolicy.RoleOf(p), tier = Core.RolePolicy.PlanTier(p), buildTier = Core.FilterCatalog.BuildTier(p),
                                filterGame = Core.FilterCatalog.GameOfGroup(p.group), gameId = Core.FilterCatalog.GameIdOf(p.group),
                                p.pxmm, p.cm, p.snap, yx = p.Yx, p.hdlMax, resetMs = p.ResetMs,
                                kind = p.IsLut ? "lut" : "classic", accel = p.adv.accel, cap = p.adv.cap, offsetCms = p.adv.offset, mult = p.adv.mult,
                                unityUntilMms = p.IsLut ? (double?)null : off * 1000 / p.pxmm,
                                capAtMms = Curve.CapSpeedMms(p),
                                lutPoints = p.lut?.Length,
                                gain = new
                                {
                                    floorAtUnitStep = sum.floor, twoUnitStep = sum.twoUnit, tap37 = sum.tap, track120 = sum.track, max = sum.cap,
                                    at15 = Curve.GainAt(lut, 15), at30 = Curve.GainAt(lut, 30), at60 = Curve.GainAt(lut, 60),
                                    at150 = Curve.GainAt(lut, 150), at300 = Curve.GainAt(lut, 300), at532 = Curve.GainAt(lut, 532)
                                },
                                measured = new
                                {
                                    holdPct = m.HoldPct, micro3Pct = m.Micro3Pct, deadMs = m.DeadMs, skidMm = m.SkidMm, turn180Mm = m.Turn180Mm,
                                    spreadDefaultPct = Measure.FlickSpreadPct(lut, rg, aTab),
                                    spreadCommittedPct = Measure.FlickSpreadPct(lut, rg, aTab, 90, 120, 150)
                                },
                                sens = cat.games.ToDictionary(g => g.id, g => Math.Round(Curve.SensFor(g.K, rg), 4)),
                                // the bare curve above; THROUGH the card's shipping game filters here (the Coherence Stabilizer is not simulated)
                                measuredPlan = Core.PlanFilters.Factory(p) is Func<AimForge.Filters.GameFilterCore[]> chain && Measure.Run(lut, rg, aTab, chain) is Measured mp
                                    ? new { holdPct = mp.HoldPct, micro3Pct = mp.Micro3Pct, deadMs = mp.DeadMs, skidMm = mp.SkidMm, through = Core.PlanFilters.Enabled(p).Select(f => f.id).ToArray() }
                                    : null,
                                stabilizerSimulated = false,
                                cohOv = p.cohOv,
                                filters = (p.filters ?? new System.Collections.Generic.List<FilterSpec>()).Select(f => new { f.id, f.on, f.settings }).ToArray(),
                                qc = new
                                {
                                    curve = Curve.Check(p, aTab).ToArray(),
                                    blockers = Core.RolePolicy.ApplyBlockers(p).ToArray(),
                                    warnings = Core.RolePolicy.Check(p).Where(c => c.StartsWith("warn:")).ToArray(),
                                    copy = Core.CopyContract.Violations(p, cat.presets.Select(q => q.name), aTab).ToArray()
                                },
                                desc = p.desc
                            };
                        }).ToArray();
                        string aPath = args.Length > 1 ? args[1] : Path.Combine(home, "audit.json");
                        var aOpts = new System.Text.Json.JsonSerializerOptions { WriteIndented = true, NumberHandling = System.Text.Json.Serialization.JsonNumberHandling.AllowNamedFloatingPointLiterals };
                        File.WriteAllText(aPath, System.Text.Json.JsonSerializer.Serialize(new { generated = cat.generated, tablet = aTab, games = cat.games, presets = aRows }, aOpts));
                        Console.WriteLine($"audit -> {aPath}  ({aRows.Length} cards, {aRows.Count(r => r.qc.blockers.Length + r.qc.curve.Length > 0)} with QC findings)");
                        return 0;
                    }
                    case "--calib360":
                        {
                            // --calib360 <game> --yaw <deg/count>            | the game's own yaw (Source 2: m_yaw)
                            // --calib360 <game> --card <id> --pen-mm <mm> [--turns n] [--sens s]   | a measured slow turn
                            // [--write]: patch tuner.html's GAMES row + write the evidence record. Never touches a driver or presets.json.
                            string? Val(string f) { int i = Array.IndexOf(args, f); return i >= 0 && i + 1 < args.Length ? args[i + 1] : null; }
                            double? Num(string f) => Val(f) is string v && double.TryParse(v, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var d) ? d : null;
                            var g = args.Length > 1 ? cat.games.FirstOrDefault(x => x.id == args[1]) : null;
                            if (g == null) { Console.WriteLine("usage: --calib360 <game> (--yaw <deg/count> | --card <id> --pen-mm <mm> [--turns n] [--sens s]) [--write]\ngames: " + string.Join(", ", cat.games.Select(x => x.id + (x.fovEstimated || x.note.Contains("ESTIMATED") ? " (K estimated)" : "")))); return 2; }
                            Core.Calib360.Result r;
                            try
                            {
                                if (Num("--yaw") is double yaw) r = Core.Calib360.FromYaw(g.id, g.K, yaw);
                                else if (Val("--card") is string cid && cat.Find(cid) is Preset cp && Num("--pen-mm") is double mm)
                                {
                                    var crg = Rig.From(cp); double printed = Curve.SensFor(g.K, crg, crg.Mult);
                                    double band = Core.Calib360.UnityBandMmS(cp, crg.PxMm);
                                    Console.WriteLine($"sweep bound: stay under {band:0.0} mm/s on the glass (the card's 1:1 band) - about {crg.Cm360 * 10 / Math.Max(band, 0.1):0} s for one turn at {crg.Cm360:0.00} cm/360");
                                    r = Core.Calib360.FromTurn(g.id, g.K, mm, Num("--turns") ?? 1, Num("--sens") ?? Math.Round(printed, 3), crg.PxMm, crg.Mult, crg.Cm360);
                                }
                                else { Console.WriteLine("give --yaw, or --card <id> --pen-mm <mm>"); return 2; }
                            }
                            catch (ArgumentException ae) { Console.WriteLine(ae.Message); return 2; }
                            Console.WriteLine(r.Summary);
                            if (!args.Contains("--write")) { Console.WriteLine("(dry: add --write to patch tuner.html and record the evidence)"); return 0; }
                            var when = DateTime.Now; string evId = Core.Calib360.EvidenceId(g.id, when);
                            File.WriteAllText(tuner, Core.Calib360.PatchTuner(File.ReadAllText(tuner), r, evId));
                            string evDir = Path.Combine(home, "evidence"); Directory.CreateDirectory(evDir);
                            File.WriteAllText(Path.Combine(evDir, evId + ".json"), Core.Calib360.EvidenceJson(r, evId, when, Val("--note")));
                            Console.WriteLine($"tuner.html patched ({g.id} K), evidence -> evidence\\{evId}.json. Now run: node export-presets.js tuner.html");
                            return 0;
                        }
                    case "--measure":
                        foreach (var p in cat.presets)
                        {
                            var mrg = Rig.From(p);
                            Console.WriteLine($"{p.id,-12} {p.name,-24} {Measure.Run(Curve.EffectiveLut(p, mrg.PxMm), mrg, cat.tablet)}");
                        }
                        return 0;
                    case "--screenshot":
                        return Screenshot(args, home, cat, ra, otd, tuner);
                    case "--daemon-start":
                        // Login helper: GUI-subsystem exe = no console flash. Make sure the daemon
                        // is up (it detects the tablet on startup) and exit.
                        otd.EnsureDaemon(_ => { }, 15000);
                        return otd.DaemonRunning() ? 0 : 1;
                    case "--redetect":
                        return otd.Redetect(log) ? 0 : 1;
                    case "--xp-lab":
                    case "--xp-evidence":
                    {
                        // the experimental Cadence Lock modes measured on a card (default bo6og); --xp-evidence also mints the artifact
                        string xpId = args.Length > 1 && !args[1].StartsWith("--") ? args[1] : "bo6og";
                        var xpc = cat.Find(xpId);
                        if (xpc == null) { Console.WriteLine($"unknown card id '{xpId}' (see --list)"); return 2; }
                        var xr = Core.XpLab.Run(xpc, Rig.From(xpc));
                        string F(double[] a) => string.Join(" / ", a.Select(x => x.ToString("0.00", System.Globalization.CultureInfo.InvariantCulture)));
                        Console.WriteLine($"card {xpc.id}");
                        Console.WriteLine($"A ramp-track gain noise % at {F(xr.TrackMms)} mm/s:  off {F(xr.GainNoiseOffPct)}   intent {F(xr.GainNoiseIntentPct)}");
                        Console.WriteLine($"B micro travel mm: hand {xr.MicroHandMm:0.000}  off {xr.MicroOffMm:0.000}  intent {xr.MicroIntentMm:0.000}  carry {xr.MicroCarryMm:0.000}");
                        Console.WriteLine($"C flick 40mm at {F(xr.FlickMs)} ms -> out mm: off {F(xr.FlickOffMm)}   intent {F(xr.FlickIntentMm)}");
                        Console.WriteLine($"D 90deg turn at 60mm/s, max gain step: off {xr.TurnMaxGainStepOff:0.0000}  intent {xr.TurnMaxGainStepIntent:0.0000}");
                        Console.WriteLine($"E strafe new-leg 40ms: mean gain off {xr.ReversalGainOff:0.000} carry {xr.ReversalGainCarry:0.000}; travel mm off {xr.ReversalTravelOffMm:0.00} carry {xr.ReversalTravelCarryMm:0.00}");
                        Console.WriteLine($"F flick then 1.5mm correction, output mm: off {xr.OvershootCorrOffMm:0.000} carry {xr.OvershootCorrCarryMm:0.000}");
                        if (args[0] == "--xp-evidence")
                        {
                            string xpPath = Path.Combine(Core.RolePolicy.EvidenceDir, "ev-20260924-xp-toggles.json");
                            File.WriteAllText(xpPath, JsonSerializer.Serialize(new
                            {
                                evidenceId = "ev-20260924-xp-toggles", date = "2026-09-24", card = xpc.id,
                                claim = "Intent Speed lowers per-report ramp-tracking gain noise ~3x without touching micro-aim, and (clamped to one lattice unit per report) keeps a turn's gain step within 1.25x plain and a track's trail under 0.4 mm; Reversal Carry adds gain to the first 40 ms of a strafe leg (strafe rhythm only: a stop-and-settle, rest tremor, a gapped stroke and a flick from rest never arm it - pinned in the selftest)",
                                revised = "2026-09-24 after an adversarial review: the first version's carry armed on settles, rest tremor, small-flick corrections and across gaps, and Intent Speed trailed a fast track by up to 1.2 mm; both fixed and re-measured here",
                                method = "XpLab.Run: the SHIPPING CadenceCore at 360 Hz on the 0.01 mm lattice; A 45-degree tracks at 15-60 mm/s with +/-0.01 mm orthogonal tremor (gain std vs the true-speed gain); B one-unit rest tremor + 1.1 mm/s creep for 3 s; C 40 mm minimum-jerk flicks at 100/150/200 ms; D a 90-degree turn in a 60 mm/s track; E 30 mm p-p strafe at 1.5 Hz; F a 40 mm/100 ms flick then a 1.5 mm correction at 20 mm/s",
                                results = xr, fieldVerdict = "pending"
                            }, new JsonSerializerOptions { WriteIndented = true, IncludeFields = true }));
                            Console.WriteLine("evidence -> " + xpPath);
                        }
                        return 0;
                    }
                    case "--nib-lab":
                    case "--nib-evidence":
                    {
                        // Nib Twin and the moving-tap fade, measured on the SHIPPING pin + Cadence core (MODEL skid until calibrated)
                        string nid = args.Length > 1 && !args[1].StartsWith("--") ? args[1] : "bo6og";
                        var nc = cat.Find(nid); if (nc == null) { Console.WriteLine($"unknown card id '{nid}' (see --list)"); return 2; }
                        var cfgs = new[]
                        {
                            new Core.NibLab.Config { Name = "legacy pin (30/0.9)", Pin = true, PinFade = 0 },
                            new Core.NibLab.Config { Name = "fade pin (the moving-tap fix)", Pin = true, PinFade = 1 },
                            new Core.NibLab.Config { Name = "fade pin + NIB TWIN", Pin = true, PinFade = 1, Twin = true },
                            new Core.NibLab.Config { Name = "no pin, no twin", Pin = false },
                        };
                        var rows = cfgs.Select(c => (c, s: Core.NibLab.Score(nc, c))).ToList();
                        var inv = System.Globalization.CultureInfo.InvariantCulture;
                        Console.WriteLine($"card {nc.id} ({nc.cm} cm/360) - error in degrees vs the hand's own aim through the same curve");
                        Console.WriteLine($"{"config",-32} {"rest@click",10} {"restPeak",9} {"restResid",9} {"skidPeak",9} {"skidEnd",8} {"spray150",9} {"sprayAfter",10} {"flick@clk",9} {"follow",8}  moving taps @30/60/100/141 mm/s (both directions): permanent | pin's own cost (no swing)");
                        foreach (var (c, s) in rows)
                            Console.WriteLine(string.Format(inv, "{0,-32} {1,10:0.000} {2,9:0.000} {3,9:0.000} {4,9:0.000} {5,8:0.000} {6,9:0.000} {7,10:0.000} {8,9:0.000} {9,8:0.000}  {10} | {11}", c.Name, s.RestAtClick, s.RestPeak, s.RestResidual, s.RestSkidPeak, s.RestSkidEnd, s.SprayFirst150, s.SprayAfterRelease, s.FlickShotAtClick, s.FlickShotFollow,
                                string.Join(" / ", s.MovePermanent.Select(x => x.ToString("0.000", inv))), c.Twin ? "n/a" : string.Join(" / ", s.MovePinCost.Select(x => x.ToString("0.000", inv)))));
                        Console.WriteLine("  (skidPeak/skidEnd: the rest one-tap's swing ALONE - out(swing) minus out(no swing) on the same seed; restPeak counts the pre-press approach as aim)");
                        var twin = cfgs[2];
                        var sweep = new (string n, Core.NibLab.Config c, double f)[]
                        {
                            ("calibration 0.6x", new Core.NibLab.Config { Pin = true, PinFade = 1, Twin = true, CalScale = 0.6 }, 1),
                            ("calibration 1.4x", new Core.NibLab.Config { Pin = true, PinFade = 1, Twin = true, CalScale = 1.4 }, 1),
                            ("calibration +25 deg", new Core.NibLab.Config { Pin = true, PinFade = 1, Twin = true, CalRotDeg = 25 }, 1),
                            ("calibration -25 deg", new Core.NibLab.Config { Pin = true, PinFade = 1, Twin = true, CalRotDeg = -25 }, 1),
                            ("tap force 0.5x", twin, 0.5), ("tap force 1.5x", twin, 1.5), ("tap force 2x", twin, 2.0),
                            ("fade pin, force 2x (no twin)", cfgs[1], 2.0),
                        };
                        Console.WriteLine("robustness (spray first 150 ms / rest skid peak):");
                        var sw = sweep.Select(x => (x.n, s: Core.NibLab.Score(nc, x.c, x.f, 3))).ToList();
                        // a swing that trails the pressure by 2 reports, calibrated by the SHIPPING fit from a model press log
                        var lagFit = Core.NibFit.Fit(Core.NibLab.ModelLog(20, Core.NibLab.SkidMm, 143.1, 5, lag: 2));
                        if (lagFit.Cal != null)
                        {
                            sw.Add(("swing lag 2, fitted cal", Core.NibLab.Score(nc, new Core.NibLab.Config { Pin = true, PinFade = 1, Twin = true, SwingLag = 2, Cal = lagFit.Cal }, 1, 3)));
                            sw.Add(("swing lag 2, no twin", Core.NibLab.Score(nc, new Core.NibLab.Config { Pin = true, PinFade = 1, SwingLag = 2 }, 1, 3)));
                        }
                        var fitCal = Core.NibFit.Fit(Core.NibLab.ModelLog(20, Core.NibLab.SkidMm, 143.1, 5)).Cal;
                        if (fitCal != null) sw.Add(("fitted cal (lag 0)", Core.NibLab.Score(nc, new Core.NibLab.Config { Pin = true, PinFade = 1, Twin = true, Cal = fitCal }, 1, 3)));
                        sw.Add(("fade pin, approach 0.35 mm (no twin)", Core.NibLab.Score(nc, cfgs[1], 1, 3, 0.35)));
                        sw.Add(("legacy pin, approach 0.35 mm", Core.NibLab.Score(nc, cfgs[0], 1, 3, 0.35)));
                        sw.Add(("legacy pin, force 2x", Core.NibLab.Score(nc, cfgs[0], 2, 3)));
                        foreach (var (n, s) in sw) Console.WriteLine(string.Format(inv, "  {0,-36} {1:0.000} / {2:0.000}", n, s.SprayFirst150, s.RestSkidPeak));
                        if (args[0] == "--nib-evidence")
                        {
                            string np = Path.Combine(Core.RolePolicy.EvidenceDir, "ev-20260924-nib-twin.json");
                            File.WriteAllText(np, JsonSerializer.Serialize(new
                            {
                                evidenceId = "ev-20260924-nib-twin", date = "2026-09-24", card = nc.id, basis = "MODEL skid (tapdiag): 0.30 mm toward (-0.8, 0.6), saturating at 30% pressure, 12 ms press, 18 ms release, 15% flexion residual, click at 2%; replace with a --nib-calibrate log before a field claim",
                                claim = "Nib Twin removes the pressure-locked nib swing from shots fired while moving; the moving-tap fade removes the pin's over-priced hand-back; rest one-taps keep the pin",
                                method = "NibLab.Score: hand + modelled swing on the 0.01 mm lattice at 360 Hz -> SHIPPING CoherenceCore pin -> SHIPPING CadenceCore (curve + twin); error vs the hand's own aim through the same curve, degrees at the card's cm/360; 6 seeds; rest one-tap, 30 mm 1.5 Hz strafing spray held 400 ms, 40 mm/150 ms flick-shot + follow-up, taps while moving at 30/60/100/141 mm/s with no swing",
                                results = rows.Select(r => new { config = r.c.Name, r.s.RestAtClick, r.s.RestPeak, r.s.RestResidual, r.s.RestSkidPeak, r.s.RestSkidEnd, r.s.SprayFirst150, r.s.SprayAfterRelease, r.s.FlickShotAtClick, r.s.FlickShotFollow, movePermanent = r.s.MovePermanent, movePinCostNoSwing = r.s.MovePinCost, moveSpeeds = Core.NibLab.MoveSpeeds }),
                                robustness = sw.Select(r => new { r.n, r.s.SprayFirst150, r.s.RestSkidPeak, r.s.RestPeak }),
                                revised = "2026-09-24/25 reviews 2-4: rest taps also scored on the swing alone against a flexion-only reference (RestSkidPeak/End); moving taps averaged over both travel directions; the fade pin classifies a tap by the hand's speed BEFORE the press (band 12-30 mm/s); the pin hands back only the offset frozen when its hold ends and breaks at the earlier of a press-position test and a rewind-plus-mechanics budget; the fit fits the knee and judges R2 on rows with a real predicted swing; the twin removes the swing across stalls, merged frames and lifts; lag-2 swing physics with the fitted calibration included",
                                fieldVerdict = "pending"
                            }, new JsonSerializerOptions { WriteIndented = true }));
                            Console.WriteLine("evidence -> " + np);
                        }
                        return 0;
                    }
                    case "--nib-trace":
                    {
                        var tc = cat.Find(args.Length > 1 ? args[1] : "bo6og") ?? cat.Find("bo6og")!;
                        bool tw = args.Contains("twin");
                        foreach (var l in Core.NibLab.TraceRest(tc, new Core.NibLab.Config { Pin = !args.Contains("nopin"), PinFade = 1, Twin = tw })) Console.WriteLine(l);
                        return 0;
                    }
                    case "--nib-fit":
                    {
                        // offline: fit a press log (default: the daemon's nibtwin-probe.txt); --save writes nibtwin.json
                        string lf = args.Length > 1 && !args[1].StartsWith("--") ? args[1] : Core.NibCalibrator.ProbeLog(otd);
                        if (!File.Exists(lf)) { Console.WriteLine("no press log at " + lf); return 2; }
                        var fr = Core.NibFit.Fit(File.ReadAllLines(lf), 1.0 / cat.tablet.unitMm, lf);
                        Console.WriteLine(fr.Report.Length > 0 ? fr.Report : "(no fit)");
                        Console.WriteLine(fr.Refused == null ? "calibration VALID" : "calibration REFUSED: " + fr.Refused);
                        if (fr.Cal != null && fr.Refused == null && args.Contains("--save")) { fr.Cal.Save(); Console.WriteLine("saved -> " + Core.NibCal.DefaultPath); }
                        return fr.Refused == null ? 0 : 1;
                    }
                    case "--nib-calibrate":
                    {
                        // interactive, on the LIVE build (lastapply.json, whole): calibration build -> the user taps -> fit ->
                        // save -> the live build re-applied (2026-09-24 review: the old CLI rebuilt the rig lossily from the card)
                        var la = Core.LastApply.Load();
                        var (lcard, _, why) = Core.NibCalibrator.LiveBuild(la);
                        if (lcard == null) { Console.WriteLine("not calibrated: " + why); return 2; }
                        if (args.Length > 1 && !args[1].StartsWith("--") && args[1] != la!.CardId)
                        { Console.WriteLine($"not calibrated: the live build is '{la.CardId}', not '{args[1]}' - the calibration runs on what is live; apply {args[1]} first"); return 2; }
                        // Ctrl+C cancels the wait instead of killing the process, so the press log is always switched off
                        bool cancelled = false;
                        ConsoleCancelEventHandler onCancel = (s, e) => { e.Cancel = true; cancelled = true; Console.WriteLine("\n(cancelling - switching the press log off)"); };
                        Console.CancelKeyPress += onCancel;
                        Core.NibFit.Result res;
                        try
                        {
                            res = Core.NibCalibrator.Run(ra, otd, cat.tablet, () =>
                            {
                                Console.WriteLine("\nHold the pen still in hover and TAP the tip about 20 times (one tap a second). Press Enter when done (or type c + Enter / Ctrl+C to cancel).");
                                string? line = Console.ReadLine();
                                return !cancelled && line != null && !line.Trim().Equals("c", StringComparison.OrdinalIgnoreCase);
                            }, log, 1.0 / cat.tablet.unitMm, la);
                        }
                        finally { Console.CancelKeyPress -= onCancel; }
                        Console.WriteLine(res.Refused != null ? "not calibrated: " + res.Refused
                            : res.Restored?.NibTwin == true ? "calibrated: the live twin now uses the new calibration"
                            : "calibrated: tick Nib twin in the Builds tab (or --apply <id> --twin on)");
                        return res.Refused == null ? 0 : 1;
                    }
                    case "--split-hazard":
                        foreach (var hp in cat.presets)
                            if (BuildState.SplitHazardMmS(hp, hp.pxmm) is double sp)
                                Console.WriteLine($"{hp.id,-10} {hp.name,-26} {hp.pxmm} px/mm: VMulti splits above {sp:0} mm/s while the curve still changes - RawAccel engine misprices faster flicks");
                        return 0;
                    case "--lattice-lab":
                    {
                        // RawAccel engine: a finer count lattice (OTD px/mm x N, RawAccel multiplier / N) - same sens, same physics
                        foreach (var id in args.Skip(1).DefaultIfEmpty("bo6og"))
                        {
                            var cp = cat.Find(id); if (cp == null) continue;
                            foreach (double jt in new[] { 0.0, 10 })
                                foreach (double lx in new[] { 1.0, 1.5, 2, 3, 4 })
                                {
                                    var parts = Core.ChainLab.Scenarios.Select(sc => Core.ChainLab.Run(cp, Rig.From(cp), sc, Core.ChainLab.Engine.Wall, jt, 11, 0, Core.ChainLab.Timing.Late, lx)).ToArray();
                                    Console.WriteLine(System.FormattableString.Invariant($"{id,-9} jitter {jt,2}%  lattice x{lx,-3} ({Rig.From(cp).PxMm * lx,5:0} px/mm, split above {127 * 360 / (Rig.From(cp).PxMm * lx),4:0} mm/s):  ") +
                                        string.Join("  ", parts.Select(r => System.FormattableString.Invariant($"{r.Scenario.Split(' ')[0]} {r.AimErrDeg100ms:0.0000}°"))) + $"  splits {parts.Sum(r => r.SplitPackets)}");
                                }
                        }
                        return 0;
                    }
                    case "--onset-lab":
                    {
                        // read-only: how fast a flick from rest is delivered on the user's live build, per engine option.
                        // Cadence core fed a 0.01 mm-lattice pen at 360 Hz (no jitter); delivered output vs the ideal (hand x true gain)
                        // at 5/10/20/40 ms after motion starts, and the ms until 90% of the ideal travel is out.
                        var cp = cat.Find(args.Length > 1 ? args[1] : "breakwide")!;
                        foreach (var (name, intent, drop) in new[] { ("v1.2 core", false, false), ("v1.2 + Intent", true, false), ("1.3 drop check", false, true), ("1.3 + Intent (your xp.txt)", true, true) })
                        {
                            var rg = Rig.From(cp); rg.Engine = "cadence"; rg.ReportHz = 360; rg.MergeMax = 5; rg.IntentSpeed = intent; rg.DropCheck = drop;
                            var core = Core.OtdBridge.CadenceCoreFor(cp, rg);
                            var lut = Curve.EffectiveLut(cp, rg.PxMm);
                            Func<double, double> g = cp.IsLut ? v => Curve.GainAt(lut, v) : v => Curve.ClassicGain(v * rg.PxMm / 1000.0, cp.adv.accel ?? 0, cp.adv.offset ?? 0, cp.adv.cap ?? 1);
                            foreach (var (fl, T, A) in new[] { ("flick 40mm/120ms", 0.12, 40.0), ("flick 15mm/100ms", 0.10, 15.0), ("tap-correct 2mm/80ms", 0.08, 2.0) })
                            {
                                var c = Core.OtdBridge.CadenceCoreFor(cp, rg); double DT = 1000.0 / 360; double prevU = 0, ideal = 0; var o0 = c.Filter(new System.Numerics.Vector2(0, 0), DT);
                                for (int i = 0; i < 72; i++) c.Filter(new System.Numerics.Vector2(0, 0), DT);   // 200 ms at rest
                                var outs = new List<(double t, double d, double id)>(); var oPrev = c.Filter(new System.Numerics.Vector2(0, 0), DT);
                                double delivered = 0;
                                for (int i = 1; i <= 90; i++)
                                {
                                    double t = i * DT / 1000.0, s = Math.Min(1, t / T), x = A * (10 * s * s * s - 15 * s * s * s * s + 6 * s * s * s * s * s);
                                    double u = Math.Round(x * 100); double du = u - prevU; prevU = u;
                                    double v = Math.Abs(du) / 100 / DT * 1000; ideal += du * (du == 0 ? 1 : g(v));
                                    var o = c.Filter(new System.Numerics.Vector2((float)u, 0), DT); delivered += o.X - oPrev.X; oPrev = o;
                                    outs.Add((i * DT, delivered, ideal));
                                }
                                string At(double ms) { var r = outs.First(z => z.t >= ms); return r.id > 0 ? $"{100 * r.d / r.id,5:0}%" : "  -  "; }
                                double fin = outs[^1].id; var t90 = outs.FirstOrDefault(z => z.d >= 0.9 * fin).t; var i90 = outs.FirstOrDefault(z => z.id >= 0.9 * fin).t;
                                Console.WriteLine(System.FormattableString.Invariant($"{name,-28} {fl,-22} delivered vs ideal @5ms {At(5)} @10ms {At(10)} @20ms {At(20)} @40ms {At(40)}   90% at {t90,5:0.0} ms (ideal {i90,5:0.0})  final {100 * outs[^1].d / fin:0.0}%"));
                            }
                        }
                        return 0;
                    }
                    case "--copy-numbers":
                    {
                        // --copy-numbers <id...>: the numbers a card's copy may quote (the copy contract's own recomputation)
                        foreach (var id in args.Skip(1))
                        {
                            var mp = cat.Find(id); if (mp == null) { Console.WriteLine(id + ": unknown"); continue; }
                            var mrg = Rig.From(mp); var mlut = Curve.EffectiveLut(mp, mrg.PxMm); var mm = Measure.Run(mlut, mrg, cat.tablet);
                            Console.WriteLine(System.FormattableString.Invariant($"{id}: 180 {mm.Turn180Mm:0.0} mm | committed spread {Measure.FlickSpreadPct(mlut, mrg, cat.tablet, 90, 120, 150):0.0}% | lazy spread {Measure.FlickSpreadPct(mlut, mrg, cat.tablet):0.0}% | micro {mm.Micro3Pct:0}% | onset {mm.DeadMs:0.0} ms | tracking {Curve.Summary(mlut, cat.tablet).track:0.00}x | cap at {Curve.CapSpeedMms(mp) ?? 0:0} mm/s"));
                        }
                        return 0;
                    }
                    case "--goat-card":
                    {
                        // the GOAT's tuner entry, its copy generated from its own recomputed numbers
                        Console.WriteLine(Core.GameLab.GoatTunerEntry(cat.tablet));
                        return 0;
                    }
                    case "--game-lab":
                    {
                        // GameLab: re-derive a game family's roles on its own fights. --game-lab <game|all> [role] -> game-lab.txt (log),
                        // game-lab.cards.js (tuner entries), evidence\ev-20261023-game-<id>.json
                        string which = args.Length > 1 ? args[1] : "all"; string? onlyRole = args.Length > 2 ? args[2] : null;
                        var games = Core.GameLab.Games.Where(x => which == "all" || x.Id == which || x.Prefix == which).ToList();
                        if (games.Count == 0) { Console.WriteLine("games: " + string.Join(", ", Core.GameLab.Games.Select(x => x.Id))); return 2; }
                        var logSb = new System.Text.StringBuilder(); var js = new System.Text.StringBuilder();
                        foreach (var gg in games)
                        {
                            var picks = new List<Core.GameLab.Pick>(); var taken = new HashSet<(double, double?, double?, double?)>();
                            foreach (var role in Core.GameLab.Roles.Where(r => onlyRole == null || r == onlyRole))
                            {
                                var pk = Core.GameLab.Run(gg, role, cat, s => logSb.AppendLine(s), taken); picks.Add(pk); taken.Add(Core.GameLab.Key(pk.Card));
                                var c = pk.Card; var w = pk.O.Winner;
                                Console.WriteLine(System.FormattableString.Invariant($"{gg.Id,-9} {role,-10} cm {c.cm,5:0.0} accel {c.adv.accel,7:0.####} off {c.adv.offset,6:0.###} cap {c.adv.cap,4:0.0} capAt {Curve.CapSpeedMms(c),4:0} snap {c.snap,2:0} filter {(c.gameFilterOn ? "ON " : "off")} pin {(c.cohOv != null ? "yes" : "no ")}  180 {w.R.Turn180Mm,5:0.0}  rel {w.Rel:0.000} regret {w.Regret:0.000}  sens {w.R.Sens:0.000}"));
                                js.AppendLine(Core.GameLab.TunerEntry(c));
                            }
                            var ev = new
                            {
                                evidenceId = $"ev-20261024-game-{gg.Id}", date = "2026-10-24", baseline = new { card = Core.Goat.Id, Core.Goat.Cm, Core.Goat.Accel, Core.Goat.Offset, Core.Goat.Cap, Core.Goat.Snap, Core.Goat.Yx, Core.Goat.ResetMs, evidence = Core.Goat.EvidenceId }, game = gg.Name, proRange = new { median = gg.ProMed, lo = gg.ProLo, hi = gg.ProHi, source = gg.ProSource },
                                character = gg.Character, fights = gg.Fights.Select(f => new { f.s.Name, tag = f.t.ToString(), f.s.D, f.s.Lat, f.s.W, f.s.Proj, f.s.RecoilDegS, f.s.StepDeg, f.s.TargetR }).ToArray(),
                                method = "GameLab: HeroLab selection (phase 1 role-identity grid -> pool -> snap x the family's game filter -> five hand models, regret) on the game's fights re-weighted per role; cm/360 fixed per role as a ratio of the GOAT's 52.63 (Master/Tracker/Flick x1, Precision x1.15, Brawl x0.87, Signature its old ratio; Finals Fieldwide the sens-8 verdict); snap 0 and Y/X 1.00 everywhere (the GOAT verdict); the Master searches the GOAT's neighbourhood (1:1 to 30-60 mm/s, cap 2.5-4x by 150-230 mm/s, the GOAT curve included); legality: onset <= 2 reports, micro 90-130%, the role's 180 limit as a ratio of the GOAT's own 180, no report above 600 mm/s",
                                roles = picks.Select(pk => new
                                {
                                    pk.Role, card = pk.Card.id, pk.Card.name, pk.Card.cm, pk.Card.snap, pk.Card.adv.accel, pk.Card.adv.cap, pk.Card.adv.offset, gameFilter = pk.Card.gameFilterOn, tapAnchor = pk.Card.cohOv != null,
                                    winner = pk.O.Winner.C.Name, rel = pk.O.Winner.Rel, regret = pk.O.Winner.Regret, pk.O.Winner.R.Turn180Mm, pk.O.Winner.R.MicroPct, pk.O.Winner.R.DeadMs, pk.O.Winner.R.SkidMm,
                                    perScenario = pk.O.Hero.Scens.Zip(pk.O.Winner.R.PerScen, (s2, q) => new { s2.Name, weight = Math.Round(s2.W, 3), targetRadii = Math.Round(q.HeadRadii, 3), onTargetPct = Math.Round(q.OnHeadPct, 1) }).ToArray(),
                                    runnersUp = pk.O.Top.OrderBy(x => x.Regret).Take(4).Select(x => new { x.C.Name, x.Rel, x.Regret }).ToArray(),
                                }).ToArray(),
                                fieldVerdict = "pending",
                            };
                            Directory.CreateDirectory(Path.Combine(home, "evidence"));
                            File.WriteAllText(Path.Combine(home, "evidence", $"ev-20261024-game-{gg.Id}.json"), System.Text.Json.JsonSerializer.Serialize(ev, new System.Text.Json.JsonSerializerOptions { WriteIndented = true }));
                        }
                        File.WriteAllText(Path.Combine(home, "game-lab.txt"), logSb.ToString()); File.WriteAllText(Path.Combine(home, "game-lab.cards.js"), js.ToString());
                        return 0;
                    }
                    case "--dropcheck-stress":
                    {
                        // try to BREAK Cadence's drop check: drops / late reports at every spacing 3..17 across flicks and tracks;
                        // the check must never be worse than plain Cadence by more than 2% (or 0.002 deg)
                        double worst = 0; string where = "";
                        foreach (var id in new[] { "bo6og", "breakwide", "rivpsy", "owsol", "apxmp", "dlmp", "valmp" })
                        {
                            var cp = cat.Find(id); if (cp == null) continue;
                            foreach (var sc in Core.ChainLab.Scenarios)
                                foreach (var tm in new[] { Core.ChainLab.Timing.Drop, Core.ChainLab.Timing.Late })
                                    for (int every = 3; every <= 17; every++)
                                        foreach (int seed in new[] { 1, 2, 3 })
                                        {
                                            var a1 = Core.ChainLab.Run(cp, Rig.From(cp), sc, Core.ChainLab.Engine.Cadence, 10, seed, every, tm);
                                            var a2 = Core.ChainLab.Run(cp, Rig.From(cp), sc, Core.ChainLab.Engine.CadenceDropCheck, 10, seed, every, tm);
                                            double over = a2.AimErrDeg100ms - a1.AimErrDeg100ms * 1.02;
                                            if (over > worst) { worst = over; where = $"{id} {sc.Name} {tm} every {every} seed {seed}: plain {a1.AimErrDeg100ms:0.0000} check {a2.AimErrDeg100ms:0.0000}"; }
                                        }
                        }
                        Console.WriteLine(worst <= 0.002 ? "drop check never worse than plain Cadence (beyond 2% / 0.002 deg)" : "WORSE: " + where);
                        if (where.Length > 0) Console.WriteLine("worst case: " + where);
                        return 0;
                    }
                    case "--chain-lab":
                    {
                        // read-only: the RawAccel engine as the bytes flow (OTD -> VMulti counts -> RawAccel clock) vs constant time vs Cadence Lock
                        var ids = args.Skip(1).Where(x => !x.StartsWith("--") && !double.TryParse(x, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out _)).ToArray(); if (ids.Length == 0) ids = new[] { "bo6og", "breakwide", "rivpsy", "owsol", "apxmp" };
                        int merge = args.Contains("--late") || args.Contains("--drop") ? 40 : 0; double jit = args.Contains("--no-jitter") ? 0 : 10; { int ji = Array.IndexOf(args, "--jitter"); if (ji >= 0 && ji + 1 < args.Length) jit = double.Parse(args[ji + 1], System.Globalization.CultureInfo.InvariantCulture); }
                        var timing = args.Contains("--drop") ? Core.ChainLab.Timing.Drop : Core.ChainLab.Timing.Late;
                        foreach (var id in ids)
                        {
                            var cp = cat.Find(id); if (cp == null) { Console.WriteLine(id + " unknown"); continue; }
                            Console.WriteLine($"== {id} {cp.name}  ({Rig.From(cp).PxMm} px/mm, {Rig.From(cp).Cm360} cm/360){(merge > 0 ? $"  every 40th report {timing}" : "")}");
                            Console.WriteLine("scenario               engine     slow(<15) noise/bias   tap(15-55)        track(55-220)     fast(>220)        aim err 100ms   end err  splits");
                            foreach (var sc in Core.ChainLab.Scenarios)
                                foreach (var e in new[] { Core.ChainLab.Engine.Wall, Core.ChainLab.Engine.Constant, Core.ChainLab.Engine.Cadence, Core.ChainLab.Engine.CadenceDropCheck })
                                {
                                    var r = Core.ChainLab.Run(cp, Rig.From(cp), sc, e, jit, mergeEvery: merge, timing: timing);
                                    string B(Core.ChainLab.Band b) => b.N < 2 ? "        -        " : System.FormattableString.Invariant($"{b.NoisePct,6:0.0}%/{b.BiasPct,+6:0.0;-0.0}%");
                                    Console.WriteLine(System.FormattableString.Invariant($"{sc.Name,-22} {e,-16} {B(r.Slow),17} {B(r.Tap),17} {B(r.Track),17} {B(r.Fast),17}  {r.AimErrDeg100ms,8:0.0000}°  {r.EndErrDeg,7:0.000}°  {r.SplitPackets,4}"));
                                }
                        }
                        return 0;
                    }
                    case "--ema-lab":
                    {
                        // read-only: RawAccel's input-speed EMA (half-life sweep) on the pen - gain noise bought vs flick gain lag paid
                        var ids = args.Length > 1 ? args.Skip(1).ToArray() : new[] { "bo6og", "rivpsy", "rivloki", "owsol", "owfreja", "breakwide" };
                        Console.WriteLine("card        half-life  aim noise  aim worst  flick settle  flick lost(30ms)  tap overshoot");
                        foreach (var id in ids)
                        {
                            var ep = cat.Find(id); if (ep == null) { Console.WriteLine($"{id,-10} unknown"); continue; }
                            foreach (double h in Core.SpeedEmaLab.Sweep)
                            {
                                var row = Core.SpeedEmaLab.Run(ep, Rig.From(ep), h);
                                Console.WriteLine(System.FormattableString.Invariant($"{id,-10} {h,6:0.0} ms  {row.AimNoisePct,7:0.00}%  {row.AimWorstPct,7:0.0}%  {row.FlickSettleMs,8:0.0} ms  {row.FlickLostMm,10:0.000} mm  {row.TapOvershootPct,8:0.0}%"));
                            }
                        }
                        return 0;
                    }
                    case "--noise":
                    {
                        // read-only: the RawAccel-engine gain noise across the aim band (CadenceLab.RunAimBand, +/-10% jitter)
                        // for the given card ids (default: the BO6 base + the nine character cards)
                        var ids = args.Length > 1 ? args.Skip(1).ToArray() : new[] { "bo6og", "rivpsy", "rivloki", "rivwfox", "rivpun", "rivhela", "owsol", "owemre", "owillari", "owfreja" };
                        foreach (var id in ids)
                        {
                            var np = cat.Find(id); if (np == null) { Console.WriteLine($"{id,-10} unknown"); continue; }
                            var aim = Core.CadenceLab.RunAimBand(np, Rig.From(np)); var old = Core.CadenceLab.Run(np, Rig.From(np), 10);
                            Console.WriteLine(System.FormattableString.Invariant($"{id,-10} aimBand {aim.WallGainNoisePct,6:0.00}% (worst {aim.WallWorstGainErrPct,5:0.0}%)   old55-150 {old.WallGainNoisePct,6:0.00}%   cadence {aim.CadenceGainNoisePct:0.000}%"));
                        }
                        return 0;
                    }
                    case "--pen-rate":
                    {
                        // Reads the Cadence Lock probe (written beside the plugin while the pen moves with the
                        // engine on and pen Hz = 0). Settles the hardware report rate with evidence.
                        string pp = Path.Combine(cfg.otdDir, "cadence-probe.txt");
                        if (!File.Exists(pp)) pp = Path.Combine(cfg.otdDataDir, "Plugins", "AimForge Game Filters", "cadence-probe.txt");
                        if (!File.Exists(pp)) { Console.WriteLine("no probe data yet: apply a build with Cadence Lock ON and pen Hz 0, move the pen for ~10s, then run this again"); return 1; }
                        var lines = File.ReadAllLines(pp);
                        foreach (var l in lines.Skip(Math.Max(0, lines.Length - 12))) Console.WriteLine(l);
                        Console.WriteLine($"({lines.Length} samples; catalogue says {cat.tablet.reportHz} Hz - if the raw figure disagrees, that is the number to pin)");
                        return 0;
                    }
                    case "--hover":
                    {
                        // --hover <min> <max>   |   --hover off
                        // Hover only: no curve, no RawAccel, no re-scan of the device.
                        var rg = new Rig();
                        if (args.Length > 1 && args[1].Equals("off", StringComparison.OrdinalIgnoreCase)) rg.HdlEnabled = false;
                        else
                        {
                            if (args.Length > 1) rg.HdlMin = double.Parse(args[1], System.Globalization.CultureInfo.InvariantCulture);
                            if (args.Length > 2) rg.HdlMax = double.Parse(args[2], System.Globalization.CultureInfo.InvariantCulture);
                        }
                        if (!otd.SetHoverLive(rg, log)) return 1;
                        Core.LastApply.NoteHover(rg);   // a verified live push is what is live now
                        return 0;
                    }
                    case "--daemon-restart":
                        // full bounce so a freshly installed plugin build is loaded; re-applies the AimForge preset
                        return otd.RestartDaemon(log) ? 0 : 1;
                    case "--latency-check":
                    {
                        // read-only: everything that can make every card feel slow or late, worst first, with the fix
                        string[] want = { "curve live in the daemon", "engine pairing", "plugins loaded", "no duplicate plugin", "no smoothing live", "no interpolator",
                                          "live = last apply", "live tier", "AimForge Game Filters plugin", "OTD GUI not running", "RawAccel GUI not running", "tablet connected", "OTD daemon running",
                                          "daemon pipe reachable", "not running elevated" };
                        var rows = Doctor.Run(ra, otd, cat).Where(i => want.Any(w => i.Name.StartsWith(w))).OrderBy(i => i.Level == "FAIL" ? 0 : i.Level == "WARN" ? 1 : 2).ToList();
                        foreach (var i in rows) Console.WriteLine(i);
                        var la = LastApply.Load(); var xps = Experiments.State.Load();
                        Console.WriteLine($"\nlast apply: {la?.CardName ?? "(none)"} at {la?.At ?? "-"} on {la?.Engine ?? "-"}; experimental modes: {(xps.Intent ? "Intent Speed ON " : "")}{(xps.CarryMs > 0 ? $"Carry {xps.CarryMs} ms " : "")}{(xps.Twin ? "Nib Twin ON" : "")}");
                        int nFail = rows.Count(i => i.Level == "FAIL");
                        Console.WriteLine(nFail > 0 ? $"VERDICT: {nFail} problem(s) above can make every card slow - fix the FAIL rows first" : "VERDICT: the chain is clean - the curve runs, nothing smooths it; if it still feels slow, A/B the engine (untick Cadence Lock) and Intent Speed");
                        return nFail > 0 ? 1 : 0;
                    }
                    case "--qc":
                    {
                        int viol = 0;
                        foreach (var p in cat.presets)
                        {
                            var issues = p.IsLut ? Curve.Check(p, cat.tablet) : new System.Collections.Generic.List<string>();
                            var blockers = Core.RolePolicy.ApplyBlockers(p);
                            var warns = Core.RolePolicy.Check(p).Where(c => c.StartsWith("warn:")).ToList();
                            viol += issues.Count + blockers.Count;
                            string verdict = issues.Count + blockers.Count > 0 ? "FAIL" : warns.Count > 0 ? "pass*" : "pass";
                            Console.WriteLine($"{p.id,-12} {Core.RolePolicy.RoleOf(p),-9} {Core.RolePolicy.PlanTier(p),-4} {verdict,-6} " +
                                string.Join(" | ", issues.Concat(blockers).Concat(warns.Select(w => w.Substring(5).Trim()))));
                        }
                        Console.WriteLine(viol == 0 ? "QC: every card passes (pass* = named-exception warning on record)" : $"QC: {viol} violations");
                        return viol == 0 ? 0 : 1;
                    }
                    case "--compare":
                    {
                        var a = cat.Find(args.Length > 1 ? args[1] : "") ?? throw new ArgumentException("unknown preset id " + (args.Length > 1 ? args[1] : "(none)"));
                        var b = cat.Find(args.Length > 2 ? args[2] : "") ?? throw new ArgumentException("unknown preset id " + (args.Length > 2 ? args[2] : "(none)"));
                        var t2 = cat.tablet;
                        foreach (var p in new[] { a, b })
                        {
                            var rg = Rig.From(p);
                            var m2 = Measure.Run(Curve.EffectiveLut(p, rg.PxMm), rg, t2);
                            bool pass = (p.IsLut ? Curve.Check(p, t2).Count : 0) + Core.RolePolicy.ApplyBlockers(p).Count == 0;
                            Console.WriteLine($"{p.id,-12} hold {m2.HoldPct,6:0.0}%  micro3 {m2.Micro3Pct,6:0.0}%  dead {m2.DeadMs,4:0.0}ms  skid {m2.SkidMm,6:0.000}  180 {m2.Turn180Mm,6:0.0}mm  {Core.RolePolicy.PlanTier(p),-4} {(pass ? "pass" : "FAIL")}");
                        }
                        return 0;
                    }
                    case "--selftest":
                        return SelfTest(cat, otd) ? 0 : 1;
                    case "--filter-evidence":
                    {
                        // Mint REAL evidence artifacts for CoD + Valorant Masters from the shipping core.
                        // the catalogue's measured rate; jitter scaled as a VELOCITY so the scenario is the same physical motion (2026-09-16)
                        double DT = 1000.0 / cat.tablet.reportHz, J = DT / (1000.0 / 266.0);
                        var cod = new AimForge.Filters.GameFilterCore { Which = AimForge.Filters.GameFilterCore.Game.Cod, Kind = AimForge.Filters.GameFilterCore.Member.Master, RailStrength = 0.35 };
                        var pos = new System.Numerics.Vector2(50, 50); cod.Filter(pos, DT);
                        double dy = 100.0 * DT / 1000.0, inO = 0, outO = 0, inA = 0, outA = 0; var prev = pos;
                        for (int i = 0; i < 200; i++)
                        {
                            var np = new System.Numerics.Vector2(pos.X + (float)((i % 2 == 0 ? 0.05 : -0.05) * J), pos.Y + (float)dy);
                            var o = cod.Filter(np, DT);
                            if (i > 40) { inA += dy; outA += o.Y - prev.Y; inO += 0.05 * J; outO += Math.Abs(o.X - prev.X); }
                            pos = np; prev = o;
                        }
                        cod.Reset(); pos = new System.Numerics.Vector2(50, 50); var codPrev = cod.Filter(pos, DT);
                        double flickErr = 0;   // per-report delta error: relative output reads only deltas
                        for (int i = 0; i < 60; i++) { var np = new System.Numerics.Vector2(pos.X + (float)(400.0 * DT / 1000), pos.Y); var o = cod.Filter(np, DT); flickErr = Math.Max(flickErr, ((o - codPrev) - (np - pos)).Length()); pos = np; codPrev = o; }
                        Directory.CreateDirectory(Core.RolePolicy.EvidenceDir);
                        File.WriteAllText(Path.Combine(Core.RolePolicy.EvidenceDir, "ev-20260828-cod-master.json"),
                            System.Text.Json.JsonSerializer.Serialize(new
                            {
                                evidenceId = "ev-20260828-cod-master", date = "2026-08-28", remintedAtMeasuredRate = "2026-09-16",
                                claim = "Vertical recoil rail damps orthogonal chatter on a vertical track with along-axis travel preserved and flicks bit-exact",
                                method = $"GameFilterCore synthetic drive at {cat.tablet.reportHz:0}Hz: 100mm/s vertical track with alternating horizontal jitter of {0.05 * J:0.0000}mm per report (13.3mm/s, the old 266Hz scenario as a velocity); 400mm/s flick",
                                results = new { alongPreserved = outA / inA, orthoRatio = outO / inO, railStrength = 0.35, flickWorstErrorMm = flickErr }
                            }, new System.Text.Json.JsonSerializerOptions { WriteIndented = true }));

                        var val = new AimForge.Filters.GameFilterCore { Which = AimForge.Filters.GameFilterCore.Game.Val, Kind = AimForge.Filters.GameFilterCore.Member.Master, MaxDzMm = 0.45, KneeMmS = 8, FlushOnTurnDeg = 60 };
                        pos = new System.Numerics.Vector2(50, 50); val.Filter(pos, DT);
                        double restMotion = 0; var held = System.Numerics.Vector2.Zero;
                        for (int i = 0; i < 120; i++)
                        { var np = new System.Numerics.Vector2(50 + (float)(i % 2 == 0 ? 0.01 : -0.01), 50); var o = val.Filter(np, DT); if (i == 0) held = o; else restMotion = Math.Max(restMotion, (o - held).Length()); pos = np; }
                        var jigPen = new System.Numerics.Vector2(pos.X + 0.11f, 50.02f);   // the last rest step ran -X: a +X jig is a ~170 deg turn, so the flush branch runs
                        var jig = val.Filter(jigPen, DT);
                        double flushErr = ((jig - held) - (jigPen - pos)).Length();   // the flush passes the hand's own delta (2026-09-16 law)
                        val.Reset(); pos = new System.Numerics.Vector2(50, 50); var valPrev = val.Filter(pos, DT);
                        double swipeErr = 0;
                        for (int i = 0; i < 60; i++) { var np = new System.Numerics.Vector2(pos.X + (float)(60.0 * DT / 1000), pos.Y); var o = val.Filter(np, DT); swipeErr = Math.Max(swipeErr, ((o - valPrev) - (np - pos)).Length()); pos = np; valPrev = o; }
                        File.WriteAllText(Path.Combine(Core.RolePolicy.EvidenceDir, "ev-20260828-val-master.json"),
                            System.Text.Json.JsonSerializer.Serialize(new
                            {
                                evidenceId = "ev-20260828-val-master", date = "2026-08-28", remintedAtMeasuredRate = "2026-09-16",
                                claim = "Rest deadzone freezes tremor-scale jitter completely; a fast peek jig passes the hand's own delta the same report; a committed swipe is untouched (errors are per-report deltas - relative output). RETIRED 2026-09-16: through the whole plan the deadzone also ate micro-aim",
                                method = $"GameFilterCore synthetic drive at {cat.tablet.reportHz:0}Hz: +/-0.01mm (one tablet unit) alternating jitter at rest; heading jig; 60mm/s swipe",
                                results = new { restOutputMotionMm = restMotion, flushSameReportErrorMm = flushErr, committedSwipeWorstErrorMm = swipeErr }
                            }, new System.Text.Json.JsonSerializerOptions { WriteIndented = true }));
                        Console.WriteLine($"cod: along {outA / inA:0.000} ortho {outO / inO:0.000} flickErr {flickErr:0.00000}");
                        Console.WriteLine($"val: rest {restMotion:0.00000} flushErr {flushErr:0.00000} swipeErr {swipeErr:0.00000}");
                        Console.WriteLine("evidence written: ev-20260828-cod-master, ev-20260828-val-master");
                        return 0;
                    }
                    case "--cadence-evidence":
                    {
                        // Mint the Cadence Lock evidence artifact from the shipping core.
                        var bo = cat.Find("bo6og")!; var rv = cat.Find("rivmp")!;
                        var e1 = Core.CadenceLab.Run(bo, Rig.From(bo), 25);
                        var e2 = Core.CadenceLab.Run(rv, Rig.From(rv), 25);
                        var e3 = Core.CadenceLab.Run(bo, Rig.From(bo), 10);
                        Directory.CreateDirectory(Core.RolePolicy.EvidenceDir);
                        File.WriteAllText(Path.Combine(Core.RolePolicy.EvidenceDir, "ev-20260907-cadence-lock.json"),
                            System.Text.Json.JsonSerializer.Serialize(new
                            {
                                evidenceId = "ev-20260907-cadence-lock", date = "2026-09-07", remintedWithDriverFormula = "2026-09-16",
                                claim = "Evaluating the curve on the pen's fixed report clock removes the per-report gain noise a wall-clock (arrival-dt) engine injects under report-timing jitter, at zero temporal cost (same-report output)",
                                method = "CadenceLab: 30mm p-p left-right track at 1.5Hz (peak ~140mm/s) for 6s at 360Hz on the 0.01mm lattice, arrival dt jittered uniformly; per-report gain scored against the true (pen-clock) gain in the 55-150mm/s track band; merged-frame case at 120mm/s",
                                results = new { bo6og_jitter25 = e1, rivalsMaster_jitter25 = e2, bo6og_jitter10 = e3, bo6og_jitter25_autoCadence = Core.CadenceLab.Run(bo, Rig.From(bo), 25, 7, true) },
                                fieldVerdict = "pending"
                            }, new System.Text.Json.JsonSerializerOptions { WriteIndented = true, IncludeFields = true, NumberHandling = System.Text.Json.Serialization.JsonNumberHandling.AllowNamedFloatingPointLiterals }));
                        foreach (var (nm, e) in new[] { ("bo6og +/-25%", e1), ("rivmp +/-25%", e2), ("bo6og +/-10%", e3) })
                            Console.WriteLine($"{nm,-14} wall-clock gain noise {e.WallGainNoisePct:0.00}% (worst {e.WallWorstGainErrPct:0.0}%)   cadence {e.CadenceGainNoisePct:0.000}% (worst {e.CadenceWorstGainErrPct:0.000}%)   vs ideal {e.CadenceVsIdealMaxUnits:0.0000} units   merged frame: wall {e.MergedFrameWallSpikePct:0.0}% / cadence {e.MergedFrameCadenceErrPct:0.0}%   live {e.LiveHz:0.0}Hz");
                        Console.WriteLine("evidence written: ev-20260907-cadence-lock");
                        return 0;
                    }
                    case "--psylocke-refine":
                    {
                        var rTab = cat.tablet; var rPrm = new Core.PsyLab.Params();
                        var rC = new System.Collections.Generic.List<Core.PsyLab.Cand>();
                        rC.Add(new Core.PsyLab.Cand { Name = "ref Trackline s5", Family = "reference", P = Core.PsyLab.WithSnap(cat.Find("rivlla")!, 5) });
                        rC.Add(new Core.PsyLab.Cand { Name = "ref flat cm28 s5", Family = "reference", P = Core.PsyLab.Flat(28, 0.90, 5) });
                        rC.Add(new Core.PsyLab.Cand { Name = "ref Breakpoint s5", Family = "reference", P = Core.PsyLab.WithSnap(cat.Find("breakpoint")!, 5) });
                        foreach (var cm in new[] { 32.0, 34.5, 37.7 }) foreach (var off in new[] { 150.0, 170.0, 190.0 })
                            foreach (var G in new[] { 3.0, 4.0 }) foreach (var capAt in new[] { 260.0, 300.0, 340.0 })
                                rC.Add(new Core.PsyLab.Cand { Name = $"tl-sat cm{cm} off{off} G{G} @{capAt}", Family = "trackline-sat", P = Core.PsyLab.TracklineSat(cm, off, G, capAt) });
                        var rows = rC.Select(c => (c, r: Core.PsyLab.Score(c, rTab, rPrm), rq: Core.PsyLab.ReacquireSpread(c))).OrderBy(x => x.r.Worst).ThenBy(x => x.rq.spreadPct).ToList();
                        Console.WriteLine("=== refine: unity tracking band + early-saturating flick ramp (snap 5, no game filter), sorted by tracking worst then re-acquire spread ===");
                        foreach (var x in rows) Console.WriteLine(Core.PsyLab.Row(x.r) + $"  reacq135 {x.rq.spreadPct,5:0.0}% {x.rq.travelMm,4:0}mm  accel {x.r.Accel:0.####} off {x.r.OffMms:0}mm/s capAt {x.r.CapAtMms:0}");
                        double best = rows.Min(x => x.r.Worst);
                        var eligible = rows.Where(x => x.r.Worst <= best * 1.03 && x.r.DeadMs <= 2000.0 / 360 + 0.3 && x.r.MicroPct >= 90 && x.r.MicroPct <= 130).ToList();
                        var win = eligible.OrderBy(x => x.rq.spreadPct).ThenBy(x => x.r.Weighted).First();
                        Console.WriteLine($"=== rule: tracking worst within 3% of the best ({best:0.000}, so <= {best * 1.03:0.000}), onset one report, micro 90-130%, then LOWEST re-acquire spread ===");
                        Console.WriteLine($"WINNER: {win.c.Name}  worst {win.r.Worst:0.000}  wtd {win.r.Weighted:0.000}  reacq {win.rq.spreadPct:0.0}%  spr30 {win.r.SpreadPct:0.0}%  180 {win.r.Turn180Mm:0.0}mm  sens {win.r.RivalsSens:0.000}  accel {win.r.Accel}  offC {win.c.P.adv.offset}  cap {win.r.Cap}  capAt {win.r.CapAtMms:0}");
                        Console.WriteLine("eligible set: " + string.Join(" | ", eligible.Select(x => $"{x.c.Name} (reacq {x.rq.spreadPct:0.0}%, worst {x.r.Worst:0.000})")));
                        Console.WriteLine("=== winner Y/X (vertical share of the flyer scenario) ===");
                        foreach (var yx in new[] { 0.85, 0.90, 1.00 })
                        {
                            var p = Core.PsyLab.WithSnap(win.c.P, 5); p.adv.yx = yx;
                            Console.WriteLine(Core.PsyLab.Row(Core.PsyLab.Score(new Core.PsyLab.Cand { Name = $"winner yx{yx}", P = p }, rTab, rPrm)));
                        }
                        Console.WriteLine("=== Rivals Master filter spike check: reports where the filtered pen moved >1.5x the hand AND >200 mm/s ===");
                        foreach (var fl in new[] { false, true })
                        {
                            var cw = new Core.PsyLab.Cand { Name = $"winner {(fl ? "+RivalsMaster" : "no filter")}", P = Core.PsyLab.WithSnap(win.c.P, 5), Filter = fl };
                            var r = Core.PsyLab.Score(cw, rTab, rPrm);
                            Console.WriteLine($"  {cw.Name,-24} spikes per scenario S1..S4: {string.Join(" / ", r.PerScen.Select(q => q.Spikes))}   head radii {string.Join(" / ", r.PerScen.Select(q => q.HeadRadii.ToString("0.00")))}   peak {r.PerScen.Max(q => q.PeakHandMms):0} mm/s");
                        }
                        Directory.CreateDirectory(Core.RolePolicy.EvidenceDir);
                        var rOpts = new System.Text.Json.JsonSerializerOptions { WriteIndented = true, IncludeFields = true, NumberHandling = System.Text.Json.Serialization.JsonNumberHandling.AllowNamedFloatingPointLiterals };
                        File.WriteAllText(Path.Combine(Core.RolePolicy.EvidenceDir, "ev-20260914-psylocke-refine.json"), System.Text.Json.JsonSerializer.Serialize(new
                        {
                            evidenceId = "ev-20260914-psylocke-refine", date = "2026-09-14",
                            rule = "tracking worst within 3% of best, onset one report, micro 90-130%, then lowest 135-degree re-acquire spread",
                            winner = new { name = win.c.Name, result = win.r, reacquireSpreadPct = win.rq.spreadPct, reacquireTravelMm = win.rq.travelMm, preset = new { win.c.P.cm, win.c.P.snap, win.c.P.adv.accel, win.c.P.adv.cap, win.c.P.adv.offset, win.c.P.adv.yx } },
                            rows = rows.Select(x => new { x.c.Name, x.r.Worst, x.r.Weighted, reacq = x.rq.spreadPct, x.r.SpreadPct, x.r.Turn180Mm, x.r.RivalsSens, x.r.Accel, x.r.OffMms, x.r.CapAtMms, x.r.Cap }).ToArray()
                        }, rOpts));
                        Console.WriteLine("evidence written: ev-20260914-psylocke-refine");
                        return 0;
                    }
                    case "--hero-lab":
                    {
                        // --hero-lab <id|all>   (psylocke, loki, whitefox, punisher, hela, soldier76, emre, illari, freja)
                        var which = args.Length > 1 && !args[1].Equals("all", StringComparison.OrdinalIgnoreCase)
                            ? new[] { Core.HeroLab.Find(args[1]) ?? throw new ArgumentException("unknown hero " + args[1]) } : Core.HeroLab.Heroes;
                        Directory.CreateDirectory(Core.RolePolicy.EvidenceDir);
                        var hOpts = new System.Text.Json.JsonSerializerOptions { WriteIndented = true, IncludeFields = true, NumberHandling = System.Text.Json.Serialization.JsonNumberHandling.AllowNamedFloatingPointLiterals };
                        var heroJs = new System.Text.StringBuilder();
                        foreach (var h in which)
                        {
                            var sw = System.Diagnostics.Stopwatch.StartNew();
                            var oc = Core.HeroLab.Run(h, cat, Console.WriteLine);
                            heroJs.AppendLine(Core.HeroLab.CharacterTunerEntry(Core.HeroLab.CharacterCard(oc, cat)));
                            File.WriteAllText(Path.Combine(Core.RolePolicy.EvidenceDir, $"ev-20261024-hero-{h.Id}.json"), System.Text.Json.JsonSerializer.Serialize(Core.HeroLab.Evidence(oc), hOpts));
                            Console.WriteLine($"evidence written: ev-20261024-hero-{h.Id}  ({sw.Elapsed.TotalSeconds:0}s)");
                        }
                        File.WriteAllText(Path.Combine(home, "hero-lab.cards.js"), heroJs.ToString());
                        return 0;
                    }
                    case "--psylocke-lab":
                    {
                        var plTab = cat.tablet; var plPrm = new Core.PsyLab.Params();
                        Console.WriteLine("Psylocke lab | cells = RMS execution error in HEAD RADII / % of samples on the head, for " + string.Join(" | ", Core.PsyLab.Scenarios.Select(s => s.Name)));
                        var plCands = Core.PsyLab.Candidates(cat);
                        var plRank = plCands.Select(c => Core.PsyLab.Score(c, plTab, plPrm)).OrderBy(r => r.Worst).ThenBy(r => r.Weighted).ToList();
                        Console.WriteLine("=== phase 1: every candidate, snap 9, no game filter, sorted by WORST scenario ===");
                        foreach (var r in plRank) Console.WriteLine(Core.PsyLab.Row(r));

                        var plTop = plRank.Take(6).Select(r => plCands.First(c => c.Name == r.Name)).ToList();
                        var plP2 = new System.Collections.Generic.List<Core.PsyLab.Result>();
                        foreach (var c in plTop) foreach (var sv in new[] { 0.0, 5.0, 9.0 }) foreach (var fl in new[] { false, true })
                            plP2.Add(Core.PsyLab.Score(new Core.PsyLab.Cand { Name = $"{c.Name} s{sv}{(fl ? " +RM" : "")}", Family = c.Family, P = Core.PsyLab.WithSnap(c.P, sv), Filter = fl }, plTab, plPrm));
                        plP2 = plP2.OrderBy(r => r.Worst).ThenBy(r => r.Weighted).ToList();
                        Console.WriteLine("=== phase 2: top 6 curves x angle snap {0,5,9} x Rivals Master filter {off,on} ===");
                        foreach (var r in plP2) Console.WriteLine(Core.PsyLab.Row(r));

                        // robustness: does the ranking survive a different human? (the project's overfitting lesson)
                        var plStress = new[]
                        {
                            ("steadier hand (KPar .06, S0 .8)", new Core.PsyLab.Params { KPar = 0.06, S0 = 0.8 }),
                            ("shakier hand (KPar .14, S0 2.5)", new Core.PsyLab.Params { KPar = 0.14, S0 = 2.5 }),
                            ("slow visual loop (Kp 2, delay 180ms)", new Core.PsyLab.Params { Kp = 2.0, VisDelay = 0.18 }),
                            ("snappy reversals (follow 4 Hz)", new Core.PsyLab.Params { FollowHz = 4.0 }),
                        };
                        var plTop8 = plP2.Take(8).ToList();
                        Console.WriteLine("=== robustness: rank of the phase-2 top 8 under four different human models (1 = best) ===");
                        var plRob = new System.Collections.Generic.List<object>();
                        foreach (var (label, prm) in plStress)
                        {
                            var rescored = plTop8.Select(r =>
                            {
                                var baseCand = plCands.First(c => r.Name.StartsWith(c.Name + " s"));
                                return Core.PsyLab.Score(new Core.PsyLab.Cand { Name = r.Name, Family = r.Family, P = Core.PsyLab.WithSnap(baseCand.P, r.Snap), Filter = r.Filter }, plTab, prm);
                            }).OrderBy(r => r.Worst).ThenBy(r => r.Weighted).ToList();
                            Console.WriteLine($"  {label}: " + string.Join("  >  ", rescored.Select(r => $"{r.Name} ({r.Worst:0.00})")));
                            plRob.Add(new { model = label, order = rescored.Select(r => new { r.Name, r.Worst, r.Weighted }).ToArray() });
                        }
                        Directory.CreateDirectory(Core.RolePolicy.EvidenceDir);
                        var plOpts = new System.Text.Json.JsonSerializerOptions { WriteIndented = true, IncludeFields = true, NumberHandling = System.Text.Json.Serialization.JsonNumberHandling.AllowNamedFloatingPointLiterals };
                        File.WriteAllText(Path.Combine(Core.RolePolicy.EvidenceDir, "ev-20260914-psylocke-lab.json"), System.Text.Json.JsonSerializer.Serialize(new
                        {
                            evidenceId = "ev-20260914-psylocke-lab", date = "2026-09-14",
                            claim = "Candidate builds ranked by execution stability on Psylocke's real engagements (hitscan crossbow, dive range), using the shipping curve math at the pen's 360 Hz clock",
                            method = "PsyLab: 4 scenarios (7m backline AD strafe 6 m/s; 4m point-blank duel 9 m/s relative; 8m flyer boost 12 m/s with vertical bob; 12m far poke), trained-inverse feedforward + 120ms visual feedback, signal-dependent motor noise 2-12 Hz + tremor, RawAccel exact angle snap, integer counts with remainder; error vs intended path in head radii (0.15 m); ranked by worst scenario, stress-tested under 4 alternative human models",
                            scenarios = Core.PsyLab.Scenarios, humanModel = plPrm, phase1 = plRank, phase2 = plP2, robustness = plRob,
                            fieldVerdict = "pending"
                        }, plOpts));
                        Console.WriteLine("evidence written: ev-20260914-psylocke-lab");
                        return 0;
                    }
                    case "--filters":
                        foreach (var f in Core.FilterCatalog.Discover(otd))
                            Console.WriteLine($"{(f.EnabledLive ? "ON " : "off")}  [{f.LiveTier,-4}] {f.Display,-32} {(f.Registered ? "" : "(dir only)")} {f.Note}");
                        foreach (var c in Core.FilterCatalog.Conflicts(Core.FilterCatalog.Discover(otd)))
                            Console.WriteLine("CONFLICT: " + c);
                        return 0;
                }
            }

            return RunWindow(cat, ra, otd, tuner);
        }

        // The window entry points live outside Main so the headless CLI (selftests, --qc, labs) never JITs a WinForms
        // reference: build.sh runs them on Linux without the desktop runtime (2026-10-11).
        [System.Runtime.CompilerServices.MethodImpl(System.Runtime.CompilerServices.MethodImplOptions.NoInlining)]
        static int RunWindow(Catalogue cat, RawAccelBridge ra, OtdBridge otd, string tuner)
        {
            // 2026-10-11: never a silent failure - an exception that escapes a handler (an async void click, a timer) is written
            // to crash.log next to the app and shown, instead of vanishing or killing the window without a word
            Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
            Application.ThreadException += (s, e) => ReportCrash(e.Exception, fatal: false);
            AppDomain.CurrentDomain.UnhandledException += (s, e) => ReportCrash(e.ExceptionObject as Exception, fatal: true);
            Application.SetHighDpiMode(HighDpiMode.SystemAware);
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new MainForm(cat, ra, otd, tuner));
            return 0;
        }

        static void ReportCrash(Exception? ex, bool fatal)
        {
            string text = $"{DateTime.Now:yyyy-MM-dd HH:mm:ss} {(fatal ? "FATAL" : "error")}: {ex}";
            try { File.AppendAllText(Path.Combine(AppContext.BaseDirectory, "crash.log"), text + Environment.NewLine + Environment.NewLine); } catch { }
            try
            {
                MessageBox.Show((fatal ? "AimForge has to close" : "AimForge hit an unexpected error") + ":\n\n" + ex?.Message +
                    "\n\nIf this happened during an apply, run the Doctor: its 'live = last apply' row says whether the drivers still carry your last verified build. Details: crash.log next to AimForge.exe." +
                    (fatal ? "" : "\n\nThe window keeps running; run the Doctor if anything looks wrong."), "AimForge", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            catch { }
        }

        [System.Runtime.CompilerServices.MethodImpl(System.Runtime.CompilerServices.MethodImplOptions.NoInlining)]
        static int Screenshot(string[] args, string home, Catalogue cat, RawAccelBridge ra, OtdBridge otd, string tuner)
        {
                    Application.SetHighDpiMode(HighDpiMode.SystemAware); Application.EnableVisualStyles();
                    // A real message loop, so layout/paint complete before the capture;
                    // a one-shot timer takes the shot and ends the loop.
                    var f = new MainForm(cat, ra, otd, tuner);
                    string shot = args.Length > 1 ? args[1] : Path.Combine(home, "screenshot.png");
                    if (args.Length > 2 && args[2] == "advanced") f.ShowAdvancedTab();
                    else if (args.Length > 2 && args[2] == "filters") f.ShowFiltersTab();
                    else if (args.Length > 2 && cat.Find(args[2]) is Preset sp) f.SelectById(sp.id);
                    if (args.Length > 3 && int.TryParse(args[3], out var sideTab)) f.ShowSideTab(sideTab);
                    var timer = new System.Windows.Forms.Timer { Interval = 600 };
                    timer.Tick += (s, e) => { timer.Stop(); try { f.Snapshot(shot); } finally { f.Shutdown(); } };
                    f.Shown += (s, e) => timer.Start();
                    Application.Run(f);
                    Console.WriteLine("screenshot -> " + shot);
                    return 0;
        }

        /// Pins the numbers the tuner established, so a regression in the port is caught here.
        /// The RawAccel settings.json fixture: the real file's shape (one pen profile, six device entries incl. three pen-shaped decoys).
        static string RaFixture()
        {
            string BLK = "{~mode~:~classic~,~Gain / Velocity~:false,~inputOffset~:0.5,~outputOffset~:0.0,~acceleration~:0.246,~decayRate~:0.1,~gamma~:1.0,~motivity~:1.5,~exponentClassic~:2,~scale~:1.0,~exponentPower~:0.05,~limit~:1.5,~syncSpeed~:5.0,~smooth~:0.5,~Cap / Jump~:{~x~:15.0,~y~:5},~Cap mode~:~output~,~data~:[0.152,1,0.701,1,29.355,4,82.65,4]}";
            string DEV(string n, string id) => "{~name~:~" + n + "~,~profile~:~default~,~id~:~" + id + "~,~config~:{~disable~:true,~Use constant time interval based on polling rate~:false,~DPI (normalizes input speed unit: counts/ms -> in/s)~:0,~Polling rate Hz (keep at 0 for automatic adjustment)~:0}}";
            return ("{~version~:~1.7.0~,~defaultDeviceConfig~:{~disable~:false,~Use constant time interval based on polling rate~:false,~DPI (normalizes input speed unit: counts/ms -> in/s)~:0,~Polling rate Hz (keep at 0 for automatic adjustment)~:0},"
                + "~profiles~:[{~name~:~default~,~Stretches domain for horizontal vs vertical inputs~:{~x~:1.0,~y~:1.0},~Stretches accel range for horizontal vs vertical inputs~:{~x~:1.0,~y~:1.0},"
                + "~Whole or horizontal accel parameters~:" + BLK + ",~Vertical accel parameters~:" + BLK + ","
                + "~Input speed calculation parameters~:{~Whole/combined accel (set false for 'by component' mode)~:true,~lpNorm~:2.0,~Time in ms after which an input is weighted at half its original value.~:0.0,~Time in ms after which scale is weighted at half its original value.~:0.0,~Time in ms after which an output is weighted at half its original value.~:0.0},"
                + "~Output DPI~:1000,~Y/X output DPI ratio (vertical sens multiplier)~:0.789,~L/R output DPI ratio (left sens multiplier)~:1.0,~U/D output DPI ratio (up sens multiplier)~:1.0,~Degrees of rotation~:0,~Degrees of angle snapping~:9,~Input Speed Cap~:3.0}],"
                + "~devices~:[" + DEV("Pulsar 8Kdx Dongle", @"HID\\VID_3710&PID_5406&MI_01&Col08") + "," + DEV("Pulsar X2 CL", @"HID\\VID_3710&PID_3414&MI_02") + "," + DEV("Pulsar 8Kdx Dongle", @"HID\\VID_3710&PID_5406&MI_00") + ","
                + DEV("hanvonugee ugee device", @"HID\\hid&Col02") + "," + DEV("VMulti Device", @"HID\\VID_1234&PID_5678") + "," + DEV("Wacom thing", @"HID\\VID_056A&PID_0001") + "]}").Replace('~', '"');
        }

        static bool SelfTest(Catalogue cat, OtdBridge? otd = null)
        {
            int fails = 0;
            void Ok(string n, bool c, string d = "") { Console.WriteLine((c ? "  PASS  " : "  FAIL  ") + n + (d.Length > 0 ? "   " + d : "")); if (!c) fails++; }
            var t = cat.tablet;
            Ok("1-unit step = 3.60 mm/s (360Hz MEASURED, ev-20260907-pen-rate)", Math.Abs(t.UnitStepMms - 3.60) < 0.01, t.UnitStepMms.ToString("0.000"));

            var fe = cat.Find("feather")!; var rig = Rig.From(fe);
            Ok("Feather LUT at 90 px/mm matches the live RawAccel string",
               Curve.RawAccelPoints(fe.lut!, 90) == "0.239,0.7;0.747,1;4.95,1;25.2,3;130.5,3;", Curve.RawAccelPoints(fe.lut!, 90));
            Ok("Feather 2-unit gain 0.84", Math.Abs(Curve.GainAt(fe.lut!, 5.32) - 0.84) < 0.01, Curve.GainAt(fe.lut!, 5.32).ToString("0.000"));
            double ow = Curve.SensFor(cat.games.First(g => g.id == "ow2").K, rig);
            Ok("OW2 sens 2.245 at 90 px/mm / cm 27", Math.Abs(ow - 2.245) < 0.01, ow.ToString("0.000"));
            Ok("CoD sens identical to OW2", Math.Abs(Curve.SensFor(cat.games.First(g => g.id == "cod").K, rig) - ow) < 1e-9);

            // ---- 2026-10-23: THE GAME FAMILIES re-derived by the game lab (GameLab.cs, ev-20261023-game-<id>) ----
            // The old ladder (BO6-shaped Baseline/Planted/Turbo/Tapped quads, LUT Masters, T3 wildcards, LL a/b/c) is gone:
            // every game now runs Master / Precision / Tracker / Flick / Brawl / one Signature, each tuned on its own fights.
            {
                string[] slots = { "mp", "pl", "lla", "tb", "llb", "llc" };
                var fam = Core.GameLab.Games.SelectMany(gg => slots.Select(sl => (gg, sl, p: cat.Find(gg.Prefix + sl)))).ToList();
                var goat = cat.Find(Core.Goat.Id);
                Ok("roster: THE GOAT first, BO6 Original, 3 Breakpoints, 9 character cards, 2 references + 8 games x 6 lab-derived roles = 64 cards; no per-game Baseline, no wildcards",
                   cat.presets.Count == 64 && cat.presets[0].id == Core.Goat.Id && cat.presets[1].id == "bo6og" && fam.All(x => x.p != null && x.p.group == x.gg.Group) &&
                   cat.presets.Count(p => p.group == "Valorant") == 6 && !cat.presets.Any(p => p.name is "Baseline" or "Planted" or "Turbo" or "Tapped") &&
                   !cat.presets.Any(p => RolePolicy.RoleOf(p) == "Lab"), cat.presets.Count + " cards");
                string bad = "";
                foreach (var (gg, sl, p) in fam)
                {
                    var why = new List<string>();
                    if (p!.IsLut || RolePolicy.FloorOf(p) != 1.0) why.Add("not a floor-1.00 classic");
                    if (p.cohOv != null && !p.cohOv.IsTapOnly) why.Add("stabilizer beyond the tap pin");
                    if (RolePolicy.PlanTier(p)[1] > '1') why.Add("tier " + RolePolicy.PlanTier(p));
                    if (RolePolicy.ApplyBlockers(p).Count > 0) why.Add("apply blockers");
                    if (RolePolicy.Check(p).Any(x => !x.StartsWith("warn:"))) why.Add("QC: " + string.Join("; ", RolePolicy.Check(p)));
                    var mp = Measure.Run(Curve.EffectiveLut(p, p.pxmm), Rig.From(p), t);
                    if (mp.DeadMs > 2000.0 / t.reportHz + 0.3) why.Add($"onset {mp.DeadMs:0.0} ms");
                    if (mp.Micro3Pct < 90 || mp.Micro3Pct > 130) why.Add($"micro {mp.Micro3Pct:0}%");
                    if (why.Count > 0) bad += $" {p.id}: {string.Join(", ", why)};";
                }
                Ok("latency contract on all 48 family cards: floor-1.00 classic, no smoothing (the Tap Anchor at most), tier <= T1, onset two reports, micro 90-130%, QC clean, zero apply blockers",
                   bad.Length == 0, bad.Length == 0 ? "48 cards" : bad);
                string role(string sl) => Core.GameLab.Roles[Array.IndexOf(slots, sl)];
                Ok("every base speed is a ratio of THE GOAT's 52.63 cm/360 (Master/Tracker/Flick x1, Precision x1.15, Brawl x0.87, the Signature its own ratio; the Finals Fieldwide the sens-8 verdict)",
                   fam.All(x => Math.Abs(x.p!.cm - Core.GameLab.CmOf(x.gg, role(x.sl))) < 1e-9) && cat.Find("finllc")!.cm == 78.95 &&
                   fam.Where(x => x.sl is "mp" or "lla" or "tb").All(x => x.p!.cm == Core.Goat.Cm));
                Ok("the GOAT's rig on every family card: angle snap 0, Y/X 1.00, reset 20 ms, hover max 87, 57 px/mm, no stabilizer (the Tap Anchor is offered, not shipped, on tap-fire roles)",
                   fam.All(x => x.p!.snap == 0 && x.p.Yx == 1.0 && x.p.adv.reset == 20 && x.p.hdlMax == 87 && x.p.pxmm == 57 && x.p.cohOv == null) &&
                   fam.Where(x => Core.GameLab.TapFire(x.gg, role(x.sl))).All(x => FilterPlan.For(x.p!) is var fp && !fp.TapDefaultOn && fp.TapHold == x.gg.PinHoldMs && Math.Abs(fp.TapBreak - x.gg.PinBreakMm) < 1e-9));
                var dup = fam.GroupBy(x => x.gg.Id).SelectMany(g => g.GroupBy(x => (x.p!.cm, x.p.adv.accel, x.p.adv.cap, x.p.adv.offset)).Where(q => q.Count() > 1).Select(q => string.Join("=", q.Select(z => z.p!.id)))).ToList();
                var fm = cat.Find("finmp")!;
                Ok("no two cards of a game are the same build; The Finals Master IS the GOAT (the verdict's own game)",
                   dup.Count == 0 && fm.cm == goat!.cm && fm.adv.accel == goat.adv.accel && fm.adv.cap == goat.adv.cap && fm.adv.offset == goat.adv.offset && fm.snap == goat.snap && fm.Yx == goat.Yx && fm.adv.reset == goat.adv.reset,
                   string.Join(", ", dup));
                double SensOf(string id) { var p = cat.Find(id)!; return Curve.SensFor(cat.games.First(g => g.id == p.game).K, Rig.From(p)); }
                Ok("in-game numbers carry the GOAT's base: The GOAT and the Finals Master read Finals sens 12.00 (your setting), Valorant 0.171, OW2 1.818, Apex 0.545; the Finals Fieldwide keeps your field sens 8.00",
                   Math.Abs(SensOf(Core.Goat.Id) - 12.0) < 0.001 && Math.Abs(SensOf("finmp") - 12.0) < 0.001 &&
                   Math.Abs(SensOf("valmp") - 0.171) < 0.002 && Math.Abs(SensOf("owmp") - 1.818) < 0.003 && Math.Abs(SensOf("apxmp") - 0.545) < 0.002 &&
                   Math.Abs(SensOf("finllc") - 8.0) < 0.06, $"goat {SensOf(Core.Goat.Id):0.000} val {SensOf("valmp"):0.000} ow {SensOf("owmp"):0.000} apx {SensOf("apxmp"):0.000} fin-field {SensOf("finllc"):0.000}");
            }
            {
                var gc = cat.Find(Core.Goat.Id)!; var gm = Measure.Run(Curve.EffectiveLut(gc, 57), Rig.From(gc), t);
                Ok("THE GOAT (field verdict 2026-10-24) is exactly the live build: the Apex Brawl classic 0.2963 / offset 2.28 / cap 3.0, 57 px/mm, 52.63 cm/360 (Finals sens 12), snap 0, Y/X 1.00, reset 20, HDL 87, no stabilizer, no game filter - and Goat.cs (what the labs derive from) says the same",
                   gc.lut == null && gc.cohOv == null && gc.pxmm == Core.Goat.PxMm && gc.cm == Core.Goat.Cm && gc.snap == Core.Goat.Snap && gc.Yx == Core.Goat.Yx &&
                   gc.adv.reset == Core.Goat.ResetMs && gc.hdlMax == Core.Goat.HdlMax && gc.adv.accel == Core.Goat.Accel && gc.adv.offset == Core.Goat.Offset && gc.adv.cap == Core.Goat.Cap &&
                   gc.field == "good" && gc.game == "finals" && gc.filters!.All(f => f.id == "Hover_Distance_Limiter" || !f.on) &&
                   Math.Abs(Curve.ClassicCapSpeedCms(Core.Goat.Accel, Core.Goat.Offset, Core.Goat.Cap) * 1000 / 57 - Core.Goat.CapAtMms) < 1 && Math.Abs(Core.Goat.Offset * 1000 / 57 - Core.Goat.UnityMms) < 0.01 &&
                   File.Exists(Path.Combine(Core.RolePolicy.EvidenceDir, Core.Goat.EvidenceId + ".json")));
                Ok("THE GOAT measured: 180 87.7 mm, committed flick spread 4.3%, micro 99%, onset two reports, tracking 1.90x",
                   Math.Abs(gm.Turn180Mm - 87.7) < 0.2 && Math.Abs(Measure.FlickSpreadPct(Curve.EffectiveLut(gc, 57), Rig.From(gc), t, 90, 120, 150) - 4.3) < 0.1 &&
                   gm.Micro3Pct > 95 && gm.Micro3Pct < 104 && Math.Abs(gm.DeadMs - 2000.0 / t.reportHz) < 0.3, gm.ToString());
            }
            var bs = cat.Find("breakslow")!;
            Ok("breakslow (2026-10-24): the GOAT's fingertip band (offset 2.28 = 1:1 to 40 mm/s) with Breakpoint's flick end (cap 5.0 by ~303 mm/s, accel 0.3074) - floor exactly 1.0",
               bs.lut == null && bs.adv.accel == 0.3074 && bs.adv.cap == 5.0 && bs.adv.offset == Core.Goat.Offset &&
               Math.Abs(Curve.ClassicCapSpeedCms(0.3074, 2.28, 5.0) * 1000 / 57 - 303) < 1.5);
            var mBs = Measure.Run(Curve.EffectiveLut(bs, 57), Rig.From(bs), t);
            Ok("breakslow measured: onset two reports (5.6ms - the 360Hz pen lattice at a 1.06mm/s creep, same as every unity card), 180 ~52.6mm",
               Math.Abs(mBs.DeadMs - 2000.0 / t.reportHz) < 0.3 && Math.Abs(mBs.Turn180Mm - 52.6) < 1.2, mBs.ToString());
            var bp = cat.Find("breakpoint")!;
            Ok("breakpoint: eff-14 classic (0.246/5.0/0.5) on THE GOAT's rig (52.63 cm/360, snap 0, Y/X 1.00, reset 20), filterless",
               bp.lut == null && bp.cohOv == null && bp.pxmm == 57 && bp.cm == Core.Goat.Cm && bp.snap == 0 && bp.Yx == 1.0 && bp.adv.reset == 20 &&
               bp.adv.accel == 0.246 && bp.adv.cap == 5.0 && bp.adv.offset == 0.5);
            var mBp = Measure.Run(Curve.EffectiveLut(bp, 57), Rig.From(bp), t);
            Ok("breakpoint measured: 180 ~52.6mm (the GOAT needs 87.7), micro ~99% (settle-window average)",
               Math.Abs(mBp.Turn180Mm - 52.6) < 1.2 && mBp.Micro3Pct > 95 && mBp.Micro3Pct < 104, mBp.ToString());
            // 2026-09-14: the DRIVER's classic formula (accel-classic.hpp) is 1 + a(x-off)^2/x, not the
            // straight line 1 + a(x-off) assumed before; the cap is reached at 302.6mm/s, not 294.
            Ok("breakpoint: cap saturates ~303mm/s under the driver's formula (below committed flick speed)",
               Math.Abs(Curve.ClassicCapSpeedCms(0.246, 0.5, 5.0) * 1000 / 57 - 302.6) < 1.0,
               (Curve.ClassicCapSpeedCms(0.246, 0.5, 5.0) * 1000 / 57).ToString("0.0"));
            Ok("driver classic formula pinned: Breakpoint sens at 5 c/ms = 1.9963 (the retired line said 2.107); BO6 at 5 c/ms = 1.425; unity at and below the offset",
               Math.Abs(Curve.ClassicGain(5, 0.246, 0.5, 5.0) - 1.9963) < 1e-4 && Math.Abs(Curve.ClassicGain(5, 0.105, 0.5, 3.6) - 1.42525) < 1e-4 &&
               Curve.ClassicGain(0.5, 0.246, 0.5, 5.0) == 1.0 && Curve.ClassicGain(0.1, 0.246, 0.5, 5.0) == 1.0 &&
               Math.Abs(Curve.ClassicGain(100, 0.246, 0.5, 5.0) - 5.0) < 1e-12);
            Ok("driver classic formula: offset 0 collapses to the old linear form (1 + a*x) - the two models agree only there",
               Math.Abs(Curve.ClassicGain(3, 0.105, 0, 3.6) - (1 + 0.105 * 3)) < 1e-12);
            var bo6 = cat.Find("bo6og")!;
            Ok("bo6og: classic 0.105/3.6/offset 0.5 at 57 px/mm, cm 37.70, no LUT, no filter",
               bo6.lut == null && bo6.cohOv == null && bo6.pxmm == 57 && bo6.cm == 37.7 &&
               bo6.adv.accel == 0.105 && bo6.adv.cap == 3.6 && bo6.adv.offset == 0.5);
            Ok("bo6og: rig sens 2.54 = the user's 14.70 @250dpi (37.70cm/360)",
               Math.Abs(Curve.SensFor(cat.games.First(g => g.id == "cod").K, Rig.From(bo6)) - 2.538) < 0.01,
               Curve.SensFor(cat.games.First(g => g.id == "cod").K, Rig.From(bo6)).ToString("0.000"));

            var finK = cat.games.First(g => g.id == "finals").K;
            Ok("The Finals K is the FIELD-VERIFIED 914400, not the OW2 copy it used to be",
               Math.Abs(finK - 914400) < 1e-6 && Math.Abs(finK - cat.games.First(g => g.id == "ow2").K) > 1,
               finK.ToString("0"));
            // EffectiveLut is a DENSE sample of the driver's classic formula (it drives canvas + measure)
            {
                var eff = Curve.EffectiveLut(bo6, 57);
                double worst = 0;
                foreach (var mms in new[] { 0.5, 1.9, 8.0, 8.8, 9.5, 12.0, 20.0, 37.0, 120.0, 214.0, 443.0, 700.0, 1450.0 })
                {
                    double c = mms * 57 / 1000.0;
                    double truth = Curve.ClassicGain(c, 0.105, 0.5, 3.6);
                    worst = Math.Max(worst, Math.Abs(Curve.GainAt(eff, mms) - truth));
                }
                Ok("EffectiveLut tracks the DRIVER's classic formula within 0.05% at 13 probe speeds (dense log-spaced sample, <= 257 points)",
                   worst < 5e-4 && eff.Length <= 257 && eff.Length >= 20, $"worst {worst:0.000000}  points {eff.Length}");
                bool mono = true; for (int i = 1; i < eff.Length; i++) if (eff[i][0] <= eff[i - 1][0]) mono = false;
                Ok("EffectiveLut x strictly increasing for every classic card (RawAccel LUT contract)",
                   mono && cat.presets.Where(p => !p.IsLut).All(p => { var e = Curve.EffectiveLut(p, p.pxmm); for (int i = 1; i < e.Length; i++) if (e[i][0] <= e[i - 1][0]) return false; return e.Length <= 257; }));
                {
                    var zc = new Preset { id = "zero-offset", adv = new Adv { accel = 0.105, cap = 3.6, offset = 0 } };
                    var zs = Curve.RawAccelPointsDistinct(Curve.EffectiveLut(zc, 57), 57).TrimEnd(';').Split(';')
                                  .Select(q => double.Parse(q.Split(',')[0], System.Globalization.CultureInfo.InvariantCulture)).ToArray();
                    bool zinc = zs.Length > 5 && zs[0] > 0; for (int i = 1; i < zs.Length; i++) if (zs[i] <= zs[i - 1]) zinc = false;
                    Ok("copy string for a zero-offset classic curve is strictly increasing at 3 dp (RawAccel's LUT box rejects duplicates)", zinc, zs.Length + " points");
                }
                var mB = Measure.Run(eff, Rig.From(bo6), t);
                Ok("bo6og measured via EffectiveLut: micro ~99% (unity below the offset, settle-window average), 180 ~58mm",
                   mB.Micro3Pct > 95 && mB.Micro3Pct < 104 && Math.Abs(mB.Turn180Mm - 58.4) < 1.5, mB.ToString());
            }
            Ok("every shipped LUT passes Curve.Check", cat.presets.All(p => Curve.Check(p, t).Count == 0),
               string.Join(" | ", cat.presets.Where(p => Curve.Check(p, t).Count > 0).Select(p => p.name + ": " + string.Join("; ", Curve.Check(p, t)))));
            var shelf = new Preset { id = "synthetic-shelf", pxmm = 90, cm = 27,
                lut = new[] { new[] { 2.66, 0.69 }, new[] { 5.32, 0.69 }, new[] { 8.0, 1.0 }, new[] { 1450.0, 1.0 } } };
            Ok("a low-end shelf still fails Curve.Check (RULE 1 enforced)", Curve.Check(shelf, t).Count > 0);

            // References preserved, with their measured pins
            var m = Measure.Run(fe.lut!, rig, t);
            Ok("Feather measured: onset two reports like every card (the directional creep probe; the old tremor-driven probe read 9ms)", Math.Abs(m.DeadMs - 2000.0 / t.reportHz) < 0.3, m.ToString());
            Ok("Feather measured: micro ~76% - its sub-unity floor now visibly costs micro fidelity (unity cards read ~99%)", m.Micro3Pct > 70 && m.Micro3Pct < 82, m.Micro3Pct.ToString("0.0"));
            Ok("180 travel Feather ~45mm @150ms", Math.Abs(Curve.Turn180Mm(fe.lut!, rig) - 45.0) < 1.0, Curve.Turn180Mm(fe.lut!, rig).ToString("0.0"));
            double feSpread = Measure.FlickSpreadPct(fe.lut!, rig, t);
            Ok("Feather flick spread on record (>20%)", feSpread > 20, feSpread.ToString("0.0") + "%");

            var pinned = cat.Find("hfmp")!.WithCohOv(new CohOv { hold = 0, tap = 1.0, tapArm = 1.0, tapHold = 60, tapBreak = 0.6 });
            var fpHf = FilterPlan.For(pinned);
            Ok("FilterPlan: a card that ships a pin keeps it on (Holdfast Master with the musket pin)", fpHf.TapDefaultOn && fpHf.TapHold == 60 && Math.Abs(fpHf.TapBreak - 0.6) < 0.01);
            var fpHfB = FilterPlan.For(cat.Find("hflla")!);
            Ok("FilterPlan: the Holdfast Tracker OFFERS the musket pin (60/0.6, default off)",
               !fpHfB.TapDefaultOn && fpHfB.TapHold == 60 && Math.Abs(fpHfB.TapBreak - 0.6) < 0.01);
            var fpRiv = FilterPlan.For(cat.Find("rivmp")!);
            Ok("FilterPlan: tracking goal gets short loose pin (25ms/0.45mm)", !fpRiv.TapDefaultOn && fpRiv.TapHold == 25 && Math.Abs(fpRiv.TapBreak - 0.45) < 0.01);
            Ok("FilterPlan: hold smoothing offered nowhere (the delayed feel)",
               cat.presets.All(p => !FilterPlan.For(p).HoldOffered));
            Ok("FilterPlan: TapOnly() is the passthrough hybrid", fpRiv.TapOnly().IsTapOnly);

            // ---- latency tiers + role policy (3.2): named exceptions with evidence ----
            Ok("tier: filterless build = T0, tap-pin = T1",
               Core.FilterCatalog.BuildTier(cat.Find("rivmp")!) == "T0" &&
               Core.FilterCatalog.BuildTier(pinned) == "T1" &&
               Core.FilterCatalog.BuildTier(cat.Find("hfmp")!) == "T0");
            Ok("tier: hold smoothing = T3, Lead Sight = T5 - and since 2026-10-23 no shipped card runs either (the old wildcards were the delayed feel)",
               Core.FilterCatalog.BuildTier(new Preset { cohOv = new CohOv { hold = 120, tap = 1 } }) == "T3" &&
               Core.FilterCatalog.BuildTier(new Preset { cohOv = new CohOv { hold = 0, lead = 8, tap = 1 } }) == "T5" &&
               cat.presets.All(p => Core.FilterCatalog.BuildTier(p) is "T0" or "T1"));
            Ok("role policy: every strict-role build has zero Apply blockers",
               cat.presets.Where(p => Core.RolePolicy.MaxTier(Core.RolePolicy.RoleOf(p)) <= 2)
                          .All(p => Core.RolePolicy.ApplyBlockers(p).Count == 0));
            Ok("field verdict 2026-08-29: NO shipped build runs a sub-unity floor (masters + Slow Center at exactly 1.0)",
               cat.presets.All(p => Core.RolePolicy.FloorOf(p) >= 0.999 || Core.RolePolicy.RoleOf(p) == "Reference" || Core.RolePolicy.RoleOf(p) == "Lab") &&
               Core.GameLab.Games.All(g => cat.Find(g.Prefix + "mp") is Preset m && !m.IsLut && Core.RolePolicy.FloorOf(m) == 1.0) &&
               cat.Find("breakslow")!.lut == null && cat.Find("breakslow")!.adv.offset == Core.Goat.Offset &&
               Core.RolePolicy.FloorExceptions.Count == 0);
            var badMaster = new Preset { id = "synthetic", name = "Master Preset", pxmm = 57, cm = 37.7, snap = 9,
                adv = new Adv { reset = 80 },
                lut = new[] { new[] { 2.66, 0.90 }, new[] { 15.0, 1.0 }, new[] { 1450.0, 1.0 } } };
            Ok("role policy: a Master COPYING the 0.90 floor without the exception FAILS QC",
               Core.RolePolicy.ApplyBlockers(badMaster).Count > 0);
            var badMaster2 = new Preset { id = "synthetic2", name = "Master Preset", pxmm = 57, cm = 37.7, snap = 9,
                adv = new Adv { reset = 80 }, cohOv = new CohOv { hold = 200, tap = 1.0 } };
            Ok("role policy: a Master with hold smoothing (T3) is blocked from Apply",
               Core.RolePolicy.ApplyBlockers(badMaster2).Count > 0);
            var labCard = new Preset { id = "synthetic-lab", name = "Slipstream", pxmm = 57, cm = 37.7, adv = new Adv { reset = 80 }, cohOv = new CohOv { hold = 120, tap = 1 } };
            Ok("role policy: Lab names are informational only (T3 allowed) - and no shipped card is Lab any more",
               Core.RolePolicy.RoleOf(labCard) == "Lab" && Core.RolePolicy.ApplyBlockers(labCard).Count == 0 &&
               !cat.presets.Any(p => Core.RolePolicy.RoleOf(p) == "Lab"));
            Ok("role policy: evidence artifacts exist for every cited id (snap field, floor-feel verdict)",
               Core.RolePolicy.FloorExceptions.Values.Select(e => e.EvidenceId).Distinct()
                   .Append(Core.RolePolicy.SnapEvidenceId).Append(Core.RolePolicy.FloorFeelEvidenceId)
                   .All(id => File.Exists(Path.Combine(Core.RolePolicy.EvidenceDir, id + ".json"))));

            // ---- filter plans (3.1): derived by the exporter, one per build ----
            Ok("every build declares a filter plan; HDL entry mirrors hdlMax",
               cat.presets.All(p => p.filters != null && p.filters.Count >= 1 &&
                   p.filters[0].id == "Hover_Distance_Limiter" && p.filters[0].on &&
                   Math.Abs(p.filters[0].settings["Hover_max"] - p.hdlMax) < 1e-9));
            Ok("plan round-trip: every cohOv build's plan carries the coherence properties verbatim",
               cat.presets.Where(p => p.cohOv != null).All(p =>
                   p.filters!.Any(f => f.id == "CoherenceStabilizerTabletSpace" && f.on &&
                       Math.Abs(f.settings["TapHoldMs"] - p.cohOv!.tapHold) < 1e-9 &&
                       Math.Abs(f.settings["HoldTimeMs"] - p.cohOv!.hold) < 1e-9 &&
                       Math.Abs(f.settings["LeadMs"] - p.cohOv!.lead) < 1e-9)) &&
               cat.presets.Count(p => p.filters!.Any(f => f.id.Contains("Coherence"))) == cat.presets.Count(p => p.cohOv != null));

            // ---- 2026-10-04: Deadlock ----
            {
                var dl = cat.presets.Where(p => p.group == "Deadlock").ToList();
                var dk = cat.games.First(g => g.id == "deadlock").K;
                Ok("Deadlock: the six lab roles, each at its own base (sens = K / (eDPI x cm), Source 2 yaw - run the 360 calibration), Y/X 1.00 (the GOAT), third-person, no game filter, zero Apply blockers",
                   dl.Count == 6 && dl.All(p => p.desc.Contains(Curve.SensFor(dk, Rig.From(p)).ToString("0.000", System.Globalization.CultureInfo.InvariantCulture))) && dl.All(p => p.Yx == 1.0)
                   && dl.All(Core.ThirdPerson.IsThirdPerson) && dl.All(p => p.filters!.All(f => !f.id.StartsWith("AimForge.Filters.")))
                   && dl.All(p => Core.RolePolicy.ApplyBlockers(p).Count == 0 && !p.IsLut && Core.FilterCatalog.BuildTier(p).CompareTo("T2") < 0),
                   string.Join(",", dl.Select(p => p.id)));
            }

            // ---- discovery + plan validation against the LIVE machine (skipped if OTD absent) ----
            if (otd != null && otd.Installed)
            {
                try
                {
                    var fcat = Core.FilterCatalog.Discover(otd);
                    // >= 19: the game filters register themselves on their first apply, growing
                    // the count toward 29 - a fixed number here would rot. Structure is the pin.
                    Ok("catalog: >=19 registered rows, every one carrying a tier",
                       fcat.Count(f => f.Registered) >= 19 && fcat.Where(f => f.Registered).All(f => f.Tier.StartsWith("T")),
                       fcat.Count(f => f.Registered).ToString());
                    Ok("folder map: every plugin folder mapped or excluded with a reason (0 unmapped, 0 dir-only dupes)",
                       fcat.All(f => !f.Note.Contains("UNMAPPED")) && fcat.All(f => !f.Path.StartsWith("dir:")));
                    Ok("folder map: every registered path is provided by a mapped folder or a reasoned built-in",
                       fcat.Where(f => f.Registered).All(f =>
                           Core.FilterCatalog.FolderMap.Values.Any(pfx => pfx.Any(x => f.Path.StartsWith(x, StringComparison.OrdinalIgnoreCase))) ||
                           Core.FilterCatalog.BuiltinRegistrations.ContainsKey(f.Path)),
                       string.Join(",", fcat.Where(f => f.Registered &&
                           !Core.FilterCatalog.FolderMap.Values.Any(pfx => pfx.Any(x => f.Path.StartsWith(x, StringComparison.OrdinalIgnoreCase))) &&
                           !Core.FilterCatalog.BuiltinRegistrations.ContainsKey(f.Path)).Select(f => f.Path)));

                    var master = cat.Find("owmp")!;
                    var t4plan = new System.Collections.Generic.List<FilterSpec> {
                        new FilterSpec { id = "RadialFollowSmoothingTabletSpace", on = true } };
                    Ok("plan validation: T4 interpolator on a Master is a BLOCKER",
                       Core.RolePolicy.ValidatePlan(master, t4plan, fcat).blockers.Count > 0);
                    var stacked = new System.Collections.Generic.List<FilterSpec> {
                        new FilterSpec { id = "CoherenceStabilizerTabletSpace", on = true },
                        new FilterSpec { id = "CHATTER_EXTERMINATOR_RAW", on = true } };
                    Ok("plan validation: stacked antichatter on a Master is a BLOCKER",
                       Core.RolePolicy.ValidatePlan(master, stacked, fcat).blockers.Count > 0);
                    var unknown = new System.Collections.Generic.List<FilterSpec> {
                        new FilterSpec { id = "TotallyMadeUpFilter", on = true } };
                    var vr = Core.RolePolicy.ValidatePlan(master, unknown, fcat);
                    Ok("plan validation: unknown id = warning + never written, apply not blocked",
                       vr.blockers.Count == 0 && vr.warnings.Count == 1);
                    Ok("plan validation: Reconstructor on Wacom EMR is refused on a strict role",
                       Core.RolePolicy.ValidatePlan(master, new System.Collections.Generic.List<FilterSpec> {
                           new FilterSpec { id = "Reconstructor", on = true } }, fcat).blockers.Count > 0);
                    // session 3 game-filter rules
                    Ok("plan validation: a *.Lab game filter on a Master role is REFUSED",
                       Core.RolePolicy.ValidatePlan(master, new System.Collections.Generic.List<FilterSpec> {
                           new FilterSpec { id = "AimForge.Filters.ValLab", on = true } }, fcat).blockers.Count > 0);
                    Ok("plan validation: two game-Master personalities at once is REFUSED",
                       Core.RolePolicy.ValidatePlan(master, new System.Collections.Generic.List<FilterSpec> {
                           new FilterSpec { id = "AimForge.Filters.Ow2Master", on = true },
                           new FilterSpec { id = "AimForge.Filters.CodMaster", on = true } }, fcat).blockers.Count > 0);
                    Ok("plan validation: a cross-game filter is a WARNING, not a block",
                       Core.RolePolicy.ValidatePlan(master, new System.Collections.Generic.List<FilterSpec> {
                           new FilterSpec { id = "AimForge.Filters.ValMaster", on = true } }, fcat) is var cg &&
                       cg.blockers.Count == 0 && cg.warnings.Any(w => w.Contains("cross-game")));
                }
                catch (Exception e) { Ok("catalog/plan validation ran", false, e.Message); }
            }

            // ---- session 3: game-filter behavior (driving the SHIPPING GameFilterCore) ----
            {
                // the catalogue's measured report rate; synthetic jitter is scaled as a VELOCITY (J) so each scenario is the
                // same physical motion at any rate (2026-09-16 audit: these ran at the retired 266 Hz)
                double DT = 1000.0 / cat.tablet.reportHz, J = DT / (1000.0 / 266.0);
                AimForge.Filters.GameFilterCore Mk(AimForge.Filters.GameFilterCore.Game g, AimForge.Filters.GameFilterCore.Member m)
                    => new AimForge.Filters.GameFilterCore { Which = g, Kind = m };

                // CoD rail: vertical track motion - along preserved, orthogonal shrunk; flick raw
                var cod = Mk(AimForge.Filters.GameFilterCore.Game.Cod, AimForge.Filters.GameFilterCore.Member.Master);
                cod.RailStrength = 0.35;
                var pos = new System.Numerics.Vector2(50, 50);
                cod.Filter(pos, DT);
                double dy = 100.0 * DT / 1000.0; // 100 mm/s vertical = track zone
                double inOrtho = 0, outOrtho = 0, inAlong = 0, outAlong = 0;
                var prevOut = pos;
                for (int i = 0; i < 80; i++)
                {
                    double jx = (i % 2 == 0 ? 0.05 : -0.05) * J;
                    var np = new System.Numerics.Vector2(pos.X + (float)jx, pos.Y + (float)dy);
                    var o = cod.Filter(np, DT);
                    if (i > 20) { inAlong += dy; outAlong += o.Y - prevOut.Y; inOrtho += Math.Abs(np.X - pos.X); outOrtho += Math.Abs(o.X - prevOut.X); }
                    pos = np; prevOut = o;
                }
                Ok("CoD rail: along-axis travel preserved (>99%), orthogonal jitter shrunk (~1-rail)",
                   Math.Abs(outAlong / inAlong - 1.0) < 0.01 && outOrtho / inOrtho > 0.5 && outOrtho / inOrtho < 0.8,
                   $"along {outAlong / inAlong:0.000}  ortho {outOrtho / inOrtho:0.000}");
                cod.Reset(); pos = new System.Numerics.Vector2(50, 50); var codPrev = cod.Filter(pos, DT);
                bool flickExact = true;   // relative output: this report's delta is what reaches the cursor
                for (int i = 0; i < 30; i++)
                { var np = new System.Numerics.Vector2(pos.X + (float)(400.0 * DT / 1000.0), pos.Y); var o = cod.Filter(np, DT); if (((o - codPrev) - (np - pos)).Length() > 1e-5) flickExact = false; pos = np; codPrev = o; }
                Ok("CoD flick: bit-identical to input (rail never touches flick zone)", flickExact);

                // Valorant: rest gate holds; 70-degree jig flushes the same report
                var val = Mk(AimForge.Filters.GameFilterCore.Game.Val, AimForge.Filters.GameFilterCore.Member.Master);
                val.MaxDzMm = 0.45; val.KneeMmS = 8; val.FlushOnTurnDeg = 60;
                pos = new System.Numerics.Vector2(50, 50); val.Filter(pos, DT);
                var held = System.Numerics.Vector2.Zero; bool gated = true;
                for (int i = 0; i < 60; i++)
                { var np = new System.Numerics.Vector2(50 + (float)(i % 2 == 0 ? 0.01 : -0.01), 50); var o = val.Filter(np, DT); if (i == 0) held = o; else if ((o - held).Length() > 1e-6) gated = false; pos = np; }
                Ok("Val rest gate: tremor-scale jitter at rest produces ZERO output motion", gated);
                // a slow tremor creep builds a real held offset first; the flush then passes the HAND's delta and keeps
                // the offset (2026-09-16 review: snapping onto the pen repaid it in one report, sometimes backwards)
                val.Reset(); pos = new System.Numerics.Vector2(50, 50); var valOut = val.Filter(pos, 2000);
                for (int i = 0; i < 40; i++) { pos = new System.Numerics.Vector2(50 + 0.004f * i, 50 + (i % 2 == 0 ? 0.005f : -0.005f)); valOut = val.Filter(pos, DT); }
                double valOff = (pos - valOut).Length();
                var jig = new System.Numerics.Vector2(pos.X - 0.11f, pos.Y + 0.02f);               // fast jig the other way
                var flush = val.Filter(jig, DT);
                Ok("Val flush: a fast jig passes the hand's own delta that report and keeps the held offset (never repaid)",
                   valOff > 0.02 && ((flush - valOut) - (jig - pos)).Length() < 1e-5 && Math.Abs((jig - flush).Length() - valOff) < 0.03 &&
                   Enumerable.Range(0, 30).All(i => (val.Filter(new System.Numerics.Vector2(jig.X + (i % 2 == 0 ? 0.005f : -0.005f), jig.Y), DT) - flush).Length() < 1e-6),
                   $"held offset {valOff:0.000} mm, after {(jig - flush).Length():0.000} mm");

                // Apex anti-trail: a real turn = raw this report
                var apx = Mk(AimForge.Filters.GameFilterCore.Game.Apex, AimForge.Filters.GameFilterCore.Member.Master);
                apx.TrackGlue = 0.15; apx.MaxDzMm = 0.35; apx.KneeMmS = 10; apx.AntiTrailTurnDeg = 25;
                pos = new System.Numerics.Vector2(20, 50); var apxOut = apx.Filter(pos, DT);
                for (int i = 0; i < 60; i++) { pos = new System.Numerics.Vector2(20 + 0.004f * i, 50 + (i % 2 == 0 ? 0.005f : -0.005f)); apxOut = apx.Filter(pos, DT); }
                double apxOff = (pos - apxOut).Length();                                            // the deadzone's held offset
                var turned = new System.Numerics.Vector2(pos.X + 0.1f, pos.Y + 0.35f);            // ~74 deg turn above the knee
                var apxTurn = apx.Filter(turned, DT);
                Ok("Apex anti-trail: a turn > 25 deg passes the HAND's own delta this report and keeps the held offset (no residual pin, no repaid offset)",
                   apxOff > 0.02 && ((apxTurn - apxOut) - (turned - pos)).Length() < 1e-5 && Math.Abs((turned - apxTurn).Length() - apxOff) < 1e-4 &&
                   Enumerable.Range(0, 30).All(i => (apx.Filter(new System.Numerics.Vector2(turned.X + (i % 2 == 0 ? 0.005f : -0.005f), turned.Y), DT) - apxTurn).Length() < 1e-6),
                   $"held offset {apxOff:0.000} mm, after {(turned - apxTurn).Length():0.000} mm");

                // Rivals/Apex re-anchor never repays the withheld rest offset as a spike (2026-09-16 audit: the flyer spike)
                var rvl = Mk(AimForge.Filters.GameFilterCore.Game.Rivals, AimForge.Filters.GameFilterCore.Member.Master);
                rvl.MaxDzMm = 0.4; rvl.KneeMmS = 10; rvl.TrackGlue = 0; rvl.AntiTrailTurnDeg = 20;
                pos = new System.Numerics.Vector2(50, 50); var rvOut = rvl.Filter(pos, DT); double worstExcess = 0;
                var rvRnd = new Random(7);
                for (int i = 0; i < 400; i++)
                {
                    double vx = i < 200 ? 0 : i < 260 ? 300 : i < 320 ? -300 : 0;          // rest, flick right, flick back, rest
                    var np = new System.Numerics.Vector2(pos.X + (float)(vx * DT / 1000.0 + (rvRnd.NextDouble() - 0.5) * 0.06 * J), pos.Y + (float)((rvRnd.NextDouble() - 0.5) * 0.06 * J));
                    var o = rvl.Filter(np, DT);
                    worstExcess = Math.Max(worstExcess, (o - rvOut).Length() - (np - pos).Length());
                    pos = np; rvOut = o;
                }
                Ok("Rivals Master: no report ever moves further than the hand did (the re-anchor keeps the rest offset instead of repaying it)",
                   worstExcess < 1e-4, $"worst excess {worstExcess:0.00000} mm/report");

                // Rivals Master WITH TrackGlue: glue bias built while tracking must never be released as a one-report step
                var rvg = Mk(AimForge.Filters.GameFilterCore.Game.Rivals, AimForge.Filters.GameFilterCore.Member.Master);
                rvg.MaxDzMm = 0.4; rvg.KneeMmS = 10; rvg.TrackGlue = 0.12; rvg.AntiTrailTurnDeg = 20; rvg.IgnoreSnap = 1;
                pos = new System.Numerics.Vector2(50, 50); var rgOut = rvg.Filter(pos, DT); double worstStep = 0, maxBias = 0;
                var rgRnd = new Random(11);
                for (int i = 0; i < 600; i++)
                {
                    double hdg = i < 250 ? 0 : i < 300 ? (i - 250) * 1.8 : i < 450 ? 90 : 200;   // track, sweeping turn, track, sharp turn
                    double sp = i % 150 < 5 ? 40 : 120;                                               // with speed dips
                    double rad = hdg * Math.PI / 180, st = sp * DT / 1000;
                    var np = new System.Numerics.Vector2(pos.X + (float)(st * Math.Cos(rad) + (rgRnd.NextDouble() - 0.5) * 0.03 * J),
                                                         pos.Y + (float)(st * Math.Sin(rad) + (rgRnd.NextDouble() - 0.5) * 0.03 * J));
                    var o = rvg.Filter(np, DT);
                    worstStep = Math.Max(worstStep, (o - rgOut).Length() - (np - pos).Length());
                    maxBias = Math.Max(maxBias, (np - o).Length());
                    pos = np; rgOut = o;
                }
                Ok("Rivals Master + TrackGlue 0.12: no single-report output step exceeds the input step (glue bias is never released as a jump)",
                   worstStep < 1e-4, $"worst excess {worstStep:0.00000} mm/report, max bias {maxBias:0.000} mm");

                // OW2 hybrid: rail at 8 mm/s, raw at 40 mm/s
                var owf = Mk(AimForge.Filters.GameFilterCore.Game.Ow2, AimForge.Filters.GameFilterCore.Member.Master);
                owf.RailStrength = 0.25; owf.RailCeilMmS = 18; owf.SnapDeg = 9;
                pos = new System.Numerics.Vector2(50, 50); owf.Filter(pos, DT);
                double s8 = 8.0 * DT / 1000.0, c45 = s8 / Math.Sqrt(2);
                double railDeviation = 0;
                for (int i = 0; i < 80; i++)
                {
                    var np = new System.Numerics.Vector2(pos.X + (float)c45, pos.Y + (float)(c45 + ((i % 2 == 0 ? 0.02 : -0.02) * J)));
                    var o = owf.Filter(np, DT);
                    if (i > 30) railDeviation = Math.Max(railDeviation, (o - np).Length());
                    pos = np;
                }
                owf.Reset(); pos = new System.Numerics.Vector2(50, 50); var owPrev = owf.Filter(pos, DT);
                bool rawAt40 = true;   // relative output: compare what reaches the cursor - this report's delta
                for (int i = 0; i < 40; i++)
                { var np = new System.Numerics.Vector2(pos.X + (float)(40.0 * DT / 1000 / 1.414), pos.Y + (float)(40.0 * DT / 1000 / 1.414 + ((i % 2 == 0 ? 0.02 : -0.02) * J))); var o = owf.Filter(np, DT); if (i > 10 && ((o - owPrev) - (np - pos)).Length() > 1e-4) rawAt40 = false; pos = np; owPrev = o; }
                Ok("OW2 hybrid: rail engages at 8 mm/s (output deviates from raw) and is OFF above the 18 mm/s ceiling",
                   railDeviation > 0.005 && rawAt40, $"dev@8 {railDeviation:0.0000}");

                // Finals brake: exactly BrakeHoldReports scaled reports, then raw
                var fin = Mk(AimForge.Filters.GameFilterCore.Game.Finals, AimForge.Filters.GameFilterCore.Member.Master);
                fin.BrakeDropFrac = 0.45; fin.BrakeWindowMs = 40; fin.BrakeGain = 0.55; fin.BrakeHoldReports = 2;
                pos = new System.Numerics.Vector2(20, 50); fin.Filter(pos, DT); prevOut = pos;
                for (int i = 0; i < 12; i++) { pos = new System.Numerics.Vector2(pos.X + (float)(200.0 * DT / 1000), 50); prevOut = fin.Filter(pos, DT); }
                double slow = 40.0 * DT / 1000;
                var scaled = new double[4];
                for (int i = 0; i < 4; i++)
                { pos = new System.Numerics.Vector2(pos.X + (float)slow, 50); var o = fin.Filter(pos, DT); scaled[i] = (o.X - prevOut.X) / slow; prevOut = o; }
                Ok("Finals brake: after a 200 mm/s swing, exactly 2 reports scaled by BrakeGain, then raw resumes",
                   Math.Abs(scaled[0] - 0.55) < 0.02 && Math.Abs(scaled[1] - 0.55) < 0.02 && scaled[2] > 0.98 && scaled[3] > 0.98,
                   string.Join(",", scaled.Select(x => x.ToString("0.00"))));
                // re-arm law (2026-09-16 audit): only a swing over TrackUntilMmS arms the brake
                bool finRearmed = true;
                for (int sw = 0; sw < 3; sw++)
                {
                    for (int i = 0; i < 12; i++) { pos = new System.Numerics.Vector2(pos.X + (float)(200.0 * DT / 1000), 50); prevOut = fin.Filter(pos, DT); }
                    var sc = new double[2];
                    for (int i = 0; i < 2; i++) { pos = new System.Numerics.Vector2(pos.X + (float)slow, 50); var o = fin.Filter(pos, DT); sc[i] = (o.X - prevOut.X) / slow; prevOut = o; }
                    if (Math.Abs(sc[0] - 0.55) > 0.02 || Math.Abs(sc[1] - 0.55) > 0.02) finRearmed = false;
                }
                fin.Reset(); pos = new System.Numerics.Vector2(20, 50); prevOut = fin.Filter(pos, DT); bool finNoBrake = true;
                for (int i = 0; i < 12; i++) { pos = new System.Numerics.Vector2(pos.X + (float)(120.0 * DT / 1000), 50); prevOut = fin.Filter(pos, DT); }
                for (int i = 0; i < 4; i++) { pos = new System.Numerics.Vector2(pos.X + (float)slow, 50); var o = fin.Filter(pos, DT); if ((o.X - prevOut.X) / slow < 0.98) finNoBrake = false; prevOut = o; }
                Ok("Finals brake: re-arms on every swing over 150 mm/s, and a 120 mm/s swing never brakes", finRearmed && finNoBrake);
                // 2026-09-16 review: the arm expires with the swing (an eased-out swing left it armed for a later tap stop)
                fin.Reset(); pos = new System.Numerics.Vector2(20, 50); prevOut = fin.Filter(pos, DT);
                for (int i = 0; i < 12; i++) { pos = new System.Numerics.Vector2(pos.X + (float)(200.0 * DT / 1000), 50); prevOut = fin.Filter(pos, DT); }
                for (double v = 200; v > 5; v *= Math.Exp(-DT / 100.0)) { pos = new System.Numerics.Vector2(pos.X + (float)(v * DT / 1000), 50); prevOut = fin.Filter(pos, DT); }
                for (int i = 0; i < 720; i++) prevOut = fin.Filter(pos, DT);                       // 2 s at rest, pen down
                for (int i = 0; i < 12; i++) { pos = new System.Numerics.Vector2(pos.X + (float)(100.0 * DT / 1000), 50); prevOut = fin.Filter(pos, DT); }
                double tapStop = 1;
                for (int i = 0; i < 3; i++) { pos = new System.Numerics.Vector2(pos.X + (float)(20.0 * DT / 1000), 50); var o = fin.Filter(pos, DT); tapStop = Math.Min(tapStop, (o.X - prevOut.X) / (20.0 * DT / 1000)); prevOut = o; }
                Ok("Finals brake: an eased-out swing disarms - a 100 mm/s stop 2 s later passes untouched", tapStop > 0.98, $"scale {tapStop:0.00}");
                fin.Reset(); pos = new System.Numerics.Vector2(20, 50); prevOut = fin.Filter(pos, DT); double slowMin = 1;
                for (int i = 1; i <= 144; i++)   // a 60 mm half-sine swing over 400 ms (peak ~236 mm/s), rest to rest
                {
                    double vS = 60.0 * Math.PI / 2 / 0.4 * Math.Sin(Math.PI * i / 144.0), stepS = vS * DT / 1000;
                    pos = new System.Numerics.Vector2(pos.X + (float)stepS, 50); var o = fin.Filter(pos, DT);
                    if (stepS > 1e-4 && i > 100) slowMin = Math.Min(slowMin, (o.X - prevOut.X) / stepS); prevOut = o;
                }
                Ok("Finals brake: a slow 60 mm / 400 ms swing still brakes at its own stop", Math.Abs(slowMin - 0.55) < 0.02, $"min scale {slowMin:0.00}");
                // withheld motion never switches the brake off: 12 same-direction 300 -> 100 mm/s events all brake
                fin.Reset(); pos = new System.Numerics.Vector2(20, 50); prevOut = fin.Filter(pos, DT); int finFull = 0;
                for (int ev = 0; ev < 12; ev++)
                {
                    for (int i = 0; i < 12; i++) { pos = new System.Numerics.Vector2(pos.X + (float)(300.0 * DT / 1000), 50); prevOut = fin.Filter(pos, DT); }
                    bool both = true;
                    for (int i = 0; i < 30; i++)
                    { pos = new System.Numerics.Vector2(pos.X + (float)(100.0 * DT / 1000), 50); var o = fin.Filter(pos, DT); if (i < 2 && Math.Abs((o.X - prevOut.X) / (100.0 * DT / 1000) - 0.55) > 0.02) both = false; prevOut = o; }
                    if (both) finFull++;
                }
                Ok("Finals brake: 12 same-direction swing-stops in one stroke all brake at 0.55 (the bias clamp no longer disables it)", finFull == 12, $"{finFull}/12");
                // CoD rail: a steady 5-degree lean inside the cone stays railed for the whole stroke
                var codLean = Mk(AimForge.Filters.GameFilterCore.Game.Cod, AimForge.Filters.GameFilterCore.Member.Master);
                codLean.RailStrength = 0.35;
                pos = new System.Numerics.Vector2(50, 50); prevOut = codLean.Filter(pos, DT); double leanIn = 0, leanOut = 0;
                double lstep = 100.0 * DT / 1000, lx = lstep * Math.Sin(5 * Math.PI / 180), ly = lstep * Math.Cos(5 * Math.PI / 180);
                for (int i = 0; i < 720; i++)
                {
                    var np = new System.Numerics.Vector2(pos.X + (float)lx, pos.Y + (float)ly); var o = codLean.Filter(np, DT);
                    if (i >= 400) { leanIn += np.X - pos.X; leanOut += o.X - prevOut.X; }
                    pos = np; prevOut = o;
                }
                Ok("CoD rail: a 5-degree lean held 2 s is still railed at the end (~0.65 of its sideways travel)",
                   Math.Abs(leanOut / leanIn - 0.65) < 0.02, $"{leanOut / leanIn:0.000}");
                // relative output: after a gap or a lift the cursor gets the hand's own delta - never the withheld offset
                // (OTD clears its last position only when the gap exceeds its reset delay; a lift does not clear it)
                var gap = new System.Numerics.Vector2(pos.X + (float)lx, pos.Y + (float)ly); var og = codLean.Filter(gap, 60);
                bool gapOk = ((og - prevOut) - (gap - pos)).Length() < 1e-4; pos = gap; prevOut = og;
                codLean.Reset(); var lift = new System.Numerics.Vector2(pos.X + 0.3f, pos.Y - 0.2f); var ol = codLean.Filter(lift, 30);
                bool liftOk = ((ol - prevOut) - (lift - pos)).Length() < 1e-4;
                var farPen = new System.Numerics.Vector2(120, 80); bool rebaseOk = (codLean.Filter(farPen, 1500) - farPen).Length() < 1e-4;
                var lab = Mk(AimForge.Filters.GameFilterCore.Game.Cod, AimForge.Filters.GameFilterCore.Member.Lab); lab.HoldAssistMs = 120;
                var lp = new System.Numerics.Vector2(20, 50); var lo = lab.Filter(lp, DT); var lo0 = lo;
                for (int i = 0; i < 27; i++) { lp.X += (float)(400.0 * DT / 1000); lo = lab.Filter(lp, DT); }
                lab.Reset(); lo = lab.Filter(lp, 30);
                for (int i = 0; i < 720; i++) lo = lab.Filter(lp, DT);
                Ok("CoD Lab smoother: the lag it owes at a quick lift is still delivered (the cursor ends where the hand went)", Math.Abs((lo.X - lo0.X) - (lp.X - 20)) < 0.01, $"{lo.X - lo0.X:0.000} of {lp.X - 20:0.000} mm");
                Ok("game filters: a 60 ms gap or a quick lift passes the hand's delta (no offset jump); only a gap past RebaseMs rebases onto the pen",
                   (prevOut - pos).Length() > 0.5 && gapOk && liftOk && rebaseOk);

                // Holdfast identity
                var hf2 = Mk(AimForge.Filters.GameFilterCore.Game.Holdfast, AimForge.Filters.GameFilterCore.Member.Master);
                pos = new System.Numerics.Vector2(50, 50); hf2.Filter(pos, DT); bool ident = true;
                for (int i = 0; i < 30; i++) { pos = new System.Numerics.Vector2(pos.X + 0.13f, pos.Y - 0.07f); if ((hf2.Filter(pos, DT) - pos).Length() > 1e-6) ident = false; }
                Ok("Holdfast: output == input, bit-exact identity", ident);
            }

            // ---- 2026-09-16 audit: the apply path carries each card's authored filters ----
            {
                var mismatched = new System.Collections.Generic.List<string>();
                foreach (var p in cat.presets)
                {
                    var e = FilterPlan.Fold(p, FilterPlan.Prefill(p));
                    bool sameFilters = (p.filters ?? new System.Collections.Generic.List<FilterSpec>()).Count == (e.filters ?? new System.Collections.Generic.List<FilterSpec>()).Count &&
                        (p.filters ?? new System.Collections.Generic.List<FilterSpec>()).Zip(e.filters ?? new System.Collections.Generic.List<FilterSpec>(),
                            (a, b) => a.id == b.id && a.on == b.on && a.settings.Count == b.settings.Count && a.settings.All(kv => b.settings.TryGetValue(kv.Key, out var bv) && bv == kv.Value)).All(x => x);
                    bool sameCoh = (p.cohOv == null) == (e.cohOv == null) && (p.cohOv == null ||
                        System.Text.Json.JsonSerializer.Serialize(p.cohOv) == System.Text.Json.JsonSerializer.Serialize(e.cohOv));
                    if (!sameFilters || !sameCoh || ReferenceEquals(p, e) || ReferenceEquals(p.adv, e.adv)) mismatched.Add(p.id + (sameFilters ? "" : " filters") + (sameCoh ? "" : " cohOv"));
                }
                Ok("apply fold: an untouched GUI apply is a COPY that reproduces every card exactly - declared game-filter plan and stabilizer overlay (lead/hold) included",
                   mismatched.Count == 0 && FilterPlan.Fold(cat.Find("bo6og")!, FilterPlan.Prefill(cat.Find("bo6og")!)).filters!.Any(f => f.id == "AimForge.Filters.CodMaster" && f.on),
                   mismatched.Count == 0 ? "all " + cat.presets.Count + " cards" : string.Join(", ", mismatched));
                Ok("tap-pin defaults by GAME: rivpsy 25/0.45, owsol 30/0.5, hdlla 35/0.6, hfllb 60/0.6, vallla 45/0.6, bo6og 30/0.9, feather generic 45/0.8",
                   new[] { ("rivpsy", 25.0, 0.45), ("owsol", 30.0, 0.5), ("hdlla", 35.0, 0.6), ("hfllb", 60.0, 0.6), ("vallla", 45.0, 0.6), ("bo6og", 30.0, 0.9), ("feather", 45.0, 0.8) }
                       .All(t => cat.Find(t.Item1) is Preset tp && FilterPlan.For(tp) is var fp && fp.TapHold == t.Item2 && fp.TapBreak == t.Item3));
                Ok("every shipped group maps to a game (or is the Reference group); every game id resolves in the catalogue",
                   cat.presets.All(p => Core.FilterCatalog.GameOfGroup(p.group) != null || p.group.StartsWith("Reference")) &&
                   cat.presets.Select(p => Core.FilterCatalog.GameIdOf(p.group)).Where(g => g != null).All(g => cat.games.Any(x => x.id == g)));
                // micro-aim through the SHIPPED plan (2026-09-16 audit): a game filter may never erase slow corrections
                var eaten = cat.presets.Where(p => Core.RolePolicy.MaxTier(Core.RolePolicy.RoleOf(p)) <= 3 && Core.PlanFilters.Factory(p) != null)
                    .Select(p => (p, m: Measure.Run(Curve.EffectiveLut(p, p.pxmm), Rig.From(p), cat.tablet, Core.PlanFilters.Factory(p))))
                    .Where(x => x.m.Micro3Pct < 90 || x.m.DeadMs > 2000.0 / cat.tablet.reportHz + 0.3)
                    .Select(x => $"{x.p.id} micro {x.m.Micro3Pct:0}% onset {x.m.DeadMs:0}ms").ToList();
                Ok("no strict-role card's SHIPPED plan erases micro-aim: through its game filters, micro >= 90% and onset <= two reports (the Val/Apex/Rivals rest deadzones read 3-7% / 139 ms and were retired)",
                   eaten.Count == 0, eaten.Count == 0 ? "every strict card with a game filter is clean" : string.Join(", ", eaten));
                // Cadence Lock: a gap still inside one stroke is priced over the reports it spans, never capped short
                var cc = new AimForge.Filters.CadenceCore { NominalHz = 360, ClassicAccel = 0, UnitsPerMm = 100 };
                double cdt = 1000.0 / 360; var cp = new System.Numerics.Vector2(1000, 1000); cc.Filter(cp, cdt);
                for (int i = 0; i < 40; i++) { cp.X += (float)(300.0 * cdt / 1000 * 100); cc.Filter(cp, cdt); }
                double gap = 13 * cdt;                                   // 36.1 ms: past the old cap of 8, inside ResetMs 50
                cp.X += (float)(300.0 * gap / 1000 * 100); cc.Filter(cp, gap);
                Ok("Cadence Lock: a 13-report (36 ms) gap at 300 mm/s reads 300 mm/s - the old cap of 8 read it 1.6x fast",
                   Math.Abs(cc.LastSpeedMms - 300) / 300 < 0.02, $"{cc.LastSpeedMms:0.0} mm/s over {cc.LastReports} reports");
            }

            // ---- 2026-09-07: Cadence Lock engine (driving the SHIPPING CadenceCore) ----
            {
                const double DT = 1000.0 / 360.0;
                var bo = cat.Find("bo6og")!; var rgB = Rig.From(bo);
                var lutB = Curve.EffectiveLut(bo, rgB.PxMm);
                var cc = Core.OtdBridge.CadenceCoreFor(bo, rgB);
                bool gainMatch = true; double worst = 0;
                for (double v = 0.5; v < 1400; v *= 1.07)
                { double a = cc.GainAt(v), b = Curve.GainAt(lutB, v); worst = Math.Max(worst, Math.Abs(a - b)); if (Math.Abs(a - b) > 5e-4) gainMatch = false; }
                Ok("cadence: CadenceCore (native classic) tracks the dense EffectiveLut on the BO6 curve within 0.05%", gainMatch, $"worst {worst:0.0000}");
                {
                    var ccB = Core.OtdBridge.CadenceCoreFor(bo, rgB); double w2 = 0;
                    foreach (var mms in new[] { 0.5, 8.8, 9.5, 20.0, 37.0, 88.0, 120.0, 214.0, 303.0, 443.0, 700.0 })
                        w2 = Math.Max(w2, Math.Abs(ccB.GainAt(mms) - Curve.ClassicGain(mms * rgB.PxMm / 1000.0, bo.adv.accel ?? 0, bo.adv.offset ?? 0, bo.adv.cap ?? 1)));
                    Ok("cadence: native classic == the DRIVER formula to 1e-7 at 11 speeds (plan rounds the offset to 1e-6 mm/s; both engines now run the same curve)", w2 < 1e-7, $"worst {w2:0.0000000000}");
                    var bpc = Core.OtdBridge.CadenceCoreFor(cat.Find("breakpoint")!, Rig.From(cat.Find("breakpoint")!));
                    Ok("cadence: Breakpoint is classic-native (the 8-point fallback table is present and ignored), accel' 0.014022/mm/s, offset 8.772mm/s, cap 5, sens 1.996 at 87.7mm/s",
                       bpc.IsClassic && bpc.PointCount == 8 && Math.Abs(bpc.ClassicAccel - 0.014022) < 1e-6 && Math.Abs(bpc.ClassicOffset - 8.771930) < 1e-5 &&
                       bpc.ClassicCap == 5 && Math.Abs(bpc.GainAt(5 * 1000.0 / 57) - 1.9963) < 1e-4);
                    var fbk = Core.OtdBridge.CadenceCoreFor(cat.Find("breakpoint")!, Rig.From(cat.Find("breakpoint")!)); fbk.ClassicAccel = 0;   // what an OLD plugin (no Classic props) runs
                    double wfb = 0; foreach (var mms in new[] { 5.0, 8.8, 12.0, 20.0, 37.0, 88.0, 150.0, 214.0, 302.6, 443.0, 900.0 }) wfb = Math.Max(wfb, Math.Abs(fbk.GainAt(mms) / Curve.ClassicGain(mms * 57 / 1000.0, 0.246, 0.5, 5.0) - 1));
                    Ok("cadence: an OLD plugin that ignores the Classic props falls back to the 8-point table of the driver formula - never flat, within 3%",
                       !fbk.IsClassic && fbk.PointCount == 8 && wfb < 0.03 && fbk.GainAt(150) > 1.5, $"worst {wfb * 100:0.00}%");
                }
                Ok("cadence: every card fits the 8-point property surface and round-trips its gain at 10/120/500 mm/s",
                   cat.presets.All(p =>
                   {
                       try
                       {
                           var rg = Rig.From(p); var c = Core.OtdBridge.CadenceCoreFor(p, rg); var l = Curve.EffectiveLut(p, rg.PxMm);
                           return new[] { 10.0, 120.0, 500.0 }.All(v => Math.Abs(c.GainAt(v) - Curve.GainAt(l, v)) < 2e-3);
                       }
                       catch { return false; }
                   }));
                // regular clock: output delta = input delta * gain(true speed), same report
                cc.NominalHz = 360; var pos = new System.Numerics.Vector2(15000, 15000); cc.Filter(pos, DT);
                double stepU = 150.0 / 1000.0 * DT * 100.0;   // 150 mm/s in units
                var prev = cc.Filter(pos, DT); bool sameReport = true;
                for (int i = 0; i < 40; i++)
                {
                    pos.X += (float)Math.Round(stepU); var o = cc.Filter(pos, DT);
                    double got = o.X - prev.X, want = Math.Round(stepU) * Curve.GainAt(lutB, Math.Round(stepU) / 100.0 / DT * 1000.0);
                    if (Math.Abs(got - want) > 1e-2) sameReport = false; prev = o;
                }
                Ok("cadence: output delta == input delta x gain(pen-clock speed), on the SAME report (zero temporal cost)", sameReport);
                // the claim: arrival jitter changes nothing
                var lab = Core.CadenceLab.Run(bo, rgB, 25);
                Ok("cadence: +/-25% arrival jitter -> output identical to the ideal-clock output (<0.01 unit)", lab.CadenceVsIdealMaxUnits < 0.01, $"{lab.CadenceVsIdealMaxUnits:0.00000} units");
                Ok("cadence: wall-clock engine shows real gain noise on the same stream; Cadence Lock shows none",
                   lab.WallGainNoisePct > 3 && lab.CadenceGainNoisePct < 0.01,
                   $"wall {lab.WallGainNoisePct:0.00}% (worst {lab.WallWorstGainErrPct:0.0}%)  cadence {lab.CadenceGainNoisePct:0.0000}%");
                var labAuto = Core.CadenceLab.Run(bo, rgB, 25, 7, true);
                Ok("cadence: AUTO fallback (NominalHz 0) estimates 360Hz within 1% under +/-25% jitter, gain noise <1% incl. warm-up",
                   Math.Abs(labAuto.LiveHz - 360) < 3.6 && labAuto.CadenceGainNoisePct < 1.0, $"{labAuto.LiveHz:0.00} Hz  noise {labAuto.CadenceGainNoisePct:0.000}%");
                Ok("cadence: apply pins the MEASURED 360Hz (ev-20260907-pen-rate) and the probe is off when pinned",
                   Math.Abs(Core.OtdBridge.CadencePoints(bo, rgB)["NominalHz"] - 360) < 1e-9 && Core.OtdBridge.CadencePoints(bo, rgB)["Probe"] == 0);
                Ok("cadence: evidence ev-20260907-pen-rate exists and records ~360Hz",
                   File.Exists(Path.Combine(Core.RolePolicy.EvidenceDir, "ev-20260907-pen-rate.json")) &&
                   File.ReadAllText(Path.Combine(Core.RolePolicy.EvidenceDir, "ev-20260907-pen-rate.json")).Contains("360."));
                var rgD = Rig.From(bo); rgD.ReportHz = 0; rgD.MergeMax = 4;
                var ptsD = Core.OtdBridge.CadencePoints(bo, rgD);
                Ok("cadence: the two dials (pen Hz 0=auto, merge cap) travel from the rig into the plan", ptsD["NominalHz"] == 0 && ptsD["MergeMaxReports"] == 4);
                Ok("cadence: merged USB frame priced as 2 reports (gain error ~0), where a wall-clock divide spikes",
                   lab.MergedFrameCadenceErrPct < 0.5 && lab.MergedFrameWallSpikePct > 10, $"cadence {lab.MergedFrameCadenceErrPct:0.00}%  wall {lab.MergedFrameWallSpikePct:0.0}%");
                // lift / gap law (2026-09-16 review). OTD's relative mode clears its last position only when a gap exceeds
                // its reset delay (strict >) and a lift does NOT clear it, so the cursor sees out - lastOut unless gap > 80.
                var c3 = Core.OtdBridge.CadenceCoreFor(bo, rgB); c3.NominalHz = 360;
                var p0 = new System.Numerics.Vector2(100, 100); var lastO = c3.Filter(p0, DT);
                for (int i = 0; i < 20; i++) { p0.X += 83; lastO = c3.Filter(p0, DT); }                     // ~300 mm/s: output runs ahead
                double built = (lastO - p0).Length();
                System.Numerics.Vector2 Cursor(System.Numerics.Vector2 o, double gapMs) { var c = gapMs > 80 ? System.Numerics.Vector2.Zero : o - lastO; lastO = o; return c; }
                p0.X += 10; bool stall = (Cursor(c3.Filter(p0, 60), 60) - new System.Numerics.Vector2(10, 0)).Length() < 0.01;
                c3.Reset(); p0.X += 7; bool quickLift = (Cursor(c3.Filter(p0, 30), 30) - new System.Numerics.Vector2(7, 0)).Length() < 0.01;
                p0.X += 83; var resumed = Cursor(c3.Filter(p0, DT), DT); bool gainBack = resumed.X > 83 * 1.5;
                var far2 = new System.Numerics.Vector2(20000, 20000);
                bool gapRebase = (c3.Filter(far2, 1200) - far2).Length() < 0.01;
                Ok("cadence: a 60 ms stall or a 30 ms lift passes the hand's delta (the ~" + (built / 100).ToString("0") + " mm offset never reaches the cursor); the curve resumes next report; only a gap past RebaseMs rebases onto the pen",
                   built > 1000 && stall && quickLift && gainBack && gapRebase, $"offset {built / 100:0.0} mm, resumed x{resumed.X / 83:0.00}");
                // engine plumbing
                var rgDef = Rig.From(bo);
                Ok("engine: default rig engine is RawAccel; 'cadence' flips CadenceEngine", !rgDef.CadenceEngine && new Rig { Engine = "cadence" }.CadenceEngine);
                var bpk = cat.Find("breakpoint")!; var pts = Core.OtdBridge.CadencePoints(bpk, Rig.From(bpk));
                Ok("engine: Breakpoint Cadence plan carries the classic params natively (no table): offset 8.772mm/s, cap 5, plus the 8-point fallback table (P1 floor, P2 offset, P8 at the cap)",
                   Math.Abs(pts["ClassicOffset"] - 8.77193) < 1e-4 && Math.Abs(pts["ClassicAccel"] - 0.014022) < 1e-6 && pts["ClassicCap"] == 5 && pts["ClassicExp"] == 2 && pts["P1Speed"] == 0.01 && Math.Abs(pts["P2Speed"] - 8.772) < 1e-3 && pts["P8Gain"] == 5 && Math.Abs(pts["P8Speed"] - 302.6) < 0.1,
                   $"accel' {pts["ClassicAccel"]}  offset {pts["ClassicOffset"]}  cap {pts["ClassicCap"]}");
                Ok("engine: a LUT card's Cadence plan carries its table and no classic params",
                   Core.OtdBridge.CadencePoints(cat.Find("trueraw")!, Rig.From(cat.Find("trueraw")!))["ClassicAccel"] == 0 &&
                   Core.OtdBridge.CadencePoints(cat.Find("trueraw")!, Rig.From(cat.Find("trueraw")!))["P1Speed"] == 2.66);
                Ok("read-back matcher: parses '{ Key: value }' text numerically (more printed digits than rounded still verify)",
                   Core.OtdBridge.ReadBackMatches("{ ClassicAccel: 0.014022 }, { P1Speed: 0 }", "ClassicAccel", 0.014022) &&
                   Core.OtdBridge.ReadBackMatches("(ClassicOffset: 8.77193)", "ClassicOffset", 8.77193) &&
                   !Core.OtdBridge.ReadBackMatches("{ ClassicAccel: 0.0149 }", "ClassicAccel", 0.015) &&
                   !Core.OtdBridge.ReadBackMatches("{ Other: 1 }", "ClassicAccel", 1));
                // 2026-09-16 review: every OTD read-back goes through the whole-number matcher
                Ok("read-back matcher: a digit-prefix of a stale value never verifies (Hover_max 87 live is not 8), a key repeated across filters matches any, a longer key never matches a shorter one",
                   !Core.OtdBridge.ReadBackMatches("{ Hover_max: 87, Hover_min: 0 }", "Hover_max", 8) &&
                   Core.OtdBridge.ReadBackMatches("Coherence { RailStrength: 0 } CoD { RailStrength: 0.35 }", "RailStrength", 0.35) &&
                   !Core.OtdBridge.ReadBackMatches("{ LeadMaxMm: 1.2 }", "MaxMm", 1.2));
                var nine = new Preset { id = "nine", name = "Custom", group = "Custom", pxmm = 57, cm = 37.7,
                    lut = Enumerable.Range(1, 9).Select(i => new[] { 2.0 * i * i, 1.0 + 0.2 * (i - 1) }).ToArray() };
                var rgCad = Rig.From(bo); rgCad.Engine = "cadence"; var rgRa = Rig.From(bo);
                string probeData = Path.Combine(Path.GetTempPath(), "aimforge-selftest-otd");
                var otdProbe = new Core.OtdBridge(probeData, probeData);
                Directory.CreateDirectory(Path.GetDirectoryName(otdProbe.GameFilterDll)!); File.WriteAllText(otdProbe.GameFilterDll, ""); File.SetLastWriteTimeUtc(otdProbe.GameFilterDll, new DateTime(2000, 1, 1, 0, 0, 0, DateTimeKind.Utc));
                Ok("cadence pre-flight: a 9-point LUT is refused BEFORE RawAccel is touched on the Cadence engine, and passes on the RawAccel engine",
                   otdProbe.CadenceBlocker(rgCad, nine) is string cb && cb.Contains("at most 8 LUT points") && otdProbe.CadenceBlocker(rgRa, nine) == null &&
                   otdProbe.CadenceBlocker(rgCad, bo) == null);
                // 2026-09-16 review: the LUT verify string is built from the SAME rounded x the apply writes
                var rmp = cat.Find("feather")!; bool lutRound = true;
                foreach (double px in new[] { 25.0, 55, 57, 90, 95, 125, 225, 295 })
                {
                    var data = Curve.RawAccelData(rmp.lut!, px); var sb = new System.Text.StringBuilder();
                    for (int i = 0; i + 1 < data.Length; i += 2) sb.Append(data[i].ToString("0.###", System.Globalization.CultureInfo.InvariantCulture)).Append(',').Append(data[i + 1].ToString("0.###", System.Globalization.CultureInfo.InvariantCulture)).Append(';');
                    if (sb.ToString() != Curve.RawAccelPoints(rmp.lut!, px)) lutRound = false;
                }
                Ok("pen LUT read-back: the written data and the verify string agree at every px/mm (55 used to read 0.676 vs 0.677 and roll back)", lutRound);
            }

            var bw = cat.Find("breakwide")!; var bpk2 = cat.Find("breakpoint")!;
            Ok("Breakpoint Wide: Breakpoint's curve and rig verbatim, only cm differs (78.95 = the Finals sens-8 field verdict)",
               bw.lut == null && bw.cohOv == null && bw.group == bpk2.group &&
               bw.pxmm == bpk2.pxmm && bw.snap == bpk2.snap && bw.hdlMax == bpk2.hdlMax && bw.Yx == bpk2.Yx &&
               bw.adv.accel == bpk2.adv.accel && bw.adv.cap == bpk2.adv.cap && bw.adv.offset == bpk2.adv.offset &&
               bw.cm == 78.95 && bpk2.cm == Core.Goat.Cm);
            Ok("Breakpoint Wide reads Finals sens 8.00 while Breakpoint sits on the GOAT's base (Finals sens 12.00)",
               Math.Abs(Curve.SensFor(cat.games.First(g => g.id == "finals").K, Rig.From(bw)) - 8.0) < 0.01 &&
               Math.Abs(Curve.SensFor(cat.games.First(g => g.id == "finals").K, Rig.From(bpk2)) - 12.0) < 0.01);

            // ---- 2026-09-14: mouse mirror (pure transform + JSON, the shipping MouseMirror) ----
            {
                var MM = typeof(Core.MouseMirror); // (namespace anchor)
                var xf = Core.MouseMirror.Numbers(57, 1.0, 1600);
                Ok("mirror numbers: 1600 DPI vs 57 px/mm -> r 1.105125, mult 0.904875, Output DPI 904.875, effective 57.00 counts/mm",
                   Math.Abs(xf.R - 1.105125) < 1e-6 && Math.Abs(xf.MultMouse - 0.904875) < 1e-6 && xf.OutputDpi == 904.875 && Math.Abs(xf.PxMmEffective - 57) < 1e-9, xf.ToString());
                Ok("mirror numbers: mult 1.2 -> Output DPI 1085.85 and 68.40 counts/mm on both devices",
                   Core.MouseMirror.Numbers(57, 1.2, 1600).OutputDpi == 1085.85 && Math.Abs(Core.MouseMirror.Numbers(57, 1.2, 1600).PxMmEffective - 68.4) < 1e-9);
                Ok("mirror default speed EMA = ln2 x half the pen report interval = 1.0 ms at 360 Hz", Core.MouseMirror.DefaultHalfLifeMs(360) == 1.0);

                // classic invariance under the DRIVER formula, every classic card x 3 sensor steps x 10 speeds
                double worstC = 0;
                foreach (var pc in cat.presets.Where(q => !q.IsLut))
                    foreach (var dpi in new[] { 800.0, 1600.0, 3200.0 })
                    {
                        var xx = Core.MouseMirror.Numbers(pc.pxmm, pc.adv.mult ?? 1.0, dpi);
                        foreach (var sMms in new[] { 0.5, 1.9, 8.0, 8.8, 37.0, 120.0, 214.0, 443.0, 700.0, 1450.0 })
                        {
                            double a = pc.adv.accel ?? 0, off = pc.adv.offset ?? 0, cap = pc.adv.cap ?? 1;
                            double pen = Curve.ClassicGain(sMms * pc.pxmm / 1000.0, a, off, cap);
                            double mouse = Curve.ClassicGain(sMms * xx.CpmMouse / 1000.0, a / xx.R, off * xx.R, cap);
                            worstC = Math.Max(worstC, Math.Abs(pen - mouse));
                            worstC = Math.Max(worstC, Math.Abs(xx.CpmMouse * xx.MultMouse - pc.pxmm * (pc.adv.mult ?? 1.0)) * 1e-3);
                        }
                    }
                Ok("mirror invariance, classic: pen gain == mouse gain at every speed for all classic cards x {800,1600,3200} DPI (driver formula, 1e-12)", worstC < 1e-12, $"worst {worstC:0.0e0}");

                // LUT invariance: the WRITTEN 6-dp mouse table evaluated with RawAccel semantics
                double worstL = 0;
                foreach (var pl in cat.presets.Where(q => q.IsLut))
                    foreach (var dpi in new[] { 800.0, 1600.0, 3200.0 })
                    {
                        var xx = Core.MouseMirror.Numbers(pl.pxmm, pl.adv.mult ?? 1.0, dpi);
                        var d = Core.MouseMirror.LutData6(pl.lut!, xx.CpmMouse);
                        var asLut = Enumerable.Range(0, d.Length / 2).Select(i => new[] { d[2 * i] * 1000.0 / xx.CpmMouse, d[2 * i + 1] }).ToArray();
                        foreach (var sMms in new[] { 0.5, 1.9, 8.0, 8.8, 37.0, 120.0, 214.0, 443.0, 700.0, 1450.0 })
                            worstL = Math.Max(worstL, Math.Abs(Curve.GainAt(asLut, sMms) - Curve.GainAt(pl.lut!, sMms)));
                    }
                Ok("mirror invariance, LUT: the written 6-dp mouse table reproduces the authored curve within 1e-5 for all LUT cards x 3 DPI steps", worstL < 1e-5, $"worst {worstL:0.0e0}");

                // fixture: the real file's shape (one pen profile, six device entries incl. three pen-shaped decoys)
                string FIX = RaFixture();
                System.Text.Json.Nodes.JsonObject Fix() => System.Text.Json.Nodes.JsonNode.Parse(FIX)!.AsObject();
                var pref = new[] { @"HID\VID_3710&PID_5406", @"HID\VID_3710&PID_3414" };
                var bp2 = cat.Find("breakpoint")!; var rgM = Rig.From(bp2); rgM.MirrorMouse = true; rgM.MouseDpi = 1600; rgM.MouseSpeedHalfLifeMs = 1.0; rgM.MouseIdPrefixes = pref;

                Ok("mirror allowlist discovery finds exactly the two Pulsar VID&PID prefixes and none of the three pen-shaped decoys",
                   Core.MouseMirror.DiscoverPrefixes(Fix()).SequenceEqual(pref, StringComparer.OrdinalIgnoreCase));
                var cls = Core.MouseMirror.Classify(Fix(), pref);
                Ok("mirror classify: 3 Pulsar entries bound; ugee (HID\\hid& shape), 'VMulti' (name) and VID_056A (Wacom) denied",
                   cls.Count(c => c.Status == "bound") == 3 && cls.Count(c => c.Status == "denied") == 3);
                Ok("mirror pre-flight passes on the fixture for Breakpoint", Core.MouseMirror.PreFlight(Fix(), bp2, rgM, pref).Count == 0, string.Join("; ", Core.MouseMirror.PreFlight(Fix(), bp2, rgM, pref)));

                // the profile itself
                var built = Core.MouseMirror.Build(Fix()["profiles"]![0]!.AsObject(), bp2, rgM);
                var hb = built[Core.MouseMirror.H]!.AsObject(); var vb = built[Core.MouseMirror.V]!.AsObject();
                Ok("mirror build (classic card): mode classic, offset 0.552563, accel 0.222599, cap 5, Cap/Jump.x 15r, Input Speed Cap 3r, syncSpeed 5r, decayRate 0.1/r, scale 1/r, Output DPI 904.875, Y/X 1 and snap 0 (the GOAT's), EMA 1.0, scale/output EMA 0",
                   hb["mode"]!.GetValue<string>() == "classic" && Math.Abs(hb["inputOffset"]!.GetValue<double>() - 0.5 * xf.R) < 1e-12 && Math.Abs(hb["acceleration"]!.GetValue<double>() - 0.246 / xf.R) < 1e-12
                   && hb["Cap / Jump"]!["y"]!.GetValue<double>() == 5 && Math.Abs(hb["Cap / Jump"]!["x"]!.GetValue<double>() - 15 * xf.R) < 1e-12
                   && Math.Abs(built["Input Speed Cap"]!.GetValue<double>() - 3 * xf.R) < 1e-12 && Math.Abs(hb["syncSpeed"]!.GetValue<double>() - 5 * xf.R) < 1e-12
                   && Math.Abs(hb["decayRate"]!.GetValue<double>() - 0.1 / xf.R) < 1e-12 && Math.Abs(hb["scale"]!.GetValue<double>() - 1 / xf.R) < 1e-12
                   && built["Output DPI"]!.GetValue<double>() == 904.875 && built["Y/X output DPI ratio (vertical sens multiplier)"]!.GetValue<double>() == 1.0
                   && built["Degrees of angle snapping"]!.GetValue<double>() == 0 && built[Core.MouseMirror.KeyIscp]![Core.MouseMirror.KeyHalfIn]!.GetValue<double>() == 1.0
                   && built[Core.MouseMirror.KeyIscp]![Core.MouseMirror.KeyHalfOut]!.GetValue<double>() == 0 && built["name"]!.GetValue<string>() == Core.MouseMirror.Reserved);
                Ok("mirror build: both accel blocks identical", System.Text.Json.Nodes.JsonNode.DeepEquals(hb, vb));
                Ok("mirror build: mouse gain at 87.7 mm/s == pen gain (1.9963) through the WRITTEN classic params",
                   Math.Abs(Curve.ClassicGain(87.7 * xf.CpmMouse / 1000.0, hb["acceleration"]!.GetValue<double>(), hb["inputOffset"]!.GetValue<double>(), 5) - Curve.ClassicGain(87.7 * 57 / 1000.0, 0.246, 0.5, 5)) < 1e-12);
                Ok("mirror build is NEVER flat and independent of the engine: all 69 cards x {rawaccel, cadence} give mode classic|lut in both blocks",
                   cat.presets.All(q => new[] { "rawaccel", "cadence" }.All(eng =>
                   {
                       var r = Rig.From(q); r.Engine = eng; r.MirrorMouse = true; r.MouseIdPrefixes = pref;
                       var b = Core.MouseMirror.Build(Fix()["profiles"]![0]!.AsObject(), q, r);
                       string mh2 = b[Core.MouseMirror.H]!["mode"]!.GetValue<string>(), mv2 = b[Core.MouseMirror.V]!["mode"]!.GetValue<string>();
                       return (mh2 == "classic" || mh2 == "lut") && mh2 == mv2 && mh2 == (q.IsLut ? "lut" : "classic");
                   })));
                var tr = cat.Find("trueraw")!; var rgT = Rig.From(tr); rgT.MirrorMouse = true; rgT.MouseIdPrefixes = pref;
                var bl = Core.MouseMirror.Build(Fix()["profiles"]![0]!.AsObject(), tr, rgT)[Core.MouseMirror.H]!.AsObject();
                Ok("mirror build (LUT card, 90 px/mm): x 0.167559 / 0.377953 / 91.338583 at 6 dp, Gain/Velocity false",
                   bl["mode"]!.GetValue<string>() == "lut" && bl["Gain / Velocity"]!.GetValue<bool>() == false &&
                   bl["data"]![0]!.GetValue<double>() == 0.167559 && bl["data"]![2]!.GetValue<double>() == 0.377953 && bl["data"]![4]!.GetValue<double>() == 91.338583);

                // install / remove round trip on the fixture
                var f1 = Fix(); var snap = Core.MouseMirror.Clone(f1);
                var bound = Core.MouseMirror.InstallOn(f1, bp2, rgM, pref);
                var rd = Core.MouseMirror.Read(f1);
                Ok("mirror install: RESERVED appended LAST, 3 entries bound + enabled, decoys untouched, no dangling refs",
                   bound.Count == 3 && rd.Exists && rd.IsLast && rd.ProfileCount == 2 && rd.Bound.Count == 3 && rd.Dangling.Count == 0 &&
                   System.Text.Json.Nodes.JsonNode.DeepEquals(f1["devices"]![3], snap["devices"]![3]) && System.Text.Json.Nodes.JsonNode.DeepEquals(f1["devices"]![5], snap["devices"]![5]));
                Ok("mirror verify passes right after install", Core.MouseMirror.Verify(f1, bp2, rgM, pref).Count == 0, string.Join("; ", Core.MouseMirror.Verify(f1, bp2, rgM, pref)));
                {
                    var fv = Fix(); Core.MouseMirror.InstallOn(fv, bp2, rgM, pref); fv["profiles"]![1]![Core.MouseMirror.V]!["acceleration"] = 0.246;
                    var fv2 = Fix(); Core.MouseMirror.InstallOn(fv2, bp2, rgM, pref); fv2["profiles"]![1]![Core.MouseMirror.V]!["mode"] = "noaccel";
                    var fv3 = Fix(); Core.MouseMirror.InstallOn(fv3, tr, rgT, pref); fv3["profiles"]![1]![Core.MouseMirror.V]!["data"]![0] = 0.2;
                    Ok("mirror verify reads back the VERTICAL block too: V accel, V mode and V LUT data drift are each caught",
                       Core.MouseMirror.Verify(fv, bp2, rgM, pref).Any(m => m.Contains("V ")) && Core.MouseMirror.Verify(fv2, bp2, rgM, pref).Count > 0 &&
                       Core.MouseMirror.Verify(fv3, tr, rgT, pref).Any(m => m.Contains("V ")));
                    var fd = Fix(); var p9 = Core.MouseMirror.Clone(fd["profiles"]![0]!.AsObject()); p9["name"] = "Gone"; fd["devices"]![4]!["profile"] = "Gone";   // unrelated stale entry
                    Core.MouseMirror.InstallOn(fd, bp2, rgM, pref);
                    Ok("mirror verify ignores an UNRELATED dangling device entry (it must not roll back the pen apply)", Core.MouseMirror.Verify(fd, bp2, rgM, pref).Count == 0, string.Join("; ", Core.MouseMirror.Verify(fd, bp2, rgM, pref)));
                }
                Core.MouseMirror.InstallOn(f1, bp2, rgM, pref);
                Ok("mirror install twice: still exactly one RESERVED, still last", Core.MouseMirror.Read(f1).ProfileCount == 2 && Core.MouseMirror.Read(f1).IsLast);
                int removed = Core.MouseMirror.Remove(f1);
                Ok("mirror remove: 3 entries back to profiles[0] and DISABLED, RESERVED gone, document DeepEquals the pre-install snapshot",
                   removed == 3 && System.Text.Json.Nodes.JsonNode.DeepEquals(f1, snap));
                Ok("mirror remove when already off: no-op", Core.MouseMirror.Remove(f1) == 0 && System.Text.Json.Nodes.JsonNode.DeepEquals(f1, snap));

                // refusals
                List<string> PF(Action<System.Text.Json.Nodes.JsonObject> mut, Action<Rig>? rm = null) { var f = Fix(); mut(f); var r = Rig.From(bp2); r.MirrorMouse = true; r.MouseIdPrefixes = pref; r.MouseDpi = 1600; rm?.Invoke(r); return Core.MouseMirror.PreFlight(f, bp2, r, pref); }
                Ok("mirror refuses: profiles[0] named RESERVED", PF(f => f["profiles"]![0]!["name"] = Core.MouseMirror.Reserved).Any(x => x.Contains("profiles[0]")));
                Ok("mirror refuses: two RESERVED profiles", PF(f => { var p2 = Core.MouseMirror.Clone(f["profiles"]![0]!.AsObject()); p2["name"] = Core.MouseMirror.Reserved; var p3 = Core.MouseMirror.Clone(p2); f["profiles"]!.AsArray().Add(p2); f["profiles"]!.AsArray().Add(p3); }).Any(x => x.Contains("more than one")));
                Ok("mirror refuses: device DPI normalisation set", PF(f => f["devices"]![0]!["config"]![Core.MouseMirror.KeyDpi] = 1600).Any(x => x.Contains("device DPI")));
                Ok("mirror refuses: constant time interval on", PF(f => f["devices"]![0]!["config"]![Core.MouseMirror.KeyConst] = true).Any(x => x.Contains("constant time")));
                Ok("mirror refuses: RawAccel 1.6", PF(f => f["version"] = "1.6.1").Any(x => x.Contains("1.7")));
                Ok("mirror refuses: DPI 90 and 40000; accepts 1600", PF(f => { }, r => r.MouseDpi = 90).Any(x => x.Contains("DPI")) && PF(f => { }, r => r.MouseDpi = 40000).Any(x => x.Contains("DPI")) && PF(f => { }).Count == 0);
                Ok("mirror refuses: no allowlisted mouse entries", Core.MouseMirror.PreFlight(Fix(), bp2, rgM, new[] { @"HID\VID_9999&PID_9999" }).Any(x => x.Contains("no mouse entries")));
                Ok("mirror refuses: an unclassified accel-block key (RawAccel upgrade guard)", PF(f => f["profiles"]![0]![Core.MouseMirror.H]!["newSpeedThing"] = 1.0).Any(x => x.Contains("cannot classify")));
                Ok("mirror skips a user-owned binding: allowlisted entry on 'MyProfile' is neither bound nor disabled",
                   new Func<bool>(() => { var f = Fix(); var p2 = Core.MouseMirror.Clone(f["profiles"]![0]!.AsObject()); p2["name"] = "MyProfile"; f["profiles"]!.AsArray().Add(p2); f["devices"]![1]!["profile"] = "MyProfile";
                            Core.MouseMirror.InstallOn(f, bp2, rgM, pref); return f["devices"]![1]!["profile"]!.GetValue<string>() == "MyProfile" && Core.MouseMirror.Read(f).Bound.Count == 2; })());

                // persisted mode round trip + readout
                var st = new Core.MouseMirror.State { On = true, Dpi = 1600, HalfLifeMs = 1.0, Yx = null, Prefixes = pref, LastCardId = "breakpoint", LastPxMm = 57, LastMult = 1 };
                string stPath = Path.Combine(Path.GetTempPath(), "aimforge-selftest-mouse.txt");
                st.Save(stPath); var st2 = Core.MouseMirror.State.Load(stPath);
                File.WriteAllText(stPath, "on;50;20;2;;x;57;1"); var st3 = Core.MouseMirror.State.Load(stPath); File.Delete(stPath);
                Ok("mirror state clamps out-of-range values on load (a bad mouse.txt can never crash the GUI's numeric controls)", st3.Dpi == 100 && st3.HalfLifeMs == 10 && st3.Yx == null, $"dpi {st3.Dpi} ema {st3.HalfLifeMs} yx {st3.Yx}");
                Ok("mirror state (mouse.txt) round-trips every field (scratch path - the live mouse.txt is never touched)", st2.On && st2.Dpi == 1600 && st2.HalfLifeMs == 1.0 && st2.Yx == null && st2.Prefixes.SequenceEqual(pref) && st2.LastCardId == "breakpoint" && st2.LastPxMm == 57 && st2.LastMult == 1);
                string ro = Core.MouseMirror.Readout(rgM, 3, false, null);
                Ok("mirror readout pinned: 'Mouse: matched · assumes 1600 DPI · 3 devices · sens 0.905 → 57.0 counts/mm = pen · curve ×1.105 on the speed axis · snap 0° · Y/X 1 · speed EMA 1 ms'",
                   ro == "Mouse: matched · assumes 1600 DPI · 3 devices · sens 0.905 → 57.0 counts/mm = pen · curve ×1.105 on the speed axis · snap 0° · Y/X 1 · speed EMA 1 ms", ro);
                Ok("mirror readout: OTD-only suffix and STALE suffix; off state",
                   Core.MouseMirror.Readout(rgM, 3, true, "bo6og").EndsWith(" · OTD-only extras not mirrored · mouse: STALE (card bo6og)") && Core.MouseMirror.Readout(new Rig(), 0, false, null) == "Mouse: raw (mirror off)");
                {
                    var fOn = Fix(); Core.MouseMirror.InstallOn(fOn, bp2, rgM, pref);
                    var liveOnL = Core.MouseMirror.Read(fOn); var liveOffL = Core.MouseMirror.Read(Fix()); var rgPlain = Rig.From(bp2);
                    Ok("mirror LIVE readout: ON+live = the pinned line; ON+not live says NOT live; OFF+still live says STILL MIRRORED; OFF+raw = raw",
                       Core.MouseMirror.LiveReadout(rgM, liveOnL, false, null) == ro &&
                       Core.MouseMirror.LiveReadout(rgM, liveOffL, false, null).Contains("NOT live") &&
                       Core.MouseMirror.LiveReadout(rgPlain, liveOnL, false, null).Contains("STILL MIRRORED") &&
                       Core.MouseMirror.LiveReadout(rgPlain, liveOffL, false, null) == "Mouse: raw (mirror off)");
                }

                // the write TRANSACTION, against a scratch RawAccel dir with a stubbed writer
                string scratch = Path.Combine(Path.GetTempPath(), "aimforge-selftest-rawaccel"); Directory.CreateDirectory(scratch);
                foreach (var old in Directory.GetFiles(scratch)) File.Delete(old);
                File.WriteAllText(Path.Combine(scratch, "settings.json"), FIX); File.WriteAllText(Path.Combine(scratch, "writer.exe"), "stub");
                var bridge = new RawAccelBridge(scratch); int calls = 0; var quiet = new Action<string>(_ => { });
                bridge.WriterRunner = () => { calls++; return 1; };
                bool threw = false; try { bridge.Apply(bp2, rgM, false, quiet); } catch { threw = true; }
                string bakFile = Directory.GetFiles(scratch, "settings.backup-*.json").OrderByDescending(f => f).First();
                Ok("transaction: writer exit 1 -> Apply throws, settings.json is byte-equal to the backup, writer re-run on the restored file (2 calls)",
                   threw && calls == 2 && File.ReadAllText(Path.Combine(scratch, "settings.json")) == File.ReadAllText(bakFile));
                calls = 0;
                bridge.WriterRunner = () => { calls++; if (calls == 1) { var t = bridge.ReadRoot(); t["profiles"]![0]!["Degrees of angle snapping"] = 44; File.WriteAllText(Path.Combine(scratch, "settings.json"), Core.MouseMirror.Clone(t).ToJsonString()); } return 0; };
                threw = false; try { bridge.Apply(bp2, rgM, false, quiet); } catch { threw = true; }
                Ok("transaction: writer exit 0 but read-back mismatch -> throws, restored, writer re-run (2 calls), no mouse profile left behind",
                   threw && calls == 2 && !Core.MouseMirror.HasReserved(bridge.ReadRoot()) && !bridge.LastMirrorApplied);
                calls = 0; bridge.WriterRunner = () => { calls++; return 0; };
                var applyLog = new List<string>(); bridge.Apply(bp2, rgM, false, applyLog.Add);
                var liveM = Core.MouseMirror.Read(bridge.ReadRoot());
                Ok("transaction: clean apply with mirror ON -> pen profile classic, RESERVED live and bound x3, verified, LastMirrorApplied",
                   calls == 1 && bridge.LastMirrorApplied && liveM.Exists && liveM.Bound.Count == 3 && liveM.Mode == "classic" && bridge.ReadLive().Mode == "classic" && applyLog.Any(l => l.Contains("VERIFIED")));
                var rgOff = Rig.From(bp2); rgOff.MirrorMouse = false; rgOff.MouseIdPrefixes = pref;
                bridge.Apply(bp2, rgOff, false, applyLog.Add);
                var liveOff = Core.MouseMirror.Read(bridge.ReadRoot());
                Ok("transaction: apply with mirror OFF removes the profile and disables the entries, verified", !liveOff.Exists && liveOff.Bound.Count == 0 && liveOff.Disabled.Count == 6 && !bridge.LastMirrorApplied);
                var rgCad = Rig.From(bp2); rgCad.MirrorMouse = true; rgCad.MouseIdPrefixes = pref; rgCad.Engine = "cadence";
                bridge.Apply(bp2, rgCad, false, quiet);
                Ok("transaction: Cadence Lock engine -> pen profile noaccel (flat) while the mouse profile is classic with the curve",
                   bridge.ReadLive().Mode == "noaccel" && Core.MouseMirror.Read(bridge.ReadRoot()).Mode == "classic" && Core.MouseMirror.Read(bridge.ReadRoot()).Bound.Count == 3);
                bridge.MirrorOff(quiet);
                Ok("transaction: MirrorOff standalone leaves the pen profile alone and the mouse raw", bridge.ReadLive().Mode == "noaccel" && !Core.MouseMirror.HasReserved(bridge.ReadRoot()));

                // the --mouse on path: mouse-only, the pen profile byte-identical (review 2026-09-14 blocker)
                calls = 0; string penJson = Core.MouseMirror.Clone(bridge.ReadRoot()["profiles"]![0]!.AsObject()).ToJsonString();
                var rgOn = Rig.From(bp2); rgOn.MirrorMouse = true; rgOn.MouseIdPrefixes = pref;
                bridge.MirrorOn(bp2, rgOn, quiet);
                var afterOn = bridge.ReadRoot();
                Ok("MirrorOn (the --mouse on path): pen profile byte-identical and still noaccel under Cadence Lock; mouse profile live and bound x3; one writer run",
                   calls == 1 && bridge.ReadLive().Mode == "noaccel" && Core.MouseMirror.Clone(afterOn["profiles"]![0]!.AsObject()).ToJsonString() == penJson &&
                   Core.MouseMirror.Read(afterOn).Exists && Core.MouseMirror.Read(afterOn).Bound.Count == 3 && bridge.LastMirrorApplied);
                var rgBad = Rig.From(bp2); rgBad.MirrorMouse = true; rgBad.MouseIdPrefixes = new[] { @"HID\VID_9999&PID_9999" };
                calls = 0; string before = File.ReadAllText(Path.Combine(scratch, "settings.json"));
                bridge.MirrorOn(bp2, rgBad, quiet);
                Ok("MirrorOn refused by pre-flight writes NOTHING (no writer run, file byte-identical)", calls == 0 && !bridge.LastMirrorApplied && File.ReadAllText(Path.Combine(scratch, "settings.json")) == before);

                calls = 0; bridge.RestoreLastBackup(quiet);
                Ok("RestoreLastBackup: the newest backup (the pre-MirrorOn state) is back and re-fed to the writer; mouse raw; LastMirrorApplied false",
                   calls == 1 && !Core.MouseMirror.HasReserved(bridge.ReadRoot()) && !bridge.LastMirrorApplied && bridge.ReadLive().Mode == "noaccel");
                int nBak = Directory.GetFiles(scratch, "settings.backup-*.json").Length;
                Ok("backups never overwrite each other: all 7 commits in this suite left their own file (same-second applies included)", nBak == 7, nBak.ToString());
                calls = 0; bridge.WriterRunner = () => { calls++; return 3; };
                bool restoreThrew = false; try { bridge.RestoreLastBackup(quiet); } catch (InvalidOperationException) { restoreThrew = true; }
                Ok("RestoreLastBackup treats a rejected restore (writer exit != 0) as a failure", restoreThrew && calls == 1);
                bridge.WriterRunner = () => { calls++; return 0; };

                {
                    var fr = Fix(); fr["profiles"]![0]!["name"] = Core.MouseMirror.Reserved;
                    File.WriteAllText(Path.Combine(scratch, "settings.json"), Core.MouseMirror.Clone(fr).ToJsonString());
                    calls = 0; bool refusedFirst = false; try { bridge.Apply(bp2, Rig.From(bp2), false, quiet); } catch (InvalidOperationException e) { refusedFirst = e.Message.Contains("must be first"); }
                    Ok("apply refuses clearly when 'AimForge Mouse' is profiles[0] (the pen profile must be first), before writing anything", refusedFirst && calls == 0);
                    var fs = Fix(); fs["devices"]![1]!["profile"] = Core.MouseMirror.Reserved;   // stale binding: entry disabled, profile gone
                    File.WriteAllText(Path.Combine(scratch, "settings.json"), Core.MouseMirror.Clone(fs).ToJsonString());
                    bridge.Apply(bp2, Rig.From(bp2), false, quiet);
                    var ls = Core.MouseMirror.Read(bridge.ReadRoot());
                    Ok("apply with mirror OFF cleans a stale DISABLED entry still naming 'AimForge Mouse' (no dangling ref survives)", ls.NamingReserved == 0 && ls.Dangling.Count == 0);
                }
            }

            // ---- 2026-09-16: Specific Characters, all nine from the renovated HeroLab (ev-20260916-hero-*) ----
            {
                var chOrder = cat.presets.Select(p => p.group).Distinct().ToList();
                int chB = chOrder.IndexOf("Breakpoint — flick flagship");
                Ok("Specific Characters: two groups right after Breakpoint (Marvel Rivals 5 incl. Psylocke, Overwatch 2 4); the Marvel Rivals game group has its 6 lab roles; both map to their game",
                   chB >= 0 && chOrder.IndexOf("Specific Characters — Marvel Rivals") == chB + 1 && chOrder.IndexOf("Specific Characters — Overwatch 2") == chB + 2 &&
                   cat.presets.Count(p => p.group == "Specific Characters — Marvel Rivals") == 5 && cat.presets.Count(p => p.group == "Specific Characters — Overwatch 2") == 4 &&
                   cat.presets.Count(p => p.group == "Marvel Rivals") == 6 &&
                   Core.FilterCatalog.GameOfGroup("Specific Characters — Marvel Rivals") == "rivals" && Core.FilterCatalog.GameOfGroup("Specific Characters — Overwatch 2") == "ow2",
                   string.Join(" > ", chOrder.Take(5)));
                double chSkidCap = Core.HeroLab.SkidCap(cat);
                // 2026-10-24: re-derived on THE GOAT's rig (ev-20261024-hero-*): snap 0, Y/X 1.00, reset 20, no filter; Hela and Emre ARE the GOAT
                var chCards = new (string id, string hero, string game, double cm, double accel, double cap, double off, double snap, double yx, bool filterOn, double sens)[]
                {
                    ("rivpsy", "psylocke", "rivals", 42.1, 2.2417, 3.0, 9.69, 0, 1.0, false, 0.857),
                    ("rivloki", "loki", "rivals", 42.1, 0.493, 3.0, 3.42, 0, 1.0, false, 0.857),
                    ("rivwfox", "whitefox", "rivals", 52.63, 0.2105, 3.0, 2.28, 0, 1.0, false, 0.686),
                    ("rivpun", "punisher", "rivals", 47.37, 1.1696, 3.0, 3.42, 0, 1.0, false, 0.762),
                    ("rivhela", "hela", "rivals", 52.63, 0.2963, 3.0, 2.28, 0, 1.0, false, 0.686),
                    ("owsol", "soldier76", "ow2", 47.37, 1.8519, 3.0, 7.41, 0, 1.0, false, 2.020),
                    ("owemre", "emre", "ow2", 52.63, 0.2963, 3.0, 2.28, 0, 1.0, false, 1.818),
                    ("owillari", "illari", "ow2", 52.63, 0.435, 3.0, 2.28, 0, 1.0, false, 1.818),
                    ("owfreja", "freja", "ow2", 47.37, 1.1696, 3.0, 3.42, 0, 1.0, false, 2.020),
                };
                foreach (var ch in chCards)
                {
                    var chP = cat.Find(ch.id)!; var chH = Core.HeroLab.Find(ch.hero)!; var chFam = cat.Find(chH.FamilyCard)!;
                    string chCls = ch.game == "rivals" ? "AimForge.Filters.RivalsMaster" : "AimForge.Filters.Ow2Master";
                    bool chFields = chP.lut == null && chP.cohOv == null && chP.pxmm == 57 && chP.cm == ch.cm && chP.snap == ch.snap && chP.Yx == ch.yx && chP.Yx == chFam.Yx && chP.adv.reset == Core.Goat.ResetMs &&
                                    chP.adv.accel == ch.accel && chP.adv.cap == ch.cap && chP.adv.offset == ch.off && Core.FilterCatalog.GameOfGroup(chP.group) == ch.game &&
                                    chP.filters!.Any(f => f.id == chCls && f.on == ch.filterOn) && Core.RolePolicy.ApplyBlockers(chP).Count == 0;
                    double chSens = Curve.SensFor(cat.games.First(g => g.id == ch.game).K, Rig.From(chP));
                    var chPrm = new Core.PsyLab.Params();
                    var chSpec = ch.filterOn ? chP.filters!.First(f => f.id == chCls) : null;
                    var chCand = new Core.PsyLab.Cand { Name = ch.id, P = chP, Filter = ch.filterOn, FilterSpec = chSpec, FilterGame = chH.FilterGame };
                    var chRes = Core.PsyLab.Score(chCand, cat.tablet, chPrm, chH.Scens, chH.K);
                    var chRefs = new[] { chH.FamilyCard, "breakpoint" }
                        .Select(r => Core.PsyLab.Score(new Core.PsyLab.Cand { Name = r, P = cat.Find(r)!, FilterGame = chH.FilterGame }, cat.tablet, chPrm, chH.Scens, chH.K)).ToArray();
                    var chAll = chRefs.Append(chRes).ToArray();
                    var chMin = Enumerable.Range(0, chH.Scens.Length).Select(k => chAll.Min(r => r.PerScen[k].HeadRadii)).ToArray();
                    double chRel = Core.HeroLab.RelScore(chRes, chMin, chH), chRefRel = chRefs.Min(r => Core.HeroLab.RelScore(r, chMin, chH));
                    double chFamRel = Core.HeroLab.RelScore(chRefs[0], chMin, chH), chBpRel = Core.HeroLab.RelScore(chRefs[1], chMin, chH);
                    Core.HeroLab.PeakCap(chH, cat);
                    var (chLegal, chWhy) = Core.HeroLab.LegalOf(chRes, chH, chSkidCap);
                    var chRq = Core.PsyLab.ReacquireSpread(chCand, chH.ReacqDeg, chH.ReacqMs);
                    var chFamRq = Core.PsyLab.ReacquireSpread(new Core.PsyLab.Cand { Name = chH.FamilyCard, P = chFam }, chH.ReacqDeg, chH.ReacqMs);
                    var chBpRq = Core.PsyLab.ReacquireSpread(new Core.PsyLab.Cand { Name = "breakpoint", P = cat.Find("breakpoint")! }, chH.ReacqDeg, chH.ReacqMs);
                    // 2026-10-24: every card is now built on the GOAT, so the game Masters are close relatives of the character cards
                    // (Hela and Emre ARE the GOAT). The card must beat Breakpoint on its hero's fights and stay within the lab's 5%
                    // robustness tolerance of its game Master - except where the lab's robustness pass chose the field-proven GOAT; the
                    // detail prints both numbers, nothing hidden.
                    bool chIsGoat = chP.cm == Core.Goat.Cm && chP.adv.accel == Core.Goat.Accel && chP.adv.cap == Core.Goat.Cap && chP.adv.offset == Core.Goat.Offset;
                    Ok($"{chP.name} card ({ch.id}): the lab winner's fields on the GOAT's rig, sens {ch.sens:0.000}, LEGAL under every lab gate, out-scores Breakpoint on {chH.Name}'s fights and stays within 5% of its game Master (or is the GOAT itself), re-acquires at least as consistently as Breakpoint",
                       chFields && Math.Abs(chSens - ch.sens) < 0.001 && chLegal && chRel < chBpRel && (chIsGoat || chRel <= chFamRel * 1.05) && chRq.spreadPct <= chBpRq.spreadPct + 1e-9,
                       $"rel {chRel:0.000} vs {chH.FamilyCard} {chFamRel:0.000} / breakpoint {chBpRel:0.000}, re-acquire {chRq.spreadPct:0.0}% vs {chH.FamilyCard} {chFamRq.spreadPct:0.0}% / breakpoint {chBpRq.spreadPct:0.0}%, sens {chSens:0.000}" + (chLegal ? "" : ", ILLEGAL: " + chWhy));
                }
            }

            // ---- 2026-09-09: hover dials ----
            Ok("hover: Rig defaults are a full-range window with HDL on",
               new Rig().HdlMin == 0 && new Rig().HdlMax == 87 && new Rig().HdlEnabled);
            Ok("hover: the window is validated - min>max and out-of-range are refused, 0..100 accepted",
               Core.OtdBridge.HoverValid(0, 87) && Core.OtdBridge.HoverValid(0, 100) && Core.OtdBridge.HoverValid(5, 5) &&
               !Core.OtdBridge.HoverValid(50, 20) && !Core.OtdBridge.HoverValid(-1, 87) && !Core.OtdBridge.HoverValid(0, 101));
            Ok("hover: every card's authored hover max is inside the plugin's range",
               cat.presets.All(p => Core.OtdBridge.HoverValid(0, p.hdlMax)));

            // ---- session 3: plans + policy for the game filters ----
            var owOn = cat.Find("owllc")!.WithCohOv(null); owOn.filters = System.Text.Json.JsonSerializer.Deserialize<System.Collections.Generic.List<FilterSpec>>(System.Text.Json.JsonSerializer.Serialize(owOn.filters))!;
            owOn.filters.First(f => f.id == "AimForge.Filters.Ow2Master").on = true;
            Ok("plan: every game card carries its game Master entry - OFF on every family and character card since the GOAT (it runs none; the lab's game-filter dimension follows the family Master), ON on the CoD cards; the entry keeps the OW2 rail settings for when you switch it on",
               cat.presets.Where(p => p.group != "The Baseline" && !p.group.StartsWith("Breakpoint")).All(p => p.filters!.All(f => !f.id.StartsWith("AimForge.Filters.") || !f.on)) &&
               owOn.filters!.Any(f => f.id == "AimForge.Filters.Ow2Master" && f.on &&
                   Math.Abs(f.settings["RailStrength"] - 0.25) < 1e-9 && Math.Abs(f.settings["TrackUntilMmS"] - 150) < 1e-9) &&
               cat.Find("rivmp")!.filters!.Any(f => f.id == "AimForge.Filters.RivalsMaster" && !f.on) &&   // retired 2026-09-16
               cat.Find("breakpoint")!.filters!.Any(f => f.id == "AimForge.Filters.CodMaster" && f.on) &&
               cat.Find("rivlla")!.filters!.Any(f => f.id == "AimForge.Filters.RivalsMaster" && !f.on) &&
               cat.Find("bo6og")!.filters!.Any(f => f.id == "AimForge.Filters.CodMaster" && f.on));
            Ok("plan: no Lab member ships ON (the families run no lab filter; valpl is the Valorant Precision now); CodLab OFF everywhere incl. Slow Center (field verdict)",
               cat.Find("breakslow")!.filters!.Any(f => f.id == "AimForge.Filters.CodLab" && !f.on) &&
               cat.presets.All(p => !(p.filters ?? new System.Collections.Generic.List<FilterSpec>()).Any(f => f.id == "AimForge.Filters.CodLab" && f.on)) &&
               cat.presets.All(p => !(p.filters ?? new System.Collections.Generic.List<FilterSpec>()).Any(f => f.id.EndsWith("Lab") && f.on)) &&
               cat.Find("owmp")!.filters!.Any(f => f.id == "AimForge.Filters.Ow2Lab" && !f.on));
            Ok("PlanTier: strict cards stay <=T2 with their game Master switched on (owllc + Ow2Master), filterless cards read T0 (owmp)",
               Core.RolePolicy.PlanTier(owOn).CompareTo("T3") < 0 &&
               Core.RolePolicy.PlanTier(cat.Find("owmp")!) == "T0" &&
               Core.RolePolicy.ApplyBlockers(owOn).Count == 0, Core.RolePolicy.PlanTier(owOn) + "/" + Core.RolePolicy.PlanTier(cat.Find("owmp")!));
            Ok("role policy: every strict card still has zero Apply blockers with plans included",
               cat.presets.Where(p => Core.RolePolicy.MaxTier(Core.RolePolicy.RoleOf(p)) <= 2)
                          .All(p => Core.RolePolicy.ApplyBlockers(p).Count == 0));

            // ---- session 4 (overhaul pass): export/import, --qc invariant, hover hygiene ----
            {
                var src = cat.Find("owpl")!;
                var json = JsonSerializer.Serialize(src);
                var back = JsonSerializer.Deserialize<Preset>(json, new JsonSerializerOptions { PropertyNameCaseInsensitive = true })!;
                back.Normalise();
                Ok("build export/import round-trip preserves identity (curve, rig, plan, pins)",
                   back.id == src.id && back.pxmm == src.pxmm && back.cm == src.cm &&
                   back.lut?.Length == src.lut?.Length && back.adv.accel == src.adv.accel && back.adv.cap == src.adv.cap && back.adv.offset == src.adv.offset &&
                   back.cohOv?.tapHold == src.cohOv?.tapHold &&
                   back.filters?.Count == src.filters?.Count);
                Ok("--qc invariant: zero violations across the whole roster",
                   cat.presets.All(p => (p.IsLut ? Curve.Check(p, t).Count : 0) + Core.RolePolicy.ApplyBlockers(p).Count == 0));
                Ok("hover hygiene: Rig carries Hover_min (default 0) alongside Hover_max",
                   new Rig().HdlMin == 0 && new Rig().HdlMax == 87);
            }

            // ---- 2026-09-16 final review: policy edges ----
            {
                var dipCross = new Preset { id = "x", name = "Custom", group = "Custom", pxmm = 57, cm = 37.7, lut = new[] { new[] { 2.66, 1.0 }, new[] { 10.0, 1.0 }, new[] { 20.0, 0.6 }, new[] { 60.0, 1.0 }, new[] { 300.0, 3.0 }, new[] { 1450.0, 3.0 } } };
                var shelfCross = new Preset { id = "y", name = "Custom", group = "Custom", pxmm = 57, cm = 37.7, lut = new[] { new[] { 2.66, 0.85 }, new[] { 16.0, 0.85 }, new[] { 60.0, 1.0 }, new[] { 300.0, 3.0 } } };
                Ok("Curve.Check: a dip or a sub-unity shelf whose segment STARTS in the tremor band is caught even when it ends past 15 mm/s",
                   Curve.Check(dipCross, t).Any(s => s.Contains("dips")) && Curve.Check(shelfCross, t).Any(s => s.Contains("shelf")));
                var plantedFloor = new Preset { id = "zz", name = "Test Planted", group = "Call of Duty", pxmm = 57, cm = 37.7, lut = new[] { new[] { 2.66, 0.90 }, new[] { 15.0, 1.0 }, new[] { 309.0, 5.0 }, new[] { 1450.0, 5.0 } } };
                Ok("role policy: a Planted card with a sub-unity floor and no named exception is a violation (the retired 0.90 floor)",
                   Core.RolePolicy.ApplyBlockers(plantedFloor).Any(b => b.Contains("floor")));
                var feat = cat.Find("feather")!; var feAdv = feat.WithCohOv(feat.cohOv?.Copy()); feAdv.id = "feather~adv"; feAdv.name = feat.name + " (advanced)";
                var owAdv = cat.Find("breakpoint")!.WithCohOv(cat.Find("breakpoint")!.cohOv?.Copy()); owAdv.id = "breakpoint~adv"; owAdv.name += " (advanced)";
                Ok("Advanced-tab edits keep the loaded card's role, exceptions and game filter (feather~adv is Reference, breakpoint~adv keeps its CoD Master)",
                   Core.RolePolicy.RoleOf(feAdv) == "Reference" && Core.RolePolicy.ApplyBlockers(feAdv).Count == 0 &&
                   Core.RolePolicy.RoleOf(owAdv) == "Turbo" && FilterPlan.Fold(owAdv, FilterPlan.Prefill(owAdv)).filters!.Any(f => f.id == "AimForge.Filters.CodMaster" && f.on));
                Ok("hover pre-flight: an empty window (contact-only max 1 with min 5) is refused by the apply gate; a normal window passes",
                   Core.OtdBridge.HoverBlocker(new Rig { HdlEnabled = true, HdlMin = 5, HdlMax = 1 }) != null &&
                   Core.OtdBridge.HoverBlocker(new Rig { HdlEnabled = true, HdlMin = 0, HdlMax = 87 }) == null &&
                   Core.OtdBridge.HoverBlocker(new Rig { HdlEnabled = false, HdlMin = 5, HdlMax = 1 }) == null);
                var finpl = cat.Find("trueraw")!; var farRig = Rig.From(finpl); farRig.Cm360 = 40;
                var (_, reachWarn) = Core.RolePolicy.GateForApply(finpl, t, () => new System.Collections.Generic.List<FilterInfo>(), farRig);
                Ok("reach warning judges the rig being APPLIED: True Raw (flat) at a user's cm 40 warns (200 mm 180), at its own 27 it does not",
                   reachWarn.Any(w => w.Contains("180 needs")) && !Core.RolePolicy.Check(finpl).Any(w => w.Contains("180 needs")));
                var hfb = cat.Find("finlla")!.WithCohOv(null); hfb.filters = System.Text.Json.JsonSerializer.Deserialize<System.Collections.Generic.List<FilterSpec>>(System.Text.Json.JsonSerializer.Serialize(hfb.filters))!;
                hfb.filters.First(f => f.id == "AimForge.Filters.FinalsMaster").on = true;
                var gameCat = new System.Collections.Generic.List<FilterInfo> { new FilterInfo { Path = "AimForge.Filters.CodMaster", Display = "AimForge CoD Master", Installed = true, Tier = "T1" } };
                Ok("plan validation: a game filter the plugin carries is not reported 'will NOT be written' just because settings.json has not registered it yet",
                   hfb.filters!.Any(f => f.id == "AimForge.Filters.FinalsMaster" && f.on) && !Core.RolePolicy.ValidatePlan(hfb, hfb.filters, gameCat).warnings.Any(w => w.Contains("FinalsMaster")));
            }

            // ---- 2026-09-24: experimental modes (Intent Speed, Reversal Carry, Nib Twin) and the moving-tap fade - XP_TOGGLES.md ----
            {
                var V2 = (Func<double, double, System.Numerics.Vector2>)((x, y) => new System.Numerics.Vector2((float)x, (float)y));
                const double D = 1000.0 / 360.0;
                // the golden trace: XP off must be the PRE-XP core, bit for bit (hashes from a compiled copy of the pre-XP
                // CadenceCore - 2026-09-24 review: the old pin compared two instances of the new core)
                ulong Golden(Filters.CadenceCore c)
                {
                    ulong h = 1469598103934665603UL; uint sd = 12345;
                    double Rnd() { sd = sd * 1664525u + 1013904223u; return (sd >> 8) / 16777216.0; }
                    var pos = V2(15000, 15000);
                    for (int i = 0; i < 20000; i++)
                    {
                        double sp = (i / 400) % 5 == 0 ? 0.3 : (i / 400) % 5 == 1 ? 8 : (i / 400) % 5 == 2 ? 40 : (i / 400) % 5 == 3 ? 150 : 600;
                        double ang = (i / 90) * 1.3 + Rnd() * 0.4;
                        pos += V2(Math.Round(sp * Math.Cos(ang) + (Rnd() - 0.5) * 3), Math.Round(sp * Math.Sin(ang) + (Rnd() - 0.5) * 3));
                        double dt = i % 997 == 0 ? 60 : i % 1999 == 0 ? 1500 : i % 313 == 0 ? 5.5556 : 2.7778 * (0.9 + 0.2 * Rnd());
                        if (i % 1531 == 0) c.Reset();
                        var o = c.Filter(pos, dt);
                        h = (h ^ (ulong)BitConverter.SingleToInt32Bits(o.X)) * 1099511628211UL;
                        h = (h ^ (ulong)BitConverter.SingleToInt32Bits(o.Y)) * 1099511628211UL;
                    }
                    return h;
                }
                var gA = new Filters.CadenceCore { NominalHz = 360, ClassicAccel = 0.005985, ClassicOffset = 8.77193, ClassicCap = 3.6, ClassicExp = 2 };
                var gB = new Filters.CadenceCore { NominalHz = 360 }; gB.Vs[0] = 2.66; gB.Gs[0] = 0.85; gB.Vs[1] = 6; gB.Gs[1] = 1; gB.Vs[2] = 1450; gB.Gs[2] = 1;
                var gC = new Filters.CadenceCore { NominalHz = 360, ClassicAccel = 0.005985, ClassicOffset = 8.77193, ClassicCap = 3.6, ClassicExp = 2, IntentTauMs = 3, CarryArmMms = 1 };
                ulong hA = Golden(gA), hB = Golden(gB), hC = Golden(gC);
                Ok("XP off: Cadence Lock is bit-identical to the PRE-XP engine (golden trace: 20k reports with gaps, lifts, merged frames; dials without the switches change nothing)",
                   hA == 16478045299042530778UL && hB == 13847567081517769936UL && hC == hA, $"{hA} / {hB}");

                var xb = cat.Find("bo6og")!; var xbp = cat.Find("breakpoint")!; var xbs = cat.Find("breakwide")!;
                var xr = Core.XpLab.Run(xb, Rig.From(xb)); var xrp = Core.XpLab.Run(xbp, Rig.From(xbp)); var xrs = Core.XpLab.Run(xbs, Rig.From(xbs));
                Ok("Intent Speed: ramp-tracking gain noise at 15-60 mm/s falls to under half of plain Cadence Lock (bo6og, breakpoint, breakwide)",
                   new[] { xr, xrp, xrs }.All(r => r.GainNoiseIntentPct.Zip(r.GainNoiseOffPct).All(z => z.First < 0.5 * z.Second)),
                   "bo6og off " + string.Join("/", xr.GainNoiseOffPct.Select(x => x.ToString("0.00"))) + "%  intent " + string.Join("/", xr.GainNoiseIntentPct.Select(x => x.ToString("0.00"))) + "%");
                Ok("Intent Speed + Reversal Carry: micro-aim (rest tremor + 1.1 mm/s creep) delivers exactly what plain Cadence Lock does",
                   new[] { xr, xrp, xrs }.All(r => Math.Abs(r.MicroIntentMm - r.MicroOffMm) < 1e-6 && Math.Abs(r.MicroCarryMm - r.MicroOffMm) < 1e-6), $"{xr.MicroOffMm:0.000} mm");
                Ok("Intent Speed: 40 mm flicks at 100/150/200 ms land within 1% of plain Cadence Lock",
                   new[] { xr, xrp, xrs }.All(r => r.FlickIntentMm.Zip(r.FlickOffMm).All(z => Math.Abs(z.First / z.Second - 1) < 0.01)));
                Ok("Intent Speed: a 90-degree turn at 60 mm/s steps the gain at most 1.25x plain on every ramped card (clamped to one lattice unit)",
                   new[] { xr, xrp, xrs }.All(r => r.TurnMaxGainStepIntent <= 1.25 * r.TurnMaxGainStepOff + 1e-9),
                   string.Join("  ", new[] { ("bo6og", xr), ("breakpoint", xrp), ("breakslow", xrs) }.Select(t => $"{t.Item1} {t.Item2.TurnMaxGainStepOff:0.000}->{t.Item2.TurnMaxGainStepIntent:0.000}")));
                // Intent stop surplus and trail on a strict card (2026-09-24 review: unclamped it trailed 1.2 mm and over-delivered stops)
                {
                    var rgi = Rig.From(xbp); rgi.Engine = "cadence"; var ci = Core.OtdBridge.CadenceCoreFor(xbp, rgi); rgi.IntentSpeed = true; var cj = Core.OtdBridge.CadenceCoreFor(xbp, rgi);
                    var q = V2(10000, 10000); ci.Filter(q, D); cj.Filter(q, D); double trail = 0; System.Numerics.Vector2 oi = default, oj = default; double stopI = 0, stopJ = 0;
                    for (int i = 0; i < 180; i++)
                    {
                        double v = i < 108 ? 250 : 250 * 0.5 * (1 + Math.Cos(Math.PI * (i - 108) / 11.0)) * (i < 119 ? 1 : 0);
                        var pq = q; q += V2(Math.Round(v * D / 1000 * 100), 0);
                        var a1 = ci.Filter(q, D); var a2 = cj.Filter(q, D);
                        if (i >= 108) { stopI += a1.X - oi.X; stopJ += a2.X - oj.X; }
                        oi = a1; oj = a2; trail = Math.Max(trail, Math.Abs(a1.X - a2.X) / 100.0);
                    }
                    Ok("Intent Speed on Breakpoint (Turbo): a 250 mm/s track trails plain by at most 0.4 mm and its stop over-delivers at most 3%",
                       trail <= 0.4 && stopJ <= stopI * 1.03 + 0.5, $"trail {trail:0.000} mm, stop {stopI / 100:0.00} -> {stopJ / 100:0.00} mm");
                }
                Ok("Reversal Carry: the first 40 ms of a strafe leg carry more gain and travel on the Planted card (breakslow); a flick's overshoot correction is untouched",
                   xrs.ReversalGainCarry > xrs.ReversalGainOff + 0.03 && xrs.ReversalTravelCarryMm > xrs.ReversalTravelOffMm && new[] { xr, xrp, xrs }.All(r => Math.Abs(r.OvershootCorrCarryMm - r.OvershootCorrOffMm) < 1e-6),
                   $"gain {xrs.ReversalGainOff:0.000} -> {xrs.ReversalGainCarry:0.000}, travel {xrs.ReversalTravelOffMm:0.00} -> {xrs.ReversalTravelCarryMm:0.00} mm");
                // the 2026-09-24 review scenarios for carry, each compared with carry OFF on breakslow
                {
                    (double off, double on) Pair(Func<int, double> vx, int n, Func<int, double>? dtAt = null, int sd = 3)
                    {
                        double R(double carry)
                        {
                            var r0 = Rig.From(xbs); r0.Engine = "cadence"; r0.ReversalCarryMs = carry; var c0 = Core.OtdBridge.CadenceCoreFor(xbs, r0);
                            var rnd = new Random(sd); var q = V2(10000, 10000); var o0 = c0.Filter(q, D); var o = o0; double x = 10000;
                            for (int i = 0; i < n; i++) { x += vx(i) * D / 1000 * 100; q = V2(Math.Round(x) + (rnd.Next(3) - 1) * (vx(i) == 0 ? 1 : 0), 10000 + rnd.Next(3) - 1); o = c0.Filter(q, dtAt?.Invoke(i) ?? D); }
                            return o.X - o0.X;
                        }
                        return (R(0), R(40));
                    }
                    // track at 150 mm/s, stop, a 0.3 mm settle-back, then rest tremor
                    var stop = Pair(i => i < 120 ? 150 : i < 132 ? 150 * (132 - i) / 12.0 : i < 146 ? -0.3 / 14 / (D / 1000) : 0, 260);
                    // track left, a 200 ms gap with NO lift report (the HDL drops hover reports), then 30 mm/s right
                    var gap = Pair(i => i < 100 ? -120 : 30, 140, i => i == 100 ? 200 : D);
                    // small flicks from rest (10-20 mm at 100-200 ms) then a 1.5 mm correction back: never a strafe rhythm
                    bool flicksClean = true; string fw = "";
                    foreach (var (A, T) in new[] { (10.0, 100.0), (15.0, 150.0), (20.0, 150.0), (20.0, 200.0) })
                    {
                        int fn = (int)Math.Round(T / D);
                        Func<int, double> v = i => i < 20 ? 0 : i < 20 + fn ? A * 30 * Math.Pow((i - 20) / (double)fn, 2) * Math.Pow(1 - (i - 20) / (double)fn, 2) / (T / 1000.0) : i < 20 + fn + 27 ? -20 : 0;
                        var r = Pair(v, 20 + fn + 60);
                        if (Math.Abs(r.on - r.off) > 0.05) { flicksClean = false; fw += $" {A}/{T}: {r.off:0.0000}->{r.on:0.0000}"; }
                    }
                    Ok("Reversal Carry never touches a stop-and-settle (+<=3%), a gapped stroke (no stale state across a 200 ms gap) or a flick's correction from rest",
                       stop.on <= stop.off * 1.03 + 1 && Math.Abs(gap.on - gap.off) < 0.05 && flicksClean, $"settle {stop.off:0.0}->{stop.on:0.0} units, gap {gap.off:0.0}->{gap.on:0.0}{fw}");
                }
                var rC = Rig.From(xb); rC.Engine = "cadence"; rC.ReversalCarryMs = 40; var rI = Rig.From(xb); rI.Engine = "cadence"; rI.IntentSpeed = true;
                var rRa = Rig.From(xb); rRa.IntentSpeed = true;
                var xpLab = new Preset { id = "synthetic-lab", name = "Slipstream", pxmm = 57, cm = 37.7, adv = new Adv { reset = 80 } };
                Ok("XP policy: Intent Speed / Reversal Carry need the Cadence Lock engine; Reversal Carry is refused on Master/Baseline/Turbo/Tapped (every family role) and allowed on Planted/Lab/Reference; carry outside 10-80 ms is refused",
                   Core.Experiments.Blocker(rRa, xb) != null && Core.Experiments.Blocker(rC, xb) != null && Core.Experiments.Blocker(rI, xb) == null &&
                   Core.Experiments.Blocker(rC, cat.Find("breakslow")!) == null && Core.Experiments.Blocker(rC, xpLab) == null && Core.Experiments.Blocker(rC, cat.Find("rivlla")!) != null && Core.Experiments.Blocker(rC, cat.Find("feather")!) == null &&
                   Core.Experiments.Blocker(new Rig { Engine = "cadence", ReversalCarryMs = 200 }, xpLab) != null &&
                   Core.Experiments.Blocker(new Rig { Engine = "cadence", ReversalCarryMs = 5 }, xpLab) != null &&
                   Core.Experiments.Blocker(new Rig { Engine = "cadence", ReversalCarryMs = double.NaN }, xpLab) != null);
                var pts = Core.OtdBridge.CadencePoints(xb, rC); var ptsI = Core.OtdBridge.CadencePoints(xb, rI); var ptsOff = Core.OtdBridge.CadencePoints(xb, Rig.From(xb));
                var cc2 = Core.OtdBridge.CadenceCoreFor(xb, rC);
                Ok("XP plan: the modes travel from the rig into the Cadence Lock plan (so the getfilters read-back verifies them) and into the core; off writes 0",
                   pts["ReversalCarryMs"] == 40 && ptsI["IntentSpeed"] == 1 && ptsOff["IntentSpeed"] == 0 && ptsOff["ReversalCarryMs"] == 0 && cc2.ReversalCarryMs == 40 && cc2.IntentSpeed == 0);
                string xpFile = Path.Combine(Path.GetTempPath(), "aimforge-selftest-xp.txt");
                new Core.Experiments.State { Intent = true, CarryMs = 35, Twin = true }.Save(xpFile); var ld = Core.Experiments.State.Load(xpFile);
                File.WriteAllText(xpFile, "intent;9999"); var bad = Core.Experiments.State.Load(xpFile);
                File.WriteAllText(xpFile, "off;5"); var low = Core.Experiments.State.Load(xpFile);
                File.WriteAllText(xpFile, "off;NaN"); var nan = Core.Experiments.State.Load(xpFile);
                Ok("xp.txt round-trips (three fields; the two-field form still parses) and snaps a bad carry to off or into 10-80 ms",
                   ld.Intent && ld.CarryMs == 35 && ld.Twin && bad.CarryMs == Core.Experiments.MaxCarryMs && !bad.Twin && low.CarryMs == Core.Experiments.MinCarryMs && nan.CarryMs == 0);

                // ---- Nib Twin: the core's laws ----
                {
                    var tw = new Filters.NibTwinCore { Twin = 1, SkidXmm = -0.24, SkidYmm = 0.18, SkidFullPressure = 0.3 };
                    var off = new Filters.NibTwinCore { Twin = 0 };
                    var rnd = new Random(9); var q = V2(50, 50); bool hoverExact = true, offExact = true;
                    for (int i = 0; i < 3000; i++)
                    {
                        q += V2((rnd.NextDouble() - 0.5) * 0.6, (rnd.NextDouble() - 0.5) * 0.6);
                        double dt = i % 700 == 0 ? 90 : D;
                        if (tw.Filter(q, dt, 0) != q) hoverExact = false;   // pressure 0: exact passthrough
                        if (off.Filter(q, dt, 0.5) != q) offExact = false;   // switch off: exact passthrough at any pressure
                    }
                    Ok("Nib Twin: exact passthrough in hover (pressure 0) and when switched off, at any pressure", hoverExact && offExact);
                    // a still pen through a full press: the output never moves on a report the pen did not move
                    var t2 = new Filters.NibTwinCore { Twin = 1, SkidXmm = -0.24, SkidYmm = 0.18, SkidFullPressure = 0.3 };
                    var still = V2(80, 40); var prev = t2.Filter(still, D, 0); bool noGhost = true; double maxRatio = 0;
                    var pr = Core.NibLab.TapPressure(10, 40);
                    var pen = still;
                    for (int i = 1; i < 140; i++)
                    {
                        var np = i % 17 == 0 ? pen + V2(0.01, 0) : pen;   // a lattice unit now and then
                        var o = t2.Filter(np, D, pr(i));
                        if (np == pen && o != prev) noGhost = false;
                        if (np != pen) maxRatio = Math.Max(maxRatio, (o - prev).Length() / (np - pen).Length());
                        pen = np; prev = o;
                    }
                    Ok("Nib Twin: the output never moves on a report where the pen did not move, and never more than 2x what the pen moved; the ledger nets to zero after the press",
                       noGhost && maxRatio <= 2.0 + 1e-6 && t2.LedgerMm < 1e-9, $"max out/in {maxRatio:0.00}, ledger {t2.LedgerMm:0.000000} mm");
                    // lift/gap law: never snaps onto the pen while OTD could pass the jump
                    var t3 = new Filters.NibTwinCore { Twin = 1, SkidXmm = -0.24, SkidYmm = 0.18, SkidFullPressure = 0.3 };
                    var pp = V2(10, 10); var o3 = t3.Filter(pp, D, 0);
                    for (int i = 0; i < 20; i++) { pp += V2(0.3, 0); o3 = t3.Filter(pp, D, i > 5 ? 0.35 : 0); }
                    t3.Reset(); var jump = pp + V2(5, 2); var oj3 = t3.Filter(jump, 30, 0.35);
                    var gq = jump + V2(1, 0); var og = t3.Filter(gq, 60, 0.35);
                    Ok("Nib Twin: after a lift or a 60 ms gap the next report passes the hand's own delta (no snap, ledger cleared)",
                       ((oj3 - o3) - (jump - pp)).Length() < 1e-4 && ((og - oj3) - (gq - jump)).Length() < 1e-4 && t3.LedgerMm == 0);
                }
                // ---- the moving-tap fade and Nib Twin through the SHIPPING pin + curve (MODEL skid) ----
                {
                    var nb = cat.Find("bo6og")!; var np2 = cat.Find("breakpoint")!;
                    Core.NibLab.Scores NS(Preset c, bool pin, double fade, bool twin, double hold = 30, double brk = 0.9, int seeds = 4, double force = 1.0, double scale = 1, double rot = 0)
                        => Core.NibLab.Score(c, new Core.NibLab.Config { Pin = pin, PinFade = fade, Twin = twin, TapHold = hold, TapBreak = brk, CalScale = scale, CalRotDeg = rot }, force, seeds);
                    bool pinOk = true; string pinW = ""; double worstLegacy = 0;
                    foreach (var c in new[] { nb, np2 })
                        foreach (var (h, bk) in new[] { (25.0, 0.45), (30.0, 0.9) })
                        {
                            var lg = NS(c, true, 0, false, h, bk, 2); var fd = NS(c, true, 1, false, h, bk, 2);
                            worstLegacy = Math.Max(worstLegacy, lg.MovePinCost.Max());
                            if (fd.MovePinCost.Max() > 0.01) { pinOk = false; pinW += $" {c.id} {h}/{bk}: {fd.MovePinCost.Max():0.000}"; }
                            if (Math.Abs(fd.RestPeak - lg.RestPeak) > 0.005 || Math.Abs(fd.RestAtClick - lg.RestAtClick) > 0.005) { pinOk = false; pinW += $" rest changed {c.id}"; }
                        }
                    Ok("Tap Anchor moving-tap fade: taps while moving at 30-141 mm/s leave <= 0.01 deg of the pin's own overshoot (bo6og, breakpoint; pins 25/0.45, 30/0.9); rest taps unchanged",
                       pinOk && worstLegacy > 0.1, $"legacy worst {worstLegacy:0.000} deg{pinW}");
                    var lgB = NS(nb, true, 0, false); var fdB = NS(nb, true, 1, false); var twB = NS(nb, true, 1, true);
                    var lgP = NS(np2, true, 0, false); var twP = NS(np2, true, 1, true);
                    // (<= 40%: the fade now reads the hand before the press, so a tap near a strafe reversal keeps a little pin -
                    // 30% over 6 seeds, 35% over these 4; it was 29% when the press's own swing counted as 'moving')
                    Ok("Nib Twin (model skid): strafing-spray error in the first 150 ms falls to <= 40% of the shipped pin and flick-shot error at the click to <= 60% (bo6og, breakpoint)",
                       twB.SprayFirst150 <= 0.40 * lgB.SprayFirst150 && twP.SprayFirst150 <= 0.40 * lgP.SprayFirst150 && twB.FlickShotAtClick <= 0.6 * lgB.FlickShotAtClick && twP.FlickShotAtClick <= 0.6 * lgP.FlickShotAtClick,
                       $"spray bo6og {lgB.SprayFirst150:0.000}->{twB.SprayFirst150:0.000}, breakpoint {lgP.SprayFirst150:0.000}->{twP.SprayFirst150:0.000} deg; flick@click {lgB.FlickShotAtClick:0.000}->{twB.FlickShotAtClick:0.000}");
                    Ok("Nib Twin: rest one-taps are exactly as good as the pin alone (it runs FIRST, so the pin never sees the skid twice)",
                       twB.RestAtClick <= fdB.RestAtClick + 0.01 && twB.RestPeak <= fdB.RestPeak + 0.01 && twB.RestResidual <= fdB.RestResidual + 0.01,
                       $"@click {fdB.RestAtClick:0.000}/{twB.RestAtClick:0.000}, peak {fdB.RestPeak:0.000}/{twB.RestPeak:0.000} deg");
                    bool robust = true; string rw = "";
                    foreach (var (n, sc) in new[] { ("0.6x", NS(nb, true, 1, true, scale: 0.6, seeds: 2)), ("1.4x", NS(nb, true, 1, true, scale: 1.4, seeds: 2)), ("+25deg", NS(nb, true, 1, true, rot: 25, seeds: 2)), ("-25deg", NS(nb, true, 1, true, rot: -25, seeds: 2)),
                                                       ("force0.5", NS(nb, true, 1, true, force: 0.5, seeds: 2)), ("force2", NS(nb, true, 1, true, force: 2, seeds: 2)) })
                    {
                        if (sc.SprayFirst150 > fdB.SprayFirst150 || sc.RestPeak > fdB.RestPeak + 0.01) { robust = false; } rw += $" {n} {sc.SprayFirst150:0.000}";
                    }
                    Ok("Nib Twin: a calibration 40% off in size or 25 deg off in angle, or taps at 0.5x-2x the calibrated force, is still never worse than no twin",
                       robust, $"no twin {fdB.SprayFirst150:0.000};{rw}");
                }
                // ---- the fit, on model press logs ----
                {
                    var good = Core.NibFit.Fit(Core.NibLab.ModelLog(20, 0.30, 143.1, 5));
                    var upright = Core.NibFit.Fit(Core.NibLab.ModelLog(20, 0.0, 0, 6));
                    var moving = Core.NibFit.Fit(Core.NibLab.ModelLog(20, 0.30, 143.1, 7, moving: true));
                    var few = Core.NibFit.Fit(Core.NibLab.ModelLog(8, 0.30, 143.1, 8));
                    Ok("nib fit: 20 settled model taps recover the press-phase swing (0.30 mm skid + 15% flexion: 0.27-0.38 mm) within 5 deg, R2 >= 0.8; an upright grip, moving taps and too few taps are all refused",
                       // the fit measures the whole press-phase motion: the 0.30 mm swing plus the 15% hand flexion that rides the
                       // same ramp (removing both at the click is what matters; the flexion's non-return is left to the hand)
                       good.Refused == null && good.Cal != null && good.Cal.MagMm >= 0.27 && good.Cal.MagMm <= 0.38 && Math.Abs(good.Cal.AngleDeg - 143.1) <= 5 && good.Cal.R2 >= 0.8 &&
                       upright.Refused != null && moving.Refused != null && few.Refused != null,
                       good.Report + " | upright: " + upright.Refused + " | moving: " + moving.Refused + " | few: " + few.Refused);
                    var cal = Core.NibLab.ModelCal();
                    Ok("nib calibration guards: |swing| 0.1-0.6 mm, R2 >= 0.8, >= 12 taps",
                       cal.Invalid() == null && new Core.NibCal { SkidXmm = 0.05, Taps = 20, R2 = 0.9 }.Invalid() != null &&
                       new Core.NibCal { SkidXmm = 0.8, Taps = 20, R2 = 0.9 }.Invalid() != null && new Core.NibCal { SkidXmm = 0.3, Taps = 20, R2 = 0.5 }.Invalid() != null &&
                       new Core.NibCal { SkidXmm = 0.3, Taps = 5, R2 = 0.9 }.Invalid() != null);
                }
                // ---- Nib Twin plumbing: engine-free, first in the chain, needs a valid calibration and the loaded plugin ----
                {
                    var rt = Rig.From(xb); rt.NibTwin = true;   // RawAccel engine
                    string calPath = Core.NibCal.DefaultPath; bool had = File.Exists(calPath); string? saved = had ? File.ReadAllText(calPath) : null;
                    try
                    {
                        if (had) File.Delete(calPath);
                        string? noCal = Core.Experiments.Blocker(rt, xb);
                        Core.NibLab.ModelCal().Save(calPath); Core.NibLab.ModelCal().ApplyTo(rt);
                        string? withCal = Core.Experiments.Blocker(rt, xb);
                        var np = Core.OtdBridge.NibPoints(rt);
                        string probeData = Path.Combine(Path.GetTempPath(), "aimforge-selftest-otd-nib");
                        var otdN = new Core.OtdBridge(probeData, probeData);
                        Ok("Nib Twin needs a calibration but NOT the Cadence engine (it runs on RawAccel too); its plan carries the swing; a missing plugin is refused",
                           noCal != null && noCal.Contains("calibration") && withCal == null && np["Twin"] == 1 && Math.Abs(np["SkidXmm"] - Core.NibLab.ModelCal().SkidXmm) < 1e-4 &&
                           Core.OtdBridge.NibPoints(Rig.From(xb))["Twin"] == 0 && otdN.NibBlocker(rt) != null && otdN.NibBlocker(Rig.From(xb)) == null,
                           $"no calibration: {noCal}");
                    }
                    finally { try { if (had) File.WriteAllText(calPath, saved!); else File.Delete(calPath); } catch { } }
                }
                // ---- 2026-09-24 review round 2: lagged swing, the fit, the fade's pre-press speed, and the plumbing pins ----
                {
                    // (1) the core with a swing that trails the pressure, calibrated with the same lag: nothing removed twice
                    string lagW = ""; bool lagOk = true;
                    foreach (int L in new[] { 0, 1, 2 })
                        foreach (double v in new[] { 0.0, 100.0 })
                        {
                            var tw = new Filters.NibTwinCore { Twin = 1, SkidXmm = -0.24, SkidYmm = 0.18, SkidFullPressure = 0.3, SkidLagReports = L };
                            var pr = Core.NibLab.TapPressure(30, 40);
                            System.Numerics.Vector2 o0 = default, h0 = default; double mid = 0, end = 0; int n = 160;
                            for (int i = 0; i < n; i++)
                            {
                                var hand = V2(50 + v * i / 360.0, 50); double h = Math.Min(1.0, pr(i - L) / 0.3);
                                var o = tw.Filter(hand + V2(-0.24 * h, 0.18 * h), D, pr(i));
                                if (i == 0) { o0 = o; h0 = hand; }
                                double e = ((o - o0) - (hand - h0)).Length();
                                if (pr(i) > 0) mid = Math.Max(mid, e);
                                if (i == n - 1) end = e;
                            }
                            if (mid > 0.03 || end > 0.01) { lagOk = false; lagW += $" lag {L} @{v} mm/s: mid {mid:0.000} end {end:0.000} mm"; }
                        }
                    Ok("Nib Twin: a swing trailing the pressure by 0/1/2 reports, calibrated with that lag, is removed once - no double removal while moving, no offset at rest",
                       lagOk, lagOk ? "all within 0.03 mm mid-press, 0.01 mm after" : lagW);

                    // (2) the SHIPPING fit on a lagged log, then that calibration through the shipping pin + curve
                    var nb2 = cat.Find("bo6og")!;
                    var fl = Core.NibFit.Fit(Core.NibLab.ModelLog(20, 0.30, 143.1, 12, lag: 2));
                    var lagTw = fl.Cal == null ? null : Core.NibLab.Score(nb2, new Core.NibLab.Config { Pin = true, PinFade = 1, Twin = true, SwingLag = 2, Cal = fl.Cal }, 1, 2);
                    var lagNo = Core.NibLab.Score(nb2, new Core.NibLab.Config { Pin = true, PinFade = 1, SwingLag = 2 }, 1, 2);
                    // (the pre-fix core made this WORSE than no twin: 0.68 vs 0.54 deg)
                    Ok("nib fit + twin, lag-2 swing: the fit finds lag 2 and its calibration cuts the strafing-spray error to <= 60% of no twin, rest skid no worse",
                       fl.Refused == null && fl.Cal!.SkidLagReports == 2 && lagTw != null && lagTw.SprayFirst150 <= 0.6 * lagNo.SprayFirst150 && lagTw.RestSkidPeak <= lagNo.RestSkidPeak + 0.01,
                       fl.Report + (lagTw != null ? $" | spray {lagNo.SprayFirst150:0.000}->{lagTw.SprayFirst150:0.000} deg" : ""));

                    // (3) the fit: firm or varied tappers, a lift in the log, a skid pointing near -x
                    var firm = Core.NibFit.Fit(Core.NibLab.ModelLog(20, 0.30, 143.1, 13, peakLo: 0.5, peakHi: 0.9));
                    var varied = Core.NibFit.Fit(Core.NibLab.ModelLog(20, 0.30, 143.1, 14, peakLo: 0.15, peakHi: 0.9));
                    var liftLog = Core.NibLab.ModelLog(20, 0.30, 143.1, 15); int blk = -1, row = 0;
                    for (int i = 0; i < liftLog.Count; i++)
                    {
                        if (liftLog[i].StartsWith("#press")) { blk++; row = 0; continue; }
                        row++;
                        if (blk != 5 || row < 100) continue;
                        var f = liftLog[i].Split(' ');
                        liftLog[i] = string.Join(" ", row == 100 ? "80" : f[0], f[1], (double.Parse(f[2], System.Globalization.CultureInfo.InvariantCulture) + 300).ToString(System.Globalization.CultureInfo.InvariantCulture), f[3]);
                    }
                    var lifted = Core.NibFit.Fit(liftLog);
                    var wrap = Core.NibFit.Fit(Core.NibLab.ModelLog(20, 0.30, 179.5, 16));
                    bool Mag(Core.NibFit.Result r) => r.Refused == null && r.Cal != null && r.Cal.MagMm >= 0.27 && r.Cal.MagMm <= 0.38;
                    double wrapErr = wrap.Cal == null ? 999 : Math.Abs(((wrap.Cal.AngleDeg - 179.5) % 360 + 540) % 360 - 180);
                    Ok("nib fit: firm (0.5-0.9) and varied (0.15-0.9) tappers on a nib saturating at 30% calibrate (the knee is fitted); a lift 3 mm away after one release does not refuse it; a skid near -x reports a small spread",
                       Mag(firm) && Mag(varied) && Mag(lifted) && Mag(wrap) && wrapErr <= 5 && wrap.Cal!.PerTapAngleSpreadDeg < 10,
                       $"firm: {firm.Refused ?? firm.Report} | varied: {varied.Refused ?? "ok"} | lift: {lifted.Refused ?? "ok"} | -x spread {wrap.Cal?.PerTapAngleSpreadDeg:0.0} deg");

                    // (4) the fade reads the hand BEFORE the press: a harder tap or a longer approach keeps the rest pin
                    var legF2 = Core.NibLab.Score(nb2, new Core.NibLab.Config { Pin = true, PinFade = 0 }, 2.0, 2);
                    var fadF2 = Core.NibLab.Score(nb2, new Core.NibLab.Config { Pin = true, PinFade = 1 }, 2.0, 2);
                    var legA = Core.NibLab.Score(nb2, new Core.NibLab.Config { Pin = true, PinFade = 0 }, 1.0, 2, 0.35);
                    var fadA = Core.NibLab.Score(nb2, new Core.NibLab.Config { Pin = true, PinFade = 1 }, 1.0, 2, 0.35);
                    Ok("moving-tap fade, skid alone: at 2x tap force and with a 0.35 mm approach a rest one-tap leaks no more swing than the legacy pin",
                       fadF2.RestSkidPeak <= legF2.RestSkidPeak * 1.1 + 0.005 && fadA.RestSkidPeak <= legA.RestSkidPeak * 1.1 + 0.005,
                       $"2x {legF2.RestSkidPeak:0.000}/{fadF2.RestSkidPeak:0.000}, approach {legA.RestSkidPeak:0.000}/{fadA.RestSkidPeak:0.000} deg");
                    // the twin on moving taps: never worse than no twin (both travel directions), bounded by the flexion it cannot know
                    var twM = Core.NibLab.Score(nb2, new Core.NibLab.Config { Pin = true, PinFade = 1, Twin = true }, 1.0, 2);
                    var noM = Core.NibLab.Score(nb2, new Core.NibLab.Config { Pin = true, PinFade = 1 }, 1.0, 2);
                    Ok("Nib Twin on taps while moving at 30-141 mm/s (both directions): the permanent error is never above the pin without the twin (+0.01 deg)",
                       twM.MovePermanent.Zip(noM.MovePermanent).All(z => z.First <= z.Second + 0.01),
                       "twin " + string.Join("/", twM.MovePermanent.Select(x => x.ToString("0.000"))) + " vs " + string.Join("/", noM.MovePermanent.Select(x => x.ToString("0.000"))) + " deg");

                    // (5) plumbing: nibtwin.json -> the rig through the SAME path the GUI and CLI use, all six values
                    string calPath = Core.NibCal.DefaultPath; bool had = File.Exists(calPath); string? saved = had ? File.ReadAllText(calPath) : null;
                    try
                    {
                        new Core.NibCal { SkidXmm = -0.21, SkidYmm = 0.17, SkidFullPressure = 0.27, SkidGamma = 0.8, SkidLagReports = 1, R2 = 0.9, Taps = 20 }.Save(calPath);
                        var r6 = Rig.From(nb2); new Core.Experiments.State { Twin = true }.ApplyTo(r6); var p6 = Core.OtdBridge.NibPoints(r6);
                        Ok("Nib Twin plumbing: xp.txt's twin + nibtwin.json reach the plan through Experiments.State.ApplyTo with all six values",
                           p6["Twin"] == 1 && p6["SkidXmm"] == -0.21 && p6["SkidYmm"] == 0.17 && p6["SkidFullPressure"] == 0.27 && p6["SkidGamma"] == 0.8 && p6["SkidLagReports"] == 1 && p6["Probe"] == 0,
                           string.Join(" ", p6.Select(kv => kv.Key + "=" + kv.Value)));
                    }
                    finally { try { if (had) File.WriteAllText(calPath, saved!); else File.Delete(calPath); } catch { } }

                    // (6) the chain an apply writes: a fixture settings.json with a Lead Sight stabilizer entry left saved
                    string fx = Path.Combine(Path.GetTempPath(), "aimforge-selftest-otd-plan");
                    try { if (Directory.Exists(fx)) Directory.Delete(fx, true); } catch { }
                    Directory.CreateDirectory(Path.Combine(fx, "Plugins", "AimForge Game Filters"));
                    File.WriteAllText(Path.Combine(fx, "Plugins", "AimForge Game Filters", "AimForge.Filters.dll"), "");
                    string fxSettings = "{\"Profiles\":[{\"RelativeModeSettings\":{\"XSensitivity\":90,\"YSensitivity\":90,\"RelativeResetDelay\":\"00:00:00.0800000\"},\"Bindings\":{\"TipActivationThreshold\":1}," +
                        "\"Filters\":[{\"Path\":\"CoherenceStabilizer.CoherenceStabilizerTabletSpace\",\"Enable\":true,\"Settings\":[{\"Property\":\"LeadMs\",\"Value\":6},{\"Property\":\"HoldTimeMs\",\"Value\":0}]}," +
                        "{\"Path\":\"AimForge.Filters.NibTwin\",\"Enable\":true,\"Settings\":[{\"Property\":\"Twin\",\"Value\":1},{\"Property\":\"SkidXmm\",\"Value\":-0.24},{\"Property\":\"SkidYmm\",\"Value\":0.18},{\"Property\":\"SkidFullPressure\",\"Value\":0.3},{\"Property\":\"SkidGamma\",\"Value\":1},{\"Property\":\"SkidLagReports\",\"Value\":0},{\"Property\":\"Probe\",\"Value\":1}]}]}]}";
                    File.WriteAllText(Path.Combine(fx, "settings.json"), fxSettings);
                    var otdF = new Core.OtdBridge(fx, fx);
                    var rmp = FilterPlan.Fold(cat.Find("rivpl")!, new FilterPlan.Toggles(true, false, 120, 1.0, 25, 0.45));   // the Tap Anchor switched on (no family card ships it since the GOAT)
                    var rgT = Rig.From(rmp); rgT.NibTwin = true; rgT.SkidXmm = -0.24; rgT.SkidYmm = 0.18; rgT.SkidFullPressure = 0.3;
                    otdF.Apply(rmp, rgT, true, _ => { });
                    var fl2 = otdF.LastPlanned?["Profiles"]?[0]?["Filters"]?.AsArray();
                    var firstOn = fl2?.FirstOrDefault(f => f!["Enable"]?.GetValue<bool>() == true && !f["Path"]!.GetValue<string>().Contains("Hover_Distance"));
                    var cohF = fl2?.FirstOrDefault(f => f!["Path"]!.GetValue<string>().Contains("CoherenceStabilizerTabletSpace"));
                    double? CohProp(string k) => cohF?["Settings"]?.AsArray().FirstOrDefault(s => s!["Property"]!.GetValue<string>() == k)?["Value"]?.GetValue<double>();
                    Ok("the apply's chain: Nib Twin is the first enabled aim filter, and the stabilizer entry carries TapMoveFade 1 and the card's own lead",
                       firstOn != null && firstOn["Path"]!.GetValue<string>() == Core.OtdBridge.NibTwinId && CohProp("TapMoveFade") == 1 && CohProp("LeadMs") == (rmp.cohOv?.lead ?? -1),
                       $"first: {firstOn?["Path"]}, TapMoveFade {CohProp("TapMoveFade")}, LeadMs {CohProp("LeadMs")}");
                    // the gate judges the card being written, not the entry left saved (2026-09-24 review: 18 strict cards refused)
                    var catF = Core.FilterCatalog.Discover(otdF);
                    var stF = catF.FirstOrDefault(f => f.Path.Contains("CoherenceStabilizerTabletSpace"));
                    var (gb, _) = Core.RolePolicy.GateForApply(rmp, t, () => catF, Rig.From(rmp));
                    Ok("apply gate: a saved Lead Sight stabilizer entry reads T5 in the live chain (Doctor) but does NOT refuse a strict-role card whose own overlay is T1",
                       stF != null && stF.LiveTier == "T5" && stF.Tier == "T1" && !gb.Any(b => b.Contains("Coherence Stabilizer")), string.Join("; ", gb));
                    // the press log is visible to the Doctor
                    var nl = otdF.NibLive();
                    Ok("the Nib Twin press log left on is visible (NibLive.probe), with the twin's live values", nl.probe && nl.twin && nl.vals["SkidXmm"] == -0.24);
                    // a live twin that runs an older calibration than nibtwin.json is flagged
                    string calT = Path.Combine(fx, "nibtwin.json");
                    new Core.NibCal { SkidXmm = -0.30, SkidYmm = 0.20, SkidFullPressure = 0.3, SkidGamma = 1, R2 = 0.9, Taps = 20 }.Save(calT);
                    var (stOk, stDet) = Core.Experiments.LiveCheck(Path.Combine(fx, "settings.json"), new Core.Experiments.State { Twin = true }, calT);
                    new Core.NibCal { SkidXmm = -0.24, SkidYmm = 0.18, SkidFullPressure = 0.3, SkidGamma = 1, R2 = 0.9, Taps = 20 }.Save(calT);
                    var (mOk, _) = Core.Experiments.LiveCheck(Path.Combine(fx, "settings.json"), new Core.Experiments.State { Twin = true }, calT);
                    Ok("Doctor: a live twin running an OLDER calibration than nibtwin.json fails the XP row; the matching one passes", !stOk && stDet.Contains("OLDER") && mOk, stDet);

                    // (7) the installed-plugin property check reads metadata without loading the assembly
                    string own = typeof(Core.NibCal).Assembly.Location;
                    Ok("plugin metadata check: finds a declared property, reports a missing one as absent, and a missing file as unknown",
                       Core.OtdBridge.PluginHasProperty(own, "NibCal", "SkidLagReports") == true && Core.OtdBridge.PluginHasProperty(own, "NibCal", "TapMoveFade") == false &&
                       Core.OtdBridge.PluginHasProperty(Path.Combine(fx, "nope.dll"), "X", "Y") == null, own);

                    // (8) the last-apply record carries the whole build; the calibration refuses without one
                    string laP = Path.Combine(fx, "lastapply.json");
                    var rgL = Rig.From(nb2); rgL.HdlMax = 40; rgL.ReportHz = 0; rgL.MergeMax = 12; rgL.RotationDeg = 3; rgL.Engine = "cadence";
                    Core.LastApply.From(nb2, rgL).Save(laP); var laL = Core.LastApply.Load(laP); var arL = laL?.AppliedRig();
                    Core.LastApply.NoteHover(new Rig { HdlEnabled = true, HdlMin = 2, HdlMax = 55 }, laP); var laH = Core.LastApply.Load(laP);
                    var (nc0, _, why0) = Core.NibCalibrator.LiveBuild(null);
                    var (nc1, _, why1) = Core.NibCalibrator.LiveBuild(new Core.LastApply { CardId = "bo6og", CardName = "BO6 Original", At = "old" });
                    var (nc2, nr2, _) = Core.NibCalibrator.LiveBuild(laL);
                    Ok("lastapply.json carries the whole build (card, engine, pen Hz, merge cap, rotation, hover), a live hover push updates it, and calibration refuses without it",
                       laL?.Card?.id == nb2.id && arL != null && arL.HdlMax == 40 && arL.ReportHz == 0 && arL.MergeMax == 12 && arL.RotationDeg == 3 && arL.CadenceEngine &&
                       laH!.HdlMax == 55 && laH.AppliedRig()!.HdlMax == 55 && laH.AppliedRig()!.HdlMin == 2 &&
                       nc0 == null && why0 != null && nc1 == null && why1!.Contains("predates") && nc2?.id == nb2.id && nr2?.MergeMax == 12,
                       $"{why0} | {why1}");
                    try { Directory.Delete(fx, true); } catch { }
                }
                // ---- 2026-09-25, second review: stalls, merged frames, harder fits, per-direction moving taps ----
                {
                    double S3(double a, double b, double x) { if (x <= a) return 0; if (x >= b) return 1; double u = (x - a) / (b - a); return u * u * (3 - 2 * u); }
                    double Pt(double e) => e < 0 ? 0 : e < 12 ? 0.35 * S3(0, 12, e) : e < 52 ? 0.35 : e < 70 ? 0.35 * (1 - S3(52, 70, e)) : 0;
                    // a still hand, a tap starting at 200 ms, reports every D ms except where `skip` says; the end error vs the hand
                    double EndErr(int lag, Func<double, bool> skip)
                    {
                        var tw = new Filters.NibTwinCore { Twin = 1, SkidXmm = -0.24, SkidYmm = 0.18, SkidFullPressure = 0.3, SkidLagReports = lag };
                        double last = 0; System.Numerics.Vector2 o0 = default, o = default; bool first = true;
                        for (int k = 0; k * D < 600; k++)
                        {
                            double tk = k * D; if (!first && skip(tk - 200)) continue;
                            double h = Math.Min(1.0, Pt(tk - 200 - lag * D) / 0.3);
                            o = tw.Filter(V2(50 - 0.24 * h, 50 + 0.18 * h), first ? D : tk - last, Pt(tk - 200));
                            if (first) { o0 = o; first = false; }
                            last = tk;
                        }
                        return (o - o0).Length();
                    }
                    double stall = 0, merge = 0;
                    foreach (int L in new[] { 0, 1, 2 })
                    {
                        foreach (double at in new[] { -20.0, 5.0, 30.0, 45.0, 55.0, 62.0 })
                            foreach (double len in new[] { 55.0, 70.0 })
                                stall = Math.Max(stall, EndErr(L, e => e >= at && e < at + len));
                        foreach (double at in new[] { 2.0, 6.0, 53.0, 58.0, 63.0 })
                            merge = Math.Max(merge, EndErr(L, e => e >= at && e < at + 5 * D));   // one 6-report merged frame
                    }
                    Ok("Nib Twin: a 55-70 ms stall on the press or release ramp, or a merged 6-report frame, leaves the camera on the hand (lag 0-2)",
                       stall <= 0.01 && merge <= 0.01, $"worst end error: stall {stall:0.000} mm, merge {merge:0.000} mm");
                    // the merge detector must not learn a short interval from the back-to-back reports of a queued stall, and a
                    // single late report is not a merge (third review: the lag was lost for the session)
                    double latch = 0;
                    foreach (int L in new[] { 1, 2 })
                        foreach (double hz in new[] { 0.0, 360.0 })
                        {
                            var tw = new Filters.NibTwinCore { Twin = 1, SkidXmm = -0.24, SkidYmm = 0.18, SkidFullPressure = 0.3, SkidLagReports = L, NominalHz = hz };
                            int k = 0; var still = V2(50, 50);
                            for (; k < 360; k++) tw.Filter(still, D, 0);
                            tw.Filter(still, 16 * D, 0); for (int b = 0; b < 15; b++) tw.Filter(still, 0.02, 0);   // a queued 44 ms stall
                            for (int b = 0; b < 360; b++) tw.Filter(still, D, 0);
                            var tp = Core.NibLab.TapPressure(40, 40); System.Numerics.Vector2 o0 = default, h0 = default;
                            for (int i = 0; i < 120; i++)
                            {
                                var hand = V2(50 + 100.0 * i / 360.0, 50); double h = Math.Min(1.0, tp(i - L) / 0.3);
                                var o = tw.Filter(hand + V2(-0.24 * h, 0.18 * h), i == 43 ? 1.65 * D : D, tp(i));   // one late report mid-press
                                if (i == 0) { o0 = o; h0 = hand; }
                                if (tp(i) > 0) latch = Math.Max(latch, ((o - o0) - (hand - h0)).Length());
                            }
                        }
                    Ok("Nib Twin: after a queued stall's back-to-back burst, and across a late report, a moving tap is still removed at the calibrated lag (pen Hz pinned or learned)",
                       latch <= 0.03, $"worst mid-tap error {latch:0.000} mm");

                    var wob = Core.NibFit.Fit(Core.NibLab.ModelLog(20, 0.30, 143.1, 23, peakLo: 0.12, peakHi: 0.28, holdLo: 200, holdHi: 600, wobble: 0.0025));
                    var noSat = Core.NibFit.Fit(Core.NibLab.ModelLog(20, 0.30, 143.1, 24, peakLo: 0.2, peakHi: 0.6, satP: 0.9, holdLo: 200, holdHi: 600, wobble: 0.0025));
                    Ok("nib fit: light taps below the knee and a nib that does not saturate, both with 200-600 ms holds whose pressure wobbles, calibrate at the right angle",
                       wob.Refused == null && noSat.Refused == null && Math.Abs(wob.Cal!.AngleDeg - 143.1) <= 5 && Math.Abs(noSat.Cal!.AngleDeg - 143.1) <= 5 && wob.Cal.MagMm >= 0.22 && wob.Cal.MagMm <= 0.40,   // light taps see the swing up to their own knee (0.26 mm at 0.24)
                       $"light: {wob.Refused ?? wob.Report} | no-saturation: {noSat.Refused ?? noSat.Report}");

                    var nb3 = cat.Find("bo6og")!;
                    var tw3 = Core.NibLab.Score(nb3, new Core.NibLab.Config { Pin = true, PinFade = 1, Twin = true }, 1.0, 2);
                    var lutB = Curve.EffectiveLut(nb3, Rig.From(nb3).PxMm);
                    var over = Core.NibLab.MoveSpeeds.Select((v, m) => (v, m, floor: Core.NibLab.Resid * Core.NibLab.SkidMm * Curve.GainAt(lutB, v) * 360.0 / (nb3.cm * 10)))
                                                     .Where(x => tw3.MovePermanentWorstDir[x.m] > 1.3 * x.floor + 0.02).ToList();
                    // slow moving taps (10-25 mm/s, inside the fade band) on the shipping pin shapes: the break-budget rule must
                    // not hold them longer (measuring the break from the press position cost up to 0.35 deg here)
                    var savedSpeeds = Core.NibLab.MoveSpeeds.ToArray(); double slowWorst = 0; string slowW = "";
                    try
                    {
                        Core.NibLab.MoveSpeeds[0] = 10; Core.NibLab.MoveSpeeds[1] = 15; Core.NibLab.MoveSpeeds[2] = 20; Core.NibLab.MoveSpeeds[3] = 25;
                        foreach (var (hh, bb) in new[] { (30.0, 0.9), (45.0, 0.6), (25.0, 0.45) })
                        {
                            var sl = Core.NibLab.Score(nb3, new Core.NibLab.Config { Pin = true, PinFade = 1, TapHold = hh, TapBreak = bb }, 1, 2);
                            slowWorst = Math.Max(slowWorst, sl.MovePinCost.Max()); slowW += $" {hh}/{bb}: " + string.Join("/", sl.MovePinCost.Select(x => x.ToString("0.000")));
                        }
                    }
                    finally { for (int i = 0; i < savedSpeeds.Length; i++) Core.NibLab.MoveSpeeds[i] = savedSpeeds[i]; }
                    Ok("Tap Anchor with the fade: taps while moving slowly (10-25 mm/s) cost at most 0.2 deg on the 30/0.9, 45/0.6 and 25/0.45 pins", slowWorst <= 0.2, slowW.Trim());
                    Ok("Nib Twin on moving taps, per direction: what is left never exceeds the modelled flexion priced by the curve (the part no pressure model can know)",
                       over.Count == 0, "worst direction " + string.Join("/", tw3.MovePermanentWorstDir.Select(x => x.ToString("0.000"))) + " deg" + (over.Count > 0 ? " over the flexion floor at " + string.Join(",", over.Select(x => x.v)) : ""));
                }

                // ---- 2026-09-25, second review: the calibration transaction and the apply read-back against a fixture daemon ----
                {
                    string cx = Path.Combine(Path.GetTempPath(), "aimforge-selftest-calib");
                    string otdDir = Path.Combine(cx, "otd"), raDir = Path.Combine(cx, "ra"), stDir = Path.Combine(cx, "state");
                    var cmds = new List<string>(); System.Text.Json.Nodes.JsonObject daemon = new System.Text.Json.Nodes.JsonObject();
                    string phase = ""; int ignoreLoads = 0, failGf = 0; bool dropFade = false; string? throwOn = null; Func<string, bool> dropProp = _ => false;
                    string Disp(string path) => path.Contains("Hover_Distance") ? "Hover Distance Limiter" : path.Contains("CoherenceStabilizerTabletSpace") ? "Coherence Stabilizer (Tablet coordinates)"
                        : path.Contains("NibTwin") ? "AimForge Nib Twin (click-skid cancel, T1)" : path.Contains("CadenceLock") ? "AimForge Cadence Lock (tablet-space accel, T0)"
                        : path.EndsWith("CodMaster") ? "AimForge CoD Master (recoil rail, T1)" : path;
                    System.Text.Json.Nodes.JsonObject LoadJ(string f) => System.Text.Json.Nodes.JsonNode.Parse(File.ReadAllText(f))!.AsObject();
                    System.Text.Json.Nodes.JsonArray Fl(System.Text.Json.Nodes.JsonObject r) => r["Profiles"]![0]!["Filters"]!.AsArray();
                    // the console's real getfilters shape: Filters: 'Name: { K: v }, { K: v }', 'Name2: { ... }'
                    (bool ok, string output) Fake(string a)
                    {
                        cmds.Add(phase + ":" + a.Split(' ')[0]);
                        if (throwOn != null && phase == "cal" && a.StartsWith(throwOn)) throw new IOException("fixture: the console pipe broke");
                        if (a.StartsWith("applypreset") || a.StartsWith("loadsettings"))
                        {
                            if (ignoreLoads > 0 && phase == "restore") { ignoreLoads--; return (true, ""); }   // silently ignored, as the real one can be
                            daemon = LoadJ(a.StartsWith("applypreset") ? Path.Combine(otdDir, "Presets", "AimForge.json") : a.Substring(a.IndexOf('"') + 1).TrimEnd('"'));
                            return (true, "");
                        }
                        if (a.StartsWith("getsensitivity"))
                            return (true, "Horizontal Sensitivity: " + daemon["Profiles"]![0]!["RelativeModeSettings"]!["XSensitivity"]!.GetValue<double>().ToString(System.Globalization.CultureInfo.CurrentCulture) + "px/mm");
                        if (a.StartsWith("getfilters") && failGf > 0) { failGf--; return (false, "timeout"); }
                        if (a.StartsWith("getfilters"))
                            return (true, "Filters: " + string.Join(", ", Fl(daemon).Where(f => f!["Enable"]?.GetValue<bool>() == true).Select(f => "'" + Disp(f!["Path"]!.GetValue<string>()) + ": " +
                                string.Join(", ", (f["Settings"]?.AsArray() ?? new System.Text.Json.Nodes.JsonArray()).Where(s => !(dropFade && s!["Property"]!.GetValue<string>() == "TapMoveFade") && !dropProp(s!["Property"]!.GetValue<string>()))
                                    .Select(s => "{ " + s!["Property"]!.GetValue<string>() + ": " + s["Value"]!.ToJsonString() + " }")) + "'")));
                        if (a.StartsWith("savedefaultsettings")) { File.WriteAllText(Path.Combine(otdDir, "settings.json"), daemon.ToJsonString()); return (true, ""); }
                        return (true, "");
                    }
                    (Core.OtdBridge o, RawAccelBridge r) Fresh()
                    {
                        try { if (Directory.Exists(cx)) Directory.Delete(cx, true); } catch { }
                        Directory.CreateDirectory(Path.Combine(otdDir, "Presets")); Directory.CreateDirectory(Path.Combine(otdDir, "Plugins", "AimForge Game Filters"));
                        Directory.CreateDirectory(raDir); Directory.CreateDirectory(stDir);
                        File.WriteAllText(Path.Combine(otdDir, "Plugins", "AimForge Game Filters", "AimForge.Filters.dll"), "");
                        File.WriteAllText(Path.Combine(otdDir, "settings.json"), "{\"Profiles\":[{\"Tablet\":\"Wacom DTC-141\",\"RelativeModeSettings\":{\"XSensitivity\":90,\"YSensitivity\":90,\"RelativeResetDelay\":\"00:00:00.0800000\"},\"Bindings\":{\"TipActivationThreshold\":2},\"Filters\":[]}]}");
                        File.WriteAllText(Path.Combine(raDir, "settings.json"), RaFixture()); File.WriteAllText(Path.Combine(raDir, "writer.exe"), "stub");
                        daemon = LoadJ(Path.Combine(otdDir, "settings.json")); cmds.Clear(); phase = "setup"; ignoreLoads = 0; failGf = 0; dropFade = false; throwOn = null; dropProp = _ => false;
                        return (new Core.OtdBridge(otdDir, otdDir), new RawAccelBridge(raDir) { WriterRunner = () => 0 });
                    }
                    string laP = Path.Combine(stDir, "lastapply.json");
                    bool Setup(Core.OtdBridge o, RawAccelBridge r, Preset p, Rig rg)
                    {
                        r.Apply(p, rg, false, _ => { });
                        if (!o.Apply(p, rg, false, _ => { })) return false;
                        Core.LastApply.From(p, rg).Save(laP); cmds.Clear(); return true;
                    }
                    double? NibIn(System.Text.Json.Nodes.JsonObject root, string k) => Fl(root).FirstOrDefault(f => f!["Path"]!.GetValue<string>().Contains("NibTwin"))?["Settings"]?.AsArray()
                                                                                        .FirstOrDefault(s => s!["Property"]!.GetValue<string>() == k)?["Value"]?.GetValue<double>();
                    bool NibOnIn(System.Text.Json.Nodes.JsonObject root) => Fl(root).FirstOrDefault(f => f!["Path"]!.GetValue<string>().Contains("NibTwin"))?["Enable"]?.GetValue<bool>() == true;
                    var tapLog = Core.NibLab.ModelLog(20, 0.30, 143.1, 21);
                    Func<bool> Taps(Core.OtdBridge o) => () => { phase = "taps"; File.WriteAllLines(Core.NibCalibrator.ProbeLog(o), tapLog); return true; };
                    Action<string> CalLog(List<string> sink) => s =>
                    {
                        sink.Add(s);
                        if (s.StartsWith("nib: re-applying your build without")) phase = "restore";
                        else if (s.StartsWith("nib: re-applying your build with the Nib Twin press log")) phase = "cal";
                    };
                    Rig TwinRig(Preset p)
                    {
                        var rg = Rig.From(p); rg.Engine = "cadence"; rg.NibTwin = true;
                        new Core.NibCal { SkidXmm = -0.12, SkidYmm = 0.09, SkidFullPressure = 0.3, SkidGamma = 1, R2 = 0.9, Taps = 20 }.ApplyTo(rg);
                        return rg;
                    }
                    var cb = cat.Find("bo6og")!;
                    var prevHook = Core.OtdBridge.Hook; Core.OtdBridge.Hook = Fake;
                    try
                    {
                        // 1. the happy path, twin live: the NEW calibration reaches the daemon and the default, the log is off, the record follows
                        {
                            var (o, r) = Fresh(); bool set = Setup(o, r, cb, TwinRig(cb)); var lg = new List<string>();
                            var res = Core.NibCalibrator.Run(r, o, t, Taps(o), CalLog(lg), 100, null, null, stDir);
                            var fresh = Core.NibCal.Load(Path.Combine(stDir, "nibtwin.json")); var la1 = Core.LastApply.Load(laP); var dflt = LoadJ(o.SettingsPath);
                            var drift1 = la1?.Drift(o.SettingsPath, r.ReadLive());
                            bool calPushed = cmds.Contains("cal:applypreset") && !cmds.Contains("cal:savedefaultsettings");
                            Ok("calibration: the live twin takes the NEW calibration (daemon + default), the press log is off, the calibration build was never saved as the default, and the record matches the drivers",
                               set && res.Refused == null && res.Restored != null && fresh != null && calPushed && NibOnIn(daemon) && NibIn(daemon, "Probe") == 0 && NibIn(daemon, "Twin") == 1 &&
                               NibIn(daemon, "SkidXmm") == Math.Round(fresh.SkidXmm, 5) && NibIn(dflt, "SkidXmm") == Math.Round(fresh.SkidXmm, 5) && NibIn(dflt, "Probe") == 0 &&
                               la1?.AppliedRig()?.SkidXmm == fresh.SkidXmm && drift1 != null && drift1.Count == 0,
                               (res.Refused ?? "ok") + " | drift: " + string.Join("; ", drift1 ?? new List<string>()) + " | " + string.Join(",", cmds));
                        }
                        // 2. the daemon silently ignores the restore: reported as NOT restored, the log turned off anyway, the record untouched
                        {
                            var (o, r) = Fresh(); Setup(o, r, cb, TwinRig(cb)); string laBefore = File.ReadAllText(laP); var lg = new List<string>();
                            ignoreLoads = 2;
                            var res = Core.NibCalibrator.Run(r, o, t, Taps(o), CalLog(lg), 100, null, null, stDir);
                            var fresh = Core.NibCal.Load(Path.Combine(stDir, "nibtwin.json"));
                            Ok("calibration: a restore the daemon ignores is reported as NOT re-applied; the press log is switched off with your twin on (new calibration) and the record is left alone",
                               res.Refused != null && res.Refused.Contains("NOT re-applied") && res.Restored == null && fresh != null && NibIn(daemon, "Probe") == 0 && NibIn(daemon, "Twin") == 1 &&
                               NibIn(daemon, "SkidXmm") == Math.Round(fresh.SkidXmm, 5) && NibIn(LoadJ(o.SettingsPath), "Probe") == 0 && File.ReadAllText(laP) == laBefore,
                               (res.Refused ?? "(no refusal)") + " | " + string.Join(",", cmds));
                        }
                        // 2b. only the restore's applypreset is ignored (px/mm unchanged): the chain read-back's loadsettings fallback carries it
                        {
                            var (o, r) = Fresh(); Setup(o, r, cb, TwinRig(cb)); ignoreLoads = 1; var lg = new List<string>();
                            var res = Core.NibCalibrator.Run(r, o, t, Taps(o), CalLog(lg), 100, null, null, stDir);
                            Ok("apply: an applypreset ignored with the px/mm unchanged is caught by the chain read-back, and the loadsettings fallback carries the build",
                               res.Refused == null && res.Restored != null && cmds.Contains("restore:loadsettings") && NibIn(daemon, "Probe") == 0 && NibIn(daemon, "Twin") == 1,
                               (res.Refused ?? "ok") + " | " + string.Join(",", cmds.Where(c => c.StartsWith("restore"))));
                        }
                        // 3. the OTD half throws mid-apply: both drivers go back to exactly what was live
                        {
                            var (o, r) = Fresh(); Setup(o, r, cb, TwinRig(cb)); string raBefore = File.ReadAllText(Path.Combine(raDir, "settings.json")); string? presetBefore = o.ReadPresetText();
                            throwOn = "getsensitivity"; var lg = new List<string>(); bool threw = false;
                            try { Core.NibCalibrator.Run(r, o, t, Taps(o), CalLog(lg), 100, null, null, stDir); } catch { threw = true; }
                            Ok("calibration: when the OTD half throws, RawAccel is restored and the previous preset is back in the daemon (twin on, log off)",
                               threw && File.ReadAllText(Path.Combine(raDir, "settings.json")) == raBefore && o.ReadPresetText() == presetBefore && NibIn(daemon, "Probe") == 0 && NibIn(daemon, "Twin") == 1,
                               string.Join(",", cmds));
                        }
                        // 4. the shared gate refuses (an empty hover window on record): nothing is written
                        {
                            var (o, r) = Fresh(); var rg = Rig.From(cb); rg.HdlMin = 5; rg.HdlMax = 1; Setup(o, r, cb, rg);
                            string raBefore = File.ReadAllText(Path.Combine(raDir, "settings.json"));
                            var res = Core.NibCalibrator.Run(r, o, t, Taps(o), _ => { }, 100, null, null, stDir);
                            Ok("calibration: the shared apply gate runs first - a refused build writes nothing to either driver",
                               res.Refused != null && res.Refused.Contains("refused") && !cmds.Any(c => c.Contains("applypreset")) && File.ReadAllText(Path.Combine(raDir, "settings.json")) == raBefore, res.Refused ?? "");
                        }
                        // 5. the drivers drifted from the record: refused before anything is written
                        {
                            var (o, r) = Fresh(); Setup(o, r, cb, Rig.From(cb));
                            var sj = LoadJ(o.SettingsPath); sj["Profiles"]![0]!["RelativeModeSettings"]!["XSensitivity"] = 70; File.WriteAllText(o.SettingsPath, sj.ToJsonString());
                            var res = Core.NibCalibrator.Run(r, o, t, Taps(o), _ => { }, 100, null, null, stDir);
                            Ok("calibration: a record the drivers no longer carry is refused (it would be put back silently)",
                               res.Refused != null && res.Refused.Contains("no longer carry") && !cmds.Any(c => c.Contains("applypreset")), res.Refused ?? "");
                        }
                        // 6. the mouse mirror: a verified '--mouse on' after the apply survives the calibration (the record follows it);
                        //    Builds-tab mouse edits that were never applied are NOT applied by it; a switch the record missed refuses
                        {
                            var (o, r) = Fresh(); Setup(o, r, cb, Rig.From(cb));
                            var want = new Core.MouseMirror.State { On = true, Prefixes = Core.MouseMirror.DiscoverPrefixes(r.ReadRoot()) };
                            var mr = Rig.From(cb); want.ApplyTo(mr); r.MirrorOn(cb, mr, _ => { }); Core.LastApply.NoteMouse(want, laP);
                            var res = Core.NibCalibrator.Run(r, o, t, Taps(o), _ => { }, 100, null, null, stDir);
                            bool onKept = res.Refused == null && Core.MouseMirror.Read(r.ReadRoot()).Exists && res.Restored?.MirrorMouse == true;

                            var (o2, r2) = Fresh(); var rgm = Rig.From(cb); want.ApplyTo(rgm); Setup(o2, r2, cb, rgm);
                            new Core.MouseMirror.State { On = false, Dpi = 800 }.Save(Path.Combine(stDir, "mouse.txt"));   // pending, never applied
                            var res2 = Core.NibCalibrator.Run(r2, o2, t, Taps(o2), _ => { }, 100, null, null, stDir);
                            bool pendingIgnored = res2.Refused == null && Core.MouseMirror.Read(r2.ReadRoot()).Exists && res2.Restored?.MirrorMouse == true && res2.Restored.MouseDpi == rgm.MouseDpi;

                            var (o3, r3) = Fresh(); Setup(o3, r3, cb, Rig.From(cb)); var mr3 = Rig.From(cb); want.ApplyTo(mr3); r3.MirrorOn(cb, mr3, _ => { });   // no NoteMouse
                            var res3 = Core.NibCalibrator.Run(r3, o3, t, Taps(o3), _ => { }, 100, null, null, stDir);
                            Ok("calibration and the mouse mirror: a verified --mouse on survives it, pending Builds-tab mouse edits are not applied by it, and a mirror the record missed refuses it",
                               onKept && pendingIgnored && res3.Refused != null && res3.Refused.Contains("mouse mirror"), $"{res.Refused ?? "ok"} | {res2.Refused ?? "ok"} | {res3.Refused}");
                        }
                        // 6b. a RawAccel curve restored from a backup after the apply: the Doctor's drift sees it and the calibration refuses
                        {
                            var (o, r) = Fresh(); Setup(o, r, cb, Rig.From(cb));
                            var rj = System.Text.Json.Nodes.JsonNode.Parse(File.ReadAllText(Path.Combine(raDir, "settings.json")))!.AsObject();
                            rj["profiles"]![0]!["Whole or horizontal accel parameters"]!["acceleration"] = 0.2; File.WriteAllText(Path.Combine(raDir, "settings.json"), rj.ToJsonString());
                            var d6 = Core.LastApply.Load(laP)!.Drift(o.SettingsPath, r.ReadLive(), r.ReadRoot());
                            var res = Core.NibCalibrator.Run(r, o, t, Taps(o), _ => { }, 100, null, null, stDir);
                            Ok("drift: a different RawAccel curve than the last apply is named, and the calibration refuses to put the record back over it",
                               d6.Any(x => x.Contains("RawAccel curve")) && res.Refused != null && res.Refused.Contains("no longer carry"), string.Join("; ", d6));
                        }
                        // 7. an installed stabilizer without TapMoveFade: the apply says so and does not count the echo as verified
                        {
                            var (o, r) = Fresh();
                            Directory.CreateDirectory(Path.GetDirectoryName(o.StabilizerDll)!); File.Copy(typeof(Core.NibCal).Assembly.Location, o.StabilizerDll, true);
                            dropFade = true; var rm = FilterPlan.Fold(cat.Find("rivpl")!, new FilterPlan.Toggles(true, false, 120, 1.0, 25, 0.45)); var lg = new List<string>();
                            bool ok7 = o.Apply(rm, Rig.From(rm), false, lg.Add);
                            Ok("apply: an installed stabilizer that lacks TapMoveFade is named, and the property is not required in the read-back",
                               ok7 && o.StabilizerHasMoveFade() == false && lg.Any(l => l.Contains("predates the moving-tap fade")) && lg.Any(l => l.Contains("filter plan VERIFIED")), string.Join(" | ", lg.Where(l => l.Contains("TapMoveFade") || l.Contains("MISMATCH"))));
                        }
                        // 8. read-back keys are scoped to their own filter (Cadence Lock's Probe 0 must not verify the Nib Twin's)
                        {
                            string gfx = "Filters: 'AimForge Nib Twin (click-skid cancel, T1): { Twin: 0 }, { Probe: 1 }', 'AimForge Cadence Lock (tablet-space accel, T0): { NominalHz: 360 }, { Probe: 0 }'";
                            Ok("read-back: a key is read inside its own filter's block",
                               !Core.OtdBridge.ReadBackMatches(Core.OtdBridge.FilterBlock(gfx, "Nib Twin"), "Probe", 0) && Core.OtdBridge.ReadBackMatches(Core.OtdBridge.FilterBlock(gfx, "Cadence Lock"), "Probe", 0) &&
                               Core.OtdBridge.FilterBlock(gfx, "Coherence Stabilizer") == "");
                        }
                        // ---- 2026-10-11: the in-window calibration - live progress, and the twin turned on when the user opted in ----
                        {
                            var full = Core.NibLab.ModelLog(20, 0.30, 143.1, 21); var fit = Core.NibFit.Fit(full, 100);
                            var half = full.Take(full.FindIndex(1, l => l.StartsWith("#press")) is int i1 && i1 > 0 ? full.Select((l, i) => (l, i)).Where(x => x.l.StartsWith("#press")).Skip(8).First().i : full.Count).ToList();
                            var pg = Core.NibFit.Progress(full, 100); var ph = Core.NibFit.Progress(half, 100);
                            Ok("nib calibration progress: the live counter uses the fit's own settled rule (20 taps -> the fit's count; a half-done log counts 8)",
                               pg.presses == fit.Presses && pg.settled == fit.Settled && ph.presses == 8 && ph.settled <= 8 && Core.NibFit.Progress(Array.Empty<string>()).presses == 0,
                               $"full {pg.presses}/{pg.settled} (fit {fit.Presses}/{fit.Settled}), half {ph.presses}/{ph.settled}");
                        }
                        {
                            var (o, r) = Fresh(); var plain = Rig.From(cb); Setup(o, r, cb, plain);
                            var res = Core.NibCalibrator.Run(r, o, t, Taps(o), _ => { }, 100, null, null, stDir, enableTwin: true);
                            var la2 = Core.LastApply.Load(laP); var fresh = Core.NibCal.Load(Path.Combine(stDir, "nibtwin.json"));
                            Ok("nib calibration, twin opted in: a good fit re-applies the build with the Nib Twin ON at the new calibration, verified, and the record says so",
                               res.Refused == null && res.Restored?.NibTwin == true && NibOnIn(daemon) && NibIn(daemon, "Twin") == 1 && NibIn(daemon, "Probe") == 0 &&
                               fresh != null && NibIn(daemon, "SkidXmm") == Math.Round(fresh.SkidXmm, 5) && la2?.AppliedRig()?.NibTwin == true,
                               res.Refused ?? "ok");
                        }
                        {
                            var (o, r) = Fresh(); var plain = Rig.From(cb); Setup(o, r, cb, plain); string laBefore = File.ReadAllText(laP);
                            Func<bool> fewTaps = () => { phase = "taps"; File.WriteAllLines(Core.NibCalibrator.ProbeLog(o), Core.NibLab.ModelLog(5, 0.30, 143.1, 21)); return true; };
                            var res = Core.NibCalibrator.Run(r, o, t, fewTaps, _ => { }, 100, null, null, stDir, enableTwin: true);
                            Ok("nib calibration, twin opted in but the fit is refused (5 taps): the build goes back exactly as it was - twin off, press log off",
                               res.Refused != null && res.Refused.Contains("settled taps") && !NibOnIn(daemon) && NibIn(daemon, "Twin") != 1 && Core.LastApply.Load(laP)?.AppliedRig()?.NibTwin == false,
                               res.Refused ?? "(no refusal)");
                        }
                        // ---- 2026-10-11: every OTD failure rolls back, and the daemon is left on the build before ----
                        string PxIn(System.Text.Json.Nodes.JsonObject root) => root["Profiles"]![0]!["RelativeModeSettings"]!["XSensitivity"]!.ToJsonString();
                        // 9. the chain cannot be read (getfilters fails twice): the engine is unverified, so it rolls back and nothing becomes the default
                        {
                            var (o, r) = Fresh(); var rc = Rig.From(cb); rc.Engine = "cadence"; Setup(o, r, cb, Rig.From(cb));
                            string dflt = File.ReadAllText(o.SettingsPath); string? prevP = o.ReadPresetText(); failGf = 2; var lg = new List<string>();
                            bool ok9 = o.Apply(cb, rc, false, lg.Add);
                            Ok("apply: an unreadable filter chain is a failed apply - rolled back to the previous preset, never saved as the default, and the reason is reported",
                               !ok9 && File.ReadAllText(o.SettingsPath) == dflt && o.ReadPresetText() == prevP && !cmds.Contains("setup:savedefaultsettings") &&
                               o.LastFailure != null && o.LastFailure.Contains("unavailable") && !Fl(daemon).Any(f => f!["Path"]!.GetValue<string>().Contains("CadenceLock") && f["Enable"]?.GetValue<bool>() == true),
                               (o.LastFailure ?? "(no failure)") + " | " + string.Join(",", cmds));
                        }
                        // 10. one transient getfilters failure is retried and the apply verifies
                        {
                            var (o, r) = Fresh(); failGf = 1; var lg = new List<string>();
                            bool ok10 = o.Apply(cb, Rig.From(cb), false, lg.Add);
                            Ok("apply: a single getfilters timeout is retried once and the apply still verifies", ok10 && o.LastFailure == null && lg.Any(l => l.Contains("VERIFIED by read-back")), string.Join(",", cmds));
                        }
                        // 11. a stabilizer property the daemon does not carry (TapAnchor was written but never read back before): rolled back, not a partial apply
                        {
                            var (o, r) = Fresh(); var rm = FilterPlan.Fold(cat.Find("rivpl")!, new FilterPlan.Toggles(true, false, 120, 1.0, 25, 0.45)); dropProp = k => k == "TapAnchor"; var lg = new List<string>();
                            bool ok11 = o.Apply(rm, Rig.From(rm), false, lg.Add);
                            Ok("apply: a stabilizer read-back mismatch (TapAnchor) rolls back instead of saving a partial apply as the default",
                               !ok11 && !cmds.Contains("setup:savedefaultsettings") && o.LastFailure != null && o.LastFailure.Contains("TapAnchor"), o.LastFailure ?? "(no failure)");
                        }
                        // 12. no previous AimForge preset: the failed chain is replaced by the daemon's saved default (it used to stay live)
                        {
                            var (o, r) = Fresh(); var rm = FilterPlan.Fold(cat.Find("rivpl")!, new FilterPlan.Toggles(true, false, 120, 1.0, 25, 0.45)); dropProp = k => k == "TapAnchor"; var lg = new List<string>();
                            bool ok12 = o.Apply(rm, Rig.From(rm), false, lg.Add);
                            Ok("rollback with no previous preset: the daemon is reloaded from its saved default, not left on the failed chain",
                               !ok12 && o.ReadPresetText() == null && PxIn(daemon) == "90" && !Fl(daemon).Any() && lg.Any(l => l.Contains("daemon's saved default")),
                               string.Join(" | ", lg.Where(l => l.Contains("rolled back"))));
                        }
                        // 13. an older Game Filters build without native classic keys runs the fallback table: noted, not a mismatch
                        {
                            var (o, r) = Fresh(); var rc = Rig.From(cb); rc.Engine = "cadence"; dropProp = k => k.StartsWith("Classic"); var lg = new List<string>();
                            bool ok13 = o.Apply(cb, rc, false, lg.Add);
                            Ok("apply: an older Cadence Lock without classic keys verifies on its fallback table (noted, not rolled back)",
                               ok13 && lg.Any(l => l.Contains("8-point fallback table")) && o.LastFailure == null, o.LastFailure ?? "ok");
                        }
                        // 14. the stabilizer write and read-back share one property list
                        {
                            var rm = FilterPlan.Fold(cat.Find("rivpl")!, new FilterPlan.Toggles(true, false, 120, 1.0, 25, 0.45)); var (o, r) = Fresh(); o.Apply(rm, Rig.From(rm), true, _ => { });
                            var stab = Fl(o.LastPlanned!).First(f => f!["Path"]!.GetValue<string>().Contains("CoherenceStabilizer"))!["Settings"]!.AsArray().Select(x => x!["Property"]!.GetValue<string>()).ToHashSet();
                            Ok("read-back covers every stabilizer property the apply writes", Core.OtdBridge.StabilizerPlan(rm.cohOv!).All(k => stab.Contains(k.key)) && stab.All(k => Core.OtdBridge.StabilizerPlan(rm.cohOv!).Any(x => x.key == k)),
                               string.Join(",", stab.Except(Core.OtdBridge.StabilizerPlan(rm.cohOv!).Select(x => x.key))));
                        }
                    }
                    finally { Core.OtdBridge.Hook = prevHook; try { Directory.Delete(cx, true); } catch { } }
                }
            }

            // ---- 2026-09-27: third-person match (THIRD_PERSON.md) ----
            {
                var tRiv = cat.Find("rivmp")!; var tApex = cat.Find("apxmp")!;
                double k = Core.ThirdPerson.Factor(2.5, 12);
                var on = new Core.ThirdPerson.State { On = true, FightM = 12 }; var off = new Core.ThirdPerson.State { On = false };
                var r1 = Rig.From(tRiv); double baseM = r1.Mult;
                Core.ThirdPerson.ApplyTo(r1, tRiv, on); double once = r1.Mult;
                Core.ThirdPerson.ApplyTo(r1, tRiv, on); double twice = r1.Mult;          // replaying an applied rig never compounds
                Core.ThirdPerson.ApplyTo(r1, tRiv, off); double offM = r1.Mult;
                var r2 = Rig.From(tApex); Core.ThirdPerson.ApplyTo(r2, tApex, on);
                var r3 = Rig.From(tRiv); Core.ThirdPerson.ApplyTo(r3, tRiv, on); Core.ThirdPerson.Strip(r3);
                Ok("third-person match: k = (D+L)/D (2.5 m arm, 12 m -> 1.208), idempotent, off restores the card, first-person cards untouched, Strip recovers the card",
                   Math.Abs(k - 14.5 / 12) < 1e-12 && Math.Abs(once - baseM * k) < 1e-12 && once == twice && Math.Abs(offM - baseM) < 1e-12 && r2.Mult == Rig.From(tApex).Mult && r2.TpsGain == 1
                   && Math.Abs(r3.Mult - baseM) < 1e-12 && r3.TpsGain == 1 && Core.ThirdPerson.IsThirdPerson(tRiv) && !Core.ThirdPerson.IsThirdPerson(tApex),
                   $"k {k:0.0000}");
                // the geometry: an orbit camera moves a target at D by theta*D/(D+L) on screen (exact law-of-sines check at small angles)
                double L = 2.5, D = 5, th = 0.002; double seen = th - Math.Atan2(L * Math.Sin(th), D + L * Math.Cos(th));
                Ok("third-person match: the orbit-camera geometry it rests on (on-screen shift = theta*D/(D+L)); matched distance feels exactly like an FPS",
                   Math.Abs(seen / th - D / (D + L)) < 1e-4 && Math.Abs(Core.ThirdPerson.FeelVsFps(k, 2.5, 12) - 1) < 1e-12 && Core.ThirdPerson.FeelVsFps(k, 2.5, 5) < Core.ThirdPerson.FeelVsFps(1, 2.5, 5),
                   $"seen/turn {seen / th:0.0000} vs {D / (D + L):0.0000}");
                string tp = Path.Combine(Path.GetTempPath(), "aimforge-selftest-tps.txt");
                on.Save(tp); var ld = Core.ThirdPerson.State.Load(tp); File.WriteAllText(tp, "on;NaN;900"); var bad = Core.ThirdPerson.State.Load(tp); File.Delete(tp);
                var la = Core.LastApply.From(tRiv, once > 0 ? new Func<Rig>(() => { var x = Rig.From(tRiv); Core.ThirdPerson.ApplyTo(x, tRiv, on); return x; })() : r1);
                Ok("tps.txt round-trips and clamps bad values; the applied factor is recorded with the build (lastapply.json)",
                   ld.On && ld.ArmFor(tRiv) == 2.5 && ld.FightM == 12 && bad.ArmFor(tRiv) == Core.ThirdPerson.DefaultCameraM && bad.FightM == Core.ThirdPerson.DefaultFightM
                   && Math.Abs((la.AppliedRig()?.TpsGain ?? 0) - k) < 1e-12);

                // ---- 2026-10-11: third person is a GAME property from the tuner, the arm is per game, distances have names ----
                var thirdIds = cat.presets.Where(Core.ThirdPerson.IsThirdPerson).Select(x => x.id).ToList();
                var tpGames = cat.games.Where(g => g.thirdPerson).Select(g => g.id).OrderBy(x => x).ToList();
                Ok("third person comes from the GAMES table (Marvel Rivals, Deadlock): every Rivals/Deadlock card and character card is matched, no other card is, and every roster card names its game",
                   tpGames.SequenceEqual(new[] { "deadlock", "rivals" }) && thirdIds.All(id => cat.Find(id)!.game is "rivals" or "deadlock") &&
                   cat.presets.Where(x => x.group.Contains("Marvel Rivals") || x.group == "Deadlock").All(Core.ThirdPerson.IsThirdPerson) &&
                   cat.presets.Where(x => !x.group.StartsWith("Reference")).All(x => x.game != null),
                   $"{thirdIds.Count} third-person cards");
                var tDl = cat.Find("dlmp")!; var per = new Core.ThirdPerson.State { On = true, FightM = 12 }; per.SetArm(tDl, 3.5);
                per.Save(tp); var perL = Core.ThirdPerson.State.Load(tp);
                File.WriteAllText(tp, "on;3.2;12"); var legacy = Core.ThirdPerson.State.Load(tp); File.Delete(tp);
                Ok("third-person arm is per game: a Deadlock arm leaves Marvel Rivals on its roster estimate, round-trips through tps.txt, and an old global arm migrates to both games",
                   perL.ArmFor(tDl) == 3.5 && perL.ArmFor(tRiv) == 2.5 && Math.Abs(perL.KFor(tDl) - 15.5 / 12) < 1e-12 && Math.Abs(perL.KFor(tRiv) - 14.5 / 12) < 1e-12 &&
                   legacy.ArmFor(tDl) == 3.2 && legacy.ArmFor(tRiv) == 3.2);
                var dive = new Core.ThirdPerson.State { On = true, FightM = 9 };
                Ok("third-person distance presets: dive 9 / mid 12 / poke 18 m; the readout names the preset and marks the arm as an estimate",
                   Core.ThirdPerson.DistancePresets.Select(d => d.m).SequenceEqual(new[] { 9.0, 12, 18 }) && dive.PresetName == "dive" && new Core.ThirdPerson.State { FightM = 13 }.PresetName == null &&
                   Core.ThirdPerson.Describe(dive, tRiv).Contains("matched at 9 m - dive") && Core.ThirdPerson.Describe(dive, tRiv).Contains("est."),
                   Core.ThirdPerson.Describe(dive, tRiv));
            }

            // ---- 2026-09-27: a mode that cannot run is skipped with a note, never a silent refusal of the whole apply ----
            {
                var sc = cat.Find("rivmp")!; string cp = Core.NibCal.DefaultPath; bool had = File.Exists(cp); string? keep = had ? File.ReadAllText(cp) : null;
                try
                {
                    if (had) File.Delete(cp);
                    var r = Rig.From(sc); r.NibTwin = true; r.IntentSpeed = true; r.ReversalCarryMs = 40;   // RawAccel engine, no calibration, Master card
                    var notes = Core.Experiments.Soften(r, sc);
                    var rc = Rig.From(sc); rc.Engine = "cadence"; rc.IntentSpeed = true; var n2 = Core.Experiments.Soften(rc, sc);
                    Ok("experimental modes that cannot run are skipped with a note (Nib Twin uncalibrated, Intent/Carry off Cadence, Carry on a Master card) and the gate then passes; a valid mode is kept",
                       !r.NibTwin && !r.IntentSpeed && r.ReversalCarryMs == 0 && notes.Count == 3 && Core.Experiments.Blocker(r, sc) == null && rc.IntentSpeed && n2.Count == 0, string.Join(" | ", notes));
                }
                finally { try { if (had) File.WriteAllText(cp, keep!); } catch { } }
            }

            // ---- 2026-09-16: the copy contract - a card may only quote its OWN recomputed numbers ----
            {
                var names = cat.presets.Select(p => p.name).ToArray();
                var claims = cat.presets.Select(p => (p, c: Core.CopyContract.Claims(p, names, t))).ToList();
                var bad = claims.SelectMany(x => x.c.Where(c => !c.Ok).Select(c => $"{x.p.id} {c.Rule} {c.Quoted}->{(c.Actual is double a ? a.ToString("0.##") : "none")}")).ToList();
                int checkedClaims = claims.Sum(x => x.c.Count(c => !c.Comparative));
                Ok("copy contract: every 180 / spread / micro / onset / tracking / cap-speed number a card quotes about itself equals its recomputed math",
                   bad.Count == 0 && checkedClaims >= 60, bad.Count == 0 ? $"{checkedClaims} claims across {cat.presets.Count} cards" : string.Join(", ", bad.Take(25)) + (bad.Count > 25 ? $" (+{bad.Count - 25})" : ""));
                var probe = cat.Find("breakpoint")!;
                var forged = new Preset { id = probe.id, name = probe.name, group = probe.group, pxmm = probe.pxmm, cm = probe.cm, adv = probe.adv, desc = "180 in 58.4 mm." };
                Ok("copy contract has teeth: a Breakpoint copy quoting the baseline's 58.4 mm 180 is caught",
                   Core.CopyContract.Violations(forged, names, t).Count == 1);
                var tbk = cat.Find("rivtb")!;
                var forgedTb = new Preset { id = tbk.id, name = tbk.name, group = tbk.group, pxmm = tbk.pxmm, cm = tbk.cm, snap = tbk.snap, adv = tbk.adv,
                    desc = "Hotter mid-track gain than Tracker/Brawl/Precision and committed flick spread " +
                           Measure.FlickSpreadPct(Curve.EffectiveLut(tbk, tbk.pxmm), Rig.From(tbk), t, 90, 120, 150).ToString("0.0", System.Globalization.CultureInfo.InvariantCulture) + "%. Costs 99.0mm for a 180. Micro-aim 60%. Dead time 9.6 ms. Committed flick spread 34.2% (" +
                           Measure.FlickSpreadPct(Curve.EffectiveLut(tbk, tbk.pxmm), Rig.From(tbk), t).ToString("0.0", System.Globalization.CultureInfo.InvariantCulture) + "% on lazy/hesitant flicks)." };
                var tbViol = Core.CopyContract.Violations(forgedTb, names, t);
                Ok("copy contract has teeth: a claim sharing a sentence with other card names is still the card's own; 'costs .. for a 180', 'Micro-aim', 'dead time' and a lazy/committed pair are all read",
                   tbViol.Count == 4 && tbViol.Count(v => v.StartsWith("spread:")) == 1 && !tbViol.Any(v => v.StartsWith("spreadLazy")), string.Join("; ", tbViol));
                var lk = cat.Find("rivloki")!;
                Preset Syn(string text) => new Preset { id = lk.id, name = lk.name, group = lk.group, pxmm = lk.pxmm, cm = lk.cm, snap = lk.snap, adv = lk.adv, desc = text };
                Ok("copy contract never mistakes a comparison or context for a self-claim: a name at the very start, a subject after the number, 'tracking at 30 mm/s' near a cap, a lazy spread after a committed one",
                   Core.CopyContract.Violations(Syn("Turbo 180 in 99.0 mm is the fast one."), names, t).Count == 0 &&
                   Core.CopyContract.Violations(Syn("It no longer matches the 58.4 mm 180 of the BO6 Original."), names, t).Count == 0 &&
                   Core.CopyContract.Violations(Syn("Classic curve, cap 3x, tracking at 30 mm/s reads 1.00x."), names, t).Count == 0 &&
                   Core.CopyContract.Violations(Syn("Hits the cap early; micro-corrections at 60 mm/s stay 1:1."), names, t).Count == 0);
                // Cadence Lock advice on the character cards follows the aim-band measurement (2026-09-16 review)
                var goatC = cat.Find(Core.Goat.Id)!; var boN = Core.CadenceLab.RunAimBand(goatC, Rig.From(goatC));
                var advice = Core.HeroLab.CardIds.Values.Select(id => cat.Find(id)!)
                    .Where(cp => Core.HeroLab.NeedsCadence(cp, goatC) != cp.desc.Contains("Run it on the Cadence Lock engine"))
                    .Select(cp => cp.id).ToList();
                Ok("character cards: 'Run it on the Cadence Lock engine' appears exactly where the aim-band RawAccel noise exceeds 2x the GOAT's (or its worst report 3x) - Psylocke, Soldier: 76",
                   advice.Count == 0 && cat.Find("rivpsy")!.desc.Contains("Run it on the Cadence Lock engine"), advice.Count == 0 ? $"GOAT {boN.WallGainNoisePct:0.0}% / worst {boN.WallWorstGainErrPct:0.0}%" : string.Join(", ", advice));
            }

            // ---- 2026-10-11: A/B identity (what makes two applies a pair) - was private in the window and untested ----
            {
                var ab = cat.Find("bo6og")!; var ra0 = Rig.From(ab); var t0 = FilterPlan.Prefill(ab);
                bool Diff(Action<Rig> edit, string name) { var r1 = ra0.Clone(); edit(r1); var d = ApplyIdentity.Differences(ab, ra0, t0, ab, r1, t0); return d.Count == 1 && d[0] == name; }
                Ok("A/B identity: the same build re-applied is the same (no new A/B partner), including a 1e-15 round-trip drift",
                   ApplyIdentity.Same(ab, ra0, t0, ab, ra0.Clone(), t0) && Diff(r => r.PxMm += 1e-13, "PxMm") == false && ApplyIdentity.Same(ab, ra0, t0, ab, ((Func<Rig>)(() => { var r = ra0.Clone(); r.PxMm += 1e-13; return r; }))(), t0));
                Ok("A/B identity: the modes the old window check missed each make a pair - third-person gain, mouse mirror and its DPI, a Nib Twin recalibration",
                   Diff(r => r.TpsGain = 1.2, "TpsGain") && Diff(r => r.MirrorMouse = true, "MirrorMouse") && Diff(r => r.MouseDpi = 800, "MouseDpi") &&
                   Diff(r => r.SkidXmm = 0.1, "SkidXmm") && Diff(r => r.SkidLagReports = 2, "SkidLagReports") && Diff(r => r.MouseIdPrefixes = new[] { "HID\\VID_1" }, "MouseIdPrefixes"));
                Ok("A/B identity: engine, Intent Speed and a different card are named",
                   Diff(r => r.Engine = "cadence", "Engine") && Diff(r => r.IntentSpeed = true, "IntentSpeed") &&
                   ApplyIdentity.Differences(ab, ra0, t0, cat.Find("rivmp")!, ra0, t0).Any(x => x.StartsWith("card bo6og -> rivmp")));
                var abLut = new Preset { id = ab.id, name = ab.name, group = ab.group, lut = new[] { new[] { 1.0, 1.0 }, new[] { 50.0, 1.5 } } };
                var abLut2 = new Preset { id = ab.id, name = ab.name, group = ab.group, lut = new[] { new[] { 1.0, 1.0 }, new[] { 50.0, 1.6 } } };
                Ok("A/B identity: an Advanced-tab curve edit under the same id is a new partner; a tap-toggle change is too",
                   ApplyIdentity.Differences(abLut, ra0, t0, abLut2, ra0, t0).Contains("curve table") &&
                   ApplyIdentity.Differences(ab, ra0, t0, ab, ra0, new FilterPlan.Toggles(!t0.Tap, t0.Hold, t0.HoldMs, t0.TapArm, t0.TapHold, t0.TapBreak)).Contains("Tap Anchor"));
            }

            // ---- 2026-10-11: the Doctor as data - severity, a fix on every failing row, the daemon asked whether plugins loaded ----
            {
                string gf = "Filters: 'Hover Distance Limiter: { Hover_max: 87 }', 'AimForge Cadence Lock (tablet-space accel, T0): { NominalHz: 360 }'";
                var nl = Doctor.NotLoaded(new[] { "Hover_Distance_Limiter.Hover_Distance_Limiter", OtdBridge.CadenceId, OtdBridge.NibTwinId, "AimForge.Filters.CodMaster" }, gf);
                Ok("doctor: an enabled first-party filter the daemon does not print is named as not loaded (Nib Twin, CoD Master); a loaded one and third-party filters are not",
                   nl.SequenceEqual(new[] { "Nib Twin", "AimForge CoD Master" }), string.Join(", ", nl));
                var c0 = new NibCal { CalibratedAt = "2026-09-01 12:00" };
                Ok("doctor: calibration age is read from the stamp; an unreadable stamp is unknown, not zero",
                   Math.Abs(Doctor.CalibrationAgeDays(c0, new DateTime(2026, 10, 11, 12, 0, 0))!.Value - 40) < 1e-9 && Doctor.CalibrationAgeDays(new NibCal { CalibratedAt = "" }, DateTime.Now) == null);
                var rows = Doctor.WithFixes(new List<Doctor.Item> {
                    new Doctor.Item { Name = "engine pairing", Ok = false }, new Doctor.Item { Name = "vmulti.sys signature", Ok = false },
                    new Doctor.Item { Name = "plugins loaded by the daemon (live chain)", Ok = false }, new Doctor.Item { Name = "live = last apply", Ok = true },
                    new Doctor.Item { Name = "nib twin calibration", Ok = true, Warn = true, Fix = "own fix" },
                    new Doctor.Item { Name = "engine pairing", Ok = false, Detail = "could not read OTD settings.json (x) - pairing UNVERIFIED" } });
                Ok("doctor: every FAIL gets its fix from the table, an OK row carries none, a row's own fix is kept, an UNVERIFIED row is told to become checkable (not to re-apply), and the level reads FAIL / WARN / OK",
                   rows.Take(3).All(r => r.Fix.Length > 0 && r.Level == "FAIL") && rows[3].Fix == "" && rows[3].Level == "OK" && rows[4].Fix == "own fix" && rows[4].Level == "WARN" &&
                   rows[0].ToString().Contains("fix: apply the card again") && !rows[3].ToString().Contains("fix:") && rows[5].Fix.StartsWith("check the driver is installed"));
            }

            // ---- 2026-10-11: 360 calibration - a measured K replaces an assumed one, through the tuner ----
            {
                var dg = cat.games.First(g => g.id == "deadlock"); var apexK = cat.games.First(g => g.id == "apex").K;
                var y = Calib360.FromYaw("deadlock", dg.K, 0.022);
                var dlb = cat.Find("dlmp")!; var drg = Rig.From(dlb); double printed = Curve.SensFor(dg.K, drg, drg.Mult);
                var t1 = Calib360.FromTurn("deadlock", dg.K, drg.Cm360 * 10, 1, printed, drg.PxMm, drg.Mult, drg.Cm360);
                var t2 = Calib360.FromTurn("deadlock", dg.K, drg.Cm360 * 10 * 2 * 1.1, 2, printed, drg.PxMm, drg.Mult, drg.Cm360);
                Ok("360 calibration: the Source yaw 0.022 gives exactly the Apex K; a turn measuring the card's own base gives back the same K; a 10% long turn gives K x1.10",
                   Math.Abs(y.NewK - apexK) < 0.05 && Math.Abs(t1.Ratio - 1) < 1e-9 && Math.Abs(t2.Ratio - 1.1) < 1e-9 && t1.Summary.Contains("assumed constant was right"),
                   $"yaw K {y.NewK:0.0} vs Apex {apexK}; {t2.Summary}");
                Ok("360 calibration: the slow sweep's bound is the card's 1:1 band (Deadlock Master: offset 2.28 at 57 px/mm = 40.0 mm/s, the GOAT's fingertip band)",
                   Math.Abs(Calib360.UnityBandMmS(dlb, 57) - 40.0) < 1e-4, Calib360.UnityBandMmS(dlb, 57).ToString("0.00"));
                string tunerPath = Path.Combine(AppContext.BaseDirectory, "tuner.html");
                if (File.Exists(tunerPath))
                {
                    string th = File.ReadAllText(tunerPath);
                    string once = Calib360.PatchTuner(th, t2, "ev-x-deadlock-k"), twice = Calib360.PatchTuner(once, t2, "ev-x-deadlock-k");
                    var diff = th.Split('\n').Zip(once.Split('\n')).Where(z => z.First != z.Second).ToList();
                    Ok("360 calibration: the tuner patch changes only the game's GAMES row (K + kMeasured/kEvidence), and re-patching replaces rather than stacks",
                       diff.Count == 1 && diff[0].Second.Contains("{id:'deadlock'") && diff[0].Second.Contains("K:" + Math.Round(t2.NewK, 1).ToString("0.0###", System.Globalization.CultureInfo.InvariantCulture) + ",") &&
                       diff[0].Second.Contains("kEvidence:'ev-x-deadlock-k'") && twice == once && th.Split('\n').Length == once.Split('\n').Length,
                       diff.Count == 1 ? diff[0].Second.Trim().Substring(0, Math.Min(120, diff[0].Second.Trim().Length)) : diff.Count + " lines changed");
                    var ev = System.Text.Json.Nodes.JsonNode.Parse(Calib360.EvidenceJson(t2, "ev-x-deadlock-k", new DateTime(2026, 10, 11), null))!;
                    Ok("360 calibration: the evidence record has the project's shape and leaves the field verdict pending",
                       ev["evidenceId"]!.GetValue<string>() == "ev-x-deadlock-k" && ev["results"]!["cm360_measured"]!.GetValue<double>() == Math.Round(drg.Cm360 * 1.1, 3) && ev["fieldVerdict"]!.GetValue<string>().StartsWith("pending"));
                }
                else Ok("360 calibration: tuner.html is next to the app for the patch test", false, tunerPath);
                Ok("cards print their sens from the game's K: every Deadlock card's in-game number equals K / (eDPI x cm) (no hard-coded copy left to go stale)",
                   cat.presets.Where(x => x.game == "deadlock").All(x => x.desc.Contains(Curve.SensFor(dg.K, Rig.From(x), Rig.From(x).Mult).ToString("0.000", System.Globalization.CultureInfo.InvariantCulture))));
            }

            // ---- 2026-10-11: what the window says about the build (BuildState) ----
            {
                var bsP = cat.Find("bo6og")!; var r0 = Rig.From(bsP); var t0 = FilterPlan.Prefill(bsP);
                var rNext = r0.Clone(); rNext.Engine = "cadence"; rNext.NibTwin = true; new NibCal { SkidXmm = 0.1, SkidYmm = 0.1, R2 = 0.9, Taps = 20 }.ApplyTo(rNext);
                var pend = BuildState.PendingChanges(bsP, r0, t0, bsP, rNext, t0);
                var rTps = r0.Clone(); rTps.TpsGain = 1.2; rTps.Mult *= 1.2;
                var rLive = r0.Clone(); rLive.MirrorMouse = true; rLive.MouseIdPrefixes = new[] { "HID\\VID_1" }; var rCompose = rLive.Clone(); rCompose.MouseIdPrefixes = Array.Empty<string>();
                Ok("build state: pending changes read in the user's words, one item per change (the five calibration fields are one 'Nib calibration'; the match folded into the multiplier is one 'third-person match')",
                   pend.SequenceEqual(new[] { "engine", "Nib Twin", "Nib calibration" }) && BuildState.PendingChanges(bsP, r0, t0, bsP, rTps, t0).SequenceEqual(new[] { "third-person match" }),
                   string.Join(", ", pend));
                Ok("build state: the same build is 'no changes', and a mouse device list that is only discovered at apply time is not a change",
                   BuildState.PendingChanges(bsP, r0, t0, bsP, r0.Clone(), t0).Count == 0 && BuildState.PendingChanges(bsP, rLive, t0, bsP, rCompose, t0).Count == 0);
                var rm = r0.Clone(); rm.Engine = "cadence"; rm.NibTwin = true; rm.ReversalCarryMs = 40; rm.TpsGain = 1.21; rm.MirrorMouse = true;
                Ok("build state: the live line names the engine and every mode that is on, and only those",
                   BuildState.Modes(rm) == "CADENCE LOCK  ·  NIB TWIN  ·  CARRY 40 MS  ·  3RD-PERSON x1.21  ·  MOUSE MIRROR" && BuildState.Modes(r0) == "RAWACCEL", BuildState.Modes(rm));
                var adv = cat.presets.Where(BuildState.CadenceRecommended).Select(x => x.id).OrderBy(x => x).ToList();
                Ok("build state: the one-click Cadence Lock offer appears on exactly the cards whose own copy recommends it (pinned to the measured noise by the character-card test)",
                   adv.Count >= 1 && adv.All(id => cat.Find(id)!.group.StartsWith("Specific Characters")), string.Join(", ", adv));
            }

            // ---- 2026-10-11: RawAccel's input-speed EMA on the pen - measured, and rejected (ev-20261011-pen-speed-ema) ----
            {
                var smoothed = new SpeedEmaLab.LinearEma(2); double v1 = 0; for (int i = 0; i < 200; i++) v1 = smoothed.Smooth(100, 1000.0 / 360);
                Ok("speed EMA port: RawAccel's linear EMA settles on a steady speed exactly and returns 0 with 0 half-life semantics kept by the caller",
                   Math.Abs(v1 - 100) < 1e-6, v1.ToString("0.000000"));
                string why = ""; bool keep = true;
                foreach (var id in new[] { "rivpsy", "owsol" })
                {
                    var cp = cat.Find(id)!; var raw = SpeedEmaLab.Run(cp, Rig.From(cp), 0); var cad = CadenceLab.RunAimBand(cp, Rig.From(cp));
                    foreach (double h in SpeedEmaLab.Sweep.Where(x => x > 0))
                    {
                        var r = SpeedEmaLab.Run(cp, Rig.From(cp), h);
                        if (r.AimNoisePct <= cad.CadenceGainNoisePct) { keep = false; why += $" {id}@{h}: noise {r.AimNoisePct:0.00} vs Cadence {cad.CadenceGainNoisePct:0.000}"; }
                        else if (r.AimWorstPct < raw.AimWorstPct * 0.9) why += $" {id}@{h}: worst {r.AimWorstPct:0.0} vs {raw.AimWorstPct:0.0} (helps RawAccel, Cadence still wins)";
                    }
                }
                Ok("speed EMA on the pen stays OFF: Cadence Lock beats it at every half-life on the steep-ramp cards (on the 2026-10-24 Psylocke card a 3-5 ms EMA does cut the RawAccel engine's worst report - printed, not hidden - but Cadence Lock removes the noise outright)", keep, why.Trim());
            }

            // ---- 2026-10-11: the tip binding under Vanguard (OTD FAQ; OTD v0.6.4.0 source: built-in bindings use SendInput) ----
            {
                System.Text.Json.Nodes.JsonObject J(string tip) => System.Text.Json.Nodes.JsonNode.Parse("{\"Profiles\":[{\"Bindings\":{\"TipActivationThreshold\":2" + tip + "}}]}")!.AsObject();
                var mouse = Doctor.TipBinding(J(",\"TipButton\":{\"Path\":\"OpenTabletDriver.Desktop.Binding.MouseBinding\",\"Settings\":[{\"Property\":\"Button\",\"Value\":\"Left\"}],\"Enable\":true}"));
                var keyB = Doctor.TipBinding(J(",\"TipButton\":{\"Path\":\"OpenTabletDriver.Desktop.Binding.KeyBinding\",\"Settings\":[{\"Property\":\"Key\",\"Value\":\"K\"}],\"Enable\":true}"));
                var vmB = Doctor.TipBinding(J(",\"TipButton\":{\"Path\":\"VoiDPlugins.OutputMode.VMultiButtonHandler\",\"Settings\":[{\"Property\":\"Button\",\"Value\":\"Left\"}],\"Enable\":true}"));
                var none = Doctor.TipBinding(J(""));
                var rM = Doctor.VanguardRow(mouse.kind, mouse.text); var rV = Doctor.VanguardRow(vmB.kind, vmB.text);
                Ok("doctor, Valorant: an OTD built-in tip binding (mouse or key - both SendInput) FAILS with the VMulti fix; a VMulti binding passes with the two Vanguard rules as a WARN; a missing binding is named",
                   mouse.kind == Doctor.TipKind.SendInputMouse && keyB.kind == Doctor.TipKind.SendInputKey && vmB.kind == Doctor.TipKind.VMulti && none.kind == Doctor.TipKind.None &&
                   rM.Level == "FAIL" && rM.Fix.Contains("VMulti") && rV.Level == "WARN" && rV.Detail.Contains("FIRST mouse") && rV.Detail.Contains("drop left clicks"),
                   $"{mouse.text} | {keyB.text} | {vmB.text} | {none.text}");
            }

            // ---- 2026-10-11: the chain lab - the RawAccel engine as the bytes flow, and Cadence Lock's drop check ----
            {
                var cPsy = cat.Find("rivpsy")!; var cBo = cat.Find("bo6og")!; var aim = ChainLab.Scenarios[2]; var flick = ChainLab.Scenarios[3];
                var w0 = ChainLab.Run(cPsy, Rig.From(cPsy), aim, ChainLab.Engine.Wall, 0); var k0 = ChainLab.Run(cPsy, Rig.From(cPsy), aim, ChainLab.Engine.Constant, 0);
                Ok("chain lab is self-consistent: with no USB jitter the wall clock and constant time read the same packets the same (aim band, no splits)",
                   Math.Abs(w0.AimErrDeg100ms - k0.AimErrDeg100ms) < 0.01 * k0.AimErrDeg100ms && w0.SplitPackets == 0, $"{w0.AimErrDeg100ms:0.0000} vs {k0.AimErrDeg100ms:0.0000}");
                var wJ = ChainLab.Run(cPsy, Rig.From(cPsy), aim, ChainLab.Engine.Wall); var cJ = ChainLab.Run(cPsy, Rig.From(cPsy), aim, ChainLab.Engine.Cadence);
                Ok("chain lab: through the real count lattice and packet clock, Psylocke's RawAccel engine tracks with >= 10x the aim error of Cadence Lock (ev-20261011-chain-lab)",
                   wJ.AimErrDeg100ms >= 10 * cJ.AimErrDeg100ms && wJ.Track.NoisePct > 8 && cJ.Track.NoisePct < 0.1, $"wall {wJ.AimErrDeg100ms:0.000} deg / {wJ.Track.NoisePct:0.0}%, cadence {cJ.AimErrDeg100ms:0.0000} deg");
                var kF = ChainLab.Run(cBo, Rig.From(cBo), flick, ChainLab.Engine.Constant); var wF = ChainLab.Run(cBo, Rig.From(cBo), flick, ChainLab.Engine.Wall);
                var kD = ChainLab.Run(cPsy, Rig.From(cPsy), aim, ChainLab.Engine.Constant, 10, 11, 40, ChainLab.Timing.Drop);
                Ok("chain lab: RawAccel 'constant time interval' stays refused for the pen - VMulti splits a >800 mm/s report and a drop doubles a report, and constant time misprices both",
                   kF.SplitPackets > 0 && kF.AimErrDeg100ms > 10 * wF.AimErrDeg100ms && kD.AimErrDeg100ms > 3 * cJ.AimErrDeg100ms * 10, $"flick {kF.AimErrDeg100ms:0.00} vs wall {wF.AimErrDeg100ms:0.000} deg; drop {kD.AimErrDeg100ms:0.00} deg");
                var lPlain = ChainLab.Run(cPsy, Rig.From(cPsy), aim, ChainLab.Engine.Cadence, 10, 11, 40, ChainLab.Timing.Late);
                var lCheck = ChainLab.Run(cPsy, Rig.From(cPsy), aim, ChainLab.Engine.CadenceDropCheck, 10, 11, 40, ChainLab.Timing.Late);
                var dPlain = ChainLab.Run(cPsy, Rig.From(cPsy), aim, ChainLab.Engine.Cadence, 10, 11, 40, ChainLab.Timing.Drop);
                var dCheck = ChainLab.Run(cPsy, Rig.From(cPsy), aim, ChainLab.Engine.CadenceDropCheck, 10, 11, 40, ChainLab.Timing.Drop);
                Ok("Cadence drop check: a LATE report is no longer priced at half speed (Psylocke tracking error back to the jitter-only level), and a real DROP is priced exactly as before",
                   lPlain.AimErrDeg100ms > 0.5 && lCheck.AimErrDeg100ms < 1.5 * cJ.AimErrDeg100ms && Math.Abs(dPlain.AimErrDeg100ms - dCheck.AimErrDeg100ms) < 1e-9,
                   $"late {lPlain.AimErrDeg100ms:0.000} -> {lCheck.AimErrDeg100ms:0.0000} deg; drop {dPlain.AimErrDeg100ms:0.0000} = {dCheck.AimErrDeg100ms:0.0000}");
                // try to break it: drops and late reports at every spacing 3-17 across every scenario, three seeds
                double worst = 0; string where = "";
                foreach (var cp in new[] { cBo, cPsy, cat.Find("owsol")!, cat.Find("breakwide")! })
                    foreach (var sc in ChainLab.Scenarios)
                        foreach (var tm in new[] { ChainLab.Timing.Drop, ChainLab.Timing.Late })
                            for (int every = 3; every <= 17; every += 2)
                                foreach (int seed in new[] { 1, 2 })
                                {
                                    double a1 = ChainLab.Run(cp, Rig.From(cp), sc, ChainLab.Engine.Cadence, 10, seed, every, tm).AimErrDeg100ms;
                                    double a2 = ChainLab.Run(cp, Rig.From(cp), sc, ChainLab.Engine.CadenceDropCheck, 10, seed, every, tm).AimErrDeg100ms;
                                    if (a2 - a1 * 1.02 > worst) { worst = a2 - a1 * 1.02; where = $"{cp.id} {sc.Name} {tm}/{every}: {a1:0.0000} -> {a2:0.0000}"; }
                                }
                Ok("Cadence drop check is never worse than plain Cadence (drops and late reports at every 3rd-17th report, every scenario, 4 cards, 2 seeds; 2% / 0.002 deg)",
                   worst <= 0.002, where.Length > 0 ? "worst " + where : "no case worse");
                var plainCore = new Filters.CadenceCore { NominalHz = 360 }; var offCore = new Filters.CadenceCore { NominalHz = 360, DropCheck = 0 };
                Ok("Cadence drop check OFF is the v1.2 core (the property defaults to 0 in the plugin)", plainCore.DropCheck == 0 && offCore.DropCheck == 0 && Rig.From(cBo).DropCheck);
                var tl = new List<string> { "#press" }; double tx = 0;
                for (int i = 0; i < 60; i++) { double dtl = 1000.0 / 360.2; if (i == 30) dtl *= 1.9; if (i == 31) dtl *= 0.1; if (i == 45) dtl *= 2; tx += i == 45 ? 20 : 10; tl.Add(System.FormattableString.Invariant($"{dtl:0.###} 0 {tx} 100")); }
                var ts = PenTiming.FromNibLog(tl);
                Ok("pen timing: from the press log, a late report (long gap, one report of travel, then a short gap) and a dropped one (long gap, two reports of travel) are told apart",
                   ts.Late == 1 && ts.Drop == 1 && ts.Short == 1 && ts.Plain == 56, ts.Summary);
            }

            // ---- 2026-10-11: the VMulti split hazard - a curve still changing above the 127-count split speed ----
            {
                // the retired HD2 wildcard's table (90 px/mm, ramp 180 -> 545 mm/s, past the 508 mm/s split) keeps the rule's teeth
                var hdwxOld = new Preset { id = "hdwx-2026-10", name = "Heavy (retired)", group = "Custom", pxmm = 90, cm = 27, adv = new Adv { reset = 80, yx = 0.789 },
                    lut = new[] { new[] { 2.66, 0.7 }, new[] { 8.3, 1.0 }, new[] { 180.0, 1.0 }, new[] { 545.0, 7.0 }, new[] { 1450.0, 7.0 } } };
                var hzCards = cat.presets.Append(hdwxOld).ToList();
                var hz = hzCards.Where(x => BuildState.SplitHazardMmS(x, x.pxmm) != null).Select(x => x.id).OrderBy(x => x).ToList();
                var flick = ChainLab.Scenarios[3]; string bad = "";
                foreach (var x in hzCards)
                {
                    double w = ChainLab.Run(x, Rig.From(x), flick, ChainLab.Engine.Wall).AimErrDeg100ms;
                    bool hazard = hz.Contains(x.id);
                    if (hazard != (w > 1.0)) bad += $" {x.id} {w:0.00}deg hazard={hazard};";
                }
                Ok("split hazard: the closed-form rule (curve still changing above 127 counts a report) flags exactly the cards whose RawAccel-engine flick misprices > 1 deg in the chain lab - and those get the Cadence advice; since 2026-10-23 no shipped card has it (the retired HD2 wildcard still does)",
                   bad.Length == 0 && hz.SequenceEqual(new[] { "hdwx-2026-10" }) && BuildState.CadenceReason(hdwxOld, hdwxOld.pxmm)!.Contains("splits"),
                   bad.Length == 0 ? string.Join(", ", hz) : bad);
            }

            // ---- 2026-10-23: 'every card feels slow' - the curve must actually run, once, unsmoothed ----
            {
                var notLive = Doctor.CurveLiveRow(true, true, "Filters: 'Hover Distance Limiter: { Hover_max: 87 }'");
                var live = Doctor.CurveLiveRow(true, true, "Filters: 'AimForge Cadence Lock (tablet-space accel, T0): { NominalHz: 360 }'");
                var nowhere = Doctor.CurveLiveRow(false, true, null); var ra2 = Doctor.CurveLiveRow(false, false, null);
                var unasked = Doctor.WithFixes(new List<Doctor.Item> { Doctor.CurveLiveRow(true, true, null) })[0];
                Ok("latency: a daemon that did not answer leaves the curve UNVERIFIED with its own fix (not the generic 'check the driver is installed')",
                   unasked.Level == "WARN" && !unasked.Fix.StartsWith("check the driver is installed"), unasked.Fix);
                Ok("latency: Cadence in the settings but not in the daemon (plugin not loaded) with RawAccel flat FAILS as 'no curve anywhere'; Cadence running passes; RawAccel flat with Cadence off fails; the RawAccel engine passes",
                   notLive.Level == "FAIL" && notLive.Detail.Contains("NO CURVE ANYWHERE") && live.Level == "OK" && nowhere.Level == "FAIL" && ra2.Level == "OK");
                var d = Doctor.DuplicatePlugins(new[] { @"D:\Pen\userdata\Plugins\AimForge Game Filters\AimForge.Filters.dll",
                    @"D:\Pen\userdata\Plugins\AimForge Game Filters\plugin - copy\AimForge.Filters.dll", @"D:\Pen\userdata\Plugins\Coherence Stabilizer\CoherenceStabilizer.dll",
                    @"D:\Pen\userdata\Plugins\Reconstructor\VoiD.dll", @"D:\Pen\userdata\Plugins\VMultiMode\VoiD.dll" });
                var sm = Doctor.SmoothingRow(new List<string> { "Hawku Smoothing [T3]" });
                Ok("latency: a first-party plugin DLL installed twice is named (a shared third-party library like VoiD.dll in two packages is normal, not flagged); a live smoothing filter is a WARN with what it costs",
                   d.Count == 1 && d[0].StartsWith("AimForge.Filters.dll") && sm.Level == "WARN" && sm.Detail.Contains("reacts later") && Doctor.SmoothingRow(new List<string>()).Level == "OK");
            }

            Console.WriteLine(fails == 0 ? "ALL SELF-TESTS PASSED" : fails + " FAILED");
            return fails == 0;
        }
    }
}
