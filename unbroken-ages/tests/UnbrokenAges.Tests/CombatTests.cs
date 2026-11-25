namespace UnbrokenAges.Tests;

public class CombatTests
{
    private static UnitState Spawn(GameState s, int owner, string unit, int tile, int hp = 100)
    {
        var u = new UnitState { Id = s.AllocateId(), Owner = owner, DefIndex = s.Db.Units.IndexOf(unit), Tile = tile, Hp = hp, MovesLeft = s.Db.Units[unit].Moves };
        s.AddUnit(u);
        return u;
    }

    private static GameState AtWar(int width = 30)
    {
        var s = TestWorld.Blank(width: width, height: 20);
        CommandProcessor.Execute(s, new DeclareWarCommand { Player = 0, Target = 1 }, new());
        return s;
    }

    [Theory]
    [InlineData("1", 2.0)]
    [InlineData("0.5", 1.41421)]
    [InlineData("-1", 0.5)]
    [InlineData("3.25", 9.51366)]
    [InlineData("-2.5", 0.17678)]
    public void Pow2_IsAccurate(string x, double expected) =>
        Assert.InRange(Fx.Pow2(Fx.Parse(x)).ToDouble(), expected * 0.999, expected * 1.001);

    [Fact]
    public void Attacks_RequireWar_AndAnEvenFightDealsAboutThirty()
    {
        var s = TestWorld.Blank(width: 30, height: 20);
        var a = Spawn(s, 0, "UNIT_WARRIOR", TestWorld.Tile(s, 10, 10));
        Spawn(s, 1, "UNIT_WARRIOR", TestWorld.Tile(s, 11, 10));
        Assert.Equal("You are not at war with them.", CombatSystem.Preview(s, a, TestWorld.Tile(s, 11, 10)).Reason);
        CommandProcessor.Execute(s, new DeclareWarCommand { Player = 0, Target = 1 }, new());
        var p = CombatSystem.Preview(s, a, TestWorld.Tile(s, 11, 10));
        Assert.True(p.Legal);
        Assert.Equal(p.Attacker.Total, p.Defender.Total);
        Assert.Equal((24, 36), (p.DefenderDamageMin, p.DefenderDamageMax));
        Assert.Equal((24, 36), (p.AttackerDamageMin, p.AttackerDamageMax));
    }

    [Fact]
    public void Preview_ExplainsTerrainFortificationRiversAndCounters()
    {
        var s = AtWar();
        int from = TestWorld.Tile(s, 10, 10), to = TestWorld.Tile(s, 11, 10);
        s.Map.Relief[to] = (byte)s.Db.Ids.Hills;
        s.Map.Feature[to] = (short)s.Db.Ids.Forest;
        s.Map.SetRiverEdge(from, HexCoord.E, true);
        var a = Spawn(s, 0, "UNIT_HORSEMAN", from);
        var d = Spawn(s, 1, "UNIT_WARRIOR", to);
        d.Fortified = true;
        var p = CombatSystem.Preview(s, a, to);
        Assert.Contains(p.Defender.Lines, l => l.Label == "Terrain" && l.Value == 6);
        Assert.Contains(p.Defender.Lines, l => l.Label == "Fortified" && l.Value == 4);
        Assert.Contains(p.Attacker.Lines, l => l.Label == "Attacking across a river" && l.Value == -5);

        var drone = Spawn(s, 0, "UNIT_DRONE_SWARM", TestWorld.Tile(s, 5, 5));
        var tank = Spawn(s, 1, "UNIT_TANK", TestWorld.Tile(s, 6, 5));
        Assert.Contains(CombatSystem.Preview(s, drone, tank.Tile).Attacker.Lines, l => l.Label == "Strong against Tank" && l.Value == 10);
    }

