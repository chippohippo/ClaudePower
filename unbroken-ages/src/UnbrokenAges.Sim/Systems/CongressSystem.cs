using UnbrokenAges.Sim.Core;
using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.State;

namespace UnbrokenAges.Sim.Systems;

public enum ResolutionKind : byte { WorldsFair, TradeCharter, SovereigntyPact, PatronageOfScience, ArmsControl, ClimateAccord }

/// <summary>
/// The World Congress and the Concord (diplomatic) victory (docs/05-key-systems/20-congress.md; GDD §8.4: fewer, better
/// sessions, visible tallies). A session meets every 30 turns from turn 90; its two resolutions are announced ten turns ahead so
/// civilizations can see them, vote and change their votes. Every civilization has one free vote per resolution and buys more
/// with Diplomatic Favor (the k-th extra vote costs 10 × k). The winning option takes effect until the next session.
/// Diplomatic victory points: +1 to the civilization that put the most votes behind each winning option, and +1 to each
/// suzerain of three or more city-states at every session. 16 points win the Concord victory.
/// </summary>
public static class CongressSystem
{
    public const int FirstSession = 90, Interval = 30, Notice = 10, VictoryPoints = 16, VoteCostStep = 10;

    public sealed record Resolution(ResolutionKind Kind, string Name, bool Targeted, string A, string B);

    public static readonly Resolution[] All =
    {
        new(ResolutionKind.WorldsFair, "World's Fair", true, "the chosen civilization +20% Culture", "the chosen civilization −15% Culture"),
        new(ResolutionKind.TradeCharter, "Trade Charter", true, "the chosen civilization +15% Gold", "the chosen civilization −15% Gold"),
        new(ResolutionKind.SovereigntyPact, "Sovereignty Pact", true, "the chosen civilization's cities +3 Loyalty a turn", "the chosen civilization's cities −3 Loyalty a turn"),
        new(ResolutionKind.PatronageOfScience, "Patronage of Science", true, "the chosen civilization +15% Science", "the chosen civilization −10% Science"),
        new(ResolutionKind.ArmsControl, "Arms Control", false, "every civilization −25% Production toward units", "every civilization +15% Production toward units"),
        new(ResolutionKind.ClimateAccord, "Climate Accord", false, "every city −25% emissions and −5% Production", "every city +25% emissions and +10% Production"),
    };

    public static Resolution Info(ResolutionKind k) => All[(int)k];

    public static int SessionInterval(GameState s) => Math.Max(10, Interval * s.Options.GameSpeedPercent / 100);
    public static int FirstSessionTurn(GameState s) => FirstSession * s.Options.GameSpeedPercent / 100;

    public static int FavorPerTurn(GameState s, PlayerState p)
    {
        if (!p.IsMajor) return 0;
        int n = 1 + CityStateSystem.CityStates(s).Count(cs => cs.Suzerain == p.Id);
        if (p.Government >= 0 && s.Db.Governments[p.Government].Diplomatic >= 2) n++;
        if (p.Age is AgeState.Golden or AgeState.Heroic) n++;
        n += LeaderSystem.PlayerEffect(s, p, ModifierEffect.FavorPerTurn);
        return Math.Max(0, n);
    }

    /// <summary>Favor for <paramref name="extra"/> extra votes: 10 + 20 + … + 10k.</summary>
    public static int VoteCost(int extra) => VoteCostStep * extra * (extra + 1) / 2;

    // ----- Voting --------------------------------------------------------------------------------------

