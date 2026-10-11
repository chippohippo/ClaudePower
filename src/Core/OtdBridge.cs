using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading;

namespace AimForge.Core
{
    /// <summary>
    /// Drives OpenTabletDriver through its OFFICIAL RPC client (OpenTabletDriver.Console.exe), the
    /// same named pipe the stock GUI uses. The daemon keeps doing all the real work; this app only
    /// replaces the WPF front-end, which is the heavy part. VMulti (WHQL-signed vmulti.sys) is
    /// untouched - the daemon owns it.
    /// </summary>
    public sealed class OtdBridge
    {
        public string Dir { get; }
        public string DataDir { get; }
        public string Daemon => Path.Combine(Dir, "OpenTabletDriver.Daemon.exe");
        public string Console_ => Path.Combine(Dir, "OpenTabletDriver.Console.exe");
        public string SettingsPath => Path.Combine(DataDir, "settings.json");
        public string PresetsDir => Path.Combine(DataDir, "Presets");
        public const string PresetName = "AimForge";
        /// The AimForge Game Filters plugin DLL in THIS data dir (was a hardcoded D:\Pen path).
        public string GameFilterDll => Path.Combine(DataDir, "Plugins", "AimForge Game Filters", "AimForge.Filters.dll");
        /// Cadence Lock pre-flight, checked BEFORE RawAccel is flattened (2026-09-16 audit: the old refusal fired
        /// after the RawAccel write, leaving the rig with no curve anywhere). Also refuses a LUT the plugin cannot carry.
        public string? CadenceBlocker(Rig rig, Preset p)
        {
            if (!rig.CadenceEngine) return null;
            if (!File.Exists(GameFilterDll))
                return "the Cadence Lock engine needs the AimForge Game Filters plugin (" + GameFilterDll + ") - run build.ps1, then " + RestartHint + "; nothing was written";
            // the daemon's settings echo (getfilters) cannot tell whether it CONSTRUCTED the filter, so check load order
            // instead: a plugin written after the running daemon started is not the one it loaded (2026-09-16 review)
            if (PluginNewerThanDaemon() is DateTime built)
                return $"the AimForge Game Filters plugin was rebuilt at {built.ToLocalTime():HH:mm} after the OTD daemon started - {RestartHint} first; nothing was written";
            if (p.IsLut && p.lut!.Length > Filters.CadenceCore.MaxPoints)
                return $"the Cadence Lock engine carries at most {Filters.CadenceCore.MaxPoints} LUT points and this build has {p.lut.Length} - use the RawAccel engine or fewer points; nothing was written";
            return null;
        }

        /// The plugin DLL's write time when it is newer than every running daemon process (so that daemon has not loaded it).
        public DateTime? PluginNewerThanDaemon() => PluginNewerThanDaemon(GameFilterDll);
        /// The Coherence Stabilizer plugin DLL in this data dir.
        public string StabilizerDll => Path.Combine(DataDir, "Plugins", "Coherence Stabilizer", "CoherenceStabilizer.dll");

        /// Whether a plugin DLL declares a property on a filter class, read from its metadata WITHOUT loading it (null =
        /// no file / unreadable). getfilters echoes the settings store, so a property the installed build does not have
        /// still reads back (2026-09-24 review: TapMoveFade 'verified' against an Aug 11 stabilizer that ignores it).
        public static bool? PluginHasProperty(string dllPath, string typeName, string prop)
        {
            try
            {
                if (!File.Exists(dllPath)) return null;
                using var fs = File.OpenRead(dllPath);
                using var pe = new System.Reflection.PortableExecutable.PEReader(fs);
                var md = System.Reflection.Metadata.PEReaderExtensions.GetMetadataReader(pe);
                foreach (var th in md.TypeDefinitions)
                {
                    var td = md.GetTypeDefinition(th);
                    if (md.GetString(td.Name) != typeName) continue;
                    foreach (var ph in td.GetProperties()) if (md.GetString(md.GetPropertyDefinition(ph).Name) == prop) return true;
                    return false;
                }
                return false;
            }
            catch { return null; }
        }
        /// The installed Coherence Stabilizer carries the moving-tap fade (TapMoveFade, 2026-09-24).
        public bool? StabilizerHasMoveFade() => PluginHasProperty(StabilizerDll, "CoherenceStabilizerTabletSpace", "TapMoveFade");
        public const string StabilizerInstallHint = "run CoherenceStabilizer\\build.ps1 -Install, then ";
        /// The running daemon's start time (UTC), or null when no daemon runs or it cannot be read.
        public DateTime? DaemonStartUtc()
        {
            if (Hook != null) return null;
            try { var p = Process.GetProcessesByName("OpenTabletDriver.Daemon"); return p.Length == 0 ? null : p.Min(x => x.StartTime.ToUniversalTime()); }
            catch { return null; }
        }

        /// Whether Windows currently has the tablet's USB HID device present. getfilters answers from the saved profile
        /// even with the tablet unplugged (2026-09-24 review: the Doctor said 'tablet detected' for a dead pen, and
        /// Ctrl+D could never escalate), so presence comes from the OS device list - read-only SetupAPI, no driver open.
        /// Only Wacom (VID_056A) profiles are checked; any other vendor reads as present.
        public bool TabletDevicePresent()
        {
            if (Hook != null) return true;
            if (!TabletName().Contains("Wacom", StringComparison.OrdinalIgnoreCase)) return true;
            try { return Win32Devices.AnyPresent("HID", "VID_056A"); } catch { return true; }
        }

        public DateTime? PluginNewerThanDaemon(string dllPath)
        {
            if (Hook != null) return null;
            try
            {
                if (!File.Exists(dllPath)) return null;
                var dll = File.GetLastWriteTimeUtc(dllPath);
                var procs = Process.GetProcessesByName("OpenTabletDriver.Daemon");
                if (procs.Length == 0) return null;   // a daemon started by the apply loads the current build
                foreach (var pr in procs) { try { if (pr.StartTime.ToUniversalTime() >= dll) return null; } catch { return null; } }
                return dll;
            }
            catch { return null; }
        }

        /// A new plugin build loads only when the daemon restarts; Ctrl+D restarts it only when the tablet is absent.
        public const string RestartHint = "restart the OTD daemon (tray menu > Restart OTD daemon, or AimForge --daemon-restart)";

        /// getfilters prints each enabled filter by its plugin name.
        internal static readonly Dictionary<string, string> GameFilterNames = new()
        {
            ["AimForge.Filters.CodMaster"] = "AimForge CoD Master", ["AimForge.Filters.CodLab"] = "AimForge CoD Lab",
            ["AimForge.Filters.ValMaster"] = "AimForge Valorant Master", ["AimForge.Filters.ValLab"] = "AimForge Valorant Lab",
            ["AimForge.Filters.ApexMaster"] = "AimForge Apex Master", ["AimForge.Filters.Ow2Master"] = "AimForge OW2 Master",
            ["AimForge.Filters.Ow2Lab"] = "AimForge OW2 Lab", ["AimForge.Filters.RivalsMaster"] = "AimForge Rivals Master",
            ["AimForge.Filters.FinalsMaster"] = "AimForge Finals Master", ["AimForge.Filters.HoldfastMaster"] = "AimForge Holdfast Master",
        };

        /// The name getfilters prints for a first-party filter path (null = not one of ours).
        public static string? LiveName(string path) =>
            path.Contains(CadenceId) ? "Cadence Lock" : path.Contains(NibTwinId) ? "Nib Twin" : path.Contains("CoherenceStabilizer") ? "Coherence Stabilizer"
            : GameFilterNames.FirstOrDefault(kv => path.Contains(kv.Key)).Value;

