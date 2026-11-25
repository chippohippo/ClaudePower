using UnbrokenAges.Sim.Commands;
using UnbrokenAges.Sim.Core;
using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.State;
using UnbrokenAges.Sim.Systems;

namespace UnbrokenAges.Sim.AI;

/// <summary>
/// The AI's diplomacy beyond war and peace (docs/05-key-systems/13-ai.md#diplomacy): it answers offers with the same verdict the
/// deal screen shows (<see cref="DealSystem.WouldAccept"/>), makes one offer a turn (an alliance with a friend, a research agreement,
/// a surplus resource for gold, or peace with reparations when losing), answers an ally's call to arms, opens its borders to friends
/// and closes them to the hostile, denounces those it resents, leaves alliances that have soured, liberates cities for friends,
/// buys great people with spare gold and faith, and answers its historic dilemmas.
/// </summary>
public static class DiplomacyAi
{
    public const int DenounceAttitude = -20;

    public static IEnumerable<GameCommand> Commands(GameState s, PlayerState p)
    {
        if (!p.IsMajor || !p.IsAlive) yield break;
        var attitude = new Dictionary<int, int>();
        int Att(int other) => attitude.TryGetValue(other, out int a) ? a : attitude[other] = DiplomacySystem.Attitude(s, p.Id, other).Total;
        var majors = s.Players.Where(o => o.IsMajor && o.IsAlive && o.Id != p.Id && !DiplomacySystem.SameTeam(s, o.Id, p.Id)).ToList();

        // Offers on the table: the verdict any player can preview in the deal screen.
        foreach (var deal in s.Deals.Where(d => d.To == p.Id).OrderBy(d => d.Id).ToList())
            yield return new RespondDealCommand { Player = p.Id, DealId = deal.Id, Accept = DealSystem.WouldAccept(s, deal) };

        if (CallToArms(s, p) is { } defence) yield return defence;

        foreach (var o in majors)
        {
            int a = Att(o.Id);
            bool atWar = DiplomacySystem.AtWar(s, p.Id, o.Id);
            if (DiplomacySystem.Find(s, p.Id, o.Id)?.Status == DiploStatus.Alliance && a < 0)
                yield return new LeaveAllianceCommand { Player = p.Id, Target = o.Id };
            else if (!atWar && a >= DealSystem.FriendAttitude && !DiplomacySystem.Grants(s, p.Id, o.Id) && !DiplomacySystem.Allied(s, p.Id, o.Id))
                yield return new SetOpenBordersCommand { Player = p.Id, Target = o.Id, Open = true };
            else if (!atWar && a < 0 && DiplomacySystem.Grants(s, p.Id, o.Id))
                yield return new SetOpenBordersCommand { Player = p.Id, Target = o.Id, Open = false };
            if (a <= DenounceAttitude && !atWar && !RecentlyDenounced(s, p.Id, o.Id) && DiplomacySystem.ValidateDenounce(s, p.Id, o.Id) == null)
                yield return new DenounceCommand { Player = p.Id, Target = o.Id };
        }

        if (Liberation(s, p, Att) is { } liberate) yield return liberate;
        if (Offer(s, p, majors, Att) is { } offer) yield return offer;
        if (Patronage(s, p) is { } patron) yield return patron;
        if (p.Dilemma != null) yield return new ResolveDilemmaCommand { Player = p.Id, Option = PreferredAnswer(s, p) };
    }

    private static bool RecentlyDenounced(GameState s, int a, int b)
    {
        var r = DiplomacySystem.Find(s, a, b);
        int when = r == null ? -1 : a == r.A ? r.DenouncedByA : r.DenouncedByB;
        return when >= 0 && s.Turn - when <= DiplomacySystem.DenounceMemoryTurns;
    }

    /// <summary>
    /// An ally was attacked: join the defence when free to (no other great war, not tired of war, not a remnant), strong enough to
    /// matter, and near enough to fight.
    /// </summary>
    public static GameCommand? CallToArms(GameState s, PlayerState p)
    {
        if (MilitaryAi.MajorEnemies(s, p.Id).Count > 0 || CombatSystem.LastStand(s, p.Id)) return null;
        if (SocietySystem.EffectiveWeariness(s, p) >= 2 * SocietySystem.WearinessPerAmenity) return null;
        var near = MilitaryAi.Neighbours(s, p.Id).ToHashSet();
        foreach (int ally in DiplomacySystem.Allies(s, p.Id))
            foreach (var x in s.Players.Where(x => x.IsMajor && x.IsAlive && x.Id != p.Id && near.Contains(x.Id)))
                if (DiplomacySystem.Find(s, ally, x.Id) is { Status: DiploStatus.War } war && war.DeclaredBy == x.Id &&
                    MilitaryAi.Strength(s, p.Id) * 2 >= MilitaryAi.Strength(s, x.Id) && DiplomacySystem.ValidateDeclareWar(s, p.Id, x.Id) == null)
                    return new DeclareWarCommand { Player = p.Id, Target = x.Id };
        return null;
    }

