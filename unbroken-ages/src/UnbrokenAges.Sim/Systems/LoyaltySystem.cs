using UnbrokenAges.Sim.Core;
using UnbrokenAges.Sim.State;

namespace UnbrokenAges.Sim.Systems;

public sealed class LoyaltyBreakdown
{
    public Fx DomesticPressure;
    public Fx ForeignPressure;
    public Fx PressureTerm;
    public Fx Governor;
    public Fx Amenities;
    public Fx Garrison;
    public Fx Occupation;
    public Fx Capital;
    public Fx Starvation;
    public Fx SettlingIn;
    public Fx Modifiers;
    public Fx Total;
    public int TopForeignPlayer = -1;
    public Fx TopForeignPressure;
    public List<(int Player, Fx Pressure)> ForeignByPlayer = new();
    /// <summary>Turns until loyalty reaches 0 at the current rate; -1 when not declining.</summary>
    public int TurnsUntilFlip = -1;

    /// <summary>Non-zero lines for the loyalty tooltip, in display order.</summary>
    public IEnumerable<(string Label, Fx Value)> Lines()
    {
        var all = new (string, Fx)[]
        {
            ("Citizen pressure (domestic vs foreign)", PressureTerm), ("Governor established", Governor),
            ("Amenities", Amenities), ("Garrison", Garrison), ("Occupation", Occupation), ("Capital", Capital),
            ("Starvation", Starvation), ("Settling in", SettlingIn), ("Policies, abilities & buildings", Modifiers),
        };
        return all.Where(l => l.Item2 != Fx.Zero);
    }
}

/// <summary>
/// Loyalty: each city's citizens push loyalty onto every city within 9 tiles, decaying 10% per
/// tile. Domestic pressure (your cities, including itself) is compared with foreign pressure;
/// the difference is normalised so dense cores are stable while contested frontiers swing.
///
///   pressure(src→dst) = pop(src) × (10 − dist)/10 × age multiplier × (1 + pressure%)  [capital ×1.25, free city ×0.5]
///   pressureTerm      = clamp(10 × (D − F) / (min(D, F) + 1), −20, +20)
///   Δloyalty          = pressureTerm + governor(+8) + amenities(−5..+2) + garrison(+2)
///                       + occupation(−4) + capital(+8) + starvation(−5) + settling-in(+10 → 0) + modifiers
///
/// At 0 a city declares independence (Free City). A Free City at 0 joins the civ exerting the
/// most pressure. All pressure is computed from a snapshot so city processing order never matters.
/// </summary>
public static class LoyaltySystem
{
    public const int Radius = 9;
    public static readonly Fx MaxLoyalty = 100;
    public const int SettlingInTurns = 5;

    public readonly record struct CitySnapshot(int Id, int Owner, int Tile, int Population, bool IsCapital, AgeState Age, Fx PressurePercent, bool FreeCity);

    public static List<CitySnapshot> Snapshot(GameState s)
    {
        var list = new List<CitySnapshot>(s.Cities.Count);
        foreach (var c in s.Cities)
        {
            var owner = s.Players[c.Owner];
            var fx = CityEffects.Compute(s, c);
            list.Add(new CitySnapshot(c.Id, c.Owner, c.Tile, c.Population, c.IsCapital, owner.Age, fx.PressurePercent, owner.IsFreeCities));
        }
        return list;
    }

    public static Fx AgeMultiplier(AgeState age) => age switch
    {
        AgeState.Golden => Fx.Ratio(115, 100),
        AgeState.Heroic => Fx.Ratio(125, 100),
        AgeState.Dark => Fx.Ratio(85, 100),
        _ => Fx.One,
    };

    public static Fx PressureFrom(GameState s, CitySnapshot src, int targetTile)
    {
        int d = s.Map.Distance(src.Tile, targetTile);
        if (d > Radius) return Fx.Zero;
        // Work in tenths and divide once at the end to keep the fixed-point result exact.
        Fx p = Fx.FromInt(src.Population * (10 - d));
        p *= AgeMultiplier(src.Age);
        p += p * src.PressurePercent / 100;
        if (src.IsCapital) p += p / 4;
        if (src.FreeCity) p /= 2;
        return p / 10;
    }

