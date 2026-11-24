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
        if (NationSystem.ForbidFound(s, player, tile) != null) return false;
        // Venice's Waymakers plant trading outposts, which need unclaimed land away from other outposts.
        if (NationSystem.Is(s, player, SignatureKind.Ledger) && s.Cities.Any(c => c.Owner == player)
            && (map.OwnerPlayer[tile] >= 0 || s.Outposts.Any(o => map.Distance(o.Tile, tile) < s.Db.Rules.Outposts.MinDistance)))
            return false;
        return !s.Cities.Any(c => map.Distance(c.Tile, tile) < FoundCityCommand.MinCityDistance);
    }

    /// <summary>Best site near <paramref name="from"/> (score − 2 per tile of travel), away from sites other settlers claimed; -1 if none.</summary>
    /// <remarks>
    /// Only sites a settler could actually reach count (by land, or by sea once Sailing / Celestial Navigation allow): an
    /// island people no longer marches its settlers to the shore and waits forever. When nothing is left nearby, a people that
    /// can cross the ocean looks for new lands much further away (one point per tile of travel).
    /// </remarks>
    public static int BestSite(GameState s, int player, int from, IReadOnlyCollection<int> claimed, UnitState? walker = null)
    {
        var map = s.Map;
        foreach (var (radius, perTile) in new[] { (SearchRadius, 2), (OverseasRadius, 1) })
        {
            if (radius == OverseasRadius && !CanCrossOcean(s, player)) break;
            var tiles = new List<int>();
            map.CollectRadius(from, radius, tiles);
            var ranked = new List<(int Tile, int Score)>();
            foreach (int t in tiles)
            {
                if (!CanSettle(s, player, t) || claimed.Any(c => map.Distance(c, t) < FoundCityCommand.MinCityDistance)) continue;
                ranked.Add((t, SiteScore(s, player, t) - perTile * map.Distance(from, t)));
            }
            var mover = walker ?? Phantom(s, player, from);
            foreach (var (t, _) in ranked.OrderByDescending(r => r.Score).ThenBy(r => r.Tile).Take(3))
                if (mover == null || t == mover.Tile || Movement.FindPath(s, mover, t, 4000) != null) return t;
        }
        return -1;
    }

    public const int OverseasRadius = 26;

    private static bool CanCrossOcean(GameState s, PlayerState p) => p.HasTech(s.Db.Techs.IndexOf(s.Db.Rules.Combat.OceanEmbarkTech));
    private static bool CanCrossOcean(GameState s, int player) => CanCrossOcean(s, s.Players[player]);

    /// <summary>A stand-in settler at <paramref name="from"/> for asking whether a site can be reached (never added to the game).</summary>
    private static UnitState? Phantom(GameState s, int player, int from)
    {
        var def = s.Db.Units.FirstOrDefault(u => u.FoundsCity);
        return def == null ? null : new UnitState { Id = -1, Owner = player, DefIndex = def.Index, Tile = from, MovesLeft = Core.Fx.FromInt(def.Moves) };
    }

    /// <summary>One settler at a time, up to the city cap, and only while a site exists.</summary>
    public static bool WantsSettler(GameState s, PlayerState p)
    {
        var db = s.Db;
        int cities = s.Cities.Count(c => c.Owner == p.Id);
        if (cities == 0) return false;
        bool settlerOut = s.Units.Any(u => u.Owner == p.Id && NationSystem.IsColonist(s, p, db.Units[u.DefIndex]))
                          || s.CitiesOf(p.Id).Any(c => c.Queue.Items.Any(i => i.Kind == ProductionKind.Unit && NationSystem.IsColonist(s, p, db.Units[i.DefIndex])));
        if (settlerOut || cities >= MaxCities(s, p)) return false;
        return s.CitiesOf(p.Id).Any(c => BestSite(s, p.Id, c.Tile, Array.Empty<int>()) >= 0);
    }

    /// <summary>The first city is founded where the settler stands; later settlers walk to the best site and found there.</summary>
    public static IEnumerable<GameCommand> Settlers(GameState s, PlayerState p)
    {
        var claimed = new List<int>();
        foreach (var u in s.Units.Where(u => u.Owner == p.Id && NationSystem.IsColonist(s, p, s.Db.Units[u.DefIndex])).ToList())
        {
            // Venice's Waymakers walk to a city site like settlers, then plant a trading outpost to buy up later.
            GameCommand found = s.Db.Units[u.DefIndex].FoundsCity ? new FoundCityCommand { Player = p.Id, UnitId = u.Id } : new FoundOutpostCommand { Player = p.Id, UnitId = u.Id };
            bool legalHere = found.Validate(s) == null;
            if (!s.Cities.Any(c => c.Owner == p.Id))
            {
                if (legalHere) yield return found;
                continue;
            }
            int site = BestSite(s, p.Id, u.Tile, claimed, u);
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
    /// <summary>No AI starts a war before this turn, however warlike: young civilizations get a chance to found a second city.</summary>
    public const int EarliestWarTurn = 35;
    public const int NeighbourRange = 14;

    /// <summary>Health-weighted strength of a civilization's military.</summary>
    public static int Strength(GameState s, int player) =>
        s.Units.Where(u => u.Owner == player && SupplySystem.IsMilitary(s.Db, u)).Sum(u => UnitStats.Strength(s, u) * u.Hp / 100);

    /// <summary>Shared with the combat preview, so the AI and the player read the same odds.</summary>
    public static int OddsPercent(CombatPreview p) => CombatSystem.OddsPercent(p);

    public static IEnumerable<int> Neighbours(GameState s, int player)
    {
        var mine = s.CitiesOf(player).ToList();
        return s.Players.Where(o => o.IsAlive && o.IsMajor && o.Id != player &&
                                    s.CitiesOf(o.Id).Any(c => mine.Any(m => s.Map.Distance(m.Tile, c.Tile) <= NeighbourRange)))
                        .Select(o => o.Id);
    }

    public static List<int> MajorEnemies(GameState s, int player) =>
        s.Players.Where(o => o.IsAlive && o.IsMajor && o.Id != player && DiplomacySystem.AtWar(s, player, o.Id)).Select(o => o.Id).ToList();

    /// <summary>One war at a time, from turn 30, on a neighbour our army outweighs 3 : 2 (and with at least three units).</summary>
    /// The leader's "war" personality scales it: a Khan (1.8) attacks from turn 17 at near parity, a scholar-emperor (0.4)
    /// only with an overwhelming army.
    public static GameCommand? WarDeclaration(GameState s, PlayerState p)
    {
        double war = NationAi.Personality(s, p, "war");
        if (NationSystem.Kind(s, p) == SignatureKind.Horde) war *= 1.25;   // the steppe must ride to learn
        int firstTurn = Math.Max(EarliestWarTurn, (int)(FirstWarTurn / Math.Max(0.5, war)));
        if (s.Turn < firstTurn || MajorEnemies(s, p.Id).Count > 0) return null;
        if (SocietySystem.EffectiveWeariness(s, p) >= 2 * SocietySystem.WearinessPerAmenity) return null;   // the people are tired of war
        if (s.Units.Count(u => u.Owner == p.Id && SupplySystem.IsMilitary(s.Db, u)) < 3) return null;
        if (CombatSystem.LastStand(s, p.Id)) return null;   // a remnant rebuilds, it does not start wars
        int mine = Strength(s, p.Id);
        // No dogpiles: leave a rival that is making its last stand, or already fighting another great power, alone.
        foreach (int target in Neighbours(s, p.Id).Where(t => !CombatSystem.LastStand(s, t) && MajorEnemies(s, t).Count == 0)
                                                 .OrderBy(t => Strength(s, t)).ThenBy(t => t))
            if (mine * 2 * war >= Strength(s, target) * 3 && DiplomacySystem.ValidateDeclareWar(s, p.Id, target) == null)
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
        foreach (var c in s.Cities)
        {
            if (c.Owner == p.Id || !DiplomacySystem.AtWar(s, p.Id, c.Owner)) continue;
            if (Spared(s, c)) hostile.Remove(c.Tile);   // its garrison too: striking the last city's defenders would take the city
            else hostile.Add(c.Tile);
        }
        if (hostile.Count == 0) yield break;
        int[]? supply = null;
        foreach (var u in s.Units.Where(u => u.Owner == p.Id && SupplySystem.IsMilitary(db, u)).ToList())
        {
            if (u.MovesLeft <= Core.Fx.Zero || u.AttackedThisTurn) continue;
            var (target, odds, preview) = BestAttack(s, u, hostile);
            if (AirSystem.IsAircraft(db, u))
            {
                // Aircraft strike what is in range, and otherwise rebase to the base nearest the front within one flight.
                if (target >= 0 && odds > OddsToAttack && u.Hp >= 40) { yield return new AttackCommand { Player = p.Id, UnitId = u.Id, TargetTile = target }; continue; }
                var front = s.Cities.Where(c => enemies.Contains(c.Owner)).OrderBy(c => map.Distance(c.Tile, u.Tile)).ThenBy(c => c.Id).FirstOrDefault();
                if (front == null) continue;
                int here = map.Distance(u.Tile, front.Tile);
                var rebase = s.CitiesOf(p.Id).Select(c => c.Tile).Where(t => t != u.Tile && AirSystem.ValidateRebase(s, u, t) == null)
                              .OrderBy(t => map.Distance(t, front.Tile)).ThenBy(t => t).DefaultIfEmpty(-1).First();
                if (rebase >= 0 && map.Distance(rebase, front.Tile) < here) yield return new MoveUnitCommand { Player = p.Id, UnitId = u.Id, Destination = rebase };
                continue;
            }
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
            bool weary = SocietySystem.EffectiveWeariness(s, p) >= 3 * SocietySystem.WearinessPerAmenity;
            bool winning = mine > 0 && mine >= theirs * 2 && warTurns < 30 && !weary;
            // Sated: a rival down to its last city in the opening, or to a last stand after a long war, is left in peace.
            bool sated = !s.Players[other].IsFreeCities &&
                         (s.Cities.Count(c => c.Owner == other) <= 1 && s.Turn < SparedUntilTurn || CombatSystem.LastStand(s, other) && warTurns >= 15);
            if (rel.PeaceProposedBy == other)
            {
                if (!winning || sated) yield return new AcceptPeaceCommand { Player = p.Id, Target = other };
            }
            else if (rel.Status == DiploStatus.War && rel.PeaceProposedBy < 0 && (mine < theirs || warTurns >= 30 || sated || weary)
                     && DiplomacySystem.ValidateProposePeace(s, p.Id, other) == null)
                yield return new ProposePeaceCommand { Player = p.Id, Target = other };
        }
    }

    /// <summary>Until this turn the AI leaves a rival its last city and makes peace instead: no nation is erased in the opening.</summary>
    public const int SparedUntilTurn = 150;

    private static bool Spared(GameState s, CityState city) =>
        s.Turn < SparedUntilTurn && !s.Players[city.Owner].IsFreeCities && s.Cities.Count(c => c.Owner == city.Owner) <= 1;

    /// <summary>The strongest line unit the city can build now (siege engines and anti-cavalry are chosen separately).</summary>
    public static UnitDef? BestLandUnit(GameState s, CityState city) =>
        s.Db.Units.Where(u => u.Domain == UnitDomain.Land && u.Strength > 0 && !u.HasTag("Siege") && u.UnitClass != "AntiCavalry" &&
                              ProductionSystem.CanEnqueue(s, city, ProductionKind.Unit, u.Index, -1) == null)
                  .OrderByDescending(u => Math.Max(u.Strength, u.RangedStrength * 9 / 10)).ThenBy(u => u.Index).FirstOrDefault();

    /// <summary>The best aircraft the city can build now (fighters and bombers by turns), if any.</summary>
    public static UnitDef? BestAirUnit(GameState s, CityState city, bool fighter) =>
        s.Db.Units.Where(u => u.Domain == UnitDomain.Air && u.HasTag("Interceptor") == fighter && ProductionSystem.CanEnqueue(s, city, ProductionKind.Unit, u.Index, -1) == null)
                  .OrderByDescending(u => u.RangedStrength).ThenBy(u => u.Index).FirstOrDefault();

    /// <summary>The best siege engine the city can build now, if any: armies at war bring one for every few line units.</summary>
    public static UnitDef? BestSiegeUnit(GameState s, CityState city) =>
        s.Db.Units.Where(u => u.Domain == UnitDomain.Land && u.HasTag("Siege") && ProductionSystem.CanEnqueue(s, city, ProductionKind.Unit, u.Index, -1) == null)
                  .OrderByDescending(u => u.RangedStrength).ThenBy(u => u.Index).FirstOrDefault();
}

/// <summary>
/// Plays each nation's signature: Venice buys the cities it can afford, Mali buys what its cities are building, and every
/// leader's personality weights (data) colour its choices.
/// </summary>
public static class NationAi
{
    public static double Personality(GameState s, PlayerState p, string key) =>
        p.LeaderIndex >= 0 && s.Db.Leaders[p.LeaderIndex].Personality.TryGetValue(key, out var v) ? v.ToDouble() : 1.0;

    public static IEnumerable<GameCommand> Commands(GameState s, PlayerState p)
    {
        switch (NationSystem.Kind(s, p))
        {
            case SignatureKind.Ledger:
            {
                // Buy trading outposts up into cities (half price), then cities on the market.
                var outpost = s.Outposts.Where(o => o.Owner == p.Id && OutpostSystem.ValidatePromote(s, o) == null && p.Gold >= OutpostSystem.PromoteCost(s, o) + 30)
                                        .OrderBy(o => o.Id).FirstOrDefault();
                if (outpost != null) { yield return new PromoteOutpostCommand { Player = p.Id, OutpostId = outpost.Id }; break; }
                // The cheapest city on the market that we can pay for, keeping a small reserve.
                var buy = s.Cities.Where(c => NationSystem.CanBuy(s, p, c) == null && p.Gold >= NationSystem.CityPrice(s, p, c) + 40)
                                  .OrderBy(c => NationSystem.CityPrice(s, p, c)).ThenBy(c => c.Id).FirstOrDefault();
                if (buy != null) yield return new BuyCityCommand { Player = p.Id, CityId = buy.Id };
                break;
            }
            case SignatureKind.GoldenRoad:
            case SignatureKind.Mercenaries:
            {
                bool unitsOnly = NationSystem.Kind(s, p) == SignatureKind.Mercenaries;   // Carthage hires its armies
                // Buy one city's current unit or building outright each turn while the treasury stays healthy.
                foreach (var city in s.CitiesOf(p.Id).OrderBy(c => c.Id))
                {
                    var item = city.Queue.Items.FirstOrDefault();
                    if (item == null || item.Kind is not (ProductionKind.Unit or ProductionKind.Building)) continue;
                    if (unitsOnly && item.Kind != ProductionKind.Unit) continue;
                    var cmd = new PurchaseCommand { Player = p.Id, CityId = city.Id, Kind = item.Kind, DefIndex = item.DefIndex };
                    if (cmd.Validate(s) == null && p.Gold >= ProductionSystem.PurchaseCost(s, city, item.Kind, item.DefIndex) + 80)
                    {
                        yield return cmd;
                        yield break;
                    }
                }
                break;
            }
        }
    }
}
