using UnbrokenAges.Sim.AI;

namespace UnbrokenAges.Tests;

/// <summary>Nations shrink but are not erased in the opening: a fallen capital moves, a last city does not revolt, and the AI
/// leaves a rival's last city (and its garrison) alone until the spared-until turn.</summary>
public class SurvivalTests
{
    [Fact]
    public void AFallenCapital_MovesToTheLargestCityLeft()
    {
        var s = TestWorld.Blank(width: 30, height: 20, players: 2);
        var capital = TestWorld.City(s, 0, 4, 4, population: 5);
        TestWorld.City(s, 0, 4, 12, population: 2);
        var second = TestWorld.City(s, 0, 10, 12, population: 6);
        var events = new List<GameEvent>();
        CitySystem.ChangeOwner(s, capital, 1, events, GameEventType.CityCaptured);
        Assert.True(second.IsCapital);
        Assert.Equal(second.Id, s.Players[0].CapitalCityId);
        Assert.Contains(events, e => e.Type == GameEventType.CapitalMoved && e.City == second.Id);
        Assert.True(capital.WasOriginalCapital);   // Hegemony still counts the original
    }

    [Fact]
    public void ALastCity_NeverRevolts()
    {
        var s = TestWorld.Blank(width: 30, height: 20);
        var lone = TestWorld.City(s, 0, 14, 10, population: 1);
        lone.IsCapital = false;
        s.Players[0].CapitalCityId = -1;
        TestWorld.City(s, 1, 17, 10, population: 12);
        var events = new List<GameEvent>();
        for (int i = 0; i < 15; i++) LoyaltySystem.ProcessTurn(s, events);
        Assert.Equal(0, lone.Owner);
    }

    [Fact]
    public void TheAi_LeavesALastCitysGarrisonAlone_UntilTheSparedTurn()
    {
        var s = TestWorld.Blank(width: 30, height: 20, players: 2);
        TestWorld.City(s, 0, 4, 10);
        var last = TestWorld.City(s, 1, 12, 10);
        last.Hp = 1;
        TestWorld.Unit(s, 1, "UNIT_WARRIOR", 12, 10).Hp = 1;
        TestWorld.Unit(s, 0, "UNIT_MECH_INFANTRY", 11, 10);
        CommandProcessor.Execute(s, new DeclareWarCommand { Player = 0, Target = 1 }, new());
        s.Turn = 20;
        Assert.DoesNotContain(MilitaryAi.Fight(s, s.Players[0]), c => c is AttackCommand a && a.TargetTile == last.Tile);
        s.Turn = MilitaryAi.SparedUntilTurn;
        Assert.Contains(MilitaryAi.Fight(s, s.Players[0]), c => c is AttackCommand a && a.TargetTile == last.Tile);
    }
}
