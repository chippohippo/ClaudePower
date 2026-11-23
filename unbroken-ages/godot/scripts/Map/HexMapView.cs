using Godot;
using UnbrokenAges.Client.Visuals;
using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.Map;
using UnbrokenAges.Sim.State;
using UnbrokenAges.Sim.Systems;

namespace UnbrokenAges.Client.Map;

/// <summary>
/// The world map, drawn the way a strategy player reads it (Civ V/VI conventions):
/// <list type="bullet">
/// <item>Terrain: hex columns with tiling aerial PBR textures per terrain (terrain.gdshader), cliffs on the sides, a painted rim.</item>
/// <item>Water: animated, coast/ocean/fresh colours, reflections (water.gdshader).</item>
/// <item>Scenery: KayKit forests, hills and mountains; marsh plants; volcanoes. Cities: castle or tower with houses that grow
///   with population, team-coloured roofs; districts as their own buildings; improvements as farms, mines, pastures.</item>
/// <item>Fog: unexplored tiles are an inked parchment map (no coastline leaks), remembered tiles a sepia memory, visible tiles in colour.</item>
/// <item>Borders as glowing ribbons in the owner's colour (enemies at war: red, doubled); rivers as water ribbons on hex edges.</item>
/// </list>
/// Everything static is instanced (MultiMesh), so even Huge maps cost a few dozen draw calls. Units live in <see cref="UnitLayer"/>.
/// </summary>
public partial class HexMapView : Node3D
{
    public const float LandTop = 0.1f;
    public const float WaterTop = -0.06f;

    private readonly ModelLibrary _models = new();
    private MultiMeshInstance3D _land = null!, _water = null!;
    private MeshInstance3D _rivers = null!, _borders = null!, _selection = null!, _hover = null!;
    private readonly Dictionary<(string Prop, int Part), MultiMeshInstance3D> _propMeshes = new();
    public UnitLayer Units { get; private set; } = null!;
    public ModelLibrary Models => _models;

    private static readonly string[] Layers = { "grassland", "plains", "desert", "tundra", "snow", "rock", "cliff", "beach" };

    public override void _Ready()
    {
        var terrain = new ShaderMaterial { Shader = GD.Load<Shader>("res://shaders/terrain.gdshader") };
        terrain.SetShaderParameter("albedo_tex", BuildArray("baseColor"));
        terrain.SetShaderParameter("normal_tex", BuildArray("normal"));
        terrain.SetShaderParameter("cliff_layer", Array.IndexOf(Layers, "cliff"));
        _land = MakeMulti(new CylinderMesh { TopRadius = 1f, BottomRadius = 1f, Height = 0.6f, RadialSegments = 6, Rings = 1 }, terrain);

        var water = new ShaderMaterial { Shader = GD.Load<Shader>("res://shaders/water.gdshader") };
        water.SetShaderParameter("wave_a", WaveTexture(11, 0.9f));
        water.SetShaderParameter("wave_b", WaveTexture(23, 1.6f));
        _water = MakeMulti(new CylinderMesh { TopRadius = 1f, BottomRadius = 1f, Height = 0.12f, RadialSegments = 6, Rings = 1 }, water);

        _rivers = new MeshInstance3D { CastShadow = GeometryInstance3D.ShadowCastingSetting.Off };
        _borders = new MeshInstance3D { CastShadow = GeometryInstance3D.ShadowCastingSetting.Off };
        _selection = Ring(new Color("#ffd54a"), 0.86f, 0.98f);
        _hover = Ring(new Color(1, 1, 1, 0.55f), 0.9f, 0.97f);
        AddChild(_rivers);
        AddChild(_borders);
        Units = new UnitLayer(_models);
        AddChild(Units);
    }

    private MeshInstance3D Ring(Color color, float inner, float outer)
    {
        var ring = new MeshInstance3D
        {
            Mesh = new TorusMesh { InnerRadius = inner, OuterRadius = outer, Rings = 6, RingSegments = 4 },
            MaterialOverride = new StandardMaterial3D
            {
                AlbedoColor = color, ShadingMode = BaseMaterial3D.ShadingModeEnum.Unshaded,
                Transparency = BaseMaterial3D.TransparencyEnum.Alpha, NoDepthTest = false,
            },
            Scale = new Vector3(1, 0.15f, 1), Visible = false, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off,
            RotationDegrees = new Vector3(0, 30, 0),
        };
        AddChild(ring);
        return ring;
    }

