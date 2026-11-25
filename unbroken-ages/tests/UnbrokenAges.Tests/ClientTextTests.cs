namespace UnbrokenAges.Tests;

/// <summary>The words the client shows come from the simulation, so they are tested here rather than in the Godot project.</summary>
public class ClientTextTests
{
    [Fact]
    public void CombatTooltip_GivesAVerdict_DamageAndEveryModifier()
    {
        var s = TestWorld.Blank(width: 30);
        CommandProcessor.Execute(s, new DeclareWarCommand { Player = 0, Target = 1 }, new());
        var sword = TestWorld.Unit(s, 0, "UNIT_SWORDSMAN", 10, 10);
        sword.Variant = 1;                                                  // Heavy
        var warrior = TestWorld.Unit(s, 1, "UNIT_WARRIOR", 11, 10);
        warrior.Fortified = true;
        var preview = CombatSystem.Preview(s, sword, warrior.Tile);
        var lines = CombatSystem.Describe(s, sword, warrior.Tile, preview);
        Assert.StartsWith($"{CombatSystem.Verdict(CombatSystem.OddsPercent(preview))} (", lines[0]);
        Assert.Contains("Swordsman (Heavy) 40 vs Warrior 24", lines[0]);
        Assert.StartsWith("Deal ", lines[1]);
        Assert.Contains("  + Heavy variant +5", lines);
        Assert.Contains("  − Fortified +4", lines);

        var illegal = CombatSystem.Preview(s, warrior, TestWorld.Tile(s, 20, 10));
        Assert.Equal(new[] { illegal.Reason! }, CombatSystem.Describe(s, warrior, TestWorld.Tile(s, 20, 10), illegal));
    }

    [Theory]
    [InlineData(100, "Decisive")]
    [InlineData(61, "Favourable")]
    [InlineData(50, "Even")]
    [InlineData(25, "Costly")]
    [InlineData(5, "Disastrous")]
    public void Verdicts_FollowTheOdds(int odds, string verdict) => Assert.Equal(verdict, CombatSystem.Verdict(odds));

    [Fact]
    public void DiplomacyStatus_AndVictoryHeadline_ReadNaturally()
    {
        var s = TestWorld.Blank(players: 3, leaders: new[] { "LEADER_THUTMOSE", null, null });
        s.Players[2].Team = 0;
        Assert.Equal("At peace", DiplomacySystem.StatusName(s, 0, 1));
        Assert.Equal("Teammates", DiplomacySystem.StatusName(s, 0, 2));
        CommandProcessor.Execute(s, new DeclareWarCommand { Player = 0, Target = 1 }, new());
        Assert.Equal("At war", DiplomacySystem.StatusName(s, 1, 0));

        Assert.Null(VictorySystem.Headline(s));
        s.Victory = new VictoryState { Winner = 0, WinnerTeam = 0, Kind = VictoryKind.Ascension, Turn = 412 };
        Assert.Equal("Egypt wins an Ascension victory on turn 412.", VictorySystem.Headline(s));
        s.Players[0].Divergence = s.Db.Divergences.IndexOf("DIVERGENCE_SYMBIONT");
        Assert.Equal("Egypt wins the Transcendence victory (Harmony) on turn 412.", VictorySystem.Headline(s));
    }
}
