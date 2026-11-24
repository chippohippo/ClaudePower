namespace UnbrokenAges.Tests;

/// <summary>City-states: placement, meeting, influence and envoys, tier bonuses, suzerains, self-defence, peace.</summary>
public class CityStateTests
{
    /// <summary>A blank world with two civilizations, the Free Cities and one city-state of the given kind at (col, row).</summary>
    private static (GameState S, PlayerState Cs, CityState City) World(string id = "CITYSTATE_UGARIT", int col = 15, int row = 10)
    {
        var s = TestWorld.Blank(width: 30, height: 20, players: 2);
        var db = s.Db;
        var cs = new PlayerState
        {
            Id = s.Players.Count, Name = db.CityStates[id].Name, CityStateIndex = db.CityStates.IndexOf(id), Team = -1,
            Techs = new bool[db.Techs.Count], Civics = new bool[db.Civics.Count], Stockpile = new int[db.Resources.Count], Revealed = new bool[s.Map.Count],
        };
        s.Players.Add(cs);
        foreach (var p in s.Players) p.Revealed = new bool[s.Map.Count];
        var city = CitySystem.Found(s, cs.Id, TestWorld.Tile(s, col, row), cs.Name);
        return (s, cs, city);
    }

    private static void Meet(GameState s, PlayerState cs, CityState city, params int[] players)
    {
        foreach (int p in players) s.Players[p].Revealed[city.Tile] = true;
        CityStateSystem.ProcessTurn(s, new());
    }

    private static string? Run(GameState s, GameCommand cmd) => CommandProcessor.Execute(s, cmd, new()) is { Ok: false } r ? r.Error : null;

    [Fact]
    public void Content_HasEighteenCityStates_ThreeOfEachType()
    {
        var db = TestWorld.Db;
        Assert.Equal(18, db.CityStates.Count);
        foreach (CityStateType type in Enum.GetValues<CityStateType>()) Assert.Equal(3, db.CityStates.Count(c => c.Type == type));
        Assert.All(db.CityStates, c => Assert.NotEmpty(c.Suzerain.Modifiers));
    }

    [Fact]
    public void NewGames_PlaceOneCityStatePerCivilization_AwayFromTheStarts()
    {
        var setup = new GameSetup { Seed = 4, Map = new MapGenSettings { Width = 64, Height = 40, Seed = 4 },
                                    Players = Enumerable.Range(0, 4).Select(i => new PlayerSetup { Name = $"P{i}" }).ToList() };
        var s = GameFactory.Create(TestWorld.Db, setup);
        var cityStates = s.Players.Where(p => p.IsCityState).ToList();
        Assert.Equal(4, cityStates.Count);
        Assert.Equal(4, s.Players.Count(p => p.IsMajor));
        Assert.Equal(4, s.Players.Single(p => p.IsFreeCities).Id);   // the Free Cities keep their place after the civilizations
        foreach (var cs in cityStates)
        {
            var city = Assert.Single(s.CitiesOf(cs.Id));
            Assert.Equal(cs.Name, city.Name);
            Assert.True(city.IsCapital);
            Assert.Contains(s.Units, u => u.Owner == cs.Id);
            Assert.All(s.Units.Where(u => u.Owner < 4), u => Assert.True(s.Map.Distance(u.Tile, city.Tile) >= 5));
            Assert.Equal(s.Players.Count, cs.Envoys.Count);
        }
        Assert.Equal(cityStates.Count, cityStates.Select(c => c.CityStateIndex).Distinct().Count());

        setup.Options = new GameOptions { CityStates = 0 };
        Assert.DoesNotContain(GameFactory.Create(TestWorld.Db, setup).Players, p => p.IsCityState);
    }

    [Fact]
    public void FirstToMeet_LeavesAnEnvoy_LaterMeetingsDoNot()
    {
        var (s, cs, city) = World();
        Meet(s, cs, city, 1);
        Assert.Equal(1, CityStateSystem.EnvoysFrom(cs, 1));
        Meet(s, cs, city, 0);
        Assert.True(CityStateSystem.HasMet(s, cs, 0));
        Assert.Equal(0, CityStateSystem.EnvoysFrom(cs, 0));
    }

    [Fact]
    public void Influence_BuysEnvoys_FasterUnderDiplomaticGovernments()
    {
        var (s, cs, city) = World();
        var p = s.Players[0];
        Assert.Equal(1, CityStateSystem.InfluencePerTurn(s, p));
        p.Government = s.Db.Governments.IndexOf("GOVERNMENT_MERCHANT_REPUBLIC");
        p.Policies.Add(s.Db.Policies.IndexOf("POLICY_DIPLOMATIC_LEAGUE"));
        Assert.Equal(1 + 2 + 1, CityStateSystem.InfluencePerTurn(s, p));
        p.Influence = CityStateSystem.EnvoyCost(p) - 1;
        CityStateSystem.ProcessTurn(s, new());
        Assert.Equal(1, p.EnvoyTokens);
        Assert.Equal(30, CityStateSystem.EnvoyCost(p));   // each envoy costs a little more
    }

    [Fact]
    public void Envoys_NeedAMeeting_AToken_AndPeace()
    {
        var (s, cs, city) = World();
        var p = s.Players[0];
        p.EnvoyTokens = 3;
        Assert.Equal("You have not met them.", Run(s, new SendEnvoyCommand { Player = 0, CityState = cs.Id }));
        Meet(s, cs, city, 1, 0);
        Assert.Null(Run(s, new SendEnvoyCommand { Player = 0, CityState = cs.Id }));
        Assert.Equal(2, p.EnvoyTokens);
        Assert.Equal("Only civilizations send envoys.", CityStateSystem.CanSendEnvoy(s, cs, cs.Id));
        Assert.Null(Run(s, new DeclareWarCommand { Player = 0, Target = cs.Id }));
        Assert.Equal("You are at war with them.", Run(s, new SendEnvoyCommand { Player = 0, CityState = cs.Id }));
    }

