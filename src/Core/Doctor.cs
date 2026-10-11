using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;

namespace AimForge.Core
{
    /// <summary>
    /// Health checks the user can read at a glance. Signature verification is real WinVerifyTrust,
    /// not a file-exists guess, because the whole anti-cheat argument rests on the drivers staying
    /// the stock WHQL-signed binaries.
    /// </summary>
    public static class Doctor
    {
        /// One row. Ok = false is a FAIL; Ok with Warn is a WARN (works, but needs attention). Fix is the one action that
        /// clears the row, so the window can show it without a terminal (2026-10-11).
        public sealed class Item
        {
            public string Name = "", Detail = "", Fix = ""; public bool Ok, Warn;
            public string Level => !Ok ? "FAIL" : Warn ? "WARN" : "OK";
            public override string ToString() => Level.PadRight(5) + Name + (Detail.Length > 0 ? " - " + Detail : "") + (Fix.Length > 0 && Level != "OK" ? "\n      fix: " + Fix : "");
        }

        /// A Nib Twin calibration older than this gets a WARN. A REMINDER, not a measurement: nib wear has never been
        /// measured on this rig (field verdict pending) - recalibrate after a nib change whatever the age.
        public const int CalibrationReminderDays = 30;

        /// Age of a calibration in days (null when the stamp is unreadable).
        public static double? CalibrationAgeDays(NibCal cal, DateTime now) =>
            DateTime.TryParseExact(cal.CalibratedAt, "yyyy-MM-dd HH:mm", System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var at)
                ? (now - at).TotalDays : null;

        /// First-party filters enabled in the saved settings that the daemon's getfilters does not print: the plugin file
        /// exists but the running daemon did not load it (file-exists alone was the old check). Same evidence the apply's
        /// engine read-back rests on: getfilters prints every enabled filter it constructed.
        public static List<string> NotLoaded(IEnumerable<string> enabledPaths, string getfiltersOutput) =>
            enabledPaths.Select(p => (p, n: OtdBridge.LiveName(p))).Where(x => x.n != null && !getfiltersOutput.Contains(x.n!)).Select(x => x.n!).Distinct().ToList();

        /// What the pen tip is bound to in OTD (read-only). OTD's own "Mouse Button Binding" and "Key Binding" press through
        /// Windows SendInput (OpenTabletDriver v0.6.4.0 source: WindowsVirtualKeyboard / the desktop mouse binding), which
        /// Vanguard blocks (OTD FAQ, Windows app-specific); a VMulti plugin binding clicks through the VMulti HID device.
        public enum TipKind { Unknown, None, SendInputMouse, SendInputKey, VMulti, Other }
        public static (TipKind kind, string text) TipBinding(System.Text.Json.Nodes.JsonObject settingsRoot)
        {
            try
            {
                var tb = settingsRoot["Profiles"]?[0]?["Bindings"]?["TipButton"] as System.Text.Json.Nodes.JsonObject;
                if (tb == null) return (TipKind.None, "no tip binding");
                string path = tb["Path"]?.GetValue<string>() ?? "";
                string val = string.Join(" ", (tb["Settings"] as System.Text.Json.Nodes.JsonArray ?? new()).Select(x => x?["Value"]?.ToString() ?? ""));
                if (tb["Enable"]?.GetValue<bool>() == false || path.Length == 0) return (TipKind.None, "tip binding disabled");
                if (path.Contains("VMulti", StringComparison.OrdinalIgnoreCase)) return (TipKind.VMulti, $"VMulti binding ({val})");
                if (path == "OpenTabletDriver.Desktop.Binding.MouseBinding") return (TipKind.SendInputMouse, $"OTD mouse button binding ({val})");
                if (path.EndsWith("KeyBinding")) return (TipKind.SendInputKey, $"OTD key binding ({val})");
                return (TipKind.Other, path + (val.Length > 0 ? $" ({val})" : ""));
            }
            catch { return (TipKind.Unknown, "could not read the tip binding"); }
        }

