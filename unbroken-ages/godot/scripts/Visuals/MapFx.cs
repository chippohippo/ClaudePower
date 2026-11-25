using Godot;

namespace UnbrokenAges.Client.Visuals;

/// <summary>
/// Short-lived spectacle on the map, shared by units, cities and cinematics: dust kicked up underfoot, sparkles, a pillar of
/// light, a ring of light spreading over the ground, fireworks, smoke. Every effect is a node that frees itself.
/// </summary>
public partial class MapFx : Node3D
{
    public static MapFx? Current { get; private set; }

    public override void _Ready() => Current = this;
    public override void _ExitTree() { if (Current == this) Current = null; }

    private CpuParticles3D Burst(Vector3 at, int amount, float lifetime, float size, float speed, Color a, Color b, bool additive, float gravity,
                                 float spread = 75f, Vector3? direction = null, float explosiveness = 0.95f)
    {
        var p = new CpuParticles3D
        {
            Emitting = false, OneShot = true, Amount = amount, Lifetime = lifetime, Explosiveness = explosiveness, Position = at,
            Mesh = new QuadMesh { Size = new Vector2(size, size), Material = BattleFx.Unshaded(Colors.White, additive) },
            Direction = direction ?? Vector3.Up, Spread = spread, InitialVelocityMin = speed * 0.5f, InitialVelocityMax = speed,
            Gravity = new Vector3(0, -gravity, 0), ScaleAmountMin = 0.6f, ScaleAmountMax = 1.4f, DampingMin = 1f, DampingMax = 2.5f,
            ColorRamp = new Gradient { Colors = new[] { a, b }, Offsets = new[] { 0f, 1f } },
        };
        AddChild(p);
        p.Restart();
        p.Emitting = true;
        GetTree().CreateTimer(lifetime + 0.4f).Timeout += p.QueueFree;
        return p;
    }

    /// <summary>A puff of dust underfoot (a step, a landing, a fall).</summary>
    public void Dust(Vector3 at, float strength = 1f) =>
        Burst(at + new Vector3(0, 0.03f, 0), (int)(10 * strength) + 4, 0.8f, 0.09f * strength + 0.04f, 0.45f, new Color(0.72f, 0.63f, 0.48f, 0.7f),
              new Color(0.6f, 0.54f, 0.44f, 0f), false, 0.15f, spread: 85f);

    /// <summary>Motes of light rising (a unit is raised, a great person arrives).</summary>
    public void Sparkles(Vector3 at, Color color, int amount = 26) =>
        Burst(at + new Vector3(0, 0.1f, 0), amount, 1.3f, 0.05f, 0.9f, color, new Color(color, 0f), true, -0.35f, spread: 40f, explosiveness: 0.6f);

    /// <summary>A ring of light racing out over the ground.</summary>
    public void Shockwave(Vector3 at, Color color, float radius = 2.4f, float seconds = 0.9f)
    {
        var ring = new MeshInstance3D
        {
            Mesh = new TorusMesh { InnerRadius = 0.92f, OuterRadius = 1f, Rings = 48, RingSegments = 4 },
            MaterialOverride = new StandardMaterial3D
            {
                AlbedoColor = color, ShadingMode = BaseMaterial3D.ShadingModeEnum.Unshaded, Transparency = BaseMaterial3D.TransparencyEnum.Alpha,
                BlendMode = BaseMaterial3D.BlendModeEnum.Add, EmissionEnabled = true, Emission = color, EmissionEnergyMultiplier = 2f,
            },
            Position = at + new Vector3(0, 0.06f, 0), Scale = new Vector3(0.1f, 0.05f, 0.1f), CastShadow = GeometryInstance3D.ShadowCastingSetting.Off,
        };
        AddChild(ring);
        var t = CreateTween().SetParallel();
        t.TweenProperty(ring, "scale", new Vector3(radius, 0.05f, radius), seconds).SetEase(Tween.EaseType.Out).SetTrans(Tween.TransitionType.Cubic);
        t.TweenProperty(ring.MaterialOverride, "albedo_color:a", 0f, seconds).SetEase(Tween.EaseType.In);
        t.Chain().TweenCallback(Callable.From(ring.QueueFree));
    }

