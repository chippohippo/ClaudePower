namespace UnbrokenAges.Tests;

public class DiplomacyTests
{
    private static CommandResult Do(GameState s, GameCommand c, List<GameEvent>? events = null) => CommandProcessor.Execute(s, c, events ?? new());

    [Fact]
    public void SurpriseWar_CostsMoreThanAFormalOne_AndStirsTheWorld()
    {
        var s = TestWorld.Blank(players: 3, leaders: new[] { "LEADER_THUTMOSE", "LEADER_DANDOLO", "LEADER_TAIZU_SONG" });
        var events = new List<GameEvent>();
        Assert.True(Do(s, new DeclareWarCommand { Player = 0, Target = 1 }, events).Ok);
        Assert.True(DiplomacySystem.AtWar(s, 0, 1));
        Assert.Equal(Fx.FromInt(40), DiplomacySystem.GrievanceTotal(s, 1, 0));   // surprise war
        Assert.Equal(Fx.FromInt(10), DiplomacySystem.GrievanceTotal(s, 2, 0));   // witnessed warmongering
        Assert.Equal(Fx.FromInt(10), s.World.Strife);
        Assert.Contains(s.Chronicle, c => c.Text.EndsWith("Egypt declares war on Venice."));
        Assert.Equal("Already at war.", new DeclareWarCommand { Player = 0, Target = 1 }.Validate(s));

        Assert.True(Do(s, new DenounceCommand { Player = 2, Target = 1 }).Ok);
        s.Turn += DiplomacySystem.DenounceWarningTurns;
        Assert.True(Do(s, new DeclareWarCommand { Player = 2, Target = 1 }).Ok);
        Assert.Equal(Fx.FromInt(15), DiplomacySystem.GrievanceTotal(s, 1, 2) - 5);  // formal war (+5 from the denunciation)
    }

    [Fact]
    public void NoSurpriseWars_Option_RequiresADenunciationFirst()
    {
        var s = TestWorld.Blank();
        s.Options.NoSurpriseWars = true;
        Assert.StartsWith("This game forbids surprise wars", new DeclareWarCommand { Player = 0, Target = 1 }.Validate(s));
        Do(s, new DenounceCommand { Player = 0, Target = 1 });
        Assert.NotNull(new DeclareWarCommand { Player = 0, Target = 1 }.Validate(s));
        s.Turn += 5;
        Assert.Null(new DeclareWarCommand { Player = 0, Target = 1 }.Validate(s));
    }

    [Fact]
    public void Peace_NeedsBothSides_AndAMinimumWar_ThenSendsArmiesHome()
    {
        var s = TestWorld.Blank(width: 30, height: 20);
        var home = TestWorld.City(s, 0, 4, 10);
        var enemy = TestWorld.City(s, 1, 20, 10);
        Do(s, new DeclareWarCommand { Player = 0, Target = 1 });
        var army = new UnitState { Id = s.AllocateId(), Owner = 0, DefIndex = s.Db.Units.IndexOf("UNIT_WARRIOR"), Tile = s.Map.Neighbor(enemy.Tile, HexCoord.W) };
        s.AddUnit(army);

        Assert.StartsWith("Peace is possible after", new ProposePeaceCommand { Player = 0, Target = 1 }.Validate(s));
        s.Turn += DiplomacySystem.MinWarTurns;
        Assert.True(Do(s, new ProposePeaceCommand { Player = 0, Target = 1 }).Ok);
        Assert.Equal("There is no peace offer from them.", new AcceptPeaceCommand { Player = 0, Target = 1 }.Validate(s));
        var events = new List<GameEvent>();
        Assert.True(Do(s, new AcceptPeaceCommand { Player = 1, Target = 0 }, events).Ok);
        Assert.False(DiplomacySystem.AtWar(s, 0, 1));
        Assert.Equal(home.Tile, army.Tile);
        Assert.Contains(events, e => e.Type == GameEventType.PeaceSigned);
        Assert.StartsWith("A peace treaty binds you", new DeclareWarCommand { Player = 0, Target = 1 }.Validate(s));
    }