        /// The Vanguard row for a Valorant build: the tip must click through VMulti, and two documented Vanguard restrictions
        /// apply whatever the binding (OTD FAQ): the first mouse-type device it sees is the only one it accepts, and left
        /// clicks can drop while keyboard keys are held.
        public static Item VanguardRow(TipKind kind, string text)
        {
            const string rules = "Vanguard accepts only the FIRST mouse it sees after launch (touch the pen before the mouse), and can drop left clicks while keys are held (OTD FAQ) - if taps vanish while you strafe, add a keyboard Fire bind in Valorant and press it with the left hand";
            bool sendInput = kind is TipKind.SendInputMouse or TipKind.SendInputKey;
            return new Item
            {
                Name = "Valorant: pen tip clicks under Vanguard", Ok = !sendInput, Warn = !sendInput,
                Detail = (sendInput ? "the tip is an " + text + ", which presses through SendInput - Vanguard blocks it, so taps may not fire in Valorant. "
                                    : "tip: " + text + ". ") + rules,
                Fix = sendInput ? "in OpenTabletDriver set the tip to the VMulti plugin's button binding (VoiDPlugins VMultiMode), then apply" : "",
            };
        }

        /// The fix for a row that is not OK, by row name - one table, so every row has an action.
        static readonly (string name, string fix)[] FixTable =
        {
            ("RawAccel installed", "install RawAccel to the folder in aimforge.config.json (default D:\\RawAccel)"),
            ("rawaccel service", "reboot once after installing RawAccel; its driver loads at boot"),
            ("signature", "reinstall the official driver package - AimForge never modifies drivers"),
            ("OpenTabletDriver installed", "install OpenTabletDriver to the folder in aimforge.config.json (default D:\\Pen)"),
            ("OTD daemon running", "press Apply - AimForge starts the daemon"),
            ("Coherence Stabilizer plugin", "run CoherenceStabilizer\\build.ps1 -Install, then " + OtdBridge.RestartHint),
            ("stabilizer has the moving-tap fade", OtdBridge.StabilizerInstallHint + OtdBridge.RestartHint),
            ("AimForge Game Filters plugin", "run build.ps1 (it installs the plugin), then " + OtdBridge.RestartHint),
            ("plugins loaded by the daemon", OtdBridge.RestartHint + ", then apply again"),
            ("pen device config", "open RawAccel's GUI > Devices, reset the pen/VMulti entry to defaults, close the GUI, apply again"),
            ("daemon pipe reachable", "press Ctrl+D (redetect) - it replaces the elevated daemon"),
            ("tablet connected", "plug in / power on the tablet, then Ctrl+D"),
            ("no interpolator", "disable the interpolator in OTD; apply again"),
            ("filter conflict", "apply the card again - its plan replaces the conflicting chain"),
            ("engine pairing", "apply the card again (Ctrl+Enter) - the apply writes both drivers together"),
            ("mouse mirror", "apply again; turn the mirror off in Modes if you no longer want it"),
            ("no dangling RawAccel profile refs", "open RawAccel's GUI > Devices, point the listed devices at an existing profile, then apply again"),
            ("experimental modes", "apply again; untick the mode in Modes if it keeps failing"),
            ("nib press log off", "apply your card again - the press log is switched off by every normal apply"),
            ("nib twin calibration", "run 'calibrate nib' (20 taps), then apply"),
            ("live tier within the card's role", "close any tool that added filters, then apply the card again"),
            ("live = last apply", "apply your card again (Ctrl+Enter), or close the tool that changed the drivers"),
            ("RawAccel GUI not running", "close the RawAccel GUI before applying"),
            ("OTD GUI not running", "close the OpenTabletDriver GUI - AimForge replaces it"),
            ("not running elevated", "start AimForge without 'Run as administrator'"),
        };

