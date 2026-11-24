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

    /// <summary>
    /// What a search knows once: tiles held by others (units or cities), and whether each owner's land may be entered. Its arrays
    /// are reused from search to search (one set per thread: the AI may plan on a background thread); a generation stamp marks
    /// which entries belong to the current search, so nothing needs clearing.
    /// </summary>
    private sealed class SearchContext
    {
        public int[] BlockedAt = Array.Empty<int>(), SeenAt = Array.Empty<int>(), ClosedAt = Array.Empty<int>(), G = Array.Empty<int>(), From = Array.Empty<int>();
        public int Generation;
        public readonly Dictionary<int, bool> MayEnter = new();
        public bool Military;
        public bool Blocked(int tile) => BlockedAt[tile] == Generation;
        public bool Seen(int tile) => SeenAt[tile] == Generation;
        public bool Closed(int tile) => ClosedAt[tile] == Generation;
    }

    [ThreadStatic] private static SearchContext? pool;

    private static SearchContext Context(GameState s, UnitState unit)
    {
        var ctx = pool ??= new SearchContext();
        int n = s.Map.Count;
        if (ctx.G.Length < n)
        {
            ctx.BlockedAt = new int[n]; ctx.SeenAt = new int[n]; ctx.ClosedAt = new int[n]; ctx.G = new int[n]; ctx.From = new int[n];
            ctx.Generation = 0;
        }
        if (++ctx.Generation == int.MaxValue)
        {
            Array.Clear(ctx.BlockedAt); Array.Clear(ctx.SeenAt); Array.Clear(ctx.ClosedAt);
            ctx.Generation = 1;
        }
        ctx.MayEnter.Clear();
        ctx.Military = SupplySystem.IsMilitary(s.Db, unit);
        foreach (var other in s.Units) if (other.Owner != unit.Owner && other.Tile >= 0) ctx.BlockedAt[other.Tile] = ctx.Generation;
        foreach (var c in s.Cities) if (c.Owner != unit.Owner) ctx.BlockedAt[c.Tile] = ctx.Generation;
        return ctx;
    }

    private static int EnterCost(GameState s, UnitState unit, int from, int to, SearchContext ctx)
    {
        if (s.Db.Units[unit.DefIndex].Domain == UnitDomain.Air) return 1;
        if (ctx.Blocked(to)) return Impassable;
        int owner = s.Map.OwnerPlayer[to];
        if (ctx.Military && owner >= 0 && owner != unit.Owner)
        {
            if (!ctx.MayEnter.TryGetValue(owner, out bool may)) ctx.MayEnter[owner] = may = DiplomacySystem.MayEnter(s, unit.Owner, owner);
            if (!may) return Impassable;
        }
        return TerrainCost(s, unit, from, to);
    }

    public static int EnterCost(GameState s, UnitState unit, int from, int to)
    {
        var db = s.Db;
        var map = s.Map;
        if (db.Units[unit.DefIndex].Domain == UnitDomain.Air) return 1;   // aircraft overfly units, cities and borders (they land only at bases)
        foreach (var other in s.Units)
            if (other.Tile == to && other.Owner != unit.Owner) return Impassable;
        if (s.Cities.Any(c => c.Tile == to && c.Owner != unit.Owner)) return Impassable; // cities are captured, not walked into
        // Closed borders: armies need war, an alliance or open borders to enter foreign land.
        if (SupplySystem.IsMilitary(db, unit) && map.OwnerPlayer[to] >= 0 && map.OwnerPlayer[to] != unit.Owner &&
            !DiplomacySystem.MayEnter(s, unit.Owner, map.OwnerPlayer[to]))
            return Impassable;
        return TerrainCost(s, unit, from, to);
    }

    /// <summary>Cost from terrain alone (no units, cities or borders), used by combat to judge reachability.</summary>
    public static int TerrainCost(GameState s, UnitState unit, int from, int to)
    {
        var db = s.Db;
        var map = s.Map;
        var def = db.Units[unit.DefIndex];
        if (map.HasFlag(to, TileFlags.Submerged) && map.IsLand(to)) return Impassable;
        if (map.Feature[to] >= 0 && db.Features[map.Feature[to]].Impassable) return Impassable;
        if (def.Domain == UnitDomain.Air) return 1;   // aircraft fly over land, water and mountains alike

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
        if (map.IsWater(to))
        {
            // Embarkation: across the shallows with Sailing, the open ocean with Celestial Navigation; boarding takes longer.
            if (!CanEmbark(s, unit, to)) return Impassable;
            return map.IsWater(from) && !map.IsChannel(from) ? 1 : 2;
        }
        if (map.IsWater(from) && !map.IsChannel(from) && db.Units[unit.DefIndex].Domain is UnitDomain.Land or UnitDomain.Civilian)
            return Math.Max(2, Math.Max(db.Terrains[map.Terrain[to]].MoveCost, db.Reliefs[map.Relief[to]].MoveCost));   // landing
        if (map.IsMountain(to) && NationSystem.MountainCost(s, unit) is var climb and > 0) return climb;   // Inca roads in the sky
        if (db.Reliefs[map.Relief[to]].Impassable) return Impassable;

        int cost = Math.Max(db.Terrains[map.Terrain[to]].MoveCost, db.Reliefs[map.Relief[to]].MoveCost);
        if (map.Feature[to] >= 0) cost = Math.Max(cost, db.Features[map.Feature[to]].MoveCost);
        int dir = map.DirectionTo(from, to);
        if (dir >= 0 && map.HasRiverEdge(from, dir) && !map.HasFlag(to, TileFlags.Bridge) && !map.HasFlag(from, TileFlags.Bridge))
            cost += RiverCrossingCost;
        return Math.Max(1, cost);
    }

    /// <summary>Whether a land unit may take to this water tile (coast and lakes, or open ocean), by its owner's research.</summary>
    public static bool CanEmbark(GameState s, UnitState unit, int tile)
    {
        var db = s.Db;
        if (db.Units[unit.DefIndex].Domain is not (UnitDomain.Land or UnitDomain.Civilian) || unit.Owner < 0 || unit.Owner >= s.Players.Count) return false;
        var p = s.Players[unit.Owner];
        var rules = db.Rules.Combat;
        if (!p.HasTech(db.Techs.IndexOf(rules.EmbarkTech))) return false;
        return s.Map.ClassAt(tile) != TerrainClass.Ocean || p.HasTech(db.Techs.IndexOf(rules.OceanEmbarkTech));
    }

    /// <summary>A land unit afloat (embarked on coast, lake or ocean; not fording a Great River).</summary>
    public static bool IsEmbarked(GameState s, UnitState unit) =>
        s.Db.Units[unit.DefIndex].Domain is UnitDomain.Land or UnitDomain.Civilian && unit.Tile >= 0 && s.Map.IsWater(unit.Tile) && !s.Map.IsChannel(unit.Tile);

    private static int FindCityTile(GameState s, int owner, int tile) =>
        s.Cities.Any(c => c.Tile == tile && c.Owner == owner) ? tile : -1;

    /// <summary>A* by total movement cost. Returns the path excluding the start, or null.</summary>
    public static List<int>? FindPath(GameState s, UnitState unit, int destination, int maxNodes = 20000)
    {
        var map = s.Map;
        if (destination < 0 || destination >= map.Count || destination == unit.Tile) return null;
        var ctx = Context(s, unit);
        int gen = ctx.Generation;
        int[] g = ctx.G, from = ctx.From, seen = ctx.SeenAt, closed = ctx.ClosedAt;
        g[unit.Tile] = 0; seen[unit.Tile] = gen;
        var open = new PriorityQueue<int, long>();
        open.Enqueue(unit.Tile, map.Distance(unit.Tile, destination));
        int expanded = 0;
        while (open.TryDequeue(out int cur, out _))
        {
            if (cur == destination)
            {
                var path = new List<int>();
                for (int t = cur; t != unit.Tile; t = from[t]) path.Add(t);
                path.Reverse();
                return path;
            }
            if (closed[cur] == gen) continue;
            closed[cur] = gen;
            if (++expanded > maxNodes) continue;
            for (int d = 0; d < 6; d++)
            {
                int nb = map.Neighbor(cur, d);
                if (nb < 0 || closed[nb] == gen) continue;
                int cost = EnterCost(s, unit, cur, nb, ctx);
                if (cost == Impassable) continue;
                int ng = g[cur] + cost;
                if (seen[nb] == gen && g[nb] <= ng) continue;
                g[nb] = ng; from[nb] = cur; seen[nb] = gen;
                long f = ng + map.Distance(nb, destination);
                open.Enqueue(nb, (f << 24) | (uint)nb);
            }
        }
        return null;
    }

    /// <summary>Advances along the path toward unit.Destination as far as moves allow.</summary>
    public static void MoveAlong(GameState s, UnitState unit, List<int>? known = null)
    {
        if (unit.Destination < 0) return;
        var path = known ?? FindPath(s, unit, unit.Destination);
        if (path == null) { unit.Destination = -1; return; }
        int full = UnitStats.Moves(s, unit);
        foreach (int next in path)
        {
            int cost = EnterCost(s, unit, unit.Tile, next);
            if (cost == Impassable) break;
            // A unit with all its moves may always take one step, however costly (classic rule).
            if (unit.MovesLeft < cost && unit.MovesLeft < full) break;
            if (unit.MovesLeft <= Fx.Zero) break;
            unit.MovesLeft = Fx.Max(Fx.Zero, unit.MovesLeft - cost);
            AirSystem.CarryAircraft(s, unit, unit.Tile, next);
            unit.Tile = next;
            unit.Fortified = false;
        }
        if (unit.Tile == unit.Destination) unit.Destination = -1;
    }
}
