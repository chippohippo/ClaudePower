using Godot;
using UnbrokenAges.Sim.Data;

namespace UnbrokenAges.Client.Visuals;

/// <summary>
/// A live 3D leader portrait. There is no CC0 leader art, so each leader is one of the project's own rigged figures (KayKit
/// adventurers, the Kenney modern soldier for 20th-century leaders) standing in their nation's colours — cape and hat repainted
/// in the primary, a banner in primary and secondary — on a little terrain plinth in front of the nation's landmark (the same one
/// its capital shows on the map), under a sky in the nation's palette. Rendered in its own <see cref="SubViewport"/> with its own
/// World3D, so it works in any renderer (Safe Mode included).
/// <para><b>Live</b> portraits animate (idle loop, a cheer when shown, a fluttering banner). <b>Static</b> ones render a few
/// frames and then freeze (<see cref="SubViewport.UpdateMode.Once"/>), cheap enough for a row per civilization.</para>
/// </summary>
public partial class LeaderPortrait : SubViewportContainer
{
    private static readonly ModelLibrary Models = new();

    private readonly SubViewport _viewport = new()
    {
        OwnWorld3D = true, TransparentBg = false, Msaa3D = Viewport.Msaa.Msaa2X,
        RenderTargetUpdateMode = SubViewport.UpdateMode.Always, HandleInputLocally = false,
    };
    private readonly Node3D _stage = new();
    private readonly List<AnimationPlayer> _players = new();
    private Node3D? _figure;
    private Node3D? _flag;
    private bool _live;
    private int _captureFrames;
    private double _time;
    private double _nextFidget = 9;
    private string _key = "";

    /// <summary>The figure model chosen for the current leader (for tests and tooltips).</summary>
    public string Figure { get; private set; } = "";

    public LeaderPortrait(Vector2 size, bool live)
    {
        _live = live;
        CustomMinimumSize = size;
        Stretch = true;
        MouseFilter = MouseFilterEnum.Pass;
        AddChild(_viewport);
        _viewport.AddChild(_stage);
    }

    /// <summary>Animated (true) or render-once (false). A static portrait can be woken, e.g. while the row is hovered.</summary>
    public bool Live
    {
        get => _live;
        set
        {
            if (_live == value) return;
            _live = value;
            foreach (var ap in _players.Where(GodotObject.IsInstanceValid))
                if (value) ap.Play(); else ap.Pause();
            if (value) _viewport.RenderTargetUpdateMode = SubViewport.UpdateMode.Always;
            else Capture();
        }
    }

    /// <summary>Builds the portrait of a leader in the given colours (in game, pass the player's resolved scheme).</summary>
    public void Show(LeaderDef? leader, CivilizationDef civ, Color primary, Color secondary)
    {
        string key = $"{leader?.Id}|{civ.Id}|{primary.ToHtml()}|{secondary.ToHtml()}";
        if (key == _key) return;
        _key = key;
        foreach (var c in _stage.GetChildren()) c.Free();
        _players.Clear();
        _figure = null;
        _flag = null;
        BuildWorld(primary, secondary);
        BuildPlinth(civ);
        BuildBanner(primary, secondary);
        BuildFigure(leader, civ, primary);
        if (_live) Greet(); else Capture();
    }

    /// <summary>A short cheer, then back to the idle loop (live portraits only).</summary>
    public void Greet()
    {
        if (!_live) return;
        foreach (var ap in _players.Where(GodotObject.IsInstanceValid))
            if (Find(ap, "Cheering", "Cheer", "Idle_B") is { } clip)
            {
                ap.GetAnimation(clip).LoopMode = Animation.LoopModeEnum.None;
                ap.Play(clip, 0.25);
                ap.Queue(Find(ap, "Idle_A", "Idle", "idle") ?? clip);
            }
    }

    // ----- Choice of figure --------------------------------------------------------------------------

