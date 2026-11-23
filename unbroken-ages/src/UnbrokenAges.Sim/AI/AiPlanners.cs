using UnbrokenAges.Sim.Commands;
using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.State;
using UnbrokenAges.Sim.Systems;

namespace UnbrokenAges.Sim.AI;

/// <summary>
/// AI v2 planners. Each reads the state and returns ordinary commands, the same ones a human sends, so they need no special
/// rules and stay valid in multiplayer. Iteration is in id or tile order, so a given state always yields the same plan.
/// </summary>
public static class ExpansionAi
{
    public const int SearchRadius = 9;

    public static int MaxCities(GameState s, PlayerState p) => 4 + s.PlayerEra(p);

    /// <summary>Food, production and gold of the first ring, resources, fresh water and coast.</summary>
    public static int SiteScore(GameState s, int player, int tile)
    {
        var map = s.Map;
        var ring = new List<int>();
        map.CollectRadius(tile, 1, ring);
        int score = 0;
        foreach (int t in ring)
        {
            if (map.OwnerPlayer[t] >= 0 && map.OwnerPlayer[t] != player) continue;
            var y = map.TileYields(t);
            score += (y.Food * 3 + y.Production * 2 + y.Gold).FloorToInt();
            if (map.Resource[t] >= 0) score += 4;
        }
        if (map.HasFreshWaterAccess(tile)) score += 4;
        if (map.IsAdjacentToSea(tile)) score += 2;
        return score;
    }

    public static bool CanSettle(GameState s, int player, int tile)
    {
        var map = s.Map;
        if (!map.IsLand(tile) || map.IsMountain(tile)) return false;
        if (map.OwnerPlayer[tile] >= 0 && map.OwnerPlayer[tile] != player) return false;
        return !s.Cities.Any(c => map.Distance(c.Tile, tile) < FoundCityCommand.MinCityDistance);
    }

    /// <summary>Best site near <paramref name="from"/> (score − 2 per tile of travel), away from sites other settlers claimed; -1 if none.</summary>
    public static int BestSite(GameState s, int player, int from, IReadOnlyCollection<int> claimed)
    {
        var map = s.Map;
        var tiles = new List<int>();
        map.CollectRadius(from, SearchRadius, tiles);
        tiles.Sort();
        int best = -1, bestScore = int.MinValue;
        foreach (int t in tiles)
        {
            if (!CanSettle(s, player, t) || claimed.Any(c => map.Distance(c, t) < FoundCityCommand.MinCityDistance)) continue;
            int score = SiteScore(s, player, t) - 2 * map.Distance(from, t);
            if (score > bestScore) { bestScore = score; best = t; }
        }
        return best;
    }

    /// <summary>One settler at a time, up to the city cap, and only while a site exists.</summary>
    public static bool WantsSettler(GameState s, PlayerState p)
    {
        var db = s.Db;
        int cities = s.Cities.Count(c => c.Owner == p.Id);
        if (cities == 0) return false;
        bool settlerOut = s.Units.Any(u => u.Owner == p.Id && db.Units[u.DefIndex].FoundsCity)
                          || s.CitiesOf(p.Id).Any(c => c.Queue.Items.Any(i => i.Kind == ProductionKind.Unit && db.Units[i.DefIndex].FoundsCity));
        if (settlerOut || cities >= MaxCities(s, p)) return false;
        return s.CitiesOf(p.Id).Any(c => BestSite(s, p.Id, c.Tile, Array.Empty<int>()) >= 0);
    }

