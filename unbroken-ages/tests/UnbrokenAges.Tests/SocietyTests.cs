using UnbrokenAges.Sim.Systems.Districts;

namespace UnbrokenAges.Tests;

/// <summary>Society: governments and cards, religion, great people, ages, promotions, barbarians, wonders, war weariness.</summary>
public class SocietyTests
{
    private static GameState World(int width = 30, int players = 2) => TestWorld.Blank(width: width, height: 20, players: players);
    private static int Gov(GameState s, string id) => s.Db.Governments.IndexOf(id);
    private static int Card(GameState s, string id) => s.Db.Policies.IndexOf(id);
    private static int Belief(GameState s, string id) => s.Db.Beliefs.IndexOf(id);

    private static string? Run(GameState s, GameCommand cmd, List<GameEvent>? events = null)
    {
        var r = CommandProcessor.Execute(s, cmd, events ?? new());
        return r.Ok ? null : r.Error;
    }

    // ----- Content -------------------------------------------------------------------------------------

    [Fact]
    public void Content_HasTheStaples()
    {
        var db = TestWorld.Db;
        Assert.True(db.Governments.Count >= 10);
        Assert.True(db.Policies.Count >= 20);
        foreach (PolicySlot slot in Enum.GetValues<PolicySlot>()) Assert.Contains(db.Policies, c => c.Slot == slot);
        foreach (BeliefKind kind in Enum.GetValues<BeliefKind>()) Assert.True(db.Beliefs.Count(b => b.Kind == kind) >= 5, kind.ToString());
        foreach (GreatPersonClass cls in Enum.GetValues<GreatPersonClass>()) Assert.Contains(db.GreatPeople, g => g.Class == cls);
        Assert.True(db.Districts.Count(d => d.Category == DistrictCategory.Wonder) >= 12);
        Assert.True(db.Features.Count(f => f.NaturalWonder) >= 8);
        Assert.All(db.Districts.Where(d => d.Category == DistrictCategory.Wonder), w => Assert.False(string.IsNullOrEmpty(w.Model)));
        Assert.All(db.Features.Where(f => f.NaturalWonder), f => Assert.False(string.IsNullOrEmpty(f.Model)));
        Assert.Single(db.Governments, g => g.PrereqCivicIndex < 0);   // Chiefdom is the one you start with
    }

    [Fact]
    public void NewGames_StartInChiefdom_WithAFreeSwap()
    {
        var setup = new GameSetup { Seed = 5, Map = new MapGenSettings { Width = 40, Height = 26, Seed = 5 },
                                    Players = new() { new PlayerSetup { Name = "A" }, new PlayerSetup { Name = "B" } } };
        var s = GameFactory.Create(TestWorld.Db, setup);
        Assert.Equal(Gov(s, "GOVERNMENT_CHIEFDOM"), s.Players[0].Government);
        Assert.True(s.Players[0].PolicySwapFree);
    }

    // ----- Governments and cards -----------------------------------------------------------------------

    [Fact]
    public void Cards_FillTheirSlotsThenWildcards()
    {
        var s = World();
        int republic = Gov(s, "GOVERNMENT_CLASSICAL_REPUBLIC");   // 0 military, 2 economic, 1 diplomatic, 1 wildcard
        var eco = new[] { Card(s, "POLICY_URBAN_PLANNING"), Card(s, "POLICY_LAND_SURVEYORS") };
        Assert.True(SocietySystem.Fits(s, republic, eco));
        Assert.True(SocietySystem.Fits(s, republic, eco.Append(Card(s, "POLICY_DISCIPLINE")).ToList()));   // overflow into the wildcard
        Assert.False(SocietySystem.Fits(s, republic, eco.Append(Card(s, "POLICY_DISCIPLINE")).Append(Card(s, "POLICY_AGOGE")).ToList()));
        Assert.True(SocietySystem.Fits(s, republic, eco.Append(Card(s, "POLICY_DISCIPLINE")).Append(Card(s, "POLICY_AGOGE")).ToList(), extraWildcard: 1));
    }

