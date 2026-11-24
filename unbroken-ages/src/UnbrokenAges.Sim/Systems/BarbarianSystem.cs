using UnbrokenAges.Sim.Core;
using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.Map;
using UnbrokenAges.Sim.State;

namespace UnbrokenAges.Sim.Systems;

/// <summary>
/// Barbarian camps (docs/05-key-systems/15-society.md). From turn 15, camps rise in the unclaimed wilds, far from cities, and
/// send out raiders under the Free Cities' banner: they hunt units in reach, capture civilians, and pillage improvements —
/// but never take cities. A military unit that steps onto a camp scatters it for gold and era score. Placement and raider
/// moves are pure functions of the state (hashed by turn and tile), so every peer agrees without touching shared RNG.
/// </summary>
public static class BarbarianSystem
{
    public const int FirstTurn = 15;
    public const int SpawnEvery = 10;
    public const int RaiderEvery = 8;
    public const int ClearGold = 50;
    public const int Sight = 6;

    public static int MaxCamps(GameState s) => Math.Max(1, s.Players.Count(p => p.IsAlive && p.IsMajor) / 2);

    public static bool IsCamp(GameState s, int tile) => s.Camps.Any(c => c.Tile == tile);

    public static void ProcessTurn(GameState s, List<GameEvent> events)
    {
        var free = s.FreeCitiesPlayer;
        if (free == null) return;
        ClearCamps(s, events);
        if (s.Turn >= FirstTurn && s.Turn % SpawnEvery == 0 && s.Camps.Count < MaxCamps(s) && PickCampTile(s) is int campTile and >= 0)
        {
            s.Camps.Add((campTile, 2));
            events.Add(new GameEvent(GameEventType.CampSpawned, free.Id, Tile: campTile));
        }
        for (int i = 0; i < s.Camps.Count; i++)
        {
            var (tile, timer) = s.Camps[i];
            timer--;
            if (timer <= 0)
            {
                int near = s.Units.Count(u => u.Owner == free.Id && s.Map.Distance(u.Tile, tile) <= 5);
                if (near < 2 && RaiderDef(s) is int def and >= 0 && FreeTileNear(s, tile) is int at and >= 0)
                {
                    var d = s.Db.Units[def];
                    s.AddUnit(new UnitState { Id = s.AllocateId(), Owner = free.Id, DefIndex = def, Tile = at, MovesLeft = Fx.FromInt(d.Moves),
                                              Variant = UnitStats.DefaultVariant(s.Db, def) });
                }
                timer = RaiderEvery;
            }
            s.Camps[i] = (tile, timer);
        }
        foreach (var raider in s.Units.Where(u => u.Owner == free.Id && SupplySystem.IsMilitary(s.Db, u) && !s.Cities.Any(c => c.Tile == u.Tile)).ToList())
            if (s.GetUnit(raider.Id) != null) Act(s, raider, events);
    }

    private static void ClearCamps(GameState s, List<GameEvent> events)
    {
        for (int i = s.Camps.Count - 1; i >= 0; i--)
        {
            int tile = s.Camps[i].Tile;
            var hero = s.Units.Where(u => u.Tile == tile && s.Players[u.Owner].IsMajor && SupplySystem.IsMilitary(s.Db, u)).OrderBy(u => u.Id).FirstOrDefault();
            if (hero == null) continue;
            s.Camps.RemoveAt(i);
            var p = s.Players[hero.Owner];
            p.Gold += Fx.FromInt(ClearGold);
            events.Add(new GameEvent(GameEventType.CampCleared, p.Id, Tile: tile, Value: ClearGold));
            AgeSystem.Award(s, p, 1, "Scattered a barbarian camp", events);
        }
    }

    private static int Hash(GameState s, int a, int b) =>
        (int)(StableHash.Combine(StableHash.Combine((ulong)s.Turn, (ulong)a), (ulong)b) % int.MaxValue);

    /// <summary>Unclaimed, passable land at least six tiles from every city and four from any major's unit.</summary>
    public static int? PickCampTile(GameState s)
    {
        var map = s.Map;
        var candidates = new List<int>();
        for (int t = 0; t < map.Count; t++)
        {
            if (!map.IsLand(t) || map.IsMountain(t) || map.IsChannel(t) || map.OwnerPlayer[t] >= 0) continue;
            if (map.Feature[t] >= 0 && (s.Db.Features[map.Feature[t]].Impassable || s.Db.Features[map.Feature[t]].NaturalWonder)) continue;
            if (map.HasFlag(t, TileFlags.Submerged) || s.Db.Reliefs[map.Relief[t]].Impassable) continue;
            if (s.Cities.Any(c => map.Distance(c.Tile, t) < 6) || s.Outposts.Any(o => map.Distance(o.Tile, t) < 4)) continue;
            if (s.Units.Any(u => map.Distance(u.Tile, t) < 4) || s.Camps.Any(c => map.Distance(c.Tile, t) < 8)) continue;
            candidates.Add(t);
        }
        return candidates.Count == 0 ? null : candidates[Hash(s, candidates.Count, s.Camps.Count) % candidates.Count];
    }

