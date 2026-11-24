namespace UnbrokenAges.Tests;

/// <summary>The orbital layer (satellites) and the Exodus chain and victory.</summary>
public class SpaceTests
{
    private static int P(GameState s, string id) => s.Db.Projects.IndexOf(id);

    private static (GameState S, CityState Port, CityState Near, CityState Far) World()
    {
        var s = TestWorld.Blank(width: 40, height: 20, players: 2);
        s.Players[0].Revealed = new bool[s.Map.Count];
        var port = TestWorld.City(s, 0, 8, 10, population: 6);
        var near = TestWorld.City(s, 0, 12, 10, population: 3);
        var far = TestWorld.City(s, 0, 25, 10, population: 3);
        TestWorld.PlaceDistrict(s, port, "DISTRICT_SPACEPORT", TestWorld.Tile(s, 9, 10));
        return (s, port, near, far);
    }

    private static void Complete(GameState s, CityState city, string project) =>
        ProductionSystem.Complete(s, city, new QueueItem { Kind = ProductionKind.Project, DefIndex = P(s, project), Tile = -1 }, new());

    [Fact]
    public void SpaceProjects_NeedASpaceport_AndTheChainInOrder()
    {
        var (s, port, near, _) = World();
        Assert.Contains("Requires Spaceport", ProductionSystem.CanEnqueue(s, near, ProductionKind.Project, P(s, "PROJECT_FIRST_ORBIT"), -1));
        Assert.Null(ProductionSystem.CanEnqueue(s, port, ProductionKind.Project, P(s, "PROJECT_FIRST_ORBIT"), -1));
        Assert.Equal("Requires First Orbit first.", ProductionSystem.CanEnqueue(s, port, ProductionKind.Project, P(s, "PROJECT_MOON_BASE"), -1));
        Complete(s, port, "PROJECT_FIRST_ORBIT");
        Assert.Equal(1, s.Players[0].ExodusStage);
        Assert.Equal("Already completed.", ProductionSystem.CanEnqueue(s, port, ProductionKind.Project, P(s, "PROJECT_FIRST_ORBIT"), -1));
        Assert.Null(ProductionSystem.CanEnqueue(s, port, ProductionKind.Project, P(s, "PROJECT_MOON_BASE"), -1));
    }

    [Fact]
    public void TheArk_WinsTheExodusVictory()
    {
        var (s, port, _, _) = World();
        foreach (var id in new[] { "PROJECT_FIRST_ORBIT", "PROJECT_MOON_BASE", "PROJECT_MARS_COLONY" }) Complete(s, port, id);
        Assert.Equal(-1, SpaceSystem.ExodusWinner(s));
        Complete(s, port, "PROJECT_EXODUS_ARK");
        Assert.Equal(SpaceSystem.FinalStage, s.Players[0].ExodusStage);
        VictorySystem.Check(s, new(), endOfTurn: true);
        Assert.Equal(VictoryKind.Exodus, s.Victory.Kind);
    }

    [Fact]
    public void Satellites_CoverNearbyCities_OncePerKind_AndFall()
    {
        var (s, port, near, far) = World();
        Fx Production(CityState c) => CityYields.Compute(s, c, CityEffects.Compute(s, c)).Total.Production;
        Fx nearBefore = Production(near), farBefore = Production(far);
        Complete(s, port, "PROJECT_SOLAR_ARRAY");
        Complete(s, port, "PROJECT_SOLAR_ARRAY");   // a second array over the same cities adds nothing more
        Assert.Equal(2, s.Satellites.Count);
        Assert.True(Production(near) > nearBefore);   // +2 flat (amenity modifiers apply on top)
        Assert.Equal(farBefore, Production(far));
        Assert.Single(CityEffects.Compute(s, near).Applied, a => a.Source == "Orbit: Solar Array");

        s.Satellites.ForEach(x => x.TurnsLeft = 1);
        var events = new List<GameEvent>();
        SpaceSystem.ProcessTurn(s, events);
        Assert.Empty(s.Satellites);
        Assert.Equal(2, events.Count(e => e.Type == GameEventType.SatelliteFell));
    }

    [Fact]
    public void SurveySatellites_MapTheLandBelow()
    {
        var (s, port, _, far) = World();
        Complete(s, port, "PROJECT_SURVEY_SATELLITE");
        var p = s.Players[0];
        Assert.True(p.Revealed[TestWorld.Tile(s, 8 + SpaceSystem.SurveyRadius, 10)]);
        Assert.False(p.Revealed[far.Tile]);
    }

    [Fact]
    public void Space_SurvivesASave()
    {
        var (s, port, _, _) = World();
        Complete(s, port, "PROJECT_FIRST_ORBIT");
        Complete(s, port, "PROJECT_RELAY_SATELLITE");
        var back = GameStateSerializer.Deserialize(GameStateSerializer.Serialize(s), s.Db);
        Assert.Equal(1, back.Players[0].ExodusStage);
        Assert.Equal(s.Players[0].CompletedProjects, back.Players[0].CompletedProjects);
        var a = s.Satellites[0];
        var b = Assert.Single(back.Satellites);
        Assert.Equal((a.Id, a.Owner, a.Kind, a.Center, a.TurnsLeft), (b.Id, b.Owner, b.Kind, b.Center, b.TurnsLeft));
        Assert.Equal(GameStateSerializer.Hash(s), GameStateSerializer.Hash(back));
    }
}
