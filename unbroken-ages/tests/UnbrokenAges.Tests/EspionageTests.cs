namespace UnbrokenAges.Tests;

/// <summary>Espionage: capacity and recruiting, orders, odds and defences, every mission's effect, capture, saves.</summary>
public class EspionageTests
{
    private static string? Run(GameState s, GameCommand cmd) => CommandProcessor.Execute(s, cmd, new()) is { Ok: false } r ? r.Error : null;

    private static (GameState S, CityState Mine, CityState Theirs, SpyState Spy) World()
    {
        var s = TestWorld.Blank(width: 30, height: 20, players: 2);
        foreach (var p in s.Players) p.Revealed = Enumerable.Repeat(true, s.Map.Count).ToArray();
        var mine = TestWorld.City(s, 0, 5, 10, population: 3);
        var theirs = TestWorld.City(s, 1, 20, 10, population: 6);
        EspionageSystem.ProcessTurn(s, new());   // recruits up to capacity
        return (s, mine, theirs, s.Players[0].Spies[0]);
    }

    /// <summary>Runs the mission to completion with the given (forced) odds.</summary>
    private static List<GameEvent> Finish(GameState s, SpyState spy)
    {
        var events = new List<GameEvent>();
        for (int i = 0; i < 40 && spy.Mission != SpyMission.None && s.Players[0].Spies.Contains(spy); i++)
        {
            EspionageSystem.ProcessTurn(s, events);
            s.Turn++;
        }
        return events;
    }

    [Fact]
    public void Capacity_ComesFromCivics_AndSpiesAreRecruitedWithUniqueNames()
    {
        var (s, _, _, _) = World();
        var p = s.Players[0];
        Assert.Equal(3, EspionageSystem.Capacity(s, p));   // all three civics known
        Assert.Equal(3, p.Spies.Count);
        Assert.Equal(3, p.Spies.Select(x => x.Name).Distinct().Count());
        Assert.All(p.Spies, x => Assert.Equal(SpyMission.None, x.Mission));
        p.Civics[s.Db.Civics.IndexOf("CIVIC_URBANIZATION")] = false;
        Assert.Equal(2, EspionageSystem.Capacity(s, p));
    }

    [Fact]
    public void Orders_AreValidated()
    {
        var (s, mine, theirs, spy) = World();
        Assert.Equal("That is your own city.", EspionageSystem.CanAssign(s, s.Players[0], spy.Id, mine.Id, SpyMission.SiphonFunds));
        Assert.Equal("Counterintelligence guards your own cities.", EspionageSystem.CanAssign(s, s.Players[0], spy.Id, theirs.Id, SpyMission.Counterintelligence));
        Assert.Equal("Scandals are fabricated in city-states.", EspionageSystem.CanAssign(s, s.Players[0], spy.Id, theirs.Id, SpyMission.FabricateScandal));
        Assert.Equal("They know nothing you do not.", EspionageSystem.CanAssign(s, s.Players[0], spy.Id, theirs.Id, SpyMission.StealTechnology));
        Assert.Equal("Nothing is being built there.", EspionageSystem.CanAssign(s, s.Players[0], spy.Id, theirs.Id, SpyMission.SabotageProduction));
        Assert.Null(Run(s, new AssignSpyCommand { Player = 0, SpyId = spy.Id, CityId = theirs.Id, Mission = SpyMission.SiphonFunds }));
        Assert.True(spy.TurnsLeft >= 2 + EspionageSystem.Info(SpyMission.SiphonFunds).Turns);   // travel first
        var other = s.Players[0].Spies[1];
        Assert.Equal("Another of your spies is already on it.", EspionageSystem.CanAssign(s, s.Players[0], other.Id, theirs.Id, SpyMission.SiphonFunds));
        Assert.Null(Run(s, new AssignSpyCommand { Player = 0, SpyId = spy.Id, Mission = SpyMission.None }));
        Assert.Equal(-1, spy.CityId);
    }

    [Fact]
    public void Defences_LowerTheOdds()
    {
        var (s, mine, theirs, spy) = World();
        spy.Mission = SpyMission.SiphonFunds;
        int open = EspionageSystem.SuccessChance(s, spy, theirs);
        Assert.Equal(EspionageSystem.Info(SpyMission.SiphonFunds).BaseChance, open);
        var guard = new SpyState { Id = 999, Name = "Guard", Level = 2, CityId = theirs.Id, Mission = SpyMission.Counterintelligence };
        s.Players[1].Spies.Add(guard);
        Assert.Equal(3, EspionageSystem.Defence(s, theirs));
        Assert.Equal(open - 36, EspionageSystem.SuccessChance(s, spy, theirs));
        spy.Level = 3;
        Assert.Equal(open - 36 + 30, EspionageSystem.SuccessChance(s, spy, theirs));
    }

