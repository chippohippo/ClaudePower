using System;
using System.Numerics;
using OpenTabletDriver.Plugin.Attributes;
using OpenTabletDriver.Plugin.Output;
using OpenTabletDriver.Plugin.Tablet;
using OpenTabletDriver.Plugin.Timing;

namespace AimForge.Filters
{
    /// <summary>
    /// AimForge Game Filters - one first-party assembly, one named filter per game family.
    /// Pen signals only (position, dt, pressure-derived state); game-specificity is POLICY on
    /// those signals, never game memory. Template: the Coherence Stabilizer wrapper - same
    /// interface, same PreTransform stage, same mm conversion, same lift handling. These
    /// filters COMPOSE with HDL / Coherence Stabilizer / Tap Anchor; they never reimplement
    /// a second antichatter (the only stabilizing element is the kernel's coherence-gated
    /// deadzone, zero on committed motion).
    /// </summary>
    public abstract class GameFilterBase : IPositionedPipelineElement<IDeviceReport>
    {
        public PipelinePosition Position => PipelinePosition.PreTransform;
        public event Action<IDeviceReport> Emit;

        protected readonly GameFilterCore core = new GameFilterCore();
        readonly HPETDeltaStopwatch stopwatch = new HPETDeltaStopwatch(true);
        Vector2 mmScale = Vector2.One, invMmScale = Vector2.One;

        protected GameFilterBase(GameFilterCore.Game g, GameFilterCore.Member m)
        { core.Which = g; core.Kind = m; }

        [TabletReference]
        public TabletReference TabletReference
        {
            set
            {
                var dig = value.Properties.Specifications.Digitizer;
                mmScale = new Vector2(dig.Width / dig.MaxX, dig.Height / dig.MaxY);
                invMmScale = new Vector2(1f / mmScale.X, 1f / mmScale.Y);
            }
        }

        public void Consume(IDeviceReport value)
        {
            if (value is OutOfRangeReport) { core.Reset(); Emit?.Invoke(value); return; }
            if (value is IAbsolutePositionReport report)
            {
                var dt = stopwatch.Restart().TotalMilliseconds;
                report.Position = core.Filter(report.Position * mmScale, dt) * invMmScale;
                value = report;
            }
            Emit?.Invoke(value);
        }