        public OtdBridge(string dir, string dataDir) { Dir = dir; DataDir = dataDir; }

        public bool Installed => File.Exists(Daemon) && File.Exists(Console_) && File.Exists(SettingsPath);

        /// The stock WPF GUI keeps its OWN in-memory settings and overwrites the daemon with them
        /// on interaction - an apply from here silently loses to it. Detect and say so.
        public bool UxRunning()
        {
            if (Hook != null) return false;
            try { return Process.GetProcessesByName("OpenTabletDriver.UX.Wpf").Length > 0; } catch { return false; }
        }

        /// What the DAEMON is actually running right now (not the settings file).
        public double LiveDaemonPxMm()
        {
            var r = Run("getsensitivity \"" + TabletName() + "\"", 4000);
            if (!r.ok) return -1;
            foreach (var line in r.output.Split('\n'))
                if (line.Contains("Horizontal Sensitivity:"))
                {
                    var t = line.Split(':')[1].Trim().Replace("px/mm", "");
                    if (double.TryParse(t, out double v)) return v;
                }
            return -1;
        }

        /// The daemon exists but its RPC pipe rejects us: it was started ELEVATED (typically by
        /// the stock GUI run as admin). Every non-elevated client is locked out - this is the
        /// silent "apply did nothing" condition.
        public bool DaemonElevatedLockout()
        {
            if (!DaemonRunning()) return false;
            var r = Run("getallsettings", 3000);
            return !r.ok && (r.output.Contains("Access to the path is denied", StringComparison.OrdinalIgnoreCase)
                          || r.output.Contains("UnauthorizedAccess", StringComparison.OrdinalIgnoreCase));
        }

        /// Fix the lockout: an elevated process cannot be killed from here, so ask Windows for
        /// consent (one UAC prompt), then bring up a NON-elevated daemon and re-apply.
        public bool FixElevatedDaemon(Action<string> log)
        {
            log("OTD: daemon is running ELEVATED - its pipe rejects this app. Requesting admin consent to close it (UAC prompt)...");
            try
            {
                var psi = new ProcessStartInfo("taskkill", "/IM OpenTabletDriver.Daemon.exe /F") { Verb = "runas", UseShellExecute = true, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden };
                using var pr = Process.Start(psi);
                pr?.WaitForExit(30000);
            }
            catch (Exception e) { log("OTD: UAC declined or failed (" + e.Message + ") - close OpenTabletDriver.Daemon.exe in Task Manager, then press Ctrl+D"); return false; }
            Thread.Sleep(500);
            if (DaemonRunning()) { log("OTD: elevated daemon still alive - close it in Task Manager, then press Ctrl+D"); return false; }
            if (!EnsureDaemon(log, 12000)) return false;
            SanitizePresetProbe(log); if (File.Exists(Path.Combine(PresetsDir, PresetName + ".json"))) Run("applypreset " + PresetName, 8000);
            bool ok = TabletResponding();
            log(ok ? "OTD: replaced with a non-elevated daemon, tablet responding - applies will reach it now"
                   : "OTD: daemon replaced but tablet not responding - press Ctrl+D");
            return ok;
        }

        /// Close the stock GUI before we touch the daemon. It stomps applies with its stale
        /// in-memory settings, its updater window NREs when the daemon changes under it, and when
        /// launched elevated it spawns the elevated daemon that locks everyone else out.
        public void CloseUx(Action<string> log)
        {
            if (Hook != null) return;
            foreach (var pr in Process.GetProcessesByName("OpenTabletDriver.UX.Wpf"))
            {
                try
                {
                    log("OTD: closing the stock GUI (it conflicts with external applies)");
                    if (!pr.CloseMainWindow() || !pr.WaitForExit(3000)) pr.Kill();
                }
                catch (Exception e) { log("OTD: could not close the GUI (" + e.Message + ") - close it manually"); }
            }
        }

        public bool DaemonRunning()
        {
            if (Hook != null) return true;
            try { return Process.GetProcessesByName("OpenTabletDriver.Daemon").Length > 0; } catch { return false; }
        }

        /// Start the daemon detached and hidden. The daemon owns VMulti; we only ever launch the
        /// stock binary, never a modified one.
        public bool EnsureDaemon(Action<string> log, int waitMs = 9000)
        {
            if (DaemonRunning()) return true;
            log("OTD: daemon not running - starting it");
            var psi = new ProcessStartInfo(Daemon) { WorkingDirectory = Dir, UseShellExecute = false, CreateNoWindow = true };
            Process.Start(psi);
            var sw = Stopwatch.StartNew();
            while (sw.ElapsedMilliseconds < waitMs)
            {
                Thread.Sleep(400);
                if (DaemonRunning() && Run("getallsettings", 3000).ok) { log("OTD: daemon up"); return true; }
            }
            return DaemonRunning();
        }

        /// Selftest seam: when set, every console call goes here and no process is looked at, started or closed (the
        /// selftests drive the apply and the calibration against a fixture daemon). Always null in the app.
        internal static Func<string, (bool ok, string output)>? Hook;

