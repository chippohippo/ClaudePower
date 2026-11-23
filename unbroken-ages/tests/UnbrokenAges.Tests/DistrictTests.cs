using UnbrokenAges.Sim.Systems.Districts;

namespace UnbrokenAges.Tests;

public class AdjacencyTests
{
    [Fact]
    public void Academy_CountsMountainsGeothermalAndDistricts()
    {
        var s = TestWorld.Blank();
        var map = s.Map;
        var city = TestWorld.City(s, 0, 10, 10);
        int academyTile = map.Neighbor(city.Tile, HexCoord.E);
        map.Relief[map.Neighbor(academyTile, HexCoord.E)] = (byte)s.Db.Ids.Mountain;
        map.Relief[map.Neighbor(academyTile, HexCoord.NE)] = (byte)s.Db.Ids.Mountain;
        int academy = TestWorld.D(s, "DISTRICT_ACADEMY");
        var view = new DistrictView(map);

        var r = AdjacencyCalculator.Compute(map, academyTile, academy, view);
        Assert.Equal(Fx.FromInt(2), r.Total.Science);              // 2 mountains; 1 district (city centre) is below the per-2 threshold
        var districtRule = r.Contributions.Single(c => c.Per == 2 && c.Label.Contains("district"));
        Assert.Equal(1, districtRule.Matches);
        Assert.Equal(1, districtRule.MatchesToNextBonus);           // "1 more district → +1"

        map.Feature[map.Neighbor(academyTile, HexCoord.SE)] = (short)s.Db.Ids.Geothermal;
        Assert.Equal(Fx.FromInt(4), AdjacencyCalculator.Compute(map, academyTile, academy, view).Total.Science);

        // Hypothetical Market next to both: academy gains +1 (now 2 adjacent districts).
        int marketTile = map.Neighbor(academyTile, HexCoord.SW);
        var delta = DistrictPlanner.NeighborDelta(s, marketTile, TestWorld.D(s, "DISTRICT_MARKET"), view.With(academyTile, academy));
        Assert.Equal(Fx.One, delta.Science);
    }

    [Fact]
    public void Market_GetsRiverBonus_OnlyWhenRiverRunsAlongIt()
    {
        var s = TestWorld.Blank();
        var city = TestWorld.City(s, 0, 10, 10);
        int tile = s.Map.Neighbor(city.Tile, HexCoord.W);
        int market = TestWorld.D(s, "DISTRICT_MARKET");
        var view = new DistrictView(s.Map);
        Assert.Equal(Fx.Zero, AdjacencyCalculator.Compute(s.Map, tile, market, view).Total.Gold);
        s.Map.SetRiverEdge(tile, HexCoord.SW, true);
        Assert.Equal(Fx.FromInt(2), AdjacencyCalculator.Compute(s.Map, tile, market, view).Total.Gold);
    }

    [Fact]
    public void CivicPlaza_ProvidesAdjacencyToNeighbouringSpecialtyDistricts()
    {
        var s = TestWorld.Blank();
        var city = TestWorld.City(s, 0, 10, 10, population: 7);
        int academyTile = s.Map.Neighbor(city.Tile, HexCoord.E);
        TestWorld.PlaceDistrict(s, city, "DISTRICT_ACADEMY", academyTile);
        var view = new DistrictView(s.Map);
        var before = AdjacencyCalculator.Compute(s.Map, academyTile, TestWorld.D(s, "DISTRICT_ACADEMY"), view).Total.Science;
        int plazaTile = s.Map.Neighbor(academyTile, HexCoord.E);
        var after = AdjacencyCalculator.Compute(s.Map, academyTile, TestWorld.D(s, "DISTRICT_ACADEMY"),
            view.With(plazaTile, TestWorld.D(s, "DISTRICT_CIVIC_PLAZA"))).Total.Science;
        Assert.Equal(before + 2, after); // +1 provided by the plaza, +1 because it's now 2 adjacent districts
    }