        // ---- uniform property surface (doubles only, so plans and read-back stay uniform;
        //      settings that a given game's policy does not use are inert on that filter) ----
        [Property("Rail Strength"), DefaultPropertyValue(0.0d), ToolTip("Orthogonal damping on THIS report's delta inside the game's rail condition. A heading bias, never a position trail. 0 = off.")]
        public double RailStrength { get => core.RailStrength; set => core.RailStrength = value; }
        [Property("Rail Ceiling"), DefaultPropertyValue(18.0d), Unit("mm/s"), ToolTip("OW2 hybrid: above this pen speed the rail is 0 so projectile corrections stay free.")]
        public double RailCeilMmS { get => core.RailCeilMmS; set => core.RailCeilMmS = value; }
        [Property("Snap Cone"), DefaultPropertyValue(9.0d), Unit("deg"), ToolTip("The build's RawAccel snap cone. CoD: rail applies inside it (vertical). OW2: rail SKIPS inside it so snapping and rail never stack.")]
        public double SnapDeg { get => core.SnapDeg; set => core.SnapDeg = value; }
        [Property("Vertical Only"), DefaultPropertyValue(1.0d), ToolTip("CoD: 1 = rail only near-vertical motion (recoil rails). 0 = any heading.")]
        public double VerticalOnly { get => core.VerticalOnly; set => core.VerticalOnly = value; }
        [Property("Max Deadzone"), DefaultPropertyValue(0.0d), Unit("mm"), ToolTip("Coherence-and-speed-gated rest deadzone (VelocityGuard-shaped). ZERO once motion is committed. 0 = off.")]
        public double MaxDzMm { get => core.MaxDzMm; set => core.MaxDzMm = value; }
        [Property("Deadzone Knee"), DefaultPropertyValue(8.0d), Unit("mm/s"), ToolTip("Deadzone scales to zero at this pen speed.")]
        public double KneeMmS { get => core.KneeMmS; set => core.KneeMmS = value; }
        [Property("Flush On Turn"), DefaultPropertyValue(60.0d), Unit("deg"), ToolTip("Valorant: a heading change beyond this flushes the deadzone the same report (peek jig).")]
        public double FlushOnTurnDeg { get => core.FlushOnTurnDeg; set => core.FlushOnTurnDeg = value; }
        [Property("Track Glue"), DefaultPropertyValue(0.0d), ToolTip("Apex/Rivals: scales orthogonal jitter only, in track zone, only while coherent and straight. Never along-track. 0 = off.")]
        public double TrackGlue { get => core.TrackGlue; set => core.TrackGlue = value; }
        [Property("Anti-Trail Turn"), DefaultPropertyValue(25.0d), Unit("deg"), ToolTip("Apex/Rivals law: a turn beyond this (or flick zone) = raw output this report, no residual pin.")]
        public double AntiTrailTurnDeg { get => core.AntiTrailTurnDeg; set => core.AntiTrailTurnDeg = value; }
        [Property("Brake Drop Fraction"), DefaultPropertyValue(0.45d), ToolTip("Finals: speed dropping this fraction from its short-window peak triggers the one-two-report brake.")]
        public double BrakeDropFrac { get => core.BrakeDropFrac; set => core.BrakeDropFrac = value; }
        [Property("Brake Window"), DefaultPropertyValue(40.0d), Unit("ms"), ToolTip("Finals: window the decel is measured over.")]
        public double BrakeWindowMs { get => core.BrakeWindowMs; set => core.BrakeWindowMs = value; }
        [Property("Brake Gain"), DefaultPropertyValue(0.55d), ToolTip("Finals: this report's delta scale during the brake event. An event, not a smoother.")]
        public double BrakeGain { get => core.BrakeGain; set => core.BrakeGain = value; }
        [Property("Brake Hold Reports"), DefaultPropertyValue(2.0d), ToolTip("Finals: how many reports the brake scales before raw resumes.")]
        public double BrakeHoldReports { get => core.BrakeHoldReports; set => core.BrakeHoldReports = value; }
        [Property("Hold Assist"), DefaultPropertyValue(0.0d), Unit("ms"), ToolTip("CoD LAB ONLY - this IS light hold smoothing (T3). Forbidden on Master-role builds; the rule engine enforces it.")]
        public double HoldAssistMs { get => core.HoldAssistMs; set => core.HoldAssistMs = value; }
        [Property("EMA Amount"), DefaultPropertyValue(0.0d), ToolTip("Valorant LAB ONLY - tiny EMA (<=0.06), Planted cards only (T3).")]
        public double EmaAmount { get => core.EmaAmount; set => core.EmaAmount = value; }
        [Property("Ortho Cap"), DefaultPropertyValue(0.15d), Unit("mm"), ToolTip("OW2 LAB (Guardrail): hard per-report cap on the orthogonal component before the rail scales it.")]
        public double OrthoCapMm { get => core.OrthoCapMm; set => core.OrthoCapMm = value; }
        [Property("Ignore Snap"), DefaultPropertyValue(0.0d), ToolTip("Rivals: 1 = never apply any snap-cone logic regardless of the build's snap (no magnetization in a projectile-heavy game).")]
        public double IgnoreSnap { get => core.IgnoreSnap; set => core.IgnoreSnap = value; }
        [Property("Contact Only"), DefaultPropertyValue(0.0d), ToolTip("Holdfast: informational mirror of the HDL contact-only policy. The filter itself stays identity; HDL owns hover.")]
        public double ContactOnly { get => core.ContactOnly; set => core.ContactOnly = value; }
        [Property("Mode Hybrid"), DefaultPropertyValue(1.0d), ToolTip("OW2: 1 = hybrid (rail only in micro/tap under the ceiling). Master stays hybrid.")]
        public double ModeHybrid { get => core.ModeHybrid; set => core.ModeHybrid = value; }
        [Property("Zone Floor Until"), DefaultPropertyValue(15.0d), Unit("mm/s"), ToolTip("Curve landmark from the active build: micro zone ends here.")]
        public double FloorUntilMmS { get => core.FloorUntilMmS; set => core.FloorUntilMmS = value; }
        [Property("Zone Tap Until"), DefaultPropertyValue(55.0d), Unit("mm/s"), ToolTip("Curve landmark from the active build: tap zone ends here.")]
        public double TapUntilMmS { get => core.TapUntilMmS; set => core.TapUntilMmS = value; }
        [Property("Zone Track Until"), DefaultPropertyValue(150.0d), Unit("mm/s"), ToolTip("Curve landmark from the active build: track zone ends here; above is flick.")]
        public double TrackUntilMmS { get => core.TrackUntilMmS; set => core.TrackUntilMmS = value; }
    }

