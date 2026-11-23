using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.Map;
using UnbrokenAges.Sim.State;

namespace UnbrokenAges.Sim.Systems;

/// <summary>
/// Supply lines (Shadow Empire's logistics, made Civ-easy). There are no trucks and no routing screens:
/// supply is computed for you and shown as a lens.
///
/// * Land supply flows out of every city (plus a bonus per Garrison-type district), paying a cost per
///   tile: cheap in your territory, dearer in neutral land, expensive in foreign land, +1 in rough
///   terrain. Great River channels are highways (cost 1), so river cities project power inland.
/// * Sea supply flows from Harbors and River Ports over coast, lakes and rivers; land tiles right next to
///   well-supplied water count as supplied (beachheads).
/// * Each turn, supplied military units heal; units cut off in foreign territory take attrition and can
///   be lost. Combat v2 will also apply an out-of-supply strength penalty.
/// </summary>
public static class SupplySystem
{
    /// <summary>Remaining supply per tile for one player (-1 = no supply).</summary>
    public static int[] Compute(GameState s, int player)
    {
        var map = s.Map;
        var rules = s.Db.Rules.Supply;
        var team = s.Players[player].Team;
        var land = Fill(s, player, team, rules, maritime: false);
        var sea = Fill(s, player, team, rules, maritime: true);
        var result = new int[map.Count];
        for (int t = 0; t < map.Count; t++)
        {
            int best = Math.Max(land[t], sea[t]);
            if (best < 0 && map.IsLand(t))
            {
                for (int d = 0; d < 6; d++)
                {
                    int n = map.Neighbor(t, d);
                    if (n >= 0 && map.IsWater(n) && sea[n] >= 2) best = Math.Max(best, 0); // beachhead
                }
            }
            result[t] = best;
        }
        return result;
    }

    private static int[] Fill(GameState s, int player, int team, SupplyRules rules, bool maritime)
    {
        var map = s.Map;
        var db = s.Db;
        var remaining = new int[map.Count];
        Array.Fill(remaining, -1);
        var pq = new PriorityQueue<int, long>();
        void Seed(int tile, int budget)
        {
            if (budget <= remaining[tile]) return;
            remaining[tile] = budget;
            pq.Enqueue(tile, ((long)(1000 - budget) << 24) | (uint)tile);
        }
        foreach (var city in s.CitiesOf(player))
        {
            if (!maritime)
            {
                int military = city.Districts.Count(d => !d.Pillaged && db.Districts[d.DefIndex].HasTag("Military"));
                Seed(city.Tile, rules.CityRange + military * rules.MilitaryDistrictBonus);
            }
            else
            {
                foreach (var d in city.Districts)
                    if (!d.Pillaged && db.Districts[d.DefIndex].HasTag("Port") && map.IsWater(d.Tile)) Seed(d.Tile, rules.PortRange);
            }
        }

        if (!maritime)
            foreach (var o in s.Outposts)
                if (o.Owner == player) Seed(o.Tile, db.Rules.Outposts.SupplyRange);

        while (pq.TryDequeue(out int cur, out _))
        {
            int budget = remaining[cur];
            for (int d = 0; d < 6; d++)
            {
                int n = map.Neighbor(cur, d);
                if (n < 0) continue;
                int cost = StepCost(s, rules, player, team, n, maritime);
                if (cost < 0) continue;
                int left = budget - cost;
                if (left < 0 || left <= remaining[n]) continue;
                remaining[n] = left;
                pq.Enqueue(n, ((long)(1000 - left) << 24) | (uint)n);
            }
        }
        return remaining;
    }

    private static int StepCost(GameState s, SupplyRules rules, int player, int team, int tile, bool maritime)
    {
        var map = s.Map;
        var db = s.Db;
        if (map.IsChannel(tile)) return rules.ChannelCost;
        if (maritime)
        {
            if (!map.IsWater(tile)) return -1;
            if (map.Feature[tile] >= 0 && db.Features[map.Feature[tile]].Impassable) return -1;
            return map.ClassAt(tile) == TerrainClass.Ocean ? rules.WaterCost + 1 : rules.WaterCost;
        }
        if (map.IsWater(tile) || db.Reliefs[map.Relief[tile]].Impassable) return -1;
        int owner = map.OwnerPlayer[tile];
        int cost = owner < 0 ? rules.NeutralCost : owner == player || s.Players[owner].Team == team ? rules.OwnCost : rules.ForeignCost;
        bool rough = map.Relief[tile] == db.Ids.Hills || (map.Feature[tile] >= 0 && db.Features[map.Feature[tile]].MoveCost > 1);
        return rough ? cost + rules.RoughExtra : cost;
    }

    public static bool IsMilitary(GameDatabase db, UnitState u) =>
        db.Units[u.DefIndex].Domain != UnitDomain.Civilian && db.Units[u.DefIndex].Strength > 0;

    public static void ProcessTurn(GameState s, List<GameEvent> events)
    {
        var rules = s.Db.Rules.Supply;
        var cache = new Dictionary<int, int[]>();
        foreach (var unit in s.Units.ToList())
        {
            if (!IsMilitary(s.Db, unit)) continue;
            if (!cache.TryGetValue(unit.Owner, out var supply)) cache[unit.Owner] = supply = Compute(s, unit.Owner);
            if (supply[unit.Tile] >= 0)
            {
                unit.Hp = Math.Min(100, unit.Hp + rules.HealHp);
                continue;
            }
            int owner = s.Map.OwnerPlayer[unit.Tile];
            bool hostileGround = owner >= 0 && DiplomacySystem.AtWar(s, unit.Owner, owner);
            bool openSea = s.Map.IsWater(unit.Tile) && !s.Map.IsChannel(unit.Tile);
            if (!hostileGround && !openSea) continue; // unsupplied at home or in the wilds: no healing, no attrition
            unit.Hp -= rules.AttritionHp;
            if (unit.Hp <= 0)
            {
                s.RemoveUnit(unit);
                events.Add(new GameEvent(GameEventType.UnitLostToAttrition, unit.Owner, Tile: unit.Tile, Def: unit.DefIndex, Detail: s.Db.Units[unit.DefIndex].Name));
            }
        }
    }
}