    [Fact]
    public void Flanking_RewardsSurroundingTheDefender()
    {
        var s = AtWar();
        int target = TestWorld.Tile(s, 12, 10);
        var a = Spawn(s, 0, "UNIT_WARRIOR", s.Map.Neighbor(target, HexCoord.W));
        Spawn(s, 1, "UNIT_WARRIOR", target);
        int before = CombatSystem.Preview(s, a, target).Attacker.Total;
        Spawn(s, 0, "UNIT_WARRIOR", s.Map.Neighbor(target, HexCoord.E));
        Assert.Equal(before + 2, CombatSystem.Preview(s, a, target).Attacker.Total);
    }

    [Fact]
    public void Melee_DamagesBothSides_AndTheVictorAdvances()
    {
        var s = AtWar();
        int target = TestWorld.Tile(s, 11, 10);
        var a = Spawn(s, 0, "UNIT_SWORDSMAN", TestWorld.Tile(s, 10, 10));
        var d = Spawn(s, 1, "UNIT_WARRIOR", target, hp: 5);
        var preview = CombatSystem.Preview(s, a, target);
        Assert.True(preview.CertainKill);
        var events = new List<GameEvent>();
        Assert.True(CommandProcessor.Execute(s, new AttackCommand { Player = 0, UnitId = a.Id, TargetTile = target }, events).Ok);
        Assert.Null(s.GetUnit(d.Id));
        Assert.Equal(target, a.Tile);
        Assert.InRange(a.Hp, 100 - preview.AttackerDamageMax, 100 - preview.AttackerDamageMin);
        Assert.Contains(events, e => e.Type == GameEventType.BattleFought);
        Assert.Contains(events, e => e.Type == GameEventType.UnitDestroyed && e.Player == 1);
        Assert.Equal("Already attacked this turn.", new AttackCommand { Player = 0, UnitId = a.Id, TargetTile = target }.Validate(s));
    }

    [Fact]
    public void Ranged_HitsFromAfar_WithoutTakingDamage()
    {
        var s = AtWar();
        var archer = Spawn(s, 0, "UNIT_ARCHER", TestWorld.Tile(s, 10, 10));
        var d = Spawn(s, 1, "UNIT_WARRIOR", TestWorld.Tile(s, 12, 10));
        var far = Spawn(s, 1, "UNIT_WARRIOR", TestWorld.Tile(s, 14, 10));
        Assert.Equal("Out of range.", CombatSystem.Preview(s, archer, far.Tile).Reason);
        Assert.True(CommandProcessor.Execute(s, new AttackCommand { Player = 0, UnitId = archer.Id, TargetTile = d.Tile }, new()).Ok);
        Assert.Equal(100, archer.Hp);
        Assert.True(d.Hp < 100);
        Assert.Equal(TestWorld.Tile(s, 10, 10), archer.Tile);
    }

    [Fact]
    public void Civilians_AreCaptured_NotFought()
    {
        var s = AtWar();
        var a = Spawn(s, 0, "UNIT_WARRIOR", TestWorld.Tile(s, 10, 10));
        var settler = Spawn(s, 1, "UNIT_SETTLER", TestWorld.Tile(s, 11, 10));
        Assert.True(CombatSystem.Preview(s, a, settler.Tile).CapturesCivilian);
        CommandProcessor.Execute(s, new AttackCommand { Player = 0, UnitId = a.Id, TargetTile = settler.Tile }, new());
        Assert.Equal(0, settler.Owner);
        Assert.Equal(100, a.Hp);
    }

