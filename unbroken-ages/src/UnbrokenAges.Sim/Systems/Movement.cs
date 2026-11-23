using UnbrokenAges.Sim.Core;
using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.Map;
using UnbrokenAges.Sim.State;

namespace UnbrokenAges.Sim.Systems;

/// <summary>
/// Movement rules including navigable Great Rivers:
///  • Naval units sail Coast/Lake/Channel tiles (Ocean needs OceanGoing). Channels let early
///    galleys and river boats strike deep inland — and let inland cities build navies.
///  • Land units cannot enter open water, but may FORD a channel at a heavy cost, or cross
///    freely on a Bridge. Crossing an edge river costs +2 unless bridged.
/// </summary>
public static class Movement
{
    public const int Impassable = -1;
    public const int RiverCrossingCost = 2;

    public static int EnterCost(GameState s, UnitState unit, int from, int to)
    {
        var db = s.Db;
        var map = s.Map;
        var def = db.Units[unit.DefIndex];
        if (map.HasFlag(to, TileFlags.Submerged) && map.IsLand(to)) return Impassable;
        foreach (var other in s.Units)
            if (other.Tile == to && other.Owner != unit.Owner) return Impassable;
        if (map.Feature[to] >= 0 && db.Features[map.Feature[to]].Impassable) return Impassable;

        if (def.Domain == UnitDomain.Naval)
        {
            if (!map.IsWater(to)) return to == FindCityTile(s, unit.Owner, to) ? 1 : Impassable; // may dock in own cities
            var cls = map.ClassAt(to);
            if (cls == TerrainClass.Ocean && !def.OceanGoing) return Impassable;
            if (cls == TerrainClass.Channel && !def.RiverCapable) return Impassable;
            return 1;
        }

        if (map.IsChannel(to))
        {
            if (map.HasFlag(to, TileFlags.Bridge)) return 1;
            if (!def.RiverCapable) return Impassable;
            return Math.Max(2, db.Terrains[map.Terrain[to]].FordCost);
        }
        if (map.IsWater(to)) return Impassable;
        if (db.Reliefs[map.Relief[to]].Impassable) return Impassable;

        int cost = Math.Max(db.Terrains[map.Terrain[to]].MoveCost, db.Reliefs[map.Relief[to]].MoveCost);
        if (map.Feature[to] >= 0) cost = Math.Max(cost, db.Features[map.Feature[to]].MoveCost);
        int dir = map.DirectionTo(from, to);
        if (dir >= 0 && map.HasRiverEdge(from, dir) && !map.HasFlag(to, TileFlags.Bridge) && !map.HasFlag(from, TileFlags.Bridge))
            cost += RiverCrossingCost;
        return Math.Max(1, cost);
    }

    private static int FindCityTile(GameState s, int owner, int tile) =>
        s.Cities.Any(c => c.Tile == tile && c.Owner == owner) ? tile : -1;

    /// <summary>A* by total movement cost. Returns the path excluding the start, or null.</summary>
    public static List<int>? FindPath(GameState s, UnitState unit, int destination, int maxNodes = 20000)
    {
        var map = s.Map;
        if (destination < 0 || destination >= map.Count || destination == unit.Tile) return null;
        var gScore = new Dictionary<int, int> { [unit.Tile] = 0 };
        var cameFrom = new Dictionary<int, int>();
        var open = new PriorityQueue<int, long>();
        open.Enqueue(unit.Tile, map.Distance(unit.Tile, destination));
        var closed = new HashSet<int>();
        int expanded = 0;
        while (open.TryDequeue(out int cur, out _))
        {
            if (cur == destination)
            {
                var path = new List<int>();
                for (int t = cur; t != unit.Tile; t = cameFrom[t]) path.Add(t);
                path.Reverse();
                return path;
            }
            if (!closed.Add(cur) || ++expanded > maxNodes) continue;
            for (int d = 0; d < 6; d++)
            {
                int nb = map.Neighbor(cur, d);
                if (nb < 0 || closed.Contains(nb)) continue;
                int cost = EnterCost(s, unit, cur, nb);
                if (cost == Impassable) continue;
                int g = gScore[cur] + cost;
                if (gScore.TryGetValue(nb, out int old) && old <= g) continue;
                gScore[nb] = g;
                cameFrom[nb] = cur;
                long f = g + map.Distance(nb, destination);
                open.Enqueue(nb, (f << 24) | (uint)nb);
            }
        }
        return null;
    }

    /// <summary>Advances along the path toward unit.Destination as far as moves allow.</summary>
    public static void MoveAlong(GameState s, UnitState unit)
    {
        if (unit.Destination < 0) return;
        var path = FindPath(s, unit, unit.Destination);
        if (path == null) { unit.Destination = -1; return; }
        int full = s.Db.Units[unit.DefIndex].Moves;
        foreach (int next in path)
        {
            int cost = EnterCost(s, unit, unit.Tile, next);
            if (cost == Impassable) break;
            // A unit with all its moves may always take one step, however costly (classic rule).
            if (unit.MovesLeft < cost && unit.MovesLeft < full) break;
            if (unit.MovesLeft <= Fx.Zero) break;
            unit.MovesLeft = Fx.Max(Fx.Zero, unit.MovesLeft - cost);
            unit.Tile = next;
        }
        if (unit.Tile == unit.Destination) unit.Destination = -1;
    }
}
