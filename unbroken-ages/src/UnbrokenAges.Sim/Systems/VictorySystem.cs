using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.State;

namespace UnbrokenAges.Sim.Systems;

/// <summary>
/// Victories (GDD §14). Built so far:
/// * <b>Ascension</b>: the first civilization to complete its Divergence's final project.
/// * <b>Hegemony</b>: one team holds every original capital, or holds 60% of the world's population (in cities above 50 loyalty)
///   and 60% of its land. No last-city-standing grind.
/// * <b>Spiritual</b>: a religion followed by most of the cities of every other living civilization (at least two of them).
/// * <b>Score</b>: highest score when the turn limit ends. Every score source is a visible line, all game long.
/// Each can be switched off at setup. When a team wins, the game pauses on the victory screen; <c>OneMoreTurnCommand</c> keeps
/// playing, and no further victory is awarded. A civilization that has lost every city and unit is eliminated.
/// Checks run at the end of each turn and after every command, so a capture that completes Hegemony ends the game at once.
/// </summary>
public static class VictorySystem
{
    public static bool Enabled(GameState s, VictoryKind kind) => (s.Options.Victories & kind) != 0;

    public static void Check(GameState s, List<GameEvent> events, bool endOfTurn)
    {
        if (endOfTurn) EliminateFallen(s, events);
        if (s.Victory.Decided) return;

        if (Enabled(s, VictoryKind.Ascension))
            foreach (var p in Majors(s))
                if (p.Ascended) { Declare(s, p.Id, VictoryKind.Ascension, events); return; }

        if (Enabled(s, VictoryKind.Hegemony) && HegemonyWinner(s) is int h and >= 0) { Declare(s, h, VictoryKind.Hegemony, events); return; }

        if (endOfTurn && Enabled(s, VictoryKind.Spiritual) && ReligionSystem.SpiritualWinner(s) is int r and >= 0) { Declare(s, r, VictoryKind.Spiritual, events); return; }

        if (endOfTurn && Enabled(s, VictoryKind.Score) && s.Options.TurnLimit > 0 && s.Turn >= s.Options.TurnLimit)
            Declare(s, ScoreLeader(s), VictoryKind.Score, events);
    }

    // ----- Hegemony ------------------------------------------------------------------------------------

    /// <summary>Player (lowest id of the winning team) that has achieved Hegemony, or -1.</summary>
    public static int HegemonyWinner(GameState s)
    {
        foreach (var p in Majors(s))
        {
            var (held, total) = CapitalsHeld(s, p.Id);
            if (total >= 2 && held == total && EveryLivingMajorFounded(s)) return p.Id;
            if (ShareOfWorld(s, p.Id) is var (pop, land) && pop >= s.Db.Rules.Victory.HegemonySharePercent && land >= s.Db.Rules.Victory.HegemonySharePercent)
                return p.Id;
        }
        return -1;
    }

    /// <summary>Original capitals held by the player's team, out of all original capitals.</summary>
    public static (int Held, int Total) CapitalsHeld(GameState s, int player)
    {
        int held = 0, total = 0;
        foreach (var c in s.Cities)
        {
            if (!c.WasOriginalCapital || !s.Players[c.OriginalOwner].IsMajor) continue;
            total++;
            if (DiplomacySystem.SameTeam(s, c.Owner, player)) held++;
        }
        return (held, total);
    }

    /// <summary>The team's percentage of world population (cities above the loyalty bar only) and of all land tiles.</summary>
    public static (int PopulationPercent, int LandPercent) ShareOfWorld(GameState s, int player)
    {
        var rules = s.Db.Rules.Victory;
        int worldPop = 0, teamPop = 0;
        foreach (var c in s.Cities)
        {
            worldPop += c.Population;
            if (DiplomacySystem.SameTeam(s, c.Owner, player) && c.Loyalty > rules.HegemonyMinLoyalty) teamPop += c.Population;
        }
        var map = s.Map;
        int land = 0, teamLand = 0;
        for (int t = 0; t < map.Count; t++)
        {
            if (!map.IsLand(t)) continue;
            land++;
            if (map.OwnerPlayer[t] >= 0 && DiplomacySystem.SameTeam(s, map.OwnerPlayer[t], player)) teamLand++;
        }
        return (worldPop == 0 ? 0 : teamPop * 100 / worldPop, land == 0 ? 0 : teamLand * 100 / land);
    }

    // A civilization still wandering with its first settler has not entered the contest yet.
    private static bool EveryLivingMajorFounded(GameState s) =>
        Majors(s).All(p => s.Cities.Any(c => c.WasOriginalCapital && c.OriginalOwner == p.Id));