    /// <summary>
    /// The figure for a leader, chosen from what the content says about them: 20th-century leaders (tag WorldWars) wear the
    /// modern uniform; otherwise the strongest leaning of their personality decides — war → Knight (Barbarian for the steppe,
    /// the north and the kraal nations), science → Mage, gold → hooded Rogue, the sea → Rogue, growth and expansion → Ranger.
    /// </summary>
    public static string FigureFor(LeaderDef? leader, CivilizationDef civ)
    {
        if (leader == null) return "units/Rogue";
        if (leader.Tags.Any(t => t.Equals("WorldWars", StringComparison.OrdinalIgnoreCase))) return "units/modern_soldier";
        double W(string k) => leader.Personality.TryGetValue(k, out var v) ? v.ToDouble() : 0;
        double war = W("war"), science = W("science"), gold = W("gold"), naval = W("naval"), growth = Math.Max(W("growth"), W("expansion"));
        bool tribal = CityLayout.Landmark(civ.Id)?.Prop is "landmarks/yurt" or "landmarks/longhouse" or "landmarks/kraal";
        var leanings = new (string Figure, double Weight)[]
        {
            (tribal ? "units/Barbarian" : "units/Knight", war >= 1.2 ? war + 0.05 : 0),   // a warrior wins ties
            ("units/Mage", science >= 1.15 ? science : 0),
            ("units/Rogue_Hooded", gold >= 1.2 ? gold : 0),
            ("units/Rogue", naval >= 1.2 ? naval : 0),
            ("life/Ranger", growth >= 1.2 ? growth : 0),
        };
        var best = leanings.OrderByDescending(l => l.Weight).First();
        if (best.Weight > 0) return best.Figure;
        if (war >= 1.0) return tribal ? "units/Barbarian" : "units/Knight";
        // A peaceable leader with no strong leaning: a stable pick from their id.
        string[] calm = { "units/Rogue", "life/Ranger", "units/Mage" };
        return calm[StableHash(leader.Id) % calm.Length];
    }

    /// <summary>A hash that is the same on every run and machine (string.GetHashCode is randomised per process).</summary>
    private static int StableHash(string text)
    {
        int h = 17;
        foreach (char ch in text) h = unchecked(h * 31 + ch);
        return h & 0x7fffffff;
    }

    // ----- Scene ---------------------------------------------------------------------------------------

    private void BuildWorld(Color primary, Color secondary)
    {
        // Sky in the nation's palette: a deep zenith from the primary, a warm hazy horizon from the secondary.
        var top = new Color("#3f7fc8").Lerp(primary, 0.28f);
        var horizon = new Color("#f6e3c2").Lerp(secondary, 0.22f);
        var sky = new ProceduralSkyMaterial
        {
            SkyTopColor = top, SkyHorizonColor = horizon, SkyCurve = 0.03f,
            GroundBottomColor = new Color("#6d8a4c"), GroundHorizonColor = horizon, EnergyMultiplier = 1.15f,
            SunAngleMax = 30f, SunCurve = 0.1f,
        };
        var env = new Godot.Environment
        {
            BackgroundMode = Godot.Environment.BGMode.Sky, Sky = new Sky { SkyMaterial = sky, RadianceSize = Sky.RadianceSizeEnum.Size64 },
            AmbientLightSource = Godot.Environment.AmbientSource.Sky, AmbientLightSkyContribution = 0.7f, AmbientLightEnergy = 0.75f,
            AmbientLightColor = new Color("#c8d2e0"), ReflectedLightSource = Godot.Environment.ReflectionSource.Sky,
            TonemapMode = Godot.Environment.ToneMapper.Filmic, TonemapExposure = 1.0f,
            FogEnabled = true, FogLightColor = horizon, FogDensity = 0.018f, FogSkyAffect = 0f, FogAerialPerspective = 0.2f,
        };
        _stage.AddChild(new WorldEnvironment { Environment = env });
        // Soft late-afternoon key, a rim of the nation's secondary from behind, and a cool fill.
        _stage.AddChild(new DirectionalLight3D
        {
            RotationDegrees = new Vector3(-32, 28, 0), LightEnergy = 1.15f, LightColor = new Color("#ffe6c4"),
            ShadowEnabled = _live, ShadowBlur = 2f, DirectionalShadowMode = DirectionalLight3D.ShadowMode.Orthogonal, DirectionalShadowMaxDistance = 14f,
        });
        _stage.AddChild(new DirectionalLight3D { RotationDegrees = new Vector3(-18, 190, 0), LightEnergy = 0.9f, LightColor = secondary.Lerp(Colors.White, 0.45f) });
        _stage.AddChild(new DirectionalLight3D { RotationDegrees = new Vector3(-10, -70, 0), LightEnergy = 0.25f, LightColor = new Color("#a9c3ff") });
        // Large portraits show the whole figure with banner and landmark; small ones close in on the head and shoulders.
        bool small = CustomMinimumSize.Y < 180;
        _stage.AddChild(small
            ? new Camera3D { Position = new Vector3(-0.12f, 1.62f, 4.7f), RotationDegrees = new Vector3(-2f, 0, 0), Fov = 25f, Current = true, Far = 60f }
            : new Camera3D { Position = new Vector3(-0.15f, 1.55f, 6.9f), RotationDegrees = new Vector3(-4f, -1.5f, 0), Fov = 30f, Current = true, Far = 60f });
    }

