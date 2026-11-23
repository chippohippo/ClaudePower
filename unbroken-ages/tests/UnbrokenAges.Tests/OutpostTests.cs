namespace UnbrokenAges.Tests;

public class OutpostTests
{
    private static UnitState Waymakers(GameState s, int player, int tile)
    {
        var u = new UnitState { Id = s.AllocateId(), Owner = player, DefIndex = s.Db.Units.IndexOf("UNIT_WAYMAKERS"), Tile = tile, MovesLeft = 3 };
        s.AddUnit(u);
        return u;
    }

    [Fact]
    public void Waymakers_PlantAnOutpost_ThatClaimsUnclaimedLand()
    {
        var s = TestWorld.Blank(width: 30);
        TestWorld.City(s, 0, 5, 10);
        int tile = TestWorld.Tile(s, 12, 10);
        int iron = s.Map.Neighbor(tile, HexCoord.E);
        s.Map.Resource[iron] = (short)s.Db.Resources.IndexOf("RESOURCE_IRON");
        var u = Waymakers(s, 0, tile);

        var events = new List<GameEvent>();
        Assert.True(CommandProcessor.Execute(s, new FoundOutpostCommand { Player = 0, UnitId = u.Id }, events).Ok);
        var o = Assert.Single(s.Outposts);
        Assert.Equal(7, o.Tiles.Count);
        Assert.All(o.Tiles, t => Assert.Equal((0, -1), (s.Map.OwnerPlayer[t], s.Map.OwnerCity[t])));
        Assert.Equal(iron, o.HarvestTile);
        Assert.Equal("Iron Outpost", o.Name);
        Assert.Null(s.GetUnit(u.Id));
        Assert.Contains(s.Chronicle, c => c.Kind == GameEventType.OutpostFounded);
    }

    [Fact]
    public void Outposts_NeedUnclaimedLand_AndRoom()
    {
        var s = TestWorld.Blank(width: 30);
        var city = TestWorld.City(s, 0, 5, 10);
        Assert.Equal("Outposts claim unclaimed land only.", OutpostSystem.ValidateFound(s, 0, Waymakers(s, 0, s.Map.Neighbor(city.Tile, HexCoord.E))));
        Assert.StartsWith("Must be at least 3 tiles", OutpostSystem.ValidateFound(s, 0, Waymakers(s, 0, TestWorld.Tile(s, 7, 10))));
        Assert.Null(OutpostSystem.ValidateFound(s, 0, Waymakers(s, 0, TestWorld.Tile(s, 9, 10))));
        Assert.Equal("This unit cannot plant outposts.", new FoundOutpostCommand { Player = 0, UnitId = TestWorld.Unit(s, 0, "UNIT_WARRIOR", 20, 10).Id }.Validate(s));
    }

    [Fact]
    public void Outposts_Harvest_StrategicIntoTheStockpile_AndOthersIntoGold()
    {
        var s = TestWorld.Blank(width: 30);
        int iron = s.Db.Resources.IndexOf("RESOURCE_IRON");
        int wine = s.Db.Resources.IndexOf("RESOURCE_WINE");
        int a = TestWorld.Tile(s, 5, 5), b = TestWorld.Tile(s, 15, 15);
        s.Map.Resource[a] = (short)iron;
        s.Map.Resource[b] = (short)wine;
        var oa = OutpostSystem.Found(s, 0, a, new());
        var ob = OutpostSystem.Found(s, 0, b, new());
        Assert.Equal((1, iron, 2), OutpostSystem.Harvest(s, oa));
        Assert.Equal((4, -1, 0), OutpostSystem.Harvest(s, ob));       // 1 + 3 for a luxury

        Fx gold = s.Players[0].Gold;
        OutpostSystem.ProcessTurn(s, new());
        Assert.Equal(gold + 5, s.Players[0].Gold);
        Assert.Equal(2, s.Players[0].Stockpile[iron]);
    }

