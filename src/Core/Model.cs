using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace AimForge.Core
{
    /// <summary>
    /// The canonical preset catalogue. presets.json is exported from the tuner and is the single
    /// source of truth; every derived number in the app is recomputed from it at load, never stored.
    /// </summary>
    public sealed class Catalogue
    {
        public int schema { get; set; }
        public string generated { get; set; } = "";
        public Tablet tablet { get; set; } = new Tablet();
        public List<Game> games { get; set; } = new List<Game>();
        public List<Monitor> monitors { get; set; } = new List<Monitor>();
        public List<Preset> presets { get; set; } = new List<Preset>();

        public static Catalogue Load(string path)
        {
            var opts = new JsonSerializerOptions { PropertyNameCaseInsensitive = true, NumberHandling = JsonNumberHandling.AllowReadingFromString };
            var c = JsonSerializer.Deserialize<Catalogue>(File.ReadAllText(path), opts)
                    ?? throw new InvalidDataException("presets.json is empty");
            foreach (var p in c.presets) p.Normalise();
            ThirdPerson.Register(c.games);
            return c;
        }

        public Preset? Find(string id) => presets.FirstOrDefault(p => p.id == id);
        public Game? GameOf(Preset p) => p.game == null ? null : games.FirstOrDefault(g => g.id == p.game);
    }

    public sealed class Tablet
    {
        public string name { get; set; } = "";
        public double reportHz { get; set; } = 360;   // measured 2026-09-07 (ev-20260907-pen-rate)
        public double unitMm { get; set; } = 0.01;
        public double widthMm { get; set; } = 310;
        /// The slowest non-zero speed the tablet can express: one unit per report.
        public double UnitStepMms => unitMm / (1.0 / reportHz);
    }

    public sealed class Game
    {
        public string id { get; set; } = "";
        public string name { get; set; } = "";
        public double K { get; set; }
        public double fovMin { get; set; }
        public double fovMax { get; set; }
        public bool fovLocked { get; set; }
        public bool fov3rd { get; set; }
        public double maxW { get; set; }
        public bool fovEstimated { get; set; }
        /// Over-the-shoulder camera (third-person match applies) and its camera-arm estimate in metres.
        public bool thirdPerson { get; set; }
        public double? cameraArmM { get; set; }
        public bool cameraArmEstimated { get; set; }
        /// Set when K was measured (Calib360): the date and the evidence record.
        public string? kMeasured { get; set; }
        public string? kEvidence { get; set; }
        public string note { get; set; } = "";
    }

    public sealed class Monitor
    {
        public string mon { get; set; } = "";
        public double hz { get; set; }
        public double w { get; set; }
        public double h { get; set; }
        public string label { get; set; } = "";
        public string sub { get; set; } = "";
    }

    public sealed class Adv
    {
        public double? reset { get; set; }
        public double? accel { get; set; }
        public double? cap { get; set; }
        public double? yx { get; set; }
        public double? offset { get; set; }
        public double? mult { get; set; }
    }

    public sealed class CohOv
    {
        public double window { get; set; } = 70;
        public double hold { get; set; } = 180;
        public double fullPass { get; set; } = 8;
        public double engage { get; set; } = 3;
        public double floor { get; set; } = 0.30;
        public double ceiling { get; set; } = 0.55;
        public double rails { get; set; }
        public double anchor { get; set; }
        public double anchorMs { get; set; } = 350;
        public double settle { get; set; }
        public double settleSpeed { get; set; } = 80;
        public double tap { get; set; }
        public double tapArm { get; set; } = 1.0;
        public double tapHold { get; set; } = 60;
        public double tapBreak { get; set; } = 1.0;
        public double lead { get; set; }
        public double leadMax { get; set; } = 1.5;

        /// Hold 0 with every motion feature off = exact position passthrough + Tap Anchor only.
        public bool IsTapOnly => hold == 0 && rails == 0 && settle == 0 && anchor == 0 && lead == 0 && tap > 0;
        public CohOv Copy() => (CohOv)MemberwiseClone();
    }

    /// One entry of a build's declared filter plan (3.1): catalog id + on/off + the real
    /// plugin property names. Derived by the exporter from the build's authored state, so the
    /// tuner stays the single write path and this list can never disagree with cohOv/hdlMax.
    public sealed class FilterSpec
    {
        public string id { get; set; } = "";
        public bool on { get; set; }
        public Dictionary<string, double> settings { get; set; } = new Dictionary<string, double>();
    }

    public sealed class Preset
    {
        public string id { get; set; } = "";
        public string name { get; set; } = "";
        public string group { get; set; } = "";
        /// The game this card plays (GAMES id from the tuner, generated); null for reference cards.
        public string? game { get; set; }
        /// GameLab only: the lab's game-filter verdict for a card being authored (exported as the tuner's gameFilter).
        [System.Text.Json.Serialization.JsonIgnore] public bool gameFilterOn;
        public string tag { get; set; } = "";
        public string? field { get; set; }
        public string desc { get; set; } = "";
        public double pxmm { get; set; }
        public double cm { get; set; }
        public double snap { get; set; }
        public double hdlMax { get; set; } = 87;
        public double slider { get; set; }
        public int res { get; set; }
        public Adv adv { get; set; } = new Adv();
        /// Authored and stored in (mm/s, gain), independent of px/mm; rescaled to RawAccel's counts/ms axis
        /// at APPLY time (Curve.RawAccelData / RawAccelPoints at rig.PxMm), never by the exporter.
        public double[][]? lut { get; set; }
        public CohOv? cohOv { get; set; }
        public List<FilterSpec>? filters { get; set; }
        public JsonElement? radialOv { get; set; }

        public bool IsLut => lut != null && lut.Length >= 2;
        public bool RunsFilter => cohOv != null || slider > 0 || radialOv.HasValue;
        public double Yx => adv.yx ?? 0.789;
        public double ResetMs => adv.reset ?? 80;

        internal void Normalise()
        {
            if (lut != null) lut = lut.OrderBy(p => p[0]).ToArray();
        }

        /// A COPY of this card with only its Coherence Stabilizer overlay replaced (2026-09-16 audit: the GUI's
        /// old rebuild dropped `filters`, so no game personality was ever written from the window). Every other
        /// field, the declared filter plan included, is carried; adv/lut/filters are copied so a caller can never
        /// mutate the catalogue through the result.
        public Preset WithCohOv(CohOv? co) => new Preset
        {
            id = id, name = name, group = group, tag = tag, field = field, desc = desc,
            pxmm = pxmm, cm = cm, snap = snap, hdlMax = hdlMax, slider = 0, res = res,
            adv = new Adv { reset = adv.reset, accel = adv.accel, cap = adv.cap, yx = adv.yx, offset = adv.offset, mult = adv.mult },
            lut = lut?.Select(p => (double[])p.Clone()).ToArray(),
            cohOv = co,
            filters = filters?.Select(f => new FilterSpec { id = f.id, on = f.on, settings = new Dictionary<string, double>(f.settings) }).ToList(),
            radialOv = radialOv
        };
    }

    /// <summary>Everything the user can turn that is not the curve itself.</summary>
    public sealed class Rig
    {
        public double PxMm = 90, Cm360 = 27, SnapDeg = 12, Yx = 0.789, HdlMax = 87, ResetMs = 80;
        public int MonitorIndex = 0;
        /// RawAccel sens multiplier (Output DPI / 1000) and input rotation, both profile-level.
        public double Mult = 1.0, RotationDeg = 0.0;
        /// The third-person match factor already folded into Mult by an apply (ThirdPerson.ApplyTo); 1 = none.
        public double TpsGain = 1.0;
        /// OTD tip activation threshold in percent; null = leave the live value untouched.
        public double? TipThresholdPct = null;
        /// Hover Distance Limiter minimum hover (hover hygiene floor). 0 = from contact.
        /// (Pen/Eraser/NearProximity on HDL are report-TYPE filters, not hover controls -
        /// established from the plugin README; Hover_min/Hover_max are the real dials.)
        public double HdlMin = 0;
        /// Hover Distance Limiter on/off (the one filter every build normally keeps).
        public bool HdlEnabled = true;
        /// Where the curve runs. "rawaccel" (default): RawAccel evaluates it from count deltas
        /// and ARRIVAL-time dt. "cadence": the Cadence Lock OTD filter evaluates the same curve
        /// in tablet space on the pen's fixed report clock and RawAccel is written flat.
        /// Apply-time choice, never authored into presets.json (the curve is the same curve).
        public string Engine = "rawaccel";
        /// The pen's hardware report rate, pinned into Cadence Lock (catalogue tablet.reportHz).
        public double ReportHz = 360;   // MEASURED 360.2 Hz (ev-20260907-pen-rate); 0 = auto-estimate (re-verify)
        /// Cadence Lock: longest gap (in reports) still priced as merged travel.
        public double MergeMax = 8;
        /// Cadence Lock's drop check (2026-10-11, ev-20261011-chain-lab): a long gap is priced as merged reports only when
        /// the travel says so. On by default for Cadence applies; written as the plugin's DropCheck property.
        public bool DropCheck = true;
        /// Mouse mirror (2026-09-14): the same build on the physical mouse through a second
        /// RawAccel profile (MouseMirror.cs). Apply-time MODE persisted in mouse.txt - never in
        /// presets.json. DPI is the sensor step as set on the mouse; AimForge cannot check it.
        public bool MirrorMouse = false;
        public double MouseDpi = 1600, MouseSpeedHalfLifeMs = MouseMirror.DefaultHalfLife;
        public double? MouseYx = null;
        public string[] MouseIdPrefixes = Array.Empty<string>();
        public bool CadenceEngine => Engine == "cadence";
        /// Experimental Cadence Lock modes (2026-09-24, XP_TOGGLES.md), persisted in xp.txt - never in presets.json.
        public bool IntentSpeed = false;
        public double ReversalCarryMs = 0;
        /// Nib Twin (2026-09-24): the calibrated nib swing removed at the front of the chain, on either engine (needs
        /// nibtwin.json). NibProbe = the --nib-calibrate apply (the Nib Twin filter's Probe 1 logs presses, twin off).
        public bool NibTwin = false, NibProbe = false;
        public double SkidXmm, SkidYmm, SkidFullPressure = 0.35, SkidGamma = 1.0, SkidLagReports;
        /// Snapshot for an in-flight apply (review 2026-09-14): controls edited mid-apply must not
        /// change the rig the transaction verifies against.
        public Rig Clone() => (Rig)MemberwiseClone();

        public static Rig From(Preset p) => new Rig
        {
            PxMm = p.pxmm, Cm360 = p.cm, SnapDeg = p.snap, Yx = p.Yx, HdlMax = p.hdlMax,
            ResetMs = p.ResetMs, MonitorIndex = p.res, Mult = p.adv.mult ?? 1.0
        };
    }
}
