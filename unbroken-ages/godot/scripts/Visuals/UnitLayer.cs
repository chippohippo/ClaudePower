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
        public string Key = "";
        public bool Ranged;
        public Tween? Move;
    }

    private readonly ModelLibrary _models;
    private readonly Dictionary<int, View> _views = new();
    private readonly Dictionary<int, StandardMaterial3D> _discs = new();
    private static readonly TorusMesh Disc = new() { InnerRadius = 0.44f, OuterRadius = 0.52f, Rings = 32, RingSegments = 6 };
    private static readonly TorusMesh Trim = new() { InnerRadius = 0.395f, OuterRadius = 0.43f, Rings = 32, RingSegments = 6 };
    private readonly Dictionary<int, StandardMaterial3D> _trims = new();

    /// <summary>A squad's standard: a pole with a pennant in the nation's primary, edged in its secondary.</summary>
    private static Node3D Standard(StandardMaterial3D primary, StandardMaterial3D secondary)
    {
        var root = new Node3D();
        var wood = new StandardMaterial3D { AlbedoColor = new Color(0.32f, 0.22f, 0.14f), Roughness = 0.8f };
        root.AddChild(new MeshInstance3D { Mesh = new CylinderMesh { TopRadius = 0.008f, BottomRadius = 0.01f, Height = 0.62f, RadialSegments = 6 }, MaterialOverride = wood, Position = new Vector3(0, 0.31f, 0) });
        root.AddChild(new MeshInstance3D { Mesh = new BoxMesh { Size = new Vector3(0.2f, 0.13f, 0.008f) }, MaterialOverride = primary, Position = new Vector3(0.1f, 0.53f, 0) });
        root.AddChild(new MeshInstance3D { Mesh = new BoxMesh { Size = new Vector3(0.2f, 0.03f, 0.01f) }, MaterialOverride = secondary, Position = new Vector3(0.1f, 0.47f, 0) });
        root.AddChild(new MeshInstance3D { Mesh = new SphereMesh { Radius = 0.016f, Height = 0.032f, RadialSegments = 8, Rings = 4 }, MaterialOverride = secondary, Position = new Vector3(0, 0.63f, 0) });
        return root;
    }

    public UnitLayer(ModelLibrary models) => _models = models;

    /// <summary>How a unit is drawn: model, figures, fitted size (height, or length for ships, horses and craft), a tint and
    /// glow, hover height, and an optional piece mounted on top (a tank's turret).</summary>
    public sealed record UnitLook(string Model, int Count, float Size, bool ByLength, Color Tint, Color Glow = default, float Hover = 0f, string? Addon = null)
    {
        public string Key => $"{Model}|{Count}|{Tint.ToHtml()}|{Glow.ToHtml()}|{Addon}";
    }

    /// <summary>The look of the unit itself, before its owner's research is applied (kept for callers that only need the model).</summary>
    public static (string Model, int Count, float Size, bool ByLength) Look(UnitDef d)
    {
        var l = Look(d, TechLook.Default);
        return (l.Model, l.Count, l.Size, l.ByLength);
    }

    /// <summary>
    /// A unit's look follows what it is and what its owner has researched. Ancient to modern units are their period's
    /// soldiers; tanks are armoured hulls with turrets. The three futures each have their own forms — white ceramic
    /// Augmented with cyan light (Sovereign), grafted living beasts and spore-pods (Symbiont), hollow black machine frames
    /// and monoliths lit violet (Discarnate) — and every unit of a committed civilization takes on its people's finish.
    /// Civilians modernise with research: settlers travel by van and builders drive tractors after Industrialization.
    /// </summary>
    public static UnitLook Look(UnitDef d, TechLook owner)
    {
        bool has(string tag) => d.Tags.Contains(tag);
        var white = Colors.White;
        // The three futures' own units.
        if (has("Augmented"))
        {
            var t = TechLook.PathTint(TechLook.Sovereign); var g = TechLook.PathGlow(TechLook.Sovereign) * 0.6f;
            if (d.Domain == UnitDomain.Air) return new UnitLook("life/racer_craft", 2, 0.42f, true, t, g, 0.9f);
            if (has("Armor")) return new UnitLook("units/mech", 2, 0.95f, false, t, g);
            return new UnitLook("units/Knight", 4, 0.78f, false, t, g);
        }
        if (has("Living"))
        {
            var t = new Color(0.62f, 0.95f, 0.78f); var g = TechLook.PathGlow(TechLook.Symbiont) * 0.5f;
            if (d.Domain == UnitDomain.Air) return new UnitLook("future/mushroom_tall", 3, 0.32f, false, new Color(0.85f, 0.6f, 1.1f), TechLook.PathGlow(TechLook.Symbiont), 0.7f);
            if (d.Domain == UnitDomain.Naval) return new UnitLook("units/trex", 1, 1.5f, true, new Color(0.4f, 0.75f, 0.8f), g, -0.12f);
            return new UnitLook("units/trex", 1, 1.25f, true, t, g);
        }
        if (has("Machine"))
        {
            var t = TechLook.PathTint(TechLook.Discarnate); var g = TechLook.PathGlow(TechLook.Discarnate);
            if (d.Domain == UnitDomain.Air || has("Drone")) return new UnitLook("units/drone", 5, 0.26f, true, t, g, 0.5f);
            if (d.UnitClass == "Siege") return new UnitLook("era/skyscraper_c", 1, 1.0f, false, t, g, 0.25f);
            return new UnitLook("units/Skeleton_Warrior", 4, 0.74f, false, t, g * 0.35f);
        }

        UnitLook look;
        bool industrial = owner.Architecture >= Architecture.Industrial;
        if (d.FoundsCity) look = industrial ? new UnitLook("life/van", 1, 0.5f, true, white) : new UnitLook("units/civilian_a", 3, 0.5f, false, white);
        else if (d.FoundsOutpost) look = new UnitLook("units/Mage", 2, 0.7f, false, white);
        else if (d.Charges > 0 && d.Domain == UnitDomain.Civilian)
            look = owner.Path == TechLook.Discarnate ? new UnitLook("units/drone", 2, 0.3f, true, white, default, 0.35f)
                 : industrial ? new UnitLook("life/tractor", 1, 0.42f, true, white) : new UnitLook("units/civilian_b", 2, 0.5f, false, white);
        else if (d.Domain == UnitDomain.Naval)
            look = d.Strength == 0 ? new UnitLook("units/ship_small", 1, 1.15f, true, white)
                 : d.OceanGoing && d.RangedStrength > 0 ? new UnitLook("units/ship_large", 1, 1.55f, true, industrial ? new Color(0.55f, 0.55f, 0.58f) : white)
                 : d.OceanGoing ? new UnitLook("units/ship_medium", 1, 1.4f, true, white)
                 : new UnitLook("units/ship_small", 2, 0.95f, true, white);
        else if (d.Domain == UnitDomain.Air || has("Drone")) look = new UnitLook("units/drone", 3, 0.36f, true, white, default, 0.35f);
        else if (has("Exoframe")) look = new UnitLook("units/mech", 2, 0.85f, false, white);
        else if (has("Armor")) look = new UnitLook("units/rover", 2, 0.5f, true, new Color(0.62f, 0.66f, 0.45f), default, 0f, "units/turret");
        else if (has("ElectronicWarfare")) look = new UnitLook("units/modern_soldier", 4, 0.66f, false, white);
        else look = d.UnitClass switch
        {
            "LightCavalry" or "HeavyCavalry" => new UnitLook("units/horse", 3, 0.82f, true, SceneTint.Chestnut),
            "Ranged" => new UnitLook("life/Ranger", 4, 0.72f, false, white),
            "Recon" => new UnitLook("units/Rogue_Hooded", 2, 0.7f, false, white),
            "Melee" when d.Strength < 30 => new UnitLook("units/Barbarian", 4, 0.72f, false, white),
            _ => new UnitLook("units/Knight", 4, 0.74f, false, white),
        };
        // A committed civilization's people finish everything they field in their own way.
        if (owner.IsFuture)
            look = look with { Tint = look.Tint * Colors.White.Lerp(TechLook.PathTint(owner.Path), 0.5f), Glow = TechLook.PathGlow(owner.Path) * 0.35f };
        return look;
    }

    /// <summary>Squad formations: a loose wedge facing the camera, wide enough that each figure reads on its own.</summary>
    private static Vector3[] Formation(int count) => count switch
    {
        1 => new[] { Vector3.Zero },
        2 => new[] { new Vector3(-0.19f, 0, 0.06f), new Vector3(0.19f, 0, -0.06f) },
        3 => new[] { new Vector3(0, 0, -0.2f), new Vector3(-0.21f, 0, 0.14f), new Vector3(0.21f, 0, 0.14f) },
        _ => new[] { new Vector3(-0.13f, 0, -0.2f), new Vector3(0.17f, 0, -0.17f), new Vector3(-0.24f, 0, 0.15f), new Vector3(0.1f, 0, 0.2f) },
    };

    private readonly Dictionary<int, TechLook> _looks = new();
    private TechLook Looks(GameState s, int player) => _looks.TryGetValue(player, out var l) ? l : _looks[player] = TechLook.For(s, player);

    public void Sync(GameState s, int viewer, bool[] visible)
    {
        _looks.Clear();
        var seen = new HashSet<int>();
        var perTile = new Dictionary<int, int>();
        var cityTiles = s.Cities.Select(c => c.Tile).ToHashSet();
        // Military units first, so a city's lead squad is its strongest garrison rather than whoever arrived first.
        foreach (var u in s.Units.OrderBy(u => s.Db.Units[u.DefIndex].Strength > 0 ? 0 : 1).ThenByDescending(u => s.Db.Units[u.DefIndex].Strength).ThenBy(u => u.Id))
        {
            if (u.Tile < 0 || !visible[u.Tile]) continue;
            seen.Add(u.Id);
            int slot = perTile.GetValueOrDefault(u.Tile);
            perTile[u.Tile] = slot + 1;
            var target = Anchor(s, u.Tile, slot);
            var look = Look(s.Db.Units[u.DefIndex], Looks(s, u.Owner));
            if (!_views.TryGetValue(u.Id, out var view) || view.Def != u.DefIndex || view.Key != look.Key)
            {
                if (view != null) { view.Move?.Kill(); view.Root.QueueFree(); }
                view = Create(s, u, look);
                view.Root.Position = target;
                _views[u.Id] = view;
            }
            else if (view.Tile != u.Tile || view.Root.Position.DistanceTo(target) > 0.01f)
            {
                MoveTo(view, target);
            }
            view.Tile = u.Tile;
            // A garrison shows one squad in front of the city; the rest stay inside the walls (their flags still show).
            view.Root.Visible = !(cityTiles.Contains(u.Tile) && slot > 0);
        }
        foreach (var id in _views.Keys.Where(id => !seen.Contains(id)).ToList())
        {
            _views[id].Move?.Kill();
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

    private View Create(GameState s, UnitState u, UnitLook look)
    {
        var def = s.Db.Units[u.DefIndex];
        var view = new View { Root = new Node3D { Name = $"unit{u.Id}" }, Def = u.DefIndex, Tile = u.Tile, Key = look.Key };
        AddChild(view.Root);
        view.Ranged = def.RangedStrength > 0 && def.Domain == UnitDomain.Land;
        var color = HexMapView.CivColor(s, u.Owner);
        if (!_discs.TryGetValue(u.Owner, out var mat))
            _discs[u.Owner] = mat = new StandardMaterial3D { AlbedoColor = color, Roughness = 0.4f, EmissionEnabled = true, Emission = color, EmissionEnergyMultiplier = 0.35f };
        var second = HexMapView.CivSecondary(s, u.Owner);
        if (!_trims.TryGetValue(u.Owner, out var trim))
            _trims[u.Owner] = trim = new StandardMaterial3D { AlbedoColor = second, Roughness = 0.4f, EmissionEnabled = true, Emission = second, EmissionEnergyMultiplier = 0.25f };
        if (def.Domain != UnitDomain.Naval)
        {
            // A two-tone ring: the nation's primary, with its secondary inside it.
            view.Root.AddChild(new MeshInstance3D { Mesh = Disc, MaterialOverride = mat, Position = new Vector3(0, 0.02f, 0), Scale = new Vector3(1, 0.25f, 1), CastShadow = GeometryInstance3D.ShadowCastingSetting.Off });
            view.Root.AddChild(new MeshInstance3D { Mesh = Trim, MaterialOverride = trim, Position = new Vector3(0, 0.02f, 0), Scale = new Vector3(1, 0.25f, 1), CastShadow = GeometryInstance3D.ShadowCastingSetting.Off });
            // Every land army carries its nation's standard.
            if (SupplySystem.IsMilitary(s.Db, u) && def.Domain == UnitDomain.Land)
            {
                var standard = Standard(mat, trim);
                standard.Position = new Vector3(0.3f, 0.02f, -0.05f);
                view.Root.AddChild(standard);
            }
        }

        var scene = _models.LoadScene(look.Model);
        var bounds = _models.SceneBounds(look.Model);
        float extent = look.ByLength ? Mathf.Max(bounds.Size.X, bounds.Size.Z) : bounds.Size.Y;
        float scale = extent > 0.001f ? look.Size / extent : 0.1f;
        if (OS.GetCmdlineUserArgs().Contains("--debug-units")) GD.Print($"[unit] {look.Model} bounds {bounds} scale {scale}");
        if (scene == null) return view;
        float lift = (def.Domain == UnitDomain.Air ? 0.35f : 0.03f) + look.Hover;
        var centre = new Vector3(bounds.Position.X + bounds.Size.X / 2, bounds.Position.Y, bounds.Position.Z + bounds.Size.Z / 2) * scale;
        foreach (var offset in Formation(look.Count))
        {
            var figure = scene.Instantiate<Node3D>();
            float jitter = (float)GD.RandRange(0.94, 1.05);   // a squad of people, not clones
            figure.Scale = Vector3.One * scale * jitter;
            figure.Position = -centre * jitter;
            var holder = new Node3D { Position = offset + new Vector3(0, lift, 0), RotationDegrees = new Vector3(0, (offset.X * 40) + (float)GD.RandRange(-8.0, 8.0), 0) };   // KayKit faces +Z: toward the camera
            holder.AddChild(figure);
            view.Root.AddChild(holder);
            if (look.Tint != Colors.White || look.Glow.R + look.Glow.G + look.Glow.B > 0.01f) SceneTint.Apply(figure, look.Tint, look.Glow);
            if (look.Addon != null && _models.LoadScene(look.Addon) is { } addon)
            {
                // A turret on the hull, sized to it.
                var ab = _models.SceneBounds(look.Addon);
                float ak = look.Size * 0.55f / Mathf.Max(0.001f, Mathf.Max(ab.Size.X, ab.Size.Z));
                var top = addon.Instantiate<Node3D>();
                top.Scale = Vector3.One * ak;
                top.Position = new Vector3(0, bounds.Size.Y * scale * jitter * 0.85f, 0) - new Vector3(ab.Position.X + ab.Size.X / 2, ab.Position.Y, ab.Position.Z + ab.Size.Z / 2) * ak;
                holder.AddChild(top);
                SceneTint.Apply(top, look.Tint);
            }
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
        if (!GodotObject.IsInstanceValid(ap)) return null;   // the view was rebuilt while a tween was running
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
        if (Find(ap, names) is not { } name || !GodotObject.IsInstanceValid(ap)) return;
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
