namespace UnbrokenAges.Tests;

/// <summary>World Congress: favor, announcement, voting rules, tallies, effects, victory points, the Concord victory, saves.</summary>
public class CongressTests
{
    private static string? Run(GameState s, GameCommand cmd) => CommandProcessor.Execute(s, cmd, new()) is { Ok: false } r ? r.Error : null;

    private static (GameState S, CityState A, CityState B, CityState C) World()
    {
        var s = TestWorld.Blank(width: 40, height: 20, players: 3);
        var a = TestWorld.City(s, 0, 5, 10, population: 4);
        var b = TestWorld.City(s, 1, 20, 10, population: 4);
        var c = TestWorld.City(s, 2, 34, 10, population: 4);
        return (s, a, b, c);
    }

    /// <summary>Brings the Congress to its announcement (resolutions pending) with the given two kinds.</summary>
    private static void Announce(GameState s, params ResolutionKind[] kinds)
    {
        s.Turn = CongressSystem.FirstSessionTurn(s) - CongressSystem.Notice;
        CongressSystem.ProcessTurn(s, new());
        Assert.Equal(2, s.Congress.Pending.Count);
        s.Congress.Pending.Clear();
        foreach (var k in kinds) s.Congress.Pending.Add(new PendingResolutionState { Kind = k });
    }

    private static void Session(GameState s, List<GameEvent>? events = null)
    {
        s.Turn = s.Congress.NextSession;
        CongressSystem.ProcessTurn(s, events ?? new());
    }

    [Fact]
    public void Congress_AnnouncesTenTurnsAhead_AndFavorFlowsFromThen()
    {
        var (s, _, _, _) = World();
        s.Turn = 5;
        CongressSystem.ProcessTurn(s, new());
        Assert.Empty(s.Congress.Pending);
        Assert.Equal(0, s.Players[0].Favor);
        var events = new List<GameEvent>();
        s.Turn = CongressSystem.FirstSessionTurn(s) - CongressSystem.Notice;
        CongressSystem.ProcessTurn(s, events);
        Assert.Equal(2, s.Congress.Pending.Select(p => p.Kind).Distinct().Count());
        Assert.Contains(events, e => e.Type == GameEventType.CongressAnnounced);
        Assert.Equal(CongressSystem.FavorPerTurn(s, s.Players[0]), s.Players[0].Favor);
    }

    [Fact]
    public void Votes_AreValidated_AndExtraVotesCostRisingFavor()
    {
        var (s, _, _, _) = World();
        Announce(s, ResolutionKind.WorldsFair, ResolutionKind.ArmsControl);
        Assert.Equal(new[] { 10, 30, 60 }, new[] { 1, 2, 3 }.Select(CongressSystem.VoteCost));
        Assert.Equal("Choose a civilization.", Run(s, new VoteCommand { Player = 0, Resolution = 0, Option = 0, Target = -1 }));
        Assert.Equal("Choose A or B.", Run(s, new VoteCommand { Player = 0, Resolution = 1, Option = 2 }));
        Assert.Contains("favor needed", Run(s, new VoteCommand { Player = 0, Resolution = 1, Option = 0, Extra = 3 }));
        s.Players[0].Favor = 40;
        Assert.Null(Run(s, new VoteCommand { Player = 0, Resolution = 1, Option = 0, Extra = 2 }));   // 30
        Assert.Contains("favor needed", Run(s, new VoteCommand { Player = 0, Resolution = 0, Option = 0, Target = 0, Extra = 2 }));   // 30 + 30 > 40
        Assert.Null(Run(s, new VoteCommand { Player = 0, Resolution = 0, Option = 0, Target = 0, Extra = 1 }));         // 30 + 10 = 40
        Assert.Null(Run(s, new VoteCommand { Player = 0, Resolution = 1, Option = 1, Extra = 0 }));   // a changed mind replaces the vote
        Assert.Single(s.Congress.Pending[1].Votes);
    }