    [Fact]
    public void Adopting_NeedsTheCivic_AndIsFreeOnlyAfterACivic()
    {
        var s = World();
        var p = s.Players[0];
        TestWorld.City(s, 0, 8, 8);
        int autocracy = Gov(s, "GOVERNMENT_AUTOCRACY");
        p.Civics[s.Db.Governments[autocracy].PrereqCivicIndex] = false;
        Assert.NotNull(Run(s, new SetGovernmentCommand { Player = 0, Government = autocracy }));
        p.Civics[s.Db.Governments[autocracy].PrereqCivicIndex] = true;
        Assert.Null(Run(s, new SetGovernmentCommand { Player = 0, Government = autocracy }));
        Assert.Equal(autocracy, p.Government);

        // Outside the free window, changing costs gold.
        p.PolicySwapFree = false;
        p.Gold = Fx.Zero;
        int oligarchy = Gov(s, "GOVERNMENT_OLIGARCHY");
        Assert.Contains("gold", Run(s, new SetGovernmentCommand { Player = 0, Government = oligarchy }));
        p.Gold = Fx.FromInt(1000);
        Assert.Null(Run(s, new SetGovernmentCommand { Player = 0, Government = oligarchy }));
        Assert.Equal(Fx.FromInt(1000 - SocietySystem.GovernmentChangeCost(s, p)), p.Gold);
    }

    [Fact]
    public void SlottedCards_ChangeCityYields_AndAdvanceClosesTheWindow()
    {
        var s = World();
        var p = s.Players[0];
        var city = TestWorld.City(s, 0, 8, 8, population: 3);
        Assert.Null(Run(s, new SetGovernmentCommand { Player = 0, Government = Gov(s, "GOVERNMENT_AUTOCRACY") }));
        var before = CityYields.Compute(s, city, CityEffects.Compute(s, city)).Total.Production;
        Assert.Null(Run(s, new SetPoliciesCommand { Player = 0, Policies = new() { Card(s, "POLICY_URBAN_PLANNING") } }));
        var after = CityYields.Compute(s, city, CityEffects.Compute(s, city)).Total.Production;
        Assert.True(after > before, $"Urban Planning should add production ({before} → {after})");
        Assert.Contains(CityEffects.Compute(s, city).Applied, a => a.Source == "Urban Planning");
        Assert.Contains(CityEffects.Compute(s, city).Applied, a => a.Source == "Autocracy");

        Assert.NotNull(Run(s, new SetPoliciesCommand { Player = 0, Policies = new() { Card(s, "POLICY_URBAN_PLANNING"), Card(s, "POLICY_URBAN_PLANNING") } }));
        TurnProcessor.Advance(s);
        Assert.False(p.PolicySwapFree);
        p.Gold = Fx.Zero;
        Assert.Contains("gold", Run(s, new SetPoliciesCommand { Player = 0, Policies = new() { Card(s, "POLICY_URBAN_PLANNING"), Card(s, "POLICY_GOD_KING") } }));
        Assert.Null(Run(s, new SetPoliciesCommand { Player = 0, Policies = new() }));   // removing is always free
    }

    [Fact]
    public void ChangingGovernment_DropsCardsThatNoLongerFit()
    {
        var s = World();
        var p = s.Players[0];
        TestWorld.City(s, 0, 8, 8);
        Run(s, new SetGovernmentCommand { Player = 0, Government = Gov(s, "GOVERNMENT_FASCISM") });
        var cards = new List<int> { Card(s, "POLICY_DISCIPLINE"), Card(s, "POLICY_AGOGE"), Card(s, "POLICY_RAIDERS"), Card(s, "POLICY_LEVEE") };
        Assert.Null(Run(s, new SetPoliciesCommand { Player = 0, Policies = cards }));
        Run(s, new SetGovernmentCommand { Player = 0, Government = Gov(s, "GOVERNMENT_CLASSICAL_REPUBLIC") });
        Assert.True(SocietySystem.Fits(s, p.Government, p.Policies));
        Assert.Single(p.Policies);   // no military slots: only the wildcard keeps one
    }

