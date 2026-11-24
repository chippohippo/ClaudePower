using UnbrokenAges.Sim.Core;
using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.State;

namespace UnbrokenAges.Sim.Systems;

public sealed class AttitudeBreakdown
{
    public List<(string Label, int Value)> Lines { get; } = new();
    public int Total => Lines.Sum(l => l.Value);
    public void Add(string label, int value) { if (value != 0) Lines.Add((label, value)); }
}

/// <summary>
/// Diplomacy core: war, peace, alliances (teams), denunciation, open borders and itemized grievances.
/// Design rules (GDD §8): grievances are itemized with a source and decay, so they feel fair; a surprise war
/// costs far more than a declared one; peace needs both sides and a minimum war length; attitudes are a
/// visible sum of named lines (agenda, ideology, grievances, war), never a hidden number.
/// </summary>
public static class DiplomacySystem
{
    public const int MinWarTurns = 10;
    public const int MinPeaceTurns = 10;
    public const int DenounceWarningTurns = 5;
    public const int DenounceMemoryTurns = 30;

    // ----- Status queries ---------------------------------------------------------------------------

    public static Relation? Find(GameState s, int a, int b)
    {
        if (a == b) return null;
        int lo = Math.Min(a, b), hi = Math.Max(a, b);
        return s.Relations.Find(r => r.A == lo && r.B == hi);
    }

    private static Relation Get(GameState s, int a, int b)
    {
        var r = Find(s, a, b);
        if (r != null) return r;
        r = new Relation { A = Math.Min(a, b), B = Math.Max(a, b), Since = 0 };
        s.Relations.Add(r);
        s.Relations.Sort((x, y) => x.A != y.A ? x.A.CompareTo(y.A) : x.B.CompareTo(y.B));
        return r;
    }

    public static bool SameTeam(GameState s, int a, int b) =>
        a == b || (!s.Players[a].IsFreeCities && !s.Players[b].IsFreeCities && s.Players[a].Team >= 0 && s.Players[a].Team == s.Players[b].Team);

    /// <summary>Free Cities are hostile to everyone; teammates are never at war.</summary>
    public static bool AtWar(GameState s, int a, int b)
    {
        if (a < 0 || b < 0 || SameTeam(s, a, b)) return false;
        if (s.Players[a].IsFreeCities || s.Players[b].IsFreeCities) return true;
        return Find(s, a, b)?.Status == DiploStatus.War;
    }

    /// <summary>"At war", "At peace", "Allied" or "Teammates", for the diplomacy screen.</summary>
    public static string StatusName(GameState s, int a, int b) =>
        SameTeam(s, a, b) ? "Teammates" : AtWar(s, a, b) ? "At war" : Find(s, a, b)?.Status == DiploStatus.Alliance ? "Allied" : "At peace";

    public static bool Allied(GameState s, int a, int b) => SameTeam(s, a, b) || Find(s, a, b)?.Status == DiploStatus.Alliance;

    /// <summary>May <paramref name="mover"/>'s military enter <paramref name="owner"/>'s land?</summary>
    public static bool MayEnter(GameState s, int mover, int owner)
    {
        if (owner < 0 || Allied(s, mover, owner) || AtWar(s, mover, owner)) return true;
        var r = Find(s, mover, owner);
        if (r == null) return false;
        return owner == r.A ? r.AGrantsB : r.BGrantsA;
    }

    // ----- Actions ---------------------------------------------------------------------------------

    public static string? ValidateDenounce(GameState s, int a, int b) =>
        !Valid(s, a, b) ? "Invalid target." : SameTeam(s, a, b) ? "Cannot denounce a teammate." : null;

    public static void Denounce(GameState s, int a, int b, List<GameEvent> events)
    {
        var r = Get(s, a, b);
        if (a == r.A) r.DenouncedByA = s.Turn; else r.DenouncedByB = s.Turn;
        AddGrievance(s, b, a, 5, "Denounced us");
        events.Add(new GameEvent(GameEventType.Denounced, a, Value: b, Detail: Name(s, b)));
    }

