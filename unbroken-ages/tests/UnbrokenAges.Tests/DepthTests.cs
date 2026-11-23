namespace UnbrokenAges.Tests;

/// <summary>Depth borrowed from Millennia and Shadow Empire, held to Civ-level ease (docs/09-genre-defining-depth.md).</summary>
public class WorldAgeTests
{
    private static GameEvent Ev(GameEventType t, int value = 0, int def = -1) => new(t, Value: value, Def: def);

    [Fact]
    public void Currents_ArePushedByEvents_AndDecay()
    {
        var s = TestWorld.Blank(allTech: false);
        var events = Enumerable.Repeat(Ev(GameEventType.Disaster), 5).ToList();
        events.Add(Ev(GameEventType.ProductionCompleted, (int)ProductionKind.Unit, s.Db.Units.IndexOf("UNIT_WARRIOR")));
        events.Add(Ev(GameEventType.ProductionCompleted, (int)ProductionKind.Unit, s.Db.Units.IndexOf("UNIT_BUILDER")));
        WorldSystem.Push(s, events, 0);
        Assert.Equal(Fx.FromInt(20), s.World.Calamity);
        Assert.Equal(Fx.One, s.World.Strife);                  // only the warrior is military
        WorldSystem.ProcessTurn(s, new List<GameEvent>());
        Assert.InRange(s.World.Calamity.ToDouble(), 19.39, 19.41);
    }

    [Fact]
    public void ANewEra_BeginsTheAgeTheCurrentsPointTo_ForEveryone()
    {
        var s = TestWorld.Blank(allTech: false);
        var city = TestWorld.City(s, 1, 10, 10, population: 3);
        s.World.Strife = 70;
        Assert.Equal(s.Db.WorldAges.IndexOf("AGE_OF_IRON"), WorldSystem.Forecast(s, 1));
        s.World.Calamity = 65;                                 // catastrophe outranks war
        Assert.Equal(s.Db.WorldAges.IndexOf("AGE_OF_ASH"), WorldSystem.Forecast(s, 1));
        s.World.Calamity = 0;

        var before = CityEffects.Compute(s, city).ProductionBonusFor(ProductionCategory.Unit);
        s.Players[0].Techs[s.Db.Techs.IndexOf("TECH_CURRENCY")] = true; // a different civ reaches the Classical era
        var events = new List<GameEvent>();
        WorldSystem.ProcessTurn(s, events);
        Assert.Equal(s.Db.WorldAges.IndexOf("AGE_OF_IRON"), s.World.CurrentAge);
        Assert.Contains(events, e => e.Type == GameEventType.WorldAgeBegan);
        Assert.Equal(before + 25, CityEffects.Compute(s, city).ProductionBonusFor(ProductionCategory.Unit));

        events.Clear();
        WorldSystem.ProcessTurn(s, events);
        Assert.Empty(events);                                  // one age per era
        Assert.Single(s.World.AgeHistory);
    }

    [Fact]
    public void AnAgeOfAsh_MakesDisastersLikelier()
    {
        var s = TestWorld.Blank(allTech: false);
        var flood = s.Db.Disasters["DISASTER_RIVER_FLOOD"];
        int normal = ClimateSystem.DisasterChancePermille(s, flood);
        s.World.CurrentAge = s.Db.WorldAges.IndexOf("AGE_OF_ASH");
        Assert.Equal(normal * 3 / 2, ClimateSystem.DisasterChancePermille(s, flood));
    }
}

public class SupplyTests
{
    [Fact]
    public void Supply_FlowsFarther_AlongGreatRivers()
    {
        var s = TestWorld.Blank(width: 30, height: 20);
        var city = TestWorld.City(s, 0, 5, 10);
        for (int col = 6; col < 22; col++) s.Map.Terrain[TestWorld.Tile(s, col, 10)] = (byte)s.Db.Ids.Channel;
        var supply = SupplySystem.Compute(s, 0);
        Assert.True(supply[TestWorld.Tile(s, 14, 10)] >= 0);   // 9 tiles downriver
        Assert.True(supply[TestWorld.Tile(s, 5, 2)] < 0);      // 8 tiles overland
        Assert.True(supply[TestWorld.Tile(s, 7, 10)] >= 0);
    }

    [Fact]
    public void Garrisons_ExtendSupply()
    {
        var s = TestWorld.Blank(width: 30, height: 20);
        var city = TestWorld.City(s, 0, 10, 10, population: 4);
        int probe = TestWorld.Tile(s, 14, 10);
        Assert.True(SupplySystem.Compute(s, 0)[probe] < 0);
        TestWorld.PlaceDistrict(s, city, "DISTRICT_GARRISON", s.Map.Neighbor(s.Map.Neighbor(city.Tile, HexCoord.W), HexCoord.W));
        Assert.True(SupplySystem.Compute(s, 0)[probe] >= 0);
    }

