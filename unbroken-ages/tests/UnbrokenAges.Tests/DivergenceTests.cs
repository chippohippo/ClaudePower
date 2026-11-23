using UnbrokenAges.Sim.AI;

namespace UnbrokenAges.Tests;

public class DivergenceTests
{
    private static int Tech(GameState s, string id) => s.Db.Techs.IndexOf(id);
    private static int Div(GameState s, string id) => s.Db.Divergences.IndexOf(id);

    /// <summary>Puts a player at the Threshold, commits it to a Divergence and grants the listed branch techs.</summary>
    private static void Commit(GameState s, int player, string divergence, params string[] branchTechs)
    {
        var p = s.Players[player];
        p.Techs[Tech(s, "TECH_THRESHOLD")] = true;
        var d = s.Db.Divergences[divergence];
        p.Techs[d.DoctrineTechIndex] = true;
        DivergenceSystem.OnNodeCompleted(s, p, s.Db.Techs[d.DoctrineTechIndex], new List<GameEvent>());
        foreach (var t in branchTechs) p.Techs[Tech(s, t)] = true;
    }

    [Fact]
    public void Content_DefinesThreeMutuallyExclusiveBranches()
    {
        var db = TestWorld.Db;
        Assert.Equal(3, db.Divergences.Count);
        foreach (var d in db.Divergences)
        {
            var doctrine = db.Techs[d.DoctrineTechIndex];
            Assert.True(doctrine.Doctrine);
            Assert.Equal(d.Index, doctrine.DivergenceIndex);
            Assert.Contains(db.Techs["TECH_THRESHOLD"].Index, doctrine.PrereqIndices);
            Assert.Equal(6, db.Techs.Count(t => t.DivergenceIndex == d.Index));
            Assert.True(d.AscensionProjectIndex >= 0);
            Assert.All(db.Techs.Where(t => t.DivergenceIndex == d.Index), t => Assert.False(string.IsNullOrEmpty(t.Quote)));
        }
    }

    [Fact]
    public void ResearchingADoctrine_CommitsAndLocksTheOtherBranchesForever()
    {
        var s = TestWorld.Blank();
        var p = s.Players[0];
        p.Techs[Tech(s, "TECH_THRESHOLD")] = true;
        foreach (var d in s.Db.Divergences) Assert.True(ResearchSystem.CanResearch(p, s.Db.Techs[d.DoctrineTechIndex]));
        Assert.False(ResearchSystem.CanStudy(p, s.Db.Civics["CIVIC_COMPLIANCE_CODES"])); // branch civics need commitment

        Assert.True(CommandProcessor.Execute(s, new SetResearchCommand { Player = 0, Tech = Tech(s, "TECH_SOVEREIGN_CHARTER") }, new()).Ok);
        var events = new List<GameEvent>();
        ResearchSystem.Process(s, p, 100_000, Fx.Zero, events);

        Assert.Equal(Div(s, "DIVERGENCE_SOVEREIGN"), p.Divergence);
        Assert.Contains(events, e => e.Type == GameEventType.DivergenceChosen);
        Assert.False(ResearchSystem.CanResearch(p, s.Db.Techs["TECH_GRAFTING_ACCORD"]));
        Assert.False(ResearchSystem.CanResearch(p, s.Db.Techs["TECH_DISCARNATION_EDICT"]));
        Assert.True(ResearchSystem.CanResearch(p, s.Db.Techs["TECH_GENOME_REGISTRY"]));
        Assert.True(ResearchSystem.CanStudy(p, s.Db.Civics["CIVIC_COMPLIANCE_CODES"]));
        Assert.False(ResearchSystem.CanStudy(p, s.Db.Civics["CIVIC_SHARED_BREATH"]));

        var locked = new SetResearchCommand { Player = 0, Tech = Tech(s, "TECH_DISCARNATION_EDICT") }.Validate(s);
        Assert.Equal("Locked forever: your people became the Sovereign.", locked);
    }

    [Fact]
    public void History_LeansTowardADoctrine_AndDiscountsIt()
    {
        var s = TestWorld.Blank();
        var city = TestWorld.City(s, 0, 10, 10, population: 4);
        var p = s.Players[0];
        int sovereign = Div(s, "DIVERGENCE_SOVEREIGN");
        var before = DivergenceSystem.Leanings(s, p);
        Assert.Equal(Fx.Zero, before[sovereign].Share);                // only population so far (a Symbiont pull)

        TestWorld.AddBuilding(s, city, "BUILDING_FLOOD_BARRIER");
        TestWorld.PlaceDistrict(s, city, "DISTRICT_CIVIC_PLAZA", s.Map.Neighbor(city.Tile, HexCoord.E));
        var after = DivergenceSystem.Leanings(s, p);
        Assert.True(after[sovereign].Share > Fx.Half);
        Assert.Contains(after[sovereign].Sources, src => src.Label.Contains("Flood Barriers"));

        var sovereignDoctrine = s.Db.Techs["TECH_SOVEREIGN_CHARTER"];
        var otherDoctrine = s.Db.Techs["TECH_DISCARNATION_EDICT"];
        Assert.True(ResearchSystem.Cost(s, p, sovereignDoctrine) < ResearchSystem.Cost(s, p, otherDoctrine));
        Assert.Equal(sovereign, DivergenceSystem.Preferred(s, p));
    }