    [Fact]
    public void SocietyStrength_ReachesUnits_ButIsCappedAtSix()
    {
        var s = World();
        var p = s.Players[0];
        TestWorld.City(s, 0, 8, 8);
        var sword = TestWorld.Unit(s, 0, "UNIT_SWORDSMAN", 10, 10);
        Run(s, new SetGovernmentCommand { Player = 0, Government = Gov(s, "GOVERNMENT_OLIGARCHY") });
        var lines = SocietySystem.CombatLines(s, sword, attacking: true, vsCity: false, sword.Tile).ToList();
        Assert.Contains(lines, l => l.Label == "Oligarchy" && l.Value == 3);

        Run(s, new SetGovernmentCommand { Player = 0, Government = Gov(s, "GOVERNMENT_FASCISM") });
        Run(s, new SetPoliciesCommand { Player = 0, Policies = new() { Card(s, "POLICY_DISCIPLINE"), Card(s, "POLICY_COMBINED_ARMS") } });
        p.Pantheon = Belief(s, "BELIEF_GOD_OF_WAR");
        int total = SocietySystem.CombatLines(s, sword, true, false, sword.Tile).Sum(l => l.Value);
        Assert.Equal(SocietySystem.MaxSocietyStrength, total);
    }

    // ----- Promotions ----------------------------------------------------------------------------------

    [Fact]
    public void Veterans_ArePromoted_GainStrengthAndMoves()
    {
        var s = World();
        var sword = TestWorld.Unit(s, 0, "UNIT_SWORDSMAN", 10, 10);
        int battlecry = s.Db.Promotions.IndexOf("PROMOTION_BATTLECRY");
        Assert.Contains("experience", Run(s, new PromoteUnitCommand { Player = 0, UnitId = sword.Id, Promotion = battlecry }));
        sword.Experience = SocietySystem.ExperienceFor(0);
        Assert.True(SocietySystem.CanPromote(s, sword));
        Assert.NotNull(Run(s, new PromoteUnitCommand { Player = 0, UnitId = sword.Id, Promotion = s.Db.Promotions.IndexOf("PROMOTION_VOLLEY") }));   // ranged only
        Assert.Null(Run(s, new PromoteUnitCommand { Player = 0, UnitId = sword.Id, Promotion = battlecry }));
        Assert.Equal(Fx.Zero, sword.MovesLeft);
        Assert.Contains(SocietySystem.CombatLines(s, sword, true, false, sword.Tile), l => l.Label == "Battlecry" && l.Value == 5);
        Assert.False(SocietySystem.CanPromote(s, sword));   // the next one needs 45

        sword.Experience = SocietySystem.ExperienceFor(1);
        int baseMoves = UnitStats.Moves(s, sword);
        Assert.Null(Run(s, new PromoteUnitCommand { Player = 0, UnitId = sword.Id, Promotion = s.Db.Promotions.IndexOf("PROMOTION_COMMANDO") }));
        Assert.Equal(baseMoves + 1, UnitStats.Moves(s, sword));
        Assert.Equal(new[] { 15, 45, 90, 150 }, Enumerable.Range(0, 4).Select(SocietySystem.ExperienceFor));
    }

    [Fact]
    public void Fighting_EarnsExperience()
    {
        var s = World();
        Run(s, new DeclareWarCommand { Player = 0, Target = 1 });
        var a = TestWorld.Unit(s, 0, "UNIT_SWORDSMAN", 10, 10);
        var d = TestWorld.Unit(s, 1, "UNIT_WARRIOR", 11, 10);
        Run(s, new AttackCommand { Player = 0, UnitId = a.Id, TargetTile = d.Tile });
        Assert.True(a.Experience >= 4);
        if (s.GetUnit(d.Id) is { } survivor) Assert.True(survivor.Experience >= 3);
    }

