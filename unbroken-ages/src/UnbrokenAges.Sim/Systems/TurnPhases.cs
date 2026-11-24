using UnbrokenAges.Sim.State;

namespace UnbrokenAges.Sim.Systems;

/// <summary>
/// Turn phases: who may act right now (GDD §15). Computed when each turn begins and stored in the state, so every peer
/// and every UI agrees, and a war declared mid-turn changes the order only from the next turn.
/// * <b>Simultaneous</b>: one phase with everyone.
/// * <b>Sequential</b>: one phase per civilization, in player order.
/// * <b>Dynamic</b> (default): civilizations at peace move together; enemies never move at the same time. Greedy colouring
///   of the war graph in player order: each civilization joins the first phase holding no enemy of its own. Teammates are
///   never at war, so they share a phase.
/// The current phase is the first one with a living member that has not ended its turn. The host enforces it.
/// </summary>
public static class TurnPhases
{
    public static List<int[]> Compute(GameState s)
    {
        var majors = s.Players.Where(p => p.IsAlive && p.IsMajor).Select(p => p.Id).ToList();
        switch (s.Options.TurnMode)
        {
            case TurnMode.Simultaneous:
                return new() { majors.ToArray() };
            case TurnMode.Sequential:
                return majors.Select(p => new[] { p }).ToList();
            default:
                var phases = new List<List<int>>();
                foreach (int p in majors)
                {
                    var home = phases.Find(phase => phase.All(o => !DiplomacySystem.AtWar(s, p, o)));
                    if (home != null) home.Add(p);
                    else phases.Add(new List<int> { p });
                }
                return phases.Select(phase => phase.ToArray()).ToList();
        }
    }

    public static void Begin(GameState s) => s.TurnPhases = Compute(s);

    /// <summary>Index of the phase now moving, or -1 when everyone has ended the turn.</summary>
    public static int Current(GameState s)
    {
        for (int i = 0; i < s.TurnPhases.Count; i++)
            foreach (int p in s.TurnPhases[i])
                if (s.Players[p].IsAlive && !s.Players[p].HasEndedTurn) return i;
        return -1;
    }

    /// <summary>System commands, and every player when no phases were computed (old saves, tools), always may act.</summary>
    public static bool MayAct(GameState s, int player)
    {
        if (player < 0 || s.TurnPhases.Count == 0) return true;
        int current = Current(s);
        return current >= 0 && Array.IndexOf(s.TurnPhases[current], player) >= 0;
    }

    /// <summary>"Phase 2 of 2: Bob" for the HUD and for refusals.</summary>
    public static string Describe(GameState s)
    {
        int current = Current(s);
        if (current < 0) return "The turn is ending.";
        var names = s.TurnPhases[current].Where(p => s.Players[p].IsAlive && !s.Players[p].HasEndedTurn).Select(p => s.Players[p].Name);
        return $"Phase {current + 1} of {s.TurnPhases.Count}: {string.Join(", ", names)}";
    }
}
