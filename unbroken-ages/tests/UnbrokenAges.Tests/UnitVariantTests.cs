namespace UnbrokenAges.Tests;

public class UnitVariantTests
{
    private static int U(GameState s, string id) => s.Db.Units.IndexOf(id);

    private static int V(GameState s, string unit, string variant) =>
        UnitStats.VariantsOf(s.Db, U(s, unit)).Select((v, i) => (v, i)).First(x => x.v.Id == variant).i;

    private static (GameState S, UnitState Warrior) HomeWarrior(string?[]? leaders = null, bool allTech = true)
    {
        var s = TestWorld.Blank(width: 30, leaders: leaders, allTech: allTech);
        TestWorld.City(s, 0, 10, 10);
        var u = TestWorld.Unit(s, 0, "UNIT_WARRIOR", 10, 10);
        u.Hp = 70;
        s.Players[0].Gold = 300;
        s.Players[0].Stockpile[s.Db.Resources.IndexOf("RESOURCE_IRON")] = 10;
        return (s, u);
    }

    [Fact]
    public void AWarrior_UpgradesToAHeavySwordsman()
    {
        var (s, u) = HomeWarrior();
        int heavy = V(s, "UNIT_SWORDSMAN", "HEAVY");
        Assert.Equal(120, UpgradeSystem.GoldCost(s, u, U(s, "UNIT_SWORDSMAN"), heavy));    // (90 − 40) × 2 × 120%
        var events = new List<GameEvent>();
        Assert.True(CommandProcessor.Execute(s, new UpgradeUnitCommand { Player = 0, UnitId = u.Id, Target = U(s, "UNIT_SWORDSMAN"), Variant = heavy }, events).Ok);

        Assert.Equal((U(s, "UNIT_SWORDSMAN"), heavy, 70), (u.DefIndex, u.Variant, u.Hp));
        Assert.Equal(Fx.FromInt(180), s.Players[0].Gold);
        Assert.Equal(0, s.Players[0].Stockpile[s.Db.Resources.IndexOf("RESOURCE_IRON")]);
        Assert.Equal(Fx.Zero, u.MovesLeft);
        Assert.Equal(40, UnitStats.Strength(s, u));                                        // 35 × 115%
        Assert.Equal(1, UnitStats.Moves(s, u));
        Assert.Equal("Swordsman (Heavy)", Assert.Single(events, e => e.Type == GameEventType.UnitUpgraded).Detail);
    }

    [Fact]
    public void Upgrades_ExplainWhatIsMissing()
    {
        var (s, u) = HomeWarrior();
        int sword = U(s, "UNIT_SWORDSMAN");
        UpgradeUnitCommand Cmd(int target, int variant) => new() { Player = 0, UnitId = u.Id, Target = target, Variant = variant };

        Assert.Equal("Cannot upgrade to that unit.", Cmd(U(s, "UNIT_ARCHER"), 0).Validate(s));
        Assert.Equal("Choose a variant: Line, Heavy, Fordsmen.", Cmd(sword, -1).Validate(s));
        s.Players[0].Stockpile[s.Db.Resources.IndexOf("RESOURCE_IRON")] = 5;
        Assert.Equal("Needs 10 Iron.", Cmd(sword, 0).Validate(s));
        s.Players[0].Stockpile[s.Db.Resources.IndexOf("RESOURCE_IRON")] = 10;
        s.Players[0].Gold = 50;
        Assert.Equal("Costs 100 gold.", Cmd(sword, 0).Validate(s));
        s.Players[0].Gold = 500;
        u.Tile = TestWorld.Tile(s, 20, 10);
        Assert.Equal("Units upgrade inside your own territory.", Cmd(sword, 0).Validate(s));

        var (raw, w) = HomeWarrior(allTech: false);
        Assert.Equal("Requires Bronze Working.", new UpgradeUnitCommand { Player = 0, UnitId = w.Id, Target = sword, Variant = 0 }.Validate(raw));
    }

    [Fact]
    public void UniqueUnits_StandInForWhatTheyReplace_AndInheritItsVariants()
    {
        var (s, u) = HomeWarrior(leaders: new[] { "LEADER_TAIZU_SONG" });
        Assert.Equal(new[] { U(s, "UNIT_FIRE_LANCE_CORPS") }, UpgradeSystem.Targets(s, u));
        Assert.Equal(3, UnitStats.VariantsOf(s.Db, U(s, "UNIT_FIRE_LANCE_CORPS")).Count);
        Assert.True(CommandProcessor.Execute(s, new UpgradeUnitCommand
            { Player = 0, UnitId = u.Id, Target = U(s, "UNIT_FIRE_LANCE_CORPS"), Variant = V(s, "UNIT_SWORDSMAN", "FORDSMEN") }, new()).Ok);
        Assert.Equal("Fire Lance Corps (Fordsmen)", UnitStats.Name(s, u));
    }

