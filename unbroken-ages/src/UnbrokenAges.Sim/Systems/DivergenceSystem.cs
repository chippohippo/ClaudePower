using UnbrokenAges.Sim.Core;
using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.Map;
using UnbrokenAges.Sim.State;
using UnbrokenAges.Sim.Systems.Districts;

namespace UnbrokenAges.Sim.Systems;

public sealed record LeaningSource(string Label, Fx Points);

public sealed record DivergenceLeaning(int Divergence, Fx Points, Fx Share, IReadOnlyList<LeaningSource> Sources);

/// <summary>
/// The Divergence: at the top of the tech tree humanity forks. Every civilization researches the
/// shared Threshold, then commits to exactly one doctrine. Commitment is permanent and locks the
/// other branches (techs, civics, units, buildings, terraforming, Ascension) forever.
///
/// * Leanings: a civ's history (what it built, how it powered itself, what it kept of nature)
///   makes one doctrine cheaper, so each civ's future follows rationally from its past.
/// * World remaking: committed civs turn the planet into their own terrain each turn, so the
///   late-game map looks different for each path (Engineered Ground, the Bloom, the Substrate).
/// * Ascension: each branch ends in a project that requires having remade a share of the world.
/// See docs/08-divergence-tech-tree.md.
/// </summary>
public static class DivergenceSystem
{
    public const int MaxDoctrineDiscountPercent = 45;

    // ----- Branch locks -----------------------------------------------------------------------------

    public static bool IsAvailable(PlayerState p, ProgressNodeDef node) =>
        node.DivergenceIndex < 0 || p.Divergence == node.DivergenceIndex || (node.Doctrine && p.Divergence < 0);

    public static string? LockReason(GameDatabase db, PlayerState p, ProgressNodeDef node)
    {
        if (IsAvailable(p, node)) return null;
        var branch = db.Divergences[node.DivergenceIndex];
        return p.Divergence >= 0
            ? $"Locked forever: your people became {db.Divergences[p.Divergence].People}."
            : $"Commit to {branch.Name} first.";
    }

    public static void OnNodeCompleted(GameState s, PlayerState p, ProgressNodeDef node, List<GameEvent> events)
    {
        if (!node.Doctrine || p.Divergence >= 0) return;
        p.Divergence = node.DivergenceIndex;
        p.DivergenceTurn = s.Turn;
        var d = s.Db.Divergences[p.Divergence];
        events.Add(new GameEvent(GameEventType.DivergenceChosen, p.Id, Def: d.Index, Detail: $"{p.Name} has become {d.People}: \"{d.Creed}\""));
    }

    // ----- Leanings (history → future) ----------------------------------------------------------------

    public static List<DivergenceLeaning> Leanings(GameState s, PlayerState p)
    {
        var db = s.Db;
        var cities = s.CitiesOf(p.Id).ToList();
        var raw = new List<(Fx Points, List<LeaningSource> Sources)>();
        foreach (var d in db.Divergences)
        {
            Fx total = Fx.Zero;
            var sources = new List<LeaningSource>();
            foreach (var l in d.Leanings)
            {
                Fx count = Count(s, p, cities, l);
                if (count == Fx.Zero) continue;
                Fx pts = count * l.Weight;
                total += pts;
                sources.Add(new LeaningSource(l.Label ?? $"{l.Kind} {l.Id}", pts));
            }
            raw.Add((total, sources));
        }
        Fx sum = raw.Aggregate(Fx.Zero, (a, r) => a + r.Points);
        var result = new List<DivergenceLeaning>();
        for (int i = 0; i < raw.Count; i++)
        {
            Fx share = sum > Fx.Zero ? raw[i].Points / sum : Fx.Ratio(1, Math.Max(1, raw.Count));
            result.Add(new DivergenceLeaning(i, raw[i].Points, share, raw[i].Sources));
        }
        return result;
    }

    private static Fx Count(GameState s, PlayerState p, List<CityState> cities, LeaningDef l)
    {
        var db = s.Db;
        var map = s.Map;
        switch (l.Kind)
        {
            case LeaningKind.Building:
                return cities.Sum(c => c.AllBuildings().Count(b => b == l.ResolvedIndex));
            case LeaningKind.District:
                return cities.Sum(c => c.Districts.Count(d => AdjacencyCalculator.DistrictMatches(db, d.DefIndex, l.ResolvedIndex)));
            case LeaningKind.DistrictTag:
                return cities.Sum(c => c.Districts.Count(d => db.Districts[d.DefIndex].HasTag(l.Id ?? "")));
            case LeaningKind.FeatureTagInBorders:
            {
                int n = 0;
                for (int t = 0; t < map.Count; t++)
                    if (map.OwnerPlayer[t] == p.Id && map.Feature[t] >= 0 && db.Features[map.Feature[t]].HasTag(l.Id ?? "")) n++;
                return n;
            }
            case LeaningKind.PowerKind:
            {
                var kind = (PowerSourceKind)l.ResolvedIndex;
                int n = cities.Sum(c => c.AllBuildings().Count(b => db.Buildings[b].Power is { } pw && pw.Kind == kind));
                for (int t = 0; t < map.Count; t++)
                    if (map.OwnerPlayer[t] == p.Id && map.Improvement[t] >= 0 && db.Improvements[map.Improvement[t]].Power is { } ip && ip.Kind == kind) n++;
                return n;
            }
            case LeaningKind.Population:
                return cities.Sum(c => c.Population);
            case LeaningKind.CumulativeEmissions:
                return p.CumulativeEmissions / 100;
        }
        return Fx.Zero;
    }

