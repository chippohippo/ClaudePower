using UnbrokenAges.Sim.Core;
using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.State;

namespace UnbrokenAges.Sim.Systems;

public enum DealItemKind : byte { Gold, GoldPerTurn, Favor, Resource, City, OpenBorders, Peace, Alliance, ResearchAgreement }

/// <summary>
/// The deal table (GDD §8.3, docs/05-key-systems/08-diplomacy.md): one civilization puts an offer on the table, the other
/// accepts or rejects it. Items are gold, gold per turn, favor, strategic resources, cities and open borders (each given by one
/// side), and peace, an alliance or a research agreement (made together). Everything is re-checked when the offer is accepted,
/// and applied at once.
///
/// <see cref="Value"/> is how a leader weighs an offer: the AI accepts what it values at no less than <see cref="Threshold"/>
/// (friends forgive a little, enemies want a premium), and <see cref="GoldToBalance"/> is the "what would make this work"
/// answer: the gold that would tip the scales. Both are plain functions of the state, so the player sees the same verdict the
/// AI will reach.
/// </summary>
public static class DealSystem
{
    public const int MaxItems = 10;
    public const int OfferTurns = 5;
    public const int GoldPerTurnTurns = 30;
    public const int ResearchAgreementTurns = 20;
    /// <summary>A research agreement repays each partner this share of the cheapest technology it could research.</summary>
    public const int ResearchAgreementPercent = 60;
    public const int MaxAlliances = 2;
    /// <summary>Attitude at or above which a leader counts another as a friend (alliances, open borders, no wars).</summary>
    public const int FriendAttitude = 10;
    /// <summary>Items a leader will not accept at any price.</summary>
    public const int Refused = -100000;

    public static int ResearchAgreementCost(GameState s, PlayerState p) => 60 + 40 * s.PlayerEra(p);

    public static DealState? Find(GameState s, int id) => s.Deals.Find(d => d.Id == id);

    public static int AllianceCount(GameState s, int player) =>
        s.Relations.Count(r => (r.A == player || r.B == player) && r.Status == DiploStatus.Alliance);

    // ----- Validation ----------------------------------------------------------------------------------