    [PluginName("AimForge CoD Master (recoil rail, T1)")]
    public class CodMaster : GameFilterBase { public CodMaster() : base(GameFilterCore.Game.Cod, GameFilterCore.Member.Master) { } }
    [PluginName("AimForge CoD Lab (hold assist, T3)")]
    public class CodLab : GameFilterBase { public CodLab() : base(GameFilterCore.Game.Cod, GameFilterCore.Member.Lab) { } }
    [PluginName("AimForge Valorant Master (peek deadzone, T1)")]
    public class ValMaster : GameFilterBase { public ValMaster() : base(GameFilterCore.Game.Val, GameFilterCore.Member.Master) { } }
    [PluginName("AimForge Valorant Lab (tiny EMA, T3)")]
    public class ValLab : GameFilterBase { public ValLab() : base(GameFilterCore.Game.Val, GameFilterCore.Member.Lab) { } }
    [PluginName("AimForge Apex Master (track glue, T1)")]
    public class ApexMaster : GameFilterBase { public ApexMaster() : base(GameFilterCore.Game.Apex, GameFilterCore.Member.Master) { } }
    [PluginName("AimForge OW2 Master (hybrid rail, T1)")]
    public class Ow2Master : GameFilterBase { public Ow2Master() : base(GameFilterCore.Game.Ow2, GameFilterCore.Member.Master) { } }
    [PluginName("AimForge OW2 Lab (guardrail, T3)")]
    public class Ow2Lab : GameFilterBase { public Ow2Lab() : base(GameFilterCore.Game.Ow2, GameFilterCore.Member.Lab) { } }
    [PluginName("AimForge Rivals Master (flyer glue, T1)")]
    public class RivalsMaster : GameFilterBase { public RivalsMaster() : base(GameFilterCore.Game.Rivals, GameFilterCore.Member.Master) { } }
    [PluginName("AimForge Finals Master (decel brake, T1)")]
    public class FinalsMaster : GameFilterBase { public FinalsMaster() : base(GameFilterCore.Game.Finals, GameFilterCore.Member.Master) { } }
    [PluginName("AimForge Holdfast Master (identity, T0)")]
    public class HoldfastMaster : GameFilterBase { public HoldfastMaster() : base(GameFilterCore.Game.Holdfast, GameFilterCore.Member.Master) { } }

    /// <summary>
    /// Cadence Lock engine (T0): the build's curve applied in tablet space on the pen's own
    /// report clock. Must be the LAST aim filter in the chain (the game filters and the
    /// stabilizer reason in raw millimetres); AimForge appends it last on apply. When this is
    /// ON, AimForge writes RawAccel flat (noaccel) - the Doctor flags any other pairing as
    /// double acceleration.
    /// </summary>
    [PluginName("AimForge Cadence Lock (tablet-space accel, T0)")]
    public class CadenceLock : IPositionedPipelineElement<IDeviceReport>
    {
        public PipelinePosition Position => PipelinePosition.PreTransform;
        public event Action<IDeviceReport> Emit;
        readonly CadenceCore core = new CadenceCore();
        readonly HPETDeltaStopwatch stopwatch = new HPETDeltaStopwatch(true);

        [TabletReference]
        public TabletReference TabletReference
        {
            set
            {
                var dig = value.Properties.Specifications.Digitizer;
                core.UnitsPerMm = dig.MaxX / dig.Width;     // DTC-141: 30900 / 309 = 100
            }
        }

        double probeClock; int probeReports; string probePath;

        public void Consume(IDeviceReport value)
        {
            if (value is OutOfRangeReport) { core.Reset(); Emit?.Invoke(value); return; }
            if (value is IAbsolutePositionReport report)
            {
                var dt = stopwatch.Restart().TotalMilliseconds;
                report.Position = core.Filter(report.Position, dt);
                value = report;
                if (Probe >= 1) ProbeTick(dt);
            }
            Emit?.Invoke(value);
        }