    /// <summary>The first city is founded where the settler stands; later settlers walk to the best site and found there.</summary>
    public static IEnumerable<GameCommand> Settlers(GameState s, PlayerState p)
    {
        var claimed = new List<int>();
        foreach (var u in s.Units.Where(u => u.Owner == p.Id && s.Db.Units[u.DefIndex].FoundsCity).ToList())
        {
            var found = new FoundCityCommand { Player = p.Id, UnitId = u.Id };
            bool legalHere = found.Validate(s) == null;
            if (!s.Cities.Any(c => c.Owner == p.Id))
            {
                if (legalHere) yield return found;
                continue;
            }
            int site = BestSite(s, p.Id, u.Tile, claimed);
            if (site < 0)
            {
                if (legalHere) yield return found;
                continue;
            }
            claimed.Add(site);
            if (legalHere && (site == u.Tile || SiteScore(s, p.Id, u.Tile) >= SiteScore(s, p.Id, site) - 2)) yield return found;
            else if (u.Destination != site) yield return new MoveUnitCommand { Player = p.Id, UnitId = u.Id, Destination = site };
        }
    }
}

public static class BuilderAi
{
    public const int SearchRadius = 10;

    /// <summary>The most valuable improvement on a worked-city tile near <paramref name="from"/>: resources first, then yields.</summary>
    public static (int Tile, int Improvement)? BestJob(GameState s, PlayerState p, int from, IReadOnlyCollection<int> taken)
    {
        var map = s.Map;
        var db = s.Db;
        (int, int)? best = null;
        int bestScore = int.MinValue;
        var tiles = new List<int>();
        map.CollectRadius(from, SearchRadius, tiles);
        tiles.Sort();
        foreach (int t in tiles)
        {
            if (map.OwnerPlayer[t] != p.Id || map.OwnerCity[t] < 0 || map.Improvement[t] >= 0 || map.District[t] >= 0 || taken.Contains(t)) continue;
            foreach (var imp in db.Improvements)
            {
                if (imp.Power != null || ImprovementRules.Validate(s, p, imp, t) != null) continue;
                var y = imp.Yields;
                int value = (y.Food * 3 + y.Production * 3 + y.Gold * 2 + (y.Science + y.Culture + y.Faith) * 2).FloorToInt();
                if (value <= 0) continue;
                if (map.Resource[t] >= 0 && imp.ValidResourceIndices.Contains(map.Resource[t])) value += 6;
                int score = value * 2 - map.Distance(from, t);
                if (score > bestScore) { bestScore = score; best = (t, imp.Index); }
            }
        }
        return best;
    }

    public static bool WantsBuilder(GameState s, PlayerState p)
    {
        var db = s.Db;
        if (s.Units.Any(u => u.Owner == p.Id && db.Units[u.DefIndex].Charges > 0)) return false;
        if (s.CitiesOf(p.Id).Any(c => c.Queue.Items.Any(i => i.Kind == ProductionKind.Unit && db.Units[i.DefIndex].Charges > 0))) return false;
        return s.CitiesOf(p.Id).Any(c => BestJob(s, p, c.Tile, Array.Empty<int>()) != null);
    }

    public static IEnumerable<GameCommand> Builders(GameState s, PlayerState p)
    {
        var taken = new List<int>();
        foreach (var u in s.Units.Where(u => u.Owner == p.Id && s.Db.Units[u.DefIndex].Charges > 0).ToList())
        {
            if (BestJob(s, p, u.Tile, taken) is not (var tile, var improvement)) continue;
            taken.Add(tile);
            if (u.Tile == tile) yield return new BuildImprovementCommand { Player = p.Id, UnitId = u.Id, Improvement = improvement };
            else if (u.Destination != tile) yield return new MoveUnitCommand { Player = p.Id, UnitId = u.Id, Destination = tile };
        }
    }
}

public static class MilitaryAi
{
    public const int OddsToAttack = 60;
    public const int FirstWarTurn = 30;
    public const int NeighbourRange = 14;

    /// <summary>Health-weighted strength of a civilization's military.</summary>
    public static int Strength(GameState s, int player) =>
        s.Units.Where(u => u.Owner == player && SupplySystem.IsMilitary(s.Db, u)).Sum(u => UnitStats.Strength(s, u) * u.Hp / 100);

