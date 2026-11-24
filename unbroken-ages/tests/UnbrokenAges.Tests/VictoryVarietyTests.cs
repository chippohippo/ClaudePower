using UnbrokenAges.Sim.AI;

namespace UnbrokenAges.Tests;

/// <summary>Faith purchases, the diffusion of knowledge and the AI's victory focus (docs/05-key-systems/22-earth.md).</summary>
public class VictoryVarietyTests
{
    private static string? Run(GameState s, GameCommand cmd)
    {
        var r = CommandProcessor.Execute(s, cmd, new());
        return r.Ok ? null : r.Error;
    }

    private static (GameState S, CityState Holy) Faithful()
    {
        var s = TestWorld.Blank(width: 30, height: 20);
        var holy = TestWorld.City(s, 0, 8, 8, population: 6);
        TestWorld.City(s, 1, 20, 8, population: 2);
        var p = s.Players[0];
        p.CapitalCityId = holy.Id;
        p.GreatPeopleRecruited[(int)GreatPersonClass.Prophet] = 1;
        Assert.Null(Run(s, new FoundReligionCommand { Player = 0, Religion = 0, FounderBelief = s.Db.Beliefs.IndexOf("BELIEF_TITHE"), FollowerBelief = s.Db.Beliefs.IndexOf("BELIEF_WORK_ETHIC") }));
        return (s, holy);
    }

    [Fact]
    public void Faith_BuysMissionaries_AtTwiceTheirProductionCost()
    {
        var (s, holy) = Faithful();
        int missionary = s.Db.Units.IndexOf("UNIT_MISSIONARY");
        var cost = ReligionSystem.FaithCost(s, holy, missionary);
        Assert.Equal((ProductionSystem.Cost(s, s.Players[0], ProductionKind.Unit, missionary) * 2).Floor(), cost);

        s.Players[0].Faith = cost - Fx.One;
        Assert.Contains("faith", Run(s, new FaithPurchaseCommand { Player = 0, CityId = holy.Id, DefIndex = missionary }));
        s.Players[0].Faith = cost + Fx.FromInt(5);
        Assert.Null(Run(s, new FaithPurchaseCommand { Player = 0, CityId = holy.Id, DefIndex = missionary }));
        Assert.Equal(Fx.FromInt(5), s.Players[0].Faith);
        Assert.Contains(s.Units, u => u.Owner == 0 && u.DefIndex == missionary && u.Tile == holy.Tile);
        // With one in the field, the next costs 25% more.
        Assert.Equal((cost + cost * 25 / 100).Floor(), ReligionSystem.FaithCost(s, holy, missionary));

        // Only religious units, and only for a civilization with a religion.
        s.Players[0].Faith = Fx.FromInt(5000);
        Assert.NotNull(Run(s, new FaithPurchaseCommand { Player = 0, CityId = holy.Id, DefIndex = s.Db.Units.IndexOf("UNIT_WARRIOR") }));
        var other = s.Cities.First(c => c.Owner == 1);
        s.Players[1].Faith = Fx.FromInt(5000);
        Assert.NotNull(Run(s, new FaithPurchaseCommand { Player = 1, CityId = other.Id, DefIndex = missionary }));
    }

    [Fact]
    public void Knowledge_Diffuses_TechsKnownByOthersCostLess()
    {
        var s = TestWorld.Blank(players: 3, allTech: false);
        var tech = s.Db.Techs.First(t => t.Era == "ERA_CLASSICAL" && t.DivergenceIndex < 0);
        var full = ResearchSystem.Cost(s, tech);
        Assert.Equal(full, ResearchSystem.Cost(s, s.Players[0], tech));
        s.Players[1].Techs[tech.Index] = true;   // one of the two others: 20% off
        Assert.Equal(full - full * 20 / 100, ResearchSystem.Cost(s, s.Players[0], tech));
        s.Players[2].Techs[tech.Index] = true;   // everyone else: 40% off
        Assert.Equal(full - full * 40 / 100, ResearchSystem.Cost(s, s.Players[0], tech));

        // The Divergence's own branches never get cheaper by diffusion.
        var doctrine = s.Db.Techs.First(t => t.DivergenceIndex >= 0);
        foreach (var p in s.Players.Skip(1)) p.Techs[doctrine.Index] = true;
        Assert.Equal(ResearchSystem.Cost(s, s.Players[0], doctrine), ResearchSystem.Cost(s, doctrine) * DivergenceSystem.CostMultiplier(s, s.Players[0], doctrine));
    }

    [Fact]
    public void Focus_StartsOnTheDefaultRoad_AndFollowsProgress()
    {
        var s = TestWorld.Blank(players: 3, allTech: false);   // with every tech known, the top scientist would take up the space race
        for (int i = 0; i < 3; i++) TestWorld.City(s, i, 4 + 8 * i, 6);
        var me = s.Players[0];
        me.DiplomaticPoints = 12;
        s.Turn = 100;
        Assert.Equal(VictoryFocus.Ascension, VictoryAi.Focus(s, me));   // too early to choose
        s.Turn = 200;
        Assert.Equal(VictoryFocus.Concord, VictoryAi.Focus(s, me));
        s.Turn = 201;
        me.DiplomaticPoints = 1;
        Assert.Equal(VictoryFocus.Ascension, VictoryAi.Focus(s, me));   // fell back: the default road again
    }
}