        internal static List<Item> WithFixes(List<Item> o)
        {
            foreach (var i in o)
                if (i.Level != "OK" && i.Fix.Length == 0)
                    // a row that could not be checked is not the fault the row names: its fix is to make it checkable
                    i.Fix = i.Detail.Contains("UNVERIFIED") || i.Detail.StartsWith("could not")
                        ? "check the driver is installed where aimforge.config.json points, then run the Doctor again"
                        : FixTable.FirstOrDefault(f => i.Name.Contains(f.name)).fix ?? "";
            return o;
        }

        public static List<Item> Run(RawAccelBridge ra, OtdBridge otd, Catalogue? roster = null) => WithFixes(RunChecks(ra, otd, roster));

        static List<Item> RunChecks(RawAccelBridge ra, OtdBridge otd, Catalogue? roster)
        {
            var o = new List<Item>();
            o.Add(new Item { Name = "RawAccel installed", Ok = ra.Installed, Detail = ra.Dir });
            o.Add(new Item { Name = "rawaccel service", Ok = ServiceRunning("rawaccel"), Detail = "kernel filter driver" });
            string sys = Path.Combine(ra.Dir, "driver", "rawaccel.sys");
            o.Add(Sig("rawaccel.sys signature", sys));
            o.Add(new Item { Name = "OpenTabletDriver installed", Ok = otd.Installed, Detail = otd.Dir });
            o.Add(new Item { Name = "OTD daemon running", Ok = otd.DaemonRunning(), Detail = otd.DaemonRunning() ? "user-mode, does the filtering" : "not running - AimForge starts it on apply" });
            string vm = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "drivers", "vmulti.sys");
            o.Add(Sig("vmulti.sys signature", vm));
            string plug = Path.Combine(otd.DataDir, "Plugins", "Coherence Stabilizer", "CoherenceStabilizer.dll");
            int nCoh = roster?.presets.FindAll(p => p.cohOv != null).Count ?? 0, nTap = roster?.presets.FindAll(p => p.cohOv?.IsTapOnly == true).Count ?? 0;
            o.Add(new Item { Name = "Coherence Stabilizer plugin", Ok = File.Exists(plug), Detail = File.Exists(plug)
                ? (roster == null ? "installed" : $"used by the {nCoh} cards that ship it ({nTap} tap-anchor-only, {nCoh - nTap} with hold/lead)")
                : (roster == null ? "MISSING" : $"MISSING - needed by {nCoh} of {roster.presets.Count} cards; those apply without their stabilizer") });
            // the installed build must HAVE the moving-tap fade: getfilters echoes a property the plugin ignores (2026-09-24 review)
            if (File.Exists(plug))
            {
                var fade = otd.StabilizerHasMoveFade();
                o.Add(new Item { Name = "stabilizer has the moving-tap fade", Ok = fade == true,
                    Detail = fade == true ? "TapMoveFade present in the installed build"
                           : fade == false ? "the installed build predates it (moving taps are still pinned and over-priced by the curve) - " + OtdBridge.StabilizerInstallHint + OtdBridge.RestartHint
                           : "could not read the installed build - UNVERIFIED" });
            }
            var gfStale = otd.PluginNewerThanDaemon(); var stStale = otd.PluginNewerThanDaemon(otd.StabilizerDll); var dStart = otd.DaemonStartUtc();
            o.Add(new Item { Name = "AimForge Game Filters plugin", Ok = File.Exists(otd.GameFilterDll),
                Detail = !File.Exists(otd.GameFilterDll) ? "MISSING - game filters are skipped on apply and the Cadence Lock engine is refused; build.ps1 installs it, then " + OtdBridge.RestartHint
                       : gfStale != null ? "installed, but NOT yet loaded by the running daemon (see below)" : "game personalities + the Cadence Lock engine are available" });
            // a plugin rebuilt after the daemon started is NOT what it runs (2026-09-24: the Doctor was green while the
            // daemon ran the previous build and every Cadence apply was refused)
            if (gfStale != null || stStale != null)
                o.Add(new Item { Name = "plugins loaded by the daemon", Ok = false,
                    Detail = string.Join("; ", new[] { gfStale is DateTime g ? $"Game Filters built {g.ToLocalTime():MM-dd HH:mm}" : null, stStale is DateTime st ? $"Coherence Stabilizer built {st.ToLocalTime():MM-dd HH:mm}" : null }.Where(x => x != null)) +
                             $" - the daemon started {dStart?.ToLocalTime():MM-dd HH:mm} and still runs the previous build" + (gfStale != null ? "; Cadence Lock applies are refused until you " : "; ") + OtdBridge.RestartHint });
            else if (dStart != null)
                o.Add(new Item { Name = "plugins loaded by the daemon", Ok = true, Detail = $"daemon started {dStart.Value.ToLocalTime():MM-dd HH:mm}, after both installed builds" });
            if (!ra.SettingsReadable(out var raReadErr))
                o.Add(new Item { Name = "pen device config (RawAccel)", Ok = false, Detail = "could not read RawAccel settings.json (" + raReadErr + ") - UNVERIFIED" });
            else
            {
                string? penCfg = ra.PenDeviceBlocker();
                o.Add(new Item { Name = "pen device config (RawAccel)", Ok = penCfg == null, Detail = penCfg ?? "defaultDeviceConfig enabled, DPI 0, no constant-time, automatic polling" });
            }
            if (otd.DaemonRunning())
            {
                if (otd.DaemonElevatedLockout())
                    o.Add(new Item { Name = "daemon pipe reachable", Ok = false, Detail = "daemon is running ELEVATED - applies are silently locked out; use redetect (Ctrl+D) to replace it" });
                else
                {
                    o.Add(new Item { Name = "daemon pipe reachable", Ok = true, Detail = "non-elevated, same session" });
                    var r = otd.Run("getfilters \"" + otd.TabletName() + "\"", 4000);
                    // getfilters answers from the saved profile even with the tablet unplugged: presence comes from Windows
                    bool present = otd.TabletDevicePresent();
                    o.Add(new Item { Name = "tablet connected", Ok = present && r.ok && !r.output.Contains("not found", StringComparison.OrdinalIgnoreCase),
                        Detail = present ? otd.TabletName() + " (USB device present)" : "Windows sees NO " + otd.TabletName() + " USB device - plug it in / power it on; the pen is dead until then" });
                    if (r.ok)
                    {
                        // 2026-10-11: ask the DAEMON, not the disk - an enabled first-party filter it does not print was not loaded
                        try
                        {
                            var enabled = FilterCatalog.Discover(otd).Where(f => f.EnabledLive).Select(f => f.Path).ToList();
                            var nl = NotLoaded(enabled, r.output);
                            o.Add(new Item { Name = "plugins loaded by the daemon (live chain)", Ok = nl.Count == 0,
                                Detail = nl.Count == 0 ? "every first-party filter enabled in the settings is running in the daemon"
                                                       : "enabled in the settings but NOT running in the daemon: " + string.Join(", ", nl) + " - the plugin did not load" });
                        }
                        catch (Exception e) { o.Add(new Item { Name = "plugins loaded by the daemon (live chain)", Ok = true, Warn = true, Detail = "could not compare (" + e.Message + ") - UNVERIFIED" }); }
                    }
                }
            }
            // ---- filter pipeline health (doctor v2): the live chain, its tiers, its conflicts ----
            try
            {
                var cat = FilterCatalog.Discover(otd);
                var on = cat.FindAll(f => f.EnabledLive);
                o.Add(new Item
                {
                    Name = "live filter chain",
                    Ok = true,
                    Detail = on.Count == 0 ? "none enabled" : string.Join(" + ", on.ConvertAll(f => f.Display + " [" + f.LiveTier + "]"))
                });
                bool interp = on.Exists(f => f.LiveTier == "T4");
                o.Add(new Item { Name = "no interpolator (T4) live", Ok = !interp,
                    Detail = interp ? "an interpolator is enabled - every field glitch in this project traced to this class" : "good - raw reports reach RawAccel" });
                var conflicts = FilterCatalog.Conflicts(cat);
                if (conflicts.Count > 0)
                    foreach (var c in conflicts) o.Add(new Item { Name = "filter conflict", Ok = false, Detail = c });
                else
                    o.Add(new Item { Name = "no filter conflicts", Ok = true, Detail = "no stacked antichatter, no interpolator over the stabilizer" });
                // engine pairing: exactly ONE place may run the curve
                bool cadOn = on.Exists(f => f.Path.Contains(OtdBridge.CadenceId));
                bool? raFlat = null; string raErr = "", otdErr = "";
                try { raFlat = ra.ReadLive().Flat; } catch (Exception ex) { raErr = ex.Message; }
                try { System.Text.Json.Nodes.JsonNode.Parse(File.ReadAllText(otd.SettingsPath)); } catch (Exception ex) { otdErr = ex.Message; }
                if (otdErr.Length > 0)
                    o.Add(new Item { Name = "engine pairing", Ok = false, Detail = "could not read OTD settings.json (" + otdErr + ") - pairing and the live chain above are UNVERIFIED" });
                else if (raFlat == null)
                    o.Add(new Item { Name = "engine pairing", Ok = false, Detail = "could not read RawAccel settings.json (" + raErr + ") - pairing UNVERIFIED" });
                else if (cadOn && raFlat == false)
                    o.Add(new Item { Name = "engine pairing", Ok = false, Detail = "Cadence Lock is ON and RawAccel still carries a curve - DOUBLE ACCELERATION; re-apply the build" });
                else if (!cadOn && raFlat == true)
                    o.Add(new Item { Name = "engine pairing", Ok = false, Detail = "RawAccel is flat (noaccel) and Cadence Lock is off - no curve anywhere; re-apply the build" });
                else
                    o.Add(new Item { Name = "engine pairing", Ok = true, Detail = cadOn ? "Cadence Lock engine: curve in tablet space on the pen's clock, RawAccel flat" : "RawAccel engine: curve in the driver from arrival-time dt" });
                // ---- mouse mirror (2026-09-14): the mouse must carry a curve regardless of the pen engine ----
                try
                {
                    var mroot = ra.ReadRoot(); var ml = MouseMirror.Read(mroot); var ms = MouseMirror.State.Load();
                    if (ms.On)
                    {
                        bool okPair = ml.Exists && ml.IsLast && ml.Mode != "noaccel" && ml.ModeV != "noaccel" && ml.Bound.Count > 0;
                        o.Add(new Item { Name = "mouse mirror pairing", Ok = okPair,
                            Detail = okPair ? $"'{MouseMirror.Reserved}' live ({ml.Mode}), bound: {string.Join(", ", ml.Bound)}"
                                   : !ml.Exists ? "mode is ON but the mouse profile is missing - apply again"
                                   : ml.Bound.Count == 0 ? "mouse profile exists but no device is bound to it - apply again"
                                   : "mouse profile is flat or not last - apply again" });
                        var x = MouseMirror.Numbers(ms.LastPxMm > 0 ? ms.LastPxMm : 57, ms.LastMult > 0 ? ms.LastMult : 1, ms.Dpi);
                        double penDpi = ra.ReadLive().OutputDpi;
                        // compare each profile with what its OWN build writes (the pen rounds Output DPI to 0.1, the mouse to 1e-4)
                        bool cons = ml.Exists && Math.Abs(ml.OutputDpi - x.OutputDpi) < 1e-6 && Math.Abs(penDpi - Math.Round(1000.0 * (ms.LastMult > 0 ? ms.LastMult : 1), 1)) < 1e-6 &&
                                    Math.Abs(ml.HalfIn - ms.HalfLifeMs) < 1e-9 && ml.HalfScale == 0 && ml.HalfOut == 0;
                        o.Add(new Item { Name = "mouse mirror consistency", Ok = cons,
                            Detail = cons ? $"mouse Output DPI {ml.OutputDpi} x r {x.R:0.0000} = pen {penDpi}; speed EMA {ml.HalfIn} ms (card {ms.LastCardId})"
                                          : "the mouse profile no longer matches the pen (px/mm, multiplier, DPI or EMA changed since) - apply again" });
                    }
                    else
                    {
                        bool offOk = !ml.Exists && ml.Bound.Count == 0;
                        o.Add(new Item { Name = "mouse mirror off", Ok = offOk, Detail = offOk ? "no mouse profile; the mouse runs raw" : "mode is OFF but a mouse profile or binding is still live - apply again to remove it" });
                    }
                    o.Add(new Item { Name = "no dangling RawAccel profile refs", Ok = ml.Dangling.Count == 0,
                        Detail = ml.Dangling.Count == 0 ? $"{ml.ProfileCount} profile(s); every device entry names one that exists" : string.Join("; ", ml.Dangling) });
                }
                catch (Exception e) { o.Add(new Item { Name = "mouse mirror", Ok = false, Detail = e.Message }); }
                var xps = Experiments.State.Load(); var (xok, xdet) = Experiments.LiveCheck(otd.SettingsPath, xps);
                o.Add(new Item { Name = "experimental modes (Intent Speed / Reversal Carry / Nib Twin)", Ok = xok, Detail = xdet + " - field verdicts pending" });
                // the calibration press log must never stay on outside a calibration (it writes a file after every tap). The
                // calibration build is never saved as the default, so ask the DAEMON and the preset file too (third review).
                var nl = otd.NibLive(); bool? dProbe = otd.DaemonRunning() ? otd.DaemonHasNibProbe() : null; bool pProbe = otd.PresetHasNibProbe();
                bool probeOn = nl.probe || dProbe == true || pProbe;
                o.Add(new Item { Name = "nib press log off", Ok = !probeOn,
                    Detail = probeOn ? "the Nib Twin press LOG is still on (" + string.Join(", ", new[] { dProbe == true ? "running in the daemon" : null, pProbe ? "in the AimForge preset" : null, nl.probe ? "saved as the default" : null }.Where(x => x != null)) +
                                       ") - a calibration did not finish; apply your card again"
                                     : dProbe == null ? "off in the saved settings and the preset (daemon not asked)" : "off in the daemon, the preset and the saved settings" });
                var cal = NibCal.Load();
                if (xps.Twin || cal != null)
                {
                    string? bad = cal == null ? "no calibration (run 'calibrate nib')" : cal.Invalid();
                    double? age = cal == null ? null : CalibrationAgeDays(cal, DateTime.Now);
                    bool old = age > CalibrationReminderDays, spread = cal != null && cal.PerTapMagSpreadPct > 35;
                    o.Add(new Item { Name = "nib twin calibration", Ok = bad == null || !xps.Twin, Warn = old || spread,
                        Detail = cal == null ? bad! : $"{cal.MagMm:0.000} mm at {cal.AngleDeg:0} deg, R2 {cal.R2:0.00}, {cal.Taps} taps, {cal.CalibratedAt}" + (age is double d ? $" ({d:0} days ago)" : "") + (bad != null ? " - REFUSED: " + bad : "") +
                                 (spread ? $" - per-tap spread {cal.PerTapMagSpreadPct:0}% is high" : "") + (old ? $" - older than the {CalibrationReminderDays}-day reminder (a convention, not a measured wear rate)" : ""),
                        Fix = old || spread ? "run 'calibrate nib' again (20 taps) - also after any nib change" : "" });
                }
                // the live chain's tier against the role of the card last applied
                try
                {
                    var la = LastApply.Load();
                    // the applied build itself when recorded (an Advanced/imported build's id is not in the roster)
                    var lastCard = la?.Card ?? (la != null && roster != null ? roster.Find(la.CardId) : null);
                    if (lastCard != null)
                    {
                        int liveTier = on.Count == 0 ? 0 : on.Max(f => f.LiveTier.Length > 1 && char.IsDigit(f.LiveTier[1]) ? f.LiveTier[1] - '0' : 0);
                        string role = RolePolicy.RoleOf(lastCard); int max = RolePolicy.MaxTier(role);
                        o.Add(new Item { Name = "live tier within the card's role", Ok = liveTier <= max, Detail = $"live chain T{liveTier}, last card {lastCard.name} ({role}, max T{max})" });
                    }
                    // 2026-10-11: the tip binding under Vanguard, for a live Valorant build (research: OTD FAQ + OTD source)
                    if (lastCard?.game == "valorant")
                    {
                        var tk = TipBinding(System.Text.Json.Nodes.JsonNode.Parse(File.ReadAllText(otd.SettingsPath))!.AsObject());
                        o.Add(VanguardRow(tk.kind, tk.text));
                    }
                    if (la != null)
                    {
                        var drift = la.Drift(otd.SettingsPath, ra.ReadLive(), ra.ReadRoot());
                        o.Add(new Item { Name = "live = last apply", Ok = drift.Count == 0,
                            Detail = drift.Count == 0 ? $"{la.CardName} ({la.Engine}, {la.At}) is still what both drivers carry" : "changed since the last apply of " + la.CardName + ": " + string.Join("; ", drift.Take(8)) });
                    }
                }
                catch (Exception e) { o.Add(new Item { Name = "live = last apply", Ok = false, Detail = "could not compare (" + e.Message + ")" }); }
                bool raGui = false; try { raGui = Process.GetProcessesByName("rawaccel").Length > 0; } catch { }
                o.Add(new Item { Name = "RawAccel GUI not running", Ok = !raGui, Detail = raGui ? "its Apply rewrites settings.json from its own in-memory copy - close it before applying from AimForge" : "good - nothing can stomp an apply" });
                int installed = cat.FindAll(f => f.Installed).Count;
                o.Add(new Item { Name = "filter catalog", Ok = true, Detail = installed + " filters discovered (" + cat.FindAll(f => f.Registered).Count + " registered in the live profile)" });
            }
            catch (Exception e) { o.Add(new Item { Name = "filter catalog", Ok = false, Detail = e.Message }); }

