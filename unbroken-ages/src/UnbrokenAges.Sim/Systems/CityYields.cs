using UnbrokenAges.Sim.Core;
using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.Map;
using UnbrokenAges.Sim.State;
using UnbrokenAges.Sim.Systems.Districts;

namespace UnbrokenAges.Sim.Systems;

public enum AmenityStatus { Revolt = -3, Unrest = -2, Displeased = -1, Content = 0, Happy = 1, Ecstatic = 2 }

public sealed class CityYieldReport
{
    public YieldSet Tiles;
    public YieldSet Districts;
    public YieldSet Buildings;
    public YieldSet Modifiers;
    public YieldSet Total;
    public List<int> WorkedTiles = new();
    public List<(DistrictInstance District, AdjacencyResult Adjacency)> Adjacency = new();
    public int Housing;
    public int AmenitiesAvailable;
    public int AmenitiesNeeded;
    public AmenityStatus AmenityStatus;
    public int AmenityYieldPercent;
    public int LoyaltyYieldPercent;
    public Fx FoodSurplus;
    public int PowerDemand;
    public CityEffects Effects = null!;
}

/// <summary>Computes a city's per-turn yields with a full, UI-explainable breakdown.</summary>
public static class CityYields
{
    public static CityYieldReport Compute(GameState s, CityState city, CityEffects? effects = null)
    {
        var db = s.Db;
        var map = s.Map;
        var fx = effects ?? CityEffects.Compute(s, city);
        var r = new CityYieldReport { Effects = fx };

        // City centre: guaranteed minimum of 2 food / 1 production plus +1 production.
        var center = map.TileYields(city.Tile);
        center.Food = Fx.Max(center.Food, 2);
        center.Production = Fx.Max(center.Production, 1) + 1;
        r.Tiles += center;
        // Citizens themselves generate a little science and culture (0.5 / 0.3 each).
        r.Tiles.Science += Fx.FromInt(city.Population) / 2;
        r.Tiles.Culture += Fx.FromInt(city.Population) * 3 / 10;

        // Worked tiles (auto-assigned here; the UI layer adds citizen locks and focus presets).
        var candidates = new List<int>();
        map.CollectRadius(city.Tile, DistrictPlacement.CityRadius, candidates);
        candidates.RemoveAll(t => t == city.Tile || map.OwnerCity[t] != city.Id || map.District[t] >= 0 || map.HasFlag(t, TileFlags.Submerged) || map.IsMountain(t));
        // Citizens who don't eat (the Discarnate) stop working farms and favour industry.
        bool fed = fx.CitizenFoodUpkeepPercent > -100;
        var scored = candidates.Select(t => (Tile: t, Score: TileScore(map.TileYields(t), fed))).ToList();
        scored.Sort((a, b) => a.Score != b.Score ? b.Score.CompareTo(a.Score) : a.Tile.CompareTo(b.Tile));
        for (int k = 0; k < Math.Min(city.Population, scored.Count); k++)
        {
            r.WorkedTiles.Add(scored[k].Tile);
            r.Tiles += map.TileYields(scored[k].Tile);
        }

        // Districts & buildings.
        var view = new DistrictView(map);
        int luxuryAmenities = 0;
        foreach (int t in candidates)
            if (map.Resource[t] >= 0 && db.Resources[map.Resource[t]].Class == ResourceClass.Luxury && map.Improvement[t] >= 0) luxuryAmenities++;
        r.AmenitiesAvailable = luxuryAmenities + fx.Amenities;
        r.Housing = BaseHousing(map, city.Tile) + fx.Housing;

        foreach (var d in city.Districts)
        {
            var ddef = db.Districts[d.DefIndex];
            if (!d.Pillaged)
            {
                r.Districts += ddef.Yields;
                if (ddef.Category != DistrictCategory.CityCenter)
                {
                    var adj = AdjacencyCalculator.Compute(map, d.Tile, d.DefIndex, view, fx.AdjacencyPercent);
                    r.Adjacency.Add((d, adj));
                    r.Districts += adj.Total;
                }
                r.AmenitiesAvailable += ddef.Amenities;
                r.Housing += DistrictHousing(map, city, ddef, d.Tile);
            }
            foreach (int b in d.Buildings)
            {
                var bdef = db.Buildings[b];
                r.Buildings += bdef.Yields;
                if (city.IsPowered) r.Buildings += bdef.PoweredYields;
                r.Housing += bdef.Housing;
                r.AmenitiesAvailable += bdef.Amenities;
                r.PowerDemand += bdef.PowerDemand;
            }
        }
        r.Modifiers = fx.FlatYields;

        // Amenities → yield modifier.
        r.AmenitiesNeeded = (city.Population + 1) / 2;
        int diff = r.AmenitiesAvailable - r.AmenitiesNeeded;
        (r.AmenityStatus, r.AmenityYieldPercent) = diff switch
        {
            >= 3 => (AmenityStatus.Ecstatic, 10),
            >= 1 => (AmenityStatus.Happy, 5),
            0 => (AmenityStatus.Content, 0),
            >= -2 => (AmenityStatus.Displeased, -10),
            >= -4 => (AmenityStatus.Unrest, -25),
            _ => (AmenityStatus.Revolt, -40),
        };
        r.LoyaltyYieldPercent = LoyaltyYieldPercent(city.Loyalty);

        var gross = r.Tiles + r.Districts + r.Buildings + r.Modifiers;
        var percent = fx.PercentYields;
        foreach (var t in YieldSet.All)
            percent.Add(t, r.AmenityYieldPercent + r.LoyaltyYieldPercent);
        r.Total = gross.ApplyPercent(percent);
        foreach (var t in YieldSet.All) r.Total[t] = Fx.Max(r.Total[t], Fx.Zero);
        // Citizens eat 2 food each, modified by the Divergence (Symbiont citizens photosynthesize; the Discarnate don't eat).
        int upkeepPercent = Math.Max(0, 100 + fx.CitizenFoodUpkeepPercent);
        r.FoodSurplus = r.Total.Food - Fx.FromInt(2 * city.Population) * upkeepPercent / 100;
        r.PowerDemand += city.Population * fx.CitizenPowerDemandTenths / 10;
        return r;
    }