        public (bool ok, string output) Run(string args, int timeoutMs = 6000)
        {
            if (Hook != null) return Hook(args);
            try
            {
                var psi = new ProcessStartInfo(Console_, args) { WorkingDirectory = Dir, UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
                using var p = Process.Start(psi)!;
                // read both streams asynchronously so the timeout really fires (2026-09-16 review: ReadToEnd first blocked
                // forever on a hung console, and with it the apply and the window's close guard)
                var so = p.StandardOutput.ReadToEndAsync(); var se = p.StandardError.ReadToEndAsync();
                if (!p.WaitForExit(timeoutMs)) { try { p.Kill(true); } catch { } return (false, "timeout"); }
                string o = so.Result + se.Result;
                bool ok = p.ExitCode == 0 && !o.Contains("not running", StringComparison.OrdinalIgnoreCase)
                                          && !o.Contains("Access to the path is denied", StringComparison.OrdinalIgnoreCase)
                                          && !o.Contains("UnauthorizedAccess", StringComparison.OrdinalIgnoreCase);
                return (ok, o.Trim());
            }
            catch (Exception e) { return (false, e.Message); }
        }

        public string TabletName()
        {
            try
            {
                var root = JsonNode.Parse(File.ReadAllText(SettingsPath))!.AsObject();
                return root["Profiles"]![0]!["Tablet"]!.GetValue<string>();
            }
            catch { return "Wacom DTC-141"; }
        }

        public sealed class Live
        {
            public double PxMm; public string ResetTime = ""; public List<string> EnabledFilters = new List<string>();
            public string CoherenceSummary = "";
            public bool CadenceOn;
        }

        public Live ReadLive()
        {
            var root = JsonNode.Parse(File.ReadAllText(SettingsPath))!.AsObject();
            var prof = root["Profiles"]![0]!.AsObject();
            var rel = prof["RelativeModeSettings"]!.AsObject();
            var l = new Live { PxMm = rel["XSensitivity"]!.GetValue<double>(), ResetTime = rel["RelativeResetDelay"]?.GetValue<string>() ?? "" };
            foreach (var f in prof["Filters"]!.AsArray())
            {
                var fo = f!.AsObject();
                if (fo["Enable"]?.GetValue<bool>() == true)
                {
                    string path = fo["Path"]!.GetValue<string>();
                    l.EnabledFilters.Add(path.Split('.').Last());
                    if (path.Contains(CadenceId)) l.CadenceOn = true;
                    if (path.Contains("CoherenceStabilizerTabletSpace"))
                        l.CoherenceSummary = string.Join(" ", fo["Settings"]!.AsArray()
                            .Where(s => new[] { "HoldTimeMs", "TapAnchor", "RailStrength", "LeadMs" }.Contains(s!["Property"]!.GetValue<string>()))
                            .Select(s => $"{s!["Property"]}={s["Value"]}"));
                }
            }
            return l;
        }

        /// True when the daemon answers AND reports the expected tablet.
        public bool TabletResponding()
        {
            if (!DaemonRunning() || !TabletDevicePresent()) return false;
            var r = Run("getfilters \"" + TabletName() + "\"", 4000);
            return r.ok && !r.output.Contains("not found", StringComparison.OrdinalIgnoreCase)
                        && !r.output.Contains("no tablets", StringComparison.OrdinalIgnoreCase);
        }

        /// Ctrl+D path. Escalates only as far as needed:
        ///   1. daemon not running -> start it (a fresh daemon detects on startup)
        ///   2. running but tablet absent -> Console `detect`
        ///   3. still absent -> restart the daemon and re-apply the AimForge preset
        public bool Redetect(Action<string> log)
        {
            CloseUx(log);
            if (DaemonElevatedLockout()) return FixElevatedDaemon(log);
            if (!DaemonRunning()) { log("redetect: daemon down - starting it"); EnsureDaemon(log); }
            // 2026-09-09: REVERTED to the original escalation. The 09-08 "always re-scan" version
            // broke the tablet in the field: every extra `detect` churns the device stream
            // ("A device stream was disposed." follows every re-scan but never the first), and
            // repeated churn wedges the device past what a USB replug clears. `detect` is issued
            // ONLY when the tablet is actually absent - never against a live, responding device.
            if (!TabletDevicePresent())
            {
                log("redetect: Windows sees no " + TabletName() + " USB device - plug the tablet in (or power it on) and press Ctrl+D again; a daemon restart cannot fix a missing device");
                return false;
            }
            if (TabletResponding()) { log("redetect: tablet already responding (" + TabletName() + ")"); return true; }
            log("redetect: asking the daemon to re-scan");
            Run("detect", 8000);
            Thread.Sleep(700);
            if (TabletResponding()) { log("redetect: tablet back (" + TabletName() + ")"); return true; }
            log("redetect: still absent - restarting the daemon");
            return RestartDaemon(log);
        }

        /// Full daemon bounce. The stock binary is restarted and the AimForge preset re-applied so
        /// the live settings survive the bounce.
        public bool RestartDaemon(Action<string> log)
        {
            foreach (var pr in Process.GetProcessesByName("OpenTabletDriver.Daemon"))
            { try { pr.Kill(); pr.WaitForExit(3000); } catch { } }
            Thread.Sleep(400);
            if (!EnsureDaemon(log, 12000)) { log("redetect: daemon did not come back - check the USB cable / try replugging"); return false; }
            SanitizePresetProbe(log); if (File.Exists(Path.Combine(PresetsDir, PresetName + ".json"))) Run("applypreset " + PresetName, 8000);
            bool ok = TabletResponding();
            log(ok ? "redetect: daemon restarted, tablet responding (" + TabletName() + ")"
                   : "redetect: daemon restarted but the tablet is still absent - replug the USB cable");
            return ok;
        }

        static JsonObject? FindFilter(JsonArray filters, string pathContains)
            => filters.Select(f => f!.AsObject()).FirstOrDefault(f => f["Path"]!.GetValue<string>().Contains(pathContains));

        /// OTD only adds a filter entry to settings.json after a GUI Save with the plugin loaded.
        /// Materialise it ourselves, and back-fill any missing property, exactly as Ensure-Filter did.
        static JsonObject EnsureFilter(JsonArray filters, string pathContains, string fullPath, string[] props)
        {
            var f = FindFilter(filters, pathContains);
            if (f == null)
            {
                f = new JsonObject { ["Path"] = fullPath, ["Settings"] = new JsonArray(), ["Enable"] = false };
                filters.Add(f);
            }
            var settings = f["Settings"]!.AsArray();
            foreach (var p in props)
                if (!settings.Any(s => s!["Property"]!.GetValue<string>() == p))
                    settings.Add(new JsonObject { ["Property"] = p, ["Value"] = 0.0 });
            return f;
        }

        /// Every Coherence Stabilizer property an apply writes, with its value - the write and the read-back share this list.
        internal static (string key, double val)[] StabilizerPlan(CohOv c) => new[]
        {
            ("TremorWindowMs", c.window), ("HoldTimeMs", c.hold), ("FullPassSpeed", c.fullPass), ("EngageSpeed", c.engage),
            ("CoherenceFloor", c.floor), ("CoherenceCeiling", c.ceiling), ("RailStrength", c.rails), ("AnchorStrength", c.anchor),
            ("AnchorTimeMs", c.anchorMs), ("SettleAssist", c.settle), ("SettleFlickSpeed", c.settleSpeed), ("MaxLagMm", 1.0), ("ResetMs", 50.0),
            ("TapAnchor", c.tap), ("TapArmPressurePct", c.tapArm), ("TapHoldMs", c.tapHold), ("TapBreakMm", c.tapBreak),
            ("TapMoveFade", 1.0),   // 2026-09-24: the pin fades out for a tap made while moving (the accel curve over-priced its hand-back)
            ("LeadMs", c.lead), ("LeadMaxMm", c.leadMax),
        };

        /// Why the last Apply returned false, in one line for the window's banner (null after a success).
        public string? LastFailure { get; private set; }

        static void SetProp(JsonObject filter, string prop, double value)
        {
            foreach (var s in filter["Settings"]!.AsArray())
                if (s!["Property"]!.GetValue<string>() == prop) { s["Value"] = value; return; }
        }

        /// Builds the AimForge preset from the live settings (so every unrelated field survives),
        /// writes it to the Presets folder, and applies it through the daemon's own RPC.
        /// Returns false when the daemon did not take the build or the curve's ENGINE is not where it must be
        /// (Cadence Lock live on a RawAccel-engine apply, or missing on a Cadence apply): the caller then rolls
        /// RawAccel back, so the curve is never in both places or in neither (2026-09-16 review).
        /// The settings document the last Apply built (dry run or not).
        public JsonObject? LastPlanned { get; private set; }

        public bool Apply(Preset p, Rig rig, bool dryRun, Action<string> log)
        {
            LastFailure = null;
            var root = JsonNode.Parse(File.ReadAllText(SettingsPath))!.AsObject();
            var prof = root["Profiles"]![0]!.AsObject();
            var rel = prof["RelativeModeSettings"]!.AsObject();
            rel["XSensitivity"] = rig.PxMm;
            rel["YSensitivity"] = rig.PxMm;      // Y/X asymmetry lives in RawAccel; OTD stays symmetric
            rel["RelativeResetDelay"] = TimeSpan.FromMilliseconds(rig.ResetMs).ToString();
            if (rig.TipThresholdPct is double tip)
            {
                var bind = prof["Bindings"]!.AsObject();
                bind["TipActivationThreshold"] = tip;
                log($"OTD: tip activation threshold {tip}%");
            }
            log($"OTD: {rig.PxMm} px/mm  reset {rig.ResetMs}ms");

            var filters = prof["Filters"]!.AsArray();

            // Every aim filter off, then enable exactly what the preset asks for. This is the
            // single-well-tuned-filter discipline: stacking was the source of every field glitch.
            foreach (var f in filters)
            {
                string path = f!["Path"]!.GetValue<string>();
                if (path.Contains("HawkuScroll")) continue;        // scroll, not aim
                f["Enable"] = false;
            }

            var hdl = EnsureFilter(filters, "Hover_Distance_Limiter", "Hover_Distance_Limiter.Hover_Distance_Limiter", new[] { "Hover_max", "Hover_min" });
            hdl["Enable"] = rig.HdlEnabled; SetProp(hdl, "Hover_max", rig.HdlMax); SetProp(hdl, "Hover_min", rig.HdlMin);
            log(rig.HdlEnabled ? $"OTD: Hover Distance Limiter ON  min {rig.HdlMin}  max {rig.HdlMax}"
                               : "OTD: Hover Distance Limiter OFF (toggled off for this apply)");

            if (p.cohOv != null)
            {
                var c = p.cohOv;
                var coh = EnsureFilter(filters, "CoherenceStabilizerTabletSpace", "CoherenceStabilizer.CoherenceStabilizerTabletSpace", new[]
                {
                    "TremorWindowMs","HoldTimeMs","FullPassSpeed","EngageSpeed","CoherenceFloor","CoherenceCeiling",
                    "RailStrength","AnchorStrength","AnchorTimeMs","SettleAssist","SettleFlickSpeed","MaxLagMm","ResetMs",
                    "TapAnchor","TapArmPressurePct","TapHoldMs","TapBreakMm","TapMoveFade","LeadMs","LeadMaxMm"
                });
                coh["Enable"] = true;
                foreach (var (key, val) in StabilizerPlan(c)) SetProp(coh, key, val);
                if (StabilizerHasMoveFade() == false)
                    log("OTD: note - the INSTALLED Coherence Stabilizer predates the moving-tap fade, so it ignores TapMoveFade (moving taps are still pinned) - " + StabilizerInstallHint + RestartHint);
                log(c.IsTapOnly ? "OTD: Coherence Stabilizer ON in tap-anchor-only mode (hold 0 = exact passthrough)"
                                : $"OTD: Coherence Stabilizer ON  hold {c.hold}  tap {c.tap}  lead {c.lead}");
            }
            else log("OTD: no aim filter (filterless build)");

            // ---- session 3: game personality filters from the declared plan ----
            bool gamePluginInstalled = File.Exists(GameFilterDll);
            foreach (var fs in p.filters ?? new List<FilterSpec>())
            {
                if (!fs.id.StartsWith("AimForge.Filters.", StringComparison.OrdinalIgnoreCase)) continue;
                if (!gamePluginInstalled)
                { if (fs.on) log($"OTD: plan filter {fs.id} SKIPPED - AimForge.Filters plugin not installed (build.ps1 installs it, then " + RestartHint + ")"); continue; }
                var gf = EnsureFilter(filters, fs.id, fs.id, fs.settings.Keys.ToArray());
                gf["Enable"] = fs.on;
                if (fs.on)
                {
                    foreach (var kv in fs.settings) SetProp(gf, kv.Key, kv.Value);
                    log($"OTD: {fs.id.Replace("AimForge.Filters.", "game filter ")} ON  " +
                        string.Join("  ", fs.settings.Where(kv => !kv.Key.StartsWith("Zone") && !kv.Key.EndsWith("UntilMmS")).Select(kv => kv.Key + " " + kv.Value)));
                }
            }

            // ---- Nib Twin (2026-09-24): FIRST in the chain, so the pin, the game filters and the curve see the hand without the skid ----
            var nibPts = NibPoints(rig);
            if (gamePluginInstalled && (rig.NibTwin || rig.NibProbe || FindFilter(filters, NibTwinId) != null))
            {
                var nt = EnsureFilter(filters, NibTwinId, NibTwinId, NibProps);
                filters.Remove(nt); filters.Insert(0, nt);
                nt["Enable"] = rig.NibTwin || rig.NibProbe;
                foreach (var kv in nibPts) SetProp(nt, kv.Key, kv.Value);
                if (rig.NibTwin) log($"OTD: Nib Twin ON  swing {Math.Sqrt(rig.SkidXmm * rig.SkidXmm + rig.SkidYmm * rig.SkidYmm):0.000} mm at {Math.Atan2(rig.SkidYmm, rig.SkidXmm) * 180 / Math.PI:0} deg, full press {rig.SkidFullPressure:0.000}, gamma {rig.SkidGamma:0.0}, lag {rig.SkidLagReports:0} (first in the chain)");
                else if (rig.NibProbe) log("OTD: Nib Twin press LOG on (calibration) - the twin itself is off");
            }
            else if (rig.NibTwin || rig.NibProbe) throw new InvalidOperationException("Nib Twin needs the AimForge Game Filters plugin (build.ps1 installs it) - refusing");

            // ---- Cadence Lock engine (2026-09-07): the curve in tablet space, LAST in the chain ----
            // the curve is converted only for a Cadence apply (a RawAccel-engine LUT may have any number of points)
            var cadencePts = rig.CadenceEngine ? CadencePoints(p, rig) : new Dictionary<string, double>();
            var cl = EnsureFilter(filters, CadenceId, CadenceId, CadenceProps);
            // re-append so it stays the LAST aim filter (game filters/stabilizer reason in raw mm)
            filters.Remove(cl); filters.Add(cl);
            cl["Enable"] = rig.CadenceEngine && gamePluginInstalled;
            foreach (var kv in cadencePts) SetProp(cl, kv.Key, kv.Value);
            if (rig.CadenceEngine && !gamePluginInstalled)
                throw new InvalidOperationException("Cadence Lock engine needs the AimForge.Filters plugin (build.ps1 installs it) - refusing, RawAccel would be flat with no curve anywhere");
            if (rig.CadenceEngine)
                log("OTD: Cadence Lock ON  " + (Experiments.Any(rig) ? "[" + Experiments.Describe(rig) + "] " : "") + "curve " + (cadencePts["ClassicAccel"] > 0
                        ? $"classic (driver formula, native) accel' {cadencePts["ClassicAccel"]:0.######}/mm/s  offset {cadencePts["ClassicOffset"]:0.##}mm/s  cap {cadencePts["ClassicCap"]:0.##}"
                        : string.Join(" ", Enumerable.Range(0, Filters.CadenceCore.MaxPoints)
                    .Where(i => cadencePts[$"P{i + 1}Speed"] > 0).Select(i => $"{cadencePts[$"P{i + 1}Speed"]:0.##}mm/s->{cadencePts[$"P{i + 1}Gain"]:0.###}")))
                    + (rig.ReportHz > 0 ? $"  (RawAccel flat; speed on the pen's {rig.ReportHz:0}Hz clock, merge cap {rig.MergeMax:0} reports)" : $"  (RawAccel flat; pen rate AUTO-estimated, merge cap {rig.MergeMax:0} reports)"));
            else log("OTD: Cadence Lock off (RawAccel engine)");

            LastPlanned = root;   // what this apply writes (a dry run stops here) - the selftests read the chain from it
            if (dryRun) { log("OTD: dry run, nothing written"); return true; }

            Directory.CreateDirectory(PresetsDir);
            string presetPath = Path.Combine(PresetsDir, PresetName + ".json");
            // the previous preset is the rollback target: the daemon's restart paths re-apply this file, so a failed apply
            // must not leave its build here (2026-09-16 review)
            string? prevPreset = File.Exists(presetPath) ? File.ReadAllText(presetPath) : null;
            File.WriteAllText(presetPath, Pretty(root), new UTF8Encoding(false));
            log($"OTD: wrote preset {presetPath}");
            bool Revert(bool daemonTouched)
            {
                try
                {
                    if (prevPreset != null) File.WriteAllText(presetPath, prevPreset, new UTF8Encoding(false)); else File.Delete(presetPath);
                    if (!daemonTouched) { log("OTD: rolled back the preset file (the daemon was not touched; nothing saved as default)"); return false; }
                    // 2026-10-11: with no previous preset the daemon used to keep the failed chain; its saved default is untouched
                    // (savedefaultsettings only runs after a verified apply), so that is what goes back live
                    if (prevPreset != null) Run($"applypreset {PresetName}", 8000);
                    else if (File.Exists(SettingsPath)) Run($"loadsettings \"{SettingsPath}\"", 8000);
                    double back = LiveDaemonPxMm();
                    log("OTD: rolled back to " + (prevPreset != null ? "the previous AimForge preset" : "the daemon's saved default") +
                        (back > 0 ? $" (daemon now {back} px/mm)" : " - the daemon did not answer, check it before playing") + " (nothing saved as default)");
                }
                catch (Exception ex) { log("OTD: could not restore the previous preset (" + ex.Message + ")"); }
                return false;
            }

            CloseUx(log);
            if (DaemonElevatedLockout() && !FixElevatedDaemon(log))
            { log("OTD: cannot reach the elevated daemon - fix the daemon and press Ctrl+Enter"); LastFailure = "cannot reach the elevated OTD daemon"; return Revert(false); }
            if (!EnsureDaemon(log)) { log("OTD: daemon unavailable - NOT applied"); LastFailure = "OTD daemon unavailable"; return Revert(false); }

            // applypreset is COMPLETELY SILENT - no output, exit 0 - whether or not it worked.
            // So: apply, then VERIFY against the daemon, then fall back to loadsettings, then
            // verify again. A mismatch is reported loudly instead of pretending success.
            var r = Run($"applypreset {PresetName}");
            double liveNow = LiveDaemonPxMm();
            bool okApply = r.ok && Math.Abs(liveNow - rig.PxMm) < 0.01, triedLoad = false;
            if (!okApply)
            {
                log($"OTD: applypreset did not take (daemon reports {liveNow} px/mm, wanted {rig.PxMm}) - falling back to loadsettings");
                triedLoad = true;
                Run($"loadsettings \"{presetPath}\"", 8000);
                liveNow = LiveDaemonPxMm();
                okApply = Math.Abs(liveNow - rig.PxMm) < 0.01;
            }
            if (okApply)
            {
                log($"OTD: applied and VERIFIED against the daemon ({liveNow} px/mm)");
                // 2026-09-09: the post-apply auto-detect added on 09-08 is REVERTED. The daemon
                // log showed every extra `detect` opening a new device stream and disposing one
                // ("A device stream was disposed." follows every re-scan but never the first),
                // and applying settings does not need a re-scan at all. Detect stays a manual,
                // user-initiated action (Ctrl+D) so a stream is never churned behind an apply.
                // Filter-plan read-back: getfilters prints every enabled filter with its live
                // property values, so the plan can be verified field-by-field like RawAccel.
                // Every key is read inside ITS filter's block (2026-09-24 review: Cadence Lock's 'Probe: 0' satisfied the
                // Nib Twin's Probe check).
                bool engineOk = true, nibOk = true, classicNoted = false; var missing = new List<string>(); string gfErr = "";
                bool ReadBack()
                {
                    var gf = Run("getfilters \"" + TabletName() + "\"", 5000);
                    engineOk = nibOk = true; missing = new List<string>();
                    if (!gf.ok) { gfErr = gf.output.Split('\n')[0]; return false; }
                    string B(string name) => FilterBlock(gf.output, name);
                    bool Has(string name) => gf.output.Contains(name);
                    // numbers are parsed whole (a digit-prefix of a stale value no longer passes: 'Hover_max: 87' is not 8)
                    if (rig.HdlEnabled && !Has("Hover Distance Limiter")) missing.Add("Hover Distance Limiter enabled");
                    if (!rig.HdlEnabled && Has("Hover Distance Limiter")) missing.Add("Hover Distance Limiter DISABLED");
                    if (rig.HdlEnabled && !ReadBackMatches(B("Hover Distance Limiter"), "Hover_max", rig.HdlMax)) missing.Add($"Hover_max {rig.HdlMax}");
                    if (rig.HdlEnabled && !ReadBackMatches(B("Hover Distance Limiter"), "Hover_min", rig.HdlMin)) missing.Add($"Hover_min {rig.HdlMin}");
                    if (p.cohOv is CohOv cv)
                    {
                        if (!Has("Coherence Stabilizer")) missing.Add("Coherence Stabilizer enabled");
                        // every property this apply writes (2026-10-11: TapAnchor, the tremor window, the coherence and rail keys were written but never read back)
                        foreach (var (key, val) in StabilizerPlan(cv))
                        {
                            if (key == "TapMoveFade" && StabilizerHasMoveFade() != true) continue;   // an echo of a key the plugin lacks proves nothing
                            if (!ReadBackMatches(B("Coherence Stabilizer"), key, val)) missing.Add($"{key} {val}");
                        }
                    }
                    else if (Has("Coherence Stabilizer")) missing.Add("Coherence Stabilizer DISABLED (filterless build)");
                    // game-filter plan entries: every authored property is part of the apply contract
                    foreach (var fs2 in p.filters ?? new List<FilterSpec>())
                    {
                        if (!fs2.id.StartsWith("AimForge.Filters.", StringComparison.OrdinalIgnoreCase)) continue;
                        if (!gamePluginInstalled) continue;
                        string disp = GameFilterNames.TryGetValue(fs2.id, out var nm) ? nm : fs2.id;   // this filter's own plugin name
                        if (fs2.on)
                        {
                            if (!Has(disp)) { missing.Add(fs2.id + " enabled"); continue; }
                            foreach (var kv in fs2.settings)
                                if (!ReadBackMatches(B(disp), kv.Key, kv.Value))
                                    missing.Add($"{fs2.id.Replace("AimForge.Filters.", "")}.{kv.Key} {kv.Value:0.###}");
                        }
                        else if (Has(disp)) missing.Add(fs2.id + " DISABLED");
                    }
                    // the Nib Twin is part of the apply contract like the engine: a wrong twin or a live press log fails it
                    if (rig.NibTwin || rig.NibProbe)
                    {
                        if (!Has("Nib Twin")) { missing.Add("Nib Twin enabled"); nibOk = false; }
                        else foreach (var kv in nibPts) if (!ReadBackMatches(B("Nib Twin"), kv.Key, kv.Value)) { missing.Add($"NibTwin.{kv.Key} {kv.Value:0.#####}"); nibOk = false; }
                    }
                    else if (Has("Nib Twin")) { missing.Add("Nib Twin DISABLED"); nibOk = false; }
                    if (rig.CadenceEngine)
                    {
                        if (!Has("Cadence Lock")) { missing.Add("Cadence Lock enabled"); engineOk = false; }
                        else
                        {
                            // an older plugin without native classic curves runs the 8-point fallback table: its Classic* keys are absent by design
                            bool nativeClassic = B("Cadence Lock").Contains("ClassicAccel");
                            foreach (var kv in cadencePts)
                                if (!(kv.Key.StartsWith("Classic") && !nativeClassic) && !ReadBackMatches(B("Cadence Lock"), kv.Key, kv.Value)) missing.Add($"CadenceLock.{kv.Key} {kv.Value:0.######}");
                            if (cadencePts["ClassicAccel"] > 0 && !B("Cadence Lock").Contains("ClassicAccel") && !classicNoted)
                            {
                                classicNoted = true;
                                log("OTD: the daemon is running an OLDER AimForge Game Filters build without native classic curves - Cadence Lock is using the 8-point fallback table (within ~2.3%). " + RestartHint + " to load v1.2, then apply again.");
                            }
                        }
                    }
                    else if (Has("Cadence Lock")) { missing.Add("Cadence Lock DISABLED (RawAccel engine)"); engineOk = false; }
                    return true;
                }
                bool readOk = ReadBack();
                // applypreset can be ignored silently while the px/mm is unchanged (the build before had the same px/mm), and
                // then the px/mm check above proves nothing: the chain read-back gets the loadsettings fallback too
                // (2026-09-24 review: an ignored calibration restore was reported as restored)
                if (readOk && missing.Count > 0 && !triedLoad)
                {
                    log("OTD: the filter chain does not match after applypreset - falling back to loadsettings");
                    Run($"loadsettings \"{presetPath}\"", 8000);
                    readOk = ReadBack();
                }
                if (!readOk) { readOk = ReadBack(); }   // one retry: the console can time out under load
                if (UxRunning())
                    log("OTD: note - while the GUI stays open it can still overwrite this at any time");
                // 2026-10-11: an apply is verified field by field or it is rolled back. An unreadable chain used to pass with the
                // engine unverified (and was saved as the default); a stabilizer or game-filter mismatch used to be saved as a
                // partial apply. Both now roll back both drivers.
                if (!readOk)
                {
                    log("OTD: filter read-back UNAVAILABLE (" + gfErr + ") - the engine cannot be verified, rolling back both drivers. " +
                        "Check the OTD daemon is running (tray > Restart OTD daemon) and apply again.");
                    LastFailure = "OTD filter read-back unavailable: " + gfErr;
                    return Revert(true);
                }
                if (missing.Count > 0)
                {
                    log("OTD: FILTER READ-BACK MISMATCH - daemon chain does not carry: " + string.Join(", ", missing) + ". If the stock OTD GUI is open, close it first.");
                    log(!engineOk ? "OTD: the curve's ENGINE is not where this apply put it - rolling back both drivers"
                      : !nibOk ? "OTD: the Nib Twin entry is not what this apply wrote - rolling back both drivers"
                      : "OTD: the filter chain is not what this apply wrote - rolling back both drivers");
                    LastFailure = (!engineOk ? "engine" : !nibOk ? "Nib Twin" : "filter chain") + " read-back mismatch: " + string.Join(", ", missing);
                    return Revert(true);
                }
                log("OTD: filter plan VERIFIED by read-back (" + (p.cohOv == null ? "HDL only" : "HDL + Coherence Stabilizer, properties match") + ")");
                // the calibration build (press log on) is never the daemon default: a crash while tapping cannot persist it
                if (rig.NibProbe) { log("OTD: calibration build - not saved as the daemon default"); return true; }
                // saved as the daemon default only once the engine is verified: a failed apply never persists
                Run("savedefaultsettings");
                log("OTD: saved as the daemon default");
                return true;
            }
            else
            {
                log($"OTD: APPLY FAILED VERIFICATION - daemon reports {liveNow} px/mm, wanted {rig.PxMm}. If the OTD GUI is open, close it and apply again.");
                LastFailure = $"OTD px/mm read back {liveNow}, wanted {rig.PxMm}";
                return Revert(true);
            }
        }

        /// Hover bounds the plugin will accept: a report passes only while
        /// Hover_min &lt;= HoverDistance &lt;= Hover_max (Hover Distance Limiter 0.1.3).
        public static bool HoverValid(double min, double max) => min >= 0 && max >= min && max <= 100;

        /// Apply pre-flight: the full apply refuses the same empty window the live hover path refuses (2026-09-16 review:
        /// contact-only plus any hover min > 1 wrote a window no report can pass).
        public static string? HoverBlocker(Rig rig)
            => rig.HdlEnabled && !HoverValid(rig.HdlMin, rig.HdlMax)
               ? $"hover window min {rig.HdlMin} / max {rig.HdlMax} lets no report through (0 <= min <= max <= 100) - nothing was written"
               : null;

        /// Live hover tweak. Writes ONLY the Hover Distance Limiter's own properties and
        /// re-applies. Deliberately does NOT touch RawAccel, the curve, or presets.json, and
        /// NEVER issues `detect` - a re-scan against a live device churns the stream and wedges
        /// the tablet (2026-09-09 field lesson). This is the path for dialling hover by feel:
        /// change, push, hover the pen, repeat.
        public bool SetHoverLive(Rig rig, Action<string> log)
        {
            if (!HoverValid(rig.HdlMin, rig.HdlMax))
            { log($"hover: refused - min {rig.HdlMin} / max {rig.HdlMax} is not a valid window (0 <= min <= max <= 100)"); return false; }

            var root = JsonNode.Parse(File.ReadAllText(SettingsPath))!.AsObject();
            var prof = root["Profiles"]![0]!.AsObject();
            var filters = prof["Filters"]!.AsArray();
            var hdl = EnsureFilter(filters, "Hover_Distance_Limiter", "Hover_Distance_Limiter.Hover_Distance_Limiter", new[] { "Hover_max", "Hover_min" });
            hdl["Enable"] = rig.HdlEnabled;
            SetProp(hdl, "Hover_max", rig.HdlMax);
            SetProp(hdl, "Hover_min", rig.HdlMin);

            Directory.CreateDirectory(PresetsDir);
            string presetPath = Path.Combine(PresetsDir, PresetName + ".json");
            File.WriteAllText(presetPath, Pretty(root), new UTF8Encoding(false));
            if (!EnsureDaemon(log)) { log("hover: daemon unavailable - the preset is saved, nothing applied"); return false; }
            Run($"applypreset {PresetName}");

            var gf = Run("getfilters \"" + TabletName() + "\"", 5000);
            bool ok = gf.ok && (rig.HdlEnabled
                ? ReadBackMatches(FilterBlock(gf.output, "Hover Distance Limiter"), "Hover_max", rig.HdlMax) && ReadBackMatches(FilterBlock(gf.output, "Hover Distance Limiter"), "Hover_min", rig.HdlMin)
                : !gf.output.Contains("Hover Distance Limiter"));
            if (ok)
            {
                Run("savedefaultsettings");
                log(rig.HdlEnabled
                    ? $"hover: LIVE - window {rig.HdlMin} to {rig.HdlMax} (verified by read-back; curve and RawAccel untouched)"
                    : "hover: Hover Distance Limiter OFF (verified by read-back)");
            }
            else log($"hover: pushed but read-back did not confirm min {rig.HdlMin} / max {rig.HdlMax} - press Apply (Ctrl+Enter)");
            return ok;
        }

        public const string CadenceId = "AimForge.Filters.CadenceLock";
        public const string NibTwinId = "AimForge.Filters.NibTwin";
        static readonly string[] NibProps = { "Twin", "SkidXmm", "SkidYmm", "SkidFullPressure", "SkidGamma", "SkidLagReports", "NominalHz", "Probe" };

        /// The Nib Twin filter's properties for a rig (all zero/default when neither the twin nor the calibration log is on).
        public static Dictionary<string, double> NibPoints(Rig rig) => new Dictionary<string, double>
        {
            ["Twin"] = rig.NibTwin ? 1 : 0, ["SkidXmm"] = rig.NibTwin ? Math.Round(rig.SkidXmm, 5) : 0, ["SkidYmm"] = rig.NibTwin ? Math.Round(rig.SkidYmm, 5) : 0,
            ["SkidFullPressure"] = rig.NibTwin ? Math.Round(rig.SkidFullPressure, 5) : 0.35, ["SkidGamma"] = rig.NibTwin ? Math.Round(rig.SkidGamma, 3) : 1,
            ["SkidLagReports"] = rig.NibTwin ? rig.SkidLagReports : 0, ["NominalHz"] = rig.ReportHz > 0 ? rig.ReportHz : 0, ["Probe"] = rig.NibProbe ? 1 : 0
        };

        /// Nib Twin pre-flight: the filter lives in the AimForge Game Filters plugin, which the RUNNING daemon must have loaded.
        public string? NibBlocker(Rig rig)
        {
            if (!rig.NibTwin && !rig.NibProbe) return null;
            if (!File.Exists(GameFilterDll)) return "Nib Twin needs the AimForge Game Filters plugin - run build.ps1, then " + RestartHint + "; nothing was written";
            if (PluginNewerThanDaemon() is DateTime b) return $"the AimForge Game Filters plugin was rebuilt at {b.ToLocalTime():HH:mm} after the OTD daemon started - {RestartHint} first; nothing was written";
            return null;
        }
        public string PresetPath => Path.Combine(PresetsDir, PresetName + ".json");

        /// Whether the AimForge preset FILE still carries the calibration press log (the daemon's restart paths re-apply it).
        public bool PresetHasNibProbe()
        {
            try
            {
                if (!File.Exists(PresetPath)) return false;
                var nt = FindFilter(JsonNode.Parse(File.ReadAllText(PresetPath))!["Profiles"]![0]!["Filters"]!.AsArray(), NibTwinId);
                return nt != null && nt["Enable"]?.GetValue<bool>() == true &&
                       (nt["Settings"]?.AsArray().FirstOrDefault(s => s!["Property"]!.GetValue<string>() == "Probe")?["Value"]?.GetValue<double>() ?? 0) >= 0.5;
            }
            catch { return false; }
        }

        /// A daemon restart re-applies the AimForge preset: never re-apply a press log left by an interrupted calibration
        /// (third review). The twin comes back as the last apply recorded it.
        void SanitizePresetProbe(Action<string> log)
        {
            if (!PresetHasNibProbe()) return;
            try
            {
                var root = JsonNode.Parse(File.ReadAllText(PresetPath))!.AsObject();
                var nt = FindFilter(root["Profiles"]![0]!["Filters"]!.AsArray(), NibTwinId)!;
                var rec = LastApply.Load()?.AppliedRig();
                if (rec != null) foreach (var kv in NibPoints(rec)) SetProp(nt, kv.Key, kv.Value);
                SetProp(nt, "Probe", 0);
                nt["Enable"] = rec?.NibTwin ?? false;
                File.WriteAllText(PresetPath, Pretty(root), new UTF8Encoding(false));
                log("OTD: the AimForge preset still had the calibration press log on - switched off before re-applying it");
            }
            catch (Exception ex) { log("OTD: could not clear the press log in the preset (" + ex.Message + ")"); }
        }
        public string? ReadPresetText() { try { return File.Exists(PresetPath) ? File.ReadAllText(PresetPath) : null; } catch { return null; } }

        /// Whether the RUNNING daemon has the Nib Twin press log on (getfilters); null = could not ask.
        public bool? DaemonHasNibProbe()
        {
            var gf = Run("getfilters \"" + TabletName() + "\"", 5000);
            return gf.ok ? ReadBackMatches(FilterBlock(gf.output, "Nib Twin"), "Probe", 1) : (bool?)null;
        }

        /// Puts a saved AimForge preset text back and, when the daemon runs the press log, re-applies it (never saved as the
        /// default: the default was not touched by the calibration build).
        public void PutPresetBack(string? text, Action<string> log)
        {
            try
            {
                if (text == null) return;
                File.WriteAllText(PresetPath, text, new UTF8Encoding(false));
                if (DaemonHasNibProbe() == true) { Run($"applypreset {PresetName}", 8000); log("nib: the previous AimForge preset is back in the daemon"); }
            }
            catch (Exception ex) { log("nib: could not put the previous preset back (" + ex.Message + ")"); }
        }

        /// The live Nib Twin entry (settings.json): enabled, twin on, press log on, and its values.
        public (bool enabled, bool twin, bool probe, Dictionary<string, double> vals) NibLive()
        {
            var vals = new Dictionary<string, double>();
            try
            {
                var root = JsonNode.Parse(File.ReadAllText(SettingsPath))!.AsObject();
                var nt = FindFilter(root["Profiles"]![0]!["Filters"]!.AsArray(), NibTwinId);
                if (nt == null) return (false, false, false, vals);
                foreach (var s in nt["Settings"]?.AsArray() ?? new JsonArray())
                    try { vals[s!["Property"]!.GetValue<string>()] = s["Value"]!.GetValue<double>(); } catch { }
                bool en = nt["Enable"]?.GetValue<bool>() == true;
                return (en, en && vals.GetValueOrDefault("Twin") >= 0.5, en && vals.GetValueOrDefault("Probe") >= 0.5, vals);
            }
            catch { return (false, false, false, vals); }
        }

        /// Turns the calibration press log OFF without a full apply: the AimForge preset with the Nib Twin entry at Probe 0
        /// (enabled only if the twin itself is on), applied and saved as the default. The calibration's fallback when its
        /// restore apply fails, and the forced-exit path (2026-09-24 review: several exits left the log live and saved).
        public bool NibProbeOff(Action<string> log, Rig? restore = null)
        {
            try
            {
                string presetPath = Path.Combine(PresetsDir, PresetName + ".json");
                bool changed = false;
                foreach (var file in new[] { presetPath, SettingsPath })
                {
                    if (!File.Exists(file)) continue;
                    var root = JsonNode.Parse(File.ReadAllText(file))!.AsObject();
                    var nt = FindFilter(root["Profiles"]![0]!["Filters"]!.AsArray(), NibTwinId);
                    if (nt == null) continue;
                    double? Get(string k) { try { return nt["Settings"]?.AsArray().FirstOrDefault(s => s!["Property"]!.GetValue<string>() == k)?["Value"]?.GetValue<double>(); } catch { return null; } }
                    if ((Get("Probe") ?? 0) < 0.5) continue;
                    // the user's own twin state when known (the calibration preset always has the twin off)
                    bool twinOn = restore != null ? restore.NibTwin : (Get("Twin") ?? 0) >= 0.5;
                    if (restore != null) foreach (var kv in NibPoints(restore)) SetProp(nt, kv.Key, kv.Value);
                    SetProp(nt, "Probe", 0);
                    nt["Enable"] = twinOn;
                    // the settings file is only the source when no AimForge preset exists; the daemon gets it via applypreset
                    if (file == presetPath || !File.Exists(presetPath))
                    {
                        Directory.CreateDirectory(PresetsDir);
                        File.WriteAllText(presetPath, Pretty(root), new UTF8Encoding(false)); changed = true;
                    }
                }
                if (!changed && !NibLive().probe) { log("nib: the press log is off"); return true; }
                if (!EnsureDaemon(log)) { log("nib: daemon unavailable - the press log may still be ON; apply your card again"); return false; }
                Run($"applypreset {PresetName}", 8000);
                var gf = Run("getfilters \"" + TabletName() + "\"", 5000);
                bool ok = gf.ok && !ReadBackMatches(FilterBlock(gf.output, "Nib Twin"), "Probe", 1);
                if (ok) { Run("savedefaultsettings"); log("nib: press log OFF (verified by read-back, saved as the daemon default)"); }
                else log("nib: could not confirm the press log is off - apply your card again");
                return ok;
            }
            catch (Exception ex) { log("nib: could not switch the press log off (" + ex.Message + ") - apply your card again"); return false; }
        }

        static readonly string[] CadenceProps = new[] { "NominalHz", "MergeMaxReports", "Probe", "ClassicAccel", "ClassicOffset", "ClassicCap", "ClassicExp", "IntentSpeed", "IntentTauMs", "ReversalCarryMs" }
            .Concat(Enumerable.Range(1, Filters.CadenceCore.MaxPoints).SelectMany(i => new[] { $"P{i}Speed", $"P{i}Gain" })).ToArray();

        /// The build's curve as Cadence Lock properties: the exact LUT (classic cards convert
        /// exactly - Curve.EffectiveLut), in mm/s, at most 8 points. Unused slots are 0/1.
        public static Dictionary<string, double> CadencePoints(Preset p, Rig rig)
        {
            var d = new Dictionary<string, double> { ["NominalHz"] = rig.ReportHz, ["MergeMaxReports"] = rig.MergeMax, ["Probe"] = rig.ReportHz > 0 ? 0 : 1,
                ["IntentSpeed"] = rig.IntentSpeed ? 1 : 0, ["IntentTauMs"] = 6, ["ReversalCarryMs"] = rig.ReversalCarryMs };
            if (!p.IsLut)
            {
                // classic cards: the driver's formula, natively and exactly (plugin v1.2+). The P slots
                // carry an 8-point sample of the SAME formula as a fallback for an OLDER plugin still
                // loaded in the daemon - it ignores the Classic props and would otherwise run FLAT
                // (review 2026-09-14). A v1.2 plugin gives the Classic props precedence and ignores the slots.
                double k = rig.PxMm / 1000.0, a = p.adv.accel ?? 0, off = p.adv.offset ?? 0, cap = p.adv.cap ?? 1;
                d["ClassicAccel"] = Math.Round(a * k, 9);
                d["ClassicOffset"] = Math.Round(off / k, 6);
                d["ClassicCap"] = cap;
                d["ClassicExp"] = 2;
                var fb = ClassicFallback8(a, off, cap, k);
                for (int i = 0; i < Filters.CadenceCore.MaxPoints; i++)
                {
                    d[$"P{i + 1}Speed"] = i < fb.Length ? Math.Round(fb[i][0], 3) : 0;
                    d[$"P{i + 1}Gain"] = i < fb.Length ? Math.Round(fb[i][1], 4) : 1;
                }
                return d;
            }
            var lut = p.lut!;
            if (lut.Length > Filters.CadenceCore.MaxPoints) throw new InvalidOperationException($"{p.id}: {lut.Length} LUT points; Cadence Lock carries at most {Filters.CadenceCore.MaxPoints}");
            d["ClassicAccel"] = 0; d["ClassicOffset"] = 0; d["ClassicCap"] = 1; d["ClassicExp"] = 2;
            for (int i = 0; i < Filters.CadenceCore.MaxPoints; i++)
            {
                d[$"P{i + 1}Speed"] = i < lut.Length ? Math.Round(lut[i][0], 3) : 0;
                d[$"P{i + 1}Gain"] = i < lut.Length ? Math.Round(lut[i][1], 4) : 1;
            }
            return d;
        }

        /// 8 (mm/s, gain) points on the driver's classic formula: floor anchor, offset, 5 log-spaced
        /// ramp samples, then the cap (or 1450 mm/s when the cap is never reached). Worst error vs the
        /// formula ~1% just above the offset; never flat.
        static double[][] ClassicFallback8(double a, double off, double cap, double k)
        {
            if (a <= 0 || cap <= 1) return new[] { new[] { 0.01, 1.0 }, new[] { 1450.0, 1.0 } };
            double offMms = Math.Max(off / k, 0.02);
            double capMms = Curve.ClassicCapSpeedCms(a, off, cap) / k;
            double hi = Math.Min(capMms, 1450.0);
            var o = new List<double[]> { new[] { 0.01, 1.0 }, new[] { offMms, 1.0 } };
            for (int i = 1; i <= 5; i++) { double s = offMms * Math.Pow(hi / offMms, i / 6.0); o.Add(new[] { s, Curve.ClassicGain(s * k, a, off, cap) }); }
            o.Add(capMms < 1450.0 ? new[] { capMms, cap } : new[] { 1450.0, Curve.ClassicGain(1450.0 * k, a, off, cap) });
            return o.ToArray();
        }

        /// Numeric read-back match against getfilters' "{ Key: value }" text: parses the printed
        /// number and compares with a relative tolerance, so a value the daemon prints with more
        /// digits than AimForge rounded to (ClassicAccel 0.014022) still verifies.
        /// One filter's part of the getfilters text. The console prints
        ///     Filters: 'Hover Distance Limiter: { Hover_min: 0 }, { Hover_max: 87 }, ...', 'AimForge Cadence Lock (...): { ... }'
        /// so a filter runs from its name to the closing quote. Empty when the filter is not listed.
        public static string FilterBlock(string output, string name)
        {
            int i = output.IndexOf(name, StringComparison.Ordinal);
            if (i < 0) return "";
            int end = output.IndexOf('\'', i);
            return end < 0 ? output.Substring(i) : output.Substring(i, end - i);
        }

        public static bool ReadBackMatches(string output, string key, double want)
        {
            // every occurrence of the key (a property name can repeat across filters, e.g. RailStrength); the whole
            // number is parsed, so a digit-prefix of another value never matches
            foreach (System.Text.RegularExpressions.Match m in System.Text.RegularExpressions.Regex.Matches(output, @"(?<![A-Za-z0-9_])" + System.Text.RegularExpressions.Regex.Escape(key) + @":\s*(-?[0-9]+(?:\.[0-9]+)?(?:[eE][-+]?[0-9]+)?)"))
                if (double.TryParse(m.Groups[1].Value, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var got) &&
                    Math.Abs(got - want) <= Math.Max(1e-6, 1e-6 * Math.Abs(want))) return true;
            return false;
        }

        /// Loads the Cadence Lock curve into a core exactly as the daemon would (selftest path).
        public static Filters.CadenceCore CadenceCoreFor(Preset p, Rig rig)
        {
            var c = new Filters.CadenceCore(); var d = CadencePoints(p, rig);
            for (int i = 0; i < Filters.CadenceCore.MaxPoints; i++) { c.Vs[i] = d[$"P{i + 1}Speed"]; c.Gs[i] = d[$"P{i + 1}Gain"]; }
            c.NominalHz = d["NominalHz"]; c.MergeMaxReports = d["MergeMaxReports"];
            c.ClassicAccel = d["ClassicAccel"]; c.ClassicOffset = d["ClassicOffset"]; c.ClassicCap = d["ClassicCap"]; c.ClassicExp = d["ClassicExp"];
            c.IntentSpeed = d["IntentSpeed"]; c.IntentTauMs = d["IntentTauMs"]; c.ReversalCarryMs = d["ReversalCarryMs"];
            return c;
        }

        static string Pretty(JsonNode node)
        {
            // JsonNode.ToJsonString(options) demands a TypeInfoResolver on .NET 8 when the tree holds
            // CLR-typed values; writing through Utf8JsonWriter directly sidesteps that entirely.
            using var ms = new System.IO.MemoryStream();
            using (var w = new System.Text.Json.Utf8JsonWriter(ms, new System.Text.Json.JsonWriterOptions { Indented = true }))
                node.WriteTo(w);
            return Encoding.UTF8.GetString(ms.ToArray());
        }
    }
}
