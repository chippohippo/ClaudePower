using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.State;

namespace UnbrokenAges.Sim.Systems;

/// <summary>
/// The Chronicle: an auto-written history of every civilization and of the world, in dated lines
/// ("2340 BC: Egypt founds Abydos."), inspired by Shadow Empire's feats and biographies. It is
/// recorded deterministically inside the command pipeline, so every peer has the same book. It is
/// read on the Chronicle screen, exported at game end beside the timelapse, and shared in multiplayer.
/// </summary>
public static class ChronicleSystem
{
    public static void Record(GameState s, IReadOnlyList<GameEvent> events, int from)
    {
        var db = s.Db;
        if (db.ChronicleTemplates.Count == 0) return;
        for (int i = from; i < events.Count; i++)
        {
            var e = events[i];
            string type = e.Type.ToString();
            foreach (var t in db.ChronicleTemplates)
            {
                if (t.Event != type || e.Value < t.MinValue || (t.RequiresPlayer && e.Player < 0)) continue;
                if (t.OncePerPlayer && s.Chronicle.Any(c => c.Kind == e.Type && c.Player == e.Player)) continue;
                s.Chronicle.Add(new ChronicleEntry
                {
                    Turn = s.Turn, Year = Calendar.Year(s.Turn, s.Options.GameSpeedPercent), Player = e.Player, Kind = e.Type,
                    Text = Format(s, t.Text, e),
                });
                break;
            }
        }
    }

    private static string Format(GameState s, string template, GameEvent e)
    {
        var db = s.Db;
        var p = e.Player >= 0 && e.Player < s.Players.Count ? s.Players[e.Player] : null;
        string civ = p == null ? "the world" : p.CivIndex >= 0 ? db.Civilizations[p.CivIndex].Name : p.Name;
        string leader = p != null && p.LeaderIndex >= 0 ? db.Leaders[p.LeaderIndex].Name : civ;
        string city = e.City >= 0 && s.GetCity(e.City) is { } c ? c.Name : "";
        return template
            .Replace("{year}", Calendar.Format(Calendar.Year(s.Turn, s.Options.GameSpeedPercent)))
            .Replace("{civ}", civ).Replace("{leader}", leader).Replace("{city}", city)
            .Replace("{detail}", e.Detail ?? "").Replace("{value}", e.Value.ToString());
    }

    public static IEnumerable<ChronicleEntry> Of(GameState s, int player) =>
        s.Chronicle.Where(c => c.Player == player || c.Player < 0);
}

/// <summary>Turn → calendar year (4000 BC start; years per turn shrink as history speeds up).</summary>
public static class Calendar
{
    // (turns at standard speed, years per turn)
    private static readonly (int Turns, int Years)[] Segments = { (75, 40), (60, 25), (60, 20), (50, 5), (50, 1) };

    public static int Year(int turn, int speedPercent = 100)
    {
        int year = -4000;
        int remaining = turn - 1;
        foreach (var (turns, years) in Segments)
        {
            int scaledTurns = turns * speedPercent / 100;
            int perTurnTimes100 = years * 10000 / Math.Max(1, speedPercent);
            int take = Math.Min(remaining, scaledTurns);
            year += take * perTurnTimes100 / 100;
            remaining -= take;
            if (remaining == 0) return year;
        }
        return year + remaining * 100 / Math.Max(1, speedPercent) / 2; // beyond the calendar: half a year per turn
    }

    public static string Format(int year) => year < 0 ? $"{-year} BC" : $"AD {Math.Max(1, year)}";
}
