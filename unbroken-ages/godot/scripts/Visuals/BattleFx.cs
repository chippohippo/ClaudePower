using Godot;

namespace UnbrokenAges.Client.Visuals;

/// <summary>
/// What a battle looks like on the map: arrows and shells fly in an arc from the attacker, bombs fall, and the target is hit
/// with dust and sparks (blades), a puff (arrows) or fire and smoke (gunpowder, siege and air). The damage dealt rises from
/// the target as a number and fades. Everything is a short-lived node that frees itself.
/// </summary>
public partial class BattleFx : Node3D
{
    public enum Kind { Melee, Arrow, Shell, Bomb }

    /// <summary>A soft round puff: white in the middle, fading to nothing at the rim.</summary>
    private static readonly GradientTexture2D Puff = new()
    {
        Width = 64, Height = 64, Fill = GradientTexture2D.FillEnum.Radial, FillFrom = new Vector2(0.5f, 0.5f), FillTo = new Vector2(1f, 0.5f),
        Gradient = new Gradient { Colors = new[] { new Color(1, 1, 1, 1), new Color(1, 1, 1, 0.55f), new Color(1, 1, 1, 0) }, Offsets = new[] { 0f, 0.45f, 1f } },
    };

    private static StandardMaterial3D Unshaded(Color c, bool additive = false) => new()
    {
        AlbedoTexture = Puff,
        AlbedoColor = c, ShadingMode = BaseMaterial3D.ShadingModeEnum.Unshaded, Transparency = BaseMaterial3D.TransparencyEnum.Alpha,
        BlendMode = additive ? BaseMaterial3D.BlendModeEnum.Add : BaseMaterial3D.BlendModeEnum.Mix,
        BillboardMode = BaseMaterial3D.BillboardModeEnum.Particles, VertexColorUseAsAlbedo = true,
    };

    public void Strike(Vector3 from, Vector3 to, int damage, Kind kind)
    {
        if (kind == Kind.Melee)
        {
            Impact(to, kind, damage);
            return;
        }
        // A projectile: an arrow is a dark streak, a shell a glowing ball, a bomb falls from above.
        var shot = new MeshInstance3D
        {
            Mesh = kind == Kind.Arrow ? new BoxMesh { Size = new Vector3(0.012f, 0.012f, 0.12f) } : new SphereMesh { Radius = 0.035f, Height = 0.07f, RadialSegments = 8, Rings = 4 },
            MaterialOverride = kind == Kind.Arrow ? new StandardMaterial3D { AlbedoColor = new Color(0.2f, 0.15f, 0.1f) }
                                                  : new StandardMaterial3D { AlbedoColor = new Color(1f, 0.7f, 0.3f), EmissionEnabled = true, Emission = new Color(1f, 0.55f, 0.2f), EmissionEnergyMultiplier = 3f },
            CastShadow = GeometryInstance3D.ShadowCastingSetting.Off,
        };
        AddChild(shot);
        var start = kind == Kind.Bomb ? to + new Vector3(0, 2.2f, 0) : from + new Vector3(0, 0.35f, 0);
        var end = to + new Vector3(0, 0.15f, 0);
        float height = kind == Kind.Bomb ? 0 : Mathf.Clamp(start.DistanceTo(end) * 0.35f, 0.4f, 1.6f);
        float seconds = kind == Kind.Bomb ? 0.5f : Mathf.Clamp(start.DistanceTo(end) * 0.12f, 0.35f, 0.8f);
        shot.Position = start;
        var tween = CreateTween();
        tween.TweenMethod(Callable.From<float>(t =>
        {
            if (!IsInstanceValid(shot)) return;
            var p = start.Lerp(end, t) + new Vector3(0, height * 4 * t * (1 - t), 0);
            var ahead = start.Lerp(end, Mathf.Min(1, t + 0.02f)) + new Vector3(0, height * 4 * (t + 0.02f) * (1 - t - 0.02f), 0);
            shot.Position = p;
            if (p.DistanceSquaredTo(ahead) > 1e-6f) shot.LookAt(ahead, Vector3.Up);
        }), 0f, 1f, seconds);
        tween.TweenCallback(Callable.From(() => { shot.QueueFree(); Impact(to, kind, damage); }));
    }

