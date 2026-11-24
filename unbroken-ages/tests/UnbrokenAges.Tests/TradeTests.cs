namespace UnbrokenAges.Tests;

/// <summary>Trade routes: capacity, reach, yields of each kind, the trader's return, war and plunder, saves.</summary>
public class TradeTests
{
    private static string? Run(GameState s, GameCommand cmd, List<GameEvent>? events = null) =>
        CommandProcessor.Execute(s, cmd, events ?? new()) is { Ok: false } r ? r.Error : null;

    private static (GameState S, CityState Home, CityState Second, CityState Foreign, UnitState Trader) World()
    {
        var s = TestWorld.Blank(width: 40, height: 20, players: 2);
        var home = TestWorld.City(s, 0, 5, 10, population: 4);
        var second = TestWorld.City(s, 0, 12, 10, population: 3);
        var foreign = TestWorld.City(s, 1, 17, 10, population: 5);
        TestWorld.PlaceDistrict(s, foreign, "DISTRICT_MARKET", TestWorld.Tile(s, 18, 10));
        TestWorld.PlaceDistrict(s, second, "DISTRICT_ACADEMY", TestWorld.Tile(s, 13, 10));
        var trader = TestWorld.Unit(s, 0, "UNIT_TRADER", 5, 10);
        return (s, home, second, foreign, trader);
    }

    [Fact]
    public void Capacity_ComesFromForeignTrade_AndMarketsAndHarbors()
    {
        var (s, home, _, _, _) = World();
        var p = s.Players[0];
        Assert.Equal(1, TradeSystem.Capacity(s, p));   // Foreign Trade (all civics known), no Market yet
        TestWorld.PlaceDistrict(s, home, "DISTRICT_MARKET", TestWorld.Tile(s, 6, 10));
        Assert.Equal(2, TradeSystem.Capacity(s, p));
        p.Civics[s.Db.Civics.IndexOf("CIVIC_FOREIGN_TRADE")] = false;
        Assert.Equal(1, TradeSystem.Capacity(s, p));
    }

    [Fact]
    public void International_PaysGoldBothWays_AndTheTraderIsSpent()
    {
        var (s, home, _, foreign, trader) = World();
        var events = new List<GameEvent>();
        Assert.Null(Run(s, new EstablishTradeRouteCommand { Player = 0, UnitId = trader.Id, DestinationCity = foreign.Id }, events));
        Assert.Null(s.GetUnit(trader.Id));
        var route = Assert.Single(s.TradeRoutes);
        Assert.Equal(home.Tile, route.Path[0]);
        Assert.Equal(foreign.Tile, route.Path[^1]);
        Assert.Contains(events, e => e.Type == GameEventType.TradeRouteEstablished);
        var origin = CityEffects.Compute(s, home).Applied.Where(a => a.Source == $"Trade route to {foreign.Name}").ToList();
        // 3 base + 1 district + 2 Market + 12 tiles / 5.
        Assert.Contains(origin, a => a.Modifier.Yield == YieldType.Gold && a.Modifier.Amount == Fx.FromInt(3 + 1 + 2 + (route.Path.Count / 5)));
        Assert.Contains(CityEffects.Compute(s, foreign).Applied, a => a.Source == $"Trade from {home.Name}" && a.Modifier.Amount == Fx.One);
    }

    [Fact]
    public void Domestic_PaysFoodAndProduction()
    {
        var (s, home, second, _, trader) = World();
        Assert.Null(Run(s, new EstablishTradeRouteCommand { Player = 0, UnitId = trader.Id, DestinationCity = second.Id }));
        var applied = CityEffects.Compute(s, home).Applied.Where(a => a.Source.StartsWith("Trade route")).Select(a => a.Modifier).ToList();
        Assert.Contains(applied, m => m.Yield == YieldType.Food && m.Amount == Fx.FromInt(2));
        Assert.Contains(applied, m => m.Yield == YieldType.Production && m.Amount == Fx.FromInt(2));
    }

    [Fact]
    public void Routes_NeedReach_AFreeSlot_AndPeace()
    {
        var (s, home, second, foreign, trader) = World();
        var far = TestWorld.City(s, 1, 38, 10);
        Assert.Contains("Out of reach", TradeSystem.CanEstablish(s, trader, far.Id));
        Assert.Equal("Choose another city.", TradeSystem.CanEstablish(s, trader, home.Id));
        Run(s, new DeclareWarCommand { Player = 0, Target = 1 });
        Assert.Equal("You are at war with them.", TradeSystem.CanEstablish(s, trader, foreign.Id));
        Assert.Null(Run(s, new EstablishTradeRouteCommand { Player = 0, UnitId = trader.Id, DestinationCity = second.Id }));
        var another = TestWorld.Unit(s, 0, "UNIT_TRADER", 5, 10);
        Assert.Contains("slots are in use", TradeSystem.CanEstablish(s, another, second.Id));
        another.Tile = TestWorld.Tile(s, 8, 8);
        Assert.Equal("The trader must be in one of your cities.", TradeSystem.CanEstablish(s, another, second.Id));
    }