    /// <summary>Returns a city to a friendly founder, or one about to break away anyway (better a grateful neighbour than a free city).</summary>
    private static GameCommand? Liberation(GameState s, PlayerState p, Func<int, int> att)
    {
        bool diplomat = VictoryAi.Focus(s, p) == VictoryFocus.Concord;
        foreach (var c in s.CitiesOf(p.Id).Where(c => c.OriginalOwner != p.Id && !c.IsCapital).OrderBy(c => c.Id))
        {
            if (DiplomacySystem.ValidateLiberate(s, p.Id, c.Id) != null || !s.Players[c.OriginalOwner].IsMajor) continue;
            int a = att(c.OriginalOwner);
            bool slipping = c.Loyalty < Fx.FromInt(25) && c.LastLoyaltyDelta < Fx.Zero;
            if (a >= DealSystem.FriendAttitude + 5 || slipping || (diplomat && !c.EverLiberated && a >= 0))
                return new LiberateCityCommand { Player = p.Id, CityId = c.Id };
        }
        return null;
    }

    /// <summary>One offer a turn, to one partner in rotation, and only one the partner would accept.</summary>
    private static GameCommand? Offer(GameState s, PlayerState p, List<PlayerState> majors, Func<int, int> att)
    {
        if (majors.Count == 0 || s.Turn < 20) return null;
        var o = majors[(s.Turn + p.Id) % majors.Count];
        if (s.Deals.Any(d => d.From == p.Id && d.To == o.Id)) return null;
        // Peace with reparations when the war is going badly and plain peace is refused.
        if (DiplomacySystem.Find(s, p.Id, o.Id) is { Status: DiploStatus.War } war && s.Turn - war.Since >= DiplomacySystem.MinWarTurns)
        {
            var peace = new List<DealItemState> { new() { Kind = DealItemKind.Peace, Giver = p.Id } };
            if (DealSystem.PeaceValue(s, p.Id, o.Id) < 40) return null;   // not losing: the ordinary peace logic decides
            int gold = DealSystem.GoldToBalance(s, p.Id, o.Id, peace);
            if (gold < 0 || gold > p.Gold.FloorToInt() * 2 / 5) return null;
            if (gold > 0) peace.Add(new DealItemState { Kind = DealItemKind.Gold, Giver = p.Id, Amount = gold });
            return Propose(s, p, o, peace);
        }
        if (DiplomacySystem.AtWar(s, p.Id, o.Id)) return null;
        int mine = att(o.Id);
        if (mine >= DealSystem.FriendAttitude + 2 && !DiplomacySystem.Allied(s, p.Id, o.Id) &&
            Propose(s, p, o, new() { new() { Kind = DealItemKind.Alliance, Giver = p.Id } }) is { } alliance)
            return alliance;
        if (mine >= 0 && Propose(s, p, o, new() { new() { Kind = DealItemKind.ResearchAgreement, Giver = p.Id } }) is { } research &&
            DealSystem.Value(s, p.Id, o.Id, research.Items, p.Id) > 0)
            return research;
        // A stockpile at its cap is wasted: sell ten to someone short of it.
        if (mine >= -5)
            foreach (var res in s.Db.Resources.Where(r => r.Class == ResourceClass.Strategic))
            {
                int cap = res.StockpileCap > 0 ? res.StockpileCap : 50;
                if (p.Stockpile[res.Index] < cap - 5 || o.Stockpile[res.Index] >= cap / 4 || !o.HasTech(res.RevealTechIndex)) continue;
                int price = 30;
                if (o.Gold < Fx.FromInt(price + 50)) continue;
                var sale = new List<DealItemState>
                {
                    new() { Kind = DealItemKind.Resource, Giver = p.Id, Amount = 10, Target = res.Index },
                    new() { Kind = DealItemKind.Gold, Giver = o.Id, Amount = price },
                };
                if (Propose(s, p, o, sale) is { } offer) return offer;
            }
        return null;
    }

    private static ProposeDealCommand? Propose(GameState s, PlayerState p, PlayerState o, List<DealItemState> items) =>
        DealSystem.WouldAccept(s, p.Id, o.Id, items) ? new ProposeDealCommand { Player = p.Id, Target = o.Id, Items = items } : null;