    private static Texture2DArray BuildArray(string role)
    {
        var images = new Godot.Collections.Array<Image>();
        foreach (var layer in Layers)
        {
            var tex = GD.Load<Texture2D>($"res://assets/terrain/{layer}_{role}.jpg");
            var img = tex.GetImage();
            if (img.IsCompressed()) img.Decompress();
            img.Convert(Image.Format.Rgba8);
            if (img.GetWidth() != 1024) img.Resize(1024, 1024, Image.Interpolation.Lanczos);
            img.GenerateMipmaps();
            images.Add(img);
        }
        var array = new Texture2DArray();
        array.CreateFromImages(images);
        return array;
    }

    private static NoiseTexture2D WaveTexture(int seed, float frequency) => new()
    {
        Width = 512, Height = 512, Seamless = true, AsNormalMap = true, BumpStrength = 6f, GenerateMipmaps = true,
        Noise = new FastNoiseLite { Seed = seed, Frequency = 0.01f * frequency, FractalOctaves = 4, NoiseType = FastNoiseLite.NoiseTypeEnum.Simplex },
    };

    private MultiMeshInstance3D MakeMulti(Mesh mesh, Material? material)
    {
        var mmi = new MultiMeshInstance3D
        {
            Multimesh = new MultiMesh { TransformFormat = MultiMesh.TransformFormatEnum.Transform3D, UseColors = true, UseCustomData = true, Mesh = mesh },
            MaterialOverride = material,
        };
        AddChild(mmi);
        return mmi;
    }

    // ----- Terrain look-up tables ------------------------------------------------------------------

    private static (int Layer, Color Tint) LandLook(GameState s, int t)
    {
        var db = s.Db;
        var map = s.Map;
        string terrain = db.Terrains[map.Terrain[t]].Id;
        string? feature = map.Feature[t] >= 0 ? db.Features[map.Feature[t]].Id : null;
        var look = terrain switch
        {
            "TERRAIN_GRASSLAND" => (0, new Color(0.62f, 0.78f, 0.42f)),
            "TERRAIN_PLAINS" => (1, new Color(0.86f, 0.78f, 0.47f)),
            "TERRAIN_DESERT" => (2, new Color(0.98f, 0.86f, 0.62f)),
            "TERRAIN_TUNDRA" => (3, new Color(0.66f, 0.66f, 0.56f)),
            "TERRAIN_SNOW" => (4, new Color(0.95f, 0.97f, 1f)),
            "TERRAIN_ENGINEERED" => (5, new Color(0.86f, 0.89f, 0.93f)),
            "TERRAIN_SUBSTRATE" => (5, new Color(0.22f, 0.2f, 0.32f)),
            _ => (0, new Color(0.62f, 0.78f, 0.42f)),
        };
        if (map.IsMountain(t)) look = (5, new Color(0.7f, 0.68f, 0.64f));
        if (feature == "FEATURE_FLOODPLAINS") look.Item2 = look.Item2.Lerp(new Color(0.55f, 0.75f, 0.4f), 0.5f);
        if (feature == "FEATURE_MARSH") look.Item2 = look.Item2.Lerp(new Color(0.42f, 0.55f, 0.42f), 0.6f);
        if (feature == "FEATURE_ICE") look = (4, new Color(0.85f, 0.93f, 1f));
        if (feature == "FEATURE_BLOOM") look.Item2 = new Color(0.78f, 0.42f, 0.86f).Lerp(new Color(0.3f, 0.85f, 0.66f), (t * 37 % 11) / 11f);
        if (feature == "FEATURE_OASIS") look.Item2 = look.Item2.Lerp(new Color(0.5f, 0.8f, 0.45f), 0.5f);
        // Owned land drifts toward its civilization's Divergence palette (subtle at first, total by the end).
        int owner = map.OwnerPlayer[t];
        if (owner >= 0 && s.Players[owner].Divergence >= 0)
        {
            var d = db.Divergences[s.Players[owner].Divergence];
            int age = Math.Clamp(s.Turn - s.Players[owner].DivergenceTurn, 0, 100);
            look.Item2 = look.Item2.Lerp(new Color(d.Colors.Secondary), 0.25f * age / 100f);
        }
        if (map.HasFlag(t, TileFlags.Flooded)) look.Item2 = look.Item2.Lerp(new Color("#5fa7d0"), 0.4f);
        if (map.HasFlag(t, TileFlags.Pillaged)) look.Item2 = look.Item2.Darkened(0.3f);
        return look;
    }