    // ----- Religion ------------------------------------------------------------------------------------

    [Fact]
    public void Pantheon_CostsFaith_IsUnique_AndBlessesCities()
    {
        var s = World();
        var city = TestWorld.City(s, 0, 8, 8, population: 3);
        TestWorld.City(s, 1, 20, 8);
        int fertility = Belief(s, "BELIEF_FERTILITY_RITES");
        Assert.Contains("faith", Run(s, new FoundPantheonCommand { Player = 0, Belief = fertility }));
        s.Players[0].Faith = Fx.FromInt(30);
        s.Players[1].Faith = Fx.FromInt(30);
        s.Players[0].EraScore = 0;   // (founding the city was a moment too)
        Assert.Null(Run(s, new FoundPantheonCommand { Player = 0, Belief = fertility }));
        Assert.Equal(Fx.FromInt(5), s.Players[0].Faith);
        Assert.NotNull(Run(s, new FoundPantheonCommand { Player = 1, Belief = fertility }));   // taken
        Assert.NotNull(Run(s, new FoundPantheonCommand { Player = 1, Belief = Belief(s, "BELIEF_TITHE") }));   // not a pantheon belief
        Assert.Contains(CityEffects.Compute(s, city).Applied, a => a.Source.Contains("Fertility Rites"));
        Assert.Equal(2, s.Players[0].EraScore);
    }

    private static (GameState S, CityState Holy, CityState Near, CityState Far) Faithful()
    {
        var s = World(width: 40);
        var holy = TestWorld.City(s, 0, 8, 8, population: 6);
        var near = TestWorld.City(s, 1, 13, 8, population: 2);
        var far = TestWorld.City(s, 1, 34, 8, population: 2);
        var p = s.Players[0];
        p.CapitalCityId = holy.Id;
        p.GreatPeopleRecruited[(int)GreatPersonClass.Prophet] = 1;
        p.EraScore = 0;
        Assert.Null(Run(s, new FoundReligionCommand { Player = 0, Religion = 0, FounderBelief = Belief(s, "BELIEF_TITHE"), FollowerBelief = Belief(s, "BELIEF_WORK_ETHIC") }));
        return (s, holy, near, far);
    }

    [Fact]
    public void Religion_NeedsAProphet_ThenSpreadsByPressureToNearbyCities()
    {
        var s = World();
        TestWorld.City(s, 0, 8, 8);
        Assert.Contains("Prophet", Run(s, new FoundReligionCommand { Player = 0, Religion = 0, FounderBelief = Belief(s, "BELIEF_TITHE"), FollowerBelief = Belief(s, "BELIEF_WORK_ETHIC") }));

        var (w, holy, near, far) = Faithful();
        Assert.Equal(0, holy.Religion);
        Assert.Equal(3, w.Players[0].EraScore);
        for (int i = 0; i < 30 && near.Religion < 0; i++) TurnProcessor.Advance(w);
        Assert.Equal(0, near.Religion);   // within reach of the holy city
        Assert.Equal(-1, far.Religion);   // beyond it
        Assert.Contains(CityEffects.Compute(w, near).Applied, a => a.Source.Contains("Work Ethic"));   // followers' belief, whoever owns the city
        Assert.Equal(Fx.FromInt(2 * 2), ReligionSystem.FounderIncome(w, w.Players[0]).Gold);   // Tithe: 2 gold × 2 followers
    }

    [Fact]
    public void Missionaries_ConvertSmallCitiesAtOnce_AndAreSpent()
    {
        var (s, _, _, far) = Faithful();
        var m = TestWorld.Unit(s, 0, "UNIT_MISSIONARY", 33, 8);
        Assert.Null(Run(s, new SpreadReligionCommand { Player = 0, UnitId = m.Id }));
        Assert.Equal(0, far.Religion);
        Assert.Null(s.GetUnit(m.Id));
        var idle = TestWorld.Unit(s, 1, "UNIT_MISSIONARY", 20, 15);
        Assert.NotNull(Run(s, new SpreadReligionCommand { Player = 1, UnitId = idle.Id }));   // no religion, no city
    }

