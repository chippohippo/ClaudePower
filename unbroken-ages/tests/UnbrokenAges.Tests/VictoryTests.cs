namespace UnbrokenAges.Tests;

public class VictoryTests
{
    private static GameState TwoCapitals(out CityState a, out CityState b, int players = 2)
    {
        var s = TestWorld.Blank(width: 30, height: 20, players: players, allTech: false);
        a = TestWorld.City(s, 0, 5, 10);
        b = TestWorld.City(s, 1, 20, 10);
        return s;
    }

    private static void Capture(GameState s, CityState city, int newOwner) =>
        CitySystem.ChangeOwner(s, city, newOwner, new(), GameEventType.CityCaptured);

    [Fact]
    public void Hegemony_HoldingEveryOriginalCapital_WinsAtOnce()
    {
        var s = TwoCapitals(out _, out var b);
        var events = new List<GameEvent>();
        VictorySystem.Check(s, events, endOfTurn: false);
        Assert.False(s.Victory.Decided);

        Capture(s, b, 0);
        VictorySystem.Check(s, events, endOfTurn: false);
        Assert.Equal((0, VictoryKind.Hegemony), (s.Victory.Winner, s.Victory.Kind));
        Assert.Single(events, e => e.Type == GameEventType.VictoryAchieved);
    }

    [Fact]
    public void Hegemony_WaitsUntilEveryCivilizationHasFounded_AndCountsTeams()
    {
        var s = TwoCapitals(out _, out var b, players: 3);
        s.Players[1].Team = 0;                                  // 0 and 1 are allies; 2 has not founded yet
        Assert.Equal(-1, VictorySystem.HegemonyWinner(s));
        var c = TestWorld.City(s, 2, 12, 3);
        Assert.Equal((2, 3), VictorySystem.CapitalsHeld(s, 0));
        Capture(s, c, 1);
        Assert.Equal(0, VictorySystem.HegemonyWinner(s));       // the team wins together
        _ = b;
    }

    [Fact]
    public void Hegemony_ByShareOfTheWorld_CountsOnlyLoyalCities()
    {
        var s = TestWorld.Blank(width: 8, height: 6, players: 2, allTech: false);
        var a = TestWorld.City(s, 0, 2, 2, population: 5);
        TestWorld.City(s, 1, 6, 4, population: 1);
        for (int t = 0; t < s.Map.Count && VictorySystem.ShareOfWorld(s, 0).LandPercent < 60; t++)
            if (s.Map.OwnerPlayer[t] < 0) CitySystem.ClaimTile(s, a, t);
        Assert.Equal(83, VictorySystem.ShareOfWorld(s, 0).PopulationPercent);
        Assert.Equal(0, VictorySystem.HegemonyWinner(s));

        a.Loyalty = 40;                                          // a wavering heartland does not count
        Assert.Equal(0, VictorySystem.ShareOfWorld(s, 0).PopulationPercent);
        Assert.Equal(-1, VictorySystem.HegemonyWinner(s));
    }

    [Fact]
    public void Ascension_Wins_UnlessSwitchedOff()
    {
        var s = TwoCapitals(out _, out _);
        s.Players[1].Ascended = true;
        s.Options.Victories = VictoryKind.All & ~VictoryKind.Ascension;
        VictorySystem.Check(s, new(), endOfTurn: false);
        Assert.False(s.Victory.Decided);
        s.Options.Victories = VictoryKind.All;
        VictorySystem.Check(s, new(), endOfTurn: false);
        Assert.Equal((1, VictoryKind.Ascension), (s.Victory.Winner, s.Victory.Kind));
    }

    [Fact]
    public void Score_IsItemized_AndDecidesTheGameAtTheTurnLimit()
    {
        var s = TwoCapitals(out var a, out _);
        a.Population = 3;
        // 3 citizens + 1 city × 5 + 7 tiles / 5 = 9
        Assert.Equal(9, VictorySystem.Score(s, 0));
        Assert.Equal(3, VictorySystem.ScoreLines(s, 0).Single(l => l.Label == "Citizens").Points);

        s.Options.TurnLimit = s.Turn;
        var events = new List<GameEvent>();
        Assert.True(CommandProcessor.Execute(s, new AdvanceTurnCommand { Player = GameCommand.SystemPlayer, ExpectedTurn = s.Turn }, events).Ok);
        Assert.Equal((0, VictoryKind.Score, 1), (s.Victory.Winner, s.Victory.Kind, s.Victory.Turn));
        Assert.Contains(s.Chronicle, c => c.Kind == GameEventType.VictoryAchieved && c.Text.Contains("Score victory with"));
    }

    [Fact]
    public void AfterVictory_OnlyOneMoreTurnIsAccepted_AndNoSecondVictoryIsAwarded()
    {
        var s = TwoCapitals(out _, out var b);
        s.Players[0].Ascended = true;
        VictorySystem.Check(s, new(), endOfTurn: false);
        Assert.StartsWith("The game has been won", CommandProcessor.Execute(s, new EndTurnCommand { Player = 0 }, new()).Error);
        Assert.Equal("Invalid player.", new OneMoreTurnCommand { Player = 2 }.Validate(s));       // Free Cities

        Assert.True(CommandProcessor.Execute(s, new OneMoreTurnCommand { Player = 1 }, new()).Ok);
        Assert.True(CommandProcessor.Execute(s, new EndTurnCommand { Player = 0 }, new()).Ok);
        Capture(s, b, 0);
        var events = new List<GameEvent>();
        VictorySystem.Check(s, events, endOfTurn: true);
        Assert.Equal(VictoryKind.Ascension, s.Victory.Kind);
        Assert.DoesNotContain(events, e => e.Type == GameEventType.VictoryAchieved);
    }

    [Fact]
    public void ACivilizationWithNoCitiesOrUnits_IsEliminated()
    {
        var s = TwoCapitals(out _, out var b);
        s.Options.Victories = VictoryKind.Score;
        Capture(s, b, 0);
        var events = TurnProcessor.Advance(s);
        Assert.False(s.Players[1].IsAlive);
        Assert.Contains(events, e => e.Type == GameEventType.PlayerEliminated && e.Player == 1);
        Assert.True(s.Players[0].IsAlive);
    }

    [Fact]
    public void VictoryState_AndToggles_SurviveSnapshots()
    {
        var s = TwoCapitals(out _, out _);
        s.Options.TurnLimit = 330;
        s.Options.Victories = VictoryKind.Hegemony | VictoryKind.Score;
        s.Players[0].Ascended = true;
        s.Victory = new VictoryState { Winner = 0, WinnerTeam = 0, Kind = VictoryKind.Hegemony, Turn = 7, Continued = true };
        var back = GameStateSerializer.Deserialize(GameStateSerializer.Serialize(s), s.Db);
        Assert.Equal(330, back.Options.TurnLimit);
        Assert.Equal(s.Options.Victories, back.Options.Victories);
        Assert.Equal((0, VictoryKind.Hegemony, 7, true), (back.Victory.Winner, back.Victory.Kind, back.Victory.Turn, back.Victory.Continued));
        Assert.Equal(GameStateSerializer.Hash(s), GameStateSerializer.Hash(back));
    }
}