    public static string? CanVote(GameState s, PlayerState p, int resolution, int option, int target, int extra)
    {
        if (!p.IsMajor) return "Only civilizations vote.";
        var c = s.Congress;
        if (resolution < 0 || resolution >= c.Pending.Count) return "No such resolution before the Congress.";
        if (option is not (0 or 1)) return "Choose A or B.";
        var info = Info(c.Pending[resolution].Kind);
        if (info.Targeted && (target < 0 || target >= s.Players.Count || !s.Players[target].IsMajor || !s.Players[target].IsAlive)) return "Choose a civilization.";
        if (extra < 0 || extra > 10) return "Between 0 and 10 extra votes.";
        int spentElsewhere = c.Pending.Where((r, i) => i != resolution).Sum(r => r.Votes.Where(v => v.Player == p.Id).Sum(v => VoteCost(v.Extra)));
        if (VoteCost(extra) + spentElsewhere > p.Favor) return $"{VoteCost(extra)} favor needed ({p.Favor - spentElsewhere} free).";
        return null;
    }

    /// <summary>Records (or replaces) the player's vote. Favor is only spent when the session resolves.</summary>
    public static void Vote(GameState s, PlayerState p, int resolution, int option, int target, int extra)
    {
        var r = s.Congress.Pending[resolution];
        r.Votes.RemoveAll(v => v.Player == p.Id);
        r.Votes.Add(new VoteState { Player = p.Id, Option = option, Target = Info(r.Kind).Targeted ? target : -1, Extra = extra });
        r.Votes.Sort((a, b) => a.Player.CompareTo(b.Player));
    }

    /// <summary>Tally of a pending resolution: votes for A and B, and the leading target among the winning side's voters.</summary>
    public static (int A, int B, int Winner, int Target) Tally(GameState s, PendingResolutionState r)
    {
        int a = r.Votes.Where(v => v.Option == 0).Sum(v => 1 + v.Extra), b = r.Votes.Where(v => v.Option == 1).Sum(v => 1 + v.Extra);
        int winner = a >= b ? 0 : 1;
        int target = -1;
        if (Info(r.Kind).Targeted)
            target = r.Votes.Where(v => v.Option == winner && v.Target >= 0).GroupBy(v => v.Target)
                            .Select(g => (Target: g.Key, Votes: g.Sum(v => 1 + v.Extra))).OrderByDescending(x => x.Votes).ThenBy(x => x.Target)
                            .Select(x => x.Target).DefaultIfEmpty(-1).First();
        return (a, b, winner, target);
    }

    // ----- Sessions ------------------------------------------------------------------------------------

    private static int Pick(GameState s, int salt) =>
        (int)(StableHash.Combine((ulong)s.Congress.Sessions, (ulong)salt) % (ulong)All.Length);

    private static void Announce(GameState s, List<GameEvent> events)
    {
        var c = s.Congress;
        c.Pending.Clear();
        var last = c.Active.Select(a => a.Kind).ToHashSet();
        for (int salt = 0; c.Pending.Count < 2 && salt < 50; salt++)
        {
            var kind = (ResolutionKind)Pick(s, salt);
            if (c.Pending.Any(p => p.Kind == kind) || (last.Contains(kind) && salt < 20)) continue;
            c.Pending.Add(new PendingResolutionState { Kind = kind });
        }
        events.Add(new GameEvent(GameEventType.CongressAnnounced, Value: c.NextSession, Detail: string.Join(" and ", c.Pending.Select(p => Info(p.Kind).Name))));
    }