    [Fact]
    public void Commitment_AppliesEmpireWideModifiers()
    {
        var s = TestWorld.Blank();
        var city = TestWorld.City(s, 0, 10, 10, population: 4);
        var before = CityEffects.Compute(s, city).LoyaltyPerTurn;
        Commit(s, 0, "DIVERGENCE_SOVEREIGN", "TECH_GENOME_REGISTRY");
        var fx = CityEffects.Compute(s, city);
        Assert.Equal(before + 6, fx.LoyaltyPerTurn);                   // +4 Sovereign, +2 Genome Registry tech
        Assert.True(fx.IsImmune(DisasterKind.RiverFlood));             // weather control
        Assert.Contains(fx.Applied, a => a.Source == "Sovereign Path");
    }

    [Fact]
    public void Discarnate_DoNotEat_AndGrowByFabrication_WhenPowered()
    {
        var s = TestWorld.Blank();
        var city = TestWorld.City(s, 0, 10, 10, population: 3);
        Commit(s, 0, "DIVERGENCE_DISCARNATE");
        var report = CityYields.Compute(s, city);
        Assert.Equal(report.Total.Food, report.FoodSurplus);           // no food upkeep
        Assert.True(report.PowerDemand >= 1);                          // citizens draw power

        TestWorld.PlaceDistrict(s, city, "DISTRICT_DAM", s.Map.Neighbor(city.Tile, HexCoord.E), "BUILDING_HYDROELECTRIC_DAM");
        city.IsPowered = true;
        var r = CityYields.Compute(s, city);
        Fx fabricated = r.Total.Production * 25 / 100;
        Fx expected = (r.FoodSurplus + fabricated) * CityYields.HousingGrowthPercent(city.Population, r.Housing) / 100;
        TurnProcessor.Advance(s);
        Assert.True(city.IsPowered);
        Assert.True(fabricated > Fx.Zero);
        Assert.Equal(expected, city.FoodStored);                       // food (no upkeep) + 25% of industry builds bodies
    }

    [Fact]
    public void Substrate_SpreadsFromCores_AndEmitsForTheWoodsItReplaces()
    {
        var s = TestWorld.Blank();
        var city = TestWorld.City(s, 0, 10, 10, population: 6);
        Array.Fill(s.Map.Feature, (short)s.Db.Ids.Forest);
        s.Map.Feature[city.Tile] = -1;
        Commit(s, 0, "DIVERGENCE_DISCARNATE", "TECH_SUBSTRATE_COMPUTING");
        var events = new List<GameEvent>();
        DivergenceSystem.ProcessTurn(s, events);
        Assert.Empty(events); // no Substrate Core yet

        TestWorld.AddBuilding(s, city, "BUILDING_SUBSTRATE_CORE");
        for (int i = 0; i < 5; i++) DivergenceSystem.ProcessTurn(s, events);
        int substrate = s.Db.Terrains.IndexOf("TERRAIN_SUBSTRATE");
        Assert.True(s.Map.Terrain.Count(t => t == substrate) >= 10);   // 2 per turn from the core, plus organic creep
        Assert.True(s.Climate.PendingDeforestation > Fx.Zero);
        Assert.True(DivergenceSystem.WorldShare(s)[Div(s, "DIVERGENCE_DISCARNATE")] > Fx.Zero);
        Assert.Contains(events, e => e.Type == GameEventType.WorldRemade);
    }

