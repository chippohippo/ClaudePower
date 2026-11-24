using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.State;

namespace UnbrokenAges.Sim.Systems;

/// <summary>
/// Outposts (docs/09 §3, from Shadow Empire's regions): a cheap claim planted by Waymakers on unclaimed land. It holds
/// the tiles around it, seeds supply, and harvests one resource (strategic → stockpile, others → gold). It has no city
/// screen and nothing to manage. It can be bought up into a city once it is far enough from other cities. An enemy
/// army standing on it at the end of a turn burns it. We do not split settlements into towns and cities: an outpost
/// is a claim, not a second kind of city.
/// </summary>
public static class OutpostSystem
{
    public static OutpostRules Rules(GameState s) => s.Db.Rules.Outposts;

    public static string? ValidateFound(GameState s, int player, UnitState unit)
    {
        var map = s.Map;
        int tile = unit.Tile;
        if (!s.Db.Units[unit.DefIndex].FoundsOutpost) return "This unit cannot plant outposts.";
        if (!map.IsLand(tile) || map.IsMountain(tile)) return "Outposts must be planted on land.";
        if (map.OwnerPlayer[tile] >= 0) return "Outposts claim unclaimed land only.";
        int min = Rules(s).MinDistance;
        if (s.Cities.Any(c => map.Distance(c.Tile, tile) < min) || s.Outposts.Any(o => map.Distance(o.Tile, tile) < min))
            return $"Must be at least {min} tiles from any city or outpost.";
        return null;
    }

    public static OutpostState Found(GameState s, int player, int tile, List<GameEvent> events)
    {
        var map = s.Map;
        var outpost = new OutpostState { Id = s.AllocateId(), Owner = player, Tile = tile, FoundedTurn = s.Turn };
        var area = new List<int>();
        map.CollectRadius(tile, Rules(s).ClaimRadius, area);
        area.Sort();
        foreach (int t in area)
        {
            if (map.OwnerPlayer[t] >= 0) continue;
            map.OwnerPlayer[t] = player;
            map.OwnerCity[t] = -1;
            outpost.Tiles.Add(t);
        }
        outpost.HarvestTile = BestHarvest(s, outpost.Tiles);
        outpost.Name = outpost.HarvestTile >= 0 ? $"{s.Db.Resources[map.Resource[outpost.HarvestTile]].Name} Outpost" : "Waystation";
        s.Outposts.Add(outpost);
        events.Add(new GameEvent(GameEventType.OutpostFounded, player, Tile: tile, Detail: outpost.Name));
        return outpost;
    }

    /// <summary>Strategic beats luxury beats bonus; ties go to the lowest tile index.</summary>
    private static int BestHarvest(GameState s, List<int> tiles)
    {
        int best = -1, bestRank = 0;
        foreach (int t in tiles)
        {
            if (s.Map.Resource[t] < 0) continue;
            int rank = s.Db.Resources[s.Map.Resource[t]].Class switch
            {
                ResourceClass.Strategic => 3,
                ResourceClass.Luxury => 2,
                ResourceClass.Bonus => 1,
                _ => 0,
            };
            if (rank > bestRank) { bestRank = rank; best = t; }
        }
        return best;
    }

    /// <summary>What this outpost yields each turn, for the tooltip and the treasury.</summary>
    public static (int Gold, int Resource, int Stockpile) Harvest(GameState s, OutpostState o)
    {
        var rules = Rules(s);
        int gold = rules.GoldPerTurn;
        if (o.HarvestTile < 0 || s.Map.Resource[o.HarvestTile] < 0 || s.Map.OwnerPlayer[o.HarvestTile] != o.Owner) return (gold, -1, 0);
        var res = s.Db.Resources[s.Map.Resource[o.HarvestTile]];
        return res.Class switch
        {
            ResourceClass.Strategic when s.Players[o.Owner].HasTech(res.RevealTechIndex) => (gold, res.Index, rules.StrategicPerTurn),
            ResourceClass.Strategic => (gold, -1, 0),
            ResourceClass.Luxury => (gold + rules.LuxuryGold, -1, 0),
            ResourceClass.Bonus => (gold + rules.BonusGold, -1, 0),
            _ => (gold, -1, 0),
        };
    }

    public static int PromoteCost(GameState s, OutpostState o) =>
        (Rules(s).PromoteGold + Rules(s).PromoteGoldPerCity * s.CitiesOf(o.Owner).Count()) * (100 - NationSystem.OutpostDiscount(s, o.Owner)) / 100;

    public static string? ValidatePromote(GameState s, OutpostState o)
    {
        if (s.Cities.Any(c => s.Map.Distance(c.Tile, o.Tile) < Commands.FoundCityCommand.MinCityDistance))
            return "Too close to another city to grow into one.";
        int cost = PromoteCost(s, o);
        return s.Players[o.Owner].Gold < cost ? $"Costs {cost} gold." : null;
    }

    public static CityState Promote(GameState s, OutpostState o, List<GameEvent> events)
    {
        s.Players[o.Owner].Gold -= PromoteCost(s, o);
        s.Outposts.Remove(o);
        var city = CitySystem.Found(s, o.Owner, o.Tile);
        foreach (int t in o.Tiles)
            if (s.Map.OwnerPlayer[t] == o.Owner && s.Map.OwnerCity[t] < 0) CitySystem.ClaimTile(s, city, t);
        events.Add(new GameEvent(GameEventType.OutpostPromoted, o.Owner, city.Id, o.Tile, Detail: city.Name));
        events.Add(new GameEvent(GameEventType.CityFounded, o.Owner, city.Id, o.Tile, Detail: city.Name));
        return city;
    }

    /// <summary>Removes the outpost and releases the tiles it still holds.</summary>
    public static void Release(GameState s, OutpostState o)
    {
        foreach (int t in o.Tiles)
            if (s.Map.OwnerPlayer[t] == o.Owner && s.Map.OwnerCity[t] < 0) s.Map.OwnerPlayer[t] = -1;
        s.Outposts.Remove(o);
    }

    /// <summary>End of turn: harvest, then burn outposts with an enemy military unit standing on them.</summary>
    public static void ProcessTurn(GameState s, List<GameEvent> events)
    {
        foreach (var o in s.Outposts.ToList())
        {
            var owner = s.Players[o.Owner];
            var raider = s.Units.FirstOrDefault(u => u.Tile == o.Tile && u.Owner != o.Owner && s.Db.Units[u.DefIndex].Strength > 0
                                                     && DiplomacySystem.AtWar(s, u.Owner, o.Owner));
            if (raider != null)
            {
                Release(s, o);
                events.Add(new GameEvent(GameEventType.OutpostRazed, o.Owner, Tile: o.Tile, Value: raider.Owner, Detail: o.Name));
                continue;
            }
            if (!owner.IsAlive) continue;
            var (gold, resource, stockpile) = Harvest(s, o);
            owner.Gold += gold;
            if (resource >= 0)
            {
                var res = s.Db.Resources[resource];
                int cap = res.StockpileCap > 0 ? res.StockpileCap : 50;
                owner.Stockpile[resource] = Math.Min(cap, owner.Stockpile[resource] + stockpile);
            }
        }
    }
}