    /// <summary>
    /// The attacker's share of the exchange, in percent: expected damage dealt as a fraction of the defender's health, against
    /// expected damage taken as a fraction of ours. Ranged attacks and civilian captures cost nothing, so they score 100.
    /// </summary>
    public static int OddsPercent(CombatPreview p)
    {
        if (!p.Legal) return 0;
        if (p.CapturesCivilian || (p.CertainKill && !p.PossibleDeath)) return 100;
        long dealt = (p.DefenderDamageMin + p.DefenderDamageMax) / 2, taken = (p.AttackerDamageMin + p.AttackerDamageMax) / 2;
        if (taken == 0) return dealt > 0 ? 100 : 0;
        long ours = dealt * Math.Max(1, p.AttackerHp), theirs = taken * Math.Max(1, p.DefenderHp);
        return (int)(100 * ours / (ours + theirs));
    }

    public static IEnumerable<int> Neighbours(GameState s, int player)
    {
        var mine = s.CitiesOf(player).ToList();
        return s.Players.Where(o => o.IsAlive && !o.IsFreeCities && o.Id != player &&
                                    s.CitiesOf(o.Id).Any(c => mine.Any(m => s.Map.Distance(m.Tile, c.Tile) <= NeighbourRange)))
                        .Select(o => o.Id);
    }

    public static List<int> MajorEnemies(GameState s, int player) =>
        s.Players.Where(o => o.IsAlive && !o.IsFreeCities && o.Id != player && DiplomacySystem.AtWar(s, player, o.Id)).Select(o => o.Id).ToList();

    /// <summary>One war at a time, from turn 30, on a neighbour our army outweighs 3 : 2 (and with at least three units).</summary>
    public static GameCommand? WarDeclaration(GameState s, PlayerState p)
    {
        if (s.Turn < FirstWarTurn || MajorEnemies(s, p.Id).Count > 0) return null;
        if (s.Units.Count(u => u.Owner == p.Id && SupplySystem.IsMilitary(s.Db, u)) < 3) return null;
        int mine = Strength(s, p.Id);
        foreach (int target in Neighbours(s, p.Id).OrderBy(t => Strength(s, t)).ThenBy(t => t))
            if (mine * 2 >= Strength(s, target) * 3 && DiplomacySystem.ValidateDeclareWar(s, p.Id, target) == null)
                return new DeclareWarCommand { Player = p.Id, Target = target };
        return null;
    }

    /// <summary>
    /// Each military unit: take the best attack with odds above 60%; if wounded (under 40 HP, or under 70 HP and out of supply),
    /// fall back to the nearest own city unless the attack is a certain kill; otherwise march on the nearest enemy city.
    /// </summary>
    public static IEnumerable<GameCommand> Fight(GameState s, PlayerState p)
    {
        var db = s.Db;
        var map = s.Map;
        var enemies = MajorEnemies(s, p.Id);
        // Tiles holding something we are at war with (units of any hostile owner, including Free Cities, and enemy cities).
        var hostile = new HashSet<int>();
        foreach (var o in s.Units) if (o.Owner != p.Id && DiplomacySystem.AtWar(s, p.Id, o.Owner)) hostile.Add(o.Tile);
        foreach (var c in s.Cities) if (c.Owner != p.Id && DiplomacySystem.AtWar(s, p.Id, c.Owner)) hostile.Add(c.Tile);
        if (hostile.Count == 0) yield break;
        int[]? supply = null;
        foreach (var u in s.Units.Where(u => u.Owner == p.Id && SupplySystem.IsMilitary(db, u)).ToList())
        {
            if (u.MovesLeft <= Core.Fx.Zero || u.AttackedThisTurn) continue;
            var (target, odds, preview) = BestAttack(s, u, hostile);
            bool wounded = u.Hp < 40;
            if (!wounded && u.Hp < 70)
            {
                supply ??= SupplySystem.Compute(s, p.Id);   // only the lightly wounded need the supply map
                wounded = supply[u.Tile] < 0;
            }
            if (target >= 0 && odds > OddsToAttack && (!wounded || preview!.CertainKill))
            {
                yield return new AttackCommand { Player = p.Id, UnitId = u.Id, TargetTile = target };
                continue;
            }
            if (enemies.Count == 0) continue;
            if (wounded)
            {
                var home = s.CitiesOf(p.Id).OrderBy(c => map.Distance(c.Tile, u.Tile)).ThenBy(c => c.Id).FirstOrDefault();
                if (home != null && u.Tile != home.Tile && u.Destination != home.Tile)
                    yield return new MoveUnitCommand { Player = p.Id, UnitId = u.Id, Destination = home.Tile };
                continue;
            }
            var objective = s.Cities.Where(c => enemies.Contains(c.Owner)).OrderBy(c => map.Distance(c.Tile, u.Tile)).ThenBy(c => c.Id).FirstOrDefault();
            if (objective == null || map.Distance(objective.Tile, u.Tile) <= (UnitStats.IsRanged(s, u) ? UnitStats.Range(s, u) : 1)) continue;
            int staging = StagingTile(s, u, objective.Tile);
            if (staging >= 0 && u.Destination != staging) yield return new MoveUnitCommand { Player = p.Id, UnitId = u.Id, Destination = staging };
        }
    }