    private static int? FreeTileNear(GameState s, int tile)
    {
        if (!s.Units.Any(u => u.Tile == tile)) return tile;
        for (int d = 0; d < 6; d++)
        {
            int n = s.Map.Neighbor(tile, d);
            if (n >= 0 && s.Map.IsLand(n) && !s.Map.IsMountain(n) && !s.Units.Any(u => u.Tile == n) && !s.Cities.Any(c => c.Tile == n)) return n;
        }
        return null;
    }

    /// <summary>The strongest generic land melee unit that most civilizations can already field.</summary>
    public static int? RaiderDef(GameState s)
    {
        var majors = s.Players.Where(p => p.IsAlive && p.IsMajor).ToList();
        return s.Db.Units.Where(u => u.Domain == UnitDomain.Land && u.UnitClass == "Melee" && u.CivilizationIndex < 0 && u.Strength > 0 &&
                                     u.ResourceCost == null && majors.Count(p => p.HasTech(u.PrereqTechIndex)) * 2 >= majors.Count)
                         .OrderByDescending(u => u.Strength).ThenBy(u => u.Index).Select(u => (int?)u.Index).FirstOrDefault();
    }

    private static bool Prey(GameState s, UnitState raider, UnitState u) =>
        u.Owner != raider.Owner && !s.Players[u.Owner].IsFreeCities && !s.Cities.Any(c => c.Tile == u.Tile);

    private static void Act(GameState s, UnitState raider, List<GameEvent> events)
    {
        var map = s.Map;
        // 1. Strike anything adjacent we can beat (or capture).
        foreach (var victim in s.Units.Where(u => Prey(s, raider, u) && map.Distance(u.Tile, raider.Tile) == 1).OrderBy(u => u.Id).ToList())
        {
            var preview = CombatSystem.Preview(s, raider, victim.Tile);
            if (!preview.Legal || CombatSystem.OddsPercent(preview) < 45) continue;
            CombatSystem.Resolve(s, raider, victim.Tile, events);
            return;
        }
        // 2. Pillage the improvement underfoot.
        if (TryPillage(s, raider, events)) return;
        // 3. Close on prey within sight; else on the nearest improvement to burn.
        int target = s.Units.Where(u => Prey(s, raider, u) && map.Distance(u.Tile, raider.Tile) <= Sight)
                            .OrderBy(u => map.Distance(u.Tile, raider.Tile)).ThenBy(u => u.Id).Select(u => u.Tile).DefaultIfEmpty(-1).First();
        if (target < 0)
        {
            var tiles = new List<int>();
            map.CollectRadius(raider.Tile, Sight, tiles);
            target = tiles.Where(t => Pillageable(s, t)).OrderBy(t => map.Distance(t, raider.Tile)).ThenBy(t => t).DefaultIfEmpty(-1).First();
        }
        if (target < 0) return;
        Step(s, raider, target);
        if (raider.MovesLeft > Fx.Zero) TryPillage(s, raider, events);
    }

    private static bool Pillageable(GameState s, int t) =>
        s.Map.OwnerPlayer[t] >= 0 && !s.Players[s.Map.OwnerPlayer[t]].IsFreeCities && s.Map.Improvement[t] >= 0 &&
        !s.Map.HasFlag(t, TileFlags.Pillaged) && !s.Cities.Any(c => c.Tile == t);

    private static bool TryPillage(GameState s, UnitState raider, List<GameEvent> events)
    {
        if (!Pillageable(s, raider.Tile)) return false;
        s.Map.SetFlag(raider.Tile, TileFlags.Pillaged, true);
        raider.MovesLeft = Fx.Zero;
        events.Add(new GameEvent(GameEventType.TilePillaged, s.Map.OwnerPlayer[raider.Tile], Tile: raider.Tile, Def: s.Map.Improvement[raider.Tile]));
        return true;
    }

    /// <summary>Greedy steps toward the target while moves last (stopping beside occupied tiles).</summary>
    private static void Step(GameState s, UnitState raider, int target)
    {
        var map = s.Map;
        for (int guard = 0; guard < 4 && raider.MovesLeft > Fx.Zero; guard++)
        {
            int best = -1, bestDist = map.Distance(raider.Tile, target);
            for (int d = 0; d < 6; d++)
            {
                int n = map.Neighbor(raider.Tile, d);
                if (n < 0 || s.Units.Any(u => u.Tile == n) || s.Cities.Any(c => c.Tile == n)) continue;
                if (Movement.EnterCost(s, raider, raider.Tile, n) == Movement.Impassable) continue;
                int dist = map.Distance(n, target);
                if (dist < bestDist) { best = n; bestDist = dist; }
            }
            if (best < 0) return;
            raider.MovesLeft -= Fx.FromInt(Math.Max(1, Movement.EnterCost(s, raider, raider.Tile, best)));
            raider.Tile = best;
            if (bestDist <= 1) return;
        }
    }
}