    [Fact]
    public void Missionaries_NeedAReligionToBuild()
    {
        var s = World();
        var city = TestWorld.City(s, 0, 8, 8);
        int missionary = s.Db.Units.IndexOf("UNIT_MISSIONARY");
        Assert.Equal("Found a religion first.", ProductionSystem.CanEnqueue(s, city, ProductionKind.Unit, missionary, -1));
        s.Players[0].Religion = 0;
        Assert.Null(ProductionSystem.CanEnqueue(s, city, ProductionKind.Unit, missionary, -1));
    }

    [Fact]
    public void SpiritualVictory_WhenEveryOtherCivMostlyFollows()
    {
        var s = TestWorld.Blank(width: 40, height: 20, players: 3);
        var a = TestWorld.City(s, 0, 5, 5);
        var b = TestWorld.City(s, 1, 15, 5);
        var c = TestWorld.City(s, 2, 25, 5);
        s.Players[0].Religion = 2;
        a.Religion = 2;
        b.Religion = 2;
        Assert.Equal(-1, ReligionSystem.SpiritualWinner(s));
        c.Religion = 2;
        Assert.Equal(0, ReligionSystem.SpiritualWinner(s));
        var events = new List<GameEvent>();
        VictorySystem.Check(s, events, endOfTurn: true);
        Assert.Equal(VictoryKind.Spiritual, s.Victory.Kind);
    }

    // ----- Great people --------------------------------------------------------------------------------

    [Fact]
    public void GreatPeople_ComeFromDistricts_OneAtATime_FirstComeFirstServed()
    {
        var s = World(width: 40);
        var c0 = TestWorld.City(s, 0, 8, 8);
        var c1 = TestWorld.City(s, 1, 25, 8);
        TestWorld.PlaceDistrict(s, c0, "DISTRICT_ACADEMY", TestWorld.Tile(s, 9, 8));
        TestWorld.PlaceDistrict(s, c1, "DISTRICT_ACADEMY", TestWorld.Tile(s, 26, 8));
        Assert.Equal(1, GreatPeopleSystem.PointsPerTurn(s, s.Players[0])[(int)GreatPersonClass.Scientist]);
        s.World.WorldEra = 9;
        var first = GreatPeopleSystem.Next(s, GreatPersonClass.Scientist)!;
        Assert.Equal(30, GreatPeopleSystem.Cost(s, GreatPersonClass.Scientist));
        s.Players[0].GreatPersonPoints[(int)GreatPersonClass.Scientist] = 29;
        s.Players[1].GreatPersonPoints[(int)GreatPersonClass.Scientist] = 20;
        Fx science = s.Players[0].TechProgress;
        var events = new List<GameEvent>();
        GreatPeopleSystem.ProcessTurn(s, events);
        Assert.Contains(events, e => e.Type == GameEventType.GreatPersonRecruited && e.Player == 0 && e.Def == first.Index);
        Assert.Contains(first.Index, s.GreatPeopleTaken);
        Assert.Equal(science + Fx.FromInt(first.Amount), s.Players[0].TechProgress);
        Assert.Equal(60, GreatPeopleSystem.Cost(s, GreatPersonClass.Scientist));
        Assert.NotEqual(first.Index, GreatPeopleSystem.Next(s, GreatPersonClass.Scientist)!.Index);
    }

    [Fact]
    public void GreatPeople_WaitForTheirEra()
    {
        var s = World();
        s.World.WorldEra = 0;
        Assert.All(Enum.GetValues<GreatPersonClass>(), cls =>
        {
            var next = GreatPeopleSystem.Next(s, cls);
            if (next != null) Assert.Equal(0, next.EraOrder);
        });
    }

    // ----- Ages ----------------------------------------------------------------------------------------

