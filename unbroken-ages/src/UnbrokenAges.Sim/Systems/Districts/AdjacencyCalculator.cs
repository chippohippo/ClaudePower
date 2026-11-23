using UnbrokenAges.Sim.Core;
using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.Map;

namespace UnbrokenAges.Sim.Systems.Districts;

/// <summary>
/// Read-only view of district occupancy with optional hypothetical overrides. Lets the UI,
/// the AI planner and map tacks ask "what if a district were here?" without mutating state.
/// </summary>
public sealed class DistrictView
{
    private readonly MapGrid _map;
    private readonly Dictionary<int, int>? _overrides;

    public DistrictView(MapGrid map, Dictionary<int, int>? overrides = null)
    {
        _map = map;
        _overrides = overrides;
    }

    public int At(int tile) => _overrides != null && _overrides.TryGetValue(tile, out int d) ? d : _map.District[tile];

    public DistrictView With(int tile, int districtIndex)
    {
        var o = _overrides != null ? new Dictionary<int, int>(_overrides) : new Dictionary<int, int>();
        o[tile] = districtIndex;
        return new DistrictView(_map, o);
    }
}

public sealed class AdjacencyContribution
{
    public required string Label { get; init; }
    public YieldType Yield { get; init; }
    public Fx Amount { get; init; }
    /// <summary>Yield granted per completed group of <see cref="Per"/> matches.</summary>
    public Fx Increment { get; init; }
    public int Matches { get; init; }
    public int Per { get; init; } = 1;
    public List<int> SourceTiles { get; init; } = new();
    public bool ProvidedByNeighbor { get; init; }

    /// <summary>How many more matching tiles grant the next increment ("1 more forest → +1"). 0 when Per == 1.</summary>
    public int MatchesToNextBonus => Per <= 1 ? 0 : Per - (Matches % Per);
}

public sealed class AdjacencyResult
{
    public YieldSet Total;
    public List<AdjacencyContribution> Contributions { get; } = new();

    public override string ToString() => Total.ToString();
}

/// <summary>
/// Classic hex adjacency: each district has data-driven rules ("+1 Science per adjacent
/// Mountain", "+1 per 2 adjacent districts", "+2 if a river runs along this tile") plus
/// adjacency *provided* by neighbouring districts. Results carry a full breakdown so the
/// placement lens can explain every number and show "almost there" thresholds.
/// </summary>
public static class AdjacencyCalculator
{
    public static AdjacencyResult Compute(MapGrid map, int tile, int districtIndex, DistrictView view, YieldSet adjacencyPercent = default)
    {
        var db = map.Db;
        var def = db.Districts[districtIndex];
        var result = new AdjacencyResult();

        foreach (var rule in def.Adjacency)
        {
            var sources = new List<int>();
            if (rule.Scope == AdjacencyScope.Self)
            {
                if (Matches(rule.Source, map, tile, -2, tile, view)) sources.Add(tile);
            }
            else
            {
                for (int d = 0; d < 6; d++)
                {
                    int n = map.Neighbor(tile, d);
                    if (n >= 0 && Matches(rule.Source, map, tile, d, n, view)) sources.Add(n);
                }
            }
            int per = Math.Max(1, rule.Per);
            Fx amount = rule.Amount * (sources.Count / per);
            result.Total.Add(rule.Yield, amount);
            result.Contributions.Add(new AdjacencyContribution
            {
                Label = rule.Label ?? DefaultLabel(rule),
                Yield = rule.Yield,
                Amount = amount,
                Increment = rule.Amount,
                Matches = sources.Count,
                Per = per,
                SourceTiles = sources,
            });
        }

        // Adjacency granted by neighbours (e.g. Civic Plaza: +1 to adjacent specialty districts).
        for (int d = 0; d < 6; d++)
        {
            int n = map.Neighbor(tile, d);
            if (n < 0) continue;
            int nd = view.At(n);
            if (nd < 0) continue;
            foreach (var p in db.Districts[nd].ProvidesAdjacency)
            {
                bool applies = p.ToDistrictIndex >= 0
                    ? DistrictMatches(db, districtIndex, p.ToDistrictIndex)
                    : p.ToTag == null || def.HasTag(p.ToTag);
                YieldType? y = p.Yield ?? def.PrimaryYield;
                if (!applies || y is null) continue;
                result.Total.Add(y.Value, p.Amount);
                result.Contributions.Add(new AdjacencyContribution
                {
                    Label = p.Label ?? $"+{p.Amount} {y} from adjacent {db.Districts[nd].Name}",
                    Yield = y.Value,
                    Amount = p.Amount,
                    Increment = p.Amount,
                    Matches = 1,
                    SourceTiles = new List<int> { n },
                    ProvidedByNeighbor = true,
                });
            }
        }

        if (!adjacencyPercent.IsZero) result.Total = result.Total.ApplyPercent(adjacencyPercent);
        return result;
    }

    /// <summary>A unique district counts as the district it replaces for adjacency purposes.</summary>
    public static bool DistrictMatches(GameDatabase db, int actual, int wanted) =>
        actual == wanted || (actual >= 0 && db.Districts[actual].ReplacesIndex == wanted);

    /// <param name="dir">Direction from <paramref name="from"/> to <paramref name="n"/>; -2 for Self scope.</param>
    public static bool Matches(SourceMatcher m, MapGrid map, int from, int dir, int n, DistrictView view)
    {
        var db = map.Db;
        if (m.TerrainIndex >= 0 && map.Terrain[n] != m.TerrainIndex) return false;
        if (m.TerrainClass is { } tc && map.ClassAt(n) != tc) return false;
        if (m.ReliefIndex >= 0 && map.Relief[n] != m.ReliefIndex) return false;
        if (m.FeatureIndex >= 0 && map.Feature[n] != m.FeatureIndex) return false;
        if (m.FeatureTag != null && (map.Feature[n] < 0 || !db.Features[map.Feature[n]].HasTag(m.FeatureTag))) return false;
        if (m.ResourceIndex >= 0 && map.Resource[n] != m.ResourceIndex) return false;
        if (m.ResourceClass is { } rc && (map.Resource[n] < 0 || db.Resources[map.Resource[n]].Class != rc)) return false;
        if (m.HasResource == true && map.Resource[n] < 0) return false;

        int district = view.At(n);
        if (m.DistrictIndex >= 0 && !DistrictMatches(db, district, m.DistrictIndex)) return false;
        if (m.DistrictTag != null && (district < 0 || !db.Districts[district].HasTag(m.DistrictTag))) return false;
        if (m.AnyDistrict == true && district < 0) return false;
        if (m.CityCenter == true && district != db.Ids.CityCenter) return false;
        if (m.ImprovementIndex >= 0 && (map.Improvement[n] != m.ImprovementIndex || map.HasFlag(n, TileFlags.Pillaged))) return false;
        if (m.FreshWater == true && !map.IsFreshWaterSource(n)) return false;
        if (m.RiverEdge == true)
        {
            bool river = dir == -2 ? map.HasRiver(from) : dir >= 0 && map.HasRiverEdge(from, dir);
            if (!river) return false;
        }
        return true;
    }

    private static string DefaultLabel(AdjacencyRule rule)
    {
        string per = rule.Per > 1 ? $"per {rule.Per} adjacent" : rule.Scope == AdjacencyScope.Self ? "on" : "per adjacent";
        return $"+{rule.Amount} {rule.Yield} {per} {rule.Source.Describe()}";
    }
}
