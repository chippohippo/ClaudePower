using UnbrokenAges.Sim.Commands;
using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.State;
using UnbrokenAges.Sim.Systems;
using UnbrokenAges.Sim.Systems.Districts;

namespace UnbrokenAges.Sim.AI;

/// <summary>
/// The AI's use of society: it changes government and re-slots cards on free turns, founds a pantheon and a religion as soon
/// as it can, sends missionaries to the nearest unconverted cities, promotes veterans, and raises world wonders in its best city.
/// </summary>
public static class SocietyAi
{
    private static readonly string[] GovernmentPreference =
    {
        "GOVERNMENT_TECHNOCRACY", "GOVERNMENT_DEMOCRACY", "GOVERNMENT_COMMUNISM", "GOVERNMENT_MONARCHY", "GOVERNMENT_MERCHANT_REPUBLIC",
        "GOVERNMENT_CLASSICAL_REPUBLIC", "GOVERNMENT_THEOCRACY", "GOVERNMENT_OLIGARCHY", "GOVERNMENT_AUTOCRACY", "GOVERNMENT_CHIEFDOM",
    };

    public static IEnumerable<GameCommand> Commands(GameState s, PlayerState p)
    {
        var db = s.Db;
        bool atWar = MilitaryAi.MajorEnemies(s, p.Id).Count > 0;

        // Government and cards, on free turns only (never paying to re-slot).
        if (p.PolicySwapFree)
        {
            int government = PickGovernment(s, p, atWar);
            if (government >= 0 && government != p.Government) yield return new SetGovernmentCommand { Player = p.Id, Government = government };
            int target = government >= 0 ? government : p.Government;
            var cards = PickPolicies(s, p, target, atWar);
            if (target >= 0 && !cards.OrderBy(x => x).SequenceEqual(p.Policies.OrderBy(x => x)))
                yield return new SetPoliciesCommand { Player = p.Id, Policies = cards };
        }

        if (p.Pantheon < 0 && p.Faith >= Core.Fx.FromInt(ReligionSystem.PantheonCost) &&
            ReligionSystem.FreeBeliefs(s, BeliefKind.Pantheon).FirstOrDefault() is { } pantheon)
            yield return new FoundPantheonCommand { Player = p.Id, Belief = pantheon.Index };

        if (ReligionSystem.ProphetWaiting(p) && ReligionSystem.FreeReligions(s).FirstOrDefault() is { } religion &&
            ReligionSystem.FreeBeliefs(s, BeliefKind.Founder).FirstOrDefault() is { } founder &&
            ReligionSystem.FreeBeliefs(s, BeliefKind.Follower).FirstOrDefault() is { } follower)
            yield return new FoundReligionCommand { Player = p.Id, Religion = religion.Index, FounderBelief = founder.Index, FollowerBelief = follower.Index };

        foreach (var cmd in Missionaries(s, p)) yield return cmd;

        // Envoys: one at a time, where it wins or keeps a suzerainty soonest; otherwise where it pays the next tier.
        if (p.EnvoyTokens > 0 && BestEnvoyTarget(s, p) is { } envoyTarget)
            yield return new SendEnvoyCommand { Player = p.Id, CityState = envoyTarget.Id };

        foreach (var u in s.Units.Where(u => u.Owner == p.Id).ToList())
            if (SocietySystem.CanPromote(s, u) && SocietySystem.Available(s, u).OrderByDescending(Score).ThenBy(x => x.Index).FirstOrDefault() is { } promo)
                yield return new PromoteUnitCommand { Player = p.Id, UnitId = u.Id, Promotion = promo.Index };
    }