    private static float Rand(int t, int salt) => ((uint)(t * 2654435761u ^ (uint)salt * 40503u) % 1000) / 1000f;

    /// <summary>Team colour of KayKit buildings, the closest of blue / red / green / yellow to the civilization's colour.</summary>
    public static string TeamColor(GameState s, int player)
    {
        int civ = player >= 0 ? s.Players[player].CivIndex : -1;
        if (civ < 0) return "blue";
        var c = new Color(s.Db.Civilizations[civ].Colors.Primary);
        var options = new (string Name, Color C)[] { ("blue", new(0.2f, 0.4f, 0.85f)), ("red", new(0.75f, 0.15f, 0.2f)), ("green", new(0.2f, 0.6f, 0.35f)), ("yellow", new(0.9f, 0.75f, 0.35f)) };
        return options.OrderBy(o => (o.C.R - c.R) * (o.C.R - c.R) + (o.C.G - c.G) * (o.C.G - c.G) + (o.C.B - c.B) * (o.C.B - c.B)).First().Name;
    }

    public static Color CivColor(GameState s, int player)
    {
        int civ = player >= 0 && player < s.Players.Count ? s.Players[player].CivIndex : -1;
        if (player >= 0 && player < s.Players.Count && s.Players[player].IsFreeCities) return new Color("#b8b2a6");
        return civ >= 0 ? new Color(s.Db.Civilizations[civ].Colors.Primary) : new Color("#cccccc");
    }

    // ----- Render ------------------------------------------------------------------------------------

    private readonly Dictionary<string, List<(Transform3D T, Color C)>> _propItems = new();

    private void AddProp(string prop, Vector3 at, float scale, float yaw, Color tint, float flatten = 1f)
    {
        if (!_propItems.TryGetValue(prop, out var list)) _propItems[prop] = list = new();
        list.Add((new Transform3D(new Basis(Vector3.Up, yaw).Scaled(new Vector3(scale, scale * flatten, scale)), at), tint));
    }