    private void BuildPlinth(CivilizationDef civ)
    {
        // A hex of land on a stone base, the landmark standing at the back.
        AddMesh(new CylinderMesh { TopRadius = 4.2f, BottomRadius = 4.4f, Height = 0.5f, RadialSegments = 6 }, new Vector3(0, -0.25f, 0), new Color("#6f8a48"), 0.95f);
        AddMesh(new CylinderMesh { TopRadius = 4.55f, BottomRadius = 4.8f, Height = 0.45f, RadialSegments = 6 }, new Vector3(0, -0.62f, 0), new Color("#8a7d68"), 0.9f);
        // The land beyond, fading into the haze, and distant hills, so the horizon is land and not a void.
        AddMesh(new CylinderMesh { TopRadius = 60f, BottomRadius = 60f, Height = 0.2f, RadialSegments = 24 }, new Vector3(0, -0.95f, 0), new Color("#7b9455"), 1f);
        //, so the horizon is land and not a void.
        AddMesh(new SphereMesh { Radius = 7f, Height = 5f, RadialSegments = 16, Rings = 8 }, new Vector3(-9, -2.4f, -16), new Color("#7a9a62"), 1f);
        AddMesh(new SphereMesh { Radius = 9f, Height = 5.5f, RadialSegments = 16, Rings = 8 }, new Vector3(10, -2.8f, -19), new Color("#6f8f5c"), 1f);
        // A few tufts of grass and stones on the plinth.
        var rng = new RandomNumberGenerator { Seed = (ulong)StableHash(civ.Id) };
        for (int i = 0; i < 7; i++)
        {
            float a = rng.RandfRange(0, Mathf.Tau), r = rng.RandfRange(1.6f, 3.6f);
            var at = new Vector3(Mathf.Cos(a) * r, 0, Mathf.Sin(a) * r);
            if (at.Z > 0.2f && Mathf.Abs(at.X) < 1.2f) continue;   // keep the figure's feet clear
            bool stone = i % 3 == 0;
            AddMesh(stone ? new SphereMesh { Radius = 0.16f, Height = 0.18f } : new CylinderMesh { TopRadius = 0.02f, BottomRadius = 0.16f, Height = 0.28f, RadialSegments = 5 },
                at + new Vector3(0, stone ? 0.03f : 0.14f, 0), stone ? new Color("#9b9284") : new Color("#5d7d36"), 1f);
        }

        var landmark = CityLayout.Landmark(civ.Id)?.Prop;
        if (landmark == null || Models.LoadScene(landmark) is not { } scene) return;
        var b = Models.SceneBounds(landmark);
        float k = Mathf.Min(2.7f / Mathf.Max(0.01f, b.Size.Y), 3.3f / Mathf.Max(0.01f, Mathf.Max(b.Size.X, b.Size.Z)));
        var node = scene.Instantiate<Node3D>();
        node.Scale = Vector3.One * k;
        var holder = new Node3D { Position = new Vector3(0.75f, 0, -2.0f), RotationDegrees = new Vector3(0, -20, 0) };
        node.Position = -new Vector3(b.Position.X + b.Size.X / 2, b.Position.Y, b.Position.Z + b.Size.Z / 2) * k;
        holder.AddChild(node);
        _stage.AddChild(holder);
    }