    [Fact]
    public void UniqueDistrict_CountsAsTheDistrictItReplaces()
    {
        var s = TestWorld.Blank();
        var city = TestWorld.City(s, 0, 10, 10, population: 7);
        int t = s.Map.Neighbor(city.Tile, HexCoord.E);
        TestWorld.PlaceDistrict(s, city, "DISTRICT_ARSENAL", t);
        int portTile = s.Map.Neighbor(t, HexCoord.E);
        // A River Port gets +1 production from an adjacent "Foundry" — the Arsenal qualifies.
        s.Map.Terrain[portTile] = (byte)s.Db.Ids.Channel;
        var r = AdjacencyCalculator.Compute(s.Map, portTile, TestWorld.D(s, "DISTRICT_RIVER_PORT"), new DistrictView(s.Map));
        Assert.Equal(Fx.One, r.Total.Production);
    }

    [Fact]
    public void Planner_RanksMountainSpotsFirst()
    {
        var s = TestWorld.Blank();
        var city = TestWorld.City(s, 0, 10, 10, population: 4);
        int ring2 = s.Map.Neighbor(s.Map.Neighbor(city.Tile, HexCoord.W), HexCoord.W);
        s.Map.Relief[s.Map.Neighbor(ring2, HexCoord.NW)] = (byte)s.Db.Ids.Mountain;
        s.Map.Relief[s.Map.Neighbor(ring2, HexCoord.SW)] = (byte)s.Db.Ids.Mountain;
        s.Map.Relief[s.Map.Neighbor(ring2, HexCoord.W)] = (byte)s.Db.Ids.Mountain;
        var ranked = DistrictPlanner.Rank(s, city, TestWorld.D(s, "DISTRICT_ACADEMY"), DistrictPlanner.BalancedWeights);
        Assert.Equal(ring2, ranked[0].Tile);
        Assert.Equal(Fx.FromInt(3), ranked[0].Adjacency.Science);
    }
}

public class PlacementTests
{
    private static List<PlacementFailure> Check(GameState s, CityState c, string district, int tile) =>
        DistrictPlacement.Check(s, c, TestWorld.D(s, district), tile);

    [Fact]
    public void Aqueduct_NeedsCityCentreAndFreshWaterSource()
    {
        var s = TestWorld.Blank();
        var city = TestWorld.City(s, 0, 10, 10);
        int t = s.Map.Neighbor(city.Tile, HexCoord.E);
        Assert.Contains(PlacementFailure.RequiresAdjacentSource, Check(s, city, "DISTRICT_AQUEDUCT", t));
        s.Map.Relief[s.Map.Neighbor(t, HexCoord.E)] = (byte)s.Db.Ids.Mountain;
        Assert.Empty(Check(s, city, "DISTRICT_AQUEDUCT", t));
        int far = s.Map.Neighbor(t, HexCoord.NE);
        Assert.Contains(PlacementFailure.RequiresAdjacentCityCenter, Check(s, city, "DISTRICT_AQUEDUCT", far));
    }

    [Fact]
    public void Aqueduct_AcceptsARiverAlongItsEdge()
    {
        var s = TestWorld.Blank();
        var city = TestWorld.City(s, 0, 10, 10);
        int t = s.Map.Neighbor(city.Tile, HexCoord.E);
        s.Map.SetRiverEdge(t, HexCoord.SE, true);
        Assert.Empty(Check(s, city, "DISTRICT_AQUEDUCT", t));
    }

    [Fact]
    public void Garrison_CannotTouchCityCentre()
    {
        var s = TestWorld.Blank();
        var city = TestWorld.City(s, 0, 10, 10);
        Assert.Contains(PlacementFailure.ForbidsAdjacentCityCenter, Check(s, city, "DISTRICT_GARRISON", s.Map.Neighbor(city.Tile, HexCoord.E)));
    }

