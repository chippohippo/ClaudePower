using UnbrokenAges.Sim.AI;

namespace UnbrokenAges.Tests;

public class DilemmaTests
{
    private static CommandResult Do(GameState s, GameCommand c, List<GameEvent>? events = null) => CommandProcessor.Execute(s, c, events ?? new());

    private static void Pose(GameState s, int player, string id, int city, int other = -1) =>
        s.Players[player].Dilemma = new PendingDilemmaState { Def = s.Db.Dilemmas.IndexOf(id), CityId = city, Other = other, Deadline = s.Turn + DilemmaSystem.AnswerTurns };

    [Fact]
    public void Content_Loads_AndEveryFirstAnswerIsFree()
    {
        Assert.True(TestWorld.Db.Dilemmas.Count >= 15);
        foreach (var d in TestWorld.Db.Dilemmas)
        {
            var first = d.Options[0];
            Assert.True(first.Gold >= 0 && first.Faith >= 0 && first.Favor >= 0, d.Id);
        }
    }

    [Fact]
    public void AnAnswer_PaysItsPrice_AndItsModifiersLastTheirTurns()
    {
        var s = TestWorld.Blank(players: 2);
        var city = TestWorld.City(s, 0, 5, 5, population: 9);
        var p = s.Players[0];
        Pose(s, 0, "DILEMMA_GRAIN_HOARDERS", city.Id);
        Assert.Equal("It costs 50 gold.", new ResolveDilemmaCommand { Player = 0, Option = 1 }.Validate(s));
        p.Gold = 100;
        city.Loyalty = 50;
        int amenities = CityYields.Compute(s, city).AmenitiesAvailable;
        var events = new List<GameEvent>();
        Assert.True(Do(s, new ResolveDilemmaCommand { Player = 0, Option = 1 }, events).Ok);
        Assert.Null(p.Dilemma);
        Assert.Equal(Fx.FromInt(50), p.Gold);
        Assert.Equal(Fx.FromInt(60), city.Loyalty);
        Assert.Equal(amenities + 1, CityYields.Compute(s, city).AmenitiesAvailable);
        Assert.Contains(events, e => e.Type == GameEventType.DilemmaResolved);
        Assert.Contains(s.Chronicle, c => c.Text.Contains("Open the state granaries"));
        for (int t = 0; t < 10; t++) DilemmaSystem.ProcessTurn(s, new());
        Assert.Empty(p.TimedEffects);
        Assert.Equal(amenities, CityYields.Compute(s, city).AmenitiesAvailable);
    }

    [Fact]
    public void Unanswered_TheCouncilTakesTheFirstAnswer()
    {
        var s = TestWorld.Blank(players: 2);
        var city = TestWorld.City(s, 0, 5, 5);
        TestWorld.City(s, 1, 12, 5);
        Pose(s, 0, "DILEMMA_REFUGEES", city.Id, other: 1);
        s.Turn += DilemmaSystem.AnswerTurns;
        DilemmaSystem.ProcessTurn(s, new());
        Assert.Null(s.Players[0].Dilemma);
        Assert.Equal(Fx.FromInt(10), DiplomacySystem.GrievanceTotal(s, 1, 0));   // turned away
    }

    [Fact]
    public void Dilemmas_ArisePeriodically_FromCircumstances_AndNeverRepeat()
    {
        var s = TestWorld.Blank(players: 1);
        TestWorld.City(s, 0, 5, 5, population: 10);
        var p = s.Players[0];
        var seen = new HashSet<int>();
        for (int t = 0; t < 600; t++)
        {
            s.Turn = DilemmaSystem.FirstTurn + t;
            var events = new List<GameEvent>();
            DilemmaSystem.ProcessTurn(s, events);
            if (events.FirstOrDefault(e => e.Type == GameEventType.DilemmaPresented) is { Type: GameEventType.DilemmaPresented } e)
            {
                Assert.True(seen.Add(e.Def));
                var def = s.Db.Dilemmas[e.Def];
                Assert.True(DilemmaSystem.Where(s, p, def.Trigger) != null);
                Do(s, new ResolveDilemmaCommand { Player = 0, Option = DiplomacyAi.PreferredAnswer(s, p) });
            }
        }
        Assert.True(seen.Count >= 3);
        Assert.DoesNotContain(seen, d => s.Db.Dilemmas[d].Trigger is DilemmaTrigger.AtWar or DilemmaTrigger.Neighbour);
    }

    [Fact]
    public void AI_PrefersTheCheaperAnswer_WhenLoyaltyIsSafe()
    {
        var s = TestWorld.Blank(players: 1);
        var city = TestWorld.City(s, 0, 5, 5, population: 4);
        s.Players[0].Gold = 1000;
        Pose(s, 0, "DILEMMA_NOTABLES", city.Id);
        Assert.Equal(0, DiplomacyAi.PreferredAnswer(s, s.Players[0]));   // loyal city: no need to buy the notables
        city.Loyalty = 30;
        Assert.Equal(1, DiplomacyAi.PreferredAnswer(s, s.Players[0]));
    }

    [Fact]
    public void PendingDilemmas_AndTheirEffects_SurviveSnapshots()
    {
        var s = TestWorld.Blank(players: 1);
        var city = TestWorld.City(s, 0, 5, 5);
        Pose(s, 0, "DILEMMA_RIVER_LEVEES", city.Id);
        s.Players[0].DilemmasSeen.Add(3);
        s.Players[0].TimedEffects.Add(new TimedEffectState { Dilemma = 1, Option = 1, CityId = city.Id, TurnsLeft = 4 });
        var copy = GameStateSerializer.Deserialize(GameStateSerializer.Serialize(s), s.Db);
        Assert.Equal(GameStateSerializer.Hash(s), GameStateSerializer.Hash(copy));
        Assert.NotNull(copy.Players[0].Dilemma);
    }
}