    /// <summary>
    /// Draws the map as <paramref name="viewer"/> knows it: unexplored tiles are parchment, explored-but-unseen tiles are a
    /// sepia memory without foreign units, and the selected tile gets a ring.
    /// </summary>
    public void Render(GameState s, int viewer, int selectedTile = -1, bool seeEverything = false)
    {
        var map = s.Map;
        var db = s.Db;
        foreach (var list in _propItems.Values) list.Clear();
        var land = new List<(Transform3D, Color, Color)>();
        var water = new List<(Transform3D, Color, Color)>();
        var rotate = Basis.Identity; // Godot's 6-sided cylinder already has corners on ±Z (pointy-top), matching HexLayout
        var visible = seeEverything ? Enumerable.Repeat(true, map.Count).ToArray() : VisibilitySystem.Visible(s, viewer);
        var revealed = seeEverything ? visible : s.Players[viewer].Revealed;
        bool Known(int t) => t < revealed.Length && revealed[t];
        float k = ModelLibrary.KitScale;

        for (int t = 0; t < map.Count; t++)
        {
            var hex = map.CoordOf(t);
            var top = HexLayout.ToWorld(hex, LandTop);
            float seed = Rand(t, 1);
            if (!Known(t))
            {
                land.Add((new Transform3D(rotate, top - new Vector3(0, 0.3f, 0)), Colors.White, new Color(0, 2, seed, 0)));
                continue;
            }
            float fog = visible[t] ? 0 : 1;
            var memory = new Color(1, 1, 1, visible[t] ? 1f : 0.5f);
            if (map.IsWater(t) && !(map.Feature[t] >= 0 && db.Features[map.Feature[t]].Id == "FEATURE_ICE"))
            {
                var cls = db.Terrains[map.Terrain[t]].Class;
                float kind = cls == TerrainClass.Coast ? 0 : cls == TerrainClass.Ocean ? 1 : 2;
                water.Add((new Transform3D(rotate, HexLayout.ToWorld(hex, WaterTop - 0.06f)), Colors.White, new Color(kind, fog, seed, 0)));
                // the sea floor under shallow water reads as sand from above
                if (cls is TerrainClass.Coast or TerrainClass.Lake or TerrainClass.Channel)
                    land.Add((new Transform3D(rotate, top - new Vector3(0, 0.62f, 0)), new Color(0.75f, 0.68f, 0.5f), new Color(7, fog, seed, 0)));
                continue;
            }
            var (layer, tint) = LandLook(s, t);
            land.Add((new Transform3D(rotate, top - new Vector3(0, 0.3f, 0)), tint, new Color(layer, fog, seed, 0)));
            DressTile(s, t, top, memory, k);
        }

        foreach (var c in s.Cities) if (Known(c.Tile)) DressCity(s, c, visible[c.Tile], k);
        foreach (var o in s.Outposts)
        {
            if (!Known(o.Tile)) continue;
            var at = HexLayout.ToWorld(map.CoordOf(o.Tile), LandTop);
            AddProp("props/tent", at + new Vector3(-0.25f, 0, 0.1f), k * 1.3f, 0.6f, new Color(1, 1, 1, visible[o.Tile] ? 1 : 0.5f));
            AddProp($"buildings/tower_A_{TeamColor(s, o.Owner)}", at + new Vector3(0.25f, 0, -0.1f), k * 0.55f, 0, new Color(1, 1, 1, visible[o.Tile] ? 1 : 0.5f));
        }

        Fill(_land, land);
        Fill(_water, water);
        FlushProps();
        DrawRivers(map, revealed);
        DrawBorders(s, viewer, revealed);
        Units.Sync(s, viewer, visible);
        Select(selectedTile, map);
    }