    /// <summary>Doctrine cost multiplier: up to −45% for the doctrine your history leans toward.</summary>
    public static Fx CostMultiplier(GameState s, PlayerState p, ProgressNodeDef node)
    {
        if (!node.Doctrine || p.Divergence >= 0 || node.DivergenceIndex < 0) return Fx.One;
        var share = Leanings(s, p)[node.DivergenceIndex].Share;
        return Fx.One - share * MaxDoctrineDiscountPercent / 100;
    }

    /// <summary>The AI's (and the advisor's) recommended doctrine: leaning × leader personality.</summary>
    public static int Preferred(GameState s, PlayerState p)
    {
        var leanings = Leanings(s, p);
        var leader = p.LeaderIndex >= 0 ? s.Db.Leaders[p.LeaderIndex] : null;
        int best = -1;
        Fx bestScore = Fx.MinValue;
        foreach (var l in leanings)
        {
            var d = s.Db.Divergences[l.Divergence];
            Fx weight = d.AiPersonality != null && leader != null && leader.Personality.TryGetValue(d.AiPersonality, out var w) ? w : Fx.One;
            Fx score = (l.Share + Fx.Ratio(1, 20)) * weight;
            if (score > bestScore) { bestScore = score; best = l.Divergence; }
        }
        return best;
    }

    public static int Attitude(GameDatabase db, PlayerState from, PlayerState toward)
    {
        if (from.Divergence < 0 || toward.Divergence < 0) return 0;
        var d = db.Divergences[from.Divergence];
        return from.Divergence == toward.Divergence ? d.AttitudeTowardSame : d.AttitudeTowardOthers;
    }

    // ----- The remade world --------------------------------------------------------------------------

    public static bool IsRemadeBy(MapGrid map, DivergenceDef d, int tile)
    {
        var spread = d.Spread;
        if (spread == null || spread.TargetIndex < 0) return false;
        return spread.Kind == TransformKind.Terrain ? map.Terrain[tile] == spread.TargetIndex : map.Feature[tile] == spread.TargetIndex;
    }

    /// <summary>Percent of the world's land each Divergence has remade.</summary>
    public static Fx[] WorldShare(GameState s)
    {
        var map = s.Map;
        var counts = new int[s.Db.Divergences.Count];
        int land = 0;
        for (int t = 0; t < map.Count; t++)
        {
            if (!map.IsLand(t)) continue;
            land++;
            foreach (var d in s.Db.Divergences)
                if (IsRemadeBy(map, d, t)) counts[d.Index]++;
        }
        return counts.Select(c => land == 0 ? Fx.Zero : Fx.Ratio(c * 100L, land)).ToArray();
    }