    [Fact]
    public void Tallies_DecideTheOptionAndTarget_AndTheResolutionTakesEffect()
    {
        var (s, a, b, c) = World();
        Announce(s, ResolutionKind.WorldsFair, ResolutionKind.ArmsControl);
        s.Players[1].Favor = 100;
        Run(s, new VoteCommand { Player = 0, Resolution = 0, Option = 1, Target = 1 });             // B on P1
        Run(s, new VoteCommand { Player = 2, Resolution = 0, Option = 1, Target = 1 });             // B on P1
        Run(s, new VoteCommand { Player = 1, Resolution = 0, Option = 0, Target = 1, Extra = 2 });  // A on itself, 3 votes
        Run(s, new VoteCommand { Player = 0, Resolution = 1, Option = 0 });
        var (votesA, votesB, winner, target) = CongressSystem.Tally(s, s.Congress.Pending[0]);
        Assert.Equal((3, 2, 0, 1), (votesA, votesB, winner, target));

        var events = new List<GameEvent>();
        Session(s, events);
        Assert.Equal(100 + CongressSystem.FavorPerTurn(s, s.Players[1]) - 30, s.Players[1].Favor);   // the session turn's favor, less 30 for two extra votes
        Assert.Equal(2, s.Congress.Active.Count);
        Assert.Contains(CityEffects.Compute(s, b).Applied, x => x.Source == "World Congress: World's Fair");
        Assert.DoesNotContain(CityEffects.Compute(s, a).Applied, x => x.Source == "World Congress: World's Fair");
        Assert.Contains(CityEffects.Compute(s, a).Applied, x => x.Source == "World Congress: Arms Control");   // global
        Assert.Equal(1, s.Players[1].DiplomaticPoints);   // carried the winning side alone with the most votes
        Assert.Contains(events, e => e.Type == GameEventType.ResolutionPassed);
        Assert.Equal(CongressSystem.FirstSessionTurn(s) + CongressSystem.SessionInterval(s), s.Congress.NextSession);
    }

    [Fact]
    public void Suzerainties_EarnPoints_AndTwentyPointsWinTheConcord()
    {
        var (s, _, _, _) = World();
        var db = s.Db;
        for (int i = 0; i < 3; i++)
        {
            var cs = new PlayerState
            {
                Id = s.Players.Count, Name = $"CS{i}", CityStateIndex = i, Team = -1, Suzerain = 2,
                Techs = new bool[db.Techs.Count], Civics = new bool[db.Civics.Count], Stockpile = new int[db.Resources.Count],
            };
            s.Players.Add(cs);
            CitySystem.Found(s, cs.Id, TestWorld.Tile(s, 8 + 10 * i, 17), cs.Name);
        }
        Announce(s, ResolutionKind.ArmsControl, ResolutionKind.ClimateAccord);
        Session(s);
        Assert.Equal(1, s.Players[2].DiplomaticPoints);
        Assert.Equal(-1, CongressSystem.ConcordWinner(s));
        s.Players[2].DiplomaticPoints = CongressSystem.VictoryPoints;
        VictorySystem.Check(s, new(), endOfTurn: true);
        Assert.Equal(VictoryKind.Concord, s.Victory.Kind);
        Assert.Equal(2, s.Victory.Winner);
    }

    [Fact]
    public void Congress_SurvivesASave_AndTheVoteCommandRoundTrips()
    {
        var (s, _, _, _) = World();
        Announce(s, ResolutionKind.TradeCharter, ResolutionKind.ClimateAccord);
        s.Players[0].Favor = 50;
        Run(s, new VoteCommand { Player = 0, Resolution = 0, Option = 1, Target = 2, Extra = 1 });
        s.Congress.Active.Add(new ActiveResolutionState { Kind = ResolutionKind.SovereigntyPact, Option = 0, Target = 1 });
        s.Players[1].DiplomaticPoints = 7;
        var back = GameStateSerializer.Deserialize(GameStateSerializer.Serialize(s), s.Db);
        Assert.Equal(s.Congress.NextSession, back.Congress.NextSession);
        Assert.Equal(s.Congress.Pending.Select(p => p.Kind), back.Congress.Pending.Select(p => p.Kind));
        var v = Assert.Single(back.Congress.Pending[0].Votes);
        Assert.Equal((0, 1, 2, 1), (v.Player, v.Option, v.Target, v.Extra));
        Assert.Equal(ResolutionKind.SovereigntyPact, Assert.Single(back.Congress.Active).Kind);
        Assert.Equal((50, 7), (back.Players[0].Favor, back.Players[1].DiplomaticPoints));
        Assert.Equal(GameStateSerializer.Hash(s), GameStateSerializer.Hash(back));
        var cmd = new VoteCommand { Player = 1, Resolution = 1, Option = 0, Target = 2, Extra = 3 };
        Assert.Equal(cmd.Serialize(), GameCommand.Deserialize(cmd.Serialize()).Serialize());
    }
}
