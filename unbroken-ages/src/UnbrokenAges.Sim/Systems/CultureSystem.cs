using UnbrokenAges.Sim.Core;
using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.State;

namespace UnbrokenAges.Sim.Systems;

/// <summary>
/// Great works, tourism and the Culture victory (docs/05-key-systems/19-culture.md).
/// <list type="bullet">
/// <item><b>Great works</b>: each Great Artist creates their named works (two each); each Great Prophet leaves a relic. Works hang in
/// slots — one in the capital's palace, two in an Amphitheater, three in a Museum, one in a Temple — filled automatically,
/// largest cities first; works with no free slot wait in storage. A work on display gives its city +2 Culture.</item>
/// <item><b>Tourism</b>: 2 per displayed work, 3 per world wonder, 2 per natural wonder in your territory; +35% per era from the
/// Industrial on, +15% in a Golden or Heroic Age.</item>
/// <item><b>Tourists</b>: every turn your tourism flows toward each other civilization, +25% each where a trade route of yours runs to
/// them, where they grant you open borders, and where their capital follows your religion. Every 150 tourism there is one visiting
/// tourist. Their <b>domestic tourists</b> are their lifetime culture / 100.</item>
/// <item><b>Culture victory</b>: your visiting tourists outnumber the domestic tourists of every other living civilization (at least two).</item>
/// </list>
/// </summary>
public static class CultureSystem
{
    public const int CulturePerWork = 2, TourismPerWork = 2, TourismPerWonder = 3, TourismPerNaturalWonder = 2, TourismPerVisitor = 150, CulturePerDomestic = 100;
    /// <summary>Tourism grows by this much per era from the Industrial on, to keep pace with late-era culture.</summary>
    public const int TourismPerEraPercent = 35;

    public static int Slots(GameState s, CityState city) =>
        (city.IsCapital ? 1 : 0) + city.AllBuildings().Sum(b => s.Db.Buildings[b].GreatWorkSlots);

    public static IEnumerable<GreatWorkState> WorksIn(GameState s, CityState city) => s.GreatWorks.Where(g => g.CityId == city.Id);

    /// <summary>A great person's works: an artist's named works (or one untitled masterpiece), a prophet's relic.</summary>
    public static void OnRecruited(GameState s, PlayerState p, GreatPersonDef person, List<GameEvent> events)
    {
        IEnumerable<(string Name, byte Kind)> works = person.Class switch
        {
            GreatPersonClass.Artist => (person.Works.Count > 0 ? person.Works : new List<string> { $"Masterwork of {person.Name}" }).Select(n => (n, (byte)0)),
            GreatPersonClass.Prophet => new[] { ($"Relic of {person.Name}", (byte)1) },
            _ => Array.Empty<(string, byte)>(),
        };
        foreach (var (name, kind) in works)
        {
            s.GreatWorks.Add(new GreatWorkState { Id = s.AllocateId(), Name = name, Kind = kind, Creator = p.Id, Owner = p.Id });
            events.Add(new GameEvent(GameEventType.GreatWorkCreated, p.Id, Def: person.Index, Detail: name));
        }
        Place(s, p.Id);
    }

    /// <summary>Hangs the player's stored works in free slots (largest cities first); a captured city's works change hands with it.</summary>
    public static void Place(GameState s, int player)
    {
        foreach (var g in s.GreatWorks)
            if (g.CityId >= 0 && s.GetCity(g.CityId) is { } c) g.Owner = c.Owner;
            else if (g.CityId >= 0) g.CityId = -1;   // the city is gone: the work survives in its owner's storage
        var stored = s.GreatWorks.Where(g => g.CityId < 0 && g.Owner == player).OrderBy(g => g.Id).ToList();
        if (stored.Count == 0) return;
        foreach (var city in s.CitiesOf(player).OrderByDescending(c => c.Population).ThenBy(c => c.Id))
        {
            int free = Slots(s, city) - WorksIn(s, city).Count();
            while (free-- > 0 && stored.Count > 0)
            {
                stored[0].CityId = city.Id;
                stored.RemoveAt(0);
            }
            if (stored.Count == 0) return;
        }
    }

    private static readonly Dictionary<int, List<ModifierDef>> Cache = new();

