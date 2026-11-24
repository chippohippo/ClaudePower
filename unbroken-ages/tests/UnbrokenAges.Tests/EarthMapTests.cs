namespace UnbrokenAges.Tests;

/// <summary>The Earth map: real geography, true start locations, city-states at their sites, and determinism.</summary>
public class EarthMapTests
{
    /// <summary>A spread of peoples across every continent (the Earth soak's first table).</summary>
    public static readonly string[] EarthTwelve =
        { "CIV_EGYPT", "CIV_SONG", "CIV_ROME", "CIV_ENGLAND", "CIV_RUSSIA", "CIV_INDIA", "CIV_JAPAN", "CIV_AZTEC", "CIV_INCA", "CIV_MALI", "CIV_ZULU", "CIV_MONGOLIA" };

    public static GameSetup Setup(IEnumerable<string> civs, ulong seed = 3)
    {
        var db = TestWorld.Db;
        return new GameSetup
        {
            Seed = seed,
            Map = new MapGenSettings { Seed = seed, MapId = "MAP_EARTH" },
            Players = civs.Select((civ, i) => new PlayerSetup { Name = civ, Leader = db.Leaders.First(l => l.CivilizationIndex == db.Civilizations.IndexOf(civ)).Id }).ToList(),
        };
    }

    [Fact]
    public void Earth_IsTheRealWorld()
    {
        var def = TestWorld.Db.Maps["MAP_EARTH"];
        Assert.Equal((128, 80), (def.Width, def.Height));
        Assert.Equal(TestWorld.Db.Civilizations.Count, def.Starts.Count);   // every people has a true start
        Assert.Equal(TestWorld.Db.CityStates.Count, def.CityStates.Count);
        Assert.True(def.GreatRivers.Count >= 12, $"{def.GreatRivers.Count} great rivers");
        Assert.Contains(def.GreatRivers, r => r.Name == "Nile");
        var g = MapGenerator.Generate(TestWorld.Db, new MapGenSettings { MapId = "MAP_EARTH", Seed = 1 });
        Assert.InRange(g.Stats.LandTiles, 2800, 3600);
        Assert.True(g.Stats.Mountains > 100 && g.Stats.RiverEdges > 100, g.Stats.ToString());
        Assert.Equal(TestWorld.Db.Features.Count(f => f.NaturalWonder), g.Stats.NaturalWonders);
    }

    [Fact]
    public void EveryPeople_StartsAtItsCapital()
    {
        var db = TestWorld.Db;
        var def = db.Maps["MAP_EARTH"];
        var s = GameFactory.Create(db, Setup(EarthTwelve));
        foreach (var p in s.Players.Where(p => p.IsMajor))
        {
            var civ = db.Civilizations[p.CivIndex].Id;
            var settler = s.Units.First(u => u.Owner == p.Id && db.Units[u.DefIndex].FoundsCity);
            int site = def.Starts[civ][0][1] * def.Width + def.Starts[civ][0][0];
            Assert.True(s.Map.Distance(settler.Tile, site) <= 2, $"{civ} starts {s.Map.Distance(settler.Tile, site)} tiles from its capital");
        }
        // City-states stand at their real sites.
        var placed = s.Players.Where(p => p.IsCityState).ToList();
        Assert.True(placed.Count >= 8, $"{placed.Count} city-states placed");
        foreach (var cs in placed)
        {
            var at = def.CityStates[db.CityStates[cs.CityStateIndex].Id];
            Assert.True(s.Map.Distance(s.CitiesOf(cs.Id).First().Tile, at[1] * def.Width + at[0]) <= 2);
        }
    }

    [Fact]
    public void AllThirtyEightPeoples_FitOnEarth_FiveTilesApart()
    {
        var db = TestWorld.Db;
        var civs = db.Civilizations.Select(c => c.Id).ToList();
        var g = MapGenerator.Generate(db, new MapGenSettings { MapId = "MAP_EARTH", Seed = 2, Players = civs.Count, StartCivs = civs.Cast<string?>().ToList() });
        Assert.Equal(civs.Count, g.StartTiles.Count);
        for (int i = 0; i < g.StartTiles.Count; i++)
            for (int j = i + 1; j < g.StartTiles.Count; j++)
                Assert.True(g.Map.Distance(g.StartTiles[i], g.StartTiles[j]) >= MapGenerator.MinStartDistance, $"{civs[i]} and {civs[j]} crowd each other");
        Assert.All(g.StartTiles, t => Assert.True(g.Map.IsLand(t) && !g.Map.IsMountain(t) && !g.Map.IsChannel(t)));
    }

    [Fact]
    public void Earth_IsDeterministic_AndSurvivesASnapshot()
    {
        var a = GameFactory.Create(TestWorld.Db, Setup(EarthTwelve, 5));
        var b = GameFactory.Create(TestWorld.Db, Setup(EarthTwelve, 5));
        Assert.Equal(GameStateSerializer.Hash(a), GameStateSerializer.Hash(b));
        var codec = GameSetupCodec.Deserialize(GameSetupCodec.Serialize(Setup(EarthTwelve, 5)));
        Assert.Equal("MAP_EARTH", codec.Map.MapId);
    }
}