    public static LoyaltyBreakdown Compute(GameState s, CityState city, IReadOnlyList<CitySnapshot> snapshot)
    {
        var b = new LoyaltyBreakdown();
        var foreign = new SortedDictionary<int, Fx>();
        foreach (var src in snapshot)
        {
            Fx p = PressureFrom(s, src, city.Tile);
            if (p == Fx.Zero) continue;
            if (src.Owner == city.Owner) b.DomesticPressure += p;
            else
            {
                foreign.TryGetValue(src.Owner, out Fx f);
                foreign[src.Owner] = f + p;
                b.ForeignPressure += p;
            }
        }
        foreach (var (player, p) in foreign)
        {
            b.ForeignByPlayer.Add((player, p));
            if (!s.Players[player].IsFreeCities && p > b.TopForeignPressure)
            {
                b.TopForeignPressure = p;
                b.TopForeignPlayer = player;
            }
        }

        Fx diff = b.DomesticPressure - b.ForeignPressure;
        b.PressureTerm = Fx.Clamp(10 * diff / (Fx.Min(b.DomesticPressure, b.ForeignPressure) + 1), -20, 20);

        var owner = s.Players[city.Owner];
        var fx = CityEffects.Compute(s, city);
        var report = CityYields.Compute(s, city, fx);
        var gov = city.GovernorDef >= 0 ? owner.GetGovernor(city.GovernorDef) : null;
        if (gov is { Established: true }) b.Governor = 8;
        b.Amenities = report.AmenityStatus switch
        {
            AmenityStatus.Ecstatic => 2,
            AmenityStatus.Happy => 1,
            AmenityStatus.Displeased => -1,
            AmenityStatus.Unrest => -3,
            AmenityStatus.Revolt => -5,
            _ => 0,
        };
        bool garrisoned = s.Units.Any(u => u.Tile == city.Tile && u.Owner == city.Owner && s.Db.Units[u.DefIndex].Strength > 0);
        if (garrisoned) b.Garrison = 2;
        else if (city.Owner != city.OriginalOwner && !owner.IsFreeCities) b.Occupation = -4;
        if (city.IsCapital) b.Capital = 8;
        if (report.FoodSurplus < Fx.Zero) b.Starvation = -5;
        if (city.TurnsSinceOwnerChange < SettlingInTurns) b.SettlingIn = 2 * (SettlingInTurns - city.TurnsSinceOwnerChange);
        b.Modifiers = fx.LoyaltyPerTurn;

        b.Total = b.PressureTerm + b.Governor + b.Amenities + b.Garrison + b.Occupation + b.Capital + b.Starvation + b.SettlingIn + b.Modifiers;
        if (b.Total < Fx.Zero) b.TurnsUntilFlip = (city.Loyalty / -b.Total).CeilToInt();
        return b;
    }

    public static void ProcessTurn(GameState s, List<GameEvent> events)
    {
        if (!s.Options.LoyaltyEnabled) return;
        var snapshot = Snapshot(s);
        var flips = new List<(CityState City, LoyaltyBreakdown Breakdown)>();

        foreach (var city in s.Cities)
        {
            var b = Compute(s, city, snapshot);
            city.LastLoyaltyDelta = b.Total;
            city.Loyalty = Fx.Clamp(city.Loyalty + b.Total, Fx.Zero, MaxLoyalty);
            if (b.TurnsUntilFlip is > 0 and <= 5 && city.Loyalty > Fx.Zero)
                events.Add(new GameEvent(GameEventType.LoyaltyWarning, city.Owner, city.Id, city.Tile, Value: b.TurnsUntilFlip, Detail: city.Name));
            // Capitals never revolt, nor does a civilization's last city: loyalty shrinks realms, it does not end them.
            if (city.Loyalty == Fx.Zero && !city.IsCapital && (!s.Players[city.Owner].IsMajor || s.Cities.Count(c => c.Owner == city.Owner) > 1)) flips.Add((city, b));
        }

        foreach (var (city, b) in flips)
        {
            var owner = s.Players[city.Owner];
            if (owner.IsFreeCities)
            {
                if (b.TopForeignPlayer < 0) continue;
                CitySystem.ChangeOwner(s, city, b.TopForeignPlayer, events, GameEventType.CityFlipped);
            }
            else
            {
                var free = s.FreeCitiesPlayer;
                if (free == null) continue;
                CitySystem.ChangeOwner(s, city, free.Id, events, GameEventType.CityDeclaredIndependence);
            }
            city.Loyalty = 50;
        }

        foreach (var city in s.Cities)
            if (city.TurnsSinceOwnerChange < 999) city.TurnsSinceOwnerChange++;
    }
}
