using UnbrokenAges.Sim.Core;
using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.State;

namespace UnbrokenAges.Sim.Systems;

/// <summary>
/// Great people (docs/05-key-systems/15-society.md). Specialty districts earn points of their class every turn (one per district,
/// one more per building in it): Academies make Scientists, Foundries Engineers, Markets Merchants, Cultural Quarters Artists,
/// Sanctuaries Prophets, Garrisons Generals and ports Admirals. Each class offers one named person at a time — the earliest
/// whose era the world has reached — and the first civilization to gather enough points recruits them; the next one costs
/// more. Their deed is immediate: a Scientist's breakthrough, an Engineer's works, a Prophet's revelation (which founds a
/// religion), a General's rally.
/// </summary>
public static class GreatPeopleSystem
{
    public static GreatPersonClass? ClassOf(DistrictDef d)
    {
        if (d.HasTag("Military")) return GreatPersonClass.General;
        return d.PrimaryYield switch
        {
            YieldType.Science => GreatPersonClass.Scientist,
            YieldType.Production => GreatPersonClass.Engineer,
            YieldType.Gold => d.HasTag("Port") ? GreatPersonClass.Admiral : GreatPersonClass.Merchant,
            YieldType.Culture => GreatPersonClass.Artist,
            YieldType.Faith => GreatPersonClass.Prophet,
            _ => null,
        };
    }

    /// <summary>Points per class this player earns each turn.</summary>
    public static int[] PointsPerTurn(GameState s, PlayerState p)
    {
        var points = new int[7];
        foreach (var city in s.CitiesOf(p.Id))
            foreach (var d in city.Districts)
            {
                if (d.Pillaged || ClassOf(s.Db.Districts[d.DefIndex]) is not { } cls) continue;
                points[(int)cls] += 1 + d.Buildings.Count;
                if (cls == GreatPersonClass.Admiral) points[(int)GreatPersonClass.Merchant] += 1;   // harbours trade as well as sail
            }
        return points;
    }

    /// <summary>Points the next great person of the class costs: rises each time anyone recruits one of that class.</summary>
    public static int Cost(GameState s, GreatPersonClass cls) =>
        30 + 30 * s.GreatPeopleTaken.Count(i => s.Db.GreatPeople[i].Class == cls);

    /// <summary>The person currently on offer in the class (earliest era the world has reached), or null.</summary>
    public static GreatPersonDef? Next(GameState s, GreatPersonClass cls) =>
        s.Db.GreatPeople.Where(g => g.Class == cls && !s.GreatPeopleTaken.Contains(g.Index) && g.EraOrder <= s.World.WorldEra)
                        .OrderBy(g => g.EraOrder).ThenBy(g => g.Index).FirstOrDefault();

    public static void ProcessTurn(GameState s, List<GameEvent> events)
    {
        var majors = s.Players.Where(p => p.IsAlive && p.IsMajor).ToList();
        foreach (var p in majors)
        {
            var add = PointsPerTurn(s, p);
            for (int c = 0; c < 7; c++) p.GreatPersonPoints[c] += add[c];
        }
        foreach (GreatPersonClass cls in Enum.GetValues<GreatPersonClass>())
        {
            if (Next(s, cls) is not { } person) continue;
            int cost = Cost(s, cls);
            // Most points wins a tie; then the lower id. Deterministic.
            var winner = majors.Where(p => p.GreatPersonPoints[(int)cls] >= cost)
                               .OrderByDescending(p => p.GreatPersonPoints[(int)cls]).ThenBy(p => p.Id).FirstOrDefault();
            if (winner == null) continue;
            winner.GreatPersonPoints[(int)cls] -= cost;
            Recruit(s, winner, person, events);
        }
    }

    public static void Recruit(GameState s, PlayerState p, GreatPersonDef person, List<GameEvent> events)
    {
        s.GreatPeopleTaken.Add(person.Index);
        p.GreatPeopleRecruited[(int)person.Class]++;
        Apply(s, p, person, events);
        events.Add(new GameEvent(GameEventType.GreatPersonRecruited, p.Id, Def: person.Index, Value: person.Amount, Detail: $"{person.Name} ({person.Class})"));
        AgeSystem.Award(s, p, 2, $"Recruited {person.Name}", events);
    }

    public static string Deed(GreatPersonDef g) => g.Effect switch
    {
        GreatPersonEffectKind.Science => $"+{g.Amount} science toward research",
        GreatPersonEffectKind.Culture => $"+{g.Amount} culture toward civics",
        GreatPersonEffectKind.Production => $"+{g.Amount} production in the capital's current build",
        GreatPersonEffectKind.Gold => $"+{g.Amount} gold",
        GreatPersonEffectKind.Faith => $"+{g.Amount} faith" + (g.Class == GreatPersonClass.Prophet ? "; may found a religion" : ""),
        GreatPersonEffectKind.Heal => "every military unit healed, +10 experience",
        GreatPersonEffectKind.Loyalty => $"+{g.Amount} loyalty in every city; fleets healed",
        _ => "",
    };

    private static void Apply(GameState s, PlayerState p, GreatPersonDef g, List<GameEvent> events)
    {
        Fx amount = Fx.FromInt(g.Amount);
        switch (g.Effect)
        {
            case GreatPersonEffectKind.Science: p.TechProgress += amount; break;
            case GreatPersonEffectKind.Culture: p.CivicProgress += amount; break;
            case GreatPersonEffectKind.Gold: p.Gold += amount; break;
            case GreatPersonEffectKind.Faith: p.Faith += amount; break;
            case GreatPersonEffectKind.Production:
                var capital = ReligionSystem.HolyCity(s, p);
                if (capital?.Queue.Items.FirstOrDefault() is { } item)
                {
                    capital.ProgressLedger.TryGetValue(item.ProgressKey, out Fx progress);
                    capital.ProgressLedger[item.ProgressKey] = progress + amount;
                }
                else p.Gold += amount / 2;   // nothing to build: the works are sold
                break;
            case GreatPersonEffectKind.Heal:
                foreach (var u in s.Units.Where(u => u.Owner == p.Id && SupplySystem.IsMilitary(s.Db, u)))
                {
                    u.Hp = 100;
                    u.Experience += 10;
                }
                break;
            case GreatPersonEffectKind.Loyalty:
                foreach (var c in s.CitiesOf(p.Id))
                {
                    c.Loyalty += amount;
                    if (c.Loyalty > Fx.FromInt(100)) c.Loyalty = Fx.FromInt(100);
                }
                foreach (var u in s.Units.Where(u => u.Owner == p.Id && s.Db.Units[u.DefIndex].Domain == UnitDomain.Naval)) u.Hp = 100;
                break;
        }
    }
}