    public static string? ValidateDeclareWar(GameState s, int a, int b)
    {
        if (!Valid(s, a, b)) return "Invalid target.";
        if (SameTeam(s, a, b)) return "Cannot declare war on a teammate.";
        if (NationSystem.ForbidWar(s, a) is { } forbidden) return forbidden;
        var r = Find(s, a, b);
        if (r?.Status == DiploStatus.War) return "Already at war.";
        if (r?.Status == DiploStatus.Alliance) return "Dissolve the alliance first.";
        if (r != null && r.Status == DiploStatus.Peace && r.Since > 0 && s.Turn - r.Since < MinPeaceTurns)
            return $"A peace treaty binds you for {MinPeaceTurns - (s.Turn - r.Since)} more turns.";
        if (s.Options.NoSurpriseWars && !DenouncedRecently(s, a, b, DenounceWarningTurns))
            return $"This game forbids surprise wars: denounce them at least {DenounceWarningTurns} turns first.";
        return null;
    }

    public static void DeclareWar(GameState s, int a, int b, List<GameEvent> events)
    {
        bool formal = DenouncedRecently(s, a, b, DenounceWarningTurns);
        var r = Get(s, a, b);
        r.Status = DiploStatus.War;
        r.Since = s.Turn;
        r.PeaceProposedBy = -1;
        r.AGrantsB = r.BGrantsA = false;
        s.Players[a].LastWarDeclaredTurn = s.Turn;
        AddGrievance(s, b, a, formal ? 15 : 40, formal ? "Declared war on us" : "Surprise war");
        foreach (var w in s.Players)
            if (w.Id != a && w.Id != b && w.IsMajor && w.IsAlive)
                AddGrievance(s, w.Id, a, formal ? 4 : 10, $"Warmongering against {Name(s, b)}");
        events.Add(new GameEvent(GameEventType.WarDeclared, a, Value: b, Detail: Name(s, b)));
    }

    public static string? ValidateProposePeace(GameState s, int a, int b)
    {
        if (!Valid(s, a, b)) return "Invalid target.";
        var r = Find(s, a, b);
        if (r?.Status != DiploStatus.War) return "You are not at war.";
        if (s.Turn - r.Since < MinWarTurns) return $"Peace is possible after {MinWarTurns - (s.Turn - r.Since)} more turns of war.";
        if (r.PeaceProposedBy == a) return "Your offer is already on the table.";
        return null;
    }

    public static void ProposePeace(GameState s, int a, int b, List<GameEvent> events)
    {
        Get(s, a, b).PeaceProposedBy = a;
        events.Add(new GameEvent(GameEventType.PeaceProposed, a, Value: b, Detail: Name(s, b)));
    }

    public static string? ValidateAcceptPeace(GameState s, int accepter, int proposer) =>
        !Valid(s, accepter, proposer) ? "Invalid player." : Find(s, accepter, proposer)?.PeaceProposedBy != proposer ? "There is no peace offer from them." : null;

    public static void AcceptPeace(GameState s, int accepter, int proposer, List<GameEvent> events)
    {
        var r = Get(s, accepter, proposer);
        r.Status = DiploStatus.Peace;
        r.Since = s.Turn;
        r.PeaceProposedBy = -1;
        EvictUnits(s, accepter, proposer);
        EvictUnits(s, proposer, accepter);
        events.Add(new GameEvent(GameEventType.PeaceSigned, accepter, Value: proposer, Detail: Name(s, proposer)));
    }

    public static void SetOpenBorders(GameState s, int grantor, int grantee, bool open, List<GameEvent> events)
    {
        var r = Get(s, grantor, grantee);
        if (grantor == r.A) r.AGrantsB = open; else r.BGrantsA = open;
        if (open) events.Add(new GameEvent(GameEventType.OpenBordersGranted, grantor, Value: grantee, Detail: Name(s, grantee)));
        else EvictUnits(s, grantee, grantor);
    }

    /// <summary>After peace (or revoked access), military units standing in the other's land walk home.</summary>
    private static void EvictUnits(GameState s, int unitOwner, int landOwner)
    {
        var map = s.Map;
        foreach (var u in s.Units.Where(u => u.Owner == unitOwner && map.OwnerPlayer[u.Tile] == landOwner && SupplySystem.IsMilitary(s.Db, u)).ToList())
        {
            var home = s.CitiesOf(unitOwner).OrderBy(c => map.Distance(c.Tile, u.Tile)).ThenBy(c => c.Id).FirstOrDefault();
            if (home != null) { u.Tile = home.Tile; u.Destination = -1; }
        }
    }

    // ----- Grievances --------------------------------------------------------------------------------

    public static void AddGrievance(GameState s, int holder, int against, Fx amount, string reason)
    {
        if (holder == against || holder < 0 || against < 0 || !s.Players[holder].IsMajor) return;
        s.Grievances.Add(new Grievance { Holder = holder, Against = against, Amount = amount, Turn = s.Turn, Reason = reason });
    }

