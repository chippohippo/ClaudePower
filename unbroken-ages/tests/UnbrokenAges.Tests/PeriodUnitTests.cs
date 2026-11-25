namespace UnbrokenAges.Tests;

/// <summary>The generic line through the ages: upgrade chains, siege, aircraft and anti-cavalry, and every unit's look.</summary>
public class PeriodUnitTests
{
    [Fact]
    public void TheLine_UpgradesFromWarriorToMechanizedInfantry()
    {
        var db = TestWorld.Db;
        var chain = new List<string> { "UNIT_WARRIOR" };
        while (db.Units[chain[^1]].UpgradesTo.FirstOrDefault() is { } next) chain.Add(next);
        Assert.Equal(new[] { "UNIT_WARRIOR", "UNIT_SWORDSMAN", "UNIT_MUSKETMAN", "UNIT_RIFLEMAN", "UNIT_INFANTRY", "UNIT_MECH_INFANTRY", "UNIT_AEGIS_TROOPER", "UNIT_SENTINEL_LANCE", "UNIT_TITAN_GUARD" }, chain);
        // Each step is stronger than the last, and the eras advance.
        for (int i = 1; i < chain.Count; i++) Assert.True(db.Units[chain[i]].Strength > db.Units[chain[i - 1]].Strength, chain[i]);
        Assert.Contains("UNIT_CROSSBOWMAN", db.Units["UNIT_ARCHER"].UpgradesTo);
        Assert.Contains("UNIT_MODERN_ARMOR", db.Units["UNIT_TANK"].UpgradesTo);
        Assert.Contains("UNIT_BATTLESHIP", db.Units["UNIT_IRONCLAD"].UpgradesTo);
    }

    [Fact]
    public void UniqueUnits_FollowTheirGenericsUpgradePath()
    {
        var s = TestWorld.Blank(width: 30, height: 20, players: 2, leaders: new[] { "LEADER_TOKUGAWA", null });
        TestWorld.City(s, 0, 8, 10);
        var samurai = TestWorld.Unit(s, 0, "UNIT_SAMURAI", 9, 10);
        Assert.Contains(s.Db.Units.IndexOf("UNIT_MUSKETMAN"), UpgradeSystem.Targets(s, samurai));
    }

    [Fact]
    public void SiegeEngines_BreakWalls_ButFareBadlyAgainstTroops()
    {
        var s = TestWorld.Blank(width: 30, height: 20, players: 2);
        TestWorld.City(s, 0, 5, 10);
        TestWorld.City(s, 1, 12, 10);
        var catapult = TestWorld.Unit(s, 0, "UNIT_CATAPULT", 10, 10);
        var enemy = TestWorld.Unit(s, 1, "UNIT_WARRIOR", 10, 12);
        CommandProcessor.Execute(s, new DeclareWarCommand { Player = 0, Target = 1 }, new());
        var vsCity = CombatSystem.UnitStrength(s, catapult, null, true, true, catapult.Tile, TestWorld.Tile(s, 12, 10));
        var vsTroops = CombatSystem.UnitStrength(s, catapult, enemy, true, true, catapult.Tile, enemy.Tile);
        Assert.Contains(vsCity.Lines, l => l.Label == "Siege weapons against walls" && l.Value > 0);
        Assert.Contains(vsTroops.Lines, l => l.Label == "Siege weapons against troops" && l.Value < 0);
    }

    [Fact]
    public void Aircraft_FlyOverWaterAndMountains()
    {
        var s = TestWorld.Blank(width: 30, height: 20, players: 2);
        var fighter = TestWorld.Unit(s, 0, "UNIT_FIGHTER", 5, 10);
        s.Map.Terrain[TestWorld.Tile(s, 6, 10)] = (byte)s.Db.Terrains.First(t => t.Class == TerrainClass.Ocean).Index;
        Assert.Equal(1, Movement.TerrainCost(s, fighter, fighter.Tile, TestWorld.Tile(s, 6, 10)));
        var spear = TestWorld.Unit(s, 0, "UNIT_SPEARMAN", 5, 12);
        Assert.Equal(2, Movement.TerrainCost(s, spear, spear.Tile, TestWorld.Tile(s, 6, 10)));   // foot soldiers must board boats (embark)
    }

    [Fact]
    public void Pikemen_StopKnights_AndAntiTankCrewsStopTanks()
    {
        var s = TestWorld.Blank(width: 30, height: 20, players: 2);
        var knight = TestWorld.Unit(s, 0, "UNIT_KNIGHT", 5, 10);
        var pike = TestWorld.Unit(s, 1, "UNIT_PIKEMAN", 6, 10);
        Assert.Contains(CombatSystem.UnitStrength(s, knight, pike, true, false, knight.Tile, pike.Tile).Lines, l => l.Label.StartsWith("Weak against") && l.Value < 0);
        var tank = TestWorld.Unit(s, 0, "UNIT_TANK", 5, 14);
        var crew = TestWorld.Unit(s, 1, "UNIT_AT_CREW", 6, 14);
        Assert.Contains(CombatSystem.UnitStrength(s, crew, tank, false, false, tank.Tile, crew.Tile).Lines, l => l.Label.StartsWith("Strong against") && l.Value > 0);
    }

    [Fact]
    public void EveryUnitLook_PointsAtAModelThatExists()
    {
        var models = Path.Combine(TestWorld.RepoRoot, "godot", "assets", "models");
        foreach (var u in TestWorld.Db.Units)
        {
            if (u.Look is not { } look) continue;
            Assert.True(File.Exists(Path.Combine(models, look.Model + ".glb")), $"{u.Id}: no model {look.Model}");
            if (look.Rider != null) Assert.True(File.Exists(Path.Combine(models, look.Rider + ".glb")), $"{u.Id}: no rider {look.Rider}");
            if (look.Addon != null) Assert.True(File.Exists(Path.Combine(models, look.Addon + ".glb")), $"{u.Id}: no addon {look.Addon}");
            Assert.InRange(look.Count, 1, 7);
        }
        // Every military unit has a look of its own.
        Assert.All(TestWorld.Db.Units.Where(u => u.Strength > 0 && !u.Tags.Any(t => t is "Augmented" or "Living" or "Machine")), u => Assert.NotNull(u.Look));
    }
}