    [Fact]
    public void Outposts_ExtendSupply()
    {
        var s = TestWorld.Blank(width: 40);
        TestWorld.City(s, 0, 3, 10);
        int far = TestWorld.Tile(s, 20, 10);
        Assert.False(SupplySystem.Compute(s, 0)[far] >= 0);
        OutpostSystem.Found(s, 0, TestWorld.Tile(s, 18, 10), new());
        Assert.True(SupplySystem.Compute(s, 0)[far] >= 0);
    }

    [Fact]
    public void AnEnemyArmyOnTheOutpost_BurnsIt_AndReleasesTheLand()
    {
        var s = TestWorld.Blank(width: 30);
        var o = OutpostSystem.Found(s, 0, TestWorld.Tile(s, 12, 10), new());
        TestWorld.Unit(s, 1, "UNIT_WARRIOR", 12, 10);
        var events = new List<GameEvent>();
        OutpostSystem.ProcessTurn(s, events);
        Assert.Single(s.Outposts);                                          // at peace: a visitor, not a raider

        CommandProcessor.Execute(s, new DeclareWarCommand { Player = 1, Target = 0 }, new());
        OutpostSystem.ProcessTurn(s, events);
        Assert.Empty(s.Outposts);
        Assert.All(o.Tiles, t => Assert.Equal(-1, s.Map.OwnerPlayer[t]));
        Assert.Contains(events, e => e.Type == GameEventType.OutpostRazed && e.Value == 1);
    }

    [Fact]
    public void AnOutpost_CanBeBoughtUpIntoACity_KeepingItsLand()
    {
        var s = TestWorld.Blank(width: 30);
        TestWorld.City(s, 0, 3, 10);
        var o = OutpostSystem.Found(s, 0, TestWorld.Tile(s, 12, 10), new());
        var cmd = new PromoteOutpostCommand { Player = 0, OutpostId = o.Id };
        Assert.Equal("Costs 175 gold.", cmd.Validate(s));                // 150 + 25 × 1 city
        s.Players[0].Gold = 200;
        var events = new List<GameEvent>();
        Assert.True(CommandProcessor.Execute(s, cmd, events).Ok);
        Assert.Empty(s.Outposts);
        var city = s.Cities.Single(c => c.Tile == o.Tile);
        Assert.All(o.Tiles, t => Assert.Equal(city.Id, s.Map.OwnerCity[t]));
        Assert.Equal(Fx.FromInt(25), s.Players[0].Gold);
        Assert.Contains(events, e => e.Type == GameEventType.OutpostPromoted);
        Assert.Equal("Not your outpost.", new PromoteOutpostCommand { Player = 1, OutpostId = o.Id }.Validate(s));
    }

    [Fact]
    public void OutpostsTooCloseToACity_CannotBecomeOne()
    {
        var s = TestWorld.Blank(width: 30);
        var o = OutpostSystem.Found(s, 0, TestWorld.Tile(s, 12, 10), new());
        TestWorld.City(s, 1, 15, 10);
        s.Players[0].Gold = 1000;
        Assert.Equal("Too close to another city to grow into one.", OutpostSystem.ValidatePromote(s, o));
    }

    [Fact]
    public void Outposts_SurviveSnapshots()
    {
        var s = TestWorld.Blank(width: 30);
        int t = TestWorld.Tile(s, 12, 10);
        s.Map.Resource[s.Map.Neighbor(t, HexCoord.W)] = (short)s.Db.Resources.IndexOf("RESOURCE_WINE");
        var o = OutpostSystem.Found(s, 0, t, new());
        var back = GameStateSerializer.Deserialize(GameStateSerializer.Serialize(s), s.Db);
        var b = Assert.Single(back.Outposts);
        Assert.Equal((o.Id, o.Owner, o.Tile, o.Name, o.HarvestTile), (b.Id, b.Owner, b.Tile, b.Name, b.HarvestTile));
        Assert.Equal(o.Tiles, b.Tiles);
        Assert.Equal(GameStateSerializer.Hash(s), GameStateSerializer.Hash(back));
    }
}