    public static Fx GrievanceTotal(GameState s, int holder, int against) =>
        s.Grievances.Where(g => g.Holder == holder && g.Against == against).Aggregate(Fx.Zero, (sum, g) => sum + g.Amount);

    /// <summary>Converts world events into grievances (runs after every command, like the Chronicle).</summary>
    public static void OnEvents(GameState s, IReadOnlyList<GameEvent> events, int from)
    {
        for (int i = from; i < events.Count; i++)
        {
            var e = events[i];
            if (e.Type == GameEventType.CityFlipped && e.Value >= 0 && e.Player >= 0)
                AddGrievance(s, e.Value, e.Player, 10, $"Took {e.Detail} through cultural pressure");
            else if (e.Type == GameEventType.BloomEncroached && e.Player >= 0 && e.Value >= 0)
                AddGrievance(s, e.Player, e.Value, 2, "The Bloom spreads into our land");
        }
    }

    /// <summary>Grievances fade by one point a turn; relations persist.</summary>
    public static void ProcessTurn(GameState s)
    {
        foreach (var g in s.Grievances) g.Amount -= Fx.One;
        s.Grievances.RemoveAll(g => g.Amount <= Fx.Zero);
    }

    // ----- Attitude ------------------------------------------------------------------------------------

    public static AttitudeBreakdown Attitude(GameState s, int from, int toward)
    {
        var b = new AttitudeBreakdown();
        var db = s.Db;
        var p = s.Players[from];
        var t = s.Players[toward];
        if (SameTeam(s, from, toward)) { b.Add("Teammates", 30); return b; }
        if (AtWar(s, from, toward)) b.Add("At war", -20);
        else if (Find(s, from, toward)?.Status == DiploStatus.Alliance) b.Add("Allies", 20);
        var r = Find(s, from, toward);
        if (r != null && (toward == r.A ? r.DenouncedByA : r.DenouncedByB) is int when && when >= 0 && s.Turn - when <= DenounceMemoryTurns)
            b.Add("Denounced us", -8);
        b.Add("Grievances", -(GrievanceTotal(s, from, toward) / 5).FloorToInt());
        b.Add("Ideology (Divergence)", DivergenceSystem.Attitude(db, p, toward == from ? p : t));

        if (p.LeaderIndex >= 0)
        {
            var agenda = db.Leaders[p.LeaderIndex].Agenda;
            foreach (var like in agenda.Likes) b.Add($"{agenda.Name}: {like}", AgendaScore(s, like, toward) is true ? 6 : 0);
            foreach (var dislike in agenda.Dislikes) b.Add($"{agenda.Name}: {dislike}", AgendaScore(s, dislike, toward) is true ? -8 : 0);
        }
        return b;
    }

    /// <summary>Agenda tags the engine understands (data refers to them by name).</summary>
    public static bool? AgendaScore(GameState s, string tag, int player)
    {
        var p = s.Players[player];
        var cities = s.CitiesOf(player).ToList();
        return tag switch
        {
            "HighScience" => p.Techs.Count(x => x) >= s.Players.Where(o => o.IsMajor).Max(o => o.Techs.Count(x => x)) - 1,
            "Peaceful" => !s.Players.Any(o => o.Id != player && AtWar(s, player, o.Id) && o.IsMajor),
            "Warmonger" => p.LastWarDeclaredTurn >= 0 && s.Turn - p.LastWarDeclaredTurn <= 50,
            "HighLoyalty" => cities.Count > 0 && cities.Aggregate(Fx.Zero, (sum, c) => sum + c.Loyalty) / cities.Count >= 80,
            "CitiesInRevolt" => cities.Any(c => c.Loyalty < 15),
            _ => null, // tags for systems not built yet (e.g. TradePartner) count as neutral
        };
    }

    private static bool DenouncedRecently(GameState s, int a, int b, int minTurnsAgo)
    {
        var r = Find(s, a, b);
        if (r == null) return false;
        int when = a == r.A ? r.DenouncedByA : r.DenouncedByB;
        return when >= 0 && s.Turn - when >= minTurnsAgo && s.Turn - when <= DenounceMemoryTurns;
    }

    private static bool Valid(GameState s, int a, int b) =>
        a >= 0 && b >= 0 && a < s.Players.Count && b < s.Players.Count && a != b && s.Players[b].IsAlive && !s.Players[b].IsFreeCities;

    private static string Name(GameState s, int player)
    {
        var p = s.Players[player];
        return p.CivIndex >= 0 ? s.Db.Civilizations[p.CivIndex].Name : p.Name;
    }
}