    [Fact]
    public void Siphon_MovesGold_AndPromotesTheSpy_OrTheSpyIsCaught()
    {
        // Over many seeds both outcomes occur; whichever happens must be consistent.
        int successes = 0, caught = 0;
        for (int turn = 1; turn <= 30; turn++)
        {
            var (s, _, theirs, spy) = World();
            s.Turn = turn;
            s.Players[1].Gold = Fx.FromInt(500);
            Assert.Null(Run(s, new AssignSpyCommand { Player = 0, SpyId = spy.Id, CityId = theirs.Id, Mission = SpyMission.SiphonFunds }));
            Fx before = s.Players[0].Gold;
            var events = Finish(s, spy);
            if (events.Any(e => e.Type == GameEventType.SpyMissionSucceeded))
            {
                successes++;
                Fx gained = s.Players[0].Gold - before;
                Assert.True(gained > Fx.Zero);
                Assert.Equal(Fx.FromInt(500) - gained, s.Players[1].Gold);   // taken from their treasury, not conjured
                Assert.Equal(1, spy.Level);
            }
            else if (events.Any(e => e.Type == GameEventType.SpyCaught))
            {
                caught++;
                Assert.DoesNotContain(spy, s.Players[0].Spies);
                Assert.True(DiplomacySystem.GrievanceTotal(s, 1, 0) > Fx.Zero);
            }
        }
        Assert.True(successes > 0 && caught > 0, $"successes {successes}, caught {caught}");
    }

    [Fact]
    public void EveryMission_DoesWhatItSays()
    {
        var (s0, _, theirs0, spy0) = World();
        var tech = s0.Db.Techs.First(t => t.DivergenceIndex < 0);
        s0.Players[0].Techs[tech.Index] = false;
        var s = Succeed(s0, spy0.Id, theirs0.Id, SpyMission.StealTechnology);
        Assert.True(s.Players[0].TechProgress > s0.Players[0].TechProgress);

        s0.GetCity(theirs0.Id)!.Loyalty = Fx.FromInt(100);
        s = Succeed(s0, spy0.Id, theirs0.Id, SpyMission.InciteUnrest);
        Assert.Equal(Fx.FromInt(70), s.GetCity(theirs0.Id)!.Loyalty);

        ProductionSystem.Enqueue(s0, theirs0, ProductionKind.Unit, s0.Db.Units.IndexOf("UNIT_WARRIOR"), -1, -1, false);
        var item = theirs0.Queue.Items[0];
        theirs0.ProgressLedger[item.ProgressKey] = Fx.FromInt(20);
        s = Succeed(s0, spy0.Id, theirs0.Id, SpyMission.SabotageProduction);
        Assert.Equal(Fx.FromInt(10), s.GetCity(theirs0.Id)!.ProgressLedger[item.ProgressKey]);
    }

    /// <summary>
    /// Runs the mission on copies of the state, one turn number after another, until the hashed roll succeeds (a Master Spy
    /// against an undefended city: 85%+), and returns that copy.
    /// </summary>
    private static GameState Succeed(GameState original, int spyId, int cityId, SpyMission mission)
    {
        var bytes = GameStateSerializer.Serialize(original);
        for (int turn = 1; turn < 200; turn++)
        {
            var s = GameStateSerializer.Deserialize(bytes, original.Db);
            s.Turn = turn;
            var spy = EspionageSystem.Find(s.Players[0], spyId)!;
            spy.Level = 3;
            Assert.Null(Run(s, new AssignSpyCommand { Player = 0, SpyId = spyId, CityId = cityId, Mission = mission }));
            spy.TurnsLeft = 1;
            var events = new List<GameEvent>();
            EspionageSystem.ProcessTurn(s, events);
            if (events.Any(e => e.Type == GameEventType.SpyMissionSucceeded)) return s;
        }
        throw new Xunit.Sdk.XunitException("no success in 200 tries");
    }

    [Fact]
    public void Scandals_CostTheSuzerainTwoEnvoys()
    {
        var (s, _, _, spy) = World();
        var db = s.Db;
        var cs = new PlayerState
        {
            Id = s.Players.Count, Name = "Kilwa", CityStateIndex = db.CityStates.IndexOf("CITYSTATE_KILWA"), Team = -1,
            Techs = new bool[db.Techs.Count], Civics = new bool[db.Civics.Count], Stockpile = new int[db.Resources.Count],
        };
        s.Players.Add(cs);
        var kilwa = CitySystem.Found(s, cs.Id, TestWorld.Tile(s, 12, 16), "Kilwa");
        foreach (var p in s.Players) p.Revealed = Enumerable.Repeat(true, s.Map.Count).ToArray();
        cs.Envoys = new List<int> { 1, 4, 0, 0 };
        cs.Suzerain = 1;
        var after = Succeed(s, spy.Id, kilwa.Id, SpyMission.FabricateScandal);
        Assert.Equal(2, after.Players[cs.Id].Envoys[1]);
        Assert.Equal(-1, after.Players[cs.Id].Suzerain);
    }

    [Fact]
    public void Spies_SurviveASave_AndTheCommandRoundTrips()
    {
        var (s, _, theirs, spy) = World();
        Run(s, new AssignSpyCommand { Player = 0, SpyId = spy.Id, CityId = theirs.Id, Mission = SpyMission.InciteUnrest });
        spy.Level = 2;
        var back = GameStateSerializer.Deserialize(GameStateSerializer.Serialize(s), s.Db);
        var b = back.Players[0].Spies[0];
        Assert.Equal((spy.Id, spy.Name, spy.Level, spy.CityId, spy.Mission, spy.TurnsLeft), (b.Id, b.Name, b.Level, b.CityId, b.Mission, b.TurnsLeft));
        Assert.Equal(GameStateSerializer.Hash(s), GameStateSerializer.Hash(back));
        var cmd = new AssignSpyCommand { Player = 1, SpyId = 5, CityId = 7, Mission = SpyMission.FabricateScandal };
        Assert.Equal(cmd.Serialize(), GameCommand.Deserialize(cmd.Serialize()).Serialize());
    }
}
