using Godot;
using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.Map;
using UnbrokenAges.Sim.State;
using UnbrokenAges.Sim.Systems;

namespace UnbrokenAges.Client.Map;

/// <summary>
/// Readable-first terrain renderer. One MultiMesh per shape (flat hex, hill, mountain, district
/// marker) with per-instance colours keeps a Huge map at a handful of draw calls. Production
/// art swaps these for chunked terrain meshes + decals (docs/02-technical-architecture.md),
/// but the data flow — rebuild only on state version change — stays the same.
/// </summary>
public partial class HexMapView : Node3D
{
    private MultiMeshInstance3D _flat = null!, _hills = null!, _mountains = null!, _districts = null!, _cities = null!, _military = null!, _civilians = null!;
    private MeshInstance3D _rivers = null!, _borders = null!, _selection = null!;
    private readonly Dictionary<string, Color> _palette = new()
    {
        ["TERRAIN_GRASSLAND"] = new Color("#6fae4f"), ["TERRAIN_PLAINS"] = new Color("#b9b25a"),
        ["TERRAIN_DESERT"] = new Color("#e2cf8f"), ["TERRAIN_TUNDRA"] = new Color("#9aa58d"),
        ["TERRAIN_SNOW"] = new Color("#eef3f6"), ["TERRAIN_COAST"] = new Color("#3f8fc4"),
        ["TERRAIN_OCEAN"] = new Color("#1d4f7c"), ["TERRAIN_LAKE"] = new Color("#4aa6d6"),
        ["TERRAIN_CHANNEL"] = new Color("#58b7e8"),
        // The Divergence remakes the planet: each future reads differently from orbit.
        ["TERRAIN_ENGINEERED"] = new Color("#cfd6de"),   // Sovereign: pale, graded, sealed
        ["TERRAIN_SUBSTRATE"] = new Color("#1b1d2a"),    // Discarnate: black glass, violet circuitry
    };

    public override void _Ready()
    {
        var vertexColor = new StandardMaterial3D { VertexColorUseAsAlbedo = true, Roughness = 0.9f };
        _flat = Make(new CylinderMesh { TopRadius = 0.97f, BottomRadius = 0.97f, Height = 0.2f, RadialSegments = 6, Rings = 1 }, vertexColor);
        _hills = Make(new CylinderMesh { TopRadius = 0.55f, BottomRadius = 0.97f, Height = 0.55f, RadialSegments = 6, Rings = 1 }, vertexColor);
        _mountains = Make(new CylinderMesh { TopRadius = 0.02f, BottomRadius = 0.9f, Height = 1.6f, RadialSegments = 6, Rings = 1 }, vertexColor);
        _districts = Make(new BoxMesh { Size = new Vector3(0.7f, 0.45f, 0.7f) }, vertexColor);
        _cities = Make(new CylinderMesh { TopRadius = 0.5f, BottomRadius = 0.6f, Height = 0.9f, RadialSegments = 8 }, vertexColor);
        _military = Make(new CylinderMesh { TopRadius = 0.34f, BottomRadius = 0.38f, Height = 0.22f, RadialSegments = 12 }, vertexColor);
        _civilians = Make(new SphereMesh { Radius = 0.22f, Height = 0.44f, RadialSegments = 10, Rings = 6 }, vertexColor);
        _rivers = new MeshInstance3D();
        _borders = new MeshInstance3D();
        _selection = new MeshInstance3D
        {
            Mesh = new TorusMesh { InnerRadius = 0.72f, OuterRadius = 0.88f, Rings = 24, RingSegments = 6 },
            MaterialOverride = new StandardMaterial3D { AlbedoColor = new Color("#ffd54a"), ShadingMode = BaseMaterial3D.ShadingModeEnum.Unshaded },
            Visible = false,
        };
        AddChild(_rivers);
        AddChild(_borders);
        AddChild(_selection);
    }

    private MultiMeshInstance3D Make(Mesh mesh, Material material)
    {
        var mmi = new MultiMeshInstance3D
        {
            Multimesh = new MultiMesh { TransformFormat = MultiMesh.TransformFormatEnum.Transform3D, UseColors = true, Mesh = mesh },
            MaterialOverride = material,
        };
        AddChild(mmi);
        return mmi;
    }