    public static void ProcessTurn(GameState s, List<GameEvent> events)
    {
        var db = s.Db;
        var map = s.Map;
        foreach (var p in s.Players)
        {
            if (p.Divergence < 0 || !p.IsAlive) continue;
            var d = db.Divergences[p.Divergence];
            var spread = d.Spread;
            if (spread == null || !p.HasTech(spread.RequiresTechIndex)) continue;
            int remade = 0;
            var ring = new List<int>();
            foreach (var city in s.CitiesOf(p.Id).ToList())
            {
                if (spread.SourceBuildingIndex >= 0 && !city.HasBuilding(spread.SourceBuildingIndex)) continue;
                if (spread.ReclaimSubmerged) Reclaim(s, d, city, events);

                ring.Clear();
                map.CollectRadius(city.Tile, spread.Radius, ring);
                var candidates = ring
                    .Where(t => (map.OwnerPlayer[t] == p.Id || map.OwnerPlayer[t] < 0) && CanRemake(s, d, t))
                    .OrderBy(t => map.Distance(city.Tile, t)).ThenBy(t => t)
                    .Take(spread.PerCityPerTurn).ToList();
                foreach (int t in candidates)
                {
                    Remake(s, d, t);
                    remade++;
                }
            }
            if (remade > 0) events.Add(new GameEvent(GameEventType.WorldRemade, p.Id, Def: d.Index, Value: remade));
        }

        // Organic spread (the Bloom grows on its own — across borders if it can).
        foreach (var d in db.Divergences)
        {
            var spread = d.Spread;
            if (spread == null || spread.OrganicChancePermille <= 0) continue;
            var adherents = s.Players.Where(p => p.Divergence == d.Index && p.IsAlive && p.HasTech(spread.RequiresTechIndex)).ToList();
            if (adherents.Count == 0) continue;
            // Growth capacity scales with the number of cities driving it (two tiles per source city per turn).
            int cap = Math.Max(2, 2 * adherents.Sum(p => s.CitiesOf(p.Id).Count(c =>
                spread.SourceBuildingIndex < 0 || c.HasBuilding(spread.SourceBuildingIndex))));
            var sources = Enumerable.Range(0, map.Count).Where(t => IsRemadeBy(map, d, t)).ToList();
            if (sources.Count == 0) continue;
            // Start at a random source each turn so the per-turn cap doesn't always favour low tile indices.
            int start = s.GameplayRng.NextInt(sources.Count);
            var dirs = new List<int>(6);
            for (int k = 0; k < sources.Count; k++)
            {
                int t = sources[(start + k) % sources.Count];
                if (cap <= 0) break;
                if (!s.GameplayRng.ChancePermille(spread.OrganicChancePermille)) continue;
                dirs.Clear();
                for (int dir = 0; dir < 6; dir++)
                {
                    int n = map.Neighbor(t, dir);
                    if (n < 0 || !CanRemake(s, d, n)) continue;
                    int owner = map.OwnerPlayer[n];
                    if (!spread.CrossesBorders && owner >= 0 && s.Players[owner].Divergence != d.Index) continue;
                    dirs.Add(n);
                }
                if (dirs.Count == 0) continue;
                int target = dirs[s.GameplayRng.NextInt(dirs.Count)];
                Remake(s, d, target);
                cap--;
                int victim = map.OwnerPlayer[target];
                if (victim >= 0 && s.Players[victim].Divergence != d.Index)
                    events.Add(new GameEvent(GameEventType.BloomEncroached, victim, map.OwnerCity[target], target, d.Index, Detail: d.Name));
            }
        }
    }

    private static bool CanRemake(GameState s, DivergenceDef d, int t)
    {
        var map = s.Map;
        if (!map.IsLand(t) || map.IsMountain(t) || map.District[t] >= 0 || IsRemadeBy(map, d, t)) return false;
        foreach (var other in s.Db.Divergences)
            if (other.Index != d.Index && IsRemadeBy(map, other, t)) return false; // remade ground is contested by war, not by growth
        int f = map.Feature[t];
        return f < 0 || s.Db.Features[f].Removable;
    }

    public static void Remake(GameState s, DivergenceDef d, int t)
    {
        var map = s.Map;
        var db = s.Db;
        var spread = d.Spread!;
        int f = map.Feature[t];
        if (spread.Kind == TransformKind.Terrain)
        {
            if (f >= 0) s.Climate.PendingDeforestation += db.Features[f].Co2OnRemoval;
            map.Feature[t] = -1;
            map.Terrain[t] = (byte)spread.TargetIndex;
            if (map.Improvement[t] >= 0 && db.Improvements[map.Improvement[t]].TransformsTerrainIndex != spread.TargetIndex) map.Improvement[t] = -1;
        }
        else
        {
            map.Feature[t] = (short)spread.TargetIndex; // the Bloom absorbs what it covers; no emission
            if (map.Improvement[t] >= 0 && db.Improvements[map.Improvement[t]].AddsFeatureIndex != spread.TargetIndex) map.Improvement[t] = -1;
        }
        map.SetFlag(t, TileFlags.Pillaged, false);
    }

    /// <summary>Sovereign sea-walls: protect the city's lowlands and rebuild one drowned tile per turn.</summary>
    private static void Reclaim(GameState s, DivergenceDef d, CityState city, List<GameEvent> events)
    {
        var map = s.Map;
        var spread = d.Spread!;
        for (int t = 0; t < map.Count; t++)
            if (map.OwnerCity[t] == city.Id && map.Lowland[t] > 0) map.SetFlag(t, TileFlags.FloodProtected, true);
        for (int t = 0; t < map.Count; t++)
        {
            if (map.OwnerCity[t] != city.Id || !map.HasFlag(t, TileFlags.Submerged) || s.Units.Any(u => u.Tile == t)) continue;
            map.SetFlag(t, TileFlags.Submerged, false);
            map.SetFlag(t, TileFlags.Flooded, false);
            map.Terrain[t] = (byte)(spread.Kind == TransformKind.Terrain ? spread.TargetIndex : s.Db.Ids.Plains);
            map.Relief[t] = (byte)s.Db.Ids.Flat;
            events.Add(new GameEvent(GameEventType.LandReclaimed, city.Owner, city.Id, t));
            return; // one tile per city per turn
        }
    }

    public static void CompleteAscension(GameState s, PlayerState p, List<GameEvent> events)
    {
        if (p.Ascended || p.Divergence < 0) return;
        p.Ascended = true;
        var d = s.Db.Divergences[p.Divergence];
        events.Add(new GameEvent(GameEventType.AscensionCompleted, p.Id, Def: d.Index, Detail: $"{p.Name} completes the {d.Name}."));
    }
}