    private void BuildBanner(Color primary, Color secondary)
    {
        var pole = new Node3D { Position = new Vector3(-1.05f, 0, 0.55f) };
        _stage.AddChild(pole);
        AddMesh(new CylinderMesh { TopRadius = 0.035f, BottomRadius = 0.045f, Height = 2.7f, RadialSegments = 8 }, new Vector3(0, 1.35f, 0), new Color("#5a4630"), 0.7f, pole);
        AddMesh(new SphereMesh { Radius = 0.07f, Height = 0.14f }, new Vector3(0, 2.74f, 0), new Color("#d9b45a"), 0.35f, pole);
        _flag = new Node3D { Position = new Vector3(0.03f, 2.6f, 0) };
        pole.AddChild(_flag);
        // A hanging banner: the primary field with a secondary band and fringe.
        AddMesh(new BoxMesh { Size = new Vector3(0.62f, 0.95f, 0.025f) }, new Vector3(0.33f, -0.5f, 0), primary, 0.85f, _flag);
        AddMesh(new BoxMesh { Size = new Vector3(0.64f, 0.1f, 0.03f) }, new Vector3(0.33f, -0.16f, 0), secondary, 0.85f, _flag);
        AddMesh(new BoxMesh { Size = new Vector3(0.64f, 0.06f, 0.03f) }, new Vector3(0.33f, -0.98f, 0), secondary, 0.85f, _flag);
        AddMesh(new BoxMesh { Size = new Vector3(0.72f, 0.04f, 0.04f) }, new Vector3(0.33f, 0.0f, 0), new Color("#5a4630"), 0.7f, _flag);
    }

    private void BuildFigure(LeaderDef? leader, CivilizationDef civ, Color primary)
    {
        Figure = FigureFor(leader, civ);
        var scene = Models.LoadScene(Figure);
        if (scene == null) return;
        var b = Models.SceneBounds(Figure);
        float k = 1.85f / Mathf.Max(0.01f, b.Size.Y);
        var figure = scene.Instantiate<Node3D>();
        figure.Scale = Vector3.One * k;
        figure.Position = -new Vector3(b.Position.X + b.Size.X / 2, b.Position.Y, b.Position.Z + b.Size.Z / 2) * k;
        var holder = new Node3D { Position = new Vector3(0.05f, 0, 1.35f), RotationDegrees = new Vector3(0, 14, 0) };   // faces +Z: the camera, turned a little
        holder.AddChild(figure);
        _stage.AddChild(holder);
        _figure = holder;
        SceneTint.Finish(figure);
        Dress(figure, primary);
        var players = figure.FindChildren("*", "AnimationPlayer", true, false).OfType<AnimationPlayer>().ToList();
        if (Figure == "units/modern_soldier" || !players.Any(ap => Find(ap, "Idle_A", "Idle", "idle") != null))
        {
            UnitLayer.RestArms(figure);   // its own idle holds a T-pose: stand at ease, and breathe procedurally instead
            return;
        }
        foreach (var ap in players)
        {
            if (Find(ap, "Idle_A", "Idle", "idle") is not { } idle) continue;
            ap.GetAnimation(idle).LoopMode = Animation.LoopModeEnum.Linear;
            ap.Play(idle);
            ap.Seek(0.4, true);
            if (!_live) ap.Pause();
            _players.Add(ap);
        }
    }