    [Fact]
    public void Ports_SupplyTheSea_AndLandBeachheads()
    {
        var s = TestWorld.Blank(width: 30, height: 20);
        var city = TestWorld.City(s, 0, 5, 10);
        for (int row = 0; row < 20; row++)
        for (int col = 6; col < 11; col++) s.Map.Terrain[TestWorld.Tile(s, col, row)] = (byte)s.Db.Ids.Coast;
        int island = TestWorld.Tile(s, 11, 10); // across a strait four tiles from the harbor
        Assert.True(SupplySystem.Compute(s, 0)[island] < 0);
        TestWorld.PlaceDistrict(s, city, "DISTRICT_HARBOR", TestWorld.Tile(s, 6, 10));
        var supply = SupplySystem.Compute(s, 0);
        Assert.True(supply[TestWorld.Tile(s, 10, 10)] >= 0);
        Assert.True(supply[island] >= 0);                      // beachhead next to well-supplied water
        Assert.True(supply[TestWorld.Tile(s, 14, 10)] < 0);    // but not inland beyond it
    }

    [Fact]
    public void CutOffArmies_SufferAttrition_WhileSuppliedOnesHeal()
    {
        var s = TestWorld.Blank(width: 30, height: 20);
        TestWorld.City(s, 0, 3, 10);
        var enemy = TestWorld.City(s, 1, 22, 10);
        var ring = new List<int>();
        s.Map.CollectRadius(enemy.Tile, 3, ring);
        foreach (int t in ring) CitySystem.ClaimTile(s, enemy, t);
        int warrior = s.Db.Units.IndexOf("UNIT_WARRIOR");
        var raider = new UnitState { Id = s.AllocateId(), Owner = 0, DefIndex = warrior, Tile = s.Map.Neighbor(enemy.Tile, HexCoord.W), Hp = 100 };
        var guard = new UnitState { Id = s.AllocateId(), Owner = 0, DefIndex = warrior, Tile = TestWorld.Tile(s, 4, 10), Hp = 50 };
        s.AddUnit(raider);
        s.AddUnit(guard);

        var events = new List<GameEvent>();
        SupplySystem.ProcessTurn(s, events);
        Assert.Equal(100, raider.Hp);                          // foreign land at peace: no attrition
        Assert.True(CommandProcessor.Execute(s, new DeclareWarCommand { Player = 0, Target = 1 }, events).Ok);
        guard.Hp = 50;
        SupplySystem.ProcessTurn(s, events);
        Assert.Equal(90, raider.Hp);
        Assert.Equal(60, guard.Hp);
        for (int i = 0; i < 9; i++) SupplySystem.ProcessTurn(s, events);
        Assert.Null(s.GetUnit(raider.Id));
        Assert.Contains(events, e => e.Type == GameEventType.UnitLostToAttrition && e.Player == 0);
        Assert.Equal(100, guard.Hp);
    }
}

public class IndustryTests
{
    private static (GameState S, CityState City) Mill()
    {
        var s = TestWorld.Blank();
        var city = TestWorld.City(s, 0, 10, 10, population: 6);
        TestWorld.PlaceDistrict(s, city, "DISTRICT_FOUNDRY", s.Map.Neighbor(city.Tile, HexCoord.E),
            "BUILDING_WORKSHOP", "BUILDING_STEEL_MILL", "BUILDING_ELECTRONICS_PLANT");
        return (s, city);
    }

    private static int R(GameState s, string id) => s.Db.Resources.IndexOf(id);

    [Fact]
    public void Industries_TurnStockpilesIntoGoods_Automatically()
    {
        var (s, _) = Mill();
        var stock = s.Players[0].Stockpile;
        stock[R(s, "RESOURCE_IRON")] = 3;
        stock[R(s, "RESOURCE_COAL")] = 2;
        IndustrySystem.ProcessTurn(s);
        IndustrySystem.ProcessTurn(s);
        var runs = IndustrySystem.ProcessTurn(s);
        Assert.Equal(4, stock[R(s, "RESOURCE_STEEL")]);
        Assert.Equal(1, stock[R(s, "RESOURCE_IRON")]);
        Assert.Equal(0, stock[R(s, "RESOURCE_COAL")]);
        Assert.Contains(runs, r => !r.Ran && r.Reason == "needs Coal");
        Assert.Contains(runs, r => !r.Ran && r.Reason == "unpowered");     // the Electronics Plant needs power
    }

    [Fact]
    public void DryRun_DoesNotTouchTheStockpile()
    {
        var (s, _) = Mill();
        s.Players[0].Stockpile[R(s, "RESOURCE_IRON")] = 1;
        s.Players[0].Stockpile[R(s, "RESOURCE_COAL")] = 1;
        var plan = IndustrySystem.ProcessTurn(s, commit: false);
        Assert.Contains(plan, r => r.Ran);
        Assert.Equal(0, s.Players[0].Stockpile[R(s, "RESOURCE_STEEL")]);
    }

