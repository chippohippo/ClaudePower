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
    public const float WaterTop = 0.035f;

    private readonly ModelLibrary _models = new();
    private TerrainMesh _terrain = null!;
    private MeshInstance3D _waterPlane = null!;
    private MeshInstance3D _rivers = null!, _borders = null!, _selection = null!, _hover = null!;
    private readonly Dictionary<(string Prop, int Part), MultiMeshInstance3D> _propMeshes = new();
    public UnitLayer Units { get; private set; } = null!;
    public ModelLibrary Models => _models;

    private static readonly string[] Layers = { "grassland", "plains", "desert", "tundra", "snow", "rock", "cliff", "beach" };

    public override void _Ready()
    {
        PaperNoise = BuildPaperNoise();
        _terrainMat = new ShaderMaterial { Shader = GD.Load<Shader>("res://shaders/terrain.gdshader") };
        _terrainMat.SetShaderParameter("albedo_tex", BuildArray("baseColor"));
        _terrainMat.SetShaderParameter("normal_tex", BuildArray("normal"));
        _terrainMat.SetShaderParameter("paper_noise", PaperNoise);
        _terrainMat.SetShaderParameter("layer_tint", LayerTints);
        _terrain = new TerrainMesh();
        _terrain.Configure(_terrainMat);
        AddChild(_terrain);

        _waterMat = new ShaderMaterial { Shader = GD.Load<Shader>("res://shaders/water.gdshader") };
        _waterMat.SetShaderParameter("wave_a", WaveTexture(11, 0.9f));
        _waterMat.SetShaderParameter("wave_b", WaveTexture(23, 1.6f));
        _waterMat.SetShaderParameter("paper_noise", PaperNoise);
        _waterPlane = new MeshInstance3D { MaterialOverride = _waterMat, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off };
        AddChild(_waterPlane);

        _rivers = new MeshInstance3D { CastShadow = GeometryInstance3D.ShadowCastingSetting.Off };
        _borders = new MeshInstance3D { CastShadow = GeometryInstance3D.ShadowCastingSetting.Off };
        _selection = Ring(new Color("#ffd54a"), 0.86f, 0.98f);
        _hover = Ring(new Color(1, 1, 1, 0.55f), 0.9f, 0.97f);
        AddChild(_rivers);
        AddChild(_borders);
        Units = new UnitLayer(_models);
        AddChild(Units);
        Life = new LifeLayer(_models);
        AddChild(Life);
    }

    public LifeLayer Life { get; private set; } = null!;

    private MeshInstance3D Ring(Color color, float inner, float outer)
    {
        var ring = new MeshInstance3D
        {
            Mesh = new TorusMesh { InnerRadius = inner, OuterRadius = outer, Rings = 6, RingSegments = 4 },
            MaterialOverride = new StandardMaterial3D
            {
                AlbedoColor = color, ShadingMode = BaseMaterial3D.ShadingModeEnum.Unshaded,
                Transparency = BaseMaterial3D.TransparencyEnum.Alpha, NoDepthTest = true, RenderPriority = 2,
            },
            Scale = new Vector3(1, 0.15f, 1), Visible = false, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off,
            RotationDegrees = new Vector3(0, 30, 0),
        };
        AddChild(ring);
        return ring;
    }

    private ShaderMaterial _terrainMat = null!, _waterMat = null!;
    private ImageTexture? _tileData;

    /// <summary>RGB noise shared by the paper-map shaders: R stains and colour variation, G grain, B paper fibres.</summary>
    public static Texture2D PaperNoise { get; private set; } = null!;

    /// <summary>Base tint per terrain layer: the identity of each terrain (lush grassland, golden plains, pale tundra...).</summary>
    private static readonly Vector3[] LayerTints =
    {
        new(0.60f, 0.78f, 0.40f), new(0.80f, 0.78f, 0.40f), new(1.00f, 0.80f, 0.54f), new(0.66f, 0.68f, 0.56f),
        new(0.95f, 0.97f, 1.00f), new(0.70f, 0.68f, 0.64f), new(0.78f, 0.70f, 0.60f), new(1.00f, 0.90f, 0.70f),
    };

    private static Texture2D BuildPaperNoise()
    {
        const int size = 512;
        byte[] Channel(int seed, float frequency, FastNoiseLite.NoiseTypeEnum type, int octaves)
        {
            var noise = new FastNoiseLite { Seed = seed, Frequency = frequency, NoiseType = type, FractalOctaves = octaves };
            var img = noise.GetSeamlessImage(size, size, false, false, 0.1f, true);
            img.Convert(Image.Format.L8);
            return img.GetData();
        }
        var r = Channel(3, 0.006f, FastNoiseLite.NoiseTypeEnum.Simplex, 4);
        var g = Channel(7, 0.05f, FastNoiseLite.NoiseTypeEnum.Perlin, 2);
        var b = Channel(13, 0.02f, FastNoiseLite.NoiseTypeEnum.Cellular, 3);
        var data = new byte[size * size * 3];
        for (int i = 0; i < size * size; i++) { data[i * 3] = r[i]; data[i * 3 + 1] = g[i]; data[i * 3 + 2] = b[i]; }
        var image = Image.CreateFromData(size, size, false, Image.Format.Rgb8, data);
        image.GenerateMipmaps();
        return ImageTexture.CreateFromImage(image);
    }

    /// <summary>The per-tile data texture, shared with other map shaders (roads read the fog from it).</summary>
    public ImageTexture? TileData => _tileData;

    /// <summary>Hands the hex-map uniforms (tile data, size, wrap) to another material that includes hexmap.gdshaderinc.</summary>
    public void ShareMapUniforms(ShaderMaterial m, MapGrid map)
    {
        m.SetShaderParameter("tile_data", _tileData);
        m.SetShaderParameter("map_size", new Vector2(map.Width, map.Height));
        m.SetShaderParameter("wrap_x", map.WrapX);
        m.SetShaderParameter("paper_noise", PaperNoise);
    }

    /// <summary>One texel per tile: terrain layer, fog, water kind, feature (layout documented in hexmap.gdshaderinc).</summary>
    private void UpdateTileData(GameState s, bool[] visible, bool[] revealed)
    {
        var map = s.Map;
        var db = s.Db;
        var bytes = new byte[map.Width * map.Height * 4];
        for (int row = 0; row < map.Height; row++)
            for (int col = 0; col < map.Width; col++)
            {
                int t = map.IndexOf(Sim.Core.HexCoord.FromOffset(col, row));
                int i = (row * map.Width + col) * 4;
                if (t < 0) { bytes[i + 1] = 2; bytes[i + 2] = 2; continue; }
                bool known = t < revealed.Length && revealed[t];
                bytes[i + 1] = (byte)(!known ? 2 : visible[t] ? 0 : 1);
                var cls = db.Terrains[map.Terrain[t]].Class;
                string? feature = map.Feature[t] >= 0 ? db.Features[map.Feature[t]].Id : null;
                bool ice = feature == "FEATURE_ICE";
                bytes[i + 2] = (byte)(!map.IsWater(t) || ice ? 0 : cls == TerrainClass.Coast ? 1 : cls == TerrainClass.Ocean ? 2 : 3);
                var (layer, featureCode) = Surface(s, t);
                bytes[i] = (byte)layer;
                bytes[i + 3] = (byte)featureCode;
            }
        var image = Image.CreateFromData(map.Width, map.Height, false, Image.Format.Rgba8, bytes);
        if (_tileData == null || _tileData.GetWidth() != map.Width || _tileData.GetHeight() != map.Height)
        {
            _tileData = ImageTexture.CreateFromImage(image);
            foreach (var m in new[] { _terrainMat, _waterMat })
            {
                m.SetShaderParameter("tile_data", _tileData);
                m.SetShaderParameter("map_size", new Vector2(map.Width, map.Height));
                m.SetShaderParameter("wrap_x", map.WrapX);
            }
        }
        else _tileData.Update(image);
    }

    private static (int Layer, int Feature) Surface(GameState s, int t)
    {
        var db = s.Db;
        var map = s.Map;
        string terrain = db.Terrains[map.Terrain[t]].Id;
        string? feature = map.Feature[t] >= 0 ? db.Features[map.Feature[t]].Id : null;
        int layer = terrain switch
        {
            "TERRAIN_PLAINS" => 1, "TERRAIN_DESERT" => 2, "TERRAIN_TUNDRA" => 3, "TERRAIN_SNOW" => 4,
            "TERRAIN_ENGINEERED" or "TERRAIN_SUBSTRATE" => 5, _ => 0,
        };
        if (map.IsMountain(t)) layer = 5;
        if (feature == "FEATURE_ICE") layer = 4;
        int code = feature switch
        {
            "FEATURE_FLOODPLAINS" => 1, "FEATURE_MARSH" => 2, "FEATURE_BLOOM" => 3, "FEATURE_OASIS" => 6, _ => 0,
        };
        if (terrain == "TERRAIN_ENGINEERED") code = 7;
        if (terrain == "TERRAIN_SUBSTRATE") code = 8;
        if (map.Improvement[t] >= 0 && code == 0)
            code = db.Improvements[map.Improvement[t]].Id switch
            {
                "IMPROVEMENT_FARM" => 9, "IMPROVEMENT_PLANTATION" => 10, "IMPROVEMENT_PASTURE" => 11, _ => 0,
            };
        if (code == 0 && map.Resource[t] >= 0 && db.Resources[map.Resource[t]].Id == "RESOURCE_WHEAT") code = 12;
        if (code == 0 && (map.IsMountain(t) || map.Relief[t] == db.Ids.Hills) && NationSystem.WorksMountains(s, map.OwnerPlayer[t])) code = 13;
        if (map.HasFlag(t, TileFlags.Flooded)) code = 4;
        if (map.HasFlag(t, TileFlags.Pillaged)) code = 5;
        return (layer, code);
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

    private static float Rand(int t, int salt) => ((uint)(t * 2654435761u ^ (uint)salt * 40503u) % 1000) / 1000f;

    /// <summary>Team colour of KayKit buildings, the closest of blue / red / green / yellow to the civilization's colour.</summary>
    /// <summary>
    /// The building-kit suffix for a player: the kit's blue variant, with its team-blue texels repainted in the nation's own
    /// primary (ModelLibrary parses "blue#rrggbb"), so every nation's roofs, banners and awnings are its own colour.
    /// </summary>
    public static string TeamColor(GameState s, int player) =>
        player < 0 || player >= s.Players.Count ? "blue" : $"blue#{NationColors.Primary(s, player).ToHtml(false)}";

    /// <summary>The player's primary colour (resolved so that no two players on the map look alike).</summary>
    public static Color CivColor(GameState s, int player) => NationColors.Primary(s, player);

    /// <summary>The player's secondary colour (border lines, ring and flag trims).</summary>
    public static Color CivSecondary(GameState s, int player) => NationColors.Secondary(s, player);

    // ----- Render ------------------------------------------------------------------------------------

    private readonly Dictionary<string, List<(Transform3D T, Color C, Color Glow)>> _propItems = new();

    private void AddProp(string prop, Vector3 at, float scale, float yaw, Color tint, float flatten = 1f, Color glow = default, float lift = 0f)
    {
        if (!_propItems.TryGetValue(prop, out var list)) _propItems[prop] = list = new();
        at.Y = HeightField.Current.Surface(at.X, at.Z) - 0.01f + lift;   // everything stands on the ground
        list.Add((new Transform3D(new Basis(Vector3.Up, yaw).Scaled(new Vector3(scale, scale * flatten, scale)), at), tint, glow));
    }

    /// <summary>Adds a prop fitted to a size in world units (its longest horizontal side), whatever scale the model was authored at.</summary>
    private void AddFit(string prop, Vector3 at, float size, float yaw, Color tint, bool byHeight = false, Color glow = default, float lift = 0f)
    {
        var model = _models.GetProp(prop);
        if (OS.GetCmdlineUserArgs().Contains("--debug-props") && prop.StartsWith("landmarks")) GD.Print($"[prop] {prop} at {at} model {(model == null ? "null" : model.Parts.Count + " parts " + model.Bounds)}");
        if (model == null) return;
        var b = model.Bounds.Size;
        float extent = byHeight ? b.Y : Mathf.Max(b.X, b.Z);
        AddProp(prop, at, extent > 0.0001f ? size / extent : 1f, yaw, tint, 1f, glow, lift);
    }

    /// <summary>The kit's bale is peach with red bands; a golden multiply turns it to straw with twine.</summary>
    private static Color Hay(Color memory) => new(1.08f, 1.0f, 0.5f, memory.A);

    private readonly Dictionary<int, TechLook> _looks = new();

    /// <summary>A player's look, computed once per render (TechLook reads their researched techs).</summary>
    private TechLook LookOf(GameState s, int player)
    {
        if (player < 0) return TechLook.Default;
        if (!_looks.TryGetValue(player, out var look)) _looks[player] = look = TechLook.For(s, player);
        return look;
    }

    /// <summary>A farmstead by technology: a cottage and haystacks, then a suburban farmhouse and silo, solar fields with
    /// renewables; sealed hydroponic hangars (Sovereign), fungus gardens (Symbiont), solar and server farms (Discarnate).</summary>
    private void DressFarm(int t, Vector3 top, float yaw, string team, Color memory, TechLook look, float k)
    {
        bool lit = memory.A >= 0.75f;
        switch (look.Architecture)
        {
            case Architecture.Sovereign:
                AddFit("future/hangar_round", top + new Vector3(0.15f, 0, 0.1f), 0.55f, yaw, new Color(TechLook.PathTint(0), memory.A), false, lit ? TechLook.GlowData(0, 0.3f) : default);
                return;
            case Architecture.Symbiont:
                AddFit("future/dome_glass", top + new Vector3(0.18f, 0, 0.1f), 0.42f, yaw, new Color(0.7f, 1.05f, 0.9f, memory.A), false, lit ? TechLook.GlowData(1, 0.5f) : default);
                AddFit("future/mushroom_group", top + new Vector3(-0.25f, 0, 0.3f), 0.3f, yaw, new Color(0.8f, 0.55f, 1.1f, memory.A), false, lit ? TechLook.GlowData(1, 0.8f) : default);
                return;
            case Architecture.Discarnate:
                AddFit("era/solar_field", top + new Vector3(-0.1f, 0, 0.15f), 0.7f, yaw, new Color(0.5f, 0.48f, 0.62f, memory.A), false, lit ? TechLook.GlowData(2, 0.4f) : default);
                AddFit("future/structure_detailed", top + new Vector3(0.35f, 0, -0.2f), 0.2f, yaw, new Color(TechLook.PathTint(2), memory.A), false, lit ? TechLook.GlowData(2, 0.8f) : default);
                return;
        }
        if (look.Architecture >= Architecture.Industrial)
        {
            AddFit("era/suburb_a", top + new Vector3(0.18f, 0, 0.12f), 0.3f, yaw, memory);
            AddFit(look.Renewable ? "era/solar_field" : "era/tank_storage", top + new Vector3(-0.22f, 0, 0.3f), look.Renewable ? 0.45f : 0.2f, yaw, memory);
            return;
        }
        AddProp(Rand(t, 8) < 0.5f ? $"buildings/home_A_{team}" : $"buildings/home_B_{team}", top + new Vector3(0.18f, 0, 0.12f), k * 0.42f, yaw, memory);
        AddFit("resources/hay", top + new Vector3(-0.2f, 0, 0.3f), 0.14f, yaw + 0.5f, Hay(memory));
        AddFit("resources/hay", top + new Vector3(-0.05f, 0, 0.4f), 0.12f, yaw + 1.3f, Hay(memory));
    }

    private int _viewer;
    private bool _seeAll;

    /// <summary>Whether <paramref name="viewer"/> can see the resource on a tile: known tile, and the reveal tech researched.</summary>
    public static int VisibleResource(GameState s, int viewer, int t, bool seeEverything = false)
    {
        int r = s.Map.Resource[t];
        if (r < 0) return -1;
        if (seeEverything) return r;
        if (viewer < 0 || viewer >= s.Players.Count) return -1;
        var p = s.Players[viewer];
        if (t >= p.Revealed.Length || !p.Revealed[t]) return -1;
        var def = s.Db.Resources[r];
        return def.RevealTechIndex < 0 || p.HasTech(def.RevealTechIndex) ? r : -1;
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
        var rotate = Basis.Identity; // Godot's 6-sided cylinder already has corners on ±Z (pointy-top), matching HexLayout
        var visible = seeEverything ? Enumerable.Repeat(true, map.Count).ToArray() : VisibilitySystem.Visible(s, viewer);
        var revealed = seeEverything ? visible : s.Players[viewer].Revealed;
        bool Known(int t) => t < revealed.Length && revealed[t];
        float k = ModelLibrary.KitScale;
        _viewer = viewer;
        _seeAll = seeEverything;
        _looks.Clear();

        UpdateTileData(s, visible, revealed);
        HeightField.Current.Update(s, revealed);
        _terrain.Sync(s);
        PlaceWater(map);
        for (int t = 0; t < map.Count; t++)
        {
            if (!Known(t) || map.IsWater(t)) continue;
            DressTile(s, t, HexLayout.ToWorld(map.CoordOf(t), 0), new Color(1, 1, 1, visible[t] ? 1f : 0.5f), k);
        }

        // Natural wonders: one landmark model fills the hex (water ones float at the surface).
        for (int t = 0; t < map.Count; t++)
        {
            if (!Known(t) || map.Feature[t] < 0 || db.Features[map.Feature[t]] is not { NaturalWonder: true, Model: { } model }) continue;
            var at = HexLayout.ToWorld(map.CoordOf(t), 0);
            float lift = map.IsWater(t) ? Mathf.Max(0f, WaterTop - HeightField.Current.Surface(at.X, at.Z)) - 0.012f : 0f;
            AddFit(model, at, 1.5f, Mathf.DegToRad(60 * (int)(Rand(t, 9) * 6)), new Color(1, 1, 1, visible[t] ? 1f : 0.5f), false, default, lift);
        }
        // Barbarian camps: hide tents around a fire, a red banner over them.
        foreach (var (campTile, _) in s.Camps)
        {
            if (!Known(campTile)) continue;
            var at = HexLayout.ToWorld(map.CoordOf(campTile), LandTop);
            var fade = new Color(1, 1, 1, visible[campTile] ? 1f : 0.5f);
            AddProp("props/tent", at + new Vector3(-0.3f, 0, 0.12f), k * 1.25f, 0.4f, new Color(0.75f, 0.6f, 0.45f, fade.A));
            AddProp("props/tent", at + new Vector3(0.28f, 0, -0.16f), k * 1.1f, 2.2f, new Color(0.7f, 0.55f, 0.42f, fade.A));
            AddProp("props/crate_open", at + new Vector3(0.05f, 0, 0.3f), k * 0.9f, 0.9f, fade);
            AddFit("props/flag_blue", at + new Vector3(0.02f, 0, -0.02f), 0.7f, 0, new Color(1.3f, 0.25f, 0.2f, fade.A), true);
        }

        foreach (var c in s.Cities) if (Known(c.Tile)) DressCity(s, c, visible[c.Tile], k);
        foreach (var o in s.Outposts)
        {
            if (!Known(o.Tile)) continue;
            var at = HexLayout.ToWorld(map.CoordOf(o.Tile), LandTop);
            AddProp("props/tent", at + new Vector3(-0.25f, 0, 0.1f), k * 1.3f, 0.6f, new Color(1, 1, 1, visible[o.Tile] ? 1 : 0.5f));
            AddProp($"buildings/tower_A_{TeamColor(s, o.Owner)}", at + new Vector3(0.25f, 0, -0.1f), k * 0.55f, 0, new Color(1, 1, 1, visible[o.Tile] ? 1 : 0.5f));
        }

        FlushProps();
        DrawRivers(map, revealed);
        DrawBorders(s, viewer, revealed);
        Units.Sync(s, viewer, visible);
        Life.Sync(s, viewer, visible, revealed, seeEverything);
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

        if (map.Feature[t] >= 0 && db.Features[map.Feature[t]].NaturalWonder) return;   // drawn whole, above
        if (map.IsMountain(t))
        {
            // The peak itself is the landscape (HeightField); scatter a few boulders on its flanks.
            var stone = feature == "FEATURE_VOLCANO" ? new Color(0.45f, 0.32f, 0.3f, memory.A) : new Color(0.8f, 0.78f, 0.74f, memory.A);
            for (int i = 0; i < 3; i++)
            {
                float ang = Rand(t, 40 + i) * Mathf.Tau, rad = 0.55f + Rand(t, 50 + i) * 0.35f;
                AddProp("nature/rock_single_A", top + new Vector3(Mathf.Cos(ang), 0, Mathf.Sin(ang)) * rad, k * (0.8f + 0.6f * Rand(t, 60 + i)), ang, stone);
            }
            if (Rand(t, 70) < 0.5f && db.Terrains[map.Terrain[t]].Id is not ("TERRAIN_SNOW" or "TERRAIN_DESERT"))
                for (int i = 0; i < 3; i++)
                {
                    float ang = Rand(t, 80 + i) * Mathf.Tau;
                    AddProp("nature/tree_single_B", top + new Vector3(Mathf.Cos(ang), 0, Mathf.Sin(ang)) * 0.9f, k * 0.5f, ang, memory);
                }
            return;
        }
        if (hasDistrict) return;   // districts are drawn by DressCity (they belong to a city); keep the ground clear
        if (forest && !hasImprovement)
        {
            // A real wood: a dozen trees of two kinds and many sizes, scattered so the canopy runs into the neighbours.
            int trees = feature == "FEATURE_RAINFOREST" ? 22 : 18;
            for (int i = 0; i < trees; i++)
            {
                float ang = Rand(t, 100 + i) * Mathf.Tau;
                float rad = Mathf.Sqrt(Rand(t, 200 + i)) * 0.95f;
                var at = top + new Vector3(Mathf.Cos(ang), 0, Mathf.Sin(ang)) * rad;
                string kind = feature == "FEATURE_FOREST" ? (Rand(t, 300 + i) < 0.7f ? "A" : "B") : (Rand(t, 300 + i) < 0.7f ? "B" : "A");
                var shade = greenery * (0.82f + 0.3f * Rand(t, 400 + i));
                shade.A = memory.A;
                AddProp($"nature/tree_single_{kind}", at, k * (0.42f + 0.3f * Rand(t, 500 + i)), ang, shade);
            }
        }
        else if (hills && Rand(t, 7) < 0.6f) AddProp("nature/rock_single_A", top + new Vector3(0.3f, 0, -0.2f), k * 1.4f, yaw, memory);
        if (feature == "FEATURE_MARSH")
        {
            for (int i = 0; i < 4; i++)
            {
                float ang = Rand(t, 600 + i) * Mathf.Tau;
                AddProp(i % 2 == 0 ? "nature/waterplant_B" : "nature/waterlily_A", top + new Vector3(Mathf.Cos(ang), 0, Mathf.Sin(ang)) * 0.5f, k * 1.5f, ang, memory);
            }
        }
        if (feature == "FEATURE_OASIS") AddProp("nature/tree_single_B", top, k * 0.7f, yaw, memory);
        if (feature is "FEATURE_GEOTHERMAL") AddProp("nature/rock_single_A", top, k * 2f, yaw, memory);
        if (hasImprovement && !map.HasFlag(t, TileFlags.Pillaged))
        {
            string id = db.Improvements[map.Improvement[t]].Id;
            int owner = map.OwnerPlayer[t];
            string team = TeamColor(s, owner);
            switch (id)
            {
                case "IMPROVEMENT_FARM":
                    // The fields are painted into the ground (terrain shader); what stands among them follows the owner's research.
                    DressFarm(t, top, yaw, team, memory, LookOf(s, owner), k);
                    break;
                case "IMPROVEMENT_MINE":
                    AddProp($"buildings/mine_{team}", top, k * 0.6f, yaw, memory);
                    if (LookOf(s, owner).Architecture is >= Architecture.Industrial and < Architecture.Sovereign)
                        AddFit("era/chimney_industrial", top + new Vector3(0.3f, 0, -0.25f), 0.55f, 0, memory, true);
                    break;
                case "IMPROVEMENT_PASTURE": AddProp("buildings/building-sheep", top, 0.09f, yaw, memory); break;
                case "IMPROVEMENT_PLANTATION": AddProp($"buildings/windmill_{team}", top, k * 0.7f, yaw, memory); break;
                case "IMPROVEMENT_CAMP": AddProp($"buildings/lumbermill_{team}", top, k * 0.75f, yaw, memory); break;
                case "IMPROVEMENT_OIL_WELL": AddProp($"buildings/blacksmith_{team}", top, k * 0.7f, yaw, memory); break;
                default: AddProp("props/crate_open", top, k * 2.2f, yaw, memory); break;
            }
        }
        else if (hasImprovement) AddProp("buildings/destroyed", top, k * 0.8f, yaw, memory);
        DressResource(s, t, top, memory, hasImprovement);
    }

    /// <summary>
    /// The resource itself, readable at a glance in the tile's far corner so it never fights the improvement in the middle:
    /// vines and barrels for wine, ore heaps for iron and coal, glowing crystals for uranium, drums for oil. Livestock and game
    /// are alive (LifeLayer) rather than drawn here.
    /// </summary>
    private void DressResource(GameState s, int t, Vector3 top, Color memory, bool improved)
    {
        int r = VisibleResource(s, _viewer, t, _seeAll);
        if (r < 0) return;
        string id = s.Db.Resources[r].Id;
        float a0 = Rand(t, 900) * Mathf.Tau;
        Vector3 Spot(int i, float rad) { float a = a0 + i * 2.1f; return top + new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a)) * rad; }
        Color Tone(float r_, float g, float b) => new(r_, g, b, memory.A);
        switch (id)
        {
            case "RESOURCE_WHEAT":
                if (!improved) for (int i = 0; i < 2; i++) AddFit("resources/hay", Spot(i, 0.5f), 0.16f, a0 + i, Hay(memory));
                break;
            case "RESOURCE_STONE":
                AddFit("props/resource_stone", Spot(0, 0.45f), 0.42f, a0, memory);
                AddFit("nature/rock_single_A", Spot(1, 0.55f), 0.3f, a0 + 1, Tone(0.85f, 0.83f, 0.8f));
                break;
            case "RESOURCE_WINE":
                for (int i = 0; i < 4; i++) AddFit("resources/grapes", Spot(0, 0.5f) + new Vector3(i * 0.13f - 0.2f, 0, (i % 2) * 0.12f), 0.16f, a0, memory, true);
                AddFit("resources/barrel", Spot(2, 0.55f), 0.13f, a0, memory, true);
                break;
            case "RESOURCE_SPICES":
                for (int i = 0; i < 4; i++) AddFit("resources/pepper", Spot(i, 0.45f + 0.1f * (i % 2)), 0.16f, a0 + i, memory, true);
                break;
            case "RESOURCE_SILK":
                for (int i = 0; i < 3; i++) AddFit("nature/tree_single_B", Spot(i, 0.55f), 0.3f, a0 + i, Tone(1f, 0.72f, 0.85f), true);
                AddFit("props/sack", Spot(1, 0.3f), 0.18f, a0, Tone(0.95f, 0.85f, 1f));
                break;
            case "RESOURCE_IRON":
                AddFit("resources/ore", Spot(0, 0.45f), 0.4f, a0, Tone(0.75f, 0.52f, 0.42f));
                AddFit("resources/ore", Spot(1, 0.55f), 0.26f, a0 + 2, Tone(0.7f, 0.5f, 0.42f));
                break;
            case "RESOURCE_COAL":
                AddFit("resources/ore", Spot(0, 0.45f), 0.4f, a0, Tone(0.28f, 0.27f, 0.27f));
                AddFit("resources/ore", Spot(1, 0.55f), 0.26f, a0 + 2, Tone(0.32f, 0.3f, 0.3f));
                break;
            case "RESOURCE_URANIUM":
                AddFit("resources/crystals", Spot(0, 0.45f), 0.32f, a0, Tone(0.6f, 1.25f, 0.55f), true);
                AddFit("resources/crystals", Spot(1, 0.55f), 0.22f, a0 + 1, Tone(0.6f, 1.2f, 0.5f), true);
                break;
            case "RESOURCE_OIL":
                for (int i = 0; i < 3; i++) AddFit("resources/barrel", Spot(0, 0.5f) + new Vector3(i * 0.12f, 0, (i % 2) * 0.1f), 0.12f, a0, Tone(0.3f, 0.3f, 0.34f), true);
                break;
            case "RESOURCE_PEARLS":
                AddFit("resources/clam", Spot(0, 0.4f), 0.2f, a0, memory);
                break;
        }
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
        var look = TechLook.For(s, c.Owner);
        bool walls = c.HasBuilding(db.Buildings.IndexOf(db.Rules.Combat.WallsBuilding));
        string? civ = s.Players[c.Owner].CivIndex >= 0 ? db.Civilizations[s.Players[c.Owner].CivIndex].Id : null;
        foreach (var piece in CityLayout.Centre(look, c, walls, civ)) Draw(piece, at, team, memory, look, k);
        foreach (var d in c.Districts)
        {
            if (d.DefIndex == db.Ids.CityCenter) continue;
            var def = db.Districts[d.DefIndex];
            var p = HexLayout.ToWorld(map.CoordOf(d.Tile), LandTop);
            var tint = d.Pillaged ? new Color(0.5f, 0.45f, 0.4f, memory.A) : memory;
            if (d.Pillaged) { AddProp("buildings/destroyed", p, k * 0.9f, 0, tint); continue; }
            bool any = false;
            foreach (var piece in CityLayout.District(look, def)) { Draw(piece, p, team, tint, look, k); any = true; }
            if (!any)
                foreach (var (prop, scale, offset) in DistrictLook(def, team))
                    AddProp(prop, p + offset, scale, 0, tint);
        }
        // Reserved tiles for queued districts show scaffolding (Civ VI's "under construction").
        foreach (var item in c.Queue.Items)
            if (item.Kind == ProductionKind.District && item.Tile >= 0 && map.District[item.Tile] < 0)
                AddProp("buildings/scaffolding", HexLayout.ToWorld(map.CoordOf(item.Tile), LandTop), k * 0.4f, 0, memory);
    }

    /// <summary>Places one <see cref="CityLayout.Piece"/>: team colour, the path's tint and glow, remembered tiles in sepia.</summary>
    private void Draw(CityLayout.Piece piece, Vector3 origin, string team, Color memory, TechLook look, float k)
    {
        string prop = piece.Prop.Replace("{team}", team);
        var tint = piece.Tint ?? Colors.White;
        tint.A = memory.A;
        if (memory.A < 0.75f) tint = new Color(tint.R, tint.G, tint.B, memory.A);
        var glow = piece.Glow > 0 && memory.A >= 0.75f ? TechLook.GlowData(look.Path, piece.Glow) : default;
        if (piece.Mode == CityLayout.Fit.Kit) AddProp(prop, origin + piece.Offset, k * piece.Size, piece.Yaw, tint, 1f, glow);
        else AddFit(prop, origin + piece.Offset, piece.Size, piece.Yaw, tint, piece.Mode == CityLayout.Fit.Height, glow);
    }

    private static IEnumerable<(string Prop, float Scale, Vector3 Offset)> DistrictLook(DistrictDef def, string team)
    {
        float k = ModelLibrary.KitScale;
        float kenney = 0.155f;
        var side = new Vector3(0.45f, 0, 0.25f);
        switch (def.Id)
        {
            case "DISTRICT_HARBOR": yield return ("buildings/building-port", kenney * 0.6f, Vector3.Zero); yield break;
            case "DISTRICT_RIVER_PORT": yield return ("buildings/building-dock", kenney * 0.6f, Vector3.Zero); yield break;
            case "DISTRICT_GARRISON": yield return ($"buildings/barracks_{team}", k * 0.8f, Vector3.Zero); yield return ($"buildings/archeryrange_{team}", k * 0.5f, side); yield break;
            case "DISTRICT_AQUEDUCT": case "DISTRICT_DAM": case "DISTRICT_CANAL": yield return ($"buildings/watermill_{team}", k * 0.8f, Vector3.Zero); yield break;
            case "DISTRICT_NEIGHBORHOOD":
                for (int i = 0; i < 4; i++) yield return (i % 2 == 0 ? $"buildings/home_A_{team}" : $"buildings/home_B_{team}", k * 0.7f, new Vector3((i % 2) * 0.6f - 0.3f, 0, (i / 2) * 0.6f - 0.3f));
                yield break;
            case "DISTRICT_ARENA": case "DISTRICT_CIVIC_PLAZA": yield return ("buildings/stage_A", k * 0.85f, Vector3.Zero); yield break;
        }
        switch (def.PrimaryYield)
        {
            case YieldType.Science: yield return ($"buildings/tower_B_{team}", k * 0.75f, Vector3.Zero); yield return ($"buildings/home_B_{team}", k * 0.5f, side); break;
            case YieldType.Faith: yield return ($"buildings/church_{team}", k * 0.85f, Vector3.Zero); break;
            case YieldType.Gold: yield return ($"buildings/market_{team}", k * 0.85f, Vector3.Zero); break;
            case YieldType.Culture: yield return ($"buildings/tavern_{team}", k * 0.8f, Vector3.Zero); yield return ("buildings/stage_A", k * 0.45f, side); break;
            case YieldType.Production: yield return ($"buildings/blacksmith_{team}", k * 0.8f, Vector3.Zero); yield return ($"buildings/lumbermill_{team}", k * 0.5f, side); break;
            default: yield return ($"buildings/well_{team}", k, Vector3.Zero); break;
        }
    }

    private void PlaceWater(MapGrid map)
    {
        float w = Mathf.Sqrt(3f) * (map.Width + 1) + 60f, h = 1.5f * map.Height + 60f;
        if (_waterPlane.Mesh is not PlaneMesh pm || !Mathf.IsEqualApprox(pm.Size.X, w))
            _waterPlane.Mesh = new PlaneMesh { Size = new Vector2(w, h), SubdivideWidth = 0, SubdivideDepth = 0 };
        _waterPlane.Position = new Vector3(Mathf.Sqrt(3f) * map.Width / 2f, 0f, 1.5f * map.Height / 2f);
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
                        Multimesh = new MultiMesh { TransformFormat = MultiMesh.TransformFormatEnum.Transform3D, UseColors = true, UseCustomData = true, Mesh = model.Parts[part].Mesh },
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
                    mm.SetInstanceCustomData(i, items[i].Glow);
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
        var mat = new ShaderMaterial { Shader = GD.Load<Shader>("res://shaders/river.gdshader") };
        mat.SetShaderParameter("noise", PaperNoise);
        mesh.SurfaceBegin(Mesh.PrimitiveType.Triangles, mat);
        int quads = 0;
        for (int t = 0; t < map.Count; t++)
        {
            if (t >= revealed.Length || !revealed[t]) continue;
            for (int d = 0; d < 3; d++) // each edge once: E, NE, NW
            {
                if (!map.HasRiverEdge(t, d)) continue;
                var (a, b) = HexLayout.Edge(map.CoordOf(t), d, 0);
                Draped(mesh, a, b, 0.11f, 0.11f, null, null, null, 0.02f, uv: true);
                quads++;
            }
        }
        if (quads == 0) { mesh.SurfaceAddVertex(Vector3.Zero); mesh.SurfaceAddVertex(Vector3.Zero); mesh.SurfaceAddVertex(Vector3.Zero); }
        mesh.SurfaceEnd();
        _rivers.Mesh = mesh;
    }

    /// <summary>A ribbon laid over the ground: split into short pieces, each vertex lifted to the terrain height.</summary>
    private static void Draped(ImmediateMesh mesh, Vector3 a, Vector3 b, float halfIn, float halfOut, Vector3? inward, Color? cIn, Color? cOut, float lift, bool uv = false)
    {
        const int pieces = 4;
        var dir = (b - a).Normalized();
        var n = inward ?? new Vector3(-dir.Z, 0, dir.X);
        var hf = HeightField.Current;
        Vector3 At(Vector3 p) => new(p.X, hf.Surface(p.X, p.Z) + lift, p.Z);
        for (int i = 0; i < pieces; i++)
        {
            var p0 = a.Lerp(b, i / (float)pieces);
            var p1 = a.Lerp(b, (i + 1) / (float)pieces);
            var o0 = At(p0 - n * halfOut); var o1 = At(p1 - n * halfOut);
            var i0 = At(p0 + n * halfIn); var i1 = At(p1 + n * halfIn);
            float v0 = (a.X + a.Z) * 0.7f + i / (float)pieces, v1 = v0 + 1f / pieces;
            void V(Vector3 p, Color? c, float u, float v)
            {
                if (c is { } col) mesh.SurfaceSetColor(col);
                if (uv) mesh.SurfaceSetUV(new Vector2(u, v));
                mesh.SurfaceSetNormal(Vector3.Up);
                mesh.SurfaceAddVertex(p);
            }
            V(o0, cOut, 0, v0); V(o1, cOut, 0, v1); V(i1, cIn, 1, v1);
            V(o0, cOut, 0, v0); V(i1, cIn, 1, v1); V(i0, cIn, 1, v0);
        }
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
            var trim = CivSecondary(s, owner);
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
                // Civ VI style: a thin line in the secondary on the very edge, the primary band inside it, fading inward.
                var solid = new Color(color, 0.95f);
                var line = new Color(enemy ? war : trim, 0.95f);
                Draped(mesh, a + inward * 0.005f, b + inward * 0.005f, 0.025f, 0f, inward, line, line, 0.041f);
                Draped(mesh, a + inward * 0.03f, b + inward * 0.03f, 0.05f, 0f, inward, solid, solid, 0.04f);
                Draped(mesh, a + inward * 0.08f, b + inward * 0.08f, 0.16f, 0f, inward, new Color(color, 0f), new Color(color, 0.35f), 0.04f);
                quads += 3;
                if (enemy) { Draped(mesh, a + inward * 0.2f, b + inward * 0.2f, 0.035f, 0f, inward, solid, solid, 0.04f); quads++; }
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
                items.Add((new Transform3D(rotate, HexLayout.ToWorld(s.Map.CoordOf(t), SurfaceY(s.Map, t) + 0.04f)), new Color(0.3f, 0.9f, 0.4f, 0.18f + 0.3f * k), default));
            }
            foreach (var u in s.Units)
                if (u.Owner == viewer && supply[u.Tile] < 0 && SupplySystem.IsMilitary(s.Db, u))
                    items.Add((new Transform3D(rotate, HexLayout.ToWorld(s.Map.CoordOf(u.Tile), SurfaceY(s.Map, u.Tile) + 0.05f)), new Color(0.95f, 0.2f, 0.2f, 0.6f), default));
        }
        Fill(_supply, items);
    }

    public static float SurfaceY(MapGrid map, int tile)
    {
        var c = HexLayout.ToWorld(map.CoordOf(tile));
        return HeightField.Current.Surface(c.X, c.Z);
    }

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
