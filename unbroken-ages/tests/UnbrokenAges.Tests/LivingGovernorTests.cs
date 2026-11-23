namespace UnbrokenAges.Tests;

public class LivingGovernorTests
{
    private static GovernorState Seat(GameState s, CityState city, string governorId)
    {
        int def = s.Db.Governors.IndexOf(governorId);
        var p = s.Players[city.Owner];
        GovernorSystem.Appoint(p, def);
        GovernorSystem.Assign(s, p, def, city.Id);
        var gov = p.GetGovernor(def)!;
        gov.Established = true;
        return gov;
    }

    private static int Trait(GameState s, string id) => s.Db.GovernorTraits.IndexOf(id);

    [Fact]
    public void ServingOnAGreatRiver_EarnsRiverWise_AfterFifteenTurns()
    {
        var s = TestWorld.Blank(allTech: false);
        var city = TestWorld.City(s, 0, 10, 10);
        s.Map.Terrain[s.Map.Neighbor(city.Tile, HexCoord.E)] = (byte)s.Db.Ids.Channel;
        var gov = Seat(s, city, "GOVERNOR_STEWARD");

        var events = new List<GameEvent>();
        for (int t = 0; t < 14; t++) GovernorSystem.GainExperience(s, events);
        Assert.Empty(gov.Traits);
        Assert.Equal(14, gov.TraitProgress[Trait(s, "TRAIT_RIVER_WISE")]);
        Assert.Contains("next: River-wise 14/15", GovernorSystem.Describe(s, gov));

        GovernorSystem.GainExperience(s, events);
        Assert.Equal(new[] { Trait(s, "TRAIT_RIVER_WISE") }, gov.Traits);
        Assert.Equal(15, gov.Experience);
        var earned = Assert.Single(events, e => e.Type == GameEventType.GovernorTraitEarned);
        Assert.Equal("The Steward, serving in " + city.Name + ", becomes River-wise", earned.Detail);
    }

    [Fact]
    public void EventTraits_CountOnlyEventsInTheGovernorsCity()
    {
        var s = TestWorld.Blank(allTech: false);
        var city = TestWorld.City(s, 0, 5, 10);
        var other = TestWorld.City(s, 0, 15, 10);
        var gov = Seat(s, city, "GOVERNOR_CASTELLAN");
        for (int t = 0; t < 3; t++)
        {
            var events = new List<GameEvent>
            {
                new(GameEventType.CityGrew, 0, city.Id, city.Tile),
                new(GameEventType.CityGrew, 0, other.Id, other.Tile),
                new(GameEventType.CityGrew, 0, other.Id, other.Tile),
            };
            GovernorSystem.GainExperience(s, events);
        }
        Assert.Equal(3, gov.TraitProgress[Trait(s, "TRAIT_HEARTHKEEPER")]);
        // A disaster is attributed by its epicentre tile when the event carries no city.
        GovernorSystem.GainExperience(s, new() { new(GameEventType.CityGrew, 0, city.Id, city.Tile), new(GameEventType.Disaster, Tile: city.Tile) });
        Assert.Contains(Trait(s, "TRAIT_HEARTHKEEPER"), gov.Traits);
        Assert.Equal(1, gov.TraitProgress[Trait(s, "TRAIT_LEVEE_BUILDER")]);
    }

    [Fact]
    public void TraitsTravelWithTheGovernor_AndApplyWhereverItIsEstablished()
    {
        var s = TestWorld.Blank(allTech: false);
        var a = TestWorld.City(s, 0, 5, 10);
        var b = TestWorld.City(s, 0, 15, 10);
        var gov = Seat(s, a, "GOVERNOR_TREASURER");
        gov.Traits.Add(Trait(s, "TRAIT_SALT_BLOODED"));

        GovernorSystem.Assign(s, s.Players[0], gov.DefIndex, b.Id);
        Assert.DoesNotContain(CityEffects.Compute(s, b).Applied, x => x.Source.Contains("Salt-blooded"));   // not yet established
        gov.Established = true;
        var applied = CityEffects.Compute(s, b).Applied;
        Assert.Contains(applied, x => x.Source == "The Treasurer: Salt-blooded (trait)");
    }