    public static void ProcessTurn(GameState s, List<GameEvent> events)
    {
        var c = s.Congress;
        var majors = s.Players.Where(p => p.IsMajor && p.IsAlive).ToList();
        if (majors.Count < 2) return;
        if (c.NextSession <= 0) c.NextSession = FirstSessionTurn(s);
        if (s.Turn >= FirstSessionTurn(s) - Notice) foreach (var p in majors) p.Favor += FavorPerTurn(s, p);
        if (c.Pending.Count == 0 && s.Turn >= c.NextSession - Notice) Announce(s, events);
        if (s.Turn < c.NextSession) return;

        // The session: resolve, spend favor, award victory points, then announce the next.
        c.Active.Clear();
        foreach (var r in c.Pending)
        {
            var (a, b, winner, target) = Tally(s, r);
            foreach (var v in r.Votes) s.Players[v.Player].Favor = Math.Max(0, s.Players[v.Player].Favor - VoteCost(v.Extra));
            if (Info(r.Kind).Targeted && target < 0) continue;   // nobody named anyone: nothing passes
            c.Active.Add(new ActiveResolutionState { Kind = r.Kind, Option = winner, Target = target });
            var champion = r.Votes.Where(v => v.Option == winner).OrderByDescending(v => v.Extra).ThenBy(v => v.Player).ToList();
            if (champion.Count > 0 && (champion.Count == 1 || champion[0].Extra > champion[1].Extra))
                Award(s, champion[0].Player, 1, $"carried the {Info(r.Kind).Name}", events);
            events.Add(new GameEvent(GameEventType.ResolutionPassed, target, Value: winner, Def: (int)r.Kind,
                                     Detail: $"{Info(r.Kind).Name}: {(winner == 0 ? Info(r.Kind).A : Info(r.Kind).B)}" +
                                             (target >= 0 ? $" — {s.Players[target].Name}" : "") + $" ({a}–{b})"));
        }
        foreach (var p in majors)
            if (CityStateSystem.CityStates(s).Count(cs => cs.Suzerain == p.Id) >= 3) Award(s, p.Id, 1, "suzerain of three city-states", events);
        c.Sessions++;
        c.NextSession += SessionInterval(s);
        c.Pending.Clear();
    }

    public static void Award(GameState s, int player, int points, string why, List<GameEvent> events)
    {
        s.Players[player].DiplomaticPoints += points;
        events.Add(new GameEvent(GameEventType.DiplomaticPointEarned, player, Value: s.Players[player].DiplomaticPoints, Detail: why));
    }

    public static int ConcordWinner(GameState s) =>
        s.Players.Where(p => p.IsMajor && p.IsAlive && p.DiplomaticPoints >= VictoryPoints)
                 .OrderByDescending(p => p.DiplomaticPoints).ThenBy(p => p.Id).Select(p => p.Id).DefaultIfEmpty(-1).First();

    // ----- Effects -------------------------------------------------------------------------------------

    private static readonly Dictionary<(ResolutionKind, int), List<ModifierDef>> Cache = new();

    private static ModifierDef Pct(YieldType y, int n) => new() { Effect = ModifierEffect.CityYieldPercent, Yield = y, Amount = Fx.FromInt(n) };

    private static List<ModifierDef> Effect(ResolutionKind k, int option)
    {
        lock (Cache)
        {
            if (Cache.TryGetValue((k, option), out var list)) return list;
            bool a = option == 0;
            list = k switch
            {
                ResolutionKind.WorldsFair => new() { Pct(YieldType.Culture, a ? 20 : -15) },
                ResolutionKind.TradeCharter => new() { Pct(YieldType.Gold, a ? 15 : -15) },
                ResolutionKind.SovereigntyPact => new() { new ModifierDef { Effect = ModifierEffect.CityLoyaltyPerTurn, Amount = Fx.FromInt(a ? 3 : -3) } },
                ResolutionKind.PatronageOfScience => new() { Pct(YieldType.Science, a ? 15 : -10) },
                ResolutionKind.ArmsControl => new() { new ModifierDef { Effect = ModifierEffect.CityProductionPercent, Category = ProductionCategory.Unit, Amount = Fx.FromInt(a ? -25 : 15) } },
                _ => new() { new ModifierDef { Effect = ModifierEffect.CityEmissionsPercent, Amount = Fx.FromInt(a ? -25 : 25) }, Pct(YieldType.Production, a ? -5 : 10) },
            };
            return Cache[(k, option)] = list;
        }
    }

    public static IEnumerable<(List<ModifierDef> Modifiers, string Source)> CityModifierSources(GameState s, CityState city)
    {
        if (!s.Players[city.Owner].IsMajor) yield break;
        foreach (var r in s.Congress.Active)
            if (!Info(r.Kind).Targeted || r.Target == city.Owner) yield return (Effect(r.Kind, r.Option), $"World Congress: {Info(r.Kind).Name}");
    }
}
