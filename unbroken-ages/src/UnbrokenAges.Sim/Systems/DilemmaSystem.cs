using UnbrokenAges.Sim.Core;
using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.State;

namespace UnbrokenAges.Sim.Systems;

/// <summary>
/// Historic dilemmas (GDD §12.4, docs/05-key-systems/15-society.md#historic-dilemmas). Every so often a civilization faces a
/// situation drawn from its circumstances (a flooded river town, a restless conquest, a wealthy treasury, a neighbour's
/// refugees) and chooses one of two or three answers. Each answer has a price and a consequence: gold, faith, loyalty, citizens,
/// a neighbour's goodwill or grievance, a push to the world's currents, and modifiers that last a few turns. Unanswered, the
/// council takes the first answer when the time runs out. Content is data (dilemmas.json); each dilemma comes to a civilization
/// at most once per game.
/// </summary>
public static class DilemmaSystem
{
    /// <summary>The opening is for founding: no dilemmas before this turn.</summary>
    public const int FirstTurn = 60;
    /// <summary>On average one dilemma every this many turns per civilization.</summary>
    public const int Interval = 24;
    public const int AnswerTurns = 5;

    public static DilemmaDef? Pending(GameState s, PlayerState p) => p.Dilemma is { } d ? s.Db.Dilemmas[d.Def] : null;

    public static void ProcessTurn(GameState s, List<GameEvent> events)
    {
        if (s.Db.Dilemmas.Count == 0) return;
        foreach (var p in s.Players)
        {
            if (!p.IsMajor || !p.IsAlive) continue;
            for (int i = p.TimedEffects.Count - 1; i >= 0; i--)
            {
                var t = p.TimedEffects[i];
                if (--t.TurnsLeft <= 0 || (t.CityId >= 0 && s.GetCity(t.CityId)?.Owner != p.Id)) p.TimedEffects.RemoveAt(i);
            }
            if (p.Dilemma is { } pending)
            {
                if (s.Turn >= pending.Deadline) Resolve(s, p, 0, events);
                continue;
            }
            if (s.Turn < FirstTurn || Roll(s, p, 0x51) % (ulong)Interval != 0) continue;
            Present(s, p, events);
        }
    }

    private static ulong Roll(GameState s, PlayerState p, ulong salt) =>
        StableHash.Combine(StableHash.Combine(s.GameplayRng.State, (ulong)s.Turn * 7919UL + (ulong)p.Id), salt);

    /// <summary>Puts a dilemma to the player now, if any fits its circumstances. Returns whether one was presented.</summary>
    public static bool Present(GameState s, PlayerState p, List<GameEvent> events)
    {
        int era = s.PlayerEra(p);
        var options = new List<(DilemmaDef Def, int City, int Other)>();
        int totalWeight = 0;
        foreach (var d in s.Db.Dilemmas)
        {
            if (p.DilemmasSeen.Contains(d.Index) || era < d.MinEraOrder || era > d.MaxEraOrder || d.Weight <= 0) continue;
            if (Where(s, p, d.Trigger) is not var (city, other)) continue;
            options.Add((d, city, other));
            totalWeight += d.Weight;
        }
        if (options.Count == 0) return false;
        int pick = (int)(Roll(s, p, 0xD1) % (ulong)totalWeight);
        foreach (var (def, city, other) in options)
        {
            if ((pick -= def.Weight) >= 0) continue;
            p.Dilemma = new PendingDilemmaState { Def = def.Index, CityId = city, Other = other, Deadline = s.Turn + AnswerTurns };
            p.DilemmasSeen.Add(def.Index);
            events.Add(new GameEvent(GameEventType.DilemmaPresented, p.Id, city, Def: def.Index, Value: other, Detail: Title(s, p.Dilemma)));
            return true;
        }
        return false;
    }

    /// <summary>The city the dilemma happens in (-1 for none) and the people it concerns (-1 for none), or null if it cannot arise.</summary>
    public static (int City, int Other)? Where(GameState s, PlayerState p, DilemmaTrigger trigger)
    {
        var cities = s.CitiesOf(p.Id).ToList();
        if (cities.Count == 0) return null;
        var capital = cities.FirstOrDefault(c => c.IsCapital) ?? cities[0];
        CityState? First(Func<CityState, bool> test) => cities.Where(test).OrderByDescending(c => c.Population).ThenBy(c => c.Id).FirstOrDefault();
        (int, int)? AtCity(CityState? c) => c == null ? null : (c.Id, -1);
        switch (trigger)
        {
            case DilemmaTrigger.Empire: return (capital.Id, -1);
            case DilemmaTrigger.RiverCity: return AtCity(First(c => s.Map.HasFreshWaterAccess(c.Tile)));
            case DilemmaTrigger.CoastalCity: return AtCity(First(c => s.Map.IsAdjacentToSea(c.Tile)));
            case DilemmaTrigger.LargeCity: return AtCity(First(c => c.Population >= 8));
            case DilemmaTrigger.RestlessCity: return AtCity(cities.Where(c => c.Loyalty < Fx.FromInt(80)).OrderBy(c => c.Loyalty).ThenBy(c => c.Id).FirstOrDefault());
            case DilemmaTrigger.NewlyTakenCity: return AtCity(First(c => c.OriginalOwner != p.Id && c.TurnsSinceOwnerChange <= 30));
            case DilemmaTrigger.HasReligion: return p.Religion >= 0 ? (capital.Id, -1) : null;
            case DilemmaTrigger.Wealthy: return p.Gold >= Fx.FromInt(300) ? (capital.Id, -1) : null;
            case DilemmaTrigger.GoldenAge: return p.Age is AgeState.Golden or AgeState.Heroic ? (capital.Id, -1) : null;
            case DilemmaTrigger.DarkAge: return p.Age == AgeState.Dark ? (capital.Id, -1) : null;
            case DilemmaTrigger.AtWar:
                foreach (var o in s.Players)
                    if (o.IsMajor && o.IsAlive && o.Id != p.Id && DiplomacySystem.Find(s, p.Id, o.Id)?.Status == DiploStatus.War) return (capital.Id, o.Id);
                return null;
            case DilemmaTrigger.Neighbour:
                foreach (var o in s.Players)
                {
                    if (!o.IsMajor || !o.IsAlive || o.Id == p.Id || DiplomacySystem.AtWar(s, p.Id, o.Id) || DiplomacySystem.SameTeam(s, p.Id, o.Id)) continue;
                    foreach (var c in s.CitiesOf(o.Id))
                        if (cities.Any(m => s.Map.Distance(m.Tile, c.Tile) <= 10))
                            return (cities.OrderBy(m => s.Map.Distance(m.Tile, c.Tile)).ThenBy(m => m.Id).First().Id, o.Id);
                }
                return null;
        }
        return null;
    }

