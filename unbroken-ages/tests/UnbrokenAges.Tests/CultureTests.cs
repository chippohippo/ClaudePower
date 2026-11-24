namespace UnbrokenAges.Tests;

/// <summary>Great works, slots, tourism, tourists and the Culture victory.</summary>
public class CultureTests
{
    private static (GameState S, CityState Capital, CityState Rival, CityState Third) World()
    {
        var s = TestWorld.Blank(width: 40, height: 20, players: 3);
        var capital = TestWorld.City(s, 0, 5, 10, population: 6);
        var rival = TestWorld.City(s, 1, 20, 10, population: 4);
        var third = TestWorld.City(s, 2, 34, 10, population: 4);
        return (s, capital, rival, third);
    }

    private static GreatPersonDef Person(GameState s, string id) => s.Db.GreatPeople[id];

    [Fact]
    public void Artists_CreateTheirNamedWorks_ProphetsLeaveRelics()
    {
        var (s, capital, _, _) = World();
        var events = new List<GameEvent>();
        GreatPeopleSystem.Recruit(s, s.Players[0], Person(s, "GREAT_PERSON_HOMER"), events);
        Assert.Equal(new[] { "The Iliad", "The Odyssey" }, s.GreatWorks.Select(g => g.Name));
        Assert.Equal(2, events.Count(e => e.Type == GameEventType.GreatWorkCreated));
        GreatPeopleSystem.Recruit(s, s.Players[0], Person(s, "GREAT_PERSON_LAOZI"), events);
        Assert.Contains(s.GreatWorks, g => g.Name == "Relic of Laozi" && g.Kind == 1);
        GreatPeopleSystem.Recruit(s, s.Players[0], Person(s, "GREAT_PERSON_IMHOTEP"), events);
        Assert.Equal(3, s.GreatWorks.Count);   // engineers make no works
        Assert.Equal(10, TestWorld.Db.GreatPeople.Count(g => g.Class == GreatPersonClass.Artist));
    }

    [Fact]
    public void Works_FillSlots_LargestCitiesFirst_TheRestWaitInStorage()
    {
        var (s, capital, _, _) = World();
        var second = TestWorld.City(s, 0, 5, 16, population: 2);
        Assert.Equal(1, CultureSystem.Slots(s, capital));   // the palace
        Assert.Equal(0, CultureSystem.Slots(s, second));
        GreatPeopleSystem.Recruit(s, s.Players[0], Person(s, "GREAT_PERSON_HOMER"), new());
        Assert.Single(CultureSystem.WorksIn(s, capital));
        Assert.Single(s.GreatWorks, g => g.CityId < 0);
        TestWorld.PlaceDistrict(s, second, "DISTRICT_CULTURAL_QUARTER", TestWorld.Tile(s, 6, 16), "BUILDING_AMPHITHEATER");
        CultureSystem.Place(s, 0);
        Assert.Single(CultureSystem.WorksIn(s, second));
        Assert.Contains(CityEffects.Compute(s, capital).Applied, a => a.Source == "Great works (1)" && a.Modifier.Amount == Fx.FromInt(CultureSystem.CulturePerWork));
    }

    [Fact]
    public void CapturedWorks_ChangeHandsWithTheirCity()
    {
        var (s, capital, rival, _) = World();
        GreatPeopleSystem.Recruit(s, s.Players[1], Person(s, "GREAT_PERSON_HOMER"), new());
        Assert.Equal(rival.Id, s.GreatWorks[0].CityId);
        CitySystem.ChangeOwner(s, rival, 0, new(), GameEventType.CityCaptured);
        CultureSystem.Place(s, 0);
        Assert.Equal(0, s.GreatWorks[0].Owner);
    }

    [Fact]
    public void Tourism_CountsWorksWondersAndNaturalWonders_AndGrowsLate()
    {
        var (s, capital, _, _) = World();
        var p = s.Players[0];
        GreatPeopleSystem.Recruit(s, p, Person(s, "GREAT_PERSON_HOMER"), new());   // one on display
        TestWorld.PlaceDistrict(s, capital, "WONDER_GREAT_LIBRARY", TestWorld.Tile(s, 6, 10));
        int uluru = s.Db.Features.IndexOf("FEATURE_ULURU");
        int tile = TestWorld.Tile(s, 4, 9);
        s.Map.Feature[tile] = (short)uluru;
        int era = s.PlayerEra(p);
        int expected = (CultureSystem.TourismPerWork + CultureSystem.TourismPerWonder + CultureSystem.TourismPerNaturalWonder) * (100 + CultureSystem.TourismPerEraPercent * Math.Max(0, era - 3)) / 100;
        Assert.Equal(expected, CultureSystem.Tourism(s, p));
        p.Age = AgeState.Golden;
        Assert.True(CultureSystem.Tourism(s, p) > expected);
    }

    [Fact]
    public void Tourists_AccumulateWithAffinity_AndCultureVictoryNeedsEveryRival()
    {
        var (s, capital, rival, third) = World();
        var p = s.Players[0];
        GreatPeopleSystem.Recruit(s, p, Person(s, "GREAT_PERSON_HOMER"), new());
        Assert.Equal(0, CultureSystem.Affinity(s, 0, 1));
        CommandProcessor.Execute(s, new SetOpenBordersCommand { Player = 1, Target = 0, Open = true }, new());
        Assert.Equal(25, CultureSystem.Affinity(s, 0, 1));

        CultureSystem.ProcessTurn(s, new());
        Assert.True(p.TourismTo[1] > p.TourismTo[2], "open borders carry more tourism");

        s.Players[1].LifetimeCulture = Fx.FromInt(100);   // 1 domestic tourist
        s.Players[2].LifetimeCulture = Fx.FromInt(100);
        p.TourismTo[1] = CultureSystem.TourismPerVisitor * 2;
        Assert.Equal(-1, CultureSystem.CultureWinner(s));
        p.TourismTo[2] = CultureSystem.TourismPerVisitor * 2;
        Assert.Equal(0, CultureSystem.CultureWinner(s));
        var events = new List<GameEvent>();
        VictorySystem.Check(s, events, endOfTurn: true);
        Assert.Equal(VictoryKind.Culture, s.Victory.Kind);
    }

    [Fact]
    public void LifetimeCulture_GrowsEachTurn()
    {
        var (s, _, _, _) = World();
        TurnProcessor.Advance(s);
        Assert.True(s.Players[0].LifetimeCulture > Fx.Zero);
    }

    [Fact]
    public void Works_AndTourists_SurviveASave()
    {
        var (s, _, _, _) = World();
        GreatPeopleSystem.Recruit(s, s.Players[0], Person(s, "GREAT_PERSON_HOMER"), new());
        CultureSystem.ProcessTurn(s, new());
        s.Players[0].LifetimeCulture = Fx.FromInt(777);
        var back = GameStateSerializer.Deserialize(GameStateSerializer.Serialize(s), s.Db);
        Assert.Equal(s.GreatWorks.Select(g => (g.Id, g.Name, g.Kind, g.Creator, g.Owner, g.CityId)),
                     back.GreatWorks.Select(g => (g.Id, g.Name, g.Kind, g.Creator, g.Owner, g.CityId)));
        Assert.Equal(s.Players[0].TourismTo, back.Players[0].TourismTo);
        Assert.Equal(Fx.FromInt(777), back.Players[0].LifetimeCulture);
        Assert.Equal(GameStateSerializer.Hash(s), GameStateSerializer.Hash(back));
    }
}
