namespace UnbrokenAges.Tests;

public class LoyaltyTests
{
    private static (GameState S, CityState Small, CityState Big) Frontier()
    {
        var s = TestWorld.Blank(width: 30, height: 20);
        TestWorld.City(s, 0, 2, 4, population: 3);          // P0 capital, far away (> 9 tiles)
        var small = TestWorld.City(s, 0, 14, 10, population: 1);
        var big = TestWorld.City(s, 1, 17, 10, population: 12); // P1 capital, 3 tiles away
        foreach (var c in s.Cities) c.TurnsSinceOwnerChange = 99;   // long settled
        return (s, small, big);
    }

    [Fact]
    public void Breakdown_MatchesTheDocumentedFormula()
    {
        var (s, small, _) = Frontier();
        var b = LoyaltySystem.Compute(s, small, LoyaltySystem.Snapshot(s));
        Assert.Equal(Fx.One, b.DomesticPressure);
        Assert.Equal(Fx.Parse("10.5"), b.ForeignPressure);         // 12 × 0.7 × 1.25 (capital)
        Assert.Equal(Fx.FromInt(-LoyaltySystem.PressureCap), b.PressureTerm);   // clamped
        Assert.Equal(Fx.FromInt(-1), b.Amenities);                  // displeased
        Assert.Equal(Fx.FromInt(LoyaltySystem.HomelandBonus), b.Homeland);    // still held by its founders
        Assert.Equal(Fx.FromInt(-10), b.Total);
        Assert.Equal(10, b.TurnsUntilFlip);
        Assert.Equal(1, b.TopForeignPlayer);
    }

    [Fact]
    public void City_DeclaresIndependence_ThenJoinsTheDominantNeighbour()
    {
        var (s, small, big) = Frontier();
        var events = new List<GameEvent>();
        for (int i = 0; i < 10; i++) LoyaltySystem.ProcessTurn(s, events);
        Assert.True(s.Players[small.Owner].IsFreeCities);
        Assert.Contains(events, e => e.Type == GameEventType.CityDeclaredIndependence);
        Assert.Contains(events, e => e.Type == GameEventType.LoyaltyWarning);

        for (int i = 0; i < 10 && small.Owner != 1; i++) LoyaltySystem.ProcessTurn(s, events);
        Assert.Equal(1, small.Owner);
        Assert.Equal(1, big.Owner); // capitals never flip
        Assert.Contains(events, e => e.Type == GameEventType.CityFlipped);
    }

    [Fact]
    public void EstablishedGovernor_AddsEight()
    {
        var (s, small, _) = Frontier();
        var p0 = s.Players[0];
        p0.GovernorTitles = 1;
        int steward = s.Db.Governors.IndexOf("GOVERNOR_STEWARD");
        Assert.True(CommandProcessor.Execute(s, new AppointGovernorCommand { Player = 0, Governor = steward }, new()).Ok);
        Assert.True(CommandProcessor.Execute(s, new AssignGovernorCommand { Player = 0, Governor = steward, CityId = small.Id }, new()).Ok);
        p0.GetGovernor(steward)!.Established = true;
        var b = LoyaltySystem.Compute(s, small, LoyaltySystem.Snapshot(s));
        Assert.Equal(Fx.FromInt(8), b.Governor);
        Assert.Equal(Fx.FromInt(-2), b.Total);
    }
}

public class GovernorTests
{
    [Fact]
    public void Establishment_TakesConfiguredTurns_AndAppliesEffects()
    {
        var s = TestWorld.Blank();
        var city = TestWorld.City(s, 0, 10, 10, population: 3);
        s.Players[0].GovernorTitles = 1;
        int steward = s.Db.Governors.IndexOf("GOVERNOR_STEWARD");
        Assert.True(CommandProcessor.Execute(s, new AppointGovernorCommand { Player = 0, Governor = steward }, new()).Ok);
        Assert.Equal(0, s.Players[0].GovernorTitles);
        Assert.True(CommandProcessor.Execute(s, new AssignGovernorCommand { Player = 0, Governor = steward, CityId = city.Id }, new()).Ok);

        int housingBefore = CityYields.Compute(s, city).Housing;
        var events = new List<GameEvent>();
        for (int i = 0; i < 4; i++) GovernorSystem.ProcessTurn(s, events);
        Assert.Empty(events);
        GovernorSystem.ProcessTurn(s, events);
        Assert.Single(events, e => e.Type == GameEventType.GovernorEstablished);
        Assert.Equal(housingBefore + 2, CityYields.Compute(s, city).Housing);
    }