    /// <summary>Capes, hats and hoods in the nation's colour (KayKit names them *_Cape, *_Hat).</summary>
    private static void Dress(Node figure, Color primary)
    {
        foreach (var mi in figure.FindChildren("*", "MeshInstance3D", true, false).OfType<MeshInstance3D>())
        {
            string name = mi.Name.ToString();
            bool cape = name.EndsWith("_Cape"), hat = name.EndsWith("_Hat");
            if (!cape && !hat) continue;
            var m = new StandardMaterial3D { AlbedoColor = hat ? primary.Darkened(0.15f) : primary, Roughness = 0.8f, RimEnabled = true, Rim = 0.4f, RimTint = 0.4f };
            for (int i = 0; i < mi.GetSurfaceOverrideMaterialCount(); i++) mi.SetSurfaceOverrideMaterial(i, m);
        }
    }

    private void AddMesh(Mesh mesh, Vector3 at, Color color, float roughness, Node3D? parent = null)
    {
        var mi = new MeshInstance3D { Mesh = mesh, Position = at };
        mi.MaterialOverride = new StandardMaterial3D { AlbedoColor = color, Roughness = roughness };
        (parent ?? _stage).AddChild(mi);
    }

    // ----- Rendering -----------------------------------------------------------------------------------

    /// <summary>Render a few frames (models and skeletons settle), then freeze the image.</summary>
    private void Capture()
    {
        _viewport.RenderTargetUpdateMode = SubViewport.UpdateMode.Always;
        _captureFrames = 4;
    }

    public override void _Notification(int what)
    {
        if (what == NotificationResized && !_live && _key != "") Capture();
    }

    public override void _Process(double delta)
    {
        if (_captureFrames > 0 && --_captureFrames == 0 && !_live)
        {
            _viewport.RenderTargetUpdateMode = SubViewport.UpdateMode.Once;
            return;
        }
        if (!_live || !IsVisibleInTree()) return;
        _time += delta;
        if (_flag != null) _flag.RotationDegrees = new Vector3(0, Mathf.Sin((float)_time * 1.7f) * 14f, Mathf.Sin((float)_time * 2.3f) * 2.5f);
        if (_figure != null && _players.Count == 0)
        {
            // Breathing and a slow shift of weight for figures without an idle clip.
            _figure.Scale = new Vector3(1, 1 + Mathf.Sin((float)_time * 2.1f) * 0.012f, 1);
            _figure.RotationDegrees = new Vector3(0, 14 + Mathf.Sin((float)_time * 0.4f) * 4f, Mathf.Sin((float)_time * 0.7f) * 0.8f);
        }
        if (_time > _nextFidget && _players.Count > 0)
        {
            // Now and then a different idle, so a long look at the screen is not a loop.
            _nextFidget = _time + 11 + GD.Randf() * 6;
            foreach (var ap in _players.Where(GodotObject.IsInstanceValid))
                if (Find(ap, "Idle_B") is { } fidget && ap.CurrentAnimation != fidget)
                {
                    ap.GetAnimation(fidget).LoopMode = Animation.LoopModeEnum.None;
                    ap.Play(fidget, 0.4);
                    ap.Queue(Find(ap, "Idle_A", "Idle", "idle") ?? fidget);
                }
        }
    }

    private static string? Find(AnimationPlayer ap, params string[] names)
    {
        var all = ap.GetAnimationList();
        foreach (var n in names)
        {
            var hit = all.FirstOrDefault(a => a == n) ?? all.FirstOrDefault(a => a.Contains(n, StringComparison.OrdinalIgnoreCase));
            if (hit != null) return hit;
        }
        return null;
    }
}