    public static int LoyaltyYieldPercent(Fx loyalty) =>
        loyalty >= 70 ? 0 : loyalty >= 40 ? -15 : loyalty >= 15 ? -35 : -60;

    private static Fx TileScore(YieldSet y, bool citizensEat) => citizensEat
        ? y.Food * 3 + y.Production * 2 + y.Gold + y.Science * 2 + y.Culture * 2 + y.Faith
        : y.Food / 2 + y.Production * 3 + y.Gold + y.Science * 3 + y.Culture + y.Faith;

    public static int BaseHousing(MapGrid map, int cityTile) =>
        map.HasFreshWaterAccess(cityTile) ? 5 : map.IsAdjacentToSea(cityTile) ? 3 : 2;

    private static int DistrictHousing(MapGrid map, CityState city, DistrictDef def, int tile)
    {
        if (def.Id == "DISTRICT_NEIGHBORHOOD")
        {
            int appeal = map.Appeal(tile);
            return appeal >= 4 ? 6 : appeal >= 2 ? 5 : appeal >= -1 ? 4 : 3;
        }
        if (def.Id == "DISTRICT_AQUEDUCT")
            return map.HasFreshWaterAccess(city.Tile) ? 2 : def.Housing;
        return def.Housing;
    }

    public static Fx GrowthThreshold(int population)
    {
        int p = population - 1;
        return 15 + 8 * p + Fx.FromInt(p) * Fx.Sqrt(Fx.FromInt(p));
    }

    /// <summary>Growth slows as population approaches housing and stops 4 over.</summary>
    public static int HousingGrowthPercent(int population, int housing) =>
        population >= housing + 4 ? 0 : population >= housing ? 25 : population == housing - 1 ? 50 : 100;
}