    public static string? Validate(GameState s, int from, int to, IReadOnlyList<DealItemState> items)
    {
        if (from < 0 || to < 0 || from >= s.Players.Count || to >= s.Players.Count || from == to) return "Invalid partner.";
        var a = s.Players[from];
        var b = s.Players[to];
        if (!a.IsAlive || !b.IsAlive || !a.IsMajor || !b.IsMajor) return "Deals are made between living great powers.";
        if (DiplomacySystem.SameTeam(s, from, to)) return "Teammates share everything already.";
        if (items.Count == 0) return "The deal is empty.";
        if (items.Count > MaxItems) return $"At most {MaxItems} items.";
        bool peace = items.Any(i => i.Kind == DealItemKind.Peace);
        bool atWar = DiplomacySystem.AtWar(s, from, to);
        if (atWar && !peace) return "You are at war: the deal must include peace.";
        foreach (var kind in new[] { DealItemKind.Peace, DealItemKind.Alliance, DealItemKind.ResearchAgreement })
            if (items.Count(i => i.Kind == kind) > 1) return "Each joint item may appear only once.";
        var cities = new HashSet<int>();
        foreach (var item in items)
        {
            if (item.Giver != from && item.Giver != to) return "Every item must come from one of the two parties.";
            var giver = s.Players[item.Giver];
            int receiver = item.Giver == from ? to : from;
            string? why = item.Kind switch
            {
                DealItemKind.Gold => item.Amount <= 0 || item.Amount > 100000 ? "Invalid amount." :
                                     giver.Gold < Fx.FromInt(item.Amount) ? $"{Name(s, item.Giver)} cannot pay {item.Amount} gold." : null,
                DealItemKind.GoldPerTurn => item.Amount <= 0 || item.Amount > 1000 ? "Invalid amount." : null,
                DealItemKind.Favor => item.Amount <= 0 || giver.Favor < item.Amount ? $"{Name(s, item.Giver)} lacks the favor." : null,
                DealItemKind.Resource => item.Target < 0 || item.Target >= s.Db.Resources.Count || s.Db.Resources[item.Target].Class != ResourceClass.Strategic
                                         ? "Not a strategic resource." : item.Amount <= 0 || giver.Stockpile[item.Target] < item.Amount
                                         ? $"{Name(s, item.Giver)} lacks the {s.Db.Resources[item.Target].Name}." : null,
                DealItemKind.City => s.GetCity(item.Target) is not { } c || c.Owner != item.Giver ? "Not their city." :
                                     c.IsCapital ? "A capital is never traded." : !cities.Add(c.Id) ? "The city is listed twice." :
                                     s.CitiesOf(item.Giver).Count() <= cities.Count(id => s.GetCity(id)?.Owner == item.Giver) ? "They would have no city left." : null,
                DealItemKind.OpenBorders => DiplomacySystem.Allied(s, from, to) ? "Allies may already cross." :
                                            DiplomacySystem.Grants(s, item.Giver, receiver) ? $"{Name(s, item.Giver)}'s borders are already open." : null,
                DealItemKind.Peace => !atWar ? "You are not at war." :
                                      DiplomacySystem.Find(s, from, to) is { } r && s.Turn - r.Since < DiplomacySystem.MinWarTurns
                                      ? $"Peace is possible after {DiplomacySystem.MinWarTurns - (s.Turn - r.Since)} more turns of war." : null,
                DealItemKind.Alliance => atWar ? "Make peace first." : DiplomacySystem.Allied(s, from, to) ? "Already allied." :
                                         AllianceCount(s, from) >= MaxAlliances || AllianceCount(s, to) >= MaxAlliances ? $"A civilization keeps at most {MaxAlliances} alliances." : null,
                DealItemKind.ResearchAgreement => atWar ? "Make peace first." :
                                                  s.Agreements.Any(g => g.Kind == DealItemKind.ResearchAgreement && Pair(g, from, to)) ? "A research agreement is already running." :
                                                  a.Gold < Fx.FromInt(ResearchAgreementCost(s, a)) ? $"{Name(s, from)} cannot fund it ({ResearchAgreementCost(s, a)} gold)." :
                                                  b.Gold < Fx.FromInt(ResearchAgreementCost(s, b)) ? $"{Name(s, to)} cannot fund it ({ResearchAgreementCost(s, b)} gold)." : null,
                _ => "Unknown item.",
            };
            if (why != null) return why;
        }
        // Gold and favor given in several lines must still be affordable together.
        foreach (int side in new[] { from, to })
        {
            int gold = items.Where(i => i.Giver == side && i.Kind == DealItemKind.Gold).Sum(i => i.Amount);
            if (items.Any(i => i.Kind == DealItemKind.ResearchAgreement)) gold += ResearchAgreementCost(s, s.Players[side]);
            if (gold > 0 && s.Players[side].Gold < Fx.FromInt(gold)) return $"{Name(s, side)} cannot pay {gold} gold in all.";
        }
        return null;
    }

    private static bool Pair(AgreementState g, int a, int b) => (g.From == a && g.To == b) || (g.From == b && g.To == a);

    // ----- Proposing and answering ---------------------------------------------------------------------

    public static void Propose(GameState s, int from, int to, List<DealItemState> items, List<GameEvent> events)
    {
        s.Deals.RemoveAll(d => d.From == from && d.To == to);   // a new offer replaces the old one
        var deal = new DealState { Id = s.AllocateId(), From = from, To = to, Turn = s.Turn, Items = items.Select(Copy).ToList() };
        s.Deals.Add(deal);
        events.Add(new GameEvent(GameEventType.DealProposed, from, Value: to, Def: deal.Id, Detail: Describe(s, deal)));
    }

    public static string? ValidateRespond(GameState s, int player, int dealId, bool accept)
    {
        if (Find(s, dealId) is not { } deal) return "There is no such offer.";
        if (deal.To != player) return "The offer is not addressed to you.";
        return accept ? Validate(s, deal.From, deal.To, deal.Items) : null;
    }