    public static PlayerState? BestEnvoyTarget(GameState s, PlayerState p)
    {
        PlayerState? best = null;
        double bestScore = double.MinValue;
        foreach (var cs in CityStateSystem.CityStates(s))
        {
            if (CityStateSystem.CanSendEnvoy(s, p, cs.Id) != null) continue;
            int mine = CityStateSystem.EnvoysFrom(cs, p.Id);
            int rival = Enumerable.Range(0, cs.Envoys.Count).Where(o => o != p.Id).Select(o => cs.Envoys[o]).DefaultIfEmpty(0).Max();
            double score = 0;
            if (cs.Suzerain == p.Id) score += mine - rival <= 1 ? 6 : 0.5;                       // defend a narrow lead
            else if (mine + 1 >= CityStateSystem.SuzerainMinimum && mine + 1 > rival) score += 8; // this envoy wins it
            else if (rival - mine <= 2) score += 3;                                              // within reach
            if (mine + 1 is CityStateSystem.FirstTier or CityStateSystem.SecondTier or CityStateSystem.ThirdTier) score += 2;
            var capital = CityStateSystem.Capital(s, cs);
            int near = capital == null ? 99 : s.CitiesOf(p.Id).Select(c => s.Map.Distance(c.Tile, capital.Tile)).DefaultIfEmpty(99).Min();
            score -= near / 20.0;
            if (score > bestScore || (score == bestScore && best != null && cs.Id < best.Id)) { best = cs; bestScore = score; }
        }
        return best;
    }

    private static int Score(PromotionDef p) => 2 * p.Strength + p.Defense + p.VsCity + p.Terrain / 2 + 8 * p.Moves + p.HealPerTurn / 2;

    private static int PickGovernment(GameState s, PlayerState p, bool atWar)
    {
        var db = s.Db;
        int fascism = db.Governments.IndexOf("GOVERNMENT_FASCISM");
        if (atWar && fascism >= 0 && SocietySystem.Unlocked(p, db.Governments[fascism])) return fascism;
        foreach (string id in GovernmentPreference)
        {
            int g = db.Governments.IndexOf(id);
            if (g < 0 || !SocietySystem.Unlocked(p, db.Governments[g])) continue;
            if (id == "GOVERNMENT_THEOCRACY" && p.Religion < 0) continue;
            return g;
        }
        return p.Government;
    }

    /// <summary>What a card would do for this empire now: each modifier valued in every city that meets its requirements.</summary>
    public static double CardScore(GameState s, PlayerState p, PolicyDef c, bool atWar)
    {
        var db = s.Db;
        var cities = s.CitiesOf(p.Id).ToList();
        int soldiers = s.Units.Count(u => u.Owner == p.Id && SupplySystem.IsMilitary(db, u));
        double score = 0;
        foreach (var m in c.Modifiers)
        {
            double amount = m.Amount.ToDouble();
            if (m.Effect == ModifierEffect.UnitStrength)
            {
                int matching = s.Units.Count(u => u.Owner == p.Id && SupplySystem.IsMilitary(db, u) &&
                                                  (string.IsNullOrEmpty(m.Target) || db.Units[u.DefIndex].UnitClass == m.Target));
                score += amount * matching * (atWar ? 0.6 : 0.1);
                continue;
            }
            foreach (var city in cities)
            {
                if (!CityEffects.RequirementsMet(s, city, m.Requirements)) continue;
                double size = 1 + city.Population / 4.0;
                score += m.Effect switch
                {
                    ModifierEffect.CityYieldFlat => amount,
                    ModifierEffect.CityYieldPercent => amount / 10 * size,
                    ModifierEffect.CityAmenities => amount * 1.5,
                    ModifierEffect.CityHousing => amount * (city.Population >= 5 ? 1.0 : 0.3),
                    ModifierEffect.CityLoyaltyPerTurn => amount * (city.Loyalty < Core.Fx.FromInt(80) ? 1.5 : 0.2),
                    ModifierEffect.CityProductionPercent => amount / 20 * size * (m.Category == ProductionCategory.Unit ? (atWar ? 1.2 : 0.1) : 1.0),
                    ModifierEffect.CityPurchaseDiscountPercent => amount / 25,
                    _ => 0.2,
                };
            }
        }
        return score + c.Index * 0.001;
    }

    /// <summary>Best cards for the government: each slot kind filled with its best, then wildcards with the best of the rest.</summary>
    public static List<int> PickPolicies(GameState s, PlayerState p, int government, bool atWar)
    {
        var result = new List<int>();
        if (government < 0) return result;
        var g = s.Db.Governments[government];
        var unlocked = s.Db.Policies.Where(c => SocietySystem.Unlocked(p, c)).Select(c => (Card: c, Score: CardScore(s, p, c, atWar)))
                                    .Where(x => x.Score > 0.05).OrderByDescending(x => x.Score).ThenBy(x => x.Card.Index).Select(x => x.Card).ToList();
        foreach (var slot in new[] { PolicySlot.Military, PolicySlot.Economic, PolicySlot.Diplomatic })
            result.AddRange(unlocked.Where(c => c.Slot == slot).Take(g.Slots(slot)).Select(c => c.Index));
        int wild = g.Wildcard + SocietySystem.ExtraWildcard(s, p);
        result.AddRange(unlocked.Where(c => !result.Contains(c.Index)).Take(wild).Select(c => c.Index));
        while (result.Count > 0 && !SocietySystem.Fits(s, government, result, SocietySystem.ExtraWildcard(s, p))) result.RemoveAt(result.Count - 1);
        return result;
    }