    private Color CivColor(GameState s, int player)
    {
        int civ = player >= 0 ? s.Players[player].CivIndex : -1;
        return civ >= 0 ? new Color(s.Db.Civilizations[civ].Colors.Primary) : new Color("#cccccc");
    }

    /// <summary>
    /// Draws the map as <paramref name="viewer"/> knows it: unexplored tiles are not drawn, explored-but-unseen tiles are dimmed
    /// and show no foreign units, and the selected tile gets a ring.
    /// </summary>
    public void Render(GameState s, int viewer, int selectedTile = -1)
    {
        var map = s.Map;
        var db = s.Db;
        var flat = new List<(Transform3D, Color)>();
        var hills = new List<(Transform3D, Color)>();
        var mountains = new List<(Transform3D, Color)>();
        var districts = new List<(Transform3D, Color)>();
        var cities = new List<(Transform3D, Color)>();
        var military = new List<(Transform3D, Color)>();
        var civilians = new List<(Transform3D, Color)>();
        var rotate = new Basis(Vector3.Up, Mathf.Pi / 6f); // cylinder hexagon → pointy-top
        var visible = VisibilitySystem.Visible(s, viewer);
        var revealed = s.Players[viewer].Revealed;
        bool Known(int t) => t < revealed.Length && revealed[t];

        for (int t = 0; t < map.Count; t++)
        {
            if (!Known(t)) continue;
            var hex = map.CoordOf(t);
            var color = TileColor(s, t);
            if (!visible[t]) color = color.Darkened(0.45f);
            bool water = map.IsWater(t);
            var pos = HexLayout.ToWorld(hex, water ? -0.12f : 0f);
            flat.Add((new Transform3D(rotate, pos), color));
            if (map.IsMountain(t)) mountains.Add((new Transform3D(rotate, pos + Vector3.Up * 0.8f), visible[t] ? new Color("#8a8178") : new Color("#4a4540")));
            else if (map.Relief[t] == db.Ids.Hills) hills.Add((new Transform3D(rotate, pos + Vector3.Up * 0.3f), color.Darkened(0.1f)));
            if (map.District[t] >= 0 && map.District[t] != db.Ids.CityCenter)
                districts.Add((new Transform3D(Basis.Identity, pos + Vector3.Up * 0.35f), DistrictColor(db.Districts[map.District[t]])));
        }
        foreach (var c in s.Cities)
            if (Known(c.Tile)) cities.Add((new Transform3D(Basis.Identity, HexLayout.ToWorld(map.CoordOf(c.Tile), 0.5f)), CivColor(s, c.Owner)));
        // Outposts: a slim post in the owner's colour (no city screen to open).
        foreach (var o in s.Outposts)
        {
            if (!Known(o.Tile)) continue;
            var post = new Transform3D(Basis.Identity.Scaled(new Vector3(0.5f, 1.6f, 0.5f)), HexLayout.ToWorld(map.CoordOf(o.Tile), 0.45f));
            districts.Add((post, CivColor(s, o.Owner).Lightened(0.25f)));
        }
        // Units: discs for military, beads for civilians, in the owner's colour; stacked units fan out around the tile.
        var perTile = new Dictionary<int, int>();
        foreach (var u in s.Units)
        {
            if (u.Tile < 0 || !visible[u.Tile]) continue;
            int k = perTile.GetValueOrDefault(u.Tile);
            perTile[u.Tile] = k + 1;
            bool inCity = s.Cities.Any(c => c.Tile == u.Tile);
            var offset = k == 0 && !inCity ? Vector3.Zero : new Vector3(Mathf.Cos(k * 2.1f + 0.6f), 0, Mathf.Sin(k * 2.1f + 0.6f)) * 0.55f;
            var pos = HexLayout.ToWorld(map.CoordOf(u.Tile), map.IsWater(u.Tile) ? 0.12f : 0.3f) + offset;
            var color = CivColor(s, u.Owner);
            if (u.Owner == viewer) color = color.Lightened(0.15f);
            if (SupplySystem.IsMilitary(db, u)) military.Add((new Transform3D(Basis.Identity, pos), color));
            else civilians.Add((new Transform3D(Basis.Identity, pos + Vector3.Up * 0.1f), color));
        }

        Fill(_flat, flat);
        Fill(_hills, hills);
        Fill(_mountains, mountains);
        Fill(_districts, districts);
        Fill(_cities, cities);
        Fill(_military, military);
        Fill(_civilians, civilians);
        DrawRivers(map, revealed);
        DrawBorders(s, viewer);
        Select(selectedTile, map);
    }

