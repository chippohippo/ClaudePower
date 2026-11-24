using UnbrokenAges.Sim.Core;
using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.State;
using UnbrokenAges.Sim.Systems.Districts;

namespace UnbrokenAges.Sim.Systems;

/// <summary>
/// Trade routes (docs/05-key-systems/17-trade.md). A Trader in one of your cities opens a route to a city within reach (15 tiles
/// over land, 20 by sea between coastal cities). The route runs for 30 turns, then the trader comes home to be sent again.
/// <list type="bullet">
/// <item><b>Domestic</b>: the origin gains Food and Production, more the more districts the destination has.</item>
/// <item><b>International</b>: the origin gains Gold (districts, a Market and distance add more), Science from a more advanced partner,
/// Culture from a Cultural Quarter; the destination gains +1 Gold.</item>
/// <item><b>City-state</b>: Gold and +2 influence a turn toward envoys.</item>
/// </list>
/// Capacity: one route per city with a Market or Harbor, plus one with Foreign Trade. A war between the partners ends a route.
/// An enemy military unit (raiders included) standing on a route plunders it: the trader is lost and the raider's civilization
/// takes 30 gold.
/// </summary>
public static class TradeSystem
{
    public const int LandRange = 15, SeaRange = 20, Duration = 30, PlunderGold = 30, CityStateInfluence = 2;

    public static bool IsTrader(UnitDef u) => u.HasTag("Trader");

    public static int Capacity(GameState s, PlayerState p)
    {
        var db = s.Db;
        int market = db.Districts.IndexOf("DISTRICT_MARKET"), harbor = db.Districts.IndexOf("DISTRICT_HARBOR");
        int n = p.HasCivic(db.Civics.IndexOf("CIVIC_FOREIGN_TRADE")) ? 1 : 0;
        foreach (var c in s.CitiesOf(p.Id))
            if (c.Districts.Any(d => (market >= 0 && AdjacencyCalculator.DistrictMatches(db, d.DefIndex, market)) ||
                                     (harbor >= 0 && AdjacencyCalculator.DistrictMatches(db, d.DefIndex, harbor)))) n++;
        return n;
    }

    public static int Active(GameState s, int player) => s.TradeRoutes.Count(r => r.Owner == player);

    public static CityState? OriginOf(GameState s, UnitState trader) =>
        s.Cities.FirstOrDefault(c => c.Tile == trader.Tile && c.Owner == trader.Owner);

    // ----- Paths ---------------------------------------------------------------------------------------

    /// <summary>The route's path from origin to destination: the shorter of a land path and (both coastal) a sea path, or null.</summary>
    public static List<int>? Path(GameState s, CityState from, CityState to)
    {
        var land = Search(s, from.Tile, to.Tile, LandRange, sea: false);
        var sea = Coastal(s, from) && Coastal(s, to) ? Search(s, from.Tile, to.Tile, SeaRange, sea: true) : null;
        if (land == null) return sea;
        if (sea == null) return land;
        return sea.Count < land.Count ? sea : land;
    }

    private static bool Coastal(GameState s, CityState c) =>
        Enumerable.Range(0, 6).Any(d => s.Map.Neighbor(c.Tile, d) is int n and >= 0 && s.Map.IsWater(n) && !s.Map.IsChannel(n));

    /// <summary>Breadth-first search (ties broken by tile order, so every peer finds the same path), up to <paramref name="max"/> steps.</summary>
    private static List<int>? Search(GameState s, int start, int goal, int max, bool sea)
    {
        var map = s.Map;
        var db = s.Db;
        bool Passable(int t)
        {
            if (t == goal) return true;
            if (map.Feature[t] >= 0 && db.Features[map.Feature[t]].Impassable) return false;
            if (sea) return map.IsWater(t) && !map.HasFlag(t, Map.TileFlags.Submerged) || s.Cities.Any(c => c.Tile == t);
            if (map.HasFlag(t, Map.TileFlags.Submerged)) return false;
            return map.IsLand(t) && !map.IsMountain(t) && !db.Reliefs[map.Relief[t]].Impassable || map.IsChannel(t);
        }
        var prev = new Dictionary<int, int> { [start] = -1 };
        var frontier = new List<int> { start };
        for (int step = 0; step < max && frontier.Count > 0; step++)
        {
            var next = new List<int>();
            foreach (int t in frontier)
                for (int d = 0; d < 6; d++)
                {
                    int n = map.Neighbor(t, d);
                    if (n < 0 || prev.ContainsKey(n) || !Passable(n)) continue;
                    prev[n] = t;
                    if (n == goal)
                    {
                        var path = new List<int>();
                        for (int c = goal; c >= 0; c = prev[c]) path.Add(c);
                        path.Reverse();
                        return path;
                    }
                    next.Add(n);
                }
            next.Sort();
            frontier = next;
        }
        return null;
    }