        // Cadence probe: while the pen is moving, every 2 s append the running estimate of the
        // hardware report rate next to the plugin dll (AimForge --pen-rate reads it). The one
        // way "266 or 360" was settled: 360.2 Hz measured 2026-09-07 (ev-20260907-pen-rate).
        void ProbeTick(double dt)
        {
            if (dt <= 0 || dt > 50) return;
            probeClock += dt; probeReports++;
            if (probeClock < 2000) return;
            double rawHz = probeReports / probeClock * 1000.0;
            probeClock = 0; probeReports = 0;
            try
            {
                // OTD loads plugins from memory (Assembly.Location is empty) - the daemon's base dir is deterministic
                probePath ??= System.IO.Path.Combine(AppContext.BaseDirectory, "cadence-probe.txt");
                System.IO.File.AppendAllText(probePath, string.Format(System.Globalization.CultureInfo.InvariantCulture,
                    "{0:yyyy-MM-dd HH:mm:ss}  raw {1:0.0} Hz (reports/elapsed, 2s window)  estimate {2:0.0} Hz (trained {3})" + Environment.NewLine,
                    DateTime.Now, rawHz, core.LiveHz, core.Trained));
            }
            catch { }
        }

        [Property("Probe"), DefaultPropertyValue(0.0d), ToolTip("1 = log the measured report rate every 2s to cadence-probe.txt beside the plugin (read with AimForge --pen-rate). 0 = off.")]
        public double Probe { get; set; }

        [Property("Nominal Hz"), DefaultPropertyValue(0.0d), Unit("Hz"), ToolTip("The pen's hardware report rate. DTC-141 MEASURED 360.2 Hz (2026-09-07). 0 = auto-estimate (running mean; turns the probe on).")]
        public double NominalHz { get => core.NominalHz; set => core.NominalHz = value; }
        [Property("Merge Max Reports"), DefaultPropertyValue(8.0d), ToolTip("A gap is priced as this many reports at most; dt is always rounded to a whole number of reports, never divided as wall-clock time.")]
        public double MergeMaxReports { get => core.MergeMaxReports; set => core.MergeMaxReports = value; }

        // Classic cards run the driver's own formula natively (exact); when ClassicAccel > 0 the
        // LUT points below are ignored.
        [Property("IntentSpeed"), DefaultPropertyValue(0.0d), ToolTip("EXPERIMENTAL (T1): 1 = the curve reads the coherent velocity |EMA(delta)| instead of this report's speed (cancels lattice alternation and orthogonal tremor on the ramp). Position still moves on the same report. 0 = off.")]
        public double IntentSpeed { get => core.IntentSpeed; set => core.IntentSpeed = value; }
        [Property("IntentTauMs"), DefaultPropertyValue(6.0d), Unit("ms"), ToolTip("Intent Speed velocity EMA time constant.")]
        public double IntentTauMs { get => core.IntentTauMs; set => core.IntentTauMs = value; }
        [Property("ReversalCarryMs"), DefaultPropertyValue(0.0d), Unit("ms"), ToolTip("EXPERIMENTAL, Lab-only (T1): hold the previous leg's gain through a strafe-tracking turnaround, fading over this many ms. 0 = off.")]
        public double ReversalCarryMs { get => core.ReversalCarryMs; set => core.ReversalCarryMs = value; }
        [Property("DropCheck"), DefaultPropertyValue(0.0d), ToolTip("1 = a long gap is priced as merged reports only when its travel says so (a LATE single report carries one report of travel; a dropped pair carries two). Removes the half-speed misprice of late reports; never adds latency. 0 = gap alone (v1.2 behaviour).")]
        public double DropCheck { get => core.DropCheck; set => core.DropCheck = value; }

        [Property("ClassicAccel"), DefaultPropertyValue(0.0d), ToolTip("Classic accel per mm/s (= RawAccel accel x px/mm / 1000). 0 = use the LUT points.")]
        public double ClassicAccel { get => core.ClassicAccel; set => core.ClassicAccel = value; }
        [Property("ClassicOffset"), DefaultPropertyValue(0.0d), Unit("mm/s"), ToolTip("Classic input offset in mm/s of pen travel; unity below it.")]
        public double ClassicOffset { get => core.ClassicOffset; set => core.ClassicOffset = value; }
        [Property("ClassicCap"), DefaultPropertyValue(1.0d), ToolTip("Classic output cap (sensitivity multiplier ceiling).")]
        public double ClassicCap { get => core.ClassicCap; set => core.ClassicCap = value; }
        [Property("ClassicExp"), DefaultPropertyValue(2.0d), ToolTip("Classic exponent (RawAccel exponentClassic; AimForge authors 2).")]
        public double ClassicExp { get => core.ClassicExp; set => core.ClassicExp = value; }