    [Fact]
    public void Bloom_SpreadsOnItsOwn_AcrossBorders()
    {
        var s = TestWorld.Blank(width: 30, height: 20);
        var grafted = TestWorld.City(s, 0, 8, 10, population: 6);
        var neighbour = TestWorld.City(s, 1, 13, 10, population: 6);
        var ring = new List<int>();
        s.Map.CollectRadius(neighbour.Tile, 3, ring);
        foreach (int t in ring) CitySystem.ClaimTile(s, neighbour, t);
        Commit(s, 0, "DIVERGENCE_SYMBIONT", "TECH_MYCELIAL_NETWORKS");
        TestWorld.AddBuilding(s, grafted, "BUILDING_BLOOM_HEART");

        var events = new List<GameEvent>();
        for (int i = 0; i < 150 && !events.Any(e => e.Type == GameEventType.BloomEncroached); i++) DivergenceSystem.ProcessTurn(s, events);
        var encroached = events.First(e => e.Type == GameEventType.BloomEncroached);
        Assert.Equal(1, encroached.Player);
        Assert.Equal(s.Db.Features.IndexOf("FEATURE_BLOOM"), s.Map.Feature[encroached.Tile]);
        Assert.Equal(1, s.Map.OwnerPlayer[encroached.Tile]);
    }

    [Fact]
    public void RemadeGround_IsNotOverwrittenByAnotherDivergence()
    {
        var s = TestWorld.Blank();
        int tile = TestWorld.Tile(s, 5, 5);
        var bloom = s.Db.Divergences["DIVERGENCE_SYMBIONT"];
        var substrate = s.Db.Divergences["DIVERGENCE_DISCARNATE"];
        DivergenceSystem.Remake(s, bloom, tile);
        var city = TestWorld.City(s, 0, 6, 5, population: 6);
        Commit(s, 0, "DIVERGENCE_DISCARNATE", "TECH_SUBSTRATE_COMPUTING");
        TestWorld.AddBuilding(s, city, "BUILDING_SUBSTRATE_CORE");
        for (int i = 0; i < 20; i++) DivergenceSystem.ProcessTurn(s, new List<GameEvent>());
        Assert.True(DivergenceSystem.IsRemadeBy(s.Map, bloom, tile));
        Assert.False(DivergenceSystem.IsRemadeBy(s.Map, substrate, tile));
    }

    [Fact]
    public void Sovereign_ReclaimTheDrownedCoast_AndWallTheirLowlands()
    {
        var s = TestWorld.Blank();
        var city = TestWorld.City(s, 0, 10, 10, population: 6);
        int drowned = s.Map.Neighbor(city.Tile, HexCoord.E);
        int lowland = s.Map.Neighbor(city.Tile, HexCoord.W);
        s.Map.Lowland[drowned] = 1;
        s.Map.Lowland[lowland] = 3;
        s.Map.Terrain[drowned] = (byte)s.Db.Ids.Coast;
        s.Map.SetFlag(drowned, TileFlags.Submerged, true);
        Commit(s, 0, "DIVERGENCE_SOVEREIGN", "TECH_STRATOSPHERIC_VEIL", "TECH_TOTAL_RECLAMATION", "TECH_GENOME_REGISTRY", "TECH_ARCOLOGY_DOCTRINE");
        TestWorld.AddBuilding(s, city, "BUILDING_ARCOLOGY_SPIRE");

        var events = new List<GameEvent>();
        DivergenceSystem.ProcessTurn(s, events);
        Assert.False(s.Map.HasFlag(drowned, TileFlags.Submerged));
        Assert.True(s.Map.IsLand(drowned));
        Assert.Equal(s.Db.Terrains.IndexOf("TERRAIN_ENGINEERED"), s.Map.Terrain[drowned]);
        Assert.True(s.Map.HasFlag(lowland, TileFlags.FloodProtected));
        Assert.Contains(events, e => e.Type == GameEventType.LandReclaimed);
    }

    [Fact]
    public void TheVeil_CoolsThePlanet_ButTheClimateCatchesUp()
    {
        var s = TestWorld.Blank();
        var city = TestWorld.City(s, 0, 10, 10, population: 6);
        Commit(s, 0, "DIVERGENCE_SOVEREIGN", "TECH_STRATOSPHERIC_VEIL");
        s.Climate.Co2Ppm = 560;
        s.Climate.Temperature = 2;
        var veil = new QueueItem { Kind = ProductionKind.Project, DefIndex = s.Db.Projects.IndexOf("PROJECT_STRATOSPHERIC_VEIL") };
        Assert.Null(ProductionSystem.Validate(s, city, veil.Kind, veil.DefIndex, -1));
        ProductionSystem.Complete(s, city, veil, new List<GameEvent>());
        Assert.InRange(s.Climate.Temperature.ToDouble(), 1.69, 1.71);
        for (int i = 0; i < 30; i++) ClimateSystem.ProcessTurn(s, new PowerReport(), new List<GameEvent>());
        Assert.True(s.Climate.Temperature > Fx.FromInt(2));            // termination shock: it must be renewed
    }

