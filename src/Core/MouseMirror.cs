using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json.Nodes;

namespace AimForge.Core
{
    /// <summary>
    /// Mouse mirror (2026-09-14): make the user's physical mouse feel like the pen build through
    /// RawAccel's per-device profiles. Everything here is pure (JSON in, JSON out; numbers in,
    /// numbers out) so the selftests drive the exact shipping transform.
    ///
    /// THE TRANSFORM (T), verified by a four-lens adversarial review against RawAccel v1.7.0
    /// source (accel-classic.hpp, accel-lookup.hpp, rawaccel.hpp, rawaccel-validate.hpp):
    ///   cpm_p = pen px/mm (OTD)      cpm_m = mouseDpi / 25.4      r = cpm_m / cpm_p
    ///   mult_m = mult_p / r          -> cpm_m * mult_m == cpm_p * mult_p  (same cm/360 at the same in-game sens)
    ///   classic: offset_m = r*offset, accel_m = accel/r, cap unchanged  (driver's base_fn = accel^(p-1)(x-off)^p/x
    ///            is EXACTLY invariant under x->rx, off->r*off, accel->accel/r for any exponent)
    ///   LUT (sensitivity points): x_m = mm/s * cpm_m / 1000 (6 dp), y unchanged
    ///   every other counts/ms-dimensioned field x r (Cap/Jump.x, Input Speed Cap, syncSpeed), 1/speed fields / r
    ///   (decayRate, scale); Y/X, L/R, U/D, rotation, snap DEGREES: same numbers (scale-invariant).
    ///   The mouse profile is built from the CARD, never from the live pen profile (which is flat
    ///   under Cadence Lock), so it is never noaccel by construction and is independent of the engine.
    /// What is deliberately NOT cloned: the 1.7 input-speed half-life. At 1600 DPI / 8 kHz the
    /// driver's per-packet speed estimate is quantised to 8/k counts/ms (+/-30% around the knees);
    /// a ~1 ms input EMA (mean information age = the pen's half report interval) restores a pen-like
    /// estimate and adds NO cursor latency (it feeds only the speed given to the curve; the output
    /// vector is never averaged - Guide.md 'Coalescion'). Editable; 0 = raw packets.
    /// </summary>
    public static class MouseMirror
    {
        public const string Reserved = "AimForge Mouse";
        public const string H = "Whole or horizontal accel parameters", V = "Vertical accel parameters";
        public const string KeyDpi = "DPI (normalizes input speed unit: counts/ms -> in/s)";
        public const string KeyConst = "Use constant time interval based on polling rate";
        public const string KeyHalfIn = "Time in ms after which an input is weighted at half its original value.";
        public const string KeyHalfScale = "Time in ms after which scale is weighted at half its original value.";
        public const string KeyHalfOut = "Time in ms after which an output is weighted at half its original value.";
        public const string KeyIscp = "Input speed calculation parameters";
        public const string KeyPoll = "Polling rate Hz (keep at 0 for automatic adjustment)";

        // ---------------- numbers ----------------
        public sealed class Xform
        {
            public double CpmPen, CpmMouse, R, MultMouse, OutputDpi, PxMmEffective;
            public override string ToString() => $"r {R:0.000000}  mult {MultMouse:0.000000}  outDPI {OutputDpi}  eff px/mm {PxMmEffective:0.00}";
        }
        public static Xform Numbers(double pxmmPen, double multPen, double mouseDpi)
        {
            var x = new Xform { CpmPen = pxmmPen, CpmMouse = mouseDpi / 25.4 };
            x.R = x.CpmMouse / x.CpmPen;
            x.MultMouse = multPen / x.R;
            x.OutputDpi = Math.Round(1000.0 * x.MultMouse, 4);
            x.PxMmEffective = x.CpmMouse * x.MultMouse;
            return x;
        }
        /// Default input-speed half-life: an EMA whose mean information age (h/ln2) equals the
        /// pen's mean sampling age (half a report interval) - 1.0 ms at 360 Hz.
        public static double DefaultHalfLifeMs(double penHz) => Math.Round(Math.Log(2) * 500.0 / (penHz > 0 ? penHz : 360.0), 1);
        /// The shipped default, derived (not a second literal): 1.0 ms at the measured 360 Hz.
        public static readonly double DefaultHalfLife = DefaultHalfLifeMs(360);

