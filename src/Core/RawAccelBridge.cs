using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace AimForge.Core
{
    /// <summary>
    /// Drives RawAccel through its OFFICIAL path only: edit settings.json, hand it to writer.exe,
    /// which talks to the WHQL-signed rawaccel.sys over its own IOCTL. This app never opens the
    /// driver itself, so the anti-cheat surface is exactly what RawAccel's own GUI presents.
    /// </summary>
    public sealed class RawAccelBridge
    {
        public string Dir { get; }
        public string SettingsPath => Path.Combine(Dir, "settings.json");
        public string WriterPath => Path.Combine(Dir, "writer.exe");

        public RawAccelBridge(string dir) { Dir = dir; }

        public bool Installed => File.Exists(WriterPath) && File.Exists(SettingsPath);
        /// Test seam: runs writer.exe and returns its exit code (throws TimeoutException on hang).
        public Func<int>? WriterRunner;
        /// True after an Apply that installed (and verified) the mouse mirror.
        public bool LastMirrorApplied { get; private set; }

        public JsonObject ReadRoot() => JsonNode.Parse(File.ReadAllText(SettingsPath))!.AsObject();

        int RunWriter()
        {
            if (WriterRunner != null) return WriterRunner();
            // Start-Process -Wait gives a REAL exit code. writer.exe pops a blocking dialog on bad
            // values, so a timeout guards the UI thread. (The driver adds a 1 s WRITE_DELAY.)
            var psi = new ProcessStartInfo(WriterPath, $"\"{SettingsPath}\"") { WorkingDirectory = Dir, UseShellExecute = false, CreateNoWindow = true };
            using var proc = Process.Start(psi)!;
            if (!proc.WaitForExit(8000)) { try { proc.Kill(); } catch { } throw new TimeoutException("writer.exe did not return - it probably showed a validation dialog"); }
            return proc.ExitCode;
        }

        /// The write transaction (2026-09-14 - replaces the partial one): backup, write, writer.exe,
        /// verify. On ANY failure the backup is restored AND writer.exe is re-run on it, so the
        /// driver's state and the file agree again (the old code restored the file only on a
        /// read-back mismatch and never re-fed the driver; on a timeout or non-zero exit it left
        /// the rejected values on disk to be re-fed at the next boot).
        /// One settings.json writer at a time within this process (review 2026-09-14: two applies could race).
        static readonly object CommitLock = new object();
        const string ReservedFirstMessage = "RawAccel's first profile is 'AimForge Mouse' - the pen profile must be first. Reorder the profiles in the RawAccel GUI (or delete 'AimForge Mouse' there), then apply again.";

        /// A backup name that never overwrites an earlier backup (millisecond stamp + counter).
        string NewBackupPath()
        {
            string stem = $"settings.backup-{DateTime.Now:yyyyMMdd-HHmmss-fff}";
            string path = Path.Combine(Dir, stem + ".json");
            for (int n = 1; File.Exists(path); n++) path = Path.Combine(Dir, $"{stem}-{n}.json");
            return path;
        }

        /// Chronological key for backups: timestamp, milliseconds, collision counter. Older
        /// second-resolution names sort before any millisecond name of the same second.
        static (string ts, int ms, int n) BackupKey(string file)
        {
            var m = System.Text.RegularExpressions.Regex.Match(Path.GetFileName(file), @"^settings\.backup-(\d{8}-\d{6})(?:-(\d{3}))?(?:-(\d+))?\.json$");
            return m.Success ? (m.Groups[1].Value, m.Groups[2].Success ? int.Parse(m.Groups[2].Value) : -1, m.Groups[3].Success ? int.Parse(m.Groups[3].Value) : 0) : ("", -2, 0);
        }

        static void WarnIfGuiOpen(Action<string> log)
        {
            try { if (Process.GetProcessesByName("rawaccel").Length > 0) log("RawAccel: WARNING - the RawAccel GUI is open; its Apply rewrites settings.json from its own in-memory copy and would undo this. Close it."); } catch { }
        }

        string Commit(JsonObject root, Func<string?> verify, Action<string> log)
        {
            lock (CommitLock)
            {
                string bak = NewBackupPath();
                File.Copy(SettingsPath, bak, false);
                try
                {
                    File.WriteAllText(SettingsPath, Pretty(root), new UTF8Encoding(false));
                    int code = RunWriter();
                    if (code != 0) throw new InvalidOperationException($"writer.exe exited {code}; RawAccel rejected the settings");
                    string? mismatch;
                    try { mismatch = verify(); }
                    catch (Exception e) when (e is IOException || e is JsonException)
                    {
                        // a transient lock (antivirus, the RawAccel GUI) right after writer.exe must not
                        // roll back an apply that took - read back once more before calling it a failure
                        System.Threading.Thread.Sleep(150);
                        mismatch = verify();
                    }
                    if (mismatch != null) throw new InvalidOperationException("RawAccel read-back does not match the intended build: " + mismatch);
                    return bak;
                }
                catch (Exception ex)
                {
                    try
                    {
                        File.Copy(bak, SettingsPath, true);
                        int code = RunWriter();
                        log("RawAccel: FAILED (" + ex.Message + ") - backup restored and re-applied to the driver" + (code == 0 ? "" : $" (restore writer exit {code})"));
                    }
                    catch (Exception ex2) { log("RawAccel: FAILED (" + ex.Message + ") and the restore ALSO failed (" + ex2.Message + ") - use 'Restore last RawAccel backup' in the tray menu"); }
                    throw;
                }
            }
        }

        /// Tray-menu / keyboard-reachable undo: the newest backup (the state before the last apply)
        /// back onto the driver. A rejected restore throws; the result is read back and logged.
        public void RestoreLastBackup(Action<string> log)
        {
            WarnIfGuiOpen(log);
            var bak = Directory.GetFiles(Dir, "settings.backup-*.json").Where(f => BackupKey(f).ts.Length > 0)
                      .OrderByDescending(f => BackupKey(f)).FirstOrDefault()
                      ?? throw new FileNotFoundException("no settings.backup-*.json in " + Dir);
            RestoreBackup(bak, log);
        }

        /// A specific backup back onto the driver: the cross-driver rollback when the OTD half of an apply fails
        /// after RawAccel was committed (2026-09-16 review), and the tray undo.
        public void RestoreBackup(string bak, Action<string> log)
        {
            lock (CommitLock)
            {
                File.Copy(bak, SettingsPath, true);
                int code = RunWriter();
                if (code != 0) throw new InvalidOperationException($"writer.exe exited {code} on the restored backup {Path.GetFileName(bak)} - RawAccel rejected it");
                var ml = MouseMirror.Read(ReadRoot());
                LastMirrorApplied = ml.Exists && ml.Bound.Count > 0;
                log($"RawAccel: restored {Path.GetFileName(bak)} and re-applied (writer exit 0); pen {ReadLive()}; mouse {(LastMirrorApplied ? "mirrored" : "raw")}");
            }
        }

        /// Standalone mirror removal (no card): the mouse goes back to raw; the pen profile is
        /// verified untouched.
        public void MirrorOff(Action<string> log)
        {
            WarnIfGuiOpen(log);
            var root = ReadRoot();
            if (root["profiles"]?[0]?["name"]?.GetValue<string>() == MouseMirror.Reserved) throw new InvalidOperationException(ReservedFirstMessage);
            var penBefore = MouseMirror.Clone(root["profiles"]![0]!.AsObject());
            int n = MouseMirror.Remove(root);
            log($"mouse: mirror OFF - {n} device entr{(n == 1 ? "y" : "ies")} back to raw (disabled), '{MouseMirror.Reserved}' removed");
            Commit(root, () =>
            {
                var live = ReadRoot(); var l = MouseMirror.Read(live);
                if (l.Exists || l.Bound.Count > 0 || l.NamingReserved > 0) return "mouse profile or binding still present";
                return JsonNode.DeepEquals(live["profiles"]![0], penBefore) ? null : "pen profile changed by a mouse-only removal";
            }, log);
            LastMirrorApplied = false;
            log("RawAccel: mirror removal VERIFIED by read-back; pen profile untouched");
        }

        /// Mouse-only install (the CLI `--mouse on` path): builds and binds the mouse profile for `p`
        /// on `rig` and NEVER touches profiles[0] - verified by DeepEquals - so it cannot change the
        /// pen's curve or engine pairing (review 2026-09-14: the old path re-applied the pen with the
        /// default engine and double-accelerated a Cadence Lock rig). A refused pre-flight writes nothing.
        public void MirrorOn(Preset p, Rig rig, Action<string> log)
        {
            WarnIfGuiOpen(log);
            var root = ReadRoot();
            if (root["profiles"]?[0]?["name"]?.GetValue<string>() == MouseMirror.Reserved) throw new InvalidOperationException(ReservedFirstMessage);
            var penBefore = MouseMirror.Clone(root["profiles"]![0]!.AsObject());
            var bad = MouseMirror.PreFlight(root, p, rig, rig.MouseIdPrefixes);
            if (bad.Count > 0) { foreach (var b in bad) log("mouse mirror REFUSED: " + b); LastMirrorApplied = false; return; }
            var x = MouseMirror.Numbers(rig.PxMm, rig.Mult, rig.MouseDpi);
            foreach (var b in MouseMirror.InstallOn(root, p, rig, rig.MouseIdPrefixes)) log("mouse: bound " + b);
            log($"mouse: '{MouseMirror.Reserved}' built from {p.id} against the live pen ({rig.PxMm} px/mm, mult {rig.Mult}) - sens x{x.MultMouse:0.0000} (Output DPI {x.OutputDpi}), curve x{x.R:0.0000} on the speed axis");
            Commit(root, () =>
            {
                var live = ReadRoot();
                if (!JsonNode.DeepEquals(live["profiles"]![0], penBefore)) return "pen profile changed by a mouse-only install";
                var miss = MouseMirror.Verify(live, p, rig, rig.MouseIdPrefixes);
                return miss.Count > 0 ? "mouse profile: " + string.Join("; ", miss) : null;
            }, log);
            LastMirrorApplied = true;
            log("RawAccel: mouse profile and bindings VERIFIED; pen profile untouched (verified)");
        }

        public sealed class Live
        {
            public string Mode = "", Points = "", CapMode = ""; public double OutputDpi, Yx, SnapDeg, Accel, Cap, Offset, Rotation, ExpClassic = 2, HalfIn, HalfScale, HalfOut;
            public bool GainVelocity, GainVelocityV;
            public bool Flat => Mode == "noaccel";
            public override string ToString() => (Mode == "lut" ? $"LUT {Points}" : Mode == "noaccel" ? "noaccel (flat)" : $"{Mode} accel {Accel} cap {Cap} offset {Offset}") + (OutputDpi != 1000 ? $"  Output DPI {OutputDpi}" : "");
        }

        /// Pre-flight (2026-09-16 audit gap): the VMulti pen is governed by RawAccel's defaultDeviceConfig (it is
        /// not in devices[]). Disabled, a device DPI, constant-time or a polling override there silently changes or
        /// removes the curve - refuse with a named reason. Null = sane, or unreadable (the apply reports I/O itself).
        /// Whether settings.json can be read and parsed right now (the Doctor must not quote values it never read).
        public bool SettingsReadable(out string error)
        {
            try { ReadRoot(); error = ""; return true; }
            catch (Exception ex) { error = ex.Message; return false; }
        }

        public string? PenDeviceBlocker()
        {
            try
            {
                if (ReadRoot()["defaultDeviceConfig"] is not JsonObject d) return null;
                var bad = new List<string>();
                if (d["disable"]?.GetValue<bool>() == true) bad.Add("disable is ON (the pen would bypass RawAccel: no curve, no Y/X, no snap)");
                if (MouseMirror.Num(d[MouseMirror.KeyDpi]) != 0) bad.Add("a device DPI is set (it rescales the speed axis)");
                if (d[MouseMirror.KeyConst]?.GetValue<bool>() == true) bad.Add("'constant time interval' is ON");
                if (MouseMirror.Num(d[MouseMirror.KeyPoll]) != 0) bad.Add("a polling-rate override is set");
                return bad.Count == 0 ? null : "RawAccel defaultDeviceConfig (governs the VMulti pen): " + string.Join("; ", bad) + " - reset it in the RawAccel GUI Devices menu";
            }
            catch { return null; }
        }

        /// The pen profile an apply of this build writes, checked field by field against a live read (null = it carries
        /// the build). Shared by the apply's read-back and the Doctor's / calibration's drift check (third review: the
        /// drift check never compared the curve, so a tray RawAccel restore read as 'live = last apply').
        public static string? PenMismatch(Live back, Preset p, Rig rig)
        {
            bool match = rig.CadenceEngine ? back.Mode == "noaccel"
                : p.IsLut
                ? back.Mode == "lut" && back.Points == Curve.RawAccelPoints(p.lut!, rig.PxMm)
                : back.Mode == "classic" && Math.Abs(back.Accel - (p.adv.accel ?? 0)) < 1e-9 &&
                  Math.Abs(back.Cap - (p.adv.cap ?? 1)) < 1e-9 && Math.Abs(back.Offset - (p.adv.offset ?? 0)) < 1e-9 &&
                  !back.GainVelocity && !back.GainVelocityV && Math.Abs(back.ExpClassic - 2) < 1e-9 && back.CapMode == "output";
            match &= Math.Abs(back.Yx - rig.Yx) < 1e-9 && Math.Abs(back.SnapDeg - rig.SnapDeg) < 1e-9 &&
                     Math.Abs(back.OutputDpi - Math.Round(1000.0 * rig.Mult, 1)) < 1e-9 && Math.Abs(back.Rotation - rig.RotationDeg) < 1e-9 &&
                     back.HalfIn == 0 && back.HalfScale == 0 && back.HalfOut == 0;
            return match ? null : "pen profile: " + back;
        }

        public Live ReadLive()
        {
            var root = JsonNode.Parse(File.ReadAllText(SettingsPath))!.AsObject();
            var prof = root["profiles"]![0]!.AsObject();
            var blk = prof["Whole or horizontal accel parameters"]!.AsObject();
            var l = new Live
            {
                Mode = blk["mode"]?.GetValue<string>() ?? "",
                OutputDpi = MouseMirror.Num(prof["Output DPI"]),
                Rotation = MouseMirror.Num(prof["Degrees of rotation"]),
                ExpClassic = MouseMirror.Num(blk["exponentClassic"], 2),
                CapMode = blk["Cap mode"]?.GetValue<string>() ?? "",
                // a missing key reads as GAIN (the driver's default), so an unpinned file fails the classic read-back
                GainVelocity = blk["Gain / Velocity"]?.GetValue<bool>() ?? true,
                GainVelocityV = prof["Vertical accel parameters"]?["Gain / Velocity"]?.GetValue<bool>() ?? true,
                Yx = prof["Y/X output DPI ratio (vertical sens multiplier)"]!.GetValue<double>(),
                SnapDeg = prof["Degrees of angle snapping"]!.GetValue<double>(),
                Accel = blk["acceleration"]?.GetValue<double>() ?? 0,
                Offset = blk["inputOffset"]?.GetValue<double>() ?? 0,
                Cap = blk["Cap / Jump"]?["y"]?.GetValue<double>() ?? 0
            };
            if (prof[MouseMirror.KeyIscp] is JsonObject is2)
            { l.HalfIn = MouseMirror.Num(is2[MouseMirror.KeyHalfIn]); l.HalfScale = MouseMirror.Num(is2[MouseMirror.KeyHalfScale]); l.HalfOut = MouseMirror.Num(is2[MouseMirror.KeyHalfOut]); }
            if (l.Mode == "lut" && blk["data"] is JsonArray d)
            {
                var sb = new StringBuilder();
                for (int i = 0; i + 1 < d.Count; i += 2)
                    sb.Append(d[i]!.GetValue<double>().ToString("0.###", System.Globalization.CultureInfo.InvariantCulture))
                      .Append(',').Append(d[i + 1]!.GetValue<double>().ToString("0.###", System.Globalization.CultureInfo.InvariantCulture)).Append(';');
                l.Points = sb.ToString();
            }
            return l;
        }

        /// Writes the preset into BOTH accel blocks (whole/horizontal and vertical) exactly as the
        /// proven PowerShell script did. Returns the backup path. Throws on writer.exe failure.
        public string Apply(Preset p, Rig rig, bool dryRun, Action<string> log)
        {
            var root = JsonNode.Parse(File.ReadAllText(SettingsPath))!.AsObject();
            var prof = root["profiles"]![0]!.AsObject();
            if (prof["name"]?.GetValue<string>() == MouseMirror.Reserved) throw new InvalidOperationException(ReservedFirstMessage);
            WarnIfGuiOpen(log);

            foreach (var blockName in new[] { "Whole or horizontal accel parameters", "Vertical accel parameters" })
            {
                var blk = prof[blockName]!.AsObject();
                if (rig.CadenceEngine)
                {
                    // Cadence Lock engine: the curve runs in the OTD filter on the pen's clock;
                    // RawAccel keeps sens/YX/snap/rotation and NO curve (a curve here too would
                    // be double acceleration - the Doctor guards the pairing).
                    blk["mode"] = "noaccel";
                }
                else if (p.IsLut)
                {
                    var data = Curve.RawAccelData(p.lut!, rig.PxMm);
                    for (int i = 0; i < data.Length; i += 2)
                    {
                        if (data[i] <= 0) throw new InvalidOperationException($"LUT x at index {i / 2} is {data[i]}: RawAccel rejects x <= 0");
                        if (i >= 2 && data[i] <= data[i - 2]) throw new InvalidOperationException("LUT x values must strictly increase");
                    }
                    blk["mode"] = "lut";
                    blk["Gain / Velocity"] = false;        // "Apply as: Sensitivity"
                    var arr = new JsonArray(); foreach (var v in data) arr.Add(JsonValue.Create(v));
                    blk["data"] = arr;
                }
                else
                {
                    blk["mode"] = "classic";
                    blk["Gain / Velocity"] = false;        // LEGACY classic: the sensitivity-cap form Curve.ClassicGain and CadenceCore model
                    blk["exponentClassic"] = 2.0;
                    blk["inputOffset"] = p.adv.offset ?? 0.0;
                    blk["acceleration"] = p.adv.accel ?? 0.0;
                    blk["Cap mode"] = "output";
                    blk["Cap / Jump"]!["y"] = p.adv.cap ?? 1.0;
                }
            }
            prof["Y/X output DPI ratio (vertical sens multiplier)"] = rig.Yx;
            prof["Output DPI"] = Math.Round(1000.0 * rig.Mult, 1);
            prof["Degrees of angle snapping"] = rig.SnapDeg;
            prof["Degrees of rotation"] = rig.RotationDeg;
            // The pen's speed EMAs stay OFF (2026-09-16 audit): output/scale smoothing IS mouse smoothing and an input
            // EMA would time-smear the speed the curve reads. The live rig already had 0 - now written and verified.
            if (prof[MouseMirror.KeyIscp] is JsonObject piscp) { piscp[MouseMirror.KeyHalfIn] = 0.0; piscp[MouseMirror.KeyHalfScale] = 0.0; piscp[MouseMirror.KeyHalfOut] = 0.0; }

            string desc = rig.CadenceEngine ? "noaccel (FLAT - the curve runs in Cadence Lock, tablet space)"
                        : p.IsLut ? $"LUT {Curve.RawAccelPoints(p.lut!, rig.PxMm)}" : $"classic accel {p.adv.accel} cap {p.adv.cap} offset {p.adv.offset}";
            log($"RawAccel: {desc}");
            log($"RawAccel: Y/X {rig.Yx}  snap {rig.SnapDeg} deg  rot {rig.RotationDeg} deg  output DPI {prof["Output DPI"]}");

            // ---- mouse mirror (2026-09-14): the SAME card on the physical mouse, or its exact removal.
            //      A MODE: every apply rebuilds the mouse profile from the card being applied. ----
            bool mirror = false;
            if (rig.MirrorMouse)
            {
                var bad = MouseMirror.PreFlight(root, p, rig, rig.MouseIdPrefixes);
                if (bad.Count > 0)
                {
                    foreach (var b in bad) log("mouse mirror REFUSED: " + b);
                    int n0 = MouseMirror.Remove(root);
                    log("mouse mirror: pen apply proceeds; the mouse goes RAW (" + n0 + " entries unbound) rather than keep a stale profile");
                }
                else
                {
                    var x = MouseMirror.Numbers(rig.PxMm, rig.Mult, rig.MouseDpi);
                    var bound = MouseMirror.InstallOn(root, p, rig, rig.MouseIdPrefixes);
                    mirror = true;
                    log($"mouse: '{MouseMirror.Reserved}' built from {p.id} - assumes {rig.MouseDpi:0} DPI; sens x{x.MultMouse:0.0000} (Output DPI {x.OutputDpi}) so {x.PxMmEffective:0.00} counts/mm = the pen's {rig.PxMm}; curve x{x.R:0.0000} on the speed axis; snap {rig.SnapDeg}; Y/X {(rig.MouseYx ?? rig.Yx)}; speed EMA {rig.MouseSpeedHalfLifeMs} ms");
                    foreach (var b in bound) log("mouse: bound " + b);
                }
            }
            else if (MouseMirror.HasReserved(root) || MouseMirror.Read(root).NamingReserved > 0)
            {
                int n = MouseMirror.Remove(root);
                log($"mouse: mirror OFF - {n} device entr{(n == 1 ? "y" : "ies")} back to raw (disabled), '{MouseMirror.Reserved}' removed");
            }
            if (dryRun) { log("RawAccel: dry run, nothing written"); return ""; }

            // Apply transaction: writer.exe can silently keep the OLD curve on rejected values
            // (documented failure), so trust nothing - read the file back and compare every field
            // this apply owns (pen profile, and the mouse profile + bindings when mirrored).
            string bak = Commit(root, () =>
            {
                var back = ReadLive();
                if (PenMismatch(back, p, rig) is string pm) return pm;
                var live = ReadRoot();
                if (mirror)
                {
                    var miss = MouseMirror.Verify(live, p, rig, rig.MouseIdPrefixes);
                    if (miss.Count > 0) return "mouse profile: " + string.Join("; ", miss);
                }
                else
                {
                    var ml = MouseMirror.Read(live);
                    if (ml.Exists || ml.Bound.Count > 0 || ml.NamingReserved > 0) return "mouse profile or binding still present after removal";
                }
                return null;
            }, log);
            LastMirrorApplied = mirror;
            var okBack = ReadLive();
            log("RawAccel: applied and VERIFIED by read-back (" + (rig.CadenceEngine ? "noaccel/flat" : p.IsLut ? "LUT" : "classic") + $", snap {okBack.SnapDeg}, Y/X {okBack.Yx})"
                + (mirror ? $" + mouse profile '{MouseMirror.Reserved}' and its device bindings VERIFIED" : rig.MirrorMouse ? " (mouse mirror refused - see above)" : ""));
            return bak;
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