    [Fact]
    public void Promotions_RespectPrerequisites_AndCanChangeCapacity()
    {
        var s = TestWorld.Blank();
        var city = TestWorld.City(s, 0, 10, 10, population: 1);
        var p = s.Players[0];
        p.GovernorTitles = 3;
        var def = s.Db.Governors["GOVERNOR_STEWARD"];
        CommandProcessor.Execute(s, new AppointGovernorCommand { Player = 0, Governor = def.Index }, new());
        var planner = new PromoteGovernorCommand { Player = 0, Governor = def.Index, Promotion = def.PromotionIndex("STEWARD_URBAN_PLANNER") };
        Assert.Equal("Requires Public Works.", planner.Validate(s));
        Assert.True(CommandProcessor.Execute(s, new PromoteGovernorCommand { Player = 0, Governor = def.Index, Promotion = def.PromotionIndex("STEWARD_PUBLIC_WORKS") }, new()).Ok);
        Assert.True(CommandProcessor.Execute(s, planner, new()).Ok);
        CommandProcessor.Execute(s, new AssignGovernorCommand { Player = 0, Governor = def.Index, CityId = city.Id }, new());
        p.GetGovernor(def.Index)!.Established = true;
        Assert.Equal(2, Sim.Systems.Districts.DistrictPlacement.Capacity(city, CityEffects.Compute(s, city)));
    }

    [Fact]
    public void Moving_ResetsEstablishment_AndSwapsIncumbent()
    {
        var s = TestWorld.Blank();
        var a = TestWorld.City(s, 0, 5, 10);
        var b = TestWorld.City(s, 0, 15, 10);
        var p = s.Players[0];
        p.GovernorTitles = 2;
        int steward = s.Db.Governors.IndexOf("GOVERNOR_STEWARD");
        int castellan = s.Db.Governors.IndexOf("GOVERNOR_CASTELLAN");
        CommandProcessor.Execute(s, new AppointGovernorCommand { Player = 0, Governor = steward }, new());
        CommandProcessor.Execute(s, new AppointGovernorCommand { Player = 0, Governor = castellan }, new());
        CommandProcessor.Execute(s, new AssignGovernorCommand { Player = 0, Governor = steward, CityId = a.Id }, new());
        p.GetGovernor(steward)!.Established = true;
        CommandProcessor.Execute(s, new AssignGovernorCommand { Player = 0, Governor = castellan, CityId = a.Id }, new());
        Assert.Equal(castellan, a.GovernorDef);
        Assert.Equal(-1, p.GetGovernor(steward)!.CityId);
        Assert.False(p.GetGovernor(steward)!.Established);
        CommandProcessor.Execute(s, new AssignGovernorCommand { Player = 0, Governor = steward, CityId = b.Id }, new());
        Assert.Equal(steward, b.GovernorDef);
    }

    [Fact]
    public void SwiftHand_ShortensEstablishment()
    {
        var s = TestWorld.Blank();
        var def = s.Db.Governors["GOVERNOR_STEWARD"];
        var gov = new GovernorState { DefIndex = def.Index };
        Assert.Equal(5, GovernorSystem.EstablishTurns(s.Db, gov));
        gov.Promotions.Add(def.PromotionIndex("STEWARD_SWIFT_HAND"));
        Assert.Equal(3, GovernorSystem.EstablishTurns(s.Db, gov));
    }
}