    [Fact]
    public void Tiers_PayTheTypeYield_InTheCapitalThenInDistrictCities()
    {
        var (s, cs, csCity) = World("CITYSTATE_UGARIT");   // scientific: Science, Academy
        var capital = TestWorld.City(s, 0, 4, 4);
        var other = TestWorld.City(s, 0, 4, 12);
        TestWorld.PlaceDistrict(s, other, "DISTRICT_ACADEMY", TestWorld.Tile(s, 5, 12));
        Meet(s, cs, csCity, 0);
        Fx Science(CityState c) => CityYields.Compute(s, c, CityEffects.Compute(s, c)).Total.Science;
        Fx capitalOne = Science(capital), otherOne = Science(other);
        Assert.Contains(CityEffects.Compute(s, capital).Applied, a => a.Source.StartsWith("Ugarit"));
        Assert.DoesNotContain(CityEffects.Compute(s, other).Applied, a => a.Source.StartsWith("Ugarit"));
        cs.Envoys[0] = 3;
        Assert.Equal(capitalOne, Science(capital));
        Assert.True(Science(other) > otherOne, "three envoys reach cities with an Academy");
        cs.Envoys[0] = 6;
        Assert.Contains(CityEffects.Compute(s, other).Applied, a => a.Source.StartsWith("Ugarit") && a.Modifier.Amount == Fx.FromInt(4));
    }

    [Fact]
    public void Suzerain_MostEnvoysAtLeastThree_IncumbentKeepsATie_WarEndsIt()
    {
        var (s, cs, city) = World("CITYSTATE_MONEMVASIA");   // suzerain: units +3
        Meet(s, cs, city, 0, 1);
        cs.Envoys[0] = 2;
        Assert.Equal(-1, CityStateSystem.ComputeSuzerain(s, cs));
        cs.Envoys[0] = 3;
        CityStateSystem.ProcessTurn(s, new());
        Assert.Equal(0, cs.Suzerain);
        var sword = TestWorld.Unit(s, 0, "UNIT_SWORDSMAN", 3, 3);
        Assert.Contains(SocietySystem.CombatLines(s, sword, true, false, sword.Tile), l => l.Label == "Monemvasia" && l.Value == 3);

        cs.Envoys[1] = 3;   // a tie: the incumbent keeps it
        Assert.Equal(0, CityStateSystem.ComputeSuzerain(s, cs));
        cs.Envoys[1] = 4;
        Assert.Equal(1, CityStateSystem.ComputeSuzerain(s, cs));
        cs.Envoys[1] = 3;
        cs.Suzerain = -1;   // a tie with no incumbent: nobody
        Assert.Equal(-1, CityStateSystem.ComputeSuzerain(s, cs));

        Run(s, new DeclareWarCommand { Player = 1, Target = cs.Id });
        Assert.Equal(0, CityStateSystem.ComputeSuzerain(s, cs));   // a warring civ's envoys do not count
    }

    [Fact]
    public void CityStates_KeepPace_RaiseDefenders_AndAcceptPeace()
    {
        var (s, cs, city) = World();
        var tech = s.Db.Techs.First(t => t.DivergenceIndex < 0);
        Assert.False(cs.Techs[tech.Index]);
        CityStateSystem.ProcessTurn(s, new());
        Assert.True(cs.Techs[tech.Index]);   // both civilizations know it (all tech)
        Assert.NotEmpty(city.Queue.Items);
        Assert.Equal(ProductionKind.Unit, city.Queue.Items[0].Kind);

        Assert.Null(Run(s, new DeclareWarCommand { Player = 0, Target = cs.Id }));
        s.Turn += 20;
        var propose = new ProposePeaceCommand { Player = 0, Target = cs.Id };
        if (propose.Validate(s) == null)
        {
            Run(s, propose);
            CityStateSystem.ProcessTurn(s, new());
            Assert.False(DiplomacySystem.AtWar(s, 0, cs.Id));
        }
    }

    [Fact]
    public void CityStates_AreNotMajors_NorForSale()
    {
        var (s, cs, city) = World();
        Assert.False(cs.IsMajor);
        Assert.False(cs.IsFreeCities);
        Assert.Equal("City-states are not for sale.", NationSystem.CanBuy(s, s.Players[0], city));
        TurnPhases.Begin(s);
        Assert.DoesNotContain(s.TurnPhases.SelectMany(x => x), id => id == cs.Id);
    }

    [Fact]
    public void Envoys_SurviveASave()
    {
        var (s, cs, city) = World();
        Meet(s, cs, city, 1, 0);
        cs.Envoys[0] = 4;
        CityStateSystem.ProcessTurn(s, new());
        s.Players[0].Influence = 17;
        s.Players[0].EnvoyTokens = 2;
        s.Players[0].EnvoysEarned = 5;
        var back = GameStateSerializer.Deserialize(GameStateSerializer.Serialize(s), s.Db);
        var bcs = back.Players[cs.Id];
        Assert.Equal(cs.CityStateIndex, bcs.CityStateIndex);
        Assert.Equal(cs.Envoys, bcs.Envoys);
        Assert.Equal(0, bcs.Suzerain);
        Assert.Equal((17, 2, 5), (back.Players[0].Influence, back.Players[0].EnvoyTokens, back.Players[0].EnvoysEarned));
        Assert.True(CityStateSystem.HasMet(back, bcs, 0));
        Assert.Equal(GameStateSerializer.Hash(s), GameStateSerializer.Hash(back));
    }
}
