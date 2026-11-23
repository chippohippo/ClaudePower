namespace UnbrokenAges.Tests;

public class ProductionQueueTests
{
    private static (GameState S, CityState City) Setup()
    {
        var s = TestWorld.Blank();
        return (s, TestWorld.City(s, 0, 10, 10, population: 3));
    }

    private static void Enqueue(GameState s, CityState c, ProductionKind kind, string id, int tile = -1, bool repeat = false)
    {
        int def = kind switch
        {
            ProductionKind.Unit => s.Db.Units.IndexOf(id),
            ProductionKind.Building => s.Db.Buildings.IndexOf(id),
            ProductionKind.District => s.Db.Districts.IndexOf(id),
            _ => s.Db.Projects.IndexOf(id),
        };
        var r = CommandProcessor.Execute(s, new EnqueueCommand { Player = c.Owner, CityId = c.Id, Kind = kind, DefIndex = def, Tile = tile, Repeat = repeat }, new());
        Assert.True(r.Ok, r.Error);
    }

    [Fact]
    public void Completes_WithOverflow_OneItemPerTurn()
    {
        var (s, c) = Setup();
        Enqueue(s, c, ProductionKind.Unit, "UNIT_WARRIOR");      // 40
        Enqueue(s, c, ProductionKind.Building, "BUILDING_MONUMENT"); // 60
        var fx = CityEffects.Compute(s, c);
        var events = new List<GameEvent>();

        ProductionSystem.Process(s, c, 30, fx, events);
        Assert.Empty(events);
        ProductionSystem.Process(s, c, 30, fx, events);
        Assert.Single(events, e => e.Type == GameEventType.ProductionCompleted);
        Assert.Equal(Fx.FromInt(20), c.OverflowProduction);
        Assert.Single(s.Units, u => u.DefIndex == s.Db.Units.IndexOf("UNIT_WARRIOR"));

        ProductionSystem.Process(s, c, 40, fx, events); // 20 overflow + 40 = 60 → monument
        Assert.True(c.HasBuilding(s.Db.Buildings.IndexOf("BUILDING_MONUMENT")));
        Assert.Empty(c.Queue.Items);
    }

    [Fact]
    public void Reordering_KeepsPartialProgress()
    {
        var (s, c) = Setup();
        Enqueue(s, c, ProductionKind.Unit, "UNIT_WARRIOR");
        Enqueue(s, c, ProductionKind.Building, "BUILDING_MONUMENT");
        var fx = CityEffects.Compute(s, c);
        ProductionSystem.Process(s, c, 25, fx, new());
        Assert.True(CommandProcessor.Execute(s, new MoveQueueItemCommand { Player = 0, CityId = c.Id, From = 1, To = 0 }, new()).Ok);
        ProductionSystem.Process(s, c, 10, fx, new());
        Assert.True(CommandProcessor.Execute(s, new MoveQueueItemCommand { Player = 0, CityId = c.Id, From = 1, To = 0 }, new()).Ok);
        var events = new List<GameEvent>();
        ProductionSystem.Process(s, c, 15, fx, events); // 25 kept + 15 = 40 → warrior done
        Assert.Contains(events, e => e.Type == GameEventType.ProductionCompleted && e.Detail == "Warrior");
    }

    [Fact]
    public void InvalidatedItems_AreSkippedWithANotification()
    {
        var (s, c) = Setup();
        int t = s.Map.Neighbor(c.Tile, HexCoord.E);
        Enqueue(s, c, ProductionKind.District, "DISTRICT_ACADEMY", t);
        Enqueue(s, c, ProductionKind.Unit, "UNIT_WARRIOR");
        s.Map.Relief[t] = (byte)s.Db.Ids.Mountain; // e.g. terrain changed under the plan
        var events = new List<GameEvent>();
        ProductionSystem.Process(s, c, 40, CityEffects.Compute(s, c), events);
        Assert.Contains(events, e => e.Type == GameEventType.QueueItemInvalidated);
        Assert.Contains(events, e => e.Type == GameEventType.ProductionCompleted && e.Detail == "Warrior");
        Assert.Equal(-1, s.Map.Reservation[t]);
    }

    [Fact]
    public void DistrictCompletion_PlacesTheDistrict()
    {
        var (s, c) = Setup();
        int t = s.Map.Neighbor(c.Tile, HexCoord.E);
        Enqueue(s, c, ProductionKind.District, "DISTRICT_ACADEMY", t);
        var cost = ProductionSystem.Cost(s, s.Players[0], ProductionKind.District, TestWorld.D(s, "DISTRICT_ACADEMY"));
        ProductionSystem.Process(s, c, cost.CeilToInt(), CityEffects.Compute(s, c), new());
        Assert.Equal(TestWorld.D(s, "DISTRICT_ACADEMY"), s.Map.District[t]);
        Assert.NotNull(c.FindDistrict(TestWorld.D(s, "DISTRICT_ACADEMY")));
    }

    [Fact]
    public void RepeatItems_RequeueThemselves()
    {
        var (s, c) = Setup();
        Enqueue(s, c, ProductionKind.Unit, "UNIT_BUILDER", repeat: true);
        ProductionSystem.Process(s, c, 50, CityEffects.Compute(s, c), new());
        Assert.Single(c.Queue.Items);
        Assert.True(c.Queue.Items[0].Repeat);
    }

    [Fact]
    public void Estimates_AccountForCarryover()
    {
        var (s, c) = Setup();
        Enqueue(s, c, ProductionKind.Unit, "UNIT_WARRIOR");          // 40 → 4 turns at 10/turn
        Enqueue(s, c, ProductionKind.Building, "BUILDING_MONUMENT"); // 60 → 6 more turns
        var est = ProductionSystem.Estimate(s, c, 10);
        Assert.Equal(4, est[0].TurnsToComplete);
        Assert.Equal(6, est[1].TurnsToComplete);
        Assert.Equal(s.Turn + 10, est[1].CompletesOnTurn);
    }

    [Fact]
    public void QueueLength_IsCapped()
    {
        var (s, c) = Setup();
        for (int i = 0; i < s.Options.MaxQueueLength; i++) Enqueue(s, c, ProductionKind.Unit, "UNIT_WARRIOR");
        var r = CommandProcessor.Execute(s, new EnqueueCommand { Player = 0, CityId = c.Id, Kind = ProductionKind.Unit, DefIndex = s.Db.Units.IndexOf("UNIT_WARRIOR") }, new());
        Assert.False(r.Ok);
    }

    [Fact]
    public void Purchase_SpendsGold_AndCompletesImmediately()
    {
        var (s, c) = Setup();
        s.Players[0].Gold = 1000;
        int monument = s.Db.Buildings.IndexOf("BUILDING_MONUMENT");
        var cost = ProductionSystem.PurchaseCost(s, c, ProductionKind.Building, monument);
        Assert.True(CommandProcessor.Execute(s, new PurchaseCommand { Player = 0, CityId = c.Id, Kind = ProductionKind.Building, DefIndex = monument }, new()).Ok);
        Assert.True(c.HasBuilding(monument));
        Assert.Equal(1000 - cost, s.Players[0].Gold);
        Assert.False(CommandProcessor.Execute(s, new PurchaseCommand { Player = 1, CityId = c.Id, Kind = ProductionKind.Building, DefIndex = monument }, new()).Ok);
    }
}