    // ----- Yields --------------------------------------------------------------------------------------

    public enum RouteKind { Domestic, International, CityState }

    public static RouteKind KindOf(GameState s, int owner, CityState destination) =>
        destination.Owner == owner ? RouteKind.Domestic : s.Players[destination.Owner].IsCityState ? RouteKind.CityState : RouteKind.International;

    private static int Specialty(GameState s, CityState c) =>
        c.Districts.Count(d => !d.Pillaged && s.Db.Districts[d.DefIndex].Category == DistrictCategory.Specialty);

    /// <summary>What a route pays its origin each turn (and what the destination's owner gains).</summary>
    public static (YieldSet Origin, YieldSet Destination, int Influence) Yields(GameState s, int owner, CityState destination, int pathLength)
    {
        var db = s.Db;
        var origin = new YieldSet();
        var dest = new YieldSet();
        int influence = 0;
        int districts = Specialty(s, destination);
        switch (KindOf(s, owner, destination))
        {
            case RouteKind.Domestic:
                origin.Food = Fx.FromInt(2 + districts / 2);
                origin.Production = Fx.FromInt(1 + (districts + 1) / 2);
                break;
            case RouteKind.CityState:
                origin.Gold = Fx.FromInt(4 + pathLength / 6);
                influence = CityStateInfluence;
                break;
            default:
                int market = db.Districts.IndexOf("DISTRICT_MARKET"), culture = db.Districts.IndexOf("DISTRICT_CULTURAL_QUARTER");
                bool Has(int family) => family >= 0 && destination.Districts.Any(d => AdjacencyCalculator.DistrictMatches(db, d.DefIndex, family));
                origin.Gold = Fx.FromInt(3 + districts + (Has(market) ? 2 : 0) + pathLength / 5);
                if (s.Players[destination.Owner].Techs.Count(x => x) > s.Players[owner].Techs.Count(x => x)) origin.Science = Fx.One;
                if (Has(culture)) origin.Culture = Fx.One;
                dest.Gold = Fx.One;
                break;
        }
        return (origin, dest, influence);
    }

    private static readonly Dictionary<string, List<ModifierDef>> Cache = new();

    private static List<ModifierDef> Mods(YieldSet y)
    {
        string key = string.Join(",", YieldSet.All.Select(t => y[t].Raw));
        lock (Cache)
        {
            if (Cache.TryGetValue(key, out var list)) return list;
            list = YieldSet.All.Where(t => y[t] != Fx.Zero)
                               .Select(t => new ModifierDef { Effect = ModifierEffect.CityYieldFlat, Yield = t, Amount = y[t] }).ToList();
            return Cache[key] = list;
        }
    }

    /// <summary>Route yields on a city: routes starting here, and foreign routes arriving here.</summary>
    public static IEnumerable<(List<ModifierDef> Modifiers, string Source)> CityModifierSources(GameState s, CityState city)
    {
        foreach (var r in s.TradeRoutes)
        {
            if (r.Origin != city.Id && r.Destination != city.Id) continue;
            if (s.GetCity(r.Origin) is not { } origin || s.GetCity(r.Destination) is not { } dest) continue;
            var (o, d, _) = Yields(s, r.Owner, dest, r.Path.Count);
            if (r.Origin == city.Id && city.Owner == r.Owner) yield return (Mods(o), $"Trade route to {dest.Name}");
            else if (r.Destination == city.Id && city.Owner != r.Owner && d.Gold != Fx.Zero) yield return (Mods(d), $"Trade from {origin.Name}");
        }
    }

    public static int InfluenceFromRoutes(GameState s, int player)
    {
        int n = 0;
        foreach (var r in s.TradeRoutes)
            if (r.Owner == player && s.GetCity(r.Destination) is { } dest && s.Players[dest.Owner].IsCityState) n += CityStateInfluence;
        return n;
    }

    // ----- Establishing --------------------------------------------------------------------------------

