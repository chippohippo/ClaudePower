using Godot;

namespace UnbrokenAges.Client.Visuals;

/// <summary>
/// The day/night cycle over the map: the sun climbs from a pink dawn to a high noon, sinks into a long golden dusk, and gives way
/// to a short blue night under a cool moon, then dawn again — a few real minutes per day. Low sun is warmer and casts longer
/// shadows; the night keeps a floor on light, so the map always stays readable. It drives the main sun, the fill light and the
/// <see cref="Godot.Environment"/> (ambient, sky, fog, exposure); nothing else in the client sets those, and the cinematic
/// camera only moves the camera, so they never fight.
/// <para>Off (Esc menu), the lights ease back to the fixed late-morning look the map was authored in. <see cref="Freeze"/> holds
/// a time of day (automation's <c>time:0.8</c>, for screenshots). The setting is remembered in <c>user://video.cfg</c>.</para>
/// </summary>
public partial class DayNight : Node
{
    private const string ConfigPath = "user://video.cfg";

    /// <summary>Seconds of real time per full day.</summary>
    public const double CycleSeconds = 300;

    private readonly DirectionalLight3D _sun;
    private readonly DirectionalLight3D _fill;
    private readonly Godot.Environment _env;
    private readonly Func<bool> _active;
    private readonly Look _authored;
    private double _time = 0.12;          // a fresh game opens in the morning
    private double? _frozen;
    private float _blend;                 // 0 = authored fixed look, 1 = the cycle
    private bool _enabled = true;

    /// <summary>One moment of the day: where the sun is and what the light and the air look like.</summary>
    private readonly record struct Look(
        float Elevation, float Yaw, Color Sun, float SunEnergy, float FillEnergy, Color Fill,
        float Ambient, Color AmbientColor, float Sky, Color Fog, Color Background, float Exposure, float Brightness, float Saturation)
    {
        public static Look Lerp(Look a, Look b, float t) => new(
            Mathf.Lerp(a.Elevation, b.Elevation, t), Mathf.Lerp(a.Yaw, b.Yaw, t), a.Sun.Lerp(b.Sun, t), Mathf.Lerp(a.SunEnergy, b.SunEnergy, t),
            Mathf.Lerp(a.FillEnergy, b.FillEnergy, t), a.Fill.Lerp(b.Fill, t), Mathf.Lerp(a.Ambient, b.Ambient, t), a.AmbientColor.Lerp(b.AmbientColor, t),
            Mathf.Lerp(a.Sky, b.Sky, t), a.Fog.Lerp(b.Fog, t), a.Background.Lerp(b.Background, t), Mathf.Lerp(a.Exposure, b.Exposure, t),
            Mathf.Lerp(a.Brightness, b.Brightness, t), Mathf.Lerp(a.Saturation, b.Saturation, t));
    }

    /// <summary>
    /// The day as keyframes (time of day 0..1 → look). Yaw only ever decreases so the light sweeps one way round; after dusk the
    /// "sun" light becomes the moon (it swings over while it is faint, so the jump never shows), and returns as the sun at dawn.
    /// </summary>
    private static readonly (float T, Look L)[] Day =
    {
        (0.00f, new Look(9, 112, new("#ffa47e"), 0.78f, 0.26f, new("#9fb6ff"), 0.42f, new("#b6a2c4"), 0.23f, new("#d6b0aa"), new("#24304a"), 0.95f, 0.95f, 1.06f)),    // dawn
        (0.10f, new Look(26, 84, new("#ffdcb2"), 0.98f, 0.23f, new("#a9c8ff"), 0.49f, new("#a6b6c8"), 0.29f, new("#b5c6d4"), new("#0f2b42"), 0.9f, 1f, 1.12f)),       // morning
        (0.30f, new Look(56, 42, new("#fff1dc"), 1.1f, 0.2f, new("#a9c8ff"), 0.52f, new("#a2b6ca"), 0.33f, new("#aac4d8"), new("#0d2a40"), 0.88f, 1f, 1.12f)),       // noon
        (0.48f, new Look(36, 4, new("#ffe4c0"), 1.02f, 0.22f, new("#a9c8ff"), 0.5f, new("#a8b4c4"), 0.31f, new("#b2c2d0"), new("#0f2a3e"), 0.9f, 1f, 1.12f)),        // afternoon
        (0.62f, new Look(14, -26, new("#ffa055"), 1.05f, 0.27f, new("#8fa6ff"), 0.42f, new("#c8a690"), 0.25f, new("#e0ae80"), new("#2a2a3a"), 0.95f, 0.98f, 1.2f)),  // golden hour
        (0.70f, new Look(5, -40, new("#ff7038"), 0.8f, 0.3f, new("#8a9cff"), 0.38f, new("#a486ac"), 0.2f, new("#c08070"), new("#1e1f34"), 0.98f, 0.93f, 1.16f)),     // dusk
        (0.75f, new Look(3, -75, new("#a87090"), 0.16f, 0.34f, new("#7f96ff"), 0.34f, new("#6c7ab4"), 0.15f, new("#5c6494"), new("#141a30"), 1.0f, 0.84f, 0.92f)),   // blue hour
        (0.80f, new Look(42, -135, new("#9cb6f4"), 0.34f, 0.3f, new("#6f8ae8"), 0.32f, new("#5f7cc0"), 0.13f, new("#40548a"), new("#0b1428"), 1.02f, 0.8f, 0.78f)),  // moonrise
        (0.89f, new Look(50, -195, new("#98b4f4"), 0.36f, 0.3f, new("#6f8ae8"), 0.32f, new("#5c7ac0"), 0.13f, new("#3c5088"), new("#0a1226"), 1.02f, 0.8f, 0.76f)), // night
        (0.95f, new Look(10, -228, new("#9a96cc"), 0.2f, 0.3f, new("#8a9cff"), 0.37f, new("#8684b4"), 0.18f, new("#76708e"), new("#1a2038"), 0.98f, 0.88f, 0.92f)),  // first light
        (1.00f, new Look(9, 112 - 360, new("#ffa47e"), 0.78f, 0.26f, new("#9fb6ff"), 0.42f, new("#b6a2c4"), 0.23f, new("#d6b0aa"), new("#24304a"), 0.95f, 0.95f, 1.06f)),
    };