    [Fact]
    public void ClosedBorders_StopArmies_UnlessAtWarOrGrantedPassage()
    {
        var s = TestWorld.Blank(width: 30, height: 20);
        TestWorld.City(s, 0, 4, 10);
        var enemy = TestWorld.City(s, 1, 14, 10);
        var army = new UnitState { Id = s.AllocateId(), Owner = 0, DefIndex = s.Db.Units.IndexOf("UNIT_WARRIOR"), Tile = TestWorld.Tile(s, 10, 10), MovesLeft = 2 };
        s.AddUnit(army);
        int inside = s.Map.Neighbor(enemy.Tile, HexCoord.W);
        Assert.Null(Movement.FindPath(s, army, inside));
        Assert.True(Do(s, new SetOpenBordersCommand { Player = 1, Target = 0 }).Ok);
        Assert.NotNull(Movement.FindPath(s, army, inside));
        Assert.True(Do(s, new SetOpenBordersCommand { Player = 1, Target = 0, Open = false }).Ok);
        Assert.Null(Movement.FindPath(s, army, inside));
        Do(s, new DeclareWarCommand { Player = 0, Target = 1 });
        Assert.NotNull(Movement.FindPath(s, army, inside));
    }

    [Fact]
    public void Grievances_AreItemized_AndFade()
    {
        var s = TestWorld.Blank();
        DiplomacySystem.AddGrievance(s, 1, 0, 3, "Settled too close");
        DiplomacySystem.AddGrievance(s, 1, 0, 1, "Rude envoy");
        Assert.Equal(2, s.Grievances.Count);
        DiplomacySystem.ProcessTurn(s);
        Assert.Single(s.Grievances);
        Assert.Equal("Settled too close", s.Grievances[0].Reason);
        Assert.Equal(Fx.FromInt(2), DiplomacySystem.GrievanceTotal(s, 1, 0));
    }

    [Fact]
    public void Attitude_IsAVisibleSumOfNamedReasons()
    {
        var s = TestWorld.Blank(players: 2, leaders: new[] { "LEADER_TAIZU_SONG", "LEADER_THUTMOSE" });
        var baseline = DiplomacySystem.Attitude(s, 0, 1);
        Assert.Contains(baseline.Lines, l => l.Label.Contains("HighScience") && l.Value > 0);  // Taizu likes scholars (all tech here)
        Assert.Contains(baseline.Lines, l => l.Label.Contains("Peaceful") && l.Value > 0);

        Do(s, new DeclareWarCommand { Player = 1, Target = 0 });
        var war = DiplomacySystem.Attitude(s, 0, 1);
        Assert.Contains(war.Lines, l => l.Label == "At war" && l.Value == -20);
        Assert.Contains(war.Lines, l => l.Label == "Grievances" && l.Value == -8);              // 40 surprise-war points / 5
        Assert.Contains(war.Lines, l => l.Label.Contains("Warmonger") && l.Value < 0);
        Assert.True(war.Total < baseline.Total - 30);
    }

    [Fact]
    public void CulturalAnnexation_LeavesAGrievance()
    {
        var s = TestWorld.Blank();
        var events = new List<GameEvent> { new(GameEventType.CityFlipped, 1, 5, Value: 0, Detail: "Abydos") };
        DiplomacySystem.OnEvents(s, events, 0);
        Assert.Equal(Fx.FromInt(10), DiplomacySystem.GrievanceTotal(s, 0, 1));
    }

    [Fact]
    public void Teams_AndFreeCities_HaveFixedRelations()
    {
        var s = TestWorld.Blank(players: 3);
        s.Players[1].Team = s.Players[0].Team;
        Assert.Equal("Cannot declare war on a teammate.", new DeclareWarCommand { Player = 0, Target = 1 }.Validate(s));
        Assert.True(DiplomacySystem.MayEnter(s, 0, 1));
        int free = s.FreeCitiesPlayer!.Id;
        Assert.True(DiplomacySystem.AtWar(s, 0, free));
    }

    [Fact]
    public void Diplomacy_SurvivesSnapshots_AndTheAiMakesPeace()
    {
        var s = TestWorld.Blank();
        Do(s, new DeclareWarCommand { Player = 0, Target = 1 });
        s.Turn += DiplomacySystem.MinWarTurns;
        Do(s, new ProposePeaceCommand { Player = 0, Target = 1 });
        var back = GameStateSerializer.Deserialize(GameStateSerializer.Serialize(s), s.Db);
        Assert.Equal(GameStateSerializer.Hash(s), GameStateSerializer.Hash(back));
        Assert.Equal(0, back.Relations.Single().PeaceProposedBy);
        foreach (var cmd in new Sim.AI.SimpleAi().TakeTurn(back, 1)) CommandProcessor.Execute(back, cmd, new());
        Assert.False(DiplomacySystem.AtWar(back, 0, 1));
    }
}
