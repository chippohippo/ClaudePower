using Godot;
using UnbrokenAges.Client.Map;
using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.State;
using UnbrokenAges.Sim.Systems;

namespace UnbrokenAges.Client.Visuals;

/// <summary>
/// Units as animated figures (KayKit adventurers, Kenney ships and civilians, a mech for the information era):
/// armies are a squad of four, settlers and builders a small party, ships a single hull, each standing on a disc in the owner's colour.
/// Units breathe (idle), walk between tiles, and swing when they fight. Hidden units (fog) are not drawn.
/// </summary>
public partial class UnitLayer : Node3D
{
    private sealed class View
    {
        public Node3D Root = null!;
        public List<AnimationPlayer> Players = new();
        public int Tile;
        public int Def;
        public bool Ranged;
        public Tween? Move;
    }

    private readonly ModelLibrary _models;
    private readonly Dictionary<int, View> _views = new();
    private readonly Dictionary<int, StandardMaterial3D> _discs = new();
    private static readonly TorusMesh Disc = new() { InnerRadius = 0.44f, OuterRadius = 0.52f, Rings = 32, RingSegments = 6 };

    public UnitLayer(ModelLibrary models) => _models = models;

    /// <summary>Model, how many figures, and the size each is fitted to (height for people, length for ships and horses).</summary>
    public static (string Model, int Count, float Size, bool ByLength) Look(UnitDef d)
    {
        bool has(string tag) => d.Tags.Contains(tag);
        if (d.FoundsCity) return ("units/civilian_a", 3, 0.5f, false);
        if (d.FoundsOutpost) return ("units/Mage", 2, 0.7f, false);
        if (d.Charges > 0 && d.Domain == UnitDomain.Civilian) return ("units/civilian_b", 2, 0.5f, false);
        if (d.Domain == UnitDomain.Naval)
            return d.Strength == 0 ? ("units/ship_small", 1, 1.15f, true)
                 : d.OceanGoing && d.RangedStrength > 0 ? ("units/ship_large", 1, 1.55f, true)
                 : d.OceanGoing ? ("units/ship_medium", 1, 1.4f, true)
                 : ("units/ship_small", 2, 0.95f, true);
        if (d.Domain == UnitDomain.Air || has("Drone")) return ("units/drone", 3, 0.36f, true);
        if (has("Exoframe") || has("Armor")) return ("units/mech", 2, 0.85f, false);
        if (has("ElectronicWarfare")) return ("units/modern_soldier", 4, 0.66f, false);
        return d.UnitClass switch
        {
            "LightCavalry" or "HeavyCavalry" => ("units/horse", 3, 0.82f, true),
            "Ranged" => ("life/Ranger", 4, 0.72f, false),
            "Recon" => ("units/Rogue_Hooded", 2, 0.7f, false),
            "Melee" when d.Strength < 30 => ("units/Barbarian", 4, 0.72f, false),
            _ => ("units/Knight", 4, 0.74f, false),
        };
    }

    /// <summary>Squad formations: a loose wedge facing the camera, wide enough that each figure reads on its own.</summary>
    private static Vector3[] Formation(int count) => count switch
    {
        1 => new[] { Vector3.Zero },
        2 => new[] { new Vector3(-0.19f, 0, 0.06f), new Vector3(0.19f, 0, -0.06f) },
        3 => new[] { new Vector3(0, 0, -0.2f), new Vector3(-0.21f, 0, 0.14f), new Vector3(0.21f, 0, 0.14f) },
        _ => new[] { new Vector3(-0.13f, 0, -0.2f), new Vector3(0.17f, 0, -0.17f), new Vector3(-0.24f, 0, 0.15f), new Vector3(0.1f, 0, 0.2f) },
    };

    public void Sync(GameState s, int viewer, bool[] visible)
    {
        var seen = new HashSet<int>();
        var perTile = new Dictionary<int, int>();
        foreach (var u in s.Units)
        {
            if (u.Tile < 0 || !visible[u.Tile]) continue;
            seen.Add(u.Id);
            int slot = perTile.GetValueOrDefault(u.Tile);
            perTile[u.Tile] = slot + 1;
            var target = Anchor(s, u.Tile, slot);
            if (!_views.TryGetValue(u.Id, out var view) || view.Def != u.DefIndex)
            {
                if (view != null) view.Root.QueueFree();
                view = Create(s, u);
                view.Root.Position = target;
                _views[u.Id] = view;
            }
            else if (view.Tile != u.Tile || view.Root.Position.DistanceTo(target) > 0.01f)
            {
                MoveTo(view, target);
            }
            view.Tile = u.Tile;
        }
        foreach (var id in _views.Keys.Where(id => !seen.Contains(id)).ToList())
        {
            _views[id].Root.QueueFree();
            _views.Remove(id);
        }
    }

