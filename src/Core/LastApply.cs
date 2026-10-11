using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace AimForge.Core
{
    /// <summary>
    /// What the last successful apply WROTE (lastapply.json beside the app), so the Doctor can say whether the live
    /// drivers still carry it (2026-09-24 review: a px/mm, reset, snap, Y/X or Cadence edit made in another tool left
    /// every Doctor row green). Written after a verified apply only; never read by an apply.
    /// </summary>
    public sealed class LastApply
    {
        public string CardId { get; set; } = ""; public string CardName { get; set; } = ""; public string At { get; set; } = "";
        public string Engine { get; set; } = "rawaccel";
        public double PxMm { get; set; } public double ResetMs { get; set; } public double Yx { get; set; } public double SnapDeg { get; set; }
        public double OutputDpi { get; set; } public bool HdlEnabled { get; set; } public double HdlMin { get; set; } public double HdlMax { get; set; }
        public Dictionary<string, double> Cadence { get; set; } = new();
        public bool NibTwin { get; set; }
        /// The whole applied build (2026-09-24 review): the folded card exactly as written and the rig, so the nib
        /// calibration re-applies what is LIVE (not the card browsed in the window, not a lossy CLI rebuild) and the
        /// window can open on the live values. Older records have neither; callers then fall back or refuse.
        public Preset? Card { get; set; }
        public string RigJson { get; set; } = "";

        static readonly JsonSerializerOptions RigOpts = new JsonSerializerOptions { IncludeFields = true, NumberHandling = System.Text.Json.Serialization.JsonNumberHandling.AllowNamedFloatingPointLiterals };
        public Rig? AppliedRig() { try { return RigJson.Length == 0 ? null : JsonSerializer.Deserialize<Rig>(RigJson, RigOpts); } catch { return null; } }

        public static string DefaultPath => Path.Combine(AppContext.BaseDirectory, "lastapply.json");

        public static LastApply From(Preset p, Rig rg) => new LastApply
        {
            CardId = p.id, CardName = p.name, At = DateTime.Now.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture), Engine = rg.Engine,
            PxMm = rg.PxMm, ResetMs = rg.ResetMs, Yx = rg.Yx, SnapDeg = rg.SnapDeg, OutputDpi = Math.Round(1000.0 * rg.Mult, 1),
            HdlEnabled = rg.HdlEnabled, HdlMin = rg.HdlMin, HdlMax = rg.HdlMax,
            Cadence = rg.CadenceEngine ? OtdBridge.CadencePoints(p, rg) : new Dictionary<string, double>(), NibTwin = rg.NibTwin,
            Card = JsonSerializer.Deserialize<Preset>(JsonSerializer.Serialize(p)), RigJson = JsonSerializer.Serialize(rg, RigOpts)
        };

        /// A verified --mouse on|off changes what is live: keep the record in step (2026-09-24 review: the calibration
        /// re-applied the recorded mirror state and silently reverted the switch).
        public static void NoteMouse(MouseMirror.State st, string? path = null)
        {
            var la = Load(path); if (la == null) return;
            if (la.AppliedRig() is Rig r) { st.ApplyTo(r); la.RigJson = JsonSerializer.Serialize(r, RigOpts); la.Save(path); }
        }

        /// A verified live hover push changes what is live: keep the record in step (2026-09-24 review: the sanctioned
        /// hover-by-feel path raised a false 'changed since the last apply' FAIL).
        public static void NoteHover(Rig hover, string? path = null)
        {
            var la = Load(path); if (la == null) return;
            la.HdlEnabled = hover.HdlEnabled; la.HdlMin = hover.HdlMin; la.HdlMax = hover.HdlMax;
            if (la.AppliedRig() is Rig r) { r.HdlEnabled = hover.HdlEnabled; r.HdlMin = hover.HdlMin; r.HdlMax = hover.HdlMax; la.RigJson = JsonSerializer.Serialize(r, RigOpts); }
            la.Save(path);
        }

        public void Save(string? path = null) { try { File.WriteAllText(path ?? DefaultPath, JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true })); } catch { } }
        public static LastApply? Load(string? path = null)
        {
            try { var f = path ?? DefaultPath; return File.Exists(f) ? JsonSerializer.Deserialize<LastApply>(File.ReadAllText(f)) : null; }
            catch { return null; }
        }

        static bool Near(double a, double b) => Math.Abs(a - b) <= Math.Max(1e-6, 1e-6 * Math.Abs(b));

        /// The fields the live settings files no longer carry, by name. Empty = the drivers still hold the last apply.
        /// `raRoot` (optional): RawAccel's settings document, for the mouse-mirror row.
        public List<string> Drift(string otdSettingsPath, RawAccelBridge.Live ra, JsonObject? raRoot = null)
        {
            var o = new List<string>();
            var prof = JsonNode.Parse(File.ReadAllText(otdSettingsPath))!["Profiles"]![0]!.AsObject();
            var rel = prof["RelativeModeSettings"]!.AsObject();
            if (!Near(rel["XSensitivity"]!.GetValue<double>(), PxMm)) o.Add($"OTD px/mm {rel["XSensitivity"]} (applied {PxMm})");
            if (TimeSpan.TryParse(rel["RelativeResetDelay"]?.GetValue<string>() ?? "", CultureInfo.InvariantCulture, out var rd) && !Near(rd.TotalMilliseconds, ResetMs))
                o.Add($"OTD reset {rd.TotalMilliseconds:0} ms (applied {ResetMs:0})");
            var filters = prof["Filters"]!.AsArray().Select(f => f!.AsObject()).ToList();
            double? Prop(JsonObject f, string k) => f["Settings"]?.AsArray().FirstOrDefault(s => s!["Property"]!.GetValue<string>() == k)?["Value"]?.GetValue<double>();
            var hdl = filters.FirstOrDefault(f => f["Path"]!.GetValue<string>().Contains("Hover_Distance_Limiter"));
            bool hdlOn = hdl?["Enable"]?.GetValue<bool>() == true;
            if (hdlOn != HdlEnabled) o.Add($"Hover Distance Limiter {(hdlOn ? "ON" : "off")} (applied {(HdlEnabled ? "ON" : "off")})");
            else if (hdlOn && hdl != null)
            {
                if (Prop(hdl, "Hover_max") is double hm && !Near(hm, HdlMax)) o.Add($"Hover_max {hm} (applied {HdlMax})");
                if (Prop(hdl, "Hover_min") is double hn && !Near(hn, HdlMin)) o.Add($"Hover_min {hn} (applied {HdlMin})");
            }
            var cl = filters.FirstOrDefault(f => f["Path"]!.GetValue<string>().Contains(OtdBridge.CadenceId));
            bool clOn = cl?["Enable"]?.GetValue<bool>() == true;
            bool cad = Engine == "cadence";
            if (clOn != cad) o.Add($"Cadence Lock {(clOn ? "ON" : "off")} (applied engine: {Engine})");
            if (cad && clOn && cl != null)
            {
                var lastOn = filters.LastOrDefault(f => f["Enable"]?.GetValue<bool>() == true && !f["Path"]!.GetValue<string>().Contains("HawkuScroll"));
                if (!ReferenceEquals(lastOn, cl)) o.Add("Cadence Lock is not the last enabled filter");
                foreach (var kv in Cadence)
                    if (Prop(cl, kv.Key) is double v) { if (!Near(v, kv.Value)) o.Add($"CadenceLock.{kv.Key} {v} (applied {kv.Value})"); }
                    else o.Add($"CadenceLock.{kv.Key} missing");
            }
            var nt = filters.FirstOrDefault(f => f["Path"]!.GetValue<string>().Contains(OtdBridge.NibTwinId));
            bool ntOn = nt?["Enable"]?.GetValue<bool>() == true && (Prop(nt, "Twin") ?? 0) >= 0.5;
            if (nt?["Enable"]?.GetValue<bool>() == true && (Prop(nt, "Probe") ?? 0) >= 0.5)
                o.Add("Nib Twin press LOG still on (a calibration did not finish) - apply your card again");
            if (ntOn != NibTwin) o.Add($"Nib Twin {(ntOn ? "ON" : "off")} (applied {(NibTwin ? "ON" : "off")})");
            else if (ntOn && nt != null && AppliedRig() is Rig ar)
                foreach (var kv in OtdBridge.NibPoints(ar))
                    if (kv.Key != "Probe" && Prop(nt, kv.Key) is double nv && !Near(nv, kv.Value)) o.Add($"NibTwin.{kv.Key} {nv} (applied {kv.Value})");
            if (ntOn && nt != null && !ReferenceEquals(filters.FirstOrDefault(f => f["Enable"]?.GetValue<bool>() == true && !f["Path"]!.GetValue<string>().Contains("HawkuScroll") && !f["Path"]!.GetValue<string>().Contains("Hover_Distance")), nt))
                o.Add("Nib Twin is not the first enabled aim filter");
            if ((ra.Mode == "noaccel") != cad) o.Add($"RawAccel mode {ra.Mode} (applied engine: {Engine})");
            if (!Near(ra.Yx, Yx)) o.Add($"RawAccel Y/X {ra.Yx} (applied {Yx})");
            if (!Near(ra.SnapDeg, SnapDeg)) o.Add($"RawAccel snap {ra.SnapDeg} (applied {SnapDeg})");
            if (!Near(ra.OutputDpi, OutputDpi)) o.Add($"RawAccel Output DPI {ra.OutputDpi} (applied {OutputDpi})");
            // the rest of the build the calibration re-applies (third review): the pen curve itself, the stabilizer overlay,
            // the game filters and the mouse mirror
            if (Card != null && AppliedRig() is Rig rr)
            {
                if (RawAccelBridge.PenMismatch(ra, Card, rr) is string pm) o.Add("RawAccel curve differs from the last apply (" + pm + ")");
                var coh = filters.FirstOrDefault(f => f["Path"]!.GetValue<string>().Contains("CoherenceStabilizerTabletSpace"));
                bool cohOn = coh?["Enable"]?.GetValue<bool>() == true;
                if (cohOn != (Card.cohOv != null)) o.Add($"Coherence Stabilizer {(cohOn ? "ON" : "off")} (applied {(Card.cohOv != null ? "ON" : "off")})");
                else if (cohOn && coh != null && Card.cohOv is CohOv cv)
                    foreach (var (k, v) in new[] { ("HoldTimeMs", cv.hold), ("TapAnchor", cv.tap), ("TapHoldMs", cv.tapHold), ("TapBreakMm", cv.tapBreak), ("LeadMs", cv.lead),
                                                    ("LeadMaxMm", cv.leadMax), ("AnchorStrength", cv.anchor), ("SettleAssist", cv.settle), ("TapArmPressurePct", cv.tapArm) })
                        if (Prop(coh, k) is double lv && !Near(lv, v)) o.Add($"Stabilizer.{k} {lv} (applied {v})");
                foreach (var fs in Card.filters ?? new List<FilterSpec>())
                {
                    if (!fs.id.StartsWith("AimForge.Filters.", StringComparison.OrdinalIgnoreCase)) continue;
                    var gf = filters.FirstOrDefault(f => f["Path"]!.GetValue<string>() == fs.id);
                    bool gOn = gf?["Enable"]?.GetValue<bool>() == true;
                    if (gOn != fs.on) { o.Add($"{fs.id.Replace("AimForge.Filters.", "")} {(gOn ? "ON" : "off")} (applied {(fs.on ? "ON" : "off")})"); continue; }
                    if (gOn && gf != null)
                        foreach (var kv in fs.settings)
                            if (Prop(gf, kv.Key) is double gv && !Near(gv, kv.Value)) o.Add($"{fs.id.Replace("AimForge.Filters.", "")}.{kv.Key} {gv} (applied {kv.Value})");
                }
                if (raRoot != null)
                {
                    var ml = MouseMirror.Read(raRoot); bool mOn = ml.Exists && ml.Bound.Count > 0;
                    if (mOn != rr.MirrorMouse) o.Add($"mouse mirror {(mOn ? "ON" : "off")} in RawAccel (applied {(rr.MirrorMouse ? "ON" : "off")})");
                }
            }
            return o;
        }
    }

    /// <summary>
    /// --nib-calibrate / the Builds-tab 'calibrate nib' button. One transaction on the LIVE build (lastapply.json):
    /// re-apply it with the Nib Twin filter in LOG mode (twin off; it logs the raw pen before any other filter, so
    /// nothing else changes), let the user tap, fit the log, save nibtwin.json when the fit is valid, and re-apply the
    /// live build without the log - with the NEW calibration when the twin was live. (2026-09-24 review: it re-applied
    /// the card browsed in the window or a lossy CLI rebuild, skipped the shared gate, had no RawAccel rollback when the
    /// OTD half threw, restored the pre-fit swing, and several exits left the press log live.)
    /// </summary>
    public static class NibCalibrator
    {
        public static string ProbeLog(OtdBridge otd) => Path.Combine(otd.Dir, "nibtwin-probe.txt");

        /// The build a calibration runs on: the last verified apply, whole. Null + reason when there is none on record.
        public static (Preset? card, Rig? rig, string? why) LiveBuild(LastApply? la)
        {
            if (la == null) return (null, null, "no applied build on record - apply your build once, then calibrate (the calibration re-applies exactly what is live)");
            var r = la.AppliedRig();
            if (la.Card == null || r == null) return (null, null, $"the record of the last apply ({la.CardName}, {la.At}) predates full-build records - apply your build again, then calibrate");
            return (la.Card, r, null);
        }

        /// Returns the fit (Cal null / Refused set when it failed; Restored = the rig now live when the restore took).
        /// `waitForTaps` blocks until the user has tapped. `inFlight` (optional) is set while the press log may be live.
        /// `stateDir` (selftests) holds lastapply.json / nibtwin.json instead of the app folder.
        public static NibFit.Result Run(RawAccelBridge ra, OtdBridge otd, Tablet tablet, Func<bool> waitForTaps, Action<string> log,
                                        double unitsPerMm = 100, LastApply? live = null, Action<bool>? inFlight = null, string? stateDir = null)
        {
            string? laPath = stateDir == null ? null : Path.Combine(stateDir, "lastapply.json");
            string? calPath = stateDir == null ? null : Path.Combine(stateDir, "nibtwin.json");
            var la = live ?? LastApply.Load(laPath);
            var (card, userRig, why) = LiveBuild(la);
            if (card == null || userRig == null) return new NibFit.Result { Refused = why };
            if (!otd.TabletDevicePresent()) return new NibFit.Result { Refused = "Windows sees no tablet USB device - plug it in first" };
            // the record must still be what is live: a calibration puts the record back twice, so any change made since
            // (another tool, another AimForge folder, a RawAccel restore) would be overwritten silently (2026-09-24 review)
            try
            {
                var drift = la!.Drift(otd.SettingsPath, ra.ReadLive(), ra.ReadRoot());
                if (drift.Count > 0) return new NibFit.Result { Refused = "the drivers no longer carry your last apply (" + string.Join("; ", drift.Take(4)) + ") - apply your build again, then calibrate" };
            }
            catch (Exception ex) { return new NibFit.Result { Refused = "could not compare the live drivers with the last apply (" + ex.Message + ")" }; }
            // the mouse mirror comes from the record too: a verified --mouse on|off keeps it in step (NoteMouse) and the drift
            // check above refuses when RawAccel disagrees; mouse.txt can hold Builds-tab edits that were never applied (third
            // review: the calibration applied them although it says nothing else changes)
            var calRig = userRig.Clone(); calRig.NibProbe = true; calRig.NibTwin = false;
            // the SAME gate as every apply, on the calibration build, before anything is written
            var (blk, warn) = RolePolicy.GateForApply(card, tablet, () => FilterCatalog.Discover(otd), calRig, otd.CadenceBlocker(calRig, card),
                                                      OtdBridge.HoverBlocker(calRig), Experiments.Blocker(calRig, card), otd.NibBlocker(calRig), ra.PenDeviceBlocker());
            foreach (var w in warn) log("plan: " + w);
            if (blk.Count > 0) return new NibFit.Result { Refused = "the calibration build is refused: " + string.Join("; ", blk) };
            log($"nib: calibrating on your live build {card.name} (applied {la!.At})");
            string logPath = ProbeLog(otd);
            try { if (File.Exists(logPath)) File.Delete(logPath); } catch { }
            NibFit.Result res = new NibFit.Result { Refused = "the calibration did not run" };
            NibCal? fresh = null;
            bool calLive = false;
            inFlight?.Invoke(true);
            try
            {
                log("nib: re-applying your build with the Nib Twin press log on (twin off)");
                string? prevPreset = otd.ReadPresetText();
                string bak = ra.Apply(card, calRig, false, log);
                bool ok;
                try { ok = otd.Apply(card, calRig, false, log); }
                catch
                {
                    // back to exactly what was live: RawAccel from its backup, OTD from the preset file it had (a forward move
                    // to the record's build would be no rollback - 2026-09-24 review)
                    log("nib: the OTD half threw - rolling both drivers back");
                    if (bak.Length > 0) ra.RestoreBackup(bak, log);
                    otd.PutPresetBack(prevPreset, log);
                    throw;
                }
                // a refused OTD apply already put the previous (live) preset back; RawAccel follows it
                if (!ok) { if (bak.Length > 0) ra.RestoreBackup(bak, log); return new NibFit.Result { Refused = "the calibration apply did not take - see the log; your build is unchanged" }; }
                calLive = true;
                if (!waitForTaps()) return res = new NibFit.Result { Refused = "cancelled" };
                System.Threading.Thread.Sleep(400);   // the filter flushes 90 reports (250 ms) after the last release
                if (!File.Exists(logPath)) return res = new NibFit.Result { Refused = "no presses were logged (was the tip tapped on the tablet?)" };
                res = NibFit.Fit(File.ReadAllLines(logPath), unitsPerMm, logPath);
                log("nib: " + res.Report);
                if (res.Cal != null && res.Refused == null) { res.Cal.Save(calPath); fresh = res.Cal; log("nib: calibration saved -> " + (calPath ?? NibCal.DefaultPath)); }
                else log("nib: calibration NOT saved - " + res.Refused);
            }
            finally
            {
                if (calLive)
                {
                    log("nib: re-applying your build without the press log");
                    var r2 = userRig.Clone(); r2.NibProbe = false;
                    if (r2.NibTwin && fresh != null) { fresh.ApplyTo(r2); log("nib: the live twin takes the NEW calibration"); }
                    bool restored = false;
                    try
                    {
                        string bak2 = ra.Apply(card, r2, false, log);
                        try { restored = otd.Apply(card, r2, false, log); }
                        catch { if (bak2.Length > 0) ra.RestoreBackup(bak2, log); throw; }
                        if (!restored && bak2.Length > 0) ra.RestoreBackup(bak2, log);
                    }
                    catch (Exception ex) { log("nib: re-apply FAILED (" + ex.Message + ")"); }
                    if (restored) { LastApply.From(card, r2).Save(laPath); res.Restored = r2; }
                    else
                    {
                        if (!otd.NibProbeOff(log, r2)) log("nib: the press log may still be ON - apply your card again (the Doctor flags it)");
                        string not = "your build was NOT re-applied - apply it again";
                        res.Refused = res.Refused == null ? (fresh != null ? "calibration saved, but " + not : not) : res.Refused + "; " + not;
                    }
                }
                inFlight?.Invoke(false);
            }
            return res;
        }
    }
}
