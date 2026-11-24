namespace UnbrokenAges.Tests;

/// <summary>Leaders of the World Wars: content, and the doctrine engine (unit conditions, war and peace, player-level effects).</summary>
public class WartimeLeaderTests
{
    private static GameState World(string leader) => TestWorld.Blank(width: 30, height: 20, players: 2, leaders: new[] { leader, null });

    private static bool IsCost(ModifierDef m) => m.Amount < Fx.Zero && m.Effect != ModifierEffect.WarWearinessPercent ||
                                                 m.Effect == ModifierEffect.WarWearinessPercent && m.Amount > Fx.Zero ||
                                                 m.Effect == ModifierEffect.CityEmissionsPercent && m.Amount > Fx.Zero;

    [Fact]
    public void SixteenWartimeLeaders_EachWithABigBonus_AndARealCost()
    {
        var db = TestWorld.Db;
        var ww = db.Leaders.Where(l => l.HasTag("WorldWars")).ToList();
        Assert.Equal(16, ww.Count);
        Assert.Equal(ww.Count, ww.Select(l => l.Id).Distinct().Count());
        foreach (var l in ww)
        {
            var mods = l.Ability.Modifiers;
            Assert.True(mods.Count >= 3, $"{l.Id} needs a doctrine, not a tweak");
            Assert.Contains(mods, m => !IsCost(m));
            Assert.True(mods.Any(IsCost), $"{l.Id} has no cost");
            Assert.NotEmpty(l.Augment.Params);
            Assert.False(string.IsNullOrWhiteSpace(l.Epithet));
        }
        // Leaders that existed before keep a single definition, now with their doctrine.
        Assert.Single(db.Leaders, l => l.Id == "LEADER_VARGAS");
        Assert.True(db.Leaders["LEADER_WILHELMINA"].HasTag("WorldWars"));
        Assert.All(db.Civilizations, c => Assert.True(db.Leaders.Count(l => l.CivilizationIndex == c.Index) >= 2));
    }

    [Fact]
    public void Churchill_IsAFortress_Tojo_StrikesAbroad()
    {
        var s = World("LEADER_CHURCHILL");
        var london = TestWorld.City(s, 0, 8, 10);
        var home = TestWorld.Unit(s, 0, "UNIT_WARRIOR", 9, 10);
        var away = TestWorld.Unit(s, 0, "UNIT_WARRIOR", 25, 10);
        Assert.Contains(SocietySystem.CombatLines(s, home, true, false, home.Tile), l => l.Label == "We Shall Never Surrender" && l.Value == 8);
        Assert.DoesNotContain(SocietySystem.CombatLines(s, away, true, false, away.Tile), l => l.Label == "We Shall Never Surrender");

        var t = World("LEADER_TOJO");
        TestWorld.City(t, 0, 8, 10);
        var abroad = TestWorld.Unit(t, 0, "UNIT_WARRIOR", 25, 10);
        Assert.Contains(SocietySystem.CombatLines(t, abroad, true, false, abroad.Tile), l => l.Label == "Total War Cabinet" && l.Value == 8);
    }

    [Fact]
    public void Roosevelt_IsIsolatedInPeace_AndTheArsenalInWar()
    {
        var s = World("LEADER_ROOSEVELT");
        var city = TestWorld.City(s, 0, 8, 10);
        TestWorld.City(s, 1, 22, 10);
        int peace = CityEffects.Compute(s, city).ProductionBonusFor(ProductionCategory.Unit);
        Assert.True(peace < 0, $"peacetime units {peace}%");
        CommandProcessor.Execute(s, new DeclareWarCommand { Player = 1, Target = 0 }, new());
        int war = CityEffects.Compute(s, city).ProductionBonusFor(ProductionCategory.Unit);
        Assert.True(war >= 50, $"wartime units {war}%");
        Assert.Contains(CityEffects.Compute(s, city).Applied, a => a.Source.EndsWith("Arsenal of Democracy") && a.Modifier.Yield == YieldType.Production);
    }

    [Fact]
    public void HoChiMinh_FeelsLittleWeariness_TojoFeelsMore()
    {
        var s = World("LEADER_HO_CHI_MINH");
        s.Players[0].WarWeariness = 40;
        Assert.Equal(12, SocietySystem.EffectiveWeariness(s, s.Players[0]));   // −70%
        Assert.Equal(1, SocietySystem.WearinessPenalty(s, s.Players[0]));

        var t = World("LEADER_TOJO");
        t.Players[0].WarWeariness = 40;
        Assert.Equal(50, SocietySystem.EffectiveWeariness(t, t.Players[0]));    // +25%
    }

    [Fact]
    public void Wilson_EarnsFavorAndInfluence()
    {
        var s = World("LEADER_WILSON");
        var classic = World("LEADER_LINCOLN");
        Assert.Equal(CityStateSystem.InfluencePerTurn(classic, classic.Players[0]) + 3, CityStateSystem.InfluencePerTurn(s, s.Players[0]));
        Assert.Equal(CongressSystem.FavorPerTurn(classic, classic.Players[0]) + 4, CongressSystem.FavorPerTurn(s, s.Players[0]));
    }

    [Fact]
    public void Stalin_BuildsHugely_AtAHeavyCost()
    {
        var s = World("LEADER_STALIN");
        var city = TestWorld.City(s, 0, 8, 10, population: 6);
        var applied = CityEffects.Compute(s, city).Applied.Where(a => a.Source.EndsWith("Five-Year Plans")).Select(a => a.Modifier).ToList();
        Assert.Contains(applied, m => m.Yield == YieldType.Production && m.Amount == Fx.FromInt(25));
        Assert.Contains(applied, m => m.Effect == ModifierEffect.CityAmenities && m.Amount == Fx.FromInt(-2));
        Assert.Contains(applied, m => m.Yield == YieldType.Culture && m.Amount < Fx.Zero);
    }
}
