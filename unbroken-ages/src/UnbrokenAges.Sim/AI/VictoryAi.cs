using UnbrokenAges.Sim.Commands;
using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.State;
using UnbrokenAges.Sim.Systems;
using UnbrokenAges.Sim.Systems.Districts;

namespace UnbrokenAges.Sim.AI;

/// <summary>The road to victory an AI civilization is on; it shapes what it builds and how it spends faith and favor.</summary>
public enum VictoryFocus { Ascension, Culture, Spiritual, Concord, Exodus }

/// <summary>
/// Victory focus (docs/05-key-systems/22-earth.md, "Victory variety"). Until the middle game every civilization simply grows. From
/// turn 150 (scaled by game speed) each one measures how far along each road it is (peoples dominated by its culture, peoples converted
/// to its faith, its diplomatic victory points, its Exodus stage) and takes the road it is furthest along, if it is far enough along
/// to be worth leaving the default road, the Divergence and Ascension. The focus is recomputed every turn from the state (nothing is
/// stored), so a civilization that falls back returns to the default road on its own.
/// </summary>
public static class VictoryAi
{
    public const int FocusFromTurn = 150;
    private const double CultureAt = 0.5, SpiritualAt = 0.4, ConcordAt = 0.15, ExodusAt = 0.25;

    // Asked for every city every turn: computed once per player per turn (one cache per thread, as the AI may plan off the UI thread).
    [ThreadStatic] private static GameState? cachedState;
    [ThreadStatic] private static int cachedTurn;
    [ThreadStatic] private static Dictionary<int, VictoryFocus>? cache;

    public static VictoryFocus Focus(GameState s, PlayerState p)
    {
        if (s.Turn < FocusFromTurn * s.Options.GameSpeedPercent / 100 || !p.IsMajor) return VictoryFocus.Ascension;
        cache ??= new();
        if (!ReferenceEquals(cachedState, s) || cachedTurn != s.Turn) { cache.Clear(); cachedState = s; cachedTurn = s.Turn; }
        if (cache.TryGetValue(p.Id, out var known)) return known;
        return cache[p.Id] = Compute(s, p);
    }

    private static VictoryFocus Compute(GameState s, PlayerState p)
    {
        var best = VictoryFocus.Ascension;
        double bestScore = 0;
        void Consider(VictoryFocus focus, double progress, double threshold)
        {
            if (progress >= threshold && progress - threshold > bestScore) { best = focus; bestScore = progress - threshold; }
        }
        if (VictorySystem.Enabled(s, VictoryKind.Culture) && CultureSystem.Tourism(s, p) > 0 && CultureSystem.Reach(s, p) is var (dominated, others) && others >= 2)
            Consider(VictoryFocus.Culture, (double)dominated / others, CultureAt);
        if (VictorySystem.Enabled(s, VictoryKind.Spiritual) && p.Religion >= 0 && ReligionSystem.Reach(s, p) is var (converted, total) && total >= 2)
            Consider(VictoryFocus.Spiritual, (double)converted / total, SpiritualAt);
        if (VictorySystem.Enabled(s, VictoryKind.Concord))
            Consider(VictoryFocus.Concord, (double)p.DiplomaticPoints / CongressSystem.VictoryPoints, ConcordAt);
        // The space race: the world's foremost scientist takes it up once it can build a Spaceport (others only once launched).
        if (VictorySystem.Enabled(s, VictoryKind.Exodus) && s.Db.Districts.IndexOf("DISTRICT_SPACEPORT") is var port and >= 0 &&
            p.HasTech(s.Db.Districts[port].PrereqTechIndex))
            Consider(VictoryFocus.Exodus, (double)p.ExodusStage / SpaceSystem.FinalStage + (TopScientist(s) == p.Id ? 0.3 : 0) +
                                          (NationAi.Personality(s, p, "science") - 1) / 2, ExodusAt);
        return best;
    }

    /// <summary>The living great power with the most technologies (ties to the lower id).</summary>
    public static int TopScientist(GameState s) =>
        s.Players.Where(o => o.IsMajor && o.IsAlive).OrderByDescending(o => o.Techs.Count(t => t)).ThenBy(o => o.Id).Select(o => o.Id).FirstOrDefault(-1);

    // ----- Culture -------------------------------------------------------------------------------------

