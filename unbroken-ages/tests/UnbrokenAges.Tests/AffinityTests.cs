using UnbrokenAges.Sim.AI;

namespace UnbrokenAges.Tests;

public class AffinityTests
{
    private static int A(GameState s, string id) => s.Db.Divergences.IndexOf(id);
    private const string Purity = "DIVERGENCE_SOVEREIGN", Harmony = "DIVERGENCE_SYMBIONT", Supremacy = "DIVERGENCE_DISCARNATE";

    [Fact]
    public void Points_MakeLevels_AndLevelUpsAreAnnounced()
    {
        var s = TestWorld.Blank();
        var p = s.Players[0];
        var events = new List<GameEvent>();
        var t = s.Db.Rules.Affinity.LevelThresholds;
        AffinitySystem.Award(s, p, A(s, Harmony), t[2], "test", events);
        Assert.Equal(3, AffinitySystem.Level(p, A(s, Harmony)));
        var up = Assert.Single(events, e => e.Type == GameEventType.AffinityLevelUp);
        Assert.Equal(3, up.Value);
        Assert.Equal(A(s, Harmony), AffinitySystem.Dominant(p));
        var (into, needed) = AffinitySystem.Progress(s, p, A(s, Harmony));
        Assert.Equal(0, into);
        Assert.Equal(t[3] - t[2], needed);
        AffinitySystem.Award(s, p, A(s, Harmony), 100000, "test", events);
        Assert.Equal(AffinitySystem.MaxLevel, AffinitySystem.Level(p, A(s, Harmony)));
        Assert.StartsWith("Affinity: Harmony level", EventText.Describe(s, up, 0));
    }

    [Fact]
    public void Techs_Buildings_Improvements_Policies_AndKills_AllEarnPoints()
    {
        var s = TestWorld.Blank(allTech: false);
        var city = TestWorld.City(s, 0, 8, 8, population: 6);
        TestWorld.City(s, 1, 18, 8);
        var p = s.Players[0];
        var events = new List<GameEvent>();
        // A tagged technology.
        DivergenceSystem.OnNodeCompleted(s, p, s.Db.Techs["TECH_XENOBIOLOGY"], events);
        Assert.Equal(3, AffinitySystem.Points(p, A(s, Harmony)));
        // A tagged building.
        TestWorld.PlaceDistrict(s, city, "DISTRICT_FOUNDRY", s.Map.Neighbor(city.Tile, HexCoord.E));
        ProductionSystem.Complete(s, city, new QueueItem { Kind = ProductionKind.Building, DefIndex = s.Db.Buildings.IndexOf("BUILDING_AUTOMATED_FACTORY") }, events);
        Assert.Equal(1, AffinitySystem.Points(p, A(s, Supremacy)));
        // A tagged improvement.
        AffinitySystem.OnImprovementBuilt(s, 0, s.Db.Improvements.IndexOf("IMPROVEMENT_RECLAMATION_GRID"), events);
        Assert.Equal(1, AffinitySystem.Points(p, A(s, Purity)));
        // A slotted policy pays every few turns.
        p.Policies.Add(s.Db.Policies.IndexOf("POLICY_RATIONALISM"));
        s.Turn = s.Db.Rules.Affinity.PolicyInterval * 3;
        AffinitySystem.ProcessTurn(s, events);
        Assert.Equal(2, AffinitySystem.Points(p, A(s, Supremacy)));
        // A kill by an affinity unit.
        var stalker = TestWorld.Unit(s, 0, "UNIT_BLOOM_STALKER", 12, 8);
        AffinitySystem.OnKill(s, 0, stalker, events);
        Assert.Equal(4, AffinitySystem.Points(p, A(s, Harmony)));
    }

    [Fact]
    public void Costs_AreSoftlyExclusive_DiscountedByLevel_DearerBehindTheLead_AndBoosted()
    {
        var s = TestWorld.Blank();
        var p = s.Players[0];
        var harmonyTech = s.Db.Techs["TECH_ECO_ENGINEERING"];
        var purityTech = s.Db.Techs["TECH_HERITAGE_ARCHIVES"];
        Fx baseHarmony = ResearchSystem.Cost(s, p, harmonyTech), basePurity = ResearchSystem.Cost(s, p, purityTech);
        AffinitySystem.Award(s, p, A(s, Harmony), s.Db.Rules.Affinity.LevelThresholds[4], "test", null);   // Harmony 5
        Assert.True(ResearchSystem.Cost(s, p, harmonyTech) < baseHarmony);
        Assert.True(ResearchSystem.Cost(s, p, purityTech) > basePurity);
        Assert.Contains(AffinitySystem.CostLines(s, p, purityTech), l => l.Label.Contains("leads Purity by 5 levels") && l.Percent == 20);
        // The boost: Xenobiology costs 40% less from Harmony level 2.
        var xeno = s.Db.Techs["TECH_XENOBIOLOGY"];
        Assert.Contains(AffinitySystem.CostLines(s, p, xeno), l => l.Label.StartsWith("Boost") && l.Percent == -xeno.BoostPercent);
        // Choosing Harmony makes Purity's techs far dearer still, but leaves them open.
        p.Divergence = A(s, Harmony);
        Assert.Contains(AffinitySystem.CostLines(s, p, purityTech), l => l.Label == "Your people chose Harmony" && l.Percent == 50);
        Assert.True(DivergenceSystem.IsAvailable(p, purityTech));
    }