    public static IEnumerable<(List<ModifierDef> Modifiers, string Source)> CityModifierSources(GameState s, CityState city)
    {
        int n = WorksIn(s, city).Count();
        if (n == 0) yield break;
        List<ModifierDef> mods;
        lock (Cache)
            if (!Cache.TryGetValue(n, out mods!))
                Cache[n] = mods = new List<ModifierDef> { new() { Effect = ModifierEffect.CityYieldFlat, Yield = YieldType.Culture, Amount = Fx.FromInt(CulturePerWork * n) } };
        yield return (mods, $"Great works ({n})");
    }

    // ----- Tourism -------------------------------------------------------------------------------------

    public static int Tourism(GameState s, PlayerState p)
    {
        if (!p.IsMajor) return 0;
        int works = s.GreatWorks.Count(g => g.CityId >= 0 && g.Owner == p.Id);
        int wonders = SocietySystem.Wonders(s, p.Id).Count();
        int natural = 0;
        for (int t = 0; t < s.Map.Count; t++)
            if (s.Map.OwnerPlayer[t] == p.Id && s.Map.Feature[t] >= 0 && s.Db.Features[s.Map.Feature[t]].NaturalWonder) natural++;
        int raw = works * TourismPerWork + wonders * TourismPerWonder + natural * TourismPerNaturalWonder;
        int percent = 100 + TourismPerEraPercent * Math.Max(0, s.PlayerEra(p) - 3) + (p.Age is AgeState.Golden or AgeState.Heroic ? 15 : 0);
        return raw * percent / 100;
    }

    /// <summary>The bonus percent on tourism from one civilization toward another: trade, open borders, shared faith.</summary>
    public static int Affinity(GameState s, int from, int to)
    {
        int bonus = 0;
        if (s.TradeRoutes.Any(r => r.Owner == from && s.GetCity(r.Destination)?.Owner == to)) bonus += 25;
        if (DiplomacySystem.Find(s, from, to) is { } rel && (rel.A == to ? rel.AGrantsB : rel.BGrantsA)) bonus += 25;
        int religion = s.Players[from].Religion;
        if (religion >= 0 && s.GetCity(s.Players[to].CapitalCityId) is { } capital && capital.Religion == religion) bonus += 25;
        return bonus;
    }

    public static int Domestic(PlayerState p) => p.LifetimeCulture.FloorToInt() / CulturePerDomestic;

    public static int Visitors(PlayerState from, int to) => to < from.TourismTo.Count ? from.TourismTo[to] / TourismPerVisitor : 0;

    public static void ProcessTurn(GameState s, List<GameEvent> events)
    {
        var majors = s.Players.Where(p => p.IsMajor && p.IsAlive).ToList();
        foreach (var p in majors)
        {
            Place(s, p.Id);
            while (p.TourismTo.Count < s.Players.Count) p.TourismTo.Add(0);
            int tourism = Tourism(s, p);
            if (tourism == 0) continue;
            foreach (var o in majors)
            {
                if (o.Id == p.Id) continue;
                int before = Visitors(p, o.Id);
                p.TourismTo[o.Id] += tourism * (100 + Affinity(s, p.Id, o.Id)) / 100;
                if (before <= Domestic(o) && Visitors(p, o.Id) > Domestic(o) && Domestic(o) > 0)
                    events.Add(new GameEvent(GameEventType.CulturalDominance, p.Id, Value: o.Id, Detail: o.Name));
            }
        }
    }

    /// <summary>Other living civilizations with cities that this one dominates culturally, out of all of them.</summary>
    public static (int Dominated, int Total) Reach(GameState s, PlayerState p)
    {
        int dominated = 0, total = 0;
        foreach (var o in s.Players)
        {
            if (o.Id == p.Id || !o.IsMajor || !o.IsAlive || !s.CitiesOf(o.Id).Any()) continue;
            total++;
            if (Visitors(p, o.Id) > Domestic(o)) dominated++;
        }
        return (dominated, total);
    }

    public static int CultureWinner(GameState s)
    {
        foreach (var p in s.Players.Where(p => p.IsMajor && p.IsAlive).OrderBy(p => p.Id))
        {
            var (dominated, total) = Reach(s, p);
            if (total >= 2 && dominated == total) return p.Id;
        }
        return -1;
    }
}