    /// <summary>Forests, hills, mountains, marsh, improvements and districts on one revealed land tile.</summary>
    private void DressTile(GameState s, int t, Vector3 top, Color memory, float k)
    {
        var map = s.Map;
        var db = s.Db;
        string? feature = map.Feature[t] >= 0 ? db.Features[map.Feature[t]].Id : null;
        bool hills = map.Relief[t] == db.Ids.Hills;
        bool forest = feature is "FEATURE_FOREST" or "FEATURE_RAINFOREST" or "FEATURE_BLOOM";
        float yaw = Mathf.DegToRad(60 * (int)(Rand(t, 3) * 6));
        bool hasDistrict = map.District[t] >= 0;
        bool hasImprovement = map.Improvement[t] >= 0;
        var greenery = feature == "FEATURE_RAINFOREST" ? new Color(0.65f, 0.85f, 0.6f) : feature == "FEATURE_BLOOM" ? new Color(0.95f, 0.55f, 1f) : Colors.White;
        greenery.A = memory.A;

        if (map.IsMountain(t))
        {
            string m = feature == "FEATURE_VOLCANO" ? "nature/mountain_C" : db.Terrains[map.Terrain[t]].Id is "TERRAIN_SNOW" or "TERRAIN_TUNDRA"
                ? "nature/mountain_" + "ABC"[(int)(Rand(t, 5) * 3)]
                : Rand(t, 5) < 0.5f ? "nature/mountain_A_grass_trees" : "nature/mountain_B_grass";
            var mt = feature == "FEATURE_VOLCANO" ? new Color(0.65f, 0.45f, 0.4f, memory.A) : db.Terrains[map.Terrain[t]].Id == "TERRAIN_SNOW" ? new Color(0.95f, 0.97f, 1f, memory.A) : new Color(0.68f, 0.66f, 0.63f, memory.A);
            AddProp(m, top, k, yaw, mt);
            return;
        }
        if (hasDistrict)
        {
            // districts are drawn by DressCity (they belong to a city); keep the ground clear
            return;
        }
        if (hills && forest) AddProp("nature/hills_A_trees", top, k * 0.85f, yaw, greenery, flatten: 0.6f);
        else if (hills) AddProp("nature/hills_" + "ABC"[(int)(Rand(t, 7) * 3)], top, k * 0.85f, yaw, memory, flatten: 0.55f);
        else if (forest && !hasImprovement)
        {
            string size = Rand(t, 9) < 0.5f ? "large" : "medium";
            string kind = feature == "FEATURE_FOREST" ? "A" : "B";
            AddProp($"nature/trees_{kind}_{size}", top, k, yaw, greenery);
        }
        if (feature == "FEATURE_MARSH")
        {
            AddProp("nature/waterplant_B", top + new Vector3(0.3f, 0, 0.2f), k * 1.4f, yaw, memory);
            AddProp("nature/waterlily_A", top + new Vector3(-0.3f, 0, -0.1f), k * 1.6f, yaw, memory);
        }
        if (feature == "FEATURE_OASIS") AddProp("nature/tree_single_B", top, k * 1.2f, yaw, memory);
        if (feature is "FEATURE_GEOTHERMAL" or "FEATURE_VOLCANO") AddProp("nature/rock_single_A", top, k * 2f, yaw, memory);
        if (hasImprovement && !map.HasFlag(t, TileFlags.Pillaged))
        {
            string id = db.Improvements[map.Improvement[t]].Id;
            int owner = map.OwnerPlayer[t];
            string team = TeamColor(s, owner);
            switch (id)
            {
                case "IMPROVEMENT_FARM": AddProp("buildings/grain", top, k * 0.95f, yaw, memory); break;
                case "IMPROVEMENT_MINE": AddProp($"buildings/mine_{team}", top, k * 0.9f, yaw, memory); break;
                case "IMPROVEMENT_PASTURE": AddProp("buildings/building-sheep", top, 0.155f, yaw, memory); break;
                case "IMPROVEMENT_PLANTATION": AddProp($"buildings/windmill_{team}", top, k * 0.7f, yaw, memory); break;
                case "IMPROVEMENT_CAMP": AddProp($"buildings/lumbermill_{team}", top, k * 0.75f, yaw, memory); break;
                case "IMPROVEMENT_OIL_WELL": AddProp($"buildings/blacksmith_{team}", top, k * 0.7f, yaw, memory); break;
                default: AddProp("props/crate_open", top, k * 2.2f, yaw, memory); break;
            }
        }
        else if (hasImprovement) AddProp("buildings/destroyed", top, k * 0.8f, yaw, memory);
    }