    private void Impact(Vector3 at, Kind kind, int damage)
    {
        bool fire = kind is Kind.Shell or Kind.Bomb;
        // Dust (or smoke) billowing out, and sparks (or flame) flying.
        AddBurst(at + new Vector3(0, 0.1f, 0), amount: fire ? 26 : 16, lifetime: fire ? 1.4f : 0.9f, size: fire ? 0.22f : 0.13f, speed: fire ? 0.9f : 0.6f,
                 colorA: fire ? new Color(0.35f, 0.33f, 0.32f, 0.85f) : new Color(0.72f, 0.62f, 0.46f, 0.8f), colorB: new Color(0.5f, 0.46f, 0.4f, 0f), additive: false, gravity: 0.25f);
        AddBurst(at + new Vector3(0, 0.15f, 0), amount: fire ? 22 : 10, lifetime: fire ? 0.5f : 0.35f, size: fire ? 0.12f : 0.035f, speed: fire ? 1.6f : 1.4f,
                 colorA: fire ? new Color(1f, 0.75f, 0.3f, 1f) : new Color(1f, 0.92f, 0.6f, 1f), colorB: new Color(1f, 0.3f, 0.1f, 0f), additive: true, gravity: fire ? 0.5f : -2f);
        if (fire)
        {
            var flash = new OmniLight3D { LightColor = new Color(1f, 0.6f, 0.25f), LightEnergy = 4f, OmniRange = 2.2f, Position = at + new Vector3(0, 0.4f, 0) };
            AddChild(flash);
            var fade = CreateTween();
            fade.TweenProperty(flash, "light_energy", 0f, 0.45f);
            fade.TweenCallback(Callable.From(flash.QueueFree));
        }
        if (damage > 0)
        {
            var label = new Label3D
            {
                Text = $"−{damage}", FontSize = 64, PixelSize = 0.004f, OutlineSize = 7, OutlineModulate = new Color(0.16f, 0.08f, 0.05f, 0.9f), Modulate = damage >= 30 ? new Color(1f, 0.35f, 0.3f) : new Color(1f, 0.85f, 0.5f),
                Billboard = BaseMaterial3D.BillboardModeEnum.Enabled, NoDepthTest = true, RenderPriority = 5, Position = at + new Vector3(0, 0.6f, 0),
            };
            AddChild(label);
            var rise = CreateTween().SetParallel();
            rise.TweenProperty(label, "position", label.Position + new Vector3(0, 0.55f, 0), 1.3f).SetEase(Tween.EaseType.Out).SetTrans(Tween.TransitionType.Cubic);
            rise.TweenProperty(label, "modulate:a", 0f, 1.3f).SetDelay(0.4f);
            rise.Chain().TweenCallback(Callable.From(label.QueueFree));
        }
    }

    private void AddBurst(Vector3 at, int amount, float lifetime, float size, float speed, Color colorA, Color colorB, bool additive, float gravity)
    {
        var p = new CpuParticles3D
        {
            Emitting = false, OneShot = true, Amount = amount, Lifetime = lifetime, Explosiveness = 0.95f, Position = at,
            Mesh = new QuadMesh { Size = new Vector2(size, size), Material = Unshaded(Colors.White, additive) },
            Direction = Vector3.Up, Spread = 75f, InitialVelocityMin = speed * 0.5f, InitialVelocityMax = speed, Gravity = new Vector3(0, -gravity, 0),
            ScaleAmountMin = 0.6f, ScaleAmountMax = 1.4f, DampingMin = 1f, DampingMax = 2f,
            ColorRamp = new Gradient { Colors = new[] { colorA, colorB }, Offsets = new[] { 0f, 1f } },
        };
        AddChild(p);
        p.Restart();
        p.Emitting = true;
        GetTree().CreateTimer(lifetime + 0.3f).Timeout += p.QueueFree;
    }
}