    [Fact]
    public void Experience_RanksUp_AndVeteransEstablishFaster()
    {
        var s = TestWorld.Blank(allTech: false);
        var city = TestWorld.City(s, 0, 10, 10);
        var gov = Seat(s, city, "GOVERNOR_STEWARD");
        int baseTurns = s.Db.Governors[gov.DefIndex].EstablishTurns;
        Assert.Equal(baseTurns, GovernorSystem.EstablishTurns(s.Db, gov));
        gov.Experience = 50;
        Assert.Equal("Veteran", GovernorSystem.RankName(gov));
        Assert.Equal(baseTurns - 2, GovernorSystem.EstablishTurns(s.Db, gov));
        gov.Traits.Add(Trait(s, "TRAIT_OLD_HAND"));
        Assert.Equal(baseTurns - 3, GovernorSystem.EstablishTurns(s.Db, gov));
    }

    [Fact]
    public void AGovernorHoldsAtMostThreeTraits()
    {
        var s = TestWorld.Blank(allTech: false);
        var city = TestWorld.City(s, 0, 10, 10);
        s.Map.Terrain[s.Map.Neighbor(city.Tile, HexCoord.E)] = (byte)s.Db.Ids.Channel;
        var gov = Seat(s, city, "GOVERNOR_STEWARD");
        gov.Traits.AddRange(new[] { Trait(s, "TRAIT_BORDERER"), Trait(s, "TRAIT_HEARTHKEEPER"), Trait(s, "TRAIT_GRID_WARDEN") });
        for (int t = 0; t < 20; t++) GovernorSystem.GainExperience(s, new());
        Assert.Equal(3, gov.Traits.Count);
        Assert.Empty(gov.TraitProgress);
        Assert.Equal(20, gov.Experience);
        Assert.Null(GovernorSystem.NextTrait(s, gov));
    }

    [Fact]
    public void FrontierAndWarRequirements_ReadTheWorld()
    {
        var s = TestWorld.Blank(width: 30, players: 2, allTech: false);
        var city = TestWorld.City(s, 0, 5, 10);
        var frontier = new List<RequirementDef> { new() { Type = RequirementType.CityOnFrontier, Value = 3 } };
        var war = new List<RequirementDef> { new() { Type = RequirementType.OwnerAtWar } };
        Assert.False(CityEffects.RequirementsMet(s, city, frontier));
        Assert.False(CityEffects.RequirementsMet(s, city, war));            // Free Cities' standing hostility is not a war

        TestWorld.City(s, 1, 9, 10);                                        // its borders reach within 3 tiles
        Assert.True(CityEffects.RequirementsMet(s, city, frontier));
        Assert.True(CommandProcessor.Execute(s, new DeclareWarCommand { Player = 0, Target = 1 }, new()).Ok);
        Assert.True(CityEffects.RequirementsMet(s, city, war));
    }

    [Fact]
    public void GovernorHistory_SurvivesSnapshots()
    {
        var s = TestWorld.Blank(allTech: false);
        var city = TestWorld.City(s, 0, 10, 10);
        var gov = Seat(s, city, "GOVERNOR_STEWARD");
        gov.Experience = 33;
        gov.Traits.Add(Trait(s, "TRAIT_OLD_HAND"));
        gov.TraitProgress[Trait(s, "TRAIT_HEARTHKEEPER")] = 2;
        var back = GameStateSerializer.Deserialize(GameStateSerializer.Serialize(s), s.Db).Players[0].GetGovernor(gov.DefIndex)!;
        Assert.Equal(33, back.Experience);
        Assert.Equal(gov.Traits, back.Traits);
        Assert.Equal(2, back.TraitProgress[Trait(s, "TRAIT_HEARTHKEEPER")]);
    }
}

public class GovernorTraitModdingTests
{
    [Fact]
    public void ModdedTraits_AreValidatedAtLoad()
    {
        var ex = Assert.Throws<ModLoadException>(() => ModLoader.LoadFromStrings(TestWorld.BaseDocuments().Append(("testmod",
            """{ "governorTraits": [ { "id": "TRAIT_X", "name": "X", "event": "NoSuchEvent", "count": 2 }, { "id": "TRAIT_Y", "name": "Y" } ] }"""))));
        Assert.Contains(ex.Errors, e => e.Contains("unknown event 'NoSuchEvent'"));
        Assert.Contains(ex.Errors, e => e.Contains("TRAIT_Y") && e.Contains("needs either"));
    }
}