    [Theory]
    [InlineData(AgeState.Normal, 0, AgeState.Dark)]
    [InlineData(AgeState.Normal, 8, AgeState.Normal)]
    [InlineData(AgeState.Normal, 40, AgeState.Golden)]
    [InlineData(AgeState.Dark, 40, AgeState.Heroic)]
    public void EraScore_DecidesTheNextAge(AgeState before, int score, AgeState expected)
    {
        var s = World();
        TestWorld.City(s, 0, 8, 8);
        var p = s.Players[0];
        p.Age = before;
        p.EraScore = score;
        var events = new List<GameEvent>();
        AgeSystem.OnEraEntered(s, p, 1, events);
        Assert.Equal(expected, p.Age);
        Assert.Equal(0, p.EraScore);
        Assert.Contains(events, e => e.Type == GameEventType.AgeBegan);
    }

    [Fact]
    public void GoldenAges_BlessCities_BigEmpiresNeedMore()
    {
        var s = World();
        var city = TestWorld.City(s, 0, 8, 8);
        s.Players[0].Age = AgeState.Golden;
        Assert.Contains(CityEffects.Compute(s, city).Applied, a => a.Source == "Golden Age");
        Assert.True(AgeSystem.GoldenFrom(2, cities: 12) > AgeSystem.GoldenFrom(2, cities: 2));
    }

    // ----- Barbarians ----------------------------------------------------------------------------------

    [Fact]
    public void Camps_RiseInTheWilds_SendRaiders_AndPayWhenScattered()
    {
        var s = World(width: 40);
        TestWorld.City(s, 0, 3, 3);
        TestWorld.City(s, 1, 36, 16);
        s.Turn = BarbarianSystem.SpawnEvery * 2;
        var events = new List<GameEvent>();
        BarbarianSystem.ProcessTurn(s, events);
        Assert.Single(s.Camps);
        int camp = s.Camps[0].Tile;
        Assert.True(s.Cities.All(c => s.Map.Distance(c.Tile, camp) >= 6));
        for (int i = 0; i < 3; i++) { s.Turn++; BarbarianSystem.ProcessTurn(s, events); }
        Assert.Contains(s.Units, u => s.Players[u.Owner].IsFreeCities);

        foreach (var r in s.Units.Where(u => s.Players[u.Owner].IsFreeCities).ToList()) s.RemoveUnit(r);
        var hero = TestWorld.Unit(s, 0, "UNIT_SWORDSMAN", 0, 0);
        hero.Tile = camp;
        Fx gold = s.Players[0].Gold;
        BarbarianSystem.ProcessTurn(s, events);
        Assert.Empty(s.Camps);
        Assert.Equal(gold + Fx.FromInt(BarbarianSystem.ClearGold), s.Players[0].Gold);
        Assert.Contains(events, e => e.Type == GameEventType.CampCleared && e.Player == 0);
    }

    // ----- Wonders -------------------------------------------------------------------------------------

    [Fact]
    public void WorldWonders_AreOneInTheWorld_AndBlessTheWholeEmpire()
    {
        var s = World(width: 40);
        var a = TestWorld.City(s, 0, 8, 8);
        var a2 = TestWorld.City(s, 0, 8, 14);
        var b = TestWorld.City(s, 1, 25, 8);
        int forbidden = TestWorld.D(s, "WONDER_FORBIDDEN_CITY");
        Assert.Empty(DistrictPlacement.Check(s, b, forbidden, TestWorld.Tile(s, 26, 8)));
        TestWorld.PlaceDistrict(s, a, "WONDER_FORBIDDEN_CITY", TestWorld.Tile(s, 9, 8));
        Assert.Contains(PlacementFailure.WonderBuiltElsewhere, DistrictPlacement.Check(s, b, forbidden, TestWorld.Tile(s, 26, 8)));
        Assert.Contains(CityEffects.Compute(s, a2).Applied, x => x.Source == "Forbidden City");   // empire-wide loyalty
        Assert.Equal(1, SocietySystem.ExtraWildcard(s, s.Players[0]));
        Assert.Contains(SocietySystem.Wonders(s, 0), w => w.Id == "WONDER_FORBIDDEN_CITY");
    }

