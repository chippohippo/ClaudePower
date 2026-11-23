using UnbrokenAges.Sim.AI;

namespace UnbrokenAges.Tests;

public class MapGenerationTests
{
    private static GeneratedMap Gen(ulong seed = 7, int w = 64, int h = 40) =>
        MapGenerator.Generate(TestWorld.Db, new MapGenSettings { Seed = seed, Width = w, Height = h, Players = 4 });

    [Fact]
    public void IsDeterministic()
    {
        var a = Gen(11);
        var b = Gen(11);
        var c = Gen(12);
        Assert.Equal(a.Map.Terrain, b.Map.Terrain);
        Assert.Equal(a.Map.RiverEdges, b.Map.RiverEdges);
        Assert.Equal(a.StartTiles, b.StartTiles);
        Assert.NotEqual(a.Map.Terrain, c.Map.Terrain);
    }

    [Theory]
    [InlineData(1UL)]
    [InlineData(7UL)]
    [InlineData(2024UL)]
    public void GreatRivers_AreContiguous_AndReachOpenWater(ulong seed)
    {
        var g = Gen(seed);
        Assert.NotEmpty(g.GreatRivers);
        foreach (var river in g.GreatRivers)
        {
            Assert.True(river.Count >= 5);
            for (int i = 1; i < river.Count; i++) Assert.Equal(1, g.Map.Distance(river[i - 1], river[i]));
            Assert.All(river, t => Assert.True(g.Map.IsChannel(t)));
            int mouth = river[0];
            bool reachesWater = Enumerable.Range(0, 6).Select(d => g.Map.Neighbor(mouth, d))
                .Any(n => n >= 0 && g.Map.IsWater(n) && !g.Map.IsChannel(n));
            Assert.True(reachesWater);
        }
    }

    [Fact]
    public void GreatRivers_AreNavigableFromTheSea()
    {
        var g = Gen(7);
        var s = new GameState(TestWorld.Db, new GameOptions(), g.Map, 1);
        s.Players.Add(new PlayerState { Id = 0, Techs = new bool[s.Db.Techs.Count], Civics = new bool[s.Db.Civics.Count], Stockpile = new int[s.Db.Resources.Count] });
        int galley = s.Db.Units.IndexOf("UNIT_GALLEY");
        foreach (var river in g.GreatRivers)
        {
            int sea = Enumerable.Range(0, 6).Select(d => g.Map.Neighbor(river[0], d)).First(n => n >= 0 && g.Map.IsWater(n) && !g.Map.IsChannel(n));
            var boat = new UnitState { Id = 1, DefIndex = galley, Tile = sea, MovesLeft = 3 };
            var path = Movement.FindPath(s, boat, river[^1]);
            Assert.NotNull(path);
            Assert.All(path!, t => Assert.True(g.Map.IsWater(t)));
        }
    }

    [Fact]
    public void EdgeRivers_OnlySeparateLandTiles_AndFlowSomewhere()
    {
        var g = Gen(7);
        var map = g.Map;
        Assert.True(g.Stats.RiverEdges > 20, g.Stats.ToString());
        for (int t = 0; t < map.Count; t++)
        for (int d = 0; d < 6; d++)
        {
            if (!map.HasRiverEdge(t, d)) continue;
            int n = map.Neighbor(t, d);
            Assert.True(n >= 0 && map.IsLand(t) && map.IsLand(n));
            Assert.True(map.HasRiverEdge(n, HexCoord.Opposite(d)));
        }
    }

    [Fact]
    public void StartPositions_AreSpreadOnHabitableLand()
    {
        var g = Gen(7);
        Assert.Equal(4, g.StartTiles.Count);
        foreach (int t in g.StartTiles)
        {
            Assert.True(g.Map.IsLand(t));
            Assert.False(g.Map.IsMountain(t));
        }
        for (int i = 0; i < g.StartTiles.Count; i++)
        for (int j = i + 1; j < g.StartTiles.Count; j++)
            Assert.True(g.Map.Distance(g.StartTiles[i], g.StartTiles[j]) >= 4);
    }
}

