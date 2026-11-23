using UnbrokenAges.Sim.Core;
using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.State;

namespace UnbrokenAges.Sim.Systems;

/// <summary>
/// Borders grow from culture: each city banks its Culture yield, and when the bank reaches the next threshold
/// (15 + 8 × tiles already grown) it claims the most valuable unclaimed tile touching its territory, within 5
/// tiles of the city. Players can also buy a tile with gold (within 3 tiles; 20 × distance + 5 × tiles grown).
/// The city panel shows "next tile in N turns: Wine (Plains)" so growth is never a mystery.
/// </summary>
public static class BorderSystem
{
    public const int MaxGrowthRadius = 5;
    public const int MaxPurchaseRadius = 3;

    public static Fx Threshold(CityState city) => 15 + 8 * city.TilesClaimed;

    public static int PurchaseCost(GameState s, CityState city, int tile) =>
        20 * s.Map.Distance(city.Tile, tile) + 5 * city.TilesClaimed;

    public static void Grow(GameState s, CityState city, Fx culture, List<GameEvent> events)
    {
        city.BorderProgress += culture;
        if (city.BorderProgress < Threshold(city)) return;
        int best = BestCandidate(s, city, MaxGrowthRadius);
        if (best < 0) return; // nothing left to claim: keep banking
        city.BorderProgress -= Threshold(city);
        Claim(s, city, best, events);
    }

    /// <summary>The tile the city will claim next (-1 if none), so the UI can preview it.</summary>
    public static int BestCandidate(GameState s, CityState city, int radius)
    {
        var map = s.Map;
        var db = s.Db;
        int best = -1;
        Fx bestScore = Fx.MinValue;
        var ring = new List<int>();
        map.CollectRadius(city.Tile, radius, ring);
        ring.Sort();
        foreach (int t in ring)
        {
            if (!IsClaimable(s, city, t)) continue;
            var y = map.TileYields(t);
            Fx score = y.Food * 3 + y.Production * 2 + y.Gold + (y.Science + y.Culture + y.Faith) * 2 - map.Distance(city.Tile, t) * 2;
            if (map.Resource[t] >= 0) score += db.Resources[map.Resource[t]].Class == ResourceClass.Bonus ? 4 : 8;
            if (map.HasFreshWaterAccess(t)) score += 1;
            if (score > bestScore) { bestScore = score; best = t; }
        }
        return best;
    }

    /// <summary>Next tile and turns until culture claims it (Turns = -1 when no culture or no tile).</summary>
    public static (int Tile, int Turns) Forecast(GameState s, CityState city, Fx culturePerTurn)
    {
        int tile = BestCandidate(s, city, MaxGrowthRadius);
        if (tile < 0 || culturePerTurn <= Fx.Zero) return (tile, -1);
        Fx missing = Threshold(city) - city.BorderProgress;
        if (missing <= Fx.Zero) return (tile, 1);
        return (tile, (missing / culturePerTurn).CeilToInt());
    }

    /// <summary>"Wine (Plains)" for the city panel.</summary>
    public static string Describe(GameState s, int tile)
    {
        var map = s.Map;
        string terrain = s.Db.Terrains[map.Terrain[tile]].Name;
        return map.Resource[tile] >= 0 ? $"{s.Db.Resources[map.Resource[tile]].Name} ({terrain})" : terrain;
    }

    /// <summary>Unclaimed and touching this city's territory.</summary>
    public static bool IsClaimable(GameState s, CityState city, int tile)
    {
        var map = s.Map;
        if (map.OwnerPlayer[tile] >= 0) return false;
        for (int d = 0; d < 6; d++)
        {
            int n = map.Neighbor(tile, d);
            if (n >= 0 && map.OwnerCity[n] == city.Id) return true;
        }
        return false;
    }

    public static string? ValidatePurchase(GameState s, CityState city, int tile)
    {
        if (tile < 0 || tile >= s.Map.Count) return "Invalid tile.";
        if (s.Map.Distance(city.Tile, tile) > MaxPurchaseRadius) return $"Tiles can be bought up to {MaxPurchaseRadius} tiles from the city.";
        if (!IsClaimable(s, city, tile)) return "The tile must be unclaimed and touch this city's borders.";
        int cost = PurchaseCost(s, city, tile);
        return s.Players[city.Owner].Gold < cost ? $"Costs {cost} gold." : null;
    }

    public static void Purchase(GameState s, CityState city, int tile, List<GameEvent> events)
    {
        s.Players[city.Owner].Gold -= PurchaseCost(s, city, tile);
        Claim(s, city, tile, events);
    }

    private static void Claim(GameState s, CityState city, int tile, List<GameEvent> events)
    {
        CitySystem.ClaimTile(s, city, tile);
        city.TilesClaimed++;
        events.Add(new GameEvent(GameEventType.TileClaimed, city.Owner, city.Id, tile));
    }
}