    // ----- Natural wonders -----------------------------------------------------------------------------

    [Fact]
    public void MapGenerator_PlacesNaturalWonders_AndDiscoveringOneIsAMoment()
    {
        var db = TestWorld.Db;
        var gen = MapGenerator.Generate(db, new MapGenSettings { Width = 64, Height = 40, Seed = 9, Players = 4 });
        var tiles = Enumerable.Range(0, gen.Map.Count).Where(t => gen.Map.Feature[t] >= 0 && db.Features[gen.Map.Feature[t]].NaturalWonder).ToList();
        Assert.InRange(tiles.Count, 2, 9);
        Assert.Equal(tiles.Count, tiles.Select(t => gen.Map.Feature[t]).Distinct().Count());   // each wonder at most once
        Assert.True(tiles.All(t => gen.StartTiles.All(st => gen.Map.Distance(st, t) >= 4)));

        var s = World();
        int uluru = db.Features.IndexOf("FEATURE_ULURU");
        int tile = TestWorld.Tile(s, 12, 12);
        s.Map.Terrain[tile] = (byte)db.Ids.Desert;
        s.Map.Feature[tile] = (short)uluru;
        s.Players[0].Revealed = new bool[s.Map.Count];
        s.Players[0].Revealed[tile] = true;
        var events = new List<GameEvent>();
        AgeSystem.ProcessTurn(s, events);
        AgeSystem.ProcessTurn(s, events);
        Assert.Single(events, e => e.Type == GameEventType.NaturalWonderDiscovered);
        Assert.Equal(2, s.Players[0].EraScore);
    }

    // ----- War weariness -------------------------------------------------------------------------------

    [Fact]
    public void WarWeariness_CostsAmenities_AndFadesInPeace()
    {
        var s = World();
        var city = TestWorld.City(s, 0, 8, 8, population: 4);
        var p = s.Players[0];
        int before = CityYields.Compute(s, city, CityEffects.Compute(s, city)).AmenitiesAvailable;
        SocietySystem.AddWeariness(s, 0, 2 * SocietySystem.WearinessPerAmenity);
        Assert.Equal(2, SocietySystem.WearinessPenalty(p));
        Assert.Equal(before - 2, CityYields.Compute(s, city, CityEffects.Compute(s, city)).AmenitiesAvailable);
        SocietySystem.ProcessTurn(s);
        Assert.Equal(2 * SocietySystem.WearinessPerAmenity - 3, p.WarWeariness);
        SocietySystem.AddWeariness(s, 0, 500);
        Assert.Equal(SocietySystem.MaxWearinessPenalty, SocietySystem.WearinessPenalty(p));
    }

    // ----- Saves and commands --------------------------------------------------------------------------