public class DeterminismTests
{
    public static GameSetup Setup(ulong seed = 5) => new()
    {
        Seed = seed,
        Map = new MapGenSettings { Width = 44, Height = 26, Seed = seed },
        Options = new GameOptions { DisasterIntensity = 3 },
        Players = new()
        {
            new PlayerSetup { Name = "Egypt", Leader = "LEADER_THUTMOSE" },
            new PlayerSetup { Name = "Venice", Leader = "LEADER_DANDOLO" },
            new PlayerSetup { Name = "Song", Leader = "LEADER_TAIZU_SONG" },
        },
    };

    public static void PlayAiTurn(GameState s)
    {
        var ai = new SimpleAi();
        foreach (var p in s.Players.Where(p => !p.IsFreeCities).ToList())
            foreach (var cmd in ai.TakeTurn(s, p.Id))
                CommandProcessor.Execute(s, cmd, new());
        Assert.True(CommandProcessor.Execute(s, new AdvanceTurnCommand { Player = GameCommand.SystemPlayer, ExpectedTurn = s.Turn }, new()).Ok);
    }

    [Fact]
    public void IdenticalInputs_ProduceIdenticalStates()
    {
        var a = GameFactory.Create(TestWorld.Db, Setup());
        var b = GameFactory.Create(TestWorld.Db, Setup());
        for (int turn = 0; turn < 60; turn++)
        {
            PlayAiTurn(a);
            PlayAiTurn(b);
            Assert.Equal(GameStateSerializer.Hash(a), GameStateSerializer.Hash(b));
        }
        Assert.True(a.Cities.Count >= 3);
        Assert.Contains(a.Players, p => p.Techs.Any(t => t));
        // The AI plans districts with the same adjacency scorer the player's lens uses.
        Assert.Contains(a.Cities, c => c.Districts.Count > 1 || c.Queue.Items.Any(q => q.Kind == ProductionKind.District));
    }

    [Fact]
    public void Snapshot_RoundTrips_AndContinuesIdentically()
    {
        var a = GameFactory.Create(TestWorld.Db, Setup(9));
        for (int i = 0; i < 15; i++) PlayAiTurn(a);
        var bytes = GameStateSerializer.Serialize(a);
        var b = GameStateSerializer.Deserialize(bytes, TestWorld.Db);
        Assert.Equal(GameStateSerializer.Hash(a), GameStateSerializer.Hash(b));
        for (int i = 0; i < 10; i++)
        {
            PlayAiTurn(a);
            PlayAiTurn(b);
        }
        Assert.Equal(GameStateSerializer.Hash(a), GameStateSerializer.Hash(b));
    }

    [Fact]
    public void Commands_SerializeLosslessly()
    {
        var cmd = new EnqueueCommand { Player = 2, CityId = 17, Kind = ProductionKind.District, DefIndex = 4, Tile = 99, Position = 1, Repeat = true };
        var back = (EnqueueCommand)GameCommand.Deserialize(cmd.Serialize());
        Assert.Equal((2, 17, ProductionKind.District, 4, 99, 1, true), (back.Player, back.CityId, back.Kind, back.DefIndex, back.Tile, back.Position, back.Repeat));
    }

    [Fact]
    public void OnlyTheHostMayAdvanceTheTurn()
    {
        var s = GameFactory.Create(TestWorld.Db, Setup());
        Assert.False(CommandProcessor.Execute(s, new AdvanceTurnCommand { Player = 0, ExpectedTurn = s.Turn }, new()).Ok);
        Assert.False(CommandProcessor.Execute(s, new AdvanceTurnCommand { Player = GameCommand.SystemPlayer, ExpectedTurn = s.Turn + 1 }, new()).Ok);
    }
}
