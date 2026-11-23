using UnbrokenAges.Sim.Systems.Districts;

namespace UnbrokenAges.Tests;

/// <summary>Shared fixtures: the real base-game content and hand-built blank maps.</summary>
public static class TestWorld
{
    private static readonly Lazy<GameDatabase> _db = new(() => ModLoader.LoadFromDirectories(new[] { BaseModPath }));

    public static GameDatabase Db => _db.Value;

    public static string RepoRoot
    {
        get
        {
            var dir = new DirectoryInfo(AppContext.BaseDirectory);
            while (dir != null && !File.Exists(Path.Combine(dir.FullName, "content", "base", "mod.json"))) dir = dir.Parent;
            return dir?.FullName ?? throw new InvalidOperationException("Could not locate repository root.");
        }
    }

    public static string BaseModPath => Path.Combine(RepoRoot, "content", "base");

    public static IEnumerable<(string ModId, string Json)> BaseDocuments() =>
        Directory.GetFiles(Path.Combine(BaseModPath, "data"), "*.json").OrderBy(f => f, StringComparer.Ordinal)
            .Select(f => ("base", File.ReadAllText(f)));

    /// <summary>All-grassland, flat, non-wrapping map with N players who know every tech and civic.</summary>
    public static GameState Blank(int width = 24, int height = 20, int players = 2, string?[]? leaders = null, bool allTech = true)
    {
        var db = Db;
        var map = new MapGrid(db, width, height, wrapX: false);
        Array.Fill(map.Terrain, (byte)db.Ids.Grassland);
        Array.Fill(map.Relief, (byte)db.Ids.Flat);
        var s = new GameState(db, new GameOptions { DisasterIntensity = 0 }, map, 42);
        for (int i = 0; i < players; i++)
        {
            int leader = db.Leaders.IndexOf(leaders != null && i < leaders.Length ? leaders[i] : null);
            s.Players.Add(new PlayerState
            {
                Id = i, Name = $"P{i}", IsHuman = true, Team = i, LeaderIndex = leader,
                CivIndex = leader >= 0 ? db.Leaders[leader].CivilizationIndex : -1,
                // "All tech" means every SHARED node: Divergence branches are mutually exclusive by rule.
                Techs = db.Techs.Select(t => allTech && t.DivergenceIndex < 0).ToArray(),
                Civics = db.Civics.Select(c => allTech && c.DivergenceIndex < 0).ToArray(),
                Stockpile = new int[db.Resources.Count],
            });
        }
        s.Players.Add(new PlayerState
        {
            Id = players, Name = "Free Cities", IsFreeCities = true, Techs = new bool[db.Techs.Count],
            Civics = new bool[db.Civics.Count], Stockpile = new int[db.Resources.Count],
        });
        return s;
    }

    public static int Tile(GameState s, int col, int row) => s.Map.IndexOf(HexCoord.FromOffset(col, row));

    public static CityState City(GameState s, int player, int col, int row, int population = 1)
    {
        var c = CitySystem.Found(s, player, Tile(s, col, row));
        c.Population = population;
        return c;
    }

    public static void PlaceDistrict(GameState s, CityState city, string districtId, int tile, params string[] buildings)
    {
        int d = s.Db.Districts.IndexOf(districtId);
        CitySystem.AddDistrict(s, city, d, tile);
        var inst = city.Districts.Last();
        foreach (var b in buildings) inst.Buildings.Add(s.Db.Buildings.IndexOf(b));
    }

    public static void AddBuilding(GameState s, CityState city, string buildingId)
    {
        var b = s.Db.Buildings[buildingId];
        var district = city.Districts.First(d => AdjacencyCalculator.DistrictMatches(s.Db, d.DefIndex, b.DistrictIndex));
        district.Buildings.Add(b.Index);
    }

    public static int D(GameState s, string id) => s.Db.Districts.IndexOf(id);

    public static UnitState Unit(GameState s, int player, string unitId, int col, int row)
    {
        var def = s.Db.Units[unitId];
        var u = new UnitState { Id = s.AllocateId(), Owner = player, DefIndex = def.Index, Tile = Tile(s, col, row), MovesLeft = def.Moves };
        s.AddUnit(u);
        return u;
    }
}