    /// <summary>
    /// Great people bought with what would otherwise pile up: faith for a prophet while religions remain to be founded, and gold (above a
    /// reserve that grows with the empire) for the class its road to victory wants.
    /// </summary>
    public static GameCommand? Patronage(GameState s, PlayerState p)
    {
        if (p.Religion < 0 && ReligionSystem.FreeReligions(s).Any() &&
            GreatPeopleSystem.ValidatePatronize(s, p, GreatPersonClass.Prophet, faith: true) == null)
            return new PatronizeCommand { Player = p.Id, Class = GreatPersonClass.Prophet, WithFaith = true };
        if (s.Turn < 60) return null;
        int reserve = 250 + 50 * s.CitiesOf(p.Id).Count();
        var wanted = VictoryAi.Focus(s, p) switch
        {
            VictoryFocus.Culture => new[] { GreatPersonClass.Artist },
            VictoryFocus.Exodus => new[] { GreatPersonClass.Engineer, GreatPersonClass.Scientist },
            VictoryFocus.Concord => new[] { GreatPersonClass.Merchant, GreatPersonClass.Artist },
            _ => new[] { GreatPersonClass.Engineer, GreatPersonClass.Artist },
        };
        foreach (var cls in wanted)
        {
            int price = GreatPeopleSystem.PatronagePrice(s, p, cls, faith: false);
            if (price > 0 && p.Gold.FloorToInt() - price >= reserve && GreatPeopleSystem.ValidatePatronize(s, p, cls, faith: false) == null)
                return new PatronizeCommand { Player = p.Id, Class = cls, WithFaith = false };
        }
        // Faith beyond what missionaries need buys artists (faith's late-game use, GDD §7).
        int faithReserve = VictoryAi.Focus(s, p) == VictoryFocus.Spiritual ? 1500 : 500;
        int artist = GreatPeopleSystem.PatronagePrice(s, p, GreatPersonClass.Artist, faith: true);
        if (artist > 0 && p.Faith.FloorToInt() - artist >= faithReserve && GreatPeopleSystem.ValidatePatronize(s, p, GreatPersonClass.Artist, faith: true) == null)
            return new PatronizeCommand { Player = p.Id, Class = GreatPersonClass.Artist, WithFaith = true };
        return null;
    }

    /// <summary>The answer worth most to this empire now (affordable ones only; the first answer is always possible).</summary>
    public static int PreferredAnswer(GameState s, PlayerState p)
    {
        if (p.Dilemma is not { } d) return 0;
        var def = s.Db.Dilemmas[d.Def];
        int best = 0;
        double bestScore = double.MinValue;
        for (int i = 0; i < def.Options.Count; i++)
        {
            if (DilemmaSystem.ValidateResolve(s, p, i) != null) continue;
            double score = AnswerScore(s, p, d, def.Options[i]);
            if (score > bestScore) { best = i; bestScore = score; }
        }
        return best;
    }

    public static double AnswerScore(GameState s, PlayerState p, PendingDilemmaState d, DilemmaOptionDef o)
    {
        var cities = s.CitiesOf(p.Id).ToList();
        var city = s.GetCity(d.CityId);
        var affected = o.EmpireWide ? cities : city != null && city.Owner == p.Id ? new List<CityState> { city } : new List<CityState>();
        bool atWar = MilitaryAi.MajorEnemies(s, p.Id).Count > 0;
        double reserve = p.Gold.ToDouble() < 150 ? 1.6 : 1.0;   // a thin treasury makes every coin dearer
        double score = (o.Gold < 0 ? o.Gold * reserve : o.Gold) + o.Faith * 0.8 + o.Favor * 2 + o.Science + o.Culture + o.EraScore * 12 + o.Population * 60;
        score -= o.WarWeariness * (atWar ? 5 : 2);
        if (d.Other >= 0) score += o.Relations * (DiplomacySystem.AtWar(s, p.Id, d.Other) ? 0.2 : 1.5);
        double war = NationAi.Personality(s, p, "war");
        score -= (o.Strife.ToDouble() * (war > 1.1 ? -1 : 2)) + o.Calamity.ToDouble() * 2;
        foreach (var c in affected)
        {
            double unrest = c.Loyalty < Fx.FromInt(70) ? 3 : 0.4;
            score += o.Loyalty * unrest;
            foreach (var m in o.Modifiers)
            {
                double amount = m.Amount.ToDouble();
                double perTurn = m.Effect switch
                {
                    ModifierEffect.CityYieldFlat => amount,
                    ModifierEffect.CityYieldPercent => amount * (c.Population + 3) / 40.0,
                    ModifierEffect.CityAmenities => amount * 1.2,
                    ModifierEffect.CityLoyaltyPerTurn => amount * unrest,
                    ModifierEffect.CityProductionPercent => amount * (c.Population + 3) / 60.0 * (atWar ? 1.5 : 0.3),
                    ModifierEffect.CityEmissionsPercent => -amount * 0.03,
                    _ => 0.2,
                };
                score += perTurn * o.Turns;
            }
        }
        return score;
    }
}