    [Fact]
    public void Capacity_CountsQueuedDistricts_AndReservationsBlockTiles()
    {
        var s = TestWorld.Blank();
        var city = TestWorld.City(s, 0, 10, 10, population: 1);
        int t = s.Map.Neighbor(city.Tile, HexCoord.E);
        var enqueue = new EnqueueCommand { Player = 0, CityId = city.Id, Kind = ProductionKind.District, DefIndex = TestWorld.D(s, "DISTRICT_ACADEMY"), Tile = t };
        Assert.True(CommandProcessor.Execute(s, enqueue, new()).Ok);
        Assert.Equal(city.Id, s.Map.Reservation[t]);

        var other = Check(s, city, "DISTRICT_SANCTUARY", s.Map.Neighbor(city.Tile, HexCoord.W));
        Assert.Contains(PlacementFailure.DistrictCapacity, other);

        city.Population = 4; // capacity 2
        Assert.Contains(PlacementFailure.Reserved, Check(s, city, "DISTRICT_SANCTUARY", t));
        Assert.Empty(Check(s, city, "DISTRICT_SANCTUARY", s.Map.Neighbor(city.Tile, HexCoord.W)));

        Assert.True(CommandProcessor.Execute(s, new RemoveQueueItemCommand { Player = 0, CityId = city.Id, Index = 0 }, new()).Ok);
        Assert.Equal(-1, s.Map.Reservation[t]);
    }

    [Fact]
    public void Harbor_MustBeOnWaterNextToLand()
    {
        var s = TestWorld.Blank();
        var city = TestWorld.City(s, 0, 10, 10);
        int land = s.Map.Neighbor(city.Tile, HexCoord.E);
        Assert.Contains(PlacementFailure.WrongTerrain, Check(s, city, "DISTRICT_HARBOR", land));
        s.Map.Terrain[land] = (byte)s.Db.Ids.Coast;
        Assert.Empty(Check(s, city, "DISTRICT_HARBOR", land));
    }

    [Fact]
    public void Canal_MustJoinOppositeSides()
    {
        var s = TestWorld.Blank();
        var city = TestWorld.City(s, 0, 10, 10);
        int t = s.Map.Neighbor(s.Map.Neighbor(city.Tile, HexCoord.E), HexCoord.E);
        s.Map.Terrain[s.Map.Neighbor(t, HexCoord.NE)] = (byte)s.Db.Ids.Coast;
        s.Map.Terrain[s.Map.Neighbor(t, HexCoord.E)] = (byte)s.Db.Ids.Coast; // adjacent sides only
        Assert.Contains(PlacementFailure.CanalConnection, Check(s, city, "DISTRICT_CANAL", t));
        s.Map.Terrain[s.Map.Neighbor(t, HexCoord.SW)] = (byte)s.Db.Ids.Lake;  // now opposite NE
        Assert.DoesNotContain(PlacementFailure.CanalConnection, Check(s, city, "DISTRICT_CANAL", t));
    }

    [Fact]
    public void UniqueDistricts_ReplaceGenerics_ForTheirCivOnly()
    {
        var s = TestWorld.Blank(leaders: new[] { "LEADER_DANDOLO", "LEADER_TAIZU_SONG" });
        var venice = TestWorld.City(s, 0, 6, 10, population: 4);
        var song = TestWorld.City(s, 1, 16, 10, population: 4);
        int vt = s.Map.Neighbor(venice.Tile, HexCoord.E);
        s.Map.Terrain[s.Map.Neighbor(vt, HexCoord.E)] = (byte)s.Db.Ids.Coast;
        Assert.Contains(PlacementFailure.ReplacedByUnique, Check(s, venice, "DISTRICT_FOUNDRY", vt));
        Assert.Empty(Check(s, venice, "DISTRICT_ARSENAL", vt));
        Assert.Contains(PlacementFailure.UniqueToAnotherCiv, Check(s, song, "DISTRICT_ARSENAL", s.Map.Neighbor(song.Tile, HexCoord.E)));
        Assert.Equal(TestWorld.D(s, "DISTRICT_HANLIN_ACADEMY"),
            DistrictPlacement.EffectiveDistrict(s.Db, s.Players[1], TestWorld.D(s, "DISTRICT_ACADEMY")));
    }
}