    /// <summary>
    /// A city: a castle for capitals (a tower otherwise) with houses around it that grow with population, team-coloured;
    /// each district shows its own building, with scaffolding while reserved for a queued district.
    /// </summary>
    private void DressCity(GameState s, CityState c, bool visible, float k)
    {
        var map = s.Map;
        var db = s.Db;
        string team = TeamColor(s, c.Owner);
        var memory = new Color(1, 1, 1, visible ? 1 : 0.5f);
        var at = HexLayout.ToWorld(map.CoordOf(c.Tile), LandTop);
        AddProp(c.IsCapital ? $"buildings/castle_{team}" : $"buildings/tower_A_{team}", at, k * (c.IsCapital ? 0.62f : 0.6f), 0, memory);
        int houses = Math.Clamp(1 + c.Population / 2, 1, 6);
        for (int i = 0; i < houses; i++)
        {
            float a = Mathf.DegToRad(30 + 60 * i);
            var p = at + new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a)) * 0.62f;
            AddProp(i % 2 == 0 ? $"buildings/home_A_{team}" : $"buildings/home_B_{team}", p, k * 0.75f, -a + Mathf.Pi / 2, memory);
        }
        if (c.HasBuilding(db.Buildings.IndexOf(db.Rules.Combat.WallsBuilding)))
            for (int i = 0; i < 3; i++)
            {
                float a = Mathf.DegToRad(90 + 120 * i);
                AddProp($"buildings/tower_B_{team}", at + new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a)) * 0.8f, k * 0.35f, 0, memory);
            }
        foreach (var d in c.Districts)
        {
            if (d.DefIndex == db.Ids.CityCenter) continue;
            var def = db.Districts[d.DefIndex];
            var p = HexLayout.ToWorld(map.CoordOf(d.Tile), LandTop);
            var tint = d.Pillaged ? new Color(0.5f, 0.45f, 0.4f, memory.A) : memory;
            if (d.Pillaged) { AddProp("buildings/destroyed", p, k * 0.9f, 0, tint); continue; }
            foreach (var (prop, scale, offset) in DistrictLook(def, team))
                AddProp(prop, p + offset, scale, 0, tint);
        }
        // Reserved tiles for queued districts show scaffolding (Civ VI's "under construction").
        foreach (var item in c.Queue.Items)
            if (item.Kind == ProductionKind.District && item.Tile >= 0 && map.District[item.Tile] < 0)
                AddProp("buildings/scaffolding", HexLayout.ToWorld(map.CoordOf(item.Tile), LandTop), k * 0.6f, 0, memory);
    }

    private static IEnumerable<(string Prop, float Scale, Vector3 Offset)> DistrictLook(DistrictDef def, string team)
    {
        float k = ModelLibrary.KitScale;
        float kenney = 0.155f;
        var side = new Vector3(0.45f, 0, 0.25f);
        switch (def.Id)
        {
            case "DISTRICT_HARBOR": yield return ("buildings/building-port", kenney, Vector3.Zero); yield break;
            case "DISTRICT_RIVER_PORT": yield return ("buildings/building-dock", kenney, Vector3.Zero); yield break;
            case "DISTRICT_GARRISON": yield return ($"buildings/barracks_{team}", k * 0.8f, Vector3.Zero); yield return ($"buildings/archeryrange_{team}", k * 0.5f, side); yield break;
            case "DISTRICT_AQUEDUCT": case "DISTRICT_DAM": case "DISTRICT_CANAL": yield return ($"buildings/watermill_{team}", k * 0.8f, Vector3.Zero); yield break;
            case "DISTRICT_NEIGHBORHOOD":
                for (int i = 0; i < 4; i++) yield return (i % 2 == 0 ? $"buildings/home_A_{team}" : $"buildings/home_B_{team}", k * 0.7f, new Vector3((i % 2) * 0.6f - 0.3f, 0, (i / 2) * 0.6f - 0.3f));
                yield break;
            case "DISTRICT_ARENA": case "DISTRICT_CIVIC_PLAZA": yield return ("buildings/stage_A", k * 0.85f, Vector3.Zero); yield break;
        }
        switch (def.PrimaryYield)
        {
            case YieldType.Science: yield return ("buildings/building-wizard-tower", kenney, Vector3.Zero); break;
            case YieldType.Faith: yield return ($"buildings/church_{team}", k * 0.85f, Vector3.Zero); break;
            case YieldType.Gold: yield return ($"buildings/market_{team}", k * 0.85f, Vector3.Zero); break;
            case YieldType.Culture: yield return ($"buildings/tavern_{team}", k * 0.8f, Vector3.Zero); yield return ("buildings/stage_A", k * 0.45f, side); break;
            case YieldType.Production: yield return ($"buildings/blacksmith_{team}", k * 0.8f, Vector3.Zero); yield return ($"buildings/lumbermill_{team}", k * 0.5f, side); break;
            default: yield return ($"buildings/well_{team}", k, Vector3.Zero); break;
        }
    }

    private void FlushProps()
    {
        foreach (var (prop, items) in _propItems)
        {
            var model = _models.GetProp(prop);
            if (model == null) continue;
            for (int part = 0; part < model.Parts.Count; part++)
            {
                if (!_propMeshes.TryGetValue((prop, part), out var mmi))
                {
                    mmi = new MultiMeshInstance3D
                    {
                        Multimesh = new MultiMesh { TransformFormat = MultiMesh.TransformFormatEnum.Transform3D, UseColors = true, Mesh = model.Parts[part].Mesh },
                    };
                    AddChild(mmi);
                    _propMeshes[(prop, part)] = mmi;
                }
                var local = model.Parts[part].Local;
                var mm = mmi.Multimesh;
                mm.InstanceCount = items.Count;
                for (int i = 0; i < items.Count; i++)
                {
                    mm.SetInstanceTransform(i, items[i].T * local);
                    mm.SetInstanceColor(i, items[i].C);
                }
            }
        }
    }

    private static void Fill(MultiMeshInstance3D mmi, List<(Transform3D T, Color C, Color Custom)> items)
    {
        var mm = mmi.Multimesh;
        mm.InstanceCount = items.Count;
        for (int i = 0; i < items.Count; i++)
        {
            mm.SetInstanceTransform(i, items[i].T);
            mm.SetInstanceColor(i, items[i].C);
            mm.SetInstanceCustomData(i, items[i].Custom);
        }
    }

    // ----- Rivers and borders ------------------------------------------------------------------------

    /// <summary>Edge rivers as water ribbons exactly on hex edges, matching the adjacency rules players read.</summary>
    private void DrawRivers(MapGrid map, bool[] revealed)
    {
        var mesh = new ImmediateMesh();
        var mat = new StandardMaterial3D
        {
            AlbedoColor = new Color("#3d9ad1"), Roughness = 0.1f, Metallic = 0.1f,
            EmissionEnabled = true, Emission = new Color("#1b5f8c"), EmissionEnergyMultiplier = 0.25f,
        };
        mesh.SurfaceBegin(Mesh.PrimitiveType.Triangles, mat);
        int quads = 0;
        for (int t = 0; t < map.Count; t++)
        {
            if (t >= revealed.Length || !revealed[t]) continue;
            for (int d = 0; d < 3; d++) // each edge once: E, NE, NW
            {
                if (!map.HasRiverEdge(t, d)) continue;
                var (a, b) = HexLayout.Edge(map.CoordOf(t), d, LandTop + 0.012f);
                Ribbon(mesh, a, b, 0.09f, 0.09f);
                quads++;
            }
        }
        if (quads == 0) { mesh.SurfaceAddVertex(Vector3.Zero); mesh.SurfaceAddVertex(Vector3.Zero); mesh.SurfaceAddVertex(Vector3.Zero); }
        mesh.SurfaceEnd();
        _rivers.Mesh = mesh;
    }

    private static void Ribbon(ImmediateMesh mesh, Vector3 a, Vector3 b, float halfIn, float halfOut, Vector3? inward = null, Color? cIn = null, Color? cOut = null)
    {
        var dir = (b - a).Normalized();
        var n = inward ?? new Vector3(-dir.Z, 0, dir.X);
        var a1 = a - n * halfOut; var b1 = b - n * halfOut;
        var a2 = a + n * halfIn; var b2 = b + n * halfIn;
        void V(Vector3 p, Color? c) { if (c is { } col) mesh.SurfaceSetColor(col); mesh.SurfaceSetNormal(Vector3.Up); mesh.SurfaceAddVertex(p); }
        V(a1, cOut); V(b1, cOut); V(b2, cIn);
        V(a1, cOut); V(b2, cIn); V(a2, cIn);
    }

    /// <summary>
    /// Borders as ribbons inside the owner's territory: a solid band on the edge fading inward (Civ VI), your own brighter;
    /// civilizations at war with you are red with a second inner band, so a front reads at a glance and not only by hue.
    /// </summary>
    private void DrawBorders(GameState s, int viewer, bool[] revealed)
    {
        var map = s.Map;
        var mesh = new ImmediateMesh();
        var mat = new StandardMaterial3D
        {
            VertexColorUseAsAlbedo = true, ShadingMode = BaseMaterial3D.ShadingModeEnum.Unshaded,
            Transparency = BaseMaterial3D.TransparencyEnum.Alpha, CullMode = BaseMaterial3D.CullModeEnum.Disabled,
        };
        mesh.SurfaceBegin(Mesh.PrimitiveType.Triangles, mat);
        int quads = 0;
        var war = new Color("#ff3b30");
        for (int t = 0; t < map.Count; t++)
        {
            int owner = map.OwnerPlayer[t];
            if (owner < 0 || t >= revealed.Length || !revealed[t]) continue;
            var color = CivColor(s, owner);
            bool enemy = owner != viewer && DiplomacySystem.AtWar(s, viewer, owner) && !s.Players[owner].IsFreeCities;
            if (owner == viewer) color = color.Lightened(0.2f);
            if (enemy) color = war;
            var center = HexLayout.ToWorld(map.CoordOf(t), LandTop + 0.02f);
            if (map.IsWater(t)) center.Y = WaterTop + 0.02f;
            for (int d = 0; d < 6; d++)
            {
                int n = map.Neighbor(t, d);
                if (n >= 0 && map.OwnerPlayer[n] == owner) continue;
                var (a, b) = HexLayout.Edge(map.CoordOf(t), d, center.Y);
                var inward = (center - (a + b) / 2).Normalized();
                var solid = new Color(color, 0.95f);
                Ribbon(mesh, a + inward * 0.02f, b + inward * 0.02f, 0.05f, 0f, inward, solid, solid);
                Ribbon(mesh, a + inward * 0.07f, b + inward * 0.07f, 0.16f, 0f, inward, new Color(color, 0f), new Color(color, 0.35f));
                quads += 2;
                if (enemy) { Ribbon(mesh, a + inward * 0.2f, b + inward * 0.2f, 0.035f, 0f, inward, solid, solid); quads++; }
            }
        }
        if (quads == 0) { mesh.SurfaceAddVertex(Vector3.Zero); mesh.SurfaceAddVertex(Vector3.Zero); mesh.SurfaceAddVertex(Vector3.Zero); }
        mesh.SurfaceEnd();
        _borders.Mesh = mesh;
    }

    // ----- Lenses and selection ----------------------------------------------------------------------

    private MultiMeshInstance3D? _supply;

    /// <summary>Supply lens: green where your armies are supplied (brighter = deeper), red where your units are cut off.</summary>
    public void RenderSupply(GameState s, int viewer, bool visible)
    {
        _supply ??= MakeMulti(new CylinderMesh { TopRadius = 0.9f, BottomRadius = 0.9f, Height = 0.02f, RadialSegments = 6, Rings = 1 },
            new StandardMaterial3D { VertexColorUseAsAlbedo = true, Transparency = BaseMaterial3D.TransparencyEnum.Alpha, ShadingMode = BaseMaterial3D.ShadingModeEnum.Unshaded });
        var items = new List<(Transform3D, Color, Color)>();
        if (visible)
        {
            var supply = SupplySystem.Compute(s, viewer);
            var rotate = Basis.Identity;
            for (int t = 0; t < s.Map.Count; t++)
            {
                if (supply[t] < 0) continue;
                float k = Mathf.Clamp(supply[t] / 12f, 0.15f, 1f);
                items.Add((new Transform3D(rotate, HexLayout.ToWorld(s.Map.CoordOf(t), LandTop + 0.04f)), new Color(0.3f, 0.9f, 0.4f, 0.18f + 0.3f * k), default));
            }
            foreach (var u in s.Units)
                if (u.Owner == viewer && supply[u.Tile] < 0 && SupplySystem.IsMilitary(s.Db, u))
                    items.Add((new Transform3D(rotate, HexLayout.ToWorld(s.Map.CoordOf(u.Tile), LandTop + 0.05f)), new Color(0.95f, 0.2f, 0.2f, 0.6f), default));
        }
        Fill(_supply, items);
    }

    public static float SurfaceY(MapGrid map, int tile) => map.IsWater(tile) ? WaterTop : LandTop;

    public void Select(int tile, MapGrid map)
    {
        _selection.Visible = tile >= 0;
        if (tile >= 0) _selection.Position = HexLayout.ToWorld(map.CoordOf(tile), SurfaceY(map, tile) + 0.02f);
    }

    public void Hover(int tile, MapGrid map)
    {
        _hover.Visible = tile >= 0;
        if (tile >= 0) _hover.Position = HexLayout.ToWorld(map.CoordOf(tile), SurfaceY(map, tile) + 0.02f);
    }
}
