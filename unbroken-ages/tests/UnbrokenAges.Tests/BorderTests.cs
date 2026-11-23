namespace UnbrokenAges.Tests;

public class BorderTests
{
    [Fact]
    public void Culture_GrowsBorders_TowardTheBestTile()
    {
        var s = TestWorld.Blank();
        var city = TestWorld.City(s, 0, 10, 10);
        int ring2 = s.Map.Neighbor(s.Map.Neighbor(city.Tile, HexCoord.E), HexCoord.E);
        s.Map.Resource[ring2] = (short)s.Db.Resources.IndexOf("RESOURCE_WINE");
        Assert.Equal(ring2, BorderSystem.BestCandidate(s, city, BorderSystem.MaxGrowthRadius));
        Assert.Equal((ring2, 4), BorderSystem.Forecast(s, city, 4));            // 15 culture at 4/turn → 4 turns
        Assert.Equal((ring2, -1), BorderSystem.Forecast(s, city, Fx.Zero));

        var events = new List<GameEvent>();
        BorderSystem.Grow(s, city, 14, events);
        Assert.Empty(events);                                   // threshold 15
        BorderSystem.Grow(s, city, 1, events);
        Assert.Equal(city.Id, s.Map.OwnerCity[ring2]);
        Assert.Equal(1, city.TilesClaimed);
        Assert.Equal(Fx.FromInt(23), BorderSystem.Threshold(city)); // 15 + 8 × 1
        Assert.Single(events, e => e.Type == GameEventType.TileClaimed);
    }

    [Fact]
    public void Borders_NeverTakeForeignLand_OrReachPastFiveTiles()
    {
        var s = TestWorld.Blank(width: 30, height: 20);
        var city = TestWorld.City(s, 0, 10, 10);
        var rival = TestWorld.City(s, 1, 14, 10);
        var events = new List<GameEvent>();
        for (int i = 0; i < 200; i++) BorderSystem.Grow(s, city, 50, events);
        for (int t = 0; t < s.Map.Count; t++)
        {
            if (s.Map.OwnerCity[t] != city.Id) continue;
            Assert.True(s.Map.Distance(city.Tile, t) <= BorderSystem.MaxGrowthRadius);
        }
        Assert.All(new[] { rival.Tile }.Concat(Enumerable.Range(0, 6).Select(d => s.Map.Neighbor(rival.Tile, d))),
            t => Assert.Equal(1, s.Map.OwnerPlayer[t]));
    }

    [Fact]
    public void Tiles_CanBeBought_NextToTheBorder()
    {
        var s = TestWorld.Blank();
        var city = TestWorld.City(s, 0, 10, 10);
        int ring2 = s.Map.Neighbor(s.Map.Neighbor(city.Tile, HexCoord.E), HexCoord.E);
        int ring3 = s.Map.Neighbor(ring2, HexCoord.E);
        Assert.Equal("Costs 40 gold.", new PurchaseTileCommand { Player = 0, CityId = city.Id, Tile = ring2 }.Validate(s));
        s.Players[0].Gold = 100;
        Assert.StartsWith("The tile must be unclaimed", new PurchaseTileCommand { Player = 0, CityId = city.Id, Tile = ring3 }.Validate(s));
        Assert.True(CommandProcessor.Execute(s, new PurchaseTileCommand { Player = 0, CityId = city.Id, Tile = ring2 }, new()).Ok);
        Assert.Equal(Fx.FromInt(60), s.Players[0].Gold);
        Assert.Equal(65, BorderSystem.PurchaseCost(s, city, ring3));   // 20 × 3 + 5 × 1 tile grown
        Assert.StartsWith("Tiles can be bought up to", new PurchaseTileCommand { Player = 0, CityId = city.Id, Tile = s.Map.Neighbor(ring3, HexCoord.E) }.Validate(s));
    }

    [Fact]
    public void BorderProgress_SurvivesSnapshots()
    {
        var s = TestWorld.Blank();
        var city = TestWorld.City(s, 0, 10, 10);
        BorderSystem.Grow(s, city, 30, new());
        var back = GameStateSerializer.Deserialize(GameStateSerializer.Serialize(s), s.Db);
        Assert.Equal(city.BorderProgress, back.GetCity(city.Id)!.BorderProgress);
        Assert.Equal(1, back.GetCity(city.Id)!.TilesClaimed);
    }
}