    private static (int Tile, int Odds, CombatPreview? Preview) BestAttack(GameState s, UnitState u, HashSet<int> hostile)
    {
        var map = s.Map;
        int reach = UnitStats.IsRanged(s, u) ? UnitStats.Range(s, u) : 1;
        var tiles = new List<int>();
        map.CollectRadius(u.Tile, reach, tiles);
        tiles.Sort();
        (int, int, CombatPreview?) best = (-1, 0, null);
        foreach (int t in tiles)
        {
            if (t == u.Tile || !hostile.Contains(t)) continue;
            var preview = CombatSystem.Preview(s, u, t);
            int odds = OddsPercent(preview);
            if (odds > best.Item2) best = (t, odds, preview);
        }
        return best;
    }

    /// <summary>A free tile next to the objective, the closest one to the unit.</summary>
    private static int StagingTile(GameState s, UnitState u, int objective)
    {
        var map = s.Map;
        int best = -1, bestDistance = int.MaxValue;
        for (int d = 0; d < 6; d++)
        {
            int n = map.Neighbor(objective, d);
            if (n < 0 || !map.IsLand(n) || map.IsMountain(n) || s.Units.Any(o => o.Tile == n && o.Id != u.Id)) continue;
            int distance = map.Distance(u.Tile, n);
            if (distance < bestDistance) { bestDistance = distance; best = n; }
        }
        return best;
    }

    /// <summary>
    /// Peace: accept an offer unless clearly winning (twice the enemy's strength, war under 30 turns); propose peace when weaker
    /// than the enemy, or after 30 turns of war.
    /// </summary>
    public static IEnumerable<GameCommand> Diplomacy(GameState s, PlayerState p)
    {
        foreach (var rel in s.Relations)
        {
            if (rel.A != p.Id && rel.B != p.Id) continue;
            int other = rel.A == p.Id ? rel.B : rel.A;
            int mine = Strength(s, p.Id), theirs = Strength(s, other), warTurns = s.Turn - rel.Since;
            bool winning = mine > 0 && mine >= theirs * 2 && warTurns < 30;
            if (rel.PeaceProposedBy == other)
            {
                if (!winning) yield return new AcceptPeaceCommand { Player = p.Id, Target = other };
            }
            else if (rel.Status == DiploStatus.War && rel.PeaceProposedBy < 0 && (mine < theirs || warTurns >= 30)
                     && DiplomacySystem.ValidateProposePeace(s, p.Id, other) == null)
                yield return new ProposePeaceCommand { Player = p.Id, Target = other };
        }
    }

    /// <summary>The strongest land unit the city can build now.</summary>
    public static UnitDef? BestLandUnit(GameState s, CityState city) =>
        s.Db.Units.Where(u => u.Domain == UnitDomain.Land && u.Strength > 0 && ProductionSystem.CanEnqueue(s, city, ProductionKind.Unit, u.Index, -1) == null)
                  .OrderByDescending(u => Math.Max(u.Strength, u.RangedStrength)).ThenBy(u => u.Index).FirstOrDefault();
}