    public static void Respond(GameState s, int player, int dealId, bool accept, List<GameEvent> events)
    {
        var deal = Find(s, dealId)!;
        s.Deals.Remove(deal);
        if (!accept)
        {
            events.Add(new GameEvent(GameEventType.DealRejected, player, Value: deal.From, Def: deal.Id, Detail: Describe(s, deal)));
            return;
        }
        Execute(s, deal, events);
    }

    /// <summary>Applies every item of an accepted deal: peace first, then transfers, then what the two now share.</summary>
    public static void Execute(GameState s, DealState deal, List<GameEvent> events)
    {
        int from = deal.From, to = deal.To;
        string text = Describe(s, deal);
        int valueTo = Value(s, deal, to), valueFrom = Value(s, deal, from);
        foreach (var item in deal.Items.OrderBy(i => i.Kind == DealItemKind.Peace ? 0 : 1))
        {
            var giver = s.Players[item.Giver];
            int receiver = item.Giver == from ? to : from;
            var taker = s.Players[receiver];
            switch (item.Kind)
            {
                case DealItemKind.Peace: DiplomacySystem.MakePeace(s, to, from, events); break;
                case DealItemKind.Gold: giver.Gold -= item.Amount; taker.Gold += item.Amount; break;
                case DealItemKind.Favor: giver.Favor -= item.Amount; taker.Favor += item.Amount; break;
                case DealItemKind.Resource:
                    giver.Stockpile[item.Target] -= item.Amount;
                    taker.Stockpile[item.Target] += item.Amount;
                    break;
                case DealItemKind.City:
                    if (s.GetCity(item.Target) is { } city) CitySystem.ChangeOwner(s, city, receiver, events, GameEventType.CityCeded);
                    break;
                case DealItemKind.OpenBorders: DiplomacySystem.SetOpenBorders(s, item.Giver, receiver, true, events); break;
                case DealItemKind.GoldPerTurn:
                    s.Agreements.Add(new AgreementState { Id = s.AllocateId(), Kind = item.Kind, From = item.Giver, To = receiver, Amount = item.Amount, TurnsLeft = GoldPerTurnTurns });
                    break;
                case DealItemKind.Alliance: DiplomacySystem.FormAlliance(s, from, to, events); break;
                case DealItemKind.ResearchAgreement:
                    s.Players[from].Gold -= ResearchAgreementCost(s, s.Players[from]);
                    s.Players[to].Gold -= ResearchAgreementCost(s, s.Players[to]);
                    s.Agreements.Add(new AgreementState { Id = s.AllocateId(), Kind = item.Kind, From = from, To = to, TurnsLeft = ResearchAgreementTurns });
                    break;
            }
        }
        // A deal leaves a little goodwill; a generous one leaves more with the side it favoured.
        DiplomacySystem.AddGoodwill(s, to, from, 3 + Math.Clamp(valueTo / 25, 0, 20), "Dealt fairly with us");
        DiplomacySystem.AddGoodwill(s, from, to, 3 + Math.Clamp(valueFrom / 25, 0, 20), "Dealt fairly with us");
        s.InvalidateIndices();
        events.Add(new GameEvent(GameEventType.DealAccepted, to, Value: from, Def: deal.Id, Detail: text));
    }

    /// <summary>Offers expire; gold-per-turn payments are made (or the agreement lapses); research agreements mature.</summary>
    public static void ProcessTurn(GameState s, List<GameEvent> events)
    {
        s.Deals.RemoveAll(d => s.Turn - d.Turn >= OfferTurns || !s.Players[d.From].IsAlive || !s.Players[d.To].IsAlive);
        foreach (var g in s.Agreements.ToList())
        {
            var a = s.Players[g.From];
            var b = s.Players[g.To];
            bool broken = !a.IsAlive || !b.IsAlive || DiplomacySystem.AtWar(s, g.From, g.To);
            if (!broken && g.Kind == DealItemKind.GoldPerTurn)
            {
                if (a.Gold < Fx.FromInt(g.Amount))
                {
                    broken = true;
                    DiplomacySystem.AddGrievance(s, g.To, g.From, 8, "Stopped its payments");
                }
                else { a.Gold -= g.Amount; b.Gold += g.Amount; }
            }
            g.TurnsLeft--;
            if (broken) { s.Agreements.Remove(g); continue; }
            if (g.TurnsLeft > 0) continue;
            s.Agreements.Remove(g);
            if (g.Kind == DealItemKind.ResearchAgreement)
                foreach (var p in new[] { a, b })
                {
                    int science = ResearchAgreementScience(s, p);
                    p.TechProgress += science;
                    events.Add(new GameEvent(GameEventType.ResearchAgreementCompleted, p.Id, Value: science, Detail: Name(s, p.Id == a.Id ? b.Id : a.Id)));
                }
        }
    }

