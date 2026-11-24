using UnbrokenAges.Sim.Core;
using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.State;

namespace UnbrokenAges.Sim.Systems;

/// <summary>
/// The orbital layer and the Exodus victory (docs/05-key-systems/21-space.md). Projects in a Spaceport launch <b>satellites</b>
/// that orbit over the launching city for 40 turns:
/// <list type="bullet">
/// <item><b>Survey</b> (Rocketry): maps everything within 9 tiles at launch.</item>
/// <item><b>Solar Array</b> (Renewable Energy): +2 Production in your cities within 5 tiles.</item>
/// <item><b>Weather Station</b> (Rocketry): +2 Food in your cities within 5 tiles.</item>
/// <item><b>Relay</b> (Robotics): +2 Science in your cities within 5 tiles.</item>
/// </list>
/// A city benefits once per kind, however many satellites cover it. The <b>Exodus</b> chain — First Orbit, Moon Base, Mars Colony,
/// the Exodus Ark — is a sequence of one-off Spaceport projects; launching the ark wins the Exodus victory. Spies can sabotage the
/// work in progress (Sabotage Production), and Great Engineers can rush it if the capital builds it.
/// </summary>
public static class SpaceSystem
{
    public enum SatelliteKind { Survey, SolarArray, WeatherStation, Relay }

    public const int Lifetime = 40, SurveyRadius = 9, CoverageRadius = 5, Yield = 2, FinalStage = 4;

    public static readonly string[] Stages = { "", "First Orbit", "Moon Base", "Mars Colony", "Exodus Ark" };

    public static string Name(int kind) => (SatelliteKind)kind switch
    {
        SatelliteKind.Survey => "Survey Satellite",
        SatelliteKind.SolarArray => "Solar Array",
        SatelliteKind.WeatherStation => "Weather Station",
        _ => "Relay Satellite",
    };

    public static void Launch(GameState s, CityState city, int kind, List<GameEvent> events)
    {
        var p = s.Players[city.Owner];
        s.Satellites.Add(new SatelliteState { Id = s.AllocateId(), Owner = p.Id, Kind = kind, Center = city.Tile, TurnsLeft = Lifetime * s.Options.GameSpeedPercent / 100 });
        if (kind == (int)SatelliteKind.Survey && p.Revealed.Length == s.Map.Count)
        {
            var tiles = new List<int>();
            s.Map.CollectRadius(city.Tile, SurveyRadius, tiles);
            foreach (int t in tiles) p.Revealed[t] = true;
        }
        events.Add(new GameEvent(GameEventType.SatelliteLaunched, p.Id, city.Id, city.Tile, Value: kind, Detail: $"{Name(kind)} over {city.Name}"));
    }

    public static void Advance(GameState s, PlayerState p, int stage, List<GameEvent> events)
    {
        if (stage <= p.ExodusStage) return;
        p.ExodusStage = stage;
        events.Add(new GameEvent(GameEventType.ExodusStageReached, p.Id, Value: stage, Detail: Stages[Math.Clamp(stage, 0, FinalStage)]));
        AgeSystem.Award(s, p, 3, $"Reached {Stages[Math.Clamp(stage, 0, FinalStage)]}", events);
    }

    public static void ProcessTurn(GameState s, List<GameEvent> events)
    {
        foreach (var sat in s.Satellites.ToList())
        {
            if (--sat.TurnsLeft > 0 && s.Players[sat.Owner].IsAlive) continue;
            s.Satellites.Remove(sat);
            events.Add(new GameEvent(GameEventType.SatelliteFell, sat.Owner, Tile: sat.Center, Value: sat.Kind, Detail: Name(sat.Kind)));
        }
    }

    public static int ExodusWinner(GameState s) =>
        s.Players.Where(p => p.IsMajor && p.IsAlive && p.ExodusStage >= FinalStage).OrderBy(p => p.Id).Select(p => p.Id).DefaultIfEmpty(-1).First();

    private static readonly Dictionary<int, List<ModifierDef>> Cache = new();

    /// <summary>Orbital coverage: each kind once per city, from any of the owner's satellites within range.</summary>
    public static IEnumerable<(List<ModifierDef> Modifiers, string Source)> CityModifierSources(GameState s, CityState city)
    {
        if (s.Satellites.Count == 0) yield break;
        foreach (SatelliteKind kind in new[] { SatelliteKind.SolarArray, SatelliteKind.WeatherStation, SatelliteKind.Relay })
        {
            if (!s.Satellites.Any(x => x.Owner == city.Owner && x.Kind == (int)kind && s.Map.Distance(x.Center, city.Tile) <= CoverageRadius)) continue;
            List<ModifierDef> mods;
            lock (Cache)
                if (!Cache.TryGetValue((int)kind, out mods!))
                    Cache[(int)kind] = mods = new List<ModifierDef>
                    {
                        new()
                        {
                            Effect = ModifierEffect.CityYieldFlat, Amount = Fx.FromInt(Yield),
                            Yield = kind switch { SatelliteKind.SolarArray => YieldType.Production, SatelliteKind.WeatherStation => YieldType.Food, _ => YieldType.Science },
                        },
                    };
            yield return (mods, $"Orbit: {Name((int)kind)}");
        }
    }
}