    public DayNight(DirectionalLight3D sun, DirectionalLight3D fill, Godot.Environment env, Func<bool>? active = null)
    {
        _sun = sun;
        _fill = fill;
        _env = env;
        _active = active ?? (() => true);
        var sky = env.Sky?.SkyMaterial as PanoramaSkyMaterial;
        _authored = new Look(-sun.RotationDegrees.X, sun.RotationDegrees.Y, sun.LightColor, sun.LightEnergy, fill.LightEnergy, fill.LightColor,
            env.AmbientLightEnergy, env.AmbientLightColor, sky?.EnergyMultiplier ?? 0.3f, env.FogLightColor, env.BackgroundColor, env.TonemapExposure,
            env.AdjustmentBrightness, env.AdjustmentSaturation);
        _enabled = Load();
        _blend = _enabled ? 1 : 0;
        Name = "DayNight";
    }

    /// <summary>Whether the cycle runs (the Esc menu's "Day/night cycle"); remembered per machine.</summary>
    public bool Enabled
    {
        get => _enabled;
        set
        {
            _enabled = value;
            var cfg = new ConfigFile();
            cfg.Load(ConfigPath);
            cfg.SetValue("visuals", "day_night", value);
            cfg.Save(ConfigPath);
        }
    }

    /// <summary>The time of day, 0..1 (0 dawn, 0.3 noon, 0.68 dusk, 0.85 night).</summary>
    public double TimeOfDay => _frozen ?? _time;

    /// <summary>Holds the cycle at a time of day (0..1), switching it on; null lets it run again.</summary>
    public void Freeze(double? timeOfDay)
    {
        _frozen = timeOfDay is { } t ? t - Math.Floor(t) : null;
        if (_frozen != null) { _enabled = true; _blend = 1; }
        Apply();
    }

    private static readonly bool Compatibility = RenderingServer.GetRenderingDevice() == null;

    private static bool Load()
    {
        var cfg = new ConfigFile();
        return cfg.Load(ConfigPath) != Error.Ok || (bool)cfg.GetValue("visuals", "day_night", true);
    }

    public override void _Ready() => Apply();

    public override void _Process(double delta)
    {
        float target = _enabled ? 1 : 0;
        _blend = Mathf.MoveToward(_blend, target, (float)delta);   // a second to ease between the cycle and the fixed look
        if (_enabled && _frozen == null && _active()) _time = (_time + delta / CycleSeconds) % 1.0;
        Apply();
    }

    private static Look At(double time)
    {
        float t = (float)(time - Math.Floor(time));
        for (int i = 1; i < Day.Length; i++)
            if (t <= Day[i].T)
            {
                var (t0, a) = Day[i - 1];
                var (t1, b) = Day[i];
                float k = (t - t0) / Mathf.Max(0.0001f, t1 - t0);
                return Look.Lerp(a, b, k * k * (3 - 2 * k));   // smoothstep: no kinks at the keyframes
            }
        return Day[0].L;
    }

    private void Apply()
    {
        var look = At(TimeOfDay);
        if (_blend < 1)
        {
            // Ease the yaw along the short way round to the authored sun.
            var fixedLook = _authored with { Yaw = look.Yaw + Mathf.Wrap(_authored.Yaw - look.Yaw, -180f, 180f) };
            look = Look.Lerp(fixedLook, look, _blend);
        }
        if (Compatibility)
        {
            // The OpenGL renderer has no paper grade to lift the shadows and lights the paper differently: a gentler night there.
            look = look with
            {
                Brightness = Mathf.Lerp(look.Brightness, 1f, 0.6f), Saturation = Mathf.Max(look.Saturation, 0.9f),
                SunEnergy = Mathf.Max(look.SunEnergy, 0.62f), Sun = look.Sun.Lerp(Colors.White, 0.35f), AmbientColor = look.AmbientColor.Lerp(new Color("#b8c4d8"), 0.4f), Ambient = Mathf.Max(look.Ambient, 0.45f), Sky = Mathf.Max(look.Sky, 0.22f),
            };
        }
        _sun.RotationDegrees = new Vector3(-look.Elevation, look.Yaw, 0);
        _sun.LightColor = look.Sun;
        _sun.LightEnergy = look.SunEnergy;
        // Long low-sun shadows reach further than the camera's usual shadow distance would keep sharp: soften them a little.
        _sun.ShadowBlur = Mathf.Lerp(2.2f, 1.5f, Mathf.Clamp((look.Elevation - 5f) / 30f, 0f, 1f));
        // The fill comes from the far side of the sky, opposite the sun.
        _fill.RotationDegrees = new Vector3(-28, look.Yaw + 180, 0);
        _fill.LightEnergy = look.FillEnergy;
        _fill.LightColor = look.Fill;
        _env.AmbientLightEnergy = look.Ambient;
        _env.AmbientLightColor = look.AmbientColor;
        if (_env.Sky?.SkyMaterial is PanoramaSkyMaterial sky) sky.EnergyMultiplier = look.Sky;
        _env.FogLightColor = look.Fog;
        _env.BackgroundColor = look.Background;
        _env.TonemapExposure = look.Exposure;
        _env.AdjustmentBrightness = look.Brightness;
        _env.AdjustmentSaturation = look.Saturation;
    }
}