    public static string? CanEstablish(GameState s, UnitState trader, int destinationCity)
    {
        if (!IsTrader(s.Db.Units[trader.DefIndex])) return "Only traders open trade routes.";
        if (OriginOf(s, trader) is not { } origin) return "The trader must be in one of your cities.";
        if (s.GetCity(destinationCity) is not { } dest) return "No such city.";
        if (dest.Id == origin.Id) return "Choose another city.";
        var owner = s.Players[trader.Owner];
        if (s.Players[dest.Owner].IsFreeCities) return "The Free Cities do not trade.";
        if (dest.Owner != owner.Id && DiplomacySystem.AtWar(s, owner.Id, dest.Owner)) return "You are at war with them.";
        if (Active(s, owner.Id) >= Capacity(s, owner)) return $"All {Capacity(s, owner)} trade route slots are in use (Markets and Harbors add more).";
        if (s.TradeRoutes.Any(r => r.Origin == origin.Id && r.Destination == dest.Id)) return "A route already runs there.";
        if (Path(s, origin, dest) == null) return $"Out of reach ({LandRange} tiles over land, {SeaRange} by sea).";
        return null;
    }

    public static void Establish(GameState s, UnitState trader, int destinationCity, List<GameEvent> events)
    {
        var origin = OriginOf(s, trader)!;
        var dest = s.GetCity(destinationCity)!;
        var path = Path(s, origin, dest)!;
        var route = new TradeRouteState
        {
            Id = s.AllocateId(), Owner = trader.Owner, Origin = origin.Id, Destination = dest.Id,
            TurnsLeft = Duration * s.Options.GameSpeedPercent / 100, Path = path, TraderDef = trader.DefIndex,
        };
        s.TradeRoutes.Add(route);
        s.RemoveUnit(trader);
        events.Add(new GameEvent(GameEventType.TradeRouteEstablished, trader.Owner, origin.Id, dest.Tile, Value: dest.Owner, Detail: $"{origin.Name} → {dest.Name}"));
    }

    // ----- The turn ------------------------------------------------------------------------------------

    public static void ProcessTurn(GameState s, List<GameEvent> events)
    {
        foreach (var r in s.TradeRoutes.OrderBy(r => r.Id).ToList())
        {
            var origin = s.GetCity(r.Origin);
            var dest = s.GetCity(r.Destination);
            bool broken = origin == null || origin.Owner != r.Owner || dest == null || s.Players[dest.Owner].IsFreeCities ||
                          (dest.Owner != r.Owner && DiplomacySystem.AtWar(s, r.Owner, dest.Owner));
            var raider = broken ? null : s.Units.Where(u => r.Path.Contains(u.Tile) && u.Owner != r.Owner && SupplySystem.IsMilitary(s.Db, u) &&
                                                            DiplomacySystem.AtWar(s, r.Owner, u.Owner))
                                                .OrderBy(u => u.Id).FirstOrDefault();
            if (raider != null)
            {
                s.TradeRoutes.Remove(r);
                if (s.Players[raider.Owner].IsMajor) s.Players[raider.Owner].Gold += Fx.FromInt(PlunderGold);
                events.Add(new GameEvent(GameEventType.TradeRoutePlundered, r.Owner, r.Origin, raider.Tile, Value: raider.Owner,
                                         Detail: $"{origin!.Name} → {dest!.Name}"));
                continue;
            }
            if (!broken && --r.TurnsLeft > 0) continue;
            s.TradeRoutes.Remove(r);
            if (origin != null && origin.Owner == r.Owner)
            {
                var def = s.Db.Units[r.TraderDef];
                s.AddUnit(new UnitState { Id = s.AllocateId(), Owner = r.Owner, DefIndex = def.Index, Tile = origin.Tile, MovesLeft = Fx.FromInt(def.Moves) });
            }
            events.Add(new GameEvent(GameEventType.TradeRouteEnded, r.Owner, r.Origin, origin?.Tile ?? -1, Detail: origin != null && dest != null ? $"{origin.Name} → {dest.Name}" : "a route"));
        }
    }

    /// <summary>Every destination a trader standing in a city could open now, best first by the AI's weights.</summary>
    public static List<(CityState City, YieldSet Origin, int Influence, double Score)> Options(GameState s, UnitState trader)
    {
        var result = new List<(CityState, YieldSet, int, double)>();
        if (OriginOf(s, trader) is not { } origin) return result;
        foreach (var dest in s.Cities.Where(c => s.Map.Distance(c.Tile, origin.Tile) <= SeaRange).OrderBy(c => c.Id))
        {
            if (CanEstablish(s, trader, dest.Id) != null) continue;
            var path = Path(s, origin, dest)!;
            var (o, _, influence) = Yields(s, trader.Owner, dest, path.Count);
            double score = o.Gold.ToDouble() + 1.3 * o.Food.ToDouble() + 1.5 * o.Production.ToDouble() + 3 * o.Science.ToDouble() + 2 * o.Culture.ToDouble() + 2 * influence;
            result.Add((dest, o, influence, score));
        }
        return result.OrderByDescending(x => x.Item4).ThenBy(x => x.Item1.Id).ToList();
    }
}
