using UnbrokenAges.Sim.AI;

namespace UnbrokenAges.Tests;

/// <summary>Embarkation: land units and settlers cross the shallows with Sailing and the ocean with Celestial Navigation, are
/// weak at sea, cannot attack from the water, and the AI only sends settlers where they can actually go.</summary>
public class EmbarkTests
{
    private static GameState Sea(params string[] techs)
    {
        var s = TestWorld.Blank(width: 30, height: 20, players: 2, allTech: false);
        byte coast = (byte)s.Db.Terrains.First(t => t.Class == TerrainClass.Coast).Index;
        byte ocean = (byte)s.Db.Terrains.First(t => t.Class == TerrainClass.Ocean).Index;
        for (int row = 0; row < 20; row++)
        {
            s.Map.Terrain[TestWorld.Tile(s, 10, row)] = coast;
            s.Map.Terrain[TestWorld.Tile(s, 11, row)] = ocean;
            s.Map.Terrain[TestWorld.Tile(s, 12, row)] = coast;
        }
        foreach (var id in techs) s.Players[0].Techs[s.Db.Techs.IndexOf(id)] = true;
        return s;
    }

    [Fact]
    public void Sailing_OpensTheShallows_CelestialNavigation_TheOcean()
    {
        var none = Sea();
        var w = TestWorld.Unit(none, 0, "UNIT_WARRIOR", 9, 10);
        Assert.Equal(Movement.Impassable, Movement.TerrainCost(none, w, w.Tile, TestWorld.Tile(none, 10, 10)));

        var sail = Sea("TECH_SAILING");
        var w2 = TestWorld.Unit(sail, 0, "UNIT_WARRIOR", 9, 10);
        Assert.Equal(2, Movement.TerrainCost(sail, w2, w2.Tile, TestWorld.Tile(sail, 10, 10)));          // boarding
        Assert.Equal(Movement.Impassable, Movement.TerrainCost(sail, w2, TestWorld.Tile(sail, 10, 10), TestWorld.Tile(sail, 11, 10)));

        var nav = Sea("TECH_SAILING", "TECH_CELESTIAL_NAVIGATION");
        var settler = TestWorld.Unit(nav, 0, "UNIT_SETTLER", 9, 10);
        Assert.NotNull(Movement.FindPath(nav, settler, TestWorld.Tile(nav, 14, 10)));   // across the ocean
    }

    [Fact]
    public void AtSea_UnitsAreWeak_AndCannotAttack()
    {
        var s = Sea("TECH_SAILING");
        CommandProcessor.Execute(s, new DeclareWarCommand { Player = 0, Target = 1 }, new());
        var tank = TestWorld.Unit(s, 0, "UNIT_TANK", 10, 10);   // afloat on the coast
        var foe = TestWorld.Unit(s, 1, "UNIT_WARRIOR", 9, 10);
        Assert.True(Movement.IsEmbarked(s, tank));
        Assert.False(CombatSystem.Preview(s, tank, foe.Tile).Legal);
        var defence = CombatSystem.UnitStrength(s, tank, foe, false, false, foe.Tile, tank.Tile);
        Assert.Equal(s.Db.Rules.Combat.EmbarkedStrength, defence.Total);
    }

    [Fact]
    public void TheAi_SettlesOnlyWhereItCanGo()
    {
        var s = Sea();
        var home = TestWorld.City(s, 0, 5, 10, population: 4);
        var settler = TestWorld.Unit(s, 0, "UNIT_SETTLER", 5, 11);
        // Without Sailing the far shore is out of reach, so the chosen site is on this side (reachable by land).
        int site = ExpansionAi.BestSite(s, 0, home.Tile, Array.Empty<int>(), settler);
        Assert.True(site < 0 || Movement.FindPath(s, settler, site) != null);
    }
}
