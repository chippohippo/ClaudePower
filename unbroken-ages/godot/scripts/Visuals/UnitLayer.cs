using Godot;
using UnbrokenAges.Client.Map;
using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.State;
using UnbrokenAges.Sim.Systems;

namespace UnbrokenAges.Client.Visuals;

/// <summary>
/// Units as figures of their period: each unit's look comes from its data ("look": model, squad size, tint), so spearmen,
/// musketeers, riflemen and infantry, knights and cavalry, catapults to howitzers, tanks of each war, triremes to destroyers
/// and fighters all read apart. Settlers, builders, traders and missionaries modernise with their owner's research.
/// Armies are a squad, ships a single hull, each standing on a disc in the owner's colour; generated vehicles carry it too.
/// Units breathe (idle), walk between tiles, and swing when they fight. Hidden units (fog) are not drawn.
/// </summary>
public partial class UnitLayer : Node3D
{
    private sealed class View
    {
        public Node3D Root = null!;
        public List<AnimationPlayer> Players = new();
        /// <summary>Riders keep their seat while the mount walks; they swing with it in an attack.</summary>
        public List<AnimationPlayer> Riders = new();
        public int Tile;
        public int Def;
        public string Key = "";
        public bool Ranged;
        public bool Military;
        public Tween? Move;
        // Combat (see "Battle"): who owns it, what kind of thing it is, where it stands at rest, and how long a fight holds it.
        public int Owner;
        public bool Vehicle;
        public UnitDomain Domain;
        public Vector3 Home;
        public double BusyUntil;
        public Tween? Lunge;
    }