    public static int ResearchAgreementScience(GameState s, PlayerState p)
    {
        var cheapest = s.Db.Techs.Where(t => ResearchSystem.CanResearch(p, t)).Select(t => ResearchSystem.Cost(s, p, t)).DefaultIfEmpty(Fx.FromInt(100)).Min();
        return (cheapest * ResearchAgreementPercent / 100).FloorToInt();
    }

    // ----- How a leader weighs a deal ------------------------------------------------------------------

    /// <summary>
    /// What the deal is worth to <paramref name="judge"/>, in gold: what it receives minus what it gives, with joint items weighed by
    /// its situation (a losing war makes peace precious, a winning one makes it costly) and its feelings (alliances only with friends).
    /// <see cref="Refused"/> marks something it will not do at any price.
    /// </summary>
    public static int Value(GameState s, DealState deal, int judge) => Value(s, deal.From, deal.To, deal.Items, judge);

    public static int Value(GameState s, int from, int to, IReadOnlyList<DealItemState> items, int judge)
    {
        int other = judge == from ? to : from;
        var me = s.Players[judge];
        int attitude = DiplomacySystem.Attitude(s, judge, other).Total;
        int total = 0;
        foreach (var item in items)
        {
            bool mine = item.Giver == judge;
            int v;
            switch (item.Kind)
            {
                case DealItemKind.Gold: v = item.Amount; break;
                case DealItemKind.GoldPerTurn: v = item.Amount * GoldPerTurnTurns * 2 / 3; break;
                case DealItemKind.Favor: v = item.Amount * 2; break;
                case DealItemKind.Resource:
                {
                    var res = s.Db.Resources[item.Target];
                    int cap = res.StockpileCap > 0 ? res.StockpileCap : 50;
                    int have = me.Stockpile[item.Target];
                    if (mine) v = have - item.Amount < cap / 4 ? 8 * item.Amount : have >= cap - 5 ? item.Amount : 3 * item.Amount;
                    else v = have + item.Amount > cap ? Math.Max(0, cap - have) * 2 : (have < cap / 4 ? 6 : 3) * item.Amount;
                    break;
                }
                case DealItemKind.City:
                {
                    var city = s.GetCity(item.Target)!;
                    int worth = 60 + 30 * city.Population + 40 * (city.Districts.Count - 1) + (city.WasOriginalCapital ? 200 : 0);
                    if (mine) v = city.OriginalOwner == other ? worth : 2 * worth;   // giving back what was theirs hurts less
                    else
                    {
                        int near = s.CitiesOf(judge).Select(c => s.Map.Distance(c.Tile, city.Tile)).DefaultIfEmpty(99).Min();
                        v = near > 12 ? worth / 2 : worth;
                        if (city.OriginalOwner == judge) v += worth / 2;   // a lost city returned
                    }
                    break;
                }
                case DealItemKind.OpenBorders:
                    v = mine ? (attitude < 0 && MilitaryAiStrength(s, other) > MilitaryAiStrength(s, judge) ? 80 : 20) : 20;
                    break;
                case DealItemKind.Peace: v = PeaceValue(s, judge, other); break;
                case DealItemKind.Alliance:
                    v = attitude < FriendAttitude ? Refused : 40 + 3 * (attitude - FriendAttitude);
                    break;
                case DealItemKind.ResearchAgreement:
                    v = attitude < 0 || me.Gold < Fx.FromInt(ResearchAgreementCost(s, me) + 50) ? Refused
                        : ResearchAgreementScience(s, me) - ResearchAgreementCost(s, me);
                    break;
                default: v = 0; break;
            }
            if (v <= Refused) return Refused;
            bool joint = item.Kind is DealItemKind.Peace or DealItemKind.Alliance or DealItemKind.ResearchAgreement;
            total += joint || !mine ? v : -v;
        }
        return total;
    }

