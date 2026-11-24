using UnbrokenAges.Sim.Core;
using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.State;

namespace UnbrokenAges.Sim.Systems;

/// <summary>
/// Era score and the ages of each civilization (docs/05-key-systems/15-society.md). Historic moments earn era score: founding
/// cities, raising districts and wonders, recruiting great people, founding a pantheon or a religion, discovering natural
/// wonders, clearing barbarian camps, taking cities. When a civilization enters a new era, the score it earned in the last one
/// decides its age: a <b>Golden Age</b> (high), a <b>Dark Age</b> (low), or — climbing straight out of darkness into glory — a
/// <b>Heroic Age</b>. Ages change loyalty pressure, amenities, culture and faith.
/// </summary>
public static class AgeSystem
{
    /// <summary>Thresholds rise with the era and with the size of the empire: a great power must do great things to shine.</summary>
    public static int DarkBelow(int eraOrder, int cities = 0) => 4 + eraOrder + cities / 2;
    public static int GoldenFrom(int eraOrder, int cities = 0) => 12 + 2 * eraOrder + cities;

    public static void Award(GameState s, PlayerState p, int points, string reason, List<GameEvent>? events)
    {
        if (p.IsFreeCities || points <= 0) return;
        p.EraScore += points;
        events?.Add(new GameEvent(GameEventType.HistoricMoment, p.Id, Value: points, Detail: reason));
    }

    /// <summary>Called as a civilization enters a new era: the score of the era just ended sets the new age.</summary>
    public static void OnEraEntered(GameState s, PlayerState p, int eraOrder, List<GameEvent> events)
    {
        if (p.IsFreeCities || eraOrder <= p.AgeEra) return;
        int previousEra = Math.Max(0, eraOrder - 1);
        var before = p.Age;
        int cities = s.CitiesOf(p.Id).Count();
        AgeState next = p.EraScore < DarkBelow(previousEra, cities) ? AgeState.Dark
                      : p.EraScore >= GoldenFrom(previousEra, cities) ? (before == AgeState.Dark ? AgeState.Heroic : AgeState.Golden)
                      : AgeState.Normal;
        p.Age = next;
        p.AgeEra = eraOrder;
        events.Add(new GameEvent(GameEventType.AgeBegan, p.Id, Value: (int)next, Detail: $"{next} Age (era score {p.EraScore})"));
        p.EraScore = 0;
    }

    private static ModifierDef Mod(ModifierEffect e, int amount, YieldType? y = null) => new() { Effect = e, Amount = Fx.FromInt(amount), Yield = y };

    private static readonly List<ModifierDef> Golden = new() { Mod(ModifierEffect.CityAmenities, 1), Mod(ModifierEffect.CityYieldPercent, 10, YieldType.Culture) };
    private static readonly List<ModifierDef> Heroic = new()
    {
        Mod(ModifierEffect.CityAmenities, 2), Mod(ModifierEffect.CityYieldPercent, 15, YieldType.Culture), Mod(ModifierEffect.CityYieldPercent, 10, YieldType.Production),
    };
    private static readonly List<ModifierDef> Dark = new() { Mod(ModifierEffect.CityAmenities, -1), Mod(ModifierEffect.CityYieldFlat, 1, YieldType.Faith) };
    private static readonly List<ModifierDef> None = new();

    public static List<ModifierDef> Modifiers(AgeState age) => age switch
    {
        AgeState.Golden => Golden,
        AgeState.Heroic => Heroic,
        AgeState.Dark => Dark,
        _ => None,
    };

    public static string Describe(AgeState age) => age switch
    {
        AgeState.Golden => "Golden Age: +1 Amenity and +10% Culture in every city; loyalty pressure +15%.",
        AgeState.Heroic => "Heroic Age: +2 Amenities, +15% Culture, +10% Production; loyalty pressure +25%.",
        AgeState.Dark => "Dark Age: −1 Amenity, +1 Faith in every city; loyalty pressure −15%.",
        _ => "Normal Age.",
    };

    /// <summary>Era score for completed work: districts (+1, wonders +4).</summary>
    public static void OnCompleted(GameState s, CityState city, ProductionKind kind, int def, List<GameEvent> events)
    {
        if (kind != ProductionKind.District) return;
        var d = s.Db.Districts[def];
        var p = s.Players[city.Owner];
        if (d.Category == DistrictCategory.Wonder) Award(s, p, 4, $"Built {d.Name}", events);
        else Award(s, p, 1, $"Raised a {d.Name}", events);
    }

    /// <summary>Natural wonders seen for the first time.</summary>
    public static void ProcessTurn(GameState s, List<GameEvent> events)
    {
        var map = s.Map;
        var wonders = new List<int>();
        for (int t = 0; t < map.Count; t++)
            if (map.Feature[t] >= 0 && s.Db.Features[map.Feature[t]].NaturalWonder) wonders.Add(t);
        if (wonders.Count == 0) return;
        foreach (var p in s.Players)
        {
            if (p.IsFreeCities || !p.IsAlive || p.Revealed.Length != map.Count) continue;
            foreach (int t in wonders)
            {
                long key = (long)p.Id * 1_000_000 + t;
                if (!p.Revealed[t] || !s.Discoveries.Add(key)) continue;
                string name = s.Db.Features[map.Feature[t]].Name;
                events.Add(new GameEvent(GameEventType.NaturalWonderDiscovered, p.Id, Tile: t, Def: map.Feature[t], Detail: name));
                Award(s, p, 2, $"Discovered {name}", events);
            }
        }
    }
}
