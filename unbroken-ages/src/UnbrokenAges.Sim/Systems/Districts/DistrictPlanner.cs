using UnbrokenAges.Sim.Core;
using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.State;

namespace UnbrokenAges.Sim.Systems.Districts;

public sealed record PlacementCandidate(
    int Tile,
    Fx Score,
    YieldSet Adjacency,
    YieldSet NeighborDelta,
    YieldSet LostTileYields,
    int FutureSlots,
    AdjacencyResult Detail);

/// <summary>
/// Scores every legal tile for a district. Shared by the placement lens ("best spots" heat map)
/// and the AI city planner, so the AI plays the same adjacency puzzle the player sees.
///
/// score = w·adjacency + w·(change to neighbours' adjacency) − ½·w·(tile yields lost)
///       + ¼·(adjacent empty land that could host future districts)
/// </summary>
public static class DistrictPlanner
{
    public static YieldSet BalancedWeights => new()
    {
        Food = Fx.One, Production = Fx.One, Gold = Fx.Ratio(8, 10), Science = Fx.One, Culture = Fx.One, Faith = Fx.Ratio(8, 10),
    };

    public static List<PlacementCandidate> Rank(GameState s, CityState city, int districtIndex, YieldSet weights, int max = 10, PlacementOptions opt = default)
    {
        var map = s.Map;
        var view = new DistrictView(map);
        var effects = CityEffects.Compute(s, city);
        var result = new List<PlacementCandidate>();

        foreach (int tile in DistrictPlacement.CandidateTiles(s, city))
        {
            if (DistrictPlacement.Check(s, city, districtIndex, tile, opt).Count > 0) continue;
            var own = AdjacencyCalculator.Compute(map, tile, districtIndex, view, effects.AdjacencyPercent);
            var delta = NeighborDelta(s, tile, districtIndex, view);
            var lost = map.IsLand(tile) || map.IsWater(tile) ? map.TileYields(tile) : default;
            int future = 0;
            for (int d = 0; d < 6; d++)
            {
                int n = map.Neighbor(tile, d);
                if (n >= 0 && map.IsLand(n) && !map.IsMountain(n) && map.District[n] < 0 && map.Distance(city.Tile, n) <= DistrictPlacement.CityRadius)
                    future++;
            }
            Fx score = own.Total.Dot(weights) + delta.Dot(weights) - lost.Dot(weights) / 2 + Fx.Ratio(future, 4);
            result.Add(new PlacementCandidate(tile, score, own.Total, delta, lost, future, own));
        }
        result.Sort((a, b) => a.Score != b.Score ? b.Score.CompareTo(a.Score) : a.Tile.CompareTo(b.Tile));
        if (result.Count > max) result.RemoveRange(max, result.Count - max);
        return result;
    }

    /// <summary>How placing the district on <paramref name="tile"/> changes existing neighbours' adjacency.</summary>
    public static YieldSet NeighborDelta(GameState s, int tile, int districtIndex, DistrictView view)
    {
        var map = s.Map;
        var after = view.With(tile, districtIndex);
        var delta = new YieldSet();
        for (int d = 0; d < 6; d++)
        {
            int n = map.Neighbor(tile, d);
            if (n < 0) continue;
            int nd = view.At(n);
            if (nd < 0 || s.Db.Districts[nd].Adjacency.Count == 0 && s.Db.Districts[nd].PrimaryYield is null) continue;
            var before = AdjacencyCalculator.Compute(map, n, nd, view).Total;
            var later = AdjacencyCalculator.Compute(map, n, nd, after).Total;
            delta += later - before;
        }
        return delta;
    }
}