    /// <summary>Peace weighed by the war: precious when losing or tired, costly when clearly winning a young war.</summary>
    public static int PeaceValue(GameState s, int judge, int other)
    {
        int mine = MilitaryAiStrength(s, judge), theirs = MilitaryAiStrength(s, other);
        var rel = DiplomacySystem.Find(s, judge, other);
        int warTurns = rel == null ? 0 : s.Turn - rel.Since;
        bool weary = SocietySystem.EffectiveWeariness(s, s.Players[judge]) >= 3 * SocietySystem.WearinessPerAmenity;
        if (weary || mine < theirs) return 60 + Math.Min(200, (theirs - mine) / 2);
        if (mine >= 2 * theirs && warTurns < 30) return -150 - 5 * (30 - warTurns);
        return 20;
    }

    private static int MilitaryAiStrength(GameState s, int player) =>
        s.Units.Where(u => u.Owner == player && SupplySystem.IsMilitary(s.Db, u)).Sum(u => UnitStats.Strength(s, u) * u.Hp / 100);

    /// <summary>The least a leader accepts: friends forgive a small loss, the resentful want a premium.</summary>
    public static int Threshold(GameState s, int judge, int other) => -2 * DiplomacySystem.Attitude(s, judge, other).Total;

    public static bool WouldAccept(GameState s, DealState deal) => WouldAccept(s, deal.From, deal.To, deal.Items);

    public static bool WouldAccept(GameState s, int from, int to, IReadOnlyList<DealItemState> items)
    {
        if (Validate(s, from, to, items) != null) return false;
        int v = Value(s, from, to, items, to);
        return v > Refused && v >= Threshold(s, to, from);
    }

    /// <summary>
    /// "What would make this work": the gold the proposer would have to add for the other side to accept (0 if it already would),
    /// or -1 if no amount would do (a refused item, or more gold than the proposer has).
    /// </summary>
    public static int GoldToBalance(GameState s, int from, int to, IReadOnlyList<DealItemState> items)
    {
        int v = Value(s, from, to, items, to);
        if (v <= Refused) return -1;
        int need = Threshold(s, to, from) - v;
        if (need <= 0) return 0;
        int offered = items.Where(i => i.Giver == from && i.Kind == DealItemKind.Gold).Sum(i => i.Amount);
        return s.Players[from].Gold.FloorToInt() - offered >= need ? need : -1;
    }

    // ----- Text ----------------------------------------------------------------------------------------

    public static string Describe(GameState s, DealState deal) => string.Join("; ", deal.Items.Select(i => DescribeItem(s, i)));

    public static string DescribeItem(GameState s, DealItemState i) => i.Kind switch
    {
        DealItemKind.Gold => $"{Name(s, i.Giver)} pays {i.Amount} gold",
        DealItemKind.GoldPerTurn => $"{Name(s, i.Giver)} pays {i.Amount} gold a turn for {GoldPerTurnTurns} turns",
        DealItemKind.Favor => $"{Name(s, i.Giver)} gives {i.Amount} favor",
        DealItemKind.Resource => $"{Name(s, i.Giver)} gives {i.Amount} {(i.Target >= 0 && i.Target < s.Db.Resources.Count ? s.Db.Resources[i.Target].Name : "?")}",
        DealItemKind.City => $"{Name(s, i.Giver)} cedes {s.GetCity(i.Target)?.Name ?? "a city"}",
        DealItemKind.OpenBorders => $"{Name(s, i.Giver)} opens its borders",
        DealItemKind.Peace => "peace",
        DealItemKind.Alliance => "an alliance",
        DealItemKind.ResearchAgreement => $"a research agreement ({ResearchAgreementTurns} turns)",
        _ => "?",
    };

    private static DealItemState Copy(DealItemState i) => new() { Kind = i.Kind, Giver = i.Giver, Amount = i.Amount, Target = i.Target };

    private static string Name(GameState s, int player) => EventText.Civ(s, player);
}