    /// <summary>Where unit number <paramref name="slot"/> on a tile stands (cities and stacks fan out).</summary>
    public static Vector3 Anchor(GameState s, int tile, int slot)
    {
        var map = s.Map;
        bool city = s.Cities.Any(c => c.Tile == tile);
        var center = HexLayout.ToWorld(map.CoordOf(tile), 0);
        if (slot > 0 || city)
        {
            float a = slot * 2.2f + (city ? 2.4f : 0.6f);
            center += new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a)) * 0.6f;
        }
        center.Y = HeightField.Current.Surface(center.X, center.Z) + 0.01f;
        return center;
    }

    public Vector3? WorldOf(int unitId) => _views.TryGetValue(unitId, out var v) ? v.Root.GlobalPosition : null;

    private View Create(GameState s, UnitState u)
    {
        var def = s.Db.Units[u.DefIndex];
        var view = new View { Root = new Node3D { Name = $"unit{u.Id}" }, Def = u.DefIndex, Tile = u.Tile };
        AddChild(view.Root);
        var (model, count, size, byLength) = Look(def);
        view.Ranged = def.RangedStrength > 0 && def.Domain == UnitDomain.Land;
        var color = HexMapView.CivColor(s, u.Owner);
        if (!_discs.TryGetValue(u.Owner, out var mat))
            _discs[u.Owner] = mat = new StandardMaterial3D { AlbedoColor = color, Roughness = 0.4f, EmissionEnabled = true, Emission = color, EmissionEnergyMultiplier = 0.35f };
        if (def.Domain != UnitDomain.Naval)
            view.Root.AddChild(new MeshInstance3D { Mesh = Disc, MaterialOverride = mat, Position = new Vector3(0, 0.02f, 0), Scale = new Vector3(1, 0.25f, 1), CastShadow = GeometryInstance3D.ShadowCastingSetting.Off });

        var scene = _models.LoadScene(model);
        var bounds = _models.SceneBounds(model);
        float extent = byLength ? Mathf.Max(bounds.Size.X, bounds.Size.Z) : bounds.Size.Y;
        float scale = extent > 0.001f ? size / extent : 0.1f;
        if (OS.GetCmdlineUserArgs().Contains("--debug-units")) GD.Print($"[unit] {model} bounds {bounds} scale {scale}");
        var offsets = Formation(count);
        if (scene == null) return view;
        foreach (var offset in offsets)
        {
            var figure = scene.Instantiate<Node3D>();
            figure.Scale = Vector3.One * scale;
            figure.Position = offset + new Vector3(0, def.Domain == UnitDomain.Air ? 0.35f : 0.03f, 0) - new Vector3(0, bounds.Position.Y * scale, 0);
            figure.RotationDegrees = new Vector3(0, (offset.X * 40) + (float)GD.RandRange(-8.0, 8.0), 0);   // KayKit faces +Z: toward the camera
            figure.Scale *= (float)GD.RandRange(0.94, 1.05);   // a squad of people, not clones
            view.Root.AddChild(figure);
            if (model.EndsWith("horse")) SceneTint.Apply(figure, SceneTint.Chestnut);
            foreach (var ap in figure.FindChildren("*", "AnimationPlayer", true, false).OfType<AnimationPlayer>())
            {
                view.Players.Add(ap);
                PlayLoop(ap, "Idle_A", "Idle", "idle", "static");
                ap.Seek(GD.Randf() * 2.0, true);   // squads do not breathe in lockstep
            }
        }
        return view;
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

    private static void PlayLoop(AnimationPlayer ap, params string[] names)
    {
        if (Find(ap, names) is not { } name) return;
        var anim = ap.GetAnimation(name);
        anim.LoopMode = Animation.LoopModeEnum.Linear;
        ap.Play(name, 0.2);
    }

    private void MoveTo(View view, Vector3 target)
    {
        view.Move?.Kill();
        var from = view.Root.Position;
        var flat = new Vector3(target.X - from.X, 0, target.Z - from.Z);
        if (flat.LengthSquared() > 0.0001f) view.Root.Rotation = new Vector3(0, Mathf.Atan2(flat.X, flat.Z), 0);
        foreach (var ap in view.Players) PlayLoop(ap, "Walking_A", "Walk", "walk", "Running_A", "Run");
        float seconds = Mathf.Clamp(from.DistanceTo(target) * 0.22f, 0.25f, 1.2f);
        view.Move = CreateTween();
        view.Move.TweenProperty(view.Root, "position", target, seconds).SetTrans(Tween.TransitionType.Sine).SetEase(Tween.EaseType.InOut);
        view.Move.TweenCallback(Callable.From(() => { foreach (var ap in view.Players) PlayLoop(ap, "Idle_A", "Idle", "idle", "static"); }));
    }

    /// <summary>Turns the unit toward the target and plays an attack; the squad returns to idle afterwards.</summary>
    public void Attack(int unitId, Vector3 target)
    {
        if (!_views.TryGetValue(unitId, out var view)) return;
        var flat = new Vector3(target.X - view.Root.Position.X, 0, target.Z - view.Root.Position.Z);
        if (flat.LengthSquared() > 0.0001f) view.Root.Rotation = new Vector3(0, Mathf.Atan2(flat.X, flat.Z), 0);
        foreach (var ap in view.Players)
        {
            var name = view.Ranged ? Find(ap, "Ranged_Bow_Release", "Ranged_2H_Shoot", "Shoot", "Attack") : null;
            name ??= Find(ap, "Melee_1H_Attack_Chop", "1H_Melee_Attack", "Attack", "Stomp", "Throw", "Shoot");
            if (name == null) continue;
            ap.GetAnimation(name).LoopMode = Animation.LoopModeEnum.None;
            ap.Play(name, 0.1);
            ap.Queue(Find(ap, "Idle_A", "Idle", "idle") ?? name);
        }
    }
}