    private static void Fill(MultiMeshInstance3D mmi, List<(Transform3D T, Color C)> items)
    {
        var mm = mmi.Multimesh;
        mm.InstanceCount = items.Count;
        for (int i = 0; i < items.Count; i++)
        {
            mm.SetInstanceTransform(i, items[i].T);
            mm.SetInstanceColor(i, items[i].C);
        }
    }

    private Color TileColor(GameState s, int t)
    {
        var map = s.Map;
        var db = s.Db;
        var c = _palette.GetValueOrDefault(db.Terrains[map.Terrain[t]].Id, new Color("#ff00ff"));
        if (map.Feature[t] >= 0)
        {
            var f = db.Features[map.Feature[t]].Id;
            if (f is "FEATURE_FOREST") c = c.Lerp(new Color("#2f6b34"), 0.6f);
            else if (f is "FEATURE_RAINFOREST") c = c.Lerp(new Color("#1f5a2a"), 0.7f);
            else if (f is "FEATURE_MARSH") c = c.Lerp(new Color("#5b7a62"), 0.5f);
            else if (f is "FEATURE_FLOODPLAINS") c = c.Lerp(new Color("#a7c76b"), 0.4f);
            else if (f is "FEATURE_ICE") c = new Color("#dff4ff");
            else if (f is "FEATURE_BLOOM") c = new Color("#b04fc4").Lerp(new Color("#3fd6a0"), (t * 37 % 11) / 11f); // bioluminescent mottling
        }
        // Owned land drifts toward its civilization's Divergence palette (subtle at first, total by the end).
        int owner = map.OwnerPlayer[t];
        if (owner >= 0 && s.Players[owner].Divergence >= 0 && map.IsLand(t))
        {
            var d = db.Divergences[s.Players[owner].Divergence];
            int age = Math.Clamp(s.Turn - s.Players[owner].DivergenceTurn, 0, 100);
            c = c.Lerp(new Color(d.Colors.Secondary), 0.25f * age / 100f);
        }
        if (map.HasFlag(t, TileFlags.Flooded)) c = c.Lerp(new Color("#3f8fc4"), 0.35f);
        if (map.HasFlag(t, TileFlags.Pillaged)) c = c.Darkened(0.25f);
        return c;
    }

    private static Color DistrictColor(DistrictDef d) => d.PrimaryYield switch
    {
        YieldType.Science => new Color("#4fa3ff"),
        YieldType.Faith => new Color("#f4f1de"),
        YieldType.Gold => new Color("#f2c14e"),
        YieldType.Culture => new Color("#c77dff"),
        YieldType.Production => new Color("#e07a3f"),
        _ => d.Category == DistrictCategory.Infrastructure ? new Color("#9aa7b1") : new Color("#d1495b"),
    };

    /// <summary>Edge rivers are drawn exactly on hex edges, matching the adjacency rules players read.</summary>
    private void DrawRivers(MapGrid map, bool[] revealed)
    {
        var mesh = new ImmediateMesh();
        var mat = new StandardMaterial3D { AlbedoColor = new Color("#7fd3ff"), ShadingMode = BaseMaterial3D.ShadingModeEnum.Unshaded };
        mesh.SurfaceBegin(Mesh.PrimitiveType.Lines, mat);
        int segments = 0;
        for (int t = 0; t < map.Count; t++)
        {
            for (int d = 0; d < 3; d++) // each edge once: E, NE, NW
            {
                if (!map.HasRiverEdge(t, d) || t >= revealed.Length || !revealed[t]) continue;
                var (a, b) = HexLayout.Edge(map.CoordOf(t), d, 0.12f);
                mesh.SurfaceAddVertex(a);
                mesh.SurfaceAddVertex(b);
                segments++;
            }
        }
        if (segments == 0) { mesh.SurfaceAddVertex(Vector3.Zero); mesh.SurfaceAddVertex(Vector3.Zero); }
        mesh.SurfaceEnd();
        _rivers.Mesh = mesh;
    }