            bool ux = false;
            try { ux = Process.GetProcessesByName("OpenTabletDriver.UX.Wpf").Length > 0; } catch { }
            o.Add(new Item { Name = "OTD GUI not running", Ok = !ux, Detail = ux ? "the stock GUI overwrites applied settings with its own stale copy - close it, AimForge replaces it" : "good - nothing can stomp an apply" });
            o.Add(new Item { Name = "not running elevated", Ok = !IsElevated(), Detail = IsElevated() ? "OTD's pipe belongs to your user session; applypreset will be refused" : "good - OTD's pipe is reachable" });
            return o;
        }

        static Item Sig(string name, string path)
        {
            if (!File.Exists(path)) return new Item { Name = name, Ok = false, Detail = "file not found: " + path };
            // Embedded Authenticode first (rawaccel.sys). WHQL drivers like vmulti.sys are usually
            // CATALOG-signed - no signature inside the file - so fall back to the OS's own catalog
            // lookup via Get-AuthenticodeSignature, which is what the kernel consults anyway.
            try
            {
                uint r = Verify(path);
                if (r == 0)
                {
                    var cert = new System.Security.Cryptography.X509Certificates.X509Certificate2(path);
                    return new Item { Name = name, Ok = true, Detail = "valid (embedded), " + cert.GetNameInfo(System.Security.Cryptography.X509Certificates.X509NameType.SimpleName, false) };
                }
            }
            catch { }
            try
            {
                var psi = new ProcessStartInfo("powershell.exe", "-NoProfile -NonInteractive -Command \"$s=Get-AuthenticodeSignature -LiteralPath '" + path.Replace("'", "''") + "'; $s.Status.ToString() + '|' + $s.SignerCertificate.Subject\"")
                { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true };
                using var p = Process.Start(psi)!; string o = p.StandardOutput.ReadToEnd().Trim(); p.WaitForExit(8000);
                var parts = o.Split('|');
                string status = parts[0].Trim();
                string signer = parts.Length > 1 ? parts[1].Split(',')[0].Replace("CN=", "").Trim() : "";
                return new Item { Name = name, Ok = status == "Valid", Detail = (status == "Valid" ? "valid (catalog), " : status + ", ") + signer };
            }
            catch (Exception e) { return new Item { Name = name, Ok = false, Detail = e.Message }; }
        }

