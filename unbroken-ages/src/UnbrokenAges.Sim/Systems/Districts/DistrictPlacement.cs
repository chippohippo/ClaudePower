using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.Map;
using UnbrokenAges.Sim.State;

namespace UnbrokenAges.Sim.Systems.Districts;

public enum PlacementFailure
{
    MissingTech,
    MissingCivic,
    UniqueToAnotherCiv,
    ReplacedByUnique,
    AlreadyBuiltInCity,
    AlreadyBuiltInEmpire,
    DistrictCapacity,
    OutOfRange,
    NotOwned,
    IsCityCenter,
    OccupiedByDistrict,
    Reserved,
    Submerged,
    WrongTerrain,
    WrongRelief,
    BlockedByFeature,
    RequiresFeature,
    BlockedByResource,
    RequiresRiverEdges,
    RequiresAdjacentCityCenter,
    ForbidsAdjacentCityCenter,
    RequiresAdjacentSource,
    CanalConnection,
}

public readonly record struct PlacementOptions(bool IgnoreTech = false, bool IgnoreCapacity = false, int IgnoreQueueUid = -1);

/// <summary>District placement legality. Every failure is reported (not just the first) so the
/// placement lens can tint tiles and list all reasons in the tooltip.</summary>
public static class DistrictPlacement
{
    public const int CityRadius = 3;
    public const int MetropolisPopulation = 20;

    /// <summary>Specialty district slots: 1 + 1 per 3 pop above 1, +1 at Metropolis tier, + modifiers.</summary>
    public static int Capacity(CityState city, CityEffects? effects) =>
        1 + Math.Max(0, (city.Population - 1) / 3)
        + (city.Population >= MetropolisPopulation ? 1 : 0)
        + (effects?.DistrictCapacity ?? 0);

    public static int UsedCapacity(GameState s, CityState city, int ignoreQueueUid = -1)
    {
        int used = city.Districts.Count(d => s.Db.Districts[d.DefIndex].CountsTowardLimit);
        used += city.Queue.Items.Count(q => q.Kind == ProductionKind.District && q.Uid != ignoreQueueUid && s.Db.Districts[q.DefIndex].CountsTowardLimit);
        return used;
    }

    /// <summary>Returns the civ's unique replacement for a generic district, if any.</summary>
    public static int EffectiveDistrict(GameDatabase db, PlayerState player, int districtIndex)
    {
        foreach (var d in db.Districts)
            if (d.ReplacesIndex == districtIndex && d.CivilizationIndex >= 0 && d.CivilizationIndex == player.CivIndex)
                return d.Index;
        return districtIndex;
    }