    [Fact]
    public void Routes_End_AndTheTraderComesHome()
    {
        var (s, home, _, foreign, trader) = World();
        Run(s, new EstablishTradeRouteCommand { Player = 0, UnitId = trader.Id, DestinationCity = foreign.Id });
        s.TradeRoutes[0].TurnsLeft = 1;
        var events = new List<GameEvent>();
        TradeSystem.ProcessTurn(s, events);
        Assert.Empty(s.TradeRoutes);
        Assert.Contains(s.Units, u => u.Owner == 0 && u.Tile == home.Tile && TradeSystem.IsTrader(s.Db.Units[u.DefIndex]));
        Assert.Contains(events, e => e.Type == GameEventType.TradeRouteEnded);
    }

    [Fact]
    public void War_EndsInternationalRoutes_AndEnemiesOnTheRoadPlunderThem()
    {
        var (s, home, second, foreign, trader) = World();
        Run(s, new EstablishTradeRouteCommand { Player = 0, UnitId = trader.Id, DestinationCity = foreign.Id });
        Run(s, new DeclareWarCommand { Player = 1, Target = 0 });
        TradeSystem.ProcessTurn(s, new());
        Assert.Empty(s.TradeRoutes);   // the partners are at war
        Assert.Contains(s.Units, u => TradeSystem.IsTrader(s.Db.Units[u.DefIndex]));

        var t2 = s.Units.First(u => TradeSystem.IsTrader(s.Db.Units[u.DefIndex]));
        Assert.Null(Run(s, new EstablishTradeRouteCommand { Player = 0, UnitId = t2.Id, DestinationCity = second.Id }));
        var path = s.TradeRoutes[0].Path;
        var raider = TestWorld.Unit(s, 1, "UNIT_WARRIOR", 0, 0);
        raider.Tile = path[path.Count / 2];
        Fx gold = s.Players[1].Gold;
        var events = new List<GameEvent>();
        TradeSystem.ProcessTurn(s, events);
        Assert.Empty(s.TradeRoutes);
        Assert.DoesNotContain(s.Units, u => TradeSystem.IsTrader(s.Db.Units[u.DefIndex]));   // the trader is lost
        Assert.Equal(gold + Fx.FromInt(TradeSystem.PlunderGold), s.Players[1].Gold);
        Assert.Contains(events, e => e.Type == GameEventType.TradeRoutePlundered && e.Value == 1);
    }

    [Fact]
    public void RoutesToCityStates_PayInfluence()
    {
        var (s, home, _, _, trader) = World();
        var db = s.Db;
        var cs = new PlayerState
        {
            Id = s.Players.Count, Name = "Kilwa", CityStateIndex = db.CityStates.IndexOf("CITYSTATE_KILWA"), Team = -1,
            Techs = new bool[db.Techs.Count], Civics = new bool[db.Civics.Count], Stockpile = new int[db.Resources.Count],
        };
        s.Players.Add(cs);
        var kilwa = CitySystem.Found(s, cs.Id, TestWorld.Tile(s, 5, 16), "Kilwa");
        int before = CityStateSystem.InfluencePerTurn(s, s.Players[0]);
        Assert.Null(Run(s, new EstablishTradeRouteCommand { Player = 0, UnitId = trader.Id, DestinationCity = kilwa.Id }));
        Assert.Equal(before + TradeSystem.CityStateInfluence, CityStateSystem.InfluencePerTurn(s, s.Players[0]));
    }

    [Fact]
    public void Routes_SurviveASave_AndTheCommandRoundTrips()
    {
        var (s, _, _, foreign, trader) = World();
        Run(s, new EstablishTradeRouteCommand { Player = 0, UnitId = trader.Id, DestinationCity = foreign.Id });
        var back = GameStateSerializer.Deserialize(GameStateSerializer.Serialize(s), s.Db);
        var a = s.TradeRoutes[0];
        var b = Assert.Single(back.TradeRoutes);
        Assert.Equal((a.Id, a.Owner, a.Origin, a.Destination, a.TurnsLeft, a.TraderDef), (b.Id, b.Owner, b.Origin, b.Destination, b.TurnsLeft, b.TraderDef));
        Assert.Equal(a.Path, b.Path);
        Assert.Equal(GameStateSerializer.Hash(s), GameStateSerializer.Hash(back));
        var cmd = new EstablishTradeRouteCommand { Player = 2, UnitId = 9, DestinationCity = 11 };
        Assert.Equal(cmd.Serialize(), GameCommand.Deserialize(cmd.Serialize()).Serialize());
    }
}
