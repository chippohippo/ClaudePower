namespace UnbrokenAges.Tests;

/// <summary>Unique units for every nation; corps and armies.</summary>
public class RosterTests
{
    [Fact]
    public void EveryNation_HasAUniqueUnit_ThatReplacesAndBetters_AGenericOne()
    {
        var db = TestWorld.Db;
        foreach (var civ in db.Civilizations)
        {
            var unique = db.Units.Where(u => u.CivilizationIndex == civ.Index).ToList();
            Assert.True(unique.Count >= 1, $"{civ.Id} has no unique unit");
            foreach (var u in unique)
            {
                Assert.True(u.ReplacesIndex >= 0, $"{u.Id} replaces nothing");
                var g = db.Units[u.ReplacesIndex];
                Assert.Equal(g.UnitClass, u.UnitClass);
                Assert.Equal(g.Domain, u.Domain);
                bool better = u.Strength > g.Strength || u.RangedStrength > g.RangedStrength || u.Moves > g.Moves || u.Range > g.Range ||
                              u.Cost < g.Cost || (g.ResourceCost != null && u.ResourceCost == null) || u.StrongAgainst.Count > g.StrongAgainst.Count;
                Assert.True(better, $"{u.Id} is no better than {g.Id}");
                Assert.True(u.UpgradesTo.Count == 0 || u.UpgradesTo.SequenceEqual(g.UpgradesTo), $"{u.Id} strays from {g.Id}'s upgrade path");   // unset: inherited
            }
        }
    }

    [Fact]
    public void UniqueUnits_ReplaceTheGeneric_InTheirNationsQueue()
    {
        var s = TestWorld.Blank(width: 30, height: 20, players: 2, leaders: new[] { "LEADER_AUGUSTUS", null });
        var rome = TestWorld.City(s, 0, 5, 10);
        var other = TestWorld.City(s, 1, 20, 10);
        s.Players[0].Stockpile[s.Db.Resources.IndexOf("RESOURCE_IRON")] = 50;
        s.Players[1].Stockpile[s.Db.Resources.IndexOf("RESOURCE_IRON")] = 50;
        int legion = s.Db.Units.IndexOf("UNIT_LEGION"), sword = s.Db.Units.IndexOf("UNIT_SWORDSMAN");
        Assert.Null(ProductionSystem.CanEnqueue(s, rome, ProductionKind.Unit, legion, -1));
        Assert.NotNull(ProductionSystem.CanEnqueue(s, rome, ProductionKind.Unit, sword, -1));
        Assert.NotNull(ProductionSystem.CanEnqueue(s, other, ProductionKind.Unit, legion, -1));
    }

    private static string? Run(GameState s, GameCommand cmd) => CommandProcessor.Execute(s, cmd, new()) is { Ok: false } r ? r.Error : null;

    [Fact]
    public void TwoOfAKind_FormACorps_ThenAnArmy()
    {
        var s = TestWorld.Blank(width: 30, height: 20);
        var a = TestWorld.Unit(s, 0, "UNIT_SWORDSMAN", 10, 10);
        var b = TestWorld.Unit(s, 0, "UNIT_SWORDSMAN", 11, 10);
        var c = TestWorld.Unit(s, 0, "UNIT_SWORDSMAN", 10, 11);
        var archer = TestWorld.Unit(s, 0, "UNIT_ARCHER", 9, 10);
        b.Experience = 20;
        b.Promotions.Add(s.Db.Promotions.IndexOf("PROMOTION_BATTLECRY"));
        Assert.Equal("Both must be the same type of unit.", SocietySystem.CanForm(s, a, archer));
        s.Players[0].Civics[s.Db.Civics.IndexOf("CIVIC_URBANIZATION")] = false;
        Assert.Equal("Corps need Urbanization.", SocietySystem.CanForm(s, a, b));
        s.Players[0].Civics[s.Db.Civics.IndexOf("CIVIC_URBANIZATION")] = true;

        Assert.Null(Run(s, new FormCorpsCommand { Player = 0, UnitId = a.Id, PartnerId = b.Id }));
        Assert.Null(s.GetUnit(b.Id));
        Assert.Equal(1, a.Formation);
        Assert.Equal(20, a.Experience);   // the better veteran's record
        Assert.Contains(a.Promotions, p => s.Db.Promotions[p].Id == "PROMOTION_BATTLECRY");
        Assert.Equal("Swordsman (Line) Corps".Replace(" (Line)", UnitStats.VariantOf(s, a) is { } v ? $" ({v.Name})" : ""), UnitStats.Name(s, a));
        Assert.Contains(SocietySystem.CombatLines(s, a, true, false, a.Tile), l => l.Label == "Corps" && l.Value == 10);
        Assert.Equal("Both need moves left.", SocietySystem.CanForm(s, a, c));

        a.MovesLeft = Fx.FromInt(2);
        Assert.Null(Run(s, new FormCorpsCommand { Player = 0, UnitId = a.Id, PartnerId = c.Id }));
        Assert.Equal(2, a.Formation);
        Assert.Contains(SocietySystem.CombatLines(s, a, true, false, a.Tile), l => l.Label == "Army" && l.Value == 17);
        var d = TestWorld.Unit(s, 0, "UNIT_SWORDSMAN", 11, 10);
        a.MovesLeft = Fx.FromInt(2);
        Assert.Equal("An army is as large as a formation gets.", SocietySystem.CanForm(s, a, d));
    }

    [Fact]
    public void Formations_SurviveASave()
    {
        var s = TestWorld.Blank(width: 30, height: 20);
        var a = TestWorld.Unit(s, 0, "UNIT_SWORDSMAN", 10, 10);
        a.Formation = 2;
        var back = GameStateSerializer.Deserialize(GameStateSerializer.Serialize(s), s.Db);
        Assert.Equal(2, back.GetUnit(a.Id)!.Formation);
        var cmd = new FormCorpsCommand { Player = 0, UnitId = 3, PartnerId = 4 };
        Assert.Equal(cmd.Serialize(), GameCommand.Deserialize(cmd.Serialize()).Serialize());
    }
}