    [Fact]
    public void Variants_ShowUpInTheCombatPreview()
    {
        var s = TestWorld.Blank(width: 30);
        CommandProcessor.Execute(s, new DeclareWarCommand { Player = 0, Target = 1 }, new());
        int from = TestWorld.Tile(s, 10, 10);
        int target = s.Map.Neighbor(from, HexCoord.E);
        s.Map.SetRiverEdge(from, HexCoord.E, true);
        TestWorld.Unit(s, 1, "UNIT_WARRIOR", 11, 10);

        var fordsmen = TestWorld.Unit(s, 0, "UNIT_SWORDSMAN", 10, 10);
        fordsmen.Variant = V(s, "UNIT_SWORDSMAN", "FORDSMEN");
        var lines = CombatSystem.Preview(s, fordsmen, target).Attacker.Lines;
        Assert.Contains(lines, l => l.Label == "Fordsmen variant" && l.Value == -4);           // 35 → 31
        Assert.Contains(lines, l => l.Label == "Across a river (fords it)" && l.Value == 0);

        fordsmen.Variant = V(s, "UNIT_SWORDSMAN", "LINE");
        Assert.Contains(CombatSystem.Preview(s, fordsmen, target).Attacker.Lines, l => l.Label == "Attacking across a river" && l.Value == -5);
    }

    [Fact]
    public void ALongbow_ReachesThreeTiles_AndARamFightsInMelee()
    {
        var s = TestWorld.Blank(width: 30);
        CommandProcessor.Execute(s, new DeclareWarCommand { Player = 0, Target = 1 }, new());
        var archer = TestWorld.Unit(s, 0, "UNIT_ARCHER", 5, 10);
        TestWorld.Unit(s, 1, "UNIT_WARRIOR", 8, 10);
        int three = TestWorld.Tile(s, 8, 10);
        Assert.Equal("Out of range.", CombatSystem.Preview(s, archer, three).Reason);
        archer.Variant = V(s, "UNIT_ARCHER", "LONGBOW");
        var preview = CombatSystem.Preview(s, archer, three);
        Assert.True(preview.Legal);
        Assert.Contains(preview.Attacker.Lines, l => l.Label == "Longbow variant" && l.Value == -4);   // 25 → 21

        var ram = TestWorld.Unit(s, 0, "UNIT_IRONCLAD", 20, 10);
        ram.Variant = V(s, "UNIT_IRONCLAD", "RAM");
        Assert.False(UnitStats.IsRanged(s, ram));
        Assert.Equal(72, UnitStats.Strength(s, ram));                                              // 60 × 120%
    }

    [Fact]
    public void CityBuiltUnits_TakeTheStandardVariant_AndVariantsSurviveSnapshots()
    {
        var s = TestWorld.Blank();
        Assert.Equal(0, UnitStats.DefaultVariant(s.Db, U(s, "UNIT_SWORDSMAN")));
        Assert.Equal(-1, UnitStats.DefaultVariant(s.Db, U(s, "UNIT_WARRIOR")));
        var u = TestWorld.Unit(s, 0, "UNIT_ARCHER", 4, 4);
        u.Variant = 2;
        var back = GameStateSerializer.Deserialize(GameStateSerializer.Serialize(s), s.Db);
        Assert.Equal(2, back.GetUnit(u.Id)!.Variant);
        Assert.Equal(3, UnitStats.Moves(back, back.GetUnit(u.Id)!));                               // Skirmishers: 2 + 1
    }

    [Fact]
    public void AUnitWithASingleVariant_IsRejectedAtLoad()
    {
        var ex = Assert.Throws<ModLoadException>(() => ModLoader.LoadFromStrings(TestWorld.BaseDocuments().Append(("testmod",
            """{ "units": [ { "id": "UNIT_X", "name": "X", "domain": "Land", "variants": [ { "id": "ONLY", "name": "Only" } ] } ] }"""))));
        Assert.Contains(ex.Errors, e => e.Contains("at least two"));
    }
}