    /// <summary>A shaft of light standing on the place, fading after <paramref name="seconds"/> (a wonder, a founding, an ascension).</summary>
    public void LightPillar(Vector3 at, Color color, float seconds = 3.5f, float height = 7f, float radius = 0.55f)
    {
        var mat = new StandardMaterial3D
        {
            AlbedoColor = new Color(color, 0f), ShadingMode = BaseMaterial3D.ShadingModeEnum.Unshaded, Transparency = BaseMaterial3D.TransparencyEnum.Alpha,
            BlendMode = BaseMaterial3D.BlendModeEnum.Add, CullMode = BaseMaterial3D.CullModeEnum.Disabled, AlbedoTexture = Beam,
            EmissionEnabled = true, Emission = color, EmissionEnergyMultiplier = 1.5f,
        };
        var shaft = new MeshInstance3D
        {
            Mesh = new CylinderMesh { TopRadius = radius * 1.6f, BottomRadius = radius, Height = height, RadialSegments = 24, Rings = 1, CapTop = false, CapBottom = false },
            MaterialOverride = mat, Position = at + new Vector3(0, height / 2, 0), CastShadow = GeometryInstance3D.ShadowCastingSetting.Off,
        };
        AddChild(shaft);
        var light = new OmniLight3D { LightColor = color, LightEnergy = 0f, OmniRange = 4f, Position = at + new Vector3(0, 0.8f, 0) };
        AddChild(light);
        // Fade in, hold, fade out; the beam turns slowly all the while.
        var t = CreateTween();
        t.TweenProperty(mat, "albedo_color:a", 0.26f, 0.6f);
        t.Parallel().TweenProperty(light, "light_energy", 3f, 0.6f);
        t.TweenInterval(Mathf.Max(0f, seconds - 1.8f));
        t.TweenProperty(mat, "albedo_color:a", 0f, 1.2f);
        t.Parallel().TweenProperty(light, "light_energy", 0f, 1.2f);
        t.TweenCallback(Callable.From(() => { shaft.QueueFree(); light.QueueFree(); }));
        var spin = CreateTween();
        spin.TweenProperty(shaft, "rotation_degrees:y", 120f, seconds);
    }

    /// <summary>Vertical stripes that fade to the top: the inside of a light shaft.</summary>
    private static readonly GradientTexture2D Beam = new()
    {
        Width = 8, Height = 64, FillFrom = new Vector2(0.5f, 1f), FillTo = new Vector2(0.5f, 0f),
        Gradient = new Gradient { Colors = new[] { new Color(1, 1, 1, 1), new Color(1, 1, 1, 0.5f), new Color(1, 1, 1, 0) }, Offsets = new[] { 0f, 0.3f, 1f } },
    };

    /// <summary>Rockets bursting over a city: a celebration (a wonder, a golden age, a victory).</summary>
    public void Fireworks(Vector3 at, int rockets = 5)
    {
        var colors = new[] { new Color(1f, 0.8f, 0.35f), new Color(1f, 0.4f, 0.3f), new Color(0.5f, 0.85f, 1f), new Color(0.7f, 1f, 0.5f), new Color(1f, 0.55f, 0.95f) };
        for (int i = 0; i < rockets; i++)
        {
            var c = colors[i % colors.Length];
            float delay = 0.35f * i;
            var burstAt = at + new Vector3(Mathf.Cos(i * 2.4f) * 0.9f, 2.2f + 0.4f * (i % 3), Mathf.Sin(i * 2.4f) * 0.9f);
            GetTree().CreateTimer(delay).Timeout += () =>
            {
                if (!IsInsideTree()) return;
                Burst(burstAt, 44, 1.4f, 0.06f, 2.2f, c, new Color(c, 0f), true, 0.9f, spread: 180f, direction: Vector3.Up, explosiveness: 1f);
                var flash = new OmniLight3D { LightColor = c, LightEnergy = 3f, OmniRange = 3f, Position = burstAt };
                AddChild(flash);
                var f = CreateTween();
                f.TweenProperty(flash, "light_energy", 0f, 0.6f);
                f.TweenCallback(Callable.From(flash.QueueFree));
            };
        }
    }

    /// <summary>Smoke rising from a burning or fallen place.</summary>
    public void Smoke(Vector3 at, float seconds = 3f) =>
        Burst(at + new Vector3(0, 0.2f, 0), 40, seconds, 0.35f, 0.5f, new Color(0.2f, 0.18f, 0.17f, 0.75f), new Color(0.45f, 0.42f, 0.4f, 0f),
              false, -0.25f, spread: 20f, explosiveness: 0.2f);

    /// <summary>Embers and flame licking up (a captured or razed city).</summary>
    public void Flames(Vector3 at) =>
        Burst(at + new Vector3(0, 0.15f, 0), 36, 1.1f, 0.12f, 0.9f, new Color(1f, 0.65f, 0.2f, 1f), new Color(0.9f, 0.2f, 0.05f, 0f), true, -0.6f,
              spread: 30f, explosiveness: 0.3f);
}