    [Fact]
    public void SocietyState_SurvivesASave()
    {
        var (s, holy, near, _) = Faithful();
        var p = s.Players[0];
        p.Government = Gov(s, "GOVERNMENT_MONARCHY");
        p.Policies.AddRange(new[] { Card(s, "POLICY_DISCIPLINE"), Card(s, "POLICY_URBAN_PLANNING") });
        p.Pantheon = Belief(s, "BELIEF_ORAL_TRADITION");
        p.GreatPersonPoints[3] = 17;
        p.EraScore = 9;
        p.Age = AgeState.Golden;
        p.WarWeariness = 13;
        var u = TestWorld.Unit(s, 0, "UNIT_SWORDSMAN", 10, 10);
        u.Experience = 33;
        u.Promotions.Add(s.Db.Promotions.IndexOf("PROMOTION_BATTLECRY"));
        near.ReligionCandidate = 0;
        near.ReligionProgress = Fx.FromInt(12);
        s.Camps.Add((TestWorld.Tile(s, 20, 15), 4));
        s.GreatPeopleTaken.Add(3);
        s.Discoveries.Add(123);

        var back = GameStateSerializer.Deserialize(GameStateSerializer.Serialize(s), s.Db);
        var q = back.Players[0];
        Assert.Equal(p.Government, q.Government);
        Assert.Equal(p.Policies, q.Policies);
        Assert.Equal((p.Pantheon, p.Religion), (q.Pantheon, q.Religion));
        Assert.Equal(p.Beliefs, q.Beliefs);
        Assert.Equal(p.GreatPersonPoints, q.GreatPersonPoints);
        Assert.Equal(p.GreatPeopleRecruited, q.GreatPeopleRecruited);
        Assert.Equal((9, AgeState.Golden, 13), (q.EraScore, q.Age, q.WarWeariness));
        Assert.Equal(33, back.GetUnit(u.Id)!.Experience);
        Assert.Equal(u.Promotions, back.GetUnit(u.Id)!.Promotions);
        Assert.Equal(holy.Religion, back.GetCity(holy.Id)!.Religion);
        Assert.Equal(Fx.FromInt(12), back.GetCity(near.Id)!.ReligionProgress);
        Assert.Equal(s.Camps, back.Camps);
        Assert.Equal(s.GreatPeopleTaken, back.GreatPeopleTaken);
        Assert.Equal(s.Discoveries, back.Discoveries);
        Assert.Equal(GameStateSerializer.Hash(s), GameStateSerializer.Hash(back));
    }

    [Fact]
    public void SocietyCommands_RoundTrip()
    {
        GameCommand[] commands =
        {
            new SetGovernmentCommand { Player = 1, Government = 4 },
            new SetPoliciesCommand { Player = 1, Policies = new() { 3, 9, 12 } },
            new FoundPantheonCommand { Player = 1, Belief = 2 },
            new FoundReligionCommand { Player = 1, Religion = 3, FounderBelief = 9, FollowerBelief = 14 },
            new SpreadReligionCommand { Player = 1, UnitId = 77 },
            new PromoteUnitCommand { Player = 1, UnitId = 77, Promotion = 5 },
        };
        foreach (var cmd in commands)
        {
            var bytes = cmd.Serialize();
            var back = GameCommand.Deserialize(bytes);
            Assert.Equal(cmd.Type, back.Type);
            Assert.Equal(bytes, back.Serialize());
        }
    }

    // ----- AI --------------------------------------------------------------------------------------------

    [Fact]
    public void Ai_UsesSociety_OverALongGame()
    {
        var setup = new GameSetup { Seed = 3, Map = new MapGenSettings { Width = 48, Height = 30, Seed = 3 },
                                    Players = Enumerable.Range(0, 4).Select(i => new PlayerSetup { Name = $"AI {i}" }).ToList() };
        var s = GameFactory.Create(TestWorld.Db, setup);
        var ai = new UnbrokenAges.Sim.AI.SimpleAi();
        for (int t = 0; t < 140; t++)
        {
            foreach (var p in s.Players.Where(p => !p.IsFreeCities && p.IsAlive))
                foreach (var cmd in ai.TakeTurn(s, p.Id)) CommandProcessor.Execute(s, cmd, new());
            CommandProcessor.Execute(s, new AdvanceTurnCommand { Player = GameCommand.SystemPlayer, ExpectedTurn = s.Turn }, new());
            if (s.Victory.AwaitingChoice) CommandProcessor.Execute(s, new OneMoreTurnCommand { Player = s.Victory.Winner }, new());
        }
        var majors = s.Players.Where(p => !p.IsFreeCities).ToList();
        Assert.Contains(majors, p => p.Government != Gov(s, "GOVERNMENT_CHIEFDOM"));
        Assert.Contains(majors, p => p.Policies.Count > 0);
        Assert.Contains(majors, p => p.Pantheon >= 0);
        Assert.NotEmpty(s.GreatPeopleTaken);
    }
}