    /// <summary>
    /// Borders in the owner's colour; your own are drawn brighter. Civilizations at war with you get a red double line, so a
    /// front is readable at a glance (colourblind-safe: the doubling carries the meaning, not only the hue).
    /// </summary>
    private void DrawBorders(GameState s, int viewer)
    {
        var map = s.Map;
        var mesh = new ImmediateMesh();
        var mat = new StandardMaterial3D { VertexColorUseAsAlbedo = true, ShadingMode = BaseMaterial3D.ShadingModeEnum.Unshaded };
        mesh.SurfaceBegin(Mesh.PrimitiveType.Lines, mat);
        int segments = 0;
        var war = new Color("#ff3b30");
        for (int t = 0; t < map.Count; t++)
        {
            int owner = map.OwnerPlayer[t];
            if (owner < 0 || viewer < 0 || t >= s.Players[viewer].Revealed.Length || !s.Players[viewer].Revealed[t]) continue;
            int civ = s.Players[owner].CivIndex;
            var color = civ >= 0 ? new Color(s.Db.Civilizations[civ].Colors.Primary) : Colors.White;
            bool enemy = owner != viewer && DiplomacySystem.AtWar(s, viewer, owner) && !s.Players[owner].IsFreeCities;
            if (owner == viewer) color = color.Lightened(0.3f);
            if (enemy) color = war;
            var center = HexLayout.ToWorld(map.CoordOf(t), 0.14f);
            for (int d = 0; d < 6; d++)
            {
                int n = map.Neighbor(t, d);
                if (n >= 0 && map.OwnerPlayer[n] == owner) continue;
                var (a, b) = HexLayout.Edge(map.CoordOf(t), d, 0.14f);
                foreach (float inset in enemy ? new[] { 0.08f, 0.18f } : new[] { 0.08f })
                {
                    mesh.SurfaceSetColor(color);
                    mesh.SurfaceAddVertex(a.Lerp(center, inset));
                    mesh.SurfaceSetColor(color);
                    mesh.SurfaceAddVertex(b.Lerp(center, inset));
                    segments++;
                }
            }
        }
        if (segments == 0) { mesh.SurfaceAddVertex(Vector3.Zero); mesh.SurfaceAddVertex(Vector3.Zero); }
        mesh.SurfaceEnd();
        _borders.Mesh = mesh;
    }

    private MultiMeshInstance3D? _supply;

    /// <summary>Supply lens: green where your armies are supplied (brighter = deeper), red where your units are cut off.</summary>
    public void RenderSupply(GameState s, int viewer, bool visible)
    {
        _supply ??= Make(new CylinderMesh { TopRadius = 0.9f, BottomRadius = 0.9f, Height = 0.02f, RadialSegments = 6, Rings = 1 },
            new StandardMaterial3D { VertexColorUseAsAlbedo = true, Transparency = BaseMaterial3D.TransparencyEnum.Alpha, ShadingMode = BaseMaterial3D.ShadingModeEnum.Unshaded });
        var items = new List<(Transform3D, Color)>();
        if (visible)
        {
            var supply = SupplySystem.Compute(s, viewer);
            var rotate = new Basis(Vector3.Up, Mathf.Pi / 6f);
            for (int t = 0; t < s.Map.Count; t++)
            {
                if (supply[t] < 0) continue;
                float k = Mathf.Clamp(supply[t] / 12f, 0.15f, 1f);
                items.Add((new Transform3D(rotate, HexLayout.ToWorld(s.Map.CoordOf(t), 0.18f)), new Color(0.3f, 0.9f, 0.4f, 0.18f + 0.3f * k)));
            }
            foreach (var u in s.Units)
                if (u.Owner == viewer && supply[u.Tile] < 0 && SupplySystem.IsMilitary(s.Db, u))
                    items.Add((new Transform3D(rotate, HexLayout.ToWorld(s.Map.CoordOf(u.Tile), 0.2f)), new Color(0.95f, 0.2f, 0.2f, 0.6f)));
        }
        Fill(_supply, items);
    }

    public void Select(int tile, MapGrid map)
    {
        _selection.Visible = tile >= 0;
        if (tile >= 0) _selection.Position = HexLayout.ToWorld(map.CoordOf(tile), map.IsWater(tile) ? 0.02f : 0.14f);
    }
}