    /// <summary>A culture-focused city raises a Cultural Quarter, then fills it with great-work slots (Amphitheater, Museum).</summary>
    public static (ProductionKind Kind, int Def, int Tile)? CultureProduction(GameState s, PlayerState p, CityState city)
    {
        var db = s.Db;
        int quarter = db.Districts.IndexOf("DISTRICT_CULTURAL_QUARTER");
        if (quarter < 0) return null;
        bool hasQuarter = city.Districts.Any(d => d.DefIndex == quarter);
        if (!hasQuarter)
        {
            if (city.Queue.Items.Any(q => q.Kind == ProductionKind.District && q.DefIndex == quarter)) return null;
            return DistrictPlanner.Rank(s, city, quarter, DistrictPlanner.BalancedWeights, 1).FirstOrDefault() is { } spot &&
                   ProductionSystem.Validate(s, city, ProductionKind.District, quarter, spot.Tile) == null
                ? (ProductionKind.District, quarter, spot.Tile) : null;
        }
        var slots = db.Buildings.Where(b => b.GreatWorkSlots > 0 && ProductionSystem.CanEnqueue(s, city, ProductionKind.Building, b.Index, -1) == null)
                                .OrderBy(b => b.Cost).ThenBy(b => b.Index).FirstOrDefault();
        return slots != null ? (ProductionKind.Building, slots.Index, -1) : null;
    }

    // ----- Spiritual -----------------------------------------------------------------------------------

    /// <summary>
    /// Where a missionary should go. A civilization on the spiritual road looks across the world for the people closest to tipping
    /// (fewest cities to convert for a majority) and goes to its nearest unconverted city; otherwise the nearest city not yet following
    /// the faith within 16 tiles, our own first.
    /// </summary>
    public static CityState? MissionTarget(GameState s, PlayerState p, int from)
    {
        if (Focus(s, p) != VictoryFocus.Spiritual) return SocietyAi.MissionTarget(s, p, from);
        CityState? best = null;
        (int Need, int Dist) bestKey = (int.MaxValue, int.MaxValue);
        foreach (var other in s.Players)
        {
            if (other.Id == p.Id || !other.IsMajor || !other.IsAlive) continue;
            var cities = s.CitiesOf(other.Id).ToList();
            if (cities.Count == 0) continue;
            int following = cities.Count(c => c.Religion == p.Religion);
            if (following * 2 > cities.Count) continue;              // already converted
            int need = cities.Count / 2 + 1 - following;
            foreach (var c in cities.Where(c => c.Religion != p.Religion))
            {
                var key = (need, s.Map.Distance(c.Tile, from));
                if (key.CompareTo(bestKey) < 0 || (key == bestKey && best != null && c.Id < best.Id)) { best = c; bestKey = key; }
            }
        }
        // Our own cities come first if a rival faith has taken any of them.
        return SocietyAi.MissionTarget(s, p, from) is { Owner: var owner } home && owner == p.Id ? home : best;
    }

    /// <summary>Missionaries a religious civilization keeps in the field: four on the spiritual road, one otherwise.</summary>
    public static int MissionaryCap(GameState s, PlayerState p) => Focus(s, p) == VictoryFocus.Spiritual ? 4 : 1;

    /// <summary>Spend faith on a missionary where one is wanted and none can be had sooner from the production queue.</summary>
    public static GameCommand? FaithPurchase(GameState s, PlayerState p)
    {
        if (p.Religion < 0) return null;
        var db = s.Db;
        int out_ = s.Units.Count(u => u.Owner == p.Id && ReligionSystem.IsMissionary(db.Units[u.DefIndex]));
        if (out_ >= MissionaryCap(s, p)) return null;
        var unit = db.Units.FirstOrDefault(ReligionSystem.IsMissionary);
        if (unit == null) return null;
        var cities = s.CitiesOf(p.Id).ToList();
        if (cities.Count == 0) return null;
        var holy = ReligionSystem.HolyCity(s, p) ?? cities[0];
        if (MissionTarget(s, p, holy.Tile) is not { } target) return null;
        var from = cities.Where(c => ReligionSystem.ValidateFaithPurchase(s, c, unit.Index) == null)
                         .OrderBy(c => s.Map.Distance(c.Tile, target.Tile)).ThenBy(c => c.Id).FirstOrDefault();
        return from == null ? null : new FaithPurchaseCommand { Player = p.Id, CityId = from.Id, DefIndex = unit.Index };
    }
}