    [Fact]
    public void Levels_SwitchOnIdentityEffects_InEveryCity()
    {
        var s = TestWorld.Blank();
        var city = TestWorld.City(s, 0, 8, 8, population: 4);
        for (int d = 0; d < 6; d++) s.Map.Feature[s.Map.Neighbor(city.Tile, d)] = (short)s.Db.Ids.Forest;
        var p = s.Players[0];
        Fx food = CityEffects.Compute(s, city).FlatYields.Food;
        AffinitySystem.Award(s, p, A(s, Harmony), s.Db.Rules.Affinity.LevelThresholds[1], "test", null);   // Harmony 2
        Assert.Equal(food + 3, CityEffects.Compute(s, city).FlatYields.Food);                           // +0.5 per woods tile
        Assert.Contains(AffinitySystem.ActiveLevels(s, p), l => l.Affinity == A(s, Harmony) && l.Level.Level == 2);
        Assert.Equal(4, AffinitySystem.NextLevel(s, p, A(s, Harmony))!.Level);

        int defence = CombatSystem.CityStrength(s, city).Total;
        AffinitySystem.Award(s, p, A(s, Purity), s.Db.Rules.Affinity.LevelThresholds[5], "test", null);   // Purity 6
        Assert.Equal(defence + 3, CombatSystem.CityStrength(s, city).Total);
    }

    [Fact]
    public void AffinityUnits_NeedTheLevel_GrowWithIt_AndLivingOnesRegenerate()
    {
        var s = TestWorld.Blank();
        var city = TestWorld.City(s, 0, 8, 8, population: 4);
        var p = s.Players[0];
        int trooper = s.Db.Units.IndexOf("UNIT_AEGIS_TROOPER");
        p.Stockpile[s.Db.Resources.IndexOf("RESOURCE_STEEL")] = 50;
        Assert.Equal("Requires Purity level 3.", ProductionSystem.Validate(s, city, ProductionKind.Unit, trooper, -1));
        AffinitySystem.Award(s, p, A(s, Purity), s.Db.Rules.Affinity.LevelThresholds[5], "test", null);   // Purity 6
        Assert.Null(ProductionSystem.Validate(s, city, ProductionKind.Unit, trooper, -1));
        var unit = TestWorld.Unit(s, 0, "UNIT_AEGIS_TROOPER", 9, 8);
        Assert.Contains(AffinitySystem.CombatLines(s, unit), l => l.Value == 3);
        Assert.Contains(s.Db.Units["UNIT_MECH_INFANTRY"].UpgradesTo, u => u == "UNIT_AEGIS_TROOPER");

        var stalker = TestWorld.Unit(s, 0, "UNIT_BLOOM_STALKER", 10, 8);
        stalker.Hp = 50;
        AffinitySystem.ProcessTurn(s, new());
        Assert.Equal(60, stalker.Hp);
    }

    [Fact]
    public void KindredAffinities_WarmAttitudes_AndRivalOnesCoolThem()
    {
        var s = TestWorld.Blank(players: 3);
        int lvl3 = s.Db.Rules.Affinity.LevelThresholds[2];
        AffinitySystem.Award(s, s.Players[0], A(s, Harmony), lvl3, "test", null);
        AffinitySystem.Award(s, s.Players[1], A(s, Harmony), lvl3, "test", null);
        AffinitySystem.Award(s, s.Players[2], A(s, Supremacy), lvl3, "test", null);
        Assert.Contains(DiplomacySystem.Attitude(s, 0, 1).Lines, l => l.Label == "Affinity" && l.Value > 0);
        Assert.Contains(DiplomacySystem.Attitude(s, 0, 2).Lines, l => l.Label == "Affinity" && l.Value < 0);
    }