    [Fact]
    public void Units_ThatNeedGoods_WaitAtFullProgress_InsteadOfVanishing()
    {
        var s = TestWorld.Blank();
        var city = TestWorld.City(s, 0, 10, 10, population: 6);
        int swordsman = s.Db.Units.IndexOf("UNIT_SWORDSMAN");
        int iron = R(s, "RESOURCE_IRON");
        Assert.Equal("Needs 10 Iron (have 0).", ProductionSystem.CanEnqueue(s, city, ProductionKind.Unit, swordsman, -1));

        s.Players[0].Stockpile[iron] = 10;
        Assert.True(CommandProcessor.Execute(s, new EnqueueCommand { Player = 0, CityId = city.Id, Kind = ProductionKind.Unit, DefIndex = swordsman }, new()).Ok);
        s.Players[0].Stockpile[iron] = 4; // spent elsewhere
        var events = new List<GameEvent>();
        ProductionSystem.Process(s, city, 200, CityEffects.Compute(s, city), events);
        Assert.Contains(events, e => e.Type == GameEventType.ProductionStalled);
        Assert.Single(city.Queue.Items);

        s.Players[0].Stockpile[iron] = 12;
        ProductionSystem.Process(s, city, 0, CityEffects.Compute(s, city), events);
        Assert.Empty(city.Queue.Items);
        Assert.Equal(2, s.Players[0].Stockpile[iron]);
        Assert.Contains(s.Units, u => u.DefIndex == swordsman);
    }
}

public class ChronicleTests
{
    [Fact]
    public void Calendar_FollowsTheDocumentedSchedule()
    {
        Assert.Equal(-4000, Calendar.Year(1));
        Assert.Equal(-1000, Calendar.Year(76));
        Assert.Equal(500, Calendar.Year(136));
        Assert.Equal(1700, Calendar.Year(196));
        Assert.Equal(1950, Calendar.Year(246));
        Assert.Equal(2000, Calendar.Year(296));
        Assert.Equal("2340 BC", Calendar.Format(-2340));
        Assert.Equal("AD 1850", Calendar.Format(1850));
        Assert.True(Calendar.Year(76, 150) < -1000);            // slower game speed → fewer years per turn
    }

    [Fact]
    public void FoundingACity_WritesHistory_OnceEvenWhenTheEventListIsReused()
    {
        var s = TestWorld.Blank(leaders: new[] { "LEADER_THUTMOSE" }, allTech: false);
        int settler = s.Db.Units.IndexOf("UNIT_SETTLER");
        var a = new UnitState { Id = s.AllocateId(), Owner = 0, DefIndex = settler, Tile = TestWorld.Tile(s, 5, 5) };
        var b = new UnitState { Id = s.AllocateId(), Owner = 0, DefIndex = settler, Tile = TestWorld.Tile(s, 15, 12) };
        s.AddUnit(a);
        s.AddUnit(b);
        var shared = new List<GameEvent>();
        Assert.True(CommandProcessor.Execute(s, new FoundCityCommand { Player = 0, UnitId = a.Id }, shared).Ok);
        Assert.True(CommandProcessor.Execute(s, new FoundCityCommand { Player = 0, UnitId = b.Id }, shared).Ok);
        Assert.Equal(2, s.Chronicle.Count);
        Assert.Equal("4000 BC: Egypt founds Waset.", s.Chronicle[0].Text);
        Assert.Equal("4000 BC: Egypt founds Men-nefer.", s.Chronicle[1].Text);
    }

    [Fact]
    public void OncePerPlayerEntries_RecordOnlyTheFirstTime()
    {
        var s = TestWorld.Blank(allTech: false);
        var events = new List<GameEvent>
        {
            new(GameEventType.TileSubmerged, 0, Tile: 3), new(GameEventType.TileSubmerged, 0, Tile: 4), new(GameEventType.TileSubmerged, 1, Tile: 5),
        };
        ChronicleSystem.Record(s, events, 0);
        Assert.Equal(2, s.Chronicle.Count);
        Assert.All(s.Chronicle, c => Assert.Contains("The sea claims the first", c.Text));
    }

    [Fact]
    public void WorldAndChronicle_SurviveSnapshots()
    {
        var s = TestWorld.Blank(allTech: false);
        s.World.Strife = 42;
        s.World.CurrentAge = 1;
        s.World.AgeHistory.Add((1, 1));
        ChronicleSystem.Record(s, new List<GameEvent> { new(GameEventType.ClimatePhaseChanged, Value: 2) }, 0);
        var back = GameStateSerializer.Deserialize(GameStateSerializer.Serialize(s), s.Db);
        Assert.Equal(s.World.Strife, back.World.Strife);
        Assert.Equal(s.World.AgeHistory, back.World.AgeHistory);
        Assert.Equal(s.Chronicle[0].Text, back.Chronicle[0].Text);
        Assert.Equal(GameStateSerializer.Hash(s), GameStateSerializer.Hash(back));
    }
}