        // The curve: up to 8 (mm/s, gain) points, RawAccel LUT semantics. Doubles only so the
        // apply contract stays uniform with every other AimForge property (plan + read-back).
        [Property("P1Speed"), DefaultPropertyValue(0.0d), Unit("mm/s")] public double P1Speed { get => core.Vs[0]; set => core.Vs[0] = value; }
        [Property("P1Gain"),  DefaultPropertyValue(1.0d)]               public double P1Gain  { get => core.Gs[0]; set => core.Gs[0] = value; }
        [Property("P2Speed"), DefaultPropertyValue(0.0d), Unit("mm/s")] public double P2Speed { get => core.Vs[1]; set => core.Vs[1] = value; }
        [Property("P2Gain"),  DefaultPropertyValue(1.0d)]               public double P2Gain  { get => core.Gs[1]; set => core.Gs[1] = value; }
        [Property("P3Speed"), DefaultPropertyValue(0.0d), Unit("mm/s")] public double P3Speed { get => core.Vs[2]; set => core.Vs[2] = value; }
        [Property("P3Gain"),  DefaultPropertyValue(1.0d)]               public double P3Gain  { get => core.Gs[2]; set => core.Gs[2] = value; }
        [Property("P4Speed"), DefaultPropertyValue(0.0d), Unit("mm/s")] public double P4Speed { get => core.Vs[3]; set => core.Vs[3] = value; }
        [Property("P4Gain"),  DefaultPropertyValue(1.0d)]               public double P4Gain  { get => core.Gs[3]; set => core.Gs[3] = value; }
        [Property("P5Speed"), DefaultPropertyValue(0.0d), Unit("mm/s")] public double P5Speed { get => core.Vs[4]; set => core.Vs[4] = value; }
        [Property("P5Gain"),  DefaultPropertyValue(1.0d)]               public double P5Gain  { get => core.Gs[4]; set => core.Gs[4] = value; }
        [Property("P6Speed"), DefaultPropertyValue(0.0d), Unit("mm/s")] public double P6Speed { get => core.Vs[5]; set => core.Vs[5] = value; }
        [Property("P6Gain"),  DefaultPropertyValue(1.0d)]               public double P6Gain  { get => core.Gs[5]; set => core.Gs[5] = value; }
        [Property("P7Speed"), DefaultPropertyValue(0.0d), Unit("mm/s")] public double P7Speed { get => core.Vs[6]; set => core.Vs[6] = value; }
        [Property("P7Gain"),  DefaultPropertyValue(1.0d)]               public double P7Gain  { get => core.Gs[6]; set => core.Gs[6] = value; }
        [Property("P8Speed"), DefaultPropertyValue(0.0d), Unit("mm/s")] public double P8Speed { get => core.Vs[7]; set => core.Vs[7] = value; }
        [Property("P8Gain"),  DefaultPropertyValue(1.0d)]               public double P8Gain  { get => core.Gs[7]; set => core.Gs[7] = value; }
    }

    /// <summary>
    /// NIB TWIN - see NibTwinCore. The FIRST aim filter in the chain (AimForge places it there), so the stabilizer's Tap
    /// Anchor, the game filters and either curve engine all see the hand without the click skid.
    /// </summary>
    [PluginName("AimForge Nib Twin (click-skid cancel, T1)")]
    public class NibTwin : IPositionedPipelineElement<IDeviceReport>
    {
        public PipelinePosition Position => PipelinePosition.PreTransform;
        public event Action<IDeviceReport> Emit;
        readonly NibTwinCore core = new NibTwinCore();
        readonly HPETDeltaStopwatch stopwatch = new HPETDeltaStopwatch(true);
        Vector2 mmScale = Vector2.One, invMmScale = Vector2.One; double invMaxPressure;

        [TabletReference]
        public TabletReference TabletReference
        {
            set
            {
                var dig = value.Properties.Specifications.Digitizer;
                mmScale = new Vector2(dig.Width / dig.MaxX, dig.Height / dig.MaxY);
                invMmScale = new Vector2(1f / mmScale.X, 1f / mmScale.Y);
                // tip pressure read the same way the Coherence Stabilizer reads it (no pressure range = none)
                var max = value.Properties.Specifications.Pen?.MaxPressure ?? 0u;
                invMaxPressure = max > 0u ? 1.0 / max : 0.0;
            }
        }

