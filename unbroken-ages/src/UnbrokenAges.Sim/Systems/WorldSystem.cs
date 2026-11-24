using UnbrokenAges.Sim.Core;
using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.State;

namespace UnbrokenAges.Sim.Systems;

/// <summary>
/// World currents and world ages (inspired by Millennia's global ages, reworked so they never
/// reset or replace your civilization).
///
/// Three shared meters (0–100) are pushed by what everyone does: Progress (research, civics),
/// Strife (armies, rebellions, encroachment), Calamity (disasters, drowned coasts, famine).
/// They decay a few percent each turn. When the first civilization enters a new era, the world
/// enters a new **age**: the highest-priority age whose conditions match the currents (or an
/// ordinary age if none do). An age gives every city the same modifiers for that era and can make
/// disasters more or less likely. The HUD shows the currents and a forecast ("If an era began
/// today: An Age of Iron"), so players can steer history together.
/// </summary>
public static class WorldSystem
{
    public static void Push(GameState s, IReadOnlyList<GameEvent> events, int from)
    {
        var rules = s.Db.Rules;
        if (rules.Pushes.Count == 0) return;
        for (int i = from; i < events.Count; i++)
        {
            string key = KeyOf(s, events[i]);
            foreach (var push in rules.Pushes)
                if (push.Event == key) s.World.Set(push.Current, s.World.Get(push.Current) + push.Amount);
        }
    }

    /// <summary>Event name, or a derived key for events whose meaning depends on their payload.</summary>
    private static string KeyOf(GameState s, GameEvent e)
    {
        if (e.Type == GameEventType.ProductionCompleted && e.Value == (int)ProductionKind.Unit &&
            e.Def >= 0 && e.Def < s.Db.Units.Count && s.Db.Units[e.Def].Strength > 0)
            return "MilitaryUnitTrained";
        return e.Type.ToString();
    }

    public static void ProcessTurn(GameState s, List<GameEvent> events)
    {
        var world = s.World;
        int decay = s.Db.Rules.CurrentDecayPercent;
        foreach (var c in Enum.GetValues<WorldCurrent>())
            world.Set(c, world.Get(c) - world.Get(c) * decay / 100);

        int era = s.Players.Where(p => p.IsMajor && p.IsAlive).Select(s.PlayerEra).DefaultIfEmpty(0).Max();
        if (era <= world.WorldEra) return;
        world.WorldEra = era;
        int age = Forecast(s, era);
        world.CurrentAge = age;
        world.AgeHistory.Add((era, age));
        string eraName = s.Db.Eras.FirstOrDefault(e => e.Order == era)?.Name ?? $"era {era}";
        events.Add(age >= 0
            ? new GameEvent(GameEventType.WorldAgeBegan, Def: age, Value: era, Detail: $"{s.Db.WorldAges[age].Name}. {s.Db.WorldAges[age].Narration}")
            : new GameEvent(GameEventType.WorldAgeBegan, Def: -1, Value: era, Detail: $"the {eraName} in an ordinary age."));
    }

    /// <summary>The age the world would enter if a new era began now (-1 = ordinary).</summary>
    public static int Forecast(GameState s, int era)
    {
        int best = -1;
        foreach (var a in s.Db.WorldAges)
        {
            if (a.MinEraOrder > era) continue;
            bool ok = a.Conditions.All(c => s.World.Get(c.Current) >= c.Min && s.World.Get(c.Current) <= c.Max);
            if (!ok) continue;
            if (best < 0 || a.Priority > s.Db.WorldAges[best].Priority) best = a.Index;
        }
        return best;
    }

    public static WorldAgeDef? CurrentAge(GameState s) =>
        s.World.CurrentAge >= 0 ? s.Db.WorldAges[s.World.CurrentAge] : null;
}