    private static IEnumerable<GameCommand> Missionaries(GameState s, PlayerState p)
    {
        if (p.Religion < 0) yield break;
        var map = s.Map;
        foreach (var u in s.Units.Where(u => u.Owner == p.Id && ReligionSystem.IsMissionary(s.Db.Units[u.DefIndex])).ToList())
        {
            if (ReligionSystem.CanSpread(s, u) == null) { yield return new SpreadReligionCommand { Player = p.Id, UnitId = u.Id }; continue; }
            var target = MissionTarget(s, p, u.Tile);
            if (target == null) continue;
            int best = -1, bestDist = int.MaxValue;
            for (int d = 0; d < 6; d++)
            {
                int n = map.Neighbor(target.Tile, d);
                if (n < 0 || !map.IsLand(n) || s.Units.Any(x => x.Tile == n)) continue;
                int dist = map.Distance(u.Tile, n);
                if (dist < bestDist) { best = n; bestDist = dist; }
            }
            if (best < 0) continue;
            var move = new MoveUnitCommand { Player = p.Id, UnitId = u.Id, Destination = best };
            if (move.Validate(s) == null) yield return move;
        }
    }

    /// <summary>The nearest city not yet following our faith: our own first, then anyone's within reach.</summary>
    public static CityState? MissionTarget(GameState s, PlayerState p, int from) =>
        s.Cities.Where(c => c.Religion != p.Religion && s.Map.Distance(c.Tile, from) <= 16)
                .OrderBy(c => c.Owner == p.Id ? 0 : 1).ThenBy(c => s.Map.Distance(c.Tile, from)).ThenBy(c => c.Id).FirstOrDefault();

    /// <summary>A missionary for a religious civilization with work to do and none on the road.</summary>
    public static UnitDef? WantsMissionary(GameState s, PlayerState p, CityState city)
    {
        if (p.Religion < 0 || s.Units.Any(u => u.Owner == p.Id && ReligionSystem.IsMissionary(s.Db.Units[u.DefIndex]))) return null;
        if (s.CitiesOf(p.Id).SelectMany(c => c.Queue.Items).Any(q => q.Kind == ProductionKind.Unit && ReligionSystem.IsMissionary(s.Db.Units[q.DefIndex]))) return null;
        if (MissionTarget(s, p, city.Tile) == null) return null;
        return s.Db.Units.FirstOrDefault(u => ReligionSystem.IsMissionary(u) && ProductionSystem.CanEnqueue(s, city, ProductionKind.Unit, u.Index, -1) == null);
    }

    /// <summary>A wonder for the empire's most productive city, one at a time, once it has some districts.</summary>
    public static (int Def, int Tile)? WantsWonder(GameState s, PlayerState p, CityState city)
    {
        var cities = s.CitiesOf(p.Id).ToList();
        var best = cities.OrderByDescending(c => c.YieldsLastTurnProduction).ThenBy(c => c.Id).FirstOrDefault();
        if (best == null || best.Id != city.Id || city.Districts.Count < 3) return null;
        if (s.CitiesOf(p.Id).SelectMany(c => c.Queue.Items).Any(q => q.Kind == ProductionKind.District && s.Db.Districts[q.DefIndex].Category == DistrictCategory.Wonder)) return null;
        foreach (var w in s.Db.Districts.Where(d => d.Category == DistrictCategory.Wonder).OrderBy(d => d.Cost).ThenBy(d => d.Index))
            if (DistrictPlanner.Rank(s, city, w.Index, DistrictPlanner.BalancedWeights, 1).FirstOrDefault() is { } spot) return (w.Index, spot.Tile);
        return null;
    }
}