    [Fact]
    public void Cities_AreBesieged_ThenCaptured_ByMelee()
    {
        var s = AtWar();
        s.Players[1].Techs = new bool[s.Db.Techs.Count];      // an Ancient-era defender
        s.Players[1].Civics = new bool[s.Db.Civics.Count];
        var city = TestWorld.City(s, 1, 14, 10, population: 4);
        TestWorld.City(s, 1, 25, 10); // capital elsewhere, so this one isn't the capital
        int adjacent = s.Map.Neighbor(city.Tile, HexCoord.W);
        var archer = Spawn(s, 0, "UNIT_ARCHER", s.Map.Neighbor(adjacent, HexCoord.W));
        var sword = Spawn(s, 0, "UNIT_SWORDSMAN", adjacent);
        Assert.Equal(Movement.Impassable, Movement.EnterCost(s, sword, adjacent, city.Tile));

        CommandProcessor.Execute(s, new AttackCommand { Player = 0, UnitId = archer.Id, TargetTile = city.Tile }, new());
        Assert.True(city.Hp < 100);
        city.Hp = 1;
        var events = new List<GameEvent>();
        Assert.True(CommandProcessor.Execute(s, new AttackCommand { Player = 0, UnitId = sword.Id, TargetTile = city.Tile }, events).Ok);
        Assert.Equal(0, city.Owner);
        Assert.Equal(city.Tile, sword.Tile);
        Assert.Equal(3, city.Population);
        Assert.Contains(events, e => e.Type == GameEventType.CityCaptured);
        Assert.Equal(Fx.FromInt(20), DiplomacySystem.GrievanceTotal(s, 1, 0) - 40); // +40 from the surprise war
        Assert.Contains(s.Chronicle, c => c.Text.Contains("captures"));
        Assert.True(s.World.Strife >= 18);                                         // war +10, capture +8
    }

    [Fact]
    public void WalledCities_BombardOncePerTurn_AndHealOverTime()
    {
        var s = AtWar();
        var city = TestWorld.City(s, 1, 14, 10, population: 4);
        TestWorld.AddBuilding(s, city, "BUILDING_ANCIENT_WALLS");
        var raider = Spawn(s, 0, "UNIT_WARRIOR", s.Map.Neighbor(city.Tile, HexCoord.W));
        Assert.True(CommandProcessor.Execute(s, new CityStrikeCommand { Player = 1, CityId = city.Id, TargetTile = raider.Tile }, new()).Ok);
        Assert.True(raider.Hp < 100);
        Assert.Equal("This city has already fired this turn.", new CityStrikeCommand { Player = 1, CityId = city.Id, TargetTile = raider.Tile }.Validate(s));
        city.Hp = 50;
        CombatSystem.ProcessTurn(s);
        Assert.Equal(70, city.Hp);
        Assert.False(city.StruckThisTurn);
        Assert.Equal(200, CombatSystem.CityMaxHp(s, city));
    }

    [Fact]
    public void OutOfSupplyPenalty_AppliesOnlyWithTheGrandDial()
    {
        var s = AtWar();
        var lost = Spawn(s, 0, "UNIT_WARRIOR", TestWorld.Tile(s, 20, 15));
        var enemy = Spawn(s, 1, "UNIT_WARRIOR", TestWorld.Tile(s, 21, 15));
        Assert.DoesNotContain(CombatSystem.Preview(s, lost, enemy.Tile).Attacker.Lines, l => l.Label == "Out of supply");
        s.Options.SupplyCombatPenalty = true;
        Assert.Contains(CombatSystem.Preview(s, lost, enemy.Tile).Attacker.Lines, l => l.Label == "Out of supply" && l.Value == -5);
    }

    [Fact]
    public void Combat_IsDeterministic_AndSurvivesSnapshots()
    {
        int Fight()
        {
            var s = AtWar();
            var a = Spawn(s, 0, "UNIT_WARRIOR", TestWorld.Tile(s, 10, 10));
            var d = Spawn(s, 1, "UNIT_WARRIOR", TestWorld.Tile(s, 11, 10));
            var back = GameStateSerializer.Deserialize(GameStateSerializer.Serialize(s), s.Db);
            var cmd = (AttackCommand)GameCommand.Deserialize(new AttackCommand { Player = 0, UnitId = a.Id, TargetTile = d.Tile }.Serialize());
            CommandProcessor.Execute(back, cmd, new());
            return back.GetUnit(d.Id)!.Hp * 1000 + back.GetUnit(a.Id)!.Hp;
        }
        Assert.Equal(Fight(), Fight());
    }
}