    [Fact]
    public void Ascension_RequiresARemadeWorld_ThenCompletes()
    {
        var s = TestWorld.Blank();
        var city = TestWorld.City(s, 0, 10, 10, population: 6);
        Commit(s, 0, "DIVERGENCE_DISCARNATE", "TECH_SUBSTRATE_COMPUTING", "TECH_BODY_FABRICATION", "TECH_THERMAL_INDIFFERENCE",
            "TECH_DISTRIBUTED_COGNITION", "TECH_LAST_UPLOAD");
        int upload = s.Db.Projects.IndexOf("PROJECT_LAST_UPLOAD");
        Assert.StartsWith("The world must be remade first", ProductionSystem.Validate(s, city, ProductionKind.Project, upload, -1));
        Assert.Equal("Only the Sovereign can build this.",
            ProductionSystem.Validate(s, city, ProductionKind.Project, s.Db.Projects.IndexOf("PROJECT_ETERNAL_BASTION"), -1));

        var d = s.Db.Divergences["DIVERGENCE_DISCARNATE"];
        int needed = s.Map.Count / 10 + 1;
        for (int t = 0, done = 0; t < s.Map.Count && done < needed; t++)
            if (s.Map.District[t] < 0) { DivergenceSystem.Remake(s, d, t); done++; }
        Assert.Null(ProductionSystem.Validate(s, city, ProductionKind.Project, upload, -1));

        var events = new List<GameEvent>();
        ProductionSystem.Complete(s, city, new QueueItem { Kind = ProductionKind.Project, DefIndex = upload }, events);
        Assert.True(s.Players[0].Ascended);
        Assert.Contains(events, e => e.Type == GameEventType.AscensionCompleted);
    }

    [Fact]
    public void Terraforming_ImprovementsRemakeTheTile()
    {
        var s = TestWorld.Blank();
        var city = TestWorld.City(s, 0, 10, 10, population: 3);
        int t = s.Map.Neighbor(city.Tile, HexCoord.E);
        s.Map.Feature[t] = (short)s.Db.Ids.Forest;
        Commit(s, 0, "DIVERGENCE_DISCARNATE", "TECH_SUBSTRATE_COMPUTING");
        var builder = new UnitState { Id = s.AllocateId(), Owner = 0, DefIndex = s.Db.Units.IndexOf("UNIT_BUILDER"), Tile = t, Charges = 2, MovesLeft = 2 };
        s.AddUnit(builder);
        var r = CommandProcessor.Execute(s, new BuildImprovementCommand { Player = 0, UnitId = builder.Id, Improvement = s.Db.Improvements.IndexOf("IMPROVEMENT_SUBSTRATE_ARRAY") }, new());
        Assert.True(r.Ok, r.Error);
        Assert.Equal(s.Db.Terrains.IndexOf("TERRAIN_SUBSTRATE"), s.Map.Terrain[t]);
        Assert.Equal(-1, s.Map.Feature[t]);
    }

    [Fact]
    public void Ai_ChoosesTheDoctrineItsHistorySupports()
    {
        var s = TestWorld.Blank(leaders: new[] { "LEADER_TAIZU_SONG" });
        var city = TestWorld.City(s, 0, 10, 10, population: 8);
        TestWorld.PlaceDistrict(s, city, "DISTRICT_ACADEMY", s.Map.Neighbor(city.Tile, HexCoord.E),
            "BUILDING_LIBRARY", "BUILDING_UNIVERSITY", "BUILDING_RESEARCH_LAB");
        var p = s.Players[0];
        p.Techs = s.Db.Techs.Select(t => t.DivergenceIndex < 0).ToArray(); // reached the Threshold
        var commands = new SimpleAi().TakeTurn(s, 0).ToList();
        var research = Assert.Single(commands.OfType<SetResearchCommand>());
        Assert.Equal(Tech(s, "TECH_DISCARNATION_EDICT"), research.Tech);
    }

    [Fact]
    public void Divergence_SurvivesSnapshots_AndShapesAttitudes()
    {
        var s = TestWorld.Blank(players: 3);
        TestWorld.City(s, 0, 4, 4);
        Commit(s, 0, "DIVERGENCE_SYMBIONT");
        Commit(s, 1, "DIVERGENCE_SYMBIONT");
        Commit(s, 2, "DIVERGENCE_SOVEREIGN");
        var back = GameStateSerializer.Deserialize(GameStateSerializer.Serialize(s), s.Db);
        Assert.Equal(s.Players[0].Divergence, back.Players[0].Divergence);
        Assert.Equal(GameStateSerializer.Hash(s), GameStateSerializer.Hash(back));
        Assert.Equal(6, DivergenceSystem.Attitude(s.Db, s.Players[0], s.Players[1]));
        Assert.Equal(-8, DivergenceSystem.Attitude(s.Db, s.Players[0], s.Players[2]));
    }
}