    // ----- Score ---------------------------------------------------------------------------------------

    public static List<(string Label, int Points)> ScoreLines(GameState s, int player)
    {
        var rules = s.Db.Rules.Victory;
        var db = s.Db;
        var p = s.Players[player];
        var cities = s.CitiesOf(player).ToList();
        int districts = 0, wonders = 0, buildings = 0;
        foreach (var c in cities)
            foreach (var d in c.Districts)
            {
                var cat = db.Districts[d.DefIndex].Category;
                if (cat == DistrictCategory.Wonder) wonders++;
                else if (cat != DistrictCategory.CityCenter) districts++;
                buildings += d.Buildings.Count;
            }
        int tiles = 0;
        for (int t = 0; t < s.Map.Count; t++) if (s.Map.OwnerPlayer[t] == player) tiles++;
        return new()
        {
            ("Citizens", cities.Sum(c => c.Population) * rules.ScorePerCitizen),
            ("Cities", cities.Count * rules.ScorePerCity),
            ("Districts", districts * rules.ScorePerDistrict),
            ("Buildings", buildings * rules.ScorePerBuilding),
            ("Wonders", wonders * rules.ScorePerWonder),
            ("Technologies", p.Techs.Count(x => x) * rules.ScorePerTech),
            ("Civics", p.Civics.Count(x => x) * rules.ScorePerCivic),
            ("Territory", rules.TilesPerPoint > 0 ? tiles / rules.TilesPerPoint : 0),
            ("Ascension", p.Ascended ? rules.ScoreForAscension : 0),
        };
    }

    public static int Score(GameState s, int player) => ScoreLines(s, player).Sum(l => l.Points);

    /// <summary>Highest score; ties go to more technologies, then to the lower player id.</summary>
    public static int ScoreLeader(GameState s)
    {
        int best = -1, bestScore = int.MinValue, bestTechs = -1;
        foreach (var p in Majors(s))
        {
            int score = Score(s, p.Id), techs = p.Techs.Count(x => x);
            if (score > bestScore || (score == bestScore && techs > bestTechs)) { best = p.Id; bestScore = score; bestTechs = techs; }
        }
        return best;
    }

    /// <summary>"Egypt wins a Hegemony victory on turn 212." for the victory screen (null while undecided).</summary>
    public static string? Headline(GameState s)
    {
        var v = s.Victory;
        if (!v.Decided) return null;
        var p = s.Players[v.Winner];
        string civ = p.CivIndex >= 0 ? s.Db.Civilizations[p.CivIndex].Name : p.Name;
        string article = v.Kind == VictoryKind.Ascension ? "an" : "a";
        return $"{civ} wins {article} {v.Kind} victory on turn {v.Turn}.";
    }

    // ----- shared --------------------------------------------------------------------------------------

    private static IEnumerable<PlayerState> Majors(GameState s) => s.Players.Where(p => p.IsAlive && p.IsMajor);

    private static void Declare(GameState s, int player, VictoryKind kind, List<GameEvent> events)
    {
        if (player < 0) return;
        var p = s.Players[player];
        s.Victory = new VictoryState { Winner = player, WinnerTeam = p.Team, Kind = kind, Turn = s.Turn };
        string civ = p.CivIndex >= 0 ? s.Db.Civilizations[p.CivIndex].Name : p.Name;
        string how = kind switch
        {
            VictoryKind.Ascension => "an Ascension victory: the world it remade is now the world",
            VictoryKind.Hegemony => "a Hegemony victory: every old capital answers to it",
            VictoryKind.Spiritual => $"a Spiritual victory: the world keeps {(p.Religion >= 0 ? s.Db.Religions[p.Religion].Name : "its faith")}",
            _ => $"a Score victory with {Score(s, player)} points",
        };
        events.Add(new GameEvent(GameEventType.VictoryAchieved, player, Def: (int)kind, Value: p.Team, Detail: $"{civ} wins {how}."));
    }

    /// <summary>A civilization that founded a city and has since lost every city and unit leaves the game.</summary>
    private static void EliminateFallen(GameState s, List<GameEvent> events)
    {
        foreach (var p in Majors(s).ToList())
        {
            if (!s.Cities.Any(c => c.OriginalOwner == p.Id)) continue; // never founded: still on the road
            if (s.Cities.Any(c => c.Owner == p.Id) || s.Units.Any(u => u.Owner == p.Id)) continue;
            p.IsAlive = false;
            foreach (var o in s.Outposts.Where(o => o.Owner == p.Id).ToList()) OutpostSystem.Release(s, o);
            events.Add(new GameEvent(GameEventType.PlayerEliminated, p.Id));
        }
    }
}
