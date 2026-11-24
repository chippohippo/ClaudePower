namespace UnbrokenAges.Tests;

/// <summary>The air war: aircraft are based, carriers carry them, fighters intercept, and the unbased run out of fuel.</summary>
public class AirTests
{
    private static GameState War()
    {
        var s = TestWorld.Blank(width: 30, height: 20, players: 2);
        CommandProcessor.Execute(s, new DeclareWarCommand { Player = 0, Target = 1 }, new());
        return s;
    }

    private static void Sea(GameState s, params (int Col, int Row)[] tiles)
    {
        byte ocean = (byte)s.Db.Terrains.First(t => t.Class == TerrainClass.Ocean).Index;
        foreach (var (c, r) in tiles) s.Map.Terrain[TestWorld.Tile(s, c, r)] = ocean;
    }

    [Fact]
    public void Aircraft_RebaseOnlyToBases_WithinOneFlight()
    {
        var s = War();
        var home = TestWorld.City(s, 0, 5, 10);
        var forward = TestWorld.City(s, 0, 10, 10);
        TestWorld.City(s, 0, 20, 10);
        var fighter = TestWorld.Unit(s, 0, "UNIT_FIGHTER", 5, 10);
        Assert.NotNull(new MoveUnitCommand { Player = 0, UnitId = fighter.Id, Destination = TestWorld.Tile(s, 7, 10) }.Validate(s));    // open ground
        Assert.NotNull(new MoveUnitCommand { Player = 0, UnitId = fighter.Id, Destination = TestWorld.Tile(s, 20, 10) }.Validate(s));   // too far
        Assert.True(CommandProcessor.Execute(s, new MoveUnitCommand { Player = 0, UnitId = fighter.Id, Destination = forward.Tile }, new()).Ok);
        Assert.Equal(forward.Tile, fighter.Tile);
        Assert.NotEqual(home.Tile, fighter.Tile);
    }

    [Fact]
    public void ACarrier_CarriesItsAircraft_AndDoesNotAttack()
    {
        var s = War();
        Sea(s, (12, 10), (13, 10), (14, 10), (15, 10), (16, 10));
        var carrier = TestWorld.Unit(s, 0, "UNIT_CARRIER", 12, 10);
        var bomber = TestWorld.Unit(s, 0, "UNIT_BOMBER", 12, 10);
        Assert.True(AirSystem.IsBase(s, 0, carrier.Tile, bomber));
        Assert.True(CommandProcessor.Execute(s, new MoveUnitCommand { Player = 0, UnitId = carrier.Id, Destination = TestWorld.Tile(s, 15, 10) }, new()).Ok);
        Assert.Equal(carrier.Tile, bomber.Tile);
        TestWorld.Unit(s, 1, "UNIT_DESTROYER", 16, 10);
        Assert.False(CombatSystem.Preview(s, carrier, TestWorld.Tile(s, 16, 10)).Legal);
    }

    [Fact]
    public void Fighters_InterceptStrikesInTheirRange()
    {
        var s = War();
        TestWorld.City(s, 0, 5, 10);
        var target = TestWorld.City(s, 1, 9, 10);
        var bomber = TestWorld.Unit(s, 0, "UNIT_BOMBER", 5, 10);
        var fighter = TestWorld.Unit(s, 1, "UNIT_FIGHTER", 9, 10);
        Assert.Same(fighter, AirSystem.Interceptor(s, bomber, target.Tile));
        var events = new List<GameEvent>();
        Assert.True(CommandProcessor.Execute(s, new AttackCommand { Player = 0, UnitId = bomber.Id, TargetTile = target.Tile }, events).Ok);
        Assert.Contains(events, e => e.Type == GameEventType.BattleFought && e.Detail!.Contains("intercepts"));
        Assert.True(fighter.AttackedThisTurn);
        Assert.True(bomber.Hp < 100 || !s.Units.Contains(bomber));
        Assert.Null(AirSystem.Interceptor(s, bomber, target.Tile));   // one interception per fighter per turn
    }

    [Fact]
    public void AnAircraftWithoutABase_RunsOutOfFuel()
    {
        var s = War();
        var stray = TestWorld.Unit(s, 0, "UNIT_FIGHTER", 7, 7);
        var events = new List<GameEvent>();
        for (int i = 0; i < 4; i++) AirSystem.ProcessTurn(s, events);
        Assert.DoesNotContain(stray, s.Units);
        Assert.Contains(events, e => e.Type == GameEventType.UnitDestroyed && e.Detail!.Contains("out of fuel"));
    }
}
