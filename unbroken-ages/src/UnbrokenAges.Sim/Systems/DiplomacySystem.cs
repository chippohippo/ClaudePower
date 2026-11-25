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
        if (s.Options.NoSurpriseWars && !DenouncedRecently(s, a, b, DenounceWarningTurns) && !IsDefensiveWar(s, a, b))
            return $"This game forbids surprise wars: denounce them at least {DenounceWarningTurns} turns first.";
        return null;
    }

    public static void DeclareWar(GameState s, int a, int b, List<GameEvent> events)
    {
        bool defensive = IsDefensiveWar(s, a, b);
        bool formal = defensive || DenouncedRecently(s, a, b, DenounceWarningTurns);
        var r = Get(s, a, b);
        r.Status = DiploStatus.War;
        r.Since = s.Turn;
        r.PeaceProposedBy = -1;
        r.AGrantsB = r.BGrantsA = false;
        r.DeclaredBy = a;
        if (defensive)
        {
            // Answering an ally's call to arms: the aggressor resents it, nobody else calls it warmongering, and the ally is grateful.
            AddGrievance(s, b, a, 10, "Joined the war against us");
            foreach (int ally in Allies(s, a).Where(x => AtWar(s, x, b)))
                AddGoodwill(s, ally, a, 25, "Answered our call to arms");
            events.Add(new GameEvent(GameEventType.WarDeclared, a, Value: b, Detail: Name(s, b)));
            return;
        }
        s.Players[a].LastWarDeclaredTurn = s.Turn;
        AddGrievance(s, b, a, formal ? 15 : 40, formal ? "Declared war on us" : "Surprise war");
        foreach (var w in s.Players)
            if (w.Id != a && w.Id != b && w.IsMajor && w.IsAlive)
                AddGrievance(s, w.Id, a, formal ? 4 : 10, $"Warmongering against {Name(s, b)}");
        events.Add(new GameEvent(GameEventType.WarDeclared, a, Value: b, Detail: Name(s, b)));
        // The victim's allies are called to arms (they may answer with a defensive war: DeclareWar on the aggressor).
        foreach (int ally in Allies(s, b).Where(x => x != a && s.Players[x].IsAlive))
            events.Add(new GameEvent(GameEventType.CalledToArms, ally, Value: a, Def: b, Detail: $"{Name(s, a)} attacked {Name(s, b)}"));
    }

    /// <summary>
    /// A war <paramref name="a"/> would fight in defence of an ally: <paramref name="b"/> declared war on someone <paramref name="a"/>
    /// is allied with, and that war still goes on. It needs no denunciation and earns no warmonger's reputation.
    /// </summary>
    public static bool IsDefensiveWar(GameState s, int a, int b)
    {
        foreach (int ally in Allies(s, a))
            if (ally != b && Find(s, ally, b) is { Status: DiploStatus.War } war && war.DeclaredBy == b) return true;
        return false;
    }

    /// <summary>Civilizations allied with <paramref name="player"/> (teammates not included), in id order.</summary>
    public static List<int> Allies(GameState s, int player)
    {
        var list = new List<int>();
        foreach (var r in s.Relations)
            if (r.Status == DiploStatus.Alliance && (r.A == player || r.B == player)) list.Add(r.A == player ? r.B : r.A);
        return list;
    }

    /// <summary>An alliance (made in a deal): passage for each other's armies, no war between them, and a call to arms when either is attacked.</summary>
    public static void FormAlliance(GameState s, int a, int b, List<GameEvent> events)
    {
        var r = Get(s, a, b);
        r.Status = DiploStatus.Alliance;
        r.Since = s.Turn;
        r.PeaceProposedBy = -1;
        events.Add(new GameEvent(GameEventType.AllianceFormed, a, Value: b, Detail: Name(s, b)));
    }

    public static string? ValidateLeaveAlliance(GameState s, int a, int b) =>
        !Valid(s, a, b) ? "Invalid player." : Find(s, a, b)?.Status != DiploStatus.Alliance ? "You are not allied." : null;

    /// <summary>Leaving an alliance: back to a peace that binds for <see cref="MinPeaceTurns"/> turns, and a grievance for the one left behind.</summary>
    public static void LeaveAlliance(GameState s, int a, int b, List<GameEvent> events)
    {
        var r = Get(s, a, b);
        r.Status = DiploStatus.Peace;
        r.Since = s.Turn;
        AddGrievance(s, b, a, 10, "Abandoned our alliance");
        events.Add(new GameEvent(GameEventType.AllianceEnded, a, Value: b, Detail: Name(s, b)));
    }

    /// <summary>Does <paramref name="grantor"/> let <paramref name="grantee"/>'s armies cross its land (by grant, not alliance)?</summary>
    public static bool Grants(GameState s, int grantor, int grantee)
    {
        var r = Find(s, grantor, grantee);
        return r != null && (grantor == r.A ? r.AGrantsB : r.BGrantsA);
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

    public static void AcceptPeace(GameState s, int accepter, int proposer, List<GameEvent> events) => MakePeace(s, accepter, proposer, events);

    /// <summary>Ends a war: a peace treaty that binds both for <see cref="MinPeaceTurns"/> turns, and armies walk home.</summary>
    public static void MakePeace(GameState s, int accepter, int proposer, List<GameEvent> events)
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

    // ----- Liberation -----------------------------------------------------------------------------------

    public static string? ValidateLiberate(GameState s, int player, int cityId)
    {
        if (s.GetCity(cityId) is not { } c || c.Owner != player) return "Not your city.";
        int to = c.OriginalOwner;
        if (to == player) return "It was always yours.";
        if (to < 0 || to >= s.Players.Count || !s.Players[to].IsAlive || s.Players[to].IsFreeCities) return "Its founders are gone.";
        if (AtWar(s, player, to)) return "Make peace with its founders first.";
        if (s.CitiesOf(player).Count() <= 1) return "It is your only city.";
        return null;
    }

    /// <summary>
    /// Returns a city to the people who founded it (GDD §8.2): their grievances against the liberator are wiped, they remember the
    /// deed, the world takes note, and the first liberation of a city earns a diplomatic victory point. A liberated original
    /// capital becomes its people's capital again.
    /// </summary>
    public static void Liberate(GameState s, int player, int cityId, List<GameEvent> events)
    {
        var city = s.GetCity(cityId)!;
        int to = city.OriginalOwner;
        CitySystem.ChangeOwner(s, city, to, events, GameEventType.CityLiberated);
        city.Loyalty = Fx.FromInt(100);
        var freed = s.Players[to];
        if (city.WasOriginalCapital && freed.IsMajor)
        {
            foreach (var c in s.CitiesOf(to)) c.IsCapital = false;
            city.IsCapital = true;
            freed.CapitalCityId = city.Id;
        }
        ForgiveGrievances(s, to, player);
        AddGoodwill(s, to, player, 50, $"Liberated {city.Name}");
        foreach (var w in s.Players)
            if (w.IsMajor && w.IsAlive && w.Id != player && w.Id != to) AddGoodwill(s, w.Id, player, 5, "A liberator");
        if (!city.EverLiberated)
        {
            city.EverLiberated = true;
            CongressSystem.Award(s, player, 1, $"liberated {city.Name}", events);
            AgeSystem.Award(s, s.Players[player], 3, $"Liberated {city.Name}", events);
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

    /// <summary>Goodwill: <paramref name="holder"/> remembers something <paramref name="toward"/> did for it. Fades like a grievance.</summary>
    public static void AddGoodwill(GameState s, int holder, int toward, Fx amount, string reason)
    {
        if (holder == toward || holder < 0 || toward < 0 || amount <= Fx.Zero || !s.Players[holder].IsMajor) return;
        var same = s.Goodwill.Find(g => g.Holder == holder && g.Against == toward && g.Reason == reason);
        if (same != null) { same.Amount = Fx.Min(same.Amount + amount, Fx.FromInt(MaxGoodwillEntry)); same.Turn = s.Turn; return; }
        s.Goodwill.Add(new Grievance { Holder = holder, Against = toward, Amount = Fx.Min(amount, Fx.FromInt(MaxGoodwillEntry)), Turn = s.Turn, Reason = reason });
    }

    public const int MaxGoodwillEntry = 60;

    public static Fx GoodwillTotal(GameState s, int holder, int toward) =>
        s.Goodwill.Where(g => g.Holder == holder && g.Against == toward).Aggregate(Fx.Zero, (sum, g) => sum + g.Amount);

    /// <summary>Clears what <paramref name="holder"/> holds against <paramref name="against"/> (a liberated city wipes the slate).</summary>
    public static void ForgiveGrievances(GameState s, int holder, int against) =>
        s.Grievances.RemoveAll(g => g.Holder == holder && g.Against == against);

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
        foreach (var g in s.Goodwill) g.Amount -= Fx.One;
        s.Goodwill.RemoveAll(g => g.Amount <= Fx.Zero || !s.Players[g.Holder].IsAlive || !s.Players[g.Against].IsAlive);
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
        b.Add("Goodwill", Math.Min(MaxGoodwillAttitude, (GoodwillTotal(s, from, toward) / 5).FloorToInt()));
        if (TradePartners(s, from, toward)) b.Add("Trading partners", 3);
        if (SharedEnemy(s, from, toward)) b.Add("A common foe", 6);
        b.Add("Ideology (Divergence)", DivergenceSystem.Attitude(db, p, toward == from ? p : t));

        if (p.LeaderIndex >= 0)
        {
            var agenda = db.Leaders[p.LeaderIndex].Agenda;
            foreach (var like in agenda.Likes) b.Add($"{agenda.Name}: {like}", AgendaScore(s, like, toward) is true ? 6 : 0);
            foreach (var dislike in agenda.Dislikes) b.Add($"{agenda.Name}: {dislike}", AgendaScore(s, dislike, toward) is true ? -8 : 0);
        }
        return b;
    }

    public const int MaxGoodwillAttitude = 20;

    /// <summary>A trade route runs between the two, either way.</summary>
    public static bool TradePartners(GameState s, int a, int b)
    {
        foreach (var r in s.TradeRoutes)
        {
            if (r.Owner != a && r.Owner != b) continue;
            int other = r.Owner == a ? b : a;
            if (s.GetCity(r.Destination)?.Owner == other) return true;
        }
        return false;
    }

    /// <summary>Both are at war with the same great power.</summary>
    public static bool SharedEnemy(GameState s, int a, int b)
    {
        foreach (var o in s.Players)
            if (o.IsMajor && o.IsAlive && o.Id != a && o.Id != b && Find(s, a, o.Id)?.Status == DiploStatus.War && Find(s, b, o.Id)?.Status == DiploStatus.War)
                return true;
        return false;
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