        // ---------------- devices ----------------
        static readonly string[] PenTokens = { "vmulti", "pentablet", "wacom", "ugee", "hanvon", "opentabletdriver" };
        /// The pen (or any tablet) must never be bound to the mouse profile. Evidence-based rules:
        /// Wacom's VID, product-string tokens, and the id shape of OTD's VMulti collections
        /// ("HID\hid&ColNN": a root-enumerated HID with no VID at all - also how a ugee tablet
        /// once registered on this machine).
        public static bool IsPenDevice(string name, string id)
        {
            string n = (name ?? "").ToLowerInvariant(), i = (id ?? "").ToLowerInvariant();
            if (i.Contains("vid_056a")) return true;
            if (i.StartsWith(@"hid\hid&")) return true;
            return PenTokens.Any(t => n.Contains(t) || i.Contains(t));
        }
        /// "HID\VID_3710&PID_5406" from "HID\VID_3710&PID_5406&MI_01&Col08"; null when the id has no VID/PID.
        public static string? VidPidPrefix(string id)
        {
            var m = System.Text.RegularExpressions.Regex.Match(id ?? "", @"^(HID\\VID_[0-9A-Fa-f]{4}&PID_[0-9A-Fa-f]{4})", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
            return m.Success ? m.Groups[1].Value : null;
        }
        /// Every non-pen VID&PID prefix RawAccel already lists - the allowlist seed on first enable.
        public static string[] DiscoverPrefixes(JsonObject root)
        {
            var o = new List<string>();
            foreach (var d in (root["devices"] as JsonArray) ?? new JsonArray())
            {
                var e = d!.AsObject(); string id = e["id"]?.GetValue<string>() ?? "", name = e["name"]?.GetValue<string>() ?? "";
                if (IsPenDevice(name, id)) continue;
                var p = VidPidPrefix(id); if (p != null && !o.Contains(p, StringComparer.OrdinalIgnoreCase)) o.Add(p);
            }
            return o.ToArray();
        }
        public sealed class DeviceClass { public string Name = "", Id = "", Status = ""; public JsonObject? Entry; }
        /// bound = allowlisted and not pen; denied = pen-shaped; skipped = allowlisted but bound to a
        /// user-owned profile (neither profiles[0] nor RESERVED); unmatched = not allowlisted.
        public static List<DeviceClass> Classify(JsonObject root, string[] prefixes)
        {
            var o = new List<DeviceClass>();
            string pen0 = root["profiles"]?[0]?["name"]?.GetValue<string>() ?? "";
            foreach (var d in (root["devices"] as JsonArray) ?? new JsonArray())
            {
                var e = d!.AsObject(); string id = e["id"]?.GetValue<string>() ?? "", name = e["name"]?.GetValue<string>() ?? "";
                var c = new DeviceClass { Name = name, Id = id, Entry = e };
                if (IsPenDevice(name, id)) c.Status = "denied";
                else if (!prefixes.Any(p => id.StartsWith(p, StringComparison.OrdinalIgnoreCase))) c.Status = "unmatched";
                else
                {
                    string prof = e["profile"]?.GetValue<string>() ?? "";
                    c.Status = (prof == pen0 || prof == Reserved || prof.Length == 0) ? "bound" : "skipped";
                }
                o.Add(c);
            }
            return o;
        }

        // ---------------- pre-flight ----------------
        public static List<string> PreFlight(JsonObject root, Preset p, Rig rig, string[] prefixes)
        {
            var bad = new List<string>();
            string ver = root["version"]?.GetValue<string>() ?? "";
            if (!ver.StartsWith("1.7")) bad.Add($"RawAccel {ver} - the mirror is verified against 1.7.x only");
            var profiles = root["profiles"] as JsonArray;
            if (profiles == null || profiles.Count == 0) { bad.Add("no RawAccel profiles"); return bad; }
            string pen0 = profiles[0]!["name"]?.GetValue<string>() ?? "";
            if (pen0 == Reserved) bad.Add($"profiles[0] is named '{Reserved}' - the pen profile must be first; fix the order in the RawAccel GUI");
            if (profiles.Count(x => x!["name"]?.GetValue<string>() == Reserved) > 1) bad.Add($"more than one profile named '{Reserved}' - delete the extras in the RawAccel GUI");
            var devs = (root["devices"] as JsonArray) ?? new JsonArray();
            var ids = devs.Select(d => d!["id"]?.GetValue<string>() ?? "").ToList();
            if (ids.Count != ids.Distinct(StringComparer.OrdinalIgnoreCase).Count()) bad.Add("duplicate device ids in RawAccel devices[]");
            var cls = Classify(root, prefixes);
            if (!cls.Any(c => c.Status == "bound"))
                bad.Add("no mouse entries in RawAccel devices[] match the allowlist - open the RawAccel GUI Devices menu once so the mouse is listed, then apply again");
            foreach (var c in cls.Where(c => c.Status == "bound"))
            {
                var cfg = c.Entry!["config"]?.AsObject();
                if (cfg == null) { bad.Add($"{c.Name}: device entry has no config"); continue; }
                if (Num(cfg[KeyDpi]) != 0) bad.Add($"{c.Name}: RawAccel device DPI is set - set it to 0 in the RawAccel GUI (AimForge scales explicitly; two scalings cannot be audited)");
                if (cfg[KeyConst]?.GetValue<bool>() == true) bad.Add($"{c.Name}: 'constant time interval' is on - turn it off (it makes every 8 kHz packet read as 8 counts/ms)");
                if (Num(cfg[KeyPoll]) != 0) bad.Add($"{c.Name}: RawAccel's polling-rate override is set - put it back to 0 in the RawAccel GUI (it floors the packet interval the mirrored curve is fed)");
            }
            if (rig.MouseDpi < 100 || rig.MouseDpi > 30000) bad.Add($"mouse DPI {rig.MouseDpi} is outside 100-30000");
            var x = Numbers(rig.PxMm, rig.Mult, rig.MouseDpi);
            if (!(x.MultMouse >= 0.05 && x.MultMouse <= 10)) bad.Add($"mouse multiplier {x.MultMouse:0.###} is outside the 0.05-10 desktop-safety band");
            if (!p.IsLut)
            {
                if ((p.adv.accel ?? 0) <= 0) bad.Add("classic accel must be positive (RawAccel rejects it)");
                if ((p.adv.offset ?? 0) < 0) bad.Add("classic offset cannot be negative");
                if ((p.adv.cap ?? 1) < 0) bad.Add("classic cap cannot be negative");
            }
            else
            {
                var data = LutData6(p.lut!, x.CpmMouse);
                if (data.Length / 2 < 2 || data.Length / 2 > 257) bad.Add("LUT must have 2..257 points");
                for (int i = 0; i < data.Length; i += 2)
                {
                    if (data[i] <= 0) bad.Add($"LUT x at point {i / 2} is {data[i]} (must be > 0)");
                    if (i >= 2 && data[i] <= data[i - 2]) bad.Add($"LUT x at point {i / 2} does not increase after rounding");
                    if (data[i + 1] < 0) bad.Add("LUT gain cannot be negative");
                }
            }
            if (rig.SnapDeg < 0 || rig.SnapDeg > 45) bad.Add("angle snapping must be 0..45");
            double yxm = rig.MouseYx ?? rig.Yx;
            if (!(yxm > 0 && yxm <= 1.5)) bad.Add($"mouse Y/X {yxm} is outside (0, 1.5]");
            if (!(rig.MouseSpeedHalfLifeMs >= 0 && rig.MouseSpeedHalfLifeMs <= 10)) bad.Add($"mouse speed EMA {rig.MouseSpeedHalfLifeMs} ms is outside 0-10");
            // every accel-block key must be one the builder classifies (a RawAccel upgrade cannot silently mis-scale a new speed field)
            foreach (var blk in new[] { H, V })
                foreach (var kv in profiles[0]![blk]!.AsObject())
                    if (!KnownBlockKeys.Contains(kv.Key)) bad.Add($"RawAccel added a field AimForge cannot classify: {blk} / {kv.Key}");
            return bad;
        }

        static readonly HashSet<string> KnownBlockKeys = new HashSet<string>
        {
            "mode", "Gain / Velocity", "inputOffset", "outputOffset", "acceleration", "decayRate", "gamma", "motivity",
            "exponentClassic", "scale", "exponentPower", "limit", "syncSpeed", "smooth", "Cap / Jump", "Cap mode", "data"
        };

        public static double[] LutData6(double[][] lut, double cpm)
        {
            var o = new List<double>();
            foreach (var pt in lut) { o.Add(Math.Round(pt[0] * cpm / 1000.0, 6)); o.Add(pt[1]); }
            return o.ToArray();
        }

        // ---------------- the profile ----------------
        public static JsonObject Clone(JsonObject o)
        {
            using var ms = new MemoryStream();
            using (var w = new System.Text.Json.Utf8JsonWriter(ms)) o.WriteTo(w);
            return JsonNode.Parse(Encoding.UTF8.GetString(ms.ToArray()))!.AsObject();
        }
        /// Tolerant numeric read: a JSON number parsed from disk, or a CLR int/long/double someone
        /// assigned to the tree - never throws on a representable number.
        public static double Num(JsonNode? n, double dflt = 0)
        {
            if (n is JsonValue v)
            {
                if (v.TryGetValue<double>(out var d)) return d;
                if (v.TryGetValue<int>(out var i)) return i;
                if (v.TryGetValue<long>(out var l)) return l;
                if (v.TryGetValue<float>(out var f)) return f;
                if (v.TryGetValue<decimal>(out var m)) return (double)m;
            }
            return dflt;
        }
        static double D(JsonObject o, string k, double dflt = 0) => Num(o[k], dflt);

        /// The mouse profile for THIS card on THIS rig. `penTemplate` supplies every key RawAccel's
        /// deserialiser requires and the pass-through values; the curve and every dimensioned field
        /// come from the card and the transform.
        public static JsonObject Build(JsonObject penTemplate, Preset p, Rig rig)
        {
            var x = Numbers(rig.PxMm, rig.Mult, rig.MouseDpi);
            var m = Clone(penTemplate);
            m["name"] = Reserved;
            foreach (var blkName in new[] { H, V })
            {
                var blk = m[blkName]!.AsObject();
                double penOff = D(blk, "inputOffset"), penAcc = D(blk, "acceleration");
                if (p.IsLut)
                {
                    blk["mode"] = "lut";
                    blk["Gain / Velocity"] = false;
                    var arr = new JsonArray(); foreach (var v in LutData6(p.lut!, x.CpmMouse)) arr.Add(JsonValue.Create(v));
                    blk["data"] = arr;
                    blk["inputOffset"] = penOff * x.R;                 // inert in lut mode, kept dimensionally right
                    blk["acceleration"] = penAcc > 0 ? penAcc / x.R : penAcc;
                }
                else
                {
                    blk["mode"] = "classic";
                    blk["Gain / Velocity"] = false;             // legacy sensitivity form, as on the pen
                    blk["exponentClassic"] = 2.0;
                    blk["Cap mode"] = "output";
                    blk["inputOffset"] = (p.adv.offset ?? 0.0) * x.R;
                    blk["acceleration"] = (p.adv.accel ?? 0.0) / x.R;
                    blk["Cap / Jump"]!["y"] = p.adv.cap ?? 1.0;
                }
                // every other counts/ms field scales by r; 1/speed fields by 1/r; dimensionless clone
                var cj = blk["Cap / Jump"]!.AsObject(); cj["x"] = D(cj, "x") * x.R;
                blk["syncSpeed"] = D(blk, "syncSpeed") * x.R;
                blk["decayRate"] = D(blk, "decayRate") / x.R;
                blk["scale"] = D(blk, "scale", 1) / x.R;
            }
            m["Output DPI"] = x.OutputDpi;
            m["Y/X output DPI ratio (vertical sens multiplier)"] = rig.MouseYx ?? rig.Yx;
            m["Degrees of angle snapping"] = rig.SnapDeg;
            m["Degrees of rotation"] = rig.RotationDeg;
            m["Input Speed Cap"] = D(m, "Input Speed Cap") * x.R;
            var iscp = m[KeyIscp]?.AsObject();
            if (iscp != null)
            {
                iscp[KeyHalfIn] = rig.MouseSpeedHalfLifeMs;
                iscp[KeyHalfScale] = 0.0; iscp[KeyHalfOut] = 0.0;     // output smoothing IS classic mouse smoothing - never
            }
            return m;
        }

        /// Puts the mirror into `root`: RESERVED rebuilt and appended LAST, allowlisted entries bound
        /// and enabled. Returns the bound entries' names. Pure JSON; no I/O.
        public static List<string> InstallOn(JsonObject root, Preset p, Rig rig, string[] prefixes)
        {
            var profiles = root["profiles"]!.AsArray();
            var template = profiles[0]!.AsObject();
            var mouse = Build(template, p, rig);
            for (int i = profiles.Count - 1; i >= 1; i--)
                if (profiles[i]!["name"]?.GetValue<string>() == Reserved) profiles.RemoveAt(i);
            profiles.Add(mouse);
            var bound = new List<string>();
            foreach (var c in Classify(root, prefixes).Where(c => c.Status == "bound"))
            {
                c.Entry!["profile"] = Reserved;
                c.Entry["config"]!["disable"] = false;
                bound.Add(c.Name + " [" + c.Id + "]");
            }
            return bound;
        }

        /// Removes the mirror from `root`: entries bound to RESERVED go back to profiles[0] and are
        /// DISABLED (raw mouse - the only coherent unmirrored state, profiles[0] is authored in pen
        /// counts), RESERVED profiles removed. Idempotent. Returns how many entries were unbound.
        public static int Remove(JsonObject root)
        {
            var profiles = root["profiles"]!.AsArray();
            string pen0 = profiles[0]!["name"]?.GetValue<string>() ?? "default";
            int n = 0;
            foreach (var d in (root["devices"] as JsonArray) ?? new JsonArray())
            {
                var e = d!.AsObject();
                if (e["profile"]?.GetValue<string>() == Reserved) { e["profile"] = pen0; if (e["config"] is JsonObject cfg) cfg["disable"] = true; n++; }
            }
            for (int i = profiles.Count - 1; i >= 1; i--)
                if (profiles[i]!["name"]?.GetValue<string>() == Reserved) profiles.RemoveAt(i);
            return n;
        }

        public static bool HasReserved(JsonObject root) =>
            (root["profiles"] as JsonArray)?.Any(x => x!["name"]?.GetValue<string>() == Reserved) == true;

        // ---------------- read-back ----------------
        public sealed class Live
        {
            public bool Exists, IsLast; public string Mode = "", ModeV = ""; public double OutputDpi, Yx, SnapDeg, Rotation, HalfIn, HalfScale, HalfOut, Accel, Offset, Cap, AccelV, OffsetV, CapV;
            public bool GainV = true, GainVV = true; public string CapMode = "", CapModeV = ""; public double ExpC, ExpCV, InputSpeedCap;
            public string Points = "", PointsV = ""; public List<string> Bound = new List<string>(), Disabled = new List<string>(), Dangling = new List<string>();
            /// entries whose profile names RESERVED (enabled or not) - the removal/cleanup test
            public int ProfileCount, NamingReserved;
        }
        public static Live Read(JsonObject root)
        {
            var l = new Live();
            var profiles = root["profiles"]!.AsArray(); l.ProfileCount = profiles.Count;
            var names = profiles.Select(x => x!["name"]?.GetValue<string>() ?? "").ToList();
            int idx = names.LastIndexOf(Reserved);
            l.Exists = idx >= 0; l.IsLast = idx == profiles.Count - 1;
            if (l.Exists)
            {
                var m = profiles[idx]!.AsObject(); var h = m[H]!.AsObject(); var v = m[V]!.AsObject();
                l.Mode = h["mode"]?.GetValue<string>() ?? ""; l.ModeV = v["mode"]?.GetValue<string>() ?? "";
                l.OutputDpi = D(m, "Output DPI"); l.Yx = D(m, "Y/X output DPI ratio (vertical sens multiplier)");
                l.SnapDeg = D(m, "Degrees of angle snapping"); l.Rotation = D(m, "Degrees of rotation");
                l.Accel = D(h, "acceleration"); l.Offset = D(h, "inputOffset"); l.Cap = D(h["Cap / Jump"]!.AsObject(), "y");
                l.AccelV = D(v, "acceleration"); l.OffsetV = D(v, "inputOffset"); l.CapV = D(v["Cap / Jump"]!.AsObject(), "y");
                l.GainV = h["Gain / Velocity"]?.GetValue<bool>() ?? true; l.GainVV = v["Gain / Velocity"]?.GetValue<bool>() ?? true;
                l.CapMode = h["Cap mode"]?.GetValue<string>() ?? ""; l.CapModeV = v["Cap mode"]?.GetValue<string>() ?? "";
                l.ExpC = D(h, "exponentClassic"); l.ExpCV = D(v, "exponentClassic"); l.InputSpeedCap = D(m, "Input Speed Cap");
                if (l.ModeV == "lut" && v["data"] is JsonArray dv) l.PointsV = Pts(dv);
                var iscp = m[KeyIscp]?.AsObject();
                if (iscp != null) { l.HalfIn = D(iscp, KeyHalfIn); l.HalfScale = D(iscp, KeyHalfScale); l.HalfOut = D(iscp, KeyHalfOut); }
                if (l.Mode == "lut" && h["data"] is JsonArray d) l.Points = Pts(d);
            }
            foreach (var dn in (root["devices"] as JsonArray) ?? new JsonArray())
            {
                var e = dn!.AsObject(); string prof = e["profile"]?.GetValue<string>() ?? "", name = e["name"]?.GetValue<string>() ?? "";
                bool dis = e["config"]?["disable"]?.GetValue<bool>() ?? false;
                if (prof.Length > 0 && !names.Contains(prof)) l.Dangling.Add(name + " -> " + prof);
                if (prof == Reserved) l.NamingReserved++;
                if (prof == Reserved && !dis) l.Bound.Add(name);
                if (dis) l.Disabled.Add(name);
            }
            return l;
        }

        static string Pts(JsonArray d) => string.Join(";", Enumerable.Range(0, d.Count / 2).Select(i =>
            Num(d[2 * i]).ToString("R", CultureInfo.InvariantCulture) + "," + Num(d[2 * i + 1]).ToString("R", CultureInfo.InvariantCulture)));

        /// Compare a read-back against what Build() would produce for (card, rig): the exact fields
        /// the apply owns. Returns the list of mismatches (empty = verified).
        public static List<string> Verify(JsonObject root, Preset p, Rig rig, string[] prefixes)
        {
            var miss = new List<string>();
            var l = Read(root); var x = Numbers(rig.PxMm, rig.Mult, rig.MouseDpi);
            if (!l.Exists) { miss.Add(Reserved + " profile missing"); return miss; }
            if (!l.IsLast) miss.Add(Reserved + " is not the last profile");
            string want = p.IsLut ? "lut" : "classic";
            if (l.Mode != want || l.ModeV != want) miss.Add($"mode {l.Mode}/{l.ModeV} (want {want}, never noaccel)");
            if (l.OutputDpi != x.OutputDpi) miss.Add($"Output DPI {l.OutputDpi} (want {x.OutputDpi})");
            if (Math.Abs(l.Yx - (rig.MouseYx ?? rig.Yx)) > 1e-9) miss.Add($"Y/X {l.Yx}");
            if (Math.Abs(l.SnapDeg - rig.SnapDeg) > 1e-9) miss.Add($"snap {l.SnapDeg}");
            if (Math.Abs(l.HalfIn - rig.MouseSpeedHalfLifeMs) > 1e-9) miss.Add($"input half-life {l.HalfIn}");
            if (l.HalfScale != 0 || l.HalfOut != 0) miss.Add("scale/output half-life not 0");
            if (Math.Abs(l.Rotation - rig.RotationDeg) > 1e-9) miss.Add($"rotation {l.Rotation}");
            if (l.GainV || l.GainVV) miss.Add("Gain / Velocity is on (want the legacy sensitivity form the pen models)");
            if (Math.Abs(l.InputSpeedCap - D(root["profiles"]![0]!.AsObject(), "Input Speed Cap") * x.R) > 1e-9) miss.Add($"Input Speed Cap {l.InputSpeedCap}");
            if (p.IsLut)
            {
                var d = LutData6(p.lut!, x.CpmMouse);
                string wantPts = string.Join(";", Enumerable.Range(0, d.Length / 2).Select(i => d[2 * i].ToString("R", CultureInfo.InvariantCulture) + "," + d[2 * i + 1].ToString("R", CultureInfo.InvariantCulture)));
                if (l.Points != wantPts) miss.Add("LUT data differs");
                if (l.PointsV != wantPts) miss.Add("V LUT data differs");
            }
            else
            {
                if (Math.Abs(l.Accel - (p.adv.accel ?? 0) / x.R) > 1e-9) miss.Add($"accel {l.Accel}");
                if (Math.Abs(l.Offset - (p.adv.offset ?? 0) * x.R) > 1e-9) miss.Add($"offset {l.Offset}");
                if (Math.Abs(l.Cap - (p.adv.cap ?? 1)) > 1e-9) miss.Add($"cap {l.Cap}");
                if (Math.Abs(l.AccelV - (p.adv.accel ?? 0) / x.R) > 1e-9) miss.Add($"V accel {l.AccelV}");
                if (Math.Abs(l.OffsetV - (p.adv.offset ?? 0) * x.R) > 1e-9) miss.Add($"V offset {l.OffsetV}");
                if (Math.Abs(l.CapV - (p.adv.cap ?? 1)) > 1e-9) miss.Add($"V cap {l.CapV}");
                if (l.CapMode != "output" || l.CapModeV != "output") miss.Add($"Cap mode {l.CapMode}/{l.CapModeV}");
                if (Math.Abs(l.ExpC - 2) > 1e-9 || Math.Abs(l.ExpCV - 2) > 1e-9) miss.Add($"exponentClassic {l.ExpC}/{l.ExpCV}");
            }
            var cls = Classify(root, prefixes);
            foreach (var c in cls.Where(c => c.Status == "bound"))
            {
                if (c.Entry!["profile"]?.GetValue<string>() != Reserved) miss.Add(c.Name + " not bound");
                if (c.Entry["config"]?["disable"]?.GetValue<bool>() != false) miss.Add(c.Name + " still disabled");
            }
            // only refs the mirror owns: an unrelated stale entry elsewhere must not roll back the pen apply
            var danglingMouse = l.Dangling.Where(s => s.EndsWith("-> " + Reserved)).ToList();
            if (danglingMouse.Count > 0) miss.Add("entries name a missing '" + Reserved + "': " + string.Join(", ", danglingMouse));
            return miss;
        }

        // ---------------- persisted mode (mouse.txt beside the app; never presets.json) ----------------
        public sealed class State
        {
            public bool On; public double Dpi = 1600, HalfLifeMs = DefaultHalfLife; public double? Yx; public string[] Prefixes = Array.Empty<string>();
            public string LastCardId = ""; public double LastPxMm, LastMult = 1;
            public static string Path => System.IO.Path.Combine(AppContext.BaseDirectory, "mouse.txt");
            public static State Load(string? path = null)
            {
                var s = new State();
                try
                {
                    string file = path ?? Path;
                    if (!File.Exists(file)) return s;
                    var f = File.ReadAllText(file).Trim().Split(';');
                    var ci = CultureInfo.InvariantCulture;
                    s.On = f.Length > 0 && f[0] == "on";
                    if (f.Length > 1 && double.TryParse(f[1], NumberStyles.Float, ci, out var d)) s.Dpi = d;
                    if (f.Length > 2 && double.TryParse(f[2], NumberStyles.Float, ci, out var h)) s.HalfLifeMs = h;
                    if (f.Length > 3 && double.TryParse(f[3], NumberStyles.Float, ci, out var y)) s.Yx = y;
                    if (f.Length > 4 && f[4].Length > 0) s.Prefixes = f[4].Split('|');
                    if (f.Length > 5) s.LastCardId = f[5];
                    if (f.Length > 6 && double.TryParse(f[6], NumberStyles.Float, ci, out var px)) s.LastPxMm = px;
                    if (f.Length > 7 && double.TryParse(f[7], NumberStyles.Float, ci, out var mu)) s.LastMult = mu;
                }
                catch { }
                // clamp into the valid ranges so a bad mouse.txt can never crash the GUI's numeric
                // controls (review 2026-09-14) - PreFlight uses the same bounds
                s.Dpi = double.IsFinite(s.Dpi) ? Math.Clamp(s.Dpi, 100, 30000) : 1600;
                s.HalfLifeMs = double.IsFinite(s.HalfLifeMs) ? Math.Clamp(s.HalfLifeMs, 0, 10) : DefaultHalfLife;
                if (s.Yx is double y0 && !(y0 > 0 && y0 <= 1.5)) s.Yx = null;
                return s;
            }
            public void Save(string? path = null)
            {
                var ci = CultureInfo.InvariantCulture;
                File.WriteAllText(path ?? Path, string.Join(";", new[] { On ? "on" : "off", Dpi.ToString(ci), HalfLifeMs.ToString(ci), Yx?.ToString(ci) ?? "",
                    string.Join("|", Prefixes), LastCardId, LastPxMm.ToString(ci), LastMult.ToString(ci) }));
            }
            public void ApplyTo(Rig r) { r.MirrorMouse = On; r.MouseDpi = Dpi; r.MouseSpeedHalfLifeMs = HalfLifeMs; r.MouseYx = Yx; r.MouseIdPrefixes = Prefixes; }
        }

        /// The readout from the LIVE file, not the checkbox (review 2026-09-14): says so when the mode
        /// and RawAccel disagree instead of claiming 'matched'.
        public static string LiveReadout(Rig rig, Live live, bool otdExtras, string? staleCard)
        {
            bool liveOn = live.Exists && live.Bound.Count > 0;
            if (rig.MirrorMouse && !liveOn) return "Mouse: raw - mirror is ON here but NOT live in RawAccel (apply to build it)";
            if (!rig.MirrorMouse && (live.Exists || live.NamingReserved > 0)) return "Mouse: STILL MIRRORED in RawAccel although the mirror is off here (apply to remove it)";
            if (!rig.MirrorMouse) return Readout(rig, 0, false, null);
            return Readout(rig, live.Bound.Count, otdExtras, staleCard);
        }

        /// The one-line readout next to the toggle.
        public static string Readout(Rig rig, int boundCount, bool otdExtras, string? staleCard)
        {
            if (!rig.MirrorMouse) return "Mouse: raw (mirror off)";
            var x = Numbers(rig.PxMm, rig.Mult, rig.MouseDpi);
            string s = $"Mouse: matched · assumes {rig.MouseDpi:0} DPI · {boundCount} device{(boundCount == 1 ? "" : "s")} · sens {x.MultMouse:0.000} → {x.PxMmEffective:0.0} counts/mm = pen · curve ×{x.R:0.000} on the speed axis · snap {rig.SnapDeg:0.#}° · Y/X {(rig.MouseYx ?? rig.Yx):0.###} · speed EMA {rig.MouseSpeedHalfLifeMs:0.#} ms";
            if (otdExtras) s += " · OTD-only extras not mirrored";
            if (!string.IsNullOrEmpty(staleCard)) s += $" · mouse: STALE (card {staleCard})";
            return s;
        }
    }
}