    private readonly ModelLibrary _models;
    private readonly Dictionary<int, View> _views = new();
    /// <summary>Every unit id this layer has seen alive: a unit never seen before, appearing after the first sync, was just raised.</summary>
    private readonly HashSet<int> _known = new();
    private bool _synced;
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
    public sealed record UnitLook(string Model, int Count, float Size, bool ByLength, Color Tint, Color Glow = default, float Hover = 0f, string? Addon = null, string? Rider = null)
    {
        public string Key => $"{Model}|{Count}|{Tint.ToHtml()}|{Glow.ToHtml()}|{Addon}|{Rider}";
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
        if (d.Look is { } data && !string.IsNullOrEmpty(data.Model))
            look = new UnitLook(data.Model, data.Count, (float)data.Size.ToDouble(), data.ByLength,
                                data.Tint != null ? Color.FromHtml(data.Tint) : white, default, (float)data.Hover.ToDouble(), data.Addon, data.Rider);
        else if (d.FoundsCity) look = industrial ? new UnitLook("life/van", 1, 0.5f, true, white) : new UnitLook("units/villager", 3, 0.6f, false, white);
        else if (d.FoundsOutpost) look = industrial ? new UnitLook("life/wagon_covered", 1, 0.55f, true, white) : new UnitLook("units/merchant", 2, 0.62f, false, white);
        else if (d.HasTag("Trader")) look = industrial ? new UnitLook("units/cargo_truck", 1, 0.55f, true, white) : new UnitLook("units/camel", 1, 0.8f, true, white, default, 0f, "props/sack");
        else if (d.HasTag("Missionary")) look = new UnitLook("units/monk", 2, 0.66f, false, white, new Color(0.8f, 0.6f, 1f, 0.2f));
        else if (d.Charges > 0 && d.Domain == UnitDomain.Civilian)
            look = owner.Path == TechLook.Discarnate ? new UnitLook("units/drone", 2, 0.3f, true, white, default, 0.35f)
                 : industrial ? new UnitLook("life/tractor", 1, 0.42f, true, white) : new UnitLook("units/farmer", 2, 0.6f, false, white);
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
        4 => new[] { new Vector3(-0.13f, 0, -0.2f), new Vector3(0.17f, 0, -0.17f), new Vector3(-0.24f, 0, 0.15f), new Vector3(0.1f, 0, 0.2f) },
        // Corps and armies: a second and third rank.
        _ => Enumerable.Range(0, count).Select(i => new Vector3(-0.27f + 0.18f * (i % 4) + (i / 4) * 0.09f, 0, -0.22f + 0.2f * (i / 4))).ToArray(),
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
            // Embarked: an army or settlers at sea travel in a sailing boat (a steamer from the industrial age).
            if (Movement.IsEmbarked(s, u))
                look = Looks(s, u.Owner).Architecture >= Architecture.Industrial ? new UnitLook("units/ship_small", 1, 0.85f, true, Colors.White)
                                                                                : new UnitLook("units/boat_sail_a", 1, 0.75f, true, Colors.White);
            if (u.Formation > 0 && look.Count > 1) look = look with { Count = Math.Min(7, look.Count + 2 * u.Formation) };   // corps and armies march deeper
            if (!_views.TryGetValue(u.Id, out var view) || view.Def != u.DefIndex || view.Key != look.Key)
            {
                if (view != null) { view.Move?.Kill(); view.Root.QueueFree(); }
                view = Create(s, u, look);
                view.Root.Position = target;
                view.Home = target;
                _views[u.Id] = view;
                if (_synced && !_known.Contains(u.Id)) Raise(view, HexMapView.CivColor(s, u.Owner));
            }
            else if (view.Tile != u.Tile || view.Home.DistanceTo(target) > 0.01f)
            {
                // A squad still in the middle of a fight finishes its swing before it marches (a victor advancing into the tile).
                if (Busy(view)) DeferMove(view, target); else MoveTo(view, target);
            }
            view.Tile = u.Tile;
            view.Home = target;
            // A garrison shows one squad in front of the city; the rest stay inside the walls (their flags still show).
            view.Root.Visible = !(cityTiles.Contains(u.Tile) && slot > 0);
        }
        foreach (var u in s.Units) _known.Add(u.Id);
        var alive = s.Units.Select(u => u.Id).ToHashSet();
        foreach (var id in _views.Keys.Where(id => !seen.Contains(id)).ToList())
        {
            var gone = _views[id];
            _views.Remove(id);
            gone.Move?.Kill();
            // Out of sight: it simply goes. Gone from the world: it falls (a soldier) or settles into its new city (a settler).
            if (!_synced || alive.Contains(id)) { gone.Root.QueueFree(); continue; }
            bool founded = cityTiles.Contains(gone.Tile) && !gone.Military;
            if (founded) Settle(gone); else Die(gone);
        }
        _synced = true;
    }

    // ----- Life and death --------------------------------------------------------------------------------

    /// <summary>A newly raised unit rises out of the ground with a burst of light in its owner's colour.</summary>
    private void Raise(View view, Color color)
    {
        var root = view.Root;
        root.Scale = new Vector3(0.05f, 0.05f, 0.05f);
        var t = CreateTween();
        t.TweenProperty(root, "scale", Vector3.One, 0.55f).SetTrans(Tween.TransitionType.Back).SetEase(Tween.EaseType.Out);
        MapFx.Current?.Sparkles(root.Position, color.Lightened(0.3f));
        MapFx.Current?.Shockwave(root.Position, color.Lightened(0.2f), 0.9f, 0.6f);
    }

    /// <summary>Settlers who have founded their city fade upward into a golden glow.</summary>
    private void Settle(View view)
    {
        var root = view.Root;
        MapFx.Current?.Sparkles(root.Position, new Color(1f, 0.85f, 0.45f), 40);
        var t = CreateTween();
        t.TweenProperty(root, "position:y", root.Position.Y + 0.4f, 0.9f).SetEase(Tween.EaseType.Out);
        t.Parallel().TweenProperty(root, "scale", new Vector3(0.05f, 0.05f, 0.05f), 0.9f).SetEase(Tween.EaseType.In);
        t.TweenCallback(Callable.From(root.QueueFree));
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
        view.Military = SupplySystem.IsMilitary(s.Db, u);
        view.Owner = u.Owner;
        view.Domain = def.Domain;
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
            SceneTint.Team(figure, color);   // before any tint: generated vehicles carry their owner's colour
            SceneTint.Finish(figure);
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
            if (look.Rider != null && _models.LoadScene(look.Rider) is { } riderScene)
            {
                // A rider in the saddle: a seated figure about two-thirds the mount's height, sat a little behind its middle.
                var rb = _models.SceneBounds(look.Rider);
                float mountHeight = bounds.Size.Y * scale * jitter;
                float rk = mountHeight * 0.62f / Mathf.Max(0.001f, rb.Size.Y);
                var rider = riderScene.Instantiate<Node3D>();
                rider.Scale = Vector3.One * rk;
                rider.Position = new Vector3(0, mountHeight * 0.5f, -0.04f * look.Size) - new Vector3(rb.Position.X + rb.Size.X / 2, rb.Position.Y, rb.Position.Z + rb.Size.Z / 2) * rk;
                holder.AddChild(rider);
                if (look.Glow.R + look.Glow.G + look.Glow.B > 0.01f) SceneTint.Apply(rider, Colors.White, look.Glow);
                foreach (var ap in rider.FindChildren("*", "AnimationPlayer", true, false).OfType<AnimationPlayer>())
                {
                    PlayLoop(ap, "Sit_Chair_Idle", "Sit_Floor_Idle", "Sit");
                    ap.Seek(GD.Randf() * 2.0, true);
                    view.Riders.Add(ap);
                }
            }
            var players = figure.FindChildren("*", "AnimationPlayer", true, false).OfType<AnimationPlayer>().ToList();
            if (StaticFigures.Contains(look.Model) || !players.Any(ap => Find(ap, "Idle_A", "Idle", "idle") != null))
            {
                // Figures without an idle (the Polyfork period soldiers) would stand in their T-pose: lower the arms instead.
                RestArms(figure);
                players.Clear();
            }
            foreach (var ap in players)
            {
                view.Players.Add(ap);
                PlayLoop(ap, "Idle_A", "Idle", "idle", "static");
                ap.Seek(GD.Randf() * 2.0, true);   // squads do not breathe in lockstep
            }
        }
        // Hulls, guns and craft have no rig: in a fight they recoil, and when destroyed they tip over and burn.
        view.Vehicle = view.Players.Count == 0 && (def.Domain is UnitDomain.Naval or UnitDomain.Air || def.UnitClass == "Siege"
                       || def.HasTag("Siege") || def.HasTag("Armor") || def.HasTag("Drone"));
        return view;
    }

    /// <summary>Figures whose own idle holds the arms out like a T-pose: they stand at rest instead.</summary>
    private static readonly HashSet<string> StaticFigures = new() { "units/modern_soldier" };

    /// <summary>Lowers a T-posed humanoid's arms to its sides (Mixamo-style bone names; the figure faces +Z).</summary>
    public static void RestArms(Node figure)
    {
        foreach (var skel in figure.FindChildren("*", "Skeleton3D", true, false).OfType<Skeleton3D>())
        {
            void Lower(string bone, float degrees, string fore, float foreDegrees)
            {
                int b = skel.FindBone(bone);
                if (b < 0) return;
                Turn(b, Vector3.Back, degrees);
                int f = skel.FindBone(fore);
                if (f >= 0) Turn(f, Vector3.Right, foreDegrees);   // a slight bend at the elbow, hands forward
            }
            void Turn(int b, Vector3 axis, float degrees)
            {
                int parent = skel.GetBoneParent(b);
                var parentGlobal = parent >= 0 ? skel.GetBoneGlobalPose(parent).Basis : Basis.Identity;
                var turned = new Basis(axis, Mathf.DegToRad(degrees)) * skel.GetBoneGlobalPose(b).Basis;
                skel.SetBonePoseRotation(b, (parentGlobal.Inverse() * turned).GetRotationQuaternion());
            }
            Lower("LeftArm", -72, "LeftForeArm", -25);
            Lower("RightArm", 72, "RightForeArm", -25);
        }
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

    /// <summary>
    /// A march: the squad walks over the ground (not through hills), bobbing with its stride and leaning into it, kicking up dust
    /// as it sets off and as it arrives. Ships glide and rock on the swell instead; aircraft fly level.
    /// </summary>
    private void MoveTo(View view, Vector3 target)
    {
        view.Move?.Kill();
        var root = view.Root;
        var from = root.Position;
        var flat = new Vector3(target.X - from.X, 0, target.Z - from.Z);
        if (flat.LengthSquared() > 0.0001f) root.Rotation = new Vector3(0, Mathf.Atan2(flat.X, flat.Z), 0);
        foreach (var ap in view.Players) PlayLoop(ap, "Walking_A", "Walk", "walk", "Running_A", "Run");
        float distance = from.DistanceTo(target);
        float seconds = Mathf.Clamp(distance * 0.24f, 0.3f, 1.4f);
        float strides = Mathf.Max(2f, Mathf.Round(distance * 2.2f));
        bool onFoot = view.Players.Count > 0 || view.Military && !view.Key.Contains("ship") && !view.Key.Contains("boat");
        if (onFoot) MapFx.Current?.Dust(from, 0.8f);
        view.Move = CreateTween();
        view.Move.TweenMethod(Callable.From<float>(t =>
        {
            if (!GodotObject.IsInstanceValid(root)) return;
            float e = t * t * (3f - 2f * t);                       // ease in and out
            var p = from.Lerp(target, e);
            float ground = HeightField.Current.Surface(p.X, p.Z) + 0.01f;
            float lift = Mathf.Max(from.Y, target.Y) > ground + 0.2f ? Mathf.Lerp(from.Y, target.Y, e) : ground;   // aircraft keep their height
            float bob = onFoot ? Mathf.Abs(Mathf.Sin(e * strides * Mathf.Pi)) * 0.035f : Mathf.Sin(t * Mathf.Pi * 2f) * 0.015f;
            root.Position = new Vector3(p.X, Mathf.Max(lift, ground) + bob, p.Z);
            root.Rotation = new Vector3(Mathf.Sin(t * Mathf.Pi) * (onFoot ? 0.06f : 0f), root.Rotation.Y, onFoot ? 0f : Mathf.Sin(t * Mathf.Pi * 3f) * 0.05f);
        }), 0f, 1f, seconds);
        view.Move.TweenCallback(Callable.From(() =>
        {
            if (!GodotObject.IsInstanceValid(root)) return;
            root.Rotation = new Vector3(0, root.Rotation.Y, 0);
            if (onFoot) MapFx.Current?.Dust(root.Position, 0.7f);
            foreach (var ap in view.Players) PlayLoop(ap, "Idle_A", "Idle", "idle", "static");
        }));
    }

    #region Combat: attack, flinch and death

    // Clip fallback chains. KayKit rigs (Knight, Barbarian, Rogue, Ranger, Skeleton...) carry the first names; the Kenney mini
    // figures use lower-case dashed names (attack-melee-right, holding-right-shoot, die); the mech and the beasts use Attack/Hit.
    private static readonly string[] MeleeClips = { "Melee_1H_Attack_Chop", "Melee_2H_Attack_Chop", "Melee_1H_Attack_Slice_Diagonal", "Attack", "attack-melee-right", "Stomp" };
    private static readonly string[] RangedClips = { "Ranged_Bow_Release", "Ranged_2H_Shoot", "Ranged_1H_Shoot", "Throw", "holding-right-shoot", "holding-both-shoot", "Shoot" };
    private static readonly string[] HitClips = { "Hit_A", "Hit_B", "Melee_Block_Hit", "Hit", "hit" };
    private static readonly string[] DeathClips = { "Death_A", "Death_B", "Skeletons_Death", "die", "down" };
    private static readonly string[] IdleClips = { "Idle_A", "Idle", "idle", "static" };

    /// <summary>When a blow lands on each tile (seconds, engine clock): a unit that dies there falls when it is struck, not before.</summary>
    private readonly Dictionary<int, double> _hitAt = new();

    /// <summary>The layer's own clock, advanced by frame time like its tweens (wall time drifts from them on slow frames).</summary>
    private double _clock;
    private double Now => _clock;
    public override void _Process(double delta) => _clock += delta;
    private bool Busy(View v) => v.BusyUntil > Now;

    /// <summary>
    /// One exchange of a battle on <paramref name="tile"/>: the attacker (if any — a city's bombard has none) strikes, and every
    /// other nation's unit standing there flinches when the blow lands <paramref name="impactDelay"/> seconds from now. A unit
    /// the blow destroys is gone from the next sync; its view stays as a ghost that plays its death from that moment (see Die).
    /// </summary>
    public void Battle(int attackerId, int attackerOwner, int tile, Vector3 target, float impactDelay)
    {
        double hit = Now + impactDelay;
        _hitAt[tile] = Math.Max(_hitAt.GetValueOrDefault(tile), hit);
        Vector3? from = null;
        if (attackerId >= 0 && _views.TryGetValue(attackerId, out var attacker))
        {
            Attack(attackerId, target);
            from = attacker.Home;
            // An attacker killed by the counter-blow falls when the blows meet, not the moment the sim removes it.
            if (!attacker.Ranged && !attacker.Vehicle) _hitAt[attacker.Tile] = Math.Max(_hitAt.GetValueOrDefault(attacker.Tile), hit);
        }
        foreach (var v in _views.Values.Where(v => v.Tile == tile && v.Owner != attackerOwner && v.Root.Visible))
            Flinch(v, from ?? v.Home + Vector3.Forward, impactDelay);
    }

    /// <summary>
    /// Turns the unit toward the target and plays its attack. A melee squad lunges at the enemy and springs back; archers and
    /// gunmen rock back with the shot; hulls, guns and craft recoil with a flash at the muzzle. The squad returns to idle.
    /// </summary>
    public void Attack(int unitId, Vector3 target)
    {
        if (!_views.TryGetValue(unitId, out var view)) return;
        var root = view.Root;
        var home = view.Home;
        var flat = new Vector3(target.X - home.X, 0, target.Z - home.Z);
        if (flat.LengthSquared() > 0.0001f) root.Rotation = new Vector3(0, Mathf.Atan2(flat.X, flat.Z), 0);
        var dir = flat.LengthSquared() > 0.0001f ? flat.Normalized() : Vector3.Zero;
        view.Lunge?.Kill();
        view.Move?.Kill();
        root.Position = home;
        var lunge = view.Lunge = CreateTween();
        float busy;
        if (view.Vehicle)
        {
            // A kick back along the barrel, then it settles; the muzzle flashes toward the target.
            BattleFx.Current?.MuzzleFlash(home + dir * 0.32f + new Vector3(0, view.Domain == UnitDomain.Air ? 0.4f : 0.18f, 0), view.Domain == UnitDomain.Naval ? 1.4f : 1f);
            lunge.TweenProperty(root, "position", home - dir * 0.12f, 0.06f).SetEase(Tween.EaseType.Out);
            lunge.Parallel().TweenProperty(root, "rotation:x", -0.12f, 0.06f);
            lunge.TweenProperty(root, "position", home, 0.4f).SetTrans(Tween.TransitionType.Elastic).SetEase(Tween.EaseType.Out);
            lunge.Parallel().TweenProperty(root, "rotation:x", 0f, 0.3f);
            busy = 0.46f;
        }
        else if (view.Ranged || dir == Vector3.Zero)
        {
            lunge.TweenProperty(root, "position", home + dir * 0.05f, 0.1f).SetEase(Tween.EaseType.Out);
            lunge.TweenProperty(root, "position", home - dir * 0.06f, 0.08f).SetEase(Tween.EaseType.Out);
            lunge.TweenProperty(root, "position", home, 0.3f).SetTrans(Tween.TransitionType.Elastic).SetEase(Tween.EaseType.Out);
            busy = 0.5f;
        }
        else
        {
            // In to the enemy, a puff of dust where they meet, and back to its own tile.
            lunge.TweenProperty(root, "position", home + dir * 0.42f + new Vector3(0, 0.06f, 0), BattleFx.MeleeContact).SetTrans(Tween.TransitionType.Back).SetEase(Tween.EaseType.In);
            lunge.TweenCallback(Callable.From(() => MapFx.Current?.Dust(home + dir * 0.5f, 1.2f)));
            lunge.TweenInterval(0.08f);
            lunge.TweenProperty(root, "position", home, 0.32f).SetTrans(Tween.TransitionType.Quad).SetEase(Tween.EaseType.Out);
            busy = BattleFx.MeleeContact + 0.42f;
        }
        lunge.TweenCallback(Callable.From(() => { if (GodotObject.IsInstanceValid(root)) root.Rotation = new Vector3(0, root.Rotation.Y, 0); }));
        view.BusyUntil = Now + busy;
        foreach (var ap in view.Players.Concat(view.Riders))
        {
            var name = view.Ranged ? Find(ap, RangedClips) : null;
            name ??= Find(ap, MeleeClips);
            PlayOnce(ap, name, 1.5f, view.Riders.Contains(ap) ? new[] { "Sit_Chair_Idle", "Sit_Floor_Idle", "Sit" } : IdleClips);
        }
    }

    /// <summary>Struck: after <paramref name="delay"/>, the unit staggers back from the blow, plays its hit, and flashes red.</summary>
    private void Flinch(View view, Vector3 from, float delay)
    {
        var root = view.Root;
        var away = new Vector3(view.Home.X - from.X, 0, view.Home.Z - from.Z);
        away = away.LengthSquared() > 0.0001f ? away.Normalized() : Vector3.Back;
        view.BusyUntil = Math.Max(view.BusyUntil, Now + delay + 0.4f);
        var t = CreateTween();
        t.TweenInterval(delay);
        t.TweenCallback(Callable.From(() =>
        {
            if (!GodotObject.IsInstanceValid(root)) return;
            Flash(root, new Color(0.42f, 0.07f, 0.05f));   // additive: a red tint, not a solid silhouette
            foreach (var ap in view.Players) PlayOnce(ap, Find(ap, HitClips), 1.6f, IdleClips);
            view.Lunge?.Kill();
            var home = view.Home;
            var knock = view.Lunge = CreateTween();
            float k = view.Vehicle ? 0.05f : 0.1f;
            knock.TweenProperty(root, "position", home + away * k, 0.07f).SetEase(Tween.EaseType.Out);
            knock.TweenProperty(root, "position", home, 0.28f).SetTrans(Tween.TransitionType.Quad).SetEase(Tween.EaseType.InOut);
        }));
    }

    /// <summary>A brief glow over every mesh of a unit (its figures, hull and ring), fading in a quarter of a second.</summary>
    private void Flash(Node3D root, Color color)
    {
        var overlay = new StandardMaterial3D
        {
            ShadingMode = BaseMaterial3D.ShadingModeEnum.Unshaded, Transparency = BaseMaterial3D.TransparencyEnum.Alpha,
            BlendMode = BaseMaterial3D.BlendModeEnum.Add, AlbedoColor = color, CullMode = BaseMaterial3D.CullModeEnum.Back,
        };
        var meshes = root.FindChildren("*", "GeometryInstance3D", true, false).OfType<GeometryInstance3D>().Where(m => m.MaterialOverlay == null).ToList();
        foreach (var m in meshes) m.MaterialOverlay = overlay;
        var t = CreateTween();
        t.TweenProperty(overlay, "albedo_color", new Color(0, 0, 0, 0), 0.28f).SetEase(Tween.EaseType.In);
        t.TweenCallback(Callable.From(() =>
        {
            foreach (var m in meshes) if (GodotObject.IsInstanceValid(m) && m.MaterialOverlay == overlay) m.MaterialOverlay = null;
        }));
    }

    private static void PlayOnce(AnimationPlayer ap, string? name, float speed, string[] then)
    {
        if (name == null || !GodotObject.IsInstanceValid(ap)) return;
        ap.GetAnimation(name).LoopMode = Animation.LoopModeEnum.None;
        ap.Play(name, 0.08, speed);
        ap.ClearQueue();
        if (Find(ap, then) is { } idle) ap.Queue(idle);
    }

    /// <summary>A marching order that waits for the squad's swing to finish.</summary>
    private void DeferMove(View view, Vector3 target)
    {
        view.Move?.Kill();
        var t = view.Move = CreateTween();
        t.TweenInterval(Math.Max(0.01, view.BusyUntil - Now));
        t.TweenCallback(Callable.From(() =>
        {
            if (!GodotObject.IsInstanceValid(view.Root)) return;
            view.Lunge?.Kill();
            view.Move = null;
            MoveTo(view, target);
        }));
    }

    /// <summary>
    /// A unit gone from the world: its view lingers as a ghost for about a second and a half. If it was struck this moment it
    /// waits for the blow to land. Soldiers play their death and sink into the earth amid dust; figures without a death clip
    /// topple; hulls and guns tip over smoking and sink; ships list and go down; aircraft fall out of the sky trailing smoke.
    /// </summary>
    private void Die(View view)
    {
        var root = view.Root;
        view.Lunge?.Kill();
        double wait = Math.Max(0, _hitAt.GetValueOrDefault(view.Tile) - Now);
        if (wait <= 0) _hitAt.Remove(view.Tile);
        var t = CreateTween();
        if (wait > 0) t.TweenInterval(wait + 0.06);
        t.TweenCallback(Callable.From(() =>
        {
            if (!GodotObject.IsInstanceValid(root)) return;
            root.Position = new Vector3(root.Position.X, view.Home.Y, root.Position.Z);
            if (view.Vehicle) Wreck(view); else Fall(view);
        }));
    }

    private void Fall(View view)
    {
        var root = view.Root;
        int i = 0;
        foreach (var holder in root.GetChildren().OfType<Node3D>().Where(n => n.GetChildCount() > 0 && n is not MeshInstance3D))
        {
            var players = holder.FindChildren("*", "AnimationPlayer", true, false).OfType<AnimationPlayer>().ToList();
            var clip = players.Select(ap => Find(ap, DeathClips)).FirstOrDefault(c => c != null);
            if (clip != null)
            {
                // The death clip ends lying down; it is not followed by idle, so the figure stays down.
                foreach (var ap in players)
                {
                    if (Find(ap, DeathClips) is not { } name) continue;
                    ap.ClearQueue();
                    ap.GetAnimation(name).LoopMode = Animation.LoopModeEnum.None;
                    ap.Play(name, 0.06, 1.7f + 0.12f * (i % 3));   // a squad does not drop in unison
                }
                i++;
                continue;
            }
            var t = CreateTween();
            t.TweenInterval(0.06f * i++);
            t.TweenProperty(holder, "rotation_degrees:x", holder.RotationDegrees.X + 82f, 0.42f).SetTrans(Tween.TransitionType.Quad).SetEase(Tween.EaseType.In);
        }
        MapFx.Current?.Dust(root.Position, 1.6f);
        var sink = CreateTween();
        sink.TweenInterval(0.85f);
        sink.TweenProperty(root, "position:y", root.Position.Y - 0.32f, 0.6f).SetEase(Tween.EaseType.In);
        sink.Parallel().TweenProperty(root, "scale", new Vector3(1f, 0.15f, 1f), 0.6f).SetEase(Tween.EaseType.In);
        sink.TweenCallback(Callable.From(root.QueueFree));
    }

    private void Wreck(View view)
    {
        var root = view.Root;
        var t = CreateTween();
        BattleFx.Current?.MuzzleFlash(root.Position + new Vector3(0, 0.2f, 0), 2f);
        MapFx.Current?.Smoke(root.Position + new Vector3(0, 0.1f, 0), 2.2f);
        switch (view.Domain)
        {
            case UnitDomain.Naval:
                // Lists to one side, bow up, and slips under.
                t.TweenProperty(root, "rotation:z", 0.45f, 0.6f).SetEase(Tween.EaseType.Out);
                t.Parallel().TweenProperty(root, "rotation:x", -0.3f, 1.0f);
                t.Parallel().TweenProperty(root, "position:y", root.Position.Y - 0.5f, 1.4f).SetEase(Tween.EaseType.In);
                break;
            case UnitDomain.Air:
                // Spins down out of the sky and bursts on the ground.
                t.TweenProperty(root, "position:y", root.Position.Y - 0.45f, 0.9f).SetEase(Tween.EaseType.In).SetTrans(Tween.TransitionType.Quad);
                t.Parallel().TweenProperty(root, "rotation:y", root.Rotation.Y + 4f, 0.9f);
                t.Parallel().TweenProperty(root, "rotation:x", 0.7f, 0.9f);
                t.TweenCallback(Callable.From(() => { MapFx.Current?.Flames(root.Position); BattleFx.Current?.MuzzleFlash(root.Position, 2.2f); }));
                t.TweenInterval(0.3f);
                break;
            default:
                // Tips over on its side, burning, and settles into the ground.
                MapFx.Current?.Flames(root.Position + new Vector3(0, 0.1f, 0));
                t.TweenProperty(root, "rotation:z", 1.15f, 0.45f).SetTrans(Tween.TransitionType.Bounce).SetEase(Tween.EaseType.Out);
                t.TweenInterval(0.45f);
                t.TweenProperty(root, "position:y", root.Position.Y - 0.3f, 0.55f).SetEase(Tween.EaseType.In);
                break;
        }
        t.TweenCallback(Callable.From(root.QueueFree));
    }

    #endregion
}