        static bool ServiceRunning(string name)
        {
            try
            {
                var psi = new ProcessStartInfo("sc.exe", "query " + name) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true };
                using var p = Process.Start(psi)!; string o = p.StandardOutput.ReadToEnd(); p.WaitForExit(3000);
                return o.Contains("RUNNING");
            }
            catch { return false; }
        }

        public static bool IsElevated()
        {
            try { using var id = System.Security.Principal.WindowsIdentity.GetCurrent(); return new System.Security.Principal.WindowsPrincipal(id).IsInRole(System.Security.Principal.WindowsBuiltInRole.Administrator); }
            catch { return false; }
        }

        // ---- WinVerifyTrust ----
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        struct WINTRUST_FILE_INFO { public uint cbStruct; public IntPtr pcwszFilePath; public IntPtr hFile; public IntPtr pgKnownSubject; }
        [StructLayout(LayoutKind.Sequential)]
        struct WINTRUST_DATA
        {
            public uint cbStruct; public IntPtr pPolicyCallbackData; public IntPtr pSIPClientData; public uint dwUIChoice;
            public uint fdwRevocationChecks; public uint dwUnionChoice; public IntPtr pFile; public uint dwStateAction;
            public IntPtr hWVTStateData; public IntPtr pwszURLReference; public uint dwProvFlags; public uint dwUIContext; public IntPtr pSignatureSettings;
        }
        [DllImport("wintrust.dll", ExactSpelling = true, SetLastError = false, CharSet = CharSet.Unicode)]
        static extern uint WinVerifyTrust(IntPtr hwnd, [MarshalAs(UnmanagedType.LPStruct)] Guid pgActionID, IntPtr pWVTData);

        static uint Verify(string path)
        {
            var action = new Guid("00AAC56B-CD44-11d0-8CC2-00C04FC295EE"); // WINTRUST_ACTION_GENERIC_VERIFY_V2
            var fi = new WINTRUST_FILE_INFO { cbStruct = (uint)Marshal.SizeOf<WINTRUST_FILE_INFO>(), pcwszFilePath = Marshal.StringToCoTaskMemUni(path) };
            IntPtr pfi = Marshal.AllocCoTaskMem(Marshal.SizeOf<WINTRUST_FILE_INFO>()); Marshal.StructureToPtr(fi, pfi, false);
            var wd = new WINTRUST_DATA { cbStruct = (uint)Marshal.SizeOf<WINTRUST_DATA>(), dwUIChoice = 2, fdwRevocationChecks = 0, dwUnionChoice = 1, pFile = pfi, dwStateAction = 0 };
            IntPtr pwd = Marshal.AllocCoTaskMem(Marshal.SizeOf<WINTRUST_DATA>()); Marshal.StructureToPtr(wd, pwd, false);
            try { return WinVerifyTrust(IntPtr.Zero, action, pwd); }
            finally { Marshal.FreeCoTaskMem(fi.pcwszFilePath); Marshal.FreeCoTaskMem(pfi); Marshal.FreeCoTaskMem(pwd); }
        }
    }
}