    public static List<PlacementFailure> Check(GameState s, CityState city, int districtIndex, int tile, PlacementOptions opt = default)
    {
        var failures = new List<PlacementFailure>();
        var db = s.Db;
        var map = s.Map;
        var def = db.Districts[districtIndex];
        var player = s.Players[city.Owner];

        // --- Empire / city level ---
        if (!opt.IgnoreTech)
        {
            if (!player.HasTech(def.PrereqTechIndex)) failures.Add(PlacementFailure.MissingTech);
            if (!player.HasCivic(def.PrereqCivicIndex)) failures.Add(PlacementFailure.MissingCivic);
        }
        if (def.CivilizationIndex >= 0 && def.CivilizationIndex != player.CivIndex) failures.Add(PlacementFailure.UniqueToAnotherCiv);
        if (EffectiveDistrict(db, player, districtIndex) != districtIndex) failures.Add(PlacementFailure.ReplacedByUnique);

        int family = def.ReplacesIndex >= 0 ? def.ReplacesIndex : districtIndex;
        bool SameFamily(int d) => d == districtIndex || d == family || db.Districts[d].ReplacesIndex == family;
        int inCity = city.Districts.Count(d => SameFamily(d.DefIndex))
                     + city.Queue.Items.Count(q => q.Kind == ProductionKind.District && q.Uid != opt.IgnoreQueueUid && SameFamily(q.DefIndex));
        if (def.Category != DistrictCategory.CityCenter && inCity >= def.MaxPerCity) failures.Add(PlacementFailure.AlreadyBuiltInCity);
        if (def.UniquePerCiv && s.CitiesOf(city.Owner).Any(c =>
                c.Districts.Any(d => SameFamily(d.DefIndex)) ||
                c.Queue.Items.Any(q => q.Kind == ProductionKind.District && q.Uid != opt.IgnoreQueueUid && SameFamily(q.DefIndex))))
            failures.Add(PlacementFailure.AlreadyBuiltInEmpire);
        if (def.CountsTowardLimit && !opt.IgnoreCapacity &&
            UsedCapacity(s, city, opt.IgnoreQueueUid) >= Capacity(city, CityEffects.Compute(s, city)))
            failures.Add(PlacementFailure.DistrictCapacity);

        // --- Tile level ---
        if (tile < 0 || tile >= map.Count) { failures.Add(PlacementFailure.OutOfRange); return failures; }
        if (map.Distance(city.Tile, tile) > CityRadius) failures.Add(PlacementFailure.OutOfRange);
        // Unowned tiles in range are auto-claimed on completion (QoL: no separate tile purchase step).
        if (map.OwnerCity[tile] >= 0 && map.OwnerCity[tile] != city.Id) failures.Add(PlacementFailure.NotOwned);
        if (map.OwnerCity[tile] < 0 && map.OwnerPlayer[tile] >= 0 && map.OwnerPlayer[tile] != city.Owner) failures.Add(PlacementFailure.NotOwned);
        if (tile == city.Tile) failures.Add(PlacementFailure.IsCityCenter);
        else if (map.District[tile] >= 0) failures.Add(PlacementFailure.OccupiedByDistrict);
        if (map.Reservation[tile] >= 0 && !IsOwnReservation(city, tile, opt.IgnoreQueueUid, map)) failures.Add(PlacementFailure.Reserved);
        if (map.HasFlag(tile, TileFlags.Submerged)) failures.Add(PlacementFailure.Submerged);

        var rules = def.Placement;
        var cls = map.ClassAt(tile);
        if (rules.OnWater)
        {
            var allowed = rules.AllowedTerrainClasses.Count > 0 ? rules.AllowedTerrainClasses : new List<TerrainClass> { TerrainClass.Coast, TerrainClass.Lake };
            if (!allowed.Contains(cls)) failures.Add(PlacementFailure.WrongTerrain);
        }
        else
        {
            if (cls != TerrainClass.Land) failures.Add(PlacementFailure.WrongTerrain);
            bool reliefOk = rules.AllowedReliefIndices.Length > 0
                ? rules.AllowedReliefIndices.Contains(map.Relief[tile])
                : map.Relief[tile] != db.Ids.Mountain;
            if (!reliefOk) failures.Add(PlacementFailure.WrongRelief);
        }

        int feature = map.Feature[tile];
        if (rules.RequiresFeatureIndex >= 0)
        {
            if (feature != rules.RequiresFeatureIndex) failures.Add(PlacementFailure.RequiresFeature);
        }
        else if (feature >= 0 && !db.Features[feature].Removable && feature != db.Ids.Reef)
        {
            failures.Add(PlacementFailure.BlockedByFeature);
        }
        if (map.Resource[tile] >= 0 && db.Resources[map.Resource[tile]].Class != ResourceClass.Bonus)
            failures.Add(PlacementFailure.BlockedByResource);
        if (rules.MinRiverEdges > 0 && map.RiverEdgeCount(tile) < rules.MinRiverEdges)
            failures.Add(PlacementFailure.RequiresRiverEdges);

        bool adjacentToCenter = map.Distance(city.Tile, tile) == 1;
        if (rules.RequiresAdjacentCityCenter && !adjacentToCenter) failures.Add(PlacementFailure.RequiresAdjacentCityCenter);
        if (rules.ForbidAdjacentCityCenter && adjacentToCenter) failures.Add(PlacementFailure.ForbidsAdjacentCityCenter);

        if (rules.RequiresAdjacentAny.Count > 0)
        {
            var view = new DistrictView(map);
            bool any = false;
            for (int d = 0; d < 6 && !any; d++)
            {
                int n = map.Neighbor(tile, d);
                if (n < 0) continue;
                foreach (var m in rules.RequiresAdjacentAny)
                    if (AdjacencyCalculator.Matches(m, map, tile, d, n, view)) { any = true; break; }
            }
            if (!any) failures.Add(PlacementFailure.RequiresAdjacentSource);
        }

        if (rules.Special == SpecialPlacement.Canal && !CanalConnects(map, tile)) failures.Add(PlacementFailure.CanalConnection);
        return failures;
    }

    public static bool IsValid(GameState s, CityState city, int districtIndex, int tile, PlacementOptions opt = default) =>
        Check(s, city, districtIndex, tile, opt).Count == 0;

    private static bool IsOwnReservation(CityState city, int tile, int ignoreUid, MapGrid map) =>
        map.Reservation[tile] == city.Id && city.Queue.Items.Any(q => q.Tile == tile && q.Uid == ignoreUid);

    /// <summary>
    /// A canal must link two "connectors" (water, city centre, or another canal) on
    /// non-adjacent sides, so it genuinely joins two bodies of water across land.
    /// </summary>
    public static bool CanalConnects(MapGrid map, int tile)
    {
        var db = map.Db;
        Span<bool> connector = stackalloc bool[6];
        for (int d = 0; d < 6; d++)
        {
            int n = map.Neighbor(tile, d);
            if (n < 0) continue;
            int dist = map.District[n];
            connector[d] = map.IsWater(n) || dist == db.Ids.CityCenter ||
                           (dist >= 0 && db.Districts[dist].Placement.Special == SpecialPlacement.Canal);
        }
        for (int a = 0; a < 6; a++)
        for (int b = a + 2; b < 6; b++)
        {
            if (a == 0 && b == 5) continue; // directions 0 and 5 are adjacent
            if (connector[a] && connector[b]) return true;
        }
        return false;
    }

    public static IEnumerable<int> CandidateTiles(GameState s, CityState city)
    {
        var tiles = new List<int>();
        s.Map.CollectRadius(city.Tile, CityRadius, tiles);
        tiles.Sort();
        return tiles;
    }
}