    public static string Title(GameState s, PendingDilemmaState d)
    {
        var def = s.Db.Dilemmas[d.Def];
        string text = def.Description ?? def.Name;
        return Fill(s, text, d);
    }

    public static string Fill(GameState s, string text, PendingDilemmaState d) =>
        text.Replace("{city}", s.GetCity(d.CityId)?.Name ?? "the capital").Replace("{other}", d.Other >= 0 ? EventText.Civ(s, d.Other) : "a neighbour");

    public static string? ValidateResolve(GameState s, PlayerState p, int option)
    {
        if (p.Dilemma is not { } d) return "No dilemma awaits you.";
        var def = s.Db.Dilemmas[d.Def];
        if (option < 0 || option >= def.Options.Count) return "No such answer.";
        var o = def.Options[option];
        if (o.Gold < 0 && p.Gold < Fx.FromInt(-o.Gold)) return $"It costs {-o.Gold} gold.";
        if (o.Faith < 0 && p.Faith < Fx.FromInt(-o.Faith)) return $"It costs {-o.Faith} faith.";
        if (o.Favor < 0 && p.Favor < -o.Favor) return $"It costs {-o.Favor} favor.";
        return null;
    }

    /// <summary>Applies the chosen answer: costs and gains now, modifiers for their turns.</summary>
    public static void Resolve(GameState s, PlayerState p, int option, List<GameEvent> events)
    {
        var d = p.Dilemma!;
        var def = s.Db.Dilemmas[d.Def];
        var o = def.Options[option];
        p.Dilemma = null;
        p.Gold += o.Gold;
        p.Faith += o.Faith;
        if (p.Faith < Fx.Zero) p.Faith = Fx.Zero;
        p.Favor = Math.Max(0, p.Favor + o.Favor);
        p.TechProgress += o.Science;
        p.CivicProgress += o.Culture;
        p.WarWeariness = Math.Clamp(p.WarWeariness + o.WarWeariness, 0, 80);
        if (o.EraScore > 0) AgeSystem.Award(s, p, o.EraScore, $"{def.Name}: {o.Name}", events);
        var city = s.GetCity(d.CityId) is { } c && c.Owner == p.Id ? c : null;
        foreach (var target in o.EmpireWide ? s.CitiesOf(p.Id).ToList() : city != null ? new List<CityState> { city } : new List<CityState>())
        {
            if (o.Loyalty != 0) target.Loyalty = Fx.Clamp(target.Loyalty + o.Loyalty, Fx.Zero, Fx.FromInt(100));
            if (o.Population != 0) target.Population = Math.Max(1, target.Population + o.Population);
        }
        if (d.Other >= 0 && d.Other < s.Players.Count && s.Players[d.Other].IsAlive)
        {
            if (o.Relations > 0) DiplomacySystem.AddGoodwill(s, d.Other, p.Id, o.Relations, def.Name);
            else if (o.Relations < 0) DiplomacySystem.AddGrievance(s, d.Other, p.Id, -o.Relations, def.Name);
        }
        if (o.Progress != Fx.Zero) s.World.Set(WorldCurrent.Progress, s.World.Progress + o.Progress);
        if (o.Strife != Fx.Zero) s.World.Set(WorldCurrent.Strife, s.World.Strife + o.Strife);
        if (o.Calamity != Fx.Zero) s.World.Set(WorldCurrent.Calamity, s.World.Calamity + o.Calamity);
        if (o.Modifiers.Count > 0 && o.Turns > 0 && (o.EmpireWide || city != null))
            p.TimedEffects.Add(new TimedEffectState { Dilemma = def.Index, Option = option, CityId = o.EmpireWide ? -1 : city!.Id, TurnsLeft = o.Turns });
        events.Add(new GameEvent(GameEventType.DilemmaResolved, p.Id, city?.Id ?? -1, Def: def.Index, Value: option,
                                 Detail: Fill(s, $"{def.Name}: {o.Name}" + (o.Description != null ? $" — {o.Description}" : "") + ".", d)));
    }

    /// <summary>Modifiers from past answers that still hold in this city.</summary>
    public static IEnumerable<(List<ModifierDef> Modifiers, string Source)> CityModifierSources(GameState s, CityState city)
    {
        var p = s.Players[city.Owner];
        if (p.TimedEffects.Count == 0) yield break;
        foreach (var t in p.TimedEffects)
            if (t.CityId < 0 || t.CityId == city.Id)
            {
                var def = s.Db.Dilemmas[t.Dilemma];
                yield return (def.Options[t.Option].Modifiers, $"{def.Name}: {def.Options[t.Option].Name} ({t.TurnsLeft} turns)");
            }
    }
}
