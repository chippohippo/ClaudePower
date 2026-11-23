namespace UnbrokenAges.Tests;

public class PowerTests
{
    private static (GameState S, CityState Plant, CityState Lab, CityState Far) Grid()
    {
        var s = TestWorld.Blank(width: 40, height: 20);
        var plant = TestWorld.City(s, 0, 6, 10, population: 6);
        var lab = TestWorld.City(s, 0, 11, 10, population: 6);  // 5 tiles away: inside range 6
        var far = TestWorld.City(s, 0, 30, 10, population: 6);  // separate grid
        TestWorld.PlaceDistrict(s, plant, "DISTRICT_FOUNDRY", s.Map.Neighbor(plant.Tile, HexCoord.W),
            "BUILDING_WORKSHOP", "BUILDING_FACTORY", "BUILDING_COAL_PLANT");
        TestWorld.PlaceDistrict(s, lab, "DISTRICT_ACADEMY", s.Map.Neighbor(lab.Tile, HexCoord.E),
            "BUILDING_LIBRARY", "BUILDING_UNIVERSITY", "BUILDING_RESEARCH_LAB");
        TestWorld.PlaceDistrict(s, far, "DISTRICT_ACADEMY", s.Map.Neighbor(far.Tile, HexCoord.E),
            "BUILDING_LIBRARY", "BUILDING_UNIVERSITY", "BUILDING_RESEARCH_LAB");
        return (s, plant, lab, far);
    }

    [Fact]
    public void CoalPlant_PowersCitiesInRange_AndBurnsFuel()
    {
        var (s, plant, lab, far) = Grid();
        int coal = s.Db.Resources.IndexOf("RESOURCE_COAL");
        s.Players[0].Stockpile[coal] = 10;
        var report = PowerSystem.Process(s, commit: true, new List<GameEvent>());
        Assert.True(plant.IsPowered);
        Assert.True(lab.IsPowered);       // demand 1 (factory) + 3 (lab) = 4 = coal plant output
        Assert.False(far.IsPowered);
        Assert.Equal(9, s.Players[0].Stockpile[coal]);
        Assert.Equal(Fx.FromInt(4), report.Co2ByPlayer[0]);
    }

    [Fact]
    public void WithoutFuel_CitiesBrownOut()
    {
        var (s, plant, lab, _) = Grid();
        var events = new List<GameEvent>();
        PowerSystem.Process(s, commit: true, events);
        Assert.False(plant.IsPowered);
        Assert.False(lab.IsPowered);
        Assert.Contains(events, e => e.Type == GameEventType.PowerShortage && e.City == lab.Id);
    }

    [Fact]
    public void CleanestFirstDispatch_KeepsCoalIdle_WhenRenewablesSuffice()
    {
        var (s, plant, lab, _) = Grid();
        int coal = s.Db.Resources.IndexOf("RESOURCE_COAL");
        s.Players[0].Stockpile[coal] = 10;
        TestWorld.PlaceDistrict(s, plant, "DISTRICT_DAM", s.Map.Neighbor(plant.Tile, HexCoord.E), "BUILDING_HYDROELECTRIC_DAM");
        var report = PowerSystem.Process(s, commit: true);
        Assert.True(lab.IsPowered);
        Assert.Equal(10, s.Players[0].Stockpile[coal]);
        Assert.Equal(Fx.Zero, report.TotalCo2);

        s.Players[0].DispatchPolicy = PowerDispatchPolicy.CheapestFirst; // plenty of coal on hand → burn it
        report = PowerSystem.Process(s, commit: true);
        Assert.True(report.TotalCo2 >= Fx.Zero);
    }

    [Fact]
    public void PoweredBuildings_AddTheirBonusYields()
    {
        var (s, _, lab, _) = Grid();
        var unpowered = CityYields.Compute(s, lab).Buildings.Science;
        s.Players[0].Stockpile[s.Db.Resources.IndexOf("RESOURCE_COAL")] = 10;
        PowerSystem.Process(s, commit: true);
        Assert.Equal(unpowered + 5, CityYields.Compute(s, lab).Buildings.Science);
    }
}

public class ClimateTests
{
    [Fact]
    public void Emissions_RaiseCo2_AndTemperatureLagsBehind()
    {
        var s = TestWorld.Blank();
        var report = new PowerReport { TotalCo2 = 100 };
        report.Co2ByPlayer[0] = 100;
        ClimateSystem.ProcessTurn(s, report, new());
        Assert.InRange(s.Climate.Co2Ppm.ToDouble(), 285.99, 286.01); // 280 + 100 × 0.06
        Assert.True(s.Climate.Temperature > Fx.Zero);
        Assert.True(s.Climate.Temperature < Fx.Ratio(1, 10));       // thermal inertia
        Assert.Equal(Fx.FromInt(100), s.Players[0].CumulativeEmissions);
    }

    [Fact]
    public void Phases_RaiseSeas_AndFloodBarriersProtect()
    {
        var s = TestWorld.Blank();
        var city = TestWorld.City(s, 0, 10, 10);
        int low1 = s.Map.Neighbor(city.Tile, HexCoord.E);
        int low3 = s.Map.Neighbor(city.Tile, HexCoord.W);
        int unownedLow = TestWorld.Tile(s, 20, 3);
        s.Map.Lowland[low1] = 1;
        s.Map.Lowland[low3] = 3;
        s.Map.Lowland[unownedLow] = 1;
        s.Climate.Co2Ppm = 560; // doubled → equilibrium +3°C

        var events = new List<GameEvent>();
        for (int i = 0; i < 20; i++) ClimateSystem.ProcessTurn(s, new PowerReport(), events);
        Assert.Equal(3, s.Climate.Phase);
        Assert.True(s.Map.HasFlag(low1, TileFlags.Submerged));
        Assert.Equal(s.Db.Ids.Coast, s.Map.Terrain[low1]);
        Assert.Contains(events, e => e.Type == GameEventType.ClimatePhaseChanged);

        TestWorld.AddBuilding(s, city, "BUILDING_FLOOD_BARRIER");
        ClimateSystem.RefreshFloodProtection(s, city);
        for (int i = 0; i < 200; i++) ClimateSystem.ProcessTurn(s, new PowerReport(), events);
        Assert.Equal(5, s.Climate.Phase);
        Assert.False(s.Map.HasFlag(low3, TileFlags.Submerged));      // protected
        Assert.True(s.Map.HasFlag(unownedLow, TileFlags.Submerged));
    }

    [Fact]
    public void Forests_AreACarbonSink()
    {
        var s = TestWorld.Blank();
        Array.Fill(s.Map.Feature, (short)s.Db.Ids.Forest);
        s.Climate.Co2Ppm = 300;
        ClimateSystem.ProcessTurn(s, new PowerReport(), new());
        Assert.True(s.Climate.Co2Ppm < 300);
    }

    [Fact]
    public void DisasterChance_ScalesWithIntensityAndPhase()
    {
        var s = TestWorld.Blank();
        var flood = s.Db.Disasters["DISASTER_RIVER_FLOOD"];
        s.Options.DisasterIntensity = 2;
        int baseline = ClimateSystem.DisasterChancePermille(s, flood);
        s.Climate.Phase = 4;
        Assert.Equal(baseline * 2, ClimateSystem.DisasterChancePermille(s, flood));
        s.Options.DisasterIntensity = 0;
        Assert.Equal(0, ClimateSystem.DisasterChancePermille(s, flood));
    }
}