        public void Consume(IDeviceReport value)
        {
            if (value is OutOfRangeReport) { core.Reset(); if (Probe >= 1) NibLogBreak(); Emit?.Invoke(value); return; }
            if (value is IAbsolutePositionReport report)
            {
                var dt = stopwatch.Restart().TotalMilliseconds;
                double p01 = value is ITabletReport tablet && invMaxPressure > 0.0 ? Math.Min(1.0, tablet.Pressure * invMaxPressure) : 0.0;
                if (Probe >= 1) NibLogTick(report.Position, dt, p01);   // calibration log: the RAW pen, before any filter
                report.Position = core.Filter(report.Position * mmScale, dt, p01) * invMmScale;
                value = report;
            }
            Emit?.Invoke(value);
        }

        // Nib calibration log (Probe 1, written only by AimForge --nib-calibrate): every press with 20 reports of
        // lead-in and 90 after release, as "dtMs pressure01 x y" lines (tablet units), appended to nibtwin-probe.txt
        // beside the daemon. Nothing is logged while the pen is in hover.
        readonly System.Collections.Generic.Queue<string> nibPre = new System.Collections.Generic.Queue<string>();
        readonly System.Text.StringBuilder nibBuf = new System.Text.StringBuilder();
        int nibPost = -1; string nibPath;
        void NibLogTick(System.Numerics.Vector2 pos, double dt, double p01)
        {
            if (dt > 50) NibLogBreak();   // a lift or gap ends the block: the next report is not pen motion from this one
            string line = string.Format(System.Globalization.CultureInfo.InvariantCulture, "{0:0.###} {1:0.#####} {2:0.##} {3:0.##}", dt, p01, pos.X, pos.Y);
            if (p01 > 0)
            {
                if (nibPost < 0) { nibBuf.Append("#press").Append(Environment.NewLine); foreach (var l in nibPre) nibBuf.Append(l).Append(Environment.NewLine); nibPre.Clear(); }
                nibBuf.Append(line).Append(Environment.NewLine); nibPost = 90; return;
            }
            if (nibPost > 0) { nibBuf.Append(line).Append(Environment.NewLine); if (--nibPost == 0) { NibFlush(); nibPost = -1; } return; }
            nibPre.Enqueue(line); while (nibPre.Count > 20) nibPre.Dequeue();
        }
        void NibLogBreak() { if (nibPost >= 0) { NibFlush(); nibPost = -1; } nibPre.Clear(); }
        void NibFlush()
        {
            try
            {
                nibPath ??= System.IO.Path.Combine(AppContext.BaseDirectory, "nibtwin-probe.txt");
                System.IO.File.AppendAllText(nibPath, nibBuf.ToString());
            }
            catch { }
            nibBuf.Clear();
        }


        [Property("Twin"), DefaultPropertyValue(0.0d), ToolTip("EXPERIMENTAL (T1): 1 = remove the calibrated nib swing (click skid) from each report on the same report, keyed on tip pressure. Needs AimForge --nib-calibrate. 0 = exact passthrough.")]
        public double Twin { get => core.Twin; set => core.Twin = value; }
        [Property("SkidXmm"), DefaultPropertyValue(0.0d), Unit("mm")] public double SkidXmm { get => core.SkidXmm; set => core.SkidXmm = value; }
        [Property("SkidYmm"), DefaultPropertyValue(0.0d), Unit("mm")] public double SkidYmm { get => core.SkidYmm; set => core.SkidYmm = value; }
        [Property("SkidFullPressure"), DefaultPropertyValue(0.35d)] public double SkidFullPressure { get => core.SkidFullPressure; set => core.SkidFullPressure = value; }
        [Property("SkidGamma"), DefaultPropertyValue(1.0d)] public double SkidGamma { get => core.SkidGamma; set => core.SkidGamma = value; }
        [Property("SkidLagReports"), DefaultPropertyValue(0.0d)] public double SkidLagReports { get => core.SkidLagReports; set => core.SkidLagReports = value; }
        [Property("NominalHz"), DefaultPropertyValue(0.0d), Unit("Hz"), ToolTip("The pen's report rate (AimForge writes the build's pen Hz). 0 = learn it.")]
        public double NominalHz { get => core.NominalHz; set => core.NominalHz = value; }
        [Property("Probe"), DefaultPropertyValue(0.0d), ToolTip("1 = log every press (raw pen, before any filter) to nibtwin-probe.txt beside the daemon, for AimForge --nib-calibrate. 0 = off.")]
        public double Probe { get; set; }
    }
}