    [Fact]
    public void TheTree_RunsThroughFourNewEras_WithEveryAffinityInEach()
    {
        var db = TestWorld.Db;
        foreach (var era in new[] { "ERA_NEAR_FUTURE", "ERA_ORBITAL", "ERA_DEEP_SPACE", "ERA_SINGULARITY" })
        {
            var techs = db.Techs.Where(t => t.Era == era).ToList();
            Assert.True(techs.Count >= 9, era);
            foreach (var d in db.Divergences) Assert.Contains(techs, t => AffinitySystem.NodeAffinity(t) == d.Index);
            Assert.Contains(techs, t => AffinitySystem.NodeAffinity(t) < 0);   // shared science too
        }
        Assert.True(db.Techs.Count(t => db.Eras[t.EraIndex].Order >= 9) >= 45);
        // Every capstone is a victory node whose tech unlocks its affinity's final project.
        foreach (var d in db.Divergences)
        {
            var final = db.Projects[d.AscensionProjectIndex];
            Assert.True(db.Techs[final.PrereqTechIndex].Victory);
            Assert.Equal("ERA_SINGULARITY", db.Techs[final.PrereqTechIndex].Era);
            Assert.True(final.RequiresAffinityLevel >= 10);
        }
        // New units look like something that exists.
        foreach (var u in db.Units.Where(u => u.AffinityIndex >= 0 || u.RequiresAffinityIndex >= 0))
            Assert.True(u.Look == null || File.Exists(Path.Combine(TestWorld.RepoRoot, "godot", "assets", "models", u.Look.Model + ".glb")), u.Id);
    }

    [Fact]
    public void Ai_ResearchesItsAffinity_AfterTheThreshold()
    {
        var s = TestWorld.Blank(leaders: new[] { "LEADER_TAIZU_SONG" }, allTech: false);
        TestWorld.City(s, 0, 8, 8, population: 6);
        var p = s.Players[0];
        foreach (var t in s.Db.Techs.Where(t => s.Db.Eras[t.EraIndex].Order <= 8 && t.DivergenceIndex < 0)) p.Techs[t.Index] = true;
        AffinitySystem.Award(s, p, A(s, Supremacy), 3, "test", null);
        int preferred = DivergenceSystem.Preferred(s, p);
        var research = new SimpleAi().TakeTurn(s, 0).OfType<SetResearchCommand>().Single();
        Assert.Equal(preferred, AffinitySystem.NodeAffinity(s.Db.Techs[research.Tech]));
    }

    [Fact]
    public void AffinityWonders_NeedTheLevel_AndGrantTheirAffinity()
    {
        var s = TestWorld.Blank();
        var city = TestWorld.City(s, 0, 8, 8, population: 6);
        var p = s.Players[0];
        int wonder = TestWorld.D(s, "WONDER_NOOSPHERE_CORE");
        int tile = s.Map.Neighbor(city.Tile, HexCoord.E);
        Assert.Equal("Requires Supremacy level 6.", ProductionSystem.Validate(s, city, ProductionKind.District, wonder, tile));
        AffinitySystem.Award(s, p, A(s, Supremacy), s.Db.Rules.Affinity.LevelThresholds[5], "test", null);
        Assert.Null(ProductionSystem.Validate(s, city, ProductionKind.District, wonder, tile));
        int before = AffinitySystem.Points(p, A(s, Supremacy));
        ProductionSystem.Complete(s, city, new QueueItem { Kind = ProductionKind.District, DefIndex = wonder, Tile = tile }, new());
        Assert.Equal(before + 6, AffinitySystem.Points(p, A(s, Supremacy)));
    }

    [Fact]
    public void AffinityAgendas_LikePeoplesOfTheirAffinity()
    {
        var s = TestWorld.Blank(players: 2, leaders: new[] { "LEADER_TRAJAN", null });
        Assert.DoesNotContain(DiplomacySystem.Attitude(s, 0, 1).Lines, l => l.Label.EndsWith(": Purity"));
        AffinitySystem.Award(s, s.Players[1], A(s, Purity), s.Db.Rules.Affinity.LevelThresholds[2], "test", null);
        Assert.Contains(DiplomacySystem.Attitude(s, 0, 1).Lines, l => l.Label.EndsWith(": Purity") && l.Value > 0);
    }

    [Fact]
    public void Affinities_SurviveSnapshots()
    {
        var s = TestWorld.Blank();
        AffinitySystem.Award(s, s.Players[0], 2, 40, "test", null);
        var back = GameStateSerializer.Deserialize(GameStateSerializer.Serialize(s), s.Db);
        Assert.Equal(GameStateSerializer.Hash(s), GameStateSerializer.Hash(back));
        Assert.Equal(AffinitySystem.Level(s.Players[0], 2), AffinitySystem.Level(back.Players[0], 2));
    }
}
